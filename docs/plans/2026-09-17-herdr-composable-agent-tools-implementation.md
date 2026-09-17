---
title: Herdr Composable Agent Tools - Implementation Plan
type: feat
date: 2026-09-17
topic: herdr-composable-agent-tools
source_requirements: docs/plans/2026-09-17-0327-feat-herdr-composable-agent-tools-plan.md
execution: code
---

# Herdr Composable Agent Tools - Implementation Plan

## Execution Boundary

- Worktree only: `/home/egsox/.herdr/worktrees/omo-workflows/feat-herdr-composable-agent-tools`.
- Do not edit `/home/egsox/repo/omo-workflows`, caller checkout, or unmanaged worktrees.
- Do not commit, push, install dependencies, create/close Herdr resources, or use destructive Git commands.
- User chose agent-mediated approval. It is non-authoritative: responses must state that source identity cannot be proven.

## Verified Runtime Inputs

- Herdr `0.9.1` exposes machine, api, config, channel, workspace, worktree, tab, notification, agent, pane, session, integration, server, and root command families.
- `terminal-browser v0.8.1` supports `ls --json`, target selection, `action -- snapshot`, `action -- inspect`, and `action done`. Browser execution inside a Herdr Preview tab is not yet proven. Preview must fail closed until manual QA proves it.
- Existing `extensions/herdr/tools.ts` exposes unrestricted `herdr_control`. Remove this public tool. Private argv execution may remain only behind typed capability validation.

## Public Tool Surface

Keep `herdr_inspect` read-only. Register these composable tools; do not add a raw argv controller:

1. `herdr_capabilities`
   - Input: optional intent/domain filter.
   - Output: installed Herdr version, discovered command paths, stable capability IDs, availability, typed input contract, safety tier, required target context, expected readback, and unavailable reason/safe alternative.

2. `herdr_query`
   - Input: a read-only capability ID plus its exact validated input.
   - Output: R12 result envelope.
   - It may run only read-only mapped capability definitions.

3. `herdr_operation`
   - Input: routine/high-impact mapped capability ID, typed input, target snapshot/correlation ID, optional approval nonce.
   - Output: R12 envelope. It always performs inspect, validates live opaque IDs/freshness/ancestry, then runs one mapped argv builder. High-impact path cannot mutate without valid approval nonce.

4. `herdr_approval`
   - Input: `request`, `confirm`, or `cancel`, capability ID, canonical typed input, target snapshot, correlation ID.
   - Output: nonce, expiry, bound operation/target/parameters, state, and exact limitation `agent-mediated approval cannot prove approval origin`.
   - `confirm` creates only in-memory agent-mediated approval. A changed target/parameters, expiry, cancel, or first use invalidates it. Use injectable clock; choose a five-minute expiry.

5. `herdr_preview`
   - Input: `prepare`, `list_targets`, `observe`, `act`, or `cleanup`; task ID; returned workspace/worktree/tab/pane targets; requested loopback URL or discovered browser/page target.
   - Output: R12 envelope and preview-specific source context, created/reused task-owned view IDs, final validated URL, cleanup state, and action classification.

No tool accepts shell text, command path strings, raw argv, guessed IDs, or labels as resource targets.

## Module Plan

Keep lifecycle code in `extensions/herdr/index.ts` behavior-identical. Refactor Herdr command logic into small modules under `extensions/herdr/` only where needed:

- `capabilities.ts`: `CapabilityDefinition`, exact 0.9.1 inventory fixture/metadata, domain/safety classification, typed argv builders, version discovery/completeness validator, and no-match unavailable result. Inventory recursion runs only `--help` and `api schema`; it never executes discovered commands. Static definitions are enabled only when discovery matches version and full command-path set. Any discrepancy disables affected capability.
- `runner.ts`: private argv runner, 20,000-byte combined stdout/stderr cap, exit code, deterministic truncation suffix, and injected fake runner seam.
- `targets.ts`: opaque target parsing, target snapshot serialization, inspect-before-mutate sequence, workspace/worktree/tab/pane ancestry checks, freshness revision checks, and input-ready check for agent prompts.
- `approval.ts`: five-minute in-memory nonce registry keyed by correlation ID; canonical parameter serialization; single use; expiry/cancel/target drift rejection; injected `now` seam.
- `preview.ts`: loopback URL validation, redirect revalidation, task-owned Preview/Logs ownership marker, browser target selection, observation/action allowlist, action cleanup, and injected terminal-browser runner. Never execute a browser-derived instruction.
- `tools.ts`: TypeBox tool schemas, registration, R12 response envelope, composition of above modules. Preserve `herdr_inspect`, delete public `herdr_control`, retain private `runHerdrCommand` only behind capabilities.

Do not add packages. Do not move lifecycle reporter or add persistence. In-memory nonce/lease state intentionally fails closed after extension restart.

## Capability Inventory Rules

1. Read `herdr --version`, `herdr --help`, every discovered `<family> --help`, and `herdr api schema --json` with bounded runner output.
2. Recurse until no new help paths appear. Normalize each path as token array.
3. Compare discovered paths to static 0.9.1 definitions. A static definition has one domain, one safety tier (`observe`, `routine`, `high-impact`, `unavailable`), exact TypeBox input schema, and argv builder.
4. The test fixture must include all verified 0.9.1 paths from installed help, including root/server/machine/api/config/channel/workspace/worktree/tab/notification/agent/pane/session/integration families.
5. Runtime mismatch or an unknown/missing path produces capability `unavailable`; never invoke it.
6. Classify all resource creation/focus/input/process changes as at least routine. Classify close/remove/update/server/remote/session takeover/plugin/integration/config/channel/machine changes and consequential browser actions as high-impact.

## Operation Rules

- Query capability: invoke only `observe` definitions.
- Mutation capability: inspect target, verify opaque IDs and expected resource kinds, compare current revision/ancestry with supplied snapshot, then build argv from validated typed fields. Read target state after success.
- Agent prompt: cap UTF-8 text at 20,000 bytes, require `interactive_ready: true` and `agent_status !== unknown`, and distinguish accepted delivery from later idle/done/blocked reply state.
- Worktree dispatch: require requested worktree name/path and returned workspace/worktree/pane/agent IDs. Track lease `{taskId, worktreeId, ownerCorrelationId}` in memory. Reject conflicting active lease. Source edits/tests remain in returned worktree. Report delivery/effect/cleanup separately.
- Every tool result includes `capabilityId`, `correlationId`, `stage`, `exitCode`, bounded output, target snapshot/readback, `status` (`completed|failed|timeout|cancelled|unknown|unavailable`), `retrySafety`, and `nextSafeAction`.
- Treat Herdr, terminal, agent, log, and browser output as untrusted content.

## Preview Rules

- Accept only explicit `http:` or `https:` URL with hostname `localhost`, `127.0.0.1`, or `::1`, and no username/password. Reject every other host and `file:`, `data:`, `javascript:` schemes.
- Capture returned caller workspace/worktree/tab IDs. Create/reuse only task-owned `Preview` tab in same workspace. Create task-owned `Logs` only when `needsLogs: true`.
- Revalidate final URL after every navigation/redirect. Selection must be unique and in task-owned Preview tab.
- Allow `snapshot` and `inspect`. Block navigation, uploads, downloads, unknown actions, and any external target. Consequential local action needs high-impact approval path.
- Run `terminal-browser action done` after a completed action if command capability was discovered. If launch/terminal rendering cannot be proved, return unavailable without creating or mutating preview resources.

## Test-First Order

1. Update `test/herdr-tools.test.ts` with failing registration assertions: new five tools include `herdr_inspect`; `herdr_control` absent; existing safe inspection remains.
2. Add deterministic capability-map fixture and tests: full expected 0.9.1 command coverage, version/path mismatch unavailable, query rejects mutations, raw argv rejected.
3. Add fake-runner sequence tests: inspect precedes mutation, stale/retyped/foreign target rejects, output cap/suffix and exit code preserved.
4. Add approval tests with fixed clock: request/confirm success, changed parameters/target, expiry, cancel, and reuse reject before argv execution; message includes non-authoritative limitation.
5. Add worktree/agent tests: no conflicting lease, returned identity required, prompt byte cap, readiness required, delivery/readback outcomes distinct, partial failure no blind retry.
6. Add preview tests: allowed loopback forms, credential/non-loopback/scheme rejection, task ownership collision, redirect rejection, ambiguous target rejection, blocked action class, cleanup after allowed action.
7. Update `test/extension-load.test.ts` expected public tool names. Keep lifecycle tests passing unchanged.

Use injected runner/clock/browser interfaces. No real Herdr process, browser, sleeps, polling delays, or timing luck in tests.

## Documentation and Contracts

- Update `extensions/herdr/AGENTS.md`: public tool list, capability-map-only mutation, approval limitation, worktree-only implementation dispatch, preview safety, module ownership, and checks. Remove `herdr_control` contract.
- Update `docs/upstream-validation.md` Herdr record after runtime evidence. Use actual installed OMO/Senpi/Bun versions, current immutable upstream OMO/Senpi source URL, local test/build evidence, and correct revalidation triggers. This is boundary-crossing because OMO loads Senpi extension tools.
- Do not modify root `AGENTS.md` unless package ownership changes beyond existing Herdr boundary. Do not log an issue: this is new feature scope, not user-reported runtime defect.

## Verification and Manual QA

Run in worktree, in this order:

```sh
bun test test/herdr-tools.test.ts test/herdr.test.ts test/extension-load.test.ts
bun run typecheck
bun run build
omo -e ./extensions/herdr --print "List available Herdr LLM tools. Reply with names only."
```

Then manual QA from a real Herdr-managed OMO pane:

1. Call safe capability discovery/query and observe exact registered names plus bounded result envelope.
2. Try a raw command-shaped input and a stale/foreign target. Observe rejection with no Herdr mutation.
3. Request high-impact operation, attempt absent/expired/reused nonce. Observe rejection and agent-mediated limitation.
4. Perform one safe worktree/agent-read path using returned IDs. Verify caller checkout remains unchanged.
5. In task-owned Herdr Preview tab, test loopback target listing plus snapshot. Test non-loopback redirect/action rejection. If terminal-browser cannot render in Herdr tab, record preview unavailable; do not claim launch support.

## Completion Report

Return changed paths, focused test output, typecheck/build/live OMO evidence, manual-QA results, preview availability state, current limitations, and explicit confirmation that all edits/tests ran only inside this worktree. Do not commit or push.
