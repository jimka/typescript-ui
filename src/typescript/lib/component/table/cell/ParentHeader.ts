// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DefaultCell } from "~/component/table/cell/Default.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { callable } from "~/core/Callable.js";

/**
 * A non-interactive header cell that labels a contiguous run of columns in
 * the parent-header row. Constructed once per visible group by the
 * [`Header`](/api/component/table/classes/Header) host (private
 * `rebuildParentCells`) and laid out via the table layout manager: x
 * and width are summed from the underlying column widths so the parent
 * cell visually spans its children.
 *
 * Empty-text instances render as blank spanning cells over ungrouped
 * columns; they exist so the parent header band has a continuous surface
 * with no gaps where the body background would otherwise leak through.
 *
 * Click / sort wiring is intentionally absent — parent cells do not
 * participate in the per-column sort cycle. Reordering and resizing remain
 * per-column gestures on the column-header row beneath.
 *
 * @category Components
 */
class ParentHeaderCell extends DefaultCell {

    private _text: string;
    private _color: string | null;
    private _isLast: boolean;

    /**
     * @param text - The group label to display. Empty string renders a blank
     *   spanning cell over ungrouped columns.
     * @param color - Optional CSS color string for the cell's background;
     *   `null` falls through to the header-band gradient inherited from the
     *   `Header` parent.
     * @param isLast - When false, paints the right-edge inter-group divider
     *   matching the existing header bottom border token.
     */
    constructor(text: string, color: string | null, isLast: boolean) {
        super("th");

        this._text   = text;
        this._color  = color;
        this._isLast = isLast;

        const renderer = this.getRenderer();
        renderer.getText().setFontSize("--ts-ui-table-header-font-size");
        renderer.getText().setFontWeight("bold");
        renderer.getText().setText(text);

        // The cell's `Cell` base writes `var(--ts-ui-table-cell-bg, …)` into
        // backgroundColor; override to either the consumer-supplied
        // `groupColor` or `transparent` so the `Header` band's gradient
        // shows through unaltered.
        this.setBackgroundColor(color ?? "transparent");

        // Right-edge inter-group divider on every non-final parent cell.
        // The bottom border lives on the `Header` itself; this rule only
        // paints the vertical separator between adjacent runs so the eye
        // reads one continuous boundary between groups.
        if (!isLast) {
            this.setBorder({
                right: {
                    style: BorderStyle.SOLID,
                    width: 1,
                    color: "var(--ts-ui-table-header-border, black)",
                },
            });
        } else {
            this.setBorder({ style: BorderStyle.NONE });
        }
    }

    /**
     * Returns the group label rendered in this cell.
     *
     * @returns The label string; empty when the cell is a blank ungrouped span.
     */
    getText(): string {
        return this._text;
    }

    /**
     * Returns the optional background color this cell adopts, or `null` when
     * the header-band gradient shows through unaltered.
     *
     * @returns The CSS color string, or `null`.
     */
    getColor(): string | null {
        return this._color;
    }

    /**
     * Returns whether this cell is the last in the parent row. The last
     * cell has no right-edge divider so the parent band's right boundary
     * stays clean.
     *
     * @returns `true` when this is the right-most parent cell.
     */
    isLastInRow(): boolean {
        return this._isLast;
    }
}

const ParentHeaderCellCallable = callable(ParentHeaderCell);
type ParentHeaderCellCallable = ParentHeaderCell;
export {
    ParentHeaderCell         as _ParentHeaderCell,
    ParentHeaderCellCallable as ParentHeaderCell
};
