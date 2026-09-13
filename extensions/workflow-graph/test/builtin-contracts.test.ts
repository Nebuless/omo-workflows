import { expect, test } from "bun:test";
import {
  parseBuiltinInput,
  parseClassification,
  parseEvaluation,
  parseReview,
  parseVerifierReport,
} from "../src/builtins/schemas.ts";
import {
  decideAdversarialVerification,
  decideClassifyAndAct,
  decideFanOutAndSynthesize,
  decideGenerateAndFilter,
  decideGoal,
  decideLoopUntilDone,
  decideOpenClaudeDesign,
  decideRalph,
  rankTournament,
} from "../src/builtins/reducers.ts";

test("builtin inputs reject blank and out-of-bound source values", () => {
  expect(
    parseBuiltinInput("classify-and-act", { prompt: " " }),
  ).toBeUndefined();
  expect(
    parseBuiltinInput("fan-out-and-synthesize", {
      prompt: "x",
      max_branches: 13,
    }),
  ).toBeUndefined();
  expect(
    parseBuiltinInput("adversarial-verification", {
      task: "x",
      verifier_count: 0,
    }),
  ).toBeUndefined();
  expect(
    parseBuiltinInput("generate-and-filter", {
      prompt: "x",
      num_candidates: 1,
    }),
  ).toBeUndefined();
  expect(
    parseBuiltinInput("tournament", { prompt: "x", num_attempts: 9 }),
  ).toBeUndefined();
  expect(
    parseBuiltinInput("loop-until-done", { prompt: "x", max_iterations: 21 }),
  ).toBeUndefined();
  expect(
    parseBuiltinInput("goal", { objective: "x", max_turns: 0 }),
  ).toBeUndefined();
  expect(
    parseBuiltinInput("ralph", { prompt: "x", max_loops: 0 }),
  ).toBeUndefined();
  expect(
    parseBuiltinInput("open-claude-design", { prompt: " " }),
  ).toBeUndefined();
});

test("goal and ralph preserve source ten-turn inputs", () => {
  expect(parseBuiltinInput("goal", { objective: "x" })?.max_turns).toBe(10);
  expect(parseBuiltinInput("ralph", { prompt: "x" })?.max_loops).toBe(10);
  expect(
    parseBuiltinInput("goal", { objective: "x", max_turns: 10 })?.max_turns,
  ).toBe(10);
  expect(
    parseBuiltinInput("ralph", { prompt: "x", max_loops: 10 })?.max_loops,
  ).toBe(10);
});

test("classify-and-act preserves exact category and low-confidence fallback", () => {
  expect(parseBuiltinInput("classify-and-act", { prompt: "x" })).toEqual({
    prompt: "x",
    categories: ["analysis", "implementation", "research"],
    confidence_threshold: 0.75,
  });
  const low = parseClassification({
    category: "implementation",
    confidence: 0.74,
    rationale: "uncertain",
  });
  expect(low).toBeDefined();
  if (low === undefined) throw new Error("classification fixture invalid");
  expect(decideClassifyAndAct(low, ["implementation"], 0.75)).toEqual({
    stage: "select-category",
    proposed_category: "implementation",
  });
});

test("fan-out indexes duplicate labels, falls back whole-task, and carries manifest barrier", () => {
  expect(
    decideFanOutAndSynthesize(undefined, "task", 4, 4, "/artifacts", []),
  ).toEqual({
    stage: "branches",
    frontier: ["01-whole-task"],
    branches: [
      {
        id: "01-whole-task",
        label: "whole-task",
        objective: "task",
        artifact_path: "/artifacts/branch-01-whole-task.md",
      },
    ],
  });
  const plan = {
    partitions: [
      { label: "same", objective: "one" },
      { label: "same", objective: "two" },
    ],
  };
  const first = decideFanOutAndSynthesize(plan, "task", 2, 2, "/artifacts", [
    "01-same",
  ]);
  expect(first).toEqual({
    stage: "branches",
    frontier: ["02-same"],
    branches: [
      {
        id: "01-same",
        label: "same",
        objective: "one",
        artifact_path: "/artifacts/branch-01-same.md",
      },
      {
        id: "02-same",
        label: "same",
        objective: "two",
        artifact_path: "/artifacts/branch-02-same.md",
      },
    ],
  });
  expect(
    decideFanOutAndSynthesize(plan, "task", 2, 2, "/artifacts", [
      "01-same",
      "02-same",
    ]),
  ).toEqual({
    stage: "synthesize",
    manifest: {
      task: "task",
      partition_plan: "/artifacts/partition-plan.json",
      branches: [
        {
          label: "same",
          objective: "one",
          artifact_path: "/artifacts/branch-01-same.md",
        },
        {
          label: "same",
          objective: "two",
          artifact_path: "/artifacts/branch-02-same.md",
        },
      ],
    },
  });
});

test("adversarial-verification requires full quorum, veto beats mean, repairs bounded", () => {
  const good = parseVerifierReport({
    criterion_id: "fit",
    score: 20,
    evidence: [],
    findings: [],
  });
  const veto = parseVerifierReport({
    criterion_id: "fit",
    score: 20,
    evidence: [],
    findings: [{ finding: "bad", severity: "veto" }],
  });
  expect(good).toBeDefined();
  expect(veto).toBeDefined();
  if (good === undefined || veto === undefined)
    throw new Error("verifier fixture invalid");
  expect(decideAdversarialVerification([good], 2, 14, 0, 1, 0, 2)).toEqual({
    stage: "reask",
    wave: 1,
    missing: 1,
  });
  expect(
    decideAdversarialVerification([veto, good], 2, 14, 1, 1, 2, 2),
  ).toEqual({ stage: "reject", mean_score: 20 });
});

test("generate-and-filter admits only source candidate paths and judge fallback", () => {
  expect(
    decideGenerateAndFilter(
      ["a", "b", "c"],
      ["b", "b", "gone"],
      ["gone"],
      2,
      true,
    ),
  ).toEqual({ shortlist: ["b"], decision_path: "judge" });
});

test("tournament ranks Atomic weights by stable entrant index", () => {
  expect(
    rankTournament(
      [7, 7, 8],
      [10, 10, 10],
      ["attempt-2", "attempt-1", "attempt-3"],
    ),
  ).toEqual(["attempt-3", "attempt-2", "attempt-1"]);
});

test("loop-until-done stops only parsed evaluator done or iteration bound", () => {
  const decision = parseEvaluation({
    done: false,
    summary: "x",
    new_findings: [],
    failures: [],
    validation_evidence: [],
    remaining_work: "more",
  });
  expect(decision).toBeDefined();
  if (decision === undefined) throw new Error("evaluation fixture invalid");
  expect(decideLoopUntilDone(decision, 3, 3)).toEqual({ stage: "failed" });
});

test("goal requires parsed reviewer decisions, configurable quorum, consecutive normalized blockers", () => {
  const complete = parseReview({
    decision: "complete",
    parsed: true,
    stop_review_loop: true,
  });
  const blocked = parseReview({
    decision: "blocked",
    parsed: true,
    stop_review_loop: false,
    blocker: "Missing   test",
  });
  expect(complete).toBeDefined();
  expect(blocked).toBeDefined();
  if (complete === undefined || blocked === undefined)
    throw new Error("review fixture invalid");
  expect(decideGoal([complete], 1, 10, 1, 3, [], false)).toEqual({
    stage: "complete",
    create_pr: false,
  });
  expect(
    decideGoal(
      [blocked],
      3,
      10,
      2,
      3,
      [
        { turn: 1, blocker: "missing test" },
        { turn: 2, blocker: "other" },
      ],
      true,
    ),
  ).toEqual({ stage: "continue" });
  expect(
    decideGoal(
      [blocked],
      3,
      10,
      2,
      3,
      [
        { turn: 1, blocker: "missing test" },
        { turn: 2, blocker: "missing test" },
      ],
      true,
    ),
  ).toEqual({ stage: "blocked", blocker: "Missing   test" });
});

test("ralph requires both parsed approvals and stops at bound", () => {
  const yes = parseReview({
    decision: "complete",
    parsed: true,
    stop_review_loop: true,
  });
  const no = parseReview({
    decision: "continue",
    parsed: true,
    stop_review_loop: false,
  });
  expect(yes).toBeDefined();
  expect(no).toBeDefined();
  if (yes === undefined || no === undefined)
    throw new Error("review fixture invalid");
  expect(decideRalph([yes, no], 2, 2, false)).toEqual({ stage: "failed" });
});

test("open-claude-design exports only skip or helper exit", () => {
  expect(decideOpenClaudeDesign("Start live review", "timeout")).toEqual({
    stage: "live-review",
  });
  expect(decideOpenClaudeDesign("Start live review", "exit")).toEqual({
    stage: "export",
  });
});
