# Better Custom Extension

## Purpose

Provide OMO/Senpi commands for editing custom providers and browsing available
models.

## Ownership

- `src/` owns the extension implementation and Senpi host adapter.
- `test/` owns behavior tests for config persistence and model presentation.
- `LICENSE` preserves the upstream MIT attribution.

## Local Contracts

- Import Senpi host APIs from `@code-yeongyu/senpi`.
- Import model and TUI runtime aliases from
  `@earendil-works/pi-ai` and `@earendil-works/pi-tui`.
- Resolve the active configuration through Senpi's `getAgentDir()`. Do not
  hard-code `~/.omo/agent`; OMO supplies `SENPI_CODING_AGENT_DIR`.
- Keep `/custom-provider` and `/better-models` interactive-only.
- Writes to `models.json` must remain atomic and preserve unknown fields.
- Do not reintroduce `@bastani/atomic` imports from the upstream extension.
- `thinkingLevelMap` is generic, per-model native metadata with exactly the
  canonical keys `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`;
  values are provider effort strings or `null`.
- Keep `compat.supportsReasoningEffort: true` model-scoped for mapped
  `openai-completions` entries. Senpi owns mapped effort resolution and request
  construction; Better Custom must not intercept or rewrite request payloads.
- Static 9router defaults match only provider `9router` with exact IDs
  `cx/gpt-5.6-luna`, `cx/gpt-5.6-sol`, and `cx/gpt-5.6-terra`. Observed or
  persisted map/compatibility metadata wins over profile defaults.
- Do not generalize profiles to other providers, model families, or unverified
  gateway effort contracts. Revalidate after model, gateway, OMO, Senpi, or
  Oh My Pi request-transport changes.


- Keep format-agnostic provider logic separate from host seams.
- Update the pinned upstream revision in the root README when importing
  upstream changes.
- Run focused tests and the repository `mise ci` gate after changes.

## Verification

- `bun test extensions/better-custom/test`
- `bun run typecheck`
- `bun run build`
- `omo list --approve` from the repository root

## Child DOX Index

- `src/` — extension runtime, host adaptation, and focused source folders.
- `test/` — extension regression tests; shared Herdr coverage lives in `../../test/`.
