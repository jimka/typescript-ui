# Size-Constraint Invariant Enforcement — Implementation Plan

> **As built:** the final model diverged from this plan — see the *Implementation outcome — as built* section at the top of [`size-constraint-invariant-regressions.md`](size-constraint-invariant-regressions.md). In brief: the committed-size clamp is merged for general components but own-only for `Panel` (which fits its allocation and scrolls), `getPreferredSize` stayed own-scoped (not merged, for performance), `getMaxSize` now merges with `Math.min` and several managers' `getMaxSize` bugs were fixed. The `clampPreferredToConstraints` helper shipped but is fed the component's *own* constraints, not the merged ones.

## Overview

The framework carries an unstated invariant: on each axis every component satisfies `minSize ≤ preferredSize ≤ maxSize`, and a laid-out child's committed size stays inside `[minSize, maxSize]`. Both halves are currently breached.

- **Layout managers place children outside `[min, max]` on the cross axis.** The box managers clamp the *main* axis both ways but the *cross* axis only down to the container, never up to the child's own floor — [`HBox.layoutPreferredMode`](../src/typescript/lib/layout/HBox.ts#L466) (the cross-axis `heights.push(...)` at lines 466-470) and [`VBox.layoutPreferredMode`](../src/typescript/lib/layout/VBox.ts#L412) (the cross-axis `width` assignment at lines 412-416). The same gap exists wherever a manager passes `FillType.BOTH` to [`placeComponent`](../src/typescript/lib/layout/LayoutManager.ts#L251), because [`resolveBounds`](../src/typescript/lib/layout/LayoutManager.ts#L290)'s `BOTH` branch assigns `width = maxWidth; height = maxHeight` with no min/max clamp at all (the clamp only lives in the `NONE`/`HORIZONTAL`/`VERTICAL` branches).
- **Components report `preferredSize` outside `[min, max]`.** [`Component.setPreferredSize`](../src/typescript/lib/core/Component.ts#L1950) and [`getPreferredSize`](../src/typescript/lib/core/Component.ts#L1927) store and return the raw options value with no cross-check against min/max. A caller may `setMinSize(100, …)` then `setPreferredSize(0, …)` and the preferred wins in every layout-manager `getPreferredSize` summation — the exact shape that just bit a demo.

A third, already-present safety net complicates the picture and must be understood before touching anything: [`setWidth`/`setHeight`](../src/typescript/lib/core/Component.ts#L2476) already clamp the *committed* size via [`clampWidth`/`clampHeight`](../src/typescript/lib/core/Component.ts#L2441), but **only against the component's own `_options.minSize`/`_defaultOptions.minSize`** — not the merged [`getMinSize()`](../src/typescript/lib/core/Component.ts#L1969) that folds in the layout manager's own minimum. So a layout-managed child with no explicit `setMinSize` is unprotected, which is the real reason the cross-axis bug reaches the DOM rather than being silently corrected.

This is primarily an internal correctness fix — tightened *semantics* on three existing setters, with no new public component. The one new public surface is Grid's `clipSizing` option (with its `GridClipSizing` type and `getClipSizing`/`setClipSizing` pair), Grid's own knob for how it sizes a child that is clipped because its min exceeds its cell.

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

### Clip-capable managers size a sub-min child to PREFERRED, not min, by default

**The governing rule for this plan.** When a clip-capable layout manager must place a child in a space smaller than the child's `minSize`, it sizes that child to its **preferred** size (then clips), by default — not to `min`. Rationale (agreed with the user): if the manager is going to clip the child anyway, laying it out at a cramped `min` is wasted layout work and an arbitrary size; rendering at preferred shows the content at its intended size up to the clip edge.

### Per-manager clip knobs — each clip-capable manager owns its own option and default

There is **no shared global default and no shared knob.** Each clip-capable layout manager owns its **own** option governing how it sizes a child when the assigned space is below the child's min, and each manager defines its **own** default. Rationale: this lets each layout manager decide its own behaviour for the sub-min case rather than inheriting a forced global default — the box managers' main-axis overflow story and Grid's per-cell clip story are different concerns and can diverge.

- **Box managers (HBox/VBox):** their existing `overflowSizing` option **is** their knob — kept as-is. The type `BoxOverflowSizing = "preferred" | "min"` ([`BoxLayout.ts:36`](../src/typescript/lib/layout/BoxLayout.ts#L36)), the backing field `_overflowSizing` defaulting to `"preferred"` ([`BoxLayout.ts:75`](../src/typescript/lib/layout/BoxLayout.ts#L75)), the option field on `BoxLayoutOptions` ([`BoxLayout.ts:54`](../src/typescript/lib/layout/BoxLayout.ts#L54)), its dispatch in `applyOptions` ([`BoxLayout.ts:113`](../src/typescript/lib/layout/BoxLayout.ts#L113)), and the `getOverflowSizing`/`setOverflowSizing` pair ([`BoxLayout.ts:192`](../src/typescript/lib/layout/BoxLayout.ts#L192) / [`BoxLayout.ts:206`](../src/typescript/lib/layout/BoxLayout.ts#L206)) all already exist with the box managers' own default. No box-manager API change.
- **Grid:** gains its **own** new knob — a `clipSizing` option on `GridOptions`, typed `GridClipSizing = "preferred" | "min"`, backed by a private `_clipSizing` field, with `getClipSizing`/`setClipSizing`. Grid chooses its **own** default independently: `"preferred"` (the clip-at-preferred behaviour). Grid does **not** reuse `BoxOverflowSizing` — sub-min clip sizing is Grid's own concern, so it carries its own type. The new field follows the same option pattern as `defaultFill`/`defaultAnchor`/`baselineAlign` (private backing field, `GridOptions` field, `applyOptions` dispatch, typed getter/setter).

**Null-preferred → min fallback.** When the child reports a null `preferredSize`, there is nothing to grow to, so the rule degrades to the current min floor regardless of the option value. This guard is explicit in every site below.

**Per-axis, independently** — the preferred-vs-min choice is made on each axis on its own, like the rest of the invariant work.

**Border/Split collapse is NOT this case.** They clip a *collapsed region at full size* for an animation, not a cell-smaller-than-min situation. They are left untouched; do not "fix" them under this rule.

### Layout managers: clamp the cross axis in the box managers; do NOT add a clamp to the `BOTH` branch of `resolveBounds`

Two candidate fixes for Part A:

- **(A) Clamp inside `resolveBounds`'s `BOTH` branch.** Rejected as the sole fix. The `BOTH` branch deliberately means "fill the cell." Several managers rely on a child filling a cell that is *intentionally smaller* than the child's min and then **clipping** it — `Grid.layoutOccupancy` explicitly detects `min > cell` and routes to `setClipFrame` precisely so an oversized child is clipped, not stretched; `Border`/`Split` place clipped collapsed regions at full size. Auto-lifting `BOTH`-filled children to their min inside `resolveBounds` would defeat that clip path and could re-introduce overflow the collapse animations rely on suppressing.
- **(B) Clamp the cross-axis dimension the box manager computes, before it calls `placeComponent`.** Chosen. HBox already clamps the *main* axis (`width = Math.max(width, minSize.width)` then `Math.min(width, maxSize.width)` in `resolveChildWidth` at [`HBox.ts:577-583`](../src/typescript/lib/layout/HBox.ts#L577)); the fix gives the cross axis the symmetric treatment. The box managers are the only managers that *compute* a per-child cross extent (rather than handing the child the whole cell), so they own the clamp.

**The cross-axis clamp lifts to PREFERRED on overflow, not min.** When the cross axis is overflowing/clipping *and* `overflowSizing === "preferred"` (the default), the cross extent lifts to the child's **preferred** size (clamped to max), not its min. This keeps the cross axis symmetric with the main axis, which already honours preferred-on-overflow (via `computeEqualCellWidth` at [`HBox.ts:425-426`](../src/typescript/lib/layout/HBox.ts#L425) / `computeEqualCellHeight` at [`VBox.ts:370-371`](../src/typescript/lib/layout/VBox.ts#L370)).

Concretely, the cross-axis resolution starts from the existing container cap (`Math.min(size.height, containerSize.height)` — a child taller than the container is capped so it doesn't overflow a non-scrolling host), then: if the axis is overflowing and `overflowSizing === "preferred"`, lift to the child's preferred height (falling back to `minSize.height` when preferred is null); otherwise lift to `minSize.height` (the `"min"` escape hatch and the non-overflowing path keep the old floor); finally re-apply `maxSize.height`. The container cap stays first so a within-container child is unaffected (no-op when the child already fits, the overwhelming common case); max is applied last so it always caps.

### Fix `clampWidth`/`clampHeight` to read the effective (merged) min/max, not just `_options`

[`clampWidth`/`clampHeight`](../src/typescript/lib/core/Component.ts#L2441) read `this._options.minSize ?? this._defaultOptions.minSize`, so a layout-managed child whose real min comes from its children (with no explicit `setMinSize`) is clamped against `{0,0}` — the committed size is *not* corrected, which is why the cross-axis miscompute reaches the DOM. **Decision:** route these through `this.getMinSize()`/`this.getMaxSize()` so the commit-time clamp uses the same effective constraints the layout managers reason about. This is the defence-in-depth backstop: even if a manager miscomputes, the committed `_width`/`_height` lands in range. (It cannot replace the box-manager fix, because the *positioning* math — row metrics, `y` displacement — still uses the manager-computed extent; a backstop on the stored size alone would leave the layout visually wrong.)

Risk: this changes the clamp for every `setWidth`/`setHeight` call, including the ones layout managers issue inside `commitBounds`. Because the default min is `{0,0}` and default max is `{MAX_VALUE, MAX_VALUE}`, the clamp is a no-op except where a real constraint exists — and where one exists, clamping to it is the intended behaviour. The `Absolute` manager deliberately commits oversized children for scroll; that still works, because an oversized child exceeds neither its own min nor (typically) its max, so the clamp leaves it alone.

**Interaction with Grid's clip commit (see next decision).** Re-pointing `clampWidth`/`clampHeight` to the merged min has a consequence at Grid's clip branch: today Grid does `commitBounds(component, 0, 0, w, h)` with `w`/`h` the *cell* size, which is smaller than the child's min — so the re-pointed clamp would lift the inner child's committed size **up to min**. That is exactly the min-floor behaviour the clip-at-preferred rule reverses, so Grid's clip commit must size the inner child to preferred explicitly (next decision) rather than letting the cell-sized commit be clamped to min. Verify in regression that `Absolute`-hosted scroll panels and `Grid` clip cells are unaffected by the min-clamp itself (see *Verification*).

### Grid's clip path sizes the inner child to PREFERRED inside the cell-sized frame, governed by Grid's own `clipSizing` option

Grid's clip branch at [`Grid.ts:899-915`](../src/typescript/lib/layout/Grid.ts#L899) (inside `layoutOccupancy`'s `placeAt`) sizes the inner child to its **preferred** size inside the cell-sized clip frame: the frame takes the cell rect `(x, y, w, h)` and clips, while the inner child commits at preferred, falling back to min per axis only when preferred is null. The clip *frame* stays cell-sized — only the inner child's committed extent is the child's preferred (or min-fallback) size.

Grid owns its **own** knob for this — a new `clipSizing` option on `GridOptions`, typed `GridClipSizing = "preferred" | "min"`, backed by `_clipSizing` and defaulting to `"preferred"`. When set to `"min"`, the inner child commits at its min floor instead. This is Grid's own concern and Grid's own default — see the *Per-manager clip knobs* decision for why each clip-capable manager carries its own option rather than inheriting a shared one.

### Public API surface; magic numbers stay documented

The only new public surface is Grid's `clipSizing` option plus its `GridClipSizing` type and `getClipSizing`/`setClipSizing` pair (see *Public API*). The invariant-enforcement core adds no public surface: the clamp helper is `private`, and the cross-axis fix reuses the box managers' existing `overflowSizing` option. The one inline literal touched (`Number.MAX_VALUE` comparisons already present) needs no new constant. The existing `minSize.height > 0` guard hack in HBox/VBox (dodging the `{0,0}` default short-circuit in the preferred-fallback `??` chain) is **left untouched** — it solves a different problem (fallback selection, not invariant enforcement) and is already commented; see *Non-Goals*.

### CODE_CONVENTIONS tension

`getPreferredSize` gains a clamp tail; the method stays well under the 30-line decomposition threshold, and the clamp is extracted to the named `clampPreferredToConstraints` helper so the getter reads as "resolve, then clamp." No rule is violated. The "options bag is the cache" idiom is *preserved* by clamping on read rather than mutating the stored option on write.

---

## Public API (TypeScript Signatures)

Grid gains a sub-min clip-sizing knob, mirroring its existing `defaultFill`/`defaultAnchor`/`baselineAlign` option idiom (private backing field, `GridOptions` field, `applyOptions` dispatch, typed getter/setter):

```typescript
// src/typescript/lib/layout/Grid.ts

/** How {@link Grid} sizes a child whose min exceeds its assigned cell block (the clip case). */
export type GridClipSizing = "preferred" | "min";

export interface GridOptions extends LayoutManagerOptions {
    // ... existing fields ...

    /** Inner-child sizing when a cell is smaller than the child's min and the child is clipped. Default `"preferred"`. */
    clipSizing?: GridClipSizing;
}

class Grid extends LayoutManager {
    private _clipSizing: GridClipSizing = "preferred";

    getClipSizing(): GridClipSizing;
    setClipSizing(clipSizing: GridClipSizing): this;
}
```

`GridClipSizing` is exported alongside `GridOptions` from the `layout` barrel ([`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts)). The box managers add no new surface — they reuse `BoxOverflowSizing`/`overflowSizing`, already public.

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

Grid clip-commit sizing in the `min > cell` branch ([`Grid.ts:899-915`](../src/typescript/lib/layout/Grid.ts#L899), inside `layoutOccupancy`'s `placeAt`) — the frame stays cell-sized; the inner child commits at Grid's own `clipSizing` choice, per axis, with a null-preferred → min fallback:

```typescript
if (min && (min.width > w || min.height > h)) {
    // Clip with a cell-sized frame. Grid's own clipSizing option decides the
    // inner child's extent: "preferred" (the default) renders the content at
    // its intended size up to the clip edge; "min" parks it at its min floor.
    // Either way, a null preferred per axis falls back to min.
    const pref = this._clipSizing === "preferred" ? component.getPreferredSize() : null;
    const childW = pref ? pref.width  : min.width;
    const childH = pref ? pref.height : min.height;

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
6. **`src/typescript/lib/layout/Grid.ts` — add Grid's `clipSizing` knob.** (a) Declare `export type GridClipSizing = "preferred" | "min";`. (b) Add `clipSizing?: GridClipSizing;` to the `GridOptions` interface (near `defaultFill`/`defaultAnchor`/`baselineAlign`, ~18-37). (c) Add the private backing field `private _clipSizing: GridClipSizing = "preferred";` (with the other backing fields, ~47-54). (d) Dispatch it in `applyOptions` (`if (options.clipSizing !== undefined) { this.setClipSizing(options.clipSizing); }`, ~71-105). (e) Add the typed `getClipSizing()`/`setClipSizing(clipSizing)` pair mirroring `getDefaultFill`/`setDefaultFill` (~113-128), JSDoc'd. (f) Re-export `GridClipSizing` from the `layout` barrel ([`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts), alongside `GridOptions` at ~28). → verify: `grep -n "clipSizing\|GridClipSizing" src/typescript/lib/layout/Grid.ts` shows the type, option, field, dispatch, getter, and setter; `npx tsc --noEmit` clean.
7. **`src/typescript/lib/layout/Grid.ts:899-915`** — in `layoutOccupancy`'s `placeAt` `min > cell` clip branch, size the inner child per Grid's `_clipSizing`: `"preferred"` (default) reads `component.getPreferredSize()`, `"min"` skips it; per-axis null-preferred → min fallback, per *Internal Structure*. The `setClipFrame(x, y, w, h)` frame stays cell-sized. → verify: `grep -n "this._clipSizing" src/typescript/lib/layout/Grid.ts` returns the new clip-branch line; `npx tsc --noEmit` clean.
8. **Confirm no other manager computes a sub-cell child extent.** `Border`, `Fit`, `Card`, `Tab`, `Split`, `Absolute` either (a) hand the child the full cell via `BOTH` — covered by the `commitBounds`→`clampWidth/Height` backstop (step 2) — or (b) deliberately clip a *collapsed region at full size* (`Border`/`Split` collapse — NOT a sub-min cell, left untouched per the clip-at-preferred rule). No per-manager change is added to these. → verify: re-read each manager's `placeComponent`/`commitBounds` call sites confirm they pass either the full cell or a full-size collapse clip rect.
9. **`Absolute` confirmation.** `Absolute.doLayout` bypasses `placeComponent` and calls `commitBounds` directly with the child's own preferred/size; step 2 now clamps that commit to the child's effective min/max. Confirm this does not break the "oversized child scrolls" intent — an oversized child exceeds neither its min nor max, so the clamp is a no-op. → verify: SplitPanel/scroll demo still scrolls (manual).
10. **Documentation.** Update `docs/layouts/Grid.md` — note the `clipSizing` option in the `## Usage` `GridOptions` line, the `## Clip instead of spill` section, and the `## Common methods` table (`setClipSizing(...)` row); confirm the new public symbols land after `npm run docs:build` (per *Documentation Impact*). → verify: `npm run docs:build` — 0 errors, 0 link warnings.
11. **Self-review checklist pass** (see *Verification*).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` (add `clampPreferredToConstraints`, clamp tail in `getPreferredSize`, re-point `clampWidth`/`clampHeight`) |
| Modify | `src/typescript/lib/layout/HBox.ts` (cross-axis height clamp — lift to preferred on overflow) |
| Modify | `src/typescript/lib/layout/VBox.ts` (cross-axis width clamp — lift to preferred on overflow) |
| Modify | `src/typescript/lib/layout/Grid.ts` (new `clipSizing` option + `GridClipSizing` type + `_clipSizing` field + `GridOptions` field + `applyOptions` dispatch + `getClipSizing`/`setClipSizing`; clip branch reads `_clipSizing` to size the inner child to preferred/min inside the cell-sized frame) |
| Modify | `src/typescript/lib/layout/index.ts` (re-export `GridClipSizing` alongside `GridOptions`) |
| Modify | `docs/layouts/Grid.md` (document the `clipSizing` option / `setClipSizing`) |

No files created or deleted. Border/Fit/Card/Tab/Split/Absolute are audited but, per the decisions above, not modified — the `commitBounds` backstop covers their `BOTH`-fill paths, and Border/Split collapse clip a full-size region (not a sub-min cell).

---

## Verification

- **Typecheck:** `npx tsc --noEmit` — 0 errors.
- **Invariant grep:** `grep -n "isOverflowingY() && this._overflowSizing" src/typescript/lib/layout/HBox.ts` and `grep -n "isOverflowingX() && this._overflowSizing" src/typescript/lib/layout/VBox.ts` each return the new cross-axis preferred-lift line; `grep -n "this._clipSizing\|GridClipSizing\|setClipSizing" src/typescript/lib/layout/Grid.ts` returns the new clip-branch read plus the type, getter, and setter.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted); the new `clipSizing` / `GridClipSizing` / `setClipSizing` surface resolves.
- **min > preferred assertion (the bitten shape):** in a demo panel, build a child with `setMinSize(120, 40)` and `setPreferredSize(0, 0)`, place it in an HBox and a VBox. After layout, assert `child.getWidth() >= 120 && child.getHeight() >= 40`. Confirm `parent.getPreferredSize()` reports the child contributing ≥ its min, not 0 (the `getPreferredSize` clamp). The HBoxPanel / VBoxPanel / GridPanel demos are the natural homes; MiscPanel exercises the heaviest mixed layout and should be eyeballed for regressions.
- **Cross-axis lands at PREFERRED on overflow (default):** a short child (`preferredSize.height` between min and the squeezed container height, `minSize.height` large) in an *overflowing* HBox row lands at its **preferred** height — not at min and not squeezed to the row's text height — with the default `overflowSizing: "preferred"`. Inverse in VBox for width.
- **`overflowSizing: "min"` still forces min:** the same overflowing row with `overflowSizing: "min"` lands the cross axis at `minSize`, confirming the escape hatch.
- **Null-preferred floors to min:** a child reporting `null` preferred on the overflowing cross axis falls back to `minSize` (nothing to grow to).
- **Grid clip — both `clipSizing` values:** in GridPanel, an oversized child whose `min` exceeds its cell. With the default `clipSizing: "preferred"`, the child renders at its **preferred** size clipped to the cell rect (clip frame stays cell-sized), not at min. With `clipSizing: "min"`, the same child renders at its **min** floor inside the cell-sized clip frame — confirming Grid's own knob flips the behaviour. With a null-preferred child, both values floor to min.
- **No-op claim:** a plain demo with default `{0,0}`/`{MAX,MAX}` constraints renders pixel-identical before/after (the clamp only bites where a real constraint exists). Spot-check BorderPanel, FitPanel, TabDemoPanel.
- **Collapse clips intact:** Border/Split collapsed regions (BorderPanel, SplitPanel) still clip a full-size region rather than stretch or shrink — they are untouched by the clip-at-preferred rule (not a sub-min cell case).
- **Scroll intact:** `Absolute`/autoScroll panels still scroll oversized content (SplitPanel, MiscPanel slow table).
- **Theme toggle:** flip light/dark on the demos above — no layout shift introduced by the clamp.
- **Self-review checklist:** (1) every changed line traces to A or B; (2) the `getPreferredSize` clamp returns `null` only when the un-clamped resolution was `null`; (3) the cross-axis clamp lifts to preferred when overflowing with default `overflowSizing` (null-preferred → min), to min otherwise, with max applied last; (4) Grid's clip frame stays cell-sized while the inner child commits per `_clipSizing` — preferred under the default, min under `"min"` (null-preferred → min either way) — and `clipSizing` is wired through `GridOptions` + `applyOptions` + getter/setter + the barrel; (5) `clampWidth/Height` still null-guard; (6) no override getter that computes preferred independently of `super` was left unclamped (see *Potential Challenges*).

---

## Potential Challenges

- **Override getters that don't delegate to `super`.** [`Image.getPreferredSize`](../src/typescript/lib/component/display/Image.ts#L65) returns `{naturalWidth, naturalHeight}` directly — it never calls `super.getPreferredSize()`, so the base clamp won't run for it. Image's own `getMinSize` caps min at 100 and preferred is the natural size (≥ its min in practice), so the invariant already holds; **decision: leave Image unclamped but call it out** — if a future caller `setMaxSize`s an Image below its natural size, preferred would exceed max. Scope: catalogue now, clamp only if a real case appears (Non-Goal). [`Text.getPreferredSize`](../src/typescript/lib/component/input/Text.ts#L433) *does* call `super`, so it's covered; but [`Text.getMinSize`](../src/typescript/lib/component/input/Text.ts#L459) deliberately reports a height floor (one text line) that can exceed a caller's `setPreferredSize(w, tiny)` — this is the legitimate "min wins, preferred lifted to min" case the clamp now enforces, so it becomes *more* correct, not broken. Verify Text rows in BaselinePanel/HBoxPanel still align.
- **Blast radius of the `clampWidth/Height` change.** It now consults the merged min/max for every `setWidth`/`setHeight`, including the thousands of calls layout managers make. Mitigation: default constraints make it a no-op; the regression suite above spot-checks the managers that intentionally place children outside the cell (Grid clip, Border/Split collapse, Absolute scroll).
- **Double-clamping is harmless but worth noting.** A box-manager child's cross extent is resolved in the manager (step 3/4 — now to preferred-or-min within `[min, max]`) and then `commitBounds` (step 2) re-clamps to `[min, max]`. The manager's result already lands inside `[min, max]` (preferred is `≥ min`, and max is applied last in the manager), so the `commitBounds` clamp is a no-op on it — intentional defence in depth, no correctness issue. The one place the two would *disagree* is Grid's clip commit: a bare cell-sized commit would be lifted to min by step 2, which is why Grid commits the inner child at its `clipSizing` extent explicitly (step 7) so the backstop's min-floor doesn't override the `"preferred"` default.
- **`getMinSize` recursion cost in `getPreferredSize`.** The new clamp calls `getMinSize()`/`getMaxSize()`, which for a container recurse into the layout manager's `getMinSize` (which reads children). `getPreferredSize` already triggers the same recursion via the layout manager, so the added cost is one extra min + max pass per `getPreferredSize` call — measurable only on deep trees. If MiscPanel's slow table regresses, memoise within a layout pass (Non-Goal unless observed).

---

## Documentation Impact

Grid's new `clipSizing` option / `GridClipSizing` type / `setClipSizing` setter are public layout surface (the invariant-enforcement core is an internal fix with no doc impact).

- **Barrel:** the `layout` subpath barrel ([`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts)) already exports `Grid` and `GridOptions`; add a `GridClipSizing` type re-export so it lands in `docs/api/layout/`. `GridClipSizing` carries an `@category Layouts` tag like its siblings.
- **Curated page:** [`docs/layouts/Grid.md`](../docs/layouts/Grid.md) covers Grid — update the `## Usage` `GridOptions` field list (currently names `rows`/`columns`/`spacing`/`defaultFill`/`defaultAnchor`/`baselineAlign`/`columnTracks`/`rowTracks`) to include `clipSizing`, extend the `## Clip instead of spill` section to explain that the clipped child now renders at its preferred size by default and `clipSizing: "min"` reverts to the min floor, and add a `setClipSizing(...)` row to the `## Common methods` table. No new page, so no `docs/layouts/index.md` catalog or `docs/.vitepress/config.mts` sidebar entry is needed (Grid is already listed).
- **JSDoc:** `clipSizing`/`GridClipSizing` references stay within the `layout` bucket, so `{@link GridClipSizing}` resolves without a cross-bucket markdown link.
- **Build:** `npm run docs:build` — 0 errors, 0 link warnings.

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `getPreferredSize` (1927), `setPreferredSize` (1950), `getMinSize` (1969), `getMaxSize` (2038), `clampWidth` (2441), `clampHeight` (2500), `_defaultOptions` size defaults (337-338), the `applyOptions` size dispatch (399-401).
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `resolveBounds` (290, the un-clamped `BOTH` branch), `commitBounds` (414), `placeComponent` (251).
- [`src/typescript/lib/layout/BoxLayout.ts`](../src/typescript/lib/layout/BoxLayout.ts) — `BoxOverflowSizing` (36), `BoxLayoutOptions.overflowSizing` (54), `_overflowSizing` default `"preferred"` (75), option dispatch (113), `getOverflowSizing` (192), `setOverflowSizing` (206).
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) / [`VBox.ts`](../src/typescript/lib/layout/VBox.ts) — `layoutPreferredMode` cross-axis sites (HBox 466-470 / VBox 412-416), the main-axis preferred-on-overflow fallback (`computeEqualCellWidth` 425-426 / `computeEqualCellHeight` 370-371), `resolveChildWidth`/`resolveChildHeight` main-axis min/max clamp (HBox 577-583 / VBox 504-510), and the `minSize.* > 0` guard hack.
- [`src/typescript/lib/layout/Grid.ts`](../src/typescript/lib/layout/Grid.ts) — the option pattern to mirror (`GridOptions` 18-37, backing fields 47-54, `applyOptions` dispatch 71-105, `getDefaultFill`/`setDefaultFill` 113-128), and the `min > cell` clip branch (899-915, in `layoutOccupancy`'s `placeAt`) where the inner child commits per `_clipSizing`.
- Override getters to keep in view: [`Image.ts`](../src/typescript/lib/component/display/Image.ts), [`Text.ts`](../src/typescript/lib/component/input/Text.ts), [`FieldSet.ts`](../src/typescript/lib/component/container/FieldSet.ts), [`Accordion.ts`](../src/typescript/lib/layout/Accordion.ts).

---

## Sibling Invariant Problems Catalogued

Found while reading; resolution noted:

1. **`maxSize < minSize` accepted silently.** `setMinSize`/`setMaxSize` never cross-check; `getMinSize`/`getMaxSize` merge independently. The new `clampPreferredToConstraints` resolves the *consumption* (min wins via `effectiveMax = Math.max(min, max)`), but the stored values can still be contradictory. **Scoped in** to the extent that preferred is resolved correctly; **not** adding a setter-time warning (Non-Goal).
2. **`clampWidth/Height` ignoring the layout-manager min** — the root cause of Part A reaching the DOM. **Scoped in** (step 2).
3. **`resolveBounds` `BOTH` branch has no clamp at all.** **Deliberately left** (see Architecture Decisions — clipping managers depend on it); the backstop is `commitBounds`→`clampWidth/Height`. Note: Grid's clip branch commits the inner child at its `clipSizing` extent explicitly rather than relying on the backstop's min-floor, since the merged `clampWidth/Height` would otherwise lift the cell-sized commit up to min and defeat the `"preferred"` default.
4. **Null-size fallback interaction.** Several managers fall back to `_defaultComponentWidth/Height` (100) when `getPreferredSize()` is null, and the `minSize.* > 0` guard exists only to stop the `{0,0}` default from short-circuiting the `??` chain. The clamp does not touch this path (a null preferred returns null, unclamped). **Non-Goal** to refactor the fallback.
5. **`getMinSize`/`getMaxSize` use `Math.max` to merge component + manager** — correct for min, but `getMaxSize` also uses `Math.max`, meaning a component max and a *larger* manager max yields the larger, i.e. the looser constraint. That is arguably wrong (max should be the tighter `Math.min`), but it is pre-existing, load-bearing behaviour outside this fix's scope. **Catalogued, Non-Goal.**

---

## Non-Goals

- **Setter-time normalisation / warnings for contradictory `min`/`max`/`preferred`.** Read-time clamping fully satisfies the invariant at the point of consumption; mutating stored options on write would break the options-bag-as-cache idiom and is unnecessary.
- **Clamping `Image.getPreferredSize`** (and any other override that bypasses `super`). Catalogued; no current case violates the invariant. Add only when a real regression appears.
- **Refactoring the `minSize.* > 0` guard hack** in HBox/VBox or the `_defaultComponentWidth/Height` null-fallback. Different concern (fallback selection), already commented, working.
- **Fixing `getMaxSize`'s `Math.max` merge** (sibling problem #5). Pre-existing, load-bearing, out of scope.
- **Adding a central clamp to `resolveBounds`'s `BOTH` branch.** Would defeat the deliberate clip paths in Grid/Border/Split.
- **Touching Border/Split collapse clips.** They clip a *collapsed region at full size* for an animation, not a cell-smaller-than-min situation — explicitly out of scope of the clip-at-preferred rule. Do not "fix" them under it.
- **Memoising `getMinSize`/`getMaxSize` within a layout pass.** Only if a measured regression on MiscPanel's slow table demands it.
