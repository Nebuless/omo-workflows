# Repository Documentation

## Purpose

Keep durable compatibility, packaging, and workflow decisions for the OMO
customization repository.

## Ownership

- `compatibility.md` owns the OMO/Senpi runtime boundary and upstream import
  provenance.
- `releasing.md` owns Conventional Commit, SemVer, and changelog procedure.
- `runtime-repairs.md` owns supported OMO runtime repair procedures.
- `model-routing.md` owns non-secret local model-routing policy.
- `lsp.md` owns repository language-server tooling and OMO configuration.

## Local Contracts

- Record exact versions and immutable upstream revisions.
- Cite external contracts with stable URLs.
- Describe verified behavior, not planned behavior.
- Keep release procedure aligned with `package.json`, `mise.toml`, `prek.toml`,
  and root `AGENTS.md` in the same change.

## Verification

Documentation claims must agree with `mise ci`, the package manifest, the
installed OMO/Senpi runtime, and release-tool command behavior.

## Child DOX Index

No child `AGENTS.md` boundaries exist.

- `releasing.md` — release and versioning procedure.
- `runtime-repairs.md` — portable runtime repair procedures.
- `model-routing.md` — installed-model routing policy.
- `lsp.md` — mise-managed language-server setup and verification.
