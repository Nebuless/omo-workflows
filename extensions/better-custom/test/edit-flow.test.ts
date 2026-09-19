import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadModelsConfig, saveModelsConfig } from "../src/config.ts";
import { editProviderFlow } from "../src/flows/edit.ts";
import {
  type ProviderRegistrar,
  setProviderRegistrar,
} from "../src/model-browser.ts";
import type { GatewayProbeResult } from "../src/probe/types.ts";
import type { CommandContext, ModelEntry, ModelsConfig } from "../src/types.ts";

type Choice = {
  title: string;
  value?: string;
  many?: boolean;
  cancel?: boolean;
};

type FakeUiOptions = {
  choices: Choice[];
  nativeChoices?: Record<string, string[]>;
  inputs?: Array<string | undefined>;
};

function context(options: FakeUiOptions): CommandContext {
  const choices = [...options.choices];
  const inputs = [...(options.inputs ?? [])];
  const nativeChoices = new Map(
    Object.entries(options.nativeChoices ?? {}).map(([title, values]) => [
      title,
      [...values],
    ]),
  );
  return {
    ui: {
      custom: async <T>(): Promise<T> => {
        const choice = choices.shift();
        if (!choice) return null as T;
        if (choice.cancel) return null as T;
        return (choice.many ? [choice.value] : choice.value) as T;
      },
      input: async () => inputs.shift(),
      select: async (title: string) => nativeChoices.get(title)?.shift(),
      confirm: async () => false,
      notify: () => {},
    },
    mode: "text",
    hasUI: true,
  };
}

function tempConfig(config: ModelsConfig): {
  path: string;
  cleanup: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), "better-custom-edit-flow-"));
  const path = join(directory, "models.json");
  saveModelsConfig(config, path);
  return {
    path,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function registrarState() {
  const registered = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const registrar: ProviderRegistrar = {
    registerProvider(name, config) {
      calls.push(name);
      registered.set(name, config);
    },
    unregisterProvider(name) {
      registered.delete(name);
    },
  };
  return { registered, calls, registrar };
}

function baseConfig(providerId: string, model: ModelEntry): ModelsConfig {
  return {
    unknownTopLevel: { retained: true },
    providers: {
      [providerId]: {
        api: "openai-completions",
        baseUrl: "https://gateway.example/v1",
        apiKey: "gateway-key",
        providerUnknown: ["retained"],
        models: [model],
      },
    },
  };
}

const modelId = "cx/gpt-5.6-luna";

function modelWithMetadata(): ModelEntry {
  return {
    id: modelId,
    modelUnknown: { retained: true },
    compat: { supportsReasoningEffort: true, customCompat: "retained" },
  };
}

describe("public editProviderFlow persistence", () => {
  test("saves and registers complete native map, disabled null, compat, and unknown fields", async () => {
    const providerId = "flow-map-provider";
    const target = tempConfig(baseConfig(providerId, modelWithMetadata()));
    const state = registrarState();
    setProviderRegistrar(state.registrar);
    try {
      const result = await editProviderFlow(
        context({
          choices: [
            { title: "Edit provider", value: providerId },
            { title: "Edit " + providerId, value: "models" },
            { title: "Edit model in " + providerId, value: modelId },
            { title: "Edit " + modelId, value: "thinking-map" },
            { title: "Edit " + modelId, value: "back" },
            { title: "Edit " + providerId, value: "back" },
            { title: "Edit provider", cancel: true },
          ],
          inputs: ["none", "-", "low", "medium", "high", "xhigh", "max"],
        }),
        { configTarget: target.path },
      );

      expect(result).toBe(true);
      const saved = loadModelsConfig(target.path);
      const savedModel = saved.providers?.[providerId]?.models?.[0];
      expect(savedModel).toMatchObject({
        id: modelId,
        thinkingLevelMap: {
          off: "none",
          minimal: null,
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: "xhigh",
          max: "max",
        },
        compat: { supportsReasoningEffort: true, customCompat: "retained" },
        modelUnknown: { retained: true },
      });
      expect(saved.unknownTopLevel).toEqual({ retained: true });
      expect(saved.providers?.[providerId]?.providerUnknown).toEqual([
        "retained",
      ]);
      const registered = state.registered.get(providerId);
      expect(registered).toBeDefined();
      const registeredModel = (
        registered?.models as Array<Record<string, unknown>>
      )?.[0];
      expect(registeredModel).toBeDefined();
      expect(registeredModel).toMatchObject({
        id: modelId,
        thinkingLevelMap: {
          off: "none",
          minimal: null,
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: "xhigh",
          max: "max",
        },
        compat: { supportsReasoningEffort: true, customCompat: "retained" },
        modelUnknown: { retained: true },
      });
      expect(state.calls).toEqual([providerId]);
    } finally {
      setProviderRegistrar(undefined);
      target.cleanup();
    }
  });

  test("cancellation leaves config byte-identical and does not register", async () => {
    const providerId = "flow-cancel-provider";
    const target = tempConfig(baseConfig(providerId, modelWithMetadata()));
    const before = readFileSync(target.path, "utf8");
    const state = registrarState();
    setProviderRegistrar(state.registrar);
    try {
      expect(
        await editProviderFlow(
          context({ choices: [{ title: "Edit provider", cancel: true }] }),
          { configTarget: target.path },
        ),
      ).toBe(false);
      expect(readFileSync(target.path, "utf8")).toBe(before);
      expect(state.calls).toEqual([]);
      expect(state.registered.size).toBe(0);
    } finally {
      setProviderRegistrar(undefined);
      target.cleanup();
    }
  });

  test("map cancellation leaves config byte-identical and does not register", async () => {
    const providerId = "flow-map-cancel-provider";
    const target = tempConfig(baseConfig(providerId, modelWithMetadata()));
    const before = readFileSync(target.path, "utf8");
    const state = registrarState();
    setProviderRegistrar(state.registrar);
    try {
      expect(
        await editProviderFlow(
          context({
            choices: [
              { title: "Edit provider", value: providerId },
              { title: "Edit " + providerId, value: "models" },
              { title: "Edit model in " + providerId, value: modelId },
              { title: "Edit " + modelId, value: "thinking-map" },
              { title: "Edit " + modelId, value: "back" },
              { title: "Edit " + providerId, value: "back" },
              { title: "Edit provider", cancel: true },
            ],
            inputs: [undefined],
          }),
          { configTarget: target.path },
        ),
      ).toBe(false);
      expect(readFileSync(target.path, "utf8")).toBe(before);
      expect(state.calls).toEqual([]);
      expect(state.registered.size).toBe(0);
    } finally {
      setProviderRegistrar(undefined);
      target.cleanup();
    }
  });

  test("invalid native map leaves config byte-identical and does not register", async () => {
    const providerId = "flow-invalid-provider";
    const target = tempConfig(baseConfig(providerId, modelWithMetadata()));
    const before = readFileSync(target.path, "utf8");
    const state = registrarState();
    setProviderRegistrar(state.registrar);
    try {
      await editProviderFlow(
        context({
          choices: [
            { title: "Edit provider", value: providerId },
            { title: "Edit " + providerId, value: "models" },
            { title: "Edit model in " + providerId, value: modelId },
            { title: "Edit " + modelId, value: "thinking-map" },
            { title: "Edit " + modelId, value: "back" },
            { title: "Edit " + providerId, value: "back" },
            { title: "Edit provider", cancel: true },
          ],
          inputs: [" "],
        }),
        { configTarget: target.path },
      );
      expect(readFileSync(target.path, "utf8")).toBe(before);
      expect(state.calls).toEqual([]);
      expect(state.registered.size).toBe(0);
    } finally {
      setProviderRegistrar(undefined);
      target.cleanup();
    }
  });

  test("mapped-model reasoning ceiling selection does not write or register", async () => {
    const providerId = "flow-ceiling-provider";
    const map = {
      off: "none",
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "max",
      max: "max",
    };
    const target = tempConfig(
      baseConfig(providerId, { ...modelWithMetadata(), thinkingLevelMap: map }),
    );
    const before = readFileSync(target.path, "utf8");
    const state = registrarState();
    setProviderRegistrar(state.registrar);
    try {
      await editProviderFlow(
        context({
          choices: [
            { title: "Edit provider", value: providerId },
            { title: "Edit " + providerId, value: "models" },
            { title: "Edit model in " + providerId, value: modelId },
            { title: "Edit " + modelId, value: "reasoning" },
            { title: "Edit " + modelId, value: "back" },
            { title: "Edit " + providerId, value: "back" },
            { title: "Edit provider", cancel: true },
          ],
          nativeChoices: { Reasoning: ["high - cap reasoning at high"] },
        }),
        { configTarget: target.path },
      );
      expect(readFileSync(target.path, "utf8")).toBe(before);
      expect(state.calls).toEqual([]);
      expect(state.registered.size).toBe(0);
    } finally {
      setProviderRegistrar(undefined);
      target.cleanup();
    }
  });

  test("refresh preserves stored map and compat when probe returns competing metadata", async () => {
    const providerId = "flow-refresh-provider";
    const storedMap = {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "max",
      max: "max",
    };
    const target = tempConfig(
      baseConfig(providerId, {
        ...modelWithMetadata(),
        thinkingLevelMap: storedMap,
        contextWindow: 1234,
      }),
    );
    const state = registrarState();
    setProviderRegistrar(state.registrar);
    const probe: GatewayProbeResult = {
      baseUrl: "https://gateway.example/v1",
      ids: [modelId],
      metadataById: new Map([
        [
          modelId,
          {
            id: modelId,
            contextWindow: 9999,
            thinkingLevelMap: {
              off: "probe-none",
              minimal: "probe-minimal",
              low: "probe-low",
              medium: "probe-medium",
              high: "probe-high",
              xhigh: "probe-xhigh",
              max: "probe-max",
            },
            compat: { supportsReasoningEffort: false },
          },
        ],
      ]),
      infoById: new Map(),
    };
    try {
      await editProviderFlow(
        context({
          choices: [
            { title: "Edit provider", value: providerId },
            { title: "Edit " + providerId, value: "refresh" },
            { title: "Models", value: "auto" },
            { title: "Select models", value: modelId, many: true },
            { title: "Edit " + providerId, value: "back" },
            { title: "Edit provider", cancel: true },
          ],
          nativeChoices: { "Gateway type": ["Auto"] },
        }),
        { configTarget: target.path, probeGateway: async () => probe },
      );
      const savedModel = loadModelsConfig(target.path).providers?.[providerId]
        ?.models?.[0] as Record<string, unknown>;
      expect(savedModel).toMatchObject({
        id: modelId,
        contextWindow: 9999,
        thinkingLevelMap: storedMap,
        compat: { supportsReasoningEffort: true, customCompat: "retained" },
        modelUnknown: { retained: true },
      });
      expect(loadModelsConfig(target.path).unknownTopLevel).toEqual({
        retained: true,
      });
      expect(state.registered.get(providerId)?.models).toBeDefined();
      expect(state.calls).toEqual([providerId]);
    } finally {
      setProviderRegistrar(undefined);
      target.cleanup();
    }
  });
  test("refresh seeds eligible stored string model", async () => {
    const providerId = "flow-string-refresh-provider";
    const target = tempConfig({
      unknownTopLevel: { retained: true },
      providers: {
        [providerId]: {
          api: "openai-completions",
          baseUrl: "https://gateway.example/v1",
          apiKey: "gateway-key",
          models: [modelId],
        },
      },
    });
    const state = registrarState();
    setProviderRegistrar(state.registrar);
    const map = {
      off: "none",
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "max",
      max: "max",
    };
    const probe: GatewayProbeResult = {
      baseUrl: "https://gateway.example/v1",
      ids: [modelId],
      metadataById: new Map(),
      infoById: new Map([
        [
          modelId,
          {
            id: modelId,
            contextWindow: 9999,
            thinkingLevelMap: map,
            compat: { supportsReasoningEffort: true },
          },
        ],
      ]),
    };
    try {
      await editProviderFlow(
        context({
          choices: [
            { title: "Edit provider", value: providerId },
            { title: "Edit " + providerId, value: "refresh" },
            { title: "Models", value: "auto" },
            { title: "Select models", value: modelId, many: true },
            { title: "Edit " + providerId, value: "back" },
            { title: "Edit provider", cancel: true },
          ],
          nativeChoices: { "Gateway type": ["Auto"] },
        }),
        { configTarget: target.path, probeGateway: async () => probe },
      );
      const saved = loadModelsConfig(target.path);
      expect(saved.providers?.[providerId]?.models?.[0]).toMatchObject({
        id: modelId,
        contextWindow: 9999,
        thinkingLevelMap: map,
        compat: { supportsReasoningEffort: true },
        reasoning: true,
      });
      expect(saved.unknownTopLevel).toEqual({ retained: true });
    } finally {
      setProviderRegistrar(undefined);
      target.cleanup();
    }
  });
  test("refresh applies static Luna profile without info metadata", async () => {
    const providerId = "9router";
    const target = tempConfig({
      unknownTopLevel: { retained: true },
      providers: {
        [providerId]: {
          api: "openai-completions",
          baseUrl: "https://gateway.example/v1",
          apiKey: "gateway-key",
          models: [modelId],
        },
      },
    });
    const state = registrarState();
    setProviderRegistrar(state.registrar);
    const probe: GatewayProbeResult = {
      baseUrl: "https://gateway.example/v1",
      ids: [modelId],
      metadataById: new Map(),
      infoById: new Map(),
    };
    try {
      await editProviderFlow(
        context({
          choices: [
            { title: "Edit provider", value: providerId },
            { title: "Edit " + providerId, value: "refresh" },
            { title: "Models", value: "auto" },
            { title: "Select models", value: modelId, many: true },
            { title: "Edit " + providerId, value: "back" },
            { title: "Edit provider", cancel: true },
          ],
          nativeChoices: { "Gateway type": ["Auto"] },
        }),
        { configTarget: target.path, probeGateway: async () => probe },
      );
      const savedModel = loadModelsConfig(target.path).providers?.[providerId]
        ?.models?.[0] as ModelEntry | undefined;
      expect(savedModel).toMatchObject({
        id: modelId,
        thinkingLevelMap: {
          off: "none",
          minimal: "low",
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: "max",
          max: "max",
        },
        compat: { supportsReasoningEffort: true },
        reasoning: true,
      });
      expect(savedModel?.thinkingLevelMap).toEqual({
        off: "none",
        minimal: "low",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "max",
        max: "max",
      });
      expect(savedModel?.compat).toEqual({ supportsReasoningEffort: true });
      expect((savedModel as Record<string, unknown>).reasoning).toBe(true);
      expect(loadModelsConfig(target.path).unknownTopLevel).toEqual({
        retained: true,
      });
    } finally {
      setProviderRegistrar(undefined);
      target.cleanup();
    }
  });

  test("refresh removes legacy thinking after native map cutover", async () => {
    const providerId = "flow-legacy-refresh-provider";
    const target = tempConfig(
      baseConfig(providerId, {
        id: modelId,
        thinking: { mode: "effort", efforts: ["high"] },
        reasoning: "high",
        compat: { supportsReasoningEffort: true },
      }),
    );
    const state = registrarState();
    setProviderRegistrar(state.registrar);
    const map = {
      off: "none",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    };
    const probe: GatewayProbeResult = {
      baseUrl: "https://gateway.example/v1",
      ids: [modelId],
      metadataById: new Map(),
      infoById: new Map([
        [
          modelId,
          {
            id: modelId,
            thinkingLevelMap: map,
            compat: { supportsReasoningEffort: false },
          },
        ],
      ]),
    };
    try {
      await editProviderFlow(
        context({
          choices: [
            { title: "Edit provider", value: providerId },
            { title: "Edit " + providerId, value: "refresh" },
            { title: "Models", value: "auto" },
            { title: "Select models", value: modelId, many: true },
            { title: "Edit " + providerId, value: "back" },
            { title: "Edit provider", cancel: true },
          ],
          nativeChoices: { "Gateway type": ["Auto"] },
        }),
        { configTarget: target.path, probeGateway: async () => probe },
      );
      const savedModel = loadModelsConfig(target.path).providers?.[providerId]
        ?.models?.[0] as Record<string, unknown>;
      expect(savedModel.thinking).toBeUndefined();
      expect(savedModel.reasoning).toBe(true);
    } finally {
      setProviderRegistrar(undefined);
      target.cleanup();
    }
  });
});
