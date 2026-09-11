# Model Routing

## Policy

On this workstation, OMO's `9router` provider exposes canonical model IDs as
`9router/<catalog-model-id>`. `templates/omo.jsonc.gpt-heavy` is the global
default: CX models lead every route; Ollama Cloud models are targeted fallbacks.

`templates/omo.jsonc.balanced` is retained for cost/capability mix. It leads
scout and visual work with `glm-5.3-flash`, retains `deepseek-v4-flash:0731`
as cheap text fallback, and reserves GPT-6 Astra for hard work.

Full pricing, benchmark evidence, and each profile's agent/category mapping
live in [model-matrix.md](model-matrix.md).

## Configuration

`~/.omo/omo.jsonc` holds OMO task routing under `[opencode]`. The active global
routing is GPT-heavy. Preserve every field outside `agents.*.models` and
`categories.*.models`. Model names must be canonical catalog IDs, not
convenience aliases such as `prx/*`.

Inspect availability before changing routes:

```sh
omo --list-models 9router
```

The local Ollama daemon was not required or assumed. These routes target the
installed `9router` Ollama Cloud catalog.

## Boundaries

- Keep endpoint URLs, API keys, and credentials out of this repository.
- Do not add unavailable model IDs as speculative fallbacks.
- Revalidate routes with `omo --list-models 9router` after catalog updates.
