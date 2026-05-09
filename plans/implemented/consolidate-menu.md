# Consolidate `ContextMenu` and `MenuPanel` into `Menu`

## Context

The framework currently has two near-identical floating-panel components:

- [src/typescript/Base/ContextMenu.ts](src/typescript/Base/ContextMenu.ts) — single-level right-click menu, rebuild-on-show lifecycle
- [src/typescript/Base/component/menubar/MenuPanel.ts](src/typescript/Base/component/menubar/MenuPanel.ts) — multi-level dropdown for `MenuBar`, persistent items

Both share the same panel layout, viewport clamping, outside-click handling, and z-index strategy. The MenuBar dropdown's `MenuItem` is already a strict superset of `ContextMenuItem` (icon + shortcut + submenu + focus state vs. text-only). This plan unifies the two into a single `Menu` class with a constructor-determined mode and migrates all existing callers to import `Menu` directly. The old `ContextMenu`, `ContextMenuItem`, `ContextMenuSeparator`, and `MenuPanel` files are deleted outright — no shims, no aliases.

---

## Architecture: Two-Mode `Menu`

The `Menu` constructor has two overloads. The chosen mode is stored as a `readonly boolean` and gates which API methods are valid:

```
new Menu()                         → rebuild mode (right-click context menu — show/hide with items per call)
new Menu(items, onClose)           → persistent mode (MenuBar dropdown — open/close, items reused)
```

Rebuild mode preserves the existing `ContextMenu` behaviour exactly: `show(x, y, items)` disposes prior items and rebuilds. Persistent mode is the existing `MenuPanel` behaviour: items built once in the constructor, `open(anchorEl)` positions and attaches, `close()` detaches without disposing.

---

## File Changes

### New files
- `src/typescript/Base/Menu.ts` — the unified class
- `src/typescript/Base/component/MenuItem.ts` — moved up from `menubar/MenuItem.ts` (carries `MenuItemConfig` and `MenuConfig`)
- `src/typescript/Base/component/MenuSeparator.ts` — moved up from `menubar/MenuSeparator.ts`

### Files to delete
- `src/typescript/Base/ContextMenu.ts`
- `src/typescript/Base/component/ContextMenuItem.ts`
- `src/typescript/Base/component/ContextMenuSeparator.ts`
- `src/typescript/Base/component/menubar/MenuPanel.ts`
- `src/typescript/Base/component/menubar/MenuItem.ts`
- `src/typescript/Base/component/menubar/MenuSeparator.ts`

### Files to modify
- `src/typescript/Base/component/menubar/MenuBar.ts` — switch import paths; `_panels: Menu[]` (was `MenuPanel[]`); construct as `new Menu(menu.items, () => this.closeMenu())`. All other logic unchanged.
- `src/typescript/Base/component/table/Table.ts` — replace `ContextMenu` → `Menu`, `ContextMenuItemConfig` → `MenuItemConfig`. Concrete edits in §"Caller Migration" below.
- `src/typescript/MiscPanel.ts` — replace `ContextMenu` → `Menu`. Concrete edits in §"Caller Migration" below.
- `src/typescript/Base/index.ts` — remove `ContextMenu`, `ContextMenuItem`, `ContextMenuItemConfig`, `ContextMenuSeparator` exports. Add `Menu`, `MenuItem`, `MenuItemConfig`, `MenuConfig`, `MenuSeparator` exports.

### Files NOT affected
- `Base/component/table/Header.ts` and `Base/component/table/cell/Header.ts` — these use `onContextMenu` as a DOM-event name and have callbacks named `setOnContextMenu` / `setOnColumnContextMenu`. The `ContextMenu` substring here refers to the right-click event, not the class. Leave untouched.
- `Base/component/DialogBackdrop.ts` and `Base/component/AutoCompleteItem.ts` — only have stale doc-comments mentioning `ContextMenu` / `ContextMenuItem`. Update the comments to say `Menu` / `MenuItem` (one-line edits each).

---

## `Menu` Class API

```typescript
export class Menu extends Component {
    constructor();                                            // rebuild mode
    constructor(items: MenuItemConfig[], onClose: () => void); // persistent mode

    // Rebuild-mode (was ContextMenu)
    show(x: number, y: number, configs: MenuItemConfig[]): void;
    hide(): void;
    setMenuWidth(width: number): void;

    // Persistent-mode (was MenuPanel)
    open(anchorEl: HTMLElement, parentPanel?: Menu): void;
    close(): void;
    focusItem(index: number): void;
    focusNext(): void;
    focusPrev(): void;
    activateFocused(): void;
    getFocusedIndex(): number;
    setExcludedElement(el: HTMLElement | null): void;
    dispose(): void;
}
```

The two API surfaces are disjoint by mode. `show()`/`hide()` are valid only in rebuild mode; `open()`/`close()`/focus methods only in persistent mode. Misuse is caught early with an `assert`/`throw` inside each method (`if (this._persistent !== expected) throw new Error(...)`).

### Internal state
```typescript
private readonly _persistent: boolean;
private readonly _onClose: (() => void) | null;
private _menuItems: Array<MenuItem | MenuSeparator>;
private _focusedIndex: number;
private _openSubmenuPanel: Menu | null;
private _openSubmenuItem: MenuItem | null;
private _excludedEl: HTMLElement | null;
private _menuWidth: number;
private readonly _onViewportMouseDown: (e: MouseEvent) => void;
```

### Implementation notes

**Constructor.** `_persistent = items !== undefined`. Rebuild mode applies the existing `ContextMenu` styling (`--ts-ui-context-menu-*` CSS vars) and leaves `_menuItems` empty. Persistent mode applies the existing `MenuPanel` styling (`--ts-ui-menu-bar-panel-*` CSS vars), builds items, sets `aria-role="menu"`.

**`show(x, y, configs)`** — copy logic verbatim from current `ContextMenu.show()`. Items built per call as `new MenuItem(config, () => { config.action?.(); this.hide(); }, () => {}, 'context-menu')` — the submenu callback is a no-op; submenus inside right-click context menus are not in scope.

**`open(anchorEl, parentPanel?)`** — copy logic verbatim from current `MenuPanel.open()`. Submenu opening uses lazy `new Menu(item.getSubmenuConfig()!.items, () => this._onClose!())` exactly as `MenuPanel.handleItemOpenSubmenu` does today.

**Outside-click listener** — single `_onViewportMouseDown` handles both modes. Rebuild mode calls `this.hide()`; persistent mode calls `this._onClose!()`.

**`dispose()`** — only meaningful in persistent mode; iterates `_menuItems` calling `dispose()` on each.

---

## `MenuItem` and `MenuSeparator`

Move `Base/component/menubar/MenuItem.ts` → `Base/component/MenuItem.ts` and `Base/component/menubar/MenuSeparator.ts` → `Base/component/MenuSeparator.ts`. Fix relative imports inside (`../../` → `../`). The current implementation is feature-complete (icon, shortcut, submenu, focus state, hover-with-150ms-delay, four-zone `doLayout()`) and `MenuItemConfig` / `MenuConfig` interfaces are preserved exactly.

### CSS variable handling

Add an optional 4th constructor parameter to `MenuItem` so it can swap CSS-variable families per mode:

```typescript
constructor(
    config: MenuItemConfig,
    onActivate: () => void,
    onOpenSubmenu: (item: MenuItem) => void,
    cssVarPrefix?: 'menu-bar' | 'context-menu'   // defaults 'menu-bar'
);
```

Used internally to swap between `--ts-ui-menu-bar-item-*` and `--ts-ui-context-menu-item-*` for disabled color, hover background, and shortcut color. `Menu` passes `'context-menu'` in rebuild mode and the default in persistent mode. `MenuSeparator` gets the same parameter for its border-color var.

Context-menu mode keeps the right-click menu visually identical to today (it currently uses `--ts-ui-context-menu-item-hover-bg` etc., not the menu-bar tokens).

---

## Caller Migration

### `Base/component/table/Table.ts`

```typescript
// Line 14-15:
import { ContextMenu } from "../../ContextMenu.js";
import { ContextMenuItemConfig } from "../../component/ContextMenuItem.js";
// →
import { Menu } from "../../Menu.js";
import { MenuItemConfig } from "../MenuItem.js";

// Line 60:
private columnContextMenu: ContextMenu = new ContextMenu();
// →
private columnContextMenu: Menu = new Menu();

// Line 514:
const items: ContextMenuItemConfig[] = columns.map(col => {
// →
const items: MenuItemConfig[] = columns.map(col => {
```

Field name `columnContextMenu` and method name `showColumnMenu` are kept — the right-click context-menu *concept* is unchanged; only the imported class is renamed.

### `MiscPanel.ts`

```typescript
// Line 17:
import { ContextMenu } from "./Base/ContextMenu.js";
// →
import { Menu } from "./Base/Menu.js";

// Line 176:
const contextMenu = new ContextMenu();
// →
const contextMenu = new Menu();
```

Local variable name `contextMenu` is kept — it's a concept, not the class name.

### `Base/component/DialogBackdrop.ts`

Doc-comment edit on line 12: `mirroring the pattern used by Notification and ContextMenu` → `mirroring the pattern used by Notification and Menu`.

### `Base/component/AutoCompleteItem.ts`

Doc-comment edit on line 12: `Unlike ContextMenuItem, this item is mutable...` → `Unlike MenuItem, this item is mutable...`.

### `Base/index.ts`

Remove these exports:
```typescript
export { ContextMenu } from './ContextMenu.js';
export { ContextMenuItem } from './component/ContextMenuItem.js';
export type { ContextMenuItemConfig } from './component/ContextMenuItem.js';
export { ContextMenuSeparator } from './component/ContextMenuSeparator.js';
```

Add:
```typescript
export { Menu } from './Menu.js';
export { MenuItem } from './component/MenuItem.js';
export type { MenuItemConfig, MenuConfig } from './component/MenuItem.js';
export { MenuSeparator } from './component/MenuSeparator.js';
```

---

## `MenuBar` Migration

Three edits in [src/typescript/Base/component/menubar/MenuBar.ts](src/typescript/Base/component/menubar/MenuBar.ts):

1. `import { MenuPanel } from "./MenuPanel.js";` → `import { Menu } from "../../Menu.js";`
2. `import { MenuConfig } from "./MenuItem.js";` → `import { MenuConfig } from "../MenuItem.js";`
3. `private readonly _panels: MenuPanel[] = [];` → `private readonly _panels: Menu[] = [];`
4. `const panel = new MenuPanel(menu.items, ...)` → `const panel = new Menu(menu.items, ...)`

`MenuBarButton.ts` is unaffected.

---

## Implementation Steps

**Step 1 — Move `MenuItem` and `MenuSeparator` up**
Move from `Base/component/menubar/` to `Base/component/`. Fix relative imports (`../../` → `../`). Add the `cssVarPrefix` constructor parameter to both, defaulting to `'menu-bar'`. Update `MenuBar.ts` and `MenuPanel.ts` import paths so the existing menubar still compiles. Verify menubar still works.

**Step 2 — Create `Base/Menu.ts`**
Merge `ContextMenu.ts` and `MenuPanel.ts` into one class with the two-mode design. Carry over all logic verbatim per mode — no behaviour changes. Pass `'context-menu'` for `cssVarPrefix` when constructing `MenuItem` in rebuild mode.

**Step 3 — Migrate `MenuBar`**
Replace `MenuPanel` with `Menu` (persistent-mode constructor). Verify menubar opens, closes, navigates, and submenus work identically.

**Step 4 — Migrate `Table.ts` and `MiscPanel.ts`**
Apply the import and type-name edits in §"Caller Migration". Verify both right-click menus still work end-to-end.

**Step 5 — Update doc-comments**
Fix the stale `ContextMenu` / `ContextMenuItem` references in `DialogBackdrop.ts` and `AutoCompleteItem.ts`.

**Step 6 — Update `Base/index.ts`**
Remove old exports, add new ones.

**Step 7 — Delete old files**
`Base/ContextMenu.ts`, `Base/component/ContextMenuItem.ts`, `Base/component/ContextMenuSeparator.ts`, `Base/component/menubar/MenuPanel.ts`, `Base/component/menubar/MenuItem.ts`, `Base/component/menubar/MenuSeparator.ts`. Confirm with grep that no imports remain.

**Step 8 — Run `graphify update .`**
Per the project's graphify rule, refresh the knowledge graph after structural moves and renames.

---

## Verification

1. `tsc --noEmit` is clean.
2. `grep -rn "ContextMenu\|ContextMenuItem\|ContextMenuSeparator" src/` returns only:
   - `setOnContextMenu` / `setOnColumnContextMenu` / `onContextMenu` / `onColumnContextMenuCallback` in `table/Header.ts` and `table/cell/Header.ts` (DOM-event method names, kept).
3. `Table.ts` column-visibility right-click menu opens; toggling a column hides/shows it; "Reset columns" works.
4. `MiscPanel.ts` right-click context-menu demo still opens the menu, runs actions, and closes on outside click.
5. `MenuBar` demo: top-level open/close, ArrowLeft/ArrowRight switch menus, ArrowUp/ArrowDown navigate items, Enter activates, Escape closes, hover-quick-switch works, submenus open after 150 ms hover and on ArrowRight.
6. Both light and dark themes render identically before and after.

---

## Critical Files

- `src/typescript/Base/Menu.ts` (new)
- `src/typescript/Base/component/MenuItem.ts` (moved here)
- `src/typescript/Base/component/MenuSeparator.ts` (moved here)
- `src/typescript/Base/component/menubar/MenuBar.ts` (import paths updated)
- `src/typescript/Base/component/table/Table.ts` (Menu / MenuItemConfig)
- `src/typescript/MiscPanel.ts` (Menu)
- `src/typescript/Base/component/DialogBackdrop.ts` (doc-comment)
- `src/typescript/Base/component/AutoCompleteItem.ts` (doc-comment)
- `src/typescript/Base/index.ts` (exports updated)
- `src/typescript/Base/ContextMenu.ts` (deleted)
- `src/typescript/Base/component/ContextMenuItem.ts` (deleted)
- `src/typescript/Base/component/ContextMenuSeparator.ts` (deleted)
- `src/typescript/Base/component/menubar/MenuPanel.ts` (deleted)
- `src/typescript/Base/component/menubar/MenuItem.ts` (deleted; moved out)
- `src/typescript/Base/component/menubar/MenuSeparator.ts` (deleted; moved out)
