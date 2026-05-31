# Grid Clip and Sizing Fixes — Implementation Plan

## Overview

Three confirmed bugs in the `Grid` layout feature (branch `feature/grid-layout-sizing-and-spanning`, built per [grid-layout-sizing-and-spanning.md](implemented/grid-layout-sizing-and-spanning.md)) all stem from two root causes, both surfaced by the demo [`GridPanel.ts`](../src/typescript/GridPanel.ts): a `Panel` with `autoScroll:'auto'`, 3 columns `[fixed:120, weight:1, content]`, and an oversized child `wide.setMinSize(400,30)` pinned to the fixed-120 column 0 that is *meant* to clip.

- **Bug #1 (spurious horizontal scrollbar) and Bug #3 (rightmost column spills past the right inset) share one root cause:** `computeTotalMinSize` ([Grid.ts:397](../src/typescript/lib/layout/Grid.ts#L397)) is **track-blind**. It still uses the uniform formula `cols * maxChildMinWidth + (cols-1)*spacing` = `3*400 + 2*5` = 1210 (~1214 with the panel's 4px insets). The clipped child's 400px min therefore inflates the *whole* grid's working width in `doLayout` ([Grid.ts:459-465](../src/typescript/lib/layout/Grid.ts#L459)), so children land out to ~1214px in the DOM, the native `overflow:auto` host shows a horizontal scrollbar, and the inflated tracks push the rightmost column's right edge to scrollWidth instead of `_width − insets.right`. Fix: make `computeTotalMinSize` track-aware.
- **Bug #2 (the oversized child spills into the next column instead of clipping):** the clip branch in `layoutOccupancy`'s `placeAt` helper ([Grid.ts:709-717](../src/typescript/lib/layout/Grid.ts#L709)) cannot shrink the child's box, because `commitBounds → setWidth(120) → clampWidth` re-floors the width to the child's own `minSize.width` (400) ([Component.ts:2092](../src/typescript/lib/core/Component.ts#L2092)), `setMinSize` wrote a CSS `min-width:400px` rule the box can never render below ([Component.ts:1685](../src/typescript/lib/core/Component.ts#L1685)), and `setOverflow('hidden')` ([Component.ts:2377](../src/typescript/lib/core/Component.ts#L2377)) clips only the child's *descendants*, not its own min-width-driven box. Fix: a per-cell clipping wrapper (the user-selected approach) that visually clips the child's natural box to the cell.

All changes are confined to [`Grid.ts`](../src/typescript/lib/layout/Grid.ts), a small new affordance on [`Component.ts`](../src/typescript/lib/core/Component.ts) for the clip wrapper, and the demo [`GridPanel.ts`](../src/typescript/GridPanel.ts) if needed. This is a bugfix, kept surgical per CLAUDE.md; the only public-API movement is the new Component clip-frame affordance (Documentation Impact below).

---

## Root Cause — which size path drives the scrollbar

The brief asks whether `computeTotalMinSize` alone, or also `getMinSize`, must become track-aware. **Only `computeTotalMinSize`.** Tracing the scrollbar decision:

- `Panel.setAutoScroll('auto')` does two things ([Panel.ts:150](../src/typescript/lib/core/Panel.ts#L150)): writes CSS `overflow:auto` on the panel element, and forwards `setOverflowing(true,true)` to the layout manager.
- The scrollbar itself is **native**: the browser renders it whenever `el.scrollWidth > el.clientWidth`. `Panel.measureScrollbarGutter` ([Panel.ts:295](../src/typescript/lib/core/Panel.ts#L295)) reads exactly `el.scrollWidth > el.clientWidth` / `el.scrollHeight > el.clientHeight` to decide the gutter — it does **not** consult any layout-manager size hint.
- `scrollWidth` is determined by where children actually land in the DOM — the `left + width` that `doLayout` commits via `commitBounds`/`placeComponent`. Those positions come from `containerSize`, which `doLayout` inflates to `computeTotalMinSize()` on the overflowing axes ([Grid.ts:459-465](../src/typescript/lib/layout/Grid.ts#L459)).
- `getMinSize` / `getPreferredSize` / `getMaxSize` ([Grid.ts:258-386](../src/typescript/lib/layout/Grid.ts#L258)) are size *hints* consumed by a **parent** that sizes the Panel (e.g. a `Fit`/`HBox` host querying the panel's min size). They never feed the Panel's own scrollbar decision, and nothing in the demo's parent chain mis-sizes today.

Therefore the track-aware fix lands in **`computeTotalMinSize` only**. The size-hint trio is left untouched — touching it would be gratuitous (per CLAUDE.md §3) and outside the demonstrated failure. The original plan's deferral (lines ~165/221/248: "keep size hints conservative, revisit if a host mis-sizes") is undone *only* for `computeTotalMinSize`, which demonstrably mis-sizes; the trio's deferral still holds because no host mis-sizes through it.

---

## Architecture Decisions

### `computeTotalMinSize` becomes track-aware; the size-hint trio does not

For each axis, when tracks are declared:
- a `fixed` track contributes its `value`,
- a `content` track contributes its measured content size (reuse the existing private `measureContent` at [Grid.ts:606](../src/typescript/lib/layout/Grid.ts#L606)),
- a `weight` track contributes `0` — weight tracks flex to fill slack and clip oversized children by design, so they impose no intrinsic minimum.

Sum the per-track extents plus `(count-1)*spacing` plus the outer perimeter, per axis. When **no** tracks are declared on an axis, fall back to the existing uniform `count * maxChildMin + (count-1)*spacing` formula — so uniform / non-track grids are byte-for-byte unchanged and still trigger universal scroll. With the demo's columns `[fixed:120, weight:1, content]`, the width contribution becomes `120 + 0 + contentWidth + 2*spacing` ≈ a few hundred px well under the 900px window, so no horizontal scrollbar and no rightmost-column spill. (Bug #3 is purely an inflation artifact of Bug #1: with inflation gone, the rightmost column's right edge lands at `_width − insets.right`, as the wide-window measurement already confirmed.)

`measureContent` returns per-column and per-row content maxima and already exists for `layoutOccupancy`; `computeTotalMinSize` will call it with the resolved `cols`/`rows` and sum the `content`-track entries. This keeps a single source of truth for content measurement.

### Per-cell clip via a Component-owned clip-frame affordance (chosen over Grid-local raw DOM)

The clip mechanism is a **wrapper element interposed between the child's element and the container's element**, sized to the cell rect with `overflow:hidden`, with the child parked at `(0,0)` inside it at its natural/min box. The decision is **where the wrapper lives**:

- **Rejected — Grid-local raw DOM interposition.** The layout manager would `createElement` a `<div>`, set its style, and `insertBefore`/`appendChild` to re-parent the child element. This violates three conventions at once: "CSS writes go through `StyleRule`/`InlineStyle`" (raw `div.style.*`), "Minimize direct DOM access," and the principle that a layout manager drives children only through `setX/setY/setWidth/setHeight`. It also duplicates the child-position bookkeeping outside any Component.
- **Chosen — a clip-frame affordance on `Component`.** `Component` gains a method that wraps its **own** element in a framework-managed wrapper element and exposes typed setters for the wrapper's geometry and overflow. The layout manager calls `child.setClipFrame(x, y, w, h)` to clip, and `child.clearClipFrame()` to recover. All DOM/CSS writes stay inside Component's typed-setter + buffered-style seam; the child's `_parent` and the container's `_components` list are untouched (the wrapper is a presentational sheath the child manages around itself, not a new tree node); and the layout manager keeps driving the child purely through typed methods. This is the cleanest fit for the framework's invariants despite touching core.

**Convention tension (flagged):** "one DOM element per class" says a class owns exactly one element. The clip wrapper is a *second* element the `Component` manages. The rule's own escape hatch — "trivial non-interactive helpers (e.g. a resize-handle div) can stay as raw children" — covers a non-interactive presentational sheath like this, but here the sheath is the *ancestor* of the owned element rather than a child, so the precedent is adjacent rather than exact. The wrapper carries no `id`, no event listeners, and no independent behaviour, so it does not warrant its own `Component` subclass; treating it as a managed presentational element on `Component` is the least-invasive reading. This tension is unavoidable given the user's chosen wrapper approach and is called out here per the plan rules.

### The wrapper receives the cell rect; the child fills the wrapper's content box

`commitBounds`/`placeComponent` write `x/y/w/h` onto the **child** element today. With the clip frame active, the **wrapper** takes the cell rect `(x, y, w, h)` and `overflow:hidden`; the child is positioned at `(0, 0)` inside the wrapper at its natural box (its min-width-floored width/height). Because the child is `position:absolute` (framework invariant) and the wrapper becomes its offset parent, the child's `0,0` is relative to the wrapper. The child's committed width stays its clamped min (e.g. 400) — we do **not** fight `clampWidth`; the wrapper does the visual clipping. So the clip path becomes: `child.setClipFrame(x, y, w, h)` then position the child at `0,0` with its natural size (no min-floor conflict, because the cell rect lives on the wrapper, not the child).

### Recovery tears the wrapper down

When a track later grows so the child fits (`min.width <= w && min.height <= h`), `placeAt` takes the existing else-branch and calls `child.clearClipFrame()` before `placeComponent`, unwrapping the child element back to its direct-container parenting and clearing the wrapper's geometry. Toggling track sizes at runtime therefore leaves no stale wrapper. `clearClipFrame()` is idempotent (no-op when no frame is active), so the non-clipping branch can call it unconditionally — mirroring how the current code calls `setOverflow('visible')` unconditionally.

### Event delegation survives the extra ancestor

Verified against [`Event.ts`](../src/typescript/lib/core/Event.ts): exact-target dispatch keys off `evnt.target.id` ([Event.ts:98](../src/typescript/lib/core/Event.ts#L98)) — the child's own element, unaffected by an outer wrapper. Subtree dispatch walks `evnt.target.parentElement` up the chain matching `element.id` ([Event.ts:119-131](../src/typescript/lib/core/Event.ts#L119)); the wrapper is just one more ancestor in that walk, and because it carries **no `id`** the `subtreeListeners.get(element.id)` lookup skips it and the walk still reaches the container's id. The `addSubtreeListener`-style container delegation therefore continues to fire through the wrapper. (This is why the wrapper must not carry an id — noted in Potential Challenges.)

### `setOverflow('hidden')` on the child is dropped from the clip path

The current clip branch's `component.setOverflow('hidden')` ([Grid.ts:712](../src/typescript/lib/layout/Grid.ts#L712)) is ineffective for the bug (it clips the child's descendants, not its own box) and is superseded by the wrapper's `overflow:hidden`. Remove it from the clip branch and remove the paired `setOverflow('visible')` from the else-branch, replacing both with `setClipFrame` / `clearClipFrame`. This keeps the child's own overflow state clean (the framework default) rather than leaving a stale `hidden`.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/core/Component.ts  (modified) — new clip-frame affordance.
// The wrapper is a framework-managed presentational element with no id and no
// listeners; it interposes between this component's element and its current
// DOM parent. No XOptions field: the clip frame is layout-manager-driven
// runtime state, not consumer-configurable (per ARCHITECTURE.md rule 3,
// framework-managed bookkeeping stays off the options bag).
class Component<TOptions extends ComponentOptions = ComponentOptions> extends BaseObject {
    // private _clipFrame: HTMLElement | null = null;   // backing field, runtime-only

    /**
     * Wraps this component's element in a clip frame sized to (x,y,w,h) with
     * overflow:hidden, parking the element at (0,0) inside it. Idempotent:
     * re-calling re-sizes the existing frame.
     */
    setClipFrame(x: number, y: number, width: number, height: number): this;

    /**
     * Removes the clip frame, re-parenting the element back to its original
     * DOM parent at the frame's former position. No-op when no frame is active.
     */
    clearClipFrame(): this;
}
```

The clip-frame element's geometry and `overflow:hidden` are written through Component's existing buffered-style seam (`setElementStyle(s)` on the wrapper via a small internal helper, or a dedicated `StyleRule`). No new `Grid` public API: the four track setters from the original feature are unchanged.

---

## Internal Structure

### `computeTotalMinSize` — track-aware branch

```
protected computeTotalMinSize(): Size {
    // ... existing container / empty guards, colRowCount, spacing ...

    const widthMin  = this._columnTracks.length > 0
        ? trackAxisMin(this._columnTracks, cols, content.columns)   // sum fixed + content; weight => 0
        : cols * maxCellWidth;                                      // existing uniform fallback
    const heightMin = this._rowTracks.length > 0
        ? trackAxisMin(this._rowTracks, rows, content.rows)
        : rows * maxCellHeight;

    return {
        width:  widthMin  + Math.max(0, cols - 1) * spacing,
        height: heightMin + Math.max(0, rows - 1) * spacing,
    };
}
```

`content = this.measureContent(components, cols, rows)`. `trackAxisMin` sums `track.value` for `fixed`, `contentSizes[i]` for `content`, and `0` for `weight`, defaulting a missing track to `weight` (contributing `0`) so a partially-specified track list still under-counts toward "no intrinsic minimum on flex tracks." Note `computeTotalMinSize` currently returns inner geometry only (no perimeter); keep that contract — `doLayout` compares it against `containerSize` (already inner), so the perimeter is not added here.

### `placeAt` clip branch — wrapper instead of child overflow

```
const min = component.getMinSize();

if (min && (min.width > w || min.height > h)) {
    component.setClipFrame(x, y, w, h);          // wrapper takes the cell rect
    this.commitBounds(component, 0, 0, w, h);    // child parks at 0,0 inside the frame
} else {
    component.clearClipFrame();                  // idempotent recovery
    this.placeComponent(component, x, y, w, h, FillType.BOTH);
}
```

The child's `commitBounds(0,0,w,h)` still gets re-floored by `clampWidth` to its min (400) — that is fine and intended: the child renders at its natural 400px box *inside* the clip frame, which is sized to the 120px cell with `overflow:hidden`, so the visible result is a 120px-clipped child. The `x,y` of the child becomes `0,0` because the wrapper is now its offset parent.

---

## Ordered Implementation Steps

1. **Component.ts — clip-frame affordance.** Add the private `_clipFrame: HTMLElement | null` backing field and the `setClipFrame(x,y,w,h)` / `clearClipFrame()` typed methods with JSDoc (`@category Core`). `setClipFrame`: lazily create the wrapper `<div>` (no id, `position:absolute`, `overflow:hidden`), insert it before this element's current position in its parent, move this element inside it, and write the wrapper's `left/top/width/height` through the buffered-style seam. `clearClipFrame`: move this element back to the wrapper's parent at the wrapper's position, remove the wrapper, null the field. Both route every DOM/CSS write through framework setters / `StyleRule` / `InlineStyle` — no raw `.style.*`. Verify with `grep -n 'style\.' src/typescript/lib/core/Component.ts` shows no new raw style writes from these methods.
2. **Grid.ts — `computeTotalMinSize` track-aware.** Add the private `trackAxisMin` helper and rewrite the width/height computation per _Internal Structure_, calling `measureContent` for the content maxima. Keep the uniform fallback verbatim for the no-tracks case. Verify the uniform branch is unreachable only when `_columnTracks`/`_rowTracks` is non-empty.
3. **Grid.ts — `placeAt` clip branch.** Replace `setOverflow('hidden')` + `commitBounds(component, x, y, w, h)` with `setClipFrame(x, y, w, h)` + `commitBounds(component, 0, 0, w, h)`; replace the else-branch `setOverflow('visible')` with `clearClipFrame()`. Verify `grep -n 'setOverflow' src/typescript/lib/layout/Grid.ts` returns zero matches afterward.
4. **GridPanel.ts — demo.** No change expected (the demo already exercises all three behaviours). If the clipped child needs to demonstrate recovery, leave as-is; only touch the demo if a smoke test reveals a gap.
5. **Typecheck + docs build + manual smoke** per Verification.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | src/typescript/lib/core/Component.ts |
| Modify | src/typescript/lib/layout/Grid.ts |
| Modify (only if smoke reveals a gap) | src/typescript/GridPanel.ts |

---

## Verification

- **Typecheck / build:** `npm run build` (runs `tsc` then `vite build`) — 0 errors.
- **No stale child-overflow in the clip path:** `grep -n 'setOverflow' src/typescript/lib/layout/Grid.ts` — 0 matches.
- **Manual smoke (dev server already running at http://localhost:8015 via `npm run dev`; Grid tab):**
  - **Narrow window (~900px):**
    - (a) **No horizontal scrollbar** on the Grid panel.
    - (b) The **rightmost column's right edge respects the right inset** — its right edge lands at `panelRight − 4px` (the 4px panel inset), not at scrollWidth. Measure via Chrome DevTools MCP (`evaluate_script` reading the column-2 child's `getBoundingClientRect().right` vs the panel's `clientWidth`/inset).
    - (c) The oversized child ("I am too wide…") is **clipped to its 120px cell and does not spill into column 1** — its visible box ends at the column-0 right edge; verify the wrapper element has `width:120px; overflow:hidden` while the inner button keeps `width:400px`.
  - **Wide window:** track sizing still works — col0 = 120px exactly, col2 hugs its content width, col1 absorbs the remaining slack; the clipped child recovers (wrapper torn down) only if the fixed column is widened past 400 (it is not, so it stays clipped — that is correct).
- **Event delegation sanity:** click the clipped button and an auto-flow button; confirm their `action`/click handlers still fire through the wrapper (no console errors; buttons respond).
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Documentation Impact

The new `Component.setClipFrame` / `clearClipFrame` are public methods on a core class.

- `Component` is exported from the core subpath barrel [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) — no new export entry needed (the methods ride on the already-exported class), but confirm the barrel doesn't need a re-export.
- Update the curated core page under `docs/core/` that documents `Component` to mention the clip-frame affordance, and ensure the typedoc API page regenerates (driven by `npm run docs:api`).
- JSDoc on both methods stays within the core bucket, so `{@link}` cross-references are fine (no cross-bucket markdown link needed).
- If `Component`'s public surface is *not* otherwise documented prose-side (most setters aren't individually documented), a one-line mention is sufficient — keep it surgical; do not author a new page.

---

## Potential Challenges

- **Wrapper must carry no `id`.** Subtree event delegation matches `element.id` while walking ancestors; a wrapper with an id colliding with a registered bucket would mis-route. Mitigation: never set an id on the wrapper (verified against [Event.ts:119](../src/typescript/lib/core/Event.ts#L119)).
- **Offset-parent shift for the child.** Once wrapped, the child's `position:absolute` resolves against the wrapper, so its committed coordinates must be `(0,0)`, not the cell `(x,y)`. Mitigation: the clip branch commits the child at `0,0`; the cell `x,y` go on the wrapper. Covered in Internal Structure.
- **`removeComponent` / `removeAllComponents` and the wrapper.** `removeElement` detaches the child's element ([Component.ts:3207](../src/typescript/lib/core/Component.ts#L3207)); if the child is inside a wrapper, the wrapper would be orphaned in the DOM. Mitigation: `removeElement` (or the clip-frame teardown) must clear any active clip frame so the wrapper is removed with the child — handle in `clearClipFrame` and ensure the removal paths call it, or detach the wrapper when the child's element is removed.
- **`measureContent` flow-position cost in `computeTotalMinSize`.** `computeTotalMinSize` now calls `measureContent`, which it didn't before. It already runs once per `doLayout` inside `layoutOccupancy`; calling it again in `computeTotalMinSize` is a second O(children) pass per layout. Acceptable for the grid sizes in play; do not cache speculatively (CLAUDE.md §2).
- **`autoCommitStyle` during the clip commit.** `commitBounds` toggles `setAutoCommitStyle(false/true)` around the child writes; the wrapper's geometry writes in `setClipFrame` happen outside that window, so flush them through the buffered seam normally. Verify the wrapper geometry reaches the DOM in the same frame (the `Panel.doLayout` → `commitElementStyle` flush already covers the host; the wrapper writes flush on their own `autoCommitStyle === true` default).

---

## Critical Files

- [`src/typescript/lib/layout/Grid.ts`](../src/typescript/lib/layout/Grid.ts) — `computeTotalMinSize` ([:397](../src/typescript/lib/layout/Grid.ts#L397)), `measureContent` ([:606](../src/typescript/lib/layout/Grid.ts#L606)), `layoutOccupancy`/`placeAt` clip branch ([:709](../src/typescript/lib/layout/Grid.ts#L709)), `doLayout` inflation ([:459](../src/typescript/lib/layout/Grid.ts#L459)).
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `clampWidth` ([:2092](../src/typescript/lib/core/Component.ts#L2092)), `setMinSize` ([:1685](../src/typescript/lib/core/Component.ts#L1685)), `setOverflow` ([:2377](../src/typescript/lib/core/Component.ts#L2377)), `addComponent` ([:3119](../src/typescript/lib/core/Component.ts#L3119)) / `removeComponent` ([:3207](../src/typescript/lib/core/Component.ts#L3207)), the buffered-style seam (`setElementStyle`, `StyleRule`/`InlineStyle`).
- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — `setAutoScroll` ([:150](../src/typescript/lib/core/Panel.ts#L150)), `measureScrollbarGutter` ([:295](../src/typescript/lib/core/Panel.ts#L295)): proof the scrollbar is native and `getMinSize` is not consumed for it.
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — `baseListener` exact-target ([:96](../src/typescript/lib/core/Event.ts#L96)) and subtree ([:114](../src/typescript/lib/core/Event.ts#L114)) dispatch: proof an idless wrapper preserves delegation.
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `commitBounds` ([:338](../src/typescript/lib/layout/LayoutManager.ts#L338)) (bypasses the cell clamp), `placeComponent`/`resolveBounds`.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — "Positioning is always absolute," "One DOM element per class" (and its raw-helper carve-out), "CSS writes go through StyleRule/InlineStyle," typed-setter rules.

---

## Non-Goals

- **Making `getMinSize` / `getPreferredSize` / `getMaxSize` track-aware.** Only `computeTotalMinSize` drives the demonstrated bugs; the trio stays conservative (per the original plan's deferral) until a host actually mis-sizes through it. Touching it now would be gratuitous.
- **A reusable clip-wrapper `Component` subclass.** The wrapper has no id, no listeners, and no independent behaviour, so it does not warrant its own class — it is a managed presentational element on `Component`.
- **Re-flowing or re-deriving the non-stretching baseline branch.** Untouched; these bugs are in the stretching/occupancy path.
- **New theme tokens or visible styling.** The wrapper is purely `overflow:hidden` geometry; no CSS custom properties.
