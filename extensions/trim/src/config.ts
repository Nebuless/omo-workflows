import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
function isConfig(value: unknown): value is TrimConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const { strategy, thresholdTokens } = value as Record<string, unknown>;
  return (
    STRATEGIES.includes(strategy as TrimStrategy) &&
    typeof thresholdTokens === "number" &&
    Number.isSafeInteger(thresholdTokens) &&
    thresholdTokens >= 1
  );
}

function parse(value: unknown): TrimConfig {
  return isConfig(value) ? value : DEFAULT_CONFIG;
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
  if (!isConfig(config))
    throw new TypeError(
      "Trim policy requires a supported strategy and positive safe integer threshold.",
    );
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    renameSync(temporary, path);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Trim policy save and cleanup failed.",
      );
    }
    throw error;
  }
}
