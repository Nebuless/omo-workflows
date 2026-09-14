# OMO Workflows

Portable OMO/Senpi customizations. Install native OMO first, then install this
repository or one extension package.

- Native OMO: [`omo-ai`](https://www.npmjs.com/package/omo-ai) beta
- Runtime pin: OMO `5.0.0-0.beta.53`, Senpi `2026.9.10-2`
- Included packages: [`compound-engineering`](extensions/compound-engineering/README.md), [`better-custom`](extensions/better-custom/AGENTS.md),
  [`herdr`](extensions/herdr/AGENTS.md), [`trim`](extensions/trim/AGENTS.md), and
  [`workflow-graph`](extensions/workflow-graph/AGENTS.md)

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

# Global: load workflow graph only in every fresh OMO agent
omo install ./extensions/workflow-graph

# Project-local: load only while OMO starts in this repository
# One extension only
omo install -l ./extensions/compound-engineering
omo install -l ./extensions/better-custom
omo install -l ./extensions/herdr
omo install -l ./extensions/trim
omo install -l ./extensions/workflow-graph
```

Check installed global packages with `omo list`. Restart OMO or run `/reload`
in interactive OMO, then run `/workflow-run list`; it must show
`repo-to-extension`. See [extension authoring and verification](docs/authoring-extensions.md).

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
- [`extensions/better-custom`](extensions/better-custom/AGENTS.md): custom
  provider CRUD and model browser commands.
- [`extensions/herdr`](extensions/herdr/AGENTS.md): Herdr lifecycle reporting,
  skills, and argv-only resource tools. No-op outside Herdr.
- [`extensions/trim`](extensions/trim/AGENTS.md): native compaction governor.
- [`extensions/workflow-graph`](extensions/workflow-graph/AGENTS.md): Native
  OMO DAG overlay with explicit dependency edges, stale/truncation state, node
  detail, and capability-gated workflow controls. `/workflow-graph` opens the
  overlay in TUI mode. `/workflow-runs [name-or-ID]` selects a known run in the
  current session, active runs first. Arrows select spatial neighbors, `j`/`k`
  select in node order, `v` changes orientation, and PageUp/PageDown scroll.
  `/workflow-graph-pane` opens or reopens an observer-only
  right pane only inside Herdr. The pane receives a redacted normalized state
  file, never scheduler state or task prompts. Controls appear only when OMO's
  live `workflow` tool schema supports them. When live `task_output` exposes
  only its `status` schema, selected task status can be requested without
  loading a transcript. Cancellation always asks for confirmation and no
  action changes graph state before OMO emits an update.
  Atomic and `omo-herdr-dag` provenance and licenses are in the package.
  Full workflow-system coverage and remaining native API gaps are tracked in
  [`PARITY.md`](extensions/workflow-graph/PARITY.md); graph support alone is not
  Atomic workflow parity.

### Staged workflows

Enable explicit [native runtime hooks](docs/runtime-repairs.md#optional-staged-workflow-runtime-hooks)
first, then restart OMO with a persisted session. Journal flush is required for
staged launches; DAG presentation and fullscreen mouse repairs enable those UI
paths. Repairs are check-only unless invoked with `--apply`.

In OMO:

```text
/workflow-run
/workflow-run fan-out-and-synthesize {"prompt":"Compare two local implementation options","max_branches":2}
/workflow-run status
/workflow-run answer
/workflow-run resume
```

Picker lists discovered programs plus all nine Atomic builtins. `/workflow-run list`
shows source metadata and diagnostics; `/workflow-run reload` refreshes source
files and settings without restarting OMO. Input keys and defaults live in
[schemas.ts](extensions/workflow-graph/src/builtins/schemas.ts).

`workflow_recommend` accepts one current catalog revision and one to five unique
`{key, digest, rationale, confidence}` proposals. It validates all proposals as
one set and never starts, amends, cancels, answers, or rewrites a prompt. Accepted
advice is session-local, appears in `workflow-recommendations` for UI sessions,
and clears when agent settles. `workflow_program start` requires
`selection:{key,revision,digest}` and inputs. It rejects key-only model starts;
`/workflow-run <key> <JSON>` obtains exact current identity before launch. A stale
selection returns `Workflow catalog changed; choose again.` and starts no native
workflow. `workflow_program` exposes `list`, `reload`, `start`, `resume`,
`status`, `answer`, confirmed `cancel`, and confirmed `transfer`. Human answers
require explicit choice. Explicit start creates a new instance; resume restores
journaled instance and completed tasks.

Discovery precedence: configured project, .omo/workflows, configured global,
agentDir/workflows, installed packages, bundled. First key wins; duplicate,
config, import, and path errors remain visible. Use native project/global
settings with extension-owned configuration:

```json
{"workflowGraph":{"programs":{"project":{"review":"workflows/review.ts"}}}}
```

Project paths resolve from project cwd; global settings use `global` instead
of `project` and resolve from agentDir. Both scopes accept `package` paths.
Native configured installed packages may declare `pi.workflows` arrays or named
maps relative to their package root. Discovery never installs packages or loads
project sources without trust. Resume a discovered module with
`/workflow-run resume <catalog-key>`.


Trusted project modules export `program: StagedProgram` and launch with
`/workflow-run ./path/to/program.ts {"input":"value"}`. Deterministic `decide`
returns a typed wave, gate, or final result; only admitted results unlock the
next same-run amendment. `composeStagedPrograms()` combines predeclared stages
into one instance, artifact root, checkpoint stream, and native run. It namespaces
stage nodes and maps admitted final values through declared RFC 6901 pointers.
An unapproved boundary stops at `continue` or `stop`; composition is not a
cross-run continuation. After restart, use `/workflow-run resume ./path/to/program.ts`
to reload authored code explicitly. See [authoring contract](extensions/workflow-graph/src/authoring/AGENTS.md)
and [execution types](extensions/workflow-graph/src/execution/policy.ts).

Artifacts live under `.omo/workflow-artifacts/<instance>`. A terminal transfer
uses `/workflow-run transfer` or `workflow_program` action `transfer`; the
command obtains native UI confirmation, while the tool requires explicit
`confirmed:true`. Both need current destination selection identity and a declared
TerminalTransfer v1 manifest. Only current or restored completed staged source
runs qualify. Extension checks source run/key/fingerprint, regular-file paths,
size, SHA-256, schema, declared mapping, and copied bytes. It records durable
intent before one distinct destination launch. Source run stays byte-for-byte
unchanged. Transfer is a verified fresh launch, not native continuation or
cross-session history search. Linux descriptor-relative copying limits same-UID
filesystem races, but cannot make arbitrary concurrent hostile replacement an
atomic compare-and-unlink operation. Live design review
requires explicitly installed pinned Impeccable helpers through
`OMO_IMPECCABLE_SCRIPTS`; [helper setup](extensions/workflow-graph/src/design-review/README.md)
explains the boundary. Helper download never runs at launch. Final display tries
Playwright CLI, permits one missing-browser install/retry, and returns truthful
availability plus manual opening instructions. Native 64-node capacity,
per-node tool policy, attached stage chat, and Atomic SDK differences remain
explicit in [parity matrix](extensions/workflow-graph/PARITY.md).


`repo-to-extension` accepts only canonical public HTTPS owner/repository URLs.
It rejects whitespace, backslashes, percent escapes, credentials, ports, query,
fragment, IP and local hosts, and paths other than two segments. It lowercases
host and removes one trailing slash while preserving path case and `.git`.
Parsing does not prevent SSRF, DNS rebinding, redirects, Git configuration,
hooks, submodules, credential-helper use, resource exhaustion, or repository-code
execution. Inspection remains an untrusted-data boundary.

### Isolated workflow-graph QA

Run graph QA from a disposable Herdr tab. Start OMO with native extension
loading disabled, then load only OMO host support plus these two project
entrypoints:

```sh
omo --no-extensions \
  -e "$HOME/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo.js" \
  -e ./extensions/better-custom/src/index.ts \
  -e ./extensions/workflow-graph/src/index.ts
```

In the disposable OMO pane, use `/workflow-graph` for overlay and
`/workflow-graph-pane` for the right observer pane. Check loaded extension
inventory before task work. Do not run this command in an existing user tab;
cleanup only IDs returned while creating QA tab and panes.

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
