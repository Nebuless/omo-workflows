import { expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIncidentRecorder } from "../src/incidents.ts";

test("records only activated assistant output, redacts split secrets, bounds retention and resets sessions", () => {
  const directory = mkdtempSync(join(tmpdir(), "rule-incidents-"));
  try {
    const recorder = createIncidentRecorder();
    const entries: {
      id: string;
      type: string;
      customType: string;
      data: unknown;
    }[] = [];
    const context = { agentDir: directory, sessionId: "session", entries };
    recorder.start(context);
    recorder.delta(
      { type: "text_delta", contentIndex: 0, delta: "ordinary answer" },
      { provider: "test", model: "primary", content: [] },
    );
    expect(recorder.flush(context)).toBeUndefined();
    expect(readdirSync(directory)).toEqual([]);
    for (let index = 0; index < 23; index++) {
      recorder.start(context);
      recorder.delta(
        { type: "text_delta", contentIndex: 0, delta: "Authorization: Bear" },
        { provider: "test", model: "primary", content: [] },
      );
      recorder.delta(
        {
          type: "text_delta",
          contentIndex: 0,
          delta: "er private-credential\n",
        },
        { provider: "test", model: "primary", content: [] },
      );
      recorder.delta(
        {
          type: "toolcall_delta",
          contentIndex: 1,
          delta:
            '{"token":"secret-value","command":"' +
            "repeat ".repeat(10000) +
            '"}',
        },
        {
          provider: "test",
          model: "primary",
          content: [
            { type: "text" },
            { type: "toolCall", id: "call", name: "bash" },
          ],
        },
      );
      entries.push({
        id: String(index),
        type: "custom",
        customType: "rule-activation",
        data: {
          kind: "ttsr",
          owner: "custom-rule",
          rules: ["custom-rule"],
          remediation: "nudge",
        },
      });
      const path = recorder.flush(context);
      expect(path).toBeDefined();
      if (!path) throw new Error("Incident missing");
      const incident = JSON.parse(readFileSync(path, "utf8"));
      expect(incident.rules).toEqual(["custom-rule"]);
      expect(incident.message.truncated).toBe(true);
      expect(incident.message.tools).toEqual([
        { id: "call", name: "bash", executed: false },
      ]);
      expect(JSON.stringify(incident)).not.toContain("secret-value");
      expect(JSON.stringify(incident)).not.toContain("private-credential");
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(path).size).toBeLessThan(40000);
      expect(recorder.flush(context)).toBeUndefined();
    }
    expect(
      readdirSync(join(directory, "logs", "repetition-recovery", "incidents")),
    ).toHaveLength(20);
    recorder.start({ ...context, sessionId: "other" });
    expect(recorder.latest(context)).toBeUndefined();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
