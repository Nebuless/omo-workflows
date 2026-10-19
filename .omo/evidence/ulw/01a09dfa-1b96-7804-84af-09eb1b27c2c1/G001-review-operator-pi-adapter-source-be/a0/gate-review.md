# Gate Review: Operator Memory Native-Port Assessment

## Recommendation

**APPROVE**

Assessment conclusion holds: narrow native Senpi extension is feasible. Scope must be read-only Operator partition load plus cached deterministic request-local preamble through `context`, with cache lifecycle in `session_start`/`session_shutdown` if needed. Keep native Senpi compaction. Do not duplicate OMO durable reflection/recall. Do not copy Operator Pi adapter's factory-time detached Helper update process.

No production code, package, config, compaction, or tracked project change is required for this assessment. This report is sole allowed untracked evidence write.

## Original Intent

Review Operator Pi adapter source behavior without changes; map current official/local Senpi ExtensionAPI support; assess coexistence risk; recommend smallest native-compaction-preserving port.

## Desired Outcome

User needs trustworthy go/no-go assessment, not Operator extension. Result must prove happy path, malformed/failed partition behavior, native-compaction preservation, compatibility, provenance/license/trust constraints, and current tree unchanged.

## User Outcome Review

Approved outcome is assessment only. Existing local Senpi types expose `context`, lifecycle hooks, commands, `exec`, and `sendUserMessage`; `context` specifically prepares a request-local provider context and does not persist session-message mutations. This supports deterministic preamble injection without a compaction replacement. Operator source already caches one rendered message per extension runtime and prepends it to outbound contexts.

Malformed/unavailable partition result is all-or-diagnostic, not partial memory: Operator loads shared, user, and private partitions independently; `renderPreamble` emits no memory files when any partition result fails. Unexpected load/render failure leaves original messages and aborts affected call. Future port must retain this boundary.

Native compaction stays intact when future port registers none of `session_before_compact` or `session_compact`. Local package implementation keeps defaults `reserveTokens=16384`, `keepRecentTokens=20000`; current global agent setting has `"compaction": {}`. Current project tree has no Operator extension/package/build registration and no working-tree or index diff.

OMO reflection/recall duplication is correctly rejected. Recorded native sessions show `omo.memory.updated` reflection state; adding Operator as another automatic durable-memory authority risks contradictory instruction sources and duplicate context cost. Use one authority for same facts. Operator partition files can remain explicit user-managed input, but no automatic reflection, recall, indexing, or writer should be ported.

Operator's `startHelperUpdate()` starts detached `operator-helper version` from extension factory. Official Senpi extension guidance forbids background processes, sockets, watchers, or timers there. Omit it.

## Criteria Review

| Criterion | Result | Evidence |
|---|---|---|
| C001 happy path: source/API mapping and narrow scope | PASS | Upstream Operator Pi `context` prepends cached rendered preamble; local Senpi `ExtensionAPI` defines `context`, `session_start`, `session_shutdown`, `registerCommand`, `sendUserMessage`, and `exec`. |
| C002 malformed/failed partition behavior | PASS | Upstream `loadMemorySnapshot` loads all three partitions; `renderPreamble` returns canonical no-memory diagnostic when any fails. Adapter test verifies diagnostic injection; unexpected failure aborts and returns original messages. |
| C003 adjacent/native compaction preservation | PASS | `a0/cli-transcript.txt`, `a0/data-diff.txt`, local resolver/type artifacts, and clean Git state show no Operator registration or compaction change. |

## Direct Review: Slop and Programming Criteria

No production or test diff exists. No added production extraction, parsing, normalization, abstraction, dependencies, or tests exist to assess. Therefore no deletion-only, requested-removal, tautological, implementation-mirroring, or excessive test was introduced. No maintenance burden or false confidence from shipped code exists.

`remove-ai-slops` and `programming` criteria were consulted. Applicable programming conclusion: code need not exist for assessment; no TypeScript/production artifact was written. Future implementation should be one narrow extension, typed against pinned local Senpi API, with no compaction hooks, no broad error swallowing, no factory background process, and behavior tests at real extension boundary.

## Provenance, License, Trust, Compatibility

- Operator source provenance: `aerovato/operator-memory` main, observed commit `33d217ab39d0ae4062a92dd0414704ee991fd74d`.
- Operator license: BSD 3-Clause. A copied/derived future port must retain copyright, conditions, and disclaimer; this assessment copied no code.
- Senpi source provenance: local installed `@code-yeongyu/senpi@2026.9.10-2`, lockfile pin same version; upstream main observed commit `95850167da8ef2b58615662e7ebe3d43511f3dd4`.
- Trust: official Senpi extension guide states extensions have full system permissions and project-local extensions require project trust. A future Operator extension and external `operator-helper` invocation require explicit source/CLI trust decision.
- Version note: root `package.json` declares `2026.9.13`, but `bun.lock` and installed package resolve `2026.9.10-2`. Assessment conclusions rely on inspected installed/locked API, not uninstalled manifest declaration. Recheck API compatibility after resolving this version drift or upgrading.

## Checked Artifacts

- `.omo/ulw-loop/01a09dfa-1b96-7804-84af-09eb1b27c2c1/brief.md`
- `.omo/ulw-loop/01a09dfa-1b96-7804-84af-09eb1b27c2c1/goals.json`
- `.omo/ulw-loop/01a09dfa-1b96-7804-84af-09eb1b27c2c1/ledger.jsonl`
- `.omo/evidence/ulw/01a09dfa-1b96-7804-84af-09eb1b27c2c1/G001-review-operator-pi-adapter-source-be/a0/cli-transcript.txt`
- `.omo/evidence/ulw/01a09dfa-1b96-7804-84af-09eb1b27c2c1/G001-review-operator-pi-adapter-source-be/a0/data-diff.txt`
- `package.json`, `bun.lock`, `README.md`, `docs/compatibility.md`
- `/home/egsox/.omo/agent/settings.json`
- `node_modules/@code-yeongyu/senpi/package.json`
- `node_modules/@code-yeongyu/senpi/dist/core/extensions/types.d.ts`
- `node_modules/@code-yeongyu/senpi/dist/core/compaction-settings-resolver.js`
- `node_modules/@code-yeongyu/senpi/docs/extensions.md`
- Upstream Operator: `packages/pi/src/index.ts`, `packages/pi/src/commands.ts`, `packages/pi/test/index.test.ts`, `packages/core/src/memory/load.ts`, `packages/core/src/preamble.ts`, `LICENSE` at `https://github.com/aerovato/operator-memory`
- Upstream Senpi: `packages/coding-agent/docs/compaction.md`, `packages/coding-agent/src/core/extensions/types.ts` at `https://github.com/code-yeongyu/senpi`
- Skill criteria: `/home/egsox/.config/orca/codex-runtime-home/home/plugins/cache/sisyphuslabs/omo/4.19.4/skills/remove-ai-slops/SKILL.md`; `.../skills/programming/SKILL.md`
- Git inspection: `git status --porcelain=v1`, `git diff --stat`, `git diff --cached --stat` observed clean before this ignored evidence write.

## Blockers

None.

## Notes and Exact Evidence Gaps

1. No code review report or manual-QA matrix was supplied for this read-only assessment. Therefore no artifact explicitly demonstrates an independent reviewer covered `remove-ai-slops` or `programming`; direct gate review did. This is not a stated success-criterion failure because no implementation/test artifact exists.
2. Upstream Operator source/tests were inspected through live GitHub raw URLs, not locally vendored source or a pinned commit checkout. Current-main evidence can change; pin source revision before any port implementation.
3. Assessment proves API feasibility and unchanged current state, not a future extension's runtime behavior. Future implementation needs native Senpi integration tests for successful preamble injection, one failing partition's all-or-diagnostic outcome, unexpected render failure cancellation, shutdown cache reset, and no compaction-hook registration.
4. Exact active OMO reflection configuration source was not locally discoverable from current agent settings. Native `omo.memory.updated` evidence proves reflection runtime exists, sufficient for duplicate-authority risk but not for a full configuration inventory.

## Strongest Evidence

1. Local `ExtensionContext` contract: `context` prepares request-local provider context and persisted session messages are never modified (`node_modules/@code-yeongyu/senpi/dist/core/extensions/types.d.ts`).
2. Operator adapter inserts one cached synthetic preamble through `pi.on("context")`; no compaction hook is used (upstream `packages/pi/src/index.ts`).
3. Operator `renderPreamble` emits one recovery diagnostic with no included memory files if shared, user, or private load fails; adapter test proves unexpected failure aborts affected call and preserves original messages (upstream `packages/core/src/preamble.ts`, `packages/pi/test/index.test.ts`).
4. Senpi guide prohibits factory-time background resources; Operator's detached Helper update is factory-time (`node_modules/@code-yeongyu/senpi/docs/extensions.md`; upstream `packages/pi/src/index.ts`).
5. Existing a0 evidence and clean Git diff prove no port or compaction modification occurred.
