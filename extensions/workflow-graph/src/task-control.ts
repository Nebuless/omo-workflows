import type { TSchema } from "typebox";
import { Value } from "typebox/value";

const WORKFLOW_ACTIONS = ["snapshot", "retry", "send", "cancel"] as const;
type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

type WorkflowToolInfo = {
  readonly name: string;
  readonly parameters: TSchema;
};

export interface WorkflowToolRuntime {
  getAllTools(): readonly WorkflowToolInfo[];
  getActiveTools(): readonly string[];
  executeTool(
    name: string,
    params: unknown,
    options?: { readonly activateInactiveTool?: boolean },
  ): Promise<{
    readonly content: readonly unknown[];
    readonly details: unknown;
  }>;
}

export type WorkflowCapabilities = {
  readonly available: boolean;
  readonly active: boolean;
  readonly actions: readonly WorkflowAction[];
};

export type TaskControlResult =
  | { readonly kind: "read-only" }
  | { readonly kind: "rejected" }
  | { readonly kind: "executed" };

export type PendingCancel = {
  readonly kind: "confirmation-required";
  readonly runId: string;
};

export type CancelResult =
  | PendingCancel
  | { readonly kind: "cancelled" }
  | TaskControlResult;

function text(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function discover(
  runtime: WorkflowToolRuntime,
  name: string,
): {
  readonly tool?: WorkflowToolInfo;
  readonly active: boolean;
} {
  const tool = runtime.getAllTools().find((item) => item.name === name);
  return { tool, active: runtime.getActiveTools().includes(name) };
}

function isErrorResult(details: unknown): boolean {
  return (
    typeof details === "object" &&
    details !== null &&
    "kind" in details &&
    details.kind === "error"
  );
}

function actionParams(
  action: WorkflowAction,
  values: readonly string[],
): Readonly<Record<string, string>> | undefined {
  const [runId, nodeId, message] = values.map(text);
  if (runId === undefined) return undefined;
  switch (action) {
    case "snapshot":
    case "cancel":
      return { action, run_id: runId };
    case "retry":
      return nodeId === undefined
        ? undefined
        : { action, run_id: runId, node_id: nodeId };
    case "send":
      return nodeId === undefined || message === undefined
        ? undefined
        : { action, run_id: runId, node_id: nodeId, message };
  }
}

export interface TaskControl {
  capabilities(): WorkflowCapabilities;
  canReadTaskStatus(): boolean;
  taskStatus(taskId: string): Promise<TaskControlResult>;
  snapshot(runId: string): Promise<TaskControlResult>;
  retry(runId: string, nodeId: string): Promise<TaskControlResult>;
  send(
    runId: string,
    nodeId: string,
    message: string,
  ): Promise<TaskControlResult>;
  requestCancel(runId: string): PendingCancel | { readonly kind: "rejected" };
  confirmCancel(
    pending: PendingCancel,
    confirmed: boolean,
  ): Promise<CancelResult>;
}

export function createTaskControl(runtime: WorkflowToolRuntime): TaskControl {
  async function execute(
    action: WorkflowAction,
    values: readonly string[],
  ): Promise<TaskControlResult> {
    const { tool, active } = discover(runtime, "workflow");
    if (tool === undefined || !active) return { kind: "read-only" };
    const params = actionParams(action, values);
    if (params === undefined || !Value.Check(tool.parameters, params)) {
      return { kind: "rejected" };
    }
    try {
      const result = await runtime.executeTool("workflow", params);
      return isErrorResult(result.details)
        ? { kind: "rejected" }
        : { kind: "executed" };
    } catch {
      return { kind: "rejected" };
    }
  }

  return {
    capabilities(): WorkflowCapabilities {
      const { tool, active } = discover(runtime, "workflow");
      if (tool === undefined)
        return { available: false, active: false, actions: [] };
      const actions = active
        ? WORKFLOW_ACTIONS.filter((action) => {
            const sample = actionParams(action, ["run", "node", "message"]);
            return sample !== undefined && Value.Check(tool.parameters, sample);
          })
        : [];
      return { available: true, active, actions };
    },
    canReadTaskStatus(): boolean {
      const { tool, active } = discover(runtime, "task_output");
      return (
        active &&
        tool !== undefined &&
        Value.Check(tool.parameters, { task_id: "task", mode: "status" })
      );
    },
    async taskStatus(taskId: string): Promise<TaskControlResult> {
      const { tool, active } = discover(runtime, "task_output");
      const normalized = text(taskId);
      const params =
        normalized === undefined
          ? undefined
          : { task_id: normalized, mode: "status" };
      if (tool === undefined || !active) return { kind: "read-only" };
      if (params === undefined || !Value.Check(tool.parameters, params)) {
        return { kind: "rejected" };
      }
      try {
        const result = await runtime.executeTool("task_output", params);
        return isErrorResult(result.details)
          ? { kind: "rejected" }
          : { kind: "executed" };
      } catch {
        return { kind: "rejected" };
      }
    },
    snapshot(runId: string): Promise<TaskControlResult> {
      return execute("snapshot", [runId]);
    },
    retry(runId: string, nodeId: string): Promise<TaskControlResult> {
      return execute("retry", [runId, nodeId]);
    },
    send(
      runId: string,
      nodeId: string,
      message: string,
    ): Promise<TaskControlResult> {
      return execute("send", [runId, nodeId, message]);
    },
    requestCancel(
      runId: string,
    ): PendingCancel | { readonly kind: "rejected" } {
      const normalized = text(runId);
      return normalized === undefined
        ? { kind: "rejected" }
        : { kind: "confirmation-required", runId: normalized };
    },
    async confirmCancel(
      pending: PendingCancel,
      confirmed: boolean,
    ): Promise<CancelResult> {
      if (!confirmed) return { kind: "cancelled" };
      return execute("cancel", [pending.runId]);
    },
  };
}
