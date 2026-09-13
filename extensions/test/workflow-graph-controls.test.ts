import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import {
  createTaskControl,
  type WorkflowToolRuntime,
} from "../workflow-graph/src/task-control.ts";
import {
  createHerdrDagObserver,
  type HerdrObserverRecord,
  type HerdrObserverRunner,
  type HerdrObserverStore,
} from "../workflow-graph/src/herdr/observer.ts";
import { createHerdrObserverRunner } from "../workflow-graph/src/herdr/runner.ts";

const taskOutputParameters = Type.Object(
  {
    task_id: Type.String(),
    mode: Type.Literal("status"),
  },
  { additionalProperties: false },
);

const workflowParameters = Type.Union([
  Type.Object(
    { action: Type.Literal("snapshot"), run_id: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("retry"),
      run_id: Type.String(),
      node_id: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("send"),
      run_id: Type.String(),
      node_id: Type.String(),
      message: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("cancel"), run_id: Type.String() },
    { additionalProperties: false },
  ),
]);

function runtime(
  active = true,
  taskStatus = false,
): {
  readonly runtime: WorkflowToolRuntime;
  readonly calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    runtime: {
      getAllTools: () => [
        { name: "workflow", parameters: workflowParameters },
        ...(taskStatus
          ? [{ name: "task_output", parameters: taskOutputParameters }]
          : []),
      ],
      getActiveTools: () =>
        active ? ["workflow", ...(taskStatus ? ["task_output"] : [])] : [],
      async executeTool(name, params) {
        calls.push({ name, params });
        return { content: [], details: { kind: "ok" } };
      },
    },
    calls,
  };
}

describe("workflow graph task controls", () => {
  test("discovers only schema-supported active workflow actions", () => {
    expect(createTaskControl(runtime().runtime).capabilities()).toEqual({
      available: true,
      active: true,
      actions: ["snapshot", "retry", "send", "cancel"],
    });
  });

  test("falls back to read-only when workflow is inactive", async () => {
    const inactive = runtime(false);
    const control = createTaskControl(inactive.runtime);
    expect(await control.snapshot("run-a")).toEqual({ kind: "read-only" });
    expect(inactive.calls).toEqual([]);
  });

  test("builds only schema-safe action arguments", async () => {
    const live = runtime();
    const control = createTaskControl(live.runtime);
    expect(await control.retry("run-a", "node-a")).toEqual({
      kind: "executed",
    });
    expect(
      await control.send("run-a", "node-a", "rerun with current evidence"),
    ).toEqual({ kind: "executed" });
    expect(live.calls).toEqual([
      {
        name: "workflow",
        params: { action: "retry", run_id: "run-a", node_id: "node-a" },
      },
      {
        name: "workflow",
        params: {
          action: "send",
          run_id: "run-a",
          node_id: "node-a",
          message: "rerun with current evidence",
        },
      },
    ]);
  });

  test("rejects resolved workflow error results without claiming success", async () => {
    const live = runtime();
    live.runtime.executeTool = async () => ({
      content: [],
      details: {
        kind: "error",
        error: { code: "run_not_found", message: "unknown run" },
      },
    });

    expect(await createTaskControl(live.runtime).snapshot("missing")).toEqual({
      kind: "rejected",
    });
  });

  test("rejects resolved task-output error results", async () => {
    const live = runtime(true, true);
    live.runtime.executeTool = async () => ({
      content: [],
      details: { kind: "error", error: { code: "not_found" } },
    });

    expect(await createTaskControl(live.runtime).taskStatus("missing")).toEqual(
      {
        kind: "rejected",
      },
    );
  });

  test("reads task status only through live task_output status schema", async () => {
    const live = runtime(true, true);
    const control = createTaskControl(live.runtime);

    expect(control.canReadTaskStatus()).toBe(true);
    expect(await control.taskStatus("task-a")).toEqual({ kind: "executed" });
    expect(live.calls).toEqual([
      { name: "task_output", params: { task_id: "task-a", mode: "status" } },
    ]);
  });

  test("requires cancellation confirmation without optimistic mutation", async () => {
    const live = runtime();
    const control = createTaskControl(live.runtime);
    const pending = control.requestCancel("run-a");
    if (pending.kind !== "confirmation-required")
      throw new Error("missing cancellation confirmation");
    expect(live.calls).toEqual([]);
    expect(await control.confirmCancel(pending, false)).toEqual({
      kind: "cancelled",
    });
    expect(live.calls).toEqual([]);
    expect(await control.confirmCancel(pending, true)).toEqual({
      kind: "executed",
    });
    expect(live.calls).toEqual([
      { name: "workflow", params: { action: "cancel", run_id: "run-a" } },
    ]);
  });
});

function observerRunner(): {
  readonly runner: HerdrObserverRunner;
  readonly calls: string[][];
  readonly existing: Set<string>;
} {
  const calls: string[][] = [];
  const existing = new Set<string>();
  return {
    runner: {
      async splitPane(input) {
        calls.push([
          "split",
          input.paneId,
          input.direction,
          input.cwd,
          JSON.stringify(input.env),
        ]);
        existing.add("pane-viewer-returned");
        return { paneId: "pane-viewer-returned" };
      },
      async runPane(input) {
        calls.push(["run", input.paneId, ...input.argv]);
      },
      async closePane(paneId) {
        calls.push(["close", paneId]);
        existing.delete(paneId);
      },
      async paneExists(paneId) {
        calls.push(["get", paneId]);
        return existing.has(paneId);
      },
    },
    calls,
    existing,
  };
}

describe("workflow graph Herdr observer", () => {
  test("splits only caller OMO pane using returned opaque observer ID", async () => {
    const herdr = observerRunner();
    const observer = createHerdrDagObserver({
      runner: herdr.runner,
      parentPaneId: "pane-omo-returned",
      cwd: "/repo",
      env: { WORKFLOW_GRAPH_STATE: "/agent/state.json" },
      command: ["bun", "viewer.ts", "--state", "/agent/state.json"],
    });

    expect(await observer.ensure()).toEqual({ paneId: "pane-viewer-returned" });
    expect(await observer.ensure()).toEqual({ paneId: "pane-viewer-returned" });
    expect(herdr.calls).toEqual([
      [
        "split",
        "pane-omo-returned",
        "right",
        "/repo",
        '{"WORKFLOW_GRAPH_STATE":"/agent/state.json"}',
      ],
      [
        "run",
        "pane-viewer-returned",
        "bun",
        "viewer.ts",
        "--state",
        "/agent/state.json",
      ],
      ["get", "pane-viewer-returned"],
    ]);
  });

  test("serializes concurrent opens into one right pane", async () => {
    const herdr = observerRunner();
    const observer = createHerdrDagObserver({
      runner: herdr.runner,
      parentPaneId: "pane-omo-returned",
      cwd: "/repo",
      env: {},
      command: ["bun", "viewer.ts"],
    });

    expect(await Promise.all([observer.ensure(), observer.ensure()])).toEqual([
      { paneId: "pane-viewer-returned" },
      { paneId: "pane-viewer-returned" },
    ]);
    expect(herdr.calls.filter(([kind]) => kind === "split")).toHaveLength(1);
  });

  test("closes only the extension-owned returned pane on normal shutdown", async () => {
    const herdr = observerRunner();
    const observer = createHerdrDagObserver({
      runner: herdr.runner,
      parentPaneId: "pane-omo-returned",
      cwd: "/repo",
      env: {},
      command: ["bun", "viewer.ts"],
    });
    await observer.ensure();

    await observer.close();

    expect(herdr.calls).toContainEqual(["close", "pane-viewer-returned"]);
    expect(observer.status()).toBe("manually-closed");
    expect(await observer.ensure()).toBeUndefined();
  });

  test("does not close a pane it never created", async () => {
    const herdr = observerRunner();
    const observer = createHerdrDagObserver({
      runner: herdr.runner,
      parentPaneId: "pane-omo-returned",
      cwd: "/repo",
      env: {},
      command: ["bun", "viewer.ts"],
    });

    await observer.close();

    expect(herdr.calls).toEqual([]);
  });

  test("preserves view state and requires explicit reopen after manual close", async () => {
    const herdr = observerRunner();
    const observer = createHerdrDagObserver({
      runner: herdr.runner,
      parentPaneId: "pane-omo-returned",
      cwd: "/repo",
      env: {},
      command: ["bun", "viewer.ts"],
    });

    await observer.ensure();
    observer.setViewState({ selectedRunId: "run-a", filter: "failed" });
    observer.markManuallyClosed();
    expect(observer.viewState()).toEqual({
      selectedRunId: "run-a",
      filter: "failed",
    });
    expect(await observer.ensure()).toBeUndefined();
    expect(await observer.reopen()).toEqual({ paneId: "pane-viewer-returned" });
    expect(herdr.calls.filter(([kind]) => kind === "split")).toHaveLength(2);
  });

  test("detects externally closed pane without touching OMO graph state", async () => {
    const herdr = observerRunner();
    const observer = createHerdrDagObserver({
      runner: herdr.runner,
      parentPaneId: "pane-omo-returned",
      cwd: "/repo",
      env: {},
      command: ["bun", "viewer.ts"],
    });
    await observer.ensure();
    herdr.existing.clear();
    expect(await observer.ensure()).toBeUndefined();
    expect(observer.status()).toBe("manually-closed");
  });

  test("reattaches to persisted returned pane without creating a duplicate", async () => {
    const herdr = observerRunner();
    herdr.existing.add("pane-viewer-returned");
    const store: HerdrObserverStore = {
      async load() {
        return {
          paneId: "pane-viewer-returned",
          manuallyClosed: false,
          viewState: { selectedRunId: "run-a", filter: "failed" },
        };
      },
      async save() {},
    };
    const observer = createHerdrDagObserver({
      runner: herdr.runner,
      parentPaneId: "pane-omo-returned",
      cwd: "/repo",
      env: {},
      command: ["bun", "viewer.ts"],
      store,
    });

    expect(await observer.ensure()).toEqual({ paneId: "pane-viewer-returned" });
    expect(herdr.calls).toEqual([["get", "pane-viewer-returned"]]);
    expect(observer.viewState()).toEqual({
      selectedRunId: "run-a",
      filter: "failed",
    });
  });

  test("restores manual close and view state without reopening", async () => {
    const herdr = observerRunner();
    const saved: HerdrObserverRecord[] = [];
    const store: HerdrObserverStore = {
      async load() {
        return {
          manuallyClosed: true,
          viewState: { selectedRunId: "run-a", filter: "failed" },
        };
      },
      async save(record) {
        saved.push(record);
      },
    };
    const observer = createHerdrDagObserver({
      runner: herdr.runner,
      parentPaneId: "pane-omo-returned",
      cwd: "/repo",
      env: {},
      command: ["bun", "viewer.ts"],
      store,
    });

    expect(await observer.ensure()).toBeUndefined();
    expect(observer.viewState()).toEqual({
      selectedRunId: "run-a",
      filter: "failed",
    });
    expect(herdr.calls).toEqual([]);
    observer.setViewState({ filter: "running" });
    expect(saved).toEqual([
      { manuallyClosed: true, viewState: { filter: "running" } },
    ]);
  });

  test("closes only returned pane when viewer launch fails", async () => {
    const calls: string[] = [];
    const observer = createHerdrDagObserver({
      runner: {
        async splitPane() {
          return { paneId: "pane-returned" };
        },
        async runPane() {
          throw new Error("viewer failed");
        },
        async closePane(paneId) {
          calls.push(paneId);
        },
        async paneExists() {
          return false;
        },
      },
      parentPaneId: "pane-omo-returned",
      cwd: "/repo",
      env: {},
      command: ["bun", "viewer.ts"],
    });

    expect(await observer.ensure()).toBeUndefined();
    expect(observer.status()).toBe("unavailable");
    expect(calls).toEqual(["pane-returned"]);
  });

  test("isolates observer runner failure from graph runtime", async () => {
    const observer = createHerdrDagObserver({
      runner: {
        async splitPane() {
          throw new Error("Herdr unavailable");
        },
        async runPane() {
          throw new Error("not reached");
        },
        async closePane() {},
        async paneExists() {
          return false;
        },
      },
      parentPaneId: "pane-omo-returned",
      cwd: "/repo",
      env: {},
      command: ["bun", "viewer.ts"],
    });
    expect(await observer.ensure()).toBeUndefined();
    expect(observer.status()).toBe("unavailable");
  });
});

describe("workflow graph Herdr argv runner", () => {
  test("uses current opaque pane ID and parses returned split ID", async () => {
    const calls: string[][] = [];
    const runner = createHerdrObserverRunner(
      {
        HERDR_ENV: "1",
        HERDR_PANE_ID: "pane-omo-returned",
        HERDR_BIN_PATH: "herdr-bin",
      },
      async (argv) => {
        calls.push([...argv]);
        if (argv[1] === "pane" && argv[2] === "split")
          return {
            code: 0,
            output: JSON.stringify({
              pane: { pane_id: "pane-viewer-returned" },
            }),
          };
        if (argv[1] === "pane" && argv[2] === "get")
          return {
            code: 0,
            output: JSON.stringify({ pane: { pane_id: argv[3] } }),
          };
        return { code: 0, output: "" };
      },
    );
    if (runner === undefined) throw new Error("missing Herdr runner");

    const pane = await runner.splitPane({
      paneId: "pane-omo-returned",
      direction: "right",
      cwd: "/repo",
      env: { WORKFLOW_GRAPH_STATE: "/agent/state.json" },
    });
    await runner.runPane({
      paneId: pane.paneId,
      argv: ["bun", "viewer.ts", "--state", "/agent/state.json"],
    });
    expect(await runner.paneExists(pane.paneId)).toBe(true);

    expect(calls).toEqual([
      [
        "herdr-bin",
        "pane",
        "split",
        "--pane",
        "pane-omo-returned",
        "--direction",
        "right",
        "--ratio",
        "0.4",
        "--cwd",
        "/repo",
        "--env",
        "WORKFLOW_GRAPH_STATE=/agent/state.json",
        "--no-focus",
      ],
      [
        "herdr-bin",
        "pane",
        "run",
        "pane-viewer-returned",
        "bun",
        "viewer.ts",
        "--state",
        "/agent/state.json",
      ],
      ["herdr-bin", "pane", "get", "pane-viewer-returned"],
    ]);
  });

  test("does not expose Herdr mutation outside a managed pane", () => {
    expect(createHerdrObserverRunner({})).toBeUndefined();
  });
});
