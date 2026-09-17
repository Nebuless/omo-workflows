## ADDED Requirements

### Requirement: Explicit Read-Only Route Advice

The model-routing adviser SHALL accept an explicit caller request containing a route kind, route key, ordered canonical provider/model candidates, and non-secret provenance. The adviser MUST return a versioned `RouteAdviceReport` and MUST NOT select a model, start or alter a task, retry work, mutate routing configuration, or write provider state.

#### Scenario: Valid advice request preserves native routing authority
- **GIVEN** a caller supplies a valid ordered candidate chain and route provenance
- **WHEN** the caller invokes the route-advice tool
- **THEN** the tool returns a bounded `RouteAdviceReport` and native OMO/Senpi routing and task state remain unchanged

#### Scenario: Invalid request is rejected without side effects
- **GIVEN** a request has an empty chain, non-canonical identifier, secret-bearing provenance, or input beyond documented bounds
- **WHEN** the caller invokes the route-advice tool
- **THEN** the tool returns a typed `input_invalid` result and creates no task, configuration, provider, or persistent-state mutation

### Requirement: Provider-Agnostic Dynamic Availability Evidence

The adviser SHALL evaluate each supplied provider/model candidate against runtime observation scoped to provider, model, current session, and observation time. The report MUST distinguish catalog visibility, credential evidence when public runtime state exposes it, runtime availability, stale observation, incomplete provider coverage, and unobserved providers. Catalog visibility MUST NOT imply credential readiness or future dispatch success.

#### Scenario: Fresh complete observation finds an observed usable candidate
- **GIVEN** every provider in a supplied chain has fresh complete runtime observation and one candidate has publicly observed usable runtime evidence
- **WHEN** the caller requests route advice
- **THEN** the report status is `candidate_observed_usable` and identifies that candidate as an observation rather than a selection

#### Scenario: Stale or incomplete observation prevents negative conclusion
- **GIVEN** any provider in a supplied chain is unobserved, stale, refresh-failed, or lacks coverage for the supplied candidates
- **WHEN** the caller requests route advice
- **THEN** the report status is `inventory_unknown` or `inventory_incomplete` and MUST NOT report that all candidates are unusable

#### Scenario: Complete observation finds all candidates unusable
- **GIVEN** every provider in a supplied chain has fresh complete runtime observation and every candidate is explicitly observed unusable
- **WHEN** the caller requests route advice
- **THEN** the report status is `all_candidates_known_unusable` and MUST NOT recommend an unconfigured replacement

### Requirement: Cross-Provider Boundary Preservation

The adviser SHALL preserve caller-supplied candidate order and SHALL report a provider-boundary notice whenever adjacent candidates use different providers. The adviser MUST NOT auto-cross providers, reorder candidates, or derive a fallback candidate outside the supplied chain.

#### Scenario: Ordered chain crosses provider boundary
- **GIVEN** a caller supplies candidates from two providers in ordered sequence
- **WHEN** the caller requests route advice
- **THEN** the report preserves the exact sequence and includes a provider-boundary notice without changing the route or dispatching work

### Requirement: Bounded Safe Report Contract

The adviser SHALL emit a JSON-safe `RouteAdviceReport` with schema version, opaque request/session correlation, observation timestamps, conservative status, bounded candidate observations, and bounded provider-boundary notices. The report MUST exclude task content, prompts, raw configuration, credentials, endpoints, raw provider responses, and model output. When output reaches a documented bound, the report MUST retain its identity and expose explicit truncation rather than silently dropping or fabricating data.

#### Scenario: Report reaches output bound
- **GIVEN** a valid request produces observations beyond the report's documented output limit
- **WHEN** the adviser constructs the report
- **THEN** it returns a bounded report with explicit truncation metadata and does not expose excluded data

### Requirement: Explicit Native Workflow Preflight

The adviser SHALL support use as explicit preflight evidence for direct task, task batch/workpool, team, mass/DAG, and ULW workflows. It MUST NOT claim a universal hook or intercept any workflow. A workflow caller MAY attach a report or report reference before native work begins, while OMO/Senpi retains admission, scheduling, retries, cancellation, result delivery, and completion ownership.

#### Scenario: Workflow attaches preflight evidence
- **GIVEN** a direct task, workpool, team, mass/DAG, or ULW workflow has an explicitly requested preflight step
- **WHEN** the step obtains route advice
- **THEN** the workflow can retain the report or reference as evidence and its native lifecycle behavior remains unchanged

#### Scenario: No explicit preflight is requested
- **GIVEN** native OMO/Senpi starts a workflow without invoking the adviser
- **WHEN** the workflow executes
- **THEN** the workflow retains its existing model-routing and lifecycle behavior without adviser interception

### Requirement: Herdr Separation and Optional Presentation

The model-routing adviser SHALL operate without Herdr. Existing `extensions/herdr` activation SHALL remain limited to sessions with both `HERDR_ENV=1` and `HERDR_PANE_ID`. A Herdr-managed session MAY present an already-produced route report or reference through existing safe surfaces, but Herdr MUST NOT evaluate candidates, select models, or control task routing.

#### Scenario: Ordinary OMO session uses adviser without Herdr
- **GIVEN** an OMO/Senpi session lacks `HERDR_ENV=1` or lacks `HERDR_PANE_ID`
- **WHEN** a caller explicitly invokes the installed adviser
- **THEN** the adviser returns its report without requiring a Herdr pane and existing Herdr lifecycle reporting remains inactive

#### Scenario: Herdr-managed session presents report reference
- **GIVEN** an OMO/Senpi session has `HERDR_ENV=1`, `HERDR_PANE_ID`, and an existing route report
- **WHEN** an operator explicitly requests report presentation through Herdr-safe surfaces
- **THEN** the report reference is presented without allowing Herdr to alter model selection or task lifecycle

## MODIFIED Requirements

## REMOVED Requirements
