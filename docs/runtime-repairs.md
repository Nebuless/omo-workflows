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
