# Workflow Program Authoring

## Purpose

Expose staged programs through native Senpi tools and commands.

## Ownership

- discovery.ts owns reloadable six-source program catalog: configured project, project-local, configured global, user-global, installed package, then bundled.
- host.ts owns one session-local launch, unique run keys, restore, event-driven advancement, and closed open-claude-design live-review effect lifecycle.
- index.ts registers workflow_program and /workflow-run; extension root owns lifecycle and shared graph store.

## Local Contracts

- Explicit starts get unique instance keys and exact opaque `{key, revision, digest}` selection identity. Restart restores recorded instance instead of duplicating tasks. Identity drift rejects with `Workflow catalog changed; choose again.` before native start.
- Reserve ownership before awaited imports or journal writes. Session boundaries fence pending work.
- Import project modules only when project trust is active. Project, user, and installed package resources remain within their owning realpath roots; reject escaping symlinks and invalid exports.
- Catalog reload keeps one catalog object and publishes a whole snapshot only after every source completes. Publication revisions increase even when entry digests match; reloaded helper code cannot reuse an old selection. Duplicate keys keep first source; configured names remain source metadata, never key overrides. Re-read native settings on every reload. Session generations fence pending discovery and UI prompts; publish only a complete current catalog. Builtin factories seed automatic restore before discovery and receive the original per-launch artifact root. Seed revision 0 may restore an unchanged builtin by exact digest/version; published revisions remain strict.
- Native settings use extension-owned `workflowGraph.programs`: project settings accept `project` and `package`; global settings accept `global` and `package`. Each field accepts string paths or configured-name-to-path maps. Relative paths resolve from cwd for project settings and agentDir for global settings. Package entries combine project before global explicit paths, then native configured installed packages from `DefaultPackageManager.listConfiguredPackages()` with `pi.workflows` string arrays or named maps. Senpi does not discover workflows as a native resource kind; this extension reads that manifest field without installing, enabling, or updating packages. Untrusted project package entries never import.
- Automatic restore never imports arbitrary authored code; authored resume requires the exact recorded catalog key or legacy identity-free module path. A recorded descriptor requires a current resolvable program and identity even for explicit resume; missing catalog authority never falls back to importing a path.
- Accept exact JSON without splitting quoted whitespace. Direct `/workflow-run <key> <JSON>` obtains fresh descriptor identity atomically; `workflow_program start` never accepts key-only model launch. Selection-consuming start, transfer, recommend, and resume use the published context snapshot without republishing their own selection stale. List/reload and fresh command selection explicitly publish; context/trust/session changes require discovery again. Tool and command errors stay visible.
- Design-review helper events enter deterministic external checkpoint state before same-run native model amendment; helper exit, not human assertion, unlocks export. Gates without `fallback` require explicit choice. Fallback gates use selected listed choice; unavailable, rejected, or dismissed selection resolves exact listed fallback. `answerModes` records `interactive_select` versus `deterministic` even when values match. Cancellation requires confirmation and still targets an already-owned native run when catalog identity changes or disappears. Settled native waves do not imply program completion.
- `workflow_recommend` accepts only one fresh catalog revision and one to five unique key/digest proposals. It is advisory, session-local, and cannot dispatch, amend, cancel, answer, or replace prompt.
- Terminal transfer tool requests need explicit `confirmed:true`; `/workflow-run transfer` obtains native UI confirmation. Both require current destination identity and trusted source `transferArtifacts` declarations. Transfer accepts only current or restored completed staged source, verifies source run/key/fingerprint and copied regular-file bytes, journals intent, then starts one distinct destination run. Recheck authoritative native completion, node states, run ID, key, and fingerprint after intent acknowledgement and at initial/recovered dispatch after filesystem and journal awaits; journal authority alone is insufficient. Source stays unchanged. It is not continuation or arbitrary historical/cross-session lookup.
- Artifacts belong under .omo/workflow-artifacts/<instance>; native session entries remain sole coordinator state store. Linux descriptor-relative transfer copying narrows same-UID path races, but arbitrary concurrent replacement cannot receive atomic compare-and-unlink protection.

## Work Guidance

- Subscribe to shared native graph before starting. Detach on switch, fork, and shutdown without implicit cancellation.
- Only decision kinds reach graph metadata; never persist prompts or gate bodies in Herdr snapshots.
- Bootstrap live review from the canonical preview directory after admitted product/design/config prerequisites. Missing immutable helper installation rejects; never fetch it during a launch.

## Verification

- `bun test extensions/workflow-graph/test/authoring-host.test.ts extensions/workflow-graph/test/authoring-discovery.test.ts extensions/workflow-graph/test/authoring-catalog.test.ts extensions/workflow-graph/test/authoring-catalog-entry.test.ts test/extension-load.test.ts`
- `bun run typecheck`

## Child DOX Index

None.
