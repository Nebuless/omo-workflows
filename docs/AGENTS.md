# Repository Documentation

## Purpose

Keep durable compatibility, packaging, and workflow decisions for the OMO
customization repository.

## Ownership

- `compatibility.md` owns the OMO/Senpi runtime boundary and upstream import
  provenance.
- `releasing.md` owns Conventional Commit, SemVer, and changelog procedure.
- `runtime-repairs.md` owns supported OMO runtime repair and user-preference procedures.
- `model-routing.md` owns non-secret local model-routing policy.
- `omo-subagents.md` owns end-to-end OMO/Senpi subagent setup, routing, extension-provider boundaries, validation, and failure diagnosis.
- `model-matrix.md` owns sourced model price, capability, benchmark evidence, and portable profile mappings.
- `lsp.md` owns repository language-server tooling and OMO configuration.
- `authoring-extensions.md` owns modular individually installable extension packaging guidance.
- `customizations.md` owns the customization catalog, global OMO instruction guidance, Compound Engineering routing, and detail-doc routing.
- `customization-scaffolding.md` owns upstream-backed capability mapping and policy-scaffold creation guidance.
- `upstream-validation.md` owns authority sources, timestamped runtime-evidence records, and revalidation triggers.

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
- `runtime-repairs.md` — portable runtime repair, OMO preference, and obsolete-config cleanup procedures.
- `model-routing.md` — installed-model routing policy.
- `omo-subagents.md` — OMO/Senpi subagent setup, routing, validation, provider extensions, and troubleshooting.
- `model-matrix.md` — model evidence and balanced/GPT-heavy routing profiles.
- `lsp.md` — mise-managed language-server setup and verification.
- `authoring-extensions.md` — modular extension layout, package manifest, tool, skill, and verification guidance.
- `customizations.md` — customization catalog and global OMO instruction setup.
- `customization-scaffolding.md` — capability map, policy scaffolds, and upstream-backed creation rules.
- `upstream-validation.md` — OMO/Senpi authority registry and version-sensitive evidence format.
