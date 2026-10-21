import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fixture = mkdtempSync(join(tmpdir(), "omo-validate-package-"));
const root = join(fixture, "repo");
const packagePath = resolve(import.meta.dirname, "../package.json");
const original = JSON.parse(readFileSync(packagePath, "utf8"));
const script = readFileSync(
  resolve(import.meta.dirname, "../scripts/validate-package.ts"),
  "utf8",
);
const scriptPath = join(root, "scripts/validate-package.ts");
const manifestPath = join(root, "package.json");
const files = [
  "extensions/better-custom/src/index.ts",
  "extensions/compound-engineering/src/index.ts",
  "extensions/herdr/index.ts",
  "extensions/model-routing-advisor/index.ts",
  "extensions/trim/src/index.ts",
  "extensions/better-custom/src/config.ts",
  "extensions/better-custom/src/model-browser.ts",
  "extensions/herdr/skills/herdr/SKILL.md",
  "extensions/herdr/skills/herdr-agent-management/SKILL.md",
  "extensions/herdr/skills/herdr-handoff/SKILL.md",
  "extensions/herdr/skills/herdr-orchestration/SKILL.md",
  "extensions/herdr/skills/herdr-admin/SKILL.md",
];

mkdirSync(join(root, "scripts"), { recursive: true });
for (const path of files) {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, "");
}
writeFileSync(scriptPath, script);
for (const [path, name, entrypoint] of [
  [
    "extensions/better-custom/package.json",
    "@omo-workflows/better-custom",
    "./src/index.ts",
  ],
  [
    "extensions/compound-engineering/package.json",
    "@omo-workflows/compound-engineering",
    "./src/index.ts",
  ],
  ["extensions/herdr/package.json", "@omo-workflows/herdr", "./index.ts"],
  [
    "extensions/model-routing-advisor/package.json",
    "@omo-workflows/model-routing-advisor",
    "./index.ts",
  ],
  ["extensions/trim/package.json", "@omo-workflows/trim", "./src/index.ts"],
]) {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(
    target,
    JSON.stringify({ name, pi: { extensions: [entrypoint] } }),
  );
}

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function validate(manifest: unknown) {
  writeFileSync(manifestPath, JSON.stringify(manifest));
  try {
    execFileSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return { status: 0, stderr: "" };
  } catch (error) {
    const result = error as { status?: number; stderr?: string };
    return { status: result.status, stderr: result.stderr ?? "" };
  }
}

describe("package host dependency validation", () => {
  test("enforces forbidden dependencies and required or optional peers", () => {
    const base = {
      ...original,
      dependencies: { ...original.dependencies },
      peerDependencies: { ...original.peerDependencies },
    };
    for (const name of [
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-coding-agent",
    ]) {
      const dependency = validate({
        ...base,
        dependencies: { ...base.dependencies, [name]: "*" },
      });
      expect(dependency.status).toBe(1);
      expect(dependency.stderr).toContain(
        `${name} must not be in dependencies`,
      );

      const wildcardPeer = validate({
        ...base,
        peerDependencies: { ...base.peerDependencies, [name]: "*" },
      });
      expect(wildcardPeer.status).toBe(0);

      const invalidPeer = validate({
        ...base,
        peerDependencies: { ...base.peerDependencies, [name]: "^1.0.0" },
      });
      expect(invalidPeer.status).toBe(1);
      expect(invalidPeer.stderr).toContain(
        `${name} must be a "*" peer dependency`,
      );
    }

    const missingRequiredPeer = validate({
      ...base,
      peerDependencies: {
        "@earendil-works/pi-tui": "*",
        typebox: "*",
      },
    });
    expect(missingRequiredPeer.status).toBe(1);
    expect(missingRequiredPeer.stderr).toContain(
      '@earendil-works/pi-ai must be a "*" peer dependency',
    );
  });
});
