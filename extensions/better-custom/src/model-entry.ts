import { serializeApiKey } from "./api-key.ts";
import type {
  ModelOptions,
  ModelProbeInfo,
  ProviderApi,
  ProviderConfig,
  ProviderStyle,
  ReasoningCeiling,
  ThinkingLevelMap,
} from "./types.ts";
import { PI_THINKING_LEVELS, REASONING_LEVELS } from "./types.ts";

export interface HostModelEntry extends Record<string, unknown> {
  id: string;
  api?: ProviderApi;
  baseUrl?: string;
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  input?: Array<"text" | "image">;
  reasoning?: boolean;
  thinking?: HostThinkingConfig;
  thinkingLevelMap?: ThinkingLevelMap;
  compat?: Record<string, unknown>;
}

export interface HostThinkingConfig {
  mode: "effort";
  efforts: string[];
  defaultLevel?: ReasoningEffort;
  effortMap?: Record<string, string>;
}

export type ReasoningEffort = Exclude<ReasoningCeiling, "off">;

export interface ModelProbeMetadata extends Partial<ModelProbeInfo> {
  id?: string;
  api?: ProviderApi;
  alwaysThinking?: boolean;
  effortOptions?: readonly string[];
  thinkingLevelMap?: ThinkingLevelMap;
  input?: readonly string[];
  baseUrl?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}

export type LocalModelInfo = Partial<ModelProbeMetadata>;

const EFFORTS = REASONING_LEVELS.filter(
  (level): level is ReasoningEffort => level !== "off",
);
const EFFORT_ALIASES: Record<string, ReasoningEffort | "off"> = {
  none: "off",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
  extended: "xhigh",
};

const DEFAULT_MODEL_INFO: Pick<ModelProbeMetadata, "vision" | "reasoning"> = {
  vision: false,
  reasoning: true,
};

type KnownRule = {
  pattern: RegExp;
  contextWindow?: number;
  vision?: boolean;
  reasoning?: boolean;
};

const KNOWN_MODEL_RULES: readonly KnownRule[] = [
  {
    pattern: /^gpt-5-mini/i,
    contextWindow: 128000,
    vision: true,
    reasoning: true,
  },
  { pattern: /^gpt-5-nano/i, contextWindow: 128000, reasoning: true },
  { pattern: /^gpt-5/i, contextWindow: 272000, vision: true, reasoning: true },
  { pattern: /^gpt-4\.1/i, contextWindow: 1047576, vision: true },
  { pattern: /^gpt-4o-mini/i, contextWindow: 128000, vision: true },
  { pattern: /^gpt-4o/i, contextWindow: 128000, vision: true },
  { pattern: /^gpt-4-turbo/i, contextWindow: 128000, vision: true },
  { pattern: /^gpt-4-32k/i, contextWindow: 32768 },
  { pattern: /^gpt-4/i, contextWindow: 8192 },
  { pattern: /^gpt-3\.5-turbo/i, contextWindow: 16385 },
  {
    pattern: /^o4-mini/i,
    contextWindow: 200000,
    vision: true,
    reasoning: true,
  },
  { pattern: /^o4/i, contextWindow: 200000, vision: true, reasoning: true },
  { pattern: /^o3-mini/i, contextWindow: 200000, reasoning: true },
  { pattern: /^o3/i, contextWindow: 200000, reasoning: true },
  { pattern: /^o1-preview/i, contextWindow: 200000, reasoning: true },
  { pattern: /^o1-mini/i, contextWindow: 128000, reasoning: true },
  { pattern: /^o1/i, contextWindow: 200000, reasoning: true },
  {
    pattern: /^gpt-oss/i,
    contextWindow: 128000,
    vision: true,
    reasoning: true,
  },
  {
    pattern: /^claude-(opus|sonnet|haiku)-4-6/i,
    contextWindow: 200000,
    vision: true,
    reasoning: true,
  },
  {
    pattern: /^claude-(opus|sonnet|haiku)-4-5/i,
    contextWindow: 1000000,
    vision: true,
    reasoning: true,
  },
  {
    pattern: /^claude-(opus|sonnet|haiku)-4/i,
    contextWindow: 200000,
    vision: true,
    reasoning: true,
  },
  {
    pattern: /^claude-3-7-sonnet/i,
    contextWindow: 200000,
    vision: true,
    reasoning: true,
  },
  { pattern: /^claude-3-5-sonnet/i, contextWindow: 200000, vision: true },
  { pattern: /^claude-3-5-haiku/i, contextWindow: 200000, vision: true },
  { pattern: /^claude-3/i, contextWindow: 200000, vision: true },
  {
    pattern: /^deepseek-v4/i,
    contextWindow: 1000000,
    vision: false,
    reasoning: true,
  },
  {
    pattern: /^deepseek-(chat|reasoner|v3|r1)/i,
    contextWindow: 128000,
    vision: false,
    reasoning: true,
  },
  { pattern: /^deepseek-coder/i, contextWindow: 16384 },
  {
    pattern: /^qwen[0-9.]*-non-thinking/i,
    contextWindow: 262144,
    reasoning: false,
  },
  {
    pattern: /^qwen[^ ]*(thinking|reasoner)/i,
    contextWindow: 262144,
    reasoning: true,
  },
  { pattern: /^qwen2\.5-turbo/i, contextWindow: 1000000 },
  { pattern: /^qwen[^ ]*-vl/i, contextWindow: 131072, vision: true },
  { pattern: /^qwen-long/i, contextWindow: 10000000 },
  { pattern: /^qwen-max/i, contextWindow: 131072 },
  { pattern: /^qwen-plus/i, contextWindow: 131072 },
  { pattern: /^qwen-turbo/i, contextWindow: 131072 },
  { pattern: /^qwen2\.5-coder/i, contextWindow: 131072 },
  { pattern: /^qwen2\.5/i, contextWindow: 131072 },
  { pattern: /^qwen2/i, contextWindow: 32768 },
  { pattern: /^qwen3-coder/i, contextWindow: 131072, reasoning: true },
  { pattern: /^qwen3\.(5|6|8)/i, contextWindow: 262144, reasoning: true },
  { pattern: /^qwen-chat/i, contextWindow: 262000 },
  { pattern: /^qwen3/i, contextWindow: 131072, reasoning: true },
  { pattern: /^qwen1\.5/i, contextWindow: 32768 },
  { pattern: /^qwen/i, contextWindow: 131072 },
  { pattern: /^k3$/i, contextWindow: 1000000, reasoning: true },
  { pattern: /^moonshotai\/kimi-k2/i, contextWindow: 262144, reasoning: true },
  { pattern: /^kimi-k2/i, contextWindow: 262144, reasoning: true },
  { pattern: /^kimi-k1\.5/i, contextWindow: 131072, reasoning: true },
  { pattern: /^moonshot-v1-128k/i, contextWindow: 131072 },
  { pattern: /^moonshot-v1-32k/i, contextWindow: 32768 },
  { pattern: /^moonshot-v1-8k/i, contextWindow: 8192 },
  { pattern: /^moonshot-v1/i, contextWindow: 131072 },
  { pattern: /^kimi-latest/i, contextWindow: 131072 },
  { pattern: /^kimi/i, contextWindow: 131072 },
  { pattern: /^glm-5/i, contextWindow: 128000, reasoning: true },
  { pattern: /^glm-z1/i, contextWindow: 128000, reasoning: true },
  { pattern: /^glm-4\.5/i, contextWindow: 128000, reasoning: true },
  { pattern: /^glm-4v/i, contextWindow: 8192, vision: true },
  { pattern: /^glm-4-long/i, contextWindow: 1024000 },
  { pattern: /^glm-4/i, contextWindow: 128000 },
  { pattern: /^glm/i, contextWindow: 128000 },
  {
    pattern: /^gemini-(1\.5|2\.0|2\.5|3)/i,
    contextWindow: 1000000,
    vision: true,
  },

  { pattern: /^llama(3|4)/i, contextWindow: 131072 },
  { pattern: /^mistral-(large|small|medium)/i, contextWindow: 128000 },
];
const NATIVE_LEVELS = {
  off: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
} as const;

const NATIVE_9ROUTER_PROFILES: Readonly<Record<string, ModelOptions>> = {
  "cx/gpt-5.6-luna": {
    thinkingLevelMap: {
      ...NATIVE_LEVELS,
      minimal: "low",
      xhigh: "max",
    },
    compat: { supportsReasoningEffort: true },
  },
  "cx/gpt-5.6-sol": {
    thinkingLevelMap: { ...NATIVE_LEVELS, xhigh: "ultra" },
    compat: { supportsReasoningEffort: true },
  },
  "cx/gpt-5.6-terra": {
    thinkingLevelMap: { ...NATIVE_LEVELS, xhigh: "ultra" },
    compat: { supportsReasoningEffort: true },
  },
};

function staticProfile(
  providerId: string | undefined,
  api: ProviderApi | undefined,
  modelId: string,
): ModelOptions | undefined {
  if (providerId !== "9router" || api !== "openai-completions")
    return undefined;
  const profile = NATIVE_9ROUTER_PROFILES[modelId.trim()];
  return profile
    ? {
        ...profile,
        thinkingLevelMap: normalizeThinkingLevelMap(profile.thinkingLevelMap),
        compat: { ...profile.compat },
      }
    : undefined;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

function canonicalEffort(value: unknown): ReasoningEffort | "off" | undefined {
  if (typeof value !== "string") return undefined;
  return EFFORT_ALIASES[value.trim().toLowerCase()];
}

function normalizeModelId(id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) return [""];
  const variants = [trimmed];
  const slash = trimmed.lastIndexOf("/");
  if (slash >= 0 && slash + 1 < trimmed.length)
    variants.push(trimmed.slice(slash + 1));
  const colon = trimmed.lastIndexOf(":");
  if (colon >= 0 && colon + 1 < trimmed.length)
    variants.push(trimmed.slice(colon + 1));
  return [...new Set(variants)];
}

export function localModelInfo(modelId: string): LocalModelInfo | undefined {
  const info: LocalModelInfo = {};
  let matched = false;
  for (const rule of KNOWN_MODEL_RULES) {
    if (
      !normalizeModelId(modelId).some((variant) => rule.pattern.test(variant))
    )
      continue;
    matched = true;
    if (info.contextWindow === undefined && rule.contextWindow !== undefined)
      info.contextWindow = rule.contextWindow;
    if (info.vision === undefined && rule.vision !== undefined)
      info.vision = rule.vision;
    if (info.reasoning === undefined && rule.reasoning !== undefined)
      info.reasoning = rule.reasoning;
    if (
      info.contextWindow !== undefined &&
      info.vision !== undefined &&
      info.reasoning !== undefined
    )
      break;
  }
  return matched ? info : undefined;
}

export function resolveModelInfo(
  modelId: string,
  detected?: ModelProbeMetadata,
): ModelProbeMetadata {
  const local = localModelInfo(modelId);
  const resolved: ModelProbeMetadata = { ...(detected ?? {}) };
  if (local) {
    if (
      resolved.contextWindow === undefined &&
      local.contextWindow !== undefined
    )
      resolved.contextWindow = local.contextWindow;
    if (resolved.vision === undefined && local.vision !== undefined)
      resolved.vision = local.vision;
    if (resolved.reasoning === undefined && local.reasoning !== undefined)
      resolved.reasoning = local.reasoning;
  }
  if (resolved.vision === undefined)
    resolved.vision = DEFAULT_MODEL_INFO.vision;
  if (resolved.reasoning === undefined)
    resolved.reasoning = DEFAULT_MODEL_INFO.reasoning;
  return resolved;
}

export function applyKnownModelFallback(
  modelId: string,
  detected?: ModelProbeMetadata,
): ModelProbeMetadata | undefined {
  if (!detected && !localModelInfo(modelId)) return undefined;
  return resolveModelInfo(modelId, detected);
}

export function normalizeThinkingLevelMap(
  value: unknown,
): ThinkingLevelMap | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== PI_THINKING_LEVELS.length ||
    PI_THINKING_LEVELS.some((level) => !Object.hasOwn(record, level))
  )
    return undefined;
  const map = Object.fromEntries(
    PI_THINKING_LEVELS.map((level) => [level, null]),
  ) as ThinkingLevelMap;
  for (const level of PI_THINKING_LEVELS) {
    const raw = record[level];
    if (raw === null) continue;
    if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
    map[level] = raw.trim();
  }
  return map;
}

function mapFromEffortOptions(options: readonly string[]): ThinkingLevelMap {
  const map = Object.fromEntries(
    PI_THINKING_LEVELS.map((level) => [level, null]),
  ) as ThinkingLevelMap;
  const chosen = new Map<ReasoningEffort | "off", string>();
  for (const raw of options) {
    const value = typeof raw === "string" ? raw.trim() : "";
    const level = canonicalEffort(value);
    if (level !== undefined && !chosen.has(level)) chosen.set(level, value);
  }
  for (const level of PI_THINKING_LEVELS)
    map[level] = chosen.get(level) ?? null;
  return map;
}

export function thinkingFromLevelMap(
  map: ThinkingLevelMap | undefined,
): HostThinkingConfig | undefined {
  if (!map) return undefined;
  const effortMap: Record<string, string> = {};
  const efforts: ReasoningEffort[] = [];
  for (const level of EFFORTS) {
    let raw: unknown = map[level];
    if (raw === undefined) {
      for (const [key, value] of Object.entries(map)) {
        if (canonicalEffort(key) === level) {
          raw = value;
          break;
        }
      }
    }
    if (raw === undefined || raw === null || typeof raw !== "string") continue;
    efforts.push(level);
    effortMap[level] = raw;
  }
  if (efforts.length === 0) return undefined;
  const highest = efforts[efforts.length - 1];
  return { mode: "effort", efforts, defaultLevel: highest, effortMap };
}

function validCeiling(value: unknown): ReasoningCeiling {
  return typeof value === "string" &&
    REASONING_LEVELS.includes(value as ReasoningCeiling)
    ? (value as ReasoningCeiling)
    : "high";
}

export function applyReasoning(
  entry: HostModelEntry,
  ceiling: ReasoningCeiling,
  ceilingOverrides?: Partial<Record<"xhigh" | "max", string>>,
): HostModelEntry {
  delete entry.thinkingLevelMap;
  const normalized = validCeiling(ceiling);
  if (normalized === "off") {
    delete entry.reasoning;
    delete entry.thinking;
    return entry;
  }
  entry.reasoning = true;
  const ceilingIndex = EFFORTS.indexOf(normalized as ReasoningEffort);
  const efforts = EFFORTS.slice(0, ceilingIndex + 1);
  const effortMap: Record<string, string> = {};
  for (const level of efforts) {
    if (level !== "xhigh" && level !== "max") continue;
    const mappedLevel = ceilingOverrides?.[level];
    if (typeof mappedLevel === "string") {
      effortMap[level] = mappedLevel.trim() || level;
    }
  }
  entry.thinking = {
    mode: "effort",
    efforts,
    defaultLevel: normalized as ReasoningEffort,
    ...(Object.keys(effortMap).length > 0 ? { effortMap } : {}),
  };
  return entry;
}

function normalizeApi(value: unknown): ProviderApi {
  switch (value) {
    case "openai":
      return "openai-completions";
    case "anthropic":
      return "anthropic-messages";
    case "gemini":
    case "google":
      return "google-generative-ai";
    case "ollama":
      return "ollama-chat";
    case "openai-completions":
    case "openai-responses":
    case "anthropic-messages":
    case "google-generative-ai":
    case "ollama-chat":
      return value;
    default:
      throw new Error("Unsupported provider API: " + String(value));
  }
}

function infoFromMap<T>(
  source: ReadonlyMap<string, T> | Readonly<Record<string, T>> | undefined,
  id: string,
): T | undefined {
  if (!source) return undefined;
  const map = source as ReadonlyMap<string, T>;
  if (typeof map.get === "function") return map.get(id);
  return (source as Readonly<Record<string, T>>)[id];
}

function modelOptionsWithInfo(
  id: string,
  fallback: ModelOptions,
  detected?: ModelProbeMetadata,
  providerId?: string,
): ModelOptions {
  const info = resolveModelInfo(id, detected);
  const profile = staticProfile(providerId, fallback.api ?? info.api, id);
  const options: ModelOptions = { ...fallback };
  const detectedRecord = detected;
  if (
    info.vision !== undefined &&
    (fallback.vision === undefined || detectedRecord?.vision !== undefined)
  )
    options.vision = info.vision;
  if (
    info.contextWindow !== undefined &&
    (fallback.contextWindow === undefined ||
      detectedRecord?.contextWindow !== undefined)
  )
    options.contextWindow = info.contextWindow;
  if (
    info.maxTokens !== undefined &&
    (fallback.maxTokens === undefined ||
      detectedRecord?.maxTokens !== undefined)
  )
    options.maxTokens = info.maxTokens;
  if (
    info.headers !== undefined &&
    (fallback.headers === undefined || detectedRecord?.headers !== undefined)
  )
    options.headers = { ...info.headers };
  if (
    info.baseUrl !== undefined &&
    (fallback.baseUrl === undefined || detectedRecord?.baseUrl !== undefined)
  )
    options.baseUrl = info.baseUrl;
  if (
    info.api !== undefined &&
    (fallback.api === undefined || detectedRecord?.api !== undefined)
  )
    options.api = normalizeApi(info.api);
  const detectedMap = normalizeThinkingLevelMap(detected?.thinkingLevelMap);
  const fallbackMap = normalizeThinkingLevelMap(fallback.thinkingLevelMap);
  const hasExplicitMap =
    detected?.thinkingLevelMap !== undefined ||
    fallback.thinkingLevelMap !== undefined;
  const hasExplicitCompat =
    detected?.compat !== undefined || fallback.compat !== undefined;
  const nativeMap = detectedMap ?? fallbackMap;
  const compat =
    detected?.compat !== undefined
      ? asRecord(detected.compat)
      : fallback.compat !== undefined
        ? asRecord(fallback.compat)
        : undefined;
  if (nativeMap) options.thinkingLevelMap = nativeMap;
  if (compat) options.compat = { ...compat };
  if (!hasExplicitMap && !hasExplicitCompat && profile) {
    const profileMap = normalizeThinkingLevelMap(profile.thinkingLevelMap);
    if (profileMap) options.thinkingLevelMap = profileMap;
    if (profile.compat) options.compat = { ...profile.compat };
  }
  const effortOptions = Array.isArray(info.effortOptions)
    ? info.effortOptions
    : Array.isArray(info.reasoningEffortOptions)
      ? info.reasoningEffortOptions
      : undefined;
  if (
    !hasExplicitMap &&
    !options.thinkingLevelMap &&
    effortOptions &&
    effortOptions.length > 0
  )
    options.thinkingLevelMap = mapFromEffortOptions(effortOptions);
  if (detectedRecord?.reasoning !== undefined) {
    if (info.reasoning === false) options.reasoning = "off";
    else if (options.reasoning === undefined || options.reasoning === "off")
      options.reasoning = "high";
  } else if (options.reasoning === undefined && providerId !== "9router")
    options.reasoning = info.reasoning === false ? "off" : "high";
  if (info.alwaysThinking === true) {
    options.reasoning = "minimal";
    if (!options.thinkingLevelMap && !hasExplicitMap)
      options.thinkingLevelMap = mapFromEffortOptions([]);
  }
  return options;
}

export function modelOptionsFromProbe(
  info: ModelProbeMetadata | undefined,
  fallback: ModelOptions,
  modelId = "",
  providerId?: string,
): ModelOptions {
  const resolvedId = modelId || info?.id || "";
  return modelOptionsWithInfo(resolvedId, fallback, info, providerId);
}

export function buildModelEntry(
  id: string,
  opts: ModelOptions = {},
  ceilingOverrides?: Partial<Record<"xhigh" | "max", string>>,
): HostModelEntry {
  if (!id.trim()) throw new Error("Model id must be a non-empty string");
  const options = { ...opts };
  const entry: HostModelEntry = {
    id: id.trim(),
    input: options.vision === true ? ["text", "image"] : ["text"],
  };
  if (options.api !== undefined) entry.api = normalizeApi(options.api);
  if (typeof options.baseUrl === "string" && options.baseUrl.length > 0)
    entry.baseUrl = options.baseUrl;
  if (typeof options.contextWindow === "number" && options.contextWindow > 0)
    entry.contextWindow = options.contextWindow;
  if (typeof options.maxTokens === "number" && options.maxTokens > 0)
    entry.maxTokens = options.maxTokens;
  if (options.headers && typeof options.headers === "object")
    entry.headers = { ...options.headers };
  const map = normalizeThinkingLevelMap(options.thinkingLevelMap);
  if (map) entry.thinkingLevelMap = map;
  if (options.compat) entry.compat = { ...options.compat };
  if (map && asRecord(options.compat).supportsReasoningEffort === true)
    entry.reasoning = true;
  else if (
    !map &&
    options.reasoning !== undefined &&
    options.reasoning !== "off"
  )
    applyReasoning(entry, options.reasoning, ceilingOverrides);
  return entry;
}

export interface BuildProviderConfigInput extends Omit<ModelOptions, "api"> {
  providerId?: string;
  style?: ProviderStyle | string;
  api?: ProviderApi | string;
  baseUrl?: string;
  apiKey?: unknown;
  modelIds?: readonly string[];
  models?: readonly string[];
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  providerFields?: Record<string, unknown>;
  infoById?:
    | ReadonlyMap<string, ModelProbeMetadata>
    | Readonly<Record<string, ModelProbeMetadata>>;
  modelOptionsById?: Map<string, ModelOptions> | Record<string, ModelOptions>;
  ceilingOverrides?: Partial<Record<"xhigh" | "max", string>>;
  developerRole?: boolean;
}

function buildProviderConfigFromInput(
  input: BuildProviderConfigInput,
): ProviderConfig {
  const api = normalizeApi(input.api ?? input.style);
  const ollama = api === "ollama-chat";
  const sourceModels = input.modelIds
    ? [...input.modelIds]
    : input.models
      ? [...input.models]
      : [];
  const provider: ProviderConfig = {
    ...(input.providerFields ?? {}),
    ...(typeof input.baseUrl === "string" && input.baseUrl.length > 0
      ? { baseUrl: input.baseUrl }
      : {}),
    api,
    ...(input.headers ? { headers: { ...input.headers } } : {}),
  };
  // Plain-string keys (legacy/identity form) pass through verbatim; mode-bearing
  // values serialize through the shared api-key boundary.
  const serializedKey =
    typeof input.apiKey === "string"
      ? input.apiKey || undefined
      : serializeApiKey(
          input.apiKey as Parameters<typeof serializeApiKey>[0],
          ollama ? "ollama" : undefined,
        );
  if (serializedKey !== undefined) provider.apiKey = serializedKey;
  if (ollama) {
    provider.apiKey = "ollama";
    provider.compat = {
      ...asRecord(input.compat),
      ...asRecord(provider.compat),
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    };
  } else if (api === "openai-completions" || api === "openai-responses") {
    provider.compat = {
      ...asRecord(input.compat),
      ...asRecord(provider.compat),
      supportsDeveloperRole:
        input.developerRole ??
        asRecord(input.compat).supportsDeveloperRole ??
        false,
    };
  } else if (input.compat) provider.compat = { ...input.compat };
  const {
    providerId: _providerId,
    style: _style,
    api: _inputApi,
    baseUrl: _providerBaseUrl,
    apiKey: _apiKey,
    modelIds: _modelIds,
    models: _models,
    headers: _providerHeaders,
    compat: _compat,
    providerFields: _providerFields,
    infoById: _infoById,
    modelOptionsById: _modelOptionsById,
    ceilingOverrides: _ceilingOverrides,
    developerRole: _developerRole,
    ...modelDefaults
  } = input;
  const baseOptions: ModelOptions = { ...modelDefaults, api };
  const models: HostModelEntry[] = sourceModels.map((id) => {
    const perModel = infoFromMap(input.modelOptionsById, id);
    const detected = infoFromMap(input.infoById, id);
    const options: ModelOptions = {
      ...baseOptions,
      ...(perModel as ModelOptions | undefined),
    };
    const withInfo = modelOptionsWithInfo(
      id,
      options,
      detected,
      input.providerId,
    );
    withInfo.api = api;
    return buildModelEntry(id, withInfo, input.ceilingOverrides);
  });
  provider.models = models as ProviderConfig["models"];
  return provider;
}

export function buildProviderConfig(
  input: BuildProviderConfigInput,
): ProviderConfig;
export function buildProviderConfig(
  style: ProviderStyle | string,
  api: ProviderApi | string,
  baseUrl: string,
  apiKey: unknown,
  modelIds: readonly string[],
  opts: ModelOptions,
  ceilingOverrides?: Partial<Record<"xhigh" | "max", string>>,
  infoById?:
    | ReadonlyMap<string, ModelProbeMetadata>
    | Readonly<Record<string, ModelProbeMetadata>>,
  developerRole?: boolean,
): ProviderConfig;
export function buildProviderConfig(...args: unknown[]): ProviderConfig {
  if (
    args.length === 1 &&
    args[0] &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0])
  )
    return buildProviderConfigFromInput(args[0] as BuildProviderConfigInput);
  const [
    style,
    api,
    baseUrl,
    apiKey,
    modelIds,
    opts,
    ceilingOverrides,
    infoById,
    developerRole,
  ] = args;
  return buildProviderConfigFromInput({
    style: style as string,
    api: api as string,
    baseUrl: baseUrl as string,
    apiKey,
    modelIds: (modelIds as readonly string[]) ?? [],
    ...(opts && typeof opts === "object" ? (opts as ModelOptions) : {}),
    ceilingOverrides:
      ceilingOverrides as BuildProviderConfigInput["ceilingOverrides"],
    infoById: infoById as BuildProviderConfigInput["infoById"],
    developerRole: developerRole as boolean | undefined,
  });
}

function enabledEffortsFromThinking(thinking: unknown): Set<ReasoningEffort> {
  const out = new Set<ReasoningEffort>();
  const value = asRecord(thinking);
  for (const effort of Array.isArray(value.efforts) ? value.efforts : []) {
    const canonical = canonicalEffort(effort);
    if (canonical && canonical !== "off") out.add(canonical);
  }
  const map = asRecord(value.effortMap);
  for (const effort of EFFORTS)
    if (map[effort] !== undefined && map[effort] !== null) out.add(effort);
  return out;
}

function enabledEffortsFromLegacyMap(map: unknown): Set<ReasoningEffort> {
  const out = new Set<ReasoningEffort>();
  if (!map || typeof map !== "object") return out;
  for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
    const effort = canonicalEffort(key);
    if (effort && effort !== "off" && value !== undefined && value !== null)
      out.add(effort);
  }
  return out;
}

function highestEffort(enabled: Set<ReasoningEffort>): ReasoningCeiling {
  for (let i = EFFORTS.length - 1; i >= 0; i--)
    if (enabled.has(EFFORTS[i])) return EFFORTS[i];
  return "off";
}

export function readModelOptions(model: unknown): ModelOptions {
  const value = asRecord(model);
  const input = value.input;
  const vision = Array.isArray(input) ? input.includes("image") : false;
  const options: ModelOptions = { vision, reasoning: "off" };
  if (typeof value.contextWindow === "number")
    options.contextWindow = value.contextWindow;
  if (typeof value.maxTokens === "number") options.maxTokens = value.maxTokens;
  if (typeof value.baseUrl === "string") options.baseUrl = value.baseUrl;
  if (value.headers && typeof value.headers === "object")
    options.headers = { ...(value.headers as Record<string, string>) };
  if (typeof value.api === "string") {
    try {
      options.api = normalizeApi(value.api);
    } catch {
      /* future host API */
    }
  }
  const nativeMap = normalizeThinkingLevelMap(value.thinkingLevelMap);
  if (nativeMap) options.thinkingLevelMap = nativeMap;
  if (value.compat && typeof value.compat === "object")
    options.compat = { ...(value.compat as Record<string, unknown>) };
  const enabled = enabledEffortsFromThinking(value.thinking);
  for (const effort of enabledEffortsFromLegacyMap(value.thinkingLevelMap))
    enabled.add(effort);
  if (value.reasoning === false) options.reasoning = "off";
  else if (enabled.size > 0) options.reasoning = highestEffort(enabled);
  else if (value.reasoning === true || value.thinking !== undefined)
    options.reasoning = "high";
  return options;
}

export function readCeilingString(
  model: unknown,
  level: "xhigh" | "max",
): string | undefined {
  const value = asRecord(model);
  const hostValue = asRecord(asRecord(value.thinking).effortMap)[level];
  if (typeof hostValue === "string") return hostValue;
  const legacyValue = asRecord(value.thinkingLevelMap)[level];
  return typeof legacyValue === "string" ? legacyValue : undefined;
}

export function modelIdOf(model: unknown): string {
  if (typeof model === "string") return model.trim();
  const id = asRecord(model).id;
  return typeof id === "string" ? id.trim() : "";
}

export function findModel(
  provider: unknown,
  id: string,
): HostModelEntry | string | undefined {
  const models = asRecord(provider).models;
  if (!Array.isArray(models)) return undefined;
  return models.find((model) => modelIdOf(model) === id);
}

export type ModelMutationProperty =
  | "reasoning"
  | "vision"
  | "contextWindow"
  | "maxTokens"
  | "headers"
  | "baseUrl"
  | "api"
  | "input"
  | "thinking"
  | "thinkingLevelMap"
  | "name";

function finalizeNativeMap(
  entry: HostModelEntry,
  fallback?: ThinkingLevelMap,
): HostModelEntry {
  const map = normalizeThinkingLevelMap(entry.thinkingLevelMap) ?? fallback;
  if (!map) return entry;
  entry.thinkingLevelMap = map;
  delete entry.thinking;
  if (asRecord(entry.compat).supportsReasoningEffort === true)
    entry.reasoning = true;
  else delete entry.reasoning;
  return entry;
}

function applyModelMutation(
  entry: HostModelEntry,
  property: string,
  value: unknown,
): HostModelEntry {
  if (property === "reasoning") {
    if (typeof value === "string") applyReasoning(entry, validCeiling(value));
    else if (value === false || value === "off" || value === undefined)
      applyReasoning(entry, "off");
    else {
      const current = readModelOptions(entry).reasoning;
      applyReasoning(entry, current && current !== "off" ? current : "high");
    }
    return entry;
  }
  if (property === "vision") {
    entry.input = value === true ? ["text", "image"] : ["text"];
    return entry;
  }
  if (property === "thinkingLevelMap") {
    if (value === undefined) {
      delete entry.thinkingLevelMap;
      return entry;
    }
    const map = normalizeThinkingLevelMap(value);
    if (map) {
      entry.thinkingLevelMap = map;
      return finalizeNativeMap(entry);
    }
    return entry;
  }
  if (property === "thinking") {
    if (value === undefined || value === null) delete entry.thinking;
    else entry.thinking = structuredClone(value) as HostThinkingConfig;
    return entry;
  }
  if (property === "headers") {
    if (value === null || value === undefined) {
      delete entry.headers;
      return entry;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      entry.headers = { ...(value as Record<string, string>) };
      return entry;
    }
    return entry;
  }
  if (property === "input") {
    // Unknown shapes are silently ignored, matching the documented behavior.
    if (Array.isArray(value))
      entry.input = [...value] as Array<"text" | "image">;
    return entry;
  }
  if (property === "api") entry.api = normalizeApi(value);
  else if (value === undefined) delete entry[property];
  else entry[property] = value;
  return entry;
}

export function mutateModelEntry<T extends HostModelEntry>(
  entry: T,
  property:
    | ModelMutationProperty
    | Partial<Record<ModelMutationProperty, unknown>>,
  value?: unknown,
): T {
  const next = { ...entry } as T;
  if (typeof property === "string") {
    const originalMap = normalizeThinkingLevelMap(next.thinkingLevelMap);
    applyModelMutation(next, property, value);
    return property === "thinkingLevelMap"
      ? next
      : (finalizeNativeMap(next, originalMap) as T);
  }
  const requestedMap = normalizeThinkingLevelMap(property.thinkingLevelMap);
  for (const [key, nextValue] of Object.entries(property))
    applyModelMutation(next, key, nextValue);
  return finalizeNativeMap(next, requestedMap) as T;
}

export function mutateProviderConfig<T extends ProviderConfig>(
  provider: T,
  property:
    | string
    | { modelId: string; property: ModelMutationProperty; value?: unknown },
  value?: unknown,
): T {
  const next = { ...provider } as T;
  if (typeof property === "object") {
    const models = Array.isArray(provider.models) ? provider.models : [];
    next.models = models.map((model) =>
      modelIdOf(model) === property.modelId && typeof model !== "string"
        ? mutateModelEntry(
            model as HostModelEntry,
            property.property,
            property.value,
          )
        : model,
    ) as ProviderConfig["models"];
    return next;
  }
  if (property === "api") next.api = normalizeApi(value);
  else if (property === "headers" && value && typeof value === "object")
    (next as Record<string, unknown>).headers = {
      ...(value as Record<string, string>),
    };
  else if (value === undefined)
    delete (next as Record<string, unknown>)[property];
  else (next as Record<string, unknown>)[property] = value;
  return next;
}

export const updateProviderConfig = mutateProviderConfig;
