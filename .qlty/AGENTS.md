# Qlty Configuration

## Purpose

Own repository-wide Qlty analysis policy.

## Ownership

- `qlty.toml` owns source selection, plugins, exclusions, and explicit triage.

## Local Contracts

- Keep correctness and security findings blocking.
- Limit triage to documented, scope-specific upstream-source exceptions.
- Exclude generated state, never durable source or tests.

## Work Guidance

- Update this file when plugin policy or triage scope changes.

## Verification

- `mise x -- qlty check --all`

## Child DOX Index

No child documentation boundaries exist.
