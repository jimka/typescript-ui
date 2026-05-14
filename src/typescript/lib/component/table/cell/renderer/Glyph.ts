// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { Glyph as GlyphComponent } from "~/component/display/Glyph.js";
import { callable } from "~/core/Callable.js";

/**
 * A read-only renderer for cells whose value is a registry glyph name.
 *
 * Displays the value via a [`Glyph`](/api/component/display/classes/Glyph) instance.
 * The glyph follows `currentColor`, so the icon inherits the surrounding cell's
 * foreground colour for free.
 *
 * @category Components
 */
class GlyphRenderer extends CellRenderer<String> {

    private _name: String = "";
    private _glyph: GlyphComponent | null = null;

    /**
     * Returns the current displayed glyph name.
     *
     * @returns The registry name passed to the most recent {@link setValue} call.
     */
    getValue(): String {
        return this._name;
    }

    /**
     * Replaces the displayed glyph with one for the given registry name.
     *
     * @param value - Registry glyph name, or a falsy value to clear the cell.
     *
     * @returns This renderer, for method chaining.
     */
    setValue(value: String): this {
        const next = value || "";
        if (next === this._name && this._glyph) {
            return this;
        }

        if (this._glyph) {
            this.removeComponent(this._glyph);
            this._glyph = null;
        }

        this._name = next;

        if (next) {
            this._glyph = new GlyphComponent(next as string);
            this._glyph.setPointerEvents("none");
            this.addComponent(this._glyph);
        }

        return this;
    }
}

const GlyphRendererCallable = callable(GlyphRenderer);
type GlyphRendererCallable = GlyphRenderer;
export {
    GlyphRenderer         as _GlyphRenderer,
    GlyphRendererCallable as GlyphRenderer
};
