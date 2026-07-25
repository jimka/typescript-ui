// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Compares two selection sets by membership only — size and element
 * identity, regardless of insertion order.
 *
 * Pure; no DOM, no component state.
 *
 * @typeParam T - The selection identity type.
 * @param a - One selection set.
 * @param b - The other selection set.
 * @returns `true` when both sets have the same size and every member of
 *   `a` is present in `b`.
 *
 * @internal Shared by `Tree` and `Body`; not barrel-exported.
 */
export function selectionsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
    if (a.size !== b.size) {
        return false;
    }

    for (const item of a) {
        if (!b.has(item)) {
            return false;
        }
    }

    return true;
}
