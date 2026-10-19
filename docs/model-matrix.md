# Model Matrix

Catalog reviewed 2026-10-16 against OMO 5.1.34 and its bundled Senpi
2026.10.16 runtime. `omo --list-models 9router` exposed these three permitted
CX model IDs. Catalog visibility does not establish authentication, live task
resolution, pricing, context size, or benchmark performance.

## Verified catalog

| Canonical route ID | Catalog visibility | Price, context, benchmarks |
|---|---|---|
| `9router/cx/gpt-6.1-sol` | Listed | Unknown; not verified |
| `9router/cx/gpt-6-luna` | Listed | Unknown; not verified |
| `9router/cx/gpt-6-astra` | Listed | Unknown; not verified |

No current cost or independent benchmark evidence was verified for these
catalog entries. Historical September 2026 prices, benchmark claims, and
unavailable model routes are omitted rather than carried forward as current.

## Portable routing profiles

`templates/omo.jsonc.balanced` is Luna-first for lighter work. Sol covers
general and visual work; Astra handles hardest reasoning. Its `deep-low`,
`deep-high`, and `architect` categories use Luna or Astra accordingly.

`templates/omo.jsonc.gpt-heavy` is Sol-first for general implementation. Luna
covers quick, low-effort, and memory work; Astra handles hardest reasoning.
Both profiles set Sol reasoning no higher than `high`, retain shared
`memory-reflection` selection for reflection and recall, and contain no
unavailable fallback IDs.

These files are portable configuration choices, not statements about the
active global configuration on any host. Choose and copy a profile explicitly;
verify the catalog with `omo --list-models 9router` first.

## Schema and behavior evidence

The immutable OMO release source at
[category.ts](https://github.com/code-yeongyu/oh-my-openagent/blob/d7e224e478a4a77dba0d2104c336fdc72ad301e3/packages/omo-config-core/src/schema/category.ts)
defines categories as a record of strict category objects with ordered `models`
and `reasoning` fields. The installed release catalog output supplies the model
availability evidence; it does not prove credential validity or runtime task
completion.
