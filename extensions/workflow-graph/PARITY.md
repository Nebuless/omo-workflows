# Atomic workflow parity

Status: staged native adaptation implemented; literal Atomic parity remains
limited by the public native APIs listed below. Attempt 2 closes discovery/catalog
and design completion omissions from the prior rejected gate. Final delta review
APPROVE confirms bounded native completion. Runtime hooks remain explicit opt-in repairs.

## Source baseline

Verified 2026-09-12 against:

- [Atomic ff55b141](https://github.com/bastani-inc/atomic/tree/ff55b141109e3f9f5980c1f0c718dea39f6b2fd9).
- [OMO e0746bcb](https://github.com/code-yeongyu/oh-my-openagent/tree/e0746bcbcdf6341f697358867b2de436251fa5ad).
- [Senpi 6db12827](https://github.com/code-yeongyu/senpi/tree/6db12827c7e5f4bc6773fd9f7097b7891d4afd78).
- Installed OMO `5.0.0-0.beta.53`, Senpi `2026.9.10-2`, Bun `1.3.14`.

Comparison revisions do not imply installed runtime contains upstream changes.
Adapters discover live schemas and reject missing capabilities. Provenance and
licenses remain in [UPSTREAM.md](UPSTREAM.md).

## Ownership and required setup

Native OMO owns processes, scheduling, DAG state, task outputs, cancellation,
retries, and recovery. Herdr is presentation only. Deterministic extension
decisions admit outputs before cumulative amendment of one native run. Native
session custom entries store intent, results, human answers, and external events;
no Atomic DBOS or second state database is installed.

[Explicit repairs](../../docs/runtime-repairs.md#optional-staged-workflow-runtime-hooks)
provide journal acknowledgment, native `/dag` presentation delegation, and
focused-overlay mouse deferral. Extension loading applies none. Historical
`2026.9.10-2` hooks remained unmodified during their validation. Current
authorized `2026.9.13` repair changes only installed Senpi journal files to
provide async `SessionManager.flushEntries(): Promise<void>`; it does not change
OMO DAG behavior. Missing journal acknowledgment or a non-persisted session
rejects launches. `activateInactiveTool: true` uses the public Senpi dispatch
API; lazy native registration is not missing capability.

## Capability matrix

| Area / source | Shipped native mapping | Exact parity boundary | Evidence |
|---|---|---|---|
| Graph and overlay [A1] | Fullscreen retained overlay; both orientations, spatial selection, clamped scrolling, pointer tracks, cell-safe labels, resize, explicit edges | Native visual language, not pixel-identical Atomic styling | Canvas/input regressions; real 16-node native captures |
| Switcher and run picker [A1,A2] | Filtered status rows; keyboard/pointer selection; `/workflow-runs`; session-local active-first run list | No public cross-session run catalog or Atomic resume eligibility registry | Run-picker, switcher, focus and narrow-width regressions |
| Stage chat/custom UI [A3] | Native workflow steering and task status; controller human-gate selector with durable answers | No public attached child TUI/composer, archived-chat broker, draft ownership, or stage prompt broker; task snapshots intentionally exclude transcripts | Capability-gated control tests; explicit gate in native run |
| Nested graphs [A1] | Authoritative independent native run projections | Native snapshots have no Atomic child-workflow boundaries or tool-node attach identities; no inferred edges | Projection tests reject unknown edges |
| Progress [A1] | Native terminal counts, attempts, timestamps, duration; separate program and native status | No Atomic queued-message cards or complete actor status model | Real `program: gate` with native completed wave; Herdr final state |
| Authoring [A4,A5] | Typed `StagedProgram.decide`; schema/file outputs; trusted TS/JS module launch and resume; six-source catalog, precedence, metadata, diagnostics, reload | Not source-compatible `workflow(spec)/run(ctx)`; installed package `pi.workflows` discovery is extension-owned over native package inventory | Catalog/registered-entry tests; real OMO reload and native disk resume receipts |
| Recommendations and identity | `workflow_recommend` validates whole fresh catalog proposal set; session-local widget/message; opaque `{key,revision,digest}` start fence | Advice never starts, amends, cancels, answers, or replaces prompt; descriptor identity is current-session catalog authority | `authoring-catalog-entry` and `authoring-host` rejection tests; registered descriptor check |
| Composition/admission [A4] | Deterministic wave decisions, bounded fanout/join, fresh cumulative nodes, exact JSON/file/byte validation before dispatch; declared composition uses one instance/root/checkpoint/native run and namespaced RFC 6901 mappings | Arbitrary callbacks, nested continuation, native per-node tools/context settings absent; composition is not cross-run continuation | Composition/controller tests; one-run native receipt |
| Launch, transfer, and human gates [A5,A6] | `workflow_program` list/reload/start/resume/status/answer/cancel/transfer; `/workflow-run`; unique launch keys; recorded answer provenance; confirmed terminal verified-copy transfer to distinct run | Session-local owner; transfer accepts only current/restored completed source and is not native continuation or arbitrary cross-session history; no native operator pause/resume | Launch races/session-fence/restart and transfer replay tests; real persisted transfer receipt |
| Durable tools [A6] | Native tasks retain results; controller/helper event replay reuses admitted outputs | Arbitrary callback side effects and their timeout/failure-return semantics have no public native node owner | Native journal reopen; keyed recovery; helper reply replay tests |
| Budgets and exit [A4] | Source iteration bounds; deterministic approval/stop reducers; native cancel fencing | Cumulative native DAG ceiling is 64; no general Atomic budget, graceful quit, or pause/continue API | Goal/Ralph default-ten capacity rejection; boundary/cancel tests |
| Subagents [A7,N2] | Native routes, task sessions, processes, outputs, completion delivery and steering | Atomic per-stage tool/context policy and worktree delegation cannot be expressed by pinned node schema | Live child identities preserved; unsupported target configuration rejected |
| Parent/peer communication [A7,N2] | Native task completion, workflow send and team messaging retain native owners; admitted results feed next prompts/files | No Atomic supervisor-decision/stage-group actor namespace or attached child custom UI | Native final results and same-run artifacts; ownership/control tests |
| Recovery [N1,N2] | Native WAL/tasks plus native-session controller checkpoints; exact definition fingerprint; keyed initial recovery; optional acknowledged flush repair | Does not promise restart replay for arbitrary user callbacks or external effects outside helper protocol. Repair hashes and runtime version gate use; broad native static check currently fails from missing upstream test dependencies | Copied real SessionManager reopen; admission/amend/answer/cancel tests; durable-journal repair receipt |
| Controls [N1] | Native start/attach/snapshot/wait/cancel/retry/send/amend; confirmed cancel and authoritative updates | Public actions exclude pause/resume/quit; program resume restores controller, not paused native scheduler | Live schema validation and foreign-run rejection tests |
| Herdr | No-focus read-only observer; normalized run/node metadata; fold/run persistence; manual reopen | No scheduler ownership or transcript storage; richer Atomic stage UI not reproduced | Genuine extension-written 16-node projection, terminal captures, cleanup receipts |

## All nine builtins

| Workflow | Preserved behavior | Proof / remaining limit |
|---|---|---|
| classify-and-act | Typed classification, confidence fallback, interactive/deterministic provenance, exact category and action reference | Source normalization tests; native per-node tool allowlists unavailable |
| fan-out-and-synthesize | Trim/filter/cap partition, exact normalized plan, parallel branches, manifest barrier, synthesis | Actual native artifact run: sum 18, product 15; compact file references intentional |
| adversarial-verification | Canonical criteria bytes, per-criterion reviewers, bounded reasks, mean/veto, repair followed by fresh verification, source round artifacts | Full indeterminate/repair/fresh-round controller tests; unavailable usage reported null |
| generate-and-filter | Bounded candidates, artifact tuple validation, dedup/filter, optional judge and admitted fallback files | Controller tests for malformed filter/judge and retry batch identity |
| tournament | Criteria forms, source defaults, model rotation, seeded deduplicated comparisons, repeat mean before sigmoid, ranking and ledger | Independent math/schema tests; native cumulative 64-node ceiling |
| loop-until-done | Initial active ledger, per-repeat scores/nulls, mean/trend/window, evaluator evidence and prior-artifact handoff | Monitoring cannot stop loop; exhaustion persists failed status |
| goal | Immutable criteria, cumulative objective ledger/reverification audit, 2-of-3 quorum, repeated blockers, needs-human and bounded stop | Individual finding x three fresh repeats plus invalid reask; source default ten retained, actual capacity rejects above 64 |
| ralph | Research/refinement, immutable criteria, orchestration, unanimous review, source notes, per-finding reverification | Explicit create_pr stage only; source default ten retained with same capacity limit |
| open-claude-design | Admitted PRODUCT.md/DESIGN.md/config/preview in one run root, references, explicit start/skip gate, helper events, export, final-display, import_context/run_id/playwright_cli_status | Native export/display proof; valid unavailable-browser fallback; exact path admission; full 64-node compiler proof |

Goal/Ralph reject unsupported `git_worktree_dir`; they do not create raw Git
worktrees or silently ignore the requested directory. `create_pr=true` explicitly
requests final PR work; tests validate dispatch without publishing a PR. Review
quorums validate structured reviewer decisions, not truth of underlying claims.
Native task failure rejects controller admission even where Atomic can return a
task-failure value. This is distinct from supported malformed-output reasks.

## Attempt 2 corrections

- Discovery covers all six source classes in source order, preserves configured
  names and paths, reports invalid configuration/imports/duplicates, and reloads
  changed modules and relative dependencies. Public SettingsManager owns source
  selection; DefaultPackageManager supplies installed paths. The extension reads
  package `pi.workflows` manifests because native Senpi has no workflow resource
  kind. No package installation occurs during discovery.
- Project trust gates project and project-package imports. Realpath containment
  fences each source root. Settings refresh and catalog publication are atomic;
  session changes fence pending launches. Builtins seed startup restoration;
  authored resume requires the exact saved key.
- Design now admits final-display after exporter. Wrong or missing canonical
  paths durably reject before final completion. Final result includes source
  import context, artifact-instance identity, display evidence and manual fallback.
  Actual native exporter/display completed with verified browser unavailability;
  this is not a successful browser-open claim.
- Native graph compiler accepted all 64 nodes: nine setup, 53 live events,
  exporter and final-display. Literal unbounded Atomic execution still exceeds
  native capacity.

## Public boundary and security limits

`repo-to-extension` accepts canonical HTTPS owner/repository input only. It rejects
whitespace, raw backslashes, percent escapes, credentials, ports, query, fragment,
literal IP and local hosts, and paths other than two segments. It lowercases host,
removes one trailing slash, and retains path case and `.git`. This parser is not
SSRF, DNS rebinding, redirect, Git configuration, hook, submodule, credential,
resource-exhaustion, or repository-code execution protection.

Terminal transfer verifies current or restored completed source run identity,
declared regular-file artifacts, SHA-256, size, schema, mapping, and copied bytes.
It journals intent before one fresh destination start and preserves source state.
Descriptor-relative Linux copying protects checked ownership paths, but same-UID
hostile mutation between filesystem operations remains outside atomic OS guarantees.

## Usage and authoring

[README](../../README.md#staged-workflows) lists commands and setup. Inputs/defaults
are in `src/builtins/schemas.ts`; authoring/output contracts in
`src/execution/policy.ts`. Trusted modules must export `program`. Explicit starts
create unique instances; resume restores recorded identity and inputs. Native
session remains sole durable controller store. Artifacts belong under
.omo/workflow-artifacts/<instance>.

Existing native JSON authoring remains available from a JavaScript eval cell:

```js
const library = await import(`${env("OMO_DAG_SDK_ROOT")}/library.js`);
const definition = await library.load("saved-name", { suffix: "" });
const run = await tool.workflow({ action: "start", definition });
```

Native SDK needs eval globals; extension does not import or duplicate its registry.
Native `dependsOn` supplies ordering only. Programs explicitly embed admitted
JSON or pass admitted artifact paths in each downstream prompt.

## Verification ledger

Attempt 2 evidence lives beside `a1/` under `a2/`: `delta-gate.md` APPROVE;
`final-ci.json` records `mise ci` exit 0, 237 tests, 0 failures, 6464 assertions,
34 files. `catalog-rpc-packages.json` proves real OMO installed-package discovery;
`catalog-native-journal.json` proves exact-key disk resume; `design-native-proof.json`
records verified unavailable-browser final display; `design-native-capacity.json`
records native compiler success. `parent-qa.md` preserves each proof boundary;
`integrity.json` records unchanged global runtime hashes and uncommitted source.

Evidence root (ignored local artifacts):
`.omo/evidence/ulw/01a09459-9901-7e95-8ad1-a389346a429a/G001-implement-approved-atomic-workflow-p/a1/`.

- Final `mise ci` after repair wiring and documentation: exit 0; 221 tests, 0 failures across 31 files; typecheck, build, package validation, Biome/Qlty, and hooks passed.
- `imported-controller-native-proof.json`: actual run `dag_e9eb5f9a-6fd2-4e75-be5f-e657c3706cd9`, copied native journal reopened before same-run amendment; completed task identity retained, result total 18.
- `native-rejection-proof.json`: actual run `dag_75c1c9cf-6359-4c83-80a1-2fb5d2d1ea1c`, schema-invalid result rejected and no downstream dispatch. Its in-memory journal is not restart evidence.
- `live-fanout/native-fanout-proof.json`: actual run `dag_e0419457-6601-4c41-8f8f-cf8c85f52c37`, five nodes and parent-read artifacts; sum 18/product 15. Reconstructed QA journal is explicitly not restart evidence.
- `native-ui/same-run-checkpoints.jsonl`: registered `/workflow-run`, eight admitted preparation nodes, explicit native selection gate, same run amended once to eight dependent verification nodes, final prepare 8/verify 8. Run `dag_4af1c990-6a58-49fd-abf1-f2f8270679e2`.
- `native-ui/`: corrected measured `.metric-full.png` gate/final/narrow/Herdr captures and raw frames; mouse full capture `mouse-effect-selected-wave-2-4-metric-full.png` shows selected node, detail, scrollbar and footer. Old guessed-size PNGs are historical cropped evidence.
- `native-ui/mouse-production-interception-trace.jsonl`: exact SGR bytes reached Senpi viewport listener and were consumed. Matching disposable deferral patch reached component and changed selection. Three copied real-runtime tests preserve unfocused native selection and wheel behavior.
- `native-ui/global-hashes-final.txt`: OMO/Senpi targets unchanged. Native mouse repair CLI independently checked preimage without mutation.
- `live-review/native-review-proof.json`: current-source controller run `dag_cab59390-7b34-4462-807a-82a1d7adae3b` rejected candidate 4, admitted repair 5, and obtained fresh approval. Four native tasks retained their identities and used zero tools. File checkpoint adapter is evidence only, not native-journal restart proof.
- Design lifecycle tests cover canonical prerequisites, model reply, abort, helper failure, actual exit, and replay at node capacity. Pinned helper reproduction is `.omo/evidence/pinned-live-bootstrap.sh`; portable shipped tests have no `/tmp` checkout dependency.
- Fresh LSP diagnostics subsequently passed: 43 workflow source files with zero errors; mouse repair library/CLI/test, README, and PARITY clean. Earlier timeout was not treated as success.

2026-09-13 routing, composition, and transfer proof: `bun test --timeout 30000 extensions/workflow-graph/test/authoring-transfer*.test.ts extensions/workflow-graph/test/authoring-host.test.ts extensions/workflow-graph/test/authoring-command.test.ts extensions/workflow-graph/test/authoring-catalog-entry.test.ts extensions/workflow-graph/test/authoring-composition.test.ts extensions/workflow-graph/test/native-journal*.test.ts` exited 0 with 112 pass, 0 fail, and 290 assertions. Real persisted OMO transfer created source `dag_d8436985-bc7d-4012-893f-f1f993db59b1` and distinct destination `dag_39797372-4c3c-498a-b2a7-e4c44e901fc4`, with one destination start, one durable intent, copied `{"ok":true}`, unchanged source snapshot, and declined confirmation rejected. Receipts: `.omo/evidence/st_01a09b74-task-13/task-13-packet.json` and `result.json`.

Historical graph-only gate rejected full parity when builtins were absent. Its
verdict is superseded as a description of implementation, not silently converted
to final approval. Attempt 1 final gate rejected missing discovery and design
contracts; attempt 2 addresses those omissions without treating native limits as
implemented APIs. Revalidate after native versions, schemas, journal lifecycle,
terminal input, helper protocol, or repair hashes change.

## Immutable source references

[A1]: https://github.com/bastani-inc/atomic/tree/ff55b141109e3f9f5980c1f0c718dea39f6b2fd9/packages/workflows/src/tui
[A2]: https://github.com/bastani-inc/atomic/blob/ff55b141109e3f9f5980c1f0c718dea39f6b2fd9/packages/workflows/src/tui/session-picker.ts
[A3]: https://github.com/bastani-inc/atomic/blob/ff55b141109e3f9f5980c1f0c718dea39f6b2fd9/packages/workflows/src/tui/workflow-attach-pane.ts
[A4]: https://github.com/bastani-inc/atomic/blob/ff55b141109e3f9f5980c1f0c718dea39f6b2fd9/packages/workflows/src/shared/authoring-contract-ui.ts
[A5]: https://github.com/bastani-inc/atomic/tree/ff55b141109e3f9f5980c1f0c718dea39f6b2fd9/packages/workflows/src/extension
[A6]: https://github.com/bastani-inc/atomic/tree/ff55b141109e3f9f5980c1f0c718dea39f6b2fd9/packages/workflows/src/durable
[A7]: https://github.com/bastani-inc/atomic/tree/ff55b141109e3f9f5980c1f0c718dea39f6b2fd9/packages/workflows/src/intercom
[A8]: https://github.com/bastani-inc/atomic/blob/ff55b141109e3f9f5980c1f0c718dea39f6b2fd9/packages/workflows/builtin/index.ts
[N1]: https://github.com/code-yeongyu/oh-my-openagent/blob/e0746bcbcdf6341f697358867b2de436251fa5ad/packages/omo-senpi/src/components/task/dag-tool-params.ts
[N2]: https://github.com/code-yeongyu/oh-my-openagent/tree/e0746bcbcdf6341f697358867b2de436251fa5ad/packages/omo-senpi/src/components/task
[N3]: https://github.com/code-yeongyu/senpi/blob/6db12827c7e5f4bc6773fd9f7097b7891d4afd78/packages/coding-agent/src/core/extensions/types.ts
