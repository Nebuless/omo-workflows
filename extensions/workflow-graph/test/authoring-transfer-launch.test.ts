import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProgramHost, LAUNCH_ENTRY_TYPE } from "../src/authoring/host.ts";
import {
  recheckTransferInput,
  transferIntents,
  transferRejected,
} from "../src/authoring/transfer-launch.ts";
import { transferSourceJournal } from "../src/authoring/transfer-source.ts";
import { STAGED_ENTRY_TYPE } from "../src/execution/controller.ts";
import { transferFixture, reportBytes } from "./authoring-transfer-fixture.ts";

const intentType = "omo-workflow-graph:transfer-intent";
const rejectionType = "omo-workflow-graph:transfer-rejected";
const request = (f: Awaited<ReturnType<typeof transferFixture>>) => ({
  sourceRunId: "source-run",
  selection: f.manifest.destination,
  manifest: f.manifest,
  confirmed: true,
});

test("starts distinct destination with copied input when transfer intent is durable", async () => {
  // Given: terminal source and exact consent; flush receipt held at dedicated intent.
  await using f = await transferFixture();
  const source = structuredClone(f.host.status());
  const entries = structuredClone(f.entries);
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  f.durability.flush = async () => {
    if (f.entries.at(-1)?.customType === intentType) {
      entered.resolve();
      await release.promise;
    }
  };
  // When: transfer waits for native journal durability.
  const pending = f.host.transfer(f.context, request(f));
  await Promise.race([
    entered.promise,
    pending.then((result) => {
      throw Error(JSON.stringify(result));
    }),
  ]);
  expect(f.actions.filter((action) => action === "start")).toHaveLength(1);
  release.resolve();
  const result = await pending;
  // Then: one fresh native run/root; source journal never mutated or amended.
  assert(result.kind === "active");
  expect(result.runId).not.toBe(source?.runId);
  expect(f.host.status()?.instance).not.toBe(source?.instance);
  expect(f.entries.slice(0, entries.length)).toEqual(entries);
  expect(f.actions.filter((action) => action === "amend")).toEqual([]);
  expect(f.actions.filter((action) => action === "start")).toHaveLength(2);
  const launch = f.entries
    .filter((entry) => entry.customType === LAUNCH_ENTRY_TYPE)
    .at(-1)?.data;
  assert(
    typeof launch === "object" &&
      launch !== null &&
      "artifactRoot" in launch &&
      typeof launch.artifactRoot === "string",
  );
  expect(launch.artifactRoot).not.toBe(f.artifactRoot);
  expect(
    await readFile(join(launch.artifactRoot, "input/report.json")),
  ).toEqual(reportBytes);
  expect("inputs" in launch && launch.inputs).toEqual({
    inputPath: join(launch.artifactRoot, "input/report.json"),
  });
}, 10000);

for (const mode of [
  "false",
  "missing",
  "stale",
  "source",
  "manifest",
  "journal",
] as const) {
  test(`rejects with zero destination start when transfer has ${mode}`, async () => {
    // Given: one invalid boundary; existing source remains authoritative.
    await using f = await transferFixture();
    const before = structuredClone(f.host.status());
    const original = request(f);
    let input: unknown = original;
    switch (mode) {
      case "false":
        input = { ...original, confirmed: false };
        break;
      case "missing": {
        const { confirmed: _, ...rest } = original;
        input = rest;
        break;
      }
      case "stale":
        f.state.destination = { ...f.manifest.destination, revision: 2 };
        break;
      case "source":
        input = { ...original, sourceRunId: "foreign" };
        break;
      case "manifest":
        input = { ...original, manifest: { ...f.manifest, schemaVersion: 2 } };
        break;
      case "journal":
        f.durability.flush = async () => {
          throw Error("private disk failure");
        };
        break;
      default:
        mode satisfies never;
    }
    // When: host processes explicit transfer request.
    const result = await f.host.transfer(f.context, input);
    // Then: bounded rejection, unchanged source, zero destination starts or allocation for declined/invalid identity.
    expect(["rejected", "durability-unavailable"]).toContain(result.kind);
    expect(f.host.status()).toEqual(before);
    expect(f.actions.filter((action) => action === "start")).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private");
    if (mode !== "journal")
      expect(f.entries.at(-1)?.customType).toBe(rejectionType);
    if (
      mode === "false" ||
      mode === "missing" ||
      mode === "stale" ||
      mode === "source" ||
      mode === "manifest"
    )
      expect(
        await readdir(join(f.cwd, ".omo/workflow-artifacts")),
      ).toHaveLength(1);
  });
}

test("reuses destination when confirmed transfer request is replayed", async () => {
  // Given: acknowledged transfer already launched destination.
  await using f = await transferFixture();
  const original = request(f);
  const first = await f.host.transfer(f.context, original);
  // When: exact request is replayed.
  const replay = await f.host.transfer(f.context, original);
  // Then: no duplicate native start or root.
  expect(replay).toEqual(first);
  expect(f.actions.filter((action) => action === "start")).toHaveLength(2);
  expect(await readdir(join(f.cwd, ".omo/workflow-artifacts"))).toHaveLength(2);
});

test("restores destination once when durable transfer intent precedes interrupted launch", async () => {
  // Given: session ends after transfer intent acknowledgement before launch entry.
  await using f = await transferFixture();
  f.durability.flush = async () => {
    if (f.entries.at(-1)?.customType === intentType) f.host.stop();
  };
  await f.host.transfer(f.context, request(f));
  f.durability.flush = async () => {};
  const restored = createProgramHost(f.runtime, f.registry, () => {});
  // When: explicit destination restore consumes acknowledged transfer intent.
  const result = await restored.restore(f.context, "destination");
  // Then: one destination start; next restore reuses checkpoint.
  assert(result?.kind === "active");
  await restored.restore(f.context, "destination");
  expect(f.actions.filter((action) => action === "start")).toHaveLength(2);
  restored.stop();
});

for (const mode of [
  "transfer-launch",
  "restore-launch",
  "restore-dispatch",
] as const) {
  test(`restores acknowledged destination once when disposal interrupts ${mode} flush`, async () => {
    // Given: acknowledged transfer; disposal hits exact launch or restored dispatch flush.
    await using f = await transferFixture();
    const restored = createProgramHost(f.runtime, f.registry, () => {});
    try {
      if (mode !== "transfer-launch") {
        f.durability.flush = async () => {
          if (f.entries.at(-1)?.customType === intentType) f.host.stop();
        };
        await f.host.transfer(f.context, request(f));
      }
      f.durability.flush = async () => {
        if (
          f.entries.at(-1)?.customType ===
          (mode === "restore-dispatch" ? STAGED_ENTRY_TYPE : LAUNCH_ENTRY_TYPE)
        )
          (mode === "transfer-launch" ? f.host : restored).stop();
      };
      const interrupted =
        mode === "transfer-launch"
          ? await f.host.transfer(f.context, request(f))
          : await restored.restore(f.context, "destination");
      expect(interrupted?.kind).toBe("rejected");
      expect(f.actions.filter((action) => action === "start")).toHaveLength(1);
      expect(restored.status()).toBeUndefined();
      const intent = transferIntents(f.entries).at(-1);
      assert(intent !== undefined);
      await recheckTransferInput(intent);
      transferSourceJournal(f.context, intent.request.manifest);
      f.durability.flush = async () => {};
      // When: normal context explicitly restores the same durable attempt twice.
      const outcomes = [
        await restored.restore(f.context, "destination"),
        await restored.restore(f.context, "destination"),
      ];
      // Then: valid attempt stays recoverable; checkpoint prevents duplicate native starts.
      expect(outcomes.map((result) => result?.kind)).toEqual([
        "active",
        "active",
      ]);
      expect(transferRejected(f.entries, intent)).toBe(false);
      expect(restored.status()?.instance).toBe(intent.launch.instance);
      expect(f.actions.filter((action) => action === "start")).toHaveLength(2);
    } finally {
      restored.stop();
    }
  }, 10000);
}

for (const mode of ["digest", "copied-bytes", "flush-rejection"] as const) {
  test(`rejects before native start when ${mode} changes during transfer intent durability`, async () => {
    // Given: mutation occurs exactly while dedicated intent flush is in flight.
    await using f = await transferFixture();
    f.durability.flush = async () => {
      const entry = f.entries.at(-1);
      if (entry?.customType !== intentType) return;
      assert(
        typeof entry.data === "object" &&
          entry.data !== null &&
          "launch" in entry.data,
      );
      const launch = entry.data.launch;
      assert(
        typeof launch === "object" &&
          launch !== null &&
          "artifactRoot" in launch &&
          typeof launch.artifactRoot === "string",
      );
      switch (mode) {
        case "digest":
          f.state.destination = {
            ...f.manifest.destination,
            digest: `sha256:v1:${"a".repeat(64)}`,
          };
          break;
        case "copied-bytes":
          await writeFile(
            join(launch.artifactRoot, "input/report.json"),
            "mutation",
          );
          break;
        case "flush-rejection":
          throw Error("disk rejected intent");
        default:
          mode satisfies never;
      }
    };
    // When: acknowledged bytes/identity no longer match verified transfer.
    const result = await f.host.transfer(f.context, request(f));
    // Then: durable bounded rejection, no destination native start, source remains current.
    expect(["rejected", "durability-unavailable"]).toContain(result.kind);
    expect(f.actions.filter((action) => action === "start")).toHaveLength(1);
    expect(f.host.status()?.runId).toBe("source-run");
    if (mode === "flush-rejection")
      expect(
        await readdir(join(f.cwd, ".omo/workflow-artifacts")),
      ).toHaveLength(1);
  });
}
