// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { _Body } from "~/component/table/Body.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { DOM } from "~/core/DOM.js";
import { DragEventDetail, DragManager } from "~/core/DragManager.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { Row } from "~/component/table/Row.js";
import { TreeCellRenderer } from "~/component/table/cell/renderer/TreeCell.js";
import { callable } from "~/core/Callable.js";

/**
 * Drop-target outcome callback injected by
 * [`TreeTable`](/api/component/table/classes/TreeTable). Returns whether
 * the drop reparented the dragged record.
 *
 * @internal Framework wiring between `TreeTable` and `TreeBody`. Not
 *   part of the public API.
 */
type TreeBodyReparentHandler = (
    dragged: ModelRecord,
    newParent: ModelRecord | null,
) => boolean;

/**
 * Drop-target validity callback. Returns `true` when the dragged record
 * may legally land under `newParent`. Used by the per-row drop targets
 * to drive the green/red feedback tint before commit.
 *
 * @internal Framework wiring between `TreeTable` and `TreeBody`. Not
 *   part of the public API.
 */
type TreeBodyReparentValidator = (
    dragged: ModelRecord,
    newParent: ModelRecord | null,
) => boolean;

/**
 * A flattened entry in {@link TreeBody}'s visible-row list.
 *
 * @category Components
 */
export interface FlatRecord {
    /** The record at this row of the flattened, expansion-aware view. */
    record:       ModelRecord;
    /** Zero-based nesting depth (0 = root). */
    depth:        number;
    /** Whether this record has at least one child record in the store. */
    hasChildren:  boolean;
    /** Whether this record is currently expanded (false for leaves). */
    expanded:     boolean;
    /** Number of sibling records under the same parent — drives `aria-setsize`. */
    siblingCount: number;
    /** 1-based position among siblings — drives `aria-posinset`. */
    posInSet:     number;
}

/**
 * Construction-time configuration for a {@link TreeBody}. Mirrors the
 * subset of {@link TreeTableSpec} the body needs at run time.
 *
 * @category Components
 */
export interface TreeBodySpec {
    /** Field carrying each record's id. */
    idField:     string;
    /** Field carrying each record's parent id, or `null` for roots. */
    parentField: string;
    /** Field name of the column whose cell carries the indent + toggle. */
    treeColumn:  string;
    /** Pixels of indentation per depth level. */
    indentPx:    number;
}

/**
 * A virtual-scrolling body for a {@link TreeTable}. Subclass of
 * [`Body`](/api/component/table/classes/Body) — reuses the entire
 * row-pool / virtual-scroll / selection / focus / editing / context
 * menu / keyboard machinery, overriding only the visible-record source
 * and a handful of hooks the base class exposes for subclasses:
 *
 * - `Body.onStoreChange` — rebuilds the parent/child index and
 *   re-flattens the visible subtree before the inherited refresh runs.
 * - `Body.getVisibleRecords` — returns the depth-aware,
 *   expansion-aware flat-record list rather than the store view.
 * - `Body.createRow` — constructs each pool row with the tree
 *   column's field name so the matching cell carries a
 *   [`TreeCellRenderer`](/api/component/table/classes/TreeCellRenderer).
 * - `Body.computeRowAria` — additionally writes `aria-level`,
 *   `aria-expanded`, `aria-setsize`, `aria-posinset`.
 * - `Body.afterRowBound` — pushes depth + expansion state to the
 *   row's tree cell renderer on every render pass.
 * - `Body.onSubtreeClick` — dispatches toggle clicks to
 *   {@link setExpanded} before falling through to the inherited
 *   row-click selection handling.
 * - `Body.onKeyDown` — adds `ArrowRight` / `ArrowLeft` expand /
 *   collapse / parent-jump on top of the inherited row + column nav.
 *
 * Expand state is keyed by the record's id (the `idField` value), not
 * by `ModelRecord` reference — a store sync that replaces records
 * preserves expansion.
 *
 * Sort interaction: when the store is sorted, the parent/child index
 * walks the sorted records, so children sit right under each parent at
 * the moment of flatten. A parent dropped by a filter takes its subtree
 * out of the visible list.
 *
 * @category Components
 */
class TreeBody extends _Body {

    declare private _idField:     string;
    declare private _parentField: string;
    declare private _treeColumn:  string;
    declare private _indentPx:    number;

    private _byId:     Map<any, ModelRecord>   = new Map();
    private _childIds: Map<any, ModelRecord[]> = new Map();
    private _expanded: Set<any>                = new Set();
    private _flatRows: FlatRecord[]            = [];

    /**
     * Per-row drag-source + drop-target teardown bag. Keyed by the
     * pool `Row` (whose identity is stable across rebinds — the
     * underlying record changes, but the row component does not), so a
     * rebind tears down the previous closures around the previous
     * record before installing fresh ones.
     */
    private _rowDnDTeardowns: Map<Row, () => void> = new Map();

    /** Empty-area drop-target teardown — registered in {@link init}. */
    private _emptyAreaDropTeardown: (() => void) | null = null;

    /** Optional reparent commit injected by `TreeTable`. */
    private _reparentHandler: TreeBodyReparentHandler | null = null;

    /** Optional reparent validity check injected by `TreeTable`. */
    private _reparentValidator: TreeBodyReparentValidator | null = null;

    /**
     * Constructs a TreeBody bound to the given store, configured by the
     * tree spec.
     *
     * @param store - The data store. Records must carry `idField` and
     *   `parentField` values; roots have a null/undefined parent id.
     * @param spec - The tree configuration (id field, parent field,
     *   tree column, indent pixels).
     */
    constructor(store: AbstractStore, spec: TreeBodySpec) {
        super(store);

        this._idField     = spec.idField;
        this._parentField = spec.parentField;
        this._treeColumn  = spec.treeColumn;
        this._indentPx    = spec.indentPx;

        // The base constructor's `bindStore` has already wired
        // `onStoreChange`, but with `this._byId` / `_childIds` /
        // `_flatRows` still empty (the class-field initializers above
        // run *after* `super()`). Build the initial index now so the
        // first `renderWindow` reads a populated `_flatRows`.
        this.rebuildIndex();
        this.flatten();
    }

    /**
     * Returns the field name carrying each record's id.
     *
     * @returns The id field name.
     */
    getIdField(): string {
        return this._idField;
    }

    /**
     * Returns the field name carrying each record's parent id.
     *
     * @returns The parent-id field name.
     */
    getParentField(): string {
        return this._parentField;
    }

    /**
     * Returns the name of the column whose cell carries the indent +
     * expand/collapse toggle.
     *
     * @returns The tree-column field name.
     */
    getTreeColumn(): string {
        return this._treeColumn;
    }

    /**
     * Returns the flattened visible-row list snapshot. The list is
     * rebuilt on every store event and on every expand/collapse.
     *
     * @returns The current flat-record array (do not mutate).
     */
    getFlatRecords(): FlatRecord[] {
        return this._flatRows;
    }

    /**
     * Resolves a record by its id-field value. Reads the `_byId` map
     * maintained by `rebuildIndex`, so the lookup is O(1) and stays in
     * sync with the latest store snapshot.
     *
     * @param id - The id-field value to look up.
     *
     * @returns The matching record, or `undefined` when the id is not
     *   present in the current store view.
     */
    getRecordById(id: any): ModelRecord | undefined {
        return this._byId.get(id);
    }

    /**
     * Returns the records that name `id` as their parent-id. Reads the
     * `_childIds` map maintained by `rebuildIndex`; returns an empty
     * array (not the underlying list) when the id has no children, so
     * callers can iterate without an existence check.
     *
     * @param id - The parent-id field value to look up.
     *
     * @returns A snapshot of the child records (do not mutate).
     */
    getChildrenOf(id: any): ModelRecord[] {
        return this._childIds.get(id) ?? [];
    }

    /**
     * Returns whether the given record currently has at least one
     * child — i.e. behaves as a directory in the rendered tree.
     *
     * @param record - The record to test.
     *
     * @returns `true` when the record has children; `false` for leaves.
     */
    isDirectoryRecord(record: ModelRecord): boolean {
        return this.getChildrenOf(record.get(this._idField)).length > 0;
    }

    /**
     * Walks the parent chain from `descendant` upward and returns
     * `true` when `ancestor` is found at any depth. Used by
     * [`TreeTable.reparentRow`](/api/component/table/classes/TreeTable#reparentrow)
     * to reject drops that would create a cycle.
     *
     * @param ancestor - The candidate ancestor record.
     * @param descendant - The starting record. The walk follows
     *   `descendant.get(parentField)` recursively.
     *
     * @returns `true` when `ancestor === descendant` or `ancestor` is
     *   any transitive parent of `descendant`.
     */
    isAncestorOf(ancestor: ModelRecord, descendant: ModelRecord): boolean {
        if (ancestor === descendant) {
            return true;
        }

        const ancestorId = ancestor.get(this._idField);

        let current: ModelRecord | undefined = descendant;
        const seen = new Set<any>();

        while (current) {
            const parentId = current.get(this._parentField);

            if (parentId == null) {
                return false;
            }

            if (parentId === ancestorId) {
                return true;
            }

            // Defensive cycle guard — a corrupt parent chain must not
            // infinite-loop the validity check.
            if (seen.has(parentId)) {
                return false;
            }

            seen.add(parentId);
            current = this._byId.get(parentId);
        }

        return false;
    }

    /**
     * Returns whether the given record is currently expanded. A leaf
     * record (no children) reports `false` even if its id is in the
     * expansion set.
     *
     * @param record - The record to query.
     *
     * @returns `true` when the record is a branch and currently
     *   expanded, `false` otherwise.
     */
    isExpanded(record: ModelRecord): boolean {
        const id       = record.get(this._idField);
        const children = this._childIds.get(id);

        return !!children && children.length > 0 && this._expanded.has(id);
    }

    /**
     * Expands or collapses the given record. No-op for leaves and for
     * records not present in the current store view.
     *
     * @param record - The record to expand or collapse.
     * @param expanded - `true` to expand, `false` to collapse.
     *
     * @returns This body, for method chaining.
     */
    setExpanded(record: ModelRecord, expanded: boolean): this {
        const id       = record.get(this._idField);
        const children = this._childIds.get(id);

        if (!children || children.length === 0) {
            return this;
        }

        if (expanded) {
            if (this._expanded.has(id)) {
                return this;
            }

            this._expanded.add(id);
        } else {
            if (!this._expanded.has(id)) {
                return this;
            }

            this._expanded.delete(id);
        }

        this.flatten();
        this.invalidateRowBindings();
        this.renderWindow();

        return this;
    }

    /**
     * Expands every record at depth `<= depth`. Roots are at depth 0,
     * so `expandToDepth(0)` expands only the roots, `expandToDepth(1)`
     * expands roots and their children, and so on.
     *
     * @param depth - Maximum depth to expand.
     *
     * @returns This body, for method chaining.
     */
    expandToDepth(depth: number): this {
        this._expanded.clear();

        const recurse = (records: ModelRecord[], d: number): void => {
            if (d > depth) {
                return;
            }

            for (const record of records) {
                const id       = record.get(this._idField);
                const children = this._childIds.get(id);

                if (children && children.length > 0) {
                    this._expanded.add(id);
                    recurse(children, d + 1);
                }
            }
        };

        const roots = this._childIds.get(null) ?? [];
        recurse(roots, 0);

        this.flatten();
        this.invalidateRowBindings();
        this.renderWindow();

        return this;
    }

    /**
     * Collapses every record. Equivalent to clearing the expansion set
     * and refreshing the view.
     *
     * @returns This body, for method chaining.
     */
    collapseAll(): this {
        if (this._expanded.size === 0) {
            return this;
        }

        this._expanded.clear();

        this.flatten();
        this.invalidateRowBindings();
        this.renderWindow();

        return this;
    }

    /**
     * Expands every record that has children, regardless of depth.
     *
     * @returns This body, for method chaining.
     */
    expandAll(): this {
        const next = new Set<any>();

        for (const [parentId, children] of this._childIds) {
            if (parentId !== null && children.length > 0) {
                next.add(parentId);
            }
        }

        // Roots that have children also expand — they're keyed in
        // `_childIds` under `null` (their parent) but the expand set
        // is keyed by *the record's own id*.
        const roots = this._childIds.get(null) ?? [];
        for (const root of roots) {
            const id       = root.get(this._idField);
            const children = this._childIds.get(id);

            if (children && children.length > 0) {
                next.add(id);
            }
        }

        this._expanded = next;

        this.flatten();
        this.invalidateRowBindings();
        this.renderWindow();

        return this;
    }

    /**
     * Returns the toggle element of the row's `TreeCellRenderer`, or
     * `null` when the row has no tree cell or the tree cell renders a
     * leaf (no toggle).
     *
     * @param row - The pool row to inspect.
     *
     * @returns The toggle's DOM element, or `null`.
     */
    private getToggleElement(row: Row): HTMLElement | null {
        const treeCell = row.getTreeCell();

        if (!treeCell) {
            return null;
        }

        const renderer = treeCell.getRenderer();

        if (!(renderer instanceof TreeCellRenderer)) {
            return null;
        }

        const toggle = renderer.getToggle();

        return toggle ? toggle.getElement() : null;
    }

    /**
     * Initialises the tree body, then registers the empty-area drop
     * target so a row released over the body's whitespace reparents to
     * root. The element must exist before {@link DragManager.makeDropTarget}
     * can resolve its id — defer past the base class `init`.
     *
     * @param element - Optional element to initialise with.
     *
     * @returns This body, for method chaining.
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        this.ensureEmptyAreaDropTarget();

        return this;
    }

    /**
     * Rebuilds the parent/child index from the current store records,
     * then re-flattens the visible subtree. Invoked from
     * `Body.onStoreChange` before the inherited refresh runs.
     */
    protected onStoreChange(): void {
        this.rebuildIndex();
        this.flatten();

        super.onStoreChange();
    }

    /**
     * Returns the depth-aware visible-record list — the records the
     * row pool binds to.
     *
     * @returns The current flat-record list as plain `ModelRecord` array.
     */
    protected getVisibleRecords(): ModelRecord[] {
        return this._flatRows.map(f => f.record);
    }

    /**
     * Constructs a row carrying a {@link TreeCellRenderer} on the tree
     * column.
     *
     * @returns The new pool row.
     */
    protected createRow(): Row {
        return new Row(
            this.getStore().model,
            undefined,
            this.getHiddenColumns(),
            this.getColumnConfigs(),
            (record) => this.getStore().notifyRecordChanged(record),
            this._treeColumn,
        );
    }

    /**
     * Returns the tree column's field name so an in-place column-toggle
     * sync preserves the {@link TreeCellRenderer} on the tree-column
     * cell. Overrides the base, which returns `undefined`.
     *
     * @returns The tree column's field name.
     */
    protected getTreeFieldName(): string {
        return this._treeColumn;
    }

    /**
     * Writes the standard `aria-rowindex` from the base class, then
     * adds the tree-specific ARIA properties read from the flat record
     * at the same index.
     *
     * @param row - The pool row whose ARIA attributes to update.
     * @param dataIndex - The row's index into `_flatRows`.
     */
    protected computeRowAria(row: Row, dataIndex: number): void {
        super.computeRowAria(row, dataIndex);

        const flat = this._flatRows[dataIndex];

        if (!flat) {
            return;
        }

        row.getAria().setLevel(flat.depth + 1);
        row.getAria().setExpanded(flat.hasChildren ? flat.expanded : null);
        row.getAria().setSetSize(flat.siblingCount);
        row.getAria().setPosInSet(flat.posInSet);
    }

    /**
     * Pushes depth + expansion state to the row's
     * [`TreeCellRenderer`](/api/component/table/classes/TreeCellRenderer)
     * so the toggle glyph and indent match the flat record at this
     * data index, then re-wires the per-row drag source / drop target
     * for the bound record.
     *
     * @param row - The pool row being processed.
     * @param dataIndex - The row's index into `_flatRows`.
     * @param wasRebound - True when the row's record changed on this
     *   pass; the DnD closures captured the previous record and must be
     *   replaced.
     */
    protected afterRowBound(row: Row, dataIndex: number, wasRebound: boolean): void {
        const treeCell = row.getTreeCell();
        const flat     = this._flatRows[dataIndex];

        if (treeCell && flat) {
            const renderer = treeCell.getRenderer() as TreeCellRenderer<any>;

            renderer.setTreeState(flat.depth, flat.hasChildren, flat.expanded);
        }

        if (this._reparentHandler === null) {
            return;
        }

        if (!flat) {
            this.teardownRowDnD(row);

            return;
        }

        if (wasRebound || !this._rowDnDTeardowns.has(row)) {
            this.installRowDnD(row, flat.record);
        }
    }

    /**
     * Installs the manager-side {@link DragManager.makeDragSource} +
     * {@link DragManager.makeDropTarget} pair for a pool row, replacing
     * any previously installed pair.
     */
    private installRowDnD(row: Row, record: ModelRecord): void {
        this.teardownRowDnD(row);

        const tearDownSource = DragManager.makeDragSource(row, {
            dragData: { recordId: record.get(this._idField) },
        });

        const dropTargetForRow = (detail: DragEventDetail): ModelRecord | null => {
            const dragged = this.resolveDragged(detail);

            if (!dragged) {
                return null;
            }

            return this.resolveDropParentForRow(record);
        };

        const tearDownTarget = DragManager.makeDropTarget(row, {
            accepts: (detail: DragEventDetail) => {
                const dragged = this.resolveDragged(detail);

                if (!dragged) {
                    return false;
                }

                const newParent = dropTargetForRow(detail);

                return this._reparentValidator?.(dragged, newParent) ?? false;
            },
            onDrop: (detail: DragEventDetail): boolean | void => {
                const dragged = this.resolveDragged(detail);

                if (!dragged) {
                    return false;
                }

                const newParent = dropTargetForRow(detail);

                return this._reparentHandler?.(dragged, newParent) ?? false;
            },
        });

        this._rowDnDTeardowns.set(row, () => {
            tearDownSource();
            tearDownTarget();
        });
    }

    /**
     * Resolves the dragged record from the manager's detail payload
     * (which carries the record-id assigned in {@link installRowDnD}).
     * Returns `undefined` when the record is no longer in the store.
     */
    private resolveDragged(detail: DragEventDetail): ModelRecord | undefined {
        const id = detail.dragData["recordId"];

        return this._byId.get(id);
    }

    /**
     * Maps a hovered row's bound record to the directory it implies.
     * Directories accept drops directly; leaves forward to their
     * parent (so "drop on a sibling file" lands next to it under the
     * same directory).
     */
    private resolveDropParentForRow(record: ModelRecord): ModelRecord | null {
        if (this.isDirectoryRecord(record)) {
            return record;
        }

        const parentId = record.get(this._parentField);

        if (parentId == null) {
            return null;
        }

        return this._byId.get(parentId) ?? null;
    }

    /**
     * Tears down the drag-source + drop-target pair for a pool row.
     */
    private teardownRowDnD(row: Row): void {
        const teardown = this._rowDnDTeardowns.get(row);

        if (teardown) {
            teardown();
            this._rowDnDTeardowns.delete(row);
        }
    }

    /**
     * Wires the reparent callbacks supplied by `TreeTable`. Installed
     * once at construction so per-row DnD has everything it needs by
     * the time `afterRowBound` first runs.
     *
     * @param validator - Pre-drop validity check.
     * @param handler - Commits the reparent and returns whether it
     *   succeeded.
     *
     * @returns This body, for method chaining.
     *
     * @internal Framework wiring; application code does not call this.
     */
    setReparentHandlers(validator: TreeBodyReparentValidator, handler: TreeBodyReparentHandler): this {
        this._reparentValidator = validator;
        this._reparentHandler   = handler;

        if (this.getElement()) {
            this.ensureEmptyAreaDropTarget();
        }

        return this;
    }

    /**
     * Registers the body element itself as a drop target so a row
     * released over the empty area below the last row reparents to
     * root. Idempotent — safe to call after either
     * {@link setReparentHandlers} or `init`.
     */
    private ensureEmptyAreaDropTarget(): void {
        if (this._emptyAreaDropTeardown !== null) {
            return;
        }

        if (this._reparentHandler === null) {
            return;
        }

        this._emptyAreaDropTeardown = DragManager.makeDropTarget(this, {
            accepts: (detail: DragEventDetail) => {
                const dragged = this.resolveDragged(detail);

                if (!dragged) {
                    return false;
                }

                return this._reparentValidator?.(dragged, null) ?? false;
            },
            onDrop: (detail: DragEventDetail): boolean | void => {
                const dragged = this.resolveDragged(detail);

                if (!dragged) {
                    return false;
                }

                return this._reparentHandler?.(dragged, null) ?? false;
            },
        });
    }

    /**
     * Intercepts subtree clicks on a tree-toggle and routes them to
     * {@link setExpanded}. Other clicks fall through to the inherited
     * row-selection handler.
     *
     * @param e - The bubbled click event.
     */
    protected onSubtreeClick(e: MouseEvent): void {
        const target = e.target as Node | null;

        for (const row of this.getRowPool()) {
            const toggleEl = this.getToggleElement(row);

            if (toggleEl && target !== null && (target === toggleEl || DOM.source.contains(toggleEl, target))) {
                const record = row.getData();

                if (record) {
                    this.setExpanded(record, !this.isExpanded(record));
                }

                return;
            }
        }

        super.onSubtreeClick(e);
    }

    /**
     * Intercepts `ArrowRight` / `ArrowLeft` for tree navigation,
     * delegating every other key to the base `Body` handler. When
     * there is a selected anchor record:
     *
     * - `ArrowRight` expands a collapsed branch, or moves focus to the
     *   first child of an already-expanded branch (no-op on leaves).
     * - `ArrowLeft` collapses an expanded branch, or moves focus to the
     *   parent record (no-op at depth 0 with no children).
     *
     * Replaces the base body's `ArrowRight` / `ArrowLeft` column-focus
     * navigation while the user is interacting with the tree. Other
     * keys (`ArrowUp`/`Down`, `Home`/`End`, `Enter`/`Space`,
     * `PageUp`/`PageDown`) keep their inherited behaviour.
     *
     * @param e - The keyboard event fired on the body element.
     */
    protected onKeyDown(e: KeyboardEvent): void {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") {
            super.onKeyDown(e);

            return;
        }

        const anchor = this.getSelectedRecord();

        if (!anchor) {
            super.onKeyDown(e);

            return;
        }

        const idx = this._flatRows.findIndex(f => f.record === anchor);

        // Anchor exists but isn't in the flat view (e.g. a filter
        // dropped its subtree mid-key-press). Treat as no-op for tree
        // navigation rather than silently swallowing the keystroke.
        if (idx < 0) {
            e.preventDefault();

            return;
        }

        e.preventDefault();

        const flat = this._flatRows[idx];

        if (e.key === "ArrowRight") {
            this.handleArrowRight(flat, idx);
        } else {
            this.handleArrowLeft(flat, idx);
        }
    }

    /**
     * ArrowRight: expand a collapsed branch, or move focus into the
     * first child of an expanded branch. No-op on leaves.
     */
    private handleArrowRight(flat: FlatRecord, idx: number): void {
        if (!flat.hasChildren) {
            return;
        }

        if (!flat.expanded) {
            this.setExpanded(flat.record, true);

            return;
        }

        // Already expanded — move focus to the first child.
        const next = this._flatRows[idx + 1];

        if (next && next.depth === flat.depth + 1) {
            this.moveFocusTo(next.record);
        }
    }

    /**
     * ArrowLeft: collapse an expanded branch, or move focus to the
     * parent record. No-op when already at depth 0 and either leaf or
     * collapsed.
     */
    private handleArrowLeft(flat: FlatRecord, idx: number): void {
        if (flat.hasChildren && flat.expanded) {
            this.setExpanded(flat.record, false);

            return;
        }

        if (flat.depth === 0) {
            return;
        }

        // Walk backwards to find the parent record (the nearest
        // ancestor row with depth = current - 1).
        for (let i = idx - 1; i >= 0; i--) {
            if (this._flatRows[i].depth === flat.depth - 1) {
                this.moveFocusTo(this._flatRows[i].record);

                return;
            }
        }
    }

    /**
     * Programmatic equivalent of an arrow-key navigation: selects the
     * record, scrolls it into view, re-renders, and refreshes the
     * focus + active-descendant indicators. Mirrors the trailing
     * `selectRecord + scrollRecordIntoView + renderWindow +
     * _updateActiveDescendant + _updateFocusStyle` sequence the base
     * `Body.onKeyDown` runs after row-nav keys.
     */
    private moveFocusTo(record: ModelRecord): void {
        this.selectRecord(record);
        this.scrollRecordIntoView(record);
        this.renderWindow();
        this._updateActiveDescendant();
        this._updateFocusStyle();
    }

    /**
     * Rebuilds `_byId` and `_childIds` from the current store records.
     * Records with a parent id that doesn't resolve to any known record
     * are treated as roots (orphan fallback).
     */
    private rebuildIndex(): void {
        this._byId.clear();
        this._childIds.clear();

        const records = this.getStore().getRecords();

        for (const record of records) {
            const id = record.get(this._idField);

            this._byId.set(id, record);
        }

        // Roots sit under the `null` key in `_childIds`. Records whose
        // parent id doesn't resolve fall through to `null` too —
        // orphans render as additional roots rather than silently
        // disappearing.
        for (const record of records) {
            const parentId = record.get(this._parentField);
            const key      = parentId != null && this._byId.has(parentId) ? parentId : null;

            const list = this._childIds.get(key);

            if (list) {
                list.push(record);
            } else {
                this._childIds.set(key, [record]);
            }
        }
    }

    /**
     * Re-flattens the visible subtree from the current `_byId` /
     * `_childIds` index. The walk skips children whose parent id is
     * absent from the `_expanded` set.
     */
    private flatten(): void {
        const rows: FlatRecord[] = [];

        const recurse = (records: ModelRecord[], depth: number): void => {
            const siblingCount = records.length;

            for (let i = 0; i < records.length; i++) {
                const record   = records[i];
                const id       = record.get(this._idField);
                const children = this._childIds.get(id);
                const hasKids  = !!children && children.length > 0;
                const expanded = hasKids && this._expanded.has(id);

                rows.push({
                    record,
                    depth,
                    hasChildren:  hasKids,
                    expanded,
                    siblingCount,
                    posInSet:     i + 1,
                });

                if (expanded) {
                    recurse(children!, depth + 1);
                }
            }
        };

        const roots = this._childIds.get(null) ?? [];

        recurse(roots, 0);

        this._flatRows = rows;
    }
}

const TreeBodyCallable = callable(TreeBody);
type TreeBodyCallable = TreeBody;
export {
    TreeBody         as _TreeBody,
    TreeBodyCallable as TreeBody
};
