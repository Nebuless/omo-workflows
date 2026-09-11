import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@code-yeongyu/senpi";
import { addProviderFlow } from "./flows/add.ts";
import { deleteProviderFlow } from "./flows/delete.ts";
import { editProviderFlow } from "./flows/edit.ts";
import type { CommandContext, SelectItem } from "./types.ts";
import { selectOne } from "./ui/select.ts";
import { showUnifiedModelsBrowser } from "./ui/model-view.ts";
import { loadModelsConfig } from "./config.ts";
import {
  betterCustomViewSources,
  buildUnifiedModelView,
  registerBetterCustomProviders,
  setHostModelSwitcher,
  setProviderRegistrar,
  switchToModel,
} from "./model-browser.ts";
import type { UnifiedViewSource } from "./model-browser.ts";
import { captureHerdrEnv, createHerdrReporter } from "./herdr.ts";

type CustomProviderAction = "add" | "edit" | "delete";
type ProviderFlow = (ctx: CommandContext) => Promise<boolean>;

export interface CustomProviderCommandDependencies {
  selectAction?: (ctx: CommandContext) => Promise<CustomProviderAction | null>;
  addProviderFlow?: ProviderFlow;
  editProviderFlow?: ProviderFlow;
  deleteProviderFlow?: ProviderFlow;
}

const ACTIONS = [
  {
    value: "add",
    label: "Add provider",
    description: "Configure a new custom provider.",
  },
  {
    value: "edit",
    label: "Edit provider",
    description: "Change an existing provider or model.",
  },
  {
    value: "delete",
    label: "Delete provider",
    description: "Remove a configured provider.",
  },
] as const satisfies readonly SelectItem[];

function isInteractive(ctx: ExtensionCommandContext): boolean {
  return ctx.hasUI && ctx.mode === "tui";
}

function asCommandContext(ctx: ExtensionCommandContext): CommandContext {
  return ctx as unknown as CommandContext;
}

function isAction(value: string | null): value is CustomProviderAction {
  return value === "add" || value === "edit" || value === "delete";
}

async function selectAction(
  ctx: CommandContext,
): Promise<CustomProviderAction | null> {
  const action = await selectOne(ctx, "Custom providers", ACTIONS);
  return isAction(action) ? action : null;
}

/** Creates the command handler with injectable flows for focused command coverage. */
export function createCustomProviderHandler(
  dependencies: CustomProviderCommandDependencies = {},
): (args: string, ctx: ExtensionCommandContext) => Promise<void> {
  const flows: Record<CustomProviderAction, ProviderFlow> = {
    add: dependencies.addProviderFlow ?? addProviderFlow,
    edit: dependencies.editProviderFlow ?? editProviderFlow,
    delete: dependencies.deleteProviderFlow ?? deleteProviderFlow,
  };
  const chooseAction = dependencies.selectAction ?? selectAction;

  return async (_args, ctx) => {
    if (!isInteractive(ctx)) {
      ctx.ui.notify(
        "The custom-provider wizard requires interactive TUI mode.",
        "info",
      );
      return;
    }

    try {
      const commandContext = asCommandContext(ctx);
      const action = await chooseAction(commandContext);
      if (!action) return;
      await flows[action](commandContext);
    } catch {
      ctx.ui.notify("The custom-provider wizard could not complete.", "error");
    }
  };
}

/** Group the session's authenticated native models into view sources. */
function nativeViewSources(models: readonly unknown[]): UnifiedViewSource[] {
  const byProvider = new Map<string, UnifiedViewSource>();
  for (const model of models ?? []) {
    if (!model || typeof model !== "object") continue;
    const record = model as Record<string, unknown>;
    const provider = typeof record.provider === "string" ? record.provider : "";
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!provider || !id) continue;
    let source = byProvider.get(provider);
    if (!source) {
      const collected: Record<string, unknown>[] = [];
      source = {
        id: provider,
        origin: "native",
        authenticated: true,
        models: collected,
      };
      byProvider.set(provider, source);
    }
    (source.models as Record<string, unknown>[]).push({
      ...record,
      provider,
      id,
    });
  }
  return [...byProvider.values()];
}

/**
 * One searchable view over every authenticated native and better-custom model.
 * Selection resolves the canonical provider/id through the host model query
 * and switches the session via ExtensionAPI.setModel. The command name is
 * intentionally distinct from the reserved native "model" command.
 */
function createBetterModelsHandler(): (
  args: string,
  ctx: ExtensionCommandContext,
) => Promise<void> {
  return async (_args, ctx) => {
    if (!isInteractive(ctx)) {
      ctx.ui.notify(
        "The unified models browser requires interactive TUI mode.",
        "info",
      );
      return;
    }
    try {
      let customSources: UnifiedViewSource[] = [];
      try {
        customSources = betterCustomViewSources(loadModelsConfig());
      } catch {
        // A missing or unreadable config still allows browsing native models.
      }
      const nativeModels = ctx.modelRegistry?.getAll?.() ?? [];
      const view = buildUnifiedModelView([
        ...nativeViewSources(nativeModels),
        ...customSources,
      ]);
      const ref = await showUnifiedModelsBrowser(asCommandContext(ctx), view);
      if (!ref) return;
      const separator = ref.indexOf("/");
      const model =
        separator > 0
          ? ctx.modelRegistry?.find(
              ref.slice(0, separator),
              ref.slice(separator + 1),
            )
          : undefined;
      if (!model) {
        ctx.ui.notify('Model "' + ref + '" is no longer available.', "warning");
        return;
      }
      const switched = await switchToModel(
        model as unknown as Record<string, unknown>,
      );
      if (switched) ctx.ui.notify("Switched to " + ref + ".", "info");
      else
        ctx.ui.notify(
          "Could not switch to " + ref + ". Check its authentication.",
          "warning",
        );
    } catch {
      ctx.ui.notify("The unified models browser could not complete.", "error");
    }
  };
}

export default function customProviderWizard(pi: ExtensionAPI): void {
  // Report Atomic's lifecycle to Herdr when running inside a Herdr pane.
  // Captured once at factory invocation; no-ops outside Herdr.
  const herdr = createHerdrReporter({ env: captureHerdrEnv(process.env) });
  pi.on("session_start", () => herdr.onSessionStart());
  pi.on("agent_start", () => herdr.onAgentStart());
  pi.on("ui_prompt_start", (event) => herdr.onUIPromptStart(event.title));
  pi.on("ui_prompt_end", () => herdr.onUIPromptEnd());
  pi.on("agent_settled", () => herdr.onAgentSettled());
  pi.on("session_shutdown", (event) => herdr.onSessionShutdown(event.reason));

  // Make persisted custom providers visible to native /model immediately, and
  // capture the host seams used by the unified models browser.
  try {
    setProviderRegistrar(pi);
    setHostModelSwitcher({ setModel: (model) => pi.setModel(model as never) });
    registerBetterCustomProviders(pi, loadModelsConfig());
  } catch {
    // A missing or unreadable models config must not break extension load.
  }
  pi.registerCommand("better-models", {
    description:
      "Browse every authenticated provider's models in one view and switch.",
    handler: createBetterModelsHandler(),
  });
  pi.registerCommand("custom-provider", {
    description:
      "Add, edit, or delete custom providers in the active models configuration.",
    handler: createCustomProviderHandler(),
  });
}
