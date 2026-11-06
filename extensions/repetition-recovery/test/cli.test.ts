import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test.each(["automatic", "disabled", "enabled"])(
  "pinned OMO discovers recovery and reports %s through RPC",
  async (state) => {
    const directory = mkdtempSync(join(tmpdir(), "recovery-cli-"));
    const fixture = join(directory, "provider.ts");
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const node = Bun.which("node");
    if (!node)
      throw new Error("CLI verification requires the mise Node runtime");
    writeFileSync(
      fixture,
      `export default function (pi) {
        pi.registerProvider("recovery-cli", {
          api: "openai-completions", apiKey: "local-fixture-key",
          baseUrl: "http://invalid.test",
          models: ["primary", "fallback"].map(id => ({
            id, name: id, reasoning: false, input: ["text"],
            cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
            contextWindow: 100000, maxTokens: 1000
          })),
          streamSimple() { throw new Error("Unexpected provider call during activation"); }
        });
      }`,
    );
    const child = Bun.spawn(
      [
        node,
        join(root, "node_modules/omo-ai/bin/omo.js"),
        "--offline",
        "--approve",
        "--mode",
        "rpc",
        "--no-session",
        "--no-extensions",
        "--no-skills",
        "--no-tools",
        "-e",
        fixture,
        "-e",
        join(root, "extensions/repetition-recovery"),
        "--provider",
        "recovery-cli",
        "--model",
        "primary",
        ...(state === "enabled"
          ? ["--repetition-recovery-model", "recovery-cli/fallback"]
          : state === "disabled"
            ? ["--repetition-recovery-model", "off"]
            : []),
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          HOME: directory,
          OMO_CODING_AGENT_DIR: directory,
          SENPI_CODING_AGENT_DIR: directory,
          XDG_CONFIG_HOME: join(directory, "config"),
          OMO_RUNTIME: "node",
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const errors = new Response(child.stderr).text();
    const notices: string[] = [];
    let receivedState = false;
    child.stdin.write('{"id":"activation","type":"get_state"}\n');
    try {
      let pending = "";
      const decoder = new TextDecoder();
      for await (const chunk of child.stdout) {
        pending += decoder.decode(chunk, { stream: true });
        let newline = pending.indexOf("\n");
        while (newline !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          newline = pending.indexOf("\n");
          if (!line.startsWith("{")) continue;
          const event = JSON.parse(line);
          if (
            event.type === "extension_ui_request" &&
            event.method === "notify"
          )
            notices.push(event.message);
          if (event.type === "response" && event.id === "activation") {
            expect(event.success).toBe(true);
            expect(event.data.model.id).toBe("primary");
            receivedState = true;
            child.stdin.end();
          }
        }
      }
      expect(await child.exited, await errors).toBe(0);
      expect(receivedState).toBe(true);
      expect(
        notices.some(
          (message) =>
            /repetition recovery/i.test(message) &&
            message.includes(state === "automatic" ? "enabled" : state),
        ),
      ).toBe(true);
      expect(notices.join("\n")).not.toContain("local-fixture-key");
    } finally {
      child.kill();
      await child.exited;
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30000,
);
