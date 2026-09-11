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
const extensionEntrypoints = [
  "./extensions/better-custom/src/index.ts",
  "./extensions/herdr/index.ts",
] as const;
if (
  !Array.isArray(extensions) ||
  extensions.length !== extensionEntrypoints.length ||
  !extensionEntrypoints.every((entrypoint) => extensions.includes(entrypoint))
) {
  errors.push("package must expose better-custom and Herdr extensions");
}

for (const entrypoint of extensionEntrypoints) {
  const path = resolve(root, entrypoint);
  if (!existsSync(path)) errors.push(`missing extension entrypoint: ${path}`);
}

const herdrPackagePath = resolve(root, "extensions/herdr/package.json");
if (!existsSync(herdrPackagePath)) {
  errors.push("missing standalone Herdr package manifest");
} else {
  const herdrPackage = JSON.parse(
    readFileSync(herdrPackagePath, "utf8"),
  ) as PackageManifest;
  if (herdrPackage.name !== "@omo-workflows/herdr") {
    errors.push("Herdr package name must be @omo-workflows/herdr");
  }
  if (
    !Array.isArray(herdrPackage.pi?.extensions) ||
    herdrPackage.pi.extensions.length !== 1 ||
    herdrPackage.pi.extensions[0] !== "./index.ts"
  ) {
    errors.push("Herdr package must expose only ./index.ts");
  }
}

const senpiVersion = manifest.dependencies?.["@code-yeongyu/senpi"];
if (senpiVersion !== "2026.9.10-2") {
  errors.push("Senpi must remain pinned to 2026.9.10-2");
}

const sourceFiles = [
  "extensions/better-custom/src/index.ts",
  "extensions/better-custom/src/config.ts",
  "extensions/better-custom/src/model-browser.ts",
];
const herdrSkillFiles = [
  "extensions/herdr/skills/herdr/SKILL.md",
  "extensions/herdr/skills/herdr-agent-management/SKILL.md",
  "extensions/herdr/skills/herdr-handoff/SKILL.md",
  "extensions/herdr/skills/herdr-orchestration/SKILL.md",
  "extensions/herdr/skills/herdr-admin/SKILL.md",
];
for (const relativePath of herdrSkillFiles) {
  if (!existsSync(resolve(root, relativePath))) {
    errors.push(`missing Herdr skill: ${relativePath}`);
  }
}
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
