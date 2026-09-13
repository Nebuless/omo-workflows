import type {
  Classification,
  Evaluation,
  Review,
  VerifierReport,
} from "./schemas.ts";

export function decideClassifyAndAct(
  classification: Classification,
  categories: readonly string[],
  threshold: number,
) {
  const category = categories.find((item) => item === classification.category);
  return category === undefined || classification.confidence < threshold
    ? { stage: "select-category" as const, proposed_category: category }
    : { stage: "action" as const, category };
}

type Partition = { readonly label: string; readonly objective: string };
type Branch = Partition & {
  readonly id: string;
  readonly artifact_path: string;
};
function safeName(label: string, index: number) {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${String(index + 1).padStart(2, "0")}-${normalized || "branch"}`;
}
function parsedPartitions(
  plan: { readonly partitions: readonly Partition[] } | undefined,
  prompt: string,
  limit: number,
): Partition[] {
  const partitions =
    plan?.partitions.flatMap((item) =>
      item.label.trim() && item.objective.trim()
        ? [{ label: item.label.trim(), objective: item.objective.trim() }]
        : [],
    ) ?? [];
  return (
    partitions.length
      ? partitions
      : [{ label: "whole-task", objective: prompt }]
  ).slice(0, limit);
}
export function decideFanOutAndSynthesize(
  plan: { readonly partitions: readonly Partition[] } | undefined,
  prompt: string,
  maxBranches: number,
  maxConcurrency: number,
  artifactDir: string,
  completed: readonly string[],
) {
  const branches: Branch[] = parsedPartitions(plan, prompt, maxBranches).map(
    (partition, index) => {
      const id = safeName(partition.label, index);
      return {
        ...partition,
        id,
        artifact_path: `${artifactDir}/branch-${id}.md`,
      };
    },
  );
  const done = new Set(completed);
  const frontier = branches
    .filter((branch) => !done.has(branch.id))
    .slice(0, maxConcurrency);
  if (frontier.length)
    return {
      stage: "branches" as const,
      frontier: frontier.map((branch) => branch.id),
      branches,
    };
  return {
    stage: "synthesize" as const,
    manifest: {
      task: prompt,
      partition_plan: `${artifactDir}/partition-plan.json`,
      branches: branches.map(({ label, objective, artifact_path }) => ({
        label,
        objective,
        artifact_path,
      })),
    },
  };
}

export function decideAdversarialVerification(
  reports: readonly VerifierReport[],
  expected: number,
  acceptMean: number,
  reaskWave: number,
  reaskLimit: number,
  repairs: number,
  maxRepairs: number,
) {
  if (reports.length < expected)
    return reaskWave < reaskLimit
      ? {
          stage: "reask" as const,
          wave: reaskWave + 1,
          missing: expected - reports.length,
        }
      : { stage: "indeterminate" as const, missing: expected - reports.length };
  const mean_score =
    reports.reduce((sum, report) => sum + report.score, 0) / reports.length;
  const veto = reports.some((report) =>
    report.findings.some((finding) => finding.severity === "veto"),
  );
  if (!veto && mean_score >= acceptMean)
    return { stage: "accept" as const, mean_score };
  return repairs < maxRepairs
    ? { stage: "repair" as const, mean_score }
    : { stage: "reject" as const, mean_score };
}
function admitted(
  paths: readonly string[],
  choices: readonly string[],
  size: number,
) {
  return [...new Set(choices.filter((path) => paths.includes(path)))].slice(
    0,
    size,
  );
}
export function decideGenerateAndFilter(
  candidatePaths: readonly string[],
  filtered: readonly string[],
  judged: readonly string[],
  size: number,
  useJudge: boolean,
) {
  const filteredShortlist = admitted(candidatePaths, filtered, size);
  const shortlist = filteredShortlist.length
    ? filteredShortlist
    : candidatePaths.slice(0, size);
  if (!useJudge) return { shortlist, decision_path: "filter" as const };
  const judgedShortlist = admitted(candidatePaths, judged, size);
  return {
    shortlist: judgedShortlist.length ? judgedShortlist : shortlist,
    decision_path: "judge" as const,
  };
}
export function rankTournament(
  weights: readonly number[],
  counts: readonly number[],
  labels: readonly string[],
) {
  if (
    weights.length !== counts.length ||
    weights.length !== labels.length ||
    counts.some((count) => count <= 0)
  )
    throw new Error("tournament: invalid ranking vectors");
  return Array.from({ length: weights.length }, (_, index) => index)
    .sort(
      (left, right) =>
        (weights[right] ?? 0) / (counts[right] ?? 1) -
          (weights[left] ?? 0) / (counts[left] ?? 1) || left - right,
    )
    .map((index) => labels[index] ?? "");
}
export function decideLoopUntilDone(
  evaluation: Evaluation,
  iterationsCompleted: number,
  maxIterations: number,
) {
  return evaluation.done
    ? { stage: "complete" as const }
    : iterationsCompleted >= maxIterations
      ? { stage: "failed" as const }
      : { stage: "iterate" as const };
}
function normalized(blocker: string) {
  return blocker.toLowerCase().replace(/\s+/g, " ").trim();
}
function consecutive(
  blockers: readonly { readonly turn: number; readonly blocker: string }[],
  blocker: string,
  turn: number,
) {
  let expected = turn;
  let count = 0;
  for (const item of [...blockers].reverse()) {
    if (item.turn > expected) continue;
    if (
      item.turn < expected ||
      normalized(item.blocker) !== normalized(blocker)
    )
      break;
    count += 1;
    expected -= 1;
  }
  return count;
}
function approved(review: Review) {
  return (
    review.parsed &&
    review.decision === "complete" &&
    review.stop_review_loop &&
    review.reviewer_error == null
  );
}
export function decideGoal(
  reviews: readonly Review[],
  turn: number,
  maxTurns: number,
  reviewQuorum: number,
  blockerThreshold: number,
  blockers: readonly { readonly turn: number; readonly blocker: string }[],
  createPr: boolean,
) {
  if (reviews.filter(approved).length >= reviewQuorum)
    return { stage: "complete" as const, create_pr: createPr };
  const blocker = reviews
    .find((review) => review.decision === "blocked" && review.blocker?.trim())
    ?.blocker?.trim();
  if (
    blocker &&
    consecutive([...blockers, { turn, blocker }], blocker, turn) >=
      blockerThreshold
  )
    return { stage: "blocked" as const, blocker };
  return turn >= maxTurns
    ? { stage: "needs_human" as const }
    : { stage: "continue" as const };
}
export function decideRalph(
  reviews: readonly Review[],
  iteration: number,
  maxLoops: number,
  createPr: boolean,
) {
  return reviews.length === 2 && reviews.every(approved)
    ? { stage: "complete" as const, create_pr: createPr }
    : iteration >= maxLoops
      ? { stage: "failed" as const }
      : { stage: "continue" as const };
}
export function decideOpenClaudeDesign(
  choice: "Start live review" | "Skip remaining review rounds and export as-is",
  event?: "exit" | "timeout",
) {
  return choice === "Skip remaining review rounds and export as-is" ||
    event === "exit"
    ? { stage: "export" as const }
    : { stage: "live-review" as const };
}
