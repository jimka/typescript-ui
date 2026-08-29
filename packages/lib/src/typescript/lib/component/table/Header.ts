// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Row } from "~/component/table/Row.js";
import { AbstractModel } from "~/data/AbstractModel.js";
import { AbstractStore, SortDescriptor } from "~/data/AbstractStore.js";
import { Field } from "~/data/Field.js";
import { Column } from "~/component/table/Column.js";
import { HeaderCell } from "~/component/table/cell/Header.js";
import { ParentHeaderCell } from "~/component/table/cell/ParentHeader.js";
import { FilterCell } from "~/component/table/cell/Filter.js";
import { Cell } from "~/component/table/cell/Cell.js";
import { computeColumnWindow } from "~/component/table/Body.js";
import type { ColumnWindow } from "~/component/table/Body.js";
import { columnFilterOperators, buildColumnFilter, columnFilterStatesEqual, columnFilterTakesNumericOperand } from "~/component/table/ColumnFilter.js";
import type { ColumnFilterOperator, ColumnFilterState, ColumnFilterTarget } from "~/component/table/ColumnFilter.js";
import type { ColumnConfig } from "~/component/table/ColumnConfig.js";
import { CellTextResolver } from "~/component/table/cell/CellText.js";
import { Button, ButtonOptions } from "~/component/button/Button.js";
import { Glyph } from "~/component/display/Glyph.js";
import { ellipsis_v } from "~/glyphs/solid/ellipsis_v.js";
import { callable } from "~/core/Callable.js";
import { Util } from "~/core/Util.js";
import { TRACK_WIDTH } from "~/component/container/Scrollbar.js";
import type { StyleBag, StyleStateSpec, StyleTrait } from "~/core/ClassStyleRules.js";

// Register the column-menu button's glyph eagerly at module load — same
// pattern as ToolBar registering its overflow chevron — so the button always
// resolves its glyph without the consumer pre-registering it.
Glyph.register(ellipsis_v);

/** Glyph the column-menu button renders — matches `ToolBar`'s overflow trigger. */
const MENU_BUTTON_GLYPH = "ellipsis-v";

/** Accessible name / tooltip for the column-menu button. */
const MENU_BUTTON_LABEL = "Column options";

// A compact, glyph-only `TableHeaderMenuButton` reserves `glyph +
// MENU_BUTTON_CHROME_PX` per axis around the glyph — 2px of compact insets
// on each side. The button's own border is `"none"` (its own declared chrome
// default), so it contributes no width here. The button fills the vertical-
// scrollbar reservation band exactly (see the constructor, which pins the
// glyph to `TRACK_WIDTH - MENU_BUTTON_CHROME_PX`), so this is the fixed
// per-side overhead subtracted from that fixed track width.
const MENU_BUTTON_CHROME_PX = 4;

/**
 * The menu button's glyph edge, in px — the vertical-scrollbar reservation
 * band (`TRACK_WIDTH`) minus the button's own compact insets. Both inputs are
 * module constants, so this is fixed at import time.
 */
const MENU_BUTTON_GLYPH_PX = Math.max(1, TRACK_WIDTH - MENU_BUTTON_CHROME_PX);

/**
 * The min/max square-size pair every table header's menu icon shares, so all
 * of them use one CSS rule instead of each repeating the same size on its own
 * `#id` rule. `TableHeaderMenuButton` is the only owner, and the size derives
 * from constants declared in this file and in `Scrollbar.ts`, so the trait is
 * declared here rather than in `core/StyleTraits.ts` (which would make a
 * `core/` module import from `component/`). Deliberately *not* folded into
 * `GLYPH_XS_INK_TRAIT` despite resolving to the same 8px today: that trait
 * tracks the theme's `glyphXs` icon step, while this one tracks a fixed
 * scrollbar track width — see plans/implemented/glyph-icon-host-box-migration.md.
 */
const TABLE_HEADER_MENU_GLYPH_TRAIT: StyleTrait = {
    name: "table-header-menu-glyph",
    declarations: {
        minSize: { width: MENU_BUTTON_GLYPH_PX, height: MENU_BUTTON_GLYPH_PX },
        maxSize: { width: MENU_BUTTON_GLYPH_PX, height: MENU_BUTTON_GLYPH_PX },
    },
};

// Needs to beat the header's inner rows, which are Components at `z-index:
// 0` (an implicit stacking context) — a plain sibling with `z-index: auto`
// paints BENEATH them.
const MENU_BUTTON_Z_INDEX = 1;

/**
 * Debounce (ms) between a filter-cell keystroke and the store write it
 * schedules. Matches `AutoCompleteField`'s default keystroke debounce.
 * Picking an operator, pressing Enter, or pressing Escape bypass this and
 * apply immediately.
 */
const COLUMN_FILTER_DEBOUNCE_MS = 200;

// The header surface, themed via `--ts-ui-table-header-bg`. The value is
// applied as BOTH a background-color and a background-image because the token
// is a flat colour in some themes (e.g. ModernTheme) and a gradient in others
// (e.g. ClassicTheme): a colour is invalid as a background-image (resolves to
// `none`) and a gradient is invalid as a background-color (resolves to
// transparent), so setting both lets whichever form the active theme supplies
// paint while the other harmlessly drops out. Setting only background-image —
// the previous behaviour — left the surface transparent under a flat-colour
// theme, which surfaced as a see-through scrollbar-cover band.
const TABLE_HEADER_BG = "var(--ts-ui-table-header-bg, var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200))))";

/** Left-edge divider — an inset shadow rather than a border, since flat
 *  chrome's own 1px transparent border reservation was removed along with
 *  the rest of flat mode; see the class's own doc comment. */
const MENU_BUTTON_DIVIDER_SHADOW = "inset 1px 0 0 0 var(--ts-ui-table-resize-handle-color, rgba(0, 0, 0, 0.2))";

/** Non-flat hover/pressed background tokens — see the class's own doc
 *  comment for why these, not flat's generic translucent overlay, are
 *  the intended look. */
const MENU_BUTTON_HOVER_BG   = "var(--ts-ui-button-hover-bg, rgb(252, 252, 252))";
const MENU_BUTTON_PRESSED_BG = "var(--ts-ui-button-pressed-bg, rgb(200, 200, 200))";

const _defaultTableHeaderMenuButtonOptions: Partial<ButtonOptions> = {
    border:          "none",
    borderRadius:    undefined,   // explicit key wins over Button's own default in the subclassDefaults spread merge — mirrors WindowControlButton's/TabCloseButton's identical trick.
    backgroundColor: TABLE_HEADER_BG,
    backgroundImage: TABLE_HEADER_BG,
    shadow:          MENU_BUTTON_DIVIDER_SHADOW,
};

/**
 * The table header's column-options menu trigger. A real declared-chrome
 * subclass rather than a bare `Button({flat: true, ...})` with imperative
 * overrides — see plans/button-flat-chrome-dedup.md's Architecture
 * Decisions for why `flat` was dropped, and why the hover/pressed
 * backgrounds below are the tokens `Header.ts` always intended (previously
 * masked by flat's own more-specific state rules). Module-private, not
 * exported, not wrapped in `callable()` — same treatment as
 * `WindowControlButton` in `windowControls.ts`.
 */
class TableHeaderMenuButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultTableHeaderMenuButtonOptions;

    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                backgroundColor: MENU_BUTTON_PRESSED_BG,
                backgroundImage: MENU_BUTTON_PRESSED_BG,
                shadow:          MENU_BUTTON_DIVIDER_SHADOW,
            }),
        },
        {
            selector: ":hover",
            extract: (): StyleBag => ({
                backgroundColor: MENU_BUTTON_HOVER_BG,
                backgroundImage: MENU_BUTTON_HOVER_BG,
                shadow:          MENU_BUTTON_DIVIDER_SHADOW,
            }),
        },
    ];

    constructor(onAction: () => void, subclassDefaults?: Partial<ButtonOptions>) {
        super(
            undefined,
            {
                glyph:    MENU_BUTTON_GLYPH,
                text:     MENU_BUTTON_LABEL,
                showText: false,
                compact:  true,
                zIndex:   MENU_BUTTON_Z_INDEX,
            },
            { ..._defaultTableHeaderMenuButtonOptions, ...(subclassDefaults ?? {}) },
        );
        // Button's own constructor only auto-wires an options `listeners` bag
        // for a plain `Button` instance, never a subclass (see its own
        // comment) — wire `action` directly here instead, the same way
        // `PopupButton`/`MenuButton` do from their own constructor bodies.
        this.on("action", onAction);
        this.pinGlyphSize(MENU_BUTTON_GLYPH_PX);
        // `pinGlyphSize` sets Button's `_glyphSizePinned` opt-out so a theme
        // change never re-tracks this glyph to the title line height; the
        // trait publishes the size as one shared CSS rule across every table.
        this.getGlyph()?.setStyleTrait(TABLE_HEADER_MENU_GLYPH_TRAIT);
        this.getAria().setHasPopup("menu");
    }
}

/**
 * String-literal union of the events emitted by the table {@link TableHeader}.
 *
 * @category Components
 */
export type TableHeaderEvent = "columnresizestart" | "columnresize" | "columncontextmenu";

/**
 * The geometry the table layout supplies to the header on each pass. Cached
 * by {@link TableHeader.renderColumnWindow} so a scroll-driven pass can
 * re-run with no argument.
 *
 * @category Components
 */
export interface HeaderColumnGeometry {
    /** Width per visible column, in display order. May be shorter than the column list. */
    columnWidths   : number[];
    /** The width the columns are windowed against — the table's available column width. */
    viewportWidth  : number;
    /** Height of the column-header row, in pixels. */
    columnHeight   : number;
    /** Height of the parent-header row, in pixels; `0` when it is collapsed. */
    parentRowHeight: number;
    /** Height of the filter row, in pixels; `0` when it is collapsed. */
    filterRowHeight: number;
}

/**
 * The two behaviours that differ between the column row and the filter row,
 * threaded through the shared {@link TableHeader.reconcileWindowedRow} /
 * {@link TableHeader.reconcileWindowedRowSlide} algorithms — see the plan's
 * "one windowed-row reconciler" Architecture Decision.
 */
interface WindowedRowHooks<TCell extends Cell<any>> {
    /** Builds a cell for `field`, parents it on the row with `{ data: field }`, wires it, returns it. */
    create(field: Field): TCell;
    /** Writes every per-column property onto `cell` for visible column `col`. */
    apply(cell: TCell, col: number, retargeted: boolean): void;
}

/**
 * The header section of a table, rendered as a `<thead>` element.
 *
 * Builds one {@link HeaderCell} per column in its current column window —
 * the horizontally-visible range plus a small buffer — rather than one per
 * visible field up front. Computed by the same `computeColumnWindow` the
 * body uses, but against the table's available column width, which excludes
 * the vertical-scrollbar band the body's own width includes; the two
 * windows are near-identical rather than equal, with the shared buffer
 * covering the difference.
 * Each cell is wired with a sort-click callback (cycles asc → desc → clear), a
 * resize-drag callback (forwarded to the owner via the `"columnresize"`
 * event), and a context-menu callback (forwarded via the
 * `"columncontextmenu"` event); see {@link TableHeader.on}.
 *
 * Re-exported as `TableHeader` from the package barrel.
 *
 * @category Components
 */
class TableHeader extends Component {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. Mirrors what the
    // constructor below already writes imperatively.
    protected static readonly ownClassStyleDefaults: StyleBag = {
        border:          { borderBottom: "1px solid var(--ts-ui-table-header-border, black)" },
        backgroundColor: TABLE_HEADER_BG,
        backgroundImage: TABLE_HEADER_BG,
    };

    private _model: AbstractModel;
    private _store: AbstractStore;
    private _hiddenColumns: Set<string> = new Set();
    private _columns: Column[] = [];
    private _listeners: ListenerBag<TableHeaderEvent> = this.registerListenerBag(new ListenerBag<TableHeaderEvent>());
    private _menuButton: Button;
    private _boundOnMenuButtonAction: () => void = () => this.onMenuButtonAction();

    // Non-hidden fields, in display order — the full column list the
    // rendered window is carved out of. Populated by `rebuildCells`.
    private _visibleFields: Field[] = [];
    // Visible-column index of slot 0. The rendered columns are always a
    // contiguous run, so slot `s` holds column `_windowFirst + s`.
    private _windowFirst  : number = 0;
    private _scrollX      : number = 0;
    private _focusedCol   : number | null = null;
    // A fast-path slide only refreshes the sort indicator on the cells that
    // actually entered the window this tick (see `_lastEnteredCells`) — a
    // survivor's own indicator is otherwise never touched again once
    // rendered, so an external sort change (anything that isn't a click on
    // this header, e.g. a programmatic `AbstractStore.sort()`) needs its own
    // subscription to reach it, mirroring `_boundOnStoreFilterChange` below.
    private _boundOnStoreSortChange: () => void = () => this.onStoreSortChange();
    // Set by `rebuildCells` so the next `renderColumnWindow` reconciles even
    // when the requested range happens to match the current one — a
    // column-set change can leave the range unchanged while the cells
    // behind it need to change.
    private _columnsDirty : boolean = true;
    // Cells `reconcileColumnCells` repointed at a new column on its last fast-path
    // slide, in no particular order. `undefined` means the last reconcile either
    // made no change or took the full path, so `renderColumnWindow` must sweep
    // every rendered cell instead of scoping to this list. Reset at the top of
    // every `reconcileColumnCells` call.
    private _lastEnteredCells: HeaderCell[] | undefined = undefined;
    private _geometry      : HeaderColumnGeometry = { columnWidths: [], viewportWidth: 0, columnHeight: 0, parentRowHeight: 0, filterRowHeight: 0 };

    // Filter-row state. `_filterStates` is keyed per store (rather than held
    // flat) so a round trip through rotated mode — which re-points this
    // header at the projection store and back — restores the source store's
    // filter text unchanged instead of showing one store's text over
    // another's columns. See `filterState()`.
    private _filterRowVisible : boolean = false;
    private _filterStates      : WeakMap<AbstractStore, Map<string, ColumnFilterState>> = new WeakMap();
    private _filterCellsDirty  : boolean = true;
    private _filterWindowFirst : number = 0;
    // The field whose write is still pending the debounce timer, or that a
    // caller's `immediate` request is about to flush. Lives here rather than
    // on the cell because a horizontal scroll can recycle the cell onto a
    // different column while the write is still in flight.
    private _pendingFilterField: string | null = null;
    private _filterTimer       : ReturnType<typeof setTimeout> | null = null;
    private _boundOnStoreFilterChange: () => void = () => this.onStoreFilterChange();

    // Per-field column config, supplying `values` / `showSeconds` to
    // `filterTarget`. Kept alongside a pooled resolver so a combo/temporal
    // filter build can resolve display text without mounting a renderer.
    private _columnConfigs: Map<string, ColumnConfig> = new Map();
    private _cellText     : CellTextResolver          = new CellTextResolver();

    constructor(model: AbstractModel, store: AbstractStore) {
        // backgroundColor/backgroundImage also go through subclassDefaults
        // (into _defaultOptions), not just ownClassStyleDefaults: Component's
        // clearBackgroundColor()/clearBackgroundImage() gate their explicit
        // "transparent"/"none" override on this._defaultOptions having the
        // property, since a bare removal alone would hand the property back
        // to a class-defaulting rule instead of clearing it. border doesn't
        // need the same treatment — clearBorder() always asserts a real
        // "none" override regardless of _defaultOptions.
        super({ tag: "thead" }, { backgroundColor: TABLE_HEADER_BG, backgroundImage: TABLE_HEADER_BG });

        this.getAria().setRole("rowgroup");
        this.setBorder({ borderBottom: "1px solid var(--ts-ui-table-header-border, black)" });
        this.setBackgroundColor(TABLE_HEADER_BG);
        this.setBackgroundImage(TABLE_HEADER_BG);
        // Clip cells that would otherwise extend past the header's right
        // edge when the inner rows are translated horizontally.
        this.setOverflow("hidden");

        this._model = model;
        this._store = store;
        this._store.on('filterchange', this._boundOnStoreFilterChange);
        this._store.on('sortchange', this._boundOnStoreSortChange);

        // Three `Row` children — parent row at index 0, column row at index 1,
        // filter row at index 2. The parent row collapses to zero height when
        // no visible column declares a group; existing no-group tables remain
        // byte-identical at runtime because `rebuildParentCells` produces no
        // cells in that case and the layout manager zeroes the parent-row
        // height. The filter row collapses the same way — via `hasFilterRow`
        // — until a caller opts in through `setFilterRowVisible`.
        const parentRow = new Row();
        const row       = new Row();
        const filterRow = new Row();
        this.addRow(parentRow);
        this.addRow(row);
        this.addRow(filterRow);

        // A plain, non-`Row` child — appended via `super.addComponent` because
        // this class's own `addComponent` is narrowed to `Row` — and appended
        // last so the fixed indices `getParentRow()` (0), `getColumns()` (1),
        // and `getFilterRow()` (2) keep resolving to the three rows above.
        //
        // This button fully replaces what used to be a separate, non-
        // interactive scrollbar-reservation cover: it carries the header's
        // own background/gradient and a left divider matching the column-cell
        // border, so cells translated horizontally still appear to clip at
        // the reserved band's boundary. Its glyph is pinned to exactly fill
        // that band — `TRACK_WIDTH` is a fixed compile-time constant, so this
        // costs nothing at runtime.
        this._menuButton = new TableHeaderMenuButton(this._boundOnMenuButtonAction);
        super.addComponent(this._menuButton);

        this.rebuildCells();
        this.rebuildParentCells();

        // Marks every rendered cell dirty so the next layout pass re-fits it
        // against the new theme; see `Cell.canSkipUnchangedLayout` for why a
        // theme change needs that and geometry alone cannot detect it.
        //
        // Re-rendering from inside this callback, as
        // `VirtualRowView.onThemeReflow` does for the body, would run too
        // early: each cell renderer holds its own theme subscription that
        // rewrites the insets the pass has to fit against, and those renderers
        // subscribe after this header does, so the re-render would fit against
        // the outgoing theme's padding.
        this.subscribeTheme(() => this.invalidateCellLayouts());
    }

    /**
     * Returns the model driving this header's columns.
     *
     * @returns The {@link AbstractModel} currently bound to this header.
     */
    getModel() {
        return this._model;
    }

    /**
     * Swaps the store whose sort state this header drives and displays.
     *
     * @param store - The new store to bind to this header.
     *
     * @remarks Internal wiring called by the owning {@link Table} when its
     * bound store or display mode changes. Not for consumer use.
     */
    setStore(store: AbstractStore): this {
        this._store.off('filterchange', this._boundOnStoreFilterChange);
        this._store.off('sortchange', this._boundOnStoreSortChange);
        this._store = store;
        this._store.on('filterchange', this._boundOnStoreFilterChange);
        this._store.on('sortchange', this._boundOnStoreSortChange);

        return this;
    }

    /**
     * Replaces the model, rebuilding header cells only when the visible field list changes.
     *
     * @param model - The new model to bind to the header.
     *
     * @remarks If the new model has the same visible fields in the same order as the current
     * model, the existing cells are left in place and sort indicators are re-synced.
     */
    setModel(model: AbstractModel): this {
        const toNames = (model: AbstractModel) =>
            model.getFields()
                 .slice()
                 .filter(f => !this._hiddenColumns.has(f.getName()))
                 .sort((a, b) => a.getOrder() - b.getOrder())
                 .map(f => f.getName());

        const oldNames = toNames(this._model);
        const newNames = toNames(model);

        const same = oldNames.length === newNames.length
                     && oldNames.every((n, i) => n === newNames[i]);

        if (!same) {
            this._model = model;
            this.rebuildCells();
            this.rebuildParentCells();
        }

        this.syncSortIndicators();

        return this;
    }

    /**
     * Updates the set of hidden column field names, rebuilding the parent row
     * immediately and marking the column row's cells for reconciliation.
     *
     * The column row renders no cells until the next {@link renderColumnWindow},
     * which every caller reaches through the table's own layout pass.
     *
     * Field names belonging to {@link Column.isUnhideable} columns are stripped
     * from the set so a direct caller cannot bypass the unhideable contract.
     *
     * @param hidden - The new set of field names to hide.
     */
    setHiddenColumns(hidden: Set<string>): this {
        const filtered = new Set<string>();

        for (const name of hidden) {
            const col = this._columns.find(c => c.getField().getName() === name);

            if (!col || !col.isUnhideable()) {
                filtered.add(name);
            }
        }

        this._hiddenColumns = filtered;

        this.rebuildCells();
        this.rebuildParentCells();

        return this;
    }

    /**
     * Supplies the resolved {@link Column} list so that per-column header metadata
     * (e.g. `headerGlyph`, `group`) is available when cells are rebuilt.
     *
     * @param columns - The resolved columns in display order.
     * @returns This header, for method chaining.
     */
    setColumns(columns: Column[]): this {
        this._columns = columns;

        this.rebuildCells();
        this.rebuildParentCells();

        return this;
    }

    /**
     * Supplies the per-field column-config map, consulted internally when
     * building a column's filter descriptor. Mirrors
     * [`Body.setColumnConfigs`](/api/component/table/classes/Body#setcolumnconfigs).
     *
     * @param configs - The new column-config map keyed by field name.
     * @returns This header, for method chaining.
     */
    setColumnConfigs(configs: Map<string, ColumnConfig>): this {
        this._columnConfigs = configs;

        return this;
    }

    /**
     * Registers a listener for one of this header's events.
     *
     * @param event - `"columnresizestart"` fires on mousedown over a column
     *   resize handle, receiving the zero-based column index and the absolute
     *   pointer `clientX` at the moment the drag began; `"columnresize"` fires
     *   when the user drags a column resize handle, receiving the zero-based
     *   column index and the absolute pointer `clientX`; `"columncontextmenu"`
     *   fires on a right-click anywhere in the header band, or on an activation
     *   of {@link getMenuButton}'s column-menu button, receiving the field name
     *   (empty string when the click landed on a parent-header cell or on the
     *   menu button) and the viewport x/y coordinates.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This header, for method chaining.
     */
    on(event: "columnresizestart", listener: (colIndex: number, clientX: number) => void): this;
    on(event: "columnresize",      listener: (colIndex: number, clientX: number) => void): this;
    on(event: "columncontextmenu", listener: (fieldName: string, x: number, y: number) => void): this;
    on(event: TableHeaderEvent,         listener: Function): this {
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
     * @returns This header, for method chaining.
     */
    off(event: TableHeaderEvent, listener: Function): this {
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
    protected emit(event: "columnresizestart", colIndex: number, clientX: number): void;
    protected emit(event: "columnresize",      colIndex: number, clientX: number): void;
    protected emit(event: "columncontextmenu", fieldName: string, x: number, y: number): void;
    protected emit(event: TableHeaderEvent,         ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Returns the rendered header cell components, in slot order. The column row
     * lives at child index 1 — the parent-header row sits at index 0.
     *
     * A slot maps to a visible-column index by adding
     * {@link getColumnWindowStart}: only the horizontally-visible column
     * window (plus a small buffer) is rendered, so this is no longer every
     * visible column.
     *
     * @returns An array of the rendered cell components from the column-header row.
     */
    getColumns() {
        return this.getComponents()[1].getComponents();
    }

    /**
     * Returns the visible-column index of the first rendered header cell.
     *
     * @returns The visible-column index slot `0` currently renders.
     */
    getColumnWindowStart(): number {
        return this._windowFirst;
    }

    /**
     * Returns the parent-header row hosting the {@link ParentHeaderCell}
     * instances. Always present, even when no visible column declares a
     * group — in that case the row has zero cells and the layout manager
     * collapses it to zero height.
     *
     * @returns The parent row.
     */
    getParentRow(): Row {
        return this.getComponents()[0] as Row;
    }

    /**
     * Returns `true` when at least one visible column declares a group —
     * i.e. the parent-header row is rendered with non-zero height.
     * Driven by {@link Column.getGroup} across the resolved visible
     * column list.
     *
     * @returns `true` when the parent row should be laid out, `false`
     *   when it should collapse.
     */
    hasParentRow(): boolean {
        return this._columns
            .filter(c => !this._hiddenColumns.has(c.getField().getName()))
            .some(c => c.getGroup() !== null);
    }

    /**
     * Returns the filter row hosting one {@link FilterCell} per
     * horizontally-visible column. Always present, even when collapsed — in
     * that case the row has zero cells and the layout manager collapses it
     * to zero height.
     *
     * @returns The filter row.
     */
    getFilterRow(): Row {
        return this.getComponents()[2] as Row;
    }

    /**
     * Returns `true` when the table-level filter-row toggle
     * ({@link setFilterRowVisible}) is on **and** at least one visible
     * column is filterable — i.e. the filter row is rendered with non-zero
     * height. Unlike {@link hasParentRow}, a filterable column alone is not
     * enough: the toggle must also be on, so a table with `filterable`
     * columns renders exactly as it does today until a caller opts in.
     *
     * @returns `true` when the filter row should be laid out, `false` when
     *   it should collapse.
     */
    hasFilterRow(): boolean {
        return this._filterRowVisible
            && this._columns
                   .filter(c => !this._hiddenColumns.has(c.getField().getName()))
                   .some(c => c.isFilterable());
    }

    /**
     * Shows or hides the filter row. Pushed down from
     * {@link Table.setFilterRowVisible}; idempotent when `visible` already
     * matches the current state. Hiding also clears every filter the row
     * itself applied, so a hidden row never leaves an invisible predicate
     * narrowing the view.
     *
     * @param visible - `true` to show the filter row, `false` to hide it.
     * @returns This header, for method chaining.
     */
    setFilterRowVisible(visible: boolean): this {
        if (visible === this._filterRowVisible) {
            return this;
        }

        this._filterRowVisible = visible;
        this._filterCellsDirty = true;

        if (!visible) {
            this.clearFilterRowState();
        }

        return this;
    }

    /**
     * Cancels any in-flight debounced write and removes every descriptor the
     * filter row itself applied to the store, discarding the row's cached
     * clause-list state along with it. Called when the row is hidden, so a
     * column's filter never keeps narrowing the view once there is no
     * longer any control showing — or letting the user change — its
     * criteria.
     *
     * Clears every column in a single {@link AbstractStore.setFilters} call
     * rather than looping {@link AbstractStore.setFilter} once per column —
     * a consuming store with `pageSize` set (or `remoteFilter` enabled)
     * reloads once per `setFilter` call, so an N-column loop would fire N
     * sequential reloads for what is one user action.
     */
    private clearFilterRowState(): void {
        if (this._filterTimer !== null) {
            clearTimeout(this._filterTimer);
            this._filterTimer = null;
        }

        this._pendingFilterField = null;

        const states  = this.filterState();
        const entries: Array<[string, null]> = [];

        for (const fieldName of [...states.keys()]) {
            states.delete(fieldName);

            if (this._store.getFilter(fieldName) !== null) {
                entries.push([fieldName, null]);
            }
        }

        if (entries.length > 0) {
            void this._store.setFilters(entries);
        }
    }

    /**
     * Returns the button that opens the column context menu — the same menu
     * a right-click on a header cell opens. Sits in the vertical-scrollbar
     * reservation band at the header's right edge; positioned by the table
     * layout.
     *
     * @returns The column-menu button.
     */
    getMenuButton(): Button {
        return this._menuButton;
    }

    /**
     * Handles a click (or keyboard activation) of the column-menu button:
     * emits `"columncontextmenu"` with an empty field name — matching a
     * right-click on a parent-header cell — anchored to the button's own
     * viewport rect rather than the click coordinates. A keyboard-activated
     * click reports `clientX`/`clientY` of `0`, which would open the menu in
     * the viewport's top-left corner; the button's own rect is correct for
     * both mouse and keyboard activation.
     */
    private onMenuButtonAction(): void {
        const rect = DOM.source.getViewportRect(this._menuButton);

        this.emit("columncontextmenu", "", rect.left, rect.bottom);
    }

    /**
     * Appends a row to the header.
     *
     * @param row - The row to append.
     */
    addRow(row: Row) : this {
        this.addComponent(row);

        return this;
    }

    /**
     * Adds a row as a child component of the header.
     *
     * @param row - The row component to add.
     *
     * @returns This component, for method chaining.
     */
    addComponent(row: Row): this {
        super.addComponent(row);

        return this;
    }

    /**
     * Sets the header height. Row-level widths, heights, and positions
     * are set independently by the table layout manager — `TableHeader` itself
     * just stores the total band height. The per-row assignments
     * live in `layout/Table.doLayout` because the split depends on
     * {@link hasParentRow} and on the header's own content box.
     *
     * @param height - The total header band height in pixels.
     *
     * @returns This component, for method chaining.
     */
    setHeight(height: number): this {
        super.setHeight(height);

        return this;
    }

    /**
     * Recomputes the visible-field list from the current model and hidden
     * set, marks the rendered cell set dirty, and re-syncs the sort
     * indicators. Builds no cells itself: the column row renders nothing
     * until the next {@link renderColumnWindow}, which reconciles against
     * the window the table layout hands it — mirroring `Body`, which
     * renders no rows until its first `renderWindow`.
     */
    private rebuildCells(): void {
        this._visibleFields = this.computeVisibleFields(this._model);
        this._columnsDirty  = true;
        this._filterCellsDirty = true;

        this.syncSortIndicators();
    }

    /**
     * Filters and orders `model`'s fields to the currently-visible set:
     * every field not in `_hiddenColumns`, sorted by {@link Field.getOrder}.
     * Called by {@link rebuildCells} to populate `_visibleFields`, the
     * single derivation `syncSortIndicators` and {@link reconcileColumnCells}
     * both read from instead of re-deriving it themselves.
     *
     * @param model - The model whose fields to filter and order.
     * @returns The visible fields, in display order.
     */
    private computeVisibleFields(model: AbstractModel): Field[] {
        return model.getFields()
                    .slice()
                    .filter(f => !this._hiddenColumns.has(f.getName()))
                    .sort((f1, f2) => f1.getOrder() - f2.getOrder());
    }

    /**
     * Shared full-path reconciler for a windowed header row — the column row
     * or the filter row, chosen by `hooks`. A cell carries no per-kind
     * identity — unlike the body's cell reconciler — so any leftover cell can
     * serve any entering column:
     *
     * 1. A column keeps the cell that already holds its field, matched by
     *    field name.
     * 2. Every other column in the range recycles a leftover cell, or builds
     *    a fresh one via `hooks.create` when none remains.
     * 3. Every per-column property is re-applied via `hooks.apply` to every
     *    rendered cell, whether or not it was re-targeted, so a recycled
     *    cell never shows a trace of its previous column — `retargeted` is
     *    `true` for a cell that was just assigned a new field, or for every
     *    cell when `dirty` is set, and it is up to `hooks.apply` to decide
     *    what that flag changes (see the plan's own Architecture Decision on
     *    the flag's OR'd meaning).
     *
     * Cells left over after the window is filled are removed and disposed.
     * Does not touch `_windowFirst`, `_columnsDirty`, `_filterWindowFirst`,
     * or `_filterCellsDirty` — those stay each caller's own bookkeeping.
     *
     * @param row - The row whose cells to reconcile.
     * @param firstCol - The first visible-column index to render, inclusive.
     * @param lastCol - The last visible-column index to render, inclusive.
     * @param dirty - `true` when every cell's per-column state must be
     *   re-applied as retargeted, regardless of whether it kept its own field.
     * @param hooks - The two behaviours that differ between the column row
     *   and the filter row.
     */
    private reconcileWindowedRow<TCell extends Cell<any>>(
        row: Row, firstCol: number, lastCol: number, dirty: boolean, hooks: WindowedRowHooks<TCell>,
    ): void {
        const existing = row.getComponents().slice() as TCell[];
        const byName   = new Map<string, TCell>();

        for (const cell of existing) {
            const lc    = row.getLayoutConstraints(cell);
            const field = lc?.data as Field | undefined;

            if (field) {
                byName.set(field.getName(), cell);
            }
        }

        const slotCount = lastCol - firstCol + 1;
        const assigned: (TCell | undefined)[] = new Array(slotCount).fill(undefined);
        const retargeted = new Set<number>();

        // Pass 1 — keep a cell for its own field.
        for (let col = firstCol; col <= lastCol; col++) {
            const name = this._visibleFields[col].getName();
            const cell = byName.get(name);

            if (cell) {
                assigned[col - firstCol] = cell;
                byName.delete(name);
            }
        }

        const free = Array.from(byName.values());

        // Pass 2 — recycle a leftover, else build.
        for (let col = firstCol; col <= lastCol; col++) {
            const slot = col - firstCol;

            if (assigned[slot] !== undefined) {
                continue;
            }

            const field = this._visibleFields[col];
            let   cell  = free.pop();

            if (cell) {
                row.setLayoutConstraints(cell, { data: field });
            } else {
                cell = hooks.create(field);
            }

            assigned[slot] = cell;
            retargeted.add(col);
        }

        // Pass 3 — per-column state, re-applied to every rendered cell so a
        // recycled cell never shows a trace of its previous column.
        for (let col = firstCol; col <= lastCol; col++) {
            const cell = assigned[col - firstCol]!;

            hooks.apply(cell, col, retargeted.has(col) || dirty);
        }

        // Discard what is left over.
        for (const cell of free) {
            row.removeComponent(cell);
            cell.dispose();
        }

        // Re-order children to the window's display order so sibling
        // iteration (e.g. `syncSortIndicators`) matches slot order.
        //
        // The order comes from `assigned`, which this reconciler just built in
        // slot order — not from re-sorting on `Field.getOrder()`. A model that
        // declares no `order` returns the -1 sentinel for every field, so an
        // order-based comparison ties throughout, the sort is a stable no-op,
        // and a recycled cell keeps whatever index it already held. That
        // desynchronises slot from column: `getColumns()[s]` stops being the
        // cell for column `_windowFirst + s`, which silently misplaces
        // geometry, resize indices, sort arrows and the focus underline.
        const slotOf = new Map(assigned.map((cell, slot) => [cell, slot]));

        row.sortComponents((c1, c2) =>
            (slotOf.get(c1 as TCell) ?? 0) - (slotOf.get(c2 as TCell) ?? 0));
    }

    /**
     * Shared slide-path reconciler: repoints the `|delta|` departing cells
     * directly onto the `|delta|` entering columns and leaves every surviving
     * cell untouched. A header cell (of either row) carries no per-column
     * type identity — unlike a body `Cell` — so the departing edge is always
     * exactly the right size and shape to serve the entering edge: no cache,
     * construction, or disposal is needed, and no detach/reattach either,
     * since every cell stays a mounted child throughout.
     *
     * @param row - The row whose cells to reconcile.
     * @param firstCol - The first visible-column index to render, inclusive.
     * @param lastCol - The last visible-column index to render, inclusive.
     * @param delta - The new window's first column minus the row's previous
     *   window start. Positive: window moved right. Negative: moved left.
     *   Never zero.
     * @param hooks - The two behaviours that differ between the column row
     *   and the filter row.
     * @returns The cells repointed at a new column this call.
     */
    private reconcileWindowedRowSlide<TCell extends Cell<any>>(
        row: Row, firstCol: number, lastCol: number, delta: number, hooks: WindowedRowHooks<TCell>,
    ): TCell[] {
        const width    = lastCol - firstCol + 1;
        const outCount = Math.abs(delta);

        // Snapshot first — `sortComponents` below reorders the live array, and
        // nothing here may observe that reordering mid-method.
        const cells = [...row.getComponents()] as TCell[];

        const survivorCells = delta > 0 ? cells.slice(outCount) : cells.slice(0, width - outCount);
        const enteringCells = delta > 0 ? cells.slice(0, outCount) : cells.slice(width - outCount);

        const enteringCols = delta > 0
            ? Util.range(lastCol - outCount + 1, lastCol)
            : Util.range(firstCol, firstCol + outCount - 1);

        enteringCols.forEach((col, i) => {
            const cell = enteringCells[i];

            row.setLayoutConstraints(cell, { data: this._visibleFields[col] });
            hooks.apply(cell, col, true);
        });

        const slotOf = new Map<TCell, number>();

        survivorCells.forEach((cell, i) => slotOf.set(cell, delta > 0 ? i : i + outCount));
        enteringCells.forEach((cell, i) => slotOf.set(cell, delta > 0 ? width - outCount + i : i));

        row.sortComponents((c1, c2) => (slotOf.get(c1 as TCell) ?? 0) - (slotOf.get(c2 as TCell) ?? 0));

        return enteringCells;
    }

    /**
     * Builds the {@link WindowedRowHooks} for the column row: `create`
     * constructs, parents and wires a fresh {@link HeaderCell}; `apply`
     * writes every per-column property (label, tooltip, glyph, group tint,
     * required marker), gating the ARIA column-index write on `retargeted` —
     * a survivor's own index cannot be stale, so that write stays scoped to a
     * retargeted cell (or every cell, once a field/config change widens the
     * scope via `dirty`).
     *
     * @param row - The column row the built hooks operate on.
     * @returns The column row's hooks.
     */
    private columnRowHooks(row: Row): WindowedRowHooks<HeaderCell> {
        const columnMap = new Map(this._columns.map(c => [c.getField().getName(), c]));

        return {
            create: (field: Field): HeaderCell => {
                const cell = new HeaderCell(field.getName(), field.getName(), null);

                row.addComponent(cell, { data: field });

                // Wire exactly once, at creation. The resize/sort/context
                // closures resolve the cell's visible-column index live (via
                // columnIndexOf) at emit time, so a later hide/show/scroll
                // that shifts indices needs no re-wiring. Re-wiring a
                // surviving cell would stack duplicate listeners on its
                // ListenerBag — making a single drag emit `columnresize`
                // several times with mismatched indices, and a single header
                // click cycle the sort twice.
                this.wireCell(cell);

                return cell;
            },
            apply: (cell: HeaderCell, col: number, retargeted: boolean): void => {
                const field  = this._visibleFields[col];
                const column = columnMap.get(field.getName());

                cell.setFieldName(field.getName());
                cell.setHeaderText(column?.getHeaderText() ?? field.getName());

                const description = field.getDescription();

                if (cell.getTooltip() !== description) {
                    cell.setTooltip(description);
                }

                const headerGlyph = column?.getHeaderGlyph() ?? null;

                if (cell.getHeaderGlyph() !== headerGlyph) {
                    cell.setHeaderGlyph(headerGlyph);
                }

                cell.setBaseBackground(column?.getGroupColor() ?? null);
                cell.setRequired(column?.isRequired() ?? false);

                if (retargeted) {
                    cell.getAria().setColIndex(col + 1);
                }
            },
        };
    }

    /**
     * Builds the {@link WindowedRowHooks} for the filter row: `create`
     * constructs, parents and wires a fresh {@link FilterCell}; `apply`
     * writes every per-column property (label, operators, numeric-only flag,
     * filter state) and always writes the ARIA column index — unlike the
     * column row, the filter row has no `syncSortIndicators`-style downstream
     * consumer to scope the write for, so `retargeted` goes unread here.
     *
     * @param row - The filter row the built hooks operate on.
     * @returns The filter row's hooks.
     */
    private filterRowHooks(row: Row): WindowedRowHooks<FilterCell> {
        const columnMap = new Map(this._columns.map(c => [c.getField().getName(), c]));
        const operatorsFor = (field: Field): ColumnFilterOperator[] => {
            const column = columnMap.get(field.getName());

            return column?.isFilterable() ? columnFilterOperators(field.getType()) : [];
        };

        return {
            create: (field: Field): FilterCell => {
                const cell = new FilterCell(field.getName(), operatorsFor(field));

                row.addComponent(cell, { data: field });
                this.wireFilterCell(cell);

                return cell;
            },
            apply: (cell: FilterCell, col: number): void => {
                const field     = this._visibleFields[col];
                const column    = columnMap.get(field.getName());
                const operators = operatorsFor(field);

                cell.setFieldName(field.getName());
                cell.setColumnLabel(column?.getHeaderText() ?? field.getName());
                cell.setOperators(operators);

                const target = this.filterTarget(field.getName());

                cell.setNumericOnly(target !== null && columnFilterTakesNumericOperand(target));
                cell.getAria().setColIndex(col + 1);

                if (operators.length > 0) {
                    cell.setFilterState(this.filterState().get(field.getName())
                        ?? { clauses: [{ operator: operators[0], text: '' }] });
                }
            },
        };
    }

    /**
     * Reconciles the column-row's rendered header cells to the
     * horizontally-visible column range `[firstCol, lastCol]`, via the
     * shared {@link reconcileWindowedRow} / {@link reconcileWindowedRowSlide}
     * algorithms and {@link columnRowHooks}. An ordinary same-width slide
     * takes the cheaper slide path instead: only the `|delta|` entering
     * cells are repointed, and only their per-column state is re-applied — a
     * surviving cell is left untouched rather than re-applied a second time
     * with the same values.
     *
     * Called from {@link renderColumnWindow}, which positions the returned
     * cells afterward.
     *
     * @param firstCol - The first visible-column index to render, inclusive.
     * @param lastCol - The last visible-column index to render, inclusive.
     * @returns `true` when the rendered cell set changed.
     */
    private reconcileColumnCells(firstCol: number, lastCol: number): boolean {
        const row = this.getComponents()[1] as Row;

        this._lastEnteredCells = undefined;

        const prevFirst = this._windowFirst;
        const prevWidth = row.getComponents().length;
        const prevLast  = prevFirst + prevWidth - 1;

        if (!this._columnsDirty && firstCol === prevFirst && lastCol === prevLast) {
            return false;
        }

        const width = lastCol - firstCol + 1;
        const delta = firstCol - prevFirst;
        const hooks = this.columnRowHooks(row);

        if (!this._columnsDirty && width === prevWidth && delta !== 0 && Math.abs(delta) < width) {
            this._lastEnteredCells = this.reconcileWindowedRowSlide(row, firstCol, lastCol, delta, hooks);
        } else {
            this.reconcileWindowedRow(row, firstCol, lastCol, this._columnsDirty, hooks);
        }

        this._windowFirst  = firstCol;
        this._columnsDirty = false;

        return true;
    }

    /**
     * Removes all existing parent-header cells and recreates one
     * {@link ParentHeaderCell} per contiguous run of visible columns
     * sharing the same group key. A run of adjacent ungrouped columns
     * shares one blank spanning cell so the parent row's surface stays
     * continuous.
     *
     * The visible-column order is read from `_columns` filtered by
     * `_hiddenColumns` and sorted by {@link Field.getOrder} — same
     * resolution path used by {@link rebuildCells}. Each cell's
     * `spanFrom` / `spanTo` indices are stored in its layout constraints'
     * `data` slot; the table layout manager reads them to position the
     * cell as the sum of underlying column widths.
     *
     * Mirrors `Table`'s private `computeGroupRuns`, which finds the same
     * contiguous runs for the rotated body, with one intended divergence: a
     * run here continues across a shared `null` group key, so adjacent
     * ungrouped columns merge into one blank spanning cell that keeps the
     * parent-header band continuous; `computeGroupRuns` breaks the run on
     * `null` and emits nothing for it, since a rotated body row has no such
     * continuity requirement.
     */
    private rebuildParentCells(): void {
        const row = this.getParentRow();

        row.disposeAllComponents();

        if (!this.hasParentRow()) {
            return;
        }

        const visibleCols = this._columns
            .filter(c => !this._hiddenColumns.has(c.getField().getName()))
            .sort((a, b) => a.getField().getOrder() - b.getField().getOrder());

        if (visibleCols.length === 0) {
            return;
        }

        let runStart = 0;
        let runKey   = visibleCols[0].getGroup();
        let runColor = visibleCols[0].getGroupColor();

        const flush = (endExclusive: number): void => {
            const cell = new ParentHeaderCell(runKey ?? "", runColor);

            // Field names spanned by this cell — drives the tooltip
            // and is also useful context if a future column-toggle
            // menu wants to operate on a whole group.
            const fieldNames = visibleCols
                .slice(runStart, endExclusive)
                .map(c => c.getField().getName());

            if (runKey !== null && fieldNames.length > 0) {
                cell.setTooltip(`${runKey}: ${fieldNames.join(", ")}`);
            }

            cell.on("contextmenu", (x, y) => {
                this.emit("columncontextmenu", "", x, y);
            });

            row.addComponent(cell, { data: { spanFrom: runStart, spanTo: endExclusive - 1 } });
        };

        for (let i = 1; i < visibleCols.length; i++) {
            const nextKey = visibleCols[i].getGroup();
            // A run continues when both sides share the same group key —
            // including two adjacent ungrouped columns, which share `null`
            // and so merge into one blank spanning cell.
            const runContinues = nextKey === runKey;

            if (!runContinues) {
                flush(i);

                runStart = i;
                runKey   = nextKey;
                runColor = visibleCols[i].getGroupColor();
            } else if (runColor === null && visibleCols[i].getGroupColor() !== null) {
                // First non-null `groupColor` in a run wins; pick it up
                // when an earlier column omitted the field and a later
                // one supplied it.
                runColor = visibleCols[i].getGroupColor();
            }
        }

        flush(visibleCols.length);
    }

    /**
     * Wires the sort, resize, and context-menu callbacks for one cell. Called
     * exactly once per cell, at creation.
     *
     * @param cell - The header cell whose listeners are being attached.
     *
     * @remarks The resize callbacks report the cell's *current* visible-column
     * index by looking it up live through {@link columnIndexOf} when the event
     * fires, rather than capturing an index at wiring time. This keeps the
     * index correct after a hide/show/reorder/scroll shuffles the columns
     * without re-wiring — re-wiring would stack duplicate listeners on the
     * surviving cell's `ListenerBag`.
     */
    private wireCell(cell: HeaderCell): void {
        cell.on("sortclick",   (fieldName, shiftKey) => this.handleSortClick(fieldName, shiftKey));
        cell.on("resizestart", (clientX) => this.emit("columnresizestart", this.columnIndexOf(cell), clientX));
        cell.on("resizedrag",  (clientX) => this.emit("columnresize", this.columnIndexOf(cell), clientX));
        cell.on("contextmenu", (fieldName, x, y) => this.emit("columncontextmenu", fieldName, x, y));
    }

    /**
     * Converts a rendered cell to its visible-column index — the slot it
     * occupies in the column row plus the window's start offset.
     *
     * @param cell - The header cell to resolve.
     * @returns The visible-column index, or `-1` when the cell is not currently rendered.
     */
    private columnIndexOf(cell: HeaderCell): number {
        const slot = this.getColumns().indexOf(cell);

        return slot === -1 ? -1 : this._windowFirst + slot;
    }

    /**
     * Handles a click on a header cell, cycling sort state on the underlying store.
     *
     * @param fieldName - The field associated with the clicked column.
     * @param shiftKey - Whether the shift key was held; toggles multi-column sort composition.
     *
     * @remarks
     * Without shift, behaviour is asc → desc → cleared on the clicked column.
     * With shift, the column is appended/toggled within the existing sort list:
     * not present → append asc; asc → flip to desc; desc → remove from the list.
     */
    private handleSortClick(fieldName: string, shiftKey: boolean): void {
        if (shiftKey) {
            const sorters = this._store.getActiveSorters();
            const idx     = sorters.findIndex(s => s.field === fieldName);
            let next: SortDescriptor[];

            if (idx === -1) {
                next = [...sorters, { field: fieldName, dir: 'asc' }];
            } else if (sorters[idx].dir === 'asc') {
                next = sorters.map((s, i) =>
                    i === idx ? { field: s.field, dir: 'desc' } : s
                );
            } else {
                next = sorters.filter((_, i) => i !== idx);
            }

            if (next.length === 0) {
                this._store.clearSort();
            } else {
                this._store.sort(next);
            }
        } else {
            const sorters = this._store.getActiveSorters();
            const current = sorters.length === 1 && sorters[0].field === fieldName
                ? sorters[0] : null;

            if (!current) {
                this._store.sort(fieldName, 'asc');
            } else if (current.dir === 'asc') {
                this._store.sort(fieldName, 'desc');
            } else {
                this._store.clearSort();
            }
        }

        this.syncSortIndicators();
    }

    /**
     * Refreshes a rendered header cell's sort arrow and priority badge to
     * match the store's current `activeSorters` list.
     *
     * @param cells - The cells to refresh. Omit to sweep every rendered
     *   cell — the default for first render, a resize, a column-set change,
     *   or a jump. Passed explicitly only by {@link renderColumnWindow}'s
     *   fast-path branch, to scope the sweep to the cells that actually
     *   entered the window this tick: a survivor's own field never changes
     *   across a slide, and its sort/priority state depends only on that
     *   field plus `_store.getActiveSorters()`, which is also unchanged
     *   mid-slide, so a survivor's indicator cannot go stale from a slide.
     */
    private syncSortIndicators(cells?: HeaderCell[]): void {
        const sorters       = this._store.getActiveSorters();
        const fieldToSorter = new Map(sorters.map((s, i) => [s.field, { dir: s.dir, priority: i + 1 }]));
        const showPriority  = sorters.length > 1;

        for (const cell of cells ?? (this.getColumns() as HeaderCell[])) {
            const entry = fieldToSorter.get(cell.getFieldName());

            if (entry) {
                cell.setSortState(entry.dir, showPriority ? entry.priority : null);
            } else {
                cell.clearSortState();
            }
        }
    }

    /**
     * Registered on the store's `'sortchange'` event so a sort applied any
     * way other than clicking this header — a programmatic
     * `AbstractStore.sort()`/`clearSort()`, or {@link Table.setDisplayMode}
     * swapping in a store whose sort already differs — still reaches every
     * rendered cell. {@link handleSortClick} already does this for its own
     * clicks; this covers every other path, including a survivor a
     * fast-path slide would otherwise leave untouched (see
     * {@link _lastEnteredCells}), by always sweeping the full rendered set
     * rather than scoping to whatever the last reconcile touched.
     */
    private onStoreSortChange(): void {
        this.syncSortIndicators();
    }

    /**
     * Returns (creating on first use) the `{ operator, text }` map for the
     * currently-bound store. Keyed per store, rather than held flat, so a
     * round trip through rotated mode — which re-points this header at the
     * projection store and back — restores the source store's filter row
     * unchanged instead of showing one store's text over another's columns.
     *
     * @returns The current store's field-name-to-state map.
     */
    private filterState(): Map<string, ColumnFilterState> {
        let map = this._filterStates.get(this._store);

        if (!map) {
            map = new Map();
            this._filterStates.set(this._store, map);
        }

        return map;
    }

    /**
     * Handles a `"filterchange"` event from a rendered {@link FilterCell}:
     * caches the new state, flushes any other field's pending write first
     * (a horizontal scroll can retarget the pending field's timer before it
     * fires, but a *different* field changing while one is pending still
     * needs the earlier one applied), then schedules — or, when `immediate`,
     * applies — this field's write.
     *
     * @param fieldName - The field the change targets.
     * @param state - The cell's new operator + text.
     * @param immediate - `true` to bypass the debounce (operator pick, Enter, Escape).
     */
    private onFilterCellChange(fieldName: string, state: ColumnFilterState, immediate: boolean): void {
        const cached    = this.filterState().get(fieldName);
        const unchanged = !!cached && columnFilterStatesEqual(cached, state);

        // A repeat keystroke reporting the same state is dropped so it
        // doesn't reschedule the debounce timer for no reason — but an
        // `immediate` request (operator pick, Enter, Escape) must still
        // flush even when the state matches what a still-pending debounced
        // keystroke already cached; otherwise pressing Enter right after
        // typing would silently do nothing, leaving the write to land only
        // when the original timer eventually fires.
        if (unchanged && !immediate) {
            return;
        }

        this.filterState().set(fieldName, state);

        if (this._pendingFilterField !== null && this._pendingFilterField !== fieldName) {
            this.applyPendingFilter();
        }

        if (this._filterTimer !== null) {
            clearTimeout(this._filterTimer);
            this._filterTimer = null;
        }

        this._pendingFilterField = fieldName;

        if (immediate) {
            this.applyPendingFilter();
        } else {
            this._filterTimer = setTimeout(() => this.applyPendingFilter(), COLUMN_FILTER_DEBOUNCE_MS);
        }
    }

    /**
     * Resolves the {@link ColumnFilterTarget} {@link buildColumnFilter} needs
     * for `fieldName` — the field's declared type plus its config's `values`
     * / `showSeconds`.
     *
     * @param fieldName - The field to resolve a filter target for.
     * @returns The resolved target, or `null` when the field is unknown to
     *   the currently-bound model.
     */
    private filterTarget(fieldName: string): ColumnFilterTarget | null {
        const field = this._model.getField(fieldName);

        if (!field) {
            return null;
        }

        const config = this._columnConfigs.get(fieldName);

        return { type: field.getType(), values: config?.values, showSeconds: config?.showSeconds };
    }

    /**
     * Clears the pending timer and writes the pending field's cached state to
     * the store via {@link buildColumnFilter}, converting a blank or
     * unparseable state to `null` (removing the field's filter) rather than
     * writing a broken descriptor.
     */
    private applyPendingFilter(): void {
        if (this._filterTimer !== null) {
            clearTimeout(this._filterTimer);
            this._filterTimer = null;
        }

        const fieldName = this._pendingFilterField;

        if (fieldName === null) {
            return;
        }

        this._pendingFilterField = null;

        const state  = this.filterState().get(fieldName);
        const target = this.filterTarget(fieldName);

        if (!state || !target) {
            return;
        }

        void this._store.setFilter(fieldName, buildColumnFilter(fieldName, target, state, this._cellText));
    }

    /**
     * Registered on the store's `'filterchange'` event so an external
     * mutation — `store.clearFilter()`, or a programmatic `setFilter` —
     * re-syncs the filter row instead of leaving it showing stale text over
     * unfiltered data.
     *
     * Deliberately only *drops* a cached entry once its column no longer
     * has a matching filter in the store; it never reconstructs text from a
     * descriptor (a temporal descriptor holds a `Date`, and formatting it
     * back would rewrite what the user typed). The field with a debounced
     * write still in flight is skipped, since its descriptor has not been
     * written yet.
     */
    private onStoreFilterChange(): void {
        const states = this.filterState();

        for (const [fieldName, state] of states) {
            if (fieldName === this._pendingFilterField) {
                continue;
            }

            const target = this.filterTarget(fieldName);

            if (!target) {
                continue;
            }

            const built = buildColumnFilter(fieldName, target, state, this._cellText);

            if (built !== null && this._store.getFilter(fieldName) === null) {
                states.delete(fieldName);
            }
        }

        this._filterCellsDirty = true;
        this.renderColumnWindow();
    }

    /**
     * Wires the `"filterchange"` callback for one filter cell. Called
     * exactly once per cell, at creation — mirroring {@link wireCell}.
     *
     * @param cell - The filter cell whose listener is being attached.
     */
    private wireFilterCell(cell: FilterCell): void {
        cell.on("filterchange", (fieldName, state, immediate) => this.onFilterCellChange(fieldName, state, immediate));
    }

    /**
     * Reconciles the filter row's rendered cells to the horizontally-visible
     * column range `[firstCol, lastCol]`, via the shared
     * {@link reconcileWindowedRow} / {@link reconcileWindowedRowSlide}
     * algorithms and {@link filterRowHooks} — tracked by its own
     * {@link _filterCellsDirty} flag and {@link _filterWindowFirst} offset.
     * A column that is not filterable still gets a cell, so the row stays
     * column-aligned; an empty operator list is what renders that cell blank.
     *
     * When {@link hasFilterRow} is `false` every cell is disposed and the
     * row stays empty, mirroring {@link rebuildParentCells}'s own
     * disabled-state handling.
     *
     * @param firstCol - The first visible-column index to render, inclusive.
     * @param lastCol - The last visible-column index to render, inclusive.
     * @returns `true` when the rendered cell set changed.
     */
    private reconcileFilterCells(firstCol: number, lastCol: number): boolean {
        const row = this.getFilterRow();

        if (!this.hasFilterRow()) {
            if (row.getComponents().length === 0 && !this._filterCellsDirty) {
                return false;
            }

            for (const cell of row.getComponents().slice() as FilterCell[]) {
                row.removeComponent(cell);
                cell.dispose();
            }

            this._filterCellsDirty = false;

            return true;
        }

        const prevFirst = this._filterWindowFirst;
        const prevWidth = row.getComponents().length;
        const prevLast  = prevFirst + prevWidth - 1;

        if (!this._filterCellsDirty && firstCol === prevFirst && lastCol === prevLast) {
            return false;
        }

        const width = lastCol - firstCol + 1;
        const delta = firstCol - prevFirst;
        const hooks = this.filterRowHooks(row);

        if (!this._filterCellsDirty && width === prevWidth && delta !== 0 && Math.abs(delta) < width) {
            this.reconcileWindowedRowSlide(row, firstCol, lastCol, delta, hooks);
        } else {
            this.reconcileWindowedRow(row, firstCol, lastCol, this._filterCellsDirty, hooks);
        }

        this._filterWindowFirst = firstCol;
        this._filterCellsDirty  = false;

        return true;
    }

    /**
     * Reconciles the rendered header cells to the horizontally-visible column
     * range and positions every rendered cell in all three rows.
     *
     * @param geometry - Replaces the cached geometry when supplied; the cached
     *   value is reused when omitted.
     * @returns This header, for method chaining.
     */
    renderColumnWindow(geometry?: HeaderColumnGeometry): this {
        if (geometry) {
            this._geometry = geometry;
        }

        const g       = this._geometry;
        const widths  = this._visibleFields.map((_, i) => g.columnWidths[i] ?? 0);
        const win     = computeColumnWindow(widths, this._scrollX, g.viewportWidth);
        const changed = this.reconcileColumnCells(win.firstCol, win.lastCol);

        if (changed) {
            this.syncSortIndicators(this._lastEnteredCells);
            this.applyFocusedColumn();
        }

        this.positionColumnCells(win, g.columnHeight);
        this.positionParentCells(win, g.parentRowHeight);

        this.reconcileFilterCells(win.firstCol, win.lastCol);
        this.positionFilterCells(win, g.filterRowHeight);

        return this;
    }

    /**
     * Marks every rendered cell in all three rows dirty, so the next
     * {@link applyBounds} call each of {@link positionFilterCells} /
     * {@link positionColumnCells} / {@link positionParentCells} makes cannot
     * skip it even when its rectangle is unchanged. Called on a theme change —
     * see the constructor's theme subscription — the one writer in
     * {@link Cell.canSkipUnchangedLayout}'s enumeration that does not lay its
     * cell out itself.
     */
    private invalidateCellLayouts(): void {
        for (const cell of this.getParentRow().getComponents()) {
            cell.invalidateLayout();
        }

        for (const cell of this.getComponents()[1].getComponents()) {
            cell.invalidateLayout();
        }

        for (const cell of this.getFilterRow().getComponents()) {
            cell.invalidateLayout();
        }
    }

    /**
     * Positions every rendered filter-row cell from the window's `lefts` /
     * `widths` arrays, mirroring {@link positionColumnCells} — the filter
     * row is windowed exactly like the column row, one cell per visible
     * column.
     *
     * @param win - The column window computed by {@link renderColumnWindow}.
     * @param filterRowHeight - The filter row's height in pixels; `0` when collapsed.
     */
    private positionFilterCells(win: ColumnWindow, filterRowHeight: number): void {
        const cells = this.getFilterRow().getComponents();

        for (let slot = 0; slot < cells.length; slot++) {
            const col = win.firstCol + slot;

            cells[slot].applyBounds(win.lefts[col] ?? 0, 0, win.widths[col] ?? 0, filterRowHeight);
        }
    }

    /**
     * Positions every rendered column-row cell from the window's `lefts`
     * and `widths` arrays — the same geometry {@link reconcileColumnCells}
     * just reconciled the cell set against.
     *
     * @param win - The column window computed by {@link renderColumnWindow}.
     * @param columnHeight - The column row's height in pixels.
     */
    private positionColumnCells(win: ColumnWindow, columnHeight: number): void {
        const cells = this.getColumns();

        for (let slot = 0; slot < cells.length; slot++) {
            const col = win.firstCol + slot;

            cells[slot].applyBounds(win.lefts[col] ?? 0, 0, win.widths[col] ?? 0, columnHeight);
        }
    }

    /**
     * Positions every parent-row cell from the window's `lefts` / `widths`
     * arrays in constant time: a cell's x is the left offset of its
     * `spanFrom` column, and its width is the sum of every column across
     * its span.
     *
     * @param win - The column window computed by {@link renderColumnWindow}.
     * @param parentRowHeight - The parent row's height in pixels; `0` when collapsed.
     */
    private positionParentCells(win: ColumnWindow, parentRowHeight: number): void {
        const row = this.getParentRow();

        for (const cell of row.getComponents()) {
            const lc   = row.getLayoutConstraints(cell);
            const span = lc?.data as { spanFrom: number, spanTo: number } | undefined;
            const from = span?.spanFrom ?? 0;
            const to   = span?.spanTo   ?? 0;
            const x    = win.lefts[from] ?? 0;
            const w    = (win.lefts[to] ?? 0) + (win.widths[to] ?? 0) - x;

            cell.applyBounds(x, 0, w, parentRowHeight);
        }
    }

    /**
     * Mirrors the body's horizontal scroll offset onto the header's three
     * inner rows and re-renders the column window.
     *
     * Translates the three inner rows (parent row + column row + filter row)
     * rather than the header element itself — the header band stays pinned
     * to the viewport width so its background covers the vertical-scrollbar
     * reserve band on the right edge, and only the cells inside scroll with
     * the body.
     *
     * @param scrollLeft - The new horizontal scroll offset, in pixels.
     * @returns This header, for method chaining.
     */
    setScrollX(scrollLeft: number): this {
        if (scrollLeft === this._scrollX) {
            return this;
        }

        this._scrollX = scrollLeft;

        this.getParentRow().setTranslate(-scrollLeft, 0);
        this.getComponents()[1].setTranslate(-scrollLeft, 0);
        this.getFilterRow().setTranslate(-scrollLeft, 0);

        this.renderColumnWindow();

        return this;
    }

    /**
     * Returns the horizontal scroll offset last applied.
     *
     * @returns The scroll offset in pixels.
     */
    getScrollX(): number {
        return this._scrollX;
    }

    /**
     * Paints the column-focus underline on the rendered cell for `colIndex`
     * and clears it everywhere else. `null` clears every cell.
     *
     * @param colIndex - The visible-column index to focus, or `null` to clear.
     * @returns This header, for method chaining.
     */
    setFocusedColumn(colIndex: number | null): this {
        this._focusedCol = colIndex;

        this.applyFocusedColumn();

        return this;
    }

    /**
     * Re-applies `_focusedCol` to the currently-rendered cells. Called
     * directly from {@link setFocusedColumn} and again at the end of every
     * reconcile that changed the rendered set, so a cell recycled into the
     * focused column picks up the underline without waiting for the next
     * explicit `setFocusedColumn` call.
     */
    private applyFocusedColumn(): void {
        const cells = this.getColumns() as HeaderCell[];

        for (let slot = 0; slot < cells.length; slot++) {
            cells[slot].setColumnFocused(this._windowFirst + slot === this._focusedCol);
        }
    }

    /**
     * Clears the pending filter-write timer and detaches this header's store
     * listener before the inherited teardown runs.
     */
    protected destructor(): void {
        if (this._filterTimer !== null) {
            clearTimeout(this._filterTimer);
            this._filterTimer = null;
        }

        this._store.off('filterchange', this._boundOnStoreFilterChange);
        this._store.off('sortchange', this._boundOnStoreSortChange);
        this._cellText.dispose();

        super.destructor();
    }
}

const TableHeaderCallable = callable(TableHeader);
type TableHeaderCallable = TableHeader;
export {
    TableHeader         as _TableHeader,
    TableHeaderCallable as TableHeader
};
