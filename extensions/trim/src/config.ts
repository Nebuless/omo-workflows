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
  strategy: "settled",
  thresholdTokens: 100000,
};
const pathFor = (): string => join(getAgentDir(), "trim.json");

export class InvalidTrimConfigError extends TypeError {
  readonly name = "InvalidTrimConfigError";
  constructor(readonly value: unknown) {
    super(
      "Trim policy requires a supported strategy and a positive safe integer threshold.",
    );
  }
}

// ponytail: two native fields; use a schema library if the persisted format grows.
export function parseConfig(value: unknown): TrimConfig {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("strategy" in value) ||
    !("thresholdTokens" in value)
  )
    throw new InvalidTrimConfigError(value);
  const { strategy, thresholdTokens } = value;
  if (
    (strategy !== "native" &&
      strategy !== "settled" &&
      strategy !== "manual") ||
    typeof thresholdTokens !== "number" ||
    !Number.isSafeInteger(thresholdTokens) ||
    thresholdTokens < 1
  )
    throw new InvalidTrimConfigError(value);
  return { strategy, thresholdTokens };
}
export function loadConfig(path = pathFor()): TrimConfig {
  try {
    return parseConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (
      error instanceof InvalidTrimConfigError ||
      error instanceof SyntaxError ||
      (error instanceof Error && "code" in error)
    )
      return DEFAULT_CONFIG;
    throw error;
  }
}
// Callers publish returned policy, never draft, after persistence succeeds.
export function saveConfig(candidate: unknown, path = pathFor()): TrimConfig {
  const config = parseConfig(candidate);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
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
  return config;
}
