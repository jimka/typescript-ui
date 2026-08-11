// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { Glyph as GlyphComponent } from "~/component/display/Glyph.js";
import { callable } from "~/core/Callable.js";

/**
 * A read-only renderer for cells whose value is a registry glyph name.
 *
 * Displays the value via a [`Glyph`](/api/component/display/classes/Glyph) instance.
 * The glyph follows `currentColor`, so the icon inherits the surrounding cell's
 * foreground colour for free. Caches the last value passed to
 * {@link setValue} so {@link getValue} returns `null` for an empty cell
 * instead of an empty string.
 *
 * @category Components
 */
class GlyphRenderer extends CellRenderer<String | null> {

    private _value: String | null         = null;
    private _glyph: GlyphComponent | null = null;

    /**
     * Returns the cached glyph name, or `null` when the cell is empty.
     *
     * @returns The registry name passed to the most recent {@link setValue} call,
     *   or `null` if the cell has no glyph.
     */
    getValue(): String | null {
        return this._value;
    }

    /**
     * Replaces the displayed glyph with one for the given registry name.
     * `null`, `undefined`, and any other falsy value remove the glyph
     * child entirely so the cell renders blank.
     *
     * @param value - Registry glyph name, or `null`/`undefined`/falsy to
     *   clear the cell.
     *
     * @returns This renderer, for method chaining.
     */
    setValue(value: String | null): this {
        const next = value ? value : null;
        if (next === this._value && (next === null || this._glyph)) {
            return this;
        }

        if (this._glyph) {
            this.removeComponent(this._glyph);
            this._glyph = null;
        }

        this._value = next;

        if (next !== null) {
            this._glyph = new GlyphComponent(next as string);
            this._glyph.setPointerEvents("none");
            this.addComponent(this._glyph);
        }

        // Unlike a text renderer, this one answers a value change by replacing
        // a child component, and the replacement has no bounds until something
        // lays this renderer out. Nothing else will: the owning cell keeps its
        // geometry across a rebind, so the table's cell-geometry diff skips it.
        // Mirrors `Cell.setActiveRenderer`, which lays itself out whenever it
        // swaps the child the layout is fitted around.
        this.doLayout();

        return this;
    }

    /**
     * Returns the registry glyph name currently displayed, or `""` when the
     * cell is empty. Unlike the text renderers there is no `Text` child to
     * mirror — the registry name is the cell's only textual handle, and it
     * is what CSV export writes today.
     *
     * @returns The cell's current display text.
     */
    getDisplayText(): string {
        return this._value === null ? "" : String(this._value);
    }
}

const GlyphRendererCallable = callable(GlyphRenderer);
type GlyphRendererCallable = GlyphRenderer;
export {
    GlyphRenderer         as _GlyphRenderer,
    GlyphRendererCallable as GlyphRenderer
};
