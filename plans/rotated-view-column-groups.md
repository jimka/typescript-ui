# Rotated View Column Groups — Implementation Plan

## Overview

Column groups (`ColumnConfig.group` / `groupColor`) render today as a spanning parent-header band above the column row — see [`Header.ts:623-688`](../packages/lib/src/typescript/lib/component/table/Header.ts#L623)'s `rebuildParentCells`. When a `Table` enters rotated mode (`setDisplayMode("rotated")`), the source columns become field/value rows in a flat list — see [`Table.ts:1089-1107`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1089)'s `rebuildRotatedStore` — and every trace of grouping is dropped. This plan adds a group-separator row immediately before each contiguous run of a group's field/value rows in the rotated projection, labeled with the group name and tinted with `groupColor` when set. Ungrouped columns are untouched.

The change touches the rotated projection build in [`Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts) (`ensureRotatedStore`, `rebuildRotatedStore`, `bindView`), the row-pool bind loop and keyboard/click handling in [`Body.ts`](../packages/lib/src/typescript/lib/component/table/Body.ts), and the per-row cell-reconcile machinery in [`Row.ts`](../packages/lib/src/typescript/lib/component/table/Row.ts). It adds one new cell class, `GroupSeparatorCell`, mirroring [`cell/ParentHeader.ts`](../packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts)'s shape. `Header.ts` and `layout/Table.ts` are not modified — this feature is entirely inside the body's row-rendering path; see the sibling-plan note below.

A sibling plan, [`plans/table-column-filters.md`](table-column-filters.md), also touches `Header.ts` and `layout/Table.ts`, adding a third header row and a `filterRowHeight` term to the header-band arithmetic. That plan's changes are confined to the header band; this plan's changes are confined to the body's row list and never touch `Header.ts` or `layout/Table.ts`. The only file both plans edit is `component/table/index.ts`, where each adds one independent barrel-export line — not a real conflict.

---

## Architecture Decisions

### Group runs are detected in `Table.ts`, mirroring `Header.rebuildParentCells`

`Table` gets a private `computeGroupRuns(columns: Column[])` that walks the visible source columns and finds contiguous runs sharing the same non-null `group` key, taking the first non-null `groupColor` in each run — the identical adjacency rule `Header.rebuildParentCells` already established at [`Header.ts:623-688`](../packages/lib/src/typescript/lib/component/table/Header.ts#L623).[^mirror-header] Unlike `Header`, which also emits a blank spanning cell for every *ungrouped* run so the parent-header band has no gap, `computeGroupRuns` emits nothing for an ungrouped run.[^no-blank-emit] `Header`'s version re-sorts its column list by `Field.getOrder()` before walking it; `computeGroupRuns` does not, because `getSourceColumns()` is already sorted that way by `Column.resolve` ([`Column.ts:228-229`](../packages/lib/src/typescript/lib/component/table/Column.ts#L228)).

### A separator is a real record in the rotated store, identified by a `Table`-owned map — not a new model field

The rotated store stays a plain `MemoryStore` over the existing three-field `ROTATED_MODEL` (`field`, `value`, `filler`). A separator is loaded as an ordinary record — `{ field: <group name>, value: null }` — sitting in the same array `rebuildRotatedStore` already builds. `Table` also builds a parallel `Map<ModelRecord, { label: string, color: string | null }>` from the just-loaded records, keyed by object identity, so `Body` can ask "is this record a separator, and what does it say" without a model schema change and without risking a false match against a real field whose name happens to equal a group name.[^why-identity-map] This mirrors how the filler column reuses the existing read-only projection machinery instead of inventing a new construct (`plans/implemented/rotated-view-filler-column.md`'s `## Architecture Decisions`).

### Separators are shown only while the rotated projection is unsorted

`Table.md` already documents that sorting the rotated grid (clicking `field` or `value`) "reorders the field rows... alphabetically" — a plain store sort with no notion of group adjacency. Loading separator records into a store that gets independently re-sorted would scatter them away from the group they label. The decision: `rebuildRotatedStore` includes separator records only when `store.getActiveSorters().length === 0`; the rotated store's `'sortchange'` event (fired by both `sort()` and `clearSort()`) triggers a fresh `rebuildRotatedStore()` call, so clicking a header immediately drops every separator and clearing the sort restores them.[^sort-suppression]

### A separator row is a mode switch on the pooled `Row`, not a second pooled row type

`Body extends VirtualRowView<Row>` — the row pool, height, and window math are all generic over exactly one row type ([`VirtualRowView.ts:42-84`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L42)). Introducing a second row class would mean widening the pool, the height accounting, and every `row.getComponents()` call site in `Body.ts` to know about two shapes. Instead `Row` gains a private `_separatorMode` flag and two methods, `renderSeparator(label, color)` and `isSeparator()`: rendering a separator disposes whatever cells the row currently holds and mounts one `GroupSeparatorCell`; the existing `setColumnWindow` (used for every ordinary row) disposes that cell and rebuilds the normal three cells the moment a recycled slot is asked to render a real field again.[^why-not-two-row-types] Row height stays uniform — a separator row costs exactly one row height, like every other row; no variable-height row support is added.

### The separator's cell spans the whole row directly, not via `spanFrom`/`spanTo`

`ParentHeaderCell` spans a *partial* range of columns, because a parent-header run can sit next to another group's run in the same row — so `Header` stores `spanFrom`/`spanTo` indices in the cell's layout constraints and sums column widths between them ([`Header.ts:850-863`](../packages/lib/src/typescript/lib/component/table/Header.ts#L850)). A body separator always covers the *entire* row (there is nothing beside it), so `Body.bindAndPositionRows` positions the one `GroupSeparatorCell` at `x = 0`, `width = rowWidth` — the same `rowWidth` every ordinary row's outer element is already sized to via `positionRow` ([`VirtualRowView.ts:363-385`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L363)). No span indices, no column-width lookup.

### Separator rows are not selectable, are skipped by keyboard row navigation, and carry `role="separator"`

A separator has no source record to select. `Body.onRowClick` returns immediately for a separator row, before any selection or focus logic runs, so it never enters `_selectedRecords` or becomes `_anchorRecord`. `Body.onKeyDown`'s row navigation (`ArrowUp`/`ArrowDown`/`PageUp`/`PageDown`/`Home`/`End`) steps past a separator in whichever direction the key already moves, landing the anchor on the nearest real field row. `Row.renderSeparator` sets the row's own ARIA role to the framework's existing `'separator'` value ([`Aria.ts:33`](../packages/lib/src/typescript/lib/core/Aria.ts#L33)) instead of the default `'row'`; `setColumnWindow`'s transition back to a normal row restores `'row'`.

### `GroupSeparatorCell` mirrors `ParentHeaderCell`'s construction contract, plus a divider border

`GroupSeparatorCell extends DefaultCell`, constructed with `(text, color)` exactly like `ParentHeaderCell` — bold left-aligned text, background `color ?? "transparent"` — reusing the same "no editor, so the cell can't be entered" trick `DefaultCell` already gives every header cell. Unlike `ParentHeaderCell`, which relies on the header band's own gradient to look "header-like" when its background is transparent, a body row has no such inherited surface, so `GroupSeparatorCell` also paints a 1px top divider in the existing `--ts-ui-table-header-border` token — the same token `ParentHeaderCell`'s own dividers use — so an uncolored separator still reads as a boundary, not a blank row.

---

## Public API

No changes to `Table`'s consumer-facing surface — `ColumnConfig.group` / `groupColor` already exist (`plans/implemented/table-parent-headers.md`) and this feature activates automatically for a `Table` in rotated mode. Most new symbols below are internal wiring, matching how `rowReadOnly` / `rowVisible` are documented as "not for consumer use." `GroupSeparatorCell` is the one new exported class, but — like `ParentHeaderCell` before it — consumers are not expected to construct it directly; it is exported for the same reason every framework component is (barrel consistency, `docs:api` coverage), not as a new configuration surface.

```typescript
// component/table/Table.ts
class Table {
    private _rotatedSeparatorRecords: Map<ModelRecord, { label: string, color: string | null }>;

    private computeGroupRuns(columns: Column[]): Map<number, { label: string, color: string | null }>;
    // keyed by the run's starting index into `columns`
}
```

```typescript
// component/table/Body.ts
class Body extends VirtualRowView<Row> {
    private _rowSeparator: ((record: ModelRecord) => { label: string, color: string | null } | null) | null;

    /** Internal wiring called by Table's bindView — not for consumer use. */
    setRowSeparator(predicate: ((record: ModelRecord) => { label: string, color: string | null } | null) | null): this;
}
```

```typescript
// component/table/Row.ts
class Row {
    isSeparator(): boolean;
    renderSeparator(label: string, color: string | null): void;
}
```

```typescript
// component/table/cell/GroupSeparator.ts (new)
class GroupSeparatorCell extends DefaultCell {
    constructor(text: string, color: string | null);
    getColor(): string | null;
}
```

---

## Internal Structure

### `Table.computeGroupRuns` — the run-detection helper

Mirrors `Header.rebuildParentCells`'s loop ([`Header.ts:640-687`](../packages/lib/src/typescript/lib/component/table/Header.ts#L640)) but records only grouped runs, keyed by start index:

```typescript
private computeGroupRuns(columns: Column[]): Map<number, { label: string, color: string | null }> {
    const runs = new Map<number, { label: string, color: string | null }>();

    if (columns.length === 0) {
        return runs;
    }

    let runStart = 0;
    let runKey   = columns[0].getGroup();
    let runColor = columns[0].getGroupColor();

    const flush = (): void => {
        if (runKey !== null) {
            runs.set(runStart, { label: runKey, color: runColor });
        }
    };

    for (let i = 1; i < columns.length; i++) {
        const nextKey = columns[i].getGroup();
        const runContinues = runKey !== null && nextKey === runKey;

        if (!runContinues) {
            flush();
            runStart = i;
            runKey   = nextKey;
            runColor = columns[i].getGroupColor();
        } else if (runColor === null && columns[i].getGroupColor() !== null) {
            runColor = columns[i].getGroupColor();
        }
    }

    flush();

    return runs;
}
```

### `Table.rebuildRotatedStore` — inserting separator rows

Builds `rows` for `store.loadData` and a parallel `separatorInfo` array (same length and index alignment, `null` for a real field row) in one pass, then zips `separatorInfo` against the just-loaded records by index to populate `_rotatedSeparatorRecords`:

```typescript
private rebuildRotatedStore(): void {
    const store   = this.ensureRotatedStore();
    const columns = this.getSourceColumns();
    const record  = this._rotatedRecord;

    this._rotatedFieldByName = new Map(columns.map(c => [c.getField().getName(), c.getField()]));

    const rows: Array<{ field: string, value: unknown }> = [];
    const separatorInfo: Array<{ label: string, color: string | null } | null> = [];

    if (record) {
        const runs = store.getActiveSorters().length === 0
            ? this.computeGroupRuns(columns)
            : new Map<number, { label: string, color: string | null }>();

        for (let i = 0; i < columns.length; i++) {
            const run = runs.get(i);

            if (run) {
                rows.push({ field: run.label, value: null });
                separatorInfo.push(run);
            }

            const field = columns[i].getField();

            rows.push({ field: field.getName(), value: record.get(field.getName()) });
            separatorInfo.push(null);
        }
    }

    store.loadData(rows);

    this._rotatedSeparatorRecords = new Map();

    store.getRecords().forEach((r, i) => {
        const info = separatorInfo[i];

        if (info) {
            this._rotatedSeparatorRecords.set(r, info);
        }
    });
}
```

`store.getRecords()` returns the just-loaded records in load order: no sort is active whenever `separatorInfo` holds any non-null entry (the sorted branch above builds an empty `runs` map, so every entry is `null` and the final `forEach` is a no-op pass over plain field rows — `_rotatedSeparatorRecords` correctly ends up empty while sorted).

### `Table.ensureRotatedStore` — wiring the sort listener once

Added directly after `this._rotatedStore = new MemoryStore(ROTATED_MODEL, []);` ([`Table.ts:1074`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1074)):

```typescript
this._rotatedStore.on('sortchange', () => this.rebuildRotatedStore());
```

Registered once, since `_rotatedStore` is created lazily but reused across every mode toggle. `rebuildRotatedStore`'s `store.loadData(rows)` call fires the store's own `'load'` event, which `Body` already listens for on whatever store it is currently bound to ([`Body.ts:331`](../packages/lib/src/typescript/lib/component/table/Body.ts#L331)) and responds to by re-rendering — so no extra `doLayout()` call is needed in the sort handler.

### `Table.bindView` — seventh parameter

Mirrors the `rowVisible` parameter `plans/implemented/table-row-visibility.md` added the same way ([`Table.ts:1180-1219`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1180)):

```typescript
private bindView(
    store:        AbstractStore,
    columns:      Column[],
    configs:      Map<string, ColumnConfig>,
    hidden:       Set<string>,
    rowReadOnly:  ((record: ModelRecord) => boolean) | null,
    rowVisible:   ((record: ModelRecord) => boolean) | null,
    rowSeparator: ((record: ModelRecord) => { label: string, color: string | null } | null) | null,
): void {
    // ...unchanged...
    this._body.setRowReadOnly(rowReadOnly);
    this._body.setRowVisible(rowVisible);
    this._body.setRowSeparator(rowSeparator);
    this._body.setStore(store);
    // ...unchanged tail...
}
```

Both call sites in `setDisplayMode` ([`Table.ts:406,409`](../packages/lib/src/typescript/lib/component/table/Table.ts#L406)) gain the seventh argument:

```typescript
// entering "rotated"
this.bindView(rotatedStore, this._rotatedColumns, this._rotatedConfigs, new Set(), () => true, null,
    (record) => this._rotatedSeparatorRecords.get(record) ?? null);

// returning to "normal" — no separators outside rotated mode
this.bindView(this._store, this.getSourceColumns(), this._columnConfigs, this.getEffectiveHiddenSet(),
    this._spec?.rowReadOnly ?? null, this._rowVisible, null);
```

### `Body.setRowSeparator` — mirrors `setRowReadOnly`'s shape

Plain field assignment, no forced render: every `bindView` call is already followed by `setStore` / `doLayout`, so nothing needs `setRowSeparator` itself to trigger a render (unlike `setRowVisible`, which consumers call standalone and which therefore does force one).

```typescript
setRowSeparator(predicate: ((record: ModelRecord) => { label: string, color: string | null } | null) | null): this {
    this._rowSeparator = predicate;

    return this;
}
```

### `Body.bindAndPositionRows` — the separator branch

Inserted at the top of the per-slot loop in [`Body.ts:1059-1108`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1059), before the existing `row.setColumnWindow(...)` call:

```typescript
for (let i = 0; i < windowSize; i++) {
    const row        = this._rowPool[i];
    const dataIndex  = firstRow + i;
    const record     = records[dataIndex];
    const separator  = this._rowSeparator?.(record) ?? null;

    if (separator) {
        const wasRebound = this._boundIndices[i] !== dataIndex;

        if (wasRebound || !row.isSeparator()) {
            row.renderSeparator(separator.label, separator.color);
            this._boundIndices[i] = dataIndex;
            this.computeRowAria(row, dataIndex);
        }

        this.positionRow(i, dataIndex * rowHeight, rowWidth);
        this._cellGeom.apply(row.getComponents()[0], 0, rowWidth, rowHeight);

        continue;
    }

    // ...existing logic, unchanged...
}
```

`applyReadOnlyState` and `applyRequiredEmptyState` are never called for a separator row (the `continue` skips them) — both would otherwise loop over `row.getFieldNames()`, which is empty for a separator row, so skipping is a correctness choice, not just an optimization: neither method's contract expects an empty field list.

### `Body.onRowClick` — the separator guard

One line at the top of [`Body.ts:1154`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1154):

```typescript
private onRowClick(row: Row, e: MouseEvent): void {
    if (row.isSeparator()) {
        return;
    }

    const record = row.getData() ?? null;
    // ...unchanged...
}
```

### `Body.onKeyDown` — skipping separators during row navigation

A new private helper, consulted only when a separator predicate is active:

```typescript
private skipSeparators(records: ModelRecord[], index: number, direction: 1 | -1): number {
    let i = index;

    while (i >= 0 && i < records.length && this._rowSeparator?.(records[i])) {
        i += direction;
    }

    if (i < 0 || i >= records.length) {
        // Ran off the array searching `direction`. Only reachable when a
        // group sits at the very start of the projection and a backward
        // search (ArrowUp / PageUp / End) walks past index 0 — a forward
        // search can never run off the end, because the last row is never
        // a separator (see the invariant below). Retry forward from the
        // original index so the anchor still lands on a real row instead
        // of the clamp below re-selecting the separator it just walked off.
        i = index;

        while (i < records.length && this._rowSeparator?.(records[i])) {
            i++;
        }
    }

    return Math.max(0, Math.min(i, records.length - 1));
}
```

Wired into the row-navigation block of `onKeyDown` ([`Body.ts:1702-1723`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1702)) by tracking each key's own direction and passing `newIdx` through the helper before reading `records[newIdx]`:

| Key | `newIdx` formula (unchanged) | `direction` |
| --- | --- | --- |
| `ArrowDown` | `min(currentIdx + 1, len - 1)` | `+1` |
| `ArrowUp` | `max(currentIdx - 1, 0)` | `-1` |
| `PageDown` | `min(currentIdx + pageSize, len - 1)` | `+1` |
| `PageUp` | `max(currentIdx - pageSize, 0)` | `-1` |
| `Home` | `0` | `+1` |
| `End` | `len - 1` | `-1` |

```typescript
if (this._rowSeparator) {
    newIdx = this.skipSeparators(records, newIdx, direction);
}

const newAnchor = records[newIdx];
```

A separator is always immediately followed by at least one real field row (a run is never empty) and the projection's last row can never be a separator, so every forward (`+1`) search always terminates on a real row without needing the fallback branch. Only a backward (`-1`) search can run off the array — when a group sits at the very first source column, so its separator lands at index `0` — which is exactly what the fallback branch in `skipSeparators` handles.

### `Row` — separator mode

```typescript
private _separatorMode: boolean = false;

isSeparator(): boolean {
    return this._separatorMode;
}

renderSeparator(label: string, color: string | null): void {
    this.disposeAllComponents();
    this.addComponent(new GroupSeparatorCell(label, color));

    this._separatorMode = true;
    this._windowFirst   = 0;
    this._fieldNames    = [];
    this._cellKeys      = [];
    this._treeCell       = null;
    this._columnsDirty  = true;   // forces the next setColumnWindow to rebuild fully

    this.getAria().setRole("separator");
}
```

`setColumnWindow` ([`Row.ts:273`](../packages/lib/src/typescript/lib/component/table/Row.ts#L273)) gains a guard at its very start, before its existing early-return check:

```typescript
setColumnWindow(firstCol: number, lastCol: number): boolean {
    if (this._separatorMode) {
        this.disposeAllComponents();

        this._separatorMode = false;
        this._columnsDirty  = true;
        this.getAria().setRole("row");
    }

    // ...existing logic, unchanged...
}
```

Both `renderSeparator` and this guard use [`Component.disposeAllComponents()`](../packages/lib/src/typescript/lib/core/Component.ts#L5194) — "disposes every current child, then removes them all" — rather than a hand-rolled `for (const cell of this.getComponents()) { this.removeComponent(cell); cell.dispose(); }` loop: `getComponents()` returns the live backing array, so removing from it while iterating it directly would skip every other element. `Header.rebuildParentCells` uses the same built-in for the identical "discard this row's children and start over" operation ([`Header.ts:626`](../packages/lib/src/typescript/lib/component/table/Header.ts#L626)).

Without this guard, a pooled row transitioning from separator back to a normal field row would leave `GroupSeparatorCell` as an untracked, never-disposed fourth child: `setColumnWindow`'s reuse pass only recycles cells it finds in `_fieldNames` (empty in separator mode), so the stray cell would never enter its `free` map and never get removed.

### `GroupSeparatorCell` (new file, `component/table/cell/GroupSeparator.ts`)

```typescript
class GroupSeparatorCell extends DefaultCell {
    private _color: string | null;

    constructor(text: string, color: string | null) {
        super("td");

        this._color = color;

        const renderer = this.getRenderer();
        renderer.getText().setFontWeight("bold");
        renderer.getText().setText(text);

        this.setBackgroundColor(color ?? "transparent");

        this.setShadow("inset 0 1px 0 0 var(--ts-ui-table-header-border, rgba(0, 0, 0, 0.2))");
    }

    getColor(): string | null {
        return this._color;
    }
}
```

Exported through `callable()` with the underscored-alias idiom, matching `ParentHeaderCell`.

---

## Ordered Implementation Steps

1. **`component/table/cell/GroupSeparator.ts`** (new) — `GroupSeparatorCell extends DefaultCell`, per `## Internal Structure`. Export via `callable()`, mirroring [`cell/ParentHeader.ts`](../packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts)'s export block.
2. **`component/table/index.ts`** — export `GroupSeparatorCell`, alongside the existing `ParentHeaderCell` export.
3. **`component/table/Row.ts`** — add `_separatorMode`, `isSeparator()`, `renderSeparator()`, and the guard at the top of `setColumnWindow`, per `## Internal Structure`. Import `GroupSeparatorCell`.
4. **`component/table/Body.ts`** — add `_rowSeparator` field next to `_rowReadOnly` / `_rowVisible` ([`Body.ts:206-207`](../packages/lib/src/typescript/lib/component/table/Body.ts#L206)) and `setRowSeparator()` next to `setRowReadOnly()` ([`Body.ts:588`](../packages/lib/src/typescript/lib/component/table/Body.ts#L588)).
5. **`component/table/Body.ts`** — insert the separator branch at the top of `bindAndPositionRows`'s loop ([`Body.ts:1062`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1062)), per `## Internal Structure`.
6. **`component/table/Body.ts`** — add the `row.isSeparator()` guard at the top of `onRowClick` ([`Body.ts:1154`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1154)).
7. **`component/table/Body.ts`** — add `skipSeparators()` and wire it into `onKeyDown`'s row-navigation block ([`Body.ts:1702-1723`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1702)), per the key/direction table in `## Internal Structure`.
8. **`component/table/Table.ts`** — add the `_rotatedSeparatorRecords` field next to `_rotatedFieldByName` ([`Table.ts:182`](../packages/lib/src/typescript/lib/component/table/Table.ts#L182)).
9. **`component/table/Table.ts`** — add `computeGroupRuns()`, placed next to `rebuildRotatedStore`.
10. **`component/table/Table.ts`** — rewrite `rebuildRotatedStore()` ([`Table.ts:1089-1107`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1089)) per `## Internal Structure`, so it builds `rows` + `separatorInfo` and populates `_rotatedSeparatorRecords` after `store.loadData(rows)`.
11. **`component/table/Table.ts`** — add the `'sortchange'` listener inside `ensureRotatedStore()` ([`Table.ts:1074`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1074)).
12. **`component/table/Table.ts`** — widen `bindView`'s signature with the seventh `rowSeparator` parameter and forward it to `this._body.setRowSeparator(rowSeparator)` ([`Table.ts:1180-1219`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1180)); update both call sites in `setDisplayMode` ([`Table.ts:406,409`](../packages/lib/src/typescript/lib/component/table/Table.ts#L406)).
13. Regression check: `grep -n "this.bindView(" packages/lib/src/typescript/lib/component/table/Table.ts` — expect exactly two matches, both now passing seven arguments.
14. Regression check: `grep -rn "row.getComponents()" packages/lib/src/typescript/lib/component/table/Body.ts` — for each match outside the new separator branch, confirm it is only reachable for the anchor row (`_anchorRecord`, never a separator per `## Architecture Decisions`) or is bounds-checked before indexing (`_updateFocusStyle`, `_updateActiveDescendant` already are).
15. **New test file** `packages/lib/tests/component/table/RotatedGroupSeparators.test.ts` — write the cases in `## Expected Behaviour`, mirroring `RotatedView.test.ts`'s `makeStore` / `makeTable` helper style and `installTestDOM` setup.
16. **Docs** — apply the edits in `## Documentation Impact`.
17. Run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run docs:api` from `packages/lib`.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Create | `packages/lib/src/typescript/lib/component/table/cell/GroupSeparator.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/index.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Row.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Create | `packages/lib/tests/component/table/RotatedGroupSeparators.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |

`packages/lib/tests/component/table/RotatedView.test.ts` needs no edit: none of its fixtures declare `ColumnConfig.group`, so `computeGroupRuns` returns an empty map for every one of its tests and the feature is a no-op there.

---

## Expected Behaviour

Unit-testable (offline harness, `installTestDOM`) unless marked manual.

1. A rotated table whose spec declares no `group` anywhere: `body.getVisibleRecords()` has exactly one entry per visible source field, identical to today — `RotatedView.test.ts`'s existing assertions keep passing unchanged.
2. A spec with `[street(group:"Address"), city(group:"Address"), zip(group:"Address"), cost(no group)]`, rotated: `body.getVisibleRecords()` is `[separator("Address"), street, city, zip, cost]` — one separator immediately before the run, none before or after the ungrouped `cost` row.
3. `groupColor` first-non-null-wins, mirroring `Header`'s rule — worked example:

   | Column | `group` | `groupColor` |
   | --- | --- | --- |
   | `street` | `"Address"` | (none) |
   | `city` | `"Address"` | `"rgba(30,100,200,0.06)"` |
   | `zip` | `"Address"` | (none) |

   The separator's `color` is `"rgba(30,100,200,0.06)"` (from `city`), even though `street` sorts first.
4. Non-adjacent columns sharing the same group name (`[a(group:"X"), b(no group), c(group:"X")]`) produce **two** separators, both labeled `"X"` — mirrors `Header`'s "non-adjacent same-named groups render as two separate parent cells" rule, not one merged run.
5. Hiding the middle column of a 3-column group (`table.setColumnVisible` called *before* rotating, so the column is absent from `getSourceColumns()`) splits or removes the separator exactly as `Header`'s parent cell would — since `computeGroupRuns` walks the same filtered, visible column list.
6. `table.setDisplayMode("rotated")` then `store.sort([{ field: 'value', dir: 'asc' }])` (invoked through a header-cell click in a live app, or directly on the rotated store in a test): every separator disappears from `body.getVisibleRecords()`; the remaining rows are exactly the field rows, sorted.
7. `store.clearSort()` afterward: separators reappear, in their original positions relative to the (now unsorted) field rows.
8. Clicking a separator row's DOM element does not add anything to `body`'s internal selection (assert via reaching into `body`'s pool row, since `Table`'s public selection API is unaffected either way while rotated).
9. With the keyboard, `ArrowDown` repeatedly from the first field row never lands the anchor on a separator record — each step either advances past it or (at the boundary) stays on the nearest real row. Same for `ArrowUp`, `Home`, `End`, `PageUp`, `PageDown`.
10. With a spec whose *first* source column belongs to a group (its separator lands at index `0`), pressing `ArrowUp` while the anchor is on the group's first field row lands back on that same field row, not on the separator — exercises `skipSeparators`' backward-search fallback.
11. `record.get('field')` / `record.get('value')` on a separator record never reaches `rotatedCellType` / `rotatedCellValues` — those are only invoked through the `value` column's cell-type resolution during a normal field row's cell construction, which a separator row never triggers (it renders a `GroupSeparatorCell`, not a `value`-column typed cell).
12. Switching the displayed record (`table.selectRecord(otherRecord)`) rebuilds separators fresh and correctly for the new record (the columns and their groups don't change per record, so the separator set is identical across records with the same spec — this pins that `rebuildRotatedStore` stays correct on every call, not just the first).
13. Returning to `"normal"` mode (`table.setDisplayMode("normal")`): the source table's columns and rows are completely unaffected — no separator concept exists outside rotated mode.
14. `table.setColumnVisible` / `table.setRowVisible` remain no-ops while rotated, unaffected by this change (existing `RotatedView.test.ts` cases for both keep passing).

### Manual verification

15. In the docs app, a rotated table over a spec with two groups (one with `groupColor`, one without): both separators render with bold labels; the colored one shows its tint, the uncolored one shows the top divider only, no background.
16. Scroll a long rotated list (many fields, one group in the middle) up and down so a pooled row slot cycles between showing a separator and showing ordinary field rows — no stray cell, no visual glitch, no console error.
17. Toggle the theme while a rotated table with groups is visible — the separator's divider border and any un-colored background follow the theme change (the border reads the CSS variable at render time).

---

## Verification

From `packages/lib`:

- `npm run typecheck` — zero errors. `bindView`'s new parameter and the new `Row` / `Body` / `Table` members are the likely surfacing points for a missed call site.
- `npm run lint` — zero errors, in particular `local/require-content-bounds` and `local/no-raw-dom` over `GroupSeparator.ts` and the edited files.
- `npm run test` — the new `RotatedGroupSeparators.test.ts` plus the full existing suite; `RotatedView.test.ts`, `Body.test.ts`, `Row.test.ts` (if present), and `RowVisibility.test.ts` are the regression guards for the `_rowSeparator === null` default case.
- `npm run docs:api` — zero warnings; new JSDoc must not `{@link}` any `private`/`protected`/`@internal` symbol.
- `grep -n "this.bindView(" packages/lib/src/typescript/lib/component/table/Table.ts` — exactly two matches, both seven-argument.
- Manual: run the docs app (`npm run docs:dev`, port 5173) and exercise cases 15-17 on a `Table` demo whose spec declares `group` / `groupColor`, switched into rotated mode.

---

## Documentation Impact

- `packages/lib/docs/components/Table.md`:
  - Add a bullet to `## Rotated record view` ([`Table.md:159-180`](../packages/lib/docs/components/Table.md#L159)), alongside the existing `setColumnVisible` / `setRowVisible` bullets: entering rotated mode inserts a separator row before each group's run of field/value rows, labeled with the group name and tinted with `groupColor` when set; separators are suppressed while the projection is sorted (clicking `field` or `value`) and reappear when the sort is cleared; separator rows are not selectable and are skipped by keyboard row navigation.
  - No change needed to `## Parent headers` — that section already fully describes `group` / `groupColor`; this plan only adds a cross-reference sentence pointing to the new rotated-mode bullet.
- No barrel change beyond `component/table/index.ts` exporting `GroupSeparatorCell` (already listed in `## Files to Create / Modify / Delete`) — `Table`, `Body`, and `Row` are already exported and documented; the new methods on them appear automatically once `npm run docs:api` runs.
- No changelog entry or version bump — handled separately at release time, matching `plans/implemented/table-row-visibility.md`.

---

## Potential Challenges

- **A pooled row leaking a stray `GroupSeparatorCell` on transition back to a normal row.** *Mitigation:* `setColumnWindow`'s new guard explicitly disposes the separator cell and resets `_columnsDirty` before its existing reconcile logic runs — see `## Internal Structure`.
- **The `'sortchange'` listener re-entering `rebuildRotatedStore` in a loop.** *Mitigation:* verified that `AbstractStore.loadData` emits `'load'`, never `'sortchange'`, so calling `store.loadData(...)` from inside the `'sortchange'` handler cannot re-trigger itself.
- **Keyboard navigation stranding the anchor on a separator at a list boundary.** A group at the very first source column puts its separator at index `0`; `ArrowUp` (or `End`, or `PageUp`) from the first real row searches backward, runs off the array, and a plain clamp back to `[0, length-1]` would re-select that same separator. *Mitigation:* `skipSeparators`' fallback branch retries with a forward search from the original index once the backward search runs off the array — forward search is proven to always terminate on a real row, since the projection's last row can never be a separator.
- **A separator row nested inside `role="separator"` still carrying a `role="gridcell"` on its inner cell.** *Mitigation:* accepted as-is — see `## Non-Goals`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Header.ts`](../packages/lib/src/typescript/lib/component/table/Header.ts) — `rebuildParentCells` (623-688), the run-detection precedent `computeGroupRuns` mirrors; `positionParentCells` (850-863), the partial-span precedent this plan deliberately does not reuse.
- [`packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts`](../packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts) — the styling and construction-contract precedent for `GroupSeparatorCell`.
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts) — `ensureRotatedStore`, `rebuildRotatedStore`, `rotatedCellType` / `rotatedCellValues`, `bindView`, `setDisplayMode`.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](../packages/lib/src/typescript/lib/component/table/Body.ts) — `bindAndPositionRows`, `onRowClick`, `onKeyDown`, `setRowReadOnly` / `setRowVisible` (the shape `setRowSeparator` mirrors).
- [`packages/lib/src/typescript/lib/component/table/Row.ts`](../packages/lib/src/typescript/lib/component/table/Row.ts) — `setColumnWindow`, the reconcile logic `renderSeparator` must not corrupt on either transition direction.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — `positionRow`, confirming a row's own width is already `rowWidth` regardless of what it renders.
- [`plans/implemented/table-parent-headers.md`](implemented/table-parent-headers.md) — the original design reasoning for `group` / `groupColor` and the contiguous-run algorithm.
- [`plans/implemented/rotated-view-filler-column.md`](implemented/rotated-view-filler-column.md) — the precedent for adding a non-data, presentational row/column to the rotated projection by reusing existing store/row machinery instead of a new construct.
- [`plans/implemented/table-row-visibility.md`](implemented/table-row-visibility.md) — the precedent for threading a new predicate through `bindView` and neutralizing it on the normal-mode call site.
- [`packages/lib/tests/component/table/RotatedView.test.ts`](../packages/lib/tests/component/table/RotatedView.test.ts) — the style and helpers `RotatedGroupSeparators.test.ts` mirrors.

---

## Non-Goals

- **Nested or multi-level groups.** Same non-goal as `table-parent-headers.md`; a group is a flat string key, one separator per contiguous run.
- **Showing separators while the rotated projection is sorted.** Explicitly suppressed — see `## Architecture Decisions`.
- **Making separator rows selectable, focusable, editable, or draggable.** They have no source record.
- **Extending `AriaRole` with a `'presentation'` value** to suppress the separator cell's inherited `'gridcell'` role. The row's own `role="separator"` is the primary accessibility signal; adding a new role value for this one nested cell is out of proportion.
- **`TreeTable` interaction with rotated mode.** Whether `TreeTable.setDisplayMode("rotated")` behaves sensibly at all is a pre-existing, undocumented question this plan does not investigate — `TreeBody.getVisibleRecords()`'s tree-flatten override is not known to special-case the rotated projection, independent of group separators. Same scoping `table-row-visibility.md` applied to `setRowVisible` on `TreeBody`.
- **A changelog entry or version bump.** Handled separately at release time.

---

## Notes

[^mirror-header]: `Header.rebuildParentCells` ([`Header.ts:623-688`](../packages/lib/src/typescript/lib/component/table/Header.ts#L623)) is the only existing code in this codebase that decides "where does one group's run of columns start and end," including the two non-obvious rules a naive reimplementation would miss: non-adjacent columns sharing a group name are two separate runs, not one, and the run's color is the *first* non-null `groupColor` encountered, not the last or an error on conflict. Reusing that exact rule set (rather than writing a second, possibly-inconsistent one) is what keeps the rotated view's separators visually honest about what the normal view's parent-header band would show for the same column set.

[^no-blank-emit]: `Header`'s blank spanning cells exist so the parent-header band has no gap where the body's background would leak through a two-row header ([`cell/ParentHeader.ts:17-20`](../packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L17)). A rotated body row has no such continuity requirement — an ungrouped field row simply sits directly below the previous row, exactly as it does today. Emitting a blank separator for every ungrouped column would also directly contradict this plan's explicit requirement that ungrouped columns are completely unaffected.

[^why-identity-map]: Two alternatives were rejected. Adding a fourth field to `ROTATED_MODEL` (e.g. a boolean `separator` column) would need `appendUnlisted`/`hidden` handling so it doesn't become a visible fourth column, and would attach an extra, meaningless key to every real field row's `ModelRecord` too. Testing a record's `field` value against the set of known group names would work most of the time but is a false-match risk: nothing stops a consumer from naming a source field the same as one of their own group names. A `Map<ModelRecord, info>` keyed by the actual record instances `rebuildRotatedStore` just built sidesteps both: it adds no model field, and identity comparison cannot false-match.

[^sort-suppression]: The alternative — keeping separators in the store and trying to re-derive "where would they go" after an arbitrary sort — was rejected. A sort by `value` has no relationship to source-column order at all, so there is no principled position for a group's label once its rows are scattered across the sorted list; showing a separator next to whichever of its rows happens to sort first would misrepresent the grouping rather than express it. Suppressing entirely is simpler and matches the existing precedent that the projection's sort already "does not touch the source store's own sort" and is understood as a distinct, ephemeral ordering (`Table.md`'s `## Rotated record view`).

[^why-not-two-row-types]: `VirtualRowView<TRow>`'s pool, height accounting, and window math are generic over one row type, referenced throughout `Body.ts` as `Row` ([`Body.ts:200`](../packages/lib/src/typescript/lib/component/table/Body.ts#L200)). A second pooled row class would require `Body` to either become `VirtualRowView<Row | SeparatorRow>` (pushing a type-narrowing check into every one of the dozen `row.getComponents()` call sites already surveyed in `## Ordered Implementation Steps`) or maintain a second, parallel pool with its own growth/height logic. A mode flag on the existing `Row` costs one boolean and two methods, and every generic pool/height/window computation in `VirtualRowView` continues to work unmodified because it never needed to know what a row renders, only how tall it is.
