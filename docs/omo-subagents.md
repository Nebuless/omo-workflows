# OMO and Senpi Subagents

Use this guide to configure, verify, and repair delegated OMO/Senpi work. It covers built-in named agents, task categories, model routes, custom providers, and extension-added capabilities.

## Mental model

A parent session delegates in two ways:

- **Named agent**: `explore`, `librarian`, and other registered agent IDs. Named agents carry a role prompt and resolve their own model chain.
- **Category**: a `task()` call with a category such as `quick`, `deep-low`, or `writing`. Categories route work by kind, not by agent name.

A configured OMO `models` chain is ordered. First entry is primary; later entries can be selected during child admission or model resolution, including capacity pressure. Senpi retry fallback chains are separate, per-process runtime retry state. A task must resolve to both an available model and valid credentials before it starts. Crossing providers at either stage changes the data boundary; document and approve that decision before routing real task content.

Native OMO owns task sessions, processes, retries, cancellation, output delivery, and DAG scheduling. Extensions may observe, gate, or present that state, but must not replace scheduler ownership. Current native task schema cannot express Atomic-style per-stage tool/context policy or worktree delegation.

This workstation uses Native OMO with Senpi. Put agent and category routes at
shared top level; `[native]` holds optional native-only overrides. OpenCode and
Codex harness configuration does not apply here.

## Config locations and precedence

Use one unified JSONC file:

```text
~/.omo/omo.jsonc                 # global user configuration
.omo/omo.jsonc                   # project configuration
```

OMO walks `.omo/omo.jsonc` layers from ancestor to working directory; nearest project layer wins and overrides user configuration. Native resolves shared keys, then `[native]`, then active profile and its `[native]` block. No named config profile is active on this workstation.

Use shared top-level `categories` and `agents`. Agent personas, config-layer
`profiles`, and main-session `model_profiles` are different features; this guide
configures subagent personas, not main-session model selection.

```jsonc
{
  "categories": {
    "quick": {
      "model": "9router/cx/gpt-6-luna",
      "reasoning": "low"
    },
    "deep-low": {
      "model": "9router/cx/gpt-6-sol",
      "reasoning": "medium"
    }
  },
  "agents": {
    "explore": {
      "model": "9router/cx/gpt-6-luna",
      "reasoning": "medium"
    },
    "librarian": {
      "model": "9router/cx/gpt-6-sol",
      "reasoning": "xhigh"
    }
  }
}
```

`librarian` is built-in research agent. There is no separate built-in `researcher` ID. Custom agent keys create user-defined agents; only use them after giving them a clear role prompt, tool policy, and model chain.

Do not put secrets, endpoint URLs, or local machine paths in project configuration. Keep global credentials in provider setup and extension configuration.

## Built-in routing surfaces

### Named agents

Current OMO built-ins include:

| ID | Use | Global model | Reasoning |
|---|---|---|---|
| `explore` | discovery and extraction | `9router/cx/gpt-6-luna` | `medium` |
| `librarian` | research and source-backed lookup | `9router/cx/gpt-6-sol` | `xhigh` |
| `plan-consultant` | plan-gated design work | `9router/cx/gpt-6-astra` | `xhigh` |
| `plan-reviewer` | plan-gated review | `9router/cx/gpt-6-sol` | `high` |
| `omo-native-code-reviewer` | code-quality report | `9router/cx/gpt-6-sol` | `high` |
| `omo-native-gate-reviewer` | final evidence audit | `9router/cx/gpt-6-astra` | `xhigh` |
| `omo-native-qa-executor` | real-surface QA evidence | `9router/cx/gpt-6-sol` | `high` |

Each row configures `agents.<ID>` in `~/.omo/omo.jsonc`. All seven retain native
in-process execution and upstream prompts/tool policies. First four are curated
read-only profiles; reviewer trio can write report artifacts. Planning profiles
remain gated by the explicit `ulw-plan` workflow; configuring a model does not
authorize spawning them outside that workflow.

Before explicit pins, code reviewer inherited `unspecified-high` (Sol `high`),
gate reviewer inherited `deep-high` (subscription Astra `xhigh`), and QA inherited
`deep-low` (Astra `max`). Explicit pins keep every role on 9router. No subscription
fallback is configured; its models remain authenticated alternatives.

Built-in agents retain their curated role and in-process execution. OMO's `task.default_execution_mode` defaults to `in-process`; custom agents can use `in-process` or `process`, but curated built-ins remain in-process. Override only fields needed for model, reasoning, or policy. Other agent keys create custom agents. Keep each custom agent narrow, with explicit prompt, model chain, permissions, tool limits, turn limit, execution mode, and delegation depth. Treat availability as runtime state: inspect the task tool schema and loaded extension inventory in the session that will launch work.

### Categories

Built-in categories route delegated work by task kind:

| Category | Use |
|---|---|
| `quick` | small, bounded tasks |
| `unspecified-low` | ordinary contained work |
| `unspecified-high` | broad or high-effort work |
| `writing` | documentation and prose |
| `visual-engineering` | UI, styling, visual QA |
| `artistry` | unconventional or creative work |
| `deep-low` | evidence-led browser, backend, algorithms, investigation |
| `deep-high` | escalation for decisions evidence cannot settle |
| `architect` | architecture consultation |
| `ultrabrain` | hard reasoning and architecture |

This repository adds shared `memory-reflection` for OMO reflection and Kibitzer recall. Keep it at shared top level, then select it explicitly:

```jsonc
{
  "categories": {
    "memory-reflection": {
      "model": "9router/cx/gpt-6-luna",
      "reasoning": "xhigh"
    }
  },
  "memory": {
    "reflection": { "category": "memory-reflection", "sandbox": "off" },
    "recall": { "category": "memory-reflection" }
  }
}
```

`memory.reflection.sandbox: "off"` is temporary local workaround for known Linux `bwrap` directory failure. See [issue register](issues.md#2026-09-11t215541z---memory-reflection-fails-before-child-launch) before changing it.

## Setup procedure

Current global routes have a portable replacement template at
[`templates/omo.jsonc.native-9router`](../templates/omo.jsonc.native-9router).
It omits local `_migrations` bookkeeping and provider credentials. After
checking `omo --list-models 9router`, merge its `agents`, `categories`, and
`memory` keys into an existing `~/.omo/omo.jsonc`, preserving unrelated keys
such as `_migrations`; use the whole file only for a fresh global config.
Restart OMO to load the new routes.

1. Install OMO and complete provider authentication. Follow repository [installation](../README.md#install-manually).
2. List models from provider before writing a route:

   ```sh
   omo --list-models 9router
   ```

3. Edit `~/.omo/omo.jsonc` for global behavior, or nearest `.omo/omo.jsonc` for one project.
4. Configure named agents under shared `agents`; configure categories under shared `categories`.
5. Use full canonical model IDs: `9router/cx/gpt-6-luna`, not aliases or display names.
6. Include only fallbacks that are present in catalog and have working credentials.
7. Start a new OMO/Senpi session. A running task launcher may retain routes resolved at startup. `/reload` hot-reloads only auto-discovered extension paths; settings-package and `-e` resources need restart unless runtime proves otherwise. Use fresh session for route smoke tests.
8. Launch one harmless named-agent task and one category task. Confirm reported agent/category and resolved model match configuration.

Historical portable profiles:

- [`templates/omo.jsonc.gpt-heavy`](../templates/omo.jsonc.gpt-heavy)
- [`templates/omo.jsonc.balanced`](../templates/omo.jsonc.balanced)

Neither template is current workstation configuration. Verify every model before
copying one; these files are complete replacements, not fragments to merge blindly.

## Validation and smoke checks

### Static checks

```sh
omo --list-models 9router
bun test test/omo-preferences.test.ts
```

First command proves catalog visibility, not credentials. Second validates repository portable-profile shape, not user-local `~/.omo/omo.jsonc`.

Parse user JSONC before restarting. JSONC permits comments and trailing commas, so plain `JSON.parse` needs a comment-aware parser or a temporary comment-free copy.

### Live checks

Use bounded prompt with no file edits or external actions. Run it from a new session:

```text
Perform one bounded smoke check. Reply exactly: SMOKE PASS: explore.
Do not read or edit files, invoke tools, or delegate.
```

Verify all three facts from result metadata, not response text alone:

1. status is `completed`;
2. named agent or category is expected route;
3. resolved model and reasoning match first usable configured chain entry.

Test a failure path too: choose an unavailable provider only in a disposable test config, or remove a temporary credential. Confirm error names missing provider or credential instead of silently falling back to an unexpected model. Restore working config immediately.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `No active credentials for provider` | configured provider has no authenticated credential | Authenticate that provider or remove it from route. Restart session and rerun smoke task. |
| `model_not_found` or unavailable model | wrong model ID, stale catalog, unsupported provider | Run `omo --list-models <provider>`; copy returned canonical ID. Do not invent fallback ID. |
| Child uses model from wrong provider | native route missing or harness scope wrong | Put categories and named-agent overrides at shared top level or in `[native]`. |
| Current task ignores edited route | task launcher loaded config before edit | Start fresh OMO/Senpi session; then rerun smoke task. |
| Named agent still uses default chain | wrong agent ID or config layer overridden by project/profile | Check exact built-in ID, nearest `.omo/omo.jsonc`, selected profile, and final merged config. |
| `/reload` does not expose extension | extension not in trusted auto-discovery path, package not installed, or session lacks project trust | Install extension at global/project scope, confirm package discovery, then `/reload` or restart. |
| `/custom-provider` cannot run | command needs interactive TUI | Launch interactive OMO. Noninteractive, print, JSON, and RPC modes cannot use provider wizard. |
| Custom provider loaded but model cannot switch | endpoint, key, API style, or model metadata invalid | Use `/better-models`; verify provider URL, credential source, selected API style, and discovered model ID. |
| Reflection fails with `bwrap` missing `reflection-sessions` | known sandbox bind-path defect on Linux | Keep documented `memory.reflection.sandbox: "off"` workaround until upstream fix is installed and verified. |

Never solve route failure by adding blind fallback chains. First prove model ID is catalog-visible and provider credential is active. A fallback hides root cause and can run work under unintended cost, capability, or data boundary.

## Workflow and task controls

For ordinary delegated work, the active `task` tool exposes task launch, output/status, steering, and cancellation. Inspect its live schema rather than copying parameters from an older session or a different harness. Read status before a control action. Cancellation is destructive task control; require explicit user confirmation.

When caller needs availability evidence before a native launch, use the optional
[`model-routing-advisor`](../extensions/model-routing-advisor/README.md) tool
explicitly. Pass caller-normalized candidate IDs and retain its report or
reference before direct task, workpool, team, mass/DAG, or ULW launch. It has no
universal hook and never chooses a model, changes route order, or controls a
task. See [model routing preflight](model-routing.md#explicit-route-advice-preflight).

## Custom providers and extension-added capabilities

Subagent routing accepts any provider/model registered in active OMO/Senpi runtime. Native providers come from OMO setup and provider credentials. Extensions may register providers, models, tools, commands, skills, task agents, or custom categories. Therefore a provider list is runtime inventory, not fixed repository policy.

In-process task children do not load extension-declared MCP servers. Do not route a task to an extension-only MCP capability until live child evidence proves that capability is injected for its execution mode.

This repository's [`better-custom`](../extensions/better-custom/README.md) extension adds:

- `/custom-provider` interactive provider CRUD;
- `/better-models` unified native/custom authenticated model browser;
- custom providers persisted through Senpi `getAgentDir()`;
- OMO default provider location `~/.omo/agent/models.json`.

Supported custom-provider API styles are `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`, and `ollama-chat`. Provider wizard validates input at its external boundary, preserves unknown configuration fields, and writes atomically.

Install only trusted extensions. Senpi extensions run with full system permissions. A package can add a provider dynamically at startup, so check its source, declared dependencies, configuration location, network behavior, and permissions before enabling it. `pi.registerProvider()` with `models` replaces existing catalog models for that provider; extension authors must preserve intended native models or use new provider ID.

### Add provider safely

1. Install extension globally or project-locally. See [extension authoring](authoring-extensions.md#manifest-and-installation).
2. Restart OMO or run `/reload` when extension uses supported discovery paths.
3. Run `/custom-provider` in interactive TUI and add endpoint, credential source, API style, and model metadata.
4. Run `/better-models` and confirm model appears as authenticated.
5. Add exact `provider/model` to one named-agent or category chain.
6. Start new session and run bounded smoke task.
7. Keep provider config and credentials out of repository and project-shared config unless team policy explicitly permits them.

## Extension author checklist

An extension that changes subagent behavior must document:

- provider IDs and canonical model IDs it registers;
- configuration and credential paths;
- global versus project scope and trust requirement;
- named agents/categories/tools it adds or changes;
- model capability metadata, fallback behavior, and retry policy;
- reload and restart requirements;
- safe smoke procedure plus known failure messages;
- version-pinned upstream/runtime compatibility.

Use public Senpi APIs only. Keep provider registration, persistence, UI, and host wiring separate. Add a focused behavior test and verify live discovery; compilation alone does not prove OMO loaded extension.

## Runtime validation record

- Verified: `2026-09-29`
- Local runtime: OMO `5.1.2`; Senpi `2026.9.29-3`; Bun `1.3.14`.
- OMO evidence: [seven-agent registry](https://github.com/code-yeongyu/oh-my-openagent/blob/79ab21eb774b8956ae46e593fafa05a8f11f7aa8/packages/senpi-task/src/agents/builtin/index.ts), [resolution](https://github.com/code-yeongyu/oh-my-openagent/blob/79ab21eb774b8956ae46e593fafa05a8f11f7aa8/packages/senpi-task/src/agents/resolve-agent.ts), and [global overlay](https://github.com/code-yeongyu/oh-my-openagent/blob/79ab21eb774b8956ae46e593fafa05a8f11f7aa8/packages/senpi-task/src/agents/omo-overlay.ts).
- Senpi evidence: [custom providers](https://github.com/code-yeongyu/senpi/blob/09771a9eec30f0a56b9e28ca6cd1edbbe37a1c81/packages/coding-agent/docs/custom-provider.md) defines provider registration and per-model thinking metadata.
- Local proof: read-only engine availability reports 17 authenticated entries: three 9router GPT-6 models and 14 ChatGPT-subscription models. `omo doctor` reports all 11 categories usable after explicit `architect` and `deep-high` pins. No custom markdown profile directories were found in inspected native loader locations.
- Fresh native terminal records: `st_01a0edf0` completed as explore on
  `9router/cx/gpt-6-luna` `medium`; `st_01a0edf1` completed as librarian on
  `9router/cx/gpt-6-sol` `xhigh`; `st_01a0edf2` completed as deep-high on
  `9router/cx/gpt-6-astra` `xhigh`. Probe parent subsequently exited 1 with
  `The operation was aborted.`; child completion is proved, clean parent exit is
  not. Existing-session children retained subscription Luna defaults, so restart
  before relying on global edits. Planning profiles were not spawned outside
  their gate; reviewer trio has authenticated static pins, not per-role live QA.
- Repository proof: `mise ci` passed 149 tests, typecheck, build, quality, and
  hook validation. Global JSONC diagnostics and `git diff --check` were clean.
- Revalidate: OMO or Senpi upgrade, route merge-precedence change, task execution-mode change, or extension-provider change.
- Status: `current`.

## Sources and revalidation

- [OMO configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/configuration.md)
- [OMO core JSON reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/omo-json.md)
- [Senpi settings](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/settings.md)
- [Senpi custom providers](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/custom-provider.md)
- [Senpi extensions guide](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/extensions.md)
- [Senpi packages guide](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/packages.md)
- [Repository model routing](model-routing.md)
- [Repository model matrix](model-matrix.md)
- [Repository extension authoring](authoring-extensions.md)
- [Repository issue register](issues.md)

Revalidate this guide after OMO or Senpi upgrade, provider catalog change, new extension provider/agent/category, or any change to configuration merge precedence.
