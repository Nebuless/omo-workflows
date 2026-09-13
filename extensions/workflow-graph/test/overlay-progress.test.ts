import { expect, test } from "bun:test";
import {
  renderOverlayFrame,
  workflowProgress,
  nodeDuration,
} from "../src/overlay/frame.ts";
import type { OverlayGraph } from "../src/overlay/model.ts";
const graph: OverlayGraph = {
  runId: "progress",
  name: "Progress",
  stale: false,
  truncated: false,
  nodes: [
    {
      id: "one",
      label: "One",
      state: "completed",
      startedAt: "2026-09-12T00:00:01Z",
      completedAt: "2026-09-12T00:00:03.500Z",
    },
    { id: "two", label: "Two", state: "failed" },
    { id: "three", label: "Three", state: "running" },
  ],
  edges: [],
  unknownEdges: [],
  counts: { total: 3, completed: 1, failed: 1, running: 1 },
};
test("progress counts terminal nodes without double-counting total", () => {
  expect(workflowProgress(graph)).toEqual({
    finished: 2,
    total: 3,
    percent: 66,
  });
  expect(workflowProgress({ ...graph, nodes: [], counts: {} })).toEqual({
    finished: 0,
    total: 0,
    percent: 0,
  });
  expect(
    workflowProgress({
      ...graph,
      truncated: true,
      counts: { total: 10, completed: 4, failed: 1 },
    }),
  ).toEqual({ finished: 5, total: 10, percent: 50 });
});
test("node duration uses authoritative timestamps and rejects invalid ordering", () => {
  expect(nodeDuration(graph.nodes[0])).toBe(2500);
  expect(nodeDuration(graph.nodes[2])).toBeUndefined();
  expect(
    nodeDuration({
      ...{
        id: "one",
        label: "One",
        state: "completed" as const,
        completedAt: "2026-09-12T00:00:03.500Z",
      },
      startedAt: "bad",
    }),
  ).toBeUndefined();
  expect(
    nodeDuration({
      ...{
        id: "one",
        label: "One",
        state: "completed" as const,
        completedAt: "2026-09-12T00:00:03.500Z",
      },
      startedAt: "2026-09-12T00:00:05Z",
    }),
  ).toBeUndefined();
});
test("progress and completed duration stay visible in bounded frame", () => {
  const rows = renderOverlayFrame(
    graph,
    { query: "", panX: 0, panY: 0, selectedId: "one", detail: true },
    { runs: [graph], notice: "", width: 80, height: 20 },
  );
  expect(rows).toHaveLength(20);
  expect(rows.some((row) => row.includes("2/3") && row.includes("66%"))).toBe(
    true,
  );
  expect(rows.some((row) => row.includes("2.5s"))).toBe(true);
});

test("fullscreen keeps action result visible when graph fills viewport", () => {
  const notice = "CONTROL_RESULT_SENTINEL";
  const rows = renderOverlayFrame(
    graph,
    { query: "", panX: 0, panY: 0 },
    { runs: [graph], notice, width: 80, height: 14 },
  );
  expect(rows).toHaveLength(14);
  expect(rows.some((row) => row.includes(notice))).toBe(true);
  const switcherRows = renderOverlayFrame(
    graph,
    { query: "", panX: 0, panY: 0, searching: true },
    { runs: [graph], notice, width: 80, height: 14 },
  );
  expect(switcherRows.filter((row) => row.includes(notice))).toHaveLength(1);
});
