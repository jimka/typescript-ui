# Border Region Clip Frames — Implementation Plan

## Overview

Make the **Border** layout contain each **non-collapsible** region's content within that region's allocated rect, so a mis-sized or overflowing region's content can no longer paint outside its band and overlap an adjacent region. Today a non-collapsible region is positioned via `placeComponent` but its content is never clipped to its rect: a NORTH toolbar handed a 0-height preferred size makes Border reserve a 0px NORTH band (`middleY === 0`), yet Border still places the toolbar element at height 0 and its `overflow: visible` children spill out and are then painted over by the CENTER region placed at `y === 0` — a silent overlap rather than a clean "nothing shows".

This gap exists **only for non-collapsible regions**. Collapsible regions are already contained by `applyRegionClip` ([Border.ts:378](../src/typescript/lib/layout/Border.ts#L378)), which sets `clip-path: inset(0 0 0 0)` on them when expanded (clipping to their own box) and an outer-edge inset when collapsed. Non-collapsible regions return early from `applyRegionClip` ([Border.ts:383](../src/typescript/lib/layout/Border.ts#L383)) and get no clip at all — they are the regions that can bleed.

The mechanism is the framework's existing per-component **clip frame** — `Component.setClipFrame(x, y, width, height)` / `clearClipFrame()` ([Component.ts:629](../src/typescript/lib/core/Component.ts#L629), [Component.ts:670](../src/typescript/lib/core/Component.ts#L670)) — which wraps a single component's element in an `overflow: hidden`, `position: absolute` sheath parked at the cell rect and parks the element at `(0,0)` inside it. `Grid.doLayout` already drives this exact pattern for oversized cells ([Grid.ts:984](../src/typescript/lib/layout/Grid.ts#L984)): `setClipFrame(x, y, w, h)` then `commitBounds(component, offsetX, offsetY, …)` so the element commits *relative to the frame*. Border adopts the same drive in `doLayout` ([Border.ts:780](../src/typescript/lib/layout/Border.ts#L780)) for its non-collapsible regions.

The whole change is confined to `src/typescript/lib/layout/Border.ts`; it adds no new public API (the clip-frame primitive already exists) and no new theme tokens.

---

## Architecture Decisions

### Use the existing per-component clip frame, not `overflow: hidden` on the region and not `clip-path`

Three candidates were weighed for containing non-collapsible regions:

1. **`overflow: hidden` on the region's own element.** Rejected: a region component's own box carries a `min-width`/`min-height` CSS floor, and `overflow: hidden` clips only *descendants*, never the element's own box — so a region whose own box exceeds its rect (the exact failure mode here, where the element is sized larger than the band) is not contained. This is the precise limitation the clip frame was built to solve ([Component.ts:606-613](../src/typescript/lib/core/Component.ts#L606)).
2. **`clip-path: inset(...)` on the region** (what `applyRegionClip` does for collapse). Rejected as the mechanism for non-collapsible regions because `clip-path` establishes a CSS **stacking context** *and* a **containing block for fixed/absolute-positioned descendants** — the explicit reason `applyRegionClip` refuses to clip non-collapsible regions ([Border.ts:379-385](../src/typescript/lib/layout/Border.ts#L379)). It must stay reserved for the collapse reveal.
3. **The clip frame** (chosen). A wrapper `<div>` with `overflow: hidden; position: absolute` sized to the rect, with the region element parked at `(0,0)` inside it. It clips the element's *own* box (the element is a child of the frame, so the frame's `overflow: hidden` contains it), sidestepping the min-size floor, and it is already battle-tested via `Grid`.

### Frame non-collapsible regions only; collapsible regions keep their `clip-path` (frame XOR clip-path, never both)

The two clip mechanisms are **mutually exclusive per region**, not composed:

- **Collapsible regions** already self-contain via `applyRegionClip`'s `clip-path` ([Border.ts:387-398](../src/typescript/lib/layout/Border.ts#L387)): `inset(0 0 0 0)` when expanded clips to the box; an outer-edge inset (`inset(0 0 100% 0)` for NORTH, etc.) animates the collapse reveal. They get **no** clip frame.
- **Non-collapsible regions** get **no** `clip-path` (`applyRegionClip` returns early for them) and instead get a **clip frame**. They never collapse, so their allocated rect always equals their full element box (see next decision), and the frame is a perfect-fit `overflow: hidden` sheath that clips only genuine own-box overflow.

A clip frame must **not** be applied to a collapsible region, because the collapse animation would break. `runCollapse` snapshots each participant's box, calls `container.doLayout()` **exactly once** ([CollapseSupport.ts:349](../src/typescript/lib/layout/CollapseSupport.ts#L349)) to write the end state, then JS-animates the boxes while a CSS `clip-path` transition reveals the toggled region in lockstep ([CollapseSupport.ts:317-358](../src/typescript/lib/layout/CollapseSupport.ts#L317)). That single `doLayout` runs `setClipFrame` only once — it cannot animate the frame. If the toggled region were framed to the strip extent, the `overflow: hidden` frame would hard-clip it to the strip on frame 0 and freeze it there, leaving the `clip-path` reveal nothing to animate (an instant snap instead of a smooth retreat). Sizing the frame to the *full* box instead would let the animation run but leave a full-band-sized transparent frame `<div>` intercepting pointer events over the grown CENTER after collapse. Both are wrong; the clean answer is that a collapsible region simply is not framed — its `clip-path` is the complete and already-correct containment + reveal mechanism. The collapse animation, keyframes, and `runCollapse` coordination are therefore **untouched**.

This is a deliberate, structural split (collapsible vs. non-collapsible), not a per-instance opt-out: there is no flag a region "forgets to set." Every region is contained — collapsible ones by `clip-path`, non-collapsible ones by the clip frame.

### Clip-frame containment does not cage escaping overlays — proven by portaling

Containing in-flow region content must not trap popovers / ComboBox dropdowns / tooltips / menus / Windows. It doesn't, because **every escaping overlay surface portals its element to `document.documentElement`, not into the triggering component's DOM subtree**. Verified at the append sites: `AnimatedDropdown` ([AnimatedDropdown.ts:228](../src/typescript/lib/core/AnimatedDropdown.ts#L228), the base for ComboBox/Select dropdowns and `Menu` submenus), `Popover` ([Popover.ts:469](../src/typescript/lib/core/Popover.ts#L469)), `Tooltip` ([Tooltip.ts:199](../src/typescript/lib/core/Tooltip.ts#L199)), `Menu` ([Menu.ts:174](../src/typescript/lib/core/Menu.ts#L174), [Menu.ts:237](../src/typescript/lib/core/Menu.ts#L237)), `Window` ([AbstractWindow.ts:577](../src/typescript/lib/core/AbstractWindow.ts#L577)), `Dialog` ([Dialog.ts:644](../src/typescript/lib/core/Dialog.ts#L644)), `Drawer` ([Drawer.ts:379](../src/typescript/lib/core/Drawer.ts#L379)) all call `document.documentElement.appendChild(el)`. They are registered with `LayerManager`, whose `DismissableLayer` contract documents the layer element as *"already mounted on `documentElement`"* ([LayerManager.ts:40](../src/typescript/lib/core/LayerManager.ts#L40)). Because these elements are **not descendants** of a region's clip frame, the frame's `overflow: hidden` (and its `position: absolute` containing block) cannot clip or trap them — they are positioned against `documentElement`. This is *why* the clip frame is safe: even if the frame did establish a containing block for fixed descendants (it does not — only `position: absolute` descendants, and `overflow` never creates a fixed containing block), the overlays have no ancestor relationship to it.

### Frame equals the region's committed box; element committed at `(0,0)` inside it

Because only non-collapsible regions are framed, and `regionExtent` returns the region's preferred extent for any region that is not collapsed ([Border.ts:362-363](../src/typescript/lib/layout/Border.ts#L362) — it returns `COLLAPSE_STRIP_SIZE` *only* when collapsed, with no max clamp), a non-collapsible region's **allocated rect always equals its full element box**. The frame is therefore sized to the same rect the region's `placeComponent` already uses, and the element is committed at `(0,0)` inside it via the `commitBounds(component, 0, 0, w, h)` pattern Grid uses. There is no strip/full divergence and no far-edge offset to compute — the SOUTH/EAST bottom/right anchoring already resolves to the region's full position when not collapsed (`southFullY === southY`, `eastFullX === eastX`), so their frame-relative offset is `(0,0)` like the others.

The `containerInsets.getLeft()/getTop()` offsets currently folded into each region's `x`/`y` are folded into the **frame** position (the frame lives in the container's coordinate space), with the element at `(0,0)` inside it.

---

## Public API (TypeScript Signatures)

No public API changes. The plan consumes existing `Component` and `LayoutManager` methods:

```ts
class Component {
    setClipFrame(x: number, y: number, width: number, height: number): this; // existing, Component.ts:629
    clearClipFrame(): this;                                                   // existing, Component.ts:670
    setClipPath(clipPath: string | null): this;                              // existing, Component.ts:1566 (collapse, unchanged)
}

class LayoutManager {
    protected commitBounds(component: Component, x: number, y: number, width: number, height: number): void; // existing, LayoutManager.ts:417
}
```

`Border` gains no new options, setters, or fields. The change is internal to `doLayout`.

---

## Internal Structure

### The Grid drive pattern Border adopts

Per region, branch on collapsibility. Collapsible regions keep today's exact path (`placeComponent` + `applyRegionClip`); non-collapsible regions are framed at their allocated rect with the element committed inside it:

```
// Today (NORTH, Border.ts:847):
this.placeComponent(north, northX, northY, northWidth, preferredSize.height + northInsetTop, FillType.BOTH);
this.applyRegionClip(north, Placement.NORTH);

// After:
if (this.isRegionCollapsible(Placement.NORTH)) {
    // Unchanged: clip-path contains + reveals; clear any stale frame from a
    // prior non-collapsible state.
    this.placeComponent(north, northX, northY, northWidth, preferredSize.height + northInsetTop, FillType.BOTH);
    north.clearClipFrame();
    this.applyRegionClip(north, Placement.NORTH);
} else {
    // Containment via clip frame: frame at the allocated rect, element at (0,0).
    // Clear any stale clip-path left by a prior collapsible state — this branch
    // never calls applyRegionClip, and setRegionCollapsible can flip a region
    // from collapsible to non-collapsible at runtime (see below).
    north.setClipPath(null);
    north.setClipFrame(northX, northY, northWidth, preferredSize.height + northInsetTop);
    this.commitBounds(north, 0, 0, northWidth, preferredSize.height + northInsetTop);
}
this.updateRegionGutter(Placement.NORTH, northX, northY, northWidth, middleY);
```

The element commits at `(0,0)` relative to the frame (the frame is its containing block), at the same size `placeComponent` passed (`FillType.BOTH`, no anchor, so the resolved box equals the rect); the frame's `overflow: hidden` clips any own-box overflow — including a `min-height` floor the element renders past — to the rect. When the rect height is `0` (the motivating bug), the element is fully clipped — "nothing shows" — instead of spilling over CENTER.

`commitBounds` is `protected` on `LayoutManager` ([LayoutManager.ts:417](../src/typescript/lib/layout/LayoutManager.ts#L417)) and already in use elsewhere; Border can call it directly, exactly as Grid does ([Grid.ts:985](../src/typescript/lib/layout/Grid.ts#L985)). The existing `placeComponent`/`resolveBounds` ([LayoutManager.ts:251](../src/typescript/lib/layout/LayoutManager.ts#L251), [LayoutManager.ts:278](../src/typescript/lib/layout/LayoutManager.ts#L278)) path is what the collapsible branch keeps.

### Per-region framed rect (non-collapsible branch)

| Region | Frame rect (= `placeComponent` args today) | Element commit (frame-relative) |
|---|---|---|
| NORTH  | `(northX, northY, northWidth, preferredSize.height + northInsetTop)` | `(0, 0, northWidth, preferredSize.height + northInsetTop)` |
| SOUTH  | `(southX, southFullY, width, preferredSize.height)` | `(0, 0, width, preferredSize.height)` |
| WEST   | `(westX, westY, westFullWidth, middleHeight)` | `(0, 0, westFullWidth, middleHeight)` |
| EAST   | `(eastFullX, eastY, eastFullWidth, middleHeight)` | `(0, 0, eastFullWidth, middleHeight)` |
| CENTER | `(containerInsets.getLeft() + centerX, containerInsets.getTop() + middleY, centerWidth, middleHeight)` | `(0, 0, centerWidth, middleHeight)` |

Notes:
- For non-collapsible SOUTH/EAST the far-edge full position equals the strip position (`southFullY === southY`, `eastFullX === eastX`, because `regionExtent` returns the preferred extent when not collapsed), so no negative offset is needed — every region commits at `(0,0)`.
- CENTER is never collapsible, so it always takes the frame branch. Its rect is its own size (it can never overflow its allocation), so framing it is harmless and keeps one code path for the non-collapsible branch.

### `applyRegionClip` is unchanged

`applyRegionClip` keeps setting `setClipPath` on the region *element* and remains collapsible-only ([Border.ts:378](../src/typescript/lib/layout/Border.ts#L378)). It is called only on the collapsible branch (where it does real work); on the non-collapsible branch it would be a no-op anyway (early return at [Border.ts:383](../src/typescript/lib/layout/Border.ts#L383)) and is not called. Its guarding comment about `clip-path`'s stacking-context/containing-block cost stays accurate and stays the reason it is collapsible-only — the clip *frame* is the separate mechanism for the non-collapsible regions and does not change that calculus.

### `detach` / teardown

`Border.detach` ([Border.ts:990](../src/typescript/lib/layout/Border.ts#L990)) tears down gutters. Clip frames are owned by the *region components*, not by Border, and `Component.removeElement` already calls `clearClipFrame` ([Component.ts:598](../src/typescript/lib/core/Component.ts#L598)) when a component leaves the DOM, so a region removed from the Border (or the Border swapped out) cleans up its own frame. Two residual paths:
- **Region toggled non-displayed (Step 4 — required edit).** `doLayout` resolves each region through `laidOut`, which yields `null` for a non-displayed (`display: none`) region; the region's `if (region)` block is then skipped, so a previously-installed frame is **not** cleared and the `overflow: hidden` wrapper persists around the hidden (invisible) element until the region is shown again (where the idempotent `setClipFrame` resizes it). It self-heals and is invisible meanwhile, but Step 4 adds an explicit `clearClipFrame` on the skipped raw region component to avoid the orphan.
- **Region leaves Border without leaving the DOM (manager swap — Step 5 audit).** If the swap leaves the region mounted, the new manager's first `doLayout` either re-frames it or should `clearClipFrame`; Border's own non-collapsible regions are re-framed each pass.

---

## Ordered Implementation Steps

1. **`Border.ts` — NORTH.** In `doLayout`, branch the NORTH placement ([Border.ts:847](../src/typescript/lib/layout/Border.ts#L847)) on `isRegionCollapsible(Placement.NORTH)`: collapsible keeps `placeComponent(...)` + `clearClipFrame()` + `applyRegionClip`; non-collapsible uses `setClipPath(null)` + `setClipFrame(northX, northY, northWidth, preferredSize.height + northInsetTop)` + `commitBounds(north, 0, 0, northWidth, preferredSize.height + northInsetTop)`. Keep the subsequent `updateRegionGutter` call in both branches.
2. **`Border.ts` — SOUTH.** Mirror for SOUTH ([Border.ts:884](../src/typescript/lib/layout/Border.ts#L884)) per the rect table: non-collapsible `setClipPath(null)` + frame `(southX, southFullY, width, preferredSize.height)` + `commitBounds(south, 0, 0, width, preferredSize.height)`.
3. **`Border.ts` — WEST, EAST, CENTER.** Mirror for WEST ([Border.ts:929](../src/typescript/lib/layout/Border.ts#L929)) and EAST ([Border.ts:961](../src/typescript/lib/layout/Border.ts#L961)) per the rect table. CENTER ([Border.ts:975](../src/typescript/lib/layout/Border.ts#L975)) is never collapsible — replace its `placeComponent` with the frame path unconditionally (no branch; CENTER needs no `setClipPath(null)` since it never gets a `clip-path`).
4. **`Border.ts` — clear frame on the skipped (non-displayed) path.** A region resolved to `null` by `laidOut` ([Border.ts:812-816](../src/typescript/lib/layout/Border.ts#L812)) is skipped by its `if (region)` block, so a previously-installed frame is never cleared. Add a `clearClipFrame()` on each raw region component (`this._northComponent` etc.) when its `laidOut` result is `null`, so a `display: none` region does not orphan its `overflow: hidden` wrapper. This is a required edit, not an audit outcome.
5. **`Border.ts` — manager-swap teardown audit.** Confirm a region leaving Border via a manager swap does not orphan its frame: `Component.removeElement` clears it on DOM removal ([Component.ts:598](../src/typescript/lib/core/Component.ts#L598)); a region re-homed while still in the DOM is re-framed by its new manager. Add `clearClipFrame` to `Border.detach` ([Border.ts:990](../src/typescript/lib/layout/Border.ts#L990)) for each region only if the audit finds an orphan path Step 4 and `removeElement` don't already cover; otherwise leave `detach` unchanged (surgical).
6. **Regression checkpoint.** `grep -n "placeComponent\|setClipFrame\|commitBounds" src/typescript/lib/layout/Border.ts` — expect each region placement to route through either the collapsible (`placeComponent`) or non-collapsible (`setClipFrame` + `commitBounds`) branch; gutters are positioned via `setX/setY/...`, not `placeComponent`, so they are unaffected.
7. **`npm run typecheck`** — expect clean (`commitBounds` is `protected`, accessible from the subclass).
8. **Manual verification** per `## Verification`, including the 0-height non-collapsible NORTH containment, the collapse-still-animates check, the scrolling-CENTER check, and the overlay-escape checks.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Border.ts` |

No files created or deleted. `src/typescript/BorderPanel.ts` is used for verification only (it may need a temporary non-collapsible 0-height NORTH and an in-region overlay trigger added during testing, then reverted — see Verification).

---

## Verification

`npm run dev` → http://localhost:8015, Border demo (`src/typescript/BorderPanel.ts`). Scope every DevTools query to `.BorderPanel` (other Border instances exist on the page — e.g. Window and Dialog title bars use Border internally).

**(a) Containment — overflowing / mis-sized non-collapsible region cannot bleed:**
- **Typecheck:** `npm run typecheck` clean.
- **0-height non-collapsible NORTH (the motivating bug):** temporarily make a NORTH region **non-collapsible** and set its content `setPreferredSize(20, 0)` in `BorderPanel.ts`. Confirm the NORTH band is 0px and the toolbar content is **clipped to nothing** — the CENTER region starts at `y === 0` with no header glyphs/buttons painting over it. Pre-fix: header content visibly overlaps CENTER. Revert the demo edit after.
- **Oversized non-collapsible region:** give a non-collapsible region content wider/taller than its rect (e.g. a WEST `List` with a very long item, or a NORTH whose element min-size exceeds the band). Confirm the overflow is clipped at the region's rect edge and does not paint over the adjacent region. DevTools: the region's clip-frame `<div>` (`overflow: hidden`, sized to the rect) is the region element's parent; `frame.getBoundingClientRect()` equals the allocated rect.
- **Collapse still works (collapsible regions are untouched):** double-click the NORTH / WEST / SOUTH chevrons (the `collapsible: true` regions in the demo). The collapse `clip-path` reveal animates smoothly and the region retreats into its strip; restore animates back. Confirm no snap/jump — a collapsible region has **no** clip frame, so its animation is exactly as before. DevTools: a collapsible region's element has a `clip-path` style and **no** clip-frame wrapper parent.

**(b) Escaping overlays still escape from inside a clipped region:**
- **ComboBox / Select dropdown:** place a `ComboBox` (or `Select`) inside a non-collapsible region (e.g. add one to the WEST or NORTH region of `BorderPanel.ts` temporarily) and open it near the region's clipped edge. The dropdown list renders at full size **outside** the region's rect, on top of adjacent regions — not clipped to the region. (It is portaled to `documentElement`.)
- **Popover / Tooltip:** trigger a `Popover` and a `Tooltip` from a component inside a region; both render outside the region bounds.
- **Menu:** open a `Menu` / context menu from inside a region; the menu and any submenu render outside the region, unclipped.
- **Window:** open a `Window` from a button inside a region; it appears as a top-level overlay, draggable across the whole viewport, unaffected by the region's clip frame.
- Revert any temporary demo components added for these checks.

**General:**
- **Theme toggle:** light/dark on the Border demo — no regression (clip frame is a transparent, token-less wrapper).
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). No API surface changed, so this is a no-regression check only.

---

## Potential Challenges

- **Stacking-context / containing-block trap.** The clip frame is `position: absolute` (a containing block for *absolute* descendants) with `overflow: hidden`; neither establishes a containing block for `position: fixed`, and overlays are portaled to `documentElement` anyway — so no escaping overlay is caged. Mitigation: the overlay-escape verification (b) proves this empirically across all five overlay types; if any overlay were ever made a non-portaled DOM child of a region, it would be clipped, so the non-goal below pins the portaling assumption.
- **Mis-applying a frame to a collapsible region would break its collapse.** The clip frame and the collapse `clip-path` are mutually exclusive per region (frame XOR clip-path). A clip frame on a collapsible region snaps the collapse animation (the single mid-animation `doLayout` cannot animate the frame — [CollapseSupport.ts:349](../src/typescript/lib/layout/CollapseSupport.ts#L349)). Mitigation: every region placement branches on `isRegionCollapsible`; the collapsible branch calls `clearClipFrame()` so a region that flips from non-collapsible to collapsible drops its frame. Verify the collapse animation in (a).
- **A region flipping collapsible → non-collapsible mid-life** must drop its stale `clip-path`. This transition **is** possible: `setRegionCollapsible` ([Border.ts:306](../src/typescript/lib/layout/Border.ts#L306)) flips the `_collapsible` map and schedules a layout without touching `clip-path`. Since the non-collapsible branch never calls `applyRegionClip`, a `clip-path` set while the region was collapsible (`inset(0 0 0 0)` when expanded, or an outer-edge inset if it was collapsed) would persist and visibly clip the now-non-collapsible region. Mitigation: the non-collapsible branch calls `setClipPath(null)` (shown in the snippet above), and the collapsible branch calls `clearClipFrame()` — so both flip directions clean up the other mechanism.
- **`commitBounds` recurses into the region's `doLayout` with frame-relative coordinates.** The region lays its own children out relative to its own `(0,0)`, which is unchanged by being parked inside the frame (the element is still at `(0,0)` in its containing block). Mitigation: this is exactly Grid's existing contract; the region's internal layout is coordinate-relative and untouched.
- **Region toggled non-displayed could orphan a frame.** A `display: none` region is skipped by `doLayout` (resolved to `null` via `laidOut`), so its frame is not re-driven or cleared. Mitigation: Step 4 clears the frame on the skipped path; the orphan is invisible and self-heals on re-show regardless.
- **CENTER under a scrolling Border host.** When the Border host scrolls (CENTER's rect inflated to the aggregate min via the universal-scroll path, [Border.ts:799-805](../src/typescript/lib/layout/Border.ts#L799)), CENTER's frame is sized to that inflated extent, so its `overflow: hidden` clips nothing and the host's own scroll model still scrolls the overflowing content. Mitigation: verify a scrolling Border host (CENTER content larger than the viewport) still scrolls rather than being clipped to the viewport by the frame.
- **z-order within the container.** The clip frame sits where the region element sat in the container's child order, so inter-region z-order (gutters, CENTER painted after edges) is preserved — the frame is a 1:1 positional substitute for the element node. Mitigation: confirm gutters still render above their region (they are siblings appended to the container, [Border.ts:346](../src/typescript/lib/layout/Border.ts#L346), unaffected by the per-region frame).
- **The collapse animation moves framed regions by their element's own `left`/`top`, which a frame defeats (drift found during implementation — the plan's "framing CENTER is harmless" / "no animation impact" reasoning was incomplete).** `runCollapse` interpolates *every* participant — CENTER and any non-collapsible edge included, all added with `relayout: true` in `setRegionCollapsed` — by snapshotting `component.getX()/getY()` and writing `setX()/setY()` via `CollapseSupport.commitRect` ([CollapseSupport.ts:110-111, 192-204](../src/typescript/lib/layout/CollapseSupport.ts#L110)). A framed region parks its element at `(0, 0)` and carries its real position on the *frame*, so `getX/getY` read `(0, 0)` for both the start and the end snapshot: the element never moves while the frame jumps once (the single mid-animation `doLayout`) straight to the end rect — a snap, not a slide, for CENTER and any non-collapsible edge participant. The original plan only reasoned about the *toggled* region being framed and missed that the animation drives *all* participants through element-relative `setX/setY`. Mitigation (implemented, still `Border.ts`-only): Border tracks a `_collapsing` flag. `setRegionCollapsed` lays the start state out unframed before `runCollapse` snapshots it (skipped on a mid-animation re-toggle, whose elements already hold live interpolated positions); while `_collapsing` is set, every region takes the plain `placeComponent` path so its own `left`/`top` can be interpolated; the final `doLayout` on settle reinstates the steady-state frames. Verify CENTER (and any non-collapsible edge) slides smoothly into the reclaimed space when a collapsible region collapses/restores.

---

## Critical Files

- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) — `doLayout` region placements (NORTH L847, SOUTH L884, WEST L929, EAST L961, CENTER L975), `regionExtent` (L362), `applyRegionClip` + its stacking-context comment (L378, comment L379-385), `isRegionCollapsible`/`isRegionCollapsed`, `updateRegionGutter` (L414), `detach` (L990), gutter append site (L346).
- [`src/typescript/lib/layout/CollapseSupport.ts`](../src/typescript/lib/layout/CollapseSupport.ts) — `runCollapse` (L317), the single end-state `doLayout` (L349) that makes a strip-sized frame on a collapsible region snap — the reason collapsible regions are not framed.
- [`src/typescript/lib/layout/Grid.ts`](../src/typescript/lib/layout/Grid.ts) — the clip-frame drive precedent (L978-994): `setClipFrame` then `commitBounds` at a frame-relative offset (L984-985); `clearClipFrame` + plain `commitBounds` for the un-clipped case (L992-993).
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `setClipFrame`/`clearClipFrame` (L629/L670), overflow-limitation JSDoc (L606-613), `createFrame`/`disposeFrame` (L705/L725), `setClipPath` (L1566, JSDoc L1554-1560 — the collapse mechanism, unchanged), `removeElement`→`clearClipFrame` teardown (L598).
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `commitBounds` (L417), `placeComponent`/`resolveBounds` (L251/L278).
- [`src/typescript/lib/core/LayerManager.ts`](../src/typescript/lib/core/LayerManager.ts) — `DismissableLayer` contract: layer element "already mounted on `documentElement`" (L40), the portaling guarantee that makes clipping overlay-safe.
- Overlay append sites proving portaling: [`AnimatedDropdown.ts:228`](../src/typescript/lib/core/AnimatedDropdown.ts#L228), [`Popover.ts:469`](../src/typescript/lib/core/Popover.ts#L469), [`Tooltip.ts:199`](../src/typescript/lib/core/Tooltip.ts#L199), [`Menu.ts:174`](../src/typescript/lib/core/Menu.ts#L174), [`AbstractWindow.ts:577`](../src/typescript/lib/core/AbstractWindow.ts#L577).
- [`src/typescript/BorderPanel.ts`](../src/typescript/BorderPanel.ts) — the demo screen to exercise both verification halves (temporary edits during testing only).

---

## Non-Goals

- **Containing collapsible regions with a clip frame.** Collapsible regions are already contained and revealed by their `clip-path` ([Border.ts:387-398](../src/typescript/lib/layout/Border.ts#L387)); adding a frame would break the collapse animation. The frame is for non-collapsible regions only.
- **Generalizing clip-frame containment to other layout managers** (HBox / VBox / Card / Accordion / Split). Those have their own overflow/scroll models (HBox/VBox use the *content* frame for scrolling, not per-child clipping); applying per-child clip frames there is a separate design with its own validation and is explicitly out of scope.
- **Redesigning Border's sizing model.** The `regionExtent` clamp, the `middleY`/`middleHeight` math, and the preferred/min/max aggregation stay exactly as they are; this plan only changes *where the region content is contained*, not how the bands are sized. (A 0-height NORTH still allocates 0px — the fix is that the content is now cleanly clipped to 0, not that the band auto-grows.)
- **Changing the collapse animation.** The `clip-path` reveal keyframes and `runCollapse` coordination are untouched; collapsible regions take the unchanged `placeComponent` + `applyRegionClip` path.
- **Making any overlay a non-portaled DOM child of a region.** The overlay-escape guarantee depends on every escaping surface portaling to `documentElement`; introducing a region-child overlay would break containment and is out of scope.
