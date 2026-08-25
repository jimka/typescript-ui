# Row-Ops Benchmark Suite — Implementation Plan

## Overview

Extend the existing in-browser benchmark class at [packages/lib/src/typescript/perf/Benchmark.ts:10](packages/lib/src/typescript/perf/Benchmark.ts#L10) with six row-mutation benchmarks — append a batch, update every Nth record, select a row, re-sort, remove one record, clear all records — plus a committed baseline and a regression check that warns when an op's mean time drifts more than 15% past that baseline.

Every method keeps the file's existing shape: a `static` method on `Benchmark`, in-page `performance.now()` sampling, an offscreen 600×400 host mounted under `document.body` and removed at the end, and a `console.log` line tagged `[bench:<op>]`. The new work also makes each method return a structured `BenchResult` so `benchAll()` can hand a full run to the baseline check.

Two files are touched: `Benchmark.ts` and a new `perf/baseline.ts`. Nothing outside `packages/lib/src/typescript/perf/` changes — `main.ts` already exposes the class as `window.bench` at [packages/lib/src/typescript/main.ts:43](packages/lib/src/typescript/main.ts#L43), which is the only entry point this feature needs.

---

## Architecture Decisions

### Six new ops on the existing class, no new module structure

The six ops become six more `static` methods on `Benchmark`, sharing two new private helpers (`mountTable`, `summarize`). They follow the precedent set by [`benchTablePoolGrow`](packages/lib/src/typescript/perf/Benchmark.ts#L192): loop `iterations` times, collect one `performance.now()` delta per iteration into a `samples` array, then report mean/median/max.[^why-poolgrow-precedent]

### The mutation API is `store.add` / `record.set` / `store.remove` / `store.removeAll`

These are the real entry points, confirmed against the store source and against the store's own tests.

| Op | Call | Sync? |
|---|---|---|
| append a batch | `store.add(rows)` → [AbstractStore:788](packages/lib/src/typescript/lib/data/AbstractStore.ts#L788) | returns synchronously; the view rebuild it kicks off may not be |
| update a field | `record.set(field, value)` → [ModelRecord:153](packages/lib/src/typescript/lib/data/ModelRecord.ts#L153) | fully synchronous; no view rebuild at all |
| select a row | `table.selectRecord(record)` → [Table:1027](packages/lib/src/typescript/lib/component/table/Table.ts#L1027) | fully synchronous |
| re-sort | `await store.sort(field, dir)` → [AbstractStore:1422](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1422) | returns a promise that settles after the re-render |
| remove one | `store.remove(record)` → [AbstractStore:860](packages/lib/src/typescript/lib/data/AbstractStore.ts#L860) | returns synchronously |
| clear all | `store.removeAll()` → [AbstractStore:889](packages/lib/src/typescript/lib/data/AbstractStore.ts#L889) | returns synchronously |

`record.set` needs no explicit notify: it calls the store's `notifyRecordChanged` itself ([ModelRecord:352](packages/lib/src/typescript/lib/data/ModelRecord.ts#L352)), which emits `'update'` and `'datachange'` ([AbstractStore:940](packages/lib/src/typescript/lib/data/AbstractStore.ts#L940)); the table body listens to `'datachange'` and re-renders ([Body:452](packages/lib/src/typescript/lib/component/table/Body.ts#L452), [Body:474](packages/lib/src/typescript/lib/component/table/Body.ts#L474)). So one `set()` costs one full window re-render.[^set-notify-chain]

### "Swap two rows" is replaced by a sort benchmark

This library has no API that swaps or moves two records. Row order is derived: the store's view is rebuilt from its active filters and sorters by `applyView()` ([AbstractStore:1907](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1907)), and the only public way to change that order is `sort()` / `clearSort()`. `benchStoreSort` therefore takes the reorder slot.[^no-swap-api]

### No `benchCreateRows` — `benchTablePoolGrow` already is it

`Table` virtualizes, so "create 10,000 rows" never creates 10,000 rows of DOM; it grows a viewport-sized row pool. That is exactly what [`benchTablePoolGrow`](packages/lib/src/typescript/perf/Benchmark.ts#L192) already times. No new method, and no rename either.[^no-createrows]

### Every op returns a `BenchResult`; only `meanMs` is compared

All eleven methods (the five existing ones and the six new ones) return `BenchResult`. `meanMs` means the same thing everywhere — *the mean cost of one unit of the op* — and it is the only field the baseline check reads. `medianMs` and `maxMs` are per-sample statistics and are `null` for the two ops that time one aggregate span rather than a series of samples.[^why-nullable-stats]

| Op | `rows` | `iterations` | one unit is | `medianMs` / `maxMs` |
|---|---|---|---|---|
| `tableScroll` | `rowCount` | 200 | one animation frame | per-frame |
| `tableRenderWindow` | `rowCount` | 200 | one `setScrollY` | per-step |
| `tablePoolGrow` | `rowCount` | 20 | one cold `setSize` | per-iteration |
| `componentInit` | 0 | `count` | one `new Component()` | `null` |
| `themeSwitch` | 0 | `iterations` | one theme toggle | `null` |
| `storeAppend` | `rowCount` | 10 | one `store.add(batch)` | per-iteration |
| `recordUpdate` | `rowCount` | 10 | one every-Nth sweep | per-iteration |
| `rowSelect` | `rowCount` | 20 | one `selectRecord` | per-iteration |
| `storeSort` | `rowCount` | 10 | one `sort()` | per-iteration |
| `recordRemove` | `rowCount` | 20 | one `remove()` | per-iteration |
| `storeClear` | `rowCount` | 10 | one `removeAll()` | per-iteration |

### Default row counts are chosen against the store's 1,000-record worker threshold

`applyView()` offloads to a Web Worker once the master record list reaches `WORKER_THRESHOLD = 1000` ([AbstractStore:16](packages/lib/src/typescript/lib/data/AbstractStore.ts#L16), [AbstractStore:1910](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1910)). `add` / `remove` / `removeAll` do not await that offload, so above the threshold part of their cost lands after the sample ends. The rule:

> **An op whose sample must cover the view rebuild defaults to a record count that keeps `applyView()` in-process at the moment it runs. An op that only needs the synchronous main-thread span, or that awaits a promise which settles the rebuild, may default to 10,000.**

| Op | default `rowCount` | list length when `applyView()` runs | path |
|---|---|---|---|
| `benchRecordRemove` | 1,000 | 999 | in-process — rebuild is inside the sample |
| `benchStoreClear` | 1,000 | 0 | in-process — rebuild is inside the sample |
| `benchStoreAppend` | 1,000 (+100 appended) | 1,100 | worker — sample covers the synchronous span only |
| `benchRecordUpdate` | 1,000 | n/a — `set()` never calls `applyView()` | n/a |
| `benchRowSelect` | 10,000 | n/a — selection never calls `applyView()` | n/a |
| `benchStoreSort` | 10,000 | 10,000 | worker, but `await sort()` settles after the re-render |

`benchStoreAppend` is the one op whose sample is a partial measurement, and its synchronous span is still where the main-thread cost sits.[^append-sync-span]

### `benchTableScroll` and `benchTablePoolGrow` gain `await store.load()`

`new MemoryStore(model, records)` only hands the data to its proxy ([MemoryStore:34](packages/lib/src/typescript/lib/data/MemoryStore.ts#L34)); the store's own record list stays empty until `load()` runs. Both methods skip `load()` today, so both currently measure a table with zero rows. Each gets one `await store.load()` before its timing loop. This is the only behavioural change the plan makes to an existing method — the other two edits to the existing five are the return type and routing their stats through `summarize`. It is required: a baseline entry for an op that measures an empty table would pin the wrong number forever.[^load-fix]

### The baseline is a TypeScript module, not JSON

`packages/lib/src/typescript/perf/baseline.ts` exports `PERF_BASELINE: BenchResult[]`. The repo has no JSON imports and `resolveJsonModule` is not enabled, so a `.json` file would need a tsconfig change or a `fetch` at runtime; a `.ts` module needs neither and is type-checked.[^baseline-ts]

`baseline.ts` must import the result type with **`import type`** so no runtime cycle forms between the two files.

### The new ops dispose their tables; the existing five are left alone

`mountTable` is paired with an `unmountTable` that calls `table.dispose()` ([Component:880](packages/lib/src/typescript/lib/core/Component.ts#L880)) before removing the host. A full `benchAll()` run mounts around 50 tables; without teardown their per-instance stylesheet rules and component trees accumulate and skew whichever op runs last. The existing five keep their current `document.body.removeChild(host)`-only cleanup.[^dispose-new-only]

---

## Public API

Added to `packages/lib/src/typescript/perf/Benchmark.ts`:

```typescript
export interface BenchResult {
    op:         string;
    rows:       number;
    iterations: number;
    meanMs:     number;
    medianMs:   number | null;
    maxMs:      number | null;
}
```

```typescript
class Benchmark {
    // Changed return types on the five existing methods.
    static benchTableScroll(rowCount?: number): Promise<BenchResult>;
    static benchTableRenderWindow(rowCount?: number, steps?: number): Promise<BenchResult>;
    static benchTablePoolGrow(rowCount?: number, iterations?: number): Promise<BenchResult>;
    static benchComponentInit(count?: number): BenchResult;
    static benchThemeSwitch(iterations?: number): BenchResult;

    // New ops.
    static benchStoreAppend(rowCount?: number, appendCount?: number, iterations?: number): Promise<BenchResult>;
    static benchRecordUpdate(rowCount?: number, stride?: number, iterations?: number): Promise<BenchResult>;
    static benchRowSelect(rowCount?: number, iterations?: number): Promise<BenchResult>;
    static benchStoreSort(rowCount?: number, iterations?: number): Promise<BenchResult>;
    static benchRecordRemove(rowCount?: number, iterations?: number): Promise<BenchResult>;
    static benchStoreClear(rowCount?: number, iterations?: number): Promise<BenchResult>;

    static benchAll(): Promise<BenchResult[]>;
    static compareToBaseline(): Promise<BenchResult[]>;

    private static mountTable(rowCount: number): Promise<{ store: MemoryStore; table: Table; host: HTMLElement }>;
    private static unmountTable(table: Table, host: HTMLElement): void;
    private static summarize(op: string, rows: number, samples: number[]): BenchResult;
}
```

Default arguments:

| Method | Defaults |
|---|---|
| `benchStoreAppend` | `rowCount = 1000, appendCount = 100, iterations = 10` |
| `benchRecordUpdate` | `rowCount = 1000, stride = 10, iterations = 10` |
| `benchRowSelect` | `rowCount = 10000, iterations = 20` |
| `benchStoreSort` | `rowCount = 10000, iterations = 10` |
| `benchRecordRemove` | `rowCount = 1000, iterations = 20` |
| `benchStoreClear` | `rowCount = 1000, iterations = 10` |

Added in `packages/lib/src/typescript/perf/baseline.ts`:

```typescript
export const PERF_BASELINE: BenchResult[];
```

---

## Internal Structure

### `summarize` — the shared stats-and-log terminus

```typescript
private static summarize(op: string, rows: number, samples: number[]): BenchResult {
    const sorted = samples.slice().sort((a, b) => a - b);
    const sum    = samples.reduce((a, b) => a + b, 0);
    const mean   = sum / samples.length;
    // Upper-middle sample for an even count; a benchmark does not need the
    // interpolated median.
    const median = sorted[Math.floor(sorted.length / 2)];
    const max    = sorted[sorted.length - 1];

    console.log("[bench:" + op + "]",
        "rows=" + rows,
        "iterations=" + samples.length,
        "total=" + sum.toFixed(2) + "ms",
        "mean=" + mean.toFixed(3) + "ms",
        "median=" + median.toFixed(3) + "ms",
        "max=" + max.toFixed(2) + "ms");

    return { op, rows, iterations: samples.length, meanMs: mean, medianMs: median, maxMs: max };
}
```

All three sample-collecting existing methods and all six new ops route their reporting through it, so all eleven ops print one shape. For the three existing ones that means two cosmetic console changes: `steps=` becomes `iterations=`, and `median=` is added. `benchTableScroll` additionally reports the sample sum as `total=` instead of its own wall-clock reading; its per-frame samples tile the whole sweep, so the two agree by construction.

`benchComponentInit` and `benchThemeSwitch` keep their own bodies and `console.log` calls verbatim and append a `return` literal instead.

### `mountTable` / `unmountTable` — the shared fixture

```typescript
private static async mountTable(rowCount: number): Promise<{ store: MemoryStore; table: Table; host: HTMLElement }> {
    const store = Benchmark.buildPersonStore(rowCount);
    await store.load();

    const table = new Table(store);

    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-10000px";
    host.style.top = "0";
    host.style.width = "600px";
    host.style.height = "400px";
    document.body.appendChild(host);

    DOM.sink.appendChild(DOM.source.intern(host), table.getElement(true)!);
    table.setSize({ width: 600, height: 400 });

    // setSize schedules layout via rAF; wait for it so the row pool is
    // populated before the timing loop starts.
    await new Promise(r => requestAnimationFrame(r));

    return { store, table, host };
}
```

`await store.load()` is sufficient on its own — `load()` awaits `ingestRaw`, which awaits `applyView()` ([AbstractStore:351](packages/lib/src/typescript/lib/data/AbstractStore.ts#L351), [AbstractStore:614](packages/lib/src/typescript/lib/data/AbstractStore.ts#L614)) — so no record-count polling loop is needed here.

```typescript
private static unmountTable(table: Table, host: HTMLElement): void {
    table.dispose();
    document.body.removeChild(host);
}
```

### The regression threshold

```typescript
/**
 * Fractional slowdown over the committed baseline that trips a warning. 0.15
 * sits above ordinary run-to-run jitter (GC pauses, thermal throttling, other
 * tabs) while still catching a real regression.
 */
const REGRESSION_THRESHOLD = 0.15;
```

The comparison is written as a multiplication, `result.meanMs > base.meanMs * (1 + REGRESSION_THRESHOLD)`, so a zero baseline entry cannot produce a divide-by-zero; the percentage is computed only inside the warning branch.

### Destructive vs. shared fixtures

| Op | fixture |
|---|---|
| `benchStoreAppend` | fresh `mountTable` per iteration — a shared store would grow each sample |
| `benchStoreClear` | fresh `mountTable` per iteration — the first clear empties the store |
| `benchRecordRemove` | one shared table; 1,000 records shrink to 980 over 20 samples |
| `benchRecordUpdate` | one shared table; row count never changes |
| `benchRowSelect` | one shared table |
| `benchStoreSort` | one shared table, plus one untimed warm-up sort |

`benchStoreSort` takes an untimed warm-up sort before the loop because the first sort after a load re-ships the whole record snapshot to the worker while later ones do not, which would otherwise make sample 0 an outlier. This mirrors the first-call exclusion `benchTableRenderWindow` already documents at [Benchmark.ts:111](packages/lib/src/typescript/perf/Benchmark.ts#L111).

### Per-op timing bodies

Every sample takes its `performance.now()` reading around the op call alone; any `store.getRecords()` copy or payload construction happens outside the timed span.

- **`benchStoreAppend`** — build the `appendCount` plain objects once outside the loop; per iteration, `mountTable`, time `store.add(batch)`, `unmountTable`.
- **`benchRecordUpdate`** — `mountTable` once; snapshot `store.getRecords()` once; per iteration, time a loop that calls `record.set("name", "Person " + index + "-" + i)` for every `stride`-th record. The iteration index is part of the written value so `applySet` never short-circuits on an unchanged value ([ModelRecord:312](packages/lib/src/typescript/lib/data/ModelRecord.ts#L312)).
- **`benchRowSelect`** — `mountTable` once; per iteration, time `table.selectRecord(records[i % WINDOW_LOCAL_ROWS])`. `WINDOW_LOCAL_ROWS = 10`: the 400px host shows roughly 18 rows at 22px each, so cycling the first 10 keeps every selection inside the rendered window and the sample measures the selection rebind rather than a scroll.
- **`benchStoreSort`** — `mountTable` once, one untimed `await store.sort("balance", "asc")`, then per iteration time `await store.sort("balance", i % 2 === 0 ? "desc" : "asc")`.
- **`benchRecordRemove`** — `mountTable` once; per iteration read `store.getRecords()[0]` outside the span, then time `store.remove(record)`.
- **`benchStoreClear`** — per iteration, `mountTable`, time `store.removeAll()`, `unmountTable`.

---

## Ordered Implementation Steps

1. **`Benchmark.ts` — add the result type.** Above the class, export `interface BenchResult` exactly as given in `## Public API`, with one JSDoc line per field. Add the module-level `REGRESSION_THRESHOLD` constant with its comment.

2. **`Benchmark.ts` — add `summarize`.** Insert the private static helper from `## Internal Structure` directly below `buildPersonStore`. Give it the file's JSDoc style: a short paragraph plus `@param` / `@returns`.

3. **`Benchmark.ts` — add `mountTable` and `unmountTable`.** Insert both below `summarize`, with JSDoc matching the file's tone. Keep the raw `document.createElement` / `host.style.*` / `DOM.sink.appendChild(DOM.source.intern(host), …)` mix exactly as the existing methods write it — `perf/` sits outside the `local/no-raw-dom` rule's scope ([packages/lib/eslint.config.js:103](packages/lib/eslint.config.js#L103)), so raw element handling here is correct, not a violation to route around.

4. **`Benchmark.ts` — convert `benchTableScroll`.** Make it `static async`, return `Promise<BenchResult>`. Add `await store.load();` immediately after `buildPersonStore`, before the table is constructed. Replace the inline `sum` / `mean` / `max` block plus the `console.log` with `resolve(Benchmark.summarize("tableScroll", rowCount, frameTimes));`. Delete the now-unused `const start = lastTs;` and `const total = …` lines — `noUnusedLocals` is on and will flag them. Keep the "body element not present" early-return branch and resolve it with the literal `{ op: "tableScroll", rows: rowCount, iterations: 0, meanMs: 0, medianMs: null, maxMs: null }` — an `iterations: 0` result says plainly that nothing was measured, where routing a fake sample through `summarize` would log a `0.00ms` line that reads like a real one.

5. **`Benchmark.ts` — convert `benchTableRenderWindow`.** Return `Promise<BenchResult>`. Replace the inline stats + `console.log` with `resolve(Benchmark.summarize("tableRenderWindow", rowCount, times));`, and resolve the early-return branch with the same shape of literal as step 4, using `op: "tableRenderWindow"`. Leave its existing `await store.load()` and record-count poll untouched.

6. **`Benchmark.ts` — convert `benchTablePoolGrow`.** Return `Promise<BenchResult>`. Add `await store.load();` after `buildPersonStore`. Replace the trailing stats + `console.log` with `return Benchmark.summarize("tablePoolGrow", rowCount, samples);`.

7. **`Benchmark.ts` — convert `benchComponentInit` and `benchThemeSwitch`.** Change each return type to `BenchResult`. Leave both bodies and both `console.log` calls exactly as they are; append a `return` of a literal:
   - `{ op: "componentInit", rows: 0, iterations: count, meanMs: elapsed / count, medianMs: null, maxMs: null }`
   - `{ op: "themeSwitch", rows: 0, iterations: iterations, meanMs: elapsed / iterations, medianMs: null, maxMs: null }`

   Checkpoint: `cd packages/lib && npx tsc -p tsconfig.json --noEmit 2>&1 | grep 'src/typescript/perf/'` — expect no output.

8. **`Benchmark.ts` — add the six new ops.** Insert them after `benchThemeSwitch` and before `benchAll`, in the order `benchStoreAppend`, `benchRecordUpdate`, `benchRowSelect`, `benchStoreSort`, `benchRecordRemove`, `benchStoreClear`, following the per-op bodies in `## Internal Structure`. Each gets a JSDoc block in the file's existing voice — what it builds, what it times, what is deliberately outside the timed span — plus `@param` lines. The three ops whose default row count was picked against the worker threshold (`benchStoreAppend`, `benchRecordRemove`, `benchStoreClear`) state in their `@remarks` which side of it they land on, following the table in `## Architecture Decisions`.

9. **Create `packages/lib/src/typescript/perf/baseline.ts`.** SPDX header line matching `Benchmark.ts`, then `import type { BenchResult } from './Benchmark.js';` — `import type`, so no runtime cycle forms — then an exported `PERF_BASELINE: BenchResult[]` initialised to `[]`, with a JSDoc block stating that entries are pasted by hand from the `[bench:snapshot]` block `compareToBaseline` prints (step 11), in the same commit as the deliberate perf change that moved them.

10. **`Benchmark.ts` — extend `benchAll`.** Change the return type to `Promise<BenchResult[]>` and rewrite the body as sequential `results.push(...)` statements: the five existing calls in their current order, then the six new ones in the order added in step 8. Return `results`.

11. **`Benchmark.ts` — add `compareToBaseline`.** Import `PERF_BASELINE` from `'./baseline.js'` (single quotes, matching the file's other imports). The method runs `benchAll()`, then for each result finds the baseline entry matching both `op` and `rows`; warns `[bench:baseline-missing]` when there is none; warns `[bench:regression]` with op name, `rows=`, `baseline=`, `current=` and `delta=+N.N%` when `result.meanMs > base.meanMs * (1 + REGRESSION_THRESHOLD)`. Finish with `console.log("[bench:snapshot]\n" + JSON.stringify(results, null, 4));` and return `results`.

12. **Confirm `main.ts` is untouched.** `grep -n 'Benchmark' packages/lib/src/typescript/main.ts` — expect only the import at line 32, the `window.bench` assignment at line 43, and the dead `if (false)` call at line 147. The widened return types are compatible with all three; no edit is needed.

13. **Seed the baseline.** Run `npm run dev`, open `http://localhost:8015`, and in the devtools console run `await bench.compareToBaseline()`. Copy the printed `[bench:snapshot]` array into `PERF_BASELINE`. If the browser run cannot be performed, leave `PERF_BASELINE` as `[]` and say so when reporting — never hand-write numbers into it.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/perf/Benchmark.ts` |
| Create | `packages/lib/src/typescript/perf/baseline.ts` |

---

## Expected Behaviour

Everything here is **manual verification in a browser**. `perf/` has no test file today, the code needs a real DOM, `requestAnimationFrame` and `Worker`, and this feature is explicitly not wired into any test runner (see `## Non-Goals`). Verify each case from the devtools console on `http://localhost:8015`.

1. `await bench.benchStoreAppend()` logs one line tagged `[bench:storeAppend]` carrying `rows=1000 iterations=10` plus `total=`, `mean=`, `median=`, `max=`, and returns an object with those six fields.
2. `await bench.benchRecordUpdate()` logs `[bench:recordUpdate] rows=1000 iterations=10`. Its `meanMs` is the cost of one full sweep of 100 `set()` calls, not one `set()`.
3. `await bench.benchRowSelect()` logs `[bench:rowSelect] rows=10000 iterations=20`, and its `maxMs` stays within a small multiple of its `medianMs`. A wide spread would mean the selections are scrolling instead of staying inside the rendered window, and `WINDOW_LOCAL_ROWS` needs lowering.
4. `await bench.benchStoreSort()` logs `[bench:storeSort] rows=10000 iterations=10`, and its `maxMs` stays within a small multiple of its `medianMs` — the warm-up sort absorbed the one-off snapshot-shipping cost that would otherwise make the first sample an outlier.
5. `await bench.benchRecordRemove()` logs `[bench:recordRemove] rows=1000 iterations=20`. Its `meanMs` covers the in-process view rebuild, because the record list is 999 long when `applyView()` runs.
6. `await bench.benchStoreClear()` logs `[bench:storeClear] rows=1000 iterations=10`.
7. `await bench.benchAll()` returns an array of exactly 11 results, ordered `componentInit`, `themeSwitch`, `tableScroll`, `tablePoolGrow`, `tableRenderWindow`, `storeAppend`, `recordUpdate`, `rowSelect`, `storeSort`, `recordRemove`, `storeClear`.
8. `bench.benchComponentInit()` returns `{ op: "componentInit", rows: 0, iterations: 1000, meanMs: <number>, medianMs: null, maxMs: null }` and its console line is unchanged from before this work.
9. `bench.benchThemeSwitch()` behaves the same way with `op: "themeSwitch"` and `iterations: 10`.
10. With `PERF_BASELINE` empty, `await bench.compareToBaseline()` emits one `[bench:baseline-missing]` warning per op, no `[bench:regression]` warnings, and one `[bench:snapshot]` block.
11. With a seeded baseline and no code changes, a repeat `compareToBaseline()` run emits no `[bench:regression]` warnings on an idle machine.
12. Hand-editing one baseline entry's `meanMs` down to half its recorded value makes the next `compareToBaseline()` emit exactly one `[bench:regression]` warning, for that op, with `delta=` near `+100.0%`.
13. `bench.benchTablePoolGrow()` and `bench.benchTableScroll()` each report a `meanMs` well clear of zero. Both now load their store first, so the pool binds real rows; an unloaded store would leave both near zero.

---

## Verification

- `cd packages/lib && npx tsc -p tsconfig.json --noEmit 2>&1 | grep 'src/typescript/perf/'` — expect no output. Do **not** expect an overall clean run: the project-wide config has pre-existing errors in demo panels and tests, and `npm run typecheck` uses `tsconfig.lib.json`, which covers only `src/typescript/lib/**` and cannot see `perf/` at all.
- `cd packages/lib && npx eslint src/typescript/perf` — expect zero problems (it is clean today).
- `npm run test` — unchanged; no test touches `perf/`. Run it to confirm nothing else moved.
- `grep -rn 'baseline.json' packages/lib/src/` — expect no matches; the baseline is a `.ts` module.
- Manual: `npm run dev`, open `http://localhost:8015`, and walk the thirteen cases in `## Expected Behaviour` from the devtools console. Reload the page between full `benchAll()` runs.

---

## Potential Challenges

- **A full `benchAll()` takes tens of seconds.** `benchTableScroll` alone spends 200 animation frames. Expected; it is a manual devtools tool.
- **Numbers drift with machine state.** Thermal throttling, other tabs, and a high-refresh display all move the results. Re-run a warning once before believing it; the 15% threshold is deliberately loose.
- **The existing five still leak their tables.** Only the new ops call `dispose()`. A very long console session that re-runs `benchAll()` repeatedly without reloading will see later ops creep upward — reload the page between runs.
- **`benchStoreAppend`'s sample is a partial measurement above the worker threshold.** Say so in its JSDoc so nobody later reads its mean as the full cost of an append.
- **A baseline entry is matched on `op` *and* `rows`.** Running an op with a non-default row count produces a result with no baseline match and a `[bench:baseline-missing]` warning. That is correct behaviour, not a bug to work around.

---

## Critical Files

| File | Why |
|---|---|
| [packages/lib/src/typescript/perf/Benchmark.ts](packages/lib/src/typescript/perf/Benchmark.ts) | The file being extended; `benchTablePoolGrow` (L192) is the iteration-sampling precedent and `benchTableRenderWindow` (L116) is the mount/first-call-exclusion precedent |
| [packages/lib/src/typescript/lib/data/AbstractStore.ts](packages/lib/src/typescript/lib/data/AbstractStore.ts) | `WORKER_THRESHOLD` (L16), `load` (L323), `add` (L788), `remove` (L860), `removeAll` (L889), `sort` (L1422), `applyView` (L1907) |
| [packages/lib/src/typescript/lib/data/ModelRecord.ts](packages/lib/src/typescript/lib/data/ModelRecord.ts) | `set` (L153), `applySet`'s unchanged-value short circuit (L312), `notifyStore` (L352) |
| [packages/lib/src/typescript/lib/component/table/Table.ts](packages/lib/src/typescript/lib/component/table/Table.ts) | `getBody` (L929), `selectRecord` (L1027) |
| [packages/lib/src/typescript/lib/component/table/Body.ts](packages/lib/src/typescript/lib/component/table/Body.ts) | `bindStore` (L452) and `onStoreChange` (L474) — why one `set()` costs one window re-render |
| [packages/lib/tests/unit/data/MemoryStore.test.ts](packages/lib/tests/unit/data/MemoryStore.test.ts) | Precedent for how the mutation API is actually called: `store.add` (L48), `store.remove` (L73), `record.set` (L104), `store.removeAll` (L212) |
| [packages/lib/tests/unit/data/AbstractStore.workerView.test.ts](packages/lib/tests/unit/data/AbstractStore.workerView.test.ts) | Its header comment documents the worker-path staleness the row-count rule is built around |
| [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) | `dispose` (L880) — the idempotent teardown `unmountTable` calls |
| [packages/lib/src/typescript/main.ts](packages/lib/src/typescript/main.ts) | `window.bench` wiring (L43); confirms no edit is needed there |
| [packages/lib/eslint.config.js](packages/lib/eslint.config.js) | `local/no-raw-dom` is scoped to `src/typescript/lib/**` (L103), so raw DOM in `perf/` is allowed |

---

## Non-Goals

- **No port of the krausest/js-framework-benchmark spec.** No `results.json` schema, no cross-browser matrix, no keyed/non-keyed distinction. That comparison was considered and rejected: it measures flat-list DOM churn on vdom-diffing frameworks, and this library's `Table` virtualizes.
- **No CI gate, no test-runner wiring, no package.json script.** Perf timings are noisy and a hard gate would be flaky. The only entry point is `window.bench` in devtools.
- **No Playwright, webdriver, or Chrome-tracing automation.** Timing stays on in-page `performance.now()`; CDP-attached numbers in this project run heavily inflated and are trustworthy only for hotspot attribution, not absolute milliseconds.
- **No automatic baseline update.** `PERF_BASELINE` is edited by hand and committed alongside the change that moved it.
- **No new npm workspace package and no new dev-server or build config.** Everything lives in `packages/lib/src/typescript/perf/` and reuses the existing `npm run dev` entry on port 8015.
- **No documentation-site impact.** `perf/` sits outside `src/typescript/lib`, so it is outside `tsconfig.lib.json`'s include, outside the published `dist/lib`, and outside the TypeDoc surface.
- **No fix for the store's worker-path staleness.** `add` / `remove` / `removeAll` re-emit nothing when the worker-built view lands. The plan works around it by choosing row counts; fixing it is separate work.
- **No changes to the five existing benchmarks** beyond three things: the return type, routing the three sample-collecting ones through `summarize`, and the two `await store.load()` calls. In particular they keep their current `removeChild`-only cleanup.

---

## Notes

[^why-poolgrow-precedent]: `benchTablePoolGrow` ([Benchmark.ts:192](packages/lib/src/typescript/perf/Benchmark.ts#L192)) is the closest existing shape: a fixed iteration count, one `performance.now()` delta per iteration collected into a `samples` array, and a single summary log at the end. `benchTableScroll` samples per animation frame instead, which suits a scroll sweep but not a discrete mutation. The six new ops are all discrete mutations, so they follow the pool-grow shape.

[^set-notify-chain]: The chain is `record.set` → `notifyStore` → `store.notifyRecordChanged` → `emit('update')` + `emit('datachange')` → `Body`'s `'datachange'` subscription → `onStoreChange` → `_boundIndices.fill(-1)` + `renderWindow()`. Every link is synchronous, and `applyView()` is never called, so a `set()` costs exactly one full window rebind regardless of record count. That is why `benchRecordUpdate` times a whole sweep rather than a single `set()`: one `set()` is a single rebind, and the sweep is what a real bulk edit costs. It is also why the written value carries the iteration index — `applySet` ([ModelRecord:312](packages/lib/src/typescript/lib/data/ModelRecord.ts#L312)) returns `false` for an unchanged value and skips the notify entirely, so re-writing the same string in a later iteration would silently measure nothing.

[^no-swap-api]: Searched `AbstractStore`, `MemoryStore`, `Table` and `Body` for a `move` / `swap` / `reorder` record method; none exists. `insert(index, data)` ([AbstractStore:807](packages/lib/src/typescript/lib/data/AbstractStore.ts#L807)) takes raw data and creates new records, so it cannot relocate an existing one, and its index addresses the master list rather than the view. The view itself is rebuilt wholesale by `applyView()` from the active filters and sorters, so a two-record swap has no representation in this architecture. Forcing one would mean mutating a private array and calling a protected method — a fictional API that would measure nothing a consumer can do. `store.sort()` is the genuine reordering entry point and exercises the same downstream work a swap would (view rebuild, row-pool rebind, re-render), only at full-view scale.

[^no-createrows]: krausest's "create rows" measures building N row elements. Here `Body` keeps a pool sized to the visible window, so the cost of showing 10,000 records is pool growth plus one window render — precisely the span `benchTablePoolGrow` times around `table.setSize`. Adding `benchCreateRows` would be a second name for the same measurement. Renaming `benchTablePoolGrow` to `benchCreateRows` was also considered and rejected: the current name describes what the code actually does, and the new name would import the framing this plan deliberately avoids.

[^why-nullable-stats]: `benchComponentInit` and `benchThemeSwitch` time one aggregate span over `count` / `iterations` units and divide — they never build a sample array, so they have no median and no worst sample. Three ways to give them one were considered. Fabricating `medianMs = maxMs = totalMs` would make `maxMs` mean "the whole batch" for two ops and "the worst single sample" for the other nine, which misleads anyone reading the column. Adding an outer repeat loop would restructure two methods the brief asks to leave alone, and would change what their existing `per=` log line means. Nullable fields cost each method one extra literal, keep every non-null value comparable across ops, and keep the regression check reading a single field that means the same thing everywhere. The two ops are also self-averaging already — 1,000 constructions and 10 toggles per span — so a single sample is not as noisy as the count suggests.

[^append-sync-span]: Above `WORKER_THRESHOLD`, `applyView()` routes to `applyViewOnWorker` ([AbstractStore:2018](packages/lib/src/typescript/lib/data/AbstractStore.ts#L2018)), and `add()` neither awaits nor re-emits when it lands — a hazard the store's own worker-view test documents in its header comment. What *is* inside the synchronous span is substantial: record construction, the master-list splice, `_allRecords.map(r => r.getData())` building a full plain-object snapshot, the `postMessage` structured clone of that snapshot, the `'add'` and `'datachange'` fan-out, and the `Body.renderWindow` those events drive. The snapshot build and clone are O(records × fields) on the main thread, which is exactly the kind of cost a responsiveness-regression suite should catch. Waiting for the async half instead would mean polling `store.getRecords().length` across animation frames, adding roughly 16ms of quantization to a sample measured in single-digit milliseconds — far more distortion than the missing tail is worth.

[^load-fix]: `MemoryStore`'s constructor calls `this.proxy.setData(data)` and nothing else; `_allRecords` and `_records` both start as `[]` ([AbstractStore:168](packages/lib/src/typescript/lib/data/AbstractStore.ts#L168)) and are populated only by `load()` or `loadData()`. `Body.getVisibleRecords` reads `store.getRecords()` ([Body:494](packages/lib/src/typescript/lib/component/table/Body.ts#L494)), so with an unloaded store the pool binds zero rows. `benchTableRenderWindow` already calls `await store.load()`; `benchTableScroll` and `benchTablePoolGrow` do not. The fix is one line each and leaves both methods otherwise identical. Without it, two of the eleven baseline entries would pin the cost of laying out an empty table, and a genuine regression in the row-pool or render-window path would never move them.

[^baseline-ts]: `packages/lib/tsconfig.json` sets no `resolveJsonModule`, and a repo-wide search found no JSON import anywhere in `packages/lib/src`. Importing a `.json` would therefore need a compiler-option change — outside this feature's scope, and a change that affects every module in the package. Fetching the file at runtime instead would hard-code a dev-server-relative URL and add a failure mode to a devtools helper. A `.ts` module needs neither: it imports like any other module, the array is type-checked against `BenchResult` so a malformed entry is a compile error rather than a silent mismatch, and it is still a plain data file a human edits by pasting. The type import must be `import type` — a value import of `BenchResult` from `Benchmark.ts` into `baseline.ts`, which `Benchmark.ts` imports back, would form a runtime cycle.

[^dispose-new-only]: `benchAll()` at the defaults mounts roughly 50 tables: 20 in `benchTablePoolGrow`, 10 in `benchStoreAppend`, 10 in `benchStoreClear`, and one each for the remaining table ops. `Component.dispose()` ([Component:880](packages/lib/src/typescript/lib/core/Component.ts#L880)) is idempotent and deletes the component's per-instance stylesheet rules along with its DOM and listeners, so calling it keeps the new ops from loading the ops that run after them. It is not retrofitted onto the existing five: that is a teardown change to method bodies the brief asks to leave alone, it would shift their recorded numbers on top of the `store.load()` shift already being made, and the accumulation it would fix is bounded by a page reload. The `## Potential Challenges` bullet records the residual.
