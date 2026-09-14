import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const OMO_VERSION = "5.0.0-0.beta.62";
export const PREIMAGE_SHA256 =
  "23263ffd451afeec0d9ea5224d6742d36c19e72d37d58d936035991e1aa622b2";
export const POSTIMAGE_SHA256 =
  "f768856997fcd3b336307bc3940057545a25618b2059e95fc67c47eeab252d28";

const hook =
  'if("tui"===n.mode){let a=globalThis[Symbol.for("omo.workflow-graph.native-dag-ui.v1")];if("workflow-graph"===a?.owner)try{if(await a.handle({args:t,context:n,runId:o,sessionId:i}))return}catch{}}';
const seam = "let o=t.trim().split(/\\s+/).filter(e=>e.length>0)[0];";
const replacement = `${seam}if(void 0===o){${hook}}else{let a;try{a=e.snapshot(o,i)}catch{}if(void 0!==a){${hook}}}`;

export function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export function parseOmoVersion(source: string): string | undefined {
  try {
    const value: unknown = JSON.parse(source);
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      typeof value.version === "string"
    )
      return value.version;
  } catch {
    return undefined;
  }
  return undefined;
}

export function patchNativeDagUi(source: string): string | undefined {
  if (sha256(source) !== PREIMAGE_SHA256 || source.split(seam).length !== 2)
    return undefined;
  return source.replace(seam, replacement);
}

export function repairState(
  source: string,
): "preimage" | "postimage" | "invalid" {
  const digest = sha256(source);
  if (digest === PREIMAGE_SHA256) return "preimage";
  if (digest === POSTIMAGE_SHA256) return "postimage";
  return "invalid";
}

export async function writeAtomically(
  path: string,
  source: string,
): Promise<void> {
  const metadata = await stat(path);
  const temporary = join(dirname(path), `.${crypto.randomUUID()}.tmp`);
  await writeFile(temporary, source, { mode: metadata.mode });
  await rename(temporary, path);
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new Error(`Missing value for ${name}`);
  return value;
}

export async function repairNativeDagUi(
  args: readonly string[],
): Promise<string> {
  const allowed = new Set(["--apply", "--path", "--package-path"]);
  for (const arg of args) {
    if (arg.startsWith("--") && !allowed.has(arg))
      throw new Error(`Unknown option ${arg}`);
  }
  const bunInstall = process.env.BUN_INSTALL ?? join(homedir(), ".bun");
  const installed = join(
    bunInstall,
    "install",
    "global",
    "node_modules",
    "omo-ai",
  );
  const target =
    option(args, "--path") ??
    join(installed, "plugin", "extensions", "omo-task.js");
  const packagePath =
    option(args, "--package-path") ?? join(installed, "package.json");
  if (!existsSync(packagePath))
    throw new Error(`Cannot find OMO package at ${installed}`);
  if (parseOmoVersion(await readFile(packagePath, "utf8")) !== OMO_VERSION)
    throw new Error(`Refusing OMO package not pinned to ${OMO_VERSION}`);
  if (!existsSync(target))
    throw new Error(`Cannot find native /dag handler at ${target}`);
  const source = await readFile(target, "utf8");
  switch (repairState(source)) {
    case "postimage":
      return `Native /dag UI hook already patched: ${target}`;
    case "invalid":
      throw new Error(
        `Refusing unexpected omo-task.js SHA-256: ${sha256(source)}`,
      );
    case "preimage": {
      const patched = patchNativeDagUi(source);
      if (patched === undefined || sha256(patched) !== POSTIMAGE_SHA256)
        throw new Error("Refusing invalid native /dag postimage");
      if (!args.includes("--apply"))
        return `Patch applicable: ${target}. Re-run with --apply to mutate.`;
      await writeAtomically(target, patched);
      return `Patched native /dag TUI delegation: ${target}`;
    }
  }
}

if (import.meta.main)
  console.log(await repairNativeDagUi(process.argv.slice(2)));
