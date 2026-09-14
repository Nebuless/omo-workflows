import { expect, test } from "bun:test";
import { commandFixture } from "./authoring-command-fixture.ts";

for (const confirmed of [false, true]) {
  test(`requires native UI confirmation when transfer command is ${confirmed ? "accepted" : "declined"}`, async () => {
    // Given: supplied JSON is not consent, even when it claims confirmed true.
    await using f = await commandFixture();
    f.script.confirm = confirmed;
    // When: public slash command asks native UI to authorize transfer.
    await f.call('transfer {"sourceRunId":"source","confirmed":true}');
    // Then: exactly one native confirmation; invalid or declined request starts nothing.
    expect(f.script.confirmCalls).toBe(1);
    expect(f.starts).toEqual([]);
    expect(f.notices.at(-1)).toEqual({
      message: JSON.stringify({
        kind: "rejected",
        reason: confirmed
          ? "manifest-invalid"
          : "transfer-confirmation-required",
      }),
      type: "warning",
    });
  });
}
