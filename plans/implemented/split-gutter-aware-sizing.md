# Split Gutter-Aware Sizing — Implementation Plan

## Overview

The [`Split`](../src/typescript/lib/layout/Split.ts) layout manager divides the container's main-axis dimension among its panes but never subtracts the space its own gutters occupy, then paints the gutters *on top* of the fully-sized panes. The net effect: every `Split` overflows its container along the main axis by exactly `gutterCount × gutterSize`. Two separately-reported symptoms share this one root cause, and both are fixed by making the main-axis math gutter-aware.

The fix lives entirely in [`Split.recalculateSizes`](../src/typescript/lib/layout/Split.ts#L354) and [`Split.doLayout`](../src/typescript/lib/layout/Split.ts#L245), plus one new private field to remember the available main-axis extent the stored sizes were last computed against. No other file changes; no public API.

This plan **supersedes** [`plans/split-layout-selection-shift.md`](split-layout-selection-shift.md), whose diagnosis (List border / inner-Panel scrollbar gutter) was refuted by live measurement — the only value that moved on selection was an *ancestor* `scrollTop`, and the overflow it scrolled into is the Split's own gutter overflow. That plan should not be implemented.

---

## Root Cause (verified live with Chrome DevTools on the Split demo)

[`recalculateSizes`](../src/typescript/lib/layout/Split.ts#L354) assigns a main-axis size only to panes that have **no** stored size in `_sizes`:

- The first-ever layout (the `this._sizes.size == 0` branch, [Split.ts:400-406](../src/typescript/lib/layout/Split.ts#L400)) gives the pane the **full** available main-axis dimension — `containerSize.{width|height} − insets`, with **no** subtraction for gutters.
- A pane added later (the `this._sizes.size != 0` branch, [Split.ts:383-399](../src/typescript/lib/layout/Split.ts#L383)) steals a proportional fraction from the already-sized panes — again with no gutter accounting.

Then [`doLayout`](../src/typescript/lib/layout/Split.ts#L245) lays panes end-to-end from the stored sizes and inserts a `gutterSize = 4` gutter ([Split.ts:275](../src/typescript/lib/layout/Split.ts#L275), placement [Split.ts:326-343](../src/typescript/lib/layout/Split.ts#L326)) **after** each non-final pane, advancing `x`/`y` by `gutterSize`. Because the pane sizes already summed to the full main axis, the trailing edge lands `gutterCount × gutterSize` past the container's inner edge.

Live-measured overflow matched exactly on every split: outer vertical split (2 panes / 1 gutter) overflowed 4 px; top horizontal (2/1) 4 px; bottom horizontal (3 panes / 2 gutters) 8 px.

### Symptom 1 — "selection shift"

The outer vertical split's south pane overflows its height by 4 px (measured `clientHeight 422` vs `scrollHeight 426`); its `overflow-y` is `hidden` but it is still *programmatically* scrollable. Clicking a `List` row calls the list's `focus()` / `scrollIndexIntoView`, the browser scrolls that overflowing ancestor (`scrollTop 0 → 3`), and the whole bottom row (list, textarea, every gutter) shifts up ~3 px uniformly. Selecting an already-visible row afterward causes **zero** further shift. Removing the overflow at its source (this plan) eliminates the ancestor's scrollable region, so the browser can't scroll it, so the shift cannot happen — no change to `List`, `Panel`, or `Component`.

### Symptom 2 — viewport-resize dead space

Because `recalculateSizes` only sizes panes that *lack* a stored size, the per-pane absolute pixel sizes in `_sizes` freeze after the first layout and never rescale when the container's main-axis dimension changes. On viewport resize the cross-axis tracks the container (it is read fresh from `containerSize` each `doLayout`) but the main axis stays frozen: ~400 px dead space on the right at 1200 → 1600 wide, ~300 px at the bottom at 800 → 1100 tall — and it would clip when shrinking.

---

## Architecture Decisions

### Subtract the gutter total wherever the main axis is divided or rescaled

Define the *available* main-axis extent as `(container inner main-axis dimension − gutterCount × gutterSize)`. Every place that hands a pane a main-axis size — the equal-divide branch, the proportional-steal branch, and the new rescale branch — must operate on this **available** value, never the full inner dimension. This is the single invariant the whole fix turns on.

### Make the gutter total available to `recalculateSizes` cleanly, without over-engineering

`gutterSize = 4` and `gutterCount = componentCount − 1` are local constants in `doLayout` today; `recalculateSizes` recomputes `components` independently and has no access to them. `computeTotalMinSize` already re-derives both ([Split.ts:211-212](../src/typescript/lib/layout/Split.ts#L211)). Rather than thread parameters or introduce a builder, **lift two tiny private helpers** that both methods (and the existing `computeTotalMinSize`) call:

- `private gutterTotal(componentCount: number): number` → `Math.max(0, componentCount − 1) * GUTTER_SIZE`.
- A module-private `const GUTTER_SIZE = 4;` to replace the three `4` literals ([Split.ts:211](../src/typescript/lib/layout/Split.ts#L211), [Split.ts:275](../src/typescript/lib/layout/Split.ts#L275)) and the gutter advance.

This removes the magic number, keeps the gutter arithmetic in one spot, and is strictly less code at the call sites than re-deriving `gutterCount * 4` three times. It introduces no exported symbol (the const stays module-scoped; the helper stays `private`).

### Track the last available main-axis extent in a private field, and rescale proportionally

Add `private _lastAvailableMain: number = 0;` — the *available* (net-of-gutters) main-axis extent the stored `_sizes` were last normalised against. In `recalculateSizes`, after computing the current `available`:

1. If `_lastAvailableMain > 0` and `available > 0` and they differ and there is at least one stored size, multiply **every** stored size by `available / _lastAvailableMain`. This preserves the user's drag ratios (ratios are scale-invariant) while making the panes fill the container.
2. Then run the existing "assign sizes to panes that lack one" logic, but dividing/stealing from `available` rather than the full dimension.
3. Set `_lastAvailableMain = available` at the end so the next layout rescales against the value just applied.

Because the sum of stored sizes is kept equal to `available` by both the rescale and the assignment branches, `doLayout` places the final pane's trailing edge at exactly `inset + available + gutterCount × gutterSize = inset + innerMain`, i.e. flush with the inner edge. Overflow becomes zero.

### Interaction with `onDrag`

[`onDrag`](../src/typescript/lib/layout/Split.ts#L131) mutates `_sizes` for the two panes adjacent to the dragged gutter, conserving their *pair* total (`newLhs + newRhs == _dragOriginLhsSize + _dragOriginRhsSize`). It does **not** change the grand total of all stored sizes, so it leaves `_lastAvailableMain` valid — no update needed there. The first `recalculateSizes` after a resize then rescales the post-drag sizes against the new `available`, preserving the dragged ratio. (Decision: do **not** touch `onDrag`; the field is owned and updated solely by `recalculateSizes`.)

### Use the same inset basis the placement loop uses

`doLayout` derives the pane cross-axis from `containerSize` (= `getInnerSize()`, full minus perimeter) and the origin from `getContentInsets()` ([Split.ts:272](../src/typescript/lib/layout/Split.ts#L272)). `recalculateSizes` currently derives the available main axis from `getInnerSize()` **minus `getInsets()` again** ([Split.ts:402](../src/typescript/lib/layout/Split.ts#L402), [Split.ts:404](../src/typescript/lib/layout/Split.ts#L404)) — double-counting the border, since `getInnerSize` already subtracted the perimeter. The available main axis must be taken **straight from `getInnerSize()` minus the gutter total**, with no second inset subtraction, so it matches the space `doLayout` actually fills. Removing the stray `getInsets()` subtraction is part of the fix, not scope creep — it is the same main-axis miscount.

---

## Internal Structure

Shape of the corrected `recalculateSizes` (pseudocode, names match existing code):

```text
recalculateSizes():
    container = getContainer(); if !container return
    inner = container.getInnerSize(); if !inner return
    components = container.getComponents()
    main = direction === "horizontal" ? inner.width : inner.height
    available = Math.max(0, main - gutterTotal(components.length))

    // 1. rescale frozen sizes to the new extent (preserves drag ratios)
    if _lastAvailableMain > 0 && available > 0
       && available !== _lastAvailableMain && _sizes.size > 0:
        factor = available / _lastAvailableMain
        for each stored (component, size): _sizes.set(component, size * factor)

    // 2. assign sizes to panes that don't have one (existing two branches,
    //    but dividing/stealing from `available`, not the full dimension,
    //    and with NO second getInsets() subtraction)
    ...existing assignment logic against `available`...

    // 3. remember the extent these sizes are now normalised to
    _lastAvailableMain = available
```

`doLayout` is unchanged except the three `4` literals become `GUTTER_SIZE` and the per-pane main-axis size still reads `_sizes.get(component)` (now gutter-correct). The cross-axis line `componentHeight = containerSize.height` / `componentWidth = containerSize.width` stays as-is.

---

## Ordered Implementation Steps

1. **Add module constant + helper.** In [`Split.ts`](../src/typescript/lib/layout/Split.ts) add a module-private `const GUTTER_SIZE = 4;` and a `private gutterTotal(componentCount: number): number`. Replace the `gutterSize = 4` locals in `doLayout` ([Split.ts:275](../src/typescript/lib/layout/Split.ts#L275)) and `computeTotalMinSize` ([Split.ts:211](../src/typescript/lib/layout/Split.ts#L211)) with `GUTTER_SIZE`, and the inline `gutterCount * gutterSize` in `computeTotalMinSize` with `this.gutterTotal(components.length)`. → verify: `grep -n "= 4" src/typescript/lib/layout/Split.ts` shows no gutter-size literal remaining.
2. **Add the field.** Add `private _lastAvailableMain: number = 0;` alongside the other private fields ([Split.ts:28-34](../src/typescript/lib/layout/Split.ts#L28)). Declare it with a normal initializer (no setter writes it during `super()`, so the class-field super-cascade trap does not apply).
3. **Rewrite `recalculateSizes`** ([Split.ts:354](../src/typescript/lib/layout/Split.ts#L354)) per *Internal Structure*: compute `available = main − gutterTotal(count)` from `getInnerSize()` directly (drop the extra `getInsets()` subtraction and the now-unused `containerInsets` local); add the rescale-by-`factor` pass; make both assignment branches divide/steal from `available`; set `_lastAvailableMain = available` at the end. → verify: `getInsets` is no longer referenced in `recalculateSizes`.
4. **Confirm `doLayout` consumes the corrected sizes.** No behavioural edit beyond Step 1's constant swap — the pane loop already reads `_sizes.get(component)`; the gutter advance already uses `GUTTER_SIZE` after the swap. → verify by reading the placement loop ([Split.ts:297-344](../src/typescript/lib/layout/Split.ts#L297)).
5. **Type-check.** `npm run build` passes.
6. **Live-verify all three invariants** on the Split demo (see Verification).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Split.ts` |

No new files. `plans/split-layout-selection-shift.md` is superseded but left on disk (not deleted) for history; `/implement` should not act on it.

---

## Verification

Demo: **Split** tab at `http://localhost:8015` (`npm run dev`). Use Chrome DevTools MCP to measure.

- **Invariant 1 — zero gutter overflow.** At several viewports, every `Split` container element satisfies `scrollHeight === clientHeight` **and** `scrollWidth === clientWidth`. (Pre-fix these differed by `gutterCount × 4`: 4 px on the two 2-pane splits, 8 px on the 3-pane bottom split.)
- **Invariant 2 — no selection shift.** Capture `getBoundingClientRect` of the list root, textarea, slider, and every `.SplitGutter`, plus the south pane's `scrollTop`, across a first / middle / last / off-screen row-selection sequence. Every rect must be byte-stable and `scrollTop` must stay `0`.
- **Invariant 3 — resize fills, ratios preserved.** Resize the viewport both directions (1200 → 1600 and back; 800 → 1100 and back). Panes must keep filling the container with no dead space and no clipping; a pane dragged to a non-default ratio must retain that ratio (within rounding) across the resize.
- **Typecheck:** `npm run build` passes.
- **Theme toggle:** toggle light/dark on the Split demo — no regression (gutter/pane geometry is theme-independent, so this is a guard, not a fix target).

---

## Potential Challenges

- **Sub-pixel rounding.** `factor` scaling and integer pane placement can leave a fractional residual; mitigate by comparing rects to two decimals and treating `< 1 px` total as flush — do **not** add a "distribute remainder to last pane" pass unless Invariant 1 actually fails (avoid over-engineering).
- **First layout before connect.** `getInnerSize()` returns `null` before the element is in the DOM; the existing early-returns ([Split.ts:360-363](../src/typescript/lib/layout/Split.ts#L360)) already guard this, and `_lastAvailableMain` stays `0` until the first real layout, so the rescale pass is correctly skipped on the very first pass.
- **Adding a pane after sizes exist.** The proportional-steal branch must still leave the grand total equal to `available`; verify by adding nothing new — the steal already conserves total, and rescaling-then-stealing against the same `available` keeps it consistent.

---

## Critical Files

- [`src/typescript/lib/layout/Split.ts`](../src/typescript/lib/layout/Split.ts) — `recalculateSizes`, `doLayout`, `onDrag`, `computeTotalMinSize`, the `_sizes` map and private drag-origin fields. The only file changed.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `getInnerSize` (~L1931, full size minus perimeter), `getContentInsets` (~L1196, insets + padding), `getInsets`/`getBorderSize`/`getPerimiterSize` (~L1960/L2046). **Read only** to confirm the inset basis; do not edit. The perimeter-padding work already shifted these line numbers.
- [`src/typescript/SplitPanel.ts`](../src/typescript/SplitPanel.ts) — demo wiring under test: a `Fit` panel holding a vertical outer `Split` (north = horizontal split of Button + Text/Slider; south = horizontal split of 13-item `List` + TextArea + Slider).
- [`src/typescript/lib/component/container/SplitGutter.ts`](../src/typescript/lib/component/container/SplitGutter.ts) — the 4 px draggable gutter; read only to confirm it carries no intrinsic size that double-counts.

---

## Non-Goals

- **No change to `List`, `Panel`, `AbstractCustomList`, or `Component`.** `AbstractCustomList` already has `setMinSize(100,100)` (~L480) and `Panel` already has its reactive `_scrollbarGutter` system (~L81/237/295); neither is the cause and neither is touched. The old plan's scrollbar-gutter and border-cache branches are both abandoned.
- **No new public API, exported symbol, option field, or theme token.** `GUTTER_SIZE` is module-private and `gutterTotal`/`_lastAvailableMain` are `private` — no documentation impact.
- **No rework of `onDrag`'s drag model.** It already conserves the pair total and leaves `_lastAvailableMain` valid.
- **This plan explicitly drops the old plan's Non-Goal** "*Reworking the Split `_sizes` model is out of scope*": rescaling the stored `_sizes` against the container is precisely the fix for Symptom 2 and is in scope here.
- **No remainder-distribution / pixel-snapping pass** unless Invariant 1 fails in practice.
