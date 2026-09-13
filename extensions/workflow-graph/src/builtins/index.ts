import type { StagedProgram } from "../execution/policy.ts";
import { adversarialVerification } from "./adversarial-verification.ts";
import { classifyAndAct } from "./classify-and-act.ts";
import { fanOutAndSynthesize } from "./fan-out-and-synthesize.ts";
import { generateAndFilter } from "./generate-and-filter.ts";
import { goal } from "./goal.ts";
import type { Route } from "./helpers.ts";
import { loopUntilDone } from "./loop-until-done.ts";
import { openClaudeDesign } from "./open-claude-design.ts";
import { ralph } from "./ralph.ts";
import { repoToExtension } from "./repo-to-extension.ts";
import { tournament } from "./tournament.ts";

export { repoToExtension } from "./repo-to-extension.ts";
export {
  RepoToExtensionInputSchema,
  RepositoryReportSchema,
} from "./repo-to-extension-contracts.ts";
export {
  parseBuiltinInput,
  type BuiltinName,
  type ParsedInputs,
} from "./schemas.ts";
export type { Route } from "./helpers.ts";
export {
  adversarialVerification,
  classifyAndAct,
  fanOutAndSynthesize,
  generateAndFilter,
  goal,
  loopUntilDone,
  openClaudeDesign,
  ralph,
  tournament,
};

export function atomicBuiltins(
  route: Route,
  artifactRoot: string,
): readonly StagedProgram[] {
  return [
    classifyAndAct(route, artifactRoot),
    fanOutAndSynthesize(route, artifactRoot),
    adversarialVerification(route, artifactRoot),
    generateAndFilter(route, artifactRoot),
    tournament(route, artifactRoot),
    loopUntilDone(route, artifactRoot),
    goal(route, artifactRoot),
    ralph(route, artifactRoot),
    openClaudeDesign(route, artifactRoot),
    repoToExtension(route, artifactRoot),
  ];
}
