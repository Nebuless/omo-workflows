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

- Verified: `2026-09-18` (native compatibility boundary, documentation, and isolated request proof)
- Local runtime evidence: global OMO `5.0.0-0.beta.75` with engine Senpi `2026.9.18-4`; repository Senpi `2026.9.13`; Bun `1.3.14`; provider `9router`; model `cx/gpt-5.6-luna`.
- OMO evidence: https://github.com/code-yeongyu/oh-my-openagent/tree/6fdcacb33c59a869c0b39ac52a89173a3c5ed1f5/packages/omo-senpi — OMO owns extension loading and host packaging; its native request transport is not changed by this profile boundary.
- Senpi evidence: https://github.com/code-yeongyu/senpi/blob/7d174a98ff6c42a45529e022914c3b9903b6a25c/packages/coding-agent/src/core/extensions/types.ts — public extension and model-host boundary; Senpi owns mapped effort resolution and request construction.
- Native transport evidence: https://github.com/can1357/oh-my-pi/blob/62a4aa98a4b52f829a3ae9a5247ca8db4e5f810c/packages/ai/src/providers/openai-completions.ts — OpenAI-completions request transport; Better Custom supplies native metadata and does not intercept requests.
- Gateway evidence: https://github.com/decolua/9router/blob/a8c9d3802c5933500fba95416f5bf0c130581396/docs/superpowers/specs/2026-08-02-gpt-5-6-codex-reasoning-overrides-design.md — CX model effort matrix used for exact profile boundary: `9router/cx/gpt-5.6-luna`, `9router/cx/gpt-5.6-sol`, and `9router/cx/gpt-5.6-terra` only.
- Local proof: isolated OMO run with `OMO_CODING_AGENT_DIR`, `SENPI_CODING_AGENT_DIR`, and `HOME` under `/home/egsox/.cache/omo-9router-verify` sent one request to a loopback capture proxy and received its synthetic `OK` response. The capture recorded `POST /v1/chat/completions` for `cx/gpt-5.6-luna` with `reasoning_effort: "low"` when invoked with `--thinking minimal`. This proves outbound payload construction only. In contrast, a live authenticated global OMO run of the same model with `--thinking minimal` exited `1` with OMO `503` wrapping a 9router `400` that rejected `minimal`. The active `~/.omo/agent/models.json` Luna entry lacks `thinkingLevelMap`, so that run did not receive persisted native-map metadata. `bun test extensions/better-custom/test test/extension-load.test.ts` passed 40 tests and 169 assertions; `bun run typecheck` and `bun run build` passed.
- Boundary: generic per-model `thinkingLevelMap` uses canonical OMO keys `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; model-scoped `compat.supportsReasoningEffort: true` enables native mapped effort for OpenAI-completions entries. Observed or persisted map/compatibility metadata takes precedence over static defaults. Senpi owns request construction.
- Incident: 9router rejected Luna provider-facing `minimal` with HTTP `400`; the direct authenticated run revalidated that response. Better Custom maps Luna `minimal → low` and `xhigh → max`; Sol/Terra map `xhigh → ultra` and preserve `max`.
- Revalidate: 9router gateway or model effort-contract change; profile identity/map change; OMO, Senpi, or Oh My Pi upgrade; request-construction or model-compatibility change; active configuration migration; or new server-side request/fetch diagnostics.
- Status: direct gateway-response proof complete; active global configuration still lacks the native map, so the live compatibility path fails.

### Compound Engineering

- Verified: `2026-09-18`
- Local runtime: repository Senpi `2026.9.13`; global OMO `5.0.0-0.beta.72` with Senpi `2026.9.18-2`; Bun `1.3.14`.
- OMO evidence: N/A — this repair uses only Senpi's public resource-discovery callback; OMO loads the standalone package but does not own its resource-path resolution.
- Senpi evidence: https://github.com/code-yeongyu/senpi/blob/7d174a98ff6c42a45529e022914c3b9903b6a25c/packages/coding-agent/src/core/extensions/types.ts defines `resources_discover` and the resolved `loadedExtensionPaths` context used by this package.
- Adapted upstream evidence: https://github.com/EveryInc/compound-engineering-plugin/tree/44d65ad64a0ac8e542eabee31ce031a7aeb41b28
- Local proof: Focused regression first proved checkout-relative discovery wrong, then `bun test extensions/compound-engineering/test/extension.test.ts test/extension-load.test.ts test/herdr-tools.test.ts` passed 28 tests and 98 assertions. Live `omo -e ./extensions/compound-engineering --print ...` exited `0`, listed packaged `ce-*` skills, and emitted no resource-path or extension-load error.
- Revalidate: OMO or Senpi upgrade, resource-discovery contract change, or Compound Engineering refresh.
- Status: current.

### Herdr

- Verified: `2026-09-18`
- Local runtime: OMO `5.0.0-0.beta.72` (engine Senpi `2026.9.18-2`); repository Senpi `2026.9.13`; Bun `1.3.14`; Herdr `0.9.1`; terminal-browser `0.8.1`.
- OMO evidence: N/A — this repair uses only Senpi's public resource-discovery callback; OMO loads the standalone package but does not own its resource-path resolution.
- Senpi evidence: https://github.com/code-yeongyu/senpi/blob/7d174a98ff6c42a45529e022914c3b9903b6a25c/packages/coding-agent/src/core/extensions/types.ts defines `resources_discover` and the resolved `loadedExtensionPaths` context used by this package.
- Local proof: Existing Herdr command and capability evidence remains current. Focused regression first proved checkout-relative discovery wrong, then `bun test extensions/compound-engineering/test/extension.test.ts test/extension-load.test.ts test/herdr-tools.test.ts` passed 28 tests and 98 assertions. Live `omo -e ./extensions/herdr --print ...` exited `0`, listed packaged Herdr skills and tools, and emitted no resource-path or extension-load error. No prompt/start mutation was dispatched; no browser rendering behavior is claimed. Start/profile mappings remain unavailable until stable identity/readiness proof exists.
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
- Senpi evidence: https://github.com/code-yeongyu/senpi/blob/7d174a98ff6c42a45529e022914c3b9903b6a25c/packages/coding-agent/src/core/extensions/types.ts defines `SessionBeforeCompactEvent.reason`, cancellable compaction handlers, `agent_settled`, and `ExtensionContext.compact()`.
- Local proof: installed pin declarations expose `threshold`, `manual`, `overflow`, and `extension` reasons; interactive runtime delegates `ctx.compact()` to `AgentSession.compact()`. Focused tests cover threshold veto, preserved manual/overflow compaction, settled forced requests, and safe `/trim shake` guards. Full extension tests, typecheck, build, and live OMO command checks run before closeout.
- Revalidate: Senpi upgrade or compaction-lifecycle API change.
- Status: current.

- [Global OMO instructions](customizations.md#verified-runtime-contract) — verified 2026-09-11; boundary-crossing prompt overlay behavior.
- [Customization scaffolding](customization-scaffolding.md#upstream-evidence) — verified 2026-09-11; OMO configuration and Senpi extension capability map.
