import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { WorkflowGraphComponent } from "../src/overlay/controller.ts";
import type { OverlayGraph, OverlayState } from "../src/overlay/model.ts";

const graph: OverlayGraph = {
  runId: "run-switcher",
  name: "Workflow with a long title for narrow terminals",
  stale: false,
  truncated: false,
  nodes: [
    { id: "build", label: "Build package", state: "running" },
    { id: "review", label: "Review package", state: "pending" },
  ],
  edges: [],
  unknownEdges: [],
};

function fixture() {
  let state: OverlayState = { query: "", panX: 0, panY: 0 };
  let dismissals = 0;
  const component = new WorkflowGraphComponent(
    graph,
    { requestRender() {} },
    undefined,
    undefined,
    state,
    (next) => {
      state = next;
    },
    () => {
      dismissals += 1;
    },
  );
  return { component, state: () => state, dismissals: () => dismissals };
}

describe("workflow stage switcher", () => {
  test("renders filtered status rows and keeps spaces inside search", () => {
    const view = fixture();
    view.component.handleInput("/");
    for (const key of "review package") view.component.handleInput(key);
    const rows = view.component.render(80);
    expect(view.state().query).toBe("review package");
    expect(view.state().searching).toBe(true);
    expect(
      rows.some(
        (row) => row.includes("Review package") && row.includes("pending"),
      ),
    ).toBe(true);
    expect(rows.some((row) => row.includes("Build package"))).toBe(false);
    view.component.handleInput("\r");
    expect(view.state()).toMatchObject({
      selectedId: "review",
      query: "",
      searching: false,
      detail: true,
    });
  });

  test("Escape closes switcher without hiding graph or leaking query", () => {
    const view = fixture();
    view.component.handleInput("/");
    view.component.handleInput("h");
    view.component.handleInput("\u001b");
    expect(view.dismissals()).toBe(0);
    expect(view.state()).toMatchObject({ searching: false, query: "" });
    view.component.handleInput("h");
    expect(view.dismissals()).toBe(1);
  });

  test("does not open old selection when filter has no matches", () => {
    const view = fixture();
    view.component.handleInput("\u001b[B");
    view.component.handleInput("/");
    view.component.handleInput("z");
    view.component.handleInput("\r");
    expect(view.state().searching).toBe(false);
    expect(view.state().detail).not.toBe(true);
  });

  test("handles Kitty navigation, Enter, Escape and Ctrl+X", () => {
    const view = fixture();
    view.component.handleInput("/");
    view.component.handleInput("r");
    view.component.handleInput("\u001b[13u");
    expect(view.state()).toMatchObject({
      selectedId: "review",
      searching: false,
      detail: true,
    });
    view.component.handleInput("/");
    view.component.handleInput("\u001b[27u");
    expect(view.state().searching).toBe(false);
    view.component.handleInput("\u001b[120;5u");
    expect(view.dismissals()).toBe(1);
  });

  test("clips every frame row to terminal cell width", () => {
    const view = fixture();
    for (const width of [24, 40, 80, 120]) {
      expect(
        view.component.render(width).every((row) => visibleWidth(row) <= width),
      ).toBe(true);
    }
  });

  test("selects first stage on switcher open", () => {
    const view = fixture();
    view.component.handleInput("/");
    expect(view.state().selectedId).toBe("build");
  });

  test("replaces empty placeholder when first real run arrives", () => {
    const component = new WorkflowGraphComponent(
      { ...graph, runId: "", name: "No active workflow", nodes: [] },
      { requestRender() {} },
      undefined,
      undefined,
      { query: "", panX: 0, panY: 0 },
      () => {},
      () => {},
    );
    component.setGraph(graph);
    expect(
      component.render(80).some((row) => row.includes("Build package")),
    ).toBe(true);
  });

  test("resets selection on switcher open like Atomic", () => {
    const view = fixture();
    view.component.handleInput("\u001b[B");
    view.component.handleInput("\u001b[B");
    view.component.handleInput("/");
    expect(view.state().selectedId).toBe("build");
  });

  test("clicks filtered switcher row rather than hidden graph card", () => {
    const view = fixture();
    view.component.handleInput("/");
    view.component.handleInput("r");
    view.component.render(80);
    view.component.handleInput("\u001b[<0;10;5M");
    expect(view.state()).toMatchObject({
      selectedId: "review",
      searching: false,
      detail: true,
    });
  });

  test("fills and resizes to host terminal rows without exposing chat", () => {
    const terminal = { rows: 35 };
    const component = new WorkflowGraphComponent(
      { ...graph, nodes: [] },
      { terminal, requestRender() {} },
      undefined,
      undefined,
      { query: "", panX: 0, panY: 0 },
      () => {},
      () => {},
    );
    expect(component.render(53)).toHaveLength(35);
    terminal.rows = 12;
    expect(component.render(24)).toHaveLength(12);
    expect(component.render(24).every((row) => visibleWidth(row) === 24)).toBe(
      true,
    );
  });

  test("decodes printable Kitty keys for switcher shortcuts and search", () => {
    const view = fixture();
    view.component.handleInput("\u001b[47u");
    view.component.handleInput("\u001b[114u");
    expect(view.state()).toMatchObject({
      searching: true,
      query: "r",
      selectedId: "review",
    });
  });

  test("keeps selected card visible after terminal shrinks", () => {
    const terminal = { rows: 35 };
    const component = new WorkflowGraphComponent(
      {
        ...graph,
        nodes: Array.from({ length: 8 }, (_, index) => ({
          id: `n${index}`,
          label: `Node ${index}`,
          state: "running" as const,
        })),
      },
      { terminal, requestRender() {} },
      undefined,
      undefined,
      { selectedId: "n7", query: "", panX: 0, panY: 0 },
      () => {},
      () => {},
    );
    component.render(80);
    terminal.rows = 12;
    expect(component.render(80).some((row) => row.includes("Node 7"))).toBe(
      true,
    );
  });
});
