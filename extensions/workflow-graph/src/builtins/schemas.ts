import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const Strict = { additionalProperties: false } as const;
const NonBlank = Type.String({ minLength: 1, pattern: ".*\\S.*" });
const Positive = Type.Integer({ minimum: 1 });
const Inputs = {
  "classify-and-act": Type.Object(
    {
      prompt: NonBlank,
      categories: Type.Optional(
        Type.Array(NonBlank, { minItems: 1, maxItems: 8 }),
      ),
      confidence_threshold: Type.Optional(
        Type.Number({ minimum: 0.5, maximum: 0.99 }),
      ),
    },
    Strict,
  ),
  "fan-out-and-synthesize": Type.Object(
    {
      prompt: NonBlank,
      max_branches: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
      max_concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
    },
    Strict,
  ),
  "adversarial-verification": Type.Object(
    {
      task: NonBlank,
      verifier_count: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
      max_repairs: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })),
      criteria: Type.Optional(
        Type.Union([Type.String(), Type.Record(NonBlank, NonBlank)]),
      ),
      accept_mean: Type.Optional(Type.Number()),
      reask_limit: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    Strict,
  ),
  "generate-and-filter": Type.Object(
    {
      prompt: NonBlank,
      num_candidates: Type.Optional(Type.Integer({ minimum: 2, maximum: 20 })),
      shortlist_size: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      use_judge: Type.Optional(Type.Boolean()),
      max_concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
    },
    Strict,
  ),
  tournament: Type.Object(
    {
      prompt: NonBlank,
      num_attempts: Type.Optional(Type.Integer({ minimum: 2, maximum: 8 })),
      max_concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
      n_evaluations: Type.Optional(Positive),
      pivots: Type.Optional(Positive),
      seed: Type.Optional(Type.Integer()),
      criteria: Type.Optional(
        Type.Union([
          Type.String(),
          Type.Record(Type.String(), Type.String()),
          Type.Array(Type.String()),
          Type.Array(
            Type.Object(
              {
                id: Type.Optional(Type.String()),
                name: Type.Optional(Type.String()),
                description: Type.String(),
              },
              { additionalProperties: true },
            ),
          ),
        ]),
      ),
      models: Type.Optional(Type.Array(Type.String())),
    },
    Strict,
  ),
  "loop-until-done": Type.Object(
    {
      prompt: NonBlank,
      max_iterations: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      progress_scoring: Type.Optional(Type.Boolean()),
      progress_repeats: Type.Optional(Positive),
    },
    Strict,
  ),
  goal: Type.Object(
    {
      objective: NonBlank,
      acceptance_criteria: Type.Optional(NonBlank),
      max_turns: Type.Optional(Positive),
      base_branch: Type.Optional(Type.String()),
      git_worktree_dir: Type.Optional(Type.String()),
      create_pr: Type.Optional(Type.Boolean()),
    },
    Strict,
  ),
  ralph: Type.Object(
    {
      prompt: NonBlank,
      acceptance_criteria: Type.Optional(NonBlank),
      max_loops: Type.Optional(Positive),
      base_branch: Type.Optional(Type.String()),
      git_worktree_dir: Type.Optional(Type.String()),
      create_pr: Type.Optional(Type.Boolean()),
    },
    Strict,
  ),
  "open-claude-design": Type.Object(
    { prompt: NonBlank, discover_references: Type.Optional(Type.Boolean()) },
    Strict,
  ),
} as const;
export type BuiltinName = keyof typeof Inputs;
export const inputSchemas: Readonly<Record<BuiltinName, TSchema>> = Inputs;
const defaults = {
  "classify-and-act": {
    categories: ["analysis", "implementation", "research"],
    confidence_threshold: 0.75,
  },
  "fan-out-and-synthesize": { max_branches: 4, max_concurrency: 4 },
  "adversarial-verification": {
    verifier_count: 3,
    max_repairs: 2,
    criteria: {
      task_fit: "The candidate satisfies the literal task.",
      evidence:
        "Important claims cite observable evidence, and file findings cite file:line where applicable.",
      completeness:
        "Relevant validation is executed and reported with commands run and observed output, and no blocking correctness, safety, or completeness gap remains.",
    },
    accept_mean: 14,
    reask_limit: 1,
  },
  "generate-and-filter": {
    num_candidates: 8,
    shortlist_size: 3,
    use_judge: true,
    max_concurrency: 4,
  },
  tournament: {
    num_attempts: 4,
    max_concurrency: 4,
    n_evaluations: 2,
    pivots: 1,
    seed: 0,
  },
  "loop-until-done": {
    max_iterations: 5,
    progress_scoring: true,
    progress_repeats: 1,
  },
  goal: {
    max_turns: 10,
    base_branch: "origin/main",
    git_worktree_dir: "",
    create_pr: false,
  },
  ralph: {
    max_loops: 10,
    base_branch: "origin/main",
    git_worktree_dir: "",
    create_pr: false,
  },
  "open-claude-design": { discover_references: true },
} as const;
export type ParsedInputs = {
  "classify-and-act": {
    prompt: string;
    categories: string[];
    confidence_threshold: number;
  };
  "fan-out-and-synthesize": {
    prompt: string;
    max_branches: number;
    max_concurrency: number;
  };
  "adversarial-verification": {
    task: string;
    verifier_count: number;
    max_repairs: number;
    criteria: string | Record<string, string>;
    accept_mean: number;
    reask_limit: number;
  };
  "generate-and-filter": {
    prompt: string;
    num_candidates: number;
    shortlist_size: number;
    use_judge: boolean;
    max_concurrency: number;
  };
  tournament: {
    prompt: string;
    num_attempts: number;
    max_concurrency: number;
    n_evaluations: number;
    pivots: number;
    seed: number;
    criteria?:
      | string
      | Record<string, string>
      | string[]
      | { id?: string; name?: string; description: string }[];
    models?: string[];
  };
  "loop-until-done": {
    prompt: string;
    max_iterations: number;
    progress_scoring: boolean;
    progress_repeats: number;
  };
  goal: {
    objective: string;
    acceptance_criteria?: string;
    max_turns: number;
    base_branch: string;
    git_worktree_dir: string;
    create_pr: boolean;
  };
  ralph: {
    prompt: string;
    acceptance_criteria?: string;
    max_loops: number;
    base_branch: string;
    git_worktree_dir: string;
    create_pr: boolean;
  };
  "open-claude-design": { prompt: string; discover_references: boolean };
};
export function parseBuiltinInput(
  name: "classify-and-act",
  value: unknown,
): ParsedInputs["classify-and-act"] | undefined;
export function parseBuiltinInput(
  name: "fan-out-and-synthesize",
  value: unknown,
): ParsedInputs["fan-out-and-synthesize"] | undefined;
export function parseBuiltinInput(
  name: "adversarial-verification",
  value: unknown,
): ParsedInputs["adversarial-verification"] | undefined;
export function parseBuiltinInput(
  name: "generate-and-filter",
  value: unknown,
): ParsedInputs["generate-and-filter"] | undefined;
export function parseBuiltinInput(
  name: "tournament",
  value: unknown,
): ParsedInputs["tournament"] | undefined;
export function parseBuiltinInput(
  name: "loop-until-done",
  value: unknown,
): ParsedInputs["loop-until-done"] | undefined;
export function parseBuiltinInput(
  name: "goal",
  value: unknown,
): ParsedInputs["goal"] | undefined;
export function parseBuiltinInput(
  name: "ralph",
  value: unknown,
): ParsedInputs["ralph"] | undefined;
export function parseBuiltinInput(
  name: "open-claude-design",
  value: unknown,
): ParsedInputs["open-claude-design"] | undefined;
export function parseBuiltinInput(
  name: BuiltinName,
  value: unknown,
): ParsedInputs[BuiltinName] | undefined {
  switch (name) {
    case "classify-and-act":
      return Value.Check(Inputs[name], value)
        ? {
            ...defaults[name],
            ...value,
            categories: value.categories ?? [...defaults[name].categories],
          }
        : undefined;
    case "fan-out-and-synthesize":
      return Value.Check(Inputs[name], value)
        ? { ...defaults[name], ...value }
        : undefined;
    case "adversarial-verification":
      return Value.Check(Inputs[name], value)
        ? { ...defaults[name], ...value }
        : undefined;
    case "generate-and-filter":
      return Value.Check(Inputs[name], value)
        ? { ...defaults[name], ...value }
        : undefined;
    case "tournament":
      return Value.Check(Inputs[name], value)
        ? { ...defaults[name], ...value }
        : undefined;
    case "loop-until-done":
      return Value.Check(Inputs[name], value)
        ? { ...defaults[name], ...value }
        : undefined;
    case "goal":
      return Value.Check(Inputs[name], value)
        ? { ...defaults[name], ...value }
        : undefined;
    case "ralph":
      return Value.Check(Inputs[name], value)
        ? { ...defaults[name], ...value }
        : undefined;
    case "open-claude-design":
      return Value.Check(Inputs[name], value)
        ? { ...defaults[name], ...value }
        : undefined;
  }
}

export const ClassificationSchema = Type.Object(
  {
    category: Type.String(),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    rationale: Type.String(),
  },
  Strict,
);
export const PartitionPlanSchema = Type.Object(
  {
    partitions: Type.Array(
      Type.Object({ label: NonBlank, objective: NonBlank }, Strict),
      { maxItems: 12 },
    ),
  },
  Strict,
);
export const VerifierReportSchema = Type.Object(
  {
    criterion_id: Type.String(),
    score: Type.Integer({ minimum: 1, maximum: 20 }),
    evidence: Type.Array(Type.String()),
    findings: Type.Array(
      Type.Object(
        {
          finding: Type.String(),
          severity: Type.Union([
            Type.Literal("veto"),
            Type.Literal("blocking"),
            Type.Literal("note"),
          ]),
        },
        Strict,
      ),
    ),
  },
  Strict,
);
export const FilterSchema = Type.Object(
  {
    shortlist: Type.Array(Type.String()),
    discarded: Type.Array(
      Type.Object({ path: Type.String(), reason: Type.String() }, Strict),
    ),
  },
  Strict,
);
export const JudgeSchema = Type.Object(
  { shortlist: Type.Array(Type.String()), rationale: Type.String() },
  Strict,
);
export const TournamentScoreSchema = Type.Object(
  {
    criterion_id: Type.String(),
    score_a: Type.Integer({ minimum: 1, maximum: 20 }),
    score_b: Type.Integer({ minimum: 1, maximum: 20 }),
    evidence: Type.Array(Type.String()),
  },
  Strict,
);
export const EvaluationSchema = Type.Object(
  {
    done: Type.Boolean(),
    summary: Type.String(),
    new_findings: Type.Array(Type.String()),
    failures: Type.Array(Type.String()),
    validation_evidence: Type.Array(Type.String()),
    remaining_work: Type.String(),
  },
  Strict,
);
export const ProgressSchema = Type.Object(
  {
    scores: Type.Array(
      Type.Object(
        {
          checkpoint: Positive,
          score: Type.Integer({ minimum: 1, maximum: 20 }),
        },
        Strict,
      ),
    ),
  },
  Strict,
);
export const ReviewSchema = Type.Object(
  {
    decision: Type.Union([
      Type.Literal("complete"),
      Type.Literal("continue"),
      Type.Literal("blocked"),
    ]),
    parsed: Type.Boolean(),
    stop_review_loop: Type.Boolean(),
    blocker: Type.Optional(Type.String()),
    reviewer_error: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.Object({}, { additionalProperties: true }),
      ]),
    ),
  },
  { additionalProperties: true },
);
export const DesignIntakeSchema = Type.Object(
  {
    brief: NonBlank,
    output_type: NonBlank,
    references: Type.Array(Type.String()),
  },
  Strict,
);

export const DesignDisplaySchema = Type.Object(
  {
    display_method: NonBlank,
    availability: Type.Union([
      Type.Literal("opened"),
      Type.Literal("unavailable"),
    ]),
    playwright_cli_status: NonBlank,
    spec_path: NonBlank,
    preview_path: NonBlank,
    manual_open_instructions: NonBlank,
    next_action_hint: NonBlank,
  },
  Strict,
);

export type Classification = Static<typeof ClassificationSchema>;
export type PartitionPlan = Static<typeof PartitionPlanSchema>;
export type VerifierReport = Static<typeof VerifierReportSchema>;
export type FilterDecision = Static<typeof FilterSchema>;
export type JudgeDecision = Static<typeof JudgeSchema>;
export type TournamentScore = Static<typeof TournamentScoreSchema>;
export type Evaluation = Static<typeof EvaluationSchema>;
export type Progress = Static<typeof ProgressSchema>;
export type Review = Static<typeof ReviewSchema>;
export type DesignIntake = Static<typeof DesignIntakeSchema>;
export function checked<S extends TSchema>(
  schema: S,
  value: unknown,
): Static<S> | undefined {
  return Value.Check(schema, value) ? value : undefined;
}
export function parseClassification(
  value: unknown,
): Classification | undefined {
  return checked(ClassificationSchema, value);
}
export function parseVerifierReport(
  value: unknown,
): VerifierReport | undefined {
  return checked(VerifierReportSchema, value);
}
export function parseEvaluation(value: unknown): Evaluation | undefined {
  return checked(EvaluationSchema, value);
}
export function parseReview(value: unknown): Review | undefined {
  return checked(ReviewSchema, value);
}
