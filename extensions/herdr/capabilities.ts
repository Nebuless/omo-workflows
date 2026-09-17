import type { HerdrRunner } from "./runner.ts";
import { assertAgentPrompt, parseOpaqueTargetId } from "./targets.ts";
import { Type, type Static, type TObject } from "typebox";

export const HERDR_CAPABILITY_VERSION = "0.9.1";

export type CapabilityDomain =
  | "root"
  | "machine"
  | "api"
  | "config"
  | "channel"
  | "workspace"
  | "worktree"
  | "tab"
  | "notification"
  | "agent"
  | "pane"
  | "session"
  | "integration"
  | "server"
  | "terminal"
  | "plugin"
  | "status"
  | "update";

export type CapabilitySafety = "observe" | "routine" | "high-impact";
export type CapabilityAvailability = "available" | "unavailable";

export interface CapabilityDefinition<TSchema extends TObject = TObject> {
  readonly id: string;
  readonly path: readonly string[];
  readonly domain: CapabilityDomain;
  readonly safety: CapabilitySafety;
  readonly availability: CapabilityAvailability;
  readonly inputSchema: TSchema;
  readonly requiredTargetContext: readonly string[];
  readonly expectedReadback: readonly string[];
  readonly unavailableReason?: string;
  readonly safeAlternative?: string;
  /** Builds only fixed, validated command paths. Never accepts argv from callers. */
  readonly buildArgv?: (input: Static<TSchema>) => readonly string[];
}

export interface HerdrDiscovery {
  readonly version: string | null;
  readonly commandPaths: readonly (readonly string[])[];
  readonly schema: string | null;
}

export interface DiscoveryValidation {
  readonly versionMatches: boolean;
  readonly commandPathsMatch: boolean;
  readonly missingPaths: readonly string[];
  readonly unexpectedPaths: readonly string[];
  readonly available: boolean;
}

/** Bounded private runner seam shared with capability discovery and tests. */
export type CapabilityDiscoveryRunner = HerdrRunner;

const emptyInput = Type.Object({}, { additionalProperties: false });
const idInput = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);
const workspaceInput = Type.Object(
  { workspaceId: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);
const paneInput = Type.Object(
  { paneId: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);
const agentInput = Type.Object(
  { agentId: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);
export const agentPromptInputSchema = Type.Object(
  {
    agentId: Type.String({ minLength: 1, maxLength: 256 }),
    text: Type.String({ minLength: 1, maxLength: 20_000 }),
  },
  { additionalProperties: false },
);
export const worktreeCreateInputSchema = Type.Object(
  {
    workspaceId: Type.String({ minLength: 1, maxLength: 256 }),
    path: Type.String({ minLength: 1, maxLength: 4_096 }),
    branch: Type.String({ minLength: 1, maxLength: 256 }),
    base: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    label: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);

export type AgentPromptInput = Static<typeof agentPromptInputSchema>;
export type WorktreeCreateInput = Static<typeof worktreeCreateInputSchema>;

function pathKey(path: readonly string[]): string {
  return path.join(" ");
}

function capabilityId(path: readonly string[]): string {
  return `herdr.${HERDR_CAPABILITY_VERSION}.${path.join(".")}`;
}

function domainFor(path: readonly string[]): CapabilityDomain {
  const first = path[0];
  return (
    first === "--version" ||
    first === "--help" ||
    first === "completion" ||
    first === "completions"
      ? "root"
      : first
  ) as CapabilityDomain;
}

function classifyCapabilitySafety(path: readonly string[]): CapabilitySafety {
  const key = pathKey(path);
  if (
    key === "--help" ||
    key === "--version" ||
    key === "completion" ||
    key === "completions" ||
    key === "status" ||
    key.startsWith("status ") ||
    key === "config" ||
    key === "config check" ||
    key === "channel" ||
    key === "channel show" ||
    key === "machine" ||
    key === "machine list" ||
    key === "server" ||
    key === "server agent-manifests" ||
    key === "api" ||
    key.startsWith("api ") ||
    key === "workspace" ||
    key === "workspace list" ||
    key === "workspace get" ||
    key === "worktree" ||
    key === "worktree list" ||
    key === "tab" ||
    key === "tab list" ||
    key === "tab get" ||
    key === "agent" ||
    key === "agent list" ||
    key === "agent get" ||
    key === "agent read" ||
    key === "agent explain" ||
    key === "pane" ||
    key === "pane list" ||
    key === "pane current" ||
    key === "pane get" ||
    key === "pane layout" ||
    key === "pane process-info" ||
    key === "pane neighbor" ||
    key === "pane edges" ||
    key === "pane read" ||
    key === "terminal" ||
    key === "terminal session" ||
    key === "terminal session observe" ||
    key === "session" ||
    key === "session list" ||
    key === "integration" ||
    key === "integration status" ||
    key === "plugin" ||
    key === "plugin list" ||
    key === "plugin config-dir" ||
    key === "plugin log" ||
    key === "plugin log list" ||
    key === "plugin action" ||
    key === "plugin action list"
  ) {
    return "observe";
  }
  if (
    key === "update" ||
    key.startsWith("config ") ||
    key.startsWith("channel ") ||
    key.startsWith("machine ") ||
    key.startsWith("server ") ||
    key.startsWith("session ") ||
    key.startsWith("integration ") ||
    key.startsWith("plugin ") ||
    key === "worktree remove" ||
    key.endsWith(" close") ||
    key === "terminal attach" ||
    key === "terminal session control" ||
    key.startsWith("terminal title")
  ) {
    return "high-impact";
  }
  return "routine";
}

function readonlyDefinition(
  path: readonly string[],
  inputSchema: TObject = emptyInput,
  requiredTargetContext: readonly string[] = [],
): CapabilityDefinition {
  return {
    id: capabilityId(path),
    path,
    domain: domainFor(path),
    safety: "observe",
    availability: "available",
    inputSchema,
    requiredTargetContext,
    expectedReadback: [pathKey(path)],
    buildArgv: (input) => {
      if (inputSchema === idInput)
        return [...path, (input as Static<typeof idInput>).id];
      if (inputSchema === workspaceInput) {
        return [...path, (input as Static<typeof workspaceInput>).workspaceId];
      }
      if (inputSchema === paneInput) {
        return [...path, (input as Static<typeof paneInput>).paneId];
      }
      if (inputSchema === agentInput) {
        return [...path, (input as Static<typeof agentInput>).agentId];
      }
      return [...path];
    },
  };
}

function unavailableDefinition(path: readonly string[]): CapabilityDefinition {
  return {
    id: capabilityId(path),
    path,
    domain: domainFor(path),
    safety: classifyCapabilitySafety(path),
    availability: "unavailable",
    inputSchema: emptyInput,
    requiredTargetContext: [],
    expectedReadback: [],
    unavailableReason:
      "No narrow typed operation mapping is defined for this command path.",
    safeAlternative:
      "Use a listed observe capability or request a dedicated typed capability.",
  };
}

function requireExactObject(
  input: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Capability input must be an object.");
  }
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  ) {
    throw new Error("Capability input contains unsupported fields.");
  }
  return value;
}

function requireOpaqueId(input: unknown, name: string): string {
  const value = requireExactObject(input, [name]);
  if (typeof value[name] !== "string" || value[name].length === 0) {
    throw new Error(`${name} must be a non-empty opaque ID.`);
  }
  return value[name];
}

function requirePromptInput(input: unknown): AgentPromptInput {
  const value = requireExactObject(input, ["agentId", "text"]);
  return {
    agentId: parseOpaqueTargetId(value.agentId, "agentId"),
    text: assertAgentPrompt(value.text),
  };
}

function requireWorktreeText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.startsWith("-") ||
    /\p{Cc}/u.test(value)
  ) {
    throw new Error(
      `${field} must be non-empty text without control bytes or option prefixes.`,
    );
  }
  return value;
}
function requireWorktreeCreateInput(input: unknown): WorktreeCreateInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Capability input must be an object.");
  }
  const value = input as Record<string, unknown>;
  const allowed = ["workspaceId", "path", "branch", "base", "label"];
  if (
    !["workspaceId", "path", "branch"].every((key) =>
      Object.hasOwn(value, key),
    ) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  ) {
    throw new Error("Capability input contains unsupported or missing fields.");
  }
  return {
    workspaceId: parseOpaqueTargetId(value.workspaceId, "workspaceId"),
    path: requireWorktreeText(value.path, "path", 4_096),
    branch: requireWorktreeText(value.branch, "branch", 256),
    ...(value.base === undefined
      ? {}
      : { base: requireWorktreeText(value.base, "base", 256) }),
    ...(value.label === undefined
      ? {}
      : { label: requireWorktreeText(value.label, "label", 256) }),
  };
}

function unavailableWithReason(
  path: readonly string[],
  reason: string,
  safeAlternative: string,
): CapabilityDefinition {
  return {
    ...unavailableDefinition(path),
    unavailableReason: reason,
    safeAlternative,
  };
}

/**
 * Complete command-path fixture from Herdr 0.9.1 installed completion metadata.
 * Paths describe commands only; no path includes user-controlled argv.
 */
export const HERDR_0_9_1_COMMAND_PATHS = [
  ["--help"],
  ["--version"],
  ["completion"],
  ["completion", "zsh"],
  ["update"],
  ["status"],
  ["status", "server"],
  ["status", "client"],
  ["config"],
  ["config", "check"],
  ["config", "reset-keys"],
  ["channel"],
  ["channel", "show"],
  ["channel", "set"],
  ["machine"],
  ["machine", "list"],
  ["machine", "add"],
  ["machine", "rename"],
  ["machine", "remove"],
  ["machine", "enable"],
  ["machine", "disable"],
  ["server"],
  ["server", "stop"],
  ["server", "reload-config"],
  ["server", "agent-manifests"],
  ["server", "update-agent-manifests"],
  ["server", "reload-agent-manifests"],
  ["api"],
  ["api", "snapshot"],
  ["api", "schema"],
  ["workspace"],
  ["workspace", "list"],
  ["workspace", "create"],
  ["workspace", "get"],
  ["workspace", "focus"],
  ["workspace", "rename"],
  ["workspace", "report-metadata"],
  ["workspace", "close"],
  ["worktree"],
  ["worktree", "list"],
  ["worktree", "create"],
  ["worktree", "open"],
  ["worktree", "remove"],
  ["tab"],
  ["tab", "list"],
  ["tab", "create"],
  ["tab", "get"],
  ["tab", "focus"],
  ["tab", "rename"],
  ["tab", "close"],
  ["notification"],
  ["notification", "show"],
  ["agent"],
  ["agent", "list"],
  ["agent", "get"],
  ["agent", "read"],
  ["agent", "send-keys"],
  ["agent", "prompt"],
  ["agent", "rename"],
  ["agent", "focus"],
  ["agent", "wait"],
  ["agent", "attach"],
  ["agent", "start"],
  ["agent", "explain"],
  ["pane"],
  ["pane", "list"],
  ["pane", "current"],
  ["pane", "get"],
  ["pane", "layout"],
  ["pane", "process-info"],
  ["pane", "neighbor"],
  ["pane", "edges"],
  ["pane", "focus"],
  ["pane", "resize"],
  ["pane", "zoom"],
  ["pane", "read"],
  ["pane", "rename"],
  ["pane", "input"],
  ["pane", "split"],
  ["pane", "swap"],
  ["pane", "move"],
  ["pane", "close"],
  ["pane", "send-text"],
  ["pane", "send-keys"],
  ["pane", "wait-output"],
  ["pane", "run"],
  ["pane", "report-agent"],
  ["pane", "report-agent-session"],
  ["pane", "release-agent"],
  ["pane", "report-metadata"],
  ["session"],
  ["session", "list"],
  ["session", "attach"],
  ["session", "stop"],
  ["session", "delete"],
  ["integration"],
  ["integration", "install"],
  ["integration", "status"],
  ["integration", "uninstall"],
] as const satisfies readonly (readonly string[])[];

const overrides = new Map<string, CapabilityDefinition>([
  ["status", readonlyDefinition(["status"])],
  ["status server", readonlyDefinition(["status", "server"])],
  ["status client", readonlyDefinition(["status", "client"])],
  ["api snapshot", readonlyDefinition(["api", "snapshot"])],
  ["api schema", readonlyDefinition(["api", "schema"])],
  ["workspace list", readonlyDefinition(["workspace", "list"])],
  [
    "workspace get",
    readonlyDefinition(["workspace", "get"], workspaceInput, ["workspace"]),
  ],
  ["worktree list", readonlyDefinition(["worktree", "list"])],
  ["tab list", readonlyDefinition(["tab", "list"])],
  ["tab get", readonlyDefinition(["tab", "get"], idInput, ["tab"])],
  ["agent list", readonlyDefinition(["agent", "list"])],
  ["agent get", readonlyDefinition(["agent", "get"], agentInput, ["agent"])],
  ["agent read", readonlyDefinition(["agent", "read"], agentInput, ["agent"])],
  [
    "agent explain",
    readonlyDefinition(["agent", "explain"], agentInput, ["agent"]),
  ],
  ["pane list", readonlyDefinition(["pane", "list"])],
  ["pane current", readonlyDefinition(["pane", "current"])],
  ["pane get", readonlyDefinition(["pane", "get"], paneInput, ["pane"])],
  ["pane layout", readonlyDefinition(["pane", "layout"], paneInput, ["pane"])],
  [
    "pane process-info",
    readonlyDefinition(["pane", "process-info"], paneInput, ["pane"]),
  ],
  ["pane read", readonlyDefinition(["pane", "read"], paneInput, ["pane"])],
  ["session list", readonlyDefinition(["session", "list"])],
  ["integration status", readonlyDefinition(["integration", "status"])],
  ["plugin list", readonlyDefinition(["plugin", "list"])],
  ["plugin config-dir", readonlyDefinition(["plugin", "config-dir"])],
  ["server agent-manifests", readonlyDefinition(["server", "agent-manifests"])],
  [
    "worktree create",
    unavailableWithReason(
      ["worktree", "create"],
      "Herdr 0.9.1 creation response does not prove opaque worktree, pane, or agent identity and mutable workspace revision.",
      "Use herdr_worktree_create only after a future typed response contract proves returned identities.",
    ),
  ],
  [
    "agent prompt",
    unavailableWithReason(
      ["agent", "prompt"],
      "Herdr 0.9.1 agent readback does not prove opaque agent identity from its wrapper fields.",
      "Use read-only agent inspection until typed prompt identity is proven.",
    ),
  ],
]);

export const HERDR_0_9_1_CAPABILITIES: readonly CapabilityDefinition[] =
  HERDR_0_9_1_COMMAND_PATHS.map(
    (path) => overrides.get(pathKey(path)) ?? unavailableDefinition(path),
  );

export function normalizeCommandPath(
  path: string | readonly string[],
): readonly string[] | null {
  const tokens = (
    typeof path === "string" ? path.trim().split(/\s+/) : [...path]
  ).filter((token) => token.length > 0);
  if (tokens[0] === "herdr") tokens.shift();
  if (
    tokens.length === 0 ||
    tokens.some((token) => !/^(?:--[a-z][a-z-]*|[a-z][a-z-]*)$/.test(token))
  ) {
    return null;
  }
  return tokens;
}

export function normalizeCommandPaths(
  paths: Iterable<string | readonly string[]>,
): readonly (readonly string[])[] {
  const normalized = new Map<string, readonly string[]>();
  for (const path of paths) {
    const value = normalizeCommandPath(path);
    if (value) normalized.set(pathKey(value), value);
  }
  return [...normalized.values()].sort((left, right) =>
    pathKey(left).localeCompare(pathKey(right)),
  );
}

export function validateHerdrDiscovery(
  discovery: HerdrDiscovery,
): DiscoveryValidation {
  const expected = new Set(HERDR_0_9_1_COMMAND_PATHS.map(pathKey));
  const actual = new Set(
    normalizeCommandPaths(discovery.commandPaths).map(pathKey),
  );
  const missingPaths = [...expected].filter((path) => !actual.has(path)).sort();
  const unexpectedPaths = [...actual]
    .filter((path) => !expected.has(path))
    .sort();
  const versionMatches = discovery.version === HERDR_CAPABILITY_VERSION;
  const commandPathsMatch =
    missingPaths.length === 0 && unexpectedPaths.length === 0;
  return {
    versionMatches,
    commandPathsMatch,
    missingPaths,
    unexpectedPaths,
    available: versionMatches && commandPathsMatch,
  };
}

export function capabilitiesForDiscovery(
  discovery: HerdrDiscovery,
): readonly CapabilityDefinition[] {
  const validation = validateHerdrDiscovery(discovery);
  if (validation.available) return HERDR_0_9_1_CAPABILITIES;
  const reason = !validation.versionMatches
    ? `Installed Herdr version ${discovery.version ?? "unknown"} does not match ${HERDR_CAPABILITY_VERSION}.`
    : `Herdr command-path discovery differs: missing ${validation.missingPaths.join(", ") || "none"}; unexpected ${validation.unexpectedPaths.join(", ") || "none"}.`;
  return HERDR_0_9_1_CAPABILITIES.map((capability) => ({
    ...capability,
    availability: "unavailable" as const,
    buildArgv: undefined,
    unavailableReason: reason,
    safeAlternative:
      "Inspect installed Herdr help and update typed capability metadata.",
  }));
}

export function getCapability(
  id: string,
  discovery: HerdrDiscovery,
): CapabilityDefinition | undefined {
  return capabilitiesForDiscovery(discovery).find(
    (capability) => capability.id === id,
  );
}

/** Build a fixed capability argv only after discovery availability and exact input validation. */
export function buildCapabilityArgv(
  capability: CapabilityDefinition,
  input: unknown,
): readonly string[] {
  if (!capability.buildArgv || capability.availability !== "available") {
    throw new Error(`Capability ${capability.id} is unavailable.`);
  }
  if (capability.inputSchema === agentPromptInputSchema) {
    return capability.buildArgv(requirePromptInput(input));
  }
  if (capability.inputSchema === worktreeCreateInputSchema) {
    return capability.buildArgv(requireWorktreeCreateInput(input));
  }
  if (capability.inputSchema === emptyInput) {
    requireExactObject(input, []);
    return capability.buildArgv({});
  }
  if (capability.inputSchema === idInput) {
    return capability.buildArgv({ id: requireOpaqueId(input, "id") });
  }
  if (capability.inputSchema === workspaceInput) {
    return capability.buildArgv({
      workspaceId: requireOpaqueId(input, "workspaceId"),
    });
  }
  if (capability.inputSchema === paneInput) {
    return capability.buildArgv({ paneId: requireOpaqueId(input, "paneId") });
  }
  return capability.buildArgv({ agentId: requireOpaqueId(input, "agentId") });
}

function parseVersion(output: string): string | null {
  return output.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? null;
}

/** Extract safe command names from Usage and Commands help tables. */
export function parseHelpCommandPaths(
  output: string,
  parent: readonly string[] = [],
): readonly (readonly string[])[] {
  const paths: string[][] = [];
  const add = (tokens: readonly string[]) => {
    const command = tokens.filter((token) => /^[a-z][a-z-]*$/u.test(token));
    if (command.length > 0) paths.push([...parent, ...command]);
  };
  let inCommands = false;
  for (const line of output.split("\n")) {
    const usage = line.match(
      /^\s*herdr\s+([a-z][a-z-]*)\b(?:\s+([a-z][a-z-]*))?/u,
    );
    if (usage)
      add(
        usage.slice(1).filter((token): token is string => token !== undefined),
      );
    if (/^(?:Commands|Common commands):\s*$/iu.test(line.trim())) {
      inCommands = true;
      continue;
    }
    if (inCommands && /^\S/u.test(line)) {
      inCommands = false;
      continue;
    }
    if (inCommands) {
      const command = line.match(/^\s{2,}([a-z][a-z-]*)\b/u)?.[1];
      if (command) paths.push([...parent, command]);
    }
  }
  return normalizeCommandPaths(paths);
}

/**
 * Help/schema-only recursive discovery. It never invokes a discovered command
 * without `--help`; depth and path count cap hostile/untrusted help output.
 */
export async function discoverHerdrCapabilities(
  run: CapabilityDiscoveryRunner,
  binary = "herdr",
): Promise<HerdrDiscovery> {
  const versionResult = await run([binary, "--version"]);
  const rootHelp = await run([binary, "--help"]);
  const known = new Map<string, readonly string[]>([
    ["--help", ["--help"]],
    ["--version", ["--version"]],
  ]);
  const queue = [...parseHelpCommandPaths(rootHelp.output)];
  for (const path of queue) known.set(pathKey(path), path);
  for (let index = 0; index < queue.length && index < 256; index += 1) {
    const parent = queue[index];
    const help = await run([binary, ...parent, "--help"]);
    for (const child of parseHelpCommandPaths(help.output, parent)) {
      const key = pathKey(child);
      if (!known.has(key) && child.length <= 4) {
        known.set(key, child);
        queue.push(child);
      }
    }
  }
  const schemaResult = await run([binary, "api", "schema", "--json"]);
  return {
    version:
      versionResult.exitCode === 0 ? parseVersion(versionResult.output) : null,
    commandPaths: normalizeCommandPaths(known.values()),
    schema: schemaResult.exitCode === 0 ? schemaResult.output : null,
  };
}
