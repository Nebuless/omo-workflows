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
  });
});
