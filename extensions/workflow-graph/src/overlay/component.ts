import {
  decodeKittyPrintable,
  parseKey,
  type Component,
} from "@earendil-works/pi-tui";
import type { OverlayActions, OverlayTui } from "./controller.ts";
import { navigateOverlay } from "./navigation.ts";
import { pointerOverlay } from "./pointer.ts";
import {
  cleanOverlayText,
  layoutOverlayGraph,
  reduceOverlayInput,
  revealOverlaySelection,
  type OverlayGraph,
  type OverlayState,
} from "./model.ts";
import { graphViewportHeight, renderOverlayFrame } from "./frame.ts";

export class WorkflowGraphComponent implements Component {
  private graph: OverlayGraph;
  private state: OverlayState;
  private notice = "";
  private viewport = { width: 48, height: 22 };
  private readonly runs = new Map<string, OverlayGraph>();

  constructor(
    graph: OverlayGraph,
    private readonly tui: OverlayTui,
    private readonly actions: OverlayActions | undefined,
    private readonly onSelectRun: ((runId: string) => OverlayGraph) | undefined,
    initialState: OverlayState,
    private readonly onState: (state: OverlayState) => void,
    private readonly onDismiss: () => void,
  ) {
    this.graph = graph;
    this.state = { ...initialState };
    this.runs.set(graph.runId, graph);
  }

  private setState(
    next: OverlayState,
    reveal = next.selectedId !== this.state.selectedId,
  ): void {
    const viewport = { ...this.viewport, orientation: next.orientation };
    const selected =
      reveal && !next.searching
        ? revealOverlaySelection(next, this.graph, viewport)
        : next;
    const { cards, mode } = layoutOverlayGraph(this.graph, viewport);
    const right = Math.max(
      0,
      ...cards.map((card) => card.rect.x + card.rect.width),
    );
    const bottom = Math.max(
      0,
      ...cards.map((card) => card.rect.y + card.rect.height),
    );
    this.state = {
      ...selected,
      panX:
        mode === "list"
          ? 0
          : Math.max(0, Math.min(selected.panX, right - this.viewport.width)),
      panY: Math.max(0, Math.min(selected.panY, bottom - this.viewport.height)),
    };
    this.onState({ ...this.state });
  }

  setGraph(graph: OverlayGraph): void {
    this.runs.set(graph.runId, graph);
    if (this.graph.runId === "" && graph.runId !== "") this.runs.delete("");
    if (graph.runId === this.graph.runId || this.graph.runId === "")
      this.graph = graph;
    if (
      this.state.selectedId !== undefined &&
      !this.graph.nodes.some((node) => node.id === this.state.selectedId)
    ) {
      this.setState({ ...this.state, selectedId: undefined, detail: false });
    }
    this.tui.requestRender();
  }

  private invoke(
    action: ((runId: string, nodeId: string) => Promise<string>) | undefined,
  ): void {
    const nodeId = this.state.selectedId;
    if (nodeId === undefined || action === undefined) return;
    void action(this.graph.runId, nodeId).then((notice) => {
      this.notice = cleanOverlayText(notice);
      this.tui.requestRender();
    });
  }

  private invokeRun(
    action: ((runId: string) => Promise<string>) | undefined,
  ): void {
    if (action === undefined) return;
    void action(this.graph.runId).then((notice) => {
      this.notice = cleanOverlayText(notice);
      this.tui.requestRender();
    });
  }

  private switchRun(direction: number): void {
    const ids = [...this.runs.keys()];
    if (ids.length < 2) return;
    const current = Math.max(0, ids.indexOf(this.graph.runId));
    const next = ids[(current + direction + ids.length) % ids.length];
    if (next === undefined) return;
    this.graph = this.onSelectRun?.(next) ?? this.runs.get(next) ?? this.graph;
    this.setState({ query: "", panX: 0, panY: 0 });
  }

  handleInput(input: string): void {
    const key = parseKey(input);
    const data = decodeKittyPrintable(input) ?? input;
    if (this.state.searching && (key === "escape" || key === "enter")) {
      const match = this.graph.nodes.some(
        (node) =>
          node.id === this.state.selectedId &&
          cleanOverlayText(node.label)
            .toLowerCase()
            .includes(this.state.query.toLowerCase()),
      );
      this.setState({
        ...this.state,
        query: "",
        searching: false,
        detail: key === "enter" && match,
      });
      this.tui.requestRender();
      return;
    }
    if (
      key === "escape" ||
      key === "ctrl+x" ||
      (!this.state.searching && data === "h")
    ) {
      this.onDismiss();
      return;
    }
    if (this.state.searching && data.length === 1 && data >= " ") {
      this.setState(
        reduceOverlayInput(this.state, this.graph, {
          kind: "text",
          text: data,
        }),
      );
    } else if (key === "enter" || data === " ") {
      this.setState({
        ...this.state,
        detail: !this.state.detail,
        searching: false,
      });
    } else if (data === "/") {
      this.setState({
        ...this.state,
        query: "",
        searching: true,
        selectedId: this.graph.nodes[0]?.id,
      });
    } else if (data === "[") {
      this.switchRun(-1);
    } else if (data === "]") {
      this.switchRun(1);
    } else if (data === "o") {
      const taskId = this.graph.nodes.find(
        (node) => node.id === this.state.selectedId,
      )?.taskId;
      const taskStatus = this.actions?.taskStatus;
      if (taskId !== undefined && taskStatus !== undefined) {
        void taskStatus(taskId).then((notice) => {
          this.notice = cleanOverlayText(notice);
          this.tui.requestRender();
        });
      }
    } else if (data === "s") {
      this.invoke(this.actions?.steer);
    } else if (data === "r") {
      this.invoke(this.actions?.retry);
    } else if (data === "c") {
      this.invokeRun(this.actions?.cancel);
    } else if (data === "x") {
      this.invokeRun(this.actions?.snapshot);
    } else if (key === "backspace") {
      this.setState(
        reduceOverlayInput(this.state, this.graph, {
          kind: "backspace",
        }),
      );
    } else if (data === "v") {
      this.setState(
        {
          ...this.state,
          orientation:
            this.state.orientation === "vertical" ? "horizontal" : "vertical",
          panX: 0,
          panY: 0,
        },
        true,
      );
    } else if (
      !this.state.searching &&
      (key === "up" || key === "down" || key === "left" || key === "right")
    ) {
      this.setState(
        navigateOverlay(
          this.state,
          layoutOverlayGraph(this.graph, {
            ...this.viewport,
            orientation: this.state.orientation,
          }),
          key,
        ),
      );
    } else if (key === "up" || key === "down" || data === "j" || data === "k") {
      this.setState(
        reduceOverlayInput(this.state, this.graph, {
          kind: "key",
          key: key === "up" || data === "k" ? "up" : "down",
        }),
      );
    } else if (key === "pageUp") {
      this.setState({ ...this.state, panY: Math.max(0, this.state.panY - 8) });
    } else if (key === "pageDown") {
      this.setState({ ...this.state, panY: this.state.panY + 8 });
    } else if (data.startsWith("\u001b[<")) {
      this.setState(
        pointerOverlay(data, this.graph, {
          state: this.state,
          viewport: this.viewport,
        }),
      );
    } else if (data === "g") {
      this.setState(
        reduceOverlayInput(this.state, this.graph, {
          kind: "key",
          key: "home",
        }),
      );
    } else if (data === "G") {
      this.setState(
        reduceOverlayInput(this.state, this.graph, {
          kind: "key",
          key: "end",
        }),
      );
    } else if (data.length === 1 && data >= " ") {
      this.setState(
        reduceOverlayInput(this.state, this.graph, {
          kind: "text",
          text: data,
        }),
      );
    } else {
      return;
    }
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const height = graphViewportHeight(
      this.tui.terminal?.rows,
      this.state.detail && !this.state.searching,
    );
    if (width !== this.viewport.width || height !== this.viewport.height) {
      this.viewport = { width, height };
      this.setState(this.state, true);
    }
    return renderOverlayFrame(this.graph, this.state, {
      runs: [...this.runs.values()],
      notice: this.notice,
      actions: this.actions,
      width,
      height: this.tui.terminal?.rows,
    });
  }

  invalidate(): void {}
}
