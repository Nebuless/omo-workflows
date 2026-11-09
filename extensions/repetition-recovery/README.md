# Repetition recovery

Records the assistant output associated with a TTSR rule activation. After native
repetition correction is exhausted, requests one automatic continuation using the
current model. No new user message is required.

## Activation

Installation enables recovery automatically:

```sh
omo -e ./extensions/repetition-recovery
```

For project-local installation, use
`omo install -l ./extensions/repetition-recovery`, then start or reload OMO.
The default resolves the current model when recovery begins, not at startup.
`--repetition-recovery-model provider/model` selects an explicit override,
including another provider. Identical overrides are allowed without switching.
`--repetition-recovery-model off` disables automatic recovery, not incident logging.
There is no automatic downgrade or provider change. Explicit model switches use
`setSessionModel` and are restored without overwriting newer committed choices.

## Incident logs

Only assistant-generated content is buffered. The recorder observes normalized
`message_update` text, thinking and tool-argument deltas before transcript
sanitization. It writes only when a fresh branch entry identifies a TTSR
`rule-activation`. Ordinary responses, user messages, prompts, provider payloads,
headers, tool results and the surrounding transcript are not copied.

Files live at
`<ctx.agentDir>/logs/repetition-recovery/incidents/<sha256>.json`.
Each contains timestamp, opaque session identity, activation IDs, rule names,
remediation, provider/model and the associated assistant message. Tool IDs and
names include whether execution had started **at capture time**, not an assurance
about later execution. No tool execution is implied by streamed arguments.

Messages are capped at 16,384 UTF-16 code units, with an explicit truncation flag.
The first portion is retained, so a late trigger may lie beyond the captured
prefix. Up to forty tool identities are retained. Split chunks are joined before
redacting common credential assignments, bearer tokens, known key formats and
private-key blocks. Redaction is best-effort, not proof of secret-free content.
Treat logs as sensitive local data and do not upload them automatically.
Directories are private and files use mode `0600`. Only the newest twenty
incident files survive pruning. Durable recovery claims are never pruned.

The recovery instruction provides the latest incident path and labels its content
as untrusted diagnostic evidence, not instructions. It asks the model to avoid
the failed output and check uncertain side effects before repeating work. It does
not insert the raw incident into the continuation prompt. Failed incident writes
produce a warning without bypassing recovery bounds or replaying a claim.

## Recovery bounds

Native detection and its initial corrective retry remain unchanged. A fresh
`ttsr:loop-stopped` event must match a newly appended stop on the active branch
after the matching native correction. Only `collapse-repetition` and
`repetitive-turns` authorize extension recovery. Other TTSR activations are logged
but keep their native remediation. Security rules do not authorize an extra retry.

The extension durably claims one attempt per session and latest user-message
entry, then sends a hidden custom message with `triggerTurn: true` through normal
engine admission. Only an observed `agent_start` records admission. The same-model
path does not switch models. An explicit different-model override retains the
existing ownership-based restoration and deferred-compaction cleanup.

Cancellation, new input, shutdown, branch replacement, competing pending messages
and persisted deadline stops invalidate eligibility. Native turn caps remain in
force. Reload cannot replay a spent claim. A failed model restoration remains
held for reconciliation on reload. Unreadable journals hold recovery.

This continues the **existing session**, not a fresh session or a new process.
The public `newSession` action is command-context-only, unavailable to automatic
lifecycle handlers. Process crashes, authentication/network/route errors, the
separate tool-loop guard and arbitrary non-TTSR stops are not automatically
recovered by this extension. There is no universal rule-activation event.

The pinned runtime omits declared `agent_end.deadline` metadata. Recovery checks
fresh persisted `deadline-stop` entries. If that upstream write also fails,
deadline exclusion remains unverified. Detector offsets and match reasons are
not public, so incidents identify associated output, not the exact matched span.

## Recovery journals

Claims and lifecycle metadata remain at
`<ctx.agentDir>/logs/repetition-recovery/<sha256(session-id:user-entry-id)>.jsonl`.
These files exclude message content, credentials, arbitrary errors and tool
arguments. They record requests, admission, outcome and model restoration
separately. A settled model run is not proof that the user's task completed.

## Compatibility evidence

- Verified: `2026-11-06` UTC. Repository OMO `5.1.60`, Senpi `2026.11.2-3`,
  mise Bun `1.3.14`. Previously inspected host OMO `5.1.62` / Senpi
  `2026.11.5-1` is not this change's end-to-end recovery proof.
- Re-fetched immutable [OMO pairing](https://github.com/code-yeongyu/oh-my-openagent/blob/9cfa9cc7f7c86f972b9b6513d526ca9d427e4109/packages/omo-native/package.json)
  and [Senpi TTSR implementation](https://github.com/code-yeongyu/senpi/blob/92314cc4be884337a2547f66b788fd2b6acc94e1/packages/coding-agent/src/core/extensions/builtin/ttsr/index.ts).
  Public contracts: [extension API](https://github.com/code-yeongyu/senpi/blob/92314cc4be884337a2547f66b788fd2b6acc94e1/packages/coding-agent/src/core/extensions/types.ts),
  [admission](https://github.com/code-yeongyu/senpi/blob/92314cc4be884337a2547f66b788fd2b6acc94e1/packages/coding-agent/src/core/agent-session.ts),
  [native correction limit](https://github.com/code-yeongyu/senpi/blob/92314cc4be884337a2547f66b788fd2b6acc94e1/packages/coding-agent/src/core/extensions/builtin/ttsr/follow-up-limit.ts).
- Local proof: `bun test --timeout 30000 ./extensions/repetition-recovery/test`.
  Real pinned loader/TTSR/provider fixtures verify primary, primary, primary
  recovery without another user message, incident path in the provider context,
  pre-sanitization output and blocked tool arguments, non-repetition TTSR logging,
  explicit overrides, recurring failure, cancellation, deadlines and unchanged
  engine cap refusal. Recorder checks cover redaction, truncation, private file
  permissions, retention, deduplication and session reset.
- CLI RPC tests prove discovery, default activation, override and opt-out using
  isolated agent directories and mise Node `24.18.0` with `OMO_RUNTIME=node`.
- No global runtime/configuration changes or runtime patches. Live-provider
  recovery and whether a model actually reads or learns from an incident remain
  unverified. Revalidate after OMO/Senpi upgrades or stream, activation,
  admission, deadline and model-selection lifecycle changes.
