import { spawn } from "node:child_process";
import type { AgentToolResult, ExtensionAPI } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import {
  buildCapabilityArgv,
  capabilitiesForDiscovery,
  discoverHerdrCapabilities,
  getCapability,
  type CapabilityDefinition,
  type HerdrDiscovery,
} from "./capabilities.ts";
import {
  APPROVAL_LIMITATION,
  ApprovalRegistry,
  type ApprovalRequest,
} from "./approval.ts";
import { PREVIEW_UNAVAILABLE } from "./preview.ts";
import { boundedHerdrOutput, type HerdrRunner } from "./runner.ts";
import {
  assertTargetSnapshotFresh,
  assertTargetSnapshotIdentity,
  parseTargetSnapshot,
  type TargetKind,
  type TargetSnapshot,
} from "./targets.ts";
export function requireHerdrEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.HERDR_ENV !== "1" || !env.HERDR_PANE_ID) {
    throw new Error(
      "Herdr operation requires a Herdr-managed pane (HERDR_ENV=1 and HERDR_PANE_ID).",
    );
  }
}

export type R12Status =
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled"
  | "unknown"
  | "unavailable";
export interface R12Result {
  readonly capabilityId: string;
  readonly correlationId: string;
  readonly stage: string;
  readonly exitCode: number | null;
  readonly output: string;
  readonly targetSnapshot?: TargetSnapshot;
  readonly readback?: unknown;
  readonly status: R12Status;
  readonly retrySafety: "safe" | "unsafe" | "unknown";
  readonly nextSafeAction: string;
}
const inspectSchema = Type.Object(
  {
    capabilityId: Type.String({ minLength: 1 }),
    input: Type.Optional(Type.Unknown()),
    correlationId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
const capabilitySchema = Type.Object(
  { intent: Type.Optional(Type.String({ maxLength: 256 })) },
  { additionalProperties: false },
);
const querySchema = inspectSchema;
const operationSchema = Type.Object(
  {
    capabilityId: Type.String({ minLength: 1 }),
    input: Type.Optional(Type.Unknown()),
    correlationId: Type.String({ minLength: 1, maxLength: 256 }),
    targetSnapshot: Type.Unknown(),
    approvalNonce: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    taskId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    ownerCorrelationId: Type.Optional(
      Type.String({ minLength: 1, maxLength: 256 }),
    ),
  },
  { additionalProperties: false },
);
const approvalSchema = Type.Object(
  {
    action: Type.Union([
      Type.Literal("request"),
      Type.Literal("confirm"),
      Type.Literal("cancel"),
    ]),
    capabilityId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1, maxLength: 256 }),
    input: Type.Optional(Type.Unknown()),
    targetSnapshot: Type.Unknown(),
    nonce: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  },
  { additionalProperties: false },
);
const previewSchema = Type.Object({}, { additionalProperties: false });
function envelope(
  input: Partial<R12Result> &
    Pick<R12Result, "capabilityId" | "correlationId" | "stage">,
): R12Result {
  return {
    exitCode: null,
    output: "",
    status: "unknown",
    retrySafety: "unknown",
    nextSafeAction: "Inspect returned state before any retry.",
    ...input,
  };
}
function textResult(result: R12Result): AgentToolResult<R12Result> {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    details: result,
  };
}
interface HerdrToolOptions {
  readonly runner?: HerdrRunner;
  readonly approvals?: ApprovalRegistry;
  readonly env?: NodeJS.ProcessEnv;
  readonly discovery?: () => Promise<HerdrDiscovery>;
}

const spawnHerdr: HerdrRunner = (argv, signal) => {
  const { promise, reject, resolve } =
    Promise.withResolvers<Awaited<ReturnType<HerdrRunner>>>();
  const child = spawn(argv[0], argv.slice(1), {
    signal,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  let capturedBytes = 0;
  let truncated = false;
  const collect = (chunk: Buffer) => {
    const remaining = 20_000 - capturedBytes;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    if (chunk.byteLength > remaining) truncated = true;
    chunks.push(chunk.subarray(0, remaining));
    capturedBytes += Math.min(chunk.byteLength, remaining);
  };

  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("error", reject);
  child.on("close", (code) =>
    resolve({
      exitCode: code ?? 1,
      ...boundedHerdrOutput(chunks, truncated),
    }),
  );
  return promise;
};

async function discovery(
  run: HerdrRunner = spawnHerdr,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HerdrDiscovery> {
  return discoverHerdrCapabilities(async (argv) => {
    const result = await run(argv);
    return {
      exitCode: result.exitCode,
      output: result.output,
      truncated: result.truncated,
    };
  }, env.HERDR_BIN_PATH || "herdr");
}

export function decodeHerdrTargetReadback(
  output: string,
  kind: TargetKind,
): TargetSnapshot {
  let envelope: unknown;
  try {
    envelope = JSON.parse(output);
  } catch {
    throw new Error("Herdr target readback is not valid JSON.");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    throw new Error("Herdr target readback must be an object wrapper.");
  const result = (envelope as Record<string, unknown>).result;
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Herdr target readback is missing result.");
  if (kind === "agent") {
    throw new Error(
      "Herdr 0.9.1 agent readback does not prove opaque agent identity; agent target decoder unavailable.",
    );
  }
  const resourceKey = kind;
  const resource = (result as Record<string, unknown>)[resourceKey];
  if (!resource || typeof resource !== "object" || Array.isArray(resource))
    throw new Error(`Herdr target readback is missing result.${resourceKey}.`);
  const value = resource as Record<string, unknown>;
  const required = (field: string): unknown => {
    const candidate = value[field];
    if (candidate === undefined || candidate === null)
      throw new Error(`Herdr ${kind} readback is missing ${field}.`);
    return candidate;
  };
  const text = (field: string): string => {
    const candidate = required(field);
    if (typeof candidate !== "string")
      throw new Error(`Herdr ${kind} readback field ${field} must be text.`);
    return candidate;
  };
  const revisionValue = required("revision");
  const revision: string | number =
    typeof revisionValue === "string"
      ? revisionValue
      : typeof revisionValue === "number" &&
          Number.isSafeInteger(revisionValue) &&
          revisionValue >= 0
        ? revisionValue
        : (() => {
            throw new Error(
              `Herdr ${kind} readback revision must be text or a non-negative integer.`,
            );
          })();
  const workspaceId = text("workspace_id");
  if (kind === "workspace") {
    return parseTargetSnapshot({
      kind,
      id: workspaceId,
      revision,
      workspaceId,
    });
  }
  if (kind === "pane") {
    const paneId = text("pane_id");
    const tabId = text("tab_id");
    return parseTargetSnapshot({
      kind,
      id: paneId,
      revision,
      workspaceId,
      tabId,
      paneId,
    });
  }
  throw new Error(`Herdr ${kind} readback decoder is unavailable.`);
}

function targetGetArgv(target: TargetSnapshot): readonly string[] {
  switch (target.kind) {
    case "workspace":
      return ["workspace", "get", target.workspaceId];
    case "worktree":
      throw new Error("Herdr 0.9.1 has no typed worktree get primitive.");
    case "tab":
      return ["tab", "get", target.tabId ?? target.id];
    case "pane":
      return ["pane", "get", target.paneId ?? target.id];
    case "agent":
      return ["agent", "get", target.agentId ?? target.id];
  }
}
function filtered(
  values: readonly CapabilityDefinition[],
  intent?: string,
): readonly CapabilityDefinition[] {
  return intent
    ? values.filter(
        (value) => value.domain === intent || value.id.includes(intent),
      )
    : values;
}

export function registerHerdrTools(
  pi: Pick<ExtensionAPI, "registerTool">,
  options: HerdrToolOptions = {},
): void {
  const run = options.runner ?? spawnHerdr;
  const approvals = options.approvals ?? new ApprovalRegistry();
  const env = options.env ?? process.env;
  const discover = options.discovery ?? (() => discovery(run, env));

  const executeRead = async (
    params: { capabilityId: string; input?: unknown; correlationId: string },
    signal: AbortSignal | undefined,
  ): Promise<AgentToolResult<R12Result>> => {
    const found = getCapability(params.capabilityId, await discover());
    if (found?.safety !== "observe")
      return textResult(
        envelope({
          capabilityId: params.capabilityId,
          correlationId: params.correlationId,
          stage: "query",
          status: "unavailable",
          nextSafeAction:
            "Call herdr_capabilities and choose available observe capability.",
        }),
      );
    try {
      const result = await run(
        [
          env.HERDR_BIN_PATH || "herdr",
          ...buildCapabilityArgv(found, params.input ?? {}),
        ],
        signal,
      );
      return textResult(
        envelope({
          capabilityId: found.id,
          correlationId: params.correlationId,
          stage: "query",
          exitCode: result.exitCode,
          output: result.output,
          status: result.exitCode === 0 ? "completed" : "failed",
          retrySafety: "safe",
        }),
      );
    } catch (error) {
      return textResult(
        envelope({
          capabilityId: found.id,
          correlationId: params.correlationId,
          stage: "query",
          status: "failed",
          nextSafeAction:
            error instanceof Error ? error.message : "Fix typed input.",
        }),
      );
    }
  };
  pi.registerTool({
    name: "herdr_inspect",
    label: "Inspect Herdr",
    description:
      "Run one discovered read-only Herdr capability with typed input. No raw commands or argv.",
    promptSnippet: "Inspect Herdr through typed read-only capabilities.",
    parameters: inspectSchema,
    executionMode: "sequential",
    async execute(_id, params, signal) {
      return executeRead(params, signal);
    },
  });
  pi.registerTool({
    name: "herdr_capabilities",
    label: "Herdr Capabilities",
    description:
      "Discover Herdr version and typed capability availability. Mismatches fail closed.",
    promptSnippet: "Discover typed Herdr capabilities.",
    parameters: capabilitySchema,
    executionMode: "sequential",
    async execute(_id, params) {
      const current = await discover();
      return textResult(
        envelope({
          capabilityId: "herdr.capabilities",
          correlationId: "discovery",
          stage: "discover",
          exitCode: 0,
          output: JSON.stringify({
            version: current.version,
            commandPaths: current.commandPaths,
          }),
          readback: filtered(capabilitiesForDiscovery(current), params.intent),
          status: "completed",
          retrySafety: "safe",
          nextSafeAction: "Use only available typed capability IDs.",
        }),
      );
    },
  });
  pi.registerTool({
    name: "herdr_query",
    label: "Query Herdr",
    description: "Execute available read-only typed Herdr capability.",
    promptSnippet: "Query Herdr with typed capability input.",
    parameters: querySchema,
    executionMode: "sequential",
    async execute(_id, params, signal) {
      return executeRead(params, signal);
    },
  });
  pi.registerTool({
    name: "herdr_operation",
    label: "Herdr Operation",
    description:
      "Run one mapped routine or high-impact operation after target inspection and validation.",
    promptSnippet: "Operate Herdr only through typed, inspected capabilities.",
    parameters: operationSchema,
    executionMode: "sequential",
    async execute(_id, params, signal) {
      const found = getCapability(params.capabilityId, await discover());
      if (found?.availability !== "available" || found.safety === "observe")
        return textResult(
          envelope({
            capabilityId: params.capabilityId,
            correlationId: params.correlationId,
            stage: "operation",
            status: "unavailable",
            nextSafeAction:
              "Choose available routine or high-impact capability.",
          }),
        );
      try {
        requireHerdrEnvironment(env);
        const expected = parseTargetSnapshot(params.targetSnapshot);
        const targetArgv = targetGetArgv(expected);
        const inspectedResult = await run(
          [env.HERDR_BIN_PATH || "herdr", ...targetArgv],
          signal,
        );
        if (inspectedResult.exitCode !== 0)
          throw new Error("Target inspection failed; mutation not attempted.");
        const inspected = decodeHerdrTargetReadback(
          inspectedResult.output,
          expected.kind,
        );
        const live = assertTargetSnapshotFresh(expected, inspected);
        if (found.safety === "high-impact") {
          if (!params.approvalNonce)
            return textResult(
              envelope({
                capabilityId: found.id,
                correlationId: params.correlationId,
                stage: "approval",
                status: "failed",
                nextSafeAction: APPROVAL_LIMITATION,
              }),
            );
          approvals.consume(
            {
              capabilityId: found.id,
              correlationId: params.correlationId,
              parameters: params.input ?? {},
              target: live,
            },
            params.approvalNonce,
          );
        }
        const result = await run(
          [
            env.HERDR_BIN_PATH || "herdr",
            ...buildCapabilityArgv(found, params.input ?? {}),
          ],
          signal,
        );
        const readbackResult = await run(
          [env.HERDR_BIN_PATH || "herdr", ...targetGetArgv(live)],
          signal,
        );
        if (readbackResult.exitCode !== 0)
          throw new Error("Post-mutation target readback failed.");
        const readback = decodeHerdrTargetReadback(
          readbackResult.output,
          live.kind,
        );
        assertTargetSnapshotIdentity(live, readback);
        return textResult(
          envelope({
            capabilityId: found.id,
            correlationId: params.correlationId,
            stage: "operation",
            exitCode: result.exitCode,
            output: result.output,
            targetSnapshot: live,
            readback,
            status: result.exitCode === 0 ? "completed" : "failed",
            retrySafety: "unsafe",
          }),
        );
      } catch (error) {
        return textResult(
          envelope({
            capabilityId: found.id,
            correlationId: params.correlationId,
            stage: "operation",
            status: "failed",
            retrySafety: "unsafe",
            nextSafeAction:
              error instanceof Error
                ? error.message
                : "Inspect target and retry safely.",
          }),
        );
      }
    },
  });
  pi.registerTool({
    name: "herdr_approval",
    label: "Herdr Approval",
    description: `Create, confirm, or cancel in-memory approval. ${APPROVAL_LIMITATION}.`,
    promptSnippet:
      "Manage non-authoritative agent-mediated operation approval.",
    parameters: approvalSchema,
    executionMode: "sequential",
    async execute(_id, params) {
      try {
        const request: ApprovalRequest = {
          capabilityId: params.capabilityId,
          correlationId: params.correlationId,
          parameters: params.input ?? {},
          target: parseTargetSnapshot(params.targetSnapshot),
        };
        const record =
          params.action === "request"
            ? approvals.request(request)
            : params.action === "confirm"
              ? approvals.confirm(request, params.nonce ?? "")
              : approvals.cancel(request, params.nonce ?? "");
        return textResult(
          envelope({
            capabilityId: params.capabilityId,
            correlationId: params.correlationId,
            stage: "approval",
            exitCode: 0,
            output: JSON.stringify(record),
            readback: record,
            status: "completed",
            retrySafety: "safe",
            nextSafeAction:
              "Use nonce once with unchanged target and parameters.",
          }),
        );
      } catch (error) {
        return textResult(
          envelope({
            capabilityId: params.capabilityId,
            correlationId: params.correlationId,
            stage: "approval",
            status: "failed",
            nextSafeAction:
              error instanceof Error ? error.message : APPROVAL_LIMITATION,
          }),
        );
      }
    },
  });
  pi.registerTool({
    name: "herdr_preview",
    label: "Herdr Preview Availability",
    description:
      "Report that Preview is unavailable until terminal-browser rendering in a Herdr Preview tab is independently verified.",
    promptSnippet:
      "Preview unavailable pending independent terminal-browser and Herdr Preview rendering verification.",
    parameters: previewSchema,
    executionMode: "sequential",
    async execute() {
      return textResult(
        envelope({
          capabilityId: "herdr.preview",
          correlationId: "preview",
          stage: "availability",
          exitCode: null,
          output: JSON.stringify(PREVIEW_UNAVAILABLE),
          status: "unavailable",
          retrySafety: "unknown",
          nextSafeAction: PREVIEW_UNAVAILABLE.reason,
        }),
      );
    },
  });
}
