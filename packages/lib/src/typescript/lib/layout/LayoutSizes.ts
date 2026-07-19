// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * How a persisted {@link LayoutSize} entry is measured.
 *
 * @category Layouts
 */
export type LayoutSizeUnit = "px" | "ratio";

/**
 * One pane's or section's persisted size. `px` entries are absolute and
 * restored verbatim; `ratio` entries are a share of the space left after the
 * px entries, and sum to ~1.0 across the ratio entries of one array.
 *
 * @category Layouts
 */
export interface LayoutSize {
    unit:  LayoutSizeUnit;
    value: number;
}

/**
 * Builds a capture from raw stored values: `px` entries are reported
 * verbatim, `ratio` entries are normalised over the ratio subset only — a
 * `px` entry never enters the ratio denominator, so a resize-pinned pane's
 * absolute size cannot skew its siblings' reported shares.
 *
 * @param units - The live unit for each index, in child order.
 * @param stored - The raw stored value for each index, in the same order.
 * @returns One {@link LayoutSize} per index: `px` entries hold the
 *   sanitised stored value; `ratio` entries hold that pane's share of the
 *   ratio subset's stored total, or an equal split when the subset's total
 *   is not positive.
 */
export function toLayoutSizes(units: LayoutSizeUnit[], stored: number[]): LayoutSize[] {
    const clean      = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);
    const ratioCount = units.filter(unit => unit === "ratio").length;

    let ratioTotal = 0;

    for (let idx = 0; idx < units.length; idx += 1) {
        if (units[idx] === "ratio") {
            ratioTotal += clean(stored[idx]);
        }
    }

    return units.map((unit, idx) => {
        if (unit === "px") {
            return { unit, value: clean(stored[idx]) };
        }

        // Equal split among the ratio entries when none carries a stored size —
        // the same fallback `normalizeRatios` applies to a whole-set capture.
        return { unit, value: ratioTotal > 0 ? clean(stored[idx]) / ratioTotal : 1 / ratioCount };
    });
}

/**
 * Converts a captured array back to stored values against a main-axis
 * budget: `px` entries are written verbatim; `ratio` entries are seeded
 * against the room the `px` entries leave (`budget − Σpx`), so a manager's
 * rescale pass lands on scale 1 and the restored geometry renders as saved.
 *
 * @param sizes - The persisted array to restore.
 * @param budget - The live main-axis budget to seed the ratio entries
 *   against; `0` (or a budget the `px` entries alone overrun) falls back to
 *   a unit base, which the manager's own scale-invariant rescale reconciles
 *   on the next layout.
 * @returns One stored value per entry, in the same order as `sizes`.
 */
export function fromLayoutSizes(sizes: LayoutSize[], budget: number): number[] {
    let pxTotal    = 0;
    let ratioTotal = 0;
    let ratioCount = 0;

    for (const size of sizes) {
        if (size.unit === "px") {
            pxTotal += size.value;
        } else {
            ratioTotal += size.value;
            ratioCount += 1;
        }
    }

    // Seed the weighted entries against what the px entries leave, so both
    // managers' rescale passes land on scale 1 and the restore renders as saved.
    // Fall back to a unit base when the container is unsized or the px entries
    // alone overrun it: both managers are scale-invariant over the weighted set,
    // so a unit base lands on the same rendering one pass later.
    const room = budget > 0 ? Math.max(0, budget - pxTotal) : 0;
    const base = room > 0 ? room : 1;

    return sizes.map(size => {
        if (size.unit === "px") {
            return size.value;
        }

        return ratioTotal > 0 ? (size.value / ratioTotal) * base : base / ratioCount;
    });
}

/**
 * Whether a persisted array is safe to restore against the live per-index
 * units: same length, non-empty, every entry's unit matches the live unit
 * at that index, every value is finite and non-negative, and at least one
 * value is positive. A stale array (wrong length, or a unit that no longer
 * matches a pane's weight) fails whole — the caller discards it entirely
 * rather than repairing individual entries.
 *
 * @param sizes - The persisted array to validate.
 * @param units - The live unit for each index, in child order.
 * @returns True when `sizes` is safe to restore as-is.
 */
export function isRestorableSizes(sizes: LayoutSize[], units: LayoutSizeUnit[]): boolean {
    if (units.length === 0 || sizes.length !== units.length) {
        return false;
    }

    const valid = sizes.every((size, idx) =>
        size != null
        && size.unit === units[idx]
        && Number.isFinite(size.value)
        && size.value >= 0);

    return valid && sizes.some(size => size.value > 0);
}

/**
 * Normalises `count` relative weights to ratios summing to 1.0. A
 * non-finite or non-positive weight is treated as `0`; when no weight is
 * positive, every index gets an equal share instead of dividing by a
 * zero sum.
 *
 * @param values - The relative weights, in index order.
 * @param count - The number of entries to normalise; `values` shorter than
 *   this is padded with `0`.
 * @returns `count` ratios summing to ~1.0, or `[]` when `count` is `0`.
 */
export function normalizeRatios(values: number[], count: number): number[] {
    const weights: number[] = [];

    for (let idx = 0; idx < count; idx += 1) {
        const value = values[idx];

        weights.push(Number.isFinite(value) && value > 0 ? value : 0);
    }

    const sum = weights.reduce((total, weight) => total + weight, 0);

    return sum > 0 ? weights.map(weight => weight / sum) : weights.map(() => 1 / count);
}
