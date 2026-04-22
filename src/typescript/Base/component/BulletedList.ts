// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractListComponent } from "./AbstractListComponent.js";
import { BulletedListItemStyle } from "./BulletedListItemStyle.js";

export class BulletedList extends AbstractListComponent<BulletedListItemStyle> {

    constructor() {
        super("ul", BulletedListItemStyle.DISC);
    }
}
