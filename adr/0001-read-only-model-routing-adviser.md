# ADR 0001: Keep model routing native and add read-only advice

- Status: Accepted
- Date: 2026-09-16

## Context

Provider catalogs, credentials, and runtime availability change independently from configured OMO model preferences. OMO/Senpi public extension APIs do not provide a supported effective-route resolver or universal admission hook. Existing `extensions/herdr` is opt-in lifecycle projection and safe CLI control, not global routing authority.

## Decision

Create `extensions/model-routing-advisor` as an optional standalone package. It accepts caller-normalized ordered provider/model candidates and emits a bounded, versioned, JSON-safe availability report.

Native OMO/Senpi remains sole authority for configuration merge, candidate order, model selection, provider crossing, admission, scheduling, retry, cancellation, and completion. The adviser is read-only and explicit: it never parses or writes routing config, dispatches work, chooses a model, silently falls back, or imports private runtime internals.

Provider/model availability is dynamic evidence scoped to provider, model, session, and observation time. Only fresh, complete observation can conclude all supplied candidates are unusable. Every ordered provider transition is reported; no transition authorizes cross-provider dispatch.

`extensions/herdr` remains active only with `HERDR_ENV=1` and `HERDR_PANE_ID`. It may present an existing advice report reference through current safe surfaces, but does not evaluate or control routing.

## Consequences

- Callers request advice explicitly before direct task, workpool, team, mass/DAG, or ULW work where evidence is useful.
- The first release depends on caller-supplied candidates until a version-matched public effective-route API exists.
- Unknown, stale, refresh-failed, or incomplete evidence yields a conservative report instead of inferred fallback.
- The adviser must stay stateless: no daemon, polling timer, socket, mailbox, scheduler, or persistent route store.
- Future route repair or policy changes require a separate user-confirmed OMO configuration change and fresh-session validation.
