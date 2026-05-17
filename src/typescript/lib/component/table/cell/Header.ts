// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DefaultCell } from "~/component/table/cell/Default.js";
import { Event } from "~/core/Event.js";
import { Util } from "~/core/Util.js";
import { CSS } from "~/core/CSS.js";
import { Tooltip } from "~/core/Tooltip.js";
import { ThemeManager } from "~/core/Theme.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Insets } from "~/primitive/Insets.js";
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
    private _sortState: { state: 'asc' | 'desc', priority: number | null } | null = null;
    private _headerGlyph: string | null = null;
    private _headerGlyphInstance: Glyph | null = null;

    /**
     * Creates a header cell with bold text and wires up the sort click listener.
     *
     * @param text - The column title to display.
     * @param fieldName - The model field name used when triggering sort callbacks.
     * @param headerGlyph - Optional registry glyph name mounted to the left of the text.
     */
    constructor(text: String, fieldName: string, headerGlyph?: string | null) {
        super("th");

        this.getAria().setRole("columnheader");
        this.getAria().setSort("none");

        this._text = text;
        this._fieldName = fieldName;
        this._headerGlyph = headerGlyph ?? null;

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

        if (this._headerGlyph) {
            this._mountHeaderGlyph(el);
        }

        return this;
    }

    /**
     * Returns the currently mounted header glyph registry name, or `null` if none.
     *
     * @returns The glyph registry name, or `null`.
     */
    getHeaderGlyph(): string | null {
        return this._headerGlyph;
    }

    /**
     * Mounts (or replaces) the leading header glyph. Pass `null` to remove it.
     *
     * The glyph is absolutely positioned at the cell's left edge using the
     * `--ts-ui-table-header-glyph-gap` / `--ts-ui-table-header-glyph-color`
     * tokens. The text renderer's left inset is shifted right to clear the
     * glyph when one is mounted, and restored to the theme default when cleared.
     *
     * @param name - A registered glyph name, or `null` to remove the glyph.
     * @returns This cell, for method chaining.
     */
    setHeaderGlyph(name: string | null): this {
        this._headerGlyph = name;
        this._mountHeaderGlyph(this.getElement());

        return this;
    }

    /**
     * Mounts or replaces the leading glyph against the given host element.
     * Called from {@link setHeaderGlyph} (post-init via cached element) and
     * from {@link init} (during render via the element parameter, before
     * `Component._element` has been cached).
     *
     * @param el - The owning `<th>` element, or undefined when the cell is
     *   still pre-render. When undefined the renderer insets are reset but
     *   no glyph is mounted; the next render's {@link init} call will mount
     *   the glyph using its element parameter.
     */
    private _mountHeaderGlyph(el: HTMLElement | undefined): void {
        if (this._headerGlyphInstance) {
            this._headerGlyphInstance.getElement()?.remove();
            this._headerGlyphInstance = null;
        }

        const themePad = ThemeManager.getTheme().table.cell.padding;
        const name     = this._headerGlyph;

        if (!name || !el) {
            this.getRenderer().setInsets(new Insets(0, themePad, 0, themePad));

            return;
        }

        const glyph = new Glyph(name);
        const gEl   = glyph.getElement(true);

        gEl.style.cssText =
            'position:absolute;left:var(--ts-ui-table-header-glyph-gap,4px);' +
            'top:50%;transform:translateY(-50%);' +
            'width:16px;height:16px;' +
            'color:var(--ts-ui-table-header-glyph-color,currentColor);' +
            'pointer-events:none;';

        el.appendChild(gEl);
        this._headerGlyphInstance = glyph;

        // 16 = Glyph default width; 4 = default gap (matches token default).
        const offset = 16 + 4 + themePad;
        this.getRenderer().setInsets(new Insets(0, themePad, 0, offset));
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
        this._sortState = { state, priority: priority ?? null };

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
     * Returns the cached sort indicator state last passed to {@link setSortState},
     * or `null` if no sort indicator is active.
     *
     * @returns An object describing the sort direction and multi-sort priority,
     * or null.
     */
    getSortState(): { state: 'asc' | 'desc', priority: number | null } | null {
        return this._sortState;
    }

    /**
     * Clears the sort indicator arrow and hides the multi-sort priority badge.
     *
     * @returns This cell, for method chaining.
     */
    clearSortState(): this {
        this._sortState = null;

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
     * Returns the tooltip text shown when hovering this header cell.
     *
     * @returns The current tooltip string (empty when no tooltip has been set).
     */
    getTooltip(): string {
        return this._tooltipText;
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
