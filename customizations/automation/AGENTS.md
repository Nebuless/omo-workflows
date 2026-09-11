# Browser and Terminal Automation Customizations

## Purpose

Own OMO browser automation, tmux integration, and terminal-facing automation policy.

## Ownership

- User-layer `omo.jsonc` owns sensitive browser launch settings.
- Extensions own custom automation behavior.

## Local Contracts

- Do not let project configuration widen browser environment allowlists or launch arguments.
- Define visible user control, target scope, and safe cancellation.
- Keep terminal pane integration observational unless user requests mutation.

## Work Guidance

- Prefer built-in browser and tmux features before writing an extension.

## Verification

- Run interactive and noninteractive paths; verify disabled configuration leaves no background process.

## Child DOX Index

No child boundaries.
