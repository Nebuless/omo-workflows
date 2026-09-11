# MCP Customizations

## Purpose

Own MCP server selection, configuration, credential boundaries, and output limits.

## Ownership

- OMO config, skill metadata, or an extension owns runtime registration.
- This directory owns integration policy.

## Local Contracts

- Prefer built-in MCPs before adding a server.
- Grant smallest credential and tool scope.
- Keep user-only environment allowlists and browser arguments in user configuration.

## Work Guidance

- Record transport, trust model, auth source, read/write surface, and output budget.
- Do not expose secret-bearing tools through generic agent roles.

## Verification

- Verify server discovery, one safe call, absent credentials, and denied mutation behavior.

## Child DOX Index

No child boundaries.
