import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@code-yeongyu/senpi";
import repetitionRecovery from "../src/index.ts";
import { createRecovery, type RecoveryContext } from "../src/recovery.ts";
import { journal, selectionActorDigest } from "../src/journal.ts";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const agentDir = mkdtempSync(join(tmpdir(), "repetition-recovery-"));
  directories.push(agentDir);
  const entries: {
    type: string;
    id: string;
    customType?: string;
    message?: { role: string };
    details?: unknown;
    data?: unknown;
    provider?: string;
    modelId?: string;
    source?: string;
    actor?: string;
  }[] = [
    { type: "message", id: "user-1", message: { role: "user" } },
    {
      type: "custom_message",
      id: "correction",
      customType: "ttsr-injection",
      details: { rules: ["collapse-repetition"] },
    },
  ];
  const stop = {
    type: "custom",
    id: "failure",
    customType: "ttsr-loop-stopped",
    data: { rules: ["collapse-repetition"], secret: "PRIVATE" },
  };
  const models = [
    { provider: "test", id: "primary" },
    { provider: "test", id: "fallback" },
    { provider: "test", id: "explicit" },
  ];
  let model = models[0];
  const requests: string[] = [];
  const notices: string[] = [];
  const host = {
    current: (): RecoveryContext<(typeof models)[number]> => context(),
    select: async (selected: typeof model) => {
      model = selected;
      entries.push({
        type: "model_change",
        id: `selection-${entries.length}`,
        provider: selected.provider,
        modelId: selected.id,
        source: "extension",
        actor: "repetition-recovery",
      });
      return true;
    },
    send: () => {
      requests.push(model.id);
    },
    notify: (message: string) => {
      notices.push(message);
    },
  };
  const state = { sessionId: "session-1", pending: false };
  const context = () => ({
    agentDir,
    ...state,
    entries,
    model,
    models,
  });
  const exhaust = (recovery: ReturnType<typeof createRecovery>) => {
    recovery.started(context());
    entries.push(stop);
    recovery.stopped({ rules: ["collapse-repetition"] }, context());
  };
  return {
    agentDir,
    entries,
    stop,
    requests,
    notices,
    host,
    context,
    state,
    exhaust,
    models,
    choose: async (id: string, source = "command", actor = "person") => {
      const selected = models.find((item) => item.id === id);
      if (!selected) throw new Error("Missing fixture model");
      await host.select(selected);
      const entry = entries.at(-1);
      if (entry) Object.assign(entry, { source, actor });
    },
    model: () => model,
  };
}

test.each([undefined, "", "test/fallback", "PRIVATE/unknown", "test/primary"])(
  "activation reports selector state without copying selector %j",
  async (selector) => {
    const f = fixture();
    const notices: string[] = [];
    const settings = SettingsManager.inMemory({ enabledBuiltinExtensions: [] });
    const registry = new ModelRegistry(
      await ModelRuntime.create({
        agentDir: f.agentDir,
        modelsPath: null,
        refreshOnCreate: false,
      }),
    );
    registry.registerProvider("test", {
      api: "openai-completions",
      apiKey: "PRIVATE key",
      baseUrl: "http://invalid.test",
      models: ["primary", "fallback"].map((id) => ({
        id,
        name: id,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100000,
        maxTokens: 1000,
      })),
    });
    const loader = new DefaultResourceLoader({
      cwd: f.agentDir,
      agentDir: f.agentDir,
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        (pi) =>
          pi.on("session_start", (_event, ctx) => {
            ctx.ui.notify = (message) => notices.push(message);
          }),
        repetitionRecovery,
      ],
    });
    await loader.reload();
    if (selector !== undefined)
      loader
        .getExtensions()
        .runtime.flagValues.set("repetition-recovery-model", selector);
    const { session } = await createAgentSession({
      cwd: f.agentDir,
      agentDir: f.agentDir,
      model: registry.find("test", "primary"),
      modelRegistry: registry,
      settingsManager: settings,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(f.agentDir),
      tools: [],
      autoTitleSessions: false,
    });
    try {
      await session.bindExtensions({});
      const state =
        selector === undefined || selector === ""
          ? "disabled:"
          : selector === "test/fallback"
            ? "enabled:"
            : "held:";
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain(state);
      expect(notices.join("\n")).not.toContain("PRIVATE");
      expect(readdirSync(f.agentDir)).not.toContain("logs");
    } finally {
      session.dispose();
    }
  },
);

test.each(["input", "shutdown", "session abort"])(
  "restores a late fallback switch after %s without continuation",
  async () => {
    const f = fixture();
    const selecting = Promise.withResolvers<void>();
    const selected = Promise.withResolvers<void>();
    const recovery = createRecovery(
      {
        ...f.host,
        select: async (model) => {
          if (model.id === "fallback") {
            selecting.resolve();
            await selected.promise;
          }
          return f.host.select(model);
        },
      },
      "test/fallback",
    );
    f.exhaust(recovery);
    const settling = recovery.settled(f.context());
    await selecting.promise;
    // Must return while the model-selection hook is still pending.
    await recovery.interrupted(f.context());
    selected.resolve();
    await settling;
    expect(f.requests).toEqual([]);
    expect(f.model().id).toBe("primary");
    expect(journal(f.agentDir, "session-1:user-1").read()).toMatchObject({
      outcome: "interrupted",
      restoration: "restored",
    });
  },
);

test("does not claim historical exhaustion after load and unrelated settlement", async () => {
  const f = fixture();
  f.entries.push(f.stop);
  const recovery = createRecovery(f.host, "test/fallback");
  await recovery.resumed(f.context());
  recovery.started(f.context());
  await recovery.settled(f.context());
  expect(f.requests).toEqual([]);
  expect(readdirSync(f.agentDir)).toEqual([]);
});

test("does not claim a fresh stop entry without its native event", async () => {
  const f = fixture();
  const recovery = createRecovery(f.host, "test/fallback");
  recovery.started(f.context());
  f.entries.push(f.stop);
  await recovery.settled(f.context());
  expect(f.requests).toEqual([]);
  expect(readdirSync(f.agentDir)).toEqual([]);
});

test("preserves the initial correction and claims only exhausted recovery", async () => {
  const f = fixture();
  const recovery = createRecovery(f.host, "test/fallback");
  recovery.started(f.context());
  await recovery.settled(f.context());
  expect(f.requests).toEqual([]);
  f.entries.push(f.stop);
  recovery.stopped({ rules: ["collapse-repetition"] }, f.context());
  await recovery.settled(f.context());
  expect(f.requests).toEqual(["fallback"]);
  expect(f.model().id).toBe("fallback");
});

test("disk claims prevent another continuation after reload", async () => {
  const f = fixture();
  const recovery = createRecovery(f.host, "test/fallback");
  f.exhaust(recovery);
  await recovery.settled(f.context());
  await createRecovery(f.host, "test/fallback").resumed(f.context());
  expect(f.requests).toEqual(["fallback"]);
  expect(f.model().id).toBe("primary");
});

test("refused continuation restores the original model without another attempt", async () => {
  const f = fixture();
  const recovery = createRecovery(f.host, "test/fallback");
  f.exhaust(recovery);
  await recovery.settled(f.context());
  await recovery.refused(f.context());
  await recovery.settled(f.context());
  expect(f.requests).toEqual(["fallback"]);
  expect(f.model().id).toBe("primary");
});

test("duplicate engine refusals do not repeat held attempt notices", async () => {
  const f = fixture();
  const recovery = createRecovery(
    {
      ...f.host,
      select: (model) =>
        model.id === "primary" ? Promise.resolve(false) : f.host.select(model),
    },
    "test/fallback",
  );
  f.exhaust(recovery);
  await recovery.settled(f.context());
  await recovery.refused();
  await recovery.refused();
  expect(
    f.notices.filter((message) =>
      message.startsWith("Repetition recovery held:"),
    ),
  ).toHaveLength(1);
  expect(journal(f.agentDir, "session-1:user-1").read()).toMatchObject({
    outcome: "engine-refused",
    restoration: "held",
  });
});

test("a requested continuation without agent start never records admission", async () => {
  const f = fixture();
  const recovery = createRecovery(f.host, "test/fallback");
  f.exhaust(recovery);
  await recovery.settled(f.context());
  const store = journal(f.agentDir, "session-1:user-1");
  expect(store.read()?.event).toBe("continuation_requested");
  await recovery.settled(f.context());
  expect(store.read()).toMatchObject({
    event: "outcome",
    outcome: "not-admitted",
    restoration: "restored",
  });
  const records = readFileSync(
    join(
      f.agentDir,
      "logs",
      "repetition-recovery",
      `${store.correlation}.jsonl`,
    ),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(
    records.filter((record) => record.event === "continuation_admitted"),
  ).toEqual([]);
});

test("records actual admission and outcome without copying detector payloads", async () => {
  const f = fixture();
  f.entries.unshift({
    type: "custom",
    id: "historical-failure",
    customType: "ttsr-loop-stopped",
    data: { rules: ["collapse-repetition"], secret: "PRIVATE" },
  });
  const recovery = createRecovery(f.host, "test/fallback");
  f.exhaust(recovery);
  await recovery.settled(f.context());
  recovery.started(f.context());
  recovery.ended("settled");
  await recovery.settled(f.context());
  const directory = join(f.agentDir, "logs", "repetition-recovery");
  const records = readFileSync(
    join(directory, readdirSync(directory)[0]),
    "utf8",
  );
  expect(records).not.toContain("PRIVATE");
  const parsed = records
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(parsed.map((record) => record.event)).toEqual([
    "failure",
    "recovery_action",
    "recovery_action",
    "continuation_requested",
    "continuation_admitted",
    "outcome",
    "outcome",
  ]);
  expect(parsed.at(-1).outcome).toBe("settled");
  expect(f.model().id).toBe("primary");
});

test.each(["missing/model", "test/primary", ""])(
  "does not continue with unavailable or identical fallback %s",
  async (selector) => {
    const f = fixture();
    const recovery = createRecovery(f.host, selector);
    f.exhaust(recovery);
    await recovery.settled(f.context());
    expect(f.requests).toEqual([]);
    expect(f.notices).toHaveLength(1);
  },
);

test("reports when pending input blocks a fresh recovery request", async () => {
  const f = fixture();
  const recovery = createRecovery(f.host, "test/fallback");
  f.exhaust(recovery);
  f.state.pending = true;
  await recovery.settled(f.context());
  expect(f.requests).toEqual([]);
  expect(f.notices).toEqual([
    "Repetition recovery held: another message is pending.",
  ]);
});

test("new user input supersedes a pending continuation", async () => {
  const f = fixture();
  const recovery = createRecovery(f.host, "test/fallback");
  f.exhaust(recovery);
  await recovery.settled(f.context());
  f.entries.push({ type: "message", id: "user-2", message: { role: "user" } });
  await recovery.settled(f.context());
  expect(f.requests).toEqual(["fallback"]);
  expect(f.model().id).toBe("primary");
});

test.each([
  "event without entry",
  "entry before run",
  "event before run",
  "pending at event",
  "malformed event",
  "unsupported rule",
  "mismatched rule",
  "missing injection",
  "injection after stop",
  "different branch at event",
] as const)("does not claim uncorrelated exhaustion: %s", async (scenario) => {
  const f = fixture();
  const recovery = createRecovery(f.host, "test/fallback");
  let event: unknown = { rules: ["collapse-repetition"] };
  if (scenario === "entry before run") f.entries.push(f.stop);
  recovery.started(f.context());
  switch (scenario) {
    case "event without entry":
      recovery.stopped(event, f.context());
      f.entries.push(f.stop);
      break;
    case "event before run":
      await recovery.resumed(f.context());
      f.entries.push(f.stop);
      recovery.stopped(event, f.context());
      break;
    case "entry before run":
      recovery.stopped(event, f.context());
      break;
    case "pending at event":
      f.state.pending = true;
      f.entries.push(f.stop);
      recovery.stopped(event, f.context());
      f.state.pending = false;
      recovery.stopped(event, f.context());
      break;
    case "malformed event":
    case "unsupported rule":
    case "mismatched rule":
    case "missing injection":
    case "injection after stop":
    case "different branch at event": {
      if (scenario === "malformed event") event = null;
      if (scenario === "unsupported rule") event = { rules: ["tool-loop"] };
      if (scenario === "mismatched rule")
        event = { rules: ["repetitive-turns"] };
      const correction = f.entries.pop();
      if (
        correction &&
        scenario !== "missing injection" &&
        scenario !== "injection after stop"
      )
        f.entries.push(correction);
      if (scenario === "different branch at event")
        f.entries[1] = { type: "custom", id: "sibling" };
      f.entries.push(f.stop);
      recovery.stopped(event, f.context());
      if (scenario === "injection after stop" && correction)
        f.entries.push(correction);
      break;
    }
  }
  await recovery.settled(f.context());
  expect(f.requests).toEqual([]);
  if (scenario === "pending at event")
    expect(f.notices).toEqual([
      "Repetition recovery held: another message is pending.",
    ]);
  expect(readdirSync(f.agentDir)).toEqual([]);
});

test.each(["collapse-repetition", "repetitive-turns"] as const)(
  "allows one fresh supported exhaustion for %s",
  async (rule) => {
    const f = fixture();
    const correction = f.entries[1];
    if (correction) correction.details = { rules: [rule] };
    f.stop.data.rules = [rule];
    const recovery = createRecovery(f.host, "test/fallback");
    recovery.started(f.context());
    f.entries.push(f.stop);
    recovery.stopped({ rules: [rule] }, f.context());
    // The native pause follows the synchronous stop event.
    f.entries.push({
      type: "custom",
      id: "pause",
      customType: "engine-paused",
    });
    await recovery.settled(f.context());
    await recovery.refused(f.context());
    recovery.started(f.context());
    f.entries.push({ ...f.stop, id: "second-stop" });
    recovery.stopped({ rules: [rule] }, f.context());
    await recovery.settled(f.context());
    expect(f.requests).toEqual(["fallback"]);
    expect(f.model().id).toBe("primary");
    expect(
      readdirSync(join(f.agentDir, "logs", "repetition-recovery")),
    ).toHaveLength(1);
  },
);

test.each(["claim", "append", "read"] as const)(
  "journal %s strips unknown nested fields and private outcome text",
  (operation) => {
    const f = fixture();
    const store = journal(f.agentDir, "session-1:user-1");
    const saved = {
      event: "outcome",
      correlation: store.correlation,
      at: "2026-11-05T20:00:00.000Z",
      original: { provider: "test", id: "primary" },
      fallback: { provider: "test", id: "fallback" },
      rule: "collapse-repetition",
      detectorMetadata: "rule-only",
      restoration: "held",
      boundaryId: "failure",
      selectionId: "selection-1",
      selectionActor: selectionActorDigest("/tmp/PRIVATE/extension.ts"),
    } as const;
    const contaminated = {
      ...saved,
      original: { ...saved.original, credentials: { token: "PRIVATE" } },
      fallback: { ...saved.fallback, prompt: "PRIVATE" },
      error: { message: "PRIVATE" },
      outcome: "PRIVATE provider exception",
      selectionActor: "/tmp/PRIVATE/extension.ts",
    };
    const path = join(
      f.agentDir,
      "logs",
      "repetition-recovery",
      `${store.correlation}.jsonl`,
    );
    if (operation === "claim") store.claim(contaminated);
    else {
      store.claim(saved);
      if (operation === "append") store.append(contaminated);
      else writeFileSync(path, JSON.stringify(contaminated));
    }
    expect(store.read()).toEqual(saved);
    expect(JSON.stringify(store.read())).not.toContain("PRIVATE");
    if (operation !== "read")
      expect(readFileSync(path, "utf8")).not.toContain("PRIVATE");
  },
);

test.each(["raw", "digest"] as const)(
  "reload restores owned fallback with %s actor identity without replay",
  async (format) => {
    const f = fixture();
    const actor = "/tmp/PRIVATE/recovery.ts";
    const store = journal(f.agentDir, "session-1:user-1");
    store.claim({
      event: "failure",
      correlation: store.correlation,
      at: "",
      original: f.models[0],
      rule: "collapse-repetition",
      detectorMetadata: "rule-only",
    });
    await f.choose("fallback", "extension", actor);
    const selectionId = f.entries.at(-1)?.id;
    const beforeRestore = f.entries.map((entry) => entry.id);
    const logPath = join(
      f.agentDir,
      "logs",
      "repetition-recovery",
      `${store.correlation}.jsonl`,
    );
    writeFileSync(
      logPath,
      `${JSON.stringify({
        ...store.read(),
        event: "outcome",
        outcome: "settled",
        fallback: f.models[1],
        restoration: "held",
        boundaryId: "correction",
        selectionId,
        selectionActor: format === "raw" ? actor : selectionActorDigest(actor),
      })}\n`,
    );
    await createRecovery(
      {
        ...f.host,
        select: async (model) => {
          const selected = await f.host.select(model);
          const entry = f.entries.find(
            (item, index) =>
              item.type === "model_change" &&
              !beforeRestore.includes(item.id) &&
              index === f.entries.length - 1,
          );
          if (entry) entry.actor = actor;
          return selected;
        },
      },
      "test/fallback",
    ).resumed(f.context());
    expect(f.model().id).toBe("primary");
    expect(f.requests).toEqual([]);
    expect(store.read()).toMatchObject({
      outcome: "settled",
      restoration: "restored",
      selectionActor: selectionActorDigest(actor),
    });
    expect(JSON.stringify(store.read())).not.toContain("PRIVATE");
  },
);

test.each([
  "session",
  "user",
  "branch",
  "pending",
  "deadline",
  "input",
  "cancellation",
  "new run",
] as const)(
  "does not claim superseded evidence before selection: %s",
  async (scenario) => {
    const f = fixture();
    const recovery = createRecovery(f.host, "test/fallback");
    f.exhaust(recovery);
    const staleContext = { ...f.context(), entries: [...f.entries] };
    switch (scenario) {
      case "session":
        f.state.sessionId = "session-2";
        break;
      case "user":
        f.entries.push({
          type: "message",
          id: "user-2",
          message: { role: "user" },
        });
        break;
      case "branch":
        f.entries[1] = { type: "custom", id: "branch-switch" };
        break;
      case "pending":
        f.state.pending = true;
        break;
      case "deadline":
        f.entries.push({
          type: "custom",
          id: "deadline",
          customType: "deadline-stop",
        });
        break;
      case "input":
        await recovery.interrupted(f.context());
        break;
      case "cancellation":
        recovery.invalidate();
        break;
      case "new run":
        recovery.started(f.context());
        break;
    }
    await recovery.settled(staleContext);
    // Superseded evidence stays invalid after the competing state disappears.
    f.state.sessionId = staleContext.sessionId;
    f.state.pending = false;
    f.entries.splice(0, f.entries.length, ...staleContext.entries);
    await recovery.settled(f.context());
    expect(f.requests).toEqual([]);
    expect(readdirSync(f.agentDir)).toEqual([]);
  },
);

test.each([
  "pending",
  "session",
  "user",
  "branch",
  "deadline",
  "new run",
] as const)(
  "rechecks live eligibility after awaited selection: %s",
  async (scenario) => {
    const f = fixture();
    const selected = Promise.withResolvers<void>();
    const selecting = Promise.withResolvers<void>();
    const recovery = createRecovery(
      {
        ...f.host,
        select: async (model) => {
          if (model.id === "fallback") {
            selecting.resolve();
            await selected.promise;
          }
          return f.host.select(model);
        },
      },
      "test/fallback",
    );
    f.exhaust(recovery);
    const settling = recovery.settled(f.context());
    await selecting.promise;
    switch (scenario) {
      case "pending":
        f.state.pending = true;
        break;
      case "session":
        f.state.sessionId = "session-2";
        break;
      case "user":
        f.entries.push({
          type: "message",
          id: "user-2",
          message: { role: "user" },
        });
        break;
      case "branch":
        f.entries[1] = { type: "custom", id: "sibling" };
        break;
      case "deadline":
        f.entries.push({
          type: "custom",
          id: "deadline",
          customType: "deadline-stop",
        });
        break;
      case "new run":
        recovery.started(f.context());
        break;
    }
    selected.resolve();
    await settling;
    expect(f.requests).toEqual([]);
    if (scenario === "pending")
      expect(f.notices).toContain(
        "Repetition recovery held: another message is pending.",
      );
    expect(f.model().id).toBe(scenario === "session" ? "fallback" : "primary");
    expect(
      readdirSync(join(f.agentDir, "logs", "repetition-recovery")),
    ).toHaveLength(1);
  },
);

test.each([
  ["fallback", "command", "person"],
  ["explicit", "picker", "person"],
  ["fallback", "extension", "another-extension"],
] as const)(
  "preserves committed newer choice %s from %s/%s",
  async (model, source, actor) => {
    const f = fixture();
    const recovery = createRecovery(f.host, "test/fallback");
    f.exhaust(recovery);
    await recovery.settled(f.context());
    await f.choose(model, source, actor);
    await recovery.refused(f.context());
    expect(f.model().id).toBe(model);
    expect(f.requests).toEqual(["fallback"]);
    expect(journal(f.agentDir, "session-1:user-1").read()).toMatchObject({
      outcome: "engine-refused",
      restoration: "superseded",
    });
  },
);

test("reconciles a committed explicit choice before a late fallback lands", async () => {
  const f = fixture();
  const selecting = Promise.withResolvers<void>();
  const selected = Promise.withResolvers<void>();
  const recovery = createRecovery(
    {
      ...f.host,
      select: async (model) => {
        if (model.id === "fallback") {
          selecting.resolve();
          await selected.promise;
        }
        return f.host.select(model);
      },
    },
    "test/fallback",
  );
  f.exhaust(recovery);
  const settling = recovery.settled(f.context());
  await selecting.promise;
  await f.choose("explicit");
  await recovery.interrupted(f.context());
  selected.resolve();
  await settling;
  expect(f.model().id).toBe("explicit");
  expect(f.requests).toEqual([]);
  expect(journal(f.agentDir, "session-1:user-1").read()).toMatchObject({
    outcome: "interrupted",
    restoration: "superseded",
  });
});

test("preserves a same-fallback explicit choice racing deferred restoration", async () => {
  const f = fixture();
  const restoring = Promise.withResolvers<void>();
  const restored = Promise.withResolvers<void>();
  const recovery = createRecovery(
    {
      ...f.host,
      select: async (model) => {
        if (model.id === "primary") {
          restoring.resolve();
          await restored.promise;
        }
        return f.host.select(model);
      },
    },
    "test/fallback",
  );
  f.exhaust(recovery);
  await recovery.settled(f.context());
  const refusing = recovery.refused(f.context());
  await restoring.promise;
  // A nested input hook must not wait on the selection that invoked it.
  await recovery.interrupted(f.context());
  await f.choose("fallback");
  restored.resolve();
  await refusing;
  expect(f.model().id).toBe("fallback");
  expect(f.requests).toEqual(["fallback"]);
  expect(journal(f.agentDir, "session-1:user-1").read()).toMatchObject({
    outcome: "engine-refused",
    restoration: "superseded",
  });
});

test.each(["missing", "rejected", "throw", "disposed"] as const)(
  "reload reconciles prior-user held restoration after %s without replay",
  async (failure) => {
    const f = fixture();
    let failing = false;
    const recovery = createRecovery(
      {
        ...f.host,
        current: () => {
          if (failing && failure === "disposed")
            throw new Error("PRIVATE disposed context");
          const ctx = f.context();
          return failure === "missing" && failing
            ? {
                ...ctx,
                models: ctx.models.filter((model) => model.id !== "primary"),
              }
            : ctx;
        },
        select: async (model) => {
          if (failing && model.id === "primary") {
            if (failure === "throw") throw new Error("PRIVATE provider detail");
            if (failure === "rejected") return false;
          }
          return f.host.select(model);
        },
      },
      "test/fallback",
    );
    f.exhaust(recovery);
    await recovery.settled(f.context());
    recovery.started(f.context());
    recovery.ended("settled");
    failing = true;
    await recovery.settled(f.context());
    const store = journal(f.agentDir, "session-1:user-1");
    expect(store.read()).toMatchObject({
      outcome: "settled",
      restoration: "held",
    });
    expect(f.notices).toContain(
      "Repetition recovery could not restore the session model. Restoration is held for session reload.",
    );
    f.entries.push({
      type: "message",
      id: "user-2",
      message: { role: "user" },
    });
    await createRecovery(f.host, "test/fallback").resumed(f.context());
    expect(store.read()).toMatchObject({
      outcome: "settled",
      restoration: "restored",
    });
    expect(f.model().id).toBe("primary");
    expect(f.requests).toEqual(["fallback"]);
    const directory = join(f.agentDir, "logs", "repetition-recovery");
    expect(readdirSync(directory)).toHaveLength(1);
    expect(
      readFileSync(join(directory, `${store.correlation}.jsonl`), "utf8"),
    ).not.toContain("PRIVATE");
  },
);

test.each(["false", "throw"] as const)(
  "selection %s remains spent without continuation",
  async (result) => {
    const f = fixture();
    const recovery = createRecovery(
      {
        ...f.host,
        select: async (model) => {
          if (model.id === "fallback") {
            if (result === "throw") throw new Error("PRIVATE failure");
            return false;
          }
          return f.host.select(model);
        },
      },
      "test/fallback",
    );
    f.exhaust(recovery);
    await recovery.settled(f.context());
    expect(f.model().id).toBe("primary");
    expect(f.requests).toEqual([]);
    expect(f.notices).toContain(
      "Repetition recovery held: the fallback could not be selected. No continuation was requested.",
    );
    expect(journal(f.agentDir, "session-1:user-1").read()).toMatchObject({
      outcome:
        result === "throw"
          ? "model-selection-failed"
          : "model-selection-rejected",
      restoration: "restored",
    });
  },
);

test("legacy terminal claims remain spent with restoration unknown", async () => {
  const f = fixture();
  await f.choose("fallback");
  const store = journal(f.agentDir, "session-1:user-1");
  store.claim({
    event: "outcome",
    correlation: store.correlation,
    at: "",
    original: { provider: "test", id: "primary" },
    fallback: { provider: "test", id: "fallback" },
    rule: "collapse-repetition",
    detectorMetadata: "rule-only",
    outcome: "completed",
  });
  const recovery = createRecovery(f.host, "test/fallback");
  await recovery.resumed(f.context());
  f.exhaust(recovery);
  await recovery.settled(f.context());
  expect(f.requests).toEqual([]);
  expect(f.model().id).toBe("fallback");
  expect(store.read()?.outcome).toBe("completed");
  expect(store.read()?.restoration).toBeUndefined();
});

test.each(["", "{", '{"event":"outcome"}', '{"restoration":"invalid"}'])(
  "malformed journal %j holds without switching or replacing claim",
  async (content) => {
    const f = fixture();
    const store = journal(f.agentDir, "session-1:user-1");
    store.claim({
      event: "failure",
      correlation: store.correlation,
      at: "",
      original: { provider: "test", id: "primary" },
      rule: "collapse-repetition",
      detectorMetadata: "rule-only",
    });
    const path = join(
      f.agentDir,
      "logs",
      "repetition-recovery",
      `${store.correlation}.jsonl`,
    );
    writeFileSync(path, content);
    const recovery = createRecovery(f.host, "test/fallback");
    await expect(recovery.resumed(f.context())).rejects.toThrow();
    f.exhaust(recovery);
    await expect(recovery.settled(f.context())).rejects.toThrow();
    expect(readFileSync(path, "utf8")).toBe(content);
    expect(f.model().id).toBe("primary");
    expect(f.requests).toEqual([]);
  },
);

test("storage failure before claim cannot switch models", async () => {
  const f = fixture();
  writeFileSync(join(f.agentDir, "logs"), "not a directory");
  const recovery = createRecovery(f.host, "test/fallback");
  f.exhaust(recovery);
  await expect(recovery.settled(f.context())).rejects.toThrow();
  expect(f.model().id).toBe("primary");
  expect(f.requests).toEqual([]);
});

test.each([
  "switch-pending",
  "pending",
  "restored",
  "superseded",
  "held",
] as const)(
  "journal preserves independent restoration %s and committed ownership metadata",
  (restoration) => {
    const f = fixture();
    const store = journal(f.agentDir, "session-1:user-1");
    const saved = {
      event: "outcome",
      correlation: store.correlation,
      at: "",
      original: { provider: "test", id: "primary" },
      fallback: { provider: "test", id: "fallback" },
      rule: "collapse-repetition",
      detectorMetadata: "rule-only",
      outcome: "aborted",
      restoration,
      boundaryId: "failure",
      selectionId: "selection-1",
      selectionActor: "repetition-recovery",
    } as const;
    expect(store.claim(saved)).toBe(true);
    expect(store.read()).toEqual({
      ...saved,
      selectionActor: selectionActorDigest(saved.selectionActor),
    });
    expect(store.claim(saved)).toBe(false);
  },
);

test("reload holds an unconfirmed switch without overwriting another extension choice", async () => {
  const f = fixture();
  f.entries.push(f.stop);
  const store = journal(f.agentDir, "session-1:user-1");
  store.claim({
    event: "recovery_action",
    correlation: store.correlation,
    at: "",
    original: { provider: "test", id: "primary" },
    fallback: { provider: "test", id: "fallback" },
    rule: "collapse-repetition",
    detectorMetadata: "rule-only",
    boundaryId: "failure",
    restoration: "switch-pending",
  });
  await f.choose("fallback", "extension", "another-extension");
  await createRecovery(f.host, "test/fallback").resumed(f.context());
  expect(f.model().id).toBe("fallback");
  expect(f.requests).toEqual([]);
  expect(store.read()).toMatchObject({
    outcome: "interrupted-or-not-admitted",
    restoration: "held",
  });
});

test("rejected fallback preserves another extension's committed same-model choice", async () => {
  const f = fixture();
  const selecting = Promise.withResolvers<void>();
  const selected = Promise.withResolvers<void>();
  const recovery = createRecovery(
    {
      ...f.host,
      select: async (model) => {
        if (model.id !== "fallback") return f.host.select(model);
        selecting.resolve();
        await selected.promise;
        return false;
      },
    },
    "test/fallback",
  );
  f.exhaust(recovery);
  const settling = recovery.settled(f.context());
  await selecting.promise;
  await f.choose("fallback", "extension", "another-extension");
  selected.resolve();
  await settling;
  expect(f.model().id).toBe("fallback");
  expect(f.requests).toEqual([]);
  expect(journal(f.agentDir, "session-1:user-1").read()).toMatchObject({
    outcome: "model-selection-rejected",
    restoration: "superseded",
  });
});
