import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import compoundEngineering, {
  compoundEngineeringSkillPath,
} from "../src/index.ts";

const packagedEntryPath = resolve(import.meta.dirname, "../src/index.ts");
const packagedSkillPath = compoundEngineeringSkillPath(packagedEntryPath);

describe("Compound Engineering extension", () => {
  test("discovers its packaged skill root through Senpi", async () => {
    let discover: ((event: unknown, ctx: unknown) => unknown) | undefined;
    compoundEngineering({
      on(name: string, handler: typeof discover) {
        if (name === "resources_discover") discover = handler;
      },
    } as never);

    expect(discover).toBeDefined();
    expect(
      await discover?.(
        {
          type: "resources_discover",
          cwd: "/workspace",
          reason: "startup",
          scopedEntries: true,
        },
        { loadedExtensionPaths: [packagedEntryPath] },
      ),
    ).toEqual({ skillPaths: [packagedSkillPath] });
  });

  test("discovers skills from its loaded extension entrypoint", async () => {
    let discover: ((event: unknown, ctx: unknown) => unknown) | undefined;
    compoundEngineering({
      on(name: string, handler: typeof discover) {
        if (name === "resources_discover") discover = handler;
      },
    } as never);

    const result = await discover?.(
      {
        type: "resources_discover",
        cwd: "/workspace",
        reason: "startup",
        scopedEntries: true,
      },
      {
        loadedExtensionPaths: ["/packages/compound-engineering/src/index.ts"],
      },
    );

    expect(result).toEqual({
      skillPaths: ["/packages/compound-engineering/skills"],
    });
  });

  test("ships the complete pinned upstream skill inventory", () => {
    const skillNames = readdirSync(packagedSkillPath, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const skillFile = join(packagedSkillPath, entry.name, "SKILL.md");
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
