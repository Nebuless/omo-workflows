import { describe, expect, test } from "bun:test";
import {
  registerBetterCustomProviders,
  registrationConfig,
} from "../src/model-browser.ts";
import type { ModelEntry, ProviderConfig } from "../src/types.ts";

const gatewayProvider: ProviderConfig = {
  baseUrl: "https://gateway.example/v1",
  api: "openai-completions",
  apiKey: "$GATEWAY_API_KEY",
  compat: { supportsDeveloperRole: false },
  models: [
    {
      id: "Main/hf:zai-org/GLM-5.3-Flash",
      input: ["text"],
      reasoning: "high",
      contextWindow: 200_000,
    },
    "auto",
  ],
};

describe("better-custom gateway registration", () => {
  test("fills host-required metadata for gateway model definitions", () => {
    const result = registrationConfig(gatewayProvider);
    const model = (
      result.models as unknown as Array<unknown> | undefined
    )?.[0] as Record<string, unknown>;
    const cost = model.cost as Record<string, unknown>;

    expect(model.id).toBe("Main/hf:zai-org/GLM-5.3-Flash");
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("https://gateway.example/v1");
    expect(model.name).toBe("Main/hf:zai-org/GLM-5.3-Flash");
    expect(model.contextWindow).toBe(200_000);
    expect(model.maxTokens).toBe(16_384);
    expect(cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(model.compat).toEqual({ supportsDeveloperRole: false });
  });
  test("preserves native thinking map and model compatibility", () => {
    const thinkingLevelMap = {
      off: "none",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    };
    const provider: ProviderConfig = {
      api: "openai-completions",
      baseUrl: "https://9router.example/v1",
      apiKey: "$NINE_ROUTER_API_KEY",
      models: [
        {
          id: "cx/gpt-5.6-luna",
          thinkingLevelMap,
          compat: { supportsReasoningEffort: true },
        },
      ],
    };

    const model = registrationConfig(provider).models as Array<
      Record<string, unknown>
    >;

    expect(model[0]?.thinkingLevelMap).toEqual(thinkingLevelMap);
    expect(model[0]?.compat).toEqual({ supportsReasoningEffort: true });
    expect(model[0]?.reasoning).toBe(true);
  });
  test("removes private thinking for native maps and derives reasoning from compat", () => {
    const provider: ProviderConfig = {
      api: "openai-completions",
      baseUrl: "https://9router.example/v1",
      compat: { supportsReasoningEffort: false },
      models: [
        {
          id: "cx/gpt-5.6-luna",
          thinking: { mode: "effort", efforts: ["high"] },
          reasoning: "high",
          thinkingLevelMap: {
            off: "none",
            minimal: "low",
            low: "low",
            medium: "medium",
            high: "high",
            xhigh: "max",
            max: "max",
          },
        },
      ],
    };
    const model = registrationConfig(provider).models as Array<
      Record<string, unknown>
    >;
    expect(model[0]?.thinking).toBeUndefined();
    expect(model[0]?.reasoning).toBeUndefined();
    expect(model[0]?.thinkingLevelMap).toBeDefined();
  });
  test("drops malformed native map and legacy private thinking", () => {
    const provider: ProviderConfig = {
      api: "openai-completions",
      baseUrl: "https://9router.example/v1",
      models: [
        {
          id: "cx/gpt-5.6-luna",
          thinking: { mode: "effort", efforts: ["high"] },
          thinkingLevelMap: {
            medium: "medium",
          } as unknown as ModelEntry["thinkingLevelMap"],
        },
      ],
    };
    const model = registrationConfig(provider).models as Array<
      Record<string, unknown>
    >;
    expect(model[0]?.thinkingLevelMap).toBeUndefined();
    expect(model[0]?.thinking).toBeUndefined();
  });

  test("does not inherit provider reasoning support for mapped model", () => {
    const provider: ProviderConfig = {
      api: "openai-completions",
      baseUrl: "https://9router.example/v1",
      compat: { supportsReasoningEffort: true, supportsDeveloperRole: false },
      models: [
        {
          id: "cx/gpt-5.6-luna",
          thinkingLevelMap: {
            off: "none",
            minimal: "low",
            low: "low",
            medium: "medium",
            high: "high",
            xhigh: "max",
            max: "max",
          },
        },
      ],
    };
    const model = registrationConfig(provider).models as Array<
      Record<string, unknown>
    >;
    expect(model[0]?.reasoning).toBeUndefined();
    expect(model[0]?.compat).toEqual({ supportsDeveloperRole: false });
  });

  test("drops malformed pricing tiers without exposing an invalid cost shape", () => {
    const result = registrationConfig({
      ...gatewayProvider,
      models: [
        {
          id: "gateway/model",
          cost: {
            input: 1,
            tiers: [
              null,
              { inputTokensAbove: 100, output: 2 },
              { inputTokensAbove: "bad" },
            ],
          },
        },
      ],
    });
    const model = (
      result.models as unknown as Array<unknown> | undefined
    )?.[0] as Record<string, unknown>;
    const cost = model.cost as Record<string, unknown>;
    const tiers = cost.tiers as Array<Record<string, unknown>>;

    expect(cost.input).toBe(1);
    expect(cost.output).toBe(0);
    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({
      inputTokensAbove: 100,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  test("keeps slash-containing gateway ids and does not shadow builtins", () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    registerBetterCustomProviders(
      { registerProvider: (name, config) => calls.push([name, config]) },
      { providers: { "9router": gatewayProvider, openai: gatewayProvider } },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("9router");
    const registeredModels = calls[0]?.[1].models as
      | Array<Record<string, unknown>>
      | undefined;
    expect(registeredModels?.[0]?.id).toBe("Main/hf:zai-org/GLM-5.3-Flash");
  });
});
