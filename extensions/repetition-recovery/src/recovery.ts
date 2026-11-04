import { journal, type ModelRef, type RecoveryRecord } from "./journal.ts";

interface Entry {
  readonly type: string;
  readonly id: string;
  readonly customType?: string;
  readonly message?: { readonly role: string };
  readonly data?: unknown;
  readonly details?: unknown;
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
  // Mutable state belongs to this lifecycle adapter; durable claims survive its replacement.
  let active:
    | {
        store: ReturnType<typeof journal>;
        record: RecoveryRecord;
        userId: string;
        failureId: string;
        admitted: boolean;
        outcome: string;
      }
    | undefined;
  const record = (event: RecoveryRecord["event"], outcome?: string): void => {
    if (!active) return;
    active.store.append({
      ...active.record,
      event,
      at: new Date().toISOString(),
      ...(outcome === undefined ? {} : { outcome }),
    });
  };
  const restore = async (
    ctx: RecoveryContext<M>,
    saved: RecoveryRecord,
  ): Promise<void> => {
    const { original, fallback } = saved;
    if (
      fallback &&
      ctx.model?.provider === fallback.provider &&
      ctx.model.id === fallback.id
    ) {
      const model = ctx.models.find(
        (item) =>
          item.provider === original.provider && item.id === original.id,
      );
      if (!model || !(await host.select(model)))
        host.notify(
          "Repetition recovery could not restore the original session model.",
        );
    }
  };
  return {
    async resumed(ctx: RecoveryContext<M>): Promise<void> {
      const user = [...ctx.entries]
        .reverse()
        .find(
          (entry) => entry.type === "message" && entry.message?.role === "user",
        );
      if (!user) return;
      const store = journal(ctx.agentDir, `${ctx.sessionId}:${user.id}`);
      const previous = store.read();
      if (!previous || previous.event === "outcome") return;
      await restore(ctx, previous);
      store.append({
        ...previous,
        event: "outcome",
        at: new Date().toISOString(),
        outcome: "interrupted-or-not-admitted",
      });
    },
    async refused(ctx: RecoveryContext<M>): Promise<void> {
      if (!active || active.admitted) return;
      await restore(ctx, active.record);
      record("outcome", "engine-refused");
      active = undefined;
    },
    async interrupted(ctx: RecoveryContext<M>): Promise<void> {
      if (!active) return;
      await restore(ctx, active.record);
      record("outcome", "interrupted");
      active = undefined;
    },
    started(ctx: RecoveryContext<M>): void {
      if (!active || active.admitted) return;
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
      record("continuation_admitted");
    },
    ended(outcome: "completed" | "aborted" | "error"): void {
      if (active?.admitted) active.outcome = outcome;
    },
    async settled(ctx: RecoveryContext<M>): Promise<void> {
      if (active) {
        const failureId = active.failureId;
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
        await restore(ctx, active.record);
        record(
          "outcome",
          active.admitted
            ? failedAgain
              ? "repetition-recurred"
              : active.outcome
            : "not-admitted",
        );
        active = undefined;
        return;
      }
      const userIndex = ctx.entries
        .map(
          (entry) => entry.type === "message" && entry.message?.role === "user",
        )
        .lastIndexOf(true);
      const user = ctx.entries[userIndex];
      if (!user) return;
      const store = journal(ctx.agentDir, `${ctx.sessionId}:${user.id}`);
      const previous = store.read();
      if (previous) {
        if (previous.event !== "outcome") {
          await restore(ctx, previous);
          store.append({
            ...previous,
            event: "outcome",
            at: new Date().toISOString(),
            outcome: "interrupted-or-not-admitted",
          });
        }
        return;
      }
      const tail = ctx.entries.slice(userIndex + 1);
      const stop = [...tail]
        .reverse()
        .find(
          (entry) =>
            entry.type === "custom" && entry.customType === "ttsr-loop-stopped",
        );
      const rule = rules(stop?.data).find(
        (name) => name === "collapse-repetition" || name === "repetitive-turns",
      );
      if (
        (rule !== "collapse-repetition" && rule !== "repetitive-turns") ||
        !ctx.model ||
        !stop
      )
        return;
      if (
        !tail.some(
          (entry) =>
            entry.type === "custom_message" &&
            entry.customType === "ttsr-injection" &&
            rules(entry.details).includes(rule),
        )
      )
        return;
      const initial: RecoveryRecord = {
        event: "failure",
        correlation: store.correlation,
        at: new Date().toISOString(),
        original: { provider: ctx.model.provider, id: ctx.model.id },
        rule,
        detectorMetadata: "rule-only",
      };
      if (!store.claim(initial)) return;
      active = {
        store,
        record: initial,
        userId: user.id,
        failureId: stop.id,
        admitted: false,
        outcome: "unknown",
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
        record(
          "outcome",
          ctx.pending ? "pending-input" : "fallback-unavailable",
        );
        active = undefined;
        return;
      }
      active.record = {
        ...initial,
        fallback: { provider: fallback.provider, id: fallback.id },
      };
      record("recovery_action", "continuation-requested");
      const attempt = active;
      if (!(await host.select(fallback))) {
        record("outcome", "model-selection-rejected");
        active = undefined;
        return;
      }
      if (active !== attempt) return;
      host.send();
    },
  };
}
