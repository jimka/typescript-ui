---
depends-on: [shared-clamp-timer-size-sentinel-utils]
touches-shared: [src/typescript/lib/core/LayerManager.ts, src/typescript/lib/core/AnimatedDropdown.ts]
---

# Overlay Positioning & Event Consolidation — Implementation Plan

## Overview

The overlay family (`src/typescript/lib/overlay/` plus the two shared core anchors
[`core/LayerManager.ts`](src/typescript/lib/core/LayerManager.ts#L1) and
[`core/AnimatedDropdown.ts`](src/typescript/lib/core/AnimatedDropdown.ts#L1)) has drifted
apart in four ways: two components reach into a child component's DOM events through the
`Event` API (an ARCHITECTURE.md violation), `Menu` reimplements the entire dismissal /
z-order machinery that `LayerManager` already owns for every other overlay, portal-mount
and viewport-clamp arithmetic is copy-pasted across seven overlays, and a scatter of
inline-arrow listeners, undocumented z-index literals, dead code, and stale docs violate
the code conventions.

This plan (1) fixes the two `Event`-bypass rule violations by routing through the child's
own `on("action", …)` surface; (2) makes `Menu` a first-class `DismissableLayer` so it
joins the layer tree instead of rolling its own pointerdown/blur dismissal and hardcoded
z-index — the single largest change, and the one with real behavioural consequences;
(3) extracts one portal-mount primitive (`LayerManager.mount`) and one pure
anchor/flip/clamp positioning primitive (`core/OverlayPosition.ts`) that
[`AnimatedDropdown.placeAnchored`](src/typescript/lib/core/AnimatedDropdown.ts#L355),
[`Popover._reposition`](src/typescript/lib/overlay/Popover.ts#L614), and
[`Menu`](src/typescript/lib/overlay/Menu.ts#L227) consume; and (4) cleans up the
remaining convention violations (named listeners, banded z-index, dead code, docs).

It depends on the `shared-clamp-timer-size-sentinel-utils` plan for `Util.clamp` — this
plan consumes that clamp for all viewport arithmetic and does **not** add its own.

---

## Architecture Decisions

### `Menu` becomes a `DismissableLayer`; it stops owning dismissal and z-order

Every other interactive overlay (`AnimatedDropdown`, `Popover`, `Dialog`, `AbstractWindow`)
registers with `LayerManager` and lets the manager own the document-level `pointerdown` /
`focusin` / `keydown` / window-`blur` handlers, the z-index band stamp, and the
cross-portal containment decision. `Menu` alone opts out: it installs its own viewport
`pointerdown` + `blur` listeners ([`Menu.ts:294-295`](src/typescript/lib/overlay/Menu.ts#L294)),
its `_onWindowBlur` ([`Menu.ts:158-168`](src/typescript/lib/overlay/Menu.ts#L158)) is a
verbatim copy of `LayerManager.onWindowBlur`
([`LayerManager.ts:512-518`](src/typescript/lib/core/LayerManager.ts#L512)), its
`containsTarget` recursion ([`Menu.ts:820`](src/typescript/lib/overlay/Menu.ts#L820))
duplicates `LayerManager.containsAcrossLayers`, and it hardcodes z-index `9999` /`10000`
([`Menu.ts:672`](src/typescript/lib/overlay/Menu.ts#L672),
[`Menu.ts:689`](src/typescript/lib/overlay/Menu.ts#L689)) outside the `Band` allocator.

Because it is not in the layer tree, two latent correctness bugs exist: (a) a context menu
opened inside a modal `Dialog` (band `11000`) paints at `z 10000`, **behind** the dialog;
(b) a `"blur"`/`"click-outside"` `Popover` treats a `pointerdown` inside a `Menu` opened
over it as "outside" and self-dismisses, because the manager never learns the two overlays
are related. Registering `Menu` as a layer fixes both structurally: a menu opened while a
dialog is topmost registers as the dialog's child and inherits its band (rendering above
it), and cross-portal containment keeps the popover open. `Menu` keeps its two-mode
(rebuild / persistent) public surface and its submenu chain unchanged; only the dismissal
mechanism moves to the manager.

### The positioning primitive is a pure module, not a method on a base class

`AnimatedDropdown.placeAnchored` is an instance method on a `Component` base that `Menu`
and `Popover` do not extend, so it cannot be shared as-is. The anchor/flip/clamp math is
pure geometry over `Rect` / `Size`, so it belongs in a new **pure** module
`core/OverlayPosition.ts` (no DOM access — the viewport is passed in), which makes it
directly unit-testable in the offline harness and keeps it free of any layer-tree or DOM
coupling. `placeAnchored` becomes a thin wrapper that reads the viewport and its own size,
delegates to `positionAnchored`, and applies the result via `setX` / `setY`.

### `Popover`'s arrow-coupled placement stays specialized; it consumes only the shared clamp

`Popover._reposition` picks one of four sides with an arrow-gap budget, centres on the
anchor, and clamps with **per-side** arrow insets (`minX += ARROW_VISUAL_HALF`, …). Folding
that through `positionAnchored`'s uniform two-axis flip/clamp would *relocate* the arrow
geometry into the shared primitive rather than remove complexity — the "compose only when
it reduces total code" test in ARCHITECTURE.md (*Compose before specializing*) fails here.
So `Popover` keeps its bespoke placement, but replaces its hand-rolled
`Math.max(min, Math.min(v, max))` clamps ([`Popover.ts:673-674`](src/typescript/lib/overlay/Popover.ts#L673))
with `Util.clamp`, and mounts through `LayerManager.mount`.

### `LayerManager.mount(handle)` owns the portal-append idiom

The "append to `documentElement` if not already contained" block is copy-pasted at seven
sites. It is a layer-lifecycle concern (a portaled surface joining the document root), so
it lives on `LayerManager` next to `register`/`unregister`. It does **not** register the
layer — surfaces still call `register` explicitly — it only owns the DOM append so no call
site re-derives the containment guard.

### `Notification` keeps its bespoke slide animation

`Notification.dismiss`/`finishDismiss` ([`Notification.ts:447-483`](src/typescript/lib/overlay/Notification.ts#L447))
resemble `fadeHideAndDetach`, but the transform is a horizontal `translateX(100%)` slide,
not the dropdown family's small vertical `translateY(-Npx)` fade, and `FadeOptions` exposes
no transform/axis override. Reusing the helper would require widening `FadeOptions` with a
transform knob used by exactly one caller — speculative surface the conventions forbid. The
redundancy is noted but **not** removed; only `Notification`'s listener wiring and z-index
are touched.

---

## Public API

No consumer-facing API changes. New/changed **internal** surface:

```typescript
// core/LayerManager.ts — new namespace function
export namespace LayerManager {
    /**
     * Appends a portaled overlay element to `document.documentElement` if it is
     * not already contained there. The single home for the "portal mount" idiom.
     */
    export function mount(el: Handle): void;
}
```

```typescript
// core/OverlayPosition.ts — new pure module (no DOM writes; viewport passed in)
import { Util } from "~/core/Util.js";
import type { Rect } from "~/core/DOM.js";
import type { Size } from "~/primitive/Size.js";

export type AnchorAxis = "vertical" | "horizontal";

export interface AnchorOptions {
    /** Primary growth axis: "vertical" grows below/above, "horizontal" right/left. */
    axis:    AnchorAxis;
    /** Gap in px between the anchor edge and the element on the primary axis. Default 0. */
    gap?:    number;
    /** Viewport-edge margin in px kept on the cross axis. Default 0. */
    margin?: number;
}

/**
 * Places an element of `size` against `anchorRect` inside `viewport`. On the
 * primary axis it grows past the anchor's far edge (below / right), flipping to
 * the near edge (above / left) only when the far side lacks room AND the near
 * side has more; on the cross axis it aligns to the anchor's near edge and
 * clamps into the viewport. Pure — all viewport reads are supplied by the caller.
 */
export function positionAnchored(anchorRect: Rect, size: Size, viewport: Size, opts: AnchorOptions): { x: number; y: number };

/**
 * Clamps a top-left point so an element of `size` stays within
 * `[margin, extent - size - margin]` on both axes. Used by cursor-anchored
 * overlays (context menu, tooltip) that clamp without flipping.
 */
export function clampIntoViewport(x: number, y: number, size: Size, viewport: Size, margin?: number): { x: number; y: number };
```

```typescript
// overlay/Menu.ts — Menu now implements DismissableLayer
class Menu extends Component implements DismissableLayer {
    getLayerElement(): Handle | null;
    getDismissMode(): LayerDismissMode;   // "click-outside" in both modes
    requestClose(): void;                 // routes to dismissAll() (mode-aware)
    getAnchorElement(): Handle | null;    // returns _excludedEl
    getBand(): number;                    // LayerManager.Band.Dropdown
    onZIndexChanged(zIndex: number): void; // setZIndex mirror for bringToFront
}
```

---

## Internal Structure

### `positionAnchored` body (the generalization of `placeAnchored`'s vertical block)

```typescript
export function positionAnchored(anchorRect, size, viewport, opts) {
    const gap    = opts.gap ?? 0;
    const margin = opts.margin ?? 0;

    if (opts.axis === "vertical") {
        const y = flipAxis(anchorRect.top, anchorRect.bottom, size.height, viewport.height, gap);
        const x = Util.clamp(anchorRect.left, margin, viewport.width - size.width - margin);

        return { x, y };
    }

    const x = flipAxis(anchorRect.left, anchorRect.right, size.width, viewport.width, gap);
    const y = Util.clamp(anchorRect.top, margin, viewport.height - size.height - margin);

    return { x, y };
}

// Private: choose the far side (near.far + gap) if the element fits there or the far
// side has more room; else the near side (near - extent - gap); saturate to keep it
// on-screen. Mirrors placeAnchored's spaceBelow/spaceAbove decision, axis-agnostic.
function flipAxis(nearEdge, farEdge, extent, viewportExtent, gap): number { … }
```

`Menu.placeVertically` ([`Menu.ts:751`](src/typescript/lib/overlay/Menu.ts#L751)) collapses
onto `flipAxis` plus its existing `applyViewportHeightClamp` height-cap call. Keep
`placeVertically` as the caller that owns the height clamp; have its body derive the top
via the shared flip so the two menus (top-level, submenu) and `placeAnchored` share one
flip implementation. (Note: `tests/overlay/Menu.test.ts` bracket-accesses
`placeVertically` — preserve its signature/semantics or update that test in lockstep.)

### `Menu` DismissableLayer wiring

- **Remove** the `_onViewportPointerDown` / `_onWindowBlur` fields
  ([`Menu.ts:83-84`, `139-168`](src/typescript/lib/overlay/Menu.ts#L139)) and the
  `Event.addViewportListener` / `removeViewportListener` pairs in `show`/`open`/`hide`/`close`
  ([`Menu.ts:294-295`, `350-351`, `468-469`, `486-487`](src/typescript/lib/overlay/Menu.ts#L294)).
  **Remove** `containsTarget` ([`Menu.ts:820`](src/typescript/lib/overlay/Menu.ts#L820)) — its
  only callers were the two removed handlers; cross-portal containment now comes from the
  manager's `containsAcrossLayers` over the child-submenu layer nodes.
- `show` / `open` call `LayerManager.register(this)`, then `this.setZIndex(LayerManager.getZIndex(this))`;
  `hide` / `close` call `LayerManager.unregister(this)`.
- `getDismissMode()` returns `"click-outside"` in both modes (pointerdown-outside + window-blur
  dismissal, no focusin — matching the current behaviour exactly).
- `requestClose()` routes through the existing `dismissAll()`
  ([`Menu.ts:899`](src/typescript/lib/overlay/Menu.ts#L899)) so persistent mode fires
  `_onClose` and rebuild mode calls `hide()` — the same mode-aware split the old handlers used.
- `getAnchorElement()` returns `_excludedEl`, so the opener/trigger stays excluded from the
  outside-pointerdown test (replacing the manual `_excludedEl` containment checks in the
  removed handlers).
- `getBand()` returns `LayerManager.Band.Dropdown`; the `9999`/`10000` literals leave
  `applyPersistentChrome`/`applyRebuildChrome` — the manager stamps z at show time and a
  nested menu inherits its opener's band.
- A submenu opened via `open(item, this)` registers while the parent menu is topmost, so it
  links under the parent in the layer tree; `containsAcrossLayers` then keeps the parent open
  for a pointerdown inside the submenu (replacing the old `submenuPanel.setExcludedElement(parentEl)`
  guard, which becomes redundant — evaluate dropping it).

---

## Ordered Implementation Steps

1. **Confirm the dependency landed.** `grep -n "export function clamp" src/typescript/lib/core/Util.ts`
   — expect a hit (from `shared-clamp-timer-size-sentinel-utils`). If absent, stop: this plan consumes it.

2. **Create `core/OverlayPosition.ts`.** Pure module: `positionAnchored`, `clampIntoViewport`,
   private `flipAxis`. Consume `Util.clamp`. No DOM access. Full JSDoc per conventions;
   document the axis/gap/margin defaults.

3. **Add `LayerManager.mount(el: Handle): void`** in `core/LayerManager.ts` — the
   containment-guarded `DOM.sink.appendChild(DOM.source.getDocumentElement(), el)` block.

4. **Route all seven portal-mount sites through `LayerManager.mount`:**
   [`AnimatedDropdown.ts:230`](src/typescript/lib/core/AnimatedDropdown.ts#L230),
   [`Popover.ts:471`](src/typescript/lib/overlay/Popover.ts#L471),
   [`Menu.ts:289`](src/typescript/lib/overlay/Menu.ts#L289) and
   [`Menu.ts:414`](src/typescript/lib/overlay/Menu.ts#L414),
   [`Tooltip.ts:222`](src/typescript/lib/overlay/Tooltip.ts#L222),
   [`Notification.ts:205`](src/typescript/lib/overlay/Notification.ts#L205),
   [`Dialog.ts:697-700`](src/typescript/lib/overlay/Dialog.ts#L697) (backdrop + dialog),
   [`AbstractWindow.ts:615`](src/typescript/lib/overlay/AbstractWindow.ts#L615). Verify each
   site's guard semantics match (Notification/Tooltip append unconditionally today — mount's
   idempotent guard is safe for them).

5. **Rewrite `AnimatedDropdown.placeAnchored`** ([`:355`](src/typescript/lib/core/AnimatedDropdown.ts#L355))
   to read `getViewportSize()` + own size, call `positionAnchored(rect, size, vp, { axis: "vertical" })`,
   and apply `setX`/`setY`. Run the four picker dropdowns
   (`ComboBox`, `AutoCompleteDropdown`, `AbstractCalendarDropdown`, `TimePickerDropdown`) — no
   call-site changes expected (signature unchanged).

6. **Fix Rule Violation #1 — `Popover.addAction`.** Replace
   [`Popover.ts:405`](src/typescript/lib/overlay/Popover.ts#L405)
   `Event.addListener(button, "click", onClick)` with `button.on("action", onClick)`
   (`ClickListener` accepts a `() => void`). Drop the now-unused `Event` import if nothing else
   in `Popover.ts` uses it (it still uses `Event.addViewportListener` — keep).

7. **Popover viewport clamp → `Util.clamp`.** Replace the two
   `Math.max/Math.min` clamps at [`Popover.ts:673-674`](src/typescript/lib/overlay/Popover.ts#L673)
   with `Util.clamp`. Leave the per-side arrow-inset logic intact.

8. **Fix dead code #7 — `Popover.resolvePlacement`.** At
   [`Popover.ts:739-740`](src/typescript/lib/overlay/Popover.ts#L739) the branch already knows
   `this._placement` is a concrete side (it passed `fits(this._placement)`); return `this._placement`
   directly, dropping the dead `?? this._defaultOptions.placement!`.

9. **Rewrite `Menu` as a `DismissableLayer`** (the largest step — see *Internal Structure*):
   implement the five `DismissableLayer` methods + `onZIndexChanged`; register/unregister in
   `show`/`open`/`hide`/`close`; delete the two custom handlers, their fields, and
   `containsTarget`; stamp z from the manager; drop the `9999`/`10000` literals. Re-express
   `Menu.show` (context/point) positioning via `clampIntoViewport` and the top-level/submenu
   `open` branches + `placeVertically` via the shared `flipAxis`.

10. **Fix z-index #5.** Confirm no bare `9999`/`10000` remains in `Menu.ts`:
    `grep -nE '\b(9999|10000)\b' src/typescript/lib/overlay/Menu.ts` — expect zero.

11. **Fix dead param #7 — `Menu.fadeIn`.** Drop the unused `_el` param at
    [`Menu.ts:518`](src/typescript/lib/overlay/Menu.ts#L518) and the two call args
    ([`Menu.ts:292`, `466`](src/typescript/lib/overlay/Menu.ts#L292)).

12. **Fix stale JSDoc #8 — `Menu`.** The orphaned block at
    [`Menu.ts:766-770`](src/typescript/lib/overlay/Menu.ts#L766) ("Builds the item list …
    @param items") belongs to `buildPersistentItems`
    ([`Menu.ts:795`](src/typescript/lib/overlay/Menu.ts#L795)); move it there. Leave the
    `rebuildPersistentItems` block ([`Menu.ts:771-778`](src/typescript/lib/overlay/Menu.ts#L771)) attached to that method.

13. **Fix Rule Violation #2 + inline arrows #6 — `Notification`.** Replace
    [`Notification.ts:166`](src/typescript/lib/overlay/Notification.ts#L166)
    `Event.addListener(this._closeButton, "click", …)` with
    `this._closeButton.on("action", this._boundOnCloseAction)`, where
    `_boundOnCloseAction` is a named field `(e: MouseEvent) => { e.stopPropagation(); this.dismiss(); }`
    (the raw `MouseEvent` is forwarded by `Button.on("action")`, so the dblclick-suppressing
    `stopPropagation()` is preserved). Convert the three inline-arrow subtree listeners
    ([`Notification.ts:173`, `184`, `185`](src/typescript/lib/overlay/Notification.ts#L173))
    to named bound fields (`_boundOnDblClick`, `_boundOnMouseOver`, `_boundOnMouseOut`).

14. **Fix z-index #5 — `Notification`.** Route the `Z_INDEX = 10002` literal
    ([`Notification.ts:74`](src/typescript/lib/overlay/Notification.ts#L74)) through
    `LayerManager.Band` or document the constraint per the magic-number convention.
    `Notification` is not a registered layer; the cleanest fix is a documented constant
    referencing the band ordering (e.g. "above Dialog `11000`, below Tooltip `12000`"), or
    add a `Band.Notification` if the ordering deserves a named slot. **Decision to make in
    implementation:** prefer documenting against the existing `Band` values over inventing a
    new band unless a second notification-band consumer appears.

15. **Fix inline arrows #6 — `AbstractWindow`.** Replace the eight
    `.on("drag", (border, e) => this.onResize(border, e))` calls
    ([`AbstractWindow.ts:282-289`](src/typescript/lib/overlay/AbstractWindow.ts#L282)) with a
    single named bound field `_boundOnBorderResize = (border: WindowBorder, e: MouseEvent) => this.onResize(border, e)`
    passed to all eight. Replace the subtree listener at
    [`AbstractWindow.ts:307`](src/typescript/lib/overlay/AbstractWindow.ts#L307)
    `() => this.bringToFront()` with a named bound field `_boundOnBringToFront`.

16. **Fix stale JSDoc #8 — `Dialog.getTitleBar`.** The block at
    [`Dialog.ts:998-1005`](src/typescript/lib/overlay/Dialog.ts#L998) says the title bar exposes
    `getText()`; the real accessor is `getTitleText()` ([`Dialog.ts:215`](src/typescript/lib/overlay/Dialog.ts#L215)).
    Correct both occurrences of `getText` in that JSDoc to `getTitleText`.

17. **Tighten types #7 — `Tooltip.TooltipAttachment`.** At
    [`Tooltip.ts:31-38`](src/typescript/lib/overlay/Tooltip.ts#L31) replace the four
    `Function`-typed listener fields with precise signatures mirroring `ElementTooltipAttachment`
    ([`Tooltip.ts:41-50`](src/typescript/lib/overlay/Tooltip.ts#L41)):
    `mouseoverFn: (e: MouseEvent) => void`, `mousemoveFn: (e: MouseEvent) => void`,
    `mouseoutFn: () => void`, `mousedownFn: () => void`.

18. **Route Tooltip's cursor clamp** ([`Tooltip.ts:212-216`](src/typescript/lib/overlay/Tooltip.ts#L212))
    through `clampIntoViewport` (offset applied by the caller, then clamp). Consume the shared
    primitive; do not add a bespoke clamp.

19. **Document the deliberate Tooltip non-`callable()` export #8.** Add a one-line comment at
    [`Tooltip.ts:65`](src/typescript/lib/overlay/Tooltip.ts#L65) / the export noting the
    private-ctor singleton is an intentional exception to the `callable()`-wrap rule (no change
    to `index.ts:10`). This is documentation only.

20. **Regression sweep.**
    - `grep -rn 'Event.addListener([^,]*button\|Event.addListener(this._closeButton' src/typescript/lib/overlay` — expect zero (no listening on a child's `Event` surface).
    - `grep -rnE '\bDOM\.sink\.appendChild\(DOM\.source\.getDocumentElement' src/typescript/lib/overlay src/typescript/lib/core/AnimatedDropdown.ts` — expect only `LayerManager.mount`'s definition.
    - `npm run typecheck` (or the project's `tsc` gate), `npm run test`, `npm run docs:build` (zero warnings — public JSDoc touched in Dialog/Tooltip).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/OverlayPosition.ts` |
| Modify | `src/typescript/lib/core/LayerManager.ts` (add `mount`) |
| Modify | `src/typescript/lib/core/AnimatedDropdown.ts` (mount, `placeAnchored` via `positionAnchored`) |
| Modify | `src/typescript/lib/overlay/Menu.ts` (DismissableLayer, positioning, dead code, JSDoc, z-index) |
| Modify | `src/typescript/lib/overlay/Popover.ts` (`on("action")`, `Util.clamp`, mount, dead `??`) |
| Modify | `src/typescript/lib/overlay/Notification.ts` (`on("action")`, named listeners, mount, z-index) |
| Modify | `src/typescript/lib/overlay/Tooltip.ts` (precise types, `clampIntoViewport`, mount, callable comment) |
| Modify | `src/typescript/lib/overlay/AbstractWindow.ts` (named listeners, mount) |
| Modify | `src/typescript/lib/overlay/Dialog.ts` (mount ×2, `getTitleText` JSDoc fix) |
| Modify (if needed) | `tests/overlay/Menu.test.ts` (if `placeVertically` signature changes) |
| Add tests | `tests/overlay/OverlayPosition.test.ts` (new), extend `Menu.test.ts` / `LayerManager.test.ts` for Menu-as-layer |

---

## Expected Behaviour

### `positionAnchored` / `clampIntoViewport` (pure — **unit-testable**)

- Vertical anchor with room below: element top lands at `anchorRect.bottom + gap`.
- Vertical anchor, no room below but room above: flips to `anchorRect.top - height - gap`.
- Vertical anchor, no room either side: saturates on-screen (`0` or `viewport - size`), never negative overflow.
- Horizontal anchor mirrors the above on the x-axis (right preferred, flip left).
- Cross axis aligns to the anchor near edge and clamps into `[margin, viewport - size - margin]`.
- `clampIntoViewport` never returns a coordinate `< margin` or `> extent - size - margin`; a point already inside is returned unchanged.
- `placeAnchored` produces the **same** x/y it did before the refactor for a representative anchor (regression: assert against the pre-change formula).

### `Menu` as `DismissableLayer`

- A context menu opened by right-click inside a **modal `Dialog`** paints **in front of** the
  dialog (inherits the Dialog band via nested registration). *(**MANUAL/live** — z-order stacking is not offline-observable.)*
- A `"blur"` or `"click-outside"` `Popover` that spawns a `Menu` (e.g. a `SplitButton`
  chevron menu) **stays open** when the user clicks inside that menu (cross-portal containment). *(**MANUAL/live** — pointer/portal interaction.)*
- Outside-`pointerdown` dismissal still fires for both rebuild and persistent menus; the
  opener/trigger (`_excludedEl` → `getAnchorElement`) does not self-close the menu. *(Registration/`getAnchorElement` wiring is **unit-testable** via the `FakeLayer`-style harness; the pointer routing is **MANUAL/live**.)*
- Window-blur (alt-tab / clicking another app) still dismisses an open menu (manager's
  `onWindowBlur` acts on `"click-outside"` layers). *(**MANUAL/live**.)*
- A submenu open over its parent keeps the parent open on a pointerdown inside the submenu;
  activating a submenu leaf still closes the whole chain (`dismissAll` via `requestClose`/`_onClose`). *(**MANUAL/live**.)*
- **New behaviour to verify:** Escape now routes through `LayerManager.onKeyDown` and closes
  the topmost menu. Confirm this does not double-fire with `MenuBar`'s own keyboard handling
  (a persistent menu's `requestClose` → `_onClose` must be idempotent under a
  close-already-in-flight). *(**MANUAL/live** — keyboard + focus.)*
- `Menu.show`/`open`/`hide`/`close`/`toggleFor` mode-guard errors and rebuild/persistent
  disjointness are unchanged. *(**Unit-testable** — existing `Menu.test.ts` guards.)*

### Rule-violation fixes (behaviour-preserving)

- `Popover.addAction` button click still invokes `onClick`; no visible change. *(**Unit-testable** via `Button`'s action dispatch; click routing **MANUAL/live**.)*
- `Notification` × close button still dismisses the toast **and** a click on it does not
  trigger the body double-click detail dialog (`stopPropagation` preserved through `on("action")`). *(**MANUAL/live** — click vs dblclick timing.)*
- `AbstractWindow` resize borders still resize; `mousedown` still brings the window to front
  (named refs are behaviourally identical to the arrows). *(**MANUAL/live** — drag.)*

### Cleanups (no behaviour change)

- Dead-param `Menu.fadeIn`, dead `?? default` in `Popover.resolvePlacement`, tightened
  `TooltipAttachment` types, corrected Dialog/Menu JSDoc, `Notification` z-index doc — all
  compile-and-render identically. *(**Unit-testable**: typecheck + `docs:build` zero warnings.)*

---

## Verification

- `npm run typecheck` — clean.
- `npm run test` — existing `tests/overlay/{Menu,Popover,Notification,Tooltip,LayerManager,AnimatedDropdown}.test.ts` pass; new `OverlayPosition.test.ts` covers the pure-primitive cases above; extend `Menu.test.ts` to assert `Menu` registers/unregisters with `LayerManager` and reports `getDismissMode()==="click-outside"`, `getBand()===Band.Dropdown`, and `getAnchorElement()===_excludedEl`.
- `npm run docs:build` — zero warnings (public JSDoc touched in `Dialog.getTitleBar`, `Tooltip`).
- Grep invariants from Step 20.
- **Manual smoke (`npm run dev`, http://localhost:8015):** the MANUAL cases above — right-click
  a context menu inside a modal dialog (must paint in front); open a `SplitButton`/`Popover`
  menu and click inside it (popover must stay); Escape-close a menu and a menubar dropdown;
  Notification close-button vs body-dblclick; window resize + bring-to-front.

---

## Potential Challenges

- **`Menu` + `MenuBar` keyboard interplay.** `LayerManager.onKeyDown` will now call
  `requestClose` on Escape for the topmost menu; `MenuBar` may already handle Escape. Make
  `requestClose`/`dismissAll` idempotent and verify no double-close or focus flicker.
- **Submenu registration order.** A submenu must register *while its parent is topmost* so the
  tree links it under the parent; ensure `open()` calls `register` before anything that could
  register another layer. The old `setExcludedElement(parentEl)` guard becomes redundant —
  confirm before removing it.
- **`placeVertically` is bracket-accessed by a test.** Changing its signature breaks
  `Menu.test.ts`; keep the signature or update the test in the same change.
- **Notification unconditional append vs `mount`'s guard.** `Notification`/`Tooltip` currently
  append unconditionally each show; `mount`'s idempotent containment guard is safe but verify
  the re-show path (a toast re-shown after detach) still re-appends.
- **`Popover` still importing `Event`.** After the `on("action")` swap, `Popover` still uses
  `Event.addViewportListener`; do not remove the import.

---

## Critical Files

- [`core/LayerManager.ts`](src/typescript/lib/core/LayerManager.ts) — the layer tree, band
  allocator, `containsAcrossLayers`, and the document-level handlers `Menu` now delegates to.
- [`core/AnimatedDropdown.ts`](src/typescript/lib/core/AnimatedDropdown.ts) — `placeAnchored`
  (the primitive being generalized), `fadeShow`/`fadeHideAndDetach`, the `DismissableLayer`
  reference implementation.
- [`overlay/AbstractWindow.ts`](src/typescript/lib/overlay/AbstractWindow.ts) — the other
  `DismissableLayer` shape and the inline-arrow listeners.
- [`overlay/Menu.ts`](src/typescript/lib/overlay/Menu.ts) — the component being converted.
- [`overlay/Dialog.ts`](src/typescript/lib/overlay/Dialog.ts) — the `on("action")` reference
  pattern ([`:206`](src/typescript/lib/overlay/Dialog.ts#L206), [`:364`](src/typescript/lib/overlay/Dialog.ts#L364)) and modal-band nesting `Menu` must stack above.
- `ARCHITECTURE.md` (*Event handling* — the `Event`-bypass and named-listener rules;
  *Positioning is always absolute* — the `Position.FIXED` overlay carve-out) and
  `CODE_CONVENTIONS.md` / global conventions (magic numbers, JSDoc).
- The dependency plan `plans/shared-clamp-timer-size-sentinel-utils.md` — source of `Util.clamp`.

---

## Non-Goals

- **No lifecycle-verb or event-name renames** (`show`/`hide` vs `open`/`close`,
  `"activate"` vs `"activated"`, …) — reserved for `api-naming-harmonization`.
- **No `Util.clamp` creation** — consumed from `shared-clamp-timer-size-sentinel-utils`.
- **No auto-repeat / timer utility changes** — reserved for the shared-clamp plan.
- **No folding `Popover`'s arrow placement or `Notification`'s slide animation into shared
  helpers** — both would relocate rather than remove complexity (see Architecture Decisions).
- **No new public API** — every change is internal or convention/doc cleanup.
