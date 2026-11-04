import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecovery } from "../src/recovery.ts";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const agentDir = mkdtempSync(join(tmpdir(), "repetition-recovery-"));
  directories.push(agentDir);
  const entries = [
    { type: "message", id: "user-1", message: { role: "user" } },
    {
      type: "custom_message",
      id: "correction",
      customType: "ttsr-injection",
      details: { rules: ["collapse-repetition"] },
    },
    {
      type: "custom",
      id: "failure",
      customType: "ttsr-loop-stopped",
      data: { rules: ["collapse-repetition"], secret: "PRIVATE" },
    },
  ];
  const models = [
    { provider: "test", id: "primary" },
    { provider: "test", id: "fallback" },
  ];
  let model = models[0];
  const requests: string[] = [];
  const host = {
    select: async (selected: typeof model) => {
      model = selected;
      return true;
    },
    send: () => {
      requests.push(model.id);
    },
    notify: (_message: string) => {},
  };
  const context = () => ({
    agentDir,
    sessionId: "session-1",
    entries,
    model,
    models,
    pending: false,
  });
  return { agentDir, entries, requests, host, context, model: () => model };
}

test("preserves the initial correction and claims only exhausted recovery", async () => {
  const f = fixture();
  const recovery = createRecovery(f.host, "test/fallback");
  await recovery.settled({ ...f.context(), entries: f.entries.slice(0, 2) });
  expect(f.requests).toEqual([]);
  await recovery.settled(f.context());
  expect(f.requests).toEqual(["fallback"]);
  expect(f.model().id).toBe("fallback");
});

test("disk claims prevent another continuation after reload", async () => {
  const f = fixture();
  await createRecovery(f.host, "test/fallback").settled(f.context());
  await createRecovery(f.host, "test/fallback").resumed(f.context());
  expect(f.requests).toEqual(["fallback"]);
  expect(f.model().id).toBe("primary");
});

test("refused continuation restores the original model without another attempt", async () => {
  const f = fixture();
  const recovery = createRecovery(f.host, "test/fallback");
  await recovery.settled(f.context());
  await recovery.refused(f.context());
  await recovery.settled(f.context());
  expect(f.requests).toEqual(["fallback"]);
  expect(f.model().id).toBe("primary");
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
  await recovery.settled(f.context());
  recovery.started(f.context());
  recovery.ended("completed");
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
    "continuation_admitted",
    "outcome",
  ]);
  expect(parsed.at(-1).outcome).toBe("completed");
  expect(f.model().id).toBe("primary");
});

test.each(["missing/model", "test/primary", ""])(
  "does not continue with unavailable or identical fallback %s",
  async (selector) => {
    const f = fixture();
    await createRecovery(f.host, selector).settled(f.context());
    expect(f.requests).toEqual([]);
  },
);

test("new user input supersedes a pending continuation", async () => {
  const f = fixture();
  const recovery = createRecovery(f.host, "test/fallback");
  await recovery.settled(f.context());
  f.entries.push({ type: "message", id: "user-2", message: { role: "user" } });
  await recovery.settled(f.context());
  expect(f.requests).toEqual(["fallback"]);
  expect(f.model().id).toBe("primary");
});
