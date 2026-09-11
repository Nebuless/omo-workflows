import { join } from "node:path";

const SKILL_NAMES = [
  "herdr",
  "herdr-agent-management",
  "herdr-handoff",
  "herdr-orchestration",
  "herdr-admin",
] as const;

export function herdrSkillPaths(baseDir = import.meta.dirname): string[] {
  return SKILL_NAMES.map((name) => join(baseDir, "skills", name, "SKILL.md"));
}
