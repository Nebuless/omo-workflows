import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repairWorkflowJournal } from "../../../scripts/lib/workflow-journal-patch.ts";

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const path of temporaryPaths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

type JournalManager = {
  appendCustomEntry(customType: string, data?: unknown): string;
  getSessionFile(): string | undefined;
};
type JournalManagerConstructor = {
  create(cwd: string, sessionDir?: string): JournalManager;
};

function copiedPackage(): string {
  const target = mkdtempSync(join(tmpdir(), "senpi-journal-package-"));
  temporaryPaths.push(target);
  const source = require
    .resolve("@code-yeongyu/senpi/package.json")
    .replace(/\/package\.json$/, "");
  cpSync(source, target, { recursive: true });
  return target;
}

async function runPatchedSession(packageRoot: string): Promise<string> {
  const sessionDir = mkdtempSync(join(tmpdir(), "senpi-journal-session-"));
  temporaryPaths.push(sessionDir);
  const runner = join(packageRoot, "workflow-journal-flush-runner.mjs");
  writeFileSync(
    runner,
    `
import { existsSync, readFileSync } from "node:fs";
import { SessionManager } from "./dist/core/session-manager.js";
const sessionDir = process.argv[2];
const count = (manager, intent) => manager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === "omo-workflow-graph:staged" && entry.data?.intent === intent).length;
const first = SessionManager.create(sessionDir, sessionDir);
first.appendCustomEntry("omo-workflow-graph:staged", { intent: "first" });
const sessionFile = first.getSessionFile();
if (sessionFile === undefined || existsSync(sessionFile)) throw new Error("custom entry persisted before flush");
first.flushEntries();
const second = SessionManager.open(sessionFile);
if (count(second, "first") !== 1) throw new Error("first intent missing after reopen");
second.appendCustomEntry("omo-workflow-graph:staged", { intent: "second" });
second.flushEntries();
const third = SessionManager.open(sessionFile);
if (count(third, "first") !== 1 || count(third, "second") !== 1) throw new Error("custom entries duplicated or missing");
if (readFileSync(sessionFile, "utf8").trim().split("\\n").length !== 3) throw new Error("unexpected journal record count");
const memory = SessionManager.inMemory();
try { memory.flushEntries(); throw new Error("in-memory flush unexpectedly succeeded"); } catch (error) { if (!(error instanceof Error) || error.message !== "Cannot flush an in-memory session") throw error; }
console.log("disk-roundtrip-ok");
`,
  );
  const child = Bun.spawn([process.execPath, runner, sessionDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(child.stdout).text();
  const errors = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) throw new Error(errors);
  return output.trim();
}

describe("native Senpi journal flush", () => {
  test("patched SessionManager flushes custom entries before assistant and survives reopen", async () => {
    const packageRoot = copiedPackage();
    const original = await import(
      pathToFileURL(join(packageRoot, "dist/core/session-manager.js")).href
    );
    const OriginalSessionManager: JournalManagerConstructor =
      original.SessionManager;
    expect(
      "flushEntries" in OriginalSessionManager.create(packageRoot, packageRoot),
    ).toBeFalse();
    let gap = "";
    try {
      await runPatchedSession(packageRoot);
    } catch (error) {
      gap = error instanceof Error ? error.message : String(error);
    }
    expect(gap).toContain("flushEntries is not a function");
    const repaired = repairWorkflowJournal(packageRoot, true);
    expect(await runPatchedSession(packageRoot)).toBe("disk-roundtrip-ok");
    expect(repairWorkflowJournal(packageRoot, false)).toEqual(repaired);
    expect(repairWorkflowJournal(packageRoot, true)).toEqual(repaired);
  });
});
