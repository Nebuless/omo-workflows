---
name: herdr-orchestration
hide: true
description: Coordinate native OMO tasks alongside observed Herdr terminals with explicit scope, dependencies, and completion evidence.
---

# Herdr Orchestration

Native OMO owns task graphs, scheduling, models, delegation, and result delivery. Herdr owns persistent terminals and the desktop window. Do not replace native task orchestration with a second graph runtime or terminal-driven workers.

## Dispatch

1. Identify the platform with `herdr`; inspect existing terminals or panes before acting.
2. Use native OMO task/graph tools for ordinary workers. Give each one outcome, allowed write paths, inputs, acceptance proof, and a stop condition. Parallel workers must not overlap write scope.
3. Herdr terminal work is an explicit separate execution track. Current `herdr_desktop` supports observation only; legacy dispatch requires an available typed capability plus fresh target proof. Missing control is not permission to inject terminal input.
4. Keep workers hidden unless the user asks to see a tab or split. Do not alter focus or layout merely to orchestrate.

## Collection and recovery

- Retain native task handles and collect their terminal results. Register native monitor subscriptions for waits; do not sleep or poll screens.
- Associate existing external work with its exact generation, machine/session, terminal or pane ID, owner, scope, next action, and evidence location. Never equate `HC_TERMINAL_ID` with a legacy pane ID.
- `working` is liveness, `blocked` needs a decision, and `done`/`idle` still require a report and acceptance proof. Screen words alone cannot establish completion.
- A timeout is a diagnosis point, not permission to resend a task. Read state/output and determine whether earlier input arrived before any retry.
- Desktop closure leaves core terminals alive. A recovered shell is not a resumed agent. Do not recreate or kill another owner's terminal during recovery.

Finish after required results and integration checks are verified. Preserve unresolved gates and evidence. Clean up only owned workers within the user's requested scope. Use `herdr-handoff` for an actual ownership transfer.
