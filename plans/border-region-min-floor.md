# Border Region Min-Floor — Implementation Plan

## Overview

The `Border` layout manager allocates each fixed region (NORTH / SOUTH on the height axis, WEST / EAST on the width axis) from the region component's **preferred** main-axis extent, and never floors it at the region component's **minimum**. When a region reports a preferred main-axis size *below* its own merged minimum, `Border` under-allocates the region: the reserved band is too short, the center overlaps it, and the region's clip frame clips the component's own content.

The under-allocation happens at two spots in [`Border.ts`](../src/typescript/lib/layout/Border.ts):

- **`doLayout`** sizes each region from raw `getPreferredSize()`, feeding it to `regionExtent` ([Border.ts:905](../src/typescript/lib/layout/Border.ts#L905), [:956](../src/typescript/lib/layout/Border.ts#L956), [:1003](../src/typescript/lib/layout/Border.ts#L1003), [:1012](../src/typescript/lib/layout/Border.ts#L1012)) and to the clip-frame / placement calls in each region block.
- **`getPreferredSize`** ([Border.ts:535](../src/typescript/lib/layout/Border.ts#L535)) sums each region's raw preferred main-axis extent, so the container reports a preferred size that is smaller than what `doLayout` will actually reserve.

The fix floors each fixed region's preferred main-axis extent at that region's `getMinSize()` main-axis value — `max(preferred, min)` — at both spots. This mirrors what `VBox.preferredChildHeight` ([VBox.ts:562](../src/typescript/lib/layout/VBox.ts#L562)) and `HBox.preferredChildWidth` ([HBox.ts:591](../src/typescript/lib/layout/HBox.ts#L591)) already do for a fixed child. Reading a region's `getMinSize()` from inside `Border` is a non-recursive sibling call, so it is cheap and safe — unlike flooring inside `Component.getPreferredSize`, which the framework deliberately forbids ([Component.ts:2624](../src/typescript/lib/core/Component.ts#L2624)).

The whole change is confined to [`Border.ts`](../src/typescript/lib/layout/Border.ts) and its test [`Border.test.ts`](../tests/component/layout/Border.test.ts). No public API changes.

---

## Architecture Decisions

### Floor the fixed region's allocated extent and clip frame at the region's own min

In `doLayout`, compute each fixed region's main-axis extent as `max(preferred, regionMin)` and use that floored value everywhere the raw preferred main-axis is used today: the `regionExtent` call that sets the center offset, and the `setClipFrame` / `commitBounds` / `placeComponent` calls that size the region's box and its clip frame.[^floor-both] This is the same floor `VBox`/`HBox` apply to a fixed child.[^precedent]

### Floor `getPreferredSize`, leave the other size reports alone

`getPreferredSize` must sum the *floored* region extents, so `Border`'s own reported preferred size matches what `doLayout` reserves.[^prefsize] `getMinSize` and `computeTotalMinSize` already sum region **mins**, and `getMaxSize` sums region **maxes** — none needs the floor. Only the preferred aggregation, which sums raw preferreds, is affected.

### This does not contradict the "Border is a faithful propagator, do not modify" ruling

The `size-constraint-invariant-regressions` plan called `Border.getMinSize`/`getPreferredSize` "faithful propagators … read-only — do not modify" and fixed each observed `preferred < min` inversion **at the leaf** ([size-constraint-invariant-regressions.md:97](../plans/implemented/size-constraint-invariant-regressions.md), [:234](../plans/implemented/size-constraint-invariant-regressions.md)). That ruling was scoped to those specific leaves; it did not audit or rule on `doLayout`'s clip-frame sizing, and it does not conflict with this fix.[^not-rejected] The floor here *restores* the very invariant that plan defends: without it, a region with preferred 28 / min 30 makes `Border.getPreferredSize` report 28 while `Border.getMinSize` reports 30 — `Border` itself violating `min ≤ preferred` as seen by its parent. Flooring keeps `Border`'s aggregate preferred ≥ its aggregate min.[^border-inversion]

### The test asserts CENTER geometry, not the region's own committed height

A region component whose preferred is below its min is already lifted to its min when committed, because `commitBounds → clampHeight/clampWidth` floors the committed size at the merged min (the `size-constraint-invariant` backstop). So `north.getHeight()` reads the min in *both* the buggy and fixed builds — asserting on it is vacuous. The fix's real observable is the *reserved band*: with the floor, CENTER starts below the floored (30px) band instead of the un-floored (28px) band, so `center.getHeight()` / `center.getY()` shift by exactly the floor delta.[^observable] Tests assert CENTER geometry and `Border.getPreferredSize`.

### Collapse is preserved by construction

The floor is applied only to the value *fed into* `regionExtent`; `regionExtent`'s body is unchanged and still returns `COLLAPSE_STRIP_SIZE` when the region is collapsed, discarding its argument ([Border.ts:406](../src/typescript/lib/layout/Border.ts#L406)). `getPreferredSize`'s collapsed branch keeps its existing `isRegionCollapsed ? COLLAPSE_STRIP_SIZE : …` ternary, with the floor added only to the not-collapsed side. A collapsed region therefore still collapses to the strip regardless of its min.

---

## Internal Structure

A single private helper does the floor, mirroring `VBox.preferredChildHeight` / `HBox.preferredChildWidth`:

```typescript
/**
 * Floors a region's preferred main-axis extent at the region component's own
 * minimum main-axis extent, so a region whose consumer pinned a sub-minimum
 * preferredSize is still allocated — and clip-framed — at the size the
 * component will clamp itself up to. Mirrors VBox.preferredChildHeight /
 * HBox.preferredChildWidth. Reading the region's getMinSize() here is a
 * non-recursive sibling call (not a re-entry into this manager's own gathering).
 *
 * @param preferred - The region's preferred main-axis extent.
 * @param min - The region's min-size, or null.
 * @param vertical - True for NORTH/SOUTH (height axis), false for WEST/EAST (width axis).
 * @returns max(preferred, region min on the main axis).
 */
private flooredMainExtent(preferred: number, min: Size | null, vertical: boolean): number {
    const minMain = min ? (vertical ? min.height : min.width) : 0;

    return Math.max(preferred, minMain);
}
```

`doLayout`, NORTH block — the floored extent replaces every raw `preferredSize.height`:

```typescript
// before
let northHeight = this.regionExtent(Placement.NORTH, preferredSize.height);
// … placeComponent(north, …, preferredSize.height + northInsetTop, …)
// … north.setClipFrame(northX, northY, northWidth, preferredSize.height + northInsetTop);
// … this.commitBounds(north, 0, 0, northWidth, preferredSize.height + northInsetTop);

// after
const northExtent = this.flooredMainExtent(preferredSize.height, north.getMinSize(), true);
let northHeight = this.regionExtent(Placement.NORTH, northExtent);
// … placeComponent(north, …, northExtent + northInsetTop, …)
// … north.setClipFrame(northX, northY, northWidth, northExtent + northInsetTop);
// … this.commitBounds(north, 0, 0, northWidth, northExtent + northInsetTop);
```

`getPreferredSize`, NORTH block — floor the height contribution (cross-axis width stays raw preferred, matching `doLayout` where NORTH spans the full container width):

```typescript
if (north) {
    let size = north.getPreferredSize();
    if (size) {
        innerWidth = Math.max(innerWidth, size.width);
        const flooredHeight = this.flooredMainExtent(size.height, north.getMinSize(), true);
        innerHeight += this.isRegionCollapsed(Placement.NORTH) ? COLLAPSE_STRIP_SIZE : flooredHeight;
    }
}
```

---

## Ordered Implementation Steps

1. **Add the helper.** In [`Border.ts`](../src/typescript/lib/layout/Border.ts), add the private `flooredMainExtent(preferred, min, vertical)` method (snippet above) next to `regionExtent`. `Size` is already imported ([Border.ts:10](../src/typescript/lib/layout/Border.ts#L10)). → verify: `npx tsc --noEmit` in `packages/lib`.

2. **Floor `doLayout` NORTH** ([Border.ts:894–940](../src/typescript/lib/layout/Border.ts#L894)). After the `preferredSize` null-throw, add `const northExtent = this.flooredMainExtent(preferredSize.height, north.getMinSize(), true);`. Replace `preferredSize.height` with `northExtent` in: the `regionExtent(Placement.NORTH, …)` call, the collapsible-branch `placeComponent` height, the frame-branch `setClipFrame` height, and the frame-branch `commitBounds` height. (`northInsetTop` addition stays as-is.)

3. **Floor `doLayout` SOUTH** ([Border.ts:950–988](../src/typescript/lib/layout/Border.ts#L950)). Add `const southExtent = this.flooredMainExtent(preferredSize.height, south.getMinSize(), true);`. Replace `preferredSize.height` with `southExtent` in: `regionExtent(Placement.SOUTH, …)`, `southFullY` (the `height - preferredSize.height` bottom-anchor), the `placeComponent` height, `setClipFrame` height, and `commitBounds` height.

4. **Floor `doLayout` EAST** ([Border.ts:997–1004](../src/typescript/lib/layout/Border.ts#L997)). After the `eastPreferred` null-throw, add `const eastExtent = this.flooredMainExtent(eastPreferred.width, east.getMinSize(), false);`. Set `eastFullWidth = eastExtent;` and `eastPreferredWidth = this.regionExtent(Placement.EAST, eastExtent);`. The downstream EAST block (eastFullX, placeComponent, frame, commit) already reads `eastFullWidth` / `eastPreferredWidth`, so no further edits there.

5. **Floor `doLayout` WEST** ([Border.ts:1006–1042](../src/typescript/lib/layout/Border.ts#L1006)). After the `preferredSize` null-throw, add `const westExtent = this.flooredMainExtent(preferredSize.width, west.getMinSize(), false);`. Replace `preferredSize.width` with `westExtent` in the `regionExtent(Placement.WEST, …)` inside `westWidth` and in the `westFullWidth = Math.max(0, Math.min(preferredSize.width, width - eastPreferredWidth))` line. The `Math.min(…, width - eastPreferredWidth)` overlap-avoidance clamp stays.

6. **Floor `getPreferredSize`** ([Border.ts:559–597](../src/typescript/lib/layout/Border.ts#L559)). In each of the four edge-region `if` blocks (NORTH, SOUTH, WEST, EAST), compute `flooredMainExtent(size.<axis>, <region>.getMinSize(), <vertical>)` and use it in place of `size.height` / `size.width` on the *main axis only* (NORTH/SOUTH: height; WEST/EAST: width). Leave the cross-axis `Math.max(innerWidth, size.width)` (N/S) and `Math.max(middleHeight, size.height)` (W/E) untouched, and leave the CENTER block untouched (CENTER is not a fixed region).

7. **Leave `getMinSize`, `getMaxSize`, `computeTotalMinSize`, and `regionExtent` unchanged.** → verify: `grep -n 'flooredMainExtent' packages/lib/src/typescript/lib/layout/Border.ts` shows exactly nine occurrences (one definition, four in `doLayout`, four in `getPreferredSize`).

8. **Add tests** to [`Border.test.ts`](../tests/component/layout/Border.test.ts) per `## Expected Behaviour`. → verify: `npx vitest run tests/component/layout/Border.test.ts` in `packages/lib`.

9. **Full check.** → verify: `npx tsc --noEmit`, `npx eslint` on `Border.ts`, and the full `npx vitest run` in `packages/lib` are green.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` |
| Modify | `packages/lib/tests/component/layout/Border.test.ts` |

---

## Expected Behaviour

Reproduction double — a region reporting **preferred below its merged min** without an explicit min *constraint* (an explicit `setMinSize` would clamp the reported preferred up via [Component.ts:2632](../src/typescript/lib/core/Component.ts#L2632), hiding the bug). A test-local subclass models the merged-min case directly:[^double]

```typescript
class SubMinRegion extends Component {
    getPreferredSize(): Size { return { width: 50, height: 28 }; }
    getMinSize(): Size { return { width: 50, height: 30 }; }
}
```

All cases are **offline-testable** with the file's existing `installTestDOM` + `hostBorder` + `doLayout` harness ([Border.test.ts:22](../tests/component/layout/Border.test.ts#L22), [:82](../tests/component/layout/Border.test.ts#L82)).

1. **NORTH floors to its min (height axis).** `SubMinRegion` in NORTH + a CENTER (`preferredSize 10×10`), host `400×300`, `clearInsets`, spacing = default 5. `doLayout`. Then `center.getY()` (relative measure) reflects a **30px** NORTH band + spacing, and `center.getHeight() === inner.height - 30 - spacing`. Without the fix this would be `inner.height - 28 - spacing`. Unit-testable.

2. **SOUTH floors to its min (height axis).** `SubMinRegion` in SOUTH + CENTER. `center.getHeight() === inner.height - 30 - spacing`; the SOUTH band is 30, not 28. Unit-testable.

3. **WEST floors to its min (width axis).** A `SubMinRegion` variant reporting preferred `28×50` / min `30×50` in WEST + CENTER. `center.getWidth() === inner.width - 30 - spacing`; the WEST band is 30, not 28. Unit-testable.

4. **EAST floors to its min (width axis).** Same width variant in EAST + CENTER. `center.getWidth() === inner.width - 30 - spacing`; the EAST band is 30, not 28. Unit-testable.

5. **A region whose preferred already exceeds its min is unaffected (floor is a no-op).** A plain `Component({ preferredSize: 50×30 })` in NORTH (min 0) reserves 30 exactly, and `center.getHeight() === inner.height - 30 - spacing` — identical to the pre-fix result. This is the existing "NORTH spans the full content width at its preferred height" contract ([Border.test.ts:82](../tests/component/layout/Border.test.ts#L82)); it must stay green. Unit-testable.

6. **`Border.getPreferredSize` reflects the floored extent.** `SubMinRegion` (pref 28 / min 30) in NORTH, no CENTER. `host.getPreferredSize()!.height` equals `30 + perimeter`, not `28 + perimeter`; and `host.getPreferredSize()!.height >= host.getMinSize()!.height` (the restored `min ≤ preferred`). Unit-testable.

7. **A collapsed region still collapses to the strip regardless of min.** A **collapsible** region (`collapsible: true`) with preferred 28 / min 30, collapsed via `setRegionCollapsed(placement, true)`; `host.getPreferredSize()` includes `COLLAPSE_STRIP_SIZE` (18) for that region's axis, not 30 — the floor does not leak into the collapsed branch. (`getPreferredSize` reads the collapse flag synchronously, so this needs no animation to settle.) Unit-testable.

8. **Visual regression check (manual).** In the app, a `Border` region holding glyph buttons pinned to a sub-content-min `preferredSize` no longer clips the buttons at the region's inner edge, and the center no longer overlaps the region. Manual — the 2px clip is a rendered-pixel effect the offline harness cannot show.

---

## Verification

- `npx tsc --noEmit` (in `packages/lib`) — clean.
- `npx eslint packages/lib/src/typescript/lib/layout/Border.ts` — clean (no raw-DOM / style violations introduced; the change is arithmetic only).
- `npx vitest run tests/component/layout/Border.test.ts` — the new cases (1–7) plus the pre-existing docking-geometry cases pass.
- `npx vitest run` (full `packages/lib` suite) — green; watch for any layout snapshot that assumed the old un-floored band.
- Manual smoke (case 8) at `http://localhost:8015` on a Border/toolbar demo panel; toggle theme to confirm no chrome regression.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) — the fix site: `regionExtent` (406), `getPreferredSize` (535), `doLayout` region blocks (894–1105).
- [`packages/lib/src/typescript/lib/layout/VBox.ts`](../src/typescript/lib/layout/VBox.ts) — **precedent.** `preferredChildHeight` (562) floors a fixed child at `max(preferred, min)` with a remark naming the exact `preferred < min` under-reservation this plan fixes.
- [`packages/lib/src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) — **precedent.** `preferredChildWidth` (591), the width-axis twin.
- [`packages/lib/src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `getPreferredSize` (2607) and its constraint-only clamp comment (2624): why the floor cannot live here and must live in the manager; `clampWidth`/`clampHeight` are the committed-size backstop that makes the region's *own* height read as its min in both builds.
- [`packages/lib/src/typescript/lib/layout/CollapseSupport.ts`](../src/typescript/lib/layout/CollapseSupport.ts) — `COLLAPSE_STRIP_SIZE = 18` (13), the value a collapsed region reserves.
- [`packages/lib/tests/component/layout/Border.test.ts`](../tests/component/layout/Border.test.ts) — the offline harness (`installTestDOM`, `hostBorder`, `placement`) the new tests extend.
- [`plans/implemented/border-region-clip-frames.md`](../plans/implemented/border-region-clip-frames.md) — the clip-frame mechanism whose "frame equals the region's committed box" assumption breaks exactly when `preferred < min`.
- [`plans/implemented/size-constraint-invariant-regressions.md`](../plans/implemented/size-constraint-invariant-regressions.md) — the "faithful propagator / fix at the leaf" ruling this plan is reconciled against (see Architecture Decisions).

---

## Non-Goals

- **No change to `Component.getPreferredSize` or its constraint-only clamp.** The merged-min envelope is intentionally enforced only on the committed size; flooring preferred there would make layout-gathering re-entrant and exponential ([Component.ts:2624](../src/typescript/lib/core/Component.ts#L2624)).
- **No change to `getMinSize`, `getMaxSize`, `computeTotalMinSize`, or `regionExtent`.** They already handle min/max/collapse correctly.
- **No leaf fixes.** This plan does not retro-fit `preferredSize`/`minSize` on any consumer component (e.g. RotatedRecordPanel, which already migrated to `ToolBar`). The framework floor is the fix; the leaves are out of scope.
- **No collapse-animation change.** The collapse geometry, `runCollapse`, and clip-path keyframes are untouched.

---

## Notes

[^floor-both]: Both spots are needed because they are two independent under-allocations. The `regionExtent` result sets `middleY` / `centerX` — the center's offset — so an un-floored value lets the center overlap the region by the `min − preferred` delta. The `setClipFrame` / `commitBounds` size sets the region's clip frame; the region *component* is separately clamped up to its min when committed (via `clampHeight`/`clampWidth`), but the clip **frame** is not, so an un-floored frame is shorter than the component inside it and clips `min − preferred` pixels of real content. Flooring the same value for both keeps the frame equal to the committed box — the perfect-fit property [`border-region-clip-frames.md`](../plans/implemented/border-region-clip-frames.md) assumed but which only held while `preferred ≥ min`.

[^precedent]: [`VBox.preferredChildHeight`](../src/typescript/lib/layout/VBox.ts#L562) returns `minSize ? Math.max(preferred, minSize.height) : preferred`, and its remark states the rule verbatim: "a child placed at `max(preferred, min)` must reserve that same height in the fixed total, or a child reporting `preferred < min` (a `min ≤ preferred` invariant violation) would be under-reserved and push the weighted cells out, overflowing the column." [`HBox.preferredChildWidth`](../src/typescript/lib/layout/HBox.ts#L591) is the width twin. Border is the box-family outlier that never floored; this fix makes it conform.

[^prefsize]: `Border` has no shrink/redistribute path — it rigidly reserves each fixed region and hands the remainder to CENTER. So if `getPreferredSize` under-reports a region (sums 28 while `doLayout` reserves 30), a parent that fits `Border` to its preferred gives `Border` 2px too little, and CENTER — the residual — absorbs the whole shortfall and clips. `HBox`/`VBox` tolerate the same under-report in their own `getPreferredSize` because their `doLayout` shrink path degrades gracefully; `Border` cannot, which is why the preferred aggregation must floor here even though the box managers' `getPreferredSize` does not.

[^not-rejected]: The ruling's two anchors are both about the **reporting** methods and the specific leaf inversions: [line 97](../plans/implemented/size-constraint-invariant-regressions.md) ("the inversions originate at the leaves, not Border") and [line 234](../plans/implemented/size-constraint-invariant-regressions.md) ("`getPreferredSize` (451) / `getMinSize` (522) faithful propagators — read-only — do not modify"). Neither audited `doLayout`'s clip-frame sizing. Separately, the `size-constraint-invariant` plan's step 8 asserted "no other manager computes a sub-cell child extent … Border … hand[s] the child the full cell via BOTH — covered by the `commitBounds → clampWidth/Height` backstop" ([size-constraint-invariant.md:196](../plans/implemented/size-constraint-invariant.md)) — that audit checked whether the child self-clamps up (it does), but not whether Border's own clip frame follows it up (it does not). So the clip-frame under-sizing is a gap both plans missed, not a decision either made. No plan ever weighed and rejected flooring a fixed region at its min; the box-manager precedent is that they floor.

[^border-inversion]: `getMinSize` already sums region mins (30 for the region above). If `getPreferredSize` keeps summing raw preferreds (28), `Border` reports `preferred.height 28 < min.height 30` — the same `min ≤ preferred` violation the regressions plan set out to eliminate, now committed by `Border` itself and seen by *its* parent. Flooring each region's preferred at its own min in `getPreferredSize` is exactly what restores `Border`'s aggregate `preferred ≥ min`.

[^observable]: `commitBounds(region, …, preferred)` calls `region.setHeight(preferred)`, which runs `clampHeight` and floors the committed value at the merged min — so `region.getHeight()` returns the min (30) in the buggy build too. The band the fix widens is the *reserved* extent (`regionExtent`'s result → `middleY`/`centerX`), which is what pushes CENTER. Asserting CENTER's size/offset therefore distinguishes fixed from unfixed; asserting the region's own height does not. This is the vacuous-test trap to avoid.

[^double]: The bug precondition is `preferred < merged-min` where the min is content/layout-derived, *not* an explicit `setMinSize` constraint — because `Component.getPreferredSize` clamps its reported preferred up to any explicit min constraint ([Component.ts:2632](../src/typescript/lib/core/Component.ts#L2632)), so an explicit `setMinSize(…, 30)` would make the region report preferred 30 and mask the bug. A test-local `class SubMinRegion extends Component` overriding `getPreferredSize` → 28 and `getMinSize` → 30 models the merged-min case directly and minimally; `Border` only ever calls `getPreferredSize` / `getMinSize` / `isDisplayed` on a region, all of which the subclass satisfies. Subclassing `Component` in tests is an established pattern in this suite ([default-options-fallback.test.ts:31](../tests/component/default-options-fallback.test.ts#L31), [ComponentDispose.test.ts:142](../tests/core/ComponentDispose.test.ts#L142)). The faithful alternative — a `Container` with a `VBox` child forcing min 30 and a pinned `preferredSize` height 28 — is heavier and relies on the aggregation + clamp interaction, so the subclass is preferred.
