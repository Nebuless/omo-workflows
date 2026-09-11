# Repository Scripts

## Purpose

Own executable validation and portable runtime-repair scripts.

## Ownership

- `validate-package.ts` validates the public package contract.
- `repair-omo-comment-checker.ts` repairs OMO's omitted global runtime dependency.

## Local Contracts

- Scripts must be deterministic and report actionable failures.
- Runtime repairs may alter user-level tooling only when invoked explicitly.
- Pin repaired external package versions and document root cause in `docs/`.

## Work Guidance

- Keep scripts Bun-native; add no shell wrapper when Bun APIs suffice.
- Update package scripts, mise tasks, docs, and this file together when adding a repair.

## Verification

- `bun run validate:package`
- Run a repair only when its documented runtime failure exists.

## Child DOX Index

No child documentation boundaries exist.
