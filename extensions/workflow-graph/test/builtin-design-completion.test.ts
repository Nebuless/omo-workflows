import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openClaudeDesign } from "../src/builtins/open-claude-design.ts";
import {
  createStagedController,
  type NativeWorkflowTransport,
} from "../src/execution/index.ts";
import { nativeDefinitionFingerprint } from "../src/execution/native-fingerprint.ts";
import type { AuthoredWorkflow, ProgramNode } from "../src/execution/policy.ts";

test("open-claude-design rejects forged final display paths and preserves native capacity", () => {
  const root = "/tmp/design-completion-red";
  const program = openClaudeDesign({ category: "general" }, root);
  const state = {
    inputs: { prompt: "ship", discover_references: false },
    answers: {
      "approve-live-review": "Skip remaining review rounds and export as-is",
    },
    results: {
      intake: {
        intake: { brief: "ship", output_type: "page", references: [] },
      },
      "product-context": { "product-context": "product" },
      "design-foundation": { "design-foundation": "design" },
      "live-config": { "live-config": "config" },
      "design-context": { "ds-locator": "locator" },
      "reference-context": { "reference-context": "references" },
      generate: { "generate-1": "preview" },
      export: { exporter: "spec" },
      "final-display": {
        "final-display": {
          display_method: "playwright-cli open",
          availability: "opened",
          playwright_cli_status: "exit 0",
          spec_path: "/forged/spec.html",
          preview_path: "/forged/preview.html",
          manual_open_instructions: "open manually",
          next_action_hint: "rerun",
        },
      },
    },
  };
  expect(program.decide(state)).toMatchObject({
    kind: "wave",
    id: "final-display",
  });
  for (const invalid of [
    {},
    [],
    { ...state.results["final-display"]["final-display"], spec_path: 1 },
  ])
    expect(
      program.decide({
        ...state,
        results: {
          ...state.results,
          "final-display": { "final-display": invalid },
        },
      }),
    ).toMatchObject({ kind: "wave", id: "final-display" });
  const live = program.decide({
    ...state,
    answers: { "approve-live-review": "Start live review" },
    results: { ...state.results, "final-display": {} },
    external: {},
  });
  expect(live).toMatchObject({ kind: "design-review", maxModelEvents: 53 });
});

test("open-claude-design preserves intake references in final import context", () => {
  const root = "/tmp/design-completion-refs";
  const program = openClaudeDesign({ category: "general" }, root);
  const dir = join(root, "open-claude-design");
  const decision = program.decide({
    inputs: { prompt: "ship", discover_references: false },
    answers: {
      "approve-live-review": "Skip remaining review rounds and export as-is",
    },
    results: {
      intake: {
        intake: {
          brief: "ship",
          output_type: "page",
          references: ["https://example.test/reference", "docs/brief.md"],
        },
      },
      "product-context": { "product-context": "product" },
      "design-foundation": { "design-foundation": "design" },
      "live-config": { "live-config": "config" },
      "design-context": { "ds-locator": "locator" },
      "reference-context": { "reference-context": "references" },
      generate: { "generate-1": "preview" },
      export: { exporter: "spec" },
      "final-display": {
        "final-display": {
          display_method: "playwright-cli open",
          availability: "unavailable",
          playwright_cli_status: "spawn ENOENT",
          spec_path: join(dir, "spec.html"),
          preview_path: join(dir, "preview.html"),
          manual_open_instructions: "open file URL manually",
          next_action_hint: "rerun",
        },
      },
    },
  });
  expect(decision).toMatchObject({
    kind: "final",
    result: {
      playwright_cli_status: "spawn ENOENT",
      display: { availability: "unavailable" },
    },
  });
  if (decision.kind !== "final") throw new Error("missing final");
  const result = decision.result;
  if (
    result === null ||
    typeof result !== "object" ||
    !("import_context" in result)
  )
    throw Error("Missing import context");
  expect(result.import_context).toContain("https://example.test/reference");
  expect(result.import_context).toContain("docs/brief.md");
});

test.each(["opened", "unavailable", "wrong-path", "missing-path", "malformed"])(
  "controller admits or durably rejects final display: %s",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "design-completion-"));
    try {
      const program = openClaudeDesign({ category: "general" }, root);
      let definition: AuthoredWorkflow | undefined;
      const artifacts = new Map<string, string>();
      const native: NativeWorkflowTransport = {
        async execute(params) {
          if (params.action === "start" || params.action === "amend") {
            definition = params.definition;
            for (const node of definition.nodes) {
              if (artifacts.has(node.id)) continue;
              const value =
                node.id === "intake"
                  ? '{"brief":"ship","output_type":"page","references":[]}'
                  : node.id === "live-config"
                    ? `${JSON.stringify({ files: ["preview.html"], insertBefore: "</body>", commentSyntax: "html", cspChecked: true }, null, 2)}\n`
                    : node.id === "final-display"
                      ? mode === "malformed"
                        ? "not JSON"
                        : JSON.stringify({
                            display_method:
                              mode === "unavailable"
                                ? "manual"
                                : "playwright-cli open",
                            availability:
                              mode === "unavailable" ? "unavailable" : "opened",
                            playwright_cli_status:
                              mode === "unavailable"
                                ? "spawn ENOENT"
                                : "exit 0",
                            ...(mode === "missing-path"
                              ? {}
                              : {
                                  spec_path:
                                    mode === "wrong-path"
                                      ? "/forged/spec.html"
                                      : join(
                                          root,
                                          "open-claude-design/spec.html",
                                        ),
                                }),
                            preview_path: join(
                              root,
                              "open-claude-design/preview.html",
                            ),
                            manual_open_instructions: "open manually",
                            next_action_hint: "rerun",
                          })
                      : "artifact";
              artifacts.set(node.id, value);
              const path =
                node.id === "product-context"
                  ? join(root, "open-claude-design/PRODUCT.md")
                  : node.id === "design-foundation"
                    ? join(root, "open-claude-design/DESIGN.md")
                    : node.id === "live-config"
                      ? join(
                          root,
                          "open-claude-design/.impeccable/live/config.json",
                        )
                      : node.id === "generate-1"
                        ? join(root, "open-claude-design/preview.html")
                        : node.id === "exporter"
                          ? join(root, "open-claude-design/spec.html")
                          : node.id === "reference-context"
                            ? join(root, "open-claude-design/references.md")
                            : node.id.startsWith("ds-")
                              ? join(root, `open-claude-design/${node.id}.md`)
                              : undefined;
              if (path !== undefined) {
                await mkdir(dirname(path), { recursive: true });
                await writeFile(path, value);
              }
            }
            return {
              content: [],
              details: {
                kind: params.action === "start" ? "started" : "amended",
                run_id: "real-run",
              },
            };
          }
          if (!definition) throw new Error("missing definition");
          if (params.action === "snapshot")
            return {
              content: [],
              details: {
                kind: "snapshot",
                run_id: "real-run",
                snapshot: {
                  runId: "real-run",
                  runKey: program.key,
                  status: "completed",
                  definitionFingerprint:
                    nativeDefinitionFingerprint(definition),
                  nodes: definition.nodes.map(({ id }) => ({
                    id,
                    state: "completed",
                  })),
                },
              },
            };
          if (params.action === "wait")
            return {
              content: [],
              details: {
                kind: "waited",
                run_id: "real-run",
                result: {
                  runId: "real-run",
                  status: "completed",
                  nodes: Object.fromEntries(
                    definition.nodes.map(({ id }) => [
                      id,
                      { state: "completed", output: artifacts.get(id) },
                    ]),
                  ),
                },
              },
            };
          return {
            content: [],
            details: { kind: "cancelled", run_id: "real-run" },
          };
        },
      };
      const entries: unknown[] = [];
      const journal = {
        getBranch: () => entries,
        async appendEntry(customType: string, data: unknown) {
          entries.push({ customType, data: structuredClone(data) });
        },
      };
      const controller = createStagedController({
        native,
        program,
        inputs: { prompt: "ship", discover_references: false },
        journal,
        readArtifact: async (path) => Bun.file(path).text(),
      });
      let decision = await controller.advance();
      while (decision.kind === "wave") decision = await controller.advance();
      expect(decision).toMatchObject({
        kind: "gate",
        id: "approve-live-review",
      });
      decision = await controller.answerGate(
        "approve-live-review",
        "Skip remaining review rounds and export as-is",
      );
      expect(decision).toMatchObject({ kind: "wave", id: "export" });
      decision = await controller.advance();
      expect(decision).toMatchObject({ kind: "wave", id: "final-display" });
      expect(controller.checkpoint().admittedWaves).not.toContain(
        "final-display",
      );
      decision = await controller.advance();
      if (["wrong-path", "missing-path", "malformed"].includes(mode)) {
        expect(decision.kind).toBe("rejected");
        expect(controller.checkpoint().admittedWaves).not.toContain(
          "final-display",
        );
        const restored = createStagedController({
          native,
          program,
          inputs: { prompt: "ship", discover_references: false },
          journal,
          readArtifact: async (path) => Bun.file(path).text(),
        });
        expect(await restored.advance()).toEqual(decision);
        return;
      }
      expect(decision).toMatchObject({
        kind: "final",
        result: {
          output_type: "page",
          artifact: join(root, "open-claude-design", "preview.html"),
          handoff: join(root, "open-claude-design", "spec.html"),
          run_id: root.split("/").at(-1),
          artifact_dir: join(root, "open-claude-design"),
          preview_path: join(root, "open-claude-design", "preview.html"),
          spec_path: join(root, "open-claude-design", "spec.html"),
          playwright_cli_status:
            mode === "unavailable" ? "spawn ENOENT" : "exit 0",
          display: { availability: mode },
          live_review: "skipped",
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("design emits complete 64-node graph at live-event ceiling", () => {
  const root = "/tmp/design-capacity";
  const program = openClaudeDesign({ subagent_type: "omo-senpi" }, root);
  const results: Record<string, Record<string, unknown>> = {};
  const external: Record<string, unknown> = {};
  const nodes: ProgramNode[] = [];
  const state = {
    inputs: { prompt: "ship", discover_references: false },
    results,
    answers: { "approve-live-review": "Start live review" },
    external,
  };
  for (let step = 0; step < 70; step += 1) {
    const decision = program.decide(state);
    if (decision.kind === "design-review") {
      for (let index = 0; index < decision.maxModelEvents; index += 1)
        external[`event-${index}`] = {
          type: "generate",
          id: String(index),
          raw: "{}",
        };
      external["live.exit"] = { type: "exit", raw: "{}" };
      continue;
    }
    if (decision.kind === "final") break;
    if (decision.kind !== "wave") throw Error("Unexpected gate");
    nodes.push(...decision.nodes);
    results[decision.id] = Object.fromEntries(
      decision.nodes.map((node) => [
        node.id,
        node.id === "intake"
          ? { brief: "ship", output_type: "page", references: [] }
          : node.id === "final-display"
            ? {
                display_method: "manual",
                availability: "unavailable",
                playwright_cli_status: "ENOENT",
                spec_path: `${root}/open-claude-design/spec.html`,
                preview_path: `${root}/open-claude-design/preview.html`,
                manual_open_instructions: "open",
                next_action_hint: "rerun",
              }
            : node.id.startsWith("live-model-")
              ? { message: "done" }
              : "artifact",
      ]),
    );
  }
  expect(program.decide(state).kind).toBe("final");
  expect(nodes).toHaveLength(64);
  expect(new Set(nodes.map((node) => node.id)).size).toBe(64);
  expect(
    nodes.filter((node) => node.id.startsWith("live-model-")),
  ).toHaveLength(53);
  const admitted = new Set<string>();
  for (const node of nodes) {
    for (const dependency of node.dependsOn ?? [])
      expect(admitted.has(dependency)).toBe(true);
    admitted.add(node.id);
  }
  expect(nodes.at(-1)).toMatchObject({
    id: "final-display",
    dependsOn: ["exporter"],
  });
});
