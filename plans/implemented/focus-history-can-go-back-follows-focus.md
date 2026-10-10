---
depends-on: [focus-history-transient-layers]
touches-shared:
  - packages/lib/src/typescript/lib/core/FocusHistory.ts      # nested-scroll-reveal edits only revealAndFocus's JSDoc there
  - packages/lib/tests/unit/core/FocusHistory.test.ts         # one case there calls LayerManager.isBehindModal, which stays
  - packages/lib/tests/core/FocusHistoryLayers.test.ts
  - packages/lib/docs/recipes/focus-history.md
  - packages/lib/docs/concepts/layering.md
  - packages/lib/docs/reference/changelog/next.md             # also edited by every branch of the stack
---

# Focus History Flags Follow Focus — Implementation Plan

## Overview

[`FocusHistory`](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L339) keeps a *trail* of the places keyboard focus has been, oldest first. Each entry is a *stop*. The *current stop* is the one the trail's position points at, marked `*` in a trail such as `[A, B*, C]`. `back()` and `forward()` *walk* the trail: they move focus to the first stop in that direction that takes it. `canGoBack()` and `canGoForward()` are the two *flags*, and the `"change"` event carries both.

Today the flags describe the trail, not where focus is. `canGoBack` means "a stop exists before the current one". But `back()` returns to the current stop itself when focus is not on it. With one stop `[A*]` and focus in a table cell's editor, or on `<body>` after a popup closed, `canGoBack()` is `false` while `back()` moves focus to `A` and returns `true`. A toolbar button wired to the flag is disabled in the one state where its click would work. The flags are also `true` while a dialog is open, where both functions return `false`.

This plan makes the flags and `"change"` say what `back()` and `forward()` would do from where focus is now. The code change is in `core/FocusHistory.ts` alone; its two test files and three doc pages follow. No signature changes. SQLAdmin does not enable `FocusHistory`, so nothing changes for it.

The work is built on `feature/nested-scroll-reveal`, the tip of the stack. That branch edits `core/Component.ts` and `core/FocusReveal.ts`; this plan edits neither, nor `core/LayerManager.ts`.

Line numbers are those of commit `20e4c105b`, the tip of `feature/focus-history-transient-layers`. `feature/nested-scroll-reveal` adds one line to the JSDoc of `revealAndFocus`, so on that branch every `FocusHistory.ts` line after 150 is one higher. Find each place by its symbol name.

---

## Architecture Decisions

### A flag is true when the walk has a stop to try — one function answers both

A new function `firstCandidate(direction)` returns the trail position a walk tries first. The walk starts there, and a flag is `true` when that position lies inside the trail. The walk and the flags call the same function.[^one-function]

| Direction | Focus is on the current stop | First position tried |
|---|---|---|
| back | yes | the one before the current stop |
| back | no | the current stop itself |
| forward | yes or no | the one after the current stop |

Flags are written `back/forward` below. Rows marked **new** differ from today.

| Trail | Focus is on | Flags | Because |
|---|---|---|---|
| `[]` | anything | `false/false` | nothing to try |
| `[A*]` | `A` | `false/false` | no stop before `A` |
| `[A*]` | a cell editor, a control of a menu or a popup, `<body>` | `true/false` **new** | `back()` returns to `A` |
| `[A, B*]` | `B` | `true/false` | |
| `[A*, B]` | `A` | `false/true` | |
| `[A*, B]` | a cell editor or `<body>` | `true/true` **new** | `back()` returns to `A` |
| `[C]` with no current stop (the first stop was removed while it was current) | anything | `false/true` | `forward()` goes to `C` |

### Both flags are false while a modal layer is open — a transient layer changes nothing

A *modal layer* is a `Dialog`, or a `Drawer` built with `modal: true`. A *transient layer* is one an outside click or focus move closes: a menu, a dropdown, a popup panel, most popovers. While `LayerManager.hasModalLayer()` is `true`, both flags are `false`. A transient layer does not enter the rule: the flags are what they would be with that layer closed.[^transient]

| Open | `Alt+[` / `Alt+]` | `back()` / `forward()` | Flags |
|---|---|---|---|
| nothing; a window, a non-modal drawer, a `dismissOn: "manual"` popover | walk | walk | follow the walk |
| a menu, a dropdown, a popup panel, a popover that an outside click or focus move closes | do nothing | walk | follow the walk |
| a dialog or a modal drawer, with or without a menu or dropdown above it | do nothing | return `false` | `false/false` |

The first two columns are today's behaviour and do not change.

### `"change"` fires when a flag changes value, and only then

The service keeps the flags it last fired in a module variable, `_lastChange`. Every place that may have changed a flag calls one function, `fireChangeIfFlipped()`. That function computes the flags, compares both with `_lastChange`, and fires `"change"` only when one differs. `_lastChange` starts as `false/false`, the flags of an empty trail.

`fireChangeIfFlipped()` replaces `fireChange()`, which fired after every record, every navigation and every `clear()`, whether or not a flag had changed.[^dedupe] The shape of `fireChangeIfFlipped()` follows [`CodeEditor.onCursorChange`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1602) and [`Component.propagateEffectiveVisibility`](../packages/lib/src/typescript/lib/core/Component.ts#L2621): compute the value, compare it with the last one handed out, return when equal, otherwise store and fire.

| Step | Trail after, focus on | Flags | `"change"` |
|---|---|---|---|
| focus `A` | `[A*]`, on `A` | `false/false` | not fired |
| focus `B` | `[A, B*]`, on `B` | `true/false` | fired |
| focus `C` | `[A, B, C*]`, on `C` | `true/false` | not fired |
| `back()` | `[A, B*, C]`, on `B` | `true/true` | fired |
| focus a cell editor | `[A, B*, C]`, on the editor | `true/true` | not fired |
| `back()` (returns to `B`) | `[A, B*, C]`, on `B` | `true/true` | not fired |

No event is fired on subscribing. A listener reads `canGoBack()` and `canGoForward()` once for its starting state.[^no-initial]

### Four things make the service look again — a focus landing, a focus leaving for nowhere, a layer change, a call

| What happened | Seen through | Status |
|---|---|---|
| focus landed on an element, a stop or not | the `focusin` viewport listener, `onFocusIn` | existing; today it returns early for an element that is no stop |
| focus left an element for nowhere | a `focusout` viewport listener, `onFocusOut` | new |
| a layer registered or unregistered | the layer watch (next decision) | new |
| `back()` or `forward()` was called, and moved focus or not | `navigate` | existing; today it fires only after a walk that moved focus |
| `clear()` or `enable()` was called | the call itself | `clear()` existing, `enable()` new |

Neither focus listener acts during a walk. The service already sets its module flag `_navigating` for the length of one, so that the walk's own focus move is not recorded. The walk calls `fireChangeIfFlipped()` once, when it has ended.

A `focusout` event's *related target* is the element focus is moving to, or nothing. `onFocusOut` acts only when the event names no related target, which means focus is going nowhere. When focus is on its way to another element, that element's `focusin` follows and reports the flags once, for the finished move.[^one-event]

| Trail, focus on | Move | Events with the related-target test | Without it |
|---|---|---|---|
| `[A*, B]`, on `A` | to a new stop `X` | one: `true/false` | two: `true/true` at the `focusout`, then `true/false` |
| `[A*]`, on `A` | a click on the empty page | one: `true/false` | the same |

These focus moves record nothing and can now fire `"change"`:

| Focus move | Fires when |
|---|---|
| from the current stop into a cell editor, or into a control of a menu, dropdown, popup panel or popover | the current stop is the first of the trail (`canGoBack` goes `false` to `true`); fired at the destination's `focusin` |
| from the current stop to nowhere: a click on the empty page, a `blur()` from code | the same; fired at the `focusout` |
| back onto the current stop, by click or `Tab` | the current stop is the first of the trail (`true` to `false`) |
| between two places that are no stop | never |
| into a dialog or a modal drawer | never: the flags went `false/false` when the modal layer registered |

### A modal layer is seen through a background surface — a second use of that seam

`enable()` registers one module-level object with [`LayerManager.addBackgroundSurface`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L650), and `disable()` removes it. `LayerManager` calls a background surface's `onInertChanged` on every register and unregister of any layer. The service's hook ignores the argument and calls `fireChangeIfFlipped()`.

A [`BackgroundSurface`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L152) is documented as a surface that goes inert while a modal layer is open. The service is not a surface and writes no element. Registering the service there is a new use of an existing seam, chosen over a new `LayerManager` event.[^layer-watch] The registered object is called the *layer watch* below.

A focus event cannot stand in for the watch. A dialog removes its element before it unregisters, so whatever the browser fires for that removal arrives while the modal layer is still registered. When the dialog's opener is gone, no focus event follows, and the flags would stay `false/false` although `back()` works again (case J7).

### No trigger is added for a control leaving the document

*Pruning* drops every trail entry whose element has left the document. The service prunes before each walk and each flag read.

When the focused control leaves the document and nothing else does, neither flag changes, so no event is needed.[^silent-drop] The proof is in [Addendum: A control that leaves the document](#addendum-a-control-that-leaves-the-document).

| Before, focus on | Leaves | After pruning, focus on `<body>` | Flags before and after |
|---|---|---|---|
| `[A*]`, on a popup's `Apply` | `Apply`, never recorded | `[A*]` | `true/false`, `true/false` |
| `[A, D*]`, on `D` | `D` | `[A*]` | `true/false`, `true/false` |
| `[D*]`, on `D` | `D` | `[]` | `false/false`, `false/false` |

A stop that is *not* focused can leave the document and change a flag: `[X, B*]` with focus on `B` goes from `true/false` to `false/false` when `X` leaves. Nothing tells the service at that moment. `canGoBack()` and `canGoForward()` are right whenever they are called, because they prune first. `"change"` catches up the next time one of the four triggers above runs, and a `back()` or `forward()` call that finds nothing fires it (case E6). This gap exists today and stays.

### The flags count every stop that is still in the document

A flag does not predict whether a stop will take focus. A stop that is hidden, disabled, or held off by a menu's keyboard session is still counted, so `back()` can return `false` after `canGoBack()` returned `true`.[^refusing]

| State | `canGoBack()` | `back()` |
|---|---|---|
| `[H, B*]`, focus on `B`, `H` in a minimised window | `true` | `false`: `H` refuses focus, and is kept |
| `[A*]`, focus on `<body>`, `A` since hidden or disabled | `true` | `false` |
| `[B*]`, focus on the panel of a menu opened from `B` with the keyboard | `true` | `false`: the menu takes focus back (case J9) |

The first row is today's behaviour. The third can only be reached from code: `Alt+[` does nothing while a menu is open, and a pointer press on a toolbar button closes the menu first.

### `disable()` stops the event, not the answers

`back()` and `forward()` work while the service is disabled, so `canGoBack()` and `canGoForward()` keep answering for where focus is. While disabled the service has no focus listener and no layer watch, so a focus move or a layer fires no `"change"`. A `back()`, `forward()` or `clear()` call still fires it. `enable()` first records the focused element as a stop when it is one (its *seed*, as today), then calls `fireChangeIfFlipped()`, which reports whatever changed in between.

### The forward side changes only under a modal layer

`forward()` always starts at the stop after the current one, wherever focus is. `canGoForward` therefore has no gap of the `[A*]` kind and keeps its meaning. Its one change is the modal rule: `[A*, B]` with a dialog open is `false/false`, where today `canGoForward()` is `true` and `forward()` returns `false`.

### What a focus move costs

Each trigger runs `fireChangeIfFlipped()` once. One run reads whether each trail entry is still connected (at most `maxSize`, 50 by default), asks `LayerManager.hasModalLayer()` once, and reads the active element at most twice. A run writes nothing to the DOM and reads no layout. A focus move from one element to another runs it once, at the `focusin`, and fires at most one event.[^cost]

---

## Public API

No signature changes. In [`core/FocusHistory.ts`](../packages/lib/src/typescript/lib/core/FocusHistory.ts) five doc comments are replaced and two gain a sentence; the text is given here and used in step 7.

```typescript
/**
 * Payload of the `"change"` event: what {@link FocusHistory.back} and
 * {@link FocusHistory.forward} would do from where focus is now.
 *
 * @category Core
 */
export interface FocusHistoryChange {
    /** Whether `back()` has a stop to go to. */
    canGoBack:    boolean;
    /** Whether `forward()` has a stop to go to. */
    canGoForward: boolean;
}
```

Inside `export namespace FocusHistory`:

```typescript
/**
 * Whether {@link back} has a stop to go to from where focus is now: the
 * current stop when focus has left it, otherwise a stop before it. Always
 * `false` while a dialog or a modal drawer is open. Prunes stale entries as
 * a side effect, so a stop that has left the document never counts. A stop
 * that is still in the document counts even when it is hidden or disabled,
 * so `back()` can return `false` after this returned `true`.
 *
 * @returns True when `back()` has a stop to try.
 */
export function canGoBack(): boolean;

/**
 * Whether {@link forward} has a stop to go to: one after the current stop.
 * Always `false` while a dialog or a modal drawer is open. Prunes stale
 * entries as a side effect, so a stop that has left the document never
 * counts. A stop that is still in the document counts even when it is
 * hidden or disabled.
 *
 * @returns True when `forward()` has a stop to try.
 */
export function canGoForward(): boolean;

/** Empties the trail. Fires `"change"` when either flag was true. */
export function clear(): void;

/**
 * Subscribes to `"change"`, fired whenever {@link canGoBack} or
 * {@link canGoForward} changes value: after a focus move, recorded or not,
 * after a `back()` / `forward()` call, after {@link clear}, and when a
 * dialog or a modal drawer opens or closes. It is not fired when neither
 * value changed, and not on subscribing: call the two functions once for
 * the starting state. A listener can run while a layer is opening or
 * closing, so it should not open or close one itself.
 *
 * @param event - Always `"change"`.
 * @param listener - Invoked with the two flags after the change.
 */
export function on(event: "change", listener: (change: FocusHistoryChange) => void): void;
```

Two existing comments gain a sentence each, appended to the description:

- `enable`: "Fires `"change"` when a flag differs from the one last fired."
- `disable`: "While disabled, {@link canGoBack} and {@link canGoForward} keep answering, but a focus move fires no `"change"`; {@link enable} fires it if a flag changed in between."

---

## Internal Structure

All of this is in [`core/FocusHistory.ts`](../packages/lib/src/typescript/lib/core/FocusHistory.ts). The code below was run as a copy of the file against every case in `## Expected Behaviour`.[^evidence]

**Import.** After the `LayerManager` import ([:7](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L7)):

```typescript
import type { BackgroundSurface } from "~/core/LayerManager.js";
```

**State.** After `let _forward` ([:82](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L82)):

```typescript
// The flags last handed to `"change"` listeners. Seeded with those of an empty
// trail, which is what a listener has to assume before its first event.
let _lastChange: FocusHistoryChange = { canGoBack: false, canGoForward: false };
```

**Replace `fireChange`** ([:117–125](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L117)) with three functions:

```typescript
/**
 * The position in `_entries` a walk in `direction` tries first. Going back
 * starts at the current stop itself when focus is not on it; going forward
 * always starts at the stop after it. The result can lie outside the trail,
 * which means the walk has nothing to try.
 *
 * @param direction - `-1` for a walk back, `1` for a walk forward.
 * @returns The first position to try.
 */
function firstCandidate(direction: -1 | 1): number {
    // Focus can be somewhere that is no stop: in a control inside a table
    // cell, or on <body> after the focused control was removed.
    const onCurrentStop = _index >= 0 && _entries[_index] === DOM.source.getActiveElement();

    return direction === -1 && !onCurrentStop ? _index : _index + direction;
}

/**
 * Prunes stale entries, then answers what a walk would do from where focus
 * is now: a flag is true when the walk in that direction has a stop to try.
 * Both are false while a modal layer is open, where no walk starts.
 *
 * @returns The two flags as they stand.
 */
function currentFlags(): FocusHistoryChange {
    pruneStale();

    const modalOpen = LayerManager.hasModalLayer();

    if (modalOpen) {
        return { canGoBack: false, canGoForward: false };
    }

    return {
        canGoBack:    firstCandidate(-1) >= 0,
        canGoForward: firstCandidate(1) < _entries.length,
    };
}

/**
 * Fires `"change"` when either flag differs from the one last fired, and
 * does nothing otherwise.
 */
function fireChangeIfFlipped(): void {
    const flags = currentFlags();

    if (flags.canGoBack === _lastChange.canGoBack && flags.canGoForward === _lastChange.canGoForward) {
        return;
    }

    _lastChange = flags;
    _listeners.fire("change", flags);
}
```

`_lastChange` is assigned before the listeners run, so a listener that calls `back()` cannot fire the same flags twice.

**`record`** ([:127–145](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L127)). Delete its last statement, `fireChange();`. In its JSDoc, replace ", advances `_index`, and fires `"change"`." with " and advances `_index`.". The callers of `record` fire.

**`navigate` becomes `walk` plus a wrapper** ([:173–214](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L173)). Rename the existing function to `walk`; its JSDoc stays. In its body make two edits. Replace the comment and the two statements that compute `onCurrentStop` and `target` ([:196–200](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L196)) with:

```typescript
    let target = firstCandidate(direction);
```

Delete the `fireChange();` line inside the loop ([:205](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L205)). Then add, directly after `walk`:

```typescript
/**
 * Walks the trail by `direction`, then fires `"change"` when a flag differs
 * from the one last fired — after a walk that moved focus and after one
 * that did not, since pruning alone can change a flag.
 *
 * @param direction - `-1` to walk back, `1` to walk forward.
 * @returns True if focus moved.
 */
function navigate(direction: -1 | 1): boolean {
    const moved = walk(direction);

    fireChangeIfFlipped();

    return moved;
}
```

`back()`, `forward()` and `onKeyDown` keep calling `navigate`. Do not touch `revealAndFocus`: the other branch edits its JSDoc.

**`onFocusIn`** ([:273–292](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L273)). Replace the function and its one-line JSDoc. Only the JSDoc and the part from `const stop` on differ from today:

```typescript
/**
 * Document `focusin` handler: records the newly-focused element when it is a
 * stop, then fires `"change"` when a flag differs from the one last fired. A
 * move that records nothing can change a flag too: focus has left the
 * current stop, or returned to it.
 */
function onFocusIn(e: FocusEvent): void {
    if (!_enabled || _navigating) {
        return;
    }

    if (!DOM.source.isElement(e.target)) {
        return;
    }

    const handle = DOM.source.intern(e.target);

    const stop = isHistoryStop(handle);

    if (stop) {
        record(handle);
    }

    fireChangeIfFlipped();
}
```

**New, directly after `onFocusIn`:**

```typescript
/**
 * Document `focusout` handler: acts when focus has left an element for
 * nowhere — a click on the empty page, a blur from code — since no `focusin`
 * follows then. Fires `"change"` when a flag differs from the one last
 * fired.
 */
function onFocusOut(e: FocusEvent): void {
    if (!_enabled || _navigating) {
        return;
    }

    // Focus is on its way to another element. That element's `focusin`
    // follows, and reports the flags once the move is complete.
    const movingToElement = DOM.source.isNode(e.relatedTarget);

    if (movingToElement) {
        return;
    }

    fireChangeIfFlipped();
}

/**
 * Layer watch: `LayerManager` calls this on every register and unregister of
 * a layer, which is when a modal layer can have opened or closed. Fires
 * `"change"` when a flag differs from the one last fired.
 */
function onLayersChanged(): void {
    fireChangeIfFlipped();
}

// How the service learns that a modal layer opened or closed. A background
// surface is what `LayerManager` tells about modality; the service is not a
// surface and writes no element — the trail is what goes out of reach while
// the page behind a modal layer is inert.
const _layerWatch: BackgroundSurface = { onInertChanged: onLayersChanged };

/**
 * Records the element that has focus as the first stop, when it is one.
 * Nothing is recorded when nothing has focus or the focused element is not a
 * stop.
 */
function seedFromActiveElement(): void {
    const active = DOM.source.getActiveElement();

    if (active === null) {
        return;
    }

    const stop = isHistoryStop(active);

    if (stop) {
        record(active);
    }
}
```

`seedFromActiveElement` is the seed code moved out of `enable()` unchanged, so that `enable()` no longer returns before its last two statements.

**`enable`** ([:350–375](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L350)). Replace everything after `_enabled = true;`:

```typescript
        Event.addViewportListener(_owner, "focusin", onFocusIn);
        Event.addViewportListener(_owner, "focusout", onFocusOut);
        Event.addViewportListener(_owner, "keydown", onKeyDown);

        seedFromActiveElement();
        LayerManager.addBackgroundSurface(_layerWatch);
        fireChangeIfFlipped();
```

`addBackgroundSurface` calls the watch at once, which already fires. The explicit call on the last line keeps `enable()` correct without relying on that.

**`disable`** ([:381–391](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L381)). Replace the two `removeViewportListener` lines with:

```typescript
        Event.removeViewportListener(_owner, "focusin", onFocusIn);
        Event.removeViewportListener(_owner, "focusout", onFocusOut);
        Event.removeViewportListener(_owner, "keydown", onKeyDown);
        LayerManager.removeBackgroundSurface(_layerWatch);
```

**`canGoBack`, `canGoForward`, `clear`** ([:451–474](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L451)). New bodies:

```typescript
    export function canGoBack(): boolean {
        return currentFlags().canGoBack;
    }

    export function canGoForward(): boolean {
        return currentFlags().canGoForward;
    }

    export function clear(): void {
        _entries = [];
        _index = -1;
        fireChangeIfFlipped();
    }
```

The two getters fire nothing. `pruneStale`, `revealAndFocus`, `isInTableCell`, `isHistoryStop`, `matchesCombo`, `onKeyDown`, `isEnabled`, `configure`, `back`, `forward` and `off` keep their bodies.

---

## Ordered Implementation Steps

All paths are under `packages/lib`. Run test commands from that directory.

1. **Baseline.** `npx vitest run tests/unit/core/FocusHistory.test.ts tests/core/FocusHistoryLayers.test.ts tests/overlay/LayerManager.modalFocus.test.ts`. All pass before any edit.

2. **Offline test helpers.** In [`tests/unit/core/FocusHistory.test.ts`](../packages/lib/tests/unit/core/FocusHistory.test.ts), add after `focusSilently` ([:95](../packages/lib/tests/unit/core/FocusHistory.test.ts#L95)) the helpers listed under `## Verification`. In the `afterEach` ([:105](../packages/lib/tests/unit/core/FocusHistory.test.ts#L105)), add `FocusHistory.off('change', collect);` as its first statement. Check: the file still passes.

3. **New offline cases.** In the same file add four `describe` blocks after the last one ([:1323](../packages/lib/tests/unit/core/FocusHistory.test.ts#L1323)), inside the outer `describe`: cases F1–F8, M1–M2, E1–E11 and D1–D3. Check: the cases marked "fails first" in `## Expected Behaviour` fail, and the others pass.

4. **Existing offline cases.** In the same file apply R1–R6, R8 and R9 from the table "Existing cases whose expected value changes". Check: R1–R6 fail; R8 and R9 pass.

5. **Mounted cases.** In [`tests/core/FocusHistoryLayers.test.ts`](../packages/lib/tests/core/FocusHistoryLayers.test.ts) apply R7 and add J5–J9, with the set-up given under `## Verification`. Check: R7 and J5–J9 fail.

6. **Code.** Edit [`core/FocusHistory.ts`](../packages/lib/src/typescript/lib/core/FocusHistory.ts) as given under `## Internal Structure`, in this order: the import; `_lastChange`; the three functions that replace `fireChange`; `record`; `walk` and `navigate`; `onFocusIn`; `onFocusOut`, `onLayersChanged`, `_layerWatch` and `seedFromActiveElement`; `enable`; `disable`; `canGoBack`, `canGoForward`, `clear`. Check: every case of both test files passes, and the three grep checks under `## Verification` hold.

7. **Doc comments.** Apply the doc comments under `## Public API`. In the public comments name `LayerManager` behaviour in prose; link only public members.

8. **Docs and changelog.** Apply `## Documentation Impact`.

9. **Verification.** Run the commands and the manual cases under `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/FocusHistory.ts` |
| Modify | `packages/lib/tests/unit/core/FocusHistory.test.ts` |
| Modify | `packages/lib/tests/core/FocusHistoryLayers.test.ts` |
| Modify | `packages/lib/docs/recipes/focus-history.md` |
| Modify | `packages/lib/docs/concepts/layering.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Trails are written `[A, B*]`. Flags are written `back/forward`, as `canGoBack()` and `canGoForward()` return them. Terms used in the offline tables:

- **focus `X`**: the file's `focusIn(X)`: focus plus the `focusin` event.
- **focus moves silently to `X`**: `focusSilently(X)`: focus with no event.
- **focus is dropped from `X`**: `dropFocus(X)`: nothing has focus, and no event. It models a focused control leaving the document in a browser that fires nothing for that.
- **`X` is disconnected**: `setConnected(X, false)`: the element has left the document.
- **`X` is blurred**: `focusOut(X)`: nothing has focus, plus the `focusout` event.
- **a cell editor**: `cellEditor()`: a control inside a connected `<td>`.
- **`changes`**: the payloads a `"change"` listener collected since `listen()`, oldest first.

"Fails first" means the case fails before step 6. "Pin" means it passes before and after.

### The flags, from where focus is (offline)

| # | Given | Then | Before step 6 |
|---|---|---|---|
| F1 | focus `A`; focus moves silently to `X` | flags `true/false`; `back()` is `true` and lands on `A`; flags `false/false`; a second `back()` is `false` | fails first |
| F2 | focus `A`; focus is dropped from `A` | flags `true/false`; `back()` is `true` | fails first |
| F3 | focus `A`, `B`; `back()` (trail `[A*, B]`); then focus moves silently to `X` | flags `false/true` after `back()`; `true/true` after the silent move | fails first |
| F4 | `enable()` with nothing focused; focus moves silently to `X` | flags `false/false`; `back()` and `forward()` are `false` | pin |
| F5 | focus `D`; `D` is disconnected and focus is dropped from it | flags `false/false`; `back()` is `false` | pin |
| F6 | focus `A`, `D`; `D` is disconnected and focus is dropped from it | flags `true/false` before and after the removal; `back()` lands on `A`; then `false/false` | fails first |
| F7 | focus `D`, `C`; `back()` (trail `[D*, C]`); `D` is disconnected and focus is dropped from it | flags `false/true` before and after; `back()` is `false`; `forward()` lands on `C`; then `false/false` | pin |
| F8 | focus `A`; focus is dropped from `A`; `DOM.sink.focus` is spied so that `A` refuses focus | `canGoBack()` is `true`; `back()` is `false`; `canGoBack()` is still `true` | fails first |

### Layers (offline)

| # | Given | Then | Before step 6 |
|---|---|---|---|
| M1 | focus `A`, `B`, `C`; `back()` (trail `[A, B*, C]`); register a `"modal"` layer; focus a control inside it; register a `"click-outside"` layer; unregister both | flags `true/true` before; `false/false` after each of the three steps with the modal layer open; `true/true` after the two unregisters | fails first |
| M2 | trail `[A, B*, C]` as in M1; `listen()`; register a layer; unregister it; register it again. Run for `"click-outside"`, `"blur"` and `"manual"` | flags `true/true` while registered; `changes` is empty after the unregister; with it registered again `back()` is `true` | pin |

### The `"change"` event (offline)

| # | Given | Then | Before step 6 |
|---|---|---|---|
| E1 | `listen()`; focus `A`; focus `B`; focus `C`; `back()`; `back()` | `changes` after each step: `[]`; `[true/false]`; unchanged; plus `true/true`; plus `false/true` | fails first |
| E2 | focus `A`; `listen()`; focus a cell editor; focus a second cell editor; focus `A` | `[true/false]`; unchanged; plus `false/false` | fails first |
| E3 | focus `A`; `listen()`; `A` is blurred; focus `A` | `[true/false]`; plus `false/false` | fails first |
| E4 | focus `A`, `B`; `back()` (trail `[A*, B]`, flags `false/true`); `listen()`; `DOM.sink.blur(A)`; dispatch `focusout` on `A` with `relatedTarget: X`; then focus `X` | `changes` is empty after the `focusout`, and exactly `[true/false]` after `X` takes focus: one event for the whole move | pin; fails if `onFocusOut` omits the related-target test |
| E5 | focus `A`, `B`; `back()` (trail `[A*, B]`); `listen()`; spy `DOM.sink.focus` so that it calls `DOM.sink.blur(A)`, dispatches `focusout` on `A`, focuses for real, then dispatches `focusin` on its target; `forward()` | `forward()` is `true`; `changes` is exactly `[true/false]`: a walk fires once, at its end | pin; fails if `onFocusOut` omits the `_navigating` test |
| E6 | focus `X`, `B`; `listen()`; `X` is disconnected; `back()` | `changes` is empty after the disconnect; `back()` is `false`; then `changes` is `[false/false]` | fails first |
| E7 | trail `[A, B*, C]` as in M1; `listen()`; register a `"modal"` layer; unregister it | `[false/false]` right after the register, with no focus event; plus `true/true` after the unregister | fails first |
| E8 | focus `A`; `listen()`; register a `"modal"` layer; focus a control inside it; that control is disconnected and focus is dropped from it; unregister the layer; `back()` | `changes` is empty until the unregister; then `[true/false]`; `back()` is `true` and lands on `A`; plus `false/false` | fails first |
| E9 | `listen()`; `clear()`; focus `A`; focus `B`; `clear()` | empty after the first `clear()`; `[true/false]` after `B`; plus `false/false` after the second `clear()` | fails first |
| E10 | a listener that pushes `flags()` onto one array and its payload onto another; focus `A`; focus `B` | the two arrays are equal, and both are `[true/false]` | fails first |
| E11 | `enable({ maxSize: 1 })`; `listen()`; focus `A`; focus `B` | `changes` is empty; flags `false/false` | fails first |

### `disable()` and `enable()` (offline)

| # | Given | Then | Before step 6 |
|---|---|---|---|
| D1 | focus `A`; `disable()`; `listen()`; focus a cell editor; blur it; register and unregister a `"modal"` layer; then `enable()` | `changes` is empty before `enable()`, while flags are `true/false`; `[true/false]` after `enable()` | fails first |
| D2 | focus `A`; `disable()`; `listen()`; focus `B`; `enable()` | `[true/false]`; `back()` lands on `A` (`B` was seeded) | pin |
| D3 | focus `A`, `B`; `disable()`; `listen()`; `back()` | `back()` is `true`; `changes` is `[false/true]` | pin |

### Existing cases whose expected value changes

R1–R6, R8 and R9 are in `tests/unit/core/FocusHistory.test.ts`; R7 is in `tests/core/FocusHistoryLayers.test.ts`. No other existing case changes.

| # | Case (line) | Today | Becomes | Why |
|---|---|---|---|---|
| R1 | "does not record a focusin landing inside a table cell, while a plain element still records" ([:746](../packages/lib/tests/unit/core/FocusHistory.test.ts#L746)) | `canGoBack()` is `false` with trail `[a*]` and focus in the cell | `true`, and the trailing comment `// trail still just [a]` becomes `// focus has left the only stop` | `back()` returns to `a`. The rest of the case still shows the cell was not recorded |
| R2 | "fires "change" on record and on navigate with correct flags" ([:767](../packages/lib/tests/unit/core/FocusHistory.test.ts#L767)) | after the first `focusIn(a)`, `changes.at(-1)` is `false/false` | `expect(changes).toEqual([])`; the two later assertions stay. New title: "fires "change" on a record or a navigation that changes a flag" | recording the first stop changes no flag |
| R3 | "S1/S2: a control inside a "%s" layer is not a stop" ([:800](../packages/lib/tests/unit/core/FocusHistory.test.ts#L800)) | `canGoBack()` is `false` with focus inside the layer | `true` | focus has left `a`. The rest of the case still shows the control was not recorded |
| R4 | "S12: a focus move into a transient layer fires no "change"" ([:994](../packages/lib/tests/unit/core/FocusHistory.test.ts#L994)) | `changes` is `[false/false]`, fired for `a` | `[true/false]`, fired for the move into the layer. New title: "S12: a focus move into a transient layer fires "change" once, for leaving the current stop" | `a` fires nothing; leaving `a` flips `canGoBack` |
| R5 | "back() to the current stop fires "change" with the flags unchanged" ([:1229](../packages/lib/tests/unit/core/FocusHistory.test.ts#L1229)) | `changes` is `[true/false]` | `[]`. New title: "back() to the current stop fires no "change" when both flags stay as they were"; rewrite the comment above the case to match | the flags are `true/false` before and after |
| R6 | "W4: back() returns to a single stop, though canGoBack() describes the trail and is false" ([:1243](../packages/lib/tests/unit/core/FocusHistory.test.ts#L1243)) | `canGoBack()` is `false` before `back()` | `true` before `back()`; add `expect(FocusHistory.canGoBack()).toBe(false)` after the landing. New title: "W4: canGoBack() is true for a single stop that focus has left, and back() returns to it" | the case this plan exists for |
| R7 | "J4: a dialog opened and closed leaves the trail as it was" ([:163](../packages/lib/tests/core/FocusHistoryLayers.test.ts#L163)) | while the dialog is open, `canGoForward()` is `true` | while open, `canGoBack()` and `canGoForward()` are both `false`; the assertions after the close stay | the modal rule. The assertion after the close still shows the forward part survived |
| R8 | "S4: nothing is a stop while a modal layer is open, inside it or not" (ends at [:846](../packages/lib/tests/unit/core/FocusHistory.test.ts#L846)) | ends on `canGoBack()` is `false` with the modal open | keep, then append: unregister the modal layer; `back()` is `true` and lands on `a`; `canGoBack()` and `canGoForward()` are `false` | the old assertion now holds for any trail under a modal layer, so it no longer shows that nothing was recorded |
| R9 | "S6: a control of a "manual" layer opened from a modal layer is not a stop" (ends at [:863](../packages/lib/tests/unit/core/FocusHistory.test.ts#L863)) | ends on `canGoBack()` is `false` | keep, then append: unregister the manual layer, then the modal layer; `back()` is `true` and lands on `a`; `canGoForward()` is `false` | the same reason as R8 |

### Real components (offline, jsdom)

In `tests/core/FocusHistoryLayers.test.ts`. `real(x)` is the file's helper for a component's element.

| # | Given | Then |
|---|---|---|
| J5 | `enable()`; `real(a).focus()`; subscribe `collect`; `real(a).blur()` | `document.activeElement` is `document.body`; `changes` is `[true/false]`; `back()` is `true` and lands on `a`; plus `false/false` |
| J6 | `walkToMiddle()` (trail `[A, B*, C]`); subscribe; build the dialog as J4 does and call `show()` | right after `show()`, before any timer runs, `changes` is `[false/false]`; after 500 ms both flags are `false`; after `hide('close')` and 1000 ms, `b` has focus and `changes` is `[false/false, true/true]` |
| J7 | `enable()`; focus `a`, `b`; subscribe; show the dialog; 500 ms; `host.removeComponent(b)`; `b.dispose()`; `hide('close')`; 1000 ms | `document.activeElement` is `document.body`; `canGoBack()` is `true`; `changes` is `[false/false, true/false]`; `back()` is `true` and lands on `a` |
| J8 | `enable()`; focus `a`; subscribe; open a `PopupPanel` holding one `Button` from `a` (see set-up); 500 ms; focus that button; `hideAnimated()`; 1000 ms; `back()` | after opening, `a` still has focus and `changes` is empty; `[true/false]` after the button takes focus; after closing, `document.activeElement` is `document.body`, `LayerManager.getTopLayer()` is `null`, `canGoBack()` is `true` and `changes` is unchanged; `back()` lands on `a`; plus `false/false` |
| J9 | `enable()`; focus `b`; subscribe; open a menu from the keyboard as `openMenuFromKeyboard()` does | the menu's element has focus; `changes` is `[true/false]`; `back()` is `false` and the menu keeps focus; after `Escape`, `b` has focus and `changes` is `[true/false, false/false]` |

J7 is the case only the layer watch can pass: jsdom fires no focus event when the dialog's element leaves the document.

### Needs manual verification

What no harness shows: the events a real browser fires, and real key presses. Run in Chromium on the demo's `#/misc` page (`npm run dev`, `http://localhost:8015/#/misc`); the demo enables `FocusHistory`. Reload before each row. In the console run:

```js
const { FocusHistory } = await import('/src/typescript/lib/core/FocusHistory.ts');
FocusHistory.isEnabled();   // must print true; if not, reload and run again
FocusHistory.on('change', (c) => console.log('change', c));
```

Give focus with `element.focus()` from the console, because a click would run the button's action. Press the keys for real. A page whose window is not focused fires no focus events, so either turn on "Emulate a focused page" in DevTools' Rendering panel, or drive the page through the browser's debugging interface as the verification of `focus-history-transient-layers` did.

| # | Setup | Do | Expect |
|---|---|---|---|
| MV1 | focus "Show diagnostics overlay" | click an empty part of the page; `Alt+[` | the click logs `true/false`; `Alt+[` returns focus to the button and logs `false/false` |
| MV2 | focus "Filters (PopupPanel)"; `Enter` | focus the panel's `Apply` from the console; `Escape`; `Alt+[` | focusing `Apply` logs `true/false`; `Escape` logs nothing, nothing has focus, and `FocusHistory.canGoBack()` is `true`; `Alt+[` lands on "Filters (PopupPanel)" and logs `false/false` |
| MV3 | focus "Show diagnostics overlay", then "Dialog — form (focus stays inside)" | `Enter`; `Escape` | `Enter` logs `false/false` and `FocusHistory.canGoBack()` is `false`; `Escape` logs `true/false` once, and focus is back on the dialog button |
| MV4 | focus only "Dialog — form (focus stays inside)" | `Enter`; `Escape` | `Enter` logs nothing; `Escape` logs `true/false` and then `false/false` (see `## Potential Challenges`), and focus is back on the button |
| MV5 | Firefox, and WebKitGTK if at hand | MV1–MV3 again | the same. These engines were not run for this plan |

---

## Verification

**Helpers for `tests/unit/core/FocusHistory.test.ts`** (step 2), placed after `focusSilently`:

```typescript
/**
 * Models focus leaving `handle` for nowhere with the `focusout` a browser
 * fires for it: a click on the empty page, or a blur from code.
 */
function focusOut(handle: Handle): void {
    DOM.sink.blur(handle);
    DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(handle, 'focusout'));
}

/**
 * Leaves nothing focused and fires no event: models a focused control that
 * left the document in a browser that fires nothing for that.
 */
function dropFocus(handle: Handle): void {
    DOM.sink.blur(handle);
}

/** Mints a control inside a connected table cell, which is never a stop. */
function cellEditor(): Handle {
    const td = DOM.sink.createElement('td');

    setConnected(td, true);

    return controlIn(td);
}

/** Both flags, as the two functions return them now. */
function flags(): FocusHistoryChange {
    return { canGoBack: FocusHistory.canGoBack(), canGoForward: FocusHistory.canGoForward() };
}

// The payloads `collect` has received since the last `listen()`.
let changes: FocusHistoryChange[] = [];

/** The shared `"change"` listener; the afterEach unsubscribes it. */
function collect(change: FocusHistoryChange): void {
    changes.push(change);
}

/** Starts collecting `"change"` payloads from now on. */
function listen(): void {
    changes = [];
    FocusHistory.on('change', collect);
}
```

A payload `true/false` in the tables is `{ canGoBack: true, canGoForward: false }`. The existing cases keep their own inline listeners. F8 and E5 spy on `DOM.sink.focus` the way the existing case "navigate skips an entry that cannot take focus, without dropping it from the trail" does ([:253](../packages/lib/tests/unit/core/FocusHistory.test.ts#L253)): keep a bound copy of the real method, and call it from the mock for every handle the case does not hold back.

**Set-up for the new cases in `tests/core/FocusHistoryLayers.test.ts`** (step 5):

- Import `type FocusHistoryChange` from `~/core/FocusHistory` and `PopupPanel` from `~/overlay/PopupPanel`.
- Add module-level `let panel: PopupPanel | null = null;`, `let changes: FocusHistoryChange[] = [];` and a named `collect` function as above. Set `changes = []` at the end of `beforeEach`. "Subscribe" in the J rows is `FocusHistory.on('change', collect)`.
- In `afterEach`, add `FocusHistory.off('change', collect);` before `FocusHistory.disable()`, and `panel?.dispose(); panel = null;` after the dialog lines.
- J6 and J7 build the dialog exactly as J4 does, with the explicit `OK` button, and use `vi.useFakeTimers()` and `await vi.advanceTimersByTimeAsync(…)`. Set `dialog = null` once the dialog has closed, as J4 does.
- J8: `vi.useFakeTimers()`. Build `const apply = new Button({ text: 'Apply' })` and `new PopupPanel({ components: [apply], preferredSize: { width: 120, height: 60 } })`, assigned to `panel`. Open it with `const opener = DOM.source.intern(real(a)); panel.toggleFor(opener, DOM.source.getElementRect(opener));`. Focus the button with `real(apply).focus()`.

**Commands**, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. `cd packages/lib && npx vitest run tests/unit/core/FocusHistory.test.ts tests/core/FocusHistoryLayers.test.ts tests/overlay/LayerManager.modalFocus.test.ts tests/overlay/LayerManager.test.ts tests/overlay/Dialog.test.ts tests/overlay/Drawer.test.ts tests/overlay/Menu.keyboardSession.test.ts tests/unit/import-without-dom.test.ts`
4. `npm test`
5. `npm run lint`
6. `npm run docs:api`, `npm run docs:llms:check`
7. The MV cases.

**Grep checks**, on `packages/lib/src/typescript/lib/core/FocusHistory.ts`:

- `grep -c "fireChange()"` prints `0`.
- `grep -c "fireChangeIfFlipped()"` prints `7`: the definition and six calls (`navigate`, `onFocusIn`, `onFocusOut`, `onLayersChanged`, `enable`, `clear`).
- `grep -c "LayerManager.hasModalLayer()"` prints `3`: `currentFlags`, `walk`, `isHistoryStop`.

---

## Documentation Impact

`FocusHistory` is exported from `core/index.ts`; no barrel, sidebar or `llms.txt` change. The API page picks up the comments of `## Public API`.

- **[`docs/recipes/focus-history.md`](../packages/lib/docs/recipes/focus-history.md)**, section `## Wire back/forward buttons`.
  - In the code block ([:41–62](../packages/lib/docs/recipes/focus-history.md#L41)), delete the two lines `back.setEnabled(false);` and `forward.setEnabled(false);`. After the `FocusHistory.on('change', …)` statement add:
    ```typescript
    // "change" is not fired on subscribing: read the starting state once.
    back.setEnabled(FocusHistory.canGoBack());
    forward.setEnabled(FocusHistory.canGoForward());
    ```
  - Replace the paragraph at [:66](../packages/lib/docs/recipes/focus-history.md#L66). Keep its first sentence, up to "only the next call goes to the stop before it." Delete the rest: the sentence about `"change"` firing with the flags as they were, and the sentence that `canGoBack` describes the trail only. Then add:
    - One sentence: `canGoBack` and `canGoForward` say what `back()` and `forward()` would do from where focus is now, so a button wired this way is enabled when its click has somewhere to go.
    - A table with the columns "Trail (`*` marks the current stop)", "Focus is on", "`canGoBack`", "`canGoForward`" and these five rows: `[A*]` on `A` gives `false`, `false`; `[A*]` on a table cell's editor, a control of a popup, or nothing because the focused control was removed gives `true` (`back()` returns to `A`), `false`; `[A, B*]` on `B` gives `true`, `false`; `[A*, B]` on `A` gives `false`, `true`; any trail while a dialog or a modal drawer is open gives `false`, `false`.
    - One paragraph: `"change"` fires when either value changes, and only then. A focus move that records nothing fires it when it changes what `back()` would do. A recorded move that changes neither value does not.
    - One paragraph of limits. A stop that is still in the document counts even when it cannot take focus right now, hidden in a minimised window or disabled, so `back()` can return `false` after `canGoBack` was `true`. A stop that leaves the document changes the flags with no event of its own: the two functions are right whenever they are called, and `"change"` catches up at the next focus move, the next `back()` / `forward()` call, or the next layer that opens or closes. While the service is disabled the two functions keep answering, a focus move fires no `"change"`, and `enable()` fires it if a value changed in between.
- **The same page**, section `## Menus, dropdowns, popovers and dialogs` ([:85–91](../packages/lib/docs/recipes/focus-history.md#L85)). Add a fourth column "`canGoBack` / `canGoForward`" to the table: "as with nothing open" in the first and third rows, "both `false`" in the dialog row. Append to the sentence "The functions are not held back by a menu or a dropdown …": "The flags follow the functions, so that button stays enabled."
- **[`docs/concepts/layering.md`](../packages/lib/docs/concepts/layering.md)**.
  - The paragraph that begins "The last three are *background surfaces*" ([:177](../packages/lib/docs/concepts/layering.md#L177)): append "[`FocusHistory`](/recipes/focus-history) registers one too while it is enabled. It writes no element; the call tells it that a modal layer opened or closed."
  - The paragraph at [:260](../packages/lib/docs/concepts/layering.md#L260): change "while a modal is open it records nothing, and its `back()` and `forward()` move nothing." to "while a modal is open it records nothing, its `back()` and `forward()` move nothing, and its `canGoBack()` and `canGoForward()` are `false`."
- **[`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)**, `## Changed` → `### Core`. Find both places by their text; the line numbers move with every branch of the stack.
  - In the entry "**`FocusHistory` records places, not popups.**" ([:143](../packages/lib/docs/reference/changelog/next.md#L143)), change "`back()` returns to that stop first; `canGoBack` still describes the trail only." to "`back()` returns to that stop first."
  - Add a new entry directly after that one. **`FocusHistory`'s `canGoBack` / `canGoForward` and `"change"` follow focus.** Say: the two flags now say what `back()` and `forward()` would do from where focus is. `canGoBack` is `true` when focus has left the current stop, also when that is the only stop, because `back()` returns to it. Both are `false` while a dialog or a modal drawer is open. `"change"` now fires when either flag changes value, and only then. It no longer fires after a recorded focus move or a `back()` / `forward()` call that leaves both flags as they were, nor from `clear()` when both were already `false`. It now also fires for a focus move that records nothing — into a table cell's editor or a popup, or off every control — and when a dialog or a modal drawer opens or closes. Consumer action: none for a listener that copies the two flags onto buttons, but read `canGoBack()` / `canGoForward()` once when subscribing, since no event announces the starting state. Code that used `"change"` to learn that a focus move was recorded can no longer do so.
- **Not edited:** `ARCHITECTURE.md` (no rule changes); `docs/concepts/accessibility.md`, `docs/components/Dialog.md`, `Drawer.md` and `Menu.md` (none mentions the flags, and what each says stays true); `docs/reference/migration/next.md` (the entry is under `## Changed`, as the entry beside it is).

---

## Potential Challenges

- **`_lastChange` outlives a test.** `FocusHistory` is a module singleton. Both test files call `FocusHistory.clear()` in `afterEach`, which leaves `_lastChange` at `false/false`. Mitigation: a new case never assumes a first event; it asserts on `changes` from `listen()` on.
- **A listener left subscribed.** The listener bag is module-level too. Mitigation: new cases use the shared `collect`, which `afterEach` removes.
- **Two events when a modal layer closes onto the first stop.** With `[G*]`, a dialog opened from `G` and closed fires `true/false` when it unregisters (focus is nowhere yet) and `false/false` when focus returns to `G`. Both are correct at their moment, and no frame is painted between them. Do not add code to merge them. No automated case has this trail; MV4 shows the pair.
- **A `"change"` listener now runs inside `LayerManager.register` and `unregister`.** The layer watch is called from there. Mitigation: the `on` comment says a listener should not open or close a layer.
- **Pruning runs more often.** `fireChangeIfFlipped()` prunes at every focus event the service sees. An entry whose element is out of the document at that moment is dropped for good, as it already is on any `canGoBack()` call.
- **`focusout` under the modelled test DOM.** That DOM fires no event by itself and reports `null` as the active element after `DOM.sink.blur`. An event built with `makeEvent` has no related target unless one is passed. Mitigation: the helpers `focusOut` and `dropFocus` under `## Verification`, and `makeEvent(A, 'focusout', { relatedTarget: X })` in E4.
- **Merging.** `feature/nested-scroll-reveal` edits only the JSDoc of `revealAndFocus` in `FocusHistory.ts`, which this plan leaves alone. The planned removal of `LayerManager.isBehindModal()` edits one existing case of `FocusHistory.test.ts` ([:694](../packages/lib/tests/unit/core/FocusHistory.test.ts#L694)) and the query list of `layering.md`; this plan touches neither. In `changelog/next.md` keep both sides.

---

## Critical Files

- [`core/FocusHistory.ts`](../packages/lib/src/typescript/lib/core/FocusHistory.ts) — `pruneStale` (:92), `fireChange` (:118), `record` (:131), `navigate` (:183), `isHistoryStop` (:244), `onFocusIn` (:274), `enable` (:350), `disable` (:381), `canGoBack` (:451), `clear` (:470), `on` (:483).
- [`component/editor/CodeEditor.ts`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1602) — `onCursorChange` and the seeded `_lastCursorPosition` (:634): the precedent for comparing a small record with the last one emitted.
- [`core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts#L2621) — `propagateEffectiveVisibility` and `_fireDirtyChangeIfFlipped` (:2751): the same guard in `core`, and the source of the function's name. Read only; not edited.
- [`layout/Accordion.ts`](../packages/lib/src/typescript/lib/layout/Accordion.ts#L923) — `onHeaderHoverEnter`: the precedent for testing an event's related target with `DOM.source.isNode(e.relatedTarget)`.
- [`core/LayerManager.ts`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L152) — `BackgroundSurface` (:152), `addBackgroundSurface` (:650), `removeBackgroundSurface` (:662), `syncModalScope` (:911, called from `register` :413 and `unregister` :462), `hasModalLayer` (:595). Read only; not edited.
- [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1460) — `finalize` inside `hide`: removes the element, unregisters, then restores focus. [`overlay/Drawer.ts`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L680) does the same.
- [`core/Body.ts`](../packages/lib/src/typescript/lib/core/Body.ts#L283) — an existing `addBackgroundSurface` caller.
- [`tests/unit/core/FocusHistory.test.ts`](../packages/lib/tests/unit/core/FocusHistory.test.ts) — `liveHandle` (:24), `focusIn` (:37), `register` (:63), `layerWith` (:69), `controlIn` (:82), `focusSilently` (:95), the draining `afterEach` (:105).
- [`tests/core/FocusHistoryLayers.test.ts`](../packages/lib/tests/core/FocusHistoryLayers.test.ts) — `real` (:32), `walkToMiddle` (:54), `openMenuFromKeyboard` (:70), J4 (:145).
- [`plans/implemented/focus-history-transient-layers.md`](implemented/focus-history-transient-layers.md) — "Awaiting the user's sign-off", item 2, and case W4: the gap this plan closes.

---

## Non-Goals

- **Predicting whether a stop will take focus.** Only running the reveal tells, and a reveal changes the page.[^refusing]
- **An event when a stop leaves the document.** See the decision above and its footnote.[^silent-drop]
- **A `LayerManager` event of its own.**[^layer-watch]
- **Flags that are `false` while a transient layer is open.**[^transient]
- **An event on subscribing.**[^no-initial]
- **Changing `back()`, `forward()`, the accelerators or what is recorded.** Those were decided in `focus-history-transient-layers` and stay.
- **`LayerManager.isBehindModal()`.** Not used here. Its removal is another plan.
- **Returning focus to the opener when a `PopupPanel`, a `Popover` or a non-modal `Drawer` closes.** Still a defect of those components. With this plan the flags already say `true` in that state.
- **A back/forward toolbar in the demo.** The manual cases log the event from the console.
- **SQLAdmin.** It does not enable `FocusHistory`.

---

## Addendum: A control that leaves the document

The focused control `D` leaves the document and nothing else does. The browser then reports `<body>` as focused. Pruning drops `D` from the trail and moves the position to the nearest surviving stop at or before `D`'s place.

| Before, focus on | After pruning | `canGoBack` before, after | `canGoForward` before, after |
|---|---|---|---|
| any trail, on a control that was never recorded | the same trail | `true` when the trail has a current stop, in both | unchanged: the trail is the same |
| `[A, D*]`, on `D` | `[A*]` | `true` (a stop before `D`), `true` (return to `A`) | `false`, `false` |
| `[D*]`, on `D` | `[]` | `false`, `false` | `false`, `false` |
| `[D*, C]`, on `D` | `[C]`, no current stop | `false`, `false` | `true`, `true` |
| `[A, D*, C]`, on `D` | `[A*, C]` | `true`, `true` | `true`, `true` |

In general, with `D` at position `i` of `n` stops, and no two neighbours of `D` being the same element: before, `canGoBack` is `i > 0` and `canGoForward` is `i < n − 1`. After, the position is `i − 1`, focus is not on that stop, and the trail has `n − 1` stops. So `canGoBack` is `i − 1 ≥ 0`, and `canGoForward` is `i − 1 < n − 2`. Those are the two conditions from before the removal, rewritten. Cases F5, F6 and F7 pin three of the rows.

Three situations do change a flag with no event of their own. All three are stops other than the focused one leaving, or merging:

| Before, focus on | What leaves | After | Flag that changes |
|---|---|---|---|
| `[X, B*]`, on `B` | `X` | `[B*]` | `canGoBack`, `true` to `false` |
| `[A, D*]`, on `D` | `A` and `D` together, both in a window that closes | `[]` | `canGoBack`, `true` to `false` |
| `[A, D*, A]`, on `D` | `D`; the two `A` entries merge | `[A*]` | `canGoForward`, `true` to `false` |

The decision "No trigger is added for a control leaving the document" says how these catch up.

---

## Addendum: What a browser and the test DOMs fire

Measured for this plan. Chromium is version 155, headless, on a page with plain `<button>` elements and capture listeners on `window`. jsdom is the version the library's tests run on.

| What happens to the focused element | Chromium 155 | jsdom |
|---|---|---|
| focus moves to another element | `focusout` with the other element as related target, then `focusin`. During `focusout` the active element is `<body>` | the same |
| `blur()` | `focusout`, no related target, active element `<body>` | the same |
| removed from the document, alone or with its parent | `focusout` at once, no related target, active element `<body>` | no event; the active element becomes `<body>` |
| `display: none`, `visibility: hidden`, `inert` on its parent, `disabled` | `focusout` a moment later, active element `<body>` | not run |

Firefox and WebKitGTK were not run. The design does not depend on what they fire when an element is removed: the layer watch covers a closing modal layer, and the first addendum covers the rest.

The modelled DOM of `tests/dom/TestDOM.ts` fires nothing by itself. A case dispatches each event it wants.

---

## Notes

[^one-function]: Today the walk computes its first position inline in `navigate`, and the flags use a different formula (`_index > 0`). The two disagree in exactly the state this plan is about. Sharing one function removes the second formula, so a later change to where a walk starts cannot leave the flags behind.

[^transient]: The request behind this plan assumed that `back()` and `forward()` return `false` while a modal *or transient* layer is open, and asked for that to be checked. Checked against the code, that holds for a modal layer only. `walk` returns `false` on `LayerManager.hasModalLayer()`. A transient layer stops the two keys (`onKeyDown` asks `hasActiveInputLayer()`), not the functions: existing case W8 and the recipe's table both say the functions walk. That was a decision of `focus-history-transient-layers`: a toolbar button wired to `back()` must work when its click is what closes a dropdown, and a dropdown stays registered for the 120 ms of its fade.
    The flags exist for that same button, so they follow the function. Flags that were `false` under a transient layer would disable the button the moment a dropdown opens, and the click that closes the dropdown would land on a disabled button. Cases M2 and J8 pin the chosen behaviour. One transient state does make `back()` fail, a menu opened from the keyboard; it is covered by the decision on stops that refuse focus.

[^dedupe]: The user's decision (2026-10-10) is that a button wired to the flags is enabled exactly when the call would move focus, and that `"change"` fires only when a flag's value actually changes. One guard at one function gives that for every trigger, old and new. Keeping the unconditional fires for records and navigations, and guarding only the new triggers, would leave two kinds of firing and two places that must update `_lastChange`.
    The value is compared with the last one *fired*, not with a value read before the trigger. `Component._fireDirtyChangeIfFlipped(before)` can read `before` because the component itself makes the change. Here the inputs change outside the service: by the time `focusin` arrives, focus has already moved. `CodeEditor` is in the same position with its caret, and keeps `_lastCursorPosition` for that reason.
    Three existing behaviours change with it, each listed under "Existing cases whose expected value changes": recording the first stop fires nothing (R2), a move into a transient layer can fire (R4), and `back()` to the current stop fires nothing when the flags stay (R5). `FocusHistory` shipped in 0.10.0 with a comment on `on` that promises an event after every recorded move and every navigation, so this is a change to released behaviour and gets a changelog entry.

[^no-initial]: `on` has never called a new listener, and no other `on` in the library does. Before this plan a late subscriber was brought up to date by the next recorded focus move. Now it hears nothing until a flag changes, so the recipe reads the two functions once after subscribing. Calling a listener from inside `on` was rejected: it would make `on` behave unlike every other `on`, and a listener would run before the caller has finished wiring.

[^layer-watch]: What the service needs is a call when a modal layer opens or closes. `LayerManager` has exactly one such call for something that is not a layer: `BackgroundSurface.onInertChanged`, made from `syncModalScope` on every register and unregister. `Body`, `Rail` and `Notification` use it to write `inert`. The trail is in the same position as those surfaces: the stops it holds are controls of the page behind the modal layer, out of reach for as long as that page is inert.
    The alternative was a new `LayerManager.on("change")` with its own listener bag. It would be new public API on a file three other pieces of work edit (`feature/spatial-navigation-redesign`, the planned removal of `isBehindModal`, and this stack), for a single subscriber. If a second observer that is not a surface appears, that event becomes worth adding, and `_layerWatch` moves to it in a few lines.
    Doing without any layer signal was rejected on evidence. Run under jsdom against a copy of the file without the watch: a dialog whose opener was removed while it was open closed, focus was on `<body>`, `canGoBack()` returned `true`, and the last `"change"` still said `false/false` (case J7). A confirm dialog that deletes the row its opener sits in is that case. Chromium does not rescue it: `Dialog.hide` removes the element before it unregisters, so the `focusout` Chromium fires for the removal is handled while the modal layer is still registered.

[^silent-drop]: A document-wide `MutationObserver`, or a hook in `Component`'s removal path, would be the triggers for "an element left the document". The first runs on every DOM mutation of the application for the sake of one pair of buttons. The second edits `core/Component.ts`, which `nested-scroll-reveal` is changing. Neither is needed for the case that matters: the first addendum shows that the focused control leaving changes no flag. In the user's motivating case, a popup closed with focus inside it, `canGoBack` went `true` when focus moved *into* the popup and stays `true` when the popup is gone (case J8).
    What is left are stops that leave while focus is elsewhere. Today's event has the same gap, and the two functions are exact when called.

[^refusing]: The existing case "navigate skips an entry that cannot take focus, without dropping it from the trail" pins that a hidden stop is kept, because it works again once its window is restored. Whether a hidden stop can be reached is not readable from the document: `FocusReveal.reveal` may select the tab or expand the region that hides it, and may not. Counting only visible stops would turn the button off for a stop in an unselected tab, which `back()` does reach. So the flags stay on the side of "there is something to try".
    The menu row was measured under jsdom with a real `Menu`: with `[B*]` and the menu opened from `B` by Shift+F10, `canGoBack()` is `true` and `back()` returns `false`, because the menu's keyboard session takes focus back from `B`. `Escape` then fires `false/false`.

[^one-event]: Without the test, a move from the first stop of a longer trail to a new stop fires twice. At the `focusout` the browser already reports `<body>` as focused, so `canGoBack` goes `true`. At the `focusin` the new stop is recorded, the forward part is cut, and `canGoForward` goes `false`. Each event is correct for its instant, but the first describes a state between two elements that no user rests in, and a listener would see `true/true` for a trail that never offered both.
    The test follows `Accordion.onHeaderHoverEnter`, which reads `DOM.source.isNode(e.relatedTarget)` the same way. Measured in Chromium 155: a `focusout` caused by a move to another element names that element, and one caused by `blur()`, a removal or a hidden element names none. jsdom agrees for a move and for `blur()`.
    If the related element belongs to another document, such as an `<iframe>`, no `focusin` reaches the service. The flags then catch up at the next trigger.

[^cost]: The connectivity reads come from `pruneStale`, which the flags need: without it a flag could count a stop that has left the document. `isConnected` forces no layout. Focus moves are paced by the user, also when a held arrow key moves a roving focus, so one run per move is not a hot path.

[^evidence]: No source file was changed. A copy of `FocusHistory.ts` with the edits of `## Internal Structure` was placed in the test tree, and both test files were run against it with their imports pointed at the copy. Result: 8 failures (R1–R7; R3 counts twice, once per layer mode) and no other. With the R edits applied, and with every F, M, E, D and J case added, all 95 cases passed. Each new part was then removed from the copy in turn — the layer watch, the `focusout` listener, its related-target test, its `_navigating` test, the fire after a walk that moved nothing, the modal rule, the guard itself, the fire for a non-stop — and each removal failed at least one case. The "before step 6" column comes from running the same cases against the unchanged file.
    The browser table is from a page loaded into headless Chromium 155 as a `data:` URL.
    Kept at `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/can-go-back/`: `FocusHistoryProto.ts`, the test files, `prototype-run.log`, `red-state-against-current-code.log`, `focus-events-probe.html`, `chromium-probe-out.txt`. The copy and the temporary tests were deleted from the worktree.

---

## Implementation Notes

Built on `feature/focus-history-transient-layers` (`f73c00eb6`), the eighth branch of the unmerged stack. The code is the plan's `## Internal Structure` as written, except for the layer watch (item 5). Every case was written against the real `FocusHistory` before the code changed. The planner's prototype was read as evidence and not copied.

### Corrections to the plan's text

1. **The base is not `feature/nested-scroll-reveal`.** The Overview says the work is built on that branch, and the frontmatter listed it under `depends-on`. The order was changed after the plan was written: this plan is implemented below `nested-scroll-reveal`, which is held back and is rebased onto this branch afterwards. The frontmatter now reads `depends-on: [focus-history-transient-layers]`. No step needed the other branch. Checked against its tip `054987a6c`: in `core/FocusHistory.ts` it changes only the JSDoc of `revealAndFocus`, and it touches neither test file, nor the recipe, nor `layering.md`. It does edit `changelog/next.md`. The plan's line numbers are those of this base, with no offset of one: `packages/lib` is identical at `20e4c105b` and `f73c00eb6`.
2. **`LayerManager.isBehindModal()` stays.** The plan speaks of "the planned removal of `isBehindModal`" in four places: the frontmatter comment on `FocusHistory.test.ts`, the "Merging" item of `## Potential Challenges`, the `isBehindModal` item of `## Non-Goals`, and the footnote on the layer watch. That removal is not happening for now. `nested-scroll-reveal` calls the method from `core/FocusReveal.ts`, which was not known when the plan was written, and the user has not decided again. This implementation neither removes the method nor uses it, and the existing case that calls it is unchanged. The frontmatter comment is corrected. The three passages in the body are left as written and are to be read with this correction. In the footnote that means one piece of work fewer edits `LayerManager.ts`; the argument for using the background-surface seam does not rest on that count.

### Deviations

3. **Two comments changed that the plan does not list.** The JSDoc of `enable` began "Installs the `focusin` + `keydown` listeners", and the comment on `_navigating` said the guard keeps the walk's `focusin` from being recorded. The plan's code made both incomplete. `enable` now names `focusout` as well, and the `_navigating` comment says the guard also keeps the walk's own focus events from firing `"change"` mid-walk.
4. **No demo was added.** `## Non-Goals` rules out a back/forward toolbar in the demo.
5. **The layer watch acts only when a modal layer has opened or closed.** Found by the review. The plan has the watch ignore its argument and call `fireChangeIfFlipped()` on every register and unregister of any layer. `LayerManager` closes a `dismissOn: "blur"` popover from its own `focusin` handler, so that layer unregisters in the middle of the focus move that closes it. The watch then computed the flags for a state between two elements, and `"change"` fired twice for one move, the first time with `true/true`:

   | Trail, focus on, open | Move | `"change"` as planned | As built |
   |---|---|---|---|
   | `[A*, B]`, on `A`, a "blur" popover | `forward()` | `true/true`, then `true/false` | `true/false` |
   | the same, with `LayerManager`'s `focusin` listener registered before the service's | focus moves to a new stop `C` | `true/true`, then `true/false` | `true/false` |

   Both rows break what the plan itself decides: a walk fires once, at its end, and a focus move fires at most one event. The second row depends on listener order, which a layer open since before `enable()` reverses, so a `_navigating` test in the watch would have fixed the first row only. As built, `onLayersChanged` keeps the argument of its last call in `_modalWasOpen` and returns unless it has changed. The test has the shape of `Component.propagateEffectiveVisibility`, which the plan cites for `fireChangeIfFlipped()`: compare with the last value, return when equal. A modal layer does not close on a focus move, so the watch no longer runs inside one.

   What this gives up: with the plan's watch, a non-modal layer that opened or closed was a moment at which `"change"` caught up with a stop that had left the document. It no longer is. The recipe's sentence on that now says "the next dialog or modal drawer that opens or closes" where the plan dictates "the next layer that opens or closes". The plan's row "a layer registered or unregistered" in the table of triggers, and its sentence that each trigger runs `fireChangeIfFlipped()` once, are to be read with this. No case of `## Expected Behaviour` changes: M2 already requires that a non-modal layer fires nothing. The call that ends `enable()` now does work of its own, since the watch stays silent when the modal state is as it last saw it (cases D1 and D2).

   Four cases pin it, all written before the change and seen to fail with `true/true` first: two offline cases in the `"change"` block of `FocusHistory.test.ts`, and J10 and J11 with a real `Popover` in `FocusHistoryLayers.test.ts`.

### What was run

- **Red state, before step 6.** 29 of the then 94 cases of the two files failed, and they are the ones the plan marks: F1, F2, F3, F6, F8, M1, E1–E3, E6–E11, D1, R1–R7 (R3 once per layer mode) and J5–J9. The pins passed: F4, F5, F7, M2 in its three modes, E4, E5, D2, D3, R8 and R9.
- **Each new part removed in turn**, with both files run against the result:

  | Removed | Cases that fail |
  |---|---|
  | the layer watch | E7, E8, J6, J7 |
  | the `focusout` listener | E3, J5 |
  | the related-target test in `onFocusOut` | E4, J11 |
  | the `_navigating` test in `onFocusOut` | E5 |
  | the fire after a walk that moved nothing | E6 |
  | the modal rule in `currentFlags` | M1, E7, E8, S4, S6, J4, J6, J7 |
  | the guard in `fireChangeIfFlipped` | 12 cases, among them E1, E9, E11, R2, R5 |
  | the fire for a focus move that records nothing | E2, S12, J8, J9 |
  | the fire in `clear()` | E9 and the existing `clear()` case |
  | `firstCandidate` in `canGoBack`, with `_index > 0` back in its place | 18 cases, among them F1–F3, F6, F8, W4 |
  | `removeBackgroundSurface` in `disable()` | D1 |
  | the `fireChangeIfFlipped()` that ends `enable()` | D1, D2 |
  | the modal-change test in `onLayersChanged` | J10, J11 and the two offline cases of item 5 |

  The table is from the code as built, with item 5 in it.
- **Commands.** `npm run typecheck`, `typecheck:test` and `npm run lint` are clean. The full suite passes: 556 files, 9793 cases, 2 todo. `npm run docs:api` ends with no warning, and `npm run docs:llms:check` reports nothing unaccounted for.
- **MV1–MV4, in headless Chromium 155** on the demo's `#/misc` page, served from this worktree on a port and a Vite cache of its own. The page was driven through the browser's debugging interface with focus emulation on: focus given by `element.focus()`, the keys and the click sent as real input. All four rows came out as the table says. MV1: the click on the empty page logged `true/false` with `<body>` focused, and `Alt+[` returned to the button and logged `false/false`. MV2: `Enter` logged nothing, focusing `Apply` logged `true/false`, `Escape` logged nothing and left `<body>` focused with `canGoBack()` `true`, and `Alt+[` landed on "Filters (PopupPanel)" and logged `false/false`. MV3: `Enter` logged `false/false`, and `Escape` logged `true/false` once with focus back on the dialog button. MV4: `Enter` logged nothing, and `Escape` logged `true/false` and then `false/false`. The four rows were run again after item 5, with the same result. One row beyond the plan's was run then: with `[S, D*]`, focus on "Dismiss on blur" and its popover open, `FocusHistory.back()` from the console closed the popover, landed on `S` and logged `false/true` once.
- **MV5 was not run.** Neither Firefox nor a WebKitGTK browser is installed on this machine.

Logs, the driver script and the mutation script are kept at `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/impl/can-go-back/`. The throwaway Vite config and the browser profile were removed.
