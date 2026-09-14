import { expect, test } from "bun:test";
import { Type } from "typebox";
import { composeStagedPrograms } from "../src/execution/composed.ts";
import type { StagedProgram } from "../src/execution/policy.ts";

for (const field of [
  "preapproved",
  "stage version",
  "stage input",
  "mapping edge",
  "selection revision",
] as const) {
  test(`canonical composition identity changes when ${field} changes`, () => {
    // Given: same parent key/version with distinct behavior-changing plan inputs.
    const stages = ["one", "two", "three"].map((key) => ({
      workflowKey: key,
      descriptorDigest: key,
      program: {
        key,
        version: 1,
        input: Type.Object({ input: Type.String() }),
        decide: () => ({ kind: "final", result: { value: "mapped" } }),
      } satisfies StagedProgram,
    }));
    const mappings = [[{ source: "/value", destination: "/input" }], []];
    const stageSelections: [string, number, string][] = stages.map((stage) => [
      stage.workflowKey,
      1,
      stage.descriptorDigest,
    ]);
    const plan = {
      key: "chain",
      version: 1,
      preapproved: false,
      stages,
      mappings,
      compositionIdentity: { stageSelections, mappings },
    };
    const initial = composeStagedPrograms(plan).compositionIdentity;
    // When: one behavior-bearing field changes without changing parent key/version.
    switch (field) {
      case "preapproved":
        plan.preapproved = true;
        break;
      case "stage version":
        stages[0].program.version = 2;
        break;
      case "stage input":
        stages[0].program.input = Type.Object({
          input: Type.String({ minLength: 2 }),
        });
        break;
      case "mapping edge":
        mappings.reverse();
        break;
      case "selection revision":
        stageSelections[0][1] = 2;
        break;
      default:
        field satisfies never;
    }
    const changed = composeStagedPrograms(plan).compositionIdentity;
    // Then: changed behavior cannot inherit the original durable identity or digest.
    expect(changed).not.toEqual(initial);
    expect(changed?.planDigest).not.toBe(initial?.planDigest);
  });
}
