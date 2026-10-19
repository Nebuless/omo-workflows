# Intent

## Why

OMO routes work through ordered model preferences, but installed provider catalogs and runtime availability change independently of those preferences. An operator can see an unavailable candidate only after a task fails, and no supported public OMO extension API exposes an effective merged route or universal admission hook. Existing `extensions/herdr` safely projects lifecycle state into a Herdr pane, but it must remain opt-in and cannot become global routing authority.

## Desired Outcome

An installed `model-routing-advisor` extension can be called explicitly before delegated work. Given a caller-normalized ordered candidate chain and non-secret route provenance, it returns a bounded, versioned report of fresh provider/model observations. The report distinguishes usable observed candidates from unknown, stale, incomplete, and known-unusable cases without selecting a model, changing configuration, or starting work.

The same report can be attached as evidence to direct task, workpool, team, mass/DAG, and ULW preflight steps. Herdr-managed sessions may reference the report through their existing presentation/control boundary, while sessions without `HERDR_ENV=1` retain unchanged behavior.

## Scope Boundaries

**In scope:**

- A standalone, optional `extensions/model-routing-advisor` package with a read-only advice tool.
- Validation of bounded, caller-supplied canonical provider/model candidate chains and non-secret provenance.
- Provider-agnostic, freshness-aware availability reports that distinguish catalog visibility, credential evidence when publicly observable, runtime evidence, incomplete coverage, and unknown state.
- Explicit report of provider-boundary transitions in an ordered candidate chain.
- Workflow-preflight guidance and evidence references for native direct task, task batch/workpool, team, mass/DAG, and ULW workflows.
- Tests proving report behavior and no mutation of native routing, task lifecycle, or configuration.

**Out of scope:**

- Resolving or parsing effective merged `omo.jsonc` routes, including private OMO internals.
- Selecting, dispatching, retrying, or silently falling back to any model.
- Auto-crossing providers, ranking replacement models, or persisting route repair.
- Scheduling, task/workflow interception, daemon processes, polling timers, sockets, filesystem mailboxes, or a second task store.
- Credentials, endpoint URLs, raw provider responses, task prompts/content, or model output in inputs, reports, or persistent state.
- Changing Herdr activation, lifecycle reporting, inspect/control policy, or native OMO/Senpi workflow ownership.

## Approaches Considered

1. **Embed model routing in `extensions/herdr`.** This would make functionality available only under `HERDR_ENV=1` and couple ordinary OMO routes to a pane integration. It conflicts with Herdr's current lifecycle/control boundary.
2. **Build an automatic router or universal task hook.** This would promise admission control across native task, workpool, team, mass/DAG, and ULW paths without a proven public seam. It would also duplicate native OMO/Senpi ownership of model choice and scheduling.
3. **Add a standalone, explicit read-only adviser.** It works with any installed provider, produces evidence before a workflow begins, and leaves selection and execution native. It can be referenced from Herdr without runtime coupling.

## Decision Record

Choose approach 3.

- Create `extensions/model-routing-advisor` as an optional package. It receives caller-normalized candidates because current public APIs do not provide a safe effective-route resolver.
- Treat availability as a per-provider runtime snapshot, not static profile truth. A negative conclusion is valid only when every referenced provider has fresh, complete coverage.
- Make `RouteAdviceReport` JSON-safe and versioned. Cross-package collaboration uses the report reference/value, not imports or shared mutable state.
- Preserve native OMO/Senpi authority for config merge, candidate order, model choice, provider crossing, admission, retries, cancellation, scheduling, and completion.
- Preserve existing `extensions/herdr` behavior. In a Herdr-managed session (`HERDR_ENV=1` and `HERDR_PANE_ID`), a caller may display or attach an already-produced report reference through existing safe surfaces; the adviser itself does not require Herdr.

## Capabilities

### New Capabilities

- `model-routing-advice`: Produces bounded, provider-agnostic, read-only availability advice for caller-supplied route candidates and workflow preflight evidence.

### Modified Capabilities

- None.

## Non-goals

This change does not repair templates or configuration automatically. It reports drift and uncertainty so an operator can make explicit, separately validated routing changes.

## Success Signals

- A valid candidate chain produces a versioned report with a conservative status and no task/config/model mutation.
- Stale, partial, missing-credential, malformed, and cross-provider inputs produce explicit bounded outcomes rather than an inferred fallback.
- Direct task, workpool, team, mass/DAG, and ULW users can attach one immutable advice report as preflight evidence without the extension claiming universal interception.
- `extensions/herdr` remains inactive outside `HERDR_ENV=1` plus `HERDR_PANE_ID`, and no ordinary model-routing behavior depends on a Herdr pane.
