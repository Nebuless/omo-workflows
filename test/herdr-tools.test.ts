import { describe, expect, test } from "bun:test";
import { herdrSkillPaths } from "../extensions/herdr/skills.ts";
import {
  requireHerdrEnvironment,
  runHerdrCommand,
  validateHerdrArgs,
} from "../extensions/herdr/tools.ts";

describe("Herdr extension tools", () => {
  test("discovers complete Herdr skill suite", () => {
    expect(herdrSkillPaths("/extension")).toEqual([
      "/extension/skills/herdr/SKILL.md",
      "/extension/skills/herdr-agent-management/SKILL.md",
      "/extension/skills/herdr-handoff/SKILL.md",
      "/extension/skills/herdr-orchestration/SKILL.md",
      "/extension/skills/herdr-admin/SKILL.md",
    ]);
  });

  test("accepts safe inspection argv and rejects unsafe command shapes", () => {
    expect(() => validateHerdrArgs(["pane", "list"], true)).not.toThrow();
    expect(() => validateHerdrArgs([], true)).toThrow("must name a command");
    expect(() => validateHerdrArgs(["herdr", "status"], true)).toThrow(
      "do not include the herdr binary",
    );
    expect(() => validateHerdrArgs(["pane", "close"], true)).toThrow(
      "Unsupported Herdr inspection command",
    );
    expect(() => validateHerdrArgs(["pane", "bad\0arg"], false)).toThrow(
      "without NUL bytes",
    );
  });

  test("requires a Herdr pane for control", () => {
    expect(() => requireHerdrEnvironment({})).toThrow("Herdr control requires");
    expect(() =>
      requireHerdrEnvironment({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" }),
    ).not.toThrow();
  });

  test("runs inspection without Herdr context using argv", async () => {
    const calls: string[][] = [];
    const result = await runHerdrCommand(
      ["status", "--json"],
      true,
      {},
      undefined,
      async (argv) => {
        calls.push([...argv]);
        return { code: 0, output: "{}" };
      },
    );
    expect(calls).toEqual([["herdr", "status", "--json"]]);
    expect(result).toEqual({ code: 0, output: "{}" });
  });

  test("runs control only from Herdr and preserves supplied binary path", async () => {
    const calls: string[][] = [];
    await runHerdrCommand(
      ["pane", "list"],
      false,
      { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: "/bin/herdr" },
      undefined,
      async (argv) => {
        calls.push([...argv]);
        return { code: 0, output: "[]" };
      },
    );
    expect(calls).toEqual([["/bin/herdr", "pane", "list"]]);
  });
});
