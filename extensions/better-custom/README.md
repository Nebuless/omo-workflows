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

The target pairing is:

```text
omo-ai 5.1.34
@code-yeongyu/senpi 2026.10.16
```

The package manifest and standalone package check were updated for this pair.
Its extension-load test, provider/command regression tests, typecheck, and build
pass. Installed OMO RPC loaded Better Custom without extension errors.
Credential-backed provider mutation was not exercised. Repository CI retains
three historical repair failures unrelated to this extension; see
[compatibility](../../docs/compatibility.md). Standalone Senpi `2026.10.16-3`
is not this OMO pair.

Do not replace the Senpi dependency with `@bastani/atomic`; that is the
upstream host for the original extension and is not part of OMO.

## Development

Run the repository gates from the repository root:

```sh
mise ci
```

The upstream source revision is recorded in the root README and should be
updated deliberately when importing future upstream changes.
