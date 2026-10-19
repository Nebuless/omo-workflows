import { open } from "node:fs/promises";
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
  pi: {
    appendEntry(customType: string, data: unknown): void;
    readonly session?: { readonly persistHeaderNow?: unknown };
  },
  manager: {
    getBranch(): readonly unknown[];
    readonly getSessionFile?: unknown;
  },
): StagedJournal | undefined {
  if (
    typeof pi.session?.persistHeaderNow !== "function" ||
    typeof manager.getSessionFile !== "function"
  )
    return undefined;
  const sessionFile = manager.getSessionFile();
  if (typeof sessionFile !== "string" || sessionFile.length === 0)
    return undefined;
  const persistHeaderNow = pi.session.persistHeaderNow.bind(pi.session);
  return {
    async appendEntry(customType, data) {
      try {
        await persistHeaderNow();
      } catch (error) {
        throw new JournalDurabilityError(error);
      }
      pi.appendEntry(customType, data);
      try {
        const file = await open(sessionFile, "r+");
        try {
          await file.sync();
        } finally {
          await file.close();
        }
      } catch (error) {
        throw new JournalDurabilityError(error);
      }
    },
    getBranch: () => manager.getBranch(),
  };
}
