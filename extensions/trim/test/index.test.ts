import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import type { TrimConfig } from "../src/config.ts";
import { registerTrim } from "../src/index.ts";
import {
  createTrimSettingsHandler,
  type TrimSettingsContext,
} from "../src/ui/settings.ts";

type Notice = {
  readonly message: string;
  readonly type: "info" | "warning" | "error" | undefined;
};

const initialConfig: TrimConfig = {
  strategy: "native",
  thresholdTokens: 100_000,
};

function settingsContext(
  ui: TrimSettingsContext["ui"],
  mode: "tui" | "print",
): TrimSettingsContext {
  return { hasUI: mode === "tui", mode, ui } as TrimSettingsContext;
}

function scriptedUi(responses: {
  readonly selection?: string | undefined;
  readonly threshold?: string | undefined;
  readonly confirmed?: boolean;
}): {
  readonly notices: Notice[];
  readonly calls: readonly string[];
  readonly ui: TrimSettingsContext["ui"];
} {
  const notices: Notice[] = [];
  const calls: string[] = [];
  return {
    notices,
    calls,
    ui: {
      select: async () => {
        calls.push("select");
        return responses.selection;
      },
      input: async () => {
        calls.push("input");
        return responses.threshold;
      },
      confirm: async () => {
        calls.push("confirm");
        return responses.confirmed ?? false;
      },
      notify: (message, type) => {
        notices.push({ message, type });
      },
    },
  };
}

function settingsHarness() {
  let config = initialConfig;
  const saved: TrimConfig[] = [];
  return {
    saved,
    handler: createTrimSettingsHandler({
      getConfig: () => config,
      saveConfig: (next) => {
        saved.push(next);
        config = next;
      },
    }),
  };
}

type RegisteredCommand = Parameters<ExtensionAPI["registerCommand"]>[1];
type EventHandler = (event: unknown, context: unknown) => unknown;

function trimCommandFixture(config: TrimConfig) {
  let command: RegisteredCommand | undefined;
  let compacting = false;
  let idle = true;
  let pendingMessages = false;
  let tokens = 100;
  const compactCalls: unknown[] = [];
  const notices: Notice[] = [];
  const handlers = new Map<string, EventHandler>();
  const host = {
    on: (event: string, handler: EventHandler) => {
      handlers.set(event, handler);
    },
    registerCommand: (_name: string, definition: RegisteredCommand) => {
      command = definition;
    },
  };
  const context = {
    hasUI: true,
    mode: "tui",
    isIdle: () => idle,
    hasPendingMessages: () => pendingMessages,
    isCompacting: () => compacting,
    getContextUsage: () => ({ tokens, contextWindow: 200 }),
    getMessageRevision: () => 1,
    compact: (options?: unknown) => compactCalls.push(options),
    sessionManager: {
      getSessionId: () => "session-a",
      getLeafId: () => "leaf-a",
    },
    ui: {
      select: async () => "automatic",
      input: async () => "100",
      confirm: async () => true,
      notify: (message: string, type?: Notice["type"]) =>
        notices.push({ message, type }),
    },
  };
  registerTrim(host as never, {
    load: () => config,
    save: (next: TrimConfig) => {
      config = next;
    },
  });
  if (command === undefined)
    throw new Error("Trim command was not registered.");
  return {
    command,
    compactCalls,
    context,
    notices,
    emit(event: string, payload: unknown) {
      const handler = handlers.get(event);
      if (handler === undefined) throw new Error(`Missing ${event} handler.`);
      return handler(payload, context);
    },
    setCompacting(next: boolean) {
      compacting = next;
    },
    setIdle(next: boolean) {
      idle = next;
    },
    setPendingMessages(next: boolean) {
      pendingMessages = next;
    },
    setTokens(next: number) {
      tokens = next;
    },
  };
}

describe("trim command", () => {
  test("Given print mode, when bare trim runs, then current command reports status", async () => {
    const { notices, ui } = scriptedUi({});
    const handler = createTrimSettingsHandler({
      getConfig: () => initialConfig,
      saveConfig: () => undefined,
    });

    await handler("", settingsContext(ui, "print"));

    expect(notices).toHaveLength(1);
    expect(notices[0]?.type).toBe("info");
  });

  test("Given TUI mode, when bare trim runs, then it opens settings", async () => {
    const { calls, ui } = scriptedUi({});
    const { handler } = settingsHarness();

    await handler("", settingsContext(ui, "tui"));

    expect(calls).toEqual(["select"]);
  });

  test("Given print mode, when bare trim runs, then it gives a TUI-required notice", async () => {
    const { notices, ui } = scriptedUi({});
    const { handler } = settingsHarness();

    await handler("", settingsContext(ui, "print"));

    expect(notices).toHaveLength(1);
    expect(notices[0]?.type).toBe("info");
  });

  test.each([
    ["automatic", "settled"],
    ["manual", "manual"],
    ["native", "native"],
  ] as const)(
    "Given %s policy and safe threshold, when settings are confirmed, then it persists %s strategy",
    async (selection, strategy) => {
      const { ui } = scriptedUi({
        selection,
        threshold: "120000",
        confirmed: true,
      });
      const { handler, saved } = settingsHarness();

      await handler("", settingsContext(ui, "tui"));

      expect(saved).toEqual([{ strategy, thresholdTokens: 120_000 }]);
    },
  );

  test("Given failed persistence, when settings are confirmed, then live policy stays unchanged", () => {
    const config = initialConfig;
    const { ui } = scriptedUi({
      selection: "automatic",
      threshold: "120000",
      confirmed: true,
    });
    const handler = createTrimSettingsHandler({
      getConfig: () => config,
      saveConfig: () => {
        throw new Error("write failed");
      },
    });

    return handler("", settingsContext(ui, "tui")).then(
      () => {
        throw new Error("expected persistence failure");
      },
      (error: unknown) => {
        if (!(error instanceof Error)) throw error;
        expect(error.message).toBe("write failed");
        expect(config).toEqual(initialConfig);
      },
    );
  });

  test("Given malformed policy selection, when settings run, then live policy stays unchanged", async () => {
    const { notices, ui } = scriptedUi({ selection: "unexpected" });
    const { handler, saved } = settingsHarness();

    await handler("", settingsContext(ui, "tui"));

    expect(saved).toEqual([]);
    expect(notices.at(-1)?.type).toBe("error");
  });

  test("Given malformed threshold, when settings run, then live policy stays unchanged", async () => {
    const { notices, ui } = scriptedUi({
      selection: "automatic",
      threshold: "100.5",
    });
    const { handler, saved } = settingsHarness();

    await handler("", settingsContext(ui, "tui"));

    expect(saved).toEqual([]);
    expect(notices.at(-1)?.type).toBe("error");
  });

  test("Given cancelled threshold, when settings run, then live policy stays unchanged", async () => {
    const { ui } = scriptedUi({ selection: "automatic" });
    const { handler, saved } = settingsHarness();

    await handler("", settingsContext(ui, "tui"));

    expect(saved).toEqual([]);
  });

  test("Given declined confirmation, when settings run, then live policy stays unchanged", async () => {
    const { ui } = scriptedUi({
      selection: "automatic",
      threshold: "120000",
      confirmed: false,
    });
    const { handler, saved } = settingsHarness();

    await handler("", settingsContext(ui, "tui"));

    expect(saved).toEqual([]);
  });

  test("Given idle settled agent, when shake runs, then it delegates once to Senpi", async () => {
    const fixture = trimCommandFixture({
      strategy: "manual",
      thresholdTokens: 100,
    });

    await fixture.command.handler("shake", fixture.context as never);

    expect(fixture.compactCalls).toHaveLength(1);
  });

  test.each([
    [
      "agent is active",
      (fixture: ReturnType<typeof trimCommandFixture>) =>
        fixture.setIdle(false),
    ],
    [
      "messages are pending",
      (fixture: ReturnType<typeof trimCommandFixture>) =>
        fixture.setPendingMessages(true),
    ],
    [
      "native compaction is active",
      (fixture: ReturnType<typeof trimCommandFixture>) =>
        fixture.setCompacting(true),
    ],
  ])(
    "Given %s, when shake runs, then it preserves session history",
    async (_condition, arrange) => {
      const fixture = trimCommandFixture({
        strategy: "manual",
        thresholdTokens: 100,
      });
      arrange(fixture);

      await fixture.command.handler("shake", fixture.context as never);

      expect(fixture.compactCalls).toEqual([]);
      expect(fixture.notices[0]?.type).toBe("warning");
    },
  );

  test("Given manual policy, when settings save automatic policy, then it waits for a settled turn", async () => {
    const fixture = trimCommandFixture({
      strategy: "manual",
      thresholdTokens: 100,
    });

    await fixture.command.handler("", fixture.context as never);

    expect(fixture.compactCalls).toEqual([]);
  });

  test("Given a settled high-usage turn, when agent settles, then Trim forces native compaction once", () => {
    const fixture = trimCommandFixture({
      strategy: "settled",
      thresholdTokens: 100,
    });

    fixture.emit("turn_end", {});
    fixture.emit("agent_settled", {});

    expect(fixture.compactCalls).toHaveLength(1);
  });

  test("Given no completed turn, when agent settles with high context usage, then Trim does not force compaction", () => {
    const fixture = trimCommandFixture({
      strategy: "settled",
      thresholdTokens: 100,
    });

    fixture.emit("agent_settled", {});

    expect(fixture.compactCalls).toEqual([]);
  });

  test("Given a settled low-usage turn, when agent settles, then Trim does not force compaction", () => {
    const fixture = trimCommandFixture({
      strategy: "settled",
      thresholdTokens: 100,
    });
    fixture.setTokens(99);

    fixture.emit("turn_end", {});
    fixture.emit("agent_settled", {});

    expect(fixture.compactCalls).toEqual([]);
  });

  test.each(["manual", "settled"] as const)(
    "Given %s policy, when native threshold compaction starts, then Trim cancels it",
    (strategy) => {
      const fixture = trimCommandFixture({ strategy, thresholdTokens: 100 });

      expect(
        fixture.emit("session_before_compact", { reason: "threshold" }),
      ).toEqual({ cancel: true });
    },
  );

  test.each(["manual", "settled"] as const)(
    "Given %s policy, when native manual or overflow compaction starts, then Trim allows it",
    (strategy) => {
      const fixture = trimCommandFixture({ strategy, thresholdTokens: 100 });

      expect(
        fixture.emit("session_before_compact", { reason: "manual" }),
      ).toBeUndefined();
      expect(
        fixture.emit("session_before_compact", { reason: "overflow" }),
      ).toBeUndefined();
    },
  );

  test("Given native policy, when native threshold compaction starts, then Trim allows it", () => {
    const fixture = trimCommandFixture({
      strategy: "native",
      thresholdTokens: 100,
    });

    expect(
      fixture.emit("session_before_compact", { reason: "threshold" }),
    ).toBeUndefined();
  });

  test.each(["status", "config", "compact", "snapshot", "handoff"])(
    "Given removed %s subcommand, when trim runs, then it rejects without opening settings",
    async (command) => {
      const { calls, notices, ui } = scriptedUi({});
      const { handler } = settingsHarness();

      await handler(command, settingsContext(ui, "tui"));

      expect(calls).toEqual([]);
      expect(notices).toHaveLength(1);
      expect(notices[0]?.type).toBe("error");
    },
  );
});
