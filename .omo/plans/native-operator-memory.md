# native-operator-memory - Work Plan

## TL;DR (For humans)

**What you'll get:** A separately installable `/operator-memory` status extension. It reports only current native context health and ownership; it never stores or injects memory content.

**Why this approach:** OMO already owns durable facts, reflection, and recall. Senpi already owns session history and compaction. Keeping this extension command-only prevents a competing memory authority and adds zero tokens to every model request.

**What it will NOT do:** It will not add a project brain, prompt preamble, durable content store, recall, reflection, compaction hook, helper CLI, or background process.

**Effort:** Medium
**Risk:** Medium - both repository and global OMO runtime APIs must remain compatible.
**Decisions to sanity-check:** Observer-only scope and support for both Senpi runtime surfaces were explicitly approved.

Your next move: execute this plan in a separate `/ulw-execute` session. Full execution detail follows below.

---

> TL;DR (machine): Medium risk; deliver an observer-only command extension, prove it across repo/global Senpi surfaces, and preserve native memory and compaction ownership.

## Scope

### Must have

- Installable `extensions/operator-memory/` package with no runtime dependencies and `pi.extensions: ["./src/index.ts"]`.
- One user command: `/operator-memory` and `/operator-memory status` render the same fixed-order observer status via public `ctx.ui.notify`.
- Status has this exact seven-line template, with `\n` separators and no trailing newline. `0.1.0` is literal in `src/status.ts` because observer scope forbids runtime manifest/file reads; Task 3 pins package `version` to the same literal and tests equality:
  ```text
  Version: 0.1.0
  Mode: observer
  Durable memory owner: native OMO
  Compaction owner: native Senpi
  Context: <tokens|unknown>/<contextWindow|unknown>
  Compaction: <active|idle|unknown>
  Provider context contribution: 0 tokens
  ```
  `<tokens>` is a finite non-negative integer or `unknown`; `<contextWindow>` is a finite positive integer or `unknown`; compaction uses only `active`, `idle`, or `unknown`.
- Empty or whitespace-only argument and exact `status` are accepted. Every other argument renders exactly `Unsupported operator-memory command. Use /operator-memory status.` and mutates nothing.
- Source uses only the public API intersection confirmed in both local Senpi surfaces: `ExtensionAPI.registerCommand`, command `ExtensionContext.getContextUsage`, optional `isCompacting`, and `ui.notify`.
- Test-first RED-to-GREEN proof, root loading smoke coverage, direct OMO package/command QA using isolated temp state, cross-runtime verification, upstream validation/provenance, docs, and atomic Conventional Commit increments.

### Must NOT have (guardrails, anti-slop, scope boundaries)

- No `pi.on(...)` registration: no `context`, `before_agent_start`, `session_start`, `session_shutdown`, `session_compact`, `session_before_compact`, `agent_settled`, or any lifecycle work.
- No prompt/system/context mutation, synthetic messages, `sendMessage`, `sendUserMessage`, `appendEntry`, `ctx.compact`, `applyCompaction`, custom summary, branch-summary change, session/transcript read, or memory-repository access.
- No cache, content store, index, project/user partition, facts extraction, recall, reflection, Kibitzer sidecar, repair/init command, external `operator-helper`, process, network request, timer, watcher, socket, child agent, or global settings write.
- No copy or runtime import of `@aerovato/operator-*` or Pi packages. Operator Memory is behavior/provenance reference only.
- No `.gitignore` change: package creates no generated runtime state. Do not add `docs/issues.md` entry because no user-reported runtime issue is being fixed.

## Verification strategy

> Zero human intervention - all verification is agent-executed.

- Test decision: TDD using `bun:test`. Every behavior todo records RED output before source change, then focused GREEN output after source change.
- LSP: run diagnostics on each changed TypeScript file after its GREEN pass. Errors block progress.
- Repository gate: `bun test extensions/operator-memory/test test/extension-load.test.ts`, `bun run validate:package`, `bun run typecheck`, `bun run build`, then `mise ci` once after all inputs settle.
- Live command surface: use an isolated `mktemp -d` agent/session directory and a background OMO TUI, not `--print` (print sends prompt text to model and does not execute local slash commands). Start `SENPI_CODING_AGENT_DIR="$TMP_AGENT" OMO_CODING_AGENT_DIR="$TMP_AGENT" omo --offline --no-session --no-extensions -e "$PWD/extensions/operator-memory/src/index.ts"`; wait for TUI prompt; send `/operator-memory status` through PTY `bash_input`; capture `bash_output({ view: "screen" })`; repeat with `/operator-memory clear`; exit TUI; capture stdout/stderr/exit code under `<attemptDir>`. Remove directories and prove paths no longer exist.
- Evidence root: `.omo/evidence/ulw/<session>/<goalId>/a<attempt>/` when running ULW; otherwise `.omo/evidence/`. Every task owns files named `task-<N>-operator-memory-*`.

## Execution strategy

### Parallel execution waves

- Wave 1: Task 1 owns pure status formatting/test files. Task 4 owns provenance evidence gathering only until Task 3 makes final docs paths known. This parallelism pays because files and decisions are disjoint.
- Wave 2: Task 2 owns command registration/test files. Task 3 depends on Task 2 because package and root smoke test import the actual entrypoint.
- Wave 3: Task 4 writes package/repository docs after package shape is final. Tasks 5 and 6 run independent compatibility and live-surface evidence in separate temporary agent directories after Tasks 1-4 are green.
- Wave 4: Task 7 runs final repository gates and self-review after all source/docs settle.
- Final verification wave: F1-F4 run independently after Task 7. They do not edit source. Any criterion-cited blocker returns to its owning todo, then affected QA and F1-F4 rerun.
- Recommended executor topology: route Tasks 1-3 to `unspecified-high` because they create a new package against two runtime versions; Task 4 to `writing`; Tasks 5-7 and F1-F4 to `unspecified-high` for adversarial verification. Keep all source edits in one worker; separate evidence-only tasks may fan out only after their dependencies are green.

### Dependency matrix

| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | none | 2, 3, 5, 6, 7 | 4 evidence gathering only |
| 2 | 1 | 3, 5, 6, 7 | none |
| 3 | 2 | 4, 5, 6, 7 | none |
| 4 | 3 | 5, 6, 7 | 5, 6 |
| 5 | 3 | 7 | 4, 6 |
| 6 | 3 | 7 | 4, 5 |
| 7 | 4, 5, 6 | F1-F4 | none |
| F1-F4 | 7 | handoff | each other |

## Todos

- [ ] 1. Build pure observer-status contract with a RED-to-GREEN formatting test
  Recommended task executor category: unspecified-high
  What to do / Must NOT do: Create `extensions/operator-memory/src/status.ts` and `extensions/operator-memory/test/status.test.ts`. First create the test only and run `bun test extensions/operator-memory/test/status.test.ts`, capturing RED caused by missing module or behavior. Then implement a pure formatter accepting `{ tokens: number | null | undefined; contextWindow: number | undefined; compacting: boolean | undefined }` and a parsed command argument. For `""`, whitespace, and `"status"`, return Scope's exact seven-line template with no trailing newline, literal `Version: 0.1.0`, `123/128000` for valid values, `unknown` for null/unavailable/invalid values, and optional-compaction `unknown`. For every other input, return exactly `Unsupported operator-memory command. Use /operator-memory status.`. Never read/write files, environment, session, OMO memory, or network.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 2, 3, 5, 6, 7
  References (executor has NO interview context - be exhaustive): `.omo/evidence/ulw/01a09dfa-1b96-7804-84af-09eb1b27c2c1/G001-review-operator-pi-adapter-source-be/a0/gate-review.md`; `extensions/trim/src/index.ts:1-220`; repo and global `node_modules/@code-yeongyu/senpi/dist/core/extensions/types.d.ts:257-263` define nullable estimated context usage; `docs/upstream-validation.md:1-43` defines runtime evidence record.
  Acceptance criteria (agent-executable): RED log shows test cannot import/observe new formatter before source exists. GREEN asserts complete byte-for-byte Scope template for valid `123/128000` idle state and fully unknown state, including exact line order and no final newline; it also asserts bare/whitespace/status equivalence and exact unsupported response. `bun test extensions/operator-memory/test/status.test.ts` exits 0 with no skips; diagnostics for `src/status.ts` and its test have no errors.
  QA scenarios (name the exact tool + invocation): Unit happy: `bun test extensions/operator-memory/test/status.test.ts --test-name-pattern "known context"` PASS compares whole output to Scope template with `Context: 123/128000` and no trailing newline. Unit failure: `bun test extensions/operator-memory/test/status.test.ts --test-name-pattern "unsupported"` PASS compares whole output to exact rejection and excludes template lines. Evidence `<attemptDir>/task-1-operator-memory-red.txt`, `task-1-operator-memory-green.txt`, and `task-1-operator-memory-lsp.json`.
  Commit: Y | `feat(operator-memory): add observer status contract`

- [ ] 2. Register command-only public Senpi extension with RED-to-GREEN host harness
  Recommended task executor category: unspecified-high
  What to do / Must NOT do: First add `extensions/operator-memory/test/index.test.ts` that imports the future entrypoint through a minimal fake `ExtensionAPI`; run it RED before `src/index.ts` exists. Then create `extensions/operator-memory/src/index.ts` with only default factory registration of `pi.registerCommand("operator-memory", { description, argumentHint: "[status]", handler })`. Handler calls only `ctx.getContextUsage()`, optional `ctx.isCompacting?.()`, pure Task 1 formatter, and `ctx.ui.notify(message, unsupported ? "warning" : "info")`. Do not call `pi.on`, any session/control API, file API, or process API. Fake host must intentionally omit forbidden APIs so calls fail the test.
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 3, 5, 6, 7
  References (executor has NO interview context - be exhaustive): repo/global `node_modules/@code-yeongyu/senpi/dist/core/extensions/types.d.ts:334-381,476-545,758-790,1298-1382`; public docs `https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension`; `test/AGENTS.md:1-24`; `test/extension-load.test.ts:1-72`; upstream Operator Pi adapter is negative reference `https://github.com/aerovato/operator-memory/blob/main/packages/pi/src/index.ts`.
  Acceptance criteria (agent-executable): RED fails before entrypoint exists. GREEN proves exactly one registered command named `operator-memory`, no registered event handlers, bare/status issue one info notification with Task 1 text, unsupported arg issues one warning notification with exact text, available usage is passed through, and absent `isCompacting` yields `unknown`. `bun test extensions/operator-memory/test/index.test.ts` exits 0 and source diagnostics are clean.
  QA scenarios (name the exact tool + invocation): Host happy: `bun test extensions/operator-memory/test/index.test.ts --test-name-pattern "registers observer command"` PASS sees one command and zero events. Host failure: `bun test extensions/operator-memory/test/index.test.ts --test-name-pattern "rejects unsupported"` PASS sees one warning and no forbidden host call. Evidence `<attemptDir>/task-2-operator-memory-red.txt`, `task-2-operator-memory-green.txt`, `task-2-operator-memory-lsp.json`.
  Commit: Y | `feat(operator-memory): register observer command`

- [ ] 3. Package observer extension and add root discovery smoke coverage with RED-to-GREEN proof
  Recommended task executor category: unspecified-high
  What to do / Must NOT do: First extend `test/extension-load.test.ts` to import future `extensions/operator-memory/package.json`, load `../extensions/operator-memory/src/index.ts` via a fake host, and assert command registration/no lifecycle events. Run this focused test RED before package/root registration changes. Then add `extensions/operator-memory/package.json` with private name `@omo-workflows/operator-memory`, exact `version: "0.1.0"`, type module, no dependencies, and only `pi.extensions: ["./src/index.ts"]`; add exact entrypoint to root `package.json` `pi.extensions` and build command; add package to root smoke test. Assert manifest version is `0.1.0`, matching Task 1 literal. Do not change OMO global settings, add a dependency, or alter unrelated extensions.
  Parallelization: Wave 2 | Blocked by: 2 | Blocks: 4, 5, 6, 7
  References (executor has NO interview context - be exhaustive): `extensions/trim/package.json:1-10`; `extensions/workflow-graph/package.json:1-13`; root `package.json` scripts and `pi.extensions`; `test/extension-load.test.ts:1-300`; `test/AGENTS.md:1-24`; `docs/authoring-extensions.md:1-74`.
  Acceptance criteria (agent-executable): Focused RED fails because package/registration is absent. GREEN proves standalone manifest entry is exactly `./src/index.ts`, root package lists extension exactly once, root build compiles the new entrypoint, and smoke host sees one `operator-memory` command and no events. `bun test test/extension-load.test.ts`, `bun run validate:package`, and `bun run build` exit 0.
  QA scenarios (name the exact tool + invocation): Package happy: `bun test test/extension-load.test.ts --test-name-pattern "loads through Senpi"` PASS includes Operator Memory host assertions. Duplicate failure: use a test fixture/expected assertion that rejects two root registrations; mutate only test fixture if test architecture allows, revert probe, then rerun GREEN. Evidence `<attemptDir>/task-3-operator-memory-red.txt`, `task-3-operator-memory-green.txt`, `task-3-operator-memory-package.txt`, `task-3-operator-memory-build.txt`.
  Commit: Y | `feat(operator-memory): package native observer extension`

- [ ] 4. Add ownership, provenance, compatibility, and installation documentation without changing runtime policy
  Recommended task executor category: writing
  What to do / Must NOT do: Add `extensions/operator-memory/AGENTS.md`, `extensions/operator-memory/README.md`, `extensions/operator-memory/UPSTREAM.md`, and `extensions/operator-memory/LICENSES/Operator-Memory-BSD-3-Clause.txt`. `UPSTREAM.md` must record immutable upstream Operator Memory revision obtained with `git ls-remote https://github.com/aerovato/operator-memory.git HEAD`, BSD-3-Clause license, Pi-adapter non-portability, and statement that no upstream code is copied. Update root `README.md` and `docs/customizations.md` to list package/install path. Add `### Operator Memory observer extension` record to `docs/upstream-validation.md` with actual OMO/Senpi/Bun versions, immutable OMO and Senpi evidence URLs, local proof commands, both-runtime revalidation trigger, and current status. State no migration/global config change and no `.gitignore` change because scope persists no data. Do not change `docs/issues.md`, external dependencies, or runtime configuration.
  Parallelization: Wave 3 | Blocked by: 3 | Blocks: 7 | Can parallelize with: 5, 6
  References (executor has NO interview context - be exhaustive): root `AGENTS.md: Upstream Validation Contract`, `docs/upstream-validation.md:1-43`, `docs/authoring-extensions.md:1-74`, `extensions/workflow-graph/UPSTREAM.md:1-34`, upstream license `https://github.com/aerovato/operator-memory/blob/main/LICENSE`, upstream Pi manifest `https://github.com/aerovato/operator-memory/blob/main/packages/pi/package.json`, `README.md:1-100`, `docs/customizations.md:1-80`.
  Acceptance criteria (agent-executable): Review confirms every new doc states observer-only/zero-token boundary, names native OMO and Senpi owners, cites immutable sources, preserves BSD notice, and tells installers `omo install -l ./extensions/operator-memory`. `git diff --check` exits 0; `bun run validate:package` and root package loading test remain green. Do not add prose-pin tests.
  QA scenarios (name the exact tool + invocation): Documentation/install surface: `SENPI_CODING_AGENT_DIR="$TMP_AGENT" OMO_CODING_AGENT_DIR="$TMP_AGENT" omo install -l "$PWD/extensions/operator-memory" --approve`, then `SENPI_CODING_AGENT_DIR="$TMP_AGENT" OMO_CODING_AGENT_DIR="$TMP_AGENT" omo list -l --approve`; PASS lists `@omo-workflows/operator-memory` without modifying user-global settings. Cleanup: `rm -rf "$TMP_AGENT"` then `test ! -e "$TMP_AGENT"`. Evidence `<attemptDir>/task-4-operator-memory-upstream.txt`, `task-4-operator-memory-install.txt`, `task-4-operator-memory-cleanup.txt`.
  Commit: Y | `docs(operator-memory): document native observer boundary`

- [ ] 5. Prove repo-pin and global-runtime compatibility using public API intersection
  Recommended task executor category: unspecified-high
  What to do / Must NOT do: Run focused package tests/typecheck against repository `node_modules/@code-yeongyu/senpi@2026.9.10-2`, then load the same entrypoint with current global OMO/Senpi `2026.9.13` using a fresh temporary agent directory. Capture `package.json`, `bun.lock`, repo package manifest, and global package manifest versions in one compatibility matrix artifact. If either runtime lacks a used public method, reduce source to the intersection and repeat Task 2/3 tests; do not polyfill, cast around, patch installed runtime, modify model routes, or change version pins merely to hide drift.
  Parallelization: Wave 3 | Blocked by: 3 | Blocks: 7 | Can parallelize with: 4, 6
  References (executor has NO interview context - be exhaustive): repository/global `@code-yeongyu/senpi/dist/core/extensions/types.d.ts:257-263,334-381,1298-1382`; root `package.json`; `bun.lock`; global `/home/egsox/.bun/install/global/node_modules/@code-yeongyu/senpi/package.json`; `docs/upstream-validation.md:11-36`.
  Acceptance criteria (agent-executable): `bun test extensions/operator-memory/test test/extension-load.test.ts` and `bun run typecheck` pass under repository dependency tree. Isolated global OMO TUI run exits 0 and captured terminal screen matches Scope's entire seven-line template byte-for-byte, except dynamic valid/unknown context fields allowed by Scope. Matrix artifact names repo lock/node_modules `2026.9.10-2`, root manifest/global OMO `2026.9.13`, used methods, and PASS/FAIL for each; any API mismatch is a blocking defect, not a note.
  QA scenarios (name the exact tool + invocation): Repo pin: `bun test extensions/operator-memory/test test/extension-load.test.ts && bun run typecheck` PASS. Global runtime: start `SENPI_CODING_AGENT_DIR="$TMP_AGENT" OMO_CODING_AGENT_DIR="$TMP_AGENT" omo --offline --no-session --no-extensions -e "$PWD/extensions/operator-memory/src/index.ts"` in a background PTY, send `/operator-memory status` with `bash_input`, capture `bash_output({ view: "screen" })`, and compare whole rendered status to Scope template with actual `<tokens|unknown>/<contextWindow|unknown>` substitution. Exit TUI and require exit 0. Cleanup `rm -rf "$TMP_AGENT"; test ! -e "$TMP_AGENT"`. Evidence `<attemptDir>/task-5-operator-memory-compatibility.json`, `task-5-operator-memory-repo-green.txt`, `task-5-operator-memory-global.txt`, `task-5-operator-memory-cleanup.txt`.
  Commit: Y | `test(operator-memory): verify supported Senpi runtimes`

- [ ] 6. Prove ownership fences and native-compaction non-interference through adversarial tests and direct command QA
  Recommended task executor category: unspecified-high
  What to do / Must NOT do: Add an explicit transient negative-control fixture in `extensions/operator-memory/test/index.test.ts` that invokes forbidden `pi.on` against fake-host sentinel and asserts the test failure; capture this expected RED. Remove only that temporary negative-control fixture, retaining production source unchanged, then add/run final adversarial test with fake host recording event registrations and exposing forbidden APIs as throwing sentinels. GREEN asserts normal extension has zero events and invokes only command/status UI path, never `on`, `appendEntry`, compaction methods, send-message methods, exec, or filesystem helpers. Add no static string-grep test and do not change production source solely to manufacture RED. Use a second isolated OMO TUI run for unsupported `/operator-memory clear`; verify exact rejection without extension cache/process/runtime artifact. Do not invoke `/compact`, mutate compaction settings, or generate synthetic summary: no registered interception is the faithful observer-scope proof.
  Parallelization: Wave 3 | Blocked by: 3 | Blocks: 7 | Can parallelize with: 4, 5
  References (executor has NO interview context - be exhaustive): `.omo/evidence/ulw/01a09dfa-1b96-7804-84af-09eb1b27c2c1/G001-review-operator-pi-adapter-source-be/a0/gate-review.md`; `extensions/trim/AGENTS.md:1-27`; repo/global `types.d.ts:751-790` `SessionCompactEvent`; `docs/compaction.md` at `https://github.com/code-yeongyu/senpi/blob/main/packages/coding-agent/docs/compaction.md#custom-summarization-via-extensions`.
  Acceptance criteria (agent-executable): RED receipt captures expected assertion failure from temporary forbidden-`pi.on` fixture; fixture removal is recorded before final test. GREEN proves unmodified production extension has zero events and invokes only command/status UI path. Isolated unsupported global TUI command renders exact rejection, exits cleanly, and leaves no extension cache/process/runtime artifact. `bun test extensions/operator-memory/test/index.test.ts` passes with no skips.
  QA scenarios (name the exact tool + invocation): Negative control: add fixture, run `bun test extensions/operator-memory/test/index.test.ts --test-name-pattern "negative control rejects event registration"`, record nonzero expected-failure, remove fixture, then run `bun test extensions/operator-memory/test/index.test.ts --test-name-pattern "does not intercept native memory or compaction"` PASS with zero events and zero forbidden calls. Live failure: start `SENPI_CODING_AGENT_DIR="$TMP_AGENT" OMO_CODING_AGENT_DIR="$TMP_AGENT" omo --offline --no-session --no-extensions -e "$PWD/extensions/operator-memory/src/index.ts"` in background PTY, send `/operator-memory clear` via `bash_input`, capture `bash_output({ view: "screen" })`, and compare whole result to exact rejection. Teardown: exit TUI, inspect `ps` for no `operator-helper`/operator-memory child started, remove `$TMP_AGENT`, verify absent. Evidence `<attemptDir>/task-6-operator-memory-red.txt`, `task-6-operator-memory-green.txt`, `task-6-operator-memory-unsupported.txt`, `task-6-operator-memory-cleanup.txt`.
  Commit: Y | `test(operator-memory): fence native memory ownership`

- [ ] 7. Run final validation, inspect diff, verify clean installation boundary, and commit verified increments
  Recommended task executor category: unspecified-high
  What to do / Must NOT do: Re-run every affected focused test and all root validation only after Tasks 1-6 are green. Run `bun test extensions/operator-memory/test test/extension-load.test.ts`, `bun run validate:package`, `bun run typecheck`, `bun run build`, and `mise ci`; preserve complete command exit status and concise error output. Run LSP diagnostics on all changed `.ts` files. Re-read final diff against `AGENTS.md`, package docs, upstream record, and Must-NOT-Have list. Verify `.gitignore` unchanged and `git check-ignore -v` confirms no new required package source is ignored. Read `git log --oneline -20` and `git log -5 -- <touched paths>` before each commit; create only the task commits listed above after their individual gates are green. Do not amend, force, push, publish, alter unrelated untracked `.omp/`, `.opencode/`, or `openspec/` paths, or commit evidence artifacts.
  Parallelization: Wave 4 | Blocked by: 4, 5, 6 | Blocks: F1-F4
  References (executor has NO interview context - be exhaustive): root `AGENTS.md: Repository Hygiene Policy, Versioning and Release Policy, Closeout`; `package.json` scripts; `mise.toml`; `.gitignore`; `docs/upstream-validation.md`; changed-path AGENTS files; `test/AGENTS.md`.
  Acceptance criteria (agent-executable): Every command exits 0; LSP returns zero errors; `git diff --check` exits 0; required extension/package docs are tracked; no forbidden API/hook appears in behavior tests; status/unsupported manual QA receipts and cleanup receipts exist; commits are atomic Conventional Commits, each already green. Pre-existing unrelated untracked paths remain untouched and reported separately.
  QA scenarios (name the exact tool + invocation): Full gate: `mise ci` PASS exit 0. Package visibility: `SENPI_CODING_AGENT_DIR="$TMP_AGENT" OMO_CODING_AGENT_DIR="$TMP_AGENT" omo install -l "$PWD/extensions/operator-memory" && omo list -l`, PASS lists only test-local registration; cleanup `rm -rf "$TMP_AGENT"; test ! -e "$TMP_AGENT"`. Evidence `<attemptDir>/task-7-operator-memory-mise-ci.txt`, `task-7-operator-memory-lsp.json`, `task-7-operator-memory-diff-check.txt`, `task-7-operator-memory-install.txt`, `task-7-operator-memory-cleanup.txt`.
  Commit: N | all implementation/doc commits already made atomically

## Final verification wave

- [ ] F1. Plan compliance audit
  Recommended task executor category: unspecified-high
  Verify every Must-have and Must-NOT-Have item against final diff, tests, provenance docs, runtime matrix, and evidence receipts. Exact invocation: `git diff --check` plus a read-only review of `extensions/operator-memory/`, root `package.json`, `test/extension-load.test.ts`, `README.md`, `docs/customizations.md`, and `docs/upstream-validation.md`. PASS only if every required scope item maps to evidence and all forbidden behavior is absent from observed host registration; save `<attemptDir>/F1-operator-memory-compliance.md`.

- [ ] F2. Code quality review
  Recommended task executor category: unspecified-high
  Read final diff and run `bun test extensions/operator-memory/test test/extension-load.test.ts`, `bun run typecheck`, and `bun run build`. PASS only if no correctness, API-compatibility, determinism, error-handling, or ownership finding blocks a success criterion; save `<attemptDir>/F2-operator-memory-review.md`.

- [ ] F3. Real manual QA
  Recommended task executor category: unspecified-high
  Use fresh `TMP_AGENT=$(mktemp -d)` and start `SENPI_CODING_AGENT_DIR="$TMP_AGENT" OMO_CODING_AGENT_DIR="$TMP_AGENT" omo --offline --no-session --no-extensions -e "$PWD/extensions/operator-memory/src/index.ts"` in background PTY. Send `/operator-memory status` then `/operator-memory clear` via `bash_input`; capture each `bash_output({ view: "screen" })`. PASS only if status whole output matches Scope's entire seven-line template with valid/unknown dynamic context substitution, clear whole output matches exact rejection, TUI exits 0, no operator process is spawned, and `rm -rf "$TMP_AGENT"; test ! -e "$TMP_AGENT"` succeeds. Save `<attemptDir>/F3-operator-memory-live.txt` and `F3-operator-memory-cleanup.txt`.

- [ ] F4. Scope fidelity
  Recommended task executor category: unspecified-high
  Compare final source behavior and runtime registrations against the approved observer-only scope. Exact invocation: run command-host regression `bun test extensions/operator-memory/test/index.test.ts --test-name-pattern "does not intercept native memory or compaction"`, inspect root package dependencies, and inspect active OMO config without changing it. PASS only if extension remains command-only, provider context cost stays zero, native OMO/Senpi owners stay unchanged, and no global configuration/memory state changed. Save `<attemptDir>/F4-operator-memory-scope.md`.

## Commit strategy

- Commit only after the GREEN and targeted validation named in each todo.
- Use observed Conventional Commit shape: `feat(operator-memory): ...`, then `docs(operator-memory): ...`, then `test(operator-memory): ...`.
- Do not combine feature, docs, runtime compatibility, and ownership-fence changes in one omnibus commit.
- Do not commit ignored `.omo` plans/evidence or unrelated untracked `.omp/`, `.opencode/`, and `openspec/` paths.
- Do not push, tag, publish, or version-bump unless a later explicit user request authorizes it.

## Success criteria

1. `/operator-memory` and `/operator-memory status` emit the exact observer status on supported repository and global runtime surfaces; invalid subcommands emit exact rejection.
2. The extension contributes exactly zero provider-context tokens and has no event registrations, persistent content, helper, background resource, or native memory/compaction interception.
3. Native OMO remains durable-memory owner; native Senpi remains transcript and compaction owner. Tests and live receipts prove this boundary.
4. Standalone package discovery, root development registration, provenance/license documentation, upstream-validation record, and both-runtime compatibility matrix are present and validated.
5. Every TDD RED/GREEN receipt, real-surface command receipt, cleanup receipt, LSP diagnostic, repository gate, atomic commit, and F1-F4 verifier receipt is captured before handoff.
