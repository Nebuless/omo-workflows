import { describe, expect, test } from "bun:test";
import { evaluateRouteAdvice } from "../src/advice.ts";

const nowMs = 1_700_000_000_000;

function request(candidates: readonly Record<string, unknown>[]) {
  return {
    routeKind: "category",
    routeKey: "deep",
    candidates,
    provenance: { source: "caller", label: "preflight" },
  };
}

function observation(input: {
  readonly providerId: string;
  readonly coverage?: "complete" | "partial";
  readonly expiresAtMs?: number;
  readonly runtime?: readonly Record<string, unknown>[];
}) {
  return {
    providerId: input.providerId,
    observedAtMs: nowMs - 100,
    expiresAtMs: input.expiresAtMs ?? nowMs + 1_000,
    coverage: input.coverage ?? "complete",
    catalogModelIds: ["gpt-6"],
    credential: "unknown",
    runtime: input.runtime ?? [{ modelId: "gpt-6", status: "unknown" }],
  };
}

function evaluate(input: unknown) {
  return evaluateRouteAdvice({
    requestId: "request-01",
    nowMs,
    request: input,
    observations: [
      observation({
        providerId: "provider-a",
        runtime: [{ modelId: "gpt-6", status: "available" }],
      }),
      observation({
        providerId: "provider-b",
        runtime: [{ modelId: "gpt-5", status: "unknown" }],
      }),
    ],
  });
}

describe("route advice evaluator", () => {
  test("Given secret-bearing provenance, when advice is evaluated, then it returns input_invalid without secret data", () => {
    const report = evaluate({
      ...request([{ providerId: "provider-a", modelId: "gpt-6" }]),
      provenance: { source: "caller", token: "secret-value" },
    });

    expect(report.status).toBe("input_invalid");
    expect(JSON.stringify(report)).not.toContain("secret-value");
  });

  test("Given empty or noncanonical candidates, when advice is evaluated, then it returns input_invalid", () => {
    expect(evaluate(request([])).status).toBe("input_invalid");
    expect(
      evaluate(request([{ providerId: "bad provider", modelId: "gpt-6" }]))
        .status,
    ).toBe("input_invalid");
  });

  test("Given fresh complete usable evidence, when advice is evaluated, then it observes first usable candidate without selecting it", () => {
    const report = evaluate(
      request([
        { providerId: "provider-a", modelId: "gpt-6" },
        { providerId: "provider-b", modelId: "gpt-5" },
      ]),
    );

    expect(report.status).toBe("candidate_observed_usable");
    if (report.status !== "candidate_observed_usable")
      throw new Error("expected usable report");
    expect(report.firstObservedUsableCandidate).toEqual({
      providerId: "provider-a",
      modelId: "gpt-6",
    });
    expect(report.providerBoundaries).toEqual([
      {
        afterCandidateIndex: 0,
        fromProviderId: "provider-a",
        toProviderId: "provider-b",
      },
    ]);
  });

  test("Given fresh complete unavailable evidence for every candidate, when advice is evaluated, then it reports all candidates known unusable", () => {
    const report = evaluateRouteAdvice({
      requestId: "request-02",
      nowMs,
      request: request([{ providerId: "provider-a", modelId: "gpt-6" }]),
      observations: [
        observation({
          providerId: "provider-a",
          runtime: [{ modelId: "gpt-6", status: "unavailable" }],
        }),
      ],
    });

    expect(report.status).toBe("all_candidates_known_unusable");
  });

  test("Given a stale observation, when advice is evaluated, then it refuses a negative conclusion", () => {
    const report = evaluateRouteAdvice({
      requestId: "request-03",
      nowMs,
      request: request([{ providerId: "provider-a", modelId: "gpt-6" }]),
      observations: [
        observation({
          providerId: "provider-a",
          expiresAtMs: nowMs - 1,
          runtime: [{ modelId: "gpt-6", status: "unavailable" }],
        }),
      ],
    });

    expect(report.status).toBe("inventory_unknown");
  });

  test("Given partial provider coverage, when advice is evaluated, then it reports inventory_incomplete", () => {
    const report = evaluateRouteAdvice({
      requestId: "request-04",
      nowMs,
      request: request([{ providerId: "provider-a", modelId: "gpt-6" }]),
      observations: [
        observation({
          providerId: "provider-a",
          coverage: "partial",
          runtime: [{ modelId: "gpt-6", status: "unavailable" }],
        }),
      ],
    });

    expect(report.status).toBe("inventory_incomplete");
  });

  test("Given more candidates than report can include, when advice is evaluated, then it preserves identity and reports truncation", () => {
    const report = evaluateRouteAdvice({
      requestId: "request-05",
      nowMs,
      request: request(
        Array.from({ length: 12 }, (_, index) => ({
          providerId: `provider-${index}`,
          modelId: "gpt-6",
        })),
      ),
      observations: [],
    });

    expect(report.requestId).toBe("request-05");
    expect(report.truncated).toBe(true);
    expect(report.candidates.length).toBeLessThan(12);
  });

  test("Given a usable candidate beyond report detail bounds, when advice is evaluated, then it does not claim all candidates are unusable", () => {
    const candidates = Array.from({ length: 9 }, (_, index) => ({
      providerId: "provider-a",
      modelId: `gpt-${index}`,
    }));
    const report = evaluateRouteAdvice({
      requestId: "request-06",
      nowMs,
      request: request(candidates),
      observations: [
        observation({
          providerId: "provider-a",
          runtime: candidates.map((candidate, index) => ({
            modelId: candidate.modelId,
            status: index === 8 ? "available" : "unavailable",
          })),
        }),
      ],
    });

    expect(report.status).toBe("candidate_observed_usable");
    if (report.status !== "candidate_observed_usable")
      throw new Error("expected usable report");
    expect(report.firstObservedUsableCandidate).toEqual({
      providerId: "provider-a",
      modelId: "gpt-8",
    });
    expect(report.truncated).toBe(true);
  });

  test("Given oversized observation data or UTF-8 provenance, when advice is evaluated, then it returns input_invalid", () => {
    const validRequest = request([
      { providerId: "provider-a", modelId: "gpt-6" },
    ]);
    const oversizedObservations = Array.from({ length: 129 }, () =>
      observation({ providerId: "provider-a" }),
    );
    expect(
      evaluateRouteAdvice({
        requestId: "request-07",
        nowMs,
        request: validRequest,
        observations: oversizedObservations,
      }).status,
    ).toBe("input_invalid");
    expect(
      evaluate({
        ...validRequest,
        provenance: { source: "caller", label: "😀".repeat(33) },
      }).status,
    ).toBe("input_invalid");
  });
});
