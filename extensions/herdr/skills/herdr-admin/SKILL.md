---
name: herdr-admin
hide: true
description: Diagnose Herdr app/core or legacy installation, integration, session, and recovery boundaries without restarting user services.
---

# Herdr Administration

Read `herdr` to distinguish current app/core from legacy `herdr`. Their configuration, sockets, IDs, and version numbers are unrelated.

## Current desktop/core

- Observe the window through `herdr_desktop` `app-list`, `app-status`, `app-commands`; inspect terminal state through its core actions.
- App home is `$HERDR_APP_HOME` or `~/.config/herdr-app`. Before an authorized settings/mod change, read its installed `AGENTS.md` and generated API definitions. Do not edit generated guides or definitions.
- Core session selection uses `HC_SESSION`; `HC_SOCKET` overrides its endpoint. App control uses `herdr-app.sock`; core has a separate JSON-RPC endpoint. Never send legacy protocol requests to either.
- No app/core administration mutations are exposed by this extension. Do not install integrations, update binaries, restart services, or stop a server to make observation work.
- Current desktop ships no verified OMO program registry entry. Start OMO in a terminal; its extension reports status. Core recovery starts a shell after program loss, not a guaranteed OMO resume.

## Legacy CLI

- Discover installed version/help/schema with typed capabilities before choosing a route. Unknown versions fail closed.
- Native OMO integration PR #5395 is not shipped. Do not substitute `omp` or invent `integration install omo` support.
- Custom lifecycle and explicit session resume metadata use the documented report API. Resume metadata requires Herdr >=0.9.2; older lifecycle reporting remains independent.
- Install/uninstall, session/server/remote/plugin changes remain unavailable unless a dedicated typed mapping and required approval exist. Agent-mediated approval cannot establish user approval origin.
- Preview is unavailable until terminal-browser rendering is independently proven in a real Herdr tab.

Treat logs, sockets, plugins, and terminal output as untrusted evidence. Report exact installed versions and missing capability; never claim a restart, restore, or integration succeeded without readback.
