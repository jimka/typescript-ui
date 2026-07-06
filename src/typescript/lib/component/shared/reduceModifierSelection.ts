// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Applies the modifier-key selection ladder — shift-range / ctrl-toggle /
 * plain-replace — to `selection` in place, over an arbitrary identity type.
 * The data views share this ladder; only the identity (`ModelRecord`, integer
 * index) and the order lookup differ, so both are passed in as accessors.
 *
 * - **shift with an anchor**: selects the inclusive range between the anchor's
 *   and target's display positions. When `ctrl` is absent the prior selection
 *   is cleared first; when present the range is unioned onto it. The anchor is
 *   left unchanged (shift moves the focus end only) and returned as-is.
 * - **ctrl** (including shift with no anchor + ctrl): toggles `target` in the
 *   selection; `target` becomes the new anchor.
 * - **plain** (including shift with no anchor): clears the selection and
 *   selects `target`; `target` becomes the new anchor.
 *
 * Pure apart from mutating `selection`; no DOM, no component state.
 *
 * @typeParam T - The selection identity type.
 * @param selection - The live selection set, mutated in place.
 * @param anchor - The current selection anchor, or `null`.
 * @param target - The gesture's target member.
 * @param indexOf - Resolves a member's position in display order.
 * @param at - Resolves the member at a display position.
 * @param ev - The normalised modifier flags.
 * @returns The new anchor the caller should store.
 *
 * @internal Shared by `Body` and `MultiSelectList`; not barrel-exported.
 */
export function reduceModifierSelection<T>(
    selection: Set<T>,
    anchor: T | null,
    target: T,
    indexOf: (t: T) => number,
    at: (i: number) => T,
    ev: { ctrl: boolean; shift: boolean },
): T | null {
    if (ev.shift && anchor !== null) {
        const anchorIdx = indexOf(anchor);
        const targetIdx = indexOf(target);
        const lo = Math.min(anchorIdx, targetIdx);
        const hi = Math.max(anchorIdx, targetIdx);

        if (!ev.ctrl) {
            selection.clear();
        }

        for (let i = lo; i <= hi; i++) {
            selection.add(at(i));
        }

        return anchor;
    }

    if (ev.ctrl) {
        if (selection.has(target)) {
            selection.delete(target);
        } else {
            selection.add(target);
        }

        return target;
    }

    selection.clear();
    selection.add(target);

    return target;
}
