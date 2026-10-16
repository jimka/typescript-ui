---
touches-shared:
  - packages/lib/src/typescript/lib/overlay/Menu.ts
  - packages/lib/tests/component/dispose-listener-teardown.test.ts
  - packages/lib/docs/components/Menu.md
  - packages/lib/docs/concepts/accessibility.md
  - packages/lib/docs/reference/changelog/next.md
---

# Context Menu Keyboard Operation — Implementation Plan

## Overview

A context menu opened from the keyboard cannot be worked from the keyboard. Shift+F10 or the ContextMenu key opens the menu, but the arrow keys, Enter and Space go on acting on whatever had focus. The report came from the `MarkdownEditor`; the gap is in [`Menu`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L102) and affects every opener that calls [`Menu.show()`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L299). The measured state of each opener is in [Addendum: what the keyboard does today](#addendum-what-the-keyboard-does-today).

This plan makes `Menu.show()` start a *keyboard session* when the menu was opened from the keyboard. In a keyboard session the menu panel takes DOM focus, highlights its first enabled row, and handles its own keys (arrows, Home/End, Enter/Space, Right/Left for submenus, Tab). When the menu closes, focus returns to the *invoker*: the element that had DOM focus when the session started. A menu opened with the mouse behaves as it does today.

The change is in `Menu`, with two small follow-ons: `MenuRow` gains one method for `aria-activedescendant`, and `CellEditor` keeps a table cell's edit open while a menu holds the keyboard. `MarkdownEditor.ts` is not touched. Every source file this plan changes is identical on `master` and on the Markdown stack, so the plan has no dependency and can be built on a branch from `master`.[^no-dependency]

---

## Architecture Decisions

### The fix is in `Menu`, not in the editor

`Menu.show()` gains the keyboard session; no opener changes. Every library opener and every consumer menu gets the behaviour from the one change.[^general-gap]

### A keyboard-opened context menu takes DOM focus on its panel

The menu panel element becomes focusable (`tabindex="-1"`) and is focused when a keyboard session starts. Rows stay non-focusable. The highlighted row is the existing highlight (`setFocusedIndex`), exposed to assistive technology through `aria-activedescendant` on the panel.

This composes two patterns the library already has:

- [`Tree`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2157) — the container holds DOM focus, listens for `keydown` on itself ([Tree.ts:2427](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2427)), and points `aria-activedescendant` at the active row.
- [`Dialog`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L963) — an overlay records `DOM.source.getActiveElement()` when it opens and returns focus there when it closes, skipping an element that has been disposed or removed ([Dialog.ts:1469](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1469)).

This is a deliberate deviation from "a menu never takes DOM focus", the model `SplitButton` and `MenuBar` use. That model needs a host that forwards keys, and a context menu has none.[^why-focus]

### "Opened from the keyboard" means the last input was a key press

`Menu` watches two viewport events, `keydown` and `pointerdown`, and remembers which came last. `show()` starts a keyboard session when the last one was a `keydown`. The watch mirrors [`Tooltip`'s pointer watch](../packages/lib/src/typescript/lib/overlay/Tooltip.ts#L770): static handlers, one static sentinel `Component` as owner, started once and kept for the session, with an `@internal` stop method for tests.[^input-watch]

| Sequence before `show()` | Session? |
|---|---|
| `keydown` Shift, `keydown` F10, `contextmenu` | yes |
| `keydown` Enter on a button whose action calls `show()` | yes |
| `pointerdown` (right button), `contextmenu` | no |
| `keydown` Control, `pointerdown`, `contextmenu` (Ctrl+click on macOS) | no |
| no input yet | no |

### Only `show()` starts a keyboard session

`toggleFor()` and persistent-mode `open()` never start one. `SplitButton` keeps focus on its button and forwards keys; `MenuBar` drives its panels from its own listener. Both keep working unchanged, and so does `Menu.handleKey`.[^show-only]

### The key table of a focused menu panel

The panel's own `keydown` listener handles these keys. It is an exact-target listener, so it runs only when the panel element itself has focus.

| Key | Effect | Consumed |
|---|---|---|
| `ArrowDown` / `ArrowUp` | Highlight the next / previous row. Wraps. Skips separators and non-navigable rows. Lands on disabled rows. Closes an open submenu. Scrolls the row into view. | yes |
| `Home` / `End` | Highlight the first / last navigable row. Closes an open submenu. Scrolls the row into view. | yes |
| `Enter` / `Space` | On a row with an enabled submenu: open the submenu and move into it. Otherwise activate the highlighted row. A disabled row does nothing and the menu stays open. | yes |
| `ArrowRight` | On a row with an enabled submenu: open the submenu and move into it. Otherwise nothing. | yes |
| `ArrowLeft` | In a submenu: close the submenu and return to its parent row. In the top menu: nothing. | yes |
| `Tab` / `Shift+Tab` | Close the whole menu and return focus to the invoker. The key then continues, so focus moves on from the invoker as usual. | no |
| `Escape` | Not handled here. `LayerManager` closes the topmost layer, which closes the whole menu chain. | by `LayerManager` |
| any key `SpatialNavigation.claimsKey` claims | Not handled. | no |
| anything else | Not handled. | no |

"Consumed" means the listener returns `{ stop: true, prevent: true }`.[^key-table]

### Focus returns to the invoker before a closing row's action runs

When a row that closes the menu is activated, focus goes back to the invoker first and the row's `action` runs second. A row with `closeOnActivate: false` does not return focus.[^before-action]

| Close path | Order |
|---|---|
| `Enter` / `Space` / click on a closing `MenuItem` | return focus → `action()` → `hide()` |
| `Escape`, `Tab`, outside press, window blur, `hide()` | return focus → close |
| a custom row calling `closeMenu()` | the row's own work → return focus → close |

Focus is returned only when it is still inside the menu chain, and only to an invoker that is still registered and connected. Otherwise focus is left where it is.[^still-inside]

### The menu takes focus back when its invoker grabs it while the menu stays open

While a keyboard session is live, the menu listens for viewport `focusin`. When focus lands on the invoker (or inside it) and the menu is still open, the panel holding the highlight takes focus again. This keeps the menu operable after a row that leaves the menu open runs a command that refocuses the invoker.[^retake]

### The panel that holds the highlight holds DOM focus

Moving into a submenu focuses the submenu's panel; `ArrowLeft` focuses the parent's panel again. Each panel handles its own keys through the same listener, so there is no key routing between panels. Closing a submenu that holds focus hands focus to its parent panel, whatever closed it.[^panel-focus]

### The first enabled row is highlighted; disabled rows stay reachable

A keyboard session highlights the first row that is navigable and enabled. When no row is enabled it highlights the first navigable row. Arrow keys still land on disabled rows, and activating one does nothing: this is what [`MenuItem.isNavigable`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L458) and [`Menu.activateFocused`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L849) already do.[^disabled]

| Rows | Highlighted on open |
|---|---|
| `Cut`, `Copy`, `Paste` | `Cut` |
| `Cut` (disabled), `Copy`, `Paste` | `Copy` |
| `Copy` (disabled) only | `Copy` |
| separators only, or empty | none |

### `aria-activedescendant` names the highlighted row

`setFocusedIndex` writes the highlighted row's id to the panel's `aria-activedescendant`, and clears it when no row is highlighted. A row answers which id to use through a new `MenuRow.getActiveDescendantId()`. The default is the row's own id. `AbstractBooleanMenuRow` returns its inner control's id, because the row element has no role and the control (a real checkbox or radio button) carries the name and the checked state.[^activedescendant]

### A table cell editor keeps its edit while a menu holds the keyboard

A cell editor commits and closes when it loses focus. `CellEditor.retainsFocus` now also answers `true` while a keyboard session whose invoker lies inside the editor is live, so opening the menu from the keyboard no longer ends the edit. This follows [`DateTimeEditor.retainsFocus`](../packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts#L82), which keeps the edit while focus sits in its picker dropdown.[^cell-editor]

---

## Public API

```typescript
// component/container/MenuRow.ts — abstract class MenuRow

/** New. The element id `aria-activedescendant` names while this row is highlighted. */
getActiveDescendantId(): string;            // default: this.getId()

// component/container/AbstractBooleanMenuRow.ts
getActiveDescendantId(): string;            // override: this.getControl().getId()
```

```typescript
// overlay/Menu.ts — class Menu

/** Existing signature. New behaviour: starts a keyboard session when the last input was a key press. */
show(x: number, y: number, configs: MenuItemConfig[], onClose?: () => void, excludeEl?: Handle | null): this;

/** New, @internal. Whether a live keyboard session's invoker is `container` or lies inside it. */
static hasKeyboardSessionFrom(container: Handle | null): boolean;

/** New, @internal, for tests only. Removes the input watch and resets the recorded input to "pointer". */
static _stopInputWatch(): void;
```

```typescript
// component/table/cell/editor/CellEditor.ts — existing signature, new default
retainsFocus(_relatedTarget: Handle | null): boolean;   // now: Menu.hasKeyboardSessionFrom(this.getElement() ?? null)
```

`handleKey`, `focusItem`, `focusNext`, `focusPrev`, `activateFocused`, `getFocusedIndex`, `toggleFor`, `open`, `close` and `hide` keep their signatures. `hide()` additionally returns focus (see step 3).

New private state on `Menu`. None of it is on an options bag: it is framework bookkeeping, not consumer configuration.

| Member | Type | Written by |
|---|---|---|
| `static inputWatchOwner` | `Component` (readonly) | initializer |
| `static inputWatching` | `boolean`, `= false` | `_startInputWatch`, `_stopInputWatch` |
| `static lastInputWasKey` | `boolean`, `= false` | `_recordKeyInput`, `_recordPointerInput`, `_stopInputWatch` |
| `static keyboardSessions` | `Set<Menu>` (readonly) | `takeKeyboardFocus`, `endKeyboardSession` |
| `_invoker` | `Handle \| null`, `= null` | `takeKeyboardFocus`, `endKeyboardSession` |
| `_parentMenu` | `Menu \| null`, `= null` | `handleItemOpenSubmenu`, beside `_disposeOnClose` |

Plain initializers are safe: `Menu` overrides no `applyOptions`, so no setter writes these fields during the `super()` cascade.

---

## Internal Structure

All snippets are for [`overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts). Add `import { Event } from "~/core/Event.js";` and `import { SpatialNavigation } from "~/core/SpatialNavigation.js";`. Every new method gets a JSDoc block (see [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md)).

Input watch:

```typescript
private static readonly inputWatchOwner: Component = new Component();
private static inputWatching: boolean = false;
private static lastInputWasKey: boolean = false;

private static readonly _recordKeyInput = (): void => { Menu.lastInputWasKey = true; };
private static readonly _recordPointerInput = (): void => { Menu.lastInputWasKey = false; };

private static _startInputWatch(): void {
    if (Menu.inputWatching) {
        return;
    }

    Event.addViewportListener(Menu.inputWatchOwner, "keydown",     Menu._recordKeyInput);
    Event.addViewportListener(Menu.inputWatchOwner, "pointerdown", Menu._recordPointerInput);

    Menu.inputWatching = true;
}
```

`_stopInputWatch()` removes both listeners, sets `inputWatching = false` and `lastInputWasKey = false`.

Session start and end:

```typescript
private takeKeyboardFocus(): void {
    const live = Menu.keyboardSessions.has(this);

    // The session is recorded before focus moves: the invoker's blur runs
    // inside focusPanel(), and CellEditor.retainsFocus reads the session there.
    if (!live) {
        this._invoker = DOM.source.getActiveElement();
        Menu.keyboardSessions.add(this);
        Event.addViewportListener(this, "focusin", this.onSessionFocusIn);
    }

    this.focusPanel();
}

private focusPanel(): void {
    // -1: focusable from script, never a Tab stop.
    this.getAria().setTabIndex(-1);
    this.focus(true);
    this.highlightFirstEnabled();
}

private highlightFirstEnabled(): void {
    const enabled = this._menuItems.findIndex(row => row.isNavigable() && row.isEnabled());

    if (enabled >= 0) {
        this.setFocusedIndex(enabled);

        return;
    }

    this.setFocusedIndex(this._menuItems.findIndex(row => row.isNavigable()));
}

private endKeyboardSession(): Handle | null {
    const invoker = this._invoker;

    this._invoker = null;
    Menu.keyboardSessions.delete(this);
    Event.removeViewportListener(this, "focusin", this.onSessionFocusIn);

    return invoker;
}

private returnFocusToInvoker(): void {
    const live = Menu.keyboardSessions.has(this);

    if (!live) {
        return;
    }

    // Read before the session ends and before any layer is unregistered.
    const heldFocus = LayerManager.containsAcrossLayers(this, DOM.source.getActiveElement());
    const invoker   = this.endKeyboardSession();
    const reachable = invoker !== null && DOM.source.isRegistered(invoker) && DOM.source.isConnected(invoker);

    if (heldFocus && reachable) {
        DOM.sink.focus(invoker, { preventScroll: true });
    }

    // After focus has moved: removing tabindex from the focused element would blur it.
    this.getAria().setTabIndex(null);
}
```

`isRegistered` must be called before `isConnected`: `isConnected` throws on a released handle ([Dialog.ts:1482](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1482)).

Chain helpers (recursion, so `this` is never aliased):

```typescript
private rootMenu(): Menu {
    return this._parentMenu === null ? this : this._parentMenu.rootMenu();
}

private keyboardPanel(): Menu {
    const child = this._openSubmenuPanel;

    return child !== null && child._focusedIndex >= 0 ? child.keyboardPanel() : this;
}
```

Key handling:

```typescript
private onMenuKeyDown(e: KeyboardEvent): Event.ListenerResult {
    const claimed = SpatialNavigation.claimsKey(e);

    if (claimed) {
        return;
    }

    switch (e.key) {
        case "ArrowDown":
        case "ArrowUp":
            this.handleKey(e);
            this.afterHighlightMove();

            return { stop: true, prevent: true };

        case "Home":
            this.setFocusedIndex(this._menuItems.findIndex(row => row.isNavigable()));
            this.afterHighlightMove();

            return { stop: true, prevent: true };

        case "End":
            this.focusItem(-1).focusPrev();
            this.afterHighlightMove();

            return { stop: true, prevent: true };

        case "ArrowRight":
            this.enterFocusedSubmenu();

            return { stop: true, prevent: true };

        case "ArrowLeft":
            this._parentMenu?.closeOpenSubmenu();

            return { stop: true, prevent: true };

        case "Enter":
        case " ":
            this.activateOrEnterSubmenu();

            return { stop: true, prevent: true };

        case "Tab":
            this.rootMenu().dismissAll();

            return;
    }

    return;
}
```

- `afterHighlightMove()` calls `this.closeOpenSubmenu()`, then scrolls the highlighted row into view: `const el = this._menuItems[this._focusedIndex]?.getElement(); if (el) { this._itemPanel.revealDescendant(el); }` ([`Panel.revealDescendant`](../packages/lib/src/typescript/lib/core/Panel.ts#L648)).
- `enterFocusedSubmenu(): boolean` reads `const row = this._menuItems[this._focusedIndex]`. It returns `false` unless `row instanceof MenuItem && row.hasSubmenu() && row.isEnabled()`. Otherwise it calls `this.handleItemOpenSubmenu(row)`, then `this._openSubmenuPanel?.focusPanel()`, and returns `true`.
- `activateOrEnterSubmenu()` assigns `const entered = this.enterFocusedSubmenu();` and calls `this.activateFocused()` when `entered` is `false`.
- `End` uses `focusItem(-1).focusPrev()` because `focusPrev` from no highlight wraps to the last navigable row ([Menu.ts:825](../packages/lib/src/typescript/lib/overlay/Menu.ts#L825)).

Focus retake:

```typescript
private onSessionFocusIn(): void {
    const active  = DOM.source.getActiveElement();
    const invoker = this._invoker;

    if (active === null || invoker === null || !DOM.source.isRegistered(invoker)) {
        return;
    }

    const backOnInvoker = DOM.source.contains(invoker, active);

    if (backOnInvoker) {
        this.keyboardPanel().focus(true);
    }
}
```

`DOM.source.contains` is inclusive (an element contains itself), in production and in the test DOM.

Cell-editor query:

```typescript
/** @internal */
static hasKeyboardSessionFrom(container: Handle | null): boolean {
    if (container === null) {
        return false;
    }

    for (const menu of Menu.keyboardSessions) {
        const invoker = menu._invoker;
        const inside  = invoker !== null && DOM.source.isRegistered(invoker) && DOM.source.contains(container, invoker);

        if (inside) {
            return true;
        }
    }

    return false;
}
```

---

## Ordered Implementation Steps

Work test-first: write the step's cases from `## Expected Behaviour` into the new test file `packages/lib/tests/overlay/Menu.keyboardSession.test.ts` (setup in `## Verification`), see them fail, then make the change.

1. **`Menu.ts` — input watch.** Add the two imports, the three static fields, the two static handlers, `_startInputWatch()` and the `@internal` public `_stopInputWatch()` from `## Internal Structure`. Call `Menu._startInputWatch()` in the constructor ([Menu.ts:186](../packages/lib/src/typescript/lib/overlay/Menu.ts#L186)), right after `this.addComponent(this._itemPanel)`. Check: cases W1–W3 fail only for lack of a session (next step).

2. **`Menu.ts` — session start.** Add `static readonly keyboardSessions`, `static hasKeyboardSessionFrom`, the `_invoker` field, `takeKeyboardFocus()`, `focusPanel()`, `highlightFirstEnabled()`. Add an empty `onSessionFocusIn()` for now (step 6 fills it). Change [`show()`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L299): keep the `showAnchored(...)` call but do not return its result; after it, `if (Menu.lastInputWasKey) { this.takeKeyboardFocus(); }`, then `return this;`. Do not touch `toggleFor` or `open`. Check: W1–W5 and S1–S5 pass.

3. **`Menu.ts` — session end.** Add `endKeyboardSession()` and `returnFocusToInvoker()`. Call them from four places:
   - [`hide()`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L499): `this.returnFocusToInvoker();` as the first statement after `assertRebuildMode`, before `closeOpenSubmenu()`.
   - The `MenuItem` activate closure in [`showAnchored`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L350) and the one in [`buildPersistentItems`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1068): before `config.action?.()`, add `if (config.closeOnActivate !== false) { this.rootMenu().returnFocusToInvoker(); }`. Leave the rest of each closure as it is.
   - [`destructor()`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L766): `this.endKeyboardSession();` before `super.destructor()`. It moves no focus.

   Add `_parentMenu` and `rootMenu()` here (the closures need them); step 5 sets `_parentMenu`. Check: F1–F5 and F8 pass.

4. **`Menu.ts` — keys.** Add `onMenuKeyDown`, `afterHighlightMove`, `enterFocusedSubmenu`, `activateOrEnterSubmenu`. Register `Event.addListener(this, "keydown", this.onMenuKeyDown);` in the constructor, before the `_startInputWatch()` call. The listener is registered on every menu, in both modes: a submenu is a persistent-mode `Menu`. Check: K1–K10 pass.

5. **`Menu.ts` — submenus.** In [`handleItemOpenSubmenu`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1263), set `submenuPanel._parentMenu = this;` on the line after `submenuPanel._disposeOnClose = true;`. In [`closeOpenSubmenu`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1135), as the first statement inside the `if`, read `const heldFocus = LayerManager.containsAcrossLayers(this._openSubmenuPanel, DOM.source.getActiveElement());` and call `this.focus(true)` when `heldFocus` is `true`. Add `keyboardPanel()`. Check: U1–U8 pass.

6. **`Menu.ts` — focus retake.** Fill `onSessionFocusIn()` from `## Internal Structure`. Check: F6 and F7 pass.

7. **`aria-activedescendant`.** In [`MenuRow.ts`](../packages/lib/src/typescript/lib/component/container/MenuRow.ts#L89), add `getActiveDescendantId(): string { return this.getId(); }` after `isNavigable()`. In [`AbstractBooleanMenuRow.ts`](../packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts#L278), override it to return `this.getControl().getId()`. In [`Menu.setFocusedIndex`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1097), collect the id of the row that receives the highlight (`""` when the index is out of range or the row is not navigable) and end the method with `this.getAria().setActiveDescendant(activeId);`. Check: A1 and A2 pass.

8. **Cell editors.** `Menu.hasKeyboardSessionFrom` exists since step 2. In [`CellEditor.ts`](../packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts#L154), import `Menu` from `~/overlay/Menu.js` and change the body of `retainsFocus` to `return Menu.hasKeyboardSessionFrom(this.getElement() ?? null);`. Update its JSDoc to name the new case. In [`DateTime.ts`](../packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts#L82), assign `const sessionHeld = super.retainsFocus(relatedTarget);` and return `sessionHeld || (` the existing expression `)`. Check: `grep -rn "retainsFocus(" packages/lib/src/typescript/lib/component/table` shows exactly these definitions and the two callers ([Cell.ts:180](../packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L180), [CellEditorPool.ts:196](../packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L196)); C1–C3 pass.

9. **Listener registry.** In [`tests/component/dispose-listener-teardown.test.ts`](../packages/lib/tests/component/dispose-listener-teardown.test.ts#L64), import `Menu` from `~/overlay/Menu` and add the row `{ name: 'Menu', covers: ['Menu'], make: () => new Menu() }` after the `MenuItem` row. Do not add `Menu` to `UNCLAIMED_LISTENER_CLASSES`. Check: the file passes.

10. **JSDoc in `Menu.ts`.** Update the class comment ([Menu.ts:64–101](../packages/lib/src/typescript/lib/overlay/Menu.ts#L64)), `show()`'s comment and `handleKey`'s comment ([Menu.ts:870](../packages/lib/src/typescript/lib/overlay/Menu.ts#L870)): `handleKey` is the host-forwarded path, and a `show()` opened from the keyboard takes focus and handles its own keys. Describe behaviour in prose; do not `{@link}` a private or `@internal` member from a public comment.

11. **Documentation.** Make the edits in `## Documentation Impact`.

12. **Verify.** Run `## Verification` in full.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts` |
| Create | `packages/lib/tests/overlay/Menu.keyboardSession.test.ts` |
| Modify | `packages/lib/tests/component/dispose-listener-teardown.test.ts` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/recipes/right-click-menu.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

"Opener" below is a `Button` whose element is connected and focused before the menu opens. "Key input" means a `keydown` was the last of the two watched events; "pointer input" means a `pointerdown` was. Cases W–C are testable offline in the modelled test DOM. Cases MV need a real browser.

### Input watch (offline)

| # | Given | Then |
|---|---|---|
| W1 | a `keydown` dispatched at the opener, then `menu.show(10, 10, items)` | the menu element is the active element |
| W2 | a `keydown`, then a `pointerdown`, then `show` | the opener stays the active element |
| W3 | no event dispatched, then `show` | the opener stays the active element |
| W4 | key input, then `menu.toggleFor(openerEl, rect, items)` | the opener stays the active element; `getFocusedIndex()` is `-1` |
| W5 | key input, then a persistent menu's `open(openerEl)` | the opener stays the active element |

### Session start (offline)

| # | Given (key input, then `show`) | Then |
|---|---|---|
| S1 | rows `A`, separator, `B` | active element is the menu element; `getFocusedIndex()` is `0`; the menu's `getAria().getTabIndex()` is `-1`; `Menu.hasKeyboardSessionFrom(openerEl)` is `true` |
| S2 | rows `Cut` (disabled), `Copy`, `Paste` | `getFocusedIndex()` is `1` |
| S3 | one row, disabled | `getFocusedIndex()` is `0` |
| S4 | `[]`, and `[{ separator: true }]` | active element is the menu element; `getFocusedIndex()` is `-1` |
| S5 | pointer input instead | active element is the opener; `getFocusedIndex()` is `-1`; tab index is `null`; `Menu.hasKeyboardSessionFrom(openerEl)` is `false` |

### Keys on a focused menu (offline)

Rows for K1–K2: `A`, separator, `B` (disabled), `C`.

| # | Key | Then |
|---|---|---|
| K1 | `ArrowDown` ×3 from `A` | highlight goes `B`, `C`, `A`; each returns `{ stop: true, prevent: true }`. `ArrowUp` from `A` gives `C` |
| K2 | `End`, then `Home` | highlight is `C`, then `A`; both consumed |
| K3 | `Enter` on an enabled leaf | its `action` runs once; the menu is not the top layer; consumed |
| K4 | `Space` (`" "`) on an enabled leaf | as K3 |
| K5 | `Enter` on the disabled row | no action runs; the menu is still the top layer and still the active element; consumed |
| K6 | `Enter` on a row with `closeOnActivate: false` | its `action` runs; the menu stays the top layer and the active element |
| K7 | `Tab`, and `Tab` with `shiftKey` | the menu is not the top layer; the opener is the active element; the listener returns `undefined` |
| K8 | `menu.requestClose()` (what `LayerManager` calls for `Escape`) | the menu is not the top layer; the opener is the active element |
| K9 | `ArrowRight` on a leaf row; `ArrowLeft` in the top menu | nothing changes; both consumed |
| K10 | `"a"`; and a key for which `SpatialNavigation.claimsKey` is mocked to return `true` | nothing changes; the listener returns `undefined` |

### Focus return (offline)

| # | Given (a live keyboard session unless stated) | Then |
|---|---|---|
| F1 | `focusItem(i)` on a leaf whose `action` records `DOM.source.getActiveElement()`, then `activateFocused()` | the recorded element is the opener; afterwards the menu is not the top layer |
| F2 | another connected element is focused, then `menu.hide()` | that element stays the active element |
| F3 | the opener is disposed, then `menu.hide()`; and the opener is disconnected with `setConnected(openerEl, false)`, then `hide()` | no throw; `DOM.sink.focus` is not called with the opener |
| F4 | `menu.hide()` | tab index is `null`; `Menu.hasKeyboardSessionFrom(openerEl)` is `false`; `getFocusedIndex()` is `-1` |
| F5 | a pointer-opened menu, then `focusItem(0)` and `activateFocused()` | `DOM.sink.focus` is never called |
| F6 | `DOM.sink.focus(openerEl)`, then a `focusin` event dispatched at the opener | the menu element is the active element again |
| F7 | another connected element is focused, then a `focusin` dispatched at it | that element stays the active element |
| F8 | `menu.dispose()` | no throw; `Menu.hasKeyboardSessionFrom(openerEl)` is `false` |

### Submenus (offline)

Rows: `Plain`, `More ▶` with submenu `X` (disabled), `Y`, `Z`.

| # | Given (`More` highlighted in a live session) | Then |
|---|---|---|
| U1 | `ArrowRight` | the submenu panel's element is the active element; the submenu's `getFocusedIndex()` is `1` (`Y`); the parent's is unchanged; the `More` row's `aria-expanded` is `true` |
| U2 | `Enter`; and `Space` | as U1 |
| U3 | `More` disabled, then `ArrowRight` and `Enter` | no submenu opens; the parent stays the active element |
| U4 | U1, then `ArrowLeft` on the submenu | the parent element is the active element; the parent's highlight is still `More`; the submenu is not the top layer |
| U5 | U1, then `Enter` on `Y` whose `action` records the active element | the recorded element is the opener; neither menu is the top layer |
| U6 | the submenu opened without a highlight (call the parent's `activateFocused()`), then `ArrowDown` on the parent | the submenu closes; the parent's highlight moves |
| U7 | U1, then the submenu's `requestClose()` | neither menu is the top layer; the opener is the active element |
| U8 | U1, then `Tab` on the submenu | as U7; the listener returns `undefined` |

### ARIA (offline)

| # | Given | Then |
|---|---|---|
| A1 | `focusItem(0)`, then `focusItem(-1)` | the menu's `getAria().getActiveDescendant()` is row 0's id, then `null` |
| A2 | a `CheckboxMenuRow` highlighted | `getActiveDescendant()` is the id of the row's inner checkbox, not the row's |

### Cell editors (offline)

| # | Given | Then |
|---|---|---|
| C1 | a live session whose invoker is `child`, inside `parent` | `Menu.hasKeyboardSessionFrom(parent)` and `(child)` are `true`; `(unrelated)` and `(null)` are `false`; all are `false` after `hide()` |
| C2 | a `StringEditor` whose inner field's element is focused when a keyboard `show()` runs | `editor.retainsFocus(null)` is `true` during the session and `false` after `hide()` |
| C3 | a `DateTimeEditor` | with no session and a closed dropdown `retainsFocus(null)` is `false`; with a live session from its own element it is `true` |

### Unchanged (offline)

`tests/overlay/Menu.test.ts`, `tests/component/button/SplitButton.test.ts` and `tests/component/MenuButton.test.ts` pass without edits.

### Needs manual verification

Real key presses in Chromium, on the demo app (`npm run dev`). Repeat MV1–MV4 and MV8–MV10 in Firefox and in WebKit; the planner ran neither.[^prototype]

| # | Where | Do | Expect |
|---|---|---|---|
| MV1 | `#/md-editor`, WYSIWYG | select a few words, Shift+F10, `ArrowDown` ×3, `Escape`, type a letter | the menu opens at the selection with `Cut` highlighted; the arrows move the highlight and not the caret; after `Escape` the same words are selected and the letter replaces them |
| MV2 | same | Shift+F10, move to `Copy`, `Enter` | the menu closes; no line break is inserted; the selection is unchanged; the clipboard holds it |
| MV3 | same | Shift+F10, move to `Bold`, `Space`, `ArrowDown`, `Space` | bold then italic are applied; the menu stays open and keeps the highlight moving |
| MV4 | same | Shift+F10, move to `Block style`, `ArrowRight`, `ArrowDown`, `ArrowLeft`, `Enter`, `ArrowDown`, `Enter` | the submenu opens, closes, opens again; `Heading 1` is applied; the selection is unchanged |
| MV5 | same | Shift+F10, `Insert link…`, `Enter`, then Cancel | the dialog's field has focus; after Cancel the surface has focus and the selection is unchanged |
| MV6 | same, caret in plain text | Shift+F10, move to the dimmed `Clear formatting`, `Enter` | the highlight lands on it; nothing happens; the menu stays open |
| MV7 | `#/codeeditor`, and the Markdown editor's source mode | select a line, Shift+F10, `Escape`, Shift+`ArrowRight` | the selection is kept and grows by one character |
| MV8 | `#/misc`, a `TextField` | select text, Shift+F10, `Escape` | the selection is kept. With typed, uncommitted text the field fires its `change` when the menu opens (accepted, see `## Potential Challenges`) |
| MV9 | `#/misc`, "Right-click me for context menu", focused | Shift+F10, `Space` | `Action 1` runs once; the button's own click does not fire |
| MV10 | any of the above | Shift+F10, `Tab` | the menu closes and focus lands on the stop after the invoker |
| MV11 | `#/misc`, "Show window with table (column spec)!", edit a string cell | type, Shift+F10, `Escape`, type; then Shift+F10, `Paste`, `Enter` | the edit stays open throughout; typing continues; Paste lands in the editor |
| MV12 | `#/property-grid`, the header's menu button, focused | `Enter`, `ArrowRight` on "Show/hide columns", `Space` on a row, `Escape` | the column menu is worked entirely from the keyboard; focus returns to the button |
| MV13 | `#/tab`, a focused tab | Shift+F10, arrows, `Escape` | the tab's menu is operable; focus returns to the tab |
| MV14 | every opener above | right-click, then click a row | no focus change when the menu opens; no row is highlighted; the row works as before. Right-clicking an `AutoCompleteField` leaves its suggestion list open |
| MV15 | `#/misc`, "Right-click for a tall (scrolling) menu", in a short window | Shift+F10, `End`, `Home` | the last and first rows scroll into view |
| MV16 | `#/toolbar` `SplitButton`, `#/menubar` | their existing keyboard paths | unchanged; focus stays on the button |
| MV17 | a read-only `MarkdownEditor`, once `markdown-editor-readonly-keyboard-selection` has landed | select text, Shift+F10, `Enter`; and with a bare caret, Shift+F10, `Escape` | the Copy-only menu takes focus; `Enter` copies; focus returns to the surface with the selection or caret unchanged |
| MV18 | optional, a screen reader | MV1 | the menu and the highlighted row are announced |

On the stack tip a read-only editor's surface takes no focus, so the keyboard cannot open its menu there and this plan changes nothing for it.

---

## Verification

Test file setup for `Menu.keyboardSession.test.ts`:

- Node environment and `installTestDOM`, as in [`tests/overlay/Menu.test.ts`](../packages/lib/tests/overlay/Menu.test.ts#L1). Install the test DOM **once for the file** (`beforeAll`), not per test, and in `afterAll` call `Menu._stopInputWatch()` and `DOM.reset()`.[^test-dom]
- Every test constructs its own `Menu`. `afterEach`: hide every menu the test opened, dispose the opener, call `Menu._stopInputWatch()` (it resets the recorded input to "pointer"; the next test's `new Menu()` starts the watch again), and `vi.restoreAllMocks()`.
- Opener: the recipe of [`Dialog.test.ts:1254–1257`](../packages/lib/tests/overlay/Dialog.test.ts#L1254) — `new Button(...)`, `getElement(true)`, `setConnected(el, true)`, `DOM.sink.focus(el)`.
- Input: `DOM.sink.dispatchEvent(el, makeEvent(el, 'keydown', { key: 'F10' }))` and `makeEvent(el, 'pointerdown')`.
- Keys: dispatch `makeEvent(menuEl, 'keydown', { key })` at the menu's element and replace the event's `stopPropagation` / `preventDefault` with counters to assert "consumed", as [`viewport-consume.test.ts`](../packages/lib/tests/dom/viewport-consume.test.ts#L50) does; or call the private `onMenuKeyDown` and assert its return value.
- C2: reach the editor's inner field with `(editor as any)._textField`, render the editor with `getElement(true)`, and focus the field's element.
- "Closed" is "not the top layer": assert `LayerManager.getTopLayer() !== menu`, as the existing keyboard tests do.

Commands, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. `cd packages/lib && npx vitest run tests/overlay/Menu.keyboardSession.test.ts tests/overlay/Menu.test.ts tests/overlay/Menu.styleRuleDisposal.test.ts tests/overlay/Menu.classStyleHoisting.test.ts tests/component/button/SplitButton.test.ts tests/component/MenuButton.test.ts tests/component/table/cell/editor.test.ts tests/component/dispose-listener-teardown.test.ts tests/component/dispose-full-teardown.test.ts tests/unit/import-without-dom.test.ts`
4. `npm test` — the whole suite. A test elsewhere that dispatches a `keydown` and then calls `show()` now gets a focused menu; fix the test's expectation only if the new behaviour is the one this plan describes.
5. `npm run lint`
6. `npm run docs:api`, `npm run docs:llms:check`
7. The MV cases, on `npm run dev`.

Grep checks:

- `grep -n "takeKeyboardFocus\|returnFocusToInvoker" packages/lib/src/typescript/lib/overlay/Menu.ts` — `takeKeyboardFocus` is called from `show()` only; `returnFocusToInvoker` from `hide()` and the two activate closures only.
- `git diff --stat` lists no file under `component/editor/`, `component/button/` or `component/menubar/`.

---

## Documentation Impact

No barrel changes: `Menu` and `MenuRow` are already exported, and the two `@internal` statics stay out of the API docs.

- **[`docs/components/Menu.md`](../packages/lib/docs/components/Menu.md)**
  - Intro paragraph listing the keyboard-highlight methods: keep it, and add that a context menu opened from the keyboard handles its own keys (link to `#keyboard`).
  - **`## Keyboard`**: replace the opening sentence "A menu never takes DOM focus." Split the section in two.
    - *Context menus (`show()`)*: opened with the mouse, the menu takes no focus and has no keyboard handling. Opened from the keyboard — the last thing the user did was press a key, such as Shift+F10, the ContextMenu key, or `Enter` on a button whose action calls `show()` — the menu takes focus, highlights its first enabled row, and returns focus to where it was when it closes. Give the key table from `## Architecture Decisions`. State: focus returns before a closing row's `action` runs; disabled rows can be highlighted and do nothing; `Escape` closes the whole chain; the invoker loses focus while the menu is open, so a text field with typed, uncommitted text commits it when the menu opens.
    - *Dropdowns driven by a host (`toggleFor()`, `MenuBar`)*: the existing text and four-key table, unchanged.
  - **`## Custom rows`**: one bullet for `getActiveDescendantId()` — override it when the row's accessible name and state live on an inner control.
- **[`docs/concepts/accessibility.md`](../packages/lib/docs/concepts/accessibility.md)**
  - *Roles used by built-in components*: change the `Menu` row to "`menu` / `menuitem` / `separator`; a context menu opened from the keyboard takes focus and names its highlighted row with `aria-activedescendant`".
  - *Testing → Keyboard-only*: add "open a context menu with Shift+F10 and work it with the arrow keys, `Enter` and `Escape`".
- **[`docs/recipes/right-click-menu.md`](../packages/lib/docs/recipes/right-click-menu.md)** — in `## Notes`, one bullet: the same handler serves the keyboard, the menu then takes focus and returns it on close, and nothing extra is wired. Link to `/components/Menu#keyboard`.
- **[`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)** — under `## Fixed` → `### Overlay`, one entry: **A context menu opened from the keyboard can be worked from the keyboard.** Say what was wrong (the keys went on acting on the focused control), list the keys, say focus returns to where it was, that mouse-opened menus and `SplitButton` / `MenuBar` are unchanged, that a table cell editor keeps its edit open while the menu is up, and that `MenuRow` gains `getActiveDescendantId()`. End with "No consumer action is needed."
- **Not edited:** `MarkdownEditor.md`. Its sentence about Shift+F10 opening the menu exists only on the Markdown stack and stays true. `SplitButton.md`, `MenuBar.md`, `MenuItem.md` and `CheckboxMenuRow.md` describe paths this plan does not change.

---

## Potential Challenges

- **Session before focus.** `takeKeyboardFocus` must add the session before `focusPanel()` runs: the invoker's `blur` fires inside `focus()`, and `CellEditor.retainsFocus` reads the session there. Keep the order in the snippet.
- **The invoker blurs when the menu opens.** A text field with typed, uncommitted text fires its native `change`; a `NumberSpinner` commits; an `AutoCompleteField` may close its suggestion list. This happens only for a keyboard-opened menu, and it is what a click on a menu row already causes today. Do not work around it.
- **Lexical refocuses asynchronously.** A command run from a row makes Lexical focus its root in a later microtask, not inside the `action` call. A synchronous "did focus leave?" check after `activateFocused()` therefore misses it; keep the `focusin` listener.
- **Viewport registrations outlive `DOM.reset()` in tests.** That is why the new test file installs one test DOM for the whole file and why `_stopInputWatch()` exists. If a case sees no session after a dispatched `keydown`, check this first.
- **Existing suites.** Any test that dispatches a real `keydown` and then calls `show()` in the same DOM now gets a focused menu. Step 4 of `## Verification` is where this surfaces.
- **`Tab` at the edge of a modal `Dialog`.** The menu is the topmost layer while it handles `Tab`, so the dialog's focus trap may stand down for that one key and focus can leave the dialog when the invoker is its last stop. `SplitButton`'s dropdown has the same limit today. Verify MV10 inside a dialog and report the result; do not add a trap to `Menu`.
- **`markdown-editor-readonly-keyboard-selection` and `markdown-editor-link-format-command-fixes`.** Neither touches `Menu.ts` and this plan touches no editor file, so there is no merge conflict beyond `changelog/next.md`. The read-only plan lists working an open menu from the keyboard as a non-goal; once both have landed that limit is gone (MV17).
- **Statics through `callable()`.** `Menu` is exported through `callable()`. `Menu.hasKeyboardSessionFrom(...)` and `Menu._stopInputWatch()` are reached through the callable the same way `MenuItem.HEIGHT` is in `Menu.ts`.

---

## Critical Files

- [`overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts) — `show` (:299), `showAnchored` and its activate closure (:328, :350), `toggleFor` (:464), `hide` (:499), `destructor` (:766), `focusNext` / `focusPrev` (:802, :825), `activateFocused` (:849), `handleKey` (:889), `buildPersistentItems` (:1049), `setFocusedIndex` (:1097), `closeOpenSubmenu` (:1135), `dismissAll` (:1151), `handleItemOpenSubmenu` (:1239).
- [`component/tree/Tree.ts`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2157) — precedent: container focus, own `keydown` listener, `aria-activedescendant`.
- [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1469) — precedent: capture the active element on open (:963), return focus on close (:1469), viewport `focusin` while open (:1007).
- [`overlay/Tooltip.ts`](../packages/lib/src/typescript/lib/overlay/Tooltip.ts#L770) — precedent: a static viewport watch with a sentinel owner (:177) and a test-only stop (:792).
- [`component/table/cell/editor/DateTime.ts`](../packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts#L82) and [`CellEditor.ts`](../packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts#L154) — `retainsFocus`.
- [`core/LayerManager.ts`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L446) — `containsAcrossLayers` (:446), the `Escape` handler (:872).
- [`core/Event.ts`](../packages/lib/src/typescript/lib/core/Event.ts#L801) — `addViewportListener` and its "a stop does not prevent the others" note; the two window-level listeners (:220, :812).
- [`component/button/SplitButton.ts`](../packages/lib/src/typescript/lib/component/button/SplitButton.ts#L372) and [`component/menubar/MenuBar.ts`](../packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L106) — the host-driven paths that must not change.
- [`component/container/MenuRow.ts`](../packages/lib/src/typescript/lib/component/container/MenuRow.ts), [`MenuItem.ts`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L458), [`AbstractBooleanMenuRow.ts`](../packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts#L278).
- [`tests/overlay/Menu.test.ts`](../packages/lib/tests/overlay/Menu.test.ts#L2013), [`tests/overlay/Dialog.test.ts`](../packages/lib/tests/overlay/Dialog.test.ts#L1233), [`tests/dom/viewport-consume.test.ts`](../packages/lib/tests/dom/viewport-consume.test.ts) — the test recipes.
- [`plans/implemented/splitbutton-keyboard-menu-open.md`](implemented/splitbutton-keyboard-menu-open.md) — the host-keeps-focus decision this plan leaves in place for `toggleFor`.

---

## Non-Goals

- **Opening a `Table` cell's or a `Tree` row's menu from the keyboard.** Shift+F10 there opens nothing today: the event targets the focused container, not a cell or a row. That is a separate fix in `Table` / `Tree`, like the one `markdown-editor-context-menu-caret` made for the editor.
- **`MenuButton`, the `ToolBar` overflow button and the window menu.** They open with `toggleFor()` and stay as they are: `Enter` opens them, the arrow keys do not reach them.
- **`MenuBar`.** Its submenus stay unreachable from the keyboard and it gains no `Home` / `End`.
- **`Menu.handleKey` and `SplitButton`.** Unchanged: four keys, focus on the button.
- **Working a mouse-opened menu with the arrow keys.** A menu opened with the mouse behaves exactly as today.
- **Type-ahead.** Optional in the WAI-ARIA menu pattern; no menu in the library has it.
- **`Escape` closing only the submenu.** `Escape` closes the whole chain, as it does today; `ArrowLeft` closes one level.
- **`menuitemcheckbox` / `menuitemradio` roles for boolean rows.** The rows keep their inner control as the accessible element.
- **One highlight for hover and keyboard.** A hovered row and the keyboard row can both look highlighted, as in `SplitButton`'s dropdown today.
- **Changing the `Event` dispatcher** so a viewport listener can keep a key from element listeners.
- **Any change to `MarkdownEditor.ts`.**

---

## Addendum: What the keyboard does today

Measured on the stack tip `f4bfedf2c` in Chromium with real key presses (chrome-devtools, the demo app), plus code reading where marked. The menu code is identical on `master`.

How a menu opens and where focus is:

| Opener | Mouse | Keyboard | Focus while open |
|---|---|---|---|
| `TextInput`, `CodeEditor`, `MarkdownEditor` WYSIWYG, `MarkdownEditor` source mode (a `CodeEditor`), a focused `Button`; a `TabBar` tab (code reading) | right-click opens | Shift+F10 opens, at the caret for an editor or field | stays on the opener; `Menu.show()` never moves focus |
| `Table` body cell | right-click opens | **opens nothing**: the event targets the `TableBody`, and no cell is found | — |
| `Tree` row (code reading) | right-click emits `"contextmenu"` | **emits nothing**: the event targets the tree element | — |
| `Table` header menu button (code reading) | click opens | `Enter` opens (it calls `show()`) | stays on the button |
| `SplitButton` | chevron click | `ArrowDown` / `Alt+ArrowDown` | stays on the button, by design |
| `MenuButton`, `ToolBar` overflow, window menu (code reading) | click | `Enter` / `Space` on the button | stays on the button |
| `MenuBar` | click | `Enter` / `Space` on a bar button | stays on the bar button |

What each key does once the menu is open:

| Key | Context menu (`show()`) | `SplitButton` dropdown | `MenuBar` panel |
|---|---|---|---|
| `ArrowDown` / `ArrowUp` | goes to the opener: the caret moves, the menu shows no highlight | moves the highlight | moves the highlight |
| `Home` / `End` | goes to the opener | not handled | not handled |
| type-ahead | the letter is typed into the opener | not handled | not handled |
| `Enter` / `Space` | goes to the opener | activates the row | `Enter` activates; `Space` not handled |
| `ArrowRight` / `ArrowLeft` | goes to the opener | closes the dropdown | switches to the next / previous menu |
| submenu rows | unreachable | unreachable | `Enter` opens the submenu, its rows are unreachable |
| `Tab` | goes to the opener: from a text field focus moves to the next control and **the menu stays open** | closes the dropdown, focus moves on | not handled |
| `Escape` | closes the menu; focus never left the opener; the key does not reach the opener | same | same |

Why the `MarkdownEditor` case fails: `Menu.show()` does not focus the menu, so focus stays in the Lexical surface, and no component forwards keys to `Menu.handleKey`. Lexical handles the arrow keys and Enter itself. The editor neither closes nor ignores the menu, and it does not consume anything the menu needed: the menu simply never receives a key. `Escape` works only because `LayerManager` closes the topmost layer from a viewport listener. `TextInput` and `CodeEditor` fail the same way.

A click on a menu row already takes focus off the opener today (`focusout` on the field at mouse-down), and the row's command puts it back.

---

## Notes

[^no-dependency]: `git diff --stat master f4bfedf2c` is empty for `overlay/Menu.ts`, `component/container/`, `component/table/cell/`, `component/button/`, `component/menubar/`, `core/LayerManager.ts`, `core/Event.ts`, `tests/overlay/Menu.test.ts`, `tests/component/dispose-listener-teardown.test.ts`, `docs/components/Menu.md`, `docs/concepts/accessibility.md` and `docs/recipes/right-click-menu.md`. Of the files this plan edits only `docs/reference/changelog/next.md` differs, and the entry is an addition to an existing section. `MarkdownEditor.ts` needed no change in the prototype: restoring focus before the action and the `focusin` retake cover the editor's menu, its submenus and its checkbox rows.

[^general-gap]: `Menu.show()` is called by nine library classes — `TextInput`, `TextInputCellEditor`, `CodeEditor`, `MarkdownEditor`, `SelectableText`, `Markdown`, `Split`, `TabBar` and `Table` (three menus) — and by the demo app; none forwards a key. A per-opener fix would have to be repeated in each, would miss consumer menus, and could not be written for openers that pass only coordinates.

[^why-focus]: Three things rule out the host-forwarding model for a context menu. (1) There is no host: the opener is whatever had focus — a Lexical surface, CodeMirror, an `<input>`, a consumer's component. (2) A menu-side claim through a viewport `keydown` listener, as `MenuBar` uses, cannot keep keys from the focused component. The dispatcher's element listener and its viewport listener are two separate capture listeners on `window` ([Event.ts:220](../packages/lib/src/typescript/lib/core/Event.ts#L220), [:812](../packages/lib/src/typescript/lib/core/Event.ts#L812)); `stopPropagation()` stops the event before native element listeners (Lexical, CodeMirror) but not the other listener on the same node. A `Table` body, a `NumberSpinner`, an `AutoCompleteField`, a cell editor or a `TabBar` would act on the same arrow or Enter key as the menu. Key-up is not covered at all. (3) With focus elsewhere, assistive technology is told nothing about the highlighted row. Real focus on the panel removes all three: the event's target is the menu, so no other component is on its path. The prototype confirmed it for the Lexical surface, CodeMirror, a text field, a button and a table cell editor. Moving focus onto each row (a roving `tabindex`) was not chosen: it needs focus plumbing on every row type, and the highlight model with `aria-activedescendant` is what `Tree` and the table body already use.

[^input-watch]: A `contextmenu` event does not say reliably how it was raised. Chromium reports `button: -1` for Shift+F10 (measured), Firefox and WebKit report other values, and Ctrl+click on macOS reports the primary button. Most openers also pass only `clientX` / `clientY` to `show()`, and some (`Table`, `TabBar`, `Split`) relay the coordinates through custom events without the event object. Recording the last input needs no browser-specific rule and no opener change, and it also covers a menu a consumer opens from a key handler or from a button activated with Enter (the `Table` header's menu button). The watch starts in the `Menu` constructor. A `Menu` that is first constructed inside the very event that opens it has no record of the key yet and opens as a pointer menu that one time; the library's lazily-built menus (`SelectableText`, `Markdown`, `Split`) belong to components the keyboard does not target. An explicit `fromKeyboard` argument was rejected: every opener would have to compute it, with the unreliable rule above.

[^show-only]: `toggleFor()` is how `SplitButton`, `MenuButton`, the `ToolBar` overflow and the window menu open. `SplitButton` was given its keyboard path recently on the model "focus stays on the button" (`plans/implemented/splitbutton-keyboard-menu-open.md`), including a Space key-up guard that depends on it. A session started from `toggleFor()` would take focus off the button and change that behaviour. The other three are listed in `## Non-Goals`.

[^key-table]: The table follows the WAI-ARIA menu pattern with these choices. `Tab` closes and lets the key continue, which is both the pattern's behaviour and what `SplitButton` does ([SplitButton.ts:375](../packages/lib/src/typescript/lib/component/button/SplitButton.ts#L375)); in Chromium the browser then moves focus on from the invoker, including out of an editor that normally keeps `Tab`. Consuming `Tab` instead was rejected because, with `FocusTraversal` enabled, the outcome would depend on the order of two window-level listeners. `ArrowLeft` / `ArrowRight` are always consumed so they cannot scroll the page behind the menu. `Enter` and `Space` must be consumed with `prevent`: focus moves to the invoker during the key-down, and an unprevented Enter would then insert a line break into an editor. Measured: with `prevent`, no `beforeinput` reaches the editor, and a Space key-up on a `<button>` invoker does not click it.

[^before-action]: A menu command acts on the invoker's selection, and several need it focused: clipboard access, a Lexical command, a `Dialog` that must return focus to the editor when it closes (`Dialog` records the active element when it opens). Running the action with focus still in the menu would make such a dialog return focus to a menu that has since closed. A row with `closeOnActivate: false` keeps the menu open and keeps the keyboard, so its focus stays put. A custom row built from a `row()` factory owns its own activation, and `Menu` cannot run code before it; its focus returns in `hide()`.

[^still-inside]: Two cases must not have focus pulled back: a row action that opened a dialog or focused another control, and an outside press that is about to focus what was pressed. For an outside press the menu closes during `pointerdown`, focus goes to the invoker, and the browser then moves it to the pressed element as usual. The guard for a disposed or removed invoker is `Dialog.restorePreviousFocus`'s.

[^retake]: Measured in the editor: `Space` on the `Bold` checkbox row applies the format, and a moment later Lexical focuses its root because it wrote a selection. The menu is still open, so without the retake the next arrow key moves the caret again. Only a return to the invoker triggers the retake; focus moving anywhere else (a dialog, another field) is left alone. `Dialog` is the precedent for a viewport `focusin` listener held while an overlay is open.

[^panel-focus]: A submenu is a separate `Menu` mounted beside its parent, not inside it. `aria-activedescendant` on the top panel could not name a submenu row without `aria-owns` wiring, and one panel handling every level's keys would need a router. Focusing the submenu panel avoids both. A menu is a `"click-outside"` layer, so focus moving between panels dismisses nothing. Handing focus back in `closeOpenSubmenu` covers `ArrowLeft` and a hover that switches the open submenu; at the top level `hide()` returns focus to the invoker first, so nothing is handed back there.

[^disabled]: The WAI-ARIA authoring guidance prefers disabled menu items to stay focusable, so a keyboard user can discover them. The library already works that way. Starting on the first *enabled* row is new, and it matters for the clipboard menus: `Cut` is disabled without a selection and is the first row. A read-only editor's menu holds only `Copy`; when `Copy` is disabled the highlight still lands on it.

[^activedescendant]: `setFocusedIndex` is shared by every keyboard path, so `MenuBar` panels and `SplitButton` dropdowns get the attribute too. It has no effect there, because those panels never hold focus. A `CheckboxMenuRow`'s row element carries no role today; pointing at its checkbox lets a screen reader announce name and state without changing the row's roles.

[^cell-editor]: Measured: without this rule, Shift+F10 in a string cell editor commits the edit, removes the editor's input, and leaves a `Cut` / `Copy` / `Paste` menu acting on nothing; `Escape` then drops focus on the page. With the rule the edit stays open, `Escape` returns to the input and typing continues. The query asks `Menu` about the session, not the blur event's `relatedTarget`, because `StringEditor` and `NumberEditor` re-fire their inner field's blur without one. When the menu closes by an outside press, focus returns to the editor and then leaves it, and that blur commits as usual.

[^prototype]: Evidence was gathered without changing source: a script pasted into the running demo page wrapped `Menu.prototype` with this plan's behaviour (kept at `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/context-menu-keyboard/runtime-prototype.js`). It confirmed, in Chromium: the panel can be focused synchronously right after `show()` and after a submenu's `open()`; selection and caret survive the round trip in Lexical, CodeMirror and an `<input>`; `Enter` inserts nothing; `Tab` continues from the invoker; a submenu can be entered and left; a checkbox row keeps the menu operable with the `focusin` retake. Scrolling a tall menu's row into view and the `TabBar` and header-button cases were not run.

[^test-dom]: `Event` keeps its viewport registrations in module-level state and attaches the window listener only when a type is first registered; `DOM.reset()` swaps the DOM without clearing that state. A later registration of the same type in a fresh test DOM is then never attached (see the header of `tests/dom/viewport-consume.test.ts`). `LayerManager` adds a viewport `keydown` listener of its own while any layer is open, so resetting the DOM per test would silently stop `keydown` from reaching the input watch.

---

## Implementation Notes

Built on `master` (`84ce13197`), as the plan said was possible. Notes on what differed, what was done instead, and what was left.

### Deviations from the plan

1. **Keys are handled by a session-scoped viewport listener, not an exact-target listener on every menu (step 4).** The plan registers `Event.addListener(this, "keydown", …)` in the `Menu` constructor. Built that way, `Enter` on a menu row inside a modal `Dialog` also confirmed the dialog. Cause: the dispatcher's element listeners and viewport listeners run from two separate window-level listeners, in whichever order an application happened to install them. `Dialog` confirms on `Enter` from a viewport listener scoped to "I am the topmost layer". When the element-level listener ran first, the menu activated its row and unregistered itself, and the dialog then found itself topmost with focus back on its `<input>`. Reproduced in Chromium with real key presses (a temporary page that registers an element-level `keydown` before any viewport one) and in the test DOM; the demo app does not show it, because it enables `FocusHistory` and `SpatialNavigation` at startup, which installs the viewport listener first.
   Done instead: the top-level menu registers a viewport `keydown` listener when its keyboard session starts and removes it when the session ends (`onSessionKeyDown`). It finds the panel of its chain the key was pressed on (`panelAt`) and hands the key to it (`onPanelKeyDown`, the plan's `onMenuKeyDown`). Viewport listeners run in registration order, and this one is registered after every layer that was already open, so a dialog beneath always sees the menu still open. The key table, the "only a key pressed on the panel itself" rule, and every other decision are unchanged, and the change stays inside `Menu.ts`. A side effect: a menu holds no listener registration except during a session, so `tests/component/input/TextInput.test.ts` needed no change.
   Pinned by cases `D1` (both listener orders) in `Menu.keyboardSession.test.ts`. Alternatives not taken: an exemption in `Dialog.onEnter`, or a `LayerManager` rule that a layer closed while a key is being dispatched still counts as topmost for that key. The second would also cover a consumer's own `isTopmostInputLayer`-scoped handler and is a candidate for a follow-up plan.

2. **A viewport listener registered by another viewport listener no longer receives the event that one is handling (`core/Event.ts`, not in the plan's file table).** The review found the sibling of the case above: `Enter` on a row whose `action` opens a `Dialog` confirmed that dialog. The dialog registers its viewport `keydown` listener while the menu's listener is still running, and the dispatcher walked live collections, so the new listener received the same `Enter`; the menu had closed by then, the dialog was topmost, and focus was on the invoker. `SplitButton` and `MenuBar` were spared on `master` only because their focused element is a `<button>`, which `Dialog` exempts. Each viewport registration now carries a sequence number, and the viewport pass of a dispatch skips the ones made after that pass began, which is what a native listener added during a dispatch gets. The plan's non-goal about the dispatcher is a different change (letting a viewport listener keep a key from element listeners) and still stands. Pinned by `D2` (both orders) and by two cases in `tests/dom/events.test.ts`; the whole suite passed unchanged. Verified in Chromium in both listener orders: the confirm dialog stays open, and `Escape` returns focus to the invoker. A `Dialog` opened from an *element* `keydown` listener, in an application where element listeners run before viewport ones, is not covered by this change: its listener is registered before the viewport pass begins. That case exists on `master` and was not audited here; `events.md`, the `addViewportListener` comment and the changelog entry state the rule with that limit, and a case in `events.test.ts` pins it. Taking the mark when the event's first pass begins would close it, at the cost of a per-event write on the dispatcher's hot path; a candidate for a follow-up plan. The element pass itself is unchanged and still hands the event in flight to a listener added to the same component during it.

3. **A bare modifier and a key's auto-repeat do not count as a key press.** The plan's table for "opened from the keyboard" only has a key before the pointer press. Where the browser raises `contextmenu` on the mouse button's release, a held Control or Shift keeps repeating between the `pointerdown` and `show()`, and a Control-held right-click would have opened as a keyboard menu. `_recordKeyInput` ignores `e.repeat` and the keys in `MODIFIER_KEYS` (`core/Focusable.ts`, the set `Dialog` and `FocusTraversal` already use for the same purpose). Shift+F10 still counts through its `F10`. Cases `W2c`–`W2e`. Not checked in a browser on Windows.

4. **`<body>` is not an invoker.** With nothing focused a browser reports `<body>` as the active element, and every element of the page lies inside it, so the focus retake would have fired for any focus move. Such a session has no invoker (`SpatialNavigation` treats `<body>` the same way). Case `S7`.

5. **A held `Enter` or `Space` is consumed and does nothing.** `Enter` on a button whose action opens the menu is still down when the panel takes focus, so its auto-repeat landed on the menu and activated the first row (found by the review with a probe test; with a closing row the repeats would then alternate between the button and the menu, which was reasoned and not run). `onPanelKeyDown` ignores `e.repeat` for these two keys, as `Button` does for `Space`. A held arrow key still repeats. Cases `K12`, `K13`.

6. **The first highlighted row is scrolled into view.** A menu with `setScrollToBottomOnShow(true)` opened scrolled away from the row a session highlights. No `show()` caller in the library sets that option. Case `K2c`.

7. **A key pressed with `Alt`, `Control` or `Meta` is left alone.** The plan's key table says nothing of modifiers, and the listener consumed `Alt+ArrowLeft` (the browser's Back), `Ctrl+Space` and the like as the bare key. `SpatialNavigation.claimsKey` does not cover them: it stands down while any layer is open. `Shift` is not excluded, so `Shift+Tab` still closes the menu. Case `K14`.

8. **`DateEditor` and `TimeEditor` keep their picker open too (`Date.ts`, `Time.ts`, not in the plan's file table).** Both closed their picker on every blur without asking `retainsFocus`; only `DateTimeEditor` asked. With the new default the edit stayed open while the menu was up but the picker closed, and opened again when focus came back. Their blur handler now asks first, as `DateTimeEditor`'s does. Case `C5`.

9. **`_stopInputWatch()` removes nothing when the watch is not running**, as `Tooltip._stopPointerWatch()` does. The removal reads the window, which a test that has already reset the DOM no longer has. Case `W6b`.

10. **In a keyboard session every panel of the chain is focusable.** A submenu opened by hover never went through `focusPanel()`, so a press on one of its rows dropped focus on the page and it was not returned. `handleItemOpenSubmenu` gives the submenu `tabindex="-1"` while the root's session is live. Cases `P1`, `P2`.

11. **The listener-registry row starts a session (step 9).** With deviation 1 a bare `new Menu()` registers nothing, so the row `make: () => new Menu()` would pass vacuously. The row shows a menu and calls the private `takeKeyboardFocus()` before the dispose.

12. **The test DOM cannot be installed once per file (`## Verification`).** `tests/setup/node-setup.ts` installs a fresh test DOM in a global `beforeEach` and resets it in a global `afterEach`, which would replace a `beforeAll` install before the first test ran. The new test file installs per test and removes every registration in its teardown instead: menus and opener disposed, timers run so a closed submenu's fade disposes it, `Menu._stopInputWatch()`, and `Tooltip._stopPointerWatch()` — a `Button` attaches a tooltip, and `Tooltip`'s static watch listens for `keydown` too.

13. **Two existing suites needed `Menu._stopInputWatch()` in their teardown.** `tests/component/table/ColumnResizeOutlineMode.test.ts` and `tests/unit/validation/FieldDecorator.pointerTooltip.test.ts` dispatch real `keydown` events to viewport listeners. Both build components that construct a `Menu`, whose session-long input watch pins the viewport `keydown` type across `DOM.reset()` exactly as `Tooltip`'s watch does; both already called `Tooltip._stopPointerWatch()` for that reason. No expectation changed.

14. **`aria-activedescendant` is also cleared when a menu rebuilds its rows.** The plan writes the attribute in `setFocusedIndex` only. `showAnchored` and `rebuildPersistentItems` reset `_focusedIndex` directly, so a re-show without a `hide()` in between (what `toggleFor()` does for a different opener) left the panel naming a disposed row. Both now clear it. Case `A4`.

15. **Demo.** The `#/misc` "Right-click me for context menu" menu gained a `More` submenu and a tooltip naming Shift+F10, so the demo shows the submenu keys. `MiscPanel.ts` is not in the plan's file table.

16. **More documentation, and one changed sentence.** `docs/concepts/layering.md` describes `CellEditor.retainsFocus` and gained a sentence for the new case; `docs/concepts/events.md` and the changelog's `Fixed` → `Core` describe deviation 2. The unreleased `Menu.handleKey` changelog entry said every rebuild-mode show starts with no row highlighted; it now says which ones do. The plan asked the new changelog entry to end with "No consumer action is needed."; it ends with that and two exceptions: code that calls `show()` for a dropdown whose trigger should keep focus has to move to `toggleFor()`, and a custom `CellEditor` that overrides `retainsFocus` has to keep the base class's answer. `docs/components/TableInternals.md` and `docs/recipes/crud-table.md` said an editor commits on blur and now name the exception. `ARCHITECTURE.md`'s event-handling section gained a paragraph on the two window-level listeners and their order, which is the lesson of deviations 1 and 2.

17. **Extra cases in the test file**, beyond `## Expected Behaviour` and the ones named above: `F9` (an action that moves focus keeps it, and nothing steals it back), `F1b`, `F3c`, `F8b`, `F10`, `F11`, `K8b` (a real `Escape`), `K11`, `S6`, `U9`–`U11`, `C2b`, `C4` (the session is recorded before the invoker's blur), `W2b`, `W6`, and `X1`–`X6`, which pin `SplitButton`, `MenuBar`, a pointer-opened menu and `handleKey` as unchanged.

### What differed on `master`

- **`MarkdownEditor.ts` needed no change**, as the plan said. On `master` the editor opens its menu at the `contextmenu` event's own coordinates; the caret-positioned menu is on the Markdown stack only. In Chromium a Shift+F10 `contextmenu` already carries the selection's position, so the menu opened at the selection.
- **`MV5`'s "the selection is unchanged after Cancel" does not hold on `master`.** After the Insert-link dialog is cancelled the caret is at the start of the document. A mouse-opened menu gives the same result, so this is the editor's behaviour on `master`, not this plan's; the stack carries the fix. The rest of `MV5` holds: the dialog's field has focus, and after Cancel the surface has it.
- **`MV6` has nothing to act on.** `master`'s editor menu has no dimmed `Clear formatting` row. A disabled row was verified on a `TextField` (`Copy` with no selection) and on a `TabBar` tab (`Close` on a tab that cannot close).
- **`MV17`** depends on a plan that has not landed.

### Verification that was run

Chromium 154, real key presses through chrome-devtools, on the worktree's demo dev server: `MV1`–`MV5` (see above for `MV5`), `MV7` (`CodeEditor` and the Markdown source mode), `MV8`–`MV10`, `MV11` up to `Paste`, `MV12`, `MV13` (including a `Close` that disposes the invoker tab), `MV15` in a 600 px window, `MV16`, inside a modal `Dialog`: `Enter`, `Tab` and `Escape`, with the element-level listener installed first; a row that opens a `Dialog.confirm`, in both listener orders; and `Tab` / `Shift+Tab` with `FocusTraversal` enabled, which land on the stop after / before the invoker.

**`Tab` from a dialog's last stop** (the plan asked for the result): with the menu opened on a text field that is the dialog's last tab stop, `Tab` closes the menu and focus leaves the dialog. It lands on `<body>`, and the next `Tab` moves to a control of the page behind the modal dialog; the dialog's trap does not pull it back. From any other stop, focus stays inside the dialog. The plan says not to add a trap to `Menu`, so this is as the plan left it; it deserves a follow-up plan. `MV14` was run with script-dispatched `pointerdown` / `contextmenu` / `click` events, since the tool has no right-click: the menu took no focus, showed no highlight, a real `ArrowDown` moved the field's caret, and a click on a row worked.

`MV14`'s `AutoCompleteField` case was run the same script-dispatched way: the suggestion list stayed open and the field kept focus.

Not run: Firefox and WebKit; `MV11`'s `Paste` and the clipboard contents after `Copy` (the clipboard-read permission prompt blocks automation); `MV18`; a real held `Enter` and a real Control-held right-click (the tool sends neither; both are covered by tests only).

### Left as they are

- **Shift+F10 on a `Table` cell or a `Tree` row still opens nothing** (the plan's first non-goal). It is a candidate for a follow-up plan.
- **A consumer's own `keydown` handler that calls `show()`** gets a keyboard session only if the input watch saw that key first, which depends on the listener order described in deviation 1. The plan's note that the watch "also covers a menu a consumer opens from a key handler" assumed an order the dispatcher does not fix. Shift+F10, the ContextMenu key and a button's `Enter` are not affected: the key press precedes the event that opens the menu. `Menu.md` and `show()`'s comment say the outcome is not guaranteed, and cases `W7` / `W7b` pin both.
- **The input watch keeps a viewport `pointerdown` listener for the life of the page.** On `master` only `LayerManager` registers one, and only while a layer is open. An application that builds a `Menu` (a `TextField` has one) before its first element-level `pointerdown` listener now runs viewport `pointerdown` listeners first. No effect was found.
- **The input watch has no time bound.** A `show()` made from a timer long after the user's last key press still takes focus. `Menu.md` and `show()`'s comment now say so.
- **`FocusHistory` records the menu panel**, as it records a dialog's contents: after the menu closes the panel's entry is pruned as stale and the invoker is left in the trail twice, so stepping back takes one extra press, and opening the menu drops the forward trail. `Dialog` has both effects on `master`. A fix belongs in `FocusHistory` (collapse the repeat when pruning) and would change it for dialogs too; not done here.
