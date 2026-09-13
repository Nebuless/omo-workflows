import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const SENPI_VERSION = "2026.9.10-2";
const files = [
  "dist/core/session-manager.js",
  "dist/core/session-manager.d.ts",
] as const;
const knownHashes = new Map([
  [
    "dist/core/session-manager.js",
    "a3e6980e53e70a87577aa0c6cde2a424bbd2b34ceca4a43fdba914a7fca30b00",
  ],
  [
    "dist/core/session-manager.d.ts",
    "ccb4fcc9075caed29b5500d24a44f50e5107c4c3fc5fcbff163409aeb7054127",
  ],
]);

const patchedHashes = new Map([
  [
    "dist/core/session-manager.js",
    "c673c498f1315e3cc6f146cfc06affde08397b4d16b4ae00775f3f69f219dcb3",
  ],
  [
    "dist/core/session-manager.d.ts",
    "9918bbee01a6fe13552be0006dbd1e2452fbad1c3b485c682a918efc1ea5dcf4",
  ],
]);

function hash(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function replaceOnce(
  source: string,
  before: string,
  after: string,
  file: string,
): string {
  if (source.split(before).length !== 2)
    throw new Error(
      `Unknown ${file}; expected Senpi ${SENPI_VERSION} code was not found.`,
    );
  return source.replace(before, after);
}

function patchJavaScript(source: string): string {
  const imports =
    'import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync, } from "fs";';
  const patchedImports =
    'import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync, } from "fs";';
  const method = `    flushEntries() {
        if (!this.persist || !this.sessionFile)
            throw new Error("Cannot flush an in-memory session");
        reserveSessionWrite(this.sessionFile);
        if (!this.flushed) {
            const fd = openSync(this.sessionFile, "wx");
            try {
                for (const entry of this.fileEntries) {
                    writeFileSync(fd, \`\${JSON.stringify(this.residentStore.materialize(entry))}\\n\`);
                }
                fsyncSync(fd);
            }
            finally {
                closeSync(fd);
            }
            this.flushed = true;
            return;
        }
        const fd = openSync(this.sessionFile, "r+");
        try {
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
    }
`;
  return replaceOnce(
    replaceOnce(
      source,
      imports,
      patchedImports,
      "dist/core/session-manager.js",
    ),
    "    _persist(entry) {\n",
    `${method}    _persist(entry) {\n`,
    "dist/core/session-manager.js",
  );
}

function patchTypes(source: string): string {
  return replaceOnce(
    source,
    "    getResidentStoreStats(): ResidentStoreStats;\n",
    "    getResidentStoreStats(): ResidentStoreStats;\n    /** Persist every pending entry and synchronously acknowledge it on disk. */\n    flushEntries(): void;\n",
    "dist/core/session-manager.d.ts",
  );
}

function writeAtomically(path: string, content: string): void {
  const temporary = join(
    dirname(path),
    `.${path.split("/").at(-1)}.${process.pid}.tmp`,
  );
  if (existsSync(temporary))
    throw new Error(
      `Refusing to overwrite temporary repair file: ${temporary}`,
    );
  const descriptor = openSync(temporary, "wx", statSync(path).mode);
  try {
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function repairWorkflowJournal(
  packageRoot: string,
  apply: boolean,
): Readonly<Record<string, string>> {
  const packageJson = join(packageRoot, "package.json");
  if (!existsSync(packageJson))
    throw new Error(`Cannot find Senpi package: ${packageRoot}`);
  const metadata: unknown = JSON.parse(readFileSync(packageJson, "utf8"));
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    !("version" in metadata) ||
    metadata.version !== SENPI_VERSION
  ) {
    throw new Error(`Expected @code-yeongyu/senpi ${SENPI_VERSION}.`);
  }
  const changes: { file: string; source: string; expected: string }[] = [];
  const result: Record<string, string> = {};
  for (const file of files) {
    const path = join(packageRoot, file);
    if (!existsSync(path))
      throw new Error(`Senpi unbundled target unavailable: ${path}`);
    const bytes = readFileSync(path);
    const digest = hash(bytes);
    const expected = patchedHashes.get(file);
    if (expected === undefined) throw new Error("Missing journal patch hash.");
    if (digest === expected) {
      result[file] = digest;
      continue;
    }
    if (digest !== knownHashes.get(file))
      throw new Error(`Unknown ${file}; refusing repair.`);
    const original = new TextDecoder().decode(bytes);
    const source = file.endsWith(".d.ts")
      ? patchTypes(original)
      : patchJavaScript(original);
    if (hash(new TextEncoder().encode(source)) !== expected)
      throw new Error("Unexpected journal patch postimage.");
    changes.push({ file, source, expected });
    result[file] = digest;
  }
  if (apply)
    for (const { file, source, expected } of changes) {
      writeAtomically(join(packageRoot, file), source);
      result[file] = expected;
    }
  return result;
}
