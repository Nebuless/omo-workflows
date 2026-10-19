import { dirname, join } from "node:path";

const SKILL_NAMES = [
  "herdr",
  "herdr-agent-management",
  "herdr-handoff",
  "herdr-orchestration",
  "herdr-admin",
] as const;

const HERDR_ENTRY_SUFFIX = join("herdr", "index.ts");

export function herdrSkillPaths(baseDir: string): string[] {
  return SKILL_NAMES.map((name) => join(baseDir, "skills", name, "SKILL.md"));
}

function loadedExtensionPaths(ctx: unknown): readonly string[] | undefined {
  if (typeof ctx !== "object" || ctx === null) return undefined;
  const paths = Reflect.get(ctx, "loadedExtensionPaths");
  return Array.isArray(paths) && paths.every((path) => typeof path === "string")
    ? paths
    : undefined;
}

export function herdrSkillPathsForLoadedExtensions(ctx: unknown): string[] {
  const entryPath = loadedExtensionPaths(ctx)?.find((path) =>
    path.endsWith(HERDR_ENTRY_SUFFIX),
  );
  return entryPath ? herdrSkillPaths(dirname(entryPath)) : [];
}
