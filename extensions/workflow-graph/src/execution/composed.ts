import { createHash } from "node:crypto";
import { Type } from "typebox";
import type {
  Decision,
  ProgramContext,
  ProgramNode,
  StagedProgram,
} from "./policy.ts";
import {
  applyCompositionMapping,
  compositionDigest,
  compositionNamespace,
  validateComposition,
  type CompositionMapping,
} from "./composition.ts";

export type CompositionStage = {
  readonly workflowKey: string;
  readonly descriptorDigest: string;
  readonly program: StagedProgram;
};
export const ComposedIdentitySchema = Type.Object(
  {
    stageSelections: Type.Array(
      Type.Tuple([Type.String(), Type.Integer({ minimum: 0 }), Type.String()]),
    ),
    mappings: Type.Array(
      Type.Array(
        Type.Object(
          { source: Type.String(), destination: Type.String() },
          { additionalProperties: false },
        ),
      ),
    ),
    preapproved: Type.Boolean(),
    planDigest: Type.String({ pattern: "^sha256:v1:[0-9a-f]{64}$" }),
  },
  { additionalProperties: false },
);
export type CompositionIdentity = {
  readonly stageSelections: readonly (readonly [string, number, string])[];
  readonly mappings: readonly (readonly CompositionMapping[])[];
  readonly preapproved: boolean;
  readonly planDigest: string;
};
export type CompositionPlan = {
  readonly key: string;
  readonly version: number;
  readonly stages: readonly CompositionStage[];
  readonly mappings: readonly (readonly CompositionMapping[])[];
  readonly preapproved?: boolean;
  readonly compositionIdentity?: Pick<
    CompositionIdentity,
    "stageSelections" | "mappings"
  >;
};

function planDigest(plan: CompositionPlan): string {
  const bytes = JSON.stringify({
    key: plan.key,
    version: plan.version,
    preapproved: plan.preapproved === true,
    stages: plan.stages.map((stage) => ({
      workflowKey: stage.workflowKey,
      descriptorDigest: stage.descriptorDigest,
      key: stage.program.key,
      version: stage.program.version,
      input: stage.program.input,
      compositionIdentity: stage.program.compositionIdentity,
    })),
    mappings: plan.mappings,
    selections: plan.compositionIdentity?.stageSelections,
  });
  return `sha256:v1:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

function stageEntries<T>(
  entries: Readonly<Record<string, T>>,
  prefix: string,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(entries)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );
}

export function composeStagedPrograms(plan: CompositionPlan): StagedProgram {
  if (plan.stages.length < 2 || plan.mappings.length !== plan.stages.length - 1)
    throw new Error("Invalid composition plan.");
  const validate = (nativeNodeCount: number) => {
    const identity = { key: plan.key, version: plan.version };
    for (const mappings of plan.mappings)
      validateComposition({
        identity: {
          ...identity,
          digest: compositionDigest(identity, mappings),
        },
        mappings,
        nativeNodeCount,
      });
  };
  validate(0);
  const digest = planDigest(plan);
  const stageDeciders = plan.stages.map((stage) => stage.program.decide);
  const compositionIdentity: CompositionIdentity = {
    stageSelections: structuredClone(
      plan.compositionIdentity?.stageSelections ??
        plan.stages.map(
          (stage) => [stage.workflowKey, 0, stage.descriptorDigest] as const,
        ),
    ),
    mappings: structuredClone(plan.mappings),
    preapproved: plan.preapproved === true,
    planDigest: digest,
  };
  if (plan.stages.some((stage) => stage.workflowKey !== stage.program.key))
    throw new Error("Composition workflow key mismatch.");
  const input = plan.stages[0]?.program.input;
  if (input === undefined) throw new Error("Invalid composition plan.");
  return {
    key: plan.key,
    version: plan.version,
    input,
    compositionIdentity,
    decide(context: ProgramContext): Decision {
      if (
        planDigest(plan) !== digest ||
        plan.stages.some(
          (stage, index) => stage.program.decide !== stageDeciders[index],
        )
      )
        throw new Error("Workflow catalog changed; choose again.");
      let stageInput: unknown = context.inputs;
      for (let index = 0; index < plan.stages.length; index += 1) {
        const stage = plan.stages[index];
        if (stage === undefined) throw new Error("Invalid composition plan.");
        const prefix = `${compositionNamespace(index, stage.workflowKey)}:`;
        const localResults = Object.fromEntries(
          Object.entries(stageEntries(context.results, prefix)).map(
            ([key, value]) => [key, stageEntries(value, prefix)],
          ),
        );
        const decision = stage.program.decide({
          ...context,
          inputs: stageInput,
          results: localResults,
          answers: stageEntries(context.answers, prefix),
          ...(context.answerModes === undefined
            ? {}
            : { answerModes: stageEntries(context.answerModes, prefix) }),
          ...(context.external === undefined
            ? {}
            : { external: stageEntries(context.external, prefix) }),
        });
        const approvalId = `compose-${plan.key}-${index}`;
        const nextStage = plan.stages[index + 1];
        const nextPrefix =
          nextStage === undefined
            ? undefined
            : `${compositionNamespace(index + 1, nextStage.workflowKey)}:`;
        if (
          decision.kind !== "final" &&
          (context.answers[approvalId] !== undefined ||
            (nextPrefix !== undefined &&
              Object.keys(context.results).some((key) =>
                key.startsWith(nextPrefix),
              )))
        )
          throw new Error("Composition source did not finish.");
        switch (decision.kind) {
          case "wave":
            validate(
              Object.values(context.results).reduce(
                (count, results) => count + Object.keys(results).length,
                0,
              ) + decision.nodes.length,
            );
            return {
              ...decision,
              id: `${prefix}${decision.id}`,
              nodes: decision.nodes.map((node: ProgramNode) => ({
                ...node,
                id: `${prefix}${node.id}`,
                dependsOn: node.dependsOn?.map((id) => `${prefix}${id}`),
              })),
            };
          case "gate":
            return { ...decision, id: `${prefix}${decision.id}` };
          case "design-review":
            return decision;
          case "final":
            break;
          default:
            return decision satisfies never;
        }
        if (index === plan.stages.length - 1) return decision;
        if (!plan.preapproved && context.answers[approvalId] === undefined)
          return {
            kind: "gate",
            id: approvalId,
            question: "Continue composed workflow?",
            choices: ["continue", "stop"],
          };
        if (context.answers[approvalId] === "stop")
          return { kind: "final", result: decision.result };
        if (nextStage === undefined)
          throw new Error("Composition source did not finish.");
        stageInput = applyCompositionMapping(
          decision.result,
          {},
          plan.mappings[index] ?? [],
          nextStage.program.input,
        );
      }
      return { kind: "final", result: stageInput };
    },
  };
}
