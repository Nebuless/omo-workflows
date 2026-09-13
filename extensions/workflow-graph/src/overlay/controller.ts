import type { ExtensionUIContext } from "@code-yeongyu/senpi";
import type { OverlayHandle, OverlayOptions } from "@earendil-works/pi-tui";
import type { OverlayGraph, OverlayState } from "./model.ts";
import { WorkflowGraphComponent } from "./component.ts";
export { WorkflowGraphComponent } from "./component.ts";

export interface OverlayTui {
  readonly terminal?: { readonly rows: number };
  requestRender(): void;
}

export interface OverlayActions {
  readonly taskStatus?: (taskId: string) => Promise<string>;
  readonly steer?: (runId: string, nodeId: string) => Promise<string>;
  readonly retry?: (runId: string, nodeId: string) => Promise<string>;
  readonly cancel?: (runId: string) => Promise<string>;
  readonly snapshot?: (runId: string) => Promise<string>;
}

export interface OverlayContext {
  readonly mode: "tui" | "rpc" | "app-server" | "json" | "print";
  readonly ui?: Pick<ExtensionUIContext, "custom">;
  readonly actions?: OverlayActions;
  readonly onSelectRun?: (runId: string) => OverlayGraph;
}

export interface WorkflowGraphOverlayController {
  show(graph: OverlayGraph): boolean;
  update(graph: OverlayGraph): void;
  hide(): void;
  dispose(): void;
}

const OVERLAY_OPTIONS: {
  readonly overlay: true;
  readonly overlayOptions: OverlayOptions;
} = {
  overlay: true,
  overlayOptions: {
    width: "100%",
    maxHeight: "100%",
    margin: 0,
    anchor: "center",
  },
};

export function createOverlayController(
  context: OverlayContext,
): WorkflowGraphOverlayController {
  let handle: OverlayHandle | undefined;
  let component: WorkflowGraphComponent | undefined;
  const graphs = new Map<string, OverlayGraph>();
  let opened = false;
  let savedState: OverlayState = { query: "", panX: 0, panY: 0 };

  function hide(): void {
    handle?.setHidden(true);
  }

  return {
    show(graph: OverlayGraph): boolean {
      graphs.set(graph.runId, graph);
      if (context.mode !== "tui" || context.ui === undefined) return false;
      if (opened) {
        component?.setGraph(graph);
        handle?.setHidden(false);
        handle?.focus();
        return true;
      }
      opened = true;
      void context.ui.custom(
        (tui, _theme, _keybindings) => {
          component = new WorkflowGraphComponent(
            graph,
            tui,
            context.actions,
            context.onSelectRun,
            savedState,
            (state) => {
              savedState = state;
            },
            hide,
          );
          for (const cached of graphs.values()) component.setGraph(cached);
          return component;
        },
        {
          ...OVERLAY_OPTIONS,
          onHandle(nextHandle): void {
            handle = nextHandle;
            if (!opened) handle.setHidden(true);
          },
        },
      );
      return true;
    },
    update(graph): void {
      graphs.set(graph.runId, graph);
      component?.setGraph(graph);
    },
    hide,
    dispose(): void {
      opened = false;
      handle?.hide();
      handle = undefined;
      component = undefined;
    },
  };
}
