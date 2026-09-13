# Design review protocol adapter

Native scheduler owns journal storage, model stage dispatch, cancellation, and final workflow state. Host effect owns helper bootstrap and poll/reply lifecycle. Adapter owns only helper process poll/reply protocol and replay-safe event handling.

Integration:

```ts
const bootstrap = await createLiveBootstrapper({
  script: `${process.env.OMO_IMPECCABLE_SCRIPTS}/live.mjs`,
  cwd: workflowCwd,
});
await bootstrap({ target: previewPath, signal: runAbortSignal });
const transport = await createLiveHelperTransport({
  script: `${process.env.OMO_IMPECCABLE_SCRIPTS}/live-poll.mjs`,
  cwd: workflowCwd,
});
const driver = createDesignReviewDriver({
  session: runId,
  transport,
  journal: nativeCustomJournal,
  host: { runModel: (eventKey, event, signal) => nativeModelStage(eventKey, event, signal) },
});
await driver.run(runAbortSignal);
```

`nativeCustomJournal` adapts native custom journal append acknowledgement and branch replay to `DesignReviewJournal`. Host must bundle immutable Impeccable `live-poll.mjs` plus sibling modules from Atomic commit `ff55b141109e3f9f5980c1f0c718dea39f6b2fd9`, or pass an explicitly installed readable path. Source owner is Bastani, Inc.; exact MIT license with Atomic attribution threshold clause lives at `../../LICENSES/Atomic-LICENSE.txt`. `createLiveBootstrapper` and `createLiveHelperTransport` check paths before dispatch and never download or install dependencies. Extension host reads explicit `OMO_IMPECCABLE_SCRIPTS`; unset configuration rejects live review.

Timeout events stay inside driver and mint neither journal entries nor model stages. Unreadable successful poll output becomes timeout, matching pinned Atomic protocol. Only `generate`, `steer`, `manual_edit_apply`, and `variant_mount_failed` invoke `runModel`. Event is journaled before model dispatch; result is journaled before helper reply; helper acknowledgement is journaled after successful reply. Host must map stable `eventKey` to durable native stage/result reuse, including recovery after model completion but result-journal failure. Pending events replay oldest-first; acknowledged duplicate IDs are ignored. Journaled helper `exit` replays terminally without process/model work. One native node remains reserved for export; review rejects at native 64-node ceiling. Abort, process failure, invalid boundary data, and journal failure reject.
