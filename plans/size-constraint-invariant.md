# Size-Constraint Invariant Enforcement — Implementation Plan

## Overview

The framework carries an unstated invariant: on each axis every component satisfies `minSize ≤ preferredSize ≤ maxSize`, and a laid-out child's committed size stays inside `[minSize, maxSize]`. Both halves are currently breached.

- **Layout managers place children outside `[min, max]` on the cross axis.** The box managers clamp the *main* axis both ways but the *cross* axis only down to the container, never up to the child's own floor — [`HBox.layoutPreferredMode`](../src/typescript/lib/layout/HBox.ts#L466) (the cross-axis `heights.push(...)` at lines 466-470) and [`VBox.layoutPreferredMode`](../src/typescript/lib/layout/VBox.ts#L412) (the cross-axis `width` assignment at lines 412-416). The same gap exists wherever a manager passes `FillType.BOTH` to [`placeComponent`](../src/typescript/lib/layout/LayoutManager.ts#L251), because [`resolveBounds`](../src/typescript/lib/layout/LayoutManager.ts#L290)'s `BOTH` branch assigns `width = maxWidth; height = maxHeight` with no min/max clamp at all (the clamp only lives in the `NONE`/`HORIZONTAL`/`VERTICAL` branches).
- **Components report `preferredSize` outside `[min, max]`.** [`Component.setPreferredSize`](../src/typescript/lib/core/Component.ts#L1950) and [`getPreferredSize`](../src/typescript/lib/core/Component.ts#L1927) store and return the raw options value with no cross-check against min/max. A caller may `setMinSize(100, …)` then `setPreferredSize(0, …)` and the preferred wins in every layout-manager `getPreferredSize` summation — the exact shape that just bit a demo.

A third, already-present safety net complicates the picture and must be understood before touching anything: [`setWidth`/`setHeight`](../src/typescript/lib/core/Component.ts#L2476) already clamp the *committed* size via [`clampWidth`/`clampHeight`](../src/typescript/lib/core/Component.ts#L2441), but **only against the component's own `_options.minSize`/`_defaultOptions.minSize`** — not the merged [`getMinSize()`](../src/typescript/lib/core/Component.ts#L1969) that folds in the layout manager's own minimum. So a layout-managed child with no explicit `setMinSize` is unprotected, which is the real reason the cross-axis bug reaches the DOM rather than being silently corrected.

This is an internal correctness fix. No new public component and no new public option fields; the only consumer-visible change is tightened *semantics* on three existing setters.

---

## Architecture Decisions

### Enforce the invariant at read time in the getters, via a shared `Size` clamp helper

Write-time clamping (normalising in the setters) is rejected as the primary mechanism for three reasons:

1. **Order dependence.** A setter clamp can only see the values already written. `setPreferredSize(0,…)` before `setMinSize(100,…)` clamps preferred against the *default* min `{0,0}` (no-op), and the later `setMinSize` can't retro-fix the stored preferred without also re-reading and rewriting it — fragile, and it would fight the "options bag is the cache" idiom (a stored option no longer equals what the caller passed).
2. **Override getters bypass the setters entirely.** [`Image.getPreferredSize`](../src/typescript/lib/component/display/Image.ts#L65) returns `naturalWidth`/`naturalHeight` with no backing option; [`Text.getMinSize`](../src/typescript/lib/component/input/Text.ts#L459) folds in a measured line-height floor; [`FieldSet.getMinSize`](../src/typescript/lib/component/container/FieldSet.ts#L136), [`Accordion`](../src/typescript/lib/layout/Accordion.ts#L382), and every layout-manager `getPreferredSize`/`getMinSize` compute from children. A clamp wired only into `Component.setPreferredSize` covers none of these.
3. **Layout managers contribute to the effective min/max** ([`getMinSize`](../src/typescript/lib/core/Component.ts#L1969) merges `_options.minSize` with `layoutManager.getMinSize()` via `Math.max`). The effective min isn't known until read time anyway.

**Decision:** add a private `Component.clampPreferredToConstraints(pref, min, max)` helper and apply it at the *end of the base `getPreferredSize`*, after the explicit/layout/size resolution, reading the effective `getMinSize()`/`getMaxSize()`. Because override getters in `Image`/`Text` etc. call `super.getPreferredSize()`, the clamp rides along for free for the common path; the two genuine override exceptions (where preferred is computed independently of `super`) are handled explicitly (see *Override getters* below). This makes `getPreferredSize()` the single choke point every layout manager already funnels through.

### Conflict-precedence rule: min wins over preferred wins over… and min wins over max

When the three conflict, the resolution order is **min ≥ preferred, then max ≥ min**:

- `preferred = clamp(preferred, min, max)` — but with **min taking precedence over max** when `min > max` (a degenerate constraint): compute `effectiveMax = Math.max(min, max)` first, then `preferred = Math.min(Math.max(preferred, min), effectiveMax)`. An explicit `minSize` always wins, because min is the hard floor every other clamp (`clampWidth`/`clampHeight`, the drag floor in `Split.onDrag`) already treats as authoritative.
- This is applied per-axis independently. The helper takes a `Size` for each and returns a clamped `Size`.

### Clip-capable managers size a sub-min child to PREFERRED, not min (shared default)

**The governing rule for this plan.** When a clip-capable layout manager must place a child in a space smaller than the child's `minSize`, it sizes that child to its **preferred** size (then clips), by default — not to `min`. Rationale (agreed with the user): if the manager is going to clip the child anyway, laying it out at a cramped `min` is wasted layout work and an arbitrary size; rendering at preferred shows the content at its intended size up to the clip edge. This generalizes the box managers' existing `overflowSizing: "preferred"` default ([`BoxLayout.ts:36`](../src/typescript/lib/layout/BoxLayout.ts#L36), default at [`BoxLayout.ts:75`](../src/typescript/lib/layout/BoxLayout.ts#L75)) to *all* clip-capable managers.

**One shared default, not a new knob per manager.** The behaviour is "clip-capable → preferred-on-sub-min" by default everywhere. The box managers **keep** their existing `overflowSizing` option ([`BoxLayout.ts:54`](../src/typescript/lib/layout/BoxLayout.ts#L54), setter at [`BoxLayout.ts:206`](../src/typescript/lib/layout/BoxLayout.ts#L206)) as the escape hatch: set `"min"` to force the old min-floor. Grid gets **no** new option — it follows the shared default unconditionally; add an option only if a real case demands it (see *Non-Goals*).

**Null-preferred → min fallback.** When the child reports a null `preferredSize`, there is nothing to grow to, so the rule degrades to the current min floor. This guard is explicit in every site below.

**Per-axis, independently** — the preferred-vs-min choice is made on each axis on its own, like the rest of the invariant work.

**Border/Split collapse is NOT this case.** They clip a *collapsed region at full size* for an animation, not a cell-smaller-than-min situation. They are left untouched; do not "fix" them under this rule.

### Layout managers: clamp the cross axis in the box managers; do NOT add a clamp to the `BOTH` branch of `resolveBounds`

Two candidate fixes for Part A:

- **(A) Clamp inside `resolveBounds`'s `BOTH` branch.** Rejected as the sole fix. The `BOTH` branch deliberately means "fill the cell." Several managers rely on a child filling a cell that is *intentionally smaller* than the child's min and then **clipping** it — `Grid.layoutOccupancy` explicitly detects `min > cell` and routes to `setClipFrame` precisely so an oversized child is clipped, not stretched; `Border`/`Split` place clipped collapsed regions at full size. Auto-lifting `BOTH`-filled children to their min inside `resolveBounds` would defeat that clip path and could re-introduce overflow the collapse animations rely on suppressing.
- **(B) Clamp the cross-axis dimension the box manager computes, before it calls `placeComponent`.** Chosen. HBox already clamps the *main* axis (`width = Math.max(width, minSize.width)` then `Math.min(width, maxSize.width)` in `resolveChildWidth` at [`HBox.ts:577-583`](../src/typescript/lib/layout/HBox.ts#L577)); the fix gives the cross axis the symmetric treatment. The box managers are the only managers that *compute* a per-child cross extent (rather than handing the child the whole cell), so they own the clamp.

**REVERSAL — the cross-axis clamp lifts to PREFERRED on overflow, not min.** An earlier draft of this plan had the cross-axis hard-lift to min (`if (minSize) height = Math.max(height, minSize.height)`). Under the clip-at-preferred rule that is reversed: when the cross axis is overflowing/clipping *and* `overflowSizing === "preferred"` (the default), the cross extent lifts to the child's **preferred** size (clamped to max), not its min. This removes the asymmetry where the main axis already honours preferred-on-overflow (via `computeEqualCellWidth` at [`HBox.ts:425-426`](../src/typescript/lib/layout/HBox.ts#L425) / `computeEqualCellHeight` at [`VBox.ts:370-371`](../src/typescript/lib/layout/VBox.ts#L370)) but the cross axis would not.

Concretely, the cross-axis resolution starts from the existing container cap (`Math.min(size.height, containerSize.height)` — a child taller than the container is capped so it doesn't overflow a non-scrolling host), then: if the axis is overflowing and `overflowSizing === "preferred"`, lift to the child's preferred height (falling back to `minSize.height` when preferred is null); otherwise lift to `minSize.height` (the `"min"` escape hatch and the non-overflowing path keep the old floor); finally re-apply `maxSize.height`. The container cap stays first so a within-container child is unaffected (no-op when the child already fits, the overwhelming common case); max is applied last so it always caps.

### Fix `clampWidth`/`clampHeight` to read the effective (merged) min/max, not just `_options`

[`clampWidth`/`clampHeight`](../src/typescript/lib/core/Component.ts#L2441) read `this._options.minSize ?? this._defaultOptions.minSize`, so a layout-managed child whose real min comes from its children (with no explicit `setMinSize`) is clamped against `{0,0}` — the committed size is *not* corrected, which is why the cross-axis miscompute reaches the DOM. **Decision:** route these through `this.getMinSize()`/`this.getMaxSize()` so the commit-time clamp uses the same effective constraints the layout managers reason about. This is the defence-in-depth backstop: even if a manager miscomputes, the committed `_width`/`_height` lands in range. (It cannot replace the box-manager fix, because the *positioning* math — row metrics, `y` displacement — still uses the manager-computed extent; a backstop on the stored size alone would leave the layout visually wrong.)

Risk: this changes the clamp for every `setWidth`/`setHeight` call, including the ones layout managers issue inside `commitBounds`. Because the default min is `{0,0}` and default max is `{MAX_VALUE, MAX_VALUE}`, the clamp is a no-op except where a real constraint exists — and where one exists, clamping to it is the intended behaviour. The `Absolute` manager deliberately commits oversized children for scroll; that still works, because an oversized child exceeds neither its own min nor (typically) its max, so the clamp leaves it alone.

**Interaction with Grid's clip commit (see next decision).** Re-pointing `clampWidth`/`clampHeight` to the merged min has a consequence at Grid's clip branch: today Grid does `commitBounds(component, 0, 0, w, h)` with `w`/`h` the *cell* size, which is smaller than the child's min — so the re-pointed clamp would lift the inner child's committed size **up to min**. That is exactly the min-floor behaviour the clip-at-preferred rule reverses, so Grid's clip commit must size the inner child to preferred explicitly (next decision) rather than letting the cell-sized commit be clamped to min. Verify in regression that `Absolute`-hosted scroll panels and `Grid` clip cells are unaffected by the min-clamp itself (see *Verification*).

### Grid's clip path sizes the inner child to PREFERRED inside the cell-sized frame

**REVERSAL — Grid's clip is no longer a min-floor.** An earlier draft described Grid's clip as placing "the child at natural / min-floored size" inside the cell. Under the clip-at-preferred rule, the clip branch at [`Grid.ts:899-920`](../src/typescript/lib/layout/Grid.ts#L899) must size the inner child to its **preferred** size inside the cell-sized clip frame (the frame still takes the cell rect `(x, y, w, h)` and clips). The clip *frame* stays cell-sized — only the inner child's committed extent changes from "let the cell-sized commit be min-clamped" to "commit the child's preferred size, clipped by the frame." Fall back to min only when preferred is null (the same null-preferred guard as the box managers). Grid follows this default unconditionally — no new Grid option.

### No new public API; magic numbers stay documented

No new option fields, no new setters. The clamp helper is `private`. The one inline literal touched (`Number.MAX_VALUE` comparisons already present) needs no new constant. The existing `minSize.height > 0` guard hack in HBox/VBox (dodging the `{0,0}` default short-circuit in the preferred-fallback `??` chain) is **left untouched** — it solves a different problem (fallback selection, not invariant enforcement) and is already commented; see *Non-Goals*.

### CODE_CONVENTIONS tension

`getPreferredSize` gains a clamp tail; the method stays well under the 30-line decomposition threshold, and the clamp is extracted to the named `clampPreferredToConstraints` helper so the getter reads as "resolve, then clamp." No rule is violated. The "options bag is the cache" idiom is *preserved* by clamping on read rather than mutating the stored option on write.

---

## Internal Structure

New private helper on `Component` (signature only):

```typescript
// Clamps a resolved preferred Size into [min, max] per axis, with min winning
// over a smaller max (degenerate constraint) and over a smaller preferred.
private clampPreferredToConstraints(preferred: Size, min: Size | null, max: Size | null): Size;
```

`getPreferredSize` tail becomes:

```typescript
// ... existing resolution into `preferredSize` ...
if (!preferredSize) {
    return null;
}

return this.clampPreferredToConstraints(preferredSize, this.getMinSize(), this.getMaxSize());
```

Cross-axis clamp in `HBox.layoutPreferredMode` (the cross-axis `heights.push(...)` at [`HBox.ts:466-470`](../src/typescript/lib/layout/HBox.ts#L466); mirror in `VBox.layoutPreferredMode`'s `width` assignment at [`VBox.ts:412-416`](../src/typescript/lib/layout/VBox.ts#L412)):

```typescript
let height: number;

if (!size || this.isStretching()) {
    height = maxSize ? Math.min(maxSize.height, containerSize.height) : containerSize.height;
} else {
    height = Math.min(size.height, containerSize.height);
}

// Cross-axis floor: the container cap above can drop height below the child's
// own minimum. Under the clip-at-preferred rule, when the cross axis is
// overflowing and overflowSizing is "preferred" (the default), lift to the
// child's PREFERRED height (null-preferred falls back to min); otherwise lift
// to the min floor (the "min" escape hatch and the non-overflowing path). Then
// re-apply max last so it always caps.
if (this.isOverflowingY() && this._overflowSizing === "preferred") {
    const floor = size ? size.height : (minSize ? minSize.height : 0);
    height = Math.max(height, floor);
} else if (minSize) {
    height = Math.max(height, minSize.height);
}

if (maxSize) height = Math.min(height, maxSize.height);
```

(`HBox` uses `isOverflowingY()` for its cross axis; the `VBox` mirror uses `isOverflowingX()` and lifts to `size.width`/`minSize.width`.)

Grid clip-commit sizing in the `min > cell` branch ([`Grid.ts:899-920`](../src/typescript/lib/layout/Grid.ts#L899)) — the frame stays cell-sized; the inner child commits at preferred:

```typescript
if (min && (min.width > w || min.height > h)) {
    // Clip with a cell-sized frame, but size the inner child to its PREFERRED
    // extent (falling back to min per axis when preferred is null) so the
    // content renders at its intended size up to the clip edge rather than at
    // a cramped min that will be clipped anyway.
    const pref = component.getPreferredSize();
    const childW = pref ? pref.width  : (min ? min.width  : w);
    const childH = pref ? pref.height : (min ? min.height : h);

    component.setClipFrame(x, y, w, h);
    this.commitBounds(component, 0, 0, childW, childH);
}
```

---

## Ordered Implementation Steps

1. **`src/typescript/lib/core/Component.ts` — add `clampPreferredToConstraints`** and call it at the end of `getPreferredSize` (after the `if (!preferredSize) return null;` guard). → verify: `npx tsc --noEmit` clean.
2. **`src/typescript/lib/core/Component.ts` — re-point `clampWidth`/`clampHeight`** to `this.getMinSize()`/`this.getMaxSize()` instead of `this._options.minSize ?? this._defaultOptions.minSize` (and likewise max). Keep the null guards. → verify: `npx tsc --noEmit` clean.
3. **`src/typescript/lib/layout/HBox.ts:466-470`** (the cross-axis `heights.push(...)` in `layoutPreferredMode`) — add the cross-axis (height) clamp after the container cap, lifting to **preferred** when `isOverflowingY() && _overflowSizing === "preferred"` (null-preferred → min fallback) else to min, then max, per *Internal Structure*. → verify: `grep -n "isOverflowingY() && this._overflowSizing" src/typescript/lib/layout/HBox.ts` returns the new cross-axis line.
4. **`src/typescript/lib/layout/VBox.ts:412-416`** (the cross-axis `width` assignment in `layoutPreferredMode`) — add the symmetric cross-axis (width) clamp, lifting to **preferred** when `isOverflowingX() && _overflowSizing === "preferred"` (null-preferred → min fallback) else to min, then max. → verify: `grep -n "isOverflowingX() && this._overflowSizing" src/typescript/lib/layout/VBox.ts` returns the new cross-axis line.
5. **Audit the equal-mode / weight-cell paths.** In HBox/VBox `"equal"` mode the per-cell extent is computed by `computeEqualCellWidth`/`computeEqualCellHeight`, which already honour the main-axis preferred-on-overflow default ([`HBox.ts:425-426`](../src/typescript/lib/layout/HBox.ts#L425) / [`VBox.ts:370-371`](../src/typescript/lib/layout/VBox.ts#L370)) and otherwise floor to `max(child.minWidth)`; the cell is handed to the child via `FillType.BOTH`. Weight cells in preferred mode (`width = (weight/totalWeight) * remainingWidth`) are clamped to min/max in `resolveChildWidth` ([`HBox.ts:577-583`](../src/typescript/lib/layout/HBox.ts#L577) / `resolveChildHeight` at [`VBox.ts:504-510`](../src/typescript/lib/layout/VBox.ts#L504)) for *all* branches including weight, so the **main axis already complies** — no main-axis change is needed. → verify by reading: the `if (minSize) width = Math.max(...)` line in `resolveChildWidth` is outside the weight `if`; note in Verification as "main axis already honours preferred-on-overflow + min/max clamp."
6. **`src/typescript/lib/layout/Grid.ts:899-920`** — in the `min > cell` clip branch, size the inner child to its **preferred** extent inside the cell-sized clip frame (per-axis null-preferred → min fallback), replacing the implicit min-floored commit, per *Internal Structure*. The `setClipFrame(x, y, w, h)` frame stays cell-sized. → verify: `grep -n "component.getPreferredSize()" src/typescript/lib/layout/Grid.ts` returns the new clip-branch line; `npx tsc --noEmit` clean.
7. **Confirm no other manager computes a sub-cell child extent.** `Border`, `Fit`, `Card`, `Tab`, `Split`, `Absolute` either (a) hand the child the full cell via `BOTH` — covered by the `commitBounds`→`clampWidth/Height` backstop (step 2) — or (b) deliberately clip a *collapsed region at full size* (`Border`/`Split` collapse — NOT a sub-min cell, left untouched per the clip-at-preferred rule). No per-manager change is added to these. → verify: re-read each manager's `placeComponent`/`commitBounds` call sites confirm they pass either the full cell or a full-size collapse clip rect.
8. **`Absolute` confirmation.** `Absolute.doLayout` bypasses `placeComponent` and calls `commitBounds` directly with the child's own preferred/size; step 2 now clamps that commit to the child's effective min/max. Confirm this does not break the "oversized child scrolls" intent — an oversized child exceeds neither its min nor max, so the clamp is a no-op. → verify: SplitPanel/scroll demo still scrolls (manual).
9. **Self-review checklist pass** (see *Verification*).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` (add `clampPreferredToConstraints`, clamp tail in `getPreferredSize`, re-point `clampWidth`/`clampHeight`) |
| Modify | `src/typescript/lib/layout/HBox.ts` (cross-axis height clamp — lift to preferred on overflow) |
| Modify | `src/typescript/lib/layout/VBox.ts` (cross-axis width clamp — lift to preferred on overflow) |
| Modify | `src/typescript/lib/layout/Grid.ts` (clip branch sizes the inner child to preferred inside the cell-sized frame) |

No files created or deleted. Border/Fit/Card/Tab/Split/Absolute are audited but, per the decisions above, not modified — the `commitBounds` backstop covers their `BOTH`-fill paths, and Border/Split collapse clip a full-size region (not a sub-min cell).

---

## Verification

- **Typecheck:** `npx tsc --noEmit` — 0 errors.
- **Invariant grep:** `grep -n "isOverflowingY() && this._overflowSizing" src/typescript/lib/layout/HBox.ts` and `grep -n "isOverflowingX() && this._overflowSizing" src/typescript/lib/layout/VBox.ts` each return the new cross-axis preferred-lift line; `grep -n "component.getPreferredSize()" src/typescript/lib/layout/Grid.ts` returns the new clip-branch line.
- **min > preferred assertion (the bitten shape):** in a demo panel, build a child with `setMinSize(120, 40)` and `setPreferredSize(0, 0)`, place it in an HBox and a VBox. After layout, assert `child.getWidth() >= 120 && child.getHeight() >= 40`. Confirm `parent.getPreferredSize()` reports the child contributing ≥ its min, not 0 (the `getPreferredSize` clamp). The HBoxPanel / VBoxPanel / GridPanel demos are the natural homes; MiscPanel exercises the heaviest mixed layout and should be eyeballed for regressions.
- **Cross-axis lands at PREFERRED on overflow (default):** a short child (`preferredSize.height` between min and the squeezed container height, `minSize.height` large) in an *overflowing* HBox row lands at its **preferred** height — not at min and not squeezed to the row's text height — with the default `overflowSizing: "preferred"`. Inverse in VBox for width.
- **`overflowSizing: "min"` still forces min:** the same overflowing row with `overflowSizing: "min"` lands the cross axis at `minSize`, confirming the escape hatch.
- **Null-preferred floors to min:** a child reporting `null` preferred on the overflowing cross axis falls back to `minSize` (nothing to grow to).
- **Grid clip at preferred:** in GridPanel, an oversized child whose `min` exceeds its cell renders the child at its **preferred** size clipped to the cell rect (clip frame stays cell-sized), not at min. With a null-preferred child, it floors to min.
- **No-op claim:** a plain demo with default `{0,0}`/`{MAX,MAX}` constraints renders pixel-identical before/after (the clamp only bites where a real constraint exists). Spot-check BorderPanel, FitPanel, TabDemoPanel.
- **Collapse clips intact:** Border/Split collapsed regions (BorderPanel, SplitPanel) still clip a full-size region rather than stretch or shrink — they are untouched by the clip-at-preferred rule (not a sub-min cell case).
- **Scroll intact:** `Absolute`/autoScroll panels still scroll oversized content (SplitPanel, MiscPanel slow table).
- **Theme toggle:** flip light/dark on the demos above — no layout shift introduced by the clamp.
- **Self-review checklist:** (1) every changed line traces to A or B; (2) the `getPreferredSize` clamp returns `null` only when the un-clamped resolution was `null`; (3) the cross-axis clamp lifts to preferred when overflowing with default `overflowSizing` (null-preferred → min), to min otherwise, with max applied last; (4) Grid's clip frame stays cell-sized while the inner child commits at preferred (null-preferred → min); (5) `clampWidth/Height` still null-guard; (6) no override getter that computes preferred independently of `super` was left unclamped (see *Potential Challenges*).

---

## Potential Challenges

- **Override getters that don't delegate to `super`.** [`Image.getPreferredSize`](../src/typescript/lib/component/display/Image.ts#L65) returns `{naturalWidth, naturalHeight}` directly — it never calls `super.getPreferredSize()`, so the base clamp won't run for it. Image's own `getMinSize` caps min at 100 and preferred is the natural size (≥ its min in practice), so the invariant already holds; **decision: leave Image unclamped but call it out** — if a future caller `setMaxSize`s an Image below its natural size, preferred would exceed max. Scope: catalogue now, clamp only if a real case appears (Non-Goal). [`Text.getPreferredSize`](../src/typescript/lib/component/input/Text.ts#L433) *does* call `super`, so it's covered; but [`Text.getMinSize`](../src/typescript/lib/component/input/Text.ts#L459) deliberately reports a height floor (one text line) that can exceed a caller's `setPreferredSize(w, tiny)` — this is the legitimate "min wins, preferred lifted to min" case the clamp now enforces, so it becomes *more* correct, not broken. Verify Text rows in BaselinePanel/HBoxPanel still align.
- **Blast radius of the `clampWidth/Height` change.** It now consults the merged min/max for every `setWidth`/`setHeight`, including the thousands of calls layout managers make. Mitigation: default constraints make it a no-op; the regression suite above spot-checks the managers that intentionally place children outside the cell (Grid clip, Border/Split collapse, Absolute scroll).
- **Double-clamping is harmless but worth noting.** A box-manager child's cross extent is resolved in the manager (step 3/4 — now to preferred-or-min within `[min, max]`) and then `commitBounds` (step 2) re-clamps to `[min, max]`. The manager's result already lands inside `[min, max]` (preferred is `≥ min`, and max is applied last in the manager), so the `commitBounds` clamp is a no-op on it — intentional defence in depth, no correctness issue. The one place the two would *disagree* is Grid's clip commit: a bare cell-sized commit would be lifted to min by step 2, which is why Grid commits the inner child at preferred explicitly (step 6) so the backstop's min-floor doesn't override the clip-at-preferred intent.
- **`getMinSize` recursion cost in `getPreferredSize`.** The new clamp calls `getMinSize()`/`getMaxSize()`, which for a container recurse into the layout manager's `getMinSize` (which reads children). `getPreferredSize` already triggers the same recursion via the layout manager, so the added cost is one extra min + max pass per `getPreferredSize` call — measurable only on deep trees. If MiscPanel's slow table regresses, memoise within a layout pass (Non-Goal unless observed).

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `getPreferredSize` (1927), `setPreferredSize` (1950), `getMinSize` (1969), `getMaxSize` (2038), `clampWidth` (2441), `clampHeight` (2500), `_defaultOptions` size defaults (337-338), the `applyOptions` size dispatch (399-401).
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `resolveBounds` (290, the un-clamped `BOTH` branch), `commitBounds` (414), `placeComponent` (251).
- [`src/typescript/lib/layout/BoxLayout.ts`](../src/typescript/lib/layout/BoxLayout.ts) — `BoxOverflowSizing` (36), `BoxLayoutOptions.overflowSizing` (54), `_overflowSizing` default `"preferred"` (75), option dispatch (114), `setOverflowSizing` (206).
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) / [`VBox.ts`](../src/typescript/lib/layout/VBox.ts) — `layoutPreferredMode` cross-axis sites (HBox 466-470 / VBox 412-416), the main-axis preferred-on-overflow fallback (`computeEqualCellWidth` 425-426 / `computeEqualCellHeight` 370-371), `resolveChildWidth`/`resolveChildHeight` main-axis min/max clamp (HBox 577-583 / VBox 504-510), and the `minSize.* > 0` guard hack.
- [`src/typescript/lib/layout/Grid.ts`](../src/typescript/lib/layout/Grid.ts) — the `min > cell` clip branch (899-920) where the inner child now commits at preferred.
- Override getters to keep in view: [`Image.ts`](../src/typescript/lib/component/display/Image.ts), [`Text.ts`](../src/typescript/lib/component/input/Text.ts), [`FieldSet.ts`](../src/typescript/lib/component/container/FieldSet.ts), [`Accordion.ts`](../src/typescript/lib/layout/Accordion.ts).

---

## Sibling Invariant Problems Catalogued

Found while reading; resolution noted:

1. **`maxSize < minSize` accepted silently.** `setMinSize`/`setMaxSize` never cross-check; `getMinSize`/`getMaxSize` merge independently. The new `clampPreferredToConstraints` resolves the *consumption* (min wins via `effectiveMax = Math.max(min, max)`), but the stored values can still be contradictory. **Scoped in** to the extent that preferred is resolved correctly; **not** adding a setter-time warning (Non-Goal).
2. **`clampWidth/Height` ignoring the layout-manager min** — the root cause of Part A reaching the DOM. **Scoped in** (step 2).
3. **`resolveBounds` `BOTH` branch has no clamp at all.** **Deliberately left** (see Architecture Decisions — clipping managers depend on it); the backstop is `commitBounds`→`clampWidth/Height`. Note: Grid's clip branch no longer relies on the backstop's min-floor — it commits the inner child at preferred explicitly (clip-at-preferred rule), since the re-pointed `clampWidth/Height` would otherwise lift the cell-sized commit up to min.
4. **Null-size fallback interaction.** Several managers fall back to `_defaultComponentWidth/Height` (100) when `getPreferredSize()` is null, and the `minSize.* > 0` guard exists only to stop the `{0,0}` default from short-circuiting the `??` chain. The clamp does not touch this path (a null preferred returns null, unclamped). **Non-Goal** to refactor the fallback.
5. **`getMinSize`/`getMaxSize` use `Math.max` to merge component + manager** — correct for min, but `getMaxSize` also uses `Math.max`, meaning a component max and a *larger* manager max yields the larger, i.e. the looser constraint. That is arguably wrong (max should be the tighter `Math.min`), but it is pre-existing, load-bearing behaviour outside this fix's scope. **Catalogued, Non-Goal.**

---

## Non-Goals

- **Setter-time normalisation / warnings for contradictory `min`/`max`/`preferred`.** Read-time clamping fully satisfies the invariant at the point of consumption; mutating stored options on write would break the options-bag-as-cache idiom and is unnecessary.
- **Clamping `Image.getPreferredSize`** (and any other override that bypasses `super`). Catalogued; no current case violates the invariant. Add only when a real regression appears.
- **Refactoring the `minSize.* > 0` guard hack** in HBox/VBox or the `_defaultComponentWidth/Height` null-fallback. Different concern (fallback selection), already commented, working.
- **Fixing `getMaxSize`'s `Math.max` merge** (sibling problem #5). Pre-existing, load-bearing, out of scope.
- **Adding a central clamp to `resolveBounds`'s `BOTH` branch.** Would defeat the deliberate clip paths in Grid/Border/Split.
- **A new Grid option for clip sizing.** Grid follows the shared clip-at-preferred default unconditionally; the box managers keep their existing `overflowSizing` escape hatch, but Grid gets no equivalent knob until a real case demands it.
- **Touching Border/Split collapse clips.** They clip a *collapsed region at full size* for an animation, not a cell-smaller-than-min situation — explicitly out of scope of the clip-at-preferred rule. Do not "fix" them under it.
- **Memoising `getMinSize`/`getMaxSize` within a layout pass.** Only if a measured regression on MiscPanel's slow table demands it.
