import { describe, expect, test } from "bun:test";
import {
  buildReleaseCommand,
  buildReportCommand,
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

  test("maps lifecycle events to report/release argv with monotonic seq", () => {
    resetHerdrSeq();
    const runs: string[][] = [];
    const reporter = createHerdrReporter({
      env,
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
    const first = createHerdrReporter({ env, run: (argv) => runs.push(argv) });
    first.onSessionStart();
    first.onSessionShutdown("quit");
    const second = createHerdrReporter({ env, run: (argv) => runs.push(argv) });
    second.onSessionStart();
    second.onAgentStart();
    expect(runs.map((argv) => argv[argv.indexOf("--seq") + 1])).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
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
