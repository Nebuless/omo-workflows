import { expect, test } from "bun:test";
import { createNativeStagedJournal } from "../src/execution/native-journal.ts";

test("native journal refuses missing flush and acknowledges only after flush", async () => {
  const calls: string[] = [];
  const entries: unknown[] = [];
  const pi = {
    appendEntry(type: string, data: unknown) {
      calls.push("append");
      entries.push({ customType: type, data });
    },
  };
  const manager = { getBranch: () => entries, isPersisted: () => true };
  expect(createNativeStagedJournal(pi, manager)).toBeUndefined();
  const journal = createNativeStagedJournal(pi, {
    ...manager,
    flushEntries() {
      calls.push("flush");
    },
  });
  if (journal === undefined) throw new Error("journal unavailable");
  await journal.appendEntry("intent", { wave: "one" });
  expect(calls).toEqual(["append", "flush"]);
  expect(journal.getBranch()).toEqual([
    { customType: "intent", data: { wave: "one" } },
  ]);
  expect(
    createNativeStagedJournal(pi, {
      ...manager,
      isPersisted: () => false,
      flushEntries() {},
    }),
  ).toBeUndefined();
});

test("native journal propagates failed disk acknowledgement", async () => {
  const journal = createNativeStagedJournal(
    { appendEntry() {} },
    {
      getBranch: () => [],
      isPersisted: () => true,
      flushEntries() {
        throw new Error("disk full");
      },
    },
  );
  if (journal === undefined) throw new Error("journal unavailable");
  await expect(journal.appendEntry("intent", {})).rejects.toThrow("disk full");
});
