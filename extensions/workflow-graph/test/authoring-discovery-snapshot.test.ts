import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProgramCatalog,
  workflowDescriptorDigest,
} from "../src/authoring/discovery.ts";

const programSource = (result: number) =>
  `{key:"entry",version:1,input:{type:"object"},decide:()=>({kind:"final",result:${result}})}`;

test.each(["ts", "mts", "cts", "js", "mjs", "cjs"])(
  "binds descriptor to executed bytes when %s entry swaps its pathname during import",
  async (extension) => {
    // Given: original entry replaces itself atomically before exporting old behavior.
    const cwd = await realpath(
      await mkdtemp(join(tmpdir(), "workflow-descriptor-swap-")),
    );
    try {
      const entry = join(cwd, `entry.${extension}`);
      const replacement = join(cwd, "replacement");
      const exportProgram =
        extension === "cjs" ? "exports.program=" : "export const program=";
      const updated = `${exportProgram}${programSource(2)};`;
      const original = [
        extension === "cjs"
          ? 'const {renameSync}=require("node:fs");'
          : 'import {renameSync} from "node:fs";',
        `renameSync(${JSON.stringify(replacement)},${JSON.stringify(entry)});`,
        `${exportProgram}${programSource(1)};`,
      ].join("\n");
      await writeFile(entry, original);
      await writeFile(replacement, updated);
      const catalog = createProgramCatalog({
        cwd,
        agentDir: cwd,
        settingsProject: [entry],
        bundled: () => [],
      });

      // When: real loader executes entry while discovery assembles its snapshot.
      await catalog.reload({ isProjectTrusted: () => true });

      // Then: old behavior has old bytes' identity, never replacement's digest.
      const snapshot = catalog.snapshot();
      expect(snapshot.diagnostics).toEqual([]);
      expect(
        snapshot.programs
          .get("entry")
          ?.decide({ inputs: {}, results: {}, answers: {} }),
      ).toEqual({ kind: "final", result: 1 });
      expect(snapshot.descriptors[0]?.digest).toBe(
        workflowDescriptorDigest("authored", entry, original),
      );
      expect(snapshot.descriptors[0]?.digest).not.toBe(
        workflowDescriptorDigest("authored", entry, updated),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test("executes captured CommonJS bytes when native require cached older behavior", async () => {
  // Given: native cache holds old code at same canonical path as new source bytes.
  const cwd = await realpath(
    await mkdtemp(join(tmpdir(), "workflow-descriptor-cjs-cache-")),
  );
  const entry = join(cwd, "entry.cjs");
  const nativeRequire = createRequire(import.meta.url);
  try {
    await writeFile(entry, `exports.program=${programSource(1)};`);
    nativeRequire(entry);
    const updated = `exports.program=${programSource(2)};`;
    await writeFile(entry, updated);
    const catalog = createProgramCatalog({
      cwd,
      agentDir: cwd,
      settingsProject: [entry],
      bundled: () => [],
    });

    // When: catalog reloads without reusing native entry cache.
    await catalog.reload({ isProjectTrusted: () => true });

    // Then: execution matches freshly captured descriptor bytes.
    const snapshot = catalog.snapshot();
    expect(snapshot.diagnostics).toEqual([]);
    expect(
      snapshot.programs
        .get("entry")
        ?.decide({ inputs: {}, results: {}, answers: {} }),
    ).toEqual({ kind: "final", result: 2 });
    expect(snapshot.descriptors[0]?.digest).toBe(
      workflowDescriptorDigest("authored", entry, updated),
    );
  } finally {
    delete nativeRequire.cache[entry];
    await rm(cwd, { recursive: true, force: true });
  }
});
