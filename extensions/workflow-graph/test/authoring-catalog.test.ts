import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProgramCatalog,
  normalizeWorkflowDescriptor,
  workflowDescriptorDigest,
} from "../src/authoring/discovery.ts";

test("catalog descriptors preserve winning source and exact list order", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-descriptor-precedence-"));
  try {
    await writeFile(
      join(cwd, "winner.ts"),
      `export const program={key:"same",version:2,metadata:{title:"Winner"},input:{},decide:()=>({kind:"final",result:1})}`,
    );
    const catalog = createProgramCatalog({
      cwd,
      agentDir: cwd,
      settingsProject: ["winner.ts"],
      bundled: () => [
        {
          key: "same",
          version: 1,
          input: {},
          decide: () => ({ kind: "final", result: 0 }),
        },
      ],
    });
    await catalog.reload({ isProjectTrusted: () => true });
    expect(catalog.descriptors().map((item) => item.key)).toEqual(
      catalog.list(),
    );
    expect(catalog.descriptors()[0]).toMatchObject({
      key: "same",
      version: 2,
      title: "Winner",
      source: "project",
    });
    expect(catalog.descriptors()[0]?.digest).toMatch(/^sha256:v1:/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("catalog descriptors reject untrusted project modules", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-descriptor-untrusted-"));
  try {
    await writeFile(
      join(cwd, "bad.ts"),
      'globalThis.__catalogMarker=true; export const program={key:"bad",version:1,input:{},decide:()=>({kind:"final",result:1})};',
    );
    const catalog = createProgramCatalog({
      cwd,
      agentDir: cwd,
      settingsProject: ["bad.ts"],
      bundled: () => [],
    });
    await catalog.reload({ isProjectTrusted: () => false });
    expect(catalog.descriptors()).toEqual([]);
    expect(
      (globalThis as Record<string, unknown>).__catalogMarker,
    ).toBeUndefined();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("descriptor fallback normalization is exact and bundled digest is stable", () => {
  expect(
    normalizeWorkflowDescriptor({ key: "demo", version: 2 }, "bundled"),
  ).toEqual({
    key: "demo",
    version: 2,
    title: "demo",
    description: "Workflow program demo.",
    intents: [],
    examples: [],
    inputSummary: "JSON object accepted by the program input schema.",
    source: "bundled",
    digest: workflowDescriptorDigest("bundled", "demo", "2"),
  });
});

const source = (key: string) =>
  `export const program={key:${JSON.stringify(key)},version:1,input:{type:"object"},decide:()=>({kind:"final",result:${JSON.stringify(key)}})};`;

test("catalog authored descriptor changes with entry bytes and canonical path", async () => {
  const root = await mkdtemp(join(tmpdir(), "workflow-descriptor-bytes-"));
  const other = await mkdtemp(join(tmpdir(), "workflow-descriptor-path-"));
  try {
    const entry = join(root, "entry.ts");
    await writeFile(entry, source("entry"));
    const catalog = createProgramCatalog({
      cwd: root,
      agentDir: root,
      settingsProject: ["entry.ts"],
      bundled: () => [],
    });
    await catalog.reload({ isProjectTrusted: () => true });
    const first = catalog.descriptors()[0]?.digest;
    expect(first).toMatch(/^sha256:v1:/);
    expect(catalog.get("entry", "/one")).toBeDefined();
    await writeFile(entry, `${source("entry")} `);
    await catalog.reload({ isProjectTrusted: () => true });
    expect(catalog.descriptors()[0]?.digest).not.toBe(first);
    await writeFile(join(other, "entry.ts"), source("entry"));
    const moved = createProgramCatalog({
      cwd: other,
      agentDir: other,
      settingsProject: ["entry.ts"],
      bundled: () => [],
    });
    await moved.reload({ isProjectTrusted: () => true });
    expect(moved.descriptors()[0]?.digest).not.toBe(first);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});

test("catalog honors source precedence, reports bad modules, and replaces changed files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-catalog-"));
  const agentDir = join(cwd, "agent");
  const project = join(cwd, ".omo", "workflows");
  const settings = join(cwd, "settings.ts");
  const global = join(agentDir, "global");
  let outside: string | undefined;
  try {
    await writeFile(join(cwd, "package.ts"), source("package"));
    await writeFile(settings, source("same"));
    await Bun.write(join(project, "local.ts"), source("same"));
    await Bun.write(
      join(agentDir, "workflows", "bad.ts"),
      "export const program={key:1}",
    );
    await Bun.write(join(global, "global.ts"), source("global"));
    const catalog = createProgramCatalog({
      cwd,
      agentDir,
      settingsProject: [settings],
      settingsGlobal: { configured: join(global, "global.ts") },
      package: [join(cwd, "package.ts")],
      bundled: () => [
        {
          key: "same",
          version: 1,
          input: {},
          decide: () => ({ kind: "final", result: "bundled" }),
        },
      ],
    });
    await catalog.reload({ isProjectTrusted: () => true });
    expect(catalog.list()).toEqual(["same", "global", "package"]);
    expect(catalog.descriptors().map((descriptor) => descriptor.key)).toEqual(
      catalog.list(),
    );
    expect(
      catalog.sources().find((item) => item.key === "global"),
    ).toMatchObject({ configuredName: "configured" });
    expect(catalog.sources()[0]).toMatchObject({
      kind: "settings-project",
      key: "same",
    });
    expect(
      catalog.diagnostics().some((item) => item.code === "INVALID_PROGRAM"),
    ).toBe(true);
    await writeFile(settings, source("changed"));
    await catalog.reload({ isProjectTrusted: () => true });
    expect(catalog.list()).toEqual(["changed", "same", "global", "package"]);
    await rm(settings);
    await catalog.reload({ isProjectTrusted: () => true });
    expect(catalog.list()).toEqual(["same", "global", "package"]);
    outside = await mkdtemp(join(tmpdir(), "workflow-outside-"));
    await writeFile(join(outside, "outside.ts"), source("outside"));
    await symlink(join(outside, "outside.ts"), join(project, "escape.ts"));
    await catalog.reload({ isProjectTrusted: () => true });
    expect(
      catalog.diagnostics().some((item) => item.code === "UNTRUSTED_PATH"),
    ).toBe(true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    if (outside !== undefined)
      await rm(outside, { recursive: true, force: true });
  }
});

test("catalog freezes every nested layer in initial and reloaded snapshots", async () => {
  const hostInput = { nested: { values: ["initial"] } };
  const hostDecide = () => ({ kind: "final", result: 1 }) as const;
  const hostProgram = {
    key: "builtin",
    version: 1,
    input: hostInput,
    decide: hostDecide,
  };
  const catalog = createProgramCatalog({
    cwd: "/tmp",
    agentDir: "/tmp",
    bundled: () => [hostProgram],
  });
  const assertFrozen = (snapshot: ReturnType<typeof catalog.snapshot>) => {
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.list)).toBe(true);
    expect(Object.isFrozen(snapshot.sources)).toBe(true);
    expect(Object.isFrozen(snapshot.sources[0])).toBe(true);
    expect(Object.isFrozen(snapshot.descriptors)).toBe(true);
    expect(Object.isFrozen(snapshot.descriptors[0])).toBe(true);
    expect(Object.isFrozen(snapshot.descriptors[0]?.intents)).toBe(true);
    expect(Object.isFrozen(snapshot.descriptors[0]?.examples)).toBe(true);
    expect(Object.isFrozen(snapshot.diagnostics)).toBe(true);
    const program = snapshot.programs.get("builtin");
    expect(program).toBeDefined();
    expect(Object.isFrozen(program)).toBe(true);
    assert(program !== undefined);
    expect(Object.isFrozen(program.input)).toBe(true);
    expect(Object.isFrozen((program.input as { nested: object }).nested)).toBe(
      true,
    );
    expect(
      Object.isFrozen(
        (program.input as { nested: { values: readonly string[] } }).nested
          .values,
      ),
    ).toBe(true);
  };
  assertFrozen(catalog.snapshot());
  expect(catalog.snapshot().programs.get("builtin")?.decide).toBe(hostDecide);
  hostInput.nested.values.push("host-mutable");
  expect(hostInput.nested.values).toEqual(["initial", "host-mutable"]);
  await catalog.reload({ isProjectTrusted: () => true });
  assertFrozen(catalog.snapshot());
});

test("catalog publishes immutable atomic snapshots with monotonic revisions", async () => {
  const catalog = createProgramCatalog({
    cwd: "/tmp",
    agentDir: "/tmp",
    bundled: () => [
      {
        key: "builtin",
        version: 1,
        input: {},
        decide: () => ({ kind: "final", result: 1 }),
      },
    ],
  });
  const initial = catalog.snapshot();
  expect(initial.revision).toBe(0);
  expect(Object.isFrozen(initial)).toBe(true);
  expect(Object.isFrozen(initial.sources[0])).toBe(true);
  expect(Object.isFrozen(initial.descriptors[0])).toBe(true);
  expect(Object.isFrozen(initial.descriptors[0]?.intents)).toBe(true);
  expect(Object.isFrozen(initial.descriptors[0]?.examples)).toBe(true);
  await catalog.reload({ isProjectTrusted: () => true });
  const next = catalog.snapshot();
  expect(next.revision).toBe(1);
  expect(next).not.toBe(initial);
  expect(next.list).toEqual(["builtin"]);
  expect(next.sources.map((source) => source.key)).toEqual([...next.list]);
  expect(next.descriptors.map((descriptor) => descriptor.key)).toEqual([
    ...next.list,
  ]);
  expect(catalog.snapshot()).toBe(next);
});

test("superseded catalog reload keeps prior snapshot atomic", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-catalog-superseded-"));
  try {
    await writeFile(join(cwd, "entry.ts"), source("entry"));
    const catalog = createProgramCatalog({
      cwd,
      agentDir: cwd,
      settingsProject: ["entry.ts"],
      bundled: () => [],
    });
    const first = catalog.snapshot();
    const pending = catalog.reload({ isProjectTrusted: () => true });
    expect(catalog.snapshot()).toBe(first);
    expect(catalog.snapshot().revision).toBe(0);
    await Promise.all([
      pending,
      catalog.reload({ isProjectTrusted: () => true }),
    ]);
    const complete = catalog.snapshot();
    expect(complete.revision).toBe(1);
    await catalog.reload({ isProjectTrusted: () => true });
    expect(catalog.snapshot().revision).toBe(2);
    expect(complete.list).toEqual(["entry"]);
    expect(complete.sources.map((item) => item.key)).toEqual(["entry"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("old snapshot program map stays isolated across replacement", async () => {
  const catalog = createProgramCatalog({
    cwd: "/tmp",
    agentDir: "/tmp",
    bundled: () => [
      {
        key: "old",
        version: 1,
        input: {},
        decide: () => ({ kind: "final", result: 1 }),
      },
    ],
  });
  const old = catalog.snapshot();
  await catalog.reload({ isProjectTrusted: () => true });
  expect(old.programs.has("old")).toBe(true);
  expect(old.programs.get("old")).toBeDefined();
});

test("bundled factories seed restore before discovery and keep launch paths distinct", () => {
  const catalog = createProgramCatalog({
    cwd: "/tmp",
    agentDir: "/tmp",
    bundled: (path) => [
      {
        key: "builtin",
        version: 1,
        input: {},
        decide: () => ({ kind: "final", result: path }),
      },
    ],
  });
  expect(catalog.list()).toEqual(["builtin"]);
  expect(catalog.requiresExplicitResume("builtin")).toBe(false);
  expect(
    catalog
      .get("builtin", "/first")
      ?.decide({ inputs: {}, results: {}, answers: {} }),
  ).toEqual({ kind: "final", result: "/first" });
  expect(
    catalog
      .get("builtin", "/second")
      ?.decide({ inputs: {}, results: {}, answers: {} }),
  ).toEqual({ kind: "final", result: "/second" });
});

test("reload preserves module URL and refreshes imported helper", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-import-"));
  try {
    await writeFile(join(cwd, "helper.ts"), "export const value=1;");
    await writeFile(
      join(cwd, "entry.ts"),
      'import {value} from "./helper.ts"; export const program={key:"entry",version:1,input:{},decide:()=>({kind:"final",result:{value,url:import.meta.url}})};',
    );
    const catalog = createProgramCatalog({
      cwd,
      agentDir: cwd,
      settingsProject: ["entry.ts"],
      bundled: () => [],
    });
    await catalog.reload({ isProjectTrusted: () => true });
    expect(
      catalog
        .get("entry", "")
        ?.decide({ inputs: {}, results: {}, answers: {} }),
    ).toMatchObject({
      result: {
        value: 1,
        url: new URL(`file://${join(cwd, "entry.ts")}`).href,
      },
    });
    await writeFile(join(cwd, "helper.ts"), "export const value=2;");
    await catalog.reload({ isProjectTrusted: () => true });
    expect(
      catalog
        .get("entry", "")
        ?.decide({ inputs: {}, results: {}, answers: {} }),
    ).toMatchObject({ result: { value: 2 } });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
