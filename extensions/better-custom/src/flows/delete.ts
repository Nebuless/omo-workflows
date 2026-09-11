import type { ModelsConfigTarget } from "../config.ts";
import type { CommandContext } from "../types.ts";
import { selectOne } from "../ui/select.ts";
import {
  describeProvider,
  loadConfigForFlow,
  providerPickerItems,
  removeProvider,
} from "./shared.ts";

/** Injectable config target keeps the interactive flow deterministic under the test host. */
export interface DeleteProviderFlowOptions {
  configTarget?: ModelsConfigTarget;
}

function leaveConfigUnchanged(ctx: CommandContext): false {
  ctx.ui.notify(
    "Provider was not deleted; models configuration is unchanged.",
    "info",
  );
  return false;
}

/** Remove one selected provider only after it is explicitly confirmed. */
export async function deleteProviderFlow(
  ctx: CommandContext,
  options: DeleteProviderFlowOptions = {},
): Promise<boolean> {
  const config = loadConfigForFlow(ctx, options);
  if (!config) return false;

  const providers = providerPickerItems(config);
  if (providers.length === 0) {
    ctx.ui.notify(
      "No custom providers are configured; models configuration is unchanged.",
      "warning",
    );
    return false;
  }

  const providerId = await selectOne(ctx, "Delete provider", providers);
  if (!providerId) return leaveConfigUnchanged(ctx);

  // Re-read by stable provider id before confirming; config may have changed while selecting.
  const currentConfig = loadConfigForFlow(ctx, options);
  if (!currentConfig) return false;
  const provider = currentConfig.providers?.[providerId];
  if (!provider) {
    ctx.ui.notify(
      'Provider "' +
        providerId +
        '" no longer exists; models configuration is unchanged.',
      "warning",
    );
    return false;
  }

  const confirmedProvider = JSON.stringify(provider);
  const confirmed = await ctx.ui.confirm(
    "Delete provider?",
    describeProvider(providerId, provider),
  );
  if (!confirmed) return leaveConfigUnchanged(ctx);

  const latestConfig = loadConfigForFlow(ctx, options);
  if (!latestConfig) return false;
  if (
    JSON.stringify(latestConfig.providers?.[providerId]) !== confirmedProvider
  ) {
    ctx.ui.notify(
      'Provider "' +
        providerId +
        '" changed while confirmation was open; models configuration is unchanged.',
      "warning",
    );
    return false;
  }

  if (!(await removeProvider(ctx, providerId, options))) return false;
  ctx.ui.notify('Deleted provider "' + providerId + '".', "success");
  return true;
}
