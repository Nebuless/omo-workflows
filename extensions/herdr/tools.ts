import { spawn } from "node:child_process";
import type { AgentToolResult } from "@code-yeongyu/senpi";
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { Type } from "typebox";

const MAX_OUTPUT_BYTES = 20_000;
const INSPECTION_COMMANDS = new Set([
  "--help",
  "--version",
  "status",
  "status --json",
  "status server",
  "status client",
  "api snapshot",
  "api schema",
  "workspace list",
  "workspace get",
  "worktree list",
  "tab list",
  "tab get",
  "pane list",
  "pane current",
  "pane get",
  "pane layout",
  "pane process-info",
  "pane neighbor",
  "pane edges",
  "pane read",
  "pane wait-output",
  "agent list",
  "agent get",
  "agent read",
  "agent wait",
  "agent explain",
  "notification show",
  "session list",
  "integration status",
  "plugin list",
  "plugin config-dir",
  "plugin log",
  "server agent-manifests",
  "machine list",
  "channel show",
]);

export interface HerdrCommandResult {
  readonly code: number;
  readonly output: string;
}

export type HerdrCommandRunner = (
  argv: readonly string[],
  signal?: AbortSignal,
) => Promise<HerdrCommandResult>;

export function requireHerdrEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.HERDR_ENV !== "1" || !env.HERDR_PANE_ID) {
    throw new Error(
      "Herdr control requires a Herdr-managed pane (HERDR_ENV=1 and HERDR_PANE_ID).",
    );
  }
}

export function validateHerdrArgs(
  args: readonly string[],
  inspect: boolean,
): void {
  if (args.length === 0) {
    throw new Error(
      "Herdr arguments must name a command; never invoke bare herdr.",
    );
  }
  if (args.some((arg) => arg.length === 0 || arg.includes("\0"))) {
    throw new Error(
      "Herdr arguments must be non-empty text without NUL bytes.",
    );
  }
  if (args[0] === "herdr") {
    throw new Error(
      "Pass Herdr arguments only; do not include the herdr binary.",
    );
  }
  if (inspect) {
    const command = args.slice(0, 2).join(" ");
    const isHelp = args.length > 1 && args[1] === "--help";
    if (!isHelp && !INSPECTION_COMMANDS.has(command)) {
      throw new Error(`Unsupported Herdr inspection command: ${command}.`);
    }
  }
}

export const spawnHerdrCommand: HerdrCommandRunner = (argv, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let length = 0;
    const collect = (chunk: Buffer) => {
      if (length >= MAX_OUTPUT_BYTES) return;
      const remaining = MAX_OUTPUT_BYTES - length;
      chunks.push(chunk.subarray(0, remaining));
      length += Math.min(chunk.length, remaining);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => {
      const suffix = length === MAX_OUTPUT_BYTES ? "\n[output truncated]" : "";
      resolve({
        code: code ?? 1,
        output: Buffer.concat(chunks).toString("utf8") + suffix,
      });
    });
  });

export async function runHerdrCommand(
  args: readonly string[],
  inspect: boolean,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  run: HerdrCommandRunner = spawnHerdrCommand,
): Promise<HerdrCommandResult> {
  validateHerdrArgs(args, inspect);
  if (!inspect) requireHerdrEnvironment(env);
  return run([env.HERDR_BIN_PATH || "herdr", ...args], signal);
}

function toolResult(
  result: HerdrCommandResult,
): AgentToolResult<HerdrCommandResult> {
  return {
    content: [
      {
        type: "text",
        text: `herdr exited ${result.code}\n${result.output || "[no output]"}`,
      },
    ],
    details: result,
  };
}

const argsSchema = Type.Object(
  {
    args: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      maxItems: 64,
      description:
        "Herdr argv without the herdr binary. Never pass shell syntax.",
    }),
  },
  { additionalProperties: false },
);

export function registerHerdrTools(
  pi: Pick<ExtensionAPI, "registerTool">,
): void {
  pi.registerTool({
    name: "herdr_inspect",
    label: "Inspect Herdr",
    description:
      "Run a read-only Herdr CLI command as argv. Use for help, status, snapshots, listing, get, layout, terminal reads, and agent inspection. Never pass the `herdr` binary or shell syntax. This tool does not launch or attach the Herdr TUI.",
    promptSnippet:
      "Inspect Herdr state and command help through safe argv-only calls.",
    parameters: argsSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      return toolResult(
        await runHerdrCommand(params.args, true, process.env, signal),
      );
    },
  });
  pi.registerTool({
    name: "herdr_control",
    label: "Control Herdr",
    description:
      "Run an explicit Herdr CLI command as argv from a Herdr-managed pane. Use only after reading target state and only for user-requested operations. Pass opaque IDs returned by Herdr; never infer IDs or use shell syntax. Ask the user before destructive or privileged operations such as closing/removing resources, server changes, remote attach, integration/plugin install, update, or restore.",
    promptSnippet:
      "Control Herdr panes, agents, workspaces, worktrees, tabs, sessions, and integrations with verified argv.",
    parameters: argsSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      return toolResult(
        await runHerdrCommand(params.args, false, process.env, signal),
      );
    },
  });
}
