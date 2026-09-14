# Compound Engineering Extension

## Purpose

Expose Every's Compound Engineering skills through native OMO/Senpi resource discovery.

## Ownership

- `src/` owns typed Senpi registration.
- `skills/` owns the pinned upstream skill distribution.
- `test/` owns discovery and inventory regressions.
- `UPSTREAM.md` and `LICENSE` own provenance.

## Local Contracts

- Register skills only through Senpi's public `resources_discover` hook.
- Keep imported upstream skill files byte-for-byte unchanged.
- Pin every import to the immutable revision in `UPSTREAM.md`.
- Add no runtime dependency on another agent host.

## Work Guidance

- Refresh the whole upstream skill tree together; never mix revisions.
- Keep host adaptation in `src/index.ts`.

## Verification

- `bun test extensions/compound-engineering/test`
- `bun run typecheck`
- `bun run build`
- `omo -e ./extensions/compound-engineering --print "List Compound Engineering skills."`

## Child DOX Index

- `src/` — native Senpi entrypoint.
- `skills/` — pinned upstream Compound Engineering workflows.
- `test/` — package discovery and inventory coverage.
