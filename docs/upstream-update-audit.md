# Historical OMO Customization Update Audit

Audited 2026-10-01. This is a historical snapshot, not the current integration
target or a new verification run. It covers the move from September evidence
to OMO 5.1.8 and the five extensions present then.

Superseded by the target and evidence in [compatibility](compatibility.md) and
[upstream validation](upstream-validation.md). Later remote changes added a
Better Custom standalone manifest, updated the SDK/resource contract and
routing templates, recorded the formatter opt-out in the [issue register](issues.md),
and added Repetition Recovery. The gaps below describe October 1 only.

## Versions and evidence

| Boundary | Audited version |
|---|---|
| Installed OMO | `5.1.8`, released `2026-10-01T15:00:33Z` |
| OMO source | `ac28307c18c247dea911160fd63654e1cdd0da9f` |
| Installed Senpi engine | `2026.10.1-2` |
| Released Senpi source | `ecbe5c9b82db1a2267148a8da900be4c7e08165f` |
| Inspected newer Senpi source | `0455f7839f4e142f158e2e7cdd4113b520283ec3` |
| Repository compile/test dependency | Senpi `2026.9.13` |
| Local Bun | `1.3.14` |

The [OMO release](https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v5.1.8),
[configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/ac28307c18c247dea911160fd63654e1cdd0da9f/docs/reference/configuration.md),
[native configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/ac28307c18c247dea911160fd63654e1cdd0da9f/docs/reference/omo-json.md),
and released [Senpi extension guide](https://github.com/code-yeongyu/senpi/blob/ecbe5c9b82db1a2267148a8da900be4c7e08165f/packages/coding-agent/docs/extensions.md)
are the authorities for the released behavior below. Newer Senpi `main` is not
the installed engine. Historical issue records retain their original versions
and proof rather than being relabeled as current.

## Changes requiring customization review

| ID | Change | Repository consequence |
|---|---|---|
| U1 | OMO 5.0.0 made Native stable. The default npm channel no longer requires `@beta`. | Installation guidance uses `bun add -g omo-ai` and the native install guide. |
| U2 | `deep` split into `deep-low` and `deep-high`; the old name is migrated/canonicalized to `deep-low`. | New examples use canonical names. Existing portable templates are historical routing snapshots, not new upstream defaults. |
| U3 | Config resolves shared keys, the current harness block, the selected profile, then that profile's harness block. `[native]` is canonical; `[senpi]` is legacy. | Native agent overrides must not be documented as `[opencode]` settings. |
| U4 | `profiles.<name>` selects a config layer. `model_profile` selects a main-session model chain. | Keep both separate from task categories and repository files named routing profiles. |
| U5 | Built-in routes use their declared providers. A gateway is not silently admitted merely because it sells the same model. | Explicit `9router` routes remain local policy. Availability advice does not authorize or select a fallback. |
| U6 | Default task execution is `auto`, with session-scoped hosts where supported; curated agents stay in-process. | Document task, workpool/DAG, and Team Mode separately. Do not replace native scheduling with an extension. |
| U7 | Recall gained multilingual matching and opt-in `memory.recall.query_expansion`, default `false`. | Document the new setting without enabling it in the templates. |
| U8 | Native Computer Use is experimental and distinct from browser automation. | Cover OS support, `computer.enabled`, read/input permissions, `/computer status`, and the human-only stop/resume path. |
| U9 | Native resources include extensions, skills, prompt templates, hooks, and JSON themes. | Remove the unsupported-theme-contract claim. These resources do not require separate policy folders. |
| U10 | Native scheduled prompts, durable monitors, model discovery, app-server, and host diagnostics are available. | Cover them under workflows, tools, integrations, and operations rather than creating replacement extensions. |
| U11 | Skill aliases, required-argument hints, and same-name user/package skill precedence improved. | Keep `/skill:<name>` as the explicit package invocation. Skill visibility and tool availability are separate controls. |
| U12 | Skill-declared remote MCP servers cannot obtain a `bearerTokenEnv` token; authenticated remote servers belong in user `mcp.json`. | Distinguish configured servers, built-ins, skill servers, and extension registrations. Verify visibility in the selected child execution mode. |
| U13 | Engine snapshots keep existing sessions working through updates. The bundled comment checker was repaired upstream. | Describe the repair script as historical, not a current installation step. The comment-checker script is an unconditional global install, unlike the guarded runtime patches. |

U1 is documented by the [5.0.0 release](https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v5.0.0).
U2 is documented by [beta.80](https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v5.0.0-beta.80).
U3-U4 follow the pinned configuration references above.
U5-U6 follow [5.1.1](https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v5.1.1)
and the native task reference.
U8-U10 follow [5.1.0](https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v5.1.0)
and the released Senpi [package contract](https://github.com/code-yeongyu/senpi/blob/ecbe5c9b82db1a2267148a8da900be4c7e08165f/packages/coding-agent/docs/packages.md).
U11-U13 follow [5.1.2](https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v5.1.2),
[5.1.6](https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v5.1.6),
and [beta.88](https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v5.0.0-beta.88).

### Audited release: 5.1.8

- Geeky Heavy and built-in `deep-high` use GPT-6 Astra at `high`. Geeky Normal
  leads with GPT-6.1 Sol Fast at `medium`; `deep-low` keeps GPT-6.1 Sol at
  `medium`. User-pinned routes still win.
- Recall matches individual Han characters and kanji. Query expansion can add
  discounted synonyms, other-language keywords, and related terms.
- Hosted search supports ChatGPT subscription search and opt-in Google Search
  grounding through `websearch.json`. Earlier releases added SearXNG and
  configurable fallback search providers.
- `ultrafast` is an explicit model service-tier decorator, separate from the
  reasoning level.
- Desktop/multi-session clients now apply the requested permission mode.
  The engine also provides the `accept-edits` preset introduced in 5.1.6.
- Packaged `bun` subprocesses no longer start a phantom agent turn. Manual
  Claude-subscription compaction updates its resident transcript. Account
  rotation handles usage limits expressed in words.
- Windows x64 cold Python startup can still exceed the readiness deadline.
  The release notes propose a later repair; it is not established as shipped.

These are upstream release claims. Local validation here did not exercise
hosted search, account rotation, desktop input, Windows, or live compaction.

## End-to-end coverage

The [capability map](customization-scaffolding.md) owns runtime entry points.
This table records where each audited boundary is documented.

| Boundary | Owning repository guidance | Coverage |
|---|---|---|
| Agents and categories | [Agents policy](../customizations/agents/AGENTS.md), [subagents](omo-subagents.md) | Native/shared overrides, canonical categories, curated agents, availability |
| Config and model profiles | [Profiles policy](../customizations/profiles/AGENTS.md), [routing](model-routing.md) | Layer precedence, main-session chains, historical portable profiles |
| Rules and prompts | [Instructions policy](../customizations/instructions/AGENTS.md), [catalog](customizations.md) | Additive rules, replacement prompts, discovered prompt templates |
| Skills | [Skills policy](../customizations/skills/AGENTS.md), [Compound Engineering](../extensions/compound-engineering/README.md) | Discovery, explicit invocation, precedence, argument hints |
| Hooks | [Hooks policy](../customizations/hooks/AGENTS.md), [authoring](authoring-extensions.md) | OMO controls versus Senpi events, scoped cleanup, actionable boundaries |
| Commands | [Commands policy](../customizations/commands/AGENTS.md), [authoring](authoring-extensions.md) | Slash commands, shortcuts, flags, interactive versus RPC UI |
| Tools and providers | [Tools policy](../customizations/tools/AGENTS.md), [Better Custom](../extensions/better-custom/README.md) | Strict schemas, provider metadata, native discovery, host peers |
| MCP | [MCP policy](../customizations/mcp/AGENTS.md), [subagents](omo-subagents.md) | Registration tier, credential authority, child visibility |
| TUI and themes | [TUI policy](../customizations/tui/AGENTS.md), [authoring](authoring-extensions.md) | Terminal-only components versus dialogs, JSON theme resources |
| Sessions and workflows | [Workflows policy](../customizations/workflows/AGENTS.md), [subagents](omo-subagents.md), [Trim](../extensions/trim/AGENTS.md) | Native tasks/DAG/workpool, schedules/monitors, compaction ownership |
| Memory | [Memory policy](../customizations/memory/AGENTS.md), [subagents](omo-subagents.md) | Recall/reflection routes, multilingual search, query expansion |
| Automation | [Automation policy](../customizations/automation/AGENTS.md) | Browser, terminal, experimental Computer Use and stop controls |
| Operations | [Operations policy](../customizations/operations/AGENTS.md), [LSP](lsp.md), [repairs](runtime-repairs.md) | Doctor/update/hosts, diagnostics, mutation formatting, historical repairs |
| Integrations | [Integrations policy](../customizations/integrations/AGENTS.md) | App-server, hosted search, external clients and credential boundaries |
| Extension packaging | [Authoring](authoring-extensions.md), [compatibility](compatibility.md) | Root package, standalone manifests, direct-file installation, native resources |

## October 1 extensions and verification

| Extension | October 1 install boundary | Original proof | Limits then |
|---|---|---|---|
| Better Custom | `extensions/better-custom/src/index.ts` | Public registration tests, build, installed loader | No standalone manifest. Directory installation fails; interactive wizard and current 9router transport were not exercised. |
| Compound Engineering | `extensions/compound-engineering/` | Discovery tests, build, installed loader | Skill callback needs `loadedExtensionPaths`, absent from pinned 2026.9.13 context. |
| Herdr | `extensions/herdr/` | Lifecycle/tool tests, build, installed loader | Same resolved-path requirement for skills. Real pane reporting and Preview rendering were not exercised. |
| Model Routing Advisor | `extensions/model-routing-advisor/` | Evaluator/registry/tool tests, build, installed loader | Catalog/auth signals do not prove future dispatch. It does not choose a route. |
| Trim | `extensions/trim/` | Threshold-policy/config tests, build, installed loader | Cancels threshold requests only. Native overflow/manual handling remains; live compaction completion was not exercised. |

All five load without warnings or errors under the installed engine. A separate
probe verified each install source above. Root-package host dependencies now
use wildcard peers, with unchanged development pins. Frozen installation,
manifest validation, TypeScript, 150 tests/415 assertions, and five builds
passed.

The repository pin is a compilation/test baseline, not proof that all features
run under that older host. Current released APIs include scoped resource
discovery and actionable turn boundaries. See the released
[extension types](https://github.com/code-yeongyu/senpi/blob/ecbe5c9b82db1a2267148a8da900be4c7e08165f/packages/coding-agent/src/core/extensions/types.ts).

The inspected newer Senpi HEAD adds command `requiresArguments` and
skill/template `requires-arguments`. Its newer compaction repairs are
unreleased relative to the installed engine. Do not document those as
available in 2026.10.1-2. See its
[changelog](https://github.com/code-yeongyu/senpi/blob/0455f7839f4e142f158e2e7cdd4113b520283ec3/packages/coding-agent/CHANGELOG.md).

## October 1 gaps and revalidation

- The 2026-10-01 `omo --list-models 9router` output includes CX GPT-6 Astra,
  Sol, Luna, Luna `[1m]`, and GPT-6.1 Sol. It does not establish the old
  GPT-5.6/Ollama Cloud candidates in the portable profiles as available.
  Those templates and their older price evidence were not migrated by this
  documentation update.
- Qlty flags the extension-load test after OMO's mutation formatter changes it
  to tabs. The repository requires two spaces. The native LSP path requests
  `tabSize: 4, insertSpaces: false` before trying the configured formatter;
  see [LSP guidance](lsp.md#mutation-formatting). Typechecking and tests pass,
  but the full quality gate is not green.
- Markdown LSP diagnostics could not run because this session has no `.md`
  server configured. The documentation check instead verified 40 Markdown
  files, 127 local links, 12 section anchors, balanced fences, and six parsed
  JSON/JSONC examples without errors.
- Historical reflection sandbox and provider-effort workarounds have not been
  rerun against live model transport. Their dated records remain historical,
  not newly verified resolutions.

Revalidate after either host upgrade, provider-catalog changes, resource or
event API changes, or new native customization settings. Compare the released
version with upstream HEAD, check all fourteen policy boundaries and every current
extension, update affected owning docs and indexes, then run the repository
checks and the affected real surface.
