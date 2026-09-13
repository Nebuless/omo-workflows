import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GraphProjection, NodeState } from "../contracts.ts";
import type { HerdrObserverRecord, HerdrObserverStore } from "./observer.ts";

export type HerdrViewerNode = {
  readonly id: string;
  readonly label: string;
  readonly state: NodeState;
  readonly attempt: number;
  readonly taskId?: string;
  readonly taskStatus?: string;
  readonly model?: string;
  readonly turns?: number;
  readonly errorCode?: string;
};

export type HerdrViewerRun = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly programStatus?: string;
  readonly amendCount: number;
  readonly stale: boolean;
  readonly nodes: readonly HerdrViewerNode[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
  readonly unknownEdges: readonly {
    readonly from: string;
    readonly to: string;
  }[];
};

export type HerdrViewerTask = {
  readonly id: string;
  readonly status: string;
  readonly model?: string;
  readonly turns?: number;
};

export type HerdrViewerSnapshot = {
  readonly version: 1;
  readonly parentSessionId?: string;
  readonly updatedAt: string;
  readonly stale: boolean;
  readonly truncated: boolean;
  readonly runs: readonly HerdrViewerRun[];
  readonly tasks: readonly HerdrViewerTask[];
};

export function viewerSnapshot(
  projection: GraphProjection,
  updatedAt: string,
  programs?: ReadonlyMap<string, string>,
): HerdrViewerSnapshot {
  const linkedTaskIds = new Set(
    projection.runs.flatMap((run) =>
      run.nodes.flatMap((node) =>
        node.taskId === undefined ? [] : [node.taskId],
      ),
    ),
  );
  return {
    version: 1,
    ...(projection.parentSessionId === undefined
      ? {}
      : { parentSessionId: projection.parentSessionId }),
    updatedAt,
    stale: projection.snapshotRequired,
    truncated: !projection.isComplete,
    runs: projection.runs.map((run) => ({
      id: run.runId,
      name: run.name,
      status: run.status,
      ...(programs?.has(run.runId)
        ? { programStatus: programs.get(run.runId) }
        : {}),
      amendCount: run.amendCount,
      stale: run.stale,
      nodes: run.nodes.map((node) => ({
        id: node.id,
        label: node.label ?? node.id,
        state: node.state,
        attempt: node.attempt,
        ...(node.taskId === undefined ? {} : { taskId: node.taskId }),
        ...(node.task?.status === undefined
          ? {}
          : { taskStatus: node.task.status }),
        ...(node.task?.model === undefined ? {} : { model: node.task.model }),
        ...(node.task?.turns === undefined ? {} : { turns: node.task.turns }),
        ...(node.error?.code === undefined
          ? {}
          : { errorCode: node.error.code }),
      })),
      edges: run.edges.map((edge) => ({ ...edge })),
      unknownEdges: run.invalidEdges.map((edge) => ({ ...edge })),
    })),
    tasks: projection.tasks
      .filter((task) => !linkedTaskIds.has(task.taskId))
      .map((task) => ({
        id: task.taskId,
        status: task.status,
        ...(task.model === undefined ? {} : { model: task.model }),
        ...(task.turns === undefined ? {} : { turns: task.turns }),
      })),
  };
}

export interface HerdrStateWriter {
  readonly path: string;
  write(
    projection: GraphProjection,
    programs?: ReadonlyMap<string, string>,
  ): Promise<void>;
}

function serializedWriter(path: string): (value: unknown) => Promise<void> {
  let chain = Promise.resolve();
  return (value): Promise<void> => {
    const text = `${JSON.stringify(value)}\n`;
    chain = chain.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
    });
    return chain;
  };
}

export function createHerdrStateWriter(path: string): HerdrStateWriter {
  const write = serializedWriter(path);
  return {
    path,
    write(projection, programs): Promise<void> {
      return write(
        viewerSnapshot(projection, new Date().toISOString(), programs),
      );
    },
  };
}

function observerRecord(value: unknown): HerdrObserverRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.manuallyClosed !== "boolean") return undefined;
  if (
    record.viewState === null ||
    typeof record.viewState !== "object" ||
    Array.isArray(record.viewState)
  )
    return undefined;
  const viewState = record.viewState as Record<string, unknown>;
  if (typeof viewState.filter !== "string") return undefined;
  if (record.paneId !== undefined && typeof record.paneId !== "string")
    return undefined;
  if (
    viewState.selectedRunId !== undefined &&
    typeof viewState.selectedRunId !== "string"
  )
    return undefined;
  return {
    ...(typeof record.paneId === "string" ? { paneId: record.paneId } : {}),
    manuallyClosed: record.manuallyClosed,
    viewState: {
      ...(typeof viewState.selectedRunId === "string"
        ? { selectedRunId: viewState.selectedRunId }
        : {}),
      filter: viewState.filter,
    },
  };
}

export function createHerdrObserverStore(path: string): HerdrObserverStore {
  const write = serializedWriter(path);
  return {
    async load(): Promise<HerdrObserverRecord | undefined> {
      try {
        return observerRecord(JSON.parse(await readFile(path, "utf8")));
      } catch {
        return undefined;
      }
    },
    save(record): Promise<void> {
      return write(record);
    },
  };
}
