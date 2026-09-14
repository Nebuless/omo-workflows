import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { createProgramCatalog } from "../src/authoring/discovery.ts";
import {
  createProgramHost,
  LAUNCH_ENTRY_TYPE,
  type ProgramRegistry,
} from "../src/authoring/host.ts";

function fixture(registry: ProgramRegistry) {
  const entries: unknown[] = [];
  const actions: unknown[] = [];
  const runtime = {
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data: structuredClone(data) });
    },
    getAllTools: () => [
      { name: "workflow", parameters: Type.Object({ action: Type.String() }) },
    ],
    getActiveTools: () => ["workflow"],
    async executeTool(_name: string, params: unknown) {
      actions.push(params);
      throw Error("Unexpected native dispatch");
    },
  };
  const context = {
    cwd: process.cwd(),
    isProjectTrusted: () => true,
    sessionManager: {
      getBranch: () => entries,
      isPersisted: () => true,
      flushEntries() {},
    },
  };
  return {
    entries,
    actions,
    context,
    runtime,
    host: createProgramHost(runtime, registry, () => {}),
  };
}

for (const mode of ["missing-descriptor", "missing-resolver"] as const) {
  test(`rejects explicit restore before importing code when ${mode}`, async () => {
    // Given: durable selection has no verifiable descriptor, but its key resolves to valid code.
    const cwd = await mkdtemp(join(tmpdir(), "workflow-restore-identity-"));
    const f = fixture({
      list: () => [],
      get: () => undefined,
      ...(mode === "missing-descriptor" ? { identity: () => undefined } : {}),
    });
    try {
      await writeFile(
        join(cwd, "program.ts"),
        'export const program={key:"replacement",version:1,input:{type:"object"},decide:()=>({kind:"final",result:42})};',
      );
      f.entries.push({
        customType: LAUNCH_ENTRY_TYPE,
        data: {
          key: "./program.ts",
          instance: "original",
          version: 1,
          inputs: {},
          artifactRoot: cwd,
          revision: 1,
          digest: "original-descriptor",
        },
      });
      // When: caller explicitly names recorded path after discovery lost its descriptor.
      const result = await f.host.restore(
        { ...f.context, cwd },
        "./program.ts",
      );
      // Then: path fallback cannot replace descriptor authority or append/dispatch anything.
      expect(result).toEqual({
        kind: "rejected",
        reason: "Workflow catalog changed; choose again.",
      });
      expect(f.host.status()).toBeUndefined();
      expect(f.entries).toHaveLength(1);
      expect(f.actions).toEqual([]);
    } finally {
      f.host.stop();
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

test("restores unchanged builtin before discovery when recorded revision is published", async () => {
  // Given: revision 1 launch journals a builtin whose factory uses per-launch artifact root.
  const cwd = await mkdtemp(join(tmpdir(), "workflow-builtin-restore-"));
  const options = {
    cwd,
    agentDir: cwd,
    bundled: (root: string) => [
      {
        key: "builtin",
        version: 1,
        input: Type.Object({}),
        decide: () => ({ kind: "final", result: root }) as const,
      },
    ],
  };
  const published = createProgramCatalog(options);
  const registry = (
    catalog: ReturnType<typeof createProgramCatalog>,
  ): ProgramRegistry => ({
    list: catalog.list,
    get: catalog.get,
    requiresExplicitResume: catalog.requiresExplicitResume,
    identity: (key) => {
      const snapshot = catalog.snapshot();
      const descriptor = snapshot.descriptors.find((item) => item.key === key);
      return descriptor === undefined
        ? undefined
        : { revision: snapshot.revision, digest: descriptor.digest };
    },
  });
  const f = fixture(registry(published));
  try {
    await published.reload(f.context);
    const descriptor = published.descriptors()[0];
    if (descriptor === undefined) throw Error("Missing builtin descriptor");
    const started = await f.host.start(
      { ...f.context, cwd },
      { key: descriptor.key, revision: 1, digest: descriptor.digest },
      {},
    );
    const instance = f.host.status()?.instance;
    if (instance === undefined) throw Error("Missing launch instance");
    expect(started).toEqual({
      kind: "final",
      result: join(
        cwd,
        ".omo",
        "workflow-artifacts",
        instance.replace(":", "-"),
      ),
    });
    f.host.stop();
    const seeded = createProgramCatalog(options);
    const restored = createProgramHost(f.runtime, registry(seeded), () => {});
    try {
      // When: automatic session-start restore uses builtin seed, before any catalog reload.
      const result = await restored.restore({ ...f.context, cwd });
      // Then: same builtin and launch root resume without journal duplication or native dispatch.
      expect(result).toEqual(started);
      expect(restored.status()?.instance).toBe(instance);
      expect(seeded.snapshot().revision).toBe(0);
      expect(f.entries).toHaveLength(1);
      expect(f.actions).toEqual([]);
    } finally {
      restored.stop();
    }
  } finally {
    f.host.stop();
    await rm(cwd, { recursive: true, force: true });
  }
});
