import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { tournament } from "../src/builtins/index.ts";
import {
  createStagedController,
  type NativeWorkflowTransport,
} from "../src/execution/index.ts";
import { nativeDefinitionFingerprint } from "../src/execution/native-fingerprint.ts";

const route = { subagent_type: "general" };
type NativeParams = Parameters<NativeWorkflowTransport["execute"]>[0];
type Definition = Extract<
  NativeParams,
  { action: "start" | "amend" }
>["definition"];
const CriterionSchema = Type.Object(
  { id: Type.String(), name: Type.String(), description: Type.String() },
  { additionalProperties: false },
);
const ComparisonSchema = Type.Object(
  {
    a: Type.Integer(),
    b: Type.Integer(),
    phase: Type.Union([Type.Literal("ring"), Type.Literal("pivot")]),
    criterion_id: Type.String(),
    rep: Type.Integer(),
    swapped: Type.Boolean(),
    score_a: Type.Optional(Type.Number()),
    score_b: Type.Optional(Type.Number()),
    p_ab: Type.Optional(Type.Number()),
    invalid: Type.Optional(Type.Literal(true)),
    judge_artifact_path: Type.String(),
  },
  { additionalProperties: false },
);
const PairSchema = Type.Object(
  {
    a: Type.Integer(),
    b: Type.Integer(),
    phase: Type.Union([Type.Literal("ring"), Type.Literal("pivot")]),
    valid_reports: Type.Integer(),
    mean_score_a: Type.Optional(Type.Number()),
    mean_score_b: Type.Optional(Type.Number()),
    p_ab: Type.Number(),
    invalid: Type.Optional(Type.Literal(true)),
  },
  { additionalProperties: false },
);
const RankingSchema = Type.Object(
  {
    label: Type.String(),
    index: Type.Integer(),
    meanPreference: Type.Number(),
  },
  { additionalProperties: false },
);
const LedgerSchema = Type.Object(
  {
    task: Type.String(),
    seed: Type.Integer(),
    params: Type.Object(
      {
        n: Type.Integer(),
        pivots: Type.Integer(),
        n_evaluations: Type.Integer(),
        criteria: Type.Array(CriterionSchema),
      },
      { additionalProperties: false },
    ),
    comparisons: Type.Array(ComparisonSchema),
    pairs: Type.Array(PairSchema),
    w: Type.Array(Type.Number()),
    c: Type.Array(Type.Number()),
    ranking: Type.Array(RankingSchema),
    budget: Type.Object(
      { planned: Type.Integer(), executed: Type.Integer() },
      { additionalProperties: false },
    ),
    model_assignment: Type.Optional(Type.Record(Type.String(), Type.String())),
  },
  { additionalProperties: false },
);
const ResultSchema = Type.Object(
  {
    result: Type.String(),
    winner: Type.String(),
    winner_artifact_path: Type.String(),
    result_path: Type.String(),
    attempt_artifact_paths: Type.Array(Type.String()),
    judge_artifact_paths: Type.Array(Type.String()),
    comparisons_path: Type.String(),
    ranking: Type.Array(
      Type.Object(
        { label: Type.String(), meanPreference: Type.Number() },
        { additionalProperties: false },
      ),
    ),
    seed: Type.Integer(),
    artifact_dir: Type.String(),
  },
  { additionalProperties: false },
);
type Ledger = Static<typeof LedgerSchema>;
type Fixture = (id: string, prompt: string, invocation: number) => unknown;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function materialize(schema: unknown): unknown {
  if (!object(schema)) throw new Error("fixture schema must be object");
  if (Object.hasOwn(schema, "const")) return schema.const;
  if (schema.type === "object" && object(schema.properties))
    return Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        materialize(value),
      ]),
    );
  if (schema.type === "array" && Array.isArray(schema.items))
    return schema.items.map(materialize);
  throw new Error(`unsupported fixture schema ${JSON.stringify(schema)}`);
}
function ledgerFromPrompt(prompt: string): unknown {
  const marker = "Write exact JSON matching this schema exactly to ";
  const start = prompt.indexOf(marker);
  const schemaStart = prompt.indexOf("\n", start) + 1;
  const schemaEnd = prompt.indexOf("\nDo not only return JSON", schemaStart);
  if (start < 0 || schemaStart === 0 || schemaEnd < 0)
    throw new Error("ledger schema absent");
  return materialize(JSON.parse(prompt.slice(schemaStart, schemaEnd)));
}
function pathFromPrompt(prompt: string): string {
  const match =
    /Write (?:complete non-empty artifact|exact JSON matching this schema) exactly to (.+?)(?:\. Do not|; no prose)/s.exec(
      prompt,
    );
  if (match === null || match[1] === undefined)
    throw new Error("artifact path absent");
  return match[1];
}
function validateNativeDag(definition: Definition): void {
  const positions = new Map(
    definition.nodes.map((node, index) => [node.id, index]),
  );
  expect(positions.size).toBe(definition.nodes.length);
  expect(definition.nodes.length).toBeLessThanOrEqual(64);
  for (const [index, node] of definition.nodes.entries())
    for (const dependency of node.dependsOn ?? []) {
      expect(dependency).not.toBe(node.id);
      expect(positions.has(dependency)).toBeTrue();
      expect(positions.get(dependency)).toBeLessThan(index);
    }
}
function score(id: string, prompt: string): unknown {
  const match = /^(?:ring|pivot)-(\d+)-(\d+)-c\d+-(\d+)(?:-reask)?$/.exec(id);
  if (match === null) throw new Error(`bad judge id ${id}`);
  const a = Number(match[1]) - 1;
  const b = Number(match[2]) - 1;
  const rep = Number(match[3]) - 1;
  const criterion = /"id":"([^"]+)"/.exec(prompt)?.[1];
  if (criterion === undefined) throw new Error("criterion absent");
  const value = (candidate: number) => 20 - candidate * 3;
  const slot1 = rep % 2 === 1 ? b : a;
  const slot2 = rep % 2 === 1 ? a : b;
  return {
    criterion_id: criterion,
    score_a: value(slot1),
    score_b: value(slot2),
    evidence: [`compared ${a}:${b}`],
  };
}
async function runTournament(
  inputs: Record<string, unknown>,
  fixture: Fixture,
) {
  const root = await mkdtemp(join(tmpdir(), "builtin-tournament-"));
  const program = tournament(route, root);
  let definition: Definition | undefined;
  let priorSize = 0;
  const outputs = new Map<string, string>();
  const invocations = new Map<string, number>();
  const waveSizes: number[] = [];
  const native: NativeWorkflowTransport = {
    async execute(params) {
      if (params.action === "start" || params.action === "amend") {
        validateNativeDag(params.definition);
        definition = params.definition;
        waveSizes.push(definition.nodes.length - priorSize);
        priorSize = definition.nodes.length;
        for (const node of definition.nodes)
          if (!outputs.has(node.id)) {
            const invocation = (invocations.get(node.id) ?? 0) + 1;
            invocations.set(node.id, invocation);
            const value = fixture(node.id, node.prompt, invocation);
            outputs.set(
              node.id,
              typeof value === "string" ? value : JSON.stringify(value),
            );
            if (node.prompt.includes("Write ")) {
              const path = pathFromPrompt(node.prompt);
              await mkdir(dirname(path), { recursive: true });
              await writeFile(
                path,
                typeof value === "string" ? value : JSON.stringify(value),
              );
            }
          }
        return {
          content: [],
          details: {
            kind: params.action === "start" ? "started" : "amended",
            run_id: "tournament-run",
          },
        };
      }
      if (params.action === "snapshot" && definition !== undefined)
        return {
          content: [],
          details: {
            kind: "snapshot",
            run_id: "tournament-run",
            snapshot: {
              runId: "tournament-run",
              runKey: program.key,
              status: "completed",
              nodes: definition.nodes.map(({ id }) => ({
                id,
                state: "completed",
              })),
              definitionFingerprint: nativeDefinitionFingerprint(definition),
            },
          },
        };
      if (params.action === "wait" && definition !== undefined)
        return {
          content: [],
          details: {
            kind: "waited",
            run_id: "tournament-run",
            result: {
              runId: "tournament-run",
              status: "completed",
              nodes: Object.fromEntries(
                definition.nodes.map(({ id }) => [
                  id,
                  { state: "completed", output: outputs.get(id) },
                ]),
              ),
            },
          },
        };
      return {
        content: [],
        details: {
          kind: "error",
          error: { code: "unexpected", message: "unexpected native call" },
        },
      };
    },
  };
  const entries: unknown[] = [];
  const controller = createStagedController({
    native,
    program,
    inputs,
    journal: {
      getBranch: () => entries,
      async appendEntry(customType, data) {
        entries.push({ customType, data: structuredClone(data) });
      },
    },
    readArtifact: (path) => readFile(path, "utf8"),
  });
  try {
    for (let count = 0; count < 100; count += 1) {
      const decision = await controller.advance();
      if (decision.kind === "final") {
        if (!Value.Check(ResultSchema, decision.result))
          throw new Error("invalid tournament result");
        return {
          result: decision.result,
          checkpoint: controller.checkpoint(),
          root,
          waveSizes,
        };
      }
      if (decision.kind === "rejected") throw new Error(decision.reason);
    }
    throw new Error("tournament did not terminate");
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
function normalFixture(id: string, prompt: string): unknown {
  if (id.startsWith("attempt-")) return `body ${id}`;
  if (/^(ring|pivot)-/.test(id)) return score(id, prompt);
  if (id === "comparison-ledger") return ledgerFromPrompt(prompt);
  if (id === "reduce") return "faithful reducer text";
  throw new Error(`unexpected node ${id}`);
}
function readLedger(value: string): Promise<Ledger> {
  return readFile(value, "utf8").then((text) => {
    const parsed: unknown = JSON.parse(text);
    if (!Value.Check(LedgerSchema, parsed)) throw new Error("invalid ledger");
    return parsed;
  });
}

function independentlyRank(ledger: Ledger) {
  const weights = Array.from({ length: ledger.params.n }, () => 0);
  const counts = Array.from({ length: ledger.params.n }, () => 0);
  for (const pair of ledger.pairs) {
    weights[pair.a] += pair.p_ab;
    counts[pair.a] += 1;
    weights[pair.b] += 1 - pair.p_ab;
    counts[pair.b] += 1;
  }
  return weights
    .map((weight, index) => ({
      label: `attempt-${index + 1}`,
      index,
      meanPreference: counts[index] === 0 ? 0 : weight / counts[index],
    }))
    .sort((a, b) => b.meanPreference - a.meanPreference || a.index - b.index);
}

test("default controller run has 36 native nodes, exact source defaults, artifacts, ledger math, and compact reducer reference", async () => {
  const run = await runTournament({ prompt: "rank" }, normalFixture);
  try {
    expect(run.checkpoint.definition?.nodes).toHaveLength(36);
    expect(run.result.result).toBe(run.result.result_path);
    expect(await readFile(run.result.result_path, "utf8")).toBe(
      "faithful reducer text",
    );
    const ledger = await readLedger(run.result.comparisons_path);
    expect(ledger.params.criteria).toEqual([
      {
        id: "correctness",
        name: "Correctness",
        description: "Satisfies the task without material errors.",
      },
      {
        id: "completeness",
        name: "Completeness",
        description: "Covers required outcomes and important edge cases.",
      },
      {
        id: "evidence_and_task_fit",
        name: "Evidence and task fit",
        description:
          "Supports claims with observable evidence or checks and is directly usable without irrelevant work.",
      },
    ]);
    expect(ledger.budget.planned).toBe(42);
    expect(ledger.comparisons).toHaveLength(30);
    expect(run.result.judge_artifact_paths).toHaveLength(30);
    expect(new Set(run.result.judge_artifact_paths).size).toBe(30);
    for (const path of [
      ...run.result.attempt_artifact_paths,
      ...run.result.judge_artifact_paths,
    ])
      expect((await readFile(path, "utf8")).length).toBeGreaterThan(0);
    for (const pair of ledger.pairs) {
      const rows = ledger.comparisons.filter(
        (row) =>
          row.phase === pair.phase &&
          row.a === pair.a &&
          row.b === pair.b &&
          row.invalid !== true,
      );
      const scoresA = rows.flatMap((row) =>
        row.score_a === undefined ? [] : [row.score_a],
      );
      const scoresB = rows.flatMap((row) =>
        row.score_b === undefined ? [] : [row.score_b],
      );
      const meanA =
        scoresA.reduce((sum, value) => sum + value, 0) / scoresA.length;
      const meanB =
        scoresB.reduce((sum, value) => sum + value, 0) / scoresB.length;
      expect(pair.p_ab).toBeCloseTo(
        1 / (1 + Math.exp(-((meanA - meanB) / 19))),
        12,
      );
    }
    const ranking = independentlyRank(ledger);
    expect(ledger.ranking).toEqual(ranking);
    expect(run.result.ranking).toEqual(
      ranking.map(({ label, meanPreference }) => ({ label, meanPreference })),
    );
  } finally {
    await rm(run.root, { recursive: true, force: true });
  }
});

test("criteria variants and models route attempts round-robin", async () => {
  const variants: unknown[] = [
    "## Criteria\n### Quality {#quality}\nCorrect.",
    { Quality: "Correct." },
    ["Correct."],
    [{ description: "Correct." }],
    [{ id: "quality", name: "Quality", description: "Correct." }],
  ];
  for (const criteria of variants) {
    const run = await runTournament(
      {
        prompt: "rank",
        num_attempts: 2,
        n_evaluations: 1,
        pivots: 1,
        criteria,
      },
      normalFixture,
    );
    try {
      expect(
        (await readLedger(run.result.comparisons_path)).params.criteria,
      ).toHaveLength(1);
    } finally {
      await rm(run.root, { recursive: true, force: true });
    }
  }
  const run = await runTournament(
    {
      prompt: "rank",
      num_attempts: 3,
      max_concurrency: 2,
      n_evaluations: 1,
      pivots: 1,
      criteria: { quality: "Correct." },
      models: ["model-a", "model-b"],
    },
    normalFixture,
  );
  try {
    const attempts =
      run.checkpoint.definition?.nodes.filter(({ id }) =>
        id.startsWith("attempt-"),
      ) ?? [];
    expect(attempts.map(({ model }) => model)).toEqual([
      "model-a",
      "model-b",
      "model-a",
    ]);
    expect(run.waveSizes.every((size) => size <= 2)).toBeTrue();
    expect(
      (await readLedger(run.result.comparisons_path)).model_assignment,
    ).toEqual({
      "attempt-1": "model-a",
      "attempt-2": "model-b",
      "attempt-3": "model-a",
    });
  } finally {
    await rm(run.root, { recursive: true, force: true });
  }
});

test("wrong criterion and partial invalid batch get one unique retry each", async () => {
  let first = "";
  let second = "";
  const run = await runTournament(
    {
      prompt: "rank",
      num_attempts: 3,
      max_concurrency: 2,
      n_evaluations: 1,
      pivots: 1,
      criteria: { quality: "Correct." },
    },
    (id, prompt) => {
      if (
        id.startsWith("attempt-") ||
        id === "comparison-ledger" ||
        id === "reduce"
      )
        return normalFixture(id, prompt);
      if (!id.endsWith("-reask") && first === "") {
        first = id;
        return { criterion_id: "wrong", score_a: 20, score_b: 1, evidence: [] };
      }
      if (!id.endsWith("-reask") && second === "" && id !== first) {
        second = id;
        return "malformed";
      }
      return score(id, prompt);
    },
  );
  try {
    const ids = run.checkpoint.definition?.nodes.map(({ id }) => id) ?? [];
    expect(ids.filter((id) => id === `${first}-reask`)).toHaveLength(1);
    expect(ids.filter((id) => id === `${second}-reask`)).toHaveLength(1);
    const retryWaves = run.checkpoint.admittedWaves.filter((id) =>
      id.includes("reask-batch-"),
    );
    expect(new Set(retryWaves).size).toBe(retryWaves.length);
  } finally {
    await rm(run.root, { recursive: true, force: true });
  }
});

test("twice-invalid judge persists sentinel and contributes neutral invalid pair", async () => {
  let target = "";
  const run = await runTournament(
    {
      prompt: "rank",
      num_attempts: 2,
      max_concurrency: 1,
      n_evaluations: 1,
      pivots: 1,
      criteria: { quality: "Correct." },
    },
    (id, prompt) => {
      if (
        id.startsWith("attempt-") ||
        id === "comparison-ledger" ||
        id === "reduce"
      )
        return normalFixture(id, prompt);
      if (id.endsWith("invalid-artifact")) return { invalid: true };
      if (target === "") target = id;
      if (id === target || id === `${target}-reask`) return "malformed";
      return score(id, prompt);
    },
  );
  try {
    const ledger = await readLedger(run.result.comparisons_path);
    expect(ledger.comparisons.some((row) => row.invalid === true)).toBeTrue();
    expect(
      ledger.pairs.some(
        (pair) =>
          pair.invalid === true &&
          pair.valid_reports === 0 &&
          pair.p_ab === 0.5,
      ),
    ).toBeTrue();
    expect(
      JSON.parse(
        await readFile(
          ledger.comparisons.find((row) => row.invalid === true)
            ?.judge_artifact_path ?? "",
          "utf8",
        ),
      ),
    ).toEqual({ invalid: true });
  } finally {
    await rm(run.root, { recursive: true, force: true });
  }
});
