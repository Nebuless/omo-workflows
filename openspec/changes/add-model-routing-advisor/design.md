# Context

Current OMO routing profiles contain ordered provider/model preferences, while available models can change by provider, credentials, active session, and time. Existing repository policy says extensions can add providers and models dynamically, and catalog visibility does not prove credentials or dispatch. Prior routing research found no supported public effective-route resolver and no public universal admission hook.

`extensions/herdr` already has a narrow contract: activate only with `HERDR_ENV=1` and `HERDR_PANE_ID`, report OMO lifecycle to Herdr, expose safe CLI inspection/control, and register skills. Native OMO/Senpi owns configuration merge, task execution, workpool/team/DAG coordination, retries, cancellation, and completion. No repository ADRs currently exist.

The proposal and `model-routing-advice` delta require explicit, conservative preflight advice without native-routing mutation. The existing routing-intelligence plan is directionally aligned but must be revalidated against the pinned runtime before code relies on its API findings.

## Goals / Non-Goals

**Goals:**

- Deliver an optional standalone package that returns bounded, versioned, read-only availability advice from public runtime evidence.
- Preserve caller candidate order and make provider transitions, freshness, coverage, and uncertainty explicit.
- Let direct task, workpool, team, mass/DAG, and ULW callers record preflight evidence without claiming an automatic integration hook.
- Keep `extensions/herdr` optional and limited to presentation/control of an already-created report reference.

**Non-Goals:**

- Effective route resolution, raw JSONC parsing, profile repair, configuration writes, model selection, task dispatch, fallback/retry policy, or provider ranking.
- A universal scheduler/admission hook, persistent daemon, polling timer, socket, filesystem mailbox, broker, lineage store, or task store.
- Cross-extension mutable state or private OMO/Senpi bundle imports.
- Storage or exposure of secrets, prompts, task content, raw provider responses, endpoint data, or model output.

## Decisions and Guardrails

### D1. Separate adviser package, not a Herdr feature

Create `extensions/model-routing-advisor` with its own `package.json`, entry point, pure advice logic, and tests. It composes through public Senpi extension APIs. This avoids making ordinary OMO routes depend on a Herdr pane.

Rejected alternative: add route evaluation to `extensions/herdr`. This would couple routing to the opt-in `HERDR_ENV=1` environment and blur the existing safe resource-control boundary.

### D2. Caller-normalized input and report-only output

The public tool accepts:

```ts
{
  routeKind: "category" | "named-agent";
  routeKey: string;
  candidates: Array<{ providerId: string; modelId: string }>;
  provenance: { source: "caller"; label?: string };
}
```

The adviser does not read private OMO route internals or raw configuration. It produces a JSON-safe `RouteAdviceReport` with schema version, opaque request/session correlation, input-order candidate observations, provider snapshots, conservative status, timestamps, optional bounded notices, and truncation metadata.

Rejected alternative: parse merged `omo.jsonc` or import OMO bundled route code. Neither is a supported version-matched extension seam.

### D3. Dynamic provider evidence is conservative

Each provider snapshot has a provider ID, observation time, expiry/freshness, coverage for candidates, catalog evidence, credential evidence only where public state exposes it, runtime evidence, and typed error category. Candidate observations distinguish:

- `catalog_visible`
- `credential_ready` or `credential_unknown`
- `runtime_available`, `runtime_unavailable`, or `runtime_unknown`
- `dispatch_unproven`

Only fresh complete observations for every candidate provider may yield `all_candidates_known_unusable`. Missing, stale, failed, or partial observation yields `inventory_unknown` or `inventory_incomplete`.

A report may name `firstObservedUsableCandidate`, but that field is observation only. It cannot select a model or authorize fallback. Every provider change in the ordered input emits a boundary notice.

### D4. Bounded stateless tool boundary

Validate canonical non-empty provider/model identifiers, candidate count, string bytes, total input bytes, route key, and JSON-safe provenance. Reject known secret-bearing fields and unsupported fields. Bound every report collection and string; retain `requestId` plus explicit truncation when report detail exceeds limits.

Keep advice stateless and synchronous. Do not spawn a background process or poll providers. If public runtime data is unavailable, report uncertainty. Existing Herdr output bounding is a local style reference, not shared runtime state.

### D5. Explicit workflow preflight only

Callers invoke the tool before a workflow launch where evidence is useful:

| Surface | Integration |
|---|---|
| Direct task/category/named agent | Parent gets advice before launch and retains report/reference. |
| Task batch/workpool | Caller creates one report per unique normalized route chain. |
| Team | Lead creates one report per declared role route before member launch. |
| Mass/DAG | Explicit preflight node/skill step writes or passes report reference. |
| ULW | Goal/plan step records report reference before delegated wave when requested. |

No advice call runs automatically at `agent_start`: it is too late for preflight, has no proven complete route context, and cannot cover every native surface.

### D6. Herdr is presentation only

No runtime import links the packages. `RouteAdviceReport` is serializable so an explicit caller in a Herdr-managed OMO session may show a bounded report reference using existing safe tools. `extensions/herdr` neither evaluates candidates nor controls selection. Sessions lacking `HERDR_ENV=1` or `HERDR_PANE_ID` behave exactly as they do now.

### D7. Upstream validation before runtime-dependent code

Before U2 begins, record timestamp, repository and global runtime versions, local source paths, and upstream evidence from both OMO and Senpi under `docs/upstream-validation.md`. If public per-provider availability APIs are absent, use only caller/CLI observed snapshot evidence and preserve `inventory_unknown`; do not reach into private internals.

## Implementation Units

### U1. Package contract and pure report evaluator
- **Delivers:** Versioned TypeScript request/report types, bounded input validation, provider-snapshot normalization, conservative status reducer, candidate ordering, provider-boundary notices, and redaction/truncation behavior.
- **Depends on:** D1-D4.
- **Touches:** `extensions/model-routing-advisor/package.json`, `extensions/model-routing-advisor/src/advice.ts`, `extensions/model-routing-advisor/src/types.ts`, `extensions/model-routing-advisor/test/advice.test.ts`.
- **Verification:** Unit tests begin RED for malformed input, stale/partial snapshots, all-unusable evidence, observed usable candidate, cross-provider boundary, bounded report, and non-secret projection; tests pass after pure implementation.

### U2. Public runtime observation adapter and Senpi tool
- **Delivers:** Public-API-only adapter that obtains or accepts per-provider observation, converts failures to conservative snapshots, and registers `model_route_advice` as a read-only Senpi tool.
- **Depends on:** U1 and upstream validation gate D7.
- **Touches:** `extensions/model-routing-advisor/index.ts`, `extensions/model-routing-advisor/src/runtime.ts`, `extensions/model-routing-advisor/src/tool.ts`, `extensions/model-routing-advisor/test/runtime.test.ts`, `extensions/model-routing-advisor/test/tool.test.ts`.
- **Verification:** Controlled fake public-runtime fixtures show fresh complete, stale, partial, missing-credential, and runtime-error states. Tool integration proves structured report and no route/task/config mutation.

### U3. Package integration and regression coverage
- **Delivers:** Root build/package validation inclusion, extension load coverage, extension docs/AGENTS ownership, skill guidance for explicit workflow preflight, and optional Herdr report-reference guidance without cross-package import.
- **Depends on:** U2.
- **Touches:** root `package.json`, root `test/extension-load.test.ts`, `test/model-routing-advisor*.test.ts`, `extensions/model-routing-advisor/AGENTS.md`, `extensions/model-routing-advisor/README.md`, relevant `docs/` routing guidance, and only any necessary Herdr skill documentation.
- **Verification:** `bun test`, `bun run typecheck`, `bun run build`, `bun run validate:package`, and a minimal driver import/load prove package discovery. Manual OMO TUI proof exercises explicit advice in an isolated session; Herdr is checked separately only when environment-gated.

### U4. Cross-workflow preflight guidance and evidence contract
- **Delivers:** Stable instructions and report-reference format for direct task, workpool, team, mass/DAG, and ULW callers; no interception code.
- **Depends on:** U1-U3.
- **Touches:** `docs/omo-subagents.md`, `docs/model-routing.md`, relevant installed/packaged skill source where owned by this repository, and extension README.
- **Verification:** Documentation review matches tool fields and existing workflow ownership. Manual examples invoke advice explicitly before a direct task and demonstrate an unchanged task launch path.

## Verification Strategy

1. Capture failing-first unit tests for every observable report status and every invalid/redacted/boundary input before evaluator code.
2. Characterize native non-interference: invoke advice and assert no config write, task start, task update, model selection call, or provider-control call occurred in a fake public runtime.
3. Test provider state transitions with deterministic fixtures: present to absent to present, stale snapshot, incomplete coverage, missing credential, runtime error, and candidate chain crossing providers.
4. Run full repository `bun test`, `bun run typecheck`, `bun run build`, and `bun run validate:package` after U3 inputs settle; fix only regression-causing failures.
5. Run an isolated OMO session with the package installed. Invoke the tool with valid input, malformed input, and no available candidate; capture real terminal output and cleanup session/temp state. Repeat only Herdr reference presentation with `HERDR_ENV=1` plus a valid pane ID; prove no non-Herdr session behavior changes.
6. Run `openspec validate add-model-routing-advisor --type change --strict` before implementation starts and again when implementation completes.

## Risks and Unresolved Blockers

- Public runtime may not expose fresh per-provider credential and availability state. Mitigation: use conservative caller/CLI snapshots and `inventory_unknown`; do not private-import.
- No universal hook exposes all workflow route chains. Mitigation: explicit preflight guidance and evidence references only.
- Dynamic provider catalog semantics may vary. Mitigation: provider-agnostic observation state and test fixtures; no hardcoded fallback map.
- Report provenance can accidentally include secrets. Mitigation: allowlist schema and secret-field rejection; test redaction and serialization.
- Extension package discovery/build conventions may need root updates. Mitigation: follow existing extension package and test patterns; keep changes local to new package plus declared integration files.
