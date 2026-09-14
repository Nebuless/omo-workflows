import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createProgramHost } from "../src/authoring/host.ts";
import {
  createNativeWorkflowTransport,
  type NativeDetails,
} from "../src/execution/native-transport.ts";
import { nativeDefinitionFingerprint } from "../src/execution/native-fingerprint.ts";
import {
  AuthoredWorkflowSchema,
  type AuthoredWorkflow,
  type StagedProgram,
} from "../src/execution/policy.ts";

export const reportBytes = Buffer.from('{"ok":true}\n');
export const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export const selection = {
  key: "destination",
  revision: 1,
  digest: `sha256:v1:${"d".repeat(64)}`,
};
type Snapshot = Extract<NativeDetails, { kind: "snapshot" }>;

export async function transferFixture(gate = false) {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-transfer-"));
  const entries: { readonly customType: string; readonly data: unknown }[] = [];
  const actions: string[] = [];
  // Mutable fake-native state permits exact boundary faults, never timing guesses.
  const state: {
    completed: boolean;
    reply: ((reply: Snapshot) => NativeDetails) | undefined;
    destination: typeof selection | undefined;
  } = { completed: false, reply: undefined, destination: { ...selection } };
  let definition: AuthoredWorkflow | undefined;
  const definitions = new Map<string, AuthoredWorkflow>();
  const destinationRoots: string[] = [];
  const durability = { flush: async (): Promise<void> => {} };
  let artifactRoot = "";
  const registry = {
    list: () => ["source", "destination"],
    identity: (key: string) =>
      key === "source"
        ? { revision: 1, digest: "source-descriptor" }
        : state.destination,
    get(key: string, root: string): StagedProgram {
      if (key === "destination") {
        if (root !== "") destinationRoots.push(root);
        return {
          key,
          version: 1,
          input: Type.Object(
            { inputPath: Type.String() },
            { additionalProperties: false },
          ),
          decide: ({ inputs, results }) =>
            results.work === undefined
              ? {
                  kind: "wave",
                  id: "work",
                  nodes: [
                    {
                      id: "read",
                      prompt: JSON.stringify(inputs),
                      subagent_type: "omo-senpi",
                      output: { schema: Type.Object({ ok: Type.Boolean() }) },
                    },
                  ],
                }
              : { kind: "final", result: inputs },
        };
      }
      artifactRoot = root;
      return {
        key: "source",
        version: 1,
        input: Type.Object({}),
        transferArtifacts: [
          {
            canonicalPath: "report.json",
            destination: "input/report.json",
            schemaId: "report-v1",
            schema: Type.Object(
              { ok: Type.Literal(true) },
              { additionalProperties: false },
            ),
            mapping: { source: "/report", destination: "/inputPath" },
          },
        ],
        decide: ({ results }) =>
          results.work === undefined
            ? {
                kind: "wave",
                id: "work",
                nodes: [
                  {
                    id: "report",
                    prompt: "fixture",
                    subagent_type: "omo-senpi",
                    output: {
                      file: { path: join(root, "report.json"), nonempty: true },
                    },
                  },
                ],
              }
            : gate
              ? {
                  kind: "gate",
                  id: "approval",
                  question: "Continue?",
                  choices: ["continue", "stop"],
                }
              : { kind: "final", result: { report: results.work.report } },
      };
    },
  };
  const runtime = {
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data: structuredClone(data) });
    },
    getAllTools: () => [
      { name: "workflow", parameters: Type.Object({ action: Type.String() }) },
    ],
    getActiveTools: () => ["workflow"],
    async executeTool(_name: string, params: unknown) {
      assert(Value.Check(Type.Object({ action: Type.String() }), params));
      actions.push(params.action);
      switch (params.action) {
        case "start": {
          assert(
            "definition" in params &&
              Value.Check(AuthoredWorkflowSchema, params.definition),
          );
          const source = params.definition.key.startsWith("source:");
          if (source) definition = params.definition;
          const runId = source
            ? "source-run"
            : `destination-${params.definition.key}`;
          definitions.set(runId, params.definition);
          return { content: [], details: { kind: "started", run_id: runId } };
        }
        case "snapshot": {
          assert("run_id" in params && typeof params.run_id === "string");
          const current = definitions.get(params.run_id);
          assert(current !== undefined);
          const completed = params.run_id === "source-run" && state.completed;
          const reply: Snapshot = {
            kind: "snapshot",
            run_id: params.run_id,
            snapshot: {
              runId: params.run_id,
              runKey: current.key,
              definitionFingerprint: nativeDefinitionFingerprint(current),
              status: completed ? "completed" : "running",
              nodes: current.nodes.map(({ id }) => ({
                id,
                state: completed ? "completed" : "running",
              })),
            },
          };
          return { content: [], details: state.reply?.(reply) ?? reply };
        }
        case "wait":
          return {
            content: [],
            details: {
              kind: "waited",
              run_id: "source-run",
              result: {
                runId: "source-run",
                status: "completed",
                nodes: { report: { state: "completed" } },
              },
            },
          };
        case "cancel":
          return {
            content: [],
            details: { kind: "cancelled", run_id: "source-run" },
          };
        default:
          throw new Error(`Unexpected action: ${params.action}`);
      }
    },
  };
  const context = {
    cwd,
    isProjectTrusted: () => true,
    sessionManager: {
      getBranch: () => entries,
      isPersisted: () => true,
      flushEntries: () => durability.flush(),
    },
  };
  let host = createProgramHost(runtime, registry, () => {});
  try {
    await host.start(
      context,
      { key: "source", revision: 1, digest: "source-descriptor" },
      {},
    );
    await mkdir(artifactRoot, { recursive: true });
    const sourceFile = join(artifactRoot, "report.json");
    await writeFile(sourceFile, reportBytes);
    state.completed = true;
    await host.settled("source-run");
    assert(definition !== undefined);
    const manifest = {
      schemaVersion: 1,
      source: {
        runId: "source-run",
        workflowKey: definition.key,
        definitionFingerprint: nativeDefinitionFingerprint(definition),
        terminal: true,
      },
      destination: { ...selection },
      artifacts: [
        {
          canonicalPath: "report.json",
          destination: "input/report.json",
          sha256: sha256(reportBytes),
          size: reportBytes.length,
          schemaId: "report-v1",
        },
      ],
      mappings: [{ source: "/report", destination: "/inputPath" }],
    };
    const options = {
      host: { status: () => host.status() },
      context,
      native: createNativeWorkflowTransport(runtime),
      destination: () =>
        state.destination === undefined
          ? undefined
          : {
              selection: state.destination,
              input: Type.Object(
                { inputPath: Type.String() },
                { additionalProperties: false },
              ),
            },
      artifacts: [
        {
          canonicalPath: "report.json",
          destination: "input/report.json",
          schemaId: "report-v1",
          schema: Type.Object(
            { ok: Type.Literal(true) },
            { additionalProperties: false },
          ),
          mapping: { source: "/report", destination: "/inputPath" },
        },
      ],
    };
    return {
      cwd,
      artifactRoot,
      sourceFile,
      entries,
      actions,
      state,
      manifest,
      options,
      runtime,
      registry,
      context,
      durability,
      destinationRoots,
      get host() {
        return host;
      },
      stop: () => host.stop(),
      cancel: () => host.cancel(),
      async restore() {
        host.stop();
        host = createProgramHost(runtime, registry, () => {});
        return host.restore(context, "source");
      },
      async assertSourceOnly() {
        assert.deepEqual(
          actions.filter((action) => action === "start" || action === "amend"),
          ["start"],
        );
        assert.deepEqual(
          await readdir(join(cwd, ".omo", "workflow-artifacts")),
          [artifactRoot.split("/").at(-1)],
        );
      },
      async [Symbol.asyncDispose]() {
        host.stop();
        await rm(cwd, { recursive: true, force: true });
      },
    };
  } catch (error) {
    host.stop();
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}
