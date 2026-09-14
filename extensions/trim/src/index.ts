import type { ExtensionAPI, ExtensionContext } from "@code-yeongyu/senpi";
import { loadConfig, saveConfig, type TrimConfig } from "./config.ts";
import {
  beginAttempt,
  createGovernorState,
  finishAttempt,
  type GovernorState,
  invalidateGovernor,
  observeNative,
  shouldSchedule,
  type WorkBoundary,
} from "./governor.ts";
import { createTrimSettingsHandler } from "./ui/settings.ts";

interface TrimConfigStore {
  readonly load: () => TrimConfig;
  readonly save: (config: TrimConfig) => void;
}

function usageTokens(ctx: ExtensionContext): number | null {
  const tokens = ctx.getContextUsage()?.tokens;
  return typeof tokens === "number" && Number.isFinite(tokens) ? tokens : null;
}

function boundary(ctx: ExtensionContext): WorkBoundary {
  return {
    sessionId: ctx.sessionManager.getSessionId(),
    leafId: ctx.sessionManager.getLeafId(),
    revision: ctx.getMessageRevision(),
  };
}

function eligible(
  config: TrimConfig,
  state: GovernorState,
  ctx: ExtensionContext,
): boolean {
  return shouldSchedule(config, {
    usageTokens: usageTokens(ctx),
    settled: true,
    idle: ctx.isIdle(),
    pendingMessages: ctx.hasPendingMessages(),
    nativeCompacting: ctx.isCompacting?.() ?? false,
    requestLatched: state.request.phase === "pending",
    terminal: state.request.phase === "halted",
  });
}

export function registerTrim(
  pi: ExtensionAPI,
  configStore: TrimConfigStore = { load: loadConfig, save: saveConfig },
): void {
  let config = configStore.load();
  let state = createGovernorState();

  const evaluate = (ctx: ExtensionContext): void => {
    if (!eligible(config, state, ctx)) return;
    const next = beginAttempt(state, boundary(ctx));
    if (next === state || next.request.phase !== "pending") return;
    const attempt = next.request.attempt;
    state = next;
    ctx.compact({
      onComplete: () => {
        state = finishAttempt(state, attempt);
      },
      onError: () => {
        state = finishAttempt(state, attempt);
      },
    });
  };

  pi.on("agent_settled", (_event, ctx) => evaluate(ctx));
  pi.on("session_compact", (event, ctx) => {
    if (state.request.phase !== "pending") return;
    const attempt = state.request.attempt;
    if (!event.accepted) {
      state = observeNative(state, {
        attempt,
        current: boundary(ctx),
        accepted: false,
        entryId: null,
        sourceLeafRetained: false,
        willRetry: event.willRetry,
      });
      return;
    }
    const entry = ctx.sessionManager.getEntry(event.compactionEntry.id);
    const branch = ctx.sessionManager.getBranch();
    state = observeNative(state, {
      attempt,
      current: boundary(ctx),
      accepted: true,
      entryId:
        entry?.type === "compaction" &&
        branch.some((item) => item.id === event.compactionEntry.id)
          ? event.compactionEntry.id
          : null,
      sourceLeafRetained: branch.some(
        (item) => item.id === attempt.source.leafId,
      ),
      willRetry: event.willRetry,
    });
  });
  pi.on("session_compact_failed", () => {
    if (state.request.phase !== "halted") state = invalidateGovernor(state);
  });
  pi.on("session_tree", () => {
    if (state.request.phase !== "halted") state = invalidateGovernor(state);
  });
  pi.on("session_shutdown", () => {
    state = invalidateGovernor(state, true);
  });

  const settings = createTrimSettingsHandler({
    getConfig: () => config,
    saveConfig: (next) => {
      configStore.save(next);
      config = next;
    },
  });

  pi.registerCommand("trim", {
    description: "Configure safe-boundary native compaction",
    handler: async (args, ctx) => {
      const command = args.trim();
      if (command === "") {
        const previous = config;
        await settings(command, ctx);
        if (config !== previous) evaluate(ctx);
        return;
      }
      if (command === "shake") {
        if (state.request.phase === "pending") {
          ctx.ui.notify("Trim request remains active.", "warning");
          return;
        }
        state = createGovernorState();
        ctx.ui.notify(
          "Trim adaptive state reset. Session history unchanged.",
          "info",
        );
        return;
      }
      ctx.ui.notify("Trim no longer accepts subcommands. Run /trim.", "error");
    },
  });
}

export default function trim(pi: ExtensionAPI): void {
  registerTrim(pi);
}
