# OMO and Senpi Upstream Validation

Use this record for customization behavior that depends on OMO or Senpi runtime
contracts. Verify installed behavior first, then fetch current upstream evidence
from the owning repository before editing.

## Authorities

| Layer | Authority | Validate when |
|---|---|---|
| OMO | [`code-yeongyu/oh-my-openagent`](https://github.com/code-yeongyu/oh-my-openagent) | CLI, config, rules, OMO hooks, bundled extensions, packaging |
| Senpi | [`code-yeongyu/senpi`](https://github.com/code-yeongyu/senpi) | system prompt, presets, core runtime, extension lifecycle, tools |

A boundary-crossing change validates both. A single-layer change validates only
its owner and records why the other authority did not apply.

## Required record

Add this record to the owning customization document when a claim depends on
runtime behavior. Do not record unrelated repository-only documentation or test
changes.

```md
### <Customization name>

- Verified: `YYYY-MM-DD`
- Local runtime: OMO `<version>`; Senpi `<version>`; Bun `<version>`
- OMO evidence: `<exact URL or N/A — reason>`
- Senpi evidence: `<exact URL or N/A — reason>`
- Local proof: `<command and observed result>`
- Revalidate: `<OMO upgrade | Senpi upgrade | both>`
- Status: `current`
```

Use an immutable revision URL when upstream history is material to the claim.
Otherwise cite the exact current source or documentation URL inspected on the
verification date.

## Lookup matrix

| Customization change | Required evidence |
|---|---|
| OMO rules, `omo.jsonc`, OMO CLI, OMO hooks | OMO upstream plus installed runtime |
| Senpi prompt builder, presets, tools, extension lifecycle | Senpi upstream plus installed runtime |
| OMO extension behavior that depends on Senpi | Both upstreams plus installed runtime |
| Repository-only docs, tests, or formatting | Neither, unless a runtime claim changes |

## Current extension compatibility

### Better Custom

- Verified: `2026-09-16`
- Local runtime: repository Senpi `2026.9.13`; global OMO `5.0.0-0.beta.68` with Senpi `2026.9.16-3`.
- OMO evidence: https://github.com/code-yeongyu/oh-my-openagent/tree/main/packages/omo-senpi
- Senpi evidence: https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/src/core/extensions/types.ts
- Local proof: `bun test extensions/better-custom/test test/extension-load.test.ts`, `bun run typecheck`, and live global OMO load of all four extensions pass.
- Revalidate: OMO or Senpi upgrade, provider registration API change, or model-registry API change.
- Status: current.

### Compound Engineering

- Verified: `2026-09-16`
- Local runtime: repository Senpi `2026.9.13`; global OMO `5.0.0-0.beta.68` with Senpi `2026.9.16-3`.
- OMO evidence: https://github.com/code-yeongyu/oh-my-openagent/tree/main/packages/omo-senpi
- Senpi evidence: https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/src/core/extensions/types.ts
- Adapted upstream evidence: https://github.com/EveryInc/compound-engineering-plugin/tree/44d65ad64a0ac8e542eabee31ce031a7aeb41b28
- Local proof: `bun test extensions/compound-engineering/test`, an offline OMO invocation discovers packaged `ce-*` skills, and live global OMO load of all four extensions passes.
- Revalidate: OMO or Senpi upgrade, resource-discovery contract change, or Compound Engineering refresh.
- Status: current.

### Herdr

- Verified: `2026-09-17`
- Local runtime: OMO `5.0.0-0.beta.68` (engine Senpi `2026.9.16-3`); repository Senpi `2026.9.13`; Bun `1.3.14`; Herdr `0.9.1`; terminal-browser `0.8.1`.
- OMO evidence: https://github.com/code-yeongyu/oh-my-openagent/tree/main/packages/omo-senpi
- Senpi evidence: https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/src/core/extensions/types.ts
- Local proof: `herdr --version`, `herdr --help` family discovery, `herdr api schema --json`, focused Herdr tests, `bun run typecheck`, and `bun run build`.
- Revalidate: OMO or Senpi upgrade, lifecycle-event or tool-registration API change, Herdr command inventory/version change, or terminal-browser Herdr-tab rendering proof.
- Status: current.

### Model Routing Advisor

- Verified: `2026-09-16`
- Local runtime: repository Senpi `2026.9.13`; global OMO `5.0.0-0.beta.68` with Senpi `2026.9.16-3`; Bun `1.3.14`.
- OMO evidence: https://github.com/code-yeongyu/oh-my-openagent/tree/fbcc57e374c180c41ffc8562c0ab7e7414935811/packages/omo-senpi documents OMO package loading. OMO owns route configuration and task admission, not this read-only tool.
- Senpi evidence: https://github.com/code-yeongyu/senpi/blob/f32905c8199b70e45acd866159170d390e48715b/packages/coding-agent/src/core/extensions/types.ts exposes `ExtensionAPI.registerTool` and `ExtensionContext.modelRegistry`; https://github.com/code-yeongyu/senpi/blob/f32905c8199b70e45acd866159170d390e48715b/packages/coding-agent/src/core/model-registry.ts exposes catalog/auth access. Neither public surface proves fresh, complete per-provider dispatch availability.
- Local proof: installed `node_modules/@code-yeongyu/senpi@2026.9.13` declarations expose `registerTool`, `modelRegistry.getAll()`, `find()`, `hasConfiguredAuth()`, and provider-auth access; focused tests prove absent caller observation returns conservative unknown. The adapter never calls model selection, task, config, provider registration, or provider dispatch APIs.
- Revalidate: OMO or Senpi upgrade, extension tool API change, or model-registry availability/auth contract change.
- Status: current.

### Trim

- Verified: `2026-09-16`
- Local runtime: repository Senpi `2026.9.13`; global OMO `5.0.0-0.beta.68` with Senpi `2026.9.16-3`.
- OMO evidence: N/A — Trim imports no OMO API.
- Senpi evidence: https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/src/core/extensions/types.ts
- Local proof: `bun test extensions/trim/test`, `bun run typecheck`, and live global OMO load of all four extensions pass.
- Revalidate: Senpi upgrade or compaction-lifecycle API change.
- Status: current.

- [Global OMO instructions](customizations.md#verified-runtime-contract) — verified 2026-09-11; boundary-crossing prompt overlay behavior.
- [Customization scaffolding](customization-scaffolding.md#upstream-evidence) — verified 2026-09-11; OMO configuration and Senpi extension capability map.
