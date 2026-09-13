# Atomic Builtin Programs

## Purpose

Own staged native-program catalog adapting Atomic builtins pinned at commit `ff55b141109e3f9f5980c1f0c718dea39f6b2fd9`.

## Ownership

- Catalog factories own source-backed decisions and artifact schemas.
- Execution controller owns admission and native run identity; host owns UI and external effects.

## Local Contracts

- Export factories as `(route, artifactRoot) => StagedProgram`; `artifactRoot` is absolute and unique per launch.
- Apply source defaults inside every `decide` call.
- Emit new node IDs and wave IDs only. Native controller owns scheduling, admission, validation, and journaling.
- Every advertised file has admitted producer node. Machine-consumed files use exact TypeBox schemas and exact destination instructions.
- Preserve Atomic runner decisions and pure math. Record host gaps explicitly; never claim browser, worktree, PR, or malformed-output recovery parity without host support.

## Work Guidance

- Repair malformed classifier, partition, filter, and judge outputs with exact admitted artifacts before dependent tasks read them.
- Retry batch IDs count admitted batches, not completed nodes; partial batches still consume one ID.
- Classifier reports use journaled answer provenance, never infer interactive versus deterministic selection from the category string. Native per-node tool restrictions remain unsupported and must be reported.
- Fanout trims and filters partition values, caps branches, and admits an exact normalized plan before branch reads; compact file references remain intentional outputs.
- Progress scores are monitoring only. Admit initial active ledger before work; retain per-repeat nulls, mean, trend, and window alongside evaluator evidence. Record failed status on exhaustion.
- Goal/Ralph preserve source ten-turn defaults. Check actual cumulative native node count; exceeding 64 rejects rather than silently reducing the requested budget. Finding reverification uses three fresh reports with one re-ask per invalid repeat.
- Design preview, PRODUCT.md, DESIGN.md, and live configuration share one run root. Bootstrap and poll from that root; export only after explicit skip or journaled helper exit. Final display is native admitted work after export, returns browser availability evidence plus manual fallback, and exposes source result fields including artifact-root run identity and import context.

## Verification

- `bun test extensions/workflow-graph/test/builtin-*.test.ts`
- `bun run typecheck`
- LSP diagnostics on `extensions/workflow-graph/src/builtins` and tests.

## Child DOX Index

None.
