---
slug: native-operator-memory
status: approved-with-reviewer-harness-gap
intent: clear
review_required: true
plan_path: .omo/plans/native-operator-memory.md
plan_sha256: 0e5ba1e71f9fc03d7f895d1066a1b84bc8caa980c3747c21192bc6946f295526
review_round_id: native-artifact-gate-round-2-approved
review_round_limit: 5
pending-action: plan handoff ready; await separate explicit execution request
review:
  plan_reviewer:
    status: approved-artifact-gate
    workspace_root: /home/egsox/repo/omo-workflows
    runtime_home: null
    target: .omo/plans/native-operator-memory.md
    round_id: native-artifact-gate-round-2
    plan_sha256: 0e5ba1e71f9fc03d7f895d1066a1b84bc8caa980c3747c21192bc6946f295526
    launch_id: st_01a0ab81
    session: st_01a0ab81
    result: APPROVE — artifact gate reviewed exact corrected plan. Receipt `.omo/evidence/native-operator-memory-gate-review.md`. Native plan-reviewer attempts st_01a0ab76 and st_01a0ab77 are inconclusive harness failures: both received `.omo/plans/*.md` rather than supplied canonical artifact, so neither reviewed content.
approach: User approved observer-only status extension with zero provider-context tokens and compatibility verification for repository Senpi 2026.9.10-2 plus global OMO/Senpi 2026.9.13.
---

# Draft: native-operator-memory

## Components (topology ledger)
| id | outcome (one line) | status | evidence path |
|---|---|---|---|
| observer-status | Native extension reports only derived session health and ownership; no memory content enters provider context. | recommended | `.omo/evidence/ulw/01a09dfa-1b96-7804-84af-09eb1b27c2c1/G001-review-operator-pi-adapter-source-be/a0/gate-review.md` |
| curated-project-brain | Separate, bounded, deterministic project-document preamble with exclusive data ownership. | rejected by approved default | same gate review; advisory `st_01a0aaf4` |
| compatibility-fence | Package/runtime pin reconciliation and upstream validation prevent unsupported lifecycle use. | required | `package.json`, `bun.lock`, installed/global Senpi manifests |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
|---|---|---|---|
| Product scope | Observer-only status surface; zero injected provider-context tokens. | OMO owns durable facts, reflection, and recall; Senpi owns transcript and compaction. | Yes, before implementation only. |
| Storage | No durable content store or cache. | Prevents hidden second memory authority and matches approved observer-only scope. | Yes, before implementation only. |
| Upstream adaptation | BSD-3-Clause concepts/provenance, no Pi package import or copied helper. | Host adapter is Pi-specific; Senpi public API is required. | No after distribution. |

## Findings (cited - path:lines)
- Gate review: narrow native extension is technically feasible through Senpi `context`, lifecycle, command, and UI seams, but must not replace native compaction or duplicate OMO reflection/recall. `.omo/evidence/ulw/01a09dfa-1b96-7804-84af-09eb1b27c2c1/G001-review-operator-pi-adapter-source-be/a0/gate-review.md`.
- Official Senpi guide: `context` can mutate messages; extension factories must not start background processes, sockets, watchers, or timers. `https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/extensions.md`.
- Official Senpi compaction: native compaction triggers at `contextTokens > contextWindow - reserveTokens`; custom replacement is only through `session_before_compact`. `https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/compaction.md`.
- Upstream Operator Pi source loads and caches a synthetic preamble; it also starts a detached helper update from factory. A native port may use neither Pi imports nor factory-time process behavior. `https://github.com/aerovato/operator-memory/blob/main/packages/pi/src/index.ts`.
- Upstream Operator core returns all-or-diagnostic: any unavailable partition yields diagnostic instead of partial brain. `https://github.com/aerovato/operator-memory/blob/main/packages/core/src/preamble.ts`.
- OMO configuration already enables reflection and recall through `memory-reflection`; duplicate durable knowledge must be prevented. `/home/egsox/.omo/omo.jsonc`.
- Version drift: manifest `2026.9.13`, repo lock/node_modules `2026.9.10-2`, global OMO runtime `2026.9.13`. Resolve supported pair before lifecycle implementation. `package.json`, `bun.lock`.

## Decisions (with rationale)
- Retain native Senpi ownership of context compaction, branch summaries, transcript, overflow recovery, and prompt-cache-safe summarization.
- Retain native OMO ownership of durable facts, reflection, recall, memory Git state, and agents.
- For approved observer-only scope, register only `/operator-memory[ status]`; no lifecycle registration, context/prompt mutation, or compaction interaction.
- Curated project-brain scope is rejected. No repository document class is introduced as a second durable-memory authority.
- Build package-local Bun/TypeScript operations only. No external `operator-helper`, sidecar, network request, timer, watcher, process, or background worker.

## Scope IN
- Installable `extensions/operator-memory/` package with `AGENTS.md`, package manifest, source, tests, upstream attribution/license material, root registration, README/catalog route, and upstream-validation record.
- Test-first behavior proof, native live OMO/Senpi command QA, malformed input QA, compaction-preservation proof, package install/list proof, and `mise ci`.
- Atomic conventional commits after each verified increment.

## Scope OUT (Must NOT have)
- No Operator Pi package install, imports, or external helper CLI.
- No read/write of Senpi transcript, CompactionEntry, branch summary, OMO memory repository, facts, reflection, or Kibitzer recall state.
- No `session_before_compact`, custom summary, `context` mutation, `before_agent_start`, `appendEntry`, `sendMessage`, `sendUserMessage`, automatic index/repair, provider-context preamble, or content persistence in observer-only scope.
- No background process, timer, file watcher, socket, network request, child agent, or global config modification.

## Open questions
None. User selected observer-only scope and approved both repository Senpi `2026.9.10-2` and global OMO/Senpi `2026.9.13` compatibility evidence.

## Approval gate
status: approved-plan-review-pending
approval: User selected `Approve defaults` through the plan gate on 2026-09-16. Authorization covers plan creation and mandatory plan review only; it does not authorize implementation.
approach: Observer-only `/operator-memory` status extension, zero provider-context tokens, no durable content/memory work/compaction interception, compatibility matrix for both runtime surfaces.
plan: `.omo/plans/native-operator-memory.md`
plan_sha256: `0e5ba1e71f9fc03d7f895d1066a1b84bc8caa980c3747c21192bc6946f295526`
structural-audit: PASS — 7 implementation task rows and 4 final-verifier rows are column-zero, correct grammar, correct sections, each with executor category; all implementation tasks have references, acceptance, QA, and commit fields. Markdown LSP is unavailable; task grammar audit is recorded instead.
review-ledger: Native plan-reviewer rounds 1-2 are inconclusive because harness substituted `.omo/plans/*.md` for supplied exact artifact path. Independent artifact gate round 1 rejected SC1/SC5; plan correction adds byte-exact seven-line status/no-newline contract, manifest version parity, TUI slash-command QA, and transient negative-control fixture. Artifact gate round 2 APPROVED exact corrected plan; receipt `.omo/evidence/native-operator-memory-gate-review.md`.
next workflow action: Handoff plan only. Never implement in this session; wait for user to request a separate `/ulw-execute` run.
