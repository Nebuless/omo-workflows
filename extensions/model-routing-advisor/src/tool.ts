import type { AgentToolResult, ExtensionAPI } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import { evaluateRouteAdvice } from "./advice.ts";
import { observePublicRegistry } from "./runtime.ts";
import type {
  ModelRouteAdviceParameters,
  PublicModelRegistry,
  PublicRegistryModel,
  RouteAdviceReport,
} from "./types.ts";

const observationSchema = Type.Object(
  {
    providerId: Type.String({ minLength: 1, maxLength: 128 }),
    observedAtMs: Type.Number(),
    expiresAtMs: Type.Number(),
    coverage: Type.Union([Type.Literal("complete"), Type.Literal("partial")]),
    catalogModelIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
      maxItems: 64,
    }),
    credential: Type.Union([Type.Literal("ready"), Type.Literal("unknown")]),
    runtime: Type.Array(
      Type.Object(
        {
          modelId: Type.String({ minLength: 1, maxLength: 128 }),
          status: Type.Union([
            Type.Literal("available"),
            Type.Literal("unavailable"),
            Type.Literal("unknown"),
          ]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);

const modelRouteAdviceSchema = Type.Object(
  {
    routeKind: Type.Union([
      Type.Literal("category"),
      Type.Literal("named-agent"),
    ]),
    routeKey: Type.String({ minLength: 1, maxLength: 128 }),
    candidates: Type.Array(
      Type.Object(
        {
          providerId: Type.String({ minLength: 1, maxLength: 128 }),
          modelId: Type.String({ minLength: 1, maxLength: 128 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
    provenance: Type.Object(
      {
        source: Type.Literal("caller"),
        label: Type.Optional(Type.String({ maxLength: 128 })),
      },
      { additionalProperties: false },
    ),
    observations: Type.Optional(
      Type.Array(observationSchema, { maxItems: 64 }),
    ),
  },
  { additionalProperties: false },
);

export type ExecuteModelRouteAdviceInput<
  TModel extends PublicRegistryModel = PublicRegistryModel,
> = {
  readonly toolCallId: string;
  readonly params: ModelRouteAdviceParameters;
  readonly nowMs: number;
  readonly registry: PublicModelRegistry<TModel>;
};

export function executeModelRouteAdvice<TModel extends PublicRegistryModel>(
  input: ExecuteModelRouteAdviceInput<TModel>,
): AgentToolResult<RouteAdviceReport> {
  const publicObservations = observePublicRegistry({
    candidates: input.params.candidates,
    nowMs: input.nowMs,
    registry: input.registry,
  });
  const report = evaluateRouteAdvice({
    requestId: input.toolCallId,
    nowMs: input.nowMs,
    request: {
      routeKind: input.params.routeKind,
      routeKey: input.params.routeKey,
      candidates: input.params.candidates,
      provenance: input.params.provenance,
    },
    observations: [...publicObservations, ...(input.params.observations ?? [])],
  });
  return {
    content: [{ type: "text", text: JSON.stringify(report) }],
    details: report,
  };
}

export function registerModelRouteAdviceTool(
  pi: Pick<ExtensionAPI, "registerTool">,
): void {
  pi.registerTool({
    name: "model_route_advice",
    label: "Model route advice",
    description:
      "Return bounded read-only route availability evidence for caller-supplied candidates. Never selects a model or starts work.",
    promptSnippet:
      "Inspect caller-supplied model route evidence without changing routing or tasks.",
    parameters: modelRouteAdviceSchema,
    executionMode: "sequential",
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      return executeModelRouteAdvice({
        toolCallId,
        params,
        nowMs: Date.now(),
        registry: ctx.modelRegistry,
      });
    },
  });
}
