import { afterEach, expect, test } from "bun:test";
import { SessionManager } from "@code-yeongyu/senpi";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeStagedJournal } from "../src/execution/native-journal.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const runtime = (manager: SessionManager) => ({
  session: { persistHeaderNow: () => manager.persistHeaderNow() },
  appendEntry: (type: string, data: unknown) => {
    manager.appendCustomEntry(type, data);
  },
});

test("unmodified SessionManager persists custom entries before conversation and survives reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "senpi-journal-"));
  directories.push(directory);
  const first = SessionManager.create(directory, directory);
  const file = first.getSessionFile();
  if (file === undefined) throw new Error("missing session path");
  expect(existsSync(file)).toBeFalse();
  const journal = createNativeStagedJournal(runtime(first), first);
  if (journal === undefined) throw new Error("journal unavailable");
  await journal.appendEntry("omo-workflow-graph:staged", { intent: "first" });
  const second = SessionManager.open(file);
  expect(second.getSessionId()).toBe(first.getSessionId());
  const resumed = createNativeStagedJournal(runtime(second), second);
  if (resumed === undefined) throw new Error("reopened journal unavailable");
  await resumed.appendEntry("omo-workflow-graph:staged", { intent: "second" });
  const third = SessionManager.open(file);
  expect(
    third
      .getBranch()
      .filter((entry) => entry.type === "custom")
      .map((entry) => entry.data),
  ).toEqual([{ intent: "first" }, { intent: "second" }]);
  expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(3);
});

test("unmodified in-memory SessionManager cannot admit a durable journal", () => {
  const manager = SessionManager.inMemory();
  expect(createNativeStagedJournal(runtime(manager), manager)).toBeUndefined();
  expect(manager.getBranch()).toHaveLength(0);
});

test("unmodified SessionManager header failure rejects before append", async () => {
  const directory = mkdtempSync(join(tmpdir(), "senpi-journal-failure-"));
  directories.push(directory);
  const manager = SessionManager.create(directory, directory);
  const journal = createNativeStagedJournal(runtime(manager), manager);
  if (journal === undefined) throw new Error("journal unavailable");
  rmSync(directory, { recursive: true });
  await expect(journal.appendEntry("intent", {})).rejects.toThrow("ENOENT");
  expect(manager.getBranch()).toHaveLength(0);
});
