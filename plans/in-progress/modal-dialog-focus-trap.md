---
depends-on: [context-menu-keyboard-operation]
touches-shared:
  - packages/lib/src/typescript/lib/core/LayerManager.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/overlay/Dialog.ts
  - packages/lib/src/typescript/lib/overlay/Menu.ts
  - packages/lib/tests/overlay/Dialog.test.ts
  - packages/lib/tests/overlay/Menu.keyboardSession.test.ts
  - packages/lib/docs/components/Menu.md
  - packages/lib/docs/concepts/accessibility.md
  - packages/lib/docs/reference/changelog/next.md
  - ARCHITECTURE.md
---

# Modal Layer Focus Containment — Implementation Plan

## Overview

Keyboard focus can leave a modal `Dialog` and reach the page behind it. The report was `Tab` from a context menu opened on the dialog's last control. Measured in Chromium, the hole does not need a menu: a click on the dialog's title followed by `Shift+Tab`, an open `ComboBox` dropdown, a hidden last control, or a dialog with nothing focusable all let the keyboard act on the page behind. A modal `Drawer` does not hold focus at all. The full measurements are in [Addendum: What a modal does today](#addendum-what-a-modal-does-today).

Two terms are used throughout. A *modal layer* is a layer whose `getDismissMode()` returns `"modal"`: every `Dialog`, and a `Drawer` built with `modal: true`. The *scope* of a modal layer is the layer itself plus every layer opened from it, directly or through another layer (a dropdown, a menu, a popover).

This plan makes [`LayerManager`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L224) own modality. While a modal layer is open, everything outside the topmost modal's scope carries the HTML `inert` attribute, so the browser itself refuses focus, clicks and assistive-technology access there. `LayerManager` also wraps `Tab` and `Shift+Tab` at the edges of the scope. `Dialog` loses its own wrap code, a modal `Drawer` gains focus handling, and `Menu`, `FocusHistory` and `FocusTraversal` each get a small change so they agree with the new owner. Non-modal windows, drawers and popovers behave as they do today.

The plan depends on `context-menu-keyboard-operation`: the `Tab` branch of `Menu`'s keyboard session, which this plan edits, exists only on that branch.

---

## Architecture Decisions

### `LayerManager` owns modality

`LayerManager` decides which layer is the *topmost modal* (the last-registered layer whose dismiss mode is `"modal"`) and what its scope is. It recomputes both on every `register` and `unregister`. No surface keeps its own idea of "am I the modal on top".[^lm-owner]

The scope rule reuses the layer tree `LayerManager` already keeps for [`containsAcrossLayers`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L447): a layer opened from another is its child.

| Open layers, in the order they opened | Topmost modal | Scope | Inert |
|---|---|---|---|
| window `W` | none | — | nothing |
| `W`, dialog `D1` opened from `W` | `D1` | `D1` | `<body>`, `W`, the `Rail`, toast dismiss buttons |
| `W`, `D1`, dropdown `P` opened from `D1` | `D1` | `D1`, `P` | `<body>`, `W`, … |
| `W`, `D1`, dialog `D2` opened from `D1` | `D2` | `D2` | `<body>`, `W`, `D1`, … |
| `W`, `D1`, window `W2` shown while `D1` is open | `D1` | `D1` | `<body>`, `W`, `W2`, … |

A window is always a top-level layer, so `W2` is not in `D1`'s scope. It is already drawn under `D1`'s backdrop today.

### Everything outside the scope is `inert`

While a modal layer is open, `LayerManager` sets the `inert` attribute on `<body>`, on every registered layer outside the scope, and on every registered *background surface* (next decision). It removes the attribute when the last modal closes. The browser then blocks focus (by `Tab`, by click and by `element.focus()`), pointer input and the accessibility tree for all of that content, with no library code on the path.[^why-inert]

`<body>` is written through `DOM.sink.apply`, as [`Theme`](../packages/lib/src/typescript/lib/core/Theme.ts#L1428) and [`DragManager`](../packages/lib/src/typescript/lib/overlay/DragManager.ts#L406) already write to it. The modal's own backdrop is not a layer and is never made inert, so `closeOnBackdrop` keeps working.

### A layer mirrors `inert` through a hook and a typed setter

`DismissableLayer` gains an optional hook, `onInertChanged(inert)`. `LayerManager` calls it; the layer applies the value with a new typed setter, `Component.setInertAttribute(value)`. This is the shape of the existing [`onZIndexChanged`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L82) hook: the manager decides, the surface writes its own element. The setter mirrors [`Component.setDisabledAttribute`](../packages/lib/src/typescript/lib/core/Component.ts#L5825): a private backing field, a same-value guard, no options-bag field.[^hook]

All six library layers implement the hook: `Dialog`, `Drawer`, `AnimatedDropdown`, `Menu`, `AbstractWindow`, `Popover`.

### The `Rail` and toasts register as background surfaces

Two library surfaces are mounted outside `<body>` and are not layers: the [`Rail`](../packages/lib/src/typescript/lib/overlay/Rail.ts#L783) and each [`Notification`](../packages/lib/src/typescript/lib/overlay/Notification.ts#L265) toast. Both hold buttons. They register with `LayerManager.addBackgroundSurface(surface)` and get the same `onInertChanged` call. The `Rail` makes its whole element inert. A toast makes only its dismiss button inert, so the toast's text is still announced by a screen reader.[^background]

### `LayerManager.containTab` wraps `Tab` at the edges of the scope

`inert` keeps focus from landing behind the modal, but it does not wrap: `Tab` from the last control would go to the browser's own toolbar. A new function, `LayerManager.containTab(e)`, does the wrap. `LayerManager`'s existing viewport `keydown` listener calls it for every `Tab`.

A *stop* is a visible, enabled, focusable element ([`visibleFocusable`](../packages/lib/src/typescript/lib/core/Focusable.ts#L213)). A *Tab-key owner* is a component that handles `Tab` itself, such as a `CodeEditor` (indent) or a `Table` (next cell); it is marked with `Component.setTabKeyOwner(true)`. Each layer of the scope has its own list of stops. The lists are joined in order — the modal first, then the layers opened from it — into one ring.

Example scope: a dialog with stops `Close`, `Name`, `Type`, and a dropdown opened from `Type` with one stop, `List`. The ring is `Close → Name → Type → List → Close`.

| Focus is on | Key | Result | Consumed |
|---|---|---|---|
| `Name` | `Tab` | the browser moves focus to `Type` | no |
| `Type` (last stop of its layer) | `Tab` | `List` | yes |
| `List` (last stop of the ring) | `Tab` | `Close` | yes |
| `Close` (first stop of its layer) | `Shift+Tab` | `List` | yes |
| `List` | `Shift+Tab` | `Type` | yes |
| a stop inside a Tab-key owner | `Tab` | the editor or table keeps the key | no |
| `<body>`, or an element that is not a stop | `Tab` | the browser moves focus; only the scope can take it | no |
| anything, and the scope has no stop | `Tab` | nothing moves | yes |
| anything, and an earlier listener already handled the key (`e.defaultPrevented`) | `Tab` | nothing | no |

"Consumed" means the function returns `{ stop: true, prevent: true }`. The function acts only at a layer's first or last stop; every other `Tab` stays with the browser.[^contain-tab]

### `Dialog` keeps the `Escape` release and drops its own wrap

[`Dialog.onTab`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1240) keeps one job: when `Escape` has released an embedded editor, the next `Tab` steps past it. The first-stop and last-stop wrap in `onTab` is deleted, because `containTab` now does it for every modal layer. The two rules never apply to the same key press: `containTab` stands down while focus is inside a Tab-key owner, and `Dialog` acts only then.[^dialog-split]

### `Menu`'s `Tab` asks `LayerManager` where focus goes next

In a keyboard session, `Tab` closes the menu and returns focus to the element the menu was opened from. That happens after `LayerManager`'s own listener has run, so the menu's `Tab` branch calls `LayerManager.containTab(e)` itself and returns the result. Outside a modal layer the call returns nothing and the menu behaves as today.[^menu-call]

| Menu opened from | `Tab` on the menu |
|---|---|
| a control on the page, no modal open | menu closes, focus returns, the browser moves on (unchanged) |
| a middle stop of a dialog | menu closes, focus returns, the browser moves to the next stop (unchanged) |
| the dialog's last stop | menu closes, focus goes to the dialog's first stop |
| the dialog's first stop, with `Shift+Tab` | menu closes, focus goes to the dialog's last stop |

### A modal with nothing focusable takes focus itself

When a `Dialog` or a modal `Drawer` holds no stop, its own element is given `tabindex="-1"` and focused. Focus is then inside the modal, `Tab` does nothing, and `Escape` still closes it. This follows [`Menu.focusPanel`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1383).[^self-focus]

### A modal `Drawer` takes focus when it opens and returns it when it closes

A modal `Drawer` records the focused element before it registers, focuses its first stop after its first layout, and returns focus to the recorded element when it has closed. The three steps mirror [`Dialog.open`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L963), [`Dialog.focusFirst`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1072) and [`Dialog.restorePreviousFocus`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1469). A non-modal drawer moves no focus, as today.[^drawer-focus]

### `FocusHistory` and `FocusTraversal` stand down while any modal layer is open

Both services already stand down when a modal layer is *topmost*. They now ask `LayerManager.hasModalLayer()`, which is also true when a menu or dropdown is open above the modal. `FocusHistory.back()` and `forward()` skip, without revealing, any trail entry that lies behind the modal.[^services]

| Open layers | `Alt+[` (focus history) today | After |
|---|---|---|
| dialog | does nothing | does nothing |
| dialog, menu opened inside it | focuses a control of the page behind | does nothing |
| dropdown on the page, no modal | steps back | steps back |

`SpatialNavigation` needs no change.[^spatial]

---

## Public API

```typescript
// core/LayerManager.ts — top level, beside DismissableLayer

/** A portaled surface that is not a layer but must go inert while a modal layer is open. */
export interface BackgroundSurface {
    onInertChanged(inert: boolean): void;
}

export interface DismissableLayer {
    // … existing members …

    /** New, optional. Called with `true` when the layer must go inert behind a modal layer, `false` when it is live again. */
    onInertChanged?(inert: boolean): void;
}

// core/LayerManager.ts — namespace LayerManager

/** New. Whether any registered layer is modal, wherever it sits in the stack. */
export function hasModalLayer(): boolean;

/** New. Whether a modal layer is open and `node` lies outside the topmost modal's scope. `false` for `null`. */
export function isBehindModal(node: Handle | null): boolean;

/** New. Wraps Tab / Shift+Tab at the edges of the topmost modal's scope. Returns a stop-and-prevent disposition when it moved or held focus, nothing otherwise. */
export function containTab(e: KeyboardEvent): Event.ListenerResult;

/** New. Registers a background surface and calls its hook at once with the current state. */
export function addBackgroundSurface(surface: BackgroundSurface): void;

/** New. Removes a background surface. Makes no hook call. */
export function removeBackgroundSurface(surface: BackgroundSurface): void;
```

```typescript
// core/Component.ts — class Component, placed right after setDisabledAttribute

/** New. Cached state of the HTML `inert` attribute. */
getInertAttribute(): boolean;

/** New. Adds or removes the HTML `inert` attribute. Buffered until render, like every element attribute. */
setInertAttribute(value: boolean): this;
```

- Backing field: `private _inertAttribute: boolean = false;`, declared beside [`_disabledAttribute`](../packages/lib/src/typescript/lib/core/Component.ts#L704). A plain initializer is safe: no `applyOptions` dispatches this setter.
- No `ComponentOptions` field. `LayerManager` drives the value; it is framework bookkeeping, not consumer configuration.
- `BackgroundSurface` is added to the type export in [`core/index.ts:48`](../packages/lib/src/typescript/lib/core/index.ts#L48).

Each of `Dialog`, `Drawer`, `AnimatedDropdown`, `Menu`, `AbstractWindow`, `Popover` and `Rail` gains:

```typescript
onInertChanged(inert: boolean): void;   // body: this.setInertAttribute(inert);
```

`Notification` gains the same method with the body `this._closeButton.setInertAttribute(inert);`.

No existing signature changes. `Dialog`'s and `Drawer`'s public surface is otherwise untouched.

---

## Internal Structure

Every new function and method gets a JSDoc block ([CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md)). Snippets follow the project's "assign a call's result, then test it" style.

### `core/LayerManager.ts`

Add `import { visibleFocusable, findTabKeyOwner } from "~/core/Focusable.js";`. `Focusable.ts` already imports `LayerManager`; see `## Potential Challenges` for why the cycle is safe.

Inside the namespace:

```typescript
// Surfaces mounted outside <body> that are not layers (the Rail, toasts).
const _backgroundSurfaces: Set<BackgroundSurface> = new Set();

/** One layer of the topmost modal's scope that holds at least one stop. */
interface ScopeLayer {
    root:  Handle;
    stops: Handle[];
}

function topModalNode(): LayerNode | null {
    for (let i = _stack.length - 1; i >= 0; i--) {
        if (_stack[i].layer.getDismissMode() === "modal") {
            return _stack[i];
        }
    }

    return null;
}

function isInScope(node: LayerNode, modal: LayerNode): boolean {
    return node === modal || isDescendantOf(node, modal);
}

function syncModalScope(): void {
    const modal   = topModalNode();
    const blocked = modal !== null;
    const body    = DOM.source.getBody();
    const marked  = DOM.source.hasAttribute(body, "inert");

    if (blocked && !marked) {
        DOM.sink.apply(body, { setAttr: { inert: "" } });
    } else if (!blocked && marked) {
        DOM.sink.apply(body, { removeAttr: ["inert"] });
    }

    for (const node of _stack) {
        node.layer.onInertChanged?.(modal !== null && !isInScope(node, modal));
    }

    for (const surface of _backgroundSurfaces) {
        surface.onInertChanged(blocked);
    }
}

function scopeLayers(modal: LayerNode): ScopeLayer[] {
    const layers: ScopeLayer[] = [];

    const walk = (node: LayerNode): void => {
        const root  = node.layer.getLayerElement();
        const stops = root === null ? [] : visibleFocusable(root);

        if (root !== null && stops.length > 0) {
            layers.push({ root, stops });
        }

        for (const child of node.children) {
            walk(child);
        }
    };

    walk(modal);

    return layers;
}

export function containTab(e: KeyboardEvent): Event.ListenerResult {
    const modal = topModalNode();

    if (e.defaultPrevented || modal === null) {
        return;
    }

    const layers = scopeLayers(modal);
    const stops  = layers.flatMap(layer => layer.stops);

    if (stops.length === 0) {
        return { stop: true, prevent: true };
    }

    const active = DOM.source.getActiveElement();
    const index  = active === null ? -1 : stops.indexOf(active);

    if (active === null || index === -1) {
        return;
    }

    const own   = layers.find(layer => layer.stops.includes(active))!;
    const owner = findTabKeyOwner(active, own.root);
    const edge  = e.shiftKey ? own.stops[0] : own.stops[own.stops.length - 1];

    if (owner !== null || active !== edge) {
        return;
    }

    const step = e.shiftKey ? -1 : 1;

    DOM.sink.focus(stops[(index + step + stops.length) % stops.length]);

    return { stop: true, prevent: true };
}
```

- `isDescendantOf` ([:619](../packages/lib/src/typescript/lib/core/LayerManager.ts#L619)) and `nodeContains` ([:705](../packages/lib/src/typescript/lib/core/LayerManager.ts#L705)) already exist.
- `findTabKeyOwner(active, own.root)` stops at the layer's own element without testing it. A `Dialog` marks its own element as a Tab-key owner, and that mark must not count.
- `hasModalLayer()` returns `topModalNode() !== null`.
- `isBehindModal(node)` returns `false` when `node` is `null` or no modal is open, and otherwise `!nodeContains(modal, node)`.
- `addBackgroundSurface(surface)` adds to the set, then calls `surface.onInertChanged(topModalNode() !== null)`.
- `removeBackgroundSurface(surface)` deletes from the set and calls nothing.

### `overlay/Dialog.ts`

```typescript
private onTab(e: KeyboardEvent): Event.ListenerResult {
    const owner = this.descendantTabKeyOwner();

    if (owner === null || owner !== this._releaseOwner) {
        return; // LayerManager wraps focus at the dialog's edges; an unreleased owner keeps its Tab.
    }

    return this.stepPastOwner(owner, e.shiftKey);
}
```

The end of `focusFirst()`, replacing the last lookup:

```typescript
const el        = this.getElement();
const focusable = el ? visibleFocusable(el) : [];

if (focusable.length > 0) {
    DOM.sink.focus(focusable[0]);

    return;
}

// Nothing in the dialog can take focus, so the dialog itself does.
// -1: focusable from script, never a Tab stop.
this.getAria().setTabIndex(-1);
this.focus(true);
```

### `overlay/Drawer.ts`

```typescript
private _previousFocus    : Handle | null = null;
private _focusInsideLayout: { cancel(): void } | null = null;

private focusInside(): void {
    this._focusInsideLayout = null;

    const element = this.getElement();
    const stops   = element ? visibleFocusable(element) : [];

    if (stops.length > 0) {
        // preventScroll: the panel is still sliding in from off-screen.
        DOM.sink.focus(stops[0], { preventScroll: true });

        return;
    }

    // -1: focusable from script, never a Tab stop.
    this.getAria().setTabIndex(-1);
    this.focus(true);
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
        DOM.sink.focus(previous);
    }
}
```

---

## Ordered Implementation Steps

Work test-first. For each step, write the named cases from `## Expected Behaviour`, see them fail, then make the change. Run only the test files a step names until step 13.

1. **Baseline.** From `packages/lib`, run `npx vitest run tests/overlay/Dialog.test.ts tests/overlay/LayerManager.test.ts tests/overlay/Drawer.test.ts tests/overlay/Menu.keyboardSession.test.ts tests/core/FocusTraversal.test.ts tests/unit/core/FocusHistory.test.ts tests/overlay/Rail.test.ts tests/overlay/Notification.test.ts`. All must pass before any edit.

2. **`Component.setInertAttribute`.** In [`core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts#L5825), add the field `_inertAttribute` beside `_disabledAttribute` ([:704](../packages/lib/src/typescript/lib/core/Component.ts#L704)) and the two methods right after `setDisabledAttribute`. Copy `setDisabledAttribute`'s body and write `"inert"` in place of `"disabled"`. Check: cases C1–C3 pass.

3. **`LayerManager` — scope and `inert`.** In [`core/LayerManager.ts`](../packages/lib/src/typescript/lib/core/LayerManager.ts): add `BackgroundSurface` and the `onInertChanged?` member of `DismissableLayer` (after `keepsOwnBand`, [:114](../packages/lib/src/typescript/lib/core/LayerManager.ts#L114)); add `_backgroundSurfaces`, `topModalNode`, `isInScope`, `syncModalScope`, `hasModalLayer`, `isBehindModal`, `addBackgroundSurface`, `removeBackgroundSurface`. Call `syncModalScope()` in two places: in [`register`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L356) on the line before `layer.onZIndexChanged?.(zIndex)`, and in [`unregister`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L404) on the line after the `_activeLayer` reset. Do not call the hook of the layer being unregistered: it may already be destroyed. Add `BackgroundSurface` to the type export in `core/index.ts`. Check: cases I1–I9 pass; `tests/overlay/LayerManager.test.ts` still passes.

4. **`LayerManager` — `containTab`.** Add the `Focusable.js` import, `ScopeLayer`, `scopeLayers` and `containTab`. In [`onKeyDown`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L872), add as the first statement `if (e.key === "Tab") { return containTab(e); }`. Update `onKeyDown`'s JSDoc and the namespace comment ([:207–223](../packages/lib/src/typescript/lib/core/LayerManager.ts#L207)) and the `"modal"` line of `LayerDismissMode`'s comment ([:17–19](../packages/lib/src/typescript/lib/core/LayerManager.ts#L17)) to say the manager also makes the rest of the page inert and wraps `Tab`. Check: cases T1–T16 pass.

5. **Layers implement the hook.** Add `onInertChanged(inert: boolean): void { this.setInertAttribute(inert); }` with a JSDoc block:
   - `overlay/Dialog.ts`, after [`keepsOwnBand`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1657).
   - `overlay/Drawer.ts`, after [`onZIndexChanged`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L751).
   - `core/AnimatedDropdown.ts`, after [`onZIndexChanged`](../packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L299).
   - `overlay/Menu.ts`, after [`onZIndexChanged`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1753).
   - `overlay/AbstractWindow.ts`, after [`onZIndexChanged`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1014).
   - `overlay/Popover.ts`, after [`requestClose`](../packages/lib/src/typescript/lib/overlay/Popover.ts#L586).

   Check: `grep -rn "onInertChanged(inert: boolean)" packages/lib/src/typescript/lib | wc -l` prints `7` after this step (the six layers plus `BackgroundSurface`; the optional member of `DismissableLayer` is written `onInertChanged?(` and does not match); case L1 passes.

6. **`Dialog`.** In [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts):
   - Add `visibleFocusable` to the `Focusable.js` import ([:28](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L28)).
   - Replace `onTab` ([:1240–1275](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1240)) with the snippet. Rewrite its JSDoc: the method only steps past a released owner.
   - Replace the body of `getFocusable` ([:1180](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1180)) with `const el = this.getElement(); return el ? visibleFocusable(el) : [];`.
   - In `focusFirst` ([:1072](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1072)), change the `inContent` lookup to `contentEl ? visibleFocusable(contentEl) : []` and replace the last lookup with the snippet.
   - Update the comments that describe the trap: the block in `open()` ([:984–992](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L984)), `onKeyDown`'s JSDoc and inline comment ([:1191–1213](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1191)), and `getDismissMode`'s JSDoc ([:1589–1596](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1589)). Each must say that `LayerManager` contains focus and that the dialog only releases an embedded editor.
   - Leave `this._previousFocus = DOM.source.getActiveElement()` as the first statement of `open()`. It must stay before `LayerManager.register(this)`.
   - Leave `setTabKeyOwner(true)` and the `isTopmostInputLayer` guard as they are.

   Then edit `tests/overlay/Dialog.test.ts` as `## Verification` describes. Check: cases D1–D6 pass; the whole file passes.

7. **`Drawer`.** In [`overlay/Drawer.ts`](../packages/lib/src/typescript/lib/overlay/Drawer.ts): import `visibleFocusable` from `~/core/Focusable.js`; add the two fields and the two methods from the snippet.
   - In [`open()`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L339), right after the `_open` guard and before `LayerManager.register(this)`: `if (this.isModal()) { this._previousFocus = DOM.source.getActiveElement(); }`.
   - In `open()`, right after `this.scheduleLayout()`: `if (this.isModal()) { this._focusInsideLayout = Component.afterNextLayout(() => this.focusInside()); }`.
   - In [`close()`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L381), after `this._closing = true;`: cancel `_focusInsideLayout` and set it to `null`.
   - In `finalize` inside [`animateOutAndFinalize`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L550), after `untrapWheel(this);`: `this.restorePreviousFocus();`. It must come after `LayerManager.unregister(this)`, which is what makes the opener focusable again.
   - In [`destructor()`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L764), before `super.destructor()`: cancel `_focusInsideLayout`, set it and `_previousFocus` to `null`. The destructor restores no focus.

   Check: cases R1–R7 pass.

8. **`Menu`.** In [`overlay/Menu.ts:1599`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1599), change the `Tab` case to call `this.rootMenu().dismissAll();` and then `return LayerManager.containTab(e);`. Update `onPanelKeyDown`'s JSDoc sentence about `Tab`: the key continues, except at the edge of a modal layer, where focus wraps inside it. Check: cases N1–N4 pass; the whole of `Menu.keyboardSession.test.ts` passes.

9. **`FocusHistory`.** In [`core/FocusHistory.ts`](../packages/lib/src/typescript/lib/core/FocusHistory.ts): in `onKeyDown`, replace the `getTopLayer()` test ([:255–259](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L255)) with `const modalOpen = LayerManager.hasModalLayer(); if (modalOpen) { return; }`. In [`revealAndFocus`](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L149), as the first statements inside the `try`: `const behindModal = LayerManager.isBehindModal(handle); if (behindModal) { return false; }`. Update both JSDoc blocks. Check: cases H1–H3 pass.

10. **`FocusTraversal`.** In [`core/FocusTraversal.ts`](../packages/lib/src/typescript/lib/core/FocusTraversal.ts#L124), right after the `_enabled` guard of `onKeyDown`: `const modalOpen = LayerManager.hasModalLayer(); if (modalOpen) { return; }`. Update the namespace JSDoc ([:181–195](../packages/lib/src/typescript/lib/core/FocusTraversal.ts#L181)): the service stands down while any modal layer is open. Leave `next()`, `previous()`, `shouldWrap` and the `ownsTabKey(root)` test unchanged. Check: cases F1–F2 pass; the existing cases of `tests/core/FocusTraversal.test.ts` pass without edits.

11. **Background surfaces.**
    - [`overlay/Rail.ts`](../packages/lib/src/typescript/lib/overlay/Rail.ts): import `LayerManager`. Add `onInertChanged`. In [`mount()`](../packages/lib/src/typescript/lib/overlay/Rail.ts#L783), after `this._mounted = true;`: `LayerManager.addBackgroundSurface(this);`. In [`unmount()`](../packages/lib/src/typescript/lib/overlay/Rail.ts#L828), after `this._mounted = false;`: `LayerManager.removeBackgroundSurface(this);`. In [`destructor()`](../packages/lib/src/typescript/lib/overlay/Rail.ts#L1373), before `super.destructor()`: the same remove call.
    - [`overlay/Notification.ts`](../packages/lib/src/typescript/lib/overlay/Notification.ts): add `onInertChanged`. In [`show()`](../packages/lib/src/typescript/lib/overlay/Notification.ts#L265), after `LayerManager.mount(el);`: `LayerManager.addBackgroundSurface(n);`. In [`destructor()`](../packages/lib/src/typescript/lib/overlay/Notification.ts#L713), before `super.destructor()`: `LayerManager.removeBackgroundSurface(this);`.

    Check: cases B1–B4 pass; `tests/overlay/Rail.test.ts` and every `tests/overlay/Notification*.test.ts` file pass.

12. **Documentation.** Make the edits in `## Documentation Impact`.

13. **Verify.** Run `## Verification` in full.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/LayerManager.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Modify | `packages/lib/src/typescript/lib/core/AnimatedDropdown.ts` |
| Modify | `packages/lib/src/typescript/lib/core/FocusHistory.ts` |
| Modify | `packages/lib/src/typescript/lib/core/FocusTraversal.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Drawer.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Popover.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Rail.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Create | `packages/lib/tests/overlay/LayerManager.modalFocus.test.ts` |
| Create | `packages/lib/tests/core/ComponentInertAttribute.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Modify | `packages/lib/tests/overlay/Drawer.test.ts` |
| Modify | `packages/lib/tests/overlay/Menu.keyboardSession.test.ts` |
| Modify | `packages/lib/tests/unit/core/FocusHistory.test.ts` |
| Modify | `packages/lib/tests/core/FocusTraversal.test.ts` |
| Modify | `packages/lib/tests/overlay/Rail.test.ts` |
| Modify | `packages/lib/tests/overlay/Notification.test.ts` |
| Modify | `packages/lib/docs/components/Dialog.md` |
| Modify | `packages/lib/docs/components/Drawer.md` |
| Modify | `packages/lib/docs/components/Window.md` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/docs/components/Rail.md` |
| Modify | `packages/lib/docs/components/Notification.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/concepts/layering.md` |
| Modify | `packages/lib/docs/recipes/focus-history.md` |
| Modify | `packages/lib/docs/reference/browser-support.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `ARCHITECTURE.md` |

---

## Expected Behaviour

Every case except the MV cases is testable offline in the modelled test DOM. The MV cases need a real browser. In the offline cases a "layer" is a fake `DismissableLayer` as in [`tests/overlay/LayerManager.test.ts:39`](../packages/lib/tests/overlay/LayerManager.test.ts#L39), with `onInertChanged` a `vi.fn()`. "Body is inert" means `DOM.source.hasAttribute(DOM.source.getBody(), "inert")`. Stops are seeded with `setQuerySelectorAllResult(layerEl, FOCUSABLE_SELECTOR, [...])`.

### `Component.setInertAttribute` (offline)

| # | Given | Then |
|---|---|---|
| C1 | a rendered component, `setInertAttribute(true)` | its element has the attribute `inert`; `getInertAttribute()` is `true` |
| C2 | then `setInertAttribute(false)` | the attribute is gone; the getter is `false` |
| C3 | `setInertAttribute(true)` before the first `getElement(true)` | the attribute is present once the element is rendered |

### Scope and `inert` (offline)

`A` is a non-modal root layer, `M`, `M1`, `M2` are modal, `C` is a non-modal layer registered after a modal with no anchor (so the modal is its parent), `W` is a non-modal root layer.

| # | Sequence | Then |
|---|---|---|
| I1 | register `A`, then `M` | body is inert; `A.onInertChanged` last called with `true`; `M.onInertChanged` last called with `false` |
| I2 | register `M`, then `C` | `C.onInertChanged` last called with `false` |
| I3 | I1, then unregister `M` | body is not inert; `A.onInertChanged` last called with `false` |
| I4 | register `M1`, then `M2` | `M1` last `true`, `M2` last `false`. Unregister `M2`: `M1` last `false`, body still inert. Unregister `M1`: body not inert |
| I5 | register `M`, then root `W` | `W.onInertChanged` last called with `true` |
| I6 | register and unregister two non-modal layers | body is never inert; every hook call carries `false` |
| I7 | `addBackgroundSurface(s)` with no modal; register `M`; unregister `M`; `removeBackgroundSurface(s)`; register `M` again | `s` is called with `false`, `true`, `false`, and not called again. A surface added while `M` is registered is called with `true` at once |
| I8 | register `A`, `M`, `C`, each with an element and one child element | `isBehindModal` is `false` for the child of `M` and of `C`, `true` for the child of `A`, `false` for `null`. `hasModalLayer()` is `true`. With nothing modal registered both answer `false` |
| I9 | register a modal layer and a non-modal layer that omit `onInertChanged` | no throw; body is inert |

### `containTab` (offline)

`M` holds stops `a`, `b`, `c` unless stated. "Consumed" means the return value is `{ stop: true, prevent: true }`; "nothing" means `undefined` and the active element is unchanged.

| # | Given | Key | Then |
|---|---|---|---|
| T1 | no modal registered, focus on any element | `Tab` | nothing |
| T2 | focus on `c` | `Tab` | focus on `a`; consumed |
| T3 | focus on `a` | `Shift+Tab` | focus on `c`; consumed |
| T4 | focus on `b` | `Tab`, and `Shift+Tab` | nothing |
| T5 | `M` has no stops | `Tab`, and `Shift+Tab` | consumed; the active element is unchanged |
| T6 | focus on the body handle; and focus on an element outside `M` | `Tab` | nothing |
| T7 | stops `a`, `b`, `h` with `setRenderedVisible(h, false)`; focus on `b` | `Tab` | focus on `a`; consumed |
| T8 | stop `c` carries the attribute `disabled`; focus on `b` | `Tab` | focus on `a`; consumed |
| T9 | `M` holds `a`, `b`; child layer `C` holds `x`, `y` | `Tab` on `b`; `Tab` on `y`; `Shift+Tab` on `a`; `Shift+Tab` on `x`; `Tab` on `x` | focus on `x`; on `a`; on `y`; on `b` — each consumed; the last one: nothing |
| T10 | `M` holds `a`, `b`; child layer `C` holds no stop | `Tab` on `b` | focus on `a`; consumed |
| T11 | `M`'s element is marked a Tab-key owner; a marked descendant `owner` contains the stop `inner`. First with `inner` seeded last, then with a plain stop seeded last | `Tab` on `inner`; `Tab` on the plain last stop | nothing; focus on the first stop, consumed (the modal's own mark does not count) |
| T12 | focus on `c`; the event has `defaultPrevented: true` | `Tab` | nothing |
| T13 | `M` holds one stop `a`; focus on `a` | `Tab` | focus stays on `a`; consumed |
| T14 | `M1` holds `a`, `b`; `M2`, registered after it, holds `p`, `q` | `Tab` on `q` | focus on `p`; consumed |
| T15 | focus on `c`; a `keydown` event with `key: "Tab"` dispatched at the window | — | focus on `a` (the manager's own listener calls `containTab`) |
| T16 | focus on `M`'s own element, which is not a stop | `Tab` | nothing |

### Layers (offline)

| # | Given | Then |
|---|---|---|
| L1 | for each of a `Dialog`, a `Drawer`, a `Menu`, a `Window`, a `Popover` and a `PopupPanel`: `onInertChanged(true)`, then `onInertChanged(false)` | `getInertAttribute()` is `true`, then `false` |

### `Dialog` (offline)

| # | Given | Then |
|---|---|---|
| D1 | a registered dialog with plain stops, focus on the last; `onKeyDown` with `Tab` | returns nothing and moves no focus. `LayerManager.containTab` with the same event wraps to the first stop |
| D2 | focus inside a marked owner that Escape has not released; `Tab` | `onKeyDown` and `containTab` both return nothing |
| D3 | the owner released by `requestClose()`; `Tab` | `onKeyDown` focuses the stop after the owner and consumes; `containTab`, called first with the same event, returns nothing |
| D4 | stops `[plainA, inner, hidden]` with `hidden` not rendered visible; owner released; `Tab` | focus on `plainA`, not on `hidden` |
| D5 | a dialog with no seeded stop, shown, and the queued `afterNextLayout` callback run | the dialog's own element is the active element; `getAria().getTabIndex()` is `-1` |
| D6 | a dialog shown, then disposed | body is inert after `show()`, not inert after `dispose()` |

### `Drawer` (offline)

"Opener" is a connected, focused `Button`, as in [`Dialog.test.ts:1254`](../packages/lib/tests/overlay/Dialog.test.ts#L1254).

| # | Given | Then |
|---|---|---|
| R1 | a modal drawer with seeded stops `x`, `y`; `open()`; the queued layout callback run | `DOM.sink.focus` was called with `x` and `{ preventScroll: true }`; body is inert |
| R2 | a modal drawer with no stop; `open()`; callback run | the drawer's element is the active element; tab index is `-1` |
| R3 | R1, then `close()` run to completion | the opener is the active element; body is not inert |
| R4 | R1; the opener disposed; `close()`. And: the opener disconnected with `setConnected(el, false)`; `close()` | no throw; `DOM.sink.focus` is not called with the opener |
| R5 | a non-modal drawer; `open()`; every queued layout callback run; `close()` | `DOM.sink.focus` is never called; the drawer's tab index stays `null`; body is never inert |
| R6 | a modal drawer; `open()`; `close()` before the callback runs | the callback's `cancel` was called |
| R7 | a modal drawer; `open()`; `dispose()` | no throw; body is not inert |

### `Menu` (offline)

A modal fake layer `M` is registered with stops `first`, `middle`, `last`. The menu is opened from the keyboard, as `showFromKeyboard` does in `Menu.keyboardSession.test.ts`.

| # | Menu opened from | Key on the menu | Then |
|---|---|---|---|
| N1 | `last` | `Tab` | the menu is not the top layer; focus on `first`; the listener consumed the key |
| N2 | `first` | `Shift+Tab` | focus on `last`; consumed |
| N3 | `middle` | `Tab` | focus on `middle`; the listener returned nothing |
| N4 | the opener, with no modal registered | `Tab` | case `K7` unchanged |

### `FocusHistory` and `FocusTraversal` (offline)

| # | Given | Then |
|---|---|---|
| H1 | history enabled, two recorded elements; a modal layer and then a non-modal layer registered; the back chord | `preventDefault` is not called; focus is unchanged |
| H2 | trail `[behind, inside]` where `inside` lies in a registered modal layer's element and `behind` does not; `FocusHistory.back()` | returns `false`; `FocusReveal.reveal` is not called with `behind` |
| H3 | the existing case "suppresses back/forward while the top layer is modal" | passes unchanged |
| F1 | traversal enabled; a modal layer whose element is **not** marked a Tab-key owner, stops `a`, `b`, `c`, focus on `a`; a `Tab` keydown dispatched at the window | focus is on `a` (neither service moved it: `a` is not an edge for `Tab`); `preventDefault` is not called |
| F2 | the same, focus on `c` | focus on `a`, moved once, by `LayerManager` |

### Background surfaces (offline)

| # | Given | Then |
|---|---|---|
| B1 | a mounted `Rail`; a modal layer registered, then unregistered | `rail.getInertAttribute()` is `true`, then `false` |
| B2 | a `Rail` unmounted; a modal layer registered | `rail.getInertAttribute()` stays `false` |
| B3 | a toast shown; a modal layer registered | the toast's close button has `getInertAttribute() === true`; the toast itself has `false` |
| B4 | a toast shown while a modal layer is registered | its close button is inert at once; after the toast is disposed, unregistering the modal does not throw |

### Unchanged (offline)

`tests/overlay/LayerManager.test.ts`, `tests/overlay/ModalLayerBand.test.ts`, `tests/core/FocusTraversal.test.ts` (apart from the two added cases), `tests/core/Focusable.test.ts`, `tests/overlay/AnimatedDropdown.test.ts` and `tests/overlay/Popover.test.ts` pass without edits to their existing cases.

### Needs manual verification

Real key presses in Chromium on the demo app (`npm run dev`, `#/misc`). Repeat MV1–MV8, MV11 and MV17 in Firefox and in WebKit; the planner ran neither.[^prototype]

| # | Setup | Do | Expect |
|---|---|---|---|
| MV1 | "Dialog — confirm/cancel" | `Tab` ×4, `Shift+Tab` ×4 | focus cycles `Cancel → Confirm → ✕ → Cancel` and back; never leaves the dialog |
| MV2 | a dialog whose last control is a `TextField` (`buttons: []`) | Shift+F10 on the field, `Tab` | the menu closes and focus is on the dialog's first control. This is the reported case |
| MV3 | MV1 | click the dialog's title text, then `Shift+Tab` several times | focus never lands on a control of the page. It goes to the browser's own toolbar or straight to the dialog's last control, and comes back into the dialog |
| MV4 | a dialog whose last control is a `ComboBox` | open the dropdown, `Tab`, `Tab` | focus goes to the dropdown list, then to the dialog's first control. The dropdown may stay open; an outside click closes it |
| MV5 | a dialog whose last control in the body is hidden with `setDisplayed(false)` | `Tab` from the last visible control; `Shift+Tab` from the first | wraps in both directions |
| MV6 | `new Dialog({ title, message, buttons: [], dismissable: false }).show()` from a focused button | `Space`, `Enter`, `Tab` | the opener is not activated; nothing moves. DevTools' accessibility tree lists only the dialog |
| MV7 | a dialog with a button that opens `Dialog.confirm` | `Tab` in the inner dialog; confirm it | focus cycles inside the inner dialog; after it closes focus is on the button in the outer dialog, which cycles again |
| MV8 | any dialog opened from a focused button | close it | focus is on the button. With the button disposed meanwhile, focus stays on the page and nothing throws |
| MV9 | `FocusHistory` is on in the demo | `Alt+[` inside a dialog; then Shift+F10 on a field and `Alt+[` | focus does not move either time |
| MV10 | `FocusTraversal.enable()` from the console | MV1 and MV2 | each `Tab` moves focus exactly one stop |
| MV11 | a modal `Drawer` with two buttons, opened from a focused button | `Tab` ×3, `Shift+Tab`, `Escape` | focus is on the drawer's first button when it opens; cycles inside; after `Escape` it is back on the opener |
| MV12 | a non-modal `Window`; a non-modal `Drawer` | `Tab` from the last control | focus leaves to the page as today; the page stays clickable |
| MV13 | a toast on screen, then a dialog | `Tab` through the dialog several times | the toast's ✕ never takes focus; after the dialog closes, the ✕ can be reached again |
| MV14 | a dialog hosting a `CodeEditor` | `Tab`; then `Escape`, `Tab` | the editor indents; after `Escape` the `Tab` moves to the next control. Unchanged |
| MV15 | a dialog with `closeOnBackdrop: true` | click the backdrop; and scroll the wheel over the backdrop | the dialog closes; the page does not scroll |
| MV16 | a dialog open; from the console, `setTimeout` that shows a `Window` | wait | focus stays in the dialog; the window is behind the backdrop |
| MV17 | MV1 | focus the address bar (`Ctrl+L`), then `Tab` until focus is back in the page | the first page element to take focus is inside the dialog |
| MV18 | if a password-manager extension is installed: a dialog with a password field | use the extension's inline menu | record whether it can be clicked (see `## Potential Challenges`) |
| MV19 | SQLAdmin with the library symlinked | the login dialog: tab through it, open the preset `ComboBox`, "Save preset" (a nested prompt), a failed sign-in (error dialog, then the login dialog again); a `Dialog.confirm` raised from a window; the SQL preview dialog | each dialog holds focus; focus returns where it was; nothing in the app behind reacts |
| MV20 | optional, a screen reader | open a dialog while a toast appears | the toast is announced; the page behind is not readable |

---

## Verification

Where the cases go: I, T and L in the new `tests/overlay/LayerManager.modalFocus.test.ts`; C in the new `tests/core/ComponentInertAttribute.test.ts`; D in `Dialog.test.ts`; R in `Drawer.test.ts`; N in `Menu.keyboardSession.test.ts`; H in `tests/unit/core/FocusHistory.test.ts`; F in `tests/core/FocusTraversal.test.ts`; B1–B2 in `Rail.test.ts`; B3–B4 in `Notification.test.ts`.

Setup for `LayerManager.modalFocus.test.ts`:

- Node environment and `installTestDOM`, as in [`tests/overlay/LayerManager.test.ts:1–60`](../packages/lib/tests/overlay/LayerManager.test.ts#L1). Copy its `fakeLayer` helper and its draining `afterEach`, and give the fake an `onInertChanged: vi.fn()`.
- A layer's element and its stops: `DOM.sink.createElement("div")`, `DOM.sink.appendChild`, `setQuerySelectorAllResult(layerEl, FOCUSABLE_SELECTOR, stops)`, `setRenderedVisible`, as [`Dialog.test.ts:413–473`](../packages/lib/tests/overlay/Dialog.test.ts#L413) does.
- Key events: the `keyDownEvent(key, shiftKey)` helper of [`Dialog.test.ts:92`](../packages/lib/tests/overlay/Dialog.test.ts#L92). For T12 add `defaultPrevented: true` to the object. For T15 use `makeEvent` and `DOM.sink.dispatchEvent(DOM.source.getWindow(), event)`, as [`FocusTraversal.test.ts:73`](../packages/lib/tests/core/FocusTraversal.test.ts#L73) does.
- Every test unregisters every layer it registered and removes every background surface it added. `LayerManager` is a module singleton.

Edits to `tests/overlay/Dialog.test.ts`:

- "consumes a trapped Tab" ([:384](../packages/lib/tests/overlay/Dialog.test.ts#L384)), "still wraps to the first stop…" ([:536](../packages/lib/tests/overlay/Dialog.test.ts#L536)), "still wraps to the last stop…" ([:555](../packages/lib/tests/overlay/Dialog.test.ts#L555)) and "still consumes Tab in a dialog with no focusable elements" ([:617](../packages/lib/tests/overlay/Dialog.test.ts#L617)): replace `dialog.keyDown(event)` with `applyDisposition(event, LayerManager.containTab(event))`. The expectations stay. Add to each wrap case an assertion that `dialog.keyDown` with a fresh event is not consumed (case D1).
- "wraps as before for a marked owner that is not a descendant of the dialog" ([:592](../packages/lib/tests/overlay/Dialog.test.ts#L592)): delete it. Focus cannot be outside the dialog any more, and T6 pins what `containTab` does if it is.
- The stand-down cases ([:480–535](../packages/lib/tests/overlay/Dialog.test.ts#L480), [:574](../packages/lib/tests/overlay/Dialog.test.ts#L574)) keep their `dialog.keyDown` assertion and gain the same assertion through `LayerManager.containTab` (case D2).
- "Dialog — Escape releases a Tab-key owner" ([:645](../packages/lib/tests/overlay/Dialog.test.ts#L645)) and "keydown scoped to the topmost layer" ([:930](../packages/lib/tests/overlay/Dialog.test.ts#L930)) must pass unchanged. Add D3 and D4 to the first.

`Drawer` cases: mock `Component.afterNextLayout` to collect callbacks, as [`Dialog.test.ts:1101`](../packages/lib/tests/overlay/Dialog.test.ts#L1101) does. Run `close()` to completion the way [`Dialog.test.ts:1213`](../packages/lib/tests/overlay/Dialog.test.ts#L1213) completes a `hide()` (reduced motion makes the completion synchronous).

Commands, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. `cd packages/lib && npx vitest run tests/overlay/LayerManager.modalFocus.test.ts tests/core/ComponentInertAttribute.test.ts tests/overlay/LayerManager.test.ts tests/overlay/ModalLayerBand.test.ts tests/overlay/Dialog.test.ts tests/overlay/DialogCappedScroll.test.ts tests/overlay/DialogSeverity.test.ts tests/overlay/DialogViewportResize.test.ts tests/overlay/DialogWrappingRefit.test.ts tests/overlay/Drawer.test.ts tests/overlay/Menu.keyboardSession.test.ts tests/overlay/Menu.test.ts tests/overlay/Rail.test.ts tests/overlay/Notification.test.ts tests/overlay/Notification.dismissTimer.test.ts tests/overlay/NotificationHistory.test.ts tests/overlay/AnimatedDropdown.test.ts tests/overlay/Popover.test.ts tests/overlay/PopupPanel.test.ts tests/core/FocusTraversal.test.ts tests/core/Focusable.test.ts tests/unit/core/FocusHistory.test.ts tests/component/dispose-full-teardown.test.ts tests/unit/import-without-dom.test.ts`
4. `npm test` — the whole suite. A failure in a suite not listed above is most likely a modal layer or a mounted `Rail` left registered across a `DOM.reset()`; fix it by disposing it in that suite's teardown.
5. `npm run lint`
6. `npm run docs:api`, `npm run docs:llms:check`
7. The MV cases.

Grep checks:

- `grep -rn "containTab(e)" packages/lib/src/typescript/lib` — exactly two call sites: `LayerManager`'s `onKeyDown` and the `Tab` case in `Menu.ts`. (The definition reads `containTab(e: KeyboardEvent)` and does not match.)
- `grep -n "getActiveElement() === first\|getActiveElement() === last" packages/lib/src/typescript/lib/overlay/Dialog.ts` — zero hits.
- `grep -rn '"inert"' packages/lib/src/typescript/lib` — hits only in `core/Component.ts` and `core/LayerManager.ts`.
- `grep -rn "addBackgroundSurface\|removeBackgroundSurface" packages/lib/src/typescript/lib` — the two definitions, `Rail.ts` (one add, two removes) and `Notification.ts` (one add, one remove).

---

## Documentation Impact

`BackgroundSurface` is exported from `core/index.ts`; `LayerManager` and `DismissableLayer` already are. No barrel exposes anything else new.

- **[`docs/components/Dialog.md`](../packages/lib/docs/components/Dialog.md)**, `### Keyboard` ([:145](../packages/lib/docs/components/Dialog.md#L145)). Replace the first paragraph. Say: while a dialog is open the rest of the application is inert — it cannot be focused, clicked or read by a screen reader; `Tab` and `Shift+Tab` wrap inside the dialog; a dropdown, menu or popover opened from the dialog is part of it, so `Tab` reaches it and wraps back; a dialog with nothing focusable takes focus itself; a popup built by hand and appended to `<body>` is inert while the dialog is open, so build it as a `Popover` or `PopupPanel`. Keep the paragraphs on focus return, editors and `Table`. In `### Initial focus` ([:115](../packages/lib/docs/components/Dialog.md#L115)), add the no-focusable case to the default order.
- **[`docs/components/Drawer.md`](../packages/lib/docs/components/Drawer.md)**, the table under `## Modal vs. non-modal` ([:37](../packages/lib/docs/components/Drawer.md#L37)). Add two rows: "Focus" (modal: moves to the drawer's first control on open, wraps inside, returns to the opener on close; non-modal: not moved) and "App behind" (modal: inert; non-modal: interactive).
- **[`docs/components/Window.md`](../packages/lib/docs/components/Window.md)**, `## Gotchas` ([:126](../packages/lib/docs/components/Window.md#L126)). One bullet: a window is non-modal and does not hold focus; while a modal dialog or drawer is open a window is inert, and one shown meanwhile appears behind the backdrop.
- **[`docs/components/Menu.md`](../packages/lib/docs/components/Menu.md)** [:130](../packages/lib/docs/components/Menu.md#L130). Replace the bullet "Inside a modal `Dialog`, `Tab` can leave the dialog" with: inside a modal dialog or drawer, `Tab` closes the menu and focus stays inside the modal — from the modal's last control it goes to the first. In the key table's `Tab` row ([:119](../packages/lib/docs/components/Menu.md#L119)), add "inside a modal layer focus wraps within it".
- **[`docs/components/Rail.md`](../packages/lib/docs/components/Rail.md)** and **[`docs/components/Notification.md`](../packages/lib/docs/components/Notification.md)**. One sentence each: while a modal dialog or drawer is open the rail (for a toast: its dismiss button) cannot be focused or clicked; a toast is still announced.
- **[`docs/concepts/accessibility.md`](../packages/lib/docs/concepts/accessibility.md)**.
  - `## Tab traversal`: rewrite the paragraph that starts "A modal `Dialog` traps Tab inside itself" ([:147](../packages/lib/docs/concepts/accessibility.md#L147)). The containment belongs to every modal layer and is done by `LayerManager`: the page behind is `inert`, `Tab` wraps at the edges, layers opened from the modal are inside it. Keep the Tab-key-owner and `Escape` text. Change the last sentence to "Tab traversal stands down while any modal layer is open".
  - The paragraph on `wrap` ([:130](../packages/lib/docs/concepts/accessibility.md#L130)): the default wrap inside a modal now applies to `next()` / `previous()`; key presses inside a modal are wrapped by `LayerManager`.
  - `## Spatial focus navigation` ([:202](../packages/lib/docs/concepts/accessibility.md#L202)): replace "a dialog's focus trap" with "a modal layer's focus containment".
  - `## Building an accessible custom widget`: add a short note that a custom overlay must be a registered layer, or a `BackgroundSurface`, to take part in modality; link to `/concepts/layering`.
  - `## Testing`, the keyboard bullet ([:284](../packages/lib/docs/concepts/accessibility.md#L284)): add "with a dialog open, check that `Tab` and `Shift+Tab` never reach the page behind, including after a click on the dialog's text".
- **[`docs/concepts/layering.md`](../packages/lib/docs/concepts/layering.md)**.
  - `## Dismiss modes`, the `"modal"` bullet ([:107](../packages/lib/docs/concepts/layering.md#L107)): replace "Used by dialogs, which keep their own Tab focus-trap" with a pointer to the new section.
  - New section `## Modal scope`, after `## Dismiss modes`: the topmost modal, its scope, the table from `### LayerManager owns modality`, what is made inert, `onInertChanged`, `addBackgroundSurface`, `containTab` with its table, `hasModalLayer`, `isBehindModal`.
  - `## Implementing a new layer` ([:126](../packages/lib/docs/concepts/layering.md#L126)): add `onInertChanged(inert) { this.setInertAttribute(inert); }` to the example and one sentence saying a layer without it stays live behind a modal.
- **[`docs/recipes/focus-history.md`](../packages/lib/docs/recipes/focus-history.md)**, `## Modal dialogs` ([:61](../packages/lib/docs/recipes/focus-history.md#L61)): the accelerator is inert while any modal layer is open, also with a menu or dropdown open inside it; `back()` and `forward()` skip entries behind the modal.
- **[`docs/reference/browser-support.md`](../packages/lib/docs/reference/browser-support.md)**, `## Required browser features`: add "the `inert` attribute (used to block the page behind a modal dialog or drawer): Chrome 102, Firefox 112, Safari 15.5". Change the closing sentence, which says everything has been available since 2018, to name `inert` as the newest requirement (2023).
- **[`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)**.
  - `## Fixed` → `### Overlay`: **The keyboard can no longer reach the application behind a modal `Dialog` or `Drawer`.** List the ways it could: `Tab` from a menu or an open dropdown at the dialog's last control, `Shift+Tab` after a click on the dialog's text, a hidden last control, a dialog with nothing focusable (its opener stayed focused and `Space` activated it again), `Alt+[` with a menu open, and every `Tab` under a modal drawer. Say what holds now: the rest of the application is `inert` and `Tab` wraps. State the consumer-visible consequences: `element.focus()` on something behind a modal does nothing until it closes; a popup appended to `<body>` by hand is inert while a modal is open.
  - `## Changed` → `### Overlay`: **A modal `Drawer` takes focus when it opens and returns it when it closes.** And: **A custom `DismissableLayer` should implement `onInertChanged`**, or it stays live behind a modal.
  - `## Added` → `### Core`: `LayerManager.hasModalLayer`, `isBehindModal`, `containTab`, `addBackgroundSurface` / `removeBackgroundSurface`, `DismissableLayer.onInertChanged`, `Component.setInertAttribute` / `getInertAttribute`.
- **[`ARCHITECTURE.md`](../ARCHITECTURE.md)**. Add a short section `## Modal layers` after `## Event handling`: `LayerManager` is the only owner of modality; a surface portaled outside `<body>` that can hold focus must be a registered layer implementing `onInertChanged`, or a `BackgroundSurface`; no component implements its own focus trap or sets `inert` itself.
- **Not edited:** `docs/components/Popover.md`, `ComboBox.md`, `SplitButton.md`. Their behaviour outside a modal is unchanged.

---

## Potential Challenges

- **Order in `Dialog.open()` and `Drawer.open()`.** The focused element must be read before `LayerManager.register(this)`. Registering a modal makes `<body>` inert, and the browser then blurs the opener. Mitigation: keep the read as the first statement, as steps 6 and 7 say.
- **Order when a modal closes.** Focus must be restored after `LayerManager.unregister(this)`; before it, the opener is still inert and `focus()` does nothing. `Dialog`'s `finalize` already has this order. Mitigation: step 7 places the `Drawer` call after `unregister`.
- **The opener blurs a frame earlier, with no `relatedTarget`.** Today the opener loses focus when the dialog focuses its first control; now it loses focus when the page goes inert. Measured in Chromium: `blur` and `focusout` still fire. Anything that commits on blur (a text field's `change`, a cell editor) behaves as today.
- **Import cycle.** `LayerManager.ts` imports `Focusable.ts`, which imports `LayerManager.ts`. Each uses the other only inside functions, never while the module loads, which is how `Component.ts` and `Event.ts` already depend on each other. Mitigation: `tests/unit/import-without-dom.test.ts` is in the verification list; do not add any top-level use.
- **`LayerManager` is a module singleton in tests.** A modal layer or a mounted `Rail` left registered across `DOM.reset()` makes a later test write `inert` through a dead component. Mitigation: unregister and dispose in teardown; `syncModalScope` reads the body's attribute from the DOM, not from a cached flag, so the body itself cannot go stale.
- **A destroyed layer.** `Dialog`'s `finalize` runs its destructor before `LayerManager.unregister`. Mitigation: `unregister` never calls the removed layer's hook; a layer's stale attribute is reset by `syncModalScope` when it registers again.
- **Browser-extension UI inside `<body>`.** A password manager that injects its inline menu into `<body>` gets an inert menu while a dialog is open. Its keyboard shortcut and the browser's built-in password dropdown are not affected. Not measured (no extension in the test browser); MV18 records it. If it proves a problem, the remedy is a follow-up that marks the `Body` component's children inert instead of `<body>` itself — do not change the target in this plan.
- **Controls the selector cannot see.** `containTab` finds a layer's last stop with `FOCUSABLE_SELECTOR`. Where the browser's own tab order differs — a native radio group has one tab stop, the selector lists every radio — the wrap can miss, and `Tab` goes to the browser's toolbar and comes back into the modal. It cannot reach the page: that is what `inert` is for.
- **`ComboBox` dropdown stays open.** After `Tab` wraps from the dropdown's list back into the dialog, the dropdown is still open. A dropdown is a click-outside layer and ignores focus moves, in a dialog and outside one. Do not add a close-on-blur here.
- **Statics through `callable()`.** `Component.afterNextLayout` and the `LayerManager` functions are reached the same way existing code reaches them; no new pattern is needed.

---

## Critical Files

- [`core/LayerManager.ts`](../packages/lib/src/typescript/lib/core/LayerManager.ts) — `DismissableLayer` (:41), `onZIndexChanged` hook (:82, the precedent for `onInertChanged`), `register` (:356), `unregister` (:404), `containsAcrossLayers` (:447), `isTopmostInputLayer` (:512), `isDescendantOf` (:619), `nodeContains` (:705), `onKeyDown` (:872).
- [`core/Focusable.ts`](../packages/lib/src/typescript/lib/core/Focusable.ts) — `FOCUSABLE_SELECTOR` (:36), `findTabKeyOwner` (:125), `focusScopeRoot` (:179), `visibleFocusable` (:213).
- [`core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts#L5806) — `getDisabledAttribute` / `setDisabledAttribute` (:5811, :5825), the precedent for the new setter; `setElementAttribute` (:1922).
- [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts) — `open` (:962), `focusFirst` (:1072), `descendantTabKeyOwner` (:1164), `getFocusable` (:1180), `onKeyDown` (:1198), `onTab` (:1240), `stepPastOwner` (:1305), `hide` (:1404), `restorePreviousFocus` (:1469), `destructor` (:1497).
- [`overlay/Drawer.ts`](../packages/lib/src/typescript/lib/overlay/Drawer.ts) — `open` (:339), `close` (:381), `animateOutAndFinalize` (:550), `getDismissMode` (:711), `destructor` (:764).
- [`overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts) — `focusPanel` (:1383, the precedent for focusing a container), `onSessionKeyDown` (:1520), `onPanelKeyDown` and its `Tab` case (:1599).
- [`core/FocusHistory.ts`](../packages/lib/src/typescript/lib/core/FocusHistory.ts) — `revealAndFocus` (:149), `onKeyDown` (:244). [`core/FocusTraversal.ts`](../packages/lib/src/typescript/lib/core/FocusTraversal.ts) — `onKeyDown` (:124), `stepFrom` (:57).
- [`core/Event.ts`](../packages/lib/src/typescript/lib/core/Event.ts#L373) — the viewport pass: every listener runs, in the order components first registered; a stop does not keep the event from the others.
- [`overlay/Rail.ts`](../packages/lib/src/typescript/lib/overlay/Rail.ts#L783), [`overlay/Notification.ts`](../packages/lib/src/typescript/lib/overlay/Notification.ts#L265) — the two background surfaces.
- [`tests/overlay/Dialog.test.ts`](../packages/lib/tests/overlay/Dialog.test.ts), [`tests/overlay/LayerManager.test.ts`](../packages/lib/tests/overlay/LayerManager.test.ts), [`tests/core/FocusTraversal.test.ts`](../packages/lib/tests/core/FocusTraversal.test.ts) — the test recipes.
- [`plans/implemented/context-menu-keyboard-operation.md`](implemented/context-menu-keyboard-operation.md) (Implementation Notes), [`plans/implemented/modal-layer-band-integrity.md`](implemented/modal-layer-band-integrity.md) (its `[^defence]` note names this plan's design as the follow-up), [`plans/implemented/dialog-focus-restore-disposed-opener.md`](implemented/dialog-focus-restore-disposed-opener.md), [`plans/implemented/dialog-escape-releases-tab-owner.md`](implemented/dialog-escape-releases-tab-owner.md).

---

## Non-Goals

- **`role="dialog"`, `aria-modal`, `aria-labelledby`, and a name for the title-bar ✕.** Measured: a `Dialog` carries none of them and the ✕ is an unnamed button. With `inert` the page behind is already out of the accessibility tree, which is what `aria-modal` asks for. The roles and names are a separate, small plan.
- **Native `<dialog>`.** Rejected.[^why-inert]
- **A consumer-facing `inert` option on `Component`.** The setter exists for `LayerManager`; no options-bag field is added.
- **SQLAdmin changes.** None are needed. Checked against the app's source: it uses `Dialog.show` / `confirm` / `error`, two `Dialog` subclasses, `closeOnBackdrop` dialogs, and a non-dismissable login dialog reopened in a loop. Each open and close is one `register` / `unregister`, and the app waits for one dialog to close before it opens the next. The login dialog's preset `ComboBox` and its nested "Save preset" prompt are the two cases this plan changes there (MV19). The app enables `SpatialNavigation` only.
- **Closing a `ComboBox` dropdown when focus leaves it.** Existing behaviour, inside a dialog and outside.
- **Changing what `focusScopeRoot()` returns.** It stays "the last-registered layer". A window shown while a modal is open is inert, so a service scoped to it moves nothing.
- **Removing `Dialog`'s Tab-key-owner mark.** `FocusTraversal` no longer needs it, but `Dialog.descendantTabKeyOwner` and several tests are written around it.
- **Reliable `Tab` out of a `Table` hosted in a dialog.** Documented as unreliable today; unchanged.
- **A `Tab` rule for a focused element that is not a stop.** The browser moves focus from there; the only places it can land are inside the scope or in the browser's own toolbar.
- **Consumer popups appended to `<html>` or `<body>` by hand.** They are not layers. The documentation tells consumers to use `Popover` or `PopupPanel`.

---

## Addendum: What a modal does today

Measured on the worktree base `0bfc35701` in Chromium with real key presses and clicks (chrome-devtools, the demo's `#/misc` page), plus code reading where marked. The demo enables `FocusHistory` and `SpatialNavigation` at startup, not `FocusTraversal`.

How a `Dialog` is modal today:

| Mechanism | Present | Where |
|---|---|---|
| Backdrop over the page, one z-index below the panel | yes | `Dialog.open` (:976) |
| Dialog z-index band above every other surface | yes | `getBand`, `keepsOwnBand` |
| Layer dismiss mode `"modal"` (no outside-click dismissal, `Escape` routed here) | yes | `LayerManager.handleOutside`, `onKeyDown` |
| Wheel trap | yes | `trapWheel` |
| `Tab` wrap | partly | `Dialog.onTab`: only while the dialog is the topmost input layer, and only when the focused element is the first or last match of `FOCUSABLE_SELECTOR`, hidden matches included |
| Focus moved in on open, returned on close | yes | `focusFirst`, `restorePreviousFocus` |
| `inert` on anything | no | — |
| `role="dialog"`, `aria-modal`, a label | no | the element is a plain `div`; the whole page stays in the accessibility tree (146 nodes in a snapshot, 6 once the prototype had made `<body>` inert) |
| The dialog element itself focusable | no | focus cannot rest on it |

A modal `Drawer` has the scrim, the band, the dismiss mode and the wheel trap, and no focus handling of any kind (code reading and measurement).

What the keyboard does:

| # | Setup | Keys | Result |
|---|---|---|---|
| 1 | confirm dialog (✕, Cancel, Confirm) | `Tab` from Confirm; `Shift+Tab` from ✕ | wraps both ways, also with `FocusTraversal` enabled |
| 2 | the same; click the title text | `Shift+Tab` ×2 | focus is on `<body>` after the click, then on the page's last button, then the one before it. `Enter` on a page button opened a window behind the backdrop |
| 3 | last control is a `TextField`; Shift+F10 | `Tab` ×3 | menu closes, focus returns to the field, then `<body>`, then the page's navigation tree, then a page button. This is the report |
| 4 | last control is a `ComboBox`, dropdown open | `Tab` ×2 | the dropdown list, then `<body>`. No menu involved |
| 5 | the last focusable in DOM order is `display: none` | `Tab` from the last visible control | `<body>`, then the page. `Shift+Tab` from the first control is consumed and focus does not move |
| 6 | no focusable content (`buttons: []`, `dismissable: false`) | `Tab`, `Space` | focus stays on the opener behind the backdrop; `Tab` is consumed; `Space` activates the opener, which opened a second dialog |
| 7 | a dialog over a dialog | `Tab` | wraps inside the top one; closing it returns focus to what was focused when it opened |
| 8 | `FocusHistory` on | `Alt+[` in the dialog; then with a menu open | first: nothing. With the menu: focus moves to a page button behind the dialog |
| 9 | `FocusTraversal` on; focus on `<body>` | `Tab` ×2 | `<body>`, then the page |
| 10 | modal `Drawer` | `Tab`, `Shift+Tab` | focus never enters the drawer by itself; the keys walk the page. Closing with focus inside drops it on `<body>` |
| 11 | non-modal `Window` | `Tab` from its last control | leaves to the page — intended, and unchanged by this plan |
| 12 | close any dialog | — | focus returns to the opener, also when focus was on `<body>` at close |

Compared with the WAI-ARIA modal dialog pattern:

| The pattern asks | Today | After this plan |
|---|---|---|
| focus moves into the dialog when it opens | yes, unless it has nothing focusable (row 6); never for a modal drawer | always |
| `Tab` / `Shift+Tab` wrap inside | only in row 1 | in every row above |
| content outside is inert | no; only the pointer is blocked | yes |
| focus returns to the invoker on close | `Dialog` yes, `Drawer` no | both |
| `role`, `aria-modal`, accessible name | no | no (see `## Non-Goals`) |

How the library contains or routes focus elsewhere (the precedent search):

- `FocusTraversal` — steps through `visibleFocusable(focusScopeRoot())`; wraps only when the root is a modal layer; "nothing focused" lands on the first or last stop.
- `LayerManager.containsAcrossLayers` and `CellEditor.retainsFocus` — "a layer opened from X counts as inside X". The scope in this plan is the same rule.
- `Menu`'s keyboard session — an overlay handles its keys in a viewport listener registered when it opens, and returns focus to its invoker.
- `Menu.toggleFor`, `SplitButton`, `MenuBar` — the host keeps focus; no containment.
- `RovingTabIndex` — one stop per group; no containment.
- `SpatialNavigation` — stands down while any non-manual layer is open.

---

## Notes

[^lm-owner]: Today the rule lives in `Dialog.onKeyDown`, scoped with `LayerManager.isTopmostInputLayer(this)`. That scope is the cause of the reported hole: any layer opened from the dialog — a menu, a `ComboBox` dropdown — is then the topmost input layer, so the dialog's wrap stands down exactly when focus is about to leave. A modal `Drawer` has no key handling at all. Moving the rule to `LayerManager` gives one definition of "the modal on top" that every modal layer shares, and `LayerManager` is the only module that knows which layers were opened from which. The earlier plan `modal-layer-band-integrity` reached the same conclusion in its `[^defence]` note: an `inert`-based guard "needs `LayerManager` to orchestrate it".

[^why-inert]: Three options were weighed. **(1) The `inert` attribute — chosen.** It is the platform's own statement of "this content is not interactive": no focus by any route, no pointer events, no accessibility-tree entry. It is available in every browser the library supports (Chrome 102, Firefox 112, Safari 15.5; the library documents Chrome and Firefox as tested), and it is an ordinary attribute, so it goes through the existing seam (`DOM.sink.apply` and `Component.setElementAttribute`) with no new seam method. Measured in Chromium: with `<body>` inert, `focus()` on a page control does nothing, `Shift+Tab` from `<body>` lands on the dialog's last control instead of the page, a programmatic `click()` still dispatches (so `TableExporter`'s download link and `Button.click()` keep working), and removing the attribute makes the opener focusable again at once. **(2) Native `<dialog>.showModal()` — rejected.** It puts the dialog in the browser's top layer. The library portals every dropdown, menu, popover and tooltip onto `<html>` and orders them with z-index bands; none of them can be drawn above the top layer, and the browser makes all of them inert because they are outside the `<dialog>` element. Mounting them inside the dialog instead is ruled out by the dialog's `contain: strict` and `overflow: hidden` ([Dialog.ts:750](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L750)). It would also not wrap `Tab`: a native modal dialog lets `Tab` reach the browser toolbar. **(3) A hand-written trap alone (keydown plus a focus listener) — rejected.** It is what exists, and the measurements show how many paths it misses; it also does nothing for a screen reader or for `element.focus()` called by library or application code. The first dialog plan (`plans/implemented/modal-dialog.md`, decision 4) rejected `inert` because "enumerating and marking every sibling of the backdrop" was fragile. That reason no longer holds: `LayerManager` did not exist then, and it now knows every layer and which of them were opened from the modal. `<body>` itself is the target, not its children, so content added to the page while a modal is open is covered without bookkeeping.

[^hook]: `LayerManager` could write `inert` on each layer's element handle directly. It does not, for one concrete reason: a layer can register before its element exists (`AbstractWindow.show` registers at line 771 and mounts at 799), and a window shown from a timer while a dialog is open must come up inert. A `Component` attribute setter is buffered and replays at render; a direct write would have nothing to write to. The hook is also the established shape — `onZIndexChanged` exists because "the manager never writes the DOM" of a surface. `setDisabledAttribute` is the precedent for a public boolean-attribute setter that is not on the options bag.

[^background]: With `<body>` and every other layer inert, the `Rail` and the toasts would be the only library controls outside the scope that can still take focus. They sit before the dialog in the document, so they are the first thing the browser focuses when the user returns from the address bar, and where a stray `Tab` lands. A toast's root is a live region (`role="status"` / `"alert"`); making the root inert would silence it for a screen reader, which is why only its dismiss button is marked. A focus listener that pulls focus back into the scope was considered in place of the registry and rejected: it would also pull focus out of a browser extension's own UI attached to `<html>`, and it adds a second containment mechanism where the platform's is enough. The tooltip, the drag ghost and the backdrops hold nothing focusable and are left alone.

[^contain-tab]: Why edges only: between two stops of one layer the browser's own order is correct and cheaper, and it keeps native behaviour such as radio groups. Why per layer and not only at the two ends of the ring: layers are separate children of `<html>`, and their document order is not guaranteed to match the order they opened in (a dropdown that was mounted earlier and is shown again keeps its old position). Handing the step from one layer to the next to the browser would then skip a layer or leave the scope. Why `<body>` gets no rule: after a click on the dialog's text the browser continues from the click position, which is the better behaviour, and with the page inert it can only land inside the scope or in the browser's toolbar. Why `e.defaultPrevented` is checked: viewport listeners all run for every event. `Dialog`'s release step and `LayerManager`'s wrap would otherwise both act when their order is reversed. Why no scroll option on the focus call: `Dialog`'s existing wrap focuses without `preventScroll`, so a wrapped-to control in a scrolled dialog body is brought into view.

[^dialog-split]: `Dialog`'s release needs state only the dialog has (`_releaseOwner`, armed by `requestClose()`), so it stays. The two handlers are independent of listener order. If `LayerManager` runs first with focus inside a released owner, `containTab` returns nothing (focus is inside an owner) and `Dialog` then steps past it. If `Dialog` runs first, it consumes the key and `containTab` sees `defaultPrevented`. `getFocusable` moves to `visibleFocusable` so the release step cannot target a hidden control: measured, the old wrap consumed `Shift+Tab` and left focus where it was when the last match was hidden.

[^menu-call]: The menu's keyboard-session listener is registered when the session starts, so it runs after `LayerManager`'s listener, which was installed when the dialog registered. When `LayerManager` sees the key, focus is still on the menu panel, which is not a stop, so `containTab` returns nothing. The menu then closes and focuses its invoker, and only now is the question "is focus at the edge of the modal" answerable. One call from the menu to the same function answers it. This is not a focus trap in `Menu`, which the earlier plan ruled out: `Menu` holds no rule of its own and behaves exactly as before when no modal is open. `SplitButton` and `ComboBox` need no such call, because their focus stays on a control inside the dialog and `LayerManager`'s own listener sees it there. Verified in Chromium with a runtime prototype: Shift+F10 on a dialog's last field, then `Tab`, lands on the dialog's first control.

[^self-focus]: Measured today: a dialog with no focusable content leaves focus on the button that opened it, behind the backdrop, and `Space` presses that button again. With the page inert the browser blurs the opener, which closes the hole, but focus would then rest on `<body>`. The WAI-ARIA pattern asks for focus inside the dialog, on the container when nothing else can take it. `tabindex="-1"` is set only in this fallback, so an ordinary dialog's element stays unfocusable and a click on its text behaves as today.

[^drawer-focus]: Today a modal drawer leaves focus on its opener for as long as it is open. Once the page is inert the opener is blurred when the drawer opens, so without this decision focus would be on `<body>` both while the drawer is open and after it closes. Recording and returning focus is therefore required, and moving focus in on open is the matching half. The liveness test is `isRegistered` then `isConnected`, not `isLiveHandle`, for the reason recorded in `dialog-focus-restore-disposed-opener`: the modelled test DOM's `isConnected` does not throw for a released handle. Focus is deferred past the first layout for the reason `Dialog` gives: a `Panel` child is re-parented into its scroll frame by the first layout, which silently blurs it.

[^services]: `FocusHistory` tested `getTopLayer().getDismissMode() === "modal"`, which is false as soon as a menu is open above the dialog. Measured: `Alt+[` then moved focus to a page button behind the dialog. With the page inert that focus call fails, but `FocusHistory` reveals an entry before focusing it (it selects tabs and expands regions), so entries behind the modal are skipped before the reveal. `FocusTraversal` moved focus itself inside a modal layer that is not marked a Tab-key owner (a modal drawer). With `LayerManager` wrapping too, the two would each move focus on one key press whenever `FocusTraversal` was enabled after a layer had opened. Standing down for any modal makes the result independent of that order.

[^spatial]: Its key handler already stands down while any non-manual layer is open. Its `move()` API searches inside `focusScopeRoot()`, the last-registered layer. If that layer is behind the modal it is inert, so the focus call does nothing and the move reports `false`.

[^prototype]: Evidence was gathered without changing source. A script pasted into the running demo wrapped `LayerManager.register` / `unregister`, set `inert` as this plan describes, and added the edge wrap as a window-level listener (kept at `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/dialog-focus-trap/runtime-prototype.js`, beside `probe-install.js`). Confirmed in Chromium with real key presses: MV2; MV3 (focus stayed off the page; the second press was not run); MV4; the forward half of MV5; MV6 (opener not activated, `Tab` consumed, accessibility snapshot reduced to the dialog); the inert state of MV7 (outer dialog inert under the inner one); MV8's return to the opener; MV9's second half with `inert` only (focus did not reach the page, though `FocusHistory` still walked its trail — the reason for the `FocusHistory` change); and for MV11 the inert page and the wrap, but not focus-in or focus return, which the prototype does not implement. Not run: Firefox, WebKit, a real backdrop click (the tool clicks only elements in the accessibility tree), MV10, MV12–MV20, and any assistive technology.
