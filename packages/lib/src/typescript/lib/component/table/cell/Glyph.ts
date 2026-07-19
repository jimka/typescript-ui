// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import { GlyphRenderer } from "~/component/table/cell/renderer/Glyph.js";
import { callable } from "~/core/Callable.js";

/**
 * A read-only table cell whose value is a registry glyph name.
 *
 * Uses a [`GlyphRenderer`](/api/component/table/classes/GlyphRenderer) for display.
 * No editor counterpart — editing a glyph by typing into a cell is not supported.
 *
 * @category Components
 */
class GlyphCell extends Cell<String | null> {

    constructor() {
        let renderer = new GlyphRenderer();

        super("td", renderer);
    }

    /**
     * Sets the displayed glyph name on the renderer. `null`, `undefined`,
     * and any falsy value remove the glyph child so the cell renders
     * blank.
     *
     * @param value - The registry glyph name to display, or
     *   `null`/`undefined`/falsy to clear the cell.
     */
    setValue(value: String | null): this {
        this.getRenderer().setValue(value);

        return this;
    }
}

const GlyphCellCallable = callable(GlyphCell);
type GlyphCellCallable = GlyphCell;
export {
    GlyphCell         as _GlyphCell,
    GlyphCellCallable as GlyphCell
};
