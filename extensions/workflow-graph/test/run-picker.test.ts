import { expect, test } from "bun:test";
import { pickWorkflowRun } from "../src/run-picker.ts";
import type { ProjectedRun } from "../src/contracts.ts";
const run = (runId: string, status: string): ProjectedRun => ({
  runId,
  runKey: runId,
  name: "Same name",
  status,
  createdAt: "2026-09-12T00:00:00Z",
  updatedAt: "2026-09-12T00:00:01Z",
  counts: {},
  nodes: [],
  edges: [],
  invalidEdges: [],
  waves: [],
  amendCount: 0,
  lastSeq: 0,
  stale: false,
});
test("native run picker groups active first and selects exact opaque ID", async () => {
  let rows: string[] = [];
  const selected = await pickWorkflowRun(
    [run("closed", "completed"), run("active", "running")],
    "",
    {
      async select(_title, options) {
        rows = options;
        return options[1];
      },
      notify() {},
    },
  );
  expect(rows[0]).toContain("active");
  expect(selected).toBe("closed");
});
test("run picker filters full ID and leaves cancellation unchanged", async () => {
  let calls = 0;
  const ui = {
    async select(_title: string, options: string[]) {
      calls++;
      expect(options).toHaveLength(1);
      return undefined;
    },
    notify() {},
  };
  expect(
    await pickWorkflowRun(
      [run("one", "running"), run("two", "completed")],
      "two",
      ui,
    ),
  ).toBeUndefined();
  expect(await pickWorkflowRun([], "", ui)).toBeUndefined();
  expect(calls).toBe(1);
});
