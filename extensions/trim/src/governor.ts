import type { TrimConfig } from "./config.ts";

export const OUTCOMES = [
  "BELOW_THRESHOLD",
  "DEFERRED",
  "NATIVE_COMPACTION_COMMITTED",
  "NATIVE_OUTCOME_OBSERVED",
  "SUPERSEDED_OR_UNKNOWN",
  "HALTED",
] as const;
export type GovernorOutcome = (typeof OUTCOMES)[number];
export interface GovernorInput {
  readonly usageTokens?: number | null;
  readonly settled: boolean;
  readonly idle: boolean;
  readonly pendingMessages: boolean;
  readonly nativeCompacting: boolean;
  readonly requestLatched: boolean;
  readonly nativeAccepted?: boolean;
  readonly revisionAdvanced?: boolean;
  readonly concreteEntry?: boolean;
  readonly terminal?: boolean;
}
export function decide(
  config: TrimConfig,
  input: GovernorInput,
): GovernorOutcome {
  if (input.terminal) return "HALTED";
  if (input.nativeAccepted !== undefined)
    return input.nativeAccepted && input.revisionAdvanced && input.concreteEntry
      ? "NATIVE_COMPACTION_COMMITTED"
      : "NATIVE_OUTCOME_OBSERVED";
  if (
    typeof input.usageTokens === "number" &&
    Number.isFinite(input.usageTokens) &&
    input.usageTokens < config.thresholdTokens
  )
    return "BELOW_THRESHOLD";
  return "DEFERRED";
}

export function shouldSchedule(
  config: TrimConfig,
  input: GovernorInput,
): boolean {
  return (
    !input.terminal &&
    config.strategy === "settled" &&
    input.settled &&
    input.idle &&
    !input.pendingMessages &&
    !input.nativeCompacting &&
    !input.requestLatched &&
    typeof input.usageTokens === "number" &&
    Number.isFinite(input.usageTokens) &&
    input.usageTokens >= config.thresholdTokens
  );
}

export interface WorkBoundary {
  readonly sessionId: string;
  readonly leafId: string | null;
  readonly revision: number;
}
export interface GovernorAttempt {
  readonly generation: symbol;
  readonly source: WorkBoundary;
}
type RequestPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "pending"; readonly attempt: GovernorAttempt }
  | { readonly phase: "halted" };
export interface GovernorState {
  readonly generation: symbol;
  readonly request: RequestPhase;
  readonly lastAttempt: WorkBoundary | null;
  readonly durableResult: {
    readonly entryId: string;
    readonly boundary: WorkBoundary;
  } | null;
  readonly hookOutcome: GovernorOutcome;
  readonly continuation: "UNKNOWN" | "HOST_OWNED" | "RETRY_EXPECTED" | "HALTED";
}
export interface NativeObservation {
  readonly attempt: GovernorAttempt;
  readonly current: WorkBoundary;
  readonly accepted: boolean;
  // Adapter supplies ID only after verifying concrete entry on active branch.
  readonly entryId: string | null;
  readonly sourceLeafRetained: boolean;
  readonly willRetry: boolean;
}

export function createGovernorState(): GovernorState {
  return {
    generation: Symbol(),
    request: { phase: "idle" },
    lastAttempt: null,
    durableResult: null,
    hookOutcome: "DEFERRED",
    continuation: "UNKNOWN",
  };
}

export function beginAttempt(
  state: GovernorState,
  source: WorkBoundary,
): GovernorState {
  switch (state.request.phase) {
    case "halted":
    case "pending":
      return state;
    case "idle": {
      const previous = state.lastAttempt;
      if (
        previous?.sessionId === source.sessionId &&
        previous.leafId === source.leafId &&
        previous.revision === source.revision
      )
        return state;
      const generation = Symbol();
      const snapshot = { ...source };
      return {
        ...state,
        generation,
        request: {
          phase: "pending",
          attempt: { generation, source: snapshot },
        },
        lastAttempt: snapshot,
        hookOutcome: "DEFERRED",
        continuation: "UNKNOWN",
      };
    }
    default:
      return assertNever(state.request);
  }
}

function isCurrent(state: GovernorState, attempt: GovernorAttempt): boolean {
  switch (state.request.phase) {
    case "idle":
    case "halted":
      return false;
    case "pending":
      return (
        state.generation === attempt.generation &&
        state.request.attempt === attempt
      );
    default:
      return assertNever(state.request);
  }
}

export function observeNative(
  state: GovernorState,
  observation: NativeObservation,
): GovernorState {
  const { attempt, current, accepted, entryId, sourceLeafRetained, willRetry } =
    observation;
  if (!isCurrent(state, attempt)) return state;
  const committed =
    accepted &&
    entryId !== null &&
    sourceLeafRetained &&
    current.sessionId === attempt.source.sessionId &&
    current.revision > attempt.source.revision;
  return {
    ...state,
    durableResult: committed
      ? { entryId, boundary: { ...current } }
      : state.durableResult,
    // Compaction's own revision/leaf change is not fresh user work.
    lastAttempt: committed ? { ...current } : state.lastAttempt,
    hookOutcome: committed
      ? "NATIVE_COMPACTION_COMMITTED"
      : "NATIVE_OUTCOME_OBSERVED",
    continuation: willRetry ? "RETRY_EXPECTED" : "HOST_OWNED",
  };
}

export function finishAttempt(
  state: GovernorState,
  attempt: GovernorAttempt,
): GovernorState {
  if (!isCurrent(state, attempt)) return state;
  return {
    ...state,
    request: { phase: "idle" },
    hookOutcome:
      state.hookOutcome === "DEFERRED"
        ? "NATIVE_OUTCOME_OBSERVED"
        : state.hookOutcome,
  };
}

// Safe-boundary reconciliation or tree/session invalidation; never starts retry.
export function invalidateGovernor(
  state: GovernorState,
  terminal = false,
): GovernorState {
  switch (state.request.phase) {
    case "halted":
      return state;
    case "idle":
    case "pending":
      return {
        ...state,
        generation: Symbol(),
        request: { phase: terminal ? "halted" : "idle" },
        hookOutcome: terminal ? "HALTED" : "SUPERSEDED_OR_UNKNOWN",
        continuation: terminal ? "HALTED" : "UNKNOWN",
      };
    default:
      return assertNever(state.request);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected governor request: ${String(value)}`);
}
