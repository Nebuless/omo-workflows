export const ROUTE_ADVICE_SCHEMA_VERSION = 1 as const;

export type RouteKind = "category" | "named-agent";
export type RuntimeAvailability = "available" | "unavailable" | "unknown";
export type CredentialEvidence = "ready" | "unknown";
export type Coverage = "complete" | "partial";
export type RouteAdviceStatus =
  | "input_invalid"
  | "candidate_observed_usable"
  | "all_candidates_known_unusable"
  | "inventory_unknown"
  | "inventory_incomplete";

export type RouteCandidate = {
  readonly providerId: string;
  readonly modelId: string;
};

export type RuntimeObservation = {
  readonly modelId: string;
  readonly status: RuntimeAvailability;
};

export type ProviderObservation = {
  readonly providerId: string;
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
  readonly coverage: Coverage;
  readonly catalogModelIds: readonly string[];
  readonly credential: CredentialEvidence;
  readonly runtime: readonly RuntimeObservation[];
  readonly error?: "runtime_error";
};

export type CandidateObservation = RouteCandidate & {
  readonly catalogVisible: boolean;
  readonly credential: CredentialEvidence;
  readonly runtime: RuntimeAvailability;
  readonly dispatch: "unproven";
};

export type ProviderBoundaryNotice = {
  readonly afterCandidateIndex: number;
  readonly fromProviderId: string;
  readonly toProviderId: string;
};

type RouteAdviceReportBase = {
  readonly schemaVersion: typeof ROUTE_ADVICE_SCHEMA_VERSION;
  readonly requestId: string;
  readonly generatedAtMs: number;
  readonly route?: {
    readonly kind: RouteKind;
    readonly key: string;
  };
  readonly candidates: readonly CandidateObservation[];
  readonly providerBoundaries: readonly ProviderBoundaryNotice[];
  readonly truncated: boolean;
};

export type InvalidRouteAdviceReport = RouteAdviceReportBase & {
  readonly status: "input_invalid";
  readonly invalidReason: "invalid_request";
};

export type UsableRouteAdviceReport = RouteAdviceReportBase & {
  readonly status: "candidate_observed_usable";
  readonly firstObservedUsableCandidate: RouteCandidate;
};

export type RouteAdviceReport =
  | InvalidRouteAdviceReport
  | UsableRouteAdviceReport
  | (RouteAdviceReportBase & {
      readonly status:
        | "all_candidates_known_unusable"
        | "inventory_unknown"
        | "inventory_incomplete";
    });

export type EvaluateRouteAdviceInput = {
  readonly requestId: string;
  readonly nowMs: number;
  readonly request: unknown;
  readonly observations: readonly unknown[];
};

export type ModelRouteAdviceParameters = {
  readonly routeKind: RouteKind;
  readonly routeKey: string;
  readonly candidates: readonly RouteCandidate[];
  readonly provenance: {
    readonly source: "caller";
    readonly label?: string;
  };
  readonly observations?: readonly unknown[];
};

export type PublicRegistryModel = {
  readonly provider: string;
  readonly id: string;
};

export type PublicModelRegistry<
  TModel extends PublicRegistryModel = PublicRegistryModel,
> = {
  readonly getAll: () => readonly TModel[];
  readonly hasConfiguredAuth: (model: TModel) => boolean;
};
