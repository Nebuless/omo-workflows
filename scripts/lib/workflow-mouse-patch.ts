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

export const SENPI_TUI_VERSION = "2026.9.10-2";
export const TUI_ALT_SCREEN_FILE = "dist/tui-alt-screen.js";
export const PREIMAGE_SHA256 =
  "7ffca25def0e5b1a92812163d20224fdaf56a102c37307af3a4a1e73428faf0a";
export const POSTIMAGE_SHA256 =
  "aaf31dc01b5038d92fa9f6263c0b1d493b05a7ec2bfaabfe9ed6db2e82800b31";

const seam = `        const mouseEvent = this.parseSgrMouseEvent(data);
        if (mouseEvent) {
            if (this.handleRightClickPaste(mouseEvent))`;
const replacement = `        const mouseEvent = this.parseSgrMouseEvent(data);
        if (mouseEvent) {
            if (this.shouldDeferViewportInputToOverlay())
                return undefined;
            if (this.handleRightClickPaste(mouseEvent))`;

export function sha256(bytes: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function packageVersion(packageRoot: string): string | undefined {
  try {
    const metadata: unknown = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    );
    return metadata !== null &&
      typeof metadata === "object" &&
      "version" in metadata &&
      typeof metadata.version === "string"
      ? metadata.version
      : undefined;
  } catch {
    return undefined;
  }
}

function patch(source: string): string {
  if (source.split(seam).length !== 2)
    throw new Error(
      `Unknown ${TUI_ALT_SCREEN_FILE}; expected Senpi TUI ${SENPI_TUI_VERSION} code was not found.`,
    );
  return source.replace(seam, replacement);
}

function writeAtomically(path: string, source: string): void {
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
    writeFileSync(descriptor, source);
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

export type WorkflowMouseRepair = Readonly<{
  file: string;
  version: string;
  before: string;
  after: string;
  changed: boolean;
}>;

export function repairWorkflowMouse(
  packageRoot: string,
  apply = false,
): WorkflowMouseRepair {
  if (packageVersion(packageRoot) !== SENPI_TUI_VERSION)
    throw new Error(
      `Expected @earendil-works/pi-tui ${SENPI_TUI_VERSION}; refusing repair.`,
    );
  const path = join(packageRoot, TUI_ALT_SCREEN_FILE);
  if (!existsSync(path))
    throw new Error(`Senpi TUI target unavailable: ${path}`);
  const bytes = readFileSync(path);
  const before = sha256(bytes);
  if (before === POSTIMAGE_SHA256)
    return {
      file: path,
      version: SENPI_TUI_VERSION,
      before,
      after: before,
      changed: false,
    };
  if (before !== PREIMAGE_SHA256)
    throw new Error(
      `Unknown ${TUI_ALT_SCREEN_FILE} SHA-256 ${before}; refusing repair.`,
    );
  const source = patch(new TextDecoder().decode(bytes));
  const after = sha256(source);
  if (after !== POSTIMAGE_SHA256)
    throw new Error(`Unexpected ${TUI_ALT_SCREEN_FILE} patch postimage.`);
  if (apply) writeAtomically(path, source);
  return {
    file: path,
    version: SENPI_TUI_VERSION,
    before,
    after,
    changed: apply,
  };
}
