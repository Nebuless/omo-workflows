import { normalizeEndpoint } from "../url.ts";
import { probeHeaders, requestJson, resolveFetch } from "./request.ts";
import type { DeveloperRoleProbeOptions } from "./types.ts";

function isCompletion(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const choices = (value as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return false;
  const message =
    choices[0] && typeof choices[0] === "object"
      ? (choices[0] as Record<string, unknown>).message
      : undefined;
  return Boolean(
    message &&
      typeof message === "object" &&
      typeof (message as Record<string, unknown>).content === "string",
  );
}

function completionUrl(endpoint: string): string {
  const base = normalizeEndpoint(endpoint, "openai-completions");
  return new URL(
    "chat/completions",
    base.endsWith("/") ? base : base + "/",
  ).toString();
}

/**
 * Wire contract: POST normalized /chat/completions with exactly one role message,
 * { model, stream: false, max_tokens: 1, messages: [{ role, content: "Reply with OK" }] }.
 * A system-role control must also return a normal completion; any rejection,
 * malformed body, timeout, or disagreement is unsupported.
 */
export async function probeDeveloperRole(
  options: DeveloperRoleProbeOptions,
): Promise<boolean> {
  const modelId = options.modelId.trim();
  if (!modelId) return false;

  let url: string;
  try {
    url = completionUrl(options.endpoint);
  } catch {
    return false;
  }

  const fetcher = resolveFetch(options.fetch);
  const headers = probeHeaders("openai-completions", options.apiKey, true);
  const request = async (role: "developer" | "system"): Promise<boolean> => {
    const body = {
      model: modelId,
      stream: false,
      max_tokens: 1,
      messages: [{ role, content: "Reply with OK" }],
    };
    const json = await requestJson(
      fetcher,
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      options.timeoutMs,
    );
    return isCompletion(json);
  };

  const developerAccepted = await request("developer");
  const systemAccepted = await request("system");
  return developerAccepted && systemAccepted;
}
