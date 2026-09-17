---
name: herdr-admin
hide: true
description: Inspect and administer Herdr installation, configuration, sessions, integrations, plugins, server, remotes, and recovery.
---

# Herdr Administration

Use for Herdr server, config, installation/update, named sessions, remote attach, integrations, plugins, socket API, logs, and recovery. Use `herdr` for routine panes/workspaces, `herdr-agent-management` for agents, and `herdr-orchestration` for workflows.

## Authority boundaries

- `herdr_inspect` remains read-only. Mutations use only typed capability definitions; public untyped command control does not exist.
- Require Herdr environment for operations. Inspect installed version, complete command help, and `api schema --json` before mutation.
- Get explicit user intent before high-impact changes. Agent-mediated approval is in-memory, one-use, five-minute, and cannot prove approval origin.
- Treat socket access, plugins, hooks, logs, and external integrations as privileged and untrusted output.

## Capability map

- **Server/config:** typed discovery covers `server`, `config`, `channel`, `status`, and `api schema/snapshot`; mismatches unavailable.
- **Sessions/remotes:** `session`, `machine`, and root remote paths remain high-impact or unavailable without typed mapping.
- **Integrations:** `integration install/uninstall`; only documented integrations supported by installed capability map.
- **Plugins:** plugin paths remain unavailable until dedicated typed input mapping exists.
- **Recovery:** inspect logs and snapshot before restart, restore, or cleanup. Use `herdr_operation` only after target readback and approval. If typed dispatch is unavailable, use observation-only recovery; do not claim unsupported operation works.
