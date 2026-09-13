import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionUIContext } from "@code-yeongyu/senpi";
import {
  cleanOverlayText,
  defaultOverlayTheme,
  layoutOverlayGraph,
  reduceOverlayInput,
  renderOverlayCanvas,
  type OverlayGraph,
} from "../src/overlay/model.ts";
import {
  createOverlayController,
  WorkflowGraphComponent,
} from "../src/overlay/controller.ts";

const graph: OverlayGraph = {
  runId: "run-a",
  name: "Workflow A",
  stale: false,
  truncated: false,
  nodes: [
    { id: "discover", label: "Discover", state: "completed", wave: 0 },
    { id: "build", label: "Build", state: "running", wave: 1 },
    { id: "review", label: "Review", state: "pending", wave: 1 },
  ],
  edges: [
    { from: "discover", to: "build" },
    { from: "discover", to: "review" },
  ],
  unknownEdges: [],
};

describe("workflow graph overlay model", () => {
  test("keeps CJK and joined graphemes inside card cell bounds", () => {
    const multilingual = {
      ...graph,
      nodes: [
        {
          id: "wide",
          label: "你好世界你好世界你好世界",
          state: "running" as const,
        },
        { id: "joined", label: "e\u0301 👨‍👩‍👧‍👦", state: "pending" as const },
      ],
      edges: [],
    };
    const rows = renderOverlayCanvas(
      multilingual,
      { query: "", panX: 0, panY: 0 },
      { width: 80, height: 20 },
    );
    const borders = rows.filter((row) => row.includes("│"));
    expect(borders).toHaveLength(4);
    expect(borders.every((row) => visibleWidth(row) === 26)).toBe(true);
    expect(rows.some((row) => row.includes("e\u0301 👨‍👩‍👧‍👦"))).toBe(true);
  });
  test("lays explicit edges by longest path with sibling wave bands", () => {
    const layout = layoutOverlayGraph(graph, { width: 120, height: 40 });
    const discover = layout.cards.find((card) => card.id === "discover");
    const build = layout.cards.find((card) => card.id === "build");
    const review = layout.cards.find((card) => card.id === "review");

    expect(layout.mode).toBe("canvas");
    expect(build?.rect.x).toBeGreaterThan(discover?.rect.x ?? 0);
    expect(review?.rect.x).toBe(build?.rect.x);
    expect(review?.rect.y).toBeGreaterThan(build?.rect.y ?? 0);
    expect(build?.wave).toBe(1);
  });

  test("keeps missing or malformed edges visibly unknown without drawing them", () => {
    const layout = layoutOverlayGraph(
      {
        ...graph,
        unknownEdges: [{ from: "missing", to: "build", reason: "endpoint" }],
      },
      { width: 120, height: 40 },
    );

    expect(layout.edges).toHaveLength(2);
    expect(layout.unknownEdges).toEqual([
      { from: "missing", to: "build", reason: "endpoint" },
    ]);
  });

  test("clips canvas cards and falls back to compact list on narrow terminals", () => {
    const clipped = layoutOverlayGraph(graph, {
      width: 90,
      height: 10,
      panX: 200,
    });
    const narrow = layoutOverlayGraph(graph, { width: 40, height: 10 });

    expect(clipped.cards.every((card) => !card.visible)).toBe(true);
    expect(narrow.mode).toBe("list");
    expect(narrow.cards[0]?.rect.width).toBeLessThanOrEqual(36);
  });

  test("keeps keyboard search, selection, and pan deterministic", () => {
    let state = reduceOverlayInput(
      { selectedId: "discover", query: "", panX: 0, panY: 0 },
      graph,
      { kind: "key", key: "down" },
    );
    state = reduceOverlayInput(state, graph, { kind: "key", key: "right" });
    state = reduceOverlayInput(state, graph, { kind: "text", text: "rev" });

    expect(state.selectedId).toBe("review");
    expect(state.panX).toBeGreaterThan(0);
    expect(state.query).toBe("rev");
  });

  test("selects cards through visible mouse hit rectangles", () => {
    const layout = layoutOverlayGraph(graph, { width: 120, height: 40 });
    const target = layout.cards.find((card) => card.id === "build");
    if (target === undefined) throw new Error("missing build card");

    const state = reduceOverlayInput(
      { selectedId: "discover", query: "", panX: 0, panY: 0 },
      graph,
      {
        kind: "mouse",
        x: target.rect.x + 1,
        y: target.rect.y + 1,
        cards: layout.cards,
      },
    );

    expect(state.selectedId).toBe("build");
  });

  test("renders valid graph edges into canvas and preserves narrow fallback", () => {
    const canvas = renderOverlayCanvas(
      graph,
      { selectedId: "build", query: "", panX: 0, panY: 0 },
      { width: 100, height: 20 },
    );
    const narrow = renderOverlayCanvas(
      graph,
      { selectedId: "build", query: "", panX: 0, panY: 0 },
      { width: 40, height: 20 },
    );

    expect(canvas.join("\n")).toContain("▶");
    expect(canvas.join("\n")).toContain("Discover");
    expect(canvas.every((line) => line.length <= 100)).toBe(true);
    expect(narrow).toEqual(expect.arrayContaining(["> [running] Build"]));
  });

  test("sanitizes terminal controls and keeps unspecified waves visible", () => {
    const unsafe = {
      ...graph,
      nodes: [
        {
          id: "unsafe",
          label: "Build\u001b]8;;https://bad\u0007",
          state: "running" as const,
        },
      ],
      edges: [],
    };
    const layout = layoutOverlayGraph(unsafe, { width: 120, height: 40 });
    const canvas = renderOverlayCanvas(
      unsafe,
      { selectedId: "unsafe", query: "", panX: 0, panY: 0 },
      { width: 120, height: 20 },
    );

    expect(layout.cards[0]?.wave).toBe(0);
    expect(layout.cards[0]?.visible).toBe(true);
    expect(cleanOverlayText(unsafe.nodes[0]?.label ?? "")).not.toContain(
      "\u001b",
    );
    expect(canvas.join("\n")).not.toContain("\u001b");
  });

  test("uses semantic color fallbacks for incomplete graph states", () => {
    const theme = defaultOverlayTheme({ accent: "cyan" });
    expect(theme.stale).toBe("warning");
    expect(theme.incomplete).toBe("warning");
    expect(theme.card).toBe("text");
  });

  test("switches preloaded runs and maps mouse clicks through rendered viewport", () => {
    const second: OverlayGraph = {
      ...graph,
      runId: "run-b",
      name: "Workflow B",
      nodes: [{ id: "other", label: "Other", state: "pending", wave: 0 }],
      edges: [],
    };
    const states: unknown[] = [];
    const component = new WorkflowGraphComponent(
      graph,
      { requestRender() {} },
      undefined,
      (runId) => (runId === "run-b" ? second : graph),
      { query: "", panX: 0, panY: 0 },
      (state) => states.push(state),
      () => {},
    );
    component.setGraph(second);
    component.handleInput("]");
    const rows = component.render(40);
    expect(rows.join("\n")).toContain("Workflow B");
    const targetRow = rows.findIndex((row) => row.includes("[pending] Other"));
    expect(targetRow).toBeGreaterThanOrEqual(0);
    component.handleInput(`\u001b[<0;5;${targetRow + 1}M`);
    expect(states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selectedId: "other" }),
      ]),
    );
  });

  test("persists overlay search and selected node through component state callbacks", () => {
    const states: unknown[] = [];
    const component = new WorkflowGraphComponent(
      graph,
      { requestRender() {} },
      undefined,
      undefined,
      { query: "", panX: 0, panY: 0 },
      (state) => states.push(state),
      () => {},
    );

    component.handleInput("/");
    component.handleInput("r");
    component.handleInput("\u001b[B");
    expect(states).toEqual([
      expect.objectContaining({ query: "", searching: true }),
      expect.objectContaining({ query: "r", selectedId: "discover" }),
      expect.objectContaining({ query: "r", selectedId: "review" }),
    ]);
  });

  test("reveals selected cards and scrolls canvas from mouse wheel input", () => {
    const states: unknown[] = [];
    const component = new WorkflowGraphComponent(
      {
        ...graph,
        nodes: [
          { id: "root", label: "Root", state: "completed", wave: 0 },
          { id: "far", label: "Far", state: "running", wave: 4 },
          ...Array.from({ length: 6 }, (_, index) => ({
            id: `sibling${index}`,
            label: `Sibling ${index}`,
            state: "pending" as const,
            wave: 4,
          })),
        ],
        edges: [{ from: "root", to: "far" }],
      },
      { requestRender() {} },
      undefined,
      undefined,
      { selectedId: "root", query: "", panX: 0, panY: 0 },
      (state) => states.push(state),
      () => {},
    );

    component.render(80);
    component.handleInput("j");
    component.handleInput("\u001b[<65;10;7M");

    expect(states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selectedId: "far",
          panX: expect.any(Number),
        }),
        expect.objectContaining({ panY: expect.any(Number) }),
      ]),
    );
    expect(
      states.some(
        (state) =>
          typeof state === "object" &&
          state !== null &&
          "panX" in state &&
          typeof state.panX === "number" &&
          state.panX > 0,
      ),
    ).toBe(true);
    expect(
      states.some(
        (state) =>
          typeof state === "object" &&
          state !== null &&
          "panY" in state &&
          typeof state.panY === "number" &&
          state.panY > 0,
      ),
    ).toBe(true);
  });

  test("retains a native overlay handle without opening UI outside TUI mode", () => {
    let openings = 0;
    let hidden = false;
    const custom: ExtensionUIContext["custom"] = <T>(
      _factory: Parameters<ExtensionUIContext["custom"]>[0],
      options?: Parameters<ExtensionUIContext["custom"]>[1],
    ): Promise<T> => {
      openings += 1;
      options?.onHandle?.({
        hide() {},
        setHidden(next: boolean) {
          hidden = next;
        },
        isHidden() {
          return hidden;
        },
        focus() {},
        unfocus() {},
        isFocused() {
          return false;
        },
      });
      return new Promise<T>(() => {});
    };
    const ui = { custom };
    const controller = createOverlayController({ mode: "tui", ui });

    expect(controller.show(graph)).toBe(true);
    expect(controller.show(graph)).toBe(true);
    expect(openings).toBe(1);
    controller.hide();
    expect(hidden).toBe(true);

    const nonInteractive = createOverlayController({ mode: "print" });
    expect(nonInteractive.show(graph)).toBe(false);
  });
});
