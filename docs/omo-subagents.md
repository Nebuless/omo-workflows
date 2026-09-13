# OMO and Senpi Subagents

Use this guide to configure, verify, and repair delegated OMO/Senpi work. It covers built-in named agents, task categories, model routes, custom providers, and extension-added capabilities.

## Mental model

A parent session delegates in two ways:

- **Named agent**: `explore`, `librarian`, and other registered agent IDs. Named agents carry a role prompt and resolve their own model chain.
- **Category**: a `task()` call with a category such as `quick`, `deep`, or `writing`. Categories route work by kind, not by agent name.

A configured OMO `models` chain is ordered. First entry is primary; later entries can be selected during child admission or model resolution, including capacity pressure. Senpi retry fallback chains are separate, per-process runtime retry state. A task must resolve to both an available model and valid credentials before it starts. Crossing providers at either stage changes the data boundary; document and approve that decision before routing real task content.

Native OMO owns task sessions, processes, retries, cancellation, output delivery, and DAG scheduling. Extensions may observe, gate, or present that state, but must not replace scheduler ownership. Current native task schema cannot express Atomic-style per-stage tool/context policy or worktree delegation.

OMO configures Senpi-backed subagents. Parent OpenCode behavior and Senpi-owned children do not always see the same harness-scoped config. Put category routes at shared top level when any Senpi child must use them.

## Config locations and precedence

Use one unified JSONC file:

```text
~/.omo/omo.jsonc                 # global user configuration
.omo/omo.jsonc                   # project configuration
```

OMO walks `.omo/omo.jsonc` layers from ancestor to working directory; nearest project layer wins and overrides user configuration. Within each merged file, OMO applies shared base keys first and then its `[opencode]` block. Profiles can add another override layer.

Use shared top-level `categories` for task routes used by OMO and Senpi. Use `[opencode].agents` for OMO named-agent overrides.

```jsonc
{
  "categories": {
    "quick": {
      "models": [
        { "model": "9router/cx/gpt-5.6-luna", "reasoning": "low" }
      ]
    },
    "deep": {
      "models": [
        { "model": "9router/cx/gpt-6-astra", "reasoning": "xhigh" }
      ]
    }
  },
  "[opencode]": {
    "agents": {
      "explore": {
        "models": [
          { "model": "9router/cx/gpt-5.6-luna", "reasoning": "medium" }
        ]
      },
      "librarian": {
        "models": [
          { "model": "9router/cx/gpt-5.6-terra", "reasoning": "xhigh" }
        ]
      }
    }
  }
}
```

`librarian` is built-in research agent. There is no separate built-in `researcher` ID. Custom agent keys create user-defined agents; only use them after giving them a clear role prompt, tool policy, and model chain.

Do not put secrets, endpoint URLs, or local machine paths in project configuration. Keep global credentials in provider setup and extension configuration.

## Built-in routing surfaces

### Named agents

Current OMO built-ins include:

| ID | Use | Configure under |
|---|---|---|
| `explore` | fast codebase discovery and extraction | `[opencode].agents.explore` |
| `librarian` | research and source-backed lookup | `[opencode].agents.librarian` |
| `plan-consultant` | plan-gated design work | `[opencode].agents.plan-consultant` |
| `plan-reviewer` | plan-gated review | `[opencode].agents.plan-reviewer` |

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
| `deep` | browser, backend, algorithms, complex investigation |
| `ultrabrain` | hard reasoning and architecture |

This repository adds shared `memory-reflection` for OMO reflection and Kibitzer recall. Keep it at shared top level, then select it explicitly:

```jsonc
{
  "categories": {
    "memory-reflection": {
      "models": [
        { "model": "9router/cx/gpt-5.6-luna", "reasoning": "low" }
      ]
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

1. Install OMO and complete provider authentication. Follow repository [installation](../README.md#install-manually).
2. List models from provider before writing a route:

   ```sh
   omo --list-models 9router
   ```

3. Edit `~/.omo/omo.jsonc` for global behavior, or nearest `.omo/omo.jsonc` for one project.
4. Configure named agents under `[opencode].agents`; configure categories at shared top-level `categories`.
5. Use full canonical model IDs: `9router/cx/gpt-5.6-luna`, not aliases or display names.
6. Include only fallbacks that are present in catalog and have working credentials.
7. Start a new OMO/Senpi session. A running task launcher may retain routes resolved at startup. `/reload` hot-reloads only auto-discovered extension paths; settings-package and `-e` resources need restart unless runtime proves otherwise. Use fresh session for route smoke tests.
8. Launch one harmless named-agent task and one category task. Confirm reported agent/category and resolved model match configuration.

For this repository's portable profiles, use exactly one of:

- [`templates/omo.jsonc.gpt-heavy`](../templates/omo.jsonc.gpt-heavy)
- [`templates/omo.jsonc.balanced`](../templates/omo.jsonc.balanced)

Verify every model with `omo --list-models 9router` before copying a profile. These profile files are complete routing replacements, not fragments to merge blindly.

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
| Child uses model from wrong provider | category exists only in `[opencode]`, but child is Senpi-owned | Move category to shared top-level `categories`; keep named-agent overrides in `[opencode].agents`. |
| Current task ignores edited route | task launcher loaded config before edit | Start fresh OMO/Senpi session; then rerun smoke task. |
| Named agent still uses default chain | wrong agent ID or config layer overridden by project/profile | Check exact built-in ID, nearest `.omo/omo.jsonc`, selected profile, and final merged config. |
| `/reload` does not expose extension | extension not in trusted auto-discovery path, package not installed, or session lacks project trust | Install extension at global/project scope, confirm package discovery, then `/reload` or restart. |
| `/custom-provider` cannot run | command needs interactive TUI | Launch interactive OMO. Noninteractive, print, JSON, and RPC modes cannot use provider wizard. |
| Custom provider loaded but model cannot switch | endpoint, key, API style, or model metadata invalid | Use `/better-models`; verify provider URL, credential source, selected API style, and discovered model ID. |
| Reflection fails with `bwrap` missing `reflection-sessions` | known sandbox bind-path defect on Linux | Keep documented `memory.reflection.sandbox: "off"` workaround until upstream fix is installed and verified. |

Never solve route failure by adding blind fallback chains. First prove model ID is catalog-visible and provider credential is active. A fallback hides root cause and can run work under unintended cost, capability, or data boundary.

## Workflow and task controls

For ordinary delegated work, the active `task` tool exposes task launch, output/status, steering, and cancellation. Inspect its live schema rather than copying parameters from an older session or a different harness. Read status before a control action. Cancellation is destructive task control; require explicit user confirmation.

For staged programs, [`workflow-graph`](../extensions/workflow-graph/README.md) uses OMO's native workflow/DAG state. It capability-gates controls against current `workflow` and task schemas. Use `/workflow-run status` to inspect, `/workflow-run answer` for human gates, and confirmed cancellation only when needed. See [workflow parity](../extensions/workflow-graph/PARITY.md) for supported and unavailable semantics.

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

- Verified: `2026-09-13`
- Local runtime: OMO `5.0.0-0.beta.53`; Senpi `2026.9.10-2`; Bun `1.3.14`.
- OMO evidence: [configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/configuration.md) and [core JSON reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/omo-json.md) cover unified config layering, agent/category chains, and child resolution.
- Senpi evidence: [extensions](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/extensions.md), [settings](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/settings.md), and [custom providers](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/custom-provider.md) cover extension registration, trust, fallback, and providers.
- Local proof: `bun test test/omo-preferences.test.ts` passed with 3 tests and 18 assertions. Live category smoke checks recorded CX-backed categories completing; stale Olama fallback credentials failed named-agent smoke before config repair. See [issue register](issues.md).
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
- [Workflow graph parity](../extensions/workflow-graph/PARITY.md)
- [Repository issue register](issues.md)

Revalidate this guide after OMO or Senpi upgrade, provider catalog change, new extension provider/agent/category, or any change to configuration merge precedence.
