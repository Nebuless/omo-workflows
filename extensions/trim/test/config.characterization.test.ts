import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, STRATEGIES, saveConfig } from "../src/config.ts";
import { decide, shouldSchedule } from "../src/governor.ts";

test.each([...STRATEGIES])(
  "Given persisted %s policy, when it reloads, then strategy remains unchanged",
  (strategy) => {
    const directory = mkdtempSync(join(tmpdir(), "trim-characterization-"));
    const path = join(directory, "nested", "trim.json");
    const policy = { strategy, thresholdTokens: 321 };
    try {
      saveConfig(policy, path);
      expect(loadConfig(path)).toEqual(policy);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("Given malformed persisted JSON, when policy loads, then it uses settled fallback", () => {
  const directory = mkdtempSync(join(tmpdir(), "trim-characterization-"));
  const path = join(directory, "trim.json");
  writeFileSync(path, "{");
  try {
    expect(loadConfig(path)).toEqual({
      strategy: "settled",
      thresholdTokens: 100000,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Given reached threshold, when safe boundary evaluates, then scheduling stays separate from commitment", () => {
  const policy = { strategy: "settled", thresholdTokens: 100 } as const;
  const boundary = {
    usageTokens: 100,
    settled: true,
    idle: true,
    pendingMessages: false,
    nativeCompacting: false,
    requestLatched: false,
  };

  expect({
    scheduled: shouldSchedule(policy, boundary),
    outcome: decide(policy, boundary),
  }).toEqual({ scheduled: true, outcome: "DEFERRED" });
});
