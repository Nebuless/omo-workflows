# OMO Customization Scaffolding

Use this map to choose a portable customization boundary. Each directory under
[`customizations/`](../customizations/) is a policy scaffold, not a runtime load
path. Create runnable extensions only under [`extensions/`](../extensions/).

## Capability map

| Boundary | Use for | Scaffold | Runtime owner | Upstream basis |
|---|---|---|---|---|
| Agents and categories | Specialized delegation, permissions, model chains | `customizations/agents/` | Shared or `[native]` OMO config | OMO config: agents, categories, task |
| Profiles and model routing | Config-layer selection versus main-session model selection | `customizations/profiles/` | `.omo/omo.jsonc` | OMO config: profiles, models, model_profiles, model_profile |
| Rules and prompts | Durable instructions, role prompts, reusable templates | `customizations/instructions/` | Global rules, OMO config, `pi.prompts` | OMO prompts; Senpi template resources |
| Skills | Reusable task guidance and optional skill-scoped MCP setup | `customizations/skills/` | Extension resources or OMO skill roots | OMO config: skills; Senpi resources_discover |
| Hooks and policy gates | Tool interception, lifecycle policy, context transforms | `customizations/hooks/` | Senpi extension or OMO hook config | Senpi events; OMO hooks |
| Commands and shortcuts | Slash commands, key actions, flags | `customizations/commands/` | Senpi extension or OMO command config | Senpi registerCommand, registerShortcut, registerFlag |
| Tools and providers | LLM-callable tools, provider/model discovery | `customizations/tools/` | Senpi extension | Senpi registerTool, registerProvider |
| MCP integration | Remote/local MCP servers and credentials policy | `customizations/mcp/` | OMO config, skill metadata, extension | OMO MCP tiers; Senpi extensions |
| TUI and presentation | Dialogs, terminal panels, tool rendering, JSON themes | `customizations/tui/` | Senpi extension and `pi.themes` | Terminal-only guards versus RPC-capable dialogs |
| Sessions and workflows | Persistence, compaction, tasks, DAG/workpool, teams, schedules, monitors | `customizations/workflows/` | OMO task config and Senpi session APIs | Native scheduler ownership; lifecycle boundaries |
| Memory | Durable facts, recall, retention, and conflict policy | `customizations/memory/` | `.omo/omo.jsonc`, Senpi extension | OMO memory configuration; Senpi session state |
| Browser, terminal, and desktop | Browser engine, pane integration, experimental Computer Use | `customizations/automation/` | User-layer OMO config or extension | Browser automation versus native desktop read/input controls |
| Operations | Telemetry, notifications, LSP, diagnostics, Git metadata | `customizations/operations/` | OMO config or extension | OMO configuration capabilities |
| External integrations | Hosted search, app-server, webhooks, CI, external APIs | `customizations/integrations/` | Native config or dedicated Senpi extension | Native integration controls; session lifecycle, tools, state |
| Runtime extensions | Installable packaged behavior | `extensions/<name>/` | Senpi extension package | Senpi extension lifecycle |

## Creation rule

1. Pick one boundary. If it needs runtime behavior, use an extension package.
2. Read the matching `customizations/<boundary>/AGENTS.md` and its linked upstream source.
3. Add a design note only when inputs, authority, persistence, permissions, and verification are known.
4. Add code only under an independently installable `extensions/<name>/` package. Follow [authoring extensions](authoring-extensions.md).
5. Validate runtime claims against installed pinned versions and record evidence under [upstream validation](upstream-validation.md).

## Boundary rules

- Use `.omo/omo.jsonc` for OMO configuration. Do not create legacy config files.
- Native resolves shared keys, `[native]`, the selected profile, then that
  profile's `[native]` block. `[senpi]` is a legacy spelling; `[opencode]` is
  OpenCode-only. Config profiles, main-session model profiles, and task
  categories are separate controls. See [subagent configuration](omo-subagents.md#config-locations-and-precedence).
- Keep user-only credentials, environment allowlists, browser launch arguments, and machine paths outside this repository.
- Keep project policy in repository docs; never let prose substitute for tool permissions or extension guards.
- Extension factories must not start long-lived resources. Start them in `session_start` or when needed; close them in `session_shutdown`.
- Terminal components must guard `ctx.mode === "tui"`; `ctx.hasUI` also
  includes RPC dialogs. See [extension runtime contracts](authoring-extensions.md#runtime-contract).
- Every destructive, privileged, or external write requires an explicit user approval path.
- Scope each extension to one capability. Do not build a catch-all plugin.

## Upstream evidence

The records below describe the October 16 release pair, not a new runtime
validation. The [subagent reconciliation record](omo-subagents.md#reconciliation-evidence)
and [extension authoring guide](authoring-extensions.md#runtime-contract)
identify the exact sources checked on 2026-11-04 for the layering, lifecycle,
resource, and UI clarifications above.

### OMO configuration capabilities

- Verified: `2026-10-16`
- Local/release target: OMO `5.1.34` at `d7e224e478a4a77dba0d2104c336fdc72ad301e3`; paired Senpi `2026.10.16` at `8b62d4a6d16fd1d6d3787d30fbc8e1059b357623`
- OMO evidence: [configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/d7e224e478a4a77dba0d2104c336fdc72ad301e3/docs/reference/configuration.md), [features reference](https://github.com/code-yeongyu/oh-my-openagent/blob/d7e224e478a4a77dba0d2104c336fdc72ad301e3/docs/reference/features.md), [omo.json reference](https://github.com/code-yeongyu/oh-my-openagent/blob/d7e224e478a4a77dba0d2104c336fdc72ad301e3/docs/reference/omo-json.md)
- Senpi evidence: N/A — OMO config surfaces are OMO-owned; extension-specific rules are recorded below.
- Local proof: installed OMO reports `5.1.34` with engine Senpi `2026.10.16`; current catalog and runtime record agree on `omo.jsonc` and global rules. Repository package pins were not changed by this guidance update.
- Revalidate: OMO upgrade
- Status: verified for the stated release pair; revalidate on upgrade

### Senpi extension capabilities

- Verified: `2026-10-16`
- Local/release target: OMO `5.1.34` at `d7e224e478a4a77dba0d2104c336fdc72ad301e3`; paired Senpi `2026.10.16` at `8b62d4a6d16fd1d6d3787d30fbc8e1059b357623`
- OMO evidence: N/A — package behavior is Senpi-owned; OMO only loads repository extensions through its package manifest.
- Senpi evidence: [extensions guide](https://github.com/code-yeongyu/senpi/blob/8b62d4a6d16fd1d6d3787d30fbc8e1059b357623/packages/coding-agent/docs/extensions.md), [theme guide](https://github.com/code-yeongyu/senpi/blob/8b62d4a6d16fd1d6d3787d30fbc8e1059b357623/packages/coding-agent/docs/themes.md)
- Local proof: `extensions/better-custom/src/index.ts` and `extensions/herdr/index.ts` are extension entrypoints; installed OMO 5.1.34's `examples/extensions/dynamic-resources/index.ts` returns extension `themePaths`.
- Revalidate: Senpi upgrade
- Status: verified for the stated release pair; revalidate on upgrade

### Theme discovery

- Verified: `2026-10-16`
- Local/release target: OMO `5.1.34` and paired Senpi `2026.10.16`
- Senpi evidence: [theme guide](https://github.com/code-yeongyu/senpi/blob/8b62d4a6d16fd1d6d3787d30fbc8e1059b357623/packages/coding-agent/docs/themes.md) documents JSON theme discovery from global, trusted-project, package, settings, and CLI paths.
- OMO evidence: installed release example `/root/.omo/binary-runtime/5.1.34/examples/extensions/dynamic-resources/index.ts:8-15` contributes `themePaths` from `resources_discover`.
- Local proof: capability inventory retained the existing 14 policy domains; TUI is the theme policy home.
- Revalidate: OMO or Senpi upgrade
- Status: verified for the stated release pair; no separate theme-only scaffold contract is claimed

## Folder contract

Each scaffold folder contains only an `AGENTS.md` policy until work begins. Add a short design note beside it before adding an extension. Add source, tests, and package manifest only under `extensions/<name>/`.
