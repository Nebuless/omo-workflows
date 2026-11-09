# Repetition Recovery

## Purpose

Capture bounded TTSR incident evidence and attempt one same-model continuation after native repetition recovery is exhausted.

## Ownership

- `src/index.ts` owns public lifecycle registration.
- `src/recovery.ts` owns exhaustion detection and recovery transitions.
- `src/journal.ts` owns private local claims and metadata-only event records.
- `src/incidents.ts` owns single-message stream capture, credential redaction, private incident files and twenty-file retention.
- `test/` owns deterministic lifecycle and real-engine regression coverage.

## Local Contracts

- Preserve native TTSR detection, its initial correction, and engine admission limits.
- Require a synchronous supported `ttsr:loop-stopped` event correlated with a new
  active-run branch stop and its earlier native injection. Snapshot entries on
  load and run start; historical exhaustion never arms recovery.
- Invalidate eligibility on input, cancellation, shutdown, or branch replacement.
  Re-read live session, user, branch, deadline-stop, and pending-message state
  before claiming and after awaited model selection.
- Enable recovery on installation using the live current model without switching. Keep the model flag as an explicit override and `off` as recovery opt-out. Incident logging remains enabled. Never change provider automatically; explicit different-model overrides use session-only selection.
- Claim one attempt per session and user-message entry on disk before switching models.
- Never send user input, use manual-continue identifiers, edit context, or patch runtime code.
- Keep claim journals metadata-only. Incident files contain only bounded assistant text, thinking and streamed tool arguments associated with fresh TTSR activation records. Never copy user messages, prompts, provider payloads, headers, tool results or the surrounding transcript. Redact common credentials before writing, mark truncation and execution-at-capture state, keep files private and retain twenty incidents. Redaction is best-effort.
- Supply only the incident path in continuation instructions, with an explicit untrusted-data warning and uncertain-side-effect check. Do not automatically recover security rules, route errors or other unsupported guards. No fresh-session API is available to lifecycle handlers.
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
- A successful selection without a committed model entry may be deferred by
  native compaction. Cancel it through session-only reselection before reporting
  restoration. Journal append failures must not prevent owned-model cleanup.
- Report enabled or disabled activation and bounded fallback, pending, refusal,
  and restoration-held states through existing UI notifications. Journal a
  settled model run as `settled`, not as completed user work.

## Verification

- `bun test --timeout 30000 ./extensions/repetition-recovery/test`
- `mise ci`

## Child DOX Index

No child documentation boundaries exist.
