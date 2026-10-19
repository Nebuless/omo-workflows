import { describe, expect, test } from "bun:test";
import { observePublicRegistry } from "../src/runtime.ts";

const candidates = [{ providerId: "provider-a", modelId: "gpt-6" }] as const;
const nowMs = 1_700_000_000_000;

describe("public registry observation", () => {
  test("Given catalog and configured auth, when the registry is observed, then it returns partial unknown runtime evidence", () => {
    const observations = observePublicRegistry({
      candidates,
      nowMs,
      registry: {
        getAll: () => [{ provider: "provider-a", id: "gpt-6" }],
        hasConfiguredAuth: () => true,
      },
    });

    expect(observations).toEqual([
      {
        providerId: "provider-a",
        observedAtMs: nowMs,
        expiresAtMs: nowMs + 1,
        coverage: "partial",
        catalogModelIds: ["gpt-6"],
        credential: "ready",
        runtime: [{ modelId: "gpt-6", status: "unknown" }],
      },
    ]);
  });

  test("Given an unobserved provider, when the registry is observed, then it does not fabricate coverage", () => {
    const observations = observePublicRegistry({
      candidates,
      nowMs,
      registry: {
        getAll: () => [],
        hasConfiguredAuth: () => false,
      },
    });

    expect(observations).toEqual([]);
  });

  test("Given an oversized public catalog, when the registry is observed, then it bounds catalog detail", () => {
    const observations = observePublicRegistry({
      candidates,
      nowMs,
      registry: {
        getAll: () =>
          Array.from({ length: 65 }, (_, index) => ({
            provider: "provider-a",
            id: `gpt-${index}`,
          })),
        hasConfiguredAuth: () => true,
      },
    });

    expect(observations[0]?.catalogModelIds).toHaveLength(64);
  });

  test("Given a registry error, when the registry is observed, then it returns typed conservative failure evidence", () => {
    const observations = observePublicRegistry({
      candidates,
      nowMs,
      registry: {
        getAll: () => {
          throw new Error("registry unavailable");
        },
        hasConfiguredAuth: () => false,
      },
    });

    expect(observations).toEqual([
      {
        providerId: "provider-a",
        observedAtMs: nowMs,
        expiresAtMs: nowMs,
        coverage: "partial",
        catalogModelIds: [],
        credential: "unknown",
        runtime: [{ modelId: "gpt-6", status: "unknown" }],
        error: "runtime_error",
      },
    ]);
  });

  test("Given non-Error registry or auth failures, when the registry is observed, then it returns conservative failure evidence", () => {
    for (const registry of [
      {
        getAll: () => {
          throw "registry unavailable";
        },
        hasConfiguredAuth: () => false,
      },
      {
        getAll: () => [{ provider: "provider-a", id: "gpt-6" }],
        hasConfiguredAuth: () => {
          throw { reason: "auth unavailable" };
        },
      },
    ]) {
      expect(
        observePublicRegistry({ candidates, nowMs, registry }).at(0)?.error,
      ).toBe("runtime_error");
    }
  });
});
