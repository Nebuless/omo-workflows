import {
  cleanOverlayText,
  layoutOverlayGraph,
  type OverlayLayout,
  type OverlayState,
  type OverlayGraph,
  type OverlayNode,
  type OverlayViewport,
  type OverlayInput,
} from "./model.ts";

export function navigateOverlay(
  state: OverlayState,
  layout: OverlayLayout,
  key: "up" | "down" | "left" | "right",
): OverlayState {
  const current = layout.cards.find((card) => card.id === state.selectedId);
  if (current === undefined)
    return { ...state, selectedId: layout.cards[0]?.id };
  const horizontal = key === "left" || key === "right";
  const direction = key === "left" || key === "up" ? -1 : 1;
  const axis = horizontal ? "x" : "y";
  const cross = horizontal ? "y" : "x";
  const depth =
    layout.mode === "canvas" &&
    horizontal === (layout.orientation === "horizontal");
  const candidates = layout.cards.filter(
    (card) =>
      (card.rect[axis] - current.rect[axis]) * direction > 0 &&
      (layout.mode === "list" ||
        (depth
          ? card.wave === current.wave + direction
          : card.wave === current.wave)),
  );
  candidates.sort(
    (a, b) =>
      Math.abs(a.rect[axis] - current.rect[axis]) -
        Math.abs(b.rect[axis] - current.rect[axis]) ||
      Math.abs(a.rect[cross] - current.rect[cross]) -
        Math.abs(b.rect[cross] - current.rect[cross]),
  );
  return { ...state, selectedId: candidates[0]?.id ?? current.id };
}

function orderedNodes(
  graph: OverlayGraph,
  query: string,
): readonly OverlayNode[] {
  const normalized = cleanOverlayText(query).toLowerCase();
  return graph.nodes.filter((node) =>
    cleanOverlayText(node.label).toLowerCase().includes(normalized),
  );
}

export function revealOverlaySelection(
  state: OverlayState,
  graph: OverlayGraph,
  viewport: OverlayViewport,
): OverlayState {
  if (state.selectedId === undefined) return state;
  const card = layoutOverlayGraph(graph, {
    width: viewport.width,
    height: viewport.height,
    orientation: viewport.orientation,
  }).cards.find((item) => item.id === state.selectedId);
  if (card === undefined) return state;
  const panX =
    card.rect.x < state.panX
      ? card.rect.x
      : card.rect.x + card.rect.width > state.panX + viewport.width
        ? Math.max(0, card.rect.x + card.rect.width - viewport.width)
        : state.panX;
  const panY =
    card.rect.y < state.panY
      ? card.rect.y
      : card.rect.y + card.rect.height > state.panY + viewport.height
        ? Math.max(0, card.rect.y + card.rect.height - viewport.height)
        : state.panY;
  return { ...state, panX, panY };
}

export function reduceOverlayInput(
  state: OverlayState,
  graph: OverlayGraph,
  input: OverlayInput,
): OverlayState {
  if (input.kind === "text") {
    const query = state.query + input.text;
    const first = orderedNodes(graph, query)[0];
    return {
      ...state,
      query,
      searching: true,
      ...(first === undefined ? {} : { selectedId: first.id }),
    };
  }
  if (input.kind === "backspace") {
    const query = state.query.slice(0, -1);
    const first = orderedNodes(graph, query)[0];
    return {
      ...state,
      query,
      ...(first === undefined ? {} : { selectedId: first.id }),
    };
  }
  if (input.kind === "mouse") {
    const card = input.cards.find(
      (item) =>
        item.visible &&
        input.x >= item.rect.x &&
        input.x < item.rect.x + item.rect.width &&
        input.y >= item.rect.y &&
        input.y < item.rect.y + item.rect.height,
    );
    return card === undefined ? state : { ...state, selectedId: card.id };
  }

  if (input.key === "home") return { ...state, panX: 0, panY: 0 };
  if (input.key === "end") return { ...state, panX: state.panX + 30 };
  if (input.key === "left")
    return { ...state, panX: Math.max(0, state.panX - 8) };
  if (input.key === "right") return { ...state, panX: state.panX + 8 };
  const nodes = orderedNodes(graph, state.query);
  if (nodes.length === 0) return state;
  const selected = nodes.findIndex((node) => node.id === state.selectedId);
  const direction = input.key === "down" ? 1 : -1;
  const index =
    selected < 0
      ? 0
      : Math.max(0, Math.min(nodes.length - 1, selected + direction));
  return { ...state, selectedId: nodes[index]?.id };
}
