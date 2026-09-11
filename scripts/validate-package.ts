import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type PackageManifest = {
  name?: unknown;
  version?: unknown;
  pi?: {
    extensions?: unknown;
  };
  dependencies?: Record<string, unknown>;
};

const root = resolve(import.meta.dirname, "..");
const packagePath = resolve(root, "package.json");
const manifest = JSON.parse(
  readFileSync(packagePath, "utf8"),
) as PackageManifest;
const errors: string[] = [];

if (manifest.name !== "omo-workflows")
  errors.push("package name must be omo-workflows");
if (manifest.version !== "0.1.0") errors.push("package version must be 0.1.0");

const extensions = manifest.pi?.extensions;
if (!Array.isArray(extensions) || extensions.length !== 1) {
  errors.push("package must expose exactly one pi extension");
} else if (extensions[0] !== "./extensions/better-custom/src/index.ts") {
  errors.push("unexpected better-custom extension entrypoint");
}

const entrypoint = resolve(root, "extensions/better-custom/src/index.ts");
if (!existsSync(entrypoint))
  errors.push(`missing extension entrypoint: ${entrypoint}`);

const senpiVersion = manifest.dependencies?.["@code-yeongyu/senpi"];
if (senpiVersion !== "2026.9.10-2") {
  errors.push("Senpi must remain pinned to 2026.9.10-2");
}

const sourceFiles = [
  "extensions/better-custom/src/index.ts",
  "extensions/better-custom/src/config.ts",
  "extensions/better-custom/src/model-browser.ts",
];
for (const relativePath of sourceFiles) {
  const source = readFileSync(resolve(root, relativePath), "utf8");
  if (source.includes("@bastani/atomic") || source.includes("@bastani/pi-ai")) {
    errors.push(`${relativePath} still imports Atomic-only packages`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("package manifest valid");
