import { basename } from "node:path";
import { pathToFileURL } from "node:url";
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
  DesignDisplaySchema,
  DesignIntakeSchema,
  inputSchemas,
  parseBuiltinInput,
} from "./schemas.ts";
import {
  ModelEventResultSchema,
  type LiveEvent,
} from "../design-review/protocol.ts";
export function openClaudeDesign(
  route: Route,
  root: string,
): StagedProgram<Record<string, unknown>> {
  const dir = artifactRoot(root, "open-claude-design");
  const runId = basename(root);
  const productPath = `${dir}/PRODUCT.md`,
    designPath = `${dir}/DESIGN.md`,
    configPath = `${dir}/.impeccable/live/config.json`;
  const contextIds = ["ds-locator", "ds-analyzer", "ds-patterns"];
  const contextPaths = contextIds.map((id) => `${dir}/${id}.md`);
  const referencesPath = `${dir}/references.md`,
    previewPath = `${dir}/preview.html`,
    specPath = `${dir}/spec.html`;
  const contextInstruction = `Read canonical project context at ${productPath} and ${designPath}, design-system evidence at ${contextPaths.join(", ")}, and reference evidence at ${referencesPath}. User references override conflicting project defaults.`;
  const displaySchema = Type.Object(
    {
      ...DesignDisplaySchema.properties,
      spec_path: Type.Literal(specPath),
      preview_path: Type.Literal(previewPath),
    },
    { additionalProperties: false },
  );
  return {
    key: "open-claude-design",
    version: 1,
    input: inputSchemas["open-claude-design"],
    decide(state) {
      const inputs = parseBuiltinInput("open-claude-design", state.inputs);
      if (!inputs) throw new Error("open-claude-design: invalid inputs");
      const intake = checked(
        DesignIntakeSchema,
        output(state, "intake", "intake"),
      );
      if (!intake)
        return {
          kind: "wave",
          id: "intake",
          nodes: [
            jsonNode(
              route,
              "intake",
              `Interview user as needed with impeccable shape, then return the confirmed brief, output_type, and verbatim reference paths/URLs.\n\n${inputs.prompt}`,
              DesignIntakeSchema,
            ),
          ],
        };
      if (!output(state, "product-context", "product-context"))
        return {
          kind: "wave",
          id: "product-context",
          nodes: [
            fileNode(
              route,
              "product-context",
              `Inspect the project and user references for ${intake.brief}. Write a readable project-derived PRODUCT.md snapshot for this design run. Preserve concrete product truth, core jobs, register, and explicit gaps; do not fabricate evidence.`,
              productPath,
              undefined,
              ["intake"],
            ),
          ],
        };
      if (!output(state, "design-foundation", "design-foundation"))
        return {
          kind: "wave",
          id: "design-foundation",
          nodes: [
            fileNode(
              route,
              "design-foundation",
              `Read ${productPath}, inspect the project and references, then write a readable project-derived DESIGN.md snapshot for this run. Record only evidenced visual foundations and explicit gaps.`,
              designPath,
              undefined,
              ["product-context"],
            ),
          ],
        };
      if (!output(state, "live-config", "live-config")) {
        const exact = `${JSON.stringify({ files: ["preview.html"], insertBefore: "</body>", commentSyntax: "html", cspChecked: true }, null, 2)}\n`;
        return {
          kind: "wave",
          id: "live-config",
          nodes: [
            {
              ...route,
              id: "live-config",
              prompt: `Create Impeccable live configuration exactly at ${configPath} for the generated static preview relative to this run root. The preview has no CSP. Write these exact bytes, including final newline:\n${exact}`,
              dependsOn: ["design-foundation"],
              output: { file: { path: configPath, exact } },
            },
          ],
        };
      }
      if (!output(state, "design-context", contextIds[0]))
        return {
          kind: "wave",
          id: "design-context",
          nodes: contextIds.map((id) =>
            fileNode(
              route,
              id,
              `Read ${productPath} and ${designPath}. Independently inspect project sources and import these user references directly: ${intake.references.length ? intake.references.join(", ") : "none"}. Write grounded ${id} evidence for ${intake.brief}; cite concrete source/reference paths and state gaps.`,
              `${dir}/${id}.md`,
              undefined,
              ["live-config"],
            ),
          ),
        };
      if (!output(state, "reference-context", "reference-context"))
        return {
          kind: "wave",
          id: "reference-context",
          nodes: [
            fileNode(
              route,
              "reference-context",
              inputs.discover_references
                ? `Read ${productPath}, ${designPath}, and ${contextPaths.join(", ")}. Discover curated source references for ${intake.output_type}: ${intake.brief}. Import user references (${intake.references.length ? intake.references.join(", ") : "none"}) as primary authority and record only observed traits with source URLs/paths.`
                : `Write a reference brief stating discovery was skipped. Include user references verbatim (${intake.references.length ? intake.references.join(", ") : "none"}); do not fabricate external references. Project and design-system authority remains at ${productPath}, ${designPath}, and ${contextPaths.join(", ")}.`,
              referencesPath,
              undefined,
              contextIds,
            ),
          ],
        };
      const generated = output(state, "generate", "generate-1");
      if (!generated)
        return {
          kind: "wave",
          id: "generate",
          nodes: [
            fileNode(
              route,
              "generate-1",
              `${contextInstruction} Generate a production-ready interactive browser preview for ${intake.brief}. Write canonical HTML to ${previewPath}, include </body> for Impeccable injection, and trace decisions to those files rather than prompt-only assumptions.`,
              previewPath,
              undefined,
              ["reference-context"],
            ),
          ],
        };
      const approval = state.answers["approve-live-review"];
      if (!approval)
        return {
          kind: "gate",
          id: "approve-live-review",
          question:
            "Preview ready. Start actual interactive live review or export current preview?",
          choices: [
            "Start live review",
            "Skip remaining review rounds and export as-is",
          ],
        };
      if (approval === "Start live review") {
        const external = state.external ?? {};
        const events = Object.entries(external)
          .filter(([key]) => key !== "live.exit")
          .map(([, value]) => value as LiveEvent);
        const pending = events.findIndex(
          (_event, index) =>
            !output(
              state,
              `live-model-${index + 1}`,
              `live-model-${index + 1}`,
            ),
        );
        if (pending >= 0) {
          const event = events[pending];
          if (event === undefined)
            throw new Error("open-claude-design: missing admitted live event");
          return {
            kind: "wave",
            id: `live-model-${pending + 1}`,
            nodes: [
              jsonNode(
                route,
                `live-model-${pending + 1}`,
                `${contextInstruction} Canonical live preview is ${previewPath}. Handle exactly this Impeccable live ${event.type} event and stop. Do not poll, reply, or exit.\n\n${event.raw}`,
                ModelEventResultSchema,
                ["generate-1"],
              ),
            ],
          };
        }
        if (external["live.exit"] === undefined)
          return {
            kind: "design-review",
            id: "live-review",
            previewPath,
            // Nine setup nodes plus 53 live nodes and export/display total native 64.
            maxModelEvents: 53,
          };
      } else if (approval !== "Skip remaining review rounds and export as-is")
        throw new Error("open-claude-design: invalid approval");
      const exported = output(state, "export", "exporter");
      if (!exported)
        return {
          kind: "wave",
          id: "export",
          nodes: [
            fileNode(
              route,
              "exporter",
              `${contextInstruction} Read canonical final preview at ${previewPath}, then export final ${intake.output_type} browser-readable spec exactly to ${specPath}. Embed or link the actual preview and preserve evidenced assumptions/limitations.`,
              specPath,
              undefined,
              ["generate-1"],
            ),
          ],
        };
      const display = checked(
        displaySchema,
        output(state, "final-display", "final-display"),
      );
      if (!display)
        return {
          kind: "wave",
          id: "final-display",
          nodes: [
            jsonNode(
              route,
              "final-display",
              `Canonical exported spec: ${specPath} (${pathToFileURL(specPath).href}). Canonical preview: ${previewPath} (${pathToFileURL(previewPath).href}). Attempt \`playwright-cli open ${pathToFileURL(specPath).href}\`. If it reports missing browser executable, run only \`playwright-cli install-browser chromium --only-shell\`, retry open once, then attempt \`playwright-cli snapshot\`; do not install packages or system dependencies. Do not solicit changes; direct changes to a new open-claude-design run. Return exact canonical spec_path and preview_path. Browser failure must not block workflow: return availability \`unavailable\` only after attempted command, with command exit/error in playwright_cli_status and manual fallback.`,

              displaySchema,
              ["exporter"],
            ),
          ],
        };
      const importContext = intake.references.length
        ? `User references are primary visual authority and override conflicting DESIGN.md/PRODUCT.md guidance. Reference sources:\n${intake.references.map((reference, index) => `${index + 1}. ${reference}`).join("\n")}\n\nFull design-system and reference evidence: read ${referencesPath}.`
        : "No user reference was provided; infer design direction from brief, project context, research, and curated reference inspiration.";
      return {
        kind: "final",
        result: {
          output_type: intake.output_type,
          design_system: contextPaths.join(", "),
          artifact: generated,
          handoff: exported,
          import_context: importContext,
          run_id: runId,
          artifact_dir: dir,
          preview_path: previewPath,
          preview_file_url: pathToFileURL(previewPath).href,
          spec_path: specPath,
          spec_file_url: pathToFileURL(specPath).href,
          playwright_cli_status: display.playwright_cli_status,
          display,
          live_review:
            approval === "Start live review"
              ? "helper_exit_confirmed"
              : "skipped",
        },
      };
    },
  };
}
