import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

    const graphEvents = new Map<string, (data: unknown) => void>();
    const graphCommands = new Map<string, unknown>();
    const graphTools = new Map<string, unknown>();
    const graphLifecycle = new Map<string, () => Promise<void> | void>();
    const graphHost = {
      registerTool(definition: { name: string }) {
        graphTools.set(definition.name, definition);
      },
      events: {
        on(channel: string, handler: (data: unknown) => void) {
          graphEvents.set(channel, handler);
          return () => graphEvents.delete(channel);
        },
      },
      registerCommand(name: string, definition: unknown) {
        graphCommands.set(name, definition);
      },
      on(name: string, handler: () => Promise<void> | void) {
        graphLifecycle.set(name, handler);
      },
    };
    const graphExtension = await import(
      "../extensions/workflow-graph/src/index.ts"
    );
    graphExtension.default(graphHost as never);
    try {
      expect(graphEvents.has("senpi:extension-rpc-event")).toBe(true);
      expect(graphCommands.has("workflow-graph")).toBe(true);
      expect(graphCommands.has("workflow-run")).toBe(true);
      expect(graphTools.has("workflow_program")).toBe(true);
      expect(graphCommands.has("workflow-graph-pane")).toBe(true);
      expect(graphLifecycle.has("session_start")).toBe(true);
      expect(graphLifecycle.has("session_before_switch")).toBe(true);
      expect(graphLifecycle.has("session_before_fork")).toBe(true);
      expect(graphLifecycle.has("session_shutdown")).toBe(true);
    } finally {
      await graphLifecycle.get("session_shutdown")?.();
    }
  });
});
