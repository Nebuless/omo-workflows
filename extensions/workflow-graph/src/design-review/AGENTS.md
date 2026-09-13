# Design Review Adapter

## Purpose

Own deterministic Impeccable live helper transport and native-journal replay protocol.

## Ownership

- `protocol.ts` owns helper process execution, event boundary validation, and poll/reply CLI mapping.
- `driver.ts` owns ordered journal recovery and host model-stage callback contract.
- Native workflow host owns helper location, session start, model scheduling/results, cancellation, and workflow completion.
- `OMO_IMPECCABLE_SCRIPTS` names explicit immutable scripts directory containing both `live.mjs` and `live-poll.mjs`; absence leaves live review unavailable rather than installing or fetching.

## Local Contracts

- Source protocol pinned from Atomic repository commit `ff55b141109e3f9f5980c1f0c718dea39f6b2fd9`, `packages/workflows/builtin/open-claude-design-live-protocol.ts` and `packages/workflows/skills/impeccable/scripts/live-poll.mjs`.
- Source owner/license: Bastani, Inc., MIT with Atomic attribution threshold clause. Exact repository copy: `../../LICENSES/Atomic-LICENSE.txt`.
- Do not fetch or install helper dependencies. Reject unreadable helper path before dispatch.
- Native custom journal append must acknowledge before model dispatch/reply progression.
- Host `runModel(eventKey, event, signal)` must use `eventKey` as durable native stage identity and return existing result on replay.
- Bootstrap must complete with `{ ok: true }` before polling. Timeout creates no journal/model work. Abort and helper failure never count as exit. Only journaled helper `exit` is successful terminal state.
- Same-run native cumulative DAG reserves one node for export and rejects helper model event beyond 64-node ceiling. Preserve oldest-first pending event order. Ignore duplicate acknowledged event IDs.
- Upstream deliberately treats unreadable successful poll output as timeout; adapter matches this behavior.
- Immutable pinned helper normally emits one bounded JSON event per process. Adapter still caps combined stdout/stderr at 1 MiB because process output crosses trust boundary.

## Work Guidance

- Keep scheduler logic out of this directory.
- Validate helper and journal data with machine schemas before use.

## Verification

- `bun test ./extensions/workflow-graph/test/design-review-protocol.test.ts ./extensions/workflow-graph/test/design-review-driver.test.ts`
- `bun run typecheck`

## Child DOX Index

No child documentation boundaries exist.
