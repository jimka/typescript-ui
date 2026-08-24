# Table Column Resize Exemption — Implementation Plan

## Overview

A `string`/`auto` column that was sized to its content — via [`ColumnSpec.autoSizeColumns`](packages/lib/src/typescript/lib/component/table/ColumnConfig.ts#L328) or an explicit `width` — does not keep that width. Every container resize runs [`Table.rescaleWidths`](packages/lib/src/typescript/lib/layout/Table.ts#L489), which classifies every column as fixed (`boolean` / `number` / `date`, kept at its current width) or flexible (everything else) and scales every flexible column's width by the same ratio. A `string`/`auto` column is always flexible under this classification, so it shrinks and grows with its siblings on every resize, regardless of how it was originally sized — down to its `minWidth` floor, which clips its content because the cell renderer hard-clips (`overflow: hidden`, `white-space: nowrap`, `text-overflow: clip`, no ellipsis).

This plan adds a per-column opt-out, `ColumnConfig.preserveWidth`, that excludes a column from this rescaling. An opted-out column is sized exactly as it would be otherwise on first render or a model swap; from then on, every container resize leaves its width untouched, exactly like a `boolean` / `number` / `date` column already is. If the table no longer fits once that column keeps its width, the table scrolls horizontally — the fallback [`rescaleWidths`](packages/lib/src/typescript/lib/layout/Table.ts#L489) already has for exactly this situation.

The change is confined to three files: [`ColumnConfig.ts`](packages/lib/src/typescript/lib/component/table/ColumnConfig.ts) (the new field), [`Column.ts`](packages/lib/src/typescript/lib/component/table/Column.ts) (the backing field and getter), and [`layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts) (`rescaleWidths` and `absorbSlackIntoGreedy`, the two places that classify a column as fixed or flexible). It does not touch `component/table/Table.ts`, `autoSizeColumns`'s sampling, or any consumer.

---

## Architecture Decisions

### The opt-out folds into the existing fixed/flexible classification

`rescaleWidths` and `absorbSlackIntoGreedy` each independently compute `t === 'boolean' || t === 'number' || t === 'date'` from the column's field type ([layout/Table.ts:491](packages/lib/src/typescript/lib/layout/Table.ts#L491) and [:547](packages/lib/src/typescript/lib/layout/Table.ts#L547)). This plan extracts that check into one new private method, `Table.isFixedColumn(col)`, and widens it with `|| col.isWidthPreserved()`. Both call sites switch to calling it.[^shared-helper]

### First render is untouched

`preserveWidth` is read nowhere in `initializeWidths`'s own body — only in the shared `absorbSlackIntoGreedy` tail call both `initializeWidths` and `rescaleWidths` end with. A column's starting width — from an explicit `width`, sampled content under `autoSizeColumns`, the type policy, or an equal flex share — is computed exactly as it would be without the flag. `preserveWidth` only changes what happens on every resize *after* that.[^first-render]

### No new accessor on the `Table` component

`Column.isWidthPreserved()` is read directly from `layout/Table.ts`, the same way `col.getMaxWidth()` already is in both `rescaleWidths` and `absorbSlackIntoGreedy`. `component/table/Table.ts` needs no change.

### Naming: `preserveWidth`

The flag is named `preserveWidth`, not `resizeExempt` or `pinWidth`. "Resize" already names a different mechanism in this exact file: `onColumnResize` / `onColumnResizeStart` / the `"columnresize"` event ([Table.ts:2043](packages/lib/src/typescript/lib/component/table/Table.ts#L2043)) are the user dragging a column's edge — a name built on "resize" would read as disabling that drag, which this flag does not do. "Pin" is already a different, active concept in the same component: `Body.ts` has an existing "pinned-side body" / "scroll-side body" split ([Body.ts:1032](packages/lib/src/typescript/lib/component/table/Body.ts#L1032)), and a queued, unimplemented plan (`plans/table-column-pinning.md`) already claims "pinning" for freezing a column at the table's edge during horizontal scroll — an unrelated feature. "Preserve" is already this codebase's word for exactly this idea: [`Table.ts:803`](packages/lib/src/typescript/lib/component/table/Table.ts#L803)'s own doc comment reads "Manually resized widths are **preserved** across visibility toggles."[^naming]

### Composing with a declared `minWidth` / `maxWidth`

No new clamping logic is needed. A fixed column (by type or by `preserveWidth`) is never clamped inside `rescaleWidths` — it is returned unchanged — so `minWidth` / `maxWidth` only ever bind when the width is *computed*: on first render, on a model swap, or via a user drag (`onColumnResize`, unaffected by this plan). A resize pass that leaves a preserved column alone can never violate a constraint that a prior computation already satisfied.

### Overflow still falls back to horizontal scroll

`rescaleWidths`'s existing guard — `if (prevFlexTotal <= 0 || newFlexTotal <= 0 || …) return columnWidths;` ([layout/Table.ts:507](packages/lib/src/typescript/lib/layout/Table.ts#L507)) — needs no change. A `preserveWidth` column enlarges `fixedTotal` the exact same way a `boolean` / `number` / `date` column already does, so when enough width is pinned that `newFlexTotal` goes negative, the guard returns every width unchanged and the table scrolls — already proven correct by the `R4`/`R5` regression cases in [`ColumnWidths.test.ts`](packages/lib/tests/component/table/ColumnWidths.test.ts#L718).

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/table/ColumnConfig.ts

export interface ColumnConfig {
    // ...existing fields unchanged...

    /** When `true`, this column's width survives a container resize unchanged. Defaults to `false`. */
    preserveWidth ?: boolean;
}
```

```typescript
// packages/lib/src/typescript/lib/component/table/Column.ts

class Column {
    /** Returns whether the spec declared `preserveWidth: true`. Backing field: `_preserveWidth`. */
    isWidthPreserved(): boolean;
}
```

No new symbols are exported and no barrel changes are needed — `ColumnConfig` and `Column` are already exported from `component/table/index.ts`.

---

## Ordered Implementation Steps

1. **[`packages/lib/src/typescript/lib/component/table/ColumnConfig.ts`](packages/lib/src/typescript/lib/component/table/ColumnConfig.ts)** — add `preserveWidth ?: boolean;` to `ColumnConfig`, right after the `maxContentLength` field ([line 85](packages/lib/src/typescript/lib/component/table/ColumnConfig.ts#L85)), before `hidden`. JSDoc:

   ```typescript
   /**
    * When `true`, this column's width is kept unchanged whenever the
    * table's container resizes, instead of scaling proportionally with
    * the other flexible columns the way a `string`/`auto` column does by
    * default. The column is still sized normally on first render (or
    * after a model swap) — from its own `width`, sampled content under
    * {@link ColumnSpec.autoSizeColumns}, or a shared flex allotment — and
    * a user drag still resizes it; this flag affects container resizes
    * only.
    *
    * If the table no longer fits once this column keeps its width, the
    * table scrolls horizontally instead of shrinking it — the same
    * fallback `boolean` / `number` / `date` columns already get.
    *
    * Defaults to `false`.
    */
   preserveWidth ?: boolean;
   ```

2. **[`packages/lib/src/typescript/lib/component/table/Column.ts`](packages/lib/src/typescript/lib/component/table/Column.ts)**
   - Add `private _preserveWidth: boolean;` right after `_maxContentLength` ([line 23](packages/lib/src/typescript/lib/component/table/Column.ts#L23)), before `_hidden`.
   - In the constructor, add `this._preserveWidth = config?.preserveWidth ?? false;` right after `this._maxContentLength = config?.maxContentLength;` ([line 48](packages/lib/src/typescript/lib/component/table/Column.ts#L48)), before `this._hidden = …`.
   - Add the getter right after `getMaxContentLength()` ([ends line 104](packages/lib/src/typescript/lib/component/table/Column.ts#L104)), before `isInitiallyHidden()`:

     ```typescript
     /**
      * Returns whether this column's width is exempt from resize-driven
      * proportional rescaling, as declared in the spec.
      *
      * @returns `true` when the spec declared `preserveWidth: true`.
      */
     isWidthPreserved(): boolean {
         return this._preserveWidth;
     }
     ```

3. **[`packages/lib/tests/component/table/Column.test.ts`](packages/lib/tests/component/table/Column.test.ts)** — extend the two existing round-trip tests, mirroring how they already cover `readOnly` / `required` / `unhideable` (plain boolean flags, the same shape as `preserveWidth`). Covers cases 1-2 of `## Expected Behaviour`:
   - In `'defaults every optional config field when no config is given'` ([line 10](packages/lib/tests/component/table/Column.test.ts#L10)), add `expect(col.isWidthPreserved()).toBe(false);`.
   - In `'round-trips every provided config field through its getter'` ([line 26](packages/lib/tests/component/table/Column.test.ts#L26)), add `preserveWidth: true` to the `config` object and `expect(col.isWidthPreserved()).toBe(true);` to the assertions.

   *Check:* `npm run test -- Column.test.ts` passes.

4. **Write the tests** in a new file, `packages/lib/tests/component/table/PreserveWidth.test.ts`, per cases 3-7 of `## Expected Behaviour` below. Cases 4, 5, 6, and 7 fail at this point — `preserveWidth` is plumbed through `ColumnConfig`/`Column` but nothing in `layout/Table.ts` reads it yet, so an opted-out column rescales exactly like an ordinary flex column. Case 3 already holds (first render never depended on the flag).

5. **[`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts)**
   - Add a new private method, placed right before `clamp` ([line 569](packages/lib/src/typescript/lib/layout/Table.ts#L569)):

     ```typescript
     /**
      * Returns whether a column is excluded from resize-driven
      * proportional rescaling: its width stays exactly as it is on every
      * container resize, and it never receives absorbed slack. True for
      * every `boolean` / `number` / `date` column (their content has a
      * fixed shape) and for any column declaring `preserveWidth`,
      * regardless of type.
      *
      * @param col - The column to classify.
      * @returns `true` when {@link Table.rescaleWidths} and
      *   {@link Table.absorbSlackIntoGreedy} should leave this column alone.
      */
     private isFixedColumn(col: Column): boolean {
         const t = col.getField().getType();

         return t === 'boolean' || t === 'number' || t === 'date' || col.isWidthPreserved();
     }
     ```

   - In `rescaleWidths` ([line 490](packages/lib/src/typescript/lib/layout/Table.ts#L490)), replace:

     ```typescript
     const isFixed = columns.map(col => {
         const t = col.getField().getType();

         return t === 'boolean' || t === 'number' || t === 'date';
     });
     ```

     with:

     ```typescript
     const isFixed = columns.map(col => this.isFixedColumn(col));
     ```

   - In `absorbSlackIntoGreedy` ([lines 547-548](packages/lib/src/typescript/lib/layout/Table.ts#L547)), replace:

     ```typescript
     const t      = col.getField().getType();
     const isFlex = t !== 'boolean' && t !== 'number' && t !== 'date';
     ```

     with:

     ```typescript
     const isFlex = !this.isFixedColumn(col);
     ```

   - Update the class-level doc comment ([lines 69-71](packages/lib/src/typescript/lib/layout/Table.ts#L69)). Replace:

     > On container resize `boolean` / `number` / `date` columns keep their width unchanged; every other column (including `glyph`, `time`, and `datetime`) scales proportionally like a flexible column, again clamped to their per-column constraints.

     with:

     > On container resize `boolean` / `number` / `date` columns keep their width unchanged, and so does any column declaring `preserveWidth`, regardless of type; every other column (including `glyph`, `time`, and `datetime`) scales proportionally like a flexible column, again clamped to their per-column constraints.

   - Update `rescaleWidths`'s own doc comment ([line 480](packages/lib/src/typescript/lib/layout/Table.ts#L480)) — "keeping fixed-type columns at their current size" becomes "keeping fixed-type columns and any column declaring `preserveWidth` at their current size".
   - Update `absorbSlackIntoGreedy`'s own doc comment ([lines 526-528](packages/lib/src/typescript/lib/layout/Table.ts#L526)) — "to the flexible columns that declare no `maxWidth`" becomes "to the flexible columns that declare no `maxWidth` — never a fixed-type or `preserveWidth` column".

   *Check:* `grep -c "getField().getType()" packages/lib/src/typescript/lib/layout/Table.ts` — expect exactly `1` (down from 2; both call sites now go through `isFixedColumn`).

6. **Run the full suite** — the new file plus every existing table suite (`ColumnWidths.test.ts`, `ColumnResize.test.ts`, `Column.test.ts`, and the rest) passes.

7. **Documentation** — apply `## Documentation Impact`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/ColumnConfig.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Column.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Table.ts` |
| Modify | `packages/lib/tests/component/table/Column.test.ts` |
| Create | `packages/lib/tests/component/table/PreserveWidth.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |

---

## Expected Behaviour

All cases are unit-testable offline; none needs a real browser. Cases 1-2 are plain `Column` construction/getter checks — `Column.test.ts`'s existing style, a `ColumnConfig` object and a `Field`, no DOM. Cases 3-7 exercise `layout/Table.ts` through the real `Table` component, in the new `PreserveWidth.test.ts`. Cases 4-6 follow [`ColumnResize.test.ts`](packages/lib/tests/component/table/ColumnResize.test.ts)'s pattern for a genuine container resize: `table.setWidth(w1); table.doLayout();` to establish a baseline, `table.setColumnWidths([...])` to plant exact starting widths (bypassing font-metrics-dependent derivation for cases whose numbers must be exact), then `table.setWidth(w2); table.doLayout();` to trigger `rescaleWidths`. Case 7 follows `ColumnWidths.test.ts`'s `makeStore`/`makeTable` + `autoSizeColumns` pattern instead, since it needs real content sampling.

Reuse the shared `installTestDOM` fixture from `packages/lib/tests/dom/font-metrics.test-font.json` and the same `CONFIG` object `ColumnResize.test.ts` uses (`scrollBarWidth: 15`, `viewport: 1280x800`) — that file's own comment establishes `setWidth(w)` yields an available column width of `w - 14` (`TRACK_WIDTH` plus the table's 1px-per-side border); reuse that exact relationship rather than re-deriving it, so the worked numbers below are reproducible.

**Case 1 — `isWidthPreserved()` defaults to `false`.** (`Column.test.ts`) A `Column` built with no config, or with a config that omits `preserveWidth`, reports `isWidthPreserved() === false`.

**Case 2 — `preserveWidth: true` round-trips through `isWidthPreserved()`.** (`Column.test.ts`) A `Column` built with `{ ..., preserveWidth: true }` reports `isWidthPreserved() === true`.

**Case 3 — first render ignores `preserveWidth`.** (`PreserveWidth.test.ts`)

Two `string` columns with no `minWidth`/`maxWidth`/`width`/`autoSizeColumns`, `a` (`preserveWidth: true`) and `b` (plain). `setWidth(514)`, `setHeight(...)`, one `doLayout()` call (first render — `initializeWidths` runs, not `rescaleWidths`, since `_columnWidths` starts empty). `getColumnWidths()[a] === getColumnWidths()[b]` — both get an equal, un-preferential flex share; `preserveWidth` has no effect until the *next* layout pass.

**Case 4 — a `preserveWidth` column keeps its exact width across a resize; a plain flex sibling rescales.** (`PreserveWidth.test.ts`)

Two `string` columns, both `minWidth: 30`, no `maxWidth`: `a` (`preserveWidth: true`), `b` (plain). `setWidth(514)` (available 500), `setColumnWidths([250, 250])`. Then `setWidth(314)` (available 300), `doLayout()`.

| Column | Before | Rule | After |
|---|---|---|---|
| `a` | 250 | fixed (preserveWidth) — untouched | 250 |
| `b` | 250 | flex — `250 × (300 − 250) / 250` | 50 |

**Case 5 — a `preserveWidth` column never receives absorbed slack, even with no `maxWidth`.** (`PreserveWidth.test.ts`)

Three `string` columns, all `minWidth: 30`: `a` (`preserveWidth: true`, no `maxWidth`), `b` (`maxWidth: 80`), `c` (no `maxWidth`). `setWidth(314)` (available 300), `setColumnWidths([100, 80, 120])`. Then `setWidth(414)` (available 400), `doLayout()`.

| Column | Before | Rescale | Slack (40px) | After |
|---|---|---|---|---|
| `a` | 100 | fixed — untouched | excluded | 100 |
| `b` | 80 | `80 × 1.5 = 120`, clamped to `maxWidth: 80` | excluded (has a `maxWidth`) | 80 |
| `c` | 120 | `120 × 1.5 = 180` | absorbs all 40 | 220 |

**Case 6 — a `preserveWidth` column that no longer fits falls back to horizontal scroll, not a crash or a collapse.** (`PreserveWidth.test.ts`)

Same two columns as case 4, same setup (`setWidth(514)`, `setColumnWidths([250, 250])`). Then `setWidth(154)` (available 140 — less than `a` alone), `doLayout()`.

`newFlexTotal = 140 − 250 = −110`, so `rescaleWidths`'s existing guard returns the widths unchanged: `getColumnWidths()` is still exactly `[250, 250]` (both finite, no `NaN`), and their sum (500) exceeds the available width (140) — the table scrolls horizontally rather than squeezing either column.

**Case 7 — `preserveWidth` composes end-to-end with `autoSizeColumns` (the motivating scenario).** (`PreserveWidth.test.ts`)

Following `ColumnWidths.test.ts`'s `makeStore`/`makeTable` pattern: two `string` fields, `autoSizeColumns: true`, one record giving each a distinguishable value (e.g. a two-character value for `short`, a much longer one for `long`). Mark `long` with `preserveWidth: true`. `setWidth(w1)`, `setHeight(...)`, `doLayout()` — record `long`'s sampled, laid-out width. Then `setWidth(w2)` (narrow enough to force a real rescale — e.g. at least 200px narrower), `doLayout()` again.

`long`'s width is *exactly* unchanged between the two layouts; `short`'s width differs (it is the only genuinely flexible column left, so it absorbs the whole resize).

**Case 8 — `preserveWidth` on an already-fixed-type column is a harmless no-op.** Not separately pinned by a dedicated test: `isFixedColumn`'s `||` composition already makes this true by construction — a `boolean`/`number`/`date` column with `preserveWidth: true` classifies identically to one without it, in both `rescaleWidths` and `absorbSlackIntoGreedy`.

---

## Verification

- `npm run typecheck` — clean.
- `npm run test` — `PreserveWidth.test.ts`, the extended `Column.test.ts`, and every existing table suite (`ColumnWidths.test.ts`, `ColumnResize.test.ts`) pass.
- `grep -c "getField().getType()" packages/lib/src/typescript/lib/layout/Table.ts` — expect `1`.
- `npm run docs:api` — 0 errors, 0 link warnings.
- No manual/browser verification step is needed for this plan.[^no-manual-verify]

---

## Documentation Impact

- **[`packages/lib/docs/components/Table.md`](packages/lib/docs/components/Table.md), "Constraining columns"** — add a `preserveWidth` row to the `ColumnConfig` field table ([line 53](packages/lib/docs/components/Table.md#L53)), right after the `maxContentLength` row:

  > | `preserveWidth` | When `true`, this column's width survives a container resize unchanged instead of scaling with the other flexible columns; the table scrolls horizontally if it no longer fits. Does not affect first render or a user drag-resize. |

  Add one short paragraph after the existing "For one column, the first rule that applies wins…" paragraph ([lines 88-93](packages/lib/docs/components/Table.md#L88)) explaining that a container resize normally scales every `string`/`auto` column's width proportionally (`boolean`/`number`/`date` columns are always excluded), and that `preserveWidth` opts any column out of that scaling.
- **JSDoc** — `ColumnConfig.preserveWidth`, `Column.isWidthPreserved`, the `layout/Table.ts` class-level doc and the `rescaleWidths` / `absorbSlackIntoGreedy` doc comments (all covered in the implementation steps above).
- **No barrel change** — `ColumnConfig` and `Column` are already exported from `component/table/index.ts`.
- **No `packages/lib/llms.txt` change** — generated from task→symbol rows; the existing `Table` row already covers column configuration.

---

## Potential Challenges

- **Font-metric-dependent pixel math would make the resize-arithmetic tests fragile.** Mitigation: cases 4-6 plant exact starting widths via `setColumnWidths` and declare explicit `minWidth`/`maxWidth`, matching `ColumnResize.test.ts`'s own approach — no dependency on any font-metrics table beyond `installTestDOM` being installed at all.
- **A reader might expect `preserveWidth` to also survive `trimToTarget`'s column-visibility space redistribution.** It doesn't — see `## Non-Goals`. Mitigation: the new doc paragraph and JSDoc scope the flag explicitly to container resizes.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/layout/Table.ts` | `rescaleWidths` / `absorbSlackIntoGreedy` — the two methods this plan edits, and the class-level doc comment describing the resize contract. |
| `packages/lib/src/typescript/lib/component/table/ColumnConfig.ts` | Where the new field is declared, alongside `minWidth`/`maxWidth`/`width`/`autoSizeColumns`. |
| `packages/lib/src/typescript/lib/component/table/Column.ts` | The `getMinWidth`/`getMaxWidth`/`getWidth` backing-field-plus-getter pattern the new field mirrors. |
| `packages/lib/tests/component/table/Column.test.ts` | The default/round-trip test pattern the new field's tests extend. |
| `packages/lib/tests/component/table/ColumnResize.test.ts` | The genuine-container-resize test pattern (`setWidth`/`doLayout` twice) and the `setWidth(w) → available = w − 14` fixture constant this plan's tests reuse. |
| `packages/lib/tests/component/table/ColumnWidths.test.ts` | The `makeStore`/`makeTable` + `autoSizeColumns` pattern case 7 follows; also documents the existing negative-`newFlexTotal` regression (`R4`/`R5`) this plan's case 6 extends to `preserveWidth`. |
| `packages/lib/src/typescript/lib/component/table/Table.ts` | `trimToTarget` ([line 1142](packages/lib/src/typescript/lib/component/table/Table.ts#L1142)) — read to confirm it is a separate, untouched mechanism (see `## Non-Goals`); not modified. |
| `plans/implemented/table-generated-column-widths.md` | The plan that built `initializeWidths`/`rescaleWidths`/`absorbSlackIntoGreedy` and the type-policy vocabulary this plan extends. |

---

## Non-Goals

- **`trimToTarget`'s show/hide space redistribution** ([`component/table/Table.ts:1142`](packages/lib/src/typescript/lib/component/table/Table.ts#L1142)) is untouched. It runs when a column is *shown* and existing columns must shrink to make room — a different trigger than a container resize, with its own local `isFixedType` closure. Whether a `preserveWidth` column should also be exempt there is left for a future plan.
- **Disabling user drag-resize.** `onColumnResize` / `onColumnResizeStart` read `col.getMinWidth()` / `col.getMaxWidth()` directly, with no fixed/flex classification at all — every column, `preserveWidth` or not, can still be dragged.
- **Applying `preserveWidth` to any specific table** (e.g. `StyleAuditView.ts`) — a separate, trivial one-line follow-up once this capability exists.
- **Any change to `autoSizeColumns`, `initializeWidths`'s sampling, or `getIntrinsicColumnWidths`.** First-render sizing is completely unaffected by this plan (see `## Architecture Decisions`).

---

## Notes

[^shared-helper]: Before this plan, the fixed/flexible check was duplicated verbatim (modulo `!==`/`===`) in `rescaleWidths` ([line 491](packages/lib/src/typescript/lib/layout/Table.ts#L491)) and `absorbSlackIntoGreedy` ([line 547](packages/lib/src/typescript/lib/layout/Table.ts#L547)). Both call sites need the same new `|| col.isWidthPreserved()` clause, and editing it in two places risks the two definitions drifting apart later. A single private method both callers share removes that risk at the cost of one small addition, and touches no code outside the two lines this plan already has to change.

[^first-render]: The task this plan implements is explicit that "opting out" means resize behaviour only, not first-render behaviour: a generated or hand-configured table should still auto-size or share space normally the first time it lays out, exactly as it does today. Making `initializeWidths` itself aware of `preserveWidth` was considered and rejected — there is nothing for it to do differently. A column's *starting* width already comes from `width`, `autoSizeColumns` sampling, or an equal flex share; `preserveWidth` only says "keep whatever that turns out to be," which is a resize-time decision, not a derivation-time one.

[^naming]: Two names were rejected before `preserveWidth`. `resizeExempt` (and similarly `noResize`) would collide with this file's own established meaning of "resize" — `Table.onColumnResize` / `onColumnResizeStart` / the `"columnresize"` event are the user dragging a column's edge, a mechanism this flag does not touch, so a "resize"-named flag reads as disabling the wrong thing. `pinWidth` (and `lockWidth`) would collide with "pin" as it is already used in the same component: `Body.ts` already has a "pinned-side body" / "scroll-side body" split for a horizontal-scroll-freeze mechanism, and the queued `plans/table-column-pinning.md` claims "column pinning" for freezing a column at the table's edge — an unrelated, not-yet-built feature that would become confusingly similarly-named if this plan used "pin" first. `preserveWidth` avoids both collisions and is already this codebase's own word for the same underlying idea: [`Table.ts:803`](packages/lib/src/typescript/lib/component/table/Table.ts#L803)'s doc comment says "Manually resized widths are preserved across visibility toggles."

[^no-manual-verify]: This plan's scope boundary explicitly defers applying `preserveWidth` to any real consumer table to separate follow-up work, so there is no demo or live table in scope to drive a browser check against. The mechanism itself needs no live-browser verification either: `rescaleWidths` runs synchronously from `Table.doLayout()`, and `ColumnResize.test.ts` case 12 ([packages/lib/tests/component/table/ColumnResize.test.ts:354](packages/lib/tests/component/table/ColumnResize.test.ts#L354)) already proves that a genuine container resize — `setWidth` followed by `doLayout` — is fully exercised by the offline harness with no DOM-timing dependency.
