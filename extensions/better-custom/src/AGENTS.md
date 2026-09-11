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

## Work Guidance

- Keep noninteractive behavior explicit; UI commands must not hang in JSON mode.
- Update `test/` coverage with observable behavior changes.

## Verification

- `bun test extensions/better-custom/test`
- `bun run typecheck`

## Child DOX Index

No child documentation boundaries exist; `flows/`, `probe/`, and `ui/` stay owned here.
