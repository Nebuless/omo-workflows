import { resolve } from "node:path";
import type { ExtensionAPI } from "@code-yeongyu/senpi";

export const compoundEngineeringSkillPath = resolve(
  import.meta.dirname,
  "../skills",
);

export default function compoundEngineering(pi: ExtensionAPI): void {
  pi.on("resources_discover", () => ({
    skillPaths: [compoundEngineeringSkillPath],
  }));
}
