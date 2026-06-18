// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DefaultCell } from "~/component/table/cell/Default.js";
import { ResizeHandle } from "~/component/table/cell/ResizeHandle.js";
import { SortPriorityBadge } from "~/component/table/cell/SortPriorityBadge.js";
import { CellEvent } from "~/component/table/cell/Cell.js";
import { DOM } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Util } from "~/core/Util.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Tooltip } from "~/core/Tooltip.js";
import { ThemeManager } from "~/core/Theme.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";

/**
 * String-literal union of the events emitted by {@link HeaderCell}. Extends
 * the inherited `CellEvent` union with the header-specific events.
 *
 * @category Components
 */
export type HeaderCellEvent = CellEvent | "sortclick" | "contextmenu" | "resizestart" | "resizedrag";

/**
 * Width (px) used both for the side-loaded `Glyph`'s preferred size and for
 * computing the renderer's left inset when a glyph is mounted.
 */
const GLYPH_W = 16;

/**
 * Height (px) used for the side-loaded `Glyph`'s preferred size.
 */
const GLYPH_H = 16;

/**
 * Default gap (px) between the cell's left edge and the side-loaded glyph.
 * Mirrors the `--ts-ui-table-header-glyph-gap` token default and is used as
 * the fallback term when computing the renderer's left inset.
 */
const GLYPH_GAP = 4;

let _glyphClassRule: StyleRule | null = null;

/**
 * Registers the shared `.HeaderCellGlyph` class rule once on first use. The
 * rule holds the side-loaded glyph's static placement (position, left, top)
 * so per-instance Component setters only carry transform, size, color, and
 * pointer-events.
 *
 * Idempotent and module-local; safe across hot reloads.
 */
function ensureHeaderCellGlyphClassRule(): void {
    if (_glyphClassRule) {
        return;
    }

    _glyphClassRule = new StyleRule({
        scope:  "class",
        name:   "HeaderCellGlyph",
        styles: {
            position: "absolute",
            left:     "var(--ts-ui-table-header-glyph-gap, 4px)",
            top:      "50%",
        },
    });
}

/**
 * A non-editable header cell rendered as a `<th>` element.
 *
 * Extends {@link DefaultCell} with a sort state indicator (▲/▼ suffix on the
 * label), a click-to-sort callback, and a right-edge drag handle for column
 * resizing. The drag handle and the multi-sort priority badge are dedicated
 * Component subclasses ([`ResizeHandle`](/api/component/table/classes/ResizeHandle)
 * and [`SortPriorityBadge`](/api/component/table/classes/SortPriorityBadge))
 * added through the framework's render lifecycle; both use absolute
 * positioning so they overlay the renderer without disturbing its layout.
 *
 * @category Components
 */
class HeaderCell extends DefaultCell {

    private _text: String;
    private _fieldName: string;
    private _isDragging: boolean = false;
    private _tooltipText: string = '';
    declare private _resizeHandle: ResizeHandle;
    declare private _priorityBadge: SortPriorityBadge;
    private _sortState: { state: 'asc' | 'desc', priority: number | null } | null = null;
    private _headerGlyph: string | null = null;
    private _headerGlyphInstance: Glyph | null = null;
    private _columnFocused: boolean = false;

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

        // DefaultCell's `(tag?: string)` super-signature cannot carry the
        // `styleRules` options bag, so the rule is allocated here via the
        // protected `createStyleRule` builder — same dedupe-and-defer path
        // the options-bag dispatch uses, just spelled imperatively. The
        // render-time `applyStyle` flushes the queued `boxShadow` onto the
        // stylesheet, matching ARCHITECTURE.md's "construction stays
        // JS-only" rule.
        this.createStyleRule(":active").set(
            "boxShadow",
            "var(--ts-ui-button-pressed-shadow, 1px 2px 5px 0 rgba(0,0,0,0.2) inset)",
        );

        // Wire the resize-handle drag lifecycle: mousedown installs viewport
        // mousemove/mouseup listeners that forward through the handle's
        // events. The `_isDragging` flag straddles the handle and the
        // host's click listener (which suppresses the synthetic post-drag
        // click) so the bookkeeping must live on the host.
        this._resizeHandle = new ResizeHandle({
            listeners: {
                dragstart: (e: MouseEvent)   => this.onResizeDragStart(e),
                dragmove : (clientX: number) => this.emit("resizedrag", clientX),
            },
        });
        this._priorityBadge = new SortPriorityBadge();
    }

    /**
     * Wires the host click + contextmenu listeners, attaches the tooltip,
     * and mounts the side-loaded glyph if one was supplied at construction.
     *
     * @param element - Optional element passed from the framework init chain.
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();

        if (!el) {
            return this;
        }

        // Subtree listener so clicks on any child element (e.g. the Label) bubble up here.
        Event.addSubtreeListener(this, 'click', (e: MouseEvent) => this.onSortClick(e.shiftKey));

        Event.addSubtreeListener(this, 'contextmenu', (e: MouseEvent) => {
            e.preventDefault();

            this.emit("contextmenu", this._fieldName, e.clientX, e.clientY);
        });

        // Side-load the resize handle and sort-priority badge as overlays.
        // Their `position:absolute` means they don't disturb the cell's `Card`
        // layout flow, and side-loading (instead of `addComponent`) keeps the
        // Card from hiding them as non-visible siblings of the renderer.
        DOM.sink.appendChild(el, this._resizeHandle.getElement(true));
        DOM.sink.appendChild(el, this._priorityBadge.getElement(true));

        if (this._tooltipText) {
            Tooltip.attachToElement(el, this._tooltipText);
        }

        if (this._headerGlyph) {
            this.setHeaderGlyph(this._headerGlyph);
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
            const glyphEl = this._headerGlyphInstance.getElement();
            if (glyphEl) {
                DOM.sink.removeElement(glyphEl);
            }
            this._headerGlyphInstance = null;
        }

        const themePad = ThemeManager.getTheme().table.cell.padding;
        const name     = this._headerGlyph;

        if (!name || !el) {
            this.getRenderer().setInsets(new Insets(0, themePad, 0, themePad));

            return;
        }

        ensureHeaderCellGlyphClassRule();

        const glyph = new Glyph(name);

        glyph.setTransform("translateY(-50%)");
        glyph.setSize({ width: GLYPH_W, height: GLYPH_H });
        glyph.setForegroundColor("var(--ts-ui-table-header-glyph-color, currentColor)");
        glyph.setPointerEvents("none");

        const gEl = glyph.getElement(true);
        DOM.sink.addClass(gEl, "HeaderCellGlyph");

        DOM.sink.appendChild(el, gEl);
        this._headerGlyphInstance = glyph;

        const offset = GLYPH_W + GLYPH_GAP + themePad;
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

        this._priorityBadge.setPriority(priority ?? null);

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

        this._priorityBadge.clearPriority();

        return this;
    }

    /**
     * Registers a listener for one of this header cell's events.
     *
     * @param event - `"commit"` / `"editend"` inherit from {@link Cell} (they
     *   are unused on the non-editable header surface but kept on the typed
     *   signature for inheritance compatibility); `"sortclick"` fires when
     *   the user clicks the header, receiving the field name and the
     *   shift-key state; `"contextmenu"` fires on right-click, receiving the
     *   field name and the viewport x/y; `"resizestart"` fires on mousedown
     *   over the resize handle, receiving the absolute pointer `clientX` at the
     *   moment the drag began; `"resizedrag"` fires on each mousemove during a
     *   resize drag, receiving the absolute pointer `clientX`.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This cell, for method chaining.
     */
    on(event: "commit",      listener: (value: String | null) => void): this;
    on(event: "editend",     listener: () => void): this;
    on(event: "sortclick",   listener: (fieldName: string, shiftKey: boolean) => void): this;
    on(event: "contextmenu", listener: (fieldName: string, x: number, y: number) => void): this;
    on(event: "resizestart", listener: (clientX: number) => void): this;
    on(event: "resizedrag",  listener: (clientX: number) => void): this;
    on(event: HeaderCellEvent, listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This cell, for method chaining.
     */
    off(event: HeaderCellEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "commit",          value: String | null): void;
    protected emit(event: "editend"): void;
    protected emit(event: "sortclick",       fieldName: string, shiftKey: boolean): void;
    protected emit(event: "contextmenu",     fieldName: string, x: number, y: number): void;
    protected emit(event: "resizestart",     clientX: number): void;
    protected emit(event: "resizedrag",      clientX: number): void;
    protected emit(event: HeaderCellEvent,   ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Sets the tooltip text shown when hovering this header cell.
     *
     * Safe to call before or after the cell has rendered: pre-init calls are
     * picked up by `init` when it wires the tooltip attachment; post-init
     * calls re-attach against the live element so the visible tooltip
     * updates immediately.
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
     * Returns the tooltip text shown when hovering this header cell.
     *
     * @returns The current tooltip string (empty when no tooltip has been set).
     */
    getTooltip(): string {
        return this._tooltipText;
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

        this.emit("sortclick", this._fieldName, shiftKey);
    }

    private onResizeDragStart(e: MouseEvent): void {
        e.stopPropagation();

        this._isDragging = true;

        this.emit("resizestart", e.clientX);

        Event.addViewportListener(this, 'mousemove', this.onResizeDrag);
        Event.addViewportListener(this, 'mouseup', this.onResizeDragStop);

        // Suppresses pointer events on document.body (not a Component) for the
        // duration of the column resize so the cursor can't snag on other cells.
        // eslint-disable-next-line local/no-element-style -- raw document.body, no Component setter applies
        Util.select('body').style.pointerEvents = 'none';
    }

    private onResizeDrag(e: MouseEvent): void {
        this._resizeHandle.dragMove(e.clientX);
    }

    private onResizeDragStop(): void {
        Event.removeViewportListener(this, 'mousemove', this.onResizeDrag);
        Event.removeViewportListener(this, 'mouseup', this.onResizeDragStop);

        // Restores pointer events on document.body (not a Component) once the resize ends.
        // eslint-disable-next-line local/no-element-style -- raw document.body, no Component setter applies
        Util.select('body').style.pointerEvents = '';

        this._resizeHandle.dragEnd();

        // clear flag after synthesized click fires
        setTimeout(() => { this._isDragging = false; }, 0);
    }

    /**
     * Toggles the column-focused visual indicator on this header cell.
     *
     * @param focused - True to paint the focus underline, false to clear it.
     *
     * @returns This component, for method chaining.
     *
     * @remarks The indicator is a 2 px inset bottom box-shadow in the
     * `--ts-ui-focus-ring` theme token, matching the colour of the body cell's
     * focus outline so the eye reads the header cue and the body cue as one
     * affordance. Driven by `Body._updateFocusStyle` whenever the body's
     * focused column changes.
     */
    setColumnFocused(focused: boolean): this {
        this._columnFocused = focused;

        if (focused) {
            this.setShadow("inset 0 -2px 0 0 var(--ts-ui-focus-ring, rgba(30, 100, 200, 0.6))");
        } else {
            this.clearShadow();
        }

        return this;
    }

    /**
     * Returns whether this header cell currently shows the column-focused indicator.
     *
     * @returns True when `setColumnFocused(true)` was the last call; false otherwise.
     */
    isColumnFocused(): boolean {
        return this._columnFocused;
    }
}

const HeaderCellCallable = callable(HeaderCell);
type HeaderCellCallable = HeaderCell;
export {
    HeaderCell         as _HeaderCell,
    HeaderCellCallable as HeaderCell
};
