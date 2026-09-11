# Memory Customizations

## Purpose

Own OMO and Senpi durable-memory policy, retention, recall boundaries, and fact lifecycle.

## Ownership

- `.omo/omo.jsonc` owns OMO memory configuration.
- Senpi extensions own custom persistence behavior.

## Local Contracts

- Store durable decisions, discoveries, user preferences, and repair facts.
- Do not persist secrets, raw credentials, or transient tool output without a specific retention need.
- Separate project facts from person facts and state retention or review rules.

## Work Guidance

- Prefer existing memory subsystem settings before custom persistence code.
- Define recall scope, write trigger, conflict policy, and deletion path before extension work.

## Verification

- Verify save, scoped recall, restart persistence, conflict handling, and opt-out behavior.

## Child DOX Index

No child boundaries.
