import { describe, expect, test } from "bun:test";
import type { HostModelEntry } from "../src/model-entry.ts";
import {
  buildModelEntry,
  buildProviderConfig,
  mutateModelEntry,
  readModelOptions,
} from "../src/model-entry.ts";
import type { ProviderConfig, ThinkingLevelMap } from "../src/types.ts";

const lunaMap: ThinkingLevelMap = {
  off: "none",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
  max: "max",
};

const solAndTerraMap: ThinkingLevelMap = {
  off: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "ultra",
  max: "max",
};

function modelOf(provider: ProviderConfig): HostModelEntry {
  const model = provider.models?.[0];
  expect(model).toBeDefined();
  expect(typeof model).toBe("object");
  return model as HostModelEntry;
}

function seededModel(
  providerId: string,
  modelId: string,
  api: "openai-completions" | "openai-responses" = "openai-completions",
) {
  return modelOf(
    buildProviderConfig({
      providerId,
      api,
      baseUrl: "https://gateway.example/v1",
      apiKey: "test-key",
      modelIds: [modelId],
    }),
  );
}

describe("native thinkingLevelMap model metadata", () => {
  test("registers, reads, and mutates all seven native keys, including null", () => {
    const registeredMap = { ...lunaMap, xhigh: null };
    const provider = buildProviderConfig({
      providerId: "custom",
      api: "openai-completions",
      baseUrl: "https://gateway.example/v1",
      apiKey: "test-key",
      modelIds: ["custom-model"],
      modelOptionsById: {
        "custom-model": {
          thinkingLevelMap: registeredMap,
          compat: { supportsReasoningEffort: true },
        },
      },
    });
    const model = modelOf(provider);

    expect(model.thinkingLevelMap).toEqual(registeredMap);
    expect(model.compat).toEqual({ supportsReasoningEffort: true });
    expect(model.reasoning).toBe(true);
    expect(model.thinking).toBeUndefined();
    expect(readModelOptions(model)).toMatchObject({
      thinkingLevelMap: registeredMap,
      compat: { supportsReasoningEffort: true },
      reasoning: "max",
    });

    const mutatedMap = { ...registeredMap, minimal: null, xhigh: "max" };
    const mutated = mutateModelEntry(model, "thinkingLevelMap", mutatedMap);
    expect(mutated.thinkingLevelMap).toEqual(mutatedMap);
    expect(model.thinkingLevelMap).toEqual(registeredMap);
  });
  test("converts legacy thinking and gates reasoning from compatibility", () => {
    const legacy = {
      id: "legacy-model",
      thinking: { mode: "effort", efforts: ["low"] },
      reasoning: true,
      compat: { supportsReasoningEffort: false },
    } as HostModelEntry;
    const disabled = mutateModelEntry(legacy, "thinkingLevelMap", lunaMap);

    expect(disabled.thinkingLevelMap).toEqual(lunaMap);
    expect(disabled.thinking).toBeUndefined();
    expect(disabled.reasoning).toBeUndefined();

    const supported = mutateModelEntry(
      {
        ...legacy,
        compat: { supportsReasoningEffort: true },
      },
      "thinkingLevelMap",
      lunaMap,
    );

    expect(supported.thinkingLevelMap).toEqual(lunaMap);
    expect(supported.thinking).toBeUndefined();
    expect(supported.reasoning).toBe(true);
  });

  test("keeps native map invariant when object fields end with legacy values", () => {
    const mutated = mutateModelEntry(
      {
        id: "legacy-model",
        compat: { supportsReasoningEffort: false },
      } as HostModelEntry,
      {
        thinkingLevelMap: lunaMap,
        thinking: { mode: "effort", efforts: ["low"] },
        reasoning: false,
      },
    );

    expect(mutated.thinkingLevelMap).toEqual(lunaMap);
    expect(mutated.thinking).toBeUndefined();
    expect(mutated.reasoning).toBeUndefined();
  });

  test("enables reasoning when native map compatibility supports it", () => {
    const mutated = mutateModelEntry(
      {
        id: "legacy-model",
        compat: { supportsReasoningEffort: true },
      } as HostModelEntry,
      {
        thinkingLevelMap: lunaMap,
        thinking: { mode: "effort", efforts: ["low"] },
        reasoning: false,
      },
    );

    expect(mutated.thinkingLevelMap).toEqual(lunaMap);
    expect(mutated.thinking).toBeUndefined();
    expect(mutated.reasoning).toBe(true);
  });

  test.each([false, true])(
    "scalar reasoning and thinking mutations preserve native map when compat=%s",
    (supportsReasoningEffort) => {
      const entry = {
        id: "mapped-model",
        thinkingLevelMap: lunaMap,
        thinking: { mode: "effort", efforts: ["low"] },
        reasoning: true,
        compat: { supportsReasoningEffort },
      } as HostModelEntry;

      const reasoning = mutateModelEntry(entry, "reasoning", false);
      expect(reasoning.thinkingLevelMap).toEqual(lunaMap);
      expect(reasoning.thinking).toBeUndefined();
      expect(reasoning.reasoning).toBe(
        supportsReasoningEffort ? true : undefined,
      );

      const thinking = mutateModelEntry(entry, "thinking", {
        mode: "effort",
        efforts: ["high"],
      });
      expect(thinking.thinkingLevelMap).toEqual(lunaMap);
      expect(thinking.thinking).toBeUndefined();
      expect(thinking.reasoning).toBe(
        supportsReasoningEffort ? true : undefined,
      );
    },
  );

  test("scalar map mutation keeps invalid input as no-op and undefined removes map", () => {
    const entry = {
      id: "mapped-model",
      thinkingLevelMap: lunaMap,
      compat: { supportsReasoningEffort: true },
    } as HostModelEntry;

    const invalid = mutateModelEntry(entry, "thinkingLevelMap", { low: "low" });
    expect(invalid.thinkingLevelMap).toEqual(lunaMap);

    const removed = mutateModelEntry(entry, "thinkingLevelMap", undefined);
    expect(removed.thinkingLevelMap).toBeUndefined();
  });

  test("clones map and compatibility inputs before building an entry", () => {
    const mapInput = { ...lunaMap };
    const compatInput: Record<string, unknown> = {
      supportsReasoningEffort: true,
      source: "fixture",
    };
    const entry = buildModelEntry("custom-model", {
      thinkingLevelMap: mapInput,
      compat: compatInput,
    });

    mapInput.minimal = null;
    compatInput.supportsReasoningEffort = false;
    compatInput.source = "mutated-fixture";

    expect(entry.thinkingLevelMap).toEqual(lunaMap);
    expect(entry.compat).toEqual({
      supportsReasoningEffort: true,
      source: "fixture",
    });
  });
});

describe("9router CX GPT-5.6 compatibility seeds", () => {
  test("seeds Luna with its exact native map, model compatibility, and reasoning", () => {
    const model = seededModel("9router", "cx/gpt-5.6-luna");

    expect(model.thinkingLevelMap).toEqual(lunaMap);
    expect(model.compat).toEqual({ supportsReasoningEffort: true });
    expect(model.reasoning).toBe(true);
    expect(model.thinking).toBeUndefined();
  });
  test("does not seed Luna profile for openai-responses", () => {
    const model = seededModel("9router", "cx/gpt-5.6-luna", "openai-responses");

    expect(model.thinkingLevelMap).toBeUndefined();
    expect(model.compat?.supportsReasoningEffort).toBeUndefined();
  });

  for (const [modelId, expectedMap] of [
    ["cx/gpt-5.6-sol", solAndTerraMap],
    ["cx/gpt-5.6-terra", solAndTerraMap],
  ] as const) {
    test(`seeds ${modelId} with its exact native map, model compatibility, and reasoning`, () => {
      const model = seededModel("9router", modelId);

      expect(model.thinkingLevelMap).toEqual(expectedMap);
      expect(model.compat).toEqual({ supportsReasoningEffort: true });
      expect(model.reasoning).toBe(true);
      expect(model.thinking).toBeUndefined();
    });
  }

  for (const [providerId, modelId, label] of [
    ["other-provider", "cx/gpt-5.6-luna", "other provider"],
    ["9router", "cx/gpt-5.6-lun", "nearby model"],
    ["9router", "cx/gpt-5.6-luna-preview", "suffix model"],
  ] as const) {
    test(`does not seed ${label}`, () => {
      const model = seededModel(providerId, modelId);

      expect(model.thinkingLevelMap).toBeUndefined();
      expect(model.compat).toBeUndefined();
    });
  }
});

describe("9router compatibility precedence", () => {
  test("keeps observed map and compatibility intact over profile data", () => {
    const observedMap: ThinkingLevelMap = {
      off: "observed-none",
      minimal: "observed-minimal",
      low: "observed-low",
      medium: "observed-medium",
      high: null,
      xhigh: "observed-xhigh",
      max: "observed-max",
    };
    const observedCompat = {
      supportsReasoningEffort: false,
      source: "observed",
    };
    const model = modelOf(
      buildProviderConfig({
        providerId: "9router",
        api: "openai-completions",
        baseUrl: "https://gateway.example/v1",
        apiKey: "test-key",
        modelIds: ["cx/gpt-5.6-luna"],
        infoById: {
          "cx/gpt-5.6-luna": {
            thinkingLevelMap: observedMap,
            compat: observedCompat,
          },
        },
      }),
    );

    expect(model.thinkingLevelMap).toEqual(observedMap);
    expect(model.compat).toEqual(observedCompat);
  });

  test("keeps persisted map and compatibility intact over profile data", () => {
    const persistedMap: ThinkingLevelMap = {
      off: null,
      minimal: "persisted-minimal",
      low: "persisted-low",
      medium: "persisted-medium",
      high: "persisted-high",
      xhigh: "persisted-xhigh",
      max: "persisted-max",
    };
    const persistedCompat = {
      supportsReasoningEffort: false,
      source: "persisted",
    };
    const model = modelOf(
      buildProviderConfig({
        providerId: "9router",
        api: "openai-completions",
        baseUrl: "https://gateway.example/v1",
        apiKey: "test-key",
        modelIds: ["cx/gpt-5.6-luna"],
        modelOptionsById: {
          "cx/gpt-5.6-luna": {
            thinkingLevelMap: persistedMap,
            compat: persistedCompat,
          },
        },
      }),
    );

    expect(model.thinkingLevelMap).toEqual(persistedMap);
    expect(model.compat).toEqual(persistedCompat);
  });

  test("does not fill observed map-only metadata with profile compatibility", () => {
    const observedMap = { ...lunaMap, high: null };
    const model = modelOf(
      buildProviderConfig({
        providerId: "9router",
        api: "openai-completions",
        baseUrl: "https://gateway.example/v1",
        apiKey: "test-key",
        modelIds: ["cx/gpt-5.6-luna"],
        infoById: {
          "cx/gpt-5.6-luna": { thinkingLevelMap: observedMap },
        },
      }),
    );

    expect(model.thinkingLevelMap).toEqual(observedMap);
    expect(model.compat).toBeUndefined();
  });

  test("does not fill observed compatibility-only metadata with profile map", () => {
    const observedCompat = {
      supportsReasoningEffort: false,
      source: "observed",
    };
    const model = modelOf(
      buildProviderConfig({
        providerId: "9router",
        api: "openai-completions",
        baseUrl: "https://gateway.example/v1",
        apiKey: "test-key",
        modelIds: ["cx/gpt-5.6-luna"],
        infoById: {
          "cx/gpt-5.6-luna": { compat: observedCompat },
        },
      }),
    );

    expect(model.thinkingLevelMap).toBeUndefined();
    expect(model.compat).toEqual(observedCompat);
  });

  test("does not fill persisted map-only metadata with profile compatibility", () => {
    const persistedMap = { ...lunaMap, high: null };
    const model = modelOf(
      buildProviderConfig({
        providerId: "9router",
        api: "openai-completions",
        baseUrl: "https://gateway.example/v1",
        apiKey: "test-key",
        modelIds: ["cx/gpt-5.6-luna"],
        modelOptionsById: {
          "cx/gpt-5.6-luna": { thinkingLevelMap: persistedMap },
        },
      }),
    );

    expect(model.thinkingLevelMap).toEqual(persistedMap);
    expect(model.compat).toBeUndefined();
  });

  test("does not fill persisted compatibility-only metadata with profile map", () => {
    const persistedCompat = {
      supportsReasoningEffort: false,
      source: "persisted",
    };
    const model = modelOf(
      buildProviderConfig({
        providerId: "9router",
        api: "openai-completions",
        baseUrl: "https://gateway.example/v1",
        apiKey: "test-key",
        modelIds: ["cx/gpt-5.6-luna"],
        modelOptionsById: {
          "cx/gpt-5.6-luna": { compat: persistedCompat },
        },
      }),
    );

    expect(model.thinkingLevelMap).toBeUndefined();
    expect(model.compat).toEqual(persistedCompat);
  });
});
