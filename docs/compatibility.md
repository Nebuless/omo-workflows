# OMO/Senpi Compatibility

## Runtime relationship

`omo-ai` is the OMO distribution layer. It launches a pinned
`@code-yeongyu/senpi` runtime and loads OMO's bundled plugin. The target OMO
release pairing is:

```text
omo-ai                  5.1.34
@code-yeongyu/senpi     2026.10.16
```

Standalone Senpi `2026.10.16-3` is newer but is not the runtime paired with
OMO 5.1.34. Dependencies and `bun.lock` match that pairing. The root package
exposes Better Custom, Compound Engineering, Herdr, Model Routing Advisor, and
Trim. Native OMO owns workflow scheduling and graph presentation; the duplicate
workflow extension and its repair scripts and tests are removed.

Extension resources resolve from the host-provided `loadedExtensionPaths`,
not a source-checkout or synthetic module URL. `mise ci` is the compatibility
gate for the integrated checkout. Dated runtime checks and their limits live in
[upstream validation](upstream-validation.md).

The OMO runtime directory resolver honors explicit environment overrides for
`OMO_CODING_AGENT_DIR` and `SENPI_CODING_AGENT_DIR`. Do not assume the launcher
always sets both variables. Extensions should use Senpi's `getAgentDir()` rather
than hard-code a home-directory path.

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
`omo install -l` registers the package for the current project in
`.omo/settings.json`. Without `-l`, `omo install` registers it globally:

```json
{
  "packages": [".."]
}
```

This keeps the source in the repository and avoids copying generated package
state into the repository.

## Verification contract

The compatibility gate must prove all of the following before claiming full
checkout compatibility:

1. The manifest points to the extension entrypoint and pins Senpi.
2. TypeScript resolves the public Senpi extension API.
3. The extension factory registers `/custom-provider` and `/better-models`.
4. Config writes remain atomic and preserve unknown fields.
5. The source bundles through Bun.
6. OMO can install and list the project package.
7. `mise ci` runs the full test, build, Biome parse, and Qlty gate.

Live provider authentication and credential-backed mutations are separate from
the repository gate and are not established by a passing build or unit suite.

## Tooling policy

- mise is the tool manager and task runner.
- Declare required CLI tools, including Biome, in `mise.toml`; install with
  `mise install`. Run project dependency installation with `mise exec -- bun install`.
- Qlty is the repository-wide quality gate.
- Biome performs parser validation without mutating files.
- prek owns `pre-commit` and `pre-push`.
- Worktrees are managed only with `wt`.
