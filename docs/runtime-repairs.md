# Runtime Repairs

## OMO comment-checker dependency

`omo-ai@5.0.0-0.beta.53` loads its bundled `omo.js` extension with a runtime
reference to `@code-yeongyu/comment-checker`, but its published manifest does
not declare that dependency. Senpi can then report:

```text
ResolveMessage: Cannot find module '@code-yeongyu/comment-checker'
```

Repair current machine and future portable installs with:

```sh
mise run repair-omo-comment-checker
```

The task runs `bun add --global @code-yeongyu/comment-checker@0.8.0`. Bun's
global package root is an ancestor of `omo-ai`, so Node/Senpi module resolution
can load the checker from the extension's location. Restart OMO after repair.

The repair adds no repository dependency and does not alter model credentials,
project settings, or OMO package resources. Re-run it after reinstalling OMO
until upstream declares the dependency.

## Verification

```sh
mise run repair-omo-comment-checker
```

The task prints OMO's resolved checker binary path. It fails if OMO cannot
resolve the module from its own extension directory.

## Disable OMO tips

Senpi owns both startup and working `Tip:` widgets through its global OMO
settings at `~/.omo/agent/settings.json`. This repository keeps the portable
preference template at `templates/omo-agent-settings.json`:

```json
{
  "tips": false
}
```

After cloning, merge that preference without replacing other settings:

```sh
mise run configure-omo-preferences
```

The task is idempotent. It preserves unrelated settings such as theme, default
model, and credentials. Restart OMO after it finishes.

If an older `~/.omo/omo.jsonc` contains a top-level `codegraph` key or one
inside `[opencode]`, remove those entries manually. OMO removed CodeGraph
integration; leaving either entry causes:

```text
omo-senpi: configuration diagnostics: Ignored unknown keys in ~/.omo/omo.jsonc: codegraph
```

The bootstrap intentionally does not rewrite `omo.jsonc`, so it never strips a
user's comments, profiles, or model-routing choices.

## Source

- <https://www.npmjs.com/package/omo-ai>
- <https://www.npmjs.com/package/@code-yeongyu/comment-checker>

## Optional staged workflow runtime hooks

These explicit local repairs target OMO `5.0.0-0.beta.53` and Senpi
`2026.9.10-2`. They are invented compatibility hooks, not upstream APIs.
Extension loading never applies them. All commands check exact package version
and preimage/postimage SHA-256; unknown builds fail without mutation.

Check installed targets:

```sh
mise run repair-omo-dag-ui
mise run repair-senpi-workflow-journal
mise run repair-senpi-workflow-mouse
```

Apply only when intentionally enabling the hooks, then restart OMO:

```sh
bun run repair:omo-dag-ui --apply
bun run repair:senpi-workflow-journal --apply
bun run repair:senpi-workflow-mouse --apply
```

The OMO repair lets native `/dag` delegate TUI presentation to the owning
workflow-graph extension. Non-TUI, foreign runs, absent hooks, and hook failures
retain native behavior. It never changes scheduling.

The Senpi repair adds synchronous `SessionManager.flushEntries()`. Staged launch
intents and admitted outputs use native custom entries and require acknowledged
disk flush before downstream dispatch. In-memory sessions and missing capability
cannot launch staged programs. No second checkpoint store is created.

Fullscreen Senpi consumes SGR clicks before focused overlays receive them. The
mouse repair makes clicks defer to focused overlays, matching existing wheel
behavior; unfocused native text selection and viewport scrolling remain native.
It targets `@earendil-works/pi-tui@2026.9.10-2`, `dist/tui-alt-screen.js`.

For disposable validation, DAG repair accepts `--path` and `--package-path`;
journal and mouse repairs accept `--package-root`. Reapplying recognized postimages is
idempotent. Reinstall the exact upstream package to remove a hook; do not apply
these patches to an upgraded runtime.

Verified locally: extracted installed `/dag` command with TUI/foreign-run
fallback tests; copied real SessionManager flush, reopen, repeated append,
and in-memory refusal tests; imported staged controller preserving completed
task IDs across same-run native amendment and native journal reopen. Installed
global targets remained unmodified during these tests.

Source and revalidation: [native staged workflow record](upstream-validation.md#native-staged-workflow-runtime-hooks).
