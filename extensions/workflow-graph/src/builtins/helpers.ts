import { isAbsolute, join } from "node:path";
import type { TSchema } from "typebox";
import type { ProgramContext, ProgramNode } from "../execution/policy.ts";

export type Route =
  | { readonly category: string; readonly load_skills?: string[] }
  | {
      readonly subagent_type: string;
      readonly model?: string;
      readonly load_skills?: string[];
    };

export function artifactRoot(root: string, builtin: string): string {
  if (!isAbsolute(root))
    throw new Error(`${builtin}: artifact root must be absolute`);
  return join(root, builtin);
}
export function output(
  state: ProgramContext<object>,
  wave: string,
  node: string,
): unknown {
  return state.results[wave]?.[node];
}
export function firstOutput(
  state: ProgramContext<object>,
  wavePrefix: string,
  node: string,
): unknown {
  for (const [wave, values] of Object.entries(state.results))
    if (wave === wavePrefix || wave.startsWith(`${wavePrefix}-batch-`))
      if (values[node] !== undefined) return values[node];
  return undefined;
}
export function completedIds(state: ProgramContext<object>): Set<string> {
  return new Set(
    Object.values(state.results).flatMap((wave) => Object.keys(wave)),
  );
}
export function batchWave(
  prefix: string,
  missing: readonly string[],
  limit: number,
): string {
  return `${prefix}-batch-${Math.floor((missing.length - 1) / limit) + 1}`;
}
export function jsonNode(
  route: Route,
  id: string,
  prompt: string,
  schema: TSchema,
  dependsOn: readonly string[] = [],
  invalidOutput?: "report",
): ProgramNode {
  return {
    ...route,
    id,
    prompt: `${prompt}\n\nReturn exact JSON matching this schema; no prose or markdown fences:\n${JSON.stringify(schema)}`,
    ...(dependsOn.length ? { dependsOn: [...dependsOn] } : {}),
    output: { schema },
    ...(invalidOutput === undefined ? {} : { invalidOutput }),
  };
}
export function fileNode(
  route: Route,
  id: string,
  prompt: string,
  path: string,
  schema?: TSchema,
  dependsOn: readonly string[] = [],
  invalidOutput?: "report",
): ProgramNode {
  const instruction =
    schema === undefined
      ? `Write complete non-empty artifact exactly to ${path}. Do not only return path or claim write succeeded.`
      : `Write exact JSON matching this schema exactly to ${path}; no prose or markdown fences:\n${JSON.stringify(schema)}\nDo not only return JSON in response.`;
  return {
    ...route,
    id,
    prompt: `${prompt}\n\n${instruction}`,
    ...(dependsOn.length ? { dependsOn: [...dependsOn] } : {}),
    output: {
      file: {
        path,
        ...(schema === undefined ? { nonempty: true } : { schema }),
      },
    },
    ...(invalidOutput === undefined ? {} : { invalidOutput }),
  };
}
export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}
