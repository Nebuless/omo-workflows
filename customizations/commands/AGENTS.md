# Command Customizations

## Purpose

Own slash commands, shortcuts, and command-line flags.

## Ownership

- Senpi extensions own `registerCommand`, `registerShortcut`, and `registerFlag` behavior.
- OMO command configuration owns host command settings.

## Local Contracts

- One command has one observable action and bounded output.
- Commands that write, alter sessions, or call external systems need explicit approval.
- Guard TUI-only flows against noninteractive modes.

## Work Guidance

- Document arguments, errors, idempotency, and non-TUI behavior before code.

## Verification

- Run help, happy path, and invalid input in terminal.

## Child DOX Index

No child boundaries.
