import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@code-yeongyu/senpi";

describe("OMO extension boundary", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "omo-workflows-agent-"));
  const previousSenpiDir = process.env.SENPI_CODING_AGENT_DIR;
  const previousOmoDir = process.env.OMO_CODING_AGENT_DIR;
  let providerExtension: typeof import("../extensions/better-custom/src/index.ts");
  let compoundExtension: typeof import("../extensions/compound-engineering/src/index.ts");
  let herdrExtension: typeof import("../extensions/herdr/index.ts");
  let advisorExtension: typeof import("../extensions/model-routing-advisor/index.ts");
  beforeAll(async () => {
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify({ providers: {} }),
    );
    process.env.SENPI_CODING_AGENT_DIR = agentDir;
    process.env.OMO_CODING_AGENT_DIR = agentDir;
    [providerExtension, compoundExtension, herdrExtension, advisorExtension] =
      await Promise.all([
        import("../extensions/better-custom/src/index.ts"),
        import("../extensions/compound-engineering/src/index.ts"),
        import("../extensions/herdr/index.ts"),
        import("../extensions/model-routing-advisor/index.ts"),
      ]);
  }, 30000);
  afterAll(() => {
    if (previousSenpiDir === undefined)
      delete process.env.SENPI_CODING_AGENT_DIR;
    else process.env.SENPI_CODING_AGENT_DIR = previousSenpiDir;
    if (previousOmoDir === undefined) delete process.env.OMO_CODING_AGENT_DIR;
    else process.env.OMO_CODING_AGENT_DIR = previousOmoDir;
    rmSync(agentDir, { recursive: true, force: true });
  });
  test("discovers configured provider limits automatically at session start without saving them", async () => {
    const config = JSON.stringify({
      providers: {
        gateway: {
          api: "openai-responses",
          baseUrl: "https://gateway.example/v1",
          apiKey: "$GATEWAY_KEY",
          models: [
            { id: "codex", contextWindow: 128_000, custom: "preserved" },
            "manual",
            {
              id: "other-endpoint",
              baseUrl: "https://other.example/v1",
              contextWindow: 64_000,
            },
          ],
        },
      },
    });
    writeFileSync(join(agentDir, "models.json"), config);
    const handlers = new Map<
      string,
      (event: unknown, ctx: unknown) => unknown
    >();
    const providers = new Map<
      string,
      { models: Array<Record<string, unknown>> }
    >();
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push(url);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer resolved-key",
      );
      expect(new Headers(init?.headers).get("x-gateway")).toBe(
        "resolved-header",
      );
      if (url.endsWith("?client_version=cpa")) {
        return Response.json({
          models: [
            { slug: "codex", context_window: 500_000, max_tokens: 128_000 },
          ],
        });
      }
      if (url.endsWith("/models")) {
        return Response.json({
          data: [
            { id: "codex" },
            { id: "unselected" },
            { id: "other-endpoint" },
          ],
        });
      }
      throw new Error("Unexpected startup request");
    }) as typeof fetch;
    try {
      providerExtension.default({
        on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
          handlers.set(name, handler);
        },
        registerCommand() {},
        registerProvider(
          name: string,
          value: { models: Array<Record<string, unknown>> },
        ) {
          providers.set(name, value);
        },
        unregisterProvider() {},
        setModel: async () => {
          throw new Error("Metadata refresh must not switch models");
        },
      } as never);
      expect(requests).toEqual([]);
      expect(handlers.has("session_start")).toBe(true);
      const ctx = {
        modelRegistry: {
          find(provider: string, id: string) {
            return providers
              .get(provider)
              ?.models.find((model) => model.id === id);
          },
          getApiKeyAndHeaders: async () => ({
            ok: true,
            apiKey: "resolved-key",
            headers: { "x-gateway": "resolved-header" },
          }),
        },
      };
      await handlers.get("session_start")?.({ type: "session_start" }, ctx);
      const models = providers.get("gateway")?.models;
      expect(models?.map((model) => model.id)).toEqual([
        "codex",
        "manual",
        "other-endpoint",
      ]);
      expect(models?.[0]).toMatchObject({
        contextWindow: 500_000,
        maxTokens: 128_000,
        custom: "preserved",
      });
      expect(models?.[1]?.contextWindow).toBe(128_000);
      expect(models?.[2]?.contextWindow).toBe(64_000);
      expect(await Bun.file(join(agentDir, "models.json")).text()).toBe(config);
      expect(requests).toHaveLength(2);
      globalThis.fetch = Object.assign(
        async () => new Response(null, { status: 503 }),
        { preconnect: originalFetch.preconnect },
      );
      await handlers.get("session_start")?.({ type: "session_start" }, ctx);
      expect(providers.get("gateway")?.models[0]?.contextWindow).toBe(500_000);
    } finally {
      globalThis.fetch = originalFetch;
      writeFileSync(
        join(agentDir, "models.json"),
        JSON.stringify({ providers: {} }),
      );
    }
  });

  test("native session startup refreshes the selected model without inference", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const url = new URL(request.url);
        requests.push(url.pathname + url.search);
        expect(request.headers.get("authorization")).toBe(
          "Bearer native-fixture",
        );
        if (url.pathname !== "/v1/models")
          return new Response(null, { status: 404 });
        return url.search
          ? Response.json({
              models: ["codex", "overridden"].map((slug) => ({
                slug,
                context_window: 500_000,
                max_tokens: 128_000,
              })),
            })
          : Response.json({ data: [{ id: "codex" }, { id: "overridden" }] });
      },
    });
    const config = JSON.stringify({
      providers: {
        "gateway-native": {
          api: "openai-responses",
          apiKey: "native-fixture",
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          models: [
            { id: "codex", contextWindow: 128_000, maxTokens: 16_384 },
            { id: "overridden" },
          ],
          modelOverrides: {
            overridden: { contextWindow: 64_000, maxTokens: 1_024 },
          },
        },
      },
    });
    writeFileSync(join(agentDir, "models.json"), config);
    let session:
      | Awaited<ReturnType<typeof createAgentSession>>["session"]
      | undefined;
    const settings = SettingsManager.inMemory({ enabledBuiltinExtensions: [] });
    try {
      const registry = new ModelRegistry(
        await ModelRuntime.create({
          agentDir,
          modelsPath: join(agentDir, "models.json"),
          refreshOnCreate: false,
        }),
      );
      const loader = new DefaultResourceLoader({
        cwd: agentDir,
        agentDir,
        settingsManager: settings,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: "Metadata fixture.",
        extensionFactories: [providerExtension.default],
      });
      await loader.reload();
      const model = registry.find("gateway-native", "codex");
      if (!model) throw new Error("Fixture model was not loaded");
      expect(model.contextWindow).toBe(128_000);
      ({ session } = await createAgentSession({
        cwd: agentDir,
        agentDir,
        settingsManager: settings,
        modelRegistry: registry,
        model,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(agentDir),
        tools: [],
        autoTitleSessions: false,
      }));
      await session.bindExtensions({});
      expect(session.model?.contextWindow).toBe(500_000);
      expect(session.model?.maxTokens).toBe(128_000);
      expect(registry.find("gateway-native", "codex")?.contextWindow).toBe(
        500_000,
      );
      expect(registry.find("gateway-native", "overridden")).toMatchObject({
        contextWindow: 64_000,
        maxTokens: 1_024,
      });
      expect(requests).toEqual(["/v1/models", "/v1/models?client_version=cpa"]);
      expect(await Bun.file(join(agentDir, "models.json")).text()).toBe(config);
    } finally {
      session?.dispose();
      await server.stop(true);
      writeFileSync(
        join(agentDir, "models.json"),
        JSON.stringify({ providers: {} }),
      );
    }
  });

  test("loads through Senpi's public ExtensionAPI contract", async () => {
    const commands = new Map<string, unknown>();
    const providers = new Map<string, unknown>();
    const providerHost = {
      on() {},
      registerCommand(name: string, definition: unknown) {
        commands.set(name, definition);
      },
      registerProvider(name: string, definition: unknown) {
        providers.set(name, definition);
      },
      unregisterProvider(name: string) {
        providers.delete(name);
      },
      setModel: async () => true,
    };

    providerExtension.default(providerHost as never);

    expect(commands.has("better-models")).toBe(true);
    expect(commands.has("custom-provider")).toBe(true);
    expect(providers.size).toBe(0);

    let compoundDiscover:
      | ((event: unknown, ctx: unknown) => { readonly skillPaths?: string[] })
      | undefined;
    const compoundHost = {
      on(name: string, handler: typeof compoundDiscover) {
        if (name === "resources_discover") compoundDiscover = handler;
      },
    };
    compoundExtension.default(compoundHost as never);

    expect(
      (
        await compoundDiscover?.(
          {
            type: "resources_discover",
            cwd: "/workspace",
            reason: "startup",
            scopedEntries: true,
          },
          {
            loadedExtensionPaths: [
              "/packages/compound-engineering/src/index.ts",
            ],
          },
        )
      )?.skillPaths,
    ).toEqual(["/packages/compound-engineering/skills"]);

    const events = new Map<string, unknown>();
    const tools = new Map<string, unknown>();
    let herdrDiscover: ((event: unknown, ctx: unknown) => unknown) | undefined;
    const herdrHost = {
      on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
        events.set(name, handler);
        if (name === "resources_discover") herdrDiscover = handler;
      },
      registerTool(definition: { name: string }) {
        tools.set(definition.name, definition);
      },
    };
    herdrExtension.default(herdrHost as never);

    expect(events.has("session_start")).toBe(true);
    expect(events.has("resources_discover")).toBe(true);
    expect(
      herdrDiscover?.(
        {
          type: "resources_discover",
          cwd: "/workspace",
          reason: "startup",
          scopedEntries: true,
        },
        { loadedExtensionPaths: ["/packages/herdr/index.ts"] },
      ),
    ).toEqual({
      skillPaths: [
        "/packages/herdr/skills/herdr/SKILL.md",
        "/packages/herdr/skills/herdr-agent-management/SKILL.md",
        "/packages/herdr/skills/herdr-handoff/SKILL.md",
        "/packages/herdr/skills/herdr-orchestration/SKILL.md",
        "/packages/herdr/skills/herdr-admin/SKILL.md",
      ],
    });
    expect([...tools.keys()]).toEqual([
      "herdr_desktop",
      "herdr_inspect",
      "herdr_capabilities",
      "herdr_query",
      "herdr_operation",
      "herdr_approval",
      "herdr_preview",
    ]);

    const advisorTools = new Map<string, unknown>();
    advisorExtension.default({
      registerTool(definition: { name: string }) {
        advisorTools.set(definition.name, definition);
      },
    } as never);
    expect([...advisorTools.keys()]).toEqual(["model_route_advice"]);

    expect(rootPackage.dependencies).toEqual({
      "@code-yeongyu/senpi": "2026.11.2-3",
    });
    expect(rootPackage.peerDependencies).toEqual({
      "@earendil-works/pi-ai": "*",
      "@earendil-works/pi-tui": "*",
      typebox: "*",
    });
  });
});
