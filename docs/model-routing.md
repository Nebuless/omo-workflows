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

`~/.omo/omo.jsonc` holds routing in shared top-level `categories`, so parent
OMO runs and Senpi-owned children resolve same models. The active global routing
is GPT-heavy. `[opencode]` only carries optional host-specific agent overrides;
it must not contain `categories`. Preserve every field outside `agents.*.models`
and `categories.*.models`. Model names must be canonical catalog IDs, not
convenience aliases such as `prx/*`.

Memory reflection and recall/Kibitzer select shared `memory-reflection`, pinned
to `9router/cx/gpt-5.6-luna` at low reasoning, via
`memory.reflection.category` and `memory.recall.category`.

Inspect availability before changing routes:

```sh
omo --list-models 9router
```

The local Ollama daemon was not required or assumed. These routes target the
installed `9router` Ollama Cloud catalog.

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
