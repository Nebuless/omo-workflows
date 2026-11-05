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
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionContext,
} from "@code-yeongyu/senpi";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import repetitionRecovery from "../src/index.ts";

test.each([
  "admitted",
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
      streamSimple: (model, _context, options) => {
        calls.push(model.id);
        const stream = createAssistantMessageEventStream();
        const text =
          mode === "cross-turn"
            ? model.id === "fallback"
              ? "Recovered with a distinct useful answer."
              : calls.length === 1
                ? firstTurn
                : secondTurn
            : (model.id === "primary" &&
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
      if (mode === "native-corrected") {
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
        expect(readdirSync(logs)).toEqual([]);
        expect(session.model?.id).toBe("primary");
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
        expect(readdirSync(logs)).toEqual([]);
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
        expect(readdirSync(logs)).toEqual([]);
        expect(stopEvents).toHaveLength(mode === "user-abort" ? 0 : 1);
        return;
      }
      await restored;
      await outcomeRecorded;
      expect(calls).toEqual(
        capped
          ? ["primary", "primary"]
          : mode === "cross-turn"
            ? ["primary", "primary", "primary", "fallback"]
            : ["primary", "primary", "fallback"],
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
      const text = readFileSync(join(logs, readdirSync(logs)[0]), "utf8");
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
