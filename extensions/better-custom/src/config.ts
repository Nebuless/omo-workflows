import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { getAgentDir } from "@code-yeongyu/senpi";
import type { ModelsConfig } from "./types.ts";

/** YAML operations used by the config boundary. */
export interface YamlCodec {
  parse(text: string): unknown;
  stringify(value: unknown): string;
}

/** A discovered models file and the format retained on save. */
export interface ModelsConfigLocation {
  path: string;
  format: "json" | "yaml";
  isOmp: boolean;
  exists: boolean;
}

export interface ModelsConfigDiscoveryOptions {
  agentDir?: string;
  /** Explicitly select OMP discovery; otherwise infer it from the agent path. */
  isOmp?: boolean;
  omp?: boolean;
}

export type ModelsConfigTarget =
  | string
  | ModelsConfigLocation
  | ModelsConfigDiscoveryOptions;

/**
 * Bun's YAML implementation is optional at runtime. Import it dynamically so
 * copying this extension into a non-Bun host does not make the extension fail
 * to load.
 */
async function detectBunYaml(): Promise<YamlCodec | undefined> {
  try {
    const { YAML } = await import("bun");
    if (
      YAML &&
      typeof YAML.parse === "function" &&
      typeof YAML.stringify === "function"
    ) {
      return {
        parse: (text) => YAML.parse(text),
        stringify: (value) => YAML.stringify(value),
      };
    }
  } catch {
    // Non-Bun runtimes use JSON, which is a valid YAML subset.
  }
  return undefined;
}

const BUN_YAML = await detectBunYaml();
export const hasBunYaml = BUN_YAML !== undefined;

/** Return true for the default OMP agent directory and profile variants. */
export function isOmpAgentDir(agentDir: string): boolean {
  return /(?:^|[\\/])\.?omp(?:[\\/]|$)/i.test(agentDir);
}

function formatForPath(path: string): "json" | "yaml" {
  return /\.ya?ml$/i.test(path) ? "yaml" : "json";
}

/**
 * Discover models.yml, models.yaml, then models.json in OMP. Pi only searches
 * models.json. A missing OMP config is assigned models.yml for first write.
 */
export function discoverModelsConfig(
  options: ModelsConfigDiscoveryOptions = {},
): ModelsConfigLocation {
  const agentDir = options.agentDir ?? getAgentDir();
  const isOmp = options.isOmp ?? options.omp ?? isOmpAgentDir(agentDir);
  const names = isOmp
    ? ["models.yml", "models.yaml", "models.json"]
    : ["models.json"];
  const existingName = names.find((name) => existsSync(join(agentDir, name)));
  const name = existingName ?? (isOmp ? "models.yml" : "models.json");
  const path = join(agentDir, name);
  return {
    path,
    format: formatForPath(path),
    isOmp,
    exists: existingName !== undefined,
  };
}

/** Upstream-compatible selected models path. */
export const DEFAULT_MODELS_LOCATION = discoverModelsConfig();
export const MODELS_JSON_PATH = DEFAULT_MODELS_LOCATION.path;
export const MODELS_CONFIG_PATH = MODELS_JSON_PATH;

/** Provider ids owned by OMP/Pi; other entries remain user-owned and untouched. */
export const BUILTIN_PROVIDER_IDS = new Set([
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

let selectedLocation = DEFAULT_MODELS_LOCATION;

function asLocation(
  target: ModelsConfigTarget | undefined,
): ModelsConfigLocation {
  if (!target) return selectedLocation;
  if (typeof target === "string") {
    return {
      path: target,
      format: formatForPath(target),
      isOmp: isOmpAgentDir(dirname(target)),
      exists: existsSync(target),
    };
  }
  if ("path" in target) {
    return {
      path: target.path,
      format: target.format ?? formatForPath(target.path),
      isOmp: target.isOmp,
      exists: target.exists ?? existsSync(target.path),
    };
  }
  return discoverModelsConfig(target);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFailure(
  sourcePath: string,
  format: "json" | "yaml",
  error: unknown,
): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    "Failed to parse " +
      sourcePath +
      " as " +
      format.toUpperCase() +
      ": " +
      detail,
    { cause: error },
  );
}

/**
 * Parse config text independently of filesystem state. Omitted or explicit
 * undefined selects capability-detected Bun YAML; a codec object is injected
 * directly; null forces JSON-only fallback, accepting JSON-as-YAML and
 * rejecting genuine YAML with an actionable error without rewriting it.
 */
export function parseModelsConfigText(
  raw: string,
  format: "json" | "yaml",
  yamlCodec: YamlCodec | null | undefined = BUN_YAML,
  sourcePath = "models config",
): ModelsConfig {
  const codec = yamlCodec === null ? undefined : yamlCodec;
  const text = raw.trim();
  if (!text) return { providers: {} };

  let parsed: unknown;
  if (format === "yaml") {
    if (codec) {
      try {
        parsed = codec.parse(text);
      } catch (error) {
        throw parseFailure(sourcePath, format, error);
      }
    } else {
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new Error(
          sourcePath +
            " contains YAML, but Bun YAML support is unavailable. " +
            "Run this extension under Bun or install/reinstall OMP before editing genuine YAML files.",
          { cause: error },
        );
      }
    }
  } else {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw parseFailure(sourcePath, format, error);
    }
  }

  if (!isRecord(parsed)) {
    throw new Error(sourcePath + " must contain a top-level object.");
  }
  if (!isRecord(parsed.providers)) parsed.providers = {};
  return parsed as ModelsConfig;
}

/**
 * Serialize config text. Omitted or explicit undefined selects detected Bun
 * YAML, a codec object is injected directly, and null writes indented JSON.
 */
export function stringifyModelsConfig(
  config: ModelsConfig,
  format: "json" | "yaml",
  yamlCodec: YamlCodec | null | undefined = BUN_YAML,
): string {
  const codec = yamlCodec === null ? undefined : yamlCodec;
  if (!isRecord(config))
    throw new Error("models config must be a top-level object");
  if (format === "yaml" && codec) {
    try {
      return codec.stringify(config).trimEnd();
    } catch (error) {
      throw new Error(
        "Failed to write YAML models config: " +
          (error instanceof Error ? error.message : String(error)),
        { cause: error },
      );
    }
  }
  // JSON is a valid YAML subset and is the portable non-Bun representation.
  return JSON.stringify(config, null, 2);
}

function ensureConfigDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

/** Load the selected models file while preserving every unknown field. */
export function loadModelsConfig(target?: ModelsConfigTarget): ModelsConfig {
  const location = asLocation(target);
  selectedLocation = location;
  ensureConfigDir(location.path);
  if (!existsSync(location.path)) return { providers: {} };
  const raw = readFileSync(location.path, "utf8");
  return parseModelsConfigText(raw, location.format, BUN_YAML, location.path);
}

/** Save to the path/format selected by discovery or the explicit target. */
export function saveModelsConfig(
  config: ModelsConfig,
  target?: ModelsConfigTarget,
): void {
  const location = asLocation(target);
  selectedLocation = location;
  ensureConfigDir(location.path);
  const content =
    stringifyModelsConfig(config, location.format, BUN_YAML).trimEnd() + "\n";
  const temporaryPath = join(
    dirname(location.path),
    `.${location.path.split(/[\\/]/).pop()}.tmp-${process.pid}-${randomUUID()}`,
  );
  try {
    writeFileSync(temporaryPath, content, "utf8");
    renameSync(temporaryPath, location.path);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch {
      /* cleanup best effort */
    }
  }
}

/** Expose the selected path for callers that need to display or audit it. */
export function getSelectedModelsConfig(): ModelsConfigLocation {
  return selectedLocation;
}
