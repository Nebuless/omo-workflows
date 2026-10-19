import { describe, expect, test } from "bun:test";
import { herdrSkillPaths } from "../extensions/herdr/skills.ts";
import {
  capabilitiesForDiscovery,
  buildCapabilityArgv,
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

function required<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`Missing registered tool: ${name}`);
  return value;
}

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

  test("packaged skills expose no raw pane or executable route", async () => {
    for (const path of herdrSkillPaths(".")) {
      const source = await Bun.file(
        `extensions/herdr/${path.replace(/^\.\//u, "")}`,
      ).text();
      expect(source).not.toContain("pane run");
      expect(source).not.toContain("pane send-text");
      expect(source).not.toContain("pane send-keys");
      expect(source).not.toContain("normal executable");
      expect(source).not.toContain("run its normal executable");
      expect(source).not.toContain("raw argv");
    }
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
    expect(
      capabilitiesForDiscovery({
        version: "0.9.1",
        commandPaths: HERDR_0_9_1_COMMAND_PATHS,
        schema: "{}",
      }).some(
        (capability) => capability.id === "herdr.0.9.1.agent.profile-launch",
      ),
    ).toBe(true);
  });

  test("tolerates unrelated discovered paths while preserving mapped capabilities", () => {
    const discovery: HerdrDiscovery = {
      version: "0.9.1",
      commandPaths: [
        ...HERDR_0_9_1_COMMAND_PATHS,
        ["unrelated", "future-command"],
      ],
      schema: "{}",
    };
    expect(validateHerdrDiscovery(discovery)).toMatchObject({
      available: true,
      commandPathsMatch: true,
      unexpectedPaths: ["unrelated future-command"],
    });
    expect(
      capabilitiesForDiscovery(discovery).find(
        (capability) => capability.id === "herdr.0.9.1.agent.prompt",
      )?.availability,
    ).toBe("available");
  });

  test("builds bounded pane-identity prompt and supported launch argv", () => {
    const discovery: HerdrDiscovery = {
      version: "0.9.1",
      commandPaths: HERDR_0_9_1_COMMAND_PATHS,
      schema: "{}",
    };
    const prompt = capabilitiesForDiscovery(discovery).find(
      (capability) => capability.id === "herdr.0.9.1.agent.prompt",
    );
    const start = capabilitiesForDiscovery(discovery).find(
      (capability) => capability.id === "herdr.0.9.1.agent.start",
    );
    expect(prompt?.availability).toBe("available");
    expect(
      buildCapabilityArgv(required(prompt, "herdr.0.9.1.agent.prompt"), {
        paneId: "p1",
        text: "hello",
      }),
    ).toEqual([
      "agent",
      "prompt",
      "p1",
      "hello",
      "--wait",
      "--until",
      "working",
      "--timeout",
      "30000",
    ]);
    expect(start?.availability).toBe("unavailable");
  });

  test("does not complete mutation on unchanged readback", async () => {
    type Tool = {
      execute: (
        id: string,
        params: unknown,
      ) => Promise<{ details: { status: string } }>;
    };
    const tools = new Map<string, Tool>();
    const discovery: HerdrDiscovery = {
      version: "0.9.1",
      commandPaths: HERDR_0_9_1_COMMAND_PATHS,
      schema: "{}",
    };
    const pane = (status: "idle" | "working") =>
      JSON.stringify({
        id: "p1",
        result: {
          pane: {
            pane_id: "p1",
            revision: 1,
            tab_id: "t1",
            workspace_id: "w1",
            agent_status: status,
            state_change_seq: 1,
          },
        },
      });
    let call = 0;
    registerHerdrTools(
      {
        registerTool(definition: { name: string; execute?: unknown }) {
          tools.set(definition.name, definition as unknown as Tool);
        },
      },
      {
        discovery: async () => discovery,
        env: { HERDR_ENV: "1", HERDR_PANE_ID: "p1" },
        runner: async () => {
          call += 1;
          if (call === 1)
            return { exitCode: 0, output: pane("idle"), truncated: false };
          if (call === 2)
            return { exitCode: 0, output: "accepted", truncated: false };
          return { exitCode: 0, output: pane("working"), truncated: false };
        },
      },
    );
    const result = await required(
      tools.get("herdr_operation"),
      "herdr_operation",
    ).execute("id", {
      capabilityId: "herdr.0.9.1.agent.prompt",
      correlationId: "prompt-unchanged",
      targetSnapshot: createTargetSnapshot({
        kind: "pane",
        id: "p1",
        revision: 1,
        workspaceId: "w1",
        tabId: "t1",
        paneId: "p1",
        agentStatus: "idle",
        stateChangeSeq: 1,
      }),
      input: { paneId: "p1", text: "hello" },
    });
    expect(result.details.status).toBe("unknown");
    expect(call).toBe(3);
  });

  test("rejects prompt pane mismatch before any mutation runner call", async () => {
    const tools = new Map<
      string,
      {
        execute: (
          id: string,
          params: unknown,
        ) => Promise<{ details: { status: string } }>;
      }
    >();
    let calls = 0;
    registerHerdrTools(
      {
        registerTool(definition: { name: string; execute?: unknown }) {
          tools.set(definition.name, definition as never);
        },
      },
      {
        discovery: async () => ({
          version: "0.9.1",
          commandPaths: HERDR_0_9_1_COMMAND_PATHS,
          schema: "{}",
        }),
        env: { HERDR_ENV: "1", HERDR_PANE_ID: "p2" },
        runner: async () => {
          calls += 1;
          return { exitCode: 0, output: "", truncated: false };
        },
      },
    );
    const result = await required(
      tools.get("herdr_operation"),
      "herdr_operation",
    ).execute("id", {
      capabilityId: "herdr.0.9.1.agent.prompt",
      correlationId: "mismatch",
      targetSnapshot: target(),
      input: { paneId: "p2", text: "hello" },
    });
    expect(result.details.status).toBe("failed");
    expect(calls).toBe(0);
  });

  test("rejects target outside current pane authority before runner", async () => {
    const tools = new Map<
      string,
      {
        execute: (
          id: string,
          params: unknown,
        ) => Promise<{ details: { status: string } }>;
      }
    >();
    let calls = 0;
    registerHerdrTools(
      {
        registerTool(definition: { name: string; execute?: unknown }) {
          tools.set(definition.name, definition as never);
        },
      },
      {
        discovery: async () => ({
          version: "0.9.1",
          commandPaths: HERDR_0_9_1_COMMAND_PATHS,
          schema: "{}",
        }),
        env: { HERDR_ENV: "1", HERDR_PANE_ID: "p2" },
        runner: async () => {
          calls += 1;
          return { exitCode: 0, output: "{}", truncated: false };
        },
      },
    );
    const result = await required(
      tools.get("herdr_operation"),
      "herdr_operation",
    ).execute("id", {
      capabilityId: "herdr.0.9.1.agent.prompt",
      correlationId: "authority",
      targetSnapshot: target(),
      input: { paneId: "p1", text: "hello" },
    });
    expect(result.details.status).toBe("failed");
    expect(calls).toBe(0);
  });

  test("requires stateChangeSeq before claiming prompt delivery", async () => {
    const tools = new Map<
      string,
      {
        execute: (
          id: string,
          params: unknown,
        ) => Promise<{ details: { status: string } }>;
      }
    >();
    let calls = 0;
    registerHerdrTools(
      {
        registerTool(definition: { name: string; execute?: unknown }) {
          tools.set(definition.name, definition as never);
        },
      },
      {
        discovery: async () => ({
          version: "0.9.1",
          commandPaths: HERDR_0_9_1_COMMAND_PATHS,
          schema: "{}",
        }),
        env: { HERDR_ENV: "1", HERDR_PANE_ID: "p1" },
        runner: async () => {
          calls += 1;
          const status = calls === 1 ? "idle" : "working";
          return {
            exitCode: 0,
            output: JSON.stringify({
              id: "p1",
              result: {
                pane: {
                  pane_id: "p1",
                  revision: calls,
                  tab_id: "t1",
                  workspace_id: "w1",
                  agent_status: status,
                },
              },
            }),
            truncated: false,
          };
        },
      },
    );
    const result = await required(
      tools.get("herdr_operation"),
      "herdr_operation",
    ).execute("id", {
      capabilityId: "herdr.0.9.1.agent.prompt",
      correlationId: "no-seq",
      targetSnapshot: createTargetSnapshot({
        kind: "pane",
        id: "p1",
        revision: 1,
        workspaceId: "w1",
        tabId: "t1",
        paneId: "p1",
        agentStatus: "idle",
      }),
      input: { paneId: "p1", text: "hello" },
    });
    expect(result.details.status).toBe("unknown");
  });

  test("completes prompt only after working state and revision change", async () => {
    const tools = new Map<
      string,
      {
        execute: (
          id: string,
          params: unknown,
        ) => Promise<{ details: { status: string } }>;
      }
    >();
    let call = 0;
    registerHerdrTools(
      {
        registerTool(definition: { name: string; execute?: unknown }) {
          tools.set(definition.name, definition as never);
        },
      },
      {
        discovery: async () => ({
          version: "0.9.1",
          commandPaths: HERDR_0_9_1_COMMAND_PATHS,
          schema: "{}",
        }),
        env: { HERDR_ENV: "1", HERDR_PANE_ID: "p1" },
        runner: async () => {
          call += 1;
          if (call === 1)
            return {
              exitCode: 0,
              output: JSON.stringify({
                id: "p1",
                result: {
                  pane: {
                    pane_id: "p1",
                    revision: 9,
                    tab_id: "t1",
                    workspace_id: "w1",
                    agent_status: "idle",
                    state_change_seq: 9,
                  },
                },
              }),
              truncated: false,
            };
          if (call === 2)
            return { exitCode: 0, output: "accepted", truncated: false };
          return {
            exitCode: 0,
            output: JSON.stringify({
              id: "p1",
              result: {
                pane: {
                  pane_id: "p1",
                  revision: 10,
                  tab_id: "t1",
                  workspace_id: "w1",
                  agent_status: "working",
                  state_change_seq: 10,
                },
              },
            }),
            truncated: false,
          };
        },
      },
    );
    const result = await required(
      tools.get("herdr_operation"),
      "herdr_operation",
    ).execute("id", {
      capabilityId: "herdr.0.9.1.agent.prompt",
      correlationId: "prompt-success",
      targetSnapshot: createTargetSnapshot({
        kind: "pane",
        id: "p1",
        revision: 9,
        workspaceId: "w1",
        tabId: "t1",
        paneId: "p1",
        agentStatus: "idle",
        stateChangeSeq: 9,
      }),
      input: { paneId: "p1", text: "hello" },
    });
    expect(result.details.status).toBe("completed");
  });

  test("fails nonzero mutation and truncated mutation or readback", async () => {
    const discovery: HerdrDiscovery = {
      version: "0.9.1",
      commandPaths: HERDR_0_9_1_COMMAND_PATHS,
      schema: "{}",
    };
    const pane = (revision: number, status = "idle") =>
      JSON.stringify({
        id: "p1",
        result: {
          pane: {
            pane_id: "p1",
            revision,
            tab_id: "t1",
            workspace_id: "w1",
            agent_status: status,
            state_change_seq: revision,
          },
        },
      });
    for (const [mutation, expectedStatus, expectedCalls] of [
      [{ exitCode: 1, output: "rejected", truncated: false }, "failed", 2],
      [{ exitCode: 0, output: "accepted", truncated: true }, "unknown", 2],
      [
        {
          exitCode: 0,
          output: "accepted",
          truncated: false,
          readbackTruncated: true,
        },
        "unknown",
        3,
      ],
    ] as const) {
      const tools = new Map<
        string,
        {
          execute: (
            id: string,
            params: unknown,
          ) => Promise<{ details: { status: string } }>;
        }
      >();
      let call = 0;
      registerHerdrTools(
        {
          registerTool(definition: { name: string; execute?: unknown }) {
            tools.set(definition.name, definition as never);
          },
        },
        {
          discovery: async () => discovery,
          env: { HERDR_ENV: "1", HERDR_PANE_ID: "p1" },
          runner: async () => {
            call += 1;
            if (call === 1)
              return { exitCode: 0, output: pane(1, "idle"), truncated: false };
            if (call === 3)
              return {
                exitCode: 0,
                output: pane(8, "working"),
                truncated: Boolean(
                  (mutation as unknown as { readbackTruncated?: boolean })
                    .readbackTruncated,
                ),
              };
            return mutation as {
              exitCode: number;
              output: string;
              truncated: boolean;
            };
          },
        },
      );
      const result = await required(
        tools.get("herdr_operation"),
        "herdr_operation",
      ).execute("id", {
        capabilityId: "herdr.0.9.1.agent.prompt",
        correlationId: `case-${call}`,
        targetSnapshot: target(),
        input: { paneId: "p1", text: "hello" },
      });
      expect(result.details.status).toBe(expectedStatus);
      expect(call).toBe(expectedCalls);
    }
  });

  test("rejects oversized UTF-8 prompt after inspection without mutation", async () => {
    const tools = new Map<
      string,
      {
        execute: (
          id: string,
          params: unknown,
        ) => Promise<{ details: { status: string } }>;
      }
    >();
    let calls = 0;
    const pane = JSON.stringify({
      id: "p1",
      result: {
        pane: {
          pane_id: "p1",
          revision: 1,
          tab_id: "t1",
          workspace_id: "w1",
          agent_status: "idle",
          state_change_seq: 1,
        },
      },
    });
    registerHerdrTools(
      {
        registerTool(definition: { name: string; execute?: unknown }) {
          tools.set(definition.name, definition as never);
        },
      },
      {
        discovery: async () => ({
          version: "0.9.1",
          commandPaths: HERDR_0_9_1_COMMAND_PATHS,
          schema: "{}",
        }),
        env: { HERDR_ENV: "1", HERDR_PANE_ID: "p1" },
        runner: async () => {
          calls += 1;
          return { exitCode: 0, output: pane, truncated: false };
        },
      },
    );
    const result = await required(
      tools.get("herdr_operation"),
      "herdr_operation",
    ).execute("id", {
      capabilityId: "herdr.0.9.1.agent.prompt",
      correlationId: "oversized",
      targetSnapshot: createTargetSnapshot({
        kind: "pane",
        id: "p1",
        revision: 1,
        workspaceId: "w1",
        tabId: "t1",
        paneId: "p1",
        agentStatus: "idle",
        stateChangeSeq: 1,
      }),
      input: { paneId: "p1", text: "é".repeat(10_001) },
    });
    expect(result.details.status).toBe("failed");
    expect(calls).toBe(1);
  });

  test("keeps start and profile unavailable without stable identity/readiness proof", async () => {
    const discovery: HerdrDiscovery = {
      version: "0.9.1",
      commandPaths: HERDR_0_9_1_COMMAND_PATHS,
      schema: "{}",
    };
    for (const [capabilityId, input] of [
      [
        "herdr.0.9.1.agent.start",
        { name: "worker", kind: "codex", paneId: "p1", timeoutMs: 30_000 },
      ],
      [
        "herdr.0.9.1.agent.profile-launch",
        { profile: "codex-review", paneId: "p1", timeoutMs: 30_000 },
      ],
    ] as const) {
      const tools = new Map<
        string,
        {
          execute: (
            id: string,
            params: unknown,
          ) => Promise<{ details: { status: string } }>;
        }
      >();
      let call = 0;
      registerHerdrTools(
        {
          registerTool(definition: { name: string; execute?: unknown }) {
            tools.set(definition.name, definition as never);
          },
        },
        {
          discovery: async () => discovery,
          env: { HERDR_ENV: "1", HERDR_PANE_ID: "p1" },
          runner: async () => {
            call += 1;
            return { exitCode: 0, output: "{}", truncated: false };
          },
        },
      );
      const result = await required(
        tools.get("herdr_operation"),
        "herdr_operation",
      ).execute("id", {
        capabilityId,
        correlationId: "launch",
        targetSnapshot: target(),
        input,
      });
      expect(result.details.status).toBe("unavailable");
      expect(call).toBe(0);
    }
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

  test("uses default crypto nonce with its required receiver", () => {
    const approvals = new ApprovalRegistry();
    expect(() =>
      approvals.request({
        capabilityId: "herdr.0.9.1.agent.prompt",
        correlationId: "default-crypto-nonce",
        parameters: { paneId: "p1", text: "not-sent" },
        target: target(),
      }),
    ).not.toThrow();
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
    for (const capabilityId of ["herdr.0.9.1.worktree.create"]) {
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
