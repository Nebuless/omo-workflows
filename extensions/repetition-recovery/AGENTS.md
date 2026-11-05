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
- Require a synchronous supported `ttsr:loop-stopped` event correlated with a new
  active-run branch stop and its earlier native injection. Snapshot entries on
  load and run start; historical exhaustion never arms recovery.
- Invalidate eligibility on input, cancellation, shutdown, or branch replacement.
  Re-read live session, user, branch, deadline-stop, and pending-message state
  before claiming and after awaited model selection.
- Require an explicit fallback model flag; use session-only model selection.
- Claim one attempt per session and user-message entry on disk before switching models.
- Never send user input, use manual-continue identifiers, edit context, or patch runtime code.
- Log only allowlisted metadata; never log prompts, output, credentials, or tool arguments.
- Normalize journal reads and writes, strip unknown nested fields, and hash
  selection actor identity consistently with live ownership comparisons.
  Preserve legacy claims and keep request records separate from admission.
- Invalidate continuation permission before awaiting interruption cleanup. Keep
  an outstanding switch attached to its captured attempt until it settles;
  nested lifecycle hooks must not wait on that same switch or restoration.
- Reconcile through a live context bound to the attempt's session. Restore its
  owned fallback using committed `model_change` entry IDs and extension
  source/actor metadata; preserve newer committed choices, including a choice
  of the same fallback.
- Persist continuation outcome separately from restoration status. Failed or
  unavailable restoration remains held. On load, reconcile outstanding records
  for prior user entries on the active branch without replaying continuation.
  A crash before committed ownership is persisted leaves restoration held.
  Legacy terminal claims remain spent with restoration unknown.
- Report enabled or disabled activation and bounded fallback, pending, refusal,
  and restoration-held states through existing UI notifications. Journal a
  settled model run as `settled`, not as completed user work.

## Verification

- `bun test --timeout 30000 ./extensions/repetition-recovery/test`
- `mise ci`

## Child DOX Index

No child documentation boundaries exist.
