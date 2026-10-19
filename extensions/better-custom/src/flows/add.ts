import { resolveApiKeyForProbe } from "../api-key.ts";
import type { ModelsConfigTarget } from "../config.ts";
import { buildProviderConfig } from "../model-entry.ts";
import type { DeveloperRoleProbeOptions, ProbeFetch } from "../probe/index.ts";
import { probeDeveloperRole } from "../probe/index.ts";
import type { CommandContext, ProviderStyle } from "../types.ts";
import { PROVIDER_STYLES } from "../types.ts";
import {
  promptApiKey,
  promptEndpoint,
  promptProviderId,
  promptProviderStyle,
  setWorkingMessage,
} from "../ui/prompts.ts";
import { normalizeEndpoint } from "../url.ts";
import type { ProbeRunner } from "./shared.ts";
import {
  collectProviderModels,
  loadConfigForFlow,
  persistProvider,
  uniqueModelIds,
  validateUniqueProviderName,
} from "./shared.ts";

export type DeveloperRoleRunner = (
  options: DeveloperRoleProbeOptions,
) => Promise<boolean>;

/** Injectable seams keep the interactive flow deterministic under the test host. */
export interface AddProviderFlowOptions {
  configTarget?: ModelsConfigTarget;
  fetch?: ProbeFetch;
  probeGateway?: ProbeRunner;
  probeDeveloperRole?: DeveloperRoleRunner;
}

function leaveConfigUnchanged(ctx: CommandContext): false {
  ctx.ui.notify(
    "Provider was not added; models configuration is unchanged.",
    "info",
  );
  return false;
}

function isSupportedStyle(style: string): style is ProviderStyle {
  return PROVIDER_STYLES.includes(style as ProviderStyle);
}

function isOpenAiStyle(style: string): boolean {
  return style === "openai-completions" || style === "openai-responses";
}

async function probeDeveloperRoleSupport(
  ctx: CommandContext,
  endpoint: string,
  modelId: string,
  apiKey: string | undefined,
  options: AddProviderFlowOptions,
): Promise<boolean> {
  try {
    setWorkingMessage(ctx, "Checking developer-role support...");
    const supportsDeveloperRole = await (
      options.probeDeveloperRole ?? probeDeveloperRole
    )({
      endpoint,
      modelId,
      apiKey,
      fetch: options.fetch,
    });
    if (!supportsDeveloperRole) {
      ctx.ui.notify(
        "Developer-role support could not be confirmed; it will be disabled for this provider.",
        "info",
      );
    }
    return supportsDeveloperRole;
  } catch {
    ctx.ui.notify(
      "Developer-role support could not be confirmed; it will be disabled for this provider.",
      "info",
    );
    return false;
  } finally {
    setWorkingMessage(ctx);
  }
}

/** Run the add-provider wizard without mutating config until every input is valid. */
export async function addProviderFlow(
  ctx: CommandContext,
  options: AddProviderFlowOptions = {},
): Promise<boolean> {
  const styleChoice = await promptProviderStyle(ctx);
  if (!styleChoice) return leaveConfigUnchanged(ctx);
  if (!isSupportedStyle(styleChoice.style)) {
    ctx.ui.notify("Unsupported provider style.", "error");
    return leaveConfigUnchanged(ctx);
  }

  const endpointInput = await promptEndpoint(
    ctx,
    styleChoice.style,
    styleChoice.api,
  );
  if (!endpointInput) return leaveConfigUnchanged(ctx);

  let endpoint: string;
  try {
    endpoint = normalizeEndpoint(endpointInput.raw, styleChoice.api);
  } catch {
    ctx.ui.notify("Endpoint is invalid.", "error");
    return leaveConfigUnchanged(ctx);
  }

  const config = loadConfigForFlow(ctx, options);
  if (!config) return leaveConfigUnchanged(ctx);

  const providerId = await promptProviderId(
    ctx,
    endpoint,
    Object.keys(config.providers ?? {}),
  );
  if (!providerId) return leaveConfigUnchanged(ctx);
  const nameError = validateUniqueProviderName(providerId, config);
  if (nameError) {
    ctx.ui.notify(nameError, "warning");
    return leaveConfigUnchanged(ctx);
  }

  const apiKey = await promptApiKey(ctx);
  if (!apiKey) return leaveConfigUnchanged(ctx);

  const collected = await collectProviderModels({
    ctx,
    style: styleChoice.style,
    endpoint,
    apiKey,
    fetch: options.fetch,
    probeGateway: options.probeGateway,
  });
  const modelIds = collected ? uniqueModelIds(collected.ids) : [];
  if (!collected || modelIds.length === 0) return leaveConfigUnchanged(ctx);

  let developerRole: boolean | undefined;
  if (isOpenAiStyle(styleChoice.style)) {
    const resolvedApiKey =
      collected.resolvedApiKey ?? resolveApiKeyForProbe(apiKey);
    const firstModelId = modelIds[0];
    if (!firstModelId) return leaveConfigUnchanged(ctx);
    developerRole = await probeDeveloperRoleSupport(
      ctx,
      collected.baseUrl,
      firstModelId,
      resolvedApiKey,
      options,
    );
  }

  const providerConfig = buildProviderConfig({
    providerId,
    style: styleChoice.style,
    api: styleChoice.api,
    baseUrl: collected.baseUrl,
    apiKey,
    modelIds,
    reasoning: "xhigh",
    infoById: collected.infoById,
    developerRole,
  });
  if (!(await persistProvider(ctx, providerId, providerConfig, options)))
    return leaveConfigUnchanged(ctx);

  ctx.ui.notify(
    'Saved provider "' + providerId + '". Open /model to use it.',
    "success",
  );
  return true;
}
