import { expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { fixture } from "./authoring-catalog-entry.test.ts";
import { commandFixture, second } from "./authoring-command-fixture.ts";

test.each(["changed", "removed"])(
  "cancels owned native run when catalog entry is %s",
  async (mode) => {
    // Given: registered command owns an active native run before catalog replacement.
    await using f = await commandFixture();
    await f.put("entry.ts", second);
    await f.call(`${second.key} {"prompt":"task"}`);
    expect(f.extension.host.status()?.decision?.kind).toBe("active");
    if (mode === "changed")
      await f.put("entry.ts", { ...second, result: "changed" });
    else await rm(join(f.cwd, ".omo/workflows/entry.ts"));
    await f.call("reload");
    f.script.confirm = true;
    // When: explicit cancellation targets the owned run, not a new catalog selection.
    await f.call("cancel");
    // Then: native cancellation completes rather than catalog drift rejecting it.
    expect(f.extension.host.status()?.decision).toEqual({
      kind: "rejected",
      reason: "cancelled",
    });
    expect(f.notices.at(-1)?.type).not.toBe("warning");
  },
);

test("publishes increasing revisions when registered catalog reloads", async () => {
  // Given: one registered catalog has already published a complete snapshot.
  const f = await fixture();
  try {
    const before = await f.call({ action: "list" });
    Value.Assert(Type.Object({ revision: Type.Integer() }), before);
    // When: unchanged contents are explicitly republished.
    const after = await f.call({ action: "reload" });
    Value.Assert(Type.Object({ revision: Type.Integer() }), after);
    // Then: publication identity never resets even if descriptor bytes match.
    expect(after.revision).toBe(before.revision + 1);
    expect(f.nativeDispatches).toEqual([]);
  } finally {
    await f.close();
  }
});

test("rejects stale picker selection when only imported helper changes on reload", async () => {
  // Given: entry bytes stay fixed; imported helper controls workflow behavior.
  await using f = await commandFixture();
  await f.put("entry.ts", second);
  await writeFile(join(f.cwd, "helper.ts"), "export const value=1;");
  await writeFile(
    join(f.cwd, ".omo/workflows/entry.ts"),
    'import {value} from "../../helper.ts"; export const program={key:"helper",version:1,input:{type:"object"},decide:()=>({kind:"final",result:value})};',
  );
  f.script.beforeInput = async () => {
    await writeFile(join(f.cwd, "helper.ts"), "export const value=2;");
    await f.call("reload");
  };
  // When: direct command captures selection before the input callback republishes code.
  await f.call("helper");
  // Then: original revision cannot authorize reloaded helper code, even with same digest.
  expect(f.extension.host.status()).toBeUndefined();
  expect(f.launches()).toEqual([]);
  expect(f.starts).toEqual([]);
  expect(f.notices.at(-1)).toEqual({
    message: JSON.stringify({
      kind: "rejected",
      reason: "Workflow catalog changed; choose again.",
    }),
    type: "warning",
  });
});

test("keeps prior catalog when session stops during reload", async () => {
  // Given: published authored program, followed by an unpublished replacement.
  const f = await fixture();
  try {
    const path = join(f.cwd, ".omo/workflows/entry.ts");
    await f.put(
      path,
      'export const program={key:"prior",version:1,input:{},decide:()=>({kind:"final",result:1})};',
    );
    const before = await f.call({ action: "list" });
    Value.Assert(Type.Object({ programs: Type.Array(Type.String()) }), before);
    await f.put(
      path,
      'export const program={key:"replacement",version:1,input:{},decide:()=>({kind:"final",result:2})};',
    );
    // When: session invalidation happens before async reload can publish.
    const pending = f.call({ action: "reload" });
    f.extension.host.stop();
    const result = await pending;
    // Then: failed publication cannot leak partial catalog into host registry.
    expect(result).toMatchObject({ kind: "rejected" });
    expect(f.extension.host.list()).toEqual(before.programs);
    expect(f.nativeDispatches).toEqual([]);
  } finally {
    await f.close();
  }
});
