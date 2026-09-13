# Workflow Graph Extension

## Purpose

Provide workflow graph rendering for native OMO DAG state and a companion Herdr observer pane. Full Atomic workflow parity is the target, not the current capability; `PARITY.md` owns the source-backed gap and verification matrix.

## Ownership

- `src/` owns normalized graph projection, native staged program admission, and Senpi UI integration.
- Native OMO owns scheduling, task processes, WAL, checkpoints, retries, cancellation, and amendments.
- `test/` owns redacted deterministic fixtures and package regressions, including repo-to-extension staged contracts.
- `UPSTREAM.md` and `LICENSES/` own Atomic and omo-herdr-dag provenance.
- `PARITY.md` owns full workflow parity coverage, native mappings, missing contracts, and verification status. Keep partial implementations explicit.

## Local Contracts

- Use public Senpi APIs and runtime-discovered OMO `workflow` capability. Approved optional repairs expose `SessionManager.flushEntries()`, the versioned native `/dag` presentation hook, and fullscreen mouse deferral to focused overlays. Capability-gate journal and presentation hooks; never patch during extension load.
- `src/execution/` owns deterministic admission policy, not task scheduling: persist intent and admitted results through native session custom entries, acknowledge flush before dispatch, and amend the same native DAG after validation. No separate state database.
- Exact native definition fingerprints gate amendment recovery. Initial dispatch recovery uses native keyed `start` reuse. Never invent key-based snapshot calls or per-node fingerprint fields.
- Never mutate DAG state optimistically or infer dependency edges.
- Keep task prompt and full error bodies out of logs and fixtures.
- Guard TUI behavior; non-TUI sessions expose no overlay.
- Herdr resources use returned opaque IDs only; the right observer pane is split from caller Herdr pane with `--no-focus` and is never used to mutate scheduler state.
- Pane snapshots and persistent viewer records contain only normalized run/node metadata, selection, and manual-close state; they exclude task prompts and full errors.

## Work Guidance

- Keep `src/index.ts` limited to lifecycle registration.
- Keep projection pure and test it before UI work.
- Overlay lifecycle lives in `src/overlay/controller.ts`, input/selection in `component.ts`, and bounded frame/switcher rendering in `frame.ts`. Escape closes an active switcher first; otherwise Escape, `h`, and Ctrl+X hide the retained native overlay.
- Decode terminal keys with native `parseKey` and `decodeKittyPrintable`. Derive canvas height from host terminal rows and shared frame chrome; selected cards must remain visible after resize. Switcher pointer targets use the same filtered rows as rendering.
- `run-picker.ts` owns `/workflow-runs [name-or-ID]`: session-local native projections only, active runs before terminal runs, no implied resume or cross-session discovery.
- `overlay/navigation.ts`, `canvas.ts`, and `pointer.ts` share card geometry. Arrows follow spatial neighbors; `j`/`k` clamp in node order; `v` changes orientation. Manual scrolling stays independent of selection and clamps to content. Use terminal cell widths for labels and bounded scrollbar hit targets.
- Progress counts authoritative terminal states; duration requires valid native start/completion timestamps. Fixture screenshots prove rendering, not workflow execution or mouse delivery.
- Footer prioritizes action results and unknown-edge warnings so fullscreen graph height cannot discard feedback.
- Program status stays distinct from native DAG status. A completed native wave does not complete a staged program. Herdr persists only the program decision kind, never gate text, outputs, or failure bodies.
- Preserve native runtime ownership when exact Atomic behavior needs unavailable APIs. Do not ship prompt-only substitutes for durable callbacks, gates, output admission, or replay.
- `repo-to-extension` accepts public HTTPS repository URLs only. Inspection treats repository content as untrusted data, never executes repository code, and requires explicit approval before generated extension writes.
- Capability-gate task status, snapshot, steer, retry, and cancel through live schemas; task status uses `task_output` mode `status` only, never transcript retrieval; cancellation needs confirmation.
- Keep pane state writer and observer persistence failure-isolated from OMO projection updates.

## Verification

- `bun test extensions/test/workflow-graph.test.ts extensions/test/workflow-graph-controls.test.ts extensions/workflow-graph/test/repo-to-extension.test.ts`
- `bun run typecheck`
- `bun run build`
- `bun run validate:package`
- Isolated OMO and Herdr live QA after implementation.

## Child DOX Index

- `src/` — runtime projection, overlay, task control, and Herdr adapter; this file owns shared runtime rules.
- `src/builtins/` — Atomic source-backed staged catalog plus repo-to-extension untrusted-repository inspection and extension-generation admission.
- `src/execution/` — deterministic output admission and native session checkpoint contracts.
- `src/authoring/` — trusted module loading, builtin registration, and session-scoped launch ownership.
- `src/design-review/` — deterministic live-helper protocol and native-journal replay; host integration remains explicit.
- `test/` — redacted fixtures and behavior tests.
- `LICENSES/` — upstream license copies.
- `PARITY.md` — complete Atomic workflow capability and verification matrix.
