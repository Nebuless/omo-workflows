import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgramCatalog } from "../src/authoring/discovery.ts";

const source = (key: string) =>
  `export const program={key:${JSON.stringify(key)},version:1,input:{type:"object"},decide:()=>({kind:"final",result:${JSON.stringify(key)}})};`;

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
