import { stripVTControlCharacters } from "node:util";
import {
  getGraphemeSegmenter,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  cleanOverlayText,
  layoutOverlayGraph,
  type OverlayGraph,
  type OverlayState,
  type OverlayViewport,
} from "./model.ts";

function put(grid: string[][], x: number, y: number, value: string): void {
  const row = grid[y];
  if (row === undefined || x < 0 || x >= row.length) return;
  const previous = row[x];
  row[x] =
    (value === "─" || value === "│") &&
    (previous === "┼" ||
      (previous === "─" && value === "│") ||
      (previous === "│" && value === "─"))
      ? "┼"
      : value;
}

function write(grid: string[][], x: number, y: number, value: string): void {
  let column = x;
  for (const { segment } of getGraphemeSegmenter().segment(value)) {
    const width = visibleWidth(segment);
    if (column >= 0 && column + width <= (grid[y]?.length ?? 0)) {
      put(grid, column, y, segment);
      for (let offset = 1; offset < width; offset++)
        put(grid, column + offset, y, "");
    }
    column += width;
  }
}

function clipped(value: string, width: number): string {
  return stripVTControlCharacters(
    truncateToWidth(cleanOverlayText(value), width, "…", true),
  );
}

export function renderOverlayCanvas(
  graph: OverlayGraph,
  state: OverlayState,
  viewport: OverlayViewport,
): readonly string[] {
  const layout = layoutOverlayGraph(graph, viewport);
  if (layout.mode === "list") {
    return layout.cards
      .filter((card) => card.visible)
      .map(
        (card) =>
          `${card.id === state.selectedId ? ">" : " "} [${card.state}] ${cleanOverlayText(card.label)}`,
      );
  }
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const grid = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => " "),
  );
  const byId = new Map(layout.cards.map((card) => [card.id, card]));
  const panX = viewport.panX ?? 0;
  const panY = viewport.panY ?? 0;

  for (const edge of layout.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from === undefined || to === undefined) continue;
    if (viewport.orientation === "vertical") {
      const startX = from.rect.x + Math.floor(from.rect.width / 2) - panX;
      const startY = from.rect.y + from.rect.height - panY;
      const endX = to.rect.x + Math.floor(to.rect.width / 2) - panX;
      const endY = to.rect.y - 1 - panY;
      const middleY = Math.floor((startY + endY) / 2);
      for (let y = startY; y <= middleY; y++) put(grid, startX, y, "│");
      for (let x = Math.min(startX, endX); x <= Math.max(startX, endX); x++)
        put(grid, x, middleY, "─");
      for (let y = middleY; y <= endY; y++) put(grid, endX, y, "│");
      put(grid, endX, endY, "▼");
      continue;
    }
    const startX = from.rect.x + from.rect.width - panX;
    const startY = from.rect.y + 1 - panY;
    const endX = to.rect.x - 1 - panX;
    const endY = to.rect.y + 1 - panY;
    const middleX = Math.floor((startX + endX) / 2);
    for (
      let x = Math.min(startX, middleX);
      x <= Math.max(startX, middleX);
      x += 1
    )
      put(grid, x, startY, "─");
    for (let y = Math.min(startY, endY); y <= Math.max(startY, endY); y += 1)
      put(grid, middleX, y, "│");
    for (let x = Math.min(middleX, endX); x <= Math.max(middleX, endX); x += 1)
      put(grid, x, endY, "─");
    put(grid, endX, endY, "▶");
  }

  for (const card of layout.cards) {
    if (!card.visible) continue;
    const x = card.rect.x - panX;
    const y = card.rect.y - panY;
    const inner = Math.max(1, card.rect.width - 2);
    write(grid, x, y, `┌${"─".repeat(inner)}┐`);
    write(grid, x, y + 1, `│${clipped(card.label, inner)}│`);
    write(grid, x, y + 2, `│${clipped(card.state, inner)}│`);
    write(grid, x, y + 3, `└${"─".repeat(inner)}┘`);
    if (card.id === state.selectedId) put(grid, x, y, "▶");
  }

  return grid.map((row) => row.join("").trimEnd());
}
