# Trim Extension

## Purpose
Govern native Senpi compaction without replacing or mutating native history.

## Commands
- Bare `/trim` opens native Settings.
- `/trim shake` is evidence-gated all-class operation; until validated for every supported class, it returns explicit unsupported.

Automatic policy activates only after atomic config save and reload. Extension creates no snapshots, history entries, or history mutations.

## Ownership
- `src/` owns config, governor decisions, and public Senpi registration.
- `test/` owns pure governor and config regression tests.

## Local Contracts
- Use documented Senpi APIs only.
- Persist one validated config atomically under `getAgentDir()`.
- Never create custom compaction results, mutate history, retry, or install packages.
- Unsupported subcommands return explicit unsupported responses; no snapshot/history mutation exists.
- Standalone manifest remains `extensions/trim/package.json`; root registration lists this extension once.

## Verification
- `bun test extensions/trim/test`
- `bun run typecheck`
