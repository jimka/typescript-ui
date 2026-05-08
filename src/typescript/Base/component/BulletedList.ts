// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractListComponent } from "./AbstractListComponent.js";
import { BulletedListItemStyle } from "./BulletedListItemStyle.js";

/**
 * An unordered (bulleted) list component.
 *
 * Renders a `<ul>` element and defaults to the DISC bullet style.
 *
 * @category Components
 */
export class BulletedList extends AbstractListComponent<BulletedListItemStyle> {

    constructor() {
        super("ul", BulletedListItemStyle.DISC);
    }
}
