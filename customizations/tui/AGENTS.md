# Terminal UI Customizations

## Purpose

Own interactive prompts, status surfaces, custom components, and rendered tool output.

## Ownership

- Senpi extension packages own runtime UI.
- This directory owns interaction design notes.

## Local Contracts

- Guard terminal-only APIs with `ctx.mode === "tui"` or `ctx.hasUI`.
- Preserve keyboard navigation, cancellation, resize behavior, and readable error states.
- Provide a noninteractive fallback or mark command unavailable.

## Work Guidance

- Design narrow dialog flows before custom components.
- Avoid custom TUI when native command output meets user need.

## Verification

- Manually use happy path, cancel path, resize, and noninteractive path.

## Child DOX Index

No child boundaries.
