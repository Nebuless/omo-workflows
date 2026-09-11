---
name: herdr-admin
hide: true
description: Inspect and administer Herdr installation, configuration, sessions, integrations, plugins, server, remotes, and recovery.
---

# Herdr Administration

Use for Herdr server, config, installation/update, named sessions, remote attach, integrations, plugins, socket API, logs, and recovery. Use `herdr` for routine panes/workspaces, `herdr-agent-management` for agents, and `herdr-orchestration` for workflows.

## Authority boundaries

- Require `HERDR_ENV=1` before any real operation. Never invoke bare `herdr` as a probe.
- Inspect installed version and exact command help/schema before mutation: `--version`, `<group> --help`, `api schema --json`.
- Get explicit user intent before installation, linking, enabling/disabling plugins, integration install/uninstall, server stop/restart, update, remote attach/handoff, exposure/auth changes, session deletion, or restoration.
- Treat socket access, plugins, hooks, logs, and external integrations as privileged.

## Administration flow

1. Inspect current state: `status server`, `api snapshot`, `session list`, `integration status`, `plugin list`, or relevant logs/help.
2. Identify exact resource by returned ID/name. Preserve user-owned panes, sessions, plugin dirs, config, and credentials.
3. Perform one user-requested operation with `herdr_control`.
4. Inspect result and state after mutation. Record paths, version, and recovery action.

## Capability map

- **Server/config:** `server stop`, `server reload-config`, `config`, `channel`, `status`, `api schema/snapshot`.
- **Sessions/remotes:** `session list/attach/stop/delete`, `machine`, root `--remote`; live `--handoff` is server/client transfer, not task handoff.
- **Integrations:** `integration status/install/uninstall`; only documented integrations supported by installed version.
- **Plugins:** `plugin list/install/link/enable/disable/action/log/pane`; plugin code is trusted-code boundary.
- **Recovery:** inspect logs and snapshot before any restart, restore, or cleanup. Use bundled schema/help as version authority.
