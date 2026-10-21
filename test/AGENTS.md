# Extension Tests

## Purpose

Own regression coverage shared by standalone OMO/Senpi extensions.

## Ownership

- `herdr.test.ts` owns observable Herdr lifecycle reporting coverage.
- `validate-package.test.ts` owns isolated regression coverage for the real
  package validator.
- `herdr-tools.test.ts` owns Herdr tool boundary and skill-discovery coverage.
- `model-routing-advisor.test.ts` owns standalone model-routing adviser package registration coverage.
- Compound Engineering package tests live under its own `test/` boundary.

## Local Contracts

- Test observable host behavior, not prose or implementation formatting.
- Isolate agent state in temporary directories.
- Load extension modules in bounded suite setup before exercising registration; restore environment overrides and remove temporary state after the suite.
- Keep tests deterministic; await exact state rather than using timing delays.
- Test extension behavior through public reporter functions and generated Herdr CLI arguments.
- Do not use real Herdr processes, sleeps, or timing-dependent retries.

## Work Guidance

- Keep tests outside an extension package when they cover a standalone extension boundary.

## Verification

- `bun test test/herdr.test.ts test/herdr-tools.test.ts test/model-routing-advisor.test.ts test/extension-load.test.ts test/validate-package.test.ts`

## Child DOX Index

No child documentation boundaries exist.
