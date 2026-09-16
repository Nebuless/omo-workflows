# Repository Scripts

## Purpose

Own executable validation and portable runtime-repair scripts.

## Ownership

- `validate-package.ts` validates the public package contract.
- `omo-preferences.ts` merges portable global OMO preferences.
- `repair-omo-comment-checker.ts` repairs OMO's omitted global runtime dependency.

## Local Contracts

- Scripts must be deterministic and report actionable failures.
- Runtime repairs may alter user-level tooling only when invoked explicitly.
- Pin repaired external package versions and document root cause in `docs/`.

## Work Guidance

- Keep scripts Bun-native; add no shell wrapper when Bun APIs suffice.
- Update package scripts, mise tasks, docs, tests, templates, and this file together when adding a repair.
- Remove repair scripts when their only supported extension boundary is removed.

## Verification

- `bun run validate:package`
- `bun test test/omo-preferences.test.ts`
- Run a repair only when its documented runtime failure exists.

## Child DOX Index

No child documentation boundaries exist.
