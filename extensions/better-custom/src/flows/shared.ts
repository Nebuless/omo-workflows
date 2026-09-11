import { resolveApiKeyForProbe } from "../api-key.ts";
import { loadModelsConfig, saveModelsConfig } from "../config.ts";
import type { ModelsConfigTarget } from "../config.ts";
import {
  localModelInfo,
  readModelOptions,
  resolveModelInfo,
} from "../model-entry.ts";
import type { ModelProbeMetadata } from "../model-entry.ts";
import { refreshBetterCustomProviders } from "../model-browser.ts";
import { gatewayPreset } from "../presets.ts";
import { probeGateway } from "../probe/index.ts";
import type {
  GatewayProbeOptions,
  GatewayProbeResult,
  ProbeFetch,
} from "../probe/index.ts";
import type {
  ApiKeyValue,
  CommandContext,
  ModelsConfig,
  ProviderConfig,
  ProviderStyle,
  SelectItem,
} from "../types.ts";
import { ensureV1Path } from "../url.ts";
import { pickMany, selectOne } from "../ui/select.ts";
import {
  promptGatewayPreset,
  promptModelIdsOneByOne,
  setWorkingMessage,
} from "../ui/prompts.ts";

export type ProbeRunner = (
  options: GatewayProbeOptions,
) => Promise<GatewayProbeResult>;

export interface FlowConfigOptions {
  configTarget?: ModelsConfigTarget;
}

export interface CollectedModels {
  ids: string[];
  baseUrl: string;
  infoById: Map<string, ModelProbeMetadata>;
  resolvedApiKey?: string;
}

export interface CollectProviderModelsOptions {
  ctx: CommandContext;
  style: ProviderStyle;
  endpoint: string;
  apiKey: ApiKeyValue;
  fetch?: ProbeFetch;
  probeGateway?: ProbeRunner;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function modelId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  return typeof record?.id === "string" ? record.id.trim() : "";
}

function formatTokens(value: number): string {
  return value >= 1_000 && value % 1_000 === 0
    ? value / 1_000 + "k"
    : String(value);
}

function metadataUsesLocalRule(
  id: string,
  detected: ModelProbeMetadata | undefined,
): boolean {
  const local = localModelInfo(id);
  if (!local) return false;
  return (
    (local.contextWindow !== undefined &&
      detected?.contextWindow === undefined) ||
    (local.maxTokens !== undefined && detected?.maxTokens === undefined) ||
    (local.vision !== undefined && detected?.vision === undefined) ||
    (local.reasoning !== undefined && detected?.reasoning === undefined)
  );
}

/** Render only model properties that differ from the wizard's defaults. */
export function describeModelMetadata(
  id: string,
  detected?: ModelProbeMetadata,
): string {
  const resolved = resolveModelInfo(id, detected);
  const labels: string[] = [];
  if (typeof resolved.contextWindow === "number" && resolved.contextWindow > 0)
    labels.push("context " + formatTokens(resolved.contextWindow));
  if (typeof resolved.maxTokens === "number" && resolved.maxTokens > 0)
    labels.push("output " + formatTokens(resolved.maxTokens));
  if (resolved.vision === true) labels.push("vision");
  if (resolved.reasoning === false) labels.push("no reasoning");
  const efforts = resolved.reasoningEffortOptions ?? resolved.effortOptions;
  if (Array.isArray(efforts) && efforts.length > 0)
    labels.push("effort " + efforts.join("/"));
  if (labels.length > 0 && metadataUsesLocalRule(id, detected))
    labels.push("[local rules]");
  return labels.join(" • ");
}

/** Shape searchable picker rows without exposing default metadata as noise. */
export function probePickerItems(
  ids: readonly string[],
  infoById: ReadonlyMap<string, ModelProbeMetadata>,
): SelectItem[] {
  return uniqueModelIds(ids).map((id) => {
    const metadata = describeModelMetadata(id, infoById.get(id));
    return {
      value: id,
      label: id,
      ...(metadata
        ? { suffix: " • " + metadata, searchText: id + " " + metadata }
        : { searchText: id }),
    };
  });
}

export function uniqueModelIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

/** Merge gateway evidence in source order; later evidence fills the same model's fields. */
export function mergeProbeMetadata(
  ids: readonly string[],
  ...sources: ReadonlyArray<ReadonlyMap<string, ModelProbeMetadata> | undefined>
): Map<string, ModelProbeMetadata> {
  const result = new Map<string, ModelProbeMetadata>();
  for (const id of uniqueModelIds(ids)) {
    let merged: ModelProbeMetadata | undefined;
    for (const source of sources) {
      const metadata = source?.get(id);
      if (metadata) merged = { ...(merged ?? {}), ...metadata };
    }
    if (merged) result.set(id, merged);
  }
  return result;
}

export function describeProvider(
  providerId: string,
  provider: ProviderConfig,
): string {
  const modelCount = Array.isArray(provider.models)
    ? provider.models.length
    : 0;
  const endpoint =
    typeof provider.baseUrl === "string" ? provider.baseUrl : "(no endpoint)";
  const api = typeof provider.api === "string" ? provider.api : "(no api)";
  return (
    providerId +
    "\n" +
    api +
    " • " +
    modelCount +
    " model" +
    (modelCount === 1 ? "" : "s") +
    "\n" +
    endpoint
  );
}

export function describeProviderInline(
  providerId: string,
  provider: ProviderConfig,
): Pick<SelectItem, "label" | "suffix" | "searchText"> {
  const modelCount = Array.isArray(provider.models)
    ? provider.models.length
    : 0;
  const endpoint =
    typeof provider.baseUrl === "string" ? provider.baseUrl : "(no endpoint)";
  const api = typeof provider.api === "string" ? provider.api : "(no api)";
  const suffix =
    " • " +
    api +
    " • " +
    endpoint +
    " • " +
    modelCount +
    " model" +
    (modelCount === 1 ? "" : "s");
  return {
    label: providerId,
    suffix,
    searchText: providerId + " " + api + " " + endpoint + " " + modelCount,
  };
}

export function providerPickerItems(config: ModelsConfig): SelectItem[] {
  return Object.entries(config.providers ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([providerId, provider]) => ({
      value: providerId,
      ...describeProviderInline(providerId, provider),
    }));
}

export function providerModelItems(provider: ProviderConfig): SelectItem[] {
  const models = Array.isArray(provider.models) ? provider.models : [];
  return models.flatMap((model) => {
    const id = modelId(model);
    if (!id) return [];
    const options = typeof model === "string" ? {} : readModelOptions(model);
    const labels: string[] = [];
    if (options.reasoning && options.reasoning !== "off")
      labels.push("reasoning:" + options.reasoning);
    if (options.vision === true) labels.push("vision");
    if (options.contextWindow)
      labels.push("context " + formatTokens(options.contextWindow));
    return [
      {
        value: id,
        label: id,
        ...(labels.length > 0
          ? {
              suffix: " • " + labels.join(" • "),
              searchText: id + " " + labels.join(" "),
            }
          : { searchText: id }),
      },
    ];
  });
}

export function validateUniqueProviderName(
  providerId: string,
  config: ModelsConfig,
): string | undefined {
  const name = providerId.trim();
  if (!name) return "Provider name is required.";
  if (Object.hasOwn(config.providers ?? {}, name))
    return 'Provider "' + name + '" already exists. Choose a different name.';
  return undefined;
}

export function loadConfigForFlow(
  ctx: CommandContext,
  options: FlowConfigOptions = {},
): ModelsConfig | undefined {
  try {
    return loadModelsConfig(options.configTarget);
  } catch (error) {
    ctx.ui.notify(
      "Could not read the models configuration: " + errorText(error),
      "error",
    );
    return undefined;
  }
}

function saveConfigForFlow(
  ctx: CommandContext,
  config: ModelsConfig,
  options: FlowConfigOptions,
): boolean {
  try {
    saveModelsConfig(config, options.configTarget);
    // Push the mutation into the live session's provider registry.
    refreshBetterCustomProviders(config);
    return true;
  } catch (error) {
    ctx.ui.notify(
      "Could not write the models configuration: " + errorText(error),
      "error",
    );
    return false;
  }
}

/** Apply a targeted immutable provider update through the config boundary. */
export async function mutateProvider(
  ctx: CommandContext,
  providerId: string,
  mutate: (
    provider: ProviderConfig,
  ) => ProviderConfig | undefined | Promise<ProviderConfig | undefined>,
  options: FlowConfigOptions = {},
): Promise<boolean> {
  const config = loadConfigForFlow(ctx, options);
  const provider = config?.providers?.[providerId];
  if (!config) return false;
  if (!provider) {
    ctx.ui.notify('Provider "' + providerId + '" no longer exists.', "warning");
    return false;
  }
  const replacement = await mutate({ ...provider });
  if (!replacement) return false;
  return saveConfigForFlow(
    ctx,
    {
      ...config,
      providers: { ...config.providers, [providerId]: replacement },
    },
    options,
  );
}

export async function removeProvider(
  ctx: CommandContext,
  providerId: string,
  options: FlowConfigOptions = {},
): Promise<boolean> {
  const config = loadConfigForFlow(ctx, options);
  if (!config) return false;
  if (!config.providers?.[providerId]) {
    ctx.ui.notify('Provider "' + providerId + '" no longer exists.', "warning");
    return false;
  }
  const { [providerId]: _removed, ...providers } = config.providers;
  return saveConfigForFlow(ctx, { ...config, providers }, options);
}

/** Add a provider only when the latest persisted config still has a free name. */
export async function persistProvider(
  ctx: CommandContext,
  providerId: string,
  providerConfig: ProviderConfig,
  options: FlowConfigOptions = {},
): Promise<boolean> {
  const config = loadConfigForFlow(ctx, options);
  if (!config) return false;
  const validation = validateUniqueProviderName(providerId, config);
  if (validation) {
    ctx.ui.notify(validation, "warning");
    return false;
  }
  return saveConfigForFlow(
    ctx,
    {
      ...config,
      providers: { ...(config.providers ?? {}), [providerId]: providerConfig },
    },
    options,
  );
}

function styleUsesGatewayPreset(style: ProviderStyle): boolean {
  return style !== "ollama-chat" && style !== "google-generative-ai";
}

async function chooseAfterProbeFailure(
  ctx: CommandContext,
  message: string,
): Promise<"retry" | "manual" | null> {
  ctx.ui.notify(
    message + " Choose another gateway or add models manually.",
    "warning",
  );
  const action = await selectOne(ctx, "Probe failed — what next?", [
    {
      value: "retry",
      label: "Retry",
      description: "Choose a gateway preset and probe again",
    },
    {
      value: "manual",
      label: "Add models manually",
      description: "Enter model ids by hand",
    },
    {
      value: "cancel",
      label: "Cancel",
      description: "Leave the configuration unchanged",
    },
  ]);
  return action === "retry" || action === "manual" ? action : null;
}

/**
 * Collect model ids and observed metadata before any config mutation. Native
 * gateway selection is skipped for Ollama and Gemini, whose probe paths own it.
 */
export async function collectProviderModels(
  options: CollectProviderModelsOptions,
): Promise<CollectedModels | null> {
  const { ctx, style, endpoint, apiKey, fetch } = options;
  const modelMode = await selectOne(ctx, "Models", [
    {
      value: "auto",
      label: "Auto probe from /models",
      description: "Discover models and gateway metadata",
    },
    {
      value: "manual",
      label: "Add manually",
      description: "Enter one or more model ids",
    },
  ]);
  if (!modelMode) return null;
  if (modelMode === "manual") {
    const ids = await promptModelIdsOneByOne(ctx, style);
    return ids
      ? { ids: uniqueModelIds(ids), baseUrl: endpoint, infoById: new Map() }
      : null;
  }

  const resolvedApiKey = resolveApiKeyForProbe(apiKey);
  const runner = options.probeGateway ?? probeGateway;
  let presetId: string = "auto";
  while (true) {
    if (styleUsesGatewayPreset(style)) {
      const chosen = await promptGatewayPreset(ctx);
      if (!chosen) return null;
      presetId = chosen;
    }
    const fallbackBase = gatewayPreset(presetId).ensureV1
      ? ensureV1Path(endpoint)
      : endpoint;
    let result: GatewayProbeResult | undefined;
    let failure: string | undefined;
    try {
      setWorkingMessage(ctx, "Probing models...");
      result = await runner({
        endpoint,
        api: style,
        preset: presetId,
        apiKey: resolvedApiKey,
        fetch,
      });
    } catch (error) {
      failure = "Auto probe failed: " + errorText(error);
    } finally {
      setWorkingMessage(ctx);
    }
    if (failure || !result) {
      const action = await chooseAfterProbeFailure(
        ctx,
        failure ?? "Auto probe failed.",
      );
      if (action === "retry") continue;
      if (action === "manual") {
        const manualIds = await promptModelIdsOneByOne(ctx, style);
        return manualIds
          ? {
              ids: uniqueModelIds(manualIds),
              baseUrl: fallbackBase,
              infoById: new Map(),
              resolvedApiKey,
            }
          : null;
      }
      return null;
    }

    const ids = uniqueModelIds(result.ids);
    if (ids.length > 0) {
      const infoById = mergeProbeMetadata(
        ids,
        result.metadataById,
        result.infoById,
      );
      const picked = await pickMany(
        ctx,
        "Select models",
        probePickerItems(ids, infoById),
      );
      if (!picked || picked.length === 0) return null;
      return {
        ids: uniqueModelIds(picked),
        baseUrl: result.baseUrl || fallbackBase,
        infoById,
        resolvedApiKey,
      };
    }
    const action = await chooseAfterProbeFailure(
      ctx,
      "Probe returned no models.",
    );
    if (action === "retry") continue;
    if (action === "manual") {
      const manualIds = await promptModelIdsOneByOne(ctx, style);
      return manualIds
        ? {
            ids: uniqueModelIds(manualIds),
            baseUrl: result.baseUrl || fallbackBase,
            infoById: new Map(),
            resolvedApiKey,
          }
        : null;
    }
    return null;
  }
}
