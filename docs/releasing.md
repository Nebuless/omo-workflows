# Releasing

## Policy

Release history comes from Conventional Commits through Conventional Changelog.
Version `package.json` and Git tags with SemVer; tags use `vX.Y.Z`.

| Commit signal | Recommended bump |
| --- | --- |
| `feat:` | minor |
| `fix:` or `perf:` | patch |
| `!` or `BREAKING CHANGE:` | major |
| `docs:`, `test:`, `build:`, `ci:`, `chore:`, `refactor:` | none by default |

Scopes are optional. Use imperative summaries. Public behavior can override a
non-release type only with explicit release review.

## Release procedure

1. Work from a clean checkout with committed Conventional Commit history.
2. Run `mise ci`.
3. Run `mise run version-recommend`; treat output as a recommendation, not an
automatic release decision.
4. Update `package.json` to approved SemVer version.
5. Run `mise run changelog` and review `CHANGELOG.md`. For first release with
no existing SemVer tag, append `-- --first-release`.
6. Run `mise ci` again, then commit and create `vX.Y.Z` tag only after an
explicit release request.

`mise run changelog` prepends history since last SemVer tag. It needs at least
one committed Conventional Commit. The repository currently has no history or
tags, so do not run release commands until initial commits exist.

## Boundaries

- Commitlint enforces commit syntax at `commit-msg`.
- Conventional Changelog generates history; it does not commit, tag, publish,
or change the package version.
- Agents never create commits, tags, or releases without an explicit user
request.

## References

- <https://github.com/conventional-changelog/conventional-changelog>
- <https://www.conventionalcommits.org/en/v1.0.0/>
- <https://semver.org/>
