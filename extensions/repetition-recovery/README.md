# Repetition recovery

The native repetition guard and its first correction run unchanged. After a
`ttsr-loop-stopped` entry confirms that correction failed, this extension claims
one fallback attempt per session and latest user message. A reload cannot replay
the claim. No recovery runs without an explicit fallback selector.

## Activation

Run directly without installation:

```sh
omo -e ./extensions/repetition-recovery --repetition-recovery-model 9router/cx/gpt-6-luna
```

For a later project-local installation, use
`omo install -l ./extensions/repetition-recovery`, then pass the same flag in a
new session. Installation was not performed as part of this change. The selected
model must already exist and have configured authentication. The extension uses
`setSessionModel`; it does not modify provider configuration or global defaults.

## Admission and bounds

Native exhaustion is published in `agent_settled`, after the actionable
`agent_before_settle` boundary. The extension requests one ordinary, hidden
custom-message turn from `agent_settled`, through `sendMessage({triggerTurn:true})`.
It never calls `sendUserMessage`, uses a manual-continue identifier, changes the
guard, or edits context/history. Actual `agent_start` records admission; requesting
a turn alone is not success. `engine:turn-limit` records refusal and restores the
original model. The original model is also restored after settlement or shutdown.

The pinned engine **admits this continuation after a repetition pause** when its
engine-turn caps allow it. The pause marker itself is not a universal admission
lock in this version. With the per-user cap exhausted, the same request is refused
without a fallback provider call. Recovery does not raise or clear any limit.
Native provider retry policy and ordinary tool execution remain engine-owned;
the extension adds at most one continuation, not a separate unbounded retry loop.

An interrupted or unreadable journal is held, not retried. A reload after a
claimed attempt records an indeterminate outcome and restores the original model.
No failed recovery is silently replayed. The extension does not resume historical
failures merely because it was loaded; it evaluates at lifecycle settlement.

## Local evidence

Private journals live under
`<ctx.agentDir>/logs/repetition-recovery/<sha256(session-id:user-entry-id)>.jsonl`.
The directory is created with mode `0700`, files with `0600`. Exclusive creation
and a synchronous flushed claim precede model selection or continuation. Logs
contain timestamps, correlation IDs, model references, rule names, recovery
actions, observed admission, and outcomes. They contain no credentials, prompts,
raw output, tool arguments, full session paths, or arbitrary detector payloads.

The public exhaustion entry exposes rule names only. Detector mechanism, offsets,
confidence, and raw samples are not exposed there; `detectorMetadata: rule-only`
records this limit rather than inventing values. Journals are not rotated or
deleted automatically because they also prevent duplicate recovery. Remove them
only when those sessions will not be reopened for automated recovery.

## Compatibility evidence

- Verified: `2026-11-03`.
- Repository runtime: Senpi `2026.10.19-2`, Bun `1.3.14`.
- Installed OMO: `5.1.58`; its manifest targets Senpi `2026.11.2-1`, not the
  repository pin. Admission proof here is for the pinned SDK, not the newer binary.
- OMO evidence: [exact release pairing](https://github.com/code-yeongyu/oh-my-openagent/blob/31180c810c2a99098fabfc224e8b6c270cc93b6a/packages/omo-senpi/package.json).
- Senpi evidence: [native guard lifecycle](https://github.com/code-yeongyu/senpi/blob/a4816ed8c3c643051700aecd0b3059530e75ee85/packages/coding-agent/src/core/extensions/builtin/ttsr/index.ts),
  [one native correction](https://github.com/code-yeongyu/senpi/blob/a4816ed8c3c643051700aecd0b3059530e75ee85/packages/coding-agent/src/core/extensions/builtin/ttsr/follow-up-limit.ts),
  [engine pause marker](https://github.com/code-yeongyu/senpi/blob/a4816ed8c3c643051700aecd0b3059530e75ee85/packages/coding-agent/src/core/engine-paused.ts),
  [turn admission](https://github.com/code-yeongyu/senpi/blob/a4816ed8c3c643051700aecd0b3059530e75ee85/packages/coding-agent/src/core/agent-session.ts).
  Current upstream `main` pause and follow-up-limit sources were also fetched on
  the verification date and retain the same marker and correction contracts.
- Local proof: `bun test --timeout 30000 ./extensions/repetition-recovery/test`
  drives the actual SDK loader, built-in TTSR detector, session lifecycle, and an
  in-process deterministic provider. It observes primary, primary, fallback when
  admitted, and primary, primary when the engine cap refuses recovery.
- Revalidate after either OMO or Senpi upgrades, detector metadata changes, or
  extension lifecycle/admission changes. Do not treat a newer pairing as tested.
