// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractListComponent } from "./AbstractListComponent.js";
import { NumberedListItemStyle } from "./NumberedListItemStyle.js";

export class NumberedList extends AbstractListComponent<NumberedListItemStyle> {

    constructor() {
        super("ol", NumberedListItemStyle.DECIMAL);
    }
}
