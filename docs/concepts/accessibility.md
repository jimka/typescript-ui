# Accessibility

Every [`Component`](/api/core/classes/Component) exposes ARIA attributes through a typed [`Aria`](/api/core/classes/Aria) accessor. The framework also provides [`RovingTabIndex`](/api/core/classes/RovingTabIndex) for keyboard navigation across grouped controls. The built-in components wire both correctly out of the box; this page is for when you build custom UI.

## ARIA via Component.getAria()

Each component has its own [`Aria`](/api/core/classes/Aria) instance. Get it with `getAria()`:

```typescript
import { Component } from '@jimka/typescript-ui/core';
class CustomGrid extends Component {
    constructor() {
        super('div');
        this.getAria().setRole('grid');
        this.getAria().setRowCount(100);
    }
}
```

`Aria` is a typed wrapper, not a string-based attribute setter — every WAI-ARIA attribute the framework supports has its own getter and setter:

```typescript
component.getAria().setRole('button');
component.getAria().setSelected(true);
component.getAria().setLabel('Save');
component.getAria().setExpanded(false);
component.getAria().setHasPopup('menu');
```

State you set before the DOM exists is replayed onto the element when it's first rendered. After render, sets propagate immediately.

See [`Aria`](/api/core/classes/Aria) for the full list of attribute methods.

## Roles used by built-in components

The framework sets WAI-ARIA roles automatically for its components. Some highlights:

| Component | Role |
| --- | --- |
| [`Table`](/components/Table) | `grid` (with `rowgroup`, `row`, `gridcell`, `columnheader` on its parts) |
| [`Tree`](/components/Tree) | `tree` with `treeitem` rows |
| [`Tab`](/layouts/Tab) | `tablist` / `tab` / `tabpanel` |
| [`MenuBar`](/components/MenuBar) | `menubar` / `menu` / `menuitem` |
| [`Menu`](/components/Menu) | `menu` / `menuitem` / `separator` |
| [`Button`](/components/Button) | inherits the native `<button>` semantics |
| [`ComboBox`](/components/ComboBox) | `combobox` (with the underlying `<select>` providing the listbox) |

You don't need to set these on built-in components; they're applied at construction time.

## Keyboard navigation: RovingTabIndex

[`RovingTabIndex`](/api/core/classes/RovingTabIndex) implements the standard pattern where exactly one item in a group has `tabindex=0` at any time, and arrow keys move focus among the items:

```typescript
import { RovingTabIndex } from '@jimka/typescript-ui/core';
const tabs = new RovingTabIndex();
tabs.add(button1);
tabs.add(button2);
tabs.add(button3);

tabs.moveTo(0); // button1 is now the active item
```

`moveTo` does three things:

1. Sets `tabindex=-1` on the previous active item.
2. Sets `tabindex=0` on the new active item.
3. Calls `focus()` on the new active item's DOM element.

[`ButtonGroup`](/components/ButtonGroup) uses `RovingTabIndex` automatically for [`ToggleButton`](/components/ToggleButton) groups when you call `setContainer(container)`. For [`RadioButton`](/components/RadioButton) groups, the browser's built-in radio-group navigation handles arrow keys, so `RovingTabIndex` isn't needed.

## Building an accessible custom widget

A custom selectable list is the simplest non-trivial case:

```typescript
import { Component, Event, RovingTabIndex } from '@jimka/typescript-ui/core';
class SelectableList extends Component {
    private items: Component[] = [];
    private rti = new RovingTabIndex();

    constructor() {
        super('ul');
        this.getAria().setRole('listbox');
        Event.addSubtreeListener(this, 'keydown', (e: KeyboardEvent) => this.onKey(e));
    }

    addItem(item: Component): void {
        item.getAria().setRole('option');
        this.addComponent(item);
        this.items.push(item);
        this.rti.add(item);

        Event.addListener(item, 'click', () => this.select(item));
    }

    private select(item: Component): void {
        for (const i of this.items) i.getAria().setSelected(false);
        item.getAria().setSelected(true);
        this.rti.moveTo(this.items.indexOf(item));
    }

    private onKey(e: KeyboardEvent): void {
        const idx = this.items.findIndex(i =>
            i.getElement() === document.activeElement);
        if (idx === -1) return;

        if (e.key === 'ArrowDown' && idx < this.items.length - 1) {
            this.select(this.items[idx + 1]);
            e.preventDefault();
        }
        if (e.key === 'ArrowUp' && idx > 0) {
            this.select(this.items[idx - 1]);
            e.preventDefault();
        }
    }
}
```

The pattern: set the role, manage `aria-selected` on items, wire arrow keys via `addSubtreeListener`, and let `RovingTabIndex` handle tab focus.

## Live announcements

For dynamic announcements (toasts, status messages), the framework's [`Notification`](/components/Notification) component is the right tool — its container has `role="alert"` semantics so screen readers announce new toasts as they appear.

For your own live regions, set the role:

```typescript
const status = Component();
status.getAria().setRole('status');
```

`role="status"` implies `aria-live="polite"` and `aria-atomic="true"` per the [ARIA spec](https://www.w3.org/TR/wai-aria/#status), so screen readers announce updates without any further configuration. `Aria` exposes typed setters for every ARIA attribute the framework writes — if you need one that isn't there yet, extend `Aria` in `src/typescript/lib/core/Aria.ts` rather than reaching into the now-protected `setElementAttribute`.

## Testing

- **Keyboard-only** — unplug your mouse and verify every interaction works with `Tab`, `Shift+Tab`, arrow keys, and `Space`/`Enter`.
- **Screen reader** — VoiceOver (macOS) and NVDA (Windows) are the two readers most commonly tested against. Both should announce roles and labels for built-in components correctly.
- **Browser dev tools** — Chrome's "Accessibility" panel under DevTools shows the computed accessibility tree for each element.

## See also

- [API: Aria](/api/core/classes/Aria), [AriaRole](/api/core/type-aliases/AriaRole), [AriaSort](/api/core/type-aliases/AriaSort)
- [API: RovingTabIndex](/api/core/classes/RovingTabIndex)
- [`ButtonGroup`](/components/ButtonGroup) — uses `RovingTabIndex` internally
