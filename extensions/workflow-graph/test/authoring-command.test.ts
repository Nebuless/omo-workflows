import { expect, test } from "bun:test";
import { commandFixture, first, second } from "./authoring-command-fixture.ts";

// Given two distinct descriptor pairs whose friendly display strings collide.
test("starts second descriptor when second colliding picker row is confirmed", async () => {
  await using f = await commandFixture();
  await f.put("1.ts", first);
  await f.put("2.ts", second);
  // When real selector receives Down then Enter through registered command.
  await f.call("");
  await f.complete();
  // Then native run and admitted final result belong to second descriptor only.
  expect(f.starts.map(({ key }) => key.split(":")[0])).toEqual([second.key]);
  expect(f.launches()).toMatchObject([
    {
      data: {
        key: second.key,
        digest: expect.stringMatching(/^sha256:v1:/),
        revision: 1,
      },
    },
  ]);
  expect(f.extension.host.status()?.decision).toEqual({
    kind: "final",
    result: second.result,
  });
});

test("starts exact descriptor once when direct fresh command includes JSON", async () => {
  // Given distinct fallback and target workflows.
  await using f = await commandFixture();
  await f.put("1.ts", first);
  await f.put("2.ts", second);
  // When direct form supplies key plus intact JSON with quoted whitespace.
  await f.call(`${second.key} {"prompt":"two words"}`);
  await f.complete();
  // Then direct path bypasses prompts and preserves inputs/result.
  expect(f.starts).toHaveLength(1);
  expect(f.launches()).toMatchObject([
    { data: { key: second.key, inputs: { prompt: "two words" } } },
  ]);
  expect(f.extension.host.status()?.decision).toEqual({
    kind: "final",
    result: second.result,
  });
  expect(f.script.inputCalls).toBe(0);
  expect(f.script.frames).toEqual([]);
});

test("rejects stale identity when module is replaced and reloaded before confirmation", async () => {
  // Given picker snapshot followed by public reload while inputs remain pending.
  await using f = await commandFixture();
  await f.put("1.ts", first);
  await f.put("2.ts", second);
  f.script.beforeInput = async () => {
    await f.put("2.ts", { ...second, result: "replacement" });
    await f.call("reload");
  };
  // When old picker selection is submitted.
  await f.call("");
  // Then exact identity rejection precedes journal and native start.
  expect(f.notices.at(-1)).toEqual({
    message: JSON.stringify({
      kind: "rejected",
      reason: "Workflow catalog changed; choose again.",
    }),
    type: "warning",
  });
  expect(f.launches()).toEqual([]);
  expect(f.starts).toEqual([]);
});

test("rejects JSON distinctly when direct command contains malformed input", async () => {
  // Given known descriptor.
  await using f = await commandFixture();
  await f.put("1.ts", second);
  // When JSON parser fails.
  await f.call(`${second.key} {broken`);
  // Then parsing fails before journal/start, distinct from stale identity.
  expect(f.notices.at(-1)).toMatchObject({
    message: expect.stringMatching(/^Invalid workflow inputs JSON:/),
    type: "warning",
  });
  expect(f.launches()).toEqual([]);
  expect(f.starts).toEqual([]);
});

for (const scenario of [
  "unknown",
  "picker-dismissed",
  "input-dismissed",
  "session",
  "disposed",
  "invalid-input",
] as const) {
  test(`starts zero workflows when command is ${scenario}`, async () => {
    // Given real registered command and scripted UI boundary.
    await using f = await commandFixture();
    await f.put("1.ts", second);
    let args = "";
    switch (scenario) {
      case "unknown":
        args = 'missing {"prompt":"ok"}';
        break;
      case "picker-dismissed":
        f.script.keys = ["\x1b"];
        break;
      case "input-dismissed":
        f.script.keys = ["\r"];
        f.script.raw = undefined;
        break;
      case "session":
        f.script.keys = ["\r"];
        f.script.beforeInput = async () => {
          f.extension.host.stop();
        };
        break;
      case "disposed":
        f.script.keys = ["\r"];
        f.script.beforeInput = async () => {
          f.extension.dispose();
        };
        break;
      case "invalid-input":
        args = `${second.key} {"prompt":42}`;
        break;
      default: {
        const exhaustive: never = scenario;
        throw Error(exhaustive);
      }
    }
    // When selected command boundary resolves.
    await f.call(args);
    // Then no durable launch or native dispatch.
    expect(f.starts).toEqual([]);
    expect(f.launches()).toEqual([]);
    if (["unknown", "picker-dismissed", "input-dismissed"].includes(scenario))
      expect(f.notices).toEqual([]);
    if (["session", "disposed"].includes(scenario))
      expect(f.notices.at(-1)?.message).toBe("Workflow context disposed.");
  });
}
