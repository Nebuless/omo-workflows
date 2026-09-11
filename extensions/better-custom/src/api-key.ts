import { execSync } from "node:child_process";
import type {
  ApiKeyMode,
  ApiKeySourceKind,
  ApiKeyValue,
  ProviderStyle,
} from "./types.ts";

/** Accepted semantic aliases keep this boundary compatible with upstream Pi. */
export type ApiKeyModeLike = ApiKeyMode | ApiKeySourceKind;
export type ApiKeyStyle = ProviderStyle | "ollama";

/** Injectable probe resolvers keep credential tests deterministic. */
export interface ApiKeyResolutionOptions {
  env?: Record<string, string | undefined>;
  runShell?: (command: string) => string | undefined;
}

function isNoneMode(mode: ApiKeyModeLike): boolean {
  return mode === "none-placeholder" || mode === "none";
}

function isEnvMode(mode: ApiKeyModeLike): boolean {
  return mode === "$env" || mode === "env";
}

function isShellMode(mode: ApiKeyModeLike): boolean {
  return mode === "!shell-command" || mode === "shell";
}

function isOllamaStyle(style: ApiKeyStyle | undefined): boolean {
  return style === "ollama" || style === "ollama-chat";
}

/**
 * Serialize the host's apiKey reference. Prefixes are data, not resolved
 * credentials: $NAME reads an environment variable and !command runs a shell
 * command only when a caller explicitly resolves it for probing.
 */
export function serializeApiKey(
  modeOrValue: ApiKeyModeLike | ApiKeyValue,
  valueOrStyle?: string | ApiKeyStyle,
  styleArg?: ApiKeyStyle,
): string | undefined {
  let mode: ApiKeyModeLike;
  let value: string | undefined;
  let style: ApiKeyStyle | undefined;

  if (typeof modeOrValue === "object" && modeOrValue !== null) {
    mode = modeOrValue.mode;
    value = modeOrValue.value;
    style =
      styleArg ??
      (typeof valueOrStyle === "string"
        ? (valueOrStyle as ApiKeyStyle)
        : undefined);
  } else {
    mode = modeOrValue;
    value = typeof valueOrStyle === "string" ? valueOrStyle : undefined;
    style = styleArg;
    // Allow serializeApiKey("none", "ollama") as a compact call form.
    if (isNoneMode(mode) && isOllamaStyle(value as ApiKeyStyle | undefined)) {
      style = value as ApiKeyStyle;
      value = undefined;
    }
  }

  if (isNoneMode(mode)) return isOllamaStyle(style) ? "ollama" : "dummy";
  if (!value) return undefined;
  if (isEnvMode(mode)) return value.startsWith("$") ? value : "$" + value;
  if (isShellMode(mode)) return value.startsWith("!") ? value : "!" + value;
  return value;
}

/** Parse a stored apiKey reference without resolving or exposing its secret. */
export function parseApiKey(storedValue: unknown): ApiKeyValue {
  if (typeof storedValue !== "string" || storedValue.length === 0) {
    return { mode: "none-placeholder" };
  }
  if (storedValue === "dummy" || storedValue === "ollama") {
    return { mode: "none-placeholder" };
  }
  if (storedValue.startsWith("!")) {
    return { mode: "!shell-command", value: storedValue.slice(1) };
  }
  if (storedValue.startsWith("$")) {
    return { mode: "$env", value: storedValue.slice(1) };
  }
  return { mode: "literal", value: storedValue };
}

/** Upstream-compatible provider helper; parsing never executes a command. */
export function apiKeyFromProvider(
  provider: { apiKey?: unknown } | null | undefined,
): ApiKeyValue {
  return parseApiKey(provider?.apiKey);
}

/** Resolve a parsed reference for a probe using injectable env/shell seams. */
export function resolveApiKeyForProbe(
  modeOrValue: ApiKeyModeLike | ApiKeyValue,
  storedValue?: string,
  options: ApiKeyResolutionOptions = {},
): string | undefined {
  let mode: ApiKeyModeLike;
  let value: string | undefined;
  if (typeof modeOrValue === "object" && modeOrValue !== null) {
    mode = modeOrValue.mode;
    value = modeOrValue.value;
  } else {
    mode = modeOrValue;
    value = storedValue;
  }

  if (!value || isNoneMode(mode)) return undefined;
  if (isEnvMode(mode)) {
    const name = value.startsWith("$") ? value.slice(1) : value;
    const environment = options.env ?? process.env;
    return environment[name]?.trim() || undefined;
  }
  if (isShellMode(mode)) {
    const command = value.startsWith("!") ? value.slice(1) : value;
    try {
      if (options.runShell)
        return options.runShell(command)?.trim() || undefined;
      return (
        execSync(command, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim() || undefined
      );
    } catch {
      return undefined;
    }
  }
  return value;
}

/** Resolve a provider reference only when a probe explicitly needs its secret. */
export function resolveProviderApiKey(
  provider: { apiKey?: unknown } | null | undefined,
  options: ApiKeyResolutionOptions = {},
): string | undefined {
  return resolveApiKeyForProbe(
    apiKeyFromProvider(provider),
    undefined,
    options,
  );
}
