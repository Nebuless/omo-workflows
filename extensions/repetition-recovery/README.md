# Repetition recovery

The native repetition guard and its first correction run unchanged. A fresh
`ttsr:loop-stopped` event must match a newly appended stop in the active branch,
after the matching native correction. The extension then claims one fallback
attempt per session and latest user message. Reloading cannot replay a claim.

## Activation

Run directly without installation:

```sh
omo -e ./extensions/repetition-recovery --repetition-recovery-model 9router/cx/gpt-6-luna
```

For project-local installation, use
`omo install -l ./extensions/repetition-recovery`, then pass the same flag in a
new session. The selected model must be distinct from the current model and
available with configured authentication. There is no default fallback.
Selection uses `setSessionModel`, leaving provider settings and global defaults
unchanged.

Existing UI notifications report disabled or configured activation, unusable
selectors, pending input, engine refusal, and held restoration. A configured
fallback does not guarantee provider success or task completion.

## Admission bounds

Native exhaustion is published in `agent_settled`, after
`agent_before_settle`. The extension requests one hidden custom-message turn
through ordinary `sendMessage({triggerTurn:true})` admission. It never sends user
input, impersonates manual continuation, modifies the detector, or edits history.
Only an observed `agent_start` records admission. Settlement describes the model
run, not completion of the user's task.

The pinned engine admits a continuation after its repetition pause when native
turn caps allow it. At the per-user cap, the same request is refused without a
fallback provider call. No cap is raised or cleared. Provider retries and tool
execution remain engine-owned.

Historical stops, unsupported rules, provider errors alone, user cancellation,
new input, and competing pending messages cannot authorize a continuation.
Eligibility is checked before claiming and again after awaited model selection.
Input, abort, shutdown, and branch replacement invalidate the attempt. Cleanup
reconciles a late switch, preserves newer committed model choices, and records
restoration separately from the continuation outcome.

A failed restoration remains held for reconciliation on session load without
another continuation. Legacy terminal claims remain spent but do not prove
restoration. Unreadable journals hold recovery instead of replaying it.
Reload checks prior user entries on the active branch. If a crash occurs before
committed selection ownership is saved, restoration stays held for manual model
reconciliation. An unconfirmed matching model never proves ownership.

The pinned Senpi runtime omits `deadline` from extension `agent_end` dispatch
despite declaring it in the public type. A fresh persisted `deadline-stop`
blocks recovery. If that write fails, no public deadline signal reaches this
extension. Deadline exclusion under that upstream failure remains unverified.
No installed runtime patch is applied.

## Local evidence

Journals live at
`<ctx.agentDir>/logs/repetition-recovery/<sha256(session-id:user-entry-id)>.jsonl`.
The directory uses mode `0700` and files use `0600`. Allowlisted metadata records
claims, requests, admissions, outcomes, and restoration obligations. Journals and
notifications exclude prompts, output, credentials, tool arguments, arbitrary
errors, and machine-specific paths. Selection ownership uses opaque metadata.

The public exhaustion event exposes rule names only. Detector offsets,
confidence, and raw samples are unavailable there, so
`detectorMetadata: rule-only` records that limit. Journals are not automatically
rotated or deleted because their claims prevent duplicate recovery.

## Compatibility evidence

- Verified: `2026-11-05` UTC.
- Repository runtime: OMO `5.1.60`, Senpi `2026.11.2-3`, mise Bun `1.3.14`.
  The global runtime and installed host configuration remain unchanged.
- OMO evidence: [exact release pairing](https://github.com/code-yeongyu/oh-my-openagent/blob/9cfa9cc7f7c86f972b9b6513d526ca9d427e4109/packages/omo-native/package.json).
- Senpi evidence: [native guard](https://github.com/code-yeongyu/senpi/blob/92314cc4be884337a2547f66b788fd2b6acc94e1/packages/coding-agent/src/core/extensions/builtin/ttsr/index.ts),
  [one native correction](https://github.com/code-yeongyu/senpi/blob/92314cc4be884337a2547f66b788fd2b6acc94e1/packages/coding-agent/src/core/extensions/builtin/ttsr/follow-up-limit.ts),
  [turn admission](https://github.com/code-yeongyu/senpi/blob/92314cc4be884337a2547f66b788fd2b6acc94e1/packages/coding-agent/src/core/agent-session.ts),
  [committed selection attribution](https://github.com/code-yeongyu/senpi/blob/92314cc4be884337a2547f66b788fd2b6acc94e1/packages/coding-agent/src/core/extensions/loader.ts),
  [abort payload construction](https://github.com/code-yeongyu/senpi/blob/92314cc4be884337a2547f66b788fd2b6acc94e1/packages/coding-agent/src/core/agent-abort-provenance.ts),
  and [deadline persistence](https://github.com/code-yeongyu/senpi/blob/92314cc4be884337a2547f66b788fd2b6acc94e1/packages/coding-agent/src/core/turn-deadline.ts).
- Local proof: `bun test --timeout 30000 ./extensions/repetition-recovery/test`
  exercises the actual loader, built-in TTSR detector, session lifecycle, and an
  in-process deterministic provider. The admitted and recurring collapse paths
  call primary, primary, fallback. Cap refusal calls primary, primary. Both
  restore primary. The native `repetitive-turns` scenario seeds prior prose and
  uses one fixture wake to exercise the cross-turn correction budget. It calls
  primary, primary, primary, fallback, then restores primary.
- A real maximum-runtime deadline terminates a stalled provider with zero
  fallback calls. Subscriber metadata contains the deadline while the extension
  event omits it, confirming the documented upstream limit.
- CLI proof uses an isolated agent directory and the pinned OMO package under
  mise Node `24.18.0` with `OMO_RUNTIME=node`. Its launcher requires Bun
  `>=1.4.0`, while repository checks retain mise Bun `1.3.14`. RPC verifies package
  discovery, flag acceptance, and enabled/disabled notifications without a
  provider request or host activation.
- Revalidate after either runtime upgrade, native event/admission changes, or
  changes to committed model attribution. Synthetic results establish bounds
  and lifecycle behavior, not a production recovery rate.
