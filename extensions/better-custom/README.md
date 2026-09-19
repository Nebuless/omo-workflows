# Better Custom for OMO

This is the OMO/Senpi adapter of the
[`better-custom`](https://tangled.org/expi.tngl.sh/solu-atomic) extension.
The upstream implementation is Atomic-specific; this repository keeps its
provider and model-browser behavior while replacing the host boundary with
Senpi's public extension API.

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

Current verification uses OMO `5.0.0-0.beta.75` with engine Senpi
`2026.9.18-4` and repository Senpi `2026.9.13`. The original port baseline,
OMO `5.0.0-0.beta.53` with Senpi `2026.9.10-2`, remains historical only. See
[`docs/upstream-validation.md`](../../docs/upstream-validation.md) for current
runtime and capture evidence.

Do not replace the Senpi dependency with `@bastani/atomic`; that is the
upstream host for the original extension and is not part of OMO.

## Development

Run the repository gates from the repository root:

```sh
mise ci
```

The upstream source revision is recorded in the root README and should be
updated deliberately when importing future upstream changes.
