import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { verifyTerminalTransfer } from "../src/authoring/transfer.ts";
import {
  reportBytes,
  sha256,
  transferFixture,
} from "./authoring-transfer-fixture.ts";

for (const restored of [false, true]) {
  test(`copies exact bytes into fresh root when completed source is ${restored ? "restored" : "current"}`, async () => {
    // Given: real host/controller has admitted a completed staged source.
    await using f = await transferFixture();
    if (restored) await f.restore();
    // When: terminal manifest crosses transfer boundary.
    const result = await verifyTerminalTransfer(f.options, f.manifest);
    // Then: destination receives only copied paths, exact bytes, hash, size, schema.
    assert(result.kind === "verified");
    assert(result.artifactRoot !== f.artifactRoot);
    const copied = join(result.artifactRoot, "input/report.json");
    expect(result.inputs).toEqual({ inputPath: copied });
    expect(await readFile(copied)).toEqual(reportBytes);
    expect(result.manifest.artifacts).toEqual([
      { ...f.manifest.artifacts[0], canonicalPath: "input/report.json" },
    ]);
    expect(sha256(await readFile(copied))).toBe(
      f.manifest.artifacts[0]?.sha256,
    );
    expect(JSON.stringify(result)).not.toContain(f.artifactRoot);
    expect(
      f.actions.filter((action) => action === "start" || action === "amend"),
    ).toEqual(["start"]);
  });
}

for (const status of ["running", "failed", "cancelled", "queued"]) {
  test(`rejects transfer when native source is ${status}`, async () => {
    // Given: final staged decision alone is insufficient native authority.
    await using f = await transferFixture();
    f.state.reply = (reply) => ({
      ...reply,
      snapshot: { ...reply.snapshot, status },
    });
    // When: transfer snapshots source.
    const result = await verifyTerminalTransfer(f.options, f.manifest);
    // Then: no destination exists or starts.
    expect(result).toEqual({ kind: "rejected", code: "source-not-completed" });
    await f.assertSourceOnly();
  });
}

for (const field of ["run_id", "runId", "runKey", "definitionFingerprint"]) {
  test(`rejects transfer when snapshot ${field} differs`, async () => {
    // Given: native authority disagrees with recorded exact identity.
    await using f = await transferFixture();
    f.state.reply = (reply) =>
      field === "run_id"
        ? { ...reply, run_id: "foreign" }
        : { ...reply, snapshot: { ...reply.snapshot, [field]: "foreign" } };
    // When: transfer validates snapshot.
    const result = await verifyTerminalTransfer(f.options, f.manifest);
    // Then: bounded rejection, never destination dispatch.
    expect(result).toEqual({ kind: "rejected", code: "source-identity" });
    await f.assertSourceOnly();
  });
}

for (const mode of [
  "stopped",
  "gate",
  "cancelled",
  "historical",
  "no-checkpoint",
  "forged-final",
] as const) {
  test(`rejects transfer when staged source is ${mode}`, async () => {
    // Given: source must be current/restored and fully admitted, not a historical entry.
    await using f = await transferFixture(mode === "gate");
    switch (mode) {
      case "stopped":
        f.stop();
        break;
      case "gate":
        break;
      case "cancelled":
        await f.cancel();
        break;
      case "historical":
        f.manifest.source.runId = "other-run";
        break;
      case "no-checkpoint":
        f.entries.splice(1);
        break;
      case "forged-final": {
        const checkpoint = f.entries.at(-1)?.data;
        assert(typeof checkpoint === "object" && checkpoint !== null);
        Reflect.set(checkpoint, "activeWave", "work");
        break;
      }
      default:
        mode satisfies never;
    }
    // When: source is requested.
    const result = await verifyTerminalTransfer(f.options, f.manifest);
    // Then: staged/native provenance rejects before allocating destination.
    expect(result.kind).toBe("rejected");
    await f.assertSourceOnly();
  });
}

const invalidManifests = [
  ["schema version", { schemaVersion: 2 }],
  ["unexpected property", { secret: "private" }],
  ["missing artifacts", { artifacts: [] }],
  [
    "undeclared mapping",
    { mappings: [{ source: "/report", destination: "/other" }] },
  ],
  [
    "missing pointer",
    { mappings: [{ source: "/missing", destination: "/inputPath" }] },
  ],
] as const;
for (const [label, patch] of invalidManifests) {
  test(`rejects transfer when manifest has ${label}`, async () => {
    // Given: malformed or undeclared transfer input.
    await using f = await transferFixture();
    // When: request crosses versioned schema boundary.
    const result = await verifyTerminalTransfer(f.options, {
      ...f.manifest,
      ...patch,
    });
    // Then: invalid input is bounded and source-only.
    assert(result.kind === "rejected");
    expect(Object.keys(result).sort()).toEqual(["code", "kind"]);
    await f.assertSourceOnly();
  });
}

for (const [label, patch] of [
  ["hash", { sha256: "0".repeat(64) }],
  ["size", { size: 999 }],
  ["schema", { schemaId: "unknown" }],
  ["undeclared source", { canonicalPath: "extra.json" }],
  ["escape", { canonicalPath: "../report.json" }],
  ["absolute source", { canonicalPath: "/tmp/private.json" }],
  ["destination escape", { destination: "../report.json" }],
  ["undeclared destination", { destination: "other.json" }],
  ["absolute destination", { destination: "/tmp/private.json" }],
  ["invalid hash", { sha256: "garbage" }],
  ["negative size", { size: -1 }],
] as const) {
  test(`rejects transfer when artifact has ${label}`, async () => {
    // Given: one invalid declared artifact field.
    await using f = await transferFixture();
    // When: artifact request is verified.
    const result = await verifyTerminalTransfer(f.options, {
      ...f.manifest,
      artifacts: [{ ...f.manifest.artifacts[0], ...patch }],
    });
    // Then: rejection never exposes artifact paths or full errors.
    assert(result.kind === "rejected");
    expect(Object.keys(result).sort()).toEqual(["code", "kind"]);
    expect(JSON.stringify(result)).not.toContain("private");
    await f.assertSourceOnly();
  });
}

for (const mode of [
  "file-symlink",
  "root-symlink",
  "parent-symlink",
  "directory",
  "missing",
  "schema-json",
  "schema-value",
] as const) {
  test(`rejects artifact when filesystem contains ${mode}`, async () => {
    // Given: manifest still names original approved bytes and schema.
    await using f = await transferFixture();
    switch (mode) {
      case "file-symlink":
        await rename(f.sourceFile, join(f.cwd, "outside.json"));
        await symlink(join(f.cwd, "outside.json"), f.sourceFile);
        break;
      case "root-symlink":
        await rename(f.artifactRoot, join(f.cwd, "outside"));
        await symlink(join(f.cwd, "outside"), f.artifactRoot);
        break;
      case "parent-symlink": {
        const parent = join(f.cwd, ".omo", "workflow-artifacts");
        await rename(parent, join(f.cwd, "outside"));
        await symlink(join(f.cwd, "outside"), parent);
        break;
      }
      case "directory":
        await rm(f.sourceFile);
        await mkdir(f.sourceFile);
        break;
      case "missing":
        await rm(f.sourceFile);
        break;
      case "schema-json":
      case "schema-value": {
        const bytes = Buffer.from(
          mode === "schema-json" ? "not-json" : '{"ok":false}',
        );
        await writeFile(f.sourceFile, bytes);
        Object.assign(f.manifest.artifacts[0] ?? {}, {
          sha256: sha256(bytes),
          size: bytes.length,
        });
        break;
      }
      default:
        mode satisfies never;
    }
    // When: real filesystem is verified.
    const result = await verifyTerminalTransfer(f.options, f.manifest);
    // Then: source remains only launched run; owned destination is removed.
    assert(result.kind === "rejected");
    expect(Object.keys(result).sort()).toEqual(["code", "kind"]);
    await f.assertSourceOnly();
  });
}

for (const mode of [
  "post-stat-replacement",
  "post-copy-source",
  "post-copy-destination",
  "destination-drift",
  "session-switch",
] as const) {
  test(`rejects transfer when ${mode} occurs at exact boundary`, async () => {
    // Given: explicit checkpoint hook mutates real filesystem/state, not mocked verification.
    await using f = await transferFixture();
    let triggered = false;
    const observe = async (event: {
      readonly phase: "source-opened" | "copied";
      readonly path: string;
    }) => {
      if (
        triggered ||
        event.phase !==
          (mode === "post-stat-replacement" ? "source-opened" : "copied")
      )
        return;
      triggered = true;
      switch (mode) {
        case "post-stat-replacement":
          await rename(f.sourceFile, `${f.sourceFile}.old`);
          await writeFile(f.sourceFile, "replacement");
          break;
        case "post-copy-source":
          await writeFile(f.sourceFile, "mutation");
          break;
        case "post-copy-destination":
          await writeFile(event.path, "mutation");
          break;
        case "destination-drift":
          f.state.destination = { ...f.manifest.destination, revision: 2 };
          break;
        case "session-switch":
          f.stop();
          break;
        default:
          mode satisfies never;
      }
    };
    // When: transfer crosses selected async boundary.
    const result = await verifyTerminalTransfer(
      { ...f.options, observe },
      f.manifest,
    );
    // Then: race deterministically rejects with cleanup and no destination start.
    expect(triggered).toBe(true);
    expect(result).toEqual({
      kind: "rejected",
      code:
        mode === "destination-drift"
          ? "destination-identity"
          : mode === "session-switch"
            ? "source-unavailable"
            : "artifact-changed",
    });
    await f.assertSourceOnly();
  });
}

test("rejects transfer when destination bytes mutate during final snapshot", async () => {
  // Given: final native recheck must not leave previously hashed bytes unchecked.
  await using f = await transferFixture();
  let copied = "";
  const native = {
    execute: async (params: Parameters<typeof f.options.native.execute>[0]) => {
      if (copied !== "") await writeFile(copied, "late mutation");
      return f.options.native.execute(params);
    },
  };
  // When: source snapshot yields after copy validation.
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
  // Then: final copied-byte digest still gates handoff.
  expect(result).toEqual({ kind: "rejected", code: "artifact-changed" });
  await f.assertSourceOnly();
});

test("rejects transfer when destination schema rejects mapped copied path", async () => {
  // Given: shared composition mapping must validate full destination input.
  await using f = await transferFixture();
  const destination = () => ({
    selection: f.manifest.destination,
    input: { type: "object", required: ["missing"] },
  });
  // When: copied paths reach destination schema.
  const result = await verifyTerminalTransfer(
    { ...f.options, destination },
    f.manifest,
  );
  // Then: mapping rejection removes prepared root.
  expect(result).toEqual({ kind: "rejected", code: "mapping-invalid" });
  await f.assertSourceOnly();
});

test("bounds native thrown payloads without leaking source paths", async () => {
  // Given: external transport may throw a non-Error payload containing private paths.
  await using f = await transferFixture();
  const native = { execute: () => Promise.reject(f.sourceFile) };
  // When: source snapshot fails at transport boundary.
  const result = await verifyTerminalTransfer(
    { ...f.options, native },
    f.manifest,
  );
  // Then: caller gets only bounded rejection, never thrown private payload.
  expect(result).toEqual({ kind: "rejected", code: "transfer-io" });
  await f.assertSourceOnly();
});

test("rejects transfer when destination selection is stale before copy", async () => {
  // Given: destination catalog no longer matches selected digest.
  await using f = await transferFixture();
  f.state.destination = { ...f.manifest.destination, digest: "stale" };
  // When: transfer prepares destination.
  const result = await verifyTerminalTransfer(f.options, f.manifest);
  // Then: no allocation or destination start.
  expect(result).toEqual({ kind: "rejected", code: "destination-identity" });
  await f.assertSourceOnly();
});
