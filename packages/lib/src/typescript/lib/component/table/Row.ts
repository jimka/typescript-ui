// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { AbstractModel } from "~/data/AbstractModel.js";
import { Field } from "~/data/Field.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { Cell } from "~/component/table/cell/Cell.js";
import { DynamicCell } from "~/component/table/cell/Dynamic.js";
import { DefaultCell } from "~/component/table/cell/Default.js";
import { GroupSeparatorCell } from "~/component/table/cell/GroupSeparator.js";
import { StringCell } from "~/component/table/cell/String.js";
import { BooleanCell } from "~/component/table/cell/Boolean.js";
import { NumberCell } from "~/component/table/cell/Number.js";
import { DateCell } from "~/component/table/cell/Date.js";
import { TimeCell } from "~/component/table/cell/Time.js";
import { DateTimeCell } from "~/component/table/cell/DateTime.js";
import { GlyphCell } from "~/component/table/cell/Glyph.js";
import { ComboCell } from "~/component/table/cell/Combo.js";
import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { TreeCellRenderer, DEFAULT_INDENT_PX } from "~/component/table/cell/renderer/TreeCell.js";
import type { ColumnConfig } from "~/component/table/ColumnConfig.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import { Util } from "~/core/Util.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";

/**
 * Per-tick reconciliation aid `Body` computes once per render pass and hands
 * to every pooled row's `setColumnWindow` call. Present only when this
 * tick's column-window change is an ordinary same-width slide that overlaps
 * the previous window; undefined for a resize, a field-set change, a jump
 * larger than the window, or the first render.
 *
 * @internal Not re-exported from the `component/table` barrel — cross-file
 * internal use only, matching how `ColumnWindow` is handled in `Body.ts`.
 */
export interface ColumnWindowSlidePlan {
    /** The visible-column window this row must have been showing last tick to qualify for the fast path. */
    prevFirstCol: number;
    prevLastCol: number;
    /** newFirstCol - prevFirstCol. Positive: window moved right. Negative: moved left. Never zero. */
    delta: number;
    /** cellKeyFor-equivalent key for each column newly entering the window this tick, keyed by absolute visible-column index. Covers exactly the |delta| entering columns. */
    enteringKeys: Map<number, string>;
}

/**
 * One cell `Row.setColumnWindow` built, recycled, or restored on its last
 * call, paired with the field it now presents.
 *
 * @internal Not re-exported from the `component/table` barrel.
 */
export interface RetargetedCell {
    cell: Cell<any>;
    fieldName: string;
}

/**
 * A single data row in the table, rendered as a `<tr>` element.
 *
 * Creates one typed cell ({@link StringCell}, {@link NumberCell}, {@link BooleanCell},
 * or {@link DefaultCell}) per column in the body's current column window and binds each
 * cell's commit callback to the corresponding field on the bound {@link ModelRecord}.
 *
 * Re-exported as `TableRow` from the package barrel.
 *
 * @category Components
 */
class Row extends Component {

    // Declares the four ephemeral per-record tints — see `## Architecture
    // Decisions` — highest priority first: a selected row's wash always
    // wins over new/dirty/stripe (declared later, so each one's generated
    // guard suffix excludes `.selected`), and among new/dirty/stripe
    // themselves, `updateVisualState`'s own call order below (each
    // condition already excludes the ones before it, matching the old
    // if/else-if chain) means only one of the three is ever actually
    // active at once — no guard exclusivity between them is needed.
    // `Body.updateRowVisualState` drives `.selected` directly via the
    // inherited `setStyleState` (Row declares it; Body has no state
    // machinery of its own to duplicate it in).
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".selected",
            extract: (): StyleBag => ({
                backgroundColor: "var(--ts-ui-table-row-selected, rgba(30, 100, 200, 0.15))",
                shadow:          "var(--ts-ui-table-row-selected-border, none)",
            }),
        },
        {
            selector: ".new",
            extract: (): StyleBag => ({ backgroundColor: "var(--ts-ui-table-row-new, rgba(70, 200, 70, 0.15))" }),
        },
        {
            selector: ".dirty",
            extract: (): StyleBag => ({ backgroundColor: "var(--ts-ui-table-row-dirty, rgba(255, 165, 0, 0.15))" }),
        },
        {
            selector: ".stripe",
            extract: (): StyleBag => ({ backgroundColor: "var(--ts-ui-table-row-stripe, rgba(0, 0, 0, 0.035))" }),
        },
    ];

    private _model?: AbstractModel;
    private _data?: ModelRecord;
    private _onCellCommit?: (record: ModelRecord) => void;
    private _treeCell: Cell<any> | null = null;
    private _stripe: boolean = false;

    // All non-hidden fields, in display order — the full column list a
    // window is carved out of. Populated by `setColumnFields`.
    private _visibleFields: Field[] = [];
    private _columnConfigs: Map<string, ColumnConfig> = new Map();
    private _treeFieldName: string | undefined;
    // Visible-column index of slot 0. The rendered columns are always a
    // contiguous run, so slot `s` holds column `_windowFirst + s`.
    private _windowFirst: number = 0;
    // Cell key per rendered slot, index-aligned with `getComponents()`.
    private _cellKeys: string[] = [];
    // Field name per rendered slot, index-aligned with `getComponents()`.
    private _fieldNames: string[] = [];
    // Cells detached from the rendered set that no entering column could take,
    // filed by `cellKeyFor` key so a later widen restores them instead of
    // rebuilding. Framework-managed bookkeeping — not a consumer surface, so it
    // stays off any options bag. A plain initializer is correct here: no setter
    // `applyOptions` dispatches writes this field, so the `declare` rule in
    // CODE_CONVENTIONS.md does not apply.
    private _cellCache: Map<string, Cell<any>[]> = new Map();
    // Cells `setColumnWindow` built, recycled, or restored on its last call —
    // populated by both the full path's pass 3 and the fast path, and read
    // by `Body` via `getRetargetedCells()` to scope its own per-row sweeps
    // to just the cells that actually changed. Reset at the top of every
    // `setColumnWindow` call, so a no-op call reports an empty list.
    private _lastRetargeted: RetargetedCell[] = [];
    // Set by `setColumnFields` so the next `setColumnWindow` reconciles
    // even when the requested range happens to match the current one —
    // a column-set change (hide/show, config swap) can leave the range
    // unchanged while the cells behind it need to change.
    private _columnsDirty: boolean = false;
    // Set by `renderSeparator` and cleared by `setColumnWindow`'s guard —
    // this row currently shows a single group-separator cell instead of the
    // usual per-column cells (rotated-mode group runs only). Not for
    // consumer use.
    private _separatorMode: boolean = false;

    constructor(
        model?: AbstractModel,
        data?: ModelRecord,
        hiddenColumns: Set<string> = new Set(),
        columnConfigs: Map<string, ColumnConfig> = new Map(),
        onCellCommit?: (record: ModelRecord) => void,
        treeFieldName?: string,
    ) {
        super({ tag: "tr" });

        this.getAria().setRole("row");

        this._model = model;
        this._data = data;
        this._onCellCommit = onCellCommit;

        if (this._model) {
            this.setColumnFields(this._model, hiddenColumns, columnConfigs, treeFieldName);
        }
    }

    /**
     * Returns the cell on the row's tree column. The host `TreeBody` reads
     * this to find each row's `TreeCellRenderer` for depth / toggle updates
     * and toggle-click routing.
     *
     * Returns `null` when the row was constructed without a `treeFieldName`,
     * and also whenever the tree column sits outside the row's current column
     * window — a row renders only its horizontally-visible columns, so a wide
     * table scrolled right has no tree cell to return. Callers must handle
     * `null` on every access rather than caching the result.
     *
     * @returns The tree-column {@link Cell}, or `null`.
     */
    getTreeCell(): Cell<any> | null {
        return this._treeCell;
    }

    /**
     * Returns the visible-column index of the first rendered cell —
     * `getComponents()[s]` renders visible column `getColumnWindowStart() + s`.
     *
     * @returns The visible-column index slot `0` currently renders.
     */
    getColumnWindowStart(): number {
        return this._windowFirst;
    }

    /**
     * Returns one field name per *rendered* slot, index-aligned with
     * `getComponents()`. Hidden columns are excluded.
     *
     * A row renders only the columns in its current column window, so this
     * describes that window rather than every visible column: slot `s` names
     * visible column {@link getColumnWindowStart} + `s`. Code holding a column
     * index must subtract that offset before indexing here, and code reading a
     * slot must add it to recover the column index.
     *
     * @returns The field names, one per rendered slot.
     *
     * @remarks Used by the host `Body` to align cell index → field name
     * → {@link ColumnConfig} lookup when resolving per-cell read-only
     * state on each rebind. Not for consumer use.
     */
    getFieldNames(): string[] {
        return this._fieldNames;
    }

    /**
     * Returns the cells `setColumnWindow` built, recycled, or restored on
     * its last call, paired with the field each now presents.
     *
     * @returns The retargeted cells from the last `setColumnWindow` call.
     *
     * @remarks Not for consumer use — read by `Body` right after a
     * `setColumnWindow` call that reported `true`, to scope its own
     * per-row sweeps (`wireRowCells`, `applyReadOnlyState`) to just the
     * cells that actually changed.
     */
    getRetargetedCells(): RetargetedCell[] {
        return this._lastRetargeted;
    }

    /**
     * Returns whether this row currently renders a single group-separator
     * cell (see {@link renderSeparator}) instead of its usual per-column cells.
     *
     * @returns `true` while in separator mode.
     *
     * @remarks Not for consumer use — internal wiring consulted by `Body`
     * (`bindAndPositionRows`, `onRowClick`) so a separator row is skipped by
     * click selection and keyboard row navigation.
     */
    isSeparator(): boolean {
        return this._separatorMode;
    }

    /**
     * Indents this row's `field`-name cell by `DEFAULT_INDENT_PX` (from
     * `TreeCellRenderer` — the same per-level indent Tree uses) so a
     * rotated-mode group's member rows read as visually nested under their
     * {@link GroupSeparatorCell}, or restores it flush-left. A no-op when
     * this row has no `field` cell in its current window (outside rotated
     * mode, or a separator row).
     *
     * @param indented - `true` to indent, `false` to restore flush-left.
     *
     * @remarks Not for consumer use — called by `Body.bindAndPositionRows`
     * via the `Table`-supplied indent predicate.
     */
    setFieldIndent(indented: boolean): void {
        const slot = this._fieldNames.indexOf('field');

        if (slot === -1) {
            return;
        }

        const cell = this.getComponents()[slot] as Cell<any>;

        cell.setInsets(new Insets(0, 0, 0, indented ? DEFAULT_INDENT_PX : 0));
    }

    /**
     * Returns the ModelRecord currently bound to this row.
     *
     * @returns The bound {@link ModelRecord}, or undefined if none has been set.
     */
    getData() {
        return this._data;
    }

    /**
     * Rebinds all cells to a new record, updating their displayed values.
     *
     * @param record - The new record to bind to this row.
     */
    setData(record: ModelRecord) : this {
        this._data = record;

        const cells = this.getComponents() as Cell<any>[];
        const names = this._fieldNames;

        for (let i = 0; i < names.length; i++) {
            this.bindCell(cells[i], record, names[i]);
        }

        this.updateVisualState();

        return this;
    }

    /**
     * Marks whether this row sits on a striped (odd) logical index, so the
     * resting background paints the zebra stripe.
     *
     * @param striped - True when this row's logical data index is odd.
     *
     * @remarks Set by the host Body on each rebind from `dataIndex % 2`; it only
     * updates the backing flag, so call `updateVisualState` afterwards to repaint.
     * Not for consumer use.
     */
    setStripe(striped: boolean): void {
        this._stripe = striped;
    }

    /**
     * Applies a background color based on the record's new/dirty/clean state.
     *
     * @remarks New records get a green tint, dirty records an orange tint, and clean records the zebra stripe (odd rows) or no tint (even rows).
     */
    updateVisualState(): void {
        // Per-record ephemeral tint on a pooled row re-bound to a new record
        // on every render: `setStyleState` toggles a shared `.Row.new`/
        // `.Row.dirty`/`.Row.stripe` class-tier rule via a DOM class token
        // rather than a cached setter, so nothing here persists into
        // `_instanceStyle` to replay onto the next record bound to this
        // reused row (see `## Architecture Decisions`) — no per-recycle
        // stylesheet-rule materialisation, no inline style to clean up.
        // Mutually exclusive by construction (each condition already
        // excludes the ones before it, matching the old if/else-if chain),
        // and `.selected` (see `ownStyleStates`, above) always wins
        // regardless of which of these three is active, via its own
        // higher-priority guard.
        this.setStyleState(".new",    !!this._data?.isNew());
        this.setStyleState(".dirty",  !this._data?.isNew() && !!this._data?.isDirty());
        this.setStyleState(".stripe", !this._data?.isNew() && !this._data?.isDirty() && this._stripe);
    }

    /**
     * Appends a cell component to this row.
     *
     * @param cell - The cell to append.
     * @param constraints - Optional. Layout constraints for the cell.
     */
    addColumn(cell: Cell<any>, constraints?: LayoutConstraints) : this {
        this.addComponent(cell, constraints);

        return this;
    }

    /**
     * Adds a cell as a child component of this row.
     *
     * @param cell - The cell component to add.
     * @param constraints - Optional. Layout constraints for the cell.
     *
     * @returns This component, for method chaining.
     */
    addComponent(cell: Cell<any>, constraints?: LayoutConstraints): this {
        super.addComponent(cell, constraints);

        return this;
    }

    /**
     * Records the visible-field list, per-field configs and tree column
     * this row renders from. Builds no cells — {@link setColumnWindow}
     * owns cell construction, called separately once the host `Body`
     * knows which column range to render.
     *
     * @param model - The model whose visible fields drive the cell list.
     * @param hiddenColumns - The set of field names to exclude.
     * @param columnConfigs - Per-field configs (carries `showSeconds`,
     *   `groupColor`, etc.).
     * @param treeFieldName - Optional. Field name of the column that
     *   carries the tree-cell renderer; matches the constructor's
     *   parameter of the same name.
     *
     * @returns This row, for method chaining.
     */
    setColumnFields(
        model: AbstractModel,
        hiddenColumns: Set<string>,
        columnConfigs: Map<string, ColumnConfig>,
        treeFieldName?: string,
    ): this {
        // The field set, the per-field configs, or the whole model may all be
        // changing, so a cell cached under a key derived from the old
        // configuration must not be handed to the new one.
        this.disposeCellCache();

        this._model = model;

        this._visibleFields = model.getFields()
                                   .filter(f => !hiddenColumns.has(f.getName()))
                                   .sort((f1, f2) => f1.getOrder() - f2.getOrder());

        this._columnConfigs = columnConfigs;
        this._treeFieldName = treeFieldName;
        this._columnsDirty  = true;

        return this;
    }

    /**
     * Retires this row's current cells into its cell cache and mounts a
     * single {@link GroupSeparatorCell} spanning the whole row, labeling a
     * contiguous run of a rotated table's grouped field/value rows. The
     * row's own ARIA role switches to `'separator'` (from the default
     * `'row'`); {@link setColumnWindow}'s guard reverses both the moment
     * this pooled slot is asked to render a real field row again, restoring
     * the retired cells from the cache rather than rebuilding them.
     *
     * @param label - The group label to display.
     * @param color - Optional CSS color string for the separator's
     *   background; `null` shows only its top divider.
     *
     * @remarks Not for consumer use — called by `Body.bindAndPositionRows`
     * via the `Table`-supplied separator predicate.
     */
    renderSeparator(label: string, color: string | null): void {
        // Snapshot first — retirement removes each cell, which splices the
        // live array `getComponents()` returns.
        const cells = [...this.getComponents()] as Cell<any>[];

        for (let s = 0; s < cells.length; s++) {
            this.retireCell(cells[s], this._cellKeys[s]);
        }

        this.addComponent(new GroupSeparatorCell(label, color));

        this._separatorMode = true;
        this._windowFirst    = 0;
        this._fieldNames     = [];
        this._cellKeys       = [];
        this._treeCell       = null;
        this._columnsDirty   = true;   // forces the next setColumnWindow to rebuild fully

        this.getAria().setRole("separator");
    }

    /**
     * Reconciles the rendered cells to exactly the visible columns
     * `[firstCol, lastCol]`. A column keeps its existing cell when that
     * cell already presents the same field; otherwise it recycles a cell
     * that just left the window and shares the same cell key, restores a
     * matching cell previously parked by an earlier narrow, or builds a
     * fresh one. Cells that end up unclaimed are committed (if editing),
     * removed, and parked in the row's cell cache so a later widen can
     * restore them — a cell whose slot carried no key is disposed instead.
     *
     * When `plan` describes an ordinary same-width slide that overlaps this
     * row's own previous window exactly as `Body` last left it, retires the
     * departing edge into the cell cache and resolves only the entering
     * edge instead of reconciling every rendered column — see the plan's
     * Architecture Decisions for the exact eligibility conditions.
     *
     * @param firstCol - The first visible-column index to render, inclusive.
     * @param lastCol - The last visible-column index to render, inclusive.
     * @param plan - Optional. This tick's slide plan from `Body`, present
     *   only for an ordinary same-width horizontal slide.
     *
     * @returns `true` when the rendered cell set changed.
     */
    setColumnWindow(firstCol: number, lastCol: number, plan?: ColumnWindowSlidePlan): boolean {
        this._lastRetargeted = [];

        // Captured before anything below clears it. `_columnsDirty` means
        // `setColumnFields` (or a separator flip) ran since the last call —
        // a field/config change whose per-column derived state (e.g. Body's
        // read-only union) can differ even for a column pass 1 matches to
        // its existing cell by identity. Such a survivor is not otherwise
        // added to `_lastRetargeted` (its value doesn't need rebinding), so
        // this flag widens `_lastRetargeted` below to cover it too — Body
        // must not skip re-deriving state it owns just because the cell
        // object itself didn't change.
        const columnsDirtyAtEntry = this._columnsDirty;

        if (this._separatorMode) {
            this.disposeAllComponents();

            this._separatorMode = false;
            this._columnsDirty  = true;
            this.getAria().setRole("row");
        }

        // Clamp into this row's own visible-field range. A pooled row can be
        // asked to window against a range sized for a store the host `Body`
        // has already swapped to (`Table.setStore` calls `Body.setStore`,
        // which renders synchronously, before `setColumns` resyncs this
        // row's `_visibleFields` to the new model) — the request is stale
        // for one pass, not invalid, so it is clamped rather than trusted
        // verbatim. The immediately-following `setColumns` call marks the
        // row dirty and re-renders against the caught-up field list.
        const maxCol = this._visibleFields.length - 1;

        lastCol = Math.min(lastCol, maxCol);

        if (firstCol > lastCol) {
            firstCol = lastCol + 1;
        }

        const currentLastCol = this._windowFirst + this.getComponents().length - 1;

        if (!this._columnsDirty && firstCol === this._windowFirst && lastCol === currentLastCol) {
            return false;
        }

        const width = lastCol - firstCol + 1;

        if (plan
            && !this._columnsDirty
            && this._windowFirst === plan.prevFirstCol
            && currentLastCol === plan.prevLastCol
            && width === (plan.prevLastCol - plan.prevFirstCol + 1)
        ) {
            this.reconcileWindowSlide(firstCol, lastCol, plan);
            return true;
        }

        const cells  = this.getComponents() as Cell<any>[];
        const byName = new Map<string, { cell: Cell<any>, key: string }>();

        for (let s = 0; s < cells.length; s++) {
            const fieldName = this._fieldNames[s];

            if (fieldName !== undefined) {
                byName.set(fieldName, { cell: cells[s], key: this._cellKeys[s] });
            }
        }

        const slotCount  = lastCol - firstCol + 1;
        const assigned: (Cell<any> | undefined)[] = new Array(slotCount).fill(undefined);
        const retargeted = new Set<number>();

        // Pass 1 — keep a cell for its own field, if its key still matches.
        for (let col = firstCol; col <= lastCol; col++) {
            const field = this._visibleFields[col];
            const key   = this.cellKeyFor(field);
            const entry = byName.get(field.getName());

            if (entry && entry.key === key) {
                assigned[col - firstCol] = entry.cell;
                byName.delete(field.getName());
            }
        }

        // Remaining leftovers, grouped by key, so pass 2 can recycle one.
        const free = new Map<string, Cell<any>[]>();

        for (const entry of byName.values()) {
            const pool = free.get(entry.key);

            if (pool) {
                pool.push(entry.cell);
            } else {
                free.set(entry.key, [entry.cell]);
            }
        }

        // Pass 2 — recycle a leftover with the same key, else build.
        for (let col = firstCol; col <= lastCol; col++) {
            const slot = col - firstCol;

            if (assigned[slot] !== undefined) {
                continue;
            }

            const field = this._visibleFields[col];
            const key   = this.cellKeyFor(field);
            const pool  = free.get(key);
            let cell: Cell<any>;

            if (pool && pool.length > 0) {
                cell = pool.pop()!;

                this.setLayoutConstraints(cell, { data: field });
            } else {
                cell = this.resolveEnteringCell(field, key);
            }

            assigned[slot] = cell;
            retargeted.add(col);
        }

        // Pass 3 — per-column state that a shift can invalidate even for a
        // survivor: group tint always, and (for a retargeted cell, or every
        // cell once a field/config change makes columnsDirtyAtEntry true)
        // the ARIA column index and the bound value. A survivor's own index
        // cannot be stale outside those cases: it was matched by field name
        // in pass 1, and a field's index into `_visibleFields` cannot change
        // without `_columnsDirty` being set (`setColumnFields`/
        // `renderSeparator`), which is exactly what `columnsDirtyAtEntry`
        // captures here.
        for (let col = firstCol; col <= lastCol; col++) {
            const cell  = assigned[col - firstCol]!;
            const field = this._visibleFields[col];

            cell.setBaseBackground(this._columnConfigs.get(field.getName())?.groupColor ?? null);

            if (retargeted.has(col)) {
                this.bindCell(cell, this._data, field.getName());
            }

            if (retargeted.has(col) || columnsDirtyAtEntry) {
                cell.getAria().setColIndex(col + 1);
                this._lastRetargeted.push({ cell, fieldName: field.getName() });
            }
        }

        // Park whatever is still free in the cell cache for a later widen to
        // restore, keyed the same way `free` was. `retireCell` commits an
        // in-flight edit first so user keystrokes land on the record (mirrors
        // the blur-commits-edit contract); only a keyless slot is disposed.
        for (const [key, pool] of free) {
            for (const cell of pool) {
                this.retireCell(cell, key);
            }
        }

        // Re-order children to the new visible-column order.
        //
        // The order comes from `assigned`, which this reconciler just built in
        // slot order — not from re-sorting on `Field.getOrder()`. A model that
        // declares no `order` returns the -1 sentinel for every field, so an
        // order-based comparison ties throughout, the sort is a stable no-op,
        // and a recycled cell keeps whatever index it already held. That
        // desynchronises `getComponents()` from `_fieldNames`, which is built
        // in column order below and documented to stay index-aligned with it.
        const slotOf = new Map(assigned.map((cell, slot) => [cell, slot]));

        this.sortComponents((c1, c2) =>
            (slotOf.get(c1 as Cell<any>) ?? 0) - (slotOf.get(c2 as Cell<any>) ?? 0));

        this._windowFirst = firstCol;
        this._fieldNames  = [];
        this._cellKeys    = [];
        this._treeCell    = null;

        for (let col = firstCol; col <= lastCol; col++) {
            const field = this._visibleFields[col];
            const cell  = assigned[col - firstCol]!;

            this._fieldNames.push(field.getName());
            this._cellKeys.push(this.cellKeyFor(field));

            if (this._treeFieldName !== undefined && field.getName() === this._treeFieldName) {
                this._treeCell = cell;
            }
        }

        this._columnsDirty = false;

        return true;
    }

    /**
     * Resolves the cell for an entering column once no in-call free-pool
     * cell is available: restores a cached cell keyed for `field`, or builds
     * a fresh one when the cache holds none either. Shared by
     * {@link setColumnWindow}'s pass 2 (after its own free-pool tier finds
     * nothing) and {@link reconcileWindowSlide}, which has no free-pool tier
     * of its own — a same-call cache hit already covers a departing/entering
     * key match.
     *
     * @param field - The field the resolved cell will present.
     * @param key - `field`'s cell key — see {@link cellKeyFor}.
     * @returns The restored or newly-built cell, parented on this row via
     *   `addComponent`.
     */
    private resolveEnteringCell(field: Field, key: string): Cell<any> {
        const cached = this._cellCache.get(key);
        let cell: Cell<any>;

        if (cached && cached.length > 0) {
            cell = cached.pop()!;

            if (cached.length === 0) {
                this._cellCache.delete(key);
            }

            this.addComponent(cell, { data: field });
            cell.invalidateLayout();
        } else {
            cell = Row.createCellForField(field, this._columnConfigs);

            if (this._treeFieldName !== undefined && field.getName() === this._treeFieldName) {
                cell.wrapRenderer((delegate: CellRenderer<any>) => new TreeCellRenderer(delegate));
            }

            const builtCell = cell;
            cell.on("commit", (newValue) => this.commitCellValue(builtCell, newValue));

            this.addComponent(cell, { data: field });
        }

        return cell;
    }

    /**
     * Reconciles an ordinary same-width slide: retires the `|delta|`
     * departing cells into the cell cache, resolves the `|delta|` entering
     * columns (cache restore, else construct), and leaves every surviving
     * cell untouched. Only called when `setColumnWindow` has already
     * confirmed this row's own previous window matches `plan`.
     *
     * @param firstCol - The first visible-column index to render, inclusive.
     * @param lastCol - The last visible-column index to render, inclusive.
     * @param plan - This tick's slide plan; `plan.delta` drives which edge
     *   departs and which enters.
     */
    private reconcileWindowSlide(firstCol: number, lastCol: number, plan: ColumnWindowSlidePlan): void {
        const shift = plan.delta;
        const width = lastCol - firstCol + 1;
        const outCount = Math.abs(shift);

        // Snapshot first — retirement removes each cell, which splices the
        // live array `getComponents()` returns (mirrors `renderSeparator`).
        const cells = [...this.getComponents()] as Cell<any>[];

        // 1. Snapshot the survivors' field names / keys before any mutation.
        //    (shift > 0: outgoing = old slots [0, outCount); shift < 0: outgoing = old slots [width-outCount, width).)
        const survivorFieldNames = shift > 0 ? this._fieldNames.slice(outCount) : this._fieldNames.slice(0, width - outCount);
        const survivorKeys       = shift > 0 ? this._cellKeys.slice(outCount)   : this._cellKeys.slice(0, width - outCount);
        const survivorCells      = shift > 0 ? cells.slice(outCount)            : cells.slice(0, width - outCount);

        // 2. Retire the departing edge into the cell cache (always keyed — never disposed here).
        const outgoingSlots = shift > 0 ? Util.range(0, outCount - 1) : Util.range(width - outCount, width - 1);

        for (const slot of outgoingSlots) {
            this.retireCell(cells[slot], this._cellKeys[slot]);
        }

        // 3. Resolve the entering columns via the shared `resolveEnteringCell` helper.
        const enteringCols = shift > 0
            ? Util.range(lastCol - outCount + 1, lastCol)
            : Util.range(firstCol, firstCol + outCount - 1);

        const enteringCells: Cell<any>[] = [];
        const enteringFieldNames: string[] = [];
        const enteringKeys: string[] = [];

        for (const col of enteringCols) {
            const field = this._visibleFields[col];
            const key   = plan.enteringKeys.get(col) ?? this.cellKeyFor(field);
            const cell  = this.resolveEnteringCell(field, key);

            cell.getAria().setColIndex(col + 1);
            cell.setBaseBackground(this._columnConfigs.get(field.getName())?.groupColor ?? null);
            this.bindCell(cell, this._data, field.getName());

            enteringCells.push(cell);
            enteringFieldNames.push(field.getName());
            enteringKeys.push(key);
            this._lastRetargeted.push({ cell, fieldName: field.getName() });
        }

        // 4. Fix _components into correct slot order. A plain sortComponents over this row's
        //    (small) width is far cheaper than the full path's Map-heavy reconciliation, and
        //    reuses the exact mechanism the full path already relies on for the same purpose —
        //    see the Architecture Decisions' "why not literal rotation" reasoning.
        const slotOf = new Map<Cell<any>, number>();

        survivorCells.forEach((cell, i) => slotOf.set(cell, shift > 0 ? i : i + outCount));
        enteringCells.forEach((cell, i) => slotOf.set(cell, shift > 0 ? width - outCount + i : i));

        this.sortComponents((c1, c2) => (slotOf.get(c1 as Cell<any>) ?? 0) - (slotOf.get(c2 as Cell<any>) ?? 0));

        // 5. Rebuild the parallel bookkeeping arrays and _treeCell.
        this._fieldNames = shift > 0 ? [...survivorFieldNames, ...enteringFieldNames] : [...enteringFieldNames, ...survivorFieldNames];
        this._cellKeys   = shift > 0 ? [...survivorKeys, ...enteringKeys]             : [...enteringKeys, ...survivorKeys];
        this._windowFirst = firstCol;

        if (this._treeFieldName !== undefined) {
            const treeSlot = this._fieldNames.indexOf(this._treeFieldName);

            this._treeCell = treeSlot === -1 ? null : (this.getComponents()[treeSlot] as Cell<any>);
        }

        this._columnsDirty = false;
    }

    /**
     * Commits a cell's newly-entered value onto the row's bound record.
     * Wired once per cell, at construction, so a recycled cell resolves
     * its *current* field from the row's layout constraints at emit time
     * rather than closing over the field it was originally built for.
     *
     * @param cell - The cell that emitted `"commit"`.
     * @param value - The committed value.
     */
    private commitCellValue(cell: Cell<any>, value: unknown): void {
        const field = this.getLayoutConstraints(cell)?.data as Field | undefined;

        if (!field) {
            return;
        }

        if (this._data) {
            this._data.set(field.getName(), value);
            this._onCellCommit?.(this._data);
        }

        this.updateVisualState();
    }

    /**
     * Computes the cell-reuse key for `field`, per the precedence table in
     * the column-virtualization plan's Architecture Decisions: the tree
     * column and any column with a custom renderer, `cellType`, or `values`
     * config get a field-namespaced key (never shared); a `time`/`datetime`
     * column shares a key with every other column of the same type and
     * `showSeconds`; every other column shares a key with every other
     * column of the same field type.
     *
     * @param field - The field whose column key to compute.
     * @param config - The field's column config, if any.
     * @param isTreeColumn - Whether this field is the row's tree column.
     *
     * @returns The reuse key. Two columns with the same key may share a cell.
     *
     * @internal Package-internal — not re-exported from the `component/table`
     * barrel. Widened from `private` so `Body` can reuse the same precedence
     * logic when precomputing a slide plan's entering-column keys.
     */
    static cellKey(field: Field, config: ColumnConfig | undefined, isTreeColumn: boolean): string {
        if (isTreeColumn) {
            return `tree:${field.getName()}`;
        }

        if (config?.renderer) {
            return `renderer:${field.getName()}`;
        }

        if (config?.cellType) {
            return `dynamic:${field.getName()}`;
        }

        if (config?.values && config.values.length > 0) {
            return `combo:${field.getName()}`;
        }

        const type = field.getType();

        if (type === 'time' || type === 'datetime') {
            return `${type}:${config?.showSeconds ?? false}`;
        }

        return type;
    }

    /**
     * Resolves `field`'s config and tree-column status from this row's
     * current state and forwards to `cellKey`.
     */
    private cellKeyFor(field: Field): string {
        const isTreeColumn = this._treeFieldName !== undefined && field.getName() === this._treeFieldName;

        return Row.cellKey(field, this._columnConfigs.get(field.getName()), isTreeColumn);
    }

    /**
     * Routes a cell's value-set for one field: a {@link DynamicCell} resolves
     * its per-record variant via `bindRecord`, while every other cell keeps
     * the plain `setValue` path.
     *
     * @param cell - The cell to bind.
     * @param record - The record to bind, or undefined to clear the cell.
     * @param fieldName - The field this cell presents.
     */
    private bindCell(cell: Cell<any>, record: ModelRecord | undefined, fieldName: string): void {
        if (cell instanceof DynamicCell && record) {
            cell.bindRecord(record);
        } else {
            cell.setValue(record ? record.get(fieldName) : undefined);
        }
    }

    /**
     * Builds the typed `Cell` for `field`, applying any field-specific
     * options from `columnConfigs` (e.g. `showSeconds` on time cells).
     *
     * @param field - The field whose typed cell to construct.
     * @param columnConfigs - Per-field configs keyed by field name.
     *
     * @returns A new typed cell matching `field.getType()`.
     */
    private static createCellForField(field: Field, columnConfigs: Map<string, ColumnConfig>): Cell<any> {
        const config = columnConfigs.get(field.getName());

        // A custom renderer wins over both the combo (`values`) routing and the
        // field-type switch. The cell is built with no editor, so it stays
        // display-only — a click never enters edit mode (Cell.startEdit bails
        // with no editor and no pool key). The base Cell.setValue forwards each
        // rebind to the renderer.
        if (config?.renderer) {
            return new Cell("td", config.renderer());
        }

        if (config?.cellType) {
            return new DynamicCell(field.getName(), field.getType(), config);
        }

        const values = config?.values;

        if (values && values.length > 0) {
            return new ComboCell(field.getName(), values);
        }

        switch (field.getType()) {
            case "string":
                return new StringCell();
            case "number":
                return new NumberCell();
            case "boolean":
                return new BooleanCell();
            case "date":
                return new DateCell();
            case "time":
                return new TimeCell(columnConfigs.get(field.getName())?.showSeconds ?? false);
            case "datetime":
                return new DateTimeCell(columnConfigs.get(field.getName())?.showSeconds ?? false);
            case "glyph":
                return new GlyphCell();
            default:
                return new DefaultCell();
        }
    }

    /**
     * Retires `cell` out of the rendered set: commits an in-flight edit, detaches
     * it, and either files it in the cache under `key` or disposes it when the
     * slot carried no key.
     *
     * @param cell - The cell to retire.
     * @param key - The cell's reuse key, or `undefined` when the slot it
     *   occupied carried no recorded key.
     *
     * @remarks Clears `.focused` before caching (or disposing) — a retired
     * cell leaves `getComponents()` entirely (into `_cellCache`, or gone),
     * so `Body._updateFocusStyle`'s narrowed per-tick clear can neither
     * reach it via its own-cell fast path (its `getParentComponent()` is
     * already `null` after `removeComponent` below) nor via the full-sweep
     * fallback (which only walks `_rowPool`'s current `getComponents()`,
     * never `_cellCache`). Without this, a cell retired while it still
     * carried the keyboard-focus ring would carry the stale `.focused`
     * token into whichever column later restores it from the cache.
     */
    private retireCell(cell: Cell<any>, key: string | undefined): void {
        if (cell.isEditing()) {
            cell.commitEdit();
        }

        cell.setStyleState(".focused", false);

        this.removeComponent(cell);

        if (key === undefined) {
            cell.dispose();
            return;
        }

        const pool = this._cellCache.get(key);

        if (pool) {
            pool.push(cell);
        } else {
            this._cellCache.set(key, [cell]);
        }
    }

    /** Disposes every cached cell and empties the cache. */
    private disposeCellCache(): void {
        for (const pool of this._cellCache.values()) {
            for (const cell of pool) {
                cell.dispose();
            }
        }

        this._cellCache.clear();
    }

    /**
     * No-op; cell layout is driven by the Body's renderWindow.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        return this;
    }

    /**
     * Disposes this row's cell cache, then runs the inherited teardown.
     *
     * A cached cell is detached via `removeComponent` and filed in
     * `_cellCache`, never a registered child of this row, so the base
     * destructor's recursion over `_components` cannot reach it — mirroring
     * `Body.destructor()`'s explicit disposal of `_editorPool`.
     */
    protected destructor(): void {
        this.disposeCellCache();

        super.destructor();
    }
}

const RowCallable = callable(Row);
type RowCallable = Row;
export {
    Row         as _Row,
    RowCallable as Row
};
