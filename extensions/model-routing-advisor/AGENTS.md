# Model Routing Advisor Extension

## Purpose

Provide explicit, read-only, bounded route-availability evidence before native OMO/Senpi work begins.

## Ownership

- `src/types.ts` owns public request, observation, and report contracts.
- `src/advice.ts` owns pure input parsing and conservative report evaluation.
- `src/runtime.ts` owns public model-registry observation only.
- `src/tool.ts` owns read-only Senpi tool registration.
- `index.ts` owns thin extension registration.
- `test/` owns deterministic behavior coverage.
- `README.md` owns operator usage and workflow preflight guidance.

## Local Contracts

- Accept caller-normalized candidates only. Never read OMO config or private runtime modules.
- Never select a model, start, alter, retry, or cancel a task, mutate configuration, write state, poll, or persist reports.
- Treat catalog visibility as insufficient for credential readiness or dispatch success.
- Return `all_candidates_known_unusable` only from fresh, complete observation for every candidate provider.
- Preserve candidate order and report provider boundaries without authorizing provider crossing.
- Do not import `extensions/herdr`; Herdr may present a caller-held serializable report reference only when its own environment gate is active.
- Tool schemas use strict TypeBox objects with `additionalProperties: false`.

## Work Guidance

- Keep evaluator pure and inject observation through the public runtime adapter.
- Use deterministic timestamps and opaque caller-supplied IDs in tests.
- Bound inputs and reports; invalid data returns typed `input_invalid` with no echoed secret values.

## Verification

- `bun test extensions/model-routing-advisor/test`
- `bun run typecheck`
- `bun run build`
- Safe and malformed live OMO tool calls in a disposable session.

## Child DOX Index

- `src/` - runtime implementation.
- `test/` - focused regressions.
