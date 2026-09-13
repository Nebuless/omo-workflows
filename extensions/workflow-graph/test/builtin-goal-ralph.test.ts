import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { goal, ralph } from "../src/builtins/index.ts";
import {
  createStagedController,
  type NativeWorkflowTransport,
  type StagedProgram,
} from "../src/execution/index.ts";
import { nativeDefinitionFingerprint } from "../src/execution/native-fingerprint.ts";
import type { AuthoredWorkflow } from "../src/execution/policy.ts";

const senpiGoalRalphRoute = { category: "general" };
const senpiGoalReview = {
  findings: [],
  overall_correctness: "patch is correct",
  overall_explanation: "proved",
  overall_confidence_score: 1,
  goal_oracle_satisfied: true,
  requirements_traceability: [
    { requirement: "ship", status: "proven", evidence: "check passed" },
  ],
  receipt_assessment: "receipt verified",
  verification_remaining: "",
  stop_review_loop: true,
  reviewer_error: null,
};
const senpiRalphReview = {
  findings: [],
  overall_correctness: "patch is correct",
  overall_explanation: "proved",
  overall_confidence_score: 1,
  requirements_traceability: [
    { requirement: "build", status: "proven", evidence: "check passed" },
  ],
  stop_review_loop: true,
  reviewer_error: null,
};

async function senpiRun(
  factory: (root: string) => StagedProgram<Record<string, unknown>>,
  inputs: Record<string, unknown>,
  fixture: (id: string, prompt: string, root: string) => unknown,
) {
  const root = await mkdtemp(join(tmpdir(), "goal-ralph-"));
  const program = factory(root);
  let definition: AuthoredWorkflow | undefined;
  const outputs = new Map<string, string>();
  const calls: string[] = [];
  const native: NativeWorkflowTransport = {
    async execute(params) {
      calls.push(params.action);
      if (params.action === "start" || params.action === "amend") {
        definition = params.definition;
        for (const node of definition.nodes) {
          if (outputs.has(node.id)) continue;
          const exactSchema = node.prompt.match(
            /no prose or markdown fences:\n(\{.*\})\nDo not only return JSON in response\./s,
          )?.[1];
          const schema = exactSchema
            ? (JSON.parse(exactSchema) as { const?: unknown })
            : undefined;
          const value =
            schema && Object.hasOwn(schema, "const")
              ? schema.const
              : fixture(node.id, node.prompt, root);
          outputs.set(node.id, JSON.stringify(value));
          const path = node.prompt.match(
            /exactly to (.+?)(?:\. Do not|; no prose)/s,
          )?.[1];
          if (path) {
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
            run_id: "run",
          },
        };
      }
      if (!definition) throw new Error("missing definition");
      if (params.action === "snapshot")
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
      if (params.action === "wait")
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
                  { state: "completed", output: outputs.get(id) },
                ]),
              ),
            },
          },
        };
      return { content: [], details: { kind: "cancelled", run_id: "run" } };
    },
  };
  const controller = createStagedController({
    native,
    program,
    inputs,
    journal: { getBranch: () => [], async appendEntry() {} },
    readArtifact: (path) => readFile(path, "utf8"),
  });
  try {
    for (let index = 0; index < 80; index += 1) {
      const decision = await controller.advance();
      if (decision.kind === "final") {
        const artifacts = new Map<string, unknown>();
        for (const node of definition?.nodes ?? []) {
          const path = node.prompt.match(
            /exactly to (.+?)(?:\. Do not|; no prose)/s,
          )?.[1];
          if (path) artifacts.set(path, await readFile(path, "utf8"));
        }
        return {
          result: decision.result as Record<string, unknown>,
          checkpoint: controller.checkpoint(),
          calls,
          artifacts,
        };
      }
      if (decision.kind === "rejected") throw new Error(decision.reason);
    }
    throw new Error("workflow did not terminate");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Goal persists admitted receipts and observed reviewer payloads before deterministic approval", async () => {
  const run = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    {
      objective: "ship",
      acceptance_criteria: "ship",
      base_branch: "release/x",
      max_turns: 1,
    },
    (id, _prompt, _root) => {
      if (id.startsWith("review-1-")) return senpiGoalReview;
      return "receipt";
    },
  );
  expect(run.result).toMatchObject({
    status: "complete",
    approved: true,
    receipts: [{ stage: "orchestrator-1" }],
  });
  expect(run.result).not.toHaveProperty("create_pr");
  expect(run.checkpoint.definition?.nodes.length).toBeGreaterThanOrEqual(9);
});

test("Ralph requires unanimous observed reviews and runs opt-in PR only after approval", async () => {
  const run = await senpiRun(
    (root) => ralph(senpiGoalRalphRoute, root),
    {
      prompt: "build",
      acceptance_criteria: "build",
      base_branch: "release/x",
      create_pr: true,
      max_loops: 1,
    },
    (id, _prompt, _root) => {
      if (id.startsWith("review-1-")) return senpiRalphReview;
      return id === "pull-request"
        ? { pr_report: "https://example.invalid/pr/1" }
        : "artifact";
    },
  );
  expect(run.result).toMatchObject({
    approved: true,
    iterations_completed: 1,
    pr_report: "https://example.invalid/pr/1",
  });
  expect(run.checkpoint.admittedWaves.at(-1)).toBe("ralph-pull-request-1");
});

test("native limits reject unsupported worktree cwd and oversized cumulative definitions", () => {
  expect(() =>
    goal(senpiGoalRalphRoute, "/tmp/contracts").decide({
      inputs: { objective: "ship", git_worktree_dir: "/tmp/worktree" },
      results: {},
      answers: {},
    }),
  ).toThrow("native workflow node schema has no cwd");
  const full = Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => [
      `past-${index}`,
      { [`node-${index}`]: true },
    ]),
  );
  expect(() =>
    ralph(senpiGoalRalphRoute, "/tmp/contracts").decide({
      inputs: { prompt: "ship", max_loops: 1 },
      results: full,
      answers: {},
    }),
  ).toThrow("64-node definition limit");
});

const senpiContinueGoal = {
  ...senpiGoalReview,
  overall_correctness: "patch is incorrect",
  overall_explanation: "gap",
  goal_oracle_satisfied: false,
  requirements_traceability: [
    { requirement: "ship", status: "missing", evidence: "not found" },
  ],
  verification_remaining: "implement gap",
  stop_review_loop: false,
};
const senpiContinueRalph = {
  ...senpiRalphReview,
  overall_correctness: "patch is incorrect",
  overall_explanation: "gap",
  requirements_traceability: [
    { requirement: "build", status: "missing", evidence: "not found" },
  ],
  stop_review_loop: false,
};
const senpiFinding = {
  title: "[P2] Missing check",
  body: "check absent",
  confidence_score: 0.5,
  objective_alignment: "consistent_with_objective",
  priority: 2,
  code_location: {
    absolute_file_path: "/repo/src.ts",
    line_range: { start: 1, end: 1 },
  },
};

test("Goal applies two-of-three quorum but one vote exhausts to needs_human", async () => {
  const two = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    { objective: "ship", max_turns: 1 },
    (id) =>
      id === "review-1-risk"
        ? senpiContinueGoal
        : id.startsWith("review-1-")
          ? senpiGoalReview
          : "artifact",
  );
  expect(two.result).toMatchObject({ status: "complete", approved: true });
  const one = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    { objective: "ship", max_turns: 1 },
    (id) =>
      id === "review-1-contract"
        ? senpiGoalReview
        : id.startsWith("review-1-")
          ? senpiContinueGoal
          : "artifact",
  );
  expect(one.result).toMatchObject({
    status: "needs_human",
    approved: false,
    remaining_work: expect.stringContaining("implement gap"),
  });
});

test("Ralph non-unanimous review admits next loop with exact prior artifact paths", async () => {
  let nextPrompt = "";
  const run = await senpiRun(
    (root) => ralph(senpiGoalRalphRoute, root),
    { prompt: "build", max_loops: 2 },
    (id, prompt, root) => {
      if (id === "plan-2") {
        nextPrompt = prompt;
        return "second plan";
      }
      if (id === "review-1-validation") return senpiContinueRalph;
      if (id.startsWith("review-")) return senpiRalphReview;
      return `artifact ${root}`;
    },
  );
  expect(run.result).toMatchObject({ approved: true, iterations_completed: 2 });
  expect(nextPrompt).toContain(
    `${[...run.artifacts.keys()].find((path) => path.endsWith("review-round-1.json"))}`,
  );
});

test("Goal repeated dependency blocker terminates after bounded consecutive observations", async () => {
  const blocked = {
    ...senpiContinueGoal,
    reviewer_error: {
      kind: "dependency_unavailable",
      message: "Registry unavailable",
      attempted_recovery: "retried",
    },
  };
  const run = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    { objective: "ship", max_turns: 3 },
    (id) => (id.startsWith("review-") ? blocked : "artifact"),
  );
  expect(run.result).toMatchObject({
    status: "blocked",
    turns_completed: 3,
    remaining_work: "Registry unavailable",
  });
  expect(run.checkpoint.admittedWaves).toContain("goal-artifacts-2");
});

test("malformed reviewer is admitted as parsed-false failure and cannot approve", async () => {
  const run = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    { objective: "ship", max_turns: 1 },
    (id) =>
      id === "review-1-contract"
        ? "malformed"
        : id.startsWith("review-1-")
          ? senpiContinueGoal
          : "artifact",
  );
  expect(run.result).toMatchObject({ status: "needs_human", approved: false });
  const round = JSON.parse(
    [...run.artifacts.entries()].find(([path]) =>
      path.endsWith("review-round-1.json"),
    )?.[1] as string,
  );
  expect(
    round.reviews.find(
      ({ reviewer }: { reviewer: string }) => reviewer === "contract",
    ),
  ).toMatchObject({
    parsed: false,
    approved: false,
    reviewer_error: { kind: "reviewer_failure" },
  });
});

test("duplicate findings consolidate and low-confidence singleton re-verification records demotion", async () => {
  const duplicate = { ...senpiGoalReview, findings: [senpiFinding] };
  const singleton = {
    ...senpiGoalReview,
    findings: [
      {
        ...senpiFinding,
        title: "Single weak claim",
        code_location: {
          ...senpiFinding.code_location,
          absolute_file_path: "/repo/other.ts",
        },
      },
    ],
  };
  const run = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    { objective: "ship", max_turns: 1 },
    (id) => {
      if (id === "review-1-contract" || id === "review-1-evidence")
        return duplicate;
      if (id === "review-1-risk") return singleton;
      if (id.startsWith("reverify-1-"))
        return { score: 2, evidence: ["not reproducible"] };
      return "artifact";
    },
  );
  const round = JSON.parse(
    [...run.artifacts.entries()].find(([path]) =>
      path.endsWith("review-round-1.json"),
    )?.[1] as string,
  );
  expect(round.consolidated_findings).toHaveLength(2);
  expect(
    round.consolidated_findings.find(
      ({ finding }: { finding: { title: string } }) =>
        finding.title.includes("Missing check"),
    ).reviewers,
  ).toEqual(["contract", "evidence"]);
  expect(round.reverification).toMatchObject([
    { verdict: "demoted", perRepeat: [2, 2, 2] },
  ]);
});

test("individual reverification sends full payload and retries one invalid repeat", async () => {
  const weak = { ...senpiContinueGoal, findings: [senpiFinding] };
  const observedFindings: unknown[] = [];
  const run = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    { objective: "ship", max_turns: 1 },
    (id, prompt) => {
      if (id === "review-1-contract") return weak;
      if (id.startsWith("review-1-")) return senpiContinueGoal;
      if (id === "reverify-1-1-1") return "invalid";
      if (id.startsWith("reverify-")) {
        const payload = prompt.match(
          /Finding payload: (\{.*?\})\. Reviewers:/,
        )?.[1];
        if (payload) observedFindings.push(JSON.parse(payload));
        return { score: 8, evidence: ["observed"] };
      }
      return "artifact";
    },
  );
  expect(run.checkpoint.admittedWaves).toContain("reverify-reask-1");
  expect(observedFindings).toContainEqual(senpiFinding);
  const round = JSON.parse(
    [...run.artifacts.entries()].find(([path]) =>
      path.endsWith("review-round-1.json"),
    )?.[1] as string,
  );
  expect(round.reverification[0]).toMatchObject({
    verdict: "demoted",
    perRepeat: [8, 8, 8],
  });
});

test("required findings need all three scores below six; invalid doubt stays confirmed", async () => {
  const required = {
    ...senpiFinding,
    objective_alignment: "required_by_objective",
  };
  const review = { ...senpiContinueGoal, findings: [required] };
  let invalid = false;
  const run = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    { objective: "ship", max_turns: 1 },
    (id) => {
      if (id === "review-1-contract") return review;
      if (id.startsWith("review-1-")) return senpiContinueGoal;
      if (id === "reverify-1-1-3" || id === "reverify-1-1-3-reask") {
        invalid = true;
        return "bad";
      }
      if (id.startsWith("reverify-")) return { score: 1, evidence: [] };
      return "artifact";
    },
  );
  expect(invalid).toBeTrue();
  const round = JSON.parse(
    [...run.artifacts.entries()].find(([path]) =>
      path.endsWith("review-round-1.json"),
    )?.[1] as string,
  );
  expect(round.reverification[0]).toMatchObject({
    verdict: "confirmed",
    perRepeat: [1, 1, null],
  });
  expect(round.consolidated_findings[0].blocking).toBeTrue();
});

test("Goal terminal ledger is independently comprehensive", async () => {
  const run = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    { objective: "ship", max_turns: 1 },
    (id) => (id.startsWith("review-") ? senpiGoalReview : "artifact"),
  );
  const ledger = JSON.parse(
    [...run.artifacts.entries()].find(([path]) =>
      path.endsWith("goal-ledger.json"),
    )?.[1] as string,
  );
  expect(ledger).toMatchObject({
    objective: "ship",
    status: "complete",
    turns: 1,
    receipts: [{ turn: 1 }],
    decisions: [{ complete_votes: 3, review_quorum: 2 }],
    convergence: [{ unresolvedBlockingCount: 0 }],
  });
  expect(ledger.goal_id).toMatch(/^[a-f0-9]{24}$/);
  expect(ledger.reviews).toHaveLength(3);
  expect(ledger.lifecycle.map(({ event }: { event: string }) => event)).toEqual(
    [
      "work_turn_started",
      "receipt_recorded",
      "reviews_recorded",
      "status_decided",
    ],
  );
});

test("Goal accumulates prior audits and omits convergence for all-unparsed rounds", async () => {
  const weak = { ...senpiContinueGoal, findings: [senpiFinding] };
  const accumulated = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    { objective: "ship", max_turns: 2 },
    (id) => {
      if (id === "review-1-contract" || id === "review-2-contract") return weak;
      if (id.startsWith("review-")) return senpiContinueGoal;
      if (id.startsWith("reverify-"))
        return { score: 2, evidence: ["checked"] };
      return "artifact";
    },
  );
  const ledger = JSON.parse(
    [...accumulated.artifacts.entries()].find(([path]) =>
      path.endsWith("goal-ledger.json"),
    )?.[1] as string,
  );
  expect(ledger.reverification).toHaveLength(2);
  expect(
    ledger.reverification.map(({ verdict }: { verdict: string }) => verdict),
  ).toEqual(["demoted", "demoted"]);

  const unparsed = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    { objective: "ship", max_turns: 1 },
    (id) => (id.startsWith("review-") ? "malformed" : "artifact"),
  );
  const unparsedLedger = JSON.parse(
    [...unparsed.artifacts.entries()].find(([path]) =>
      path.endsWith("goal-ledger.json"),
    )?.[1] as string,
  );
  expect(unparsedLedger.convergence).toEqual([]);
  expect(unparsedLedger.decisions[0]).toMatchObject({
    nextAction: "needs_human",
    parsed: false,
  });
});

test("Goal metadata uses blocked nextAction and PR traceability for final-action remaining", async () => {
  const blocked = {
    ...senpiContinueGoal,
    reviewer_error: {
      kind: "dependency_unavailable",
      message: "Registry unavailable",
      attempted_recovery: "retried",
    },
  };
  const run = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    { objective: "ship", max_turns: 3 },
    (id) => (id.startsWith("review-") ? blocked : "artifact"),
  );
  const ledger = JSON.parse(
    [...run.artifacts.entries()].find(([path]) =>
      path.endsWith("goal-ledger.json"),
    )?.[1] as string,
  );
  expect(ledger.decisions.at(-1)).toMatchObject({ nextAction: "blocked" });

  const approvedNoPrGap = await senpiRun(
    (root) => goal(senpiGoalRalphRoute, root),
    { objective: "ship", max_turns: 1, create_pr: true },
    (id) =>
      id.startsWith("review-")
        ? senpiGoalReview
        : id === "pull-request"
          ? { pr_report: "handoff" }
          : "artifact",
  );
  const reviewPath = [...approvedNoPrGap.artifacts.keys()].find((path) =>
    path.endsWith("review-1-contract.json"),
  );
  const review = JSON.parse(
    approvedNoPrGap.artifacts.get(reviewPath ?? "") as string,
  );
  expect(review.convergence_decision).toMatchObject({
    nextAction: "finish",
    finalActionRemaining: false,
  });
});

test("real staged controller rejects next wave when cumulative DAG reaches 64 nodes", async () => {
  await expect(
    senpiRun(
      (root) => goal(senpiGoalRalphRoute, root),
      { objective: "ship", max_turns: 10 },
      (id) => (id.startsWith("review-") ? senpiContinueGoal : "artifact"),
    ),
  ).rejects.toThrow(
    "native cumulative 64-node definition limit would be exceeded",
  );
  await expect(
    senpiRun(
      (root) => ralph(senpiGoalRalphRoute, root),
      { prompt: "build", max_loops: 10 },
      (id) => (id.startsWith("review-") ? senpiContinueRalph : "artifact"),
    ),
  ).rejects.toThrow(
    "native cumulative 64-node definition limit would be exceeded",
  );
});

test("all file contracts have existing nonempty artifacts and valid admitted dependencies", async () => {
  const run = await senpiRun(
    (root) => ralph(senpiGoalRalphRoute, root),
    { prompt: "build", max_loops: 1 },
    (id) => (id.startsWith("review-") ? senpiRalphReview : "artifact"),
  );
  expect(
    [...run.artifacts.values()].every(
      (contents) => typeof contents === "string" && contents.length > 0,
    ),
  ).toBeTrue();
  const ids = new Set(run.checkpoint.definition?.nodes.map(({ id }) => id));
  expect(
    run.checkpoint.definition?.nodes.every(({ dependsOn = [] }) =>
      dependsOn.every((id) => ids.has(id)),
    ),
  ).toBeTrue();
});
