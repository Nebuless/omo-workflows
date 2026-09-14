import { createHash } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type {
  ControllerDecision,
  StagedJournal,
} from "../execution/controller.ts";
import type { StagedProgram } from "../execution/policy.ts";
import type { NativeWorkflowTransport } from "../execution/native-transport.ts";
import type { ProgramContext, ProgramRegistry } from "./host.ts";
import { LAUNCH_ENTRY_TYPE, LaunchSchema } from "./launch-record.ts";
import { TerminalTransferSchema, verifyTerminalTransfer } from "./transfer.ts";
import { openPinned, TransferError } from "./transfer-files.ts";

export const TRANSFER_INTENT_TYPE = "omo-workflow-graph:transfer-intent";
export const TRANSFER_REJECTED_TYPE = "omo-workflow-graph:transfer-rejected";
export const TransferRequestSchema = Type.Object(
  {
    sourceRunId: Type.String({ minLength: 1 }),
    selection: TerminalTransferSchema.properties.destination,
    manifest: TerminalTransferSchema,
    confirmed: Type.Literal(true),
  },
  { additionalProperties: false },
);
const IntentSchema = Type.Object(
  {
    version: Type.Literal(1),
    request: TransferRequestSchema,
    launch: LaunchSchema,
    provenance: Type.Optional(
      Type.Array(
        Type.Object(
          {
            path: Type.String(),
            directory: Type.Boolean(),
            dev: Type.String(),
            ino: Type.String(),
          },
          { additionalProperties: false },
        ),
        { minItems: 1 },
      ),
    ),
  },
  { additionalProperties: false },
);
export type TransferIntent = Static<typeof IntentSchema>;
export type TransferSource = {
  readonly instance: string;
  readonly runId: string | undefined;
  readonly decision: ControllerDecision | undefined;
  readonly error: string | undefined;
};
export type TransferLaunchContext = {
  readonly context: ProgramContext;
  readonly journal: StagedJournal | undefined;
  readonly registry: ProgramRegistry;
  readonly native: NativeWorkflowTransport;
  readonly status: () => TransferSource | undefined;
  readonly sourceProgram: StagedProgram | undefined;
  readonly current: () => boolean;
};
const requestId = (request: unknown) =>
  createHash("sha256").update(JSON.stringify(request)).digest("hex");

export function transferIntents(
  entries: readonly unknown[],
): readonly TransferIntent[] {
  const intents: TransferIntent[] = [];

  for (const entry of entries) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("customType" in entry) ||
      !("data" in entry)
    )
      continue;
    if (
      entry.customType === TRANSFER_INTENT_TYPE &&
      Value.Check(IntentSchema, entry.data)
    )
      intents.push(entry.data);
  }
  return intents;
}

export function transferRejected(
  entries: readonly unknown[],
  intent: TransferIntent,
): boolean {
  // Legacy request tombstones apply only to preceding attempts, never future retries.
  let seen = false;
  for (const entry of entries) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("customType" in entry) ||
      !("data" in entry)
    )
      continue;
    if (
      entry.customType === TRANSFER_INTENT_TYPE &&
      Value.Check(IntentSchema, entry.data) &&
      entry.data.launch.instance === intent.launch.instance
    )
      seen = true;
    if (
      entry.customType !== TRANSFER_REJECTED_TYPE ||
      typeof entry.data !== "object" ||
      entry.data === null
    )
      continue;
    if (
      "attemptId" in entry.data &&
      entry.data.attemptId === intent.launch.instance
    )
      return true;
    if (
      seen &&
      "requestId" in entry.data &&
      entry.data.requestId === requestId(intent.request)
    )
      return true;
  }
  return false;
}

export async function rejectTransfer(
  journal: StagedJournal | undefined,
  code: string,
  attemptId?: string,
): Promise<ControllerDecision> {
  if (journal === undefined) return { kind: "durability-unavailable" };
  try {
    await journal.appendEntry(TRANSFER_REJECTED_TYPE, {
      version: 1,
      code,
      ...(attemptId === undefined ? {} : { attemptId }),
    });
    return { kind: "rejected", reason: code };
  } catch {
    // no-excuse-ok: catch -- public journal boundary never exposes filesystem errors.
    return { kind: "durability-unavailable" };
  }
}

export async function prepareTransfer(
  input: TransferLaunchContext,
  request: unknown,
): Promise<
  | {
      readonly kind: "prepared";
      readonly intent: TransferIntent;
      readonly replay: boolean;
    }
  | ControllerDecision
> {
  const reject = (code: string) => rejectTransfer(input.journal, code);
  if (
    typeof request !== "object" ||
    request === null ||
    !("confirmed" in request) ||
    request.confirmed !== true
  )
    return reject("transfer-confirmation-required");
  if (!Value.Check(TransferRequestSchema, request))
    return reject("manifest-invalid");
  const accepted = structuredClone(request);
  if (
    accepted.sourceRunId !== accepted.manifest.source.runId ||
    !isDeepStrictEqual(accepted.selection, accepted.manifest.destination)
  )
    return reject("source-identity");
  const identity = input.registry.identity?.(accepted.selection.key);
  if (
    identity?.revision !== accepted.selection.revision ||
    identity.digest !== accepted.selection.digest
  )
    return reject("destination-identity");
  if (input.journal === undefined) return { kind: "durability-unavailable" };
  const entries = input.journal.getBranch();
  const replay = transferIntents(entries)
    .filter(
      (intent) =>
        isDeepStrictEqual(intent.request, accepted) &&
        !transferRejected(entries, intent),
    )
    .at(-1);
  if (replay !== undefined) {
    // Interrupted source retries require explicit restore; never bypass source verification here.
    if (input.status()?.instance !== replay.launch.instance)
      return reject("source-unavailable");
    return { kind: "prepared", intent: replay, replay: true };
  }
  const program = input.registry.get(accepted.selection.key, "");
  if (
    program === undefined ||
    input.sourceProgram?.transferArtifacts === undefined
  )
    return reject("artifact-undeclared");
  const journal = input.journal;
  let intent: TransferIntent | undefined;
  const verified = await verifyTerminalTransfer(
    {
      context: input.context,
      host: { status: input.status },
      native: input.native,
      current: input.current,
      artifacts: input.sourceProgram.transferArtifacts,
      destination: () => {
        const current = input.registry.identity?.(accepted.selection.key);
        const destination = input.registry.get(accepted.selection.key, "");
        return current === undefined || destination === undefined
          ? undefined
          : {
              selection: { key: accepted.selection.key, ...current },
              input: destination.input,
            };
      },
      accept: async (verified) => {
        if (!input.current()) throw new TransferError("source-unavailable");
        const instance = `${accepted.selection.key.replace(/[^a-zA-Z0-9_-]/g, "-")}:${crypto.randomUUID()}`;
        intent = {
          version: 1,
          request: accepted,
          provenance: [...verified.provenance],
          launch: {
            ...accepted.selection,
            instance,
            transferAttempt: instance,
            version: program.version,
            inputs: verified.inputs,
            artifactRoot: verified.artifactRoot,
            ...(program.compositionIdentity === undefined
              ? {}
              : {
                  compositionIdentity: {
                    ...program.compositionIdentity,
                    mappings: program.compositionIdentity.mappings.map(
                      (mappings) => mappings.map((mapping) => ({ ...mapping })),
                    ),
                    stageSelections:
                      program.compositionIdentity.stageSelections.map(
                        ([key, version, digest]): [string, number, string] => [
                          key,
                          version,
                          digest,
                        ],
                      ),
                  },
                }),
          },
        };
        await journal.appendEntry(TRANSFER_INTENT_TYPE, intent);
      },
    },
    accepted.manifest,
  );
  switch (verified.kind) {
    case "rejected":
      return rejectTransfer(journal, verified.code, intent?.launch.instance);
    case "verified":
      return intent === undefined
        ? reject("transfer-io")
        : { kind: "prepared", intent, replay: false };
    default:
      return verified satisfies never;
  }
}

export async function recheckTransferInput(
  intent: TransferIntent,
): Promise<void> {
  if (intent.provenance === undefined)
    throw new TransferError("artifact-changed");
  for (const receipt of intent.provenance) {
    await using file = await openPinned(receipt.path, receipt.directory);
    const stat = await file.stat({ bigint: true });
    if (String(stat.dev) !== receipt.dev || String(stat.ino) !== receipt.ino)
      throw new TransferError("artifact-changed");
  }
  for (const artifact of intent.request.manifest.artifacts) {
    await using file = await openPinned(
      join(intent.launch.artifactRoot, artifact.destination),
    );
    const bytes = await file.readFile();
    if (
      bytes.length !== artifact.size ||
      createHash("sha256").update(bytes).digest("hex") !== artifact.sha256
    )
      throw new TransferError("artifact-changed");
  }
}

export function pendingTransfer(
  entries: readonly unknown[],
): TransferIntent | undefined {
  const intent = transferIntents(entries).at(-1);
  if (intent === undefined) return undefined;
  // A later ordinary launch supersedes historical transfer intent.
  let latest: Static<typeof LaunchSchema> | undefined;
  for (const entry of entries) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      "customType" in entry &&
      entry.customType === LAUNCH_ENTRY_TYPE &&
      "data" in entry &&
      Value.Check(LaunchSchema, entry.data)
    )
      latest = entry.data;
  }
  return latest?.instance === intent.request.manifest.source.workflowKey ||
    latest?.instance === intent.launch.instance
    ? intent
    : undefined;
}
