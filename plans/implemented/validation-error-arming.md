---
depends-on: [field-decorator-pointer-tooltip, tooltip-idle-reattach]
touches-shared:
  - packages/lib/src/typescript/lib/overlay/Tooltip.ts
  - packages/lib/docs/components/Tooltip.md
  - packages/lib/docs/reference/changelog/next.md
---

# Validation Error Arming — Implementation Plan

## Overview

A `FieldDecorator`'s error tooltip never appears while the pointer is already sitting on the field. `Tooltip`'s hover delay is started only by a `mouseover` ([`overlay/Tooltip.ts:461`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L461)), and the browser fires no `mouseover` under a pointer that has not moved. The decorator's error uses `Tooltip.attachCovering`, a covering attachment: it listens across the decorator's whole subtree, and it ignores every `mouseover` raised by a move between two elements inside that subtree ([`overlay/Tooltip.ts:664`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L664)), so even moving within the field does not start the delay. `FieldDecorator.showError` ([`validation/FieldDecorator.ts:72`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts#L72)) therefore shows nothing until the pointer leaves the field and comes back, while its own JSDoc promises the error "when the pointer rests anywhere on the decorated field". Validation on change after a click into a field is the usual path into this, not an edge case.[^symptom]

The fix gives `Tooltip` one piece of shared state — the pointer's last known viewport position — and makes the attach call itself start the hover delay when that position lies on the component being attached. The position is kept current by a single viewport `mousemove` listener that `Tooltip` installs with its first attachment and then keeps, replacing the per-attachment `mousemove` listener each attachment registers today ([`overlay/Tooltip.ts:489`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L489)).

The change is confined to [`overlay/Tooltip.ts`](packages/lib/src/typescript/lib/overlay/Tooltip.ts) plus JSDoc on [`validation/FieldDecorator.ts`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts). No public signature moves. Both `attach` and `attachCovering` gain the behaviour, because both run through `_attachWith` ([`overlay/Tooltip.ts:446`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L446)).

---

## Architecture Decisions

### The attach call does the catch-up, not a later pointer event

`_attachWith` starts the hover delay itself when the pointer already rests on the component. Nothing in the hover listeners changes to make an intra-component move start a delay.[^state-change]

This mirrors how the library already answers a state change the browser will not report under a stationary pointer: `SplitGutter.setMovable` drops its own hover wash when it locks ([`component/container/SplitGutter.ts:330`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L330)), `Menu.clearItemHighlights` clears the highlight of an item whose panel was detached under the pointer ([`overlay/Menu.ts:726`](packages/lib/src/typescript/lib/overlay/Menu.ts#L726)), and `Tooltip.attachToElement` repaints a tooltip that is on screen for the element whose text just changed ([`overlay/Tooltip.ts:823`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L823)). In each case the code that changed the state performs the catch-up on the spot.

### One pointer position for the whole singleton

`Tooltip` keeps `pointerX` / `pointerY` as static state, written by every attachment's `mouseover` handler and by one viewport `mousemove` listener. Each attachment's own `mousemoveFn` is deleted — it held a private copy of the same fact.[^one-position]

### The pointer watch starts with the first attachment and then stays

`_attachWith` installs the viewport `mousemove` listener the first time it records an attachment, behind a `pointerWatching` guard, and nothing removes it afterwards. The owner is a static sentinel `Component`, as `Notification`'s resize listener uses ([`overlay/Notification.ts:119`](packages/lib/src/typescript/lib/overlay/Notification.ts#L119), [`:645`](packages/lib/src/typescript/lib/overlay/Notification.ts#L645)). The one place this departs from that precedent is the uninstall half of the pair, which the tooltip watch must not have.[^watch-stays]

One consequence to plan around: the pointer's position is unknown until the app's first tooltip attachment exists. A `showError` that is the very first `attach`-family call of the session, under a pointer that has not moved since load, still waits for the pointer to move. Every later call has a current position.

`_stopPointerWatch` exists as the teardown seam: the test suite calls it so one test file's registration cannot outlive the DOM it was made against.[^teardown]

### The "rests on" test is a hit test, and the mode picks its rule

The pointer rests on the component when the topmost element at the last known position is the component's own element (a plain `attach`) or that element or anything inside it (an `attachCovering`). A never-rendered component, and an unknown pointer position, both read as "not resting".[^hit-test]

| At a changed `attach` / `attachCovering` call | Mode | Topmost element at the last known pointer position | Starts the delay? |
|---|---|---|---|
| The watch has recorded nothing yet | either | — | no |
| Pointer last seen over a decorated field's `<input>` | covering, on the decorator | the `<input>`, inside the decorator | **yes** |
| Pointer last seen over that same `<input>` | plain, on the decorator | the `<input>`, not the decorator's own element | no |
| Pointer last seen over a button's own element | plain, on that button | the button's element | **yes** |
| Pointer last seen over a different field | either | an element outside the component | no |
| Pointer last seen over the component, another component's delay running | either | inside the component | no |

The last row follows the rule `mouseoverFn` already applies: a delay another component started is never taken over ([`overlay/Tooltip.ts:468`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L468)).

### A press suppresses the component it pressed until the next keyboard input

*Added after implementation, by the user's decision on the third audit round —
this reverses what `[^state-change]` concluded.*

A press dismisses the tooltip and also marks the component it pressed, which is
then refused an attach-time arm until the next keyboard input lifts the mark.
`mouseoverFn` is untouched, so a real re-hover still shows the tooltip as it
always did.

`[^state-change]` reasoned that the press rule survives the attach-time arm
"because a press attaches nothing". That is true of `FieldDecorator`, and false
of a control that re-derives its own hint from the gesture that pressed it. The
case that decided it is `SplitGutter`: `Split.placeGutterAsStrip` calls
`setOpaque(true)` from inside the layout pass a collapse triggers
([`layout/Split.ts:2216`](packages/lib/src/typescript/lib/layout/Split.ts#L2216)),
`setOpaque` re-derives the chevron's hint through `Tooltip.attach`
([`component/container/SplitGutter.ts:399`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L399),
[`:469`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L469)),
and the chevron is what the pointer just pressed — so every collapse and expand
of a core layout raised a "Click to expand …" hint beside the pointer, half a
second after the click, next to a chevron that had moved away. A visible stray
tooltip on every use of a shipped component is a regression, not a limitation to
document, which is why this reverses the earlier decision rather than recording
it as a known cost.

Keyboard input is what lifts it because that is the sequence the plan exists
for: click into a field, type, and the message describing what was typed must
still appear. The mark names the pressed component's own id, so a press nobody
types after suppresses nothing but that one component — a global flag would have
held back every later attachment in the session.

### `attachToElement` keeps its own cursor tracking

The raw-element family keeps its own `lastX` / `lastY` and its own `mousemove` listener, and gains no arming. Its listeners are native, registered through `DOM.sink` rather than the `Event` API, its timer sits outside `pendingId`, and it already repaints a tooltip that is on screen when its text changes.[^raw-element]

---

## Internal Structure

New static state on `Tooltip`, beside the existing `activeElement` / `pendingId` / `watching` block:

```typescript
// The pointer's last known viewport position, and whether the watch below has
// recorded one yet. `pointerKnown` stays false until the first `mouseover` or
// `mousemove` after the watch is installed, so a position nobody has measured
// is never mistaken for the origin of the viewport.
private static pointerX: number = 0;
private static pointerY: number = 0;
private static pointerKnown: boolean = false;

// Owner of the viewport `mousemove` listener that keeps `pointerX` /
// `pointerY` current, and whether that listener is installed. Installed with
// the first attachment and kept for the session. Distinct from `watching`,
// which is the anchor watch installed only while a tooltip is on screen. One
// stable sentinel owns a static handler, as `Notification`'s resize-listener
// owner does.
private static readonly pointerWatchOwner: Component = new Component();
private static pointerWatching: boolean = false;
```

New members, all private:

```typescript
private static readonly _recordPointer = (e: MouseEvent): void => { /* … */ };
private static _startPointerWatch(): void;
private static _stopPointerWatch(): void;
private static _pointerRestsOn(component: Component, covering: boolean): boolean;
private static _armHoverDelay(component: Component, text: string, colors: TooltipColors | undefined): void;
```

`_armHoverDelay` is the body lifted out of `mouseoverFn`, with the cursor read moved inside the timer so the tooltip still lands where the pointer came to rest rather than where it entered:

```typescript
private static _armHoverDelay(component: Component, text: string, colors: TooltipColors | undefined): void {
    Tooltip.showTimer = setTimeout(() => {
        Tooltip._applyColors(colors);
        // Record the anchor so the anchor-watch dismisses the tooltip if
        // this component is later removed from the DOM.
        Tooltip.activeElement = component.getElement() ?? null;
        Tooltip.show(text, Tooltip.pointerX, Tooltip.pointerY);
        Tooltip.showTimer = null;
    }, TOOLTIP_HOVER_DELAY_MS);

    // Record who armed it, so only this component's own `detach` can cancel
    // the wait. `show` clears the pointer again as it runs.
    Tooltip.pendingId = component.getId();
}
```

`_pointerRestsOn` returns before touching layout whenever the position is unknown or the component has no element:

```typescript
private static _pointerRestsOn(component: Component, covering: boolean): boolean {
    const element = component.getElement() ?? null;

    if (!Tooltip.pointerKnown || element === null) {
        return false;
    }

    const [hit] = DOM.source.elementsFromPoint(Tooltip.pointerX, Tooltip.pointerY);

    if (hit === undefined) {
        return false;
    }

    return covering ? DOM.source.contains(element, hit) : hit === element;
}
```

`_attachWith` installs the watch with the attachment it records, then starts the delay:

```typescript
private static _attachWith(component, text, colors, covering): void {
    const current = Tooltip.attachments.get(component.getId());

    if (current !== undefined && Tooltip._sameAttachment(current, text, colors, covering)) {
        return;
    }

    Tooltip.detach(component);

    /* … build and register the three listeners, record the attachment … */

    Tooltip._startPointerWatch();

    /* … teardown hook … */

    // No `mouseover` reaches a pointer that is already resting on this
    // component, so the attach starts the delay itself. `showTimer` is this
    // component's only after the detach above, so a non-null one belongs to
    // another component and is left alone.
    if (Tooltip.showTimer === null && Tooltip._pointerRestsOn(component, covering)) {
        Tooltip._armHoverDelay(component, text, colors);
    }
}
```

The hover delay's 500 ms moves into a module constant beside `TOOLTIP_ANIM_DURATION_MS`, used by `_armHoverDelay` and by `attachToElement`'s timer:

```typescript
/** The hover dwell a pointer must hold before a tooltip appears. */
const TOOLTIP_HOVER_DELAY_MS: number = 500;
```

---

## Ordered Implementation Steps

1. **Write the failing cases first.** Add the new cases listed in `## Expected Behaviour` to `packages/lib/tests/unit/validation/FieldDecorator.pointerTooltip.test.ts` (cases 17–22) and `packages/lib/tests/overlay/Tooltip.pointer.test.ts` (cases 3–5). `Tooltip.pointer.test.ts` needs a `move(target, x, y)` helper that dispatches a real `mousemove` through `Event`'s window handler — copy the one at `FieldDecorator.pointerTooltip.test.ts:165`. Run `npm test` and confirm the new cases fail and nothing else does.

2. **Add the hover-delay constant.** In `packages/lib/src/typescript/lib/overlay/Tooltip.ts`, add `TOOLTIP_HOVER_DELAY_MS` next to `TOOLTIP_ANIM_DURATION_MS` (`:13`) and use it at both existing `setTimeout(…, 500)` sites (`:482` and `:783`). Check: `grep -n '500' packages/lib/src/typescript/lib/overlay/Tooltip.ts` — expect no bare `500` left as a timer argument.

3. **Add the pointer state and the watch.** In the same file, add the `pointerX` / `pointerY` / `pointerKnown` / `pointerWatchOwner` / `pointerWatching` statics beside `pendingId` (`:95`), and the `_recordPointer`, `_startPointerWatch` and `_stopPointerWatch` members. `_startPointerWatch` returns at once when `pointerWatching` is already `true`, otherwise calls `Event.addViewportListener(Tooltip.pointerWatchOwner, "mousemove", Tooltip._recordPointer)` and sets the flag. `_stopPointerWatch` returns at once when the flag is `false`, otherwise calls `Event.removeViewportListener` with the same three arguments and clears both `pointerWatching` and `pointerKnown`. `_recordPointer` writes both coordinates and sets `pointerKnown` to `true`.

4. **Extract `_armHoverDelay`.** Move `mouseoverFn`'s `setTimeout` body and its `pendingId` write into the new private method (body in `## Internal Structure`), reading `Tooltip.pointerX` / `Tooltip.pointerY` inside the timer callback.

5. **Rewrite `mouseoverFn`.** It calls `Tooltip._recordPointer(e)` first, then applies the existing covering claim and `showTimer` guards unchanged, then calls `Tooltip._armHoverDelay(component, text, colors)`. Delete the `cursorX` / `cursorY` locals (`:458-459`).

6. **Delete the per-attachment `mousemove` listener.** Remove `mousemoveFn` from the closure (`:489-492`), from the `TooltipAttachment` interface (`:41`), from the attachment literal (`:519`), from `_addHoverListeners` (`:682`, `:690`) and from `_removeHoverListeners` (`:705`, `:713`). Both helpers' JSDoc says "four hover listeners" (`:673`, `:696`) — make it three. Check: `grep -n 'mousemoveFn' packages/lib/src/typescript/lib/overlay/Tooltip.ts` — expect matches only inside `ElementTooltipAttachment` and `attachToElement`.

7. **Add `_pointerRestsOn`,** with the body in `## Internal Structure`, next to `_containsTarget` (`:643`) whose `DOM.source.contains` shape it follows.

8. **Wire the arming into `_attachWith`.** Add the `_startPointerWatch()` call after `Tooltip.attachments.set(…)` and the closing arm block, both as shown in `## Internal Structure`. `detach` is not touched: the watch outlives every attachment.

9. **Update the JSDoc that states the contract.** `attach` (`:384-409`) and `attachCovering` (`:414-428`) each gain one sentence: an attach that changes the attachment also starts the hover delay when the pointer is already resting on the component, so the tooltip does not wait for the pointer to leave and come back. `_attachWith`'s own JSDoc (`:433-445`) states the same. `FieldDecorator.showError` (`validation/FieldDecorator.ts:59-71`) gains a sentence saying a changed message appears without moving the pointer.

10. **Fix the listener counts the tests pin.** In `packages/lib/tests/unit/validation/FieldDecorator.pointerTooltip.test.ts:63-65` and `packages/lib/tests/overlay/Tooltip.identicalAttach.test.ts:52-54`, change `HOVER_LISTENERS` from `4` to `3` and reword each comment to name `mouseover`, `mouseout` and `mousedown`.

11. **Add the watch teardown to the tooltip test files.** In every `afterEach` that already clears `Tooltip.attachments` — `Tooltip.test.ts:319` and `:413`, `Tooltip.identicalAttach.test.ts:189`, `Tooltip.pointer.test.ts:150` and `FieldDecorator.pointerTooltip.test.ts:225` — add `(Tooltip as any)._stopPointerWatch();` before `DOM.reset()`. `Tooltip.test.ts:101` attaches nothing and needs no change.[^teardown]

12. **Run the suite.** `npm test`. Any other file that leaves an attachment behind takes the same one-line addition; nothing else should move.

13. **Update the docs and the changelog** as listed in `## Documentation Impact`.

14. **Final checks.** `npm run typecheck`, `npm run lint`, `npm test`, `npm run docs:api` (zero warnings), `npm run docs:llms:check`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Tooltip.ts` |
| Modify | `packages/lib/src/typescript/lib/validation/FieldDecorator.ts` |
| Modify | `packages/lib/tests/unit/validation/FieldDecorator.pointerTooltip.test.ts` |
| Modify | `packages/lib/tests/overlay/Tooltip.pointer.test.ts` |
| Modify | `packages/lib/tests/overlay/Tooltip.identicalAttach.test.ts` |
| Modify | `packages/lib/tests/overlay/Tooltip.test.ts` |
| Modify | `packages/lib/docs/components/Tooltip.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

Added during implementation, each recorded in `## Implementation Notes`:

| Action | File | Why |
|---|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` | `DOMSource.isRegistered`, the non-throwing liveness query the two remembered handles need |
| Modify | `packages/lib/tests/dom/TestDOM.ts` | the modelled source's `isRegistered`, and `has` on the handle table |
| Modify | `packages/lib/tests/dom/handle-registry.test.ts` | the new query's own semantics, against the production registry |
| Modify | `packages/lib/docs/concepts/dom-seams.md` | the one documented exception to resolve-throws |
| Modify | `packages/lib/tests/component/layout/Split.resizeMode.test.ts` | the watch teardown its `keydown` registration made necessary |
| Modify | `packages/lib/tests/component/layout/Accordion.resizeMode.test.ts` | the same |

---

## Expected Behaviour

Every numbered case below is unit-testable with the modelled DOM, in the shape the two pointer test files already use: real events dispatched through `Event`'s window handler, fake timers, and `Tooltip.show` spied on. The manual check at the end is the one behaviour the offline harness cannot reach.

**In `FieldDecorator.pointerTooltip.test.ts`** (`ERROR`, `HOVER_DELAY_MS` and the `enter` / `move` / `press` helpers already exist):

17. *A changed error under a resting pointer shows without a re-hover.* Decorate a `TextField`; `showError(ERROR)`; `enter(field element)`; advance `HOVER_DELAY_MS`; `move(field element, restX, restY)` at the field's centre; `showError('Too short')`. Then `pendingId` is the decorator's id, and after another `HOVER_DELAY_MS` the shown texts are `[ERROR, 'Too short']`, the second shown at `(restX, restY)`.

18. *A first error under a resting pointer shows without a re-hover.* `Tooltip.attach(root, 'Root hint')` first, so the pointer watch is installed; `root` has no size, so the modelled hit test never returns it. `move(field element, restX, restY)`. Then `showError(ERROR)` sets `pendingId` to the decorator's id, and after `HOVER_DELAY_MS` the shown texts are `[ERROR]`.

19. *An error attached while the pointer is elsewhere stays silent.* Same setup as 18, but the move goes to a point outside the decorator. `showError(ERROR)` leaves `pendingId` `null`, and after `HOVER_DELAY_MS` nothing has been shown.

20. *A second decorator's changed error does not disturb the first's running delay.* This is case 9 with the pointer's position now known: two decorated fields in error; `enter(first field element)`; `move(first field element, restX, restY)` at the first field's centre; `second.showError('Other, changed')`. The recorded position lies on the first field, not the second, so `pendingId` is still the first decorator's id and after `HOVER_DELAY_MS` the shown texts are `[ERROR]`.

21. *A second changed message arms again, with no pointer movement in between.* Continue case 17's sequence without another `move`: `showError('Wrong format')`. `pendingId` is the decorator's id again, and after `HOVER_DELAY_MS` the third shown text is `'Wrong format'`, still at `(restX, restY)`.

22. *The watch is installed once and outlives the attachment.* Record `Event.listenerCounts().viewport`; `showError(ERROR)` raises it by one; `clearError()` leaves it raised; a second `showError(ERROR)` leaves it raised and adds nothing further.

**In `Tooltip.pointer.test.ts`** (`nestedHosts`, `ON_OUTER`, `ON_INNER`):

3. *A plain attach arms over the host's own element.* `move(outerEl, ON_OUTER.x, ON_OUTER.y)`; `Tooltip.attach(outer, 'Changed')`. Then `pendingId` is `outer`'s id and after `HOVER_DELAY_MS` the shown texts are `['Changed']`.

4. *A plain attach does not arm when a child covers the point.* `move(innerEl, ON_INNER.x, ON_INNER.y)`; `Tooltip.attach(outer, 'Changed')` leaves `pendingId` `null` and shows nothing, while `Tooltip.attach(inner, 'Changed too')` from the same position sets `pendingId` to `inner`'s id.

5. *A never-rendered component never arms.* `move(outerEl, ON_OUTER.x, ON_OUTER.y)`; `Tooltip.attach(stray, 'Nowhere')` for a `new Component({})` that is never rendered leaves `pendingId` `null` and leaves `Tooltip`'s singleton unbuilt. Dispose that component at the end of the case, so its registrations do not outlive it.

**Unchanged, and re-run as regressions** — every case in the four tooltip test files, in particular: an identical attach still changes nothing (`identicalAttach` 13, 14, 17, 18); a changed error still dismisses the tooltip on screen before the new delay starts (`identicalAttach` 15); a press still leaves the error hidden while the pointer stays on the field and no attach happens (`FieldDecorator.pointerTooltip` 12); leaving during the delay still cancels it (13); the tooltip still lands where the pointer came to rest (14).

**Manual check.** Run the demo (`npm run dev`), open the **Binding** tab, click into the **Name** field and type past its limit without moving the mouse. The red outline and the error tooltip appear together after the hover delay. Keep typing so the message changes: the tooltip re-appears with the new text, again without moving the pointer. Move the pointer off the field: the tooltip goes. This is the behaviour the offline harness cannot show, since it models neither real pointer input nor painting.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm test` — the whole suite, including the new cases and the four tooltip files' existing ones.
- `grep -n 'mousemoveFn' packages/lib/src/typescript/lib/overlay/Tooltip.ts` — matches only in `ElementTooltipAttachment` and `attachToElement`.
- `grep -rn 'HOVER_LISTENERS' packages/lib/tests/` — both definitions read `3`.
- `npm run docs:api` — finishes with zero warnings.
- `npm run docs:llms:check` — passes.
- The manual check in `## Expected Behaviour`.

---

## Documentation Impact

- **`packages/lib/docs/components/Tooltip.md`.** The "Attach to a component" section says the tooltip appears 500 ms after the pointer enters the component. Add that attaching, or changing, a tooltip while the pointer is already resting on the component starts the same delay, so a tooltip whose text changes under a still pointer appears without leaving and re-entering.
- **`packages/lib/docs/reference/changelog/next.md`.** One entry under `## Fixed` → `### Overlay`, in the established shape: a bold sentence naming the fix, then what was wrong and what consumers must do. Name `FieldDecorator`'s validation error as the case that motivated it, and end with "No consumer action is needed."
- **No API-surface change.** `Tooltip` and `FieldDecorator` are already exported from `@jimka/typescript-ui/overlay` and `@jimka/typescript-ui/validation`; no barrel, catalog or sidebar entry moves, and `llms.txt`'s one-line `Tooltip` entry still reads true.
- **JSDoc only links public symbols.** The new sentences on `attach`, `attachCovering` and `showError` describe the behaviour in prose and must not `{@link}` any of the new private members.

---

## Potential Challenges

- **A changed attach now forces a synchronous layout.** `_pointerRestsOn` calls `elementsFromPoint`. It runs only when the attachment actually changes — an identical call still returns first — and returns before the hit test when no pointer position is known, so an app that never moves the pointer pays nothing.
- **The watch outlives every attachment.** Once installed it stays for the session, so an app that detaches every tooltip keeps one window-level `mousemove` handler that writes two numbers. That is the price of a position that is never stale, and it is less work per move than the per-attachment listeners it replaces. The test suite removes it through `_stopPointerWatch`.
- **Nothing arms before the app's first attachment.** The position is unknown until then, so a `showError` that is the session's first `attach`-family call under a never-moved pointer still waits for a pointer move. Any app with a tooltip on a toolbar button or a field description has the watch running long before a form is filled in.
- **A tooltip appearing during a QA typing run.** `packages/qa`'s `form-*` panels call `showError` on every keystroke (`packages/qa/src/builders/form.ts:150`). A run whose earlier phase left the pointer over a decorated field will now show an error tooltip during the `type` phase, which moves that cell's seam counts. Re-baseline rather than treat a changed count as a regression. The form panel's tooltip-ownership target (`packages/qa/src/builders/form.ts:516`) is unaffected: it hovers the first field and afterwards only ever re-attaches the second, which the pointer is not over.
- **Another test file leaving an attachment behind.** A registration that outlives `DOM.reset()` makes later viewport `mousemove` deliveries in that file vanish. Step 11 covers the four tooltip files; step 12's full run finds any other.

---

## Critical Files

| File | Why |
|---|---|
| [`overlay/Tooltip.ts:446-533`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L446) | `_attachWith` and the attachment's hover listeners: every edit site |
| [`overlay/Tooltip.ts:543-573`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L543) | `detach`: what a replacement and a `clearError` already undo, and what this plan leaves alone |
| [`overlay/Tooltip.ts:643-677`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L643) | `_containsTarget` and `_claimCoveringHover`: the containment shape `_pointerRestsOn` follows, and the rule that makes an intra-field move no help |
| [`overlay/Tooltip.ts:105-120`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L105) | `watching` and `_onAnchorWatch`: the other viewport `mousemove` listener, which stays as it is |
| [`overlay/Notification.ts:119-120`, `:645-668`](packages/lib/src/typescript/lib/overlay/Notification.ts#L119) | The precedent: a sentinel `Component` owning one static viewport listener behind an installed-flag guard |
| [`component/container/SplitGutter.ts:330-344`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L330) | The precedent: a state change clears its own hover state, because no event will |
| [`overlay/Menu.ts:718-733`](packages/lib/src/typescript/lib/overlay/Menu.ts#L718) | The same precedent, for an element detached under a stationary pointer |
| [`validation/FieldDecorator.ts:59-92`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts#L59) | `showError` / `clearError`, and the contract this plan makes true |
| [`core/Binding.ts:435-468`](packages/lib/src/typescript/lib/core/Binding.ts#L435) | `_validateField`: the decorator is created once and reused, so `showError` runs both with and without a live attachment |
| [`core/Event.ts:801-858`](packages/lib/src/typescript/lib/core/Event.ts#L801) | `addViewportListener` / `removeViewportListener`, including the empty-map cleanup the test teardown relies on |
| [`core/DOM.ts:1610`, `:1912`](packages/lib/src/typescript/lib/core/DOM.ts#L1912) | `contains` and `elementsFromPoint`, the two seam reads `_pointerRestsOn` uses |
| [`tests/unit/validation/FieldDecorator.pointerTooltip.test.ts`](packages/lib/tests/unit/validation/FieldDecorator.pointerTooltip.test.ts) | The covering mode's sixteen pinned cases and the helpers the new ones reuse |
| [`tests/overlay/Tooltip.pointer.test.ts`](packages/lib/tests/overlay/Tooltip.pointer.test.ts) | The plain mode's nested-host cases, and where cases 3–5 go |
| [`tests/overlay/Tooltip.identicalAttach.test.ts`](packages/lib/tests/overlay/Tooltip.identicalAttach.test.ts) | What an unchanged attach must not disturb, and the listener-count constant |
| [`tests/dom/TestDOM.ts:1614-1635`](packages/lib/tests/dom/TestDOM.ts#L1614) | The modelled `elementsFromPoint`: paint order, no `pointer-events` model, zero-size elements skipped |

---

## Non-Goals

- **A nearest-tooltip-wins subtree mode.** `Tooltip.attach` still never arms over the parts that cover a composite field's own element — `DateField`, `TimeField`, `NumberSpinner`, `Toggle` and `Checkbox` — which is what `LabeledGrid`'s field descriptions hit. That needs a subtree mode with the opposite precedence rule to the covering one, and is its own design work.
- **`attachToElement` and `detachElement`.** Their native listeners, their own `lastX` / `lastY` tracking and their unconditional leave `hide()` are unchanged, and they gain no arming. The only edit they take is reading the shared hover-delay constant instead of a second literal `500`.
- **Accessibility.** The error is still invisible to assistive technology and is not revealed by focus.
- **Making `attachCovering` public.** It stays `@internal` until a second caller exists.
- **Naming `Tooltip`'s attach family as an exception in ARCHITECTURE.md.** The attach family listens on another component's events; the pointer watch added here does not — it is registered on `Tooltip`'s own sentinel owner — so the open documentation gap is neither widened nor closed here.

---

## Notes

[^symptom]: Two routes reach it. With no attachment on the decorator — the first error on a field, or any error after a `clearError` — `showError` installs a covering attachment under a pointer that will never raise another `mouseover`. With one already there, `_attachWith` detaches first, which fades the tooltip on screen, and then installs a replacement that nothing arms; that is the route found by hand in the demo app's **Binding** tab on 2026-09-24, where changing a field's text so the message changes fades the old tooltip and shows the new one only after the pointer leaves the field and returns. The post-merge audit of phase 2's follow-ups found the same defect by reading the code (`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md:297`).

[^state-change]: The alternative — letting a move between two elements inside a covering attachment start the delay — was rejected because it contradicts a pinned rule. `FieldDecorator.pointerTooltip.test.ts` case 12 requires that after a press the error stays hidden while the pointer stays on the field, including across a move from a date field's input onto its picker button, and `mousedownFn`'s own comment states that rule. Arming from an intra-component move would re-show the error on that same move. Arming from the attach call keeps case 12 intact, because a press attaches nothing. **Superseded in part:** a press attaches nothing *for `FieldDecorator`*, but not for a control that re-derives its own hint from the gesture that pressed it; see _A press suppresses the component it pressed until the next keyboard input_ above.

[^one-position]: Each attachment's `mousemoveFn` existed only to keep `cursorX` / `cursorY` current for that attachment's own timer, so with N attachments the library held N copies of one global fact and re-wrote them all on every pointer move. Folding them into one viewport listener is also the cheaper shape: a covering attachment's `mousemove` is a *subtree* registration, which makes `Event` walk from the move's target to the root on every pointer move — a cost the `field-decorator-pointer-tooltip` plan recorded as a known charge of an attached error. One viewport listener writing two numbers replaces both that walk and the per-element registrations. The trade accepted in return is that the listener is installed whenever any tooltip is attached, rather than only while one is hovered.

[^watch-stays]: Tearing the watch down with the last attachment was tried on paper and rejected: it breaks the case the plan exists for. `_attachWith` detaches before it re-attaches, so a decorator that holds the only attachment in the app empties `Tooltip.attachments` on every message change. A stop there would clear `pointerKnown`, and with the pointer still resting the re-installed watch would hear no `mousemove` to set it again — so the second and every later message change would fail to arm, which is exactly the repeated-change sequence a user types. Keeping the watch also removes the other failure it would introduce: a position recorded before a gap with no attachments, trusted afterwards, would arm a tooltip over a field the pointer had since left. The standing cost is one window-level `mousemove` handler writing two numbers, against the N per-attachment `mousemove` registrations it replaces.

[^hit-test]: `DOM.source.elementsFromPoint(x, y)[0]` is the topmost element at a point, which is what a real pointer would hit; `DOM.source.contains(element, hit)` is the containment test `_containsTarget` already uses against a `relatedTarget`, and it reports `true` for the element itself. Two other ways to answer "is the pointer inside" were rejected. Matching `:hover` through `DOM.source.matches` gives no coordinates for `Tooltip.show`, and the modelled source returns `false` for every selector (`tests/dom/TestDOM.ts:1455`), so nothing about it could be pinned offline. Comparing the position against the component's own rectangle is cheaper but wrong wherever something overlaps the component, and `elementsFromPoint` is the hit test `DragManager` already uses for the same question.

[^raw-element]: Converting `attachToElement` to the shared position would also be correct and would delete its `lastX` / `lastY` carry, but it is a separate change with its own risk surface: its callers are the table's header cells, which install a native listener per cell, and its mid-hover repaint already covers the one case this plan fixes for them — text changing while their tooltip is on screen. The `field-decorator-pointer-tooltip` plan drew the same line.

[^teardown]: `_stopPointerWatch` has no production caller — nothing removes the watch during a session — so it exists for teardown, and the test suite is what calls it. Skipping it is not an option: `Event` keeps its viewport registrations in module state that outlives `DOM.reset()`, so a registration left behind would sit in the map while its window handler pointed at the replaced window. The next test's viewport `mousemove` deliveries, and the anchor watch's own re-install, would then silently stop working — the same module-state hazard the tooltip test files' headers already warn about for `Event`'s installed listener types.

---

## Implementation Notes

**`_stopPointerWatch` is `@internal` rather than `private`.** `## Internal
Structure` lists the five new members as "all private", but a private member
with no production caller fails the library typecheck: `tsconfig.lib.json` sets
`noUnusedLocals`, and TypeScript reports TS6133 for an unread private static
method (confirmed on a probe file). Nothing calls this one during a session by
design, so it is declared `static _stopPointerWatch()` with an `@internal` tag
and a "for tests only" line — the shape the library already uses for a
test-only seam on an exported symbol (`Event._registeredComponentIds`,
`DragManager._registeredComponentIds`, `Text`'s instance count). It is excluded
from the API docs by `@internal`, exactly as `attachCovering` is. The
consequence for step 11 is that the five `afterEach` blocks call
`Tooltip._stopPointerWatch()` directly instead of through `(Tooltip as any)`,
since the member is now reachable and type-checked.

**`npm run docs:api` finishes with 14 warnings, not zero.** `## Verification`
expects zero. The 14 are pre-existing: the same count comes out of the tree with
this change stashed, and none of them names `Tooltip`, `FieldDecorator.showError`
or any member added here (they are `{@link}`s to excluded symbols from
`SpatialNavigation`, `rankInDirection`, `FieldDecorator`'s own class comment,
`MarkdownViewer` and `MarkdownEditor`). The new JSDoc adds no `{@link}` at all,
per `## Documentation Impact`, so it cannot add one.

**Both of the third audit round's findings came back from the user, not from
this run.** The audit loop reached its three-round cap with them open, the
branch was handed back, and the user decided both: a non-throwing liveness query
on the seam rather than a swallowed throw, and the press suppression rather than
a documented limit. Everything above that cites the third round is that
decision being carried out, not a judgement made here.

**The manual demo check was not run.** `## Expected Behaviour`'s closing step
asks for a real-pointer check in the demo app's **Binding** tab; this run was
not permitted to open a window on the user's desktop, so it is outstanding and
a human should still do it. The sequences it describes are pinned offline by
`FieldDecorator.pointerTooltip` 17 (a changed message under a resting pointer),
21 (a second change with no movement in between) and 19 (no arming when the
pointer is elsewhere), and by `Tooltip.pointer` 3–5 for the plain mode; what
only the demo can show is real pointer input and painting.

**No demo or example surface was added.** The plan's file table lists none, and
the behaviour is a fix to a path the demo's **Binding** tab already exercises —
the same tab the manual check uses — so there was nothing to add.

**One helper was factored out in the decorator's test file.** Cases 17–21 need
the rest point itself, not only the element under it, so
`FieldDecorator.pointerTooltip.test.ts` gained a `centreOf(component)` helper
and its existing `hitCentre` now reads through it rather than repeating the
rect-centre arithmetic.

**"Rests on" is answered from the last pointer event's target, not from
`elementsFromPoint`.** This reverses `[^hit-test]`, which chose the hit test and
rejected two alternatives — a `:hover` match and a rectangle comparison — but
did not consider the target the browser already resolved when it raised the
event. Two audit rounds found defects rooted in the hit test, and both come from
its being a forced synchronous layout:

- `SelectableListRow.applyTooltip` (`component/list/AbstractSelectableList.ts:436-441`)
  calls `Tooltip.attach` from `updateItem` for every row `syncRows` reconciles,
  so one `setItems` over a list whose items carry tooltips is one changed attach
  per row — up to N forced layouts interleaved with the rows' own DOM writes.
  `## Potential Challenges` had assumed a changed attach is rare.
- `Split.placeGutterAsStrip` calls `gutter.setOpaque(true)` — which re-derives
  the chevron's hint through `Tooltip.attach` — from *inside* the layout pass,
  before it writes the gutter's new x/y/size (`layout/Split.ts:2216-2227`,
  `component/container/SplitGutter.ts:399`, `:469-472`). A hit test there both
  forces a layout mid-pass and measures geometry the pass has not finished
  writing.

The recorded target costs neither: the browser resolved it when it raised the
event, so it already honours `pointer-events` — which the modelled
`elementsFromPoint` does not, as `FieldDecorator.pointerTooltip.test.ts`'s own
header warns — and reading it touches no layout. It is the same read
`_containsTarget` already performs on a `relatedTarget`, so it is also the shape
this file already uses. Every row of `## Architecture Decisions`' own "rests on"
table holds unchanged under it. An intermediate fix in the first audit round
memoised the hit test per pointer event; the second round showed the memo
outliving the task that motivated it, and this replaces it outright.

It buys those with two costs the plan did **not** already accept, and which are
new with this approach rather than inherited from `[^hit-test]` — the third
audit round found both, and the user decided both. The plan accepted a stale
*position*; under a pointer that has not moved that position stays exact, and a
hit test taken at attach time would have reflected the current layout. A
recorded *target* does not: a component moved, hidden or replaced under a still
pointer still reads as the one the pointer is on, until the pointer moves again.
`Split`'s collapse chevron was the visible instance, and the press suppression
in `## Architecture Decisions` is what settles it; what remains is a component
moved under a still pointer by something other than that pointer's own press,
which the `Tooltip` page states as a limit.

The second cost is that the recorded `Handle` can outlive the element it names,
and `DOM.source.contains` resolves it, which throws for a released or collected
handle — a disposed dialog or a re-rendered row under a still pointer would make
the next covering attach throw. `DOMSource` therefore gains `isRegistered`, the
one read that reports a dead handle rather than throwing on it, and both
`_pointerRestsOn` and the base's own anchor watch ask it before they use a
handle they merely remember. `resolve` still throws, so a genuine use-after-free
stays as loud as `core/DOM.ts` intends; the new member is public API and carries
its own breaking-change entry, TSDoc and a paragraph in the DOM-seams page. The
offline harness cannot reach a released handle — the modelled `contains` walks a
parent table without resolving (`tests/dom/TestDOM.ts:1415-1423`) — so the query's
own semantics are pinned against the production registry in
`tests/dom/handle-registry.test.ts`, and `Tooltip`'s two uses of it are pinned by
spying the seam (`FieldDecorator.pointerTooltip` 28, `Tooltip.pointer` 8).

`pointerKnown` is gone with the same change. Once "rests on" is decided by the
recorded target, `pointerTarget === null` already means "nothing is known about
the pointer", so the separate flag was a second expression of one fact — and a
redundant one: a mutation that cleared only the flag left every test green.
`Tooltip.pointer` case 6 pins that a changed attach reads no layout at all.

**The watch is three viewport registrations, not the one `## Architecture
Decisions` describes.** `_startPointerWatch` installs all three and
`_stopPointerWatch` removes all three, so `## Expected Behaviour` case 22 asserts
that an attachment raises the viewport listener count by three
(`WATCH_LISTENERS = 3`), not by one:

- `mousemove` → `_recordPointer`, the one the plan specified.
- `mouseout` → `_forgetPointerOnLeave`, which clears `pointerTarget` when the
  event names no element the pointer moved to — the pointer leaving the window.
  Without it the target recorded on the way out stayed trusted, so a changed
  attach on the component it named would show a tooltip while the pointer sat in
  another application, where no `mouseout` would ever arrive to dismiss it again.
  `[^watch-stays]` names exactly this hazard but covers only gaps with no
  attachments. `FieldDecorator.pointerTooltip` case 25 pins the forgetting, and
  case 32 pins that an ordinary in-document crossing does *not* forget.
- `keydown` → `_clearPressSuppression`, which is how the press suppression below
  is lifted. Any key lifts it wherever it lands, which is why this is a viewport
  registration rather than something the pressed component listens for itself.
  Case 26 pins the lifting.

**A press's suppression also ends when the pointer leaves the component.** Added
after the fourth review round, again on the user's decision. As first shipped
only a keystroke or another press lifted it, so the suppression outlived the
gesture it belonged to: press a field, let the pointer leave and come back — the
hover path itself re-shows the error, so the press is demonstrably spent — and a
changed message was still refused, with the detach hiding the tooltip on screen
and nothing replacing it. The attachment's own `mouseout` now clears it, which is
where the "has the pointer really left" test already lives (a covering attachment
ignores a move between two elements inside it), and it clears only its own
component's suppression — lifting somebody else's would let a leave of an inner
part revive the very hint the press silenced. Cases 29 and 33 pin the two halves.
This follows the same shape as the two nearby pieces of id-keyed gesture state,
`Tooltip.pendingId` (cleared by `_cancelPendingShow` when its wait ends) and
`core/PendingPointerDrags.ts` (unregistered when its drag ends).

**A press suppresses the component it pressed, reversing `[^state-change]`.**
This was the third audit round's second finding and the user's second decision;
the reasoning is in `## Architecture Decisions` above, under _A press suppresses
the component it pressed until the next keyboard input_, because it changes what
the plan decided rather than merely how it was carried out. Two rounds of this
branch shipped the opposite behaviour, on the plan's reasoning that "a press
attaches nothing" — true of `FieldDecorator`, false of `SplitGutter`'s chevron
and of a `Button` that re-derives its own hint from its click handler
(`component/button/Button.ts:1484-1488`). `mousedownFn`'s comment, the `attach`
and `attachCovering` JSDoc, the `Tooltip` page and the changelog entry all now
state the rule the code applies; the changelog's earlier "known limit" paragraph
about `Split`'s chevron is gone, since the chevron no longer has the problem.

**Two test files outside the plan's table needed the watch teardown.**
`Split.resizeMode.test.ts` and `Accordion.resizeMode.test.ts` now call
`Tooltip._stopPointerWatch()` in their `afterEach`. This is *not* the "another
file leaves an attachment behind" case step 12 anticipated: a gutter and an
accordion header attach tooltips, which installs the watch — and its `keydown`
registration leaves a `viewportListenerMap` type map that survives `DOM.reset()`,
so `ResizeDrag`'s own `Event.addViewportListener(this, "keydown", …)` found the
type already present and never re-installed the base handler against the fresh
sink. The next case's Escape then reached nothing and its outline drag was never
cancelled. Both files' `afterEach` already carries a comment describing exactly
this hazard for the outline's own listeners; the addition sits under it. Nothing
in production is affected, since the window is never replaced there.

**Eleven cases beyond the plan's enumerated set, plus three on the registry.**
`FieldDecorator.pointerTooltip` 23 pins the "another component's delay is
running" row of `## Architecture Decisions`' table, which case 20 was presented
as covering but cannot — the pointer there rests on the first decorator, so the
second's hit test already answers `false` whatever the guard does; case 23 puts
the pointer inside the decorator while the field's own delay runs. 25 pins the
pointer leaving the window and 32 that an ordinary crossing does not count as
leaving it; 24, 26, 27, 29 and 33 pin the press suppression, its two liftings,
and that each names only the component pressed; 28 and `Tooltip.pointer` 8 pin
the two liveness guards; 30 pins that a never-rendered component never reaches
the containment read, a guard a `Binding` validation can reach before a
decorator's first render; 31 pins that a hover with no move behind it still
records the pointer; `Tooltip.pointer` 6 pins that no layout is read and 7 the
chevron's shape for a plain attach. `handle-registry` gains three for
`isRegistered` itself. Every one was confirmed by a mutation that made that named
case fail — 30's mutation also fails 31 and 32, because a case that throws before
its own teardown leaves components registered and the file's later real-event
dispatches then vanish, the hazard its own header documents.

**Follow-up left open.** Making `ModelledDOMSink.release` actually drop its stub
would let a dead handle be staged offline, which would retire the two seam spies
cases 28 and `Tooltip.pointer` 8 use and let them drive the real path instead. It
is a test-harness change with its own blast radius across every file that
releases a handle and then reads it, so it is not folded in here.
