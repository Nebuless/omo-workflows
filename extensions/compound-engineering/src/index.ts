import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@code-yeongyu/senpi";

export const compoundEngineeringSkillPath = fileURLToPath(
  new URL("../skills", import.meta.url),
);

export default function compoundEngineering(pi: ExtensionAPI): void {
  pi.on("resources_discover", () => ({
    skillPaths: [compoundEngineeringSkillPath],
  }));
}
