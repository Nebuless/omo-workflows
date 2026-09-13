import { createHash } from "node:crypto";
import type { AuthoredWorkflow } from "./policy.ts";

// OMO e0746bcb: dag/{fingerprint,manager}.ts. Revalidate on runtime upgrades.
export function nativeDefinitionFingerprint(
  definition: AuthoredWorkflow,
): string {
  const nodes = definition.nodes
    .map((node) => ({
      nodeId: node.id,
      label: node.label ?? node.id,
      dependsOn: [...(node.dependsOn ?? [])].sort(),
      prompt: node.prompt,
      route:
        node.category !== undefined
          ? { kind: "category", category: node.category }
          : {
              kind: "agent",
              agent: node.subagent_type,
              ...(node.model === undefined ? {} : { model: node.model }),
            },
      ...(node.task_summary === undefined
        ? {}
        : { taskSummary: node.task_summary }),
      ...(node.description === undefined
        ? {}
        : { description: node.description }),
      childName: node.id,
    }))
    .sort((left, right) =>
      left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0,
    );
  return createHash("sha256")
    .update(
      canonical({
        name: definition.name,
        scheduler: {
          waveAdmission: "dependency-frontier",
          failurePolicy: "continue-independent",
          dependencyData: "filesystem-only",
        },
        nodes,
      }),
    )
    .digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}
