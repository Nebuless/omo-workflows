import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  watch,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionContext,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@code-yeongyu/senpi";
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import repetitionRecovery from "../src/index.ts";
import { journal } from "../src/journal.ts";
import { createRecovery } from "../src/recovery.ts";

test("an uncommitted native fallback switch is cancelled without requesting a turn", async () => {
  const directory = mkdtempSync(join(tmpdir(), "recovery-pending-"));
  const settings = SettingsManager.inMemory({
    enabledBuiltinExtensions: [],
    compaction: { enabled: true, reserveTokens: 1024, keepRecentTokens: 512 },
    retry: { enabled: false },
  });
  const registry = new ModelRegistry(
    await ModelRuntime.create({
      agentDir: directory,
      modelsPath: null,
      refreshOnCreate: false,
    }),
  );
  registry.registerProvider("pending-test", {
    api: "openai-completions",
    apiKey: "local-fixture-key",
    baseUrl: "http://invalid.test",
    models: ["primary", "fallback"].map((id) => ({
      id,
      name: id,
      contextWindow: id === "primary" ? 100000 : 20000,
      reasoning: false,
      input: ["text"],
      maxTokens: 512,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
    streamSimple() {
      throw new Error("No provider request permitted");
    },
  });
  let context: ExtensionContext | undefined;
  let select:
    | ((model: NonNullable<ExtensionContext["model"]>) => Promise<boolean>)
    | undefined;
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "Fixture.",
    extensionFactories: [
      (pi) => {
        select = (model) => pi.setSessionModel(model);
        pi.on("session_start", (_event, ctx) => {
          context = ctx;
        });
      },
    ],
  });
  let session:
    | Awaited<ReturnType<typeof createAgentSession>>["session"]
    | undefined;
  try {
    await loader.reload();
    const manager = SessionManager.inMemory(directory);
    manager.appendMessage({
      role: "user",
      content: "Original conversation. ".repeat(5000),
      timestamp: 1,
    });
    manager.appendCustomMessageEntry("ttsr-injection", "Correction.", false, {
      rules: ["collapse-repetition"],
    });
    const primary = registry.find("pending-test", "primary");
    if (!primary) throw new Error("Missing primary model");
    ({ session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      settingsManager: settings,
      modelRegistry: registry,
      model: primary,
      resourceLoader: loader,
      sessionManager: manager,
      tools: [],
      autoTitleSessions: false,
    }));
    await session.bindExtensions({});
    const ctx = context;
    const selectModel = select;
    if (!ctx || !selectModel) throw new Error("Missing bound extension");
    const current = () => ({
      agentDir: directory,
      sessionId: manager.getSessionId(),
      entries: manager.getBranch(),
      model: ctx.model,
      models: registry.getAll(),
      pending: false,
    });
    const requests: string[] = [];
    let deferred = false;
    const recovery = createRecovery(
      {
        current,
        select: async (model) => {
          const selected = await selectModel(model);
          if (model.id === "fallback")
            deferred = session?.pendingModelSwitch?.model.id === "fallback";
          return selected;
        },
        send: () => {
          requests.push("sent");
        },
        notify: () => {},
      },
      "pending-test/fallback",
    );
    recovery.started(current());
    manager.appendCustomEntry("ttsr-loop-stopped", {
      rules: ["collapse-repetition"],
    });
    recovery.stopped({ rules: ["collapse-repetition"] }, current());
    await recovery.settled(current());
    expect(deferred).toBe(true);
    expect(session.model?.id).toBe("primary");
    expect(session.pendingModelSwitch).toBeUndefined();
    expect(requests).toEqual([]);
    const user = manager
      .getBranch()
      .find(
        (entry) => entry.type === "message" && entry.message.role === "user",
      );
    if (!user) throw new Error("Missing user entry");
    expect(
      journal(directory, `${manager.getSessionId()}:${user.id}`).read()
        ?.restoration,
    ).toBe("restored");
  } finally {
    session?.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});

test.each([
  "admitted",
  "same-model",
  "tool-stream",
  "other-rule",
  "capped",
  "repeated",
  "user-abort",
  "declared-deadline",
  "native-deadline",
  "cross-turn",
  "native-corrected",
])(
  "native guard and fallback remain bounded: %s",
  async (mode) => {
    const capped = mode === "capped";
    const directory = mkdtempSync(join(tmpdir(), "recovery-engine-"));
    const calls: string[] = [];
    const recoveryContexts: string[] = [];
    const stopBranches: ReturnType<SessionManager["getBranch"]>[] = [];
    const stopEvents: unknown[] = [];
    const notices: string[] = [];
    const extensionDeadlines: unknown[] = [];
    const subscriberDeadlines: unknown[] = [];
    const firstTurn =
      "The orchard keeper sorted fresh apples beside a wooden basket before the morning market opened.";
    const secondTurn =
      "An engineer measured river currents using calibrated instruments beneath the newly constructed suspension bridge.";
    const logs = join(directory, "logs", "repetition-recovery");
    mkdirSync(logs, { recursive: true });
    let outcomeWatcher: ReturnType<typeof watch> | undefined;
    const outcomeRecorded = new Promise<void>((resolve) => {
      outcomeWatcher = watch(logs, () => {
        const file = readdirSync(logs).find((name) => name.endsWith(".jsonl"));
        if (
          file &&
          readFileSync(join(logs, file), "utf8")
            .split("\n")
            .filter(Boolean)
            .some((line) => {
              const record = JSON.parse(line);
              return (
                record.event === "outcome" && record.restoration === "restored"
              );
            })
        )
          resolve();
      });
    });
    const settings = SettingsManager.inMemory({
      enabledBuiltinExtensions: ["ttsr"],
      retry: { enabled: false },
      compaction: { enabled: false },
      ...(mode === "native-deadline"
        ? { turn_max_runtime_ms: 250, turn_inactivity_ms: 0 }
        : {}),
      engineTurns: {
        maxPerUserInput: capped ? 1 : 150,
        maxToolFreePerMinute: 12,
      },
    });
    const registry = new ModelRegistry(
      await ModelRuntime.create({
        agentDir: directory,
        modelsPath: null,
        refreshOnCreate: false,
      }),
    );
    registry.registerProvider("recovery-test", {
      api: "openai-completions",
      apiKey: "fake-local-key",
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
      streamSimple: (model, providerContext, options) => {
        calls.push(model.id);
        if (calls.length > 6)
          throw new Error("Fixture exceeded bounded provider calls");
        if (calls.length === 3)
          recoveryContexts.push(JSON.stringify(providerContext.messages));
        const stream = createAssistantMessageEventStream();
        const text =
          mode === "other-rule"
            ? calls.length === 1
              ? "<unavailable-tool-call name=edit>fabricated call</unavailable-tool-call>"
              : "Continued with real available tools."
            : mode === "cross-turn"
              ? model.id === "fallback"
                ? "Recovered with a distinct useful answer."
                : calls.length === 1
                  ? firstTurn
                  : secondTurn
              : (model.id === "primary" &&
                    !(mode === "same-model" && calls.length === 3) &&
                    !(mode === "native-corrected" && calls.length === 2)) ||
                  mode === "repeated"
                ? "This is a deterministic repetitive fixture line with sufficient distinct characters.\n".repeat(
                    20,
                  )
                : "Recovered with a distinct useful answer.";
        const message: AssistantMessage = {
          role: "assistant",
          api: model.api,
          provider: model.provider,
          model: model.id,
          content: [{ type: "text", text }],
          stopReason: "stop",
          timestamp: 1,
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        };
        if (mode === "native-deadline") {
          const finish = () => {
            const aborted: AssistantMessage = {
              ...message,
              content: [],
              stopReason: "aborted",
            };
            stream.push({ type: "error", reason: "aborted", error: aborted });
            stream.end(aborted);
          };
          if (!options?.signal)
            throw new Error("Native deadline fixture requires cancellation");
          if (options.signal.aborted) finish();
          else options.signal.addEventListener("abort", finish, { once: true });
          return stream;
        }
        if (mode === "tool-stream" && model.id === "primary") {
          message.content = [
            {
              type: "toolCall",
              id: "blocked-call",
              name: "bash",
              arguments: { command: text },
            },
          ];
          stream.push({ type: "start", partial: message });
          stream.push({
            type: "toolcall_start",
            contentIndex: 0,
            partial: message,
          });
          stream.push({
            type: "toolcall_delta",
            contentIndex: 0,
            delta: text,
            partial: message,
          });
          stream.push({ type: "done", reason: "toolUse", message });
          stream.end(message);
          return stream;
        }
        stream.push({ type: "start", partial: message });
        stream.push({ type: "text_start", contentIndex: 0, partial: message });
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: text,
          partial: message,
        });
        stream.push({
          type: "text_end",
          contentIndex: 0,
          content: text,
          partial: message,
        });
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
        return stream;
      },
    });
    const loader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        (pi) => {
          pi.on("session_start", (_event, ctx) => {
            ctx.ui.notify = (message) => notices.push(message);
          });
          let context: ExtensionContext | undefined;
          pi.on("agent_start", (_event, ctx) => {
            context = ctx;
          });
          // Exercise declared extension metadata independently of the pinned
          // runtime's known omission of the deadline field.
          pi.on("agent_end", (event) => {
            if (mode === "native-deadline")
              extensionDeadlines.push(event.deadline);
            if (calls.length !== 2) return;
            if (mode === "user-abort") event.abortSource = "user";
            if (mode === "declared-deadline")
              event.deadline = {
                kind: "max_runtime",
                limitMs: 1,
                elapsedMs: 1,
              };
          });
          let crossTurnWakeRequested = false;
          pi.on("agent_settled", () => {
            if (
              mode === "cross-turn" &&
              calls.length === 2 &&
              !crossTurnWakeRequested
            ) {
              crossTurnWakeRequested = true;
              pi.sendMessage(
                {
                  customType: "fixture-wake",
                  content: "Continue the fixture.",
                  display: false,
                },
                { triggerTurn: true },
              );
            }
          });
          pi.events.on("ttsr:loop-stopped", (data) => {
            stopEvents.push(data);
            if (context)
              stopBranches.push([...context.sessionManager.getBranch()]);
          });
        },
        repetitionRecovery,
      ],
      systemPrompt: "Fixture.",
    });
    let session:
      | Awaited<ReturnType<typeof createAgentSession>>["session"]
      | undefined;
    try {
      await loader.reload();
      if (mode !== "same-model")
        loader
          .getExtensions()
          .runtime.flagValues.set(
            "repetition-recovery-model",
            "recovery-test/fallback",
          );
      const model = registry.find("recovery-test", "primary");
      if (!model) throw new Error("Fixture primary missing");
      const manager = SessionManager.inMemory(directory);
      if (mode === "cross-turn")
        manager.appendMessage({
          role: "assistant",
          api: model.api,
          provider: model.provider,
          model: model.id,
          content: [{ type: "text", text: firstTurn }],
          stopReason: "stop",
          timestamp: 1,
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        });
      ({ session } = await createAgentSession({
        cwd: directory,
        agentDir: directory,
        settingsManager: settings,
        modelRegistry: registry,
        model,
        resourceLoader: loader,
        sessionManager: manager,
        tools: [],
        autoTitleSessions: false,
      }));
      await session.bindExtensions({});
      session.subscribe((event) => {
        if (mode === "native-deadline" && event.type === "agent_end")
          subscriberDeadlines.push(event.deadline);
      });
      const idle = new Promise<void>((resolve) => {
        const unsubscribe = session?.subscribe((event) => {
          if (event.type === "agent_idle") {
            unsubscribe?.();
            resolve();
          }
        });
      });
      const restored = new Promise<void>((resolve) => {
        const unsubscribe = session?.subscribe((event) => {
          if (event.type === "model_changed" && event.model.id === "primary") {
            unsubscribe?.();
            resolve();
          }
        });
      });
      await session.prompt("Run the fixture.");
      await idle;
      if (mode === "native-corrected" || mode === "other-rule") {
        expect(calls).toEqual(["primary", "primary"]);
        expect(stopEvents).toEqual([]);
        expect(
          notices.some((message) =>
            message.includes("Repetition recovery enabled:"),
          ),
        ).toBe(true);
        expect(
          manager
            .getBranch()
            .filter(
              (entry) =>
                entry.type === "custom_message" &&
                entry.customType === "ttsr-injection",
            ),
        ).toHaveLength(1);
        expect(
          readdirSync(logs).filter((name) => name.endsWith(".jsonl")),
        ).toEqual([]);
        expect(session.model?.id).toBe("primary");
        if (mode === "other-rule") {
          const files = readdirSync(join(logs, "incidents"));
          expect(files).toHaveLength(1);
          const incident = JSON.parse(
            readFileSync(join(logs, "incidents", files[0]), "utf8"),
          );
          expect(incident.rules).toEqual(["fabricated-unavailable-tool-call"]);
          expect(JSON.stringify(incident)).toContain("fabricated call");
        }
        return;
      }
      if (mode === "native-deadline") {
        expect(calls).toEqual(["primary"]);
        expect(
          notices.some((message) =>
            message.includes("Repetition recovery enabled:"),
          ),
        ).toBe(true);
        expect(extensionDeadlines).toEqual([undefined]);
        expect(subscriberDeadlines).toEqual([
          expect.objectContaining({ kind: "max_runtime", limitMs: 250 }),
        ]);
        expect(
          manager
            .getBranch()
            .filter(
              (entry) =>
                entry.type === "custom" && entry.customType === "deadline-stop",
            ),
        ).toHaveLength(1);
        expect(
          readdirSync(logs).filter((name) => name.endsWith(".jsonl")),
        ).toEqual([]);
        expect(session.model?.id).toBe("primary");
        return;
      }
      if (mode === "user-abort" || mode === "declared-deadline") {
        expect(calls).toEqual(["primary", "primary"]);
        expect(
          notices.some((message) =>
            message.includes("Repetition recovery enabled:"),
          ),
        ).toBe(true);
        expect(session.model?.id).toBe("primary");
        expect(
          readdirSync(logs).filter((name) => name.endsWith(".jsonl")),
        ).toEqual([]);
        expect(stopEvents).toHaveLength(mode === "user-abort" ? 0 : 1);
        return;
      }
      if (mode !== "same-model") await restored;
      await outcomeRecorded;
      expect(calls).toEqual(
        capped
          ? ["primary", "primary"]
          : mode === "cross-turn"
            ? ["primary", "primary", "primary", "fallback"]
            : [
                "primary",
                "primary",
                mode === "same-model" ? "primary" : "fallback",
              ],
      );
      expect(session.model?.id).toBe("primary");
      expect(stopEvents).toEqual(
        Array.from({ length: mode === "repeated" ? 2 : 1 }, () => ({
          rules: [
            mode === "cross-turn" ? "repetitive-turns" : "collapse-repetition",
          ],
        })),
      );
      const exhaustedBranch = stopBranches[0] ?? [];
      expect(exhaustedBranch.at(-1)).toMatchObject({
        type: "custom",
        customType: "ttsr-loop-stopped",
        data: {
          rules: [
            mode === "cross-turn" ? "repetitive-turns" : "collapse-repetition",
          ],
        },
      });
      expect(
        exhaustedBranch
          .slice(0, -1)
          .filter(
            (entry) =>
              entry.type === "custom_message" &&
              entry.customType === "ttsr-injection",
          ),
      ).toHaveLength(1);
      const incidentDirectory = join(logs, "incidents");
      const incidents = readdirSync(incidentDirectory).map((name) =>
        JSON.parse(readFileSync(join(incidentDirectory, name), "utf8")),
      );
      expect(incidents.length).toBeGreaterThanOrEqual(2);
      if (mode === "tool-stream")
        expect(incidents[0].message.tools).toEqual([
          { id: "blocked-call", name: "bash", executed: false },
        ]);
      expect(
        incidents.some((incident) =>
          JSON.stringify(incident).includes(
            mode === "cross-turn"
              ? secondTurn
              : "deterministic repetitive fixture",
          ),
        ),
      ).toBe(true);
      expect(JSON.stringify(incidents)).not.toContain(
        "Run deterministic fixture",
      );
      if (mode === "same-model")
        expect(recoveryContexts[0]).toContain("Failure incident:");
      const journalName = readdirSync(logs).find((name) =>
        name.endsWith(".jsonl"),
      );
      if (!journalName) throw new Error("Recovery journal missing");
      const text = readFileSync(join(logs, journalName), "utf8");
      expect(text).not.toContain("fake-local-key");
      expect(text).not.toContain(directory);
      expect(text).not.toContain("Fixture.");
      expect(text).not.toContain("deterministic repetitive fixture");
      const records = text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(records[0].event).toBe("failure");
      expect(records.at(-1).event).toBe("outcome");
      expect(
        records.filter((record) => record.event === "continuation_admitted"),
      ).toHaveLength(capped ? 0 : 1);
      expect(records.at(-1).outcome).toBe(
        capped
          ? "engine-refused"
          : mode === "repeated"
            ? "repetition-recurred"
            : "settled",
      );
      expect(records.at(-1).restoration).toBe("restored");
      expect(
        notices.some(
          (message) =>
            message.includes("Repetition recovery") &&
            (message.includes("enabled:") || message.includes("disabled:")),
        ),
      ).toBe(true);
      if (capped)
        expect(
          notices.some((message) =>
            message.includes("engine refused the fallback turn"),
          ),
        ).toBe(true);
    } finally {
      outcomeWatcher?.close();
      session?.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30000,
);
