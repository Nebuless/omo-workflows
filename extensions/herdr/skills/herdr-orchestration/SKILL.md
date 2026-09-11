---
name: herdr-orchestration
hide: true
description: Coordinate Herdr agents in bounded waves with explicit dependencies, durable ledger, gates, and evidence.
---

# Herdr Orchestration

Herdr is multiplexer and agent controller, not native task-graph system. Use this skill only for multiple work items, dependencies, waves, gates, or coordinator recovery. Use `herdr-agent-management` for one agent.

## Invariants

- Require `HERDR_ENV=1`; inspect before every control action.
- Use session, workspace, tab, pane, and agent IDs returned by Herdr.
- Coordinator keeps focus. Workers use sibling panes with `--no-focus`.
- One pane owns one named work item. Do not run workers with overlapping write scope.
- Persist a workflow ledger outside transient panes before dispatch and after each observed transition.
- Status is liveness only. Evidence proves completion.

## Ledger fields

For each node record: ID, goal, dependencies, wave, owner agent/pane IDs, allowed write scope, acceptance proof, timeout, retry limit, compensation/cancel action, status, evidence, last output time, and pending gate.

Reject cycles, missing dependencies, overlapping writes, or nodes without proof. Dispatch only when all dependencies are succeeded and evidence recorded.

## Dispatch envelope

```text
WORKFLOW: <id>
NODE: <id>; attempt <n>; deadline <ISO-8601>
GOAL: <one outcome>
SCOPE: <allowed>; DO NOT TOUCH: <excluded>
INPUTS: <verified dependency evidence>
ACCEPTANCE: <commands/review criteria>
REPORT: succeeded|blocked|failed|cancelled; changed paths; proof; risks
ESCALATE: irreversible action, scope change, credentials, ambiguity
```

## Coordinator loop

1. Read every active worker with `agent get` and `agent read` before waits.
2. `working`: retain only while output advances before deadline.
3. `blocked`: capture exact question, create gate, stop dependent nodes, keep unrelated ready work running.
4. `idle` or `done`: collect report, run acceptance proof, then mark succeeded.
5. `unknown`: inspect pane and agent detection. Never infer success.
6. Dispatch next bounded wave only after recorded dependency success.
7. On timeout: diagnose output/state first. Retry only idempotent or compensated work with altered diagnosis.

## Completion

Finish only when every required node has succeeded or accepted cancellation/compensation, every gate has decision record, and integration proof passes. Preserve ledger and output links. Close only panes created by workflow and only when user requested cleanup.
