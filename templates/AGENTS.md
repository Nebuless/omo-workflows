# OMO Workflow Templates

## Purpose

Store portable, merge-safe OMO configuration templates.

## Ownership

- `omo-agent-settings.json` owns global Senpi preferences applied by the OMO bootstrap script.
- `omo.jsonc.balanced` owns the portable balanced `9router` task-routing profile.
- `omo.jsonc.gpt-heavy` owns the portable CX-first `9router` task-routing profile.

## Local Contracts

- Templates contain no credentials, endpoints, or machine paths.
- Routing templates contain only canonical model IDs verified by `omo --list-models 9router`.
- `omo-agent-settings.json` keeps native Senpi startup and working tips disabled.
- Routing templates are complete replacement profiles, not additive JSON fragments.
- Both routing templates declare shared `categories.memory-reflection` and select it with `memory.reflection.category`; reflection children run through Senpi and cannot use an `[opencode]`-only route.
- Both routing templates disable reflection sandboxing until upstream merges a fix for missing `runtime/reflection-sessions`; see `docs/issues.md`.

## Work Guidance

- Keep each template minimal.
- Update routing-template tests, `docs/model-matrix.md`, `docs/model-routing.md`, README instructions, and parent Child DOX Index when changing a routing profile.
- Update the matching bootstrap script and tests when changing `omo-agent-settings.json`.

## Verification

- `bun test test/omo-preferences.test.ts` validates the OMO preferences bootstrap and routing-template shape.

## Child DOX Index
