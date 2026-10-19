# Better Custom Runtime

## Purpose

Own Senpi host adaptation, provider persistence, interactive commands, and model presentation.

## Ownership

- `index.ts` owns extension registration.
- `config.ts` owns atomic `models.json` persistence.
- `flows/` owns provider CRUD workflows.
- `probe/` owns endpoint and model capability discovery.
- `ui/` owns interactive selections and model-browser views.

## Local Contracts

- Import host APIs only from Senpi compatibility aliases.
- Resolve configuration with `getAgentDir()`.
- Keep provider input validation at external API boundaries.
- Preserve unknown `models.json` fields on writes.
- Keep `thinkingLevelMap` canonical with exactly `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; values are provider effort strings or `null`.
- Apply 9router profiles only to exact `9router/cx/gpt-5.6-luna`, `9router/cx/gpt-5.6-sol`, and `9router/cx/gpt-5.6-terra` IDs. Luna maps `minimal` to `low` and `xhigh` to `max`; Sol and Terra map `xhigh` to `ultra`; each keeps `off` as `none` and `max` as `max`.
- Resolve metadata precedence as observed native map/compatibility, stored native map/compatibility, matching profile, then generic defaults. Do not partially merge a profile into an existing map.
- Pass native map and compatibility metadata through unchanged; Better Custom does not inspect, intercept, or rewrite requests.

## Work Guidance

- Keep noninteractive behavior explicit; UI commands must not hang in JSON mode.
- Update `test/` coverage with observable behavior changes.

## Verification

- `bun test extensions/better-custom/test`
- `bun run typecheck`

## Child DOX Index

No child documentation boundaries exist; `flows/`, `probe/`, and `ui/` stay owned here.
