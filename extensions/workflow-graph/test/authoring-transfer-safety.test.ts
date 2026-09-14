import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProgramHost, LAUNCH_ENTRY_TYPE } from "../src/authoring/host.ts";
import { STAGED_ENTRY_TYPE } from "../src/execution/controller.ts";
import {
  transferIntents,
  transferRejected,
} from "../src/authoring/transfer-launch.ts";
import { transferFixture, reportBytes } from "./authoring-transfer-fixture.ts";

const intentType = "omo-workflow-graph:transfer-intent";
const request = (f: Awaited<ReturnType<typeof transferFixture>>) => ({
  sourceRunId: "source-run",
  selection: f.manifest.destination,
  manifest: f.manifest,
  confirmed: true,
});
function copiedPath(data: unknown): string {
  assert(
    typeof data === "object" &&
      data !== null &&
      "artifactRoot" in data &&
      typeof data.artifactRoot === "string",
  );
  return join(data.artifactRoot, "input/report.json");
}

for (const disposed of [false, true])
  for (const mode of [
    "bytes",
    "same-bytes-replacement",
    "missing-identity",
    "cancel",
  ] as const) {
    test(`keeps attempt rejected on repeated restore when launch flush changes ${mode}${disposed ? " with disposal" : ""}`, async () => {
      // Given: mutation lands after durable launch, before destination dispatch.
      await using f = await transferFixture();
      f.durability.flush = async () => {
        const entry = f.entries.at(-1);
        if (entry?.customType !== LAUNCH_ENTRY_TYPE) return;
        switch (mode) {
          case "bytes":
            await writeFile(copiedPath(entry.data), "tampered");
            break;
          case "same-bytes-replacement":
            await rename(
              copiedPath(entry.data),
              `${copiedPath(entry.data)}.old`,
            );
            await writeFile(copiedPath(entry.data), reportBytes);
            break;
          case "missing-identity":
            f.state.destination = undefined;
            break;
          case "cancel":
            await f.host.cancel();
            break;
          default:
            mode satisfies never;
        }
        if (disposed) f.host.stop();
      };
      await f.host.transfer(f.context, request(f));
      f.durability.flush = async () => {};
      const restored = createProgramHost(f.runtime, f.registry, () => {});
      try {
        // When: same rejected attempt restores repeatedly, even after identity returns.
        f.state.destination = { ...f.manifest.destination };
        const outcomes = [
          await restored.restore(f.context, "destination"),
          await restored.restore(f.context, "destination"),
        ];
        // Then: rejection remains bound to attempt; no ordinary-launch fallback.
        expect(outcomes.map((result) => result?.kind)).toEqual([
          "rejected",
          "rejected",
        ]);
        expect(f.actions.filter((action) => action === "start")).toHaveLength(
          1,
        );
        const intent = transferIntents(f.entries).at(-1);
        assert(intent !== undefined);
        expect(transferRejected(f.entries, intent)).toBe(true);
      } finally {
        restored.stop();
      }
    });
  }

test("checks fresh attempt when same request retries after rejected copy", async () => {
  // Given: first attempt loses integrity while intent is flushed.
  await using f = await transferFixture();
  f.durability.flush = async () => {
    const entry = f.entries.at(-1);
    if (entry?.customType !== intentType) return;
    assert(
      typeof entry.data === "object" &&
        entry.data !== null &&
        "launch" in entry.data,
    );
    await writeFile(copiedPath(entry.data.launch), "tampered");
  };
  await f.host.transfer(f.context, request(f));
  f.durability.flush = async () => {
    const entry = f.entries.at(-1);
    if (entry?.customType === LAUNCH_ENTRY_TYPE)
      await writeFile(copiedPath(entry.data), "tampered again");
  };
  // When: retry uses same manifest, but a fresh copied allocation.
  const result = await f.host.transfer(f.context, request(f));
  // Then: previous rejection cannot remove retry's dispatch guard.
  expect(result.kind).toBe("rejected");
  expect(f.actions.filter((action) => action === "start")).toHaveLength(1);
});

for (const mode of ["cancel", "status", "generation"] as const) {
  test(`rejects source ${mode} change during intent flush`, async () => {
    // Given: exact flush callback changes source authority.
    await using f = await transferFixture();
    f.durability.flush = async () => {
      if (f.entries.at(-1)?.customType !== intentType) return;
      switch (mode) {
        case "cancel":
          await f.host.cancel();
          break;
        case "status": {
          const latest = f.entries
            .filter((entry) => entry.customType === STAGED_ENTRY_TYPE)
            .at(-1)?.data;
          assert(typeof latest === "object" && latest !== null);
          f.entries.push({
            customType: STAGED_ENTRY_TYPE,
            data: { ...latest, cancelled: true },
          });
          break;
        }
        case "generation":
          f.host.stop();
          break;
        default:
          mode satisfies never;
      }
    };
    // When: transfer returns from intent durability boundary.
    const result = await f.host.transfer(f.context, request(f));
    // Then: revoked source cannot authorize destination start.
    expect(result.kind).toBe("rejected");
    expect(f.actions.filter((action) => action === "start")).toHaveLength(1);
  });
}

test("rejects latest cancelled checkpoint instead of older admitted checkpoint", async () => {
  // Given: latest authoritative checkpoint is terminal but ineligible.
  await using f = await transferFixture();
  const latest = f.entries
    .filter((entry) => entry.customType === STAGED_ENTRY_TYPE)
    .at(-1)?.data;
  assert(typeof latest === "object" && latest !== null);
  f.entries.push({
    customType: STAGED_ENTRY_TYPE,
    data: { ...latest, cancelled: true, admittedWaves: [] },
  });
  // When: manifest requests source still reported final by host.
  const result = await f.host.transfer(f.context, request(f));
  // Then: no historical eligible-state fallback.
  expect(result.kind).toBe("rejected");
  await f.assertSourceOnly();
});

test("allows explicit transfer restore after automatic authored restore defers discovery", async () => {
  // Given: fresh runtime seeds builtins only until explicit resume loads authored catalog.
  await using f = await transferFixture();
  await f.host.transfer(f.context, request(f));
  let discovered = false;
  const restored = createProgramHost(
    f.runtime,
    {
      ...f.registry,
      identity: (key) => (discovered ? f.registry.identity(key) : undefined),
      get: (key, root) => (discovered ? f.registry.get(key, root) : undefined),
    },
    () => {},
  );
  try {
    await restored.restore(f.context);
    discovered = true;
    // When: same intent resumes after explicit discovery.
    const result = await restored.restore(f.context, "destination");
    // Then: deferred automatic load never tombstones valid transfer attempt.
    expect(result?.kind).toBe("active");
    expect(f.actions.filter((action) => action === "start")).toHaveLength(2);
  } finally {
    restored.stop();
  }
});

test("rejects destination restore when identity is unavailable", async () => {
  // Given: valid transfer exists, catalog entry disappears after restart.
  await using f = await transferFixture();
  await f.host.transfer(f.context, request(f));
  f.state.destination = undefined;
  const restored = createProgramHost(f.runtime, f.registry, () => {});
  try {
    // When: destination restores without current identity.
    const result = await restored.restore(f.context, "destination");
    // Then: restoration fails closed before any native dispatch.
    expect(result?.kind).toBe("rejected");
  } finally {
    restored.stop();
  }
});
