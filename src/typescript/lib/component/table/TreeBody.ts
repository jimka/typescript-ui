// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { _Body } from "~/component/table/Body.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { Row } from "~/component/table/Row.js";
import { TreeCellRenderer } from "~/component/table/cell/renderer/TreeCell.js";
import { callable } from "~/core/Callable.js";

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
     * data index. Idempotent when state hasn't changed.
     *
     * @param row - The pool row being processed.
     * @param dataIndex - The row's index into `_flatRows`.
     */
    protected afterRowBound(row: Row, dataIndex: number, _wasRebound: boolean): void {
        const treeCell = row.getTreeCell();

        if (!treeCell) {
            return;
        }

        const renderer = treeCell.getRenderer() as TreeCellRenderer<any>;
        const flat     = this._flatRows[dataIndex];

        if (!flat) {
            return;
        }

        renderer.setTreeState(flat.depth, flat.hasChildren, flat.expanded);
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

            if (toggleEl && target !== null && (target === toggleEl || toggleEl.contains(target))) {
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
