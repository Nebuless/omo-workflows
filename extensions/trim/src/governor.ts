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
