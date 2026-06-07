# Size-Constraint Invariant Enforcement — Implementation Plan

## Overview

The framework carries an unstated invariant: on each axis every component satisfies `minSize ≤ preferredSize ≤ maxSize`, and a laid-out child's committed size stays inside `[minSize, maxSize]`. Both halves are currently breached.

- **Layout managers place children outside `[min, max]` on the cross axis.** The box managers clamp the *main* axis both ways but the *cross* axis only down to the container, never up to min — [`HBox.ts:709-718`](../src/typescript/lib/layout/HBox.ts#L709) and [`VBox.ts:589-596`](../src/typescript/lib/layout/VBox.ts#L589). The same gap exists wherever a manager passes `FillType.BOTH` to [`placeComponent`](../src/typescript/lib/layout/LayoutManager.ts#L251), because [`resolveBounds`](../src/typescript/lib/layout/LayoutManager.ts#L290)'s `BOTH` branch assigns `width = maxWidth; height = maxHeight` with no min/max clamp at all (the clamp only lives in the `NONE`/`HORIZONTAL`/`VERTICAL` branches).
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

### Layout managers: clamp the cross axis in the box managers; do NOT add a clamp to the `BOTH` branch of `resolveBounds`

Two candidate fixes for Part A:

- **(A) Clamp inside `resolveBounds`'s `BOTH` branch.** Rejected as the sole fix. The `BOTH` branch deliberately means "fill the cell." Several managers rely on a child filling a cell that is *intentionally smaller* than the child's min and then **clipping** it — `Grid.layoutOccupancy` explicitly detects `min > cell` and routes to `setClipFrame` (a cell-sized clip with the child at natural size) precisely so an oversized child is clipped, not stretched; `Border`/`Split` place clipped collapsed regions at full size. Auto-lifting `BOTH`-filled children to their min inside `resolveBounds` would defeat that clip path and could re-introduce overflow the collapse animations rely on suppressing.
- **(B) Clamp the cross-axis dimension the box manager computes, before it calls `placeComponent`.** Chosen. HBox already does this for the main axis (`width = Math.max(width, minSize.width)` then `Math.min(width, maxSize.width)` at [`HBox.ts:709-710`](../src/typescript/lib/layout/HBox.ts#L709)); the fix is to give the cross axis the symmetric treatment. The box managers are the only managers that *compute* a per-child cross extent (rather than handing the child the whole cell), so they own the clamp.

The cross-axis clamp must respect the existing `Math.min(size.height, containerSize.height)` (a child taller than the container still gets capped to the container so it doesn't overflow a non-scrolling host) *and then* lift to min: `height = Math.min(size.height, containerSize.height); if (minSize) height = Math.max(height, minSize.height); if (maxSize) height = Math.min(height, maxSize.height)`. Min is applied last among the pair so it wins, consistent with the precedence rule; the container cap is applied first so a within-container child is unaffected (no-op when min ≤ height ≤ container, which is the overwhelming common case).

### Fix `clampWidth`/`clampHeight` to read the effective (merged) min/max, not just `_options`

[`clampWidth`/`clampHeight`](../src/typescript/lib/core/Component.ts#L2441) read `this._options.minSize ?? this._defaultOptions.minSize`, so a layout-managed child whose real min comes from its children (with no explicit `setMinSize`) is clamped against `{0,0}` — the committed size is *not* corrected, which is why the cross-axis miscompute reaches the DOM. **Decision:** route these through `this.getMinSize()`/`this.getMaxSize()` so the commit-time clamp uses the same effective constraints the layout managers reason about. This is the defence-in-depth backstop: even if a manager miscomputes, the committed `_width`/`_height` lands in range. (It cannot replace the box-manager fix, because the *positioning* math — row metrics, `y` displacement — still uses the manager-computed extent; a backstop on the stored size alone would leave the layout visually wrong.)

Risk: this changes the clamp for every `setWidth`/`setHeight` call, including the ones layout managers issue inside `commitBounds`. Because the default min is `{0,0}` and default max is `{MAX_VALUE, MAX_VALUE}`, the clamp is a no-op except where a real constraint exists — and where one exists, clamping to it is the intended behaviour. The `Absolute` manager deliberately commits oversized children for scroll; that still works, because an oversized child exceeds neither its own min nor (typically) its max, so the clamp leaves it alone. Verify in regression that `Absolute`-hosted scroll panels and `Grid` clip cells are unaffected (see *Verification*).

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

Cross-axis clamp in `HBox.doLayout` preferred-mode placement loop (mirror in `VBox` for width):

```typescript
let height: number;

if (!size || this.isStretching()) {
    height = maxSize ? Math.min(maxSize.height, containerSize.height) : containerSize.height;
} else {
    height = Math.min(size.height, containerSize.height);
}

// Cross-axis floor/ceil: the container cap above can drop height below the
// child's own minimum; lift it back so the child never lands sub-min, then
// re-apply the max (min wins on conflict, matching the main-axis clamp above).
if (minSize) height = Math.max(height, minSize.height);
if (maxSize) height = Math.min(height, maxSize.height);
```

---

## Ordered Implementation Steps

1. **`src/typescript/lib/core/Component.ts` — add `clampPreferredToConstraints`** and call it at the end of `getPreferredSize` (after the `if (!preferredSize) return null;` guard). → verify: `npx tsc --noEmit` clean.
2. **`src/typescript/lib/core/Component.ts` — re-point `clampWidth`/`clampHeight`** to `this.getMinSize()`/`this.getMaxSize()` instead of `this._options.minSize ?? this._defaultOptions.minSize` (and likewise max). Keep the null guards. → verify: `npx tsc --noEmit` clean.
3. **`src/typescript/lib/layout/HBox.ts:714-718`** — add the cross-axis (height) min/max clamp after the container cap, per *Internal Structure*. → verify: `grep -n "Math.max(height, minSize.height)" src/typescript/lib/layout/HBox.ts` returns the new line.
4. **`src/typescript/lib/layout/VBox.ts:592-596`** — add the symmetric cross-axis (width) min/max clamp after the container cap. → verify: `grep -n "Math.max(width, minSize.width)" src/typescript/lib/layout/VBox.ts` returns the new line.
5. **Audit the equal-mode / weight-cell paths.** In HBox/VBox `"equal"` mode the per-cell extent is `max(child.minWidth)`-floored already (`columnWidth`/`rowHeight`), and the cell is handed to the child via `FillType.BOTH`; weight cells in preferred mode (`width = (weight/totalWeight) * remainingWidth`) are *not* min-floored on the main axis. Decide and document: clamp weight cells to min on the main axis too (`if (minSize) width = Math.max(width, minSize.width)` already runs at [`HBox.ts:709`](../src/typescript/lib/layout/HBox.ts#L709) for *all* branches including weight — confirm by reading: the clamp sits after the `if (weight > 0)` branch, so weight cells ARE main-axis clamped). → verify by reading: the `if (minSize) width = Math.max(...)` line is outside the weight `if`. If confirmed, no change; note it in the plan's Verification as "weight cells already main-axis clamped."
6. **Confirm no other manager computes a sub-cell child extent.** `Grid` (occupancy + baseline), `Border`, `Fit`, `Card`, `Tab`, `Split`, `Absolute` either (a) hand the child the full cell via `BOTH` — covered by the `commitBounds`→`clampWidth/Height` backstop (step 2) — or (b) deliberately clip (`Grid` `setClipFrame`, `Border`/`Split` collapse). No per-manager clamp is added to these; the backstop is the enforcement. → verify: re-read each manager's `placeComponent`/`commitBounds` call sites confirm they pass either the full cell or an intentional clip rect.
7. **`Absolute` confirmation.** `Absolute.doLayout` bypasses `placeComponent` and calls `commitBounds` directly with the child's own preferred/size; step 2 now clamps that commit to the child's effective min/max. Confirm this does not break the "oversized child scrolls" intent — an oversized child exceeds neither its min nor max, so the clamp is a no-op. → verify: SplitPanel/scroll demo still scrolls (manual).
8. **Self-review checklist pass** (see *Verification*).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` (add `clampPreferredToConstraints`, clamp tail in `getPreferredSize`, re-point `clampWidth`/`clampHeight`) |
| Modify | `src/typescript/lib/layout/HBox.ts` (cross-axis height clamp) |
| Modify | `src/typescript/lib/layout/VBox.ts` (cross-axis width clamp) |

No files created or deleted. Grid/Border/Fit/Card/Tab/Split/Absolute are audited but, per the decision above, not modified — the `commitBounds` backstop covers their `BOTH`-fill paths.

---

## Verification

- **Typecheck:** `npx tsc --noEmit` — 0 errors.
- **Invariant grep:** `grep -n "Math.max(height, minSize.height)" src/typescript/lib/layout/HBox.ts` and `grep -n "Math.max(width, minSize.width)" src/typescript/lib/layout/VBox.ts` each return exactly the cross-axis line (plus VBox's pre-existing main-axis line for width).
- **min > preferred assertion (the bitten shape):** in a demo panel, build a child with `setMinSize(120, 40)` and `setPreferredSize(0, 0)`, place it in an HBox and a VBox. After layout, assert `child.getWidth() >= 120 && child.getHeight() >= 40`. Confirm `parent.getPreferredSize()` reports the child contributing ≥ its min, not 0 (the `getPreferredSize` clamp). The HBoxPanel / VBoxPanel / GridPanel demos are the natural homes; MiscPanel exercises the heaviest mixed layout and should be eyeballed for regressions.
- **Cross-axis floor:** a short child (`preferredSize.height` small, `minSize.height` large) in an HBox row lands at `minSize.height`, not squeezed to the row's text height. Inverse in VBox for width.
- **No-op claim:** a plain demo with default `{0,0}`/`{MAX,MAX}` constraints renders pixel-identical before/after (the clamp only bites where a real constraint exists). Spot-check BorderPanel, FitPanel, TabDemoPanel.
- **Clip paths intact:** Grid oversized-child clip cell (GridPanel), Border/Split collapsed regions (BorderPanel, SplitPanel) still clip rather than stretch — the `commitBounds` backstop must not have lifted a deliberately-clipped child to its min in a way that re-exposes overflow.
- **Scroll intact:** `Absolute`/autoScroll panels still scroll oversized content (SplitPanel, MiscPanel slow table).
- **Theme toggle:** flip light/dark on the demos above — no layout shift introduced by the clamp.
- **Self-review checklist:** (1) every changed line traces to A or B; (2) the `getPreferredSize` clamp returns `null` only when the un-clamped resolution was `null`; (3) the cross-axis clamp applies min after the container cap so min wins; (4) `clampWidth/Height` still null-guard; (5) no override getter that computes preferred independently of `super` was left unclamped (see *Potential Challenges*).

---

## Potential Challenges

- **Override getters that don't delegate to `super`.** [`Image.getPreferredSize`](../src/typescript/lib/component/display/Image.ts#L65) returns `{naturalWidth, naturalHeight}` directly — it never calls `super.getPreferredSize()`, so the base clamp won't run for it. Image's own `getMinSize` caps min at 100 and preferred is the natural size (≥ its min in practice), so the invariant already holds; **decision: leave Image unclamped but call it out** — if a future caller `setMaxSize`s an Image below its natural size, preferred would exceed max. Scope: catalogue now, clamp only if a real case appears (Non-Goal). [`Text.getPreferredSize`](../src/typescript/lib/component/input/Text.ts#L433) *does* call `super`, so it's covered; but [`Text.getMinSize`](../src/typescript/lib/component/input/Text.ts#L459) deliberately reports a height floor (one text line) that can exceed a caller's `setPreferredSize(w, tiny)` — this is the legitimate "min wins, preferred lifted to min" case the clamp now enforces, so it becomes *more* correct, not broken. Verify Text rows in BaselinePanel/HBoxPanel still align.
- **Blast radius of the `clampWidth/Height` change.** It now consults the merged min/max for every `setWidth`/`setHeight`, including the thousands of calls layout managers make. Mitigation: default constraints make it a no-op; the regression suite above spot-checks the managers that intentionally place children outside the cell (Grid clip, Border/Split collapse, Absolute scroll).
- **Double-clamping is harmless but worth noting.** A box-manager child is now clamped in the manager (step 3/4) *and* again in `commitBounds` (step 2). Both clamp to the same effective range, so the second is a no-op on the first's output — intentional defence in depth, no correctness issue.
- **`getMinSize` recursion cost in `getPreferredSize`.** The new clamp calls `getMinSize()`/`getMaxSize()`, which for a container recurse into the layout manager's `getMinSize` (which reads children). `getPreferredSize` already triggers the same recursion via the layout manager, so the added cost is one extra min + max pass per `getPreferredSize` call — measurable only on deep trees. If MiscPanel's slow table regresses, memoise within a layout pass (Non-Goal unless observed).

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `getPreferredSize` (1927), `setPreferredSize` (1950), `getMinSize` (1969), `getMaxSize` (2038), `clampWidth` (2441), `clampHeight` (2500), `_defaultOptions` size defaults (337-338), the `applyOptions` size dispatch (399-401).
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `resolveBounds` (290, the un-clamped `BOTH` branch), `commitBounds` (414), `placeComponent` (251).
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) / [`VBox.ts`](../src/typescript/lib/layout/VBox.ts) — placement loops and the `minSize.* > 0` guard hack.
- Override getters to keep in view: [`Image.ts`](../src/typescript/lib/component/display/Image.ts), [`Text.ts`](../src/typescript/lib/component/input/Text.ts), [`FieldSet.ts`](../src/typescript/lib/component/container/FieldSet.ts), [`Accordion.ts`](../src/typescript/lib/layout/Accordion.ts).

---

## Sibling Invariant Problems Catalogued

Found while reading; resolution noted:

1. **`maxSize < minSize` accepted silently.** `setMinSize`/`setMaxSize` never cross-check; `getMinSize`/`getMaxSize` merge independently. The new `clampPreferredToConstraints` resolves the *consumption* (min wins via `effectiveMax = Math.max(min, max)`), but the stored values can still be contradictory. **Scoped in** to the extent that preferred is resolved correctly; **not** adding a setter-time warning (Non-Goal).
2. **`clampWidth/Height` ignoring the layout-manager min** — the root cause of Part A reaching the DOM. **Scoped in** (step 2).
3. **`resolveBounds` `BOTH` branch has no clamp at all.** **Deliberately left** (see Architecture Decisions — clipping managers depend on it); the backstop is `commitBounds`→`clampWidth/Height`.
4. **Null-size fallback interaction.** Several managers fall back to `_defaultComponentWidth/Height` (100) when `getPreferredSize()` is null, and the `minSize.* > 0` guard exists only to stop the `{0,0}` default from short-circuiting the `??` chain. The clamp does not touch this path (a null preferred returns null, unclamped). **Non-Goal** to refactor the fallback.
5. **`getMinSize`/`getMaxSize` use `Math.max` to merge component + manager** — correct for min, but `getMaxSize` also uses `Math.max`, meaning a component max and a *larger* manager max yields the larger, i.e. the looser constraint. That is arguably wrong (max should be the tighter `Math.min`), but it is pre-existing, load-bearing behaviour outside this fix's scope. **Catalogued, Non-Goal.**

---

## Non-Goals

- **Setter-time normalisation / warnings for contradictory `min`/`max`/`preferred`.** Read-time clamping fully satisfies the invariant at the point of consumption; mutating stored options on write would break the options-bag-as-cache idiom and is unnecessary.
- **Clamping `Image.getPreferredSize`** (and any other override that bypasses `super`). Catalogued; no current case violates the invariant. Add only when a real regression appears.
- **Refactoring the `minSize.* > 0` guard hack** in HBox/VBox or the `_defaultComponentWidth/Height` null-fallback. Different concern (fallback selection), already commented, working.
- **Fixing `getMaxSize`'s `Math.max` merge** (sibling problem #5). Pre-existing, load-bearing, out of scope.
- **Adding a central clamp to `resolveBounds`'s `BOTH` branch.** Would defeat the deliberate clip paths in Grid/Border/Split.
- **Memoising `getMinSize`/`getMaxSize` within a layout pass.** Only if a measured regression on MiscPanel's slow table demands it.
