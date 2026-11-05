import {
  journal,
  selectionActorDigest,
  type ModelRef,
  type RecoveryRecord,
} from "./journal.ts";

interface Entry {
  readonly type: string;
  readonly id: string;
  readonly customType?: string;
  readonly message?: { readonly role: string };
  readonly data?: unknown;
  readonly details?: unknown;
  readonly provider?: string;
  readonly modelId?: string;
  readonly source?: string;
  readonly actor?: string;
}

export interface RecoveryContext<M extends ModelRef> {
  readonly agentDir: string;
  readonly sessionId: string;
  readonly entries: readonly Entry[];
  readonly model: M | undefined;
  readonly models: readonly M[];
  readonly pending: boolean;
}

interface RecoveryHost<M extends ModelRef> {
  readonly current: () => RecoveryContext<M>;
  readonly select: (model: M) => Promise<boolean>;
  readonly send: () => void;
  readonly notify: (message: string) => void;
}

function rules(value: unknown): readonly unknown[] {
  return typeof value === "object" &&
    value !== null &&
    "rules" in value &&
    Array.isArray(value.rules)
    ? value.rules
    : [];
}

export function createRecovery<M extends ModelRef>(
  host: RecoveryHost<M>,
  selector: string,
) {
  // allow: SIZE_OK — one at-most-once lifecycle state machine owns eligibility, interruption, and restoration.
  // Mutable state belongs to this lifecycle adapter; durable claims survive its replacement.
  let run:
    | {
        readonly sessionId: string;
        readonly observing: boolean;
        readonly branch: readonly string[];
        readonly userId: string | undefined;
        readonly seen: Set<string>;
      }
    | undefined;
  let exhaustion:
    | {
        readonly run: NonNullable<typeof run>;
        readonly branch: readonly string[];
        readonly userId: string;
        readonly stopId: string;
        readonly rule: "collapse-repetition" | "repetitive-turns";
      }
    | undefined;
  const latestUser = (ctx: RecoveryContext<M>) =>
    [...ctx.entries]
      .reverse()
      .find(
        (entry) => entry.type === "message" && entry.message?.role === "user",
      );
  const follows = (ctx: RecoveryContext<M>, branch: readonly string[]) =>
    branch.every((id, index) => ctx.entries[index]?.id === id);
  const invalidate = (): void => {
    run = undefined;
    exhaustion = undefined;
  };
  const snapshot = (ctx: RecoveryContext<M>, observing: boolean): void => {
    exhaustion = undefined;
    run = {
      sessionId: ctx.sessionId,
      observing,
      branch: ctx.entries.map((entry) => entry.id),
      userId: latestUser(ctx)?.id,
      seen: new Set(ctx.entries.map((entry) => entry.id)),
    };
  };
  const eligible = (
    ctx: RecoveryContext<M>,
    evidence: NonNullable<typeof exhaustion>,
  ): boolean =>
    run === evidence.run &&
    ctx.sessionId === evidence.run.sessionId &&
    latestUser(ctx)?.id === evidence.userId &&
    follows(ctx, evidence.branch) &&
    !ctx.pending &&
    !ctx.entries.some(
      (entry) =>
        !evidence.run.branch.includes(entry.id) &&
        entry.type === "custom" &&
        entry.customType === "deadline-stop",
    );
  let active:
    | {
        store: ReturnType<typeof journal>;
        record: RecoveryRecord;
        userId: string;
        failureId: string;
        admitted: boolean;
        outcome: string;
        sessionId: string;
        cancelled: boolean;
        switching: boolean;
        cleaning: boolean;
        readonly before: readonly string[];
        selectionSucceeded?: boolean;
      }
    | undefined;
  type Attempt = NonNullable<typeof active>;
  const record = (
    attempt: Attempt,
    event: RecoveryRecord["event"],
    update: Partial<RecoveryRecord> = {},
  ): void => {
    attempt.record = {
      ...attempt.record,
      ...update,
      event,
      at: new Date().toISOString(),
    };
    attempt.store.append(attempt.record);
  };
  const sameModel = (left: ModelRef | undefined, right: ModelRef) =>
    left?.provider === right.provider && left.id === right.id;
  const live = (attempt: Attempt): RecoveryContext<M> => {
    const ctx = host.current();
    if (ctx.sessionId !== attempt.sessionId)
      throw new Error("Recovery session is no longer active");
    return ctx;
  };
  // Only committed entries prove selection ownership. model_select runs before
  // admission and can be rolled back, or omitted for a same-model choice.
  const selections = (
    ctx: RecoveryContext<M>,
    saved: RecoveryRecord,
    before: readonly string[],
  ) => {
    const boundary = ctx.entries.findIndex(
      (entry) => entry.id === saved.boundaryId,
    );
    const owned = ctx.entries.findIndex(
      (entry) => entry.id === saved.selectionId,
    );
    return ctx.entries.filter(
      (entry, index) =>
        entry.type === "model_change" &&
        (boundary < 0
          ? (owned >= 0 && index >= owned) || !before.includes(entry.id)
          : index > boundary),
    );
  };
  const ownership = (ctx: RecoveryContext<M>, attempt: Attempt): void => {
    if (attempt.record.selectionId || attempt.selectionSucceeded !== true)
      return;
    const candidates = selections(ctx, attempt.record, attempt.before).filter(
      (entry) =>
        entry.source === "extension" &&
        entry.actor !== undefined &&
        entry.provider === attempt.record.fallback?.provider &&
        entry.modelId === attempt.record.fallback?.id,
    );
    // Ambiguous attribution never grants ownership of another writer's choice.
    const owned = candidates.length === 1 ? candidates[0] : undefined;
    if (owned?.actor)
      attempt.record = {
        ...attempt.record,
        selectionId: owned.id,
        selectionActor: selectionActorDigest(owned.actor),
      };
  };
  const explicitChoice = (ctx: RecoveryContext<M>, attempt: Attempt) =>
    selections(ctx, attempt.record, attempt.before)
      .reverse()
      .find(
        (entry) =>
          entry.id !== attempt.record.selectionId &&
          !(
            entry.source === "extension" &&
            entry.actor !== undefined &&
            selectionActorDigest(entry.actor) === attempt.record.selectionActor
          ),
      );
  const restore = async (attempt: Attempt): Promise<void> => {
    if (attempt.switching || attempt.cleaning) return;
    attempt.cleaning = true;
    let restoration: RecoveryRecord["restoration"] = "held";
    try {
      let ctx = live(attempt);
      ownership(ctx, attempt);
      const saved = attempt.record;
      let ownsModel =
        saved.selectionId !== undefined &&
        ctx.entries.some((entry) => entry.id === saved.selectionId) &&
        saved.fallback !== undefined &&
        sameModel(ctx.model, saved.fallback);
      for (;;) {
        // After a crash, a matching extension selection alone cannot prove it
        // was ours. Keep that obligation held until ownership is known.
        if (
          !saved.selectionId &&
          attempt.selectionSucceeded !== false &&
          !sameModel(ctx.model, saved.original)
        )
          break;
        const choice = explicitChoice(ctx, attempt);
        const target =
          choice?.provider && choice.modelId
            ? { provider: choice.provider, id: choice.modelId }
            : saved.original;
        const resolved = choice ? "superseded" : "restored";
        // A successful SDK selection may only queue compaction. Re-selecting
        // the current model clears that deferred switch through the public API.
        const deferred =
          !saved.selectionId && attempt.selectionSucceeded === true && !choice;
        if (sameModel(ctx.model, target) && !deferred) {
          restoration = resolved;
          break;
        }
        if (!ownsModel && !choice && !deferred) break;
        const model = ctx.models.find((item) => sameModel(item, target));
        if (!model || !(await host.select(model))) break;
        ctx = live(attempt);
        ownsModel = sameModel(ctx.model, target);
        if (
          (deferred && ownsModel) ||
          explicitChoice(ctx, attempt)?.id === choice?.id
        ) {
          if (ownsModel) restoration = resolved;
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      // Public context access and selection may fail after runtime disposal.
      // Persist only the obligation, never provider exception text.
      restoration = "held";
    } finally {
      attempt.cleaning = false;
    }
    record(attempt, "outcome", {
      outcome: attempt.record.outcome ?? attempt.outcome,
      restoration,
    });
    if (restoration === "held")
      host.notify(
        "Repetition recovery could not restore the session model. Restoration is held for session reload.",
      );
    else if (active === attempt) active = undefined;
  };
  const finish = async (attempt: Attempt, outcome: string): Promise<void> => {
    attempt.cancelled = true;
    // The first terminal result owns the continuation outcome.
    try {
      if (attempt.record.outcome === undefined)
        record(attempt, "outcome", { outcome });
    } finally {
      if (attempt.record.restoration !== "held") await restore(attempt);
    }
  };
  const resumed = async (ctx: RecoveryContext<M>): Promise<void> => {
    snapshot(ctx, false);
    for (const user of [...ctx.entries].reverse()) {
      if (user.type !== "message" || user.message?.role !== "user") continue;
      const store = journal(ctx.agentDir, `${ctx.sessionId}:${user.id}`);
      const previous = store.read();
      if (
        !previous ||
        previous.restoration === "restored" ||
        previous.restoration === "superseded" ||
        (previous.event === "outcome" && previous.restoration === undefined)
      )
        continue;
      const attempt: Attempt = {
        store,
        record: previous,
        sessionId: ctx.sessionId,
        userId: user.id,
        failureId: "",
        admitted: false,
        outcome: previous.outcome ?? "interrupted-or-not-admitted",
        cancelled: true,
        switching: false,
        cleaning: false,
        before: ctx.entries.map((entry) => entry.id),
      };
      await restore(attempt);
    }
  };
  return {
    invalidate,
    stopped(data: unknown, ctx: RecoveryContext<M>): void {
      exhaustion = undefined;
      if (!run?.observing) return;
      const stop = ctx.entries.at(-1);
      const user = latestUser(ctx);
      if (
        !stop ||
        run.seen.has(stop.id) ||
        ctx.sessionId !== run.sessionId ||
        !follows(ctx, run.branch) ||
        !user ||
        user.id !== run.userId
      )
        return;
      run.seen.add(stop.id);
      const rule = rules(data).find(
        (name) => name === "collapse-repetition" || name === "repetitive-turns",
      );
      const userIndex = ctx.entries.findIndex((entry) => entry.id === user.id);
      if (
        (rule !== "collapse-repetition" && rule !== "repetitive-turns") ||
        stop.type !== "custom" ||
        stop.customType !== "ttsr-loop-stopped" ||
        !rules(stop.data).includes(rule) ||
        !ctx.entries
          .slice(userIndex + 1, -1)
          .some(
            (entry) =>
              entry.type === "custom_message" &&
              entry.customType === "ttsr-injection" &&
              rules(entry.details).includes(rule),
          )
      )
        return;
      if (ctx.pending) {
        host.notify("Repetition recovery held: another message is pending.");
        return;
      }
      exhaustion = {
        run,
        branch: ctx.entries.map((entry) => entry.id),
        userId: user.id,
        stopId: stop.id,
        rule,
      };
    },
    resumed,
    async refused(_ctx?: RecoveryContext<M>): Promise<void> {
      const attempt = active;
      if (!attempt || attempt.admitted || attempt.cancelled) return;
      host.notify(
        "Repetition recovery held: the engine refused the fallback turn at its existing limit.",
      );
      await finish(attempt, "engine-refused");
    },
    async interrupted(_ctx?: RecoveryContext<M>): Promise<void> {
      invalidate();
      const attempt = active;
      if (attempt) await finish(attempt, "interrupted");
    },
    started(ctx: RecoveryContext<M>): void {
      snapshot(ctx, true);
      if (!active || active.admitted || active.cancelled) return;
      const user = [...ctx.entries]
        .reverse()
        .find(
          (entry) => entry.type === "message" && entry.message?.role === "user",
        );
      if (user?.id !== active.userId) {
        active.outcome = "superseded";
        return;
      }
      active.admitted = true;
      record(active, "continuation_admitted");
    },
    ended(outcome: "settled" | "aborted" | "error"): void {
      if (active?.admitted && !active.cancelled) active.outcome = outcome;
    },
    async settled(ctx: RecoveryContext<M>): Promise<void> {
      if (active) {
        const attempt = active;
        if (attempt.switching || attempt.cleaning || attempt.cancelled) return;
        const failureId = attempt.failureId;
        const failureIndex = ctx.entries.findIndex(
          (entry) => entry.id === failureId,
        );
        const failedAgain = ctx.entries
          .slice(failureIndex + 1)
          .some(
            (entry) =>
              entry.type === "custom" &&
              entry.customType === "ttsr-loop-stopped" &&
              entry.id !== failureId,
          );
        await finish(
          attempt,
          attempt.admitted
            ? failedAgain
              ? "repetition-recurred"
              : attempt.outcome
            : "not-admitted",
        );
        return;
      }
      const evidence = exhaustion;
      ctx = host.current();
      if (
        evidence &&
        run === evidence.run &&
        ctx.pending &&
        latestUser(ctx)?.id === evidence.userId &&
        follows(ctx, evidence.branch)
      ) {
        host.notify("Repetition recovery held: another message is pending.");
      }
      if (!evidence || !eligible(ctx, evidence) || !ctx.model) {
        exhaustion = undefined;
        return;
      }
      const store = journal(
        ctx.agentDir,
        `${ctx.sessionId}:${evidence.userId}`,
      );
      const previous = store.read();
      if (previous) {
        await resumed(ctx);
        return;
      }
      const initial: RecoveryRecord = {
        event: "failure",
        correlation: store.correlation,
        at: new Date().toISOString(),
        original: { provider: ctx.model.provider, id: ctx.model.id },
        rule: evidence.rule,
        detectorMetadata: "rule-only",
        boundaryId: ctx.entries.at(-1)?.id,
        restoration: "switch-pending",
      };
      if (!store.claim(initial)) return;
      active = {
        store,
        record: initial,
        userId: evidence.userId,
        failureId: evidence.stopId,
        admitted: false,
        outcome: "unknown",
        sessionId: ctx.sessionId,
        cancelled: false,
        switching: false,
        cleaning: false,
        before: ctx.entries.map((entry) => entry.id),
      };
      const fallback = ctx.models.find(
        (model) => `${model.provider}/${model.id}` === selector,
      );
      if (
        !fallback ||
        (fallback.provider === ctx.model.provider &&
          fallback.id === ctx.model.id) ||
        ctx.pending
      ) {
        const outcome = ctx.pending
          ? "pending-input"
          : fallback
            ? "fallback-invalid"
            : "fallback-unavailable";
        record(active, "outcome", {
          outcome,
          restoration: "restored",
        });
        host.notify(
          ctx.pending
            ? "Repetition recovery held: another message is pending."
            : fallback
              ? "Repetition recovery held: fallback is the current model."
              : "Repetition recovery held: selected fallback is unavailable or unauthenticated.",
        );
        active = undefined;
        return;
      }
      active.record = {
        ...initial,
        fallback: { provider: fallback.provider, id: fallback.id },
      };
      record(active, "recovery_action");
      const attempt = active;
      attempt.switching = true;
      let selected = false;
      try {
        selected = await host.select(fallback);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        attempt.outcome = "model-selection-failed";
      } finally {
        attempt.switching = false;
        attempt.selectionSucceeded = selected;
      }
      try {
        const fresh = live(attempt);
        ownership(fresh, attempt);
        record(attempt, "recovery_action", { restoration: "pending" });
        if (
          !selected ||
          !attempt.record.selectionId ||
          attempt.cancelled ||
          !eligible(fresh, evidence) ||
          explicitChoice(fresh, attempt)
        ) {
          if (!selected)
            host.notify(
              "Repetition recovery held: the fallback could not be selected. No continuation was requested.",
            );
          else if (fresh.pending)
            host.notify(
              "Repetition recovery held: another message is pending.",
            );
          await finish(
            attempt,
            !selected
              ? attempt.outcome === "unknown"
                ? "model-selection-rejected"
                : attempt.outcome
              : "superseded",
          );
          return;
        }
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        await finish(attempt, "superseded");
        return;
      }
      try {
        record(attempt, "continuation_requested");
      } catch (error) {
        await finish(attempt, "not-admitted");
        throw error;
      }
      host.send();
    },
  };
}
