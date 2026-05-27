---
depends-on: [table-readonly-columns]
---

# Table Read-Only Rows and Cells — Implementation Plan

## Overview

Extends the column-level read-only mechanism from [`plans/table-readonly-columns.md`](./table-readonly-columns.md) with two record-driven granularities. A new **`ColumnSpec.rowReadOnly?: (record) => boolean`** predicate marks every cell on a row read-only (e.g. the record carries `locked: true`); a per-column **`ColumnConfig.cellReadOnly?: (record) => boolean`** predicate marks a single cell read-only on a per-record basis (e.g. `discount` cells are read-only when `customerTier === 'standard'`). Both compose with the existing column-level `readOnly: boolean` flag: a cell is read-only when ANY of the three signals says so.

The wiring lands in [`Body.bindAndPositionRows`](../src/typescript/lib/component/table/Body.ts#L635) — specifically inside the existing `if (wasRebound)` block at [Body.ts:643](../src/typescript/lib/component/table/Body.ts#L643), where it can call `cell.setReadOnly(union)` on every cell of the just-bound row. Predicate evaluation rides the same store-event refresh path already used by selection / dirty-state updates: a consumer that mutates the record's "locked" flag and calls [`AbstractStore.notifyRecordChanged`](../src/typescript/lib/data/AbstractStore.ts#L540) fires `'datachanged'` → [`Body.onStoreChange`](../src/typescript/lib/component/table/Body.ts#L142) → `_boundIndices.fill(-1)` → full pool rebind, which is exactly when the predicates need to re-fire.

The column-level plan's foundations — the `Cell.setReadOnly(value)` setter, the `--ts-ui-table-cell-readonly-bg` theme token, and the precedence rule `row selection > read-only > groupColor > default` — are inputs to this plan. This plan adds nothing to `Cell` or `Theme.ts` beyond a single idempotence guard on the setter (flagged below as a prerequisite).

---

## Architecture Decisions

### Predicate API, not a model-field convention

Two shapes were weighed:

- **A) Predicates on the spec/config.** `ColumnSpec.rowReadOnly?: (record: ModelRecord) => boolean`, `ColumnConfig.cellReadOnly?: (record: ModelRecord) => boolean`.
- **B) Model-field convention.** `ColumnSpec.readOnlyField?: string` whose boolean value on each record means "this row is read-only," plus `ColumnConfig.readOnlyField?: string` per-column.

This plan picks **A — predicates**. Justification:

1. **Composition.** The user's stated use cases — "locked", "completed", "archived", `customerTier === 'standard'` — are arbitrary boolean expressions, not a single boolean field. A predicate handles them in one shape; a field convention forces the consumer to materialise a synthetic boolean column in the model just to project the rule.
2. **Asymmetry with `parentField` / `idField`.** Those fields are *structural* — the tree shape can't exist without naming the record property that carries the parent pointer. Read-only is *behavioural* — it derives from arbitrary record state. The convention pattern fits the former; the predicate pattern fits the latter.
3. **Per-cell granularity.** The per-cell case (`discount` read-only when `customerTier === 'standard'`) reads from a *different* field than the one the column displays. A `readOnlyField` per column would still need the consumer to materialise a derived `discountReadOnly` boolean. The predicate just reads `record.get('customerTier')` directly.
4. **The column-level plan already settled the static case.** `ColumnConfig.readOnly: boolean` is the discoverable shape; the predicates are the dynamic extension.

The predicate is also typed for IDE auto-complete on the `ModelRecord` parameter, where a field name string is just a string.

### Predicate placement — spec-level for rows, config-level for cells

A row-level predicate is a property of the *table*, not of any individual column — it answers "is this row locked?", which doesn't belong to a column. It lives on `ColumnSpec.rowReadOnly` so it's declared once per table.

A per-cell predicate is a property of the *column* (each column decides its own per-record exception rule). It lives on `ColumnConfig.cellReadOnly`.

This split also matches where the data is available: `Body` already holds the `ColumnSpec` via [`getColumnConfigs`](../src/typescript/lib/component/table/Body.ts#L268) (per-column map) and can be handed the row predicate via a new `setRowReadOnly` setter from [`Table`](../src/typescript/lib/component/table/Table.ts) at construction. The wrapping `Table` reads `spec.rowReadOnly` and forwards it; nothing else changes shape.

### Composition rule — OR across all three signals

A cell is read-only when:

```
column.isReadOnly()               // static, set in Row's constructor (column-level plan)
|| spec.rowReadOnly?.(record)     // dynamic, evaluated per bind
|| config.cellReadOnly?.(record)  // dynamic, evaluated per bind
```

`Body` computes the union per (row, cell) and calls `cell.setReadOnly(union)` on every bind. The column-level plan's constructor-time `cell.setReadOnly(true)` for `readOnly: true` columns is **redundant once Body's bind path runs**, but it's the right default state for the first paint before any record has been bound — the constructor wires the static signal; the bind path overwrites with the dynamic union (which still includes the static signal). No conflict: both paths agree on the column-level value, and the dynamic path can only widen, never narrow.

Single-site composition: the OR lives only inside `Body.bindAndPositionRows`. `Cell.setReadOnly` is a low-level boolean setter; it does not know which signal caused the call.

### Evaluation cadence — apply on rebind only, rely on `notifyRecordChanged`

The bind block at [Body.ts:643-649](../src/typescript/lib/component/table/Body.ts#L643) runs **only when `wasRebound` is true**. Three options were considered for where the read-only application fires:

1. **Apply only on rebind** (inside the `wasRebound` block).
2. **Apply every bind iteration** (after the `if (wasRebound)` block, but before geometry).
3. **Track a per-row last-result cache and re-apply only on change.**

This plan picks **option 1**.

Justification:

- The user's contract is "the predicate must be O(1) and pure" — restated below in the perf contract. Even so, "every bind iteration" runs ~22 row predicates + 110 cell predicates per render in the perf-baseline pool, which is more than option 1 needs.
- The only way the read-only state can change for a record already bound to a pool slot is if the record itself mutated. Every mutation path that consumers care about goes through [`record.set(...)`](../src/typescript/lib/data/ModelRecord.ts#L63), and consumers are expected to call [`store.notifyRecordChanged(record)`](../src/typescript/lib/data/AbstractStore.ts#L540) after a record mutation to update the visual state — this already drives the existing dirty-row tint behaviour at [Row.ts:183-189](../src/typescript/lib/component/table/Row.ts#L183).
- `notifyRecordChanged` emits `'datachanged'` → [`Body.onStoreChange`](../src/typescript/lib/component/table/Body.ts#L142) → `_boundIndices.fill(-1)` → `renderWindow()`. With every bound index reset, every visible row's next `wasRebound` check returns `true`, so the predicate runs again on the next paint.
- This makes the consumer contract symmetric with the existing dirty-state contract: "if you mutated a record's behavioural fields out-of-band, call `notifyRecordChanged` and the table re-renders." No new contract; no new event.

The cost of option 1 vs option 3: option 3 saves *one* boolean OR + an idempotent `cell.setReadOnly(same-value)` per bind iteration on rows that didn't rebind, but those rows didn't rebind in the first place — so the cell is already in the correct visual state from its last rebind. Option 3 is strictly more code for no observable gain.

### Mid-edit read-only — silent commit via `Cell.setReadOnly(true)` natural fall-through

The user's contract said "verify that `Cell.setReadOnly(true)` mid-edit cleanly tears down the borrowed editor." Tracing the call chain:

1. The bind path calls `cell.setReadOnly(true)` on a cell currently in edit mode.
2. The column-level plan's `setReadOnly` setter (per [plans/table-readonly-columns.md#L202-L216](./table-readonly-columns.md)) writes `_readOnly = true`, sets a background, sets a cursor. **It does not call `commitEdit` or `cancelEdit` or interact with the editor pool.** It just flips the flag.
3. The next time the user blurs the editor, [`Cell.commitEdit`](../src/typescript/lib/component/table/cell/Cell.ts#L198) runs. Its first line is `if (this.isReadOnly() || !this.isEditing()) { return this; }` — so `commitEdit` short-circuits without writing the value back, the editor stays attached to the cell, and the borrowed editor is never released.

That's the bug. The setter as defined in the column-level plan is safe when called on a non-editing cell, but unsafe mid-edit because it leaves a borrowed editor permanently attached.

**Resolution:** `Cell.setReadOnly(true)` MUST commit any active edit before flipping the flag. The simplest shape:

```typescript
setReadOnly(value: boolean): this {
    if (value && this.isEditing()) {
        // Commit BEFORE flipping the flag — commitEdit's read-only
        // short-circuit at Cell.ts:199 would otherwise leave the
        // borrowed editor stuck attached.
        this.commitEdit();
    }

    // ...existing column-level-plan body (background, cursor, _readOnly write)
}
```

This is "silently commit" per the user's three options. Justification:

- "Refuse" (do nothing) leaves the editor dangling — worse than the current behaviour.
- "Cancel" discards user input — surprising and lossy.
- "Commit" preserves user input as-is. The user typed it; if they're about to discover the cell just became read-only, at least their work survives.

This is a **prerequisite enhancement to the column-level plan's `setReadOnly`** — list it explicitly in this plan's Ordered Implementation Steps. The column-level plan as drafted does not include this commit-on-true guard; this plan adds it.

The `commitEdit` call here is safe because at the moment of the call the cell is still `!isReadOnly()` (the flag flip comes after), so the short-circuit doesn't trigger, the value is written, and [`detachEditor`](../src/typescript/lib/component/table/cell/Cell.ts#L234) releases the borrowed editor cleanly via `_editorPool?.release()`.

### Perf contract — O(1) and pure

Predicates run on every rebind for every visible row. Pool baseline is roughly `Math.ceil(viewportHeight / rowHeight) + 2 * SCROLL_BUFFER + 2` slots (≈ 22 for a 500 px viewport at 22 px rows) and per-slot ~5 visible columns, so a worst-case full-pool rebind fires 22 row predicates + 110 cell predicates per render — every scroll-driven `renderWindow` and every store mutation.

The contract documented in the JSDoc and reinforced in `docs/components/Table.md`:

> The predicate is invoked on every row bind. It must be O(1) and pure — read fields off the record, return a boolean, do not call back into the store, do not allocate, do not perform DOM work. Memoise inside the predicate if your computation is non-trivial; the table does not cache results.

No memoisation in the framework. The consumer can wrap their own predicate in a memo (`WeakMap<ModelRecord, boolean>`) if needed; the framework stays simple.

### `Body.afterRowBound` is the wrong hook

`afterRowBound` runs outside the `if (wasRebound)` block — every iteration, rebind or not. Calling `setReadOnly` from there would either:

- Be redundant for non-rebound iterations (the cell is already in the correct visual state from last rebind).
- Need an idempotence guard to avoid background-color churn (idempotence is required anyway, but compounding it across hundreds of redundant calls is wasted work).

The application lands **inside the existing `if (wasRebound)` block**, alongside `updateRowVisualState` and `computeRowAria`. This co-locates the per-row state updates that depend on which record is bound.

### Visual treatment — reuse the existing token, no new CSS

The grey tint and the cursor swap are exactly what the column-level plan defined. The read-only signal is read-only regardless of source — the user sees the same tint whether it came from the column flag, the row predicate, or the cell predicate. **No new theme token.** No `--ts-ui-table-cell-row-readonly-bg` distinction. Single source of truth: `--ts-ui-table-cell-readonly-bg`.

### `Cell.setReadOnly` idempotence — required, list as prerequisite fix

The bind path calls `setReadOnly(true)` on every rebind for every cell that resolves to read-only. With ~110 cell predicates per render and 60 frames per second of scrolling, that's potentially 6,600 setter calls per second on a heavily-scrolled read-only column. Each setter call writes a `background-color` and a `cursor` — if the cached value matches, both should bail.

The column-level plan's setter at [plans/table-readonly-columns.md#L202-L216](./table-readonly-columns.md) is NOT idempotent as drafted — it writes the background and cursor unconditionally. Whether the underlying `setBackgroundColor` short-circuits internally depends on the Component's cached-style mechanism (it does cache identical values, per [feedback_commitbounds_autocommit_stale_dom.md](~/.claude/projects/-home-jika-typescript-typescript/memory/feedback_commitbounds_autocommit_stale_dom.md) and the framework's general style-cache pattern), but the cursor write goes through `getElement()?.style.setProperty('cursor', 'default')` which has no cache.

**Resolution:** add an explicit early return when the flag value hasn't changed:

```typescript
setReadOnly(value: boolean): this {
    if (this._readOnly === value) {
        return this;
    }

    if (value && this.isEditing()) {
        this.commitEdit();
    }

    this._readOnly = value;

    // ...existing column-level-plan body (background, cursor)
}
```

This is the second prerequisite enhancement to the column-level plan's setter. Both go into the same edit (step 1 below).

### TreeTable expand/collapse, selection, and dirty-row composition — unchanged

- **Tree-toggle on a read-only row.** The toggle click handler routes through `TreeBody.onSubtreeClick` (overriding [`Body.onSubtreeClick`](../src/typescript/lib/component/table/Body.ts#L730)), independent of `Cell.startEdit`. Read-only does not block expansion. Documented in [docs/components/TreeTable.md](../docs/components/TreeTable.md).
- **Selection.** [`Body.selectRecord`](../src/typescript/lib/component/table/Body.ts#L817) and the click handlers don't consult `isReadOnly()`. Read-only rows are still selectable, focusable, and keyboard-navigable. Selection's row-level tint composes on top per the column-level plan's precedence rule (selection wins on hover).
- **Dirty row.** A read-only row that's also dirty (rare but coherent — a consumer programmatically mutated a non-read-only field on a now-read-only row) shows the dirty-row tint underneath the read-only cell tint. The column-level plan's potential-challenges section already documents this composition; this plan inherits it.

### Out of scope — `HeaderCell`, `FooterRow`, `setReadOnly` on `Column`

Per the user's brief and matching the column-level plan: header cells and footer rows are display-only by construction; they never enter the bind path that applies the predicates. There is no `Column.setReadOnly(boolean)` — the column-level flag is frozen at construction; this plan adds only predicate-driven dynamism.

---

## Public API (TypeScript Signatures)

### `ColumnSpec` — new field

```typescript
// src/typescript/lib/component/table/ColumnConfig.ts
export interface ColumnSpec {
    columns        : ColumnConfig[];
    appendUnlisted ?: boolean;
    /**
     * Per-row read-only predicate. Receives each visible record on every
     * rebind and returns `true` to mark every cell in that row read-only
     * for the next render pass.
     *
     * Composes with {@link ColumnConfig.readOnly} (column-level static
     * flag) and {@link ColumnConfig.cellReadOnly} (per-cell predicate):
     * a cell is read-only when ANY of the three signals says so.
     *
     * The predicate fires on every row rebind — when scrolling pulls
     * new records into the visible window, when the store emits
     * `'datachanged'` (which {@link AbstractStore.notifyRecordChanged}
     * does), or when columns are hidden / shown. It MUST be O(1) and
     * pure: read fields off `record`, return a boolean, do not call
     * back into the store, do not allocate, do not touch the DOM.
     * Memoise inside your predicate if the computation is non-trivial;
     * the framework does not cache results.
     *
     * To update a row's read-only state after mutating the underlying
     * record, call `store.notifyRecordChanged(record)` — the table
     * re-renders and the predicate fires again on the next paint.
     */
    rowReadOnly    ?: (record: ModelRecord) => boolean;
}
```

### `ColumnConfig` — new field

```typescript
// src/typescript/lib/component/table/ColumnConfig.ts
export interface ColumnConfig {
    // ...existing fields including readOnly?: boolean from
    // plans/table-readonly-columns.md
    /**
     * Per-cell read-only predicate, evaluated per record on every
     * rebind. Returns `true` to mark this column's cell read-only for
     * the given record. Composes with {@link ColumnConfig.readOnly} and
     * {@link ColumnSpec.rowReadOnly} via OR — a cell is read-only when
     * ANY signal says so.
     *
     * Same perf contract as `ColumnSpec.rowReadOnly`: O(1) and pure.
     * Same update path: after mutating a record out-of-band, call
     * `store.notifyRecordChanged(record)`.
     */
    cellReadOnly ?: (record: ModelRecord) => boolean;
}
```

### `Body` — new resolved-predicate slot + protected setter

`Body` already stores the per-column config map. The new row-level predicate has no natural slot in that map (it's spec-level, not column-level) and must be plumbed in separately by the wrapping `Table`. Two patterns were considered: extend `setColumnConfigs` to take the spec's `rowReadOnly` alongside, or add a dedicated setter. The dedicated setter wins for clarity:

```typescript
// src/typescript/lib/component/table/Body.ts
class Body extends Component {
    // ...existing private fields
    private _rowReadOnly: ((record: ModelRecord) => boolean) | null = null;

    /**
     * Sets the table-wide row-level read-only predicate forwarded from
     * {@link ColumnSpec.rowReadOnly}. Cleared by passing `null`.
     *
     * @param predicate - Returns `true` to mark every cell in the
     *   record's row read-only. Called on every rebind; must be O(1)
     *   and pure.
     * @returns This body, for method chaining.
     *
     * @remarks Internal wiring called by {@link Table} — not for
     * consumer use. Consumers declare the predicate in the spec.
     */
    setRowReadOnly(predicate: ((record: ModelRecord) => boolean) | null): this;
}
```

No cached backing-field beyond `_rowReadOnly`; no per-cell predicate slot on `Body` (the per-cell predicate is already in `_columnConfigs.get(field).cellReadOnly`).

### `Cell.setReadOnly` — prerequisite enhancement to column-level plan

The column-level plan's setter body is replaced by the version below. Two adds: idempotence guard at the top, mid-edit commit guard immediately after.

```typescript
// src/typescript/lib/component/table/cell/Cell.ts
setReadOnly(value: boolean): this {
    if (this._readOnly === value) {
        return this;
    }

    if (value && this.isEditing()) {
        this.commitEdit();
    }

    this._readOnly = value;

    if (value) {
        this.setBackgroundColor("var(--ts-ui-table-cell-readonly-bg, rgba(0, 0, 0, 0.04))");
        this.getElement()?.style.setProperty('cursor', 'default');
    } else {
        this.setBackgroundColor("var(--ts-ui-table-cell-bg, transparent)");
        this.getElement()?.style.removeProperty('cursor');
    }

    return this;
}
```

The other column-level-plan touchpoints (`ColumnConfig.readOnly`, `Column.isReadOnly`, `Row`'s constructor wiring, theme tokens) are unchanged by this plan.

### `Table` — forward the spec field to the body

`Table` constructs its `Body` from the spec at construction; this plan adds one line that pulls `spec.rowReadOnly` and forwards it via `body.setRowReadOnly(...)`. No public surface change on `Table` itself.

---

## Internal Structure

### `Body.bindAndPositionRows` — composition inside the rebind block

The rebind block at [Body.ts:643-649](../src/typescript/lib/component/table/Body.ts#L643) gains one new helper call. The full block becomes:

```typescript
if (wasRebound) {
    row.setData(records[dataIndex]);

    this._boundIndices[i] = dataIndex;
    this.updateRowVisualState(i);
    this.computeRowAria(row, dataIndex);
    this.applyReadOnlyState(row, records[dataIndex]);  // NEW
}
```

And the new helper, defined as a private method on `Body`:

```typescript
/**
 * Computes the read-only union per cell and forwards it to
 * `cell.setReadOnly`. Runs inside the rebind block once per row.
 *
 * The union is OR-composed from three sources:
 *
 * 1. Column-level static flag from `ColumnConfig.readOnly` (wired
 *    into the cell at construction time by `Row`).
 * 2. Spec-level row predicate from `ColumnSpec.rowReadOnly`
 *    (cached in `_rowReadOnly`).
 * 3. Per-column per-record predicate from `ColumnConfig.cellReadOnly`.
 *
 * Source 1 is already reflected in the cell's `_readOnly` field by
 * `Row`'s constructor for cells whose column was declared
 * `readOnly: true` — but this helper still ORs it in explicitly via
 * `cell.isReadOnly()` so the union remains correct regardless of
 * any in-between mutation.
 */
private applyReadOnlyState(row: Row, record: ModelRecord): void {
    const rowOverride = this._rowReadOnly?.(record) === true;
    const cells       = row.getComponents() as Cell<any>[];
    const fieldNames  = row.getFieldNames();  // new public accessor on Row, see below

    for (let i = 0; i < cells.length; i++) {
        const cell        = cells[i];
        const fieldName   = fieldNames[i];
        const config      = this._columnConfigs.get(fieldName);
        const colStatic   = cell.isReadOnly();           // already true for column-level readOnly
        const cellPredOk  = config?.cellReadOnly?.(record) === true;
        const union       = colStatic || rowOverride || cellPredOk;

        cell.setReadOnly(union);
    }
}
```

### `Row.getFieldNames` — small access addition

`Row` already stores `_fieldNames: string[]` at [Row.ts:37](../src/typescript/lib/component/table/Row.ts#L37) and uses it inside `setData` at [Row.ts:161-165](../src/typescript/lib/component/table/Row.ts#L161). `Body.applyReadOnlyState` needs the same list to align cell index → field name → config lookup. Expose it via a public accessor:

```typescript
// src/typescript/lib/component/table/Row.ts
class Row extends Component {
    /**
     * Returns the field names backing this row's cells, in the same
     * order as `getComponents()`. Hidden columns are excluded.
     *
     * @returns The field names, in cell order.
     */
    getFieldNames(): string[] {
        return this._fieldNames;
    }
}
```

Alternative considered: walk the cell components and pull the field via `LayoutConstraints.data` (which `Row.addComponent` writes at [Row.ts:124-126](../src/typescript/lib/component/table/Row.ts#L124)). Rejected: the array is already there, the accessor is a one-liner, and field-by-component lookup through layout constraints is more indirection than the existing private `_fieldNames` access.

### Mid-edit teardown trace — verified safe

Calling `cell.setReadOnly(true)` mid-edit, with the prerequisite enhancement above:

1. `setReadOnly(true)` — sees `isEditing() === true`, calls `commitEdit()`.
2. `commitEdit` — `isReadOnly()` is still `false` (the flag flip is later), so the short-circuit doesn't trigger. Calls `editor.getValue()`, writes back via `_renderer.setValue(value)`, fires `_onCommit?.(value)` (which calls `record.set(field, value)` → `store.notifyRecordChanged` via `Row`'s closure at [Row.ts:96-102](../src/typescript/lib/component/table/Row.ts#L96)), calls `detachEditor()`.
3. `detachEditor` — sets `_activeEditor = null`, swaps the Card layout back to the renderer, and **because the cell was using a borrowed editor (`_editor` is undefined, `_activeEditor !== _editor`)**, calls `this.removeComponent(editor)` and `this._editorPool?.release()`. The editor pool is cleanly released.
4. Back in `setReadOnly`, `_readOnly = true` is written, background and cursor flip.

All editor-pool invariants hold. The just-committed value is in the record; the next bind cycle (triggered by the same `notifyRecordChanged` that the commit just fired) will re-evaluate the predicate against the new record state, OR-in the now-true read-only signal, and call `cell.setReadOnly(true)` again — which is idempotent and no-ops because `_readOnly === value`.

There is a re-entrant edge: `commitEdit` fires `notifyRecordChanged` → `'datachanged'` → `onStoreChange` → `renderWindow` → `bindAndPositionRows` → `applyReadOnlyState` synchronously. By the time control returns to the *outer* `applyReadOnlyState` (the one whose `cell.setReadOnly` triggered the inner cascade), the cell has already been re-bound and is in its final state. The outer loop continues with the next cell, calls `cell.setReadOnly(union)` on cells that have already been updated by the inner render — those calls hit the idempotence guard and no-op. No infinite recursion (the predicate stops returning new state once the record reaches steady state); no duplicated commit (the second `setReadOnly(true)` call sees `isEditing() === false` and skips the commit branch).

Edge documented; idempotence guard makes it benign.

---

## Ordered Implementation Steps

1. **Add the idempotence + mid-edit-commit guards to `Cell.setReadOnly`.** [Cell.ts](../src/typescript/lib/component/table/cell/Cell.ts) — replace the setter body as shown in **Public API → `Cell.setReadOnly`**. This is a prerequisite fix; the column-level plan's setter as drafted is unsafe mid-edit and non-idempotent for the cursor write. Implementing this plan without these guards corrupts the editor pool.

2. **Extend `ColumnSpec` with `rowReadOnly`.** [ColumnConfig.ts:66-75](../src/typescript/lib/component/table/ColumnConfig.ts#L66) — add `rowReadOnly?: (record: ModelRecord) => boolean` immediately after `appendUnlisted`, with the JSDoc shown in **Public API**. Import `ModelRecord` from `~/data/ModelRecord.js` at the top of the file (currently not imported there).

3. **Extend `ColumnConfig` with `cellReadOnly`.** [ColumnConfig.ts:12-45](../src/typescript/lib/component/table/ColumnConfig.ts#L12) — add `cellReadOnly?: (record: ModelRecord) => boolean` after the column-level-plan's `readOnly` entry.

4. **Add `Row.getFieldNames` accessor.** [Row.ts](../src/typescript/lib/component/table/Row.ts) — append the one-liner public accessor shown in **Internal Structure → `Row.getFieldNames`**.

5. **Add `Body._rowReadOnly` + `Body.setRowReadOnly`.** [Body.ts](../src/typescript/lib/component/table/Body.ts) — declare `private _rowReadOnly: ((record: ModelRecord) => boolean) | null = null;` next to `_columnConfigs` at [Body.ts:53](../src/typescript/lib/component/table/Body.ts#L53). Add the `setRowReadOnly(predicate)` method per **Public API**.

6. **Add `Body.applyReadOnlyState`.** [Body.ts](../src/typescript/lib/component/table/Body.ts) — define the private helper shown in **Internal Structure → `Body.bindAndPositionRows`**. Place it adjacent to `updateRowVisualState` near [Body.ts:869](../src/typescript/lib/component/table/Body.ts#L869) for thematic grouping.

7. **Wire the helper into the rebind block.** [Body.ts:643-649](../src/typescript/lib/component/table/Body.ts#L643) — add `this.applyReadOnlyState(row, records[dataIndex]);` as the last line inside the `if (wasRebound)` block.

8. **Forward `spec.rowReadOnly` from `Table` to `Body`.** [Table.ts](../src/typescript/lib/component/table/Table.ts) — at the construction site that already calls `body.setColumnConfigs(...)` (find via `grep -n 'setColumnConfigs' src/typescript/lib/component/table/Table.ts`), add `body.setRowReadOnly(spec?.rowReadOnly ?? null);` immediately after. Same pattern repeats in [`TreeTable.ts`](../src/typescript/lib/component/table/TreeTable.ts) if it constructs its own Body (verify; the `TreeTableSpec` extends `ColumnSpec` so `rowReadOnly` is already part of the spec shape, no additional field needed).

9. **Extend the `MiscPanel` table-spec demo.** [MiscPanel.ts:314-323](../src/typescript/MiscPanel.ts#L314) — add a `locked: boolean` field to `specModel`, set it `true` on one of the five records (e.g. Bob), and add `rowReadOnly: (r) => r.get('locked') === true` to the spec. Add a `cellReadOnly` to one column to demo the per-cell granularity — e.g. `{ field: 'Score', cellReadOnly: (r) => r.get('Active') === false }` so Score is read-only when Active is false. This gives the manual smoke check two distinct surfaces to exercise.

10. **Regression grep.**

    ```
    grep -rn 'rowReadOnly\|cellReadOnly' src/typescript/lib/component/table/
    ```

    Expect: `ColumnConfig.ts` (definitions), `Body.ts` (`_rowReadOnly`, `setRowReadOnly`, `applyReadOnlyState`), `Table.ts` (forwarding call). Nowhere else.

    ```
    grep -rn 'setReadOnly' src/typescript/lib/component/table/
    ```

    Expect: `Cell.ts` (setter + idempotence guard), `Body.ts` (call from `applyReadOnlyState`), `Row.ts` (the column-level plan's constructor wiring). No new call sites.

11. **Typecheck.** `npx tsc --noEmit -p tsconfig.lib.json` — 0 errors.

12. **Docs build.** `npm run docs:build` — 0 errors and 0 new link warnings beyond the existing baseline.

13. **Manual smoke** — per `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `src/typescript/lib/component/table/ColumnConfig.ts` |
| Modify | `src/typescript/lib/component/table/Row.ts` |
| Modify | `src/typescript/lib/component/table/Body.ts` |
| Modify | `src/typescript/lib/component/table/Table.ts` |
| Modify | `src/typescript/MiscPanel.ts` |
| Modify | `docs/components/Table.md` |
| Modify | `docs/components/TreeTable.md` |

No files created. No files deleted.

---

## Verification

1. **Typecheck.** `npx tsc --noEmit -p tsconfig.lib.json` — 0 errors.

2. **Docs build.** `npm run docs:build` — 0 errors and 0 new link warnings (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning).

3. **Regression greps** — per step 10.

4. **Manual smoke** (`npm run dev`, http://localhost:8015, navigate to MiscPanel → "Show window with table (column spec)!"):

    - **Row predicate visible on first paint.** Bob (locked=true) renders with the grey tint across **every cell** in his row, including `Joined`/`Meeting`/`LastSeen` which carry the `groupColor` tint on the other rows — the read-only signal overrides the group tint per the column-level plan's precedence rule. Other rows look unchanged.
    - **Double-click is a no-op on every cell in the locked row.** Try `Name`, `Active`, `Score`, `Joined`, `Notes` (when visible) — none open an editor.
    - **Double-click works on unlocked rows.** Same columns on Alice / Carol / David / Eve still pop their editors.
    - **Per-cell predicate.** Bob has `Active: false`, so per the spec extension `Score` is read-only on Bob (tinted, double-click does nothing). On Alice (Active: true) `Score` is editable. Toggle Alice's `Active` cell from `true` to `false` via the editor and commit — the next paint marks Alice's `Score` cell read-only (tint appears, double-click stops working). Toggle back — `Score` becomes editable again.
    - **Out-of-band mutation + `notifyRecordChanged` updates the row state.** In the dev console, run `specStore.getAt(0).set('locked', true); specStore.notifyRecordChanged(specStore.getAt(0));` — Alice's row gains the read-only tint across every cell on the next paint without scrolling or any other interaction. Clear it with `specStore.getAt(0).set('locked', false); specStore.notifyRecordChanged(specStore.getAt(0));` — tint disappears.
    - **Mid-edit safe-commit.** Double-click Alice's `Notes` cell to open the editor. Type "in progress edit". In the dev console, run `specStore.getAt(0).set('locked', true); specStore.notifyRecordChanged(specStore.getAt(0));`. Expect: the editor commits "in progress edit" to the record (visible in the cell after the editor closes), the row gains the read-only tint, the editor pool is clean (open a different row's cell, see the same editor instance reuse cleanly with no console error).
    - **Toggle 100 times on the predicate flag.** In the dev console:
        ```js
        for (let i = 0; i < 100; i++) {
            specStore.getAt(0).set('locked', i % 2 === 0);
            specStore.notifyRecordChanged(specStore.getAt(0));
        }
        ```
        Expect: no console errors, no visible flicker beyond two paints (initial + final state), no accumulated background-color writes on the row's cells (inspect Alice's `Name` cell's inline style — `background-color` is the expected current-state value, not a long string of overrides).
    - **Tree-toggle on a read-only row.** In the TreeTable demo, mark `src` (id=1) read-only via a `rowReadOnly: (r) => r.get('id') === 1` spec addition (temporary, for verification). The row gains the tint, but the expand/collapse toggle on the tree column still works.
    - **Selection works on read-only rows.** Click Bob's row — it becomes the anchor, focus indicator appears, keyboard navigation arrows still move into and out of his row.
    - **Theme swap.** Toggle the app theme. The read-only tint updates on locked / cellReadOnly cells in sync with editable cells.
    - **`setColumnVisible` round-trip.** Hide and restore the `Score` column via the column context menu — the per-cell read-only on Bob's `Score` reappears correctly on the rebuilt cells.

5. **Refresh the knowledge graph.**
    ```
    graphify update . --directed
    ```

---

## Documentation Impact

### `docs/components/Table.md`

- Add a `rowReadOnly` row to the `ColumnSpec` table:

  > `rowReadOnly` — Optional predicate `(record) => boolean`. When it returns `true` for a record, every cell in that record's row renders read-only with the grey tint, regardless of the column's own `readOnly` flag. Predicate runs on every row rebind; must be O(1) and pure. Call `store.notifyRecordChanged(record)` after mutating the record out-of-band to update the table.

- Add a `cellReadOnly` row to the `ColumnConfig` table immediately after the `readOnly` entry from the column-level plan:

  > `cellReadOnly` — Optional predicate `(record) => boolean`. When it returns `true` for a record, this column's cell on that record's row renders read-only. Composes with `readOnly` and `ColumnSpec.rowReadOnly` (cell is read-only when ANY of the three says so).

- Add a short paragraph on the compose rule directly below the new rows: "A cell is read-only when its column's `readOnly` flag is `true`, OR the spec's `rowReadOnly(record)` returns `true`, OR the column's `cellReadOnly(record)` returns `true`. The grey tint is the same in all three cases."

### `docs/components/TreeTable.md`

Append one sentence to the read-only paragraph added by the column-level plan: "Row-level and per-cell read-only predicates (from `ColumnSpec.rowReadOnly` and `ColumnConfig.cellReadOnly`) work identically in `TreeTable` — toggling expansion is not editing, so a locked tree row can still expand and collapse."

### JSDoc

- `ColumnSpec.rowReadOnly` — JSDoc as shown in **Public API**, including the perf contract and the `notifyRecordChanged` update path.
- `ColumnConfig.cellReadOnly` — JSDoc as shown in **Public API**.
- `Body.setRowReadOnly` — internal-wiring JSDoc; consumers declare the predicate in the spec.
- `Cell.setReadOnly` — extend the JSDoc from the column-level plan with one sentence noting that calling `setReadOnly(true)` mid-edit silently commits the active edit.

### Barrel exports — no change

`ColumnConfig`, `ColumnSpec`, `Cell`, `Row`, `Body`, `Table` are all already exported from [`component/table/index.ts`](../src/typescript/lib/component/table/index.ts). No new symbols.

### Cross-bucket links

The new JSDoc uses `{@link ColumnConfig.readOnly}` etc. from inside `component/table` — same bucket, plain `{@link …}` resolves. The link to `AbstractStore.notifyRecordChanged` crosses from `component/table` to `data`; use markdown form per [docs-conventions.md](../.claude/skills/_shared/docs-conventions.md): `` [`notifyRecordChanged`](/api/data/classes/AbstractStore#notifyRecordChanged) ``.

---

## Potential Challenges

- **Re-entrant `applyReadOnlyState` during mid-edit commit.** The mid-edit commit inside `setReadOnly(true)` fires `notifyRecordChanged`, which synchronously cascades back into `renderWindow` → `applyReadOnlyState` before the outer call returns. The idempotence guard absorbs the redundant calls cleanly. Verified in the mid-edit smoke check; do not skip that check.
- **`commitEdit` calling `_onCommit` synchronously inside `setReadOnly`.** The cell's commit callback (set by `Row` at [Row.ts:96-102](../src/typescript/lib/component/table/Row.ts#L96)) calls `record.set(field, value)` and then `_onCellCommit?.(this._data)` — which is the `Body`'s `notifyRecordChanged` forwarder. This is the cascade above. No additional mitigation; the existing edit-commit path was already synchronous.
- **Predicate throws.** If a consumer's predicate throws, it propagates out of `applyReadOnlyState`, which propagates out of `bindAndPositionRows`, which is called from `renderWindow`. The whole render aborts. Document the perf contract — "MUST be pure" — but do not wrap predicate calls in try/catch (silencing the throw would mask consumer bugs and add per-call overhead). Consumers see a clean stack trace and fix the predicate.
- **`getElement()?.style.removeProperty('cursor')` on a cell where the cursor was inherited.** If `setReadOnly(false)` runs on a cell that never had `setReadOnly(true)` called, `removeProperty('cursor')` is a no-op. No mitigation needed; documented in the column-level plan.
- **Type narrowing on `cell` inside `applyReadOnlyState`.** `row.getComponents()` returns `Component[]`; the cast `as Cell<any>[]` matches the cast already in `Row.setData` at [Row.ts:160](../src/typescript/lib/component/table/Row.ts#L160). Safe — `Row` only adds `Cell` children.
- **`_rowReadOnly` not cleared on `setStore`.** When `setStore` rebinds to a new store, `_rowReadOnly` survives. This is intentional: the predicate is a property of the spec, not the data. If a consumer swaps stores and wants to change the predicate, they re-call `body.setRowReadOnly(...)` (or `table.setSpec(...)` if that exists; verify in `Table.ts`).

---

## Critical Files

- [`plans/table-readonly-columns.md`](./table-readonly-columns.md) — the foundation. This plan's setter enhancements (idempotence + mid-edit commit) are prerequisites that must land alongside or before this plan executes. The column-level plan is listed as `depends-on` in this plan's frontmatter.
- [`src/typescript/lib/component/table/cell/Cell.ts`](../src/typescript/lib/component/table/cell/Cell.ts) — host of the prerequisite setter enhancement. The mid-edit commit path goes through `commitEdit` → `detachEditor` → `_editorPool?.release()`; trace that path before changing the setter to confirm the editor pool stays clean.
- [`src/typescript/lib/component/table/cell/editor/CellEditorPool.ts`](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts) — the pool's `release()` is what makes the mid-edit commit safe. Read the borrow/release contract end-to-end before claiming the setter enhancement works.
- [`src/typescript/lib/component/table/Body.ts`](../src/typescript/lib/component/table/Body.ts) — host of the bind path and the new predicate slot. The new helper goes inside the existing `if (wasRebound)` block at [Body.ts:643](../src/typescript/lib/component/table/Body.ts#L643); confirm the placement before editing.
- [`src/typescript/lib/component/table/Row.ts`](../src/typescript/lib/component/table/Row.ts) — host of the column-level constructor wiring (from the column-level plan) and the new `getFieldNames` accessor. Read the cell-construction loop to confirm `_fieldNames` is built before `addComponent` runs.
- [`src/typescript/lib/component/table/ColumnConfig.ts`](../src/typescript/lib/component/table/ColumnConfig.ts) — host of the two new predicate fields. Import `ModelRecord` from `~/data/ModelRecord.js` at the top of the file.
- [`src/typescript/lib/data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts) — verify `notifyRecordChanged` emits `'datachanged'` (it does, at [AbstractStore.ts:540-542](../src/typescript/lib/data/AbstractStore.ts#L540)) and that `Body.bindStore` subscribes to `'datachanged'` (it does, at [Body.ts:128](../src/typescript/lib/component/table/Body.ts#L128)).
- [`src/typescript/lib/component/table/Table.ts`](../src/typescript/lib/component/table/Table.ts) — adds the one-line `body.setRowReadOnly(spec?.rowReadOnly ?? null)` forwarding after the existing `body.setColumnConfigs(...)` call. Verify both calls live at the same construction site.

---

## Non-Goals

- **Static consumer-facing `cell.setReadOnly(boolean)` API.** The setter exists; it's not the public surface. Consumers declare read-only via `ColumnConfig.readOnly`, `ColumnSpec.rowReadOnly`, or `ColumnConfig.cellReadOnly`. Reaching into the body to flip individual cells imperatively is not supported.
- **A separate `disabled` flag.** Already settled in the column-level plan. Read-only is the right concept.
- **Read-only based on selection state.** Coupling read-only to selection is the wrong abstraction; consumers can compose it themselves via `cellReadOnly: (r) => !selectedRecords.has(r)` if they really want it, but the framework does not surface a selection-aware shortcut.
- **`HeaderCell` or `FooterRow` read-only.** Headers and footers do not participate in the bind path that applies the predicates.
- **Persistence of read-only state across store sync.** Read-only is derived; sync round-trips the underlying data fields (e.g. `locked`), and the predicate re-evaluates against the synced record on the next paint. There is no separate read-only state to persist.
- **Memoisation inside the framework.** Consumers can wrap their predicates if needed. The framework's perf contract is "O(1) and pure"; caching is consumer responsibility.
- **A `ColumnConfig.rowReadOnlyField: string` convention.** Considered as shape B; rejected per **Architecture Decisions → Predicate API, not a model-field convention**.
