// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ClassicTheme, Component, DarkTheme, DOM, ThemeManager } from '@jimka/typescript-ui/core';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { Table } from '@jimka/typescript-ui/component/table';
import { PERF_BASELINE } from './baseline.js';

/**
 * Result of one benchmark run.
 */
export interface BenchResult {
    /** The benchmark's `[bench:<op>]` tag. */
    op:         string;
    /** Number of records in the backing store when the op ran. */
    rows:       number;
    /** Number of samples (or units) the mean/median/max were computed over. */
    iterations: number;
    /** Mean cost of one unit of the op, in milliseconds. */
    meanMs:     number;
    /** Median sample time in milliseconds, or null for an aggregate-span op. */
    medianMs:   number | null;
    /** Worst sample time in milliseconds, or null for an aggregate-span op. */
    maxMs:      number | null;
}

/**
 * Fractional slowdown over the committed baseline that trips a warning. 0.15
 * sits above ordinary run-to-run jitter (GC pauses, thermal throttling, other
 * tabs) while still catching a real regression.
 */
const REGRESSION_THRESHOLD = 0.15;

/**
 * In-browser micro-benchmarks for the UI library. Not auto-run; invoke from
 * devtools via window.bench.
 */
export class Benchmark {

    private static buildPersonStore(rowCount: number) {
        const model = new Model([
            { name: "id",       type: "number" },
            { name: "name",     type: "string" },
            { name: "city",     type: "string" },
            { name: "country",  type: "string" },
            { name: "balance",  type: "number" },
        ]);

        const records: any[] = new Array(rowCount);
        for (let i = 0; i < rowCount; i++) {
            records[i] = {
                id:      i,
                name:    "Person " + i,
                city:    "City " + (i % 100),
                country: "Country " + (i % 20),
                balance: (i * 7.13) % 10000,
            };
        }

        return new MemoryStore(model, records);
    }

    /**
     * Computes mean/median/max over `samples` and logs a `[bench:<op>]`
     * summary line. The shared stats-and-log terminus for every
     * sample-collecting benchmark.
     *
     * @param op - The benchmark's tag, used in the `[bench:<op>]` log prefix.
     * @param rows - Number of records in the backing store.
     * @param samples - One elapsed-time reading per iteration, in milliseconds.
     * @returns The computed result.
     */
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

    /**
     * Builds a `rowCount`-record table, mounts it in a 600x400
     * offscreen-style container under document.body, and waits for the row
     * pool to populate.
     *
     * @param rowCount - Number of records in the backing store.
     * @returns The mounted store, table, and host element.
     */
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

    /**
     * Disposes `table` and removes `host` from the document — the teardown
     * half of `mountTable`.
     *
     * @param table - The table to dispose.
     * @param host - The host element to remove.
     */
    private static unmountTable(table: Table, host: HTMLElement): void {
        table.dispose();
        document.body.removeChild(host);
    }

    /**
     * Builds a Table with `rowCount` rows, mounts it in a 600x400 offscreen-style
     * container under document.body, and drives scrollTop through a sequence of
     * positions using requestAnimationFrame. Logs per-frame and total times.
     */
    static async benchTableScroll(rowCount: number = 10000): Promise<BenchResult> {
        const store = Benchmark.buildPersonStore(rowCount);
        await store.load();

        return new Promise<BenchResult>(resolve => {
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

            const body = table.getBody();
            if (!body.getElement()) {
                console.warn("Benchmark: body element not present");
                document.body.removeChild(host);
                resolve({ op: "tableScroll", rows: rowCount, iterations: 0, meanMs: 0, medianMs: null, maxMs: null });
                return;
            }

            const ROW_HEIGHT = 22;
            const totalScrollHeight = rowCount * ROW_HEIGHT;
            const STEPS = 200;
            const stride = Math.max(1, Math.floor(totalScrollHeight / STEPS));

            const frameTimes: number[] = [];
            let step = 0;
            let lastTs = performance.now();

            const tick = () => {
                body.setScrollY(step * stride);
                step++;

                const now = performance.now();
                frameTimes.push(now - lastTs);
                lastTs = now;

                if (step < STEPS) {
                    requestAnimationFrame(tick);
                } else {
                    document.body.removeChild(host);
                    resolve(Benchmark.summarize("tableScroll", rowCount, frameTimes));
                }
            };

            requestAnimationFrame(tick);
        });
    }

    /**
     * Builds a Table with `rowCount` rows, mounts it offscreen, and measures the
     * pure JS cost of `Body.renderWindow` across `steps` scroll positions.
     *
     * Unlike `benchTableScroll`, this drives `renderWindow` synchronously
     * instead of letting it run from the scroll-event/rAF path, so the
     * measurement reflects actual JS work and is not dominated by the ~16ms
     * vsync frame interval. The first call (pool grow) is excluded.
     *
     * @param rowCount - Number of records in the backing store.
     * @param steps - Number of scrollTop positions to sweep through.
     */
    static async benchTableRenderWindow(rowCount: number = 10000, steps: number = 200): Promise<BenchResult> {
        const store = Benchmark.buildPersonStore(rowCount);
        await store.load();

        // For datasets above the worker threshold, AbstractStore.load() returns
        // before applyView completes (worker round-trip). Wait until the view
        // is populated before starting the timing loop.
        while (store.getRecords().length < rowCount) {
            await new Promise(r => requestAnimationFrame(r));
        }

        return new Promise<BenchResult>(resolve => {
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

            const body = table.getBody();
            if (!body.getElement()) {
                console.warn("Benchmark: body element not present");
                document.body.removeChild(host);
                resolve({ op: "tableRenderWindow", rows: rowCount, iterations: 0, meanMs: 0, medianMs: null, maxMs: null });
                return;
            }

            // setSize schedules layout via rAF; wait for it to complete so
            // body.getHeight() is non-zero and renderWindow has work to do.
            requestAnimationFrame(() => {
                const ROW_HEIGHT = 22;
                const totalScrollHeight = rowCount * ROW_HEIGHT;
                const stride = Math.max(1, Math.floor(totalScrollHeight / steps));

                // setScrollY is the real user entry point; it clamps, updates the
                // rows-container transform, and calls renderWindow synchronously.
                // The transform write is negligible compared to renderWindow, so this
                // is essentially renderWindow timing with the production call path.
                const times: number[] = new Array(steps);
                for (let i = 0; i < steps; i++) {
                    const start = performance.now();
                    body.setScrollY((i + 1) * stride);
                    times[i] = performance.now() - start;
                }

                document.body.removeChild(host);
                resolve(Benchmark.summarize("tableRenderWindow", rowCount, times));
            });
        });
    }

    /**
     * Builds a Table with `rowCount` rows, mounts it offscreen, and measures the
     * synchronous cost of the first `setSize`-driven `renderWindow` (the
     * pool-grow path in `Body`). Runs `iterations` times with a fresh table per
     * iteration so each iteration starts with an empty pool.
     *
     * @param rowCount - Number of records in the backing store.
     * @param iterations - Number of fresh-table pool-grow samples to take.
     */
    static async benchTablePoolGrow(rowCount: number = 10000, iterations: number = 20): Promise<BenchResult> {
        const store = Benchmark.buildPersonStore(rowCount);
        await store.load();

        const samples: number[] = new Array(iterations);

        for (let i = 0; i < iterations; i++) {
            const table = new Table(store);

            const host = document.createElement("div");
            host.style.position = "fixed";
            host.style.left = "-10000px";
            host.style.top = "0";
            host.style.width = "600px";
            host.style.height = "400px";
            document.body.appendChild(host);

            DOM.sink.appendChild(DOM.source.intern(host), table.getElement(true)!);

            const start = performance.now();
            table.setSize({ width: 600, height: 400 });
            const elapsed = performance.now() - start;

            samples[i] = elapsed;

            document.body.removeChild(host);
        }

        return Benchmark.summarize("tablePoolGrow", rowCount, samples);
    }

    /**
     * Constructs `count` bare Component instances (no parent, no DOM mount) and
     * measures construction time. Probes per-component CSS rule allocation cost.
     */
    static benchComponentInit(count: number = 1000): BenchResult {
        const components: Component[] = new Array(count);
        const start = performance.now();
        for (let i = 0; i < count; i++) {
            components[i] = new Component();
        }
        const elapsed = performance.now() - start;
        console.log("[bench:componentInit]",
            "count=" + count,
            "total=" + elapsed.toFixed(2) + "ms",
            "per=" + (elapsed / count).toFixed(4) + "ms");

        return { op: "componentInit", rows: 0, iterations: count, meanMs: elapsed / count, medianMs: null, maxMs: null };
    }

    /**
     * Toggles the global theme `iterations` times between Default and Dark and
     * measures total time. Dominated by per-component CSS variable propagation
     * and Text.applyStyle calls.
     */
    static benchThemeSwitch(iterations: number = 10): BenchResult {
        const original = ThemeManager.getTheme();
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            ThemeManager.setTheme(i % 2 === 0 ? DarkTheme : ClassicTheme);
        }
        const elapsed = performance.now() - start;
        ThemeManager.setTheme(original);
        console.log("[bench:themeSwitch]",
            "iterations=" + iterations,
            "total=" + elapsed.toFixed(2) + "ms",
            "per=" + (elapsed / iterations).toFixed(2) + "ms");

        return { op: "themeSwitch", rows: 0, iterations: iterations, meanMs: elapsed / iterations, medianMs: null, maxMs: null };
    }

    /**
     * Builds a `rowCount`-record table, then times `store.add(batch)`
     * appending `appendCount` new records to it, on a fresh table per
     * iteration so a sample never appends onto an already-grown store.
     *
     * @param rowCount - Number of records in the backing store before the append.
     * @param appendCount - Number of new records appended per sample.
     * @param iterations - Number of fresh-table append samples to take.
     * @returns The append benchmark's result.
     *
     * @remarks `rowCount` defaults to 1,000: appending above
     * `WORKER_THRESHOLD` routes the view rebuild to a worker that `add()`
     * never awaits, so the sample would cover only the synchronous span
     * (record construction, the snapshot clone, and event fan-out) rather
     * than the full rebuild.
     */
    static async benchStoreAppend(rowCount: number = 1000, appendCount: number = 100, iterations: number = 10): Promise<BenchResult> {
        const batch: any[] = new Array(appendCount);
        for (let i = 0; i < appendCount; i++) {
            batch[i] = {
                id:      rowCount + i,
                name:    "New " + i,
                city:    "City " + (i % 100),
                country: "Country " + (i % 20),
                balance: (i * 7.13) % 10000,
            };
        }

        const samples: number[] = new Array(iterations);

        for (let i = 0; i < iterations; i++) {
            const { store, table, host } = await Benchmark.mountTable(rowCount);

            const start = performance.now();
            store.add(batch);
            samples[i] = performance.now() - start;

            Benchmark.unmountTable(table, host);
        }

        return Benchmark.summarize("storeAppend", rowCount, samples);
    }

    /**
     * Builds a `rowCount`-record table, then times a sweep that calls
     * `record.set("name", …)` on every `stride`-th record. One sample is a
     * whole sweep rather than a single `set()`, since a single `set()`
     * costs one fixed window rebind regardless of how many records the
     * store holds — the sweep is what a real bulk edit costs.
     *
     * @param rowCount - Number of records in the backing store.
     * @param stride - Update every `stride`-th record in the sweep.
     * @param iterations - Number of sweep samples to take.
     * @returns The record-update benchmark's result.
     *
     * @remarks `record.set` never calls `applyView()`, so `rowCount` has no
     * worker-threshold implication here; 1,000 is chosen only to match the
     * other row-mutation ops' default table size.
     */
    static async benchRecordUpdate(rowCount: number = 1000, stride: number = 10, iterations: number = 10): Promise<BenchResult> {
        const { store, table, host } = await Benchmark.mountTable(rowCount);
        const records = store.getRecords();

        const samples: number[] = new Array(iterations);

        for (let i = 0; i < iterations; i++) {
            const start = performance.now();

            for (let index = 0; index < records.length; index += stride) {
                records[index].set("name", "Person " + index + "-" + i);
            }

            samples[i] = performance.now() - start;
        }

        Benchmark.unmountTable(table, host);

        return Benchmark.summarize("recordUpdate", rowCount, samples);
    }

    /**
     * Builds a `rowCount`-record table, then times `table.selectRecord(record)`
     * cycling through the first few records so every selection lands inside
     * the rendered window rather than triggering a scroll.
     *
     * @param rowCount - Number of records in the backing store.
     * @param iterations - Number of selection samples to take.
     * @returns The row-select benchmark's result.
     */
    static async benchRowSelect(rowCount: number = 10000, iterations: number = 20): Promise<BenchResult> {
        const { store, table, host } = await Benchmark.mountTable(rowCount);
        const records = store.getRecords();

        // The 400px-tall host shows roughly 18 rows at 22px each; cycling the
        // first 10 keeps every selection inside the rendered window so the
        // sample measures the selection rebind, not a scroll.
        const WINDOW_LOCAL_ROWS = 10;

        const samples: number[] = new Array(iterations);

        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            table.selectRecord(records[i % WINDOW_LOCAL_ROWS]);
            samples[i] = performance.now() - start;
        }

        Benchmark.unmountTable(table, host);

        return Benchmark.summarize("rowSelect", rowCount, samples);
    }

    /**
     * Builds a `rowCount`-record table, then times `store.sort()` alternating
     * between descending and ascending on `balance`. An untimed warm-up sort
     * runs first, since the first sort after a load re-ships the whole
     * record snapshot to the worker while later ones do not — without it,
     * sample 0 would be an outlier for a reason unrelated to sorting itself.
     *
     * @param rowCount - Number of records in the backing store.
     * @param iterations - Number of sort samples to take.
     * @returns The store-sort benchmark's result.
     */
    static async benchStoreSort(rowCount: number = 10000, iterations: number = 10): Promise<BenchResult> {
        const { store, table, host } = await Benchmark.mountTable(rowCount);

        await store.sort("balance", "asc");

        const samples: number[] = new Array(iterations);

        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            await store.sort("balance", i % 2 === 0 ? "desc" : "asc");
            samples[i] = performance.now() - start;
        }

        Benchmark.unmountTable(table, host);

        return Benchmark.summarize("storeSort", rowCount, samples);
    }

    /**
     * Builds a `rowCount`-record table, then times `store.remove(record)`
     * repeatedly removing the first record.
     *
     * @param rowCount - Number of records in the backing store.
     * @param iterations - Number of remove samples to take.
     * @returns The record-remove benchmark's result.
     *
     * @remarks `rowCount` defaults to 1,000: after the first removal the
     * master list is 999 long, keeping every sample's `applyView()`
     * in-process (below `WORKER_THRESHOLD`) rather than routed to the worker.
     */
    static async benchRecordRemove(rowCount: number = 1000, iterations: number = 20): Promise<BenchResult> {
        const { store, table, host } = await Benchmark.mountTable(rowCount);

        const samples: number[] = new Array(iterations);

        for (let i = 0; i < iterations; i++) {
            const record = store.getRecords()[0];

            const start = performance.now();
            store.remove(record);
            samples[i] = performance.now() - start;
        }

        Benchmark.unmountTable(table, host);

        return Benchmark.summarize("recordRemove", rowCount, samples);
    }

    /**
     * Builds a `rowCount`-record table, then times `store.removeAll()`
     * clearing it, on a fresh table per iteration since the first clear
     * empties the store.
     *
     * @param rowCount - Number of records in the backing store before the clear.
     * @param iterations - Number of fresh-table clear samples to take.
     * @returns The store-clear benchmark's result.
     *
     * @remarks `rowCount` defaults to 1,000: `removeAll()`'s `applyView()`
     * runs against an empty list, always below `WORKER_THRESHOLD`, so the
     * in-process rebuild stays inside the timed span.
     */
    static async benchStoreClear(rowCount: number = 1000, iterations: number = 10): Promise<BenchResult> {
        const samples: number[] = new Array(iterations);

        for (let i = 0; i < iterations; i++) {
            const { store, table, host } = await Benchmark.mountTable(rowCount);

            const start = performance.now();
            store.removeAll();
            samples[i] = performance.now() - start;

            Benchmark.unmountTable(table, host);
        }

        return Benchmark.summarize("storeClear", rowCount, samples);
    }

    /**
     * Runs all benchmarks sequentially.
     */
    static async benchAll(): Promise<BenchResult[]> {
        const results: BenchResult[] = [];

        results.push(Benchmark.benchComponentInit());
        results.push(Benchmark.benchThemeSwitch());
        results.push(await Benchmark.benchTableScroll());
        results.push(await Benchmark.benchTablePoolGrow());
        results.push(await Benchmark.benchTableRenderWindow());
        results.push(await Benchmark.benchStoreAppend());
        results.push(await Benchmark.benchRecordUpdate());
        results.push(await Benchmark.benchRowSelect());
        results.push(await Benchmark.benchStoreSort());
        results.push(await Benchmark.benchRecordRemove());
        results.push(await Benchmark.benchStoreClear());

        return results;
    }

    /**
     * Runs every benchmark and compares each result's `meanMs` against the
     * committed `PERF_BASELINE`, warning on a missing baseline entry or a
     * regression past `REGRESSION_THRESHOLD`. Always logs a
     * `[bench:snapshot]` block with the full run, for pasting into
     * `baseline.ts`.
     *
     * @returns The full set of results from this run.
     */
    static async compareToBaseline(): Promise<BenchResult[]> {
        const results = await Benchmark.benchAll();

        for (const result of results) {
            const base = PERF_BASELINE.find(b => b.op === result.op && b.rows === result.rows);

            if (!base) {
                console.warn("[bench:baseline-missing]", "op=" + result.op, "rows=" + result.rows);
                continue;
            }

            if (result.meanMs > base.meanMs * (1 + REGRESSION_THRESHOLD)) {
                const delta = (result.meanMs / base.meanMs - 1) * 100;
                console.warn("[bench:regression]",
                    "op=" + result.op,
                    "rows=" + result.rows,
                    "baseline=" + base.meanMs.toFixed(3) + "ms",
                    "current=" + result.meanMs.toFixed(3) + "ms",
                    "delta=+" + delta.toFixed(1) + "%");
            }
        }

        console.log("[bench:snapshot]\n" + JSON.stringify(results, null, 4));

        return results;
    }
}
