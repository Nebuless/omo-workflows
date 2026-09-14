import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@code-yeongyu/senpi";

export const STRATEGIES = ["native", "settled", "manual"] as const;
export type TrimStrategy = (typeof STRATEGIES)[number];
export interface TrimConfig {
  readonly strategy: TrimStrategy;
  readonly thresholdTokens: number;
}
const DEFAULT_CONFIG: TrimConfig = {
  strategy: "native",
  thresholdTokens: 100000,
};
const pathFor = (): string => join(getAgentDir(), "trim.json");
function parse(value: unknown): TrimConfig {
  if (typeof value !== "object" || value === null) return DEFAULT_CONFIG;
  const record = value as Record<string, unknown>;
  const strategy = record.strategy;
  const thresholdTokens = record.thresholdTokens;
  if (
    !STRATEGIES.includes(strategy as TrimStrategy) ||
    typeof thresholdTokens !== "number" ||
    !Number.isInteger(thresholdTokens) ||
    thresholdTokens < 1
  )
    return DEFAULT_CONFIG;
  return { strategy: strategy as TrimStrategy, thresholdTokens };
}
export function loadConfig(path = pathFor()): TrimConfig {
  try {
    return parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && "code" in error)
    )
      return DEFAULT_CONFIG;
    throw error;
  }
}
export function saveConfig(config: TrimConfig, path = pathFor()): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}
