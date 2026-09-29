# Model Routing

## Policy

This workstation runs Native OMO with Senpi. Better Custom registers `9router`
from the active agent directory. Current catalog contains `cx/gpt-6-luna`,
`cx/gpt-6-sol`, and `cx/gpt-6-astra`; provider-qualified IDs start with `9router/`.

`templates/omo.jsonc.native-9router` is the portable copy of current global
routes. The balanced and GPT-heavy templates retain historical catalogs; do not
replace current workstation routing with either without revalidating every model.
`templates/omo.jsonc.balanced` leads
scout and visual work with `glm-5.3-flash`, retains `deepseek-v4-flash:0731`
as cheap text fallback, and reserves GPT-6 Astra for hard work.

Full pricing, benchmark evidence, and each profile's agent/category mapping
live in [model-matrix.md](model-matrix.md).

## Configuration

`~/.omo/omo.jsonc` holds routing in shared top-level `categories`, so parent
OMO runs and Senpi-owned children resolve same models. Native agent overrides
live in shared `agents` for all seven built-in profiles, including native
code reviewer, gate reviewer, and QA executor; no OpenCode-only block remains. Model names must be
canonical catalog IDs, not
convenience aliases such as `prx/*`.

Memory reflection and recall/Kibitzer select shared `memory-reflection`, pinned
to `9router/cx/gpt-6-luna` at `xhigh` reasoning, via
`memory.reflection.category` and `memory.recall.category`.

Inspect availability before changing routes:

```sh
omo --list-models 9router
```

Quick and unspecified-low use Luna; visual, artistry, writing, and
unspecified-high and deep-low use Sol; ultrabrain, deep-high, and architect use Astra. Retired model
fallbacks were removed. Pi files are neither imported nor modified.

Full agent routes and authentication inventory live in
[OMO subagents](omo-subagents.md#named-agents). Explicit model pins preserve native
role prompts and tool policies. ChatGPT-subscription is authenticated but is not
an implicit fallback for these 9router pins.

### Native warning repair evidence

- Verified: `2026-09-29`; OMO `5.1.2`, Senpi `2026.9.29-3`, Bun `1.3.14`.
- OMO owns configuration and the legacy routing-gap scan:
  https://github.com/code-yeongyu/oh-my-openagent/blob/dev/bin/lib/setup-opencode-models.js
  and https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/omo-json.md.
- Senpi owns the one-time Pi notice:
  https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/src/legacy-pi-edits.ts.
- Local proof: `omo doctor` reports `memory-reflection` usable, no OpenCode
  routing-gap notice, and no Pi-config warning. Installed detector returns
  `piEdits: []`, `startupNotice: null`; installed routing-gap check returns `[]`.
- One archived `oh-my-openagent.json` was renamed to `.json.retired` within its
  migration-backup directory, preserving content outside the legacy scan.
- Revalidate after OMO/Senpi upgrades or Better Custom catalog changes.

## Explicit route-advice preflight

[`model-routing-advisor`](../extensions/model-routing-advisor/README.md) is an
optional, read-only extension. Call `model_route_advice` only when caller has
already normalized ordered provider/model candidates from route context. Its
versioned JSON report is evidence, never a model-selection result.

Attach report value or opaque reference explicitly before native work:

| Surface | Caller preflight |
| --- | --- |
| Direct `task` | Obtain one report for chosen category or named-agent chain. Retain it with parent launch record. |
| Task batch or workpool | Obtain one report per unique candidate chain before launch. |
| Team | Lead obtains one report per declared member route before member launch. |
| Mass/DAG | Make advice a preflight node; pass report/reference to dependent launch nodes. |
| ULW | Record report/reference in plan or goal before requested delegated wave. |

No tool invocation is automatic. Native OMO/Senpi keeps candidate resolution,
model selection, provider crossing, admission, scheduling, retries,
cancellation, delivery, and completion. `candidate_observed_usable` is only an
observation. `all_candidates_known_unusable` requires caller-supplied fresh,
complete unavailable evidence for every candidate provider; catalog and auth
signals alone remain incomplete.

Advisor has no Herdr dependency. A `HERDR_ENV=1` session with a valid pane ID
may present an existing serialized report reference through existing Herdr
surfaces. Herdr does not evaluate candidates or control routing.

## Boundaries

- Keep endpoint URLs, API keys, and credentials out of this repository.
- Do not add unavailable model IDs as speculative fallbacks.
- Revalidate routes with `omo --list-models 9router` after catalog updates.
