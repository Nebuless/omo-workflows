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
});
