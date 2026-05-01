// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DefaultCell } from "./Default.js";

/**
 * A non-editable header cell rendered as a `<th>` element.
 *
 * Extends {@link DefaultCell} and immediately configures the renderer label
 * with bold, 13px text from the supplied column title.
 */
export class HeaderCell extends DefaultCell {

    /**
     * Creates a header cell and sets the label text.
     *
     * @param text - The column title to display in the header cell.
     */
    constructor(text: String) {
        super("th");

        let renderer = this.getRenderer();
        renderer.getLabel().setFontSize("--ts-ui-table-header-font-size");
        renderer.getLabel().setFontWeight("bold");
        renderer.getLabel().setText(text);
    }
}