import type { ExtensionAPI, ExtensionContext } from "@code-yeongyu/senpi";
import { loadConfig, saveConfig, type TrimConfig } from "./config.ts";
import { decide, type GovernorOutcome, shouldSchedule } from "./governor.ts";
import { createTrimSettingsHandler } from "./ui/settings.ts";

interface TrimConfigStore {
  readonly load: () => TrimConfig;
  readonly save: (config: TrimConfig) => void;
}

interface TrimState {
  config: TrimConfig;
  outcome: GovernorOutcome;
  sampledTokens: number | null;
  inFlight: boolean;
  pendingIntent: boolean;
  sourceSessionId: string | null;
  sourceLeafId: string | null;
  sourceRevision: number | null;
  lastScheduledTokens: number | null;
}

function usageTokens(ctx: {
  getContextUsage(): { tokens: number | null } | undefined;
}): number | null {
  const tokens = ctx.getContextUsage()?.tokens;
  return typeof tokens === "number" && Number.isFinite(tokens) ? tokens : null;
}

function canRun(
  ctx: Pick<ExtensionContext, "isIdle" | "hasPendingMessages" | "isCompacting">,
  state: TrimState,
): boolean {
  return shouldSchedule(state.config, {
    usageTokens: state.sampledTokens,
    settled: true,
    idle: ctx.isIdle(),
    pendingMessages: ctx.hasPendingMessages(),
    nativeCompacting: ctx.isCompacting?.() ?? false,
    requestLatched: state.inFlight,
  });
}

export function registerTrim(
  pi: ExtensionAPI,
  configStore: TrimConfigStore = { load: loadConfig, save: saveConfig },
): void {
  const state: TrimState = {
    config: configStore.load(),
    outcome: "DEFERRED",
    sampledTokens: null,
    inFlight: false,
    pendingIntent: false,
    sourceSessionId: null,
    sourceLeafId: null,
    sourceRevision: null,
    lastScheduledTokens: null,
  };

  const startNativeCompaction = (ctx: ExtensionContext): void => {
    state.inFlight = true;
    state.sourceSessionId = ctx.sessionManager.getSessionId();
    state.sourceLeafId = ctx.sessionManager.getLeafId();
    state.sourceRevision = ctx.getMessageRevision();
    state.lastScheduledTokens = state.sampledTokens;
    ctx.compact({
      onComplete: () => {
        state.outcome = "NATIVE_OUTCOME_OBSERVED";
      },
      onError: () => {
        state.outcome = "NATIVE_OUTCOME_OBSERVED";
      },
    });
  };

  const schedule = (ctx: ExtensionContext): void => {
    state.sampledTokens = usageTokens(ctx);
    if (state.inFlight && !ctx.isCompacting?.()) {
      state.inFlight = false;
      state.outcome = "SUPERSEDED_OR_UNKNOWN";
    }
    if (
      !canRun(ctx, state) ||
      state.sampledTokens === state.lastScheduledTokens
    ) {
      state.outcome =
        state.sampledTokens === state.lastScheduledTokens
          ? "DEFERRED"
          : decide(state.config, {
              usageTokens: state.sampledTokens,
              settled: true,
              idle: ctx.isIdle(),
              pendingMessages: ctx.hasPendingMessages(),
              nativeCompacting: ctx.isCompacting?.() ?? false,
              requestLatched: state.inFlight,
            });
      return;
    }
    state.pendingIntent = false;
    startNativeCompaction(ctx);
  };

  pi.on("turn_end", (_event, ctx) => {
    state.sampledTokens = usageTokens(ctx);
    state.pendingIntent =
      state.config.strategy === "settled" &&
      state.sampledTokens !== null &&
      state.sampledTokens >= state.config.thresholdTokens;
  });
  pi.on("agent_settled", (_event, ctx) => schedule(ctx));
  pi.on("session_compact", (event, ctx) => {
    if (!event.accepted || !event.compactionEntry?.id) {
      state.outcome = "NATIVE_OUTCOME_OBSERVED";
      state.inFlight = false;
      state.sourceSessionId = null;
      state.sourceLeafId = null;
      state.sourceRevision = null;
      return;
    }
    const entry = ctx.sessionManager.getEntry(event.compactionEntry.id);
    const sameSession =
      state.inFlight &&
      state.sourceSessionId === ctx.sessionManager.getSessionId();
    const revisionAdvanced =
      state.sourceRevision !== null &&
      ctx.getMessageRevision() > state.sourceRevision;
    const branch = ctx.sessionManager.getBranch();
    const sourceLeafRetained =
      state.sourceLeafId !== null &&
      branch.some((item) => item.id === state.sourceLeafId);
    const committedOnActiveBranch = branch.some(
      (item) => item.id === event.compactionEntry.id,
    );
    state.outcome =
      sameSession &&
      revisionAdvanced &&
      sourceLeafRetained &&
      committedOnActiveBranch &&
      entry?.type === "compaction"
        ? "NATIVE_COMPACTION_COMMITTED"
        : "NATIVE_OUTCOME_OBSERVED";
    state.inFlight = false;
    state.sourceSessionId = null;
    state.sourceLeafId = null;
    state.sourceRevision = null;
  });
  pi.on("session_shutdown", () => {
    state.inFlight = false;
    state.pendingIntent = false;
    state.sourceSessionId = null;
    state.sourceLeafId = null;
    state.sourceRevision = null;
    state.lastScheduledTokens = null;
    state.outcome = "DEFERRED";
  });

  const settings = createTrimSettingsHandler({
    getConfig: () => state.config,
    saveConfig: (config) => {
      configStore.save(config);
      state.config = config;
    },
  });

  pi.registerCommand("trim", {
    description: "Configure safe-boundary native compaction",
    handler: async (args, ctx) => {
      const command = args.trim();
      if (command === "") {
        const previous = state.config;
        await settings(command, ctx);
        if (state.config !== previous) schedule(ctx);
        return;
      }
      if (command === "shake") {
        if (ctx.isCompacting?.() ?? false) {
          ctx.ui.notify(
            "Trim shake unavailable while native compaction is active. Session history unchanged.",
            "warning",
          );
          return;
        }
        ctx.compact();
        return;
      }
      ctx.ui.notify("Trim no longer accepts subcommands. Run /trim.", "error");
    },
  });
}

export default function trim(pi: ExtensionAPI): void {
  registerTrim(pi);
}
