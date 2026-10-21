# Repository Scripts

## Purpose

Own executable validation and portable runtime-repair scripts.

## Ownership

- `validate-package.ts` validates the public package contract.
- The package validator forbids all five documented host packages in
  dependencies and requires `*` peers for existing root host peers; optional
  host peers must also use `*` when declared.
- `omo-preferences.ts` merges portable global OMO preferences.
- `repair-omo-comment-checker.ts` is a historical unconditional global package
  install, unsupported for the current OMO binary. Do not run it on current OMO.

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
- `bun test test/validate-package.test.ts`
- `bun test test/omo-preferences.test.ts`
- Do not apply historical repairs to current OMO/Senpi binaries.

## Child DOX Index

No child documentation boundaries exist.
