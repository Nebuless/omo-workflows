import type { ProviderApi } from "./types.ts";

export function hasExplicitScheme(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim());
}

/** True for loopback, private, and link-local hosts that should default to HTTP. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0.0.0.0"
  )
    return true;
  if (/^(?:fc|fd)[0-9a-f:]*$/i.test(host) || /^fe80:/i.test(host)) return true;

  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const [first, second] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function hostnameFromBareEndpoint(input: string): string | undefined {
  try {
    return new URL("http://" + input.trim()).hostname;
  } catch {
    return undefined;
  }
}

/** Add only the scheme omitted by a user; explicit schemes are never rewritten. */
export function addDefaultScheme(input: string): string {
  const trimmed = input.trim();
  if (hasExplicitScheme(trimmed)) return trimmed;
  const hostname = hostnameFromBareEndpoint(trimmed);
  return (
    (hostname && isLocalHost(hostname) ? "http" : "https") + "://" + trimmed
  );
}

export function isLocalEndpoint(input: string): boolean {
  try {
    return isLocalHost(new URL(addDefaultScheme(input)).hostname);
  } catch {
    return false;
  }
}

function canonicalUrl(url: URL): string {
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function stripSuffix(pathname: string, suffix: string): string {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  return trimmed.endsWith(suffix)
    ? trimmed.slice(0, -suffix.length) || "/"
    : trimmed;
}

/** Remove a copied request endpoint while retaining a configured API base path. */
export function normalizeEndpoint(
  input: string,
  api: ProviderApi = "openai-completions",
): string {
  const url = new URL(addDefaultScheme(input));
  const suffixes =
    api === "anthropic-messages"
      ? ["/messages"]
      : api === "google-generative-ai" || api === "ollama-chat"
        ? ["/models"]
        : ["/chat/completions", "/responses", "/completions", "/models"];
  for (const suffix of suffixes) {
    const stripped = stripSuffix(url.pathname, suffix);
    if (stripped !== url.pathname.replace(/\/+$/, "")) {
      url.pathname = stripped;
      break;
    }
  }
  return canonicalUrl(url);
}

/** Add /v1 only when a preset requires it and the user supplied a bare origin. */
export function ensureV1Path(endpoint: string): string {
  const url = new URL(addDefaultScheme(endpoint));
  if (url.pathname === "" || url.pathname === "/") url.pathname = "/v1";
  return canonicalUrl(url);
}

function alternateV1Path(endpoint: string): string {
  const url = new URL(endpoint);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.pathname =
    pathname === "/v1"
      ? "/"
      : pathname.endsWith("/v1")
        ? pathname.slice(0, -3) || "/"
        : (pathname === "/" ? "" : pathname) + "/v1";
  return canonicalUrl(url);
}

function secureVariant(endpoint: string): string {
  const url = new URL(endpoint);
  url.protocol = "https:";
  return canonicalUrl(url);
}

/**
 * Try the supplied base then its /v1 sibling. Public HTTP endpoints receive
 * HTTPS siblings afterwards; local endpoints are never silently upgraded.
 */
export function endpointCandidates(
  endpoint: string,
  ensureV1 = false,
): string[] {
  const initial = ensureV1
    ? ensureV1Path(endpoint)
    : canonicalUrl(new URL(addDefaultScheme(endpoint)));
  const plain = dedupe([initial, alternateV1Path(initial)]);
  if (new URL(initial).protocol !== "http:" || isLocalEndpoint(initial))
    return plain;
  return dedupe([...plain, ...plain.map(secureVariant)]);
}

function geminiBase(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.pathname === "" || url.pathname === "/") url.pathname = "/v1beta";
  return canonicalUrl(url);
}

/** Return normalized base URLs in deterministic retry order. */
export function modelBaseCandidates(
  endpoint: string,
  api: ProviderApi,
  ensureV1 = false,
): string[] {
  const normalized = normalizeEndpoint(endpoint, api);
  return endpointCandidates(
    api === "google-generative-ai" ? geminiBase(normalized) : normalized,
    ensureV1,
  );
}

export function buildProbeUrl(baseUrl: string): string {
  const withSlash = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  return new URL("models", withSlash).toString();
}

/** Return candidate /models URLs in the same order as their base candidates. */
export function modelUrlCandidates(
  endpoint: string,
  api: ProviderApi,
  ensureV1 = false,
): string[] {
  return modelBaseCandidates(endpoint, api, ensureV1).map(buildProbeUrl);
}

export function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function getPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function firstFiniteNumber(
  value: unknown,
  ...paths: string[]
): number | undefined {
  for (const path of paths) {
    const candidate = getPath(value, path);
    if (typeof candidate === "number" && Number.isFinite(candidate))
      return candidate;
  }
  return undefined;
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "provider"
  );
}

export function suggestProviderId(endpoint: string): string {
  const url = new URL(addDefaultScheme(endpoint));
  const host = url.hostname.replace(/^www\./i, "").replace(/^api\./i, "");
  return "custom-" + slugify(host);
}
