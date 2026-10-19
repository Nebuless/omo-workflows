# Model Routing

## Portable profiles

The repository provides two complete, portable routing choices. They do not
describe or change the active global configuration on any host. GPT-heavy
remains the recommended default; balanced is the lighter-work alternative:

- [`omo.jsonc.balanced`](../templates/omo.jsonc.balanced) is Luna-first for
  lighter work, with Sol for general work and Astra for hardest reasoning.
- [`omo.jsonc.gpt-heavy`](../templates/omo.jsonc.gpt-heavy) is Sol-first for
  general implementation, with Astra for hardest reasoning and Luna for quick
  and memory work.

The catalog verified on 2026-10-16 lists only these permitted route IDs:
`9router/cx/gpt-6.1-sol`, `9router/cx/gpt-6-luna`, and
`9router/cx/gpt-6-astra`. Sol supports reasoning through `high`, not `xhigh`.
The profiles use `deep-low`, `deep-high`, and `architect`; legacy `deep` is
removed. All categories remain at shared top level, and reflection and recall
explicitly select the shared `memory-reflection` category.

The catalog shows model availability, not successful authentication or live
task resolution. No current pricing or independent benchmark evidence for these
catalog entries was verified; see [model-matrix.md](model-matrix.md).

## Configuration

`~/.omo/omo.jsonc` is the global user routing file. Copy a portable profile only
when that is the desired local configuration. Shared top-level `categories`
are visible to parent OMO runs and Senpi-owned children. `[opencode]` carries
optional named-agent overrides and must not contain `categories`. Preserve
fields outside `agents.*.models` and `categories.*.models` when editing an
existing configuration. Use canonical catalog IDs, not convenience aliases.

Inspect catalog visibility before changing routes:

```sh
omo --list-models 9router
```

## Boundaries

- Keep endpoint URLs, API keys, and credentials out of this repository.
- Do not add unavailable model IDs as speculative fallbacks.
- Revalidate routes with `omo --list-models 9router` after catalog updates.
