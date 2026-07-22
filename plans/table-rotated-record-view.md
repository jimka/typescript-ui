---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Table.ts
  - packages/lib/docs/components/Table.md
---

# Table Rotated Record View — Implementation Plan

## Overview

`Table` gains a second display mode. In `"normal"` mode it renders one row per record with a column per field, exactly as today. In `"rotated"` mode it renders **one record at a time as key/value rows**: a `field` column holding field names and a `value` column holding that record's values — the equivalent of psql's `\x` expanded display. The motivating case is a query result with 45+ columns, where reading a single record today means scrolling horizontally across the whole width.

The mode is a setter plus a getter on `Table` ([packages/lib/src/typescript/lib/component/table/Table.ts:74](packages/lib/src/typescript/lib/component/table/Table.ts#L74)), mirroring `MarkdownEditor.setMode` ([packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts:425](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L425)). Rotated mode does **not** introduce a new header, body, row, or cell class. It re-points the existing `TableHeader` and `Body` at a two-field **projection store** built from the displayed record, so the whole existing pipeline — virtual scrolling, typed cell renderers, geometry, ARIA — runs unchanged.[^projection]

Target release: **library 0.3.0** (`packages/lib/package.json` currently reads `0.2.0`).

Touched library files: `component/table/Table.ts` (the mode and the projection), `component/table/Header.ts` (one new `setStore` setter), `component/table/index.ts` (one exported type). No change to `Body.ts`, `Row.ts`, any `cell/` class, or `layout/Table.ts`.

---

## Architecture Decisions

### Rotated mode is a display mode on `Table`, not a new component

`Table` gets `setDisplayMode("normal" | "rotated")`. The precedent is `MarkdownEditor`, which swaps between a rich-text surface and a raw-source surface behind one component and one `setMode` call, shipping no toggle chrome of its own ([MarkdownEditor.ts:425](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L425)).[^mode-precedent]

### The rotated view is a two-column projection store, driven through the existing header and body

Entering rotated mode builds a `MemoryStore` over a two-field model — `field` (string) and `value` (auto) — with one record per visible source field, and re-binds the existing `TableHeader` and `Body` to it. `Table.setStore` already performs exactly this re-bind sequence today ([Table.ts:276](packages/lib/src/typescript/lib/component/table/Table.ts#L276)); rotated mode reuses it through a shared private helper.

The `value` column is declared with `ColumnConfig.cellType`, so each row renders the cell variant matching *its own* source field's type — a checkbox for a boolean field, a formatted date for a date field. That is the shipped `DynamicCell` path, demonstrated by `PropertyGridPanel` ([packages/lib/src/typescript/PropertyGridPanel.ts:44](packages/lib/src/typescript/PropertyGridPanel.ts#L44)), which is a hand-built key/value grid over the same mechanism.[^dynamic-cell]

### `TableHeader` gains `setStore`

`TableHeader` holds a store reference to drive sort clicks ([Header.ts:589](packages/lib/src/typescript/lib/component/table/Header.ts#L589)) and has no way to swap it. Without a swap, a header click in rotated mode would sort the *source* store by a field named `field`. `TableHeader.setStore(store)` is added, mirroring `Body.setStore` ([Body.ts:565](packages/lib/src/typescript/lib/component/table/Body.ts#L565)), and is called from both the mode switch and `Table.setStore`.[^header-store]

### The displayed record is the table's selection

There is one concept, not two: the record shown in rotated mode is the record the table has selected. `setDisplayMode("rotated")` adopts the current selection (falling back to the first visible record, then to nothing). While rotated, `Table.selectRecord(record)` re-targets the view, and `getSelectedRecord()` / `getSelectedRecords()` return that source record — never a projection record.[^selection]

`Table` ships no stepper chrome, matching the `MarkdownEditor` precedent above. A consumer steps records by calling `selectRecord` with the neighbour from `getStore().getRecords()`; the demo panel added by this plan wires exactly that to two buttons.

### Rotated mode is read-only

The rotated spec declares `rowReadOnly: () => true`, so every value cell refuses inline editing and carries the standard read-only tint. Committing an edit in rotated mode would write to the projection record, not the source record; mirroring it back is a second, bidirectional sync path with its own re-entrancy trap, and the motivating use case is reading.[^read-only]

---

## Public API

```typescript
// ~/component/table/Table.ts

/** Which presentation a Table renders: record-per-row, or one record as key/value rows. */
export type TableDisplayMode = "normal" | "rotated";

class Table extends Component<TableOptions> {
    /** Returns the active display mode. Defaults to `"normal"`. */
    getDisplayMode(): TableDisplayMode;

    /** Switches presentation. No-op when already in `mode`. */
    setDisplayMode(mode: TableDisplayMode): this;

    // Existing methods whose behaviour becomes mode-aware:
    selectRecord(record: ModelRecord | null): this;
    getSelectedRecord(): ModelRecord | null;
    getSelectedRecords(): ModelRecord[];
    addRow(defaults?: Record<string, any>): ModelRecord;
    removeSelectedRow(): this;
    setStore(store: AbstractStore): this;
    setColumnVisible(fieldName: string, visible: boolean): this;
}
```

```typescript
// ~/component/table/Header.ts

class TableHeader extends Component {
    /**
     * Swaps the store whose sort state this header drives and displays.
     * Called by the owning Table when its bound store or display mode changes.
     */
    setStore(store: AbstractStore): this;
}
```

Backing state on `Table`, all private fields (not `TableOptions` entries)[^no-options-bag]:

| Field | Type | Holds |
|---|---|---|
| `_displayMode` | `TableDisplayMode` | Active mode; defaults `"normal"`. |
| `_rotatedRecord` | `ModelRecord \| null` | The source record the rotated view shows. |
| `_rotatedStore` | `MemoryStore \| null` | The projection store; built lazily on first rotate, reused after. |
| `_rotatedColumns` | `Column[]` | The two resolved projection columns. |
| `_rotatedConfigs` | `Map<string, ColumnConfig>` | Projection column configs (carries `cellType` / `cellValues`). |
| `_fieldByRotatedRecord` | `Map<ModelRecord, Field>` | Projection record → the source `Field` it represents. |
| `_sourceRefresh` | `(() => void) \| null` | The source-store listener, kept for removal in `setStore`. |
| `_suppressSelectionForward` | `boolean` | True during a re-bind, so the body's transient selection clears do not reach consumers. |

New barrel export in `~/component/table/index.ts`: `export type { TableDisplayMode } from '~/component/table/Table.js';`

---

## Internal Structure

### The projection model and spec

Built once, on first entry into rotated mode:

```typescript
const ROTATED_MODEL = new Model([
    { name: 'field', type: 'string', order: 0 },
    { name: 'value', type: 'auto',   order: 1 },
]);
```

The header labels come from the field *names* (`HeaderCell` is constructed with `field.getName()` — [Header.ts:437](packages/lib/src/typescript/lib/component/table/Header.ts#L437)), so the two columns read `field` and `value`, consistent with every other table in the library.

The spec:

```typescript
const spec: ColumnSpec = {
    columns: [
        { field: 'field', minWidth:  80, unhideable: true },
        {
            field: 'value',
            minWidth: 120,
            unhideable: true,
            cellType:   (r) => this.rotatedCellType(r),
            cellValues: (r) => this.rotatedCellValues(r),
        },
    ],
    rowReadOnly: () => true,
};
```

Both columns declare a `minWidth` and **no `maxWidth`**, so both remain flexible and together fill the available width under either column-width model — the current equal-share one and the measured one on the parked `feature/table-many-column-scaling` branch.[^width-models]

### Per-row cell-variant resolution

Both resolvers are O(1) and pure, as `ColumnConfig.cellType` requires:

```typescript
private rotatedCellType(record: ModelRecord): CellType | null {
    const field = this._fieldByRotatedRecord.get(record);

    if (!field) {
        return null;
    }

    const values = this._columnConfigs.get(field.getName())?.values;

    return (values && values.length > 0) ? 'combo' : field.getType();
}
```

Worked example — a source model of four fields, with `status` declared `values: ['open', 'closed']` in the table's own spec:

| Source field | Source type | Projection row `field` | Resolved cell variant |
|---|---|---|---|
| `id` | `number` | `id` | `NumberRenderer` |
| `active` | `boolean` | `active` | checkbox (`BooleanEditor` as renderer) |
| `created` | `date` | `created` | `DateRenderer` (locale date) |
| `status` | `string` + `values` | `status` | `ComboRenderer`, showing the option label |

### Rebuilding the projection

```typescript
private rebuildRotatedStore(): void {
    const store  = this.ensureRotatedStore();
    const fields = this.getSourceColumns().map(c => c.getField());
    const record = this._rotatedRecord;

    store.loadData(record
        ? fields.map(f => ({ field: f.getName(), value: record.get(f.getName()) }))
        : []);

    const byName = new Map(fields.map(f => [f.getName(), f]));

    this._fieldByRotatedRecord = new Map();

    for (const r of store.getRecords()) {
        const field = byName.get(r.get('field') as string);

        if (field) {
            this._fieldByRotatedRecord.set(r, field);
        }
    }
}
```

Pairing is by the record's own `field` value, not by index, so the map stays correct after the user sorts the projection by clicking a header.

### The re-bind helper

One private method performs the header/body re-bind, called by both `setDisplayMode` and `setStore`. Order matters: `Body.setStore` re-renders with pool rows whose cells still match the *old* model, and `Body.setColumns` is what re-syncs those cells ([Body.ts:455](packages/lib/src/typescript/lib/component/table/Body.ts#L455)), so `setColumns` must follow `setStore`.

```typescript
private bindView(
    store:       AbstractStore,
    columns:     Column[],
    configs:     Map<string, ColumnConfig>,
    hidden:      Set<string>,
    rowReadOnly: ((record: ModelRecord) => boolean) | null,
): void {
    this._suppressSelectionForward = true;

    this._header.setStore(store);
    this._header.setModel(store.model);
    this._header.setColumns(columns);
    this._header.setHiddenColumns(hidden);

    this._body.selectRecord(null);
    this._body.setStore(store);
    this._body.setColumnConfigs(configs);
    this._body.setColumns(columns);
    this._body.setHiddenColumns(hidden);
    this._body.setRowReadOnly(rowReadOnly);

    this._suppressSelectionForward = false;

    this._columnWidths      = [];
    this._savedColumnWidths = new Map();

    this.getAria().setColCount(this.getColumns().length);
    this.doLayout();
}
```

Clearing `_columnWidths` is what makes the layout manager re-initialise widths for the new column count (it compares `columnWidths.length` against the header's column count — [layout/Table.ts:108](packages/lib/src/typescript/lib/layout/Table.ts#L108)).

---

## Ordered Implementation Steps

1. **`component/table/Header.ts`** — add `setStore(store: AbstractStore): this`. It assigns the private `_store` field and returns `this`; nothing else. The sort indicators refresh on the `setModel` / `setColumns` calls that follow it. JSDoc: internal wiring called by the owning `Table`.
   *Check:* `npx tsc --noEmit -p packages/lib` still reports exactly the 7 known pre-existing errors.

2. **`component/table/Table.ts`** — add `TableHeader.setStore(store)` as the first line of the existing `setStore` body, before `this._store = store`. This closes a latent bug: swapping a table's store left the header sorting the old one.
   *Check:* `grep -n "_header.setStore" packages/lib/src/typescript/lib/component/table/Table.ts` — expect two matches once step 6 has landed.

3. **`component/table/Table.ts`** — add the exported `TableDisplayMode` type and the eight private fields from `## Public API`. Add `getDisplayMode()`.

4. **`component/table/Table.ts`** — add `private getSourceColumns(): Column[]` holding the *current* body of `getColumns()` (the `_resolvedColumns` filter against the effective hidden set). Rewrite `getColumns()` as: return `this._rotatedColumns` when rotated, else `this.getSourceColumns()`.
   Repoint the export path at the source columns: `getExportColumns` must call `getSourceColumns()`, not `getColumns()`, so CSV/JSON export is mode-independent.
   *Check:* `grep -n "getSourceColumns\|getColumns()" .../Table.ts` — `getExportColumns` uses `getSourceColumns`.

5. **`component/table/Table.ts`** — add the projection builders: `ensureRotatedStore()` (lazily creates the `MemoryStore` + resolves `_rotatedColumns` via `Column.resolve(ROTATED_MODEL.getFields(), spec)` and `_rotatedConfigs` from the same spec), `rebuildRotatedStore()`, `rotatedCellType()`, `rotatedCellValues()` — bodies as given in `## Internal Structure`.

6. **`component/table/Table.ts`** — add `private bindView(...)` per `## Internal Structure`, and make the existing constructor-installed body-selection forwarder respect the new flag:
   ```typescript
   this._body.on("selection", records => {
       if (this._suppressSelectionForward || this._displayMode === "rotated") {
           return;
       }
       this.emit("selection", records);
   });
   ```

7. **`component/table/Table.ts`** — add `setDisplayMode(mode)`:
   - Return `this` unchanged when `mode === this._displayMode`.
   - Assign `this._displayMode = mode`.
   - Entering `"rotated"`: set `_rotatedRecord` to `this._body.getSelectedRecord() ?? this._store.getRecords()[0] ?? null`; `rebuildRotatedStore()`; `bindView(this._rotatedStore!, this._rotatedColumns, this._rotatedConfigs, new Set(), () => true)`; emit `"selection"` with `_rotatedRecord ? [_rotatedRecord] : []`.
   - Returning to `"normal"`: `bindView(this._store, this.getSourceColumns(), this._columnConfigs, this.getEffectiveHiddenSet(), this._spec?.rowReadOnly ?? null)`; then `this._body.selectRecord(this._rotatedRecord)` so the previously displayed record is the selection again.

8. **`component/table/Table.ts`** — subscribe to the source store. In the constructor, mirroring `Body.bindStore` ([Body.ts:215](packages/lib/src/typescript/lib/component/table/Body.ts#L215)): store `const refresh = () => this.onSourceStoreChange();` in `_sourceRefresh` and register it for `'load'`, `'add'`, `'remove'`, `'datachange'`. In `setStore`, remove those four listeners from the outgoing store and register them on the incoming one.
   `onSourceStoreChange()` returns immediately unless rotated. Otherwise: if `_rotatedRecord` is not in `this._store.getRecords()`, replace it with `getRecords()[0] ?? null` and emit `"selection"`; then `rebuildRotatedStore()`.

9. **`component/table/Table.ts`** — make the remaining public methods mode-aware:
   - `selectRecord(record)`: when rotated, set `_rotatedRecord = record`, `rebuildRotatedStore()`, emit `"selection"` with `record ? [record] : []`, return. Otherwise unchanged.
   - `getSelectedRecord()`: when rotated, return `_rotatedRecord`.
   - `getSelectedRecords()`: when rotated, return `_rotatedRecord ? [_rotatedRecord] : []`.
   - `addRow(defaults)`: when rotated, add to `this._store` and route through `this.selectRecord(record)` instead of the two `_body` calls; return the record.
   - `removeSelectedRow()`: when rotated, remove `_rotatedRecord` from `this._store` (no-op when null) and let the store listener from step 8 pick the fallback record.
   - `setColumnVisible(fieldName, visible)`: return `this` unchanged when rotated.
   - `showColumnMenu(x, y)`: when rotated, show only the export entries (and only when `_exportMenuEnabled`); return before building the per-column entries.
   - `setStore(store)`: call `this.setDisplayMode("normal")` first, before any other work.

10. **`component/table/index.ts`** — add `export type { TableDisplayMode } from '~/component/table/Table.js';` beside the existing `TableOptions` / `TableEvent` export.
    *Check:* `grep -n "TableDisplayMode" packages/lib/src/typescript/lib/component/table/index.ts` — one match.

11. **`packages/lib/tests/component/table/RotatedView.test.ts`** — new file covering every offline-testable case in `## Expected Behaviour`. Copy the harness preamble from [tests/component/table/Table.test.ts:1](packages/lib/tests/component/table/Table.test.ts#L1) (`installTestDOM`, `fontMetrics`, `DOM.reset`).

12. **`packages/lib/src/typescript/RotatedRecordPanel.ts`** — new demo panel, modelled on [PropertyGridPanel.ts:19](packages/lib/src/typescript/PropertyGridPanel.ts#L19): a `Panel` with a `Border` layout, a north toolbar of three `Button`s (rotate toggle, previous record, next record), and a `Table` over a 20-field, 30-record `MemoryStore` in the centre. The prev/next buttons compute the neighbour from `table.getStore().getRecords()` and call `table.selectRecord(...)`, clamped at both ends. The toggle flips `setDisplayMode` between the two modes. Register glyphs with `Glyph.register(...)` at module scope as `TablePanel.ts` does; use `table_list`, `angle_left`, `angle_right` from `~/glyphs/solid/`.

13. **`packages/lib/src/typescript/main.ts`** — import `RotatedRecordPanel` and add `addSection(() => new RotatedRecordPanel(), "Rotated");` after the `PropertyGridPanel` line.

14. **`packages/lib/docs/components/Table.md`** — add a "Rotated record view" section per `## Documentation Impact`.

15. Run the full `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/index.ts` |
| Create | `packages/lib/tests/component/table/RotatedView.test.ts` |
| Create | `packages/lib/src/typescript/RotatedRecordPanel.ts` |
| Modify | `packages/lib/src/typescript/main.ts` |
| Modify | `packages/lib/docs/components/Table.md` |

---

## Expected Behaviour

Fixture for the cases below: a model of four fields — `id` (number), `name` (string), `active` (boolean), `created` (date) — and a store of three records.

**Testable offline**

1. **Default mode.** A freshly constructed `Table` reports `getDisplayMode() === "normal"` and `getColumns().length === 4`.
2. **Rotation swaps the column set.** After `setDisplayMode("rotated")`, `getColumns()` has length 2 and the two columns' field names are `field` and `value`, in that order.
3. **One projection row per visible source column.** In rotated mode the body's visible-record count is 4, and their `field` values are `['id', 'name', 'active', 'created']` in source display order.
4. **Values come from the displayed record.** With record 2 selected before rotating, each projection record's `value` equals `record2.get(<its field name>)`.
5. **A hidden source column is absent from the field list.** `setColumnVisible('created', false)` before rotating yields 3 projection rows, and no row whose `field` is `created`.
6. **Selection identity.** In rotated mode `getSelectedRecord()` returns the *source* record — `getSelectedRecord() === record2` — never a projection record; `getSelectedRecords()` returns `[record2]`.
7. **`selectRecord` re-targets the view.** `selectRecord(record3)` while rotated leaves the row count at 4 and updates every `value` to record 3's values, and fires `"selection"` once with `[record3]`.
8. **Empty store.** Rotating a table whose store holds no records produces 0 projection rows, `getSelectedRecord() === null`, and no thrown error.
9. **Record updated underneath.** `record2.set('name', 'changed'); store.notifyRecordChanged(record2)` while rotated leaves the row count at 4 and updates the `name` row's `value` to `'changed'`.
10. **Displayed record removed underneath.** `store.remove(record2)` while rotated re-targets the view to the store's first remaining record and fires `"selection"` with that record.
11. **Store reload.** `store.loadData([...])` while rotated re-targets to the new first record and rebuilds the projection against it.
12. **Round trip restores the normal view.** `setDisplayMode("rotated")` then `setDisplayMode("normal")` restores `getColumns().length === 4`, and the record that was displayed while rotated is the body's selected record again.
13. **Idempotent setter.** Calling `setDisplayMode("rotated")` twice fires `"selection"` exactly once.
14. **Column widths re-initialise for the new column count.** After rotating and `doLayout()`, `getColumnWidths()` has length 2 and each width is at least its declared `minWidth` (80 for `field`, 120 for `value`).
15. **`setColumnVisible` is inert while rotated.** Calling it with any field name leaves `getColumns().length === 2`.
16. **`setStore` leaves rotated mode.** Calling `setStore(otherStore)` while rotated leaves `getDisplayMode() === "normal"` and `getColumns()` matching the new store's fields.
17. **Read-only.** Every cell in every projection row reports `isReadOnly() === true`.
18. **The source store is untouched by rotation.** `store.getRecords().length` and `store.getActiveSorters()` are the same before and after a rotate / un-rotate round trip.

**Needs manual verify** (events, focus, geometry paint, downloads — not modelled offline)

19. **Cell variants render per row.** In the demo panel's rotated view, the boolean field's row shows a checkbox, the date field's row shows a locale-formatted date, and a `values`-constrained field's row shows the option label, not the raw value.
20. **Double-click does not open an editor** on any rotated row, and the read-only tint is visible.
21. **Header drag resizes the field/value split**, and the two columns still fill the table width afterwards.
22. **Header click sorts the field rows** (alphabetically by field name) and leaves the source store's sort untouched.
23. **Right-click on the rotated header** shows only the export entries (with `setExportMenuEnabled(true)`), never the per-column show/hide list.
24. **Export in rotated mode downloads the full source table** — all records, all source columns — not the field/value pairs.
25. **Keyboard navigation** with ArrowUp/ArrowDown moves between field rows; ArrowRight/ArrowLeft moves between the two columns and stops at the edges.
26. **The demo's prev/next buttons** step through records and the rotated values change accordingly; both clamp at the ends without error.

---

## Verification

- `npx tsc --noEmit -p packages/lib` — exactly the **7 known pre-existing errors**, no new ones.
- `npx vitest run --no-file-parallelism packages/lib/tests/component/table/` — all green. `Tests N passed` is **not** sufficient: check the `Errors` line is absent and the process exit code is `0` (unhandled async/GC exceptions fail the run without failing a test).
- `npx vitest run --no-file-parallelism` — full suite, same two checks. `Table.test.ts`, `Body.test.ts`, `Column.test.ts`, `TableExporter.test.ts` and `TreeBody.test.ts` must be unaffected.
- `grep -rn "getColumns()" packages/lib/src/typescript/lib/component/table/Table.ts` — every remaining use is a view-side use (layout, ARIA, resize); export goes through `getSourceColumns()`.
- `npm run docs:build` — **0 errors, 0 link warnings** (the TypeDoc "unsupported TypeScript version" notice is the only acceptable warning). Confirm `TableDisplayMode` appears under `docs/api/component/table/`.
- `npm run dev`, open http://localhost:8015, select the **Rotated** section. Walk manual cases 19–26 there. Also open the **Property Grid** and **Misc.** sections and confirm their tables are unchanged.
- `packages/lib/llms.txt` is generated — confirm it was **not** hand-edited (`git diff --stat` shows no change to it; the `Table` capability row already covers the component).

---

## Documentation Impact

- **Export surface:** `TableDisplayMode` is re-exported from the per-subpath barrel `~/component/table/index.ts` only — never a project root export. It carries `@category Components`, like `TableEvent`.
- **Curated page:** `packages/lib/docs/components/Table.md` gains a "Rotated record view" section covering: what the mode shows, `setDisplayMode` / `getDisplayMode`, that the displayed record is the table's selection, that the mode is read-only, that sorting reorders field rows, and that export always covers the source table. No new page and no sidebar/catalog entry — the mode lives on an already-documented component.
- **Cross-references:** from `Table.ts` JSDoc, link a different bucket as `` [`Model`](/api/data/classes/Model) ``; link within `component/table` as `{@link ColumnConfig}`. Do **not** `{@link}` `bindView`, `rebuildRotatedStore`, `getSourceColumns`, or the new private fields from public JSDoc — they are private and would produce a docs-build warning; describe them in prose instead.
- **No renames or removals**, so no back-reference sweep of `docs/` is needed.
- `packages/lib/llms.txt` and `scripts/llms/manifest.data.mjs` are unchanged: no new capability row, no new top-level symbol.

---

## Potential Challenges

- **Conflict with `feature/table-many-column-scaling`.** That unmerged branch rewrites `Table.getDefaultColumnWidth`, `layout/Table.ts`'s width initialisation, `MiscPanel.ts`, and `docs/components/Table.md`. This plan touches none of those width methods and adds a *new* demo panel rather than editing `MiscPanel.ts`, so the only real overlap is `Table.ts` import lines and `Table.md` section placement. Merge whichever lands second by hand; neither plan depends on the other's ordering.
- **Pool rows carrying stale cells across the re-bind.** `Body.setStore` re-renders before the cell set is re-synced. Mitigation: `bindView` calls `setColumns` after `setStore`, which is the call that runs `syncPoolCells`; keep that order.
- **Transient selection events during the re-bind.** `_body.selectRecord(null)` inside `bindView` fires the body's `"selection"`. Mitigation: `_suppressSelectionForward` gates the forwarder for the duration of `bindView`.
- **`_focusedColIndex` left past the end.** Rotating from a wide table can leave the body's focused column index at, say, 30 with only 2 columns. The existing `_updateFocusStyle` guards on a missing cell, and the next ArrowLeft/Right clamps it; no change needed, but do not assert a focus ring position immediately after a mode switch.
- **`MemoryStore.loadData` can defer its `'load'` emit** when the view build offloads to a worker. A 45-row projection is far below that threshold, so the rebuild is synchronous in practice; do not write a test that depends on `loadData` being asynchronous.

---

## Critical Files

| File | Why the implementer must read it |
|---|---|
| `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` (lines 280–440) | The mode-setter precedent this plan mirrors: typed mode union, `getMode`/`setMode`, no built-in toggle chrome. |
| `packages/lib/src/typescript/PropertyGridPanel.ts` | The shipped key/value grid built on `cellType` / `cellValues`; the rotated spec is the same shape. |
| `packages/lib/src/typescript/lib/component/table/Table.ts` | Host of the change; `setStore` (line 276) is the re-bind sequence `bindView` generalises. |
| `packages/lib/src/typescript/lib/component/table/Body.ts` | `setStore` / `setColumns` / `setColumnConfigs` / `setRowReadOnly` ordering, and `bindStore` (line 215) as the store-subscription pattern to copy. |
| `packages/lib/src/typescript/lib/component/table/Header.ts` | Where `setStore` is added; `handleSortClick` (line 589) shows why the store reference must be swappable. |
| `packages/lib/src/typescript/lib/component/table/cell/Dynamic.ts` | How `cellType` selects a renderer per record, and which variants exist. |
| `packages/lib/src/typescript/lib/component/table/ColumnConfig.ts` | The purity/O(1) contract the two resolvers must honour. |
| `packages/lib/src/typescript/lib/layout/Table.ts` | Why clearing `_columnWidths` is what re-initialises widths (line 108). |
| `packages/lib/tests/component/table/Table.test.ts` | The offline-DOM harness preamble the new test file copies. |

---

## Non-Goals

- **Editing in rotated mode.** Read-only by design; no write-back path from the projection record to the source record.
- **Multiple records side by side.** One record at a time. A record-per-column variant would need a projection whose column count varies with the record count, which the two-column model does not express.
- **Stepper, toggle, or any other chrome on `Table` or `TablePanel`.** Consumer-wired, per the `MarkdownEditor` precedent; the demo panel is the worked example.
- **Preserving manually dragged column widths across a mode round trip.** `bindView` clears both width caches; widths re-initialise from the width model on each switch.
- **Rotated mode on `TreeTable`.** It inherits the setter mechanically, but hierarchy has no meaning in a single-record view; it is untested and undocumented for `TreeTable`.
- **Bumping `packages/lib/package.json` to `0.3.0`.** That belongs to the release, not to this feature.

---

## Notes

[^projection]: Three shapes were considered. (a) A new `RotatedBody extends VirtualRowView` with its own row type — roughly 400 lines re-implementing pooling, geometry, keyboard navigation and cell layout that `Body` already owns. (b) A standalone sibling component owning an inner `Table` — avoids all changes to `Table.ts` and so avoids the parked branch entirely, but contradicts the requested scope and leaves two components a consumer must choose between for the same data. (c) The projection store, chosen here: the rotated view *is* a two-column table over derived records, so the existing pipeline needs no new class at all. The cost is that `Table` briefly holds two stores, which is contained by keeping `_store` permanently the source store and never exposing the projection store publicly.

[^mode-precedent]: `MarkdownEditor` is the closest structural match in the codebase: one component, two presentations of the same value, a typed string-union mode, a `setMode` that swaps the surface, and a getter reading the cached mode. `TreeTable` was the other candidate precedent — a `Table` subclass swapping its body via `bodyFactory` — but a subclass fixes the presentation at construction, and this feature must toggle at runtime on an existing instance. `Tab`'s `TabWidthMode` and `BoxLayout`'s `BoxMode` confirm `"a" | "b"` string unions are the house style for mode types, not enums.

[^dynamic-cell]: The `cell/` renderers are keyed by `FieldType` but are **not** column-aware: a `Cell` receives its geometry from the host and its value through `setValue`, and knows nothing about which column it sits in ([cell/Cell.ts:33](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L33)). That is what makes them reusable unchanged in a key/value layout. The only wrinkle is that a *column* normally picks one renderer for all its rows, while the rotated `value` column needs a different renderer per row — which is exactly what `DynamicCell` and `ColumnConfig.cellType` exist for, already shipped and demoed.

[^header-store]: The header keeps its own store reference because sort state lives on the store, not on the table. `Table.setStore` swaps the body's store and the header's *model* but never the header's store — so a table whose store is replaced today still sorts the old store when a header is clicked. Adding the setter fixes that latent bug and is what makes rotated-mode sorting act on the projection. Sorting the projection reorders the field rows (alphabetically by field name, or by value); that is a reasonable meaning for "sort" when rows are fields, and it is free.

[^selection]: A second "which record is shown" concept was considered and rejected: a `setRotatedRecord` / `getRotatedRecord` pair independent of selection. It would have left two pointers to reconcile — what happens when a consumer selects one record and rotates to another — and would have made `getSelectedRecord()` return a projection record while rotated, handing consumers an object whose fields are `field` and `value` instead of their own schema. Folding the two into one keeps every existing selection call site meaningful in both modes: `selectRecord` still means "show me this record", and the `"selection"` event still carries source records only.

[^read-only]: Write-back would be: intercept the projection store's `datachange`, map the projection record back to its source field via `_fieldByRotatedRecord`, write the source record, and suppress the resulting source-store event so the in-flight editor is not destroyed by a projection rebuild. That is a bidirectional sync with a guard flag and a re-entrancy trap of the kind that has bitten this codebase before (see `Cell.setReadOnly`'s inlined commit, which exists precisely to break such a loop). It is deferred rather than rejected; the seam is the projection store's `datachange`.

[^no-options-bag]: The typed-setter rules require consumer-configurable properties to appear on the `XOptions` bag. `TableOptions` is not a consumer surface: `Table`'s constructor is positional (`store`, `spec`, `bodyFactory`) and passes only `{ tag: "table" }` to `super`, so nothing a consumer writes ever reaches `_options`. Adding a `displayMode` field there would be dead. Furthermore the setter reads `_store`, `_header` and `_body`, none of which exist during the `super()` cascade in which `applyOptions` runs — dispatching it from `applyOptions` would throw. So the mode lives in a private backing field, which is what the same rules prescribe for anything not construction-configurable.

[^width-models]: `master`'s `initializeWidths` gives every `string`/`auto` column an equal share of the container; the parked `feature/table-many-column-scaling` branch instead measures content and shares out only the slack. Two flexible columns with a `minWidth` floor and no `maxWidth` fill the container under both: equal halves under the first, measured-plus-equal-slack under the second. Declaring a `maxWidth` on the `field` column would break this — under either model the capped column's surrendered pixels are not redistributed, leaving dead space on the right edge. The user can still narrow the field column by dragging the header divider.
