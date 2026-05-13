// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractListComponent, AbstractListOptions } from "./AbstractListComponent.js";
import { BulletedListItemStyle } from "./BulletedListItemStyle.js";
import { callable } from "../Callable.js";

/**
 * Construction-time options for {@link BulletedList}.
 *
 * @category Components
 */
export interface BulletedListOptions extends AbstractListOptions<BulletedListItemStyle> {
}

/**
 * An unordered (bulleted) list component.
 *
 * Renders a `<ul>` element and defaults to the DISC bullet style.
 *
 * @category Components
 */
class BulletedList extends AbstractListComponent<BulletedListItemStyle> {

    constructor(options?: BulletedListOptions) {
        super("ul", BulletedListItemStyle.DISC);

        if (options) {
            this.applyOptions(options);
        }
    }
}

const BulletedListCallable = callable(BulletedList);
type BulletedListCallable = BulletedList;
export {
    BulletedList         as _BulletedList,
    BulletedListCallable as BulletedList
};
