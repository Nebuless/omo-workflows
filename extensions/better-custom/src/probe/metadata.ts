import { firstFiniteNumber } from "../url.ts";
import type { ObservedModelMetadata } from "./types.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  return result.length > 0 ? result : undefined;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function defined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function capabilitiesMetadata(value: unknown): ObservedModelMetadata {
  if (Array.isArray(value)) {
    const capabilities = strings(value) ?? [];
    return {
      ...(capabilities.includes("vision") || capabilities.includes("image")
        ? { vision: true }
        : {}),
      ...(capabilities.includes("thinking") ||
      capabilities.includes("reasoning")
        ? { reasoning: true }
        : {}),
    };
  }

  const capabilities = record(value);
  if (!capabilities) return {};
  const vision =
    boolean(capabilities.vision) ??
    boolean(record(capabilities.vision)?.supported);
  const directReasoning =
    boolean(capabilities.reasoning) ?? boolean(capabilities.thinking);
  const reasoning = record(capabilities.reasoning);
  const type = typeof reasoning?.type === "string" ? reasoning.type : undefined;
  const effortOptions = strings(reasoning?.effort_options);
  return {
    ...(defined(vision) ? { vision } : {}),
    ...(type === "none" ? { reasoning: false } : {}),
    ...(type === "minimal" ? { reasoning: true, alwaysThinking: true } : {}),
    ...(type === "effort"
      ? { reasoning: true, ...(effortOptions ? { effortOptions } : {}) }
      : {}),
    ...(type === undefined && defined(directReasoning)
      ? { reasoning: directReasoning }
      : {}),
  };
}

function metadataFromMeta(value: unknown): ObservedModelMetadata {
  const meta = record(value);
  if (!meta) return {};
  const contextWindow = firstFiniteNumber(
    meta,
    "context_window",
    "max_input_tokens",
    "inputTokenLimit",
  );
  const maxTokens = firstFiniteNumber(
    meta,
    "max_tokens",
    "max_output_tokens",
    "outputTokenLimit",
  );
  const capabilityInfo = capabilitiesMetadata(meta.capabilities);
  const vision = capabilityInfo.vision ?? boolean(meta.supports_vision);
  const reasoning =
    capabilityInfo.reasoning ??
    boolean(meta.supports_reasoning) ??
    boolean(meta.thinking);
  const endpointTypes = strings(meta.supported_endpoint_types);
  return {
    ...(defined(contextWindow) ? { contextWindow } : {}),
    ...(defined(maxTokens) ? { maxTokens } : {}),
    ...capabilityInfo,
    ...(defined(vision) ? { vision } : {}),
    ...(defined(reasoning) ? { reasoning } : {}),
    ...(endpointTypes ? { endpointTypes } : {}),
  };
}

/** Parse OpenRouter, One API, New API, and Gemini inline model-list evidence. */
export function metadataFromModelListItem(
  value: unknown,
): ObservedModelMetadata | undefined {
  const item = record(value);
  if (!item) return undefined;
  const contextWindow = firstFiniteNumber(
    item,
    "context_length",
    "context_window",
    "max_input_tokens",
    "inputTokenLimit",
  );
  const maxTokens = firstFiniteNumber(
    item,
    "max_tokens",
    "max_output_tokens",
    "outputTokenLimit",
  );
  const inputModalities =
    strings(record(item.architecture)?.input_modalities) ??
    strings(item.modalities);
  const capabilityInfo = capabilitiesMetadata(item.capabilities);
  const vision = inputModalities
    ? inputModalities.includes("image")
    : (capabilityInfo.vision ?? boolean(item.supports_vision));
  const reasoning =
    boolean(item.reasoning) ??
    capabilityInfo.reasoning ??
    boolean(item.supports_reasoning);
  const endpointTypes = strings(item.supported_endpoint_types);
  const observed = mergeObservedMetadata(
    {
      ...(defined(contextWindow) ? { contextWindow } : {}),
      ...(defined(maxTokens) ? { maxTokens } : {}),
      ...(defined(vision) ? { vision } : {}),
      ...(defined(reasoning) ? { reasoning } : {}),
      ...(endpointTypes ? { endpointTypes } : {}),
      ...capabilityInfo,
    },
    metadataFromMeta(item.meta),
  );
  return hasMetadata(observed) ? observed : undefined;
}

/** Parse rich GET /models/{id} evidence without applying local/default rules. */
export function metadataFromModelDetail(
  value: unknown,
): ObservedModelMetadata | undefined {
  const item = record(value);
  if (!item) return undefined;
  const base = metadataFromModelListItem(item) ?? {};
  const capabilityInfo = capabilitiesMetadata(item.capabilities);
  const observed = mergeObservedMetadata(
    base,
    capabilityInfo,
    metadataFromMeta(item.meta),
  );
  return hasMetadata(observed) ? observed : undefined;
}

export function modelIdFromEntry(value: unknown): string | undefined {
  const item = record(value);
  const raw =
    typeof item?.id === "string"
      ? item.id
      : typeof item?.name === "string"
        ? item.name
        : undefined;
  const id = raw?.trim().replace(/^models\//, "");
  return id || undefined;
}

function namedMetadata(
  entries: unknown,
  nameField: string,
  infoField?: string,
): Map<string, ObservedModelMetadata> {
  const result = new Map<string, ObservedModelMetadata>();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const item = record(entry);
    const id =
      typeof item?.[nameField] === "string"
        ? item[nameField].trim()
        : undefined;
    const metadata = metadataFromModelDetail(
      infoField ? item?.[infoField] : item,
    );
    if (id && metadata) result.set(id, metadata);
  }
  return result;
}

/** Parse LiteLLM GET /model/info, including its nested data envelope. */
export function parseLiteLLMModelInfo(
  value: unknown,
): Map<string, ObservedModelMetadata> {
  const root = record(value);
  const outer = root?.data;
  const entries = Array.isArray(outer) ? outer : record(outer)?.data;
  return namedMetadata(entries, "model_name", "model_info");
}

/** Parse LiteLLM GET /model_group/info. */
export function parseLiteLLMModelGroupInfo(
  value: unknown,
): Map<string, ObservedModelMetadata> {
  const root = record(value);
  return namedMetadata(
    Array.isArray(value) ? value : root?.data,
    "model_group",
  );
}

/** Parse a USTC/New API public model catalog while skipping non-public entries. */
export function parsePublicModelCatalog(
  value: unknown,
): Map<string, ObservedModelMetadata> {
  const entries = Array.isArray(value) ? value : record(value)?.data;
  const result = new Map<string, ObservedModelMetadata>();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const item = record(entry);
    if (
      !item ||
      item.status === "draft" ||
      item.status === "archived" ||
      item.is_visible === false
    )
      continue;
    const id = [item.litellm_model_name, item.model_name, item.id]
      .find(
        (name): name is string =>
          typeof name === "string" && name.trim().length > 0,
      )
      ?.trim();
    const metadata = metadataFromModelDetail(item);
    if (id && metadata) result.set(id, metadata);
  }
  return result;
}

export function metadataFromOllamaTag(
  value: unknown,
): ObservedModelMetadata | undefined {
  const item = record(value);
  if (!item) return undefined;
  const observed = mergeObservedMetadata(
    metadataFromModelDetail(item),
    metadataFromModelDetail(item.details),
  );
  return hasMetadata(observed) ? observed : undefined;
}

export function metadataFromOllamaShow(
  value: unknown,
): ObservedModelMetadata | undefined {
  const item = record(value);
  if (!item) return undefined;
  const modelInfo = record(item.model_info);
  let contextWindow: number | undefined;
  for (const [key, raw] of Object.entries(modelInfo ?? {})) {
    if (
      key.endsWith(".context_length") &&
      typeof raw === "number" &&
      Number.isFinite(raw) &&
      raw > 0
    ) {
      contextWindow = raw;
      break;
    }
  }
  const observed = mergeObservedMetadata(
    metadataFromModelDetail(item),
    metadataFromModelDetail(item.details),
    ...(defined(contextWindow) ? [{ contextWindow }] : []),
  );
  return hasMetadata(observed) ? observed : undefined;
}

/** Later observed responses replace only fields they explicitly supplied. */
export function mergeObservedMetadata(
  ...items: Array<ObservedModelMetadata | undefined>
): ObservedModelMetadata {
  return Object.assign({}, ...items.filter(defined));
}

export function hasMetadata(
  value: ObservedModelMetadata | undefined,
): value is ObservedModelMetadata {
  return Boolean(value && Object.keys(value).length > 0);
}
