import { expect, test } from "bun:test";
import { probeGateway } from "../src/probe/index.ts";
import { probeHeaders } from "../src/probe/request.ts";

test("native headers can replace or remove default probe authentication", () => {
  const headers = probeHeaders("openai-responses", "default-key", false, {
    Authorization: null,
    "X-Api-Key": "native-key",
  });
  expect(new Headers(headers).get("authorization")).toBeNull();
  expect(new Headers(headers).get("x-api-key")).toBe("native-key");
});

test("supplements an OpenAI list with the existing Codex catalog limits", async () => {
  const requests: string[] = [];
  const result = await probeGateway({
    endpoint: "https://gateway.example/proxy/v1",
    api: "openai-responses",
    preset: "generic",
    apiKey: "test-key",
    fetch: async (input, init) => {
      const url = String(input);
      requests.push(url);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer test-key",
      );
      if (url.endsWith("/models?client_version=cpa")) {
        return Response.json({
          models: [
            {
              slug: "codex",
              context_window: 500_000,
              max_context_window: 872_000,
              max_tokens: 128_000,
              input_modalities: ["text", "image"],
            },
            { slug: "unavailable", context_window: 1_000_000 },
          ],
        });
      }
      if (url.endsWith("/models")) {
        return Response.json({ data: [{ id: "codex" }] });
      }
      return new Response(null, { status: 404 });
    },
  });
  expect(result.ids).toEqual(["codex"]);
  expect(result.metadataById.get("codex")).toEqual({
    contextWindow: 500_000,
    maxTokens: 128_000,
    vision: true,
  });
  expect(result.metadataById.has("unavailable")).toBe(false);
  expect(requests).toContain(
    "https://gateway.example/proxy/v1/models?client_version=cpa",
  );
});

test("keeps authoritative inline limits and tolerates an unsupported Codex route", async () => {
  for (const status of [200, 404, 401]) {
    const result = await probeGateway({
      endpoint: "https://gateway.example/v1",
      api: "openai-completions",
      preset: "generic",
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith("?client_version=cpa")) {
          return status === 200
            ? Response.json({
                models: [
                  {
                    slug: "codex",
                    context_window: 900_000,
                    max_tokens: 90_000,
                  },
                ],
              })
            : new Response(null, { status });
        }
        if (url.endsWith("/models")) {
          return Response.json({
            data: [{ id: "codex", context_window: 272_000 }],
          });
        }
        return new Response(null, { status: 404 });
      },
    });
    expect(result.metadataById.get("codex")?.contextWindow).toBe(272_000);
    expect(result.metadataById.get("codex")?.maxTokens).toBe(
      status === 200 ? 90_000 : undefined,
    );
  }
});
