import { describe, expect, test } from "bun:test";
import type { TrimConfig } from "../src/config.ts";
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

  test("Given automatic policy and safe threshold, when settings are confirmed, then it persists settled policy", async () => {
    const { ui } = scriptedUi({
      selection: "automatic",
      threshold: "120000",
      confirmed: true,
    });
    const { handler, saved } = settingsHarness();

    await handler("", settingsContext(ui, "tui"));

    expect(saved).toEqual([{ strategy: "settled", thresholdTokens: 120_000 }]);
  });

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
