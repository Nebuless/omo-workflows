import { spawn } from "node:child_process";
import type { AgentToolResult, ExtensionAPI } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import {
  buildCapabilityArgv,
  capabilitiesForDiscovery,
  discoverHerdrCapabilities,
  getCapability,
  HERDR_EXTERNAL_AGENT_PROFILES,
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
  readonly truncated: boolean;
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
    truncated: false,
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
    const status = value.agent_status;
    const stateChangeSeq = value.state_change_seq;
    const agentStatus =
      status === "idle" ||
      status === "working" ||
      status === "blocked" ||
      status === "done" ||
      status === "unknown"
        ? status
        : undefined;
    return parseTargetSnapshot({
      kind,
      id: paneId,
      revision,
      workspaceId,
      tabId,
      paneId,
      ...(agentStatus === undefined ? {} : { agentStatus }),
      ...(stateChangeSeq === undefined ? {} : { stateChangeSeq }),
      ...(typeof value.interactive_ready === "boolean"
        ? { interactiveReady: value.interactive_ready }
        : {}),
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

function inputPaneId(input: unknown): string | undefined {
  return input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    typeof (input as Record<string, unknown>).paneId === "string"
    ? (input as Record<string, string>).paneId
    : undefined;
}

function proveAgentStart(
  output: string,
  pane: TargetSnapshot,
  input: unknown,
): {
  readonly name: string;
  readonly kind: string;
  readonly paneId: string;
  readonly interactiveReady: boolean;
} {
  if (pane.kind !== "pane")
    throw new Error("Agent start readback does not identify a pane.");
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error(
      "Agent start result is not valid JSON; agent identity is unknown.",
    );
  }
  const result =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).result
      : undefined;
  const agent =
    result && typeof result === "object"
      ? (result as Record<string, unknown>).agent
      : undefined;
  const profile =
    input &&
    typeof input === "object" &&
    (input as Record<string, unknown>).profile
      ? HERDR_EXTERNAL_AGENT_PROFILES[
          (input as { profile: keyof typeof HERDR_EXTERNAL_AGENT_PROFILES })
            .profile
        ]
      : undefined;
  const name =
    profile?.name ??
    (input && typeof input === "object"
      ? (input as Record<string, unknown>).name
      : undefined);
  const kind =
    profile?.kind ??
    (input && typeof input === "object"
      ? (input as Record<string, unknown>).kind
      : undefined);
  if (
    !agent ||
    typeof agent !== "object" ||
    (agent as Record<string, unknown>).name !== name ||
    (agent as Record<string, unknown>).agent !== kind ||
    (agent as Record<string, unknown>).pane_id !== pane.paneId ||
    (agent as Record<string, unknown>).interactive_ready !== true
  ) {
    throw new Error(
      "Agent start result does not prove expected agent name and kind.",
    );
  }
  return {
    name: String(name),
    kind: String(kind),
    paneId: String(pane.paneId),
    interactiveReady: true,
  };
}

function proveAgentReadback(
  output: string,
  expected: { name: string; kind: string; paneId: string },
): void {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("Agent readback is not valid JSON.");
  }
  const wrapper =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  const result = wrapper?.result;
  const agent =
    result && typeof result === "object"
      ? (result as Record<string, unknown>).agent
      : undefined;
  if (
    !agent ||
    typeof agent !== "object" ||
    (agent as Record<string, unknown>).name !== expected.name ||
    (agent as Record<string, unknown>).agent !== expected.kind ||
    (agent as Record<string, unknown>).pane_id !== expected.paneId ||
    (agent as Record<string, unknown>).interactive_ready !== true
  ) {
    throw new Error(
      "Agent readback does not prove expected identity and readiness.",
    );
  }
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
          truncated: result.truncated,
          status: result.truncated
            ? "unknown"
            : result.exitCode === 0
              ? "completed"
              : "failed",
          nextSafeAction: result.truncated
            ? "Repeat read-only inspection; output was truncated."
            : "Inspect returned read-only state.",
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
      let operationTruncated = false;
      let mutationResult: Awaited<ReturnType<HerdrRunner>> | undefined;
      let live: TargetSnapshot | undefined;
      let readback: TargetSnapshot | undefined;
      let uncertainOutcome:
        | "mutation-truncated"
        | "readback-truncated"
        | "proof-unavailable"
        | undefined;
      try {
        requireHerdrEnvironment(env);
        const expected = parseTargetSnapshot(params.targetSnapshot);
        if (expected.paneId !== env.HERDR_PANE_ID)
          throw new Error(
            "Target pane must match current Herdr pane authority.",
          );
        const requestedPaneId = inputPaneId(params.input);
        if (
          requestedPaneId !== undefined &&
          requestedPaneId !== expected.paneId
        )
          throw new Error(
            "Typed operation paneId must match targetSnapshot paneId.",
          );
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
        live = assertTargetSnapshotFresh(expected, inspected);
        if (found.id === "herdr.0.9.1.agent.prompt") {
          if (
            live.kind !== "pane" ||
            (live.agentStatus !== "idle" && live.agentStatus !== "done")
          ) {
            throw new Error(
              "Agent prompt requires a fresh pane with detected idle or done agent state.",
            );
          }
        }
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
        mutationResult = result;
        operationTruncated = result.truncated;
        if (result.truncated) {
          uncertainOutcome = "mutation-truncated";
          throw new Error(
            "Herdr mutation output was truncated; completion is unknown.",
          );
        }
        if (result.exitCode !== 0)
          return textResult(
            envelope({
              capabilityId: found.id,
              correlationId: params.correlationId,
              stage: "operation",
              exitCode: result.exitCode,
              output: result.output,
              truncated: false,
              targetSnapshot: live,
              status: "failed",
              retrySafety: "unsafe",
              nextSafeAction:
                "Inspect target state before retrying; mutation failed.",
            }),
          );
        const readbackResult = await run(
          [env.HERDR_BIN_PATH || "herdr", ...targetGetArgv(live)],
          signal,
        );
        if (readbackResult.exitCode !== 0)
          throw new Error("Post-mutation target readback failed.");
        if (readbackResult.truncated) {
          uncertainOutcome = "readback-truncated";
          throw new Error("Post-mutation target readback was truncated.");
        }
        readback = decodeHerdrTargetReadback(readbackResult.output, live.kind);
        assertTargetSnapshotIdentity(live, readback);
        if (
          found.id === "herdr.0.9.1.agent.start" ||
          found.id === "herdr.0.9.1.agent.profile-launch"
        ) {
          const started = proveAgentStart(
            result.output,
            readback,
            params.input,
          );
          const agentResult = await run(
            [env.HERDR_BIN_PATH || "herdr", "agent", "get", started.name],
            signal,
          );
          if (agentResult.exitCode !== 0 || agentResult.truncated)
            throw new Error("Agent get readback is unavailable after launch.");
          proveAgentReadback(agentResult.output, started);
        }
        if (
          found.id === "herdr.0.9.1.agent.prompt" &&
          (readback.agentStatus !== "working" ||
            live.stateChangeSeq === undefined ||
            readback.stateChangeSeq === undefined ||
            readback.stateChangeSeq <= live.stateChangeSeq)
        ) {
          uncertainOutcome = "proof-unavailable";
          throw new Error(
            "Agent prompt readback does not prove increasing working state sequence.",
          );
        }
        return textResult(
          envelope({
            capabilityId: found.id,
            correlationId: params.correlationId,
            stage: "operation",
            exitCode: result.exitCode,
            output: result.output,
            truncated: operationTruncated,
            targetSnapshot: live,
            readback,
            status: result.exitCode === 0 ? "completed" : "failed",
            retrySafety: "unsafe",
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Inspect target and retry safely.";
        const unknown = uncertainOutcome !== undefined;
        return textResult(
          envelope({
            capabilityId: found.id,
            correlationId: params.correlationId,
            stage: "operation",
            exitCode: mutationResult?.exitCode ?? null,
            output: mutationResult?.output ?? "",
            truncated: mutationResult?.truncated ?? false,
            targetSnapshot: live,
            readback,
            status: unknown ? "unknown" : "failed",
            retrySafety: "unsafe",
            nextSafeAction: unknown
              ? "Inspect target state before retrying; mutation outcome is unknown."
              : message,
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
