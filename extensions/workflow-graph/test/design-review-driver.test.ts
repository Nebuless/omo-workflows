import { describe, expect, test } from "bun:test";
import {
  createDesignReviewDriver,
  DESIGN_REVIEW_ENTRY_TYPE,
  type DesignReviewJournal,
  type DesignReviewRecord,
} from "../src/design-review/driver.ts";
import type {
  LiveEvent,
  LiveHelperTransport,
  ModelEventResult,
} from "../src/design-review/protocol.ts";

function event(type: string, id?: string): LiveEvent {
  return { type, id, raw: JSON.stringify({ type, id }) };
}
function entry(data: DesignReviewRecord): {
  customType: typeof DESIGN_REVIEW_ENTRY_TYPE;
  data: DesignReviewRecord;
} {
  return { customType: DESIGN_REVIEW_ENTRY_TYPE, data };
}
function journal(initial: readonly unknown[] = []): DesignReviewJournal & {
  entries: Array<{ customType: string; data: unknown }>;
} {
  const entries = [...initial] as Array<{ customType: string; data: unknown }>;
  return {
    entries,
    getBranch: () => entries,
    appendEntry: async (customType, data) => {
      entries.push({ customType, data });
    },
  };
}
function transport(
  events: LiveEvent[],
  failReply = false,
): LiveHelperTransport & {
  polls: number;
  replies: Array<[LiveEvent, ModelEventResult]>;
} {
  return {
    polls: 0,
    replies: [],
    poll: async function () {
      this.polls += 1;
      const next = events.shift();
      if (!next) throw new Error("fixture exhausted");
      return next;
    },
    reply: async function (liveEvent, result) {
      this.replies.push([liveEvent, result]);
      if (failReply) throw new Error("reply unavailable");
    },
  };
}

describe("design review driver", () => {
  test("absorbs timeout, models only selected events, and commits actual exit", async () => {
    const helper = transport([
      event("timeout"),
      event("variant_mounted", "v"),
      event("generate", "g"),
      event("exit"),
    ]);
    const state = journal();
    const keys: string[] = [];
    const result = await createDesignReviewDriver({
      session: "s",
      transport: helper,
      journal: state,
      host: {
        runModel: async (key) => {
          keys.push(key);
          return {};
        },
      },
    }).run();
    expect(result.event.type).toBe("exit");
    expect(helper.polls).toBe(4);
    expect(keys).toEqual(["s:g"]);
    expect(
      state.entries.map(({ data }) => (data as DesignReviewRecord).kind),
    ).toEqual(["event", "reply", "ack", "exit"]);
  });

  test("terminal replay returns exact committed exit without process or model", async () => {
    const terminal = event("exit", "terminal");
    const helper = transport([]);
    let modeled = false;
    const result = await createDesignReviewDriver({
      session: "s",
      transport: helper,
      journal: journal([
        entry({ version: 1, session: "s", kind: "exit", event: terminal }),
      ]),
      host: {
        runModel: async () => {
          modeled = true;
          return {};
        },
      },
    }).run();
    expect(result.event).toEqual(terminal);
    expect(helper.polls).toBe(0);
    expect(modeled).toBe(false);
  });

  test("recovers every unacknowledged event oldest-first", async () => {
    const first = event("generate", "first");
    const second = event("steer", "second");
    const helper = transport([event("exit")]);
    const order: string[] = [];
    await createDesignReviewDriver({
      session: "s",
      transport: helper,
      journal: journal([
        entry({
          version: 1,
          session: "s",
          kind: "event",
          sequence: 0,
          eventId: "first",
          event: first,
        }),
        entry({
          version: 1,
          session: "s",
          kind: "event",
          sequence: 1,
          eventId: "second",
          event: second,
        }),
      ]),
      host: {
        runModel: async (key) => {
          order.push(key);
          return {};
        },
      },
    }).run();
    expect(order).toEqual(["s:first", "s:second"]);
    expect(helper.replies.map(([item]) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });

  test("duplicate acknowledged event causes no model, reply, or duplicate journal", async () => {
    const duplicate = event("generate", "same");
    const state = journal([
      entry({
        version: 1,
        session: "s",
        kind: "event",
        sequence: 0,
        eventId: "same",
        event: duplicate,
      }),
      entry({
        version: 1,
        session: "s",
        kind: "reply",
        eventId: "same",
        result: {},
      }),
      entry({ version: 1, session: "s", kind: "ack", eventId: "same" }),
    ]);
    const helper = transport([duplicate, event("exit")]);
    let modeled = false;
    await createDesignReviewDriver({
      session: "s",
      transport: helper,
      journal: state,
      host: {
        runModel: async () => {
          modeled = true;
          return {};
        },
      },
    }).run();
    expect(modeled).toBe(false);
    expect(helper.replies).toHaveLength(0);
    expect(
      state.entries.filter(
        ({ data }) => (data as DesignReviewRecord).kind === "event",
      ),
    ).toHaveLength(1);
  });

  test("replays reply after failure without rerunning keyed native model", async () => {
    const state = journal();
    const nativeResults = new Map<string, ModelEventResult>();
    let nativeDispatches = 0;
    const host = {
      runModel: async (key: string) => {
        const prior = nativeResults.get(key);
        if (prior) return prior;
        nativeDispatches += 1;
        const result = { message: "handled" };
        nativeResults.set(key, result);
        return result;
      },
    };
    await expect(
      createDesignReviewDriver({
        session: "s",
        transport: transport([event("steer", "same")], true),
        journal: state,
        host,
      }).run(),
    ).rejects.toThrow("reply unavailable");
    await createDesignReviewDriver({
      session: "s",
      transport: transport([event("exit")]),
      journal: state,
      host,
    }).run();
    expect(nativeDispatches).toBe(1);
  });

  test("keyed host reuses native result when result journal append failed", async () => {
    const entries: Array<{ customType: string; data: unknown }> = [];
    let rejectReplyRecord = true;
    const state: DesignReviewJournal = {
      getBranch: () => entries,
      appendEntry: async (customType, data) => {
        if (data.kind === "reply" && rejectReplyRecord) {
          rejectReplyRecord = false;
          throw new Error("journal down");
        }
        entries.push({ customType, data });
      },
    };
    const nativeResults = new Map<string, ModelEventResult>();
    let nativeDispatches = 0;
    const host = {
      runModel: async (key: string) => {
        const prior = nativeResults.get(key);
        if (prior) return prior;
        nativeDispatches += 1;
        const result = { file: "stable.tsx" };
        nativeResults.set(key, result);
        return result;
      },
    };
    await expect(
      createDesignReviewDriver({
        session: "s",
        transport: transport([event("generate", "stable")]),
        journal: state,
        host,
      }).run(),
    ).rejects.toThrow("journal down");
    await createDesignReviewDriver({
      session: "s",
      transport: transport([event("exit")]),
      journal: state,
      host,
    }).run();
    expect(nativeDispatches).toBe(1);
  });

  test("rejects corrupt matching journal records and protocol order before process or model", async () => {
    const corruptBranches = [
      [
        {
          customType: DESIGN_REVIEW_ENTRY_TYPE,
          data: { version: 1, session: "s", kind: "exit" },
        },
      ],
      [entry({ version: 1, session: "s", kind: "ack", eventId: "missing" })],
      [
        entry({
          version: 1,
          session: "s",
          kind: "event",
          sequence: 0,
          eventId: "wrong",
          event: event("generate", "actual"),
        }),
      ],
      [
        entry({
          version: 1,
          session: "s",
          kind: "event",
          sequence: 1,
          eventId: "one",
          event: event("generate", "one"),
        }),
        entry({
          version: 1,
          session: "s",
          kind: "event",
          sequence: 0,
          eventId: "two",
          event: event("steer", "two"),
        }),
      ],
    ];
    for (const branch of corruptBranches) {
      const helper = transport([event("exit")]);
      let modeled = false;
      await expect(
        createDesignReviewDriver({
          session: "s",
          transport: helper,
          journal: journal(branch),
          host: {
            runModel: async () => {
              modeled = true;
              return {};
            },
          },
        }).run(),
      ).rejects.toThrow("Corrupt design review journal record");
      expect(helper.polls).toBe(0);
      expect(modeled).toBe(false);
    }
  });

  test("poll-triggered abort returning exit never journals false success", async () => {
    const controller = new AbortController();
    const state = journal();
    const helper: LiveHelperTransport = {
      poll: async () => {
        controller.abort();
        return event("exit");
      },
      reply: async () => {},
    };
    await expect(
      createDesignReviewDriver({
        session: "s",
        transport: helper,
        journal: state,
        host: { runModel: async () => ({}) },
      }).run(controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(state.entries).toEqual([]);
  });

  test("abort rejects before helper exit", async () => {
    const controller = new AbortController();
    controller.abort();
    const helper = transport([event("exit")]);
    await expect(
      createDesignReviewDriver({
        session: "s",
        transport: helper,
        journal: journal(),
        host: { runModel: async () => ({}) },
      }).run(controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(helper.polls).toBe(0);
  });
});
