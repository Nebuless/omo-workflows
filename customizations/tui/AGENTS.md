# Terminal UI Customizations

## Purpose

Own interactive prompts, status surfaces, terminal components, tool rendering,
and native JSON theme resources.

## Ownership

- Senpi extension packages own runtime UI.
- `pi.themes` and native theme discovery own packaged JSON themes.
- This directory owns interaction design notes.

## Local Contracts

- Guard terminal components with `ctx.mode === "tui"`. `ctx.hasUI` also
  includes RPC dialog support and is not a terminal guard.
- Preserve keyboard navigation, cancellation, resize behavior, and readable error states.
- Provide a noninteractive fallback or mark command unavailable.

## Work Guidance

- Design narrow dialog flows before custom components.
- Avoid custom TUI when native command output meets user need.

## Verification

- Manually use happy path, cancel path, resize, and noninteractive path.

## Child DOX Index

No child boundaries.
