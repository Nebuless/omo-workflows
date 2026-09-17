# OMO and Senpi Issue Register

Log each user-reported OMO or Senpi problem here in UTC when it is investigated.
Keep one dated entry per report. State observed behavior, affected runtime, resolution
state, validation, and upstream issue, pull request, or source. If no upstream
reference exists, state that and label any workaround as invented.

## 2026-09-17T19:06:41Z - Herdr approval nonce failed in fresh OMO tool call

- **Reported symptom:** Fresh project-loaded OMO invoked `herdr_approval` with action `request` and failed before creating a nonce: `Expected this to be instanceof Crypto, but received an instance of ApprovalRegistry`.
- **Affected runtime:** OMO `5.0.0-0.beta.68` (engine Senpi `2026.9.16-3`); repository Senpi `2026.9.13`; Bun `1.3.14`; Herdr `0.9.1`.
- **Cause:** `ApprovalRegistry` stored detached `crypto.randomUUID` as its default nonce factory. Bun requires the native `Crypto` receiver for this method.
- **Resolution:** Bound invocation through `() => crypto.randomUUID()` and added regression coverage. Fresh OMO approval request then returned `completed`, a nonce, and `state: "requested"`; it did not confirm approval or dispatch a prompt.
- **Upstream:** Local extension defect. No matching OMO, Senpi, Bun, or Herdr issue/pull request identified during this repair. Herdr `v0.9.1` command contract remains https://github.com/herdrdev/herdr/releases/tag/v0.9.1.
- **Validation:** Focused regression initially failed with the exact receiver error, then passed. Full Herdr tool tests passed after repair. Fresh OMO request `approval-fixed` returned one pending approval for typed `agent.prompt`; no `herdr_operation`, agent prompt, or agent start ran.
- **Revalidation trigger:** Bun `Crypto` API or OMO/Senpi tool-call runtime upgrade; any change to approval nonce injection.

## 2026-09-17T18:04:44Z - OMO Herdr typed control lacked safe dispatch proof

- **Reported symptom:** OMO Herdr integration exposed no typed direct agent prompt or supported launch; mutation handling could treat zero exit, unchanged readback, or truncated output as completion, and lifecycle reporter failures were silent.
- **Affected runtime:** OMO `5.0.0-0.beta.68` (Senpi `2026.9.16-3`); repository Senpi `2026.9.13`; Bun `1.3.14`; Herdr `0.9.1`.
- **Resolution:** Added pane-identity-only typed prompt and typed supported-kind/profile launch mappings. Herdr 0.9.1 launch capabilities remain unavailable because observed responses do not prove stable agent identity/readiness. Added per-operation state/readback proof, missing-path-only capability disablement, nonblocking reporter diagnostics, and aligned packaged skills.
- **Upstream:** Herdr `v0.9.1` release documents supported `agent start` kinds and `agent prompt --wait/--until/--timeout`: https://github.com/herdrdev/herdr/releases/tag/v0.9.1. The live `api schema --json` exposes agent status, pane revision, and `state_change_seq`, but no stable agent ID or `interactive_ready` in the observed pane readback. No upstream defect or response contract proving OMO profile dispatch was identified; the typed profile aliases are local policy.
- **Validation:** Focused tests cover nonzero mutation, unchanged readback, truncated mutation output, truncated readback, extra unrelated command paths, version mismatch, pane binding, unavailable launch zero-runner behavior, and injected reporter failure. Start/profile schemas and fixed profiles remain present as typed unavailable mappings until stable identity/readiness proof exists.
- **Revalidation trigger:** Herdr command inventory/version change, agent result/readback schema change, or OMO/Senpi lifecycle/tool registration API change.

## 2026-09-14T03:45:44Z - Native startup and working tips appeared across OMO projects

- **Reported symptom:** An OMO agent launched from another project displayed `Tip:` guidance. User requested every global OMO tip disabled.
- **Affected runtime:** OMO `5.0.0-0.beta.62` (Senpi `2026.9.13`); global agent directory `/home/egsox/.omo/agent`.
- **Resolution:** Added `"tips": false` to `/home/egsox/.omo/agent/settings.json`. Senpi's `getTipsEnabled()` now resolves `false` for a process outside the repository, and both native startup and working-tip resolvers return no line when supplied that value. Existing and future OMO projects inherit this global default unless their `.senpi/settings.json` or `.senpi/settings.jsonc` explicitly sets `"tips": true`.
- **Upstream:** [Senpi settings source](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/src/core/settings-manager.ts) owns the `tips` setting; [startup-tip source](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/src/modes/interactive/tips/startup-tip.ts) and [working-tip source](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/src/modes/interactive/tips/working-tip.ts) gate rendering on it. No upstream defect identified.
- **Validation:** At `2026-09-14T03:45:44Z`, a fresh `SettingsManager.create("/tmp")` read `false` from `/home/egsox/.omo/agent/settings.json`; the repository contains no project `tips` override; and `omo --list-tips` still listed its 117-item catalog while the disabled resolver probes produced `undefined` for startup and working tips.
- **Revalidation trigger:** Rerun after OMO or Senpi upgrade, agent-directory override, or a project-local `tips` setting appears.

## 2026-09-13T13:35:12Z - Namespaced model IDs disable native apply_patch

- **Reported symptom:** SHPRD terminal, runtime, and services workers stopped because required `apply_patch` was registered but inactive, and no executable existed on `PATH`. Redispatching all three saved sessions in their existing Herdr worktrees did not restore access.
- **Affected runtime:** OMO `5.0.0-0.beta.62`, Senpi `2026.9.13`, Bun `1.4.1`; provider `9router`, model `cx/gpt-5.6-luna`, reasoning `xhigh`.
- **Cause:** Senpi's `isGptId` requires `model.id.startsWith("gpt-")`. With `api: "openai-completions"`, `getApplyPatchWireMode` returns `"none"` for `cx/gpt-5.6-luna` but `"json"` for `gpt-5.6-luna`. The native extension therefore leaves the patch tool inactive for this namespaced model ID; restarting does not change that gate.
- **Resolution:** Invented local workaround, verified on this workstation: installed executable `/home/egsox/.local/bin/apply_patch` (mode `0755`). This thin Bun launcher calls `applyPatchDetailed` and `buildPartialFailureText` from the already-installed `@code-yeongyu/senpi/dist/core/extensions/builtin/gpt-apply-patch/apply.js`. It accepts one patch argument or stdin and returns exit 1 on rejected or partially failed patches. It uses Senpi's existing patch engine, not Codex or substitute edit/write tools; no dependency, vendor-source, or provider/model configuration changes were made. All three workers verified this route and resumed their original repairs. Native tool activation remains unfixed upstream; the launcher restores local patch access only.
- **Upstream:** [Owning Senpi source at `87d7ff45b4adacba210ab9af42cb4a96150252e2`](https://github.com/code-yeongyu/senpi/blob/87d7ff45b4adacba210ab9af42cb4a96150252e2/packages/coding-agent/src/core/extensions/builtin/gpt-apply-patch/extension.ts) contains the same prefix gate. No matching upstream issue or pull request identified in this investigation. A future native fix should recognize supported namespaced GPT IDs without changing unrelated model routing; that fix was not applied here.
- **Validation:** Real launcher add/update/delete round trip passed. A mismatched context returned exit 1 and preserved file contents. Stdin patches passed and owned temporary files were removed. Retained check `bun /home/egsox/.herdr/worktrees/herdr-studio/shprd-refactor/.omo/evidence/patch-access-check.mjs` exited 0 with `PATCH_ACCESS_CHECK=PASS add update reject stdin-delete cleanup`; its LSP diagnostics were clean. Each `shprd-g010-{terminal,runtime,services}` worktree also contains `.omo/evidence/REDISPATCH_PATCH_ACCESS.md` recording its independent successful probe.
- **Revalidation trigger:** The launcher imports the installed Senpi engine by absolute path. Rerun the retained check after Senpi/Bun upgrades or installation moves. Remove the workaround only after native activation and real patch operations pass with the unchanged `9router/cx/gpt-5.6-luna` route.

## 2026-09-13T09:25:00Z - Parent and subagent category routes diverged

- **Reported symptom:** Model routing repeatedly differed between OMO parent runs and subagents. Diagnostic stated every execution category was confined to `[opencode]`, while Senpi task routing could not resolve them.
- **Affected runtime:** OMO `5.0.0-0.beta.53`, Senpi `2026.9.10-2`; active `~/.omo/omo.jsonc` and both portable routing templates.
- **Cause:** Eight execution categories were duplicated under `[opencode].categories`; this is a host-scoped overlay, whereas Senpi-owned child routes resolve shared top-level `categories`.
- **Resolution:** Moved all category maps to top-level `categories` and removed the `[opencode].categories` copies. `[opencode]` now retains agent-only overrides. Reflection and recall remain explicitly pinned to shared `memory-reflection`.
- **Upstream:** [OMO configuration schema](https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json) permits a shared category map and harness-specific overlay keys. No matching upstream issue or pull request identified.
- **Validation:** `bun test test/omo-preferences.test.ts` passed: 3 tests, 18 assertions, 0 failures. Fresh offline OMO parent started a `quick` child; it completed with sentinel `CHILD_ROUTE_OK` on resolved model `9router/cx/gpt-5.6-luna`, with no `beyond_category`, `category unavailable`, `sidecar model unavailable`, or `start_failed` output.

## 2026-09-13T09:15:00Z - Kibitzer recall gate cannot resolve default quick category

- **Reported symptom:** Kibitzer gate stopped after three `start_failed` attempts with `Kibitzer sidecar model unavailable: quick (beyond_category)`.
- **Affected runtime:** OMO `5.0.0-0.beta.53`, Senpi `2026.9.10-2`; active global `~/.omo/omo.jsonc` had a shared `memory-reflection` route but no recall category override.
- **Cause:** `memory.recall.category` defaults to `quick`. The active `quick` route exists only in `[opencode].categories`, while Kibitzer resolves a shared/Senpi-facing category. It therefore could not see a model for `quick` and rejected it as `beyond_category`.
- **Resolution:** Active config and both portable profiles now select shared `memory-reflection` through `memory.recall.category`. This pins Kibitzer to `9router/cx/gpt-5.6-luna` at low reasoning, same stable route as reflection.
- **Upstream:** [OMO configuration schema](https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json) defines recall default `category: "quick"` and permits a category override. No matching upstream issue or pull request identified.
- **Validation:** Fresh offline `omo --mode json --no-session -p` process exited 0 after active-config update without `Kibitzer`, `beyond_category`, or recall-sidecar errors. `bun test test/omo-preferences.test.ts` first failed because templates lacked `memory.recall.category`; after profile repair it passed: 3 tests, 14 assertions, 0 failures. Startup still logs a separate `facts extractor quick category unavailable` warning; schema provides no facts category setting, so it does not affect Kibitzer.

## 2026-09-13T08:45:09Z - Plan reviewer replaced concrete path with wildcard

- **Reported symptom:** Two native `plan-reviewer` launches received `.omo/plans/*.md` instead of requested `.omo/plans/workflow-graph-natural-routing-chaining-url-policy.md`. Both returned `[REJECT] No concrete plan path supplied` without reading plan.
- **Affected runtime:** OMO `5.0.0-0.beta.53`, Senpi `2026.9.10-2`, `omo-ai` installed plugin current checkout; task sessions `st_01a099ef` and `st_01a099f0`.
- **Cause:** Installed `plugin/extensions/omo-task.js` plan-review rewrite extracts explicit prompt path, but accepts it only when same normalized path already exists in `planArtifactReferences()`. If lookup misses, it silently chooses most-touched tracked artifact. Injected contract text had tracked literal `.omo/plans/*.md`, so fallback generated `Review the work plan at .omo/plans/*.md for contradictions and blocking issues.` even when caller supplied exact relative or absolute path.
- **Resolution:** Native review waived by explicit user choice for this plan after two identical harness failures. Proposed upstream/local fix: when prompt contains exactly one concrete `.omo/plans/<name>.md` path, resolve it against workspace, require existing regular file inside `.omo/plans`, and use it directly; reject wildcard characters and ambiguous/missing paths. Use most-touched fallback only when prompt has no explicit concrete path, and filter fallback references to concrete existing regular files. Add regression cases for exact relative path, exact absolute path, wildcard tracker contamination, two explicit paths, missing file, and path escape.
- **Upstream:** No matching issue or pull request identified in this investigation. Owning installed source is bundled `omo-ai/plugin/extensions/omo-task.js`, functions matching plan-path regex `Ew`, extraction `$w`, normalization `Tw`, and canonical prompt `Aw`.
- **Validation:** Round 1 supplied exact relative path; round 2 supplied exact absolute path. Both completed in about 11-12 seconds with same wildcard rejection and zero review tools, proving failure before plan inspection. Direct installed-bundle inspection shows `$w` falls back from failed explicit-reference matching to highest `count`/latest `lastTouchedAt`, then `Aw` inserts that fallback path into reviewer prompt. Plan SHA-256 remained `8a45830f13cc56eb205a94b395ba5d3b76bb3709ce46547659bb576ca669f345` across both attempts.

## Removed 2026-09-16: Repo-to-extension report claimed HTTPS URL parser failure

- **Reported symptom:** `repo-to-extension` was said to reject HTTPS repository URLs because its JSON parser cannot parse them.
- **Affected runtime:** OMO `5.0.0-0.beta.53`, Senpi `2026.9.10-2`, removed workflow-graph checkout.
- **Cause:** Reproduction refutes a general JSON parsing failure. Canonical `https://github.com/acme/widgets` passes the TypeBox schema and reaches the `inspect-repository` wave. Malformed command JSON fails in `JSON.parse` before schema validation. The URL-specific boundary is a raw regex, which also accepts userinfo, explicit ports, query/fragment variants, and literal private-IP hosts. It does not canonicalize equivalent URLs.
- **Resolution:** Historical only. The extension and its parser were removed from this repository on 2026-09-16.
- **Upstream:** No matching OMO or Senpi issue/PR identified. Current upstream URLs establish the public lifecycle and DAG contracts but do not own this extension-local parser policy: [Senpi extension event types](https://github.com/code-yeongyu/senpi/blob/4f4cd74518749d00674571ff867ce6d53766dde1/packages/coding-agent/src/core/extensions/types.ts) and [OMO DAG parameters](https://github.com/code-yeongyu/oh-my-openagent/blob/10bf3db1d35f47feaf7b473a60e988e12e35a501/packages/omo-senpi/src/components/task/dag-tool-params.ts).
- **Validation:** Historical receipts remain under `.omo/evidence/`; no current extension behavior depends on this record.

## 2026-09-13T06:35:53Z - Reflection ignored OMO-only quick route

- **Reported symptom:** Compaction-triggered `reflection-run-31` selected
  `9router/ollama-cloud/kimi-k3`, despite the OMO `quick` route selecting
  `9router/cx/gpt-5.6-luna`.
- **Affected runtime:** OMO `5.0.0-0.beta.53`, Senpi `2026.9.10-2`.
- **Cause:** Memory Reflection defaults to category `quick`, but its child uses
  Senpi. The user's `quick` route was nested under `[opencode]`, so it was
  invisible to the Senpi child. OMO then resolved its built-in Kimi quick
  fallback; the run failed because that provider had no active credentials.
- **Resolution:** Routing templates and active `~/.omo/omo.jsonc` now define
  shared `categories.memory-reflection`, pinned to
  `9router/cx/gpt-5.6-luna` at low reasoning. `memory.reflection.category`
  selects it, making the route visible to both OMO and Senpi.
- **Upstream:** [Issue #6808](https://github.com/code-yeongyu/oh-my-openagent/issues/6808)
  documents the Kimi-only quick default. The current
  [configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/configuration.md)
  documents separate harness views and shared-base precedence.
- **Validation:** `reflection-run-31/ledger.json` recorded Kimi under the old
  configuration. Post-change `reflection-run-32/ledger.json` records category
  `memory-reflection`, model `9router/cx/gpt-5.6-luna`, and low thinking.
  `bun test test/omo-preferences.test.ts` passes with the portable profile
  regression requiring that shared category and selector. The smoke's parent
  then emitted a separate stale-extension-context error after route selection;
  it does not alter the recorded child model and is out of this routing fix.

## 2026-09-11T21:55:41Z - Memory reflection fails before child launch

- **Reported symptom:** Memory reflection repeatedly fails and never advances its
  transcript cursor. Local `child-stderr.log` reports:
  `bwrap: Can't find source path .../runtime/reflection-sessions: No such file or directory`.
- **Affected runtime:** `omo-ai` bundled extension at installed upstream revision
  `826424530b22ca5afb3e744d6ff605f691648088`; Linux with `bwrap` enabled.
- **Cause:** Reflection sandbox includes `runtime/reflection-sessions` as a bind
  source before the runtime creates that directory.
- **Current local workaround:** Set `memory.reflection.sandbox` to `"off"` in the
  OMO configuration. This bypasses the broken bind path. It trades sandbox
  isolation for functioning reflection and should be removed after upgrading to
  an upstream release containing the proper directory-creation fix.
- **Upstream:** [Issue #7012](https://github.com/code-yeongyu/oh-my-openagent/issues/7012)
  documents same missing directory. [PR #8004](https://github.com/code-yeongyu/oh-my-openagent/pull/8004)
  is open and creates writable directories before `bwrap` binds them. It has not
  merged as of this record. Earlier [PR #7024](https://github.com/code-yeongyu/oh-my-openagent/pull/7024)
  was closed without merge.
- **Validation:** Local configuration parses without errors. Manual reflection
  dispatch from a piped TUI was not reliable; next normal OMO session must run
  `/reflect` and confirm a new completion without `bwrap` stderr.

## Removed 2026-09-16: Workflow-graph appeared absent after new OMO agent launch

- **Reported symptom:** User launched a new OMO agent and did not see the removed workflow-graph extension.
- **Affected runtime:** OMO `5.0.0-0.beta.53`, Senpi `2026.9.10-2`.
- **Resolution:** Historical record. The extension and related staged-workflow implementation were removed from this repository on 2026-09-16.
- **Upstream source:** [OMO package install CLI](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/omo-senpi/src/cli.ts); [Senpi package settings](https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/packages.md).
