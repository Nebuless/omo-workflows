# OMO Herdr Extension

## Purpose

Report OMO lifecycle state to a containing Herdr pane.

- `package.json` owns standalone local installation through `omo install -l ./extensions/herdr`.
- `index.ts` owns OMO-to-Herdr lifecycle reporting, skill discovery, and extension registration.
- `tools.ts` owns `herdr_inspect`, typed capability/query/operation/approval/preview tools and private Herdr process launch; no public `herdr_control` or raw argv surface.
- `capabilities.ts` owns Herdr 0.9.1 discovery, typed capability map, and fail-closed mismatch handling.
- `runner.ts` owns pure bounded-output handling with a 20,000-byte combined cap; it exposes no executable runner.
- `targets.ts` owns opaque target snapshots, inspect-before-mutate, ancestry, freshness, and prompt readiness.
- `approval.ts` owns in-memory five-minute one-use approvals and non-authoritative limitation.
- `preview.ts` owns loopback-only task-owned Preview/Logs policy; unavailable until Herdr-tab rendering is proven.
- `skills/` owns capability-specific Herdr operating guidance.

## Local Contracts

- Import Senpi host APIs only from `@code-yeongyu/senpi`.
- Activate only when `HERDR_ENV=1` and `HERDR_PANE_ID` are present.
- Use `HERDR_BIN_PATH` when supplied; otherwise use `herdr` from `PATH`.
- Report `working`, `idle`, and `blocked` state using stable source `custom:omo-workflows` and agent label `omo`.
- Use strictly increasing process-local report sequences.
- Release lifecycle authority only when OMO quits, never during reload or session replacement.
- Reporting must never block or fail OMO.
- All mutations require discovered typed capability availability, opaque target inspection, freshness/ancestry validation, and readback.
- Never route shell text or raw argv through Herdr tools.

## Work Guidance

- Keep Herdr CLI invocation isolated from Senpi event wiring.
- Keep skills grouped by core, agent, handoff, orchestration, and administration boundaries.
- Do not claim session restoration support until Herdr ships an OMO resume integration.

## Verification

- `bun test test/herdr.test.ts test/herdr-tools.test.ts`
- `bun run typecheck`
- `bun run build`
- `omo list --approve`

## Child DOX Index

- `skills/` — packaged Herdr capability guidance.
