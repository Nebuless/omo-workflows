# Repository Extensions

## Purpose

Own extension package boundaries and upstream adaptation policy.

## Ownership

- Each durable extension directory owns its host adapter, attribution, and tests.

## Local Contracts

- Use public Senpi APIs and package-local dependencies only.
- Preserve upstream license and immutable source revision when porting code.
- Keep host-specific compatibility seams documented and tested.

## Work Guidance

- Add a child `AGENTS.md` before a new extension gains source or test ownership.

## Verification

- `bun test extensions`
- `bun run typecheck`

## Child DOX Index

- `better-custom/` — custom provider and model-browser Senpi extension.
