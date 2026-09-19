import { parseApiKey } from "../api-key.ts";
import { normalizeThinkingLevelMap } from "../model-entry.ts";
import type {
  ApiKeyMode,
  ApiKeyValue,
  CommandContext,
  GatewayPresetId,
  ProviderApi,
  ProviderStyle,
  ReasoningCeiling,
  SelectItem,
  ThinkingLevelMap,
  UiNoticeType,
} from "../types.ts";
import { PI_THINKING_LEVELS, REASONING_LEVELS } from "../types.ts";

export { selectOne } from "./select.ts";

/** Native Atomic UI methods, kept at the edge so tests can use a tiny fake context. */
type NativeUi = {
  select(
    title: string,
    options: readonly string[],
    dialogOptions?: { initialIndex?: number },
  ): Promise<string | undefined>;
  setWorkingMessage?(message?: string): void;
};

function nativeUi(ctx: CommandContext): NativeUi {
  return ctx.ui as unknown as NativeUi;
}

async function nativeSelect(
  ctx: CommandContext,
  title: string,
  options: readonly SelectItem[],
  initialIndex?: number,
): Promise<string | undefined> {
  // Atomic's native selector accepts labels, not OMP's `{ label, description }` objects.
  // Passing those objects directly renders every row as `[object Object]`.
  const hostOptions = options.map(({ label, description }) =>
    description ? label + " — " + description : label,
  );
  const selected = await nativeUi(ctx).select(
    title,
    hostOptions,
    initialIndex === undefined ? undefined : { initialIndex },
  );
  if (selected === undefined) return undefined;
  const selectedIndex = hostOptions.indexOf(selected);
  return (
    options[selectedIndex]?.value ??
    options.find((option) => option.label === selected)?.value ??
    selected
  );
}

/** Set Atomic's working text; the host may render it as a spinner/status line. */
export function setWorkingMessage(ctx: CommandContext, message?: string): void {
  const setMessage = nativeUi(ctx).setWorkingMessage;
  if (typeof setMessage === "function") setMessage.call(ctx.ui, message);
}

const API_KEY_MODE_ITEMS = [
  {
    value: "literal",
    label: "API key",
    description: "Stored verbatim in the active models config",
  },
  {
    value: "none",
    label: "None",
    description: "No key; a placeholder is written so the provider still loads",
  },
  {
    value: "$env",
    label: "Environment variable",
    description: "Stored as a $NAME reference in the active models config",
  },
  {
    value: "!shell-command",
    label: "Shell command",
    description: "Stored as a !command reference in the active models config",
  },
] as const satisfies readonly SelectItem[];

type ApiKeyChoice = (typeof API_KEY_MODE_ITEMS)[number]["value"];

async function chooseApiKeyMode(
  ctx: CommandContext,
): Promise<ApiKeyChoice | undefined> {
  const choice = await nativeSelect(ctx, "API key", API_KEY_MODE_ITEMS);
  return choice as ApiKeyChoice | undefined;
}

function apiKeyValueInput(choice: ApiKeyChoice): {
  title: string;
  placeholder: string;
} {
  if (choice === "$env")
    return {
      title: "API key environment variable",
      placeholder: "e.g. OPENAI_API_KEY",
    };
  if (choice === "!shell-command")
    return {
      title: "API key shell command",
      placeholder: "e.g. op read op://vault/api-key",
    };
  return {
    title: "API key",
    placeholder: "saved directly in the active models config",
  };
}

export async function promptApiKey(
  ctx: CommandContext,
): Promise<{ mode: ApiKeyMode; value?: string } | null> {
  const choice = await chooseApiKeyMode(ctx);
  if (choice === undefined) return null;
  if (choice === "none") return { mode: "none-placeholder" };
  const input = apiKeyValueInput(choice);
  const value = await ctx.ui.input(input.title, input.placeholder);
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return { mode: "none-placeholder" };
  if (choice === "$env") return { mode: "$env", value: trimmed };
  if (choice === "!shell-command")
    return { mode: "!shell-command", value: trimmed };
  return { mode: "literal", value: trimmed };
}

/** Outcome of an edit-context API-key prompt: replace the stored reference, keep it, or cancel. */
export type PromptApiKeyEditResult =
  | { kind: "cancel" }
  | { kind: "keep"; mode: ApiKeyMode }
  | { kind: "replace"; apiKey: ApiKeyValue };

/**
 * Prompt for an API key while editing an existing provider. Unlike the add
 * wizard, a blank value keeps the stored reference (parsing never exposes the
 * secret) instead of downgrading it to the placeholder; the None option stays
 * the explicit way to clear.
 */
export async function promptApiKeyEdit(
  ctx: CommandContext,
  storedApiKey: unknown,
): Promise<PromptApiKeyEditResult> {
  const choice = await chooseApiKeyMode(ctx);
  if (choice === undefined) return { kind: "cancel" };
  if (choice === "none")
    return { kind: "replace", apiKey: { mode: "none-placeholder" } };
  const input = apiKeyValueInput(choice);
  const value = await ctx.ui.input(input.title, input.placeholder);
  if (value === undefined) return { kind: "cancel" };
  const trimmed = value.trim();
  if (!trimmed) return { kind: "keep", mode: parseApiKey(storedApiKey).mode };
  if (choice === "$env")
    return { kind: "replace", apiKey: { mode: "$env", value: trimmed } };
  if (choice === "!shell-command")
    return {
      kind: "replace",
      apiKey: { mode: "!shell-command", value: trimmed },
    };
  return { kind: "replace", apiKey: { mode: "literal", value: trimmed } };
}

function reasoningLabel(level: ReasoningCeiling): string {
  if (level === "off") return "Off - no reasoning";
  if (level === "xhigh")
    return "xhigh - maximum (only if the model supports it)";
  if (level === "max") return "max - maximum (only if the model supports it)";
  return level + " - cap reasoning at " + level;
}

/** Prompts for a reasoning ceiling. Returns null if cancelled. */
export async function promptReasoning(
  ctx: CommandContext,
  current?: ReasoningCeiling,
): Promise<ReasoningCeiling | null> {
  const items: SelectItem[] = REASONING_LEVELS.map((level) => ({
    value: level,
    label: reasoningLabel(level),
  }));
  const initialIndex = current ? REASONING_LEVELS.indexOf(current) : 0;
  const choice = await nativeSelect(
    ctx,
    "Reasoning",
    items,
    Math.max(0, initialIndex),
  );
  return (choice as ReasoningCeiling | undefined) ?? null;
}

export type ThinkingLevelMapPromptResult =
  | { kind: "cancel" }
  | { kind: "invalid"; message: string }
  | { kind: "set"; map: ThinkingLevelMap };

/** Prompt every canonical OMO level and return one validated native map. */
export async function promptThinkingLevelMap(
  ctx: CommandContext,
  current?: ThinkingLevelMap,
): Promise<ThinkingLevelMapPromptResult> {
  const map: Record<string, string | null> = {};
  for (const level of PI_THINKING_LEVELS) {
    const value = await ctx.ui.input(
      level + " provider value",
      current?.[level] === null
        ? "current: disabled (enter provider value, '-' = disabled)"
        : current?.[level]
          ? "current: " + current[level] + " (enter '-' = disabled)"
          : "provider value (enter '-' = disabled)",
    );
    if (value === undefined) return { kind: "cancel" };
    const trimmed = value.trim();
    if (!trimmed)
      return {
        kind: "invalid",
        message: "Every thinking level needs a provider value or '-'.",
      };
    map[level] = trimmed === "-" ? null : trimmed;
  }
  const normalized = normalizeThinkingLevelMap(map);
  return normalized
    ? { kind: "set", map: normalized }
    : { kind: "invalid", message: "Thinking-level map is invalid." };
}

/** Provider-facing spelling for xhigh/max when a gateway uses a custom name. */
export async function promptCeilingProviderString(
  ctx: CommandContext,
  level: "xhigh" | "max",
  current?: string,
): Promise<string | undefined> {
  const value = await ctx.ui.input(
    level + " provider value (blank = " + level + ")",
    current && current !== level
      ? "current: " + current
      : "e.g. max (leave blank to send " + level + ")",
  );
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export async function promptVision(
  ctx: CommandContext,
  current?: boolean,
): Promise<boolean | null> {
  const choice = await nativeSelect(
    ctx,
    "Image input (vision)",
    [
      {
        value: "yes",
        label: "Yes - send text + images",
        description: "Sets input: [text, image]",
      },
      {
        value: "no",
        label: "No - text only",
        description: "Sets input: [text]",
      },
    ],
    current === false ? 1 : 0,
  );
  if (choice === undefined) return null;
  return choice === "yes";
}

/**
 * Outcome of a numeric token prompt as a tagged union: set the parsed value,
 * keep the current one, reject invalid input, or cancel. Tagged so consumers
 * fail to compile unless they handle the invalid case.
 */
export type TokenPromptResult =
  | { kind: "cancel" }
  | { kind: "keep" }
  | { kind: "invalid"; message: string }
  | { kind: "set"; tokens: number };

async function promptTokenCount(
  ctx: CommandContext,
  title: string,
  unsetPlaceholder: string,
  current?: number,
): Promise<TokenPromptResult> {
  const value = await ctx.ui.input(
    title,
    current
      ? "current: " + current + " (blank = keep, 0 = clear)"
      : unsetPlaceholder,
  );
  if (value === undefined) return { kind: "cancel" };
  const trimmed = value.trim();
  if (!trimmed) return { kind: "keep" };
  const parsed = Number.parseInt(trimmed.replace(/[_,]/g, ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      kind: "invalid",
      message: "Enter a whole number of tokens (0 to clear).",
    };
  }
  return { kind: "set", tokens: parsed };
}

export function promptContextWindow(
  ctx: CommandContext,
  current?: number,
): Promise<TokenPromptResult> {
  return promptTokenCount(
    ctx,
    "Context window (tokens)",
    "e.g. 128000 (blank = unset)",
    current,
  );
}

export function promptMaxTokens(
  ctx: CommandContext,
  current?: number,
): Promise<TokenPromptResult> {
  return promptTokenCount(
    ctx,
    "Max output tokens",
    "e.g. 8192 (blank = unset)",
    current,
  );
}

export async function promptModelIdsOneByOne(
  ctx: CommandContext,
  style: ProviderStyle,
): Promise<string[] | null> {
  const modelIds: string[] = [];
  const firstPlaceholder =
    style === "anthropic-messages"
      ? "e.g. claude-sonnet-4-5 (blank to finish)"
      : style === "ollama-chat"
        ? "e.g. llama3.1:8b or qwen2.5-coder:7b (blank to finish)"
        : style === "google-generative-ai"
          ? "e.g. gemini-2.5-pro (blank to finish)"
          : "e.g. gpt-4o-mini or qwen/qwen3-coder (blank to finish)";
  const nextPlaceholder =
    style === "anthropic-messages"
      ? "another Anthropic-style model id (blank to finish)"
      : style === "ollama-chat"
        ? "another Ollama model id (blank to finish)"
        : style === "google-generative-ai"
          ? "another Gemini model id (blank to finish)"
          : "another OpenAI-style model id (blank to finish)";

  while (true) {
    const value = await ctx.ui.input(
      modelIds.length === 0 ? "Model id" : "Add another model id",
      modelIds.length === 0 ? firstPlaceholder : nextPlaceholder,
    );
    if (value === undefined) return null;
    const trimmed = value.trim();
    if (!trimmed) {
      if (modelIds.length === 0) {
        ctx.ui.notify("Add at least one model.", "warning");
        continue;
      }
      return modelIds;
    }
    if (modelIds.includes(trimmed)) {
      ctx.ui.notify("Model already added: " + trimmed, "warning");
      continue;
    }
    modelIds.push(trimmed);
  }
}

const GATEWAY_OPTIONS: readonly (SelectItem & { value: GatewayPresetId })[] = [
  {
    value: "auto",
    label: "Auto",
    description: "Probe every compatible metadata source",
  },
  {
    value: "litellm",
    label: "LiteLLM",
    description: "Use LiteLLM model metadata endpoints",
  },
  {
    value: "oneapi",
    label: "One API",
    description: "Use the One API-compatible route",
  },
  {
    value: "newapi",
    label: "New API",
    description: "Use the New API-compatible route",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    description: "Use OpenRouter model metadata",
  },
  {
    value: "generic",
    label: "Generic",
    description: "Probe only the provider endpoint",
  },
];

export async function promptGatewayPreset(
  ctx: CommandContext,
): Promise<GatewayPresetId | null> {
  const choice = await nativeSelect(ctx, "Gateway type", GATEWAY_OPTIONS);
  return (choice as GatewayPresetId | undefined) ?? null;
}

const PROVIDER_STYLE_OPTIONS: readonly (SelectItem & {
  value: ProviderStyle;
})[] = [
  {
    value: "openai-completions",
    label: "OpenAI-compatible (Chat Completions)",
    description: 'api: "openai-completions"',
  },
  {
    value: "openai-responses",
    label: "OpenAI Responses API",
    description: 'api: "openai-responses"',
  },
  {
    value: "anthropic-messages",
    label: "Anthropic-compatible",
    description: 'api: "anthropic-messages"',
  },
  {
    value: "google-generative-ai",
    label: "Gemini (Google generative AI)",
    description: 'api: "google-generative-ai"',
  },
  {
    value: "ollama-chat",
    label: "Ollama-compatible",
    description: 'api: "ollama-chat"; apiKey: "ollama"',
  },
];

export async function promptProviderStyle(
  ctx: CommandContext,
): Promise<{ style: ProviderStyle; api: ProviderApi } | null> {
  const choice = await nativeSelect(
    ctx,
    "Provider style",
    PROVIDER_STYLE_OPTIONS,
  );
  if (choice === undefined) return null;
  const style = choice as ProviderStyle;
  return { style, api: style };
}

function endpointPlaceholder(style: ProviderStyle): string {
  if (style === "anthropic-messages")
    return "e.g. https://api.anthropic-proxy.com/v1";
  if (style === "ollama-chat") return "e.g. http://localhost:11434/v1";
  if (style === "google-generative-ai")
    return "e.g. https://generativelanguage.googleapis.com/v1beta";
  if (style === "openai-responses") return "e.g. https://api.openai.com/v1";
  return "e.g. https://api.example.com/v1 or http://localhost:11434/v1";
}

function stripEndpointPath(pathname: string, api: ProviderApi): string {
  const suffixes =
    api === "anthropic-messages"
      ? ["/messages"]
      : api === "google-generative-ai"
        ? ["/models"]
        : ["/chat/completions", "/responses", "/completions", "/models"];
  let result = pathname;
  for (const suffix of suffixes) {
    if (result.endsWith(suffix)) result = result.slice(0, -suffix.length);
  }
  return result.replace(/\/+$/, "");
}

function normalizeEndpoint(raw: string, api: ProviderApi): string {
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    ? raw
    : "https://" + raw;
  const parsed = new URL(candidate);
  const pathname = stripEndpointPath(parsed.pathname || "", api);
  return parsed.origin + (pathname && pathname !== "/" ? pathname : "");
}

export async function promptEndpoint(
  ctx: CommandContext,
  style: ProviderStyle,
  api: ProviderApi,
): Promise<{ normalized: string; raw: string } | null> {
  const endpointInput = await ctx.ui.input(
    "Endpoint",
    endpointPlaceholder(style),
  );
  if (endpointInput === undefined) return null;
  const raw = endpointInput.trim();
  if (!raw) {
    ctx.ui.notify("Endpoint is required.", "error");
    return null;
  }
  try {
    return { normalized: normalizeEndpoint(raw, api), raw };
  } catch (error) {
    ctx.ui.notify(
      "Invalid endpoint: " +
        (error instanceof Error ? error.message : String(error)),
      "error",
    );
    return null;
  }
}

export function promptSlugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Result of the add/rename provider-id gate applied to a candidate id. */
export type ProviderIdGate =
  | { kind: "cancel" }
  | { kind: "invalid"; message: string; notify: UiNoticeType }
  | { kind: "confirm"; id: string }
  | { kind: "accept"; id: string };

/** Confirmation copy shared when a chosen id shadows a built-in provider. */
export function builtinOverrideConfirm(id: string): {
  title: string;
  message: string;
} {
  return {
    title: "Override built-in provider?",
    message:
      '"' +
      id +
      '" matches a built-in provider id. Saving this will override that provider in the active models config. Continue?',
  };
}

/**
 * Shared add/rename gate: slugify the candidate, require uniqueness against
 * existing ids, and demand explicit confirmation before shadowing a built-in
 * provider id. UI-free so both flows stay byte-identical in behavior.
 */
export function gateProviderId(
  rawInput: string,
  currentId: string | undefined,
  existingProviderIds: Iterable<string>,
): ProviderIdGate {
  const candidate = promptSlugify(rawInput.trim() || (currentId ?? ""));
  if (!candidate)
    return {
      kind: "invalid",
      message: "Provider name is required.",
      notify: "error",
    };
  if (candidate === currentId) return { kind: "cancel" };
  const existingIds = new Set(existingProviderIds);
  if (existingIds.has(candidate)) {
    return {
      kind: "invalid",
      message:
        'Provider "' + candidate + '" already exists. Choose a different name.',
      notify: "warning",
    };
  }
  if (BUILTIN_PROVIDER_IDS.has(candidate))
    return { kind: "confirm", id: candidate };
  return { kind: "accept", id: candidate };
}

function suggestProviderId(endpoint: string): string {
  try {
    const parsed = new URL(endpoint);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname
      .split("/")
      .filter(Boolean)
      .slice(0, 1)
      .join("-");
    return promptSlugify(path ? host + "-" + path : host) || "custom-provider";
  } catch {
    return "custom-provider";
  }
}

const BUILTIN_PROVIDER_IDS = new Set([
  "anthropic",
  "openai",
  "azure-openai",
  "google",
  "vertex",
  "bedrock",
  "mistral",
  "groq",
  "cerebras",
  "xai",
  "openrouter",
  "vercel-ai-gateway",
  "zai",
  "huggingface",
  "kimi-for-coding",
  "minimax",
  "ollama",
]);

/**
 * Prompt for a unique provider id. Existing ids are supplied by the config
 * owner so this UI layer never loads or mutates models configuration itself.
 */
export async function promptProviderId(
  ctx: CommandContext,
  normalizedEndpoint: string,
  existingProviderIds: Iterable<string> = [],
): Promise<string | null> {
  const existingIds = new Set(existingProviderIds);
  const providerIdSuggestion = suggestProviderId(normalizedEndpoint);
  const suggestionTaken = existingIds.has(providerIdSuggestion);

  while (true) {
    const providerNameInput = await ctx.ui.input(
      suggestionTaken
        ? "Provider name (must be unique)"
        : "Provider name (blank = " + providerIdSuggestion + ")",
      "e.g. custom-example-com",
    );
    if (providerNameInput === undefined) return null;
    const gate = gateProviderId(providerNameInput, undefined, existingIds);
    if (gate.kind === "invalid") {
      ctx.ui.notify(gate.message, gate.notify);
      continue;
    }
    if (gate.kind === "cancel") continue;
    if (gate.kind === "confirm") {
      const confirm = builtinOverrideConfirm(gate.id);
      const ok = await ctx.ui.confirm(confirm.title, confirm.message);
      if (!ok) continue;
    }
    return gate.id;
  }
}
