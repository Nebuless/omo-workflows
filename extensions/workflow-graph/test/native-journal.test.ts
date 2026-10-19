import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createNativeStagedJournal,
  JournalDurabilityError,
} from "../src/execution/native-journal.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = fs.mkdtempSync(join(tmpdir(), "native-journal-"));
  directories.push(directory);
  const file = join(directory, "session.jsonl");
  const entries: unknown[] = [];
  const pi = {
    session: {
      async persistHeaderNow() {
        if (!fs.existsSync(file)) fs.writeFileSync(file, "header\n");
      },
    },
    appendEntry(customType: string, data: unknown) {
      fs.appendFileSync(file, `${JSON.stringify({ customType, data })}\n`);
      entries.push({ customType, data });
    },
  };
  const manager = { getBranch: () => entries, getSessionFile: () => file };
  return { pi, manager, file };
}

test("native journal accepts public header persistence without private flush", async () => {
  const f = fixture();
  const journal = createNativeStagedJournal(f.pi, f.manager);
  if (journal === undefined) throw new Error("journal unavailable");
  await journal.appendEntry("intent", { wave: "one" });
  expect(journal.getBranch()).toEqual([
    { customType: "intent", data: { wave: "one" } },
  ]);
  expect(fs.readFileSync(f.file, "utf8")).toContain('"wave":"one"');
});

test("native journal refuses absent public capability and file-backed session", () => {
  const f = fixture();
  expect(
    createNativeStagedJournal({ appendEntry() {} }, f.manager),
  ).toBeUndefined();
  expect(
    createNativeStagedJournal(
      { ...f.pi, session: { persistHeaderNow: false } },
      f.manager,
    ),
  ).toBeUndefined();
  expect(
    createNativeStagedJournal(f.pi, { getBranch: () => [] }),
  ).toBeUndefined();
  for (const file of [undefined, ""])
    expect(
      createNativeStagedJournal(f.pi, {
        ...f.manager,
        getSessionFile: () => file,
      }),
    ).toBeUndefined();
  expect(f.manager.getBranch()).toHaveLength(0);
});

test("native journal awaits header then appends and fsyncs before admission", async () => {
  const f = fixture();
  const receipt = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const calls: string[] = [];
  const open = filesystem.open;
  const syncSpy = spyOn(filesystem, "open").mockImplementation(
    async (...args: Parameters<typeof open>) => {
      const file = await open(...args);
      const sync = file.sync.bind(file);
      file.sync = async () => {
        calls.push("fsync");
        await sync();
      };
      return file;
    },
  );
  const journal = createNativeStagedJournal(
    {
      session: {
        async persistHeaderNow() {
          calls.push("header");
          entered.resolve();
          await receipt.promise;
          await f.pi.session.persistHeaderNow();
        },
      },
      appendEntry(type, data) {
        calls.push("append");
        f.pi.appendEntry(type, data);
      },
    },
    f.manager,
  );
  if (journal === undefined) throw new Error("journal unavailable");
  try {
    const admission = journal.appendEntry("intent", {}).then(() => {
      calls.push("admitted");
    });
    await entered.promise;
    expect(calls).toEqual(["header"]);
    receipt.resolve();
    await admission;
    expect(calls).toEqual(["header", "append", "fsync", "admitted"]);
  } finally {
    receipt.resolve();
    syncSpy.mockRestore();
  }
});

test("native journal propagates synchronous and asynchronous header failures", async () => {
  for (const persistHeaderNow of [
    () => {
      throw new Error("disk full");
    },
    async () => {
      throw new Error("disk full");
    },
  ]) {
    const f = fixture();
    const journal = createNativeStagedJournal(
      { ...f.pi, session: { persistHeaderNow } },
      f.manager,
    );
    if (journal === undefined) throw new Error("journal unavailable");
    await expect(journal.appendEntry("intent", {})).rejects.toBeInstanceOf(
      JournalDurabilityError,
    );
    expect(f.manager.getBranch()).toHaveLength(0);
  }
});

test("native journal awaits fsync and close before admitting intent", async () => {
  const f = fixture();
  const syncing = Promise.withResolvers<void>();
  const synced = Promise.withResolvers<void>();
  const closing = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const open = filesystem.open;
  const openSpy = spyOn(filesystem, "open").mockImplementation(
    async (...args: Parameters<typeof open>) => {
      const file = await open(...args);
      const sync = file.sync.bind(file);
      const close = file.close.bind(file);
      file.sync = async () => {
        syncing.resolve();
        await synced.promise;
        await sync();
      };
      file.close = async () => {
        closing.resolve();
        await closed.promise;
        await close();
      };
      return file;
    },
  );
  let admitted = false;
  try {
    const journal = createNativeStagedJournal(f.pi, f.manager);
    if (journal === undefined) throw new Error("journal unavailable");
    const admission = journal.appendEntry("intent", {}).then(() => {
      admitted = true;
    });
    await syncing.promise;
    expect(admitted).toBeFalse();
    synced.resolve();
    await closing.promise;
    expect(admitted).toBeFalse();
    closed.resolve();
    await admission;
    expect(admitted).toBeTrue();
  } finally {
    synced.resolve();
    closed.resolve();
    openSpy.mockRestore();
  }
});

test("native journal propagates close failure after fsync", async () => {
  const f = fixture();
  const open = filesystem.open;
  const openSpy = spyOn(filesystem, "open").mockImplementation(
    async (...args: Parameters<typeof open>) => {
      const file = await open(...args);
      const close = file.close.bind(file);
      file.close = async () => {
        await close();
        throw new Error("close failed");
      };
      return file;
    },
  );
  try {
    const journal = createNativeStagedJournal(f.pi, f.manager);
    if (journal === undefined) throw new Error("journal unavailable");
    await expect(journal.appendEntry("intent", {})).rejects.toThrow(
      "close failed",
    );
  } finally {
    openSpy.mockRestore();
  }
});

test("native journal propagates append failures without acknowledgement", async () => {
  const f = fixture();
  const error = new TypeError("append failed");
  const journal = createNativeStagedJournal(
    {
      ...f.pi,
      appendEntry() {
        throw error;
      },
    },
    f.manager,
  );
  if (journal === undefined) throw new Error("journal unavailable");
  await expect(journal.appendEntry("intent", {})).rejects.toBe(error);
});

test("native journal never creates a missing native session file", async () => {
  const f = fixture();
  const journal = createNativeStagedJournal(
    { session: { async persistHeaderNow() {} }, appendEntry() {} },
    f.manager,
  );
  if (journal === undefined) throw new Error("journal unavailable");
  await expect(journal.appendEntry("intent", {})).rejects.toThrow("ENOENT");
  expect(fs.existsSync(f.file)).toBeFalse();
});

test("native journal rejects fsync failure and closes the native file", async () => {
  const f = fixture();
  const open = filesystem.open;
  let closed = false;
  const syncSpy = spyOn(filesystem, "open").mockImplementation(
    async (...args: Parameters<typeof open>) => {
      const file = await open(...args);
      file.sync = async () => {
        throw new Error("fsync failed");
      };
      const close = file.close.bind(file);
      file.close = async () => {
        await close();
        closed = true;
      };
      return file;
    },
  );
  try {
    const journal = createNativeStagedJournal(f.pi, f.manager);
    if (journal === undefined) throw new Error("journal unavailable");
    await expect(journal.appendEntry("intent", {})).rejects.toThrow(
      "fsync failed",
    );
    expect(closed).toBeTrue();
  } finally {
    syncSpy.mockRestore();
  }
});
