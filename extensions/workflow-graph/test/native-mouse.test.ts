import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Terminal, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { OverlayState } from "../src/overlay/model.ts";
import {
  repairWorkflowMouse,
  SENPI_TUI_VERSION,
  TUI_ALT_SCREEN_FILE,
} from "../../../scripts/lib/workflow-mouse-patch.ts";

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const path of temporaryPaths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

class TestTerminal implements Terminal {
  columns = 100;
  rows = 18;
  kittyProtocolActive = true;
  private input: ((data: string) => void) | undefined;
  start(input: (data: string) => void) {
    this.input = input;
  }
  stop() {
    this.input = undefined;
  }
  drainInput() {
    return Promise.resolve();
  }
  write() {}
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
  send(data: string) {
    this.input?.(data);
  }
}

describe("current native Senpi mouse dispatch", () => {
  test("unmodified TuiAltScreen delivers local press, captured drag and wheel once", async () => {
    const { TuiAltScreen } = await import("@earendil-works/pi-tui");
    const { WorkflowGraphComponent } = await import(
      "../src/overlay/component.ts"
    );
    const terminal = new TestTerminal();
    const tui = new TuiAltScreen(terminal, false, undefined, {
      wheelScrollLines: 1,
      copyOnSelect: false,
    });
    tui.addChild({
      render: () =>
        Array.from({ length: 30 }, (_, i) => `Transcript line ${i}`),
      invalidate() {},
    });
    let state: OverlayState = { query: "", panX: 0, panY: 0 };
    let updates = 0;
    class Overlay extends WorkflowGraphComponent {
      readonly mouse: TuiMouseEvent[] = [];
      readonly inputs: string[] = [];
      override handleMouse(event: TuiMouseEvent) {
        this.mouse.push(event);
        return super.handleMouse(event);
      }
      override handleInput(data: string) {
        this.inputs.push(data);
        super.handleInput(data);
      }
    }
    const overlay = new Overlay(
      {
        runId: "mouse",
        name: "Mouse",
        stale: false,
        truncated: false,
        nodes: Array.from({ length: 12 }, (_, i) => ({
          id: String(i),
          label: `Node ${i}`,
          state: "running" as const,
        })),
        edges: [],
        unknownEdges: [],
      },
      { terminal: { rows: 14 }, requestRender: () => tui.requestRender() },
      undefined,
      undefined,
      state,
      (next) => {
        state = next;
        updates += 1;
      },
      () => {},
    );
    tui.start();
    try {
      tui.renderNow(true);
      const handle = tui.showOverlay(overlay, {
        width: 80,
        maxHeight: 14,
        col: 10,
        row: 2,
        margin: 0,
      });
      tui.renderNow(true);
      expect(handle.getBounds()).toEqual({
        col: 10,
        row: 2,
        width: 80,
        height: 14,
      });
      const top = tui.viewportTop;
      terminal.send("\x1b[<65;20;7M");
      expect(state.panY).toBe(1);
      expect(overlay.mouse[0]).toMatchObject({
        type: "wheel",
        x: 9,
        y: 4,
        wheelDelta: 1,
      });
      expect(tui.viewportTop).toBe(top);

      terminal.send("\x1b[<0;90;15M");
      expect(state.panY).toBe(62);
      terminal.send("\x1b[<32;1;1M");
      expect(state.panY).toBe(0);
      terminal.send("\x1b[<0;1;1m");
      expect(overlay.mouse.at(-1)).toMatchObject({
        type: "release",
        x: -10,
        y: -2,
      });

      const beforeClick = updates;
      terminal.send("\x1b[<0;16;8M");
      terminal.send("\x1b[<0;16;8m");
      expect(state).toMatchObject({ selectedId: "0", detail: true });
      expect(updates).toBe(beforeClick + 1);
      expect(overlay.mouse.slice(-3).map((event) => event.type)).toEqual([
        "press",
        "release",
        "click",
      ]);
      expect(overlay.inputs).toEqual([]);

      handle.unfocus({ target: null });
      terminal.send("\x1b[<65;20;7M");
      expect(state.panY).toBeGreaterThan(0);
      expect(handle.isFocused()).toBe(false);
      expect(tui.viewportTop).toBe(top);
      const delivered = overlay.mouse.length;
      terminal.send("\x1b[<0;2;2M");
      terminal.send("\x1b[<32;8;2M");
      terminal.send("\x1b[<0;8;2m");
      expect(tui.hasActiveSelection()).toBe(true);
      terminal.send("\x1b[<64;2;2M");
      expect(tui.viewportTop).toBe(top - 1);
      expect(overlay.mouse).toHaveLength(delivered);
      expect(overlay.inputs).toEqual([]);

      handle.focus();
      terminal.send("v");
      expect(state.orientation).toBe("vertical");
      expect(overlay.inputs).toEqual(["v"]);
    } finally {
      tui.stop();
    }
  });
});

test("historical mouse repair rejects unknown version and hash without old installed packages", () => {
  const root = mkdtempSync(join(tmpdir(), "senpi-mouse-rejection-"));
  temporaryPaths.push(root);
  mkdirSync(join(root, "dist"));
  const target = join(root, TUI_ALT_SCREEN_FILE);
  const original = "unrecognized runtime bytes";
  writeFileSync(target, original);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: "unknown" }),
  );
  expect(() => repairWorkflowMouse(root)).toThrow(
    "Expected @earendil-works/pi-tui",
  );
  expect(readFileSync(target, "utf8")).toBe(original);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: SENPI_TUI_VERSION }),
  );
  expect(() => repairWorkflowMouse(root)).toThrow(
    "Unknown dist/tui-alt-screen.js SHA-256",
  );
  expect(readFileSync(target, "utf8")).toBe(original);
});
