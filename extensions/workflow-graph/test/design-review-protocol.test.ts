import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLiveBootstrapper,
  createLiveHelperTransport,
  parseEvent,
  runHelperProcess,
} from "../src/design-review/protocol.ts";

const dirs: string[] = [];
afterEach(async () =>
  Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  ),
);

async function fixture(
  source: string,
): Promise<{ dir: string; script: string }> {
  const dir = await mkdtemp(join(tmpdir(), "design-review-"));
  dirs.push(dir);
  const script = join(dir, "helper.mjs");
  await writeFile(script, source);
  await chmod(script, 0o755);
  return { dir, script };
}

describe("design review helper transport", () => {
  test("matches upstream unreadable-output timeout and validates typed events", () => {
    expect(parseEvent("not json")).toEqual({
      type: "timeout",
      raw: "not json",
    });
    expect(parseEvent('{"type":"steer","id":"e-1"}')).toMatchObject({
      type: "steer",
      id: "e-1",
    });
    expect(() => parseEvent('{"type":"generate","variant":"wrong"}')).toThrow(
      "invalid event",
    );
  });

  test("runs actual bootstrap process and rejects non-start payload", async () => {
    const { dir, script } = await fixture(
      "console.log(JSON.stringify({ok:true,target:process.argv[3]}));",
    );
    const bootstrap = await createLiveBootstrapper({ script, cwd: dir });
    expect(await bootstrap({ target: "/tmp/preview.html" })).toEqual({
      ok: true,
      raw: { ok: true, target: "/tmp/preview.html" },
    });
    const failed = await fixture(
      'console.log(JSON.stringify({ok:false,error:"config_missing"}));',
    );
    await expect(
      (
        await createLiveBootstrapper({ script: failed.script, cwd: failed.dir })
      )({ target: "/tmp/preview.html" }),
    ).rejects.toThrow("config_missing");
  });

  test("runs actual timeout, model-event reply, and exit processes", async () => {
    const { dir, script } = await fixture(`
      import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
      if (process.argv[2] === "--reply") appendFileSync("args.json", JSON.stringify(process.argv.slice(2)));
      else {
        const count = existsSync("count") ? Number(readFileSync("count", "utf8")) + 1 : 1;
        writeFileSync("count", String(count));
        console.log(JSON.stringify(count === 1 ? { type: "timeout" } : count === 2 ? { type: "generate", id: "event-1", file: "variant.tsx" } : { type: "exit" }));
      }
    `);
    const transport = await createLiveHelperTransport({ script, cwd: dir });
    expect(await transport.poll()).toMatchObject({ type: "timeout" });
    const event = await transport.poll();
    await transport.reply(event, {
      data: { published: true },
      message: "ready",
    });
    expect(await transport.poll()).toMatchObject({ type: "exit" });
    expect(await Bun.file(join(dir, "args.json")).json()).toEqual([
      "--reply",
      "event-1",
      "done",
      "--file",
      "variant.tsx",
      "--data",
      '{"published":true}',
      "ready",
    ]);
  });

  test("rejects legacy status IDs and malformed boundary fields before process dispatch", async () => {
    const { dir, script } = await fixture(
      'import { appendFileSync } from "node:fs"; appendFileSync("ran", "yes");',
    );
    const transport = await createLiveHelperTransport({ script, cwd: dir });
    await expect(
      transport.reply({ type: "generate", id: "done", raw: "{}" }, {}),
    ).rejects.toThrow("valid id");
    await expect(
      transport.reply({ type: "generate", id: 3, raw: "{}" } as never, {}),
    ).rejects.toThrow("invalid event");
    await expect(
      transport.reply({ type: "generate", id: "ok", raw: "{}" }, {
        file: 3,
      } as never),
    ).rejects.toThrow("model result is invalid");
    expect(await Bun.file(join(dir, "ran")).exists()).toBe(false);
  });

  test("surfaces actual helper failure and missing installation", async () => {
    const { dir, script } = await fixture(
      'console.error("server gone"); process.exit(7);',
    );
    const transport = await createLiveHelperTransport({ script, cwd: dir });
    await expect(transport.poll()).rejects.toThrow("exit code 7: server gone");
    await expect(
      createLiveHelperTransport({ script: join(dir, "missing.mjs"), cwd: dir }),
    ).rejects.toThrow("install or bundle it");
  });

  test("onSpawn abort is observed and never succeeds", async () => {
    const { dir, script } = await fixture(
      'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);',
    );
    const controller = new AbortController();
    const operation = runHelperProcess(script, [], dir, controller.signal, () =>
      controller.abort(),
    );
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
  });

  test("bounds immutable helper process output", async () => {
    const { dir, script } = await fixture(
      'process.stdout.write("x".repeat(1024 * 1024 + 1));',
    );
    await expect(runHelperProcess(script, [], dir)).rejects.toThrow(
      "stdout exceeded 1048576 bytes",
    );
  });
});
