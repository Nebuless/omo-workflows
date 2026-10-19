import { describe, expect, test } from "bun:test";
import { executeModelRouteAdvice } from "../src/tool.ts";

const nowMs = 1_700_000_000_000;

const params = {
  routeKind: "category" as const,
  routeKey: "deep",
  candidates: [{ providerId: "provider-a", modelId: "gpt-6" }],
  provenance: { source: "caller" as const },
};

describe("model route advice tool", () => {
  test("Given public registry catalog data without caller runtime observation, when route advice runs, then it returns conservative incomplete advice", () => {
    const result = executeModelRouteAdvice({
      toolCallId: "tool-call-01",
      params,
      nowMs,
      registry: {
        getAll: () => [{ provider: "provider-a", id: "gpt-6" }],
        hasConfiguredAuth: () => true,
      },
    });

    expect(result.details.status).toBe("inventory_incomplete");
    expect(result.details.candidates[0]?.catalogVisible).toBe(true);
    expect(result.details.candidates[0]?.credential).toBe("ready");
    expect(result.details.candidates[0]?.runtime).toBe("unknown");
  });

  test("Given complete caller runtime evidence, when route advice runs, then it returns observed advice without registry mutation", () => {
    let catalogReads = 0;
    const result = executeModelRouteAdvice({
      toolCallId: "tool-call-02",
      nowMs,
      params: {
        ...params,
        observations: [
          {
            providerId: "provider-a",
            observedAtMs: nowMs - 1,
            expiresAtMs: nowMs + 1,
            coverage: "complete" as const,
            catalogModelIds: ["gpt-6"],
            credential: "unknown" as const,
            runtime: [{ modelId: "gpt-6", status: "available" as const }],
          },
        ],
      },
      registry: {
        getAll: () => {
          catalogReads += 1;
          return [{ provider: "provider-a", id: "gpt-6" }];
        },
        hasConfiguredAuth: () => false,
      },
    });

    expect(result.details.status).toBe("candidate_observed_usable");
    expect(catalogReads).toBe(1);
  });

  test("Given conflicting public and caller evidence, when route advice runs, then caller observation remains authoritative", () => {
    const result = executeModelRouteAdvice({
      toolCallId: "tool-call-03",
      nowMs,
      params: {
        ...params,
        observations: [
          {
            providerId: "provider-a",
            observedAtMs: nowMs - 1,
            expiresAtMs: nowMs + 1,
            coverage: "complete" as const,
            catalogModelIds: ["gpt-6"],
            credential: "unknown" as const,
            runtime: [{ modelId: "gpt-6", status: "unavailable" as const }],
          },
        ],
      },
      registry: {
        getAll: () => [{ provider: "provider-a", id: "gpt-6" }],
        hasConfiguredAuth: () => true,
      },
    });

    expect(result.details.status).toBe("all_candidates_known_unusable");
    expect(result.details.candidates[0]?.credential).toBe("unknown");
  });
});
