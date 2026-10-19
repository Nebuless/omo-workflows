## 1. Read-only provider evidence evaluator

- [x] 1.1 [U1] Add failing unit cases for malformed/secret-bearing inputs, ordered cross-provider chains, fresh usable evidence, complete all-unusable evidence, stale snapshots, incomplete coverage, truncation, and excluded data — verification: `bun test extensions/model-routing-advisor/test/advice.test.ts` fails for each intended contract before evaluator code exists
- [x] 1.2 [U1] Create standalone package types and pure evaluator that returns bounded versioned `RouteAdviceReport` values without model/task/config/provider mutation — verification: `bun test extensions/model-routing-advisor/test/advice.test.ts` passes and fake mutation spies remain zero

## 2. Public-runtime advice tool

- [x] 2.1 [U2] Record current OMO and Senpi versions plus upstream/local evidence for public per-provider availability APIs, then add failing adapter/tool tests for fresh, stale, partial, credential-unknown, and runtime-error observations — verification: upstream-validation record exists and `bun test extensions/model-routing-advisor/test/runtime.test.ts extensions/model-routing-advisor/test/tool.test.ts` fails for missing conservative states
- [x] 2.2 [U2] Implement public-API-only runtime observation adapter and read-only `model_route_advice` Senpi tool; return `inventory_unknown` when public evidence cannot support a conclusion — verification: `bun test extensions/model-routing-advisor/test/runtime.test.ts extensions/model-routing-advisor/test/tool.test.ts` passes with no private OMO import, no task start, no config write, and no provider-control call

## 3. Installable package and non-interference integration

- [x] 3.1 [U3] Add failing extension-load and package-validation coverage for the new optional package while characterizing unchanged behavior when advice is not invoked or Herdr environment is absent — verification: targeted `bun test test/extension-load.test.ts test/model-routing-advisor*.test.ts` fails before package registration/build updates
- [x] 3.2 [U3] Wire package into root validation/build conventions; add package-local DOX and operator documentation; preserve `extensions/herdr` as optional report-reference presentation with no cross-package runtime import — verification: `bun run validate:package`, `bun run typecheck`, `bun run build`, and targeted tests pass; `HERDR_ENV`-absent regression fixture proves unchanged Herdr behavior

## 4. Explicit workflow preflight evidence

- [x] 4.1 [U4] Add focused guidance and examples that attach advice/reference explicitly before direct task, workpool, team, mass/DAG, and ULW waves without claiming an automatic hook — verification: docs review against `specs/model-routing-advice/spec.md`; example requests use caller-normalized candidates and retain native workflow ownership
- [x] 4.2 [U3, U4] Run isolated OMO terminal QA: invoke valid, malformed, and all-unusable advice requests; optionally present an existing report reference in a `HERDR_ENV=1` session with valid pane ID; tear down all temporary sessions/configs — verification: captured terminal evidence shows typed reports and no routing/task/config mutation, with cleanup receipt

## 5. Change validation

- [x] 5.1 [U1-U4] Run full regression and OpenSpec validation after all implementation slices — verification: `bun test`, `bun run typecheck`, `bun run build`, `bun run validate:package`, and `openspec validate add-model-routing-advisor --type change --strict` exit 0
