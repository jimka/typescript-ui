# Table ComboBox Cell — Implementation Plan

## Overview

Add a **constrained-choice table cell** whose inline editor lets the user pick a value from a fixed enumeration via the existing [`ComboBox`](../src/typescript/lib/component/input/ComboBox.ts), instead of typing a free string. A column opts in by declaring its allowed options on its [`ColumnConfig`](../src/typescript/lib/component/table/ColumnConfig.ts); the table then builds a `ComboCell` for that column regardless of the underlying field type, renders the option's **label** (not its raw stored value) in display mode, and pops the combo dropdown on edit.

The work lives entirely under `src/typescript/lib/component/table/cell/`: a new cell `ComboCell` ([cell/Combo.ts](../src/typescript/lib/component/table/cell/Combo.ts)), renderer `ComboRenderer` ([cell/renderer/Combo.ts](../src/typescript/lib/component/table/cell/renderer/Combo.ts)), and editor `ComboEditor` ([cell/editor/Combo.ts](../src/typescript/lib/component/table/cell/editor/Combo.ts)). It threads one new field (`values`) through `ColumnConfig`, one new branch in [`Row.createCellForField`](../src/typescript/lib/component/table/Row.ts#L373) and the matching branch in [`Row.syncCells`](../src/typescript/lib/component/table/Row.ts#L263), and a per-column factory registration in [`Body.setColumnConfigs`](../src/typescript/lib/component/table/Body.ts#L408). No `Theme.ts` change is required — the editor reuses the existing `--ts-ui-table-cell-editor-border` token.

The combo cell's value is the **option key** (the value stored on the record), typed `String | null`, matching `StringCell`. The renderer maps key → label for display; the editor maps key ↔ combobox selection.

---

## Architecture Decisions

### Opt-in is a `ColumnConfig.values` declaration, not a new field type

The cell-type switch in [`Row.createCellForField`](../src/typescript/lib/component/table/Row.ts#L373) is driven by `field.getType()`. There is no "enum" field type in the data model and adding one would ripple into `Model`, stores, export, and validation for a purely presentational concern. Instead, a column opts in by declaring its option set on its `ColumnConfig` — exactly how `showSeconds` already overrides the time/datetime cell variant per column. When `columnConfigs.get(field.getName())?.values` is present, `createCellForField` returns a `ComboCell` **before** the `field.getType()` switch runs, so any string-typed (or number-typed) column can become a dropdown. This is the most surgical option and mirrors the precedent the docs already teach (the `currency:precision-4` per-column-config note in [docs/recipes/custom-cell.md](../docs/recipes/custom-cell.md#L130)).

### Option shape: `ComboOption` value/label pairs, plain strings as shorthand

`values` is typed `Array<ComboOption | string>` where `ComboOption = { value: string; label?: string }`. A plain string is shorthand for `{ value: s, label: s }`; an object lets the stored value differ from the displayed text (e.g. value `"AU"`, label `"Australia"`). This matches [`ComboBox.setItems`](../src/typescript/lib/component/input/ComboBox.ts#L961), which already accepts `string | { key, label }` — `ComboOption.value` maps to the list's `key`, `ComboOption.label` to its `label`. **Store-backed options are a Non-Goal** (see below): `values` is a static, declarative array. The combobox value is always the option key/value string, so the cell generic is `String | null`, identical to `StringCell` and aligned with the cell stack's "no value is `null`, not `''`" convention.

### A custom renderer is required — display the label, not the stored value

Unlike `StringCell`, a combo cell stores a code (`"AU"`) but must display the human label (`"Australia"`). `StringRenderer` would print the raw code. `ComboRenderer` therefore holds the same value→label map the editor uses, wraps a `Text` (mirroring [`StringRenderer`](../src/typescript/lib/component/table/cell/renderer/String.ts)), and on `setValue(key)` looks the key up in its option map and renders the label; an unknown or `null` key renders blank, and `getValue()` returns the cached **key** (not the label) so the round-trip back to the record stays honest. This is the same value-vs-display split `StringRenderer` already documents for `null` vs `""`.

### Editor wraps `ComboBox` and follows the `DateTimeEditor` picker template

`ComboEditor extends CellEditor<String | null>` and hosts a `ComboBox` exactly as [`DateTimeEditor`](../src/typescript/lib/component/table/cell/editor/DateTime.ts) hosts a `DateTimePickerDropdown`: the combobox's dropdown lives in an overlay layer, so the editor overrides [`retainsFocus`](../src/typescript/lib/component/table/cell/editor/CellEditor.ts#L91) to keep the edit alive while focus sits in the dropdown (`LayerManager.containsAcrossLayers`), and calls [`requestCommit()`](../src/typescript/lib/component/table/cell/editor/CellEditor.ts#L110) when the user picks an option. `ComboBox` already keeps DOM focus on its own surface and forwards keys to the inner list, and its dropdown closes on outside-click — so the editor leans on `ComboBox`'s lifecycle rather than re-implementing key handling. Commit-on-selection: the editor listens to the combobox's `"action"` event, caches the new key, and calls `requestCommit()`. Enter/Escape are handled by the base `Cell.onKeyDown` via the editor's forwarded `keydown`, as with every other editor.

### Per-column pool key `combo:<field>`, factory registered from `Body.setColumnConfigs`

The [`CellEditorPool`](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts) holds **one** editor instance per key and shares it across every cell with that key. A combo editor is not interchangeable across columns — each column has its own option set. So `ComboCell.getEditorKey()` returns `combo:<field>` (the field name namespaced), giving each combo column its own pooled editor. The factory that builds that editor — closing over the column's resolved options — is registered on the pool from [`Body.setColumnConfigs`](../src/typescript/lib/component/table/Body.ts#L408), which is the one place that has both the `_columnConfigs` map and the `_editorPool`. This reuses the documented "encode config into the key" pattern verbatim and adds no new wiring path; `register` is idempotent-by-overwrite, so re-applying configs simply re-registers with the latest options.

### `ComboCell` carries the field name and options; renderer gets the map at construction

`ComboCell`'s constructor takes the field name (for the editor key) and the resolved `ComboOption[]` (to build the `ComboRenderer`'s lookup map). `Row.createCellForField` already has both the `field` and `columnConfigs` in hand, so it passes them straight through — no new plumbing reaches into the cell. The renderer's map and the editor's combobox items are derived from the **same** `ComboOption[]`, so display labels and dropdown labels never drift.

---

## Public API (TypeScript Signatures)

New exported interface on `ColumnConfig.ts`:

```typescript
/** One selectable option for a combo-box column. A plain string in the
 *  `values` array is shorthand for `{ value: s, label: s }`. */
export interface ComboOption {
    /** The value stored on the record and round-tripped by the cell. */
    value:  string;
    /** Display text shown in the cell and dropdown; defaults to `value`. */
    label?: string;
}
```

New field on `ColumnConfig`:

```typescript
export interface ColumnConfig {
    // …existing fields…
    /** When present, this column renders as a constrained-choice (combo-box)
     *  cell regardless of the field's declared type. The inline editor offers
     *  exactly these options; the cell displays each option's label for the
     *  stored value. A plain string entry is shorthand for value === label. */
    values ?: Array<ComboOption | string>;
}
```

New cell (callable-class idiom, exported as `ComboCell`):

```typescript
class ComboCell extends Cell<String | null> {
    constructor(field: string, options: Array<ComboOption | string>);
    getEditorKey(): string;            // returns `combo:${field}`
    setValue(value: String | null): this;
}
```

New renderer:

```typescript
class ComboRenderer extends CellRenderer<String | null> {
    constructor(options: Array<ComboOption | string>);
    getValue(): String | null;         // cached KEY, not label
    setValue(value: String | null): this;  // renders the label for `value`
    getText(): Text;
}
```

New editor:

```typescript
class ComboEditor extends CellEditor<String | null> {
    constructor(options: Array<ComboOption | string>);
    getValue(): String | null;
    setValue(value: String | null): this;
    focus(): this;
    retainsFocus(relatedTarget: Handle | null): boolean;
}
```

All three follow the `export { _X, XCallable as X }` callable idiom used by every sibling cell/renderer/editor. No new DOM property setters are introduced (no `XOptions` field needed) — `values` is a plain config field consumed at cell construction, not a Component option dispatched through `applyOptions`.

---

## Internal Structure

**Option normalisation** (shared helper, defined once, e.g. a small exported `normalizeComboOptions(options)` or duplicated inline in renderer + editor — prefer a tiny module-private function in each since they import different bases; if duplication smells, extract to `cell/ComboOption.ts` alongside the type). Each entry becomes `{ value, label: label ?? value }`. The renderer builds a `Map<string,string>` (value → label); the editor builds the `CustomListItem[]` (`{ key: value, label }`) for `ComboBox.setItems`.

**ComboRenderer.setValue(key)**: cache `key`; `this._text.setText(key == null ? "" : (this._map.get(String(key)) ?? String(key)))` — unknown keys fall back to showing the raw key rather than blanking, so a record holding a value outside the option set is still visible.

**ComboEditor** (modeled on `DateTimeEditor`):
- Constructor: `super("div")` (the combobox is a `<div>` surface, not an `<input>` — so extend `CellEditor` directly, **not** `TextInputCellEditor`); build `ComboBox({ items, dropdownAnimated: false })`; strip its border/radius and apply the cell-editor inset border shadow (`--ts-ui-table-cell-editor-border`) to visually match the other editors; `addComponent(combo)`.
- Wire `combo.on("action", () => { this._value = combo.getValue() || null; this.requestCommit(); })`.
- Forward the combobox's `keydown` up as the `ForwardedKeyDetail` custom event (same shape `StringEditor` forwards) so `Cell.onKeyDown` sees Enter/Escape.
- Forward `blur` up so the pool's blur-commit fires when focus leaves entirely.
- `retainsFocus`: true while the combobox dropdown is open and `relatedTarget` is inside it across layers (mirror `DateTimeEditor.retainsFocus`, querying the combobox's dropdown via a small accessor on `ComboBox` if one is needed — verify whether `ComboBox` exposes its dropdown; if not, rely on `ComboBox` keeping DOM focus on its own surface, in which case focus never actually leaves the editor subtree and a simpler `retainsFocus` suffices — **resolve at implementation time by reading whether the dropdown steals focus**).
- `setValue(key)`: cache, `combo.setValue(key ?? "")`.
- `getValue()`: return cached `_value`.
- `focus()`: focus the combobox surface (`combo.getElement(true)` focus) and open its dropdown so a double-click lands the user straight in the option list.

> Focus note: `ComboBox` is documented to keep DOM focus on its own surface and forward keystrokes into the dropdown without a focus shift ([ComboBox.ts](../src/typescript/lib/component/input/ComboBox.ts#L237-L244)). This means the dropdown does **not** pull focus off the editor, so the blur-to-commit contract is preserved more simply than for `DateTimeEditor` (whose embedded time field *does* take focus). The plan keeps a `retainsFocus` override for safety but the implementer must verify the actual focus path with a live double-click before deciding how defensive it needs to be — this is the one genuinely uncertain interaction.

**Row.createCellForField** gains a pre-switch guard:

```typescript
const cfg = columnConfigs.get(field.getName());
if (cfg?.values) {
    return new ComboCell(field.getName(), cfg.values);
}
switch (field.getType()) { /* …unchanged… */ }
```

The identical guard goes into `Row.syncCells` ([Row.ts:263](../src/typescript/lib/component/table/Row.ts#L263)) where it reconstructs cells on config change, so toggling a column's `values` rebuilds the cell.

**Body.setColumnConfigs** registers a factory per combo column:

```typescript
for (const [field, cfg] of configs) {
    if (cfg.values) {
        this._editorPool.register(`combo:${field}`, () => new ComboEditor(cfg.values!));
    }
}
```

---

## Ordered Implementation Steps

1. **`ColumnConfig.ts`** — add the `ComboOption` interface and the `values` field with JSDoc. → verify: `npx tsc --noEmit` clean.
2. **`cell/renderer/Combo.ts`** — `ComboRenderer` mirroring `StringRenderer`, holding the value→label map, callable export. → verify: unit test (below) for label mapping + key round-trip.
3. **`cell/editor/Combo.ts`** — `ComboEditor extends CellEditor<String | null>` wrapping `ComboBox`, commit-on-action, key/blur forwarding, callable export. → verify: editor unit test (construction + `setValue`/`getValue` round-trip).
4. **`cell/Combo.ts`** — `ComboCell` taking `(field, options)`, building the renderer, returning `combo:${field}` from `getEditorKey`, callable export. → verify: cell unit test (editor key shape, `setValue` delegates to renderer).
5. **`Row.ts`** — add the `cfg.values` pre-switch guard to both `createCellForField` and `syncCells`. Import `ComboCell`. → verify: a `ColumnConfig` with `values` yields a `ComboCell`.
6. **`Body.ts`** — register `combo:<field>` factories in `setColumnConfigs`. → verify: `CellEditorPool.test.ts`-style assertion that the pool returns a `ComboEditor` for `combo:<field>` after configs land.
7. **Barrel** — export `ComboCell`, `ComboRenderer`, `ComboEditor` (and `type ComboOption`) from [`table/index.ts`](../src/typescript/lib/component/table/index.ts). → verify: `grep -n "ComboCell" src/typescript/lib/component/table/index.ts`.
8. **Demo** — add a combo column to the spec table in [`MiscPanel.ts`](../src/typescript/MiscPanel.ts#L448) (e.g. give `Active`-adjacent a "Role" column, or convert an existing string column to `values`). → verify: manual smoke (below).
9. **Docs** — see `## Documentation Impact`. → verify: `npm run docs:build` 0 errors / 0 link warnings.
10. **Regression sweep** — `grep -rn "createCellForField\|getEditorKey" src/typescript/lib/component/table` to confirm no other switch site needs the guard; run the full table cell test suite.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/table/cell/Combo.ts` |
| Create | `src/typescript/lib/component/table/cell/renderer/Combo.ts` |
| Create | `src/typescript/lib/component/table/cell/editor/Combo.ts` |
| Create | `tests/component/table/cell/Combo.test.ts` (or extend `renderer.test.ts` / `editor.test.ts`) |
| Modify | `src/typescript/lib/component/table/ColumnConfig.ts` (add `ComboOption`, `values`) |
| Modify | `src/typescript/lib/component/table/Row.ts` (combo guard in `createCellForField` + `syncCells`) |
| Modify | `src/typescript/lib/component/table/Body.ts` (factory registration in `setColumnConfigs`) |
| Modify | `src/typescript/lib/component/table/index.ts` (barrel exports) |
| Modify | `src/typescript/MiscPanel.ts` (demo combo column) |
| Modify | `docs/components/TableInternals.md`, `docs/recipes/custom-cell.md` or new page, `docs/.vitepress/config.mts`, relevant `index.md` catalog |

---

## Expected Behaviour

**Offline unit-testable** (vitest + `installTestDOM`, the pattern in [CellEditorPool.test.ts](../tests/component/table/cell/CellEditorPool.test.ts) / `renderer.test.ts`):

- `ComboRenderer.setValue("AU")` with options `[{value:"AU",label:"Australia"}]` renders text `"Australia"`; `getValue()` returns `"AU"`.
- `ComboRenderer.setValue(null)` / `undefined` renders `""` and `getValue()` returns `null`.
- `ComboRenderer.setValue("ZZ")` for a key not in the option set renders the raw key `"ZZ"` (fallback, never blanks a present value).
- Plain-string option shorthand: `["Low","High"]` ⇒ `setValue("Low")` renders `"Low"`; value === label.
- `ComboEditor.setValue("AU"); getValue()` round-trips `"AU"`; `setValue(null); getValue()` returns `null`.
- `ComboCell.getEditorKey()` returns `combo:<field>` for the field name passed at construction; two cells with different field names return different keys.
- `ComboCell.setValue(key)` delegates to the renderer (renderer shows the label).
- After `Body.setColumnConfigs` with a `values` column, `body.getEditorPool().acquire("combo:<field>", cell)` returns a `ComboEditor` instance, and re-acquiring returns the **same** instance (pool collapse).
- `Row.createCellForField` returns a `ComboCell` when `columnConfigs` carries `values` for the field, **even when** `field.getType()` is `"string"` or `"number"`; returns the type-driven cell otherwise.

**Requires manual DOM / visual verification** (focus, dropdown overlay, commit lifecycle — the offline harness can't drive a live focusable combobox surface, matching the Non-Goal already stated in `CellEditorPool.test.ts`):

- Double-clicking a combo cell opens the combobox dropdown showing the option labels.
- Picking an option commits the chosen key to the bound `ModelRecord` and returns the cell to display mode showing the new label.
- Enter on a focused option commits; Escape cancels and reverts to the prior value.
- Clicking outside the dropdown commits (or cancels per the established blur-commit contract) and closes the overlay cleanly without double-removal.
- A read-only combo column (`readOnly` / `cellReadOnly` / `rowReadOnly`) refuses the edit — double-click is a no-op and the cell shows the read-only tint.
- The editor's inset border matches the other typed editors under both light and dark themes (theme-toggle smoke).

---

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run tests/component/table` — the new `## Expected Behaviour` unit tests pass alongside existing cell tests.
- `grep -rn "getType()" src/typescript/lib/component/table/Row.ts` — confirm both cell-construction sites carry the combo guard.
- `grep -n "Combo" src/typescript/lib/component/table/index.ts` — barrel exports present.
- **Manual smoke** on the demo: open MiscPanel → "Show window with table spec", double-click the combo column cell, pick an option, confirm the label updates and the record value changes; toggle theme; confirm a read-only row's combo cell refuses edit.
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning).

---

## Documentation Impact

- **Barrel:** `ComboCell`, `ComboRenderer`, `ComboEditor` and `type ComboOption` are re-exported from [`src/typescript/lib/component/table/index.ts`](../src/typescript/lib/component/table/index.ts) (no root barrel). Each gets `@category Components`; verify they land under `docs/api/component/table/` after build (callable classes auto-promote from `variables/` to `classes/` via `typedoc-callable-plugin.mjs`, given the `XCallable as X` export form).
- **Curated page:** extend [`docs/components/TableInternals.md`](../docs/components/TableInternals.md) with a short "Constrained-choice (combo) columns" subsection documenting the `ColumnConfig.values` opt-in and the `combo:<field>` editor key, and add a worked example to [`docs/recipes/custom-cell.md`](../docs/recipes/custom-cell.md) (it already teaches the renderer/editor/pool split and the per-column-key pattern, so the combo cell is a natural built-in counterpart). If a standalone recipe reads cleaner, add `docs/recipes/combo-column.md`, link it in the sidebar (`docs/.vitepress/config.mts`, the Recipes group near the `custom-cell` entry at [config.mts:204](../docs/.vitepress/config.mts#L204)), and list it in `docs/recipes/index.md`.
- **Cross-bucket JSDoc:** `ComboEditor`'s JSDoc references `ComboBox`, which is in a different subpath (`component/input`), so it must use a markdown link `[\`ComboBox\`](/api/component/input/classes/ComboBox)`, not `{@link}` — same rule the other editors follow for cross-bucket references. Do not `{@link}` any `private`/internal symbol from the exported cell/renderer/editor JSDoc.
- **Concept page:** the `ColumnConfig` reference in any concepts page covering column specs gains the `values` field; check `docs/concepts/` and the `ColumnConfig`/`ColumnSpec` example in `ColumnConfig.ts`'s own JSDoc stays consistent.

---

## Potential Challenges

- **Dropdown focus vs blur-commit.** If the combobox dropdown does *not* steal DOM focus (as its JSDoc claims), `retainsFocus` is nearly trivial and the blur-commit just works; if it *does* under some path, `retainsFocus` must mirror `DateTimeEditor` via `LayerManager.containsAcrossLayers` against the combobox's dropdown layer. Mitigation: verify the live focus path with a real double-click before finalising the override; keep the `DateTimeEditor` template handy.
- **Value type mismatch (number-typed fields).** A column over a `number` field declaring string `values` stores the option key as a string on a numerically-typed field. Mitigation: document that `values` keys are strings and the cell round-trips the key verbatim; the record field receives the string key. If numeric round-trip is needed, that is out of scope (Non-Goal).
- **Stale editor after `values` change.** `register` overwrites and drops the cached editor, so re-applying configs with new options rebuilds the editor on next edit. Mitigation: rely on `register`'s documented drop-on-overwrite; covered by the pool test.
- **Editor border styling drift.** The editor must replicate the inset-border shadow the text editors apply so the combo surface reads as an editor, not a stray combobox. Mitigation: copy the exact `setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, …))'` line from `StringEditor`/`DateTimeEditor`.

---

## Critical Files

- [`cell/Cell.ts`](../src/typescript/lib/component/table/cell/Cell.ts) — base lifecycle, `getEditorKey`, `startEdit`/`commitEdit`, the renderer/editor Card swap.
- [`cell/editor/CellEditor.ts`](../src/typescript/lib/component/table/cell/editor/CellEditor.ts) — `retainsFocus`, `requestCommit`, `ForwardedKeyDetail`.
- [`cell/editor/DateTime.ts`](../src/typescript/lib/component/table/cell/editor/DateTime.ts) — the picker-hosting editor template (focus retention, outside-dismiss commit).
- [`cell/editor/String.ts`](../src/typescript/lib/component/table/cell/editor/String.ts) — the keydown/blur forwarding shape and editor border styling.
- [`cell/renderer/String.ts`](../src/typescript/lib/component/table/cell/renderer/String.ts) — the `Text`-wrapping renderer + value caching to mirror.
- [`cell/editor/CellEditorPool.ts`](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts) — `register`/`acquire`, one-instance-per-key sharing.
- [`input/ComboBox.ts`](../src/typescript/lib/component/input/ComboBox.ts) — `setItems`, `setValue`/`getValue` (key-based), the `"action"` event, dropdown focus model.
- [`Row.ts`](../src/typescript/lib/component/table/Row.ts) — `createCellForField` (L373) and `syncCells` (L263) cell-construction sites.
- [`Body.ts`](../src/typescript/lib/component/table/Body.ts) — `setColumnConfigs` (L408), `getEditorPool` (L535).
- [`ColumnConfig.ts`](../src/typescript/lib/component/table/ColumnConfig.ts) — where `values`/`ComboOption` are declared.
- [`docs/recipes/custom-cell.md`](../docs/recipes/custom-cell.md) — the documented per-column-key precedent.

---

## Non-Goals

- **Store-backed / dynamic options.** `values` is a static declarative array. `ComboBox.setStore` exists, but binding a column's options to a live store (with refresh on store events) is a separate feature; out of scope to keep the cell's option set immutable per render.
- **A new `enum` field type in the data model.** Opt-in stays presentational (`ColumnConfig.values`); the model/store/export/validation layers are untouched.
- **Multi-select cells.** `MultiSelectList` exists, but a multi-value cell needs its own value type and serialization; this cell is single-choice (`String | null`).
- **Free-text-with-suggestions (autocomplete) cells.** This cell constrains input to the option set; an editable/autocomplete variant is a distinct cell.
- **Numeric round-trip for number-typed columns.** Keys are strings; converting them back to numbers on commit is out of scope.
