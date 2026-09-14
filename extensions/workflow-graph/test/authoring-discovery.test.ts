import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  loadAuthoredProgram,
  normalizeWorkflowDescriptor,
  workflowDescriptorDigest,
} from "../src/authoring/discovery.ts";

test("descriptor digest is versioned and binds authored path and bytes", async () => {
  const first = workflowDescriptorDigest(
    "authored",
    "/tmp/workflow.ts",
    "export const program = 1;",
  );
  const same = workflowDescriptorDigest(
    "authored",
    "/tmp/workflow.ts",
    "export const program = 1;",
  );
  const changed = workflowDescriptorDigest(
    "authored",
    "/tmp/workflow.ts",
    "export const program = 2;",
  );
  const expected = `sha256:v1:${createHash("sha256").update(Buffer.from("v1\0authored\0/tmp/workflow.ts\0export const program = 1;", "utf8")).digest("hex")}`;
  expect(first).toBe(expected);
  expect(first).toMatch(/^sha256:v1:[0-9a-f]{64}$/);
  expect(same).toBe(first);
  expect(changed).not.toBe(first);
});

test("descriptor metadata rejects C0 and C1 controls", () => {
  for (const value of ["bad\u0000text", "bad\u001btext", "bad\u009btext"]) {
    expect(() =>
      normalizeWorkflowDescriptor(
        { key: "safe", version: 1, metadata: { title: value } },
        "bundled",
      ),
    ).toThrow("Invalid workflow descriptor metadata.");
    expect(() =>
      normalizeWorkflowDescriptor(
        { key: "safe", version: 1, metadata: { description: value } },
        "bundled",
      ),
    ).toThrow("Invalid workflow descriptor metadata.");
    expect(() =>
      normalizeWorkflowDescriptor(
        { key: "safe", version: 1, metadata: { intents: [value] } },
        "bundled",
      ),
    ).toThrow("Invalid workflow descriptor metadata.");
  }
  for (const key of ["bad\u0000key", "bad\u001bkey", "bad\u009bkey"]) {
    expect(() =>
      normalizeWorkflowDescriptor({ key, version: 1 }, "bundled"),
    ).toThrow("Invalid workflow descriptor metadata.");
  }
});

test("descriptor metadata rejects oversized opaque identity while valid unicode survives", () => {
  expect(() =>
    normalizeWorkflowDescriptor(
      { key: "k".repeat(121), version: 1 },
      "bundled",
    ),
  ).toThrow("Invalid workflow descriptor metadata.");
  expect(
    normalizeWorkflowDescriptor(
      { key: "safe", version: 1, metadata: { title: "日本語🚀" } },
      "bundled",
    ).title,
  ).toBe("日本語🚀");
});

test("untrusted descriptor does not execute module", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-untrusted-descriptor-"));
  try {
    await writeFile(
      join(cwd, "program.ts"),
      'globalThis.__workflowMarker = true; export const program = { key: "example", version: 1, input: {}, metadata: {title:"bad\\u0001"}, decide: () => ({kind:"final",result:1}) };',
    );
    await expect(
      loadAuthoredProgram("program.ts", { cwd, isProjectTrusted: () => false }),
    ).rejects.toThrow("trusted");
    expect(
      (globalThis as Record<string, unknown>).__workflowMarker,
    ).toBeUndefined();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("explicit module loading requires project trust before code execution", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-authoring-"));
  try {
    await writeFile(
      join(cwd, "program.ts"),
      'export const program = { key: "example", version: 1, input: {type:"object"}, decide: () => ({kind:"final",result:7}) };',
    );
    await expect(
      loadAuthoredProgram("program.ts", { cwd, isProjectTrusted: () => false }),
    ).rejects.toThrow("trusted");
    const program = await loadAuthoredProgram("program.ts", {
      cwd,
      isProjectTrusted: () => true,
    });
    expect(program.decide({ inputs: {}, results: {}, answers: {} })).toEqual({
      kind: "final",
      result: 7,
    });
    await writeFile(
      join(cwd, "invalid.ts"),
      'export const program = {key:"invalid"};',
    );
    await expect(
      loadAuthoredProgram("invalid.ts", { cwd, isProjectTrusted: () => true }),
    ).rejects.toThrow("Invalid authored");
    await expect(
      loadAuthoredProgram("../outside.ts", {
        cwd,
        isProjectTrusted: () => true,
      }),
    ).rejects.toThrow();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
