---
touches-shared: [src/typescript/lib/component/table/Column.ts, src/typescript/lib/component/table/ColumnConfig.ts, src/typescript/lib/component/table/index.ts]
---

# Table Column Pinning — Implementation Plan

## Overview

Column pinning freezes one or more leading columns at the left edge of the table, outside horizontal scrolling. The feature ships as a new top-level component `PinnedTable` (sibling to [`Table`](../src/typescript/lib/component/table/Table.ts) and [`TreeTable`](../src/typescript/lib/component/table/TreeTable.ts)) plus a dedicated `PinnedTableLayout`. Internally `PinnedTable` owns two child `Table` instances — a left pinned table and a right scroll table — sharing one [`AbstractStore`](../src/typescript/lib/data/AbstractStore.ts) and presenting one unified column context menu. Both child tables stay byte-compatible with today's `Table` (no `extends`, no surgery on shared code paths), and their virtual scrolling stays untouched.

The dual-`Table` decision replaces the older "PinnedPanel / ScrollPanel / ScrollOverlay" sketch. A custom Header / Body pair would duplicate hundreds of lines from [`Header`](../src/typescript/lib/component/table/Header.ts), [`Body`](../src/typescript/lib/component/table/Body.ts), `Row`, the cell-rendering switch, the column context menu, the resize handles, and the parent-header group band — each of which has gained features since the previous plan was drafted (parent headers, header glyphs, multi-sort, in-place column toggle, the row-pool / `VirtualScroller` split). Composing two existing `Table` instances reuses every one of those features without re-implementing them.

The flag is resolved at construction by [`Column.resolve`](../src/typescript/lib/component/table/Column.ts#L153) from a new `ColumnConfig.pinned?: boolean`, mirroring the shape of [`hidden`](../src/typescript/lib/component/table/ColumnConfig.ts#L20), `group`, and the in-flight `unhideable` / `readOnly` flags. A new accessor `Column.isPinned()` reads it. `PinnedTable` partitions its resolved column list into pinned and scroll subsets at construction and forwards each subset as a separate `ColumnSpec` to its child tables.

This plan is `Table`-only. `TreeTable` is not pinned by this work — see the `## Non-Goals` section for the reasoning.

---

## Architecture Decisions

### Compose two `Table` instances rather than two custom panels

The older draft introduced `PinnedPanel`, `ScrollPanel`, and a transparent `ScrollOverlay` — each a `Component` with its own `Header` + `Body` plus a hand-rolled scroll-mirroring overlay. Since that draft, `Table` has absorbed:

- The parent-header band ([`Header.rebuildParentCells`](../src/typescript/lib/component/table/Header.ts) — group runs, [`groupColor`](../src/typescript/lib/component/table/ColumnConfig.ts#L40) tints).
- Header glyphs ([`Column.getHeaderGlyph`](../src/typescript/lib/component/table/Column.ts#L84)).
- The horizontal-scroll mirror that ties `Body` to `Header` via [`setTranslate`](../src/typescript/lib/component/table/Table.ts#L162) (header outside `overflow:auto`, transform-driven).
- An export menu, sort-priority badges, the column context menu, the in-place column toggle, the `appendUnlisted: false` strict-spec mode.

Re-implementing each in a parallel panel is feasible but heavy and would silently drift. Composing two `Table` instances reuses all of it. The right child is a plain `Table` configured with the unpinned `ColumnConfig[]`. The left child is a plain `Table` configured with the pinned `ColumnConfig[]` plus `overflow: hidden` on its body (so horizontal scrolling lives only on the right). The two share a store; both render the same records over the same `_rowHeight`; their virtual scrollers ride one shared `scrollTop` value.

### `PinnedTable extends Component`, not `extends Table`

`Table`'s own constructor instantiates `Header` / `Body` / `Footer` against itself ([Table.ts:121-136](../src/typescript/lib/component/table/Table.ts#L121-L136)). A pinning subclass that owned two child `Table`s would still inherit those three children — three orphan components in the wrong parent. `PinnedTable` extends `Component`, owns two child `Table`s explicitly, and exposes a façade with `Table`-compatible methods (`getStore`, `getColumns`, `getSelectedRecord`, `setColumnVisible`, `exportCSV`, etc.) that forward to one or both children.

### `PinnedTableLayout` is a dedicated `LayoutManager` subclass

The pinning arithmetic (compute pinned table width from column widths, place left/right tables, optional separator) is its own concern. It mirrors [`layout/Table.ts`](../src/typescript/lib/layout/Table.ts#L38) in shape — a `LayoutManager` subclass whose `attach()` validates the container class name (`"PinnedTable"`) and whose `doLayout()` positions the two children. `PinnedTableLayout` does NOT compute column widths itself — each child `Table` keeps its own [`TableLayout`](../src/typescript/lib/layout/Table.ts) doing column-width arithmetic over its own column subset.

### Single vertical scrollbar — driven by the scroll-table body, mirrored to the pinned-table body via `setScrollY`

`Body` already exposes [`setScrollY(y)`](../src/typescript/lib/component/table/Body.ts#L433) routed through [`VirtualScroller`](../src/typescript/lib/component/container/VirtualScroller.ts). The right (scroll) `Table`'s `Body` is the source of truth: its element has `overflow-y: auto` (today's default — `setOverflow("hidden")` is overridden by the inner virtual scroller's element styles), so the user scrolls it directly. `PinnedTable` listens for `scroll` events on the right body via a `setOnVerticalScroll` callback registered on the right body, and mirrors the new `scrollTop` into the left body with `setScrollY`. The left body has its horizontal overflow suppressed (`setOverflowX("hidden")`) and its vertical overflow suppressed as well so it does not present its own scrollbar — vertical motion arrives only through `setScrollY`.

Rejected: the old plan's transparent `ScrollOverlay` covering the full body area with a phantom-height div. That overlay would have to be sized exactly to `totalRows * rowHeight` (already known only by the underlying `Body` / `VirtualScroller`), re-installed across each pool growth, and would intercept mouse events from the cells beneath it — every click would need `pointer-events: none` plus per-event manual re-dispatch. Mirroring through `setScrollY` keeps native scrolling on the right body where it already works.

### Horizontal scrolling stays on the right table only

The pinned-table body sits in a fixed-width column slot (its width is exactly the sum of its column widths). It cannot scroll horizontally — its content fits its frame by construction. The scroll table behaves identically to today's `Table`: its body owns horizontal scrolling, and its header mirrors `scrollLeft` through the existing [`setTranslate`](../src/typescript/lib/component/table/Table.ts#L155-L163) listener. No change to that mechanism.

### Selection is synchronised by sharing the store, not by routing callbacks between bodies

Selection lives in `Body._selectedRecords` ([Body.ts:65](../src/typescript/lib/component/table/Body.ts#L65)) — a `Set<ModelRecord>` keyed by record identity. The two child tables' bodies hold two independent `Set` instances. The old plan proposed a `setOnSelectionChange` callback that copies records from one set to the other after every click.

A cleaner approach: `PinnedTable` adds a single subtree click listener at its own level that resolves the clicked row's record and calls `selectRecord` on **both** child bodies. Range-select and ctrl/cmd-toggle stay on the right body (the originating click goes through its native `onRowClick`); the left body receives a passive "select this record" via a new `Body.setSelectedRecords(records: ModelRecord[])` setter. The setter mirrors the new state without firing any callback (it does not exist), avoiding the bidirectional-callback infinite-loop concern from the previous draft entirely.

`Body.setSelectedRecords` is also useful in isolation — it's the missing public counterpart to [`selectRecord`](../src/typescript/lib/component/table/Body.ts#L817) (which only accepts one record / null) that any consumer needing programmatic multi-select would otherwise hand-roll by clearing `_selectedRecords` via DOM events.

### Column resize, sort, and context menu are owned by `PinnedTable` at the seam

The column context menu lists every column in a single ordered run (pinned columns first, then scroll columns). The menu UI is composed by `PinnedTable` and shown via its own [`Menu`](../src/typescript/lib/core/Menu.ts) instance — neither child table's `showColumnMenu` runs directly. Both child tables' headers route their `onColumnContextMenu` callback up to `PinnedTable.showColumnMenu(x, y)`, which builds the unified menu.

Toggling a column visible/hidden through the menu calls `PinnedTable.setColumnVisible(fieldName, visible)`. That method:

1. Looks up which side currently owns the column (pinned or scroll) by consulting `Column.isPinned()`.
2. Forwards the toggle to that child table.
3. Calls `this.doLayout()` so the layout manager re-runs the side-by-side placement (the affected child's column widths may have shifted, changing the pinned-table width allotment).

Column-resize callbacks already fire per-table — each child table's `Header.setOnColumnResize` is wired by its own `Table` constructor ([Table.ts:122](../src/typescript/lib/component/table/Table.ts#L122)). No change is needed there: each table handles resizes within its own column subset, and the layout manager re-runs after a resize to reconcile the pinned-table width with the scroll-table width.

Sorting is store-level — clicking a sort header on either side mutates the same shared store and both bodies re-render through the existing `'datachanged'` listener. No special wiring.

### Pinning state is fixed at construction, no runtime re-pin

A `ColumnConfig.pinned` flag baked into the spec is enough. A runtime "drag this header from the scroll side to the pinned side" affordance is a separate UX feature, requires a header-drag pipeline that does not exist today, and would compete with `feature/drag-and-drop` (see [plans/drag-and-drop.md](./drag-and-drop.md)). Listed under `## Non-Goals`.

### No `PinSeparator` in v1

The old plan included a 4 px draggable `PinSeparator` between the two tables that let the user redistribute width. Dropped because:

- It overlaps the column-resize-handle UX on the rightmost pinned column. Two ways to widen the same column.
- The pinned-table width is naturally the sum of its (independently resizable) column widths — adjusting any pinned column's width via its existing resize handle already widens the pinned region.
- Adding a separator means tracking a manual `pinnedPanelWidth` override that competes with column-width sums.

A solid 1 px vertical border between the two tables remains (driven by a CSS theme token — see `## Theme Tokens`). It's a visual divider, not interactive.

### Cross-reference: other in-flight Table plans

This plan adds one `ColumnConfig` field (`pinned`). The other in-flight Table plans add their own fields independently:

- [plans/table-readonly-columns.md](./table-readonly-columns.md) adds `readOnly`.
- [plans/table-readonly-rows-and-cells.md](./table-readonly-rows-and-cells.md) adds `cellReadOnly` + `ColumnSpec.rowReadOnly`.
- [plans/table-unhideable-columns.md](./table-unhideable-columns.md) adds `unhideable`.
- [plans/table-incremental-column-toggle.md](./table-incremental-column-toggle.md) rewrites `Body.setHiddenColumns` + `Header.rebuildCells` in place.

All five plans touch `ColumnConfig.ts` and (transitively) `Column.ts`. They do not collide on the same lines — each adds a new field and a new accessor — but mechanical merge order matters; whichever lands last rebases its accessor onto the others. Captured via `touches-shared` frontmatter so `/implement` orders them after their predecessors.

Pinning does not depend on the incremental-toggle plan but composes with it: hiding a pinned column will rely on whichever path `Body.setHiddenColumns` takes at the time. If incremental-toggle lands first, hiding a pinned column re-uses the row pool; otherwise the pool rebuilds. Either is correct.

---

## Public API (TypeScript Signatures)

### `ColumnConfig` extension

```typescript
export interface ColumnConfig {
    field        : string;
    minWidth    ?: number;
    maxWidth    ?: number;
    hidden      ?: boolean;
    showSeconds ?: boolean;
    headerGlyph ?: string;
    group       ?: string;
    groupColor  ?: string;
    /**
     * When `true` the column is frozen at the left edge of a {@link PinnedTable},
     * outside horizontal scrolling. Ignored by plain {@link Table} (the column
     * renders normally). Pinned columns retain `hidden` / `minWidth` / `maxWidth`
     * semantics; resize, sort, parent-header group, and group tint apply unchanged.
     */
    pinned      ?: boolean;
}
```

### `Column` extension

```typescript
export class Column {
    // existing fields and methods unchanged

    /**
     * Returns whether this column was declared pinned in the spec.
     * Consulted by {@link PinnedTable} when partitioning columns into
     * pinned and scroll subsets.
     *
     * @returns `true` when the spec declared `pinned: true`.
     */
    isPinned(): boolean;
}
```

### `Body` additions

```typescript
class Body extends Component {
    // existing fields and methods unchanged

    /**
     * Replaces the selected-record set with exactly the given records.
     * Mirrors {@link selectRecord} but accepts a multi-record list.
     * Fires no selection callback (there isn't one); the next
     * renderWindow re-applies row visual state. Used by
     * {@link PinnedTable} to mirror the right body's selection into
     * the left body without re-running click semantics.
     *
     * @param records - The records that should appear selected.
     */
    setSelectedRecords(records: ModelRecord[]): void;

    /**
     * Registers a callback fired after the underlying body element
     * scrolls vertically. Used by {@link PinnedTable} to mirror
     * `scrollTop` from the scroll-side body into the pinned-side body.
     * Single callback; calling again replaces the previous registration.
     *
     * @param fn - Receives the new scrollTop in pixels.
     */
    setOnVerticalScroll(fn: ((scrollTop: number) => void) | null): void;
}
```

`Body.setOnVerticalScroll` registers via `Event.addListener(this, "scroll", ...)` on first invocation, satisfying the [framework rule](../ARCHITECTURE.md) that a component owns its own event surface — `PinnedTable` does not reach into the body's element.

### `PinnedTable` (new file)

```typescript
class PinnedTable extends Component {
    /**
     * Constructs a pinned table bound to the given store. Columns whose
     * `ColumnConfig.pinned` flag is `true` form the left frozen band;
     * the remainder fill the horizontally scrollable region to the right.
     */
    constructor(store: AbstractStore, spec?: ColumnSpec);

    getStore(): AbstractStore;
    setStore(store: AbstractStore): this;

    /** The left child table containing pinned columns. */
    getPinnedTable(): Table;
    /** The right child table containing scrollable columns. */
    getScrollTable(): Table;

    /** Concatenated visible columns: pinned first, then scroll. */
    getColumns(): Column[];
    /** Concatenated column widths in the same order as {@link getColumns}. */
    getColumnWidths(): number[];

    setColumnVisible(fieldName: string, visible: boolean): this;
    resetColumns(): this;

    getSelectedRecord(): ModelRecord | null;
    getSelectedRecords(): ModelRecord[];
    selectRecord(record: ModelRecord | null): void;

    addRow(defaults?: Record<string, any>): ModelRecord;
    removeSelectedRow(): this;

    setExportMenuEnabled(enabled: boolean): this;
    exportCSV(options?: ExportOptions): void;
    exportJSON(options?: ExportOptions): void;
}
```

The shape mirrors [`Table`](../src/typescript/lib/component/table/Table.ts)'s public surface so `PinnedTable` is a drop-in replacement at the call site. When no pinned column is declared, `getPinnedTable()` still exists but its layout-allotted width is zero — `PinnedTable` degenerates to a plain `Table` visually.

### `PinnedTableLayout` (new file, `src/typescript/lib/layout/PinnedTable.ts`)

```typescript
export interface PinnedTableLayoutOptions extends LayoutManagerOptions {}

class PinnedTableLayout extends LayoutManager {
    constructor(options?: PinnedTableLayoutOptions);

    /**
     * Throws unless the container's class name is `"PinnedTable"`.
     */
    attach(container: Component): this;

    /**
     * Places the pinned child table at the left, sized to the sum of its
     * column widths (clamped to the container width minus a minimum
     * scroll-side allotment). The scroll child table fills the remainder.
     */
    doLayout(): void;
}
```

`attach()` mirrors [`layout/Table.attach`](../src/typescript/lib/layout/Table.ts#L64) in shape — class-name string match, not `instanceof`.

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-table-pinned-divider` | `var(--ts-ui-border-color, rgb(204, 204, 204))` | `var(--ts-ui-border-color, rgb(80, 80, 80))` | 1 px vertical border between the pinned and scroll tables. Defaults to the existing table border-color token so pinning visually matches the rest of the table edge. |

Add the variable to `Theme.ts`'s `Theme`, `DefaultTheme`, `DarkTheme`, and `themeToVars` blocks. The pinned-table component reads it via `setBorder({ right: { style: SOLID, width: 1, color: 'var(--ts-ui-table-pinned-divider, …)' } })` on its left (pinned) child table — no theme listener needed since CSS variables are theme-swap-responsive.

---

## Internal Structure

### Component tree

```
PinnedTable                    (Component, layout: PinnedTableLayout)
├── pinnedTable                (Table, columns: spec where pinned=true)
│   ├── Header
│   ├── Body                   (overflow-x: hidden, overflow-y: hidden)
│   └── Footer
└── scrollTable                (Table, columns: spec where pinned≠true)
    ├── Header
    ├── Body                   (overflow-x: auto, overflow-y: auto — today's default)
    └── Footer
```

### Spec partition at construction

```typescript
// Inside PinnedTable's constructor, after resolving the full column list:
const allColumns      = Column.resolve(store.model.getFields(), spec);
const pinnedFields    = new Set(allColumns.filter(c => c.isPinned()).map(c => c.getField().getName()));

const pinnedSpec: ColumnSpec = spec
    ? {
          columns:        spec.columns.filter(c => pinnedFields.has(c.field)),
          appendUnlisted: false,
      }
    : { columns: [], appendUnlisted: false };

const scrollSpec: ColumnSpec = spec
    ? {
          columns:        spec.columns.filter(c => !pinnedFields.has(c.field)),
          appendUnlisted: spec.appendUnlisted ?? true,
      }
    : { columns: [], appendUnlisted: true };
```

`pinnedSpec` is always strict (`appendUnlisted: false`) — only explicitly-listed pinned columns belong on the pinned side. `scrollSpec` inherits the consumer's `appendUnlisted` choice, defaulting to `true` so unlisted model fields land on the scroll side (today's behaviour).

### Selection mirroring

```typescript
// Inside PinnedTable's constructor:
this._scrollTable.getBody().setOnVerticalScroll(top => {
    this._pinnedTable.getBody().setScrollY(top);
});

// After every row click on either side, both bodies converge on the
// scroll body's authoritative selection set:
const mirror = () => {
    const records = this._scrollTable.getBody().getSelectedRecords();
    this._pinnedTable.getBody().setSelectedRecords(records);
};

Event.addSubtreeListener(this._scrollTable, "click", mirror);
Event.addSubtreeListener(this._pinnedTable, "click", () => {
    // A click on the pinned side: the pinned body has just mutated its own
    // _selectedRecords via onRowClick. Forward that to the scroll body.
    const records = this._pinnedTable.getBody().getSelectedRecords();
    this._scrollTable.getBody().setSelectedRecords(records);
});
```

(The arrow functions in the snippet violate the [named-listener rule](../ARCHITECTURE.md#listeners-must-reference-a-named-function); the real implementation declares them as private methods — `mirrorScrollSelection`, `mirrorPinnedSelection`, `mirrorVerticalScroll`. Snippet shortened for clarity.)

`Event.addSubtreeListener` is mandatory here per project guidance: a regular `addListener` matches only the exact target ID. The selection-mirror listeners must catch row clicks anywhere in the child tables' subtrees.

### PinnedTableLayout.doLayout shape

```typescript
doLayout(): void {
    const container     = this.getContainer() as PinnedTable;
    const containerSize = container.getInnerSize();

    if (!containerSize) {
        return;
    }

    const pinned       = container.getPinnedTable();
    const scroll       = container.getScrollTable();
    const insets       = container.getInsets();
    const pinnedWidths = pinned.getColumnWidths();
    const pinnedWidth  = pinnedWidths.reduce((s, w) => s + w, 0);
    // When pinned has no visible columns the left band collapses entirely
    // — the scroll table fills the full width and no divider is drawn.
    const scrollWidth  = Math.max(0, containerSize.width - pinnedWidth);

    pinned.setAutoCommitStyle(false);
    pinned.setX(insets.getLeft());
    pinned.setY(insets.getTop());
    pinned.setWidth(pinnedWidth);
    pinned.setHeight(containerSize.height);
    pinned.setAutoCommitStyle(true);

    scroll.setAutoCommitStyle(false);
    scroll.setX(insets.getLeft() + pinnedWidth);
    scroll.setY(insets.getTop());
    scroll.setWidth(scrollWidth);
    scroll.setHeight(containerSize.height);
    scroll.setAutoCommitStyle(true);
}
```

Each child table's own `TableLayout` then runs on its own `doLayout` pass, sizing its header / body / footer within the allotted slot. No column-width arithmetic lives in `PinnedTableLayout` — it just hands each child its rectangle.

---

## Ordered Implementation Steps

### Step 1 — Extend `ColumnConfig` and `Column`

- Add `pinned?: boolean` to [ColumnConfig.ts:45](../src/typescript/lib/component/table/ColumnConfig.ts#L45) with JSDoc cross-referencing `PinnedTable`.
- Add `private _pinned: boolean` to [Column.ts:17](../src/typescript/lib/component/table/Column.ts#L17), initialised in the constructor from `config?.pinned ?? false`.
- Add `isPinned(): boolean` accessor matching the shape of [`isInitiallyHidden`](../src/typescript/lib/component/table/Column.ts#L75).
- `npm run typecheck` — expect zero errors.

### Step 2 — Add `Body.setSelectedRecords` and `Body.setOnVerticalScroll`

- Add `setSelectedRecords(records: ModelRecord[])` on [Body.ts:817](../src/typescript/lib/component/table/Body.ts#L817), modelled on `selectRecord`: clear `_selectedRecords`, set `_anchorRecord` to the first record (or `null`), populate the set, walk `_boundIndices` to update visual state.
- Add `setOnVerticalScroll(fn)` storing the callback. On first registration, call `Event.addListener(this, "scroll", this._onScroll)` (a private method that reads `this.getElement()!.scrollTop` and invokes the stored callback). Re-registration replaces the callback without re-adding the DOM listener.
- `npm run typecheck`.

### Step 3 — Add the `--ts-ui-table-pinned-divider` theme token

- Add the variable to each of the four Theme blocks in [`Theme.ts`](../src/typescript/lib/core/Theme.ts) — `Theme`, `DefaultTheme`, `DarkTheme`, `themeToVars`. The default value references `var(--ts-ui-border-color, …)` so the divider follows the existing border-color token.
- `npm run typecheck`.

### Step 4 — Create `PinnedTableLayout`

- New file `src/typescript/lib/layout/PinnedTable.ts`.
- `attach()` mirrors [`layout/Table.attach`](../src/typescript/lib/layout/Table.ts#L64): allow only containers whose class name is `"PinnedTable"`. Throw otherwise.
- `doLayout()` per the snippet above.
- Export as `PinnedTableLayoutCallable` per the project's `callable()` pattern.
- `npm run typecheck`.

### Step 5 — Create `PinnedTable`

- New file `src/typescript/lib/component/table/PinnedTable.ts`.
- Extend `Component`, install `PinnedTableLayout` via [`setLayoutManager`](../src/typescript/lib/core/Component.ts#L3267).
- Constructor:
  - Resolve full `Column[]` via `Column.resolve(store.model.getFields(), spec)` once.
  - Partition into pinned / scroll specs per `## Internal Structure`.
  - Construct `this._pinnedTable = new Table(store, pinnedSpec)` and `this._scrollTable = new Table(store, scrollSpec)`.
  - Set `this._pinnedTable.getBody().setOverflowX("hidden")` and `setOverflowY("hidden")` so vertical motion arrives only through `setScrollY`.
  - Apply the right-border to the pinned table via [`setBorder`](../src/typescript/lib/core/Component.ts) referencing `var(--ts-ui-table-pinned-divider, …)`.
  - Wire `setOnVerticalScroll` on the scroll body → `setScrollY` on the pinned body.
  - Wire `Event.addSubtreeListener` on each child table to mirror selection in both directions (named methods, per `## Internal Structure`).
  - Wire each child header's `setOnColumnContextMenu` to `this.showColumnMenu(x, y)` (intercept both children's menus and present a single unified menu).
  - `addComponent(this._pinnedTable)` and `addComponent(this._scrollTable)`.
- Implement façade methods (`getStore`, `setColumnVisible`, `getSelectedRecord`, etc.) per `## Public API`.
- Export via the standard `callable()` pattern.
- `npm run typecheck`.

### Step 6 — Unify the column context menu

- `PinnedTable.showColumnMenu(x, y)` walks the concatenated column list (pinned, then scroll), reading from both child tables' resolved columns, and shows a single [`Menu`](../src/typescript/lib/core/Menu.ts) with one entry per column. Mirror the format from [`Table.showColumnMenu`](../src/typescript/lib/component/table/Table.ts#L590) — including the parent-group section headers and the `Reset columns` entry.
- Clicking an entry calls `PinnedTable.setColumnVisible(fieldName, !visible)`, which forwards to whichever child table owns the column.

### Step 7 — Wire the package barrel

Add to [`src/typescript/lib/component/table/index.ts`](../src/typescript/lib/component/table/index.ts):

```typescript
export { PinnedTable } from '~/component/table/PinnedTable.js';
```

Add to `src/typescript/lib/layout/index.ts` (read first to confirm the existing export shape):

```typescript
export { PinnedTable as PinnedTableLayout } from '~/layout/PinnedTable.js';
```

(or whichever alias the existing layout barrel uses — the `Table` layout is exported as `TableLayout` from that barrel; mirror that.)

### Step 8 — Add a demo

- Create a `PinnedTablePanel` example or extend [`MiscPanel`](../src/typescript/MiscPanel.ts) with a `PinnedTable` instance bound to a wide store (10+ columns) with `pinned: true` declared on the first two columns. The demo confirms:
  - The first two columns stay frozen as the right side scrolls horizontally.
  - Vertical scrolling moves both bodies in lockstep.
  - Selection highlights both pinned and scroll cells of the clicked row.
  - The column context menu lists every column (pinned and scroll) in one ordered group.
  - Resizing a pinned column widens the pinned region; resizing a scroll column does not.

### Step 9 — Documentation

- Re-export `PinnedTable` from the `component/table` barrel (already in Step 7).
- Add a `@category Components` JSDoc tag on `PinnedTable`.
- Add `docs/components/pinned-table.md` curated page; link from `docs/.vitepress/config.mts` and `docs/components/index.md`.
- `npm run docs:build` — expect 0 errors and 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/table/PinnedTable.ts` |
| Create | `src/typescript/lib/layout/PinnedTable.ts` |
| Create | `docs/components/pinned-table.md` |
| Modify | `src/typescript/lib/component/table/ColumnConfig.ts` |
| Modify | `src/typescript/lib/component/table/Column.ts` |
| Modify | `src/typescript/lib/component/table/Body.ts` |
| Modify | `src/typescript/lib/component/table/index.ts` |
| Modify | `src/typescript/lib/layout/index.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` |
| Modify | `src/typescript/MiscPanel.ts` (demo) or `src/typescript/PinnedTablePanel.ts` (new) |
| Modify | `docs/.vitepress/config.mts` (sidebar entry) |
| Modify | `docs/components/index.md` (catalog) |

No file is deleted.

---

## Verification

- `npm run typecheck` — zero errors.
- `npm run docs:build` — zero errors and zero link warnings (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning).
- `grep -rn 'position:\s*sticky' src/` — expect zero matches (the framework forbids sticky per `ARCHITECTURE.md`; pinning must not introduce it).
- **Demo screen — `PinnedTable` in `MiscPanel` (or its own panel).** Manually verify:
  - The first two columns remain frozen while the right body scrolls horizontally.
  - Vertical wheel / drag on the scrollbar moves both bodies in step. No tearing on fast scroll.
  - Clicking a row on the scroll side highlights both halves of the row; clicking on the pinned side does the same.
  - Shift-click extends selection; Ctrl/Cmd-click toggles a single record. Both bodies stay in sync after either.
  - The column context menu (right-click any header) lists all columns in one ordered run; hiding a pinned column moves no column to the scroll side — it just disappears from the pinned region.
  - Resizing a pinned column re-runs the layout and the scroll region resizes accordingly; resizing a scroll column does not move the pinned/scroll divider.
  - Sorting by a pinned column resorts both bodies (same store).
  - `exportCSV` includes every visible column, pinned-first ordering preserved.
  - Theme toggle (light ↔ dark) swaps the divider color cleanly.
- **Empty pinned-columns degenerate case.** Build a `PinnedTable` with no `pinned: true` declared on any column. Confirm visual result is byte-identical to a plain `Table` (the pinned child sits at zero width; the scroll child fills the container). Take a screenshot before / after to confirm.
- **TreeTable confirms unaffected.** Open an existing `TreeTable` demo and confirm zero behavioural change.

---

## Documentation Impact

- **New public symbol** `PinnedTable` — re-exported from `~/component/table/index.ts`. Carries `@category Components` so it lands in `docs/api/component/table/`.
- **New layout** `PinnedTableLayout` — re-exported from `~/layout/index.ts`. Carries `@category Layouts`.
- **New `ColumnConfig` field** `pinned` — internal field on an already-documented interface; the existing `docs/components/table.md` page (if present) gets a sentence pointing readers at `PinnedTable` when the flag is meaningful.
- **New curated page** `docs/components/pinned-table.md` — one example with a wide table, two pinned columns, plus a paragraph on the spec partition behaviour. Linked from `docs/.vitepress/config.mts` and `docs/components/index.md` per [docs-conventions.md](../.claude/skills/_shared/docs-conventions.md).
- **JSDoc cross-bucket reference** from `PinnedTable` to `Table` lives in the same bucket (both are `component/table`), so `{@link Table}` resolves cleanly. The reference to `ColumnConfig.pinned` from `PinnedTable`'s class JSDoc is same-file-adjacent and uses `{@link}`.

---

## Potential Challenges

- **Horizontal-scroll mirror on the pinned-table header.** The pinned child's body has `overflow-x: hidden`, so its body's `scrollLeft` is always zero. The header's existing transform-mirror listener ([Table.ts:155-163](../src/typescript/lib/component/table/Table.ts#L155-L163)) fires on every body scroll, including a zero-scroll-left mirror. The transform write to a translate-(0, 0) is a no-op in the layered compositor — no perf concern. Mitigation: none needed; document the observed behaviour in `PinnedTable`'s JSDoc.
- **First-render race on column widths.** `PinnedTableLayout.doLayout` reads `pinnedTable.getColumnWidths()` to allocate the pinned slot. On the first layout pass `getColumnWidths()` returns `[]` (the inner `TableLayout` has not run yet). The fix: a two-pass layout — `PinnedTableLayout.doLayout` calls `pinnedTable.doLayout()` first (with the previous pass's width, or the container width / 3 fallback on the very first render), reads the now-populated widths, then sets `pinnedTable.setWidth(sum)` and runs `pinnedTable.doLayout()` a second time. The cost is one extra `doLayout` per resize event — comparable to today's `Table.setColumnVisible` cost.
- **Selection mirror infinite-loop risk.** Mitigation: the new `Body.setSelectedRecords` does **not** fire any callback. The two subtree click listeners on `PinnedTable` therefore can't re-enter each other — the mirror is one-directional within a single click event.
- **Pinned-table border vs. table-level border.** [`Table`'s constructor](../src/typescript/lib/component/table/Table.ts#L108) sets a full border. With two child tables placed side-by-side, the interior borders would double. Mitigation: `PinnedTable` clears the pinned child's right border (replaced by the divider token) and the scroll child's left border, then keeps the outer borders intact.
- **Empty store.** A `PinnedTable` constructed against a store with zero records, no pinned columns, and no scroll columns must not throw. Mitigation: `Column.resolve` already returns `[]` when no fields match the strict spec; the constructor builds two empty-spec child tables, both render their empty header band, and the layout runs cleanly. Covered by the empty-pinned-columns smoke test above.
- **Footer in pinned mode.** [`FooterRow`](../src/typescript/lib/component/table/Footer.ts) exists on each child table independently. When summary aggregations are introduced (separate plan), each footer reads the same store — same value computed twice but consistent. No special wiring for v1; footers are `_footerVisible: false` by default ([Table.ts:116](../src/typescript/lib/component/table/Table.ts#L116)).

---

## Critical Files

- [`src/typescript/lib/component/table/Table.ts`](../src/typescript/lib/component/table/Table.ts) — the class composed twice; understand its constructor wiring ([Table.ts:103-164](../src/typescript/lib/component/table/Table.ts#L103-L164)) and its `setColumnVisible` / `showColumnMenu` shape ([Table.ts:265-291](../src/typescript/lib/component/table/Table.ts#L265-L291), [Table.ts:590-653](../src/typescript/lib/component/table/Table.ts#L590-L653)).
- [`src/typescript/lib/component/table/Body.ts`](../src/typescript/lib/component/table/Body.ts) — selection state ([Body.ts:65, 817-828](../src/typescript/lib/component/table/Body.ts#L65)), scroll API ([Body.ts:433-449](../src/typescript/lib/component/table/Body.ts#L433-L449)).
- [`src/typescript/lib/component/table/Column.ts`](../src/typescript/lib/component/table/Column.ts) — the field where `pinned` is added.
- [`src/typescript/lib/component/table/ColumnConfig.ts`](../src/typescript/lib/component/table/ColumnConfig.ts) — the spec interface where `pinned` is added.
- [`src/typescript/lib/layout/Table.ts`](../src/typescript/lib/layout/Table.ts) — the layout manager `PinnedTableLayout` is shaped against (`attach`, `doLayout`).
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — the base class.
- [`src/typescript/lib/component/container/VirtualScroller.ts`](../src/typescript/lib/component/container/VirtualScroller.ts) — confirms `setScrollY` semantics for the mirroring scheme.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `setOverflowX`, `setOverflowY`, `setBorder`, `setLayoutManager`, `Event.addListener`.
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — the `Event` API and `addSubtreeListener` semantics.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — where the new `--ts-ui-table-pinned-divider` token lands.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — the "no position:sticky" and "named-listener" rules this plan must honour.

---

## Non-Goals

- **No `TreeTable` pinning.** Pinning a tree column would require coordinating the depth indent and toggle UI across two separately-mounted bodies; the per-record expand state lives on `TreeBody._expandedNodes` and cannot be cheaply mirrored without an additional `setExpandedState` setter on `TreeBody`. Adding pinning to `TreeTable` is a follow-up plan once `PinnedTable` ships and the indent-mirror cost is empirically measured.
- **No runtime re-pin via header drag.** The pinned-vs-scroll partition is fixed at construction. A header-drag affordance is a separate feature with its own UX (a "pin this column" menu entry, a drag-handle gesture, conflict resolution against `feature/drag-and-drop`), and lands as a separate plan.
- **No `PinSeparator`.** The interactive draggable divider from the original draft is dropped — see `## Architecture Decisions` above. A non-interactive 1 px border stays.
- **No `ScrollOverlay`.** The transparent overlay-with-phantom-height from the original draft is dropped — native scrolling on the right body plus `setScrollY` mirroring is simpler and correct.
- **No `PinnedTablePanel`.** [`TablePanel`](../src/typescript/lib/component/table/TablePanel.ts) and [`TreeTablePanel`](../src/typescript/lib/component/table/TreeTablePanel.ts) wrap their tables in a toolbar; a `PinnedTablePanel` is a future composition, not part of this plan.
- **No new `ColumnConfig` flag beyond `pinned`.** The other in-flight Table plans add their own flags; this plan does not block on or co-opt those.
- **No per-row pin state.** Pinning is column-level. "Sticky first row" is a different feature.
