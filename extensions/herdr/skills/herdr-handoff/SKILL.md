---
name: herdr-handoff
hide: true
description: Transfer ordinary work ownership between Herdr agents without losing scope, evidence, or next actions.
---

# Herdr Handoff

Use only when work ownership changes. Use `herdr-agent-management` to prompt a worker without transferring ownership. Use `herdr-orchestration` when coordinator retains workflow ownership across multiple workers.

## Rules

- Identify the platform with `herdr`; verify source and destination identities before handoff. Current core uses terminal IDs; legacy control requires `HERDR_ENV=1` and a pane ID.
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

1. Inspect source and destination with current `herdr_desktop` core observations or available legacy agent observations, plus relevant artifacts.
2. Confirm destination readiness and the authorized delivery route.
3. Deliver through native OMO task messaging, or an available typed legacy prompt with verified target proof. Current desktop inspection cannot send a handoff; retain ownership when no delivery route exists.
4. Read destination output/state. If it asks a question, preserve ownership until answer is resolved.
5. Record handoff location and recipient identity in any workflow ledger.

Do not use live server `--handoff` for ordinary task ownership; that is platform administration.
