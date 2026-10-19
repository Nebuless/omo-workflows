import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };

describe("model routing advisor package boundary", () => {
  test("registers only its read-only advice tool", async () => {
    const tools = new Map<string, unknown>();
    const extension = await import(
      "../extensions/model-routing-advisor/index.ts"
    );

    extension.default({
      registerTool(definition: { name: string }) {
        tools.set(definition.name, definition);
      },
    } as never);

    expect([...tools.keys()]).toEqual(["model_route_advice"]);
  });

  test("is registered as an independently installable extension", () => {
    const entrypoint = "./extensions/model-routing-advisor/index.ts";
    expect(rootPackage.pi.extensions).toContain(entrypoint);

    const packagePath = resolve(
      import.meta.dirname,
      "../extensions/model-routing-advisor/package.json",
    );
    expect(existsSync(packagePath)).toBe(true);
    const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as {
      name?: unknown;
      pi?: { extensions?: unknown };
    };
    expect(manifest.name).toBe("@omo-workflows/model-routing-advisor");
    expect(manifest.pi?.extensions).toEqual(["./index.ts"]);
  });
});
