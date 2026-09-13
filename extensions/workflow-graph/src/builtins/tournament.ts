import { Type, type TSchema } from "typebox";
import type { ProgramContext, StagedProgram } from "../execution/policy.ts";
import {
  artifactRoot,
  completedIds,
  fileNode,
  output,
  type Route,
} from "./helpers.ts";
import {
  checked,
  inputSchemas,
  parseBuiltinInput,
  TournamentScoreSchema,
  type ParsedInputs,
} from "./schemas.ts";

type Pair = { a: number; b: number };
type Criterion = { id: string; name: string; description: string };
type Inputs = ParsedInputs["tournament"];
type Job = Pair & {
  id: string;
  criterion: Criterion;
  criterionIndex: number;
  rep: number;
  swapped: boolean;
  path: string;
};
type Comparison = Pair & {
  phase: "ring" | "pivot";
  criterion_id: string;
  rep: number;
  swapped: boolean;
  score_a?: number;
  score_b?: number;
  p_ab?: number;
  invalid?: true;
  judge_artifact_path: string;
};
type PairRecord = Pair & {
  phase: "ring" | "pivot";
  valid_reports: number;
  mean_score_a?: number;
  mean_score_b?: number;
  p_ab: number;
  invalid?: true;
};
const DEFAULT_CRITERIA: readonly Criterion[] = [
  {
    id: "correctness",
    name: "Correctness",
    description: "Satisfies the task without material errors.",
  },
  {
    id: "completeness",
    name: "Completeness",
    description: "Covers required outcomes and important edge cases.",
  },
  {
    id: "evidence_and_task_fit",
    name: "Evidence and task fit",
    description:
      "Supports claims with observable evidence or checks and is directly usable without irrelevant work.",
  },
];

export function tournament(
  route: Route,
  root: string,
): StagedProgram<Record<string, unknown>> {
  const dir = artifactRoot(root, "tournament");
  return {
    key: "tournament",
    version: 1,
    input: inputSchemas.tournament,
    decide(state) {
      const parsed = parseBuiltinInput("tournament", state.inputs);
      if (!parsed) throw new Error("tournament: invalid inputs");
      const inputs: Inputs = parsed;
      const criteria = normalizeCriteria(inputs.criteria);
      const paths = Array.from(
        { length: inputs.num_attempts },
        (_, index) => `${dir}/attempts/attempt-${index + 1}.md`,
      );
      const done = completedIds(state);
      const missing = paths.flatMap((path, index) =>
        done.has(`attempt-${index + 1}`) ? [] : [{ path, index }],
      );
      if (missing.length) {
        const selected = missing.slice(0, inputs.max_concurrency);
        ensureCapacity(state, selected.length);
        const batch =
          Math.floor((paths.length - missing.length) / inputs.max_concurrency) +
          1;
        return {
          kind: "wave",
          id: `attempts-batch-${batch}`,
          nodes: selected.map(({ path, index }) =>
            fileNode(
              attemptRoute(route, inputs.models, index),
              `attempt-${index + 1}`,
              `Produce independent whole-task attempt ${index + 1}.\n\n${inputs.prompt}`,
              path,
            ),
          ),
        };
      }
      const ring = ringPairs(inputs.num_attempts, inputs.seed);
      const ringJobs = makeJobs(
        "ring",
        ring,
        criteria,
        inputs.n_evaluations,
        dir,
      );
      const ringPending = pendingJobs(state.results, ringJobs);
      if (ringPending.length)
        return scoreWave(
          route,
          "ring",
          ringPending,
          paths,
          inputs.prompt,
          paths.map((_, index) => `attempt-${index + 1}`),
          inputs.max_concurrency,
          state,
        );
      const ringArtifacts = invalidArtifactWave(route, "ring", ringJobs, state);
      if (ringArtifacts) return ringArtifacts;
      const ringScore = scorePhase(state.results, "ring", ring, ringJobs);
      const weights = Array.from({ length: paths.length }, () => 0);
      const counts = [...weights];
      accumulate(ringScore.records, weights, counts);
      const pivots = rank(weights, counts).slice(
        0,
        Math.min(inputs.pivots, paths.length),
      );
      const pivotPairs = pairsForPivots(paths.length, pivots, ring);
      const pivotJobs = makeJobs(
        "pivot",
        pivotPairs,
        criteria,
        inputs.n_evaluations,
        dir,
      );
      const pivotPending = pendingJobs(state.results, pivotJobs);
      if (pivotPending.length)
        return scoreWave(
          route,
          "pivot",
          pivotPending,
          paths,
          inputs.prompt,
          ringJobs.map((job) => terminalNodeId(state.results, job)),
          inputs.max_concurrency,
          state,
        );
      const pivotArtifacts = invalidArtifactWave(
        route,
        "pivot",
        pivotJobs,
        state,
      );
      if (pivotArtifacts) return pivotArtifacts;
      const pivotScore = scorePhase(
        state.results,
        "pivot",
        pivotPairs,
        pivotJobs,
      );
      accumulate(pivotScore.records, weights, counts);
      const rankingIndices = rank(weights, counts);
      const ranking = rankingIndices.map((index) => ({
        label: `attempt-${index + 1}`,
        meanPreference:
          counts[index] === 0
            ? 0
            : arrayValue(weights, index) / arrayValue(counts, index),
      }));
      const allJobs = [...ringJobs, ...pivotJobs];
      const comparisons = [...ringScore.comparisons, ...pivotScore.comparisons];
      const pairs = [...ringScore.records, ...pivotScore.records];
      const judgePaths = allJobs.map((job) => job.path);
      const assignment = modelAssignment(paths.length, inputs.models);
      const budgetPivots = Math.min(inputs.pivots, paths.length);
      const planned =
        (paths.length +
          budgetPivots * (paths.length - budgetPivots) +
          (budgetPivots * (budgetPivots - 1)) / 2) *
        criteria.length *
        inputs.n_evaluations;
      const ledger = {
        task: inputs.prompt,
        seed: inputs.seed,
        params: {
          n: paths.length,
          pivots: inputs.pivots,
          n_evaluations: inputs.n_evaluations,
          criteria,
        },
        comparisons,
        pairs,
        w: weights,
        c: counts,
        ranking: ranking.map((entry, index) => ({
          ...entry,
          index: arrayValue(rankingIndices, index),
        })),
        budget: {
          planned,
          executed:
            comparisons.length +
            allJobs.filter(
              (job) =>
                findResult(state.results, `${job.id}-reask`) !== undefined,
            ).length,
        },
        ...(assignment === undefined ? {} : { model_assignment: assignment }),
      };
      const ledgerPath = `${dir}/comparisons.json`;
      if (!output(state, "comparison-ledger", "comparison-ledger")) {
        ensureCapacity(state, 1, 1);
        return {
          kind: "wave",
          id: "comparison-ledger",
          nodes: [
            fileNode(
              route,
              "comparison-ledger",
              "Persist exact tournament ledger.",
              ledgerPath,
              literalSchema(ledger),
              allJobs.map((job) => artifactNodeId(state.results, job)),
            ),
          ],
        };
      }
      const winner = rankingIndices[0];
      if (winner === undefined) throw new Error("tournament: no winner");
      const reduced = output(state, "reduce", "reduce");
      if (reduced === undefined) {
        ensureCapacity(state, 1, 0);
        return {
          kind: "wave",
          id: "reduce",
          nodes: [
            fileNode(
              route,
              "reduce",
              `Read ${ledgerPath}, winning source ${paths[winner]}, and judge artifacts ${JSON.stringify(judgePaths)}. Produce auditable winner and full ranking report.`,
              `${dir}/winner.md`,
              undefined,
              ["comparison-ledger"],
            ),
          ],
        };
      }
      if (typeof reduced !== "string")
        throw new Error("tournament: reducer report must be string");
      return {
        kind: "final",
        result: {
          result: reduced,
          winner: `attempt-${winner + 1}`,
          winner_artifact_path: paths[winner],
          result_path: `${dir}/winner.md`,
          attempt_artifact_paths: paths,
          judge_artifact_paths: judgePaths,
          comparisons_path: ledgerPath,
          ranking,
          seed: inputs.seed,
          artifact_dir: dir,
        },
      };
    },
  };
}

function normalizeCriteria(input: Inputs["criteria"]): Criterion[] {
  if (input === undefined) return [...DEFAULT_CRITERIA];
  if (typeof input === "string") return parseRubric(input);
  const values: Array<{ id?: string; name?: string; description: string }> = [];
  if (Array.isArray(input))
    for (const item of input) {
      if (typeof item === "string") values.push({ description: item });
      else values.push(item);
    }
  else
    for (const [name, description] of Object.entries(input))
      values.push({ name, description });
  if (!values.length) throw new Error("tournament: criteria is empty");
  const seen = new Set<string>();
  return values.map((value, index) => criterion(value, index, seen));
}
function parseRubric(markdown: string): Criterion[] {
  const values: Array<{ id?: string; name?: string; description: string }> = [];
  let active = false;
  let current: { id?: string; name?: string; lines: string[] } | undefined;
  const flush = () => {
    if (current)
      values.push({
        id: current.id,
        name: current.name,
        description: current.lines.join("\n").trim(),
      });
    current = undefined;
  };
  for (const line of markdown
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .split(/\r?\n/)) {
    if (/^## (?!#)/.test(line)) {
      flush();
      active = /criteri/i.test(line.slice(3));
      continue;
    }
    if (active && line.startsWith("### ")) {
      flush();
      const heading = line.slice(4).trim();
      const match = /^(.*?)\s*\{#([A-Za-z0-9_-]+)\}\s*$/.exec(heading);
      current = {
        ...(match ? { id: match[2] } : {}),
        name: (match?.[1] ?? heading).trim(),
        lines: [],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  if (!values.length) throw new Error("tournament: no criteria found");
  const seen = new Set<string>();
  return values.map((value, index) => criterion(value, index, seen));
}
function criterion(
  value: { id?: string; name?: string; description: string },
  index: number,
  seen: Set<string>,
): Criterion {
  if (!value.description.trim())
    throw new Error(
      `tournament: criterion ${value.id ?? value.name ?? index} empty`,
    );
  const name =
    value.name?.trim() || value.id?.trim() || slug(value.description);
  const base = value.id?.trim() || slug(name);
  let id = base;
  let suffix = 1;
  while (seen.has(id)) {
    suffix += 1;
    id = `${base}_${suffix}`;
  }
  seen.add(id);
  return { id, name, description: value.description.trim() };
}
function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40)
      .replace(/_+$/g, "") || "criterion"
  );
}
function attemptRoute(
  route: Route,
  models: readonly string[] | undefined,
  index: number,
): Route {
  if (!models?.length) return route;
  if (!("subagent_type" in route))
    throw new Error("tournament: models require subagent route");
  return { ...route, model: models[index % models.length] };
}
function modelAssignment(
  n: number,
  models: readonly string[] | undefined,
): Record<string, string> | undefined {
  if (models === undefined) return undefined;
  const result: Record<string, string> = {};
  if (models.length)
    for (let index = 0; index < n; index += 1)
      result[`attempt-${index + 1}`] = arrayValue(
        models,
        index % models.length,
      );
  return result;
}
function makeJobs(
  phase: "ring" | "pivot",
  pairs: readonly Pair[],
  criteria: readonly Criterion[],
  repeats: number,
  dir: string,
): Job[] {
  return pairs.flatMap((pair) =>
    criteria.flatMap((criterion, criterionIndex) =>
      Array.from({ length: repeats }, (_, rep) => ({
        ...pair,
        criterion,
        criterionIndex,
        rep,
        swapped: rep % 2 === 1,
        id: `${phase}-${pair.a + 1}-${pair.b + 1}-c${criterionIndex}-${rep + 1}`,
        path: `${dir}/judges/judge-${pair.a}-${pair.b}-c${criterionIndex}-${slug(criterion.id)}-r${rep}.json`,
      })),
    ),
  );
}
function pendingJobs(
  results: ProgramContext<object>["results"],
  jobs: readonly Job[],
): Job[] {
  return jobs.flatMap((job) => {
    if (validReport(results, job)) return [];
    const retried = findResult(results, `${job.id}-reask`) !== undefined;
    return retried
      ? []
      : [
          {
            ...job,
            id:
              findResult(results, job.id) === undefined
                ? job.id
                : `${job.id}-reask`,
          },
        ];
  });
}
function scoreWave(
  route: Route,
  phase: string,
  pending: readonly Job[],
  paths: readonly string[],
  task: string,
  deps: readonly string[],
  limit: number,
  state: ProgramContext<object>,
) {
  const retries = pending.filter((job) => job.id.endsWith("-reask"));
  const selected = (
    retries.length
      ? retries
      : pending.filter((job) => !job.id.endsWith("-reask"))
  ).slice(0, limit);
  const prefix = retries.length ? `${phase}-reask` : phase;
  const completed = Object.keys(state.results).filter((wave) =>
    wave.startsWith(`${prefix}-batch-`),
  ).length;
  ensureCapacity(state, selected.length);
  return {
    kind: "wave" as const,
    id: `${prefix}-batch-${completed + 1}`,
    nodes: selected.map((job) =>
      fileNode(
        route,
        job.id,
        `Score slot 1 ${paths[job.swapped ? job.b : job.a]} and slot 2 ${paths[job.swapped ? job.a : job.b]} against ${JSON.stringify(job.criterion)}. Task: ${task}`,
        job.path,
        TournamentScoreSchema,
        job.id.endsWith("-reask") ? [job.id.slice(0, -6)] : deps,
        "report",
      ),
    ),
  };
}
function invalidArtifactWave(
  route: Route,
  phase: string,
  jobs: readonly Job[],
  state: ProgramContext<object>,
) {
  const invalid = jobs.filter(
    (job) =>
      !validReport(state.results, job) &&
      findResult(state.results, `${job.id}-reask`) !== undefined &&
      output(
        state,
        `${phase}-invalid-artifacts`,
        `${job.id}-invalid-artifact`,
      ) === undefined,
  );
  if (!invalid.length) return undefined;
  ensureCapacity(state, invalid.length);
  return {
    kind: "wave" as const,
    id: `${phase}-invalid-artifacts`,
    nodes: invalid.map((job) =>
      fileNode(
        route,
        `${job.id}-invalid-artifact`,
        "Persist invalid judge sentinel.",
        job.path,
        Type.Object(
          { invalid: Type.Literal(true) },
          { additionalProperties: false },
        ),
        [`${job.id}-reask`],
      ),
    ),
  };
}
function validReport(results: ProgramContext<object>["results"], job: Job) {
  const base = checked(TournamentScoreSchema, findResult(results, job.id));
  const retry = checked(
    TournamentScoreSchema,
    findResult(results, `${job.id}-reask`),
  );
  return base?.criterion_id === job.criterion.id
    ? base
    : retry?.criterion_id === job.criterion.id
      ? retry
      : undefined;
}
function scorePhase(
  results: ProgramContext<object>["results"],
  phase: "ring" | "pivot",
  pairs: readonly Pair[],
  jobs: readonly Job[],
) {
  const comparisons: Comparison[] = jobs.map((job) => {
    const report = validReport(results, job);
    if (!report)
      return {
        a: job.a,
        b: job.b,
        phase,
        criterion_id: job.criterion.id,
        rep: job.rep,
        swapped: job.swapped,
        invalid: true,
        judge_artifact_path: job.path,
      };
    const scoreA = job.swapped ? report.score_b : report.score_a;
    const scoreB = job.swapped ? report.score_a : report.score_b;
    return {
      a: job.a,
      b: job.b,
      phase,
      criterion_id: job.criterion.id,
      rep: job.rep,
      swapped: job.swapped,
      score_a: scoreA,
      score_b: scoreB,
      p_ab: sourcePreference([scoreA], [scoreB]),
      judge_artifact_path: job.path,
    };
  });
  const records: PairRecord[] = pairs.map((pair) => {
    const valid = comparisons.filter(
      (item) => item.a === pair.a && item.b === pair.b && item.invalid !== true,
    ) as Array<Comparison & { score_a: number; score_b: number }>;
    if (!valid.length)
      return { ...pair, phase, valid_reports: 0, p_ab: 0.5, invalid: true };
    const meanA =
      valid.reduce((sum, item) => sum + item.score_a, 0) / valid.length;
    const meanB =
      valid.reduce((sum, item) => sum + item.score_b, 0) / valid.length;
    return {
      ...pair,
      phase,
      valid_reports: valid.length,
      mean_score_a: meanA,
      mean_score_b: meanB,
      p_ab: sourcePreference([meanA], [meanB]),
    };
  });
  return { comparisons, records };
}
function terminalNodeId(
  results: ProgramContext<object>["results"],
  job: Job,
): string {
  return findResult(results, `${job.id}-reask`) === undefined
    ? job.id
    : `${job.id}-reask`;
}
function artifactNodeId(
  results: ProgramContext<object>["results"],
  job: Job,
): string {
  return validReport(results, job)
    ? terminalNodeId(results, job)
    : `${job.id}-invalid-artifact`;
}
function findResult(
  results: ProgramContext<object>["results"],
  id: string,
): unknown {
  return Object.values(results).find((values) => values[id] !== undefined)?.[
    id
  ];
}
export function sourcePreference(
  scoresA: readonly number[],
  scoresB: readonly number[],
): number {
  if (scoresA.length === 0 || scoresA.length !== scoresB.length) return 0.5;
  const meanA = scoresA.reduce((sum, score) => sum + score, 0) / scoresA.length;
  const meanB = scoresB.reduce((sum, score) => sum + score, 0) / scoresB.length;
  return 1 / (1 + Math.exp(-((meanA - meanB) / 19)));
}
function accumulate(
  pairs: readonly { a: number; b: number; p_ab: number }[],
  weights: number[],
  counts: number[],
) {
  for (const pair of pairs) {
    weights[pair.a] = arrayValue(weights, pair.a) + pair.p_ab;
    counts[pair.a] = arrayValue(counts, pair.a) + 1;
    weights[pair.b] = arrayValue(weights, pair.b) + 1 - pair.p_ab;
    counts[pair.b] = arrayValue(counts, pair.b) + 1;
  }
}
function arrayValue<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined)
    throw new Error("tournament: array invariant failed");
  return value;
}
function ensureCapacity(
  state: ProgramContext<object>,
  fresh: number,
  reserve = 2,
) {
  const admitted = Object.values(state.results).reduce(
    (count, wave) => count + Object.keys(wave).length,
    0,
  );
  if (admitted + fresh + reserve > 64)
    throw new Error(
      "tournament: actual cumulative schedule plus ledger and reducer exceeds native 64-node limit",
    );
}
function literalSchema(value: unknown): TSchema {
  if (Array.isArray(value)) return Type.Tuple(value.map(literalSchema));
  if (value && typeof value === "object")
    return Type.Object(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, literalSchema(item)]),
      ),
      { additionalProperties: false },
    );
  if (value === null) return Type.Null();
  return Type.Literal(value as string | number | boolean);
}
function rank(weights: readonly number[], counts: readonly number[]): number[] {
  return Array.from({ length: weights.length }, (_, index) => index).sort(
    (a, b) =>
      (weights[b] ?? 0) / (counts[b] || 1) -
        (weights[a] ?? 0) / (counts[a] || 1) || a - b,
  );
}
function ringPairs(n: number, seed: number): Pair[] {
  const values = Array.from({ length: n }, (_, index) => index);
  const random = rng(seed);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const value = values[i];
    const other = values[j];
    if (value === undefined || other === undefined)
      throw new Error("tournament: invalid shuffle");
    values[i] = other;
    values[j] = value;
  }
  return values.map((a, index) => {
    const b = values[(index + 1) % n];
    if (b === undefined) throw new Error("tournament: invalid ring");
    return { a, b };
  });
}
function pairsForPivots(
  n: number,
  pivots: readonly number[],
  ring: readonly Pair[],
): Pair[] {
  const seen = new Set(ring.map((pair) => key(pair.a, pair.b)));
  const set = new Set(pivots);
  const pairs: Pair[] = [];
  const add = (a: number, b: number) => {
    const k = key(a, b);
    if (a !== b && !seen.has(k)) {
      seen.add(k);
      pairs.push({ a, b });
    }
  };
  for (let candidate = 0; candidate < n; candidate += 1)
    if (!set.has(candidate)) for (const pivot of pivots) add(candidate, pivot);
  for (let i = 0; i < pivots.length; i += 1)
    for (let j = i + 1; j < pivots.length; j += 1) {
      const a = pivots[i];
      const b = pivots[j];
      if (a !== undefined && b !== undefined) add(a, b);
    }
  return pairs;
}
function key(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
