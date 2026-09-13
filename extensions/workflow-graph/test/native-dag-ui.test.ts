import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  NATIVE_DAG_UI_HOOK,
  registerNativeDagUiHook,
} from "../src/native-dag-ui.ts";
import {
  OMO_VERSION,
  POSTIMAGE_SHA256,
  patchNativeDagUi,
  repairNativeDagUi,
  repairState,
  sha256,
} from "../../../scripts/repair-omo-dag-ui.ts";

type CommandContext = {
  readonly mode: string;
  readonly sessionManager?: { readonly getSessionId: () => string | undefined };
  readonly ui: {
    readonly notify: (message: string, type?: string) => void;
  };
};

type NativeCommand = (args: string, context: CommandContext) => Promise<void>;

type NativePi = {
  readonly registerCommand: (
    name: string,
    command: { readonly handler: NativeCommand },
  ) => void;
};

type NativeManager = {
  readonly list: (sessionId: string) => readonly { readonly runId: string }[];
  readonly snapshot: (runId: string, sessionId: string) => unknown;
};

function installedHandlerPath(): string {
  return join(
    process.env.BUN_INSTALL ?? join(homedir(), ".bun"),
    "install",
    "global",
    "node_modules",
    "omo-ai",
    "plugin",
    "extensions",
    "omo-task.js",
  );
}

function nativeDagCommand(
  source: string,
  manager: NativeManager,
): NativeCommand {
  const start = source.indexOf("function cI(e,t)");
  const end = source.indexOf("function pI", start);
  if (start === -1 || end === -1)
    throw new Error("native /dag handler not found");
  const factory = new Function(
    "uI",
    "pI",
    "Sd",
    `${source.slice(start, end)};return cI;`,
  );
  const register = factory(
    "empty",
    (run: { readonly runId: string }) => run.runId,
    (value: string) => value,
  );
  if (typeof register !== "function")
    throw new Error("native /dag handler did not load");
  let handler: NativeCommand | undefined;
  const pi: NativePi = {
    registerCommand(name, command): void {
      if (name === "dag") handler = command.handler;
    },
  };
  register(pi, manager);
  if (handler === undefined)
    throw new Error("native /dag command was not registered");
  return handler;
}

function context(
  mode: string,
  sessionId?: string,
): {
  readonly context: CommandContext;
  readonly notifications: {
    readonly message: string;
    readonly type?: string;
  }[];
} {
  const notifications: { message: string; type?: string }[] = [];
  return {
    context: {
      mode,
      ...(sessionId === undefined
        ? {}
        : { sessionManager: { getSessionId: () => sessionId } }),
      ui: { notify: (message, type) => notifications.push({ message, type }) },
    },
    notifications,
  };
}

describe("native /dag TUI delegation", () => {
  test("given extracted installed handler when hook handles validated local TUI run then native fallback does not render", async () => {
    const source = await readFile(installedHandlerPath(), "utf8");
    const patched = patchNativeDagUi(source);
    if (patched === undefined)
      throw new Error("installed handler cannot be patched");
    const received: { runId?: string; sessionId: string }[] = [];
    const release = registerNativeDagUiHook(async ({ runId, sessionId }) => {
      received.push({ runId, sessionId });
      return true;
    });
    try {
      const command = nativeDagCommand(patched, {
        list: () => [],
        snapshot: (runId, sessionId) => ({ runId, sessionId }),
      });
      const call = context("tui", "session-a");
      await command("dag-local", call.context);
      expect(received).toEqual([
        { runId: "dag-local", sessionId: "session-a" },
      ]);
      expect(call.notifications).toEqual([]);
    } finally {
      release?.();
    }
  });

  test("given extracted patched handler when caller is nonTUI, foreign, missing session, or claimant throws then native fallback owns output", async () => {
    const source = await readFile(installedHandlerPath(), "utf8");
    const patched = patchNativeDagUi(source);
    if (patched === undefined)
      throw new Error("installed handler cannot be patched");
    let claims = 0;
    const release = registerNativeDagUiHook(async () => {
      claims += 1;
      throw new Error("renderer failure");
    });
    try {
      const command = nativeDagCommand(patched, {
        list: () => [{ runId: "dag-local" }],
        snapshot: (runId, sessionId) => {
          if (runId === "dag-foreign" || sessionId !== "session-a")
            throw new Error("foreign run");
          return { runId };
        },
      });
      const nonTui = context("print", "session-a");
      await command("", nonTui.context);
      const foreign = context("tui", "session-a");
      await command("dag-foreign", foreign.context);
      const missingSession = context("tui");
      await command("dag-local", missingSession.context);
      const throwing = context("tui", "session-a");
      await command("", throwing.context);
      expect(claims).toBe(1);
      expect(nonTui.notifications).toHaveLength(1);
      expect(foreign.notifications).toHaveLength(1);
      expect(missingSession.notifications).toHaveLength(1);
      expect(throwing.notifications).toHaveLength(1);
    } finally {
      release?.();
    }
  });

  test("given native hook claimant when second claimant registers and owner releases then ownership is exclusive and cleanup permits replacement", async () => {
    const calls: string[] = [];
    const first = registerNativeDagUiHook(async ({ sessionId }) => {
      calls.push(sessionId);
      return true;
    });
    const second = registerNativeDagUiHook(async () => true);
    try {
      expect(second).toBeUndefined();
      const hook = Reflect.get(globalThis, Symbol.for(NATIVE_DAG_UI_HOOK));
      if (
        typeof hook !== "object" ||
        hook === null ||
        !("handle" in hook) ||
        typeof hook.handle !== "function"
      )
        throw new Error("native hook missing");
      await hook.handle({
        args: "",
        context: context("tui", "session-a").context,
        sessionId: "session-a",
      });
      expect(calls).toEqual(["session-a"]);
    } finally {
      first?.();
    }
    const replacement = registerNativeDagUiHook(async () => true);
    expect(replacement).toBeFunction();
    replacement?.();
  });

  test("given disposable exact preimage when repair applies then postimage hash is exact and corrupted marker is rejected", async () => {
    const directory = await mkdtemp(join(tmpdir(), "omo-dag-ui-"));
    const target = join(directory, "omo-task.js");
    const packagePath = join(directory, "package.json");
    await writeFile(target, await readFile(installedHandlerPath()));
    await writeFile(packagePath, JSON.stringify({ version: OMO_VERSION }));
    try {
      const checked = await repairNativeDagUi([
        "--path",
        target,
        "--package-path",
        packagePath,
      ]);
      expect(checked).toContain(target);
      const before = await readFile(target, "utf8");
      expect(repairState(before)).toBe("preimage");
      await repairNativeDagUi([
        "--apply",
        "--path",
        target,
        "--package-path",
        packagePath,
      ]);
      const after = await readFile(target, "utf8");
      expect(sha256(after)).toBe(POSTIMAGE_SHA256);
      expect(repairState(after)).toBe("postimage");
      await writeFile(target, `${after}corrupt`);
      expect(repairState(await readFile(target, "utf8"))).toBe("invalid");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
