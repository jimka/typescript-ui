# Window North/West Resize Chrome-Min Clamp — Implementation Plan

## Overview

Dragging the NORTH (or WEST-family) border of a `Window`/`TabWindow` whose body content demands more height than the available viewport gap makes the whole window jump: the header is pushed above the viewport top and the south border below the bottom. The dragged edge decouples from the cursor and the chrome escapes off-screen.

Root cause confirmed. `AbstractWindow` extends `Container`, whose [`clampsToContentSize()`](../src/typescript/lib/core/Container.ts#L49) returns `false` — a window should fit its allocated slot and let oversized body content clip, **not** inflate up to its content-derived minimum. But [`AbstractWindow.setWidth`](../src/typescript/lib/core/AbstractWindow.ts#L469) / [`setHeight`](../src/typescript/lib/core/AbstractWindow.ts#L486) override the base and clamp to [`Component.getMinSize`](../src/typescript/lib/core/Component.ts#L2122), which folds in the **layout manager's** minimum (`Math.max(componentMin, layoutManager.getMinSize())`). For a window the layout manager is the body (`Border`/`Tab`), so that fold re-introduces the body content's min height. In [`flushResize`](../src/typescript/lib/core/AbstractWindow.ts#L1283) the NORTH/WEST cases size against a viewport cap then re-derive the top-left from the *clamped* size (`setY(originBottom - this.getHeight())`); when `setHeight` inflates height above the cap, the re-derived `Y` goes negative.

The fix is the **chrome-min clamp alone**: clamp border-resize to the **chrome's intrinsic minimum only** (title bar / control tools / tab strip), never the body content min. Introduce a protected `chromeMinSize(): Size` hook on `AbstractWindow` that the `setWidth`/`setHeight` overrides consult instead of `getMinSize()`. The body content overflows/clips per the `Container` policy. `flushResize` gets **no** position clamp of any kind — neither the blanket `clampPositionToViewport()` currently in the working tree nor any per-edge helper; the position re-derivation is already self-bounding once `setHeight`/`setWidth` stop inflating (see *Architecture Decisions*).

This is an internal behaviour fix on `src/typescript/lib/core/{AbstractWindow,Window,TabWindow}.ts`. No public API surface changes; the new hook is `protected`.

---

## Architecture Decisions

### A protected `chromeMinSize(): Size` hook, built from the existing chrome abstractions

`AbstractWindow` already separates chrome from body via two hooks subclasses implement: [`minContentWidthSeed()`](../src/typescript/lib/core/AbstractWindow.ts#L421) (the chrome's required *content* width — `_header.getMinContentWidth()` for `Window`, `TAB_MIN_CONTENT_WIDTH_PX` for `TabWindow`) and [`chromeHeight()`](../src/typescript/lib/core/AbstractWindow.ts#L431) (the title-chrome *content* band height — `_header.getHeight()` / `TAB_CHROME_HEIGHT_PX`). Both already exist and are already overridden per subclass. The chrome-min is exactly these two seeds, converted from a content-min to an **outer window** min by adding the window's insets + border thickness.

Add a single non-abstract method on the base:

```typescript
protected chromeMinSize(): Size {
    const border = this.getBorderSize();
    const insets = this.getInsets();
    // Mirror doLayout's outer→inner arithmetic: the body inset folds into the
    // resize-border band, so only one inset side is added per axis.
    const hChrome = (Number(border.left) || 0) + (Number(border.right) || 0) + insets.getLeft();
    const vChrome = (Number(border.top)  || 0) + (Number(border.bottom) || 0) + insets.getTop();
    return {
        width:  this.minContentWidthSeed() + hChrome,
        height: (this.chromeHeight() || CHROME_HEIGHT_FLOOR_PX) + vChrome,
    };
}
```

Rationale: reuse beats a new per-subclass override. Both subclasses already supply the two content seeds, so a base-level combinator needs no `Window`/`TabWindow` edits at all — surgical, one-element-per-class, and consistent with the existing `chromeHeight()`/`minContentWidthSeed()` split. A per-subclass `chromeMinSize()` override was rejected: it would duplicate the inset/border conversion in two places and re-derive width/height the subclasses already expose piecemeal.

The `|| CHROME_HEIGHT_FLOOR_PX` (26) mirrors the existing `chromeHeight() || 26` floor applied at call sites in [`viewportPositionBounds`](../src/typescript/lib/core/AbstractWindow.ts#L1402) — covers the pre-layout window where `_header.getHeight()` returns 0. Promote that literal to a named module constant (`CHROME_HEIGHT_FLOOR_PX`) and reuse it at both sites so the floor is defined once. (`TabWindow.chromeHeight()` already returns a non-zero constant, so the floor is a no-op there.)

### `setWidth`/`setHeight` clamp to `chromeMinSize()`, not `getMinSize()`

Replace the `this.getMinSize()` read in both overrides with `this.chromeMinSize()`. This removes the body-content-min fold while keeping a hard floor that prevents the chrome controls (icon, title text budget, trailing buttons / control tools) from being crushed. `Component.setWidth`'s private `clampWidth` still enforces any *explicit* `_options.minSize` the consumer set, so a caller-supplied `minSize` is still honoured as a separate floor — `chromeMinSize` only replaces the implicit content fold.

Note the `initChrome` seed at [AbstractWindow.ts:300](../src/typescript/lib/core/AbstractWindow.ts#L300) still calls `setMinSize(minContentWidthSeed(), 200)`. That seed is left **unchanged** — it sets the window's resting/explicit min (a 200px body floor at construction), which is desirable default geometry and is independent of the resize clamp. The bug is specifically the *resize-time* fold of the live layout-manager min, which only flows through `getMinSize()`; switching the override to `chromeMinSize()` cuts exactly that path. (The 200px explicit min still flows through `clampWidth` via `_options.minSize`, so a window can't be resized below 200px tall regardless — acceptable and matches today's resting floor.)

### `flushResize` gets NO position clamp — never clamp the anchor edge

The working tree currently has a blanket [`clampPositionToViewport()`](../src/typescript/lib/core/AbstractWindow.ts#L1375) call right after the resize switch and before `doLayout()` (added this session). **It must be removed**, and **nothing replaces it** — no per-edge helper, no axis-scoped clamp. `flushResize` ends up with no position clamp at all, which is exactly how it was before this session and which is correct once the chrome-min fix is in place. Three points justify this.

**1. Clamping the anchor edge is wrong by construction.** In a border resize the OPPOSITE edge is the anchor and must never move. For a NORTH drag, `flushResize` sets `setY(originBottom - height)` ([line 1333](../src/typescript/lib/core/AbstractWindow.ts#L1333)), so the south edge stays pinned at `originBottom` by construction. Any post-hoc clamp of `Y` into `[minY, maxY]` (as `clampPositionToViewport` does, applying `maxY = vh - height`) is destructive whenever the south edge is below the viewport (`originBottom > vh`): the `maxY` ceiling forces `Y` *down*, which yanks the whole window UP so the south edge snaps to the viewport bottom. That is a spurious reposition of the anchor edge — the exact user-reported bug. So the clamp cannot be applied to the anchor; and since `flushResize` re-derives the dragged edge *from* the anchor, any blanket position clamp inevitably touches it. The right answer is to clamp neither.

**2. With the chrome-min fix, the dragged edge is already self-bounding — no clamp is needed.** The existing size caps bound the DRAGGED edge: [`northHeightCap = originBottom`](../src/typescript/lib/core/AbstractWindow.ts#L1320) and [`westWidthCap = originRight`](../src/typescript/lib/core/AbstractWindow.ts#L1318) (confirmed in `flushResize`, lines 1308-1320). Once `setHeight`/`setWidth` clamp only to the (small) chrome min instead of the body-content-inclusive `getMinSize()`, the height lands in `[chromeMin, originBottom]`. A window's own height is always ≥ its chrome min, and its top `originY ≥ 0` (move-drag clamps `minY = 0`), so `originBottom = originY + originH ≥ chromeMin`. Therefore `top = originBottom - height ≥ originBottom - originBottom = 0` ALWAYS — the dragged top edge can never rise above the viewport, and the south edge stays anchored. WEST is symmetric via `originRight` (`left = originRight - width ≥ 0` since `originX ≥ 0` ⇒ `originRight ≥ width ≥ chromeMin`). The position re-derivation is self-bounding; adding a clamp only risks moving the anchor and buys nothing.

**3. The off-screen jump came solely from `setHeight` inflating past the cap.** The original bug was `setHeight` inflating the height above `northHeightCap` because `getMinSize()` folded in the body-content min, driving the re-derived `Y` negative. The chrome-min fix removes that inflation at the source. With inflation gone, the pre-existing (clamp-free) `flushResize` is correct again — which is why the correct change is to *revert* the blanket clamp, not to add a smarter one.

The public `clampPositionToViewport()` method itself stays in the file (it has a surviving caller — see *Public API*); only its `flushResize` call site is removed.

### Interaction with the size-constraint invariant (min ≤ preferred ≤ max)

The `min ≤ preferred ≤ max` contract is the subject of [plans/implemented/size-constraint-invariant.md](implemented/size-constraint-invariant.md) (already implemented) and its follow-up `size-constraint-invariant-regressions.md`. This plan does **not** touch `getMinSize`/`getMaxSize`/`getPreferredSize` aggregation or the invariant — `chromeMinSize()` is a *separate*, resize-only floor consulted by the window's `setWidth`/`setHeight` overrides; it does not feed the component's `_options.minSize` and does not participate in the layout aggregation the invariant governs. No overlap in scope. Flagged here only so the implementer does not conflate the two: `chromeMinSize()` must not be wired into `getMinSize()`.

---

## Public API (TypeScript Signatures)

No exported/consumer-visible API changes. One new `protected` method on the internal base class:

```typescript
// AbstractWindow
protected chromeMinSize(): Size;     // new — default impl combines chromeHeight() + minContentWidthSeed() + insets/borders
```

`setWidth`/`setHeight` signatures are unchanged; only their clamp source changes. No resize helpers are added. The public `clampPositionToViewport()` is unchanged and stays (still used by [`Tab.ts:1746`](../src/typescript/lib/layout/Tab.ts#L1746) for programmatic tear-off positioning); only the *resize-path* call to it is removed. Import `Size` from `~/primitive/Size.js` in `AbstractWindow.ts` if not already imported.

---

## Ordered Implementation Steps

1. **AbstractWindow.ts — add the floor constant.** Add `const CHROME_HEIGHT_FLOOR_PX: number = 26;` near the other module constants (~line 20-30), documented as the pre-layout chrome-height fallback. Replace the two `chromeHeight() || 26` literals (in `viewportPositionBounds`, [line 1402](../src/typescript/lib/core/AbstractWindow.ts#L1402)) with `chromeHeight() || CHROME_HEIGHT_FLOOR_PX`. → verify: `grep -n "|| 26" src/typescript/lib/core/AbstractWindow.ts` returns nothing.

2. **AbstractWindow.ts — add `chromeMinSize()`.** Place the new `protected chromeMinSize(): Size` method near `chromeHeight()`/`minContentWidthSeed()` (~line 430), body per *Architecture Decisions*. Add `import { Size } from "~/primitive/Size.js";` if absent. → verify: `npm run typecheck`.

3. **AbstractWindow.ts — repoint the resize clamps.** In `setWidth` (line 469) and `setHeight` (line 486), replace `const min = this.getMinSize();` with `const min = this.chromeMinSize();`. Update each method's JSDoc/`@remarks` to say the clamp is to the chrome's intrinsic minimum (not the body content min), and that an explicit consumer `minSize` is still enforced separately by `Component.setWidth`'s `clampWidth`. → verify: `grep -n "getMinSize()" src/typescript/lib/core/AbstractWindow.ts` shows no remaining call inside `setWidth`/`setHeight`.

4. **AbstractWindow.ts — remove the blanket clamp from `flushResize` (revert this session's addition).** Delete the `this.clampPositionToViewport();` call and the comment block above it ([lines 1368-1375](../src/typescript/lib/core/AbstractWindow.ts#L1368), between the resize switch's closing `}` and `this.doLayout();`). Add **no** replacement clamp of any kind — `flushResize` ends with the switch, then `doLayout()`, then `setAutoCommitStyle(true)`, exactly as before this session. Do **not** add per-edge helpers. The public `clampPositionToViewport()` method definition (line ~1438) stays untouched; only this call site is removed. → verify: `grep -n "clampPositionToViewport" src/typescript/lib/core/AbstractWindow.ts` shows it only on the method definition and its JSDoc reference — **not** inside `flushResize` (no occurrence between lines 1283 and 1377). `grep -n "clampPositionToViewport" src/typescript/lib/layout/Tab.ts` still shows the surviving caller at `Tab.ts:1746`.

5. **Typecheck.** `npm run typecheck` — expect zero errors.

6. **Manual smoke test** per *Verification*.

No `Window.ts` / `TabWindow.ts` edits required — both already implement `minContentWidthSeed()` and `chromeHeight()`, which the base combinator consumes.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/AbstractWindow.ts` |

---

## Verification

- **Typecheck:** `npm run typecheck` — zero errors.
- **No stray literals:** `grep -n "|| 26" src/typescript/lib/core/AbstractWindow.ts` — zero matches (floor centralised).
- **Clamp repointed:** `grep -n "getMinSize()" src/typescript/lib/core/AbstractWindow.ts` — no occurrence inside `setWidth`/`setHeight`.
- **Manual smoke test** (the repro): run `npm run dev` (app at http://localhost:8015). Open the dock demo on `MiscPanel` (`src/typescript/MiscPanel.ts`); add/use a `VBoxPanel` whose content exceeds the window height. Make the window short. Drag the **NORTH** border up and down:
  - Expected after fix: the header stays at/below the viewport top, the south edge stays put (NORTH is the fixed-bottom case), the dragged edge tracks the cursor, and the oversized body content clips/overflows instead of inflating the window. The window never jumps off-screen.
  - Repeat for NORTHWEST / NORTHEAST / WEST to confirm the WEST-family X re-derivation no longer escapes.
  - Shrink the window toward the chrome min: it should stop at the chrome floor (icon + title budget + trailing buttons visible; `TabWindow` strip tools visible), not collapse further.
  - Scope DevTools queries to the specific window instance (e.g. `.MiscPanel .Window`) — multiple same-type components coexist on the page.
- **Regression check for the user-reported anchor jump:** position a window so its **south edge is below the viewport bottom** (`originBottom > vh`). Grab the **NORTH** border and drag:
  - The south edge must stay fixed — the window must **NOT** jump upward to snap the south edge to the viewport bottom (the bug that the removed blanket clamp caused).
  - The dragged top edge must stop at the viewport top without the window repositioning **horizontally** (X must not change during a NORTH drag).
  - This is the specific behaviour the blanket `clampPositionToViewport()` removal restores; it must pass with **no** position clamp present in `flushResize`.

---

## Potential Challenges

- **`getInsets()`/`getBorderSize()` before render:** `chromeMinSize()` reads insets/border thickness. During a live border drag the window is rendered so these are populated; `getBorderSize` returns zeros when unrendered, and `chromeHeight()` falls back to the floor, so a pre-render call yields a sane (slightly under-counted) min rather than throwing. The resize path only runs post-show, so this is benign.
- **Inset arithmetic must match `doLayout`:** the body inset (`WINDOW_BODY_INSET_PX`) folds into the resize-border band, so [doLayout](../src/typescript/lib/core/AbstractWindow.ts#L1493) adds only `insets.getLeft()` (one side) per axis, not both. `chromeMinSize` mirrors that one-side addition; do not double-count insets, or the floor drifts a few px from the real chrome footprint.
- **`TabWindow` chrome height is a fixed constant** (`TAB_CHROME_HEIGHT_PX = 30`), not a live measurement, so its chrome-min height is stable regardless of strip state — acceptable and matches the existing `chromeHeight()` contract.
- **Explicit consumer `minSize` still applies:** the `initChrome` 200px body-height seed remains as `_options.minSize`, enforced by `clampWidth`. This means a window still can't be resized below 200px tall. If a future requirement wants chrome-only (e.g. ~26px) resize floors, that seed must change too — out of scope here.

---

## Critical Files

- [`src/typescript/lib/core/AbstractWindow.ts`](../src/typescript/lib/core/AbstractWindow.ts) — `setWidth`/`setHeight` (469/486), `chromeHeight`/`minContentWidthSeed` (421/431), `flushResize` switch (1283), the size caps `westWidthCap`/`northHeightCap` (1318/1320), the blanket clamp to remove (1375), `viewportPositionBounds`/`clampDragDelta`/`clampPositionToViewport` (1389/1413/1438), `doLayout` inset arithmetic (1491).
- [`src/typescript/lib/layout/Tab.ts:1746`](../src/typescript/lib/layout/Tab.ts#L1746) — surviving caller of the public `clampPositionToViewport()`; confirms the method must stay in the file after the resize-path call is removed.
- [`src/typescript/lib/core/Container.ts:49`](../src/typescript/lib/core/Container.ts#L49) — `clampsToContentSize() === false` policy the fix realigns with.
- [`src/typescript/lib/core/Component.ts:2122`](../src/typescript/lib/core/Component.ts#L2122) — `getMinSize` (the body-min fold being bypassed); `getInsets` (1319), `getBorderSize` (2293), `PerimeterSize` (48).
- [`src/typescript/lib/core/Window.ts:218`](../src/typescript/lib/core/Window.ts#L218) / [`:227`](../src/typescript/lib/core/Window.ts#L227) — `minContentWidthSeed`/`chromeHeight` overrides the combinator consumes.
- [`src/typescript/lib/core/TabWindow.ts:264`](../src/typescript/lib/core/TabWindow.ts#L264) / [`:275`](../src/typescript/lib/core/TabWindow.ts#L275) — same overrides + the `TAB_*` constants.
- [`src/typescript/lib/component/container/WindowHeader.ts:385`](../src/typescript/lib/component/container/WindowHeader.ts#L385) — `getMinContentWidth` (chrome width source for `Window`).
- [`plans/implemented/size-constraint-invariant.md`](implemented/size-constraint-invariant.md) — the adjacent invariant; this plan must not wire `chromeMinSize` into the aggregation it governs.

---

## Non-Goals

- Changing `getMinSize`/`getMaxSize`/`getPreferredSize` aggregation or the `min ≤ preferred ≤ max` invariant — owned by the size-constraint plans.
- Lowering the `initChrome` 200px default body-height seed — it is desirable resting geometry; only the resize-time content-min fold is removed.
- Adding scrolling to oversized window body content — `Container` clips by design; consumers wanting scroll use a `Panel`-based body.
- Removing the public `clampPositionToViewport()` method — it stays (still called by `Tab.ts:1746` for programmatic tear-off positioning); only the blanket *resize-path* call to it is removed, with no replacement.
- Any `Window.ts`/`TabWindow.ts` behaviour change beyond what the base combinator already reads from their existing hooks.
