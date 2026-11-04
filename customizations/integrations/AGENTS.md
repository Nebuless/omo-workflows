# External Integration Customizations

## Purpose

Own hosted web search, app-server, API, webhook, CI, daemon, and remote-system customizations.

## Ownership

- A dedicated Senpi extension owns runtime integration code.
- Native settings own existing integrations such as `websearch.json`;
  app-server and host commands own their native session lifecycles.
- This directory owns architecture and security policy.

## Local Contracts

- Use one extension per external system or tightly coupled integration.
- Define authentication source, permission scope, rate and output bounds, audit trail, and rollback before implementation.
- Require approval for every remote mutation.
- Prefer native integration settings before extension code. Search-provider
  fallback changes where queries are sent; document the configured provider set.

## Work Guidance

- Use lifecycle hooks for session-scoped clients and clean them up on shutdown.
- Never write credentials, tokens, endpoint secrets, or local account identifiers to repository files.

## Verification

- Test unauthenticated, read-only, approved mutation, API error, and shutdown cleanup paths.

## Child DOX Index

No child boundaries.
