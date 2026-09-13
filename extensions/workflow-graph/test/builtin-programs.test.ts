import { expect, test } from "bun:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStagedController,
  type NativeWorkflowTransport,
  type StagedProgram,
} from "../src/execution/index.ts";
import { nativeDefinitionFingerprint } from "../src/execution/native-fingerprint.ts";
import {
  adversarialVerification,
  classifyAndAct,
  fanOutAndSynthesize,
  generateAndFilter,
  goal,
  loopUntilDone,
  openClaudeDesign,
  ralph,
  tournament,
} from "../src/builtins/index.ts";
import { sourcePreference } from "../src/builtins/tournament.ts";
const route = { category: "general" };
type Params = Parameters<NativeWorkflowTransport["execute"]>[0];
type Fixture = (id: string, prompt: string, root: string) => unknown;
async function run(
  programFactory: (root: string) => StagedProgram<Record<string, unknown>>,
  inputs: Record<string, unknown>,
  fixture: Fixture,
  answers: Readonly<Record<string, string>> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "atomic-builtins-"));
  const program = programFactory(root);
  let definition:
    | Extract<Params, { action: "start" | "amend" }>["definition"]
    | undefined;
  const outputs = new Map<string, string>();
  const native: NativeWorkflowTransport = {
    async execute(params) {
      if (params.action === "start" || params.action === "amend") {
        definition = params.definition;
        for (const node of definition.nodes) {
          if (outputs.has(node.id)) continue;
          const value =
            node.id === "ledger-initial"
              ? artifactSchemaValue(node.prompt)
              : node.id === "live-config"
                ? `${JSON.stringify({ files: ["preview.html"], insertBefore: "</body>", commentSyntax: "html", cspChecked: true }, null, 2)}\n`
                : fixture(node.id, node.prompt, root);
          outputs.set(node.id, JSON.stringify(value));
          const match = node.prompt.match(
            /Write (?:complete non-empty artifact|exact JSON matching this schema) exactly to (.+?)(?:\. Do not|; no prose)/s,
          );
          const destination =
            node.id === "live-config"
              ? node.prompt.match(/exactly at (.+?) for the generated/s)?.[1]
              : match?.[1];
          if (destination) {
            await mkdir(join(destination, ".."), { recursive: true });
            await writeFile(
              destination,
              typeof value === "string" ? value : JSON.stringify(value),
            );
          }
        }
        return {
          content: [],
          details: {
            kind: params.action === "start" ? "started" : "amended",
            run_id: "run",
          },
        };
      }
      if (params.action === "snapshot") {
        if (!definition) throw new Error("missing definition");
        return {
          content: [],
          details: {
            kind: "snapshot",
            run_id: "run",
            snapshot: {
              runId: "run",
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
      }
      if (params.action === "wait") {
        if (!definition) throw new Error("missing definition");
        return {
          content: [],
          details: {
            kind: "waited",
            run_id: "run",
            result: {
              runId: "run",
              status: "completed",
              nodes: Object.fromEntries(
                definition.nodes.map((node) => [
                  node.id,
                  { state: "completed", output: outputs.get(node.id) },
                ]),
              ),
            },
          },
        };
      }
      return { content: [], details: { kind: "cancelled", run_id: "run" } };
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
        await verifyAdvertisedArtifacts(decision.result, root);
        const value = {
          result: decision.result,
          root,
          checkpoint: controller.checkpoint(),
        };
        return value;
      }
      if (decision.kind === "gate") {
        const answer = answers[decision.id];
        if (!answer) throw new Error(`missing answer ${decision.id}`);
        const next = await controller.answerGate(decision.id, answer);
        if (next.kind === "final") {
          await verifyAdvertisedArtifacts(next.result, root);
          const value = {
            result: next.result,
            root,
            checkpoint: controller.checkpoint(),
          };
          return value;
        }
      }
      if (decision.kind === "rejected") throw new Error(decision.reason);
    }
    throw new Error(`${program.key}: did not terminate`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function verifyAdvertisedArtifacts(
  value: unknown,
  root: string,
): Promise<void> {
  if (typeof value === "string") {
    if (value.startsWith(root) && (await stat(value)).isFile())
      expect((await readFile(value)).length).toBeGreaterThan(0);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) await verifyAdvertisedArtifacts(item, root);
    return;
  }
  if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (key === "design_system") {
        if (typeof item !== "string")
          throw Error("invalid design evidence references");
        for (const path of item.split(", "))
          await verifyAdvertisedArtifacts(path, root);
      } else await verifyAdvertisedArtifacts(item, root);
    }
}
const review = {
  findings: [],
  overall_correctness: "patch is correct",
  overall_explanation: "proved",
  overall_confidence_score: 1,
  requirements_traceability: [],
  stop_review_loop: true,
  reviewer_error: null,
};
function artifactSchemaValue(prompt: string): unknown {
  const match = prompt.match(
    /no prose or markdown fences:\n(\{.*\})\nDo not only return JSON in response\./s,
  );
  if (!match?.[1]) throw Error("Exact artifact schema missing");
  return materialize(JSON.parse(match[1]));
}
function materialize(schema: unknown): unknown {
  if (schema === null || typeof schema !== "object")
    throw Error("Invalid artifact schema");
  if ("const" in schema) return schema.const;
  if ("type" in schema && schema.type === "null") return null;
  if (
    "properties" in schema &&
    schema.properties !== null &&
    typeof schema.properties === "object"
  )
    return Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        materialize(value),
      ]),
    );
  if ("items" in schema && Array.isArray(schema.items))
    return schema.items.map(materialize);
  throw Error("Non-exact artifact schema");
}
function tournamentFixture(id: string, prompt: string): unknown {
  if (id === "comparison-ledger") return artifactSchemaValue(prompt);
  if (id.startsWith("ring-") || id.startsWith("pivot-")) {
    const criterion = /"id":"([^"]+)"/.exec(prompt)?.[1];
    if (!criterion) throw Error("Missing criterion ID");
    return { criterion_id: criterion, score_a: 10, score_b: 10, evidence: [] };
  }
  return "artifact";
}
test("all nine execute through real staged controller with native-shaped file IO", async () => {
  const classify = await run(
    (root) => classifyAndAct(route, root),
    { prompt: "fix" },
    (id) =>
      id === "classifier"
        ? { category: "implementation", confidence: 0.9, rationale: "fit" }
        : id === "classification-report"
          ? {
              proposed_category: "implementation",
              selected_category: "implementation",
              confidence: 0.9,
              threshold: 0.75,
              rationale: "fit",
              fallback_used: false,
              fallback_mode: "none",
            }
          : "action",
  );
  expect(classify.result).toMatchObject({ category: "implementation" });
  const fan = await run(
    (root) => fanOutAndSynthesize(route, root),
    { prompt: "study", max_branches: 2, max_concurrency: 1 },
    (id, _prompt, root) =>
      id === "partition"
        ? {
            task: "study",
            partitions: [
              { label: "a", objective: "one" },
              { label: "b", objective: "two" },
            ],
          }
        : id === "manifest"
          ? {
              task: "study",
              partition_plan: `${root}/fan-out-and-synthesize/partition-plan.json`,
              branches: [
                {
                  label: "a",
                  objective: "one",
                  artifact_path: `${root}/fan-out-and-synthesize/branch-01-a.md`,
                },
                {
                  label: "b",
                  objective: "two",
                  artifact_path: `${root}/fan-out-and-synthesize/branch-02-b.md`,
                },
              ],
            }
          : "artifact",
  );
  expect(fan.checkpoint.admittedWaves).toContain("branches-batch-2");
  expect(
    fan.checkpoint.definition?.nodes.find(({ id }) => id === "manifest")
      ?.dependsOn,
  ).toEqual(["branch-01-a", "branch-02-b"]);
  const verify = await run(
    (root) => adversarialVerification(route, root),
    { task: "verify", verifier_count: 1, criteria: { fit: "fits" } },
    (id) =>
      id === "criteria"
        ? "# Verification criteria\n\n## Criteria\n\n### fit {#fit}\n\nfits\n"
        : id === "worker"
          ? "candidate"
          : id.startsWith("score-table-")
            ? {
                scores: [
                  {
                    criterion_id: "fit",
                    score: 20,
                    evidence: ["test"],
                    findings: [],
                  },
                ],
                mean: 20,
                invalidCount: 0,
                decision: { kind: "accept", mean: 20 },
                usage: null,
              }
            : id.startsWith("review-report-")
              ? { decision: { kind: "accept", mean: 20 }, remaining_work: [] }
              : {
                  criterion_id: "fit",
                  score: 20,
                  evidence: ["test"],
                  findings: [],
                },
  );
  expect(verify.result).toMatchObject({ approved: true });
  const filter = await run(
    (root) => generateAndFilter(route, root),
    {
      prompt: "ideas",
      num_candidates: 2,
      shortlist_size: 1,
      max_concurrency: 1,
    },
    (id, prompt) =>
      id === "manifest"
        ? {
            task: "ideas",
            candidate_artifact_paths: paths(prompt, "candidate_artifact_paths"),
          }
        : id === "dedupe-and-filter"
          ? {
              shortlist: paths(prompt, "candidate_artifact_paths").slice(0, 1),
              discarded: [],
            }
          : id === "judge"
            ? {
                shortlist: paths(prompt, "rank only").slice(0, 1),
                rationale: "best",
              }
            : "artifact",
  );
  expect(filter.checkpoint.admittedWaves).toContain("generate-batch-2");
  const tour = await run(
    (root) => tournament(route, root),
    { prompt: "solve", num_attempts: 2, n_evaluations: 1 },
    tournamentFixture,
  );
  expect(tour.result).toHaveProperty("winner");
  const loop = await run(
    (root) => loopUntilDone(route, root),
    { prompt: "finish", max_iterations: 1 },
    (id, _prompt, root) =>
      id.startsWith("evaluate")
        ? {
            done: true,
            summary: "done",
            new_findings: [],
            failures: [],
            validation_evidence: ["pass"],
            remaining_work: "",
          }
        : id.startsWith("progress")
          ? { scores: [{ checkpoint: 1, score: 20 }] }
          : id.startsWith("ledger-")
            ? loopLedger(
                root,
                "finish",
                true,
                "done",
                [],
                [],
                ["pass"],
                "",
                [20],
              )
            : "artifact",
  );
  expect(loop.result).toMatchObject({ status: "complete" });
  const goalRun = await run(
    (root) => goal(route, root),
    { objective: "ship" },
    (id, prompt) =>
      id.startsWith("review-")
        ? {
            ...review,
            goal_oracle_satisfied: true,
            receipt_assessment: "checked",
            verification_remaining: "",
          }
        : id.startsWith("goal-")
          ? artifactSchemaValue(prompt)
          : "receipt",
  );
  expect(goalRun.result).toMatchObject({ status: "complete" });
  const ralphRun = await run(
    (root) => ralph(route, root),
    { prompt: "build" },
    (id, prompt) =>
      id.startsWith("review-")
        ? review
        : id.startsWith("ralph-")
          ? artifactSchemaValue(prompt)
          : "# Implementation notes\n\nObserved work.",
  );
  expect(ralphRun.result).toMatchObject({ approved: true });
  const design = await run(
    (root) => openClaudeDesign(route, root),
    { prompt: "design", discover_references: false },
    (id, _prompt, root) =>
      id === "intake"
        ? { brief: "design", output_type: "page", references: [] }
        : id === "final-display"
          ? {
              display_method: "manual",
              availability: "unavailable",
              playwright_cli_status: "Command unavailable in fixture",
              spec_path: join(root, "open-claude-design", "spec.html"),
              preview_path: join(root, "open-claude-design", "preview.html"),
              manual_open_instructions: "Open spec_path in browser",
              next_action_hint: "Start new workflow for further changes",
            }
          : "artifact",
    { "approve-live-review": "Skip remaining review rounds and export as-is" },
  );
  expect(design.result).toMatchObject({ live_review: "skipped" });
});

test("defaults run and tournament uses pinned seeded deduplicated schedule", async () => {
  const root = join(tmpdir(), "atomic-default-contract");
  expect(
    classifyAndAct(route, root).decide({
      inputs: { prompt: "fix" },
      results: {},
      answers: {},
    }).kind,
  ).toBe("wave");
  const result = await run(
    (path) => tournament(route, path),
    { prompt: "solve" },
    tournamentFixture,
  );
  expect(result.checkpoint.definition?.nodes).toHaveLength(36);
  expect(
    result.checkpoint.definition?.nodes.filter(({ id }) =>
      id.startsWith("ring-"),
    ),
  ).toHaveLength(24);
  expect(
    result.checkpoint.definition?.nodes.filter(({ id }) =>
      id.startsWith("pivot-"),
    ),
  ).toHaveLength(6);
  expect(result.result).toMatchObject({ winner: "attempt-1", seed: 0 });
});

test("actual controller feeds invalid-output sentinel into bounded tournament reask", async () => {
  let invalidSent = false;
  const result = await run(
    (root) => tournament(route, root),
    { prompt: "solve", num_attempts: 2, n_evaluations: 1 },
    (id, prompt) => {
      if (id.startsWith("ring-") && !id.endsWith("-reask") && !invalidSent) {
        invalidSent = true;
        return "malformed";
      }
      return tournamentFixture(id, prompt);
    },
  );
  expect(
    result.checkpoint.admittedWaves.some((wave) =>
      wave.startsWith("ring-reask-batch-"),
    ),
  ).toBeTrue();
});

test("tournament averages repeated scores before nonlinear soft preference", () => {
  const source = sourcePreference([20, 10], [1, 10]);
  const wrong = (1 / (1 + Math.exp(-1)) + 0.5) / 2;
  expect(source).not.toBe(wrong);
  expect(source).toBeCloseTo(1 / (1 + Math.exp(-0.5)), 12);
});

test("empty partition plan falls back to admitted whole-task branch and exact manifest", async () => {
  const result = await run(
    (root) => fanOutAndSynthesize(route, root),
    { prompt: "whole", max_concurrency: 1 },
    (id, _prompt, root) =>
      id === "partition"
        ? { task: "whole", partitions: [] }
        : id === "partition-fallback"
          ? {
              task: "whole",
              partitions: [{ label: "whole-task", objective: "whole" }],
            }
          : id === "manifest"
            ? {
                task: "whole",
                partition_plan: `${root}/fan-out-and-synthesize/partition-plan.json`,
                branches: [
                  {
                    label: "whole-task",
                    objective: "whole",
                    artifact_path: `${root}/fan-out-and-synthesize/branch-01-whole-task.md`,
                  },
                ],
              }
            : "artifact",
  );
  expect(result.result).toMatchObject({ partitions: ["whole-task"] });
  expect(result.checkpoint.admittedWaves).toContain("partition-fallback");
});

test("manifest admits reordered fields and rejects contrary literal values", () => {
  const root = join(tmpdir(), "atomic-manifest-order");
  const program = fanOutAndSynthesize(route, root);
  const partition = {
    task: "whole",
    partitions: [{ label: "one", objective: "work" }],
  };
  const branches = {
    "branch-01-one": `${root}/fan-out-and-synthesize/branch-01-one.md`,
  };
  const context = {
    inputs: { prompt: "whole" },
    results: { partition: { partition }, "branches-batch-1": branches },
    answers: {},
  };
  const manifest = program.decide(context);
  if (manifest.kind !== "wave") throw new Error("manifest wave missing");
  const reordered = {
    branches: [
      {
        artifact_path: `${root}/fan-out-and-synthesize/branch-01-one.md`,
        objective: "work",
        label: "one",
      },
    ],
    partition_plan: `${root}/fan-out-and-synthesize/partition-plan.json`,
    task: "whole",
  };
  expect(
    program.decide({
      ...context,
      results: { ...context.results, manifest: { manifest: reordered } },
    }).kind,
  ).toBe("wave");
  expect(() =>
    program.decide({
      ...context,
      results: {
        ...context.results,
        manifest: { manifest: { ...reordered, task: "wrong" } },
      },
    }),
  ).toThrow("manifest differs");
});

test("unsupported Goal and Ralph worktree settings reject before dispatch", () => {
  const root = join(tmpdir(), "atomic-unsupported");
  expect(() =>
    goal(route, root).decide({
      inputs: { objective: "ship", git_worktree_dir: "/tmp/worktree" },
      results: {},
      answers: {},
    }),
  ).toThrow("native workflow node schema has no cwd");
  expect(() =>
    ralph(route, root).decide({
      inputs: { prompt: "ship", git_worktree_dir: "/tmp/worktree" },
      results: {},
      answers: {},
    }),
  ).toThrow("native workflow node schema has no cwd");
});

test("default required-file policy rejects filename response without artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-missing-"));
  try {
    const program = loopUntilDone(route, root);
    let definition:
      | Extract<Params, { action: "start" }>["definition"]
      | undefined;
    const native: NativeWorkflowTransport = {
      async execute(params) {
        if (params.action === "start") {
          definition = params.definition;
          return { content: [], details: { kind: "started", run_id: "run" } };
        }
        if (params.action === "snapshot" && definition)
          return {
            content: [],
            details: {
              kind: "snapshot",
              run_id: "run",
              snapshot: {
                runId: "run",
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
        if (params.action === "wait" && definition)
          return {
            content: [],
            details: {
              kind: "waited",
              run_id: "run",
              result: {
                runId: "run",
                status: "completed",
                nodes: Object.fromEntries(
                  definition.nodes.map(({ id }) => [
                    id,
                    { state: "completed", output: "classification.json" },
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
      inputs: { prompt: "fix", max_iterations: 1 },
      journal: { getBranch: () => [], async appendEntry() {} },
      readArtifact: (path) => readFile(path, "utf8"),
    });
    expect(await controller.advance()).toMatchObject({
      kind: "rejected",
      reason: expect.stringContaining("ENOENT"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
function paths(prompt: string, marker: string): string[] {
  const start = prompt.indexOf("[");
  const end = prompt.indexOf("]", start);
  if (
    !prompt.toLowerCase().includes(marker.replaceAll("_", " ").toLowerCase()) &&
    !prompt.includes(marker)
  )
    return [];
  if (start < 0 || end < 0) return [];
  const value: unknown = JSON.parse(prompt.slice(start, end + 1));
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

test("invalid classifier output produces admitted selected-category report", async () => {
  const result = await run(
    (root) => classifyAndAct(route, root),
    { prompt: "choose" },
    (id) =>
      id === "classifier"
        ? "invalid-json"
        : id === "classification-report"
          ? {
              proposed_category: "",
              selected_category: "analysis",
              confidence: 0,
              threshold: 0.75,
              rationale:
                "Classifier did not provide a usable structured rationale.",
              fallback_used: true,
              fallback_mode: "interactive_select",
            }
          : "artifact",
    { "select-category": "analysis" },
  );
  expect(result.result).toMatchObject({ category: "analysis", confidence: 0 });
  expect(result.checkpoint.admittedWaves).toContain("classification-report");
});

test("invalid partition artifact replaced by admitted fallback before branch reads", async () => {
  const result = await run(
    (root) => fanOutAndSynthesize(route, root),
    { prompt: "fallback" },
    (id, _prompt, root) =>
      id === "partition"
        ? "invalid-json"
        : id === "partition-fallback"
          ? {
              task: "fallback",
              partitions: [{ label: "whole-task", objective: "fallback" }],
            }
          : id === "manifest"
            ? {
                task: "fallback",
                partition_plan: `${root}/fan-out-and-synthesize/partition-plan.json`,
                branches: [
                  {
                    label: "whole-task",
                    objective: "fallback",
                    artifact_path: `${root}/fan-out-and-synthesize/branch-01-whole-task.md`,
                  },
                ],
              }
            : "artifact",
  );
  expect(result.checkpoint.admittedWaves).toContain("partition-fallback");
});

test("partial tournament reask batches never reuse admitted wave IDs", async () => {
  let base = 0;
  const result = await run(
    (root) => tournament(route, root),
    { prompt: "solve", num_attempts: 2, n_evaluations: 1 },
    (id, prompt) => {
      if (id.startsWith("ring-") && !id.endsWith("-reask") && ++base % 4 === 1)
        return "malformed";
      return tournamentFixture(id, prompt);
    },
  );
  expect(
    result.checkpoint.admittedWaves.filter((id) =>
      id.startsWith("ring-reask-batch-"),
    ),
  ).toHaveLength(2);
});

test("exhausted loop persists failed ledger rather than active", async () => {
  const result = await run(
    (root) => loopUntilDone(route, root),
    { prompt: "fix", max_iterations: 1, progress_scoring: false },
    (id, _prompt, root) =>
      id === "evaluate-1"
        ? {
            done: false,
            summary: "missing",
            new_findings: [],
            failures: [],
            validation_evidence: [],
            remaining_work: "fix",
          }
        : id === "ledger-1"
          ? loopLedger(root, "fix", false, "missing", [], [], [], "fix", [])
          : "artifact",
  );
  expect(result.result).toMatchObject({ status: "failed" });
});

test("generator manifest rejects fabricated candidate paths through admission", async () => {
  await expect(
    run(
      (root) => generateAndFilter(route, root),
      { prompt: "select", num_candidates: 2, use_judge: false },
      (id, _prompt, root) =>
        id === "manifest"
          ? {
              task: "select",
              candidate_artifact_paths: [`${root}/invented.md`],
            }
          : id === "dedupe-and-filter"
            ? { shortlist: [], discarded: [] }
            : "artifact",
    ),
  ).rejects.toThrow("failed schema validation");
});

test("malformed filter and judge produce admitted fallback decision files", async () => {
  const result = await run(
    (root) => generateAndFilter(route, root),
    { prompt: "select", num_candidates: 2, shortlist_size: 1 },
    (id, _prompt, root) => {
      if (id === "manifest")
        return {
          task: "select",
          candidate_artifact_paths: [
            `${root}/generate-and-filter/candidate-1.md`,
            `${root}/generate-and-filter/candidate-2.md`,
          ],
        };
      if (id === "dedupe-and-filter" || id === "judge") return "malformed";
      if (id === "filter-fallback") return { shortlist: [], discarded: [] };
      if (id === "judge-fallback")
        return {
          shortlist: [],
          rationale: "Judge stage produced no valid structured decision.",
        };
      return "artifact";
    },
  );
  expect(result.result).toMatchObject({
    shortlist: [`${result.root}/generate-and-filter/candidate-1.md`],
  });
  expect(result.checkpoint.admittedWaves).toContain("filter-fallback");
  expect(result.checkpoint.admittedWaves).toContain("judge-fallback");
});

test("loop progress ignores unrequested checkpoints and returns remaining work", async () => {
  const result = await run(
    (root) => loopUntilDone(route, root),
    { prompt: "repair", max_iterations: 1 },
    (id, _prompt, root) =>
      id === "evaluate-1"
        ? {
            done: false,
            summary: "broken",
            new_findings: ["regression"],
            failures: ["check failed"],
            validation_evidence: [],
            remaining_work: "repair check",
          }
        : id.startsWith("progress-")
          ? { scores: [{ checkpoint: 99, score: 20 }] }
          : id === "ledger-1"
            ? loopLedger(
                root,
                "repair",
                false,
                "broken",
                ["regression"],
                ["check failed"],
                [],
                "repair check",
                [],
              )
            : "artifact",
  );
  expect(result.result).toMatchObject({
    status: "failed",
    remaining_work: "repair check",
    progress_curve: [],
    final_trend: "flat",
  });
});

test("invalid monitoring score does not block evaluated completion", async () => {
  const result = await run(
    (root) => loopUntilDone(route, root),
    { prompt: "repair", max_iterations: 1 },
    (id, _prompt, root) =>
      id === "evaluate-1"
        ? {
            done: true,
            summary: "fixed",
            new_findings: [],
            failures: [],
            validation_evidence: ["pass"],
            remaining_work: "",
          }
        : id.startsWith("progress-")
          ? "malformed"
          : id === "ledger-1"
            ? loopLedger(
                root,
                "repair",
                true,
                "fixed",
                [],
                [],
                ["pass"],
                "",
                [],
              )
            : "artifact",
  );
  expect(result.result).toMatchObject({
    status: "complete",
    progress_curve: [],
  });
});

test("loop ledger records evaluator evidence and prior work for next iteration", async () => {
  const program = loopUntilDone(route, join(tmpdir(), "loop-ledger-contract"));
  const evaluation = {
    done: false,
    summary: "build fails",
    new_findings: ["bad import"],
    failures: ["typecheck"],
    validation_evidence: ["exit 1"],
    remaining_work: "repair import",
  };
  const state = {
    inputs: { prompt: "fix", max_iterations: 2, progress_scoring: false },
    results: {
      "ledger-initial": { "ledger-initial": {} },
      "iterate-1": { "iterate-1": "/work/one.md" },
      "evaluate-1": { "evaluate-1": evaluation },
    },
    answers: {},
    external: {},
  };
  const ledger = program.decide(state);
  if (ledger.kind !== "wave") throw Error("missing ledger wave");
  const contract = ledger.nodes[0]?.output;
  if (!contract || !("file" in contract) || !contract.file.schema)
    throw Error("missing ledger artifact schema");
  const EntryContract = Type.Object({
    properties: Type.Object({
      entries: Type.Object({
        items: Type.Array(
          Type.Object({
            properties: Type.Object({
              remaining_work: Type.Object({
                const: Type.Literal("repair import"),
              }),
              failures: Type.Object({
                items: Type.Array(
                  Type.Object({ const: Type.Literal("typecheck") }),
                ),
              }),
            }),
          }),
        ),
      }),
    }),
  });
  expect(Value.Check(EntryContract, contract.file.schema)).toBeTrue();
  const next = program.decide({
    ...state,
    results: { ...state.results, "ledger-1": { "ledger-1": {} } },
  });
  if (next.kind !== "wave") throw Error("missing next iteration");
  expect(next.nodes[0]?.dependsOn).toContain("ledger-1");
});

function loopLedger(
  root: string,
  task: string,
  done: boolean,
  summary: string,
  findings: readonly string[],
  failures: readonly string[],
  evidence: readonly string[],
  remaining: string,
  curve: readonly number[],
) {
  const dir = `${root}/loop-until-done`;
  return {
    task,
    max_iterations: 1,
    status: done ? "complete" : "failed",
    iterations_completed: 1,
    entries: [
      {
        ...(curve.length
          ? {
              progress: {
                score: curve[0],
                perRepeat: [[curve[0]]],
                trend: "flat",
                window: 3,
              },
            }
          : {}),
        iteration: 1,
        artifact_path: `${dir}/iterations/iteration-1.md`,
        evaluation_artifact_path: `${dir}/evaluations/evaluation-1.json`,
        summary,
        findings,
        failures,
        validation_evidence: evidence,
        done,
        remaining_work: remaining,
      },
    ],
    progress_curve: curve,
    final_trend: "flat",
    progress_disclaimer:
      "Progress scores are a monitoring signal; VOC separation +0.079; never authoritative.",
  };
}

test("classification report records selected category and fallback provenance", () => {
  const program = classifyAndAct(route, join(tmpdir(), "class-report"));
  const pending = program.decide({
    inputs: { prompt: "fix" },
    results: {
      classify: {
        classifier: {
          category: "implementation",
          confidence: 0.6,
          rationale: "uncertain",
        },
      },
    },
    answers: {},
  });
  expect(pending).toMatchObject({ kind: "gate", fallback: "implementation" });
  const report = program.decide({
    inputs: { prompt: "fix" },
    results: {
      classify: {
        classifier: {
          category: "implementation",
          confidence: 0.6,
          rationale: "uncertain",
        },
      },
    },
    answers: { "select-category": "research" },
  });
  expect(report.kind).toBe("wave");
  if (report.kind !== "wave") throw Error("report missing");
  expect(report.id).toBe("classification-report");
  const schema = report.nodes[0]?.output;
  if (!schema || !("file" in schema)) throw Error("report must be file");
  const expected = Type.Object({
    properties: Type.Object({
      proposed_category: Type.Object({ const: Type.Literal("implementation") }),
      selected_category: Type.Object({ const: Type.Literal("research") }),
      fallback_used: Type.Object({ const: Type.Literal(true) }),
    }),
  });
  expect(Value.Check(expected, schema.file.schema)).toBeTrue();
});

test("loop repeated checkpoint scores average before trend reporting", () => {
  const program = loopUntilDone(route, join(tmpdir(), "loop-trend"));
  const results: Record<string, Record<string, unknown>> = {
    "ledger-initial": { "ledger-initial": {} },
  };
  for (let i = 1; i <= 4; i += 1) {
    results[`iterate-${i}`] = { [`iterate-${i}`]: "artifact" };
    results[`evaluate-${i}`] = {
      [`evaluate-${i}`]: {
        done: i === 4,
        summary: "observed",
        new_findings: [],
        failures: [],
        validation_evidence: ["pass"],
        remaining_work: "",
      },
    };
    results[`ledger-${i}`] = { [`ledger-${i}`]: {} };
    results[`progress-${i}`] = {
      [`progress-${i}-repeat-1`]: { scores: [{ checkpoint: i, score: i * 2 }] },
      [`progress-${i}-repeat-2`]: {
        scores: [{ checkpoint: i, score: i * 2 + 2 }],
      },
    };
  }
  results.complete = { complete: "artifact" };
  expect(
    program.decide({
      inputs: { prompt: "fix", max_iterations: 4, progress_repeats: 2 },
      results,
      answers: {},
    }),
  ).toMatchObject({
    kind: "final",
    result: { progress_curve: [3, 5, 7, 9], final_trend: "rising" },
  });
});

test("classification artifact cannot forge recorded gate answer provenance", () => {
  const program = classifyAndAct(route, "/tmp/classifier-provenance");
  const state = {
    inputs: { prompt: "pick" },
    results: {
      classify: {
        classifier: {
          category: "analysis",
          confidence: 0.5,
          rationale: "uncertain",
        },
      },
    },
    answers: { "select-category": "analysis" },
  };
  for (const mode of ["interactive_select", "deterministic"] as const) {
    const decision = program.decide({
      ...state,
      answerModes: { "select-category": mode },
    });
    if (decision.kind !== "wave")
      throw new Error("classification report missing");
    const contract = decision.nodes[0]?.output;
    if (!contract || !("file" in contract) || !contract.file.schema)
      throw new Error("report schema missing");
    const report = {
      proposed_category: "analysis",
      selected_category: "analysis",
      confidence: 0.5,
      threshold: 0.75,
      rationale: "uncertain",
      fallback_used: true,
      fallback_mode: mode,
    };
    expect(Value.Check(contract.file.schema, report)).toBe(true);
    expect(
      Value.Check(contract.file.schema, {
        ...report,
        fallback_mode:
          mode === "deterministic" ? "interactive_select" : "deterministic",
      }),
    ).toBe(false);
  }
});

test("fanout normalizes valid partition labels and drops blank entries before branch admission", async () => {
  const result = await run(
    (root) => fanOutAndSynthesize(route, root),
    { prompt: "study", max_branches: 1 },
    (id, _prompt, root) =>
      id === "partition"
        ? {
            task: "study",
            partitions: [
              { label: "   ", objective: "discard" },
              { label: "  Résumé  ", objective: "  inspect  " },
              { label: "extra", objective: "ignore" },
            ],
          }
        : id === "partition-normalized"
          ? {
              task: "study",
              partitions: [{ label: "Résumé", objective: "inspect" }],
            }
          : id === "manifest"
            ? {
                task: "study",
                partition_plan: `${root}/fan-out-and-synthesize/partition-plan.json`,
                branches: [
                  {
                    label: "Résumé",
                    objective: "inspect",
                    artifact_path: `${root}/fan-out-and-synthesize/branch-01-r-sum.md`,
                  },
                ],
              }
            : "artifact",
  );
  expect(result.result).toMatchObject({ partitions: ["Résumé"] });
  expect(
    result.checkpoint.definition?.nodes.find(
      ({ id }) => id === "branch-01-r-sum",
    )?.dependsOn,
  ).toEqual(["partition-normalized"]);
});
test("classifier preserves source fallback filename for categories without ASCII letters", () => {
  const decision = classifyAndAct(route, "/tmp/category-path").decide({
    inputs: { prompt: "choose", categories: ["研究"] },
    results: {
      classify: {
        classifier: { category: "研究", confidence: 0.9, rationale: "fit" },
      },
      "classification-report": { "classification-report": {} },
    },
    answers: {},
  });
  expect(decision).toMatchObject({
    kind: "wave",
    nodes: [
      {
        id: "action-fallback",
        output: {
          file: {
            path: "/tmp/category-path/classify-and-act/action-fallback.md",
          },
        },
      },
    ],
  });
});

test("loop admits initial active ledger before first work", () => {
  const first = loopUntilDone(route, "/tmp/loop-initial").decide({
    inputs: { prompt: "fix", max_iterations: 2 },
    results: {},
    answers: {},
  });
  expect(first.kind).toBe("wave");
  if (first.kind !== "wave") throw Error("missing initial ledger");
  const contract = first.nodes[0]?.output;
  if (!contract || !("file" in contract) || !contract.file.schema)
    throw Error("missing ledger schema");
  expect(materialize(contract.file.schema)).toMatchObject({
    status: "active",
    iterations_completed: 0,
    entries: [],
    progress_curve: [],
  });
});

test("loop ledger preserves valid and invalid repeat evidence", () => {
  const decision = loopUntilDone(route, "/tmp/loop-repeat").decide({
    inputs: { prompt: "fix", max_iterations: 1, progress_repeats: 3 },
    answers: {},
    results: {
      "ledger-initial": { "ledger-initial": {} },
      "iterate-1": { "iterate-1": "artifact" },
      "evaluate-1": {
        "evaluate-1": {
          done: true,
          summary: "fixed",
          new_findings: [],
          failures: [],
          validation_evidence: [],
          remaining_work: "",
        },
      },
      "progress-1": {
        "progress-1-repeat-1": { scores: [{ checkpoint: 1, score: 4 }] },
        "progress-1-repeat-2": { kind: "invalid-output", code: "json" },
        "progress-1-repeat-3": { scores: [{ checkpoint: 1, score: 8 }] },
      },
    },
  });
  if (decision.kind !== "wave") throw Error("missing ledger");
  const contract = decision.nodes[0]?.output;
  if (!contract || !("file" in contract) || !contract.file.schema)
    throw Error("missing ledger schema");
  expect(materialize(contract.file.schema)).toMatchObject({
    entries: [
      {
        progress: {
          score: 6,
          perRepeat: [[4], [null], [8]],
          trend: "flat",
          window: 3,
        },
      },
    ],
  });
});
