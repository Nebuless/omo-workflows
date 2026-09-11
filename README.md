# OMO Workflows

Portable customizations for the OMO native agent.

This repository packages a native Senpi extension adapted from
`expi.tngl.sh/solu-atomic`'s `better-custom` extension. The upstream extension
targets Atomic and imports `@bastani/atomic`; this port targets the exact
Senpi engine pinned by the installed OMO beta package:

- `omo-ai`: `5.0.0-0.beta.53`
- `@code-yeongyu/senpi`: `2026.9.10-2`
- upstream source revision: `bf3589e402f80535afd3543344c01c937b4b4412`

## Customization catalog

See [`docs/customizations.md`](docs/customizations.md) for current packages and
planned customization domains. See
[`docs/authoring-extensions.md`](docs/authoring-extensions.md) for modular,
individually installable extension rules.

## Included customizations

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

`extensions/herdr` is an independent lifecycle integration for OMO running in
Herdr. It reports semantic `working`, `idle`, and `blocked` states to the
containing pane, labels the agent as `omo`, and releases authority when OMO
quits. It activates only when Herdr supplies `HERDR_ENV=1` and
`HERDR_PANE_ID`; outside Herdr it is a no-op.

The extension also contributes native Herdr skills for core resources, one
agent, ownership handoff, multi-agent orchestration, and administration. Its
LLM tools are `herdr_inspect` for read-only CLI argv and `herdr_control` for
explicit control from a Herdr pane. Both accept argv only, not shell text;
`herdr_control` requires confirmed Herdr context and instructions require
readback before mutation. Destructive or privileged actions still require user
intent. Current Herdr releases do not provide OMO session restoration, so this
extension does not claim resume support.

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

Install only the Herdr integration:

```sh
omo install -l ./extensions/herdr
```

Use `/reload` after installation inside an interactive OMO session. Each
individually installable extension has its own manifest using Senpi's standard
`pi.extensions` resource key. See
[`docs/authoring-extensions.md`](docs/authoring-extensions.md) before adding
an extension package.

## Apply portable preferences

This repository ships a merge-safe global OMO settings template that disables
all native `Tip:` widgets. Apply it after cloning or installing OMO:

```sh
mise run configure-omo-preferences
```

The task merges [`templates/omo-agent-settings.json`](templates/omo-agent-settings.json)
into `~/.omo/agent/settings.json`; existing settings remain intact. Restart OMO
after it finishes. See [`docs/runtime-repairs.md`](docs/runtime-repairs.md) for
the obsolete `codegraph` config cleanup.

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
- `mise run configure-omo-preferences` merges the portable
  [`tips: false`](templates/omo-agent-settings.json) setting into global OMO
  preferences. See [`docs/runtime-repairs.md`](docs/runtime-repairs.md).
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
