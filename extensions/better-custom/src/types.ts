/**
 * Host-neutral contracts shared by the better-custom provider wizard.
 *
 * Keep this module dependency-free. Host adapters belong in the implementation
 * modules and may translate these contracts to the active OMP APIs.
 */

/** Provider styles written to the host model configuration. */
export type ProviderStyle =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "ollama-chat";

/** Alias used by config/model code when referring to the host API field. */
export type ProviderApi = ProviderStyle;
export type HostApi = ProviderApi;

export const PROVIDER_STYLES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "ollama-chat",
] as const satisfies readonly ProviderStyle[];

export const PROVIDER_APIS = PROVIDER_STYLES;

/**
 * Credential serialization modes. The prefixed modes are intentionally kept
 * explicit so parsing never confuses a variable or command with a literal.
 */
export type ApiKeyMode =
  | "literal"
  | "$env"
  | "!shell-command"
  | "none-placeholder";
export type SerializedApiKeyMode = ApiKeyMode;
export type ApiKeySourceKind = "literal" | "env" | "shell" | "none";

export interface ApiKeyValue {
  mode: ApiKeyMode;
  value?: string;
}

/** Stable ids for gateway discovery profiles. */
export type GatewayProfileId =
  | "auto"
  | "litellm"
  | "oneapi"
  | "newapi"
  | "openrouter"
  | "generic";

export type GatewayPresetId = GatewayProfileId;

export interface GatewayProfile {
  id: GatewayProfileId;
  ensureV1?: boolean;
}

/** Metadata learned while probing a provider or one of its model endpoints. */
export interface ProbeMetadata {
  contextWindow?: number;
  maxTokens?: number;
  vision?: boolean;
  reasoning?: boolean;
  reasoningEffortOptions?: string[];
  endpointTypes?: string[];
  compat?: Record<string, unknown>;
}

export type ModelProbeInfo = ProbeMetadata;

export interface ProbeResult {
  metadata?: ProbeMetadata;
  models?: ProbeModel[];
}

export interface ProbeModel extends ProbeMetadata {
  id: string;
  name?: string;
}

export type ReasoningCeiling =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export const REASONING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ReasoningCeiling[];

export const PI_THINKING_LEVELS = REASONING_LEVELS;

export type ThinkingLevelMap = {
  [Level in ReasoningCeiling]: string | null;
};

/** Per-model values that the wizard may add or edit. */
export interface ModelOptions {
  reasoning?: ReasoningCeiling;
  vision?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: ThinkingLevelMap;
  compat?: Record<string, unknown>;
  headers?: Record<string, string>;
  api?: ProviderApi;
  baseUrl?: string;
}

/** Action values presented by the per-model editor. */
export type ModelEditOptionKind =
  | "reasoning"
  | "vision"
  | "context"
  | "maxTokens"
  | "override"
  | "delete"
  | "back";

export type ModelEditOption = ModelEditOptionKind;
export type ModelEditKind = ModelEditOptionKind;

export interface ModelEntry extends ModelOptions {
  id: string;
  [key: string]: unknown;
}

export interface ProviderConfig {
  api?: ProviderApi;
  baseUrl?: string;
  apiKey?: string;
  models?: Array<ModelEntry | string>;
  [key: string]: unknown;
}

export interface ModelsConfig {
  providers?: Record<string, ProviderConfig>;
  [key: string]: unknown;
}

export interface SelectItem {
  value: string;
  label: string;
  suffix?: string;
  description?: string;
  searchText?: string;
}

export type ProbeItem = SelectItem;

export type UiNoticeType = "info" | "warning" | "error" | "success";

/** Small adapter surface used by flows; concrete host types stay at the edge. */
export interface UiContext {
  input(title: string, placeholder?: string): Promise<string | undefined>;
  select(
    title: string,
    options: readonly SelectItem[],
  ): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, type?: UiNoticeType): void;
  custom<T>(
    factory: (...args: never[]) => unknown,
    options?: Record<string, unknown>,
  ): Promise<T>;
}

export interface CommandContext {
  ui: UiContext;
  mode?: string;
  hasUI?: boolean;
}

export type CommandHandler = (
  args: string,
  ctx: CommandContext,
) => void | Promise<void>;
