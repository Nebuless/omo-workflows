import { readFile, watch } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type {
  HerdrViewerRun,
  HerdrViewerSnapshot,
  HerdrViewerTask,
} from "./state.ts";

const statePath = process.argv[process.argv.indexOf("--state") + 1];
if (!process.argv.includes("--state") || statePath === undefined) {
  throw new Error("Usage: bun viewer.ts --state PATH");
}

const viewPath = `${statePath}.view.json`;
const once = process.argv.includes("--once");
const requestedView = process.argv[process.argv.indexOf("--view") + 1];
type View = "dag" | "tasks";
type ViewState = {
  readonly runId?: string;
  readonly view: View;
  readonly expanded: readonly string[];
};
let view: View = requestedView === "tasks" ? "tasks" : "dag";
let selected = 0;
const expanded = new Set<string>();
let snapshot: HerdrViewerSnapshot | undefined;
let redrawQueued = false;

function clean(value: string): string {
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

function fit(value: string, width: number): string {
  const text = clean(value);
  return text.length > width
    ? `${text.slice(0, Math.max(0, width - 1))}…`
    : text;
}

function selectedRun(): HerdrViewerRun | undefined {
  return snapshot?.runs[selected];
}

function selectedTask(): HerdrViewerTask | undefined {
  return snapshot?.tasks[selected];
}

function taskLine(task: HerdrViewerTask, width: number): string {
  return `${view === "tasks" && selectedTask()?.id === task.id ? ">" : " "} ${fit(task.id, width - 26)} ${task.status} ${fit(task.model ?? "", 12)} ${task.turns ?? 0}t`;
}

function runLines(run: HerdrViewerRun, width: number): string[] {
  const detail = expanded.has(run.id);
  const status = run.stale ? "stale" : run.status;
  const lines = [
    `${view === "dag" && selectedRun()?.id === run.id ? ">" : " "} ${fit(run.name, width - 22)} ${status} ${run.nodes.length} nodes`,
  ];
  if (run.programStatus !== undefined)
    lines.push(
      `  program: ${fit(run.programStatus, width - 11)}  native: ${status}`,
    );
  if (!detail) return lines;
  for (const node of run.nodes) {
    lines.push(
      `  ${node.state.padEnd(10)} ${fit(node.label, width - 17)} #${node.attempt}`,
    );
    if (
      node.taskStatus !== undefined ||
      node.model !== undefined ||
      node.turns !== undefined
    ) {
      lines.push(
        `    task ${node.taskStatus ?? "unknown"} ${fit(node.model ?? "", width - 31)} ${node.turns ?? 0} turns`,
      );
    }
    if (node.errorCode !== undefined)
      lines.push(`    error code: ${fit(node.errorCode, width - 16)}`);
  }
  for (const edge of run.edges)
    lines.push(`  ${fit(edge.from, 20)} -> ${fit(edge.to, 20)}`);
  for (const edge of run.unknownEdges)
    lines.push(`  ? ${fit(edge.from, 20)} -> ${fit(edge.to, 20)}`);
  return lines;
}

function currentItems(): readonly { readonly id: string }[] {
  return view === "dag" ? (snapshot?.runs ?? []) : (snapshot?.tasks ?? []);
}

function saveView(): void {
  const state: ViewState = {
    ...(view === "dag" && selectedRun() !== undefined
      ? { runId: selectedRun()?.id }
      : {}),
    view,
    expanded: [...expanded],
  };
  void writeFile(viewPath, `${JSON.stringify(state)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  }).catch(() => undefined);
}

function restoreView(): void {
  readFile(viewPath, "utf8", (error, text) => {
    if (error !== null) return;
    try {
      const stored = JSON.parse(text) as ViewState;
      if (stored.view === "dag" || stored.view === "tasks") view = stored.view;
      if (Array.isArray(stored.expanded))
        for (const id of stored.expanded)
          if (typeof id === "string") expanded.add(id);
      if (typeof stored.runId === "string") {
        const index =
          snapshot?.runs.findIndex((run) => run.id === stored.runId) ?? -1;
        if (index >= 0) selected = index;
      }
      render();
    } catch {}
  });
}

function render(): void {
  const width = Math.max(30, process.stdout.columns ?? 72);
  const rows = Math.max(8, process.stdout.rows ?? 24);
  const title = view === "dag" ? "DAG runs" : "Standalone tasks";
  const header = [
    "OMO workflow graph",
    snapshot === undefined
      ? "Waiting for graph state"
      : `${snapshot.stale ? "STALE" : "LIVE"}${snapshot.truncated ? " TRUNCATED" : ""}  ${snapshot.runs.length} runs  ${snapshot.tasks.length} tasks`,
    `${title}  t switch  j/k select  enter fold  q close`,
    "",
  ];
  const body =
    view === "dag"
      ? (snapshot?.runs.flatMap((run) => runLines(run, width)) ?? [
          "No workflow runs yet.",
        ])
      : (snapshot?.tasks.map((task) => taskLine(task, width)) ?? [
          "No standalone tasks yet.",
        ]);
  const lines = [...header, ...body].slice(0, rows);
  if (process.stdout.isTTY) {
    process.stdout.write(
      `\x1b[H${lines.map((line) => `${fit(line, width)}\x1b[K`).join("\r\n")}\x1b[J`,
    );
  } else {
    process.stdout.write(`${lines.join("\n")}\n`);
  }
}

function load(): void {
  readFile(statePath, "utf8", (error, text) => {
    if (error === null) {
      try {
        const next = JSON.parse(text) as HerdrViewerSnapshot;
        if (
          next.version === 1 &&
          Array.isArray(next.runs) &&
          Array.isArray(next.tasks)
        ) {
          snapshot = next;
          selected = Math.min(selected, Math.max(0, currentItems().length - 1));
        }
      } catch {}
    }
    render();
    if (once) process.exit(0);
  });
}

function refresh(): void {
  if (redrawQueued) return;
  redrawQueued = true;
  queueMicrotask(() => {
    redrawQueued = false;
    load();
  });
}

if (process.stdout.isTTY && process.stdin.isTTY) {
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (chunk: Buffer) => {
    const key = chunk.toString("utf8");
    if (key === "q" || key === "\u0003") process.exit(0);
    if (key === "t") {
      view = view === "dag" ? "tasks" : "dag";
      selected = 0;
      saveView();
    }
    if (key === "j" || key === "\u001b[B")
      selected = Math.min(Math.max(0, currentItems().length - 1), selected + 1);
    if (key === "k" || key === "\u001b[A") selected = Math.max(0, selected - 1);
    if (key === "\u001b[C")
      selected = Math.min(Math.max(0, currentItems().length - 1), selected + 1);
    if (key === "\u001b[D") selected = Math.max(0, selected - 1);
    if ((key === "\r" || key === " ") && view === "dag") {
      const run = selectedRun();
      if (run !== undefined)
        expanded.has(run.id) ? expanded.delete(run.id) : expanded.add(run.id);
    }
    saveView();
    render();
  });
  process.on("exit", () => process.stdout.write("\x1b[?25h\x1b[?1049l"));
}

if (!once) {
  watch(dirname(statePath), (_event, filename) => {
    if (
      filename !== null &&
      filename.toString() !== basename(statePath) &&
      filename.toString() !== statePath
    )
      return;
    refresh();
  });
  process.stdout.on("resize", render);
  restoreView();
}
load();
