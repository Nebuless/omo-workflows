import { dirname, join } from "node:path";
import type { ExtensionContext } from "@code-yeongyu/senpi";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  createStagedController,
  type ControllerDecision,
  type StagedController,
} from "../execution/controller.ts";
import { createNativeStagedJournal } from "../execution/native-journal.ts";
import { createNativeWorkflowTransport } from "../execution/native-transport.ts";
import type { StagedProgram } from "../execution/policy.ts";
import type { WorkflowToolRuntime } from "../task-control.ts";
import { loadAuthoredProgram } from "./discovery.ts";
import {
  createDesignReviewDriver,
  replayDesignReviewExit,
  type DesignReviewJournal,
} from "../design-review/driver.ts";
import type {
  LiveBootstrapper,
  LiveHelperTransport,
  LiveEvent,
  ModelEventResult,
} from "../design-review/protocol.ts";

export const LAUNCH_ENTRY_TYPE = "omo-workflow-graph:staged-launch";
const LaunchSchema = Type.Object(
  {
    key: Type.String(),
    instance: Type.String(),
    version: Type.Integer({ minimum: 1 }),
    inputs: Type.Unknown(),
    artifactRoot: Type.String(),
  },
  { additionalProperties: false },
);
export interface ProgramRegistry {
  list(): readonly string[];
  get(key: string, artifactRoot: string): StagedProgram | undefined;
  requiresExplicitResume?(key: string): boolean;
}
export type ProgramHost = ReturnType<typeof createProgramHost>;
export type ProgramContext = Pick<
  ExtensionContext,
  "cwd" | "isProjectTrusted"
> & {
  readonly ui?: {
    select(question: string, choices: string[]): Promise<string | undefined>;
  };
  readonly sessionManager: {
    getBranch(): readonly unknown[];
    readonly isPersisted?: unknown;
    readonly flushEntries?: unknown;
  };
};
export type DesignReviewEffectConfig = {
  readonly bootstrap: (input: {
    readonly cwd: string;
    readonly target: string;
    readonly signal?: AbortSignal;
  }) => ReturnType<LiveBootstrapper>;
  readonly createTransport: (input: {
    readonly cwd: string;
    readonly previewPath: string;
  }) => Promise<LiveHelperTransport>;
};
type ModelWaiter = ReturnType<typeof Promise.withResolvers<ModelEventResult>>;
export function createProgramHost(
  runtime: WorkflowToolRuntime & {
    appendEntry(type: string, data: unknown): void;
  },
  registry: ProgramRegistry,
  notify: (runId: string | undefined, decision: ControllerDecision) => void,
  options: { readonly designReview?: DesignReviewEffectConfig } = {},
) {
  let active:
    | {
        controller: StagedController;
        decision?: ControllerDecision;
        instance: string;
        generation: number;
        context: ProgramContext;
        journal: DesignReviewJournal;
        effect?: { abort: AbortController; promise: Promise<void> };
        waiters: Map<string, ModelWaiter>;
      }
    | undefined;
  let generation = 0;
  let launching: number | undefined;
  let chain = Promise.resolve();
  let latestError: string | undefined;
  const abortEffect = (current: NonNullable<typeof active>): void => {
    current.effect?.abort.abort();
    for (const waiter of current.waiters.values())
      waiter.reject(
        new DOMException("Workflow context disposed.", "AbortError"),
      );
    current.waiters.clear();
  };
  const stop = () => {
    generation += 1;
    if (active !== undefined) abortEffect(active);
    active = undefined;
    launching = undefined;
    latestError = undefined;
  };
  const report = (
    current: NonNullable<typeof active>,
    decision: ControllerDecision,
  ) => {
    if (active !== current || current.generation !== generation) return;
    current.decision = decision;
    notify(current.controller.checkpoint().runId, decision);
  };
  const pump = async (
    current: NonNullable<typeof active>,
  ): Promise<ControllerDecision> => {
    for (;;) {
      if (active !== current || current.generation !== generation)
        throw new Error("Workflow context disposed.");
      const decision = await current.controller.advance();
      report(current, decision);
      if (
        decision.kind === "rejected" ||
        decision.kind === "durability-unavailable"
      ) {
        const error = new Error(
          decision.kind === "rejected"
            ? decision.reason
            : "Workflow durability unavailable.",
        );
        for (const waiter of current.waiters.values()) waiter.reject(error);
        current.waiters.clear();
      }
      for (const [key, waiter] of current.waiters) {
        const eventNumber =
          Object.keys(current.controller.checkpoint().external ?? {})
            .filter((id) => id.startsWith(`${current.instance}:`))
            .indexOf(key) + 1;
        const value =
          current.controller.checkpoint().results[
            `live-model-${eventNumber}`
          ]?.[`live-model-${eventNumber}`];
        if (value !== undefined) {
          waiter.resolve(value as ModelEventResult);
          current.waiters.delete(key);
        }
      }
      if (decision.kind === "design-review") {
        await startDesignReview(
          current,
          decision.previewPath,
          decision.maxModelEvents,
        );
        return current.decision ?? decision;
      }
      if (decision.kind === "gate" && decision.fallback !== undefined) {
        let answer: string | undefined;
        try {
          answer = await current.context.ui?.select(decision.question, [
            ...decision.choices,
          ]);
        } catch {
          answer = undefined;
        }
        if (active !== current || current.generation !== generation)
          throw new Error("Workflow context disposed.");
        if (answer !== undefined && !decision.choices.includes(answer))
          return { kind: "rejected", reason: "Invalid gate selection." };
        const selected = answer ?? decision.fallback;
        const resolved = await current.controller.answerGate(
          decision.id,
          selected,
          answer === undefined ? "deterministic" : "interactive_select",
        );
        report(current, resolved);
        if (resolved.kind === "wave") continue;
        return resolved;
      }
      if (decision.kind !== "wave") return decision;
    }
  };
  const startDesignReview = async (
    current: NonNullable<typeof active>,
    previewPath: string,
    maxModelEvents: number,
  ): Promise<void> => {
    if (current.effect !== undefined) return;
    const designReview = options.designReview;
    if (designReview === undefined) {
      report(
        current,
        await current.controller.fail(
          "Design review helper is not configured.",
        ),
      );
      return;
    }
    const abort = new AbortController();
    const reviewCwd = dirname(previewPath);
    const promise = (async () => {
      const priorExit = replayDesignReviewExit(
        current.journal,
        current.instance,
      );
      if (priorExit !== undefined) {
        const decision = await current.controller.recordExternal(
          "live.exit",
          priorExit,
        );
        if (decision.kind === "wave") await pump(current);
        else report(current, decision);
        return;
      }
      await designReview.bootstrap({
        cwd: reviewCwd,
        target: previewPath,
        signal: abort.signal,
      });
      if (
        abort.signal.aborted ||
        active !== current ||
        current.generation !== generation
      )
        throw new DOMException("Workflow context disposed.", "AbortError");
      const transport = await designReview.createTransport({
        cwd: reviewCwd,
        previewPath,
      });
      if (
        abort.signal.aborted ||
        active !== current ||
        current.generation !== generation
      )
        throw new DOMException("Workflow context disposed.", "AbortError");
      const driver = createDesignReviewDriver({
        session: current.instance,
        transport,
        journal: current.journal,
        host: {
          runModel: async (eventKey: string, event: LiveEvent) => {
            const existingKeys = Object.keys(
              current.controller.checkpoint().external ?? {},
            ).filter((id) => id.startsWith(`${current.instance}:`));
            const existingIndex = existingKeys.indexOf(eventKey) + 1;
            if (existingIndex > 0) {
              const existing =
                current.controller.checkpoint().results[
                  `live-model-${existingIndex}`
                ]?.[`live-model-${existingIndex}`];
              if (existing !== undefined) return existing as ModelEventResult;
            }
            if (
              existingIndex === 0 &&
              (existingKeys.length >= maxModelEvents ||
                (current.controller.checkpoint().definition?.nodes.length ??
                  0) >= 63)
            )
              throw new Error(
                "Live review reached native 64-node limit with one export node reserved.",
              );
            const decision = await current.controller.recordExternal(
              eventKey,
              event,
            );
            if (
              decision.kind === "rejected" ||
              decision.kind === "durability-unavailable"
            )
              throw new Error(
                decision.kind === "rejected"
                  ? decision.reason
                  : "Design review journal unavailable.",
              );
            report(current, decision);
            const waiter =
              current.waiters.get(eventKey) ??
              Promise.withResolvers<ModelEventResult>();
            current.waiters.set(eventKey, waiter);
            if (decision.kind === "wave") await pump(current);
            return waiter.promise;
          },
        },
      });
      const outcome = await driver.run(abort.signal);
      const decision = await current.controller.recordExternal(
        "live.exit",
        outcome.event,
      );
      if (
        decision.kind === "rejected" ||
        decision.kind === "durability-unavailable"
      )
        throw new Error(
          decision.kind === "rejected"
            ? decision.reason
            : "Design review exit journal unavailable.",
        );
      report(current, decision);
      if (decision.kind === "wave") await pump(current);
      else if (decision.kind === "final") report(current, decision);
    })().catch(async (error: unknown) => {
      if (
        abort.signal.aborted ||
        active !== current ||
        current.generation !== generation
      )
        return;
      const reason = error instanceof Error ? error.message : String(error);
      const decision = await current.controller.fail(reason);
      for (const waiter of current.waiters.values())
        waiter.reject(new Error(reason));
      current.waiters.clear();
      report(current, decision);
    });
    current.effect = { abort, promise };
  };
  const queue = (current: NonNullable<typeof active>) => {
    chain = chain
      .then(async () => {
        if (active === current && current.generation === generation)
          await pump(current);
      })
      .catch((error: unknown) => {
        if (active !== current || current.generation !== generation) return;
        latestError = error instanceof Error ? error.message : String(error);
        report(current, { kind: "rejected", reason: latestError });
      });
    return chain;
  };
  const activate = async (
    context: ProgramContext,
    saved: {
      key: string;
      instance: string;
      version: number;
      inputs: unknown;
      artifactRoot: string;
    },
    restore: boolean,
    explicitKey?: string,
  ): Promise<ControllerDecision> => {
    const fence = generation;
    const journal = createNativeStagedJournal(runtime, context.sessionManager);
    if (journal === undefined) return { kind: "durability-unavailable" };
    let program = registry.get(saved.key, saved.artifactRoot);
    if (
      restore &&
      explicitKey !== saved.key &&
      (explicitKey !== undefined ||
        registry.requiresExplicitResume?.(saved.key))
    )
      return {
        kind: "rejected",
        reason: "Authored module must be loaded explicitly after restart.",
      };
    if (program === undefined) {
      if (restore && explicitKey !== saved.key)
        return {
          kind: "rejected",
          reason: "Authored module must be loaded explicitly after restart.",
        };
      program = await loadAuthoredProgram(saved.key, context);
    }
    if (restore && program.version !== saved.version)
      return { kind: "rejected", reason: "Program version changed." };
    if (generation !== fence) throw new Error("Workflow context disposed.");
    const native = createNativeWorkflowTransport(runtime);
    const scopedProgram = { ...program, key: saved.instance };
    const guarded = {
      getBranch: () => (restore ? journal.getBranch() : []),
      appendEntry: async (type: string, data: unknown) => {
        if (generation !== fence) throw new Error("Workflow context disposed.");
        await journal.appendEntry(type, data);
      },
    };
    const controller = createStagedController({
      native: {
        execute: async (params) => {
          if (generation !== fence)
            throw new Error("Workflow context disposed.");
          return native.execute(params);
        },
      },
      journal: guarded,
      program: scopedProgram,
      inputs: saved.inputs,
      readArtifact: async (path) => Bun.file(path).text(),
    });
    if (!restore)
      await journal.appendEntry(LAUNCH_ENTRY_TYPE, {
        ...saved,
        version: program.version,
      });
    if (generation !== fence) throw new Error("Workflow context disposed.");
    const current = {
      controller,
      instance: saved.instance,
      generation: fence,
      context,
      journal,
      waiters: new Map<string, ModelWaiter>(),
    };
    active = current;
    latestError = undefined;
    return pump(current);
  };
  return {
    list: () => registry.list(),
    status: () =>
      active === undefined
        ? undefined
        : {
            instance: active.instance,
            runId: active.controller.checkpoint().runId,
            decision: active.decision,
            error: latestError,
          },
    stop,
    async start(
      context: ProgramContext,
      key: string,
      inputs: unknown,
    ): Promise<ControllerDecision> {
      if (
        launching !== undefined ||
        (active !== undefined &&
          active.decision?.kind !== "final" &&
          active.decision?.kind !== "rejected")
      )
        return {
          kind: "rejected",
          reason:
            "Current program must finish or be cancelled before new launch.",
        };
      const instance = `${key.replace(/[^a-zA-Z0-9_-]/g, "-")}:${crypto.randomUUID()}`;
      const fence = ++generation;
      launching = fence;
      try {
        return await activate(
          context,
          {
            key,
            instance,
            version: 1,
            inputs,
            artifactRoot: join(
              context.cwd,
              ".omo",
              "workflow-artifacts",
              instance.replace(":", "-"),
            ),
          },
          false,
        );
      } finally {
        if (launching === fence) launching = undefined;
      }
    },
    async restore(context: ProgramContext, explicitKey?: string) {
      stop();
      let saved: Static<typeof LaunchSchema> | undefined;
      for (const entry of context.sessionManager.getBranch()) {
        if (
          entry !== null &&
          typeof entry === "object" &&
          "customType" in entry &&
          entry.customType === LAUNCH_ENTRY_TYPE &&
          "data" in entry &&
          Value.Check(LaunchSchema, entry.data)
        )
          saved = entry.data;
      }
      if (saved !== undefined) {
        launching = generation;
        const fence = generation;
        try {
          const decision = await activate(context, saved, true, explicitKey);
          if (active === undefined && generation === fence)
            notify(undefined, decision);
          return decision;
        } finally {
          if (launching === fence) launching = undefined;
        }
      }
    },
    whenIdle: () => active?.effect?.promise ?? chain,
    settled(runId: string) {
      const current = active;
      return current?.controller.checkpoint().runId === runId
        ? queue(current)
        : Promise.resolve();
    },
    async answer(id: string, answer: string): Promise<ControllerDecision> {
      const current = active;
      if (current === undefined)
        return { kind: "rejected", reason: "No active program." };
      const decision = await current.controller.answerGate(id, answer);
      if (decision.kind === "wave") return pump(current);
      if (decision.kind === "design-review") {
        report(current, decision);
        await startDesignReview(
          current,
          decision.previewPath,
          decision.maxModelEvents,
        );
        return current.decision ?? decision;
      }
      if (decision.kind !== "rejected") report(current, decision);
      return decision;
    },
    async cancel(): Promise<ControllerDecision> {
      const current = active;
      if (current === undefined)
        return { kind: "rejected", reason: "No active program." };
      abortEffect(current);
      const decision = await current.controller.cancel();
      report(current, decision);
      return decision;
    },
  };
}
