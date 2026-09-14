import { getAgentDir, type ExtensionAPI } from "@code-yeongyu/senpi";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { atomicBuiltins } from "../builtins/index.ts";
import type { WorkflowGraphStore } from "../store.ts";
import type { WorkflowToolRuntime } from "../task-control.ts";
import { createProgramHost } from "./host.ts";
import { pickWorkflow } from "./picker.ts";
import { TransferRequestSchema } from "./transfer-launch.ts";
import {
  createProgramCatalog,
  nativeProgramCatalogOptions,
  type ProgramCatalogOptions,
} from "./discovery.ts";
import {
  createLiveBootstrapper,
  createLiveHelperTransport,
} from "../design-review/protocol.ts";
import type { ControllerDecision } from "../execution/controller.ts";

const RecommendParams = Type.Object(
  {
    catalogRevision: Type.Integer({ minimum: 0 }),
    proposals: Type.Array(
      Type.Object(
        {
          key: Type.String({ minLength: 1 }),
          digest: Type.String({ minLength: 1 }),
          rationale: Type.String({ minLength: 1, maxLength: 240 }),
          confidence: Type.Number({ minimum: 0, maximum: 1 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 5 },
    ),
  },
  { additionalProperties: false },
);

const StartSelection = Type.Object(
  {
    key: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 0 }),
    digest: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const Params = Type.Union([
  Type.Object(
    {
      action: Type.Literal("transfer"),
      ...TransferRequestSchema.properties,
      confirmed: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("reload"),
        Type.Literal("start"),
        Type.Literal("resume"),
        Type.Literal("status"),
        Type.Literal("answer"),
        Type.Literal("cancel"),
      ]),
      key: Type.Optional(Type.String({ minLength: 1 })),
      selection: Type.Optional(StartSelection),
      inputs: Type.Optional(Type.Unknown()),
      gateId: Type.Optional(Type.String()),
      answer: Type.Optional(Type.String()),
      confirmed: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
]);

export function registerStagedWorkflows(
  pi: Pick<
    ExtensionAPI,
    "cwd" | "registerTool" | "registerCommand" | "appendEntry"
  > &
    WorkflowToolRuntime,
  store: WorkflowGraphStore,
  onDecision: (runId: string | undefined, decision: ControllerDecision) => void,
  onRecommendations?: (
    recommendations: readonly {
      readonly key: string;
      readonly title: string;
      readonly digest: string;
      readonly rationale: string;
      readonly confidence: number;
    }[],
  ) => void,
  onCatalogReload?: () => void,
) {
  let assertPublication = () => {};
  // Mutable options are owned by the serialized reload; catalog identity never changes.
  const options: ProgramCatalogOptions = {
    cwd: pi.cwd,
    agentDir: getAgentDir(),
    bundled: (artifactRoot) => {
      assertPublication();
      return atomicBuiltins(
        { subagent_type: "omo-senpi" },
        artifactRoot || join(options.agentDir, "workflow-catalog"),
      );
    },
  };
  const catalog = createProgramCatalog(options);
  let sessionGeneration = 0;
  let catalogGeneration = 0;
  let reloadChain = Promise.resolve();
  let publishedContext:
    | {
        readonly cwd: string;
        readonly agentDir: string;
        readonly trusted: boolean;
      }
    | undefined;
  const reloadCatalog = async (context: {
    readonly cwd: string;
    readonly agentDir: string;
    isProjectTrusted(): boolean;
  }) => {
    const session = sessionGeneration,
      revision = ++catalogGeneration;
    const trusted = context.isProjectTrusted();
    const native = await nativeProgramCatalogOptions(context);
    const check = () => {
      if (
        session !== sessionGeneration ||
        revision !== catalogGeneration ||
        trusted !== context.isProjectTrusted()
      )
        throw new Error(
          "Workflow context disposed or catalog reload superseded.",
        );
    };
    const publish = async () => {
      check();
      Object.assign(options, {
        cwd: context.cwd,
        agentDir: context.agentDir,
        ...native,
      });
      assertPublication = check;
      try {
        await catalog.reload({
          isProjectTrusted: () => {
            check();
            return trusted;
          },
        });
        check();
        publishedContext = {
          cwd: context.cwd,
          agentDir: context.agentDir,
          trusted,
        };
        onCatalogReload?.();
      } finally {
        assertPublication = () => {};
      }
    };
    // A failed predecessor stays visible to its caller, but does not poison later reloads.
    reloadChain = reloadChain.then(publish, publish);
    await reloadChain;
  };
  const ensureCatalog = async (
    context: Parameters<typeof reloadCatalog>[0],
  ) => {
    const session = sessionGeneration;
    if (
      publishedContext?.cwd !== context.cwd ||
      publishedContext.agentDir !== context.agentDir ||
      publishedContext.trusted !== context.isProjectTrusted()
    )
      await reloadCatalog(context);
    else await reloadChain;
    if (session !== sessionGeneration)
      throw new Error("Workflow context disposed.");
  };
  const scripts = process.env.OMO_IMPECCABLE_SCRIPTS;
  const designReview =
    scripts === undefined
      ? undefined
      : {
          bootstrap: async ({
            cwd,
            target,
            signal,
          }: {
            cwd: string;
            target: string;
            signal?: AbortSignal;
          }) =>
            (
              await createLiveBootstrapper({
                script: join(scripts, "live.mjs"),
                cwd,
              })
            )({ target, signal }),
          createTransport: ({ cwd }: { cwd: string }) =>
            createLiveHelperTransport({
              script: join(scripts, "live-poll.mjs"),
              cwd,
            }),
        };
  const engine = createProgramHost(
    pi,
    {
      list: () => catalog.list(),
      get: (key, artifactRoot) => catalog.get(key, artifactRoot),
      requiresExplicitResume: (key) => catalog.requiresExplicitResume(key),
      identity: (key) => {
        const descriptor = catalog
          .snapshot()
          .descriptors.find((item) => item.key === key);
        return descriptor === undefined
          ? undefined
          : {
              revision: catalog.snapshot().revision,
              digest: descriptor.digest,
            };
      },
    },
    onDecision,
    { designReview },
  );
  const host = {
    ...engine,
    stop() {
      sessionGeneration += 1;
      publishedContext = undefined;
      engine.stop();
    },
  };
  const unsubscribe = store.subscribe((projection) => {
    const runId = host.status()?.runId;
    if (runId === undefined) return;
    const run = projection.runs.find((item) => item.runId === runId);
    if (
      run !== undefined &&
      ["completed", "failed", "cancelled"].includes(run.status)
    )
      void host.settled(runId);
  });
  const response = (details: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  });
  pi.registerTool({
    name: "workflow_recommend",
    label: "Workflow recommend",
    description:
      "Validate whole workflow recommendation set against fresh catalog snapshot without launching programs.",
    parameters: RecommendParams,
    executionMode: "sequential",
    async execute(_id, params, _signal, _update, context) {
      try {
        await ensureCatalog(context);
        const snapshot = catalog.snapshot();
        const proposals = params.proposals;
        const controlPattern = /\p{Cc}/u;
        const valid =
          params.catalogRevision === snapshot.revision &&
          proposals.length >= 1 &&
          proposals.length <= 5 &&
          proposals.every(
            (proposal) =>
              snapshot.descriptors.some(
                (descriptor) =>
                  descriptor.key === proposal.key &&
                  descriptor.digest === proposal.digest,
              ) &&
              proposals.filter((item) => item.key === proposal.key).length ===
                1 &&
              proposal.rationale.trim().length >= 1 &&
              proposal.rationale.length <= 240 &&
              !controlPattern.test(proposal.rationale) &&
              Number.isFinite(proposal.confidence) &&
              proposal.confidence >= 0 &&
              proposal.confidence <= 1,
          );
        if (!valid)
          return response({
            kind: "rejected",
            reason: "Invalid workflow recommendations.",
          });
        const recommendations = proposals.map((proposal) => ({
          ...proposal,
          title:
            snapshot.descriptors.find(
              (descriptor) => descriptor.key === proposal.key,
            )?.title ?? proposal.key,
        }));
        onRecommendations?.(recommendations);
        return response({
          kind: "recommended",
          catalogRevision: snapshot.revision,
          recommendations,
        });
      } catch (error) {
        return response({
          kind: "rejected",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
  pi.registerTool({
    name: "workflow_program",
    label: "Workflow program",
    description:
      "Run staged Atomic workflows or explicit trusted project module paths. Only admitted outputs unlock later native DAG nodes. Answer human gates only with explicit user choice; cancel requires confirmed true.",
    parameters: Params,
    executionMode: "sequential",
    async execute(_id, params, _signal, _update, context) {
      try {
        switch (params.action) {
          case "list":
            await reloadCatalog(context);
            return response({
              programs: host.list(),
              revision: catalog.snapshot().revision,
              sources: catalog.sources(),
              diagnostics: catalog.diagnostics(),
              descriptors: catalog.descriptors(),
            });
          case "reload":
            await reloadCatalog(context);
            return response({
              programs: host.list(),
              revision: catalog.snapshot().revision,
              sources: catalog.sources(),
              diagnostics: catalog.diagnostics(),
              descriptors: catalog.descriptors(),
            });
          case "start":
            await ensureCatalog(context);
            return response(
              params.selection === undefined || params.inputs === undefined
                ? {
                    kind: "rejected",
                    reason: "Start requires selection and inputs.",
                  }
                : await host.start(context, params.selection, params.inputs),
            );
          case "transfer": {
            if (params.confirmed === true) await ensureCatalog(context);
            const { action: _, ...request } = params;
            return response(await host.transfer(context, request));
          }
          case "resume":
            await ensureCatalog(context);
            return response(
              (await host.restore(context, params.key)) ?? { kind: "idle" },
            );
          case "status":
            return response(host.status() ?? { kind: "idle" });
          case "answer":
            return response(
              params.gateId === undefined || params.answer === undefined
                ? {
                    kind: "rejected",
                    reason: "Answer requires gateId and answer.",
                  }
                : await host.answer(params.gateId, params.answer),
            );
          case "cancel":
            return response(
              params.confirmed === true
                ? await host.cancel()
                : {
                    kind: "rejected",
                    reason: "Explicit cancellation confirmation required.",
                  },
            );
        }
      } catch (error) {
        return response({
          kind: "rejected",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
  pi.registerCommand("workflow-run", {
    description:
      "Launch builtin or trusted module: key JSON; use resume [module], status, answer, or cancel for current program",
    handler: async (args, context) => {
      const match = args.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
      const key = match?.[1];
      const session = sessionGeneration;
      try {
        if (key === "resume") {
          await ensureCatalog(context);
          context.ui.notify(
            JSON.stringify(
              (await host.restore(context, match?.[2])) ?? { kind: "idle" },
            ),
            "info",
          );
          return;
        }
        if (key === "status") {
          context.ui.notify(
            JSON.stringify(host.status() ?? { kind: "idle" }),
            "info",
          );
          return;
        }
        if (key === "reload" || key === "list") {
          await reloadCatalog(context);
          context.ui.notify(
            JSON.stringify({
              programs: host.list(),
              sources: catalog.sources(),
              diagnostics: catalog.diagnostics(),
            }),
            "info",
          );
          return;
        }
        if (key === "transfer") {
          const raw =
            match?.[2] ??
            (await context.ui.input(
              "Workflow transfer",
              "JSON with sourceRunId, selection, and manifest",
            ));
          if (raw === undefined) return;
          const request: unknown = JSON.parse(raw);
          const confirmed = await context.ui.confirm(
            "Transfer completed workflow",
            "Copy verified artifacts and start a distinct workflow run? Source run stays unchanged.",
          );
          if (session !== sessionGeneration)
            throw new Error("Workflow context disposed.");
          if (confirmed) await ensureCatalog(context);
          const result = await host.transfer(context, {
            ...(Value.Check(
              Type.Object({}, { additionalProperties: true }),
              request,
            )
              ? request
              : {}),
            confirmed,
          });
          context.ui.notify(
            JSON.stringify(result),
            result.kind === "rejected" ||
              result.kind === "durability-unavailable"
              ? "warning"
              : "info",
          );
          return;
        }
        if (key === "cancel") {
          if (
            await context.ui.confirm(
              "Cancel workflow program",
              "Cancel this program and its native DAG tasks?",
            )
          )
            await host.cancel();
          return;
        }
        const decision = host.status()?.decision;
        if (
          (key === undefined || key === "answer") &&
          decision?.kind === "gate"
        ) {
          const answer = await context.ui.select(decision.question, [
            ...decision.choices,
          ]);
          if (answer !== undefined) await host.answer(decision.id, answer);
          return;
        }
        await reloadCatalog(context);
        const snapshot = catalog.snapshot();
        const descriptor =
          key === undefined
            ? await pickWorkflow(context.ui, snapshot.descriptors)
            : snapshot.descriptors.find((item) => item.key === key);
        if (descriptor === undefined) return;
        const raw =
          match?.[2] ??
          (await context.ui.input(
            "Workflow inputs",
            'JSON object, for example {"prompt":"task"}',
          ));
        if (raw === undefined) return;
        if (session !== sessionGeneration)
          throw new Error("Workflow context disposed.");
        let inputs: unknown;
        try {
          inputs = JSON.parse(raw);
        } catch (error) {
          throw new Error(
            `Invalid workflow inputs JSON: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const result = await host.start(
          context,
          {
            key: descriptor.key,
            revision: snapshot.revision,
            digest: descriptor.digest,
          },
          inputs,
        );
        context.ui.notify(
          JSON.stringify(result),
          result.kind === "rejected" || result.kind === "durability-unavailable"
            ? "warning"
            : "info",
        );
      } catch (error) {
        context.ui.notify(
          error instanceof Error ? error.message : String(error),
          "warning",
        );
      }
    },
  });
  return {
    host,
    dispose: () => {
      host.stop();
      unsubscribe();
    },
  };
}
