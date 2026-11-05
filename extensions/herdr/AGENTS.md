# OMO Herdr Extension

## Purpose

Integrate OMO with current Herdr desktop/core and the separate legacy CLI.

- `package.json` owns standalone local installation through `omo install -l ./extensions/herdr`.
- `index.ts` owns OMO-to-Herdr lifecycle reporting, skill discovery, and extension registration.
- `desktop.ts` owns bounded read-only current app/core inspection with explicit verified version gates; core reads connect only to an existing `HC_SOCKET`/`HC_TERMINAL_SOCKET`, never auto-start through `hc`. No current-desktop mutation or raw command surface.
- `README.md` owns the three-surface support matrix, immutable upstream evidence, and verification limits.
- `tools.ts` owns `herdr_inspect`, typed capability/query/operation/approval/preview tools and private Herdr process launch; no public `herdr_control` or raw argv surface.
- `capabilities.ts` owns legacy discovery for 0.9.1/0.9.2/0.9.5, stable 0.9.1 capability IDs, and fail-closed mismatch handling.
- `runner.ts` owns pure bounded-output handling with a 20,000-byte combined cap; it exposes no executable runner.
- `targets.ts` owns opaque target snapshots, inspect-before-mutate, ancestry, freshness, and prompt readiness.
- `approval.ts` owns in-memory five-minute one-use approvals and non-authoritative limitation.
- `preview.ts` owns loopback-only task-owned Preview/Logs policy; unavailable until Herdr-tab rendering is proven.
- `skills/` owns capability-specific Herdr operating guidance.

## Local Contracts

- Import Senpi host APIs only from `@code-yeongyu/senpi`.
- Legacy lifecycle activates only with `HERDR_ENV=1` and `HERDR_PANE_ID`. Current core lifecycle uses `HC_TERMINAL_ID` plus a TTY; never emit OSC into print/RPC output.
- Use `HERDR_BIN_PATH` when supplied; otherwise use `herdr` from `PATH`.
- Report `working`, `idle`, and `blocked` state using stable source `custom:omo-workflows` and agent label `omo`.
- Use strictly increasing epoch-based legacy report sequences, surviving normal OMO restarts. Publish explicit persisted-session resume metadata after claiming lifecycle authority; unsupported metadata must not break lifecycle reporting.
- Unsaved/rejected session paths replace old resume argv with plain `omo`, never a stale persisted session. Herdr retains resume argv for the same source until explicitly replaced or released.
- Current core uses OSC 7501 states and clear-on-quit. App/core IDs and commands must never enter legacy pane routes.
- Release lifecycle authority only when OMO quits, never during reload or session replacement.
- Reporting must never block or fail OMO.
- All mutations require discovered typed capability availability, opaque target inspection, freshness/ancestry validation, and readback.
- Never route shell text or raw argv through Herdr tools.

## Work Guidance

- Keep Herdr CLI invocation isolated from Senpi event wiring.
- Keep skills grouped by core, agent, handoff, orchestration, and administration boundaries.
- Resolve packaged skill paths from the native discovery context's
  `loadedExtensionPaths`; bundled loaders may relocate the entrypoint module.
- Custom legacy resume metadata is distinct from a native OMO integration. Do not claim desktop program recovery resumes OMO; core recovery may start a shell. Native OMO owns worker execution and task graphs.

## Verification

- `bun test test/herdr.test.ts test/herdr-tools.test.ts`
- `bun run typecheck`
- `bun run build`
- `omo list --approve`

## Child DOX Index

- `skills/` — packaged Herdr capability guidance.
- `README.md` — supported versions, evidence, limits, and installation.
