# Table Column Auto-Size Fixes — Implementation Plan

## Overview

Two defects in the `Table` component's column-sizing machinery, grouped into one plan because both live in the same width-derivation code path and were found during the same investigation.

**Rotated `value`-column width.** [`Table.setDisplayMode("rotated")`](packages/lib/src/typescript/lib/component/table/Table.ts#L388) shows one record as a `field`/`value` list, one row per source field. The projection's `field` and `value` columns carry hand-tuned bounds (`minWidth`/`maxWidth` 80/200 and 120/360) declared in [`ensureRotatedStore`](packages/lib/src/typescript/lib/component/table/Table.ts#L999). [`isAutoSizeColumns()`](packages/lib/src/typescript/lib/component/table/Table.ts#L1464) is forced `false` whenever the table is rotated, which makes [`resolveContentCandidates`](packages/lib/src/typescript/lib/component/table/Table.ts#L1593) return `null` for every rotated column — so `field`/`value` are flex columns with no real preferred width. On any table wider than roughly 1080px this pins both columns flat at their `maxWidth`, confirmed by [`RotatedView.test.ts:378-393`](packages/lib/tests/component/table/RotatedView.test.ts#L378) (`setWidth(1200)` → `widths[1] === 360` regardless of what the record actually holds). A `value` column pinned wide, mixing a right-aligned number row against left-aligned string/date rows, is what reads as jarring — narrowing the column to its real content removes the empty space those rows were floating across, without touching alignment.

This plan makes `field` and `value` measure the *actual displayed record* — the field labels and formatted values genuinely on screen — reusing the same per-type width policy [`columnWidthPolicy`](packages/lib/src/typescript/lib/component/table/Table.ts#L1745) already applies to ordinary auto-sized columns, rather than adding a second measurement mechanism. `NumberRenderer`'s alignment is untouched: every `DynamicCell` variant keeps `Text`'s existing per-type default (right for numbers, left for everything else), in every context, including inside `DynamicCell`. The width fix is what resolves the visual complaint; alignment is not part of this plan.

**Date/datetime auto-size undershoot.** `ColumnSpec.autoSizeColumns` sizes columns from the same per-type width policy (shipped in 0.4.0, see `plans/implemented/table-generated-column-widths.md`). Two gaps in that policy undershoot a value's real rendered width — because every cell renderer's `Text` defaults to `truncate: true`, this shows up as a silent ellipsis rather than a build error. Both fixes extend the existing policy in place. This half of the plan is unchanged from the previous draft, re-verified against current source.

Both problems touch `columnWidthPolicy` / `ensureWidthReferences` / `resolveContentCandidates`, so their implementation steps are ordered to avoid overlap: the date/datetime fix (Problem B) lands first since it changes the `default` branch's formula that the rotated fix (Problem A) then relies on unmodified.

---

## Architecture Decisions

### Rotated `field`/`value` route through the existing string/auto default branch — no new width-policy branch

`field` (type `string`) and `value` (type `auto`) already fall into `columnWidthPolicy`'s `default` case — the same branch every ordinary auto-sized `string`/`auto` column uses. The only gap is that `resolveContentCandidates` never feeds that branch a `contentPx` for a rotated column. The fix is entirely in candidate collection: a new branch in `resolveContentCandidates` supplies real candidate strings for `field`/`value` when rotated; `columnWidthPolicy` itself needs no rotated-specific case.[^precedent]

### This supersedes the "auto-sizing the rotated projection" non-goal

`plans/implemented/table-generated-column-widths.md`'s Non-Goals section states: *"Auto-sizing the rotated projection. Its `field` / `value` / `filler` columns carry hand-tuned min/max widths already"* — matched by the doc comment above `isAutoSizeColumns` ([Table.ts:1464](packages/lib/src/typescript/lib/component/table/Table.ts#L1464)). This plan deliberately reverses that scoping decision for `field`/`value` (not `filler`): the hand-tuned bounds alone can't fix a mixed-cell-type row that's jarring only because the column is wider than its content needs, and the auto-sizing infrastructure that scoping decision deferred to already exists and already solves "compute a real preferred width from actual content" for every other column type.

### Content is measured from the live projection, not sampled

The normal-mode content path (`collectCandidates`, [Table.ts:1641](packages/lib/src/typescript/lib/component/table/Table.ts#L1641)) samples up to `SAMPLE_ROWS` records from `this._store` — the *source* store, keyed by real field names. Rotated columns are named `field`/`value`/`filler`, which don't exist on source records, so that path cannot be reused as-is. Instead, a new method reads every row directly from `this.ensureRotatedStore().getRecords()` ([Table.ts:999](packages/lib/src/typescript/lib/component/table/Table.ts#L999)) — exact, not sampled, because the rotated store holds at most one row per visible source field for a single displayed record, not a full column of many rows.

### `filler` is excluded by name, not by type

The new candidate method returns `null` for any column whose field name isn't `field` or `value` — `filler` included. `filler`'s intrinsic width therefore stays `null` (flex), so [`absorbSlackIntoGreedy`](packages/lib/src/typescript/lib/layout/Table.ts#L408) keeps handing it the leftover width exactly as it does today, while `field`/`value` now contribute a real, non-null, clamped width to the fixed total `absorbSlackIntoGreedy` computes slack against.

### Per-row measurement mirrors each cell variant's own rendered text

A rotated `value` row's cell type varies per row (`DynamicCell`, driven by [`rotatedCellType`](packages/lib/src/typescript/lib/component/table/Table.ts#L1066)). The new measurement matches what [`DynamicCell.buildRenderer`](packages/lib/src/typescript/lib/component/table/cell/Dynamic.ts#L225) actually renders for each variant:

| Row's resolved cell type | Text measured | Matches |
|---|---|---|
| `string` / `auto` / `number` | `String(value)` via `TableExporter.formatValue` (pass-through for non-`Date` values) | [`StringRenderer.setValue`](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L55) / [`NumberRenderer.setValue`](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts#L54) |
| `date` | `value.toLocaleDateString()` via `TableExporter.formatValue`'s `date` case | [`DateRenderer.setValue`](packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L30) |
| `time` / `datetime` | `toLocaleTimeString`/`toLocaleString`, no seconds | `TimeRenderer`/`DateTimeRenderer.setValue`[^showseconds] |
| `combo` | the option's label (e.g. `"AU"` → `"Australia"`) | [`ComboRenderer.setValue`](packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts#L74)'s value→label map |
| `boolean` / `glyph` | not measured (skipped) | renders a fixed-size control, not text |

[`TableExporter.formatValue`](packages/lib/src/typescript/lib/component/table/TableExporter.ts#L99) is called against the row's *source* `Column` — found by field name in `this.getSourceColumns()` — never the rotated `value` pseudo-column, whose own declared type is always `'auto'` and would defeat the date/time/datetime switch inside `formatValue`.

### `field`/`value` min/max stay as declared

The existing `minWidth`/`maxWidth` on `field` (80/200) and `value` (120/360) ([Table.ts:1006-1013](packages/lib/src/typescript/lib/component/table/Table.ts#L1006)) are unchanged. Their role changes from *the width regardless of content* (today, since these columns were pure flex) to a floor/ceiling around a real content-derived preferred width — `Util.clamp` already enforces both ends via `clampColumnWidth` ([Table.ts:1514](packages/lib/src/typescript/lib/component/table/Table.ts#L1514)) whether or not the content-driven preferred value is inside the range, so no new constant is needed.

### Width recomputes on record switch, not on every layout pass

Two of `rebuildRotatedStore`'s three call sites — [`selectRecord`](packages/lib/src/typescript/lib/component/table/Table.ts#L734)'s rotated branch and [`onSourceStoreChange`](packages/lib/src/typescript/lib/component/table/Table.ts#L971) — now also clear `_columnWidths` / `_savedColumnWidths` / `_columnWidthTarget` and call `this.doLayout()` after `rebuildRotatedStore()` returns, mirroring the reset [`bindView`](packages/lib/src/typescript/lib/component/table/Table.ts#L1148) already performs on a full mode switch. Clearing `_columnWidths` is what makes `layout/Table.ts`'s `doLayout` ([layout/Table.ts:125](packages/lib/src/typescript/lib/layout/Table.ts#L125)) take the `initializeWidths` branch instead of `rescaleWidths` — without it, a plain `doLayout()` after a record switch would only proportionally rescale the *previous* record's widths, never re-consulting content.

`rebuildRotatedStore` itself is left unmodified — its third call site, inside `setDisplayMode("rotated")` ([Table.ts:400](packages/lib/src/typescript/lib/component/table/Table.ts#L400)), runs *before* `bindView` re-points the header/body at the rotated store, so a `doLayout()` there would run against not-yet-rebound components. `bindView`'s own existing reset (called immediately after, at line 401) already covers that entry path.

`_widthRefs` (cached digit-glyph widths) is deliberately **not** cleared on a record switch: rotated column *types* never change between records (only the values do), so the cached digit metrics stay valid — clearing it would force a wasted remeasurement on every Previous/Next click. On a plain container resize (no record change), `field`/`value` are rescaled proportionally like any other auto-sized `string`/`auto` column already is — `rescaleWidths` ([layout/Table.ts:360](packages/lib/src/typescript/lib/layout/Table.ts#L360)) is untouched, so this plan does not add a resize-triggered remeasurement.[^compat]

### The `TableExporter.formatValue` `'auto'`-column gap stays out of scope for normal mode only

The previous draft's Non-Goal — that a `ColumnConfig.cellType` (`DynamicCell`) column's static field type is always `'auto'`, so `collectCandidates`'s normal-mode sampling measures a raw `Date.toString()` instead of the short localized string actually rendered — still applies to a **non-rotated** table with `autoSizeColumns: true` on a `DynamicCell` column (e.g. `PropertyGridPanel`, if such a table opted in). It does not apply to the rotated `value` column: this plan's new measurement path resolves each row against its real *source* column type before calling `formatValue`, which is exactly the fix that gap needs — just scoped to rotated mode only, because that is where the per-row source type is cheaply known without threading `cellType` resolution through `collectCandidates`.

---

## Internal Structure

`resolveContentCandidates`, with the new rotated branch (inserted before the existing `isAutoSizeColumns()` gate, which stays `false` in rotated mode and must not gate this path):

```ts
// packages/lib/src/typescript/lib/component/table/Table.ts
private resolveContentCandidates(col: Column): string[] | null {
    const type = col.getField().getType();

    if (type !== "string" && type !== "auto") {
        return null;
    }

    if (this._displayMode === "rotated") {
        return this.resolveRotatedContentCandidates(col);
    }

    // autoSizeColumns gates the whole fallback chain below, not just the
    // store sample: with the flag off a string/auto column stays flex,
    // exactly as before this feature, even when it declares `values` or
    // `maxContentLength`.
    if (!this.isAutoSizeColumns()) {
        return null;
    }
    // ...unchanged below
}
```

Two new private methods, placed next to `resolveContentCandidates`:

```ts
// packages/lib/src/typescript/lib/component/table/Table.ts

/**
 * Content candidates for the rotated `field`/`value` columns, measured
 * from the currently displayed record instead of a store sample — the
 * rotated store holds at most one row per visible source field, so every
 * row is used exactly, not a sampled subset.
 *
 * @param col - The rotated `field`, `value`, or `filler` column.
 * @returns Up to `WIDEST_CANDIDATES` distinct candidate strings, longest
 *   first, or `null` for `filler` (stays flex, absorbing the leftover
 *   width) or when there is nothing to measure (no displayed record).
 */
private resolveRotatedContentCandidates(col: Column): string[] | null {
    const name = col.getField().getName();

    if (name !== 'field' && name !== 'value') {
        return null;
    }

    const records = this.ensureRotatedStore().getRecords();
    const sourceColumns = name === 'value'
        ? new Map(this.getSourceColumns().map(c => [c.getField().getName(), c]))
        : null;
    const list: string[] = [];

    for (const record of records) {
        const text = name === 'field'
            ? String(record.get('field') ?? '')
            : this.formatRotatedValueText(record, sourceColumns!);

        if (text !== null) {
            this.keepLongest(list, text);
        }
    }

    return list.length > 0 ? list : null;
}

/**
 * Formats one rotated `value` row's text the way its own resolved
 * `DynamicCell` renderer actually displays it — mirrors
 * {@link DynamicCell.bindRecord}'s variant resolution so the measured
 * string matches the rendered one.
 *
 * @param record - One projection record (`field`/`value` pair).
 * @param sourceColumns - Visible source columns keyed by field name.
 * @returns The display text, or `null` for `boolean`/`glyph` rows (a
 *   fixed-size control, not measurable text) or an unresolvable field.
 */
private formatRotatedValueText(record: ModelRecord, sourceColumns: Map<string, Column>): string | null {
    const cellType = this.rotatedCellType(record);

    if (cellType === 'boolean' || cellType === 'glyph') {
        return null;
    }

    if (cellType === 'combo') {
        const labelByValue = new Map(normalizeComboOptions(this.rotatedCellValues(record) ?? []).map(o => [o.value, o.label]));
        const value        = String(record.get('value') ?? '');

        return labelByValue.get(value) ?? value;   // mirrors ComboRenderer.setValue
    }

    const sourceColumn = sourceColumns.get(record.get('field') as string);

    if (!sourceColumn) {
        return null;
    }

    // Empty configs map, not this._columnConfigs: the rotated `value`
    // DynamicCell's own config never threads `showSeconds` through
    // (ensureRotatedStore's spec doesn't set it on the `value` column), so
    // every time/datetime row renders without seconds today regardless of
    // the source column's own setting. Matching that here keeps the
    // measured text the same length as what actually renders.
    return String(TableExporter.formatValue(sourceColumn, record.get('value'), new Map()) ?? '');
}
```

`selectRecord`'s rotated branch, with the added reset (inserted between the existing `rebuildRotatedStore()` call and `emit`):

```ts
// packages/lib/src/typescript/lib/component/table/Table.ts — selectRecord
this._rotatedRecord = record;
this.rebuildRotatedStore();

// The new record's field/value content may need a different width than
// the old one's; re-derive from getIntrinsicColumnWidths instead of
// leaving the next doLayout rescale the stale widths.
this._columnWidths      = [];
this._savedColumnWidths = new Map();
this._columnWidthTarget = 0;
this.doLayout();

this.emit("selection", record ? [record] : []);
```

`onSourceStoreChange`, with the same reset appended after its existing `rebuildRotatedStore()` call:

```ts
// packages/lib/src/typescript/lib/component/table/Table.ts — onSourceStoreChange
this.rebuildRotatedStore();

this._columnWidths      = [];
this._savedColumnWidths = new Map();
this._columnWidthTarget = 0;
this.doLayout();
```

`columnWidthPolicy`'s `default` branch, after the Problem B fix (unchanged from the previous draft — Problem A's new candidates flow through this same branch):

```ts
// packages/lib/src/typescript/lib/component/table/Table.ts — default branch
default: {   // "string" and "auto"
    const min = Math.max(MIN_COLUMN_WIDTH_PX, refs.digitPx * MIN_STRING_CHARS + CELL_CHROME_PX);

    if (contentPx === null) {
        return { min, preferred: null };
    }

    return { min, preferred: Math.max(min, contentPx + CELL_CHROME_PX, headerPx) };
}
```

`dateReferenceKeys` / `ensureWidthReferences`, after the Problem B fix (unchanged from the previous draft) — `dateReferenceKeys` returns several candidate texts per key instead of one, and `ensureWidthReferences` keeps the widest per key, all inside the same single batched `measureTextWidths` call:

```ts
// packages/lib/src/typescript/lib/component/table/Table.ts

private dateReferenceKeys(): Array<{ key: string; texts: string[] }> {
    const digitChars = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const seen = new Map<string, string[]>();

    for (const col of this.getColumns()) {
        const type = col.getField().getType();

        if (type !== "date" && type !== "time" && type !== "datetime") {
            continue;
        }

        const key = `${type}:${this.showsSeconds(col)}`;

        if (!seen.has(key)) {
            const base = String(TableExporter.formatValue(col, REFERENCE_DATE, this._columnConfigs) ?? "");

            // Guards against a non-tabular font rendering some other digit wider
            // than REFERENCE_DATE's own digits: substitute every digit position
            // with each of 0-9 and keep the widest variant, mirroring the
            // per-digit-max defense `digitPx` already applies to `number`
            // columns. A no-op (all variants equal) under a tabular font.
            seen.set(key, [base, ...digitChars.map(d => base.replace(/\d/g, d))]);
        }
    }

    return Array.from(seen, ([key, texts]) => ({ key, texts }));
}

private ensureWidthReferences(): WidthReferences {
    if (this._widthRefs) {
        return this._widthRefs;
    }

    const digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const keys   = this.dateReferenceKeys();
    const widths = Util.measureTextWidths([...digits, ...keys.flatMap(k => k.texts)]);

    const datePx = new Map<string, number>();
    let offset = digits.length;

    for (const k of keys) {
        datePx.set(k.key, Math.max(...widths.slice(offset, offset + k.texts.length)));
        offset += k.texts.length;
    }

    this._widthRefs = {
        digitPx: Math.max(...widths.slice(0, digits.length)),
        datePx,
    };

    return this._widthRefs;
}
```

Update `WidthReferences.datePx`'s doc comment ([Table.ts:85](packages/lib/src/typescript/lib/component/table/Table.ts#L85), currently "Width of `REFERENCE_DATE` formatted, keyed by `${type}:${showSeconds}`") to describe the widened, max-of-variants value.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/table/Table.ts`** — in `columnWidthPolicy`'s `default` branch, change `Math.max(min, contentPx, headerPx)` to `Math.max(min, contentPx + CELL_CHROME_PX, headerPx)`.
2. **`packages/lib/src/typescript/lib/component/table/Table.ts`** — replace `dateReferenceKeys` and `ensureWidthReferences` with the versions in `## Internal Structure`. Update `WidthReferences.datePx`'s doc comment to match. → verify: `npm run typecheck`.
3. **`packages/lib/src/typescript/lib/component/table/Table.ts`** — add `resolveRotatedContentCandidates` and `formatRotatedValueText` as new private methods, placed after `resolveContentCandidates`. → verify: `npm run typecheck`.
4. **`packages/lib/src/typescript/lib/component/table/Table.ts`** — in `resolveContentCandidates`, insert the `this._displayMode === "rotated"` branch shown in `## Internal Structure`, right after the `type !== "string" && type !== "auto"` early return and before the `isAutoSizeColumns()` gate. This is the call site for the methods step 3 added.
5. **`packages/lib/src/typescript/lib/component/table/Table.ts`** — in `selectRecord`'s rotated branch, insert the width-reset + `doLayout()` block from `## Internal Structure` between `this.rebuildRotatedStore();` and `this.emit(...)`.
6. **`packages/lib/src/typescript/lib/component/table/Table.ts`** — in `onSourceStoreChange`, append the same width-reset + `doLayout()` block after its `this.rebuildRotatedStore();` call (the function's last line). → verify: `grep -n "resolveRotatedContentCandidates\|formatRotatedValueText" packages/lib/src/typescript/lib/component/table/Table.ts` shows both new methods plus their two call sites in `resolveContentCandidates`/`resolveRotatedContentCandidates`.
7. **`packages/lib/tests/component/table/RotatedView.test.ts`** — update `'bounds field/value and lets the filler absorb the slack on a wide table'` (currently asserts `widths[0] === 200` / `widths[1] === 360`): replace with `widths[0]).toBeGreaterThanOrEqual(80)`, `widths[0]).toBeLessThan(200)`, `widths[1]).toBeGreaterThanOrEqual(120)`, `widths[1]).toBeLessThan(360)` — the default record's short field names/values no longer pin either column to its cap — keeping the existing `widths[2]).toBeGreaterThan(widths[1])` filler-absorbs-slack assertion.
8. **`packages/lib/tests/component/table/RotatedView.test.ts`** — add a test asserting the `value` column's width still clamps at its ceiling for pathologically long content: select a record whose string field holds a long value (60+ characters), rotate at a wide table width, `doLayout()`, and assert `widths[1]).toBeLessThanOrEqual(360)` while `widths[1]` is meaningfully larger than the short-content case (e.g. `toBeGreaterThan(200)`).
9. **`packages/lib/tests/component/table/RotatedView.test.ts`** — add a test asserting the `value` column's width follows a record switch: rotate on a record with short content, capture `table.getColumnWidths()[1]`, then `table.selectRecord(...)` a different record whose content is much longer, and assert the new `widths[1]` is strictly greater than the first — this exercises the reset added in step 5.
10. **`packages/lib/tests/component/table/RotatedView.test.ts`** — add a test asserting a `combo`-typed row is measured by its label, not its stored code: construct a table whose spec declares `values` on one field with a short value and a much longer label, rotate on a record holding that value, and assert `widths[1]` is large enough to fit the label (e.g. `toBeGreaterThan(200)`), not just the short code.
11. **`packages/lib/tests/component/table/ColumnWidths.test.ts`** — add a case under "Auto-size and content" asserting a `string`/`auto` auto-sized column's `getIntrinsicColumnWidths()` entry equals `contentPx + CELL_CHROME_PX` when content is the binding term (construct a case where the sampled candidate's measured width exceeds both `min` and `headerPx`, then compare against a manually computed `Util.measureTextWidths([candidate])[0] + CELL_CHROME_PX`).
12. **`packages/lib/tests/component/table/ColumnWidths.test.ts`** — add a new `describe` block with its own `beforeEach`/`afterEach` installing a **non-uniform-digit** font config (this file's existing font gives every digit an equal 8px advance — see the file's own header comment for why; mirror that pattern with a font whose digit advances differ, e.g. `'0': 8, '1': 4, ..., '8': 14`). Assert that a `date` (or `time`/`datetime`) column's `getColumnMinWidth` reflects the widest-digit variant, not `REFERENCE_DATE`'s own digits — e.g. construct the column, then independently compute the expected floor via the same digit-substitution the fix performs and compare. → verify: `npm run test -- ColumnWidths`.
13. **`packages/lib/docs/components/Table.md`** — in the "Rotated record view" section, extend the bullet at line 177 ("The `field` and `value` columns stay compact...") to note the two columns size to the displayed record's actual field labels and values, not just a fixed cap.
14. **`packages/lib/docs/reference/changelog/next.md`** — under `## Fixed` → `### Table`, add two bullets (mirroring the section's existing style: bold summary sentence, "No consumer action is needed" where true) — one for the rotated `field`/`value` content-aware sizing, one for the date/datetime auto-size undershoot.
15. Run the full verification pass in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/tests/component/table/RotatedView.test.ts` |
| Modify | `packages/lib/tests/component/table/ColumnWidths.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

**Rotated `value`/`field` width (unit-testable):**

| Scenario | `widths[0]` (`field`) | `widths[1]` (`value`) |
|---|---|---|
| Wide table (1200px), default record, short field names/values | in `[80, 200)` — below cap | in `[120, 360)` — below cap |
| Wide table, one field's value is 60+ characters | unaffected (`field` names are fixed strings, not record-dependent) | approaches but never exceeds `360` |
| Record switch, from a short-content record to a long-content one | unchanged (field names are the same across every record) | strictly greater after the switch than before |
| A `values`-constrained field's row, value `"AU"` / label `"Australia"` (or longer) | — | driven by the label's length, not the 2-character stored value |
| `boolean` or `glyph` row present among others | — | unaffected by that row (skipped, not measured) |
| No displayed record (empty store, rotated) | flex — same as `filler` | flex — same as `filler` |

Per the worked table in `## Architecture Decisions`, every non-`boolean`/`glyph` cell type is measured by the exact string its own renderer displays.

**Rotated width (manual-verify — visual, not offline-testable):** open the docs app's Rotated demo (`RotatedRecordPanel`), widen the window past 1080px, and confirm the `value` column visibly shrinks to fit the current record instead of sitting flush at its cap; step through records with the Previous/Next buttons and confirm the column resizes to match each new record's content.

**Auto-size width (unit-testable, Problem B — unchanged from the previous draft):**

- A `string`/`auto` auto-sized column whose widest sampled candidate is the binding term (wider than both `min` and `headerPx`, and short of the column's declared `maxWidth`/`AUTO_WIDTH_CAP_PX` so clamping doesn't mask the change) reports a `getIntrinsicColumnWidths()[i]` exactly `CELL_CHROME_PX` pixels wider than the same setup measured against the pre-fix formula.
- A `date`/`time`/`datetime` column's `getColumnMinWidth()` reflects the widest digit-substituted variant of its reference text under a font with non-uniform digit widths — strictly `>=` the pre-fix value, and strictly greater in a test font engineered so some digit is wider than every digit in `REFERENCE_DATE`'s own formatted text.
- Under a font with **uniform** digit widths (the existing suite's shared `ColumnWidthsTestFont`), the digit-substitution fix is a no-op: all pre-existing `ColumnWidths.test.ts` cases keep passing unchanged.

**Auto-size width (manual-verify — depends on the real bundled font's actual digit metrics, which the offline harness cannot model):** load a table with `autoSizeColumns: true` and a `date`/`datetime` column holding a spread of real dates (varied days/months/years) in the running docs app; confirm no value renders with a trailing ellipsis.

---

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm run test -- RotatedView` and `npm run test -- ColumnWidths` (targeted), then `npm run test` (full suite — regression check, since `contentPx + CELL_CHROME_PX` changes several `string`/`auto` starting widths that other suites may read, and the rotated width change touches every existing `RotatedView.test.ts` case).
- `npm run docs:api` — zero warnings (standard regression check; this plan adds no new public API).
- `npm run build:lib`.
- Manual smoke test per `## Expected Behaviour`'s manual-verify rows, in the running docs app (`npm run docs:dev`, per the dev-URL convention already in use for this project).

---

## Documentation Impact

`packages/lib/docs/components/Table.md`'s "Rotated record view" section (step 13) is the only prose page describing this behaviour; its existing bullet about `field`/`value` staying compact remains accurate and gets one clause added, not rewritten. No exported symbol changes, so no TypeDoc/API surface work is needed. The changelog entry (step 14) is the consumer-facing record of both fixes.

---

## Potential Challenges

- **Content-driven resizing can look "jumpy" across a record switch** when values vary widely in length — this is the intended behaviour (the column following real content), not a defect; the manual-verify step is there to confirm it reads as responsive rather than jarring.
- **The combo-label lookup must stay in lockstep with `ComboRenderer`'s own map-building logic** ([Combo.ts:33](packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts#L33)) — if that renderer's fallback-to-raw-value behaviour ever changes, `formatRotatedValueText`'s mirrored logic needs the same update, or measured width and rendered width will drift apart again.
- **Exact pixel assertions are font-dependent.** Steps 8-10's new tests use qualitative bounds (`toBeGreaterThan`/`toBeLessThan`), not hand-computed exact widths, for the same reason the existing suite does — the test-font metrics aren't something this plan should hardcode a derived number against.
- **The date/datetime fix's real-world benefit (Problem B) depends on the bundled font's actual digit-width variance**, which this investigation could not measure directly (no live browser check was run). The fix is safe either way (a no-op under a tabular font), but the manual-verify step is what actually confirms it closes the reported truncation, not the unit tests.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/table/Table.ts](packages/lib/src/typescript/lib/component/table/Table.ts) — `columnWidthPolicy`, `resolveContentCandidates`, `ensureWidthReferences`, `dateReferenceKeys`, `getIntrinsicColumnWidths`, `ensureRotatedStore`, `isAutoSizeColumns`, `rebuildRotatedStore`, `selectRecord`, `onSourceStoreChange`, `rotatedCellType`, `rotatedCellValues`.
- [packages/lib/src/typescript/lib/layout/Table.ts](packages/lib/src/typescript/lib/layout/Table.ts) — `initializeWidths`, `rescaleWidths`, `absorbSlackIntoGreedy` — read to confirm the flex/slack mechanics this plan relies on but does not modify.
- [packages/lib/src/typescript/lib/component/table/cell/Dynamic.ts](packages/lib/src/typescript/lib/component/table/cell/Dynamic.ts) — `buildRenderer`, `bindRecord` — the per-row variant resolution `formatRotatedValueText` mirrors.
- [packages/lib/src/typescript/lib/component/table/cell/renderer/](packages/lib/src/typescript/lib/component/table/cell/renderer/) `Number.ts`, `Date.ts`, `Time.ts`, `DateTime.ts`, `String.ts`, `Combo.ts` — the exact per-type formatting this plan's measurement must match.
- [packages/lib/src/typescript/lib/component/table/cell/Cell.ts](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) — `setActiveRenderer` ([Cell.ts:613](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L613)), the renderer-vanishes-on-scroll fix this plan must not regress.
- [packages/lib/src/typescript/lib/component/table/TableExporter.ts](packages/lib/src/typescript/lib/component/table/TableExporter.ts) — `formatValue`, reused by both the date-reference measurement and the new rotated-row measurement.
- [plans/implemented/table-generated-column-widths.md](plans/implemented/table-generated-column-widths.md) — the plan that shipped the per-type width policy this plan extends and whose rotated-projection Non-Goal (line 678) this plan supersedes.
- [packages/lib/tests/component/table/RotatedView.test.ts](packages/lib/tests/component/table/RotatedView.test.ts) and [packages/lib/tests/component/table/ColumnWidths.test.ts](packages/lib/tests/component/table/ColumnWidths.test.ts) — existing test shape and font-metrics conventions to follow.

---

## Non-Goals

- **`NumberRenderer`'s alignment is untouched.** It stays right-aligned in every context, including inside `DynamicCell` — no `setTextAlign`/`getTextAlign` is added. The rotated view's visual coherence comes entirely from the width fix in this plan.
- **`TableExporter.formatValue`'s `'auto'`-column date-formatting gap for a *non-rotated* `DynamicCell` column** (see `## Architecture Decisions`) is not fixed here — a real fix needs the per-record `cellType` resolution threaded into `collectCandidates` for the normal-mode sampling path, a bigger structural change this plan does not make. The rotated-mode gap is fixed by this plan, since the new measurement path already resolves each row's real source-column type.
- **`GlyphRenderer`'s icon stretching to the full `Fit` box inside a `DynamicCell`** was noticed during investigation but is a distinct visual question (icon scaling, not width) the task did not raise; not addressed.
- **Cell-editor alignment while editing a `DynamicCell` number** (the input shown during in-place edit) is untouched — this plan is about read-only rendering and sizing only.
- **The "Table many-column sizing" project's open perf half** (synchronous `doLayout` per `mousemove` on column-resize drag, no header geometry diff) is unrelated to width *derivation* and is not touched by this plan.
- **A manual column-resize drag on `field`/`value` while rotated does not survive a record switch.** `selectRecord`'s rotated branch clears `_savedColumnWidths` alongside `_columnWidths` (mirroring `bindView`'s existing reset), so a user-dragged width reverts to the new record's content-derived width on the next switch. This plan does not investigate or change that interaction further — resize-while-rotated is pre-existing, untested behaviour this plan does not otherwise touch.

---

## Notes

[^precedent]: Searched for how the codebase already solves "compute a real preferred width from actual content": `columnWidthPolicy`'s per-type branches (shipped by `plans/implemented/table-generated-column-widths.md`) are exactly this, driven by `resolveContentCandidates`/`collectCandidates`/`Util.measureTextWidths`. No second content-measurement mechanism exists anywhere else in `component/table/`. The rotated fix reuses this machinery by extending candidate *collection* only — the measurement, clamping, and slack-absorption code paths downstream are untouched.

[^showseconds]: `TimeRenderer.setValue` / `DateTimeRenderer.setValue` format via `toLocaleTimeString`/`toLocaleString` with `showSeconds` read from their own constructor argument, itself sourced from the *rotated* `value` column's `ColumnConfig` (`ensureRotatedStore`'s spec never sets `showSeconds` on that config), so a rotated time/datetime row never shows seconds regardless of the source column's own `showSeconds` setting today. `formatRotatedValueText` passes an empty `Map` as `TableExporter.formatValue`'s `columnConfigs` argument specifically to reproduce this — not to work around it — so the measured text always matches what actually renders. Fixing the underlying gap (threading the rotated `value` column's own `showSeconds` through to `DynamicCell`) is a separate, pre-existing limitation this plan does not change.

[^compat]: Confirmed compatible with both previously-shipped `DynamicCell` fixes by reading each in full. Renderer-vanishes-on-scroll (`Cell.setActiveRenderer`, [Cell.ts:613](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L613)) only calls `doLayout()` when a pooled cell's active renderer variant actually changes during a scroll-driven rebind; this plan's added `doLayout()` calls happen after `rebuildRotatedStore()`'s `store.loadData(...)` has already completed the rebind for the new record, and `layout/Table.ts`'s `doLayout` only repositions the already-bound row window (`body.renderWindow`) — it does not re-trigger `bindRecord`. Blank-value-on-record-switch (`Table.rebuildRotatedStore`, [Table.ts:1035](packages/lib/src/typescript/lib/component/table/Table.ts#L1035)) depends on `_rotatedFieldByName` being refreshed before `loadData`; `rebuildRotatedStore`'s own body is untouched by this plan — the new reset/relayout code lives in its *callers*, strictly after it returns.
