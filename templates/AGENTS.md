# OMO Workflow Templates

## Purpose

Store portable, merge-safe OMO configuration templates.

## Ownership

- `omo-agent-settings.json` owns global Senpi preferences applied by the OMO bootstrap script.
- `omo.jsonc.balanced` owns the portable Luna-first lighter-work `9router` profile.
- `omo.jsonc.gpt-heavy` owns the portable Sol-first general-implementation `9router` profile.

## Local Contracts

- Templates contain no credentials, endpoints, or machine paths.
- Routing templates contain only canonical model IDs verified by `omo --list-models 9router`.
- Routing uses only `9router/cx/gpt-6.1-sol`, `9router/cx/gpt-6-luna`, and `9router/cx/gpt-6-astra`; Sol supports reasoning through `high`, not `xhigh`.
- Current `deep-low`, `deep-high`, and `architect` category names use the pinned OMO release schema; do not restore legacy `deep`.
- `omo-agent-settings.json` keeps native Senpi startup and working tips disabled.
- Routing templates are complete replacement profiles, not additive JSON fragments.
- Both routing templates keep every execution category in shared top-level `categories`; parent OMO runs, Senpi children, reflection, and Kibitzer use same routing map. `memory.reflection.category` and `memory.recall.category` select `memory-reflection` explicitly.
- Both routing templates disable reflection sandboxing until upstream merges a fix for missing `runtime/reflection-sessions`; see `docs/issues.md`.

## Work Guidance

- Keep each template minimal.
- Update routing-template tests and owned routing docs when changing a profile. Templates are portable options, not claims about active global host state.
- Update the matching bootstrap script and tests when changing `omo-agent-settings.json`.

## Verification

- `bun test test/omo-preferences.test.ts` validates the OMO preferences bootstrap and routing-template shape.

## Child DOX Index
