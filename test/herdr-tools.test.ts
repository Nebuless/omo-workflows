import { describe, expect, test } from "bun:test";
import { herdrSkillPaths } from "../extensions/herdr/skills.ts";
import {
  capabilitiesForDiscovery,
  HERDR_0_9_1_COMMAND_PATHS,
  HERDR_0_9_1_CAPABILITIES,
  validateHerdrDiscovery,
} from "../extensions/herdr/capabilities.ts";
import {
  ApprovalRegistry,
  APPROVAL_LIMITATION,
} from "../extensions/herdr/approval.ts";
import {
  createTargetSnapshot,
  assertTargetSnapshotFresh,
  assertAgentPrompt,
} from "../extensions/herdr/targets.ts";
import {
  decodeHerdrTargetReadback,
  registerHerdrTools,
} from "../extensions/herdr/tools.ts";
import type { HerdrDiscovery } from "../extensions/herdr/capabilities.ts";

const target = () =>
  createTargetSnapshot({
    kind: "pane",
    id: "p1",
    revision: 1,
    workspaceId: "w1",
    tabId: "t1",
    paneId: "p1",
  });

describe("Herdr extension tools", () => {
  test("registers composable tools and no public raw controller", () => {
    const tools = new Map<string, unknown>();
    registerHerdrTools({
      registerTool(definition: { name: string }) {
        tools.set(definition.name, definition);
      },
    });
    expect([...tools.keys()]).toEqual([
      "herdr_inspect",
      "herdr_capabilities",
      "herdr_query",
      "herdr_operation",
      "herdr_approval",
      "herdr_preview",
    ]);
    expect(tools.has("herdr_control")).toBe(false);
  });

  test("reports Preview unavailable and exposes no inert preview operations", async () => {
    const tools = new Map<string, unknown>();
    registerHerdrTools({
      registerTool(definition: { name: string }) {
        tools.set(definition.name, definition);
      },
    });
    const preview = tools.get("herdr_preview") as {
      readonly parameters: {
        readonly additionalProperties: boolean;
        readonly properties: Record<string, unknown>;
      };
      execute(): Promise<{
        readonly details: {
          readonly capabilityId: string;
          readonly exitCode: null;
          readonly nextSafeAction: string;
          readonly output: string;
          readonly stage: string;
          readonly status: string;
        };
      }>;
    };

    expect(Object.keys(preview.parameters.properties)).toEqual([]);
    expect(preview.parameters.additionalProperties).toBe(false);

    const result = await preview.execute();
    expect(result.details).toMatchObject({
      capabilityId: "herdr.preview",
      exitCode: null,
      stage: "availability",
      status: "unavailable",
    });
    expect(JSON.parse(result.details.output)).toEqual({
      available: false,
      reason:
        "terminal-browser rendering in a Herdr Preview tab has not been independently verified",
    });
    expect(result.details.nextSafeAction).toContain("independently verified");
  });

  test("discovers complete Herdr skill suite", () => {
    expect(herdrSkillPaths("/extension")).toEqual([
      "/extension/skills/herdr/SKILL.md",
      "/extension/skills/herdr-agent-management/SKILL.md",
      "/extension/skills/herdr-handoff/SKILL.md",
      "/extension/skills/herdr-orchestration/SKILL.md",
      "/extension/skills/herdr-admin/SKILL.md",
    ]);
  });

  test("fails closed when installed command inventory or version differs", () => {
    const validation = validateHerdrDiscovery({
      version: "0.9.1",
      commandPaths: HERDR_0_9_1_COMMAND_PATHS.slice(1),
      schema: "{}",
    });
    expect(validation.available).toBe(false);
    expect(
      capabilitiesForDiscovery({
        version: "0.8.0",
        commandPaths: HERDR_0_9_1_COMMAND_PATHS,
        schema: "{}",
      }).every((capability) => capability.availability === "unavailable"),
    ).toBe(true);
    expect(HERDR_0_9_1_CAPABILITIES.length).toBe(
      HERDR_0_9_1_COMMAND_PATHS.length,
    );
  });

  test("rejects stale target and caps agent prompt bytes", () => {
    expect(() =>
      assertTargetSnapshotFresh(
        target(),
        createTargetSnapshot({
          kind: "pane",
          id: "p1",
          revision: 2,
          workspaceId: "w1",
          tabId: "t1",
          paneId: "p1",
        }),
      ),
    ).toThrow("revision changed");
    expect(() => assertAgentPrompt("é".repeat(10_001))).toThrow("UTF-8 bytes");
  });

  test("approval nonce is bound, non-authoritative, and single-use", () => {
    let now = 1000;
    const approvals = new ApprovalRegistry({
      now: () => now,
      createNonce: () => "n1",
    });
    const request = {
      capabilityId: "herdr.0.9.1.pane.close",
      correlationId: "c1",
      parameters: { id: "p1" },
      target: target(),
    };
    const issued = approvals.request(request);
    expect(issued.limitation).toBe(APPROVAL_LIMITATION);
    approvals.confirm(request, issued.nonce);
    approvals.consume(request, issued.nonce);
    expect(() => approvals.consume(request, issued.nonce)).toThrow("used");
    now += 300_001;
    expect(approvals.get("c1")?.state).toBe("used");
  });

  test("unproven mutation capabilities stay unavailable without runner calls", async () => {
    type Tool = {
      execute: (
        id: string,
        params: unknown,
      ) => Promise<{ details: { status: string; nextSafeAction: string } }>;
    };
    const tools = new Map<string, Tool>();
    let calls = 0;
    const discovery: HerdrDiscovery = {
      version: "0.9.1",
      commandPaths: HERDR_0_9_1_COMMAND_PATHS,
      schema: "{}",
    };
    registerHerdrTools(
      {
        registerTool(definition: { name: string; execute?: unknown }) {
          tools.set(definition.name, definition as unknown as Tool);
        },
      },
      {
        runner: async () => {
          calls += 1;
          return { exitCode: 0, output: "", truncated: false };
        },
        discovery: async () => discovery,
        env: { HERDR_ENV: "1", HERDR_PANE_ID: "p1" },
      },
    );
    for (const capabilityId of [
      "herdr.0.9.1.agent.prompt",
      "herdr.0.9.1.worktree.create",
    ]) {
      const result = await tools.get("herdr_operation")?.execute("id", {
        capabilityId,
        correlationId: capabilityId,
        targetSnapshot: target(),
        input: {},
      });
      expect(result?.details.status).toBe("unavailable");
    }
    expect(calls).toBe(0);
  });

  test("decodes exact proven 0.9.1 pane wrapper with numeric revision", () => {
    const pane = decodeHerdrTargetReadback(
      JSON.stringify({
        id: "p1",
        result: {
          pane: {
            pane_id: "p1",
            revision: 7,
            tab_id: "t1",
            workspace_id: "w1",
          },
        },
      }),
      "pane",
    );
    expect(pane).toMatchObject({
      kind: "pane",
      id: "p1",
      revision: "7",
      workspaceId: "w1",
      paneId: "p1",
      tabId: "t1",
    });
  });

  test("rejects exact revisionless workspace wrapper", () => {
    expect(() =>
      decodeHerdrTargetReadback(
        JSON.stringify({
          id: "w1",
          result: { workspace: { workspace_id: "w1" } },
        }),
        "workspace",
      ),
    ).toThrow("revision");
  });

  test("rejects exact agent wrapper as operation target", () => {
    expect(() =>
      decodeHerdrTargetReadback(
        JSON.stringify({
          id: "a1",
          result: {
            agent: {
              agent: "a1",
              agent_status: "idle",
              interactive_ready: true,
              pane_id: "p1",
              revision: 7,
              tab_id: "t1",
              workspace_id: "w1",
            },
          },
        }),
        "agent",
      ),
    ).toThrow("opaque agent identity");
  });

  test("real worktree creation wrapper cannot produce dispatch identity", async () => {
    const realResponse = JSON.stringify({
      id: "cli:worktree:create",
      result: {
        type: "worktree_created",
        workspace: { workspace_id: "w1" },
        worktree: {
          path: "/tmp/worktree",
          open_workspace_id: "w1",
        },
        tab: { tab_id: "t1" },
        root_pane: { pane_id: "p1", agent_status: "unknown" },
      },
    });
    expect(() => decodeHerdrTargetReadback(realResponse, "worktree")).toThrow(
      "revision",
    );
    let calls = 0;
    const tools = new Map<
      string,
      {
        execute: (
          id: string,
          params: unknown,
        ) => Promise<{ details: { status: string } }>;
      }
    >();
    const discovery: HerdrDiscovery = {
      version: "0.9.1",
      commandPaths: HERDR_0_9_1_COMMAND_PATHS,
      schema: "{}",
    };
    registerHerdrTools(
      {
        registerTool(definition: { name: string; execute?: unknown }) {
          tools.set(definition.name, definition as never);
        },
      },
      {
        runner: async () => {
          calls += 1;
          return { exitCode: 0, output: realResponse, truncated: false };
        },
        discovery: async () => discovery,
        env: { HERDR_ENV: "1", HERDR_PANE_ID: "p1" },
      },
    );
    const result = await tools.get("herdr_operation")?.execute("id", {
      capabilityId: "herdr.0.9.1.worktree.create",
      correlationId: "create",
      targetSnapshot: target(),
      input: {},
    });
    expect(result?.details.status).toBe("unavailable");
    expect(calls).toBe(0);
  });

  test("rejects missing and wrong-kind wrappers", () => {
    expect(() =>
      decodeHerdrTargetReadback(
        JSON.stringify({
          id: "p1",
          result: {
            pane: { pane_id: "p1", revision: "7", workspace_id: "w1" },
          },
        }),
        "pane",
      ),
    ).toThrow("tab_id");
    expect(() =>
      decodeHerdrTargetReadback(
        JSON.stringify({
          id: "w1",
          result: { workspace: { workspace_id: "w1", revision: "8" } },
        }),
        "pane",
      ),
    ).toThrow("result.pane");
  });
});
