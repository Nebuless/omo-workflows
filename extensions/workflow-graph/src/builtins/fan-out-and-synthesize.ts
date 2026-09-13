import { Type } from "typebox";
import { isDeepStrictEqual } from "node:util";
import type { StagedProgram } from "../execution/policy.ts";
import {
  artifactRoot,
  completedIds,
  fileNode,
  firstOutput,
  output,
  type Route,
} from "./helpers.ts";
import { checked, inputSchemas, parseBuiltinInput } from "./schemas.ts";
const PartitionArtifactSchema = Type.Object(
  {
    task: Type.String(),
    partitions: Type.Array(
      Type.Object(
        {
          label: Type.String({ minLength: 1 }),
          objective: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 12 },
    ),
  },
  { additionalProperties: false },
);

export function fanOutAndSynthesize(
  route: Route,
  root: string,
): StagedProgram<Record<string, unknown>> {
  const dir = artifactRoot(root, "fan-out-and-synthesize");
  return {
    key: "fan-out-and-synthesize",
    version: 1,
    input: inputSchemas["fan-out-and-synthesize"],
    decide(state) {
      const inputs = parseBuiltinInput("fan-out-and-synthesize", state.inputs);
      if (inputs === undefined)
        throw new Error("fan-out-and-synthesize: invalid inputs");
      const partitionPath = `${dir}/partition-plan.json`;
      const rawPlan = output(state, "partition", "partition");
      if (rawPlan === undefined)
        return {
          kind: "wave",
          id: "partition",
          nodes: [
            fileNode(
              route,
              "partition",
              `Partition task into at most ${inputs.max_branches} independent branches. Persist task exactly as ${JSON.stringify(inputs.prompt)}.\n\n${inputs.prompt}`,
              partitionPath,
              PartitionArtifactSchema,
              [],
              "report",
            ),
          ],
        };
      const plan = checked(PartitionArtifactSchema, rawPlan);
      const normalized =
        plan?.task === inputs.prompt
          ? plan.partitions
              .map(({ label, objective }) => ({
                label: label.trim(),
                objective: objective.trim(),
              }))
              .filter(
                ({ label, objective }) => label !== "" && objective !== "",
              )
              .slice(0, inputs.max_branches)
          : [];
      const fallbackNeeded = normalized.length === 0;
      const partitions = fallbackNeeded
        ? [{ label: "whole-task", objective: inputs.prompt }]
        : normalized;
      const planNode = fallbackNeeded
        ? "partition-fallback"
        : isDeepStrictEqual(plan?.partitions, partitions)
          ? "partition"
          : "partition-normalized";
      if (
        planNode !== "partition" &&
        output(state, planNode, planNode) === undefined
      )
        return {
          kind: "wave",
          id: planNode,
          nodes: [
            fileNode(
              route,
              planNode,
              "Persist normalized partition plan from exact schema.",
              partitionPath,
              Type.Object(
                {
                  task: Type.Literal(inputs.prompt),
                  partitions: Type.Tuple(
                    partitions.map(({ label, objective }) =>
                      Type.Object(
                        {
                          label: Type.Literal(label),
                          objective: Type.Literal(objective),
                        },
                        { additionalProperties: false },
                      ),
                    ),
                  ),
                },
                { additionalProperties: false },
              ),
              ["partition"],
            ),
          ],
        };
      const branches = partitions.map((part, index) => ({
        id: `branch-${String(index + 1).padStart(2, "0")}-${
          part.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "branch"
        }`,
        ...part,
      }));
      const done = completedIds(state);
      const missing = branches.filter((branch) => !done.has(branch.id));
      if (missing.length) {
        const batch =
          Math.floor(
            (branches.length - missing.length) / inputs.max_concurrency,
          ) + 1;
        return {
          kind: "wave",
          id: `branches-batch-${batch}`,
          nodes: missing
            .slice(0, inputs.max_concurrency)
            .map((branch) =>
              fileNode(
                route,
                branch.id,
                `${inputs.prompt}\n\nIndependent branch: ${branch.objective}\nRead partition plan ${partitionPath}.`,
                `${dir}/${branch.id}.md`,
                undefined,
                [planNode],
              ),
            ),
        };
      }
      const manifestPath = `${dir}/manifest.json`;
      const manifest = firstOutput(state, "manifest", "manifest");
      const branchPaths = branches.map((branch) => `${dir}/${branch.id}.md`);
      const expectedBranches = branches.map((branch, index) => ({
        label: branch.label,
        objective: branch.objective,
        artifact_path: branchPaths[index] ?? "",
      }));
      const ManifestSchema = Type.Object(
        {
          task: Type.Literal(inputs.prompt),
          partition_plan: Type.Literal(partitionPath),
          branches: Type.Tuple(
            expectedBranches.map((branch) =>
              Type.Object(
                {
                  label: Type.Literal(branch.label),
                  objective: Type.Literal(branch.objective),
                  artifact_path: Type.Literal(branch.artifact_path),
                },
                { additionalProperties: false },
              ),
            ),
          ),
        },
        { additionalProperties: false },
      );
      if (manifest === undefined)
        return {
          kind: "wave",
          id: "manifest",
          nodes: [
            fileNode(
              route,
              "manifest",
              `Create manifest with task ${JSON.stringify(inputs.prompt)}, partition_plan ${JSON.stringify(partitionPath)}, and ordered branches ${JSON.stringify(expectedBranches)}.`,
              manifestPath,
              ManifestSchema,
              branches.map((branch) => branch.id),
            ),
          ],
        };
      if (!checked(ManifestSchema, manifest))
        throw new Error(
          "fan-out-and-synthesize: manifest differs from admitted branch contract",
        );
      const synthesis = output(state, "synthesize", "synthesize");
      const synthesisPath = `${dir}/synthesis.md`;
      if (synthesis === undefined)
        return {
          kind: "wave",
          id: "synthesize",
          nodes: [
            fileNode(
              route,
              "synthesize",
              `Read ${manifestPath} and every listed branch artifact. Synthesize: ${inputs.prompt}`,
              synthesisPath,
              undefined,
              ["manifest"],
            ),
          ],
        };
      return {
        kind: "final",
        result: {
          result: synthesis,
          partitions: partitions.map((part) => part.label),
          branch_artifact_paths: branchPaths,
          synthesis_path: synthesisPath,
          artifact_dir: dir,
          manifest_path: manifestPath,
        },
      };
    },
  };
}
