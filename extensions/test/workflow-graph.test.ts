import { describe, expect, test } from "bun:test";
import {
  createGraphProjection,
  reduceGraphMessage,
} from "../workflow-graph/src/projection.ts";
import { parseGraphMessage } from "../workflow-graph/src/contracts.ts";
import {
  graphFromProjection,
  synchronizeGraphPresentation,
} from "../workflow-graph/src/index.ts";
import { viewerSnapshot } from "../workflow-graph/src/herdr/state.ts";
import { layoutOverlayGraph } from "../workflow-graph/src/overlay/model.ts";
import { createWorkflowGraphStore } from "../workflow-graph/src/store.ts";

describe("workflow graph projection", () => {
  test("replaces snapshot state and applies each sequenced event once", () => {
    let projection = createGraphProjection();
    projection = reduceGraphMessage(projection, {
      name: "omo.dag.updated",
      data: {
        parent_session_id: "session-a",
        runs: [
          {
            run_id: "run-a",
            run_key: "graph-a",
            name: "Graph A",
            status: "running",
            created_at: "2026-09-12T00:00:00.000Z",
            updated_at: "2026-09-12T00:00:01.000Z",
            counts: { pending: 1, running: 1 },
            nodes: [
              {
                id: "discover",
                label: "Discover",
                prompt: "[redacted]",
                depends_on: [],
                state: "running",
                attempt: 1,
                created_at: "2026-09-12T00:00:00.000Z",
              },
              {
                id: "build",
                prompt: "[redacted]",
                depends_on: ["discover"],
                state: "pending",
                attempt: 0,
                created_at: "2026-09-12T00:00:00.000Z",
              },
            ],
            edges: [{ from: "discover", to: "build" }],
            waves: [{ index: 0, node_ids: ["discover"] }],
          },
        ],
      },
    });

    projection = reduceGraphMessage(projection, {
      name: "omo.dag.event",
      data: {
        schemaVersion: 1,
        runId: "run-a",
        seq: 1,
        at: "2026-09-12T00:00:02.000Z",
        lane: "control",
        type: "dag.node.transitioned",
        nodeId: "discover",
        from: "running",
        to: "completed",
        reason: "done",
      },
    });
    const afterFirstEvent = reduceGraphMessage(projection, {
      name: "omo.dag.event",
      data: {
        schemaVersion: 1,
        runId: "run-a",
        seq: 1,
        at: "2026-09-12T00:00:02.000Z",
        lane: "control",
        type: "dag.node.transitioned",
        nodeId: "discover",
        from: "running",
        to: "completed",
        reason: "done",
      },
    });

    expect(afterFirstEvent).toEqual(projection);
    expect(afterFirstEvent.runs[0]?.nodes[0]?.state).toBe("completed");
    expect(afterFirstEvent.runs[0]?.lastSeq).toBe(1);

    const layout = layoutOverlayGraph(graphFromProjection(projection), {
      width: 120,
      height: 40,
    });
    const discover = layout.cards.find((card) => card.id === "discover");
    const build = layout.cards.find((card) => card.id === "build");
    expect(build?.wave).toBe(1);
    expect(build?.rect.x).toBeGreaterThan(discover?.rect.x ?? 0);
    expect(graphFromProjection(projection).unknownEdges).toEqual([]);
  });

  test("marks declared dependencies unknown when snapshot omits their edge", () => {
    const projection = reduceGraphMessage(createGraphProjection(), {
      name: "omo.dag.updated",
      data: {
        parent_session_id: "session-a",
        runs: [
          {
            run_id: "run-a",
            run_key: "graph-a",
            name: "Graph A",
            status: "running",
            created_at: "2026-09-12T00:00:00.000Z",
            updated_at: "2026-09-12T00:00:01.000Z",
            counts: { pending: 1 },
            nodes: [
              {
                id: "root",
                depends_on: [],
                state: "completed",
                attempt: 1,
                created_at: "2026-09-12T00:00:00.000Z",
              },
              {
                id: "dependent",
                depends_on: ["root"],
                state: "pending",
                attempt: 0,
                created_at: "2026-09-12T00:00:00.000Z",
              },
            ],
            edges: [],
            waves: [],
          },
        ],
      },
    });

    expect(graphFromProjection(projection).unknownEdges).toEqual([
      { from: "root", to: "dependent", reason: "incomplete" },
    ]);
  });

  test("accepts native structured transition reasons", () => {
    expect(
      parseGraphMessage({
        name: "omo.dag.event",
        data: {
          schemaVersion: 1,
          runId: "run-native",
          seq: 3,
          at: "2026-09-12T04:55:59.571Z",
          lane: "boundary",
          type: "dag.node.transitioned",
          nodeId: "wave0-root-a",
          from: "pending",
          to: "scheduled",
          reason: { kind: "scheduled" },
        },
      }),
    ).toMatchObject({
      name: "omo.dag.event",
      data: {
        type: "dag.node.transitioned",
        runId: "run-native",
        nodeId: "wave0-root-a",
      },
    });
  });

  test("marks sequence gaps without inventing missing state", () => {
    const projection = reduceGraphMessage(createGraphProjection(), {
      name: "omo.dag.event",
      data: {
        schemaVersion: 1,
        runId: "run-gap",
        seq: 3,
        at: "2026-09-12T00:00:02.000Z",
        lane: "control",
        type: "unsupported",
      },
    });

    expect(projection.gaps).toEqual([
      { runId: "run-gap", expected: 1, received: 3 },
    ]);
    expect(projection.runs).toEqual([]);
  });

  test("keeps activity out of durable graph state and drops prompt bodies", () => {
    const projection = reduceGraphMessage(createGraphProjection(), {
      name: "omo.dag.activity",
      data: {
        schemaVersion: 1,
        runId: "run-a",
        nodeId: "discover",
        taskId: "task-a",
        at: "2026-09-12T00:00:03.000Z",
        activity: "calling tools",
        lastAssistantLine: "secret prompt-derived text",
        turns: 2,
      },
    });

    expect(projection.activity).toEqual({
      "run-a\u0000discover\u0000task-a": {
        runId: "run-a",
        nodeId: "discover",
        taskId: "task-a",
        at: "2026-09-12T00:00:03.000Z",
        activity: "calling tools",
        turns: 2,
      },
    });
    expect(JSON.stringify(projection)).not.toContain(
      "secret prompt-derived text",
    );
  });

  test("marks unprojected events stale until an authoritative snapshot replaces them", () => {
    let projection = reduceGraphMessage(createGraphProjection(), {
      name: "omo.dag.updated",
      data: {
        parent_session_id: "session-a",
        runs: [
          {
            run_id: "run-a",
            run_key: "graph-a",
            name: "Graph A",
            status: "running",
            created_at: "2026-09-12T00:00:00.000Z",
            updated_at: "2026-09-12T00:00:00.000Z",
            counts: { running: 1 },
            nodes: [
              {
                id: "discover",
                depends_on: [],
                state: "running",
                attempt: 1,
                created_at: "2026-09-12T00:00:00.000Z",
              },
            ],
            edges: [],
            waves: [],
          },
        ],
      },
    });

    projection = reduceGraphMessage(projection, {
      name: "omo.dag.event",
      data: {
        schemaVersion: 1,
        runId: "run-a",
        seq: 1,
        at: "2026-09-12T00:00:01.000Z",
        lane: "control",
        type: "unsupported",
      },
    });

    expect(projection.runs[0]?.stale).toBe(true);
    expect(projection.snapshotRequired).toBe(true);
    expect(projection.runs[0]?.lastSeq).toBe(0);

    projection = reduceGraphMessage(projection, {
      name: "omo.dag.updated",
      data: {
        parent_session_id: "session-a",
        runs: [
          {
            run_id: "run-a",
            run_key: "graph-a",
            name: "Graph A",
            status: "running",
            created_at: "2026-09-12T00:00:00.000Z",
            updated_at: "2026-09-12T00:00:01.000Z",
            counts: { running: 1 },
            nodes: [
              {
                id: "discover",
                depends_on: [],
                state: "running",
                attempt: 1,
                created_at: "2026-09-12T00:00:00.000Z",
              },
            ],
            edges: [],
            waves: [],
          },
        ],
      },
    });

    expect(projection.runs[0]?.stale).toBe(false);
    expect(projection.runs[0]?.lastSeq).toBe(1);
    expect(projection.snapshotRequired).toBe(false);
  });

  test("resets replaced sessions and removes missing runs only by snapshot authority", () => {
    let projection = reduceGraphMessage(createGraphProjection(), {
      name: "omo.dag.updated",
      data: {
        parent_session_id: "session-a",
        runs: [
          {
            run_id: "run-a",
            run_key: "graph-a",
            name: "Graph A",
            status: "running",
            created_at: "2026-09-12T00:00:00.000Z",
            updated_at: "2026-09-12T00:00:01.000Z",
            counts: { running: 1 },
            nodes: [
              {
                id: "node-a",
                depends_on: [],
                state: "running",
                attempt: 1,
                created_at: "2026-09-12T00:00:00.000Z",
              },
            ],
            edges: [],
            waves: [],
          },
        ],
      },
    });
    projection = reduceGraphMessage(projection, {
      name: "omo.dag.updated",
      data: { parent_session_id: "session-b", runs: [] },
    });
    expect(projection.parentSessionId).toBe("session-b");
    expect(projection.runs).toEqual([]);
    expect(projection.activity).toEqual({});
  });

  test("accepts native task metadata while projecting only safe fields", () => {
    const message = parseGraphMessage({
      name: "omo.task.updated",
      data: {
        parent_session_id: "session-native",
        tasks: [
          {
            task_id: "task-native",
            name: "fixture",
            task_summary: "fixture task",
            agent_type: "explore",
            execution_mode: "background",
            residency_state: "completed",
            depth: 0,
            status: "completed",
            created_at: "2026-09-12T04:55:59.555Z",
            updated_at: "2026-09-12T04:56:08.378Z",
            child_session_id: "child-native",
            model: "redacted-model",
            run_stats: { turns: 1, tool_calls: 0 },
            final_response: "must not persist",
          },
        ],
      },
    });

    expect(message).toMatchObject({
      name: "omo.task.updated",
      data: { tasks: [{ task_id: "task-native", status: "completed" }] },
    });
    if (message === undefined) throw new Error("expected native task snapshot");

    const projection = reduceGraphMessage(createGraphProjection(), message);
    expect(projection.tasks).toEqual([
      {
        taskId: "task-native",
        status: "completed",
        updatedAt: "2026-09-12T04:56:08.378Z",
        model: "redacted-model",
      },
    ]);
    expect(JSON.stringify(projection)).not.toContain("must not persist");
  });

  test("marks heartbeat gaps stale until snapshot recovery", () => {
    let projection = reduceGraphMessage(createGraphProjection(), {
      name: "omo.dag.updated",
      data: {
        parent_session_id: "session-a",
        runs: [
          {
            run_id: "run-a",
            run_key: "graph-a",
            name: "Graph A",
            status: "running",
            created_at: "2026-09-12T00:00:00.000Z",
            updated_at: "2026-09-12T00:00:01.000Z",
            counts: { running: 1 },
            nodes: [
              {
                id: "node-a",
                depends_on: [],
                state: "running",
                attempt: 1,
                created_at: "2026-09-12T00:00:00.000Z",
              },
            ],
            edges: [],
            waves: [],
          },
        ],
      },
    });
    projection = reduceGraphMessage(projection, {
      name: "omo.dag.heartbeat",
      data: {
        schemaVersion: 1,
        at: "2026-09-12T00:00:04.000Z",
        runs: [{ runId: "run-a", headSeq: 4 }],
      },
    });
    expect(projection.snapshotRequired).toBe(true);
    expect(projection.runs[0]?.stale).toBe(true);
  });

  test("rejects malformed transport before projection reduction", () => {
    expect(
      parseGraphMessage({
        name: "omo.dag.updated",
        data: { runs: "not an array" },
      }),
    ).toBeUndefined();
    expect(parseGraphMessage({ name: "unsafe", data: {} })).toBeUndefined();
  });

  test("projects complete state variants, truncation, invalid edges, and task replacement", () => {
    const states = [
      "pending",
      "scheduled",
      "running",
      "blocked",
      "paused",
      "completed",
      "failed",
      "skipped",
      "cancelled",
    ] as const;
    let projection = reduceGraphMessage(createGraphProjection(), {
      name: "omo.dag.updated",
      data: {
        parent_session_id: "session-a",
        truncated_runs: 1,
        runs: [
          {
            run_id: "run-a",
            run_key: "graph-a",
            name: "Graph A",
            status: "completed",
            created_at: "2026-09-12T00:00:00.000Z",
            updated_at: "2026-09-12T00:00:01.000Z",
            completed_at: "2026-09-12T00:00:01.000Z",
            counts: { completed: 1, failed: 1, cancelled: 1 },
            nodes: states.map((state, index) => ({
              id: state,
              label: state,
              depends_on: [],
              state,
              attempt: index,
              ...(state === "running" ? { task_id: "task-a" } : {}),
              created_at: "2026-09-12T00:00:00.000Z",
            })),
            edges: [
              { from: "pending", to: "completed" },
              { from: "missing", to: "completed" },
            ],
            waves: [],
          },
        ],
      },
    });

    expect(projection.isComplete).toBe(false);
    expect(projection.runs[0]?.nodes.map((node) => node.state)).toEqual([
      ...states,
    ]);
    expect(projection.runs[0]?.invalidEdges).toEqual([
      { from: "missing", to: "completed" },
    ]);

    projection = reduceGraphMessage(projection, {
      name: "omo.task.updated",
      data: {
        parent_session_id: "session-a",
        truncated_tasks: 1,
        tasks: [
          {
            task_id: "task-a",
            status: "running",
            updated_at: "2026-09-12T00:00:02.000Z",
            model: "test-model",
            turns: 3,
          },
        ],
      },
    });
    expect(
      projection.runs[0]?.nodes.find((node) => node.id === "running")?.task,
    ).toEqual({
      taskId: "task-a",
      status: "running",
      updatedAt: "2026-09-12T00:00:02.000Z",
      model: "test-model",
      turns: 3,
    });
    expect(projection.isComplete).toBe(false);

    projection = reduceGraphMessage(projection, {
      name: "omo.task.updated",
      data: { parent_session_id: "session-a", tasks: [] },
    });
    expect(
      projection.runs[0]?.nodes.find((node) => node.id === "running")?.task,
    ).toBeUndefined();

    const empty = reduceGraphMessage(createGraphProjection(), {
      name: "omo.dag.updated",
      data: { parent_session_id: "session-empty", runs: [] },
    });
    expect(empty.runs).toEqual([]);
    expect(empty.isComplete).toBe(true);
  });

  test("synchronizes matching overlay and pane snapshots when writer fails", async () => {
    const projection = reduceGraphMessage(createGraphProjection(), {
      name: "omo.dag.updated",
      data: {
        parent_session_id: "session-a",
        runs: [
          {
            run_id: "run-a",
            run_key: "graph-a",
            name: "Graph A",
            status: "running",
            created_at: "2026-09-12T00:00:00.000Z",
            updated_at: "2026-09-12T00:00:01.000Z",
            counts: { running: 1 },
            nodes: [
              {
                id: "node-a",
                depends_on: [],
                state: "running",
                attempt: 1,
                created_at: "2026-09-12T00:00:00.000Z",
              },
            ],
            edges: [],
            waves: [],
          },
        ],
      },
    });
    const graphs: unknown[] = [];

    synchronizeGraphPresentation({
      projection,
      controller: { update: (graph) => graphs.push(graph) },
      writer: {
        async write() {
          throw new Error("writer unavailable");
        },
      },
    });
    await Promise.resolve();

    const overlay = graphs[0];
    const pane = viewerSnapshot(projection, "2026-09-12T00:00:02.000Z");
    expect(overlay).toEqual(graphFromProjection(projection));
    expect(pane.runs[0]?.nodes).toHaveLength(
      graphFromProjection(projection).nodes.length,
    );
  });

  test("clears the projection and notifies subscribers at a session boundary", () => {
    let listener: ((data: unknown) => void) | undefined;
    const store = createWorkflowGraphStore({
      on(_channel, handler) {
        listener = handler;
        return () => {
          listener = undefined;
        };
      },
    });
    const observed: string[][] = [];
    store.subscribe((projection) =>
      observed.push(projection.runs.map((run) => run.runId)),
    );

    listener?.({
      name: "omo.dag.updated",
      data: {
        parent_session_id: "session-a",
        runs: [
          {
            run_id: "run-a",
            run_key: "graph-a",
            name: "Graph A",
            status: "running",
            created_at: "2026-09-12T00:00:00.000Z",
            updated_at: "2026-09-12T00:00:01.000Z",
            counts: { running: 1 },
            nodes: [],
            edges: [],
            waves: [],
          },
        ],
      },
    });
    store.reset();

    expect(observed).toEqual([["run-a"], []]);
    expect(store.get()).toEqual(createGraphProjection());
    store.dispose();
  });

  test("accepts only validated OMO RPC events through read-only store", () => {
    let listener: ((data: unknown) => void) | undefined;
    const store = createWorkflowGraphStore({
      on(channel: string, handler: (data: unknown) => void) {
        expect(channel).toBe("senpi:extension-rpc-event");
        listener = handler;
        return () => {
          listener = undefined;
        };
      },
    });

    listener?.({
      name: "omo.dag.updated",
      data: { parent_session_id: "session-a", runs: [] },
    });
    expect(store.get().parentSessionId).toBe("session-a");

    listener?.({ name: "omo.dag.updated", data: { runs: "unsafe" } });
    expect(store.get().runs).toEqual([]);

    store.dispose();
    expect(listener).toBeUndefined();
  });
});
