// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The set of tabs a bulk-close context-menu action targets, relative to the
 * right-clicked tab.
 *
 * - `"all"` — every tab.
 * - `"others"` — every tab except the clicked one.
 * - `"right"` — the tabs after the clicked one in strip order.
 * - `"left"` — the tabs before the clicked one in strip order.
 *
 * @category Components
 */
export type BulkCloseScope = "others" | "right" | "left" | "all";

/**
 * Computes the ordered tab ids a bulk-close action should close, pre-filtered to
 * closeable tabs. Pure and framework-free so it is unit-testable outside the DOM
 * harness; the result is a stable snapshot the caller emits over without ever
 * re-reading the live tab list (each close mutates that list).
 *
 * @param ids - The tab ids in strip order.
 * @param clickedIndex - The right-clicked tab's index within `ids`.
 * @param isCloseable - Predicate reporting whether the tab with a given id is closeable.
 * @param scope - Which tabs, relative to the clicked one, the action targets.
 *
 * @returns The closeable ids in strip order for `scope`; `"all"` includes the
 *   clicked tab, `"others"` excludes it.
 */
export function computeBulkCloseIds(
    ids: readonly string[],
    clickedIndex: number,
    isCloseable: (id: string) => boolean,
    scope: BulkCloseScope,
): string[] {
    const inScope = ids.filter((_id, i) => {
        switch (scope) {
            case "all":    return true;
            case "others": return i !== clickedIndex;
            case "right":  return i > clickedIndex;
            case "left":   return i < clickedIndex;
        }
    });

    return inScope.filter(isCloseable);
}
