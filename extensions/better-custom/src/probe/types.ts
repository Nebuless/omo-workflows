import type { ModelProbeMetadata } from "../model-entry.ts";
import type { GatewayPresetId, ProviderApi } from "../types.ts";

/** Injectable transport keeps discovery deterministic and prevents hidden I/O in tests. */
export type ProbeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface GatewayProbeOptions {
  endpoint: string;
  api: ProviderApi;
  preset?: GatewayPresetId | string;
  /** Resolved key material. It is used only for request headers and never returned. */
  apiKey?: string;
  fetch?: ProbeFetch;
  timeoutMs?: number;
}

/** Only gateway-observed fields are returned; local rules/defaults remain in model-entry. */
export type ObservedModelMetadata = ModelProbeMetadata;

export interface GatewayProbeResult {
  /** The normalized base whose model-list response was accepted, if any. */
  baseUrl: string;
  /** Sorted identifiers from the discovered endpoint. */
  ids: string[];
  /** Metadata evidence keyed by model id. Missing entries mean the gateway provided no evidence. */
  metadataById: Map<string, ObservedModelMetadata>;
  /** Compatibility alias for callers that use the upstream probe terminology. */
  infoById: Map<string, ObservedModelMetadata>;
}

export interface DeveloperRoleProbeOptions {
  endpoint: string;
  modelId: string;
  apiKey?: string;
  fetch?: ProbeFetch;
  timeoutMs?: number;
}

export const PROBE_TIMEOUT_MS = 4_000;
