import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import {
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { verifyTerminalTransfer } from "../src/authoring/transfer.ts";
import type { TransferObserver } from "../src/authoring/transfer-files.ts";
import { reportBytes, transferFixture } from "./authoring-transfer-fixture.ts";

for (const checkpoint of ["copied", "final-snapshot"] as const) {
  test(`preserves replacement data and removes owned copies when allocation parent rotates at ${checkpoint}`, async () => {
    // Given: application rotates its artifact directory at an exact copy checkpoint.
    await using f = await transferFixture();
    const parent = dirname(f.artifactRoot);
    const archive = join(f.cwd, "archived-workflow-artifacts");
    let replacement = "";
    let copied = "";
    const rotate = async () => {
      const allocationName = basename(dirname(dirname(copied)));
      await rename(parent, archive);
      replacement = join(parent, allocationName, "unrelated.txt");
      await mkdir(dirname(replacement), { recursive: true });
      await writeFile(replacement, "new application data");
    };
    const observe: TransferObserver = async (event) => {
      if (event.phase !== "copied") return;
      copied = event.path;
      if (checkpoint === "copied") await rotate();
    };
    const native = {
      execute: async (
        params: Parameters<typeof f.options.native.execute>[0],
      ) => {
        if (copied !== "" && checkpoint === "final-snapshot") await rotate();
        return f.options.native.execute(params);
      },
    };
    // When: transfer verifies paths after rotation.
    const result = await verifyTerminalTransfer(
      { ...f.options, observe, native },
      f.manifest,
    );
    // Then: rejection preserves replacement data and cleans the original allocation.
    assert(result.kind === "rejected");
    expect(await readFile(replacement, "utf8")).toBe("new application data");
    expect(await readdir(archive)).toEqual([basename(f.artifactRoot)]);
    expect(Object.keys(result).sort()).toEqual(["code", "kind"]);
    expect(
      f.actions.filter((action) => action === "start" || action === "amend"),
    ).toEqual(["start"]);
  });
}

test("returns cleanup-failed without deleting replacement when copied file identity changes", async () => {
  // Given: replacement has same bytes but belongs to another writer.
  await using f = await transferFixture();
  let copied = "";
  const observe: TransferObserver = async (event) => {
    if (event.phase !== "copied") return;
    copied = event.path;
    await rename(copied, `${copied}.owned`);
    await writeFile(copied, reportBytes);
  };
  // When: copy identity fails verification and safe unlink cannot be proven.
  const result = await verifyTerminalTransfer(
    { ...f.options, observe },
    f.manifest,
  );
  // Then: bounded cleanup failure preserves both replacement and displaced owned bytes.
  expect(result).toEqual({ kind: "rejected", code: "cleanup-failed" });
  expect(await readFile(copied)).toEqual(reportBytes);
  expect(await readFile(`${copied}.owned`)).toEqual(reportBytes);
});

test("rejects replacement allocation when final snapshot preserves copied file inode", async () => {
  // Given: leaf identity alone cannot prove the returned root still belongs to this allocation.
  await using f = await transferFixture();
  let copied = "";
  const archive = join(f.cwd, "moved-allocation");
  const native = {
    execute: async (params: Parameters<typeof f.options.native.execute>[0]) => {
      if (copied !== "") {
        await rename(dirname(dirname(copied)), archive);
        await mkdir(dirname(copied), { recursive: true });
        await link(join(archive, "input/report.json"), copied);
        await writeFile(
          join(dirname(dirname(copied)), "unrelated.txt"),
          "replacement data",
        );
      }
      return f.options.native.execute(params);
    },
  };
  // When: final native snapshot replaces root, retaining exact copied file inode and bytes.
  const result = await verifyTerminalTransfer(
    {
      ...f.options,
      native,
      observe: async (event) => {
        if (event.phase === "copied") copied = event.path;
      },
    },
    f.manifest,
  );
  // Then: root identity blocks handoff; stale root cleanup never touches replacement data.
  expect(result).toEqual({ kind: "rejected", code: "cleanup-failed" });
  expect(await readFile(copied)).toEqual(reportBytes);
  expect(
    await readFile(join(dirname(dirname(copied)), "unrelated.txt"), "utf8"),
  ).toBe("replacement data");
  expect(await readdir(archive)).toEqual([]);
});
