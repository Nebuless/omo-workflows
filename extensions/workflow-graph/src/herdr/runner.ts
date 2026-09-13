import { spawn } from "node:child_process";
import type { HerdrObserverRunner } from "./observer.ts";

export type HerdrCommandResult = {
  readonly code: number;
  readonly output: string;
};

export type HerdrCommandRunner = (
  argv: readonly string[],
) => Promise<HerdrCommandResult>;

type JsonObject = Readonly<Record<string, unknown>>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringAt(value: unknown, path: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    const next = object(current)?.[key];
    if (next === undefined) return undefined;
    current = next;
  }
  return typeof current === "string" && current.length > 0
    ? current
    : undefined;
}

function parseResponse(output: string): JsonObject {
  for (const line of output.trim().split("\n").reverse()) {
    try {
      const parsed = object(JSON.parse(line));
      if (parsed !== undefined) return parsed;
    } catch {}
  }
  throw new Error("Herdr returned no structured response.");
}

function validatePaneArg(value: string): void {
  if (value.length === 0 || value.includes("\0")) {
    throw new Error("Herdr pane ID must be non-empty text without NUL bytes.");
  }
}

export function isHerdrPaneEnvironment(env: NodeJS.ProcessEnv): boolean {
  return (
    env.HERDR_ENV === "1" &&
    typeof env.HERDR_PANE_ID === "string" &&
    env.HERDR_PANE_ID.length > 0
  );
}

export const spawnHerdrCommand: HerdrCommandRunner = (argv) =>
  new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        output: Buffer.concat(chunks).toString("utf8"),
      }),
    );
  });

export function createHerdrObserverRunner(
  env: NodeJS.ProcessEnv,
  run: HerdrCommandRunner = spawnHerdrCommand,
): HerdrObserverRunner | undefined {
  if (!isHerdrPaneEnvironment(env)) return undefined;
  const binary = env.HERDR_BIN_PATH || "herdr";

  async function invoke(args: readonly string[]): Promise<JsonObject> {
    const result = await run([binary, ...args]);
    if (result.code !== 0) throw new Error("Herdr command failed.");
    return parseResponse(result.output);
  }

  return {
    async splitPane(input) {
      validatePaneArg(input.paneId);
      const envArgs = Object.entries(input.env).flatMap(([key, value]) => [
        "--env",
        `${key}=${value}`,
      ]);
      const response = await invoke([
        "pane",
        "split",
        "--pane",
        input.paneId,
        "--direction",
        input.direction,
        "--ratio",
        "0.4",
        "--cwd",
        input.cwd,
        ...envArgs,
        "--no-focus",
      ]);
      const paneId =
        stringAt(response, ["result", "pane", "pane_id"]) ??
        stringAt(response, ["pane", "pane_id"]);
      if (paneId === undefined)
        throw new Error("Herdr split response omitted pane ID.");
      return { paneId };
    },
    async runPane(input) {
      validatePaneArg(input.paneId);
      if (
        input.argv.length === 0 ||
        input.argv.some((arg) => arg.length === 0 || arg.includes("\0"))
      ) {
        throw new Error(
          "Viewer command must be argv without empty or NUL arguments.",
        );
      }
      const result = await run([
        binary,
        "pane",
        "run",
        input.paneId,
        ...input.argv,
      ]);
      if (result.code !== 0) throw new Error("Herdr viewer failed to start.");
    },
    async closePane(paneId) {
      validatePaneArg(paneId);
      const result = await run([binary, "pane", "close", paneId]);
      if (result.code !== 0)
        throw new Error("Herdr viewer pane failed to close.");
    },
    async paneExists(paneId) {
      validatePaneArg(paneId);
      const result = await run([binary, "pane", "get", paneId]);
      return result.code === 0;
    },
  };
}
