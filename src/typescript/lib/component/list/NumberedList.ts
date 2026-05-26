// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractListComponent, AbstractListOptions } from "~/component/list/AbstractListComponent.js";
import { NumberedListItemStyle } from "~/component/list/NumberedListItemStyle.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link NumberedList}.
 *
 * @category Components
 */
export interface NumberedListOptions extends AbstractListOptions<NumberedListItemStyle> {
}

/**
 * An ordered (numbered) list component.
 *
 * Renders an `<ol>` element and defaults to the DECIMAL numbering style.
 *
 * @category Components
 */
class NumberedList extends AbstractListComponent<NumberedListItemStyle> {

    constructor(options?: NumberedListOptions) {
        super("ol", NumberedListItemStyle.DECIMAL, options);
    }
}

const NumberedListCallable = callable(NumberedList);
type NumberedListCallable = NumberedList;
export {
    NumberedList         as _NumberedList,
    NumberedListCallable as NumberedList
};
