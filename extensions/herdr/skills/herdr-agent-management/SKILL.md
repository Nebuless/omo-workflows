---
name: herdr-agent-management
hide: true
description: Inspect one Herdr terminal or legacy agent and dispatch only through verified native or typed controls.
---

# Herdr Agent Management

Read `herdr` first to identify the platform generation.

## Current desktop/core

- Inspect with `herdr_desktop` `core-list`, then `core-get`/`core-read` using the returned terminal ID. `core-templates` reports configured roles; it does not launch them.
- OSC 7501 supplies `idle`, `working`, `done`, `blocked`, or `error`. Status and a successful launch reply do not prove task completion. Read deliverables and test evidence.
- `blocked` requires the user's question or permission decision; do not force input past it. Never infer readiness from screen prose.
- Use native OMO tasks for new workers. This extension has no current-core launch/send/interrupt/kill mapping. Do not use legacy pane operations on core terminal IDs.
- Core terminal persistence survives window closure. Recovery may start a shell; it does not prove OMO session restoration.

## Legacy CLI

- Require `HERDR_ENV=1` and `HERDR_PANE_ID` before control; discover capabilities first.
- Observe with available `agent list/get/read/explain` mappings. Use returned pane identity and fresh ancestry/revision for any dispatch.
- Typed `agent prompt` is usable only if live inspection also proves readiness and state sequence. CLI presence alone is insufficient. Unknown, malformed, unchanged, or truncated proof leaves dispatch unavailable or unproven.
- Start and fixed-profile launch remain unavailable. `omp` is a different agent, not an OMO alias.
- No generic pause key exists. Do not guess keys or escalate to process kill.

Use `herdr-handoff` when ownership changes, and `herdr-orchestration` when a coordinator retains it.
