import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

export const AuthoredNodeSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    label: Type.Optional(Type.String()),
    category: Type.Optional(Type.String({ minLength: 1 })),
    subagent_type: Type.Optional(Type.String({ minLength: 1 })),
    model: Type.Optional(Type.String({ minLength: 1 })),
    dependsOn: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    task_summary: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    load_skills: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false },
);
export const AuthoredWorkflowSchema = Type.Object(
  {
    key: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    nodes: Type.Array(AuthoredNodeSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type AuthoredNode = Static<typeof AuthoredNodeSchema>;
export type AuthoredWorkflow = Static<typeof AuthoredWorkflowSchema>;

export type JsonOutputContract = { readonly schema: TSchema };
export type FileOutputContract = {
  readonly file: {
    readonly path: string;
    readonly schema?: TSchema;
    readonly nonempty?: boolean;
    readonly exact?: string;
  };
};
export type ProgramNode = AuthoredNode & {
  readonly output: JsonOutputContract | FileOutputContract;
  readonly invalidOutput?: "report";
};
export type Wave = {
  readonly kind: "wave";
  readonly id: string;
  readonly nodes: readonly ProgramNode[];
};
export type Gate = {
  readonly kind: "gate";
  readonly id: string;
  readonly question: string;
  readonly choices: readonly string[];
  readonly fallback?: string;
};
export type DesignReview = {
  readonly kind: "design-review";
  readonly id: "live-review";
  readonly previewPath: string;
  readonly maxModelEvents: number;
};
export type Decision =
  | Wave
  | Gate
  | DesignReview
  | { readonly kind: "final"; readonly result: unknown };
export type ProgramContext<I = unknown> = {
  readonly inputs: I;
  readonly results: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly answers: Readonly<Record<string, string>>;
  readonly answerModes?: Readonly<
    Record<string, "interactive_select" | "deterministic">
  >;
  readonly external?: Readonly<Record<string, unknown>>;
};
export interface StagedProgram<I = unknown> {
  readonly key: string;
  readonly version: number;
  readonly input: TSchema;
  decide(context: ProgramContext<I>): Decision;
}

export function createStagedProgram<I>(
  program: StagedProgram<I>,
): StagedProgram<I> {
  if (!program.key || !Number.isInteger(program.version) || program.version < 1)
    throw new Error("Invalid staged program identity.");
  return program;
}

export function validateDecision(decision: Decision): void {
  if (decision.kind === "final") return;
  if (!decision.id) throw new Error("Invalid staged decision id.");
  if (decision.kind === "design-review") {
    if (
      decision.id !== "live-review" ||
      !decision.previewPath ||
      !Number.isInteger(decision.maxModelEvents) ||
      decision.maxModelEvents < 1
    )
      throw new Error("Invalid design review decision.");
    return;
  }
  if (decision.kind === "gate") {
    if (
      !decision.question ||
      decision.choices.length === 0 ||
      new Set(decision.choices).size !== decision.choices.length ||
      decision.choices.some((choice) => !choice) ||
      (decision.fallback !== undefined &&
        !decision.choices.includes(decision.fallback))
    )
      throw new Error("Invalid staged gate.");
    return;
  }
  if (
    decision.nodes.length === 0 ||
    new Set(decision.nodes.map(({ id }) => id)).size !== decision.nodes.length
  )
    throw new Error("Invalid staged wave.");
  for (const { output, invalidOutput, ...node } of decision.nodes) {
    if (
      !Value.Check(AuthoredNodeSchema, node) ||
      (node.category === undefined) === (node.subagent_type === undefined) ||
      (node.model !== undefined && node.subagent_type === undefined)
    )
      throw new Error("Invalid authored workflow node.");
    if (invalidOutput !== undefined && invalidOutput !== "report")
      throw new Error("Invalid output failure policy.");
    if (
      !("schema" in output) &&
      (!output.file.path ||
        (output.file.schema === undefined &&
          output.file.nonempty !== true &&
          output.file.exact === undefined))
    )
      throw new Error("Invalid output contract.");
  }
}
