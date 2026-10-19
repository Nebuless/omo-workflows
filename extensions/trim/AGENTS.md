# Trim Extension

## Purpose
Govern native Senpi compaction without replacing or mutating native history.

## Commands
- Bare `/trim` opens Trim Settings.
- `/trim shake` forces one native compaction only when agent is idle, no messages are pending, and native compaction is inactive. Otherwise it warns without mutating history.

## Compaction Policy
- `native` leaves Senpi threshold compaction unchanged.
- `settled` cancels Senpi `threshold` requests, then requests native compaction only after a completed turn reaches configured tokens and the agent settles safely.
- `manual` cancels Senpi `threshold` requests and never schedules a replacement.
- User-requested `manual` and native `overflow` compaction always continue.

Policy changes apply after atomic config save at next lifecycle boundary. Extension creates no snapshots, history entries, or history mutations.

## Ownership
- `src/` owns config, governor decisions, and public Senpi registration.
- `test/` owns pure governor and config regression tests.

## Local Contracts
- Use documented Senpi APIs only.
- Cancel only native `threshold` compaction for governed strategies; never cancel native `manual` or `overflow` requests.
- Persist one validated config atomically under `getAgentDir()`.
- Never create custom compaction results, write history directly, retry, or install packages.
- Unsupported subcommands return explicit errors. `/trim shake` delegates one guarded request to native Senpi compaction.
- Standalone manifest remains `extensions/trim/package.json`; root registration lists this extension once.

## Verification
- `bun test extensions/trim/test`
- `bun run typecheck`
