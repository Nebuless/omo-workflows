import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { repairWorkflowMouse } from "./lib/workflow-mouse-patch.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    apply: { type: "boolean", default: false },
    "package-root": { type: "string" },
  },
  strict: true,
});
const omoRoot = join(
  process.env.BUN_INSTALL ?? join(homedir(), ".bun"),
  "install/global/node_modules/omo-ai",
);
const packageRoot =
  values["package-root"] ??
  dirname(dirname(Bun.resolveSync("@earendil-works/pi-tui", omoRoot)));
const result = repairWorkflowMouse(packageRoot, values.apply);
console.log(
  `${result.changed ? "Repaired" : result.before === result.after ? "Already repaired" : "Patch applicable; verified without mutation"}: ${result.file}`,
);
console.log(`version ${result.version}`);
console.log(`preimage ${result.before}`);
console.log(`postimage ${result.after}`);
