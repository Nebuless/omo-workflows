import { Type, type TSchema } from "typebox";
import type { ProgramContext, StagedProgram } from "../execution/policy.ts";
import {
  artifactRoot,
  fileNode,
  jsonNode,
  output,
  type Route,
} from "./helpers.ts";
import {
  checked,
  inputSchemas,
  parseBuiltinInput,
  VerifierReportSchema,
  type VerifierReport,
} from "./schemas.ts";

const ConsolidatorSchema = Type.Object(
  { repair_guidance: Type.String(), remaining_work: Type.Array(Type.String()) },
  { additionalProperties: false },
);
type Criterion = { id: string; name: string; description: string };
type Criteria = {
  groundTruthNote: string;
  criteria: Criterion[];
  markdown: string;
};
type Cell = { criterion: Criterion; slot: string; id: string };
type Attempt = {
  cell: Cell;
  reask: number;
  id: string;
  value: unknown;
  report?: VerifierReport;
};

export function adversarialVerification(
  route: Route,
  root: string,
): StagedProgram<Record<string, unknown>> {
  const dir = artifactRoot(root, "adversarial-verification");
  return {
    key: "adversarial-verification",
    version: 2,
    input: inputSchemas["adversarial-verification"],
    decide(state) {
      const inputs = parseBuiltinInput(
        "adversarial-verification",
        state.inputs,
      );
      if (!inputs) throw new Error("adversarial-verification: invalid inputs");
      const resolved = resolveCriteria(inputs.criteria);
      const criteriaPath = `${dir}/criteria.md`;
      const candidatePath = `${dir}/candidate.md`;
      if (!output(state, "criteria", "criteria"))
        return wave(state, "criteria", [
          exactTextFile(route, "criteria", resolved.markdown, criteriaPath, []),
        ]);
      if (!output(state, "candidate", "worker"))
        return wave(state, "candidate", [
          fileNode(
            route,
            "worker",
            workerPrompt(inputs.task),
            candidatePath,
            undefined,
            ["criteria"],
          ),
        ]);
      const round = currentRound(state.results);
      const cells = makeCells(resolved.criteria, inputs.verifier_count, round);
      const attempts = collectAttempts(
        state.results,
        cells,
        round,
        inputs.reask_limit,
      );
      const pending = cells.filter(
        (cell) =>
          !attempts.some(
            (attempt) =>
              attempt.cell.slot === cell.slot && attempt.report !== undefined,
          ),
      );
      const nextReask = nextReaskWave(state.results, round, inputs.reask_limit);
      if (pending.length && nextReask !== undefined)
        return verifyWave(
          route,
          state,
          pending,
          round,
          nextReask,
          candidatePath,
          criteriaPath,
          inputs.task,
          resolved.groundTruthNote,
          round === 0 && nextReask === 0
            ? ["worker"]
            : dependenciesForVerify(state, round, nextReask),
        );
      const reports = cells.flatMap(
        (cell) =>
          attempts.find(
            (attempt) =>
              attempt.cell.slot === cell.slot && attempt.report !== undefined,
          )?.report ?? [],
      );
      const invalidCount = attempts.filter(
        (attempt) => attempt.report === undefined,
      ).length;
      const expectedCount = cells.length;
      const mean = meanScore(reports);
      if (pending.length) {
        const evidence = `Quorum failure: ${pending.length} of ${expectedCount} criterion scores remain missing after ${inputs.reask_limit} re-ask wave(s); ${invalidCount} report attempts were invalid or missing.`;
        const decision = {
          kind: "indeterminate" as const,
          missing: pending.length,
        };
        const artifacts = roundArtifacts(
          route,
          dir,
          round,
          attempts,
          reports,
          mean,
          invalidCount,
          decision,
          [evidence],
          state,
        );
        if (artifacts) return artifacts;
        if (round === 0)
          return verifyWave(
            route,
            state,
            makeCells(resolved.criteria, inputs.verifier_count, 1),
            1,
            0,
            candidatePath,
            criteriaPath,
            inputs.task,
            resolved.groundTruthNote,
            summaryIds(round),
          );
        return {
          kind: "final",
          result: terminal(
            false,
            mean,
            round,
            repairCount(state.results),
            candidatePath,
            dir,
            [evidence],
          ),
        };
      }
      const findings = reports.flatMap((report) => report.findings);
      const veto = findings.some((finding) => finding.severity === "veto");
      const accepted = !veto && mean >= inputs.accept_mean;
      if (accepted) {
        const decision = { kind: "accept" as const, mean };
        const artifacts = roundArtifacts(
          route,
          dir,
          round,
          attempts,
          reports,
          mean,
          invalidCount,
          decision,
          [],
          state,
        );
        if (artifacts) return artifacts;
        return {
          kind: "final",
          result: terminal(
            true,
            mean,
            round,
            repairCount(state.results),
            candidatePath,
            dir,
            [],
          ),
        };
      }
      const confirmed = findings.map((finding) => finding.finding);
      const remaining = confirmed.length
        ? confirmed
        : [
            `Mean score ${mean} is below the acceptance threshold ${inputs.accept_mean}.`,
          ];
      const persisted = reportArtifactWave(route, dir, round, attempts, state);
      if (persisted) return persisted;
      const consolidateId = `consolidate-findings-${round}`;
      const rawConsolidated = output(state, consolidateId, consolidateId);
      if (rawConsolidated === undefined)
        return wave(state, consolidateId, [
          jsonNode(
            route,
            consolidateId,
            consolidatorPrompt(
              inputs.task,
              candidatePath,
              attempts
                .filter((item) => item.report)
                .map((item) => attemptPath(dir, round, item)),
              round,
              inputs.max_repairs,
            ),
            ConsolidatorSchema,
            recordIds(attempts),
            "report",
          ),
        ]);
      const consolidated = checked(ConsolidatorSchema, rawConsolidated) ?? {
        repair_guidance: "Confirmed verifier findings require repair.",
        remaining_work: remaining,
      };
      const decision = { kind: "repair" as const, mean, findings };
      const artifacts = summaryWave(
        route,
        dir,
        round,
        reports,
        mean,
        invalidCount,
        decision,
        remaining,
        state,
        [consolidateId],
        consolidated.repair_guidance,
      );
      if (artifacts) return artifacts;
      const completedRepair = repairForRound(state.results, round);
      if (completedRepair)
        return verifyWave(
          route,
          state,
          makeCells(resolved.criteria, inputs.verifier_count, round + 1),
          round + 1,
          0,
          candidatePath,
          criteriaPath,
          inputs.task,
          resolved.groundTruthNote,
          [completedRepair],
        );
      if (repairCount(state.results) >= inputs.max_repairs)
        return {
          kind: "final",
          result: terminal(
            false,
            mean,
            round,
            repairCount(state.results),
            candidatePath,
            dir,
            remaining,
          ),
        };
      const repairId = `repair-${repairCount(state.results) + 1}`;
      return wave(state, `${repairId}-after-${round}`, [
        fileNode(
          route,
          repairId,
          repairPrompt(
            inputs.task,
            candidatePath,
            `${dir}/review-${round}.json`,
          ),
          candidatePath,
          undefined,
          [`review-report-${round}`],
        ),
      ]);
    },
  };
}

function resolveCriteria(input: string | Record<string, string>): Criteria {
  if (typeof input === "string") {
    const parsed = parseRubric(input);
    return {
      ...parsed,
      markdown: renderCriteria(parsed.criteria, parsed.groundTruthNote),
    };
  }
  const criteria = normalizeRecord(input);
  return {
    groundTruthNote: "",
    criteria,
    markdown: renderCriteria(criteria, ""),
  };
}
function normalizeRecord(input: Record<string, string>): Criterion[] {
  const seen = new Set<string>();
  const criteria = Object.entries(input).map(([name, description], index) => {
    if (!description)
      throw new Error(`criteria have empty instructions: ${name || index}`);
    return { id: dedup(slugId(name), seen), name, description };
  });
  if (!criteria.length) throw new Error("criteria is empty");
  return criteria;
}
function parseRubric(markdown: string): Omit<Criteria, "markdown"> {
  const lines = stripComments(markdown).split(/\r?\n/);
  let section: "ground" | "criteria" | undefined;
  let groundTruthNote = "";
  let groundSeen = false;
  let name: string | undefined;
  let id: string | undefined;
  let buffer: string[] = [];
  const criteria: Criterion[] = [];
  const seen = new Set<string>();
  const flush = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (section === "ground") {
      if (!groundSeen) {
        groundTruthNote = text;
        groundSeen = true;
      }
      return;
    }
    if (name === undefined || id === undefined) return;
    criteria.push({ id, name, description: text });
    name = undefined;
    id = undefined;
  };
  for (const line of lines) {
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      flush();
      const heading = line.slice(3).trim().toLowerCase();
      section = heading.includes("ground truth")
        ? "ground"
        : heading.includes("criteri")
          ? "criteria"
          : undefined;
      continue;
    }
    if (line.startsWith("### ") && section === "criteria") {
      flush();
      const heading = line.slice(4).trim();
      const anchored = /^(.*?)\s*\{#([A-Za-z0-9_-]+)\}\s*$/.exec(heading);
      name = anchored?.[1]?.trim() ?? heading;
      id = dedup(anchored?.[2]?.trim() ?? slugId(heading), seen);
      continue;
    }
    if (!line.startsWith("# ")) buffer.push(line);
  }
  flush();
  if (!criteria.length)
    throw new Error(
      "no criteria found — check the `## Criteria` section and its `### Name {#id}` headings",
    );
  const empty = criteria
    .filter((item) => !item.description)
    .map((item) => item.id);
  if (empty.length)
    throw new Error(`criteria have empty instructions: ${empty.join(", ")}`);
  return { groundTruthNote, criteria };
}
function stripComments(value: string): string {
  let out = value;
  for (;;) {
    const start = out.indexOf("<!--");
    if (start < 0) return out;
    const end = out.indexOf("-->", start + 4);
    if (end < 0) return out.slice(0, start);
    out = out.slice(0, start) + out.slice(end + 3);
  }
}
function slugId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40)
      .replace(/_+$/g, "") || "criterion"
  );
}
function dedup(base: string, seen: Set<string>): string {
  let value = base;
  let suffix = 1;
  while (seen.has(value)) value = `${base}_${++suffix}`;
  seen.add(value);
  return value;
}
function renderCriteria(
  criteria: readonly Criterion[],
  ground: string,
): string {
  const lines = ["# Verification criteria"];
  if (ground) lines.push("## Ground Truth Note", ground);
  lines.push("## Criteria");
  for (const item of criteria)
    lines.push(`### ${item.name} {#${item.id}}`, item.description);
  return `${lines.join("\n\n")}\n`;
}
function makeCells(
  criteria: readonly Criterion[],
  count: number,
  round: number,
): Cell[] {
  return criteria.flatMap((criterion) =>
    Array.from({ length: count }, (_, index) => ({
      criterion,
      slot: `${criterion.id}:${index + 1}`,
      id: `verify-${round}-${criterion.id}-${index + 1}`,
    })),
  );
}
function result(
  results: ProgramContext<object>["results"],
  wave: string,
  id: string,
): unknown {
  return results[wave]?.[id];
}
function collectAttempts(
  results: ProgramContext<object>["results"],
  cells: readonly Cell[],
  round: number,
  limit: number,
): Attempt[] {
  const attempts: Attempt[] = [];
  for (const cell of cells)
    for (let reask = 0; reask <= limit; reask += 1) {
      const wave = verifyWaveId(round, reask);
      const waveResults = results[wave];
      if (waveResults === undefined) break;
      const id = reask ? `${cell.id}-reask-${reask}` : cell.id;
      if (!Object.hasOwn(waveResults, id)) continue;
      const value = result(results, wave, id);
      const parsed = checked(VerifierReportSchema, value);
      attempts.push({
        cell,
        reask,
        id,
        value,
        ...(parsed?.criterion_id === cell.criterion.id
          ? { report: parsed }
          : {}),
      });
      if (parsed?.criterion_id === cell.criterion.id) break;
    }
  return attempts;
}
function nextReaskWave(
  results: ProgramContext<object>["results"],
  round: number,
  limit: number,
): number | undefined {
  for (let reask = 0; reask <= limit; reask += 1)
    if (results[verifyWaveId(round, reask)] === undefined) return reask;
  return undefined;
}
function verifyWaveId(round: number, reask: number): string {
  return reask ? `verify-${round}-reask-${reask}` : `verify-${round}`;
}
function dependenciesForVerify(
  state: ProgramContext<object>,
  round: number,
  reask: number,
): string[] {
  if (reask)
    return Object.keys(state.results[verifyWaveId(round, reask - 1)] ?? {});
  return round ? [`repair-${round}`] : ["worker"];
}
function verifyWave(
  route: Route,
  state: ProgramContext<object>,
  cells: readonly Cell[],
  round: number,
  reask: number,
  candidate: string,
  criteriaPath: string,
  task: string,
  ground: string,
  deps: readonly string[],
) {
  const id = verifyWaveId(round, reask);
  return wave(
    state,
    id,
    cells.map((cell) => {
      const nodeId = reask ? `${cell.id}-reask-${reask}` : cell.id;
      return jsonNode(
        route,
        nodeId,
        verifierPrompt(task, candidate, criteriaPath, ground, cell.criterion),
        VerifierReportSchema,
        deps,
        "report",
      );
    }),
  );
}
function currentRound(results: ProgramContext<object>["results"]): number {
  let round = 0;
  while (results[`verify-${round + 1}`] !== undefined) round += 1;
  return round;
}
function attemptPath(dir: string, round: number, attempt: Attempt): string {
  return `${dir}/verification-${round}-${attempt.cell.criterion.id}-${attempt.cell.slot.split(":")[1]}${attempt.reask ? `-reask-${attempt.reask}` : ""}.json`;
}
function repairCount(results: ProgramContext<object>["results"]): number {
  return new Set(
    Object.values(results)
      .flatMap((wave) => Object.keys(wave))
      .filter((id) => /^repair-\d+$/.test(id)),
  ).size;
}
function repairForRound(
  results: ProgramContext<object>["results"],
  round: number,
): string | undefined {
  const wave = Object.entries(results).find(
    ([id]) => id.endsWith(`-after-${round}`) && id.startsWith("repair-"),
  )?.[1];
  return wave === undefined
    ? undefined
    : Object.keys(wave).find((id) => /^repair-\d+$/.test(id));
}
function reportArtifactWave(
  route: Route,
  dir: string,
  round: number,
  attempts: readonly Attempt[],
  state: ProgramContext<object>,
) {
  const id = `verification-records-${round}`;
  if (state.results[id]) return undefined;
  const nodes = attempts.map((attempt) => {
    const value = attempt.report ?? { invalid: true, stage: attempt.id };
    return exactJsonFile(
      route,
      `record-${attempt.id}`,
      value,
      attemptPath(dir, round, attempt),
      [attempt.id],
    );
  });
  return wave(state, id, nodes);
}
function roundArtifacts(
  route: Route,
  dir: string,
  round: number,
  attempts: readonly Attempt[],
  reports: readonly VerifierReport[],
  mean: number,
  invalidCount: number,
  decision: object,
  remaining: readonly string[],
  state: ProgramContext<object>,
) {
  const records = reportArtifactWave(route, dir, round, attempts, state);
  if (records) return records;
  return summaryWave(
    route,
    dir,
    round,
    reports,
    mean,
    invalidCount,
    decision,
    remaining,
    state,
    recordIds(attempts),
  );
}
function summaryWave(
  route: Route,
  dir: string,
  round: number,
  reports: readonly VerifierReport[],
  mean: number,
  invalidCount: number,
  decision: object,
  remaining: readonly string[],
  state: ProgramContext<object>,
  deps: readonly string[],
  repairGuidance?: string,
) {
  const id = `verification-artifacts-${round}`;
  if (state.results[id]) return undefined;
  const summary = {
    scores: reports,
    mean,
    invalidCount,
    decision,
    usage: null,
  };
  const review =
    "kind" in decision && decision.kind === "indeterminate"
      ? { decision, evidence: remaining, remaining_work: remaining }
      : repairGuidance === undefined
        ? { decision, remaining_work: remaining }
        : { repair_guidance: repairGuidance, remaining_work: remaining };
  return wave(state, id, [
    exactJsonFile(
      route,
      `score-table-${round}`,
      summary,
      `${dir}/verification-summary-${round}.json`,
      deps,
    ),
    exactJsonFile(
      route,
      `review-report-${round}`,
      review,
      `${dir}/review-${round}.json`,
      deps,
    ),
  ]);
}
function exactTextFile(
  route: Route,
  id: string,
  value: string,
  path: string,
  deps: readonly string[],
) {
  const node = fileNode(
    route,
    id,
    `Persist exact UTF-8 bytes decoded from this JSON string to ${path}:\n${JSON.stringify(value)}`,
    path,
    undefined,
    deps,
  );
  return { ...node, output: { file: { path, exact: value } } };
}
function exactJsonFile(
  route: Route,
  id: string,
  value: unknown,
  path: string,
  deps: readonly string[],
) {
  return fileNode(
    route,
    id,
    `Persist exact JSON ${JSON.stringify(value)}.`,
    path,
    literalSchema(value),
    deps,
  );
}
function literalSchema(value: unknown): TSchema {
  if (value === null) return Type.Null();
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return Type.Literal(value);
  if (Array.isArray(value)) return Type.Tuple(value.map(literalSchema));
  if (typeof value === "object")
    return Type.Object(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, literalSchema(item)]),
      ),
      { additionalProperties: false },
    );
  throw new Error("adversarial-verification: non-JSON artifact");
}
function recordIds(attempts: readonly Attempt[]): string[] {
  return attempts.map((attempt) => `record-${attempt.id}`);
}
function summaryIds(round: number): string[] {
  return [`score-table-${round}`, `review-report-${round}`];
}
function meanScore(reports: readonly VerifierReport[]): number {
  return reports.length
    ? reports.reduce((sum, report) => sum + report.score, 0) / reports.length
    : 0;
}
function terminal(
  approved: boolean,
  mean: number,
  round: number,
  repairs: number,
  candidate: string,
  dir: string,
  remaining: readonly string[],
) {
  return {
    approved,
    mean_score: mean,
    score_table_path: `${dir}/verification-summary-${round}.json`,
    repairs_completed: repairs,
    candidate_path: candidate,
    review_report_path: `${dir}/review-${round}.json`,
    remaining_work: remaining,
  };
}
function wave(
  state: ProgramContext<object>,
  id: string,
  nodes: ReturnType<typeof fileNode>[],
) {
  const admitted = Object.values(state.results).reduce(
    (count, item) => count + Object.keys(item).length,
    0,
  );
  if (admitted + nodes.length > 64)
    throw new Error(
      "adversarial-verification: actual cumulative schedule exceeds native 64-node limit",
    );
  return { kind: "wave" as const, id, nodes };
}
function workerPrompt(task: string): string {
  return `Produce a self-contained candidate for independent verification. Include actions, observable evidence, validation, and remaining risks. Task: ${task}`;
}
function verifierPrompt(
  task: string,
  candidate: string,
  criteriaPath: string,
  ground: string,
  criterion: Criterion,
): string {
  return `<artifacts>\nRead complete candidate at ${candidate} and resolved criteria at ${criteriaPath}.\n</artifacts>\n<scoring_head>\n<task_statement>${task}</task_statement>\n<ground_truth_note>${ground}</ground_truth_note>\n<scale_anchors>1 = certainly fails … 10 = borderline … 20 = verified correct</scale_anchors>\n</scoring_head>\n<criterion>\n<name>${criterion.name}</name>\n<description>${criterion.description}</description>\n</criterion>\nScore exactly criterion_id ${criterion.id}. Test important claims where practical; cite observable evidence and file:line where applicable. Veto only unconditional acceptance blockers.`;
}
function consolidatorPrompt(
  task: string,
  candidate: string,
  scores: readonly string[],
  repairs: number,
  max: number,
): string {
  return `Read candidate ${candidate} and confirmed score reports ${scores.join(", ")}. Consolidate confirmed verifier findings into actionable repair guidance. Preserve every veto or blocking finding verbatim in remaining_work. Do not decide approval. Repair budget: ${repairs}/${max}. Task: ${task}`;
}
function repairPrompt(task: string, candidate: string, review: string): string {
  return `Read current candidate ${candidate} and consolidated findings ${review}. Repair every actionable blocker, rerun relevant validation, retain valid prior work, and replace candidate. Task: ${task}`;
}
