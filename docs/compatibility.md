# OMO/Senpi Compatibility

## Runtime relationship

`omo-ai@beta` is the OMO distribution layer. It launches a pinned
`@code-yeongyu/senpi` runtime and loads OMO's bundled plugin. The current local
versions are:

```text
omo-ai                  5.0.0-0.beta.53
@code-yeongyu/senpi     2026.9.10-2
```

The OMO launcher sets `OMO_CODING_AGENT_DIR` and
`SENPI_CODING_AGENT_DIR` to OMO's canonical agent directory. Extensions must
resolve runtime files through Senpi's `getAgentDir()` instead of hard-coding a
home-directory path.

## Upstream import boundary

The source repository for `better-custom` is:

```text
https://tangled.org/expi.tngl.sh/solu-atomic
revision: bf3589e402f80535afd3543344c01c937b4b4412
```

The upstream extension imports `@bastani/atomic` and
`@bastani/pi-ai/providers/all`, so it is Atomic-specific and cannot be loaded
directly by OMO/Senpi. This repository vendors the source under the upstream
MIT license and replaces those host boundaries with:

```text
@code-yeongyu/senpi
@earendil-works/pi-ai/providers/all
@earendil-works/pi-tui
```

The extension's domain behavior remains separate from the host adapter:

- config persistence uses Senpi's `getAgentDir()`;
- provider registration uses Senpi's `ExtensionAPI`;
- model catalog access uses Senpi's `pi-ai` provider exports;
- interactive UI uses Senpi's `pi-tui` alias.

## Package contract

The root `package.json` uses Senpi's standard `pi.extensions` resource key.
OMO's installer accepts the local package and writes the project-local
`.omo/settings.json` entry:

```json
{
  "packages": [".."]
}
```

This keeps the source in the repository and avoids copying generated package
state into the repository.

## Verification contract

The compatibility gate must prove all of the following:

1. The manifest points to the extension entrypoint and pins Senpi.
2. TypeScript resolves the public Senpi extension API.
3. The extension factory registers `/custom-provider` and `/better-models`.
4. Config writes remain atomic and preserve unknown fields.
5. The source bundles through Bun.
6. OMO can install and list the project package.
7. `mise ci` runs the full test, build, Biome parse, and Qlty gate.

## Tooling policy

- mise is the tool manager and task runner.
- Bun installs JavaScript dependencies.
- Qlty is the repository-wide quality gate.
- Biome performs parser validation without mutating files.
- prek owns `pre-commit` and `pre-push`.
- Worktrees are managed only with `wt`.
