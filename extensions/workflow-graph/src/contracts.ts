import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const NodeStateSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("scheduled"),
  Type.Literal("running"),
  Type.Literal("blocked"),
  Type.Literal("paused"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("skipped"),
  Type.Literal("cancelled"),
]);

export type NodeState = Static<typeof NodeStateSchema>;

const DagErrorSchema = Type.Object(
  { code: Type.String(), message: Type.String() },
  { additionalProperties: false },
);

const DagNodeSchema = Type.Object(
  {
    id: Type.String(),
    label: Type.Optional(Type.String()),
    prompt: Type.Optional(Type.String()),
    depends_on: Type.Array(Type.String()),
    state: NodeStateSchema,
    attempt: Type.Integer({ minimum: 0 }),
    created_at: Type.String(),
    task_id: Type.Optional(Type.String()),
    started_at: Type.Optional(Type.String()),
    completed_at: Type.Optional(Type.String()),
    last_error: Type.Optional(DagErrorSchema),
  },
  { additionalProperties: false },
);

export type DagNode = Static<typeof DagNodeSchema>;

const DagEdgeSchema = Type.Object(
  { from: Type.String(), to: Type.String() },
  { additionalProperties: false },
);

const DagWaveSchema = Type.Object(
  { index: Type.Integer({ minimum: 0 }), node_ids: Type.Array(Type.String()) },
  { additionalProperties: false },
);

const DagRunSchema = Type.Object(
  {
    run_id: Type.String(),
    run_key: Type.String(),
    name: Type.String(),
    status: Type.String(),
    created_at: Type.String(),
    updated_at: Type.String(),
    completed_at: Type.Optional(Type.String()),
    counts: Type.Record(Type.String(), Type.Number()),
    nodes: Type.Array(DagNodeSchema),
    edges: Type.Array(DagEdgeSchema),
    waves: Type.Array(DagWaveSchema),
    amend_count: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export type DagRun = Static<typeof DagRunSchema>;

const DagSnapshotSchema = Type.Object(
  {
    parent_session_id: Type.Optional(Type.String()),
    runs: Type.Array(DagRunSchema),
    truncated_runs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export type DagSnapshot = Static<typeof DagSnapshotSchema>;

const DagNodeTransitionEventSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    runId: Type.String(),
    seq: Type.Integer({ minimum: 1 }),
    at: Type.String(),
    lane: Type.String(),
    type: Type.Literal("dag.node.transitioned"),
    nodeId: Type.String(),
    from: NodeStateSchema,
    to: NodeStateSchema,
    // Installed OMO emits structured reasons (for example, `{ kind: "scheduled" }`).
    // The reducer never interprets this diagnostic field.
    reason: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export type DagNodeTransitionEvent = Static<
  typeof DagNodeTransitionEventSchema
>;

export type DagUnsupportedEvent = {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly seq: number;
  readonly at: string;
  readonly lane: string;
  readonly type: "unsupported";
};

export type DagEvent = DagNodeTransitionEvent | DagUnsupportedEvent;

const DagActivitySchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    runId: Type.String(),
    nodeId: Type.String(),
    taskId: Type.String(),
    at: Type.String(),
    activity: Type.String(),
    currentTool: Type.Optional(Type.String()),
    lastAssistantLine: Type.Optional(Type.String()),
    turns: Type.Integer({ minimum: 0 }),
    toolCalls: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export type DagActivity = Static<typeof DagActivitySchema>;

const DagTaskSchema = Type.Object(
  {
    task_id: Type.String(),
    status: Type.String(),
    updated_at: Type.String(),
    model: Type.Optional(Type.String()),
    turns: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  // OMO task records carry execution metadata that evolves independently of
  // this viewer. The projection copies only explicitly safe fields.
  { additionalProperties: true },
);

export type DagTask = Static<typeof DagTaskSchema>;

const TaskSnapshotSchema = Type.Object(
  {
    parent_session_id: Type.Optional(Type.String()),
    tasks: Type.Array(DagTaskSchema),
    truncated_tasks: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export type TaskSnapshot = Static<typeof TaskSnapshotSchema>;

const DagHeartbeatSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    at: Type.String(),
    runs: Type.Array(
      Type.Object(
        { runId: Type.String(), headSeq: Type.Integer({ minimum: 0 }) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export type DagHeartbeat = Static<typeof DagHeartbeatSchema>;

export type GraphMessage =
  | { readonly name: "omo.dag.updated"; readonly data: DagSnapshot }
  | { readonly name: "omo.dag.event"; readonly data: DagEvent }
  | { readonly name: "omo.dag.activity"; readonly data: DagActivity }
  | { readonly name: "omo.dag.heartbeat"; readonly data: DagHeartbeat }
  | { readonly name: "omo.task.updated"; readonly data: TaskSnapshot };

type ExtensionEvent = { readonly name: string; readonly data: unknown };

const ExtensionEventSchema = Type.Object(
  { name: Type.String(), data: Type.Unknown() },
  { additionalProperties: false },
);

const DagEventBaseSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    runId: Type.String(),
    seq: Type.Integer({ minimum: 1 }),
    at: Type.String(),
    lane: Type.String(),
    type: Type.String(),
  },
  { additionalProperties: true },
);

function parseDagEvent(value: unknown): DagEvent | undefined {
  if (Value.Check(DagNodeTransitionEventSchema, value)) return value;
  if (!Value.Check(DagEventBaseSchema, value)) return undefined;
  return {
    schemaVersion: value.schemaVersion,
    runId: value.runId,
    seq: value.seq,
    at: value.at,
    lane: value.lane,
    type: "unsupported",
  };
}

export function parseGraphMessage(value: unknown): GraphMessage | undefined {
  if (!Value.Check(ExtensionEventSchema, value)) return undefined;
  const event: ExtensionEvent = value;

  switch (event.name) {
    case "omo.dag.updated":
      return Value.Check(DagSnapshotSchema, event.data)
        ? { name: event.name, data: event.data }
        : undefined;
    case "omo.dag.event": {
      const dagEvent = parseDagEvent(event.data);
      return dagEvent === undefined
        ? undefined
        : { name: event.name, data: dagEvent };
    }
    case "omo.dag.activity":
      return Value.Check(DagActivitySchema, event.data)
        ? { name: event.name, data: event.data }
        : undefined;
    case "omo.dag.heartbeat":
      return Value.Check(DagHeartbeatSchema, event.data)
        ? { name: event.name, data: event.data }
        : undefined;
    case "omo.task.updated":
      return Value.Check(TaskSnapshotSchema, event.data)
        ? { name: event.name, data: event.data }
        : undefined;
    default:
      return undefined;
  }
}

export type ProjectedTask = {
  readonly taskId: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly model?: string;
  readonly turns?: number;
};

export type ProjectedNode = {
  readonly id: string;
  readonly label?: string;
  readonly dependsOn: readonly string[];
  readonly state: NodeState;
  readonly attempt: number;
  readonly taskId?: string;
  readonly task?: ProjectedTask;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: { readonly code: string };
};

export type ProjectedEdge = { readonly from: string; readonly to: string };

export type ProjectedRun = {
  readonly runId: string;
  readonly runKey: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly nodes: readonly ProjectedNode[];
  readonly edges: readonly ProjectedEdge[];
  readonly invalidEdges: readonly ProjectedEdge[];
  readonly waves: readonly {
    readonly index: number;
    readonly nodeIds: readonly string[];
  }[];
  readonly amendCount: number;
  readonly lastSeq: number;
  readonly stale: boolean;
};

export type SequenceGap = {
  readonly runId: string;
  readonly expected: number;
  readonly received: number;
};

export type SequenceRecovery = {
  readonly runId: string;
  readonly received: number;
};

export type ProjectedActivity = {
  readonly runId: string;
  readonly nodeId: string;
  readonly taskId: string;
  readonly at: string;
  readonly activity: string;
  readonly currentTool?: string;
  readonly turns: number;
  readonly toolCalls?: number;
};

export type GraphProjection = {
  readonly parentSessionId?: string;
  readonly runs: readonly ProjectedRun[];
  readonly truncatedRuns: number;
  readonly tasks: readonly ProjectedTask[];
  readonly truncatedTasks: number;
  readonly isComplete: boolean;
  readonly activity: Readonly<Record<string, ProjectedActivity>>;
  readonly gaps: readonly SequenceGap[];
  readonly recovery: readonly SequenceRecovery[];
  readonly snapshotRequired: boolean;
  readonly heartbeatAt?: string;
};
