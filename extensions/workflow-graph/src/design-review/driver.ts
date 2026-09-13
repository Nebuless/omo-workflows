import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  LiveEventSchema,
  ModelEventResultSchema,
  isJsonValue,
  needsModel,
  type LiveEvent,
  type LiveHelperTransport,
  type ModelEventResult,
} from "./protocol.ts";

export const DESIGN_REVIEW_ENTRY_TYPE = "omo-workflow-graph:design-review";

const EventRecordSchema = Type.Object(
  {
    version: Type.Literal(1),
    session: Type.String(),
    kind: Type.Literal("event"),
    sequence: Type.Integer({ minimum: 0 }),
    eventId: Type.String(),
    event: LiveEventSchema,
  },
  { additionalProperties: false },
);
const ReplyRecordSchema = Type.Object(
  {
    version: Type.Literal(1),
    session: Type.String(),
    kind: Type.Literal("reply"),
    eventId: Type.String(),
    result: ModelEventResultSchema,
  },
  { additionalProperties: false },
);
const AckRecordSchema = Type.Object(
  {
    version: Type.Literal(1),
    session: Type.String(),
    kind: Type.Literal("ack"),
    eventId: Type.String(),
  },
  { additionalProperties: false },
);
const ExitRecordSchema = Type.Object(
  {
    version: Type.Literal(1),
    session: Type.String(),
    kind: Type.Literal("exit"),
    event: LiveEventSchema,
  },
  { additionalProperties: false },
);
const RecordSchema = Type.Union([
  EventRecordSchema,
  ReplyRecordSchema,
  AckRecordSchema,
  ExitRecordSchema,
]);
export type DesignReviewRecord =
  | {
      readonly version: 1;
      readonly session: string;
      readonly kind: "event";
      readonly sequence: number;
      readonly eventId: string;
      readonly event: LiveEvent;
    }
  | {
      readonly version: 1;
      readonly session: string;
      readonly kind: "reply";
      readonly eventId: string;
      readonly result: ModelEventResult;
    }
  | {
      readonly version: 1;
      readonly session: string;
      readonly kind: "ack";
      readonly eventId: string;
    }
  | {
      readonly version: 1;
      readonly session: string;
      readonly kind: "exit";
      readonly event: LiveEvent;
    };

export interface DesignReviewJournal {
  appendEntry(
    customType: typeof DESIGN_REVIEW_ENTRY_TYPE,
    data: DesignReviewRecord,
  ): Promise<void>;
  getBranch(): readonly unknown[];
}

export interface DesignReviewHost {
  /** Must return same durable native stage result for repeated eventKey calls. */
  runModel(
    eventKey: string,
    event: LiveEvent,
    signal?: AbortSignal,
  ): Promise<ModelEventResult>;
}

export type DesignReviewOutcome = {
  readonly kind: "exited";
  readonly event: LiveEvent;
};

function records(
  branch: readonly unknown[],
  session: string,
): DesignReviewRecord[] {
  const result: DesignReviewRecord[] = [];
  const states = new Map<string, "event" | "reply" | "ack">();
  let lastSequence = -1;
  let exited = false;
  const corrupt = (): never => {
    throw new Error("Corrupt design review journal record.");
  };
  for (const value of branch) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as { customType?: unknown; data?: unknown };
    if (entry.customType !== DESIGN_REVIEW_ENTRY_TYPE) continue;
    const candidate = entry.data;
    const candidateSession =
      typeof candidate === "object" && candidate !== null
        ? (candidate as { session?: unknown }).session
        : undefined;
    if (candidateSession !== session) continue;
    if (!Value.Check(RecordSchema, candidate) || exited) corrupt();
    const record = candidate as DesignReviewRecord;
    if (
      (record.kind === "event" || record.kind === "exit") &&
      record.event.data !== undefined &&
      !isJsonValue(record.event.data)
    )
      corrupt();
    if (
      record.kind === "reply" &&
      record.result.data !== undefined &&
      !isJsonValue(record.result.data)
    )
      corrupt();
    if (record.kind === "event") {
      if (
        record.event.id !== record.eventId ||
        !needsModel(record.event) ||
        record.sequence <= lastSequence ||
        states.has(record.eventId)
      )
        corrupt();
      lastSequence = record.sequence;
      states.set(record.eventId, "event");
    } else if (record.kind === "reply") {
      if (states.get(record.eventId) !== "event") corrupt();
      states.set(record.eventId, "reply");
    } else if (record.kind === "ack") {
      if (states.get(record.eventId) !== "reply") corrupt();
      states.set(record.eventId, "ack");
    } else {
      if (record.event.type !== "exit") corrupt();
      exited = true;
    }
    result.push(record);
  }
  return result;
}

export function replayDesignReviewExit(
  journal: DesignReviewJournal,
  session: string,
): LiveEvent | undefined {
  return [...records(journal.getBranch(), session)]
    .reverse()
    .find(
      (record): record is Extract<DesignReviewRecord, { kind: "exit" }> =>
        record.kind === "exit",
    )?.event;
}

function eventKey(session: string, eventId: string): string {
  return `${session}:${eventId}`;
}

export function createDesignReviewDriver(input: {
  readonly session: string;
  readonly transport: LiveHelperTransport;
  readonly journal: DesignReviewJournal;
  readonly host: DesignReviewHost;
}) {
  const append = (record: DesignReviewRecord): Promise<void> =>
    input.journal.appendEntry(DESIGN_REVIEW_ENTRY_TYPE, record);
  return {
    run: async (signal?: AbortSignal): Promise<DesignReviewOutcome> => {
      const restored = records(input.journal.getBranch(), input.session);
      const committedExit = replayDesignReviewExit(
        input.journal,
        input.session,
      );
      if (committedExit !== undefined)
        return { kind: "exited", event: committedExit };
      const events = new Map(
        restored
          .filter(
            (
              record,
            ): record is Extract<DesignReviewRecord, { kind: "event" }> =>
              record.kind === "event",
          )
          .map((record) => [record.eventId, record]),
      );
      const replies = new Map(
        restored
          .filter(
            (
              record,
            ): record is Extract<DesignReviewRecord, { kind: "reply" }> =>
              record.kind === "reply",
          )
          .map((record) => [record.eventId, record]),
      );
      const acked = new Set(
        restored
          .filter((record) => record.kind === "ack")
          .map((record) => record.eventId),
      );
      const pending = [...events.values()]
        .filter((record) => !acked.has(record.eventId))
        .sort((left, right) => left.sequence - right.sequence);
      let nextSequence =
        Math.max(-1, ...[...events.values()].map((record) => record.sequence)) +
        1;
      for (;;) {
        if (signal?.aborted)
          throw new DOMException("Design review aborted.", "AbortError");
        let event =
          pending.shift()?.event ?? (await input.transport.poll(signal));
        if (signal?.aborted)
          throw new DOMException("Design review aborted.", "AbortError");
        if (event.type === "timeout") continue;
        if (event.type === "exit") {
          await append({
            version: 1,
            session: input.session,
            kind: "exit",
            event,
          });
          if (signal?.aborted)
            throw new DOMException("Design review aborted.", "AbortError");
          return { kind: "exited", event };
        }
        if (!needsModel(event)) continue;
        if (!event.id)
          throw new Error(`Live ${event.type} event is missing its id.`);
        const eventId = event.id;
        if (acked.has(eventId)) continue;
        const committedEvent = events.get(eventId);
        if (committedEvent !== undefined) event = committedEvent.event;
        if (committedEvent === undefined) {
          const record = {
            version: 1 as const,
            session: input.session,
            kind: "event" as const,
            sequence: nextSequence,
            eventId,
            event,
          };
          await append(record);
          if (signal?.aborted)
            throw new DOMException("Design review aborted.", "AbortError");
          events.set(eventId, record);
          nextSequence += 1;
        }
        const recovered = replies.get(eventId);
        const result =
          recovered?.result ??
          (await input.host.runModel(
            eventKey(input.session, eventId),
            event,
            signal,
          ));
        if (signal?.aborted)
          throw new DOMException("Design review aborted.", "AbortError");
        if (
          !Value.Check(ModelEventResultSchema, result) ||
          (result.data !== undefined && !isJsonValue(result.data))
        )
          throw new Error("Host returned invalid design review model result.");
        if (!recovered) {
          const record = {
            version: 1 as const,
            session: input.session,
            kind: "reply" as const,
            eventId,
            result,
          };
          await append(record);
          if (signal?.aborted)
            throw new DOMException("Design review aborted.", "AbortError");
          replies.set(eventId, record);
        }
        await input.transport.reply(event, result, signal);
        if (signal?.aborted)
          throw new DOMException("Design review aborted.", "AbortError");
        await append({
          version: 1,
          session: input.session,
          kind: "ack",
          eventId,
        });
        if (signal?.aborted)
          throw new DOMException("Design review aborted.", "AbortError");
        acked.add(eventId);
      }
    },
  };
}
