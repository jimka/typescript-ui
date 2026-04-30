// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractListComponent } from "./AbstractListComponent.js";
import { NumberedListItemStyle } from "./NumberedListItemStyle.js";

/**
 * An ordered (numbered) list component.
 *
 * Renders an `<ol>` element and defaults to the DECIMAL numbering style.
 */
export class NumberedList extends AbstractListComponent<NumberedListItemStyle> {

    constructor() {
        super("ol", NumberedListItemStyle.DECIMAL);
    }
}
