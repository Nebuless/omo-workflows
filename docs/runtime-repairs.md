# Runtime Repairs and Preferences

## Native workflows

OMO owns workflow scheduling and graph presentation. The repository's duplicate
workflow extension and its DAG, journal, and mouse repair scripts are removed.
Do not apply historical runtime patches to current OMO.

## Historical comment-checker dependency

The retained `repair-omo-comment-checker` task unconditionally installs
`@code-yeongyu/comment-checker@0.8.0` globally for the old OMO beta package layout.
It is not check-only, has no current-runtime guard, and is unsupported for OMO
`5.1.34`. Do not run it on current OMO.

## Disable OMO tips

Senpi owns startup and working tips through global OMO settings at
`~/.omo/agent/settings.json`. The portable preference template is
`templates/omo-agent-settings.json`:

```json
{
  "tips": false
}
```

Merge the preference without replacing unrelated settings:

```sh
mise run configure-omo-preferences
```

The task is idempotent and preserves unrelated settings. Restart OMO after it
finishes.

If an older `~/.omo/omo.jsonc` contains a top-level `codegraph` key or one inside
`[opencode]`, remove those obsolete entries manually. The preference bootstrap
does not rewrite routing files or remove their comments.

## Sources

- <https://www.npmjs.com/package/omo-ai>
- <https://www.npmjs.com/package/@code-yeongyu/comment-checker>
