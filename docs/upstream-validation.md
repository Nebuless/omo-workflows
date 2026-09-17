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
- Local proof: `herdr --version` returned `herdr 0.9.1`; `herdr agent --help`, `herdr agent prompt --help`, and `herdr agent start --help` passed; `herdr api schema --json` returned protocol `22`, schema version `1`, pane revision, agent status, and `state_change_seq` while observed agent readback exposed no stable agent ID or `interactive_ready`; missing-argument prompt/start invocations rejected nonzero without mutation; read-only `herdr pane get w1J:p1` and `herdr agent get w1J:p1` passed; `omo list --approve` discovered project package `/home/egsox/.herdr/worktrees/omo-workflows/feat-herdr-agent-controls`. Initial focused validation passed 38 tests and 118 assertions. On `2026-09-17`, fresh OMO loaded the merged `herdr` package and registered all six tools: `herdr_inspect`, `herdr_capabilities`, `herdr_query`, `herdr_operation`, `herdr_approval`, and `herdr_preview`. Capability discovery returned Herdr `0.9.1`; typed `pane.get` read-only queries completed; Preview correctly returned unavailable; unavailable start and cross-pane prompt paths rejected before mutation. Reporter state advanced from working seq `221` to done seq `225`. A fresh approval request initially exposed detached `crypto.randomUUID` receiver failure; after local repair and reload, it returned one pending nonce (`requested`) without confirmation or prompt dispatch. `bun test test/herdr-tools.test.ts` and `bun run typecheck` passed after repair. No prompt/start mutation was dispatched; no browser rendering behavior is claimed. Start/profile mappings remain unavailable until stable identity/readiness proof exists.
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

- Verified: `2026-09-17`
- Local runtime: repository Senpi `2026.9.13`; OMO `5.0.0-0.beta.68` with Senpi engine `2026.9.16-3`; Bun `1.3.14`.
- OMO evidence: N/A — Trim imports no OMO API; OMO only discovers packaged extension entrypoint.
- Senpi evidence: https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/src/core/extensions/types.ts defines `SessionBeforeCompactEvent.reason`, cancellable compaction handlers, `agent_settled`, and `ExtensionContext.compact()`.
- Local proof: installed pin declarations expose `threshold`, `manual`, `overflow`, and `extension` reasons; interactive runtime delegates `ctx.compact()` to `AgentSession.compact()`. Focused tests cover threshold veto, preserved manual/overflow compaction, settled forced requests, and safe `/trim shake` guards. Full extension tests, typecheck, build, and live OMO command checks run before closeout.
- Revalidate: Senpi upgrade or compaction-lifecycle API change.
- Status: current.

- [Global OMO instructions](customizations.md#verified-runtime-contract) — verified 2026-09-11; boundary-crossing prompt overlay behavior.
- [Customization scaffolding](customization-scaffolding.md#upstream-evidence) — verified 2026-09-11; OMO configuration and Senpi extension capability map.
