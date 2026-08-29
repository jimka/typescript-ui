// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DefaultCell } from "~/component/table/cell/Default.js";
import { StringRenderer } from "~/component/table/cell/renderer/String.js";
import { ResizeHandle, RESIZE_HANDLE_CURSOR } from "~/component/table/cell/ResizeHandle.js";
import { SortPriorityBadge } from "~/component/table/cell/SortPriorityBadge.js";
import { Cell, CellEvent } from "~/component/table/cell/Cell.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { beginPointerDrag, endPointerDrag } from "~/core/PointerDrag.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { type StyleBag, type StyleStateSpec } from "~/core/ClassStyleRules.js";
import type { ComponentOptions } from "~/core/Component.js";
import { Tooltip } from "~/overlay/Tooltip.js";
import { ThemeManager } from "~/core/Theme.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import { Text } from "~/component/input/Text.js";
import { SelectableText, SelectableTextOptions } from "~/component/input/SelectableText.js";

/**
 * String-literal union of the events emitted by {@link HeaderCell}. Extends
 * the inherited `CellEvent` union with the header-specific events.
 *
 * @category Components
 */
export type HeaderCellEvent = CellEvent | "sortclick" | "contextmenu" | "resizestart" | "resizedrag";

/**
 * Square edge length (px) used both for the side-loaded `Glyph`'s preferred
 * size and for computing the renderer's left inset when a glyph is mounted —
 * the theme's `glyphLg` default icon step (16px at the shipped base). Read
 * per call, not frozen in a module constant, so a theme that raises
 * `scale.base` moves the icon with it.
 */
function headerGlyphPx(): number {
    return ThemeManager.getResolvedScale().glyphLg;
}

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

const _defaultHeaderCellRendererOptions: Partial<ComponentOptions> = {
    cursor:     "default",
    userSelect: "none",
};

/** `:active`'s box-shadow declaration. One source of truth for both `activeStyleRule`'s resolver and the constructor's write. */
const HEADER_CELL_ACTIVE_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    boxShadow: "var(--ts-ui-button-pressed-shadow, 1px 2px 5px 0 rgba(0,0,0,0.2) inset)",
});

const HEADER_CELL_TEXT_FONT_SIZE_VAR = "--ts-ui-table-header-font-size";

// The CSS-ready form of HEADER_CELL_TEXT_FONT_SIZE_VAR — its "14px" fallback is
// Text's own base font-size default (unmodified here), matching exactly what
// Text.setFontSize resolves the constructor's call below to.
const HEADER_CELL_TEXT_FONT_SIZE_RULE = `var(${HEADER_CELL_TEXT_FONT_SIZE_VAR}, 14px)`;

const _defaultHeaderCellTextOptions: Partial<SelectableTextOptions> = {
    userSelect: "none",
    fontWeight: "bold",
};

/**
 * {@link HeaderCell}'s own title label. Extends `SelectableText` (not the
 * base `Text`) so it keeps the same `cursor: "text"` every table cell's
 * label already gets — `HeaderCell` has never overridden cursor for its
 * title, only `userSelect` — and deviates only on `userSelect` and the
 * bold/`--ts-ui-table-header-font-size` font. See
 * `## Architecture Decisions`.
 */
class HeaderCellText extends SelectableText {
    protected static readonly ownClassStyleDefaults: StyleBag = {
        userSelect: "none",
        font: {
            ...Text.ownClassStyleDefaults.font,
            fontWeight: "bold",
            fontSize:   HEADER_CELL_TEXT_FONT_SIZE_RULE,
        },
    };

    constructor() {
        super(undefined, undefined, _defaultHeaderCellTextOptions);
        this.setFontSize(HEADER_CELL_TEXT_FONT_SIZE_VAR);
    }
}

/**
 * {@link HeaderCell}'s own text renderer. A column title is chrome, not
 * data, so it stays unselectable with a default cursor even though
 * {@link StringRenderer} itself now opts into `cursor: "text"` /
 * `userSelect: "text"` for ordinary data cells.
 */
class HeaderCellRenderer extends StringRenderer {
    constructor() {
        super(_defaultHeaderCellRendererOptions);
    }

    protected override createText(): Text {
        return new HeaderCellText();
    }
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

    // Restates `Cell`'s own `[.rangeSelected, .readOnly,
    // .requiredEmpty]` list and appends `:active` — see
    // `ToggleButton.ownStyleStates` for why a subclass adding a state
    // restates its ancestor's whole list rather than merging (`ownStyleStates`
    // is a whole-list, own-property declaration: HeaderCell declaring its own
    // would otherwise shadow Cell's three states for this whole subtree, not
    // add to them).
    //
    // `:active` is a pseudo-class the browser drives natively — nothing
    // here ever calls `setStyleState(":active", …)` to track it in JS (see
    // that method's own doc comment on pseudo-class states), so this exists
    // purely to generate `.HeaderCell:active`'s class-tier rule and widen
    // the resting guard (`restingGuardSuffix`) to include `:not(:active)` —
    // the same job the old hand-maintained per-class suffix-override chain
    // used to do by hand. Isolation matters here because it's not just a
    // latent gap: `setColumnFocused` (below) writes a *resting* `boxShadow`
    // via `setShadow`/`clearShadow` — a real, live per-instance writer of
    // the exact property `:active` shares on the class tier — so without
    // isolation that write would land on the bare `#id` rule, which
    // outranks `.HeaderCell:active` and permanently defeats the pressed
    // shadow on any column-focused (or previously column-focused) cell.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        ...Cell.ownStyleStates,
        {
            selector: ":active",
            extract: (): StyleBag => ({ shadow: HEADER_CELL_ACTIVE_DECLARATIONS.boxShadow }),
        },
    ];

    private _text: String;
    private _fieldName: string;
    private _isDragging: boolean = false;
    private _tooltipText: string = '';
    // Guards the `onDestroy` registration below against `setTooltip` calling
    // `attachToElement` more than once for the same stable element handle.
    private _tooltipTeardownWired: boolean = false;
    declare private _resizeHandle: ResizeHandle;
    declare private _priorityBadge: SortPriorityBadge;
    private _sortState: { state: 'asc' | 'desc', priority: number | null } | null = null;
    private _headerGlyph: string | null = null;
    private _headerGlyphInstance: Glyph | null = null;
    private _columnFocused: boolean = false;
    private _required: boolean = false;

    /**
     * Creates a header cell with bold text and wires up the sort click listener.
     *
     * @param text - The column title to display.
     * @param fieldName - The model field name used when triggering sort callbacks.
     * @param headerGlyph - Optional registry glyph name mounted to the left of the text.
     */
    constructor(text: String, fieldName: string, headerGlyph?: string | null) {
        super("th", new HeaderCellRenderer());

        this.getAria().setRole("columnheader");
        this.getAria().setSort("none");

        this._text = text;
        this._fieldName = fieldName;
        this._headerGlyph = headerGlyph ?? null;

        let renderer = this.getRenderer();
        renderer.getText().setText(text);

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
    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement();

        if (!el) {
            return this;
        }

        // Subtree listener so clicks on any child element (e.g. the Label) bubble up here.
        Event.addSubtreeListener(this, 'click', this.onSortHeaderClick);

        Event.addSubtreeListener(this, 'contextmenu', { prevent: true, handler: this.onContextMenu });

        // Side-load the resize handle and sort-priority badge as overlays.
        // Their `position:absolute` means they don't disturb the cell's `Card`
        // layout flow, and side-loading (instead of `addComponent`) keeps the
        // Card from hiding them as non-visible siblings of the renderer.
        DOM.sink.appendChild(el, this._resizeHandle.getElement(true)!);
        DOM.sink.appendChild(el, this._priorityBadge.getElement(true)!);

        if (this._tooltipText) {
            this.attachTooltip(el, this._tooltipText);
        }

        if (this._headerGlyph) {
            this.setHeaderGlyph(this._headerGlyph);
        }

        return this;
    }

    /**
     * Re-targets this cell at another column's model field. Used by the
     * header's column-window reconciler when recycling a cell whose
     * column left the window for one entering it.
     *
     * @param name - The new field name this cell reports on sort and
     *   context-menu events.
     * @returns This cell, for method chaining.
     */
    setFieldName(name: string): this {
        this._fieldName = name;

        return this;
    }

    /**
     * Returns the model field name this cell currently reports on sort
     * and context-menu events.
     *
     * @returns The current field name.
     */
    getFieldName(): string {
        return this._fieldName;
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

        // Mounting or clearing the glyph rewrites the renderer's left inset,
        // and an inset only reaches the label through a layout pass — nothing
        // in `setInsets` schedules one. The cell lays itself out here rather
        // than leaving that to its caller, mirroring `Cell.setActiveRenderer`,
        // which re-fits itself for the same reason. The header's own scroll
        // path skips a cell whose geometry has not moved, so a caller-owned
        // relayout would leave the label sitting under the glyph on every
        // route that does not also resize the cell. (Called before the cell has
        // been sized — the reconciler mounts the glyph before the geometry pass
        // — this fits the renderer against an unset size, which the header's
        // geometry pass then overwrites.)
        this.doLayout();

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
    private _mountHeaderGlyph(el: Handle | undefined): void {
        if (this._headerGlyphInstance) {
            // `dispose()` removes the element *and* deletes the glyph's
            // per-instance rules. Unmounting alone stranded them on the shared
            // sheet, so a header whose glyph tracks sort state leaked one set
            // per change.
            this._headerGlyphInstance.dispose();
            this._headerGlyphInstance = null;
        }

        const themePad = ThemeManager.getTheme().table.cell.padding;
        const name     = this._headerGlyph;

        if (!name || !el) {
            this.getRenderer().setInsets(new Insets(0, themePad, 0, themePad));

            return;
        }

        ensureHeaderCellGlyphClassRule();

        const glyphPx = headerGlyphPx();
        const glyph   = new Glyph(name);

        glyph.setTransform("translateY(-50%)");
        glyph.setSize({ width: glyphPx, height: glyphPx });
        glyph.setForegroundColor("var(--ts-ui-table-header-glyph-color, currentColor)");
        glyph.setPointerEvents("none");

        const gEl = glyph.getElement(true)!;
        DOM.sink.apply(gEl, { addClass: ["HeaderCellGlyph"] });

        DOM.sink.appendChild(el, gEl);
        this._headerGlyphInstance = glyph;

        const offset = glyphPx + GLYPH_GAP + themePad;
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

        this._renderTitle();
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

        this._renderTitle();
        this.getAria().setSort('none');

        this._priorityBadge.clearPriority();

        return this;
    }

    /**
     * Sets whether this header cell shows the required-column asterisk
     * suffix. Driven by the column's static `ColumnConfig.required`
     * flag only — the header has no bound record to evaluate a
     * per-record `requiredPredicate` against.
     *
     * @param value - `true` to show the asterisk, `false` to hide it.
     * @returns This cell, for method chaining.
     */
    setRequired(value: boolean): this {
        this._required = value;
        this._renderTitle();

        return this;
    }

    /**
     * Replaces the base header label. The required marker and sort arrow are
     * re-composed onto the new label automatically, so neither is lost.
     * Re-applied on every full header reconcile — first render, a resize, a
     * column-set change, or a jump — so a column config that overrides the
     * label, or clears the override, takes effect on every rendered cell,
     * mirroring {@link setRequired}. An ordinary same-width slide's fast
     * path calls this only for the cell(s) actually entering the window; a
     * surviving cell keeps whatever label it already had, since its own
     * column and config are unchanged by the slide.
     *
     * @param text - The new base label.
     * @returns This header cell, for method chaining.
     */
    setHeaderText(text: String): this {
        if (this._text === text) {
            return this;
        }

        this._text = text;
        this._renderTitle();

        return this;
    }

    /**
     * Composes the header label from the base title plus the required
     * asterisk (` *`, when `_required`) and the sort arrow (` ▲`/` ▼`,
     * when a sort state is active), and writes it to the renderer.
     * Shared by {@link setSortState}, {@link clearSortState}, and
     * {@link setRequired} so the two suffixes never clobber each other.
     */
    private _renderTitle(): void {
        const arrow = this._sortState
            ? (this._sortState.state === 'asc' ? ' ▲' : ' ▼')
            : '';
        const req = this._required ? ' *' : '';

        this.getRenderer().getText().setText(this._text + req + arrow);
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
            this.attachTooltip(el, text);
        }

        return this;
    }

    /**
     * Attaches the hover tooltip to this cell's element and, on the first
     * call, registers the matching teardown so the attachment doesn't
     * outlive this cell. `Tooltip.attachToElement` is keyed by the raw
     * element handle rather than this component, so nothing else releases
     * it when this cell is destroyed.
     *
     * @param el - This cell's element handle, stable for its whole life.
     * @param text - The tooltip text to display.
     */
    private attachTooltip(el: Handle, text: string): void {
        Tooltip.attachToElement(el, text);

        if (!this._tooltipTeardownWired) {
            this._tooltipTeardownWired = true;
            this.onDestroy(() => Tooltip.detachElement(el));
        }
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

    /**
     * Subtree `click` handler. A named method rather than an inline closure so
     * a re-registration — this cell's `init()` running again against a rebuilt
     * element — dedupes against the entry already registered instead of
     * stacking a second one.
     *
     * @param e - The click event; its shift state selects additive sorting.
     */
    private onSortHeaderClick(e: MouseEvent): void {
        this.onSortClick(e.shiftKey);
    }

    /**
     * Forwards a right-click on the header cell (or any descendant) to the
     * registered `"contextmenu"` callback with the viewport coordinates.
     * `preventDefault` is applied by the registration's `prevent: true` floor.
     *
     * @param e - The contextmenu event.
     */
    private onContextMenu(e: MouseEvent): void {
        this.emit("contextmenu", this._fieldName, e.clientX, e.clientY);
    }

    private onResizeDragStart(e: MouseEvent): void {
        e.stopPropagation();

        this._isDragging = true;

        this.emit("resizestart", e.clientX);

        Event.addViewportListener(this, 'mousemove', this.onResizeDrag);
        Event.addViewportListener(this, 'mouseup', this.onResizeDragStop);

        beginPointerDrag(RESIZE_HANDLE_CURSOR);
    }

    private onResizeDrag(e: MouseEvent): Event.ListenerResult {
        this._resizeHandle.dragMove(e.clientX);

        return true;
    }

    private onResizeDragStop(): Event.ListenerResult {
        Event.removeViewportListener(this, 'mousemove', this.onResizeDrag);
        Event.removeViewportListener(this, 'mouseup', this.onResizeDragStop);

        endPointerDrag();

        this._resizeHandle.dragEnd();

        // clear flag after synthesized click fires
        setTimeout(() => { this._isDragging = false; }, 0);

        return true;
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

    /**
     * Destroys the side-loaded overlay children before the inherited teardown
     * runs.
     *
     * The resize handle, the sort-priority badge and the header glyph are held
     * in private fields and mounted with a raw `appendChild` rather than
     * `addComponent` — deliberately, since registering them would let this
     * cell's `Card` layout treat them as non-visible siblings of the renderer
     * and hide them. The cost is that they never enter `_components`, so the
     * base destructor's recursion cannot reach them and their per-instance
     * rules would outlive the cell. The residue scales with column count, and
     * a larger stylesheet makes every later style recalculation dearer.
     */
    protected destructor(): void {
        // Loose checks: `_resizeHandle` and `_priorityBadge` are `declare`
        // fields, so they read as `undefined` if teardown lands before this
        // class's constructor body has run.
        this._resizeHandle?.dispose();
        this._priorityBadge?.dispose();
        this._headerGlyphInstance?.dispose();

        super.destructor();
    }
}

const HeaderCellCallable = callable(HeaderCell);
type HeaderCellCallable = HeaderCell;
export {
    HeaderCell         as _HeaderCell,
    HeaderCellCallable as HeaderCell
};
