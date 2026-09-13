import {
  layoutOverlayGraph,
  reduceOverlayInput,
  type OverlayGraph,
  type OverlayState,
  type OverlayViewport,
} from "./model.ts";
import { stageSwitcherNodes } from "./frame.ts";

export function pointerOverlay(
  data: string,
  graph: OverlayGraph,
  view: { readonly state: OverlayState; readonly viewport: OverlayViewport },
): OverlayState {
  const { state, viewport } = view;
  if (!data.startsWith("\u001b[<")) return state;
  const match = /^(\d+);(\d+);(\d+)M$/.exec(data.slice(3));
  if (match === null) return state;
  const button = Number(match[1]);
  const x = Number(match[2]) - 1;
  const y = Number(match[3]) - 4;
  if (x < 0 || x >= viewport.width || y < -1 || y >= viewport.height)
    return state;
  const { cards } = layoutOverlayGraph(graph, {
    ...viewport,
    orientation: state.orientation,
  });
  if (!state.searching && (button === 0 || button === 32) && y === -1) {
    const contentWidth = Math.max(
      0,
      ...cards.map((card) => card.rect.x + card.rect.width),
    );
    if (contentWidth <= viewport.width) return state;
    return {
      ...state,
      panX: Math.round(
        (x / Math.max(1, viewport.width - 1)) * (contentWidth - viewport.width),
      ),
    };
  }
  if (y < 0) return state;
  if (
    !state.searching &&
    (button === 66 || button === 67 || button === 68 || button === 69)
  )
    return {
      ...state,
      panX: state.panX + (button === 66 || button === 68 ? -8 : 8),
    };
  if (button === 64 || button === 65)
    return state.searching
      ? reduceOverlayInput(state, graph, {
          kind: "key",
          key: button === 64 ? "up" : "down",
        })
      : { ...state, panY: state.panY + (button === 64 ? -4 : 4) };
  if (
    !state.searching &&
    (button === 0 || button === 32) &&
    x === viewport.width - 1
  ) {
    const contentHeight = Math.max(
      0,
      ...cards.map((card) => card.rect.y + card.rect.height),
    );
    const maxPan = Math.max(0, contentHeight - viewport.height);
    return {
      ...state,
      panY: Math.round((y / Math.max(1, viewport.height - 1)) * maxPan),
    };
  }
  if (button !== 0) return state;
  if (state.searching) {
    const node = stageSwitcherNodes(graph, state, viewport.height)[y - 1];
    return node === undefined
      ? state
      : {
          ...state,
          selectedId: node.id,
          query: "",
          searching: false,
          detail: true,
        };
  }
  const layout = layoutOverlayGraph(graph, {
    ...viewport,
    panX: state.panX,
    panY: state.panY,
    orientation: state.orientation,
  });
  const next = reduceOverlayInput(state, graph, {
    kind: "mouse",
    x: x + state.panX,
    y: y + state.panY,
    cards: layout.cards,
  });
  return next === state ? state : { ...next, detail: true };
}
