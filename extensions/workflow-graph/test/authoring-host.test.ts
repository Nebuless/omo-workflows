import { expect, test } from "bun:test";
import { Type } from "typebox";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgramHost, LAUNCH_ENTRY_TYPE } from "../src/authoring/host.ts";
import { nativeDefinitionFingerprint } from "../src/execution/native-fingerprint.ts";
import {
  AuthoredWorkflowSchema,
  type AuthoredWorkflow,
  type StagedProgram,
} from "../src/execution/policy.ts";
import { Value } from "typebox/value";

function fixture(gate = false) {
  const entries: unknown[] = [];
  const definitions = new Map<string, AuthoredWorkflow>();
  const starts: string[] = [];
  const amendments: string[] = [];
  const program: StagedProgram = {
    key: "sample",
    version: 1,
    input: Type.Object({ prompt: Type.String() }),
    decide: ({ results, answers }) =>
      !results.one
        ? {
            kind: "wave",
            id: "one",
            nodes: [
              {
                id: "one",
                prompt: "one",
                subagent_type: "omo-senpi",
                output: { schema: Type.Object({ ok: Type.Boolean() }) },
              },
            ],
          }
        : gate && !answers.approve
          ? {
              kind: "gate",
              id: "approve",
              question: "Continue?",
              choices: ["yes"],
            }
          : !results.two
            ? {
                kind: "wave",
                id: "two",
                nodes: [
                  {
                    id: "two",
                    prompt: "two",
                    dependsOn: ["one"],
                    subagent_type: "omo-senpi",
                    output: { schema: Type.Object({ ok: Type.Boolean() }) },
                  },
                ],
              }
            : { kind: "final", result: results },
  };
  let completed = false;
  const runtime = {
    appendEntry(type: string, data: unknown) {
      entries.push({
        type: "custom",
        customType: type,
        data: structuredClone(data),
      });
    },
    getAllTools: () => [
      { name: "workflow", parameters: Type.Object({ action: Type.String() }) },
    ],
    getActiveTools: () => ["workflow"],
    async executeTool(_name: string, params: unknown) {
      if (
        params === null ||
        typeof params !== "object" ||
        !("action" in params)
      )
        throw new Error("invalid params");
      if (params.action === "start" || params.action === "amend") {
        if (
          !("definition" in params) ||
          !Value.Check(AuthoredWorkflowSchema, params.definition)
        )
          throw new Error("invalid definition");
        const id = `run-${params.definition.key}`;
        definitions.set(id, params.definition);
        if (params.action === "start") starts.push(id);
        else amendments.push(id);
        return {
          content: [],
          details: {
            kind: params.action === "start" ? "started" : "amended",
            run_id: id,
          },
        };
      }
      if (!("run_id" in params) || typeof params.run_id !== "string")
        throw new Error("missing run");
      const definition = definitions.get(params.run_id);
      if (!definition) throw new Error("unknown run");
      if (params.action === "snapshot")
        return {
          content: [],
          details: {
            kind: "snapshot",
            run_id: params.run_id,
            snapshot: {
              runId: params.run_id,
              runKey: definition.key,
              status: completed ? "completed" : "running",
              definitionFingerprint: nativeDefinitionFingerprint(definition),
              nodes: definition.nodes.map((n) => ({
                id: n.id,
                state: completed ? "completed" : "running",
              })),
            },
          },
        };
      if (params.action === "cancel")
        return {
          content: [],
          details: { kind: "cancelled", run_id: params.run_id },
        };
      return {
        content: [],
        details: {
          kind: "waited",
          run_id: params.run_id,
          result: {
            runId: params.run_id,
            status: "completed",
            nodes: Object.fromEntries(
              definition.nodes.map((n) => [
                n.id,
                { state: "completed", output: '{"ok":true}' },
              ]),
            ),
          },
        },
      };
    },
  };
  const context = {
    cwd: process.cwd(),
    isProjectTrusted: () => true,
    sessionManager: {
      getBranch: () => entries,
      isPersisted: () => true,
      flushEntries() {},
    },
  };
  const registry = {
    list: () => ["sample"],
    get: (key: string) => (key === "sample" ? program : undefined),
  };
  const host = createProgramHost(runtime, registry, () => {});
  return {
    host,
    context,
    starts,
    amendments,
    entries,
    complete() {
      completed = true;
    },
    runtime,
    registry,
  };
}

test("settled native run admits and submits next wave with same run identity", async () => {
  const f = fixture();
  const first = await f.host.start(f.context, "sample", { prompt: "task" });
  if (first.kind !== "active") throw new Error("not active");
  expect(
    (await f.host.start(f.context, "sample", { prompt: "replacement" })).kind,
  ).toBe("rejected");
  f.complete();
  await f.host.settled(first.runId);
  expect(f.host.status()?.decision?.kind).toBe("final");
  expect(f.amendments).toEqual([first.runId]);
  await f.host.start(f.context, "sample", { prompt: "second" });
  expect(new Set(f.starts).size).toBe(2);
});
test("human gate blocks amendment until explicit answer and restart keeps run", async () => {
  const f = fixture(true);
  const first = await f.host.start(f.context, "sample", { prompt: "task" });
  if (first.kind !== "active") throw new Error("not active");
  f.complete();
  await f.host.settled(first.runId);
  expect(f.host.status()?.decision?.kind).toBe("gate");
  expect(f.amendments).toEqual([]);
  f.host.stop();
  const restored = createProgramHost(f.runtime, f.registry, () => {});
  await restored.restore(f.context);
  expect(restored.status()?.runId).toBe(first.runId);
  expect((await restored.answer("approve", "yes")).kind).toBe("final");
  expect(f.starts).toHaveLength(1);
});

test("concurrent explicit starts reject replacement before journal acknowledgement", async () => {
  const f = fixture();
  const first = f.host.start(f.context, "sample", { prompt: "first" });
  const second = await f.host.start(f.context, "sample", { prompt: "second" });
  expect(second.kind).toBe("rejected");
  expect((await first).kind).toBe("active");
  expect(f.starts).toHaveLength(1);
});

test("session switch fences pending authored import before any dispatch", async () => {
  const f = fixture();
  const pending = f.host.start(
    f.context,
    "./extensions/workflow-graph/test/fixtures/missing-program.ts",
    {},
  );
  f.host.stop();
  await expect(pending).rejects.toThrow();
  expect(f.starts).toEqual([]);
  expect(f.host.status()).toBeUndefined();
});

test("explicit trusted module resume preserves original launch and native identity", async () => {
  const f = fixture(true);
  const first = await f.host.start(f.context, "sample", { prompt: "task" });
  if (first.kind !== "active") throw Error("not active");
  const directory = await mkdtemp(join(tmpdir(), "workflow-module-"));
  try {
    const path = join(directory, "program.ts");
    await writeFile(
      path,
      'export const program={key:"sample",version:1,input:{type:"object",properties:{prompt:{type:"string"}},required:["prompt"]},decide:()=>({kind:"final",result:"restored"})};',
    );
    for (const entry of f.entries)
      if (
        entry !== null &&
        typeof entry === "object" &&
        "customType" in entry &&
        entry.customType === LAUNCH_ENTRY_TYPE &&
        "data" in entry &&
        entry.data !== null &&
        typeof entry.data === "object"
      )
        Reflect.set(entry.data, "key", "./program.ts");
    f.host.stop();
    const restored = createProgramHost(f.runtime, f.registry, () => {});
    const context = { ...f.context, cwd: directory };
    expect((await restored.restore(context))?.kind).toBe("rejected");
    expect((await restored.restore(context, "./program.ts"))?.kind).toBe(
      "final",
    );
    expect(restored.status()?.runId).toBe(first.runId);
    expect(f.starts).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fallback gate uses interactive choice and deterministic fallback only when unavailable", async () => {
  const f = fixture();
  const fallbackProgram: StagedProgram = {
    key: "sample",
    version: 1,
    input: Type.Object({ prompt: Type.String() }),
    decide: ({ answers, answerModes }) =>
      answers.route
        ? {
            kind: "final",
            result: { answer: answers.route, mode: answerModes?.route },
          }
        : {
            kind: "gate",
            id: "route",
            question: "Route?",
            choices: ["proposed", "first"],
            fallback: "proposed",
          },
  };
  const registry = { list: () => ["sample"], get: () => fallbackProgram };
  const selected = createProgramHost(f.runtime, registry, () => {});
  expect(
    await selected.start(
      { ...f.context, ui: { select: async () => "first" } },
      "sample",
      { prompt: "task" },
    ),
  ).toEqual({
    kind: "final",
    result: { answer: "first", mode: "interactive_select" },
  });
  selected.stop();
  const dismissed = createProgramHost(f.runtime, registry, () => {});
  expect(
    await dismissed.start(
      { ...f.context, ui: { select: async () => undefined } },
      "sample",
      { prompt: "task" },
    ),
  ).toEqual({
    kind: "final",
    result: { answer: "proposed", mode: "deterministic" },
  });
  dismissed.stop();
  const rejected = createProgramHost(f.runtime, registry, () => {});
  expect(
    await rejected.start(
      {
        ...f.context,
        ui: {
          select: async () => {
            throw Error("headless");
          },
        },
      },
      "sample",
      { prompt: "task" },
    ),
  ).toEqual({
    kind: "final",
    result: { answer: "proposed", mode: "deterministic" },
  });
});

test("gate without fallback remains durable waiting and is never auto-answered", async () => {
  const f = fixture(true);
  let selections = 0;
  const result = await f.host.start(
    {
      ...f.context,
      ui: {
        select: async () => {
          selections += 1;
          return undefined;
        },
      },
    },
    "sample",
    { prompt: "task" },
  );
  if (result.kind !== "active") throw Error("not active");
  f.complete();
  await f.host.settled(result.runId);
  expect(f.host.status()?.decision?.kind).toBe("gate");
  expect(selections).toBe(0);
});

test("gate fallback must equal listed choice", () => {
  const invalid = {
    kind: "gate" as const,
    id: "route",
    question: "Route?",
    choices: ["one"],
    fallback: "other",
  };
  const program: StagedProgram = {
    key: "sample",
    version: 1,
    input: Type.Object({ prompt: Type.String() }),
    decide: () => invalid,
  };
  const f = fixture();
  const host = createProgramHost(
    f.runtime,
    { list: () => ["sample"], get: () => program },
    () => {},
  );
  return expect(
    host.start(f.context, "sample", { prompt: "task" }),
  ).rejects.toThrow("Invalid staged gate");
});
