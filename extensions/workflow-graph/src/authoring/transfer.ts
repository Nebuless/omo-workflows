import { constants } from "node:fs";
import { mkdtemp, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import {
  CompositionMappingSchema,
  applyCompositionMapping,
  rfc6901Lookup,
} from "../execution/composition.ts";
import {
  snapshotTransferSource,
  sourceAuthority,
  transferSourceJournal,
} from "./transfer-source.ts";
import type { NativeWorkflowTransport } from "../execution/native-transport.ts";
import type { ProgramContext, ProgramHost } from "./host.ts";
import {
  cleanupAllocation,
  copyArtifact,
  descriptorPath,
  openPinned,
  recheckArtifact,
  relativeArtifactPath,
  TransferError,
  verifyAllocation,
  type ArtifactDeclaration,
  type CopiedArtifact,
  type OwnedEntry,
  type TransferCode,
  type TransferObserver,
} from "./transfer-files.ts";

const SelectionSchema = Type.Object(
  {
    key: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 0 }),
    digest: Type.String({ pattern: "^sha256:v1:[0-9a-f]{64}$" }),
  },
  { additionalProperties: false },
);
export const TerminalTransferSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    source: Type.Object(
      {
        runId: Type.String({ minLength: 1 }),
        workflowKey: Type.String({ minLength: 1 }),
        definitionFingerprint: Type.String({ pattern: "^[0-9a-f]{64}$" }),
        terminal: Type.Literal(true),
      },
      { additionalProperties: false },
    ),
    destination: SelectionSchema,
    artifacts: Type.Array(
      Type.Object(
        {
          canonicalPath: Type.String({ minLength: 1 }),
          destination: Type.String({ minLength: 1 }),
          sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
          size: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
          schemaId: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
    mappings: Type.Array(CompositionMappingSchema, {
      minItems: 1,
      maxItems: 64,
    }),
  },
  { additionalProperties: false },
);
export type TerminalTransfer = Static<typeof TerminalTransferSchema>;
type Destination = {
  readonly selection: Static<typeof SelectionSchema>;
  readonly input: TSchema;
};
export type TransferContext = {
  readonly host: Pick<ProgramHost, "status">;
  readonly context: Pick<ProgramContext, "cwd" | "sessionManager">;
  readonly native: NativeWorkflowTransport;
  readonly destination: () => Destination | undefined;
  readonly artifacts: readonly ArtifactDeclaration[];
  readonly current?: () => boolean;
  readonly observe?: TransferObserver;
  readonly accept?: (
    verified: Extract<TransferResult, { kind: "verified" }>,
  ) => Promise<void>;
};
export type TransferResult =
  | { readonly kind: "rejected"; readonly code: TransferCode }
  | {
      readonly kind: "verified";
      readonly artifactRoot: string;
      readonly inputs: unknown;
      readonly manifest: TerminalTransfer;
      readonly provenance: readonly {
        readonly path: string;
        readonly directory: boolean;
        readonly dev: string;
        readonly ino: string;
      }[];
    };
function destinationAuthority(
  input: TransferContext,
  manifest: TerminalTransfer,
): Destination {
  const destination = input.destination();
  if (
    destination === undefined ||
    !isDeepStrictEqual(destination.selection, manifest.destination)
  )
    throw new TransferError("destination-identity");
  return structuredClone(destination);
}

/** Internal prepare-only boundary. Caller owns successful copies; this function never dispatches a destination. */
export async function verifyTerminalTransfer(
  input: TransferContext,
  request: unknown,
): Promise<TransferResult> {
  const handles = new AsyncDisposableStack();
  const entries: OwnedEntry[] = [];
  let allocated: string | undefined;
  let result: TransferResult;
  try {
    if (!Value.Check(TerminalTransferSchema, request))
      throw new TransferError("manifest-invalid");
    const manifest = structuredClone(request);
    const declarations = structuredClone(input.artifacts);
    const source = sourceAuthority(input, manifest);
    const destination = destinationAuthority(input, manifest);
    let durable = false;
    const revalidate = () => {
      // Disposal detaches host, not acknowledged intent. Journal still owns source authority for explicit restore.
      const authority =
        durable && input.current?.() === false
          ? {
              ...transferSourceJournal(input.context, manifest),
              final: source.final,
            }
          : sourceAuthority(input, manifest);
      if (!isDeepStrictEqual(authority, source))
        throw new TransferError("source-identity");
      if (
        !isDeepStrictEqual(destinationAuthority(input, manifest), destination)
      )
        throw new TransferError("destination-identity");
    };
    await snapshotTransferSource(input.native, manifest);
    revalidate();
    if (
      manifest.artifacts.length !== declarations.length ||
      manifest.mappings.length !== declarations.length ||
      new Set(manifest.artifacts.map((artifact) => artifact.canonicalPath))
        .size !== declarations.length ||
      new Set(manifest.artifacts.map((artifact) => artifact.destination))
        .size !== declarations.length ||
      new Set(manifest.mappings.map((mapping) => mapping.destination)).size !==
        declarations.length
    )
      throw new TransferError("artifact-undeclared");
    const bindings = manifest.artifacts.map((artifact) => {
      if (
        !relativeArtifactPath(artifact.canonicalPath) ||
        !relativeArtifactPath(artifact.destination)
      )
        throw new TransferError("artifact-path");
      const declaration = declarations.find(
        (item) => item.canonicalPath === artifact.canonicalPath,
      );
      if (
        declaration === undefined ||
        declaration.destination !== artifact.destination
      )
        throw new TransferError("artifact-undeclared");
      if (declaration.schemaId !== artifact.schemaId)
        throw new TransferError("artifact-schema");
      if (
        !manifest.mappings.some((mapping) =>
          isDeepStrictEqual(mapping, declaration.mapping),
        )
      )
        throw new TransferError("mapping-invalid");
      const found = rfc6901Lookup(source.final, declaration.mapping.source);
      if (
        !found.found ||
        found.value !== join(source.root, artifact.canonicalPath)
      )
        throw new TransferError("mapping-invalid");
      return { artifact, declaration };
    });
    const parent = handles.use(await openPinned(source.parent, true));
    revalidate();
    await using root = await openPinned(source.root, true);
    revalidate();
    const sourceRoot = await realpath(descriptorPath(root));
    revalidate();
    const temporary = await mkdtemp(join(descriptorPath(parent), "transfer-"));
    const name = temporary.split("/").at(-1);
    if (name === undefined) throw new TransferError("artifact-path");
    allocated = join(source.parent, name);
    const targetRoot = handles.use(
      await open(
        temporary,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      ),
    );
    entries.push({ path: allocated, name, parent, file: targetRoot });
    revalidate();
    const allocation = { path: allocated, root: targetRoot, handles, entries };
    const copies: CopiedArtifact[] = [];
    for (const { artifact, declaration } of bindings) {
      const target = join(allocated, artifact.destination);
      copies.push(
        await copyArtifact({
          source: join(sourceRoot, artifact.canonicalPath),
          target,
          allocation,
          declaration,
          expected: artifact,
          observe: input.observe,
        }),
      );
      revalidate();
    }
    let inputs: unknown;
    try {
      inputs = applyCompositionMapping(
        copies.map((copy) => copy.target),
        {},
        bindings.map(({ declaration }, index) => ({
          source: `/${index}`,
          destination: declaration.mapping.destination,
        })),
        destination.input,
      );
    } catch (error) {
      if (error instanceof Error) throw new TransferError("mapping-invalid");
      throw error;
    }
    await snapshotTransferSource(input.native, manifest);
    revalidate();
    for (const copy of copies) {
      await recheckArtifact(copy);
      revalidate();
    }
    await verifyAllocation(allocation);
    revalidate();
    const provenance = [];
    for (const entry of entries) {
      const stat = await entry.file.stat({ bigint: true });
      revalidate();
      provenance.push({
        path: entry.path,
        directory: stat.isDirectory(),
        dev: String(stat.dev),
        ino: String(stat.ino),
      });
    }
    const verified = {
      kind: "verified" as const,
      artifactRoot: allocated,
      inputs,
      provenance,
      manifest: {
        ...manifest,
        artifacts: manifest.artifacts.map((artifact) => ({
          ...artifact,
          canonicalPath: artifact.destination,
        })),
      },
    };
    await input.accept?.(verified);
    durable = input.accept !== undefined;
    revalidate();
    await snapshotTransferSource(input.native, manifest);
    revalidate();
    for (const copy of copies) {
      await recheckArtifact(copy);
      revalidate();
    }
    await verifyAllocation(allocation);
    revalidate();
    result = verified;
  } catch (error) {
    // No source paths, thrown messages, or native error bodies cross this boundary.
    result = {
      kind: "rejected",
      code: error instanceof TransferError ? error.code : "transfer-io",
    };
    if (allocated !== undefined) {
      try {
        await cleanupAllocation(entries);
      } catch {
        // no-excuse-ok: catch -- cleanup boundary reports failure without private filesystem payloads.
        result = { kind: "rejected", code: "cleanup-failed" };
      }
    }
  } finally {
    try {
      await handles.disposeAsync();
    } catch {
      // no-excuse-ok: catch -- descriptor disposal is also a bounded cleanup boundary.
      result = { kind: "rejected", code: "cleanup-failed" };
    }
  }
  return result;
}
