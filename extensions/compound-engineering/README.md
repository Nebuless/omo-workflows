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

Target pairing: OMO `5.1.34` with bundled Senpi `2026.10.16`. The current OMO
RPC smoke loaded the extension and discovered its 35 packaged skills after
replacing unsupported `import.meta.dirname` path resolution. Focused package
tests, extension loading, build, and typecheck passed. The complete suite has
497 passing tests and three historical repair failures requiring an absent old
global artifact; see [compatibility](../../docs/compatibility.md).
Standalone Senpi `2026.10.16-3` is not the OMO pairing.
Upstream skill version and immutable revision are in [UPSTREAM.md](UPSTREAM.md).

## Verify

```sh
bun test extensions/compound-engineering/test
bun run typecheck
