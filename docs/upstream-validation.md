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

### Trim extension

- Verified: `2026-09-14`
- Local runtime: OMO `5.0.0-0.beta.62` (engine Senpi `2026.9.13`); Bun `1.3.14`
- OMO evidence: https://github.com/code-yeongyu/oh-my-openagent/commit/cfdaa1d16d25d6152410dea514fd978acfd62bab
- Senpi evidence: https://github.com/code-yeongyu/senpi/tree/919e24dbb2a60d5415c6757c8f1797512c44a095
- Local proof: task-3 `install.txt` and `list.txt` preserve exact command output; `bun run validate:package` passes; root `package.json` registers `./extensions/trim/src/index.ts` once; standalone `extensions/trim/package.json` retains `./src/index.ts`. Package pin `@code-yeongyu/senpi@2026.9.10-2` is separate from installed OMO/Senpi/Bun runtime versions.
- Revalidate: `OMO upgrade | Senpi upgrade`
- Status: `current`

## Existing validation records

### Memory reflection shared-category routing

- Verified: `2026-09-13`
- Local runtime: OMO `5.0.0-0.beta.53`; Senpi `2026.9.10-2`; Bun `1.3.14`.
- OMO evidence: [configuration reference](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/configuration.md) documents harness-specific overlays after shared base keys. [Issue #6808](https://github.com/code-yeongyu/oh-my-openagent/issues/6808) confirms Reflection defaults to `quick` and that the shipped quick route can be Kimi-only.
- Senpi evidence: [Senpi README](https://github.com/code-yeongyu/senpi/blob/main/README.md) establishes Senpi as the runtime under OMO's plugin. The installed OMO reflection child ran through the Senpi view and could not resolve the `[opencode]`-only `quick` route.
- Local proof: `reflection-run-31/ledger.json` recorded old route `9router/ollama-cloud/kimi-k3`; the active profile and both templates parse to shared `memory-reflection` at `9router/cx/gpt-5.6-luna` with low reasoning. `bun test test/omo-preferences.test.ts` enforces selector and model chain. The post-change `/reflect` run is recorded in `docs/issues.md`.
- Revalidate: OMO or Senpi upgrade, reflection launch change, config merge-precedence change, or routing-profile change.
- Status: `current; user-local routing workaround for upstream default`

### Compound Engineering native skill discovery

- Verified: `2026-09-13`
- Local runtime: OMO `5.0.0-0.beta.53`; Senpi `2026.9.10-2`; Bun `1.3.14`.
- OMO evidence: [current OMO Senpi source](https://github.com/code-yeongyu/oh-my-openagent/tree/76e54b0a9bfa7bc730afefa877aea03f2c948b08/packages/omo-senpi); OMO delegates extension resource loading to Senpi.
- Senpi evidence: [`resources_discover` public contract](https://github.com/code-yeongyu/senpi/blob/ce72afe2b7368d9e19fe6a63abb128dd453591e8/packages/coding-agent/src/core/extensions/types.ts).
- Adapted upstream evidence: [Every package manifest](https://github.com/EveryInc/compound-engineering-plugin/blob/44d65ad64a0ac8e542eabee31ce031a7aeb41b28/package.json), [native Pi adapter](https://github.com/EveryInc/compound-engineering-plugin/blob/44d65ad64a0ac8e542eabee31ce031a7aeb41b28/.pi/extensions/compound-engineering.ts), and [skill tree](https://github.com/EveryInc/compound-engineering-plugin/tree/44d65ad64a0ac8e542eabee31ce031a7aeb41b28/skills).
- Local proof: `bun test extensions/compound-engineering/test` registered one skill root and found 35 frontmatter skill names across 418 byte-matched imported files. `omo -e ./extensions/compound-engineering --offline --print "List installed skills whose names start with ce-. Reply with names only, one per line."` exited 0 and returned discovered `ce-*` names; invalid `/skill:not-a-real-ce-skill` exited cleanly with an explicit not-found result.
- Revalidate: OMO or Senpi upgrade, upstream Compound Engineering refresh, or resource-discovery contract change.
- Status: `current`

- [Global OMO instructions](customizations.md#verified-runtime-contract) —
  verified 2026-09-11; boundary-crossing prompt overlay behavior.
- [Customization scaffolding](customization-scaffolding.md#upstream-evidence) —
  verified 2026-09-11; OMO configuration and Senpi extension capability map.

### Native workflow graph Wave 0 runtime contract

- Verified: `2026-09-12`
- Local runtime: OMO `5.0.0-0.beta.53`; Senpi `2026.9.10-2`; Bun `1.3.14`; Herdr `0.9.0`.
- OMO evidence: [`dag-rpc-bridge.ts`](https://github.com/code-yeongyu/oh-my-openagent/blob/10bf3db1d35f47feaf7b473a60e988e12e35a501/packages/omo-senpi/src/components/task/dag-rpc-bridge.ts), [`dag-snapshot-payload.ts`](https://github.com/code-yeongyu/oh-my-openagent/blob/10bf3db1d35f47feaf7b473a60e988e12e35a501/packages/omo-senpi/src/components/task/dag-snapshot-payload.ts), [`dag-tool-params.ts`](https://github.com/code-yeongyu/oh-my-openagent/blob/10bf3db1d35f47feaf7b473a60e988e12e35a501/packages/omo-senpi/src/components/task/dag-tool-params.ts), and [`task-rpc-bridge.ts`](https://github.com/code-yeongyu/oh-my-openagent/blob/10bf3db1d35f47feaf7b473a60e988e12e35a501/packages/omo-senpi/src/components/task/task-rpc-bridge.ts) at immutable OMO revision `10bf3db1d35f47feaf7b473a60e988e12e35a501`.
- Senpi evidence: [`types.ts`](https://github.com/code-yeongyu/senpi/blob/4f4cd74518749d00674571ff867ce6d53766dde1/packages/coding-agent/src/core/extensions/types.ts), [`runner.ts`](https://github.com/code-yeongyu/senpi/blob/4f4cd74518749d00674571ff867ce6d53766dde1/packages/coding-agent/src/core/extensions/runner.ts), [`loader.ts`](https://github.com/code-yeongyu/senpi/blob/4f4cd74518749d00674571ff867ce6d53766dde1/packages/coding-agent/src/core/extensions/loader.ts), and [`connection-handler.ts`](https://github.com/code-yeongyu/senpi/blob/4f4cd74518749d00674571ff867ce6d53766dde1/packages/coding-agent/src/modes/rpc/connection-handler.ts) at immutable Senpi revision `4f4cd74518749d00674571ff867ce6d53766dde1`.
- Installed paths: OMO `plugin/extensions/omo.js` and `plugin/extensions/omo-task.js`; Senpi `dist/core/extensions/{types,runner,loader}.d.ts`, `dist/modes/rpc/{rpc-types,connection-handler}.d.ts`, and `dist/core/event-bus.d.ts` beneath their matching global package roots.
- Local proof: disposable offline RPC process, no saved session or project resource loading:
  ```text
  SENPI_RPC_CLIENT_CAPABILITIES=extension_events omo --mode rpc --offline \
    --no-extensions --no-skills --no-prompt-templates --no-themes \
    --no-context-files --no-approve --omo-task \
    -e /tmp/workflow-graph-wave0-diagnostics.ts \
    --session-dir /tmp/workflow-graph-wave0-session --no-session
  ```
  It returned protocol v1 with `extension_events`; `get_loaded_surfaces` rows with canonical `path` and `sourceInfo`; and public tool descriptors from installed OMO `omo.js`. A fresh disposable synthetic capture then received non-empty `omo.dag.updated`, sequenced `omo.dag.event`, coalesced `omo.dag.activity`, `omo.dag.heartbeat`, and `omo.task.updated` envelopes. The final parser verdict was `6/6`, `34/34`, `7/7`, `2/2`, and `25/25` respectively. It also recorded a task-linked two-root/join graph, `workflow` snapshot error, task-output status, and synthetic send/cancel/retry outcomes. Historical receipt path was `.omo/evidence/workflow-graph-wave0-transcript.md`; that ignored artifact is unavailable in this checkout. Do not use these historical counts as current proof. Current native/runtime evidence is recorded below.

  `workflow` allows only `start`, `attach`, `snapshot`, `wait`, `cancel`, `retry`, `send`, and `amend`; no extension control may assume another task-tool name or parameter. `workflow-graph` discovers live schemas through public `pi.getAllTools()` and invokes a control only when active and schema-compatible. Its task transport boundary accepts OMO metadata evolution, but projection retains only task ID, status, timestamp, optional model, and optional turns.
- Herdr proof: read-only `herdr tab list --workspace wJ`, `herdr pane current --pane wJ:p1`, `herdr pane layout --pane wJ:p1`, and `herdr pane edges --pane wJ:p1` returned opaque IDs and typed JSON. A disposable non-focused tab then proved each required mutating argv/result contract. IDs below are redacted placeholders; only returned IDs were used, and the final tab list contained only pre-existing tabs.
  ```text
  herdr tab create --workspace wJ --cwd /home/egsox/repo/omo-workflows \
    --label workflow-graph-wave0 --env WORKFLOW_GRAPH_WAVE0=1 --no-focus
  # {"id":"cli:tab:create","result":{"root_pane":{"pane_id":"[root-pane]",...},"tab":{"tab_id":"[tab]",...},"type":"tab_created"}}

  herdr pane split --pane [root-pane] --direction right --ratio 0.4 \
    --cwd /home/egsox/repo/omo-workflows --env WORKFLOW_GRAPH_WAVE0=1 --no-focus
  # {"id":"cli:pane:split","result":{"pane":{"pane_id":"[viewer-pane]",...},"type":"pane_info"}}

  herdr pane run [viewer-pane] printenv WORKFLOW_GRAPH_WAVE0
  # [no output]
  herdr pane read --source recent-unwrapped --format text --lines 6 [viewer-pane]
  # output contained: 1

  herdr pane resize --direction right --amount 0.1 --pane [root-pane]
  # {"id":"cli:pane:resize","result":{"resize":{"changed":true,"pane_id":"[root-pane]","layout":{...}},"type":"pane_resize"}}
  herdr pane close [viewer-pane]
  # {"id":"cli:pane:close","result":{"type":"ok"}}
  herdr tab close [tab]
  # {"id":"cli:tab:close","result":{"type":"ok"}}
  ```
  This proves `--env` augments inherited process environment and reaches split panes; `pane run` has no command-result payload, so `pane read` is required for observed output. `HERDR_ENV=1` only authorizes contextual CLI control; isolated QA still requires a separate returned tab/pane ID set.
- Redaction and fixtures: persisted samples use synthetic IDs and `[redacted]` session/task/run IDs, prompts, messages, model tokens, task summaries, full responses, and error bodies. Future fixtures remain synthetic and must exclude those bodies. Rendering may cap local detail but must not log it.
- Provenance and dependencies: no Atomic source has been copied in Wave 0. Repository `package.json` and installed OMO `omo.js` have no `@bastani/atomic` dependency/import. Before any Atomic or `omo-herdr-dag` adaptation is added, `extensions/workflow-graph/UPSTREAM.md` and `LICENSES/` must preserve both immutable revision notices and licenses.
- Revalidate: OMO or Senpi runtime upgrade, Herdr CLI upgrade, native task-tool schema change, extension transport change, or before broadening controls beyond `workflow` discovery.
- Status: `current; Wave 0 source-creation gate evidence`

### Workflow graph routing, composition, transfer, and durable journal repair

- Verified: `2026-09-13`
- Local runtime: OMO `5.0.0-0.beta.62`; Senpi `2026.9.13`; Bun `1.4.1`.
- OMO evidence: native workflow snapshot/start contract remains runtime authority. This extension reads live schemas, requires native `run_id` snapshot identity, and leaves scheduling, keyed recovery, and DAG mutation with OMO.
- Senpi evidence: installed extension APIs register `workflow_recommend`, `workflow_program`, `/workflow-run`, and `before_agent_start`. No upstream authority owns extension-local descriptor hashing, URL policy, composition, or transfer filesystem validation.
- Local proof: `bun test --timeout 30000 extensions/workflow-graph/test/authoring-transfer*.test.ts extensions/workflow-graph/test/authoring-host.test.ts extensions/workflow-graph/test/authoring-command.test.ts extensions/workflow-graph/test/authoring-catalog-entry.test.ts extensions/workflow-graph/test/authoring-composition.test.ts extensions/workflow-graph/test/native-journal*.test.ts` exited 0, 112 pass, 0 fail, 290 assertions. Real persisted OMO transfer created source `dag_d8436985-bc7d-4012-893f-f1f993db59b1` and destination `dag_39797372-4c3c-498a-b2a7-e4c44e901fc4`; one transfer intent and one destination start followed confirmed verified copy, source snapshot stayed unchanged, and declined confirmation made no run. Receipt: `.omo/evidence/st_01a09b74-task-13/task-13-packet.json`.
- Durable repair: `durable-journal-v1` changed installed Senpi `SessionManager` files from recorded preimage hashes to recorded postimage hashes and exposes `flushEntries(): Promise<void>`. Receipt `.omo/evidence/workflow-graph-natural-routing-chaining-url-policy/20260913T140255Z-native-repair-st_01a09aea/runtime-repair-receipt.json` records version `2026.9.13`, upstream revision `0fb7705500641a43de915e72debdabfdcb00e665`, and matching installed build. It is local repair only. Native broad static check exited 1 because upstream test dependencies, including `vitest`, were absent. It is not a passing static gate.
- Revalidate: OMO or Senpi upgrade, native workflow/session schema or lifecycle change, repair preimage or postimage hash mismatch, extension registration change, or Linux filesystem behavior change.
- Status: `current; extension-local policy with native runtime boundaries`

### Native staged workflow runtime hooks

- Verified: `2026-09-12`
- Local runtime: OMO `5.0.0-0.beta.53`; Senpi `2026.9.10-2`; Bun `1.3.14`.
- OMO evidence: [`dag/manager.ts`](https://github.com/code-yeongyu/oh-my-openagent/blob/e0746bcbcdf6341f697358867b2de436251fa5ad/packages/omo-senpi/src/components/task/dag/manager.ts), [`dag/fingerprint.ts`](https://github.com/code-yeongyu/oh-my-openagent/blob/e0746bcbcdf6341f697358867b2de436251fa5ad/packages/omo-senpi/src/components/task/dag/fingerprint.ts), and installed hash-pinned `/dag` handler in `plugin/extensions/omo-task.js`. Native snapshots require run_id and expose definitionFingerprint. Keyed start reuses exact definitions; amendment preserves unchanged completed nodes.
- Senpi evidence: [`session-manager.ts`](https://github.com/code-yeongyu/senpi/blob/6db12827c7e5f4bc6773fd9f7097b7891d4afd78/packages/coding-agent/src/core/session-manager.ts) and [`extensions/types.ts`](https://github.com/code-yeongyu/senpi/blob/6db12827c7e5f4bc6773fd9f7097b7891d4afd78/packages/coding-agent/src/core/extensions/types.ts). Existing public appendEntry lacks explicit disk acknowledgement before first assistant message.
- Local repairs: `scripts/repair-omo-dag-ui.ts` adds optional versioned presentation hook; `scripts/repair-senpi-workflow-journal.ts` adds acknowledged native custom-entry flush. Both are invented local workarounds and check-only by default. Neither is a native upstream feature claim.
- Local proof: `bun test extensions/workflow-graph/test/native-dag-ui.test.ts extensions/workflow-graph/test/native-journal-flush.test.ts extensions/workflow-graph/test/native-journal.test.ts` passed against disposable patched copies. Imported controller run `dag_e9eb5f9a-6fd2-4e75-be5f-e657c3706cd9` completed two waves with first task preserved across native journal reopen and same-run amendment; final parsed total was 18. Receipt: `.omo/evidence/ulw/01a09459-9901-7e95-8ad1-a389346a429a/G001-implement-approved-atomic-workflow-p/a1/imported-controller-native-proof.json`.
- Boundaries: native tasks own processes and DAG state. Extension owns deterministic validation and durable decisions through native session records. Strict invalid output rejects by default; explicit recovery nodes receive only typed failure records.
- Revalidate: every OMO or Senpi upgrade, native schema/fingerprint change, session write lifecycle change, or repair hash mismatch.
- Registered launch proof: `/workflow-run` created `dag_4af1c990-6a58-49fd-abf1-f2f8270679e2`; eight completed nodes paused at controller gate, explicit selector answer admitted one same-run amendment, and all 16 nodes completed. Herdr reported program final separately from native completed. Public `activateInactiveTool: true` resolves lazy workflow registration.
- Fullscreen mouse owner: [Senpi tui-alt-screen.ts](https://github.com/code-yeongyu/senpi/blob/6db12827c7e5f4bc6773fd9f7097b7891d4afd78/packages/tui/src/tui-alt-screen.ts), `handleViewportInput`. Wheel defers to focused overlay, parsed SGR clicks do not. Optional `repair-senpi-workflow-mouse.ts` applies matching deferral; OMO scheduling is not involved. Real copied-runtime tests cover focused click/wheel and unfocused native selection/scroll.
- Mouse target: `@earendil-works/pi-tui@2026.9.10-2/dist/tui-alt-screen.js`; preimage `7ffca25def0e5b1a92812163d20224fdaf56a102c37307af3a4a1e73428faf0a`; postimage `aaf31dc01b5038d92fa9f6263c0b1d493b05a7ec2bfaabfe9ed6db2e82800b31`. CLI check-only confirmed global preimage unchanged.
- Integrated proof: `mise ci` exit 0, 221 tests/0 failures, typecheck/build/package/quality/hooks passed. Source-backed all-nine controller regressions, native success/rejection/reopen, and corrected measured terminal captures are indexed in [PARITY.md](../extensions/workflow-graph/PARITY.md).
- Status: `focused staged/runtime behavior verified; full gate rejected unfinished discovery/catalog and design final-display/result contract. Native stage-chat, per-node policy, callback, and unbounded-run limits are separate`.

### Atomic discovery and design completion delta

- Verified: `2026-09-12T18:40:43.605Z`
- Local runtime: OMO `5.0.0-0.beta.53`; Senpi `2026.9.10-2`; Bun `1.3.14`; Jiti `2.7.0`.
- OMO evidence: [pinned DAG schema](https://github.com/code-yeongyu/oh-my-openagent/blob/e0746bcbcdf6341f697358867b2de436251fa5ad/packages/omo-senpi/src/components/task/dag-tool-params.ts); actual native compiler accepts full 64-node design graph.
- Senpi evidence: [SettingsManager](https://github.com/code-yeongyu/senpi/blob/6db12827c7e5f4bc6773fd9f7097b7891d4afd78/packages/coding-agent/src/core/settings-manager.ts), [package inventory](https://github.com/code-yeongyu/senpi/blob/6db12827c7e5f4bc6773fd9f7097b7891d4afd78/packages/coding-agent/src/core/package-manager.ts), [public extensions](https://github.com/code-yeongyu/senpi/blob/6db12827c7e5f4bc6773fd9f7097b7891d4afd78/packages/coding-agent/src/core/extensions/types.ts). Fresh immutable API content SHAs: settings `95aecffeba62e616d7b86051067f2f82b6f9c4ea`, package inventory `95b66a49ad4e1b0f4730a148ef2c2bb03809c954`.
- Adaptation: six-source registry over public native settings/package paths. Native has no workflow resource kind; extension reads installed package `pi.workflows`. Scope trust is checked before project/package code executes. Reload does not install dependencies.
- Local proof: attempt-2 `catalog-rpc-result.json` shows actual OMO registered list/reload and expected no-session durability rejection; `catalog-native-journal.json` shows exact-key resume through copied repaired native SessionManager and disk reopen; `design-native-proof.json` records actual native exporter/display with independently confirmed browser failure, not successful browser display; `design-native-capacity.json` records native compiler success for 64 nodes.
- Revalidate: either runtime version, settings selection, package inventory, module loader, or Playwright CLI contract changes.
- Status: current; full literal native API limits remain in package PARITY.md.
