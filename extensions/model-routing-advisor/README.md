# Model Routing Advisor

Optional OMO/Senpi extension. Registers one explicit read-only tool:

```text
model_route_advice
```

It accepts caller-normalized, ordered provider/model candidates and returns a
bounded JSON `RouteAdviceReport`. It does not read `omo.jsonc`, inspect private
OMO modules, select a model, start/retry/cancel work, change configuration, or
call a provider.

## Install

```sh
omo install -l ./extensions/model-routing-advisor
```

Restart OMO after installation. Install all repository extensions with
`omo install .`.

## Request

Invoke `model_route_advice` explicitly before native work begins:

```json
{
  "routeKind": "category",
  "routeKey": "deep",
  "candidates": [
    { "providerId": "9router", "modelId": "cx/gpt-6-astra" },
    { "providerId": "9router", "modelId": "ollama-cloud/glm-5.3-flash" }
  ],
  "provenance": { "source": "caller", "label": "deep preflight" }
}
```

`candidates` are canonical IDs from caller-held route context. Provenance has
no secrets, endpoints, prompts, task content, or provider response data.
Caller observation may be supplied in `observations`; it must be fresh and
complete for every provider before `all_candidates_known_unusable` is possible.

Report status is observation, not selection:

- `candidate_observed_usable`: one supplied candidate has fresh complete usable evidence.
- `all_candidates_known_unusable`: every supplied candidate has fresh complete unavailable evidence.
- `inventory_unknown` or `inventory_incomplete`: evidence cannot support a conclusion.
- `input_invalid`: request failed safe bounded validation.

Catalog visibility and configured auth do not prove future provider dispatch.

## Bounds

Tool requests allow up to 64 candidates and 64 caller observations. Every
observation allows up to 64 catalog IDs and 64 runtime entries. Evaluator input
is capped at 64 KiB. Reports expose the first eight candidate observations and
seven provider boundaries; `truncated: true` marks omitted detail. Status still
evaluates every supplied candidate, so a hidden candidate cannot produce a
false all-unusable conclusion.

## Workflow preflight

Tool invocation never hooks or intercepts OMO/Senpi workflows. Caller retains
report value or opaque reference, then launches native work unchanged.

| Surface | Explicit caller action |
| --- | --- |
| Direct task | Obtain one report for selected category or named-agent chain, then include report/reference in parent task record. |
| Task batch/workpool | Obtain one report per unique normalized route chain before `workpool` launch. |
| Team | Lead obtains one report per declared member route before member launch. |
| Mass/DAG | Make advice a preflight node and pass report/reference to dependent launch nodes. |
| ULW | Record report/reference in plan or goal before requested delegated wave. |

Native OMO/Senpi remains sole owner of candidate resolution, model selection,
provider crossing, task admission, scheduling, retries, cancellation, delivery,
and completion.

## Herdr boundary

This package has no `extensions/herdr` import or runtime dependency. It works
outside Herdr. When `HERDR_ENV=1` and `HERDR_PANE_ID` are present, an operator
may present an existing serialized report reference through Herdr's existing
safe surfaces. Herdr does not evaluate candidates or alter routing.

## Verify

```sh
bun test extensions/model-routing-advisor/test test/model-routing-advisor.test.ts
bun run typecheck
bun run build
bun run validate:package
```
