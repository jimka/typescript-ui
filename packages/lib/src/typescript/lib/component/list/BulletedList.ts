// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractMarkerList, AbstractMarkerListOptions } from "~/component/list/AbstractMarkerList.js";
import { BulletedListItemStyle } from "~/component/list/BulletedListItemStyle.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link BulletedList}.
 *
 * @category Components
 */
export interface BulletedListOptions extends AbstractMarkerListOptions<BulletedListItemStyle> {
}

/** The character each bullet style paints, keyed by style. */
const BULLET_MARKERS: Record<BulletedListItemStyle, string> = {
    [BulletedListItemStyle.NONE]:   "",
    [BulletedListItemStyle.DISC]:   "•",   // • BULLET
    [BulletedListItemStyle.CIRCLE]: "◦",   // ◦ WHITE BULLET
    [BulletedListItemStyle.SQUARE]: "▪",   // ▪ BLACK SMALL SQUARE
};

/**
 * An unordered (bulleted) list component.
 *
 * Renders a `<ul>` element and defaults to the DISC bullet style. Every
 * [`BulletedListItemStyle`](/api/component/list/enumerations/BulletedListItemStyle)
 * member renders; `NONE` collapses the marker slot away entirely.
 *
 * @category Components
 */
class BulletedList extends AbstractMarkerList<BulletedListItemStyle> {

    constructor(options?: BulletedListOptions) {
        super("ul", BulletedListItemStyle.DISC, options);
    }

    /**
     * Returns the bullet character for the current style. Every item in a
     * bulleted list carries the same marker, so the position is unused.
     *
     * @param _index - The item's position, which does not affect a bullet.
     *
     * @returns The bullet character, or `""` under the NONE style.
     */
    protected markerText(_index: number): string {
        return BULLET_MARKERS[this.getStyle()!];
    }
}

const BulletedListCallable = callable(BulletedList);
type BulletedListCallable = BulletedList;
export {
    BulletedList         as _BulletedList,
    BulletedListCallable as BulletedList
};
