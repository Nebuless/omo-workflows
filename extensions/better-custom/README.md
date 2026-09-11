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

## Compatibility

The port is tested against:

```text
omo-ai 5.0.0-0.beta.53
@code-yeongyu/senpi 2026.9.10-2
```

Do not replace the Senpi dependency with `@bastani/atomic`; that is the
upstream host for the original extension and is not part of OMO.

## Development

Run the repository gates from the repository root:

```sh
mise ci
```

The upstream source revision is recorded in the root README and should be
updated deliberately when importing future upstream changes.
