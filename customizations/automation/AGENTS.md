# Browser, Terminal, and Desktop Automation Customizations

## Purpose

Own browser automation, terminal integration, and experimental native Computer Use.

## Ownership

- User-layer `omo.jsonc` owns sensitive browser launch settings.
- Extensions own custom automation behavior.

## Local Contracts

- Do not let project configuration widen browser environment allowlists or launch arguments.
- Define visible user control, target scope, and safe cancellation.
- Keep terminal pane integration observational unless user requests mutation.
- Computer Use is separate from omowright. Record OS support, native read/input
  permissions, `/computer status`, `computer.enabled`, and the human-only
  stop/resume control before adopting it. Browser permissions do not grant
  native desktop input.

## Work Guidance

- Prefer built-in browser and tmux features before writing an extension.

## Verification

- Run interactive and noninteractive paths; verify disabled configuration leaves no background process.

## Child DOX Index

No child boundaries.
