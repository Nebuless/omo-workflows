import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import {
  applyCompositionMapping,
  compositionDigest,
  compositionNamespace,
  rfc6901Lookup,
  validateComposition,
  composeStagedPrograms,
} from "../src/execution/index.ts";

describe("composition primitives", () => {
  test("RFC6901 resolves root and escaped keys, rejects malformed escapes", () => {
    const value = { "a/b": { "c~d": 2 } };
    expect(rfc6901Lookup(value, "").value).toEqual(value);
    expect(rfc6901Lookup(value, "/a~1b/c~0d").value).toBe(2);
    expect(rfc6901Lookup(value, "/a~2b").found).toBeFalse();
    expect(rfc6901Lookup(value, "/a~").found).toBeFalse();
  });
  test("maps source final into destination input", () => {
    let nativeCalls = 0;
    const schema = Type.Object(
      { input: Type.String() },
      { additionalProperties: false },
    );
    const result = applyCompositionMapping(
      { final: "done" },
      {},
      [{ source: "/final", destination: "/input" }],
      schema,
    );
    nativeCalls += 0;
    expect(result).toEqual({ input: "done" });
    expect(nativeCalls).toBe(0);
  });
  test("rejects invalid composition before dispatch", () => {
    const nativeCalls = 0;
    expect(() =>
      validateComposition({
        identity: { key: "x", version: 1, digest: "stale" },
        mappings: [],
        nativeNodeCount: 65,
      }),
    ).toThrow();
    expect(nativeCalls).toBe(0);
  });
  test("mapping validates declared source, destination, and schema", () => {
    const schema = Type.Object(
      { result: Type.String() },
      { additionalProperties: false },
    );
    expect(
      applyCompositionMapping(
        { value: "ok" },
        {},
        [{ source: "/value", destination: "/result" }],
        schema,
      ),
    ).toEqual({ result: "ok" });
    expect(() =>
      applyCompositionMapping(
        {},
        {},
        [{ source: "/missing", destination: "/result" }],
        schema,
      ),
    ).toThrow();
    expect(() =>
      applyCompositionMapping(
        { value: null },
        {},
        [{ source: "/value", destination: "/result" }],
        schema,
      ),
    ).toThrow();
    expect(() =>
      applyCompositionMapping(
        { value: 1 },
        {},
        [{ source: "/value", destination: "/result" }],
        schema,
      ),
    ).toThrow();
    for (const token of ["__proto__", "constructor", "prototype", "bad~2"]) {
      expect(() =>
        applyCompositionMapping(
          { value: "ok" },
          {},
          [{ source: "/value", destination: `/${token}` }],
          schema,
        ),
      ).toThrow();
    }
    expect(() =>
      applyCompositionMapping(
        { value: "ok" },
        {},
        [{ source: "/value", destination: "/result~" }],
        schema,
      ),
    ).toThrow();
  });
  test("identity digest detects stale descriptors", () => {
    const identity = { key: "demo", version: 1 };
    const digest = compositionDigest(identity, []);
    expect(
      validateComposition({
        identity: { ...identity, digest },
        mappings: [],
        nativeNodeCount: 64,
      }).identity.digest,
    ).toBe(digest);
    expect(() =>
      validateComposition({
        identity: { ...identity, digest: "stale" },
        mappings: [],
        nativeNodeCount: 65,
      }),
    ).toThrow();
  });
  test("namespace sanitizes keys and rejects malformed or colliding keys", () => {
    expect(compositionNamespace(2, "hello world")).toBe("stage-2-hello-world");
    expect(compositionNamespace(2, "hello/world")).toBe("stage-2-hello-world");
    expect(() => compositionNamespace(-1, "x")).toThrow();
    expect(() => compositionNamespace(1, "\0")).toThrow();
  });
  test("composes three stages with per-transition mappings and gate stop", () => {
    const resultSchema = Type.Object({ value: Type.String() });
    const stage = (key: string) => ({
      key,
      version: 1,
      input: Type.Object({ input: Type.String() }),
      decide: ({
        results,
      }: {
        readonly results: Record<string, Record<string, unknown>>;
        readonly inputs: unknown;
      }) =>
        results.work === undefined
          ? {
              kind: "wave" as const,
              id: "work",
              nodes: [
                {
                  id: "work",
                  prompt: key,
                  subagent_type: "omo-senpi",
                  dependsOn: key === "three" ? ["prior"] : undefined,
                  output: { schema: resultSchema },
                },
              ],
            }
          : { kind: "final" as const, result: { value: "mapped" } },
    });
    const composed = composeStagedPrograms({
      key: "chain",
      version: 1,
      stages: [
        { workflowKey: "one", descriptorDigest: "d1", program: stage("one") },
        { workflowKey: "two", descriptorDigest: "d2", program: stage("two") },
        {
          workflowKey: "three",
          descriptorDigest: "d3",
          program: stage("three"),
        },
      ],
      mappings: [
        [{ source: "/value", destination: "/input" }],
        [{ source: "/value", destination: "/input" }],
      ],
    });
    const first = composed.decide({
      inputs: { input: "start" },
      results: {},
      answers: {},
    });
    expect(first.kind).toBe("wave");
    if (first.kind !== "wave") return;
    expect(first.id).toBe("stage-0-one:work");
    expect(first.nodes[0]?.dependsOn).toBeUndefined();
    const second = composed.decide({
      inputs: { input: "start" },
      results: { "stage-0-one:work": { work: { value: "mapped" } } },
      answers: {},
    });
    expect(second.kind).toBe("gate");
    if (second.kind !== "gate") return;
    expect(second.choices).toEqual(["continue", "stop"]);
    const stopped = composed.decide({
      inputs: { input: "start" },
      results: { "stage-0-one:work": { work: { value: "mapped" } } },
      answers: { [second.id]: "stop" },
    });
    expect(stopped).toEqual({ kind: "final", result: { value: "mapped" } });
  });

  test("composes first stage with stable namespace", () => {
    const program = composeStagedPrograms({
      key: "chain",
      version: 1,
      preapproved: true,
      stages: [
        {
          workflowKey: "one",
          descriptorDigest: "d1",
          program: {
            key: "one",
            version: 1,
            input: Type.Object({ start: Type.String() }),
            decide: () => ({
              kind: "wave",
              id: "work",
              nodes: [
                {
                  id: "work",
                  prompt: "work",
                  subagent_type: "omo-senpi",
                  output: { schema: Type.Object({ ok: Type.Boolean() }) },
                },
              ],
            }),
          },
        },
        {
          workflowKey: "two",
          descriptorDigest: "d2",
          program: {
            key: "two",
            version: 1,
            input: Type.Object({ input: Type.String() }),
            decide: () => ({ kind: "final", result: {} }),
          },
        },
        {
          workflowKey: "three",
          descriptorDigest: "d3",
          program: {
            key: "three",
            version: 1,
            input: Type.Object({ input: Type.String() }),
            decide: () => ({ kind: "final", result: {} }),
          },
        },
      ],
      mappings: [[{ source: "/artifact", destination: "/input" }], []],
    });
    const decision = program.decide({
      inputs: { start: "x" },
      results: {},
      answers: {},
    });
    expect(decision.kind).toBe("wave");
    if (decision.kind === "wave") expect(decision.id).toBe("stage-0-one:work");
  });
});
