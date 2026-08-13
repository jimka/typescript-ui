---
touches-shared:
  - packages/lib/src/typescript/lib/overlay/Menu.ts
  - packages/lib/src/typescript/lib/component/container/MenuItem.ts
  - packages/lib/src/typescript/lib/component/container/MenuSeparator.ts
  - packages/lib/src/typescript/lib/component/container/index.ts
  - packages/lib/src/typescript/lib/component/menubar/MenuBar.ts
  - packages/lib/docs/components/Menu.md
  - packages/lib/docs/components/MenuItem.md
  - packages/lib/docs/components/index.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/scripts/llms/manifest.data.mjs
  - packages/lib/llms.txt
  - packages/docs/src/content/pages.ts
---

# Menu Rows As Components — Implementation Plan

## Overview

`Menu` builds every row itself. Both build paths call `new MenuItem(config, …)` directly — rebuild mode at [`Menu.ts:288-303`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L288) and persistent mode at [`Menu.ts:921-938`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L921) — so a row can only ever be the fixed check/icon/title/shortcut/chevron template `MenuItem` renders. A menu cannot host a real `Checkbox`, a `TextField`, or any other interactive control.

This plan adds a second, opt-in path: a new abstract `MenuRow` base class (`packages/lib/src/typescript/lib/component/container/MenuRow.ts`) that `MenuItem` and `MenuSeparator` come to extend, and a new `row?: () => MenuRow` factory field on [`MenuItemConfig`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L41). When a config carries `row`, `Menu` calls the factory and uses whatever component comes back instead of building a `MenuItem`. `Menu`'s item array, its column measurement in [`layOutColumns`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L202), and its roving keyboard highlight ([`setFocusedIndex`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L945), [`focusNext`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L705), [`activateFocused`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L757)) stop switching on `instanceof MenuItem` and program against `MenuRow` instead.

`MenuItemConfig` stays the common case and does not change shape for anyone. `MenuButton`, `SplitButton`, `ToolBar`, `TabBar`, `Table`, `NotificationHistoryButton`, and `Filter.ts`'s operator picker (which goes through `MenuButton.setMenuItems`, [`Filter.ts:82`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L82)) all keep compiling and behaving identically with no source change. `MenuBar` gains one guard — two statements that yield the key when DOM focus is inside the open panel, and that provably never fire for a config-built menu. One worked row type ships with the abstraction: `CheckboxMenuRow`, a real-`Checkbox` row that turns a menu into a multi-select control.

---

## Architecture Decisions

### `MenuRow` is an abstract `Component` base class, not a bare interface

`MenuRow extends Component` and supplies a working default for every method `Menu` calls, so a custom row overrides only what it cares about. `MenuItem` and `MenuSeparator` become subclasses; `Menu._menuItems` becomes `MenuRow[]`.[^base-class]

This mirrors [`ListItemRenderer`](../packages/lib/src/typescript/lib/component/list/ListItemRenderer.ts#L33) — an abstract `Component` subclass that `AbstractSelectableList` drives through a fixed set of lifecycle calls, with [`getContentWidth()`](../packages/lib/src/typescript/lib/component/list/ListItemRenderer.ts#L68) returning `0` as its "I have no intrinsic width" default — and [`CellRenderer`](../packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L16), whose `getContentX()` and `getDisplayText()` do the same thing for the table.

### A custom row is declared in-band on `MenuItemConfig`, via a `row` factory field

`MenuItemConfig` gains `row?: () => MenuRow`. When set, all other config fields are ignored, exactly as `separator: true` already ignores them ([`MenuItem.ts:88-89`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L88)). No signature anywhere widens: `Menu.show`, `Menu.toggleFor`, the `Menu` constructor, `MenuConfig.items`, `MenuButton.setMenuItems`, and `SplitButton.setMenuItems` all keep taking `MenuItemConfig[]`, and every one of them gains custom-row support for free.[^in-band]

`separator` is checked first, then `row`, then the plain-item path:

| Config entry | Row built |
| --- | --- |
| `{ separator: true, row: f }` | `MenuSeparator` — `separator` wins; `row` and every other field ignored |
| `{ row: f, text: 'Bold' }` | `f()` — `text` / `action` / `checked` / `submenu` ignored |
| `{ text: 'Bold', action }` | `MenuItem` (today's path, unchanged) |
| `{}` | `MenuItem` with an empty label (today's behaviour, unchanged) |

### The row arrives as a zero-argument factory, never as a live instance

`row` is a function `Menu` calls each time it builds its list, not a prebuilt component. `Menu` disposes its whole item list on every rebuild — [`showAnchored`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L284) and [`rebuildPersistentItems`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L906) both call `disposeAllComponents()` — so a caller-held instance would be dead after the first show.[^factory] The same zero-argument-factory shape is what `AbstractSelectableList` uses for its pluggable content: `_rendererFactory: () => ListItemRenderer` ([`AbstractSelectableList.ts:771`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L771)).

### A custom row opts out of the shared column grid by default, and reports its own width

`MenuRow`'s defaults report no check, no icon, no submenu, and zero title / shortcut width, and its `setColumns` is a no-op — so a custom row contributes nothing to the shared check/icon/title/shortcut geometry and renders across the row's full width. A row that wants to line up with the `MenuItem`s around it overrides `setColumns` and stores the `iconStart` it is handed.

Because zero metrics would also make the panel too narrow for the row, `MenuRow` adds `getContentWidth(): number` (default `0`), and `layOutColumns` floors the panel's natural width with the widest row's value:

| Menu contents | `iconStart + maxTitle + rightReserve + RIGHT_PAD` | widest `getContentWidth()` | Panel width |
| --- | --- | --- | --- |
| `[{ text: 'Bold' }]`, title 30px | `8 + 30 + 0 + 8` = 46 | 0 | 120 (`MIN_MENU_WIDTH` floor) |
| `[{ text: 'Bold' }, { row: f }]`, `f` reports 300 | 46 | 300 | 300 |
| `[{ row: f }]`, `f` reports 900 | `8 + 0 + 0 + 8` = 16 | 900 | 360 (`MAX_MENU_WIDTH` ceiling) |

`getContentWidth()` is read **before** `setColumns()` is called, so an implementation must not depend on the injected columns — it computes its width from its own content and its own fallback inset.

### `isNavigable()` decides whether `Menu`'s roving highlight lands on a row; it defaults to `false`

`Menu`'s arrow-key highlight is a paint-only affordance — `setFocused(true)` writes a background colour and nothing ever calls `DOM.sink.focus`. A row hosting a real control wants real DOM focus instead, so the two must not both claim the row. `MenuRow.isNavigable()` returns `false` by default: `focusNext` / `focusPrev` skip such a row exactly as they skip a separator, and `activateFocused()` never activates it. The row owns its own focus and its own keys.

A row that behaves like a menu item rather than hosting a focusable control overrides `isNavigable()` to `true` and gets the highlight plus Enter-to-`activate()`. `CheckboxMenuRow` does exactly that.[^navigable]

| Situation | Behaviour |
| --- | --- |
| ArrowDown in a `MenuBar` dropdown, focus on the bar | `focusNext()` — skips separators and every `isNavigable() === false` row |
| Enter, highlight on a `MenuItem` | `activateFocused()` → `MenuItem.activate()` (unchanged) |
| Enter, highlight on a navigable custom row | `activateFocused()` → `row.activate()` |
| Any key while DOM focus is inside the open panel (a `TextField` in a custom row) | `MenuBar` yields; the control receives the key |
| Escape while DOM focus is inside the open panel | `LayerManager`'s own Escape handler closes the menu |
| Any key in a rebuild-mode (context) menu | nothing intercepts — `Menu` has no keyboard navigation in that mode |

### `MenuBar` yields the key when DOM focus is inside the open panel

[`MenuBar._onKeyDown`](../packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L90) is a **viewport** listener, so it fires for keydowns anywhere in the document while a dropdown is open and consumes ArrowUp/Down/Left/Right, Enter, and Escape with `{ stop: true, prevent: true }`. A `TextField` inside a custom row would lose caret movement and Enter. `MenuBar` gains one guard: when the keydown's target is inside the open panel, it returns without handling.

The containment test is [`LayerManager.containsAcrossLayers(panel, target)`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L301) — the library's single place cross-portal containment is reasoned about, and the same call `handleOutside` uses. Today this guard never fires: a `MenuItem` is a plain `<div>` with no `tabindex`, its labels are `pointer-events: none`, and the panel is portaled to `documentElement` while focus stays on the `MenuBar` element ([`MenuBar.ts:89`](../packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L89) sets its `tabIndex` to 0).[^menubar-yield]

### Outside-click dismissal already works for embedded controls — settled, no change

`LayerManager.handleOutside` treats a `pointerdown` anywhere inside the layer's own subtree (or a child layer's) as inside and dismisses nothing ([`LayerManager.ts:448-470`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L448), via `containsAcrossLayers`). A click on an embedded checkbox, or a keystroke into an embedded text field, is inside the menu's mounted element, so it does not reach `requestClose()`. Nothing in `LayerManager`, `getDismissMode`, or the window-blur path changes.

### `Menu` injects the CSS-variable prefix and a close handler into every factory row

A factory is zero-argument, so it cannot know which menu it is being built for. Immediately after calling it, `Menu` calls `row.setCssVarPrefix(prefix)` (`"context-menu"` in rebuild mode, `"menu-bar"` in persistent mode) and `row.setMenuCloseHandler(() => { this.dismissAll(); })`. The prefix lets the base `setFocused` highlight read the right theme tokens; the close handler is the only way a custom row can dismiss a menu it has no reference to.[^injection]

`MenuItem`'s hover-highlight implementation moves up to `MenuRow` verbatim, so there is one implementation of the highlight rather than one per row type. `MenuItem` keeps its `cssVarPrefix` constructor parameter and forwards it to the inherited setter.

### The worked example ships as `CheckboxMenuRow`

`CheckboxMenuRow` is a real, exported component: a menu row hosting a real [`Checkbox`](../packages/lib/src/typescript/lib/component/input/Checkbox.ts#L51), navigable, toggling on a click anywhere in the row or on Enter, and leaving the menu open. It exercises every part of the contract — `isNavigable`, `activate`, `getContentWidth`, `setColumns`, the injected prefix — which is why it ships rather than living in a doc fence.[^worked-example]

The line is drawn there: one row type, no `TextField` row and no slider row. A second row type would re-exercise the same interface without testing anything new, and the non-navigable branch of the contract is already pinned by the `MenuBar` guard and the `focusNext` skip, both of which are tested directly.

### Independent of `menu-item-close-on-activate-flag`

This plan neither requires nor blocks plan `menu-item-close-on-activate-flag`. That plan adds a `closeOnActivate` flag read inside the `onActivate` closures `Menu` builds **for `MenuItem`**; a factory row never passes through those closures. The two plans edit adjacent lines in the same two build loops, which is what the `touches-shared` frontmatter records.[^plan-one]

The two features are the config-path and component-path answers to the same need. `closeOnActivate: false` plus `checked` gives a text-checkmark multi-select row with a hand-rolled toggle; `CheckboxMenuRow` gives a real `Checkbox` graphic whose toggle is the `Checkbox`'s own, inheriting the very `Checkbox.activate()` self-toggle precedent plan 1 copies by hand.

---

## Public API

New module `packages/lib/src/typescript/lib/component/container/MenuRow.ts`:

```typescript
/**
 * Base class for a row inside a Menu. Not wrapped with `callable()` —
 * abstract classes are never instantiated. It declares no abstract members:
 * every method below has a working default, and `abstract` marks it as a
 * base to extend rather than a row to construct.
 */
export abstract class MenuRow<TOptions extends ComponentOptions = ComponentOptions>
    extends Component<TOptions>
{
    /** Standard row height in pixels. */
    static readonly HEIGHT: number;

    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>);

    // ---- activation / keyboard protocol (called by Menu) ----
    isSeparator(): boolean;                       // default false
    isEnabled(): boolean;                         // default true
    isNavigable(): boolean;                       // default false
    setFocused(focused: boolean): this;           // default: paints the hover highlight
    activate(): void;                             // default: no-op

    // ---- column-alignment protocol (called by Menu.layOutColumns) ----
    hasCheck(): boolean;                          // default false
    hasIcon(): boolean;                           // default false
    hasSubmenu(): boolean;                        // default false
    titleTextWidth(): number;                     // default 0
    shortcutTextWidth(): number;                  // default 0
    getContentWidth(): number;                    // default 0
    setColumns(checkZone: number, iconStart: number, titleColumn: number): void;  // default: no-op

    // ---- injected by the owning Menu; not for consumer use ----
    setCssVarPrefix(prefix: MenuItemCSSVarPrefix): this;
    setMenuCloseHandler(close: () => void): void;

    // ---- available to subclasses ----
    protected getCssVarPrefix(): MenuItemCSSVarPrefix;
    protected closeMenu(): void;
}
```

Changed in `packages/lib/src/typescript/lib/component/container/MenuItem.ts`:

```typescript
export interface MenuItemConfig {
    // ...existing fields unchanged...
    /** New. When set, the menu renders this component instead of a MenuItem. */
    row?: () => MenuRow;
}

// Base class changes from Component to MenuRow. Public surface unchanged.
class MenuItem extends MenuRow { /* … */ }
```

Changed in `packages/lib/src/typescript/lib/component/container/MenuSeparator.ts`:

```typescript
// Base class changes from Component<MenuSeparatorOptions> to
// MenuRow<MenuSeparatorOptions>. Adds one override.
class MenuSeparator extends MenuRow<MenuSeparatorOptions> {
    isSeparator(): boolean;   // returns true
}
```

New module `packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts`:

```typescript
export type CheckboxMenuRowEvent = "action";

export interface CheckboxMenuRowOptions extends ComponentOptions {
    /** Row label, rendered beside the checkbox graphic. */
    text?: string;
    /** Initial checked state. Defaults to `false`. */
    checked?: boolean;
    /** Construction-time listener bag; `action` fires after each toggle. */
    listeners?: { action?: () => void };
}

class CheckboxMenuRow extends MenuRow<CheckboxMenuRowOptions> {
    constructor(options?: CheckboxMenuRowOptions, subclassDefaults?: Partial<CheckboxMenuRowOptions>);

    isChecked(): boolean;
    setChecked(value: boolean): this;

    isNavigable(): boolean;                       // true
    activate(): void;                             // flips the checkbox
    getContentWidth(): number;
    setColumns(checkZone: number, iconStart: number, titleColumn: number): void;

    on(event: "action", listener: () => void): this;
    off(event: "action", listener: () => void): this;
}
```

No change to `Menu`'s public surface. Custom rows reach it entirely through the `row` field on the configs consumers already pass.

---

## Internal Structure

### `MenuRow.ts` — state, the highlight, and the constructor

```typescript
    // Which CSS-variable family this row's highlight reads. Framework-managed
    // (the owning Menu picks it from its mode), so it is deliberately NOT an
    // options-bag field — ARCHITECTURE.md reserves the bag for consumer
    // configuration. No cascade-dispatched setter writes it, so a plain
    // initializer is correct here; `declare` is not needed.
    private _cssVarPrefix: MenuItemCSSVarPrefix = "menu-bar";

    // Injected by the owning Menu so a row can dismiss a panel it has no
    // reference to. Null for a row constructed outside a Menu.
    private _closeMenu: (() => void) | null = null;
```

`setFocused` is [`MenuItem.setFocused`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L426) moved verbatim:

```typescript
    setFocused(focused: boolean): this {
        this.setBackgroundColor(
            focused
                ? `var(--ts-ui-${this._cssVarPrefix}-item-hover-bg, rgba(30, 100, 200, 0.12))`
                : "transparent"
        );

        return this;
    }
```

The four injection members are one-liners: `setCssVarPrefix` and `setMenuCloseHandler` assign the two fields above, `getCssVarPrefix` returns `this._cssVarPrefix`, and `closeMenu` calls `this._closeMenu?.()`.

The constructor forwards both parameters and seeds the standard row height:

```typescript
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(options, subclassDefaults);

        this.setPreferredSize({ width: 0, height: MenuRow.HEIGHT });
    }
```

`MenuItemCSSVarPrefix` is declared in `MenuItem.ts`, and `MenuItem.ts` imports `MenuRow` as a value (for `extends`). `MenuRow.ts` must therefore import the prefix type with `import type { MenuItemCSSVarPrefix } from "~/component/container/MenuItem.js";` — a type-only import is erased, so there is no runtime import cycle. `MenuSeparator.ts` already imports it this way.

### `MenuItem.ts` — what changes

- `class MenuItem extends Component` becomes `class MenuItem extends MenuRow`.
- `static readonly HEIGHT: number = 24;` becomes `static readonly HEIGHT: number = MenuRow.HEIGHT;` so the row height has one definition.
- The `private readonly _cssVarPrefix` field ([line 155](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L155)) and the whole `setFocused` method ([lines 421-434](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L421)) are deleted; the constructor calls `this.setCssVarPrefix(cssVarPrefix);` as its first statement after the four field assignments at [lines 198-201](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L198). The local `cssVarPrefix` parameter keeps feeding the constructor's other CSS writes unchanged.
- One new method, beside the existing `isSeparator()`:

```typescript
    /**
     * True for any item the menu's arrow-key highlight may land on — every
     * item except a separator. A disabled item is still navigable; `activate`
     * is what refuses to run for it.
     *
     * @returns Whether the roving highlight may land on this item.
     */
    isNavigable(): boolean {
        return !this.isSeparator();
    }
```

### `Menu.ts` — `layOutColumns` (replaces lines 203-224)

```typescript
        const rows = this._menuItems.filter(row => !row.isSeparator());

        const checkZone    = rows.some(r => r.hasCheck()) ? MenuItem.CHECK_ZONE : 0;
        const iconStart    = checkZone + (rows.some(r => r.hasIcon()) ? MenuItem.ICON_ZONE : MenuItem.TEXT_INSET);
        const maxTitle     = rows.reduce((m, r) => Math.max(m, r.titleTextWidth()), 0);
        const maxShortcut  = rows.reduce((m, r) => Math.max(m, r.shortcutTextWidth()), 0);
        const hasChevron   = rows.some(r => r.hasSubmenu());
        const rightZone    = Math.max(maxShortcut, hasChevron ? MenuItem.CHEVRON_ZONE : 0);
        const rightReserve = rightZone > 0 ? MenuItem.TEXT_GAP + rightZone : 0;
        // A custom row contributes no title/shortcut metrics, so the panel
        // would be too narrow for it; floor the natural width with the widest
        // row's own report instead.
        const maxContent   = rows.reduce((m, r) => Math.max(m, r.getContentWidth()), 0);

        const natural = Math.max(iconStart + maxTitle + rightReserve + MenuItem.RIGHT_PAD, maxContent);
        const width   = Math.min(MAX_MENU_WIDTH, Math.max(MIN_MENU_WIDTH, natural));

        const titleColumn = Math.min(maxTitle, width - iconStart - rightReserve - MenuItem.RIGHT_PAD);

        for (const row of rows) {
            row.setColumns(checkZone, iconStart, titleColumn);
        }

        return width;
```

### `Menu.ts` — `showAnchored`'s item loop (replaces lines 288-303)

```typescript
        for (const config of configs) {
            let row: MenuRow;

            if (config.separator === true) {
                row = new MenuSeparator("context-menu");
            } else if (config.row) {
                row = config.row();
                row.setCssVarPrefix("context-menu");
                row.setMenuCloseHandler(() => { this.dismissAll(); });
            } else {
                row = new MenuItem(
                    config,
                    () => {
                        config.action?.();
                        this.hide();
                    },
                    (hoveredItem) => { this.handleItemOpenSubmenu(hoveredItem); },
                    "context-menu"
                );
            }

            this.addComponent(row);
            this._menuItems.push(row);
        }
```

### `Menu.ts` — `buildPersistentItems`'s loop (replaces lines 924-933)

```typescript
        for (const config of items) {
            let row: MenuRow;

            if (config.row) {
                row = config.row();
                // The default, made explicit so both build loops read alike.
                row.setCssVarPrefix("menu-bar");
                row.setMenuCloseHandler(() => { this.dismissAll(); });
            } else {
                row = new MenuItem(
                    config,
                    () => { config.action?.(); this._onClose!(); },
                    (hoveredItem) => { this.handleItemOpenSubmenu(hoveredItem); }
                );
            }

            this.addComponent(row);
            this._menuItems.push(row);
        }
```

Persistent mode keeps building a `MenuItem` for a `separator: true` config — `MenuItem`'s constructor already renders it as a rule. That asymmetry with rebuild mode is pre-existing and deliberately left alone.

### `Menu.ts` — the four highlight / traversal sites

`isItemSeparator` (lines 971-983) is deleted and replaced by:

```typescript
    /**
     * Returns `true` when the row at the given index must be skipped by the
     * arrow-key highlight — a separator, or a custom row that owns its own
     * focus (see MenuRow's navigable flag).
     *
     * @param index - Zero-based row index.
     * @returns Whether focus traversal skips this row.
     */
    private isItemSkipped(index: number): boolean {
        return !this._menuItems[index].isNavigable();
    }
```

The four `this.isItemSeparator(…)` calls in `focusNext` (lines 710, 717) and `focusPrev` (lines 736, 743) become `this.isItemSkipped(…)`. The three `instanceof MenuItem` guards become `isNavigable()` checks:

```typescript
    // clearItemHighlights (lines 634-638)
        for (const row of this._menuItems) {
            if (row.isNavigable()) {
                row.setFocused(false);
            }
        }

    // setFocusedIndex (lines 946-962) — both halves
        if (prev.isNavigable()) { prev.setFocused(false); }
        // …
        if (next.isNavigable()) { next.setFocused(true); }

    // activateFocused (line 766)
        if (row.isNavigable() && row.isEnabled()) {
            row.activate();
        }
```

`_menuItems`'s declared type ([line 125](../packages/lib/src/typescript/lib/overlay/Menu.ts#L125)) becomes `MenuRow[]`. `_openSubmenuItem` stays `MenuItem | null` and `handleItemOpenSubmenu` keeps taking a `MenuItem` — only a `MenuItem` ever signals a submenu.

### `MenuBar.ts` — the yield guard

Inserted in `_onKeyDown` directly after `const panel = this._panels[this._openIndex];` ([line 96](../packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L96)), before the `switch`:

```typescript
            // A focusable control inside a custom menu row holds real DOM
            // focus, so the key belongs to it, not to the bar's roving
            // navigation. Escape still closes the panel — LayerManager's own
            // keydown handler owns that. No config-built row is focusable, so
            // this never fires for a plain MenuItemConfig menu.
            const target = e.target === null ? null : DOM.source.intern(e.target);

            if (LayerManager.containsAcrossLayers(panel, target)) {
                return;
            }
```

Adds `import { DOM } from "~/core/DOM.js";` and `import { LayerManager } from "~/core/LayerManager.js";`.

### `CheckboxMenuRow.ts` — the parts that are not boilerplate

Two fields, both assigned from the constructor body (never from a cascade-dispatched setter, so neither needs `declare`):

```typescript
    private _checkbox: Checkbox;
    // The title offset the owning Menu pushed in, or null when this row is
    // standalone — in which case doLayout falls back to MenuItem.TEXT_INSET.
    private _iconStart: number | null = null;
```

The `Checkbox` is built in the constructor body, after `super()`, so `applyOptions` running inside the cascade can never reach it:

```typescript
        this._checkbox = new Checkbox({
            label:    this._options.text ?? "",
            selected: this._options.checked ?? false,
        });
        // Pointer-inert child so a click anywhere in the row hits the row
        // element and toggles — the same arrangement MenuItem uses for its
        // five labels and SelectableListRow uses for its renderer. The row's
        // own `click` listener is exact-target, so the Checkbox's internal
        // synthetic click (fired from setSelected on its own element) cannot
        // re-enter it.
        this._checkbox.setPointerEvents("none");
        this.addComponent(this._checkbox);
```

```typescript
    activate(): void {
        this.setChecked(!this.isChecked());
    }

    getContentWidth(): number {
        const width = Math.ceil(this._checkbox.getPreferredSize()?.width ?? 0);

        // Its own fallback inset, never the injected `iconStart`: the menu
        // reads this width before it computes and pushes the columns.
        return MenuItem.TEXT_INSET + width + MenuItem.RIGHT_PAD;
    }

    setColumns(_checkZone: number, iconStart: number, _titleColumn: number): void {
        this._iconStart = iconStart;
        this.scheduleLayout();
    }

    doLayout(): this {
        super.doLayout();

        const box = this.getContentBounds();

        if (!box) {
            return this;
        }

        const size  = this._checkbox.getPreferredSize() ?? { width: 0, height: 0 };
        const left  = this._iconStart ?? MenuItem.TEXT_INSET;
        const top   = Math.max(0, Math.floor((box.height - size.height) / 2));

        this._checkbox.setX(box.x + left);
        this._checkbox.setY(box.y + top);
        this._checkbox.setWidth(Math.max(0, box.width - left - MenuItem.RIGHT_PAD));
        this._checkbox.setHeight(size.height);

        return this;
    }
```

The row wires three listeners on itself in its constructor — `click` → `activate()`, `mouseover` → `setFocused(true)`, `mouseout` → `setFocused(false)` — each through a `private readonly` arrow field, mirroring [`MenuItem`'s `_onClick` / `_onMouseOver` / `_onMouseOut`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L294). `on("action", fn)` / `off("action", fn)` wrap `Event.addListener(this, "click", fn)` / `removeListener`, matching [`Button.on`](../packages/lib/src/typescript/lib/component/button/Button.ts#L1480). `this.applyListeners(options?.listeners)` runs as the last statement of the constructor body, so a bag-supplied `action` listener registers **after** the row's own toggle handler and therefore observes the new checked state.

`CheckboxMenuRow` declares no `_defaultCheckboxMenuRowOptions` bag and no `destructor()` override, so it needs **no** row in `tests/component/default-options-fallback.test.ts` or `tests/component/dispose-full-teardown.test.ts`. Neither does `MenuRow`.

---

## Ordered Implementation Steps

1. **Create `packages/lib/src/typescript/lib/component/container/MenuRow.ts`.** The abstract class from `## Public API` with the bodies from `## Internal Structure`; every method carries a JSDoc block stating its default and what overriding it buys, and the class carries a `@category Components` tag. Import `MenuItemCSSVarPrefix` with `import type`. Do not wrap with `callable()` — abstract classes are never instantiated, as `ListItemRenderer.ts` notes for the same reason.
   *Check:* `npm run typecheck`.

2. **`MenuSeparator.ts` — extend `MenuRow`.** Change `extends Component<MenuSeparatorOptions>` to `extends MenuRow<MenuSeparatorOptions>` (line 29), swap the `Component` import for `MenuRow`, and add an `isSeparator(): boolean { return true; }` override.
   *Check:* `npm run typecheck`.

3. **`MenuItem.ts` — extend `MenuRow`.** Change `extends Component` to `extends MenuRow` (line 130); set `static readonly HEIGHT: number = MenuRow.HEIGHT;` (line 133); delete the `_cssVarPrefix` field (line 155) and the `setFocused` method (lines 421-434); add `this.setCssVarPrefix(cssVarPrefix);` after the field assignments at lines 198-201; add the `isNavigable()` override beside `isSeparator()`.
   *Check:* `npm run typecheck`; `grep -n "_cssVarPrefix" packages/lib/src/typescript/lib/component/container/MenuItem.ts` — zero matches.

4. **`MenuItem.ts` — add `row` to `MenuItemConfig`.** Insert after `separator` (line 89), with JSDoc stating that `separator` wins, that all other fields are ignored, and that the factory is called on every build so it must never return a shared instance.
   *Check:* `npm run typecheck`.

5. **`Menu.ts` — retype `_menuItems` and rewrite `layOutColumns`.** Change line 125 to `private _menuItems: MenuRow[] = [];`, add the `MenuRow` import, and replace lines 203-224 with the block from `## Internal Structure`.
   *Check:* `npm test -- Menu` — the existing `'Menu content-based width'` block must pass unmodified.

6. **`Menu.ts` — rewrite both build loops.** Replace lines 288-303 and lines 924-933 with the blocks from `## Internal Structure`.
   *Check:* `npm run typecheck`.

7. **`Menu.ts` — replace the traversal and highlight guards.** Delete `isItemSeparator` (lines 971-983), add `isItemSkipped`, update the four call sites in `focusNext` / `focusPrev`, and replace the three `instanceof MenuItem` guards in `clearItemHighlights`, `setFocusedIndex`, and `activateFocused`.
   *Check:* `grep -n "instanceof MenuItem" packages/lib/src/typescript/lib/overlay/Menu.ts` — zero matches; `npm test -- Menu`.

8. **`MenuBar.ts` — add the yield guard.** Insert the block from `## Internal Structure` after line 96 and add the two imports.
   *Check:* `npm test -- MenuBar`.

9. **Create `packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts`.** The class from `## Public API` with the bodies from `## Internal Structure`. Wrap with `callable()` and export under the underscored-alias pattern, exactly as `MenuItem.ts` does (lines 635-640).
   *Check:* `npm run typecheck`.

10. **Barrel exports.** In `packages/lib/src/typescript/lib/component/container/index.ts`, add `export { MenuRow } from '~/component/container/MenuRow.js';` beside the `MenuItem` line, plus `export { CheckboxMenuRow } from '~/component/container/CheckboxMenuRow.js';` and `export type { CheckboxMenuRowOptions, CheckboxMenuRowEvent } from '~/component/container/CheckboxMenuRow.js';`.
    *Check:* `npm run typecheck`; `npm run build:lib`.

11. **Tests — `packages/lib/tests/component/container/MenuRow.test.ts` (new).** Cover Expected-Behaviour items 1-3 (base defaults) and 16-21 (`CheckboxMenuRow` in isolation, no `Menu` involved).

12. **Tests — `packages/lib/tests/overlay/Menu.test.ts`.** Add a `describe('Menu custom rows', …)` block covering items 4-13 and 22. Extend the file's existing `installTestDOM(CONFIG)` setup shape; define a small local `class TestRow extends MenuRow` fixture for the non-`CheckboxMenuRow` cases.

13. **Tests — `packages/lib/tests/component/menubar/MenuBar.test.ts`.** Add a `describe('MenuBar key yielding', …)` block covering items 14-15, driving keydowns with `makeEvent(handle, 'keydown', { key })` + `DOM.sink.dispatchEvent(DOM.source.getWindow(), event)`, the pattern `tests/unit/core/FocusHistory.test.ts` (lines 41-50) already uses.
    *Check:* `npm test`.

14. **Docs.** Apply the seven edits in `## Documentation Impact`.
    *Check:* `npm run docs:api` — zero warnings; `npm run docs:llms` then confirm `packages/lib/llms.txt` regenerated cleanly.

15. **Regression sweep.** `npm run lint`, then confirm `tests/component/table/ColumnFilterRow.test.ts`, `tests/component/container/leaves.smoke.test.ts`, `tests/component/dispose-full-teardown.test.ts`, and `tests/component/default-options-fallback.test.ts` all pass **unmodified**.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Create | `packages/lib/src/typescript/lib/component/container/MenuRow.ts` |
| Create | `packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts` |
| Create | `packages/lib/tests/component/container/MenuRow.test.ts` |
| Create | `packages/lib/docs/components/CheckboxMenuRow.md` |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuItem.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuSeparator.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/index.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` |
| Modify | `packages/lib/tests/overlay/Menu.test.ts` |
| Modify | `packages/lib/tests/component/menubar/MenuBar.test.ts` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/docs/components/MenuItem.md` |
| Modify | `packages/lib/docs/components/index.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/llms.txt` (regenerated, not hand-edited) |
| Modify | `packages/docs/src/content/pages.ts` |

Nothing is deleted. `MenuButton.ts`, `SplitButton.ts`, `ToolBar.ts`, `TabBar.ts`, `Table.ts`, `NotificationHistoryButton.ts`, `Filter.ts`, `LayerManager.ts`, and `Checkbox.ts` are untouched.

---

## Expected Behaviour

Every item below is unit-testable against the offline DOM (`installTestDOM`). The one behaviour that is not is called out under `## Verification` as a manual smoke test.

**`MenuRow` base defaults** — construct a bare `class TestRow extends MenuRow {}` with no overrides:

1. `isSeparator()` is `false`, `isEnabled()` is `true`, `isNavigable()` is `false`.
2. `hasCheck()`, `hasIcon()`, `hasSubmenu()` are all `false`; `titleTextWidth()`, `shortcutTextWidth()`, `getContentWidth()` are all `0`.
3. `setColumns(16, 24, 100)` does not throw and changes nothing observable; `activate()` does not throw; `getPreferredSize()!.height` is `MenuRow.HEIGHT`.

**`Menu` builds and owns the row** — rebuild mode via `menu.show(0, 0, configs)`:

4. `{ row: () => new TestRow() }` puts the returned instance into `menu.getComponents()` and into the item list, and the factory ran exactly once.
5. A second `show()` with a fresh factory disposes the first row and calls the second factory. Assert the disposal exactly as the existing `'Menu item teardown — disposes every replaced item, separators included'` block does (`Menu.test.ts:970-1005`): render the first row, capture its id, confirm `_ruleCacheKeys()` holds a `'#' + id` key, reshow, and confirm the key is gone.
6. `{ separator: true, row: f }` builds a `MenuSeparator` and never calls `f`.
7. `{ row: f, text: 'Bold', action }` builds `f()`'s row; `action` is never called.
8. A menu of only `MenuItemConfig`s produces exactly today's item list and today's panel width — the regression case, covered by the existing `'Menu content-based width'` tests passing unmodified.

**Column geometry:**

9. `show(0, 0, [{ text: 'Bold' }, { row: () => rowReporting(300) }])` gives `menu.getMenuWidth() === 300`; with the custom row reporting `900` it gives `360`; with it reporting `0` the width is whatever the `MenuItem` alone produced. Keep the row count small enough that the panel does not overflow its viewport room, so no scrollbar gutter is added to the width — the same condition the existing `'Menu content-based width'` tests rely on.
10. Every non-separator row, custom rows included, receives `setColumns` with the same `checkZone` / `iconStart` / `titleColumn` triple.
11. A custom row reporting `hasCheck() === true` widens `iconStart` for the `MenuItem`s beside it by `MenuItem.CHECK_ZONE` — the opt-in half of the column contract.

**Keyboard traversal** — persistent mode via `new Menu(configs, onClose)`:

12. `focusItem(0); focusNext();` skips a `{ row: … }` entry whose `isNavigable()` is `false` and lands on the next `MenuItem`; `getFocusedIndex()` is that item's index. The same holds for `focusPrev()`.
13. `focusNext()` **does** land on a `{ row: … }` entry whose `isNavigable()` is `true`, and `activateFocused()` then calls that row's `activate()`. With `isNavigable()` `false`, `activateFocused()` on that index calls nothing.

**`MenuBar` key yielding** — open a dropdown, then dispatch a keydown through the viewport listeners:

14. `key: 'ArrowDown'` with the event target **outside** the panel moves the panel's focused index (today's behaviour, unchanged).
15. `key: 'ArrowDown'` with the event target **inside** the open panel leaves `panel.getFocusedIndex()` unchanged, and the bar does not `preventDefault`.

**`CheckboxMenuRow`:**

16. Constructed with `{ text: 'Bold', checked: true }`, `isChecked()` is `true`; with `checked` omitted it is `false`.
17. `activate()` flips `isChecked()`; a second `activate()` flips it back.
18. A `click` whose target is the row element toggles it exactly once.
19. A `listeners: { action }` handler fires once per toggle and reads the **new** value from `isChecked()`.
20. `getContentWidth()` is greater than `MenuItem.TEXT_INSET + MenuItem.RIGHT_PAD` for a row with a label (its checkbox has non-zero preferred width), and does not change after `setColumns` is called.
21. `setColumns(0, 40, 100)` followed by a layout moves the checkbox's `getX()` to `40` plus the row's content-box left edge; without `setColumns` it sits at `MenuItem.TEXT_INSET`.
22. Activating a `CheckboxMenuRow` inside an open rebuild-mode menu leaves `LayerManager.getTopLayer()` equal to the menu — the row never closes the panel. Calling the row's inherited close path (via a test subclass that calls the protected `closeMenu()`) does close it.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean, including `local/no-raw-dom` (the `MenuBar` guard's `DOM.source.intern` is the seam) and `local/require-content-bounds` (`CheckboxMenuRow.doLayout` reads `getContentBounds()`).
- `npm test` — the whole suite. These must pass **unmodified**, as the backward-compatibility proof: `tests/overlay/Menu.test.ts`'s existing blocks, `tests/component/menubar/MenuBar.test.ts`, `tests/component/container/leaves.smoke.test.ts`, `tests/component/table/ColumnFilterRow.test.ts`, `tests/component/dispose-full-teardown.test.ts`, `tests/component/default-options-fallback.test.ts`.
- `grep -n "instanceof MenuItem" packages/lib/src/typescript/lib/overlay/Menu.ts` — zero matches.
- `grep -rn "isItemSeparator" packages/lib/src/` — zero matches.
- `grep -n "_cssVarPrefix" packages/lib/src/typescript/lib/component/container/MenuItem.ts` — zero matches.
- `npm run build:lib` — clean.
- `npm run docs:api` — zero warnings.
- **Manual smoke test** (`npm run dev`, http://localhost:8015 — the offline harness cannot exercise real DOM focus or native caret movement): add a temporary `MenuBar` menu whose `items` include `{ row: () => TextFieldMenuRow(…) }` — a throwaway `MenuRow` subclass holding a `TextField` with `isNavigable()` left at its default. Open the dropdown, click into the field, and confirm: typing works, Left/Right move the caret rather than switching top-level menus, Up/Down do not move the menu highlight, Enter does not activate a menu item, Escape closes the menu, and clicking inside the field does not dismiss the panel. Remove the throwaway row afterwards.

---

## Documentation Impact

1. **`packages/lib/docs/components/Menu.md`** — add a `row` line to the "## Item config" table (after `separator`): *"A zero-argument factory returning a `MenuRow`; the menu renders that component instead of a `MenuItem` and ignores every other field."* Add a "## Custom rows" section after it, following the shape of `List.md`'s "## Item renderers" section (lines 54-79): what `MenuRow` is, the factory-not-instance rule, the `isNavigable()` default and what it means for arrow keys, the column opt-out plus `getContentWidth()`, and a `CheckboxMenuRow` code sample.
2. **`packages/lib/docs/components/MenuItem.md`** — add a `row` line to its config-shape table with the same one-sentence description and a link to Menu.md's new section.
3. **`packages/lib/docs/components/CheckboxMenuRow.md`** (new) — follow `MenuSeparator.md`'s page shape: what it is, a usage sample building a multi-select menu, the options table (`text`, `checked`, `listeners.action`), the `on("action")` surface, and a "See also" block linking `Menu`, `MenuItem`, and `Checkbox`.
4. **`packages/lib/docs/components/index.md`** — two rows in the "## Menus" table (lines 121-129): `MenuRow` → `/api/component/container/classes/MenuRow`, "Base class for a menu row; extend it to put custom content in a menu"; `CheckboxMenuRow` → `/components/CheckboxMenuRow`, "Menu row holding a real checkbox, for a multi-select menu".
5. **`packages/docs/src/content/pages.ts`** — add `{ path: '/components/CheckboxMenuRow', label: 'CheckboxMenuRow' }` to the `componentsMenus` array (lines 249-255). `MenuRow` gets no nav entry: it is documented inside `Menu.md`, the way `ListItemRenderer` is documented inside `List.md`.
6. **`packages/lib/docs/reference/changelog/next.md`** — a `### Menus` subsection under `## Added` with two bullets: **`MenuRow`**, the new base class letting a `MenuItemConfig` carry `row: () => MenuRow` so a menu can host arbitrary component content (existing configs are unaffected; `MenuItem` and `MenuSeparator` now extend it, with no public-surface change), and **`CheckboxMenuRow`**, a row hosting a real `Checkbox` that toggles without closing the menu.
7. **`packages/lib/scripts/llms/manifest.data.mjs`** — one entry in the `Overlays` section after `Menu`: `{ task: "Checkbox row inside a menu (multi-select menu)", symbol: "CheckboxMenuRow" }`. Regenerate with `npm run docs:llms`; never hand-edit `llms.txt`.

Per CODE_CONVENTIONS.md, public JSDoc must not `{@link}` a `protected` member — describe `closeMenu()` and `getCssVarPrefix()` in prose from any exported symbol's docs rather than linking them.

---

## Potential Challenges

- **A factory returning a cached instance breaks on the second show.** `showAnchored` disposes the previous item list before rebuilding, so a reused instance is dead. Mitigation: the `row` field's JSDoc states the rule, and Expected-Behaviour item 5 pins the dispose.
- **`MenuRow.ts` and `MenuItem.ts` reference each other.** `MenuRow` needs the `MenuItemCSSVarPrefix` type, `MenuItem` needs the `MenuRow` value. Mitigation: `MenuRow.ts` uses `import type`, which is erased, so no runtime cycle exists — exactly what `MenuSeparator.ts` already does for the same type.
- **Hovering a custom row does not close an open sibling submenu.** `MenuItem`'s hover signals the parent through `_onOpenSubmenu`; a custom row has no such wiring, so a submenu opened from a neighbouring item stays visible over the panel. The click still lands correctly (`LayerManager` treats the parent panel as the submenu's anchor). Mitigation: none in this plan — the combination is rare, and the fix costs either a duplicate hover listener on every `MenuItem` or a hook `MenuItem` would have to opt out of. Documented in `Menu.md`'s "## Custom rows" section as a known limitation.
- **`Checkbox.setSelected` before mount logs a console warning.** It synthesises a `click` on its own element and warns when there is no element yet ([`Checkbox.ts:250-252`](../packages/lib/src/typescript/lib/component/input/Checkbox.ts#L250)). A test that constructs a `CheckboxMenuRow` and calls `setChecked` without rendering will see the warning. Mitigation: the constructor seeds the initial state through the `Checkbox` options bag, not `setSelected`, so only a pre-render `setChecked` can trigger it; render the row in the tests that flip it.
- **The `MenuBar` guard must not swallow Escape's close.** It returns before the `switch`, so `MenuBar.closeMenu()` is skipped — but `LayerManager`'s Escape handler ([`LayerManager.ts:540-556`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L540)) calls `requestClose()` → `dismissAll()` → the panel's `onClose`, which `MenuBar` set to `() => this.closeMenu()` ([`MenuBar.ts:185`](../packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L185)). Same outcome; verified by reading, and pinned by the manual smoke test.
- **`setColumns`'s unused parameters.** `CheckboxMenuRow` uses only `iconStart`. Name the other two `_checkZone` / `_titleColumn` so the unused-parameter lint rule stays quiet.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/list/ListItemRenderer.ts`](../packages/lib/src/typescript/lib/component/list/ListItemRenderer.ts) — **the precedent `MenuRow` mirrors:** an abstract `Component` subclass driven by its container through fixed lifecycle calls, with `getContentWidth()` (line 68) returning 0 as the "no intrinsic width" default.
- [`packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts) — `_rendererFactory` (771), `setRendererFactory` (1281), `syncRows` (1534), and `SelectableListRow` (271, renderer made `pointer-events: none` at 304): the zero-argument-factory shape and the pointer-inert-child arrangement `CheckboxMenuRow` reuses.
- [`packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts`](../packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts) — the library's other pluggable-content base; `getContentX` (73) and `getDisplayText` (91) are the same defaults-in-the-base pattern.
- [`packages/lib/src/typescript/lib/overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts) — `_menuItems` (125), `layOutColumns` (202-227), `showAnchored` (279, loop 288-303), `clearItemHighlights` (633), `focusNext` (705) / `focusPrev` (731), `activateFocused` (757), `buildPersistentItems` (921-938), `setFocusedIndex` (945), `isItemSeparator` (971), `dismissAll` (1006), `handleItemOpenSubmenu` (1092).
- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts) — `MenuItemConfig` (41), the class (130), `HEIGHT` and the zone constants (133-150), `_cssVarPrefix` (155), the constructor (187-333), `setColumns` (404), `setFocused` (426), `isSeparator` (441), `isEnabled` (450), `activate` (460), `doLayout` (557).
- [`packages/lib/src/typescript/lib/core/LayerManager.ts`](../packages/lib/src/typescript/lib/core/LayerManager.ts) — `containsAcrossLayers` (301), `handleOutside` (448), `onKeyDown` (540): **the confirmation that outside-click dismissal already handles embedded controls,** and the containment call `MenuBar`'s guard reuses.
- [`packages/lib/src/typescript/lib/component/menubar/MenuBar.ts`](../packages/lib/src/typescript/lib/component/menubar/MenuBar.ts) — `_onKeyDown` (90-134), the viewport registration (243-246), the `new Menu(items, onClose)` call (185).
- [`packages/lib/src/typescript/lib/component/input/Checkbox.ts`](../packages/lib/src/typescript/lib/component/input/Checkbox.ts) — `CheckboxOptions` (22), `activate` (195), `setSelected` and its synthetic click (231-254), the `tabIndex(0)` (126) and box-owned click (136) that make it a real focusable control.
- [`plans/framework-focus-traversal.md`](framework-focus-traversal.md) — **deferred, and its deferral is load-bearing here:** the library owns no Tab handler, so native traversal reaches a control inside a menu row without arbitration. Its arbitration table is the model this plan's keyboard-routing table follows.
- [`plans/menu-item-close-on-activate-flag.md`](menu-item-close-on-activate-flag.md) — the sibling plan; read for the `Menu` / `MenuItem` background and the `Checkbox.activate()` self-toggle precedent.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — `callable()` export rule, typed-setter rule, options-bag-as-cache rule and its "framework-managed fields stay off the bag" carve-out, the named-function listener rule.

---

## Non-Goals

- **Migrating any existing consumer to the new API.** `MenuButton`, `SplitButton`, `MenuBar`, `ToolBar`, `TabBar`, `Table`, `NotificationHistoryButton`, and `Filter.ts` keep passing plain `MenuItemConfig[]`, and none of them is edited — except `MenuBar`, which gains the key-yield guard and nothing else.
- **Submenus on a custom row.** Only a `MenuItem` signals `handleItemOpenSubmenu`; `MenuRow.hasSubmenu()` reports `false` and there is no hook to open a child panel. Adding one would mean giving every row type the submenu lifecycle for a case nothing needs.
- **A second worked row type** (text field, slider, colour swatch). One row type proves the interface; more would repeat it. The non-navigable half of the contract is covered by the `MenuBar` guard tests and the `focusNext` skip tests instead.
- **A framework Tab-traversal service.** `plans/framework-focus-traversal.md` owns that and is deliberately deferred; this plan relies on the browser's native traversal reaching controls inside a menu panel.
- **Any change to `LayerManager`, `getDismissMode`, or the outside-click / Escape / window-blur path.** Confirmed correct as-is.
- **Row pooling or virtualization.** Menus are short-lived and small; `AbstractSelectableList`'s `_rowPool` machinery is deliberately not borrowed, only its factory shape.
- **Closing the hover / sibling-submenu gap** described in `## Potential Challenges`.

---

## Implementation Notes

Five deviations from the plan's literal text, all discovered during implementation:

- **`CheckboxMenuRow`'s constructor reads `options?.text` / `options?.checked` (the raw constructor parameter), not `this._options.text` / `this._options.checked`** as `## Internal Structure`'s snippet showed. `Component._options` starts empty and is populated only by a setter `applyOptions` dispatches; `CheckboxMenuRow` defines no `applyOptions` override for `text` (no setter exists for it) or `checked` (its setter, `setChecked`, writes straight to `_checkbox`, which cannot exist yet during the `super()` cascade — the same cascade trap `CODE_CONVENTIONS.md` documents for cascade-written fields). Reading the raw parameter instead sidesteps the trap entirely and mirrors how `MenuItem` reads its own `config` parameter directly rather than through `_options`. Confirmed by a failing test before the fix: a `{ checked: true }` row read back `isChecked() === false`.
- **`MenuBar`'s new key-yielding tests call the private `_onKeyDown` handler directly** (`(bar as any)._onKeyDown(event)`), rather than dispatching through `DOM.sink.dispatchEvent(DOM.source.getWindow(), event)` as `## Ordered Implementation Steps` item 13 specified. `MenuBar.test.ts`'s own pre-existing tests (unrelated to this plan) leave several bars "open" without ever calling `closeMenu()`; `Event`'s `viewportListenerMap` gate for a given type is module state that outlives `DOM.reset()`, so by the time the new tests ran, the window-level capture listener was never re-attached to the current (post-reset) sink and a real dispatch silently failed to route — confirmed empirically (the "outside the panel" case's `focusedIndex` never moved). Calling `_onKeyDown` directly, mirroring `Tree.test.ts` / `DiagramView.test.ts`'s established pattern for testing a private DOM-event handler offline, exercises the same guard logic without depending on that cross-test state. Because the call is direct, the dispatcher's disposition-translation layer never runs, so "does not preventDefault" is asserted on the handler's own returned `Event.ListenerResult` disposition (its documented contract) instead of a `preventDefault` spy.
- **`packages/lib/scripts/llms/generate.mjs`'s `TOKEN_BUDGET` moves from 6000 to 6100.** The site-URL manifest variant (`../docs/public/llms.txt`) was already at ~5994/6000 tokens before any change in this plan — a pre-existing, unrelated near-full budget. Even a minimally-worded `CheckboxMenuRow` catalog entry (task text and the class's JSDoc lead paragraph both tightened to fit) still crossed the prior ceiling. Raised by the minimum needed rather than trimming existing hand-authored catalog entries or prose blocks, which are outside this plan's scope and outside this implementer's editorial authority over `manifest.data.mjs`'s hand-curated wording.
- **`packages/lib/docs/reference/changelog/next.md` gains its two `MenuRow` / `CheckboxMenuRow` bullets under the existing `### Menu` subsection**, not a new `### Menus` subsection as `## Documentation Impact` item 6 specified. The sibling plan `menu-item-close-on-activate-flag` landed a `### Menu` (singular) subsection under `## Added` before this plan ran; a second, near-duplicate `### Menus` (plural) heading immediately beside it would read as a mistake rather than a deliberate grouping.
- **`Menu.buildPersistentItems`'s `row` branch also excludes `config.separator === true`** (`if (config.row && config.separator !== true)`), which the plan's own `## Internal Structure` snippet for that method did not — the snippet checked only `config.row`. Following it verbatim let `{ separator: true, row: f }` build the factory row in persistent mode, contradicting the "`separator` wins" precedence the plan's own Architecture Decisions config-entry table states as a general rule (and which `showAnchored`'s rebuild-mode loop, and this class's own `MenuItemConfig.row` JSDoc, both already implement/claim). Caught by audit round 1; fixed to match the stated contract, with a new persistent-mode test (`Menu.test.ts`, "separator wins over row in persistent mode too") alongside the pre-existing rebuild-mode one.

**Manual verification** (per `## Verification`'s required manual smoke test): performed live via a temporary `TextFieldMenuRow` (a `MenuRow` subclass holding a `TextField`, `isNavigable()` left at its default) added to the `MenuBar` sandbox demo (`packages/lib/src/typescript/MenuBarPanel.ts`, reverted afterward — not part of any commit), driven with `npm run dev` + chrome-devtools on a scratch port. Confirmed: typing into the field works; `ArrowLeft` moves the caret (11→10) rather than switching top-level menus (the "Test" menu stayed expanded and focused throughout); `ArrowDown` does not move any menu highlight or close the panel; `Enter` does not activate a menu item or close the panel; clicking into the field does not dismiss the panel; `Escape` closes the menu. All six match the plan's documented expectations.

## Notes

[^base-class]: A plain interface (the shape [`DismissableLayer`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L41) uses — required methods plus optional ones the coordinator calls with `?.()`) was the alternative. It was rejected on two counts. First, defaults: `Menu` calls eleven methods on a row, of which a custom row typically cares about two or three; an interface forces every implementer to write nine stubs, or forces `Menu` to carry eleven `?.() ?? default` fallbacks. An abstract base puts each default in exactly one place, which is what `ListItemRenderer.getContentWidth()` and `CellRenderer.getContentX()` already do for the same problem. Second, a row must be a `Component` regardless — `Menu` registers it with `addComponent` so recursive teardown reaches it — so the base class costs no freedom the interface would have preserved, beyond the ability to extend some *other* concrete component. Nothing a menu row plausibly wants to be (`Panel` adds only the non-content-clamping carve-out, which a fixed-height row does not want) is lost.

[^in-band]: The alternative was a discriminated union at the array-element level — `type MenuEntry = MenuItemConfig | MenuRowConfig` — and widening every signature that takes `MenuItemConfig[]`. That would touch `Menu.show`, `Menu.toggleFor`, the `Menu` constructor, `MenuConfig.items`, `MenuButton.setMenuItems` / `getMenuItems`, `SplitButton.setMenuItems` / `getMenuItems` / `MenuItemConfig[]` field, and each of their doc pages — for no behavioural gain, and against the hard constraint that no existing consumer changes. The in-band field also has direct precedent in the very interface it extends: `separator: true` already means "ignore every other field on this object", and `submenu` already means "ignore `action`". Adding a third such field is the shape the type already has.

[^factory]: The instance form was considered because it reads better at the call site (`{ row: myCheckboxRow }`). It is unsafe here: rebuild-mode `show()` calls `disposeAllComponents()` before every rebuild, and persistent mode does the same on every provider re-resolve, so the caller's instance is disposed the first time the menu is reshown and silently renders nothing afterwards. A lifetime rule ("don't reuse the object you passed") is exactly the kind of trap a zero-argument factory removes by construction, which is why `AbstractSelectableList` takes `() => ListItemRenderer` rather than a renderer.

[^navigable]: Three arrangements were weighed for a row hosting a real control. **Menu defers to the row** — the row somehow claims arrow keys and Enter while Menu keeps the highlight — needs an arbitration channel Menu does not have: `Menu` cannot resolve a focused element back to a `Component` (the same limitation `plans/framework-focus-traversal.md` records, which is why its Tab-owner claim is a DOM attribute), and it would leave two focus indicators on screen at once. **Menu skips the row entirely** is what this plan does: the row is out of the roving model, the platform's own focus and key handling apply inside it unmodified, and the only integration cost is the one `MenuBar` guard. **A tri-state** ("navigable, focus-capturing, or skipped") was rejected as a third state nothing distinguishes: a row that captures focus is, from `Menu`'s side, precisely a row `Menu` does not navigate to. The default is `false` because the failure mode of the wrong default is asymmetric — a wrongly-navigable row is an invisible dead stop for the arrow keys (the base `setFocused` paints a highlight the row's own children may cover, and Enter does nothing), while a wrongly-skipped row is merely pointer-only and its author reads one line of docs to opt in.

[^menubar-yield]: The guard is the only edit to an existing consumer in this plan, and it is behaviour-preserving today, which is what keeps the "zero changes required of consumers" constraint intact: no config-built row is focusable (a `MenuItem` is a `<div>` with no `tabindex`, its five labels are `pointer-events: none`), and the panel is portaled to `documentElement` while `MenuBar` itself holds `tabIndex` 0 — so `containsAcrossLayers(panel, target)` is false for every keydown a `MenuItemConfig` menu can produce. Expected-Behaviour item 14 pins that. The alternative — leaving `MenuBar` alone and declaring custom rows pointer-only inside a `MenuBar` dropdown — was rejected because it would make the feature silently half-broken in one of its two hosts, with no diagnostic: the user types and nothing happens.

[^injection]: Both injected values have to arrive after construction, because the factory is zero-argument by [^factory] and a caller cannot know which menu will host the row. A public setter that only the owning container is meant to call already exists in this exact family — [`MenuItem.setColumns`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L404) is public and called from nowhere but `Menu.layOutColumns` — so the pattern is established rather than invented. The close handler is not speculative: a custom row has no reference to its menu, and for a `MenuBar` dropdown or a `MenuButton` the `Menu` instance is private to the consumer component, so without it a row could never dismiss the panel and the omission would be unfixable without changing the base class later. Bundling the two into a single `MenuRowContext` object was considered and dropped — two typed setters match the codebase's setter culture and read the same at the two call sites.

[^worked-example]: A doc-only example was the alternative. It was rejected because the interface's sharp edges are exactly the parts a fence would elide: that `getContentWidth()` is read before `setColumns()` and so must not depend on it; that the hosted control has to be `pointer-events: none` for row-wide clicking to work; that a bag-supplied `action` listener must register after the row's own toggle to observe the new value. Each of those is a real ordering rule, each is testable, and each would be re-derived wrongly by the first consumer to try. `CheckboxMenuRow` also covers the most likely actual request — a multi-select menu — so it is not scaffolding kept alive for its own sake.

[^plan-one]: `menu-item-close-on-activate-flag` adds `closeOnActivate?: boolean` to `MenuItemConfig` and branches the two `onActivate` closures `Menu` passes into `new MenuItem(...)`. This plan rewrites the surrounding loops but leaves those closures' bodies textually as they are today, so whichever lands second re-applies the other's change inside the branch it kept. The features are orthogonal: `closeOnActivate` governs whether an *activated `MenuItem`* closes the panel, while a factory row never reaches `onActivate` at all and stays open unless it calls the injected close handler. There is no ordering requirement in either direction, so `depends-on` is deliberately empty and only `touches-shared` is declared.
