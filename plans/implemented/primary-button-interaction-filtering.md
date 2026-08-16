---
touches-shared: [packages/lib/src/typescript/lib/core/Event.ts, packages/lib/src/typescript/lib/component/button/Button.ts]
---

# Primary-Button Interaction Filtering — Implementation Plan

## Overview

This plan documents the design of `feature/primary-button-interaction-filtering` and specifies the one remaining functional change it still needs.

Most of the branch is already implemented and committed or sitting in the worktree's uncommitted changes: [`Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) gained a per-registration `button: "primary" | "aux" | "any"` filter on `addListener` / `addSubtreeListener` (`addViewportListener` stays unfiltered, by design), an unrelated `stop`/`prevent` disposition floor, and roughly sixty converted call sites; [`Button.ts`](packages/lib/src/typescript/lib/component/button/Button.ts) moved its pressed-state visual off the native `:active` pseudo-class onto a JS-managed `.pressed` class. `## Ordered Implementation Steps` lists that work under *Already implemented* so a reader can see at a glance what needs no further action.

One thing is still broken. `Button`'s current `.pressed` tracking calls `DOM.sink.setPointerCapture` on every primary-button press ([Button.ts:407](packages/lib/src/typescript/lib/component/button/Button.ts#L407)), which retargets the eventual `click` to the button regardless of where the pointer actually released. That silently breaks drag-away-to-cancel — a real, load-bearing affordance the native `:active` + native `click` combination gave for free before this branch touched `Button`. This plan replaces the capture-based tracking with subtree `pointerdown`/`pointerover`/`pointerout` listeners plus a press-scoped pair of viewport `pointerup`/`pointercancel` listeners, and leaves `click` activation completely untouched so the browser's own release-time target recomputation keeps working.

Separately, `Event.ts`'s `BUTTON_FILTER_DEFAULTS` table — the "default to primary, except a short list gets `any`" model — has a real gap: `auxclick` isn't on the exceptions list, so a bare registration on it can never fire (`auxclick` never carries `button: 0`). This plan restructures the table into a small allowlist of press-initiating types that default to `"primary"`, with everything else defaulting to `"any"` — closing that gap and every future one like it.

---

## Architecture Decisions

### Activation keeps using the browser's native `click`

Nothing in this plan gates, suppresses, or synthesises the `click` that fires `Button`'s `"action"` event ([Button.ts:1645](packages/lib/src/typescript/lib/component/button/Button.ts#L1645), via `Event.fireEvent`/the DOM `click`). A press released away from the button therefore still cancels, because the browser recomputes the element under the pointer at release time and declines to fire `click`.[^native-click]

### `setPointerCapture` is dropped from Button's press tracking

`Button` stops calling `DOM.sink.setPointerCapture` / `hasPointerCapture` / `releasePointerCapture` entirely. The pressed state is tracked with subtree `pointerover` / `pointerout` on the button, plus a `pointerup` / `pointercancel` pair registered on the viewport only while a press is in progress.[^why-not-capture]

`Slider` keeps using `setPointerCapture` ([Slider.ts:545-599](packages/lib/src/typescript/lib/component/input/Slider.ts#L545)), and that stays correct there: a slider drag *wants* every subsequent pointer event retargeted to it, and a slider has no click-cancellation affordance to protect. A button has the opposite requirement.

### Boundary tracking mirrors Notification's `relatedTarget`-inside guard

A `pointerout` whose `relatedTarget` is still inside the button's element is an internal move between descendants, not a real leave. `Notification.acquireHoverHold` / `releaseHoverHold` already test this shape inline ([Notification.ts:373,397](packages/lib/src/typescript/lib/overlay/Notification.ts#L373)); `Button` gets its own private `_isInsideTarget` helper built the same way.

### Release is tracked with a press-scoped viewport listener pair

`pointerup` and `pointercancel` are registered with `Event.addViewportListener` when a press begins and removed when it ends, mirroring `Scrollbar._onDragStart` / `_onDragEnd`, which installs its `mousemove`/`mouseup` viewport pair at the start of a thumb drag and tears it down at the end ([Scrollbar.ts:923-989](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L923)).[^viewport-scoping] `baseViewportListener` never calls `passesButtonFilter` ([Event.ts:362-380](packages/lib/src/typescript/lib/core/Event.ts#L362)) — viewport listeners are never button-filtered, matching ARCHITECTURE.md's documented invariant — so the release handler's own `pointerId` equality check is what scopes it to the press that started it, not the dispatcher.

### A stale press heals on the next `pointerover`

When a press ends somewhere the framework never hears about — the pointer left the browser window before releasing — the next `pointerover` on the button checks the primary bit of `event.buttons` and ends the press if it's clear. `DiagramView._handlePointerMove` recovers from the same class of problem the same way ([DiagramView.ts:1707-1715](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1707)), though for a different reason: `DiagramView`'s pan listeners are subtree-scoped, so a release outside its own subtree is genuinely never seen. `Button`'s `pointerup` is viewport-scoped and already catches a release anywhere else in the document — this recheck only covers the narrower case of the pointer leaving the browser window entirely.

### Subtree dispatch for pointerdown closes the SplitButton-chevron gap

Switching `pointerdown` / `pointerover` / `pointerout` from exact-target `addListener` to `addSubtreeListener` means a press on a pointer-opaque descendant now reaches the button's own tracking, the same way `:active` bubbles through one. Two concrete cases were re-verified against the current code, not assumed from precedent:

- `SplitButton`'s chevron sets `pointerEvents: "auto"` so it can catch its own `click` independently of the button face ([SplitButton.ts:141](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L141)). Under the current exact-target design this is a deliberately accepted gap — a chevron press doesn't show the button pressed, documented at [Button.ts:626-636](packages/lib/src/typescript/lib/component/button/Button.ts#L626) and pinned by a test. Under subtree dispatch with no capture, the chevron's `pointerdown` climbs to the `SplitButton`'s own subtree listener and the button now shows pressed — closing the gap rather than widening it, since nothing about the chevron's independent `click` routing depends on capture.
- `TabButton` overlays a `TabCloseButton` by raw-appending its element onto the tab's own element ([TabButton.ts:291](packages/lib/src/typescript/lib/component/button/TabButton.ts#L291)), so the close button's element is a genuine DOM descendant of the tab's. A press on the close button now climbs to both: the close button's own subtree listener (registered on itself) and the tab's (registered on its ancestor element). Each `Button` instance tracks its own `_pressedPointerId` / `_pressedPointerInside` independently and shares no OS-level resource, so both presses coexist correctly — this is a return to `:active`'s pre-branch ancestor-bubbling behaviour, not a new regression.

### Keep the `"primary"` / `"aux"` / `"any"` naming

This branch's field is `button?: "primary" | "aux" | "any"`, already used across dozens of call sites, tests, and docs. This plan keeps those names throughout rather than introducing a differently-spelled alternative.[^naming-deviation]

### Restructure `Event.ts`'s button-filter defaults from an exceptions map to an allowlist set

`BUTTON_FILTER_DEFAULTS` ([Event.ts:158-168](packages/lib/src/typescript/lib/core/Event.ts#L158)) is a `Map` from event type to `"any"`, covering `contextmenu` and the eight-member pointer move/cancel/capture-loss family; every type absent from the map falls back to `"primary"`. This plan replaces it with `PRIMARY_BUTTON_TYPES`, a `Set` of the six press-initiating types (`mousedown`, `mouseup`, `click`, `dblclick`, `pointerdown`, `pointerup`); every type absent from the set now defaults to `"any"`.[^defaults-bug] The dispatcher's hardcoded `click`-is-always-primary floor in `baseListener` ([Event.ts:268](packages/lib/src/typescript/lib/core/Event.ts#L268)) is untouched — it's a separate, unconditional mechanism.

| Event type | Old model's result | New model's result | Changed? |
|---|---|---|---|
| `mousedown` | `"primary"` (not in the exceptions map) | `"primary"` (in the allowlist) | No |
| `contextmenu` | `"any"` (in the exceptions map) | `"any"` (not in the allowlist) | No |
| `pointermove` | `"any"` (in the exceptions map) | `"any"` (not in the allowlist) | No |
| `mouseover` | `"primary"` (not in the exceptions map) | `"any"` (not in the allowlist) | Only for a hand-built or edge-case event carrying a non-zero `button`; a real browser `mouseover` always reports `button: 0` either way |
| `auxclick` | `"primary"` (not in the exceptions map) — so it could **never** fire | `"any"` (not in the allowlist) | Yes — the fix |

### Everything else stays as-is

The `stop`/`prevent` disposition floor (`applyDisposition`), `Button._onAuxMouseDown`'s middle-click autoscroll suppression, `_onSpaceDown` / `_onSpaceUp` / `_onBlur`'s keyboard handling, and the already-converted call sites are unaffected by this plan and need no changes.

---

## Internal Structure

### Event.ts — the allowlist

```typescript
/**
 * Event types whose bare registration means "primary button only" — the
 * gestures that actually initiate a press. Every other type defaults to
 * `"any"`: `contextmenu` (already the button-agnostic "open a menu" signal
 * — right-click, a keyboard context-menu key, a touch long-press), the
 * pointer move/cancel/capture-loss family (the Pointer Events spec reports
 * `button: -1`, "no button change", for all of them), the mouse-flavoured
 * half of that same family (`mousemove` / `mouseover` / `mouseout` /
 * `mouseenter` / `mouseleave`, whose `button` likewise never represents a
 * press), and `auxclick` (which by definition never carries `button: 0`,
 * so a `"primary"` default would mean a bare registration on it could
 * never fire).
 */
const PRIMARY_BUTTON_TYPES: ReadonlySet<string> = new Set([
    "mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup",
]);

/**
 * Applies a {@link ListenerOptions.button} filter to a dispatched event.
 * `undefined` (unset) resolves to `"primary"` for a type in
 * {@link PRIMARY_BUTTON_TYPES}, `"any"` for every other type.
 */
function passesButtonFilter(evnt: Event, type: string, filter: ListenerOptions["button"]): boolean {
    const effective = filter ?? (PRIMARY_BUTTON_TYPES.has(type) ? "primary" : "any");

    // ...unchanged below this line.
}
```

### Button.ts — press-tracking fields and handlers

Replaces [Button.ts:377-441](packages/lib/src/typescript/lib/component/button/Button.ts#L377) (the explanatory comment, `_pressedPointerId` / `_spaceHeld`, `_updatePressedClass`, `_onPointerDown`, `_onPointerRelease` — `_onAuxMouseDown` in between is untouched and stays where it is):

```typescript
// The pressed treatment is driven entirely by this `.pressed` class rather
// than the native `:active` pseudo-class — see the class doc comment for
// why. Tracking owns two axes: which pointer (if any) is holding the
// button down, and whether that pointer currently sits over the button —
// `.pressed` reads true only while both hold, or while Space is held,
// mirroring what native `:active` shows for a `<button>`. No pointer
// capture is acquired: capture would retarget `click` to this element
// regardless of where the pointer actually released, breaking drag-away-
// to-cancel. Release is instead tracked with a viewport `pointerup` /
// `pointercancel` pair installed only while a press is in progress.
private _pressedPointerId:     number | null = null;
private _pressedPointerInside: boolean = false;
private _spaceHeld:            boolean = false;

private _updatePressedClass(): void {
    const element = this.getElement();
    if (!element) {
        return;
    }

    const pressed = (this._pressedPointerId !== null && this._pressedPointerInside) || this._spaceHeld;
    DOM.sink.apply(element, { toggleClass: { pressed } });
}

/**
 * True when `related` (an event's `relatedTarget`) is inside this button's
 * own element — an internal move between descendants, not a real
 * boundary crossing. Mirrors `Notification.acquireHoverHold`'s inline
 * `relatedTarget`-inside guard (Notification.ts:373).
 */
private _isInsideTarget(related: unknown): boolean {
    const element = this.getElement();

    return element !== undefined && DOM.source.isNode(related) && DOM.source.contains(element, DOM.source.intern(related));
}

private readonly _onPointerDown: (e: PointerEvent) => void = (e) => {
    // Already tracking a press (a second finger, e.g.) — first one wins.
    if (this._pressedPointerId !== null) {
        return;
    }

    this._pressedPointerId     = e.pointerId;
    this._pressedPointerInside = true;

    Event.addViewportListener(this, "pointerup",     this._onPointerRelease);
    Event.addViewportListener(this, "pointercancel", this._onPointerRelease);

    this._updatePressedClass();
};

private readonly _onPointerOver: (e: PointerEvent) => void = (e) => {
    if (e.pointerId !== this._pressedPointerId) {
        return;
    }

    // The primary button is no longer held — it was released outside the
    // browser window, so no pointerup ever reached the viewport listener
    // below. Heal here, the next time the pointer crosses back onto the
    // button (mirrors DiagramView._handlePointerMove's buttons-bit recheck).
    if ((e.buttons & 1) === 0) {
        this._onPointerRelease(e);
        return;
    }

    this._pressedPointerInside = true;
    this._updatePressedClass();
};

private readonly _onPointerOut: (e: PointerEvent) => void = (e) => {
    if (e.pointerId !== this._pressedPointerId || this._isInsideTarget(e.relatedTarget)) {
        return;
    }

    this._pressedPointerInside = false;
    this._updatePressedClass();
};

private readonly _onPointerRelease: (e: PointerEvent) => void = (e) => {
    if (this._pressedPointerId !== e.pointerId) {
        return;
    }

    Event.removeViewportListener(this, "pointerup",     this._onPointerRelease);
    Event.removeViewportListener(this, "pointercancel", this._onPointerRelease);

    this._pressedPointerId     = null;
    this._pressedPointerInside = false;

    this._updatePressedClass();
};
```

`_onPointerRelease` is reused directly from `_onPointerOver`'s stale-recovery branch rather than factored into a separate `_beginPointerPress` / `_endPointerPress` pair: the event passed in already carries the matching `pointerId`, so `_onPointerRelease`'s own guard is exactly the right gate, and a second pair of wrapper methods would have exactly one caller each.[^no-extra-helpers]

Constructor wiring replaces [Button.ts:626-649](packages/lib/src/typescript/lib/component/button/Button.ts#L626):

```typescript
// Subtree, not exact-target: a press on a pointer-opaque descendant (e.g.
// SplitButton's chevron, or a TabCloseButton overlaid on a TabButton) must
// still show this button pressed, the way `:active` bubbles through one.
// This is safe now that no pointer capture is acquired — each Button
// instance tracks its own boundary state independently, with no shared
// OS-level resource for two instances to conflict over.
Event.addSubtreeListener(this, "pointerdown", this._onPointerDown);
Event.addSubtreeListener(this, "pointerover", this._onPointerOver);
Event.addSubtreeListener(this, "pointerout",  this._onPointerOut);
Event.addListener(this, "mousedown",   { button: "aux", handler: this._onAuxMouseDown });
Event.addListener(this, "keydown",       this._onSpaceDown);
Event.addListener(this, "keyup",         this._onSpaceUp);
// Native `:active` clears on blur; `_onSpaceUp` alone does not — a
// Tab or alt-tab away while Space is held would otherwise leave
// `.pressed` stuck on indefinitely.
Event.addListener(this, "blur",          this._onBlur);
```

`pointerup` / `pointercancel` no longer appear here — they're installed by `_onPointerDown` and removed by `_onPointerRelease`. Every other line is unchanged from today. `_onAuxMouseDown`, `_onSpaceDown`, `_onSpaceUp`, and `_onBlur` themselves are not modified.

---

## Ordered Implementation Steps

### Already implemented — no action needed

1. `Event.ts`'s tri-state `button?: "primary" | "aux" | "any"` filter on `ListenerOptions`, the `ListenerEntry`-shaped registration record, and all three dispatch loops (exact-target, subtree, viewport-exempt) applying `passesButtonFilter`.
2. The unconditional `stop` / `prevent` disposition floor (`ListenerOptions.stop` / `.prevent`, merged in `applyDisposition`) — unrelated to this plan.
3. The roughly sixty converted call sites across the codebase. The real opt-ins onto `{ button: "any" | "aux" }` are: [CollapseButton.ts:177](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L177), [Button.ts:638](packages/lib/src/typescript/lib/component/button/Button.ts#L638) (`_onAuxMouseDown`, unrelated to this plan), [Button.ts:1667](packages/lib/src/typescript/lib/component/button/Button.ts#L1667) (`addPointerDownListener`), [Component.ts:5635](packages/lib/src/typescript/lib/core/Component.ts#L5635) and [:5669](packages/lib/src/typescript/lib/core/Component.ts#L5669) (`addMouseDownListener` / `addMouseDownSubtreeListener`), [Tooltip.ts:433](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L433), and [AbstractWindow.ts:328](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L328). *Note: this list is shorter than an independently-drafted exploration of this same problem assumed — `AbstractCalendarDropdown` / `TimePickerDropdown`'s focus-retention `pointerdown` guards register with no `button` override on this branch, i.e. primary-only. That's a pre-existing, already-decided choice on this branch and out of scope here (see `## Non-Goals`).*
4. `Button`'s `.pressed`-class migration off native `:active`: the `pressedStyleRule` / `hoverStyleRule` selectors, and the accompanying docs/comment sweep. Only [Header.ts:137](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L137)'s unrelated `:active` rule remains, deliberately (see `## Non-Goals`).
5. Keyboard press-tracking (`_onSpaceDown` / `_onSpaceUp` / `_onBlur`) and the middle-click autoscroll suppression (`_onAuxMouseDown`).

### Remaining steps

6. **`packages/lib/src/typescript/lib/core/Event.ts`** — replace `BUTTON_FILTER_DEFAULTS` (the `Map`, [Event.ts:141-168](packages/lib/src/typescript/lib/core/Event.ts#L141)) and the `BUTTON_FILTER_DEFAULTS.get(type)` line inside `passesButtonFilter` ([Event.ts:176](packages/lib/src/typescript/lib/core/Event.ts#L176)) with `PRIMARY_BUTTON_TYPES` and the rewritten resolution line from `## Internal Structure`. Update the `ListenerOptions.button` JSDoc ([Event.ts:43-67](packages/lib/src/typescript/lib/core/Event.ts#L43)) to describe the allowlist model instead of the exceptions model. *Check:* `grep -rn "BUTTON_FILTER_DEFAULTS" packages/lib/` returns zero matches once steps 6-8 are done.
7. **Comment sweep** — three other source files name `BUTTON_FILTER_DEFAULTS` in a comment: [Slider.ts:569](packages/lib/src/typescript/lib/component/input/Slider.ts#L569) and [:594](packages/lib/src/typescript/lib/component/input/Slider.ts#L594), and [DiagramView.ts:1414](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1414). Update each to say `PRIMARY_BUTTON_TYPES`; the substance of each comment (that `pointermove` / `pointercancel` / `lostpointercapture` default to `"any"`) is still true under the new model and needs no other change. `Button.ts`'s own reference at the old line 641 is replaced wholesale by step 9.
8. **`packages/lib/tests/dom/events.test.ts`** — rename the `describe('Modelled event delivery — BUTTON_FILTER_DEFAULTS per-type default', ...)` block ([events.test.ts:380](packages/lib/tests/dom/events.test.ts#L380)) and its leading comment ([events.test.ts:367-379](packages/lib/tests/dom/events.test.ts#L367)) to reference the allowlist model. Add two new cases proving the fix (see `## Expected Behaviour`); the three existing cases in that block (`contextmenu` fires for any button, `pointermove` fires despite `button: -1`, `mousedown` still defaults primary) keep passing unchanged — they exercise the same outcomes the new model produces.
9. **`packages/lib/src/typescript/lib/component/button/Button.ts`** — replace [Button.ts:377-441](packages/lib/src/typescript/lib/component/button/Button.ts#L377) with the fields/handlers block from `## Internal Structure`, and [Button.ts:626-649](packages/lib/src/typescript/lib/component/button/Button.ts#L626) with the constructor wiring block. `_onAuxMouseDown` (currently interleaved between the two, [Button.ts:412-426](packages/lib/src/typescript/lib/component/button/Button.ts#L412)) is untouched — keep it in place between `_onPointerDown` and `_onPointerOver`/`_onPointerOut`/`_onPointerRelease`, or move it to the end of the block; either is fine as long as its body is byte-for-byte the same. *Check:* `grep -n "setPointerCapture\|hasPointerCapture\|releasePointerCapture" packages/lib/src/typescript/lib/component/button/Button.ts` returns zero matches.
10. **`packages/lib/tests/dom/TestDOM.ts`** — extend `makeEvent`'s `init` parameter ([TestDOM.ts:1464-1496](packages/lib/tests/dom/TestDOM.ts#L1464)) with two optional fields: `relatedTarget?: Handle` and `pointerId?: number`. Thread `relatedTarget` through the same sentinel wrapper `target` already uses (`init?.relatedTarget !== undefined ? { [SENTINEL_TARGET]: init.relatedTarget } : undefined`), so `DOM.source.isNode` / `.intern` resolve it exactly like `target` — `ModelledDOMSource.isNode`'s own doc comment ([TestDOM.ts:886-889](packages/lib/tests/dom/TestDOM.ts#L886)) already anticipates this exact use. Pass `pointerId` straight through onto the returned event object. *Check:* no existing call site breaks — both new fields are optional and additive.
11. **`packages/lib/tests/component/button/Button.pressedState.test.ts`** — rewrite the affected assertions (see `## Expected Behaviour` for the exact cases):
    - The SplitButton-chevron scenario ([Button.pressedState.test.ts:141-163](packages/lib/tests/component/button/Button.pressedState.test.ts#L141)) flips from "`splitEl` never gets a pressed write" to "`splitEl` gets a pressed write" — replace `hasPressedWrite(sink, splitEl)).toBe(false)` with `isPressed(sink, splitEl)).toBe(true)`.
    - The TabButton/TabCloseButton scenario ([Button.pressedState.test.ts:165-181](packages/lib/tests/component/button/Button.pressedState.test.ts#L165)) flips from mutual exclusivity to both showing pressed — replace `hasPressedWrite(sink, tabEl)).toBe(false)` with `isPressed(sink, tabEl)).toBe(true)`.
    - Every `capturedPointerCount(sink)` assertion becomes an assertion that it is `0` (there are no `setPointerCapture` calls left to count) — the `capturedPointerCount` helper itself can stay, since it's still a useful "zero calls, ever" pin.
    - Add the new boundary-crossing, stale-recovery, and cross-pointer-id cases from `## Expected Behaviour`.
12. **Documentation** — apply `## Documentation Impact`.
13. **Verification** — run the commands in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Event.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` (comment only) |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` (comment only) |
| Modify | `packages/lib/tests/dom/events.test.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/tests/component/button/Button.pressedState.test.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/concepts/events.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/llms.txt` (regenerated by `npm run docs:llms`) |

---

## Expected Behaviour

### Event.ts defaults-table fix — unit-testable (`tests/dom/events.test.ts`)

1. A bare `addListener(c, "auxclick", h)` now fires for `button: 2` (previously: never, since `auxclick` fell back to `"primary"` and never carries `button: 0`).
2. The same bare registration fires for `button: 1` too — any non-primary button.
3. A bare `addListener(c, "mouseover", h)` fires for `button: 2` (a synthetic edge case; a real browser's own `mouseover` always reports `button: 0`, so this doesn't change observed behaviour — it removes a latent trap for a hand-built event or a future browser quirk).
4. Existing coverage — a bare `contextmenu` registration still fires for any button, a bare `pointermove` registration still fires despite `button: -1`, and a bare `mousedown` registration still defaults primary-only — all keep passing unchanged.

### Button.ts press-tracking — unit-testable (`tests/component/button/Button.pressedState.test.ts`, real dispatcher + `RecordingDOMSink`)

5. `pointerdown` with `button: 0` on the button's own element sets `.pressed` (unchanged from today).
6. `pointerdown` with `button: 0` on a **descendant** now also sets `.pressed` on the containing button (new — subtree dispatch).
7. `pointerdown` with `button: 2` or `1` sets no pressed write (unchanged).
8. `pointerup` dispatched on an **unrelated element** (matching `pointerId`) clears `.pressed` and removes the viewport `pointerup` / `pointercancel` registrations — assert via `RecordingDOMSink`'s `removeListener` writes, mirroring `Event.test.ts`'s `countWrites` helper.
9. `pointercancel` behaves the same as `pointerup` (unchanged — still one shared handler).
10. A `pointerout` whose `relatedTarget` is **outside** the button, while still pressed, clears `.pressed` — but the press is still tracked internally: a following `pointerover` with the same `pointerId` and `buttons: 1` sets `.pressed` again (new — no boundary tracking exists today).
11. A `pointerout` whose `relatedTarget` is **inside** the button (a move between descendants) produces no pressed write at all (new).
12. A `pointerover` with the same `pointerId` but `buttons: 0` (the primary button no longer held) clears `.pressed` and removes the viewport registrations — the stale-release-outside-the-window recovery (new).
13. `setPointerCapture` is called **zero** times across the whole test file (was: once per primary press).
14. `SplitButton`: `pointerdown` on the chevron now sets `.pressed` on the containing `SplitButton` (flips the old "must not show pressed" expectation).
15. `TabButton` / `TabCloseButton`: `pointerdown` on the overlaid close button sets `.pressed` on **both** the close button and the containing `TabButton` (flips the old mutual-exclusivity expectation).
16. A second, distinct `pointerId`'s `pointerup` does not end a different, still-held pointer's press (needs `makeEvent`'s new `pointerId` support — proves the `pointerId` gate is real rather than passing by `undefined === undefined` coincidence).
17. `dispose()` mid-press removes the button's id from `Event._registeredComponentIds()` — `Component.destructor`'s existing `Event.purgeComponent` call already sweeps the press-scoped viewport registrations; this pins that generic behaviour for `Button` specifically.
18. Keyboard (`_onSpaceDown` / `_onSpaceUp`) and blur cases are unchanged from the existing test — no rewrite needed.

### Behaviour that needs manual verification in a browser

The offline harness has no hit-testing and no native `click` computation.

19. Press a button, drag off it, release outside: the sunken look clears as the pointer leaves, and **no action fires**. This is the core fix.
20. Press a button, drag off it, drag back on, release: the sunken look returns, and the action fires exactly once.
21. Press the `SplitButton` chevron: the whole button now visibly presses (previously it did not).
22. Press a `TabButton`'s close (✕): both the tab and the ✕ visibly press at once (previously only the ✕ did).
23. On a touch device: tapping a button presses and actions it; dragging off into a scroll clears the pressed look via the browser's own `pointercancel`.
24. Release the pointer outside the browser window, then move it back over the button: the pressed visual re-syncs instead of staying stuck.

---

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run docs:api      # must finish with zero warnings
npm run docs:llms
```

Greps that must hold after the change:

```bash
grep -rn "BUTTON_FILTER_DEFAULTS" packages/lib/                                                        # zero matches
grep -n "setPointerCapture\|hasPointerCapture\|releasePointerCapture" \
  packages/lib/src/typescript/lib/component/button/Button.ts                                           # zero matches
grep -rn ":active" packages/lib/src/typescript/lib/                                                    # one match: Header.ts:137
```

Manual smoke test: `npm run dev` (app on `localhost:8015`) and walk cases 19-24 above.

---

## Documentation Impact

- **`ARCHITECTURE.md`** — the *Event handling* section's button-default sentence ([ARCHITECTURE.md:17](ARCHITECTURE.md#L17)) currently frames the model as "primary by default, except a short exceptions list." Reword it to state the allowlist directly: a short list of press-initiating types (`mousedown`, `mouseup`, `click`, `dblclick`, `pointerdown`, `pointerup`) defaults to `"primary"`; every other type defaults to `"any"`.
- **`packages/lib/docs/concepts/events.md`** — the "Which mouse button fires a listener" section ([events.md:79-96](packages/lib/docs/concepts/events.md#L79)) documents the same exceptions-list framing, naming `contextmenu` and the pointer family as the only `"any"` defaults. Rewrite to lead with the allowlist and note that `auxclick` and the mouse-flavoured hover family (`mousemove` / `mouseover` / `mouseout` / `mouseenter` / `mouseleave`) fall out of it the same way.
- **`packages/lib/docs/reference/migration/next.md`** — two spots:
  - The "DOM-routed listeners now default to the primary mouse button only" section ([migration/next.md:8-33](packages/lib/docs/reference/migration/next.md#L8)) lists the same exceptions-model framing; reword to the allowlist the same way as `events.md`.
  - The `Button` section's claim that "Button now also consumes `pointerdown` on a primary press (acquiring pointer capture to track the release)" ([migration/next.md:58-60](packages/lib/docs/reference/migration/next.md#L58)) is now false. Replace it with a sentence describing the actual mechanism — subtree `pointerdown`/`pointerover`/`pointerout` plus a press-scoped viewport `pointerup`/`pointercancel` pair, no capture acquired — and state that this is what keeps drag-away-to-cancel working.
- **`packages/lib/docs/reference/changelog/next.md`** — the *Added → Core* bullet about `contextmenu` and the pointer family defaulting to `"any"` "on their own" ([changelog/next.md:153-157](packages/lib/docs/reference/changelog/next.md#L153)) needs the same allowlist reword.
- `npm run docs:llms` regenerates `packages/lib/llms.txt`; commit the regenerated file. `npm run docs:api` regenerates `packages/lib/docs/api/**` (including `ListenerOptions.md` / `ListenerRegistration.md`, which currently name `BUTTON_FILTER_DEFAULTS`) — do not hand-edit those generated files.

---

## Potential Challenges

- **Four other files name `BUTTON_FILTER_DEFAULTS` in a comment.** Missing one leaves a dangling reference to a deleted constant. Step 7's grep check catches this.
- **Touch keeps the pressed look while the finger drags away**, because the browser implicitly captures a touch pointer, so `pointerout` never fires for it. The press still ends correctly on `pointerup` or `pointercancel`, and a drag that becomes a scroll raises `pointercancel`. Verify case 23 by hand; this is an accepted, pre-existing gap, not something this plan tries to close.
- **A stale press if the user releases outside the browser window.** No `pointerup` reaches the viewport listener. The `event.buttons` check in `_onPointerOver` ends the press the next time the pointer crosses back onto the button.
- **Ordering inside `Button`'s constructor.** The press-tracking handlers are arrow-function class fields, so the `Event.addSubtreeListener` / `Event.addListener` calls that wire them must run after `super()` returns — the existing call site (immediately before the `applyListeners` guard) already satisfies this and doesn't move.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) — `PRIMARY_BUTTON_TYPES`, `passesButtonFilter`, the `ListenerOptions.button` JSDoc.
- [`packages/lib/src/typescript/lib/component/button/Button.ts:377-441`](packages/lib/src/typescript/lib/component/button/Button.ts#L377) and [`:626-649`](packages/lib/src/typescript/lib/component/button/Button.ts#L626) — the press-tracking fields/handlers and their constructor wiring.
- [`packages/lib/src/typescript/lib/overlay/Notification.ts:361-404`](packages/lib/src/typescript/lib/overlay/Notification.ts#L361) — the precedent for the `relatedTarget`-inside boundary guard `_isInsideTarget` is built from.
- [`packages/lib/src/typescript/lib/component/container/Scrollbar.ts:912-989`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L912) — the precedent for installing viewport listeners for the duration of a gesture and removing them at the end.
- [`packages/lib/src/typescript/lib/component/input/Slider.ts:542-601`](packages/lib/src/typescript/lib/component/input/Slider.ts#L542) — the framework's one remaining `setPointerCapture` user, read to see why a slider is the case where capture is right and a button is not.
- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts:1687-1721`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1687) — the precedent for the `event.buttons`-bit stale-press recovery.
- [`packages/lib/src/typescript/lib/component/button/SplitButton.ts:80-149`](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L80) and [`packages/lib/src/typescript/lib/component/button/TabButton.ts:247-294`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L247) — the two components whose pressed-state behaviour changes as a side effect of the subtree-dispatch switch; re-read both before touching the test file.
- [`packages/lib/tests/component/button/Button.pressedState.test.ts`](packages/lib/tests/component/button/Button.pressedState.test.ts) — the existing regression test; every assertion this plan flips is called out in `## Ordered Implementation Steps`, step 11.
- [`packages/lib/tests/dom/TestDOM.ts:1464-1496`](packages/lib/tests/dom/TestDOM.ts#L1464) — `makeEvent`, needing the `relatedTarget` / `pointerId` extension.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Event handling* (listeners must reference a named function; a component listens only on itself; hover uses the bubbling pair; the button-default rule this plan rewords).

---

## Non-Goals

- **No rename to `"auxiliary"`.** This branch's `"aux"` naming stays; see `## Notes`.
- **No change to `Header`'s `:active` rule** ([Header.ts:137](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L137)) — a pooled table-cell renderer, not a `Button`; out of scope.
- **No change to `AbstractCalendarDropdown` / `TimePickerDropdown`'s focus-retention `pointerdown` guards.** They register primary-only on this branch today, a pre-existing and already-decided choice, not one of the two remaining open findings this plan addresses.
- **No change to the `stop` / `prevent` disposition floor.**
- **No public `isPressed()` getter on `Button`.** Nothing needs to read the state externally.
- **No change to `Button.click()` or the `"action"` event.** Activation is unaffected by design.
- **No new pressed-state theme tokens or CSS selector changes** — this plan only touches how `.pressed` gets toggled, not what it paints.

---

## Notes

[^native-click]: Synthesising activation from `pointerup` instead (treat a release over the button as the action) was considered and rejected before this branch's earlier rounds: it would re-implement browser behaviour far larger than it looks — keyboard activation timing (Enter on keydown, Space on keyup), the touch compatibility path, `detail` click counting and its `dblclick` pairing, and assistive-technology activation, which arrives as a bare `click` with no preceding pointer events at all. A screen-reader user would lose every button in the framework.

[^why-not-capture]: `setPointerCapture` looks attractive because it guarantees `pointerup` delivery even when the pointer leaves the window. It's wrong for `Button` because the Pointer Events spec retargets `click`, `auxclick`, and `contextmenu` to the capturing element rather than the element actually under the pointer at release — so a button that captures on `pointerdown` fires `click` even when the user deliberately dragged away to cancel. Capture would also make the *visual* harder, not easier: with the pointer captured, `pointerover` / `pointerout` no longer describe the real element under the pointer, so tracking insideness would need a hit test on every `pointermove` instead of two boundary events.

[^viewport-scoping]: A slider-style approach — a single, permanently-installed viewport `pointerup` listener per `Button` instance, gated internally on `pointerId` — was considered and rejected in favour of scoping the registration to the press itself. Viewport listeners broadcast to every registered component on every matching event ([Event.ts:362-380](packages/lib/src/typescript/lib/core/Event.ts#L362)); a page with hundreds of buttons keeping a live `pointerup` listener at all times would run hundreds of no-op pointerId checks on every single release anywhere on the page, including ones with nothing to do with any button. Installing the pair only while a press is active (mirroring `Scrollbar`) keeps the steady-state cost at zero.

[^defaults-bug]: `auxclick` is a live gap in the current table: it is absent from `BUTTON_FILTER_DEFAULTS`, so a bare registration on it falls back to `"primary"` — and `auxclick` by definition never carries `button: 0`, so such a listener could never fire. No call site in the codebase currently registers a bare `auxclick` listener (`grep -rn '"auxclick"' packages/lib/src/` returns nothing), so this has not caused an observed bug yet — it is a trap waiting for the first consumer who does. The mouse-flavoured hover family (`mousemove` / `mouseover` / `mouseout` / `mouseenter` / `mouseleave`) is different: several real call sites bare-register these already (`MenuItem`, `Scrollbar`, `Notification`, `Tooltip`, `DiagramView`, `CheckboxMenuRow`, `RadioMenuRow`, `MenuBarButton`), and none of them are currently broken, because a genuine browser `mouseover` / `mouseout` always reports `button: 0` regardless of which button (if any) is held — these events are not triggered by a button change, and the DOM always reports `0` for such events. Folding this family into the `"any"` default is a correctness/robustness improvement (it no longer depends on that browser guarantee holding for every future test fixture or edge case), not a behaviour-changing fix.

[^naming-deviation]: An independently-drafted exploration of this same design problem, run from a fresh worktree pinned at `master` with no visibility into this branch, converged on the same subtree+viewport, no-capture architecture but used `buttons?: "primary" | "auxiliary" | "any"` field/value names. This branch's code, tests, and already-written docs and migration notes extensively use `button` / `"aux"` already (dozens of call sites across `packages/lib/src` and `packages/lib/tests`), so renaming to match the exploration would be pure churn with zero functional benefit. This plan keeps the branch's existing names throughout.

[^no-extra-helpers]: The independently-drafted exploration split press-start and press-end into `_beginPointerPress()` / `_endPointerPress()` helper methods. Re-deriving the design against this branch's actual code showed that's unnecessary here: `_onPointerDown` has exactly one call site for the begin-logic (itself), and `_onPointerRelease` can serve as the single end-logic implementation directly — the stale-recovery branch in `_onPointerOver` already has an event with the matching `pointerId` in hand, so it calls `this._onPointerRelease(e)` rather than a differently-named twin. This keeps the diff smaller and matches this file's existing flat style (compare `_onPointerDown` / `_onPointerRelease` today, which have no such wrapper split either).
