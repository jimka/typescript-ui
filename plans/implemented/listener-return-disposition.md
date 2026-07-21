---
depends-on: [viewport-event-propagation]
touches-shared: [packages/lib/src/typescript/lib/core/Event.ts, packages/lib/src/typescript/lib/core/Component.ts]
---

# Listener Return Disposition — Implementation Plan

## Overview

Both dispatchers in [`core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts)
follow the rule "the dispatcher never stops propagation for a component; a
handler that consumes an event calls `stopPropagation()` itself". The rule is
right; the mechanism has two defects.

A handler can only consume if it still holds the event object. A bound wrapper
that drops its event argument silently defeats the consume and the typechecker
sees nothing wrong — that is what happened to
`Accordion._boundOnGutterDragEnd`.[^dropped-event] It also forced three public
methods (`AbstractWindow.onMouseUp`, `SplitGutter.onDragStop`,
`WindowBorder.onDragStop`) to grow an event parameter whose only use is reaching
`stopPropagation()`. Separately,
[`baseListener`](packages/lib/src/typescript/lib/core/Event.ts#L84) monkey-patches
`evnt.stopPropagation` (lines 96-102) to detect a consume, because it must know
whether to run its ancestor walk.

This plan replaces both with a **return value**. A listener returns a
disposition describing what the dispatcher should do with the event; the
dispatcher applies it. The monkey-patch is deleted, the listener parameter stops
being typed `Function`, and the three drag-stop methods drop the event parameter
they only carried to reach `stopPropagation()`.

**Precondition — base branch.** This work refactors code that exists only on the
unmerged stack `master → feature/viewport-event-propagation →
feature/create-tsui-app → feature/codeeditor-tab-indent`. Base the
implementation on `master` **after** that stack merges; a branch cut from
today's `master` would show the pre-fix dispatcher and the pre-fix handlers.

**This is a breaking change to a public contract, and must land before the
0.2.0 npm publish.**[^pre-publish]

---

## Architecture Decisions

### A listener returns what it wants done with the event

`Event.addListener`, `Event.addSubtreeListener`, and `Event.addViewportListener`
accept a listener whose return value tells the dispatcher whether to stop
propagation, suppress the default action, both, or neither. The precedent for a
return-value protocol on a listener is `Binding`'s `beforerecord` veto — a
listener returning `false` cancels the operation
([`Binding.ts:160`](packages/lib/src/typescript/lib/core/Binding.ts#L160), with
`ListenerBag.get` existing to support it).[^binding-precedent]

| Return | Effect |
|---|---|
| nothing / `false` | event untouched |
| `true` | `stopPropagation()` |
| `{ prevent: true }` | `preventDefault()` |
| `{ stop: true, prevent: true }` | both |

### `void` stays in the union

A listener may return nothing, so the ~52 viewport and ~186 exact-target/subtree
registrations that never consume need no edit. The consequence, stated plainly:
a wrapper with a block body that forgets to `return` still compiles, so the
compile-time guarantee is **partial**. What it removes is the dependence on a
wrapper forwarding the *event* — the failure that actually
happened.[^why-void-stays]

### Both dispatchers migrate, and the monkey-patch goes

`baseListener` and `baseViewportListener` both read the returned disposition.
The `evnt.stopPropagation` wrapper in `baseListener` (lines 96-102) is deleted;
the returned value is how the dispatcher learns a handler
consumed.[^both-dispatchers]

### A consuming subtree listener now breaks the ancestor walk

Today `baseListener` checks its consume flag once, before entering the subtree
walk (lines 121-144), and never inside it — so a subtree listener that consumes
still fires on every matching ancestor. After this change, a subtree listener
that returns a `stop` disposition ends the walk: the remaining listeners on the
*same* component still run, and no further ancestor is visited.

This is a behaviour change. It has **no current call sites**: no handler
registered through `addSubtreeListener` calls `stopPropagation()`
today.[^no-subtree-consumers] It makes the two dispatch stages agree — an
exact-target consume has always skipped the walk.

### `consumeWheel` stays

The wheel once-marker in
[`core/SmoothScroller.ts:31`](packages/lib/src/typescript/lib/core/SmoothScroller.ts#L31)
is not made redundant by the walk break and is not removed. Its whole purpose is
to let an inner scroll container tell outer ones "already handled" *without*
touching propagation — [`CodeEditor.claimScrollableWheel`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L487)
claims the wheel while deliberately calling neither `preventDefault()` nor
`stopPropagation()`, so CodeMirror's native scroll proceeds. A `stop` disposition
cannot express that.[^consume-wheel]

### A direct `stopPropagation()` no longer reaches the dispatcher

Calling `e.stopPropagation()` inside a handler still halts native DOM
propagation, exactly as before — it is the event's own method. What it no longer
does is influence the dispatcher's ancestor walk, because there is no wrapper
watching for it. Every handler that today relies on that side effect must return
a disposition instead; `## Consuming-Site Migration` lists them
all.[^direct-calls]

`preventDefault()` is unaffected in every respect: it never needed dispatcher
help, and calling it directly stays correct. Existing documentation examples
that call it need no rewrite.

### The protocol covers DOM-routed listeners only

A listener registered through the `Event` API — including one handed to a
semantic `on("action", …)` shorthand, which forwards the same function reference
straight to `Event.addListener` — participates. Custom events dispatched through
a `ListenerBag` and `emit` do **not**: they have no DOM event to stop, and
`Binding`'s `beforerecord` keeps its own `false`-means-veto
convention.[^custom-events]

### The listener parameter becomes a typed `Event.Listener`

The three `add*` and three `remove*` functions, and the `CompFunc` bucket, stop
using `Function` and take `Event.Listener` — the type that pins the return
value. The event parameter is typed `any` so the ~238 existing registrations
that annotate a narrower event (`MouseEvent`, `KeyboardEvent`, `WheelEvent`)
keep compiling.[^param-any]

---

## Public API

Declared inside the `Event` namespace in
[`core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts), above
`ListenerOptions`:

```typescript
export interface EventDisposition {
    /** Halt DOM propagation (`stopPropagation`). */
    stop?:    boolean;
    /** Suppress the browser's default action (`preventDefault`). */
    prevent?: boolean;
}

/** `true` is shorthand for `{ stop: true }`. Returning nothing leaves the event alone. */
export type ListenerResult = boolean | EventDisposition | void;

/** A DOM-routed listener registered through the `Event` API. */
export type Listener = (event: any) => ListenerResult;
```

Signature changes (all six registration functions):

```typescript
export function addListener(component: Component, type: string, listener: Listener, options?: ListenerOptions): void;
export function removeListener(component: Component, type: string, listener: Listener): void;
export function addSubtreeListener(component: Component, type: string, listener: Listener, options?: ListenerOptions): void;
export function removeSubtreeListener(component: Component, type: string, listener: Listener): void;
export function addViewportListener(component: Component, type: string, listener: Listener): void;
export function removeViewportListener(component: Component, type: string, listener: Listener): void;
```

Consumer-visible forwarders whose `Function` parameter becomes
`Event.Listener` (each is a public method on an exported class):

```typescript
// core/Component.ts
addMouseDownListener(listener: Event.Listener): this;
removeMouseDownListener(listener: Event.Listener): this;
addMouseDownSubtreeListener(listener: Event.Listener): this;
removeMouseDownSubtreeListener(listener: Event.Listener): this;

// component/button/Button.ts
addPointerDownListener(listener: Event.Listener): this;
export type ClickListener = (event: MouseEvent) => Event.ListenerResult;   // was `=> void`

// component/container/DialogBackdrop.ts
addClickListener(listener: Event.Listener): this;

// component/container/WindowHeader.ts
addHeaderDoubleClickListener(listener: Event.Listener): this;

// the `"action"` / `"keydown"` DOM-shorthand overloads on
// Checkbox, RadioButton, Slider, TextInput, AbstractSelectableList
on(event: "action", listener: Event.Listener): this;
off(event: "action", listener: Event.Listener): this;
```

---

## Internal Structure

One helper, then two three-line dispatcher edits:

```typescript
/**
 * Applies a listener's returned disposition to the event.
 *
 * @returns `true` when propagation was stopped, so a dispatcher can end its walk.
 */
function applyDisposition(evnt: Event, result: ListenerResult): boolean {
    if (result === undefined || result === false) {
        return false;
    }

    if (result === true) {
        evnt.stopPropagation();

        return true;
    }

    if (result.prevent) {
        evnt.preventDefault();
    }

    if (result.stop) {
        evnt.stopPropagation();

        return true;
    }

    return false;
}
```

`baseListener` — the local `propagationStopped` flag survives, but it is now set
from the return value rather than from a patched method, and it is also checked
**inside** the ancestor walk:

```typescript
let propagationStopped = false;

// (delete the originalStop / evnt.stopPropagation = … block, lines 98-102)

// exact-target stage — every listener in the bucket runs:
for (let listener of compFunc.listeners) {
    if (applyDisposition(evnt, listener.apply(compFunc.component, [evnt]))) {
        propagationStopped = true;
    }
}

// … existing `if (propagationStopped) { return; }` gate, unchanged …

// ancestor walk — same bucket rule, then stop climbing:
while (handle) {
    // … existing id / compFunc lookup …
    for (let listener of compFunc.listeners) {
        if (applyDisposition(evnt, listener.apply(compFunc.component, [evnt]))) {
            propagationStopped = true;
        }
    }

    if (propagationStopped) {
        return;
    }

    handle = DOM.source.getParentElement(handle);
}
```

`baseViewportListener` applies the disposition and **keeps broadcasting** — a
consume by one component never silences the others (the policy
`plans/implemented/viewport-event-propagation.md` fixed):

```typescript
for (let listener of compFunc.listeners) {
    applyDisposition(evnt, listener.apply(component, [evnt]));
}
```

---

## Consuming-Site Migration

Every handler registered through the `Event` API that calls `stopPropagation()`
today, and what it returns instead. Paths are relative to
`packages/lib/src/typescript/lib/`. Line numbers are as of the stack tip.

| Handler | Site | Returns | Notes |
|---|---|---|---|
| `FocusHistory.onKeyDown` | `core/FocusHistory.ts:222` | `{ stop: true, prevent: true }` | Matched-combo branch only. |
| `LayerManager.onKeyDown` | `core/LayerManager.ts:555` | `true` | Replaces the `stopPropagation` + `return` pair inside the loop. Needs a trailing `return;` after the loop. |
| `MenuBar._onKeyDown` | `component/menubar/MenuBar.ts:96,102,108,114,126,132` | `{ stop: true, prevent: true }` | Each `case` returns instead of `break`. Needs a trailing `return;` after the `switch`. |
| `Dialog.onKeyDown` | `overlay/Dialog.ts:997,1007,1013` | `{ stop: true, prevent: true }` | Also change the Enter branch (line 987) to `return this.onEnter(e);`. |
| `Dialog.onEnter` | `overlay/Dialog.ts:1046` | `{ stop: true, prevent: true }` | Return type becomes `Event.ListenerResult`; its early `return;`s stay. |
| `AbstractWindow.onDrag` | `overlay/AbstractWindow.ts:1758` | `{ stop: true, prevent: true }` | |
| `AbstractWindow.onMouseUp` | `overlay/AbstractWindow.ts:1784` | `true` | **Drop the `e?: Event` parameter** and its `@param`. |
| `AbstractWindow.onResizeEnd` | `overlay/AbstractWindow.ts:1534` | `true` | **Drop the `e: Event` parameter.** |
| `AbstractWindow.onSnapMouseDown` | `overlay/AbstractWindow.ts:2462` | `true` | Only the branch that calls `target.onDragStart()`; the early exits keep `return;`. |
| `DragManager.onMouseMove` | `overlay/DragManager.ts:493` | `true` | |
| `DragManager.onMouseUp` | `overlay/DragManager.ts:582` | `true` | |
| `Scrollbar._onDragMove` | `component/container/Scrollbar.ts:818` | `true` | |
| `Scrollbar._onDragEnd` | `component/container/Scrollbar.ts:841` | `true` | |
| `Scrollbar` arrow `_onMouseDown` | `component/container/Scrollbar.ts:264-265` | `{ stop: true, prevent: true }` | Restructure so there is one exit — see the snippet below. |
| `SplitGutter.onDrag` | `component/container/SplitGutter.ts:551` | `true` | |
| `SplitGutter.onDragStop` | `component/container/SplitGutter.ts:531` | `true` | **Drop the `e?: Event` parameter.** |
| `WindowBorder._dispatchDrag` | `component/container/WindowBorder.ts:188` | `true` | |
| `WindowBorder.onDragStop` | `component/container/WindowBorder.ts:246` | `true` | **Drop the `e?: Event` parameter.** |
| `Header.onResizeDrag` | `component/table/cell/Header.ts:460` | `true` | |
| `Header.onResizeDragStop` | `component/table/cell/Header.ts:465` | `true` | **Drop the `e: Event` parameter.** |
| `Accordion.onGutterDragEnd` | `layout/Accordion.ts:1949` | `true` | **Drop the `e?: Event` parameter**; retype the wrapper field at line 251 to `private _boundOnGutterDragEnd: () => Event.ListenerResult = () => this.onGutterDragEnd();`. |
| `CollapseButton.onDoubleClick` | `component/container/CollapseButton.ts:290` | `true` | |
| `CollapseButton.onMouseDown` | `component/container/CollapseButton.ts:302` | `true` | Body becomes a bare `return true;`. |
| `ResizeHandle._onClick` | `component/table/cell/ResizeHandle.ts:223` | `true` | Body becomes a bare `return true;`. |
| `ResizeHandle._onMouseDown` | `component/table/cell/ResizeHandle.ts:214` | `true` | **Add** the return — see the note below. |
| `Notification._boundOnCloseAction` | `overlay/Notification.ts:137` | `true` | Registered through `Button.on("action")`, so it is a dispatcher listener. |

`Header.onResizeDragStart` (`component/table/cell/Header.ts:447`) keeps its
direct `e.stopPropagation()` and is **not** migrated: it is not a dispatcher
listener — `ResizeHandle._onMouseDown` is, and it reaches `Header` through the
custom `"dragstart"` event. Today the walk skip comes from that nested direct
call; adding `return true` to `ResizeHandle._onMouseDown` preserves it. A
mousedown on a resize handle always starts a drag, so consuming it
unconditionally matches current behaviour.

The one restructure, `Scrollbar`'s arrow-button `_onMouseDown` (lines 264-272),
whose consume currently precedes an early exit:

```typescript
private _onMouseDown = (e: MouseEvent): Event.ListenerResult => {
    if (!this._disabled) {
        this._repeat.start();
    }

    return { stop: true, prevent: true };
};
```

---

## Ordered Implementation Steps

1. **Write the failing dispatcher tests first** in
   `packages/lib/tests/dom/events.test.ts`, covering cases 1-8 of
   `## Expected Behaviour`. Give every test a fresh `uniqueType()` — the file
   already provides the helper, and it exists for the harness trap in
   `## Potential Challenges`.
   → verify: `npm -w packages/lib run test` — the new cases fail.
2. **`core/Event.ts` — add the types.** Declare `EventDisposition`,
   `ListenerResult`, and `Listener` inside the `Event` namespace with the JSDoc
   from `## Public API`, and change `CompFunc.listeners` to `Listener[]`.
3. **`core/Event.ts` — add `applyDisposition`** (module-private inside the
   namespace, beside `captureOpts`), per `## Internal Structure`.
4. **`core/Event.ts` — rewrite `baseListener`.** Delete the
   `originalStop` / `evnt.stopPropagation = …` block (lines 98-102) and the part
   of the comment above it that describes wrapping; keep the paragraph stating
   the never-stop-on-a-component's-behalf policy and reword it to name the
   return value. Route both dispatch stages through `applyDisposition` and add
   the in-walk gate.
   → verify: `grep -n 'stopPropagation' packages/lib/src/typescript/lib/core/Event.ts`
   — matches only inside `applyDisposition` and in JSDoc prose.
5. **`core/Event.ts` — rewrite `baseViewportListener`** to apply the disposition
   and keep broadcasting.
6. **`core/Event.ts` — retype the six registration functions** to take
   `listener: Listener`, and update their JSDoc `@param listener` lines to
   describe the return protocol.
   → verify: `npm -w packages/lib run typecheck` — expect exactly the 30 errors
   listed in step 7, all of the form *"Argument of type 'Function' is not
   assignable to parameter of type 'Listener'"*.
7. **Retype the `Function`-typed forwarders.** Every one is a declared parameter
   or field type, never a call-site edit:
   - `core/Component.ts:5145,5158,5176,5190` — the four `addMouseDownListener` /
     `removeMouseDownListener` / `addMouseDownSubtreeListener` /
     `removeMouseDownSubtreeListener` parameters.
   - `component/button/Button.ts:1512` — `addPointerDownListener`; and widen
     `ClickListener` (line 36) to return `Event.ListenerResult`.
   - `component/container/DialogBackdrop.ts:54` — `addClickListener`.
   - `component/container/WindowHeader.ts:459` — `addHeaderDoubleClickListener`.
   - `component/container/WindowBorder.ts:80-82` — the three
     `private _dragStartListener` / `_dragStopListener` / `_fireDragListener`
     fields become `Event.Listener` (this clears 11 of the 30 errors).
   - `component/input/Checkbox.ts:333,352`,
     `component/input/RadioButton.ts:299,318`,
     `component/input/Slider.ts:425,444`,
     `component/input/TextInput.ts:207,213,232,238`,
     `component/list/AbstractSelectableList.ts:1397,1422` — the `"action"` (and
     `TextInput`'s `"keydown"`) `on` / `off` **overload** declarations take
     `Event.Listener`. Where the implementation signature keeps `Function`
     because it also serves custom-event keys, cast at the `Event.` call:
     `Event.addListener(this, "click", listener as Event.Listener)`.
   → verify: `npm -w packages/lib run typecheck` — zero errors.
8. **Fix the two test-side `Function` sites** flagged by
   `npm -w packages/lib run typecheck:test`: `tests/core/Form.test.ts:38` and
   `tests/unit/core/Event.test.ts:80`.
9. **Migrate the consuming handlers**, one file at a time, in the order of
   `## Consuming-Site Migration`. After each file:
   `npm -w packages/lib run typecheck`. Expect `TS7030 Not all code paths return
   a value` wherever a handler now returns on some paths — fix by adding an
   explicit bare `return;` on the others (see `## Potential Challenges`).
10. **Update the existing tests that assert the old mechanism.**
    `packages/lib/tests/dom/events.test.ts:83` (a handler calling
    `evnt.stopPropagation()` to skip the walk) becomes `() => true`, and the
    comment above it is rewritten. Re-read the whole
    `polite propagation` block (lines 262-420) and
    `packages/lib/tests/dom/viewport-consume.test.ts` and update any comment
    that describes the wrap-and-detect mechanism, including the `makeEvent`
    JSDoc at `packages/lib/tests/dom/TestDOM.ts:1237`.
    → verify: `npm -w packages/lib run test` — all suites green.
11. **Update `packages/lib/docs/concepts/events.md`** — see
    `## Documentation Impact`.
    → verify: `npm -w packages/lib run docs:build` — zero warnings.
12. **Update `ARCHITECTURE.md`** — the *Event handling* section gains the return
    protocol (two sentences plus the four-row table).
13. **Sweep.**
    `grep -rn 'stopPropagation' packages/lib/src/typescript/lib --include=*.ts`
    — every remaining call site is either `applyDisposition`,
    `Header.onResizeDragStart`, or prose. `grep -rn ': Function' packages/lib/src/typescript/lib --include=*.ts`
    — no remaining match is a listener passed to an `Event.` call.
14. **Manual verification** of the gesture and key paths (see `## Verification`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Event.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/FocusHistory.ts` |
| Modify | `packages/lib/src/typescript/lib/core/LayerManager.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/CollapseButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/DialogBackdrop.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowBorder.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowHeader.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/RadioButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextInput.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/DragManager.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Modify | `packages/lib/tests/dom/events.test.ts` |
| Modify | `packages/lib/tests/dom/viewport-consume.test.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` (comment only) |
| Modify | `packages/lib/tests/core/Form.test.ts` |
| Modify | `packages/lib/tests/unit/core/Event.test.ts` |
| Modify | `packages/lib/docs/concepts/events.md` |
| Modify | `ARCHITECTURE.md` |

---

## Expected Behaviour

Cases 1-8 are unit-testable in `packages/lib/tests/dom/events.test.ts`. The
offline harness has no `document`, so "the event kept propagating" is modelled
the way the existing tests model it: replace the synthetic event's
`stopPropagation` (and, for cases 3-4, `preventDefault`) with a counting spy and
assert the count.

1. **A listener returning nothing leaves the event alone.** One exact-target
   listener, handler body empty. Native `stopPropagation` 0 times,
   `preventDefault` 0 times.
2. **`return false` is the same as returning nothing.** Same setup, handler
   returns `false`. Both counts 0.
3. **`return true` stops propagation only.** `stopPropagation` 1,
   `preventDefault` 0.
4. **`return { prevent: true }` prevents the default only.** `preventDefault` 1,
   `stopPropagation` 0, and an ancestor subtree listener still runs.
5. **`return { stop: true, prevent: true }` does both.** Each count 1.
6. **An exact-target consume skips the ancestor walk.** Root has a subtree
   listener, child has an exact-target listener returning `true`. The ancestor
   handler does not run. With the child returning nothing, it runs once.
7. **A consuming subtree listener ends the walk at its own component.** Three
   nested components each with a subtree listener; the middle one returns
   `true`. Innermost and middle run; the outermost does not. *(New behaviour —
   fails before this change.)*
8. **Every listener on the consuming component still runs.** Two subtree
   listeners on the same component, the first returning `true`: both run, and
   the ancestor above does not.
9. **A viewport consume does not silence the other registered components.** Two
   components registered for one type, the first returning `true`: both handlers
   run and `stopPropagation` is called once. Repeat with the registration order
   reversed — unchanged. *(Preserves today's policy.)*
10. **A direct `e.stopPropagation()` no longer skips the walk.** Child's
    exact-target handler calls `e.stopPropagation()` and returns nothing; the
    root's subtree listener **runs**. *(This is the deliberate behaviour change
    from `## Architecture Decisions`; pin it so it cannot regress silently.)*
11. **The existing registrar regressions still hold.** `FocusHistory` consumes
    only its combos, `LayerManager` consumes Escape only when it closed a layer,
    `Dialog` consumes only the trapped `Tab`, and the Accordion gutter drag-end
    consumes its `mouseup`
    (`packages/lib/tests/dom/viewport-consume.test.ts`) — all unchanged, now via
    return values.

Manual only — the harness cannot drive real pointers or focus:

12. **Gestures unchanged**: window title-bar drag, window border resize, split
    gutter drag, accordion gutter drag, scrollbar thumb drag and arrow-button
    hold-repeat, table column resize.
13. **Column resize does not sort.** Dragging a table column's resize handle
    and releasing must not trigger the header's sort (`ResizeHandle._onClick`
    consuming the click, the walk-skip case that is load-bearing today).
14. **Wheel behaviour unchanged**: nested scroll containers, a `CodeEditor`
    inside a floating overlay (native scroll still works, no fall-through to the
    page behind), and a `VirtualScroller` inside a scrolling `Panel`.
15. **Keys unchanged**: `Escape` closes the top layer, `MenuBar` arrow keys walk
    the menu, `Dialog` traps `Tab`, and a `document`-level accelerator in
    consumer code still sees unconsumed keys.

---

## Verification

- `npm -w packages/lib run typecheck` — 0 errors.
- `npm -w packages/lib run test` — all suites (this script also runs
  `typecheck:test`). **Run it from the repo root as written**; a bare
  `npx vitest` from a worktree root misses the `~` path alias.
- `npm -w packages/lib run docs:build` — 0 warnings.
- `grep -rn 'stopPropagation' packages/lib/src/typescript/lib --include=*.ts` —
  only `applyDisposition`, `Header.onResizeDragStart`, and JSDoc prose.
- `grep -rn 'evnt.stopPropagation = ' packages/lib/src` — zero matches (the
  monkey-patch is gone).
- **Manual, in the demo app** (`npm run dev`, http://localhost:8015):
  1. **Window demo** — drag a window by its title bar; resize from each border;
     press `Escape` over an open dialog; `Tab` inside a dialog stays trapped.
  2. **Table demo** — drag a column's resize handle and release: the column
     resizes and the header does **not** re-sort.
  3. **Split / Accordion demos** — drag a split gutter and an accordion gutter;
     release outside the gutter; the drag ends and no further mousemove moves it.
  4. **Misc demo** — scrollbar arrow-button press-and-hold repeats; thumb drag
     works; a notification's close button dismisses it without opening the
     detail dialog (the `dblclick` suppression).
  5. **CodeEditor demo** — wheel-scroll inside the editor, then inside a
     `Popover` containing it: the editor scrolls and the page behind does not.

---

## Documentation Impact

- **New exported types** on the `Event` namespace: `Event.EventDisposition`,
  `Event.ListenerResult`, `Event.Listener`. The namespace is already exported
  from [`core/index.ts:4`](packages/lib/src/typescript/lib/core/index.ts#L4), so
  no barrel change is needed; nested members ship with it. Each needs JSDoc — do
  not `{@link}` anything private or `@internal` from it
  ([CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).
- **Changed public signatures**: the six `Event` registration functions, the
  four `Component` mousedown forwarders, `Button.addPointerDownListener`,
  `Button.ClickListener`, `DialogBackdrop.addClickListener`,
  `WindowHeader.addHeaderDoubleClickListener`, the `"action"` / `"keydown"`
  `on` / `off` overloads on `Checkbox` / `RadioButton` / `Slider` / `TextInput` /
  `AbstractSelectableList`, and the dropped event parameter on
  `AbstractWindow.onMouseUp`, `SplitGutter.onDragStop`, `WindowBorder.onDragStop`.
- [`packages/lib/docs/concepts/events.md`](packages/lib/docs/concepts/events.md):
  rewrite the propagation paragraph at line 75 and add a **Consuming an event**
  section carrying the four-row return table, one example, and the rule that a
  direct `preventDefault()` is still fine while a direct `stopPropagation()` no
  longer ends the subtree walk. The `addSubtreeListener` section (line 47) gains
  one sentence: a subtree listener that consumes stops the event reaching
  ancestors.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) *Event handling*: the return protocol
  belongs beside the existing `Event.X` vs `on`/`off`/`emit` split, including
  that it does not extend to `emit`.
- No `packages/lib/llms.txt` change: its one Event line (line 110) states the
  routing rule, which is unchanged.
- Docs pages that call `e.preventDefault()` in an example
  (`docs/recipes/right-click-menu.md`, `docs/recipes/keyboard-shortcuts.md`,
  `docs/concepts/accessibility.md`, `docs/components/Menu.md`) stay as they are —
  direct `preventDefault()` remains correct.

---

## Potential Challenges

- **`noImplicitReturns` bites every partially-consuming handler.** The lib
  compiles with `noImplicitReturns: true`, so a handler that returns a value on
  one path and falls off the end on another is `TS7030 Not all code paths return
  a value`. An explicit bare `return;` satisfies it — verified against the
  project's own compiler settings:

  | Handler shape | Compiles |
  |---|---|
  | `if (x) { return true; }` then end of body | ✗ TS7030 |
  | `if (x) { return true; } return;` | ✓ |
  | `switch` whose cases `return`, then end of body | ✗ TS7030 |
  | same `switch`, then a trailing `return;` | ✓ |

- **The viewport test harness silently swallows repeat registrations.**
  `viewportListenerMap` is module-level state in `Event.ts` and the window
  listener attaches only when a type is *first* registered, while `DOM.reset()`
  replaces the sink without clearing the map. Once an earlier test in the same
  file has registered e.g. `"mouseup"`, a later registration of that type never
  re-attaches and no dispatch reaches it — the test observes nothing and passes
  for the wrong reason. `packages/lib/tests/dom/events.test.ts` sidesteps this
  with `uniqueType()` per test; `packages/lib/tests/dom/viewport-consume.test.ts`
  lives in its own file because it exercises a real registrar hardcoded to
  `"mouseup"`. Follow whichever applies; do not add a second real-registrar
  test to an existing file.
- **Base branch.** See the precondition in `## Overview`. Every line number in
  this plan is from the stack tip; re-grep after the merge if a number looks off.
- **Publish ordering.** `Event.addViewportListener` and friends are exported, so
  this is a public contract change. It must land before the 0.2.0 npm publish,
  alongside `plans/size-setter-interface.md` — `packages/create-app` pins a
  library version and the downstream `sqladmin` repo consumes it.[^pre-publish]
- **The docs app registers one subtree listener.**
  `packages/docs/src/shell/DocsContent.ts:51` wires a `click` handler that calls
  `preventDefault()` only, so it needs no change — but run
  `npm -w packages/docs run typecheck` once to confirm.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) —
  read `baseListener` (lines 84-145) and `baseViewportListener` (147-165) first;
  they are the whole mechanism.
- [`packages/lib/src/typescript/lib/core/Binding.ts:160`](packages/lib/src/typescript/lib/core/Binding.ts#L160) —
  the in-tree precedent for a listener return value steering the caller.
- [`packages/lib/src/typescript/lib/core/SmoothScroller.ts:31`](packages/lib/src/typescript/lib/core/SmoothScroller.ts#L31) —
  `consumeWheel`, and why it is not replaced.
- [`packages/lib/tests/dom/events.test.ts`](packages/lib/tests/dom/events.test.ts) —
  the test shape to copy: `uniqueType()`, `makeEvent`, counting spies.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) —
  `makeEvent` (line 1247) supplies both `stopPropagation` and `preventDefault`,
  so the dispatcher can call either offline.
- [`plans/implemented/viewport-event-propagation.md`](plans/implemented/viewport-event-propagation.md) —
  the propagation policy this plan re-implements; its `## Implementation Notes`
  record the dropped-event bug.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Event handling*, including the
  named-function rule that the migrated handlers must keep obeying.

---

## Non-Goals

- **No change to the `on` / `off` / `emit` custom-event surface.** It dispatches
  no DOM event, so a disposition would mean nothing there.
- **No removal of `consumeWheel`.** See `## Architecture Decisions`.
- **No `preventDefault` migration.** Handlers that only call `preventDefault()`
  keep doing so; rewriting them would touch ~139 sites for no behaviour change.
- **No change to registration bookkeeping, teardown, or passive-options
  handling.** `installBaseListener`, `captureOpts`, `PASSIVE_TYPES`, and
  `reindexComponent` are untouched; only the registration functions' `listener`
  parameter type changes.
- **No first-consumer-wins for viewport dispatch.** Every registered component
  keeps receiving the event.

---

## Implementation Notes

- **The plan's `[^param-any]` measurement was wrong, and seven unplanned files
  had to change because of it.** That footnote predicted the typed `Listener`
  would produce "exactly 30 errors, all of them `Function`-typed forwarder
  declarations … and none of them a return-type mismatch at a call site." The
  second half is false. Every concise-arrow listener whose expression happens to
  evaluate to a non-`void` value became a return-type error at the call site,
  because `ListenerResult` does not admit arbitrary values. The affected
  expressions were chained builders returning `this` (`goToPage`), methods
  returning a `Promise`, and `async` handlers. Fixed by wrapping each in a block
  body or `void`, which is why these files are modified without appearing in the
  plan's Files table: `src/typescript/MiscPanel.ts`,
  `src/typescript/MarkdownEditorPanel.ts`,
  `src/typescript/MultiSelectListPanel.ts`,
  `src/typescript/lib/component/display/PaginationBar.ts`,
  `src/typescript/lib/component/table/TablePanel.ts`,
  `src/typescript/lib/component/table/TreeTablePanel.ts`, and
  `tests/overlay/Dialog.test.ts`.
- **`async` listeners are a consumer-visible break the plan did not anticipate.**
  An `async` function returns `Promise<void>`, which is not a `ListenerResult`,
  so any consumer with an `async` listener gets a compile error. This is the
  most likely thing to bite an upgrader, and it is now documented in
  `docs/reference/migration.md` under "Event listeners consume by return value"
  with the `void persist()` workaround.
- **Four tests were left asserting the old mechanism and had to be rewritten.**
  Plan step 10 asked for a re-read of the whole `polite propagation` block in
  `tests/dom/events.test.ts`; the comment above it was updated but the handlers
  below were not. Four of them consumed via a direct `e.stopPropagation()`,
  which under the new protocol does **not** consume — so they asserted only that
  the test's own arrow had called the test's own spy, and would have passed with
  `applyDisposition` deleted. Two of those four were the only coverage for
  Expected Behaviour case 9. All four now return `true`, and the two that pin a
  stop were verified non-vacuous by neutering `applyDisposition` and confirming
  they go red.
- **The public method-signature breaks needed their own migration entry.** The
  protocol change also alters five public overridable methods —
  `AbstractWindow.onMouseUp`, `SplitGutter.onDragStop` and
  `WindowBorder.onDragStop` drop their event parameter, and those plus
  `AbstractWindow.onDrag` and `SplitGutter.onDrag` now return a disposition. An
  override written against the old signature **still compiles and silently
  stops consuming**: TypeScript accepts an extra optional parameter on a
  subclass method, and `void` is a member of `ListenerResult`, so the compiler
  reports nothing and the handler simply never consumes. That is the same
  failure class this plan exists to remove, so it is documented explicitly in
  `docs/reference/migration.md` rather than left to the type checker.
- **`ARCHITECTURE.md` received a prose paragraph rather than the "two sentences
  plus the four-row table" step 12 specified.** The four return forms are stated
  inline instead of as a table. The rules document is dense prose throughout and
  a table would have been the only one in the file; the table itself lives in
  `docs/concepts/events.md`, which is the consumer-facing surface.
- **This branch was finished by the orchestrating context, not the implementing
  agent.** The agent stalled waiting on a backgrounded `docs:build` and had
  committed only the plan-move bookkeeping commit, leaving all 38 changed files
  uncommitted. The parent verified them (typecheck, full suite, plan Files-table
  coverage), committed them in code / documentation / tooling buckets, moved the
  plan, and ran the docs build in the foreground.

---

## Notes

[^dropped-event]: `Accordion._boundOnGutterDragEnd` was `() => this.onGutterDragEnd()`.
    Because the event parameter on `onGutterDragEnd` was optional (it has a
    non-listener caller at `Accordion.ts:1132`), the wrapper that discarded the
    event typechecked cleanly, and the `stopPropagation()` inside the handler
    could never run on the viewport path. It was found only by a test that
    dispatched a real event through the registration boundary
    (`packages/lib/tests/dom/viewport-consume.test.ts`). Under the return
    protocol the same wrapper is `() => this.onGutterDragEnd()` with the
    concise-arrow body *returning* the handler's result — forwarding becomes the
    default rather than something to remember.

[^pre-publish]: `packages/lib/package.json` is at `0.1.0` and
    `Event.addViewportListener` / `addListener` / `addSubtreeListener` are
    exported through the `core` entry point, so the listener contract is public
    API. `packages/create-app` pins a library version and the downstream
    `sqladmin` repo consumes the published package, so a change to this contract
    after 0.2.0 would break a shipped consumer. Pre-1.0 is the window for
    breaking changes; this one and `plans/size-setter-interface.md` should go
    through it together.

[^binding-precedent]: `Binding.setRecord` consults every `beforerecord`
    listener and aborts when one returns `false`
    ([`Binding.ts:160`](packages/lib/src/typescript/lib/core/Binding.ts#L160));
    `ListenerBag.get` exists specifically so a host can implement
    "early-termination when a listener returns `false`", as its own JSDoc says.
    So a listener steering its dispatcher through a return value is an
    established shape here, not a new one. The polarity differs — `false` vetoes
    there, `true` stops here — because the two answer different questions
    ("should this proceed?" vs "what should happen to this event?"), and the
    surfaces never meet: `beforerecord` is a `ListenerBag` custom event, and the
    disposition applies only to DOM-routed listeners.

[^why-void-stays]: There are ~52 `addViewportListener` and ~186
    `addListener` / `addSubtreeListener` registrations in `packages/lib/src`;
    roughly 26 handlers consume. Requiring an explicit `return false` everywhere
    would be a ~238-site edit that buys a guarantee TypeScript still cannot give
    in the case that matters — a block-bodied wrapper that forgets to return
    type-checks either way, because `void` has to remain assignable somewhere
    for the non-consuming majority. The gain that is real: a consume no longer
    depends on a wrapper forwarding the event, and a concise-arrow wrapper
    forwards the disposition automatically.

[^both-dispatchers]: Migrating only `baseViewportListener` would leave
    `baseListener` needing the wrapper for its walk gate, so the two dispatchers
    would again disagree about how a handler consumes — the inconsistency that
    produced the original bug. The wrapper also has a cost beyond tidiness: it
    reassigns a method on an event object the framework does not own, which is
    invisible to any other listener that captured the original reference.

[^no-subtree-consumers]: Verified by intersecting every
    `Event.addSubtreeListener` registration in `packages/lib/src` with every
    handler containing `stopPropagation`. The stop sites are all in viewport
    handlers, exact-target handlers, or non-listener methods reached through a
    custom event; no subtree handler consumes. The nearest case,
    `Header.onResizeDragStart`, is reached through `ResizeHandle`'s custom
    `"dragstart"` event from an *exact-target* listener, which already skips the
    walk today.

[^consume-wheel]: Three properties of `consumeWheel` a `stop` disposition
    cannot reproduce. (1) `CodeEditor.claimScrollableWheel` claims the wheel and
    calls neither `preventDefault()` nor `stopPropagation()`, so CodeMirror's
    native scroll proceeds while the enclosing overlay's `WheelTrap`
    (`core/WheelTrap.ts`) sees the claim and leaves it alone; returning `stop`
    would halt the event for everything below the window capture phase.
    (2) The claim is read *before* a handler acts (`if (!consumeWheel(e)) return;`
    in `Component.onWheelScroll` and `VirtualScroller.onWheel`), which is a
    different question from "what should happen after I acted". (3) It is
    conditional on axis extent in `CodeEditor`, so the same gesture is claimed
    on one axis and deliberately left free on the other. The walk break and the
    wheel marker therefore coexist; neither subsumes the other.

[^direct-calls]: The alternative — keeping a wrapper purely so a direct
    `stopPropagation()` still gates the walk — would preserve both mechanisms
    and both failure modes, and is exactly what this plan removes. The cost of
    dropping it is bounded and enumerated: `## Consuming-Site Migration` is the
    complete list of handlers that relied on the side effect, produced by
    grepping every `stopPropagation` call in `packages/lib/src` and resolving
    how each handler is registered.

[^custom-events]: A `ListenerBag` fan-out has no DOM event in hand, so
    `stop` / `prevent` have nothing to act on; a host that wants a cancellable
    custom event already has a shape for it (`Binding`'s `beforerecord`, and
    `Drawer`'s `beforeclose` controller). Extending the disposition there would
    add a second veto convention to the same surface. The semantic
    `on("action", …)` shorthands are the boundary case and they *are* covered,
    because they hand the same function reference to `Event.addListener` — which
    is why `Button.ClickListener` widens its return type.

[^param-any]: `Listener`'s parameter is `any` rather than `globalThis.Event`
    because under `strictFunctionTypes` a handler annotated `(e: MouseEvent) =>
    …` is not assignable to `(e: Event) => …`, and nearly every registration in
    the library annotates a narrow event type. This was measured, not assumed:
    with `Listener = (event: any) => ListenerResult` applied to all six
    registration functions, the library typechecks with exactly 30 errors, all
    of them `Function`-typed forwarder declarations (step 7), and none of them a
    return-type mismatch at a call site. **The last clause proved false in
    implementation** — see `## Implementation Notes`. Concise-arrow listeners
    whose expression evaluates to a non-`void` value (a builder returning
    `this`, a `Promise`, an `async` handler) do produce call-site return-type
    errors.
