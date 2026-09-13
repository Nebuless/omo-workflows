import { Type, type Static } from "typebox";
import { isDeepStrictEqual } from "node:util";
import { Value } from "typebox/value";
import type {
  AuthoredNode,
  AuthoredWorkflow,
  Decision,
  ProgramNode,
  StagedProgram,
  Wave,
} from "./policy.ts";
import { validateDecision } from "./policy.ts";
import { nativeDefinitionFingerprint } from "./native-fingerprint.ts";
import type {
  NativeDetails as Details,
  NativeWorkflowTransport,
} from "./native-transport.ts";
export type { NativeWorkflowTransport } from "./native-transport.ts";

export const STAGED_ENTRY_TYPE = "omo-workflow-graph:staged";
const NodeSchema = Type.Object(
  {
    id: Type.String(),
    prompt: Type.String(),
    label: Type.Optional(Type.String()),
    category: Type.Optional(Type.String()),
    subagent_type: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    dependsOn: Type.Optional(Type.Array(Type.String())),
    task_summary: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    load_skills: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);
const DefinitionSchema = Type.Object(
  { key: Type.String(), name: Type.String(), nodes: Type.Array(NodeSchema) },
  { additionalProperties: false },
);
const IntentSchema = Type.Object(
  {
    action: Type.Union([Type.Literal("start"), Type.Literal("amend")]),
    waveId: Type.String(),
    definition: DefinitionSchema,
    fingerprint: Type.String(),
  },
  { additionalProperties: false },
);
const CheckpointSchema = Type.Object(
  {
    version: Type.Literal(1),
    workflow: Type.String(),
    programVersion: Type.Integer({ minimum: 1 }),
    inputs: Type.Unknown(),
    runId: Type.Optional(Type.String()),
    definition: Type.Optional(DefinitionSchema),
    results: Type.Record(
      Type.String(),
      Type.Record(Type.String(), Type.Unknown()),
    ),
    answers: Type.Record(Type.String(), Type.String()),
    answerModes: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([
          Type.Literal("interactive_select"),
          Type.Literal("deterministic"),
        ]),
      ),
    ),
    external: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    admittedWaves: Type.Array(Type.String()),
    intent: Type.Optional(IntentSchema),
    activeWave: Type.Optional(Type.String()),
    rejected: Type.Optional(Type.String()),
    cancelled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type StagedCheckpoint = Static<typeof CheckpointSchema>;
type RuntimeCheckpoint = StagedCheckpoint & {
  readonly external: Record<string, unknown>;
};
export interface StagedJournal {
  appendEntry(customType: string, data: unknown): Promise<void>;
  getBranch(): readonly unknown[];
}
export type ControllerDecision =
  | Decision
  | { readonly kind: "active"; readonly runId: string; readonly status: string }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "durability-unavailable" };
export interface StagedController {
  checkpoint(): StagedCheckpoint;
  advance(): Promise<ControllerDecision>;
  answerGate(
    id: string,
    answer: string,
    mode?: "interactive_select" | "deterministic",
  ): Promise<ControllerDecision>;
  recordExternal(id: string, value: unknown): Promise<ControllerDecision>;
  fail(reason: string): Promise<ControllerDecision>;
  cancel(): Promise<ControllerDecision>;
}

class InvalidOutputError extends Error {
  constructor(
    readonly code: "json" | "schema" | "missing" | "empty",
    message: string,
  ) {
    super(message);
  }
}

function authored(nodes: readonly ProgramNode[]): AuthoredNode[] {
  return nodes.map(({ output: _, invalidOutput: _policy, ...node }) => node);
}
function cumulative(
  checkpoint: StagedCheckpoint,
  program: StagedProgram,
  wave: Wave,
): AuthoredWorkflow {
  const existing = checkpoint.definition?.nodes ?? [];
  const fresh = authored(wave.nodes);
  if (fresh.some((node) => existing.some(({ id }) => id === node.id)))
    throw new Error("Wave nodes must be new.");
  return {
    key: program.key,
    name: program.key,
    nodes: [...existing, ...fresh],
  };
}
function restored(
  entries: readonly unknown[],
  program: StagedProgram,
): StagedCheckpoint | undefined | "invalid" {
  let found: StagedCheckpoint | undefined;
  for (const value of entries) {
    if (value === null || typeof value !== "object") continue;
    if (!("customType" in value) || !("data" in value)) continue;
    const record = value;
    if (record.customType !== STAGED_ENTRY_TYPE) continue;
    if (!Value.Check(CheckpointSchema, record.data)) return "invalid";
    const data = record.data;
    if (
      data.workflow === program.key &&
      data.programVersion === program.version
    )
      found = data;
  }
  return found;
}
function isExactJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isExactJsonValue);
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  return Object.values(value).every(
    (item) => item !== undefined && isExactJsonValue(item),
  );
}
function isSerializable(value: unknown): boolean {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}
function validExternal(workflow: string, id: string, value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const event = value as { type?: unknown; id?: unknown; raw?: unknown };
  if (typeof event.type !== "string" || typeof event.raw !== "string")
    return false;
  if (id === "live.exit")
    return event.type === "exit" && event.id === undefined;
  return (
    id.startsWith(`${workflow}:`) &&
    ["generate", "steer", "manual_edit_apply", "variant_mount_failed"].includes(
      event.type,
    ) &&
    typeof event.id === "string" &&
    id === `${workflow}:${event.id}`
  );
}

export function createStagedController<I>(input: {
  readonly native: NativeWorkflowTransport;
  readonly journal: StagedJournal;
  readonly program: StagedProgram<I>;
  readonly inputs: I;
  readonly readArtifact: (path: string) => Promise<string>;
}): StagedController {
  if (
    !Value.Check(input.program.input, input.inputs) ||
    !isSerializable(input.inputs)
  )
    throw new Error("Invalid staged program inputs.");
  const prior = restored(input.journal.getBranch(), input.program);
  if (
    prior !== undefined &&
    prior !== "invalid" &&
    (!Value.Check(input.program.input, prior.inputs) ||
      !isDeepStrictEqual(prior.inputs, input.inputs))
  )
    throw new Error("Stored workflow inputs differ from this launch.");
  let checkpoint: RuntimeCheckpoint =
    prior === "invalid"
      ? {
          version: 1,
          workflow: input.program.key,
          programVersion: input.program.version,
          inputs: input.inputs,
          results: {},
          answers: {},
          external: {},
          admittedWaves: [],
          rejected: "invalid-journal-entry",
        }
      : prior === undefined
        ? {
            version: 1,
            workflow: input.program.key,
            programVersion: input.program.version,
            inputs: input.inputs,
            results: {},
            answers: {},
            external: {},
            admittedWaves: [],
          }
        : { ...prior, external: prior.external ?? {} };
  let chain = Promise.resolve<ControllerDecision>({
    kind: "active",
    runId: "",
    status: "idle",
  });
  let generation = 0;
  let cancelRequested = checkpoint.cancelled === true;
  const persist = async (next: StagedCheckpoint): Promise<boolean> => {
    if (!isSerializable(next))
      throw new Error("Checkpoint is not JSON serializable.");
    try {
      await input.journal.appendEntry(STAGED_ENTRY_TYPE, next);
      checkpoint = {
        ...next,
        external: next.external ?? {},
        ...(cancelRequested ? { cancelled: true } : {}),
      };
      return true;
    } catch {
      return false;
    }
  };
  const reject = async (reason: string): Promise<ControllerDecision> => {
    const next = { ...checkpoint, intent: undefined, rejected: reason };
    return (await persist(next))
      ? { kind: "rejected", reason }
      : { kind: "durability-unavailable" };
  };
  const decide = (): Decision | { kind: "rejected"; reason: string } => {
    if (checkpoint.cancelled) return { kind: "rejected", reason: "cancelled" };
    if (checkpoint.rejected !== undefined)
      return { kind: "rejected", reason: checkpoint.rejected };
    const decision = input.program.decide({
      inputs: input.inputs,
      results: checkpoint.results,
      answers: checkpoint.answers,
      answerModes: checkpoint.answerModes ?? {},
      external: checkpoint.external,
    });
    validateDecision(decision);
    return decision;
  };
  const reconcile = async (
    fence: number,
  ): Promise<ControllerDecision | undefined> => {
    const intent = checkpoint.intent;
    if (intent === undefined) return undefined;
    if (generation !== fence || cancelRequested)
      return { kind: "rejected", reason: "cancelled" };
    if (intent.action === "amend") {
      const runId = checkpoint.runId;
      if (runId === undefined) return await reject("missing-run-id");
      const reply = await input.native.execute({
        action: "snapshot",
        run_id: runId,
      });
      if (generation !== fence || cancelRequested)
        return { kind: "rejected", reason: "cancelled" };
      if (
        reply.details.kind !== "snapshot" ||
        reply.details.run_id !== runId ||
        reply.details.snapshot.runId !== runId ||
        reply.details.snapshot.runKey !== checkpoint.workflow
      )
        return await reject("native-snapshot-failed");
      const actual = reply.details.snapshot.definitionFingerprint;
      if (actual === intent.fingerprint) {
        return (await persist({
          ...checkpoint,
          definition: intent.definition,
          intent: undefined,
          activeWave: intent.waveId,
        }))
          ? undefined
          : { kind: "durability-unavailable" };
      }
      if (
        checkpoint.definition === undefined ||
        actual !== nativeDefinitionFingerprint(checkpoint.definition)
      )
        return await reject("native-definition-conflict");
      if (
        !["completed", "failed", "cancelled"].includes(
          reply.details.snapshot.status,
        )
      )
        return { kind: "active", runId, status: reply.details.snapshot.status };
    }
    if (generation !== fence || cancelRequested)
      return { kind: "rejected", reason: "cancelled" };
    // Native start deduplicates the exact persisted definition by session run key.
    const dispatch =
      intent.action === "start"
        ? await input.native.execute({
            action: "start",
            definition: intent.definition,
          })
        : checkpoint.runId === undefined
          ? undefined
          : await input.native.execute({
              action: "amend",
              run_id: checkpoint.runId,
              definition: intent.definition,
            });
    if (
      dispatch?.details.kind !== "started" &&
      dispatch?.details.kind !== "amended"
    )
      return await reject("native-dispatch-failed");
    if (
      checkpoint.runId !== undefined &&
      dispatch.details.run_id !== checkpoint.runId
    )
      return await reject("foreign-native-run");
    const next = {
      ...checkpoint,
      runId: dispatch.details.run_id,
      definition: intent.definition,
      intent: undefined,
      activeWave: intent.waveId,
    };
    if (!(await persist(next))) return { kind: "durability-unavailable" };
    return generation !== fence || cancelRequested
      ? { kind: "rejected", reason: "cancelled" }
      : undefined;
  };
  const validateOutput = async (
    wave: Wave,
    result: Extract<Details, { kind: "waited" }>["result"],
    fence: number,
  ): Promise<Record<string, unknown>> => {
    if (result.status !== "completed")
      throw new Error(`Native workflow settled ${result.status}.`);
    const output: Record<string, unknown> = {};
    for (const node of wave.nodes) {
      const current = result.nodes[node.id];
      if (current?.state !== "completed")
        throw new Error(
          `Native workflow omitted completed output for ${node.id}.`,
        );
      try {
        if ("schema" in node.output) {
          if (current.output === undefined)
            throw new InvalidOutputError(
              "missing",
              `Native workflow omitted completed output for ${node.id}.`,
            );
          let value: unknown;
          try {
            value = JSON.parse(current.output);
          } catch {
            throw new InvalidOutputError(
              "json",
              `Native workflow output for ${node.id} is not exact JSON.`,
            );
          }
          if (!Value.Check(node.output.schema, value))
            throw new InvalidOutputError(
              "schema",
              `Native workflow output for ${node.id} failed schema validation.`,
            );
          output[node.id] = value;
        } else {
          const contents = await input
            .readArtifact(node.output.file.path)
            .catch((error: unknown) => {
              if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
              )
                throw new InvalidOutputError("missing", error.message);
              throw error;
            });
          if (generation !== fence) throw new Error("cancelled");
          if (node.output.file.nonempty && contents.length === 0)
            throw new InvalidOutputError(
              "empty",
              `Artifact for ${node.id} is empty.`,
            );
          if (
            node.output.file.exact !== undefined &&
            contents !== node.output.file.exact
          )
            throw new InvalidOutputError(
              "schema",
              `Artifact for ${node.id} did not match exact required contents.`,
            );
          if (node.output.file.schema !== undefined) {
            let value: unknown;
            try {
              value = JSON.parse(contents);
            } catch {
              throw new InvalidOutputError(
                "json",
                `Artifact for ${node.id} is not exact JSON.`,
              );
            }
            if (!Value.Check(node.output.file.schema, value))
              throw new InvalidOutputError(
                "schema",
                `Artifact for ${node.id} failed schema validation.`,
              );
            output[node.id] = value;
          } else output[node.id] = node.output.file.path;
        }
      } catch (error) {
        if (
          node.invalidOutput !== "report" ||
          !(error instanceof InvalidOutputError)
        )
          throw error;
        output[node.id] = { kind: "invalid-output", code: error.code };
      }
    }
    return output;
  };
  const run = async (): Promise<ControllerDecision> => {
    const fence = generation;
    if (checkpoint.cancelled) return { kind: "rejected", reason: "cancelled" };
    const reconciled = await reconcile(fence);
    if (reconciled !== undefined) return reconciled;
    if (generation !== fence) return { kind: "rejected", reason: "cancelled" };
    const current = decide();
    if (current.kind !== "wave") return current;
    if (checkpoint.admittedWaves.includes(current.id))
      return await reject("program-repeated-admitted-wave");
    if (checkpoint.activeWave !== current.id) {
      const definition = cumulative(checkpoint, input.program, current);
      const intent = {
        action:
          checkpoint.runId === undefined
            ? ("start" as const)
            : ("amend" as const),
        waveId: current.id,
        definition,
        fingerprint: nativeDefinitionFingerprint(definition),
      };
      if (!(await persist({ ...checkpoint, intent })))
        return { kind: "durability-unavailable" };
      const dispatched = await reconcile(fence);
      if (dispatched !== undefined) return dispatched;
    }
    if (generation !== fence) return { kind: "rejected", reason: "cancelled" };
    const runId = checkpoint.runId;
    if (runId === undefined) return await reject("missing-run-id");
    const snapshot = await input.native.execute({
      action: "snapshot",
      run_id: runId,
    });
    if (
      snapshot.details.kind !== "snapshot" ||
      snapshot.details.run_id !== runId ||
      snapshot.details.snapshot.runId !== runId ||
      snapshot.details.snapshot.runKey !== checkpoint.workflow
    )
      return await reject("native-snapshot-failed");
    if (
      checkpoint.definition === undefined ||
      snapshot.details.snapshot.definitionFingerprint !==
        nativeDefinitionFingerprint(checkpoint.definition)
    )
      return await reject("native-definition-conflict");
    if (
      !["completed", "failed", "cancelled"].includes(
        snapshot.details.snapshot.status,
      )
    )
      return {
        kind: "active",
        runId,
        status: snapshot.details.snapshot.status,
      };
    const waited = await input.native.execute({
      action: "wait",
      run_id: runId,
      detach: false,
    });
    if (
      waited.details.kind !== "waited" ||
      waited.details.run_id !== runId ||
      waited.details.result.runId !== runId
    )
      return await reject("native-wait-failed");
    let result: Record<string, unknown>;
    try {
      result = await validateOutput(current, waited.details.result, fence);
    } catch (error) {
      return error instanceof Error && error.message === "cancelled"
        ? { kind: "rejected", reason: "cancelled" }
        : await reject(
            error instanceof Error ? error.message : "output-invalid",
          );
    }
    if (generation !== fence) return { kind: "rejected", reason: "cancelled" };
    const next = {
      ...checkpoint,
      results: { ...checkpoint.results, [current.id]: result },
      admittedWaves: [...checkpoint.admittedWaves, current.id],
      activeWave: undefined,
    };
    if (!(await persist(next))) return { kind: "durability-unavailable" };
    return decide();
  };
  const serial = (
    operation: () => Promise<ControllerDecision>,
  ): Promise<ControllerDecision> => (chain = chain.then(operation, operation));
  return {
    checkpoint: () => checkpoint,
    advance: () => serial(run),
    answerGate: (id, answer, mode = "interactive_select") =>
      serial(async () => {
        const current = decide();
        if (
          current.kind !== "gate" ||
          current.id !== id ||
          !current.choices.includes(answer) ||
          checkpoint.answers[id] !== undefined
        )
          return { kind: "rejected", reason: "invalid-gate-answer" };
        return (await persist({
          ...checkpoint,
          answers: { ...checkpoint.answers, [id]: answer },
          answerModes: { ...checkpoint.answerModes, [id]: mode },
        }))
          ? decide()
          : { kind: "durability-unavailable" };
      }),
    recordExternal: (id, value) =>
      serial(async () => {
        if (
          !validExternal(checkpoint.workflow, id, value) ||
          !isExactJsonValue(value)
        )
          return { kind: "rejected", reason: "invalid-external-event" };
        if (Object.hasOwn(checkpoint.external, id))
          return isDeepStrictEqual(checkpoint.external[id], value)
            ? decide()
            : { kind: "rejected", reason: "external-event-conflict" };
        return (await persist({
          ...checkpoint,
          external: { ...checkpoint.external, [id]: value },
        }))
          ? decide()
          : { kind: "durability-unavailable" };
      }),
    fail: (reason) =>
      serial(async () =>
        !reason
          ? { kind: "rejected", reason: "invalid-failure" }
          : reject(reason),
      ),
    cancel: () => {
      generation += 1;
      cancelRequested = true;
      checkpoint = { ...checkpoint, cancelled: true };
      return serial(async () => {
        if (!(await persist(checkpoint)))
          return { kind: "durability-unavailable" };
        if (checkpoint.runId !== undefined) {
          const reply = await input.native.execute({
            action: "cancel",
            run_id: checkpoint.runId,
          });
          if (
            reply.details.kind !== "cancelled" ||
            reply.details.run_id !== checkpoint.runId
          )
            return { kind: "rejected", reason: "native-cancel-failed" };
        }
        return { kind: "rejected", reason: "cancelled" };
      });
    },
  };
}
