import type { StagedJournal } from "./controller.ts";

export class JournalDurabilityError extends Error {
  readonly name = "JournalDurabilityError";

  constructor(cause: unknown) {
    super(
      `Workflow journal durability unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

export function createNativeStagedJournal(
  pi: { appendEntry(customType: string, data: unknown): void },
  manager: {
    getBranch(): readonly unknown[];
    readonly isPersisted?: unknown;
    readonly flushEntries?: unknown;
  },
): StagedJournal | undefined {
  if (
    !("isPersisted" in manager) ||
    typeof manager.isPersisted !== "function" ||
    manager.isPersisted() !== true ||
    !("flushEntries" in manager) ||
    typeof manager.flushEntries !== "function"
  )
    return undefined;
  const flush = manager.flushEntries.bind(manager);
  return {
    async appendEntry(customType, data) {
      pi.appendEntry(customType, data);
      try {
        await flush();
      } catch (error) {
        throw new JournalDurabilityError(error);
      }
    },
    getBranch: () => manager.getBranch(),
  };
}
