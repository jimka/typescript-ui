# Context-Menu Viewport Clamp & Scroll — Implementation Plan

## Overview

`Menu` ([src/typescript/lib/core/Menu.ts:57](../src/typescript/lib/core/Menu.ts#L57)) renders a floating panel sized to the full preferred height of its items. Today both entry paths set the height to `getPreferredSize().height` ([Menu.ts:163](../src/typescript/lib/core/Menu.ts#L163), [Menu.ts:234](../src/typescript/lib/core/Menu.ts#L234)) and clamp only the *position* to the viewport ([Menu.ts:171-172](../src/typescript/lib/core/Menu.ts#L171)). That position clamp already nudges a menu *that fits* fully on-screen (a near-bottom menu opens upward via `Math.min(y, vp.height - totalHeight)`), so the gap is **not** "menus opened near the bottom" — those already reposition. The unhandled case is a menu **taller than the viewport itself**: the position clamp bottoms out at `top = 0`, the *size* is never clamped, and the items past the bottom edge become unreachable because there is nowhere left to nudge. The persistent-mode `open()` path ([Menu.ts:229](../src/typescript/lib/core/Menu.ts#L229)) has the same gap.

This plan adds two coupled behaviours to both entry paths: **clamp** the rendered menu height to the vertical room available at its anchored position, and **scroll** the items vertically when clamped so every item stays reachable.

The work lives almost entirely in `Menu.ts`. It reuses the framework's existing native-scroll mechanism (`overflow-y: auto` + the layout manager's per-axis overflow flag), so no new DOM element, setter, or theme token is introduced. `Menu` extends `Component`, not `Panel`, so it cannot call `Panel.setAutoScroll`; instead it wires the same three primitives that `setAutoScroll("y")` wires ([Panel.ts:230-253](../src/typescript/lib/core/Panel.ts#L230)) — `setOverflowX("hidden")` and `setOverflowY("auto")` on itself, and `setOverflowing(false, true)` on its `VBox` — directly.

---

## Architecture Decisions

### Reuse the native-scroll primitives, not a content frame

The framework's vertical-scroll mechanism is: the host sets `overflow-y: auto` (and `overflow-x: hidden`, so a `visible` overflow-x doesn't compute to `auto` and sprout a spurious horizontal scrollbar), and its `LayoutManager` is told to "let children overflow the host" via `setOverflowing(x, y)` ([LayoutManager.ts:149](../src/typescript/lib/layout/LayoutManager.ts#L149)). With overflow-y enabled, `VBox.doLayout` lays its items out past the host's clamped inner height instead of compressing them ([VBox.ts:318](../src/typescript/lib/layout/VBox.ts#L318)), and the browser's native scrollbar appears. `Panel.setAutoScroll("y")` is exactly this trio — `setOverflowX("hidden")` + `setOverflowY("auto")` + `setOverflowing(false, true)` ([Panel.ts:231](../src/typescript/lib/core/Panel.ts#L231), [Panel.ts:253](../src/typescript/lib/core/Panel.ts#L253)). `Menu` extends `Component`, so it has `setOverflowX`/`setOverflowY` ([Component.ts:3078](../src/typescript/lib/core/Component.ts#L3078)) but not `setAutoScroll`. The menu wires the same three calls itself in its chrome setup.

This is less machinery than `Panel` (no scrollbar gutter, no scroll shadows, no `AutoScrollMode` cache) — the menu only ever needs the `"y"` case, so replicating just that is the surgical choice. It does **not**, however, avoid the scroll content frame: once `setOverflowing(false, true)` is live, the first `VBox.doLayout` calls `reserveContentFrame()` ([VBox.ts:326](../src/typescript/lib/layout/VBox.ts#L326)), which installs a persistent content frame and re-parents the menu items into it ([LayoutManager.ts:226-227](../src/typescript/lib/layout/LayoutManager.ts#L226)). That re-parenting is the same one `Panel` scroll hosts incur and is harmless here: the menu's fade-in animates opacity on the menu **root** element ([Menu.ts:177](../src/typescript/lib/core/Menu.ts#L177)), not on a menu-item descendant, so moving the items into the frame cannot cancel an in-flight transition. Switching `Menu`'s base class to `Panel` is rejected: it would drag in gutter/shadow/`clampsToContentSize=false` semantics the menu doesn't want and is a far larger blast radius than three setter calls.

### `clampHeight` already does the right thing once `maxSize.height` is set

`Component.setHeight` ([Component.ts:2661](../src/typescript/lib/core/Component.ts#L2661)) runs the value through `clampHeight` ([Component.ts:2687](../src/typescript/lib/core/Component.ts#L2687)), which caps it at `getMaxSize().height` when `clampsToContentSize()` is true — and `Menu` inherits the default `true` ([Component.ts:2610](../src/typescript/lib/core/Component.ts#L2610)). So the clamp is implemented by computing the available vertical room and feeding it as the menu's `maxSize` before the existing `setHeight(totalHeight)` call. When content fits, `totalHeight <= max` and nothing changes; when it overflows, `setHeight` clamps to `max` and the overflow-y scrollbar engages. No new clamp code path — the plan sets one constraint and lets the existing clamp fire.

`clampHeight` also applies the merged `getMinSize().height` floor. That floor does not fight the max clamp here only because `MenuItem` sets a preferred height but no `setMinSize` ([MenuItem.ts:172-173](../src/typescript/lib/component/container/MenuItem.ts#L172)), so the `VBox` content-min height is ~0 and the menu's own min stays unset; the size-constraint invariant `min ≤ max` therefore holds even when `available` is small.

### Compute available room from the anchor, and clamp on the side the menu actually grows toward

Vertical room depends on where the menu opens and **which direction it grows**. For rebuild mode (`show()`) the menu always grows *downward* from the cursor `y` (it is only ever nudged up so its bottom stays on-screen, never flipped to sit above the cursor), so the room is the space below the final top. For a top-level persistent menu (`open()`) the menu grows downward from the anchor's `bottom` when it fits, but **flips to grow upward** from the anchor's `top` when there isn't room below ([Menu.ts:273-275](../src/typescript/lib/core/Menu.ts#L273)); the room in the flipped case is the space *above* the anchor, not below the clamped top. For a submenu the same downward/flip choice is made against the anchor item's `top`/`bottom`.

The naïve formula `available = vp.height - resolvedTop - VIEWPORT_MARGIN` measures only the room *below* the resolved top and is therefore **wrong for the flipped case**: when a tall menu is flipped up and its computed top is clamped to `0`, that formula returns nearly the whole viewport and the menu grows back down across the anchor it was supposed to sit above. So each call site computes `availableHeight` against the side the menu grows toward and passes it to the helper; the helper does not re-derive room from the top. `Util.getViewportSize()` ([Util.ts:426](../src/typescript/lib/core/Util.ts#L426)) is the viewport source. A small `VIEWPORT_MARGIN` constant keeps the menu off the literal screen edge and is folded into **both** the position clamp and the room computation so a menu that exactly fits does not get clipped by `VIEWPORT_MARGIN` pixels and grow a spurious scrollbar.

### Order of operations in `show()` / `open()`

The height clamp depends on the final placement, but for the upward-flip case the placement also depends on the clamped height (a flipped menu's top is `anchorTop - height`, and `height` may have just been clamped). The revised order is therefore:

**`show()` (downward only):** (1) build items, measure `totalHeight`; (2) resolve final `x`; (3) resolve final `top`, folding `VIEWPORT_MARGIN` into the clamp: `top = clamp(y, VIEWPORT_MARGIN, vp.height - totalHeight - VIEWPORT_MARGIN)`; (4) `available = vp.height - top - VIEWPORT_MARGIN`; (5) `applyViewportHeightClamp(available, totalHeight)`.

**`open()` (downward or flipped):** the two branches use **different vertical reference edges** — the top-level branch grows down from the anchor's `bottom` ([Menu.ts:267](../src/typescript/lib/core/Menu.ts#L267): `y = anchorRect.bottom`), the submenu branch grows down from the anchor item's `top` ([Menu.ts:249](../src/typescript/lib/core/Menu.ts#L249): `y = anchorRect.top`). Call the chosen edge `growTop`. (1) measure `totalHeight`; (2) compute `roomBelow = vp.height - growTop - VIEWPORT_MARGIN` and `roomAbove = anchorTop - VIEWPORT_MARGIN` (top-level: `growTop = anchorRect.bottom`; submenu: `growTop = anchorRect.top`, and `anchorTop` is the parent/item top the existing flip already measures against); (3) if `totalHeight ≤ roomBelow` **or** `roomBelow ≥ roomAbove`, grow down: `available = roomBelow`, `y = growTop`; otherwise flip up: `available = roomAbove`, and after clamping, `y = anchorTop - min(totalHeight, available)` so the clamped bottom still meets the anchor; (4) `applyViewportHeightClamp(available, totalHeight)`; (5) `setX/setY` with the resolved coordinates, inside the existing `setAutoCommitStyle(false)/(true)` bracket. Because the flipped `y` uses the clamped height, the menu never floats away from its anchor.

Only `maxSize.height` is constrained; `maxSize.width` is passed as `Number.MAX_VALUE`, the documented "no constraint" sentinel ([Component.ts:2235-2236](../src/typescript/lib/core/Component.ts#L2235) param doc, applied at [Component.ts:2250](../src/typescript/lib/core/Component.ts#L2250)), so width is never clamped (horizontal scroll is a Non-Goal).

### A shared private helper for both modes

`show()` and `open()` both need "given a computed available height and a content height, set the height cap and apply it." Extract a single `private applyViewportHeightClamp(availableHeight: number, contentHeight: number): void` that calls `setMaxSize(Number.MAX_VALUE, availableHeight)` then `setHeight(contentHeight)`. The helper deliberately takes the already-computed `availableHeight` (rather than a top coordinate) so each call site owns its own downward/flipped room calculation; the helper only owns the mechanical clamp. This honours the CODE_CONVENTIONS rule against duplicated logic and keeps each call site readable.

---

## Public API (TypeScript Signatures)

No public API changes. All additions are `private` to `Menu`:

```typescript
class Menu extends Component {
    // new private helper
    private applyViewportHeightClamp(availableHeight: number, contentHeight: number): void;
}
```

Scroll wiring is added inside the existing private `applyRebuildChrome()` and `applyPersistentChrome()`:

```typescript
// inside applyRebuildChrome() / applyPersistentChrome():
this.setOverflowX("hidden");                       // Component setter (exists)
this.setOverflowY("auto");                         // Component setter (exists)
(this.getLayoutManager() as VBox).setOverflowing(false, true);
```

`setOverflowing` is already `public` on `LayoutManager` ([LayoutManager.ts:149](../src/typescript/lib/layout/LayoutManager.ts#L149)) — its JSDoc states it is "Public so the host `Panel` can drive it." `Menu` reaches it directly through the `VBox` cast; no visibility change to `LayoutManager` is needed, and the call is unconditional (the method is present on every `LayoutManager`, so no optional chaining).

---

## Internal Structure

New constant near the existing menu constants ([Menu.ts:13-20](../src/typescript/lib/core/Menu.ts#L13)):

```typescript
/** Pixels kept between a clamped menu and the viewport edge so the panel
 *  border and shadow are never flush against the screen. Mirrors the small
 *  inset used by other floating panels; purely cosmetic breathing room. */
const VIEWPORT_MARGIN = 4;
```

Helper body (shape, not final):

```typescript
private applyViewportHeightClamp(availableHeight: number, contentHeight: number): void {
    // Width is unconstrained (Number.MAX_VALUE is the documented "no
    // constraint" sentinel); only the vertical axis is capped. clampHeight
    // then caps `contentHeight` at `availableHeight` because Menu is a
    // clampsToContentSize() component, and the overflow-y scrollbar engages.
    this.setMaxSize(Number.MAX_VALUE, Math.max(0, availableHeight));
    this.setHeight(contentHeight);
}
```

`setMaxSize(width, height)` takes two positional numbers (not a `Size` object) ([Component.ts:2240](../src/typescript/lib/core/Component.ts#L2240)); it overwrites the prior `maxSize` rather than merging, so reused rebuild-mode menus get a fresh cap on every `show()`.

`show()` revised tail (replacing [Menu.ts:159-172](../src/typescript/lib/core/Menu.ts#L159)):

```typescript
this.setWidth(this._menuWidth);

const totalHeight = this.getPreferredSize()?.height ?? 0;
const el = this.getElement(true);
const vp = Util.getViewportSize();

// VIEWPORT_MARGIN folded into the position clamp so a fitting menu's bottom
// lands at `vp.height - VIEWPORT_MARGIN` — then `available` equals totalHeight
// exactly and no spurious scrollbar appears.
const left = Math.max(VIEWPORT_MARGIN, Math.min(x, vp.width - this._menuWidth - VIEWPORT_MARGIN));
const top  = Math.max(VIEWPORT_MARGIN, Math.min(y, vp.height - totalHeight - VIEWPORT_MARGIN));
const available = vp.height - top - VIEWPORT_MARGIN;

this.setX(left);
this.setY(top);
this.applyViewportHeightClamp(available, totalHeight);

this.scheduleLayout();
```

`show()` only ever grows the menu *downward* from `top`; it does not flip to sit above the cursor, so measuring `available` below `top` is correct. When `totalHeight` exceeds the viewport the position clamp pins `top` at `VIEWPORT_MARGIN` and `available` becomes the full usable height; anchoring near the cursor with a scrollable body is the intended UX — do not re-flip after clamping.

For `open()` ([Menu.ts:255-281](../src/typescript/lib/core/Menu.ts#L255)) the existing logic flips `y` to `anchorRect.top - totalHeight` (top-level) or `vp.height - totalHeight` (submenu) and then clamps to `Math.max(0, …)`. That clamp-to-`0` combined with a *below-the-top* room measure is exactly the bug this plan must avoid. Replace each branch's overflow handling with the directional choice from **Order of operations** above: compute `roomBelow`/`roomAbove`, pick the side, compute `available`, call `applyViewportHeightClamp(available, totalHeight)`, and for the flipped branch set `y = anchorTop - Math.min(totalHeight, available)` so the clamped bottom still meets the anchor. All of this stays inside the existing `setAutoCommitStyle(false)`/`true` bracket so the clamped height and position commit atomically.

---

## Ordered Implementation Steps

1. **Add the `VIEWPORT_MARGIN` constant** near the other module constants in `Menu.ts`, with the magic-number `why` comment per CODE_CONVENTIONS.
2. **Confirm `VBox` import is present** ([Menu.ts:8](../src/typescript/lib/core/Menu.ts#L8)). No `LayoutManager` change is needed — `setOverflowing` is already `public` ([LayoutManager.ts:149](../src/typescript/lib/layout/LayoutManager.ts#L149)).
3. **Enable vertical scroll in chrome setup.** In `applyRebuildChrome()` and `applyPersistentChrome()`, after the existing `setContain("layout")`, call `this.setOverflowX("hidden")`, `this.setOverflowY("auto")`, and forward `setOverflowing(false, true)` to the VBox. Keep `setContain("layout")`. The `setOverflowX("hidden")` matches `setAutoScroll("y")` and prevents the computed `overflow-x: auto` that a `visible` x-axis would otherwise produce.
4. **Add `applyViewportHeightClamp(availableHeight, contentHeight)`** private helper as specified (positional `setMaxSize` call).
5. **Rewire `show()`** to resolve `x`/`top` with `VIEWPORT_MARGIN` folded into the clamp, compute `available = vp.height - top - VIEWPORT_MARGIN`, then call the helper, removing the standalone `setHeight(totalHeight)` at [Menu.ts:163](../src/typescript/lib/core/Menu.ts#L163) (the helper now owns it).
6. **Rewire `open()`** (both submenu and top-level branches) to pick the grow direction (`roomBelow` vs `roomAbove`), compute `available`, call the helper, and for the flipped branch derive `y` from the clamped height — all inside the existing `setAutoCommitStyle` bracket; remove the standalone `setHeight(totalHeight)` at [Menu.ts:234](../src/typescript/lib/core/Menu.ts#L234).
7. **Verify the layout pass.** Because `setMaxSize` then `setHeight` precede `scheduleLayout()`/`doLayout()`, confirm the VBox lays children past the clamped inner height (overflow flag), `reserveContentFrame()` installs the content frame, and the native scrollbar shows. The `setContain("layout")` already on the panel keeps the scroll container's layout isolated.
8. **Regression grep:** `grep -n "setHeight(totalHeight)" src/typescript/lib/core/Menu.ts` — expect zero matches (both replaced by the helper).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Menu.ts` |

---

## Verification

- **Typecheck:** `npm run build` (or the project's tsc task) — zero errors.
- **Grep invariant:** `grep -n "setHeight(totalHeight)" src/typescript/lib/core/Menu.ts` — zero matches.
- **Manual smoke (rebuild mode):** MiscPanel installs a right-click context menu (`new Menu()` at [src/typescript/MiscPanel.ts:486](../src/typescript/MiscPanel.ts#L486), `.show(...)` at [MiscPanel.ts:493](../src/typescript/MiscPanel.ts#L493)). Add enough items (or temporarily pad the list) that the menu exceeds the viewport, then right-click near the **bottom** of the screen: the menu must clamp to the room above/below the cursor and show a vertical scrollbar reaching every item. Right-click near the **top**: menu extends downward, clamps at the bottom margin, scrolls. Resize the window shorter and re-open to confirm the clamp tracks the current viewport.
- **Manual smoke (persistent mode):** Open a `MenuBar` dropdown tall enough to overflow; confirm it clamps and scrolls. With the menu-bar near the **bottom** of the viewport so the dropdown flips upward, confirm the flipped, clamped menu grows *up* from the anchor (its bottom meets the anchor) and does **not** fall back to filling the viewport downward over the button. Hover an item with a submenu — the submenu opens against its own clamp (it is itself a `Menu`, so it inherits the fix).
- **Theme toggle:** flip light/dark; the existing context-menu and menu-bar tokens are untouched, so only confirm no visual regression (no new tokens added).
- **Scrollbar visibility:** with a short menu that fits, confirm **no** scrollbar appears (`overflow-y: auto`, not `scroll`).

---

## Potential Challenges

- **Upward-flip room measurement.** A tall `open()` menu that flips above its anchor must be clamped to the room *above* the anchor, not the room below the clamped top. The naïve `vp.height - top - margin` measure, after the flipped top is clamped to `0`, returns nearly the whole viewport and the menu grows back down over the anchor. Mitigation: each call site computes `available` against the side it grows toward (`roomAbove` for the flipped branch); the flipped `y` is derived from the clamped height so the bottom still meets the anchor (see **Order of operations**).
- **`setMaxSize` persisting across `show()` calls.** Rebuild-mode menus are reused; a tall menu's `maxSize.height` would wrongly cap a later short menu opened higher up. Mitigation: `setMaxSize` overwrites the prior value ([Component.ts:2240-2257](../src/typescript/lib/core/Component.ts#L2240)) and the helper re-sets it on every `show()`/`open()`, so each call replaces the previous cap.
- **Content-frame re-parenting.** Enabling `setOverflowing(false, true)` makes `VBox.doLayout` install a persistent content frame and move the menu items into it ([LayoutManager.ts:226-227](../src/typescript/lib/layout/LayoutManager.ts#L226)). Mitigation: this is the standard scroll-host behaviour and is harmless for the menu — the fade-in transition is on the menu root element, not on the re-parented items, so it is not cancelled.
- **VBox preferred-height interaction.** `getPreferredSize().height` is still the *content* height (unclamped) and must stay so — the clamp lives only on `maxSize`/`setHeight`, never on the preferred-size measurement, or the scrollable content would be measured short. Mitigation: do not touch `getPreferredSize`; only set `maxSize` after measuring.

---

## Critical Files

- [src/typescript/lib/core/Menu.ts](../src/typescript/lib/core/Menu.ts) — the component; both `show()` and `open()` size/position logic, plus `applyRebuildChrome`/`applyPersistentChrome`.
- [src/typescript/lib/core/Panel.ts:217](../src/typescript/lib/core/Panel.ts#L217) — `setAutoScroll("y")` is the reference trio (`setOverflowX("hidden")` + `setOverflowY("auto")` + `setOverflowing(false,true)`) the menu replicates.
- [src/typescript/lib/layout/LayoutManager.ts:149](../src/typescript/lib/layout/LayoutManager.ts#L149) — `setOverflowing` (public) and the `_overflowing` flags consumed by `VBox.doLayout`; `reserveContentFrame` ([LayoutManager.ts:189-233](../src/typescript/lib/layout/LayoutManager.ts#L189)) installs the scroll content frame at [LayoutManager.ts:227](../src/typescript/lib/layout/LayoutManager.ts#L227).
- [src/typescript/lib/core/Component.ts:2661](../src/typescript/lib/core/Component.ts#L2661) — `setHeight`/`clampHeight` ([Component.ts:2687](../src/typescript/lib/core/Component.ts#L2687))/`clampsToContentSize` ([Component.ts:2610](../src/typescript/lib/core/Component.ts#L2610)); `setMaxSize` ([Component.ts:2240](../src/typescript/lib/core/Component.ts#L2240)) confirms `maxSize.height` is the lever.
- [src/typescript/lib/core/Util.ts:426](../src/typescript/lib/core/Util.ts#L426) — `getViewportSize`, the only viewport-dimension source (no dedicated clamp helper exists; positioning reads this directly).

---

## Non-Goals

- **Horizontal scrolling.** Menus are fixed-width; only vertical overflow is in scope. The new `maxSize` leaves width unconstrained.
- **Keyboard-nav scroll-into-view.** When `focusNext`/`focusPrev` ([Menu.ts:358](../src/typescript/lib/core/Menu.ts#L358)) move focus to an item below the fold in a scrolled persistent menu, the active item is not auto-scrolled into view. Native focus would scroll the overflow container, but `setFocused` is a class toggle, not DOM `focus()`, so it won't. This is a known follow-up; called out so the implementer doesn't assume it's handled. (Rebuild-mode menus have no keyboard nav.)
- **Re-clamping on live window resize while open.** A menu open during a viewport resize keeps its original clamp; menus are short-lived (dismiss on outside click/Escape), so re-measuring on `resize` is not worth a viewport listener. Re-opening picks up the new viewport.
- **Custom scrollbar chrome / scroll shadows.** The native `overflow-y: auto` scrollbar is used as-is; the `Panel` scroll-shadow overlay is intentionally not pulled in.
- **Submenu repositioning relative to a scrolled parent.** A submenu anchors to its `MenuItem`'s current on-screen rect ([Menu.ts:630](../src/typescript/lib/core/Menu.ts#L630)); if the parent is scrolled, the rect already reflects the scrolled position, so this works without extra code — but no special handling is added for a submenu whose anchor item is scrolled partly out of view.
