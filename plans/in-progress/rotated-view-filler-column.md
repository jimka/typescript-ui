# Rotated View Filler Column — Implementation Plan

## Overview

The rotated (`\x`-style) `Table` view projects one selected record into `field` / `value` rows. Today the projection has exactly two columns — `field` and `value` — and both are type-flexible (`string` and `auto`), so the layout manager splits the table width evenly between them ([layout/Table.ts:309](packages/lib/src/typescript/lib/layout/Table.ts#L309)). On a wide table the `value` column becomes enormous, and a right-aligned number floats far from its label.

This plan bounds `field` and `value` with a `maxWidth`, then adds a third **filler** column — blank header, empty read-only cells — that grows to absorb the leftover table width so the two data columns stay compact and left-grouped. The projection stays read-only, and `value` keeps its per-field `DynamicCell` variants (number / date / boolean / combo) with numbers right-aligning inside the now-bounded cell.

The work touches the rotated projection ([component/table/Table.ts:37](packages/lib/src/typescript/lib/component/table/Table.ts#L37), [Table.ts:896](packages/lib/src/typescript/lib/component/table/Table.ts#L896)), the width-distribution algorithm in the layout manager ([layout/Table.ts:309](packages/lib/src/typescript/lib/layout/Table.ts#L309), [layout/Table.ts:351](packages/lib/src/typescript/lib/layout/Table.ts#L351)), and a small per-column header-label override so the filler header renders blank ([ColumnConfig.ts](packages/lib/src/typescript/lib/component/table/ColumnConfig.ts), [Column.ts](packages/lib/src/typescript/lib/component/table/Column.ts), [cell/Header.ts:451](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L451)).

---

## Architecture Decisions

### Bound `field` / `value` with `maxWidth`; the filler is unbounded

`field` gets `maxWidth: 200`, `value` gets `maxWidth: 360`; the filler declares no `maxWidth`.[^bounds] There is no per-column flex/weight/preferred-width knob in `ColumnConfig` — "flexible" is derived purely from field type (`string` / `auto` share leftover space; `boolean` / `number` / `date` are fixed) — so `maxWidth` is the only lever for "stop stretching," and an unbounded flexible column is the only lever for "grow to fill."[^no-flex]

### The layout manager must redistribute slack to the unbounded flexible column

The current algorithm gives each flexible column an equal share of leftover space and clamps each independently; the space a column gives up by clamping to its `maxWidth` is simply lost, leaving the row under-filled. That is not the behaviour this feature needs, so a small redistribution pass is added: any positive leftover is handed to the flexible columns that declare no `maxWidth`.[^redistribute] This is a no-op for every normal table (its flexible columns already sum to the full width), so it is a targeted fix, not a broad change.

### The filler is a real projection column, not a new component

The filler is expressed as a third `ROTATED_MODEL` field plus a `ColumnConfig` entry, reusing the existing read-only projection machinery (`rowReadOnly: () => true`, `unhideable: true`) rather than a new `Component` or layout primitive. No spacer/filler-column precedent exists in the codebase; this is the minimal construct that composes existing pieces.[^new-construct]

### Blank header via a new `ColumnConfig.headerText`, mirroring `headerGlyph`

The header cell's display text is `field.getName()` today ([cell/Header.ts:451](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L451)). A new optional `ColumnConfig.headerText` — read through `Column.getHeaderText()` and consumed at that one call site — lets the filler render an empty header while keeping a real field name for identity. This mirrors the existing `headerGlyph` path exactly (`ColumnConfig.headerGlyph` → [`Column.getHeaderGlyph()`](packages/lib/src/typescript/lib/component/table/Column.ts#L112) → [`col?.getHeaderGlyph()`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L449)), the closest precedent for a per-column header presentation override.[^headertext]

### The filler counts toward ARIA `colCount`

`bindView` reports `getColumns().length`, which becomes 3 ([Table.ts:1045](packages/lib/src/typescript/lib/component/table/Table.ts#L1045)). The filler is left in that count — it is a physically rendered grid column, matching how normal tables count every rendered column.[^aria]

---

## Public API

One new optional field on the existing `ColumnConfig` interface, plus its accessor on `Column`. Both mirror the `headerGlyph` shape (getter-only on `Column`, like `getMinWidth` / `getGroup`).

```typescript
// component/table/ColumnConfig.ts — ColumnConfig interface
/**
 * Overrides the header label for this column. Defaults to the field name.
 * Set to '' to render a blank header (used by the rotated view's filler column).
 */
headerText ?: string;
```

```typescript
// component/table/Column.ts
getHeaderText(): string | null;   // returns the configured headerText, or null when unset
```

---

## Internal Structure

### Filler field in `ROTATED_MODEL` ([Table.ts:37](packages/lib/src/typescript/lib/component/table/Table.ts#L37))

```typescript
const ROTATED_MODEL = new Model([
    { name: 'field',  type: 'string', order: 0 },
    { name: 'value',  type: 'auto',   order: 1 },
    { name: 'filler', type: 'string', order: 2 },   // blank spacer column; absorbs slack
]);
```

`filler` is type `string` so the layout treats it as flexible. Projection records are built as `{ field, value }` only ([Table.ts:946](packages/lib/src/typescript/lib/component/table/Table.ts#L946)) — no `filler` key — so every filler cell binds `undefined` and renders blank.

### Rotated spec in `ensureRotatedStore` ([Table.ts:901](packages/lib/src/typescript/lib/component/table/Table.ts#L901))

```typescript
const spec: ColumnSpec = {
    columns: [
        { field: 'field', minWidth: 80,  maxWidth: 200, unhideable: true },
        {
            field: 'value',
            minWidth: 120,
            maxWidth: 360,
            unhideable: true,
            cellType:   (r) => this.rotatedCellType(r),
            cellValues: (r) => this.rotatedCellValues(r),
        },
        { field: 'filler', headerText: '', minWidth: 0, unhideable: true },
    ],
    rowReadOnly: () => true,
};
```

The filler carries no `cellType` / `cellValues`, so `rotatedCellType` / `rotatedCellValues` are never invoked for it — the filler cannot fall into the number / date / combo paths. `rowReadOnly: () => true` already makes every cell in every row read-only, filler included.

### Slack-redistribution helper ([layout/Table.ts](packages/lib/src/typescript/lib/layout/Table.ts))

```typescript
/**
 * Adds any positive leftover width — space freed when a flexible column
 * clamped to its maxWidth — to the flexible columns that declare no maxWidth,
 * so an unbounded "filler" column grows to fill the table instead of leaving
 * dead space at the right edge. A no-op when the columns already fill the
 * width (the common case) or overflow it.
 */
private absorbSlackIntoGreedy(columns: Column[], widths: number[], availableWidth: number): number[] {
    const slack = availableWidth - widths.reduce((s, w) => s + w, 0);

    if (slack <= 0.5) {
        return widths;
    }

    const greedy: number[] = [];

    columns.forEach((col, i) => {
        const t      = col.getField().getType();
        const isFlex = t !== 'boolean' && t !== 'number' && t !== 'date';

        if (isFlex && col.getMaxWidth() === undefined) {
            greedy.push(i);
        }
    });

    if (greedy.length === 0) {
        return widths;
    }

    const share  = slack / greedy.length;
    const result = [...widths];

    for (const i of greedy) {
        result[i] += share;
    }

    return result;
}
```

`initializeWidths` returns `this.absorbSlackIntoGreedy(columns, widths, availableWidth)` in place of its bare `intrinsic.map(...)` result; `rescaleWidths` wraps its final mapped array the same way (its early-return path is left untouched — that branch fires only when the width is unchanged, so the widths already fill it).

---

## Ordered Implementation Steps

1. **`component/table/ColumnConfig.ts`** — add the optional `headerText ?: string;` field to `ColumnConfig` with the JSDoc from `## Public API`.

2. **`component/table/Column.ts`** — add a `private _headerText: string | null;` field, initialise it in the constructor (`this._headerText = config?.headerText ?? null;`, placed beside `_headerGlyph`), and add a getter-only `getHeaderText(): string | null { return this._headerText; }` mirroring `getHeaderGlyph`.

3. **`component/table/cell/Header.ts`** (line 451) — change the `HeaderCell` display-text argument from `field.getName()` to `col?.getHeaderText() ?? field.getName()`. Leave the second argument (`field.getName()`, the sort field / identity) unchanged. `col` is already in scope (resolved at line 445).
   - Check: `grep -n "new HeaderCell" packages/lib/src/typescript/lib/component/table/cell/Header.ts` — expect the one call site now reading `col?.getHeaderText()`.

4. **`layout/Table.ts`** — add the `absorbSlackIntoGreedy` private method (see `## Internal Structure`). In `initializeWidths`, wrap the returned array: `return this.absorbSlackIntoGreedy(columns, widths, availableWidth);` (name the current `intrinsic.map(...)` result `widths` first). In `rescaleWidths`, wrap the final `columnWidths.map(...)` result the same way; do not alter the early-return `return columnWidths;`.

5. **`component/table/Table.ts`** (line 37) — add the `filler` field to `ROTATED_MODEL` (`{ name: 'filler', type: 'string', order: 2 }`).

6. **`component/table/Table.ts`** (`ensureRotatedStore`, line 901) — add `maxWidth: 200` to the `field` config, `maxWidth: 360` to the `value` config, and append the filler config `{ field: 'filler', headerText: '', minWidth: 0, unhideable: true }` (see `## Internal Structure`).

7. **`tests/component/table/RotatedView.test.ts`** — update the pinned assertions and add the bounded-width case (see `## Expected Behaviour`).

8. **`docs/components/Table.md`** (line 141) — reword the `setColumnVisible` bullet so it no longer claims "two columns": e.g. "the projection's data columns are always shown". Optionally note the trailing filler column.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/ColumnConfig.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Column.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/tests/component/table/RotatedView.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |

---

## Expected Behaviour

Unit-testable (offline harness) unless marked manual.

### Column set (updates `'rotation swaps the column set to field/value'`, line 74)

Rotating yields three columns in order `field`, `value`, `filler`.

```typescript
const cols = table.getColumns();
expect(cols.length).toBe(3);
expect(cols.map(c => c.getField().getName())).toEqual(['field', 'value', 'filler']);
```

### Projection rows are unchanged (no edit to `'produces one projection row per visible source column'`, line 86)

The filler is a **column**, not a row. There is still one row per visible source field; `rows.map(r => r.get('field'))` stays `['id', 'name', 'active', 'created']`. This test must keep passing verbatim.

### Bounded widths + filler absorbs slack (updates `'re-initializes column widths…'`, line 287, and adds a wide-table case)

At `setWidth(600)` all three flexible columns fall below their caps and share roughly evenly; length becomes 3:

```typescript
// setWidth(600); setHeight(400); setDisplayMode('rotated'); doLayout();
const widths = table.getColumnWidths();
expect(widths.length).toBe(3);
expect(widths[0]).toBeGreaterThanOrEqual(80);
expect(widths[1]).toBeGreaterThanOrEqual(120);
expect(widths[0]).toBeLessThanOrEqual(200);   // field cap
expect(widths[1]).toBeLessThanOrEqual(360);   // value cap
```

New wide-table case pins the bounding and the filler absorbing the rest (rename the test to reflect three columns). At `setWidth(1200)` the per-column flex share (~394 px) exceeds both caps, so `field` and `value` clamp exactly to their maxima and the filler takes the remainder:

```typescript
// setWidth(1200); setHeight(400); setDisplayMode('rotated'); doLayout();
const widths = table.getColumnWidths();
expect(widths.length).toBe(3);
expect(widths[0]).toBe(200);              // field at its max
expect(widths[1]).toBe(360);              // value at its max
expect(widths[2]).toBeGreaterThan(widths[1]);  // filler is the widest — absorbed the slack
```

### `setColumnVisible` inert (updates line 303)

```typescript
// setDisplayMode('rotated'); setColumnVisible('id', false);
expect(table.getColumns().length).toBe(3);
```

### Every projection cell read-only, filler included (no assertion edit to `'renders every projection cell read-only'`, line 330)

The loop already iterates `row.getComponents()` — now three cells per row. The filler cell must report `isReadOnly() === true` (delivered by `rowReadOnly: () => true`). The test keeps passing with three cells; verify the filler cell does not throw during cell-type resolution.

### Value variants preserved (no edit to `'keeps each value cell at its source-field variant…'`, line 161)

The value cell is still `getComponents()[1]`; the filler sits at index 2 and does not shift it. `valueCell.getEditorKey()` for the `id` row stays `'number'`.

### Round trip and un-rotate (no edit, lines 261, 313)

Returning to normal restores four source columns; the filler exists only in the rotated projection.

### Manual verification (browser, not offline)

- Run the app and open the Rotated demo panel. On a wide table, `field` and `value` stay compact and left-grouped; a numeric value right-aligns inside its bounded `value` cell rather than floating to the far right; the filler region right of `value` is blank with an empty header.
- Resize the window wider while rotated: the filler grows to keep the row full (exercises `rescaleWidths` + the helper); `field` / `value` stay at their caps.

---

## Verification

- `npm run test -- RotatedView` — the updated + new cases above go green.
- `npm run test -- packages/lib/tests/component/table` — no regression in the wider table/layout suites (column count, header, DynamicCell).
- Typecheck: `npm run typecheck` (or the project's TS build) — `headerText` / `getHeaderText` resolve, no unused-symbol errors.
- `grep -n "new HeaderCell" packages/lib/src/typescript/lib/component/table/cell/Header.ts` — the sole call site reads `col?.getHeaderText() ?? field.getName()`.
- Manual smoke per `## Expected Behaviour` on the Rotated demo panel.
- `npm run docs:build` — zero warnings (new `ColumnConfig.headerText` JSDoc, no `{@link}` to internal symbols).

---

## Documentation Impact

- `ColumnConfig.headerText` is a new public field on a documented interface; the JSDoc above is what TypeDoc renders. Do not `{@link}` any internal symbol from it.
- `docs/components/Table.md` line 141 currently states the projection has "two columns"; reword so it does not contradict the third filler column.

---

## Potential Challenges

- **Slack helper must stay a no-op for normal tables.** It only fires when a flexible column clamps below the leftover (i.e. declares a `maxWidth`), which normal string/auto columns rarely do; the `slack <= 0.5` guard makes the common path return the array unchanged. Verify by running the full table layout suite.
- **`rescaleWidths` early-return.** Leaving it untouched is deliberate — it fires only when the width is unchanged, so the widths already fill it; routing it through the helper would be redundant.
- **Filler header must render truly empty.** `headerText: ''` is not nullish, so `col?.getHeaderText() ?? field.getName()` yields `''`, not the field name. A regression here (e.g. using `||`) would show "filler".
- **Sorting the filler header** sorts the projection by an all-`undefined` field; a stable sort leaves row order unchanged, so it is a harmless no-op — no special handling needed.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts) — `initializeWidths` (309), `rescaleWidths` (351), `clamp` (385); where slack is currently lost and where the helper plugs in.
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) — `ROTATED_MODEL` (37), `ensureRotatedStore` (896), `rebuildRotatedStore` (930), `rotatedCellType` / `rotatedCellValues` (961 / 982), `bindView` (1018).
- [`packages/lib/src/typescript/lib/component/table/ColumnConfig.ts`](packages/lib/src/typescript/lib/component/table/ColumnConfig.ts) — `ColumnConfig` shape; confirms only `minWidth` / `maxWidth` exist (no flex/weight).
- [`packages/lib/src/typescript/lib/component/table/Column.ts`](packages/lib/src/typescript/lib/component/table/Column.ts) — `getHeaderGlyph` (112) is the precedent for `getHeaderText`; `getMaxWidth` (72) is what the helper reads.
- [`packages/lib/src/typescript/lib/component/table/cell/Header.ts`](packages/lib/src/typescript/lib/component/table/cell/Header.ts) — the `new HeaderCell(...)` call site (451) and `col?.getHeaderGlyph()` precedent (449).
- [`packages/lib/tests/component/table/RotatedView.test.ts`](packages/lib/tests/component/table/RotatedView.test.ts) — the pinned contract to update.

---

## Non-Goals

- **Making the filler editable or data-bearing.** It is a presentational spacer; the projection stays read-only.
- **A general per-column flex/weight system.** Only `maxWidth` + one unbounded flexible column is introduced; a weight model is out of scope.
- **Excluding the filler from ARIA `colCount`.** Kept as a rendered column count (see decision).
- **Changing export.** `exportCSV` / `exportJSON` already serialize source columns via `getSourceColumns` / `_resolvedColumns` ([Table.ts:1182](packages/lib/src/typescript/lib/component/table/Table.ts#L1182)); the filler lives only in the rotated projection and never reaches them — no change.
- **Suppressing sort on the filler header.** A no-op sort is harmless; adding a suppression path is not worth the surface.

---

## Notes

[^bounds]: `field` at 200 px comfortably holds a source field name; `value` at 360 px holds typical string / number / date values while keeping a right-aligned number close to its label. Both exceed their existing minima (`field` 80, `value` 120), preserving `min ≤ max`. The exact pixels are presentation defaults, not load-bearing — a later tweak needs no structural change.

[^no-flex]: Confirmed by reading `ColumnConfig` (only `minWidth` / `maxWidth` width knobs) and `layout/Table.ts` `initializeWidths`, where a column is "flexible" iff its field type is not `boolean` / `number` / `date` (those get a fixed intrinsic width). There is no `flex` / `weight` / `preferredWidth` field anywhere in the column config or layout. So "bounded" must be expressed as `maxWidth`, and "grows to fill" as an unbounded flexible column.

[^redistribute]: In `initializeWidths` the flexible columns each receive `rawFlex = (availableWidth − fixedTotal) / flexCount` and are clamped independently to `[min, max]`. When a flexible column clamps down to its `maxWidth`, the space it releases is not handed to anyone — the widths sum to less than the available width and the header/body row under-fills at the right edge. For the rotated view this means `field` (max 200) and `value` (max 360) would clamp while the filler received only its equal `1/3` share, leaving a blank strip. The helper adds that positive leftover to the unbounded flexible columns, making the filler take exactly the remainder. For a normal table the flexible columns have no `maxWidth`, none clamp, the widths already sum to the available width, and the `slack <= 0.5` guard returns the array unchanged — zero behaviour change. `rescaleWidths` has the same gap on resize (it scales flex columns proportionally then clamps, losing the clamped-away space), so the helper is applied there too. Only positive slack is absorbed; negative slack (content wider than the table) is left to overflow / horizontal-scroll exactly as today.

[^new-construct]: Searched for an existing spacer / filler / blank column and for a flex-weight mechanism in `ColumnConfig`, `Column`, and both `Table` files; none exists. The chosen approach adds no new component or layout primitive — it is a `ROTATED_MODEL` field plus a `ColumnConfig` entry that reuses the read-only (`rowReadOnly`), unhideable, and type-flexible mechanisms already in place. This is the "compose before specializing" path: the filler is arrangement, not coordination.

[^headertext]: The alternative — naming the filler field `''` so `field.getName()` renders blank — was rejected: an empty field name is used as a `Map` key and hidden-set entry throughout the header and body, and risks truthiness landmines. `headerText` keeps a real identity (`filler`) and decouples the label, exactly as `HeaderCell(text, fieldName, glyph)` already separates the two arguments — the one call site simply stopped passing the name for both. Adding it to `ColumnConfig` (rather than a post-resolve `Column` mutation) keeps it consistent with `headerGlyph`, `group`, and `groupColor`, which all flow config → `Column` getter → `Header`.

[^aria]: Reporting `colCount` as 3 announces one empty trailing column to assistive tech — a minor cost against special-casing shared `bindView` to subtract a decorative column. The projection is an inspection view; the honest "three rendered columns" count is consistent with how normal tables report every rendered column, and avoids coupling `bindView` to the filler's identity. If a11y feedback later argues otherwise, subtracting the filler is a localized follow-up.
