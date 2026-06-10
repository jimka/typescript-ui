# Border Region Clip Frames — Implementation Plan

## Overview

Make the **Border** layout contain each region's content within that region's allocated rect, so a mis-sized or overflowing region's content can no longer paint outside its band and overlap an adjacent region. Today every region is positioned via `placeComponent` but its content is never clipped to its rect: a NORTH toolbar handed a 0-height preferred size makes Border reserve a 0px NORTH band (`middleY === 0`), yet Border still places the toolbar element at height 0 and its `overflow: visible` children spill out and are then painted over by the CENTER region placed at `y === 0` — a silent overlap rather than a clean "nothing shows".

The mechanism is the framework's existing per-component **clip frame** — `Component.setClipFrame(x, y, width, height)` / `clearClipFrame()` ([Component.ts:623](../src/typescript/lib/core/Component.ts#L623), [Component.ts:664](../src/typescript/lib/core/Component.ts#L664)) — which wraps a single component's element in an `overflow: hidden`, `position: absolute` sheath parked at the cell rect and parks the element at `(0,0)` inside it. `Grid.doLayout` already drives this exact pattern for oversized cells ([Grid.ts:984](../src/typescript/lib/layout/Grid.ts#L984)): `setClipFrame(x, y, w, h)` then `commitBounds(component, offsetX, offsetY, …)` so the element commits *relative to the frame*. Border adopts the same drive in `doLayout` ([Border.ts:722](../src/typescript/lib/layout/Border.ts#L722)) for its five regions.

The whole change is confined to `src/typescript/lib/layout/Border.ts`; it adds no new public API (the clip-frame primitive already exists) and no new theme tokens.

---

## Architecture Decisions

### Use the existing per-component clip frame, not `overflow: hidden` on the region and not `clip-path`

Three candidates were weighed:

1. **`overflow: hidden` on the region's own element.** Rejected: a region component's own box carries a `min-width`/`min-height` CSS floor, and `overflow: hidden` clips only *descendants*, never the element's own box — so a region whose own box exceeds its rect (the exact failure mode here, where the element is sized larger than the band) is not contained. This is the precise limitation the clip frame was built to solve ([Component.ts:600-607](../src/typescript/lib/core/Component.ts#L600)).
2. **`clip-path: inset(...)` on the region** (what `applyRegionClip` does for collapse). Rejected as the universal mechanism because `clip-path` establishes a CSS **stacking context** *and* a **containing block for fixed/absolute-positioned descendants** — the explicit reason `applyRegionClip` refuses to clip non-collapsible regions ([Border.ts:352-359](../src/typescript/lib/layout/Border.ts#L352)). It must stay reserved for the collapse reveal.
3. **The clip frame** (chosen). A wrapper `<div>` with `overflow: hidden; position: absolute` sized to the rect, with the region element parked at `(0,0)` inside it. It clips the element's *own* box (the element is a child of the frame, so the frame's `overflow: hidden` contains it), sidestepping the min-size floor, and it is already battle-tested via `Grid`.

### Clip-frame containment does not cage escaping overlays — proven by portaling

The key design tension — clipping in-flow region content while letting popovers / ComboBox dropdowns / tooltips / menus / Windows escape — dissolves because **every escaping overlay surface portals its element to `document.documentElement`, not into the triggering component's DOM subtree**. Verified at the append sites: `AnimatedDropdown` ([AnimatedDropdown.ts:228](../src/typescript/lib/core/AnimatedDropdown.ts#L228), the base for ComboBox/Select dropdowns and `Menu` submenus), `Popover` ([Popover.ts:469](../src/typescript/lib/core/Popover.ts#L469)), `Tooltip` ([Tooltip.ts:199](../src/typescript/lib/core/Tooltip.ts#L199)), `Menu` ([Menu.ts:174](../src/typescript/lib/core/Menu.ts#L174), [Menu.ts:237](../src/typescript/lib/core/Menu.ts#L237)), `Window` ([Window.ts:387](../src/typescript/lib/core/Window.ts#L387)), `Dialog` ([Dialog.ts:644](../src/typescript/lib/core/Dialog.ts#L644)), `Drawer` ([Drawer.ts:379](../src/typescript/lib/core/Drawer.ts#L379)) all call `document.documentElement.appendChild(el)`. They are registered with `LayerManager`, whose `DismissableLayer` contract documents the layer element as *"already mounted on `documentElement`"* ([LayerManager.ts:40](../src/typescript/lib/core/LayerManager.ts#L40)). Because these elements are **not descendants** of a region's clip frame, the frame's `overflow: hidden` (and its `position: absolute` containing block) cannot clip or trap them — they are positioned against `documentElement`. This is *why* the clip frame is safe where `clip-path` is not: even if the frame did establish a containing block for fixed descendants (it does not — only `position: absolute` descendants, and `overflow` never creates a fixed containing block), the overlays have no ancestor relationship to it.

### Universal containment, no opt-out

All five regions get a clip frame on every `doLayout`, unconditionally. There is no per-region opt-out constraint, because:

- The motivating bug is a *containment* guarantee — an opt-out would reintroduce the silent-overlap failure for any region that forgot to opt in, defeating the purpose.
- Escaping overlays already escape via portaling (previous decision), so there is no legitimate reason a region would *need* its content to paint outside its rect.

This is a deliberate departure from `applyRegionClip`'s collapsible-only `clip-path`: the clip frame is unconditional precisely *because* it is the safe mechanism. The collapse `clip-path` remains collapsible-only and untouched.

### Clip frame and collapse `clip-path` compose — they act on different boxes

The two mechanisms stack without fighting: the **clip frame** is the wrapper `<div>` (clips the element to the rect via `overflow: hidden`); the collapse **`clip-path`** is set on the region *element itself* via `setClipPath` ([Component.ts:1464](../src/typescript/lib/core/Component.ts#L1464)), which `setClipPath`'s own doc notes keeps the box in place and clips the element's own box rather than interposing a wrapper ([Component.ts:1452-1457](../src/typescript/lib/core/Component.ts#L1452)). So a collapsible region nests as: clip frame (rect-sized, `overflow: hidden`) → region element (full-size, animated `clip-path` reveal toward its outer edge). The collapse reveal animates the element's `clip-path` inside a frame that is itself sized to the *strip extent* when collapsed — which is exactly what we want (the retreating element is clipped both by its own animating `clip-path` and by the shrunken frame), and to the *full rect* when expanded. The frame must therefore be sized to the same rect the region is *allocated* (strip extent when collapsed, preferred when expanded), not the region's full element size.

### Frame sized to the allocated rect; element committed relative to the frame

Border currently places several regions at their **full element size** while reserving only the **strip/clamped extent** for layout flow (e.g. NORTH commits at `preferredSize.height` but advances `middleY` by `regionExtent(...)`; WEST commits at `westFullWidth` but reserves `westWidth`). The clip frame is sized to the **allocated rect** (the extent the region is *supposed* to occupy in flow), and the element is committed at its full size *inside* the frame via the `commitBounds(component, offsetX, offsetY, fullW, fullH)` pattern Grid uses. For non-collapsible regions the allocated rect and the full size coincide (no clamp), so the frame simply equals the region rect; for collapsed/clamped regions the frame is the smaller rect and the oversized element is clipped to it — which is the bug fix.

---

## Public API (TypeScript Signatures)

No public API changes. The plan consumes existing `Component` methods:

```ts
class Component {
    setClipFrame(x: number, y: number, width: number, height: number): this; // existing, Component.ts:623
    clearClipFrame(): this;                                                   // existing, Component.ts:664
    setClipPath(clipPath: string | null): this;                              // existing, Component.ts:1464 (collapse, unchanged)
}
```

`Border` gains no new options, setters, or fields. The change is internal to `doLayout` and `applyRegionClip`'s composition.

---

## Internal Structure

### The Grid drive pattern Border adopts

Per region, replace the current "place at full size, then `applyRegionClip`" with "frame at allocated rect, commit element at full size inside the frame, then `applyRegionClip`":

```
// Today (NORTH, Border.ts:778):
this.placeComponent(this._northComponent, northX, northY, northWidth, preferredSize.height + northInsetTop, FillType.BOTH);
this.applyRegionClip(this._northComponent, Placement.NORTH);

// After: frame to the ALLOCATED rect; commit the element to full size inside it.
const allocH = middleY;  // northHeight + northInsetTop — the band actually reserved
this._northComponent.setClipFrame(northX, northY, northWidth, allocH);
this.commitBounds(this._northComponent, 0, 0, northWidth, preferredSize.height + northInsetTop);
this.applyRegionClip(this._northComponent, Placement.NORTH);
```

The element commits at `(0,0)` relative to the frame (the frame is its containing block), at its full intended size; the frame clips it to `allocH`. When `allocH === 0` (the motivating bug), the element is fully clipped — "nothing shows" — instead of spilling over CENTER.

`commitBounds` is `protected` on `LayoutManager` ([LayoutManager.ts:417](../src/typescript/lib/layout/LayoutManager.ts#L417)) and already in use elsewhere; Border can call it directly, exactly as Grid does ([Grid.ts:985](../src/typescript/lib/layout/Grid.ts#L985)).

### Per-region allocated rect vs. full element box (the four edges + center)

| Region | Frame rect (allocated) | Element commit (full, frame-relative) |
|---|---|---|
| NORTH  | `(northX, northY, northWidth, middleY)` | `(0, 0, northWidth, preferredSize.height + northInsetTop)` |
| SOUTH  | `(southX, southY, width, southHeight)` | `(0, southFullY - southY, width, preferredSize.height)` |
| WEST   | `(westX, westY, westWidth, middleHeight)` | `(0, 0, westFullWidth, middleHeight)` |
| EAST   | `(eastX, eastY, eastPreferredWidth, middleHeight)` | `(eastFullX - eastX, 0, eastFullWidth, middleHeight)` |
| CENTER | `(centerX', centerY', centerWidth, middleHeight)` | `(0, 0, centerWidth, middleHeight)` |

Notes:
- SOUTH and EAST are anchored to the far edge: the element's full box can start *before* the allocated strip's origin (it is bottom/right-aligned), so the element's frame-relative offset is negative-or-zero (`southFullY - southY`, `eastFullX - eastX`), letting the visible (un-collapsed) portion show through the frame's far edge while the clipped-away near portion stays hidden. This mirrors how the collapse `clip-path` already clips these toward their outer edge.
- CENTER has no clamp (its rect *is* its size), so its frame equals its commit box; framing it is harmless and keeps the loop uniform, but it can also be left unframed (`clearClipFrame` + plain `placeComponent`) since it can never overflow its own allocation. Decide during implementation per the simplicity rule — uniform framing is fewer branches, unframed center is one less wrapper div. **Recommended: frame all five uniformly** for one code path.
- The `containerInsets.getLeft()/getTop()` offsets currently folded into each region's `x`/`y` must be folded into the **frame** position (the frame lives in the container's coordinate space), with the element at `(0,0)` (or the far-edge offset) inside it.

### `applyRegionClip` is unchanged

`applyRegionClip` keeps setting `setClipPath` on the region *element* and remains collapsible-only ([Border.ts:352](../src/typescript/lib/layout/Border.ts#L352)). It now runs *after* `commitBounds` on the framed element; since `clip-path` acts on the element's own box (now parked inside the frame), the collapse reveal animates exactly as before, just inside a frame. Its guarding comment about `clip-path`'s stacking-context/containing-block cost stays accurate and stays the reason it is collapsible-only — the clip *frame* is a separate, unconditional mechanism and does not change that calculus.

### `detach` / teardown

`Border.detach` ([Border.ts:921](../src/typescript/lib/layout/Border.ts#L921)) tears down gutters. Clip frames are owned by the *region components*, not by Border, and `Component.removeElement` already calls `clearClipFrame` ([Component.ts:592](../src/typescript/lib/core/Component.ts#L592)) when a component leaves the DOM, so a region removed from the Border (or the Border swapped out) cleans up its own frame. No `detach` change is required, but verify a region moved to a different layout manager has its frame cleared — if a manager swap leaves the region in the DOM, the new manager's first `doLayout` either re-frames it or should `clearClipFrame`; Border's own regions are always re-framed each pass, so the only risk is a region that *leaves* Border without leaving the DOM. Audit this in Step 4.

---

## Ordered Implementation Steps

1. **`Border.ts` — NORTH.** In `doLayout`, replace the NORTH `placeComponent(...)` ([Border.ts:778](../src/typescript/lib/layout/Border.ts#L778)) with `setClipFrame(northX, northY, northWidth, middleY)` + `commitBounds(this._northComponent, 0, 0, northWidth, preferredSize.height + northInsetTop)`. Keep the subsequent `applyRegionClip` and `updateRegionGutter` calls. Verify `middleY` is the reserved band height at that point (it is — `northHeight + northInsetTop`, before the `+= gap`).
2. **`Border.ts` — SOUTH.** Replace the SOUTH `placeComponent(...)` ([Border.ts:815](../src/typescript/lib/layout/Border.ts#L815)) with `setClipFrame(southX, southY, width, southHeight)` + `commitBounds(this._southComponent, 0, southFullY - southY, width, preferredSize.height)`. The element shows through the frame's bottom edge; the clipped-away top is the collapsed region.
3. **`Border.ts` — WEST, EAST, CENTER.** Mirror for WEST ([Border.ts:860](../src/typescript/lib/layout/Border.ts#L860)) and EAST ([Border.ts:892](../src/typescript/lib/layout/Border.ts#L892)) per the rect table (EAST uses the `eastFullX - eastX` horizontal offset). For CENTER ([Border.ts:906](../src/typescript/lib/layout/Border.ts#L906)) frame uniformly to its own rect with element at `(0,0)`.
4. **`Border.ts` — teardown audit.** Confirm a region that leaves a Border (manager swap) does not orphan its clip frame: `Component.removeElement` clears it on DOM removal ([Component.ts:592](../src/typescript/lib/core/Component.ts#L592)); if a swap can leave the region mounted, ensure the path clears the frame (the region's next host re-frames or the swap calls `clearClipFrame`). Add `clearClipFrame` in `Border.detach` for each region only if the audit shows an orphan path; otherwise leave `detach` unchanged (surgical).
5. **Regression checkpoint.** `grep -n "placeComponent\|setClipFrame\|commitBounds" src/typescript/lib/layout/Border.ts` — expect the five region placements now route through `setClipFrame` + `commitBounds`; no bare `placeComponent` left for a region (gutters are positioned via `setX/setY/...`, not `placeComponent`, so they are unaffected).
6. **`npm run typecheck`** — expect clean (`commitBounds` is `protected`, accessible from the subclass).
7. **Manual verification** per `## Verification`, including the 0-height NORTH containment and the overlay-escape checks.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Border.ts` |

No files created or deleted. `src/typescript/BorderPanel.ts` is used for verification only (it may need a temporary 0-height NORTH and an in-region overlay trigger added during testing, then reverted — see Verification).

---

## Verification

`npm run dev` → http://localhost:8015, Border demo (`src/typescript/BorderPanel.ts`). Scope every DevTools query to `.BorderPanel` (multiple Border instances exist on the page — Header, Dialog, Window all use Border internally).

**(a) Containment — overflowing / mis-sized region cannot bleed:**
- **Typecheck:** `npm run typecheck` clean.
- **0-height NORTH (the motivating bug):** temporarily set the NORTH `headerText.setPreferredSize(20, 0)` in `BorderPanel.ts`. Confirm the NORTH band is 0px and the toolbar content is **clipped to nothing** — the CENTER region starts at `y === 0` with no header glyphs/buttons painting over it. Pre-fix: header content visibly overlaps CENTER. Revert the demo edit after.
- **Oversized region:** give a region content wider/taller than its rect (e.g. a WEST `List` with a very long item, or a NORTH whose element min-size exceeds the band). Confirm the overflow is clipped at the region's rect edge and does not paint over the adjacent region. DevTools: the region's clip-frame `<div>` (`overflow: hidden`, sized to the rect) is the region element's parent; `frame.getBoundingClientRect()` equals the allocated rect.
- **Collapse still works:** double-click the NORTH / WEST / SOUTH chevrons (all `collapsible: true` in the demo). The collapse `clip-path` reveal animates smoothly and the region retreats into its strip; restore animates back. Confirm no snap/jump and that the frame resizes to the strip extent while collapsed.

**(b) Escaping overlays still escape from inside a clipped region:**
- **ComboBox / Select dropdown:** place a `ComboBox` (or `Select`) inside a region (e.g. add one to the WEST or NORTH region of `BorderPanel.ts` temporarily) and open it near the region's clipped edge. The dropdown list renders at full size **outside** the region's rect, on top of adjacent regions — not clipped to the region. (It is portaled to `documentElement`.)
- **Popover / Tooltip:** trigger a `Popover` and a `Tooltip` from a component inside a region; both render outside the region bounds.
- **Menu:** open a `Menu` / context menu from inside a region; the menu and any submenu render outside the region, unclipped.
- **Window:** open a `Window` from a button inside a region; it appears as a top-level overlay, draggable across the whole viewport, unaffected by the region's clip frame.
- Revert any temporary demo components added for these checks.

**General:**
- **Theme toggle:** light/dark on the Border demo — no regression (clip frame is a transparent, token-less wrapper).
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). No API surface changed, so this is a no-regression check only.

---

## Potential Challenges

- **Stacking-context / containing-block trap (the central tension).** The clip frame is `position: absolute` (a containing block for *absolute* descendants) with `overflow: hidden`; neither establishes a containing block for `position: fixed`, and overlays are portaled to `documentElement` anyway — so no escaping overlay is caged. Mitigation: the overlay-escape verification (b) proves this empirically across all five overlay types; if any overlay were ever made a non-portaled DOM child of a region, it would be clipped, so the non-goal below pins the portaling assumption.
- **Collapse `clip-path` vs. clip frame interaction.** The two clip different boxes (frame clips the element; `clip-path` clips inside the element) and compose — but the *frame must be sized to the allocated rect* (strip extent when collapsed), or the collapsing element would still be visible through an over-large frame. Mitigation: Step 1-3 size each frame from the same `regionExtent`/clamped values the layout already computes for `middleY`/`southHeight`/`westWidth`/`eastPreferredWidth`, not from the element's full size; verify the collapse animation in (a).
- **Far-edge anchored regions (SOUTH/EAST) clip the wrong edge.** Their element is bottom/right-aligned and larger than the strip, so the element's frame-relative offset must be negative-or-zero (`southFullY - southY`, `eastFullX - eastX`) so the visible portion shows through the frame's far edge. Mitigation: the rect table fixes the offsets; a wrong sign clips the visible content instead of the retreating content — caught by the oversized-region and collapse checks in (a).
- **`commitBounds` recurses into the region's `doLayout` with frame-relative coordinates.** The region lays its own children out relative to its own `(0,0)`, which is unchanged by being parked inside the frame (the element is still at `(0,0)` in its containing block). Mitigation: this is exactly Grid's existing contract; the region's internal layout is coordinate-relative and untouched.
- **Region leaving Border without leaving the DOM (manager swap) could orphan a frame.** Mitigation: Step 4 audits the swap path; `removeElement` clears the frame on DOM removal, so the only risk is an in-DOM re-home, which Border's own re-framing handles for its regions.
- **z-order within the region.** The clip frame sits where the region element sat in the container's child order, so inter-region z-order (gutters, CENTER painted after edges) is preserved — the frame is a 1:1 positional substitute for the element node. Mitigation: confirm gutters still render above their region (they are siblings appended to the container, [Border.ts:320](../src/typescript/lib/layout/Border.ts#L320), unaffected by the per-region frame).

---

## Critical Files

- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) — `doLayout` region placements (NORTH L778, SOUTH L815, WEST L860, EAST L892, CENTER L906), `regionExtent` (L336), `applyRegionClip` + its stacking-context comment (L352), `updateRegionGutter` (L388), `detach` (L921).
- [`src/typescript/lib/layout/Grid.ts`](../src/typescript/lib/layout/Grid.ts) — the clip-frame drive precedent (L978-994): `setClipFrame` then `commitBounds` at a frame-relative offset.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `setClipFrame`/`clearClipFrame` (L623/L664), `createFrame`/`disposeFrame` (L699/L719), `setClipPath` (L1464, the collapse mechanism — unchanged), `removeElement`→`clearClipFrame` teardown (L592).
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `commitBounds` (L417), `placeComponent`/`resolveBounds` (L251/L278).
- [`src/typescript/lib/core/LayerManager.ts`](../src/typescript/lib/core/LayerManager.ts) — `DismissableLayer` contract: layer element "already mounted on `documentElement`" (L40), the portaling guarantee that makes clipping overlay-safe.
- Overlay append sites proving portaling: [`AnimatedDropdown.ts:228`](../src/typescript/lib/core/AnimatedDropdown.ts#L228), [`Popover.ts:469`](../src/typescript/lib/core/Popover.ts#L469), [`Tooltip.ts:199`](../src/typescript/lib/core/Tooltip.ts#L199), [`Menu.ts:174`](../src/typescript/lib/core/Menu.ts#L174), [`Window.ts:387`](../src/typescript/lib/core/Window.ts#L387).
- [`src/typescript/BorderPanel.ts`](../src/typescript/BorderPanel.ts) — the demo screen to exercise both verification halves (temporary edits during testing only).

---

## Non-Goals

- **Generalizing clip-frame containment to other layout managers** (HBox / VBox / Card / Accordion / Split). Those have their own overflow/scroll models (HBox/VBox use the *content* frame for scrolling, not per-child clipping); applying per-child clip frames there is a separate design with its own validation and is explicitly out of scope.
- **Redesigning Border's sizing model.** The `regionExtent` clamp, the `middleY`/`middleHeight` math, and the preferred/min/max aggregation stay exactly as they are; this plan only changes *where the region content is contained*, not how the bands are sized. (A 0-height NORTH still allocates 0px — the fix is that the content is now cleanly clipped to 0, not that the band auto-grows.)
- **Changing the collapse animation.** The `clip-path` reveal keyframes and `runCollapse` coordination are untouched; the clip frame composes with them.
- **Making any overlay a non-portaled DOM child of a region.** The overlay-escape guarantee depends on every escaping surface portaling to `documentElement`; introducing a region-child overlay would break containment and is out of scope.
