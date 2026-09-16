# OMO Workflows DOX

## Purpose

Keep portable OMO/Senpi customizations, release policy, and agent guidance
accurate across this repository.

## Ownership

- Root owns repository-wide toolchain, quality, release, and DOX policy.
- Child `AGENTS.md` files own local contracts without weakening root policy.

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done. Update
DOX in the same change; never leave an ownership, workflow, or Child DOX Index
update for later.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:
- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md.

## Model Routing Preference

For OMO routing on this workstation, `templates/omo.jsonc.gpt-heavy` is the
global default: installed `9router/cx/*` models lead every route; targeted
`9router/ollama-cloud/*` models provide fallbacks. Keep
`templates/omo.jsonc.balanced` as cost/capability alternative. Record model
availability, cost, benchmark evidence, and routing rationale in
`docs/model-matrix.md` and active policy in `docs/model-routing.md`; never
commit credentials or endpoint secrets.

## Repository Hygiene Policy

- Treat `.gitignore` as a tracked repository contract, not a one-time setup file.
- When a change creates generated output, caches, sessions, credentials, local
  tooling state, or editor files, update `.gitignore` in that same change.
- Keep portable source, docs, lockfiles, project settings, and `AGENTS.md`
  files tracked through narrow negate rules; never ignore a whole durable
  directory to hide generated state.
- Verify new ignore rules with `git check-ignore -v` before closeout. Remove
  stale patterns when their output no longer exists.

## Versioning and Release Policy

- Write every repository commit as a Conventional Commit. `commit-msg` runs
  Commitlint with the conventional preset.
- Version `package.json` and tags with SemVer. `feat` recommends minor, `fix`
  and `perf` recommend patch, and `!` or `BREAKING CHANGE` recommends major.
- `docs`, `test`, `build`, `ci`, `chore`, and `refactor` changes do not cause a
  release unless they alter public behavior.
- Use `bun run version:recommend` before choosing a release version, then run
  `bun run changelog` after updating `package.json`.
- `CHANGELOG.md` is generated release history. Do not hand-edit generated
  release blocks.
- Creating commits, version tags, or publishing remains an explicit user
  request. This policy never automates those actions.

## Project Contract

- This repository is the portable source of truth for OMO/Senpi customizations.
- `README.md` owns concise native-OMO install, LLM-handoff, local-extension install, and documentation routing. It links full upstream and repository documentation instead of duplicating it.
- `mise.toml` owns the repository toolchain and task runner. `mise ci` is the
  local CI entrypoint.
- Bun owns JavaScript package installation; mise owns tools and tasks.
- `prek` owns Git `commit-msg`, `pre-commit`, and `pre-push` shims.
- Qlty and Biome are required quality checks.
- Conventional Changelog and Conventional Commits own release history and
  version recommendations; `docs/releasing.md` owns release procedure.
- Worktrees are managed only through Worktrunk (`wt`). Do not use raw
  `git worktree` commands.
- OMO compatibility targets the exact Senpi version pinned in `package.json`.

## User-Reported OMO Issues

When a user reports an OMO or Senpi problem, log it in
[`docs/issues.md`](docs/issues.md) in the same change. Include UTC timestamp,
observed symptom, affected local version or runtime, current resolution, and a
relevant upstream issue, pull request, or source URL. If upstream has no match,
state that clearly and document the local workaround as invented.

## Upstream Validation Contract

Before changing customization behavior, verify the installed pinned runtime and
its owning upstream source. Fetch current upstream evidence; do not rely on
memory or stale documentation.

- OMO wrapper, configuration, rules, and bundled extensions:
  `https://github.com/code-yeongyu/oh-my-openagent`
- Senpi runtime, prompt assembly, presets, and extension lifecycle:
  `https://github.com/code-yeongyu/senpi`

A boundary-crossing customization must verify both sources. A single-layer
change verifies its owner and records why the other source did not apply.
Every version-sensitive customization must follow
[`docs/upstream-validation.md`](docs/upstream-validation.md): timestamp,
local runtime versions, exact upstream evidence, local proof, and revalidation
trigger.

## Child DOX Index

- `.config/` — shared Worktrunk project configuration.
- `.omo/` — project-local OMO package settings; runtime task state remains
  ignored.
- `.qlty/` — committed Qlty configuration.
- `templates/` — portable OMO preference templates plus complete balanced and GPT-heavy `9router` routing profiles.
- `README.md` — concise native OMO, LLM handoff, and extension installation entrypoint; routes to complete local and upstream documentation.
- `customizations/` — policy-only scaffolds for OMO and Senpi capability domains; runnable behavior belongs in `extensions/`. Read [`customizations/AGENTS.md`](customizations/AGENTS.md) and [`docs/customization-scaffolding.md`](docs/customization-scaffolding.md) before creating a new customization.
- `docs/` — durable compatibility, packaging, release, repair, routing, LSP, extension-authoring, customization, upstream-validation, and user-reported issue guidance. `docs/issues.md` is timestamped register for OMO/Senpi user reports and upstream references. `docs/model-matrix.md` owns model pricing, benchmark evidence, and profile mappings; `docs/model-routing.md` owns active routing policy. Read [`docs/customizations.md`](docs/customizations.md) before choosing a customization boundary; read [`docs/customization-scaffolding.md`](docs/customization-scaffolding.md) for the upstream-backed capability map and creation rules; read [`docs/upstream-validation.md`](docs/upstream-validation.md) before relying on OMO or Senpi runtime behavior; read [`docs/authoring-extensions.md`](docs/authoring-extensions.md) before adding or restructuring an extension.
- `extensions/` — extension package ownership boundary.
- `extensions/compound-engineering/` — native OMO/Senpi package for Every's pinned Compound Engineering skill collection.
- `extensions/better-custom/` — native Senpi port of upstream provider/model
  customization.
- `extensions/better-custom/src/` — runtime implementation guidance.
- `extensions/better-custom/test/` — provider/model extension regression guidance.
- `extensions/herdr/` — standalone OMO lifecycle integration, skills, and safe CLI tools for Herdr.
- `extensions/trim/` — native compaction governor with package-local tests.
- `scripts/` — validation and portable runtime-repair scripts.
- `test/` — shared OMO/Senpi extension regression coverage.

Extension docs own host adaptation, upstream attribution, runtime assumptions,
and focused tests. Runtime repairs remain explicit user-invoked tasks.

## Verification

- `mise ci` validates source, package, tests, build, quality, and hook config.
- `mise run version-recommend` and `mise run changelog` require committed
  Conventional Commit history; do not run them as a substitute for `mise ci`.
- Before closeout, reconcile touched paths with this file and child contracts.
  State why any otherwise-applicable `AGENTS.md` stayed unchanged.
