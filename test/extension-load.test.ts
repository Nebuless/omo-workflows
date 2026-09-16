import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import rootPackage from "../package.json" with { type: "json" };
import workflowGraphPackage from "../extensions/workflow-graph/package.json" with {
  type: "json",
};

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

    const graphEvents = new Map<string, (data: unknown) => void>();
    const graphCommands = new Map<string, unknown>();
    const graphTools = new Map<string, { readonly parameters: TSchema }>();
    const graphLifecycle = new Map<string, () => Promise<void> | void>();
    const graphHooks: string[] = [];
    const graphHost = {
      registerTool(definition: { name: string; parameters: TSchema }) {
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
        graphHooks.push(name);
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
      const workflowProgram = graphTools.get("workflow_program");
      const workflowRecommend = graphTools.get("workflow_recommend");
      if (workflowProgram === undefined || workflowRecommend === undefined)
        throw new Error("missing workflow public tool");
      const selection = {
        key: "destination",
        revision: 1,
        digest: `sha256:v1:${"a".repeat(64)}`,
      };
      const transfer = {
        action: "transfer",
        sourceRunId: "source-run",
        selection,
        manifest: {
          schemaVersion: 1,
          source: {
            runId: "source-run",
            workflowKey: "source-workflow",
            definitionFingerprint: "b".repeat(64),
            terminal: true,
          },
          destination: selection,
          artifacts: [
            {
              canonicalPath: "report.json",
              destination: "report.json",
              sha256: "c".repeat(64),
              size: 1,
              schemaId: "report",
            },
          ],
          mappings: [{ source: "/report", destination: "/input" }],
        },
        confirmed: true,
      };
      expect(
        [
          { action: "list" },
          { action: "reload" },
          { action: "start", selection, inputs: {} },
          { action: "resume", key: "workflow" },
          { action: "status" },
          { action: "answer", gateId: "gate", answer: "continue" },
          { action: "cancel", confirmed: true },
          transfer,
        ].every((params) => Value.Check(workflowProgram.parameters, params)),
      ).toBe(true);
      expect(
        Value.Check(workflowRecommend.parameters, {
          catalogRevision: 1,
          proposals: [
            {
              key: "workflow",
              digest: "digest",
              rationale: "fit",
              confidence: 0,
            },
          ],
        }),
      ).toBe(true);
      expect(graphCommands.has("workflow-graph-pane")).toBe(true);
      expect(graphHooks).toContain("before_agent_start");
      expect(graphHooks).toContain("agent_settled");
      expect(graphLifecycle.has("session_start")).toBe(true);
      expect(graphLifecycle.has("session_before_switch")).toBe(true);
      expect(graphLifecycle.has("session_before_fork")).toBe(true);
      expect(graphLifecycle.has("session_shutdown")).toBe(true);

      const execution = await import(
        "../extensions/workflow-graph/src/execution/index.ts"
      );
      expect(typeof execution.composeStagedPrograms).toBe("function");
      expect(typeof execution.applyCompositionMapping).toBe("function");
      expect(rootPackage.dependencies).toEqual({
        "@code-yeongyu/senpi": "2026.9.13",
        "@earendil-works/pi-ai": "npm:@code-yeongyu/senpi-ai@2026.9.13",
        "@earendil-works/pi-tui": "npm:@code-yeongyu/senpi-tui@2026.9.13",
        typebox: "1.3.18",
        jiti: "2.7.0",
      });
      expect(workflowGraphPackage.dependencies).toEqual({ jiti: "2.7.0" });
    } finally {
      await graphLifecycle.get("session_shutdown")?.();
    }
  });
});
