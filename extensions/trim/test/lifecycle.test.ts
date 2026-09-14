import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@code-yeongyu/senpi";
import type { TrimConfig } from "../src/config.ts";
import { registerTrim } from "../src/index.ts";

type EventName =
  | "agent_settled"
  | "session_compact"
  | "session_compact_failed"
  | "session_shutdown"
  | "session_tree";
type CompactOptions = Parameters<ExtensionContext["compact"]>[0];
type Handler = (event: never, ctx: never) => void;
type RegisteredCommand = Parameters<ExtensionAPI["registerCommand"]>[1];

function lifecycleFixture(config: TrimConfig) {
  const handlers = new Map<EventName, Handler>();
  let command: RegisteredCommand | undefined;
  let policy = config;
  let sessionId = "session-a";
  const leafId = "leaf-a";
  let revision = 1;
  let compacting = false;
  let tokens = 100;
  let branch = [{ id: leafId, type: "message" }];
  const compactCalls: (CompactOptions | undefined)[] = [];
  const notices: { readonly message: string; readonly type?: string }[] = [];
  const host = {
    on(name: EventName, handler: Handler) {
      handlers.set(name, handler);
    },
    registerCommand(_name: string, definition: RegisteredCommand) {
      command = definition;
    },
  };
  const context = {
    hasUI: true,
    mode: "tui",
    isIdle: () => true,
    hasPendingMessages: () => false,
    isCompacting: () => compacting,
    getContextUsage: () => ({ tokens, contextWindow: 200 }),
    getMessageRevision: () => revision,
    compact(options: CompactOptions) {
      compacting = true;
      compactCalls.push(options);
    },
    sessionManager: {
      getSessionId: () => sessionId,
      getLeafId: () => leafId,
      getEntry: (id: string) => branch.find((entry) => entry.id === id),
      getBranch: () => branch,
    },
    ui: {
      select: async () => "automatic",
      input: async () => String(policy.thresholdTokens),
      confirm: async () => true,
      notify: (message: string, type?: string) =>
        notices.push({ message, type }),
    },
  };
  registerTrim(host as never, {
    load: () => policy,
    save: (next) => {
      policy = next;
    },
  });
  if (command === undefined)
    throw new Error("Trim command was not registered.");
  return {
    command,
    compactCalls,
    context,
    emit(name: EventName, event: never) {
      const handler = handlers.get(name);
      if (handler === undefined) throw new Error(`Missing ${name} handler.`);
      handler(event, context as never);
    },
    notices,
    setBranch(next: typeof branch) {
      branch = next;
    },
    setCompacting(next: boolean) {
      compacting = next;
    },
    setRevision(next: number) {
      revision = next;
    },
    setSession(next: string) {
      sessionId = next;
    },
    setTokens(next: number) {
      tokens = next;
    },
  };
}

function settle(fixture: ReturnType<typeof lifecycleFixture>): void {
  fixture.emit("agent_settled", { type: "agent_settled" } as never);
}

function compactEvent(id: string, willRetry = false): never {
  return {
    type: "session_compact",
    accepted: true,
    compactionEntry: { id },
    willRetry,
  } as never;
}

test("Given bare trim and shake, when commands parse, then only bare opens Settings", async () => {
  const fixture = lifecycleFixture({
    strategy: "manual",
    thresholdTokens: 100,
  });

  await fixture.command.handler("", fixture.context as never);
  await fixture.command.handler("shake", fixture.context as never);
  await fixture.command.handler("shake extra", fixture.context as never);

  expect(fixture.notices.map((notice) => notice.type)).toEqual([
    "info",
    "warning",
    "error",
  ]);
});

test("Given manual policy, when Settings save automatic policy, then one safe eligibility evaluation starts compaction", async () => {
  const fixture = lifecycleFixture({
    strategy: "manual",
    thresholdTokens: 100,
  });

  await fixture.command.handler("", fixture.context as never);

  expect(fixture.compactCalls).toHaveLength(1);
});

test("Given persisted settled policy, when startup agent settles at threshold, then native compaction starts", () => {
  const fixture = lifecycleFixture({
    strategy: "settled",
    thresholdTokens: 100,
  });

  settle(fixture);

  expect(fixture.compactCalls).toHaveLength(1);
});

test("Given eligible settled boundaries, when same boundary settles twice then revision advances, then each work boundary schedules once", () => {
  const fixture = lifecycleFixture({
    strategy: "settled",
    thresholdTokens: 100,
  });

  settle(fixture);
  fixture.setCompacting(false);
  fixture.compactCalls[0]?.onComplete?.({} as never);
  settle(fixture);
  fixture.setRevision(2);
  settle(fixture);

  expect(fixture.compactCalls).toHaveLength(2);
});

test("Given native compaction commits before callback, when callback finishes, then durable result blocks duplicate work", () => {
  const fixture = lifecycleFixture({
    strategy: "settled",
    thresholdTokens: 100,
  });

  settle(fixture);
  fixture.setRevision(2);
  fixture.setBranch([
    { id: "leaf-a", type: "message" },
    { id: "compact-a", type: "compaction" },
  ]);
  fixture.emit("session_compact", compactEvent("compact-a"));
  fixture.setCompacting(false);
  fixture.compactCalls[0]?.onComplete?.({} as never);
  settle(fixture);

  expect(fixture.compactCalls).toHaveLength(1);
});

test("Given rejected or failed native work, when host signals outcome, then adapter never sends retry or user input", () => {
  const fixture = lifecycleFixture({
    strategy: "settled",
    thresholdTokens: 100,
  });

  settle(fixture);
  fixture.emit("session_compact", {
    type: "session_compact",
    accepted: false,
    willRetry: false,
  } as never);
  fixture.emit("session_compact_failed", {
    type: "session_compact_failed",
    aborted: true,
    willRetry: true,
  } as never);

  expect(fixture.compactCalls).toHaveLength(1);
});

test("Given queued progression and retry intent, when host retains compaction, then adapter observes without continuation", () => {
  const fixture = lifecycleFixture({
    strategy: "settled",
    thresholdTokens: 100,
  });

  settle(fixture);
  fixture.setRevision(2);
  fixture.setBranch([
    { id: "leaf-a", type: "message" },
    { id: "compact-a", type: "compaction" },
  ]);
  fixture.emit("session_compact", compactEvent("compact-a", true));
  fixture.setCompacting(false);
  fixture.compactCalls[0]?.onComplete?.({} as never);
  fixture.setTokens(150);
  settle(fixture);

  expect(fixture.compactCalls).toHaveLength(1);
});

test("Given stale tree or shutdown, when old callback or accepted event arrives, then it cannot schedule or erase current result", () => {
  const fixture = lifecycleFixture({
    strategy: "settled",
    thresholdTokens: 100,
  });

  settle(fixture);
  fixture.emit("session_tree", { type: "session_tree" } as never);
  fixture.setSession("session-b");
  fixture.setRevision(2);
  fixture.setBranch([{ id: "compact-b", type: "compaction" }]);
  fixture.emit("session_compact", compactEvent("compact-b"));
  fixture.compactCalls[0]?.onError?.(new Error("old callback"));
  fixture.emit("session_shutdown", { type: "session_shutdown" } as never);
  settle(fixture);

  expect(fixture.compactCalls).toHaveLength(1);
});
