export type TargetKind = "workspace" | "worktree" | "tab" | "pane" | "agent";

export type OpaqueTargetId = string & {
  readonly __opaqueTargetId: unique symbol;
};

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface TargetSnapshot {
  readonly kind: TargetKind;
  readonly id: OpaqueTargetId;
  readonly revision: string;
  readonly workspaceId: OpaqueTargetId;
  readonly worktreeId?: OpaqueTargetId;
  readonly tabId?: OpaqueTargetId;
  readonly paneId?: OpaqueTargetId;
  readonly agentId?: OpaqueTargetId;
  readonly interactiveReady?: boolean;
  readonly agentStatus?: AgentStatus;
}

export interface TargetSnapshotInput {
  readonly kind: TargetKind;
  readonly id: string;
  readonly revision: string | number;
  readonly workspaceId: string;
  readonly worktreeId?: string;
  readonly tabId?: string;
  readonly paneId?: string;
  readonly agentId?: string;
  readonly interactiveReady?: boolean;
  readonly agentStatus?: AgentStatus;
}

const TARGET_KINDS: Record<TargetKind, true> = {
  workspace: true,
  worktree: true,
  tab: true,
  pane: true,
  agent: true,
};
const AGENT_STATUSES: Record<AgentStatus, true> = {
  idle: true,
  working: true,
  blocked: true,
  done: true,
  unknown: true,
};
const MAX_TARGET_ID_LENGTH = 512;

function sameOpaqueId(
  expected: OpaqueTargetId | undefined,
  actual: OpaqueTargetId | undefined,
  field: string,
): void {
  if (expected !== actual) {
    throw new Error(`Target ${field} changed since inspection.`);
  }
}

function parseOptionalOpaqueTargetId(
  value: unknown,
  field: string,
): OpaqueTargetId | undefined {
  return value === undefined ? undefined : parseOpaqueTargetId(value, field);
}

function parseRevision(value: unknown): string {
  if (typeof value === "string" && value.length > 0 && value.length <= 256) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw new Error(
    "Target revision must be non-empty text or a non-negative integer.",
  );
}

export function parseOpaqueTargetId(
  value: unknown,
  field = "target ID",
): OpaqueTargetId {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TARGET_ID_LENGTH ||
    /[\p{Cc}\s]/u.test(value)
  ) {
    throw new Error(
      `${field} must be a non-empty opaque ID without whitespace or control bytes.`,
    );
  }
  return value as OpaqueTargetId;
}

export function createTargetSnapshot(
  input: TargetSnapshotInput,
): TargetSnapshot {
  if (!TARGET_KINDS[input.kind])
    throw new Error("Target kind is not supported.");
  if (
    input.interactiveReady !== undefined &&
    typeof input.interactiveReady !== "boolean"
  ) {
    throw new Error("Target interactiveReady must be a boolean when present.");
  }
  if (input.agentStatus !== undefined && !AGENT_STATUSES[input.agentStatus]) {
    throw new Error("Target agentStatus is not supported.");
  }

  const snapshot: TargetSnapshot = {
    kind: input.kind,
    id: parseOpaqueTargetId(input.id),
    revision: parseRevision(input.revision),
    workspaceId: parseOpaqueTargetId(input.workspaceId, "workspace ID"),
    worktreeId: parseOptionalOpaqueTargetId(input.worktreeId, "worktree ID"),
    tabId: parseOptionalOpaqueTargetId(input.tabId, "tab ID"),
    paneId: parseOptionalOpaqueTargetId(input.paneId, "pane ID"),
    agentId: parseOptionalOpaqueTargetId(input.agentId, "agent ID"),
    interactiveReady: input.interactiveReady,
    agentStatus: input.agentStatus,
  };
  assertTargetSnapshotAncestry(snapshot);
  return Object.freeze(snapshot);
}

export function parseTargetSnapshot(value: unknown): TargetSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Target snapshot must be an object.");
  }
  const input = value as Partial<TargetSnapshotInput>;
  return createTargetSnapshot({
    kind: input.kind as TargetKind,
    id: input.id as string,
    revision: input.revision as string | number,
    workspaceId: input.workspaceId as string,
    worktreeId: input.worktreeId as string | undefined,
    tabId: input.tabId as string | undefined,
    paneId: input.paneId as string | undefined,
    agentId: input.agentId as string | undefined,
    interactiveReady: input.interactiveReady,
    agentStatus: input.agentStatus,
  });
}

export function assertTargetSnapshotAncestry(snapshot: TargetSnapshot): void {
  switch (snapshot.kind) {
    case "workspace":
      sameOpaqueId(snapshot.id, snapshot.workspaceId, "workspace ID");
      return;
    case "worktree":
      if (!snapshot.worktreeId)
        throw new Error("Worktree target is missing its worktree ID.");
      sameOpaqueId(snapshot.id, snapshot.worktreeId, "worktree ID");
      return;
    case "tab":
      if (!snapshot.tabId) throw new Error("Tab target is missing its tab ID.");
      sameOpaqueId(snapshot.id, snapshot.tabId, "tab ID");
      return;
    case "pane":
      if (!snapshot.tabId || !snapshot.paneId) {
        throw new Error("Pane target is missing its tab or pane ancestry.");
      }
      sameOpaqueId(snapshot.id, snapshot.paneId, "pane ID");
      return;
    case "agent":
      if (!snapshot.tabId || !snapshot.paneId || !snapshot.agentId) {
        throw new Error(
          "Agent target is missing its tab, pane, or agent ancestry.",
        );
      }
      sameOpaqueId(snapshot.id, snapshot.agentId, "agent ID");
  }
}

export function serializeTargetSnapshot(snapshot: TargetSnapshot): string {
  const parsed = parseTargetSnapshot(snapshot);
  return JSON.stringify({
    kind: parsed.kind,
    id: parsed.id,
    revision: parsed.revision,
    workspaceId: parsed.workspaceId,
    ...(parsed.worktreeId === undefined
      ? {}
      : { worktreeId: parsed.worktreeId }),
    ...(parsed.tabId === undefined ? {} : { tabId: parsed.tabId }),
    ...(parsed.paneId === undefined ? {} : { paneId: parsed.paneId }),
    ...(parsed.agentId === undefined ? {} : { agentId: parsed.agentId }),
    ...(parsed.interactiveReady === undefined
      ? {}
      : { interactiveReady: parsed.interactiveReady }),
    ...(parsed.agentStatus === undefined
      ? {}
      : { agentStatus: parsed.agentStatus }),
  });
}

function assertSameTargetAncestry(
  expected: TargetSnapshot,
  actual: TargetSnapshot,
): TargetSnapshot {
  if (expected.kind !== actual.kind) {
    throw new Error("Target resource kind changed since inspection.");
  }
  sameOpaqueId(expected.id, actual.id, "ID");
  sameOpaqueId(expected.workspaceId, actual.workspaceId, "workspace ID");
  for (const field of ["worktreeId", "tabId", "paneId", "agentId"] as const) {
    sameOpaqueId(expected[field], actual[field], field);
  }
  return actual;
}

export function assertTargetSnapshotFresh(
  expected: TargetSnapshot,
  actual: TargetSnapshot,
): TargetSnapshot {
  const inspected = parseTargetSnapshot(expected);
  const live = assertSameTargetAncestry(inspected, parseTargetSnapshot(actual));
  if (inspected.revision !== live.revision) {
    throw new Error("Target revision changed since inspection.");
  }
  return live;
}

export function assertTargetSnapshotIdentity(
  expected: TargetSnapshot,
  actual: TargetSnapshot,
): TargetSnapshot {
  return assertSameTargetAncestry(
    parseTargetSnapshot(expected),
    parseTargetSnapshot(actual),
  );
}

export function assertAgentInputReady(
  snapshot: TargetSnapshot,
): TargetSnapshot {
  const parsed = parseTargetSnapshot(snapshot);
  if (
    parsed.kind !== "agent" ||
    parsed.interactiveReady !== true ||
    parsed.agentStatus === undefined ||
    parsed.agentStatus === "unknown"
  ) {
    throw new Error(
      "Agent input requires interactiveReady and a known agent status.",
    );
  }
  return parsed;
}

export function assertAgentPrompt(prompt: unknown, maxBytes = 20_000): string {
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error("Agent prompt must be non-empty text.");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Agent prompt byte limit must be a positive integer.");
  }
  if (new TextEncoder().encode(prompt).byteLength > maxBytes) {
    throw new Error(`Agent prompt exceeds ${maxBytes} UTF-8 bytes.`);
  }
  return prompt;
}

export type AgentPromptDelivery = "accepted" | "rejected" | "unknown";

export interface AgentPromptOutcome {
  readonly delivery: AgentPromptDelivery;
  readonly observedStatus: AgentStatus;
}

export interface WorktreeDispatchOutcome {
  readonly workspaceId: OpaqueTargetId;
  readonly worktreeId: OpaqueTargetId;
  readonly worktreePath: string;
  readonly paneId: OpaqueTargetId;
  readonly agentId: OpaqueTargetId;
}

export interface WorktreeDispatchOutcomeInput {
  readonly workspaceId: unknown;
  readonly worktreeId: unknown;
  readonly worktreePath: unknown;
  readonly paneId: unknown;
  readonly agentId: unknown;
}

export interface WorktreeLease {
  readonly taskId: string;
  readonly worktreeId: OpaqueTargetId;
  readonly ownerCorrelationId: string;
}

export interface WorktreeLeaseInput {
  readonly taskId: unknown;
  readonly worktreeId: unknown;
  readonly ownerCorrelationId: unknown;
}

function parseDispatchText(
  value: unknown,
  field: string,
  maxLength = 256,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    /\p{Cc}/u.test(value)
  ) {
    throw new Error(`${field} must be non-empty text without control bytes.`);
  }
  return value;
}

function parseWorktreeLease(input: WorktreeLeaseInput): WorktreeLease {
  return Object.freeze({
    taskId: parseDispatchText(input.taskId, "task ID"),
    worktreeId: parseOpaqueTargetId(input.worktreeId, "worktree ID"),
    ownerCorrelationId: parseDispatchText(
      input.ownerCorrelationId,
      "owner correlation ID",
    ),
  });
}

export function createWorktreeDispatchOutcome(
  input: WorktreeDispatchOutcomeInput,
): WorktreeDispatchOutcome {
  return Object.freeze({
    workspaceId: parseOpaqueTargetId(input.workspaceId, "workspace ID"),
    worktreeId: parseOpaqueTargetId(input.worktreeId, "worktree ID"),
    worktreePath: parseDispatchText(input.worktreePath, "worktree path", 4_096),
    paneId: parseOpaqueTargetId(input.paneId, "pane ID"),
    agentId: parseOpaqueTargetId(input.agentId, "agent ID"),
  });
}

export function createAgentPromptOutcome(
  delivery: AgentPromptDelivery,
  observedStatus: AgentStatus,
): AgentPromptOutcome {
  if (!["accepted", "rejected", "unknown"].includes(delivery)) {
    throw new Error("Agent prompt delivery state is not supported.");
  }
  if (!AGENT_STATUSES[observedStatus]) {
    throw new Error("Agent prompt observed status is not supported.");
  }
  return Object.freeze({ delivery, observedStatus });
}

export class WorktreeLeaseRegistry {
  readonly #byTaskId = new Map<string, WorktreeLease>();
  readonly #byWorktreeId = new Map<OpaqueTargetId, WorktreeLease>();

  acquire(input: WorktreeLeaseInput): WorktreeLease {
    const lease = parseWorktreeLease(input);
    const taskLease = this.#byTaskId.get(lease.taskId);
    const worktreeLease = this.#byWorktreeId.get(lease.worktreeId);
    if (taskLease && taskLease !== worktreeLease) {
      throw new Error("Task already has an active worktree lease.");
    }
    if (worktreeLease && worktreeLease !== taskLease) {
      throw new Error("Worktree already has an active lease.");
    }
    if (taskLease || worktreeLease) {
      if (
        taskLease?.ownerCorrelationId !== lease.ownerCorrelationId ||
        taskLease.worktreeId !== lease.worktreeId
      ) {
        throw new Error(
          "Active worktree lease belongs to another owner correlation.",
        );
      }
      return taskLease;
    }
    this.#byTaskId.set(lease.taskId, lease);
    this.#byWorktreeId.set(lease.worktreeId, lease);
    return lease;
  }

  release(input: WorktreeLeaseInput): WorktreeLease {
    const lease = parseWorktreeLease(input);
    const active = this.#byTaskId.get(lease.taskId);
    if (
      !active ||
      active.worktreeId !== lease.worktreeId ||
      active.ownerCorrelationId !== lease.ownerCorrelationId
    ) {
      throw new Error("No matching active worktree lease exists.");
    }
    this.#byTaskId.delete(active.taskId);
    this.#byWorktreeId.delete(active.worktreeId);
    return active;
  }

  getByTaskId(taskId: unknown): WorktreeLease | undefined {
    return this.#byTaskId.get(parseDispatchText(taskId, "task ID"));
  }

  getByWorktreeId(worktreeId: unknown): WorktreeLease | undefined {
    return this.#byWorktreeId.get(
      parseOpaqueTargetId(worktreeId, "worktree ID"),
    );
  }
}

export interface InspectedTarget<TValue> {
  readonly snapshot: TargetSnapshot;
  readonly value: TValue;
}

export interface InspectedTargetMutation<TMutation, TReadback> {
  readonly expected: TargetSnapshot;
  readonly inspect: () => Promise<InspectedTarget<unknown>>;
  readonly mutate: (live: TargetSnapshot) => Promise<TMutation>;
  readonly readback: () => Promise<InspectedTarget<TReadback>>;
}

export interface InspectedTargetMutationResult<TMutation, TReadback> {
  readonly inspected: TargetSnapshot;
  readonly mutation: TMutation;
  readonly readback: InspectedTarget<TReadback>;
}

export async function runInspectedTargetMutation<TMutation, TReadback>(
  input: InspectedTargetMutation<TMutation, TReadback>,
): Promise<InspectedTargetMutationResult<TMutation, TReadback>> {
  const expected = parseTargetSnapshot(input.expected);
  const inspected = await input.inspect();
  const live = assertTargetSnapshotFresh(expected, inspected.snapshot);
  const mutation = await input.mutate(live);
  const readback = await input.readback();
  assertTargetSnapshotIdentity(live, readback.snapshot);
  return { inspected: live, mutation, readback };
}
