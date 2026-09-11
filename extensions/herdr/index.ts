import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { herdrSkillPaths } from "./skills.ts";
import { registerHerdrTools } from "./tools.ts";

export type HerdrState = "idle" | "working" | "blocked" | "unknown";

export const HERDR_SOURCE = "custom:omo-workflows";
export const HERDR_AGENT = "omo";

export interface HerdrEnv {
  readonly bin: string;
  readonly paneId: string;
}

export function captureHerdrEnv(env: NodeJS.ProcessEnv): HerdrEnv | null {
  if (env.HERDR_ENV !== "1") return null;
  const paneId = env.HERDR_PANE_ID;
  if (!paneId) return null;
  return { bin: env.HERDR_BIN_PATH || "herdr", paneId };
}

export function buildReportCommand(
  env: HerdrEnv,
  state: HerdrState,
  seq: number,
  message?: string,
): string[] {
  const argv = [
    env.bin,
    "pane",
    "report-agent",
    "--source",
    HERDR_SOURCE,
    "--agent",
    HERDR_AGENT,
    "--state",
    state,
  ];
  if (message) argv.push("--message", message);
  argv.push("--seq", String(seq), env.paneId);
  return argv;
}

export function buildReleaseCommand(env: HerdrEnv, seq: number): string[] {
  return [
    env.bin,
    "pane",
    "release-agent",
    env.paneId,
    "--source",
    HERDR_SOURCE,
    "--agent",
    HERDR_AGENT,
    "--seq",
    String(seq),
  ];
}

export interface HerdrReporter {
  onSessionStart(): void;
  onAgentStart(): void;
  onUIPromptStart(title?: string): void;
  onUIPromptEnd(): void;
  onAgentSettled(): void;
  onSessionShutdown(reason?: string): void;
}

export interface HerdrReporterOptions {
  readonly env: HerdrEnv | null;
  readonly run?: (argv: string[]) => void;
}

let seq = 0;

export function resetHerdrSeq(): void {
  seq = 0;
}

export function createHerdrReporter(
  options: HerdrReporterOptions,
): HerdrReporter {
  const { env } = options;
  const run = options.run ?? defaultRun;
  let active = false;
  let released = false;

  function report(state: HerdrState, message?: string): void {
    if (!env || released) return;
    seq += 1;
    run(buildReportCommand(env, state, seq, message));
  }

  return {
    onSessionStart(): void {
      released = false;
      active = false;
      report("idle");
    },
    onAgentStart(): void {
      active = true;
      report("working");
    },
    onUIPromptStart(title?: string): void {
      report(
        "blocked",
        title ? `Waiting on ${title}` : "Waiting on user input",
      );
    },
    onUIPromptEnd(): void {
      report(active ? "working" : "idle");
    },
    onAgentSettled(): void {
      active = false;
      report("idle");
    },
    onSessionShutdown(reason?: string): void {
      if (!env || released || reason !== "quit") return;
      released = true;
      seq += 1;
      run(buildReleaseCommand(env, seq));
    },
  };
}

const SPAWN_TIMEOUT_MS = 5_000;

export function createSerialRunner(
  runOne: (argv: string[]) => void | Promise<void>,
): (argv: string[]) => void {
  let chain: Promise<void> = Promise.resolve();
  return (argv) => {
    chain = chain
      .catch(() => undefined)
      .then(() => runOne(argv))
      .catch(() => undefined);
  };
}

function spawnOnce(argv: string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: "ignore" });
    child.on("error", () => resolve());
    const timer = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
    timer.unref();
    child.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
    child.unref();
  });
}

const defaultRun = createSerialRunner(spawnOnce);

export default function herdrIntegration(pi: ExtensionAPI): void {
  registerHerdrTools(pi);
  pi.on("resources_discover", () => ({ skillPaths: herdrSkillPaths() }));
  const reporter = createHerdrReporter({ env: captureHerdrEnv(process.env) });
  pi.on("session_start", () => reporter.onSessionStart());
  pi.on("agent_start", () => reporter.onAgentStart());
  pi.on("ui_prompt_start", (event) => reporter.onUIPromptStart(event.title));
  pi.on("ui_prompt_end", () => reporter.onUIPromptEnd());
  pi.on("agent_settled", () => reporter.onAgentSettled());
  pi.on("session_shutdown", (event) =>
    reporter.onSessionShutdown(event.reason),
  );
}
