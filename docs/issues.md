# OMO and Senpi Issue Register

Log each user-reported OMO or Senpi problem here in UTC when it is investigated.
Keep one dated entry per report. State observed behavior, affected runtime, resolution
state, validation, and upstream issue, pull request, or source. If no upstream
reference exists, state that and label any workaround as invented.

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

## 2026-09-12T14:20:02Z - Atomic workflow parity missing from graph extension

- **Reported symptom:** Existing workflow-graph view lacks Atomic staged execution, typed output admission, authored programs, builtin workflows, and native `/dag` integration.
- **Affected runtime:** OMO `5.0.0-0.beta.53`; Senpi `2026.9.10-2`; Bun `1.3.14`.
- **Cause:** Native workflow tool owns static DAG execution/amendment but no public deterministic callback stage; public custom-entry append lacks pre-assistant disk acknowledgement; native `/dag` has no public presentation override.
- **Resolution (2026-09-12T18:35:00Z):** Attempt 2 adds six-source discovery, native settings/package inventory, source diagnostics, changed-module reload, exact authored resume and session trust fencing. Design adds admitted final-display and source result fields. Real OMO reload, copied native journal reopen, native export/display unavailable fallback and 64-node compiler checks passed; final delta gate APPROVE confirms bounded native completion. Optional journal, `/dag`, and mouse repairs remain explicit invented local workarounds; globals unmodified. Genuine native capacity, per-node policy/callback, and stage-chat limits remain in the parity matrix.
- **Upstream:** No matching issue or PR identified in current investigation. Owning source: [OMO DAG manager](https://github.com/code-yeongyu/oh-my-openagent/blob/e0746bcbcdf6341f697358867b2de436251fa5ad/packages/omo-senpi/src/components/task/dag/manager.ts), [Senpi session manager](https://github.com/code-yeongyu/senpi/blob/6db12827c7e5f4bc6773fd9f7097b7891d4afd78/packages/coding-agent/src/core/session-manager.ts), [Atomic workflow baseline](https://github.com/bastani-inc/atomic/tree/ff55b141109e3f9f5980c1f0c718dea39f6b2fd9/packages/workflows).
- **Validation:** `mise ci` passed 221 tests with typecheck/build/quality/hooks. Real native journal reopen, registered 16-node two-wave gate/answer, fanout artifacts, and invalid-output rejection passed. Exact SGR trace localized mouse interception to Senpi fullscreen viewport; copied-runtime repair tests pass. [Runtime evidence](upstream-validation.md#native-staged-workflow-runtime-hooks) and [parity matrix](../extensions/workflow-graph/PARITY.md) distinguish verified behavior from literal parity limits.
