import { describe, expect, test } from "bun:test";
import { atomicBuiltins } from "../src/builtins/index.ts";
import { repoToExtension } from "../src/builtins/repo-to-extension.ts";

type Result = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

function decide(results: Result = {}, answers: Record<string, string> = {}) {
  return repoToExtension(
    { subagent_type: "omo-senpi" },
    "/tmp/workflow-artifacts",
  ).decide({
    inputs: { repository_url: "https://github.com/acme/widgets.git" },
    results,
    answers,
  });
}

const report = {
  repository_url: "https://github.com/acme/widgets.git",
  source_path: "/tmp/workflow-artifacts/repo-to-extension/source",
  project_name: "widgets",
  summary: "Widgets exposes a stable local status endpoint.",
  languages: ["TypeScript"],
  tooling: ["Bun"],
  capabilities: [
    {
      kind: "skill",
      name: "widget-status",
      description: "Inspect widget status.",
      evidence: "src/status.ts",
    },
    {
      kind: "tool",
      name: "widget_status",
      description: "Read widget status.",
      evidence: "src/status.ts",
    },
    {
      kind: "hook",
      name: "status-guard",
      description: "Block unsupported status writes.",
      evidence: "src/status.ts",
    },
  ],
};

const plan = {
  repository_url: report.repository_url,
  extension_name: "widgets",
  output_dir: "extensions/widgets",
  skills: [
    {
      name: "widget-status",
      description: "Inspect widget status.",
    },
  ],
  tools: [
    {
      name: "widget_status",
      description: "Read widget status.",
    },
  ],
  hooks: [
    {
      event: "tool_call",
      name: "status-guard",
      purpose: "Block unsupported status writes.",
    },
  ],
  constraints: ["Read-only by default."],
};

describe("repo-to-extension workflow", () => {
  test("creates safe discovery stage from HTTPS repository input", () => {
    const first = decide();

    expect(first).toMatchObject({ kind: "wave", id: "inspect-repository" });
    if (first.kind !== "wave") throw new Error("missing discovery wave");
    expect(first.nodes).toHaveLength(1);
    expect(first.nodes[0]).toMatchObject({
      id: "inspect-repository",
      subagent_type: "explore",
      output: {
        file: {
          path: "/tmp/workflow-artifacts/repo-to-extension/repository-report.json",
        },
      },
    });
    expect(first.nodes[0]?.prompt).toContain(
      "without executing repository code",
    );
  });

  test("rejects report from another repository before planning", () => {
    expect(
      decide({
        "inspect-repository": {
          "inspect-repository": {
            ...report,
            repository_url: "https://github.com/acme/other.git",
          },
        },
      }),
    ).toMatchObject({ kind: "wave", id: "inspect-repository" });
  });

  test("requires explicit approval before extension generation", () => {
    const second = decide({
      "inspect-repository": { "inspect-repository": report },
    });
    expect(second).toMatchObject({ kind: "wave", id: "design-extension" });

    const gate = decide({
      "inspect-repository": { "inspect-repository": report },
      "design-extension": { "design-extension": plan },
    });
    expect(gate).toMatchObject({
      kind: "gate",
      id: "approve-extension",
      choices: ["approve", "reject"],
    });
  });

  test("emits build and verification stages bound to approved plan", () => {
    const results = {
      "inspect-repository": { "inspect-repository": report },
      "design-extension": { "design-extension": plan },
    };
    const build = decide(results, { "approve-extension": "approve" });
    expect(build).toMatchObject({ kind: "wave", id: "build-extension" });
    if (build.kind !== "wave") throw new Error("missing build wave");
    expect(build.nodes[0]).toMatchObject({
      subagent_type: "explore",
      output: {
        file: {
          path: "/tmp/workflow-artifacts/repo-to-extension/build-manifest.json",
        },
      },
    });

    const verify = decide(
      {
        ...results,
        "build-extension": {
          "build-extension": {
            repository_url: report.repository_url,
            extension_name: "widgets",
            output_dir: "extensions/widgets",
            files: [
              "AGENTS.md",
              "README.md",
              "package.json",
              "src/index.ts",
              "src/tools.ts",
              "skills/widget-status/SKILL.md",
              "test/widgets.test.ts",
            ],
            skills: ["widget-status"],
            tools: ["widget_status"],
            hooks: ["status-guard"],
          },
        },
      },
      { "approve-extension": "approve" },
    );
    expect(verify).toMatchObject({ kind: "wave", id: "verify-extension" });
  });

  test("registers native repo-to-extension program", () => {
    expect(
      atomicBuiltins(
        { subagent_type: "omo-senpi" },
        "/tmp/workflow-artifacts",
      ).some(({ key }) => key === "repo-to-extension"),
    ).toBe(true);
  });

  test("rejects non-HTTPS repositories and unsafe extension names", () => {
    const program = repoToExtension(
      { subagent_type: "omo-senpi" },
      "/tmp/workflow-artifacts",
    );
    expect(() =>
      program.decide({
        inputs: { repository_url: "git@github.com:acme/widgets.git" },
        results: {},
        answers: {},
      }),
    ).toThrow("repo-to-extension: invalid inputs");
    expect(() =>
      program.decide({
        inputs: {
          repository_url: "https://github.com/acme/widgets.git",
          extension_name: "../../outside",
        },
        results: {},
        answers: {},
      }),
    ).toThrow("repo-to-extension: invalid inputs");
  });
});
