# Context-Menu Viewport Clamp & Scroll — Implementation Plan

## Overview

`Menu` ([src/typescript/lib/core/Menu.ts:57](../src/typescript/lib/core/Menu.ts#L57)) renders a floating panel sized to the full preferred height of its items. A long menu opened near the bottom of the viewport currently runs off-screen: in `show()` the height is set to `getPreferredSize().height` ([Menu.ts:161](../src/typescript/lib/core/Menu.ts#L161)) and only the *position* is clamped to the viewport ([Menu.ts:171-172](../src/typescript/lib/core/Menu.ts#L171)) — the *size* is never clamped, and items below the fold become unreachable. The persistent-mode `open()` path ([Menu.ts:229](../src/typescript/lib/core/Menu.ts#L229)) has the same gap.

This plan adds two coupled behaviours to both entry paths: **clamp** the rendered menu height to the vertical room available at its anchored position, and **scroll** the items vertically when clamped so every item stays reachable.

The work lives almost entirely in `Menu.ts`. It reuses the framework's existing native-scroll mechanism (`overflow-y: auto` + the layout manager's per-axis overflow flag), so no new DOM element, setter, or theme token is introduced. `Menu` extends `Component`, not `Panel`, so it cannot call `Panel.setAutoScroll`; instead it wires the same two primitives that `setAutoScroll("y")` wires — `setOverflowY("auto")` on itself and `setOverflowing(false, true)` on its `VBox` — directly.

---

## Architecture Decisions

### Reuse the native-scroll primitives, not a content frame

The framework's vertical-scroll mechanism is: the host sets `overflow-y: auto`, and its `LayoutManager` is told to "let children overflow the host" via `setOverflowing(x, y)` ([LayoutManager.ts:136](../src/typescript/lib/layout/LayoutManager.ts#L136)). With overflow-y enabled, `VBox.doLayout` lays its items out past the host's clamped inner height instead of compressing them, and the browser's native scrollbar appears. `Panel.setAutoScroll("y")` is exactly this pair ([Panel.ts:229-252](../src/typescript/lib/core/Panel.ts#L229)). `Menu` extends `Component`, so it has `setOverflowY` ([Component.ts:2975](../src/typescript/lib/core/Component.ts#L2975)) but not `setAutoScroll`. The menu wires the same two calls itself in its chrome setup. This is strictly less machinery than `Panel` (no scrollbar gutter, no scroll shadows, no `AutoScrollMode` cache) — the menu only ever needs the `"y"` case, so replicating just that is the surgical choice. Switching `Menu`'s base class to `Panel` is rejected: it would drag in gutter/shadow/`clampsToContentSize=false` semantics the menu doesn't want and is a far larger blast radius than two setter calls.

### `clampHeight` already does the right thing once `maxSize.height` is set

`Component.setHeight` runs the value through `clampHeight` ([Component.ts:2584](../src/typescript/lib/core/Component.ts#L2584)), which caps it at `getMaxSize().height` when `clampsToContentSize()` is true — and `Menu` inherits the default `true` ([Component.ts:2507](../src/typescript/lib/core/Component.ts#L2507)). So the clamp is implemented by computing the available vertical room and feeding it as the menu's `maxSize` before the existing `setHeight(totalHeight)` call. When content fits, `totalHeight <= max` and nothing changes; when it overflows, `setHeight` clamps to `max` and the overflow-y scrollbar engages. No new clamp code path — the plan sets one constraint and lets the existing clamp fire.

### Compute available room from the anchor, not a fixed margin

Vertical room depends on where the menu opens. For rebuild mode the anchor is the cursor `y`; for a top-level persistent menu it is the anchor element's `bottom`/`top`; for a submenu it is the parent panel's geometry. The plan computes `availableHeight` per call site from `Util.getViewportSize()` ([Util.ts:426](../src/typescript/lib/core/Util.ts#L426)) and the same coordinates the existing positioning logic already reads. A small `VIEWPORT_MARGIN` constant keeps the menu off the literal screen edge. Crucially, **position is decided first, then height is clamped to the room below (or above) that final position** — the existing `show()` logic flips/clamps `y`, and the clamp must use the resolved `y`, not the raw input, or a menu pushed up from the bottom would still be over-tall.

### Order of operations in `show()` / `open()`

Today `show()` sets height, then positions. The clamp inverts part of this: it must know the final `y` to know the room. The revised order is (1) build items and measure `totalHeight`; (2) resolve final `x`/`y` exactly as today; (3) compute `availableHeight` from the resolved `y` and viewport; (4) set `maxSize` to `{ width: PANEL_WIDTH-ish, height: availableHeight }`; (5) `setHeight(totalHeight)` — now clamped. The menu's max width is left unconstrained (horizontal scroll is a Non-Goal); only `maxSize.height` matters, so the width field of the new `maxSize` is set to the existing menu width to avoid accidentally clamping width.

### A shared private helper for both modes

`show()` and `open()` both need "given a resolved top `y` and a content height, clamp my height and enable scroll." Extract a single `private applyViewportHeightClamp(resolvedTop: number, contentHeight: number): void` that sets `maxSize` and calls `setHeight`. Both call sites invoke it after resolving position. This honours the CODE_CONVENTIONS rule against duplicated logic and keeps each call site readable.

---

## Public API (TypeScript Signatures)

No public API changes. All additions are `private` to `Menu`:

```typescript
class Menu extends Component {
    // new private helper
    private applyViewportHeightClamp(resolvedTop: number, contentHeight: number): void;
}
```

Scroll wiring is added inside the existing private `applyRebuildChrome()` and `applyPersistentChrome()`:

```typescript
// inside applyRebuildChrome() / applyPersistentChrome():
this.setOverflowY("auto");                       // Component setter (exists)
(this.getLayoutManager() as VBox).setOverflowing?.(false, true);
```

`setOverflowing` is `protected` on `LayoutManager` ([LayoutManager.ts:136](../src/typescript/lib/layout/LayoutManager.ts#L136)) — confirm its visibility during implementation. If it is not reachable from `Menu`, widen it to `public` (it is a deliberate host→manager hook; `Panel` already calls it) rather than reaching around it. State the chosen visibility in the implementation commit.

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
private applyViewportHeightClamp(resolvedTop: number, contentHeight: number): void {
    const vp = Util.getViewportSize();
    const available = Math.max(0, vp.height - resolvedTop - VIEWPORT_MARGIN);

    // Cap height at the room below the resolved top; width is left at the
    // menu's own width so only the vertical axis is constrained.
    this.setMaxSize({ width: Number.MAX_VALUE, height: available });
    this.setHeight(contentHeight);   // clampHeight caps this at `available`
}
```

`setMaxSize` is the existing typed setter backing the `maxSize` option (confirm exact name during implementation — it is the partner of `setMinSize`/`getMaxSize` already referenced by `clampHeight`).

`show()` revised tail (replacing [Menu.ts:159-172](../src/typescript/lib/core/Menu.ts#L159)):

```typescript
this.setWidth(this._menuWidth);

const totalHeight = this.getPreferredSize()?.height ?? 0;
const el = this.getElement(true);
const vp = Util.getViewportSize();

const left = Math.max(0, Math.min(x, vp.width - this._menuWidth));
const top  = Math.max(0, Math.min(y, vp.height - totalHeight));

this.setX(left);
this.setY(top);
this.applyViewportHeightClamp(top, totalHeight);

this.scheduleLayout();
```

Note the existing `top` clamp (`Math.min(y, vp.height - totalHeight)`) already nudges a tall menu upward; when `totalHeight` exceeds the whole viewport that yields a negative, so keep the `Math.max(0, …)`. After the clamp the menu may be shorter, but anchoring at the cursor with a scrollable body is the intended UX — do not re-flip after clamping.

For `open()` ([Menu.ts:255-281](../src/typescript/lib/core/Menu.ts#L255)) the existing logic already flips `y` to `anchorRect.top - totalHeight` or `vp.height - totalHeight` when it overflows; after the final `setY(...)` call, invoke `applyViewportHeightClamp(resolvedY, totalHeight)` inside the same `setAutoCommitStyle(false)`/`true` bracket so the clamped height commits atomically with position.

---

## Ordered Implementation Steps

1. **Add the `VIEWPORT_MARGIN` constant** near the other module constants in `Menu.ts`, with the magic-number `why` comment per CODE_CONVENTIONS.
2. **Import `VBox` is already present** ([Menu.ts:8](../src/typescript/lib/core/Menu.ts#L8)); confirm `setOverflowing` reachability. If `protected`, widen to `public` on `LayoutManager` and adjust the one-line JSDoc.
3. **Enable vertical scroll in chrome setup.** In `applyRebuildChrome()` and `applyPersistentChrome()`, after the existing `setContain("layout")`, call `this.setOverflowY("auto")` and forward `setOverflowing(false, true)` to the VBox. Keep `setContain("layout")`.
4. **Add `applyViewportHeightClamp(resolvedTop, contentHeight)`** private helper as specified.
5. **Rewire `show()`** to resolve `x`/`y` first, then call the helper with the resolved `top`, removing the standalone `setHeight(totalHeight)` (the helper now owns it).
6. **Rewire `open()`** (both the submenu and top-level branches) to call the helper after `setY`, inside the existing `setAutoCommitStyle` bracket; remove the standalone `setHeight(totalHeight)` at [Menu.ts:234](../src/typescript/lib/core/Menu.ts#L234).
7. **Verify the layout pass.** Because `setMaxSize` then `setHeight` precede `scheduleLayout()`/`doLayout()`, confirm the VBox lays children past the clamped inner height (overflow flag) and the native scrollbar shows. The `setContain("layout")` already on the panel keeps the scroll container's layout isolated.
8. **Regression grep:** `grep -n "setHeight(totalHeight)" src/typescript/lib/core/Menu.ts` — expect zero matches (both replaced by the helper).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Menu.ts` |
| Modify (only if `setOverflowing` must be widened) | `src/typescript/lib/layout/LayoutManager.ts` |

---

## Verification

- **Typecheck:** `npm run build` (or the project's tsc task) — zero errors.
- **Grep invariant:** `grep -n "setHeight(totalHeight)" src/typescript/lib/core/Menu.ts` — zero matches.
- **Manual smoke (rebuild mode):** MiscPanel installs a right-click context menu ([src/typescript/MiscPanel.ts:480](../src/typescript/MiscPanel.ts#L480)). Add enough items (or temporarily pad the list) that the menu exceeds the viewport, then right-click near the **bottom** of the screen: the menu must clamp to the room above/below the cursor and show a vertical scrollbar reaching every item. Right-click near the **top**: menu extends downward, clamps at the bottom margin, scrolls. Resize the window shorter and re-open to confirm the clamp tracks the current viewport.
- **Manual smoke (persistent mode):** Open a `MenuBar` dropdown tall enough to overflow; confirm it clamps and scrolls. Hover an item with a submenu — the submenu opens against its own clamp (it is itself a `Menu`, so it inherits the fix).
- **Theme toggle:** flip light/dark; the existing context-menu and menu-bar tokens are untouched, so only confirm no visual regression (no new tokens added).
- **Scrollbar visibility:** with a short menu that fits, confirm **no** scrollbar appears (`overflow-y: auto`, not `scroll`).

---

## Potential Challenges

- **Resolved-position vs raw-input height room.** Using the raw `y` instead of the clamped `top` would over-clamp a bottom-anchored menu. Mitigation: the helper takes the already-resolved top; both call sites pass the post-`setY` value.
- **`setMaxSize` persisting across `show()` calls.** Rebuild-mode menus are reused; a tall menu's `maxSize.height` would wrongly cap a later short menu opened higher up. Mitigation: the helper recomputes and re-sets `maxSize` on every `show()`/`open()`, so each call overwrites the previous cap. Verify `setMaxSize` overwrites rather than merges.
- **`setOverflowing` visibility.** It is `protected` on `LayoutManager`. Mitigation: widen to `public` if `Menu` can't reach it — it is an intended host→manager hook, already driven by `Panel`.
- **VBox preferred-height interaction.** `getPreferredSize().height` is still the *content* height (unclamped) and must stay so — the clamp lives only on `maxSize`/`setHeight`, never on the preferred-size measurement, or the scrollable content would be measured short. Mitigation: do not touch `getPreferredSize`; only set `maxSize` after measuring.

---

## Critical Files

- [src/typescript/lib/core/Menu.ts](../src/typescript/lib/core/Menu.ts) — the component; both `show()` and `open()` size/position logic, plus `applyRebuildChrome`/`applyPersistentChrome`.
- [src/typescript/lib/core/Panel.ts:216](../src/typescript/lib/core/Panel.ts#L216) — `setAutoScroll("y")` is the reference pair (`setOverflowY("auto")` + `setOverflowing(false,true)`) the menu replicates.
- [src/typescript/lib/layout/LayoutManager.ts:136](../src/typescript/lib/layout/LayoutManager.ts#L136) — `setOverflowing` and the `_overflowing` flags consumed by `VBox.doLayout`.
- [src/typescript/lib/core/Component.ts:2558](../src/typescript/lib/core/Component.ts#L2558) — `setHeight`/`clampHeight`/`clampsToContentSize`; confirms `maxSize.height` is the lever.
- [src/typescript/lib/core/Util.ts:426](../src/typescript/lib/core/Util.ts#L426) — `getViewportSize`, the only viewport-dimension source (no dedicated clamp helper exists; positioning reads this directly).

---

## Non-Goals

- **Horizontal scrolling.** Menus are fixed-width; only vertical overflow is in scope. The new `maxSize` leaves width unconstrained.
- **Keyboard-nav scroll-into-view.** When `focusNext`/`focusPrev` ([Menu.ts:358](../src/typescript/lib/core/Menu.ts#L358)) move focus to an item below the fold in a scrolled persistent menu, the active item is not auto-scrolled into view. Native focus would scroll the overflow container, but `setFocused` is a class toggle, not DOM `focus()`, so it won't. This is a known follow-up; called out so the implementer doesn't assume it's handled. (Rebuild-mode menus have no keyboard nav.)
- **Re-clamping on live window resize while open.** A menu open during a viewport resize keeps its original clamp; menus are short-lived (dismiss on outside click/Escape), so re-measuring on `resize` is not worth a viewport listener. Re-opening picks up the new viewport.
- **Custom scrollbar chrome / scroll shadows.** The native `overflow-y: auto` scrollbar is used as-is; the `Panel` scroll-shadow overlay is intentionally not pulled in.
- **Submenu repositioning relative to a scrolled parent.** A submenu anchors to its `MenuItem`'s current on-screen rect ([Menu.ts:630](../src/typescript/lib/core/Menu.ts#L630)); if the parent is scrolled, the rect already reflects the scrolled position, so this works without extra code — but no special handling is added for a submenu whose anchor item is scrolled partly out of view.
