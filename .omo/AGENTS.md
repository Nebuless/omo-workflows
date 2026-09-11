# OMO Project Settings

## Purpose

Own checked-in OMO package installation settings for this repository.

## Ownership

- `settings.json` owns project-local package registration only.

## Local Contracts

- Keep this directory limited to portable project settings.
- Never commit OMO sessions, task state, credentials, caches, or generated runtime data.

## Work Guidance

- Verify changes through `omo install -l . --approve` and `omo list --approve`.

## Verification

- `omo list --approve`

## Child DOX Index

No child documentation boundaries exist.
