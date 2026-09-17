import {
  ROUTE_ADVICE_SCHEMA_VERSION,
  type CandidateObservation,
  type CredentialEvidence,
  type Coverage,
  type EvaluateRouteAdviceInput,
  type ProviderBoundaryNotice,
  type ProviderObservation,
  type RouteAdviceReport,
  type RouteCandidate,
  type RouteKind,
  type RuntimeAvailability,
  type RuntimeObservation,
} from "./types.ts";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const MAX_CANDIDATES = 8;
const MAX_BOUNDARIES = 7;
const MAX_OBSERVATIONS = 128;
const MAX_OBSERVATION_ITEMS = 64;
const MAX_INPUT_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isIdentifier(value: unknown): value is string {
  return (
    isString(value) && utf8ByteLength(value) <= 128 && IDENTIFIER.test(value)
  );
}

function isBoundedInput(value: unknown): boolean {
  try {
    return utf8ByteLength(JSON.stringify(value)) <= MAX_INPUT_BYTES;
  } catch {
    return false;
  }
}

function isRouteKind(value: unknown): value is RouteKind {
  return value === "category" || value === "named-agent";
}

function isCoverage(value: unknown): value is Coverage {
  return value === "complete" || value === "partial";
}

function isCredentialEvidence(value: unknown): value is CredentialEvidence {
  return value === "ready" || value === "unknown";
}

function isRuntimeAvailability(value: unknown): value is RuntimeAvailability {
  return (
    value === "available" || value === "unavailable" || value === "unknown"
  );
}

function parseCandidate(value: unknown): RouteCandidate | null {
  if (!isRecord(value) || Object.keys(value).length !== 2) return null;
  if (!isIdentifier(value.providerId) || !isIdentifier(value.modelId))
    return null;
  return { providerId: value.providerId, modelId: value.modelId };
}

function parseRequest(value: unknown): {
  readonly kind: RouteKind;
  readonly key: string;
  readonly candidates: readonly RouteCandidate[];
} | null {
  if (!isRecord(value)) return null;
  if (
    Object.keys(value).length !== 4 ||
    !isRouteKind(value.routeKind) ||
    !isIdentifier(value.routeKey) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length === 0 ||
    value.candidates.length > 64 ||
    !isRecord(value.provenance)
  ) {
    return null;
  }
  const provenanceKeys = Object.keys(value.provenance);
  if (
    provenanceKeys.some((key) => key !== "source" && key !== "label") ||
    value.provenance.source !== "caller" ||
    (value.provenance.label !== undefined &&
      (!isString(value.provenance.label) ||
        utf8ByteLength(value.provenance.label) > 128))
  ) {
    return null;
  }
  const candidates: RouteCandidate[] = [];
  for (const candidateValue of value.candidates) {
    const candidate = parseCandidate(candidateValue);
    if (!candidate) return null;
    candidates.push(candidate);
  }
  return { kind: value.routeKind, key: value.routeKey, candidates };
}

function parseRuntimeObservation(value: unknown): RuntimeObservation | null {
  if (!isRecord(value) || Object.keys(value).length !== 2) return null;
  if (!isIdentifier(value.modelId) || !isRuntimeAvailability(value.status))
    return null;
  return { modelId: value.modelId, status: value.status };
}

function parseObservation(value: unknown): ProviderObservation | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        key !== "providerId" &&
        key !== "observedAtMs" &&
        key !== "expiresAtMs" &&
        key !== "coverage" &&
        key !== "catalogModelIds" &&
        key !== "credential" &&
        key !== "runtime" &&
        key !== "error",
    ) ||
    !isIdentifier(value.providerId) ||
    !isFiniteNumber(value.observedAtMs) ||
    !isFiniteNumber(value.expiresAtMs) ||
    !isCoverage(value.coverage) ||
    !Array.isArray(value.catalogModelIds) ||
    value.catalogModelIds.length > MAX_OBSERVATION_ITEMS ||
    !value.catalogModelIds.every(isIdentifier) ||
    !isCredentialEvidence(value.credential) ||
    !Array.isArray(value.runtime) ||
    value.runtime.length > MAX_OBSERVATION_ITEMS
  ) {
    return null;
  }
  const runtime: RuntimeObservation[] = [];
  for (const runtimeValue of value.runtime) {
    const entry = parseRuntimeObservation(runtimeValue);
    if (!entry) return null;
    runtime.push(entry);
  }
  if (value.error !== undefined && value.error !== "runtime_error") return null;
  return {
    providerId: value.providerId,
    observedAtMs: value.observedAtMs,
    expiresAtMs: value.expiresAtMs,
    coverage: value.coverage,
    catalogModelIds: value.catalogModelIds,
    credential: value.credential,
    runtime,
    ...(value.error === "runtime_error" ? { error: value.error } : {}),
  };
}

function invalidReport(input: EvaluateRouteAdviceInput): RouteAdviceReport {
  return {
    schemaVersion: ROUTE_ADVICE_SCHEMA_VERSION,
    requestId: isIdentifier(input.requestId)
      ? input.requestId
      : "invalid-request",
    generatedAtMs: isFiniteNumber(input.nowMs) ? input.nowMs : 0,
    status: "input_invalid",
    invalidReason: "invalid_request",
    candidates: [],
    providerBoundaries: [],
    truncated: false,
  };
}

function boundaryNotices(
  candidates: readonly RouteCandidate[],
): readonly ProviderBoundaryNotice[] {
  const notices: ProviderBoundaryNotice[] = [];
  for (
    let index = 1;
    index < candidates.length && notices.length < MAX_BOUNDARIES;
    index += 1
  ) {
    const previous = candidates[index - 1];
    const next = candidates[index];
    if (
      previous === undefined ||
      next === undefined ||
      previous.providerId === next.providerId
    )
      continue;
    notices.push({
      afterCandidateIndex: index - 1,
      fromProviderId: previous.providerId,
      toProviderId: next.providerId,
    });
  }
  return notices;
}

function candidateObservation(
  candidate: RouteCandidate,
  observation: ProviderObservation | undefined,
): CandidateObservation {
  const runtime = observation?.runtime.find(
    (entry) => entry.modelId === candidate.modelId,
  );
  return {
    ...candidate,
    catalogVisible:
      observation?.catalogModelIds.includes(candidate.modelId) ?? false,
    credential: observation?.credential ?? "unknown",
    runtime: runtime?.status ?? "unknown",
    dispatch: "unproven",
  };
}

function reportStatus(
  candidates: readonly CandidateObservation[],
  requiredProviders: ReadonlySet<string>,
  observations: ReadonlyMap<string, ProviderObservation>,
  nowMs: number,
): Exclude<RouteAdviceReport["status"], "input_invalid"> {
  for (const providerId of requiredProviders) {
    const observation = observations.get(providerId);
    if (!observation || observation.expiresAtMs <= nowMs || observation.error) {
      return "inventory_unknown";
    }
    if (observation.coverage !== "complete") return "inventory_incomplete";
  }
  if (candidates.some((candidate) => candidate.runtime === "available")) {
    return "candidate_observed_usable";
  }
  if (candidates.every((candidate) => candidate.runtime === "unavailable")) {
    return "all_candidates_known_unusable";
  }
  return "inventory_incomplete";
}

export function evaluateRouteAdvice(
  input: EvaluateRouteAdviceInput,
): RouteAdviceReport {
  const request = parseRequest(input.request);
  if (
    !isIdentifier(input.requestId) ||
    !isFiniteNumber(input.nowMs) ||
    !request ||
    !Array.isArray(input.observations) ||
    input.observations.length > MAX_OBSERVATIONS ||
    !isBoundedInput({
      request: input.request,
      observations: input.observations,
    })
  ) {
    return invalidReport(input);
  }
  const observations = new Map<string, ProviderObservation>();
  for (const value of input.observations) {
    const observation = parseObservation(value);
    if (!observation) return invalidReport(input);
    observations.set(observation.providerId, observation);
  }
  const allCandidateObservations = request.candidates.map((candidate) =>
    candidateObservation(candidate, observations.get(candidate.providerId)),
  );
  const candidateObservations = allCandidateObservations.slice(
    0,
    MAX_CANDIDATES,
  );
  const requiredProviders = new Set(
    request.candidates.map((candidate) => candidate.providerId),
  );
  const status = reportStatus(
    allCandidateObservations,
    requiredProviders,
    observations,
    input.nowMs,
  );
  const base = {
    schemaVersion: ROUTE_ADVICE_SCHEMA_VERSION,
    requestId: input.requestId,
    generatedAtMs: input.nowMs,
    route: { kind: request.kind, key: request.key },
    candidates: candidateObservations,
    providerBoundaries: boundaryNotices(candidateObservations),
    truncated: request.candidates.length > MAX_CANDIDATES,
  } as const;
  if (status !== "candidate_observed_usable") return { ...base, status };
  const first = allCandidateObservations.find(
    (candidate) => candidate.runtime === "available",
  );
  if (!first) return invalidReport(input);
  return {
    ...base,
    status,
    firstObservedUsableCandidate: {
      providerId: first.providerId,
      modelId: first.modelId,
    },
  };
}
