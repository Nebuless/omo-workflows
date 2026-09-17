import type {
  ProviderObservation,
  PublicModelRegistry,
  PublicRegistryModel,
  RouteCandidate,
} from "./types.ts";

export type PublicRegistryObservationInput<
  TModel extends PublicRegistryModel = PublicRegistryModel,
> = {
  readonly candidates: readonly RouteCandidate[];
  readonly nowMs: number;
  readonly registry: PublicModelRegistry<TModel>;
};

function providerCandidates(
  candidates: readonly RouteCandidate[],
): ReadonlyMap<string, readonly RouteCandidate[]> {
  const grouped = new Map<string, RouteCandidate[]>();
  for (const candidate of candidates) {
    const current = grouped.get(candidate.providerId) ?? [];
    current.push(candidate);
    grouped.set(candidate.providerId, current);
  }
  return grouped;
}

function failedObservations(
  candidates: readonly RouteCandidate[],
  nowMs: number,
): readonly ProviderObservation[] {
  return [...providerCandidates(candidates)].map(([providerId, entries]) => ({
    providerId,
    observedAtMs: nowMs,
    expiresAtMs: nowMs,
    coverage: "partial",
    catalogModelIds: [],
    credential: "unknown",
    runtime: entries.map((candidate) => ({
      modelId: candidate.modelId,
      status: "unknown",
    })),
    error: "runtime_error",
  }));
}

export function observePublicRegistry<TModel extends PublicRegistryModel>(
  input: PublicRegistryObservationInput<TModel>,
): readonly ProviderObservation[] {
  let models: readonly TModel[];
  try {
    models = input.registry.getAll();
  } catch {
    return failedObservations(input.candidates, input.nowMs);
  }
  const observations: ProviderObservation[] = [];
  for (const [providerId, candidates] of providerCandidates(input.candidates)) {
    const providerModels = models.filter(
      (model) => model.provider === providerId,
    );
    if (providerModels.length === 0) continue;
    const catalogModelIds = providerModels
      .slice(0, 64)
      .map((model) => model.id);
    let credential: "ready" | "unknown";
    try {
      credential = providerModels.some((model) =>
        input.registry.hasConfiguredAuth(model),
      )
        ? "ready"
        : "unknown";
    } catch {
      return failedObservations(input.candidates, input.nowMs);
    }
    observations.push({
      providerId,
      observedAtMs: input.nowMs,
      expiresAtMs: input.nowMs + 1,
      coverage: "partial",
      catalogModelIds,
      credential,
      runtime: candidates.map((candidate) => ({
        modelId: candidate.modelId,
        status: "unknown",
      })),
    });
  }
  return observations;
}
