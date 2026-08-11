// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Fit } from "~/layout/Fit.js";
import { Insets } from "~/primitive/Insets.js";
import { Text } from "~/component/input/Text.js";
import { ThemeManager } from "~/core/Theme.js";

/**
 * Abstract base class for cell renderers.
 *
 * Subclasses display a typed value inside a table cell using a Fit layout with theme-driven padding.
 *
 * @category Components
 */
export abstract class CellRenderer<T> extends Component {

    constructor() {
        super();

        this.setLayoutManager(new Fit());

        // Inlined (rather than a private method) so CellRenderer and CellEditor stay
        // structurally compatible — BooleanCell relies on a CellEditor doubling as the
        // renderer, which fails if both classes declare a private member of the same name.
        const applyPadding = () => {
            const p = ThemeManager.getTheme().table.cell.padding;
            this.setInsets(new Insets(0, p, 0, p));
        };

        applyPadding();

        this.subscribeTheme(applyPadding);
    }

    /**
     * Returns the currently displayed value.
     *
     * @returns The rendered value of type T.
     */
    abstract getValue(): T;

    /**
     * Updates the displayed value.
     *
     * @remarks
     * An implementation that adds, removes or replaces a child component must
     * end by calling `this.doLayout()`, because the new child has no bounds
     * until something lays this renderer out and nothing else will: the table
     * skips the layout for a cell whose geometry has not moved, and rebinding a
     * row to new data does not move it. `GlyphRenderer` is the framework's own
     * example. An implementation that only writes text needs no layout — the
     * text does not auto-measure — which is the common case.
     *
     * @param t - The value to render.
     */
    abstract setValue(t: T): void;

    /**
     * Returns the x offset (in this renderer's local space) at which
     * the cell's actual content begins. Defaults to `0` — the typed
     * renderer fills its box from the left.
     *
     * Overridden by [`TreeCellRenderer`](/api/component/table/classes/TreeCellRenderer)
     * to reserve space for the indent + toggle column. The owning
     * {@link Cell} consults this on every `doLayout` so the editor
     * stays visually aligned with where the renderer's content sat,
     * instead of snapping to the left cell edge on edit.
     *
     * @returns The pixels reserved at the left of the renderer's box
     *   before its content begins.
     */
    getContentX(): number {
        return 0;
    }

    /**
     * Returns the exact text this cell shows the user — the string the
     * cell's own `Text` child was last given, computed from state cached in
     * {@link setValue} and never read from the DOM. Safe to call on a
     * renderer that was constructed, fed a value, and never rendered.
     *
     * Defaults to `""`. Every built-in renderer overrides this to return
     * its actual displayed text; the default is what a consumer-authored
     * `CellRenderer` subclass answers until it opts in, and the honest
     * answer for a renderer that draws no text at all (e.g. a chart or
     * badge renderer).
     *
     * @returns The cell's current display text.
     */
    getDisplayText(): string {
        return "";
    }

    /**
     * Runs the Fit layout, then synchronises the Text child's `line-height`
     * to its own element height. A single-line `<span>` whose `line-height`
     * matches its block height renders the text glyphs vertically centered;
     * without this, the line-box sits at the top of the cell and leaves the
     * empty space below.
     *
     * Cell renderer Texts have `setAutoMeasure(false)`, so `setLineHeight`
     * skips its DOM measurement and only writes the CSS rule.
     */
    doLayout(): this {
        super.doLayout();

        const children = this.getComponents();
        if (children.length !== 1) {
            return this;
        }

        const child = children[0];
        if (!(child instanceof Text)) {
            return this;
        }

        const h = child.getHeight();
        if (h > 0) {
            child.setLineHeight(h);
        }

        return this;
    }
}