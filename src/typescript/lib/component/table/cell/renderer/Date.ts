// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "./CellRenderer.js";
import { Text } from "../../../../component/Text.js";
import { callable } from "../../../../Callable.js";

/**
 * A read-only renderer for date cell values.
 *
 * Displays the value via a {@link Text} formatted with `Date.toLocaleDateString`.
 */
class DateRenderer extends CellRenderer<Date | null> {

    private text: Text = new Text();
    private value: Date | null = null;

    constructor() {
        super();

        this.text.setText("");
        this.text.setPointerEvents("none");
        this.text.setAutoMeasure(false);
        this.addComponent(this.text);
    }

    getValue(): Date | null {
        return this.value;
    }

    setValue(value: Date | null): this {
        this.value = value ?? null;
        this.text.setText(value ? value.toLocaleDateString() : "");

        return this;
    }
}

const DateRendererCallable = callable(DateRenderer);
type DateRendererCallable = DateRenderer;
export {
    DateRenderer         as _DateRenderer,
    DateRendererCallable as DateRenderer
};
