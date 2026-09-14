import {
  ExtensionRunner,
  ExtensionSelectorComponent,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  createExtensionRuntime,
  initTheme,
  type ExtensionAPI,
  type ExtensionUIContext,
} from "@code-yeongyu/senpi";
// Runtime exports this constructor only as a type; tests use its shipped implementation.
import { KeybindingsManager } from "../../../node_modules/@code-yeongyu/senpi/dist/core/keybindings.js";
import { TUI } from "../../../node_modules/@code-yeongyu/senpi/node_modules/@earendil-works/pi-tui/dist/index.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { registerStagedWorkflows } from "../src/authoring/index.ts";
import { LAUNCH_ENTRY_TYPE } from "../src/authoring/host.ts";
import { nativeDefinitionFingerprint } from "../src/execution/native-fingerprint.ts";
import {
  AuthoredWorkflowSchema,
  type AuthoredWorkflow,
} from "../src/execution/policy.ts";
import { createWorkflowGraphStore } from "../src/store.ts";

export const first = { key: "b] [c", title: "A", result: "first" } as const;
export const second = { key: "c", title: "A [b]", result: "second" } as const;
export type FixtureProgram = {
  readonly key: string;
  readonly title: string;
  readonly result: string;
};

export async function commandFixture() {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-command-"));
  const agentDir = join(cwd, "agent");
  const session = SessionManager.inMemory(cwd);
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
    session,
    new ModelRegistry(modelRuntime),
  );
  const context = runner.createCommandContext();
  const commands = new Map<
    string,
    Parameters<ExtensionAPI["registerCommand"]>[1]
  >();
  const definitions = new Map<string, AuthoredWorkflow>();
  const starts: AuthoredWorkflow[] = [];
  const notices: { readonly message: string; readonly type?: string }[] = [];
  const store = createWorkflowGraphStore({ on: () => () => {} });
  let completed = false;
  const extension = registerStagedWorkflows(
    {
      cwd,
      registerTool() {},
      registerCommand(name, command) {
        commands.set(name, command);
      },
      appendEntry(type, data) {
        session.appendCustomEntry(type, structuredClone(data));
      },
      getAllTools: () => [
        {
          name: "workflow",
          parameters: Type.Object({ action: Type.String() }),
        },
      ],
      getActiveTools: () => ["workflow"],
      async executeTool(_name, params) {
        if (!Value.Check(Type.Object({ action: Type.String() }), params))
          throw Error("Invalid native action");
        if (params.action === "start") {
          if (
            !("definition" in params) ||
            !Value.Check(AuthoredWorkflowSchema, params.definition)
          )
            throw Error("Invalid definition");
          starts.push(params.definition);
          definitions.set("run-command", params.definition);
          return {
            content: [],
            details: { kind: "started", run_id: "run-command" },
          };
        }
        const definition = definitions.get("run-command");
        if (definition === undefined) throw Error("Missing native run");
        switch (params.action) {
          case "snapshot":
            return {
              content: [],
              details: {
                kind: "snapshot",
                run_id: "run-command",
                snapshot: {
                  runId: "run-command",
                  runKey: definition.key,
                  status: completed ? "completed" : "running",
                  definitionFingerprint:
                    nativeDefinitionFingerprint(definition),
                  nodes: definition.nodes.map(({ id }) => ({
                    id,
                    state: completed ? "completed" : "running",
                  })),
                },
              },
            };
          case "wait":
            return {
              content: [],
              details: {
                kind: "waited",
                run_id: "run-command",
                result: {
                  runId: "run-command",
                  status: "completed",
                  nodes: Object.fromEntries(
                    definition.nodes.map(({ id }) => [
                      id,
                      { state: "completed", output: '{"ok":true}' },
                    ]),
                  ),
                },
              },
            };
          case "cancel":
            return {
              content: [],
              details: { kind: "cancelled", run_id: "run-command" },
            };
          default:
            throw Error(`Unexpected native action: ${params.action}`);
        }
      },
    },
    store,
    () => {},
  );
  initTheme("dark", false);
  const tui = new TUI({
    columns: 100,
    rows: 36,
    kittyProtocolActive: false,
    start() {},
    stop() {},
    async drainInput() {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
  });
  const keys = new KeybindingsManager();
  // Mutable UI script drives real native selectors, not preselected return values.
  const script: {
    keys: string[];
    raw: string | undefined;
    beforeInput(): Promise<void>;
    frames: string[][];
    inputCalls: number;
    confirm: boolean;
    confirmCalls: number;
  } = {
    keys: ["\x1b[B", "\r"],
    raw: '{"prompt":"ok"}',
    beforeInput: async (): Promise<void> => {},
    frames: [],
    inputCalls: 0,
    confirm: false,
    confirmCalls: 0,
  };
  const ui: ExtensionUIContext = {
    ...context.ui,
    select: async (title, options) =>
      new Promise<string | undefined>((resolve) => {
        const component = new ExtensionSelectorComponent(
          title,
          options,
          resolve,
          () => resolve(undefined),
        );
        script.frames.push(component.render(100));
        for (const key of script.keys) component.handleInput(key);
        component.dispose();
      }),
    custom: async (factory) =>
      new Promise((resolve, reject) => {
        void Promise.resolve(
          factory(tui, context.ui.theme, keys, resolve),
        ).then((component) => {
          script.frames.push(component.render(100));
          for (const key of script.keys) component.handleInput?.(key);
          component.dispose?.();
        }, reject);
      }),
    input: async () => {
      script.inputCalls += 1;
      await script.beforeInput();
      return script.raw;
    },
    confirm: async () => {
      script.confirmCalls += 1;
      return script.confirm;
    },
    notify: (message, type) => {
      notices.push({ message, type });
    },
  };
  const commandContext = {
    ...context,
    cwd,
    agentDir,
    ui,
    isProjectTrusted: () => true,
    sessionManager: {
      ...context.sessionManager,
      getBranch: () => session.getBranch(),
      isPersisted: () => true,
      flushEntries() {},
    },
  };
  const call = async (args: string) => {
    const command = commands.get("workflow-run");
    if (command === undefined)
      throw Error("Missing registered workflow-run command");
    await command.handler(args, commandContext);
  };
  const put = async (file: string, program: FixtureProgram) => {
    const path = join(cwd, ".omo/workflows", file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      path,
      `export const program={key:${JSON.stringify(program.key)},version:1,
      metadata:{title:${JSON.stringify(program.title)}},
      input:{type:"object",properties:{prompt:{type:"string"}},required:["prompt"],additionalProperties:false},
      decide:({results})=>results.work?{kind:"final",result:${JSON.stringify(program.result)}}:
      {kind:"wave",id:"work",nodes:[{id:"work",prompt:"fixture",subagent_type:"omo-senpi",output:{schema:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"]}}}]}};`,
    );
  };
  return {
    cwd,
    call,
    put,
    script,
    notices,
    starts,
    extension,
    launches: () =>
      session
        .getBranch()
        .filter(
          (entry) =>
            entry.type === "custom" && entry.customType === LAUNCH_ENTRY_TYPE,
        ),
    async complete() {
      completed = true;
      await extension.host.settled("run-command");
    },
    async [Symbol.asyncDispose]() {
      extension.dispose();
      store.dispose();
      tui.stop();
      await rm(cwd, { recursive: true, force: true });
    },
  };
}
