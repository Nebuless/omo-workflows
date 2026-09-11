# Tool and Provider Customizations

## Purpose

Own LLM-callable tools and runtime provider/model registration.

## Ownership

- Senpi extension packages own implementation.
- This directory owns policy and design notes.

## Local Contracts

- Define strict TypeBox input schemas with `additionalProperties: false`.
- Use argv execution, bounded output, cancellation signals, and explicit exit errors.
- Separate inspection from mutation and require approval for destructive, privileged, or external calls.

## Work Guidance

- Use provider registration only when configuration cannot represent provider behavior.
- Keep provider credentials in environment resolution, never source or portable docs.

## Verification

- Run one safe tool call, invalid-input call, and discovery check in live OMO.

## Child DOX Index

No child boundaries.
