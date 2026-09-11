# Operational Control Customizations

## Purpose

Own notifications, telemetry, Git metadata, LSP, update behavior, and runtime diagnostics policy.

## Ownership

- OMO configuration owns host controls.
- Extensions own custom operational features.

## Local Contracts

- Prefer configured native controls before extension code.
- Make telemetry, notifications, and attribution visible and opt-outable.
- Keep diagnostics bounded and redact credentials, paths, and session content where needed.

## Work Guidance

- Document default behavior, user scope, persistence, and disable path.
- Do not use monitoring or notification features as hidden control channels.

## Verification

- Verify enabled, disabled, invalid-config, and restart behavior.

## Child DOX Index

No child boundaries.
