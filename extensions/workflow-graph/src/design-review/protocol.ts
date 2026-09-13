import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const LiveEventSchema = Type.Object(
  {
    type: Type.String(),
    id: Type.Optional(Type.String()),
    variant: Type.Optional(Type.Number()),
    variantId: Type.Optional(Type.String()),
    url: Type.Optional(Type.String()),
    pageUrl: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    file: Type.Optional(Type.String()),
    sourceFile: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    data: Type.Optional(Type.Unknown()),
    screenshot: Type.Optional(Type.String()),
    raw: Type.String(),
  },
  { additionalProperties: true },
);
export type LiveEvent = Static<typeof LiveEventSchema> & {
  readonly data?: JsonValue;
};

export const ModelEventResultSchema = Type.Object(
  {
    file: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    data: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);
export type ModelEventResult = Static<typeof ModelEventResultSchema> & {
  readonly data?: JsonValue;
};

export type ProcessResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};
export type ProcessRunner = (
  script: string,
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
) => Promise<ProcessResult>;

const MODEL_EVENT_TYPES = new Set([
  "generate",
  "steer",
  "manual_edit_apply",
  "variant_mount_failed",
]);
const LEGACY_REPLY_STATUSES = new Set([
  "done",
  "error",
  "complete",
  "discard",
  "discarded",
]);
const MAX_HELPER_OUTPUT_BYTES = 1024 * 1024;

export function needsModel(event: LiveEvent): boolean {
  return MODEL_EVENT_TYPES.has(event.type);
}

export function replyToken(event: LiveEvent): "done" | "steer_done" {
  return event.type === "steer" ? "steer_done" : "done";
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === "object" && Object.values(value).every(isJsonValue);
}

function checkedEvent(value: unknown, raw?: string): LiveEvent {
  const candidate =
    typeof value === "object" && value !== null && raw !== undefined
      ? { ...value, raw }
      : value;
  if (!Value.Check(LiveEventSchema, candidate))
    throw new Error("Live helper returned an invalid event.");
  if (candidate.data !== undefined && !isJsonValue(candidate.data))
    throw new Error("Live helper returned non-JSON event data.");
  return candidate as LiveEvent;
}

/** Upstream compatibility: unreadable successful poll output is an idle timeout, never terminal. */
export function parseEvent(stdout: string): LiveEvent {
  const lines = stdout.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const raw = lines[index]?.trim() ?? "";
    if (!raw.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as { type?: unknown }).type === "string"
      )
        return checkedEvent(parsed, raw);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Live helper returned")
      )
        throw error;
    }
  }
  return { type: "timeout", raw: stdout };
}

function abortError(): Error {
  return new DOMException("Live helper operation aborted.", "AbortError");
}

export function runHelperProcess(
  script: string,
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
  onSpawn?: (child: ChildProcess) => void,
): Promise<ProcessResult> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, GH_PAGER: "cat" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let aborted = false;
    let overflow: "stdout" | "stderr" | undefined;
    let settled = false;
    const onAbort = (): void => {
      aborted = true;
      child.kill("SIGTERM");
    };
    const collect = (stream: "stdout" | "stderr", chunk: Buffer): void => {
      if (overflow !== undefined) return;
      if (
        Buffer.byteLength(stdout) +
          Buffer.byteLength(stderr) +
          chunk.byteLength >
        MAX_HELPER_OUTPUT_BYTES
      ) {
        overflow = stream;
        child.kill("SIGTERM");
        return;
      }
      if (stream === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      reject(aborted ? abortError() : error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (aborted) reject(abortError());
      else if (overflow !== undefined)
        reject(
          new Error(
            `Live helper ${overflow} exceeded ${MAX_HELPER_OUTPUT_BYTES} bytes.`,
          ),
        );
      else
        resolve({
          code: code ?? -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
    });
    onSpawn?.(child);
    if (signal?.aborted) onAbort();
  });
}

export type LiveBootstrap = { readonly ok: true; readonly raw: JsonValue };
export type LiveBootstrapper = (input: {
  readonly target: string;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
}) => Promise<LiveBootstrap>;

export type LiveHelperTransport = {
  readonly poll: (signal?: AbortSignal) => Promise<LiveEvent>;
  readonly reply: (
    event: LiveEvent,
    result: ModelEventResult,
    signal?: AbortSignal,
  ) => Promise<void>;
};

export async function createLiveHelperTransport(input: {
  readonly script: string;
  readonly cwd: string;
  readonly run?: ProcessRunner;
}): Promise<LiveHelperTransport> {
  try {
    await access(input.script, constants.R_OK);
  } catch {
    throw new Error(
      `Impeccable live helper unavailable at ${input.script}; install or bundle it before starting design review.`,
    );
  }
  const run = input.run ?? runHelperProcess;
  const execute = async (
    args: readonly string[],
    operation: string,
    signal?: AbortSignal,
  ): Promise<ProcessResult> => {
    const result = await run(input.script, args, input.cwd, signal);
    if (result.code !== 0)
      throw new Error(
        `${operation} failed with exit code ${result.code}${result.stderr ? `: ${result.stderr}` : ""}`,
      );
    return result;
  };
  return {
    poll: async (signal) =>
      parseEvent((await execute([], "Live poll", signal)).stdout),
    reply: async (untrustedEvent, untrustedResult, signal) => {
      const event = checkedEvent(untrustedEvent);
      if (
        !Value.Check(ModelEventResultSchema, untrustedResult) ||
        (untrustedResult.data !== undefined &&
          !isJsonValue(untrustedResult.data))
      )
        throw new Error("Live model result is invalid.");
      const result = untrustedResult as ModelEventResult;
      if (
        !event.id ||
        event.id.startsWith("--") ||
        LEGACY_REPLY_STATUSES.has(event.id)
      )
        throw new Error(`Live ${event.type} event is missing a valid id.`);
      const args = ["--reply", event.id, replyToken(event)];
      const file = result.file ?? event.file;
      const message = result.message ?? event.message;
      const data = result.data ?? event.data;
      if (file !== undefined) args.push("--file", file);
      if (data !== undefined) args.push("--data", JSON.stringify(data));
      if (message !== undefined) args.push(message);
      await execute(args, "Live reply", signal);
    },
  };
}

export async function createLiveBootstrapper(input: {
  readonly script: string;
  readonly cwd: string;
  readonly run?: ProcessRunner;
}): Promise<LiveBootstrapper> {
  try {
    await access(input.script, constants.R_OK);
  } catch {
    throw new Error(
      `Impeccable live bootstrap unavailable at ${input.script}; install or bundle it before starting design review.`,
    );
  }
  const run = input.run ?? runHelperProcess;
  return async ({ target, signal }) => {
    const result = await run(
      input.script,
      ["--target", target],
      input.cwd,
      signal,
    );
    if (result.code !== 0)
      throw new Error(
        `Live bootstrap failed with exit code ${result.code}${result.stderr ? `: ${result.stderr}` : ""}`,
      );
    let value: unknown;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      throw new Error("Live bootstrap returned invalid JSON.");
    }
    if (
      typeof value !== "object" ||
      value === null ||
      (value as { ok?: unknown }).ok !== true ||
      !isJsonValue(value)
    ) {
      const reason =
        typeof value === "object" &&
        value !== null &&
        typeof (value as { error?: unknown }).error === "string"
          ? `: ${(value as { error: string }).error}`
          : "";
      throw new Error(`Live bootstrap did not start a review${reason}`);
    }
    return { ok: true, raw: value };
  };
}
