// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { BenchResult } from './Benchmark.js';

/**
 * Committed performance baseline for `Benchmark.compareToBaseline()`. Each
 * entry is pasted by hand from the `[bench:snapshot]` block that
 * `compareToBaseline()` prints, in the same commit as the deliberate
 * performance change that moved it.
 */
export const PERF_BASELINE: BenchResult[] = [
    { op: "componentInit", rows: 0, iterations: 1000, meanMs: 0.0058, medianMs: null, maxMs: null },
    { op: "themeSwitch", rows: 0, iterations: 10, meanMs: 15.26, medianMs: null, maxMs: null },
    { op: "tableScroll", rows: 10000, iterations: 200, meanMs: 16.939, medianMs: 16.7, maxMs: 68.7 },
    { op: "tablePoolGrow", rows: 10000, iterations: 20, meanMs: 0.005, medianMs: 0, maxMs: 0.1 },
    { op: "tableRenderWindow", rows: 10000, iterations: 200, meanMs: 1.253, medianMs: 1.2, maxMs: 3.4 },
    { op: "storeAppend", rows: 1000, iterations: 10, meanMs: 1.56, medianMs: 1.3, maxMs: 3.2 },
    { op: "recordUpdate", rows: 1000, iterations: 10, meanMs: 29.03, medianMs: 28.4, maxMs: 34.5 },
    { op: "rowSelect", rows: 10000, iterations: 20, meanMs: 1.105, medianMs: 0.9, maxMs: 3.2 },
    { op: "storeSort", rows: 10000, iterations: 10, meanMs: 3.43, medianMs: 2.3, maxMs: 9.2 },
    { op: "recordRemove", rows: 1000, iterations: 20, meanMs: 0.63, medianMs: 0.6, maxMs: 1.2 },
    { op: "storeClear", rows: 1000, iterations: 10, meanMs: 13.82, medianMs: 13.7, maxMs: 15 },
];
