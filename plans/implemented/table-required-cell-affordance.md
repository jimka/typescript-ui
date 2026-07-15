# Required-Column Cell Affordance — Implementation Plan

## Overview

Add a config-driven "required" affordance to the table so a consumer can mark a column required and get, with no custom renderer: a **header asterisk** on that column and a **tint on empty cells** of that column (notably in a freshly added new row). Two new `ColumnConfig` fields drive it — a static `required: boolean` and an optional per-record `requiredPredicate(record) => boolean` — mirroring the existing `readOnly` / `cellReadOnly` / `rowReadOnly` triad.

The feature reuses the exact seams read-only already uses. The header asterisk is driven by the static flag through [`Column`](src/typescript/lib/component/table/Column.ts#L17) → [`HeaderCell`](src/typescript/lib/component/table/cell/Header.ts#L82) (same path as `headerGlyph`). The empty-cell tint is resolved per rebind in [`Body`](src/typescript/lib/component/table/Body.ts#L1081) next to `applyReadOnlyState`, and painted by a new [`Cell`](src/typescript/lib/component/table/cell/Cell.ts#L34) state setter that shares one background/cursor resolver with `setReadOnly`.

The downstream sqladmin app (which today validates required fields only at Save time) is out of scope here; adoption is a Documentation-Impact / Non-Goal note.

---

## Architecture Decisions

### Two config surfaces: static `required` + per-record `requiredPredicate` — Header uses static only

`ColumnConfig.required` is the static column-level flag; `ColumnConfig.requiredPredicate(record)` is the per-record predicate. A cell's **empty tint** fires when `(required === true || requiredPredicate?.(record) === true)` AND the cell's bound value is empty. This is the exact composition shape as `readOnly || rowReadOnly || cellReadOnly`.

The **header asterisk** is driven by the **static `required` only**. The header cell has no bound record, so it cannot evaluate a per-record predicate; a column that is required only for some records (predicate-only) shows no asterisk but still tints its empty required cells. This matches how the header shows a single static state while the body resolves per-record state.

The predicate is named `requiredPredicate` (as requested), not `cellRequired`. It is the semantic analog of `cellReadOnly`; the name difference is intentional and follows the task's suggested API.

### "Empty" is computed from the raw record value, generically — not per cell type

Emptiness is `value === null || value === undefined || value === ''`, computed once in `Body` from `record.get(field)`. This is correct across every cell type without per-type branching: `number` `0` and `boolean` `false` are **not** empty (legit values), while an unset boolean (`null`/`undefined`, rendered indeterminate) and an empty string / null string / null combo value **are** empty. No cell subclass needs to know about emptiness.

### One background/cursor resolver on `Cell`, with a stored base — precedence readOnly ▸ requiredEmpty ▸ base

`Cell` currently lets `setReadOnly` write the cell background directly (readonly-bg vs cell-bg). Adding a second background state (required-empty tint) means both states must share one owner or they fight. Introduce a private `_applyStateTint()` that resolves the cell's background + cursor from precedence **readOnly (grey, default cursor) ▸ requiredEmpty (required tint) ▸ base background**. `setReadOnly` and the new `setRequiredEmpty` each set their flag then call it.

To make required-empty compose correctly with a column's `groupColor` tint, `Cell` stores a `_baseBackground` (default `var(--ts-ui-table-cell-bg, transparent)`); the resolver's fall-through restores it. [`Row`](src/typescript/lib/component/table/Row.ts) routes its group-color write through a new `setBaseBackground` instead of `setBackgroundColor`, so a filled cell in a grouped **and** required column restores its group tint rather than going transparent. (Without this, a required grouped column would visibly lose its group tint the moment the cell is filled — a worse version of the pre-existing readOnly-over-groupColor override.) Header cells never enter this state machine (the Body only toggles body-row cells), so `Header.ts`'s own group-color write stays on `setBackgroundColor`.

Precedence rationale: a read-only cell cannot be filled, so nagging it with a required tint is misleading — readOnly wins.

### Header asterisk is appended to the label text (monochrome), not a colored marker element

The header renderer is a single [`StringRenderer`](src/typescript/lib/component/table/cell/renderer/String.js) `Text` under a `Card` layout; a substring cannot be individually colored, and a flowing colored marker would need text measurement to position. The asterisk is therefore appended to the label string exactly like the sort arrow (` ▲`/` ▼`), via a new `HeaderCell._renderTitle()` that composes `base + requiredSuffix + sortArrowSuffix`. It inherits the header text color (monochrome). The **color** signal in the affordance is carried by the empty-cell tint; the asterisk is the structural cue. A colored/badge asterisk is a Non-Goal.

### New theme token for the empty tint, registered like `readonlyBackground`

Add `table.cell.requiredEmptyBackground` to the `Theme` type and all three palette themes, and register `--ts-ui-table-cell-required-empty-bg` in the token map — the same three-touch pattern `readonlyBackground` uses. Write sites use `var(--ts-ui-table-cell-required-empty-bg, <fallback>)` with an inline fallback. No header token (the asterisk is monochrome).

---

## Public API

### `ColumnConfig` (interface) — `src/typescript/lib/component/table/ColumnConfig.ts`

```typescript
export interface ColumnConfig {
    // ... existing fields ...

    /** When `true`, mark this column required: a header asterisk and, per row,
     *  a tint on the cell when its value is empty. Drives the header asterisk
     *  (static only). Defaults to `false`. */
    required ?: boolean;

    /** Per-record required predicate. Returns `true` to mark this column's cell
     *  required for the given record. Composes with `required` via OR for the
     *  empty-cell tint; does NOT drive the header asterisk (the header has no
     *  record). Fires on every row rebind — must be O(1) and pure. */
    requiredPredicate ?: (record: ModelRecord) => boolean;
}
```

`ModelRecord` is already imported in this file.

### `Column` — `src/typescript/lib/component/table/Column.ts`

```typescript
private _required: boolean;              // from config?.required ?? false
isRequired(): boolean;                   // new accessor
```

### `HeaderCell` — `src/typescript/lib/component/table/cell/Header.ts`

```typescript
private _required: boolean = false;
setRequired(value: boolean): this;       // sets flag, calls _renderTitle()
private _renderTitle(): void;            // composes base + ' *'(required) + ' ▲/▼'(sort)
```

### `Cell` — `src/typescript/lib/component/table/cell/Cell.ts`

```typescript
private _requiredEmpty: boolean = false;
private _baseBackground: string = 'var(--ts-ui-table-cell-bg, transparent)';
setRequiredEmpty(value: boolean): this;  // idempotent; sets flag, calls _applyStateTint()
setBaseBackground(color: string): this;  // stores base, calls _applyStateTint()
private _applyStateTint(): void;         // readOnly ▸ requiredEmpty ▸ base
```

### `Theme` — `src/typescript/lib/core/Theme.ts`

```typescript
table.cell.requiredEmptyBackground: string;   // new required field on the type
```

---

## Internal Structure

### `Cell._applyStateTint` (replaces the inline block at the tail of `setReadOnly`)

```typescript
private _applyStateTint(): void {
    if (this._readOnly) {
        this.setBackgroundColor('var(--ts-ui-table-cell-readonly-bg, rgba(0, 0, 0, 0.04))');
        this.setCursor('default');
    } else if (this._requiredEmpty) {
        this.setBackgroundColor('var(--ts-ui-table-cell-required-empty-bg, rgba(220, 60, 60, 0.10))');
        this.clearCursor();
    } else {
        this.setBackgroundColor(this._baseBackground);
        this.clearCursor();
    }
}
```

`setReadOnly` keeps its idempotence guard and mid-edit-commit logic; only its final `if (value) { setBackgroundColor(readonly)… } else { setBackgroundColor(cell-bg)… }` block is replaced by a call to `this._applyStateTint()`.

`setRequiredEmpty`:

```typescript
setRequiredEmpty(value: boolean): this {
    if (this._requiredEmpty === value) { return this; }
    this._requiredEmpty = value;
    this._applyStateTint();
    return this;
}
```

`setBaseBackground`:

```typescript
setBaseBackground(color: string): this {
    this._baseBackground = color;
    this._applyStateTint();
    return this;
}
```

### `HeaderCell._renderTitle`

```typescript
private _renderTitle(): void {
    const arrow = this._sortState
        ? (this._sortState.state === 'asc' ? ' ▲' : ' ▼')
        : '';
    const req = this._required ? ' *' : '';
    this.getRenderer().getText().setText(this._text + req + arrow);
}
```

`setSortState` and `clearSortState` replace their `this.getRenderer().getText().setText(...)` line with `this._renderTitle()` (they still set `_sortState`, aria, and the priority badge as today). `setRequired(value)` sets `_required` and calls `_renderTitle()`.

### `Body.applyRequiredEmptyState` + `Body.isEmptyValue`

```typescript
private static isEmptyValue(value: unknown): boolean {
    return value === null || value === undefined || value === '';
}

private applyRequiredEmptyState(row: Row, record: ModelRecord): void {
    const cells      = row.getComponents() as Cell<any>[];
    const fieldNames = row.getFieldNames();

    for (let i = 0; i < cells.length; i++) {
        const config   = this._columnConfigs.get(fieldNames[i]);
        const required = config?.required === true
                      || config?.requiredPredicate?.(record) === true;
        const empty    = Body.isEmptyValue(record.get(fieldNames[i]));

        cells[i].setRequiredEmpty(required && empty);
    }
}
```

Called for **every visible row on every render** (not gated on `wasRebound`), because the tint depends on the cell value, which changes on in-place edits. A commit runs `Row`'s commit handler → `this._store.notifyRecordChanged(record)` (wired in `Body.createRow`) → `'datachange'` → `renderWindow`, so re-running this each `renderWindow` clears/sets the tint as the user fills the cell. `setRequiredEmpty` is idempotent, so the per-render cost over the small visible window is negligible.

---

## Ordered Implementation Steps

1. **`ColumnConfig.ts`** — add `required ?: boolean` and `requiredPredicate ?: (record: ModelRecord) => boolean` to the `ColumnConfig` interface, with TSDoc mirroring the depth of the `readOnly` / `cellReadOnly` docs (state defaults, that the predicate must be O(1)/pure and fires every rebind, and that the header asterisk uses the static flag only). `ModelRecord` is already imported.

2. **`Column.ts`** — add `private _required: boolean;`, init `this._required = config?.required ?? false;` in the constructor, and add `isRequired(): boolean { return this._required; }` with a TSDoc block modeled on `isReadOnly`.

3. **`cell/Cell.ts`** — add fields `private _requiredEmpty: boolean = false;` and `private _baseBackground: string = 'var(--ts-ui-table-cell-bg, transparent)';`. Extract the background/cursor block at the tail of `setReadOnly` into a new `private _applyStateTint()` (see Internal Structure) and replace that block with `this._applyStateTint();`. Add `setRequiredEmpty(value)` and `setBaseBackground(color)` (see Internal Structure). Add TSDoc to each new method, and note in `setReadOnly`'s doc that read-only wins over the required-empty tint.

4. **`Row.ts`** — in the constructor (the `groupColor` block, ~L85–88) and in `syncCells` (the `groupColor` block, ~L342–346), change `cell.setBackgroundColor(groupColor)` → `cell.setBaseBackground(groupColor)`. Do **not** change the read-only application block — `setReadOnly` still wins via `_applyStateTint`. (Header.ts's group-color write is unchanged.)

5. **`cell/Header.ts`** — add `private _required: boolean = false;`. Add `private _renderTitle()` (see Internal Structure). In `setSortState` and `clearSortState`, replace the single `this.getRenderer().getText().setText(...)` call with `this._renderTitle()` (keep the aria + badge lines). Add `setRequired(value: boolean): this` that sets `_required` and calls `_renderTitle()`, with TSDoc. Leave the constructor's initial `renderer.getText().setText(text)` as-is (required is applied post-construction by the header sync).

6. **`Header.ts`** (table header) — in `setColumns`, right after the `groupColor` block (~L459–463), add an unconditional `cell.setRequired(col?.isRequired() ?? false);` so a config swap re-applies it (same cadence as the group tint). `col` is already `columnMap.get(field.getName())`.

7. **`Body.ts`** — add `private static isEmptyValue(value: unknown)` and `private applyRequiredEmptyState(row, record)` (see Internal Structure). In `bindAndPositionRows`, after `this.afterRowBound(row, dataIndex, wasRebound);` (~L774) and outside the `wasRebound` guard, add `this.applyRequiredEmptyState(row, records[dataIndex]);`. `Cell` and `ModelRecord` are already imported.

8. **`core/Theme.ts`** — add `requiredEmptyBackground: string;` to the `table.cell` block of the `Theme` type (after `readonlyBackground`, ~L359), and register `'--ts-ui-table-cell-required-empty-bg': theme.table.cell.requiredEmptyBackground,` in the token map (after the `--ts-ui-table-cell-readonly-bg` line, ~L1040).

9. **`core/themes/ModernTheme.ts`, `DarkTheme.ts`, `ClassicTheme.ts`** — add `requiredEmptyBackground` to each `table.cell` block next to `readonlyBackground`. Suggested values: Modern/Classic `'rgba(220, 60, 60, 0.10)'`; Dark `'rgba(255, 90, 90, 0.14)'` (legible red-on-dark). Keep the inline `var(..., rgba(220, 60, 60, 0.10))` fallback in `Cell._applyStateTint` regardless.

10. **Typecheck** — `npm run typecheck`. The new non-optional `Theme` field forces all three palette themes to supply it; a miss is a compile error (intended guard).

11. **Grep checkpoints** — `grep -rn "requiredEmptyBackground" src/` → 5 hits (type, 3 themes, token map). `grep -rn "setBaseBackground" src/` → def in Cell + 2 call sites in Row. `grep -rn "setRequired\b" src/` → def in HeaderCell + call site in Header.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/table/ColumnConfig.ts` |
| Modify | `src/typescript/lib/component/table/Column.ts` |
| Modify | `src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `src/typescript/lib/component/table/Row.ts` |
| Modify | `src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `src/typescript/lib/component/table/Header.ts` |
| Modify | `src/typescript/lib/component/table/Body.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` |
| Modify | `src/typescript/lib/core/themes/ClassicTheme.ts` |
| Modify | `docs/components/Table.md` (see Documentation Impact) |
| Modify | `docs/concepts/theming.md` (token row) |

---

## Expected Behaviour

**Unit-testable (node DOM harness, `tests/**/*.test.ts`):**

- `Column`: `isRequired()` is `false` when config omits `required`, `false` for `required: false`, `true` for `required: true` — mirror `tests/component/table/Column.test.ts` L12–43.
- `Body.isEmptyValue`: `true` for `null`, `undefined`, `''`; `false` for `0`, `false`, `'x'`, `' '` (a single space is not empty).
- `Cell` precedence via `setReadOnly` / `setRequiredEmpty` / `setBaseBackground` (assert on the cell's resolved background):
  - fresh cell → base (`--ts-ui-table-cell-bg` token).
  - `setRequiredEmpty(true)` → required-empty token.
  - then `setReadOnly(true)` → readonly token (readOnly wins).
  - then `setReadOnly(false)` → required-empty token (falls back to requiredEmpty).
  - then `setRequiredEmpty(false)` → base.
  - `setBaseBackground('rgb(1,2,3)')` while not readOnly/requiredEmpty → `rgb(1,2,3)`; then `setRequiredEmpty(true)` → required token; then `setRequiredEmpty(false)` → `rgb(1,2,3)` (group tint restored, not transparent).
  - `setRequiredEmpty` is idempotent: setting the current value does not thrash the background.
- `Body.applyRequiredEmptyState` resolution over a spec with `required: true`, a `requiredPredicate`, and a plain column: assert `setRequiredEmpty` is called with `required && empty` per cell (spy on cells, or assert resolved backgrounds after `renderWindow`). Include a `new` record with empty required fields (tint on) and a filled record (tint off).
- `HeaderCell._renderTitle` composition (assert on `getRenderer().getText()` text): base only; `+ ' *'` when required; required + sort shows both markers; `clearSortState` keeps the asterisk; `setRequired(false)` removes it.

**Manual (visual / not automatable):**

- A required column shows the header asterisk; a predicate-only column does not.
- An empty required cell shows the tint; typing a value and committing clears it on the next paint; clearing it back to empty re-tints.
- A freshly added new row (green new-row row tint on the `<tr>`) shows the required tint on its empty required cells on top of the green — cell-level tint over row-level tint reads correctly.
- Dark theme: the tint is legible against the dark cell background.
- A required column that also declares `groupColor`: empty cell shows the required tint; filled cell shows the group tint (not transparent).

---

## Verification

- `npm run typecheck` — clean (the new non-optional `Theme.table.cell.requiredEmptyBackground` forces all three themes).
- `npm run test` — runs `typecheck:test` then vitest; add the unit tests above under `tests/component/table/` (Column, Body) and `tests/component/table/cell/` (Cell, Header) mirroring existing files.
- Grep checkpoints from step 11.
- Manual smoke: exercise a `Table` with a spec mixing `required: true`, `requiredPredicate`, and a plain column, over a store with a new (empty) record and a filled record. Add a new row, watch the required cells tint; fill one, watch it clear. Toggle themes (Modern/Dark/Classic). The demo app / docs playground for `Table` is the entry point.

---

## Documentation Impact

- **TSDoc (primary, generated to `docs/api/.../ColumnConfig.md`)**: the `required` / `requiredPredicate` field docs added in step 1 are the source of truth for the generated API page. `ColumnConfig` is already exported from the barrel (`src/typescript/lib/component/table/index.ts` L11); no export change.
- **`docs/components/Table.md`**: add `required` and `requiredPredicate` rows to the `ColumnConfig` field table (next to the `readOnly` / `cellReadOnly` rows at L49–50) and a short prose paragraph like the read-only one at L59–61 (asterisk from static flag; empty-cell tint from static OR predicate; predicate does not drive the asterisk).
- **`docs/concepts/theming.md`**: add a token-table row for `--ts-ui-table-cell-required-empty-bg` (mapped to `table.cell.requiredEmptyBackground`) in the same table as `--ts-ui-table-row-new` (L87).
- No public symbol renamed or removed — no cross-reference sweep needed.

---

## Potential Challenges

- **Per-render cost of `applyRequiredEmptyState`.** It runs for every visible row every `renderWindow`. Mitigation: it only iterates the small visible window, and `setRequiredEmpty` short-circuits on the idempotence guard, so unchanged cells cost one comparison.
- **Tint must clear on edit, not just on scroll-rebind.** Gating on `wasRebound` (as read-only does) would leave a stale tint after the user fills a cell in place. Mitigation: call it unconditionally (step 7); the commit → `notifyRecordChanged` → `renderWindow` path guarantees a re-run.
- **Boolean "empty".** An unset boolean (`null`/`undefined`, indeterminate checkbox) counts as empty and tints; `false` does not. This is the intended semantic (a required boolean with no value set is flagged) — confirm in manual smoke.
- **Group-color interaction.** Handled by routing `Row`'s group tint through `setBaseBackground` (step 4); without it a filled cell in a required+grouped column would go transparent. Read-only still overrides both, as today.

---

## Critical Files

- `src/typescript/lib/component/table/cell/Cell.ts` — `setReadOnly` (L233) is the template for the shared tint resolver; understand its mid-edit-commit + idempotence logic before extracting `_applyStateTint`.
- `src/typescript/lib/component/table/Body.ts` — `applyReadOnlyState` (L1081) is the template; `bindAndPositionRows` (L756) is the call site; `createRow` (L270) shows the commit → `notifyRecordChanged` wiring.
- `src/typescript/lib/component/table/cell/Header.ts` — `setSortState` / `clearSortState` (L268/L297) show the label-text seam the asterisk shares.
- `src/typescript/lib/component/table/Header.ts` — `setColumns` (L429–464) is where the header cell is wired from the `Column`.
- `src/typescript/lib/core/Theme.ts` — type block (L355–363) + token map (L1035–1044); `src/typescript/lib/core/themes/{Modern,Dark,Classic}Theme.ts` cell blocks.
- `tests/component/table/Column.test.ts` — config-reflection test shape to mirror for `isRequired`.

---

## Non-Goals

- **Colored / badge header asterisk.** The asterisk is monochrome label text (single-`Text` renderer + `Card` layout make a colored substring or flowing marker non-trivial); the color signal lives in the empty-cell tint. A dedicated colored marker element is out of scope.
- **Save-time / cross-field validation.** This is a visual affordance only. It does not block commits, integrate with a store's validation, or surface aggregate messages — the downstream sqladmin status-bar validation stays as-is; adopting `required` there is a separate app change.
- **`required` on `ColumnSpec` (row-level required).** Only column-level `required` + per-cell `requiredPredicate` are added, matching the task. A `rowReadOnly`-style row-level required is not requested.
- **Aria `required` semantics** on the gridcell/columnheader — deferred; the visual affordance is the ask.
