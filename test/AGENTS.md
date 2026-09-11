# Repository Tests

## Purpose

Own regression tests spanning package boundaries and Senpi public contracts.

## Ownership

- `extension-load.test.ts` owns OMO/Senpi extension loading smoke coverage.

## Local Contracts

- Test observable host behavior, not prose or implementation formatting.
- Isolate agent state in temporary directories.
- Keep tests deterministic; await exact state rather than using timing delays.

## Work Guidance

- Add a regression test for every repaired public compatibility boundary.
- Keep host fakes limited to public ExtensionAPI methods used by the test.

## Verification

- `bun test test`

## Child DOX Index

No child documentation boundaries exist.
