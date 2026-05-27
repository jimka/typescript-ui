# Table Read-Only Columns — Implementation Plan

## Overview

Adds a first-class `readOnly?: boolean` field to [`ColumnConfig`](../src/typescript/lib/component/table/ColumnConfig.ts) so a column spec can declare "every cell in this column is display-only — the user sees the value but cannot edit it." Each body cell in a read-only column refuses the inline-edit affordance, renders with a subtle grey tint, and switches its cursor from the implicit edit invitation to `default`. All other table behaviours — selection, keyboard navigation, sort, resize, drag-reorder, CSV / JSON export — are unchanged.

The mechanism is half-built today: [`Cell`](../src/typescript/lib/component/table/cell/Cell.ts) already carries a private `_readOnly` field ([Cell.ts:27](../src/typescript/lib/component/table/cell/Cell.ts#L27)) and `isReadOnly()` getter ([Cell.ts:117-119](../src/typescript/lib/component/table/cell/Cell.ts#L117)), and [`startEdit`](../src/typescript/lib/component/table/cell/Cell.ts#L161), [`commitEdit`](../src/typescript/lib/component/table/cell/Cell.ts#L198), and [`cancelEdit`](../src/typescript/lib/component/table/cell/Cell.ts#L217) all short-circuit when `isReadOnly()` returns `true`. What is missing: a setter, a `ColumnConfig` field, a `Column` accessor, the per-column wiring inside [`Row`](../src/typescript/lib/component/table/Row.ts), the visual tint, and the cursor swap. This plan closes that gap.

The flag is resolved at construction by `Column.resolve` ([Column.ts:153](../src/typescript/lib/component/table/Column.ts#L153)) and surfaced via a new `Column.isReadOnly()` accessor — shape-matched to the existing [`isInitiallyHidden()`](../src/typescript/lib/component/table/Column.ts#L75) and the upcoming `isUnhideable()` from [plans/table-unhideable-columns.md](./table-unhideable-columns.md). [`Row`'s cell-construction loop](../src/typescript/lib/component/table/Row.ts#L63) calls `cell.setReadOnly(true)` immediately after the existing `groupColor` write so the two tints flow through the same path and the precedence rule is enforced at one site.

---

## Architecture Decisions

### Scope — column-level only, no per-row predicate, no public `Cell.setReadOnly` consumer use

Read-only is declared on the column spec; every cell in that column is read-only. There is no `ColumnConfig.isCellReadOnly?(row) => boolean` predicate, no `Table.setRowReadOnly`, and no expectation that consumers reach into the body to flip individual cells. The new `Cell.setReadOnly(value)` setter exists to let `Row`'s constructor wire the flag at creation time — it is not the public surface consumers should use for column-level read-only intent.

If a per-row predicate is ever needed, the right shape is a separate `ColumnConfig.isCellReadOnly?(record): boolean` plus a `Row.applyReadOnly(record)` pass after each `setData`. That work is out of scope for this plan.

### No separate `disabled` flag

A table cell is not a form input. It has no inert-vs-readable distinction that would map cleanly to "disabled" — the value is always readable, selection always works, keyboard navigation always works. The only behavioural change "read-only" needs is "no editing," which `isReadOnly()` already enforces in `startEdit`. The grey tint communicates the visually-disabled look without adopting form-input semantics that don't apply.

If a future use case truly needs an inert cell (no selection, no keyboard focus), that is a different concept and deserves its own flag. Future maintainers: do not add `ColumnConfig.disabled` as a synonym.

### Tint approach — `setBackgroundColor` write inside the existing setter chain

Two approaches were considered:

1. **`setBackgroundColor("var(--ts-ui-table-cell-readonly-bg)")` from `Cell.setReadOnly(true)`.** Mirrors the existing pattern: `Cell`'s constructor writes `setBackgroundColor("var(--ts-ui-table-cell-bg, transparent)")` at [Cell.ts:47](../src/typescript/lib/component/table/cell/Cell.ts#L47), and `Row` overwrites it with `groupColor` at [Row.ts:110](../src/typescript/lib/component/table/Row.ts#L110). A read-only write that lands AFTER the groupColor write composes naturally: read-only wins over groupColor for cells in a grouped read-only column. The CSS variable carries the theme-swap response for free (the browser resolves the `var(...)` against the current `:root` token).
2. **`box-shadow: inset 0 0 0 9999px var(--ts-ui-table-cell-readonly-bg)`.** Stacks over any background. Composes with row selection at [Body.ts:885](../src/typescript/lib/component/table/Body.ts#L885) and groupColor at [Row.ts:110](../src/typescript/lib/component/table/Row.ts#L110) without writing to `background-color`. Bigger conceptual leap — `Cell`'s constructor doesn't use `box-shadow` for anything else, and it would conflict with the cell editor's focus shadow.

This plan picks **approach 1**. It is the smaller change, matches the existing `setBackgroundColor` precedent, and the precedence rule it produces (row selection > read-only > groupColor > default) is the right rule anyway — see the next decision.

### Precedence — row selection > read-only > groupColor > default

Three backgrounds may compete on a single cell: row selection ([Body.ts:885](../src/typescript/lib/component/table/Body.ts#L885), set on `<tr>`), read-only (set on `<td>` by `Cell.setReadOnly`), and groupColor (set on `<td>` by `Row` at [Row.ts:110](../src/typescript/lib/component/table/Row.ts#L110)).

- **Row selection wins** because it is set on the parent `<tr>` and the cell tints are themselves semi-transparent — the selected-row colour shows through. This requires no explicit ordering: the cell's background renders ON TOP of the row's background, but both tints in this plan are low-alpha rgba so the row colour shows. The light-mode default `rgba(0, 0, 0, 0.04)` over the light-mode selected `rgba(30, 100, 200, 0.15)` composes to a slightly desaturated blue — visibly still "selected".
- **Read-only beats groupColor** because `Row.ts` calls `cell.setReadOnly(true)` AFTER the existing `cell.setBackgroundColor(groupColor)` write (step 4 of the implementation steps). A read-only cell in a grouped column shows the read-only tint, not the group tint. This matches user intent: the read-only signal is more behaviourally meaningful than the group signal, which is purely organisational.
- **Default** is `transparent` — `--ts-ui-table-cell-bg` is `transparent` in both themes ([Theme.ts:555](../src/typescript/lib/core/Theme.ts#L555), [Theme.ts:830](../src/typescript/lib/core/Theme.ts#L830)) — so read-only cells with no group tint just show the read-only tint over the table background.

### Foreground colour — no paired token

Adding `--ts-ui-table-cell-readonly-color` was considered. Rejected for now: the background tint alone reads as "subtly different" without making the value harder to read, and the existing `--ts-ui-table-cell-color` default of `inherit` keeps the foreground in sync with any consumer-set body colour. A second token would make the precedence rules above twice as complex (now four overlays compete) and risks accessibility issues if consumers customise `--ts-ui-table-cell-color` without remembering to override the read-only foreground.

If a future use case demands dimmed text, add `--ts-ui-table-cell-readonly-color` then. Adding it is a one-line addition to each Theme block — no schema churn.

### Cursor — `default`, not `text` or `not-allowed`

A cell with an active editor receives a `text` cursor on hover via the input element's user-agent style. A read-only renderer should NOT advertise that affordance: the renderer's cursor falls back to whatever `<td>` inherits, which today is `default`. `Cell.setReadOnly(true)` writes `cursor: default` on the cell to override any inherited or future renderer-supplied cursor. `not-allowed` was rejected — it implies "you tried to do something forbidden," but the user has not tried to do anything yet; the value is just intrinsically uneditable.

### Theme listener — none needed, CSS variable carries the theme swap

`Cell`'s constructor wires `ThemeManager.onThemeChange(() => this.setBorder('var(--ts-ui-table-cell-border, none)'))` at [Cell.ts:51](../src/typescript/lib/component/table/cell/Cell.ts#L51) because the inline `border:` style needs to be re-stamped (the border shorthand collapses identical specs). Backgrounds set via `var(...)` do not need re-stamping — the browser resolves the `var()` against the current `:root` whenever the variable definition changes. Read-only cells therefore inherit theme-swap responsiveness for free.

The Cell base class's existing theme listener is unchanged.

### Setter naming and behaviour

`setReadOnly(value: boolean)` mirrors the project's typed-setter convention. It is idempotent: calling `setReadOnly(true)` twice is a no-op visually (the second write produces the same `background-color` string). Calling `setReadOnly(false)` clears the tint by writing `setBackgroundColor("var(--ts-ui-table-cell-bg, transparent)")` (the same value the constructor uses) and clears the cursor by setting `cursor: ''`.

If `setReadOnly(false)` is called while an edit is in progress, no special handling: the cell stays in editor mode until the user commits or cancels. No warning emitted; `_readOnly` is the only state that changes. If `setReadOnly(true)` is called mid-edit, the same applies — the existing edit completes normally, and subsequent edits are refused. This matches the principle that the setter writes a future-tense rule, not a present-tense interrupt.

### `_readOnly` field type normalisation

Today's `_readOnly` is typed `Boolean` (the wrapper) at [Cell.ts:27](../src/typescript/lib/component/table/cell/Cell.ts#L27) — an unintended `Boolean` vs `boolean` discrepancy. The setter and getter work either way (`!!this._readOnly` masks the difference at [Cell.ts:118](../src/typescript/lib/component/table/cell/Cell.ts#L118)), but the field type is inconsistent with every other boolean private in `Cell` / `Column` / `ColumnConfig`. This plan changes `private _readOnly: Boolean` to `private _readOnly: boolean` — a one-character edit, no runtime impact, brings the field in line with conventions.

### HeaderCell unaffected

`HeaderCell extends DefaultCell extends Cell<String>` ([cell/Header.ts:72](../src/typescript/lib/component/table/cell/Header.ts#L72)) — it inherits `_readOnly` but is never constructed through `Row`'s cell-construction loop, which is the sole site that calls `setReadOnly(true)`. Header cells live in `Header.ts` ([Header.ts:290](../src/typescript/lib/component/table/Header.ts#L290)) and are unaware of `readOnly`. They keep their existing tooltip wiring at [cell/Header.ts:165](../src/typescript/lib/component/table/cell/Header.ts#L165). No special-casing needed — the per-column flag is consulted only inside the body row factory.

### FooterRow unaffected

`FooterRow extends Component` ([Footer.ts:17](../src/typescript/lib/component/table/Footer.ts#L17)) — it doesn't extend `Cell` at all, so `_readOnly` doesn't exist on its children. Footer cells are display-only by construction; the read-only flag is a no-op concern for them. No code change to `Footer.ts`.

### TreeTable interaction

In a `TreeTable`, `Row` may wrap the tree column's renderer in a `TreeCellRenderer` ([Row.ts:120](../src/typescript/lib/component/table/Row.ts#L120)). The wrapping happens AFTER the new `setReadOnly` call, but `wrapRenderer` does not touch the cell's background or cursor — it swaps the renderer Component only. The tint and cursor survive the wrap.

Toggling expansion is NOT editing. The tree-toggle click handler routes through `TreeBody.onToggleClick` (separate from `Cell.startEdit`), so a read-only tree column still expands and collapses. Documented in the JSDoc and in `docs/components/TreeTable.md`.

### `setColumnVisible` interaction — nothing special

Hiding and restoring a read-only column rebuilds the body via `Body.renderWindow`, which destroys old rows and creates new ones via `Row`'s constructor. The new rows go through the same cell-construction loop and re-apply the read-only flag from `columnConfigs`. No accumulated background-color writes (each new row is a fresh Cell) and no lost tint (the loop runs every time).

### "No feedback when the user double-clicks a read-only cell" — defer

When `Cell.startEdit` short-circuits on `isReadOnly()`, the user gets no visual indication: no flash, no tooltip, no shake. The grey tint alone is the signal. A `Tooltip.attachToElement(cell, "Read-only")` was considered and rejected — it would obscure data on hover for every read-only cell, which is the wrong tradeoff. The user understands "this cell is greyer than the others" + "double-clicking did nothing" without a tooltip prompting them.

If a future need for explicit feedback emerges (e.g. screen-reader announcement), the right shape is an ARIA live-region update on the doubled-click event, not a per-cell tooltip.

---

## Public API (TypeScript Signatures)

### `ColumnConfig` — new field

```typescript
// src/typescript/lib/component/table/ColumnConfig.ts
export interface ColumnConfig {
    field        : string;
    minWidth    ?: number;
    maxWidth    ?: number;
    hidden      ?: boolean;
    /**
     * When `true`, every cell in this column is read-only — the value
     * is displayed but the user cannot edit it. Read-only cells refuse
     * inline editing (double-click is a no-op), render with a subtle
     * grey tint sourced from `--ts-ui-table-cell-readonly-bg`, and
     * present a default cursor on hover instead of the edit affordance.
     *
     * Selection, keyboard navigation, sorting, resizing, drag-reorder,
     * and CSV / JSON export are unaffected — read-only means "value is
     * fixed," not "row is inert." In a {@link TreeTable}, toggling
     * expand / collapse on the tree column still works when that column
     * is read-only (expansion is not editing).
     *
     * Defaults to `false`.
     */
    readOnly    ?: boolean;
    showSeconds ?: boolean;
    headerGlyph ?: string;
    group       ?: string;
    groupColor  ?: string;
}
```

### `Column` — new accessor

```typescript
// src/typescript/lib/component/table/Column.ts
export class Column {
    // ...existing methods

    /**
     * Returns whether this column is marked read-only in the spec.
     * Every cell in a read-only column refuses inline editing and
     * renders with a grey tint.
     *
     * @returns `true` when the spec declared `readOnly: true`.
     */
    isReadOnly(): boolean;
}
```

Cached backing field: `private _readOnly: boolean`, initialised from `config?.readOnly ?? false` in the constructor (same shape as `_hidden`). No `setReadOnly` setter on `Column` — the flag is declared in the spec and frozen at construction. (The `Cell.setReadOnly` setter described below is the per-cell wiring path used by `Row`, not a column-level mutation.)

### `Cell` — new setter, existing getter retained

```typescript
// src/typescript/lib/component/table/cell/Cell.ts
class Cell<T> extends Component {
    // ...existing surface, including isReadOnly() at line 117

    /**
     * Sets whether this cell is read-only. Read-only cells refuse
     * {@link Cell.startEdit} (the existing short-circuit at line 162),
     * render with the `--ts-ui-table-cell-readonly-bg` tint, and
     * present a default cursor instead of any renderer-supplied edit
     * affordance. Idempotent.
     *
     * Body rows call this from their cell-construction loop based on
     * the column's `ColumnConfig.readOnly` flag — application code
     * should declare read-only at the column level rather than calling
     * this setter directly on a cell.
     *
     * @param value - `true` to mark read-only, `false` to restore the
     *   default editable appearance.
     * @returns This cell, for method chaining.
     */
    setReadOnly(value: boolean): this;
}
```

The existing `isReadOnly()` (returning `!!this._readOnly`) is untouched, but the field type is normalised from `Boolean` to `boolean` (see **Architecture Decisions → `_readOnly` field type normalisation**).

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-table-cell-readonly-bg` | `rgba(0, 0, 0, 0.04)` | `rgba(255, 255, 255, 0.04)` | Background tint applied to every cell whose column declares `readOnly: true`. Composes under the selected-row indicator (which is set on the parent `<tr>` and shows through the cell's low-alpha tint), and overrides the groupColor write per the precedence rule documented in **Architecture Decisions**. |

Four `Theme.ts` blocks need entries:

1. **`Theme` interface** at [Theme.ts:200-207](../src/typescript/lib/core/Theme.ts#L200) — add `readonlyBackground: string;` to the `cell` block.
2. **`DefaultTheme.table.cell`** at [Theme.ts:552-559](../src/typescript/lib/core/Theme.ts#L552) — add `readonlyBackground: 'rgba(0, 0, 0, 0.04)',`.
3. **`DarkTheme.table.cell`** at [Theme.ts:827-834](../src/typescript/lib/core/Theme.ts#L827) — add `readonlyBackground: 'rgba(255, 255, 255, 0.04)',`.
4. **`themeToVars`** at [Theme.ts:1066-1070](../src/typescript/lib/core/Theme.ts#L1066) — add `'--ts-ui-table-cell-readonly-bg': theme.table.cell.readonlyBackground,` immediately after `--ts-ui-table-cell-bg`.

The light default is identical in hue to the existing low-alpha overlays used elsewhere in the framework (e.g. `sortBadge.background` at [Theme.ts:566](../src/typescript/lib/core/Theme.ts#L566) is `rgba(0, 0, 0, 0.15)`); 0.04 is deliberately subtler so the read-only signal is unmistakable but never competes for attention with the selected-row tint at 0.15.

---

## Implementation

### `Cell.setReadOnly` body

```typescript
setReadOnly(value: boolean): this {
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

The `getElement()?.style.setProperty` form is used (not a typed setter) because `cursor` has no first-class `setCursor` on `Component`. The element may not yet exist when the setter runs from `Row`'s constructor (the row hasn't been rendered yet); the optional chain makes the cursor write a no-op in that case, and the cursor inherited from `<td>` is `default` anyway, so the omission until first render is harmless. After the element exists, every subsequent `setReadOnly` call writes the cursor explicitly.

Cross-reference [feedback_setter_defer_dom_work.md](~/.claude/projects/-home-jika-typescript-typescript/memory/feedback_setter_defer_dom_work.md) — setters dispatched from constructor paths cannot do unguarded DOM work, but `setBackgroundColor` already routes through the framework's cached-style mechanism (it doesn't touch the element directly), so it is safe here. The cursor write is the only direct DOM touch; the optional chain defers it cleanly.

### `Row` constructor — wire `readOnly` after `groupColor`

```typescript
// In Row.ts, inside the cell-construction loop, immediately after the
// existing groupColor block at lines 108-111:

const groupColor = columnConfigs.get(field.getName())?.groupColor;
if (groupColor) {
    cell.setBackgroundColor(groupColor);
}

// NEW: read-only wins over groupColor; this write lands last so it
// overrides any background set above. Cells without `readOnly: true`
// are untouched.
const readOnly = columnConfigs.get(field.getName())?.readOnly;
if (readOnly) {
    cell.setReadOnly(true);
}
```

Two `columnConfigs.get(field.getName())?` lookups in sequence — the existing pattern at [Row.ts:82](../src/typescript/lib/component/table/Row.ts#L82) and [Row.ts:85](../src/typescript/lib/component/table/Row.ts#L85) already does the same thing for `showSeconds`. No optimisation needed; the map is small.

### `Column.isReadOnly` and constructor wiring

```typescript
// src/typescript/lib/component/table/Column.ts
export class Column {
    // ...existing private fields
    private _readOnly: boolean;

    constructor(field: Field, config?: ColumnConfig) {
        // ...existing assignments
        this._readOnly = config?.readOnly ?? false;
    }

    // ...existing methods

    isReadOnly(): boolean {
        return this._readOnly;
    }
}
```

`Column.resolve` needs no change — the new field rides the existing `configMap.get(...)` plumbing.

---

## Ordered Implementation Steps

1. **Extend `ColumnConfig`.** [ColumnConfig.ts:20](../src/typescript/lib/component/table/ColumnConfig.ts#L20) — add `readOnly?: boolean` immediately after `hidden`, with the JSDoc shown in **Public API**.

2. **Add the backing field and accessor on `Column`.** [Column.ts:22](../src/typescript/lib/component/table/Column.ts#L22) — declare `private _readOnly: boolean;` next to `_hidden`; initialise from `config?.readOnly ?? false` in the constructor (mirrors `_hidden` at line 37); add `isReadOnly(): boolean { return this._readOnly; }` near the other predicates (e.g. after `isInitiallyHidden()` at [Column.ts:75](../src/typescript/lib/component/table/Column.ts#L75)).

3. **Normalise `_readOnly` field type in `Cell`.** [Cell.ts:27](../src/typescript/lib/component/table/cell/Cell.ts#L27) — change `private _readOnly: Boolean;` to `private _readOnly: boolean;`. No other code change to `Cell` in this step.

4. **Add `setReadOnly` to `Cell`.** [Cell.ts](../src/typescript/lib/component/table/cell/Cell.ts) — insert the setter shown in **Implementation** alongside `isReadOnly()` at [Cell.ts:117](../src/typescript/lib/component/table/cell/Cell.ts#L117). The setter writes `setBackgroundColor(...)` and a direct `cursor` style. Idempotent.

5. **Wire `readOnly` in `Row`'s cell-construction loop.** [Row.ts:111](../src/typescript/lib/component/table/Row.ts#L111) — append the two-line `readOnly` lookup + `setReadOnly(true)` call immediately after the existing `groupColor` block, as shown in **Implementation**. This ordering guarantees read-only beats groupColor.

6. **Extend the `Theme` interface, `DefaultTheme`, `DarkTheme`, and `themeToVars`.** Four blocks in [Theme.ts](../src/typescript/lib/core/Theme.ts), per the **Theme Tokens** section.

7. **Extend the `MiscPanel` table-spec demo.** [MiscPanel.ts:318](../src/typescript/MiscPanel.ts#L318) — set `readOnly: true` on the `Joined` column entry in the demo `ColumnSpec` so the verification step has a live target.

8. **Regression checkpoint — grep invariants.**
   ```
   grep -rn 'readOnly' src/typescript/lib/component/table/
   ```
   Expect entries in `ColumnConfig.ts`, `Column.ts`, `cell/Cell.ts`, `Row.ts`. Nowhere else.

   ```
   grep -rn '_readOnly: Boolean' src/typescript/lib/
   ```
   Expect zero matches (the wrapper-type field declaration is gone).

   ```
   grep -rn 'ts-ui-table-cell-readonly-bg' src/typescript/lib/
   ```
   Expect entries in `Theme.ts` (the `themeToVars` block) and `cell/Cell.ts` (the setter body).

9. **Typecheck.**
   ```
   npx tsc --noEmit -p tsconfig.lib.json
   ```
   Expect 0 errors.

10. **Docs build.**
    ```
    npm run docs:build
    ```
    Expect 0 errors and 0 new link warnings beyond the existing baseline (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning).

11. **Manual smoke test.** Follow the checks in **Verification**.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/table/ColumnConfig.ts` |
| Modify | `src/typescript/lib/component/table/Column.ts` |
| Modify | `src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `src/typescript/lib/component/table/Row.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` |
| Modify | `src/typescript/MiscPanel.ts` |
| Modify | `docs/components/Table.md` |
| Modify | `docs/components/TreeTable.md` |

No files created. No files deleted.

---

## Verification

1. **Typecheck.**
   ```
   npx tsc --noEmit -p tsconfig.lib.json
   ```
   0 errors.

2. **Docs build.**
   ```
   npm run docs:build
   ```
   0 errors and 0 new link warnings.

3. **Grep invariants.**
   ```
   grep -rn 'readOnly'           src/typescript/lib/component/table/   # only the 4 files modified above
   grep -rn '_readOnly: Boolean' src/typescript/lib/                   # zero matches
   ```

4. **Manual smoke** (`npm run dev`, http://localhost:8015, navigate to MiscPanel):
   - **Read-only renders.** The `Joined` column shows a subtle grey tint on every cell (light theme: faint dark overlay; dark theme: faint light overlay). All other columns look unchanged.
   - **Double-click is a no-op.** Double-click any `Joined` cell — no editor appears, no flash, no console error. Editable cells (e.g. `Name`) still pop their editor on double-click.
   - **Cursor.** Hover a `Joined` cell — cursor is `default`, not `text`. Hover a `Name` cell — cursor is the default editable affordance.
   - **Theme swap.** Toggle the app theme via the existing theme picker. The `Joined` tint updates in lockstep with the rest of the table (the `var(--ts-ui-table-cell-readonly-bg)` lookup re-resolves automatically).
   - **Selection precedence.** Click a row containing `Joined` — the selected-row highlight visibly takes precedence; the `Joined` cell is still selected-blue, with a barely-perceptible read-only desaturation. Deselect — read-only tint returns.
   - **Group + read-only composition.** In the demo, `Joined` is in the `Activity` group with `groupColor: 'rgba(30, 100, 200, 0.06)'`. Verify the read-only tint wins over the group tint — the cell is grey, not the faint blue of the group. (Other columns in the `Activity` group keep the blue group tint.)
   - **`setColumnVisible` interaction.** From the column context menu, hide `Joined`. Restore it. The tint reappears on the rebuilt rows. Repeat 100 times via console (`for (let i = 0; i < 100; i++) { table.setColumnVisible('Joined', false); table.setColumnVisible('Joined', true); }`) — no accumulated background writes, no lost tint, no console errors.
   - **`TreeTable` non-tree read-only column.** In the `TreeTable` demo, mark a non-tree column `readOnly: true` in its spec, reload — that column gets the tint and refuses edits, exactly like in `Table`.
   - **`TreeTable` tree column read-only.** Mark the tree column `readOnly: true` — the tint appears on the indented cells, double-click on the value does nothing, but the expand / collapse toggle still works (toggling expansion is not editing).
   - **Header unchanged.** Header cells in a read-only column look exactly like header cells in editable columns — no tint, no cursor change.
   - **Footer unchanged.** The footer row (if shown) is unaffected.
   - **CSV / JSON export.** From the table context menu, export to CSV — the `Joined` column appears in the output with the same values as before.

5. **Refresh the knowledge graph.**
   ```
   graphify update . --directed
   ```

---

## Documentation Impact

### `docs/components/Table.md`

Extend the `ColumnConfig` table with a new row, placed after `hidden`:

```
| `readOnly` | When `true`, every cell in this column is display-only — double-click does not start an editor, and the cell renders with a subtle grey tint sourced from `--ts-ui-table-cell-readonly-bg`. Selection, keyboard navigation, sort, resize, and export still work. |
```

### `docs/components/TreeTable.md`

Add one sentence to the section covering column behaviour:

> A read-only tree column still expands and collapses — toggling expansion is not editing. Mark non-tree columns `readOnly: true` to make them display-only without affecting the tree's structural interactions.

### API JSDoc

- `ColumnConfig.readOnly` — JSDoc shown in **Public API**, includes the "selection, navigation, sort, resize, export still work" caveat and the TreeTable note.
- `Column.isReadOnly` — shape-matched to `isInitiallyHidden`.
- `Cell.setReadOnly` — JSDoc shown in **Public API**, explicit that consumers should use `ColumnConfig.readOnly` rather than reaching for this setter directly.

### Theme tokens reference

No dedicated theme tokens page exists, so token documentation lives in JSDoc on the `Theme` interface. No new doc page needed.

### Barrel exports — no change

`ColumnConfig`, `Column`, and `Cell` are already exported from [component/table/index.ts](../src/typescript/lib/component/table/index.ts). No new symbols, no barrel updates.

### Cross-bucket links — none needed

All references stay within `component/table`; standard `{@link Foo}` form resolves correctly.

---

## Potential Challenges

- **`setBackgroundColor` cached-style write order vs `setReadOnly`.** `Cell`'s constructor calls `setBackgroundColor("var(--ts-ui-table-cell-bg)")` at [Cell.ts:47](../src/typescript/lib/component/table/cell/Cell.ts#L47). `Row` then calls `cell.setBackgroundColor(groupColor)` at [Row.ts:110](../src/typescript/lib/component/table/Row.ts#L110), and the new code calls `cell.setReadOnly(true)` which calls `setBackgroundColor` again. The Component class's `setBackgroundColor` overwrites the cached value cleanly each time — verify with one console probe during step 4 that `cell._cssCache.backgroundColor` (or equivalent internal field) reflects the last write only.
- **`getElement()` returns `null` before first render.** The `setReadOnly` setter's cursor write uses optional chaining (`getElement()?.style.setProperty(...)`) so that calling the setter from `Row`'s constructor before the row is attached doesn't crash. After first render, every subsequent call writes the cursor explicitly. Test by setting `readOnly: true` in a column spec and confirming the cursor is `default` on first paint.
- **Field type normalisation breaks subclass overrides.** `private _readOnly: Boolean` → `private _readOnly: boolean` is structurally identical to TypeScript, but if any out-of-tree subclass shadows the field with `Boolean`, it'll start emitting a structural error. The framework has no such subclasses today (only `DefaultCell` / `BooleanCell` / etc., all of which inherit the field unchanged). Document in the JSDoc that consumers should not redeclare the field.
- **Read-only + dirty row visual.** When a row is `isDirty()`, `updateVisualState()` writes `--ts-ui-table-row-dirty` on the `<tr>` ([Row.ts:186](../src/typescript/lib/component/table/Row.ts#L186)). A read-only cell in a dirty row shows the dirty row tint underneath the read-only cell tint — both are low alpha, so the composition is a slightly desaturated orange. This is correct behaviour (dirty row + read-only cell is a coherent state — the row has unsaved changes elsewhere, this cell just happens to be uneditable), and the manual smoke test does not need to exercise it explicitly. Note in passing during verification.
- **The new TypeScript field type discrepancy is visible in the JSDoc.** Today's `isReadOnly()` at [Cell.ts:117](../src/typescript/lib/component/table/cell/Cell.ts#L117) returns `!!this._readOnly` (the wrapper coerces to boolean cleanly). After normalising the field type, the `!!` is now belt-and-braces but harmless. Keep it.

---

## Critical Files

- [src/typescript/lib/component/table/ColumnConfig.ts](../src/typescript/lib/component/table/ColumnConfig.ts) — public-facing entry point for declaring `readOnly`.
- [src/typescript/lib/component/table/Column.ts](../src/typescript/lib/component/table/Column.ts) — owner of the new field; mirror the `_hidden` / `isInitiallyHidden` pair.
- [src/typescript/lib/component/table/cell/Cell.ts](../src/typescript/lib/component/table/cell/Cell.ts) — the base where `_readOnly` lives, where `startEdit` already consults `isReadOnly()`, and where the new setter lands. Note the existing `ThemeManager.onThemeChange` listener at [Cell.ts:51](../src/typescript/lib/component/table/cell/Cell.ts#L51) — read-only does NOT need to register an additional listener (CSS variable resolution carries the theme swap).
- [src/typescript/lib/component/table/Row.ts](../src/typescript/lib/component/table/Row.ts) — the cell-construction switch that wires the per-column flag. The new write goes immediately after the existing `groupColor` block to enforce the read-only > groupColor precedence rule.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — four blocks (`Theme`, `DefaultTheme.table.cell`, `DarkTheme.table.cell`, `themeToVars`) need synchronized entries for the new `--ts-ui-table-cell-readonly-bg` token.
- [src/typescript/lib/component/table/cell/Header.ts](../src/typescript/lib/component/table/cell/Header.ts) — read-only-related: confirm header cells are not constructed through `Row`'s loop and therefore inherit no per-column `setReadOnly` call. No edit needed here, just verification.
- [src/typescript/lib/component/table/Footer.ts](../src/typescript/lib/component/table/Footer.ts) — confirm `FooterRow` does not extend `Cell` and is unaffected. No edit needed.
- [plans/table-unhideable-columns.md](./table-unhideable-columns.md) — sibling plan with the same shape (`ColumnConfig` field → `Column` accessor → per-column wiring). Reuses none of the same files in conflict (this plan touches `Cell.ts` and `Row.ts`, the sibling touches `Body.ts`, `Header.ts`, `Table.ts`, `TreeTable.ts`), but the JSDoc tone and accessor shape mirror each other intentionally.

---

## Non-Goals

- **Per-row read-only predicate.** A `ColumnConfig.isCellReadOnly?(record): boolean` hook is not added. Read-only is a column-level fact; per-row exceptions are a separate feature.
- **A `disabled` flag.** Read-only is the right concept for "uneditable but visible." A separate `disabled` flag implying "uneditable AND non-interactive" is not needed for tables and would invite synonym confusion.
- **`--ts-ui-table-cell-readonly-color` foreground token.** The background tint alone communicates read-only state without dimming the text. If a future use case demands dimmed text, add the token then.
- **"You tried to edit a read-only cell" tooltip or animation.** The grey tint plus the dead double-click is the signal. No popup, no shake, no banner.
- **Sort, resize, drag-reorder, or export change.** Read-only is a body-cell editability flag — column UI affordances are unaffected.
- **`HeaderCell` read-only state.** Headers are their own UI surface (sort target, drag handle, context-menu trigger). They are not "editable" in any sense the read-only flag would meaningfully modify.
- **`FooterRow` read-only state.** Footers are display-only by construction; the read-only flag is a no-op concern.
- **Runtime `Column.setReadOnly` setter.** The flag is declared in the spec and resolved at construction. Runtime mutation is out of scope; the per-cell `Cell.setReadOnly` exists for `Row` to wire from `columnConfigs`, not as a public column-level toggle.
- **ARIA `aria-readonly` attribute on the cell.** A future accessibility pass should consider this, but it is not in scope for this plan — the goal is visual + interaction behaviour, not screen-reader semantics.
