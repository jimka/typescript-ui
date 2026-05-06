# Menu Bar — Implementation Plan

## Overview

This plan describes a `MenuBar` + `MenuPanel` + `MenuItem` component hierarchy for the framework. The design builds fresh rather than extending `ContextMenu`, but models its patterns closely.

---

## 1. Architecture Decision: Reuse vs. Fresh Build

**Decision: Build fresh, modelled on `ContextMenu` patterns.**

`ContextMenu` is a single-level, ephemeral overlay driven by an imperative `show(x, y, items[])` call. It disposes and rebuilds its item components on every open. A `MenuBar` requires:
- A persistent top-level bar (lives in the DOM, not a floating overlay).
- Dropdown panels that are long-lived — they must survive switching between menus without full rebuilds.
- Two-level keyboard focus (bar items + open panel items).
- Nested submenu panels.

Reusing `ContextMenu` by subclassing would mean fighting its rebuild-on-show lifecycle and its append-to-`document.documentElement` strategy. Three distinct new component types are introduced instead:

- `MenuBar` — the horizontal bar.
- `MenuPanel` — the floating vertical panel.
- `MenuItem` / `MenuSeparator` — the items inside a `MenuPanel`.

`ContextMenu`, `ContextMenuItem`, and `ContextMenuSeparator` are **not modified**.

---

## 2. New Files

### `Base/component/menubar/MenuBar.ts`

The top-level container. Extends `Component`. Uses an `HBox` layout manager with zero spacing to arrange `MenuBarButton` children. Owns the open/close state machine: which menu (if any) is currently open, and whether "quick-switch" mode is active (when any dropdown is open, hovering another top-level button switches immediately).

### `Base/component/menubar/MenuBarButton.ts`

A single top-level button in the bar (e.g. "File", "Edit"). Extends `Component`. Renders as a flat button-like element — no `Button` inheritance because `Button` has a ridge border and shadow which are wrong for a bar item. Has its own `:hover` CSS rule via `CSS.createComponentRule`. Communicates open/close intent back to `MenuBar` via callbacks passed at construction.

### `Base/component/menubar/MenuPanel.ts`

The floating vertical dropdown panel. Extends `Component`, positioned absolute, appended to `document.documentElement` (same strategy as `ContextMenu`). Uses a `VBox` layout manager with zero spacing. Items are constructed once in the constructor and reused across open/close cycles (no rebuild-on-open). Manages its own open/close lifecycle, viewport mousedown listener for outside-click-to-close, and hover-driven submenu opening.

### `Base/component/menubar/MenuItem.ts`

A single row in a `MenuPanel`. Extends `Component`. Stores label text, enabled state, optional shortcut hint string, optional icon text, and optionally a child `MenuPanel` for submenus. A submenu-bearing `MenuItem` renders a trailing chevron (`▶`). Has `dispose()` that removes its Event listeners.

### `Base/component/menubar/MenuSeparator.ts`

Identical in structure to `ContextMenuSeparator` but references `--ts-ui-menu-bar-separator-color` so theme tokens can differ from context menus.

---

## 3. Existing Files to Modify

### `Base/Theme.ts`
Add a `menuBar` section to the `Theme` interface. Add values to `DefaultTheme`, `DarkTheme`, and `themeToVars`.

### `Base/index.ts`
Export `MenuBar`, `MenuBarButton`, `MenuPanel`, `MenuItem`, `MenuSeparator`, `MenuItemConfig`, and `MenuConfig`.

---

## 4. Full Public API

### Interfaces

```typescript
/** Describes a leaf action item or separator. */
export interface MenuItemConfig {
    /** Display label. */
    text: string;
    /** Called when the item is activated (click or Enter). */
    action?: () => void;
    /** Defaults to true. Disabled items are dimmed and non-interactive. */
    enabled?: boolean;
    /** Keyboard shortcut hint displayed on the right (e.g. "Ctrl+S"). */
    shortcut?: string;
    /** Icon/glyph displayed on the left. */
    icon?: string;
    /** When present, this item opens a submenu rather than calling action. */
    submenu?: MenuConfig;
    /** When true, renders as a MenuSeparator; all other fields ignored. */
    separator?: true;
}

/** Describes one top-level menu entry in the bar. */
export interface MenuConfig {
    /** Label shown in the bar button (e.g. "File"). */
    label: string;
    /** Ordered list of items in the dropdown. */
    items: MenuItemConfig[];
}
```

### `MenuBar`

```typescript
export class MenuBar extends Component {
    /**
     * Constructs an empty MenuBar.
     */
    constructor();

    /**
     * Replaces the current set of top-level menus.
     * Disposes existing MenuBarButtons and rebuilds them.
     *
     * @param menus - Ordered list of top-level menu descriptors.
     */
    setMenus(menus: MenuConfig[]): void;

    /**
     * Programmatically opens the menu at the given index.
     *
     * @param index - Zero-based index into the menus array.
     */
    openMenu(index: number): void;

    /**
     * Closes the currently open menu, if any.
     */
    closeMenu(): void;

    /**
     * Returns the index of the currently open menu, or -1 if none is open.
     *
     * @returns The open menu index, or -1.
     */
    getOpenIndex(): number;
}
```

### `MenuPanel`

```typescript
export class MenuPanel extends Component {
    /**
     * Constructs a MenuPanel with the given items.
     *
     * @param items - The menu item configurations.
     * @param onClose - Callback invoked when the panel is closed.
     */
    constructor(items: MenuItemConfig[], onClose: () => void);

    /**
     * Opens this panel positioned directly below the given anchor element.
     * Appended to document.documentElement; clamped to viewport.
     *
     * @param anchorEl - The HTMLElement of the triggering MenuBarButton.
     * @param parentPanel - Optional parent MenuPanel, used for submenu positioning.
     */
    open(anchorEl: HTMLElement, parentPanel?: MenuPanel): void;

    /**
     * Closes this panel and any open child submenus. Removes from DOM.
     */
    close(): void;

    /**
     * Moves keyboard focus to the item at the given index.
     *
     * @param index - Zero-based item index; -1 means no focus.
     */
    focusItem(index: number): void;

    /**
     * Moves focus to the next focusable item (wraps around).
     */
    focusNext(): void;

    /**
     * Moves focus to the previous focusable item (wraps around).
     */
    focusPrev(): void;

    /**
     * Activates the currently focused item.
     */
    activateFocused(): void;

    /**
     * Returns the index of the currently focused item, or -1.
     *
     * @returns The focused item index, or -1.
     */
    getFocusedIndex(): number;

    /**
     * Disposes all MenuItem children.
     */
    dispose(): void;
}
```

### `MenuItem`

```typescript
export class MenuItem extends Component {
    /** Fixed height for all menu items, in pixels. */
    static readonly HEIGHT: number; // 24

    /**
     * Constructs a MenuItem.
     *
     * @param config - The item configuration.
     * @param onActivate - Called when this item is activated.
     * @param onOpenSubmenu - Called when this item's submenu should open.
     */
    constructor(
        config: MenuItemConfig,
        onActivate: () => void,
        onOpenSubmenu: (item: MenuItem) => void
    );

    /** Returns true if this item has a submenu. */
    hasSubmenu(): boolean;

    /** Returns the submenu config, or null. */
    getSubmenuConfig(): MenuConfig | null;

    /** Applies the focused visual state (background highlight). */
    setFocused(focused: boolean): void;

    /** Returns whether this item is a separator. */
    isSeparator(): boolean;

    /** Returns whether this item is enabled. */
    isEnabled(): boolean;

    /**
     * Removes Event listeners registered by this item.
     */
    dispose(): void;
}
```

### Caller example

```typescript
const bar = new MenuBar();
bar.setMenus([
    {
        label: 'File',
        items: [
            { text: 'New',    shortcut: 'Ctrl+N', action: () => newDoc() },
            { text: 'Open…',  shortcut: 'Ctrl+O', action: () => open() },
            { separator: true },
            { text: 'Save',   shortcut: 'Ctrl+S', action: () => save(), enabled: false },
            { text: 'Export', submenu: {
                label: 'Export',
                items: [
                    { text: 'As PDF',  action: () => exportPdf()  },
                    { text: 'As HTML', action: () => exportHtml() },
                ]
            }},
        ]
    },
    {
        label: 'Edit',
        items: [
            { text: 'Undo', shortcut: 'Ctrl+Z', action: () => undo() },
            { text: 'Redo', shortcut: 'Ctrl+Y', action: () => redo() },
        ]
    },
]);

myContainer.addComponent(bar);
```

---

## 5. Theme Tokens

Add a `menuBar` section to `Theme`:

```typescript
menuBar: {
    background: string;
    border: string;
    button: {
        background     : string;
        hoverBackground: string;
        foreground     : string;
    };
    panel: {
        background: string;
        border    : string;
        shadow    : string;
        minWidth  : string;
    };
    item: {
        height          : string;
        hoverBackground : string;
        disabledColor   : string;
        shortcutColor   : string;
    };
    separatorColor: string;
};
```

CSS custom properties added to `themeToVars`:

| Property | Token path |
|---|---|
| `--ts-ui-menu-bar-bg` | `menuBar.background` |
| `--ts-ui-menu-bar-border` | `menuBar.border` |
| `--ts-ui-menu-bar-btn-bg` | `menuBar.button.background` |
| `--ts-ui-menu-bar-btn-hover-bg` | `menuBar.button.hoverBackground` |
| `--ts-ui-menu-bar-btn-fg` | `menuBar.button.foreground` |
| `--ts-ui-menu-bar-panel-bg` | `menuBar.panel.background` |
| `--ts-ui-menu-bar-panel-border` | `menuBar.panel.border` |
| `--ts-ui-menu-bar-panel-shadow` | `menuBar.panel.shadow` |
| `--ts-ui-menu-bar-panel-min-width` | `menuBar.panel.minWidth` |
| `--ts-ui-menu-bar-item-hover-bg` | `menuBar.item.hoverBackground` |
| `--ts-ui-menu-bar-item-disabled-color` | `menuBar.item.disabledColor` |
| `--ts-ui-menu-bar-item-shortcut-color` | `menuBar.item.shortcutColor` |
| `--ts-ui-menu-bar-separator-color` | `menuBar.separatorColor` |

**Default (light) values:**
- `background`: `'transparent'`
- `border`: `'rgb(220, 220, 220)'`
- `button.background`: `'transparent'`
- `button.hoverBackground`: `'rgba(30, 100, 200, 0.10)'`
- `button.foreground`: `'inherit'`
- `panel.background`: `'rgb(255, 255, 255)'`
- `panel.border`: `'rgb(200, 200, 200)'`
- `panel.shadow`: `'2px 4px 8px rgba(0, 0, 0, 0.15)'`
- `panel.minWidth`: `'160px'`
- `item.height`: `'24px'`
- `item.hoverBackground`: `'rgba(30, 100, 200, 0.12)'`
- `item.disabledColor`: `'rgb(170, 170, 170)'`
- `item.shortcutColor`: `'rgb(140, 140, 140)'`
- `separatorColor`: `'rgb(220, 220, 220)'`

---

## 6. Key Design Decisions and Tradeoffs

**`MenuPanel` is not a subclass of `ContextMenu`**
`ContextMenu.show()` destroys and rebuilds all items on every open. For a menu bar, the same top-level panel opens and closes repeatedly during keyboard navigation. Rebuilding on every open is wasteful and would reset DOM focus. `MenuPanel` items are constructed once in the constructor and reused — `close()` simply removes the element from the DOM without destroying the items.

**State machine in `MenuBar`**
`MenuBar` is the single source of truth: `_openIndex: number`, `_activePanel: MenuPanel | null`, `_quickSwitchActive: boolean`. `MenuBarButton` callbacks signal intent; `MenuBar` decides whether to open/close/switch. When `_openIndex >= 0`, `MenuBar` registers a viewport `keydown` listener. It removes it when `_openIndex === -1`.

**Keyboard navigation ownership**
`MenuBar` owns Left/Right navigation between top-level items and Escape-to-close. `MenuPanel` owns Up/Down within its own items and exposes `focusNext()`, `focusPrev()`, `activateFocused()`. `MenuBar` calls these from the keydown handler. This avoids circular references — `MenuPanel` never needs to call back into `MenuBar` for keyboard events.

**Submenu hover delay**
A 150 ms hover delay before opening submenus prevents accidental opening while the cursor travels across items. A `setTimeout` stored as `_submenuTimer` is cancelled on `mouseout`. Keyboard navigation (arrow-right) opens immediately, skipping the timer.

**Focus management**
The bar does not use native browser focus for its buttons or panel items — focus is entirely simulated via `setFocused(true/false)` CSS background on `MenuItem`, mirroring `ContextMenuItem`'s `:hover` approach. The `MenuBar` element itself receives `tabindex="0"` so it participates in document tab order. When focus leaves the bar element, the menu closes.

**`MenuItem` layout: icon + label + shortcut + chevron**
`MenuItem.doLayout()` places four zones:
1. **Icon** — fixed 20 px wide, left-padded 4 px; hidden when `config.icon` is not set.
2. **Text** — fills remaining width minus shortcut/chevron reserved space.
3. **Shortcut** — right-aligned, muted foreground, fixed right margin of 8 px.
4. **Chevron** — rightmost 16 px; only rendered when `hasSubmenu()`.

**Viewport clamping**
`MenuPanel.open()` reads `getBoundingClientRect()` on the anchor element, calls `Util.getViewportSize()` to clamp, and opens upward if the panel would overflow the bottom of the viewport — matching `ContextMenu.show()`.

**Z-index layering**
- `MenuPanel`: 9999 (one below `ContextMenu` at 10000 and `Tooltip` at 10001).
- Nested submenu panels: also 9999 — DOM order provides stacking.

**Outside-click handling**
`MenuPanel` registers one viewport `mousedown` listener on open, removed on close — identical to `ContextMenu`. It checks `!this.getElement()?.contains(e.target as Node)`. Clicks on `MenuBar` itself are carved out: the bar button's own click handler manages the open/close transition.

**Memory management**
`MenuItem.dispose()` removes its Event listeners. `MenuPanel.dispose()` calls `dispose()` on each `MenuItem`. `MenuBar.setMenus()` calls `dispose()` on the previously active panel and destroys existing `MenuBarButton` children before rebuilding.

---

## 7. ARIA Attributes Summary

| Component | `role` | Additional attributes |
|---|---|---|
| `MenuBar` | `menubar` | `aria-label="Main menu"` |
| `MenuBarButton` | `menuitem` | `aria-haspopup="menu"`, `aria-expanded="true|false"` |
| `MenuPanel` | `menu` | `aria-labelledby="{owning button id}"` |
| `MenuItem` (action) | `menuitem` | `aria-disabled="true"` when disabled |
| `MenuItem` (submenu) | `menuitem` | `aria-haspopup="menu"`, `aria-expanded="true|false"` |
| `MenuSeparator` | `separator` | (none) |

Set ARIA attributes via `component.getAria().setAttribute(...)` or by extending `Aria` with `setHasPopup` / `setDisabled` methods. Direct `setElementAttribute` calls are acceptable for a first implementation.

---

## 8. Ordered Implementation Steps

**Step 1 — Theme tokens**
Add `menuBar` to `Theme`, `DefaultTheme`, `DarkTheme`, and `themeToVars`. Must come first so all components can reference CSS variables from the start.

**Step 2 — `MenuSeparator`**
Trivial component identical to `ContextMenuSeparator` but using `--ts-ui-menu-bar-separator-color`.

**Step 3 — `MenuItem`**
Implement `doLayout()` for the four-zone layout. Implement `:hover` CSS rule and focused-state background. Add `dispose()`. Wire `mouseover`/`mouseout` via `Event.addListener` for hover-based submenu timing.

**Step 4 — `MenuPanel`**
Implement `open(anchorEl, parentPanel?)` and `close()`. Build items in constructor (no rebuild-on-open). Implement `focusItem/focusNext/focusPrev/activateFocused`. Wire the viewport `mousedown` listener.

**Step 5 — `MenuBarButton`**
Thin component with a text label, `:hover` CSS rule, and an "open/active" state rule. Exposes `onClick` and `onHover` callbacks. Implements `setActive(active: boolean)`.

**Step 6 — `MenuBar`**
Implement `setMenus()`, `openMenu()`, `closeMenu()`. Build the state machine. Register/deregister the viewport keydown listener. Handle: Escape, Left, Right, Up, Down, Enter. Set `tabindex="0"` on the element. Set ARIA roles.

**Step 7 — Export from `Base/index.ts`**
Add exports for all five new classes and the two config interfaces.

**Step 8 — Integration test**
Verify all features: nested submenus, disabled items, separators, keyboard navigation, outside-click close, both themes. Add a demo panel or extend `MiscPanel` to showcase the menu bar.

---

## Critical Files

- `src/typescript/Base/Theme.ts`
- `src/typescript/Base/index.ts`
- `src/typescript/Base/Event.ts`
- `src/typescript/Base/component/menubar/MenuBar.ts` (new)
- `src/typescript/Base/component/menubar/MenuBarButton.ts` (new)
- `src/typescript/Base/component/menubar/MenuPanel.ts` (new)
- `src/typescript/Base/component/menubar/MenuItem.ts` (new)
- `src/typescript/Base/component/menubar/MenuSeparator.ts` (new)
