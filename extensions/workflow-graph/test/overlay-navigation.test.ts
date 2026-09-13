import { expect, test } from "bun:test";
import { navigateOverlay } from "../src/overlay/navigation.ts";
import {
  layoutOverlayGraph,
  renderOverlayCanvas,
  type OverlayGraph,
  type OverlayState,
} from "../src/overlay/model.ts";
const graph: OverlayGraph = {
  runId: "nav",
  name: "Nav",
  stale: false,
  truncated: false,
  nodes: [
    { id: "root", label: "Root", state: "completed", wave: 0 },
    { id: "a", label: "A", state: "running", wave: 1 },
    { id: "b", label: "B", state: "pending", wave: 1 },
    { id: "end", label: "End", state: "pending", wave: 2 },
  ],
  edges: [
    { from: "root", to: "a" },
    { from: "root", to: "b" },
    { from: "b", to: "end" },
  ],
  unknownEdges: [],
};
test("spatial navigation moves by depth and nearest sibling without wrapping", () => {
  const viewport = { width: 100, height: 30 };
  let state: OverlayState = { selectedId: "root", query: "", panX: 0, panY: 0 };
  expect(
    navigateOverlay(state, layoutOverlayGraph(graph, viewport), "down")
      .selectedId,
  ).toBe("root");
  state = navigateOverlay(state, layoutOverlayGraph(graph, viewport), "right");
  expect(state.selectedId).toBe("a");
  state = navigateOverlay(state, layoutOverlayGraph(graph, viewport), "down");
  expect(state.selectedId).toBe("b");
  state = navigateOverlay(state, layoutOverlayGraph(graph, viewport), "down");
  expect(state.selectedId).toBe("b");
  state = navigateOverlay(state, layoutOverlayGraph(graph, viewport), "right");
  expect(state.selectedId).toBe("end");
});
test("vertical orientation places dependencies below parent and keeps spatial keys", () => {
  const viewport = { width: 100, height: 30, orientation: "vertical" as const };
  const layout = layoutOverlayGraph(graph, viewport);
  const root = layout.cards[0];
  const child = layout.cards[1];
  expect(child?.rect.y).toBeGreaterThan(root?.rect.y ?? 0);
  expect(child?.rect.x).toBe(root?.rect.x);
  const state = navigateOverlay(
    { selectedId: "root", query: "", panX: 0, panY: 0 },
    layout,
    "down",
  );
  expect(state.selectedId).toBe("a");
  expect(
    renderOverlayCanvas(graph, state, viewport).some((row) =>
      row.includes("▼"),
    ),
  ).toBe(true);
});

test("connector crossings preserve both axes", () => {
  const rows = renderOverlayCanvas(
    graph,
    { query: "", panX: 0, panY: 0 },
    { width: 100, height: 30, orientation: "vertical" },
  );
  expect(rows[6]?.[15]).toBe("┼");
});
