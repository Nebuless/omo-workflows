---
name: herdr-agent-management
hide: true
description: Start, inspect, prompt, wait for, and safely manage one Herdr-detected agent.
---

# Herdr Agent Management

Use for one detected agent lifecycle. Use `herdr` for pane topology, `herdr-handoff` for ownership transfer, `herdr-orchestration` for multi-agent workflows, and `herdr-admin` for platform administration.

## Rules

- Require `HERDR_ENV=1` and `HERDR_PANE_ID` before control.
- Inspect `agent get <id>` and `agent read <id> --source recent-unwrapped --lines 120` before prompting, waiting, interrupting, or concluding.
- Agent states: `working`, `blocked`, `idle`, `done`, `unknown`. `idle` and `done` mean attention/completion state only; neither proves deliverables or tests.
- Use opaque agent/pane IDs returned by Herdr. Do not send to `unknown` state.
- No generic pause exists. Never guess a key sequence.

## Start and dispatch

1. Inspect `pane layout --current`; create a sibling pane with `pane split --current --direction right --no-focus` or down when geometry requires.
2. Read returned pane ID, rename it, start supported interactive agent with `agent start` or run its normal executable in verified pane.
3. Read `agent get <id>` until it is input-ready.
4. Prompt one task with scope, non-goals, acceptance proof, and escalation rules.
5. Read back agent state/output. Input delivery is not task acceptance.

## Observe and act

- `agent list`, `agent get <id>`, `agent read <id>`, and `agent explain <id> --json` inspect identity/state.
- `agent prompt <id> <text>` sends a bounded follow-up only after readback.
- `agent wait <id> --status <state> --timeout <ms>` is valid only after inspection. On timeout, inspect state/output and classify.
- `agent focus` or `agent attach` changes interaction ownership; use only when user requests direct control. `--takeover` needs explicit user request.

## Interrupt safely

Only on explicit pause/cancel request: inspect agent, pane output, `pane process-info`, and `agent explain --json`; then use documented agent-specific control. Re-read all signals immediately. If still `working`, report pause not proven. Never escalate to process kill without explicit request.
