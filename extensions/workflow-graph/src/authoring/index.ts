import { getAgentDir, type ExtensionAPI } from "@code-yeongyu/senpi";
import { join } from "node:path";
import { Type } from "typebox";
import { atomicBuiltins } from "../builtins/index.ts";
import type { WorkflowGraphStore } from "../store.ts";
import { createProgramHost } from "./host.ts";
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

const Params = Type.Object(
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
    inputs: Type.Optional(Type.Unknown()),
    gateId: Type.Optional(Type.String()),
    answer: Type.Optional(Type.String()),
    confirmed: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export function registerStagedWorkflows(
  pi: Pick<
    ExtensionAPI,
    | "cwd"
    | "registerTool"
    | "registerCommand"
    | "appendEntry"
    | "getAllTools"
    | "getActiveTools"
    | "executeTool"
  >,
  store: WorkflowGraphStore,
  onDecision: (runId: string | undefined, decision: ControllerDecision) => void,
) {
  let catalog = createProgramCatalog({
    cwd: pi.cwd,
    agentDir: getAgentDir(),
    bundled: (artifactRoot) =>
      atomicBuiltins(
        { subagent_type: "omo-senpi" },
        artifactRoot || join(getAgentDir(), "workflow-catalog"),
      ),
  });
  let sessionGeneration = 0;
  let catalogGeneration = 0;
  const reloadCatalog = async (context: {
    readonly cwd: string;
    readonly agentDir: string;
    isProjectTrusted(): boolean;
  }) => {
    const session = sessionGeneration,
      revision = ++catalogGeneration;
    const trusted = context.isProjectTrusted();
    const native = await nativeProgramCatalogOptions(context);
    const options: ProgramCatalogOptions = {
      cwd: context.cwd,
      agentDir: context.agentDir,
      ...native,
      bundled: (artifactRoot) =>
        atomicBuiltins(
          { subagent_type: "omo-senpi" },
          artifactRoot || join(context.cwd, ".omo", "workflow-catalog"),
        ),
    };
    const next = createProgramCatalog(options);
    await next.reload(context);
    if (
      session !== sessionGeneration ||
      revision !== catalogGeneration ||
      trusted !== context.isProjectTrusted()
    )
      throw new Error(
        "Workflow context disposed or catalog reload superseded.",
      );
    catalog = next;
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
    },
    onDecision,
    { designReview },
  );
  const host = {
    ...engine,
    stop() {
      sessionGeneration += 1;
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
              sources: catalog.sources(),
              diagnostics: catalog.diagnostics(),
            });
          case "reload":
            await reloadCatalog(context);
            return response({
              programs: host.list(),
              sources: catalog.sources(),
              diagnostics: catalog.diagnostics(),
            });
          case "start":
            await reloadCatalog(context);
            return response(
              params.key === undefined || params.inputs === undefined
                ? { kind: "rejected", reason: "Start requires key and inputs." }
                : await host.start(context, params.key, params.inputs),
            );
          case "resume":
            await reloadCatalog(context);
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
          await reloadCatalog(context);
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
        const selected =
          key ??
          (await (async () => {
            await reloadCatalog(context);
            return context.ui.select("Workflow program", [...host.list()]);
          })());
        if (selected === undefined) return;
        await reloadCatalog(context);
        const raw =
          match?.[2] ??
          (await context.ui.input(
            "Workflow inputs",
            'JSON object, for example {"prompt":"task"}',
          ));
        if (raw === undefined) return;
        if (session !== sessionGeneration)
          throw new Error("Workflow context disposed.");
        const result = await host.start(context, selected, JSON.parse(raw));
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
