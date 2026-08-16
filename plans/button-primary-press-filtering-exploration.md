---
touches-shared: [src/typescript/lib/core/Event.ts]
---

# Primary-Button Interaction Filtering — Implementation Plan

## Overview

Every DOM listener in the framework is registered through `Event.addListener` / `Event.addSubtreeListener` / `Event.addViewportListener` ([Event.ts:293](src/typescript/lib/core/Event.ts#L293), [Event.ts:393](src/typescript/lib/core/Event.ts#L393), [Event.ts:583](src/typescript/lib/core/Event.ts#L583)), and each one fires for a press from any mouse button. This plan adds a per-registration mouse-button filter to those three entry points. A bare registration for a press-type event (`mousedown`, `mouseup`, `click`, `dblclick`, `pointerdown`, `pointerup`) fires only for the primary button; every other event type is unfiltered; a listener that genuinely needs the right or middle button opts in through a new `buttons` field on the registration options bag.

`Button` shows its sunken treatment through a generated `:active` rule ([Button.ts:385](src/typescript/lib/component/button/Button.ts#L385)) and its hover treatment through `:hover:not(:active)` ([Button.ts:395](src/typescript/lib/component/button/Button.ts#L395)). CSS cannot see which mouse button is down, so `:active` is replaced by a JS-toggled `pressed` class driven by real pointer and keyboard events. Activation itself is **not** rebuilt: the browser's native `click` already refuses to fire when the pointer is released away from the button, and that behaviour is what the whole design is arranged to preserve.

The change touches `core/Event.ts`, `component/button/Button.ts` and `overlay/windowControls.ts`; eight call sites that must opt back into non-primary buttons; comment-only edits in `core/Component.ts` and `component/button/ToggleButton.ts`; and five documentation pages.

---

## Architecture Decisions

### Activation keeps using the browser's native `click`

The new pointer tracking drives the pressed *visual* only. It never gates, suppresses, or synthesises the `click` that fires `Button`'s `"action"` event ([Button.ts:1482](src/typescript/lib/component/button/Button.ts#L1482)).[^native-click]

A press that is released away from the button therefore still cancels, exactly as it does today, because the browser recomputes the element under the pointer at release time and declines to fire `click`.

### `setPointerCapture` is rejected for the press tracking

`Button` does not capture the pointer on press. The pressed state is tracked with `pointerover` / `pointerout` on the button plus a `pointerup` listener scoped to the viewport.[^why-not-capture]

`Slider` does use `setPointerCapture` ([Slider.ts:550-592](src/typescript/lib/component/input/Slider.ts#L550)), and that is correct there: a slider drag *wants* every subsequent pointer event retargeted to the slider, and a slider has no click-cancellation affordance to protect. A button has the opposite requirement.

### The pressed visual is a `pressed` class on a `createStyleRule` rule

`Button` allocates its pressed rule as `createStyleRule(".pressed")` and its hover rule as `createStyleRule(":hover:not(.pressed)")`, and toggles the class with `DOM.sink.apply(element, { toggleClass: { pressed: value } })`. This mirrors `ToggleButton`'s `.selected` rule and `setSelected` ([ToggleButton.ts:35](src/typescript/lib/component/button/ToggleButton.ts#L35), [ToggleButton.ts:139-150](src/typescript/lib/component/button/ToggleButton.ts#L139)) — the framework's existing way to express a JS-owned visual state on a component.

The `:not()` guard keeps its current job: while `pressed` is on the element the hover rule stops matching, so the pressed treatment wins regardless of stylesheet order.

### Press wiring registers as subtree listeners, release wiring as viewport listeners

`pointerdown`, `pointerover` and `pointerout` are registered with `Event.addSubtreeListener` on the button. `pointerup` and `pointercancel` are registered with `Event.addViewportListener` when a press begins and removed when it ends.[^subtree-and-viewport]

Registering the release listeners per press mirrors `Scrollbar._onDragStart`, which installs its viewport `mousemove` / `mouseup` pair at the start of a thumb drag and removes it at the end ([Scrollbar.ts:915-919](src/typescript/lib/component/container/Scrollbar.ts#L915)).

### A stale press heals on the next `pointerover`

When a press ends somewhere the framework never hears about — released outside the browser window — the next `pointerover` on the button checks the primary bit of `event.buttons` and ends the press when it is clear. `DiagramView` already recovers from the same situation this way ([DiagramView.ts:1707](src/typescript/lib/component/diagram/DiagramView.ts#L1707)).

### The filter is applied in the dispatcher, per registration

`Event` stores a `{ listener, buttons }` record per registration instead of a bare function, and the three dispatch loops skip a record whose filter does not match the event. Removal still matches on the function reference, so `removeListener` / `removeSubtreeListener` / `removeViewportListener` keep their current contract.[^filter-in-dispatcher]

### Defaults are per event type; an explicit `buttons` option always wins

Six event types default to `"primary"`. Every other type defaults to `"any"`. An explicit `buttons` value is honoured for any type. A filter other than `"any"` passes any event whose `button` property is not a number.

| Event type | Default | Why |
|---|---|---|
| `mousedown`, `pointerdown` | `"primary"` | The initiating press of an interaction. |
| `mouseup`, `pointerup` | `"primary"` | The release that completes a press the primary button began. |
| `click`, `dblclick` | `"primary"` | Activation. Browsers already restrict `click` to the primary button; the filter makes the framework's contract explicit rather than browser-dependent. |
| everything else | `"any"` | No initiating press to filter — see below. |

The types that must **not** default to `"primary"`, and why:

- `contextmenu` is a *request to open a context menu*, not a press. The browser also raises it from the keyboard (Menu key, Shift+F10), where `button` is `0` — so a primary-only filter would pass the keyboard route and block the right-click route, which is backwards.
- `auxclick` is non-primary by definition. A primary-only default would mean no `auxclick` handler ever fires.
- `pointermove`, `pointerenter`, `pointerleave`, `pointerover`, `pointerout`, `pointercancel`, `lostpointercapture`, `gotpointercapture` describe pointer *movement and capture lifecycle*, not a press. Their `button` is a filler value with no meaning.
- `mousemove`, `mouseover`, `mouseout`, `mouseenter`, `mouseleave` are the mouse-flavoured half of the same family.
- `wheel`, `keydown`, `keyup`, `touchstart`, `touchmove`, `touchend`, `focus`, `blur`, `focusin`, `input`, `change`, `scroll`, `resize`, `selectstart` and every custom type carry no `button` at all.

Worked cases:

| Registration | Event delivered | Fires? | Why |
|---|---|---|---|
| `addListener(c, "mousedown", h)` | `mousedown`, `button: 0` | yes | `mousedown` defaults to `"primary"` |
| `addListener(c, "mousedown", h)` | `mousedown`, `button: 2` | no | `mousedown` defaults to `"primary"` |
| `addListener(c, "mousedown", h, { buttons: "any" })` | `mousedown`, `button: 2` | yes | explicit `"any"` wins over the default |
| `addListener(c, "mousedown", h, { buttons: "auxiliary" })` | `mousedown`, `button: 0` | no | `"auxiliary"` excludes the primary button |
| `addListener(c, "contextmenu", h)` | `contextmenu`, `button: 2` | yes | `contextmenu` defaults to `"any"` |
| `addListener(c, "click", h)` | `Button.click()`, no `button` property | yes | a non-numeric `button` passes every filter |

### Eight call sites opt back into non-primary buttons

Three behaviours must survive a right- or middle-press, so their registrations pass `{ buttons: "any" }`: dismissing an open overlay, hiding a tooltip, and raising a window. Five more are focus-retention guards inside picker dropdowns, which must suppress focus loss from any press.[^opt-in-sites] The full list is in `## Ordered Implementation Steps`, step 9.

---

## Public API

`core/Event.ts` — new exported members inside the `Event` namespace:

```typescript
/** Which mouse buttons a DOM-routed listener accepts. */
export type ButtonFilter = "primary" | "auxiliary" | "any";

/** Per-call registration overrides available to a viewport listener. */
export interface ViewportListenerOptions {
    /**
     * Which mouse buttons this listener accepts. Defaults to `"primary"` for
     * `mousedown` / `mouseup` / `click` / `dblclick` / `pointerdown` /
     * `pointerup`, and to `"any"` for every other event type.
     */
    buttons?: ButtonFilter;
}

/** Per-call registration overrides available to an element-scoped listener. */
export interface ListenerOptions extends ViewportListenerOptions {
    passive?: boolean;
}
```

Changed signatures — the only edit is the added / widened final parameter. Return annotations are shown for completeness; `addListener` and `addViewportListener` carry none today, so leave them exactly as they are.

```typescript
export function addListener(
    component: Component,
    type: string,
    listener: Listener,
    options?: ListenerOptions
): void;

export function addSubtreeListener(
    component: Component,
    type: string,
    listener: Listener,
    options?: ListenerOptions
): void;

export function addViewportListener(
    component: Component,
    type: string,
    listener: Listener,
    options?: ViewportListenerOptions
): void;
```

`removeListener`, `removeSubtreeListener` and `removeViewportListener` keep their existing three-parameter signatures.

`Button` gains no new public method, option, or event. `setPressedBackgroundColor` and the rest of the `pressedX` / `hoverX` family are unchanged — only the selector their rule is attached to changes.

---

## Internal Structure

### Event.ts — registration record and filter

```typescript
/** One registered listener plus the button filter it was registered with. */
interface Registration {
    listener: Listener;
    buttons:  ButtonFilter;
}

interface CompFunc {
    component: Component;
    listeners: Registration[];
}

/**
 * Event types whose bare registration means "primary button only". Every
 * other type defaults to `"any"` — see the defaults table in the plan.
 */
const PRIMARY_BUTTON_TYPES: Set<string> = new Set([
    "mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup",
]);

function defaultButtonFilter(type: string): ButtonFilter {
    return PRIMARY_BUTTON_TYPES.has(type) ? "primary" : "any";
}

/**
 * Tests an event against a registration's button filter. An event whose
 * `button` is not a number — a synthetic CustomEvent from `fireEvent`, a
 * keyboard event, anything non-mouse — passes every filter.
 */
function passesButtonFilter(evnt: Event, filter: ButtonFilter): boolean {
    if (filter === "any") {
        return true;
    }

    const button = (evnt as MouseEvent).button;

    if (typeof button !== "number") {
        return true;
    }

    return filter === "primary" ? button === 0 : button !== 0;
}

/**
 * Runs every registration on `compFunc` whose filter accepts the event.
 *
 * @returns `true` when any listener's disposition stopped propagation.
 */
function runListeners(evnt: Event, compFunc: CompFunc): boolean {
    let stopped = false;

    for (const registration of compFunc.listeners) {
        if (!passesButtonFilter(evnt, registration.buttons)) {
            continue;
        }

        if (applyDisposition(evnt, registration.listener.apply(compFunc.component, [evnt]))) {
            stopped = true;
        }
    }

    return stopped;
}
```

All three dispatch loops — exact-target ([Event.ts:150-154](src/typescript/lib/core/Event.ts#L150)), subtree ([Event.ts:189-193](src/typescript/lib/core/Event.ts#L189)) and viewport ([Event.ts:226-228](src/typescript/lib/core/Event.ts#L226)) — collapse to a `runListeners` call. The viewport dispatcher discards the return value, keeping its current behaviour of never ending its own fan-out.

### Button.ts — press state

```typescript
/**
 * Class toggled onto the button element while it is pressed. Shared by the
 * `.pressed` style-rule selector and the `toggleClass` write so the two
 * cannot drift apart.
 */
const PRESSED_CLASS: string = "pressed";

/** The pointer currently holding the button down, or `null` when none is. */
private _pressPointerId: number | null = null;

/** Whether that pointer is currently over the button. */
private _pressPointerInside: boolean = false;

/** Whether a keyboard activation key is currently held on the button. */
private _keyPressed: boolean = false;

/**
 * Writes the pressed class from the current pointer and keyboard state. The
 * button reads pressed while a pointer holds it *and* sits over it, or while
 * an activation key is held.
 */
private _syncPressedClass(): void {
    const pressed = (this._pressPointerId !== null && this._pressPointerInside) || this._keyPressed;
    const element = this.getElement();

    if (element) {
        DOM.sink.apply(element, { toggleClass: { [PRESSED_CLASS]: pressed } });
    }
}
```

The insideness test reuses the framework's existing hover-boundary guard — a `pointerout` whose `relatedTarget` is still inside the button is an internal move, not a leave. `Notification` uses the same shape ([Notification.ts:373](src/typescript/lib/overlay/Notification.ts#L373)):

```typescript
private _isInsideTarget(related: unknown): boolean {
    const element = this.getElement();

    return element !== undefined
        && DOM.source.isNode(related)
        && DOM.source.contains(element, DOM.source.intern(related));
}
```

Press start and end:

```typescript
private _beginPointerPress(pointerId: number): void {
    this._pressPointerId     = pointerId;
    this._pressPointerInside = true;

    Event.addViewportListener(this, "pointerup",     this._onViewportPointerUp);
    Event.addViewportListener(this, "pointercancel", this._onViewportPointerCancel);

    this._syncPressedClass();
}

private _endPointerPress(): void {
    if (this._pressPointerId === null) {
        return;
    }

    Event.removeViewportListener(this, "pointerup",     this._onViewportPointerUp);
    Event.removeViewportListener(this, "pointercancel", this._onViewportPointerCancel);

    this._pressPointerId     = null;
    this._pressPointerInside = false;

    this._syncPressedClass();
}
```

---

## Ordered Implementation Steps

1. **`src/typescript/lib/core/Event.ts`** — add the `ButtonFilter` type and the `ViewportListenerOptions` interface above the existing `ListenerOptions` ([Event.ts:28](src/typescript/lib/core/Event.ts#L28)), and make `ListenerOptions extends ViewportListenerOptions`. Keep the existing `passive` JSDoc as it stands. *Check:* `npm run typecheck` still passes — nothing consumes the new members yet.

2. **`core/Event.ts`** — add `PRIMARY_BUTTON_TYPES`, `defaultButtonFilter` and `passesButtonFilter` immediately below `PASSIVE_TYPES` ([Event.ts:58](src/typescript/lib/core/Event.ts#L58)), exactly as given in `## Internal Structure`.

3. **`core/Event.ts`** — add the `Registration` interface and change `CompFunc.listeners` to `Registration[]` ([Event.ts:14-17](src/typescript/lib/core/Event.ts#L14)). *Check:* `npm run typecheck` now reports errors at every site that treats `listeners` as a function array — that error list is the exact work for steps 4, 5 and 7.

4. **`core/Event.ts`** — add `runListeners` below `applyDisposition` ([Event.ts:71](src/typescript/lib/core/Event.ts#L71)) and rewrite the three dispatch loops to call it. The exact-target and subtree loops assign its result into `propagationStopped`; the viewport loop ignores the result. Do not change the surrounding structure — the `try`/`catch` handle guards in the subtree walk ([Event.ts:171-208](src/typescript/lib/core/Event.ts#L171)) stay exactly as they are.

5. **`core/Event.ts`** — in `addListener` and `addSubtreeListener`, replace the `includes` / `push` pair with a `Registration` push:

   ```typescript
   if (!compFunc.listeners.some((registration) => registration.listener === listener)) {
       compFunc.listeners.push({
           listener,
           buttons: options?.buttons ?? defaultButtonFilter(type),
       });
   }
   ```

6. **`core/Event.ts`** — widen `addViewportListener` with `options?: ViewportListenerOptions` and push `{ listener, buttons: options?.buttons ?? defaultButtonFilter(type) }`. Keep its existing no-dedupe push. Do **not** pass `options` to `captureOpts` — viewport registrations do not participate in the passive-conflict bookkeeping, which is why they take the narrower options type.

7. **`core/Event.ts`** — in `removeListener`, `removeSubtreeListener` and `removeViewportListener`, replace `compFunc.listeners.indexOf(listener)` with `compFunc.listeners.findIndex((registration) => registration.listener === listener)`. Everything else in those functions is unchanged.

8. **Regression checkpoint** — `grep -rn "compFunc.listeners" src/typescript/lib/core/Event.ts` returns only the sites edited in steps 4-7. `grep -rn "\.listeners\.includes\|\.listeners\.indexOf" src/` returns zero matches.

9. **Opt-in call sites** — append `{ buttons: "any" }` as the last argument at exactly these eight registrations, and add a one-line comment at each saying why:

   | File:line | Registration | Why any button |
   |---|---|---|
   | [LayerManager.ts:570](src/typescript/lib/core/LayerManager.ts#L570) | viewport `pointerdown` | A press outside an open menu or popover dismisses it, whichever button pressed. |
   | [Tooltip.ts:433](src/typescript/lib/overlay/Tooltip.ts#L433) | `mousedown` on the anchor | Any press means the hover hint has served its purpose. |
   | [AbstractWindow.ts:326](src/typescript/lib/overlay/AbstractWindow.ts#L326) | subtree `mousedown` | Raising a window to the front is not a primary-only gesture. |
   | [AbstractCalendarDropdown.ts:186](src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L186) | `pointerdown` | Focus-retention guard: any press inside the dropdown must not blur the host field. |
   | [AbstractCalendarDropdown.ts:225](src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L225) | `pointerdown` | Same focus-retention guard on the second nav button. |
   | [AbstractCalendarDropdown.ts:273](src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L273) | `pointerdown` | Same guard on a day cell. |
   | [AbstractCalendarDropdown.ts:581](src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L581) | subtree `pointerdown` | Same guard across the whole panel. |
   | [TimePickerDropdown.ts:81](src/typescript/lib/component/input/TimePickerDropdown.ts#L81) | subtree `pointerdown` | Same guard across the time panel. |

   Leave every other registration on its default. In particular leave the existing manual `e.button !== 0` guards in [DragManager.ts:328](src/typescript/lib/overlay/DragManager.ts#L328) and [DiagramView.ts:1664](src/typescript/lib/component/diagram/DiagramView.ts#L1664) in place.[^redundant-guards]

10. **`src/typescript/lib/component/button/Button.ts`** — add the `PRESSED_CLASS` constant beside the other module constants, change `createStyleRule(":active")` to `createStyleRule("." + PRESSED_CLASS)` ([Button.ts:385](src/typescript/lib/component/button/Button.ts#L385)) and `createStyleRule(":hover:not(:active)")` to `createStyleRule(":hover:not(." + PRESSED_CLASS + ")")` ([Button.ts:395](src/typescript/lib/component/button/Button.ts#L395)). Update the two comments above them so they describe the class rather than the pseudo-class, keeping the existing explanation of why the slot is a cache and why the `:not()` guard exists.

    Then sweep the rest of the file's prose, which names the pseudo-class throughout: the `flat` option doc ([Button.ts:135-136](src/typescript/lib/component/button/Button.ts#L135)), the class doc ([Button.ts:246-247](src/typescript/lib/component/button/Button.ts#L246)), the transparent-border comment in `_applyFlatChrome` ([Button.ts:1775](src/typescript/lib/component/button/Button.ts#L1775)), every `pressedX` / `hoverX` setter and clearer JSDoc block ([Button.ts:1987-2422](src/typescript/lib/component/button/Button.ts#L1987)), and `setEnabled`'s remark ([Button.ts:2431](src/typescript/lib/component/button/Button.ts#L2431)) — a disabled `<button>` dispatches no pointer events, so no press is tracked and the class never lands. *Check:* `grep -c ":active" src/typescript/lib/component/button/Button.ts` returns `0`.

11. **`Button.ts`** — add the three press-state fields and `_syncPressedClass` from `## Internal Structure`. Plain initialisers are correct here: no setter dispatched during the `super()` cascade writes them.

12. **`Button.ts`** — add `_isInsideTarget`, `_beginPointerPress`, `_endPointerPress`, and the five pointer handlers as arrow-function class fields (matching `_onThemeChange` at [Button.ts:371](src/typescript/lib/component/button/Button.ts#L371) and `Scrollbar._onMouseDown` at [Scrollbar.ts:265](src/typescript/lib/component/container/Scrollbar.ts#L265)):

    - `_onPointerDown(e: PointerEvent)` — return immediately when `!this.isEnabled()` or `this._pressPointerId !== null`; otherwise `this._beginPointerPress(e.pointerId)`. No `e.button` test: the `"primary"` default already did it.
    - `_onPointerOver(e: PointerEvent)` — return unless `e.pointerId === this._pressPointerId`. When `(e.buttons & 1) === 0` call `_endPointerPress()`; otherwise set `_pressPointerInside = true` and `_syncPressedClass()`.
    - `_onPointerOut(e: PointerEvent)` — return unless `e.pointerId === this._pressPointerId`, and return when `this._isInsideTarget(e.relatedTarget)` (an internal move). Otherwise set `_pressPointerInside = false` and `_syncPressedClass()`.
    - `_onViewportPointerUp(e: PointerEvent)` and `_onViewportPointerCancel(e: PointerEvent)` — return unless `e.pointerId === this._pressPointerId`; otherwise `_endPointerPress()`.

    None of these returns a disposition, so none consumes the event.

13. **`Button.ts`** — add the keyboard handlers as arrow-function class fields:

    - `_onKeyDown(e: KeyboardEvent)` — when `this.isEnabled()` and `e.key === " "` or `e.key === "Enter"`, set `_keyPressed = true` and `_syncPressedClass()`. Never call `preventDefault` — the native `<button>` owns keyboard activation.
    - `_onKeyUp(e: KeyboardEvent)` — on the same two keys, set `_keyPressed = false` and `_syncPressedClass()`.
    - `_onBlur()` — set `_keyPressed = false`, then `_endPointerPress()`.

14. **`Button.ts`** — add `_installPressTracking()` and call it from the constructor body immediately before the `applyListeners` guard ([Button.ts:532](src/typescript/lib/component/button/Button.ts#L532)):

    ```typescript
    private _installPressTracking(): void {
        Event.addSubtreeListener(this, "pointerdown", this._onPointerDown);
        Event.addSubtreeListener(this, "pointerover", this._onPointerOver);
        Event.addSubtreeListener(this, "pointerout",  this._onPointerOut);
        Event.addListener(this, "keydown", this._onKeyDown);
        Event.addListener(this, "keyup",   this._onKeyUp);
        Event.addListener(this, "blur",    this._onBlur);
    }
    ```

    The press and boundary events are subtree-scoped so a press on a pointer-opaque child still presses the button; the keyboard and blur listeners are exact-target, because focus lands on the button's own element. Subclasses inherit the wiring through `super()`; none needs its own call.

15. **`src/typescript/lib/overlay/windowControls.ts`** — change the two state-rule suffixes ([windowControls.ts:21-22](src/typescript/lib/overlay/windowControls.ts#L21)) from `":hover:not(:active)"` / `":active"` to `":hover:not(.pressed)"` / `".pressed"`, so a window control's themed press fill tracks the same class the rest of the button does.

16. **Comment sweep outside `Button.ts`** — update the three comments in `core/Component.ts` that cite Button's rules by name ([Component.ts:466](src/typescript/lib/core/Component.ts#L466), [Component.ts:981-982](src/typescript/lib/core/Component.ts#L981), [Component.ts:4903](src/typescript/lib/core/Component.ts#L4903)) and the one in `ToggleButton.setFlat` ([ToggleButton.ts:216](src/typescript/lib/component/button/ToggleButton.ts#L216)) to say `.pressed` / `:hover:not(.pressed)`. Comment text only — no behaviour changes in either file.

17. **Regression checkpoint** — `grep -rn ":active" src/typescript/lib/` returns exactly one match, [Header.ts:137](src/typescript/lib/component/table/cell/Header.ts#L137), which this plan leaves alone (see `## Non-Goals`).

18. **Tests** — add the cases from `## Expected Behaviour` to `tests/dom/events.test.ts` (filter routing) and `tests/component/button/Button.test.ts` (pressed class). `makeEvent` already accepts `button` and `buttons` ([TestDOM.ts:1464-1496](tests/dom/TestDOM.ts#L1464)), so no harness change is needed.

19. **Documentation** — apply `## Documentation Impact`.

20. **Verification** — run the commands in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Event.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/windowControls.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` (comments only) |
| Modify | `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` (comment only) |
| Modify | `packages/lib/src/typescript/lib/core/LayerManager.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Tooltip.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TimePickerDropdown.ts` |
| Modify | `packages/lib/tests/dom/events.test.ts` |
| Modify | `packages/lib/tests/component/button/Button.test.ts` |
| Modify | `packages/lib/docs/concepts/events.md` |
| Modify | `packages/lib/docs/components/Button.md` |
| Modify | `packages/lib/docs/concepts/theming.md` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/llms.txt` (regenerated by `npm run docs:llms`) |

---

## Expected Behaviour

### Event filtering — unit-testable

Drive these through `DOM.sink.dispatchEvent(handle, makeEvent(handle, type, init))` in `tests/dom/events.test.ts`, following the existing modelled-delivery cases in that file.

1. A bare `addListener(c, "mousedown", h)` runs `h` for an event with `button: 0`.
2. The same registration does **not** run `h` for `button: 2` or `button: 1`.
3. `{ buttons: "any" }` runs `h` for `button: 0`, `1` and `2`.
4. `{ buttons: "auxiliary" }` runs `h` for `button: 1` and `2`, and not for `button: 0`.
5. A bare `addListener(c, "contextmenu", h)` runs `h` for `button: 2` — the default for an unlisted type is `"any"`.
6. A bare `addListener(c, "click", h)` runs `h` for an event with no `button` property at all.
7. A bare `addListener(c, "keydown", h)` runs `h` even when the event carries `button: 2` — the type, not the event, decides whether a default filter applies.
8. Two listeners on the same component and type, one bare and one `{ buttons: "auxiliary" }`: a `button: 0` event runs only the bare one; a `button: 2` event runs only the auxiliary one.
9. `addSubtreeListener` and `addViewportListener` apply the same filter as `addListener` for the same type and options.
10. Registering the same function reference twice for one component and type is still a single registration, and the first registration's filter is the one that stands.
11. `removeListener(c, type, h)` removes a registration made with `{ buttons: "any" }` — removal matches on the function reference only.
12. Every existing case in `tests/unit/core/Event.test.ts` (base-listener install and uninstall accounting, the passive-conflict throw, `fireEvent`'s element requirement) still passes unchanged.

### Button pressed state — unit-testable

Assert on `RecordingDOMSink.writes`, matching `apply` patches that carry `toggleClass`, as `tests/component/button/ToggleButton.test.ts` already does for `.selected`.

13. A `pointerdown` with `button: 0, pointerId: 1` on the button's element produces an `apply` write with `toggleClass: { pressed: true }`.
14. A `pointerdown` with `button: 2` produces no such write.
15. A `pointerdown` on a **descendant** of the button produces `toggleClass: { pressed: true }` — the wiring is a subtree listener.
16. A `pointerup` with the same `pointerId`, dispatched on an unrelated element, produces `toggleClass: { pressed: false }`.
17. A `pointerout` whose `relatedTarget` is outside the button produces `toggleClass: { pressed: false }` while the press is still recorded; a following `pointerover` with the same `pointerId` and `buttons: 1` produces `toggleClass: { pressed: true }` again.
18. A `pointerover` with the same `pointerId` and `buttons: 0` produces `toggleClass: { pressed: false }` and removes the viewport `pointerup` registration (assert the sink's `removeListener` write for `pointerup`).
19. A `pointerout` whose `relatedTarget` is a descendant of the button produces no `pressed: false` write.
20. `keydown` with `key: " "` produces `toggleClass: { pressed: true }`; `keyup` with the same key produces `toggleClass: { pressed: false }`.
21. A `pointerdown` on a button with `enabled: false` produces no pressed write.
22. Calling `dispose()` on a button mid-press leaves its id out of `Event._registeredComponentIds()` — `Component.destructor` purges the viewport registrations `_beginPointerPress` added.

### Behaviour that needs manual verification in a browser

The offline harness has no hit-testing and no native `click` computation, so these are checked by hand on the dev app (`npm run dev`, then a screen with ordinary buttons, a flat toolbar, a window with controls, and a date field).

23. Press a button, drag off it, release: the sunken look clears as the pointer leaves, and **no action fires**.
24. Press a button, drag off it, drag back on, release: the sunken look returns, and the action fires exactly once.
25. Right-press a button: no sunken look, no action, and the application's context menu still opens.
26. Middle-press a button: no sunken look, no action.
27. Focus a button and press Enter, then Space: the button reads sunken while held and actions once each.
28. A `flat` button and a window control button both still show their themed press fill on a primary press.
29. Right-click outside an open menu or popover still dismisses it.
30. Right-press inside a date-picker dropdown does not blur the host field or close the dropdown.
31. Right-press on a background window still raises it to the front.
32. A tooltip hides when its anchor is right-pressed.
33. On a touch device: tapping a button presses and actions it; dragging off into a scroll clears the pressed look (the browser fires `pointercancel`).

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
grep -rn ":active" packages/lib/src/typescript/lib/                        # one match: Header.ts:137
grep -rn "\.listeners\.includes\|\.listeners\.indexOf" packages/lib/src/   # zero matches
grep -rn "buttons: \"any\"" packages/lib/src/typescript/lib/ | wc -l       # 8
```

Manual smoke test: `npm run dev` (app on `localhost:8015`) and walk cases 23-33 above.

---

## Documentation Impact

- **`packages/lib/docs/concepts/events.md`** — add a `## Mouse-button filtering` section after `## Scroll, wheel, and touch listeners are passive` (line 190), holding the defaults table and the worked-cases table from `## Architecture Decisions`, plus the opt-in example. Extend the `## addListener` section's prose with one sentence pointing at the new section, and update the `## See also` right-click-menu bullet to note that `contextmenu` is unfiltered. The `## When to use which` table needs no new row.
- **`packages/lib/docs/components/Button.md`** — lines 3, 99 and 131 describe the `:active` / `:hover:not(:active)` rules. Rewrite them in terms of `.pressed` / `:hover:not(.pressed)`, and state that the pressed state follows the primary button only and clears when the pointer is dragged off the button before release.
- **`packages/lib/docs/concepts/theming.md`** — lines 52, 54 and 55 name `:active` in the token descriptions. Change to `.pressed`.
- **`packages/lib/docs/concepts/performance.md`** — line 151 cites `Button` (`:active`) as an example of a second CSS rule. Change to `.pressed`.
- **`packages/lib/docs/reference/changelog/next.md`** — add a *Breaking changes → Core* entry for the new default (a bare press-type listener no longer fires for non-primary buttons, with the opt-in shown) and a *Changed → Components* entry for `Button`'s pressed state moving from `:active` to `.pressed`. Do not touch a numbered changelog page.
- `npm run docs:llms` regenerates `packages/lib/llms.txt`; commit the regenerated file.

---

## Potential Challenges

- **A synthetic `click` must not be filtered away.** `Event.fireEvent(component, "click")` dispatches a `CustomEvent` with no `button` property, and that is how `Button.click()` works ([Button.ts:1517-1521](src/typescript/lib/component/button/Button.ts#L1517)). `passesButtonFilter` returns `true` for any non-numeric `button`, which covers it; case 6 in `## Expected Behaviour` pins it.
- **Existing tests dispatch events without a `button`.** `makeEvent` leaves `button` undefined unless the caller supplies it, so no existing test starts failing. Do not "fix" this by defaulting `makeEvent`'s `button` to `0`.
- **A press on a pointer-opaque child.** `Button`'s content row, title column, label and glyph all set `pointerEvents: "none"`, but `SplitButton`'s chevron sets `"auto"` ([SplitButton.ts:141](src/typescript/lib/component/button/SplitButton.ts#L141)). Subtree registration is what keeps the whole button reading pressed when the chevron is pressed, matching what `:active` does today.
- **Touch keeps the pressed look while the finger drags away.** The browser implicitly captures a touch pointer, so `pointerout` never fires for it. The press still ends correctly on `pointerup` or `pointercancel`, and a drag that becomes a scroll raises `pointercancel`. Verify case 33 by hand; do not add pointer hit-testing to close the remaining gap.
- **A stale press if the user releases outside the window.** No `pointerup` is delivered. The `event.buttons` check in `_onPointerOver` ends the press the next time the pointer crosses back onto the button, and `_onBlur` ends it if focus moves first.
- **Ordering inside `Button`'s constructor.** `_installPressTracking` must run after `super()` returns, because the handlers are arrow-function class fields. Placing the call immediately before the `applyListeners` guard satisfies that.

---

## Critical Files

- [`src/typescript/lib/core/Event.ts`](src/typescript/lib/core/Event.ts) — the whole file; the three dispatchers and six registration functions are all edited.
- [`src/typescript/lib/component/button/Button.ts:376-397`](src/typescript/lib/component/button/Button.ts#L376) — the two lazy state-rule getters, and [`:434-535`](src/typescript/lib/component/button/Button.ts#L434) the constructor body where the wiring is added.
- [`src/typescript/lib/component/button/ToggleButton.ts:29-63`](src/typescript/lib/component/button/ToggleButton.ts#L29) and [`:139-150`](src/typescript/lib/component/button/ToggleButton.ts#L139) — the precedent for a JS-toggled class backed by a `createStyleRule` rule.
- [`src/typescript/lib/component/container/Scrollbar.ts:907-927`](src/typescript/lib/component/container/Scrollbar.ts#L907) — the precedent for installing viewport listeners for the duration of a gesture and removing them at the end.
- [`src/typescript/lib/overlay/Notification.ts:365-400`](src/typescript/lib/overlay/Notification.ts#L365) — the precedent for the `relatedTarget`-inside guard on boundary events.
- [`src/typescript/lib/component/input/Slider.ts:542-592`](src/typescript/lib/component/input/Slider.ts#L542) — the framework's one `setPointerCapture` user, read to see why a slider is the case where capture is right and a button is not.
- [`src/typescript/lib/core/Component.ts:1003`](src/typescript/lib/core/Component.ts#L1003) — `createStyleRule`, the deferred state-rule builder both button rules go through.
- [`tests/dom/TestDOM.ts:1464-1496`](tests/dom/TestDOM.ts#L1464) — `makeEvent`, which already carries `button` and `buttons`.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Event handling* (listeners must reference a named function; a component listens only on itself; hover uses the bubbling pair) and *All attributes and styles go through typed setters*.

---

## Non-Goals

- **`Header`'s `:active` rule** ([Header.ts:137](src/typescript/lib/component/table/cell/Header.ts#L137)) keeps using the pseudo-class. It is a pooled table-cell renderer, not a `Button`; giving it JS press tracking means adding per-cell listeners to the row pool, which is a separate change with its own cost.
- **No public `isPressed()` on `Button`.** Nothing in the framework or the docs needs to read the state, and adding a getter would make an internal visual flag part of the contract.
- **No change to the `"action"` event or to `Button.click()`.** Activation is unchanged by design.
- **No removal of the existing manual `e.button !== 0` guards** in `DragManager` and `DiagramView`.
- **No new pressed-state theme tokens.** The `--ts-ui-button-pressed-*` and `--ts-ui-button-flat-pressed-*` tokens are reused as they are; only the selector carrying them changes.
- **No `auxclick` support surface.** A consumer that wants middle-click behaviour registers `mousedown` with `{ buttons: "auxiliary" }`, or `auxclick`, which is unfiltered.

---

## Notes

[^native-click]: Two alternatives to native `click` were considered and rejected. **Synthesising activation from `pointerup`** — treat a release over the button as the action and stop listening for `click` — re-implements a browser behaviour that is much larger than it looks: keyboard activation on a native `<button>` (Enter on keydown, Space on keyup), the touch compatibility path, `detail` click counting and its `dblclick` pairing, and assistive-technology activation, which arrives as a bare `click` with no pointer events preceding it at all. A screen-reader user would lose every button in the framework. **Keeping `:active` and filtering it** is not possible: CSS has no selector for "which mouse button is down", which is the reason this plan exists.

[^why-not-capture]: `setPointerCapture` looks attractive because it guarantees the release is delivered — with capture, `pointerup` always arrives even when the pointer left the window. It is rejected because the Pointer Events specification retargets `click`, `auxclick` and `contextmenu` to the capturing element, not to the element actually under the pointer at release. A button that captures the pointer on `pointerdown` therefore fires `click` even when the user deliberately dragged away to cancel — destroying the one affordance this design exists to preserve. Capture would also make the *visual* harder rather than easier: with the pointer captured, `pointerover` / `pointerout` no longer describe the real element under the pointer, so tracking insideness would need a hit test on every `pointermove`. The chosen scheme gives up guaranteed release delivery, and buys that back with the `event.buttons` recheck on the next `pointerover`.

[^subtree-and-viewport]: Two sub-decisions sit here. **Subtree rather than exact-target** for the press and boundary events: `:active` matches every ancestor of the pressed element, so today a press on `SplitButton`'s pointer-opaque chevron ([SplitButton.ts:141](src/typescript/lib/component/button/SplitButton.ts#L141)) makes the whole button read pressed. An exact-target registration only matches events whose target *is* the button's own element, which would silently drop that case; a subtree registration reproduces `:active`'s ancestor behaviour exactly. **Viewport rather than element-scoped** for `pointerup` / `pointercancel`: a release that happens off the button never targets the button, so an element-scoped listener would never hear the press end, and the button would stay stuck in its pressed state. A viewport `pointermove` firehose was also considered for the insideness tracking and rejected — `pointerover` / `pointerout` give the same answer, computed by the browser, and fire only at boundary crossings instead of on every pointer sample.

[^filter-in-dispatcher]: The alternative was to wrap the listener at registration time — store a closure that tests the button and forwards to the real handler. That was rejected because removal is by function identity throughout the `Event` module (`removeListener` and friends take the exact callback reference the caller registered), so a wrapper would need a second map from original to wrapper, kept in step across `reindexComponent` and `purgeComponent`. Storing the filter beside the listener costs one field and leaves every removal path matching on the original reference.

[^opt-in-sites]: The eight sites were found by reading every `mousedown` / `mouseup` / `click` / `dblclick` / `pointerdown` / `pointerup` registration in `src/typescript/lib` and asking what the handler is for. Everything else falls into two groups that primary-only filtering fits or improves: gesture starts and ends (`Scrollbar`, `SplitGutter`, `ResizeHandle`, `Header` resize, `TabBar` drag, `AbstractWindow` move and snap, `Accordion` gutter, `DragManager`), where a drag now cannot be started by a right-press and its viewport release listener now matches the button that started it; and activation (`Button`, `ToggleButton`, `MenuItem`, `Checkbox`, `RadioButton`, `Toggle`, `Link`, `ComboBox`, list, tree, table and chart click handlers), which browsers already restrict to the primary button. `contextmenu` registrations — `Tree`, `DiagramView`, `AbstractSelectableList`, `TabBar`, `ParentHeader`, `CollapseButton`, `Body` — need no change, because `contextmenu` is not in the primary-by-default set.

[^redundant-guards]: Both guards become redundant once `mousedown` and `pointerdown` default to primary-only. They stay for two reasons: `DiagramView`'s is one clause of a larger three-clause condition, so removing it would mean rewriting a condition this plan otherwise does not touch; and both are cheap, correct, and self-documenting at their call site. Removing them would widen the diff into components with no other stake in this change.
