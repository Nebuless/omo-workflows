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
} from "@code-yeongyu/senpi";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import repetitionRecovery from "../src/index.ts";

test.each(["admitted", "capped", "repeated"])(
  "native guard and fallback remain bounded: %s",
  async (mode) => {
    const capped = mode === "capped";
    const directory = mkdtempSync(join(tmpdir(), "recovery-engine-"));
    const calls: string[] = [];
    const logs = join(directory, "logs", "repetition-recovery");
    mkdirSync(logs, { recursive: true });
    let outcomeWatcher: ReturnType<typeof watch> | undefined;
    const outcomeRecorded = new Promise<void>((resolve) => {
      outcomeWatcher = watch(logs, () => {
        const file = readdirSync(logs).find((name) => name.endsWith(".jsonl"));
        if (
          file &&
          readFileSync(join(logs, file), "utf8").includes('"event":"outcome"')
        )
          resolve();
      });
    });
    const settings = SettingsManager.inMemory({
      enabledBuiltinExtensions: ["ttsr"],
      retry: { enabled: false },
      compaction: { enabled: false },
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
      streamSimple: (model) => {
        calls.push(model.id);
        const stream = createAssistantMessageEventStream();
        const text =
          model.id === "primary" || mode === "repeated"
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
      extensionFactories: [repetitionRecovery],
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
      ({ session } = await createAgentSession({
        cwd: directory,
        agentDir: directory,
        settingsManager: settings,
        modelRegistry: registry,
        model,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(directory),
        tools: [],
        autoTitleSessions: false,
      }));
      await session.bindExtensions({});
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
      await restored;
      await outcomeRecorded;
      expect(calls).toEqual(
        capped ? ["primary", "primary"] : ["primary", "primary", "fallback"],
      );
      expect(session.model?.id).toBe("primary");
      const text = readFileSync(join(logs, readdirSync(logs)[0]), "utf8");
      expect(text).not.toContain("fake-local-key");
      expect(text).not.toContain("Fixture.");
      expect(text).not.toContain("deterministic repetitive fixture");
      const records = text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(records.map((record) => record.event)).toEqual(
        capped
          ? ["failure", "recovery_action", "outcome"]
          : ["failure", "recovery_action", "continuation_admitted", "outcome"],
      );
      expect(records.at(-1).outcome).toBe(
        capped
          ? "engine-refused"
          : mode === "repeated"
            ? "repetition-recurred"
            : "completed",
      );
    } finally {
      outcomeWatcher?.close();
      session?.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30000,
);
