// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DefaultCell } from "~/component/table/cell/Default.js";
import { Event } from "~/core/Event.js";
import { Util } from "~/core/Util.js";
import { CSS } from "~/core/CSS.js";
import { Tooltip } from "~/core/Tooltip.js";
import { callable } from "~/core/Callable.js";

/**
 * A non-editable header cell rendered as a `<th>` element.
 *
 * Extends {@link DefaultCell} with a sort state indicator (▲/▼ suffix on the label),
 * a click-to-sort callback, and a drag handle at the right edge for column resizing.
 *
 * The resize handle is a raw `<div>` (not a Component) appended in `init()`. Native
 * listeners are used on the div; `Event.addViewportListener` is used for the
 * mousemove/mouseup drag phase so they route through the framework's event system.
 *
 * @category Components
 */
class HeaderCell extends DefaultCell {

    private _text: String;
    private _fieldName: string;
    private _onSortClickCallback: ((fieldName: string, shiftKey: boolean) => void) | null = null;
    private _onContextMenuCallback: ((fieldName: string, x: number, y: number) => void) | null = null;
    private _resizeDragCallback: ((delta: number) => void) | null = null;
    private _isDragging: boolean = false;
    private _tooltipText: string = '';
    private _priorityBadge: HTMLSpanElement | null = null;

    /**
     * Creates a header cell with bold text and wires up the sort click listener.
     *
     * @param text - The column title to display.
     * @param fieldName - The model field name used when triggering sort callbacks.
     */
    constructor(text: String, fieldName: string) {
        super("th");

        this.getAria().setRole("columnheader");
        this.getAria().setSort("none");

        this._text = text;
        this._fieldName = fieldName;

        let renderer = this.getRenderer();
        renderer.getText().setFontSize("--ts-ui-table-header-font-size");
        renderer.getText().setFontWeight("bold");
        renderer.getText().setText(text);

        const activeRule = CSS.createComponentRule(this.getId() + ':active');

        if (activeRule) {
            activeRule.style.setProperty('box-shadow', 'var(--ts-ui-button-pressed-shadow, 1px 2px 5px 0 rgba(0,0,0,0.2) inset)');
        }
    }

    /**
     * Appends the resize handle div to the rendered element.
     *
     * @param element - Optional element passed from the framework init chain.
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();

        if (!el) {
            return this;
        }

        // Native listener so clicks on any child element (e.g. the Label) bubble up here.
        el.addEventListener('click', (e: MouseEvent) => this.onSortClick(e.shiftKey));

        el.addEventListener('contextmenu', (e: MouseEvent) => {
            e.preventDefault();

            this._onContextMenuCallback?.(this._fieldName, e.clientX, e.clientY);
        });

        const handle = document.createElement('div');

        // Thin vertical bar (right 2 px of the 5 px hit area) as visual drag indicator.
        handle.style.cssText = 'position:absolute;top:0;right:0;width:5px;height:100%;cursor:ew-resize;z-index:1;' +
                               'background:linear-gradient(to right,transparent 60%,rgba(0,0,0,0.2) 60%);';
        handle.addEventListener('mousedown', (e: MouseEvent) => this.onResizeDragStart(e));
        handle.addEventListener('click', (e: MouseEvent) => e.stopPropagation()); // never trigger sort

        el.appendChild(handle);

        const badge = document.createElement('span');

        // Multi-sort priority indicator. Shown only when two or more sorters are active.
        badge.style.cssText =
            'position:absolute;top:2px;right:8px;font-size:10px;line-height:1;' +
            'background:var(--ts-ui-sort-badge-bg,rgba(0,0,0,0.15));' +
            'color:var(--ts-ui-sort-badge-color,inherit);' +
            'border-radius:3px;padding:1px 3px;display:none;pointer-events:none;';

        el.appendChild(badge);
        this._priorityBadge = badge;

        if (this._tooltipText) {
            Tooltip.attachToElement(el, this._tooltipText);
        }

        return this;
    }

    /**
     * Updates the label to show a sort direction arrow suffix and toggles the
     * multi-sort priority badge.
     *
     * @param state - 'asc' or 'desc'. Use `clearSortState()` to remove the indicator.
     * @param priority - Optional 1-based position of this sorter in a multi-sort.
     *   The badge is only shown when priority is at least 2.
     */
    setSortState(state: 'asc' | 'desc', priority?: number | null): this {
        const arrow = state === 'asc' ? ' ▲' : ' ▼';

        this.getRenderer().getText().setText(this._text + arrow);
        this.getAria().setSort(state === 'asc' ? 'ascending' : 'descending');

        if (this._priorityBadge) {
            const showBadge = priority != null && priority >= 2;

            this._priorityBadge.textContent   = showBadge ? String(priority) : '';
            this._priorityBadge.style.display = showBadge ? '' : 'none';
        }

        return this;
    }

    /**
     * Clears the sort indicator arrow and hides the multi-sort priority badge.
     *
     * @returns This cell, for method chaining.
     */
    clearSortState(): this {
        this.getRenderer().getText().setText(this._text);
        this.getAria().setSort('none');

        if (this._priorityBadge) {
            this._priorityBadge.textContent   = '';
            this._priorityBadge.style.display = 'none';
        }

        return this;
    }

    /**
     * Registers the callback invoked when the user clicks to sort this column.
     *
     * @param fn - Receives the field name for this column and whether the
     *   shift key was held during the click (used to compose multi-column sort).
     */
    setOnSortClick(fn: (fieldName: string, shiftKey: boolean) => void): void {
        this._onSortClickCallback = fn;
    }

    /**
     * Registers the callback invoked when the user right-clicks this header cell.
     *
     * @param fn - Receives the field name, and the viewport x/y coordinates of the event.
     */
    setOnContextMenu(fn: (fieldName: string, x: number, y: number) => void): void {
        this._onContextMenuCallback = fn;
    }

    /**
     * Registers the callback invoked with the horizontal pixel delta on each drag move.
     *
     * @param fn - Receives movementX on each mousemove during a resize drag.
     */
    /**
     * Sets the tooltip text shown when hovering this header cell.
     *
     * @param text - The text to display in the tooltip.
     */
    setTooltip(text: string): this {
        this._tooltipText = text;

        return this;
    }

    /**
     * Registers the callback invoked with the horizontal pixel delta on each drag move.
     *
     * @param fn - Receives movementX on each mousemove during a resize drag.
     */
    setOnResizeDrag(fn: (delta: number) => void): void {
        this._resizeDragCallback = fn;
    }

    /**
     * Routes a click on the header to the registered sort callback,
     * unless a resize drag has just finished.
     *
     * @param shiftKey - Whether the shift key was held when the click fired.
     */
    private onSortClick(shiftKey: boolean): void {
        if (this._isDragging) {
            this._isDragging = false;
            return;
        }

        this._onSortClickCallback?.(this._fieldName, shiftKey);
    }

    private onResizeDragStart(e: MouseEvent): void {
        e.stopPropagation();

        this._isDragging = true;

        Event.addViewportListener(this, 'mousemove', this.onResizeDrag);
        Event.addViewportListener(this, 'mouseup', this.onResizeDragStop);

        Util.select('body').style.pointerEvents = 'none';
    }

    private onResizeDrag(e: MouseEvent): void {
        this._resizeDragCallback?.(e.movementX);
    }

    private onResizeDragStop(): void {
        Event.removeViewportListener(this, 'mousemove', this.onResizeDrag);
        Event.removeViewportListener(this, 'mouseup', this.onResizeDragStop);

        Util.select('body').style.pointerEvents = '';

        // clear flag after synthesized click fires
        setTimeout(() => { this._isDragging = false; }, 0);
    }
}

const HeaderCellCallable = callable(HeaderCell);
type HeaderCellCallable = HeaderCell;
export {
    HeaderCell         as _HeaderCell,
    HeaderCellCallable as HeaderCell
};
