# Gate Review: Native Operator Memory Plan

## Recommendation

**APPROVE**

Prior SC1 and SC5 blockers are fixed. No new execution-blocking defect tied to a stated success criterion was found in allowed review scope.

## Original Intent

Ship separately installable, command-only `/operator-memory` observer extension. It reports native context and ownership state without memory authority, provider-context contribution, lifecycle interception, persistence, or background work. It must work on repository-pinned and global OMO/Senpi runtimes with evidence, docs, provenance, cleanup, and atomic Conventional Commits.

## Desired Outcome

Executor receives unambiguous, test-first plan proving exact status behavior, observer-only ownership boundary, package discovery, both-runtime compatibility, documentation/provenance, cleanup, and commit policy.

## User Outcome Review

Plan now gives user observable contract, tests it as whole bytes, and drives actual local slash-command surface in OMO TUI. Invalid subcommand follows same TUI path. Task 6 now creates temporary test-only bad host interaction, captures expected nonzero RED, removes fixture, then proves unchanged production extension GREEN. This meets requested proof without manufacturing production defect.

## Prior Blocker Review

| Prior blocker | Result | Evidence |
|---|---|---|
| SC1 exact observer status | Fixed | `.omo/plans/native-operator-memory.md:27-37` defines exact seven-line literal template, `\n` separators, no trailing newline, allowed dynamic values, and literal version source. Task 1 acceptance at `:91-92` requires byte-for-byte known and unknown output, exact line order, and no final newline. Task 5 at `:127-128` requires global OMO TUI rendered status to match whole template byte-for-byte. F3 at `:153-156` repeats real-TUI whole-output match. |
| SC5 Task 6 genuine RED then GREEN | Fixed | `.omo/plans/native-operator-memory.md:133-137` requires explicit transient negative-control fixture invoking forbidden `pi.on` against fake-host sentinel, expected failing assertion/nonzero receipt, removal before final adversarial test, unchanged production source, then targeted GREEN command. This is executable without production change. |
| Real slash-command QA, not `--print` | Fixed / present | `.omo/plans/native-operator-memory.md:57-58`, `:128`, `:137`, and `:153-156` require isolated background OMO TUI, PTY `bash_input` of `/operator-memory status` or `/operator-memory clear`, and captured terminal screen. Plan expressly rejects `--print` because it sends model prompt text rather than execute local slash command. |

## Direct Remove-AI-Slops Review

No implementation diff exists; review scope is plan plus prior receipt. Direct plan pass finds no requested-removal, deletion-only, tautological, implementation-mirroring, or prose-pin test. Exact status comparisons lock shipped machine-visible command contract, not prose. Temporary Task 3 duplicate-registration probe and Task 6 negative control are explicitly transient, have concrete distinct failure targets, and require removal before final GREEN; they do not create shipped test bloat. Two small production modules (`status.ts`, `index.ts`) are justified seams: pure formatter and framework entrypoint. No needless parsing, normalization, dependency, extraction, cache, or abstraction is planned.

## Direct Programming Review

Plan follows minimum-code ladder: command-only package, no runtime dependencies, public API intersection, pure status formatter, boundary-local argument parsing, no provider-context mutation, no hook, no process, no persistence. Task 1-3 use RED before source; Task 5/F3 use real TUI E2E surface. Isolated `mktemp -d` state plus teardown prevents cross-run leakage. No fixed sleep or polling delay is specified; TUI readiness is required before action. No maintenance burden, false-confidence test, or scope drift tied to a success criterion found.

## Reviewer-Receipt Coverage Check

Prior receipt `.omo/evidence/native-operator-memory-gate-review.md:54-56` explicitly records its own `remove-ai-slops` and `programming` review, including test-shape, unnecessary production-code, dependency, parsing, and abstraction coverage. It did not replace direct review above. Its former SC1 and SC5 findings at `:24-48` are addressed by present plan evidence listed above.

## Checked Artifacts

- `.omo/plans/native-operator-memory.md`
- `.omo/evidence/native-operator-memory-gate-review.md` (prior receipt, before this replacement)
- `.omo/evidence/ulw/01a09dfa-1b96-7804-84af-09eb1b27c2c1/G001-review-operator-pi-adapter-source-be/a0/gate-review.md`
- `extensions/trim/src/index.ts`
- `test/extension-load.test.ts`
- `/home/egsox/.config/orca/codex-runtime-home/home/plugins/cache/sisyphuslabs/omo/4.19.4/skills/remove-ai-slops/SKILL.md`
- `/home/egsox/.config/orca/codex-runtime-home/home/plugins/cache/sisyphuslabs/omo/4.19.4/skills/programming/SKILL.md`

## Blockers

None.

## Notes

- No implementation diff, executor evidence, code-review report, or manual-QA matrix exists because this is plan re-review. Not a blocker: SC5 makes their capture an execution requirement before handoff.
- `omo-agent-toolkit ulw-loop status --json` is unavailable on workstation (`omo-agent-toolkit: command not found`, exit 127). Used mandated no-plan fallback path `.omo/evidence/native-operator-memory-gate-review.md`.
- Terminal-screen rendering may include TUI chrome. Plan's requirement is exact comparison of rendered status region/whole emitted status against template; executor must preserve comparison method and captured screen in receipts required by SC5.

## Exact Evidence Gaps

- Future execution receipts do not yet exist: Task 1-7 and F1-F4 evidence files are planned, not produced. Approval is plan-only and does not claim implementation success.
- No ULW status artifact was readable because CLI is absent. Attempt directory therefore cannot be derived from runtime status.
