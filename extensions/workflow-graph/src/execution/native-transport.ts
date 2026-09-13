import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { AuthoredWorkflow } from "./policy.ts";
import type { WorkflowToolRuntime } from "../task-control.ts";

const Identity = { run_id: Type.String({ minLength: 1 }) };
const SnapshotSchema = Type.Object({
  runId: Type.String(),
  runKey: Type.String(),
  status: Type.String(),
  definitionFingerprint: Type.String(),
  nodes: Type.Array(Type.Object({ id: Type.String(), state: Type.String() })),
});
const DetailsSchema = Type.Union([
  Type.Object({ kind: Type.Literal("started"), ...Identity }),
  Type.Object({ kind: Type.Literal("amended"), ...Identity }),
  Type.Object({
    kind: Type.Literal("snapshot"),
    ...Identity,
    snapshot: SnapshotSchema,
  }),
  Type.Object({
    kind: Type.Literal("waited"),
    ...Identity,
    result: Type.Object({
      runId: Type.String(),
      status: Type.String(),
      nodes: Type.Record(
        Type.String(),
        Type.Object({
          state: Type.String(),
          output: Type.Optional(Type.String()),
        }),
      ),
    }),
  }),
  Type.Object({ kind: Type.Literal("cancelled"), ...Identity }),
  Type.Object({
    kind: Type.Literal("error"),
    error: Type.Object({ code: Type.String(), message: Type.String() }),
  }),
]);
export type NativeDetails = Static<typeof DetailsSchema>;
export type NativeParams =
  | { readonly action: "start"; readonly definition: AuthoredWorkflow }
  | {
      readonly action: "amend";
      readonly run_id: string;
      readonly definition: AuthoredWorkflow;
    }
  | { readonly action: "snapshot"; readonly run_id: string }
  | { readonly action: "wait"; readonly run_id: string; readonly detach: false }
  | { readonly action: "cancel"; readonly run_id: string };
export interface NativeWorkflowTransport {
  execute(params: NativeParams): Promise<{
    readonly content: readonly unknown[];
    readonly details: NativeDetails;
  }>;
}
export function createNativeWorkflowTransport(
  runtime: WorkflowToolRuntime,
): NativeWorkflowTransport {
  return {
    async execute(params) {
      const tool = runtime
        .getAllTools()
        .find(({ name }) => name === "workflow");
      if (tool === undefined || !Value.Check(tool.parameters, params))
        return {
          content: [],
          details: {
            kind: "error",
            error: {
              code: "unavailable",
              message: "Native workflow capability unavailable.",
            },
          },
        };
      const reply = await runtime.executeTool("workflow", params, {
        activateInactiveTool: true,
      });
      if (!Value.Check(DetailsSchema, reply.details))
        return {
          content: [],
          details: {
            kind: "error",
            error: {
              code: "invalid_native_result",
              message: "Native workflow response failed validation.",
            },
          },
        };
      return { content: reply.content, details: reply.details };
    },
  };
}
