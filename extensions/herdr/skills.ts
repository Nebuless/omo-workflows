import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAMES = [
  "herdr",
  "herdr-agent-management",
  "herdr-handoff",
  "herdr-orchestration",
  "herdr-admin",
] as const;

export function herdrSkillPaths(
  baseDir = fileURLToPath(new URL(".", import.meta.url)),
): string[] {
  return SKILL_NAMES.map((name) => join(baseDir, "skills", name, "SKILL.md"));
}
