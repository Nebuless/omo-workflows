import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const viewer = join(import.meta.dirname, "../src/herdr/viewer.ts");

const snapshot = {
  version: 1,
  updatedAt: "2026-09-12T00:00:00.000Z",
  stale: false,
  truncated: false,
  runs: [
    {
      id: "run-a",
      name: "QA graph",
      status: "running",
      amendCount: 0,
      stale: false,
      nodes: [{ id: "node-a", label: "Build", state: "running", attempt: 1 }],
      edges: [],
      unknownEdges: [],
    },
  ],
  tasks: [{ id: "task-a", status: "blocked", model: "test-model", turns: 2 }],
};

describe("workflow graph Herdr viewer", () => {
  test("renders one-shot DAG and standalone task surfaces", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workflow-graph-viewer-"));
    const state = join(directory, "state.json");
    await writeFile(state, JSON.stringify(snapshot));

    const dag = await Bun.$`bun ${viewer} --state ${state} --once`.quiet();
    const tasks =
      await Bun.$`bun ${viewer} --state ${state} --view tasks --once`.quiet();

    expect(dag.stdout.toString()).toContain("QA graph running 1 nodes");
    expect(tasks.stdout.toString()).toContain("Standalone tasks");
    expect(tasks.stdout.toString()).toContain("task-a");
    expect(tasks.stdout.toString()).not.toContain("\u001b]");
  });
});
