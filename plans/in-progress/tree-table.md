---
depends-on: [table-parent-headers]
---

# TreeTable — Implementation Plan

## Overview

A `TreeTable` displays store-backed records in a table whose rows form a parent/child hierarchy. One designated column carries the indent + expand/collapse toggle; every other column behaves like a normal `Table` cell. The component lives at [src/typescript/lib/component/table/TreeTable.ts](../src/typescript/lib/component/table/TreeTable.ts) and reuses the existing [`Header`](../src/typescript/lib/component/table/Header.ts), [`Row`](../src/typescript/lib/component/table/Row.ts), typed cells in [src/typescript/lib/component/table/cell/](../src/typescript/lib/component/table/cell), and the virtual-scroll machinery owned by [`Body`](../src/typescript/lib/component/table/Body.ts) — only the body's row-flattening and the tree-column cell are new.

Parent/child structure is derived from a `parentField` declared on the existing model: every record names the id of its parent (or `null` for roots), exactly the convention typical store-bound trees use. No new store subtype is introduced.

The parent-column-header grouping work in [plans/table-parent-headers.md](./table-parent-headers.md) lands first; this plan layers a `TreeTable` on top of it but does **not** redesign that header model.

---

## Architecture Decisions

### New `TreeTable` component, not a Table mode flag

A new top-level class — `TreeTable extends Component` — composes `Header`, a tree-aware `TreeBody`, and `FooterRow`. Reasons:

- The existing [`Table.Body`](../src/typescript/lib/component/table/Body.ts:49) renders `_store.getRecords()` as a flat list, indexed by data position. Tree mode needs a flattened *visible-subtree* list (rebuilt on every expand/collapse), plus per-row depth/expansion bookkeeping. Branching that inside `Body.renderWindow()` would dump ~150 lines of conditional state onto a hot path that's already at the limit of `## Decompose large or complex functions` in [ARCHITECTURE.md](../ARCHITECTURE.md). A sibling `TreeBody` is cleaner.
- `Table`'s public API (`addRow`, `removeSelectedRow`, `sync`, `reject`, column visibility, column resize, sort cycling, exporter, context menu) is identical for the tree case. Re-housing it under `TreeTable` is one constructor and a thin set of forwarders — far less code than threading a `treeMode` flag through `Table`, `Header`, `Body`, `Row`, `Column`, `ColumnConfig` and every cell.
- The framework already follows this composition pattern for non-trivial variants — see [TablePanel](../src/typescript/lib/component/table/TablePanel.ts) and the planned `TableWithPinning` in [plans/table-column-pinning.md](./table-column-pinning.md).

Rejected alternative — *extend Table with a hierarchical mode flag*: every section component (`Body`, `Row`, `Header`, the cell renderers) would need to know whether they're operating on a flat or hierarchical view. The body in particular would inherit two flatten/render paths with overlapping caches. A new class costs less code and keeps the existing `Table` semantics intact.

### Hierarchy via `parentField` on the model — no `TreeStore`

The data layer carries the relationship as an ordinary field. Constructor accepts a `TreeTableSpec` extending `ColumnSpec` with `parentField` (name of the field holding the parent id) and `treeColumn` (name of the field whose cell carries the toggle/indent). On every `'load'`/`'add'`/`'remove'`/`'datachanged'` event from the store, `TreeBody` rebuilds an index keyed by primary key and re-flattens the visible subtree.

Rejected alternative — *new `TreeStore` / hierarchical `AbstractStore`*: the existing [`AbstractStore`](../src/typescript/lib/data/AbstractStore.ts:71) is already responsible for the master collection + filtered/sorted view + sync. Cloning that surface area to add `getChildren(parent)` would duplicate every CRUD/sync code path. The `parentField` convention requires zero changes to `AbstractStore`, `Store`, `Model`, or `ModelRecord`, and existing memory/Ajax stores work unchanged.

### Reuse `Row` per data record; new `TreeCellRenderer` per tree-column cell

`TreeBody` constructs `Row` instances exactly the way [`Body.growRowPool`](../src/typescript/lib/component/table/Body.ts:425) does today — typed cells per model field. The only change is that the cell on the `treeColumn` carries a special renderer (`TreeCellRenderer`) which draws `indent + toggle + delegate`, where `delegate` is the typed renderer that would have been used otherwise (`StringRenderer`, `NumberRenderer`, etc.). The delegate ships unchanged.

This keeps:
- editing on the tree column (double-click pops the same shared editor the type would use anywhere else);
- column resize / pinning / sort / context-menu / export semantics identical for the tree column;
- the rest of the table indistinguishable from `Table`.

We deliberately do **not** reuse `TreeRow`/`TreeNodeRenderer`: they're tied to the `Tree`'s `TreeNode` data shape (`label: string`, `children: TreeNode[]`), not to `ModelRecord`. Forcing them into a cell would mean either keeping a parallel `TreeNode` tree alongside the store (two sources of truth) or rewriting `TreeNodeRenderContext` to take a `ModelRecord`. The smaller, surgical move is a new `TreeCellRenderer` that mirrors the structural concerns of [`TreeRow.layoutChildren`](../src/typescript/lib/component/tree/TreeRow.ts:170) — indent math + toggle glyph swap — and delegates content to an existing `CellRenderer<T>`.

### Tree column is fixed by spec; one tree column per TreeTable

The tree column is identified at construction time (`treeColumn: "name"`) and is not user-reorderable. Multiple-tree-column layouts are not requested.

### Virtualisation reuses `VirtualScroller`; row pool stores depth+expanded per slot

`TreeBody` owns a `VirtualScroller` exactly like `Body`, but its `_boundIndices` map pool slot → index into a per-frame `_flatRows: FlatRecord[]` array instead of `store.getRecords()`. Each pool slot caches its currently rendered depth/expansion so a pure scroll (slot remapped to a new flat row at the same depth) skips the indent math when geometry hasn't changed — same shortcut [`Body.bindAndPositionRows`](../src/typescript/lib/component/table/Body.ts:484) already takes.

### No expand/collapse animation

Existing `Tree` toggles instantly; `TreeBody` does the same. Height-tweening rows across an O(N) flatten + rebind is expensive on large datasets, and the existing keyboard story (ARIA `aria-expanded` + immediate re-flatten) reads identically to `Tree`. Animation is a future plan if requested.

### Selection model = `Body`'s record selection, not `Tree`'s node selection

`TreeBody` reuses `Body`'s `_selectedRecords` / `_anchorRecord` model so `Ctrl+click`, `Shift+click`, `Ctrl+A`-style range selection, and the `getSelectedRecord()` / `getSelectedRecords()` API stay identical to `Table`. The keyboard map gains `ArrowRight`/`ArrowLeft` for expand/collapse and parent-jump, layered on top of the existing `ArrowUp`/`ArrowDown` row navigation.

---

## Public API (TypeScript Signatures)

### `TreeTableSpec` (new — extends `ColumnSpec`)

`src/typescript/lib/component/table/TreeTableSpec.ts`

```typescript
export interface TreeTableSpec extends ColumnSpec {
    /** Field whose value is each record's id (the primary key, normally). */
    idField:     string;

    /** Field whose value is each record's parent id, or `null` for root records. */
    parentField: string;

    /**
     * Name of the column whose cell carries the indent + expand/collapse
     * toggle. Must match a `field` in `columns` (or any model field when
     * `appendUnlisted !== false`).
     */
    treeColumn:  string;

    /** Pixels of indentation added per depth level. Defaults to 16. */
    indentPx?:   number;
}
```

### `TreeTable` (new)

`src/typescript/lib/component/table/TreeTable.ts`

```typescript
export interface TreeTableOptions extends ComponentOptions {}

class TreeTable extends Component<TreeTableOptions> {

    constructor(store: AbstractStore, spec: TreeTableSpec);

    getStore():    AbstractStore;
    setStore(store: AbstractStore): this;

    getHeader():   Header;
    getBody():     TreeBody;
    getFooter():   FooterRow;

    getColumns():  Column[];
    getColumnWidths(): number[];
    setColumnWidths(widths: number[]): this;
    setColumnVisible(fieldName: string, visible: boolean): this;

    /** Add a record; if `parent` is supplied, sets the parent-id field on it. */
    addRow(defaults?: Record<string, any>, parent?: ModelRecord): ModelRecord;
    removeSelectedRow(): this;

    sync(): Promise<void>;
    reject(): void;

    getSelectedRecord():  ModelRecord | null;
    getSelectedRecords(): ModelRecord[];

    /** Expand/collapse by record. No-op for leaves. */
    setExpanded(record: ModelRecord, expanded: boolean): this;
    isExpanded(record: ModelRecord): boolean;

    /** Expand every node up to and including `depth` (0 = roots only). */
    expandToDepth(depth: number): this;
    collapseAll(): this;
    expandAll(): this;
}
```

### `TreeBody` (new — replaces `Body` inside `TreeTable`)

`src/typescript/lib/component/table/TreeBody.ts`

Subclass of `Body`. Overrides the visible-row source and the keyboard map; everything else (selection, focus, editing, store binding, virtualisation, header link-up) is inherited.

```typescript
class TreeBody extends _Body {

    constructor(store: AbstractStore, treeSpec: {
        idField:     string;
        parentField: string;
        treeColumn:  string;
        indentPx:    number;
    });

    /** Flat list of currently-visible records (depth-aware). */
    getFlatRecords(): { record: ModelRecord, depth: number, hasChildren: boolean, expanded: boolean }[];

    setExpanded(record: ModelRecord, expanded: boolean): this;
    isExpanded(record: ModelRecord): boolean;
    expandToDepth(depth: number): this;
    collapseAll(): this;
    expandAll(): this;
}
```

### `TreeCellRenderer` (new)

`src/typescript/lib/component/table/cell/renderer/TreeCell.ts`

Wraps a typed `CellRenderer<T>` (the delegate) and prepends an indent spacer + expand/collapse toggle. The delegate stays under `CellRenderer<T>`'s API so existing typed renderers plug in unchanged.

```typescript
export class TreeCellRenderer<T> extends CellRenderer<T> {

    /**
     * @param delegate - The typed renderer that draws the cell value to the
     *   right of the toggle. Owned by this renderer; never shared.
     */
    constructor(delegate: CellRenderer<T>);

    getDelegate(): CellRenderer<T>;

    setValue(value: T): void;
    getValue(): T;

    /**
     * Called by `TreeBody.bindAndPositionRows` whenever the row's depth or
     * expansion state changes. Re-renders the toggle and re-runs `doLayout`
     * so the delegate slides to its new X.
     */
    setTreeState(depth: number, hasChildren: boolean, expanded: boolean): this;

    /** Bound by `TreeBody`; fires on toggle click. */
    setOnToggle(fn: (renderer: TreeCellRenderer<T>) => void): this;

    doLayout(): this;
}
```

### Helper: tree column hand-off from `Row` to `TreeBody`

`Row` already creates one typed cell per field via the switch on `field.getType()` (see [`Row` constructor](../src/typescript/lib/component/table/Row.ts:59)). `TreeBody` cannot rely on `Row` knowing which column is the tree column, so `Row` gains a single optional knob:

```typescript
// Row.ts — new constructor parameter (optional, appended)
constructor(
    model?:         AbstractModel,
    data?:          ModelRecord,
    hiddenColumns:  Set<string>                  = new Set(),
    columnConfigs:  Map<string, ColumnConfig>    = new Map(),
    onCellCommit?:  (record: ModelRecord) => void,
    treeFieldName?: string,                                  // NEW
): void;

/** Returns the tree cell, or null when Row was constructed without a treeFieldName. */
getTreeCell(): Cell<any> | null;
```

When `treeFieldName` is set, the matching cell is constructed with a `TreeCellRenderer` wrapping the typed renderer that field's type would normally have. All other cells are constructed exactly as today.

This is the only edit to `Row`. It costs one optional parameter, one private field, and one getter — well under the bar set by `## Surgical Changes`.

### `TreeTablePanel` (new — sibling of `TablePanel`)

`src/typescript/lib/component/table/TreeTablePanel.ts`

Composite panel: toolbar (`add` / `remove` / `sync` / `reject`) docked north, `TreeTable` in center. Mirrors [`TablePanel`](../src/typescript/lib/component/table/TablePanel.ts) exactly, with `Table` → `TreeTable`.

```typescript
class TreeTablePanel extends Panel {
    constructor(store: AbstractStore, spec: TreeTableSpec);
    getTreeTable(): TreeTable;
    getToolbar():   Component;
    setExportMenuEnabled(enabled: boolean): this;
    exportCSV(options?: ExportOptions):  void;
    exportJSON(options?: ExportOptions): void;
}
```

---

## Internal Structure

### `FlatRecord` — `TreeBody`'s row index

```typescript
interface FlatRecord {
    record:      ModelRecord;
    depth:       number;
    hasChildren: boolean;
    expanded:    boolean;
    siblingCount: number;   // for ARIA setSize
    posInSet:     number;   // for ARIA posInSet (1-based)
}
```

Rebuilt by `TreeBody._flatten()` (mirrors [`Tree._flatten`](../src/typescript/lib/component/tree/Tree.ts:214)) on every store event and on every `setExpanded` call. Two scratch maps live on `TreeBody`:

```typescript
private _byId:       Map<any, ModelRecord>      = new Map();   // idField → record
private _childIds:   Map<any, ModelRecord[]>    = new Map();   // parentId → child records (in store order)
private _expanded:   Set<any>                   = new Set();   // expanded record ids
private _flatRows:   FlatRecord[]               = [];
```

Stable identity for expansion uses the record id, **not** the `ModelRecord` reference, so a store sync that replaces records preserves expand state.

### `TreeCellRenderer` DOM tree

```
<span class="TreeCellRenderer">       (Component element, Fit-laid-out by CellRenderer base)
  <span class="TreeCellRenderer-toggle"></span>     ← Glyph child (only when hasChildren)
  <delegate root element>                            ← e.g. <span> from StringRenderer
</span>
```

Indent is implemented as the toggle's X (`depth * indentPx`) plus the delegate's X (`depth * indentPx + TOGGLE_WIDTH`). No left-padding hack on the parent — keeps `CellRenderer`'s `Insets`-based padding untouched.

### `TreeBody.bindAndPositionRows` — additions

After each row is rebound to `flatRecord.record`, `TreeBody` looks up the tree cell via `row.getTreeCell()`. If the slot's cached `(depth, hasChildren, expanded)` differs from the new flat record, it calls:

```typescript
const treeCell    = row.getTreeCell()!;
const treeRenderer = treeCell.getRenderer() as TreeCellRenderer<any>;

treeRenderer.setTreeState(flatRecord.depth, flatRecord.hasChildren, flatRecord.expanded);
```

`setTreeState` swaps in the new toggle glyph (or removes it for leaves), then sets a dirty flag that the next `doLayout` consumes to reposition the delegate. The slot-level cache means a pure vertical scroll (slot remaps to a new record at the same depth) skips the indent math and matches the existing `Body` scroll cost.

### Toggle click routing

`TreeCellRenderer` adds **one** click handler on the toggle element using `Event.addListener(this._toggle, "click", this.onToggleClick)`. The handler fires the `_onToggle` callback, which `TreeBody` wires once per pool grow:

```typescript
treeRenderer.setOnToggle(this.onTreeToggle);   // method reference, not arrow
```

`TreeBody.onTreeToggle(renderer)` resolves `renderer → Row → record` via the cell's slot and calls `this.setExpanded(record, !this.isExpanded(record))`. The click on the rest of the tree-cell area falls through to `Body`'s existing subtree-click listener, which handles selection — identical to a plain `Cell`.

---

## Keyboard, Selection, Virtualisation

| Concern | Behaviour |
|---|---|
| `ArrowUp` / `ArrowDown` | Inherited from `Body.onKeyDown`. Walks the *flattened* visible list. |
| `ArrowRight` | If the focused row is a branch and collapsed, expand. If already expanded, move focus to its first child. Else no-op. Matches [`Tree._onKeyDown`](../src/typescript/lib/component/tree/Tree.ts:386) ArrowRight branch. |
| `ArrowLeft` | If branch and expanded, collapse and stay. Else move to parent record. |
| `Home` / `End` | First / last visible flat record. |
| `Enter` / `Space` | Inherited — starts edit on the focused cell. |
| `PageUp` / `PageDown` | Inherited — page by row count. |
| Selection | Inherited `Body` `_selectedRecords` set + anchor; `Ctrl+click`, `Shift+click` range-select work over the flat visible list. |
| Virtualisation | `VirtualScroller` owns it; `TreeBody` substitutes `_flatRows` for `_store.getRecords()` in `renderWindow`. `clampToContent(totalContentWidth, _flatRows.length * rowHeight)` keeps the scrollbars accurate. |
| Animation | None. Re-flatten + re-render on toggle, same instant transition as `Tree`. |

ARIA: `TreeBody.bindAndPositionRows` adds `getAria().setLevel(depth + 1)`, `setExpanded(hasChildren ? expanded : null)`, `setSetSize`, `setPosInSet` on the `Row`'s aria — mirroring [`TreeRow.setRowData`](../src/typescript/lib/component/tree/TreeRow.ts:129). The grid role on `TreeTable` stays `treegrid` (not `grid`).

---

## Ordered Implementation Steps

1. **Add `parentField` plumbing.** Create `TreeTableSpec` in [src/typescript/lib/component/table/TreeTableSpec.ts](../src/typescript/lib/component/table/TreeTableSpec.ts). Re-export from the table barrel.
2. **Extend `Row`.** Add the optional `treeFieldName` parameter, a `_treeCell: Cell<any> | null` backing field, and `getTreeCell()`. Inside the cell-creation switch, when `field.getName() === treeFieldName`, wrap the typed renderer in `new TreeCellRenderer(typedRenderer)` and pass that to the `Cell` constructor. Verify with `grep -rn 'new Row(' src/` — every call site continues to compile because the parameter is optional.
3. **Implement `TreeCellRenderer`.** New file under `cell/renderer/`. Constructor takes the delegate; `setValue` / `getValue` forward to the delegate; `setTreeState` swaps the toggle glyph (mirror [`TreeRow.setRowData`](../src/typescript/lib/component/tree/TreeRow.ts:129) toggle swap); `setOnToggle` stores a callback that the toggle's click listener invokes; `doLayout` runs `super.doLayout()` (Fit on the cell-renderer base does its work) then positions the toggle at X=`depth*indentPx` and the delegate at X=`depth*indentPx+TOGGLE_WIDTH`, sizing the delegate to the remaining width. Glyph swap goes through `Glyph.setLineHeight(height)` and the renderer's own typed setters — no raw `element.style.*`.
4. **Implement `TreeBody`.** Extends `_Body` (the underscored, non-callable alias — `TreeBody` itself is the new callable). Override the private API points by either (a) adding `protected` hooks in `Body` that `TreeBody` overrides, or (b) overriding `renderWindow` outright. **Decision:** (a) — promote `Body.getVisibleRecords()`, `Body.computeRowAria()`, and the `growRowPool` `new Row(...)` site to protected helpers. This is a surgical change: only the new hooks become protected; method bodies move into them as-is. Document each hook with `@protected`.

   Then `TreeBody`:
   - Stores `idField`, `parentField`, `treeColumn`, `indentPx`, `_expanded`, `_flatRows`, `_byId`, `_childIds`.
   - Overrides `growRowPool` so the `new Row(...)` call passes `treeColumn` as `treeFieldName`.
   - Overrides `getVisibleRecords()` to return `_flatRows.map(f => f.record)`.
   - After `super.bindAndPositionRows(...)`, walks the pool again to call `setTreeState` on each tree cell whose flat index changed.
   - Adds `onTreeToggle`, `setExpanded`, `isExpanded`, `expandToDepth`, `collapseAll`, `expandAll`, `_flatten`, `_rebuildIndex`.
   - Subscribes to store `'load'`/`'add'`/`'remove'`/`'datachanged'` to call `_rebuildIndex` then `_flatten` (preserving `_expanded` ids).
   - Overrides `onKeyDown` to handle ArrowRight/ArrowLeft on top of the inherited cases.
5. **Implement `TreeTable`.** Mirrors `Table` constructor structure (header / body / footer plumbing, column resize forwarding, hidden-column tracking, context menu, export menu). Body is a `TreeBody` instead of `Body`. ARIA role on the root element is `treegrid` (set via `this.getAria().setRole("treegrid")`).
6. **Implement `TreeTablePanel`.** Direct clone of `TablePanel` with `Table` → `TreeTable`; constructor takes `(store, spec)` instead of `(store)` to forward the tree config.
7. **Export new public types.** Edit [src/typescript/lib/component/table/index.ts](../src/typescript/lib/component/table/index.ts):
   ```typescript
   export { TreeTable }      from '~/component/table/TreeTable.js';
   export { TreeTablePanel } from '~/component/table/TreeTablePanel.js';
   export { TreeBody }       from '~/component/table/TreeBody.js';
   export type { TreeTableSpec } from '~/component/table/TreeTableSpec.js';
   export { TreeCellRenderer }   from '~/component/table/cell/renderer/TreeCell.js';
   ```
8. **Demo.** Add a `TreeTable` panel to `MiscPanel.ts` showing a 3-level hierarchy backed by a `MemoryStore` with `id`/`parentId` fields. Use `expandToDepth(1)` on first load.
9. **Regression sweep.**
   - `grep -rn 'new Row(' src/typescript/lib/` — every existing call site still compiles (no signature break).
   - `grep -rn 'new Table(' src/typescript/` — no behavioural change to `Table`.
   - Verify the existing `Tree` demo and the new `TreeTable` demo render side-by-side without crosstalk (separate stores, separate components).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/table/TreeTableSpec.ts` |
| Create | `src/typescript/lib/component/table/TreeTable.ts` |
| Create | `src/typescript/lib/component/table/TreeBody.ts` |
| Create | `src/typescript/lib/component/table/TreeTablePanel.ts` |
| Create | `src/typescript/lib/component/table/cell/renderer/TreeCell.ts` |
| Modify | `src/typescript/lib/component/table/Row.ts` — add `treeFieldName` parameter + `getTreeCell()` |
| Modify | `src/typescript/lib/component/table/Body.ts` — promote `getVisibleRecords`, `computeRowAria`, and the `new Row(...)` site to `protected` hooks (no behavioural change) |
| Modify | `src/typescript/lib/component/table/index.ts` — export the five new symbols |
| Modify | `src/typescript/MiscPanel.ts` — add TreeTable demo |
| Modify | `docs/.vitepress/config.mts` — sidebar entry for `TreeTable` |
| Create | `docs/components/TreeTable.md` — curated component page |
| Create | `docs/components/TreeTablePanel.md` — curated component page |
| Modify | `docs/components/index.md` — list new components in the catalog |

---

## Theme Tokens

No new tokens. The toggle glyph and indent reuse the row colours / cell padding already exposed by `--ts-ui-table-cell-bg`, `--ts-ui-table-row-selected`, and the typed renderer's foreground colour. `TOGGLE_WIDTH` and the default `indentPx` (16) are documented inline constants mirroring [`Tree`](../src/typescript/lib/component/tree/Tree.ts:13).

---

## Verification

- `npm run typecheck` clean.
- Toggle a branch in the demo: row count grows; arrow keys walk children; collapse hides them; in-cell edit on a child commits and the dirty-row visual still applies.
- `Ctrl+click` and `Shift+click` select across the flat visible list correctly; collapsing a parent of a selected node does not throw (the selection set is by record, not by flat index).
- Column resize, column hide, sort cycling, CSV/JSON export — identical behaviour to `Table` for the non-tree columns.
- Theme toggle: row background, toggle glyph colour, indent metrics survive.
- `npm run docs:build` reports **0 errors and 0 link warnings**.

---

## Documentation Impact

- New curated pages `docs/components/TreeTable.md` and `docs/components/TreeTablePanel.md`. Cite the same example as the implementation demo. Cross-link to `Tree.md` and `Table.md` with the *cross-bucket markdown link* form from [_shared/docs-conventions.md](../.claude/skills/_shared/docs-conventions.md) (these all sit in the same `component/table` subpath, but `Tree.md` lives in `component/tree` — use the `[\`Tree\`](/api/component/tree/classes/Tree)` form for the latter).
- Sidebar additions in `docs/.vitepress/config.mts`.
- Component catalog `docs/components/index.md` gets a `TreeTable` row in the Tables section.
- `@category Components` on every exported type.
- `TreeTable` and `TreeTablePanel` are `callable()`-wrapped; the per-typedoc-callable-plugin auto-promotion handles the `variables/ → classes/` lift automatically.

---

## Potential Challenges

- **Sort interaction with hierarchy.** `AbstractStore.sort` reorders the master view, which would shuffle children away from parents. *Mitigation:* `TreeBody._flatten` always reads `_byId` and `_childIds` from store order *as it is at the moment of flatten*, so a sorted store flattens with children right under each parent at that point in the sort. Document this in the curated page; do not introduce a "freeze sort" mode.
- **Filters that remove a parent while keeping a child orphan that child in the flat list.** *Mitigation:* `_flatten` walks roots only (`parentField == null`), so a filtered-out parent silently drops its subtree. Document.
- **Row pool size when toggling near the top.** Expanding a deep tree can spike `_flatRows.length`. `Body.computePoolTarget` already grows to the viewport-max, so the pool grows once per height-change; expansion only triggers a rebind, not a regrow. No mitigation needed.
- **`Body` private → protected hook promotion** could leak implementation detail. *Mitigation:* JSDoc each promoted hook with `@protected` + `@remarks Subclassing seam for TreeBody; do not call from consumers.`
- **`Row.getComponents()` ordering** is the only way `TreeBody` finds the tree cell today. If a future change re-orders cells, `getTreeCell()` would still work because it's a direct reference, not an index. Confirm in the `Row` JSDoc.

---

## Critical Files

- [src/typescript/lib/component/table/Table.ts](../src/typescript/lib/component/table/Table.ts) — clone its constructor structure for `TreeTable`.
- [src/typescript/lib/component/table/Body.ts](../src/typescript/lib/component/table/Body.ts) — subclass via the protected hooks in step 4.
- [src/typescript/lib/component/table/Row.ts](../src/typescript/lib/component/table/Row.ts) — minimal extension for the tree cell.
- [src/typescript/lib/component/table/cell/Cell.ts](../src/typescript/lib/component/table/cell/Cell.ts) — `TreeCellRenderer` lives inside a `Cell`, so the Card-layout swap to editor still has to work.
- [src/typescript/lib/component/table/cell/renderer/CellRenderer.ts](../src/typescript/lib/component/table/cell/renderer/CellRenderer.ts) — base class for `TreeCellRenderer`.
- [src/typescript/lib/component/tree/Tree.ts](../src/typescript/lib/component/tree/Tree.ts) — `_flatten`, expand/collapse keyboard, ARIA semantics to mirror.
- [src/typescript/lib/component/tree/TreeRow.ts](../src/typescript/lib/component/tree/TreeRow.ts) — toggle-glyph swap pattern + indent math.
- [src/typescript/lib/component/container/VirtualScroller.ts](../src/typescript/lib/component/container/VirtualScroller.ts) — owned by `Body`; nothing new needed.
- [plans/table-parent-headers.md](./table-parent-headers.md) — header column-grouping model. `TreeTable` reuses whatever Header API lands there; this plan does not redesign it.
- [plans/table-column-pinning.md](./table-column-pinning.md) — prior composition-not-subclass precedent for table variants.

---

## Non-Goals

- **Pinned-column support for TreeTable.** The tree column's indent + toggle would have to coordinate across the pinned/scroll split; out of scope here.
- **Async lazy-load of children** (e.g. `loadChildren(record)` round-trip on expand). Synchronous tree only — every visible row's children must already be in the store. A future plan can layer this on by overriding `setExpanded` to await a fetch.
- **Drag-reorder of tree rows.** Reparenting via drag-and-drop is a separate plan; this implementation has no drag handles.
- **Animated expand/collapse.** Instant toggle only; matches existing `Tree` behaviour.
- **Per-level renderers.** One `TreeCellRenderer` definition for every depth, just as `Tree` uses one `TreeNodeRenderer` factory.
- **Multiple tree columns.** Exactly one column carries the toggle.
