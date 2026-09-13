import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { createNativeWorkflowTransport } from "../src/execution/native-transport.ts";
import { nativeDefinitionFingerprint } from "../src/execution/native-fingerprint.ts";
import {
  createStagedController,
  createStagedProgram,
  type NativeWorkflowTransport,
  type ProgramNode,
} from "../src/execution/index.ts";

const output = Type.Object(
  { ok: Type.Boolean() },
  { additionalProperties: false },
);
const node = (
  id: string,
  contract: ProgramNode["output"] = { schema: output },
): ProgramNode => ({
  id,
  prompt: id,
  category: "implementation",
  output: contract,
});
const authored = (value: ProgramNode) => {
  const { output: _, ...result } = value;
  return result;
};
const program = () =>
  createStagedProgram({
    key: "ship",
    version: 1,
    input: Type.Object({ target: Type.String() }),
    decide: ({ results, answers }) =>
      results.first === undefined
        ? { kind: "wave" as const, id: "first", nodes: [node("first")] }
        : answers.approve === undefined
          ? {
              kind: "gate" as const,
              id: "approve",
              question: "Approve?",
              choices: ["yes", "no"],
            }
          : results.second === undefined
            ? { kind: "wave" as const, id: "second", nodes: [node("second")] }
            : { kind: "final" as const, result: results },
  });
type Params = Parameters<NativeWorkflowTransport["execute"]>[0];
type Detail = Awaited<ReturnType<NativeWorkflowTransport["execute"]>>;
const fingerprint = (value: ProgramNode) => JSON.stringify(authored(value));
function native(
  outputs: Record<string, string>,
  hook?: (params: Params) => Promise<Detail | undefined>,
): { value: NativeWorkflowTransport; calls: Params[] } {
  const calls: Params[] = [];
  return {
    calls,
    value: {
      async execute(params) {
        calls.push(params);
        const custom = await hook?.(params);
        if (custom) return custom;
        if (params.action === "start")
          return { content: [], details: { kind: "started", run_id: "run-1" } };
        if (params.action === "amend")
          return { content: [], details: { kind: "amended", run_id: "run-1" } };
        if (params.action === "snapshot") {
          const dispatch = [...calls]
            .reverse()
            .find((call) => call.action === "start" || call.action === "amend");
          if (dispatch === undefined || !("definition" in dispatch))
            return {
              content: [],
              details: {
                kind: "error",
                error: { code: "run_not_found", message: "No native run." },
              },
            };
          const nodes = dispatch.definition.nodes.map((item) => ({
            id: item.id,
            state: "completed",
          }));
          return {
            content: [],
            details: {
              kind: "snapshot",
              run_id: "run-1",
              snapshot: {
                runId: "run-1",
                runKey: dispatch.definition.key,
                status: "completed",
                nodes,
                definitionFingerprint: nativeDefinitionFingerprint(
                  dispatch.definition,
                ),
              },
            },
          };
        }
        if (params.action === "wait") {
          const dispatch = [...calls]
            .reverse()
            .find((call) => call.action === "start" || call.action === "amend");
          const ids =
            dispatch && "definition" in dispatch
              ? dispatch.definition.nodes.map(({ id }) => id)
              : [];
          return {
            content: [],
            details: {
              kind: "waited",
              run_id: "run-1",
              result: {
                runId: "run-1",
                status: "completed",
                nodes: Object.fromEntries(
                  ids.map((id) => [
                    id,
                    { state: "completed", output: outputs[id] ?? "{}" },
                  ]),
                ),
              },
            },
          };
        }
        return { content: [], details: { kind: "cancelled", run_id: "run-1" } };
      },
    },
  };
}
function journal(entries: unknown[] = [], failAt = -1) {
  let appends = 0;
  return {
    entries,
    async appendEntry(customType: string, data: unknown) {
      if (appends++ === failAt) throw new Error("disk");
      entries.push({ customType, data: structuredClone(data) });
    },
    getBranch: () => entries,
  };
}
const make = (
  n: NativeWorkflowTransport,
  j = journal(),
  p = program(),
  readArtifact: (path: string) => Promise<string> = async () => "",
) =>
  createStagedController({
    native: n,
    journal: j,
    program: p,
    inputs: { target: "prod" },
    readArtifact,
  });

const deferred = <T>() => Promise.withResolvers<T>();

describe("staged workflow controller", () => {
  test("registered inactive workflow uses public lazy activation", async () => {
    let dispatched = false;
    const transport = createNativeWorkflowTransport({
      getAllTools: () => [
        {
          name: "workflow",
          parameters: Type.Object(
            { action: Type.Literal("cancel"), run_id: Type.String() },
            { additionalProperties: false },
          ),
        },
      ],
      getActiveTools: () => [],
      async executeTool(
        name,
        params,
        options?: { activateInactiveTool?: boolean },
      ) {
        expect(name).toBe("workflow");
        expect(params).toEqual({ action: "cancel", run_id: "run-1" });
        if (options?.activateInactiveTool !== true)
          throw new Error("inactive_tool");
        dispatched = true;
        return { content: [], details: { kind: "cancelled", run_id: "run-1" } };
      },
    });
    expect(
      (await transport.execute({ action: "cancel", run_id: "run-1" })).details
        .kind,
    ).toBe("cancelled");
    expect(dispatched).toBe(true);
  });

  test("opted-in invalid output records unlock only explicit repair decisions", async () => {
    const p = createStagedProgram({
      key: "repair",
      version: 1,
      input: Type.Object({ target: Type.String() }),
      decide: ({ results }) =>
        results.first === undefined
          ? {
              kind: "wave" as const,
              id: "first",
              nodes: [{ ...node("first"), invalidOutput: "report" as const }],
            }
          : results.repair === undefined
            ? { kind: "wave" as const, id: "repair", nodes: [node("repair")] }
            : { kind: "final" as const, result: results },
    });
    const n = native({ first: "not-json", repair: '{"ok":true}' });
    const controller = make(n.value, journal(), p);
    expect((await controller.advance()).kind).toBe("wave");
    expect(controller.checkpoint().results.first).toEqual({
      first: { kind: "invalid-output", code: "json" },
    });
    const start = n.calls.find((call) => call.action === "start");
    if (start?.action !== "start") throw Error("missing start");
    expect(start.definition.nodes[0]).not.toHaveProperty("invalidOutput");
    expect((await controller.advance()).kind).toBe("final");
    expect(controller.checkpoint().results.repair).toEqual({
      repair: { ok: true },
    });
  });

  test("rejects external native amendment before admitting outputs", async () => {
    const n = native({ first: '{"ok":true}' }, async (params) =>
      params.action === "snapshot"
        ? {
            content: [],
            details: {
              kind: "snapshot",
              run_id: "run-1",
              snapshot: {
                runId: "run-1",
                runKey: "ship",
                status: "completed",
                definitionFingerprint: "external-definition",
                nodes: [{ id: "first", state: "completed" }],
              },
            },
          }
        : undefined,
    );
    const controller = make(n.value);
    expect(await controller.advance()).toMatchObject({
      kind: "rejected",
      reason: "native-definition-conflict",
    });
    expect(controller.checkpoint().results).toEqual({});
    expect(n.calls.some((call) => call.action === "wait")).toBe(false);
  });

  test("failed native cancellation keeps cancellation fence without false acknowledgement", async () => {
    const n = native({ first: '{"ok":true}' }, async (params) =>
      params.action === "cancel"
        ? {
            content: [],
            details: {
              kind: "error",
              error: { code: "unavailable", message: "unavailable" },
            },
          }
        : undefined,
    );
    const controller = make(n.value);
    await controller.advance();
    expect(await controller.cancel()).toMatchObject({
      kind: "rejected",
      reason: "native-cancel-failed",
    });
    expect(controller.checkpoint().cancelled).toBe(true);
  });

  test("native snapshot never uses nonexistent key lookup before initial start", async () => {
    const n = native({ first: '{"ok":true}' });
    await make(n.value).advance();
    expect(
      n.calls.filter(
        (call) => call.action === "snapshot" && call.run_id === undefined,
      ),
    ).toEqual([]);
  });

  test("cancel while durable dispatch intent is awaiting acknowledgement prevents start", async () => {
    const writing = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const entries: unknown[] = [];
    const n = native({ first: '{"ok":true}' });
    let first = true;
    const j = {
      getBranch: () => entries,
      async appendEntry(customType: string, data: unknown) {
        if (first) {
          first = false;
          entered.resolve();
          await writing.promise;
        }
        entries.push({ customType, data: structuredClone(data) });
      },
    };
    const controller = createStagedController({
      native: n.value,
      journal: j,
      program: program(),
      inputs: { target: "prod" },
      readArtifact: async () => "",
    });
    const advancing = controller.advance();
    await entered.promise;
    const cancelling = controller.cancel();
    writing.resolve();
    await advancing;
    await cancelling;
    expect(
      n.calls.filter(
        (call) => call.action === "start" || call.action === "amend",
      ),
    ).toEqual([]);
    expect(controller.checkpoint().cancelled).toBe(true);
  });
  test("validates output schema; rejection stays sticky across calls and restart", async () => {
    const n = native({ first: '{"ok":"wrong"}' });
    const j = journal();
    const first = make(n.value, j);
    expect(await first.advance()).toEqual({
      kind: "rejected",
      reason: "Native workflow output for first failed schema validation.",
    });
    expect(await first.advance()).toEqual({
      kind: "rejected",
      reason: "Native workflow output for first failed schema validation.",
    });
    const calls = n.calls.length;
    expect(await make(n.value, j).advance()).toEqual({
      kind: "rejected",
      reason: "Native workflow output for first failed schema validation.",
    });
    expect(n.calls).toHaveLength(calls);
  });

  test("single-flights simultaneous advance and admits current-wave nodes only", async () => {
    const outputs = { first: '{"ok":true}', second: '{"ok":true}' };
    const n = native(outputs);
    const controller = make(n.value);
    const decisions = await Promise.all([
      controller.advance(),
      controller.advance(),
    ]);
    expect(decisions.map(({ kind }) => kind)).toEqual(["gate", "gate"]);
    expect(n.calls.filter(({ action }) => action === "start")).toHaveLength(1);
    outputs.first = "previous output must not be parsed again";
    await controller.answerGate("approve", "yes");
    await controller.advance();
    const amend = n.calls.find(({ action }) => action === "amend");
    expect(amend).toEqual({
      action: "amend",
      run_id: "run-1",
      definition: {
        key: "ship",
        name: "ship",
        nodes: [authored(node("first")), authored(node("second"))],
      },
    });
    expect(controller.checkpoint().results).toEqual({
      first: { first: { ok: true } },
      second: { second: { ok: true } },
    });
  });

  test("cancel during async artifact read persists fence and never amends", async () => {
    const reading = deferred<string>();
    const started = deferred<void>();
    const fileProgram = createStagedProgram({
      key: "ship",
      version: 1,
      input: Type.Object({ target: Type.String() }),
      decide: ({ results }) =>
        results.first === undefined
          ? {
              kind: "wave" as const,
              id: "first",
              nodes: [
                node("first", {
                  file: { path: "result.json", schema: output },
                }),
              ],
            }
          : { kind: "wave" as const, id: "second", nodes: [node("second")] },
    });
    const n = native({ first: "ignored" });
    const j = journal();
    const controller = make(n.value, j, fileProgram, async () => {
      started.resolve();
      return reading.promise;
    });
    const advancing = controller.advance();
    await started.promise;
    const cancelling = controller.cancel();
    reading.resolve('{"ok":true}');
    expect(await advancing).toEqual({ kind: "rejected", reason: "cancelled" });
    expect(await cancelling).toEqual({ kind: "rejected", reason: "cancelled" });
    expect(n.calls.filter(({ action }) => action === "amend")).toHaveLength(0);
    expect((await make(n.value, j, fileProgram).advance()).kind).toBe(
      "rejected",
    );
  });

  test("recovers initial dispatch after response-checkpoint failure through native keyed reuse", async () => {
    const n = native({ first: '{"ok":true}' });
    const j = journal([], 1);
    expect(await make(n.value, j).advance()).toEqual({
      kind: "durability-unavailable",
    });
    expect(n.calls.filter(({ action }) => action === "start")).toHaveLength(1);
    const restarted = make(n.value, j);
    expect((await restarted.advance()).kind).toBe("gate");
    expect(n.calls.filter(({ action }) => action === "start")).toHaveLength(2);
    expect(restarted.checkpoint().runId).toBe("run-1");
    expect(restarted.checkpoint().definition?.nodes[0]).toEqual(
      authored(node("first")),
    );
  });

  test("recovers amend success after response-checkpoint failure without duplicate admission", async () => {
    const n = native({ first: '{"ok":true}', second: '{"ok":true}' });
    const j = journal([], 5);
    const controller = make(n.value, j);
    await controller.advance();
    await controller.answerGate("approve", "yes");
    expect(await controller.advance()).toEqual({
      kind: "durability-unavailable",
    });
    expect(n.calls.filter(({ action }) => action === "amend")).toHaveLength(1);
    expect((await make(n.value, j).advance()).kind).toBe("final");
    expect(n.calls.filter(({ action }) => action === "amend")).toHaveLength(1);
  });

  test("exact file contract rejects wrong nonempty artifact and is not sent native", async () => {
    const p = createStagedProgram({
      key: "exact",
      version: 1,
      input: Type.Object({ target: Type.String() }),
      decide: ({ results }) =>
        results.criteria === undefined
          ? {
              kind: "wave" as const,
              id: "criteria",
              nodes: [
                node("criteria", {
                  file: { path: "criteria.md", exact: "canonical\n" },
                }),
              ],
            }
          : { kind: "final" as const, result: results },
    });
    const n = native({});
    expect(
      await make(
        n.value,
        journal(),
        p,
        async () => "wrong but nonempty",
      ).advance(),
    ).toEqual({
      kind: "rejected",
      reason: "Artifact for criteria did not match exact required contents.",
    });
    const start = n.calls.find((call) => call.action === "start");
    if (start?.action !== "start") throw Error("missing start");
    expect(start.definition.nodes[0]).not.toHaveProperty("output");
    const accepted = make(
      native({}).value,
      journal(),
      p,
      async () => "canonical\n",
    );
    expect((await accepted.advance()).kind).toBe("final");
  });

  test("validates required file contents without requiring native JSON output", async () => {
    const p = createStagedProgram({
      key: "file",
      version: 1,
      input: Type.Object({ target: Type.String() }),
      decide: ({ results }) =>
        results.files === undefined
          ? {
              kind: "wave" as const,
              id: "files",
              nodes: [
                node("writer", {
                  file: { path: "report.txt", nonempty: true },
                }),
              ],
            }
          : { kind: "final" as const, result: results },
    });
    const n = native({});
    const controller = make(n.value, journal(), p, async (path) =>
      path === "report.txt" ? "done" : "",
    );
    expect((await controller.advance()).kind).toBe("final");
    expect(controller.checkpoint().results).toEqual({
      files: { writer: "report.txt" },
    });
  });

  test("rejects foreign, missing, failed outputs and invalid journal records", async () => {
    for (const [name, hook, reason] of [
      [
        "foreign",
        async (p: Params) =>
          p.action === "wait"
            ? {
                content: [],
                details: {
                  kind: "waited" as const,
                  run_id: "other",
                  result: { runId: "other", status: "completed", nodes: {} },
                },
              }
            : undefined,
        "native-wait-failed",
      ],
      [
        "missing",
        async (p: Params) =>
          p.action === "wait"
            ? {
                content: [],
                details: {
                  kind: "waited" as const,
                  run_id: "run-1",
                  result: { runId: "run-1", status: "completed", nodes: {} },
                },
              }
            : undefined,
        "Native workflow omitted completed output for first.",
      ],
      [
        "failed",
        async (p: Params) =>
          p.action === "wait"
            ? {
                content: [],
                details: {
                  kind: "waited" as const,
                  run_id: "run-1",
                  result: { runId: "run-1", status: "failed", nodes: {} },
                },
              }
            : undefined,
        "Native workflow settled failed.",
      ],
    ] as const) {
      const n = native({}, hook);
      expect(await make(n.value).advance(), name).toEqual({
        kind: "rejected",
        reason,
      });
    }
    const invalid = journal([
      { customType: "omo-workflow-graph:staged", data: { workflow: "ship" } },
    ]);
    expect(await make(native({}).value, invalid).advance()).toEqual({
      kind: "rejected",
      reason: "invalid-journal-entry",
    });
  });

  test("external event flushes before decision and replays idempotently", async () => {
    const p = createStagedProgram({
      key: "external",
      version: 1,
      input: Type.Object({ target: Type.String() }),
      decide: ({ external }) =>
        external?.["live.exit"] === undefined
          ? {
              kind: "design-review" as const,
              id: "live-review" as const,
              previewPath: "/tmp/preview.html",
              maxModelEvents: 1,
            }
          : { kind: "final" as const, result: external["live.exit"] },
    });
    const entries: unknown[] = [];
    let flushed = false;
    const controller = createStagedController({
      native: native({}).value,
      journal: {
        getBranch: () => entries,
        async appendEntry(customType, data) {
          entries.push({ customType, data: structuredClone(data) });
          flushed = true;
        },
      },
      program: p,
      inputs: { target: "prod" },
      readArtifact: async () => "",
    });
    expect((await controller.advance()).kind).toBe("design-review");
    expect(
      await controller.recordExternal("live.exit", {
        type: "exit",
        raw: '{"type":"exit"}',
      }),
    ).toEqual({
      kind: "final",
      result: { type: "exit", raw: '{"type":"exit"}' },
    });
    expect(flushed).toBe(true);
    expect(await controller.recordExternal("spoof", undefined)).toEqual({
      kind: "rejected",
      reason: "invalid-external-event",
    });
    expect(
      await controller.recordExternal("live.exit", {
        type: "exit",
        raw: "x",
        data: Infinity,
      }),
    ).toEqual({ kind: "rejected", reason: "invalid-external-event" });
    expect(
      (
        await controller.recordExternal("live.exit", {
          type: "exit",
          raw: '{"type":"exit"}',
        })
      ).kind,
    ).toBe("final");
    expect(
      await controller.recordExternal("live.exit", {
        type: "exit",
        raw: "different",
      }),
    ).toEqual({ kind: "rejected", reason: "external-event-conflict" });
  });

  test("answers known gate once and enforces choices", async () => {
    const controller = make(native({ first: '{"ok":true}' }).value);
    await controller.advance();
    expect(await controller.answerGate("other", "yes")).toEqual({
      kind: "rejected",
      reason: "invalid-gate-answer",
    });
    expect(await controller.answerGate("approve", "maybe")).toEqual({
      kind: "rejected",
      reason: "invalid-gate-answer",
    });
    expect((await controller.answerGate("approve", "yes")).kind).toBe("wave");
    expect(await controller.answerGate("approve", "yes")).toEqual({
      kind: "rejected",
      reason: "invalid-gate-answer",
    });
  });

  test("cumulative definitions preserve prior fingerprints", async () => {
    const n = native({ first: '{"ok":true}', second: '{"ok":true}' });
    const controller = make(n.value);
    await controller.advance();
    await controller.answerGate("approve", "yes");
    await controller.advance();
    const amend = n.calls.find((call) => call.action === "amend");
    expect(
      amend && "definition" in amend
        ? amend.definition.nodes.map((item) => JSON.stringify(item))
        : [],
    ).toEqual([fingerprint(node("first")), fingerprint(node("second"))]);
  });
});
