# OMO Herdr Extension

## Purpose

Report OMO lifecycle state to a containing Herdr pane.

## Ownership

- `package.json` owns standalone local installation through `omo install -l ./extensions/herdr`.
- `index.ts` owns OMO-to-Herdr lifecycle reporting, skill discovery, and extension registration.
- `tools.ts` owns LLM-safe Herdr CLI execution.
- `skills/` owns capability-specific Herdr operating guidance.

## Local Contracts

- Import Senpi host APIs only from `@code-yeongyu/senpi`.
- Activate only when `HERDR_ENV=1` and `HERDR_PANE_ID` are present.
- Use `HERDR_BIN_PATH` when supplied; otherwise use `herdr` from `PATH`.
- Report `working`, `idle`, and `blocked` state using stable source `custom:omo-workflows` and agent label `omo`.
- Use strictly increasing process-local report sequences.
- Release lifecycle authority only when OMO quits, never during reload or session replacement.
- Reporting must never block or fail OMO.
- `herdr_inspect` may run read-only argv outside Herdr; `herdr_control` requires a Herdr pane and explicit user-authorized mutation.
- Never route shell text through Herdr tools; invoke argv only.

## Work Guidance

- Keep Herdr CLI invocation isolated from Senpi event wiring.
- Keep skills grouped by core, agent, handoff, orchestration, and administration boundaries.
- Do not claim session restoration support until Herdr ships an OMO resume integration.

## Verification

- `bun test extensions/test/herdr.test.ts extensions/test/herdr-tools.test.ts`
- `bun run typecheck`
- `bun run build`
- `omo list --approve`

## Child DOX Index

- `skills/` — packaged Herdr capability guidance.
