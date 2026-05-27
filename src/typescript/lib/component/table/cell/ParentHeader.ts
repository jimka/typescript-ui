// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DefaultCell } from "~/component/table/cell/Default.js";
import { Event } from "~/core/Event.js";
import { Tooltip } from "~/core/Tooltip.js";
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
 * columns; they exist so the parent header band has a continuous
 * surface with no gaps where the body background would otherwise leak
 * through.
 *
 * Sort / resize wiring is intentionally absent — parent cells do not
 * participate in the per-column sort cycle or carry resize handles.
 * They do support a right-click context menu (forwarded through the
 * same callback the column cells use, so the column-toggle menu opens
 * on either row), and a tooltip.
 *
 * @category Components
 */
class ParentHeaderCell extends DefaultCell {

    private _text: string;
    private _color: string | null;
    private _tooltipText: string = "";
    private _onContextMenuCallback: ((x: number, y: number) => void) | null = null;

    /**
     * Constructs a parent header cell over a contiguous run of grouped
     * columns.
     *
     * @param text - The group label to display. Empty string renders a
     *   blank spanning cell over ungrouped columns.
     * @param color - Optional CSS color string for the cell's background;
     *   `null` falls through to the header-band gradient inherited from
     *   the `Header` parent.
     */
    constructor(text: string, color: string | null) {
        super("th");

        this._text  = text;
        this._color = color;

        this.getAria().setRole("columnheader");

        const renderer = this.getRenderer();
        renderer.getText().setFontSize("--ts-ui-table-header-font-size");
        renderer.getText().setFontWeight("bold");
        renderer.getText().setTextAlign("center");
        renderer.getText().setText(text);

        // The cell's `Cell` base writes `var(--ts-ui-table-cell-bg, …)` into
        // backgroundColor; override to either the consumer-supplied
        // `groupColor` or `transparent` so the `Header` band's gradient
        // shows through unaltered when no color is set. The base class only
        // re-applies the *border* on theme changes (Cell.ts:51), not the
        // background, so this write survives a theme swap.
        this.setBackgroundColor(color ?? "transparent");

        // Inter-group divider: an inset right-edge shadow in the same
        // resize-handle gray that paints the standard cell separators in
        // the column row beneath. Using `setShadow` instead of `setBorder`
        // sidesteps `Cell`'s theme-change listener (which re-runs
        // `setBorder('var(--ts-ui-table-cell-border, none)')` and would
        // otherwise wipe a border-based divider on every theme toggle).
        this.setShadow(
            "inset -1px 0 0 0 var(--ts-ui-table-resize-handle-color, rgba(0, 0, 0, 0.2))",
        );
    }

    /**
     * Registers a callback invoked when the user right-clicks this parent
     * header cell. Mirrors {@link HeaderCell.setOnContextMenu} but elides
     * the per-column `fieldName` — parent cells span multiple columns, so
     * the host only needs the viewport coordinates to anchor the menu.
     *
     * @param fn - Receives the viewport x and y coordinates of the event.
     */
    setOnContextMenu(fn: (x: number, y: number) => void): this {
        this._onContextMenuCallback = fn;

        return this;
    }

    /**
     * Sets the tooltip shown when hovering this parent header cell.
     * Wired through the framework's shared {@link Tooltip} attach path,
     * same as `HeaderCell.setTooltip`.
     *
     * @param text - The text to display in the tooltip.
     */
    setTooltip(text: string): this {
        this._tooltipText = text;

        return this;
    }

    /**
     * Returns the tooltip text shown when hovering this cell.
     *
     * @returns The current tooltip string (empty when no tooltip has been set).
     */
    getTooltip(): string {
        return this._tooltipText;
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
     * Returns the optional background color this cell adopts, or `null`
     * when the header-band gradient shows through unaltered.
     *
     * @returns The CSS color string, or `null`.
     */
    getColor(): string | null {
        return this._color;
    }

    /**
     * Wires the host-supplied context-menu listener and attaches the
     * tooltip after the framework has mounted the element. Sub-tree
     * listener so right-clicks on the rendered label bubble up here.
     *
     * @param element - Optional element forwarded by the framework init chain.
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();

        if (!el) {
            return this;
        }

        Event.addSubtreeListener(this, "contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this._onContextMenuCallback?.(e.clientX, e.clientY);
        });

        if (this._tooltipText) {
            Tooltip.attachToElement(el, this._tooltipText);
        }

        return this;
    }
}

const ParentHeaderCellCallable = callable(ParentHeaderCell);
type ParentHeaderCellCallable = ParentHeaderCell;
export {
    ParentHeaderCell         as _ParentHeaderCell,
    ParentHeaderCellCallable as ParentHeaderCell
};
