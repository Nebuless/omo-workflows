import type { ExtensionCommandContext } from "@code-yeongyu/senpi";
import type { TrimConfig } from "../config.ts";

export interface TrimSettingsUi {
  readonly select: (
    title: string,
    options: string[],
  ) => Promise<string | undefined>;
  readonly input: (
    title: string,
    placeholder?: string,
  ) => Promise<string | undefined>;
  readonly confirm: (title: string, message: string) => Promise<boolean>;
  readonly notify: (
    message: string,
    type?: "info" | "warning" | "error",
  ) => void;
}

export interface TrimSettingsContext {
  readonly hasUI: boolean;
  readonly mode: ExtensionCommandContext["mode"];
  readonly ui: TrimSettingsUi;
}

export interface TrimSettingsDependencies {
  readonly getConfig: () => TrimConfig;
  readonly saveConfig: (config: TrimConfig) => void;
}

export class TrimSettingsModeError extends Error {
  constructor() {
    super("Trim Settings requires interactive TUI mode.");
    this.name = "TrimSettingsModeError";
  }
}

export function createTrimSettingsHandler(
  dependencies: TrimSettingsDependencies,
): (args: string, ctx: TrimSettingsContext) => Promise<void> {
  return async (args, ctx) => {
    if (args.trim()) {
      ctx.ui.notify("Trim no longer accepts subcommands. Run /trim.", "error");
      return;
    }
    if (!ctx.hasUI || ctx.mode !== "tui") throw new TrimSettingsModeError();

    const policy = await ctx.ui.select("Trim Settings", [
      "automatic",
      "manual",
    ]);
    if (policy === undefined) return;
    if (policy !== "automatic" && policy !== "manual") {
      ctx.ui.notify("Invalid Trim policy selection.", "error");
      return;
    }

    const current = dependencies.getConfig();
    const threshold = await ctx.ui.input(
      "Compaction threshold tokens",
      String(current.thresholdTokens),
    );
    if (threshold === undefined) return;

    const thresholdTokens = Number(threshold.trim());
    if (
      !/^\d+$/.test(threshold.trim()) ||
      !Number.isSafeInteger(thresholdTokens) ||
      thresholdTokens < 1
    ) {
      ctx.ui.notify("Threshold must be a positive safe integer.", "error");
      return;
    }

    const next: TrimConfig = {
      strategy: policy === "automatic" ? "settled" : "manual",
      thresholdTokens,
    };
    if (
      !(await ctx.ui.confirm(
        "Save Trim settings?",
        `${next.strategy} policy at ${next.thresholdTokens} tokens.`,
      ))
    )
      return;

    try {
      dependencies.saveConfig(next);
      ctx.ui.notify("Trim settings saved.", "info");
    } catch (error) {
      if (error instanceof Error) {
        ctx.ui.notify("Could not save Trim settings.", "error");
        return;
      }
      throw error;
    }
  };
}
