import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, type TrimConfig } from "../src/config.ts";

const defaultConfig: TrimConfig = {
  strategy: "native",
  thresholdTokens: 100_000,
};

function temporaryConfigPath(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "trim-config-"));
  return { directory, path: join(directory, "trim.json") };
}

test("rejects unsafe persisted thresholds and keeps the native fallback", () => {
  const { directory, path } = temporaryConfigPath();
  try {
    writeFileSync(
      path,
      JSON.stringify({
        strategy: "settled",
        thresholdTokens: Number.MAX_SAFE_INTEGER + 1,
      }),
    );

    expect(loadConfig(path)).toEqual(defaultConfig);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects unsafe thresholds before creating a configuration file", () => {
  const { directory, path } = temporaryConfigPath();
  try {
    expect(() =>
      saveConfig({
        strategy: "native",
        thresholdTokens: Number.MAX_SAFE_INTEGER + 1,
      } satisfies TrimConfig),
    ).toThrow();
    expect(existsSync(path)).toBeFalse();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
