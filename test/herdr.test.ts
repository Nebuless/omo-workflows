import { describe, expect, spyOn, test } from "bun:test";
import herdrIntegration from "../extensions/herdr/index.ts";
import {
  buildReleaseCommand,
  buildReportCommand,
  buildSessionCommand,
  captureHerdrEnv,
  createHerdrReporter,
  createSerialRunner,
  HERDR_AGENT,
  HERDR_SOURCE,
  resetHerdrSeq,
} from "../extensions/herdr/index.ts";
import type { HerdrEnv } from "../extensions/herdr/index.ts";

const env: HerdrEnv = { bin: "/bin/herdr", paneId: "w1:p3" };

describe("herdr reporter", () => {
  test("identifies lifecycle authority as OMO", () => {
    expect(HERDR_AGENT).toBe("omo");
  });

  test("captures Herdr context only when HERDR_ENV=1 with a pane id", () => {
    expect(
      captureHerdrEnv({
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w1:p3",
        HERDR_BIN_PATH: "/bin/herdr",
      }),
    ).toEqual({ bin: "/bin/herdr", paneId: "w1:p3" });
    expect(captureHerdrEnv({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p3" })).toEqual(
      { bin: "herdr", paneId: "w1:p3" },
    );
    expect(
      captureHerdrEnv({ HERDR_ENV: "0", HERDR_PANE_ID: "w1:p3" }),
    ).toBeNull();
    expect(captureHerdrEnv({ HERDR_ENV: "1" })).toBeNull();
    expect(captureHerdrEnv({})).toBeNull();
  });

  test("no-ops outside Herdr", () => {
    const runs: string[][] = [];
    const reporter = createHerdrReporter({
      env: null,
      run: (argv) => runs.push(argv),
    });
    reporter.onSessionStart();
    reporter.onAgentStart();
    reporter.onUIPromptStart("Pick a model");
    reporter.onUIPromptEnd();
    reporter.onAgentSettled();
    reporter.onSessionShutdown("quit");
    expect(runs).toEqual([]);
  });

  test("surfaces reporter failures without blocking lifecycle callbacks", () => {
    const diagnostics: string[] = [];
    const reporter = createHerdrReporter({
      env,
      run: () => {
        throw new Error("injected reporter failure");
      },
      onDiagnostic: (message) => diagnostics.push(message),
    });
    reporter.onSessionStart();
    reporter.onAgentStart();
    reporter.onSessionShutdown("quit");
    expect(diagnostics).toEqual([
      "injected reporter failure",
      "injected reporter failure",
      "injected reporter failure",
    ]);
  });

  test("unsupported session metadata does not interrupt lifecycle reporting", async () => {
    for (const asynchronous of [false, true]) {
      const runs: string[][] = [];
      const diagnostic = Promise.withResolvers<string>();
      const reporter = createHerdrReporter({
        env,
        run(argv) {
          runs.push(argv);
          if (argv[2] === "report-agent-session") {
            if (asynchronous) return Promise.reject(new Error("unsupported"));
            throw new Error("unsupported");
          }
        },
        onDiagnostic: diagnostic.resolve,
      });
      reporter.onSessionStart({ id: "session", path: "/tmp/session.jsonl" });
      expect(await diagnostic.promise).toBe("unsupported");
      reporter.onAgentStart();
      reporter.onAgentSettled();
      reporter.onSessionShutdown("quit");
      reporter.onSessionShutdown("quit");
      expect(runs.map((argv) => argv[2])).toEqual([
        "report-agent",
        "report-agent-session",
        "report-agent",
        "report-agent",
        "release-agent",
      ]);
      expect(
        runs
          .filter((argv) => argv[2] === "report-agent")
          .map((argv) => argv[argv.indexOf("--state") + 1]),
      ).toEqual(["idle", "working", "idle"]);
      runs.length = 0;
      reporter.onSessionStart({ id: "session", path: "/tmp/invalid\npath" });
      expect(runs.map((argv) => argv[2])).toEqual([
        "report-agent",
        "report-agent-session",
      ]);
      expect(runs[1]?.slice(-2)).toEqual(["--", "omo"]);
    }
  });

  test("maps lifecycle events to report/release argv with monotonic seq", () => {
    resetHerdrSeq();
    const runs: string[][] = [];
    const reporter = createHerdrReporter({
      env,
      now: () => 0,
      run: (argv) => runs.push(argv),
    });

    reporter.onSessionStart();
    reporter.onAgentStart();
    reporter.onUIPromptStart("Pick a model");
    reporter.onUIPromptEnd();
    reporter.onAgentSettled();
    reporter.onSessionShutdown("quit");

    expect(runs).toEqual([
      [
        "/bin/herdr",
        "pane",
        "report-agent",
        "--source",
        HERDR_SOURCE,
        "--agent",
        HERDR_AGENT,
        "--state",
        "idle",
        "--seq",
        "1",
        "w1:p3",
      ],
      [
        "/bin/herdr",
        "pane",
        "report-agent",
        "--source",
        HERDR_SOURCE,
        "--agent",
        HERDR_AGENT,
        "--state",
        "working",
        "--seq",
        "2",
        "w1:p3",
      ],
      [
        "/bin/herdr",
        "pane",
        "report-agent",
        "--source",
        HERDR_SOURCE,
        "--agent",
        HERDR_AGENT,
        "--state",
        "blocked",
        "--message",
        "Waiting on Pick a model",
        "--seq",
        "3",
        "w1:p3",
      ],
      [
        "/bin/herdr",
        "pane",
        "report-agent",
        "--source",
        HERDR_SOURCE,
        "--agent",
        HERDR_AGENT,
        "--state",
        "working",
        "--seq",
        "4",
        "w1:p3",
      ],
      [
        "/bin/herdr",
        "pane",
        "report-agent",
        "--source",
        HERDR_SOURCE,
        "--agent",
        HERDR_AGENT,
        "--state",
        "idle",
        "--seq",
        "5",
        "w1:p3",
      ],
      [
        "/bin/herdr",
        "pane",
        "release-agent",
        "w1:p3",
        "--source",
        HERDR_SOURCE,
        "--agent",
        HERDR_AGENT,
        "--seq",
        "6",
      ],
    ]);
  });

  test("ui_prompt_end outside an active loop reports idle", () => {
    resetHerdrSeq();
    const runs: string[][] = [];
    const reporter = createHerdrReporter({
      env,
      run: (argv) => runs.push(argv),
    });
    reporter.onSessionStart();
    reporter.onUIPromptStart("Confirm");
    reporter.onUIPromptEnd();
    expect(runs.map((argv) => argv[8])).toEqual(["idle", "blocked", "idle"]);
  });

  test("releases only on quit shutdown; other reasons keep authority", () => {
    resetHerdrSeq();
    const runs: string[][] = [];
    const reporter = createHerdrReporter({
      env,
      run: (argv) => runs.push(argv),
    });
    reporter.onSessionStart();
    reporter.onSessionShutdown("reload");
    reporter.onSessionShutdown("new");
    reporter.onSessionShutdown("resume");
    reporter.onSessionShutdown("fork");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.[2]).toBe("report-agent");

    reporter.onSessionShutdown("quit");
    expect(runs).toHaveLength(2);
    expect(runs[1]?.[2]).toBe("release-agent");
  });

  test("suppresses reports after release", () => {
    resetHerdrSeq();
    const runs: string[][] = [];
    const reporter = createHerdrReporter({
      env,
      run: (argv) => runs.push(argv),
    });
    reporter.onSessionStart();
    reporter.onSessionShutdown("quit");
    reporter.onAgentStart();
    reporter.onUIPromptStart("Late");
    reporter.onAgentSettled();
    expect(runs).toHaveLength(2);
    expect(runs[1]?.[2]).toBe("release-agent");
  });

  test("seq is process-global and monotonic across reporters", () => {
    resetHerdrSeq();
    const runs: string[][] = [];
    const first = createHerdrReporter({
      env,
      now: () => 0,
      run: (argv) => runs.push(argv),
    });
    first.onSessionStart();
    first.onSessionShutdown("quit");
    const second = createHerdrReporter({
      env,
      now: () => 0,
      run: (argv) => runs.push(argv),
    });
    second.onSessionStart();
    second.onAgentStart();
    expect(runs.map((argv) => argv[argv.indexOf("--seq") + 1])).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  test("reports restart-safe sequences and refreshes session resume metadata", () => {
    resetHerdrSeq();
    const runs: string[][] = [];
    const reporter = createHerdrReporter({
      env,
      now: () => 1000,
      run: (argv) => runs.push(argv),
    });
    reporter.onSessionStart({ id: "first", path: "/sessions/first.jsonl" });
    reporter.onSessionShutdown("resume");
    reporter.onSessionStart({ id: "next", path: "/sessions/next.jsonl" });
    expect(runs[0]).toEqual(buildReportCommand(env, "idle", 1000));
    expect(runs[1]).toEqual([
      "/bin/herdr",
      "pane",
      "report-agent-session",
      "--source",
      HERDR_SOURCE,
      "--agent",
      HERDR_AGENT,
      "--seq",
      "1001",
      "w1:p3",
      "--agent-session-id",
      "first",
      "--agent-session-path",
      "/sessions/first.jsonl",
      "--",
      "omo",
      "--session",
      "/sessions/first.jsonl",
    ]);
    expect(runs[3]?.slice(-4)).toEqual([
      "--",
      "omo",
      "--session",
      "/sessions/next.jsonl",
    ]);
    for (const session of [
      { id: "unsaved" },
      { id: "invalid", path: "/bad'path" },
    ]) {
      reporter.onSessionStart(session);
      expect(runs.at(-1)?.slice(-2)).toEqual(["--", "omo"]);
      expect(runs.at(-1)).not.toContain("--session");
    }
    resetHerdrSeq();
    createHerdrReporter({
      env,
      now: () => 2000,
      run: (argv) => runs.push(argv),
    }).onAgentStart();
    expect(runs.at(-1)?.at(-2)).toBe("2000");
  });

  test("reports current desktop lifecycle through OSC without invoking the legacy CLI", () => {
    const output: string[] = [];
    const reporter = createHerdrReporter({
      env: null,
      coreTerminalId: "t7",
      write: (value) => output.push(value),
      run: () => {
        throw new Error("Legacy CLI must not run");
      },
    });
    reporter.onSessionStart();
    reporter.onAgentStart();
    reporter.onUIPromptStart("Confirm\u001b]malicious");
    reporter.onUIPromptEnd();
    reporter.onAgentSettled();
    reporter.onSessionShutdown("reload");
    reporter.onSessionShutdown("quit");
    expect(output).toEqual([
      "\u001b]7501;state=idle:app=omo\u001b\\",
      "\u001b]7501;state=working:app=omo\u001b\\",
      `\u001b]7501;state=blocked:app=omo:msg=${Buffer.from("Waiting on Confirm\u001b]malicious").toString("base64")}\u001b\\`,
      "\u001b]7501;state=working:app=omo\u001b\\",
      "\u001b]7501;state=done:app=omo\u001b\\",
      "\u001b]7501;state=clear:app=omo\u001b\\",
    ]);
  });

  test("omits invalid resume paths without losing lifecycle authority", () => {
    expect(
      buildSessionCommand(env, 1, { id: "id", path: "/bad'path" }),
    ).toBeUndefined();
  });

  test("emits core lifecycle only in TUI mode even when RPC has UI and a TTY", () => {
    const terminal = process.env.HC_TERMINAL_ID;
    const legacy = process.env.HERDR_ENV;
    const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const output: string[] = [];
    const write = spyOn(process.stdout, "write").mockImplementation((value) => {
      output.push(String(value));
      return true;
    });
    try {
      process.env.HC_TERMINAL_ID = "t7";
      delete process.env.HERDR_ENV;
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
      });
      const events = new Map<string, (event: unknown, ctx: unknown) => void>();
      herdrIntegration({
        registerTool() {},
        on(name: string, handler: (event: unknown, ctx: unknown) => void) {
          events.set(name, handler);
        },
      } as never);
      const start = events.get("session_start");
      if (!start) throw new Error("Missing session_start handler");
      const sessionManager = {
        getSessionId: () => "id",
        getSessionFile: () => undefined,
      };
      for (const mode of ["rpc", "print"])
        start({}, { mode, hasUI: true, sessionManager });
      expect(output).toEqual([]);
      start({}, { mode: "tui", hasUI: true, sessionManager });
      expect(output).toEqual(["\u001b]7501;state=idle:app=omo\u001b\\"]);
    } finally {
      write.mockRestore();
      if (tty) Object.defineProperty(process.stdout, "isTTY", tty);
      else Reflect.deleteProperty(process.stdout, "isTTY");
      if (terminal === undefined) delete process.env.HC_TERMINAL_ID;
      else process.env.HC_TERMINAL_ID = terminal;
      if (legacy === undefined) delete process.env.HERDR_ENV;
      else process.env.HERDR_ENV = legacy;
    }
  });

  test("serial runner preserves argv order across async sends", async () => {
    const order: string[] = [];
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise;
    });
    let done = 0;
    const run = createSerialRunner(async (argv) => {
      if (argv[0] === "slow") await Promise.resolve();
      else await Promise.resolve().then(() => Promise.resolve());
      order.push(argv[0]);
      done += 1;
      if (done === 3) resolve();
    });
    run(["slow"]);
    run(["fast"]);
    run(["last"]);
    await promise;
    expect(order).toEqual(["slow", "fast", "last"]);
  });

  test("serial runner diagnoses rejection and continues with next report", async () => {
    const order: string[] = [];
    const diagnostics: string[] = [];
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const run = createSerialRunner(
      async (argv) => {
        order.push(argv[0] ?? "");
        if (argv[0] === "bad") throw new Error("nonzero exit");
        if (order.length === 2) resolveCompletion();
      },
      (message) => {
        diagnostics.push(message);
      },
    );
    run(["bad"]);
    run(["next"]);
    await Promise.race([
      completion,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("serial runner completion signal timed out")),
          1_000,
        );
        timer.unref();
      }),
    ]);
    expect(order).toEqual(["bad", "next"]);
    expect(diagnostics).toEqual(["nonzero exit"]);
  });

  test("buildReportCommand omits message when absent", () => {
    expect(buildReportCommand(env, "working", 7)).toEqual([
      "/bin/herdr",
      "pane",
      "report-agent",
      "--source",
      HERDR_SOURCE,
      "--agent",
      HERDR_AGENT,
      "--state",
      "working",
      "--seq",
      "7",
      "w1:p3",
    ]);
    expect(buildReleaseCommand(env, 8)).toEqual([
      "/bin/herdr",
      "pane",
      "release-agent",
      "w1:p3",
      "--source",
      HERDR_SOURCE,
      "--agent",
      HERDR_AGENT,
      "--seq",
      "8",
    ]);
  });
});
