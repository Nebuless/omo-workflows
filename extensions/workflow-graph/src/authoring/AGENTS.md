# Workflow Program Authoring

## Purpose

Expose staged programs through native Senpi tools and commands.

## Ownership

- discovery.ts owns reloadable six-source program catalog: configured project, project-local, configured global, user-global, installed package, then bundled.
- host.ts owns one session-local launch, unique run keys, restore, event-driven advancement, and closed open-claude-design live-review effect lifecycle.
- index.ts registers workflow_program and /workflow-run; extension root owns lifecycle and shared graph store.

## Local Contracts

- Explicit starts get unique instance keys. Restart restores recorded instance instead of duplicating tasks.
- Reserve ownership before awaited imports or journal writes. Session boundaries fence pending work.
- Import project modules only when project trust is active. Project, user, and installed package resources remain within their owning realpath roots; reject escaping symlinks and invalid exports.
- Catalog reload replaces whole catalog only after every source completes. Duplicate keys keep first source; configured names remain source metadata, never key overrides. Re-read native settings on every reload. Session generations fence pending discovery and UI prompts; publish only a complete current catalog. Builtin factories seed automatic restore before discovery and receive the original per-launch artifact root.
- Native settings use extension-owned `workflowGraph.programs`: project settings accept `project` and `package`; global settings accept `global` and `package`. Each field accepts string paths or configured-name-to-path maps. Relative paths resolve from cwd for project settings and agentDir for global settings. Package entries combine project before global explicit paths, then native configured installed packages from `DefaultPackageManager.listConfiguredPackages()` with `pi.workflows` string arrays or named maps. Senpi does not discover workflows as a native resource kind; this extension reads that manifest field without installing, enabling, or updating packages. Untrusted project package entries never import.
- Automatic restore never imports arbitrary authored code; authored resume requires the exact recorded catalog key or module path.
- Accept exact JSON without splitting quoted whitespace. Tool and command errors stay visible.
- Design-review helper events enter deterministic external checkpoint state before same-run native model amendment; helper exit, not human assertion, unlocks export. Gates without `fallback` require explicit choice. Fallback gates use selected listed choice; unavailable, rejected, or dismissed selection resolves exact listed fallback. `answerModes` records `interactive_select` versus `deterministic` even when values match. Cancellation requires confirmation. Settled native waves do not imply program completion.
- Artifacts belong under .omo/workflow-artifacts/<instance>; native session entries remain sole coordinator state store.

## Work Guidance

- Subscribe to shared native graph before starting. Detach on switch, fork, and shutdown without implicit cancellation.
- Only decision kinds reach graph metadata; never persist prompts or gate bodies in Herdr snapshots.
- Bootstrap live review from the canonical preview directory after admitted product/design/config prerequisites. Missing immutable helper installation rejects; never fetch it during a launch.

## Verification

- `bun test extensions/workflow-graph/test/authoring-host.test.ts extensions/workflow-graph/test/authoring-discovery.test.ts extensions/workflow-graph/test/authoring-catalog.test.ts extensions/workflow-graph/test/authoring-catalog-entry.test.ts test/extension-load.test.ts`
- `bun run typecheck`

## Child DOX Index

None.
