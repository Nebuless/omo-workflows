# Staged Workflow Admission

## Purpose

Admit validated staged-program results before extending native OMO DAGs.

## Ownership

- Native OMO owns scheduling, processes, cancellation, retries, and DAG state.
- This directory owns deterministic decisions, validation, and native custom-entry checkpoints.

## Local Contracts

- Acknowledge native session flush before dispatch, gate answer, or external design-review event progression. Missing flush capability disables launches.
- Append cumulative same-run definitions with fresh node IDs. Preserve completed nodes byte-for-byte.
- Match native run identity and definition fingerprint before admission or amendment recovery.
- Recover initial dispatch through native keyed start reuse. Snapshots require run_id, never key lookup.
- Validate exact JSON, exact required file bytes, or actual non-empty file contents. File results return compact artifact paths. Only current-wave outputs enter admission.
- Default invalid output rejects. Explicit invalidOutput: "report" admits only a controller-generated invalid-output/code record for source-backed bounded repair; malformed content never reaches decisions. Native task failure still rejects.
- Rejection and cancellation fence dispatch across restart. Require native cancellation receipt.
- Gate `fallback` must equal a listed choice. External event keys are write-once and replay-idempotent; conflicting payloads reject. No local database, optimistic graph mutation, or model-decided validation.

## Work Guidance

- Native schema discovery belongs in native-transport.ts; durable acknowledgement in native-journal.ts.
- Dispatch registered native workflows with public `activateInactiveTool`; lazy registration is not missing capability. Native activators and tool validation remain authoritative.
- Test async boundaries with subscribed deterministic signals, never sleeps.

## Verification

- `bun test extensions/workflow-graph/test/staged-controller.test.ts extensions/workflow-graph/test/native-journal.test.ts extensions/workflow-graph/test/native-journal-flush.test.ts`
- `bun run typecheck`

## Child DOX Index

None.
