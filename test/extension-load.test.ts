import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import rootPackage from "../package.json" with { type: "json" };

describe("OMO extension boundary", () => {
  test("loads through Senpi's public ExtensionAPI contract", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "omo-workflows-agent-"));
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify({ providers: {} }),
    );
    process.env.SENPI_CODING_AGENT_DIR = agentDir;
    process.env.OMO_CODING_AGENT_DIR = agentDir;

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

    const providerExtension = await import(
      "../extensions/better-custom/src/index.ts"
    );
    providerExtension.default(providerHost as never);

    expect(commands.has("better-models")).toBe(true);
    expect(commands.has("custom-provider")).toBe(true);
    expect(providers.size).toBe(0);

    let compoundDiscover:
      | (() => { readonly skillPaths: readonly string[] })
      | undefined;
    const compoundHost = {
      on(name: string, handler: typeof compoundDiscover) {
        if (name === "resources_discover") compoundDiscover = handler;
      },
    };
    const compoundExtension = await import(
      "../extensions/compound-engineering/src/index.ts"
    );
    compoundExtension.default(compoundHost as never);

    expect((await compoundDiscover?.())?.skillPaths).toHaveLength(1);

    const events = new Map<string, unknown>();
    const tools = new Map<string, unknown>();
    const herdrHost = {
      on(name: string, handler: unknown) {
        events.set(name, handler);
      },
      registerTool(definition: { name: string }) {
        tools.set(definition.name, definition);
      },
    };
    const herdrExtension = await import("../extensions/herdr/index.ts");
    herdrExtension.default(herdrHost as never);

    expect(events.has("session_start")).toBe(true);
    expect(events.has("resources_discover")).toBe(true);
    expect(tools.has("herdr_inspect")).toBe(true);
    expect(tools.has("herdr_control")).toBe(true);

    const advisorTools = new Map<string, unknown>();
    const advisorExtension = await import(
      "../extensions/model-routing-advisor/index.ts"
    );
    advisorExtension.default({
      registerTool(definition: { name: string }) {
        advisorTools.set(definition.name, definition);
      },
    } as never);
    expect([...advisorTools.keys()]).toEqual(["model_route_advice"]);

    expect(rootPackage.dependencies).toEqual({
      "@code-yeongyu/senpi": "2026.9.13",
      "@earendil-works/pi-ai": "npm:@code-yeongyu/senpi-ai@2026.9.13",
      "@earendil-works/pi-tui": "npm:@code-yeongyu/senpi-tui@2026.9.13",
      typebox: "1.3.18",
    });
  });
});
