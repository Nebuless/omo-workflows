import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { adversarialVerification } from "../src/builtins/index.ts";
import {
  createStagedController,
  type NativeWorkflowTransport,
} from "../src/execution/index.ts";
import { nativeDefinitionFingerprint } from "../src/execution/native-fingerprint.ts";
const route = { category: "general" };
type NativeParams = Parameters<NativeWorkflowTransport["execute"]>[0];
function validateNativeDag(
  definition: Extract<
    NativeParams,
    { action: "start" | "amend" }
  >["definition"],
): void {
  const positions = new Map(
    definition.nodes.map((node, index) => [node.id, index]),
  );
  expect(positions.size).toBe(definition.nodes.length);
  for (const [index, node] of definition.nodes.entries())
    for (const dependency of node.dependsOn ?? []) {
      expect(positions.has(dependency)).toBeTrue();
      const dependencyIndex = positions.get(dependency);
      if (dependencyIndex === undefined)
        throw new Error(`missing dependency ${dependency}`);
      expect(dependencyIndex).toBeLessThan(index);
    }
}
async function runAdversarial(
  inputs: Record<string, unknown>,
  fixture: (id: string, prompt: string) => unknown,
) {
  const root = await mkdtemp(join(tmpdir(), "builtin-adversarial-"));
  const program = adversarialVerification(route, root);
  let definition:
    | Extract<NativeParams, { action: "start" | "amend" }>["definition"]
    | undefined;
  const outputs = new Map<string, string>();
  const actions: string[] = [];
  const prompts = new Map<string, string>();
  const native: NativeWorkflowTransport = {
    async execute(params) {
      actions.push(params.action);
      if (params.action === "start" || params.action === "amend") {
        validateNativeDag(params.definition);
        definition = params.definition;
        for (const node of definition.nodes) {
          prompts.set(node.id, node.prompt);
          if (outputs.has(node.id)) continue;
          const value = fixture(node.id, node.prompt);
          outputs.set(node.id, JSON.stringify(value));
          const path =
            node.id === "criteria"
              ? join(root, "adversarial-verification", "criteria.md")
              : node.prompt.match(
                  /Write (?:complete non-empty artifact|exact JSON matching this schema) exactly to (.+?)(?:\. Do not|; no prose)/s,
                )?.[1];
          if (path !== undefined) {
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
            run_id: "one-native-run",
          },
        };
      }
      if (params.action === "snapshot" && definition !== undefined)
        return {
          content: [],
          details: {
            kind: "snapshot",
            run_id: "one-native-run",
            snapshot: {
              runId: "one-native-run",
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
            run_id: "one-native-run",
            result: {
              runId: "one-native-run",
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
    for (let count = 0; count < 80; count += 1) {
      const decision = await controller.advance();
      if (decision.kind === "final")
        return {
          result: decision.result as Record<string, unknown>,
          checkpoint: controller.checkpoint(),
          prompts,
          actions,
          root,
        };
      if (decision.kind === "rejected") throw new Error(decision.reason);
    }
    throw new Error("adversarial-verification did not terminate");
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
function artifactFixture(id: string): unknown {
  if (
    id.startsWith("record-") &&
    id.includes("verify-0-a_b-1") &&
    !id.includes("reask")
  )
    return { invalid: true, stage: "verify-0-a_b-1" };
  if (id.startsWith("record-"))
    return {
      criterion_id: id.includes("a_b_2") ? "a_b_2" : "a_b",
      score: 20,
      evidence: ["observed"],
      findings: id.includes("verify-0-a_b_2")
        ? [{ finding: "must fix", severity: "veto" }]
        : [],
    };
  throw new Error(`unexpected artifact node ${id}`);
}
test("controller preserves criteria.md semantics, collision-safe IDs, bounded reask, consolidator, repair, and exact artifacts", async () => {
  const criteria =
    "# Rubric\n\n## Ground Truth Note\nOnly observed commands count.\n\n## Criteria\n### A B\nFirst description.\n\n### A-B\nSecond description.\n";
  const normalized =
    "# Verification criteria\n\n## Ground Truth Note\n\nOnly observed commands count.\n\n## Criteria\n\n### A B {#a_b}\n\nFirst description.\n\n### A-B {#a_b_2}\n\nSecond description.\n";
  let malformed = false;
  const run = await runAdversarial(
    {
      task: "verify this",
      verifier_count: 1,
      max_repairs: 1,
      criteria,
      accept_mean: 14,
      reask_limit: 1,
    },
    (id) => {
      if (id === "criteria") return normalized;
      if (id === "worker" || id.startsWith("repair-"))
        return "candidate with command evidence";
      if (id === "verify-0-a_b-1" && !malformed) {
        malformed = true;
        return "not JSON";
      }
      if (id.startsWith("verify-0-") && id.includes("a_b_2"))
        return {
          criterion_id: "a_b_2",
          score: 20,
          evidence: ["observed"],
          findings: [{ finding: "must fix", severity: "veto" }],
        };
      if (id.startsWith("verify-"))
        return {
          criterion_id: id.includes("a_b_2") ? "a_b_2" : "a_b",
          score: 20,
          evidence: ["observed"],
          findings: [],
        };
      if (id === "consolidate-findings-0")
        return { repair_guidance: "fix it", remaining_work: ["must fix"] };
      if (id.startsWith("record-")) return artifactFixture(id);
      if (id === "score-table-0")
        return {
          scores: [
            {
              criterion_id: "a_b",
              score: 20,
              evidence: ["observed"],
              findings: [],
            },
            {
              criterion_id: "a_b_2",
              score: 20,
              evidence: ["observed"],
              findings: [{ finding: "must fix", severity: "veto" }],
            },
          ],
          mean: 20,
          invalidCount: 1,
          decision: {
            kind: "repair",
            mean: 20,
            findings: [{ finding: "must fix", severity: "veto" }],
          },
          usage: null,
        };
      if (id === "review-report-0")
        return { repair_guidance: "fix it", remaining_work: ["must fix"] };
      if (id === "score-table-1")
        return {
          scores: [
            {
              criterion_id: "a_b",
              score: 20,
              evidence: ["observed"],
              findings: [],
            },
            {
              criterion_id: "a_b_2",
              score: 20,
              evidence: ["observed"],
              findings: [],
            },
          ],
          mean: 20,
          invalidCount: 0,
          decision: { kind: "accept", mean: 20 },
          usage: null,
        };
      if (id === "review-report-1")
        return { decision: { kind: "accept", mean: 20 }, remaining_work: [] };
      throw new Error(`unexpected node ${id}`);
    },
  );
  try {
    expect(run.actions.filter((action) => action === "start")).toHaveLength(1);
    expect(run.checkpoint.runId).toBe("one-native-run");
    expect(run.checkpoint.admittedWaves).toContain("verify-0-reask-1");
    expect(run.checkpoint.admittedWaves).toContain("consolidate-findings-0");
    expect(run.checkpoint.admittedWaves).toContain("repair-1-after-0");
    expect(run.result).toMatchObject({
      approved: true,
      mean_score: 20,
      repairs_completed: 1,
      remaining_work: [],
    });
    expect(
      await readFile(
        join(run.root, "adversarial-verification", "criteria.md"),
        "utf8",
      ),
    ).toBe(normalized);
    const criteriaPrompt = run.prompts.get("criteria");
    if (criteriaPrompt === undefined)
      throw new Error("missing criteria prompt");
    expect(
      JSON.parse(
        criteriaPrompt.slice(
          criteriaPrompt.indexOf("\n", criteriaPrompt.indexOf("JSON string")) +
            1,
          criteriaPrompt.indexOf("\n\nWrite complete"),
        ),
      ),
    ).toBe(normalized);
    expect(run.checkpoint.definition?.nodes.map(({ id }) => id)).toContain(
      "verify-0-a_b_2-1",
    );
    expect(run.checkpoint.definition?.nodes.map(({ id }) => id)).not.toContain(
      "record-verify-0-a_b_2-1-reask-1",
    );
    expect(
      JSON.parse(
        await readFile(
          join(
            run.root,
            "adversarial-verification",
            "verification-0-a_b-1.json",
          ),
          "utf8",
        ),
      ),
    ).toEqual({ invalid: true, stage: "verify-0-a_b-1" });
    expect(
      JSON.parse(await readFile(String(run.result.score_table_path), "utf8")),
    ).toEqual({
      scores: [
        {
          criterion_id: "a_b",
          score: 20,
          evidence: ["observed"],
          findings: [],
        },
        {
          criterion_id: "a_b_2",
          score: 20,
          evidence: ["observed"],
          findings: [],
        },
      ],
      mean: 20,
      invalidCount: 0,
      decision: { kind: "accept", mean: 20 },
      usage: null,
    });
    expect(
      JSON.parse(await readFile(String(run.result.review_report_path), "utf8")),
    ).toEqual({ decision: { kind: "accept", mean: 20 }, remaining_work: [] });
    expect(await readFile(String(run.result.candidate_path), "utf8")).toBe(
      "candidate with command evidence",
    );
  } finally {
    await rm(run.root, { recursive: true, force: true });
  }
});
test("empty criteria fail before native dispatch", async () => {
  let called = false;
  let error: unknown;
  try {
    await runAdversarial({ task: "verify", criteria: {} }, () => {
      called = true;
      return "unused";
    });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("criteria is empty");
  expect(called).toBeFalse();
});
test("quorum failure repeats one full round then returns source evidence", async () => {
  const run = await runAdversarial(
    {
      task: "verify",
      verifier_count: 1,
      max_repairs: 2,
      criteria: { fit: "Must fit." },
      reask_limit: 0,
    },
    (id) => {
      if (id === "criteria")
        return "# Verification criteria\n\n## Criteria\n\n### fit {#fit}\n\nMust fit.\n";
      if (id === "worker") return "candidate";
      if (id.startsWith("verify-")) return "bad";
      if (id === "record-verify-0-fit-1")
        return { invalid: true, stage: "verify-0-fit-1" };
      if (id === "record-verify-1-fit-1")
        return { invalid: true, stage: "verify-1-fit-1" };
      if (id === "score-table-0")
        return {
          scores: [],
          mean: 0,
          invalidCount: 1,
          decision: { kind: "indeterminate", missing: 1 },
          usage: null,
        };
      if (id === "review-report-0")
        return {
          decision: { kind: "indeterminate", missing: 1 },
          evidence: [
            "Quorum failure: 1 of 1 criterion scores remain missing after 0 re-ask wave(s); 1 report attempts were invalid or missing.",
          ],
          remaining_work: [
            "Quorum failure: 1 of 1 criterion scores remain missing after 0 re-ask wave(s); 1 report attempts were invalid or missing.",
          ],
        };
      if (id === "score-table-1")
        return {
          scores: [],
          mean: 0,
          invalidCount: 1,
          decision: { kind: "indeterminate", missing: 1 },
          usage: null,
        };
      if (id === "review-report-1")
        return {
          decision: { kind: "indeterminate", missing: 1 },
          evidence: [
            "Quorum failure: 1 of 1 criterion scores remain missing after 0 re-ask wave(s); 1 report attempts were invalid or missing.",
          ],
          remaining_work: [
            "Quorum failure: 1 of 1 criterion scores remain missing after 0 re-ask wave(s); 1 report attempts were invalid or missing.",
          ],
        };
      throw new Error(`unexpected node ${id}`);
    },
  );
  try {
    expect(run.checkpoint.admittedWaves).toContain("verify-1");
    expect(run.result).toMatchObject({
      approved: false,
      repairs_completed: 0,
      score_table_path: join(
        run.root,
        "adversarial-verification",
        "verification-summary-1.json",
      ),
      review_report_path: join(
        run.root,
        "adversarial-verification",
        "review-1.json",
      ),
    });
    expect(run.result.remaining_work).toEqual([
      "Quorum failure: 1 of 1 criterion scores remain missing after 0 re-ask wave(s); 1 report attempts were invalid or missing.",
    ]);
    expect(
      JSON.parse(await readFile(String(run.result.score_table_path), "utf8")),
    ).toEqual({
      scores: [],
      mean: 0,
      invalidCount: 1,
      decision: { kind: "indeterminate", missing: 1 },
      usage: null,
    });
    expect(
      JSON.parse(await readFile(String(run.result.review_report_path), "utf8")),
    ).toEqual({
      decision: { kind: "indeterminate", missing: 1 },
      evidence: run.result.remaining_work,
      remaining_work: run.result.remaining_work,
    });
    expect(await readFile(String(run.result.candidate_path), "utf8")).toBe(
      "candidate",
    );
  } finally {
    await rm(run.root, { recursive: true, force: true });
  }
});
test("controller rejects wrong canonical criteria text before worker admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "builtin-adversarial-exact-"));
  const program = adversarialVerification(route, root);
  let definition:
    | Extract<NativeParams, { action: "start" | "amend" }>["definition"]
    | undefined;
  const criteriaPath = join(root, "adversarial-verification", "criteria.md");
  const native: NativeWorkflowTransport = {
    async execute(params) {
      if (params.action === "start") {
        validateNativeDag(params.definition);
        definition = params.definition;
        await mkdir(dirname(criteriaPath), { recursive: true });
        await writeFile(criteriaPath, "wrong but nonempty\n");
        return {
          content: [],
          details: { kind: "started", run_id: "exact-run" },
        };
      }
      if (params.action === "snapshot" && definition !== undefined)
        return {
          content: [],
          details: {
            kind: "snapshot",
            run_id: "exact-run",
            snapshot: {
              runId: "exact-run",
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
            run_id: "exact-run",
            result: {
              runId: "exact-run",
              status: "completed",
              nodes: Object.fromEntries(
                definition.nodes.map(({ id }) => [
                  id,
                  { state: "completed", output: "done" },
                ]),
              ),
            },
          },
        };
      return {
        content: [],
        details: {
          kind: "error",
          error: { code: "unexpected", message: "unexpected" },
        },
      };
    },
  };
  const controller = createStagedController({
    native,
    program,
    inputs: { task: "verify", criteria: { fit: "Must fit." } },
    journal: { getBranch: () => [], async appendEntry() {} },
    readArtifact: (path) => readFile(path, "utf8"),
  });
  try {
    expect(await controller.advance()).toMatchObject({
      kind: "rejected",
      reason: "Artifact for criteria did not match exact required contents.",
    });
    expect(controller.checkpoint().admittedWaves).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("indeterminate retry does not consume repair budget", () => {
  const root = join(tmpdir(), "adversarial-repair-budget");
  const program = adversarialVerification(route, root);
  const low = {
    criterion_id: "fit",
    score: 1,
    evidence: [],
    findings: [{ finding: "repair this", severity: "blocking" }],
  };
  const decision = program.decide({
    inputs: {
      task: "verify",
      verifier_count: 1,
      max_repairs: 1,
      criteria: { fit: "Must fit." },
      reask_limit: 0,
    },
    answers: {},
    results: {
      criteria: { criteria: `${root}/adversarial-verification/criteria.md` },
      candidate: { worker: `${root}/adversarial-verification/candidate.md` },
      "verify-0": {
        "verify-0-fit-1": { kind: "invalid-output", code: "json" },
      },
      "verification-records-0": { "record-verify-0-fit-1": {} },
      "verification-artifacts-0": {
        "score-table-0": {},
        "review-report-0": {},
      },
      "verify-1": { "verify-1-fit-1": low },
      "verification-records-1": { "record-verify-1-fit-1": low },
      "consolidate-findings-1": {
        "consolidate-findings-1": {
          repair_guidance: "repair",
          remaining_work: ["repair this"],
        },
      },
      "verification-artifacts-1": {
        "score-table-1": {},
        "review-report-1": {},
      },
    },
  });
  expect(decision).toMatchObject({
    kind: "wave",
    id: "repair-1-after-1",
    nodes: [{ id: "repair-1", dependsOn: ["review-report-1"] }],
  });
});
function singleCriterionArtifact(
  id: string,
  scores: readonly number[],
  invalidRound0 = false,
): unknown {
  const round = Number(
    id.match(/(?:verify-|table-|report-)(\d+)/)?.[1] ??
      id.match(/-(\d+)$/)?.[1] ??
      -1,
  );
  const score = scores[round];
  const finding =
    score === 20
      ? []
      : [{ finding: `repair round ${round}`, severity: "blocking" }];
  if (id === "criteria")
    return "# Verification criteria\n\n## Criteria\n\n### fit {#fit}\n\nMust fit.\n";
  if (id === "worker" || id.startsWith("repair-")) return `candidate ${id}`;
  if (id.startsWith("verify-"))
    return invalidRound0 && round === 0
      ? "bad"
      : {
          criterion_id: "fit",
          score,
          evidence: [`round ${round}`],
          findings: finding,
        };
  if (id.startsWith("record-") && invalidRound0 && id.includes("verify-0-"))
    return { invalid: true, stage: "verify-0-fit-1" };
  if (id.startsWith("record-"))
    return {
      criterion_id: "fit",
      score,
      evidence: [`round ${round}`],
      findings: finding,
    };
  if (id.startsWith("consolidate-findings-"))
    return {
      repair_guidance: `repair ${round}`,
      remaining_work: finding.map((item) => item.finding),
    };
  if (id.startsWith("score-table-"))
    return {
      scores:
        invalidRound0 && round === 0
          ? []
          : [
              {
                criterion_id: "fit",
                score,
                evidence: [`round ${round}`],
                findings: finding,
              },
            ],
      mean: invalidRound0 && round === 0 ? 0 : score,
      invalidCount: invalidRound0 && round === 0 ? 1 : 0,
      decision:
        invalidRound0 && round === 0
          ? { kind: "indeterminate", missing: 1 }
          : score === 20
            ? { kind: "accept", mean: 20 }
            : { kind: "repair", mean: score, findings: finding },
      usage: null,
    };
  if (id.startsWith("review-report-") && invalidRound0 && round === 0) {
    const evidence =
      "Quorum failure: 1 of 1 criterion scores remain missing after 0 re-ask wave(s); 1 report attempts were invalid or missing.";
    return {
      decision: { kind: "indeterminate", missing: 1 },
      evidence: [evidence],
      remaining_work: [evidence],
    };
  }
  if (id.startsWith("review-report-") && score === 20)
    return { decision: { kind: "accept", mean: 20 }, remaining_work: [] };
  if (id.startsWith("review-report-"))
    return {
      repair_guidance: `repair ${round}`,
      remaining_work: finding.map((item) => item.finding),
    };
  throw new Error(`unexpected node ${id}`);
}
test("indeterminate retry then repair reaches fresh verification and final round artifacts", async () => {
  const run = await runAdversarial(
    {
      task: "verify",
      verifier_count: 1,
      max_repairs: 1,
      criteria: { fit: "Must fit." },
      reask_limit: 0,
    },
    (id) => singleCriterionArtifact(id, [0, 1, 20], true),
  );
  try {
    expect(run.checkpoint.admittedWaves).toContain("repair-1-after-1");
    expect(run.checkpoint.admittedWaves).toContain("verify-2");
    expect(run.result).toMatchObject({
      approved: true,
      repairs_completed: 1,
      mean_score: 20,
      score_table_path: join(
        run.root,
        "adversarial-verification",
        "verification-summary-2.json",
      ),
      review_report_path: join(
        run.root,
        "adversarial-verification",
        "review-2.json",
      ),
    });
    expect(
      JSON.parse(await readFile(String(run.result.score_table_path), "utf8")),
    ).toMatchObject({ mean: 20, decision: { kind: "accept", mean: 20 } });
  } finally {
    await rm(run.root, { recursive: true, force: true });
  }
});
test("two ordinary repairs each receive a unique wave and fresh verification", async () => {
  const run = await runAdversarial(
    {
      task: "verify",
      verifier_count: 1,
      max_repairs: 2,
      criteria: { fit: "Must fit." },
      reask_limit: 0,
    },
    (id) => singleCriterionArtifact(id, [1, 1, 20]),
  );
  try {
    expect(run.checkpoint.admittedWaves).toContain("repair-1-after-0");
    expect(run.checkpoint.admittedWaves).toContain("verify-1");
    expect(run.checkpoint.admittedWaves).toContain("repair-2-after-1");
    expect(run.checkpoint.admittedWaves).toContain("verify-2");
    const nodes = run.checkpoint.definition?.nodes ?? [];
    expect(new Set(nodes.map(({ id }) => id)).size).toBe(nodes.length);
    expect(run.result).toMatchObject({
      approved: true,
      repairs_completed: 2,
      mean_score: 20,
    });
  } finally {
    await rm(run.root, { recursive: true, force: true });
  }
});
