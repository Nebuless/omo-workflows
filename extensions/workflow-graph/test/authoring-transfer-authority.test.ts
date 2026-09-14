import assert from "node:assert/strict";
import { expect, test } from "bun:test";
import { createProgramHost, LAUNCH_ENTRY_TYPE } from "../src/authoring/host.ts";
import { writeFile } from "node:fs/promises";
import { verifyTerminalTransfer } from "../src/authoring/transfer.ts";
import {
  TRANSFER_INTENT_TYPE,
  transferIntents,
  transferRejected,
} from "../src/authoring/transfer-launch.ts";
import { STAGED_ENTRY_TYPE } from "../src/execution/controller.ts";
import { transferFixture } from "./authoring-transfer-fixture.ts";

test("rejects copied-byte mutation when post-consent source snapshot yields", async () => {
  // Given: acknowledged consent followed by native snapshot mutating copied bytes.
  await using f = await transferFixture();
  let copied = "";
  let acknowledged = false;
  const native = {
    execute: async (params: Parameters<typeof f.options.native.execute>[0]) => {
      if (acknowledged) await writeFile(copied, "changed");
      return f.options.native.execute(params);
    },
  };
  // When: prepare boundary completes post-consent verification.
  const result = await verifyTerminalTransfer(
    {
      ...f.options,
      native,
      accept: async () => {
        acknowledged = true;
      },
      observe: async (event) => {
        if (event.phase === "copied") copied = event.path;
      },
    },
    f.manifest,
  );
  // Then: final copied-byte validation still rejects and removes owned allocation.
  expect(result).toEqual({ kind: "rejected", code: "artifact-changed" });
  await f.assertSourceOnly();
});

for (const boundary of ["intent", "launch", "dispatch", "restore"] as const) {
  for (const mutation of [
    "status",
    "node",
    "run_id",
    "runId",
    "runKey",
    "definitionFingerprint",
  ] as const) {
    test(`rejects destination when native source ${mutation} changes during ${boundary}`, async () => {
      // Given: real host/controller, real copied files, native authority changes at exact durable boundary.
      await using f = await transferFixture();
      const request = {
        sourceRunId: "source-run",
        selection: f.manifest.destination,
        manifest: f.manifest,
        confirmed: true,
      };
      const mutate = () => {
        f.state.reply = (reply) => {
          if (reply.run_id !== "source-run") return reply;
          switch (mutation) {
            case "status":
              return {
                ...reply,
                snapshot: { ...reply.snapshot, status: "running" },
              };
            case "node":
              return {
                ...reply,
                snapshot: {
                  ...reply.snapshot,
                  nodes: [{ id: "report", state: "failed" }],
                },
              };
            case "run_id":
              return { ...reply, run_id: "foreign" };
            case "runId":
              return {
                ...reply,
                snapshot: { ...reply.snapshot, runId: "foreign" },
              };
            case "runKey":
              return {
                ...reply,
                snapshot: { ...reply.snapshot, runKey: "foreign" },
              };
            case "definitionFingerprint":
              return {
                ...reply,
                snapshot: {
                  ...reply.snapshot,
                  definitionFingerprint: "a".repeat(64),
                },
              };
            default:
              return mutation satisfies never;
          }
        };
      };
      f.durability.flush = async () => {
        const type = f.entries.at(-1)?.customType;
        if (boundary === "restore") {
          if (type === TRANSFER_INTENT_TYPE) f.host.stop();
        } else if (
          type ===
          (boundary === "intent"
            ? TRANSFER_INTENT_TYPE
            : boundary === "launch"
              ? LAUNCH_ENTRY_TYPE
              : STAGED_ENTRY_TYPE)
        )
          mutate();
      };
      const restored = createProgramHost(f.runtime, f.registry, () => {});
      try {
        if (boundary === "restore") {
          await f.host.transfer(f.context, request);
          f.durability.flush = async () => {};
          mutate();
        }
        // When: initial or recovered transfer reaches destination dispatch.
        const result =
          boundary === "restore"
            ? await restored.restore(f.context, "destination")
            : await f.host.transfer(f.context, request);
        // Then: bounded rejection and durable attempt tombstone; no destination native start.
        expect(result?.kind).toBe("rejected");
        expect(
          f.actions.filter(
            (action) => action === "start" || action === "amend",
          ),
        ).toEqual(["start"]);
        const intent = transferIntents(f.entries).at(-1);
        assert(intent !== undefined);
        expect(transferRejected(f.entries, intent)).toBe(true);
      } finally {
        restored.stop();
      }
    });
  }
}
