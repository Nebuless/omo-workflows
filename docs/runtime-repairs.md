# Runtime repairs

Runtime repairs are explicit, local, version-specific workarounds for upstream
OMO or Senpi defects. They are not portable extension behavior and never run as
part of installation or `mise ci`.

## Before repairing

1. Confirm pinned runtime version in `package.json` and `bun.lock`.
2. Read current upstream source and issue record.
3. Run repair command without `--apply`.
4. Inspect reported package, version, and preimage hash.
5. Ask before `--apply`; repair changes global installed runtime files.

## Available check

```sh
mise run repair-omo-comment-checker
```

This command checks installed runtime state without mutation. Add `--apply` only
when its preimage and target version match reported defect.
