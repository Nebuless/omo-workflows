# Profile and Model Routing Customizations

## Purpose

Own config-layer profiles, model catalogs, and Senpi main-session model profiles.

## Ownership

- `.omo/omo.jsonc` owns runtime values.
- This directory owns routing design notes.

## Local Contracts

- Keep `profiles.<name>` separate from `model_profiles`; first changes config layer, second selects session model.
- Native resolves shared keys, `[native]`, the active profile, then its
  `[native]` block. Task-category chains are separate from main-session profiles.
- Prefer catalog aliases for repeated model and reasoning pairs.
- Do not place credentials or endpoints in portable profiles.

## Work Guidance

- Define fallback chains only after validating each live provider.
- Document data-handling changes when a fallback crosses providers.

## Verification

- Start a fresh Senpi session with each profile and confirm resolved model.

## Child DOX Index

No child boundaries.
