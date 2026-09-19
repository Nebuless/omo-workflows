import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelsConfig } from "../src/types.ts";
import { loadModelsConfig, saveModelsConfig } from "../src/config.ts";

describe("models config persistence", () => {
  test("replaces JSON atomically and leaves no temporary file", () => {
    const directory = mkdtempSync(join(tmpdir(), "better-custom-"));
    const path = join(directory, "models.json");
    try {
      saveModelsConfig(
        { providers: { gateway: { models: ["new-model"] } } },
        path,
      );
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
        providers: { gateway: { models: ["new-model"] } },
      });
      expect(readdirSync(directory)).toEqual(["models.json"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("persists native map, model compatibility, and unknown fields exactly", () => {
    const directory = mkdtempSync(join(tmpdir(), "better-custom-"));
    const path = join(directory, "models.json");
    const config: ModelsConfig = {
      unknownTopLevel: { retained: true },
      providers: {
        "9router": {
          api: "openai-completions",
          providerUnknown: ["retained"],
          models: [
            {
              id: "cx/gpt-5.6-luna",
              modelUnknown: { retained: true },
              thinkingLevelMap: {
                off: "none",
                minimal: "minimal",
                low: "low",
                medium: "medium",
                high: "high",
                xhigh: "xhigh",
                max: "max",
              },
              compat: { supportsReasoningEffort: true },
            },
          ],
        },
      },
    };
    try {
      saveModelsConfig(config, path);
      expect(loadModelsConfig(path)).toEqual(config);
      expect(readdirSync(directory)).toEqual(["models.json"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
