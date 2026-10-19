# Repository Scripts

## Purpose

Own executable validation and portable runtime-repair scripts.

## Ownership

- `validate-package.ts` validates the public package contract.
- `omo-preferences.ts` merges portable global OMO preferences.
- `repair-omo-dag-ui.ts`, `repair-senpi-workflow-journal.ts`, and
  `repair-senpi-workflow-mouse.ts` are historical version/hash-locked opt-ins.
  `repair-omo-comment-checker.ts` unconditionally installs a global package.
  None is supported for the current OMO binary. Never apply them to a current
  runtime; preserve existing guards.
- `lib/workflow-journal-patch.ts` and `lib/workflow-mouse-patch.ts` implement
  those historical repair payloads only.

## Local Contracts

- Scripts must be deterministic and report actionable failures.
- Runtime repairs may alter user-level tooling only when invoked explicitly.
- Pin repaired external package versions and document root cause in `docs/`.

## Work Guidance

- Keep scripts Bun-native; add no shell wrapper when Bun APIs suffice.
- Update package scripts, mise tasks, docs, tests, templates, and this file together when adding a repair.

## Verification

- `bun run validate:package`
- `bun test test/omo-preferences.test.ts`
- Do not apply historical repairs to current OMO/Senpi binaries.

## Child DOX Index

No child documentation boundaries exist.
