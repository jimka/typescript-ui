---
depends-on: [store-worker-fail-safe]
touches-shared:
  - packages/lib/src/typescript/lib/data/StoreWorkerClient.ts
  - packages/lib/src/typescript/lib/data/AbstractStore.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Store-Worker Blob-URL Leak — Implementation Plan

## Overview

Under a Content-Security-Policy that allows neither `blob:` nor `data:` workers, every attempt to start the store's sort/filter worker leaves one object URL behind that nothing ever revokes, and reports two policy violations. The attempts recur: `AbstractStore.applyView` ([`data/AbstractStore.ts:1916`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1916)) asks `StoreWorkerClient.isAvailable()` ([`data/StoreWorkerClient.ts:278`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L278)) on every view rebuild of every store at or above `WORKER_THRESHOLD` ([`:16`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L16)), and `isAvailable()` calls `ensureWorker()` ([`data/StoreWorkerClient.ts:197`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L197)), which tries the construction again each time. A table over the threshold that is sorted, filtered, or mutated pays the cost once per operation, for the life of the page. The view is still built and every event still fires — this is noise and waste, not incorrectness.

The library cannot revoke the URL and cannot skip the second attempt. Both belong to Vite's inline-worker shim, which builds the object URL in a closure, tries `new Worker(objURL)`, falls back to `new Worker("data:…")` inside its own `catch`, and revokes the URL only from an `error` listener it attaches to a worker that, here, was never constructed.[^shim-owns-it] The one lever the library holds is how many times it calls that shim.

So this plan makes the first refused construction the last one: `ensureWorker` retires the client when the `Worker` constructor throws, which makes `isAvailable()` false for the rest of the page and stops every later attempt. One leaked object URL and two violation reports per page replace one and two per `applyView()`. A second, smaller change removes a class of pointless attempt entirely: `applyView` asks `hasCustomSorter()` — a pure check — before it asks `isAvailable()`, the only test in that condition with a side effect.

---

## Architecture Decisions

### A refused construction retires the client

`ensureWorker`'s `catch` calls `retireWorker(...)` instead of returning `null` and leaving the client ready to try again. `isAvailable()` is then false for the rest of the page and nothing constructs a worker a second time. This follows `ElkLayoutEngine.layout` ([`component/diagram/ElkLayoutEngine.ts:446-459`](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L446)), which already treats a refused worker construction — its comment names the CSP block explicitly — as a permanent demotion to the main thread.[^elk-precedent]

### `store-worker-fail-safe`'s "the next call tries to construct it again" is overturned, for a constructor that throws only

[`plans/implemented/store-worker-fail-safe.md`](plans/implemented/store-worker-fail-safe.md) names the blocked-CSP construction and leaves it falling through `ensureWorker`'s `try`/`catch` to "no worker", and the client's own header comment states the consequence as the design — "the next call tries to construct it again" ([`data/StoreWorkerClient.ts:8-19`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L8)). That does not hold under a policy that blocks both schemes: retrying is not free there, and the refusal belongs to the document, so it cannot change while the page lives.[^why-overturn]

The rest of that plan's design is untouched. Retirement is still permanent, a retired worker is still never rebuilt, a per-request failure still keeps the worker, and the in-process path is still the more correct one, so losing the offload costs main-thread time and gains full multi-column sorting.

### A missing `Worker` global stays non-sticky

`ensureWorker`'s `typeof Worker === "undefined"` check is unchanged and still retires nothing. The line between the two cases is what the attempt costs: a runtime with no `Worker` constructs nothing, leaks nothing, and reports nothing, so rediscovering the answer is free.[^no-worker-global]

| Case | Construction runs | Client retired | `console.warn` |
|---|---|---|---|
| `typeof Worker === "undefined"` (node, SSR) | no | no | no |
| Constructor throws (CSP blocks `blob:` and `data:`) | once, ever | yes | once |
| Constructor succeeds | once | no | no |

### `applyView` checks its custom sorter before it asks for a worker

The three conditions at [`AbstractStore.ts:1916`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1916) are reordered so `!this.hasCustomSorter()` is tested before `StoreWorkerClient.isAvailable()`. The result is identical; only the side effect moves. A store that can never use the worker now never asks for one.[^sorter-first]

---

## Internal Structure

### `ensureWorker` after the change

```typescript
function ensureWorker(): Worker | null {
    if (workerRetired) return null;
    if (worker) return worker;
    if (typeof Worker === "undefined") return null;

    try {
        worker = new (StoreWorkerCtor as any)() as Worker;
    } catch (error) {
        // The construction ran and was refused — a Content-Security-Policy
        // allowing neither `blob:` nor `data:` is the case in the field. The
        // refusal belongs to the document, so it cannot change while the page
        // lives, and each attempt costs a `blob:` URL that Vite's shim owns and
        // never revokes. So the first refusal is the last attempt.
        retireWorker(`the Worker constructor threw: ${String(error)}`);

        return null;
    }

    worker.onerror = handleWorkerError;
    // … unchanged from here
```

The `worker = null` that today's `catch` performs is dropped: `retireWorker` ([`:137`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L137)) already nulls it, and its `dead?.terminate()` is a no-op because the assignment never completed.

### `applyView`'s condition after the reorder

```typescript
// `isAvailable()` is tested last because it is the only one of the three with
// a side effect: it constructs the worker. A store that will not use one — too
// few records, or a sorter the worker protocol cannot carry — never asks.
if (this._allRecords.length >= WORKER_THRESHOLD && !this.hasCustomSorter() && StoreWorkerClient.isAvailable()) {
```

---

## Ordered Implementation Steps

1. **`packages/lib/tests/unit/data/StoreWorkerClient.test.ts`** — add a `RefusedWorker` fake beside `FakeWorker` (line 45): a class with a `public static attempts: number = 0;` whose constructor increments it and then throws `new Error("Refused to create a worker from 'blob:…' because it violates the following Content Security Policy directive")`. Add a `describe('StoreWorkerClient construction refused (throwing Worker)')` holding cases 1-5 of *Expected Behaviour*, following the `freshClient()` + `vi.stubGlobal('Worker', …)` shape the neighbouring `describe`s use. Stub `console.warn` with `vi.spyOn` as the retirement `describe` at line 227 does.

2. **Checkpoint** — `cd packages/lib && npx vitest run tests/unit/data/StoreWorkerClient.test.ts` (the targeted form of the `vitest run` behind `npm test`). Cases 2, 3 and 5 must **fail**; cases 1 and 4 already pass, because one call is one attempt either way. If any of the three passes now, it is not testing what it claims.

3. **`packages/lib/src/typescript/lib/data/StoreWorkerClient.ts`** — replace `ensureWorker`'s `catch` (lines 204-207) with the form in *Internal Structure*: bind the caught value as `error`, call `retireWorker` with the message shown, drop the `worker = null` line, keep the `return null`.

4. **`StoreWorkerClient.ts`** — give `ensureWorker` a JSDoc (it has none today), saying it returns the one shared worker, constructing it on first need, and `null` when this runtime has no `Worker` at all or the client has been retired — including by a construction this function itself could not complete. Note in it that the construction is attempted at most once, because a refusal retires the client.

5. **`StoreWorkerClient.ts`** — extend `retireWorker`'s JSDoc (lines 129-136) to cover its new caller: it is also how a construction that was refused is recorded, in which case there is nothing to terminate and no request to reject, and the warning is the whole effect.

6. **`StoreWorkerClient.ts`** — rewrite the module header comment (lines 8-19). The sentence beginning "A worker that cannot be constructed at all" currently folds three cases into one and ends "the next call tries to construct it again"; split it so a runtime with no `Worker` reads as the retryable case and a constructor that throws reads as retirement. Keep the existing paragraph about a worker that was constructed and then proved dead.

7. **`StoreWorkerClient.ts`** — update `isAvailable()`'s JSDoc (lines 271-277): a `false` still means the caller must do the work itself, and add that a construction the runtime refused is not attempted again.

8. **Checkpoint** — `cd packages/lib && npx vitest run tests/unit/data/StoreWorkerClient.test.ts` — every case passes, including the pre-existing ones. Then `grep -n "retireWorker" src/typescript/lib/data/StoreWorkerClient.ts` — expect the definition plus four call sites (the three handlers and the new `catch`).

9. **`packages/lib/tests/unit/data/AbstractStore.workerView.test.ts`** — add case 6 of *Expected Behaviour* to the existing `describe` at line 93, using the same `vi.spyOn(StoreWorkerClient, …)` style; `compareById` and the custom-sorter shape at line 283 are the working example. **The order matters**: apply the custom sorter while the store is still empty, then `loadData` the 1,200 records. A `loadData` first would rebuild the view with no sorter active yet, which reaches `isAvailable()` legitimately and makes the assertion untrue for a reason that has nothing to do with this change. It must fail before step 11.

10. **`packages/lib/tests/unit/data/AbstractStore.workerFailSafe.test.ts`** — add cases 7 and 8 of *Expected Behaviour* as a second `describe`, reusing the file's stub-global-then-`vi.resetModules()`-then-dynamic-import shape. The fake is the `RefusedWorker` from step 1, redeclared locally — the two test files share no module. No fake timers are needed: with `isAvailable()` false the store never leaves the main thread, so `load` fires synchronously inside `loadData`.

11. **`packages/lib/src/typescript/lib/data/AbstractStore.ts`** — reorder the condition at line 1916 to the form in *Internal Structure*, and add the three-line comment above it that says why `isAvailable()` is last.

12. **Checkpoint** — `cd packages/lib && npm run typecheck && npm test`. Cases 1-8, A and B pass and nothing else regresses; `AbstractStore.workerView.test.ts`'s existing snapshot cases in particular still pass, since the reorder changes no boolean result.

13. **`packages/lib/docs/concepts/performance.md`** — line 119 groups "an engine without `Worker`" and "a Content-Security-Policy that forbids one" into one clause; they now behave differently. Split them: a runtime with no `Worker` is silent, while a policy that refuses one is discovered once, warned about once naming the browser's own refusal, and not retried.

14. **`packages/lib/docs/reference/browser-support.md`** — extend the paragraph at line 25. It says a policy allowing neither scheme "is not a failure"; add that the refusal is discovered on the first store that crosses the threshold, reported once through `console.warn`, and never retried.

15. **`packages/lib/docs/reference/troubleshooting.md`** — add one sentence to the paragraph at line 96, listing a construction the browser refuses alongside the other reasons the client retires.

16. **`packages/lib/docs/reference/changelog/next.md`** — add an entry to the `### Data` subsection under `## Fixed` (line 1399), placed after the two existing store-worker entries. Cover: under a policy blocking both `blob:` and `data:` the library retried the construction on every view rebuild of every store over the threshold, each attempt leaving an object URL Vite's worker shim never revokes and reporting two policy violations; the refusal is now recorded the first time and never retried, so a blocked page pays it once and says so once through `console.warn`. State that no consumer action is needed and that the view and its events were, and remain, unaffected.

17. **Checkpoint** — `cd packages/lib && npm run lint && npm run docs:api`, then apply `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/data/StoreWorkerClient.ts` |
| Modify | `packages/lib/src/typescript/lib/data/AbstractStore.ts` |
| Modify | `packages/lib/tests/unit/data/StoreWorkerClient.test.ts` |
| Modify | `packages/lib/tests/unit/data/AbstractStore.workerView.test.ts` |
| Modify | `packages/lib/tests/unit/data/AbstractStore.workerFailSafe.test.ts` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/reference/browser-support.md` |
| Modify | `packages/lib/docs/reference/troubleshooting.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case below is unit-testable offline except the two manual ones at the end, which need a real browser under a real policy: Vite emits the inline-worker shim only for a bundled build, and only a browser enforces a CSP.

### `StoreWorkerClient` — a construction the runtime refuses

The fake is a `Worker` global whose constructor counts its calls and throws.

| # | Given | Then |
|---|---|---|
| 1 | `isAvailable()` called once | Returns `false`, and the constructor ran exactly once |
| 2 | `isAvailable()` called five times | Returns `false` every time, and the constructor ran exactly **once** in total |
| 3 | `isAvailable()` called five times | `console.warn` was called exactly once, with a message carrying the thrown error's text and naming the main-thread fallback |
| 4 | `sortFilter('s', …)` after a refused construction | Rejects with `Worker unavailable` |
| 5 | The global is replaced with a working fake, then `isAvailable()` is called again | Still `false`, and the working fake is never constructed — retirement is permanent |

### `StoreWorkerClient` — the cases that do not change

| # | Given | Then |
|---|---|---|
| A | No `Worker` global at all (the `node` test environment, no stub), `isAvailable()` called; a working fake is then installed and `isAvailable()` called again | `false`, then `true`; `console.warn` was never called |
| B | A working `Worker` global, `isAvailable()` called three times | `true` every time, one instance constructed, `console.warn` never called |

Cases A and B pass today. They are listed because the change must not make them fail: A pins that a missing `Worker` global is still retryable, B that a healthy worker is still cached rather than rebuilt.

### `AbstractStore` — attempts, the view, and its events

| # | Given | Then |
|---|---|---|
| 6 | `isAvailable()` spied; a sorter carrying a `sorterFn` applied while the store is empty, then `loadData` of 1,200 records | The `isAvailable` spy is never called, `getRecords()` holds all 1,200 in the custom sorter's order, and `load` fires once |
| 7 | A real `MemoryStore` loaded with 1,200 records over a global `Worker` whose constructor throws | `getRecords()` holds all 1,200, `load` fires exactly once and synchronously inside `loadData`, and the constructor ran once |
| 8 | Case 7's store, then three `add()` calls (four `applyView()` calls in total) | The constructor still ran exactly **once**; after each `add` the view holds every record; `console.warn` was called once for the whole run |

Case 8 is the reported bug. Before this plan the constructor runs four times, so four object URLs are leaked and eight policy violations reported; after it, one and two. The store's own per-store fallback warning never fires in either case, because with `isAvailable()` false no offload is ever dispatched — the one warning in case 8 is the client's.

### Manual, in a browser under a policy blocking both schemes

| # | Given | Then |
|---|---|---|
| M1 | A built library on a page whose policy allows neither `blob:` nor `data:` workers, a store over the threshold sorted and filtered repeatedly | Exactly two policy violations are reported for the whole page, not two per operation, and one `console.warn` names the browser's own refusal |
| M2 | The same page | The table fills, sorts and filters correctly throughout — the view and its events are identical to a page with no policy, only slower on a large dataset |

---

## Verification

Automated, in order, from `packages/lib`:

1. `npm run typecheck`
2. `npm run lint` — no new reports, and no edit to `scripts/eslint/no-raw-dom.baseline.json`.
3. `npm test` — cases 1-8, A and B.
4. `npm run docs:api` — **no new warnings**. `master` emits 14; that count must not rise. Do not write a zero-warning bar into anything.
5. `npm run build:lib`, then `grep -l "createObjectURL" dist/lib/*.js` — expect exactly the chunk that holds `StoreWorkerClient`. This confirms the inline-worker shim is still the thing constructing the worker; nothing in this plan changes it.

Manual, **optional and only with the user's explicit go-ahead** — a QA run opens a full-screen window on their desktop. The QA app is the right surface: its pages resolve `@jimka/typescript-ui/*` to a *built* `dist/lib` through [`build/libraryBuildAlias.ts`](build/libraryBuildAlias.ts), so the inline shim really runs, and its `table-rows` panel builds 10,000 records ([`packages/qa/src/panels/table-rows.ts:48`](packages/qa/src/panels/table-rows.ts#L48)) with an `update=` driver that sorts, filters and mutates the store repeatedly. What it does not have is a policy: [`packages/qa/src-tauri/tauri.conf.json`](packages/qa/src-tauri/tauri.conf.json) sets `"csp": null` and `packages/qa/index.html` carries no CSP meta, so as it ships the construction succeeds and nothing here is observable.

6. Add `<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws:; worker-src 'none'">` to `packages/qa/index.html`, run `packages/qa/runqa.sh blob-url-leak main 'panel=table-rows&drive=update&update=filter'` — `drive=update` is what makes the run rebuild the view repeatedly, where the panel's default `wheel` only scrolls, and read the console output in the run's Vite log. Expect one `StoreWorker retired` warning and two policy violations for the whole run. **Revert the meta tag afterwards** — it is a probe, not a change this plan ships.

---

## Documentation Impact

No exported symbol changes: `StoreWorkerClient` is internal and is not exported from [`data/index.ts`](packages/lib/src/typescript/lib/data/index.ts), so no entry point, catalog or sidebar entry moves, and `llms.txt` is unchanged. Three consumer-facing pages state the behaviour that changes, and are handled by steps 13-15: `docs/concepts/performance.md`, `docs/reference/browser-support.md` and `docs/reference/troubleshooting.md`. The changelog entry is step 16.

No `migration/next.md` entry: nothing a consumer wrote stops compiling or stops working, and a blocked page keeps building exactly the same views. The one visible difference is a single new console warning on a page that was previously silent about losing the worker.

---

## Potential Challenges

- **Vitest does not use the inline shim.** `?worker&inline` collapses to the plain `?worker` form outside a bundled build, so in tests the shim is a one-line wrapper around the global `Worker`. That is what makes a throwing global `Worker` an exact stand-in for a refused construction — but it also means no test can observe the object URL itself. The tests pin the attempt *count*, which is the only thing this plan changes.
- **Module singletons across the two test files.** `workerRetired` lives at module scope, so a retirement in one case leaks into the next unless the module is reset. Follow `freshClient()` in `StoreWorkerClient.test.ts:14` and the stub-before-`vi.resetModules()` order that `AbstractStore.workerFailSafe.test.ts` documents in its header.
- **The probe CSP may need loosening.** The Vite dev server injects inline scripts and styles and opens a websocket, so a policy tight enough to be interesting can also stop the page loading for unrelated reasons. If the QA page does not render at all, widen everything except `worker-src`, which is the only directive the probe is about.
- **`String(error)` on a `DOMException`.** Browsers throw a `DOMException` here, whose `String()` gives `"SecurityError: …"` — short and exactly the diagnostic wanted. A test's plain `Error` gives `"Error: …"`. Neither needs special handling; do not reach for `instanceof` narrowing.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/data/StoreWorkerClient.ts:8-19`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L8) and [`:128-238`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L128) | The module header stating the decision this plan overturns, plus `retireWorker` and `ensureWorker` — everything steps 3-7 touch. |
| [`packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts:446-459`](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L446) | The precedent: a refused worker construction is a permanent demotion to the main thread. Its comment names the CSP block by hand. |
| [`plans/implemented/store-worker-fail-safe.md`](plans/implemented/store-worker-fail-safe.md) | The decision being revisited. Read its `## Architecture Decisions` before step 3 so the parts that still hold are not disturbed. |
| [`packages/lib/src/typescript/lib/data/AbstractStore.ts:1913-1926`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1913) and [`:2005-2007`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L2005) | `applyView` and `hasCustomSorter`, the reorder in step 11. |
| [`packages/lib/tests/unit/data/AbstractStore.workerFailSafe.test.ts`](packages/lib/tests/unit/data/AbstractStore.workerFailSafe.test.ts) | The stub-global-then-reset-modules shape step 10 reuses; its header comment explains why the order matters. |
| [`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md:189-203`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L189) | The register entry this plan closes. |

---

## Non-Goals

- **Revoking the one object URL that is still leaked.** The library never sees it. Getting hold of it means dropping `?worker&inline` and hand-rolling the blob-and-fallback dance around a pre-bundled worker source, which reimplements the part of Vite this library is happy to depend on.[^shim-owns-it]
- **Avoiding the shim's own `data:` retry.** It sits inside the shim's `catch`, between two statements the library does not write.
- **Feature-detecting the policy before constructing.** No API reports whether a document may start a `blob:` worker; the only test is the construction, which is the thing being counted.
- **Bringing a retired client back, by probe, retry or reset.** Unchanged from `store-worker-fail-safe`.
- **Changing `WORKER_THRESHOLD`, the silence deadline, or the worker protocol.** None of them is involved.
- **Adding a CSP to the QA app.** The meta tag in `## Verification` is a temporary probe that is reverted, not a change this plan ships; a permanent policy there would change what every other QA measurement runs under.

---

## Notes

[^shim-owns-it]: Vite 8's inline-worker shim, emitted by `webWorkerPlugin` for a `?worker&inline` import in a bundled build, is one module-scope `Blob` plus a factory. The factory reads, in order: `objURL = createObjectURL(blob)`; `new Worker(objURL, …)`; `worker.addEventListener("error", () => revokeObjectURL(objURL))`; and, in its `catch`, `new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(jsContent), …)`. Three things follow. `objURL` is a local of a function the library only calls, so nothing outside can revoke it. The revoke is reached only through a listener attached to a worker that, when both schemes are blocked, was never constructed — and the other revoke, `URL.revokeObjectURL(import.meta.url)`, is a line prepended to the worker's own source, which never runs for the same reason. And the `data:` attempt is inside the `catch`, so one call to the factory is always two constructor calls and two violation reports when both schemes are refused. The `Blob` itself is built once at module scope, so the leaked URLs all name one shared ~2.8 KB object: the retained bytes are bounded, and what grows without bound is the number of entries in the document's object-URL store, one per attempt. Owning the URL would mean not using the shim — emitting the worker's bundled source as a string the library itself wraps in a `Blob`. `?raw` cannot do it, because `StoreWorker.ts` imports `matchesFilter` and `compareValues` and so must be bundled first; it would take a build step that duplicates what `webWorkerPlugin` already does, to recover one object URL per page.

[^elk-precedent]: `ElkLayoutEngine.layout`'s `catch` comments its own case as "Worker construction failed (factory threw, `Worker` undefined, CSP block)" and responds by setting `_workerBacked = false`, which is permanent for that engine's lifetime. `store-worker-fail-safe` took `ElkLayoutEngine` as its precedent for every other failure on the store-worker path, and this is the one row of that table it did not copy. Copying it now removes an inconsistency rather than introducing a pattern: the two library subsystems that own a Web Worker treat a refused construction the same way.

[^why-overturn]: `store-worker-fail-safe` did not weigh retrying against retiring for the construction case. Its `## Architecture Decisions` mention the CSP in passing — "`ensureWorker`'s existing `try`/`catch` already turns [it] into 'no worker', and every store then runs in process" — which describes the code that was already there rather than choosing it, and its "no retry" non-goal is about a worker that was *retired*, not one that was never built. What that plan did decide, and what still holds, is that the in-process path is the more correct one, so a page that never gets its worker loses main-thread time and gains full multi-column sorting. Given that, the only thing retrying can buy is an offload on some later call — and nothing about a blocked `blob:` construction changes within a document, because the policy is fixed when the page loads. Set against a cost that was not known then — one unrevocable object URL and two violation reports per view rebuild — retrying buys nothing and charges for it. The narrow scope matters: only a constructor that *ran and threw* retires the client. Everything else `store-worker-fail-safe` decided is left exactly as it is.

[^no-worker-global]: Treating `typeof Worker === "undefined"` the same way would be tidier to describe and worse to live with. It is the ordinary state of the library's own `node` test environment and of any server-side render, where nothing is constructed, nothing is leaked, and no violation is reported — the check is a `typeof` and the answer is free to recompute. Making it sticky would also break the shape every existing test in `StoreWorkerClient.test.ts` relies on, where a module is imported under one global and exercised under another. The rule the plan settles on is narrow and easy to state: the client remembers a failure only when re-discovering it would cost something.

[^sorter-first]: `hasCustomSorter()` ([`AbstractStore.ts:2005`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L2005)) is a `some()` over the active sorters with no side effect, while `isAvailable()` constructs a worker. Evaluating the effectful test first means a store whose sorter carries a `sorterFn` — which can never cross the worker boundary, so the store always runs in process — still pays for a worker on every view rebuild. That is a live cost on an unblocked page too, not only under a policy: the page builds and keeps a worker no store will use. `&&` short-circuits left to right and both operands are pure booleans, so the reordered condition yields the same value for every input; only the construction attempt moves. This is included here rather than left as its own item because the count of construction attempts per `applyView()` is exactly what this plan is about.
