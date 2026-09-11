# OMO Customization Scaffolding

Use this map to choose a portable customization boundary. Each directory under
[`customizations/`](../customizations/) is a policy scaffold, not a runtime load
path. Create runnable extensions only under [`extensions/`](../extensions/).

## Capability map

| Boundary | Use for | Scaffold | Runtime owner | Upstream basis |
|---|---|---|---|---|
| Agents and categories | Specialized delegation, permissions, model chains | `customizations/agents/` | `.omo/omo.jsonc` | OMO config: agents, categories, task |
| Profiles and model routing | Environment-specific config and main-session model selection | `customizations/profiles/` | `.omo/omo.jsonc` | OMO config: profiles, models, model_profiles |
| Rules and prompts | Durable instructions, role prompts, reusable context | `customizations/instructions/` | `~/.omo/rules/`, `.omo/` config | OMO config: rules, prompt, prompt_append |
| Skills | Reusable task guidance and optional skill-scoped MCP setup | `customizations/skills/` | Extension resources or OMO skill roots | OMO config: skills; Senpi resources_discover |
| Hooks and policy gates | Tool interception, lifecycle policy, context transforms | `customizations/hooks/` | Senpi extension or OMO hook config | Senpi events; OMO hooks |
| Commands and shortcuts | Slash commands, key actions, flags | `customizations/commands/` | Senpi extension or OMO command config | Senpi registerCommand, registerShortcut, registerFlag |
| Tools and providers | LLM-callable tools, provider/model discovery | `customizations/tools/` | Senpi extension | Senpi registerTool, registerProvider |
| MCP integration | Remote/local MCP servers and credentials policy | `customizations/mcp/` | OMO config, skill metadata, extension | OMO MCP tiers; Senpi extensions |
| TUI and presentation | Dialogs, custom terminal panels, tool rendering | `customizations/tui/` | Senpi extension | Senpi ctx.ui and custom rendering |
| Sessions and workflows | Persistence, compaction, task concurrency, teams | `customizations/workflows/` | `.omo/omo.jsonc`, Senpi extension | OMO task/teams; Senpi session APIs |
| Memory | Durable facts, recall, retention, and conflict policy | `customizations/memory/` | `.omo/omo.jsonc`, Senpi extension | OMO memory configuration; Senpi session state |
| Browser and terminal | Browser engine, tmux panes, noninteractive guardrails | `customizations/automation/` | User-layer OMO config or extension | OMO browser automation and tmux |
| Operations | Telemetry, notifications, LSP, diagnostics, Git metadata | `customizations/operations/` | OMO config or extension | OMO configuration capabilities |
| External integrations | Webhooks, CI, daemon-backed or API features | `customizations/integrations/` | Senpi extension | Senpi session lifecycle, tools, state |
| Runtime extensions | Installable packaged behavior | `extensions/<name>/` | Senpi extension package | Senpi extension lifecycle |

## Creation rule

1. Pick one boundary. If it needs runtime behavior, use an extension package.
2. Read the matching `customizations/<boundary>/AGENTS.md` and its linked upstream source.
3. Add a design note only when inputs, authority, persistence, permissions, and verification are known.
4. Add code only under an independently installable `extensions/<name>/` package. Follow [authoring extensions](authoring-extensions.md).
5. Validate runtime claims against installed pinned versions and record evidence under [upstream validation](upstream-validation.md).

## Boundary rules

- Use `.omo/omo.jsonc` for OMO configuration. Do not create legacy config files.
- Keep user-only credentials, environment allowlists, browser launch arguments, and machine paths outside this repository.
- Keep project policy in repository docs; never let prose substitute for tool permissions or extension guards.
- Extension factories must not start long-lived resources. Start them in `session_start` or when needed; close them in `session_shutdown`.
- TUI-only behavior must guard `ctx.mode === "tui"` or `ctx.hasUI`.
- Every destructive, privileged, or external write requires an explicit user approval path.
- Scope each extension to one capability. Do not build a catch-all plugin.

## Upstream evidence

### OMO configuration capabilities

- Verified: `2026-09-11`
- Local runtime: OMO `5.0.0-0.beta.53`; Senpi `2026.9.10-2`; Bun `1.3.14`
- OMO evidence: [configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/configuration.md), [features reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/features.md), [omo.json reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/omo-json.md)
- Senpi evidence: N/A — OMO config surfaces are OMO-owned; extension-specific rules are recorded below.
- Local proof: repository pins `@code-yeongyu/senpi@2026.9.10-2` in `package.json`; current catalog and runtime record agree on `omo.jsonc` and global rules.
- Revalidate: OMO upgrade
- Status: current

### Senpi extension capabilities

- Verified: `2026-09-11`
- Local runtime: OMO `5.0.0-0.beta.53`; Senpi `2026.9.10-2`; Bun `1.3.14`
- OMO evidence: N/A — package behavior is Senpi-owned; OMO only loads repository extensions through its package manifest.
- Senpi evidence: [extensions guide](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/extensions.md)
- Local proof: `extensions/better-custom/src/index.ts` and `extensions/herdr/index.ts` are package entrypoints under the pinned Senpi dependency.
- Revalidate: Senpi upgrade
- Status: current

## Folder contract

Each scaffold folder contains only an `AGENTS.md` policy until work begins. Add a short design note beside it before adding an extension. Add source, tests, and package manifest only under `extensions/<name>/`.
