// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The demo app's one piece of persisted layout state, written straight to
// `localStorage` — the same one-key-module shape the docs app's
// `packages/docs/src/content/apiPreferences.ts` uses. The `local/no-raw-dom`
// rule that funnels every DOM read and write through the `DOM` seam is scoped
// to `src/typescript/lib/**` and does not reach the demo app; `localStorage`
// is not part of that seam's surface in any case.
//
// Validation is split the way the library intends: this module checks only
// *shape* — a real array of well-formed `LayoutSize` entries — while the
// library's `isRestorableSizes` checks *fit* against the live panes and
// discards a stale array whole.

import type { LayoutSize } from '@jimka/typescript-ui/layout';

/** `localStorage` key backing {@link loadPaneSizes} and {@link savePaneSizes}. */
const PANE_SIZES_KEY = "tsui-demo.shell.paneSizes";

/**
 * Whether `value` is a well-formed {@link LayoutSize}.
 *
 * @param value - A parsed JSON entry of unknown shape.
 * @returns `true` when the entry carries a known unit and a finite value.
 */
function isLayoutSize(value: unknown): value is LayoutSize {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const size = value as Partial<LayoutSize>;

    return (size.unit === "px" || size.unit === "ratio")
        && typeof size.value === "number"
        && Number.isFinite(size.value);
}

/**
 * The saved pane sizes, or `fallback` when none is saved, unparseable, or
 * malformed.
 *
 * @param fallback - The sizes to seed the split with when nothing usable is
 *   stored; returned by identity, not copied.
 * @returns The stored sizes, or `fallback`.
 */
export function loadPaneSizes(fallback: LayoutSize[]): LayoutSize[] {
    const raw = localStorage.getItem(PANE_SIZES_KEY);

    if (raw === null) {
        return fallback;
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch {
        return fallback;
    }

    if (!Array.isArray(parsed)) {
        return fallback;
    }

    const entries: unknown[] = parsed;

    if (!entries.every(isLayoutSize)) {
        return fallback;
    }

    // No cast needed: `Array.every`'s type-predicate overload is declared
    // `this is S[]`, so the early return above narrows `entries` itself.
    return entries;
}

/**
 * Persists the pane sizes a completed gutter drag settled on.
 *
 * @param sizes - The capture `Split.getPaneSizes` handed back.
 */
export function savePaneSizes(sizes: LayoutSize[]): void {
    localStorage.setItem(PANE_SIZES_KEY, JSON.stringify(sizes));
}
