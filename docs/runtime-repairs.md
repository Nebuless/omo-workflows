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

### Historical 2026.9.10-2 repairs

The repository retains explicit, hash-pinned compatibility hooks for OMO
`5.0.0-0.beta.62` and Senpi `2026.9.10-2`. They are not upstream APIs, and
extension loading never applies them. Each command checks the exact package
version and preimage or postimage SHA-256. Unknown builds fail without mutation.

```sh
mise run repair-omo-dag-ui
mise run repair-senpi-workflow-journal
mise run repair-senpi-workflow-mouse
```

Use `--apply` only on that historical runtime:

```sh
bun run repair:omo-dag-ui --apply
bun run repair:senpi-workflow-journal --apply
bun run repair:senpi-workflow-mouse --apply
```

The OMO hook delegates native `/dag` TUI presentation to workflow-graph. The
journal hook adds synchronous `SessionManager.flushEntries()`. The mouse hook
lets focused overlays receive SGR clicks before fullscreen Senpi consumes them.
The mouse hook targets `@earendil-works/pi-tui@2026.9.10-2`,
`dist/tui-alt-screen.js`. These hooks remain check-only unless `--apply` is
passed. Reapplying a known postimage is idempotent. Reinstall the exact upstream
package to remove a hook.

Historical validation copied the real SessionManager flush, reopen, repeated
append, and in-memory refusal cases. It extracted `/dag` with TUI and foreign-run
fallback cases. Those validations left installed global targets unmodified.

### Current authorized 2026.9.13 journal repair

Current installed Senpi is `2026.9.13`. Authorized local repair
`durable-journal-v1` changes runtime behavior only through installed
`SessionManager`. It adds async `flushEntries(): Promise<void>`, exposes that
acknowledgment through the readonly extension facade, and makes the native
staged journal await it. The receipt records changes to `dist/core/session-manager.js`,
`session-manager.d.ts`, both source maps, and `docs/extensions.md`.

This is a local runtime repair, not an extension-load action or an OMO DAG
repair. It does not authorize the historical `2026.9.10-2` DAG or mouse hooks
for Senpi `2026.9.13`. The receipt records upstream revision
`0fb7705500641a43de915e72debdabfdcb00e665` and confirms installed files match
receipt and build. Its upstream static check remains an environment failure,
`TS2307: Cannot find module 'vitest' or its corresponding type declarations.`

Source and revalidation: [native staged workflow record](upstream-validation.md#native-staged-workflow-runtime-hooks).
