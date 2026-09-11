import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveModelsConfig } from "../src/config.ts";

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
});
