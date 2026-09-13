import { expect, test } from "bun:test";
import {
  ExtensionRunner,
  createExtensionRuntime,
  SessionManager,
  ModelRuntime,
  ModelRegistry,
  type ExtensionContext,
} from "@code-yeongyu/senpi";
import { Value } from "typebox/value";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerStagedWorkflows } from "../src/authoring/index.ts";
import { createWorkflowGraphStore } from "../src/store.ts";

const source = (key: string, result: number = 1) =>
  "export const program={key:" +
  JSON.stringify(key) +
  ',version:1,input:{type:"object"},decide:()=>({kind:"final",result:' +
  result +
  "})};";
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-entry-"));
  const agentDir = join(cwd, "agent");
  const nativeSession = SessionManager.inMemory(cwd);
  let execute:
    | ((params: unknown, context: ExtensionContext) => Promise<unknown>)
    | undefined;
  const store = createWorkflowGraphStore({ on: () => () => {} });
  const extension = registerStagedWorkflows(
    {
      cwd,
      registerTool(value) {
        execute = async (params, context) => {
          if (!Value.Check(value.parameters, params))
            throw Error("Invalid tool parameters");
          return (
            await value.execute("qa", params, undefined, undefined, context)
          ).details;
        };
      },
      registerCommand() {},
      appendEntry(customType: string, data: unknown) {
        nativeSession.appendCustomEntry(customType, structuredClone(data));
      },
      getAllTools: () => [],
      getActiveTools: () => [],
      executeTool: async () => {
        throw Error("Unexpected native dispatch");
      },
    },
    store,
    () => {},
  );
  const modelRuntime = await ModelRuntime.create({
    agentDir,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const runtime = createExtensionRuntime();
  runtime.getThinkingLevel = () => "off";
  const runner = new ExtensionRunner(
    [],
    runtime,
    cwd,
    nativeSession,
    new ModelRegistry(modelRuntime),
  );
  const nativeContext = runner.createContext();
  const context = {
    ...nativeContext,
    cwd,
    agentDir,
    isProjectTrusted: () => true,
    sessionManager: {
      ...nativeContext.sessionManager,
      getBranch: () => nativeSession.getBranch(),
      isPersisted: () => true,
      flushEntries() {},
    },
  };
  const put = async (path: string, text: string) => {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, text);
  };
  return {
    cwd,
    agentDir,
    extension,
    context,
    put,
    settings: (data: unknown, global = false) =>
      put(
        global
          ? join(agentDir, "settings.json")
          : join(cwd, ".senpi", "settings.json"),
        JSON.stringify(data),
      ),
    async call(params: unknown, ctx = context) {
      if (!execute) throw Error("Missing registered tool");
      return execute(params, ctx);
    },
    async close() {
      extension.dispose();
      store.dispose();
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

test("registered catalog uses six ordered sources and live config reload", async () => {
  const f = await fixture();
  try {
    await f.put(join(f.cwd, "configured.ts"), source("shared"));
    await f.put(join(f.cwd, ".omo/workflows/local.ts"), source("local"));
    await f.put(join(f.agentDir, "configured.ts"), source("global-config"));
    await f.put(join(f.agentDir, "workflows/user.ts"), source("user"));
    await f.put(join(f.cwd, "package/workflow.ts"), source("package"));
    await f.settings({
      workflowGraph: {
        programs: {
          project: { custom: "configured.ts" },
          package: ["package"],
        },
      },
    });
    await f.settings(
      { workflowGraph: { programs: { global: ["configured.ts"] } } },
      true,
    );
    const first = await f.call({ action: "list" });
    expect(first).toMatchObject({
      programs: [
        "shared",
        "local",
        "global-config",
        "user",
        "package",
        "classify-and-act",
        "fan-out-and-synthesize",
        "adversarial-verification",
        "generate-and-filter",
        "tournament",
        "loop-until-done",
        "goal",
        "ralph",
        "open-claude-design",
        "repo-to-extension",
      ],
    });
    await f.put(join(f.cwd, "replacement.ts"), source("replacement", 2));
    await f.settings({
      workflowGraph: { programs: { project: ["replacement.ts"] } },
    });
    const next = await f.call({ action: "reload" });
    expect(next).toMatchObject({
      programs: expect.arrayContaining(["replacement", "local"]),
    });
    expect(next).not.toMatchObject({
      programs: expect.arrayContaining(["shared", "package"]),
    });
    expect(
      await f.call({ action: "start", key: "replacement", inputs: {} }),
    ).toEqual({ kind: "final", result: 2 });
    expect(await f.call({ action: "resume", key: "wrong-key" })).toMatchObject({
      kind: "rejected",
    });
    expect(await f.call({ action: "resume", key: "replacement" })).toEqual({
      kind: "final",
      result: 2,
    });
  } finally {
    await f.close();
  }
});

test("native configured installed package contributes manifest workflow resources", async () => {
  const f = await fixture();
  try {
    await f.put(
      join(f.cwd, "installed/package.json"),
      JSON.stringify({
        name: "qa-workflows",
        pi: { workflows: ["workflow.ts"] },
      }),
    );
    await f.put(
      join(f.cwd, "installed/workflow.ts"),
      source("installed-program", 7),
    );
    await f.settings({ packages: ["../installed"] });
    expect(await f.call({ action: "list" })).toMatchObject({
      programs: expect.arrayContaining(["installed-program"]),
      sources: expect.arrayContaining([
        expect.objectContaining({ key: "installed-program", kind: "package" }),
      ]),
    });
    expect(
      await f.call(
        { action: "list" },
        { ...f.context, isProjectTrusted: () => false },
      ),
    ).not.toMatchObject({
      programs: expect.arrayContaining(["installed-program"]),
    });
  } finally {
    await f.close();
  }
});

test("untrusted project cannot import configured package code", async () => {
  const f = await fixture();
  try {
    await f.put(join(f.cwd, "package.ts"), source("unsafe-package"));
    await f.settings({
      workflowGraph: { programs: { package: ["package.ts"] } },
    });
    const result = await f.call(
      { action: "list" },
      { ...f.context, isProjectTrusted: () => false },
    );
    expect(result).not.toMatchObject({
      programs: expect.arrayContaining(["unsafe-package"]),
    });
  } finally {
    await f.close();
  }
});

test("invalid native settings surface config diagnostics without losing builtins", async () => {
  const f = await fixture();
  try {
    await f.put(join(f.cwd, ".senpi/settings.json"), "{broken");
    expect(await f.call({ action: "list" })).toMatchObject({
      programs: expect.arrayContaining(["goal"]),
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "CONFIG_INVALID" }),
      ]),
    });
  } finally {
    await f.close();
  }
});

test("session stop fences catalog import before launch", async () => {
  const f = await fixture();
  try {
    await f.put(join(f.cwd, ".omo/workflows/local.ts"), source("local"));
    const pending = f.call({ action: "start", key: "local", inputs: {} });
    f.extension.host.stop();
    expect(await pending).toMatchObject({ kind: "rejected" });
    expect(f.extension.host.status()).toBeUndefined();
  } finally {
    await f.close();
  }
});
