import { createHash } from "node:crypto";
import { Type, type Static, type TSchema } from "typebox";
import type { StagedProgram } from "../execution/policy.ts";
import {
  artifactRoot,
  fileNode,
  jsonNode,
  output,
  type Route,
} from "./helpers.ts";
import {
  checked,
  inputSchemas,
  parseBuiltinInput,
  type ParsedInputs,
} from "./schemas.ts";

const REVIEWERS = ["contract", "evidence", "risk"] as const;
const Strict = { additionalProperties: false } as const;
const FindingSchema = Type.Object(
  {
    title: Type.String(),
    body: Type.String(),
    confidence_score: Type.Number({ minimum: 0, maximum: 1 }),
    objective_alignment: Type.Union([
      Type.Literal("required_by_objective"),
      Type.Literal("consistent_with_objective"),
      Type.Literal("beyond_objective"),
      Type.Literal("contradicts_objective"),
    ]),
    priority: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
    ),
    code_location: Type.Object(
      {
        absolute_file_path: Type.String(),
        line_range: Type.Object(
          {
            start: Type.Integer({ minimum: 1 }),
            end: Type.Integer({ minimum: 1 }),
          },
          Strict,
        ),
      },
      Strict,
    ),
  },
  Strict,
);
const TraceSchema = Type.Object(
  {
    requirement: Type.String(),
    status: Type.Union([
      Type.Literal("proven"),
      Type.Literal("contradicted"),
      Type.Literal("missing"),
      Type.Literal("unverified"),
    ]),
    evidence: Type.String(),
  },
  Strict,
);
const ErrorSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("validation_unavailable"),
      Type.Literal("dependency_unavailable"),
      Type.Literal("tool_failure"),
      Type.Literal("reviewer_failure"),
    ]),
    message: Type.String(),
    attempted_recovery: Type.String(),
  },
  Strict,
);
const GoalReviewSchema = Type.Object(
  {
    findings: Type.Array(FindingSchema),
    overall_correctness: Type.Union([
      Type.Literal("patch is correct"),
      Type.Literal("patch is incorrect"),
    ]),
    overall_explanation: Type.String(),
    overall_confidence_score: Type.Number({ minimum: 0, maximum: 1 }),
    goal_oracle_satisfied: Type.Boolean(),
    requirements_traceability: Type.Array(TraceSchema),
    receipt_assessment: Type.String(),
    verification_remaining: Type.String(),
    stop_review_loop: Type.Boolean(),
    reviewer_error: Type.Optional(Type.Union([Type.Null(), ErrorSchema])),
  },
  Strict,
);
const ReverifySchema = Type.Object(
  {
    score: Type.Integer({ minimum: 1, maximum: 20 }),
    evidence: Type.Array(Type.String()),
  },
  Strict,
);
type Finding = Static<typeof FindingSchema>;
type GoalReview = Static<typeof GoalReviewSchema>;
type Inputs = ParsedInputs["goal"];
type ReviewRecord = GoalReview & {
  decision: "complete" | "continue" | "blocked";
  evidence: string[];
  gaps: string[];
  blocker: string | null;
  confidence_score: number;
  explanation: string;
  turn: number;
  reviewer: string;
  artifact_path: string;
  parsed: boolean;
  approved: boolean;
  parse_diagnostics: string[];
  convergence_decision: ReturnType<typeof convergence>;
};
type Consolidated = {
  finding: Finding;
  reviewers: string[];
  blocking: boolean;
};
type Audit = {
  finding: Consolidated;
  verdict: "confirmed" | "demoted";
  meanScore: number;
  perRepeat: (number | null)[];
  evidence: string[];
};
type Blocker = { turn: number; blocker: string; reviewers: string[] };

export function goal(
  route: Route,
  root: string,
): StagedProgram<Record<string, unknown>> {
  const dir = artifactRoot(root, "goal");
  return {
    key: "goal",
    version: 3,
    input: inputSchemas.goal,
    decide(state) {
      const inputs = parseBuiltinInput("goal", state.inputs);
      if (!inputs) throw new Error("goal: invalid inputs");
      rejectUnsupported(inputs);
      const criteria = inputs.acceptance_criteria ?? inputs.objective;
      const base = normalizeBranch(inputs.base_branch);
      const goalId = createHash("sha256")
        .update(`${dir}\0${inputs.objective}\0${criteria}`)
        .digest("hex")
        .slice(0, 24);
      const receipts: Record<string, unknown>[] = [],
        reviews: ReviewRecord[] = [],
        blockers: Blocker[] = [],
        decisions: Record<string, unknown>[] = [],
        lifecycle: Record<string, unknown>[] = [],
        convergenceEntries: Record<string, unknown>[] = [],
        reverificationAudits: Audit[] = [];
      for (let turn = 1; turn <= inputs.max_turns; turn += 1) {
        const receiptPath = `${dir}/orchestrator-receipt-${turn}.md`,
          priorLedger = `${dir}/goal-ledger-turn-${turn - 1}.json`,
          priorRound = `${dir}/review-round-${turn - 1}.json`;
        const work = `orchestrate-${turn}`;
        const priorRemaining =
          turn === 1
            ? "none"
            : String(
                decisions.at(-1)?.remaining_work ??
                  "Reviewer quorum did not prove completion.",
              );
        if (!output(state, work, work))
          return boundedWave(state, work, [
            fileNode(
              route,
              work,
              `Advance objective ${JSON.stringify(inputs.objective)} against immutable acceptance criteria ${JSON.stringify(criteria)}. Comparison base branch: ${JSON.stringify(base)}. ${turn === 1 ? "No prior round exists." : `Read exact prior ledger ${priorLedger} and review report ${priorRound}. Resolve objective-aligned remaining work: ${JSON.stringify(priorRemaining)}.`}`,
              receiptPath,
              undefined,
              turn === 1
                ? []
                : [`goal-ledger-${turn - 1}`, `goal-review-round-${turn - 1}`],
            ),
          ]);
        receipts.push({
          turn,
          stage: `orchestrator-${turn}`,
          artifact_path: receiptPath,
          summary: `Orchestrator receipt artifact: ${receiptPath}`,
        });
        lifecycle.push(
          {
            turn,
            event: "work_turn_started",
            status: "active",
            summary: "Orchestrator started.",
          },
          {
            turn,
            event: "receipt_recorded",
            status: "active",
            summary: "Orchestrator receipt recorded.",
          },
        );
        const reviewWave = `review-${turn}`;
        const turnReviews = REVIEWERS.map((reviewer) =>
          reviewRecord(
            turn,
            reviewer,
            output(state, reviewWave, `${reviewWave}-${reviewer}`),
            `${dir}/review-${turn}-${reviewer}.json`,
            inputs.create_pr,
          ),
        );
        if (turnReviews.some((record) => record === undefined))
          return boundedWave(
            state,
            reviewWave,
            REVIEWERS.map((reviewer) =>
              jsonNode(
                route,
                `${reviewWave}-${reviewer}`,
                `Independently review objective ${JSON.stringify(inputs.objective)} against immutable criteria ${JSON.stringify(criteria)}. Read admitted receipt ${receiptPath}. Use safe comparison base ${JSON.stringify(base)}. Derive stop_review_loop from observed evidence; reviewer errors and parse failures never approve.`,
                GoalReviewSchema,
                [work],
                "report",
              ),
            ),
          );
        const admittedReviews = turnReviews as ReviewRecord[];
        reviews.push(...admittedReviews);
        const initialBatch = consolidate(admittedReviews);
        const eligible = initialBatch.filter(
          (entry) =>
            entry.blocking &&
            entry.reviewers.length === 1 &&
            entry.finding.confidence_score < 0.7 &&
            !["beyond_objective", "contradicts_objective"].includes(
              entry.finding.objective_alignment,
            ),
        );
        const reverifyWave = `reverify-${turn}`;
        const reverifyIds = eligible.flatMap((_entry, finding) =>
          [1, 2, 3].map((repeat) => `${reverifyWave}-${finding + 1}-${repeat}`),
        );
        if (
          reverifyIds.some(
            (id) => output(state, reverifyWave, id) === undefined,
          )
        )
          return boundedWave(
            state,
            reverifyWave,
            reverifyIds.map((id, index) => {
              const entry = eligible[Math.floor(index / 3)];
              if (!entry) throw new Error("reverification index is invalid");
              const repeat = (index % 3) + 1;
              return jsonNode(
                route,
                id,
                reverifyPrompt(
                  inputs.objective,
                  entry,
                  repeat,
                  receiptPath,
                  `${dir}/goal-ledger-turn-${Math.max(0, turn - 1)}.json`,
                ),
                ReverifySchema,
                REVIEWERS.map((reviewer) => `${reviewWave}-${reviewer}`),
                "report",
              );
            }),
          );
        const reaskWave = `reverify-reask-${turn}`;
        const invalidIds = reverifyIds.filter(
          (id) =>
            checked(ReverifySchema, output(state, reverifyWave, id)) ===
            undefined,
        );
        if (
          invalidIds.some(
            (id) => output(state, reaskWave, `${id}-reask`) === undefined,
          )
        )
          return boundedWave(
            state,
            reaskWave,
            invalidIds.map((id) => {
              const parts = id.split("-");
              const finding = Number(parts.at(-2)) - 1,
                repeat = Number(parts.at(-1));
              const entry = eligible[finding];
              if (!entry)
                throw new Error("reverification re-ask index is invalid");
              return jsonNode(
                route,
                `${id}-reask`,
                `${reverifyPrompt(inputs.objective, entry, repeat, receiptPath, `${dir}/goal-ledger-turn-${Math.max(0, turn - 1)}.json`)} Prior score was invalid; this is the single allowed re-ask.`,
                ReverifySchema,
                REVIEWERS.map((reviewer) => `${reviewWave}-${reviewer}`),
                "report",
              );
            }),
          );
        const reverifyValues = reverifyIds.map(
          (id) =>
            checked(ReverifySchema, output(state, reverifyWave, id)) ??
            output(state, reaskWave, `${id}-reask`),
        );
        const { batch, audits } = applyReverify(
          initialBatch,
          eligible,
          reverifyValues,
        );
        reverificationAudits.push(...audits);
        const completeVotes = admittedReviews.filter(
          ({ approved }) => approved,
        ).length;
        const candidate = blockerCandidate(turn, admittedReviews);
        if (candidate) blockers.push(candidate);
        const repeated = candidate
          ? consecutive(blockers, candidate.blocker, turn)
          : 0;
        const status =
          completeVotes >= 2
            ? "complete"
            : repeated >= Math.min(3, inputs.max_turns)
              ? "blocked"
              : turn === inputs.max_turns
                ? "needs_human"
                : "active";
        const remaining =
          status === "complete"
            ? "none"
            : (candidate?.blocker ?? remainingWork(admittedReviews));
        const decision = {
          turn,
          decision: status === "active" ? "continue" : status,
          reason:
            status === "complete"
              ? `Reviewer quorum met: ${completeVotes}/2.`
              : status === "blocked"
                ? `Same blocker repeated for ${repeated}/${Math.min(3, inputs.max_turns)} consecutive controller observations.`
                : `Reviewer quorum not met. Remaining work: ${remaining}`,
          complete_votes: completeVotes,
          review_quorum: 2,
          remaining_work: remaining,
          ...convergence(
            status === "complete",
            inputs.create_pr && status === "complete",
            admittedReviews.every(({ parsed }) => parsed),
            admittedReviews.flatMap(
              ({ parse_diagnostics }) => parse_diagnostics,
            ),
            status === "blocked"
              ? "blocked"
              : status === "needs_human"
                ? "needs_human"
                : undefined,
          ),
        };
        decisions.push(decision);
        lifecycle.push(
          {
            turn,
            event: "reviews_recorded",
            status: "active",
            summary: `Recorded ${admittedReviews.length} reviewer decisions.`,
          },
          { turn, event: "status_decided", status, summary: decision.reason },
        );
        if (admittedReviews.some(({ parsed }) => parsed))
          convergenceEntries.push({
            turn,
            unresolvedBlockingCount: batch.filter(({ blocking }) => blocking)
              .length,
            meanFindingConfidence: admittedReviews.flatMap(
              ({ findings }) => findings,
            ).length
              ? admittedReviews
                  .flatMap(({ findings }) => findings)
                  .reduce((sum, finding) => sum + finding.confidence_score, 0) /
                admittedReviews.flatMap(({ findings }) => findings).length
              : null,
            fractionProven: fractionProven(admittedReviews),
            demotions: audits.filter(({ verdict }) => verdict === "demoted")
              .length,
          });
        const ledgerPath = `${dir}/goal-ledger-turn-${turn}.json`,
          latestLedgerPath = `${dir}/goal-ledger.json`,
          roundPath = `${dir}/review-round-${turn}.json`;
        const ledger = {
          goal_id: goalId,
          objective: inputs.objective,
          acceptance_criteria: criteria,
          status,
          turns: turn,
          receipts,
          reviews,
          blockers,
          decisions,
          lifecycle,
          reverification: reverificationAudits,
          convergence: convergenceEntries,
        };
        const round = {
          reviews: admittedReviews,
          consolidated_findings: batch,
          reverification: audits,
        };
        const artifactWave = `goal-artifacts-${turn}`;
        if (!state.results[artifactWave]) {
          const deps = [
            ...REVIEWERS.map((reviewer) => `${reviewWave}-${reviewer}`),
            ...reverifyIds,
            ...invalidIds.map((id) => `${id}-reask`),
          ];
          return boundedWave(state, artifactWave, [
            ...admittedReviews.map((record) =>
              fileNode(
                route,
                `goal-review-artifact-${turn}-${record.reviewer}`,
                "Persist flattened observed reviewer record including parse, convergence, evidence, and gaps.",
                record.artifact_path,
                exact(record),
                deps,
              ),
            ),
            fileNode(
              route,
              `goal-review-round-${turn}`,
              "Persist consolidated findings and evidence-backed re-verification audits; never invent empty audit metadata for eligible findings.",
              roundPath,
              exact(round),
              deps,
            ),
            fileNode(
              route,
              `goal-ledger-${turn}`,
              "Persist truthful cumulative Goal ledger for this turn.",
              ledgerPath,
              exact(ledger),
              deps,
            ),
            ...(status === "active"
              ? []
              : [
                  fileNode(
                    route,
                    `goal-ledger-final-${turn}`,
                    "Persist terminal cumulative Goal ledger at advertised final path.",
                    latestLedgerPath,
                    exact(ledger),
                    [`goal-ledger-${turn}`],
                  ),
                ]),
          ]);
        }
        if (status === "active") continue;
        const result = {
          result: `Goal ${status}. Remaining work: ${remaining}`,
          status,
          approved: status === "complete",
          goal_id: goalId,
          objective: inputs.objective,
          acceptance_criteria: criteria,
          ledger_path: latestLedgerPath,
          turns_completed: turn,
          iterations_completed: turn,
          receipts,
          remaining_work: remaining,
          review_report: `Latest review round artifact: ${roundPath}`,
          review_report_path: roundPath,
        };
        if (status !== "complete" || !inputs.create_pr)
          return { kind: "final", result };
        const prWave = `goal-pull-request-${turn}`,
          pr = checked(
            Type.Object({ pr_report: Type.String({ minLength: 1 }) }, Strict),
            output(state, prWave, "pull-request"),
          );
        return pr
          ? { kind: "final", result: { ...result, pr_report: pr.pr_report } }
          : boundedWave(state, prWave, [
              jsonNode(
                route,
                "pull-request",
                `Deterministically approved Goal only. Create provider handoff using ${JSON.stringify(base)} as comparison base. Read ${latestLedgerPath} and ${roundPath}. Return observed report; no success claim without URL or concrete failure.`,
                Type.Object(
                  { pr_report: Type.String({ minLength: 1 }) },
                  Strict,
                ),
                [`goal-ledger-final-${turn}`, `goal-review-round-${turn}`],
              ),
            ]);
      }
      throw new Error("goal: unreachable");
    },
  };
}

function reviewerFailure(message: string): GoalReview {
  return {
    findings: [],
    overall_correctness: "patch is incorrect",
    overall_explanation:
      "Reviewer output failed admission, so review cannot approve.",
    overall_confidence_score: 0,
    goal_oracle_satisfied: false,
    requirements_traceability: [],
    receipt_assessment: "No schema-valid reviewer receipt was admitted.",
    verification_remaining: "Recover reviewer output and re-run validation.",
    stop_review_loop: false,
    reviewer_error: {
      kind: "reviewer_failure",
      message,
      attempted_recovery: "Continue bounded loop without approval.",
    },
  };
}
function reviewRecord(
  turn: number,
  reviewer: string,
  value: unknown,
  path: string,
  createPr: boolean,
): ReviewRecord | undefined {
  if (value === undefined) return undefined;
  const parsed = checked(GoalReviewSchema, value);
  const decision =
    parsed ??
    reviewerFailure(
      `Structured reviewer decision parse failed for ${reviewer}.`,
    );
  const approved = decision.stop_review_loop && decision.reviewer_error == null;
  const blocker =
    decision.reviewer_error &&
    ["dependency_unavailable", "tool_failure"].includes(
      decision.reviewer_error.kind,
    )
      ? decision.reviewer_error.message.trim() || null
      : null;
  const gaps = [
    ...decision.findings.map(
      (finding) =>
        `[${finding.objective_alignment}] ${finding.title}: ${finding.body}`,
    ),
    ...decision.requirements_traceability
      .filter(({ status }) => status !== "proven")
      .map(
        ({ status, requirement, evidence }) =>
          `${status}: ${requirement} - ${evidence}`,
      ),
    ...(!approved && decision.verification_remaining.trim()
      ? [decision.verification_remaining.trim()]
      : []),
    ...(decision.reviewer_error
      ? [`${decision.reviewer_error.kind}: ${decision.reviewer_error.message}`]
      : []),
  ];
  return {
    ...decision,
    decision: approved ? "complete" : blocker ? "blocked" : "continue",
    evidence: [decision.receipt_assessment, decision.overall_explanation],
    gaps,
    blocker,
    confidence_score: decision.overall_confidence_score,
    explanation: decision.overall_explanation,
    turn,
    reviewer,
    artifact_path: path,
    parsed: parsed !== undefined,
    approved,
    parse_diagnostics: parsed
      ? []
      : [`Structured reviewer decision parse failed for ${reviewer}.`],
    convergence_decision: convergence(
      approved,
      approved &&
        createPr &&
        finalActionRemaining(decision.requirements_traceability),
      parsed !== undefined,
      parsed
        ? []
        : [`Structured reviewer decision parse failed for ${reviewer}.`],
    ),
  };
}
function convergence(
  approved: boolean,
  final: boolean,
  parsed: boolean,
  diagnostics: string[],
  nextAction?: "implementation" | "blocked" | "needs_human",
) {
  return {
    parsed,
    approved,
    stopReviewLoop: approved,
    nextAction: approved
      ? final
        ? "pull-request"
        : "finish"
      : (nextAction ?? "implementation"),
    finalActionRemaining: approved && final,
    diagnostics,
  };
}
function finalActionRemaining(
  traceability: GoalReview["requirements_traceability"],
) {
  return traceability.some(
    ({ requirement, evidence, status }) =>
      status !== "proven" &&
      /\b(?:pr|pull[- ]request|merge[- ]request|review request|github pr|create pr)\b/i.test(
        `${requirement}\n${evidence}`,
      ),
  );
}
function findingBlocks(finding: Finding) {
  if (
    ["beyond_objective", "contradicts_objective"].includes(
      finding.objective_alignment,
    )
  )
    return false;
  if (finding.objective_alignment === "required_by_objective") return true;
  return finding.priority == null || finding.priority <= 2;
}
function findingKey(finding: Finding) {
  return `${finding.code_location.absolute_file_path}::${finding.title
    .replace(/^\s*\[P[0-3]\]\s*/i, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()}`;
}
function consolidate(reviews: readonly ReviewRecord[]): Consolidated[] {
  const map = new Map<string, Consolidated>();
  for (const review of reviews)
    for (const finding of review.findings) {
      const key = findingKey(finding),
        prior = map.get(key);
      if (!prior)
        map.set(key, {
          finding,
          reviewers: [review.reviewer],
          blocking: findingBlocks(finding),
        });
      else {
        if (!prior.reviewers.includes(review.reviewer))
          prior.reviewers.push(review.reviewer);
        prior.blocking ||= findingBlocks(finding);
      }
    }
  return [...map.values()].sort(
    (a, b) => Number(b.blocking) - Number(a.blocking),
  );
}
function applyReverify(
  batch: Consolidated[],
  eligible: Consolidated[],
  values: unknown[],
): { batch: Consolidated[]; audits: Audit[] } {
  const audits = eligible.map((entry, finding) => {
    const reports = values
        .slice(finding * 3, finding * 3 + 3)
        .map((value) => checked(ReverifySchema, value)),
      valid = reports.filter(
        (report): report is NonNullable<typeof report> => report !== undefined,
      ),
      perRepeat = reports.map((report) => report?.score ?? null),
      meanScore = valid.length
        ? valid.reduce((sum, report) => sum + report.score, 0) / valid.length
        : 0,
      required = entry.finding.objective_alignment === "required_by_objective",
      demoted = required
        ? valid.length === 3 && meanScore < 6
        : valid.length >= 2 && meanScore < 10;
    return {
      finding: entry,
      verdict: demoted ? ("demoted" as const) : ("confirmed" as const),
      meanScore,
      perRepeat,
      evidence: reports.flatMap((report, repeat) =>
        report
          ? report.evidence.length
            ? report.evidence
            : [
                `Re-verification repeat ${repeat + 1} scored ${report.score}/20.`,
              ]
          : [
              `Re-verification repeat ${repeat + 1} was invalid after one re-ask; doubt defaults to confirmed.`,
            ],
      ),
    };
  });
  const demoted = new Set(
    audits
      .filter(({ verdict }) => verdict === "demoted")
      .map(({ finding }) => findingKey(finding.finding)),
  );
  return {
    batch: batch.map((entry) =>
      demoted.has(findingKey(entry.finding))
        ? { ...entry, blocking: false }
        : entry,
    ),
    audits,
  };
}
function reverifyPrompt(
  objective: string,
  entry: Consolidated,
  repeat: number,
  ...refs: string[]
) {
  return `Fresh independent re-verification repeat ${repeat}/3. Assess this specific finding against observed code and objective ${JSON.stringify(objective)}. Finding payload: ${JSON.stringify(entry.finding)}. Reviewers: ${JSON.stringify(entry.reviewers)}. Candidate refs: ${JSON.stringify([entry.finding.code_location.absolute_file_path, ...refs])}. Return whether claim remains real and objective-relevant as one score/evidence object.`;
}
function boundedWave(
  state: {
    results: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  },
  id: string,
  nodes: import("../execution/policy.ts").ProgramNode[],
) {
  const admitted = Object.values(state.results).reduce(
    (count, wave) => count + Object.keys(wave).length,
    0,
  );
  if (admitted + nodes.length > 64)
    throw new Error(
      `goal: native cumulative 64-node definition limit would be exceeded (${admitted} admitted + ${nodes.length} required)`,
    );
  return { kind: "wave" as const, id, nodes };
}
function blockerCandidate(
  turn: number,
  reviews: readonly ReviewRecord[],
): Blocker | undefined {
  const map = new Map<string, Blocker>();
  for (const review of reviews)
    if (review.blocker) {
      const key = norm(review.blocker),
        item = map.get(key) ?? { turn, blocker: review.blocker, reviewers: [] };
      item.reviewers.push(review.reviewer);
      map.set(key, item);
    }
  return [...map.values()].sort(
    (a, b) => b.reviewers.length - a.reviewers.length,
  )[0];
}
function norm(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
function consecutive(items: readonly Blocker[], blocker: string, turn: number) {
  let count = 0,
    expected = turn;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.turn !== expected || norm(item.blocker) !== norm(blocker))
      break;
    count += 1;
    expected -= 1;
  }
  return count;
}
function remainingWork(reviews: readonly ReviewRecord[]) {
  const gaps = reviews.flatMap(({ gaps, blocker }) => [
    ...gaps,
    ...(blocker ? [blocker] : []),
  ]);
  return gaps.length
    ? gaps.join("; ")
    : "Reviewer quorum did not prove completion.";
}
function fractionProven(reviews: readonly ReviewRecord[]) {
  const trace = reviews.flatMap(
    ({ requirements_traceability }) => requirements_traceability,
  );
  return trace.length
    ? trace.filter(({ status }) => status === "proven").length / trace.length
    : 0;
}
function exact(value: unknown): TSchema {
  return Type.Unsafe({ const: value });
}
function normalizeBranch(value: string) {
  const trimmed = value.trim();
  return /^(?!-)(?!.*(?:\.\.|@\{|\/\/|\.lock(?:\/|$)))[A-Za-z0-9][A-Za-z0-9._/@+-]*$/.test(
    trimmed,
  )
    ? trimmed
    : "origin/main";
}
function rejectUnsupported(inputs: Inputs) {
  if (inputs.git_worktree_dir !== "")
    throw new Error(
      "goal: git_worktree_dir requires native task cwd, but pinned native workflow node schema has no cwd field",
    );
}
