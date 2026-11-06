import type { ExtensionAPI, ExtensionContext } from "@code-yeongyu/senpi";
import { createRecovery } from "./recovery.ts";

export default function repetitionRecovery(pi: ExtensionAPI): void {
  pi.registerFlag("repetition-recovery-model", {
    type: "string",
    description:
      "Override the automatic fallback provider/model; use off to disable recovery",
  });
  let recovery:
    | ReturnType<typeof createRecovery<NonNullable<ExtensionContext["model"]>>>
    | undefined;
  let latestContext: ExtensionContext | undefined;
  let userAborted = false;
  const context = (ctx: ExtensionContext) => ({
    agentDir: ctx.agentDir,
    sessionId: ctx.sessionManager.getSessionId(),
    entries: ctx.sessionManager.getBranch(),
    model: ctx.model,
    models: ctx.modelRegistry.getAll(),
    pending: ctx.hasPendingMessages(),
  });
  pi.on("session_start", async (_event, ctx) => {
    latestContext = ctx;
    const configured = pi.getFlag("repetition-recovery-model");
    if (configured === "off") {
      ctx.ui.notify("Repetition recovery disabled: explicit override.", "info");
      return;
    }
    const available = ctx.modelRegistry
      .getAvailable()
      .filter(
        (model) =>
          model.provider !== ctx.model?.provider || model.id !== ctx.model?.id,
      );
    const sameProvider = available.filter(
      (model) => model.provider === ctx.model?.provider,
    );
    const automatic =
      sameProvider.find((model) => model.id.endsWith("gpt-6-luna")) ??
      sameProvider[0];
    const selector =
      typeof configured === "string" && configured.length > 0
        ? configured
        : automatic && `${automatic.provider}/${automatic.id}`;
    if (!selector) {
      ctx.ui.notify(
        "Repetition recovery held: no distinct authenticated fallback available.",
        "warning",
      );
      return;
    }
    const fallback = ctx.modelRegistry
      .getAll()
      .find((model) => `${model.provider}/${model.id}` === selector);
    const usable =
      fallback !== undefined &&
      (fallback.provider !== ctx.model?.provider ||
        fallback.id !== ctx.model?.id);
    ctx.ui.notify(
      usable
        ? "Repetition recovery enabled: one distinct fallback continuation is configured."
        : fallback
          ? "Repetition recovery held: fallback is the current model."
          : "Repetition recovery held: selected fallback is unavailable.",
      usable ? "info" : "warning",
    );
    recovery = createRecovery(
      {
        current: () => context(ctx),
        select: (model) => pi.setSessionModel(model),
        send: () =>
          pi.sendMessage(
            {
              customType: "repetition-recovery",
              content:
                "Continue the existing task from its last useful state. Avoid repeating the failed response.",
              display: false,
            },
            { triggerTurn: true },
          ),
        notify: (message) => latestContext?.ui.notify(message, "warning"),
      },
      selector,
    );
    try {
      await recovery.resumed(context(ctx));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      recovery = undefined;
      ctx.ui.notify(
        "Repetition recovery disabled because its local journal could not be reconciled.",
        "warning",
      );
    }
  });
  pi.on("agent_start", (_event, ctx) => {
    latestContext = ctx;
    userAborted = false;
    recovery?.started(context(ctx));
  });
  pi.on("agent_end", (event) => {
    userAborted = event.abortSource === "user" || event.deadline !== undefined;
    if (userAborted) recovery?.invalidate();
    recovery?.ended(
      event.aborted
        ? "aborted"
        : event.messages.some(
              (message) =>
                message.role === "assistant" && message.stopReason === "error",
            )
          ? "error"
          : "settled",
    );
  });
  pi.events.on("ttsr:loop-stopped", (data) => {
    if (latestContext) recovery?.stopped(data, context(latestContext));
  });
  pi.events.on("engine:turn-limit", async (data) => {
    if (
      typeof data === "object" &&
      data !== null &&
      "customType" in data &&
      data.customType === "repetition-recovery" &&
      latestContext
    )
      await recovery?.refused();
  });
  pi.on("session_abort", async (_event, ctx) => {
    userAborted = true;
    latestContext = ctx;
    await recovery?.interrupted();
  });
  pi.on("input", async (_event, ctx) => {
    latestContext = ctx;
    await recovery?.interrupted();
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    latestContext = ctx;
    await recovery?.interrupted();
  });
  pi.on("session_tree", async (_event, ctx) => {
    latestContext = ctx;
    await recovery?.interrupted();
  });
  pi.on("agent_settled", async (_event, ctx) => {
    latestContext = ctx;
    try {
      if (userAborted) await recovery?.interrupted();
      else await recovery?.settled(context(ctx));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      ctx.ui.notify(
        "Repetition recovery held after a local state or model-selection failure. No automatic retry will be replayed.",
        "warning",
      );
    }
  });
}
