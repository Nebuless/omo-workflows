import { Type, type Static, type TSchema } from "typebox";
import type { ProgramContext, StagedProgram } from "../execution/policy.ts";
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

const REVIEWERS = ["correctness", "validation"] as const;
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
const ReviewSchema = Type.Object(
  {
    findings: Type.Array(FindingSchema),
    overall_correctness: Type.Union([
      Type.Literal("patch is correct"),
      Type.Literal("patch is incorrect"),
    ]),
    overall_explanation: Type.String(),
    overall_confidence_score: Type.Number({ minimum: 0, maximum: 1 }),
    requirements_traceability: Type.Array(TraceSchema),
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
type Review = Static<typeof ReviewSchema>;
type Inputs = ParsedInputs["ralph"];
type ReviewRecord = {
  reviewer: string;
  artifact_path: string;
  decision: Review;
  convergence_decision: ReturnType<typeof convergence>;
  raw_text: string;
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

export function ralph(
  route: Route,
  root: string,
): StagedProgram<Record<string, unknown>> {
  const dir = artifactRoot(root, "ralph");
  return {
    key: "ralph",
    version: 3,
    input: inputSchemas.ralph,
    decide(state) {
      const inputs = parseBuiltinInput("ralph", state.inputs);
      if (!inputs) throw new Error("ralph: invalid inputs");
      rejectUnsupported(inputs);
      const criteria = inputs.acceptance_criteria ?? inputs.prompt,
        base = normalizeBranch(inputs.base_branch);
      const convergenceEntries: Record<string, unknown>[] = [];
      for (let iteration = 1; iteration <= inputs.max_loops; iteration += 1) {
        const plan = `plan-${iteration}`,
          research = `research-${iteration}`,
          orchestrate = `orchestrate-${iteration}`,
          priorRound = `${dir}/review-round-${iteration - 1}.json`,
          priorNotes = `${dir}/implementation-notes-${iteration - 1}.md`;
        const planPath = `${dir}/research/plan-${iteration}.md`,
          researchPath = `${dir}/research/research-${iteration}.md`,
          reportPath = `${dir}/orchestrator-report-${iteration}.md`;
        const priorRemaining =
          iteration === 1
            ? []
            : priorRecords(state, iteration - 1).flatMap(({ decision }) =>
                gaps(decision),
              );
        if (!output(state, plan, plan))
          return boundedWave(state, plan, [
            fileNode(
              route,
              plan,
              `Refine research question for ${JSON.stringify(inputs.prompt)} without changing immutable criteria ${JSON.stringify(criteria)}. ${iteration === 1 ? "No prior round exists." : `Read exact prior review report ${priorRound} and implementation notes ${priorNotes}. Address remaining work ${JSON.stringify(priorRemaining)}.`}`,
              planPath,
              undefined,
              iteration === 1
                ? []
                : [
                    `ralph-review-round-${iteration - 1}`,
                    `implementation-notes-${iteration - 1}`,
                  ],
            ),
          ]);
        if (!output(state, research, research))
          return boundedWave(state, research, [
            fileNode(
              route,
              research,
              `Research source-backed implementation for ${JSON.stringify(inputs.prompt)}. Read admitted plan ${planPath}${iteration === 1 ? "" : ` and prior report ${priorRound}`}.`,
              researchPath,
              undefined,
              [plan],
            ),
          ]);
        if (!output(state, orchestrate, orchestrate))
          return boundedWave(state, orchestrate, [
            fileNode(
              route,
              orchestrate,
              `Implement from ${researchPath}; preserve immutable criteria ${JSON.stringify(criteria)}. Update Markdown decisions, deviations, blockers, and observed validation for downstream notes.`,
              reportPath,
              undefined,
              [research],
            ),
          ]);
        const reviewWave = `review-${iteration}`,
          records = REVIEWERS.map((reviewer) =>
            record(
              reviewer,
              output(state, reviewWave, `${reviewWave}-${reviewer}`),
              `${dir}/review-${iteration}-${reviewer}.json`,
              inputs.create_pr,
            ),
          );
        if (records.some((item) => item === undefined))
          return boundedWave(
            state,
            reviewWave,
            REVIEWERS.map((reviewer) =>
              jsonNode(
                route,
                `${reviewWave}-${reviewer}`,
                `Independently review ${JSON.stringify(inputs.prompt)} against immutable criteria ${JSON.stringify(criteria)}. Read ${researchPath} and ${reportPath}. Use safe comparison base ${JSON.stringify(base)}. reviewer_error and malformed output never approve.`,
                ReviewSchema,
                [orchestrate],
                "report",
              ),
            ),
          );
        const admitted = records as ReviewRecord[],
          initial = consolidate(admitted),
          eligible = initial.filter(
            (entry) =>
              entry.blocking &&
              entry.reviewers.length === 1 &&
              entry.finding.confidence_score < 0.7 &&
              !["beyond_objective", "contradicts_objective"].includes(
                entry.finding.objective_alignment,
              ),
          );
        const reverifyWave = `ralph-reverify-${iteration}`,
          reverifyIds = eligible.flatMap((_entry, finding) =>
            [1, 2, 3].map(
              (repeat) => `${reverifyWave}-${finding + 1}-${repeat}`,
            ),
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
                  inputs.prompt,
                  entry,
                  repeat,
                  researchPath,
                  reportPath,
                ),
                ReverifySchema,
                REVIEWERS.map((reviewer) => `${reviewWave}-${reviewer}`),
                "report",
              );
            }),
          );
        const reaskWave = `ralph-reverify-reask-${iteration}`,
          invalidIds = reverifyIds.filter(
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
              const parts = id.split("-"),
                finding = Number(parts.at(-2)) - 1,
                repeat = Number(parts.at(-1));
              const entry = eligible[finding];
              if (!entry)
                throw new Error("reverification re-ask index is invalid");
              return jsonNode(
                route,
                `${id}-reask`,
                `${reverifyPrompt(inputs.prompt, entry, repeat, researchPath, reportPath)} Prior score was invalid; this is the single allowed re-ask.`,
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
          initial,
          eligible,
          reverifyValues,
        );
        const approved =
          admitted.length === 2 &&
          admitted.every(
            ({ convergence_decision }) => convergence_decision.approved,
          );
        const remaining = approved
          ? []
          : admitted.flatMap(({ decision }) => gaps(decision));
        const roundPath = `${dir}/review-round-${iteration}.json`,
          notesPath = `${dir}/implementation-notes-${iteration}.md`,
          advertisedNotes = `${dir}/implementation-notes.md`;
        if (
          admitted.some(
            ({ convergence_decision }) => convergence_decision.parsed,
          )
        )
          convergenceEntries.push({
            iteration,
            unresolvedBlockingCount: batch.filter(({ blocking }) => blocking)
              .length,
            meanFindingConfidence: mean(
              admitted.flatMap(({ decision }) => decision.findings),
            ),
            fractionProven: fraction(admitted),
            demotions: audits.filter(({ verdict }) => verdict === "demoted")
              .length,
          });
        const round = {
          convergence_decision: {
            parsed: admitted.every(
              ({ convergence_decision }) => convergence_decision.parsed,
            ),
            approved,
            stopReviewLoop: approved,
            nextAction: approved
              ? inputs.create_pr
                ? "pull-request"
                : "finish"
              : "implementation",
            finalActionRemaining:
              approved &&
              inputs.create_pr &&
              admitted.some(({ decision }) =>
                finalActionRemaining(decision.requirements_traceability),
              ),
            diagnostics: admitted.flatMap(
              ({ convergence_decision }) => convergence_decision.diagnostics,
            ),
          },
          convergence: convergenceEntries,
          consolidated_findings: batch,
          reverification: audits,
          reviews: admitted,
        };
        const artifactWave = `ralph-artifacts-${iteration}`;
        if (!state.results[artifactWave]) {
          const deps = [
            ...REVIEWERS.map((reviewer) => `${reviewWave}-${reviewer}`),
            ...reverifyIds,
            ...invalidIds.map((id) => `${id}-reask`),
          ];
          const notesPrompt = `Write complete Markdown implementation notes. Include task ${JSON.stringify(inputs.prompt)}, immutable criteria ${JSON.stringify(criteria)}, admitted plan ${planPath}, research ${researchPath}, orchestrator report ${reportPath}, review report ${roundPath}, iteration ${iteration}, approval ${approved}, and remaining work ${JSON.stringify(remaining)}. Preserve observed implementation decisions and validation from ${reportPath}; do not emit JSON index.`;
          return boundedWave(state, artifactWave, [
            ...admitted.map((item) =>
              fileNode(
                route,
                `ralph-review-artifact-${iteration}-${item.reviewer}`,
                "Persist observed reviewer decision, raw admission state, and convergence decision.",
                item.artifact_path,
                exact(item),
                deps,
              ),
            ),
            fileNode(
              route,
              `ralph-review-round-${iteration}`,
              "Persist consolidated findings and evidence-backed re-verification audits.",
              roundPath,
              exact(round),
              deps,
            ),
            fileNode(
              route,
              `implementation-notes-${iteration}`,
              notesPrompt,
              notesPath,
              undefined,
              [orchestrate, `ralph-review-round-${iteration}`],
            ),
            ...(approved || iteration === inputs.max_loops
              ? [
                  fileNode(
                    route,
                    `implementation-notes-final-${iteration}`,
                    `Copy complete Markdown notes from ${notesPath} to advertised final notes path.`,
                    advertisedNotes,
                    undefined,
                    [`implementation-notes-${iteration}`],
                  ),
                ]
              : []),
          ]);
        }
        if (!approved && iteration < inputs.max_loops) continue;
        const result = {
          result: output(state, orchestrate, orchestrate),
          plan: output(state, plan, plan),
          plan_path: planPath,
          research: output(state, research, research),
          research_path: researchPath,
          implementation_notes_path: advertisedNotes,
          approved,
          iterations_completed: iteration,
          review_report: `Latest review round artifact: ${roundPath}`,
          review_report_path: roundPath,
          ...(approved ? {} : { remaining_work: remaining }),
        };
        if (!approved || !inputs.create_pr) return { kind: "final", result };
        const prWave = `ralph-pull-request-${iteration}`,
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
                `Unanimously approved Ralph run only. Create provider handoff using ${JSON.stringify(base)} as comparison base. Read ${advertisedNotes} and ${roundPath}. Return observed report.`,
                Type.Object(
                  { pr_report: Type.String({ minLength: 1 }) },
                  Strict,
                ),
                [
                  `implementation-notes-final-${iteration}`,
                  `ralph-review-round-${iteration}`,
                ],
              ),
            ]);
      }
      throw new Error("ralph: unreachable");
    },
  };
}
function failure(reviewer: string): Review {
  return {
    findings: [],
    overall_correctness: "patch is incorrect",
    overall_explanation: "Reviewer output failed admission.",
    overall_confidence_score: 0,
    requirements_traceability: [],
    stop_review_loop: false,
    reviewer_error: {
      kind: "reviewer_failure",
      message: `Structured reviewer decision parse failed for ${reviewer}.`,
      attempted_recovery: "Continue bounded loop without approval.",
    },
  };
}
function record(
  reviewer: string,
  value: unknown,
  path: string,
  createPr: boolean,
): ReviewRecord | undefined {
  if (value === undefined) return undefined;
  const parsed = checked(ReviewSchema, value),
    decision = parsed ?? failure(reviewer);
  return {
    reviewer,
    artifact_path: path,
    decision,
    convergence_decision: convergence(
      decision.stop_review_loop && decision.reviewer_error == null,
      createPr,
      parsed !== undefined,
      parsed
        ? []
        : [`Structured reviewer decision parse failed for ${reviewer}.`],
    ),
    raw_text: parsed
      ? "schema-valid structured payload admitted"
      : "invalid-output sentinel admitted",
  };
}
function convergence(
  approved: boolean,
  createPr: boolean,
  parsed: boolean,
  diagnostics: string[],
) {
  return {
    parsed,
    approved,
    stopReviewLoop: approved,
    nextAction: approved
      ? createPr
        ? "pull-request"
        : "finish"
      : "implementation",
    finalActionRemaining: approved && createPr,
    diagnostics,
  };
}
function finalActionRemaining(
  traceability: Review["requirements_traceability"],
) {
  return traceability.some(
    ({ requirement, evidence, status }) =>
      status !== "proven" &&
      /\b(?:pr|pull[- ]request|merge[- ]request|review request|github pr|create pr)\b/i.test(
        `${requirement}\n${evidence}`,
      ),
  );
}
function gaps(decision: Review) {
  return [
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
    ...(decision.reviewer_error
      ? [`${decision.reviewer_error.kind}: ${decision.reviewer_error.message}`]
      : []),
  ];
}
function key(finding: Finding) {
  return `${finding.code_location.absolute_file_path}::${finding.title
    .replace(/^\s*\[P[0-3]\]\s*/i, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()}`;
}
function blocks(finding: Finding) {
  if (
    ["beyond_objective", "contradicts_objective"].includes(
      finding.objective_alignment,
    )
  )
    return false;
  if (finding.objective_alignment === "required_by_objective") return true;
  return finding.priority == null || finding.priority <= 2;
}
function consolidate(records: readonly ReviewRecord[]): Consolidated[] {
  const map = new Map<string, Consolidated>();
  for (const { reviewer, decision } of records)
    for (const finding of decision.findings) {
      const id = key(finding),
        prior = map.get(id);
      if (!prior)
        map.set(id, {
          finding,
          reviewers: [reviewer],
          blocking: blocks(finding),
        });
      else {
        if (!prior.reviewers.includes(reviewer)) prior.reviewers.push(reviewer);
        prior.blocking ||= blocks(finding);
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
      demoted =
        entry.finding.objective_alignment === "required_by_objective"
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
      .map(({ finding }) => key(finding.finding)),
  );
  return {
    batch: batch.map((entry) =>
      demoted.has(key(entry.finding)) ? { ...entry, blocking: false } : entry,
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
  state: ProgramContext<object>,
  id: string,
  nodes: import("../execution/policy.ts").ProgramNode[],
) {
  const admitted = Object.values(state.results).reduce(
    (count, wave) => count + Object.keys(wave).length,
    0,
  );
  if (admitted + nodes.length > 64)
    throw new Error(
      `ralph: native cumulative 64-node definition limit would be exceeded (${admitted} admitted + ${nodes.length} required)`,
    );
  return { kind: "wave" as const, id, nodes };
}
function priorRecords(
  state: ProgramContext<object>,
  iteration: number,
): ReviewRecord[] {
  return REVIEWERS.flatMap((reviewer) => {
    const value = output(
      state,
      `review-${iteration}`,
      `review-${iteration}-${reviewer}`,
    );
    const parsed = checked(ReviewSchema, value);
    return parsed
      ? [
          {
            reviewer,
            artifact_path: "",
            decision: parsed,
            convergence_decision: convergence(false, false, true, []),
            raw_text: "",
          },
        ]
      : [];
  });
}
function mean(findings: Finding[]) {
  return findings.length
    ? findings.reduce((sum, finding) => sum + finding.confidence_score, 0) /
        findings.length
    : null;
}
function fraction(records: ReviewRecord[]) {
  const trace = records.flatMap(
    ({ decision }) => decision.requirements_traceability,
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
      "ralph: git_worktree_dir requires native task cwd, but pinned native workflow node schema has no cwd field",
    );
}
