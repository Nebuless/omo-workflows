import { join, relative } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { STAGED_ENTRY_TYPE } from "../execution/controller.ts";
import { nativeDefinitionFingerprint } from "../execution/native-fingerprint.ts";
import type { NativeWorkflowTransport } from "../execution/native-transport.ts";
import { AuthoredWorkflowSchema } from "../execution/policy.ts";
import type { ProgramContext } from "./host.ts";
import { LAUNCH_ENTRY_TYPE } from "./launch-record.ts";
import { relativeArtifactPath, TransferError } from "./transfer-files.ts";
import type { TerminalTransfer, TransferContext } from "./transfer.ts";

const Launch = Type.Object({
  instance: Type.String(),
  artifactRoot: Type.String(),
});
const Checkpoint = Type.Object({
  workflow: Type.String(),
  runId: Type.String(),
  definition: AuthoredWorkflowSchema,
  admittedWaves: Type.Array(Type.String(), { minItems: 1 }),
  activeWave: Type.Optional(Type.String()),
  intent: Type.Optional(Type.Unknown()),
  rejected: Type.Optional(Type.String()),
  cancelled: Type.Optional(Type.Boolean()),
});

export function transferSourceJournal(
  context: Pick<ProgramContext, "cwd" | "sessionManager">,
  manifest: TerminalTransfer,
) {
  let launch: Static<typeof Launch> | undefined;
  let latest: unknown;
  for (const entry of context.sessionManager.getBranch()) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("customType" in entry) ||
      !("data" in entry)
    )
      continue;
    if (
      entry.customType === LAUNCH_ENTRY_TYPE &&
      Value.Check(Launch, entry.data) &&
      entry.data.instance === manifest.source.workflowKey
    )
      launch = entry.data;
    if (
      entry.customType === STAGED_ENTRY_TYPE &&
      typeof entry.data === "object" &&
      entry.data !== null &&
      "workflow" in entry.data &&
      entry.data.workflow === manifest.source.workflowKey
    )
      latest = entry.data;
  }
  // Select latest authority first; malformed or ineligible state never falls back to history.
  if (
    launch === undefined ||
    !Value.Check(Checkpoint, latest) ||
    latest.activeWave !== undefined ||
    latest.intent !== undefined ||
    latest.rejected !== undefined ||
    latest.cancelled === true
  )
    throw new TransferError("source-unavailable");
  if (
    latest.runId !== manifest.source.runId ||
    latest.definition.key !== manifest.source.workflowKey ||
    nativeDefinitionFingerprint(latest.definition) !==
      manifest.source.definitionFingerprint
  )
    throw new TransferError("source-identity");
  const parent = join(context.cwd, ".omo", "workflow-artifacts");
  if (!relativeArtifactPath(relative(parent, launch.artifactRoot)))
    throw new TransferError("artifact-path");
  return { root: launch.artifactRoot, parent };
}

export async function snapshotTransferSource(
  native: NativeWorkflowTransport,
  manifest: TerminalTransfer,
): Promise<void> {
  const { details } = await native.execute({
    action: "snapshot",
    run_id: manifest.source.runId,
  });
  if (
    details.kind !== "snapshot" ||
    details.run_id !== manifest.source.runId ||
    details.snapshot.runId !== manifest.source.runId ||
    details.snapshot.runKey !== manifest.source.workflowKey ||
    details.snapshot.definitionFingerprint !==
      manifest.source.definitionFingerprint
  )
    throw new TransferError("source-identity");
  if (
    details.snapshot.status !== "completed" ||
    details.snapshot.nodes.some((node) => node.state !== "completed")
  )
    throw new TransferError("source-not-completed");
}

export function sourceAuthority(
  input: Pick<TransferContext, "host" | "context" | "current">,
  manifest: TerminalTransfer,
) {
  const status = input.host.status();
  if (
    input.current?.() === false ||
    status === undefined ||
    status.decision?.kind !== "final" ||
    status.error !== undefined
  )
    throw new TransferError("source-unavailable");
  if (
    status.runId !== manifest.source.runId ||
    status.instance !== manifest.source.workflowKey
  )
    throw new TransferError("source-identity");
  return {
    ...transferSourceJournal(input.context, manifest),
    final: structuredClone(status.decision.result),
  };
}
