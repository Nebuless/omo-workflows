# Hook and Guard Customizations

## Purpose

Own lifecycle interception, deterministic policy gates, context transforms, and cleanup behavior.

## Ownership

- Senpi extensions own runtime hook code.
- OMO hook configuration owns host-level activation.

## Local Contracts

- Block unsafe actions in code or configuration, never prose alone.
- Keep hooks idempotent and ordered by explicit dependency.
- Start resources after `session_start`; close them in `session_shutdown`.

## Work Guidance

- Name event, mutation or block result, trust boundary, and failure behavior in design notes.
- Do not mutate provider payloads or session state without focused regression tests.

## Verification

- Exercise allowed, blocked, and shutdown paths in live session.

## Child DOX Index

No child boundaries.
