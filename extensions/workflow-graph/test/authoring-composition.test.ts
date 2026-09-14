import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProgramCatalog,
  loadAuthoredProgram,
} from "../src/authoring/discovery.ts";
import { createProgramHost, LAUNCH_ENTRY_TYPE } from "../src/authoring/host.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  AuthoredWorkflowSchema,
  type AuthoredWorkflow,
} from "../src/execution/policy.ts";
import { nativeDefinitionFingerprint } from "../src/execution/native-fingerprint.ts";

const identity = {
  stageSelections: [
    ["one", 1, "d1"],
    ["two", 1, "d2"],
  ],
  mappings: [[{ source: "/value", destination: "/input" }]],
  preapproved: false,
  planDigest: `sha256:v1:${"a".repeat(64)}`,
} as const;

for (const loader of ["catalog", "explicit"] as const) {
  test(`${loader} preserves composition checkpoint metadata when loading authored export`, async () => {
    // Given: authored module carries composition metadata.
    const cwd = await mkdtemp(join(tmpdir(), "workflow-composition-load-"));
    try {
      await writeFile(
        join(cwd, "program.ts"),
        `export const program={key:"chain",version:1,input:{type:"object"},compositionIdentity:${JSON.stringify(identity)},decide:()=>({kind:"final",result:7})};`,
      );
      const context = { cwd, isProjectTrusted: () => true };
      const catalog = createProgramCatalog({
        cwd,
        agentDir: cwd,
        settingsProject: ["program.ts"],
        bundled: () => [],
      });
      // When: normal authored loading publishes the program.
      if (loader === "catalog") await catalog.reload(context);
      const program =
        loader === "catalog"
          ? catalog.get("chain", "")
          : await loadAuthoredProgram("program.ts", context);
      // Then: metadata reaches host launch before any native dispatch.
      expect(program?.compositionIdentity).toEqual(identity);
      assert(program !== undefined);
      const entries: { readonly customType: string; readonly data: unknown }[] =
        [];
      const host = createProgramHost(
        {
          appendEntry: (customType, data) => {
            entries.push({ customType, data: structuredClone(data) });
          },
          getAllTools: () => [],
          getActiveTools: () => [],
          executeTool: async () => {
            throw new Error("Unexpected native dispatch");
          },
        },
        {
          list: () => ["chain"],
          get: () => program,
          identity: () => ({ revision: 1, digest: "entry" }),
        },
        () => {},
      );
      await host.start(
        {
          ...context,
          sessionManager: {
            getBranch: () => entries,
            isPersisted: () => true,
            flushEntries() {},
          },
        },
        { key: "chain", revision: 1, digest: "entry" },
        {},
      );
      expect(
        entries.find((entry) => entry.customType === LAUNCH_ENTRY_TYPE)?.data,
      ).toMatchObject({ compositionIdentity: identity });
      host.stop();
      // A launch-only journal must also retain authorization on explicit restore.
      const originalIdentity = program.compositionIdentity;
      assert(originalIdentity !== undefined);
      const changed = createProgramHost(
        {
          appendEntry: (customType, data) => {
            entries.push({ customType, data: structuredClone(data) });
          },
          getAllTools: () => [],
          getActiveTools: () => [],
          executeTool: async () => {
            throw new Error("Unexpected native dispatch");
          },
        },
        {
          list: () => ["chain"],
          get: () => ({
            ...program,
            compositionIdentity: {
              ...originalIdentity,
              preapproved: true,
            },
          }),
          identity: () => ({ revision: 1, digest: "entry" }),
        },
        () => {},
      );
      expect(
        await changed.restore(
          {
            ...context,
            sessionManager: {
              getBranch: () => entries,
              isPersisted: () => true,
              flushEntries() {},
            },
          },
          "chain",
        ),
      ).toEqual({ kind: "rejected", reason: "composition-identity-changed" });
      changed.stop();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test(`${loader} rejects malformed composition metadata rather than discarding it`, async () => {
    // Given: authored export has an incomplete composition identity.
    const cwd = await mkdtemp(join(tmpdir(), "workflow-composition-invalid-"));
    try {
      await writeFile(
        join(cwd, "program.ts"),
        'export const program={key:"chain",version:1,input:{},compositionIdentity:{preapproved:true},decide:()=>({kind:"final",result:7})};',
      );
      const context = { cwd, isProjectTrusted: () => true };
      // When: malformed export crosses the discovery boundary.
      switch (loader) {
        case "catalog": {
          const catalog = createProgramCatalog({
            cwd,
            agentDir: cwd,
            settingsProject: ["program.ts"],
            bundled: () => [],
          });
          await catalog.reload(context);
          // Then: invalid export is diagnosed, never published.
          expect(catalog.list()).toEqual([]);
          expect(catalog.diagnostics()).toMatchObject([
            { code: "INVALID_PROGRAM" },
          ]);
          break;
        }
        case "explicit":
          // Then: explicit loading fails instead of dropping identity.
          await expect(
            loadAuthoredProgram("program.ts", context),
          ).rejects.toThrow();
          break;
        default:
          loader satisfies never;
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

test.each([false, true])(
  "authored composed host preserves one launch on restore with missing artifact=%s",
  async (missing) => {
    // Given: a predeclared two-stage export discovered through the normal catalog.
    const cwd = await mkdtemp(join(tmpdir(), "workflow-composed-host-"));
    try {
      const composer = new URL("../src/execution/composed.ts", import.meta.url)
        .pathname;
      const artifact = join(cwd, "source.json");
      if (!missing) await writeFile(artifact, '{"value":"mapped"}');
      await writeFile(
        join(cwd, "program.ts"),
        `import {composeStagedPrograms} from ${JSON.stringify(composer)};
      const stages=["one","two"].map((key)=>({workflowKey:key,descriptorDigest:key,program:{key,version:1,
        input:{type:"object",properties:{input:{type:"string"}},required:["input"]},
        decide:({inputs,results})=>results.work?{kind:"final",result:results.work[key]}:{kind:"wave",id:"work",nodes:[{
          id:key,prompt:inputs.input,subagent_type:"omo-senpi",output:key==="one"?{file:{path:${JSON.stringify(artifact)},schema:{type:"object",properties:{value:{type:"string"}},required:["value"]}}}:{schema:{type:"object"}}}]}}}));
      export const program=composeStagedPrograms({key:"chain",version:1,stages,mappings:[[{source:"/value",destination:"/input"}]]});`,
      );
      const catalog = createProgramCatalog({
        cwd,
        agentDir: cwd,
        settingsProject: ["program.ts"],
        bundled: () => [],
      });
      await catalog.reload({ isProjectTrusted: () => true });
      const descriptor = catalog.descriptors()[0];
      assert(descriptor !== undefined);
      const entries: { readonly customType: string; readonly data: unknown }[] =
        [];
      const calls: {
        readonly action: string;
        readonly definition: AuthoredWorkflow;
      }[] = [];
      let definition: AuthoredWorkflow | undefined;
      const runtime = {
        appendEntry: (customType: string, data: unknown) => {
          entries.push({ customType, data: structuredClone(data) });
        },
        getAllTools: () => [
          {
            name: "workflow",
            parameters: Type.Object({ action: Type.String() }),
          },
        ],
        getActiveTools: () => ["workflow"],
        async executeTool(_name: string, params: unknown) {
          assert(Value.Check(Type.Object({ action: Type.String() }), params));
          switch (params.action) {
            case "start":
            case "amend": {
              assert(
                "definition" in params &&
                  Value.Check(AuthoredWorkflowSchema, params.definition),
              );
              definition = params.definition;
              calls.push({ action: params.action, definition });
              const launch = entries.find(
                (entry) => entry.customType === LAUNCH_ENTRY_TYPE,
              );
              expect(launch?.data).toMatchObject({
                compositionIdentity: catalog.get("chain", "")
                  ?.compositionIdentity,
              });
              return {
                content: [],
                details: {
                  kind: params.action === "start" ? "started" : "amended",
                  run_id: "run-1",
                },
              };
            }
            case "snapshot":
              assert(definition !== undefined);
              return {
                content: [],
                details: {
                  kind: "snapshot",
                  run_id: "run-1",
                  snapshot: {
                    runId: "run-1",
                    runKey: definition.key,
                    status: "completed",
                    nodes: [],
                    definitionFingerprint:
                      nativeDefinitionFingerprint(definition),
                  },
                },
              };
            case "wait":
              assert(definition !== undefined);
              return {
                content: [],
                details: {
                  kind: "waited",
                  run_id: "run-1",
                  result: {
                    runId: "run-1",
                    status: "completed",
                    nodes: Object.fromEntries(
                      definition.nodes.map((node) => [
                        node.id,
                        { state: "completed", output: '{"ok":true}' },
                      ]),
                    ),
                  },
                },
              };
            default:
              throw new Error(`Unexpected native action ${params.action}`);
          }
        },
      };
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
        ...catalog,
        identity: () => ({
          revision: catalog.snapshot().revision,
          digest: descriptor.digest,
        }),
      };
      const host = createProgramHost(runtime, registry, () => {});
      const first = await host.start(
        context,
        {
          key: "chain",
          revision: catalog.snapshot().revision,
          digest: descriptor.digest,
        },
        { input: "start" },
      );
      const instance = host.status()?.instance;
      host.stop();
      await catalog.reload({ isProjectTrusted: () => true });
      // Keep descriptor selection revision stable, as the public reload registry does.
      const restored = createProgramHost(
        runtime,
        {
          ...registry,
          identity: () => ({ revision: 1, digest: descriptor.digest }),
        },
        () => {},
      );
      // When: explicit authored resume reuses the checkpoint, then explicit continue admits destination.
      const resumed = await restored.restore(context, "chain");
      if (!missing) {
        assert(resumed?.kind === "gate");
        expect(await restored.answer(resumed.id, "continue")).toEqual({
          kind: "final",
          result: { ok: true },
        });
      }
      // Then: one launch/checkpoint identity; missing artifact stays source-only and rejected.
      expect(first.kind).toBe(missing ? "rejected" : "gate");
      expect(restored.status()?.instance).toBe(instance);
      expect(calls.map((call) => call.action)).toEqual(
        missing ? ["start"] : ["start", "amend"],
      );
      expect(new Set(calls.map((call) => call.definition.key)).size).toBe(1);
      expect(
        entries.filter((entry) => entry.customType === LAUNCH_ENTRY_TYPE),
      ).toHaveLength(1);
      if (missing) expect(resumed).toEqual(first);
      else expect(calls.at(-1)?.definition.nodes.at(-1)?.prompt).toBe("mapped");
      restored.stop();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);
