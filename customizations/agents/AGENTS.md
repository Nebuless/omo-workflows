# Agent and Category Customizations

## Purpose

Own OMO agent definitions, delegation categories, permissions, and model chains.

## Ownership

- `.omo/omo.jsonc` owns runtime configuration.
- This directory owns design notes and policy only.

## Local Contracts

- Define category by work type, not provider name.
- Use ordered `models` chains and canonical `reasoning`.
- Set deterministic permissions and tool restrictions; `AGENTS.md` prose is not enforcement.
- Keep custom agents narrow. Curated read-only agents remain in-process.

## Work Guidance

- Test unavailable provider and fallback behavior before routing work to a new category.
- Record task concurrency, depth, and external-data implications when categories can delegate.

## Verification

- Validate config against OMO schema and run a safe task spawn.

## Child DOX Index

No child boundaries.
