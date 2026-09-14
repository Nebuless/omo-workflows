import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  createLiveBootstrapper,
  createLiveHelperTransport,
} from "../src/design-review/protocol.ts";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  createProgramHost,
  type DesignReviewEffectConfig,
} from "../src/authoring/host.ts";
import { openClaudeDesign } from "../src/builtins/open-claude-design.ts";
import { nativeDefinitionFingerprint } from "../src/execution/native-fingerprint.ts";
import {
  AuthoredWorkflowSchema,
  type AuthoredWorkflow,
  type StagedProgram,
} from "../src/execution/policy.ts";
const deferred = <T>() => Promise.withResolvers<T>();
const processDirs: string[] = [];
const NativeParamsSchema = Type.Union([
  Type.Object(
    { action: Type.Literal("start"), definition: AuthoredWorkflowSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("amend"),
      run_id: Type.String(),
      definition: AuthoredWorkflowSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("snapshot"), run_id: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("wait"),
      run_id: Type.String(),
      detach: Type.Literal(false),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("cancel"), run_id: Type.String() },
    { additionalProperties: false },
  ),
]);
type CheckedNativeParams = Static<typeof NativeParamsSchema>;
function checkedNativeParams(value: unknown): CheckedNativeParams {
  if (!Value.Check(NativeParamsSchema, value))
    throw new Error("invalid native params");
  return value;
}
afterEach(async () =>
  Promise.all(
    processDirs
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);
function fixture(events: Array<Record<string, unknown>>, failLive = false) {
  const entries: unknown[] = [];
  let definition: AuthoredWorkflow | undefined;
  let completed = false;
  const replies: string[] = [];
  const polled = deferred<void>();
  let crashOnReply: (() => void) | undefined;
  let dispatches = 0;
  const runtime = {
    appendEntry(customType: string, data: unknown) {
      if (
        customType === "omo-workflow-graph:design-review" &&
        data !== null &&
        typeof data === "object" &&
        "kind" in data &&
        data.kind === "reply" &&
        crashOnReply !== undefined
      ) {
        const crash = crashOnReply;
        crashOnReply = undefined;
        crash();
        return;
      }
      entries.push({ customType, data: structuredClone(data) });
    },
    getAllTools: () => [{ name: "workflow", parameters: NativeParamsSchema }],
    getActiveTools: () => ["workflow"],
    async executeTool(_name: string, value: unknown) {
      const params = checkedNativeParams(value);
      if (params.action === "start" || params.action === "amend") {
        definition = params.definition;
        dispatches += 1;
        return {
          content: [],
          details: {
            kind: params.action === "start" ? "started" : "amended",
            run_id: "run-1",
          },
        };
      }
      if (params.action === "cancel")
        return { content: [], details: { kind: "cancelled", run_id: "run-1" } };
      if (!definition) throw Error("missing definition");
      if (params.action === "snapshot")
        return {
          content: [],
          details: {
            kind: "snapshot",
            run_id: "run-1",
            snapshot: {
              runId: "run-1",
              runKey: definition.key,
              status: completed ? "completed" : "running",
              definitionFingerprint: nativeDefinitionFingerprint(definition),
              nodes: definition.nodes.map(({ id }) => ({
                id,
                state: completed ? "completed" : "running",
              })),
            },
          },
        };
      const failing =
        failLive &&
        definition.nodes.some(({ id }) => id.startsWith("live-model-"));
      return {
        content: [],
        details: {
          kind: "waited",
          run_id: "run-1",
          result: {
            runId: "run-1",
            status: failing ? "failed" : "completed",
            nodes: Object.fromEntries(
              definition.nodes.map(({ id }) => [
                id,
                {
                  state: failing ? "failed" : "completed",
                  output: id.startsWith("live-model-")
                    ? '{"message":"handled"}'
                    : '{"ok":true}',
                },
              ]),
            ),
          },
        },
      };
    },
  };
  const program: StagedProgram = {
    key: "open-claude-design",
    version: 1,
    input: Type.Object({}),
    decide: ({ results, external }) => {
      if (!results.initial)
        return {
          kind: "wave",
          id: "initial",
          nodes: [
            {
              id: "initial",
              prompt: "initial",
              subagent_type: "omo-senpi",
              output: { schema: Type.Object({ ok: Type.Boolean() }) },
            },
          ],
        };
      const keys = Object.keys(external ?? {}).filter(
        (key) => key !== "live.exit",
      );
      const index = keys.findIndex(
        (_key, offset) => results[`live-model-${offset + 1}`] === undefined,
      );
      if (index >= 0)
        return {
          kind: "wave",
          id: `live-model-${index + 1}`,
          nodes: [
            {
              id: `live-model-${index + 1}`,
              prompt: "live",
              subagent_type: "omo-senpi",
              output: {
                schema: Type.Object(
                  { message: Type.Optional(Type.String()) },
                  { additionalProperties: false },
                ),
              },
            },
          ],
        };
      if (external?.["live.exit"] === undefined)
        return {
          kind: "design-review",
          id: "live-review",
          previewPath: "/tmp/preview.html",
          maxModelEvents: 1,
        };
      return { kind: "final", result: "done" };
    },
  };
  const effect: DesignReviewEffectConfig = {
    async bootstrap() {
      return { ok: true as const, raw: {} };
    },
    async createTransport() {
      return {
        async poll(signal) {
          polled.resolve();
          if (signal?.aborted) throw new DOMException("aborted", "AbortError");
          const value = events.shift();
          if (!value)
            return new Promise((_resolve, reject) =>
              signal?.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              ),
            );
          return {
            type: String(value.type),
            ...(typeof value.id === "string" ? { id: value.id } : {}),
            raw: JSON.stringify(value),
          };
        },
        async reply(event) {
          replies.push(event.id ?? "");
        },
      };
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
  const registry = { list: () => ["open-claude-design"], get: () => program };
  const host = createProgramHost(runtime, registry, () => {}, {
    designReview: effect,
  });
  return {
    host,
    context,
    entries,
    replies,
    polled,
    runtime,
    registry,
    effect,
    complete() {
      completed = true;
    },
    dispatchCount: () => dispatches,
    crashOnNextReply(callback: () => void) {
      crashOnReply = callback;
    },
  };
}
test("live helper event becomes same-run native amendment and actual exit finishes", async () => {
  const f = fixture([{ type: "generate", id: "g" }, { type: "exit" }]);
  const first = await f.host.start(f.context, "open-claude-design", {});
  if (first.kind !== "active") throw Error("not active");
  f.complete();
  await f.host.settled(first.runId);
  await f.polled.promise;
  await f.host.whenIdle();
  expect(f.host.status()?.decision).toEqual({ kind: "final", result: "done" });
  expect(f.replies).toEqual(["g"]);
});
test("cancel aborts live poll and never records false exit", async () => {
  const f = fixture([]);
  const first = await f.host.start(f.context, "open-claude-design", {});
  if (first.kind !== "active") throw Error("not active");
  f.complete();
  await f.host.settled(first.runId);
  await f.polled.promise;
  expect(await f.host.cancel()).toMatchObject({
    kind: "rejected",
    reason: "cancelled",
  });
  await f.host.whenIdle();
  expect(JSON.stringify(f.entries)).not.toContain('"kind":"exit"');
});

test("real helper bootstrap and poll processes feed host native model stage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "design-review-host-"));
  processDirs.push(dir);
  const bootstrapPath = join(dir, "live.mjs");
  const pollPath = join(dir, "live-poll.mjs");
  await writeFile(
    bootstrapPath,
    "console.log(JSON.stringify({ok:true,target:process.argv[3]}));",
  );
  await writeFile(
    pollPath,
    'import{existsSync,readFileSync,writeFileSync}from"node:fs";if(process.argv[2]==="--reply"){}else{const n=existsSync("n")?Number(readFileSync("n","utf8"))+1:1;writeFileSync("n",String(n));console.log(JSON.stringify(n===1?{type:"generate",id:"real"}:{type:"exit"}));}',
  );
  const f = fixture([]);
  const bootstrap = await createLiveBootstrapper({
    script: bootstrapPath,
    cwd: dir,
  });
  const host = createProgramHost(f.runtime, f.registry, () => {}, {
    designReview: {
      bootstrap: ({ target, signal }) => bootstrap({ target, signal }),
      createTransport: () =>
        createLiveHelperTransport({ script: pollPath, cwd: dir }),
    },
  });
  const first = await host.start(f.context, "open-claude-design", {});
  if (first.kind !== "active") throw Error("not active");
  f.complete();
  await host.settled(first.runId);
  await host.whenIdle();
  expect(host.status()?.decision).toEqual({ kind: "final", result: "done" });
});

test("answer entering design review starts helper effect without human exit assertion", async () => {
  const f = fixture([{ type: "exit" }]);
  let approved = false;
  const gated: StagedProgram = {
    key: "open-claude-design",
    version: 1,
    input: Type.Object({}),
    decide: ({ answers, external }) =>
      !answers.approve
        ? { kind: "gate", id: "approve", question: "Review?", choices: ["yes"] }
        : external?.["live.exit"] === undefined
          ? {
              kind: "design-review",
              id: "live-review",
              previewPath: "/tmp/preview.html",
              maxModelEvents: 1,
            }
          : { kind: "final", result: "done" },
  };
  const host = createProgramHost(
    f.runtime,
    { list: () => ["open-claude-design"], get: () => gated },
    () => {},
    {
      designReview: {
        async bootstrap() {
          approved = true;
          return { ok: true, raw: {} };
        },
        createTransport: async () => ({
          poll: async () => ({ type: "exit", raw: '{"type":"exit"}' }),
          reply: async () => {},
        }),
      },
    },
  );
  expect((await host.start(f.context, "open-claude-design", {})).kind).toBe(
    "gate",
  );
  expect((await host.answer("approve", "yes")).kind).toBe("design-review");
  await host.whenIdle();
  expect(approved).toBe(true);
  expect(host.status()?.decision).toEqual({ kind: "final", result: "done" });
});

test("failed native live model admission rejects waiter and persists terminal failure", async () => {
  const f = fixture([{ type: "generate", id: "bad" }], true);
  const first = await f.host.start(f.context, "open-claude-design", {});
  if (first.kind !== "active") throw Error("not active");
  f.complete();
  await f.host.settled(first.runId);
  await f.host.whenIdle();
  expect(f.host.status()?.decision).toMatchObject({
    kind: "rejected",
    reason: "Native workflow settled failed.",
  });
  const restored = createProgramHost(f.runtime, f.registry, () => {}, {});
  expect(await restored.restore(f.context)).toMatchObject({
    kind: "rejected",
    reason: "Native workflow settled failed.",
  });
});

test("actual openClaudeDesign builtin reaches export through real helper processes and per-node artifacts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "open-design-builtin-"));
  processDirs.push(cwd);
  const entries: unknown[] = [];
  let definition: AuthoredWorkflow | undefined;
  const outputs = new Map<string, string>();
  const admitted = new Set<string>();
  const artifactRoot = () => {
    const launch = [...entries]
      .reverse()
      .find(
        (item: unknown): item is { data: { artifactRoot: string } } =>
          typeof item === "object" &&
          item !== null &&
          "customType" in item &&
          (item as { customType: unknown }).customType ===
            "omo-workflow-graph:staged-launch",
      )?.data;
    if (!launch) throw Error("missing launch");
    return join(launch.artifactRoot, "open-claude-design");
  };
  const admit = async (next: AuthoredWorkflow) => {
    const dir = artifactRoot();
    await mkdir(dir, { recursive: true });
    for (const { id } of next.nodes) {
      if (admitted.has(id)) continue;
      admitted.add(id);
      if (id === "intake")
        outputs.set(
          id,
          '{"brief":"ship ui","output_type":"page","references":[]}',
        );
      else if (id.startsWith("live-model-"))
        outputs.set(id, '{"message":"handled"}');
      else if (id === "product-context") {
        await writeFile(join(dir, "PRODUCT.md"), "# Product\n\nShip UI.\n");
        outputs.set(id, "native-returned-PRODUCT.md");
      } else if (id === "design-foundation") {
        await writeFile(
          join(dir, "DESIGN.md"),
          "# Design\n\nUse project evidence.\n",
        );
        outputs.set(id, "native-returned-DESIGN.md");
      } else if (id === "live-config") {
        const path = join(dir, ".impeccable/live/config.json");
        await mkdir(join(dir, ".impeccable/live"), { recursive: true });
        await writeFile(
          path,
          `${JSON.stringify({ files: ["preview.html"], insertBefore: "</body>", commentSyntax: "html", cspChecked: true }, null, 2)}\n`,
        );
        outputs.set(id, "native-returned-config.json");
      } else if (id === "final-display") {
        outputs.set(
          id,
          JSON.stringify({
            display_method: "playwright-cli open",
            availability: "unavailable",
            playwright_cli_status: "playwright-cli unavailable",
            spec_path: join(dir, "spec.html"),
            preview_path: join(dir, "preview.html"),
            manual_open_instructions: "open manually",
            next_action_hint: "rerun open-claude-design",
          }),
        );
      } else if (id === "exporter") {
        const path = join(dir, "spec.html");
        expect(await Bun.file(path).exists()).toBe(false);
        await writeFile(path, "<html><body>exported</body></html>");
        expect(await Bun.file(path).text()).toBe(
          "<html><body>exported</body></html>",
        );
        outputs.set(id, "native-returned-spec.html");
      } else {
        const name =
          id === "generate-1"
            ? "preview.html"
            : id === "reference-context"
              ? "references.md"
              : `${id}.md`;
        await writeFile(
          join(dir, name),
          id === "generate-1"
            ? "<html><body>preview</body></html>"
            : "artifact",
        );
        outputs.set(id, `native-returned-${name}`);
      }
    }
  };
  const runtime = {
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data: structuredClone(data) });
    },
    getAllTools: () => [{ name: "workflow", parameters: NativeParamsSchema }],
    getActiveTools: () => ["workflow"],
    async executeTool(_name: string, value: unknown) {
      const params = checkedNativeParams(value);
      if (params.action === "start" || params.action === "amend") {
        await admit(params.definition);
        definition = params.definition;
        return {
          content: [],
          details: {
            kind: params.action === "start" ? "started" : "amended",
            run_id: "run-real",
          },
        };
      }
      if (params.action === "cancel")
        return {
          content: [],
          details: { kind: "cancelled", run_id: "run-real" },
        };
      if (!definition) throw Error("missing definition");
      if (params.action === "snapshot")
        return {
          content: [],
          details: {
            kind: "snapshot",
            run_id: "run-real",
            snapshot: {
              runId: "run-real",
              runKey: definition.key,
              status: "completed",
              definitionFingerprint: nativeDefinitionFingerprint(definition),
              nodes: definition.nodes.map(({ id }) => ({
                id,
                state: "completed",
              })),
            },
          },
        };
      return {
        content: [],
        details: {
          kind: "waited",
          run_id: "run-real",
          result: {
            runId: "run-real",
            status: "completed",
            nodes: Object.fromEntries(
              definition.nodes.map(({ id }) => [
                id,
                { state: "completed", output: outputs.get(id) },
              ]),
            ),
          },
        },
      };
    },
  };
  const bootstrapPath = join(cwd, "live.mjs");
  const pollPath = join(cwd, "live-poll.mjs");
  await writeFile(
    bootstrapPath,
    `import{readFileSync,writeFileSync}from"node:fs";import{join,resolve}from"node:path";
const cwd=process.cwd(),target=resolve(process.argv[3]);
const product=readFileSync(join(cwd,"PRODUCT.md"),"utf8"),design=readFileSync(join(cwd,"DESIGN.md"),"utf8"),config=JSON.parse(readFileSync(join(cwd,".impeccable/live/config.json"),"utf8"));
if(!product||!design||config.files?.length!==1||config.files[0]!=="preview.html"||config.insertBefore!=="</body>"||config.commentSyntax!=="html"||config.cspChecked!==true||target!==join(cwd,"preview.html"))throw Error("invalid live prerequisites");
const preview=readFileSync(target,"utf8");if(!preview.includes("</body>"))throw Error("preview injection anchor missing");writeFileSync(target,preview.replace("</body>",'<script data-live-proof></script></body>'));console.log(JSON.stringify({ok:true,pageFiles:config.files,targetPath:target,hasProduct:true,hasDesign:true}));`,
  );
  await writeFile(
    pollPath,
    'import{existsSync,writeFileSync}from"node:fs";if(process.argv[2]!=="--reply"){const first=!existsSync("polled");writeFileSync("polled","1");console.log(JSON.stringify(first?{type:"generate",id:"g"}:{type:"exit"}));}',
  );
  const context = {
    cwd,
    isProjectTrusted: () => true,
    sessionManager: {
      getBranch: () => entries,
      isPersisted: () => true,
      flushEntries() {},
    },
  };
  const registry = {
    list: () => ["open-claude-design"],
    get: (_key: string, root: string) =>
      openClaudeDesign({ subagent_type: "omo-senpi" }, root || artifactRoot()),
  };
  const host = createProgramHost(runtime, registry, () => {}, {
    designReview: {
      bootstrap: async ({ cwd: reviewCwd, target, signal }) =>
        (
          await createLiveBootstrapper({
            script: bootstrapPath,
            cwd: reviewCwd,
          })
        )({
          target,
          signal,
        }),
      createTransport: ({ cwd: reviewCwd }) =>
        createLiveHelperTransport({ script: pollPath, cwd: reviewCwd }),
    },
  });
  const gate = await host.start(context, "open-claude-design", {
    prompt: "ship",
    discover_references: false,
  });
  expect(gate.kind).toBe("gate");
  const dir = artifactRoot();
  expect(await Bun.file(join(dir, "PRODUCT.md")).text()).toBe(
    "# Product\n\nShip UI.\n",
  );
  expect(await Bun.file(join(dir, "DESIGN.md")).text()).toBe(
    "# Design\n\nUse project evidence.\n",
  );
  expect(
    JSON.parse(
      await Bun.file(join(dir, ".impeccable/live/config.json")).text(),
    ),
  ).toEqual({
    files: ["preview.html"],
    insertBefore: "</body>",
    commentSyntax: "html",
    cspChecked: true,
  });
  expect(admitted.has("exporter")).toBe(false);
  expect(await Bun.file(join(dir, "spec.html")).exists()).toBe(false);
  expect(
    (await host.answer("approve-live-review", "Start live review")).kind,
  ).toBe("design-review");
  await host.whenIdle();
  const final = host.status()?.decision;
  expect(final?.kind).toBe("final");
  if (final?.kind !== "final") throw Error("missing final");
  const result = final.result as {
    spec_path: string;
    design_system: string;
    import_context: string;
    run_id: string;
    playwright_cli_status: string;
  };
  expect(await Bun.file(result.spec_path).text()).toBe(
    "<html><body>exported</body></html>",
  );
  expect(result.design_system).toBe(
    ["ds-locator.md", "ds-analyzer.md", "ds-patterns.md"]
      .map((name) => join(dir, name))
      .join(", "),
  );
  expect(await Bun.file(join(dir, "preview.html")).text()).toContain(
    "<script data-live-proof></script>",
  );
  expect(typeof result.import_context).toBe("string");
  expect(result.run_id).toBe(basename(dirname(dir)));
  expect(result.playwright_cli_status).toBe("playwright-cli unavailable");
  expect(admitted.has("final-display")).toBe(true);
  expect(admitted.size).toBe(outputs.size);
});

test("restart replays admitted model result at event ceiling without native dispatch", async () => {
  const f = fixture([{ type: "generate", id: "same" }, { type: "exit" }]);
  const crashed = deferred<void>();
  const first = await f.host.start(f.context, "open-claude-design", {});
  if (first.kind !== "active") throw Error("not active");
  f.complete();
  f.crashOnNextReply(() => {
    f.host.stop();
    crashed.resolve();
  });
  await f.host.settled(first.runId);
  await crashed.promise;
  expect(JSON.stringify(f.entries)).toContain('"kind":"event"');
  expect(JSON.stringify(f.entries)).not.toContain('"kind":"reply"');
  const dispatches = f.dispatchCount();
  expect(dispatches).toBe(2);
  const restored = createProgramHost(f.runtime, f.registry, () => {}, {
    designReview: f.effect,
  });
  expect((await restored.restore(f.context))?.kind).toBe("design-review");
  await restored.whenIdle();
  expect(f.dispatchCount()).toBe(dispatches);
  expect(f.replies).toEqual(["same"]);
  expect(restored.status()?.decision).toEqual({
    kind: "final",
    result: "done",
  });
});

test("missing helper configuration returns rejection instead of design-review", async () => {
  const f = fixture([{ type: "exit" }]);
  const host = createProgramHost(f.runtime, f.registry, () => {});
  const first = await host.start(f.context, "open-claude-design", {});
  if (first.kind !== "active") throw Error("not active");
  f.complete();
  await host.settled(first.runId);
  expect(host.status()?.decision).toMatchObject({
    kind: "rejected",
    reason: "Design review helper is not configured.",
  });
});
