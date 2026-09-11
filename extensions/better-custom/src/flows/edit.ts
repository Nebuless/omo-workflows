import { apiKeyFromProvider, serializeApiKey } from "../api-key.ts";
import { saveModelsConfig } from "../config.ts";
import type { ModelsConfigTarget } from "../config.ts";
import {
  buildModelEntry,
  modelIdOf,
  modelOptionsFromProbe,
  mutateModelEntry,
  readModelOptions,
} from "../model-entry.ts";
import type { HostModelEntry, ModelMutationProperty } from "../model-entry.ts";
import type { ProbeFetch } from "../probe/index.ts";
import { PROVIDER_STYLES } from "../types.ts";
import type {
  CommandContext,
  ProviderConfig,
  ProviderStyle,
} from "../types.ts";
import { normalizeEndpoint } from "../url.ts";
import type { TokenPromptResult } from "../ui/prompts.ts";
import {
  gateProviderId,
  promptApiKeyEdit,
  promptContextWindow,
  promptMaxTokens,
  promptReasoning,
  promptVision,
} from "../ui/prompts.ts";
import { builtinOverrideConfirm } from "../ui/prompts.ts";
import { selectOne } from "../ui/select.ts";
import {
  collectProviderModels,
  loadConfigForFlow,
  mutateProvider,
  providerModelItems,
  providerPickerItems,
  validateUniqueProviderName,
} from "./shared.ts";
import type { CollectedModels, ProbeRunner } from "./shared.ts";

export interface EditProviderFlowOptions {
  configTarget?: ModelsConfigTarget;
  fetch?: ProbeFetch;
  probeGateway?: ProbeRunner;
}

type HeaderEdit =
  | { kind: "set"; value: Record<string, string> }
  | { kind: "clear" }
  | { kind: "keep" };
type ProviderModel = NonNullable<ProviderConfig["models"]>[number];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function providerStyle(provider: ProviderConfig): ProviderStyle | undefined {
  const api = typeof provider.api === "string" ? provider.api : undefined;
  return PROVIDER_STYLES.includes(api as ProviderStyle)
    ? (api as ProviderStyle)
    : undefined;
}

function isOpenAiStyle(style: ProviderStyle): boolean {
  return style === "openai-completions" || style === "openai-responses";
}

function modelsOf(provider: ProviderConfig): ProviderModel[] {
  return Array.isArray(provider.models) ? provider.models : [];
}

function modelForId(
  provider: ProviderConfig,
  modelId: string,
): ProviderModel | undefined {
  return modelsOf(provider).find((model) => modelIdOf(model) === modelId);
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string") return undefined;
    result[key] = entry;
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function unchanged(ctx: CommandContext, message: string): false {
  ctx.ui.notify(message + " Models configuration is unchanged.", "info");
  return false;
}

async function promptHeaders(
  ctx: CommandContext,
  title: string,
  current: unknown,
): Promise<HeaderEdit | null> {
  const existing = asStringRecord(current);
  const input = await ctx.ui.input(
    title,
    existing ? JSON.stringify(existing) : 'e.g. {"x-api-version":"2024-01"}',
  );
  if (input === undefined) {
    unchanged(ctx, "Header edit canceled.");
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    ctx.ui.notify("Headers left unchanged.", "info");
    return { kind: "keep" };
  }
  if (trimmed === "-") return { kind: "clear" };

  try {
    const parsed = asStringRecord(JSON.parse(trimmed));
    if (!parsed) throw new Error("headers must map names to string values");
    return { kind: "set", value: parsed };
  } catch (error) {
    ctx.ui.notify(
      "Headers must be a JSON object with string values: " + errorText(error),
      "warning",
    );
    return null;
  }
}

async function updateModel(
  ctx: CommandContext,
  providerId: string,
  modelId: string,
  property: ModelMutationProperty,
  value: unknown,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  return mutateProvider(
    ctx,
    providerId,
    (provider) => {
      const models = modelsOf(provider);
      const index = models.findIndex((model) => modelIdOf(model) === modelId);
      if (index < 0) {
        ctx.ui.notify('Model "' + modelId + '" no longer exists.', "warning");
        return undefined;
      }
      const selected = models[index];
      if (selected === undefined) return undefined;
      const entry: HostModelEntry =
        typeof selected === "string"
          ? { id: modelId }
          : (selected as HostModelEntry);
      const updated = mutateModelEntry(entry, property, value) as ProviderModel;
      const nextModels = [...models];
      nextModels[index] = updated;
      return { ...provider, models: nextModels };
    },
    options,
  );
}

async function deleteModel(
  ctx: CommandContext,
  providerId: string,
  modelId: string,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  const confirmed = await ctx.ui.confirm(
    "Delete model?",
    'Remove "' + modelId + '" from "' + providerId + '"?',
  );
  if (!confirmed) return unchanged(ctx, "Model deletion canceled.");

  return mutateProvider(
    ctx,
    providerId,
    (provider) => {
      const models = modelsOf(provider);
      const index = models.findIndex((model) => modelIdOf(model) === modelId);
      if (index < 0) {
        ctx.ui.notify('Model "' + modelId + '" no longer exists.', "warning");
        return undefined;
      }
      return {
        ...provider,
        models: [...models.slice(0, index), ...models.slice(index + 1)],
      };
    },
    options,
  );
}

async function editModelBaseUrl(
  ctx: CommandContext,
  providerId: string,
  modelId: string,
  provider: ProviderConfig,
  model: unknown,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  const style = providerStyle(provider);
  if (!style) {
    ctx.ui.notify(
      "Provider API is unsupported; model endpoint was not changed.",
      "warning",
    );
    return false;
  }
  const current = asRecord(model)?.baseUrl;
  const input = await ctx.ui.input(
    "Model endpoint override (blank = keep, '-' = clear)",
    typeof current === "string" ? current : "https://api.example.com/v1",
  );
  if (input === undefined)
    return unchanged(ctx, "Model endpoint edit canceled.");
  const trimmed = input.trim();
  if (!trimmed) return unchanged(ctx, "Model endpoint left unchanged.");
  if (trimmed === "-")
    return updateModel(ctx, providerId, modelId, "baseUrl", undefined, options);

  try {
    return updateModel(
      ctx,
      providerId,
      modelId,
      "baseUrl",
      normalizeEndpoint(trimmed, style),
      options,
    );
  } catch (error) {
    ctx.ui.notify("Invalid model endpoint: " + errorText(error), "warning");
    return false;
  }
}

/** Apply one tagged token prompt outcome; invalid input leaves config untouched. */
async function applyTokenResult(
  ctx: CommandContext,
  result: TokenPromptResult,
  keptNotice: string,
  canceledNotice: string,
  providerId: string,
  modelId: string,
  property: ModelMutationProperty,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  if (result.kind === "invalid") return false;
  if (result.kind === "cancel") return unchanged(ctx, canceledNotice);
  if (result.kind === "keep") return unchanged(ctx, keptNotice);
  return updateModel(
    ctx,
    providerId,
    modelId,
    property,
    result.tokens === 0 ? undefined : result.tokens,
    options,
  );
}

async function editSingleModel(
  ctx: CommandContext,
  providerId: string,
  modelId: string,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  let changed = false;
  while (true) {
    const config = loadConfigForFlow(ctx, options);
    const provider = config?.providers?.[providerId];
    if (!config || !provider) {
      if (config)
        ctx.ui.notify(
          'Provider "' + providerId + '" no longer exists.',
          "warning",
        );
      return changed;
    }
    const model = modelForId(provider, modelId);
    if (!model) {
      ctx.ui.notify('Model "' + modelId + '" no longer exists.', "warning");
      return changed;
    }
    const settings = readModelOptions(model);
    const action = await selectOne(ctx, "Edit " + modelId, [
      {
        value: "reasoning",
        label: "Reasoning ceiling",
        suffix: " • " + settings.reasoning,
        description: "Set host thinking efforts for this model",
      },
      {
        value: "vision",
        label: "Vision input",
        suffix: " • " + (settings.vision ? "text + image" : "text only"),
        description: "Toggle image input support",
      },
      {
        value: "context",
        label: "Context window",
        suffix: " • " + (settings.contextWindow ?? "unset"),
        description: "Set maximum context tokens",
      },
      {
        value: "max-tokens",
        label: "Max output tokens",
        suffix: " • " + (settings.maxTokens ?? "unset"),
        description: "Set maximum generated tokens",
      },
      {
        value: "headers",
        label: "Model headers",
        description: "Set or clear model-specific HTTP headers",
      },
      {
        value: "base-url",
        label: "Model endpoint override",
        description: "Set or clear this model's baseUrl override",
      },
      {
        value: "delete",
        label: "Delete model",
        description: "Remove only this model from the provider",
      },
      { value: "back", label: "Back", description: "Return to the model list" },
    ]);
    if (!action || action === "back") return changed;

    let saved = false;
    if (action === "reasoning") {
      const reasoning = await promptReasoning(ctx, settings.reasoning);
      saved =
        reasoning === null
          ? unchanged(ctx, "Reasoning edit canceled.")
          : await updateModel(
              ctx,
              providerId,
              modelId,
              "reasoning",
              reasoning,
              options,
            );
    } else if (action === "vision") {
      const vision = await promptVision(ctx, settings.vision);
      saved =
        vision === null
          ? unchanged(ctx, "Vision edit canceled.")
          : await updateModel(
              ctx,
              providerId,
              modelId,
              "vision",
              vision,
              options,
            );
    } else if (action === "context") {
      const result = await promptContextWindow(ctx, settings.contextWindow);
      saved = await applyTokenResult(
        ctx,
        result,
        "Context window kept at current value.",
        "Context-window edit canceled.",
        providerId,
        modelId,
        "contextWindow",
        options,
      );
    } else if (action === "max-tokens") {
      const result = await promptMaxTokens(ctx, settings.maxTokens);
      saved = await applyTokenResult(
        ctx,
        result,
        "Max output tokens kept at current value.",
        "Max-token edit canceled.",
        providerId,
        modelId,
        "maxTokens",
        options,
      );
    } else if (action === "headers") {
      const headers = await promptHeaders(
        ctx,
        "Model headers (blank = keep, '-' = clear)",
        asRecord(model)?.headers,
      );
      if (headers?.kind === "set")
        saved = await updateModel(
          ctx,
          providerId,
          modelId,
          "headers",
          headers.value,
          options,
        );
      else if (headers?.kind === "clear")
        saved = await updateModel(
          ctx,
          providerId,
          modelId,
          "headers",
          undefined,
          options,
        );
    } else if (action === "base-url") {
      saved = await editModelBaseUrl(
        ctx,
        providerId,
        modelId,
        provider,
        model,
        options,
      );
    } else if (action === "delete") {
      saved = await deleteModel(ctx, providerId, modelId, options);
      changed = changed || saved;
      if (saved) return true;
    }
    changed = changed || saved;
  }
}

async function editProviderModels(
  ctx: CommandContext,
  providerId: string,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  let changed = false;
  while (true) {
    const config = loadConfigForFlow(ctx, options);
    const provider = config?.providers?.[providerId];
    if (!config || !provider) {
      if (config)
        ctx.ui.notify(
          'Provider "' + providerId + '" no longer exists.',
          "warning",
        );
      return changed;
    }
    const items = providerModelItems(provider);
    if (items.length === 0) {
      ctx.ui.notify(
        'Provider "' + providerId + '" has no models to edit.',
        "warning",
      );
      return changed;
    }
    const modelId = await selectOne(ctx, "Edit model in " + providerId, items);
    if (!modelId) {
      if (!changed) unchanged(ctx, "Model edit canceled.");
      return changed;
    }
    changed =
      (await editSingleModel(ctx, providerId, modelId, options)) || changed;
  }
}

async function renameProvider(
  ctx: CommandContext,
  providerId: string,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  // Snapshot existing ids before prompting so duplicate retries see stable
  // data; collisions introduced while the prompt was open are caught by the
  // fresh-load revalidation below instead of looping this prompt forever.
  const knownConfig = loadConfigForFlow(ctx, options);
  if (!knownConfig) return false;
  const knownIds = Object.keys(knownConfig.providers ?? {});
  while (true) {
    const input = await ctx.ui.input(
      "Rename provider",
      "current: " + providerId,
    );
    if (input === undefined) return unchanged(ctx, "Provider rename canceled.");
    const gate = gateProviderId(input, providerId, knownIds);
    if (gate.kind === "invalid") {
      ctx.ui.notify(gate.message, gate.notify);
      continue;
    }
    if (gate.kind === "cancel") {
      return unchanged(ctx, 'Provider name is already "' + providerId + '".');
    }
    const nextId = gate.id;
    if (gate.kind === "confirm") {
      const confirm = builtinOverrideConfirm(gate.id);
      const ok = await ctx.ui.confirm(confirm.title, confirm.message);
      if (!ok) continue;
    }

    // Reload after user input so a collision introduced while the prompt was open
    // cannot overwrite another provider during the boundary write.
    const config = loadConfigForFlow(ctx, options);
    if (!config) return false;
    const provider = config.providers?.[providerId];
    if (!provider) {
      ctx.ui.notify(
        'Provider "' + providerId + '" no longer exists.',
        "warning",
      );
      return false;
    }
    const validation = validateUniqueProviderName(nextId, config);
    if (validation) {
      ctx.ui.notify(validation, "warning");
      return false;
    }

    const providers: Record<string, ProviderConfig> = {};
    for (const [id, value] of Object.entries(config.providers ?? {})) {
      providers[id === providerId ? nextId : id] = value;
    }
    try {
      saveModelsConfig({ ...config, providers }, options.configTarget);
      ctx.ui.notify(
        'Renamed provider "' + providerId + '" to "' + nextId + '".',
        "success",
      );
      return true;
    } catch (error) {
      ctx.ui.notify(
        "Could not write the models configuration: " + errorText(error),
        "error",
      );
      return false;
    }
  }
}

async function editProviderEndpoint(
  ctx: CommandContext,
  providerId: string,
  provider: ProviderConfig,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  const style = providerStyle(provider);
  if (!style) {
    ctx.ui.notify(
      "Provider API is unsupported; endpoint was not changed.",
      "warning",
    );
    return false;
  }
  const input = await ctx.ui.input(
    "Provider endpoint",
    typeof provider.baseUrl === "string"
      ? provider.baseUrl
      : "https://api.example.com/v1",
  );
  if (input === undefined) return unchanged(ctx, "Endpoint edit canceled.");
  const raw = input.trim();
  if (!raw) {
    ctx.ui.notify("Endpoint is required; it was not changed.", "warning");
    return false;
  }
  let endpoint: string;
  try {
    endpoint = normalizeEndpoint(raw, style);
  } catch (error) {
    ctx.ui.notify("Invalid endpoint: " + errorText(error), "warning");
    return false;
  }
  return mutateProvider(
    ctx,
    providerId,
    (latest) => ({ ...latest, baseUrl: endpoint }),
    options,
  );
}

async function editProviderApiKey(
  ctx: CommandContext,
  providerId: string,
  provider: ProviderConfig,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  const style = providerStyle(provider);
  if (!style) {
    ctx.ui.notify(
      "Provider API is unsupported; API key was not changed.",
      "warning",
    );
    return false;
  }
  const apiKey = await promptApiKeyEdit(ctx, provider.apiKey);
  if (apiKey.kind === "cancel") return unchanged(ctx, "API-key edit canceled.");
  if (apiKey.kind === "keep") {
    ctx.ui.notify(
      "API key kept as " + apiKey.mode + " reference; it was not changed.",
      "info",
    );
    return false;
  }
  const serialized = serializeApiKey(apiKey.apiKey, style);
  if (serialized === undefined) {
    ctx.ui.notify("API key is invalid; it was not changed.", "warning");
    return false;
  }
  return mutateProvider(
    ctx,
    providerId,
    (latest) => ({ ...latest, apiKey: serialized }),
    options,
  );
}

async function editProviderApi(
  ctx: CommandContext,
  providerId: string,
  provider: ProviderConfig,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  const current = providerStyle(provider);
  const choice = await selectOne(
    ctx,
    "API flavor for " + providerId,
    PROVIDER_STYLES.map((style) => ({
      value: style,
      label: style,
      suffix: style === current ? " • current" : undefined,
      description: 'Use host API "' + style + '"',
    })),
  );
  if (!choice) return unchanged(ctx, "API-flavor edit canceled.");
  if (!PROVIDER_STYLES.includes(choice as ProviderStyle)) {
    ctx.ui.notify("Unsupported provider API; it was not changed.", "warning");
    return false;
  }
  const style = choice as ProviderStyle;
  if (style === current)
    return unchanged(ctx, 'Provider API is already "' + style + '".');
  return mutateProvider(
    ctx,
    providerId,
    (latest) => ({
      ...latest,
      api: style,
      models: modelsOf(latest).map((model) =>
        typeof model === "string"
          ? model
          : (mutateModelEntry(
              model as HostModelEntry,
              "api",
              style,
            ) as ProviderModel),
      ),
    }),
    options,
  );
}

async function editProviderHeaders(
  ctx: CommandContext,
  providerId: string,
  provider: ProviderConfig,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  const headers = await promptHeaders(
    ctx,
    "Provider headers (blank = keep, '-' = clear)",
    provider.headers,
  );
  if (!headers || headers.kind === "keep") return false;
  return mutateProvider(
    ctx,
    providerId,
    (latest) => {
      const next = { ...latest };
      if (headers.kind === "clear") delete next.headers;
      else next.headers = headers.value;
      return next;
    },
    options,
  );
}

async function editDeveloperRole(
  ctx: CommandContext,
  providerId: string,
  provider: ProviderConfig,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  const style = providerStyle(provider);
  if (!style || !isOpenAiStyle(style)) {
    ctx.ui.notify(
      "Developer-role compatibility applies only to OpenAI-style providers.",
      "warning",
    );
    return false;
  }
  const choice = await selectOne(ctx, "Developer role for " + providerId, [
    {
      value: "auto",
      label: "Auto",
      description: "Remove the override and use host defaults",
    },
    {
      value: "supported",
      label: "Supported",
      description: "Allow the developer role for this endpoint",
    },
    {
      value: "unsupported",
      label: "Not supported",
      description: "Keep system messages in the system role",
    },
  ]);
  if (!choice) return unchanged(ctx, "Developer-role edit canceled.");
  return mutateProvider(
    ctx,
    providerId,
    (latest) => {
      const compat = { ...(asRecord(latest.compat) ?? {}) };
      if (choice === "auto") delete compat.supportsDeveloperRole;
      else compat.supportsDeveloperRole = choice === "supported";
      const next = { ...latest };
      if (Object.keys(compat).length === 0) delete next.compat;
      else next.compat = compat;
      return next;
    },
    options,
  );
}

function sameSerializedModels(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) => JSON.stringify(entry) === JSON.stringify(right[index]),
    )
  );
}

/**
 * Merge probed gateway metadata into stored models under the add-path
 * authority rule: observed fields overwrite stale or locally defaulted values
 * while local-only fields (connection overrides, unknown keys) persist
 * untouched. Returns undefined when the probe adds nothing and changes
 * nothing, signaling that the configuration should stay byte-identical.
 */
function mergeProbedModels(
  models: ProviderModel[],
  collected: CollectedModels,
  currentStyle: ProviderStyle,
): ProviderModel[] | undefined {
  const existingIds = new Set(models.map((model) => modelIdOf(model)));
  const additions = collected.ids.filter((id) => !existingIds.has(id));
  const merged = models.map((model) => {
    const id = modelIdOf(model);
    const info = collected.infoById.get(id);
    if (!info || typeof model === "string") return model;
    const settings = readModelOptions(model);
    delete settings.api;
    const refreshed = buildModelEntry(
      id,
      modelOptionsFromProbe(info, { ...settings, api: currentStyle }, id),
    ) as HostModelEntry;
    return { ...(model as HostModelEntry), ...refreshed } as ProviderModel;
  });
  if (additions.length === 0 && sameSerializedModels(merged, models))
    return undefined;
  const entries = additions.map(
    (id) =>
      buildModelEntry(
        id,
        modelOptionsFromProbe(
          collected.infoById.get(id),
          { api: currentStyle },
          id,
        ),
      ) as ProviderModel,
  );
  return [...merged, ...entries];
}

async function refreshProviderModels(
  ctx: CommandContext,
  providerId: string,
  provider: ProviderConfig,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  const style = providerStyle(provider);
  const endpoint = typeof provider.baseUrl === "string" ? provider.baseUrl : "";
  if (!style || !endpoint) {
    ctx.ui.notify(
      "A supported API and endpoint are required to refresh model metadata.",
      "warning",
    );
    return false;
  }
  // One probe serves both outcomes: fresh metadata for existing models and
  // candidates for new additions. Cancel or failure leaves config untouched.
  const collected = await collectProviderModels({
    ctx,
    style,
    endpoint,
    apiKey: apiKeyFromProvider(provider),
    fetch: options.fetch,
    probeGateway: options.probeGateway,
  });
  if (!collected) return unchanged(ctx, "Metadata refresh canceled.");

  return mutateProvider(
    ctx,
    providerId,
    (latest) => {
      const currentStyle = providerStyle(latest) ?? style;
      const models = mergeProbedModels(
        modelsOf(latest),
        collected,
        currentStyle,
      );
      if (!models) {
        ctx.ui.notify(
          "No new models were selected; models configuration is unchanged.",
          "info",
        );
        return undefined;
      }
      return { ...latest, models };
    },
    options,
  );
}

async function editSingleProvider(
  ctx: CommandContext,
  providerId: string,
  options: EditProviderFlowOptions,
): Promise<boolean> {
  let changed = false;
  while (true) {
    const config = loadConfigForFlow(ctx, options);
    const provider = config?.providers?.[providerId];
    if (!config || !provider) {
      if (config)
        ctx.ui.notify(
          'Provider "' + providerId + '" no longer exists.',
          "warning",
        );
      return changed;
    }
    const modelCount = modelsOf(provider).length;
    const action = await selectOne(ctx, "Edit " + providerId, [
      {
        value: "endpoint",
        label: "Provider endpoint",
        suffix: " • " + (provider.baseUrl ?? "unset"),
        description: "Set the provider baseUrl",
      },
      {
        value: "api-key",
        label: "API key",
        description: "Set literal, environment, shell, or placeholder key mode",
      },
      {
        value: "api",
        label: "API flavor",
        suffix: " • " + (provider.api ?? "unset"),
        description: "Set the host API for provider and configured models",
      },
      {
        value: "headers",
        label: "Provider headers",
        description: "Set or clear provider-level HTTP headers",
      },
      {
        value: "developer-role",
        label: "Developer-role compatibility",
        description: "Set the compatible OpenAI developer-role behavior",
      },
      {
        value: "refresh",
        label: "Re-probe model metadata",
        description: "Explicitly discover and add selected new models",
      },
      {
        value: "models",
        label: "Edit models",
        suffix: " • " + modelCount + " model" + (modelCount === 1 ? "" : "s"),
        description: "Change per-model settings or delete a model",
      },
      {
        value: "rename",
        label: "Rename provider",
        description:
          "Change this provider key without overwriting another provider",
      },
      {
        value: "back",
        label: "Back",
        description: "Return to the provider list",
      },
    ]);
    if (!action || action === "back") return changed;

    let saved = false;
    if (action === "endpoint")
      saved = await editProviderEndpoint(ctx, providerId, provider, options);
    else if (action === "api-key")
      saved = await editProviderApiKey(ctx, providerId, provider, options);
    else if (action === "api")
      saved = await editProviderApi(ctx, providerId, provider, options);
    else if (action === "headers")
      saved = await editProviderHeaders(ctx, providerId, provider, options);
    else if (action === "developer-role")
      saved = await editDeveloperRole(ctx, providerId, provider, options);
    else if (action === "refresh")
      saved = await refreshProviderModels(ctx, providerId, provider, options);
    else if (action === "models")
      saved = await editProviderModels(ctx, providerId, options);
    else if (action === "rename") {
      saved = await renameProvider(ctx, providerId, options);
      if (saved) return true;
    }
    changed = changed || saved;
  }
}

/** Edit existing providers without loading credentials or probing until requested. */
export async function editProviderFlow(
  ctx: CommandContext,
  options: EditProviderFlowOptions = {},
): Promise<boolean> {
  let changed = false;
  while (true) {
    const config = loadConfigForFlow(ctx, options);
    if (!config) return changed;
    const providers = providerPickerItems(config);
    if (providers.length === 0) {
      ctx.ui.notify("No providers found to edit.", "warning");
      return changed;
    }
    const providerId = await selectOne(ctx, "Edit provider", providers);
    if (!providerId) {
      if (!changed) unchanged(ctx, "Provider edit canceled.");
      return changed;
    }
    changed = (await editSingleProvider(ctx, providerId, options)) || changed;
  }
}
