import type { ProviderApi } from "../types.ts";
import { PROBE_TIMEOUT_MS } from "./types.ts";
import type { ProbeFetch } from "./types.ts";

export function resolveFetch(fetcher?: ProbeFetch): ProbeFetch {
  return fetcher ?? globalThis.fetch;
}

export function probeHeaders(
  api: ProviderApi,
  apiKey: string | undefined,
  contentType = false,
): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (contentType) headers["content-type"] = "application/json";
  if (apiKey) {
    headers.authorization = "Bearer " + apiKey;
    if (api === "google-generative-ai") headers["x-goog-api-key"] = apiKey;
  }
  return headers;
}

/** A failed request is deliberately evidence-free: no response/error text is retained. */
export async function requestJson(
  fetcher: ProbeFetch,
  url: string,
  init: RequestInit,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<unknown | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          controller.abort();
          reject(new Error("probe timeout"));
        },
        Math.max(1, timeoutMs),
      );
    });
    const response = await Promise.race([
      fetcher(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
    if (!response.ok) return undefined;
    return await response.json().catch(() => undefined);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
