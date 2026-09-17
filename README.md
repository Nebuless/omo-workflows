# OMO Workflows

Portable OMO/Senpi customizations. Install native OMO first, then install this
repository or one extension package.

- Native OMO: [`omo-ai`](https://www.npmjs.com/package/omo-ai) beta
- Runtime pin: Senpi `2026.9.13`
- Included packages: [`compound-engineering`](extensions/compound-engineering/README.md), [`better-custom`](extensions/better-custom/AGENTS.md),
  [`herdr`](extensions/herdr/AGENTS.md), [`model-routing-advisor`](extensions/model-routing-advisor/README.md), and [`trim`](extensions/trim/AGENTS.md)

## Install with an LLM handoff

Paste this into coding agent:

```text
Install native OMO and Nebuless/omo-workflows.

1. Read official OMO install guide end to end:
   https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/refs/heads/dev/docs/guide/installation.md
2. Install native Senpi OMO exactly as guide says:
   npm i -g omo-ai@beta
   omo setup
3. Ask me before provider login, credential import, permission changes, or any
   external write the guide requires.
4. Clone https://github.com/Nebuless/omo-workflows.git, run its documented
   local checks, then install only package I select. Use `omo install -l .` for
   all repository extensions or `omo install -l ./extensions/<name>` for one.
5. Verify extension discovery in a live OMO session. Read repository docs:
   https://github.com/Nebuless/omo-workflows/blob/main/README.md
   https://github.com/Nebuless/omo-workflows/blob/main/docs/customization-scaffolding.md
   https://github.com/Nebuless/omo-workflows/blob/main/docs/authoring-extensions.md
```

Guide requires `@beta`. Do not install unrelated npm package named `omo`.

## Install manually

### 1. Install native OMO

Follow upstream [Senpi edition guide](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/installation.md#senpi-edition-beta-omo-via-npm-omo-ai):

```sh
npm i -g omo-ai@beta
omo setup
```

`omo setup` detects existing provider credentials and asks before importing
supported API keys. See upstream [setup details](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/installation.md#first-run-omo-setup).

### 2. Get this repository

```sh
git clone https://github.com/Nebuless/omo-workflows.git
cd omo-workflows
mise bootstrap
mise install
bun install --frozen-lockfile
mise ci
```

### 3. Install extensions

Each Worktrunk worktree owns its own `node_modules`. After `wt switch` creates
or opens a worktree, run this before launching OMO there:

```sh
bun install --frozen-lockfile
```

Without it, a worktree can retain stale dependencies and fail to load an
extension added by a newer commit. Choose scope before installing. `-l` is
project-local: OMO loads it only when started inside that project. Omit `-l`
for fresh OMO agents in every directory.

```sh
# Global: load all repository extensions in every fresh OMO agent
omo install .

# Project-local: load only while OMO starts in this repository
omo install -l ./extensions/compound-engineering
omo install -l ./extensions/better-custom
omo install -l ./extensions/herdr
omo install -l ./extensions/model-routing-advisor
omo install -l ./extensions/trim
```

Check installed packages with `omo list`. Restart OMO or run `/reload` in
interactive OMO. See [extension authoring and verification](docs/authoring-extensions.md).

## Choose customization path

| Need | Start here |
|---|---|
| Find available OMO/Senpi customization boundaries | [Customization catalog](docs/customizations.md) |
| Choose folder, policy, and runtime owner | [Customization scaffolding](docs/customization-scaffolding.md) |
| Add one installable extension | [Authoring extensions](docs/authoring-extensions.md) |
| Configure global rules and prompt overlays | [Global instructions](docs/customizations.md#global-agent-instructions) |
| Configure providers and model routing | [Model matrix and profiles](docs/model-matrix.md) |
| Set up or troubleshoot delegated work | [OMO/Senpi subagents](docs/omo-subagents.md) |
| Configure OMO preferences or repair runtime gaps | [Runtime repairs](docs/runtime-repairs.md) |
| Check OMO/Senpi version-sensitive claims | [Upstream validation](docs/upstream-validation.md) |
| Review native OMO configuration | [OMO configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/configuration.md) |
| Build Senpi extension behavior | [Senpi extension guide](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/extensions.md) |

## Included packages

- [`extensions/compound-engineering`](extensions/compound-engineering/README.md): Every's 35 Compound Engineering skills through native Senpi discovery. Use `/skill:<name>` for deterministic invocation.
- [`extensions/better-custom`](extensions/better-custom/AGENTS.md): custom provider CRUD and model browser commands.
- [`extensions/herdr`](extensions/herdr/AGENTS.md): Herdr lifecycle reporting, skills, and argv-only resource tools. No-op outside Herdr.
- [`extensions/model-routing-advisor`](extensions/model-routing-advisor/README.md): explicit read-only route availability reports before native work. No routing or task control.
- [`extensions/trim`](extensions/trim/AGENTS.md): native compaction governor.

## Repository operations

- [Compatibility and upstream provenance](docs/compatibility.md)
- [LSP setup](docs/lsp.md)
- [Model routing policy](docs/model-routing.md)
- [OMO/Senpi subagent setup and troubleshooting](docs/omo-subagents.md)
- [Model matrix and portable profiles](docs/model-matrix.md)
- [Release procedure](docs/releasing.md)
- [Customization policies](customizations/AGENTS.md)
- [Root repository contract](./AGENTS.md)

`mise ci` is complete local validation. `mise run configure-omo-preferences`
merges portable preferences without overwriting existing settings. See
[template contract](templates/AGENTS.md).

Upstream source: [Oh My OpenAgent](https://github.com/code-yeongyu/oh-my-openagent).
