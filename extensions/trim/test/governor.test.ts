import { describe, expect, test } from "bun:test";
import { decide, OUTCOMES, shouldSchedule } from "../src/governor.ts";

const config = { strategy: "settled" as const, thresholdTokens: 100 };
describe("trim governor", () => {
  test("returns below threshold for finite lower usage", () =>
    expect(
      decide(config, {
        usageTokens: 99,
        settled: true,
        idle: true,
        pendingMessages: false,
        nativeCompacting: false,
        requestLatched: false,
      }),
    ).toBe("BELOW_THRESHOLD"));
  test("defers at threshold when boundary is unsafe", () =>
    expect(
      decide(config, {
        usageTokens: 100,
        settled: false,
        idle: true,
        pendingMessages: false,
        nativeCompacting: false,
        requestLatched: false,
      }),
    ).toBe("DEFERRED"));
  test("commits only with accepted native evidence", () =>
    expect(
      decide(config, {
        settled: true,
        idle: true,
        pendingMessages: false,
        nativeCompacting: false,
        requestLatched: true,
        nativeAccepted: true,
        revisionAdvanced: true,
        concreteEntry: true,
      }),
    ).toBe("NATIVE_COMPACTION_COMMITTED"));
  test("never reports below threshold at or above threshold", () =>
    expect(
      decide(
        { strategy: "manual", thresholdTokens: 100 },
        {
          usageTokens: 100,
          settled: true,
          idle: true,
          pendingMessages: false,
          nativeCompacting: false,
          requestLatched: false,
        },
      ),
    ).toBe("DEFERRED"));
  test("schedules only an eligible settled policy request", () =>
    expect(
      shouldSchedule(config, {
        usageTokens: 100,
        settled: true,
        idle: true,
        pendingMessages: false,
        nativeCompacting: false,
        requestLatched: false,
      }),
    ).toBe(true));
  test("does not schedule manual or native strategies", () =>
    expect(
      shouldSchedule(
        { strategy: "manual", thresholdTokens: 100 },
        {
          usageTokens: 100,
          settled: true,
          idle: true,
          pendingMessages: false,
          nativeCompacting: false,
          requestLatched: false,
        },
      ),
    ).toBe(false));
  test("includes superseded or unknown terminal state", () =>
    expect(OUTCOMES).toContain("SUPERSEDED_OR_UNKNOWN"));
  test("defers null and non-finite usage", () => {
    const base = {
      settled: true,
      idle: true,
      pendingMessages: false,
      nativeCompacting: false,
      requestLatched: false,
    };
    expect(decide(config, { ...base, usageTokens: null })).toBe("DEFERRED");
    expect(decide(config, { ...base, usageTokens: Number.NaN })).toBe(
      "DEFERRED",
    );
  });
});
