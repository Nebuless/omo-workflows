import { isDeepStrictEqual } from "node:util";
import type { Static } from "typebox";
import type { StagedJournal } from "../execution/controller.ts";
import type { NativeWorkflowTransport } from "../execution/native-transport.ts";
import type { ProgramContext, ProgramRegistry } from "./host.ts";
import type { LaunchSchema } from "./launch-record.ts";
import { TransferError } from "./transfer-files.ts";
import {
  recheckTransferInput,
  rejectTransfer,
  transferIntents,
  transferRejected,
} from "./transfer-launch.ts";
import {
  snapshotTransferSource,
  transferSourceJournal,
} from "./transfer-source.ts";

export function transferGuard(input: {
  readonly saved: Static<typeof LaunchSchema>;
  readonly context: ProgramContext;
  readonly registry: ProgramRegistry;
  readonly native: NativeWorkflowTransport;
}) {
  const { saved, context, registry } = input;
  const intent = transferIntents(context.sessionManager.getBranch())
    .filter((item) => item.launch.instance === saved.instance)
    .at(-1);
  if (intent === undefined && saved.transferAttempt === undefined)
    return undefined;
  const check = () => {
    if (
      intent === undefined ||
      saved.transferAttempt !== intent.launch.instance ||
      !isDeepStrictEqual(saved, intent.launch) ||
      transferRejected(context.sessionManager.getBranch(), intent)
    )
      throw new TransferError("source-unavailable");
    const identity = registry.identity?.(saved.key);
    if (
      identity === undefined ||
      identity.revision !== intent.request.selection.revision ||
      identity.digest !== intent.request.selection.digest
    )
      throw new TransferError("destination-identity");
    transferSourceJournal(context, intent.request.manifest);
    return intent;
  };
  return {
    check,
    async verify() {
      await recheckTransferInput(check());
      await snapshotTransferSource(input.native, check().request.manifest);
      check();
    },
  };
}

export async function rejectTransferLaunch(
  input: Parameters<typeof transferGuard>[0],
  journal: StagedJournal | undefined,
  interrupted: boolean,
) {
  if (interrupted) {
    try {
      const guard = transferGuard(input);
      if (guard !== undefined) {
        await guard.verify();
        // Detachment is recoverable only while durable transfer authority remains valid.
        return rejectTransfer(journal, "transfer-context-disposed");
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return rejectTransfer(
        journal,
        "transfer-launch-failed",
        input.saved.instance,
      );
    }
  }
  return rejectTransfer(
    journal,
    "transfer-launch-failed",
    input.saved.instance,
  );
}
