import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { herdrSkillPathsForLoadedExtensions } from "./skills.ts";
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

export function buildSessionCommand(
  env: HerdrEnv,
  seq: number,
  session: { readonly id: string; readonly path?: string },
): string[] | undefined {
  const path = session.path;
  if (
    !path ||
    path.includes("'") ||
    Buffer.byteLength(path) >= 4000 ||
    !session.id ||
    session.id.length > 256 ||
    Array.from(path + session.id).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return undefined;
  return [
    env.bin,
    "pane",
    "report-agent-session",
    "--source",
    HERDR_SOURCE,
    "--agent",
    HERDR_AGENT,
    "--seq",
    String(seq),
    env.paneId,
    "--agent-session-id",
    session.id,
    "--agent-session-path",
    path,
    "--",
    "omo",
    "--session",
    path,
  ];
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
  onSessionStart(session?: {
    readonly id: string;
    readonly path?: string;
  }): void;
  onAgentStart(): void;
  onUIPromptStart(title?: string): void;
  onUIPromptEnd(): void;
  onAgentSettled(): void;
  onSessionShutdown(reason?: string): void;
}

export interface HerdrReporterOptions {
  readonly env: HerdrEnv | null;
  readonly coreTerminalId?: string;
  readonly write?: (value: string) => void;
  readonly now?: () => number;
  readonly run?: (argv: string[]) => unknown | Promise<unknown>;
  readonly onDiagnostic?: (message: string) => void;
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
  const onDiagnostic = options.onDiagnostic ?? (() => undefined);
  let active = false;
  let released = false;
  let settled = false;
  const write =
    options.write ?? ((value: string) => process.stdout.write(value));
  const now = options.now ?? (() => Date.now() * 1000);
  const nextSeq = () => (seq = Math.max(seq + 1, now()));

  function report(state: HerdrState, message?: string): void {
    if ((!env && !options.coreTerminalId) || released) return;
    try {
      if (options.coreTerminalId) {
        const word = state === "idle" && settled ? "done" : state;
        const msg = message
          ? `:msg=${Buffer.from(message).toString("base64")}`
          : "";
        write(`\x1b]7501;state=${word}:app=omo${msg}\x1b\\`);
        return;
      }
      if (!env) return;
      Promise.resolve(
        run(buildReportCommand(env, state, nextSeq(), message)),
      ).catch((error) =>
        onDiagnostic(
          error instanceof Error ? error.message : "Herdr report failed",
        ),
      );
    } catch (error) {
      onDiagnostic(
        error instanceof Error ? error.message : "Herdr report failed",
      );
    }
  }

  return {
    onSessionStart(session): void {
      released = false;
      active = false;
      settled = false;
      report("idle");
      if (env && !options.coreTerminalId && session) {
        const sessionSeq = nextSeq();
        const argv = buildSessionCommand(env, sessionSeq, session) ?? [
          env.bin,
          "pane",
          "report-agent-session",
          env.paneId,
          "--source",
          HERDR_SOURCE,
          "--agent",
          HERDR_AGENT,
          "--seq",
          String(sessionSeq),
          "--",
          "omo",
        ];
        if (argv) {
          try {
            Promise.resolve(run(argv)).catch((error) =>
              onDiagnostic(
                error instanceof Error
                  ? error.message
                  : "Herdr session report failed",
              ),
            );
          } catch (error) {
            onDiagnostic(
              error instanceof Error
                ? error.message
                : "Herdr session report failed",
            );
          }
        }
      }
    },
    onAgentStart(): void {
      active = true;
      settled = false;
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
      settled = true;
      report("idle");
    },
    onSessionShutdown(reason?: string): void {
      if ((!env && !options.coreTerminalId) || released || reason !== "quit")
        return;
      released = true;
      try {
        if (options.coreTerminalId) {
          write("\x1b]7501;state=clear:app=omo\x1b\\");
          return;
        }
        if (!env) return;
        Promise.resolve(run(buildReleaseCommand(env, nextSeq()))).catch(
          (error) =>
            onDiagnostic(
              error instanceof Error ? error.message : "Herdr release failed",
            ),
        );
      } catch (error) {
        onDiagnostic(
          error instanceof Error ? error.message : "Herdr release failed",
        );
      }
    },
  };
}

const SPAWN_TIMEOUT_MS = 5_000;

export function createSerialRunner(
  runOne: (argv: string[]) => void | Promise<void>,
  onDiagnostic: (message: string) => void = () => undefined,
): (argv: string[]) => void {
  let chain: Promise<void> = Promise.resolve();
  return (argv) => {
    chain = chain
      .catch(() => undefined)
      .then(() => runOne(argv))
      .catch((error) => {
        onDiagnostic(
          error instanceof Error
            ? error.message
            : "Herdr lifecycle report failed",
        );
      });
  };
}

function spawnOnce(argv: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: "ignore" });
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Herdr lifecycle report timed out."));
    }, SPAWN_TIMEOUT_MS);
    timer.unref();
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Herdr lifecycle report exited with code ${code ?? "unknown"}.`,
          ),
        );
    });
    child.unref();
  });
}

const defaultRun = createSerialRunner(spawnOnce, (message) => {
  console.warn(`Herdr lifecycle report: ${message}`);
});

export default function herdrIntegration(pi: ExtensionAPI): void {
  registerHerdrTools(pi);
  pi.on("resources_discover", (_event, ctx) => ({
    skillPaths: herdrSkillPathsForLoadedExtensions(ctx),
  }));
  const env = captureHerdrEnv(process.env);
  let reporter = createHerdrReporter({ env });
  pi.on("session_start", (_event, ctx) => {
    reporter = createHerdrReporter({
      env,
      coreTerminalId:
        ctx.mode === "tui" && process.stdout.isTTY
          ? process.env.HC_TERMINAL_ID
          : undefined,
    });
    reporter.onSessionStart({
      id: ctx.sessionManager.getSessionId(),
      path: ctx.sessionManager.getSessionFile(),
    });
  });
  pi.on("agent_start", () => reporter.onAgentStart());
  pi.on("ui_prompt_start", (event) => reporter.onUIPromptStart(event.title));
  pi.on("ui_prompt_end", () => reporter.onUIPromptEnd());
  pi.on("agent_settled", () => reporter.onAgentSettled());
  pi.on("session_shutdown", (event) =>
    reporter.onSessionShutdown(event.reason),
  );
}
