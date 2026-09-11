import { gatewayPreset } from "../presets.ts";
import {
  dedupe,
  isLocalHost,
  modelBaseCandidates,
  normalizeEndpoint,
} from "../url.ts";
import type { ProviderApi } from "../types.ts";
import {
  mergeObservedMetadata,
  metadataFromModelDetail,
  metadataFromModelListItem,
  modelIdFromEntry,
  parseLiteLLMModelGroupInfo,
  parseLiteLLMModelInfo,
  parsePublicModelCatalog,
} from "./metadata.ts";
import { probeOllama } from "./ollama.ts";
import { probeHeaders, requestJson, resolveFetch } from "./request.ts";
import type {
  GatewayProbeOptions,
  GatewayProbeResult,
  ObservedModelMetadata,
} from "./types.ts";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function modelEntries(value: unknown): unknown[] | undefined {
  const root = record(value);
  if (!root) return undefined;
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(root.models)) return root.models;
  return undefined;
}

function sortedMap(
  map: Map<string, ObservedModelMetadata>,
): Map<string, ObservedModelMetadata> {
  return new Map([...map].sort(([left], [right]) => left.localeCompare(right)));
}

function mergeMap(
  target: Map<string, ObservedModelMetadata>,
  source: ReadonlyMap<string, ObservedModelMetadata>,
  overwrite: boolean,
): void {
  for (const [id, metadata] of source) {
    const existing = target.get(id);
    target.set(
      id,
      overwrite
        ? mergeObservedMetadata(existing, metadata)
        : mergeObservedMetadata(metadata, existing),
    );
  }
}

function rootCandidates(baseUrl: string): string[] {
  try {
    const url = new URL(baseUrl);
    const origin = url.origin;
    const trimmed = baseUrl.replace(/\/+$/, "");
    return dedupe(origin === trimmed ? [trimmed] : [origin, trimmed]);
  } catch {
    return [baseUrl.replace(/\/+$/, "")];
  }
}

function secureRoots(roots: string[]): string[] {
  const secure: string[] = [];
  for (const root of roots) {
    try {
      const url = new URL(root);
      if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
        url.protocol = "https:";
        secure.push(url.toString().replace(/\/+$/, ""));
      }
    } catch {
      // Invalid URLs are already evidence-free at the caller boundary.
    }
  }
  return dedupe([...roots, ...secure]);
}

function publicCatalogRoots(baseUrl: string): string[] {
  try {
    const url = new URL(baseUrl);
    const site = new URL(url.origin);
    site.hostname = site.hostname.replace(/^api\./i, "llm.");
    return secureRoots(dedupe([url.origin, site.origin]));
  } catch {
    return [baseUrl.replace(/\/+$/, "")];
  }
}

async function firstParsedMap(
  urls: readonly string[],
  parse: (value: unknown) => Map<string, ObservedModelMetadata>,
  options: GatewayProbeOptions,
  includeApiKey = true,
): Promise<Map<string, ObservedModelMetadata>> {
  const fetcher = resolveFetch(options.fetch);
  const headers = probeHeaders(
    options.api,
    includeApiKey ? options.apiKey : undefined,
  );
  for (const url of urls) {
    const json = await requestJson(
      fetcher,
      url,
      { headers },
      options.timeoutMs,
    );
    if (json === undefined) continue;
    const parsed = parse(json);
    if (parsed.size > 0) return parsed;
  }
  return new Map();
}

async function fetchModelList(
  endpoint: string,
  api: ProviderApi,
  options: GatewayProbeOptions,
  ensureV1: boolean,
): Promise<{
  baseUrl: string;
  ids: string[];
  metadataById: Map<string, ObservedModelMetadata>;
}> {
  const fetcher = resolveFetch(options.fetch);
  const headers = probeHeaders(api, options.apiKey);
  const candidates = modelBaseCandidates(endpoint, api, ensureV1);
  for (const baseUrl of candidates) {
    const json = await requestJson(
      fetcher,
      new URL(
        "models",
        baseUrl.endsWith("/") ? baseUrl : baseUrl + "/",
      ).toString(),
      { headers },
      options.timeoutMs,
    );
    const entries = modelEntries(json);
    if (!entries) continue;

    const ids: string[] = [];
    const metadataById = new Map<string, ObservedModelMetadata>();
    for (const entry of entries) {
      const id = modelIdFromEntry(entry);
      if (!id) continue;
      ids.push(id);
      const metadata = metadataFromModelListItem(entry);
      if (metadata) metadataById.set(id, metadata);
    }
    return { baseUrl, ids: dedupe(ids).sort(), metadataById };
  }
  return {
    baseUrl: candidates[0] ?? endpoint,
    ids: [],
    metadataById: new Map(),
  };
}

async function fetchPerModelDetails(
  baseUrl: string,
  ids: readonly string[],
  options: GatewayProbeOptions,
): Promise<Map<string, ObservedModelMetadata>> {
  const fetcher = resolveFetch(options.fetch);
  const headers = probeHeaders(options.api, options.apiKey);
  const result = new Map<string, ObservedModelMetadata>();
  for (const id of ids) {
    const url = new URL(
      "models/" + encodeURIComponent(id),
      baseUrl.endsWith("/") ? baseUrl : baseUrl + "/",
    ).toString();
    const json = await requestJson(
      fetcher,
      url,
      { headers },
      options.timeoutMs,
    );
    const metadata = metadataFromModelDetail(json);
    if (metadata) result.set(id, metadata);
  }
  return result;
}

/**
 * Discover only evidence the gateway actually returns. Timeout, network, and
 * non-2xx paths are absence, never error text or credential-bearing results.
 */
export async function probeGateway(
  options: GatewayProbeOptions,
): Promise<GatewayProbeResult> {
  if (options.api === "ollama-chat") return probeOllama(options);

  let normalized: string;
  try {
    normalized = normalizeEndpoint(options.endpoint, options.api);
  } catch {
    const absent = new Map<string, ObservedModelMetadata>();
    return {
      baseUrl: options.endpoint.trim(),
      ids: [],
      metadataById: absent,
      infoById: absent,
    };
  }

  const preset = gatewayPreset(options.preset);
  const list = await fetchModelList(
    normalized,
    options.api,
    options,
    preset.ensureV1,
  );
  const metadataById = new Map(list.metadataById);

  if (preset.profile.modelInfo) {
    mergeMap(
      metadataById,
      await firstParsedMap(
        rootCandidates(list.baseUrl).map((root) => root + "/model/info"),
        parseLiteLLMModelInfo,
        options,
      ),
      true,
    );
  }
  if (preset.profile.modelGroupInfo && options.apiKey) {
    mergeMap(
      metadataById,
      await firstParsedMap(
        rootCandidates(list.baseUrl).map((root) => root + "/model_group/info"),
        parseLiteLLMModelGroupInfo,
        options,
      ),
      false,
    );
  }
  if (preset.profile.publicCatalog) {
    mergeMap(
      metadataById,
      await firstParsedMap(
        publicCatalogRoots(list.baseUrl).map(
          (root) => root + "/api/models/public",
        ),
        parsePublicModelCatalog,
        options,
        false,
      ),
      true,
    );
  }
  if (preset.profile.perModelDetails) {
    mergeMap(
      metadataById,
      await fetchPerModelDetails(list.baseUrl, list.ids, options),
      false,
    );
  }

  const sorted = sortedMap(metadataById);
  return {
    baseUrl: list.baseUrl,
    ids: list.ids,
    metadataById: sorted,
    infoById: sorted,
  };
}

export { probeDeveloperRole } from "./developer-role.ts";
export {
  hasMetadata,
  mergeObservedMetadata,
  metadataFromModelDetail,
  metadataFromModelListItem,
  metadataFromOllamaShow,
  metadataFromOllamaTag,
  parseLiteLLMModelGroupInfo,
  parseLiteLLMModelInfo,
  parsePublicModelCatalog,
} from "./metadata.ts";
export type {
  DeveloperRoleProbeOptions,
  GatewayProbeOptions,
  GatewayProbeResult,
  ObservedModelMetadata,
  ProbeFetch,
} from "./types.ts";
