# Repetition Recovery

## Purpose

Attempt one fallback continuation after native repetition recovery is exhausted.

## Ownership

- `src/index.ts` owns public lifecycle registration.
- `src/recovery.ts` owns exhaustion detection and recovery transitions.
- `src/journal.ts` owns private local claims and redacted event records.
- `test/` owns deterministic lifecycle and real-engine regression coverage.

## Local Contracts

- Preserve native TTSR detection, its initial correction, and engine admission limits.
- Require an explicit fallback model flag; use session-only model selection.
- Claim one attempt per session and user-message entry on disk before switching models.
- Never send user input, use manual-continue identifiers, edit context, or patch runtime code.
- Log only allowlisted metadata; never log prompts, output, credentials, or tool arguments.
- Restore the original model after the continuation settles; never replay an interrupted claim.

## Verification

- `bun test --timeout 30000 ./extensions/repetition-recovery/test`
- `mise ci`

## Child DOX Index

No child documentation boundaries exist.
