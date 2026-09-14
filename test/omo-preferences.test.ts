import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { configureOmoPreferences } from "../scripts/omo-preferences.ts";

describe("OMO preferences bootstrap", () => {
  test("disables tips while preserving unrelated global settings", () => {
    const home = mkdtempSync(join(tmpdir(), "omo-preferences-home-"));
    const agentDir = join(home, ".omo", "agent");
    const settingsPath = join(agentDir, "settings.json");

    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ theme: "grok-night", tips: true }, null, 2),
    );

    const first = configureOmoPreferences({ home });
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      tips?: unknown;
      theme?: unknown;
    };

    expect(first).toEqual({ settingsChanged: true });
    expect(settings).toEqual({ theme: "grok-night", tips: false });
    expect(configureOmoPreferences({ home })).toEqual({
      settingsChanged: false,
    });
  });

  test("creates tips-disabled global settings when OMO has none", () => {
    const home = mkdtempSync(join(tmpdir(), "omo-preferences-empty-home-"));
    const settingsPath = join(home, ".omo", "agent", "settings.json");

    const result = configureOmoPreferences({ home });

    expect(result).toEqual({ settingsChanged: true });
    expect(existsSync(settingsPath)).toBe(true);
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      tips: false,
    });
  });

  test("pins reflection to the shared Luna category in portable routing templates", () => {
    const templatesDir = join(
      fileURLToPath(new URL("..", import.meta.url)),
      "templates",
    );

    for (const template of ["omo.jsonc.balanced", "omo.jsonc.gpt-heavy"]) {
      const config = JSON.parse(
        readFileSync(join(templatesDir, template), "utf8").replace(
          /^\/\/.*\n/,
          "",
        ),
      ) as {
        memory?: {
          reflection?: { category?: unknown; sandbox?: unknown };
          recall?: { category?: unknown };
        };
        categories?: Record<
          string,
          { models?: readonly { model?: unknown; reasoning?: unknown }[] }
        >;
        "[opencode]"?: { categories?: unknown };
      };

      expect(config.memory?.reflection?.sandbox).toBe("off");
      expect(config.memory?.reflection?.category).toBe("memory-reflection");
      expect(config.memory?.recall?.category).toBe("memory-reflection");
      expect(config.categories?.["memory-reflection"]?.models).toEqual([
        { model: "9router/cx/gpt-5.6-luna", reasoning: "low" },
      ]);
      expect(Object.keys(config.categories ?? {}).sort()).toEqual([
        "artistry",
        "deep",
        "memory-reflection",
        "quick",
        "ultrabrain",
        "unspecified-high",
        "unspecified-low",
        "visual-engineering",
        "writing",
      ]);
      expect(config["[opencode]"]?.categories).toBeUndefined();
    }
  });
});
