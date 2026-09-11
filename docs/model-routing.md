# Model Routing

## Policy

On this workstation, OMO's `9router` provider exposes canonical model IDs as
`9router/<catalog-model-id>`. Use `9router/cx/*` for main or heavy work. Use
`9router/ollama-cloud/*` for light work and fallbacks.

Current heavy primary choices:

- `9router/cx/gpt-6-astra` — deep reasoning and algorithmic work.
- `9router/cx/gpt-5.6-terra` — implementation and general heavy work.
- `9router/cx/gpt-5.6-luna` — multimodal and visual work.
- `9router/cx/gpt-5.3-codex-spark-review` — code review.

Current Ollama Cloud choices:

- `9router/ollama-cloud/deepseek-v4-flash:0731` — quick lookup and light work.
- `9router/ollama-cloud/deepseek-v4-pro:0813` — code and reasoning fallback.
- `9router/ollama-cloud/glm-5.3` — general reasoning fallback.
- `9router/ollama-cloud/glm-5.3-flash` — fast general fallback.
- `9router/ollama-cloud/kimi-k2.7-code` — code, writing, and visual fallback.

## Configuration

`~/.omo/omo.jsonc` holds OMO task routing under `[opencode]`. Preserve every
field outside `agents.*.models` and `categories.*.models`. Model names must be
canonical catalog IDs, not convenience aliases such as `prx/*`.

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
