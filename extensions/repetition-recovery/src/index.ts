import type { ExtensionAPI, ExtensionContext } from "@code-yeongyu/senpi";
import { createRecovery } from "./recovery.ts";

export default function repetitionRecovery(pi: ExtensionAPI): void {
  pi.registerFlag("repetition-recovery-model", {
    type: "string",
    description:
      "One fallback provider/model after native repetition recovery is exhausted",
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
    const selector = pi.getFlag("repetition-recovery-model");
    if (typeof selector !== "string" || selector.length === 0) return;
    recovery = createRecovery(
      {
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
    recovery?.ended(
      event.aborted
        ? "aborted"
        : event.messages.some(
              (message) =>
                message.role === "assistant" && message.stopReason === "error",
            )
          ? "error"
          : "completed",
    );
  });
  pi.events.on("engine:turn-limit", async (data) => {
    if (
      typeof data === "object" &&
      data !== null &&
      "customType" in data &&
      data.customType === "repetition-recovery" &&
      latestContext
    )
      await recovery?.refused(context(latestContext));
  });
  pi.on("session_abort", async (_event, ctx) => {
    userAborted = true;
    await recovery?.interrupted(context(ctx));
  });
  pi.on("input", async (_event, ctx) => {
    await recovery?.interrupted(context(ctx));
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    await recovery?.interrupted(context(ctx));
  });
  pi.on("agent_settled", async (_event, ctx) => {
    latestContext = ctx;
    try {
      if (userAborted) await recovery?.interrupted(context(ctx));
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
