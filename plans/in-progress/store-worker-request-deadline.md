---
touches-shared:
  - packages/lib/src/typescript/lib/data/StoreWorkerClient.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Store Worker Request Deadline — Implementation Plan

## Overview

A store worker that boots, answers once, and then stops answering hangs the
store forever. [`data/StoreWorkerClient.ts:183`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L183)
arms its timer only while `!workerProven`, and the first reply of any kind
sets `workerProven` ([`:138`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L138)),
so no later request is ever timed. An unanswered later request leaves its
`sortFilter` promise unsettled, `applyViewOnWorker`'s `catch`
([`data/AbstractStore.ts:2071`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L2071))
never runs, and `applyView()` never resolves — the table stays empty, `load`
never fires, and nothing is reported anywhere. This is C38 of
[`plans/research/render-review-2026-09-15/01-phase2-status-pass.md`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md).

The fix replaces the one-shot startup probe with a **silence deadline**: how
long the worker may say nothing at all while it still owes a reply. One timer
covers every outstanding request, restarts on every reply, and is sized to the
largest dataset it is waiting on, so a slow sort of a huge store is given room
a small store's request is not. A deadline that expires retires the worker,
exactly as the two `Worker` error events already do.

The change is confined to `StoreWorkerClient.ts` plus its tests and three doc
pages. `AbstractStore` is untouched: its existing `catch` already rebuilds the
view in process the moment a request rejects, whatever rejected it.[^store-untouched]

---

## Architecture Decisions

### Time the worker's silence, not each request separately

The client arms one timer whenever it is owed at least one reply, restarts it
on every reply, and cancels it when nothing is outstanding. `workerProven` and
the one-shot probe are removed.[^why-silence]

The shape is the file's own. `clearProbeTimer`, `handleProbeTimeout` and
`retireWorker` ([`data/StoreWorkerClient.ts:64-118`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L64))
already pair a module-level timer with a named handler that retires the
worker; this plan keeps all three and only widens what arms the timer and how
long it runs.

A Web Worker runs one thread and handles messages in the order they arrive, so
a request queued behind a long one does not start until that one finishes. A
per-request clock started at dispatch would therefore time the backlog rather
than the work, and would expire on a healthy worker that is merely busy. The
silence clock does not: only a reply restarts it, and a reply is proof the
worker's event loop is still turning. A dispatch can *lengthen* the clock,
when it brings a bigger dataset than anything already waiting, but it never
pushes the start forward.

| Sequence | Silence clock | Outcome |
|---|---|---|
| A dispatched; A replied at 1 s | armed at 0 s, cancelled at 1 s | nothing is retired; the clock is cancelled before it can expire |
| A, B dispatched; A replied at 1 s; B replied at 2 s | armed at 0 s, restarted at 1 s, cancelled at 2 s | B's own wait is never measured from its dispatch |
| A, B dispatched; A replied at 1 s; then nothing | armed at 0 s, restarted at 1 s, expires at 1 s + deadline | retired; B is owed and the worker went quiet |
| A dispatched; B dispatched at 1 s; then nothing, both small | armed at 0 s, untouched by B's dispatch | retired at the deadline, not at 1 s + deadline |
| A dispatched over a small store; B over a far bigger one at 1 s; then nothing | armed at 0 s for A's deadline, extended at expiry to B's | retired once B's own deadline has passed since 0 s |

The fourth row is the reason a dispatch never restarts the clock: a page that
keeps dispatching — a table's filter row being typed into, or the QA panel's
`update=filter` driver — would otherwise hold a wedged worker's clock open
forever. The fifth row is why the extension is handled at expiry rather than
by re-arming: a store being filled in batches dispatches a bigger snapshot
each time, and re-arming on each one would starve detection the same way.

### The deadline grows with the dataset

The deadline is `SILENCE_BASE_MS + ceil(records / 1000) × SILENCE_MS_PER_1000_RECORDS`,
with `SILENCE_BASE_MS = 5000` and `SILENCE_MS_PER_1000_RECORDS = 20`, where
`records` is the largest snapshot among the requests currently outstanding.
The per-record allowance is ten times the slowest thing the worker's own code
can do to one record, measured; the base is the merged plan's existing probe
constant, unchanged, now covering boot and queue slack rather than a whole
first request.[^deadline-size]

| Store size | Deadline | Measured cost of the same work on one thread | Margin |
|---|---|---|---|
| 1,000 | 5,020 ms | 5.4 ms | 930× |
| 10,000 | 5,200 ms | 3.9 ms | 1,300× |
| 100,000 | 7,000 ms | 84 ms | 83× |
| 1,000,000 | 25,000 ms | 1,719 ms | 15× |

No deadline is shorter than the 5,000 ms the startup probe allows today, so
the boot failure it replaces is timed exactly as it is now.

### An expired deadline retires the worker

A deadline that expires terminates the worker, rejects every outstanding
request, and makes `isAvailable()` false for the rest of the page — the same
treatment an `error` event and a `messageerror` event already get. It joins
the merged plan's table of failures on the retiring side.[^retire]

Not retiring is the worse trade. A wedged worker that stays in service makes
every later offload pay the full deadline before falling back, so a
1,000,000-record table would sit empty for 25 seconds on every sort, forever.
Retiring pays that once. The cost when the judgement is wrong is bounded and
already documented: the page sorts and filters on the main thread from then
on, with the full multi-column ordering the worker protocol cannot carry.

| What failed | This call's view | The worker afterwards |
|---|---|---|
| The worker script never ran (an `error` event) | built in process | retired for the page |
| A reply could not be decoded (a `messageerror` event) | built in process | retired for the page |
| **The worker answered nothing for the whole deadline while owing a reply** | **built in process** | **retired for the page** |
| One record would not structured-clone (`postMessage` threw) | built in process | kept; the next call tries again |
| The worker replied with an error string | built in process | kept; the next call tries again |

### Nothing is built in process speculatively

The store does not start an in-process build alongside the offload, and does
not consult the deadline when choosing its path. `applyView` keeps the single
test it has today.[^no-race]

Whether the main thread would beat the deadline *is* knowable at dispatch — the
store knows the record count, and the table above shows the main thread
finishing well inside the deadline at every size. It is still the wrong test.
The worker exists to keep that work off the main thread, not to finish it
sooner; an 84 ms in-process sort is 84 ms of frozen UI, where 84 ms of waiting
is not. The deadline is therefore a liveness bound only, and must not be read
as the longest a user should wait for a view.

### A wedged worker cannot be asked whether it is alive

A worker stuck in a loop never returns to its event loop, so it never reads
another message — a ping included. No handshake, `MessageChannel` or shared
buffer changes that, because the worker still has to reach the code that would
answer. Elapsed silence, measured against an allowance sized to the work, is
the only instrument available, which is why this plan adds a deadline rather
than a liveness check.[^liveness]

Today no consumer code runs in the worker at all, so a consumer cannot wedge
it. `filterBy` accepts only a `FilterDescriptor`
([`data/AbstractStore.ts:1530`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1530)),
a closed union of data-only operators
([`data/FilterDescriptor.ts:34-47`](packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L34))
with no function member, and a sorter carrying a `sorterFn` is forced onto the
in-process path by `hasCustomSorter()`
([`:2005`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L2005)). Two
consumer-facing doc pages say the opposite and are wrong; `## Documentation
Impact` corrects them. What remains reachable is the engine killing or
suspending the worker, and a request the worker cannot deserialise — neither
of which fires any event on the main thread.[^reachable]

---

## Internal Structure

### `StoreWorkerClient` module state after the change

```typescript
/**
 * The deadline's fixed part: how long the worker may say nothing before the
 * dataset-sized allowance is added. It covers worker startup and the queue
 * ahead of a request, not the work itself.
 */
const SILENCE_BASE_MS = 5000;

/**
 * The deadline's per-record part, per 1,000 records of the largest snapshot
 * outstanding. Twenty milliseconds per thousand is ten times the slowest
 * thing the worker's own code can do to a record — a locale-aware string sort
 * measured at 1.7 µs per record over a million of them.
 */
const SILENCE_MS_PER_1000_RECORDS = 20;

interface Pending {
    resolve: (indices: number[] | undefined) => void;
    reject: (err: Error) => void;
    /** Records in the snapshot this request works over; sizes the silence deadline. */
    records: number;
}

let worker: Worker | null = null;
let nextRequestId = 1;
const pending: Map<number, Pending> = new Map();

// Set once the worker is proven dead; never cleared, so a retired worker is
// never rebuilt.
let workerRetired = false;

// Armed whenever a reply is owed, restarted by every reply. Null when nothing
// is outstanding.
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
// How long the armed timer will run, and how much silence was already counted
// before it was armed. Their sum is how long the worker has said nothing.
let armedFor = 0;
let quietSoFar = 0;
// Records last snapshotted per store, so a sortFilter can be sized by the
// snapshot it runs over. Never pruned; one number per store.
const snapshotSizes: Map<string, number> = new Map();
```

`workerProven` and `probeTimer` are gone, replaced by `silenceTimer`.

### The four timer functions

```typescript
function clearSilenceTimer(): void {
    if (silenceTimer !== null) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }

    armedFor   = 0;
    quietSoFar = 0;
}

/** The deadline the outstanding set currently warrants, sized by its largest snapshot. */
function silenceDeadlineMs(): number {
    let worst = 0;

    for (const p of pending.values()) {
        if (p.records > worst) {
            worst = p.records;
        }
    }

    return SILENCE_BASE_MS + Math.ceil(worst / 1000) * SILENCE_MS_PER_1000_RECORDS;
}

/**
 * Starts the silence clock when a reply is owed and none is running. A
 * dispatch that joins a stretch of silence already being timed changes
 * nothing here: if it warrants a longer deadline than the one armed, it is
 * given the difference when that one expires.
 */
function armSilenceTimer(): void {
    if (silenceTimer !== null || pending.size === 0) {
        return;
    }

    quietSoFar   = 0;
    armedFor     = silenceDeadlineMs();
    silenceTimer = setTimeout(handleSilenceTimeout, armedFor);
}

/**
 * Retires a worker that has said nothing for the whole deadline while owing a
 * reply — unless a bigger request joined after the clock started, which is
 * given the rest of its own allowance first.
 */
function handleSilenceTimeout(): void {
    silenceTimer = null;

    const quiet  = quietSoFar + armedFor;
    const wanted = silenceDeadlineMs();

    if (wanted > quiet) {
        quietSoFar   = quiet;
        armedFor     = wanted - quiet;
        silenceTimer = setTimeout(handleSilenceTimeout, armedFor);

        return;
    }

    retireWorker(`it answered nothing for ${quiet}ms with ${pending.size} outstanding`);
}
```

`handleSilenceTimeout` builds `quiet` before calling `retireWorker`, which
clears both counters. Because the extension is applied at expiry, a dispatch
never moves the clock's start — the total silence a retirement reports is
measured from the last reply, whatever joined in between.

`handleSilenceTimeout` needs no empty-`pending` guard: the timer is armed only
while a reply is owed, and every path that empties `pending` either cancels
the timer (retirement) or cancels and re-arms it (a reply). A dispatch whose
`postMessage` throws removes only its own entry, which cannot be the entry
that armed the timer.

### The reply handler after the change

```typescript
worker.onmessage = (e: MessageEvent<Response>) => {
    const { requestId, indices, error } = e.data;
    const p = pending.get(requestId);

    if (p) {
        pending.delete(requestId);
    }

    // Any reply proves the worker's event loop is still turning, including one
    // whose requestId is unknown, so the clock restarts for whatever is left.
    clearSilenceTimer();
    armSilenceTimer();

    if (!p) {
        return;
    }

    if (error) {
        p.reject(new Error(error));
    } else {
        p.resolve(indices);
    }
};
```

The delete happens before the restart so `silenceDeadlineMs()` sizes itself on
what is still owed.

### `send` carries the size

```typescript
function send(message: any, records: number): Promise<number[] | undefined> {
    const w = ensureWorker();
    if (!w) {
        return Promise.reject(new Error("Worker unavailable"));
    }

    const requestId = nextRequestId++;
    message.requestId = requestId;

    return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject, records });

        try {
            w.postMessage(message);
        } catch (error) {
            // The message never left — a record that will not structured-clone
            // is the usual cause. That settles this request and nothing else:
            // the worker is healthy, so drop the entry rather than leave one
            // behind that only a retirement could ever reject.
            pending.delete(requestId);

            throw error;
        }

        // Armed only once a request is really outstanding, so a message that
        // never left cannot expire the deadline and retire a healthy worker.
        armSilenceTimer();
    });
}
```

The two public methods supply the size:

```typescript
snapshot(storeId, records) {
    snapshotSizes.set(storeId, records.length);

    return send({ type: "snapshot", storeId, records }, records.length).then(() => undefined);
},

sortFilter(storeId, sort, filter) {
    return send({ type: "sortFilter", storeId, sort, filter }, snapshotSizes.get(storeId) ?? 0)
        .then(idx => idx ?? []);
},
```

A `sortFilter` for a store with no recorded snapshot gets `0`, so the base
deadline alone — today's behaviour. `applyViewOnWorker` always snapshots
before its first `sortFilter` (`_snapshotDirty` starts `true`), so that is a
guard, not a path.

---

## Ordered Implementation Steps

Steps 1-3 are the red half of the red-green cycle and must be seen to fail
before step 4 is applied.

1. **`packages/lib/tests/unit/data/AbstractStore.workerFailSafe.test.ts`** —
   extend `SilentWorker` (line 22) so a test can answer one request: add
   `public static instances: SilentWorker[] = []`, push `this` from a
   constructor, and add
   `reply(data: any): void { this.onmessage?.({ data } as MessageEvent<any>); }`.
   Rename its doc comment from "answers none of them" to "answers only what a
   test answers for it". Keep the static `posted` and `terminated` counters and
   reset `instances` alongside them.

2. **`AbstractStore.workerFailSafe.test.ts`** — rename the `PROBE_TIMEOUT_MS`
   constant (line 19) to `SILENCE_BASE_MS`, keep the value `5000`, and add
   `const SILENCE_MS_PER_1000_RECORDS = 20;` beside it with a comment mirroring
   the client's. Change the existing case's single
   `advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)` (line 77) to
   `advanceTimersByTimeAsync(SILENCE_BASE_MS + 2 * SILENCE_MS_PER_1000_RECORDS)`
   — 1,200 records rounds up to two thousands, so the deadline is 5,040 ms and
   the old 5,000 ms advance no longer reaches it.

3. **`AbstractStore.workerFailSafe.test.ts`** — add the C38 regression case
   from `## Expected Behaviour` (case 16): the worker answers the snapshot and
   then nothing. It must fail before step 4 — today it hangs the store and the
   assertions on `getRecords()` and `load` never see anything.

4. **`packages/lib/src/typescript/lib/data/StoreWorkerClient.ts`** — replace
   the `WORKER_PROBE_TIMEOUT_MS` constant and its JSDoc (lines 38-46) with
   `SILENCE_BASE_MS` and `SILENCE_MS_PER_1000_RECORDS` from *Internal
   Structure*, keeping each one's comment.

5. **`StoreWorkerClient.ts`** — add `records: number` to `Pending` (lines
   33-36) with its comment; replace `workerProven` and `probeTimer` (lines
   55-58) with `silenceTimer`, `armedFor`, `quietSoFar` and `snapshotSizes`
   from *Internal Structure*.

6. **`StoreWorkerClient.ts`** — replace `clearProbeTimer` (lines 60-69) with
   `clearSilenceTimer`, and add `silenceDeadlineMs()` and `armSilenceTimer()`
   beside it, per *Internal Structure*. Update `retireWorker`'s call at line 85
   to `clearSilenceTimer()`.

7. **`StoreWorkerClient.ts`** — replace `handleProbeTimeout` (lines 115-118)
   with `handleSilenceTimeout` per *Internal Structure*, keeping it a named
   module-level function per ARCHITECTURE.md's *Listeners must reference a
   named function*. Leave `handleWorkerError` and `handleWorkerMessageError`
   untouched.

8. **`StoreWorkerClient.ts`** — rewrite the `onmessage` handler body (lines
   135-152) to the form in *Internal Structure*. The `pending.delete` must
   precede the timer restart.

9. **`StoreWorkerClient.ts`** — give `send` its second parameter and swap the
   arm block (lines 183-185) for a bare `armSilenceTimer()`, per *Internal
   Structure*. Then update `snapshot` (line 205) and `sortFilter` (line 215) to
   pass the size, per *Internal Structure*.

10. **`StoreWorkerClient.ts`** — rewrite the file header comment's last
    sentence (lines 13-16): the third retiring signal is no longer "its first
    request went unanswered" but "it answered nothing for the whole deadline
    while a reply was owed". Add one sentence saying the deadline grows with
    the dataset.

11. **Checkpoint** — `cd packages/lib && npm run typecheck`, then
    `grep -n "workerProven\|probeTimer\|WORKER_PROBE_TIMEOUT_MS" src/typescript/lib/data/StoreWorkerClient.ts`
    — expect zero matches.

12. **Checkpoint** — `cd packages/lib && npx vitest run tests/unit/data/AbstractStore.workerFailSafe.test.ts`
    — both cases in the file pass, including step 3's, which failed before
    step 4.

13. **`packages/lib/tests/unit/data/StoreWorkerClient.test.ts`** — rename
    `PROBE_TIMEOUT_MS` (line 199) to `SILENCE_BASE_MS`, keep `5000`, and add
    `const SILENCE_MS_PER_1000_RECORDS = 20;`. `RETIRED_MESSAGE` (line 202) is
    unchanged — every retirement still ends with the same tail.

14. **`StoreWorkerClient.test.ts`** — **delete** the case "stops timing
    requests once the worker has answered one" (lines 258-284). It pins the
    C38 defect as intended behaviour and cannot be adapted.

15. **`StoreWorkerClient.test.ts`** — add cases 3b-3f from `## Expected
    Behaviour` to the same `describe`; 3a is the existing "retires the worker
    when its first request goes unanswered" case and stays as it is. A large
    snapshot is built as `new Array(1_000_000)` — the client reads only
    `records.length`, and a sparse array costs nothing.

16. **Checkpoint** — `cd packages/lib && npm test && grep -rn "PROBE_TIMEOUT_MS" tests/`
    — the tests pass and the `grep` finds nothing.

17. **Documentation** — apply `## Documentation Impact`.

18. **Final check** — `cd packages/lib && npm run lint`, with no new reports
    and no edit to `scripts/eslint/no-raw-dom.baseline.json`; then
    `npm run docs:api` with no rise in the warning count.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/data/StoreWorkerClient.ts` |
| Modify | `packages/lib/tests/unit/data/StoreWorkerClient.test.ts` |
| Modify | `packages/lib/tests/unit/data/AbstractStore.workerFailSafe.test.ts` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/reference/troubleshooting.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case is unit-testable offline; the timing cases reach their deadline
with `vi.useFakeTimers()`. Nothing here needs a rendered pixel and nothing
needs a QA panel run.

### `StoreWorkerClient` — the silence deadline

Cases 1, 2, 3a and 4-7 already exist in
`tests/unit/data/StoreWorkerClient.test.ts` and must keep passing, with only
step 13's constant rename touching them; 3b-3f are new. All use the existing
`FakeWorker`.

| # | Given | Then |
|---|---|---|
| 1 | Two requests in flight, the worker fires `error` | Both reject, with a message naming the main-thread fallback |
| 2 | The worker has fired `error` | `isAvailable()` is `false` and `terminate()` was called exactly once |
| 3a | One `sortFilter` sent, no snapshot ever sent, the clock advances 5,000 ms | It rejects and `isAvailable()` becomes `false` (the existing "retires the worker when its first request goes unanswered" case) |
| 3b | A 100,000-record snapshot replied to, then a `sortFilter` sent; the clock advances 5,000 ms, then 2,000 ms more | Still pending and available at 5,000 ms; rejected and unavailable at 7,000 ms |
| 3c | Two requests sent; the first replied to at 4,000 ms; the clock then advances 5,000 ms more | The second rejects at 9,000 ms, not at 5,000 ms — the reply restarted the clock |
| 3d | A `sortFilter` on a store with no snapshot sent, then at 1,000 ms a 1,000,000-record snapshot for another store | Neither has rejected at 5,000 ms; both reject at 25,000 ms — the bigger request extended the deadline, measured from 0 ms and not from its own dispatch |
| 3e | One request sent at 0 ms and a second at 4,000 ms, both on a store with no snapshot; the clock advances to 5,000 ms | Both reject — a dispatch of the same size does not restart the clock |
| 3f | No request ever sent; the clock advances 60,000 ms | `isAvailable()` is `true` and `terminate()` was never called |
| 4 | The worker replies `{ requestId, error: "boom" }` | That one request rejects; `isAvailable()` stays `true`; no `terminate()` |
| 5 | The worker fires `messageerror` | As cases 1 and 2 |
| 6 | A `postMessage` throws, then the clock advances 10,000 ms | `isAvailable()` stays `true`, nothing was terminated, and no warning was emitted |
| 7 | The worker is retired, then `sortFilter` is called again | It rejects with `Worker unavailable`, and no second `Worker` is constructed |

### The C38 regression case

| # | Given | Then |
|---|---|---|
| 16 | A real `MemoryStore` of 1,200 records over a stubbed global `Worker`; the snapshot request is answered, the `sortFilter` that follows is not; the clock advances 5,040 ms | `getRecords()` holds all 1,200, `load` fired exactly once with the full view, and the worker was terminated once |

Case 16 is C38. Before this plan the worker is proven by the snapshot reply,
nothing times the `sortFilter`, and the store's view stays empty however far
the clock advances.

The existing end-to-end case — a worker that answers nothing at all — keeps
its shape and only its advance changes, from 5,000 ms to 5,040 ms.

---

## Verification

Automated, in order:

1. `cd packages/lib && npm run typecheck`
2. `cd packages/lib && npm run lint` — no new reports, and
   `scripts/eslint/no-raw-dom.baseline.json` needs no edit.
3. `cd packages/lib && npm test` — every case in `## Expected Behaviour`.
4. From the repository root,
   `grep -rn "workerProven\|probeTimer\|PROBE_TIMEOUT" packages/lib/src packages/lib/tests`
   — expect zero matches.
5. `cd packages/lib && npm run docs:api` — **no new warnings**. `master` emits
   14; that count must not rise.
6. `cd packages/lib && npm run build:lib` — the build must succeed; the worker
   packaging is untouched by this plan.
7. `cd packages/qa && npm run typecheck && npm test` — the QA package imports
   nothing from the client, so this is a guard against an accidental spill.

No manual step. The one claim the merged plan could not settle offline —
whether the inlined `blob:` worker boots in a real engine — was settled on
2026-09-20 and recorded in `packages/qa/README.md`'s `table-rows` row; this
plan changes no packaging and re-opens nothing.[^no-qa-run]

---

## Documentation Impact

`StoreWorkerClient` is internal and is not exported from
[`data/index.ts`](packages/lib/src/typescript/lib/data/index.ts), so no entry
point, catalog or sidebar entry moves and `llms.txt` is unchanged. Three
consumer-facing pages describe behaviour that changes, and two of them carry a
factual error about the same boundary that this plan's investigation
disproved.

- [`packages/lib/docs/concepts/performance.md:99`](packages/lib/docs/concepts/performance.md#L99)
  — replace "or its first request goes unanswered" with the deadline: a worker
  that answers nothing for the whole deadline while a reply is owed is retired.
  Add one sentence saying the deadline grows with the dataset, so a long sort
  of a very large store is not mistaken for a dead script.
- [`packages/lib/docs/concepts/performance.md:101-103`](packages/lib/docs/concepts/performance.md#L101)
  — **delete the "Filter functions are serialised" warning box.** It tells
  consumers to pass pure predicate functions to `filterBy`, which takes only a
  `FilterDescriptor`; no function has ever crossed the boundary. Replace it
  with one plain sentence in the body: filters cross as `FilterDescriptor`
  values, and a sorter carrying a `sorterFn` keeps its store on the main thread.
- [`packages/lib/docs/reference/troubleshooting.md:92-94`](packages/lib/docs/reference/troubleshooting.md#L92)
  — line 92 says the worker receives "the data and predicate"; it receives data
  only. Delete the "Custom filter functions are not transferable" bullet for
  the same reason and keep the non-cloneable-records bullet, which is true.
  Add what a worker that stops answering now does.
- [`packages/lib/docs/reference/changelog/next.md:889`](packages/lib/docs/reference/changelog/next.md#L889)
  — the `### Data` entry under `## Fixed` already describes the fail-safe. Add
  a second entry, not an edit to the first: a worker that answered at least one
  request and then stopped was not detected, so a store could still stay empty
  for the life of the page; every request is now timed, the allowance grows
  with the dataset, and a worker that goes quiet is retired. Say plainly that
  no consumer action is needed.

[`packages/lib/docs/reference/browser-support.md:20`](packages/lib/docs/reference/browser-support.md#L20)
is unchanged: nothing about engine support moves.

---

## Potential Challenges

- **The existing end-to-end test breaks on an arithmetic detail.** 1,200
  records rounds up to two thousands, so its deadline is 5,040 ms and the
  current 5,000 ms advance falls 40 ms short. Step 2 fixes it; a run of
  `AbstractStore.workerFailSafe.test.ts` alone catches it immediately.
- **Fake timers and promises together.** Reaching a deadline needs
  `await vi.advanceTimersByTimeAsync(...)`, not the synchronous
  `advanceTimersByTime`, or the promise chain behind the rejection never
  drains. Case 16 also needs a drained microtask turn between the snapshot
  reply and the `sortFilter` dispatch, since `applyViewOnWorker` chains them.
- **Rejections must have their assertion attached before the clock moves.**
  The existing "retires the worker when its first request goes unanswered"
  case shows the pattern: build the `expect(...).rejects` promise first, then
  advance, then await it. A rejection produced by a timer with no handler yet
  attached is momentarily unhandled.
- **`snapshotSizes` is never pruned.** One number per store id, for the life
  of the page — the same shape the worker's own `snapshots` map already has,
  and negligible beside it.
- **A size recorded for a snapshot that never left.** `snapshot()` records the
  size before `postMessage`, so a dispatch that throws leaves a size for data
  the worker never received. It only sizes a timeout, and the store's
  `_snapshotDirty` flag makes the next offload re-send and overwrite it.

---

## Critical Files

| File | Why |
|---|---|
| [`plans/implemented/store-worker-fail-safe.md`](plans/implemented/store-worker-fail-safe.md) | The merged plan this one builds on. Its Architecture Decisions set the retirement model, the per-call fallback, and the rule that the in-process path is the more correct one — all preserved here. Only its one-shot probe is revised. |
| [`packages/lib/src/typescript/lib/data/StoreWorkerClient.ts`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts) | The whole source change. Read `retireWorker`, `ensureWorker` and `send` end to end before step 4. |
| [`packages/lib/src/typescript/lib/data/AbstractStore.ts:2042-2121`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L2042) | `applyViewOnWorker`, `sendSnapshot` and `fallBackToInProcessView` — the caller this plan does not change. Read them to see why a rejection is already enough. |
| [`packages/lib/tests/unit/data/StoreWorkerClient.test.ts:204-348`](packages/lib/tests/unit/data/StoreWorkerClient.test.ts#L204) | The retirement `describe` and its `FakeWorker`. Every new client case extends this machinery; nothing new is built. |
| [`packages/lib/tests/unit/data/AbstractStore.workerFailSafe.test.ts`](packages/lib/tests/unit/data/AbstractStore.workerFailSafe.test.ts) | The end-to-end harness: stub the global `Worker`, then `vi.resetModules()`, then dynamic-import the store, so both halves share one module graph. |
| [`packages/lib/src/typescript/lib/data/StoreWorker.ts`](packages/lib/src/typescript/lib/data/StoreWorker.ts) | The worker entry, unchanged. Read it to confirm what runs there is library code only, and that its `try`/`catch` turns a throw into an error reply rather than silence. |
| [`packages/lib/src/typescript/lib/data/FilterDescriptor.ts:34-47`](packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L34) | The closed union that disproves the two doc pages' claim about predicate functions. |

---

## Non-Goals

- **Reviving a retired worker.** No re-check, no retry, no second `Worker`. The
  page finishes on the main thread, as `ElkLayoutEngine` does and as the
  merged plan decided.
- **A readiness handshake.** Rejected by the merged plan because
  `isAvailable()` is synchronous; nothing here changes that.
- **Handling `messageerror` inside the worker.** `StoreWorker.ts` sets only
  `self.onmessage`, so a request it cannot deserialise is dropped in silence.
  Adding `self.onmessageerror` would not help: the undecodable message carries
  no `requestId`, so no reply could settle the right request, and any reply it
  did post would restart the silence clock and hide the very hang this plan
  detects.
- **Pruning the worker's `snapshots` map.** `StoreWorker.ts:50` never deletes
  a store's snapshot, so a page that creates and discards stores leaks whole
  datasets inside the worker. Real, unrelated to timing, and its own piece of
  work.
- **Teaching the worker protocol multi-column sort.** Unchanged from the
  merged plan's non-goal.
- **Timing anything in `AbstractStore`.** One owner for the deadline; two
  would race and could land a stale worker result over a finished in-process
  view.
- **Changing `WORKER_THRESHOLD` or the QA app.** Neither is touched.

---

## Notes

[^store-untouched]: `applyViewOnWorker` ends in `.catch((error: unknown) => this.fallBackToInProcessView(error))` ([`AbstractStore.ts:2071`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L2071)), which warns once and rebuilds the view in process, returning nothing so the chain resolves. A deadline rejection is just another rejection, so every consumer of `applyView()` — `sort`, `clearSort`, `applyFilterChange`, `load()` and `TreeStore.applyView` — recovers with no change. Putting the timing in the store instead was rejected for a concrete hazard: a store-side `Promise.race` leaves the losing worker promise pending, so a late reply would still run the `.then(indices => …)` at [`:2061`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L2061) and overwrite the finished in-process view with the worker's primary-sorter-only ordering. The client has no such hazard, because retirement deletes the pending entry and terminates the worker, and the existing `if (!p) return;` at [`StoreWorkerClient.ts:143`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L143) already drops a reply nothing is waiting for.

[^why-silence]: Three shapes were considered. A per-request clock started at dispatch is the obvious one and is wrong: the worker serves messages in order, so request N's wall clock includes every request ahead of it, and a burst — `table-rows`' own `update=filter` driver issues one `setFilter` per unit, each a fresh `sortFilter` — would expire the deadline on a worker that is healthy and busy. A per-request clock started when the request reaches the front of the queue is right in principle but unobservable from the main thread: nothing reports when the worker picks a message up. Silence since the last reply needs no such report. It is also a strict generalisation of what shipped: with one request outstanding and no reply yet, it is exactly the old startup probe, which is why the merged plan's boot-failure case keeps passing unchanged. The one asymmetry to be deliberate about is that a *dispatch* does not restart the clock while a *reply* does — a dispatch is the main thread talking, and only the worker talking is evidence about the worker.

[^deadline-size]: The per-record allowance is anchored to measurement rather than taste. The worker's code does three things to a record: deserialise it out of a structured clone, evaluate a `FilterDescriptor` against it, and compare it under `compareValues`. Timed on this machine under Node v25.9.0 over the shape `table-rows` generates — 1,000 / 10,000 / 100,000 / 1,000,000 records — a locale-aware string sort took 5.4 / 3.9 / 84.2 / 1,719.3 ms, a `contains` filter 0.1 / 0.3 / 22.7 / 49.9 ms, and a structured clone 0.9 / 12.1 / 114.8 / 1,131.7 ms. The 1,000-record sort exceeds the 10,000-record one because it carries the just-in-time compiler's warm-up; the three larger figures are the ones the allowance is read off. The locale sort dominates and costs about 1.7 µs per record at a million, where `localeCompare` is slowest per record; the filter and the clone are both cheaper. Twenty milliseconds per thousand records is 20 µs per record — roughly ten times the worst of those — which leaves at least a tenfold margin at every size in the table and far more below 100,000. Two alternatives were rejected. A single fixed constant large enough for the biggest store (a minute, say) would leave a 10,000-row table empty for a minute when its worker dies, which is most of the failure it is meant to bound. An adaptive rate derived from the worker's own completed requests was rejected twice over: the request that most needs a generous deadline is the first one on a large store, which by definition has no history, and a deadline that depends on what ran before it makes a false retirement depend on request order and so irreproducible. The engine is slower than Node here — WebKitGTK is the repo's own measured worst case — which the tenfold margin is sized to absorb; the margin is not a safety factor against the formula being wrong so much as against the device being slow.

[^retire]: The merged plan's table splits failures into those that prove the *worker* dead and those that prove only *this request* bad. A timeout genuinely sits between them, and the deciding argument is what each mistake costs. Treating it as per-request — reject, fall back, keep the worker — means a wedged worker is rediscovered on every later offload, each time after the full deadline, so the store's view goes stale for 5 to 25 seconds on every sort and filter for the life of the page, which is close to the original symptom with a slow clock attached. Treating it as fatal costs a false positive its worker: one slow sort and the page sorts on the main thread from then on. That cost is bounded, already documented, and *gains* correctness, since the in-process path applies every active sorter where the worker protocol carries only the primary one. The size-scaled allowance is what makes the false positive unlikely enough to accept; without it, retiring on a fixed 5 seconds would demote any store big enough to take longer than five seconds legitimately, which today's one-shot probe already risks on its first request.

[^no-race]: Starting the in-process build alongside every offload would pay the main-thread cost the worker exists to avoid, on every request, which is the same as deleting the worker — so a race is not a cheaper deadline, it is the absence of one. Consulting the deadline at dispatch to decide the path was also rejected: the store would have to predict its own sort cost, and the prediction it could make (record count times a rate) is the same guess the deadline already encodes, applied to the wrong question. The one thing the comparison does establish is worth stating in the body: since the main thread beats the deadline at every size in the table, the deadline is not a promise about how soon a view appears.

[^liveness]: This is a real limit, not a gap in the design. A worker blocked inside a loop never yields to its event loop, so every later message — including a ping — sits in its queue unread; the reply that would prove liveness is exactly what a wedged worker cannot produce. Nor does shared memory help, since the worker must still reach the instruction that writes the flag. The only signals a main thread gets for free are the two `Worker` error events, and neither fires for a worker that is merely stuck or that the engine killed. So elapsed silence is the whole instrument, and the only design freedom left is how much silence to allow — which is what the size-scaled deadline decides.

[^reachable]: C38's register entry gives a non-terminating consumer predicate as the reachable trigger, citing `filterBy`. Checked against source, that trigger does not exist: `filterBy`'s parameter is a `FilterDescriptor` ([`FilterDescriptor.ts:34-47`](packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L34)), a closed union whose every member is plain data, and `hasCustomSorter()` keeps a `sorterFn` off the worker entirely. The nearest thing a consumer can build is a *cyclic* descriptor — structured clone preserves cycles, so `f.filter = f` reaches the worker — but that makes `matchesFilter` recurse until the stack overflows, and `StoreWorker.ts`'s own `try`/`catch` turns the `RangeError` into an error reply. It settles. What stays reachable is the engine terminating or suspending the worker under memory pressure or a backgrounded tab, which fires no event on the main thread, and a request the worker cannot deserialise, which `StoreWorker.ts` does not handle at all. The defect and its fix are unchanged by the correction — a request that is never answered is a request that is never answered — but the two doc pages that assert the predicate capability are wrong and are corrected here rather than left standing next to a rewritten paragraph about the same boundary.

[^no-qa-run]: `packages/qa/src/panels/table-rows.ts` remains the witness: at 10,000 rows its store takes the worker path, and its `afterMount` cannot reach its element lookups until the view exists, so an empty store fails the panel. It needs no run for this plan. The packaging is untouched, and `packages/qa/README.md`'s `table-rows` row already records that the inlined worker boots and the 10,000-record store builds its view under WebKitGTK. Everything this plan adds is a timer, which fake timers reach offline and a real run could only reach by waiting out a real deadline against a worker deliberately broken — which is what case 16 does in milliseconds.

---

## Implementation Notes

Three departures from the plan as written, none of them design changes:

- **The client's new cases were written before the source change, not after
  it.** `## Ordered Implementation Steps` puts steps 13-15 (the
  `StoreWorkerClient.test.ts` rename, deletion and new cases) after the source
  edit, which would have meant cases 3b-3f passing the moment they were first
  run. They were written with steps 1-3 instead, so every new case was seen
  failing first: case 16 left the store's view empty at 1,200 records, 3b and
  3c never settled at all (nothing times a request once the worker has
  answered one), and 3d retired the worker at 5,000 ms with a million-record
  snapshot outstanding. 3e and 3f pass both before and after, as expected —
  they guard behaviour the old probe happened to share.
- **Two test names in `AbstractStore.workerFailSafe.test.ts` were widened.**
  The file's `describe` said "when the worker never answers" and its first
  case "after the probe expires"; with case 16 added, neither was true of the
  file any more. They now read "when the worker stops answering" and "after
  the silence deadline expires". No assertion changed.
- **`sortFilter`'s JSDoc gained a `@remarks` block** saying the request is
  sized by the snapshot it runs over, and that a store with no snapshot is
  sized at zero. *Internal Structure* states both in prose; this puts them
  where a reader of the method will find them.

One verification note: `packages/qa`'s tests resolve `@jimka/typescript-ui`
through the built `dist/lib`, so `## Verification` step 7 needs step 6's
`npm run build:lib` to have run first in a fresh worktree. Run in that order
both pass — 12 files, 244 cases.
