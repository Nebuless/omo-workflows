# Upstream provenance

## Atomic graph parity source

- Repository: <https://github.com/bastani-inc/atomic>
- Revision: [`aca13b906ca010958aae7bf4dbdf7a81704b704f`](https://github.com/bastani-inc/atomic/tree/aca13b906ca010958aae7bf4dbdf7a81704b704f)
- License: [`LICENSES/Atomic-LICENSE.txt`](LICENSES/Atomic-LICENSE.txt)
- Reference boundaries: `packages/workflows/src/tui/{graph-canvas,graph-view,graph-view-render,graph-view-graph-render,graph-view-render-helpers,switcher,stage-chat-view,stage-chat-layout,stage-chat-view-input,stage-chat-view-custom-ui,stage-chat-view-state}.ts` and `packages/workflows/src/shared/expanded-workflow-graph.ts`.
- Adaptation: behavior-only reconstruction against public Senpi/OMO APIs. No Atomic source copied in initial projection scaffold. Atomic stores, scheduler access, host imports, and task mutation paths are excluded.
- Runtime dependency: none. `@bastani/atomic` must not be imported or declared.

Atomic license notice applies when copies or substantial portions are introduced, including this condition verbatim: "If your product or service exceeds 100 million monthly active users or $20 million in monthly revenue, you must prominently display 'Atomic' on the user interface of such product or service."

## omo-herdr-dag observer source

- Repository: <https://github.com/jc01rho/omo-herdr-dag>
- Revision: [`77698887708055c2f2d438f76c5f833c5e6e3ae9`](https://github.com/jc01rho/omo-herdr-dag/tree/77698887708055c2f2d438f76c5f833c5e6e3ae9)
- License: [`LICENSES/omo-herdr-dag-LICENSE.txt`](LICENSES/omo-herdr-dag-LICENSE.txt)
- Adaptation boundary: `src/{controller,model,render,viewer,storage,task-data,view-state}.mjs`.
- Runtime dependency: none. TypeScript observer uses public Herdr CLI contracts captured in `docs/upstream-validation.md`.

## Revalidation

Full workflow-system audit on 2026-09-12 uses Atomic revision
[`ff55b141109e3f9f5980c1f0c718dea39f6b2fd9`](https://github.com/bastani-inc/atomic/tree/ff55b141109e3f9f5980c1f0c718dea39f6b2fd9).
Builtin algorithms, schemas, report contracts, and Impeccable protocol are
adapted from this revision under `src/builtins/` and `src/design-review/`.
Discovery precedence, module reload, and design final-display/result contracts
are adapted from `src/extension/{discovery,discovery-loaders,workflow-module-loader}.ts`
and `builtin/open-claude-design/` at the same revision. Senpi public
SettingsManager/DefaultPackageManager own settings and installed paths; the
extension owns `workflowGraph.programs` and package `pi.workflows` adaptation.
Jiti 2.7.0 is declared package-local for reload rather than depending on accidental
Senpi dependency hoisting. Corresponding Atomic license applies to these adaptations. Earlier graph
revision remains recorded separately. No Atomic scheduler or database is imported.
[`PARITY.md`](PARITY.md) records native sources, versions, limits, and proof.

Recheck both revisions and licenses before copying upstream source, changing graph behavior, or publishing this extension.
