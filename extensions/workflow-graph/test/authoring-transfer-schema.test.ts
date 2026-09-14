import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { registerStagedWorkflows } from "../src/authoring/index.ts";
import { createWorkflowGraphStore } from "../src/store.ts";
import { transferFixture } from "./authoring-transfer-fixture.ts";

test("requires complete typed transfer payload at registered public boundary", async () => {
  // Given: actual registration, not a separately exported schema proxy.
  await using f = await transferFixture();
  let parameters: TSchema | undefined;
  const store = createWorkflowGraphStore({ on: () => () => {} });
  const extension = registerStagedWorkflows(
    {
      ...f.runtime,
      cwd: f.cwd,
      registerCommand() {},
      registerTool(tool) {
        if (tool.name === "workflow_program") parameters = tool.parameters;
      },
    },
    store,
    () => {},
  );
  try {
    assert(parameters !== undefined);
    const schema = parameters;
    const valid = {
      action: "transfer",
      sourceRunId: "source-run",
      selection: f.manifest.destination,
      manifest: f.manifest,
      confirmed: true,
    };
    const { sourceRunId: _, ...sourceMissing } = valid;
    const { confirmed: __, ...confirmationMissing } = valid;
    // When: real public schema parses complete, declined, incomplete, and malformed requests.
    const accepted = [
      valid,
      { ...valid, confirmed: false },
      { action: "transfer" },
      sourceMissing,
      confirmationMissing,
      { ...valid, selection: { key: "destination" } },
      { ...valid, manifest: {} },
      { ...valid, manifest: { ...f.manifest, mappings: [] } },
      { ...valid, extra: true },
    ].map((value) => Value.Check(schema, value));
    // Then: consent is a required boolean; runtime alone authorizes true.
    expect(accepted).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  } finally {
    extension.dispose();
    store.dispose();
  }
});
