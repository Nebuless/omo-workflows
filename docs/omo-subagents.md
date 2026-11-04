# OMO and Senpi Subagents

Use this guide to configure, verify, and repair delegated OMO/Senpi work. It covers built-in named agents, task categories, model routes, custom providers, and extension-added capabilities.

## Delegation model

A parent session delegates in two ways:

- **Named agent**: `explore`, `librarian`, and other registered agent IDs. Named agents carry a role prompt and resolve their own model chain.
- **Category**: a `task()` call with a category such as `quick`, `deep-low`, `deep-high`, or `writing`. Categories route work by kind, not by agent name.

A configured OMO `models` chain is ordered. First entry is primary; later entries can be selected during child admission or model resolution, including capacity pressure. Senpi retry fallback chains are separate, per-process runtime retry state. A task must resolve to both an available model and valid credentials before it starts. Crossing providers at either stage changes the data boundary; document and approve that decision before routing real task content.

Native OMO owns task sessions, processes, retries, cancellation, output delivery,
and DAG scheduling. Extensions may observe, gate, or present that state, but must
not replace scheduler ownership. Task isolation and merge-back options are
separate from agent tool permissions and dependency graphs. Inspect the live
schema for the host's supported isolation provider.

OMO configures Senpi-backed subagents. Parent OpenCode behavior and Senpi-owned children do not always see the same harness-scoped config. Put category routes at shared top level when any Senpi child must use them.

## Config locations and precedence

Use one unified JSONC file:

```text
~/.omo/omo.jsonc                 # global user configuration
.omo/omo.jsonc                   # project configuration
```

OMO merges the user layer and ancestor-to-project layers, with the nearest
project layer winning. Native resolves shared keys, `[native]`, the selected
`profiles.<name>`, then that profile's `[native]` block. `[senpi]` is the
accepted legacy spelling. `[opencode]` applies only to the OpenCode edition.

Use shared top-level `categories` and `agents` for portable task routes, or
`[native].agents` for Native-only overrides. Config profiles select override
layers. `model_profile` selects a main-session model chain, not child routes.

```jsonc
{
  "categories": {
    "quick": {
      "models": [
        { "model": "9router/cx/gpt-6-luna", "reasoning": "low" }
      ]
    },
    "deep-high": {
      "models": [
        { "model": "9router/cx/gpt-6-astra", "reasoning": "high" }
      ]
    }
  },
  "[native]": {
    "agents": {
      "explore": {
        "models": [
          { "model": "9router/cx/gpt-6-luna", "reasoning": "medium" }
        ]
      },
      "librarian": {
        "models": [
          { "model": "9router/cx/gpt-6.1-sol", "reasoning": "high" }
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
| `explore` | fast codebase discovery and extraction | `agents.explore` or `[native].agents.explore` |
| `librarian` | research and source-backed lookup | `agents.librarian` or `[native].agents.librarian` |
| `plan-consultant` | plan-gated design work | `agents.plan-consultant` or `[native].agents.plan-consultant` |
| `plan-reviewer` | plan-gated review | `agents.plan-reviewer` or `[native].agents.plan-reviewer` |

Curated agents retain their role and in-process execution.
`task.default_execution_mode` defaults to `auto`: on non-Windows platforms,
children use the parent's ensured host when `process_runner` is `host` and
the host supports `session_context` and `generation_handoff`; otherwise they
run in-process. The decision is made once per parent session. Explicit
`in-process` or `process` overrides apply to ordinary custom agents.

Other agent keys create custom agents. Keep each role narrow, with an explicit
prompt, model chain, permissions, tool limits, turn/depth limits, and execution
mode. Inspect the active task schema and loaded inventory before launching.

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
| `deep-low` | browser, backend, algorithms, and investigation settled from available evidence |
| `deep-high` | escalation for an unresolved trade-off, contract boundary, or mechanism |
| `architect` | system design and boundary decisions |
| `ultrabrain` | hard reasoning and architecture |

This repository adds shared `memory-reflection` for OMO reflection and Kibitzer recall. Keep it at shared top level, then select it explicitly:

```jsonc
{
  "categories": {
    "memory-reflection": {
      "models": [
        { "model": "9router/cx/gpt-6-luna", "reasoning": "low" }
      ]
    }
  },
  "memory": {
    "reflection": { "category": "memory-reflection", "sandbox": "off" },
    "recall": { "category": "memory-reflection" }
  }
}
```

The templates retain `memory.reflection.sandbox: "off"` for the Linux `bwrap`
failure recorded on 2026-09-11. Its necessity has not been revalidated here.
Consult the [dated issue record](issues.md#2026-09-11t215541z---memory-reflection-fails-before-child-launch)
and reproduce on the installed host before treating the workaround as required.

## Setup procedure

1. Install OMO and complete provider authentication. Follow repository [installation](../README.md#install-manually).
2. List models from provider before writing a route:

   ```sh
   omo --list-models 9router
   ```

3. Edit `~/.omo/omo.jsonc` for global behavior, or nearest `.omo/omo.jsonc` for one project.
4. Configure shared `agents`/`categories`, or Native-only `[native]` overrides.
5. Use only catalog-verified canonical route IDs: `9router/cx/gpt-6.1-sol`, `9router/cx/gpt-6-luna`, and `9router/cx/gpt-6-astra`, not aliases or display names. Sol supports reasoning through `high`, not `xhigh`.
6. Include only fallbacks that are present in catalog and have working credentials.
7. Start a fresh session for route smoke tests. `/reload` depends on discovery paths, trust, and session state. Do not assume a running child adopts changed routes or execution modes.
8. Launch one harmless named-agent task and one category task. Confirm reported agent/category and resolved model match configuration.

For this repository's portable profiles, use exactly one of:

- [`templates/omo.jsonc.gpt-heavy`](../templates/omo.jsonc.gpt-heavy)
- [`templates/omo.jsonc.balanced`](../templates/omo.jsonc.balanced)

Verify every model with `omo --list-models 9router` before copying a profile. These profile files are complete routing replacements, not fragments to merge blindly.

Their categories are shared; their `[opencode].agents` blocks apply only to
OpenCode. Configure shared or `[native]` agent overrides separately for Native.

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
| Child ignores expected route | override exists only in `[opencode]`, but this is Native | Use shared `categories`/`agents` or `[native]`; reserve `[opencode]` for that edition. |
| Current task ignores edited route | task launcher loaded config before edit | Start fresh OMO/Senpi session; then rerun smoke task. |
| Named agent still uses default chain | wrong agent ID or config layer overridden by project/profile | Check exact built-in ID, nearest `.omo/omo.jsonc`, selected profile, and final merged config. |
| `/reload` does not expose extension | extension not in trusted auto-discovery path, package not installed, or session lacks project trust | Install extension at global/project scope, confirm package discovery, then `/reload` or restart. |
| `/custom-provider` cannot run | command needs interactive TUI | Launch interactive OMO. Noninteractive, print, JSON, and RPC modes cannot use provider wizard. |
| Custom provider loaded but model cannot switch | endpoint, key, API style, or model metadata invalid | Use `/better-models`; verify provider URL, credential source, selected API style, and discovered model ID. |
| Reflection fails with `bwrap` missing `reflection-sessions` | previously observed Linux sandbox bind-path defect | Consult the dated issue record and reproduce on the installed host before applying its workaround. |

Never solve route failure by adding blind fallback chains. First prove model ID is catalog-visible and provider credential is active. A fallback hides root cause and can run work under unintended cost, capability, or data boundary.

## Workflow and task controls

The active task family exposes launch, output/status, steering, and cancellation.
Completion is delivered automatically. `task_output` reads state without
resuming work; `task_send` steers or resumes eligible parked children.
Cancellation is terminal, so identify the intended child before stopping it.
Inspect the live schema instead of copying an older harness's parameters.

Workpool is a native keyed queue. DAG/ULW workflows express dependencies over
native tasks. Team Mode has its own roster and messaging contracts. Scheduled
prompts and durable monitors provide continuation without replacing scheduling.

When caller needs availability evidence before a native launch, use the optional
[`model-routing-advisor`](../extensions/model-routing-advisor/README.md) tool
explicitly. Pass caller-normalized candidate IDs and retain its report or
reference before direct task, workpool, team, mass/DAG, or ULW launch. It has no
universal hook and never chooses a model, changes route order, or controls a
task. See [model routing preflight](model-routing.md#explicit-route-advice-preflight).

## Custom providers and extension-added capabilities

Subagent routing accepts provider/models admitted by the active runtime and
configured route. Native providers come from setup and credentials; public
Senpi extensions can register providers, models, tools, commands, and resources.
OMO configuration owns task-agent/category definitions. A provider list is
runtime inventory, not fixed repository policy.

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

## Historical runtime validation record

- Verified: `2026-10-16`
- Local runtime: OMO `5.1.34` at `d7e224e478a4a77dba0d2104c336fdc72ad301e3`; bundled Senpi `2026.10.16` at `8b62d4a6d16fd1d6d3787d30fbc8e1059b357623`.
- Catalog: `omo --list-models 9router` listed CX Sol 6.1, Luna 6, and Astra 6. This proves catalog visibility only, not credentials or live task completion.
- OMO category schema: [immutable category.ts](https://github.com/code-yeongyu/oh-my-openagent/blob/d7e224e478a4a77dba0d2104c336fdc72ad301e3/packages/omo-config-core/src/schema/category.ts) defines strict category entries with `models` and `reasoning` fields.
- Standalone Senpi `2026.10.16-3` is newer and is not the Senpi version bundled with this OMO release.
- Revalidate: OMO or Senpi upgrade, provider catalog change, task execution-mode change, or extension-provider change.
- Senpi evidence: [extensions](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/extensions.md), [settings](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/settings.md), and [custom providers](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/custom-provider.md) cover extension registration, trust, fallback, and providers.
- Historical local proof: the earlier `bun test test/omo-preferences.test.ts` run passed with 3 tests and 18 assertions. The earlier live category smoke checks recorded CX-backed categories completing; stale Olama fallback credentials failed named-agent smoke before config repair. These checks were not rerun for this reconciliation. See [issue register](issues.md).
- Revalidate: OMO or Senpi upgrade, route merge-precedence change, task execution-mode change, or extension-provider change.
- Status: historical evidence for the stated pairing. The repository now pins Senpi `2026.10.19-2`; see [current integration evidence](upstream-validation.md#current-integration-target).

### Reconciliation evidence

- Inspected: `2026-11-04`; installed `omo --version` reports OMO `5.1.58`
  with Senpi `2026.11.2-1`, distinct from the repository SDK pin.
- Native layering and execution-mode claims were checked against the repository's
  recorded OMO `5.1.40` source: [configuration](https://github.com/code-yeongyu/oh-my-openagent/blob/eb585410f078ba656ace9f69f5434db4db4d8745/docs/reference/configuration.md)
  and [task reference](https://github.com/code-yeongyu/oh-my-openagent/blob/eb585410f078ba656ace9f69f5434db4db4d8745/docs/reference/omo-json.md).
  Senpi does not own these OMO routing decisions.
- Control semantics follow the active task tool schema. No live child launch,
  provider request, sandbox reproduction, or route migration was performed.
- Revalidate after a host, routing-schema, or task execution-mode change.

## Sources and revalidation

- [OMO category schema at v5.1.34](https://github.com/code-yeongyu/oh-my-openagent/blob/d7e224e478a4a77dba0d2104c336fdc72ad301e3/packages/omo-config-core/src/schema/category.ts)
- [OMO configuration reference at v5.1.34](https://github.com/code-yeongyu/oh-my-openagent/blob/d7e224e478a4a77dba0d2104c336fdc72ad301e3/docs/reference/configuration.md)
- [Repository model routing](model-routing.md)
- [Repository model matrix](model-matrix.md)
- [Repository extension authoring](authoring-extensions.md)
- [Repository issue register](issues.md)

Revalidate this guide after OMO or Senpi upgrade, provider catalog change, new extension provider/agent/category, or any change to configuration merge precedence.
