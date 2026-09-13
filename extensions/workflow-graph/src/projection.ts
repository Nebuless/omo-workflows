import type {
  DagEvent,
  DagRun,
  GraphMessage,
  GraphProjection,
  ProjectedActivity,
  ProjectedRun,
  ProjectedTask,
  SequenceGap,
  SequenceRecovery,
} from "./contracts.ts";

export function createGraphProjection(): GraphProjection {
  return {
    runs: [],
    truncatedRuns: 0,
    tasks: [],
    truncatedTasks: 0,
    isComplete: true,
    activity: {},
    gaps: [],
    recovery: [],
    snapshotRequired: false,
  };
}

function projectTask(task: {
  readonly task_id: string;
  readonly status: string;
  readonly updated_at: string;
  readonly model?: string;
  readonly turns?: number;
}): ProjectedTask {
  return {
    taskId: task.task_id,
    status: task.status,
    updatedAt: task.updated_at,
    ...(task.model === undefined ? {} : { model: task.model }),
    ...(task.turns === undefined ? {} : { turns: task.turns }),
  };
}

function projectRun(
  run: DagRun,
  lastSeq: number,
  tasks: ReadonlyMap<string, ProjectedTask>,
): ProjectedRun {
  const nodeIds = new Set(run.nodes.map((node) => node.id));
  const edges = run.edges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );
  const invalidEdges = run.edges.filter(
    (edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to),
  );

  return {
    runId: run.run_id,
    runKey: run.run_key,
    name: run.name,
    status: run.status,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    ...(run.completed_at === undefined
      ? {}
      : { completedAt: run.completed_at }),
    counts: { ...run.counts },
    nodes: run.nodes.map((node) => ({
      id: node.id,
      ...(node.label === undefined ? {} : { label: node.label }),
      dependsOn: [...node.depends_on],
      state: node.state,
      attempt: node.attempt,
      ...(node.task_id === undefined ? {} : { taskId: node.task_id }),
      ...(node.task_id === undefined || tasks.get(node.task_id) === undefined
        ? {}
        : { task: tasks.get(node.task_id) }),
      createdAt: node.created_at,
      ...(node.started_at === undefined ? {} : { startedAt: node.started_at }),
      ...(node.completed_at === undefined
        ? {}
        : { completedAt: node.completed_at }),
      ...(node.last_error === undefined
        ? {}
        : { error: { code: node.last_error.code } }),
    })),
    edges: edges.map((edge) => ({ ...edge })),
    invalidEdges: invalidEdges.map((edge) => ({ ...edge })),
    waves: run.waves.map((wave) => ({
      index: wave.index,
      nodeIds: [...wave.node_ids],
    })),
    amendCount: run.amend_count ?? 0,
    lastSeq,
    stale: false,
  };
}

function isComplete(truncatedRuns: number, truncatedTasks: number): boolean {
  return truncatedRuns === 0 && truncatedTasks === 0;
}

function retainActivity(
  activity: Readonly<Record<string, ProjectedActivity>>,
  runs: readonly ProjectedRun[],
): Readonly<Record<string, ProjectedActivity>> {
  const available = new Set(
    runs.flatMap((run) =>
      run.nodes
        .filter((node) => node.taskId !== undefined)
        .map((node) => `${run.runId}\u0000${node.id}\u0000${node.taskId}`),
    ),
  );
  return Object.fromEntries(
    Object.entries(activity).filter(([key]) => available.has(key)),
  );
}

function recoveredSequence(
  projection: GraphProjection,
  runId: string,
  lastSeq: number,
): number {
  const recovery = projection.recovery.find((item) => item.runId === runId);
  return recovery === undefined
    ? lastSeq
    : Math.max(lastSeq, recovery.received);
}

function replaceSnapshot(
  projection: GraphProjection,
  message: Extract<GraphMessage, { name: "omo.dag.updated" }>,
): GraphProjection {
  const parentSessionId =
    message.data.parent_session_id ?? projection.parentSessionId;
  const isNewSession =
    message.data.parent_session_id !== undefined &&
    projection.parentSessionId !== undefined &&
    message.data.parent_session_id !== projection.parentSessionId;
  const existing = isNewSession
    ? new Map<string, ProjectedRun>()
    : new Map(projection.runs.map((run) => [run.runId, run]));
  const tasks = isNewSession ? [] : projection.tasks;
  const taskMap = new Map(tasks.map((task) => [task.taskId, task]));
  const runs = message.data.runs.map((run) => {
    const lastSeq = existing.get(run.run_id)?.lastSeq ?? 0;
    return projectRun(
      run,
      recoveredSequence(projection, run.run_id, lastSeq),
      taskMap,
    );
  });
  const truncatedRuns = message.data.truncated_runs ?? 0;
  const truncatedTasks = isNewSession ? 0 : projection.truncatedTasks;

  return {
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
    runs,
    truncatedRuns,
    tasks,
    truncatedTasks,
    isComplete: isComplete(truncatedRuns, truncatedTasks),
    activity: isNewSession ? {} : retainActivity(projection.activity, runs),
    gaps: [],
    recovery: [],
    snapshotRequired: false,
    ...(projection.heartbeatAt === undefined
      ? {}
      : { heartbeatAt: projection.heartbeatAt }),
  };
}

function addGap(
  gaps: readonly SequenceGap[],
  gap: SequenceGap,
): readonly SequenceGap[] {
  return gaps.some(
    (current) =>
      current.runId === gap.runId &&
      current.expected === gap.expected &&
      current.received === gap.received,
  )
    ? gaps
    : [...gaps, gap];
}

function addRecovery(
  recovery: readonly SequenceRecovery[],
  next: SequenceRecovery,
): readonly SequenceRecovery[] {
  const current = recovery.find((item) => item.runId === next.runId);
  if (current === undefined) return [...recovery, next];
  if (current.received >= next.received) return recovery;
  return recovery.map((item) => (item.runId === next.runId ? next : item));
}

function markRunStale(
  projection: GraphProjection,
  runId: string,
  received?: number,
): GraphProjection {
  return {
    ...projection,
    runs: projection.runs.map((run) =>
      run.runId === runId ? { ...run, stale: true } : run,
    ),
    recovery:
      received === undefined
        ? projection.recovery
        : addRecovery(projection.recovery, { runId, received }),
    snapshotRequired: true,
  };
}

export function markGraphStale(projection: GraphProjection): GraphProjection {
  return {
    ...projection,
    runs: projection.runs.map((run) => ({ ...run, stale: true })),
    snapshotRequired: true,
  };
}

function applyEvent(
  projection: GraphProjection,
  event: DagEvent,
): GraphProjection {
  const run = projection.runs.find((item) => item.runId === event.runId);
  const expected = (run?.lastSeq ?? 0) + 1;

  if (event.seq < expected) return projection;
  if (event.seq > expected || run === undefined || run.stale) {
    return markRunStale(
      {
        ...projection,
        gaps: addGap(projection.gaps, {
          runId: event.runId,
          expected,
          received: event.seq,
        }),
      },
      event.runId,
      event.seq,
    );
  }

  switch (event.type) {
    case "dag.node.transitioned": {
      const node = run.nodes.find((item) => item.id === event.nodeId);
      if (node === undefined || node.state !== event.from) {
        return markRunStale(projection, event.runId, event.seq);
      }
      return {
        ...projection,
        runs: projection.runs.map((item) =>
          item.runId === event.runId
            ? {
                ...item,
                nodes: item.nodes.map((itemNode) =>
                  itemNode.id === event.nodeId
                    ? { ...itemNode, state: event.to }
                    : itemNode,
                ),
                lastSeq: event.seq,
                updatedAt: event.at,
              }
            : item,
        ),
      };
    }
    case "unsupported":
      return markRunStale(projection, event.runId, event.seq);
  }
}

function clearNodeTask(node: ProjectedRun["nodes"][number]) {
  const { task: _task, ...withoutTask } = node;
  return withoutTask;
}

function replaceTasks(
  projection: GraphProjection,
  message: Extract<GraphMessage, { name: "omo.task.updated" }>,
): GraphProjection {
  const parentSessionId =
    message.data.parent_session_id ?? projection.parentSessionId;
  const isNewSession =
    message.data.parent_session_id !== undefined &&
    projection.parentSessionId !== undefined &&
    message.data.parent_session_id !== projection.parentSessionId;
  const tasks = message.data.tasks.map(projectTask);
  const taskMap = new Map(tasks.map((task) => [task.taskId, task]));
  const runs = isNewSession
    ? []
    : projection.runs.map((run) => ({
        ...run,
        nodes: run.nodes.map((node) => {
          if (node.taskId === undefined) return clearNodeTask(node);
          const task = taskMap.get(node.taskId);
          return task === undefined ? clearNodeTask(node) : { ...node, task };
        }),
      }));
  const truncatedRuns = isNewSession ? 0 : projection.truncatedRuns;
  const truncatedTasks = message.data.truncated_tasks ?? 0;

  return {
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
    runs,
    truncatedRuns,
    tasks,
    truncatedTasks,
    isComplete: isComplete(truncatedRuns, truncatedTasks),
    activity: isNewSession ? {} : retainActivity(projection.activity, runs),
    gaps: isNewSession ? [] : projection.gaps,
    recovery: isNewSession ? [] : projection.recovery,
    snapshotRequired: isNewSession ? false : projection.snapshotRequired,
    ...(projection.heartbeatAt === undefined
      ? {}
      : { heartbeatAt: projection.heartbeatAt }),
  };
}

function applyHeartbeat(
  projection: GraphProjection,
  message: Extract<GraphMessage, { name: "omo.dag.heartbeat" }>,
): GraphProjection {
  let current: GraphProjection = {
    ...projection,
    heartbeatAt: message.data.at,
  };
  for (const heartbeat of message.data.runs) {
    const run = current.runs.find((item) => item.runId === heartbeat.runId);
    if (heartbeat.headSeq <= (run?.lastSeq ?? 0)) continue;
    current = markRunStale(
      {
        ...current,
        gaps: addGap(current.gaps, {
          runId: heartbeat.runId,
          expected: (run?.lastSeq ?? 0) + 1,
          received: heartbeat.headSeq,
        }),
      },
      heartbeat.runId,
      heartbeat.headSeq,
    );
  }
  return current;
}

export function reduceGraphMessage(
  projection: GraphProjection,
  message: GraphMessage,
): GraphProjection {
  switch (message.name) {
    case "omo.dag.updated":
      return replaceSnapshot(projection, message);
    case "omo.dag.event":
      return applyEvent(projection, message.data);
    case "omo.dag.activity": {
      const {
        runId,
        nodeId,
        taskId,
        at,
        activity,
        currentTool,
        turns,
        toolCalls,
      } = message.data;
      return {
        ...projection,
        activity: {
          ...projection.activity,
          [`${runId}\u0000${nodeId}\u0000${taskId}`]: {
            runId,
            nodeId,
            taskId,
            at,
            activity,
            ...(currentTool === undefined ? {} : { currentTool }),
            turns,
            ...(toolCalls === undefined ? {} : { toolCalls }),
          },
        },
      };
    }
    case "omo.dag.heartbeat":
      return applyHeartbeat(projection, message);
    case "omo.task.updated":
      return replaceTasks(projection, message);
  }
}
