import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProgramCatalog,
  loadAuthoredProgram,
} from "../src/authoring/discovery.ts";

for (const explicit of [false, true]) {
  test(`preserves trusted transfer declarations when loaded through ${explicit ? "explicit resume" : "catalog"}`, async () => {
    // Given: schema/mapping declarations belong to trusted module, never request.
    const cwd = await mkdtemp(join(tmpdir(), "transfer-discovery-"));
    const declarations = [
      {
        canonicalPath: "report.json",
        destination: "input/report.json",
        schemaId: "report-v1",
        schema: { type: "object" },
        mapping: { source: "/report", destination: "/inputPath" },
      },
    ];
    try {
      await mkdir(join(cwd, ".omo/workflows"), { recursive: true });
      await writeFile(
        join(cwd, ".omo/workflows/source.ts"),
        `export const program={key:"source",version:1,input:{type:"object"},transferArtifacts:${JSON.stringify(declarations)},decide:()=>({kind:"final",result:{}})};`,
      );
      const context = { cwd, isProjectTrusted: () => true };
      const catalog = createProgramCatalog({
        cwd,
        agentDir: join(cwd, "agent"),
        bundled: () => [],
      });
      // When: normal authored boundary loads declaration.
      await catalog.reload(context);
      const program = explicit
        ? await loadAuthoredProgram(".omo/workflows/source.ts", context)
        : catalog.get("source", "");
      // Then: declarations survive unchanged for host transfer verification.
      expect(program?.transferArtifacts).toEqual(declarations);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
