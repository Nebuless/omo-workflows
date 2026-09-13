import { stripVTControlCharacters } from "node:util";

export type OverlayNodeState =
  | "pending"
  | "scheduled"
  | "running"
  | "blocked"
  | "paused"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type OverlayNode = {
  readonly id: string;
  readonly label: string;
  readonly state: OverlayNodeState;
  readonly attempt?: number;
  readonly taskId?: string;
  readonly dependsOn?: readonly string[];
  readonly taskStatus?: string;
  readonly model?: string;
  readonly turns?: number;
  readonly activity?: string;
  readonly currentTool?: string;
  readonly errorCode?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly wave?: number;
};

export type OverlayEdge = { readonly from: string; readonly to: string };

export type UnknownEdge = {
  readonly from: string;
  readonly to: string;
  readonly reason: "endpoint" | "invalid" | "incomplete";
};

export type OverlayGraph = {
  readonly runId: string;
  readonly name: string;
  readonly status?: string;
  readonly programStatus?: string;
  readonly stale: boolean;
  readonly truncated: boolean;
  readonly nodes: readonly OverlayNode[];
  readonly edges: readonly OverlayEdge[];
  readonly unknownEdges: readonly UnknownEdge[];
  readonly amendCount?: number;
  readonly counts?: Readonly<Record<string, number>>;
};

export type OverlayRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type OverlayCard = {
  readonly id: string;
  readonly label: string;
  readonly state: OverlayNodeState;
  readonly wave: number;
  readonly rect: OverlayRect;
  readonly visible: boolean;
};

export type OverlayLayout = {
  readonly orientation: "horizontal" | "vertical";
  readonly mode: "canvas" | "list";
  readonly cards: readonly OverlayCard[];
  readonly edges: readonly OverlayEdge[];
  readonly unknownEdges: readonly UnknownEdge[];
};

export type OverlayViewport = {
  readonly orientation?: "horizontal" | "vertical";
  readonly width: number;
  readonly height: number;
  readonly panX?: number;
  readonly panY?: number;
};

export type OverlayState = {
  readonly orientation?: "horizontal" | "vertical";
  readonly selectedId?: string;
  readonly query: string;
  readonly panX: number;
  readonly panY: number;
  readonly detail?: boolean;
  readonly searching?: boolean;
};

export type OverlayInput =
  | {
      readonly kind: "key";
      readonly key: "up" | "down" | "left" | "right" | "home" | "end";
    }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "backspace" }
  | {
      readonly kind: "mouse";
      readonly x: number;
      readonly y: number;
      readonly cards: readonly OverlayCard[];
    };

export type OverlayTheme = {
  readonly accent: string;
  readonly card: string;
  readonly stale: string;
  readonly incomplete: string;
};

const CARD_WIDTH = 22;
const CARD_HEIGHT = 4;
const WAVE_GAP = 8;
const ROW_GAP = 2;
const HORIZONTAL_PADDING = 4;
const MIN_CANVAS_WIDTH = 72;

function longestPathWaves(graph: OverlayGraph): ReadonlyMap<string, number> {
  const nodes = new Set(graph.nodes.map((node) => node.id));
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.id, []);
  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const parents = incoming.get(edge.to);
    if (parents !== undefined) parents.push(edge.from);
  }

  const resolved = new Map<string, number>();
  const visiting = new Set<string>();
  function resolve(nodeId: string): number {
    const known = resolved.get(nodeId);
    if (known !== undefined) return known;
    if (visiting.has(nodeId)) return 0;
    visiting.add(nodeId);
    const parents = incoming.get(nodeId) ?? [];
    const wave = parents.reduce(
      (max, parent) => Math.max(max, resolve(parent) + 1),
      0,
    );
    visiting.delete(nodeId);
    resolved.set(nodeId, wave);
    return wave;
  }

  for (const node of graph.nodes) {
    const explicit = node.wave;
    resolved.set(node.id, explicit === undefined ? resolve(node.id) : explicit);
  }
  return resolved;
}

function visible(rect: OverlayRect, viewport: OverlayViewport): boolean {
  const panX = viewport.panX ?? 0;
  const panY = viewport.panY ?? 0;
  return (
    rect.x + rect.width > panX &&
    rect.x < panX + viewport.width &&
    rect.y + rect.height > panY &&
    rect.y < panY + viewport.height
  );
}

export function layoutOverlayGraph(
  graph: OverlayGraph,
  viewport: OverlayViewport,
): OverlayLayout {
  const mode = viewport.width < MIN_CANVAS_WIDTH ? "list" : "canvas";
  const waves = longestPathWaves(graph);
  const rowsByWave = new Map<number, number>();
  const cards = graph.nodes.map((node, index) => {
    const wave = waves.get(node.id) ?? 0;
    const row = rowsByWave.get(wave) ?? 0;
    rowsByWave.set(wave, row + 1);
    const rect =
      mode === "list"
        ? {
            x: 0,
            y: index,
            width: Math.max(1, viewport.width - HORIZONTAL_PADDING * 2),
            height: 1,
          }
        : {
            x:
              HORIZONTAL_PADDING +
              (viewport.orientation === "vertical" ? row : wave) *
                (CARD_WIDTH + WAVE_GAP),
            y:
              2 +
              (viewport.orientation === "vertical" ? wave : row) *
                (CARD_HEIGHT + ROW_GAP),
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
          };
    return {
      id: node.id,
      label: node.label,
      state: node.state,
      wave,
      rect,
      visible: visible(rect, viewport),
    };
  });
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );
  const unknownEdges: UnknownEdge[] = [
    ...graph.unknownEdges,
    ...graph.edges
      .filter((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))
      .map((edge): UnknownEdge => ({ ...edge, reason: "endpoint" })),
  ];

  return {
    mode,
    cards,
    edges,
    unknownEdges,
    orientation: viewport.orientation ?? "horizontal",
  };
}

export function cleanOverlayText(value: string): string {
  return Array.from(stripVTControlCharacters(value))
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 ||
        (code >= 0x7f && code <= 0x9f) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)
        ? " "
        : character;
    })
    .join("");
}

export function defaultOverlayTheme(theme: {
  readonly accent?: string;
}): OverlayTheme {
  return {
    accent: theme.accent ?? "accent",
    card: "text",
    stale: "warning",
    incomplete: "warning",
  };
}

export { renderOverlayCanvas } from "./canvas.ts";
export { reduceOverlayInput, revealOverlaySelection } from "./navigation.ts";
