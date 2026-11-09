# Better Custom for OMO

This is the OMO/Senpi adapter of the
[`better-custom`](https://tangled.org/expi.tngl.sh/solu-atomic) extension.
The upstream implementation is Atomic-specific; this repository keeps its
provider and model-browser behavior while replacing the host boundary with
Senpi's public extension API.

## Install

```sh
omo install -l ./extensions/better-custom
```

The package manifest declares `src/index.ts` as its standalone entrypoint.

## Commands

- `/custom-provider` — add, edit, or delete providers in the active
  `models.json`;
- `/better-models` — browse authenticated native and custom models in one
  searchable view and switch models.

Both commands are interactive-only. Print, JSON, and RPC modes display a
notice and do not mutate configuration.

## Configuration

The extension resolves the active path through Senpi's `getAgentDir()`.
OMO sets `SENPI_CODING_AGENT_DIR` to `~/.omo/agent`, so the extension uses:

```text
~/.omo/agent/models.json
```

When the host is standalone Senpi, the normal Senpi agent directory is used.
JSON and OMP-compatible YAML locations are preserved where they already
exist. Writes use a temporary file followed by an atomic rename.

## Automatic model limits

On `session_start`, including reloads, configured custom OpenAI-completions and
OpenAI-responses providers refresh their context and output limits in memory.
The extension reads the authenticated model list and supplements it with
CLIProxyAPI's existing `GET /models?client_version=cpa` catalog. This also
improves discovery in the interactive provider wizard.

The catalog's `slug`, `context_window`, and `max_tokens` supply model identity,
effective context, and output capacity. `max_context_window` is a ceiling and
does not replace the effective context. Ordinary model-list metadata takes
precedence over supplemental catalog fields.

Startup uses native authentication, including resolved headers, with a
1.5-second timeout per request. Providers are probed concurrently; startup
skips detail and unrelated gateway routes. An unavailable catalog leaves
registered limits intact. Only already configured models present in the
authenticated list receive updates; model-specific endpoint/API overrides
retain their saved metadata. Unknown fields and thinking maps are preserved.
Senpi's explicit `modelOverrides` remain authoritative.

No model configuration is saved by automatic discovery. Native registration
refreshes the selected model as well as the model browser. A new session or
extension reload loads this behavior after updating the repository package.
No worker changes or service restart are required.

## Native thinking-level compatibility

Better Custom stores generic, per-model native `thinkingLevelMap` metadata. The
map has exactly these canonical OMO keys:

```text
off, minimal, low, medium, high, xhigh, max
```

Each key contains the provider-facing effort string or `null` when that level
is unavailable. For OpenAI-completions models, model-scoped
`compat.supportsReasoningEffort: true` enables the host's native mapped effort
field. Senpi and its model transport own request construction; Better Custom
persists and registers metadata and does not intercept or rewrite requests.

The static 9router profile is deliberately narrow. It matches provider ID
`9router` and only these exact model IDs:

| Model | Native map differences |
| --- | --- |
| `cx/gpt-5.6-luna` | `minimal → low`; `xhigh → max`; `max → max` |
| `cx/gpt-5.6-sol` | `minimal → minimal`; `xhigh → ultra`; `max → max` |
| `cx/gpt-5.6-terra` | `minimal → minimal`; `xhigh → ultra`; `max → max` |

All three profiles map `off → none`, retain `low`, `medium`, and `high`, and
set `supportsReasoningEffort` only on the matching model entry. Observed or
persisted model maps and compatibility metadata take precedence over profile
defaults. Other providers, model families, and unknown 9router IDs receive no
static profile.

## Compatibility

The repository SDK pin is Senpi `2026.11.2-3` with OMO `5.1.60`. The recorded integration
pairing and validation limits are in [compatibility](../../docs/compatibility.md).
The September native thinking-map capture remains historical evidence, not
a current authenticated request check. See
[`docs/upstream-validation.md`](../../docs/upstream-validation.md).

Do not replace the Senpi dependency with `@bastani/atomic`; that is the
upstream host for the original extension and is not part of OMO.

## Development

Run the repository gates from the repository root:

```sh
mise ci
```

The upstream source revision is recorded in
[the compatibility guide](../../docs/compatibility.md#upstream-import-boundary) and should be
updated deliberately when importing future upstream changes.
