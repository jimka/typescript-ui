// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../lib/Component.js";
import { Table } from "../lib/component/table/Table.js";
import { Model } from "../lib/data/Model.js";
import { MemoryStore } from "../lib/data/MemoryStore.js";
import { ThemeManager, DefaultTheme, DarkTheme } from "../lib/Theme.js";

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
     * Builds a Table with `rowCount` rows, mounts it in a 600x400 offscreen-style
     * container under document.body, and drives scrollTop through a sequence of
     * positions using requestAnimationFrame. Logs per-frame and total times.
     */
    static benchTableScroll(rowCount: number = 10000): Promise<void> {
        return new Promise(resolve => {
            const store = Benchmark.buildPersonStore(rowCount);
            const table = new Table(store);

            const host = document.createElement("div");
            host.style.position = "fixed";
            host.style.left = "-10000px";
            host.style.top = "0";
            host.style.width = "600px";
            host.style.height = "400px";
            document.body.appendChild(host);

            host.appendChild(table.getElement(true));
            table.setSize({ width: 600, height: 400 });

            const body = table.getBody();
            if (!body.getElement()) {
                console.warn("Benchmark: body element not present");
                document.body.removeChild(host);
                resolve();
                return;
            }

            const ROW_HEIGHT = 22;
            const totalScrollHeight = rowCount * ROW_HEIGHT;
            const STEPS = 200;
            const stride = Math.max(1, Math.floor(totalScrollHeight / STEPS));

            const frameTimes: number[] = [];
            let step = 0;
            let lastTs = performance.now();
            const start = lastTs;

            const tick = () => {
                body.setScrollY(step * stride);
                step++;

                const now = performance.now();
                frameTimes.push(now - lastTs);
                lastTs = now;

                if (step < STEPS) {
                    requestAnimationFrame(tick);
                } else {
                    const total = performance.now() - start;
                    const sum = frameTimes.reduce((a, b) => a + b, 0);
                    const mean = sum / frameTimes.length;
                    const max = frameTimes.reduce((a, b) => Math.max(a, b), 0);
                    console.log("[bench:tableScroll]",
                        "rows=" + rowCount,
                        "steps=" + STEPS,
                        "total=" + total.toFixed(2) + "ms",
                        "mean=" + mean.toFixed(3) + "ms",
                        "max=" + max.toFixed(2) + "ms");
                    document.body.removeChild(host);
                    resolve();
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
    static async benchTableRenderWindow(rowCount: number = 10000, steps: number = 200): Promise<void> {
        const store = Benchmark.buildPersonStore(rowCount);
        await store.load();

        // For datasets above the worker threshold, AbstractStore.load() returns
        // before applyView completes (worker round-trip). Wait until the view
        // is populated before starting the timing loop.
        while (store.getRecords().length < rowCount) {
            await new Promise(r => requestAnimationFrame(r));
        }

        return new Promise(resolve => {
            const table = new Table(store);

            const host = document.createElement("div");
            host.style.position = "fixed";
            host.style.left = "-10000px";
            host.style.top = "0";
            host.style.width = "600px";
            host.style.height = "400px";
            document.body.appendChild(host);

            host.appendChild(table.getElement(true));
            table.setSize({ width: 600, height: 400 });

            const body = table.getBody();
            if (!body.getElement()) {
                console.warn("Benchmark: body element not present");
                document.body.removeChild(host);
                resolve();
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

                const sum = times.reduce((a, b) => a + b, 0);
                const mean = sum / times.length;
                const max = times.reduce((a, b) => Math.max(a, b), 0);
                console.log("[bench:tableRenderWindow]",
                    "rows=" + rowCount,
                    "steps=" + steps,
                    "total=" + sum.toFixed(2) + "ms",
                    "mean=" + mean.toFixed(3) + "ms",
                    "max=" + max.toFixed(2) + "ms");

                document.body.removeChild(host);
                resolve();
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
    static async benchTablePoolGrow(rowCount: number = 10000, iterations: number = 20): Promise<void> {
        const store = Benchmark.buildPersonStore(rowCount);

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

            host.appendChild(table.getElement(true));

            const start = performance.now();
            table.setSize({ width: 600, height: 400 });
            const elapsed = performance.now() - start;

            samples[i] = elapsed;

            document.body.removeChild(host);
        }

        const sum = samples.reduce((a, b) => a + b, 0);
        const mean = sum / samples.length;
        const max = samples.reduce((a, b) => Math.max(a, b), 0);
        console.log("[bench:tablePoolGrow]",
            "rows=" + rowCount,
            "iterations=" + iterations,
            "total=" + sum.toFixed(2) + "ms",
            "mean=" + mean.toFixed(3) + "ms",
            "max=" + max.toFixed(2) + "ms");
    }

    /**
     * Constructs `count` bare Component instances (no parent, no DOM mount) and
     * measures construction time. Probes per-component CSS rule allocation cost.
     */
    static benchComponentInit(count: number = 1000): void {
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
    }

    /**
     * Toggles the global theme `iterations` times between Default and Dark and
     * measures total time. Dominated by per-component CSS variable propagation
     * and Text.applyStyle calls.
     */
    static benchThemeSwitch(iterations: number = 10): void {
        const original = ThemeManager.getTheme();
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            ThemeManager.setTheme(i % 2 === 0 ? DarkTheme : DefaultTheme);
        }
        const elapsed = performance.now() - start;
        ThemeManager.setTheme(original);
        console.log("[bench:themeSwitch]",
            "iterations=" + iterations,
            "total=" + elapsed.toFixed(2) + "ms",
            "per=" + (elapsed / iterations).toFixed(2) + "ms");
    }

    /**
     * Runs all benchmarks sequentially.
     */
    static async benchAll(): Promise<void> {
        Benchmark.benchComponentInit();
        Benchmark.benchThemeSwitch();
        await Benchmark.benchTableScroll();
        await Benchmark.benchTablePoolGrow();
        await Benchmark.benchTableRenderWindow();
    }
}

