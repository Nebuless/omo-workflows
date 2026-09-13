import { Type } from "typebox";
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
  EvaluationSchema,
  inputSchemas,
  parseBuiltinInput,
  ProgressSchema,
} from "./schemas.ts";
const PROGRESS_DISCLAIMER =
  "Progress scores are a monitoring signal; VOC separation +0.079; never authoritative.";
export function loopUntilDone(
  route: Route,
  root: string,
): StagedProgram<Record<string, unknown>> {
  const dir = artifactRoot(root, "loop-until-done");
  return {
    key: "loop-until-done",
    version: 2,
    input: inputSchemas["loop-until-done"],
    decide(state) {
      const inputs = parseBuiltinInput("loop-until-done", state.inputs);
      if (!inputs) throw new Error("loop-until-done: invalid inputs");
      if (!output(state, "ledger-initial", "ledger-initial"))
        return {
          kind: "wave",
          id: "ledger-initial",
          nodes: [
            fileNode(
              route,
              "ledger-initial",
              "Persist initial active ledger.",
              `${dir}/progress-ledger.json`,
              Type.Unsafe({
                const: {
                  task: inputs.prompt,
                  max_iterations: inputs.max_iterations,
                  status: "active",
                  iterations_completed: 0,
                  entries: [],
                  progress_curve: [],
                  final_trend: "flat",
                  progress_disclaimer: PROGRESS_DISCLAIMER,
                },
              }),
            ),
          ],
        };
      for (
        let iteration = 1;
        iteration <= inputs.max_iterations;
        iteration += 1
      ) {
        const work = `iterate-${iteration}`;
        const workPath = `${dir}/iterations/iteration-${iteration}.md`;
        if (!output(state, work, work))
          return {
            kind: "wave",
            id: work,
            nodes: [
              fileNode(
                route,
                work,
                `Iteration ${iteration}/${inputs.max_iterations}. Produce observed evidence toward ${inputs.prompt}. Read ${dir}/progress-ledger.json. ${iteration > 1 ? `Read ${dir}/iterations/iteration-${iteration - 1}.md; address recorded failures and remaining work.` : ""}`,
                workPath,
                undefined,
                iteration === 1
                  ? ["ledger-initial"]
                  : [`ledger-${iteration - 1}`],
              ),
            ],
          };
        const evaluate = `evaluate-${iteration}`;
        const evaluationPath = `${dir}/evaluations/evaluation-${iteration}.json`;
        const evaluation = checked(
          EvaluationSchema,
          output(state, evaluate, evaluate),
        );
        if (!evaluation)
          return {
            kind: "wave",
            id: evaluate,
            nodes: [
              fileNode(
                route,
                evaluate,
                `Evaluate objective ${inputs.prompt} against observed state from ${workPath}. ${iteration > 1 ? `Read ${dir}/progress-ledger.json for prior evidence.` : ""} Done only with validation evidence.`,
                evaluationPath,
                EvaluationSchema,
                [work],
              ),
            ],
          };
        const progressIds = Array.from(
          { length: inputs.progress_repeats },
          (_, index) => `progress-${iteration}-repeat-${index + 1}`,
        );
        if (
          inputs.progress_scoring &&
          progressIds.some((id) => !output(state, `progress-${iteration}`, id))
        )
          return {
            kind: "wave",
            id: `progress-${iteration}`,
            nodes: progressIds.map((id, index) =>
              jsonNode(
                route,
                id,
                `Independently score checkpoint ${iteration} for repeat ${index + 1}. Objective: ${inputs.prompt}. Read ${workPath} and ${evaluationPath}. Earlier evaluations: ${JSON.stringify(Array.from({ length: iteration }, (_, index) => output(state, `evaluate-${index + 1}`, `evaluate-${index + 1}`)))}. Return checkpoint ${iteration} score. Monitoring only.`,
                ProgressSchema,
                [evaluate],
                "report",
              ),
            ),
          };
        const status = evaluation.done
          ? "complete"
          : iteration === inputs.max_iterations
            ? "failed"
            : "active";
        const ledger = `ledger-${iteration}`;
        const curve = progressCurve(state, iteration);
        const entries = Array.from({ length: iteration }, (_, index) => {
          const turn = index + 1;
          const decision = checked(
            EvaluationSchema,
            output(state, `evaluate-${turn}`, `evaluate-${turn}`),
          );
          if (!decision)
            throw new Error("loop-until-done: missing admitted evaluation");
          const perRepeat = Object.values(
            state.results[`progress-${turn}`] ?? {},
          ).map((value) => [
            checked(ProgressSchema, value)?.scores.find(
              (score) => score.checkpoint === turn,
            )?.score ?? null,
          ]);
          const scores = perRepeat.flatMap((repeat) =>
            repeat.filter((score): score is number => score !== null),
          );
          const progress = scores.length
            ? {
                score:
                  scores.reduce((sum, score) => sum + score, 0) / scores.length,
                perRepeat,
                trend: trend(progressCurve(state, turn)),
                window: 3,
              }
            : undefined;
          return {
            ...(progress === undefined ? {} : { progress }),
            iteration: turn,
            artifact_path: `${dir}/iterations/iteration-${turn}.md`,
            evaluation_artifact_path: `${dir}/evaluations/evaluation-${turn}.json`,
            summary: decision.summary,
            findings: decision.new_findings,
            failures: decision.failures,
            validation_evidence: decision.validation_evidence,
            done: decision.done,
            remaining_work: decision.remaining_work,
          };
        });
        const EntriesSchema = Type.Tuple(
          entries.map((entry) =>
            Type.Object(
              {
                iteration: Type.Literal(entry.iteration),
                artifact_path: Type.Literal(entry.artifact_path),
                evaluation_artifact_path: Type.Literal(
                  entry.evaluation_artifact_path,
                ),
                summary: Type.Literal(entry.summary),
                findings: Type.Tuple(
                  entry.findings.map((item) => Type.Literal(item)),
                ),
                failures: Type.Tuple(
                  entry.failures.map((item) => Type.Literal(item)),
                ),
                validation_evidence: Type.Tuple(
                  entry.validation_evidence.map((item) => Type.Literal(item)),
                ),
                done: Type.Literal(entry.done),
                remaining_work: Type.Literal(entry.remaining_work),
                ...(entry.progress === undefined
                  ? {}
                  : { progress: Type.Unsafe({ const: entry.progress }) }),
              },
              { additionalProperties: false },
            ),
          ),
        );
        const LedgerSchema = Type.Object(
          {
            task: Type.Literal(inputs.prompt),
            max_iterations: Type.Literal(inputs.max_iterations),
            status: Type.Literal(status),
            iterations_completed: Type.Literal(iteration),
            entries: EntriesSchema,
            progress_curve: Type.Tuple(
              curve.map((score) => Type.Literal(score)),
            ),
            final_trend: Type.Literal(trend(curve)),
            progress_disclaimer: Type.Literal(PROGRESS_DISCLAIMER),
          },
          { additionalProperties: false },
        );
        if (!output(state, ledger, ledger))
          return {
            kind: "wave",
            id: ledger,
            nodes: [
              fileNode(
                route,
                ledger,
                "Persist exact evidence ledger from schema.",
                `${dir}/progress-ledger.json`,
                LedgerSchema,
                inputs.progress_scoring ? progressIds : [evaluate],
              ),
            ],
          };
        if (evaluation.done) {
          const complete = output(state, "complete", "complete");
          if (!complete)
            return {
              kind: "wave",
              id: "complete",
              nodes: [
                fileNode(
                  route,
                  "complete",
                  `Produce completion report from ${workPath}.`,
                  `${dir}/result.md`,
                  undefined,
                  [ledger],
                ),
              ],
            };
          return {
            kind: "final",
            result: summary("complete", complete, iteration, dir, state),
          };
        }
        if (iteration === inputs.max_iterations)
          return {
            kind: "final",
            result: summary(
              "failed",
              `Iteration limit exhausted after ${iteration} iterations.`,
              iteration,
              dir,
              state,
            ),
          };
      }
      throw new Error("loop-until-done: unreachable");
    },
  };
}
function progressCurve(state: ProgramContext<object>, count: number) {
  const curve: number[] = [];
  for (let i = 1; i <= count; i += 1) {
    const repeats = Object.values(state.results[`progress-${i}`] ?? {}).flatMap(
      (item) => {
        const value = checked(ProgressSchema, item);
        const score = value?.scores.find((item) => item.checkpoint === i);
        return score ? [score.score] : [];
      },
    );
    if (repeats.length)
      curve.push(
        repeats.reduce((sum, score) => sum + score, 0) / repeats.length,
      );
  }
  return curve;
}
function summary(
  status: "complete" | "failed",
  text: unknown,
  count: number,
  dir: string,
  state: ProgramContext<object>,
) {
  const curve = progressCurve(state, count);
  const evaluation = checked(
    EvaluationSchema,
    output(state, `evaluate-${count}`, `evaluate-${count}`),
  );
  return {
    result: text,
    status,
    iterations_completed: count,
    ledger_path: `${dir}/progress-ledger.json`,
    iteration_artifact_paths: Array.from(
      { length: count },
      (_, i) => `${dir}/iterations/iteration-${i + 1}.md`,
    ),
    evaluation_artifact_paths: Array.from(
      { length: count },
      (_, i) => `${dir}/evaluations/evaluation-${i + 1}.json`,
    ),
    result_path:
      status === "complete"
        ? `${dir}/result.md`
        : `${dir}/progress-ledger.json`,
    artifact_dir: dir,
    remaining_work: evaluation?.remaining_work ?? "",
    progress_curve: curve,
    final_trend: trend(curve),
    progress_disclaimer: PROGRESS_DISCLAIMER,
  };
}

function trend(series: readonly number[]): "flat" | "rising" | "regressing" {
  if (series.length < 4) return "flat";
  const sample = series.slice(-6);
  const half = Math.floor(sample.length / 2);
  const delta =
    (sample.slice(-half).reduce((sum, value) => sum + value, 0) -
      sample.slice(0, half).reduce((sum, value) => sum + value, 0)) /
    half;
  return delta >= 1.5 ? "rising" : delta <= -1.5 ? "regressing" : "flat";
}
