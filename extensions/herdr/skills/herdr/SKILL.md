---
name: herdr
hide: true
description: Control Herdr workspaces, worktrees, tabs, panes, terminal streams, notifications, and core CLI resources.
---

# Herdr Core

Use this skill for Herdr workspace, worktree, tab, pane, terminal, notification, and status work. Use `herdr-agent-management` for one agent, `herdr-orchestration` for multiple dependent work items, `herdr-handoff` for ownership transfer, and `herdr-admin` for server/config/plugin/integration/remote/session administration.

## Safety contract

- Control only inside a Herdr pane: require `HERDR_ENV=1` and `HERDR_PANE_ID`.
- Use `herdr_inspect` before `herdr_control`. Never invoke bare `herdr` to probe; it may attach or launch UI.
- Use opaque IDs returned by Herdr. Never derive an ID from labels, position, focus, or screen order.
- `--current` means caller pane, not visible focus.
- Read target state before every mutation, wait, or conclusion.
- Ask user before closing/removing resources, changing server/config/remote state, installing plugins/integrations, updating Herdr, or restoring state.

## Read-first workflow

1. Inspect command shape with `herdr_inspect {"args":["pane","--help"]}` when version-specific syntax matters.
2. Inspect live state: `status --json`, `workspace list`, `tab list`, `pane list`, `pane get <id>`, or `pane read <id> --source recent-unwrapped --lines 120`.
3. Run one explicit `herdr_control` command using IDs returned in step 2.
4. Inspect command result and target state again. State change alone never proves user work completed.

## Resource operations

- **Workspaces:** list/get before create, focus, rename, metadata, or close. Close requires user intent.
- **Worktrees:** use `worktree list` before create/open/remove. Treat remove as destructive and confirm repository/worktree target.
- **Tabs:** list/get before create/focus/rename/close. Close requires user intent.
- **Panes:** `pane layout --current` before split. Use geometry-aware split direction; keep coordinator focus and worker panes `--no-focus`. Rename returned pane IDs. Read output before send, run, wait, close, move, swap, resize, or zoom.
- **Terminal streams:** use `pane read` or `terminal attach` only after verifying target. Do not seize input ownership without user request.
- **Notifications:** use `notification show` to inspect. Do not treat notification presence as proof of task completion.

## Target verification

Before text/keys/run in a pane, inspect `pane get <id>`, `pane process-info --pane <id>`, and recent output. For a new prompt, use `pane run <id> "<text>"` only after target readback confirms input-ready state. For literal non-Enter text, use `pane send-text`; use `pane send-keys` only for documented agent-specific keys.

## Waits and recovery

Read before waiting. Use `wait-output` only with a bounded timeout and a specific observable signal. On timeout, re-read pane state, process info, and output; then classify progress, block, failure, or target mismatch. Do not blindly retry or invent generic pause keys.
