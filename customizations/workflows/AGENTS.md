# Session and Workflow Customizations

## Purpose

Own session state, compaction, native tasks/DAG/workpool, teams, scheduled
prompts, durable monitors, and continuation behavior.

## Ownership

- `.omo/omo.jsonc` owns task, team, memory, and profile configuration.
- Senpi extensions own custom session behavior.

## Local Contracts

- Define state lifetime, restart behavior, concurrency bound, and user cancellation route.
- Persist only minimal state through supported Senpi session APIs.
- Treat cross-provider task fallback as a data-handling decision.
- Native owns scheduling, child lifecycles, recovery, and completion delivery.
  `auto` execution and session-scoped hosts are separate from Team Mode.
- A cancelled threshold request does not veto native overflow/manual compaction.

## Work Guidance

- Avoid background resources in extension factory.
- Do not replace session context or compaction without recovery tests.

## Verification

- Exercise fresh session, resumed session, cancellation, and shutdown behavior.

## Child DOX Index

No child boundaries.
