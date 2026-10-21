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

## ZO-derived local assignments

On 2026-10-21, this host copied the shared agent and category assignments from
ZO's global `omo.jsonc`, resolving model aliases to canonical provider/model
IDs. This is local configuration, not a change to either portable profile.

- Sol (`9router/cx/gpt-6.1-sol`, `high`): agents `sisyphus`, `librarian`,
  `adversarial-reviewer`, `omo-native-code-reviewer`, and
  `omo-native-qa-executor`; categories `architect`, `ultrabrain`, `artistry`,
  `unspecified-high`, and `deep-low`.
- Astra (`9router/cx/gpt-6-astra`, `high`): agents `plan-consultant`,
  `plan-reviewer`, and `omo-native-gate-reviewer`; category `deep-high`.
- Luna (`9router/cx/gpt-6-luna`): agents `explore` and `implementer` and category
  `visual-engineering` use `high`; `quick` and `unspecified-low` use `medium`;
  `writing` uses `xhigh`.

Memory settings and the local `memory-reflection` route were preserved, as were
unrelated local configuration fields. ZO's main-session profiles and
OpenCode-specific overrides were not imported. All copied model IDs appeared in
the authenticated gateway catalog. The installed configuration doctor reported
no routing diagnostics, and a fresh `omo doctor` reported all 11 categories
usable. Restart OMO to apply these assignments to new delegated work.

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

## Tailnet gateway connectivity

On a container host using `tailscaled --tun=userspace-networking`, successful
Tailscale ping or SSH does not prove that ordinary HTTP clients can reach a
tailnet gateway. Check the networking mode, OS routes, and an authenticated
gateway request separately. Tailscale documents this distinction in its
[userspace networking guide](https://tailscale.com/docs/concepts/userspace-networking).

Use an explicit userspace transport, such as a Tailscale outbound proxy or a
supervised loopback bridge through `tailscale nc`, when no kernel tailnet
interface exists. Keep host-specific service configuration, endpoint URLs, and
credentials outside this repository. Verify both model discovery and a real
completion after updating the local provider endpoint; restart existing OMO
sessions if they retain the previous configuration.
