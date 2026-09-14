import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import compoundEngineering, {
  compoundEngineeringSkillPath,
} from "../src/index.ts";

describe("Compound Engineering extension", () => {
  test("discovers its packaged skill root through Senpi", async () => {
    let discover:
      | (() => { readonly skillPaths: readonly string[] })
      | undefined;
    compoundEngineering({
      on(name: string, handler: typeof discover) {
        if (name === "resources_discover") discover = handler;
      },
    } as never);

    expect(discover).toBeDefined();
    expect(await discover?.()).toEqual({
      skillPaths: [compoundEngineeringSkillPath],
    });
  });

  test("ships the complete pinned upstream skill inventory", () => {
    const skillNames = readdirSync(compoundEngineeringSkillPath, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const skillFile = join(
          compoundEngineeringSkillPath,
          entry.name,
          "SKILL.md",
        );
        const frontmatter = readFileSync(skillFile, "utf8").match(
          /^---\n[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$/m,
        );
        return frontmatter?.[1];
      })
      .filter((name): name is string => name !== undefined)
      .sort();

    expect(skillNames).toHaveLength(35);
    expect(skillNames).toEqual(
      expect.arrayContaining([
        "ce-brainstorm",
        "ce-plan",
        "ce-work",
        "ce-simplify-code",
        "ce-code-review",
        "ce-compound",
        "lfg",
      ]),
    );
  });
});
