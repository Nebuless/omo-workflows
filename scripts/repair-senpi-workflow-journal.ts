import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { repairWorkflowJournal } from "./lib/workflow-journal-patch.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    apply: { type: "boolean", default: false },
    "package-root": { type: "string" },
  },
});
const omoRoot = join(
  process.env.BUN_INSTALL ?? join(homedir(), ".bun"),
  "install/global/node_modules/omo-ai",
);
const packageRoot =
  values["package-root"] ??
  dirname(dirname(Bun.resolveSync("@code-yeongyu/senpi", omoRoot)));
const hashes = repairWorkflowJournal(packageRoot, values.apply);
console.log(
  `${values.apply ? "Repaired: " : "Verified without mutation: "}${packageRoot}`,
);
for (const [file, hash] of Object.entries(hashes))
  console.log(`${file} ${hash}`);
