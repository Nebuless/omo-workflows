import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAuthoredProgram } from "../src/authoring/discovery.ts";

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
