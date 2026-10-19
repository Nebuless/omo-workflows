# Compound Intent-Driven OpenSpec Schema

`compound-intent-driven` keeps OpenSpec as workflow authority while adapting
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)'s
core engineering loop:

```text
define -> plan -> build -> simplify -> review -> compound
```

It maps that loop onto OpenSpec artifacts instead of creating parallel plan or
tracker files:

- `proposal` defines intent, alternatives, scope, success signals, and prior
  learning (`ce-brainstorm`).
- `specs` makes each approved capability observable and testable.
- `design` records execution guardrails, stable implementation units, seams,
  risks, and targeted proofs (`ce-plan`).
- `adr` keeps only durable architecture decisions.
- `tasks` converts units into vertical, dependency-ordered, tracked slices.
- `apply` implements, simplifies settled code, reviews final diff, validates,
  then captures only durable lessons (`ce-work`, `ce-simplify-code`,
  `ce-code-review`, `ce-compound`).

- Good fit: non-trivial product or platform work needing explicit intent,
  reusable learning, and a bounded build-review loop.
- Not a good fit: small tactical fixes, documentation-only changes, dependency
  bumps, or changes with no material decision; use `minimalist` instead.

## Activate

```yaml
schema: compound-intent-driven
```

## Stage Gates

```text
proposal -> (specs, design) -> adr -> tasks -> apply
```

`specs` and `design` each require `proposal` and may proceed in parallel. `adr`
requires `design`; `tasks` requires `specs` and `adr`; `apply` tracks
`tasks.md` checkboxes.

The loop is intentionally compact:

1. **Define:** `proposal.md` resolves user-visible intent before implementation.
   It uses repository evidence and relevant `docs/solutions/` learnings first;
   user questions remain only for material decisions evidence cannot settle.
2. **Plan:** `design.md` turns approved intent into implementation guardrails.
   Stable `U1`, `U2`, … units own seams, likely integration points, and targeted
   proof. They never renumber.
3. **Build:** apply implements a vertical task in dependency order, follows the
   repository's patterns, and runs its named proof before checking its box.
4. **Simplify:** each settled code unit gets a scope-bounded reuse, clarity, and
   efficiency pass. Mechanical and docs-only changes skip it.
5. **Review:** final diff is checked against the change artifacts, in-force ADR
   context, and project standards. Verified in-scope findings are fixed.
6. **Compound:** a learning is written only when its reasoning is non-obvious,
   durable, material, and not already recoverable from code, tests, comments,
   or existing documentation.

## Spec Format

Specs use normal OpenSpec Markdown deltas. Each requirement uses
`### Requirement:` plus SHALL/MUST wording. Each scenario uses exactly
`#### Scenario:` with `GIVEN`, `WHEN`, and `THEN` steps. Every requirement has
at least one scenario. A `MODIFIED` requirement copies its complete existing
block from `openspec/specs/<capability>/spec.md` before editing.

This schema does not install an executable-spec harness. Existing repository
tests or the targeted proof named by each task remain verification authority.

## ADR Persistence

`adr.md` is a change-local review manifest. Repository-level decisions live in
`<repo>/adr/`. Accepted ADRs stay immutable; a new decision creates a new ADR
with `Supersedes:` rather than changing prior text.

## Validate

```bash
openspec schema validate compound-intent-driven
```

## Associated Skills

`skills.txt` declares source-qualified, MIT-licensed core-loop skills from
[EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin).
Run the catalog installer to copy them into a target project's
`.agents/skills/`:

```bash
bash /path/to/openspec-schemas/scripts/install-schema-skills.sh \
  openspec/schemas/compound-intent-driven .
```

- `ce-brainstorm` — intent, alternatives, scope boundaries, and success signals.
- `ce-plan` — evidence-grounded implementation guardrails and stable units.
- `ce-work` — implementation plus targeted local verification.
- `ce-simplify-code` — behavior-preserving cleanup of settled code.
- `ce-code-review` — diff review against intent and project standards.
- `ce-compound` — durable learning capture when it clears its eligibility bar.

The source plugin is MIT licensed. This schema is an independent, compact
mapping of its documented core loop to OpenSpec artifacts; it does not copy the
plugin's complete workflow or create a competing lifecycle.
