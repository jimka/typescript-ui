// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Base/Component.js";
import { Table } from "../Base/component/table/Table.js";
import { Model } from "../Base/data/Model.js";
import { MemoryStore } from "../Base/data/MemoryStore.js";
import { ThemeManager, DefaultTheme, DarkTheme } from "../Base/Theme.js";

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
            const el = body.getElement();
            if (!el) {
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
                el.scrollTop = step * stride;
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
     * Runs all three benchmarks sequentially.
     */
    static async benchAll(): Promise<void> {
        Benchmark.benchComponentInit();
        Benchmark.benchThemeSwitch();
        await Benchmark.benchTableScroll();
    }
}

