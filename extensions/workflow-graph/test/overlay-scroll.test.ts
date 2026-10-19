import { expect, test } from "bun:test";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { WorkflowGraphComponent } from "../src/overlay/component.ts";
import type { OverlayGraph, OverlayState } from "../src/overlay/model.ts";

const graph: OverlayGraph = {
  runId: "scroll",
  name: "Scroll",
  stale: false,
  truncated: false,
  nodes: Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    label: `Node ${i}`,
    state: "running" as const,
  })),
  edges: [],
  unknownEdges: [],
};
function fixture(width = 80) {
  let state: OverlayState = { selectedId: "0", query: "", panX: 0, panY: 0 };
  const component = new WorkflowGraphComponent(
    graph,
    { terminal: { rows: 14 }, requestRender() {} },
    undefined,
    undefined,
    state,
    (next) => {
      state = next;
    },
    () => {},
  );
  component.render(width);
  return { component, state: () => state };
}

function mouse(event: Partial<TuiMouseEvent>): TuiMouseEvent {
  return {
    type: "press",
    button: "left",
    x: 9,
    y: 4,
    screenX: 109,
    screenY: 104,
    width: 40,
    height: 14,
    shift: false,
    alt: false,
    ctrl: false,
    ...event,
  };
}

test("native local press selects a card once across release and synthesized click", () => {
  const view = fixture(40);
  expect(view.component.handleMouse(mouse({}))).toMatchObject({
    handled: true,
  });
  expect(view.state()).toMatchObject({ selectedId: "1", detail: true });
  const selected = view.state();
  view.component.handleMouse(mouse({ type: "release" }));
  view.component.handleMouse(mouse({ type: "click", clickCount: 1 }));
  expect(view.state()).toBe(selected);
});

test("native wheel uses logical deltas while raw fallback retains its step", () => {
  const view = fixture();
  expect(
    view.component.handleMouse(
      mouse({ type: "wheel", button: "none", wheelDelta: 3 }),
    ),
  ).toMatchObject({ handled: true });
  expect(view.state().panY).toBe(3);
  view.component.handleInput("\u001b[<65;10;5M");
  expect(view.state().panY).toBe(7);
  view.component.handleMouse(
    mouse({ type: "wheel", button: "none", wheelDelta: -20 }),
  );
  expect(view.state().panY).toBe(0);
});

test("native scrollbar press captures drag and leaves card selection alone", () => {
  const view = fixture();
  expect(
    view.component.handleMouse(mouse({ x: 79, y: 12, width: 80 })),
  ).toMatchObject({
    handled: true,
    capture: true,
  });
  expect(view.state().panY).toBe(62);
  view.component.handleMouse(mouse({ type: "drag", x: 79, y: 3, width: 80 }));
  expect(view.state()).toMatchObject({ panY: 0, selectedId: "0" });
});

test("native horizontal track and shifted wheel use existing geometry", () => {
  const view = fixture();
  view.component.handleInput("v");
  view.component.handleMouse(
    mouse({ type: "wheel", button: "none", wheelDelta: 6, shift: true }),
  );
  expect(view.state().panX).toBe(6);
  expect(
    view.component.handleMouse(mouse({ x: 79, y: 2, width: 80 })),
  ).toMatchObject({ capture: true });
  expect(view.state().panX).toBe(276);
  view.component.handleMouse(mouse({ type: "drag", x: 0, y: 2, width: 80 }));
  expect(view.state().panX).toBe(0);
});

test("native switcher hit targets follow filtered rendered rows", () => {
  const view = fixture(40);
  view.component.handleInput("/");
  for (const key of "Node 11") view.component.handleInput(key);
  view.component.handleMouse(mouse({}));
  expect(view.state()).toMatchObject({
    selectedId: "11",
    searching: false,
    detail: true,
  });
});

test("native header and other buttons do not activate cards or leak to transcript", () => {
  const view = fixture(40);
  expect(view.component.handleMouse(mouse({ y: 1 }))).toMatchObject({
    handled: true,
  });
  view.component.handleMouse(mouse({ button: "right" }));
  view.component.handleMouse(mouse({ type: "move", button: "none" }));
  expect(view.state()).toMatchObject({ selectedId: "0", panX: 0, panY: 0 });
  expect(view.state().detail).not.toBe(true);
  expect(view.component.handleMouse(mouse({ x: -1 }))).toBeUndefined();
});
test("manual scrolling stays away from selected card and clamps at content end", () => {
  const view = fixture();
  view.component.handleInput("\u001b[6~");
  expect(view.state().panY).toBe(8);
  for (let i = 0; i < 20; i++) view.component.handleInput("\u001b[6~");
  expect(view.state().panY).toBe(62);
  expect(view.component.render(80).some((row) => row.includes("Node 11"))).toBe(
    true,
  );
});
test("narrow list pointer uses actual rendered rows and ignores releases", () => {
  const view = fixture(40);
  view.component.handleInput("\u001b[<0;10;5m");
  expect(view.state().selectedId).toBe("0");
  view.component.handleInput("\u001b[<0;10;5M");
  expect(view.state()).toMatchObject({ selectedId: "1", detail: true });
});
test("switcher mouse wheel clamps selection instead of panning graph", () => {
  const view = fixture();
  view.component.handleInput("/");
  view.component.handleInput("\u001b[<65;10;5M");
  expect(view.state().selectedId).toBe("1");
  for (let i = 0; i < 20; i++) view.component.handleInput("\u001b[<65;10;5M");
  expect(view.state().selectedId).toBe("11");
  expect(view.state().panY).toBe(0);
});

test("short switcher keeps selected row visible and pointer targets aligned", () => {
  let state: OverlayState = { query: "", panX: 0, panY: 0, selectedId: "0" };
  const component = new WorkflowGraphComponent(
    graph,
    { terminal: { rows: 8 }, requestRender() {} },
    undefined,
    undefined,
    state,
    (next) => {
      state = next;
    },
    () => {},
  );
  component.render(40);
  component.handleInput("/");
  for (let i = 0; i < 11; i++) component.handleInput("\u001b[B");
  const rows = component.render(40);
  const row = rows.findIndex((line) => line.includes("> [running] Node 11"));
  expect(row).toBeGreaterThanOrEqual(0);
  component.handleInput(`\u001b[<0;10;${row + 1}M`);
  expect(state).toMatchObject({
    selectedId: "11",
    searching: false,
    detail: true,
  });
});

test("scrollbar thumb and drag share bounded viewport coordinates", () => {
  const view = fixture();
  expect(view.component.render(80).some((row) => row.endsWith("█"))).toBe(true);
  view.component.handleInput("\u001b[<0;80;13M");
  expect(view.state().panY).toBe(62);
  view.component.handleInput("\u001b[<32;80;4M");
  expect(view.state().panY).toBe(0);
  expect(view.state().selectedId).toBe("0");
});

test("horizontal track and wheel pan independently of selected node", () => {
  const view = fixture(80);
  view.component.handleInput("v");
  expect(view.component.render(80)[2]).toContain("█");
  view.component.handleInput("\u001b[<67;10;5M");
  expect(view.state().panX).toBe(8);
  view.component.handleInput("\u001b[<0;80;3M");
  expect(view.state().panX).toBe(276);
  view.component.handleInput("\u001b[<32;1;3M");
  expect(view.state().panX).toBe(0);
  expect(view.state().selectedId).toBe("0");
});
