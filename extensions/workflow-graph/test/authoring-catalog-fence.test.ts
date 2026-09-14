import { expect, test } from "bun:test";
import { fixture } from "./authoring-catalog-entry.test.ts";

test("session stop fences catalog import before launch", async () => {
  const f = await fixture();
  try {
    await f.put(
      `${f.cwd}/.omo/workflows/local.ts`,
      'export const program={key:"local",version:1,input:{type:"object"},decide:()=>({kind:"final",result:1})};',
    );
    const listed = (await f.call({ action: "list" })) as {
      readonly revision: number;
      readonly descriptors: readonly {
        readonly key: string;
        readonly digest: string;
      }[];
    };
    const descriptor = listed.descriptors.find((item) => item.key === "local");
    if (descriptor === undefined) throw new Error("missing local descriptor");
    const pending = f.call({
      action: "start",
      selection: {
        key: descriptor.key,
        revision: listed.revision,
        digest: descriptor.digest,
      },
      inputs: {},
    });
    f.extension.host.stop();
    expect(await pending).toMatchObject({ kind: "rejected" });
    expect(f.extension.host.status()).toBeUndefined();
  } finally {
    await f.close();
  }
});
