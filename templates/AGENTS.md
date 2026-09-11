# OMO Workflow Templates

## Purpose

Store portable, merge-safe OMO configuration templates.

## Ownership

- `omo-agent-settings.json` owns global Senpi preferences applied by the OMO bootstrap script.

## Local Contracts

- Templates contain only user preferences, never credentials, endpoints, model catalogs, or machine paths.
- `omo-agent-settings.json` keeps native Senpi startup and working tips disabled.

## Work Guidance

- Keep each template minimal and additive.
- Update the matching bootstrap script, tests, README instructions, and parent Child DOX Index when changing a template contract.

## Verification

- `bun test test/omo-preferences.test.ts` validates the OMO preferences bootstrap.

## Child DOX Index
