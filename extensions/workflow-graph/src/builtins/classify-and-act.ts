import { Type } from "typebox";
import type { StagedProgram } from "../execution/policy.ts";
import {
  artifactRoot,
  fileNode,
  jsonNode,
  output,
  type Route,
} from "./helpers.ts";
import {
  checked,
  ClassificationSchema,
  inputSchemas,
  parseBuiltinInput,
} from "./schemas.ts";

export function classifyAndAct(
  route: Route,
  root: string,
): StagedProgram<Record<string, unknown>> {
  const dir = artifactRoot(root, "classify-and-act");
  return {
    key: "classify-and-act",
    version: 1,
    input: inputSchemas["classify-and-act"],
    decide(state) {
      const inputs = parseBuiltinInput("classify-and-act", state.inputs);
      if (inputs === undefined)
        throw new Error("classify-and-act: invalid inputs");
      const raw = output(state, "classify", "classifier");
      if (raw === undefined)
        return {
          kind: "wave",
          id: "classify",
          nodes: [
            jsonNode(
              route,
              "classifier",
              `Classify into exactly one category: ${inputs.categories.join(", ")}. Return category, confidence 0..1, rationale.

${inputs.prompt}`,
              ClassificationSchema,
              [],
              "report",
            ),
          ],
        };
      const classified = checked(ClassificationSchema, raw);
      const proposed = classified?.category ?? "";
      const confidence = classified?.confidence ?? 0;
      const exact = inputs.categories.find((category) => category === proposed);
      const fallbackUsed =
        exact === undefined || confidence < inputs.confidence_threshold;
      const fallback = exact ?? inputs.categories[0];
      if (fallback === undefined)
        throw new Error("classify-and-act: no category");
      const category = fallbackUsed ? state.answers["select-category"] : exact;
      if (category === undefined)
        return {
          kind: "gate",
          id: "select-category",
          question: "Classification is uncertain. Choose action category.",
          choices: inputs.categories,
          fallback,
        };
      if (!inputs.categories.includes(category))
        throw new Error("classify-and-act: invalid category gate answer");
      const classificationPath = `${dir}/classification.json`;
      const rationale =
        classified?.rationale ??
        "Classifier did not provide a usable structured rationale.";
      const ReportSchema = Type.Object(
        {
          proposed_category: Type.Literal(proposed),
          selected_category: Type.Literal(category),
          confidence: Type.Literal(confidence),
          threshold: Type.Literal(inputs.confidence_threshold),
          rationale: Type.Literal(rationale),
          fallback_used: Type.Literal(fallbackUsed),
          fallback_mode: Type.Literal(
            fallbackUsed
              ? (state.answerModes?.["select-category"] ?? "interactive_select")
              : "none",
          ),
        },
        { additionalProperties: false },
      );
      if (
        output(state, "classification-report", "classification-report") ===
        undefined
      )
        return {
          kind: "wave",
          id: "classification-report",
          nodes: [
            fileNode(
              route,
              "classification-report",
              "Persist exact classification report from schema.",
              classificationPath,
              ReportSchema,
              ["classifier"],
            ),
          ],
        };
      const id = `action-${
        category
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "fallback"
      }`;
      const path = `${dir}/${id}.md`;
      const action = output(state, "action", id);
      if (action === undefined)
        return {
          kind: "wave",
          id: "action",
          nodes: [
            fileNode(
              route,
              id,
              `Read ${classificationPath}. Execute request as ${category}.

${inputs.prompt}`,
              path,
              undefined,
              ["classification-report"],
            ),
          ],
        };
      return {
        kind: "final",
        result: {
          result: action,
          category,
          confidence,
          action: id,
          classification_path: classificationPath,
          action_path: path,
          artifact_dir: dir,
        },
      };
    },
  };
}
