---
name: herdr-handoff
hide: true
description: Transfer ordinary work ownership between Herdr agents without losing scope, evidence, or next actions.
---

# Herdr Handoff

Use only when work ownership changes. Use `herdr-agent-management` to prompt a worker without transferring ownership. Use `herdr-orchestration` when coordinator retains workflow ownership across multiple workers.

## Rules

- Require `HERDR_ENV=1` and verify both source and destination agents before handoff.
- Read source transcript/state and destination readiness before sending anything.
- Preserve task scope, current evidence, changed paths, verification, blockers, decisions, and exact next action.
- Do not transfer secrets, unrelated transcript, or unverified conclusions.
- Handoff does not prove recipient acceptance. Read target state/output afterward.

## Envelope

```text
HANDOFF
GOAL: <single outcome>
SCOPE: <allowed files/systems>; DO NOT TOUCH: <excluded scope>
STATE: <what is done, active, blocked>
EVIDENCE: <commands/results/artifacts>
DECISIONS: <accepted constraints and rationale>
RISKS: <known uncertainty or rollback concern>
NEXT: <one concrete action>
ESCALATE: <when recipient must ask>
```

## Procedure

1. Inspect source: `agent get`, `agent read`, relevant artifacts.
2. Inspect destination: `agent get`, `agent read`; confirm input-ready state.
3. Send envelope with `agent prompt` or verified pane prompt.
4. Read destination output/state. If it asks a question, preserve ownership until answer is resolved.
5. Record handoff location and recipient identity in any workflow ledger.

Do not use live server `--handoff` for ordinary task ownership; that is platform administration.
