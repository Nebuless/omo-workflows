# Extension Tests

## Purpose

Own regression coverage shared by standalone OMO/Senpi extensions.

## Ownership

- `herdr.test.ts` owns observable Herdr lifecycle reporting coverage.
- `herdr-tools.test.ts` owns Herdr tool boundary and skill-discovery coverage.

## Local Contracts

- Test extension behavior through public reporter functions and generated Herdr CLI arguments.
- Do not use real Herdr processes, sleeps, or timing-dependent retries.

## Work Guidance

- Keep tests outside an extension package when they cover a standalone extension boundary.

## Verification

- `bun test extensions/test`

## Child DOX Index

No child documentation boundaries exist.
