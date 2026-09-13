import type { StagedJournal } from "./controller.ts";

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
      flush();
    },
    getBranch: () => manager.getBranch(),
  };
}
