// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** An axis-aligned box in unscaled graph coordinates. @internal */
export interface DiagramRect { x: number; y: number; width: number; height: number; }

/**
 * Inflates `rect` by `fraction` of its own width on the left/right and its
 * own height on the top/bottom.
 *
 * @param rect - The rectangle to inflate.
 * @param fraction - The fraction of the rect's own extent to add on each side.
 * @returns The inflated rectangle.
 *
 * @internal
 */
export function inflateRect(rect: DiagramRect, fraction: number): DiagramRect {
    const dx = rect.width  * fraction;
    const dy = rect.height * fraction;

    return { x: rect.x - dx, y: rect.y - dy, width: rect.width + 2 * dx, height: rect.height + 2 * dy };
}

/**
 * Whether the residency set must be rebuilt for `live`, given the rectangle
 * it was last committed for. `true` when nothing has been committed yet, when
 * `live`'s extents differ from `committed`'s (a zoom or a viewport resize —
 * the residency rect's size must track it exactly), or when `live` has
 * escaped the *trigger rect*: `committed` inflated by half of `margin`. This
 * is the hysteresis that lets an ordinary pan or a slow zoom change the
 * mounted set a few times per screen of travel instead of on every transform
 * write — see `computePoolTarget` in `VirtualRowView.ts` and
 * `computeColumnWindowSize` in `table/Body.ts` for the same "derive the
 * rendered set from the viewport, not the current position" rule on the
 * row/column axes.
 *
 * @param committed - The rectangle the residency set was last computed for, or `null` before the first computation.
 * @param live - The current visible graph rectangle.
 * @param margin - The residency margin (see {@link RESIDENCY_MARGIN}); half of it is the trigger-rect inflation.
 * @returns Whether the residency set must be recomputed.
 *
 * @internal
 */
export function residencyNeedsRefresh(committed: DiagramRect | null, live: DiagramRect, margin: number): boolean {
    if (committed === null) {
        return true;
    }

    if (live.width !== committed.width || live.height !== committed.height) {
        return true;
    }

    const trigger = inflateRect(committed, margin / 2);

    return live.x < trigger.x
        || live.y < trigger.y
        || live.x + live.width  > trigger.x + trigger.width
        || live.y + live.height > trigger.y + trigger.height;
}

/**
 * Every id whose box intersects `residency`; an id with no entry in `rects`
 * is always resident (nothing has placed it yet, so it has no box to test,
 * and it cannot be culled). Intersection is inclusive — a box touching the
 * residency rect edge-to-edge counts as resident.
 *
 * @param ids - Every id to test.
 * @param rects - Laid-out box per id.
 * @param residency - The residency rectangle to test each box against.
 * @returns The set of resident ids.
 *
 * @internal
 */
export function computeResidentIds(ids: Iterable<string>, rects: Map<string, DiagramRect>, residency: DiagramRect): Set<string> {
    const resident = new Set<string>();
    const residencyRight  = residency.x + residency.width;
    const residencyBottom = residency.y + residency.height;

    for (const id of ids) {
        const rect = rects.get(id);

        if (!rect) {
            resident.add(id);

            continue;
        }

        const intersects = rect.x <= residencyRight && rect.x + rect.width >= residency.x
            && rect.y <= residencyBottom && rect.y + rect.height >= residency.y;

        if (intersects) {
            resident.add(id);
        }
    }

    return resident;
}
