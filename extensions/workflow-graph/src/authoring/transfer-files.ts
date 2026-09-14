import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rmdir,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, join, parse } from "node:path";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";

export type TransferCode =
  | "manifest-invalid"
  | "source-unavailable"
  | "source-identity"
  | "source-not-completed"
  | "destination-identity"
  | "mapping-invalid"
  | "artifact-undeclared"
  | "artifact-path"
  | "artifact-invalid"
  | "artifact-hash"
  | "artifact-size"
  | "artifact-schema"
  | "artifact-changed"
  | "transfer-io"
  | "cleanup-failed";
export class TransferError extends Error {
  override readonly name = "TransferError";
  constructor(readonly code: TransferCode) {
    super(code);
  }
}
export type ArtifactDeclaration = {
  readonly canonicalPath: string;
  readonly destination: string;
  readonly schemaId: string;
  readonly schema: TSchema;
  readonly mapping: { readonly source: string; readonly destination: string };
};
export type ArtifactDigest = { readonly sha256: string; readonly size: number };
export type TransferObserver = (event: {
  readonly phase: "source-opened" | "copied";
  readonly path: string;
}) => Promise<void>;

export function relativeArtifactPath(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    [...path].every(
      (character) =>
        character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    ) &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

// ponytail: Linux descriptor-relative traversal; add native openat support before other platforms.
export const descriptorPath = (file: FileHandle) => `/proc/self/fd/${file.fd}`;
export async function openPinned(
  path: string,
  directory = false,
): Promise<FileHandle> {
  if (
    process.platform !== "linux" ||
    !isAbsolute(path) ||
    path !== join(parse(path).root, ...path.split("/"))
  )
    throw new TransferError("artifact-path");
  let current = await open("/", constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const parts = path.split("/").filter(Boolean);
    for (const [index, part] of parts.entries()) {
      const flags =
        constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (index < parts.length - 1 || directory ? constants.O_DIRECTORY : 0);
      const next = await open(join(descriptorPath(current), part), flags);
      try {
        await current.close();
      } catch (error) {
        await next.close();
        throw error;
      }
      current = next;
    }
    const stat = await current.stat();
    if (directory ? !stat.isDirectory() : !stat.isFile())
      throw new TransferError("artifact-invalid");
    if ((await realpath(descriptorPath(current))) !== path)
      throw new TransferError("artifact-path");
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}

async function pinnedBytes(file: FileHandle): Promise<Buffer> {
  const before = await file.stat({ bigint: true });
  const bytes = Buffer.alloc(Number(before.size));
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await file.read(
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (bytesRead === 0) throw new TransferError("artifact-changed");
    offset += bytesRead;
  }
  const after = await file.stat({ bigint: true });
  if (
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  )
    throw new TransferError("artifact-changed");
  return bytes;
}
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export type CopiedArtifact = {
  readonly source: string;
  readonly target: string;
  readonly expected: ArtifactDigest;
  readonly sourceIdentity: {
    readonly dev: bigint;
    readonly ino: bigint;
    readonly mtimeNs: bigint;
    readonly ctimeNs: bigint;
  };
  readonly targetIdentity: { readonly dev: bigint; readonly ino: bigint };
};

export type OwnedEntry = {
  readonly path: string;
  readonly name: string;
  readonly parent: FileHandle;
  readonly file: FileHandle;
};
export type OwnedAllocation = {
  readonly path: string;
  readonly root: FileHandle;
  readonly handles: AsyncDisposableStack;
  // Append acquisitions before writes/hooks; retain them even when copy verification throws.
  readonly entries: OwnedEntry[];
};

export async function verifyAllocation(
  allocation: OwnedAllocation,
): Promise<void> {
  for (const entry of allocation.entries) {
    await using current = await openPinned(
      entry.path,
      (await entry.file.stat()).isDirectory(),
    );
    const identity = await entry.file.stat({ bigint: true });
    const actual = await current.stat({ bigint: true });
    if (identity.dev !== actual.dev || identity.ino !== actual.ino)
      throw new TransferError("artifact-changed");
  }
}

export async function cleanupAllocation(
  entries: readonly OwnedEntry[],
): Promise<void> {
  if (entries.length === 0) throw new TransferError("cleanup-failed");
  for (const entry of [...entries].reverse()) {
    const path = join(descriptorPath(entry.parent), entry.name);
    const identity = await entry.file.stat({ bigint: true });
    const actual = await lstat(path, { bigint: true });
    if (identity.dev !== actual.dev || identity.ino !== actual.ino)
      throw new TransferError("cleanup-failed");
    // Never recurse into re-resolved names or remove entries not acquired by this transfer.
    if (identity.isDirectory()) await rmdir(path);
    else await unlink(path);
  }
}

export async function copyArtifact(input: {
  readonly source: string;
  readonly target: string;
  readonly allocation: OwnedAllocation;
  readonly declaration: ArtifactDeclaration;
  readonly expected: ArtifactDigest;
  readonly observe?: TransferObserver;
}): Promise<CopiedArtifact> {
  await using source = await openPinned(input.source);
  const identity = await source.stat({ bigint: true });
  if (identity.size !== BigInt(input.expected.size))
    throw new TransferError("artifact-size");
  await input.observe?.({ phase: "source-opened", path: input.source });
  const bytes = await pinnedBytes(source);
  if (hash(bytes) !== input.expected.sha256)
    throw new TransferError("artifact-hash");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError)
      throw new TransferError("artifact-schema");
    throw error;
  }
  if (!Value.Check(input.declaration.schema, value))
    throw new TransferError("artifact-schema");
  const targetName = input.target.split("/").at(-1);
  if (targetName === undefined) throw new TransferError("artifact-path");
  let directory = input.allocation.root;
  let directoryPath = input.allocation.path;
  for (const name of dirname(input.declaration.destination)
    .split("/")
    .filter((part) => part !== ".")) {
    directoryPath = join(directoryPath, name);
    const existing = input.allocation.entries.find(
      (entry) => entry.path === directoryPath,
    );
    if (existing !== undefined) {
      directory = existing.file;
      continue;
    }
    const path = join(descriptorPath(directory), name);
    await mkdir(path, { mode: 0o700 });
    const file = input.allocation.handles.use(
      await open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      ),
    );
    input.allocation.entries.push({
      path: directoryPath,
      name,
      parent: directory,
      file,
    });
    directory = file;
  }
  const target = input.allocation.handles.use(
    await open(join(descriptorPath(directory), targetName), "wx+", 0o600),
  );
  input.allocation.entries.push({
    path: input.target,
    name: targetName,
    parent: directory,
    file: target,
  });
  await target.writeFile(bytes);
  await input.observe?.({ phase: "copied", path: input.target });
  const receipt = {
    source: input.source,
    target: input.target,
    expected: input.expected,
    sourceIdentity: identity,
    targetIdentity: await target.stat({ bigint: true }),
  };
  await recheckArtifact(receipt);
  return receipt;
}

export async function recheckArtifact(input: CopiedArtifact): Promise<void> {
  // No-follow traversal catches renamed roots/parents/leaves even when replacement bytes match.
  await using sourceNow = await openPinned(input.source);
  await using targetNow = await openPinned(input.target);
  const sourceIdentity = await sourceNow.stat({ bigint: true });
  const targetIdentity = await targetNow.stat({ bigint: true });
  if (
    input.sourceIdentity.dev !== sourceIdentity.dev ||
    input.sourceIdentity.ino !== sourceIdentity.ino ||
    input.sourceIdentity.mtimeNs !== sourceIdentity.mtimeNs ||
    input.sourceIdentity.ctimeNs !== sourceIdentity.ctimeNs ||
    input.targetIdentity.dev !== targetIdentity.dev ||
    input.targetIdentity.ino !== targetIdentity.ino
  )
    throw new TransferError("artifact-changed");
  for (const file of [sourceNow, targetNow]) {
    const copied = await pinnedBytes(file);
    if (
      copied.length !== input.expected.size ||
      hash(copied) !== input.expected.sha256
    )
      throw new TransferError("artifact-changed");
  }
}
