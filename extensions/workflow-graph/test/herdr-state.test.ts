import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGraphProjection,
  reduceGraphMessage,
} from "../src/projection.ts";
import { createHerdrStateWriter, viewerSnapshot } from "../src/herdr/state.ts";

function projection() {
  return reduceGraphMessage(createGraphProjection(), {
    name: "omo.dag.updated",
    data: {
      parent_session_id: "session-redacted",
      runs: [
        {
          run_id: "run-a",
          run_key: "workflow-a",
          name: "Workflow A",
          status: "running",
          created_at: "2026-09-12T00:00:00.000Z",
          updated_at: "2026-09-12T00:00:01.000Z",
          counts: { running: 1 },
          nodes: [
            {
              id: "build",
              label: "Build",
              prompt: "do not serialize",
              depends_on: [],
              state: "running",
              attempt: 2,
              created_at: "2026-09-12T00:00:00.000Z",
              last_error: { code: "redacted", message: "do not serialize" },
            },
          ],
          edges: [],
          waves: [],
          amend_count: 1,
        },
      ],
    },
  });
}

describe("workflow graph Herdr state", () => {
  test("serializes only normalized observer projection fields", () => {
    const snapshot = viewerSnapshot(projection(), "2026-09-12T00:00:02.000Z");
    expect(snapshot).toEqual({
      version: 1,
      parentSessionId: "session-redacted",
      updatedAt: "2026-09-12T00:00:02.000Z",
      stale: false,
      truncated: false,
      runs: [
        {
          id: "run-a",
          name: "Workflow A",
          status: "running",
          amendCount: 1,
          stale: false,
          nodes: [
            {
              id: "build",
              label: "Build",
              state: "running",
              attempt: 2,
              errorCode: "redacted",
            },
          ],
          edges: [],
          unknownEdges: [],
        },
      ],
      tasks: [],
    });
    expect(JSON.stringify(snapshot)).not.toContain("do not serialize");
  });

  test("keeps standalone task view metadata without prompt or error bodies", () => {
    const snapshot = viewerSnapshot(
      {
        ...projection(),
        tasks: [
          {
            taskId: "task-root",
            status: "blocked",
            updatedAt: "2026-09-12T00:00:02.000Z",
            model: "safe-model",
            turns: 3,
          },
        ],
      },
      "2026-09-12T00:00:03.000Z",
    );
    expect(snapshot.tasks).toEqual([
      { id: "task-root", status: "blocked", model: "safe-model", turns: 3 },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("prompt");
    expect(JSON.stringify(snapshot)).not.toContain("do not serialize");
  });

  test("writes latest state atomically through one serialized writer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workflow-graph-state-"));
    const writer = createHerdrStateWriter(
      join(directory, "nested", "state.json"),
    );
    await Promise.all([writer.write(projection()), writer.write(projection())]);
    const stored = JSON.parse(await readFile(writer.path, "utf8"));
    expect(stored.version).toBe(1);
    expect(stored.runs[0].nodes[0].label).toBe("Build");
  });
});
