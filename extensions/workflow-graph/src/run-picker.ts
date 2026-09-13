import type { ExtensionUIContext } from "@code-yeongyu/senpi";
import type { ProjectedRun } from "./contracts.ts";
import { cleanOverlayText } from "./overlay/model.ts";

export async function pickWorkflowRun(
  runs: readonly ProjectedRun[],
  query: string,
  ui: Pick<ExtensionUIContext, "select" | "notify">,
): Promise<string | undefined> {
  const filter = query.trim().toLowerCase();
  const terminal = (run: ProjectedRun) =>
    ["completed", "failed", "cancelled"].includes(run.status);
  const rows = runs
    .filter(
      (run) =>
        run.name.toLowerCase().includes(filter) ||
        run.runId.toLowerCase().includes(filter),
    )
    .sort(
      (a, b) =>
        Number(terminal(a)) - Number(terminal(b)) ||
        (terminal(a)
          ? b.updatedAt.localeCompare(a.updatedAt)
          : a.createdAt.localeCompare(b.createdAt)),
    )
    .map((run) => ({
      id: run.runId,
      label:
        (terminal(run) ? "terminal" : "active") +
        " [" +
        cleanOverlayText(run.status) +
        "] " +
        cleanOverlayText(run.name) +
        " (" +
        run.runId +
        ")",
    }));
  if (rows.length === 0) {
    ui.notify("No matching workflow runs in this session.", "info");
    return undefined;
  }
  const selected = await ui.select(
    "Workflow runs",
    rows.map((row) => row.label),
  );
  return rows.find((row) => row.label === selected)?.id;
}
