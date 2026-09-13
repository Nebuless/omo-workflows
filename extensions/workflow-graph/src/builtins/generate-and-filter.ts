import { Type } from "typebox";
import type { StagedProgram } from "../execution/policy.ts";
import {
  artifactRoot,
  completedIds,
  fileNode,
  firstOutput,
  type Route,
} from "./helpers.ts";
import {
  checked,
  FilterSchema,
  inputSchemas,
  JudgeSchema,
  parseBuiltinInput,
} from "./schemas.ts";

export function generateAndFilter(
  route: Route,
  root: string,
): StagedProgram<Record<string, unknown>> {
  const dir = artifactRoot(root, "generate-and-filter");
  return {
    key: "generate-and-filter",
    version: 1,
    input: inputSchemas["generate-and-filter"],
    decide(state) {
      const inputs = parseBuiltinInput("generate-and-filter", state.inputs);
      if (!inputs) throw new Error("generate-and-filter: invalid inputs");
      const paths = Array.from(
        { length: inputs.num_candidates },
        (_, index) => `${dir}/candidate-${index + 1}.md`,
      );
      const done = completedIds(state);
      const missing = paths.flatMap((path, index) =>
        done.has(`generate-${index + 1}`) ? [] : [{ path, index }],
      );
      if (missing.length) {
        const batch =
          Math.floor((paths.length - missing.length) / inputs.max_concurrency) +
          1;
        return {
          kind: "wave",
          id: `generate-batch-${batch}`,
          nodes: missing
            .slice(0, inputs.max_concurrency)
            .map(({ path, index }) =>
              fileNode(
                route,
                `generate-${index + 1}`,
                `Generate independent candidate ${index + 1}.\n\n${inputs.prompt}`,
                path,
              ),
            ),
        };
      }
      const ManifestSchema = Type.Object(
        {
          task: Type.Literal(inputs.prompt),
          candidate_artifact_paths: Type.Tuple(
            paths.map((path) => Type.Literal(path)),
          ),
        },
        { additionalProperties: false },
      );
      const manifestPath = `${dir}/manifest.json`;
      const manifest = firstOutput(state, "manifest", "manifest");
      if (!manifest)
        return {
          kind: "wave",
          id: "manifest",
          nodes: [
            fileNode(
              route,
              "manifest",
              `Write manifest task ${JSON.stringify(inputs.prompt)} and candidate_artifact_paths ${JSON.stringify(paths)}.`,
              manifestPath,
              ManifestSchema,
              paths.map((_, index) => `generate-${index + 1}`),
            ),
          ],
        };
      if (!checked(ManifestSchema, manifest))
        throw new Error("generate-and-filter: invalid manifest");
      const filterPath = `${dir}/filter.json`;
      const filtered = firstOutput(state, "filter", "dedupe-and-filter");
      if (!filtered)
        return {
          kind: "wave",
          id: "filter",
          nodes: [
            fileNode(
              route,
              "dedupe-and-filter",
              `Read ${manifestPath}. Select at most ${Math.min(inputs.shortlist_size, paths.length)} allowlisted paths.`,
              filterPath,
              FilterSchema,
              ["manifest"],
              "report",
            ),
          ],
        };
      const parsedFilter = checked(FilterSchema, filtered);
      let decisionNode = "dedupe-and-filter";
      if (!parsedFilter) {
        decisionNode = "filter-fallback";
        if (!firstOutput(state, "filter-fallback", decisionNode))
          return {
            kind: "wave",
            id: decisionNode,
            nodes: [
              fileNode(
                route,
                decisionNode,
                "Persist empty structured filter fallback.",
                filterPath,
                Type.Object(
                  { shortlist: Type.Tuple([]), discarded: Type.Tuple([]) },
                  { additionalProperties: false },
                ),
                ["dedupe-and-filter"],
              ),
            ],
          };
      }
      const fallback = admit(
        paths,
        parsedFilter?.shortlist ?? [],
        inputs.shortlist_size,
      );
      let selected = fallback.length
        ? fallback
        : paths.slice(0, inputs.shortlist_size);
      let judgePath: string | null = null;
      let decisionPath = filterPath;
      if (inputs.use_judge) {
        judgePath = `${dir}/judge.json`;
        const judged = firstOutput(state, "judge", "judge");
        if (!judged)
          return {
            kind: "wave",
            id: "judge",
            nodes: [
              fileNode(
                route,
                "judge",
                `Read ${filterPath}; rank only ${JSON.stringify(selected)}.`,
                judgePath,
                JudgeSchema,
                [decisionNode],
                "report",
              ),
            ],
          };
        const parsed = checked(JudgeSchema, judged);
        decisionNode = parsed ? "judge" : "judge-fallback";
        if (!parsed && !firstOutput(state, "judge-fallback", decisionNode))
          return {
            kind: "wave",
            id: decisionNode,
            nodes: [
              fileNode(
                route,
                decisionNode,
                "Persist empty structured judge fallback.",
                judgePath,
                Type.Object(
                  {
                    shortlist: Type.Tuple([]),
                    rationale: Type.Literal(
                      "Judge stage produced no valid structured decision.",
                    ),
                  },
                  { additionalProperties: false },
                ),
                ["judge"],
              ),
            ],
          };
        const admitted = admit(
          paths,
          parsed?.shortlist ?? [],
          inputs.shortlist_size,
        );
        if (admitted.length) selected = admitted;
        decisionPath = judgePath;
      }
      const finalPath = `${dir}/shortlist.md`;
      const final = firstOutput(state, "final-shortlist", "final-shortlist");
      if (!final)
        return {
          kind: "wave",
          id: "final-shortlist",
          nodes: [
            fileNode(
              route,
              "final-shortlist",
              `Read ${decisionPath} and selected candidates ${JSON.stringify(selected)}. Produce final report.`,
              finalPath,
              undefined,
              [decisionNode],
            ),
          ],
        };
      return {
        kind: "final",
        result: {
          result: final,
          shortlist: selected,
          candidate_artifact_paths: paths,
          filter_path: filterPath,
          judge_path: judgePath,
          final_path: finalPath,
          artifact_dir: dir,
          manifest_path: manifestPath,
        },
      };
    },
  };
}
function admit(
  allow: readonly string[],
  choices: readonly string[],
  size: number,
): string[] {
  return [...new Set(choices.filter((path) => allow.includes(path)))].slice(
    0,
    Math.min(size, allow.length),
  );
}
