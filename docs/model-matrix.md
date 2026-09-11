# Model Matrix

Reviewed 2026-09-11. Prices are USD per 1M input / cached input / output
under Standard or base Cloud pricing. Benchmark rows are vendor-reported; use
for routing, not independent ranking. `—` means no score was published in the
reviewed source.

## Pricing and capability

| Model | Price | Context | Image input | Best fit | Evidence |
|---|---:|---:|---|---|---|
| `gpt-6-astra` | $10 / $1 / $50 | 272K through 9router | yes | hardest reasoning, research, code | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-6-astra.md) |
| `gpt-5.6-terra` | $2 / $0.20 / $12 | 272K through 9router | yes | general implementation, writing, visual work | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-5.6-terra.md) |
| `gpt-5.6-luna` | $0.20 / $0.02 / $1.20 | 272K through 9router | yes | cheap GPT scout, extraction | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-5.6-luna.md) |
| `gpt-5.3-codex-spark` | $1.75 / $0.175 / $14* | 400K | no | named agentic-coding worker | [GPT-5.3 Codex](https://developers.openai.com/api/docs/models/gpt-5.3-codex.md) |
| `gpt-5.3-codex-spark-review` | $1.75 / $0.175 / $14* | 400K | no | named code-review worker | [GPT-5.3 Codex](https://developers.openai.com/api/docs/models/gpt-5.3-codex.md) |
| `deepseek-v4-pro:0813` | $0.66 / $0.022 / $1.98 | 1M | no | long-context code/reasoning fallback | [Ollama pricing](https://ollama.com/pricing) |
| `deepseek-v4-flash:0731` | $0.22 / $0.007 / $0.66 | 1M | no | cheap text scout fallback | [Ollama pricing](https://ollama.com/pricing) |
| `glm-5.3` | $1.40 / $0.26 / $4.40 | 200K | no | strong Cloud code/reasoning fallback | [Ollama pricing](https://ollama.com/pricing) |
| `glm-5.3-flash` | $0.15 / $0.03 / $0.50 | 1M | yes | low-cost scout, visual, and tool work | [Ollama pricing](https://ollama.com/pricing) |
| `kimi-k2.7-code` | $0.95 / $0.19 / $4 | 262K | yes | code, writing, and MCP fallback | [Ollama pricing](https://ollama.com/pricing) |

\*OpenAI publishes rates for `gpt-5.3-codex`; 9router's `codex-spark` names
are catalog aliases. Price equivalence is an operational assumption, not a
separate public SKU.

## Benchmarks

| Model | Terminal-Bench 2.1 | Terminal-Bench 3.0 | DeepSWE v1.1 | Tool/agent evidence | SWE-bench Verified | SkateBench | Source |
|---|---:|---:|---:|---|---|---|---|
| `gpt-6-astra` | — | — | — | OpenAI describes coding, research, computer use | — | — | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-6-astra.md) |
| `gpt-5.6-terra` | — | — | — | OpenAI describes intelligence/cost balance | — | — | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-5.6-terra.md) |
| `gpt-5.6-luna` | — | — | — | OpenAI describes high-volume cost-sensitive work | — | — | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-5.6-luna.md) |
| `gpt-5.3-codex-spark*` | — | — | — | OpenAI describes GPT-5.3-Codex as agentic-coding focused | — | — | [GPT-5.3 Codex](https://developers.openai.com/api/docs/models/gpt-5.3-codex.md) |
| `deepseek-v4-pro:0813` | 87.9 | — | 62.7 | Toolathlon-V 74.1; AutomationBench 43.2 | — | — | [GLM-5.3 comparison](https://ollama.com/library/glm-5.3) |
| `deepseek-v4-flash:0731` | 82.7 | — | 54.4 | Toolathlon-V 70.3; CyberGym 76.7 | — | — | [Ollama model](https://ollama.com/library/deepseek-v4-flash) |
| `glm-5.3` | 88.2 | 28.3 | 66.9 | Toolathlon-V 73.0; AutomationBench 48.2 | — | — | [Ollama model](https://ollama.com/library/glm-5.3) |
| `glm-5.3-flash` | 84.3 | — | 63.4 | Toolathlon-V 78.4; AutomationBench 48.8; vision-tool rows | — | — | [Ollama model](https://ollama.com/library/glm-5.3-flash) |
| `kimi-k2.7-code` | — | — | — | Kimi Code Bench v2 62.0; MCP Mark Verified 81.1 | — | — | [Ollama model](https://ollama.com/library/kimi-k2.7-code) |

`DeepSWE` is the requested DWE-style benchmark. No reviewed provider source
published requested SWE-bench Verified or SkateBench scores. Never treat a
missing score as zero or infer one from model tier or price.

## Routing profiles

`templates/omo.jsonc.balanced` is cost/capability mix. It puts GLM-5.3-Flash
first for scout and visual categories, keeps DeepSeek V4 Flash as cheap text
fallback, and reserves GPT-6 Astra for hard reasoning.

`templates/omo.jsonc.gpt-heavy` is global default. It puts CX models first for
every category. GPT-5.6 Luna handles cheap quick work; GPT-5.6 Terra handles
general and visual work; GPT-6 Astra handles deep reasoning. Ollama Cloud
models remain fallback where they add long context, cost control, or a stronger
specialty.

Copy exactly one template to `~/.omo/omo.jsonc` only after verifying every
model with `omo --list-models 9router`. The files replace the routing block;
they contain no credentials or endpoint configuration.

## OMO behavior

`models` arrays are ordered primary/fallback chains. OMO uses the same chain
for task spawn and retry. Arrays replace lower-layer arrays, so a project
profile replaces a user profile's complete route list. Use canonical reasoning
levels: `low`, `medium`, `high`, or `xhigh`.

Sources: [OMO configuration](https://github.com/code-yeongyu/oh-my-openagent/blob/71c3087ad63b0d2b754c2fa11ca73aa46401da9b/docs/reference/configuration.md), [OMO model schema](https://github.com/code-yeongyu/oh-my-openagent/blob/71c3087ad63b0d2b754c2fa11ca73aa46401da9b/packages/omo-config-core/src/schema/model-ref.ts), [OpenAI pricing](https://platform.openai.com/docs/pricing), [Ollama pricing](https://ollama.com/pricing).
