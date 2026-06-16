# Zebra Row Striping — Implementation Plan

## Overview

Add alternating-row ("zebra") background striping to the table body so every other **logical** data row carries a slight greyish tint that is visually distinct from the header surface. The striping must follow the logical (data) row index — not the DOM node position — because the body recycles a fixed pool of `Row` components through a virtual-scroll window, so a given `<tr>` is rebound to many different data indices as the user scrolls and (in the tree case) as branches expand/collapse. Static `:nth-child` CSS would therefore stripe by pool-slot position and visibly "crawl" during scroll, which is wrong.

The work lives almost entirely in the table body's rebind path ([`Body.bindAndPositionRows`](../src/typescript/lib/component/table/Body.ts#L758) and [`Body.updateRowVisualState`](../src/typescript/lib/component/table/Body.ts#L1118)) plus the per-row tint writer ([`Row.updateVisualState`](../src/typescript/lib/component/table/Row.ts#L174)), with one new theme token threaded through [`Theme.ts`](../src/typescript/lib/core/Theme.ts#L290) and the three built-in theme literals. [`TreeBody`](../src/typescript/lib/component/table/TreeBody.ts#L109) inherits the whole mechanism unchanged because it already flattens its visible subtree into a single ordered record list and every tree row (branch and leaf alike) is one entry in that list.

---

## Architecture Decisions

### Stripe by logical data index, threaded through the rebind path

The body computes each visible row's logical `dataIndex` in [`bindAndPositionRows`](../src/typescript/lib/component/table/Body.ts#L758) (`dataIndex = firstRow + i`) and stores it per pool slot in `_boundIndices[i]`. Parity is `dataIndex % 2`. This is the single source of truth for "which logical row is this slot showing right now," already maintained across scroll, sort, column-toggle, and tree expand/collapse (all of which funnel through `renderWindow`). The stripe decision must be made wherever that index is known and re-evaluated on every rebind — never from CSS structural selectors. Concretely, parity is pushed into the row alongside the existing new/dirty/selected visual-state writes.

### Stripe is the resting background; selection / new / dirty layer on top

Pooled rows already carry three mutually-exclusive *inline* `background-color` writes, applied directly to the row/`<tr>` element (not through cached `Component` setters) precisely because the element is reused for different records:

- [`Row.updateVisualState`](../src/typescript/lib/component/table/Row.ts#L174) — new (`--ts-ui-table-row-new`) / dirty (`--ts-ui-table-row-dirty`) / else removes the property.
- [`Body.updateRowVisualState`](../src/typescript/lib/component/table/Body.ts#L1118) — selected (`--ts-ui-table-row-selected` + a box-shadow border); the non-selected branch delegates back to `row.updateVisualState()`.

The stripe is the **lowest-priority resting layer**: it shows only when a row is neither selected, new, nor dirty. The natural home is the *final `else` branch* of `Row.updateVisualState` — today that branch does `el.style.removeProperty('background-color')`; it instead sets the stripe colour (or removes it) based on the row's parity. Because new/dirty/selected are evaluated before/over this and all four writes target the same inline `background-color`, the existing precedence is preserved automatically: an odd-row tint is simply the resting state that a selection/new/dirty tint overwrites, and reverts to when the higher-priority state clears.

Rejected: a parity CSS class plus a stylesheet rule. `Component` exposes no public `addClass`/`removeClass`; the body's per-row visual state is deliberately written as inline style with the `local/no-element-style` eslint exception (see the comments at [`Row.updateVisualState`](../src/typescript/lib/component/table/Row.ts#L180) and [`Body.updateRowVisualState`](../src/typescript/lib/component/table/Body.ts#L1133)). Matching that established inline-style idiom is the surgical choice and keeps all four background layers in one place with one precedence rule. A class would also re-introduce the "inline beats class" subtlety the existing code already sidesteps by keeping every layer inline.

### Row owns its parity; Body supplies it on rebind

`Row.updateVisualState` currently reads only `this._data`'s new/dirty flags — it has no notion of position. Add a private `_stripe: boolean` field (true ⇒ this row is on a striped/odd logical index) plus a `setStripe(striped: boolean): void` writer. `Body` sets it from `dataIndex % 2` inside `bindAndPositionRows`, in the `wasRebound` block right where `updateRowVisualState`, `computeRowAria`, and `applyReadOnlyState` already run — so a slot that scrolls onto a new logical index gets its parity refreshed exactly once per rebind, with no extra render pass. `updateVisualState` then consults `this._stripe` in its resting-state branch. This keeps Row self-contained (it already owns the inline-tint contract) and adds no new cross-component coupling beyond the one setter call the Body already makes a cluster of.

Even/odd convention: stripe the **odd** logical indices (`dataIndex % 2 === 1`), i.e. the 2nd, 4th, … visible rows are tinted and the first row is untinted. This keeps the row directly under the header untinted so the header/body boundary stays crisp.

### Distinct from the header surface

The header paints `--ts-ui-table-header-bg` (Modern `rgb(248, 249, 250)`, Classic a light gradient, Dark its own surface) as both background-color and background-image — see [`TABLE_HEADER_BG`](../src/typescript/lib/component/table/Header.ts#L23) and the header constructor. The new stripe token must read as a faint grey *over the cell/body background* and never collide with the header fill. Using a low-opacity neutral black/white wash (rgba) rather than an opaque grey guarantees the stripe sits visibly between the (transparent) cell background and the header surface in every theme, and composites correctly over the body's `--ts-ui-input-bg` fill. The chosen defaults (below) are deliberately lighter/greyer than the header surface and than the existing selected/new/dirty washes.

### TreeTable participates uniformly; no special group/parent rule

[`TreeBody.getVisibleRecords`](../src/typescript/lib/component/table/TreeBody.ts#L502) returns `_flatRows.map(f => f.record)` — a single depth-flattened, expansion-aware list in which **every** visible node (root, branch, leaf) is exactly one entry and therefore one `<tr>`. There are no separate group/aggregate rows in the body. So striping by flat-list index applies the alternation across the whole rendered tree uniformly, and indentation/expansion don't change the rule. Crucially, `setExpanded` / `collapseAll` / `expandAll` all call `invalidateRowBindings()` (which fills `_boundIndices` with `-1`) before `renderWindow`, forcing a full rebind — so every visible row's parity is recomputed against the *new* flattened order after an expand/collapse, and the stripe never goes stale. No `TreeBody` code changes are required.

---

## Public API (TypeScript Signatures)

No consumer-facing API changes. One new internal setter on `Row` (re-exported as `TableRow`, but this method is framework-internal wiring, marked "not for consumer use"):

```typescript
// src/typescript/lib/component/table/Row.ts
class Row extends Component {
    private _stripe: boolean = false;

    /**
     * Marks whether this row sits on a striped (odd) logical index, so the
     * resting background paints the zebra stripe. Set by the host Body on each
     * rebind from `dataIndex % 2`. Not for consumer use.
     */
    setStripe(striped: boolean): void;
}
```

No new `XOptions` field and no cached-setter call-site routing: `_stripe` is ephemeral per-rebind state, identical in nature to the existing inline new/dirty tint — it must **not** be persisted into `_options` (that would replay onto the next record bound to the reused row, exactly the trap the existing `updateVisualState` comment warns about).

---

## Theme Tokens

One new token under `table.row`, mirroring the existing `selected` / `new` / `dirty` siblings.

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-table-row-stripe` | `rgba(0, 0, 0, 0.035)` | `rgba(255, 255, 255, 0.045)` | Resting background tint for odd (alternating) data rows; a low-opacity neutral wash composited over the body/cell background, distinct from the header surface. |

`Theme.ts` blocks to touch:

- **`Theme` interface** — add `stripe: string;` to the `table.row` object ([Theme.ts:303](../src/typescript/lib/core/Theme.ts#L303)).
- **`themeToVars`** — add `'--ts-ui-table-row-stripe': theme.table.row.stripe,` next to the existing `--ts-ui-table-row-*` lines ([Theme.ts:790](../src/typescript/lib/core/Theme.ts#L790)).
- **`ModernTheme`** `table.row` ([ModernTheme.ts:137](../src/typescript/lib/core/themes/ModernTheme.ts#L137)) — `stripe: 'rgba(0, 0, 0, 0.035)'`.
- **`ClassicTheme`** `table.row` ([ClassicTheme.ts:125](../src/typescript/lib/core/themes/ClassicTheme.ts#L125)) — `stripe: 'rgba(0, 0, 0, 0.035)'`.
- **`DarkTheme`** `table.row` ([DarkTheme.ts:124](../src/typescript/lib/core/themes/DarkTheme.ts#L124)) — `stripe: 'rgba(255, 255, 255, 0.045)'`.

Note: [`BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts#L49) is the structural scaffold and carries **no** `table.row` block (the concrete themes own those values), so it needs no edit. The theme regression test enforces that `base + overrides` together cover every `Theme` key — adding the field to all three concrete themes (which is where `row.selected`/`new`/`dirty` already live) satisfies it. Verify this assumption by running the theme test (see Verification); if the scaffold is expected to carry a default, add `stripe` to BaseTheme's `table.row` instead.

The inline-style consumer reads the token with a hardcoded fallback matching the existing pattern (`var(--ts-ui-table-row-stripe, rgba(0, 0, 0, 0.035))`), so a standalone `Row`/`Body` with no theme applied still stripes.

---

## Internal Structure

`Row.updateVisualState` resting-branch change (only the final `else` is touched; new/dirty branches untouched):

```typescript
// existing new / dirty branches above, unchanged …
} else if (this._stripe) {
    el.style.setProperty('background-color', 'var(--ts-ui-table-row-stripe, rgba(0, 0, 0, 0.035))');
} else {
    el.style.removeProperty('background-color');
}
```

`Body.bindAndPositionRows`, inside the existing `if (wasRebound) { … }` block (sibling of the current `updateRowVisualState` / `computeRowAria` calls at [Body.ts:770](../src/typescript/lib/component/table/Body.ts#L770)):

```typescript
row.setStripe(dataIndex % 2 === 1);   // odd logical rows carry the zebra stripe
this.updateRowVisualState(i);          // already present — now also paints the stripe via the resting branch
```

`setStripe` must run **before** `updateRowVisualState(i)` so the resting branch sees the fresh parity. `setStripe` only writes the `_stripe` field (no DOM); `updateRowVisualState` → `row.updateVisualState()` performs the actual paint, so a single existing call already covers selection-clear + stripe + new/dirty in the right precedence.

Edge case — selection toggles without a rebind: [`Body.updateRowVisualState`](../src/typescript/lib/component/table/Body.ts#L1118) is also invoked from `onRowClick` / `selectRecord` / `setSelectedRecords` for slots whose `dataIndex` is unchanged (no rebind). Its non-selected branch already calls `row.updateVisualState()`, which now repaints the stripe from the row's still-current `_stripe` — so deselecting a row correctly falls back to its stripe rather than to no tint. No change needed there beyond the `Row` resting-branch edit.

---

## Ordered Implementation Steps

1. **`Theme.ts` — interface**: add `stripe: string;` to the `table.row` object. → verify: `tsc` errors in the three theme literals (missing key) until step 3.
2. **`Theme.ts` — `themeToVars`**: add `'--ts-ui-table-row-stripe': theme.table.row.stripe,` beside the other `--ts-ui-table-row-*` entries.
3. **Theme literals**: add `stripe` to `table.row` in `ModernTheme.ts`, `ClassicTheme.ts` (both `rgba(0, 0, 0, 0.035)`), and `DarkTheme.ts` (`rgba(255, 255, 255, 0.045)`). → verify: `npm run typecheck` clean.
4. **`Row.ts`**: add `private _stripe: boolean = false;` field, a `setStripe(striped: boolean): void` method with JSDoc, and extend `updateVisualState`'s final `else` into the stripe-vs-remove branch shown above (keep the `local/no-element-style` eslint-disable block covering the new `setProperty`).
5. **`Body.ts`**: in `bindAndPositionRows`, inside the `if (wasRebound)` block, call `row.setStripe(dataIndex % 2 === 1)` immediately before the existing `this.updateRowVisualState(i)`.
6. **Regression checkpoints**:
   - `grep -rn "nth-child\|:odd\|:even" src/typescript/lib/component/table/` — expect zero matches (confirms we did not introduce position-based CSS).
   - `grep -rn "ts-ui-table-row-stripe" src/typescript/lib` — expect exactly: the `Theme.ts` `themeToVars` entry, the three theme literals, and the `Row.ts` inline fallback.
   - Confirm `TreeBody.ts` is untouched (`git diff --stat` shows no `TreeBody.ts`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Theme.ts` (interface `table.row.stripe`, `themeToVars` line) |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` (`table.row.stripe`) |
| Modify | `src/typescript/lib/core/themes/ClassicTheme.ts` (`table.row.stripe`) |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` (`table.row.stripe`) |
| Modify | `src/typescript/lib/component/table/Row.ts` (`_stripe`, `setStripe`, resting branch) |
| Modify | `src/typescript/lib/component/table/Body.ts` (`setStripe` call in `bindAndPositionRows`) |

---

## Verification

- **Typecheck**: `npm run typecheck` (or `tsc --noEmit`) — clean.
- **Theme regression test**: run the theme completeness test (the suite that checks every `Theme` key is covered) — green. If it flags `table.row.stripe` as missing on `BaseTheme`, add the field to `BaseTheme.ts`'s `table.row` (creating that sub-block) per the Theme-Tokens note.
- **Grep invariants**: the two greps in step 6.
- **Manual smoke (demo screen = `MiscPanel`)**: open the app, click **"Show window with table!"** (the `TablePanel` window, [MiscPanel.ts:242](../src/typescript/MiscPanel.ts#L242)) and **"Show window with tree table!"** ([MiscPanel.ts:409](../src/typescript/MiscPanel.ts#L409)).
  - Confirm alternating rows carry a faint grey stripe distinct from the header band.
  - **Scroll** the body fast: the stripe pattern must stay anchored to logical rows (row N is always the same parity) and not crawl/flicker as pool slots recycle.
  - **Tree expand/collapse**: toggle a branch and confirm the alternation re-flows over the new flattened order (the row that becomes the new "row 3" takes row-3 parity), with no stale stripes.
  - **Selection / new / dirty precedence**: select a striped row → selection tint replaces the stripe; deselect → stripe returns. Edit a cell on a striped row (dirty) → dirty tint replaces the stripe; revert → stripe returns.
  - **Theme toggle**: switch Modern → Classic → Dark; the stripe stays visible and distinct from the header in all three. The body's `ThemeManager.onThemeChange` handler already forces a full rebind (`_boundIndices.fill(-1)` + `renderWindow`), so the new colour repaints without extra wiring.

---

## Potential Challenges

- **Resting-branch ordering**: `setStripe` must precede `updateRowVisualState(i)` in the rebind block, or the first paint after a rebind uses stale parity until the next render. Mitigation: place the call immediately above the existing `updateRowVisualState(i)` line.
- **Non-rebind selection repaints**: deselecting a row that was never rebound relies on `_stripe` still holding the correct parity for that slot. Because `_stripe` is only rewritten on rebind (when `dataIndex` actually changes) it stays correct for a stable slot. Mitigation: covered by the deselect smoke test above.
- **Theme scaffold completeness**: whether `stripe` belongs on `BaseTheme` or only the concrete themes depends on how the theme regression test partitions defaults. Mitigation: the existing `row.selected`/`new`/`dirty` live only in the concrete themes, so mirroring them is the safe default; the test verifies it.
- **Opacity vs. header collision**: a too-strong stripe could approach the header grey under the light themes. Mitigation: defaults are a 3.5%/4.5% neutral wash — well below the header surface lightness; tune in the smoke test if needed and document the chosen value's "why" inline per `CODE_CONVENTIONS.md` magic-number rule.

---

## Critical Files

- [`src/typescript/lib/component/table/Body.ts`](../src/typescript/lib/component/table/Body.ts) — row pool, `renderWindow` → `bindAndPositionRows` (logical-index source), `updateRowVisualState` (selection layer + theme-change rebind).
- [`src/typescript/lib/component/table/Row.ts`](../src/typescript/lib/component/table/Row.ts) — `updateVisualState` (inline new/dirty tint; resting branch is the stripe's home).
- [`src/typescript/lib/component/table/TreeBody.ts`](../src/typescript/lib/component/table/TreeBody.ts) — `getVisibleRecords`/`flatten` (confirms one `<tr>` per flat node; no changes, but read to verify the no-group-rows assumption).
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — `Theme` interface `table.row`, `themeToVars`.
- [`src/typescript/lib/core/themes/ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts), [`ClassicTheme.ts`](../src/typescript/lib/core/themes/ClassicTheme.ts), [`DarkTheme.ts`](../src/typescript/lib/core/themes/DarkTheme.ts) — `table.row` token blocks.
- [`src/typescript/lib/component/table/Header.ts`](../src/typescript/lib/component/table/Header.ts) — `TABLE_HEADER_BG`, the surface the stripe must stay distinct from.

---

## Documentation Impact

None. The change adds one internal-only `Row.setStripe` method (marked not-for-consumer-use, no `@category`/barrel surface change) and one theme token. Theme tokens are documented as a set via the theming concept page only if that page enumerates individual `--ts-ui-*` variables; it does not enumerate the per-row tints (`--ts-ui-table-row-selected`/`new`/`dirty` are undocumented individually), so `--ts-ui-table-row-stripe` follows suit. No public exported symbol moves, so `docs/` needs no update and `npm run docs:build` should stay at 0 errors / 0 link warnings.

---

## Non-Goals

- **Per-table opt-out / configurable striping.** No `striped` option on `Table`/`TablePanel`/`TreeTable` — striping is always on, themed by the one token. A theme can neutralise it by setting `stripe` to `transparent`; a per-instance toggle wasn't requested and would add `XOptions` routing for speculative flexibility (CLAUDE.md §2).
- **Column striping or hover striping.** Only row-level alternating background; column tints (`groupColor`) and the list-row hover token are separate, untouched mechanisms.
- **Striping the header or footer.** The header keeps its single surface fill; only `<tbody>` data rows stripe.
