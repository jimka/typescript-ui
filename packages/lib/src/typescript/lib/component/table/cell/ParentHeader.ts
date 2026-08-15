// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DefaultCell } from "~/component/table/cell/Default.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Tooltip } from "~/overlay/Tooltip.js";
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
        renderer.setUserSelect("none");
        renderer.getText().setUserSelect("none");
        renderer.setCursor("default");

        // The cell's `Cell` base writes `var(--ts-ui-table-cell-bg, …)` into
        // backgroundColor; override to either the consumer-supplied
        // `groupColor` or `transparent` so the `Header` band's gradient
        // shows through unaltered when no color is set. The base class only
        // re-applies the *border* on theme changes (Cell.ts:51), not the
        // background, so this write survives a theme swap.
        this.setBackgroundColor(color ?? "transparent");

        // Inter-group divider (right edge) and parent-row separator
        // (bottom edge) — two inset shadows in the same resize-handle
        // gray that paints the standard cell separators in the column
        // row beneath. Composing both into a single `setShadow` call
        // sidesteps `Cell`'s theme-change listener (which re-runs
        // `setBorder('var(--ts-ui-table-cell-border, none)')` and would
        // otherwise wipe a border-based divider on every theme toggle).
        this.setShadow([
            "inset -1px 0 0 0 var(--ts-ui-table-resize-handle-color, rgba(0, 0, 0, 0.2))",
            "inset 0 -1px 0 0 var(--ts-ui-table-resize-handle-color, rgba(0, 0, 0, 0.2))",
        ].join(", "));
    }

    /**
     * Registers a listener for this parent header cell's `"contextmenu"`
     * event, fired when the user right-clicks the cell. Mirrors
     * `HeaderCell.on("contextmenu", fn)` but elides the per-column
     * `fieldName` — parent cells span multiple columns, so the host only
     * needs the viewport coordinates to anchor the menu.
     *
     * Wiring: the subtree `contextmenu` DOM listener is installed once at
     * `init` time and fires every registered listener at right-click time —
     * registering after `init` runs is supported (the next right-click
     * picks up the new listener), but the DOM listener itself is not
     * re-installed.
     *
     * @param event - The event name. Only `"contextmenu"` is accepted.
     * @param listener - Receives the viewport x and y coordinates of the event.
     *
     * @returns This cell, for method chaining.
     */
    on(event: "contextmenu", listener: (x: number, y: number) => void): this;
    on(event: "commit",      listener: (value: String | null) => void): this;
    on(event: "editend",     listener: () => void): this;
    on(event: string,        listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback
     * reference must match the one passed to {@link on}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This cell, for method chaining.
     */
    off(event: string, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every registered listener for `event`, in registration order.
     * Widens the inherited {@link Cell} emitter with the `"contextmenu"`
     * event carrying the right-click's viewport coordinates.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "contextmenu", x: number, y: number): void;
    protected emit(event: "commit",      value: String | null): void;
    protected emit(event: "editend"): void;
    protected emit(event: string, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Sets the tooltip shown when hovering this parent header cell.
     * Wired through the framework's shared [`Tooltip`](/api/overlay/classes/Tooltip)
     * attach path, same as `HeaderCell.setTooltip`. Safe to call before or
     * after the cell has rendered: pre-init calls are picked up by `init`
     * when it wires the tooltip attachment; post-init calls re-attach
     * against the live element so the visible tooltip updates immediately.
     *
     * @param text - The text to display in the tooltip.
     */
    setTooltip(text: string): this {
        this._tooltipText = text;

        const el = this.getElement();

        if (el) {
            Tooltip.attachToElement(el, text);
        }

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
    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement();

        if (!el) {
            return this;
        }

        Event.addSubtreeListener(this, "contextmenu", { button: "any", handler: this.onContextMenu });

        if (this._tooltipText) {
            Tooltip.attachToElement(el, this._tooltipText);
        }

        return this;
    }

    /**
     * Subtree contextmenu handler. Suppresses the browser's native menu
     * and fires the `"contextmenu"` event with the viewport coordinates
     * (the host's listener typically opens the table's column-toggle menu).
     *
     * @param e - The contextmenu event captured from a descendant.
     */
    private onContextMenu(e: MouseEvent): Event.ListenerResult {
        this.emit("contextmenu", e.clientX, e.clientY);

        return { prevent: true };
    }
}

const ParentHeaderCellCallable = callable(ParentHeaderCell);
type ParentHeaderCellCallable = ParentHeaderCell;
export {
    ParentHeaderCell         as _ParentHeaderCell,
    ParentHeaderCellCallable as ParentHeaderCell
};
