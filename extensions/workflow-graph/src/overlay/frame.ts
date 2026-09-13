import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { OverlayActions } from "./controller.ts";
import {
  cleanOverlayText,
  layoutOverlayGraph,
  renderOverlayCanvas,
  type OverlayGraph,
  type OverlayNode,
  type OverlayState,
} from "./model.ts";

export function workflowProgress(graph: OverlayGraph) {
  const terminal = ["completed", "failed", "cancelled", "skipped"];
  const total = Math.max(0, graph.counts?.total ?? graph.nodes.length);
  const finished = Math.min(
    total,
    Math.max(
      0,
      graph.counts === undefined
        ? graph.nodes.filter((node) => terminal.includes(node.state)).length
        : terminal.reduce(
            (sum, state) => sum + (graph.counts?.[state] ?? 0),
            0,
          ),
    ),
  );
  return {
    finished,
    total,
    percent: total === 0 ? 0 : Math.floor((finished * 100) / total),
  };
}

export function nodeDuration(
  node: OverlayNode | undefined,
): number | undefined {
  if (node?.startedAt === undefined || node.completedAt === undefined)
    return undefined;
  const duration = Date.parse(node.completedAt) - Date.parse(node.startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function displayState(state: OverlayState): string {
  return state.query.length === 0
    ? "all nodes"
    : `filter: ${cleanOverlayText(state.query)}`;
}

export function graphViewportHeight(
  rows: number | undefined,
  detail: boolean | undefined,
): number {
  return Math.max(1, (rows ?? 26) - 4 - (detail ? 8 : 0));
}

export function stageSwitcherNodes(
  graph: OverlayGraph,
  state: OverlayState,
  height = 10,
) {
  const nodes = graph.nodes.filter((node) =>
    cleanOverlayText(node.label)
      .toLowerCase()
      .includes(state.query.toLowerCase()),
  );
  const selected = Math.max(
    0,
    nodes.findIndex((node) => node.id === state.selectedId),
  );
  const capacity = Math.max(1, Math.min(8, height - 2));
  const start = Math.max(0, selected - Math.floor(capacity / 2));
  return nodes.slice(start, start + capacity);
}

function renderStageSwitcher(
  graph: OverlayGraph,
  state: OverlayState,
  viewport: { readonly width: number; readonly height: number },
): string[] {
  const nodes = stageSwitcherNodes(graph, state, viewport.height);
  return [
    `Stages / ${cleanOverlayText(state.query)}`,
    ...nodes.map(
      (node) =>
        `${node.id === state.selectedId ? ">" : " "} [${node.state}] ${cleanOverlayText(node.label)}`,
    ),
    ...(nodes.length === 0 ? ["(no matches)"] : []),
    "Up/Down select  Enter detail  Esc close",
  ].map((line) => truncateToWidth(line, Math.max(0, viewport.width)));
}

export function renderOverlayFrame(
  graph: OverlayGraph,
  state: OverlayState,
  view: {
    readonly runs: readonly OverlayGraph[];
    readonly notice: string;
    readonly actions?: OverlayActions;
    readonly width: number;
    readonly height?: number;
  },
): string[] {
  const { runs, notice, actions, width } = view;
  const viewport = {
    width,
    height: graphViewportHeight(view.height, state.detail && !state.searching),
  };
  const graphLines = state.searching
    ? renderStageSwitcher(graph, state, viewport)
    : renderOverlayCanvas(graph, state, {
        width: viewport.width,
        height: viewport.height,
        panX: state.panX,
        panY: state.panY,
        orientation: state.orientation,
      });
  const { cards } = layoutOverlayGraph(graph, {
    ...viewport,
    orientation: state.orientation,
  });
  const contentHeight = Math.max(
    0,
    ...cards.map((card) => card.rect.y + card.rect.height),
  );
  const contentWidth = Math.max(
    0,
    ...cards.map((card) => card.rect.x + card.rect.width),
  );
  const horizontalSize = Math.max(
    1,
    Math.floor((width * width) / Math.max(1, contentWidth)),
  );
  const horizontalStart = Math.round(
    (state.panX * (width - horizontalSize)) / Math.max(1, contentWidth - width),
  );
  const thumbSize = Math.max(
    1,
    Math.floor(
      (viewport.height * viewport.height) / Math.max(1, contentHeight),
    ),
  );
  const thumbStart = Math.round(
    (state.panY * (viewport.height - thumbSize)) /
      Math.max(1, contentHeight - viewport.height),
  );
  const status = graph.stale
    ? "STALE: waiting for OMO snapshot"
    : graph.truncated
      ? "INCOMPLETE: snapshot truncated"
      : "live projection";
  const selected = graph.nodes.find((node) => node.id === state.selectedId);
  const progress = workflowProgress(graph);
  const duration = nodeDuration(selected);
  const runSummary = [
    graph.status === undefined ? undefined : cleanOverlayText(graph.status),
    `${progress.finished}/${progress.total} finished (${progress.percent}%)`,
    graph.counts === undefined
      ? undefined
      : Object.entries(graph.counts)
          .filter(([key, value]) => key !== "total" && value > 0)
          .map(([key, value]) => `${cleanOverlayText(key)}:${value}`)
          .join(" "),
    graph.amendCount === undefined || graph.amendCount === 0
      ? undefined
      : `amends:${graph.amendCount}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join("  ");
  const lines = [
    `${graph.programStatus === undefined ? "Workflow graph" : `Program ${cleanOverlayText(graph.programStatus)}${graph.programStatus === "gate" ? " (/workflow-run answer)" : ""}`}  ${cleanOverlayText(graph.name)}`,
    `${status}  ${runSummary}  ${displayState(state)}  selected: ${cleanOverlayText(selected?.id ?? "none")}`,
    !state.searching && contentWidth > width
      ? Array.from({ length: width }, (_, col) =>
          col >= horizontalStart && col < horizontalStart + horizontalSize
            ? "█"
            : "─",
        ).join("")
      : runs.length > 1
        ? `runs: ${runs.map((run) => `${run.runId === graph.runId ? ">" : " "}${cleanOverlayText(run.name)}`).join("  ")}`
        : "",
    ...graphLines.map((line, index) => {
      if (state.searching || contentHeight <= viewport.height) return line;
      return (
        truncateToWidth(line, Math.max(0, width - 1), "", true) +
        (index >= thumbStart && index < thumbStart + thumbSize ? "█" : "│")
      );
    }),
  ];
  if (!state.searching && state.detail && selected !== undefined) {
    lines.push(
      "",
      `Node ${cleanOverlayText(selected.id)}: ${cleanOverlayText(selected.label)}`,
      `status: ${selected.state}  attempt: ${selected.attempt ?? 0}${duration === undefined ? "" : `  duration: ${(duration / 1000).toFixed(1)}s`}`,
    );
    if (selected.errorCode !== undefined)
      lines.push(`error code: ${cleanOverlayText(selected.errorCode)}`);
    if (selected.activity !== undefined)
      lines.push(`activity: ${cleanOverlayText(selected.activity)}`);
    if (selected.currentTool !== undefined)
      lines.push(`tool: ${cleanOverlayText(selected.currentTool)}`);
    if (
      selected.taskStatus !== undefined ||
      selected.model !== undefined ||
      selected.turns !== undefined
    ) {
      lines.push(
        `task: ${cleanOverlayText(selected.taskStatus ?? "unknown")}  ${cleanOverlayText(selected.model ?? "unknown model")}  ${selected.turns ?? 0} turns`,
      );
    }
    if ((selected.dependsOn?.length ?? 0) > 0)
      lines.push(
        `depends on: ${selected.dependsOn?.map(cleanOverlayText).join(", ")}`,
      );
  }
  const hints = [
    "Esc hide",
    "[/] runs",
    "/ filter",
    "arrows select",
    "j/k order",
    "v orient",
    "PgUp/PgDn scroll",
    "Enter detail",
    "mouse select",
    ...(actions?.taskStatus === undefined ? [] : ["o task status"]),
    ...(actions?.snapshot === undefined ? [] : ["x refresh"]),
    ...(actions?.steer === undefined ? [] : ["s steer"]),
    ...(actions?.retry === undefined ? [] : ["r retry"]),
    ...(actions?.cancel === undefined ? [] : ["c cancel"]),
  ];
  const feedback = [
    notice.length > 0 ? cleanOverlayText(notice) : "",
    graph.unknownEdges.length > 0
      ? `? ${graph.unknownEdges.length} unknown edge(s)`
      : "",
  ]
    .filter(Boolean)
    .join("  ");
  const footer =
    feedback.length > 0
      ? `${feedback}  |  ${hints.join("  ")}`
      : hints.join("  ");
  if (view.height !== undefined) {
    const height = Math.max(1, view.height);
    lines.length = Math.min(lines.length, height - 1);
    while (lines.length < height - 1) lines.push("");
  }
  lines.push(footer);
  return lines.map((line) => {
    const clipped = truncateToWidth(line, Math.max(0, width));
    return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  });
}
