# Compound Engineering for OMO

Native OMO/Senpi package for Every's Compound Engineering workflows. It exposes
the upstream skill collection through Senpi resource discovery; OMO handles
skill selection and deterministic `/skill:<name>` invocation.

## Install

From this repository root:

```sh
omo install -l ./extensions/compound-engineering
```

Restart OMO or run `/reload`. Invoke a skill explicitly when needed:

```text
/skill:ce-brainstorm safer background job retries
/skill:ce-plan
/skill:ce-work
/skill:ce-simplify-code
/skill:ce-code-review
/skill:ce-compound
```

`/skill:lfg` runs the upstream autonomous shipping pipeline. It may commit,
push, and open a PR under its own documented gates. Read the skill before use.

## Native adaptation

- `src/index.ts` uses Senpi's public `resources_discover` event.
- `skills/` is an unchanged copy of the pinned upstream skill tree.
- No Claude, Codex, OpenCode, or Pi compatibility shim runs inside OMO.
- Optional tools and host-specific actions remain capability-gated by each
  upstream skill.

This package adds no aliases for upstream slash commands. OMO's stable manual
surface is `/skill:<name>`; model routing can select visible skills naturally.

## Compatibility

Verified against OMO `5.0.0-0.beta.53`, Senpi `2026.9.10-2`, and Bun
`1.3.14`. Upstream version and immutable revision are in [UPSTREAM.md](UPSTREAM.md).

## Verify

```sh
bun test extensions/compound-engineering/test
bun run typecheck
