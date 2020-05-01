import { AbstractListComponent } from "./AbstractListComponent.js";
import { NumberedListItemStyle } from "./NumberedListItemStyle.js";

export class NumberedList extends AbstractListComponent<NumberedListItemStyle> {

    constructor() {
        super("ol", NumberedListItemStyle.DECIMAL);
    }
}
