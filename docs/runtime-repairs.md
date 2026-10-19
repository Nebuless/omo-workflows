# Runtime Repairs

## Historical OMO comment-checker dependency

`omo-ai@5.0.0-0.beta.53` loads its bundled `omo.js` extension with a runtime
reference to `@code-yeongyu/comment-checker`, but its published manifest does
not declare that dependency. Senpi can then report:

```text
ResolveMessage: Cannot find module '@code-yeongyu/comment-checker'
```

This older package-layout issue is not a supported repair for the current
binary runtime. The retained task unconditionally runs a global package install;
it is not check-only and has no current-runtime version guard. Treat it as
historical documentation only; do not run it against current OMO.

Do not run `mise run repair-omo-comment-checker` on current OMO.

The task runs `bun add --global @code-yeongyu/comment-checker@0.8.0`. Bun's
global package root is an ancestor of `omo-ai`, so Node/Senpi module resolution
could load the checker from that historical extension layout. This does not
prove the repair works with the current packaged binary.

The historical repair adds no repository dependency and does not alter model
credentials, project settings, or OMO package resources.

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

## Historical, version-locked workflow repairs

### Historical 2026.9.10-2 repairs

The repository retains explicit, hash-pinned compatibility hooks for OMO
`5.0.0-0.beta.62` and Senpi `2026.9.10-2`. They are not upstream APIs, are
unsupported for the current binary, and extension loading never applies them.
Each command checks the exact package
version and preimage or postimage SHA-256. Unknown builds fail without mutation.

```sh
mise run repair-omo-dag-ui
mise run repair-senpi-workflow-journal
mise run repair-senpi-workflow-mouse
```

The following `--apply` invocations are historical examples only. Do not run
them on the current binary:

```sh
bun run repair:omo-dag-ui --apply
bun run repair:senpi-workflow-journal --apply
bun run repair:senpi-workflow-mouse --apply
```

The OMO hook delegates native `/dag` TUI presentation to workflow-graph. The
journal hook adds synchronous `SessionManager.flushEntries()`. The mouse hook
lets focused overlays receive SGR clicks before fullscreen Senpi consumes them.
The mouse hook targets `@earendil-works/pi-tui@2026.9.10-2`,
`dist/tui-alt-screen.js`. These three hash-pinned hooks remain check-only unless
`--apply` is passed. Reapplying a known postimage is idempotent. Reinstall the
exact upstream package to remove a hook. This does not apply to the separate
comment-checker task, which unconditionally installs globally.

Historical validation copied the real SessionManager flush, reopen, repeated
append, and in-memory refusal cases. It extracted `/dag` with TUI and foreign-run
fallback cases. Those validations left installed global targets unmodified.

The current extension instead uses public session-header persistence, native
`appendEntry`, and standard-library file `sync()` acknowledgement. No runtime
patch is required or authorized. See the dated current evidence in
[upstream validation](upstream-validation.md#2026-10-16-omo-5134-and-paired-senpi-20261016).
