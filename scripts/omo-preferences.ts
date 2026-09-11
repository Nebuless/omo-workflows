import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export type OmoPreferencesResult = {
  settingsChanged: boolean;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must contain a JSON object`);
  }

  return value as JsonObject;
}

function writeJsonAtomically(path: string, value: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.tmp-${process.pid}`,
  );

  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporaryPath, path);
}

function readSettingsTemplate(): JsonObject {
  const templatePath = join(
    import.meta.dir,
    "..",
    "templates",
    "omo-agent-settings.json",
  );

  return asObject(JSON.parse(readFileSync(templatePath, "utf8")), templatePath);
}

export function configureOmoPreferences({
  home = homedir(),
}: {
  home?: string;
} = {}): OmoPreferencesResult {
  const settingsPath = join(home, ".omo", "agent", "settings.json");
  const currentSettings = existsSync(settingsPath)
    ? asObject(
        Bun.JSONC.parse(readFileSync(settingsPath, "utf8")),
        settingsPath,
      )
    : {};
  const nextSettings = { ...currentSettings, ...readSettingsTemplate() };
  const settingsChanged =
    JSON.stringify(currentSettings) !== JSON.stringify(nextSettings);

  if (settingsChanged) {
    writeJsonAtomically(settingsPath, nextSettings);
  }

  return { settingsChanged };
}

if (import.meta.main) {
  const result = configureOmoPreferences();
  console.log(
    `OMO preferences configured: tips disabled${result.settingsChanged ? "." : " (already configured)."}`,
  );
}
