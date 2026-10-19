# OMO Customizations

This catalog names supported customization boundaries. It links to current
implementation guidance and reserves detail pages for areas explored later.
Runtime-dependent claims follow the [upstream validation contract](upstream-validation.md).

## Current packages

| Customization | Outcome | Main surface | Detail |
|---|---|---|---|
| Modular extensions | Install one portable feature | `extensions/<name>/` | [Authoring extensions](authoring-extensions.md) |
| Compound Engineering | Run Every's 35-skill engineering loop natively | `extensions/compound-engineering/` | [Package guide](../extensions/compound-engineering/README.md) |
| Custom providers and models | Add providers and choose models | `extensions/better-custom/` | [Better Custom contract](../extensions/better-custom/AGENTS.md) |
| Herdr | Control Herdr resources and agents | `extensions/herdr/` | [Herdr contract](../extensions/herdr/AGENTS.md) |
| Toolchain and quality | Set local tools and checks | `mise.toml`, Qlty, Biome, prek | [LSP setup](lsp.md) |
| Runtime repairs | Repair known OMO runtime gaps | `scripts/` | [Runtime repairs](runtime-repairs.md) |
| Global agent instructions | Apply durable instructions to every OMO session | `~/.omo/rules/*.md` | [Global instructions](#global-agent-instructions) |
| Model routing | Select workstation model families | OMO model configuration | [Model routing](model-routing.md) |
| Upstream validation | Verify runtime-dependent customization claims | OMO and Senpi authority sources | [Validation contract](upstream-validation.md) |
| Full customization map | Choose capability boundary and creation policy | `customizations/<domain>/` | [Customization scaffolding](customization-scaffolding.md) |

## Global agent instructions

This is a boundary-crossing customization. Its current evidence record follows
[the upstream validation contract](upstream-validation.md#existing-validation-records).

Use a global OMO rule file for durable instructions. This keeps OMO's generated,
model-specific system prompt, tools, skills, and orchestration active.

### Verified runtime contract

**Verified 2026-10-16** against OMO `5.1.34` (release
`d7e224e478a4a77dba0d2104c336fdc72ad301e3`) and its Senpi `2026.10.16`
pairing (release `8b62d4a6d16fd1d6d3787d30fbc8e1059b357623`):

- `~/.omo/rules/*.md` is OMO's durable global instruction surface.
- `--append-system-prompt` adds instructions without replacing the selected
  model preset; live noninteractive check returned the appended `overlay-ok`
  directive with exit `0`.
- `--system-prompt` replaces the base prompt. Senpi detects this as a custom
  prompt and does not apply a model prompt preset.
- Senpi extensions can add rule resources through `resources_discover`; OMO
  5.1.34's installed dynamic-resources example also returns `themePaths`.

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

- [OMO configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/d7e224e478a4a77dba0d2104c336fdc72ad301e3/docs/reference/configuration.md)
- [Senpi extension guide](https://github.com/code-yeongyu/senpi/blob/8b62d4a6d16fd1d6d3787d30fbc8e1059b357623/packages/coding-agent/docs/extensions.md)
- [Senpi theme guide](https://github.com/code-yeongyu/senpi/blob/8b62d4a6d16fd1d6d3787d30fbc8e1059b357623/packages/coding-agent/docs/themes.md)

## Capability scaffolds

[`customizations/`](../customizations/) now owns policy-first directory scaffolds
for every verified OMO or Senpi customization boundary: agents, profiles,
instructions, skills, hooks, commands, tools, MCP, TUI, workflows, memory,
automation, integrations, and operational controls. The full capability map,
creation sequence, and upstream evidence are in
[customization scaffolding](customization-scaffolding.md).

These folders are not runtime discovery paths. Use them to settle scope,
permissions, lifecycle, persistence, and verification. Place runnable behavior
in an independently installable `extensions/<name>/` package.

Themes belong under the existing TUI policy domain, not a separate scaffold.
Senpi loads JSON themes from global and trusted-project locations, package
`themes/` directories and `pi.themes` entries, configured paths, and CLI paths.
Extensions may contribute theme resources through the `themePaths` returned
by `resources_discover`; this resource-discovery behavior is distinct from
theme-package discovery.

## Choosing a customization

1. Pick one catalog boundary.
2. Read its linked contract or policy scaffold.
3. Check root and nearest `AGENTS.md` files before editing.
4. Prefer an extension package when capability adds runtime behavior.
5. Keep credentials and machine-local state outside this repository.
6. Record new durable contracts in a detail doc and link it here.

## Documentation rule

This catalog is short by design. It routes users and agents to detail pages and
policy scaffolds; it does not duplicate implementation instructions. Create a
detail page only after exploration produces stable inputs, outputs, authority
rules, and verification.
