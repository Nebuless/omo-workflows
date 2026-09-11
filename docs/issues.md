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
