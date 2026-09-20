---
touches-shared:
  - packages/lib/src/typescript/lib/data/AbstractStore.ts
  - packages/lib/src/typescript/lib/data/StoreWorkerClient.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/qa/vite/plugins.ts
  - packages/qa/README.md
---

# Store Worker Fails Safe — Implementation Plan

## Overview

A store holding 1,000 records or more never builds its view. A `Table` bound to one stays empty for the life of the page, with no error anywhere. This is item 5 of [`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L89), found by the QA app's first authorised sweep on 2026-09-20.

Above `WORKER_THRESHOLD` ([`data/AbstractStore.ts:16`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L16)) the store sorts and filters on a Web Worker. Three faults sit on that path: one causes the failure, and the other two are why nothing notices it and nothing recovers from it. The built library asks the *consuming app* for the worker script by a root-absolute, build-hashed URL only the library ships. `StoreWorkerClient` ([`data/StoreWorkerClient.ts:30`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L30)) cannot tell a dead worker from a live one, because `new Worker(url)` fails asynchronously and the client listens for nothing but a reply. And `AbstractStore.applyViewOnWorker` ([`data/AbstractStore.ts:2013`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L2013)) has no failure path at all, so a request that never comes back leaves `_records` empty and the `load` event unfired, permanently.

This plan fixes all three.[^scope] The worker is embedded in the library's own bundle, so no request leaves the page. The client wires the two error hooks a `Worker` offers and times its own first round trip, so a worker that dies is *known* to be dead. And `applyView()` builds the view in process whenever the offload fails, so the view is always built and every event that waits behind it always fires. The QA app's `/assets/` plumbing existed only to answer that request; it goes too.

---

## Architecture Decisions

### Follow `ElkLayoutEngine`: finish the work on the main thread and retire the worker

`ElkLayoutEngine.layout` ([`component/diagram/ElkLayoutEngine.ts:431`](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L431)) already solves this exact problem for the library's other Web Worker. It catches the failure, terminates the worker it is abandoning, redoes the work on the main thread, and never goes back to a worker afterwards ([`:450-459`](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L450)). The store worker gets the same shape.[^elk-precedent]

The difference is scope. `ElkLayoutEngine` owns its worker per instance; `StoreWorkerClient` owns one worker for the whole page, shared by every store. So retiring the worker is the client's job and covers the whole page, while rebuilding the view in process is `AbstractStore`'s and happens per call.

### Embed the worker in the bundle with `?worker&inline`

[`data/StoreWorkerClient.ts:15`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L15) changes from `~/data/StoreWorker.js?worker` to `~/data/StoreWorker.js?worker&inline`. Vite then puts the bundled worker source into the importing chunk as a string and starts the worker from a `blob:` URL built at runtime, with a `data:` URL as its own fallback. Nothing is fetched, so nothing can 404 and nothing can be answered with the wrong file.[^inline]

The worker is 2,728 bytes built, so every consumer of `@jimka/typescript-ui/data` carries about 2.8 KB it did not carry before, whether or not it ever crosses the threshold. That is the whole cost.[^inline-cost]

This changes what a strict Content-Security-Policy must allow: `worker-src blob:` (or `data:`) rather than `worker-src 'self'`. A policy that allows neither makes the `Worker` constructor throw, which `ensureWorker`'s existing `try`/`catch` already turns into "no worker", and every store then runs in process.

### Detection is error plumbing plus a startup probe, not a readiness handshake

`StoreWorkerClient` sets `onerror` and `onmessageerror` on the worker, and arms one timer on its first request that is cleared by the first reply of any kind. Any of the three firing retires the worker and rejects everything outstanding.[^detection]

A readiness handshake was rejected: `isAvailable()` is synchronous and `applyView()` reads it to decide, so a handshake would make the decision asynchronous and change the `load` event's timing for every store, including the ones below the threshold.[^handshake]

### The fallback is per call; the retirement happens once

Any call whose offload fails builds its own view in process. Separately, a failure that proves the *worker* is dead retires it for the whole page, so no later call pays a round trip that cannot succeed. A failure that only proves *this request* was bad retires nothing.

| What failed | This call's view | The worker afterwards |
|---|---|---|
| The worker script never ran (an `error` event) | built in process | retired for the page |
| The first request never came back (the startup probe expired) | built in process | retired for the page |
| A reply could not be decoded (a `messageerror` event) | built in process | retired for the page |
| One record would not structured-clone (`postMessage` threw) | built in process | kept; the next call tries again |
| The worker replied with an error string | built in process | kept; the next call tries again |

### The in-process path is the more correct one, so degrading to it needs no apology

The worker protocol carries a single sorter, so the worker path silently reduces a multi-column sort to its primary column — stated in `applyViewOnWorker`'s own `@remarks` ([`data/AbstractStore.ts:2007-2012`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L2007)). The in-process path applies every sorter. A retired worker therefore costs main-thread time and *gains* sort correctness, which is why nothing tries to bring the worker back.

### `applyView()` never rejects

After this change `applyView()` always resolves, and `_records` is built by the time it does. That is a contract, not an accident: three of the store's own methods emit their events from `applyView().then(…)` — `sort` ([`:1444`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1444)), `clearSort` ([`:1480`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1480)) and `applyFilterChange` ([`:1615`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1615)) — and `load()` awaits it inside a `try`/`finally` ([`:359`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L359)). Putting the recovery inside `applyViewOnWorker` covers all four with one `catch`.[^one-catch]

### Announce the degradation with `console.warn`, not a new event

The client warns once when it retires the worker; each store warns once the first time it falls back. No new `StoreEvent` is added, because a consumer cannot act on the information — the view is already correct by the time it could listen.[^warn]

---

## Internal Structure

### `StoreWorkerClient` module state

```typescript
let worker: Worker | null = null;
let nextRequestId = 1;
const pending: Map<number, Pending> = new Map();

// Set once the worker is proven dead; never cleared, so a retired worker is
// never rebuilt.
let workerRetired = false;
// Set by the first reply of any kind. Until then the worker is unproven and
// its first request is timed.
let workerProven = false;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
```

`WORKER_PROBE_TIMEOUT_MS = 5000` bounds worker startup and its first answer, not a sort: only the first request is timed, because once the worker has answered, a long wait is real work rather than a dead script. Five seconds is far more than a `blob:` worker needs to boot and take its first snapshot, and expiring it early costs only the offload, since the in-process path builds the same view.

### `clearProbeTimer()` and `retireWorker(reason)`

```typescript
function clearProbeTimer(): void {
    if (probeTimer !== null) {
        clearTimeout(probeTimer);
        probeTimer = null;
    }
}

function retireWorker(reason: string): void {
    if (workerRetired) {
        return;
    }

    workerRetired = true;
    clearProbeTimer();

    const dead = worker;
    worker = null;
    dead?.terminate();

    const error = new Error(`StoreWorker retired (${reason}); sort and filter run on the main thread`);

    for (const p of pending.values()) {
        p.reject(error);
    }

    pending.clear();
    console.warn(error.message);
}
```

`ensureWorker()` returns `null` immediately while `workerRetired`, which is what makes `isAvailable()` false for every later caller.

### `AbstractStore.applyView` after the split

```typescript
protected applyView(): Promise<void> {
    this.rebuildIdIndex();

    if (this._allRecords.length >= WORKER_THRESHOLD && StoreWorkerClient.isAvailable() && !this.hasCustomSorter()) {
        this._viewAsync = true;

        return this.applyViewOnWorker();
    }

    this._viewAsync = false;
    this.applyViewInProcess();

    return Promise.resolve();
}
```

`applyViewInProcess(): void` is today's synchronous branch ([`:1913-1933`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1913)) moved verbatim into a private method. It does not touch `_viewAsync`, which stays owned by `applyView`.[^viewasync]

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/data/StoreWorkerClient.ts`** — change the import at line 15 from `"~/data/StoreWorker.js?worker"` to `"~/data/StoreWorker.js?worker&inline"`. Leave the `@ts-ignore` comment above it as it is.

2. **`StoreWorkerClient.ts`** — add the three module-level fields (`workerRetired`, `workerProven`, `probeTimer`) and the `WORKER_PROBE_TIMEOUT_MS` constant from *Internal Structure*, with the constant's justification as its comment.

3. **`StoreWorkerClient.ts`** — add `clearProbeTimer()` and `retireWorker(reason)` as module-level functions, per *Internal Structure*. Use the bare global `setTimeout` / `clearTimeout`; do **not** route them through `DOM.sink`, which would make the DOM-free `data/` entry point import `core/DOM`.[^timers]

4. **`StoreWorkerClient.ts`** — declare two named module-level handlers, per ARCHITECTURE.md's *Listeners must reference a named function*: `handleWorkerError()`, calling `retireWorker("the worker script failed to run")`, and `handleWorkerMessageError()`, calling `retireWorker("a reply could not be decoded")`. Then, in `ensureWorker()` (line 30), return `null` before anything else when `workerRetired` is true, and alongside the existing `worker.onmessage` assignment add `worker.onerror = handleWorkerError;` and `worker.onmessageerror = handleWorkerMessageError;`.

5. **`StoreWorkerClient.ts`** — in the `onmessage` handler, before reading `e.data`, mark the worker proven: set `workerProven = true` and call `clearProbeTimer()`. This runs for every reply, including one whose `requestId` is unknown.

6. **`StoreWorkerClient.ts`** — in `send()` (line 58), inside the `new Promise` executor after `pending.set(...)` and before `w.postMessage(message)`, arm the probe when `!workerProven && probeTimer === null`: `probeTimer = setTimeout(handleProbeTimeout, WORKER_PROBE_TIMEOUT_MS)`, where `handleProbeTimeout` is a named module-level function calling `retireWorker("its first request went unanswered for " + WORKER_PROBE_TIMEOUT_MS + "ms")`.

7. **`StoreWorkerClient.ts`** — rewrite `isAvailable()`'s JSDoc (line 74-79): it now reports whether a worker exists *and has not been retired*, and a `false` here means the caller must do the work itself. Update the file header comment (lines 3-7) the same way — it currently says the client "falls back gracefully if Worker isn't available", which understates what it now detects.

8. **Checkpoint** — `cd packages/lib && npm run typecheck` passes, and `grep -n "onerror\|onmessageerror\|probeTimer" src/typescript/lib/data/StoreWorkerClient.ts` shows the new wiring.

9. **`packages/lib/src/typescript/lib/data/AbstractStore.ts`** — extract lines 1913-1933 (the filter/sort/assign body of `applyView`) into a new `private applyViewInProcess(): void` placed directly below `applyView`. Give `applyViewInProcess` a JSDoc saying it builds the view from `_allRecords` with every active filter and every active sorter, and that it is both the below-threshold path and the fallback when the worker path fails. Rewrite `applyView` to the form in *Internal Structure*.

10. **`AbstractStore.ts`** — add a `private _workerFallbackWarned: boolean = false;` field next to `_snapshotDirty` ([`:209`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L209)), commented as "one warning per store the first time its offload fails; a later failure is the same fact".

11. **`AbstractStore.ts`** — in `applyViewOnWorker` (line 2013), move the `_snapshotDirty` clear out of the eager `if` block (lines 2018-2020) and into the snapshot promise's own success: `StoreWorkerClient.snapshot(...).then(() => { this._snapshotDirty = false; })`. Delete the eager block.[^snapshot-dirty]

12. **`AbstractStore.ts`** — append `.catch((error: unknown) => this.fallBackToInProcessView(error))` to `applyViewOnWorker`'s returned chain, after the `.then(indices => …)` at line 2038. Add `private fallBackToInProcessView(error: unknown): void`, which warns once (guarded by `_workerFallbackWarned`, naming the store id and the error) and then calls `this.applyViewInProcess()`. It returns nothing, so the chain resolves.

13. **`AbstractStore.ts`** — update the JSDoc on `applyView` (line 1897-1901), `applyViewOnWorker` (line 2000-2012) and `loadData` (line 441-445, plus the inline comment at 449-453) to state the new contract: `applyView()` always resolves and the view is always built when it does; `loadData` fires `load` exactly once, synchronously below the threshold and after the view settles above it, whether the worker or the fallback built it. Keep `applyViewOnWorker`'s existing multi-sort `@remarks` and add that the fallback applies every sorter.

14. **Checkpoint** — `cd packages/lib && npm run typecheck && npm run lint`, with no new lint reports and no edit to `scripts/eslint/no-raw-dom.baseline.json`.

15. **`packages/lib/tests/unit/data/StoreWorkerClient.test.ts`** — extend `FakeWorker` (line 44) with `onerror`, `onmessageerror`, a `terminated` boolean set by a `terminate()` method, and `fail()` / `failMessage()` helpers that invoke the two handlers. Add the cases listed under *Expected Behaviour* as a new `describe('StoreWorkerClient worker retirement (faked Worker)')`.

16. **`packages/lib/tests/unit/data/AbstractStore.workerView.test.ts`** — add the store-level fallback cases listed under *Expected Behaviour*, in the existing file, using the same `vi.spyOn(StoreWorkerClient, …)` style.

17. **`packages/lib/tests/unit/data/AbstractStore.workerFailSafe.test.ts`** — create it, holding the one end-to-end case: a real `MemoryStore` over a stubbed global `Worker` that never replies. It needs `vi.resetModules()` plus dynamic imports so `AbstractStore` and `StoreWorkerClient` share one fresh module graph, and `vi.useFakeTimers()` to reach the probe timeout, so it cannot share a file with step 16's spies.

18. **Checkpoint** — `cd packages/lib && npm test`. Step 17's case must have been seen to fail before steps 9-13 were applied; if it was written after, revert steps 12-13 locally, confirm it fails, and restore them.

19. **`packages/qa/vite/plugins.ts`** — delete `LIBRARY_ASSETS` (line 21), `ASSETS_URL` (line 24), `ASSET_TYPES` (lines 26-30), the whole `libraryAssetFile` export (lines 177-208), and — inside `qaLibraryPlugin` only — the `fs.existsSync` guard that throws (lines 236-242), the `assetFile` binding (line 244) and the `configureServer` hook (lines 250-263). `qaReportPlugin` has a `configureServer` of its own; leave it alone. Rewrite `qaLibraryPlugin`'s JSDoc to drop the `/assets/` paragraph and its `@throws`. Keep `isUnder` (`outsideAppSource` uses it) and keep both the `fs` and `path` imports (`readPackage` and `writeReport` use them).

20. **`packages/qa/tests/plugins.test.ts`** — delete the `libraryAssetFile` describe (lines 76-115) and the `qaLibraryPlugin` describe (lines 117-123), and drop `libraryAssetFile` and `qaLibraryPlugin` from the import at line 5. `fs` and `REAL_LIB` stay: the `libraryAliases` case at line 41 still uses both.

21. **`packages/qa/src/builders/store.ts`** — update `VIEW_TIMEOUT_MS`'s comment (lines 17-23). It says the cap "only bounds a store that never answers"; the library now bounds that itself, so the cap is the panel's own net against a mis-wired build. The wait itself does not change — a working worker still makes `load` asynchronous, which is what `awaitStoreView` exists for.[^await-store-view]

22. **`packages/qa/README.md`** — replace the "*The same plugin serves the arm's `dist/lib/assets/` at `/assets/`*" paragraph (lines 79-92) with a short note that each library build's sort/filter worker now travels inside that build's own chunks, so a two-arm comparison gets each arm's own worker with no file plumbing and no startup check. Update the `vite/plugins.ts` row of the file table (line 25) to drop "and the build's own `/assets/`".

23. **Checkpoint** — `cd packages/qa && npm run typecheck && npm test`.

24. **Documentation** — apply `## Documentation Impact`.

25. **Final check** — `cd packages/lib && npm run build:lib`, then from `packages/lib`:
    - `grep -rn "/assets/StoreWorker" dist/lib/` — expect zero matches.
    - `test ! -d dist/lib/assets && echo gone` — expect `gone`.
    - `grep -l "createObjectURL" dist/lib/*.js` — expect exactly the chunk that holds `StoreWorkerClient`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/data/StoreWorkerClient.ts` |
| Modify | `packages/lib/src/typescript/lib/data/AbstractStore.ts` |
| Modify | `packages/lib/tests/unit/data/StoreWorkerClient.test.ts` |
| Modify | `packages/lib/tests/unit/data/AbstractStore.workerView.test.ts` |
| Create | `packages/lib/tests/unit/data/AbstractStore.workerFailSafe.test.ts` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/reference/browser-support.md` |
| Modify | `packages/lib/docs/reference/troubleshooting.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/qa/vite/plugins.ts` |
| Modify | `packages/qa/tests/plugins.test.ts` |
| Modify | `packages/qa/src/builders/store.ts` |
| Modify | `packages/qa/README.md` |

---

## Expected Behaviour

Every case below is unit-testable. Nothing in this plan needs a rendered pixel; the one thing tests cannot reach is whether a `blob:` worker actually boots in a real engine, which `## Verification` handles as a manual step.

### `StoreWorkerClient` — retirement

| # | Given | Then |
|---|---|---|
| 1 | Two requests in flight, the worker fires `error` | Both reject, with a message naming the main-thread fallback |
| 2 | The worker has fired `error` | `isAvailable()` is `false` and `terminate()` was called exactly once |
| 3 | One request sent, no reply, the clock advances past `WORKER_PROBE_TIMEOUT_MS` | The request rejects and `isAvailable()` becomes `false` |
| 4 | One request replied to, a second sent, the clock advances well past the timeout | The second request is still pending and `isAvailable()` is still `true` |
| 5 | The worker replies `{ requestId, error: "boom" }` | That one request rejects; `isAvailable()` stays `true`; no `terminate()` |
| 6 | The worker fires `messageerror` | As case 1 and 2 |
| 7 | The worker is retired, then `sortFilter` is called again | It rejects, and no second `Worker` is ever constructed |

### `AbstractStore` — the fallback

Each case loads 1,200 records (over the 1,000 threshold) with `StoreWorkerClient.isAvailable()` stubbed `true`.

| # | Given | Then |
|---|---|---|
| 8 | `sortFilter` rejects | `getRecords()` holds all 1,200 and `load` fired exactly once, with the full view |
| 9 | `snapshot` rejects | As case 8 |
| 10 | Two sorters active, `sortFilter` rejects | The view is ordered by both, which the worker path cannot do — pin it with data whose primary-only order differs |
| 11 | `sort()` called and `sortFilter` rejects | The returned promise resolves, and `sortchange` and `datachange` both fire |
| 12 | `load()` called through the proxy and `sortFilter` rejects | The returned promise resolves, `load` fires, and `isLoading()` is `false` afterwards |
| 13 | `sortFilter` rejects twice on one store | `console.warn` was called once, not twice |
| 14 | The worker resolves normally | Unchanged from today: `load` deferred until the view is ready, then fired once with the full view |
| 15 | 5 records loaded with a worker available | Unchanged from today: `load` fires synchronously inside `loadData` |

### The regression case

| # | Given | Then |
|---|---|---|
| 16 | A real `MemoryStore` of 1,200 records over a stubbed global `Worker` that records `postMessage` and never replies, the clock advanced past the probe timeout | `getRecords()` holds all 1,200 and `load` fired exactly once |

Case 16 is the reported bug. Before this plan it leaves the view empty and fires nothing, and no timer exists for the clock to advance, so it fails by assertion rather than by hanging.

---

## Verification

Automated, in order:

1. `cd packages/lib && npm run typecheck`
2. `cd packages/lib && npm run lint` — no new reports, and `scripts/eslint/no-raw-dom.baseline.json` needs no edit. A rule firing here would mean a timer or a `Worker` call was written in a shape the seam owns.
3. `cd packages/lib && npm test` — cases 1-16.
4. `cd packages/lib && npm run docs:api` — **no new warnings**. `master` emits 14; that count must not rise. Do not write a zero-warning bar into anything.
5. `cd packages/lib && npm run build:lib`, then the three greps in step 25.
6. `cd packages/qa && npm run typecheck && npm test`
7. `cd packages/qa && timeout 20 npm run dev` — the server must reach "ready in …" against the rebuilt library, which now has no `dist/lib/assets`. This opens no window; the timeout stops it. A startup throw naming `dist/lib/assets` means step 19 was not applied.

Manual, and **only with the user's explicit go-ahead** — every QA run opens a full-screen window on their desktop:

8. From the repository root, `packages/qa/runqa.sh store-worker-fail-safe main 'panel=table-rows'`. `table-rows` builds 10,000 records, so it takes the worker path, and its `afterMount` cannot reach its element lookups until the store's view exists. Exit 0 means the `blob:` worker booted and answered. This is the only check that proves the inline worker runs in a real engine; nothing offline can.

---

## Documentation Impact

No exported signature changes, so no entry point, catalog or sidebar entry moves. Four consumer-facing pages describe the behaviour that changes:

- [`packages/lib/docs/concepts/performance.md:88-101`](packages/lib/docs/concepts/performance.md#L88) — "Web Worker for sort and filter". Line 97 says "You don't configure anything — the worker is created lazily on first use." Add that the worker now ships inside the bundle, and that a worker that cannot start or stops answering is retired for the page, after which every store sorts and filters in process — slower, and with full multi-column sorting rather than the worker's primary-column-only reduction.
- [`packages/lib/docs/reference/browser-support.md:20`](packages/lib/docs/reference/browser-support.md#L20) — the `Web Workers` line. Add the CSP requirement (`worker-src blob:`, or `data:`) and that a policy forbidding both degrades to the main thread rather than failing.
- [`packages/lib/docs/reference/troubleshooting.md:90-95`](packages/lib/docs/reference/troubleshooting.md#L90) — "My filter or sort is throwing in a Worker". Add what now happens: the store builds the view in process instead, warns once naming the store, and the sort or filter still completes.
- [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — add a `### Data` subsection under `## Fixed`, placed to match the ordering used in `0.9.0.md`. One entry, covering: the store's worker never loaded in a built consumer app at all; it now ships inside the bundle; a worker that dies is detected and retired; and the view is always built. Say plainly that a consumer with a strict CSP must now allow `worker-src blob:`, and that no consumer action is needed otherwise.

No `migration/next.md` entry: nothing a consumer wrote stops compiling or stops working, and the worker never worked for any consumer of the published package in the first place.

`llms.txt` is unchanged — `StoreWorkerClient` is internal and is not exported from [`data/index.ts`](packages/lib/src/typescript/lib/data/index.ts).

---

## Potential Challenges

- **`docs:api` warnings on `loadData`'s JSDoc.** `loadData` is public, so its JSDoc renders; `{@link}`-ing `applyView`, `applyViewInProcess` or `StoreWorkerClient` from it produces a "resolved but not included" warning. Describe the behaviour in prose instead, per CODE_CONVENTIONS.md.
- **The end-to-end test's module graph.** `AbstractStore` imports `StoreWorkerClient` as a module singleton. Stubbing the global `Worker` *before* `vi.resetModules()` and then dynamically importing `MemoryStore` is what makes both see the same fresh, stubbed graph; importing statically at the top of the file defeats it. The existing `freshClient()` helper in `StoreWorkerClient.test.ts` is the working example.
- **Fake timers and promises together.** Reaching the probe timeout needs `await vi.advanceTimersByTimeAsync(...)`, not the synchronous `advanceTimersByTime`, or the promise chain behind the rejection never drains.
- **The QA dev server after the change.** `qaLibraryPlugin` currently refuses to start when the library build it measures has no `dist/lib/assets`, and the fixed build has none. Step 19 must land before anything runs the QA app, or the QA app stops at startup. Nothing is lost by deleting that check: `runqa.sh:153` already refuses a build with no `dist/lib/core.es.js` and names it.
- **Two warnings on one failure.** A dead worker makes the client warn once and the first store that notices warn once. That is intended: the messages answer different questions ("the worker is gone" and "this store stopped offloading"), and both are once-only.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts:431-481`](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L431) | The precedent this plan follows: catch, terminate, redo on the main thread, never return to the worker. Read `layout` and `terminateOwnedWorker` ([`:555`](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L555)) before writing step 12. |
| [`packages/lib/src/typescript/lib/data/AbstractStore.ts:1890-2049`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1890) | `applyView`, `compareBySorter`, `hasCustomSorter`, `applyViewOnWorker` — everything steps 9-13 touch. |
| [`packages/lib/src/typescript/lib/data/AbstractStore.ts:331-380`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L331) and [`:446-459`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L446) | `load()` and `loadData()`, the two entry points whose event timing the fallback has to keep. |
| [`packages/lib/src/typescript/lib/data/TreeStore.ts:192-206`](packages/lib/src/typescript/lib/data/TreeStore.ts#L192) | The one `applyView` override. It rebuilds its node index on the returned promise's settle, so it works only because the promise now always resolves. Change nothing here; read it to see why step 12 catches rather than rethrows. |
| [`packages/lib/src/typescript/lib/data/StoreWorker.ts`](packages/lib/src/typescript/lib/data/StoreWorker.ts) | The worker entry, unchanged by this plan. Read it to confirm every reply it sends is structured-cloneable. |
| [`packages/qa/vite/plugins.ts:177-272`](packages/qa/vite/plugins.ts#L177) | `libraryAssetFile` and `qaLibraryPlugin`, the QA app's half of the packaging workaround. |
| [`packages/qa/src/builders/store.ts`](packages/qa/src/builders/store.ts) | `awaitStoreView`, which stays. Read it before step 21 so the wait itself is left alone. |
| [`plans/research/render-review-2026-09-15/01-phase2-status-pass.md`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md) | Places this plan as tier A of ten, shown by the `table-rows` panel. |

---

## Non-Goals

- **Teaching the worker protocol multi-column sort.** The single-sorter reduction at [`AbstractStore.ts:2007-2012`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L2007) is a real correctness gap and its own piece of work. This plan makes the more-correct path the failure path, which does not make the gap more urgent.
- **Bringing a retired worker back.** No probe, no retry, no reset. The page finishes on the main thread, exactly as `ElkLayoutEngine` does.
- **Changing `WORKER_THRESHOLD`.** The constant and its reasoning are untouched; only what happens when the offload behind it fails changes.
- **A `StoreEvent` for the degradation.** See the `console.warn` decision above.
- **Removing `awaitStoreView`.** A working worker still defers the `load` event, so a panel that reads its store still has to wait. Only its comment changes.
- **Loom.** It uses no store and is unaffected.

---

## Notes

[^scope]: All three layers ship together because each leaves the register entry open on its own. With only the packaging fix, today's cause is gone but the failure mode is not: a worker killed by a Content-Security-Policy, an out-of-memory worker thread, or any engine that refuses `blob:` workers still produces the same permanently blank table, because nothing downstream reacts to a worker that stops answering. With only the fail-safe, the library goes on shipping a 2.7 KB file no consumer can load, and every consumer silently loses the feature — the bug becomes invisible instead of fixed. And the fail-safe cannot work without the detection: `applyViewOnWorker`'s `catch` only runs for a *rejection*, and today nothing ever rejects, which is precisely why the view never settles. The three are one behaviour — "the store's worker offload fails safe" — and shipping any two of them ships a half-fix.

[^elk-precedent]: `ElkLayoutEngine.layout`'s own JSDoc states the rule this plan reuses: "The first time a worker-backed engine fails to construct or a layout rejects, rebuilds on the main thread and retries once, so a worker problem never surfaces as a diagram error; that switch to the main thread is permanent for this instance's lifetime, even if a later failure is unrelated to the worker itself." Every design question the store worker raises — fall back or propagate, retry or not, permanent or per-call — is already answered there, so no new pattern is introduced. The one deliberate divergence is where the permanence lives: `ElkLayoutEngine` owns a worker per instance and records the demotion on itself, whereas `StoreWorkerClient` owns one module-level worker shared by every store, so recording it per store would make every other store re-discover the same dead worker.

[^inline]: Vite 8's `?worker&inline` emits the bundled worker source as a JS string in the importing chunk, then `new Worker(URL.createObjectURL(new Blob([source])))`, wrapped in a `try`/`catch` that falls back to `new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(source))`. It applies only to a *bundled* environment: a dev server and Vitest both resolve a non-bundled environment, where `?worker&inline` behaves exactly like today's `?worker` and serves the worker by URL. So the change is invisible to `packages/lib`'s test run and to every dev server, and alters only the two production builds. Two alternatives were rejected. `new Worker(new URL("./StoreWorker.js", import.meta.url))` is the bundler-agnostic spelling, but in a published library the URL resolves against the chunk's own location inside the consumer's `node_modules`, which each consumer's dev server and bundler treat differently and none of which copies the file into the consumer's output — it trades one packaging assumption for a less predictable one. Documenting that apps must copy `dist/lib/assets/` to their web root is impractical for the reason the agenda already gives: the filename carries a build hash that changes on every library release.

[^inline-cost]: The emitted worker is 2,728 bytes (`packages/lib/dist/lib/assets/StoreWorker-B5NwRM2I.js` at `39fa8097`); as a JS string literal it is about the same, since Vite embeds the source text rather than base64. It lands in the chunk holding `StoreWorkerClient` — today `dist/lib/MemoryStore-<hash>.js`, reached from `data.es.js` — so it is downloaded by every consumer of the `./data` subpath, including ones that never hold 1,000 records. Against that: today's separate 2.7 KB request is one no consumer can answer, so the bytes are pure loss. Keeping it lazy by `import()`-ing the inline worker on first need was considered and rejected — it would put a dynamic import inside a published library chunk, which is the fragile case for a consumer's dependency pre-bundling, and it would make `isAvailable()` asynchronous.

[^detection]: The three signals cover three different deaths. An `error` event is what fires when the worker's script fails to load or fails to parse — the measured case, where Vite's SPA fallback answered the request with the page's own HTML and the worker was handed markup instead of JavaScript. A `messageerror` fires when a reply cannot be deserialised; it carries no `requestId`, so nothing else could ever settle the request it belonged to, which is why it retires the client rather than rejecting one entry. Neither fires for a worker that boots and then simply never answers, which is why the startup probe exists: a hung promise and a rejected one are different failures, and only a timer converts the first into the second. The probe is armed once, on the first request, and disarmed by the first reply, so a genuinely long sort of a very large store is never mistaken for a dead script.

[^handshake]: A readiness handshake — the worker posting a `ready` message on boot, the client withholding `isAvailable()` until it arrives — was considered and rejected. `applyView` reads `isAvailable()` synchronously to choose its path ([`AbstractStore.ts:1905`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1905)), and `loadData` reads `_viewAsync` synchronously right after ([`:454`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L454)) to decide whether to emit `load` now or later. Making availability asynchronous would force every store through the deferred path while the answer was outstanding, changing the `load` event's timing for sub-threshold stores that have nothing to do with the worker — a contract change far wider than the bug. Error plumbing plus the probe costs nothing at the decision point and catches the same failures one round trip later, which the per-call fallback already absorbs.

[^one-catch]: Putting the recovery at each call site instead was rejected for reach. Four places consume `applyView()`'s promise, and each loses something different today: `sort` never emits `sortchange`/`datachange`, `clearSort` the same, `applyFilterChange` never emits `filterchange`/`datachange`, and `load()` never runs its `finally`, so `isLoading()` stays `true` forever and the spinner never stops. One `catch` inside `applyViewOnWorker` restores all four, and a fifth caller added later inherits it. `TreeStore.applyView` ([`TreeStore.ts:192`](packages/lib/src/typescript/lib/data/TreeStore.ts#L192)) is a sixth consumer in disguise: it rebuilds its node index inside `super.applyView().then(…)`, which a rejecting promise would skip silently.

[^viewasync]: `_viewAsync` is read exactly once, synchronously, in `loadData` immediately after `ingestRaw` returns. By the time the fallback runs, that read has already happened, so writing the flag from `applyViewInProcess` would be both too late to matter and misleading to the next reader. Keeping the write in `applyView` means the flag continues to mean "this call chose the worker", which is what `loadData` is asking.

[^snapshot-dirty]: Today `_snapshotDirty` is cleared the moment the snapshot is *dispatched*, not when it lands. If that dispatch fails for a reason that does not retire the worker — a record that will not structured-clone, the case `docs/reference/troubleshooting.md:95` warns consumers about — the store has already recorded the worker as holding a snapshot it never received, and the next offload asks it to sort data it does not have. Moving the clear into the snapshot promise's success makes the worker path re-enterable after a non-fatal failure, which it has to be now that a non-fatal failure no longer stops the store dead.

[^warn]: `console.warn` for a silent framework degradation is house style: `Popover.ts:828` warns when an explicit placement overflows and it flips to the other side, `Checkbox.ts:453` when a pre-mount `setSelected` skips its synthetic click, `Card.ts:224` when a named visible component cannot be found. A new `StoreEvent` was rejected on two counts: the payload would arrive after the view is already correct, so there is nothing for a listener to do with it, and it would widen a public union for a condition the consumer cannot influence from application code. The two warnings answer different questions, which is why both exist: the client's says the page has lost its worker, the store's says which store stopped offloading and why — the second is the only signal for a per-request failure that leaves the worker alive.

[^timers]: `data/` imports nothing from `core/` except `ListenerBag`, so it is the one entry point with no DOM dependency at all. `DOM.sink.setTimeout` exists and newer component code uses it, but reaching for it here would pull `core/DOM.ts` into the `./data` chunk for the sake of one timer. The bare global is already the library's other habit — `DockRegion`, `StatusBar`, `MenuItem`, `TabBar` and both `Header` classes all call it directly — and `no-raw-dom` does not flag it: the rule's receiver-less global list covers `getComputedStyle`, `matchMedia` and the animation-frame pair, not timers.

[^await-store-view]: `awaitStoreView` was written because of this bug but is not a workaround for it. A worker that works still makes `loadData` defer its `load` event, so a panel that selects a record or looks up a cell in `afterMount` genuinely has to wait for the view — that is the correct shape and it survives unchanged, along with `packages/qa/tests/store.test.ts`, which pins it. What its 10-second cap guarded against does change: it used to be the only thing anywhere that noticed a worker which never replied, and it is the instrument that found this bug. Keeping it costs nothing and leaves the QA app able to catch a future panel wired against a broken build, so only the comment explaining it is rewritten. The half of the QA app that *is* a workaround is `qaLibraryPlugin`'s `/assets/` middleware and its startup throw, which exist solely to answer a request that stops being made.

---

## Implementation Notes

Five departures from the plan as written; the design is unchanged.

**Step 6 arms the probe after `postMessage`, not before it.** The step places
the probe arm inside the `new Promise` executor after `pending.set(...)` and
before `w.postMessage(message)`. Written that way, a `postMessage` that throws
— a record that will not structured-clone, the case the Architecture Decisions
table's fourth row and `docs/reference/troubleshooting.md:95` both name — leaves
a `pending` entry nothing can ever settle and a probe armed on a message that
never left, so five seconds later a perfectly healthy worker is retired for the
page with the untrue reason "its first request went unanswered". That is the
opposite of the row's own verdict, "kept; the next call tries again". So
`postMessage` is wrapped in a `try`/`catch` that drops the pending entry and
rethrows, and the probe is armed only once the message really is outstanding.
`StoreWorkerClient.test.ts`'s "keeps the worker when a message will not leave
the main thread" pins it.

**Step 11's `_snapshotDirty` move reaches its goal a different way.** The step
asked for the clear to move out of the eager `if` block and into the snapshot
promise's own success. Implemented literally, that breaks two things the eager
clear was quietly doing, both caught by the audit. The clear is no longer tied
to the dispatch, so two offloads overlapping one in-flight snapshot each ship
the whole dataset — a second full structured clone of ≥ 1,000 records on the
one path built for large datasets. Worse, a record added or removed *while* a
snapshot is in flight sets the flag, and the landing snapshot — taken before
that change — then clears it, so the next offload sorts against a snapshot the
worker took before the mutation and the view silently loses the record. Pinning
the dispatched array, the obvious guard, does not help: `add` and `remove`
splice `_allRecords` in place, so its identity never changes.

So `sendSnapshot()` keeps the clear at dispatch, as before, and marks the
snapshot stale again if the dispatch *fails* — which is what footnote
[^snapshot-dirty] actually asks for: a worker path that is re-enterable after a
failure the worker survives. A mutation's own stale mark is then never undone,
because nothing writes the flag on success. Three tests in
`AbstractStore.workerView.test.ts` pin all three cases.

**`dist/lib/assets` survives the build, holding one file.** Step 25 expected
`test ! -d dist/lib/assets` to print `gone`. Vite's `?worker&inline` embeds the
worker's *source* in the importing chunk but still emits that source's
**source map** as a separate asset, so the built tree keeps
`dist/lib/assets/StoreWorker-<hash>.js.map` and nothing else. The substance of
the check holds: the worker's `.js` is gone, `grep -rn "/assets/StoreWorker"
dist/lib/` finds nothing, and the map is referenced only by a relative
`sourceMappingURL` inside the inlined source — devtools material, never
fetched to run the worker. Nothing in the QA app depends on the directory any
more, since step 19 removed the startup check that did.

**`createObjectURL` matches two chunks, not one.** Step 25 expected exactly the
chunk holding `StoreWorkerClient` (`dist/lib/MemoryStore-<hash>.js`, which does
hold the inlined worker and its blob/data-URL construction). The second match
is `dist/lib/Table-<hash>.js`, where `TableExporter.download` builds a blob URL
for a CSV download — pre-existing, unrelated, and untouched by this plan.

**`FakeWorker.terminated` counts rather than flags.** Step 15 called for a
boolean; the Expected Behaviour table's case 2 asks for `terminate()` "called
exactly once", which a boolean cannot distinguish from twice, so the field is a
counter.

One detail step 9 left open: `applyView` carried two stacked JSDoc blocks, the
first of which ("Rebuilds the visible records slice by applying all active
filters and the active sorter", with the null-sorting remark) documented the
body being extracted. It moved onto `applyViewInProcess` with that body rather
than being left behind or duplicated.

The plan's one manual step — `packages/qa/runqa.sh store-worker-fail-safe main
'panel=table-rows'`, the only check that proves the `blob:` worker boots in a
real engine — is **outstanding**, since every QA run opens a full-screen window
and needs the user's go-ahead. Everything else in `## Verification` ran and
passed, including the QA dev server reaching "ready in 132 ms" against a
rebuilt library with no `/assets/` plumbing left.
