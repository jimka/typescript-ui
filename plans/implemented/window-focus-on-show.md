---
depends-on: [focus-history-can-go-back-follows-focus]
touches-shared:
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
  - packages/lib/src/typescript/lib/layout/LayoutSerialization.ts
  - packages/lib/tests/component/default-options-fallback.test.ts
  - packages/lib/docs/components/Window.md
  - packages/lib/docs/components/AbstractWindow.md
  - packages/lib/docs/concepts/accessibility.md      # also edited by spatial-navigation-redesign (another section) and dialog-close-button-label
  - packages/lib/docs/reference/changelog/next.md    # also edited by every branch of the stack
  - packages/lib/docs/reference/migration/next.md
---

# Window Focus on Show — Implementation Plan

## Overview

A [`Window`](../packages/lib/src/typescript/lib/overlay/Window.ts#L74) or [`TabWindow`](../packages/lib/src/typescript/lib/overlay/TabWindow.ts#L78) that code shows does not take keyboard focus. Focus stays on whatever opened the window. A screen reader announces the window only when focus happens to enter it, and a keyboard user reaches it only by `Tab` order or a pointer.

The library already means a window to take focus when it becomes the active window. [`AbstractWindow.onActivate`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L963) focuses the window's own element, and [`restore()`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1530) does so by hand. [`show()`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L792) is the one path where the focus call is lost: it activates the window at line 807 and puts the element in the document at line 828, and a browser ignores a focus call on an element that is not in the document. What every layer does today is in [Addendum: What each layer does with focus today](#addendum-what-each-layer-does-with-focus-today).

This plan makes a window take focus when code shows or raises it, gives the window an `autoFocus` option to turn that off, and returns focus to where it came from when the window closes. The code change is in `overlay/AbstractWindow.ts`, plus one line in `layout/LayoutSerialization.ts`. `Dialog`, `Drawer`, `Popover`, `LayerManager` and the focus services are not changed.

Line numbers and links are those of commit `59a5c2e27`, the tip of `feature/focus-history-can-go-back-follows-focus`, which this plan is implemented on. The code it builds on is not on `master`.

Four choices here change behaviour an application could rely on. They are listed next and are not settled until the user signs them off.

---

## Decisions Awaiting Sign-off

The plan is written for the recommended answer to each. A different answer means revising the plan before it is implemented; the implementer does not choose.

| # | Question | Recommended, and what the plan builds | If answered otherwise |
|---|---|---|---|
| 1 | Does a window take focus when code shows it? | **Yes, unless it is built with `autoFocus: false`.** The default is `true`.[^options] | Default `false`: nothing changes for existing code, and every application has to opt in to be accessible. Cases F1, F2 and J1 then need `autoFocus: true`, and the migration note is dropped. |
| 2 | Which element takes focus? | **The window's own element**, as on every other activation today.[^target] | The first focusable control of the content: needs the order of `Dialog.focusFirst`, a wait for `contentFactory` content, and a decision about a destructive first button. |
| 3 | Does focus return when the window closes? | **Yes, to the element focus was on when the window last took focus, and only when focus is inside the window as it closes.**[^return] | No: a closed window leaves focus on `<body>`, as today. Step 6, the C cases and case F8 are dropped. |
| 4 | Does `bringToFront()` take focus on a window that is already the active one? | **Yes.** Today it moves focus only when the raise changes which window is active.[^raise] | No: step 4 keeps today's `bringToFront()`, and case R1 flips to "focus stays". |

Decision 1 is a breaking change. The migration note is in [`## Documentation Impact`](#documentation-impact).

---

## Architecture Decisions

### One private method moves focus into a window — `takeFocus()`

`AbstractWindow.focusSelf()` is renamed `takeFocus()` and becomes the only place the library moves focus into a window. It does nothing when the window has no element, when the window is inert, or when focus is already inside the window or a layer opened from it. Otherwise it remembers the focused element as the place to return to, refreshes the accessible name, and focuses the window's element with `preventScroll`.

A window is *inert* while a modal `Dialog` or modal `Drawer` it does not belong to is open; `LayerManager` tells it so through `onInertChanged`, and the window reads its own state with `getInertAttribute()`.[^inert-guard]

| State when `takeFocus()` runs | Focus moves | Remembered return target |
|---|---|---|
| focus on a page button `X` | to the window | `X` |
| focus on a field inside the window | no | unchanged |
| focus in a dropdown opened from the window | no | unchanged |
| the window is inert | no | unchanged |
| the window has no element yet | no | unchanged |
| nothing focused (`<body>`) | to the window | `<body>` |

### The focused element is the window itself

`takeFocus()` focuses the window's root element, which carries `tabindex="-1"`, `role="dialog"` and its name. A screen reader announces the name and the role as focus lands. `Tab` then moves to the window's first control. No control inside the window is focused by the library.[^target]

### `show()` takes focus after the next layout flush

`show()` raises and activates the window without moving focus, then queues `takeFocus()` with `Component.afterNextLayout`, which runs a callback once the next batched layout pass has finished. This is how [`Dialog.open`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1031) and [`Drawer.open`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L376) queue their own focus moves. The handle is kept in `_takeFocusLayout` and cancelled when the window closes or is disposed first.[^deferred]

| At the flush | Result |
|---|---|
| the window is shown, not inert, and `autoFocus` is `true` | `takeFocus()` runs |
| `autoFocus` is `false` | nothing was queued |
| the window is minimized | skipped |
| the window is inert | `takeFocus()` returns without moving focus; the window does not take focus later either |
| the application focused a field in the window meanwhile | focus is inside, so nothing moves |
| the window was closed or disposed | the callback was cancelled |
| two windows were shown in the same task | each takes focus in the order shown; the last one ends with it |

### `autoFocus` — an option at construction, default `true`

`WindowOptions` gains `autoFocus`. It governs the two ways code brings a window forward, `show()` and `bringToFront()`. It does not govern a pointer press inside the window or `restore()`, which the user asked for directly.

The option follows [`constrainToViewport`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2195): a class default in `_defaultWindowOptions`, a setter that writes `_options`, a getter that folds the default, and an always-dispatch line in `applyOptions`.[^options]

| How the window comes forward | `autoFocus: true` (default) | `autoFocus: false` |
|---|---|---|
| `show()` | takes focus after the next layout | focus stays where it is |
| `bringToFront()` | takes focus at once | focus stays where it is |
| a pointer press inside it | as today: focus moves to the window when the press activates it | the same |
| `restore()` from minimized | takes focus | takes focus |
| focus moves in by `Tab` or by the application's own `focus()` call | nothing more happens | the same |

### `bringToFront()` takes focus even when the window is already active

`bringToFront()` raises the window, then calls `takeFocus()` when the window is shown and `autoFocus` is `true`. A window is *shown* while it is in `AbstractWindow.openWindows`. This mirrors [`restore()`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1530), which makes its focus call explicit because a raise of an already-active window activates nothing.[^raise]

The window's own `mousedown` listener no longer calls `bringToFront()`. It calls a new private `raise(true)`, which raises and activates and leaves the focus to the activation and to the browser, as today.[^press]

| Window state, focus | `bringToFront()` today | After |
|---|---|---|
| shown, not active, focus on the page | focus to the window | the same |
| shown, active, focus on the page | focus stays | focus to the window |
| shown, focus inside it | focus stays | the same |
| shown, `autoFocus: false` | focus to the window when the raise activates it | focus stays |
| not shown | nothing | the same |

### Focus returns to where it came from when the window closes

`takeFocus()` stores the element it took focus from in `_previousFocus`. [`onExitAction()`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1063) returns focus there, right after `LayerManager.unregister(this)`, when focus is inside the window (or a layer opened from it) as the close starts. The stored element is skipped when it has been disposed or removed from the page. The three parts mirror [`Drawer`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L517): `_previousFocus`, a queued focus move, `restorePreviousFocus()`.[^return]

| As the window closes | Focus afterwards |
|---|---|
| focus inside the window; it took focus from button `X`, which is still on the page | `X` |
| focus inside the window; `X` was disposed or removed | where the browser puts it (`<body>`) |
| focus is on the page (the user moved on, or code closed a background window) | unchanged |
| the window never took focus (`autoFocus: false`, never pressed) | unchanged |
| a `"beforeclose"` listener vetoes the close | unchanged; the stored element is kept |
| the window is disposed without being closed | unchanged: disposal is not a close |

### A window the library restores from a saved layout does not take focus

[`applyWindow`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L652), the function `restoreLayout` uses to rebuild a floating window, constructs its `Window` with `autoFocus: false`. A layout restore can show several windows from code, typically at startup, and none of them was asked for by a gesture on that window. A torn-off tab's window keeps the default and takes focus, as its code comment already intends.[^restore-layout]

### `FocusHistory` needs no change

[`FocusHistory`](../packages/lib/src/typescript/lib/core/FocusHistory.ts) is the optional service behind `Alt+[` and `Alt+]`. It keeps a *trail* of the elements focus has been on, and each entry is a *stop*. A window's element is a stop today, and stays one. With the trail written oldest first and `*` on the current stop:

| What happens | Trail before | Trail after |
|---|---|---|
| focus on `X`; a window is shown and takes focus | `[X*]` | `[X, W*]` |
| the window closes with focus inside; focus returns to `X` | `[X, W*]` | `[X*]` once pruned: `W` has left the document and the two `X` neighbours merge |
| `Alt+[` inside the open window | `[X, W*]` | `[X*, W]`, focus on `X`; the window stays open |
| the service is not enabled | — | the window's own return puts focus on `X` |

### A window that does not take focus is not announced

When `autoFocus` is `false`, or the window is shown while it is inert, the library announces nothing. The window is announced with its role and name when focus first enters it. An application that wants such a window announced shows a [`Notification`](../packages/lib/src/typescript/lib/overlay/Notification.ts) or writes to its `StatusBar`, which are the library's two live regions.[^announce]

---

## Public API

```typescript
// overlay/AbstractWindow.ts

export interface WindowOptions extends ContainerOptions {
    // … existing fields …

    /**
     * Whether the window takes keyboard focus when code shows it (`show()`)
     * or raises it (`bringToFront()`). Defaults to `true`. Pass `false` for a
     * window opened in the background — a tool palette, a log window — so
     * that it does not take the caret from what the user is typing in.
     */
    autoFocus?: boolean;
}

// class AbstractWindow

/** New. Sets whether code that shows or raises the window also moves focus into it. */
setAutoFocus(value: boolean): this;

/** New. Whether code that shows or raises the window also moves focus into it. */
isAutoFocus(): boolean;
```

- Backing: `_options.autoFocus`, read as `this._options.autoFocus ?? this._defaultOptions.autoFocus!`. Class default `autoFocus: true` in `_defaultWindowOptions`. No private backing field.
- `show()`, `bringToFront()`, `restore()`, `onActivate()` and `onExitAction()` keep their signatures.
- `Window`, `TabWindow`, `Dialog`, `Drawer`, `Popover` and `LayerManager` gain no member.

---

## Internal Structure

All in `overlay/AbstractWindow.ts`. Every new member gets a JSDoc block ([CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md)). No call sits directly in an `if` condition: assign the result to a named constant first.

```typescript
// The element focus was on the last time the window took focus, to return
// focus to when the window closes with focus inside it.
private _previousFocus: Handle | null = null;

// The pending move of focus into a window just shown, queued past the next
// layout flush; null when none is pending.
private _takeFocusLayout: { cancel(): void } | null = null;

// False only while code raises the window without wanting focus moved, so
// that the activation that raise causes moves none.
private _focusOnActivation: boolean = true;
```

```typescript
private raise(takeFocus: boolean): void {
    this._focusOnActivation = takeFocus;
    LayerManager.bringToFront(this);
    this._focusOnActivation = true;
}

bringToFront(): void {
    const shown     = AbstractWindow.openWindows.has(this);
    const takeFocus = shown && this.isAutoFocus();

    this.raise(takeFocus);

    if (takeFocus) {
        this.takeFocus();
    }
}

onActivate(active: boolean): void {
    this.paintActive(active);

    if (active) {
        // Before the focus move: the name is announced as focus arrives.
        this.reflectAccessibleName();

        if (this._focusOnActivation) {
            this.takeFocus();
        }

        this.emit("activate");
    }
}

private takeFocus(): void {
    const element = this.getElement();

    if (!element || this.getInertAttribute()) {
        return;
    }

    const active = DOM.source.getActiveElement();
    const inside = LayerManager.containsAcrossLayers(this, active);

    if (inside) {
        return;
    }

    this._previousFocus = active;
    this.reflectAccessibleName();
    // preventScroll: the window is a fixed overlay; a native focus scroll
    // would jolt an overflow-hidden ancestor.
    this.focus(true);
}

private takeFocusAfterShow(): void {
    this._takeFocusLayout = null;

    const minimized = this.isMinimized();

    if (minimized) {
        return;
    }

    this.takeFocus();
}

private restorePreviousFocus(): void {
    const previous = this._previousFocus;

    this._previousFocus = null;

    if (previous === null) {
        return;
    }

    // isRegistered first: isConnected throws on a released handle.
    const live = DOM.source.isRegistered(previous) && DOM.source.isConnected(previous);

    if (live) {
        DOM.sink.focus(previous, { preventScroll: true });
    }
}
```

In `show()`:

```typescript
this.doLayout();
this.raise(false);
// … unchanged down to the end of the method …

const autoFocus = this.isAutoFocus();

this._takeFocusLayout?.cancel();
this._takeFocusLayout = autoFocus
    ? Component.afterNextLayout(() => this.takeFocusAfterShow())
    : null;

return this;
```

In `onExitAction()`:

```typescript
onExitAction(): void {
    // Read before anything is torn down or unregistered.
    const heldFocus = LayerManager.containsAcrossLayers(this, DOM.source.getActiveElement());

    this._takeFocusLayout?.cancel();
    this._takeFocusLayout = null;

    // … unchanged down to …
    LayerManager.unregister(this);
    untrapWheel(this);

    if (heldFocus) {
        this.restorePreviousFocus();
    }

    // … unchanged …
}
```

---

## Ordered Implementation Steps

Work test-first. For each step write the named cases from `## Expected Behaviour`, see them fail, then make the change. Run only the files a step names until step 10.

1. **Baseline.** From `packages/lib`: `npx vitest run tests/overlay/AbstractWindow.activate.test.ts tests/overlay/AbstractWindow.aria.test.ts tests/overlay/AbstractWindow.locked.test.ts tests/overlay/Window.headerMoveTrigger.test.ts tests/overlay/Rail.test.ts tests/overlay/Dock.lifecycle.test.ts tests/overlay/LayerManager.modalFocus.test.ts tests/component/layout/LayoutSerialization.test.ts tests/component/layout/Tab.dockraise.test.ts tests/component/default-options-fallback.test.ts tests/core/FocusHistoryLayers.test.ts`. All must pass before any edit.

2. **The option.** In [`overlay/AbstractWindow.ts`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts):
   - Add `autoFocus?: boolean;` with its JSDoc to `WindowOptions`, after `constrainToViewport` ([:196](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L196)).
   - Add `autoFocus: true,` to `_defaultWindowOptions`, after `constrainToViewport: true,` ([:234](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L234)).
   - Add `setAutoFocus` and `isAutoFocus` after `isConstrainToViewport` ([:2206](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2206)), with the bodies of `setConstrainToViewport` / `isConstrainToViewport` and the key `autoFocus`.
   - In `applyOptions`, after the `setConstrainToViewport` line ([:551](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L551)), add `this.setAutoFocus(options.autoFocus ?? this.isAutoFocus());`.
   - In `tests/component/default-options-fallback.test.ts`, add the registry row `{ label: 'Window autoFocus', resolve: () => new Window('W').isAutoFocus(), expected: true }` after the `Drawer edge` row ([:403](../packages/lib/tests/component/default-options-fallback.test.ts#L403)), and import `Window` from `~/overlay/Window` if the file does not already.

   Check: cases O1–O3 pass.

3. **`takeFocus()`.** Add the three fields beside `_showAnimation` ([:357](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L357)). Rename `focusSelf` ([:981](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L981)) to `takeFocus` and replace its body and JSDoc with the snippet. Add `raise` before `bringToFront`. Replace `onActivate`'s body with the snippet. Update the constructor comment at [:442](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L442), which names `focusSelf`. Check: `grep -n "focusSelf" packages/lib/src packages/lib/docs -r` gives no match; cases T1–T5 pass; `tests/overlay/AbstractWindow.activate.test.ts` and `tests/overlay/AbstractWindow.aria.test.ts` pass unchanged.

4. **`bringToFront()` and the press listener.** Replace the body of [`bringToFront`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L923) with the snippet and extend its JSDoc with the focus rule. Change the field initializer of `_boundOnBringToFront` ([:381](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L381)) to `() => this.raise(true)`, and add to the comment above its registration ([:451](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L451)) that a press raises and activates and leaves focus to the activation. Check: cases R1–R6 pass.

5. **`show()`.** In [`show`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L792) replace `this.bringToFront();` ([:807](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L807)) with `this.raise(false);` and add the queueing lines before `return this;`. Add `takeFocusAfterShow` after `takeFocus`. In [`destructor`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1158), beside `this._showAnimation?.cancel();` ([:1179](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1179)), add `this._takeFocusLayout?.cancel(); this._takeFocusLayout = null; this._previousFocus = null;`. Extend `show()`'s JSDoc: the window takes focus once it has laid out, unless `autoFocus` is `false`. Check: cases F1–F6 and the dispose half of F7 pass.

6. **Return on close.** Add `restorePreviousFocus` after `takeFocusAfterShow`. Edit [`onExitAction`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1063) as in the snippet: the `heldFocus` read and the cancel are the first statements, and the restore follows `untrapWheel(this);` ([:1110](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1110)). Check: cases C1–C7, F8 and the close half of F7 pass.

7. **`restore()`.** In [`restore`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1530) replace `this.focus(true);` ([:1537](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1537)) with `this.takeFocus();`. Check: case R7 passes; `tests/overlay/AbstractWindow.locked.test.ts`, `tests/overlay/Window.headerMoveTrigger.test.ts` and `tests/overlay/Rail.test.ts` pass unchanged.

8. **Layout restore.** In [`layout/LayoutSerialization.ts`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L670) change `new Window(node.header)` to `new Window(node.header, { autoFocus: false })`, with a one-line comment: a restored layout shows its windows from code. Check: case L1 passes.

9. **Demo and documentation.** In `packages/lib/src/typescript/MiscPanel.ts`, beside the "Show window with title glyph" button, add a button "Show window without focus" that shows `new Window("Background window", { autoFocus: false })` holding one `TextField`. Then make the edits in `## Documentation Impact`.

10. **Verify.** Run `## Verification` in full.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` |
| Modify | `packages/lib/src/typescript/MiscPanel.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.focus.test.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.focusLayers.test.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutSerialization.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/components/Window.md` |
| Modify | `packages/lib/docs/components/TabWindow.md` |
| Modify | `packages/lib/docs/components/AbstractWindow.md` |
| Modify | `packages/lib/docs/components/Dock.md` |
| Modify | `packages/lib/docs/layouts/LayoutSerialization.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/recipes/focus-history.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

Cases O to L are testable offline in the modelled test DOM. Cases J run under jsdom against the real DOM seam. Cases MV need a browser or a screen reader.

Offline terms: `opener` is a rendered, connected, focused `Button` built by the `focusedOpener()` helper of [`Drawer.test.ts:138`](../packages/lib/tests/overlay/Drawer.test.ts#L138). `layout` is the `collectLayoutCallbacks()` helper of the same file ([:119](../packages/lib/tests/overlay/Drawer.test.ts#L119)): `layout.run()` runs what `Component.afterNextLayout` queued. `focus` is `vi.spyOn(DOM.sink, 'focus')`. `winEl` is `win.getElement()`. "Focus is on `e`" means `DOM.source.getActiveElement() === e`. Closing uses the `reduceMotion()` helper so the close completes at once.

### The option (offline)

| # | Given | Then |
|---|---|---|
| O1 | `new Window('W')`; `new TabWindow()` | `isAutoFocus()` is `true` on each |
| O2 | `new Window('W', { autoFocus: false })` | `isAutoFocus()` is `false` |
| O3 | O1's window; `setAutoFocus(false)`, then `setAutoFocus(true)` | `isAutoFocus()` is `false`, then `true` |

### `takeFocus()` through activation (offline)

Driven with `win.onActivate(true)` on a rendered window, as [`AbstractWindow.activate.test.ts:29`](../packages/lib/tests/overlay/AbstractWindow.activate.test.ts#L29) does.

| # | Given | Then |
|---|---|---|
| T1 | focus on `opener`; `onActivate(true)` | `focus` called once with `(winEl, { preventScroll: true })`; focus is on `winEl` |
| T2 | a child element of `winEl` has focus; `onActivate(true)` | `focus` not called |
| T3 | `win.onInertChanged(true)`; `onActivate(true)` | `focus` not called; `"activate"` still fires |
| T4 | a window never rendered; `onActivate(true)` | `focus` not called; no throw |
| T5 | a `TabWindow` with one tab; `getTitle` mocked to return `'B'`; `onActivate(true)` | at the moment `focus` is called, `getAria().getLabel()` is `'B'` |

### `show()` (offline)

| # | Given | Then |
|---|---|---|
| F1 | focus on `opener`; `win.show()` | before `layout.run()`: `focus` not called. After: `focus` called once with `(winEl, { preventScroll: true })`; focus is on `winEl` |
| F2 | the same with a `TabWindow` holding one tab | as F1; `getAria().getLabel()` equals `getTitle()` when `focus` is called |
| F3 | `new Window('W', { autoFocus: false })`; `show()`; `layout.run()` | `focus` not called; focus is on `opener` |
| F4 | `show()`; a child element of `winEl` is focused; `layout.run()` | the window calls no `focus`; focus stays on the child |
| F5 | `show()`; `win.onInertChanged(true)`; `layout.run()`; then `win.onInertChanged(false)` | `focus` not called at either point |
| F6 | `new Window('W', { windowState: 'minimized' })`; `show()`; `layout.run()` | `focus` not called |
| F7 | `show()`; `win.requestClose()` before `layout.run()`. Separately: `show()`; `win.dispose()` | `layout.cancel` called once in each |
| F8 | focus on `opener`; `a.show()`; `b.show()`; `layout.run()` | focus is on `b`'s element. `b.requestClose()`: focus is on `a`'s element. `a.requestClose()`: focus is on `opener`'s element |

### `bringToFront()`, a press, `restore()` (offline)

Each window is shown and `layout.run()` has run before the row starts, unless the row says otherwise.

| # | Given | Then |
|---|---|---|
| R1 | `win` is the active window; `DOM.sink.focus(openerEl)`; `win.bringToFront()` | focus is on `winEl` |
| R2 | `a` and `b` shown, `b` active; focus on `opener`; `a.bringToFront()` | focus is on `a`'s element; `focus` called once |
| R3 | `a` built with `autoFocus: false`, `b` active; focus on `opener`; `a.bringToFront()` | `focus` not called; `a` fired `"activate"` |
| R4 | a rendered window that was never shown; `bringToFront()` | `focus` not called |
| R5 | a child element of `winEl` has focus; `win.bringToFront()` | `focus` not called |
| R6 | `win` is the active window; focus on `opener`; `(win as any)._boundOnBringToFront()` | `focus` not called. With `b` active instead: focus is on `winEl`, also when `win` was built with `autoFocus: false` |
| R7 | `win` built with `autoFocus: false`, shown, minimized; focus on `opener`; `win.restore()` | focus is on `winEl`; closing `win` then puts focus on `opener` |

### Closing (offline)

| # | Given | Then |
|---|---|---|
| C1 | focus on `opener`; `show()`; `layout.run()`; `requestClose()` | focus is on `opener`'s element. The `focus` call comes after `LayerManager.unregister`: spy on both and compare `mock.invocationCallOrder` |
| C2 | C1's setup; `DOM.sink.focus(other)` on a second connected page element; `requestClose()` | `focus` not called by the close; focus stays on `other` |
| C3 | C1's setup; `setConnected(openerEl, false)`; `requestClose()` | `focus` not called with `openerEl`; no throw |
| C4 | C1's setup; `win.dispose()` | `focus` not called with `openerEl` |
| C5 | C1's setup; a `"beforeclose"` listener calls `preventDefault()`; `requestClose()`; then the listener is removed and `requestClose()` again | first: `focus` not called, focus stays on `winEl`. Second: focus is on `opener`'s element |
| C6 | `new Window('W', { autoFocus: false })`; `show()`; `layout.run()`; `requestClose()` | `focus` not called |
| C7 | C1's setup; `DOM.sink.focus(other)`; `win.bringToFront()`; `requestClose()` | focus is on `other` |

### Layout restore (offline)

| # | Given | Then |
|---|---|---|
| L1 | `restoreLayout(freshRoot, state, factory)` where `state.windows` is `[{ kind: 'window', panelId: 'b', header: 'Float', rect: { x: 10, y: 10, width: 300, height: 200 }, state: 'normal', restoreRect: null }]` and the factory knows `b` | the open window whose `getTitle()` is `'Float'` has `isAutoFocus()` `false` |

### Real layers (jsdom)

In the new `AbstractWindow.focusLayers.test.ts`, under the recipe of [`FocusHistoryLayers.test.ts`](../packages/lib/tests/core/FocusHistoryLayers.test.ts#L1): the `// @vitest-environment jsdom` pragma, a `Container` with three `Button`s appended to the body. `flush()` awaits two animation frames and a zero timeout. jsdom has no canvas, and a window's header glyphs measure their font through one, so `beforeEach` stubs `HTMLCanvasElement.prototype.getContext` to return `{ font: '', measureText: () => ({ width: 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 3 }) }`.

| # | Given | Then |
|---|---|---|
| J1 | focus on button `A`; `new Window('W').show()` | `document.activeElement` is `A` right after the call, and the window's element after `flush()` |
| J2 | `FocusHistory.enable()`; focus on `A`; show a window; `flush()`; `win.requestClose()`; wait for the close animation | `document.activeElement` is `A`; `FocusHistory.canGoBack()` is `false`; `FocusHistory.back()` returns `false` |
| J3 | a `Dialog` (built with `buttons: [{ text: 'OK', result: 'confirm' }]`) is open and has focus; a window is shown; `flush()` | the window's element has the `inert` attribute; `document.activeElement` is still inside the dialog |
| J4 | a context `Menu` opened from the keyboard on `B`, with one row whose `action` shows a window; `Enter` on the row; `flush()`; then `win.requestClose()` and wait | after the flush `document.activeElement` is the window's element; after the close it is `B` |

### Existing tests whose expected value changes

None is expected to change. This was checked by running the 235 test files that name a window, a dock, a rail, a tab strip, a layer manager or a focus service against a stand-in for this plan, and all passed.[^no-test-change] Two things to know when a case does fail:

- Offline, `show()` used to call `DOM.sink.focus` once, synchronously, because the modelled DOM focuses an element that is not in the document. After this plan the call happens only when queued layout callbacks run. A case that counts `focus` calls across a `show()` would see one fewer.
- `tests/overlay/AbstractWindow.locked.test.ts` ([:254](../packages/lib/tests/overlay/AbstractWindow.locked.test.ts#L254)) and `tests/overlay/Window.headerMoveTrigger.test.ts` ([:110](../packages/lib/tests/overlay/Window.headerMoveTrigger.test.ts#L110)) assert that `restore()` calls `win.focus(true)`. They hold: `takeFocus()` calls `this.focus(true)`.

### Needs manual verification

A browser refuses to focus an inert element and an element that is not in the document; neither jsdom nor the modelled DOM does. Screen readers, Firefox and WebKit are manual. Run MV1–MV8 in Chromium on the demo's `#/misc` page (`npx vite --port 8091 --strictPort` from `packages/lib`), with real key presses.

| # | Do | Expect |
|---|---|---|
| MV1 | `Tab` to "Show window with title glyph", press `Enter` | the window has the focus ring or, without one, `document.activeElement` is the window's element; `Tab` moves to a control inside it |
| MV2 | In that window, `Tab` to its close button and press `Enter` | focus is back on "Show window with title glyph" |
| MV3 | "Show window without focus" with `Enter` | focus stays on the button; typing in the page's own field still works; clicking the window's field focuses it |
| MV4 | "Open child window" inside the parent window | the child takes focus; closing it returns focus to the "Open child window" button |
| MV5 | "Show diagnostics overlay" with `Enter`; `Alt+[` to return to the button without a click; `Enter` again | the second press puts focus in the overlay, which was already open and already the active window |
| MV6 | "Dialog — form (focus stays inside)", and from the console show a window while it is open | focus stays in the dialog; after the dialog closes focus is on the dialog's opener, not in the window |
| MV7 | Tear a tab off a `Dock` or `TabPanel` strip | the new window has focus |
| MV8 | The layout-serialization demo page, "window" layout button | the restored float does not take focus; focus stays on the button |
| MV9 | NVDA with Firefox and Chrome, VoiceOver with Safari: repeat MV1 | the window's title and "dialog" are announced as it opens. Record whether NVDA also reads the whole window content |
| MV10 | A `TabWindow` with two tabs, shown from a button | the active tab's label and "dialog" are announced |
| MV11 | Firefox and a WebKit browser: MV1, MV2, MV6 | the same results as Chromium |
| MV12 | SQLAdmin with the library symlinked: open *Local Storage* from the application menu with the keyboard; close it | the window takes focus while its content is still loading; closing returns focus to the menu's opener; nothing else in the application behaves differently |

---

## Verification

Where the cases go: O in `tests/overlay/AbstractWindow.focus.test.ts` plus the registry row; T, F, R and C in the same new file; L in `tests/component/layout/LayoutSerialization.test.ts`; J in the new `tests/overlay/AbstractWindow.focusLayers.test.ts`.

Setup for `AbstractWindow.focus.test.ts`:

- `installTestDOM(CONFIG)` with the `CONFIG` object of [`AbstractWindow.activate.test.ts:11`](../packages/lib/tests/overlay/AbstractWindow.activate.test.ts#L11).
- Copy `collectLayoutCallbacks`, `reduceMotion` and `focusedOpener` from `Drawer.test.ts`, and its `afterEach` (`Tooltip._stopPointerWatch()`, `vi.restoreAllMocks()`, `DOM.reset()`).
- Import `Window` from `~/overlay/Window` and `_TabWindow as TabWindow` from `~/overlay/TabWindow`.
- Dispose every window a case leaves shown. `LayerManager` is a module singleton, and a window left registered is written through a released handle by the next case.
- A "child element of `winEl`" is `DOM.sink.createElement('button')` appended to `winEl` and focused with `DOM.sink.focus`.
- An element focus is to return to must read as connected. `focusedOpener()` marks its button with `setConnected(openerEl, true)`; do the same for `other` in C2 and C7, and for window `a`'s element in F8 if the modelled DOM does not report a mounted window as connected.
- Case L1: no existing case of `LayoutSerialization.test.ts` restores a window node. Build the state on the shape of case S2 ([:218](../packages/lib/tests/component/layout/LayoutSerialization.test.ts#L218)), find the window in `AbstractWindow.getOpenWindows()`, and dispose it at the end of the case.

Commands, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. `cd packages/lib && npx vitest run tests/overlay/AbstractWindow.focus.test.ts tests/overlay/AbstractWindow.focusLayers.test.ts` and the files of step 1.
4. `npm test` — the whole suite.
5. `npm run lint`
6. `npm run docs:api`, then `npm run docs:llms:check`
7. The MV cases, or a note in the implementation notes listing which were not run.

Grep checks:

- `grep -rn "focusSelf" packages/lib/src packages/lib/docs` — no match.
- `grep -n "this.focus(true)" packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — one match, inside `takeFocus`.
- `grep -rn "autoFocus" packages/lib/src/typescript/lib` — matches in `overlay/AbstractWindow.ts` and `layout/LayoutSerialization.ts` only.

---

## Documentation Impact

No class is added, so `llms.txt` needs no entry.

- **[`docs/components/Window.md`](../packages/lib/docs/components/Window.md)**
  - Options table ([:35](../packages/lib/docs/components/Window.md#L35)): add a row `autoFocus` | `boolean` | "Take keyboard focus when code shows or raises the window. Default `true`. Pass `false` for a window opened in the background."
  - `## Common methods` ([:57](../packages/lib/docs/components/Window.md#L57)): the `show()` row becomes "Display the window, bring it to the front and move focus into it."
  - New `## Focus` section before `## Screen readers` ([:126](../packages/lib/docs/components/Window.md#L126)): the table of `### autoFocus — an option at construction, default true`; that the window's own element takes focus and `Tab` then enters its content; that focus arrives after the window's first layout, so a field the application focuses right after `show()` keeps focus; the table of `### Focus returns to where it came from when the window closes`; that a window which does not take focus is not announced.
  - `## Screen readers`: add that a window is announced as it opens, because it takes focus.
  - `## Gotchas` ([:141](../packages/lib/docs/components/Window.md#L141)): reword "A window is non-modal and does not hold focus" to "A window is non-modal and does not trap focus", and add that a window shown while a modal layer is open does not take focus when the modal closes.
- **[`docs/components/TabWindow.md`](../packages/lib/docs/components/TabWindow.md)**: the `show()` row ([:64](../packages/lib/docs/components/TabWindow.md#L64)) as in `Window.md`, with a link to `Window` › Focus.
- **[`docs/components/AbstractWindow.md`](../packages/lib/docs/components/AbstractWindow.md)**, the **Active focus** row ([:16](../packages/lib/docs/components/AbstractWindow.md#L16)): the base moves focus into the window when code shows or raises it (`autoFocus`), when a press activates it and on `restore()`, and returns focus on close.
- **[`docs/components/Dock.md`](../packages/lib/docs/components/Dock.md)** and **[`docs/layouts/LayoutSerialization.md`](../packages/lib/docs/layouts/LayoutSerialization.md)**: one sentence each — a float rebuilt by a layout restore does not take focus; a torn-off float does.
- **[`docs/concepts/accessibility.md`](../packages/lib/docs/concepts/accessibility.md)**, `## Dialogs and windows` ([:318](../packages/lib/docs/concepts/accessibility.md#L318)): after the naming table, one paragraph. A `Dialog` and a modal `Drawer` move focus to a control inside them; a `Window` and a `TabWindow` take focus themselves when shown; a non-modal `Drawer` and a `Popover` move no focus. Link to `Window` › Focus. Do not edit `## Spatial focus navigation`: `spatial-navigation-redesign` rewrites it.
- **[`docs/recipes/focus-history.md`](../packages/lib/docs/recipes/focus-history.md)**: where the page lists what is a stop, add that a window records itself as a stop when it takes focus, and that closing it returns focus to the stop before.
- **[`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)**
  - `## Breaking changes` → `### Overlay`: **A `Window` and a `TabWindow` take keyboard focus when shown.** `show()` moves focus to the window once it has laid out, `bringToFront()` moves it at once, and closing the window returns focus to where it came from. Pass `autoFocus: false` to keep a window out of the way. Link to the migration note.
  - `## Added` → `### Overlay`: `WindowOptions.autoFocus`, `setAutoFocus`, `isAutoFocus`.
  - `## Changed` → `### Layouts`: a floating window rebuilt by `restoreLayout` is built with `autoFocus: false`.
- **[`docs/reference/migration/next.md`](../packages/lib/docs/reference/migration/next.md)**: a new section `## A Window takes focus when it is shown`, in the page's "What changed and why" / "Who needs to act" shape:
  - *What changed and why.* A shown window was announced by a screen reader only when focus happened to enter it. `show()` now moves focus to the window after its first layout; `bringToFront()` moves it at once; closing a window that holds focus returns focus to the element it came from.
  - A table: `win.show()` — before "focus stays on the opener", now "focus moves to the window"; `win.bringToFront()` on the active window — before "focus stays", now "focus moves to the window"; closing a focused window — before "focus on `<body>`", now "focus on the opener".
  - *Who needs to act.* Code that shows a window while the user keeps working elsewhere: a tool palette, a log or status window, a window opened from a timer or a network reply. Build it with `autoFocus: false`. Code that focuses its own field right after `show()` needs no change.

---

## Potential Challenges

- **`_focusOnActivation` must be put back.** `raise` sets it and resets it around one synchronous call. `LayerManager.bringToFront` calls only layer hooks, which do not throw in the library; do not add an early return between the two writes.
- **A plain field initializer is safe here.** None of the three new fields is written during `super()`: `show()`, `bringToFront()` and `onActivate()` are never called from `applyOptions`. `setAutoFocus` writes `_options`, which the base owns.
- **Offline, a focus call on a detached element succeeds.** The modelled DOM does not refuse it. Cases F1 and F3 therefore assert on the `focus` spy before `layout.run()`, not on the active element alone.
- **jsdom does not enforce `inert`.** Case J3 passes only because `takeFocus()` reads `getInertAttribute()`. Do not replace that test with a reliance on the browser.
- **`"activate"` listeners that focus something.** `Dock` forwards a window's `"activate"`. A listener that focuses a control in the window runs before `bringToFront()`'s own `takeFocus()`, which then finds focus inside and moves nothing.
- **`FocusHistory`'s flags between the close and the end of the fade.** Focus returns as the close starts, while the window's element is still in the document for the length of its fade. For that moment the window is still a stop, so `canGoBack()` reads `true`; when the element leaves, the flag changes with no `"change"` event, which is `FocusHistory`'s existing rule for a stop that leaves the document. Case J2 therefore waits for the close animation before it reads the flag.
- **Merging with `feature/spatial-navigation-redesign`.** That branch edits `core/LayerManager.ts`, `core/Component.ts` and the spatial section of `accessibility.md`; this plan edits none of the three. Both append to `changelog/next.md`: keep both blocks. That branch also decides what a spatial-navigation chord (`Ctrl+Alt`+arrow) does when focus is on a window's own element: it lands on the window's first control. That rule is what makes a window that has just taken focus usable with the chords.
- **`feature/nested-scroll-reveal` is not a dependency.** Nothing here uses `FocusReveal` or `LayerManager.isBehindModal`.
- **`docs:api` must finish with zero warnings.** `takeFocus`, `raise` and `restorePreviousFocus` are private: describe them in prose in public JSDoc, never with `{@link}`.

---

## Critical Files

- [`overlay/AbstractWindow.ts`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) — `WindowOptions` (:173), `_defaultWindowOptions` (:213), `_boundOnBringToFront` (:381), constructor (:406), `applyOptions` (:517), `show` (:792), `bringToFront` (:923), `onActivate` (:963), `focusSelf` (:981), `onExitAction` (:1063), `destructor` (:1158), `restore` (:1530), `setConstrainToViewport` (:2195).
- [`overlay/Drawer.ts`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L185) — the precedent: `_previousFocus` (:185), `_focusInsideLayout` (:192), the queued focus in `open` (:414), `focusInside` (:475), `restorePreviousFocus` (:517), the restore after `unregister` (:689).
- [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1031) — `open` (:1031), `focusFirst` (:1145), `restorePreviousFocus` (:1520): the same shape on the other modal layer.
- [`core/LayerManager.ts`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L679) — `bringToFront` (:679), `markActive` (:924), `handleOutside` (:977), `containsAcrossLayers` (:507). Read, not edited.
- [`core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts#L8296) — `afterNextLayout` (:8296), `focus` (:6169), `getInertAttribute` (:5848). Read, not edited.
- [`layout/LayoutSerialization.ts`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L652) — `applyWindow`.
- [`layout/Tab.ts`](../packages/lib/src/typescript/lib/layout/Tab.ts#L2503) — `detachTabToWindow`: `show()` then `bringToFront()`. Read, not edited.
- [`overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L432) — a row returns focus to the menu's invoker before it runs its action. Read, not edited.
- [`tests/overlay/Drawer.test.ts`](../packages/lib/tests/overlay/Drawer.test.ts#L119) and [`tests/core/FocusHistoryLayers.test.ts`](../packages/lib/tests/core/FocusHistoryLayers.test.ts) — the two test recipes.
- [`plans/implemented/dialog-aria-semantics.md`](implemented/dialog-aria-semantics.md) — "Left as they are", the item this plan takes on.

---

## Non-Goals

- **An `initialFocus` option on a window.** An application focuses its own field after `show()`; the window then leaves focus where it is.[^target]
- **A live-region announcer.** See `### A window that does not take focus is not announced`.[^announce]
- **Detecting whether `show()` was called from a user gesture.**[^options]
- **Focus when a window is minimized.** A window minimized with focus inside leaves focus where the browser puts it, as today.
- **Returning focus when a non-modal `Drawer`, a `Popover` or a `PopupPanel` closes.** Still a defect of those components, recorded by `focus-history-transient-layers`. Each is its own change.
- **Moving focus into a non-modal `Drawer` or a `Popover` when it opens.** The opener keeps focus there by design of those surfaces.
- **A keyboard command to move between open windows and the page** (the desktop `F6`). The spatial chords and `Tab` are the routes that exist.
- **Changing `LayerManager`'s notion of the active layer.** A window built with `autoFocus: false` is still drawn as the active window when shown, as every window is today.
- **Keeping keys from acting on a window while it fades out.** Focus leaves a closing window at once when it has somewhere to return to; otherwise it stays until the element is removed, as today.
- **SQLAdmin changes.** None are needed.[^sqladmin]

---

## Addendum: What each layer does with focus today

Read from the source at `59a5c2e27` and measured under jsdom against the real DOM seam with a throwaway test.[^measured] "By code", "by a click" and "by a key" are one row each time, because no layer's `show()` or `open()` can tell them apart; what differs is what holds focus when the call runs, given in the second table.

| Layer | Focus when it is shown | Focus when it closes |
|---|---|---|
| `Dialog` (always modal) | after its first layout: `initialFocus`, else the first control of the content, else the primary button, else any control, else the dialog itself | back to the element focused when it opened, if still on the page |
| `Drawer`, `modal: true` | after its first layout: its first control, else the drawer itself | back to the element focused when it opened |
| `Drawer`, non-modal | stays where it was | no move; `<body>` if focus was inside |
| `Popover`, `PopupPanel` | stays on the opener | no move; `<body>` if focus was inside |
| `Window`, `TabWindow` | stays where it was: the focus call runs before the element is in the document | no move; `<body>` if focus was inside |
| a `Dock`'s floating panel | it is a `Window` or `TabWindow`. A tear-off calls `show()` and then `bringToFront()`; a layout restore calls `show()` only | as a window |

| A shown window, then… | Today |
|---|---|
| `bringToFront()`, another window was active | focus moves to the window's element |
| `bringToFront()`, this window was already active | focus stays |
| a pointer press inside, another window was active | the library focuses the window's element; the browser then focuses what was pressed |
| a pointer press inside, already active | the browser alone focuses what was pressed |
| `restore()` from minimized | focus moves to the window's element |
| shown while a `Dialog` is open | the window is inert; focus stays in the dialog |

| The window is opened from | What holds focus when `show()` runs |
|---|---|
| a `Button`, by click, `Enter` or `Space` | the button |
| a `Menu` row in a keyboard session | the menu's invoker: the row returns focus first, then runs its action |
| a `Menu` row, menu opened with the mouse | whatever had focus before the menu opened |
| a timer, a network reply, a layout restore | whatever the user is working in |

What the platform and common practice say:

| Source | Says |
|---|---|
| WAI-ARIA 1.2, `dialog` role | "Authors SHOULD focus an element in the modal dialog when it is displayed". For a non-modal dialog it asks only for a focusable descendant. |
| ARIA Authoring Practices, dialog pattern | Focus moves into a dialog when it opens, generally to the first focusable element; for a dialog with much content, to a static element at its top, such as the title, given `tabindex="-1"`. Focus returns to the invoker on close. The pattern covers modal dialogs. |
| HTML `<dialog>`, `show()` (non-modal) | Remembers the focused element, then focuses the dialog itself when it has `autofocus`, else its first focus delegate, else the dialog itself. On close, focus returns to the remembered element when focus is inside the dialog. |
| Desktop toolkits | A window opened by the user becomes the focused window. A window can be created not to take focus (Java Swing's `Window.setAutoRequestFocus(false)`, which covers both showing and `toFront()`; a non-activating panel on macOS and Windows). Window managers also withhold focus from a window that appears with no recent user input. |

---

## Notes

[^options]: Four ways to decide whether a shown window takes focus were weighed.
    **Always.** Simple, and what the ARIA pattern asks of a modal dialog. It takes the caret from an editor whenever code opens a window in the background. The library does that itself: `restoreLayout` shows every saved floating window from code.
    **Never** (today). No surprise for code, and a window is never announced when it opens. With `feature/spatial-navigation-redesign` merged the control chord no longer enters a window from the page either, so `Tab` order and the pointer are the only ways in.
    **Only when the opening was a user gesture.** The browser's `navigator.userActivation.isActive` says whether a gesture happened in roughly the last five seconds. That is not "this call came from a gesture": a window opened by a timer shortly after an unrelated click would take focus, and one opened by a slow network reply to a click would not. It also needs a new DOM seam member and is not testable offline. The same call would behave differently from one run to the next.
    **An option at construction — chosen.** It is the project's rule for configuring a component, it is predictable, and the code that opens a window is the code that knows whether the window is a background one. Java Swing, the toolkit this library's model is closest to, has exactly this switch (`setAutoRequestFocus`, default `true`), and HTML's `<dialog>` uses the word `autofocus` for "focus this when it is shown".
    The default is `true` because the accessible behaviour should not depend on every application opting in, and because every other path already focuses a window: activation by a press, `restore()`, and a raise that changes the active window. The demo's own text says a shown window "should appear on top and take focus". The cost is the breaking change of decision 1.
    Consumers checked: the demo shows every window from a button or a tear-off, plus one `restoreLayout` page; the docs application shows no window; SQLAdmin shows one `Window` from a menu action and gets its floats from tear-offs.

[^target]: The window's element is what `onActivate` and `restore()` already focus, so one target serves every path. It is named and has the `dialog` role, so landing on it is what makes a screen reader announce the window. HTML's `<dialog autofocus>` and the ARIA practice of focusing a dialog's title both put focus on the container for content-heavy dialogs.
    The first focusable control was rejected for a non-modal window for three reasons. A window opened while the user is typing would hand the next key press to that control, and a `Space` on a button acts. A window built with `contentFactory` has no content until two frames after `show()` (SQLAdmin's *Local Storage* window is built this way), so the focus move would have to wait for it. And the first control in DOM order is a title-bar button, so "first" would need `Dialog.focusFirst`'s content-first order.
    `feature/spatial-navigation-redesign` already treats focus on a window's own element as "nothing focused yet": the first chord lands on the window's first control. An `initialFocus` option would add API for what `field.focus()` after `show()` already does.

[^deferred]: A synchronous focus call at the end of `show()` would also land, since the element is in the document by then. The deferred form is used for three reasons. It is how the two layers that already take focus on open do it. An application that calls `show()` and then focuses its own field in the same task keeps that field, with no detour through the window that `FocusHistory` would record as a stop. And when two windows are shown in one task, each remembers the right place to return to.
    `raise(false)` replaces `bringToFront()` inside `show()` because the activation's focus call there was always lost in a browser, and offline it succeeded, which made tests disagree with the browser.

[^inert-guard]: A browser refuses to focus an inert element, so the guard changes nothing there. It exists so that `_previousFocus` is not overwritten by a move that never happened, and so that jsdom and the modelled DOM, which do not enforce `inert`, behave as a browser does. `LayerManager.isBehindModal` would answer the same question, but its future is undecided (see the notes of `focus-history-transient-layers`), and the window already holds the answer.
    A window shown while inert does not take focus when the modal closes: the modal returns focus to its own opener, and a second move would fight it.

[^raise]: A window stays `LayerManager`'s active layer when focus leaves it by `Tab` or by `Alt+[`: a focus move to the page deactivates nothing, so that the title bar does not flicker. A second call to `DiagnosticsOverlay.open()`, or `Dock.focusPanel()` on a panel in such a float, then raises a window that is already active, `onActivate` does not fire, and a keyboard user is left on the page. `restore()` met the same gap and made its focus call explicit; this does the same for `bringToFront()`.
    `raise(takeFocus)` followed by the explicit call keeps today's order on the common path: the activation moves focus, then `"activate"` fires.

[^press]: If the `mousedown` listener kept calling `bringToFront()`, a press on a field in an already-active window would first focus the window's element and then the field. `FocusHistory` would record both. Today such a press moves focus once, and it still does.

[^return]: The rule is HTML's for a non-modal `<dialog>`: remember the focused element when the dialog takes focus, and on close return to it only when focus is still inside. A window can stay open for a long time, so the element is refreshed each time the window itself pulls focus in (a raise, a restore, a press that activates it), which keeps it close to "where the user was before coming here".
    Focus is returned as the close starts, not when the fade ends. `ARCHITECTURE.md` asks that a layer return focus after `LayerManager.unregister`; a window unregisters at the start of its close, where a `Dialog` and a `Drawer` unregister at the end. Returning at once also means no key press reaches a window that is fading out.
    Without the return, a window that now takes focus would drop it on `<body>` at every close, which is worse than today, where focus usually never entered the window.

[^restore-layout]: `applyWindow` is the only place in the library that shows a window with no gesture behind it. A restored window is closed and destroyed like any other and `show()` runs once per window, so the option costs it nothing later: a press, a `restore()` and `Dock.focusPanel()`'s raise are the ways it is reached. `Dock.focusPanel()` goes through `bringToFront()`, which `autoFocus: false` also silences; the application calling `focusPanel` then focuses the panel's own control, as SQLAdmin does. If that proves wrong in use, the fix is for the `Dock` to set `autoFocus` back to `true` on a float once the restore has finished.

[^announce]: The library has no announcer: its live regions are the `Notification` toast and the `StatusBar`. `dialog-aria-semantics` recorded that a toast's region is created together with its text, which some screen readers miss, so a reliable announcer needs a region that exists before its text and is its own plan. A window built not to take focus is a background surface by its author's choice; desktop platforms do not announce a non-activating window either.

[^sqladmin]: Read, not run (`/home/jika/typescript/sqladmin/frontend/src`). The application shows one `Window`, *Local Storage* (`shell/localStorageWindow.ts`), from an application-menu action, with `setContentFactory`. It will take focus while its spinner shows, and closing it returns focus to the menu's opener. Floats come from tab tear-offs and take focus, as the library's code comment already intended. The application does not restore floating windows (`data/layoutStore.ts` stores split, accordion and tree state only) and does not enable `FocusHistory`. `dock.focusPanel(id)` is called from thirteen places; for a panel in a float it now also moves focus when that float was already the active window.

[^measured]: The probe, its output and the stand-in used for the test survey are kept at `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/window-focus/` (`zz-window-focus-probe.test.ts`, `probe-out.log`, `zz-probe-setup.ts`). No source file was changed. Measured under jsdom: `Window.show()` and `TabWindow.show()` leave focus on the opener, before and after the layout flush; `bringToFront()` moves focus only when another window was active; closing a focused window leaves focus on `<body>`; a window shown under a `Dialog` carries `inert`; `Dialog` and a modal `Drawer` take focus after the flush and a `Dialog` returns it; a non-modal `Drawer` and a `Popover` move none; with `FocusHistory` enabled a focused window's element is a stop. The pointer rows and the menu rows are from reading `LayerManager.handleOutside` and `Menu.ts:432`. The two standards rows were read from the WAI-ARIA 1.2 text, the ARIA Authoring Practices dialog page and the HTML Standard's `dialog` section on 2026-10-11; the desktop row is from general knowledge and was not re-checked. Not measured: any real browser, Firefox, WebKit, and any screen reader.

[^no-test-change]: The stand-in patched `AbstractWindow.prototype` from a temporary vitest setup file: `show()` raised without focus and queued the focus move, `bringToFront()` focused a shown window, and `onExitAction()` returned focus. Run against the 235 test files matching `Window|Dock|Rail|restoreLayout|FocusHistory|SpatialNavigation|FocusTraversal|LayerManager|DiagnosticsOverlay|StyleAudit|TabBar|TabPanel|tearOff|detach`: 5295 cases passed, none failed. The same stand-in made the jsdom probe report the results of J1–J3. It differs from the plan in three ways: it had no `autoFocus` option, it left the press listener calling `bringToFront()`, and it left `restore()` and `applyWindow` alone. The other 320 test files construct no window and were not run; step 10 runs the whole suite.

---

## Implementation Notes

Not run: the manual cases MV1 to MV12. The run had no browser, screen reader
or SQLAdmin session. J1 to J4 cover the same flows under jsdom, but a real
browser refuses focus on an inert or detached element, and none of the
cross-browser or screen-reader rows were exercised.

Deviations and findings:

- **R2.** The plan's case asserts nothing about which window is active; the
  test first drafted `LayerManager.getActive()`, which does not exist, so the
  assertion was dropped. R2 still asserts one `focus` call and focus on `a`.
- **F2 as written could not fail.** `show()` calls `reflectAccessibleName()`
  before anything is queued, so the label is correct at the flush whether or
  not `takeFocus()` refreshes it. F2 now uses one tab and also asserts the
  plan's "as F1" part (one `focus` call on the window element). The refresh in
  `takeFocus()` is pinned by R8 instead: a raise of the already-active
  `TabWindow`, where `onActivate` does not run, after its title changed.
- **R6 split.** The plan's R6 has two halves with different windows; they are
  now R6 (a default window, press on the active window moves no focus) and R6b
  (an `autoFocus: false` window, press on an inactive window focuses it).
- **Added cases.** X1 and X2 pin `containsAcrossLayers` (focus in a layer
  opened from the window counts as inside, on a raise and on close). R9 pins
  that `raise()` puts `_focusOnActivation` back. T1 asserts focus is on the
  opener before activation.
- **Raises that now move focus.** `DockRegion.raiseHostWindow()`, `Tab`'s
  `_onBarDockHover` and `_onBarDockRequested`, and `StyleAuditOverlay.open`
  call `bringToFront()`, so with `autoFocus` enabled they now also move
  keyboard focus into an already-active window. None was changed; only the
  comments of `DockRegion.raiseHostWindow` and `Tab._onBarDockHover` say so.
  That makes `DockRegion.ts` and `Tab.ts` (comments only) files outside the
  plan's Files table, and the plan's `autoFocus` grep also matches the
  `DockRegion` and `Tab` comments.
- **Minimized windows.** `bringToFront()` on an already-active minimized
  window now focuses it (`Dock.focusPanel` on a minimized float), unlike
  `takeFocusAfterShow`, which skips a minimized window. Out of scope per the
  plan's Non-Goals; noted only.
- **`restoreLayout` closes live windows.** It closes them through
  `onExitAction()`, so focus now returns as each one closes.
- **F7's close half.** Under the plan's `reduceMotion()` the close finishes at
  once and the destructor's cancel supplies the expected call, so deleting the
  cancel in `onExitAction()` still passed. The close half now runs with the
  fade still pending. C3b pins the `isRegistered` guard for a disposed opener.
- **Rename.** `_boundOnBringToFront` is now `_boundOnPressRaise`, since it
  calls `raise(true)`.
- **`preventScroll` on return.** `restorePreviousFocus()` focuses with
  `{ preventScroll: true }`, as the plan's snippet does. `Drawer` and
  `Dialog` `restorePreviousFocus` do not pass it. Behaviour follows the plan;
  the owner may want the three aligned.
- **Test-first.** The registry row and L1 were written after the code; L1 was
  checked to fail with its one `LayoutSerialization` line reverted.
- **Left as is.** `setAutoFocus(false)` between `show()` and the first layout
  does not cancel the queued move. The drag-dwell raises (`DockRegion`, `Tab`)
  now add `FocusHistory` stops; the owner may want pointer raises to skip
  focus later.
- **Close order.** `onExitAction()` now returns focus before it emits
  `"close"`, as `Drawer` does, so a `"close"` listener that moves focus has the
  last word. `AbstractWindow.raise()` restores its flag in `finally`, since an
  `"activate"` listener can throw.
