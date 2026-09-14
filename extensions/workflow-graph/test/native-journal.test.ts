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

test("native journal awaits asynchronous disk acknowledgement before admitting intent", async () => {
  // Given: extension-visible async receipt held at its durability boundary.
  const receipt = Promise.withResolvers<void>();
  const journal = createNativeStagedJournal(
    { appendEntry() {} },
    {
      getBranch: () => [],
      isPersisted: () => true,
      flushEntries: () => receipt.promise,
    },
  );
  if (journal === undefined) throw new Error("journal unavailable");
  const calls: string[] = [];
  const admission = journal
    .appendEntry("intent", {})
    .then(() => calls.push("admitted"));
  // When: the native receipt succeeds in a later microtask.
  await Promise.resolve();
  calls.push("durable");
  receipt.resolve();
  await admission;
  // Then: downstream admission follows the actual receipt, never the append alone.
  expect(calls).toEqual(["durable", "admitted"]);
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
