# Session and Workflow Customizations

## Purpose

Own session state, compaction, task concurrency, teams, and continuation behavior.

## Ownership

- `.omo/omo.jsonc` owns task, team, memory, and profile configuration.
- Senpi extensions own custom session behavior.

## Local Contracts

- Define state lifetime, restart behavior, concurrency bound, and user cancellation route.
- Persist only minimal state through supported Senpi session APIs.
- Treat cross-provider task fallback as a data-handling decision.

## Work Guidance

- Avoid background resources in extension factory.
- Do not replace session context or compaction without recovery tests.

## Verification

- Exercise fresh session, resumed session, cancellation, and shutdown behavior.

## Child DOX Index

No child boundaries.
