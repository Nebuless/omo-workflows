import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  POSTIMAGE_SHA256,
  PREIMAGE_SHA256,
  repairWorkflowMouse,
  SENPI_TUI_VERSION,
  sha256,
  TUI_ALT_SCREEN_FILE,
} from "../../../scripts/lib/workflow-mouse-patch.ts";

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const path of temporaryPaths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function installedPackage(): string {
  return dirname(dirname(require.resolve("@earendil-works/pi-tui")));
}

function copiedPackage(): string {
  const root = mkdtempSync(join(tmpdir(), "senpi-mouse-package-"));
  temporaryPaths.push(root);
  cpSync(installedPackage(), root, { recursive: true });
  symlinkSync(join(process.cwd(), "node_modules"), join(root, "node_modules"));
  return root;
}

async function exerciseNativeTui(packageRoot: string): Promise<unknown> {
  const runner = join(packageRoot, "native-mouse-runner.mjs");
  writeFileSync(
    runner,
    String.raw`
import { TuiAltScreen } from "./dist/tui-alt-screen.js";
class Terminal {
  columns = 20; rows = 4; kittyProtocolActive = true; input;
  start(input) { this.input = input; }
  stop() { this.input = undefined; }
  drainInput() { return Promise.resolve(); }
  write() {} moveBy() {} hideCursor() {} showCursor() {} clearLine() {}
  clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
  send(data) { this.input?.(data); }
}
class Component {
  focused = false; inputs = [];
  constructor(lines) { this.lines = lines; }
  render() { return this.lines; }
  invalidate() {}
  handleInput(data) { this.inputs.push(data); }
}
const terminal = new Terminal();
const tui = new TuiAltScreen(terminal);
tui.addChild(new Component(["abcdefghij", "line 2", "line 3", "line 4", "line 5", "line 6"]));
tui.start();
tui.renderNow(true);
const overlay = new Component(["overlay"]);
const handle = tui.showOverlay(overlay);
tui.renderNow(true);
const topBeforeFocused = tui.viewportTop;
const click = "\x1b[<0;2;2M";
const wheel = "\x1b[<64;2;2M";
terminal.send(click);
terminal.send(wheel);
const focused = { inputs: [...overlay.inputs], topBeforeFocused, topAfterFocused: tui.viewportTop };
overlay.inputs.length = 0;
handle.unfocus({ target: null });
terminal.send("\x1b[<0;2;2M");
terminal.send("\x1b[<32;5;2M");
terminal.send("\x1b[<0;5;2m");
const selected = tui.hasActiveSelection();
const topBeforeWheel = tui.viewportTop;
terminal.send(wheel);
const unfocused = { inputs: [...overlay.inputs], selected, topBeforeWheel, topAfterWheel: tui.viewportTop };
tui.stop();
console.log(JSON.stringify({ focused, unfocused }));
`,
  );
  const child = Bun.spawn([process.execPath, runner], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(child.stdout).text();
  const error = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) throw new Error(error);
  return JSON.parse(output.trim());
}

describe("native Senpi TUI mouse repair", () => {
  test("pins installed bytes, defaults to check-only, and applies exact idempotent postimage", () => {
    const packageRoot = copiedPackage();
    const target = join(packageRoot, TUI_ALT_SCREEN_FILE);
    expect(SENPI_TUI_VERSION).toBe("2026.9.10-2");
    expect(sha256(readFileSync(target))).toBe(PREIMAGE_SHA256);

    const checked = repairWorkflowMouse(packageRoot);
    expect(checked).toEqual({
      file: target,
      version: SENPI_TUI_VERSION,
      before: PREIMAGE_SHA256,
      after: POSTIMAGE_SHA256,
      changed: false,
    });
    expect(sha256(readFileSync(target))).toBe(PREIMAGE_SHA256);

    expect(repairWorkflowMouse(packageRoot, true).changed).toBeTrue();
    expect(sha256(readFileSync(target))).toBe(POSTIMAGE_SHA256);
    expect(repairWorkflowMouse(packageRoot, true)).toEqual({
      file: target,
      version: SENPI_TUI_VERSION,
      before: POSTIMAGE_SHA256,
      after: POSTIMAGE_SHA256,
      changed: false,
    });
  });

  test("rejects unknown version and bytes without mutation", () => {
    const packageRoot = copiedPackage();
    const target = join(packageRoot, TUI_ALT_SCREEN_FILE);
    const original = readFileSync(target);
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ version: "unknown" }),
    );
    expect(() => repairWorkflowMouse(packageRoot, true)).toThrow(
      "Expected @earendil-works/pi-tui",
    );
    expect(readFileSync(target)).toEqual(original);

    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ version: SENPI_TUI_VERSION }),
    );
    writeFileSync(target, Buffer.concat([original, Buffer.from("corrupt")]));
    const corrupt = readFileSync(target);
    expect(() => repairWorkflowMouse(packageRoot, true)).toThrow(
      "Unknown dist/tui-alt-screen.js SHA-256",
    );
    expect(readFileSync(target)).toEqual(corrupt);
  });

  test("real patched TuiAltScreen defers focused clicks while native unfocused selection and wheel stay owned", async () => {
    const packageRoot = copiedPackage();
    repairWorkflowMouse(packageRoot, true);
    expect(await exerciseNativeTui(packageRoot)).toEqual({
      focused: {
        inputs: ["\x1b[<0;2;2M", "\x1b[<64;2;2M"],
        topBeforeFocused: 2,
        topAfterFocused: 2,
      },
      unfocused: {
        inputs: [],
        selected: true,
        topBeforeWheel: 2,
        topAfterWheel: 1,
      },
    });
  });
});
