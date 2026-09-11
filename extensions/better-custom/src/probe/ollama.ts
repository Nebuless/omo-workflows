import { dedupe, normalizeEndpoint } from "../url.ts";
import {
  mergeObservedMetadata,
  metadataFromOllamaShow,
  metadataFromOllamaTag,
  modelIdFromEntry,
} from "./metadata.ts";
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

function nativeRoot(endpoint: string): string | undefined {
  try {
    const url = new URL(normalizeEndpoint(endpoint, "ollama-chat"));
    if (url.pathname.replace(/\/+$/, "").endsWith("/v1"))
      url.pathname = url.pathname.slice(0, -3) || "/";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function sortedMap(
  map: Map<string, ObservedModelMetadata>,
): Map<string, ObservedModelMetadata> {
  return new Map([...map].sort(([left], [right]) => left.localeCompare(right)));
}

/** Probe Ollama's native tags/show endpoints instead of assuming /models support. */
export async function probeOllama(
  options: GatewayProbeOptions,
): Promise<GatewayProbeResult> {
  const baseUrl = nativeRoot(options.endpoint) ?? options.endpoint.trim();
  const fetcher = resolveFetch(options.fetch);
  const headers = probeHeaders("ollama-chat", options.apiKey);
  const tags = await requestJson(
    fetcher,
    baseUrl.replace(/\/+$/, "") + "/api/tags",
    { headers },
    options.timeoutMs,
  );
  const models = Array.isArray(record(tags)?.models)
    ? (record(tags)?.models as unknown[])
    : [];
  const metadataById = new Map<string, ObservedModelMetadata>();
  const ids = dedupe(
    models.map(modelIdFromEntry).filter((id): id is string => Boolean(id)),
  ).sort();
  for (const tag of models) {
    const id = modelIdFromEntry(tag);
    const metadata = metadataFromOllamaTag(tag);
    if (id && metadata) metadataById.set(id, metadata);
  }
  for (const id of ids) {
    const json = await requestJson(
      fetcher,
      baseUrl.replace(/\/+$/, "") + "/api/show",
      {
        method: "POST",
        headers: probeHeaders("ollama-chat", options.apiKey, true),
        body: JSON.stringify({ name: id }),
      },
      options.timeoutMs,
    );
    const metadata = metadataFromOllamaShow(json);
    if (metadata)
      metadataById.set(
        id,
        mergeObservedMetadata(metadataById.get(id), metadata),
      );
  }
  const sorted = sortedMap(metadataById);
  return { baseUrl, ids, metadataById: sorted, infoById: sorted };
}
