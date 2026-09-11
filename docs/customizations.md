# OMO Customizations

This catalog names supported customization boundaries. It links to current
implementation guidance and reserves detail pages for areas explored later.
Runtime-dependent claims follow the [upstream validation contract](upstream-validation.md).

## Current packages

| Customization | Outcome | Main surface | Detail |
|---|---|---|---|
| Modular extensions | Install one portable feature | `extensions/<name>/` | [Authoring extensions](authoring-extensions.md) |
| Custom providers and models | Add providers and choose models | `extensions/better-custom/` | [Better Custom contract](../extensions/better-custom/AGENTS.md) |
| Herdr | Control Herdr resources and agents | `extensions/herdr/` | [Herdr contract](../extensions/herdr/AGENTS.md) |
| Toolchain and quality | Set local tools and checks | `mise.toml`, Qlty, Biome, prek | [LSP setup](lsp.md) |
| Runtime repairs | Repair known OMO runtime gaps | `scripts/` | [Runtime repairs](runtime-repairs.md) |
| Global agent instructions | Apply durable instructions to every OMO session | `~/.omo/rules/*.md` | [Global instructions](#global-agent-instructions) |
| Model routing | Select workstation model families | OMO model configuration | [Model routing](model-routing.md) |
| Upstream validation | Verify runtime-dependent customization claims | OMO and Senpi authority sources | [Validation contract](upstream-validation.md) |

## Global agent instructions

This is a boundary-crossing customization. Its current evidence record follows
[the upstream validation contract](upstream-validation.md#existing-validation-records).

Use a global OMO rule file for durable instructions. This keeps OMO's generated,
model-specific system prompt, tools, skills, and orchestration active.

### Verified runtime contract

**Verified 2026-09-11** against OMO `5.0.0-0.beta.53`, Senpi
`2026.9.10-2`, and Bun `1.3.14`:

- `~/.omo/rules/*.md` is OMO's durable global instruction surface.
- `--append-system-prompt` adds instructions without replacing the selected
  model preset; live noninteractive check returned the appended `overlay-ok`
  directive with exit `0`.
- `--system-prompt` replaces the base prompt. Senpi detects this as a custom
  prompt and does not apply a model prompt preset.
- OMO's Bun launcher is `/home/egsox/.bun/bin/omo`; it uses Bun unless
  `OMO_RUNTIME=node` is set.

Recheck this section after every OMO or Senpi upgrade. Prompt assembly and rule
loading are upstream runtime behavior, not a stable repository guarantee.

```sh
mkdir -p ~/.omo/rules
$EDITOR ~/.omo/rules/global.md
```

```md
---
description: Global OMO instructions
alwaysApply: true
---

# Global OMO Rules

- Keep responses concise.
- Never commit without explicit user request.
```

Restart OMO after editing. Files under `~/.omo/rules/` apply globally; use
frontmatter `globs` instead of `alwaysApply` when a rule should target only
matching files.

Do not use `SYSTEM.md` or `APPEND_SYSTEM.md`: current Senpi runtime removed
their automatic discovery. OMO maps its agent directory to `~/.omo/agent`, but
`~/.omo/rules/` is the supported persistent global-rule surface.

For a one-run override, use either command with text or an absolute file path:

```sh
omo --append-system-prompt /absolute/path/extra-rules.md
omo --system-prompt /absolute/path/replacement-prompt.md
```

`--append-system-prompt` retains OMO's generated prompt. `--system-prompt`
replaces that base prompt and causes per-model prompt presets to step aside.
Use full replacement only when that loss is intentional.

Sources:

- [OMO configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/configuration.md)
- [Senpi dynamic-prompt changes](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/src/core/dynamic-prompt/changes.md)

## Planned detailed domains

These domains are cataloged now. Do not infer conventions or add packages until
their exploration defines contracts, install boundaries, and verification.

| Domain | Intended outcome | Questions to settle before implementation |
|---|---|---|
| Hooks | Add lifecycle or policy automation | Host hook API, trust model, ordering, persistence, rollback |
| Skills | Add reusable agent guidance | Package discovery, naming, scope, references, load cost, versioning |
| TUI | Add interactive commands or views | Senpi UI APIs, noninteractive behavior, accessibility, terminal QA |
| MCP and tool integrations | Add external capabilities | Credentials, permissions, tool exposure, output limits, failure handling |
| Themes and presentation | Change terminal appearance | Theme format, inheritance, compatibility, visual QA |
| Prompts and templates | Add reusable interaction patterns | Discovery path, precedence, variable contracts, injection boundaries |
| Session and workflow behavior | Change continuation or delegation behavior | Persistence, concurrency, recovery, user control, audit trail |
| Remote extension installation | Install pinned features from GitHub | OMO Git URL and subdirectory syntax, version pinning, trust, rollback |

## Choosing a customization

1. Pick one catalog boundary.
2. Read its linked contract or detail page.
3. Check root and nearest `AGENTS.md` files before editing.
4. Prefer an extension package when capability adds runtime behavior.
5. Keep credentials and machine-local state outside this repository.
6. Record new durable contracts in a detail doc and link it here.

## Documentation rule

This catalog is short by design. It routes users and agents to detail pages; it
does not duplicate implementation instructions. Create a detail page only after
exploration produces stable inputs, outputs, authority rules, and verification.
