# Better Custom Tests

## Purpose

Own regression coverage for provider configuration, host registration, and model presentation.

## Ownership

- `config.test.ts` owns persistence behavior.
- `model-entry.test.ts` owns model metadata behavior.

## Local Contracts

- Use isolated temporary state.
- Assert persisted values and host-facing metadata, not UI wording.
- Do not use sleeps or timing-dependent retries.

## Work Guidance

- Add a test only for executable behavior changes.

## Verification

- `bun test extensions/better-custom/test`

## Child DOX Index

No child documentation boundaries exist.
