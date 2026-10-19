import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import {
  layoutOverlayGraph,
  reduceOverlayInput,
  type OverlayGraph,
  type OverlayState,
  type OverlayViewport,
} from "./model.ts";
import { stageSwitcherNodes } from "./frame.ts";

export function pointerOverlay(
  data: string | TuiMouseEvent,
  graph: OverlayGraph,
  view: { readonly state: OverlayState; readonly viewport: OverlayViewport },
): OverlayState {
  const { state, viewport } = view;
  if (typeof data === "string" && !data.startsWith("\u001b[<")) return state;
  const match =
    typeof data === "string"
      ? /^(\d+);(\d+);(\d+)M$/.exec(data.slice(3))
      : undefined;
  if (match === null) return state;
  const native = typeof data === "string" ? undefined : data;
  if (native?.type === "wheel" && !native.wheelDelta) return state;
  // Native dispatch synthesizes click after press/release; activate only on press.
  if (
    native !== undefined &&
    native.type !== "wheel" &&
    (native.button !== "left" ||
      (native.type !== "press" && native.type !== "drag"))
  )
    return state;
  const button =
    native === undefined
      ? Number(match?.[1])
      : native.type === "wheel"
        ? native.shift
          ? 67
          : 65
        : native.type === "drag"
          ? 32
          : 0;
  const x = native?.x ?? Number(match?.[2]) - 1;
  const y = native === undefined ? Number(match?.[3]) - 4 : native.y - 3;
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
      panX:
        state.panX +
        (native?.wheelDelta ?? (button === 66 || button === 68 ? -8 : 8)),
    };
  if (button === 64 || button === 65)
    return state.searching
      ? reduceOverlayInput(state, graph, {
          kind: "key",
          key:
            (native?.wheelDelta ?? (button === 64 ? -1 : 1)) < 0
              ? "up"
              : "down",
        })
      : {
          ...state,
          panY: state.panY + (native?.wheelDelta ?? (button === 64 ? -4 : 4)),
        };
  if (
    !state.searching &&
    (button === 0 || button === 32) &&
    x === viewport.width - 1
  ) {
    const contentHeight = Math.max(
      0,
      ...cards.map((card) => card.rect.y + card.rect.height),
    );
    if (contentHeight <= viewport.height) return state;
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
