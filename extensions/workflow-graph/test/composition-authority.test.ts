import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { commandFixture } from "./authoring-command-fixture.ts";
import { expect, test } from "bun:test";
import { Type } from "typebox";
import { composeStagedPrograms } from "../src/execution/composed.ts";
import { applyCompositionMapping } from "../src/execution/composition.ts";
import { createStagedController } from "../src/execution/controller.ts";
import type { ProgramContext, StagedProgram } from "../src/execution/policy.ts";

const stages = ["one", "two"].map((key) => ({
  workflowKey: key,
  descriptorDigest: key,
  program: {
    key,
    version: 1,
    input: Type.Object({}),
    decide: ({ answers }: ProgramContext) =>
      answers.approval === "continue"
        ? { kind: "final", result: {} }
        : {
            kind: "gate",
            id: "approval",
            question: "Approve?",
            choices: ["continue", "stop"],
          },
  } satisfies StagedProgram,
}));

test("keeps second child approval pending when first child approval is persisted", async () => {
  // Given: two stages share local gate ID; real controller persists answers.
  const program = composeStagedPrograms({
    key: "chain",
    version: 1,
    stages,
    mappings: [[]],
    preapproved: true,
  });
  const entries: { readonly customType: string; readonly data: unknown }[] = [];
  const launch = () =>
    createStagedController({
      program,
      inputs: {},
      journal: {
        getBranch: () => entries,
        appendEntry: async (customType, data) => {
          entries.push({ customType, data: structuredClone(data) });
        },
      },
      native: {
        execute: async () => {
          throw new Error("Unexpected native dispatch");
        },
      },
      readArtifact: async () => "",
    });
  const controller = launch();
  const first = await controller.advance();
  assert(first.kind === "gate");
  // When: first approval is acknowledged then controller restored.
  await controller.answerGate(first.id, "continue");
  const second = await launch().advance();
  // Then: second approval needs its own answer, not first stage's consent.
  expect(first.id).toBe("stage-0-one:approval");
  expect(second).toMatchObject({ kind: "gate", id: "stage-1-two:approval" });
});

test("preserves isolated child decision context when stage data share local keys", () => {
  // Given: prior stage is final; destination receives only its namespaced context.
  const destination: StagedProgram = {
    key: "two",
    version: 1,
    input: Type.Object({}),
    decide: (context) => ({ kind: "final", result: context }),
  };
  const program = composeStagedPrograms({
    key: "chain",
    version: 1,
    preapproved: true,
    mappings: [[]],
    stages: [
      {
        workflowKey: "one",
        descriptorDigest: "one",
        program: {
          ...destination,
          key: "one",
          decide: () => ({ kind: "final", result: {} }),
        },
      },
      { workflowKey: "two", descriptorDigest: "two", program: destination },
    ],
  });
  // When: composer evaluates destination.
  const result = program.decide({
    inputs: {},
    answers: {
      "stage-0-one:approval": "stop",
      "stage-1-two:approval": "continue",
      "compose-chain-0": "continue",
    },
    answerModes: {
      "stage-0-one:approval": "deterministic",
      "stage-1-two:approval": "interactive_select",
    },
    external: {
      "stage-0-one:event": "foreign",
      "stage-1-two:event": { accepted: true },
    },
    results: {
      "stage-0-one:work": { "stage-0-one:node": "foreign" },
      "stage-1-two:work": { "stage-1-two:node": 7 },
    },
  });
  // Then: all context fields survive with local keys; neighboring state stays private.
  expect(result).toEqual({
    kind: "final",
    result: {
      inputs: {},
      answers: { approval: "continue" },
      answerModes: { approval: "interactive_select" },
      external: { event: { accepted: true } },
      results: { work: { node: 7 } },
    },
  });
});

for (const mode of [
  "duplicate",
  "fractional-version",
  "missing-transition",
] as const) {
  test(`rejects invalid production composition when plan has ${mode}`, () => {
    // Given: malformed production plan, not direct validation helper invocation.
    const mappings =
      mode === "duplicate"
        ? [
            [
              { source: "/a", destination: "/input" },
              { source: "/b", destination: "/input" },
            ],
          ]
        : mode === "missing-transition"
          ? []
          : [[]];
    // When / Then: constructor rejects before any child decision or dispatch.
    expect(() =>
      composeStagedPrograms({
        key: "chain",
        version: mode === "fractional-version" ? 1.5 : 1,
        stages,
        mappings,
      }),
    ).toThrow();
  });
}

for (const count of [64, 65]) {
  test(`enforces native node ceiling when production composed wave has ${count} nodes`, () => {
    // Given: child program declares one wave at native node-count boundary.
    const child: StagedProgram = {
      key: "one",
      version: 1,
      input: Type.Object({}),
      decide: () => ({
        kind: "wave",
        id: "work",
        nodes: Array.from({ length: count }, (_, index) => ({
          id: `node-${index}`,
          prompt: "work",
          subagent_type: "omo-senpi",
          output: { schema: Type.Object({}) },
        })),
      }),
    };
    const program = composeStagedPrograms({
      key: "chain",
      version: 1,
      mappings: [[]],
      stages: [
        { workflowKey: "one", descriptorDigest: "one", program: child },
        {
          workflowKey: "two",
          descriptorDigest: "two",
          program: { ...child, key: "two" },
        },
      ],
    });
    // When / Then: production decision permits 64, rejects 65 before native dispatch.
    const decide = () =>
      program.decide({ inputs: {}, results: {}, answers: {} });
    if (count === 64) expect(decide().kind).toBe("wave");
    else expect(decide).toThrow();
  });
}

test("maps nested escaped pointers when destination containers are absent", () => {
  // Given: mapping needs nested object and array containers.
  const schema = Type.Object({
    "a/b": Type.Object({
      "c~d": Type.Array(Type.Object({ path: Type.String() })),
    }),
  });
  // When: shared mapping builds destination input.
  const result = applyCompositionMapping(
    { report: "copied" },
    {},
    [{ source: "/report", destination: "/a~1b/c~0d/0/path" }],
    schema,
  );
  // Then: RFC6901 escaping and numeric array index resolve exactly.
  expect(result).toEqual({ "a/b": { "c~d": [{ path: "copied" }] } });
});

test("preserves nested destination input when mapping fills another field", () => {
  // Given: caller-owned nested input.
  const input = { nested: { keep: "original" } };
  // When: mapping fills sibling field.
  const result = applyCompositionMapping(
    { value: "mapped" },
    input,
    [{ source: "/value", destination: "/nested/next" }],
    Type.Object({
      nested: Type.Object({ keep: Type.String(), next: Type.String() }),
    }),
  );
  // Then: returned input contains both; caller input untouched.
  expect(result).toEqual({ nested: { keep: "original", next: "mapped" } });
  expect(input).toEqual({ nested: { keep: "original" } });
});

test("requires separate child gate answers when composed workflow runs through slash command", async () => {
  // Given: actual registered command, trusted module loader, native Senpi UI context.
  await using f = await commandFixture();
  const composer = new URL("../src/execution/composed.ts", import.meta.url)
    .pathname;
  await mkdir(join(f.cwd, ".omo/workflows"), { recursive: true });
  await writeFile(
    join(f.cwd, ".omo/workflows/chain.ts"),
    `import {composeStagedPrograms} from ${JSON.stringify(composer)};
    const stages=["one","two"].map(key=>({workflowKey:key,descriptorDigest:key,program:{key,version:1,input:{type:"object"},
      decide:({answers})=>answers.approval==="continue"?{kind:"final",result:{accepted:key}}:
      {kind:"gate",id:"approval",question:"Approve?",choices:["continue","stop"]}}}));
    export const program=composeStagedPrograms({key:"chain",version:1,stages,mappings:[[]],preapproved:true});`,
  );
  await f.call("chain {}");
  f.script.keys = ["\r"];
  // When: user answers first gate through real selector event handler.
  await f.call("answer");
  // Then: public status exposes second gate, not completed chain.
  await f.call("status");
  const status: unknown = JSON.parse(f.notices.at(-1)?.message ?? "null");
  assert(typeof status === "object" && status !== null && "decision" in status);
  expect(status.decision).toMatchObject({
    kind: "gate",
    id: "stage-1-two:approval",
  });
});

for (const pointer of [
  "/safe/__proto__/polluted",
  "/safe/constructor/x",
  "/safe/prototype/x",
  "/safe/bad~2/x",
  "/safe/bad~/x",
]) {
  test(`rejects nested unsafe or malformed destination when pointer is ${pointer}`, () => {
    // Given: untrusted destination contains invalid nested token.
    // When / Then: no prototype traversal or invalid escape admitted.
    expect(() =>
      applyCompositionMapping(
        { value: 1 },
        {},
        [{ source: "/value", destination: pointer }],
        Type.Unknown(),
      ),
    ).toThrow();
  });
}
