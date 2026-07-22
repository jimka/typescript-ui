/**
 * Compares two sidebar labels for display order. `numeric: true` so `Foo2`
 * sorts before `Foo10`; `sensitivity: 'base'` so a lower-case label
 * interleaves with upper-case ones rather than being pushed into a separate
 * block by code-point order.
 *
 * @param a - The first label.
 * @param b - The second label.
 * @returns A negative number if `a` sorts first, positive if `b` sorts
 *   first, `0` if they are equivalent under these options.
 */
export function compareLabels(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
