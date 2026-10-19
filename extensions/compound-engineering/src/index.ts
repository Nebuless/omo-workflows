import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@code-yeongyu/senpi";

const COMPOUND_ENGINEERING_ENTRY_SUFFIX = join(
  "compound-engineering",
  "src",
  "index.ts",
);

export function compoundEngineeringSkillPath(entryPath: string): string {
  return resolve(dirname(entryPath), "../skills");
}

function compoundEngineeringEntryPath(
  paths: readonly string[] | undefined,
): string | undefined {
  return paths?.find((path) =>
    path.endsWith(COMPOUND_ENGINEERING_ENTRY_SUFFIX),
  );
}

function loadedExtensionPaths(ctx: unknown): readonly string[] | undefined {
  if (typeof ctx !== "object" || ctx === null) return undefined;
  const paths = Reflect.get(ctx, "loadedExtensionPaths");
  return Array.isArray(paths) && paths.every((path) => typeof path === "string")
    ? paths
    : undefined;
}

export default function compoundEngineering(pi: ExtensionAPI): void {
  pi.on("resources_discover", (_event, ctx) => {
    const entryPath = compoundEngineeringEntryPath(loadedExtensionPaths(ctx));
    return entryPath
      ? { skillPaths: [compoundEngineeringSkillPath(entryPath)] }
      : {};
  });
}
