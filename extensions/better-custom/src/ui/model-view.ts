import type { CommandContext, SelectItem } from "../types.ts";
import type { UnifiedModelView } from "../model-browser.ts";
import { selectOne } from "./select.ts";

/** Canonical provider/id reference for one selectable model row. */
export function modelRef(model: { provider: string; id: string }): string {
  return model.provider + "/" + model.id;
}

function formatContext(contextWindow: unknown): string | undefined {
  if (typeof contextWindow !== "number" || contextWindow <= 0) return undefined;
  return contextWindow >= 1000 && contextWindow % 1000 === 0
    ? "ctx " + contextWindow / 1000 + "k"
    : "ctx " + String(contextWindow);
}

/** Shape searchable picker rows with stable labels and per-model metadata. */
export function unifiedModelItems(view: UnifiedModelView): SelectItem[] {
  return view.providers.flatMap((provider) =>
    provider.models.map((model) => {
      const ctxLabel = formatContext(model.contextWindow);
      const freeLabel = model.isFree === true ? "free" : undefined;
      const parts = [
        provider.label,
        typeof model.family === "string" ? model.family : undefined,
        ctxLabel,
        freeLabel,
      ].filter((part): part is string => Boolean(part));
      const ref = modelRef(model);
      return {
        value: ref,
        label: ref,
        ...(parts.length > 0
          ? {
              suffix: " • " + parts.join(" • "),
              searchText: ref + " " + parts.join(" "),
            }
          : { searchText: ref }),
      };
    }),
  );
}

/**
 * Present every authenticated provider's models in one searchable view.
 * Resolves to the canonical provider/id reference, or null on cancel/empty.
 */
export async function showUnifiedModelsBrowser(
  ctx: CommandContext,
  view: UnifiedModelView,
): Promise<string | null> {
  const items = unifiedModelItems(view);
  if (items.length === 0) {
    ctx.ui.notify("No authenticated models are available.", "info");
    return null;
  }
  const selected = await selectOne(ctx, "Models", items);
  return typeof selected === "string" && selected ? selected : null;
}
