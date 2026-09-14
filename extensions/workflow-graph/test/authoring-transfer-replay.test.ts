import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProgramHost, LAUNCH_ENTRY_TYPE } from "../src/authoring/host.ts";
import { transferFixture } from "./authoring-transfer-fixture.ts";

for (const mode of ["launch-flush", "interrupted-restore"] as const) {
  test(`rejects changed destination bytes when transfer reaches ${mode}`, async () => {
    // Given: durable transfer intent followed by late copied-file tampering.
    await using f = await transferFixture();
    const request = {
      sourceRunId: "source-run",
      selection: f.manifest.destination,
      manifest: f.manifest,
      confirmed: true,
    };
    let copied = "";
    f.durability.flush = async () => {
      const entry = f.entries.at(-1);
      if (entry?.customType === "omo-workflow-graph:transfer-intent") {
        assert(
          typeof entry.data === "object" &&
            entry.data !== null &&
            "launch" in entry.data,
        );
        const launch = entry.data.launch;
        assert(
          typeof launch === "object" &&
            launch !== null &&
            "artifactRoot" in launch &&
            typeof launch.artifactRoot === "string",
        );
        copied = join(launch.artifactRoot, "input/report.json");
        if (mode === "interrupted-restore") f.host.stop();
      }
      if (mode === "launch-flush" && entry?.customType === LAUNCH_ENTRY_TYPE)
        await writeFile(copied, "changed");
    };
    if (mode === "interrupted-restore") {
      await f.host.transfer(f.context, request);
      await writeFile(copied, "changed");
      f.durability.flush = async () => {};
    }
    const restored = createProgramHost(f.runtime, f.registry, () => {});
    // When: initial dispatch or interrupted restore reaches destination launch boundary.
    const result =
      mode === "launch-flush"
        ? await f.host.transfer(f.context, request)
        : await restored.restore(f.context, "destination");
    // Then: zero destination starts even though earlier copy verification succeeded.
    expect(result?.kind).toBe("rejected");
    expect(f.actions.filter((action) => action === "start")).toHaveLength(1);
    restored.stop();
  });
}
