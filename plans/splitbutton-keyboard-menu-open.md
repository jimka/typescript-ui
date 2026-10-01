---
touches-shared:
    - packages/lib/src/typescript/lib/overlay/Menu.ts
    - packages/lib/tests/overlay/Menu.test.ts
    - packages/lib/docs/components/Menu.md
    - packages/lib/docs/reference/changelog/next.md
---

# SplitButton Keyboard Menu Open — Implementation Plan

## Overview

[`SplitButton`](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L86)'s dropdown can only be opened with the mouse. The chevron is a non-focusable `Glyph` whose subtree `click` listener ([SplitButton.ts:156](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L156)) is the only path into `_toggleMenu` ([:235](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L235)). There is no keydown path, and the button carries no `aria-haspopup` or `aria-expanded`. The SQLAdmin consumer reported it (`sqladmin/LIBRARY_NOTES.md`, "`SplitButton`'s dropdown cannot be opened from the keyboard").

This plan makes the dropdown a keyboard-operable menu button. While the `SplitButton` has focus, `ArrowDown` or `Alt+ArrowDown` opens the menu and highlights its first item. While the menu is open, `ArrowUp` / `ArrowDown` move the highlight, `Enter` / `Space` activate the highlighted item, and `Escape` / `Tab` / `ArrowLeft` / `ArrowRight` close it. DOM focus never leaves the button, so it is on the button when the menu closes. The button exposes `aria-haspopup="menu"`, `aria-expanded` kept in sync with the menu, and `aria-controls` naming the menu.

The menu-side keyboard work goes into [`Menu`](packages/lib/src/typescript/lib/overlay/Menu.ts#L100). Its highlight methods (`focusItem`, `focusNext`, `focusPrev`, `activateFocused`, `getFocusedIndex`) are persistent-mode only today, and every rebuild-mode menu — the kind `SplitButton` uses — has no keyboard navigation at all. They become valid in both modes, and `Menu` gains a `handleKey(e)` forwarder. Rebuild-mode menus also gain `role="menu"`. The change ships in 0.11.0.

---

## Architecture Decisions

### Precedent: the host keeps DOM focus and forwards keys into its dropdown

`SplitButton` keeps DOM focus on its own `<button>` while the menu is open. It forwards keystrokes to the menu through a new `Menu.handleKey(e): boolean`. The menu shows a highlight on one row; it never takes DOM focus. This is the library's existing dropdown model:

- [`ComboBox.onKeyDown`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1174) opens its dropdown on `ArrowDown` and, while open, calls `this._dropdown.handleKey(e)` and returns `{ prevent: true }` when it returns `true`. [`ComboBoxDropdown.handleKey`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L248) documents the model: the host keeps DOM focus.
- [`AbstractPickerField.onKeyDown`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L528) does the same for the date/time pickers.
- [`MenuBar._onKeyDown`](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L106) drives a persistent `Menu`'s highlight through `focusItem` / `focusNext` / `focusPrev` / `activateFocused`. DOM focus stays in the bar.

Because DOM focus never moves, "return focus to the button on close" needs no code on the keyboard path.[^virtual-focus]

### There is no menu-button precedent to share

The search for an existing keyboard-openable menu button found none. [`MenuButton`](packages/lib/src/typescript/lib/component/button/MenuButton.ts#L50) opens only through its `"action"` (click, or native Enter/Space), sets no ARIA, and its rebuild-mode menu has no arrow keys. The ToolBar overflow trigger ([ToolBar.ts:775](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L775)) is the same. [`MenuBarButton`](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L157) sets `aria-haspopup="menu"` / `aria-expanded` but opens only on click. The reusable piece this plan adds is therefore `Menu.handleKey` plus both-mode highlight methods; `SplitButton` is the first caller.[^no-menubutton]

### ARIA mirrors `PopupButton`

`SplitButton` sets its ARIA exactly the way [`PopupButton`](packages/lib/src/typescript/lib/component/button/PopupButton.ts#L94) does for its panel:

| Moment | `PopupButton` | `SplitButton` |
|---|---|---|
| Constructor | `setHasPopup("dialog")`, `setExpanded(false)` ([:94-95](packages/lib/src/typescript/lib/component/button/PopupButton.ts#L94-L95)) | `setHasPopup("menu")`, `setExpanded(false)` |
| Overlay first created | `setControls(panel.getId())` ([:189](packages/lib/src/typescript/lib/component/button/PopupButton.ts#L189)) | `setControls(menu.getId())` |
| Open / close | `setExpanded(panel.isOpen())` / `setExpanded(false)` ([:214](packages/lib/src/typescript/lib/component/button/PopupButton.ts#L214), [:225](packages/lib/src/typescript/lib/component/button/PopupButton.ts#L225)) | `setExpanded(true)` before `toggleFor`, `setExpanded(false)` in the `onClose` callback |

The open state lives in one private flag, `_menuOpen`. `_setChevronOpen(open)` is renamed `_setMenuOpen(open)` and writes all three things that follow the open state: the flag, the chevron rotation, and `aria-expanded`. It keeps the existing "set optimistically, let `onClose` correct it" ordering in `_toggleMenu`.[^optimistic]

### Which keys open the menu

The menu opens on `ArrowDown` with no modifiers, or with `Alt` alone. Plain `ArrowDown` yields when the button's direct parent declares `aria-orientation="vertical"` — a vertical `ToolBar` uses `ArrowUp` / `ArrowDown` to move between its buttons. `Alt+ArrowDown` opens in every context.[^open-keys]

| Key | Direct parent | Result |
|---|---|---|
| `ArrowDown` | none, or a horizontal `ToolBar` | opens, first item highlighted; `{ stop: true, prevent: true }` |
| `Alt+ArrowDown` | anything, including a vertical `ToolBar` | opens, first item highlighted; `{ stop: true, prevent: true }` |
| `ArrowDown` | vertical `ToolBar` | not handled; no disposition, so the toolbar moves focus |
| `Ctrl+ArrowDown`, `Shift+ArrowDown`, `Meta+ArrowDown` | anything | not handled |
| `Ctrl+Alt+ArrowDown` | anything | not handled — `SpatialNavigation.claimsKey(e)` is checked first, as in `ComboBox` and `ToolBar` |

The parent check reads `this.getParentComponent()?.getAria().getOrientation() === "vertical"`. `ToolBar` writes `aria-orientation` on itself ([ToolBar.ts:301](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L301)), so `SplitButton` does not import `ToolBar`.[^parent-orientation]

### Keys while the menu is open

While `_menuOpen` is `true`, `SplitButton`'s keydown handler runs first on the button (exact-target listeners run before any ancestor's subtree listener, [Event.ts:337-357](packages/lib/src/typescript/lib/core/Event.ts#L337-L357)). A returned `stop` keeps the key away from an enclosing `ToolBar`.

| Key | Action | Disposition |
|---|---|---|
| `ArrowDown` | `menu.handleKey(e)` → highlight next row (from none: the first) | `{ stop: true, prevent: true }` |
| `ArrowUp` | `menu.handleKey(e)` → highlight previous row (from none: the last) | `{ stop: true, prevent: true }` |
| `Enter` | `menu.handleKey(e)` → activate the highlighted row, if any | `{ stop: true, prevent: true }` — suppresses the native click, so the primary `"action"` does not fire |
| `Space` | as `Enter`; also sets `_swallowSpaceUp` | `{ stop: true, prevent: true }`; the next `Space` keyup returns `{ prevent: true }` |
| `Tab`, `ArrowLeft`, `ArrowRight` | `menu.hide()` | none — the key continues, so Tab and the toolbar's roving keys move focus |
| `Escape` | nothing here | none — `LayerManager`'s Escape handler closes the topmost layer ([LayerManager.ts:872](packages/lib/src/typescript/lib/core/LayerManager.ts#L872)), and `onClose` updates the state |
| anything else | nothing | none |

`Space` needs the keyup step because a native `<button>` fires its click on the Space **keyup**, after the menu has already closed.[^space-keyup]

### `Menu.handleKey` covers the four navigation/activation keys only

`handleKey(e)` handles `ArrowDown` (`focusNext`), `ArrowUp` (`focusPrev`), and `Enter` / `" "` (`activateFocused`), and returns `true` for those four keys. It returns `false` for every other key, including `Escape`. `Enter` and `Space` return `true` even when no row is highlighted: the host holds DOM focus, and letting the key through would trigger the host's own activation.[^handlekey-scope]

### Highlight methods work in both modes; rebuild mode resets the highlight per show

`focusItem`, `focusNext`, `focusPrev`, `activateFocused` and `getFocusedIndex` drop their `assertPersistentMode` guard. The methods only read `_menuItems` and `_focusedIndex`, which rebuild mode already fills in `showAnchored`. Two resets keep the index valid in rebuild mode:

- `showAnchored` sets `_focusedIndex = -1` where it clears `_menuItems` — the same pairing `rebuildPersistentItems` already does ([Menu.ts:1005-1006](packages/lib/src/typescript/lib/overlay/Menu.ts#L1005-L1006)).
- `hide()` calls `this.setFocusedIndex(-1)`.

`open`, `close` and `setExcludedElement` stay persistent-only.[^both-modes]

### Rebuild-mode menus declare `role="menu"`

`applyRebuildChrome` adds `this.getAria().setRole("menu")`, the call `applyPersistentChrome` already makes ([Menu.ts:919](packages/lib/src/typescript/lib/overlay/Menu.ts#L919)). `aria-haspopup="menu"` requires the popup to be a `menu`, and the rebuild-mode rows are already `menuitem`s.[^role-menu]

---

## Public API

```typescript
// overlay/Menu.ts — class Menu extends Component implements DismissableLayer

/** New. Valid in both modes. */
handleKey(e: KeyboardEvent): boolean;

/** Existing signatures, now valid in both modes (guard removed). */
focusItem(index: number): this;
focusNext(): this;
focusPrev(): this;
activateFocused(): void;
getFocusedIndex(): number;
```

`SplitButton`'s public surface does not change. Its new state is private:

| Field | Type | Written by | Notes |
|---|---|---|---|
| `_menuOpen` | `boolean`, initializer `= false` | `_setMenuOpen` only | Never written during the `super()` cascade, so a plain initializer is safe. |
| `_swallowSpaceUp` | `boolean`, initializer `= false` | `_handleOpenMenuKey`, `_onKeyUp` | Same. |
| `_onKeyDown` | `readonly (e: KeyboardEvent) => Event.ListenerResult` | field initializer | Arrow field delegating to `_handleKeyDown`, like `_onChevronClick`. |
| `_onKeyUp` | `readonly (e: KeyboardEvent) => Event.ListenerResult` | field initializer | Arrow field with the Space-swallow body. |

---

## Implementation

`Menu.handleKey`:

```typescript
handleKey(e: KeyboardEvent): boolean {
    switch (e.key) {
        case "ArrowDown":
            this.focusNext();

            return true;

        case "ArrowUp":
            this.focusPrev();

            return true;

        case "Enter":
        case " ":
            this.activateFocused();

            return true;
    }

    return false;
}
```

`SplitButton` keyboard handling (private methods; JSDoc each per the code conventions):

```typescript
private readonly _onKeyDown: (e: KeyboardEvent) => Event.ListenerResult = (e) => this._handleKeyDown(e);

private readonly _onKeyUp: (e: KeyboardEvent) => Event.ListenerResult = (e) => {
    if (e.key !== " " || !this._swallowSpaceUp) {
        return;
    }

    this._swallowSpaceUp = false;

    return { prevent: true };
};

private _handleKeyDown(e: KeyboardEvent): Event.ListenerResult {
    const claimed = SpatialNavigation.claimsKey(e);

    if (claimed) {
        return;
    }

    if (this._menuOpen) {
        return this._handleOpenMenuKey(e);
    }

    const opens = this._isOpenMenuKey(e);

    if (!opens) {
        return;
    }

    this._openMenuFromKeyboard();

    return { stop: true, prevent: true };
}

private _handleOpenMenuKey(e: KeyboardEvent): Event.ListenerResult {
    const menu = this._menu!;

    if (e.key === "Tab" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        menu.hide();

        return;
    }

    const consumed = menu.handleKey(e);

    if (!consumed) {
        return;
    }

    if (e.key === " ") {
        this._swallowSpaceUp = true;
    }

    return { stop: true, prevent: true };
}

private _isOpenMenuKey(e: KeyboardEvent): boolean {
    if (e.key !== "ArrowDown" || e.ctrlKey || e.shiftKey || e.metaKey) {
        return false;
    }

    if (e.altKey) {
        return true;
    }

    const parentOrientation = this.getParentComponent()?.getAria().getOrientation() ?? null;

    return parentOrientation !== "vertical";
}

private _openMenuFromKeyboard(): void {
    this._toggleMenu();

    // `_toggleMenu` leaves `_menuOpen` false when it opened nothing
    // (unattached button, or no items). A fresh show resets the highlight
    // to -1, so `focusNext` lands on the first navigable row.
    if (this._menuOpen) {
        this._menu!.focusNext();
    }
}
```

Every call's result is assigned to a variable before an `if` tests it, per the maintainer's rule against calls inside an `if` condition.

Tests call `_onKeyDown` / `_onKeyUp` with plain objects (`{ key: 'ArrowDown' } as KeyboardEvent`), as `ToolBar.test.ts` does. Missing modifier fields are then `undefined`, so the checks above must stay truthiness tests (`e.altKey`, `!e.ctrlKey`), never `=== false`.

`_toggleMenu` after the change (only the marked lines differ from [SplitButton.ts:235-258](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L235-L258)):

```typescript
private _toggleMenu(): void {
    const el = this.getElement();
    if (!el) {
        return;
    }

    const rect = DOM.source.getViewportRect(this);

    if (this._menu === null) {                                    // changed
        this._menu = new Menu();                                  // changed
        this.getAria().setControls(this._menu.getId());           // new
    }

    this._setMenuOpen(true);                                      // renamed

    this._menu.toggleFor(
        this._chevron.getElement(true)!,
        rect,
        this._menuItems,
        () => { this._setMenuOpen(false); }                       // renamed
    );
}

private _setMenuOpen(open: boolean): void {
    this._menuOpen = open;
    this._chevron.setTransform(open ? "rotate(180deg)" : "rotate(0deg)");
    this.getAria().setExpanded(open);
}
```

---

## Ordered Implementation Steps

1. **`Menu.ts` — highlight methods in both modes.** In [overlay/Menu.ts](packages/lib/src/typescript/lib/overlay/Menu.ts), delete the `this.assertPersistentMode(...)` line from `focusItem` (L791), `focusNext` (L803), `focusPrev` (L829), `activateFocused` (L855) and `getFocusedIndex` (L875). Remove "**Persistent-mode only.**" from those five JSDoc blocks. Check: `grep -n 'assertPersistentMode("' packages/lib/src/typescript/lib/overlay/Menu.ts` lists only `open`, `close` and `setExcludedElement`.
2. **`Menu.ts` — reset the highlight per rebuild-mode show and hide.** In `showAnchored`, add `this._focusedIndex = -1;` directly after `this._menuItems = [];` (L330). In `hide()`, add `this.setFocusedIndex(-1);` after `this.closeOpenSubmenu();`.
3. **`Menu.ts` — `handleKey`.** Add the public `handleKey(e: KeyboardEvent): boolean` from `## Implementation`, placed after `getFocusedIndex`. Its JSDoc states: valid in both modes; the host keeps DOM focus and forwards keys; the four handled keys; `Enter` / `Space` return `true` even with no highlighted row; `Escape` returns `false` because `LayerManager` closes the menu. Mention that it mirrors the dropdown `handleKey` forwarders in prose, not with a `{@link}` to a non-exported symbol.
4. **`Menu.ts` — `role="menu"` in rebuild mode.** In `applyRebuildChrome` (L926), add `this.getAria().setRole("menu");`. Update that method's JSDoc to "(right-click context-menu CSS variables, aria role)".
5. **`Menu.ts` — class JSDoc.** Replace the sentence at L74 ("`open()` / `close()` / focus and submenu methods are valid only in persistent mode.") with: "`open()` / `close()` / `setExcludedElement()` are valid only in persistent mode. The keyboard-highlight methods (`focusItem`, `focusNext`, `focusPrev`, `activateFocused`, `getFocusedIndex`, `handleKey`) work in both."
6. **`Menu.test.ts` — update the mode-guard test.** In `describe('Menu mode guards')` ([Menu.test.ts:66](packages/lib/tests/overlay/Menu.test.ts#L66)), delete the two lines expecting `menu.focusNext()` and `menu.getFocusedIndex()` to throw on a rebuild-mode menu. Keep the `open` / `close` lines.
7. **`Menu.test.ts` — new rebuild-mode keyboard tests.** Add `describe('Menu keyboard highlight and handleKey')` covering cases M1–M11 of `## Expected Behaviour`. Open menus with `menu.toggleFor(DOM.sink.createElement('div'), rect(100, 100, 200, 124), configs)`, as the `Menu rect-anchored toggleFor` block does. Run `npx vitest run tests/overlay/Menu.test.ts` from `packages/lib`; all green.
8. **`SplitButton.ts` — imports and fields.** Add `import { SpatialNavigation } from "~/core/SpatialNavigation.js";`. `Event` is already imported. Add `_menuOpen`, `_swallowSpaceUp`, `_onKeyDown`, `_onKeyUp` as in `## Public API`, each with a one-line comment.
9. **`SplitButton.ts` — rename and extend the open-state writer.** Rename `_setChevronOpen` to `_setMenuOpen` and give it the body from `## Implementation`. Update its JSDoc to name all three writes. Change `_toggleMenu` as shown (lazy creation sets `aria-controls`; both `_setChevronOpen` calls become `_setMenuOpen`). Check: `grep -n '_setChevronOpen' packages/lib/src/typescript/lib/component/button/SplitButton.ts packages/lib/tests` — zero matches.
10. **`SplitButton.ts` — constructor wiring.** After the existing `Event.addSubtreeListener(this._chevron, "click", this._onChevronClick);` (L156), add:
    ```typescript
    this.getAria().setHasPopup("menu");
    this.getAria().setExpanded(false);

    Event.addListener(this, "keydown", this._onKeyDown);
    Event.addListener(this, "keyup",   this._onKeyUp);
    ```
    `Button` already registers its own `keydown` / `keyup` listeners on the same element ([Button.ts:855-856](packages/lib/src/typescript/lib/component/button/Button.ts#L855-L856)); both sets run, in registration order.
11. **`SplitButton.ts` — key handlers.** Add `_handleKeyDown`, `_handleOpenMenuKey`, `_isOpenMenuKey` and `_openMenuFromKeyboard` from `## Implementation`, each with JSDoc. Add a paragraph at the end of the class JSDoc (after the `ToolBar` paragraph, before `@example`) describing the keyboard contract and ARIA in two or three sentences. Do not edit the first paragraph — `llms.txt` is generated from it.
12. **`SplitButton.test.ts` — tests.** Add `describe('SplitButton keyboard and ARIA')` covering cases S1–S17 of `## Expected Behaviour`. Attach with `btn.getElement(true)` as the existing "chevron with no menuItems" test does. For S13–S14, build a `ToolBar` (`new ToolBar({ orientation: 'vertical' })` / default) and `addComponent(btn)` before keying. For S15, `vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true)` and restore in `afterEach`. Run `npx vitest run tests/component/button/SplitButton.test.ts` from `packages/lib`; all green.
13. **Docs — `SplitButton.md`.** In [docs/components/SplitButton.md](packages/lib/docs/components/SplitButton.md), add a `## Keyboard` section after `## Dropdown items`. It holds the open-keys table and the open-menu keys table from `## Architecture Decisions` (consumer wording, no dispositions), states that focus stays on the button, and lists the ARIA attributes. Update the first paragraph's "clicking the chevron zone instead opens" to "clicking the chevron zone — or pressing `Alt+↓` / `↓` — opens". In `## In a flat toolbar`, add one sentence: in a vertical toolbar plain `↓` moves between toolbar buttons, so use `Alt+↓`.
14. **Docs — `Menu.md`.** In [docs/components/Menu.md](packages/lib/docs/components/Menu.md#L8), rewrite the "two API surfaces are disjoint" paragraph to match step 5. Add a short `## Keyboard` section: a host that keeps DOM focus forwards keys through `handleKey(e)`; list the four keys and the return contract. In the item-config table, change the `action` row to "Called on click, or on Enter / Space when the row is highlighted (`activateFocused` / `handleKey`)."
15. **Docs — accessibility role table.** In [docs/concepts/accessibility.md](packages/lib/docs/concepts/accessibility.md#L45), add a row after `Button`: `| [`SplitButton`](/components/SplitButton) | native `<button>` with `aria-haspopup="menu"`, `aria-expanded` and `aria-controls` |`.
16. **Changelog.** In [docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md): under `## Fixed` → `### Components` add a **`SplitButton`'s dropdown opens from the keyboard** entry (keys, focus stays on the button, ARIA, vertical-toolbar rule). Under `## Fixed` → `### Overlay` add **rebuild-mode `Menu`s declare `role="menu"`**. Under `## Added` add a `### Overlay` subsection after `### Layouts` with **`Menu.handleKey(e)`, and the highlight methods work in rebuild mode** (previously they threw). End each entry with "No consumer action is needed." where true.
17. **Full checks.** Run the commands in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/SplitButton.ts` |
| Modify | `packages/lib/tests/overlay/Menu.test.ts` |
| Modify | `packages/lib/tests/component/button/SplitButton.test.ts` |
| Modify | `packages/lib/docs/components/SplitButton.md` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases below are unit-testable with the offline `TestDOM` unless marked **manual**. "Open" means `LayerManager.getTopLayer()` is the button's menu; "closed" means it is `null`. Items used unless stated: `[{ text: 'A', action: a }, { separator: true }, { text: 'B', action: b }]`.

**Menu** (rebuild mode unless stated)

| # | Setup | Action | Expected |
|---|---|---|---|
| M1 | `new Menu()` | `getAria().getRole()` | `'menu'` |
| M2 | rebuild menu, not shown | `focusNext()`, `getFocusedIndex()` | no throw |
| M3 | shown via `toggleFor` | `getFocusedIndex()` | `-1` |
| M4 | shown | `handleKey({key:'ArrowDown'})` twice | returns `true` both times; index `0`, then `2` (separator skipped) |
| M5 | shown, index `-1` | `handleKey({key:'ArrowUp'})` | `true`; index `2` (wraps to last) |
| M6 | shown, index `0` | `handleKey({key:'Enter'})` | `true`; `a` called once; menu hidden (top layer `null`) |
| M7 | shown, index `-1` | `handleKey({key:' '})` | `true`; no action called; menu still shown |
| M8 | shown | `handleKey` with `'Escape'`, `'a'`, `'Tab'` | each returns `false`; index unchanged |
| M9 | shown, index `2`; then shown again via `toggleFor` for a different opener | `getFocusedIndex()` | `-1` |
| M10 | shown, index `0` | `hide()` then `getFocusedIndex()` | `-1` |
| M11 | persistent menu | `handleKey({key:'ArrowDown'})` | `true`; index `0` (works in both modes) |

**SplitButton**

| # | Setup | Action | Expected |
|---|---|---|---|
| S1 | `new SplitButton('Save')` | read ARIA | `getHasPopup()` `'menu'`; `getExpanded()` `false` |
| S2 | attached, items | `_onKeyDown({key:'ArrowDown'})` | returns `{ stop: true, prevent: true }`; open; menu `getFocusedIndex()` `0`; `getExpanded()` `true`; chevron `getTransform()` `'rotate(180deg)'` |
| S3 | attached, items | `_onKeyDown({key:'ArrowDown', altKey:true})` | same as S2 |
| S4 | attached, items `[{separator:true}, {text:'A'}]` | ArrowDown | open; `getFocusedIndex()` `1` |
| S5 | attached, no items | ArrowDown | returns `{ stop: true, prevent: true }`; closed; `getExpanded()` `false`; chevron `'rotate(0deg)'` |
| S6 | not attached | ArrowDown | no throw; `getExpanded()` `false` |
| S7 | open via S2 | ArrowDown, then ArrowUp | index `2`, then `0`; each returns stop+prevent |
| S8 | open via S2 | `_onKeyDown({key:'Enter'})` | returns stop+prevent; `a` called once; closed; `getExpanded()` `false` |
| S9 | open via S2 | `_onKeyDown({key:' '})`, then `_onKeyUp({key:' '})` twice | keydown returns stop+prevent and calls `a`; first keyup returns `{ prevent: true }`; second keyup returns `undefined` |
| S10 | open via S2 | `_onKeyDown({key:'Escape'})` | returns `undefined`; still open (LayerManager owns Escape). Then `menu.requestClose()` → closed, `getExpanded()` `false` |
| S11 | open via S2 | `_onKeyDown({key:'Tab'})` | returns `undefined`; closed; `getExpanded()` `false` |
| S12 | open via S2 | `_onKeyDown({key:'ArrowRight'})` | returns `undefined`; closed |
| S13 | in `ToolBar({orientation:'vertical'})`, attached, items | plain ArrowDown | returns `undefined`; closed. Alt+ArrowDown → open |
| S14 | in default (horizontal) `ToolBar`, attached, items | plain ArrowDown | open |
| S15 | attached, items; `SpatialNavigation.claimsKey` mocked `true` | ArrowDown | returns `undefined`; closed |
| S16 | attached, items | `_onKeyDown` with `{key:'ArrowDown', ctrlKey:true}`, then `shiftKey:true`, then `metaKey:true` | each returns `undefined`; closed |
| S17 | attached, items | `_toggleMenu()` twice | after first: open, `getExpanded()` `true`, `getControls()` equals the menu's `getId()`; after second: closed, `getExpanded()` `false` |

**Manual (real browser)** — the offline harness has no native button activation, focus, or screen reader:

- MV1: Tab to the SplitButton on the docs `SplitButton` page; `↓` opens with the first row highlighted; focus ring stays on the button.
- MV2: With the menu open, `Enter` runs the highlighted row and does **not** fire the primary "Save" action. Same for `Space`. Check in Chrome and Firefox.
- MV3: `Escape` closes the menu and focus is still on the button (a second `↓` reopens it).
- MV4: In the `ToolBarPanel` demo (`npm run dev`), focus the Save split button; `↓` opens; with the menu open, `→` closes it and moves focus to the next toolbar button.
- MV5: Mouse-open the chevron, then press `↓`: the first row highlights.
- MV6 (optional): a screen reader announces the button as having a menu popup, collapsed/expanded.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — whole suite green, including M1–M11 and S1–S17.
- `npm run lint` — clean (the `local/no-raw-dom` baseline is unchanged; no raw DOM is added).
- `grep -n '_setChevronOpen' -r packages/lib/src packages/lib/tests` — zero matches.
- `npm run docs:api` — zero warnings. The new `Menu.handleKey` JSDoc must not `{@link}` a non-exported symbol.
- `npm run docs:llms:check && npm run docs:llms` — `packages/lib/llms.txt` unchanged (step 11 leaves the class summary alone). If it does change, commit the regenerated file.
- Manual MV1–MV5 via `npm run docs:dev` (SplitButton page) and `npm run dev` (`ToolBarPanel`).

---

## Documentation Impact

- `SplitButton` and `Menu` are already exported (`component/button` and `overlay` barrels); no barrel change.
- Pages updated: `docs/components/SplitButton.md`, `docs/components/Menu.md`, `docs/concepts/accessibility.md`, `docs/reference/changelog/next.md` (steps 13–16).
- The API reference picks up `Menu.handleKey` and the changed JSDoc through `npm run docs:api`.
- `docs/components/MenuButton.md` is untouched: `MenuButton` does not change.

---

## Potential Challenges

- **Native Space activation.** A `<button>` fires its click on Space keyup; if a browser ignores the keyup `preventDefault`, the primary action would fire after a Space activation. Mitigation: MV2 checks Chrome and Firefox. If either still fires the primary action, stop and report it with the browser name rather than adding a workaround.
- **Hover and keyboard highlights can both show.** `MenuItem` highlights itself on mouseover independently of `_focusedIndex`, as it already does in `MenuBar` menus. Mitigation: none needed for this plan; it is existing behaviour.
- **`FocusTraversal` with a menu open.** When enabled, it scopes Tab to the topmost layer (the menu). `SplitButton` hides the menu on the same Tab keydown, so either listener order ends with Tab leaving the button normally. Mitigation: MV1 with `FocusTraversal.enable()` is optional; no code change expected.
- **Cross-plan overlap.** `touches-shared` lists `Menu.ts`, its test and docs, and `next.md`; `next.md` is edited by most in-flight branches. Mitigation: append entries inside the existing subsections and resolve any merge conflict by keeping both sides.

---

## Critical Files

- [component/button/SplitButton.ts](packages/lib/src/typescript/lib/component/button/SplitButton.ts) — the class being changed.
- [overlay/Menu.ts](packages/lib/src/typescript/lib/overlay/Menu.ts) — `toggleFor`, `showAnchored`, `hide`, the highlight methods, `applyRebuildChrome`.
- [component/button/PopupButton.ts](packages/lib/src/typescript/lib/component/button/PopupButton.ts) — ARIA precedent (`setHasPopup` / `setExpanded` / `setControls`).
- [component/input/ComboBox.ts](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1174) — host-keeps-focus `onKeyDown` + `handleKey` precedent.
- [component/menubar/MenuBar.ts](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L106) — how a host drives `focusNext` / `focusPrev` / `activateFocused`.
- [component/menubar/ToolBar.ts](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L191) — roving keydown handler and `aria-orientation`.
- [core/Event.ts](packages/lib/src/typescript/lib/core/Event.ts#L312) — exact-target listeners run before subtree listeners; return-disposition protocol.
- [component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts#L681) — `_onSpaceDown` / `_onSpaceUp` on the same element.
- [tests/component/menubar/ToolBar.test.ts](packages/lib/tests/component/menubar/ToolBar.test.ts#L148) — pattern for calling a private key handler with a plain object.

---

## Non-Goals

- **`MenuButton` and the ToolBar overflow trigger.** They have the same missing keyboard path, but the report and request cover `SplitButton` only. `Menu.handleKey` is the piece either would reuse.
- **`MenuBar` adopting `handleKey`.** Its own switch keeps working unchanged; rewiring it is an unrelated refactor.
- **Home / End / type-ahead in menus**, and **opening a submenu with `ArrowRight`**. Not requested; `MenuBar` has neither.
- **Screen-reader announcement of the highlighted row.** With DOM focus on a `<button>`, `aria-activedescendant` is not supported; `MenuBar` has the same gap. The button's `aria-haspopup` / `aria-expanded` are announced.
- **Returning focus after a pointer activation.** A mouse press on a row moves focus off the button in every existing menu; forcing it back could steal focus from a dialog the row's action opened.[^pointer-focus]

---

## Notes

[^virtual-focus]: Moving real DOM focus into the menu rows (the WAI-ARIA APG's reference implementation) was rejected. No menu row is focusable today (`MenuItem` has no `tabindex`), and the library's existing dropdowns — `ComboBox`, the pickers, `AutoCompleteField`, `MenuBar` — all keep focus on the host. Switching models for one component would need focus plumbing on every row and a separate focus-restore path, and `ComboBoxDropdown.handleKey`'s JSDoc records a concrete failure mode of programmatic focus moves inside nested hosts.

[^no-menubutton]: Searched: `MenuButton.ts`, `PopupButton.ts`, `MenuBarButton.ts`, `MenuBar.ts`, `ToolBar.ts`'s overflow trigger, and every `toggleFor(` / `.show(` caller of `Menu`, plus `"ArrowDown"`, `focusItem(`, `altKey` across `lib/`. The only keyboard driver of a `Menu` is `MenuBar`, and it only navigates a menu already opened by click. `PopupButton` is the only button that sets `aria-expanded` from its own open/close cycle, so its ARIA shape is the one mirrored.

[^optimistic]: `Menu.toggleFor` is the single source of truth for open-versus-close, and it reports "closed" only through `onClose` (toggle-shut, empty list, outside click, Escape, window blur, item activation). Setting the state to open before the call and letting `onClose` correct it is the ordering `_toggleMenu` already uses for the chevron rotation, so routing `aria-expanded` and `_menuOpen` through the same writer keeps all three in step on every path without asking `Menu` whether it is open.

[^open-keys]: WAI-ARIA APG's menu-button pattern lists `Enter`, `Space` and (optionally) `ArrowDown` as opening keys. On a split button `Enter` / `Space` already belong to the primary action, so the platform convention for the secondary dropdown is `Alt+ArrowDown` (Windows split buttons, native `<select>`); the consumer report also suggested both. The vertical-toolbar exception follows the APG toolbar guidance that a vertical toolbar owns `ArrowUp` / `ArrowDown`: capturing plain `ArrowDown` there would stop roving navigation at the SplitButton.

[^parent-orientation]: Alternatives rejected: `instanceof ToolBar` (imports a `menubar` class into `button` and misses any other vertical composite); a new ToolBar-to-child hook (edits `ToolBar.ts`, which an unrelated in-flight branch, `toolbar-arrow-keys-yield-to-text-entry`, is also changing); plain `ArrowDown` everywhere (traps vertical-toolbar navigation). `aria-orientation` is the ARIA statement of exactly "this composite uses this arrow axis", and `ToolBar` already maintains it. Only the direct parent is checked because `ToolBar` adds only its direct children to its roving group ([ToolBar.ts:554-558](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L554-L558)).

[^space-keyup]: In Chromium and Firefox a `<button>`'s Space activation is dispatched from the keyup's default action; Enter's is dispatched during keydown/keypress, so preventing the keydown is enough for Enter but not for Space. The menu row's action runs on keydown and closes the menu, so by keyup `_menuOpen` is already `false` — hence a one-shot flag rather than a check of the open state. `Button`'s own `_onSpaceDown` / `_onSpaceUp` pressed-state listeners still run (same element, all listeners fire), so the button briefly shows pressed as it would for any Space press.

[^handlekey-scope]: Escape is left out because `LayerManager` already closes the topmost layer on Escape through `requestClose` → `hide` → `onClose`, which is the path that updates the opener; handling it in `handleKey` too would close twice. This mirrors `AbstractSelectableList.handleKey`, which also leaves Escape to the host. Home/End and type-ahead are out of scope (see `## Non-Goals`).

[^both-modes]: The persistent-only guard on the highlight methods came from the `consolidate-menu` merge, when only `MenuBar` drove keyboard navigation; nothing in rebuild mode depends on them throwing. The only test asserting the throw is the mode-guard test updated in step 6. `open` / `close` / `setExcludedElement` stay guarded because rebuild mode has its own `show` / `toggleFor` / `hide` and excluded-element handling.

[^role-menu]: Every rebuild-mode menu (context menus, `MenuButton`, the ToolBar overflow, `SplitButton`) currently renders `menuitem` rows inside an element with no role, which is invalid ARIA. `docs/concepts/accessibility.md` already claims `Menu` has role `menu`; this makes that true for both modes.

[^pointer-focus]: `Menu` runs a row's `action` before `hide()` fires `onClose`. A row whose action opens a `Dialog` (SQLAdmin's "Save as…") hands focus to that dialog; an unconditional `focus()` in `onClose` could take it back. The keyboard path — the one this plan fixes — never moves focus, so no restore is needed there.
