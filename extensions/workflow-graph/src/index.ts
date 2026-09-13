import { join } from "node:path";
import { registerStagedWorkflows } from "./authoring/index.ts";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@code-yeongyu/senpi";
import type { GraphProjection } from "./contracts.ts";
import {
  createHerdrDagObserver,
  type HerdrDagObserver,
} from "./herdr/observer.ts";
import { createHerdrObserverRunner } from "./herdr/runner.ts";
import {
  createHerdrObserverStore,
  createHerdrStateWriter,
  type HerdrStateWriter,
} from "./herdr/state.ts";
import { createOverlayController } from "./overlay/controller.ts";
import type { OverlayGraph } from "./overlay/model.ts";
import { createWorkflowGraphStore } from "./store.ts";
import { registerNativeDagUiHook } from "./native-dag-ui.ts";
import { pickWorkflowRun } from "./run-picker.ts";
import {
  createTaskControl,
  type CancelResult,
  type TaskControlResult,
} from "./task-control.ts";

export function graphFromProjection(
  projection: GraphProjection,
  runId?: string,
  programs?: ReadonlyMap<string, string>,
): OverlayGraph {
  const run =
    projection.runs.find((candidate) => candidate.runId === runId) ??
    projection.runs[0];
  if (run === undefined) {
    return {
      runId: "",
      name: "No active workflow",
      stale: projection.snapshotRequired,
      truncated: !projection.isComplete,
      nodes: [],
      edges: [],
      unknownEdges: [],
    };
  }
  const edgeKeys = new Set(
    run.edges.map((edge) => `${edge.from}\u0000${edge.to}`),
  );
  const incompleteEdges = run.nodes.flatMap((node) =>
    node.dependsOn
      .filter((parentId) => !edgeKeys.has(`${parentId}\u0000${node.id}`))
      .map((parentId) => ({
        from: parentId,
        to: node.id,
        reason: "incomplete" as const,
      })),
  );

  return {
    runId: run.runId,
    name: run.name,
    status: run.status,
    ...(programs?.has(run.runId)
      ? { programStatus: programs.get(run.runId) }
      : {}),
    stale: run.stale || projection.snapshotRequired,
    truncated: !projection.isComplete,
    nodes: run.nodes.map((node) => {
      const activity = Object.values(projection.activity).find(
        (entry) => entry.runId === run.runId && entry.nodeId === node.id,
      );
      const wave = run.waves.find((item) => item.nodeIds.includes(node.id));
      return {
        id: node.id,
        label: node.label ?? node.id,
        state: node.state,
        attempt: node.attempt,
        ...(node.taskId === undefined ? {} : { taskId: node.taskId }),
        dependsOn: node.dependsOn,
        ...(node.task?.status === undefined
          ? {}
          : { taskStatus: node.task.status }),
        ...(node.task?.model === undefined ? {} : { model: node.task.model }),
        ...(node.task?.turns === undefined ? {} : { turns: node.task.turns }),
        ...(activity?.activity === undefined
          ? {}
          : { activity: activity.activity }),
        ...(activity?.currentTool === undefined
          ? {}
          : { currentTool: activity.currentTool }),
        ...(node.error?.code === undefined
          ? {}
          : { errorCode: node.error.code }),
        ...(node.startedAt === undefined ? {} : { startedAt: node.startedAt }),
        ...(node.completedAt === undefined
          ? {}
          : { completedAt: node.completedAt }),
        ...(wave === undefined ? {} : { wave: wave.index }),
      };
    }),
    edges: run.edges,
    unknownEdges: [
      ...run.invalidEdges.map((edge) => ({
        ...edge,
        reason: "endpoint" as const,
      })),
      ...incompleteEdges,
    ],
    amendCount: run.amendCount,
    counts: run.counts,
  };
}

export function synchronizeGraphPresentation(input: {
  readonly projection: GraphProjection;
  readonly programs?: ReadonlyMap<string, string>;
  readonly controller?: Pick<
    ReturnType<typeof createOverlayController>,
    "update"
  >;
  readonly writer?: Pick<HerdrStateWriter, "write">;
}): void {
  for (const run of input.projection.runs) {
    input.controller?.update(
      graphFromProjection(input.projection, run.runId, input.programs),
    );
  }
  void input.writer
    ?.write(input.projection, input.programs)
    .catch(() => undefined);
}

function controlMessage(result: TaskControlResult | CancelResult): string {
  switch (result.kind) {
    case "executed":
      return "Workflow request sent. Waiting for OMO graph update.";
    case "read-only":
      return "Workflow action is unavailable in this session.";
    case "rejected":
      return "Workflow action was rejected. Graph state was not changed.";
    case "cancelled":
      return "Workflow cancellation was not confirmed.";
    case "confirmation-required":
      return "Workflow cancellation requires confirmation.";
  }
}

function ensureOverlay(
  context: ExtensionCommandContext,
  controller: ReturnType<typeof createOverlayController> | undefined,
  control: ReturnType<typeof createTaskControl>,
  projection: () => GraphProjection,
  programs: ReadonlyMap<string, string>,
): ReturnType<typeof createOverlayController> {
  if (controller !== undefined) return controller;
  const actions = new Set(control.capabilities().actions);
  return createOverlayController({
    mode: context.mode,
    ui: context.ui,
    onSelectRun(runId) {
      return graphFromProjection(projection(), runId, programs);
    },
    actions: {
      ...(control.canReadTaskStatus()
        ? {
            async taskStatus(taskId: string) {
              return controlMessage(await control.taskStatus(taskId));
            },
          }
        : {}),
      ...(actions.has("snapshot")
        ? {
            async snapshot(runId: string) {
              return controlMessage(await control.snapshot(runId));
            },
          }
        : {}),
      ...(actions.has("send")
        ? {
            async steer(runId: string, nodeId: string) {
              const message = await context.ui.input(
                "Steer workflow node",
                "Message for selected task",
              );
              if (message === undefined) return "Steer cancelled.";
              return controlMessage(await control.send(runId, nodeId, message));
            },
          }
        : {}),
      ...(actions.has("retry")
        ? {
            async retry(runId: string, nodeId: string) {
              return controlMessage(await control.retry(runId, nodeId));
            },
          }
        : {}),
      ...(actions.has("cancel")
        ? {
            async cancel(runId: string) {
              const pending = control.requestCancel(runId);
              if (pending.kind !== "confirmation-required")
                return "Cancellation is unavailable.";
              const confirmed = await context.ui.confirm(
                "Cancel OMO workflow",
                "Cancel this workflow run? This affects running tasks.",
              );
              return controlMessage(
                await control.confirmCancel(pending, confirmed),
              );
            },
          }
        : {}),
    },
  });
}

export default function workflowGraph(pi: ExtensionAPI): void {
  const store = createWorkflowGraphStore(pi.events);
  const control = createTaskControl(pi);
  let controller: ReturnType<typeof createOverlayController> | undefined;
  let writer: HerdrStateWriter | undefined;
  let observer: HerdrDagObserver | undefined;
  let unsubscribe: (() => void) | undefined;
  let releaseNativeDagUi: (() => void) | undefined;
  const programs = new Map<string, string>();
  const staged = registerStagedWorkflows(pi, store, (runId, decision) => {
    if (runId === undefined) return;
    programs.set(runId, decision.kind);
    synchronizeGraphPresentation({
      projection: store.get(),
      controller,
      writer,
      programs,
    });
  });

  function subscribe(): void {
    if (unsubscribe !== undefined) return;
    unsubscribe = store.subscribe((projection) => {
      synchronizeGraphPresentation({
        projection,
        controller,
        writer,
        programs,
      });
    });
  }

  releaseNativeDagUi = registerNativeDagUiHook(async ({ context, runId }) => {
    if (context.mode !== "tui") return false;
    subscribe();
    const projection = store.get();
    if (
      runId !== undefined &&
      !projection.runs.some((run) => run.runId === runId)
    )
      return false;
    controller = ensureOverlay(
      context,
      controller,
      control,
      store.get,
      programs,
    );
    for (const run of projection.runs)
      controller.update(graphFromProjection(projection, run.runId, programs));
    return controller.show(graphFromProjection(projection, runId, programs));
  });

  pi.registerCommand("workflow-graph", {
    description: "Show native OMO workflow graph overlay",
    handler: async (_args, context) => {
      subscribe();
      if (context.mode !== "tui") {
        context.ui.notify(
          "Workflow graph overlay requires TUI mode.",
          "warning",
        );
        return;
      }
      controller = ensureOverlay(
        context,
        controller,
        control,
        store.get,
        programs,
      );
      const projection = store.get();
      for (const run of projection.runs) {
        controller.update(graphFromProjection(projection, run.runId, programs));
      }
      controller.show(graphFromProjection(projection, undefined, programs));
    },
  });

  pi.registerCommand("workflow-runs", {
    description:
      "Select a native workflow run in this session; optional name or ID filter",
    handler: async (args, context) => {
      subscribe();
      if (context.mode !== "tui") {
        context.ui.notify("Workflow run picker requires TUI mode.", "warning");
        return;
      }
      controller?.hide();
      const runId = await pickWorkflowRun(store.get().runs, args, context.ui);
      if (
        runId === undefined ||
        !store.get().runs.some((run) => run.runId === runId)
      )
        return;
      controller?.dispose();
      controller = ensureOverlay(
        context,
        undefined,
        control,
        store.get,
        programs,
      );
      const projection = store.get();
      for (const run of projection.runs)
        controller.update(graphFromProjection(projection, run.runId, programs));
      controller.show(graphFromProjection(projection, runId, programs));
    },
  });

  pi.registerCommand("workflow-graph-pane", {
    description: "Open or reopen right-side Herdr workflow graph pane",
    handler: async (_args, context) => {
      const runner = createHerdrObserverRunner(process.env);
      if (runner === undefined) {
        context.ui.notify(
          "Workflow graph pane requires an active Herdr OMO pane.",
          "warning",
        );
        return;
      }
      subscribe();
      if (writer === undefined) {
        writer = createHerdrStateWriter(
          join(context.agentDir, "workflow-graph", "herdr-state.json"),
        );
      }
      await writer.write(store.get(), programs);
      if (observer === undefined) {
        observer = createHerdrDagObserver({
          runner,
          parentPaneId: process.env.HERDR_PANE_ID as string,
          cwd: context.cwd,
          env: { WORKFLOW_GRAPH_STATE: writer.path },
          command: [
            process.execPath,
            join(import.meta.dirname, "herdr", "viewer.ts"),
            "--state",
            writer.path,
          ],
          store: createHerdrObserverStore(
            join(context.agentDir, "workflow-graph", "herdr-observer.json"),
          ),
        });
      }
      const pane = await observer.reopen();
      if (pane === undefined) {
        context.ui.notify(
          "Workflow graph pane could not be opened.",
          "warning",
        );
        return;
      }
      context.ui.notify(`Workflow graph pane open: ${pane.paneId}`, "info");
    },
  });

  const resetSessionState = async (): Promise<void> => {
    staged.host.stop();
    programs.clear();
    controller?.dispose();
    await observer?.close();
    controller = undefined;
    writer = undefined;
    observer = undefined;
    store.reset();
  };

  pi.on("session_start", async (_event, context) => {
    await resetSessionState();
    await staged.host.restore(context);
  });
  pi.on("session_before_switch", resetSessionState);
  pi.on("session_before_fork", resetSessionState);
  pi.on("session_shutdown", async () => {
    staged.dispose();
    unsubscribe?.();
    releaseNativeDagUi?.();
    await resetSessionState();
    store.dispose();
  });
}
