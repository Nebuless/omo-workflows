# Architecture Decisions

## Purpose

Record immutable, repository-level architecture decisions that future changes must honor.

## Ownership

- Each numbered ADR owns one accepted durable decision.
- `openspec/changes/*/adr.md` owns change-local ADR review manifests.

## Local Contracts

- Accepted ADRs are immutable. A changed decision requires a new incremented ADR with a `Supersedes` field.
- Use `NNNN-kebab-case.md` filenames.
- Keep decision, context, and consequences concise and operational.

## Work Guidance

- Create an ADR only for material, long-lived architecture commitments.
- Update the originating OpenSpec ADR manifest in the same change.

## Verification

- Confirm new ADR references appear in the originating OpenSpec ADR manifest.

## Child DOX Index

- None.
