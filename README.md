# OMO Workflows

Portable customizations for the OMO native agent.

This repository packages a native Senpi extension adapted from
`expi.tngl.sh/solu-atomic`'s `better-custom` extension. The upstream extension
targets Atomic and imports `@bastani/atomic`; this port targets the exact
Senpi engine pinned by the installed OMO beta package:

- `omo-ai`: `5.0.0-0.beta.53`
- `@code-yeongyu/senpi`: `2026.9.10-2`
- upstream source revision: `bf3589e402f80535afd3543344c01c937b4b4412`

## Included customization

`extensions/better-custom` provides:

- `/custom-provider` to add, edit, and delete custom providers in the active
  `models.json`;
- `/better-models` to browse native and custom models and switch models;
- atomic config writes, API-key reference handling, endpoint probing, and
  model metadata discovery.

The extension uses Senpi's `getAgentDir()` boundary. When launched through
`omo`, the launcher sets `SENPI_CODING_AGENT_DIR` to OMO's canonical
`~/.omo/agent` directory, so the extension reads and writes the same
`models.json` used by OMO.

## Local development

mise owns the repository toolchain and task runner. Bun remains the JavaScript
package installer because mise manages tools and tasks, not package manifests.

```sh
mise bootstrap
mise install
bun install --frozen-lockfile
mise ci
```

The CI task runs package validation, TypeScript checks, tests, and the native
Senpi bundle build. `mise ci` is the local source of truth; do not add a
second task runner for aliases.

## Install into OMO

For a one-run smoke test:

```sh
omo -e .
```

For a project-local package installation:

```sh
omo install -l .
```

Use `/reload` after installation inside an interactive OMO session. The
package manifest uses Senpi's standard `pi.extensions` resource key, so the
same repository can be loaded by Senpi-compatible hosts without an OMO-only
installer shim.

## Quality gates

- `mise ci` is the complete local CI gate.
- `prek` owns `commit-msg`, `pre-commit`, and `pre-push` shims.
- `qlty` performs formatting and quality checks.
- Conventional Commits drive SemVer recommendations and generated
  `CHANGELOG.md` history. Run `mise run version-recommend` before release
  review and `mise run changelog` after choosing a version.
- `mise run repair-omo-comment-checker` repairs OMO's missing global checker
  dependency when its bundled extension cannot resolve it.
- mise installs pinned TypeScript and TOML LSP tools; see
  [`docs/lsp.md`](docs/lsp.md) for OMO configuration and verification.
- Worktrees are managed only with `wt`; raw `git worktree` commands are not
  part of the repository workflow.

## Runtime model routing

This workstation routes main and heavy OMO work to installed `9router/cx/*`
models. Light work and fallbacks use installed `9router/ollama-cloud/*` models.
See [`docs/model-routing.md`](docs/model-routing.md). Credentials and provider
endpoints remain outside this repository.

## Attribution

The adapted extension retains the upstream MIT license and attribution in
`extensions/better-custom/LICENSE`.
