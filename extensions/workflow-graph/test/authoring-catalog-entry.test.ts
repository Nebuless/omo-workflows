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
export async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-entry-"));
  const agentDir = join(cwd, "agent");
  const nativeSession = SessionManager.inMemory(cwd);
  const executes = new Map<
    string,
    (params: unknown, context: ExtensionContext) => Promise<unknown>
  >();
  const callbacks: unknown[] = [];
  const nativeDispatches: unknown[] = [];
  const store = createWorkflowGraphStore({ on: () => () => {} });
  const extension = registerStagedWorkflows(
    {
      cwd,
      registerTool(value) {
        executes.set(value.name, async (params, context) => {
          Value.Assert(value.parameters, params);
          return (
            await value.execute("qa", params, undefined, undefined, context)
          ).details;
        });
      },
      registerCommand() {},
      appendEntry(customType: string, data: unknown) {
        nativeSession.appendCustomEntry(customType, structuredClone(data));
      },
      getAllTools: () => [],
      getActiveTools: () => [],
      executeTool: async (_name, params) => {
        nativeDispatches.push(params);
        throw Error("Unexpected native dispatch");
      },
    },
    store,
    () => {},
    (recommendations) => callbacks.push(recommendations),
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
      const execute = executes.get("workflow_program");
      if (!execute) throw Error("Missing registered tool");
      return execute(params, ctx);
    },
    async recommend(params: unknown, ctx = context) {
      const execute = executes.get("workflow_recommend");
      if (!execute) throw Error("Missing recommendation tool");
      return execute(params, ctx);
    },
    tools: executes,
    callbacks,
    nativeDispatches,
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
    const replacement = next as {
      readonly revision: number;
      readonly descriptors: readonly {
        readonly key: string;
        readonly digest: string;
      }[];
    };
    const replacementDescriptor = replacement.descriptors.find(
      (item) => item.key === "replacement",
    );
    if (replacementDescriptor === undefined)
      throw Error("missing replacement descriptor");
    expect(
      await f.call({
        action: "start",
        selection: {
          key: replacementDescriptor.key,
          revision: replacement.revision,
          digest: replacementDescriptor.digest,
        },
        inputs: {},
      }),
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
