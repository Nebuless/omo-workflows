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

## Existing validation records

- [Global OMO instructions](customizations.md#verified-runtime-contract) —
  verified 2026-09-11; boundary-crossing prompt overlay behavior.
- [Customization scaffolding](customization-scaffolding.md#upstream-evidence) —
  verified 2026-09-11; OMO configuration and Senpi extension capability map.
