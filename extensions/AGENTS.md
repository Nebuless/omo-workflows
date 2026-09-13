# Repository Extensions

## Purpose

Own extension package boundaries and upstream adaptation policy.

## Ownership

- Each durable extension directory owns its host adapter, attribution, and tests.

## Local Contracts

- Use public Senpi APIs and package-local dependencies only.
- Every extension is individually installable and follows
  [`../docs/authoring-extensions.md`](../docs/authoring-extensions.md).
- Use `better-custom/` as canonical structure: `src/index.ts` entrypoint and
  feature modules under `src/`.
- Preserve upstream license and immutable source revision when porting code.
- Keep host-specific compatibility seams documented and tested.

## Work Guidance

- Read [`../docs/customizations.md`](../docs/customizations.md) before adding a
  customization boundary.
- Add a child `AGENTS.md` before a new extension gains source or test ownership.

## Verification

- `bun test extensions`
- `bun run typecheck`

## Child DOX Index

- `better-custom/` — custom provider and model-browser Senpi extension.
- `herdr/` — OMO lifecycle reporting, skills, and LLM-safe CLI tools for Herdr.
- `workflow-graph/` — staged Atomic program admission over native OMO DAGs, TUI overlay, and optional read-only Herdr observer; preserves Atomic and omo-herdr-dag provenance.
- `test/` — cross-extension regression coverage.
