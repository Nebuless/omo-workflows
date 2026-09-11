import { spawn } from "node:child_process";

export type HerdrState = "idle" | "working" | "blocked" | "unknown";

export const HERDR_SOURCE = "custom:omo-workflows";
export const HERDR_AGENT = "atomic";

export interface HerdrEnv {
  bin: string;
  paneId: string;
}

/** Capture Herdr context once at factory invocation. Null outside Herdr. */
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
  env: HerdrEnv | null;
  /** argv runner; defaults to a bounded, non-blocking serialized spawn. */
  run?: (argv: string[]) => void;
}

/** Monotonic per-process sequence; survives reporter recreation on reload. */
let seq = 0;

/** Test seam: reset the process-global sequence counter. */
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
      // Re-arm after a session switch; only a quit releases the agent.
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
      // Only a real quit ends the agent; session switches and reloads keep
      // the authority so Herdr does not reclaim a live agent.
      if (!env || released || reason !== "quit") return;
      released = true;
      seq += 1;
      run(buildReleaseCommand(env, seq));
    },
  };
}

const SPAWN_TIMEOUT_MS = 5_000;

/** Serialize argv sends so a release can never overtake an earlier report. */
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

/** Fire-and-forget argv spawn: failures to contact Herdr never break OMO. */
const defaultRun = createSerialRunner(spawnOnce);
