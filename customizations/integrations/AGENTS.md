# External Integration Customizations

## Purpose

Own API, webhook, CI, daemon, and remote-system customizations.

## Ownership

- A dedicated Senpi extension owns runtime integration code.
- This directory owns architecture and security policy.

## Local Contracts

- Use one extension per external system or tightly coupled integration.
- Define authentication source, permission scope, rate and output bounds, audit trail, and rollback before implementation.
- Require approval for every remote mutation.

## Work Guidance

- Use lifecycle hooks for session-scoped clients and clean them up on shutdown.
- Never write credentials, tokens, endpoint secrets, or local account identifiers to repository files.

## Verification

- Test unauthenticated, read-only, approved mutation, API error, and shutdown cleanup paths.

## Child DOX Index

No child boundaries.
