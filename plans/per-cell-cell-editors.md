# Per-Cell Cell Editors — Implementation Plan

## Overview

Today the table resolves a single renderer + editor **variant per column**: `Row.createCellForField` maps a column to exactly one `Cell` subclass from the column's custom `renderer`, its `values` (combo), or the field's `FieldType` ([`Row.ts:390`](src/typescript/lib/component/table/Row.ts#L390)). That cell instance is then reused for every row bound to its pool slot — only its *value* changes on rebind ([`Row.ts:157`](src/typescript/lib/component/table/Row.ts#L157)). The one per-cell (per-record) hook that exists today is `cellReadOnly` ([`ColumnConfig.ts:112`](src/typescript/lib/component/table/ColumnConfig.ts#L112)); renderer and editor selection stay column-wide. This asymmetry is the crux.

This plan makes the renderer **and** editor resolvable per record, driven from the row's data, while leaving every existing column-level path byte-for-byte unchanged. The driving consumer is a **Property/Value grid** whose single `value` column must render a checkbox in the "Cycle" row, a combo (with row-specific options) in the "Owner" and "Data-type" rows, and an integer input in the numeric rows — impossible today without a form or a toolbar-checkbox workaround.

The mechanism is a new `DynamicCell` ([`component/table/cell/Dynamic.ts`](src/typescript/lib/component/table/cell/Dynamic.ts), new) that lives for the life of its pool slot (keeping the body's geometry cache, editor-pool wiring, commit wiring, read-only, and focus state all valid) and swaps its **active renderer** and **editor pool-key** per record. It is triggered by a new `ColumnConfig.cellType?: (record) => CellType` hook, paired with `ColumnConfig.cellValues?: (record) => …` for per-row combo options. Per-row combo options flow through two new reconfiguration methods, `ComboRenderer.setOptions` / `ComboEditor.setOptions`, so a single pooled combo editor per column serves every combo row.

This repo uses `plans/` at the repo root (already populated with prior plans); this file lives there.

---

## Architecture Decisions

### One stable `DynamicCell` per slot that swaps its renderer — not per-rebind cell replacement

Two designs can produce heterogeneous cells:

1. **Replace the whole `Cell` instance** in the pool slot whenever the resolved type changes between the previously-bound and newly-bound record. Rejected: the body caches per-slot × per-column geometry in `_cellGeom` ([`Body.ts:118`](src/typescript/lib/component/table/Body.ts#L118), consumed at [`Body.ts:779`](src/typescript/lib/component/table/Body.ts#L779)), and each cell carries editor-pool wiring, scroll-into-view wiring, `on("commit")` write-back, read-only state, group tint, and focus styles ([`Body.ts:186`](src/typescript/lib/component/table/Body.ts#L186), [`Row.ts:73`](src/typescript/lib/component/table/Row.ts#L73)). Swapping the instance mid-pool forces all of that to be re-threaded on every type change — high-inference and fragile.

2. **Keep one cell per slot; swap its inner renderer + editor key per record.** Chosen. The cell identity per slot never changes, so every body cache and every wiring stay valid. Only the inner renderer (a cached instance per resolved type) and the string returned by `getEditorKey()` vary. All new complexity is contained in one class.

`Cell` already demonstrates in-place renderer swapping via `wrapRenderer` ([`Cell.ts:499`](src/typescript/lib/component/table/cell/Cell.ts#L499)) and already exposes `getEditorKey()` as the per-cell editor-selection seam ([`Cell.ts:118`](src/typescript/lib/component/table/cell/Cell.ts#L118)), so this design extends existing seams rather than inventing new ones.

### Public API: a `cellType` resolver over the built-in variants, plus `cellValues` for combos

The public hook is `cellType?: (record: ModelRecord) => CellType | null`, where `CellType = FieldType | 'combo'`. It returns which built-in cell variant to use for that row (`'boolean'`, `'number'`, `'string'`, `'date'`, `'time'`, `'datetime'`, `'glyph'`, `'combo'`), or `null`/absent to fall back to the column's field-type-driven cell. This covers the entire driving use case declaratively and is fully backward compatible.

Rejected alternative — a lower-level `cellEditor?: (record) => string | CellEditorFactory` + `cellRenderer?: (record) => CellRenderer` pair: more flexible but pushes editor **and** renderer construction onto the consumer for the common case (the driving consumer only wants built-in checkbox / combo / number cells). `cellType` returns the built-in variant and the library supplies both halves. A factory-returning hook can be added later *without* breaking `cellType` (it would be a separate resolution branch), so it is a Non-Goal here.

Combos need per-row options; `cellValues?: (record) => Array<ComboOption | string> | undefined` supplies them, consulted only when `cellType` yields `'combo'`. `cellType` is the single trigger for `DynamicCell`; `cellValues` is auxiliary.

### Per-cell keys still pool correctly because options are injected at edit time, not encoded in the key

`CellEditorPool` caches one editor per key string ([`CellEditorPool.ts:86`](src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L86)). `DynamicCell.getEditorKey()` returns a **bounded** set of keys: the built-in keys (`"string"`, `"number"`, `"date"`, `"time"[:seconds]`, `"datetime"[:seconds]`) already seeded on the pool ([`CellEditorPool.ts:52`](src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L52)), plus one `combo:<field>` key per column (the same namespacing `ComboCell` uses, [`Combo.ts:47`](src/typescript/lib/component/table/cell/Combo.ts#L47)). Because the key set is finite, each distinct key caches exactly one editor — pooling is unchanged.

The subtlety is per-**row** combo options: two combo rows in the *same* column (Owner options vs Data-type options) must share one pooled `combo:<field>` editor. Encoding the option set into the key (hashing the array) would fragment the pool and is rejected. Instead the pooled combo editor is **reconfigured with the current row's options at edit time** via a new `Cell.prepareEditor` hook (see below) calling `ComboEditor.setOptions`. Only one cell edits at a time, so reconfiguring the shared editor per edit is safe. The combo *renderer* is reconfigured per bind the same way (`ComboRenderer.setOptions`).

### Two minimal base-`Cell` seams: `setActiveRenderer` and `prepareEditor`

`DynamicCell` needs to (a) swap which cached renderer is the Card's visible layer and the commit target, and (b) inject per-row combo options into the pooled editor before it opens. `_renderer` is `private` on `Cell` ([`Cell.ts:37`](src/typescript/lib/component/table/cell/Cell.ts#L37)), so two `protected` methods are added:

- `protected setActiveRenderer(renderer, isNewChild)` — when `isNewChild`, `addComponent(renderer)` and wire its `dblclick → startEdit` (the same wiring the constructor does at [`Cell.ts:88`](src/typescript/lib/component/table/cell/Cell.ts#L88), under the ARCHITECTURE cell-editor carve-out); then set `_renderer = renderer` and make it the Card's visible component.
- `protected prepareEditor(editor)` — default no-op; `startEdit` calls it after acquiring the editor and **before** `editor.setValue(...)` ([`Cell.ts:346`](src/typescript/lib/component/table/cell/Cell.ts#L346)). `DynamicCell` overrides it to push the current row's combo options into the shared `ComboEditor`.

Both are internal (not part of the documented public API), so they add no doc surface and don't trip the "no `{@link}` to internal symbols" rule.

### Boolean rows reuse the checkbox-as-renderer pattern

`BooleanCell` has no edit cycle: it places a `BooleanEditor` (checkbox) in the **renderer** slot, commits on the checkbox's `change` event, and toggles on activation ([`Boolean.ts`](src/typescript/lib/component/table/cell/Boolean.ts)). `CellEditor` and `CellRenderer` are deliberately kept structurally compatible for exactly this reason ([`renderer/CellRenderer.ts:22`](src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L22)). `DynamicCell` reuses this: for a `'boolean'` row the cached "renderer" is a `BooleanEditor`; `DynamicCell` wires its `change → emit("commit", value)` once on creation, overrides `startEdit` to toggle the checkbox (like `Boolean.ts` startEdit), and overrides `setReadOnly` to disable the checkbox when boolean is the active variant.

### Heterogeneous columns must use field type `auto` to avoid coercion

On commit, `Row`'s handler calls `record.set(field, value)` ([`Row.ts:75`](src/typescript/lib/component/table/Row.ts#L75)), which runs `Field.convertValue` ([`ModelRecord.ts:312`](src/typescript/lib/data/ModelRecord.ts#L312), [`Field.ts:137`](src/typescript/lib/data/Field.ts#L137)). A `boolean`/`number`/`string` field type coerces every write to that one type; only `'auto'` (the default) passes values through unchanged ([`Field.ts:184`](src/typescript/lib/data/Field.ts#L184) default branch). A column whose rows commit heterogeneous native types (bool in one row, number in another) MUST declare the field as `'auto'`, or a boolean would be coerced to `"true"` etc. This is documented guidance, not enforced.

### Backward compatibility

`cellType` absent ⇒ `Row.createCellForField` never constructs a `DynamicCell` ⇒ every existing consumer (`renderer`, `values`, field-type cells) is untouched. `setActiveRenderer`/`prepareEditor` are additive; `prepareEditor`'s default is a no-op so the existing `startEdit` behaviour is identical for all current cells. `ComboRenderer`/`ComboEditor` gain a `setOptions` method but their constructors are unchanged.

---

## Public API

New exported type and hooks in [`ColumnConfig.ts`](src/typescript/lib/component/table/ColumnConfig.ts):

```typescript
/** The cell variant a per-cell resolver may select. Extends FieldType with 'combo'. */
export type CellType = FieldType | 'combo';

export interface ColumnConfig {
    // ... existing fields unchanged ...

    /**
     * Per-cell (per-record) variant resolver. Returns which built-in cell type to
     * render/edit for THIS row's cell, or null to fall back to the column's
     * field-type-driven cell. Its presence switches the column onto a DynamicCell.
     * Must be O(1) and pure (fires on every rebind), like cellReadOnly.
     */
    cellType   ?: (record: ModelRecord) => CellType | null;

    /**
     * Per-cell combo options, consulted only when cellType returns 'combo' for
     * the record. Each entry is a plain string or a ComboOption. Absent/empty
     * yields an empty dropdown.
     */
    cellValues ?: (record: ModelRecord) => Array<ComboOption | string> | undefined;
}
```

New class [`DynamicCell`](src/typescript/lib/component/table/cell/Dynamic.ts), extending `Cell<any>`:

```typescript
class DynamicCell extends Cell<any> {
    constructor(field: string, columnType: FieldType, config: ColumnConfig);

    /** Resolves the variant for `record`, swaps to the matching cached renderer,
     *  sets combo options + value, and records the active variant for getEditorKey. */
    bindRecord(record: ModelRecord): void;

    getEditorKey(): string | null;          // key for the active variant
    startEdit(): void;                       // toggles checkbox when boolean-active, else super
    setReadOnly(value: boolean): this;       // also disables the checkbox when boolean-active
    protected prepareEditor(editor: CellEditor<any>): void; // pushes combo options
}
// exported via callable() as `DynamicCell`, like every other cell.
```

New reconfiguration methods:

```typescript
class ComboRenderer /* ... */ {
    /** Rebuilds the value→label map from a new option set and re-renders the cached value. */
    setOptions(optionList: Array<ComboOption | string>): this;
}
class ComboEditor /* ... */ {
    /** Rebuilds the dropdown items from a new option set, preserving the cached value. */
    setOptions(optionList: Array<ComboOption | string>): this;
}
```

New `protected` seams on `Cell<T>` (internal, undocumented):

```typescript
protected setActiveRenderer(renderer: CellRenderer<T>, isNewChild: boolean): void;
protected prepareEditor(editor: CellEditor<T>): void;   // default: no-op
```

Barrel: export `DynamicCell` and the `CellType` type from [`component/table/index.ts`](src/typescript/lib/component/table/index.ts).

---

## Internal Structure

### `DynamicCell` state

```typescript
private _field:       string;
private _columnType:  FieldType;                       // fallback when cellType returns null
private _showSeconds: boolean;                          // from config, for time/datetime keys
private _cellType:    ((r: ModelRecord) => CellType | null) | undefined;
private _cellValues:  ((r: ModelRecord) => Array<ComboOption | string> | undefined) | undefined;
private _renderers:   Map<CellType, CellRenderer<any>> = new Map();  // cached per variant
private _activeType:  CellType = 'string';
private _currentOptions: Array<ComboOption | string> = [];
private _checkbox:    BooleanEditor | null = null;      // lazily built for boolean rows
```

Constructor passes a placeholder `StringRenderer` to `super("td", …)` (so the base wires the initial Card child + dblclick), then seeds `_renderers.set('string', thatRenderer)`.

### `bindRecord`

```typescript
bindRecord(record) {
    const resolved = this._cellType?.(record) ?? this._columnType;
    this._activeType = resolved;

    if (resolved === 'boolean') {
        const cb = this.ensureCheckbox();               // builds + wires change→emit("commit") once
        this.setActiveRenderer(cb as unknown as CellRenderer<any>, this._justCreated);
        cb.setValue(record.get(this._field));
        return;
    }
    if (resolved === 'combo') {
        this._currentOptions = this._cellValues?.(record) ?? [];
        const r = this.ensureRenderer('combo') as ComboRenderer;
        r.setOptions(this._currentOptions);
        this.setActiveRenderer(r, this._justCreated);
        r.setValue(record.get(this._field));
        return;
    }
    const r = this.ensureRenderer(resolved);            // string/number/date/time/datetime/glyph
    this.setActiveRenderer(r, this._justCreated);
    r.setValue(record.get(this._field));
}
```

`ensureRenderer(type)` returns the cached renderer or lazily constructs it (`StringRenderer`, `NumberRenderer`, `DateRenderer`, `TimeRenderer(showSeconds)`, `DateTimeRenderer(showSeconds)`, `GlyphRenderer`, `ComboRenderer([])`) and stores it; `_justCreated` communicates the isNewChild flag to `setActiveRenderer`. `glyph` and any unknown type fall back to `StringRenderer` behaviour and a `null` editor key.

### `getEditorKey`

```typescript
getEditorKey() {
    switch (this._activeType) {
        case 'number':   return 'number';
        case 'date':     return 'date';
        case 'time':     return this._showSeconds ? 'time:seconds'     : 'time';
        case 'datetime': return this._showSeconds ? 'datetime:seconds' : 'datetime';
        case 'combo':    return `combo:${this._field}`;
        case 'boolean':
        case 'glyph':    return null;                   // no pooled editor
        default:         return 'string';               // 'string' | 'auto'
    }
}
```

### `prepareEditor`

```typescript
protected prepareEditor(editor) {
    if (this._activeType === 'combo') {
        (editor as ComboEditor).setOptions(this._currentOptions);
    }
}
```

### Base `Cell.setActiveRenderer`

```typescript
protected setActiveRenderer(renderer, isNewChild) {
    if (isNewChild) {
        this.addComponent(renderer);
        // Internal cell-editor wiring: listens on a privately-owned child;
        // see the cell-editor carve-out in ARCHITECTURE.md.
        Event.addListener(renderer, 'dblclick', () => this.startEdit());
    }
    this._renderer = renderer;
    this.getLayoutManager().setVisibleComponentId(renderer.getId());
}
```

### Base `Cell.startEdit` change

Insert `this.prepareEditor(editor);` immediately before `editor.setValue(renderer.getValue());` at [`Cell.ts:346`](src/typescript/lib/component/table/cell/Cell.ts#L346). Add the no-op `protected prepareEditor(_editor: CellEditor<T>): void {}` method.

### Body: register a per-column combo editor for per-cell combo columns

`registerComboEditors` ([`Body.ts:510`](src/typescript/lib/component/table/Body.ts#L510)) currently registers `combo:<field>` only for columns with column-level `values`. Extend it to also register `combo:<field> → () => new ComboEditor([])` when `config.cellValues` is defined (options are injected per edit by `prepareEditor`, so an empty seed is fine).

### Row: construct `DynamicCell` and bind by record

`createCellForField` ([`Row.ts:390`](src/typescript/lib/component/table/Row.ts#L390)) gains a branch **after** the `renderer` check and **before** the `values` check:

```typescript
if (config?.cellType) {
    return new DynamicCell(field.getName(), field.getType(), config);
}
```

Resolution precedence becomes: `renderer` (display-only) > `cellType` (per-cell) > `values` (column combo) > field type.

Add a private `Row.bindCell(cell, record, fieldName)` that routes record-aware cells:

```typescript
private bindCell(cell: Cell<any>, record: ModelRecord | undefined, fieldName: string): void {
    if (cell instanceof DynamicCell && record) {
        cell.bindRecord(record);
    } else {
        cell.setValue(record ? record.get(fieldName) : undefined);
    }
}
```

Route the three value-set sites through it: the constructor's initial `cell.setValue(value)` ([`Row.ts:72`](src/typescript/lib/component/table/Row.ts#L72)), the `setData` loop's `cells[i].setValue(...)` ([`Row.ts:164`](src/typescript/lib/component/table/Row.ts#L164)), and `syncCells`' initial set ([`Row.ts:362`](src/typescript/lib/component/table/Row.ts#L362)).

Add a `wantsDynamic` guard in `syncCells` mirroring the existing `wantsCombo` guard ([`Row.ts:317`](src/typescript/lib/component/table/Row.ts#L317)): a surviving cell must be rebuilt when `(!!config?.cellType) !== (cell instanceof DynamicCell)`.

---

## Ordered Implementation Steps

1. **`ColumnConfig.ts`** — add `import type { FieldType } from "~/data/Field.js";`; export `type CellType = FieldType | 'combo';`; add `cellType` and `cellValues` fields to `ColumnConfig` with the JSDoc from *Public API*. Check: `npm run typecheck`.

2. **`renderer/Combo.ts`** — add `setOptions(optionList)`: rebuild `this._map` from `normalizeComboOptions(optionList)`, then re-render by calling `this.setValue(this._value)` so the label for the cached value refreshes. Return `this`.

3. **`editor/Combo.ts`** — add `setOptions(optionList)`: rebuild the `SelectableListItem[]` from `normalizeComboOptions(optionList)`, call `this._combo.setItems(items)`, then re-apply `this._combo.setValue(this._value === null ? "" : String(this._value))` so the current selection survives. Return `this`.

4. **`cell/Cell.ts`** — (a) add `protected prepareEditor(_editor: CellEditor<T>): void {}`; (b) call `this.prepareEditor(editor);` immediately before `editor.setValue(renderer.getValue());` in `startEdit` ([`Cell.ts:346`](src/typescript/lib/component/table/cell/Cell.ts#L346)); (c) add `protected setActiveRenderer(renderer, isNewChild)` per *Internal Structure*. Check: `npm run typecheck`.

5. **`cell/Dynamic.ts`** (new) — implement `DynamicCell` per *Public API* + *Internal Structure*: state fields, constructor (placeholder `StringRenderer`, seed cache), `ensureRenderer`, `ensureCheckbox` (build `BooleanEditor`, wire `change → this.emitCommit`), `bindRecord`, `getEditorKey`, `startEdit` (boolean toggle vs `super.startEdit()`), `setReadOnly` (super + checkbox when boolean-active), `prepareEditor`. Wrap in `callable()` and export as `DynamicCell`, mirroring [`Combo.ts`](src/typescript/lib/component/table/cell/Combo.ts). Emit commit via a small `private emitCommit(v) { this.emit("commit", v); }` (or reuse the base commit path). Check: `npm run typecheck`.

6. **`Row.ts`** — import `DynamicCell`; add the `cellType` branch to `createCellForField`; add `bindCell` and route the three value-set sites through it; add the `wantsDynamic` rebuild guard in `syncCells`. Check: `npm run typecheck`.

7. **`Body.ts`** — extend `registerComboEditors` to also register `combo:<field>` when `config.cellValues` is defined. Check: `npm run typecheck`.

8. **`component/table/index.ts`** — `export { DynamicCell } from '~/component/table/cell/Dynamic.js';` and `export type { CellType } from '~/component/table/ColumnConfig.js';`.

9. **Tests** — add `tests/component/table/cell/DynamicCell.test.ts` and extend `tests/component/table/cell/CellEditorPool.test.ts` per *Expected Behaviour*. Model the offline harness on [`CustomRenderer.test.ts`](tests/component/table/CustomRenderer.test.ts) (constructs a `Row` from a `Model` + `MemoryStore` and inspects cells by field) and [`CellEditorPool.test.ts`](tests/component/table/cell/CellEditorPool.test.ts).

10. **Docs** — see *Documentation Impact*.

11. Run the full *Verification* suite.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/table/cell/Dynamic.ts` |
| Create | `tests/component/table/cell/DynamicCell.test.ts` |
| Modify | `src/typescript/lib/component/table/ColumnConfig.ts` (add `CellType`, `cellType`, `cellValues`) |
| Modify | `src/typescript/lib/component/table/cell/Cell.ts` (`setActiveRenderer`, `prepareEditor`, `startEdit` call) |
| Modify | `src/typescript/lib/component/table/cell/renderer/Combo.ts` (`setOptions`) |
| Modify | `src/typescript/lib/component/table/cell/editor/Combo.ts` (`setOptions`) |
| Modify | `src/typescript/lib/component/table/Row.ts` (`createCellForField` branch, `bindCell`, `syncCells` guard) |
| Modify | `src/typescript/lib/component/table/Body.ts` (`registerComboEditors`) |
| Modify | `src/typescript/lib/component/table/index.ts` (barrel exports) |
| Modify | `tests/component/table/cell/CellEditorPool.test.ts` (combo-key coverage) |
| Modify | `docs/components/Table.md` (ColumnConfig table row + "Per-cell cell types" section) |
| Modify | `scripts/llms/manifest.data.mjs` (if a capability line is warranted) |

---

## Expected Behaviour

Unit-testable offline (construct a `Row`/`DynamicCell` from a `Model` + `MemoryStore`, inspect cells and pool — the harness cannot open editors or move focus):

1. **Variant selection.** A column with `cellType: r => r.get('kind')` mapping records to `'boolean' | 'number' | 'combo'` produces, for three records, a `DynamicCell` whose active renderer after `bindRecord` is a `BooleanEditor`, a `NumberRenderer`, and a `ComboRenderer` respectively. *(unit)*
2. **Editor keys.** For those same records, `getEditorKey()` returns `null` (boolean), `"number"`, and `` `combo:${field}` `` respectively. *(unit)*
3. **Backward compatibility.** A column with no `cellType` yields the same cell classes as today (`StringCell`, `NumberCell`, `ComboCell` when `values` present, etc.) — assert `Row.createCellForField` output is unchanged for the existing config shapes. *(unit)*
4. **Fallback.** `cellType` returning `null` for a record makes `bindRecord` resolve to the column's declared field type (e.g. a `number` column renders a `NumberRenderer`). *(unit)*
5. **Per-row combo options.** Two combo records with different `cellValues` produce a `ComboRenderer` whose displayed label matches each row's option set (via `setOptions`), and the pool holds exactly one editor under `combo:<field>`. *(unit — the renderer label + pool identity; the dropdown open is manual)*
6. **`ComboRenderer.setOptions` / `ComboEditor.setOptions`.** After `setOptions`, `getValue()` is unchanged and a value present in the new set renders its new label; the editor's items reflect the new set. *(unit)*
7. **Slot reuse / renderer swap.** Binding one `DynamicCell` to record A (`'boolean'`) then rebinding to record B (`'number'`) swaps the active renderer and shows B's value, with A's renderer retained (cached) as a hidden Card child. *(unit)*
8. **Commit write-back.** With an `auto` field: a number `DynamicCell` committing writes the number to the record; a boolean `DynamicCell` toggle writes the boolean. Assert `record.get(field)` type + value. *(unit for the write path via the cell's `commit` emit; the actual toggle gesture is manual)*
9. **Read-only union.** `Body.applyReadOnlyState` marking a `DynamicCell` read-only disables the checkbox on a boolean-active cell (`isReadOnly()` true and the checkbox rejects toggles). *(unit for the flag; visual tint is manual)*
10. **Pool built-in keys.** `CellEditorPool` still maps every built-in key to its editor class, and a registered `combo:<field>` returns a `ComboEditor`. *(unit — extend `CellEditorPool.test.ts`)*

Manual / visual (needs a live, focusable, connected DOM the offline harness lacks — mirror the harness gaps noted in [`CellEditorPool.test.ts`](tests/component/table/cell/CellEditorPool.test.ts)):

- Double-clicking a numeric row opens the number editor; a combo row opens the dropdown with the row-specific options; blur/Enter commits, Escape cancels.
- Clicking a checkbox row toggles and commits immediately without an edit cycle; a read-only checkbox rejects the toggle.
- Scrolling a large grid reuses pool slots without visual glitches as renderer variants change per row.
- The driving Property/Value grid renders checkbox / Owner-combo / Data-type-combo / integer rows in the single value column, each editing into the same field.

---

## Verification

- `npm run typecheck` — library type-check (`tsconfig.lib.json`, `--noEmit`).
- `npm run test` — `typecheck:test` + `vitest run`; must include the new `DynamicCell.test.ts` and the extended `CellEditorPool.test.ts`, all green.
- `npm run lint` — ESLint (respect the DOM-access and forward-super-options rules; the new `dblclick` wiring must carry the carve-out comment).
- `npm run build:lib` — full library build the app consumes (`tsc` + `tsc-alias` + `vite build`).
- `npm run docs:llms` — regenerates `llms.txt` from `scripts/llms/manifest.data.mjs`; run after editing the manifest and commit the regenerated `llms.txt`. Confirm the new per-cell capability appears in `llms.txt` and that the file's generated header is intact (it was not hand-edited).
- `npm run docs:build` — TypeDoc + VitePress (also runs `docs:api` and `docs:llms`); **must finish with zero warnings** (per CODE_CONVENTIONS: public JSDoc may only `{@link}` documented symbols — `DynamicCell`, `CellType`, `ColumnConfig` are all exported, so links between them are safe; do not `{@link}` `setActiveRenderer`/`prepareEditor`).
- Grep invariants:
  - `grep -rn 'cellType' src/typescript/lib/component/table/` — appears in `ColumnConfig.ts`, `Row.ts` only (not leaking elsewhere).
  - `grep -rn 'setActiveRenderer\|prepareEditor' src/typescript/lib/component/table/cell/` — defined in `Cell.ts`, used in `Dynamic.ts`.
- Manual smoke: run the demo/app table screen; exercise the manual/visual cases above.

---

## Documentation Impact

- **Barrel / export surface:** `DynamicCell` and `CellType` are re-exported from `component/table/index.ts`; TypeDoc auto-documents them from their JSDoc. Give `DynamicCell` a `@category Components` tag and `CellType` a `@category Components` (or `Data`) tag to match siblings.
- **`ColumnConfig` JSDoc:** the `cellType` / `cellValues` field comments render on the `ColumnConfig` interface page automatically; keep them O(1)/pure-worded like `cellReadOnly` ([`ColumnConfig.ts:112`](src/typescript/lib/component/table/ColumnConfig.ts#L112)).
- **`docs/components/Table.md`:** add two `ColumnConfig` rows to the table at [`Table.md:43`](docs/components/Table.md#L43) (after the `values` row at line 52), and a new `## Per-cell cell types` section after `## Combo columns` ([`Table.md:63`](docs/components/Table.md#L63)) showing the Property/Value example, the `auto` field-type requirement, and the pooling note. Update `## See also` if a new API link is warranted. This is the human-facing docs page; its rendered TypeDoc API surface (`ColumnConfig`, `DynamicCell`, `CellType`, `ComboEditor`/`ComboRenderer` with the new `setOptions`) is generated by `npm run docs:api` from the JSDoc, so no hand-edited API page is needed — only the JSDoc must be complete.
- **Generated `llms.txt` — must be regenerated, never hand-edited.** `llms.txt` at the repo root carries the header `<!-- GENERATED by scripts/llms/generate.mjs from scripts/llms/manifest.data.mjs — do not edit by hand -->`. This plan adds a new **public capability** (the per-cell editor/renderer hooks on `ColumnConfig` — `cellType`/`cellValues` — plus `ComboEditor.setOptions` / `ComboRenderer.setOptions`), so the manifest source must be updated and the file regenerated:
  1. Edit [`scripts/llms/manifest.data.mjs`](scripts/llms/manifest.data.mjs) — extend the `Table` capability entry in the "Data / Tables / Trees" group ([manifest line 73](scripts/llms/manifest.data.mjs#L73), `{ task: "Editable data grid / spreadsheet-style table", symbol: "Table" }`) so agents learn per-cell editors exist. Match the entry shape of siblings (`task` / `symbol`, optional `subpath` / `doc` keys as at [manifest lines 110–118](scripts/llms/manifest.data.mjs#L110)); prefer widening the existing Table `task` string (e.g. "…table, with per-column or per-cell editor/renderer types") over adding a duplicate `Table` row, and/or point its `doc` at the new `Table.md` per-cell section.
  2. Regenerate: `npm run docs:llms` (runs `node scripts/llms/generate.mjs`), which rewrites `llms.txt`. Do **not** edit `llms.txt` directly.
- **VitePress sidebar (`docs/.vitepress/config.mts`):** no new page is required (the content extends `Table.md`); only touch `config.mts` if a dedicated recipe page is added, which this plan does not.
- No renames or removals ⇒ no old-name grep sweep needed.

---

## Potential Challenges

- **Structural typing of `BooleanEditor` as a renderer.** `setActiveRenderer` expects `CellRenderer<T>`; a `BooleanEditor` is a `CellEditor`. It is structurally assignable (both extend `Component` with `getValue`/`setValue`), which is the same trick `BooleanCell` relies on — cast at the call site and cite the `renderer/CellRenderer.ts:22` compatibility note.
- **`dblclick` on swapped renderers.** Each new cached renderer must get its own `dblclick → startEdit` wiring inside `setActiveRenderer(isNewChild=true)`; a renderer swapped in without it would be un-editable on double-click. Covered by the `isNewChild` path.
- **Card visibility after swap.** `setVisibleComponentId` must target the newly active renderer; the transient pooled editor is added/removed by `startEdit`/`detachEditor` as today, so no change to that lifecycle.
- **Combo editor reconfigured mid-focus.** `prepareEditor` runs before `editor.setValue`/`focus`, so options are set while the editor is still hidden — safe. Do not call `setOptions` on an already-open editor.
- **`syncCells` cell-kind churn.** The `wantsDynamic` guard must run alongside `wantsCombo` so a config that toggles `cellType` on/off rebuilds the cell; missing it would leave a stale `ComboCell`/typed cell in place.

---

## Critical Files

- [`src/typescript/lib/component/table/cell/Cell.ts`](src/typescript/lib/component/table/cell/Cell.ts) — base cell; `startEdit`/`getEditorKey`/`wrapRenderer` patterns and the new seams.
- [`src/typescript/lib/component/table/cell/Boolean.ts`](src/typescript/lib/component/table/cell/Boolean.ts) — the checkbox-as-renderer + immediate-commit pattern `DynamicCell` reuses for boolean rows.
- [`src/typescript/lib/component/table/cell/Combo.ts`](src/typescript/lib/component/table/cell/Combo.ts) — per-column `combo:<field>` key namespacing to mirror.
- [`src/typescript/lib/component/table/cell/editor/CellEditorPool.ts`](src/typescript/lib/component/table/cell/editor/CellEditorPool.ts) — pooling contract and built-in keys.
- [`src/typescript/lib/component/table/Row.ts`](src/typescript/lib/component/table/Row.ts) — `createCellForField` resolution + bind loop.
- [`src/typescript/lib/component/table/Body.ts`](src/typescript/lib/component/table/Body.ts) — combo-editor registration, per-slot geometry, read-only application.
- [`tests/component/table/CustomRenderer.test.ts`](tests/component/table/CustomRenderer.test.ts) — the offline `Row` test-harness pattern to copy.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — event carve-out (§ "Accepted exception: the cell-editor subsystem"), one-DOM-element-per-class, `super()`-cascade field rules.

---

## Non-Goals

- **Precision-safe (bigint) integer cell.** The library's number cell is JS-`number`-backed: `NumberEditor` parses with `parseFloat` and caps at `Number.MAX_SAFE_INTEGER` ([`editor/Number.ts:41`](src/typescript/lib/component/table/cell/editor/Number.ts#L41)), so integers beyond 2^53 (e.g. `9223372036854775807`) corrupt on round-trip. A string-backed, integer-validated cell/editor is a **separate follow-on plan** — it is an independent editor variant that this feature can later resolve via `cellType` returning its key, so bundling it here would widen scope without shared code. Recommend planning it as `precision-safe-integer-cell.md`.
- **Fully-custom per-cell `cellRenderer` / `cellEditor` factory hooks.** `cellType` covers the built-in variants and the entire driving use case. A factory-returning hook can be added later as an additional resolution branch without breaking `cellType`; deferring keeps the surface small.
- **`DynamicCell` as a `TreeTable` tree column.** The tree column wraps its renderer in a `TreeCellRenderer` on first build ([`Row.ts:105`](src/typescript/lib/component/table/Row.ts#L105)); combining per-bind renderer swapping with tree wrapping is out of scope. A tree column keeps its field-type cell.
- **Enforcing the `auto` field-type requirement.** Heterogeneous columns must declare the field `'auto'`; this is documented, not validated in code.
