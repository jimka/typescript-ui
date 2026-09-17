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
| [`BulletedList`](/components/BulletedList) / [`NumberedList`](/components/NumberedList) | `list` with `listitem` rows (each row's bullet or number is `aria-hidden`, since position is already announced) |

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

## Tab traversal

[`FocusTraversal`](/api/core/namespaces/FocusTraversal) intercepts `Tab` /
`Shift+Tab`, computes the ordered set of tab stops inside the topmost overlay
layer (or `<body>` when none is open), and moves focus directly rather than
leaving it to the browser's own traversal. The browser's native traversal is
correct for almost every screen this framework renders, because the library
writes real focusable elements and real `tabindex` values — so, like
[`FocusHistory`](#keyboard-navigation-rovingtabindex), it is opt-in:

```typescript
import { FocusTraversal } from '@jimka/typescript-ui/core';

FocusTraversal.enable();
```

Tab order follows DOM order, which matches component-tree order (`addComponent`
always appends) but not necessarily *visual* order, since a layout manager can
paint children somewhere other than the sequence they were added in. A
container whose visual order must differ from its child order should reorder
the `addComponent` calls rather than reach for an explicit ordering option —
`FocusTraversal` deliberately has none.

A component that owns a third-party editing surface — one whose own keydown
handling treats Tab as something other than "move to the next stop," such as
an indent gesture or a cell-to-cell navigation — marks itself with
`setTabKeyOwner(true)`:

```typescript
this.setTabKeyOwner(true);
```

While focus is anywhere inside a Tab-key owner, the service leaves Tab alone
entirely, so the owner's own handling (CodeMirror's indent, a Lexical table's
cell navigation, [`Table`](/components/Table)'s own cell-to-cell Tab) keeps
working unmodified. Pressing `Escape` while focus is inside an owner arms a
one-shot release: the next `Tab` (or `Shift+Tab`) steps past the owner instead
of reaching it, so a keyboard user is never trapped inside one with no way
out. Any other keystroke, or focus moving elsewhere by any other means,
expires the release without arming it a second time.

`FocusTraversal.enable({ wrap: true })` wraps from the last stop back to the
first at the ends of the root; by default this only happens inside a modal
overlay (where focus must not escape to the page behind it) — on `<body>`, the
end of the traversal hands focus to the browser's own chrome, matching what a
keyboard user expects when they reach the end of the page.

A *stop* is a focusable element — a `<button>`, `<a href>`, `<input>`,
`<select>`, `<textarea>`, an element carrying `contenteditable`, or anything
with an explicit `tabindex` — that has not been taken out of the tab order
with `tabindex="-1"`. That last exclusion is what makes a roving-tabindex
group ([above](#keyboard-navigation-rovingtabindex)) contribute exactly one
stop rather than one per member: only the group's active member holds
`tabindex="0"`, and its roved-off siblings are skipped however they render,
including as native `<button>`s. A component that owns a third-party editing
surface contributes one stop too, since such a surface marks itself
`contenteditable` rather than carrying a `tabindex`.

## Spatial focus navigation

[`SpatialNavigation`](/api/core/namespaces/SpatialNavigation) moves keyboard focus by *direction* rather than by document order, ranking every candidate's rectangle against the focused element's and jumping to the nearest one in the pressed direction. Two chords run the same geometric search over different candidate sets:

- **`Ctrl+Alt`+arrow** (the **component** tier) moves to the nearest individual focusable element in that direction — a button, a field, a list row.
- **`Ctrl+Shift`+arrow** (the **target** tier) moves to the nearest container marked as a navigation target, and hands focus to that container's remembered — or first — focusable descendant.

It's opt-in, matching [`FocusHistory`](#keyboard-navigation-rovingtabindex)'s stance:

```typescript
import { SpatialNavigation } from '@jimka/typescript-ui/core';

SpatialNavigation.enable();
```

Both chords are matched on `KeyboardEvent.code` so they work the same regardless of keyboard layout. Each tier's modifier set is independently configurable — the arrow keys themselves are fixed, and a same-modifier collision between the two configured sets favours the component tier:

```typescript
SpatialNavigation.configure({ componentModifiers: { alt: true } });
```

`ToolBar`, `MenuBar`, and `TabBar` are marked as navigation targets by
default, since each is a self-contained chrome region a user would expect to
jump straight into — nothing else is, and `Split` panes and `Border` regions
are no longer navigable on their own. An app marks any other container it
wants the coarse tier to reach with `setNavigationTarget(true)`:

```typescript
this.setNavigationTarget(true);
```

A marked target remembers which descendant last held focus and returns focus there on the way back in; a target visited for the first time lands on its first focusable element instead. Navigating into a collapsed region or a scrolled-away control expands or scrolls it into view first, so a chord never lands focus somewhere invisible.

The service stands down while a transient overlay — an open dropdown, a modal dialog — is on top, so it never fights a combo-box list's own arrow handling or a dialog's focus trap. It keeps working between controls inside a non-modal window, since a window's dismiss mode doesn't count as blocking.

Any new arrow-key handler you add to a component must guard itself against both chords, so the widget and the service don't act on the same keypress at once:

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { SpatialNavigation } from '@jimka/typescript-ui/core';

Event.addListener(this, 'keydown', (e: KeyboardEvent): Event.ListenerResult => {
    if (SpatialNavigation.claimsKey(e)) {
        return; // the service owns this key; stand down.
    }

    // ...this widget's own arrow-key handling...
});
```

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

For dynamic announcements (toasts, status messages), the framework's [`Notification`](/components/Notification) component is the right tool — it sets an ARIA live role on its container so screen readers announce new toasts as they appear. Error and warning toasts use `role="alert"` / `aria-live="assertive"` (they interrupt); info and success toasts use `role="status"` / `aria-live="polite"` (they wait their turn).

For your own live regions, set the role:

```typescript
const status = Component();
status.getAria().setRole('status');
```

`role="status"` implies `aria-live="polite"` and `aria-atomic="true"` per the [ARIA spec](https://www.w3.org/TR/wai-aria/#status), so screen readers announce updates without any further configuration. `Aria` exposes typed setters for every ARIA attribute the framework writes — if you need one that isn't there yet, extend `Aria` in `src/typescript/lib/core/Aria.ts` rather than reaching into the now-protected `setElementAttribute`.

## Testing

- **Keyboard-only** — unplug your mouse and verify every interaction works with `Tab`, `Shift+Tab`, arrow keys, and `Space`/`Enter`; if [Tab traversal](#tab-traversal) is enabled, also check `Escape` then `Tab` escapes any Tab-key owner (an embedded editor, a table in edit mode); if [spatial focus navigation](#spatial-focus-navigation) is enabled, also check `Ctrl+Alt`+arrow and `Ctrl+Shift`+arrow move focus without disturbing a focused widget's own arrow-key behaviour.
- **Screen reader** — VoiceOver (macOS) and NVDA (Windows) are the two readers most commonly tested against. Both should announce roles and labels for built-in components correctly.
- **Browser dev tools** — Chrome's "Accessibility" panel under DevTools shows the computed accessibility tree for each element.

## See also

- [API: Aria](/api/core/classes/Aria), [AriaRole](/api/core/type-aliases/AriaRole), [AriaSort](/api/core/type-aliases/AriaSort)
- [API: RovingTabIndex](/api/core/classes/RovingTabIndex)
- [`ButtonGroup`](/components/ButtonGroup) — uses `RovingTabIndex` internally
- [Focus history navigation](/recipes/focus-history) — a keyboard back/forward accelerator over the app's focus trail, an opt-in aid for keyboard navigation

`back()` / `forward()` reveal a hidden trail entry before focusing it — selecting the `Tab` it lives in, expanding a collapsed `Border` region, `Accordion` section, or `Split` pane, and scrolling an `autoScroll` `Panel` — rather than silently failing to move focus onto an element the browser cannot currently see.
