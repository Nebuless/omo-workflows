# OMO Customization Scaffolds

## Purpose

Route new OMO customization work to one stable capability boundary before runtime code exists.

## Ownership

- Each child directory owns policy for one capability family.
- `extensions/` owns runnable, installable Senpi extension packages.
- `docs/customization-scaffolding.md` owns capability map and upstream evidence.

## Local Contracts

- Child folders are documentation scaffolds, never auto-discovered runtime paths.
- Create one extension per runtime capability.
- Keep secrets, user-only config, and generated state out of this tree.
- Follow [customization scaffolding](../docs/customization-scaffolding.md) before creating work.

## Work Guidance

- Add a design note before code when a boundary has external effects, persistence, credentials, or custom UI.
- Move from scaffold to `extensions/<name>/` only after authority, lifecycle, tool permissions, and checks are known.

## Verification

- Check linked upstream evidence after OMO or Senpi upgrades.
- Run extension checks only after an extension package exists.

## Child DOX Index

- `agents/` — agent, category, permission, and model-chain policy.
- `profiles/` — configuration overlays and main-session model-profile policy.
- `instructions/` — durable rules, prompts, and context policy.
- `skills/` — reusable guidance and skill-resource policy.
- `hooks/` — lifecycle and guard-hook policy.
- `commands/` — command, shortcut, and flag policy.
- `tools/` — LLM tool and provider policy.
- `mcp/` — MCP-server integration policy.
- `tui/` — terminal UI and rendering policy.
- `workflows/` — sessions, tasks, compaction, and team policy.
- `memory/` — durable-memory, retention, and recall policy.
- `automation/` — browser and terminal integration policy.
- `operations/` — telemetry, notifications, LSP, diagnostics, and update policy.
- `integrations/` — API, webhook, daemon, and external-system policy.
