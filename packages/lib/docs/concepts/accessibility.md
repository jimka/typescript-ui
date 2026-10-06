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
| [`Menu`](/components/Menu) | `menu` / `menuitem` / `separator`; a context menu opened from the keyboard takes focus and names its highlighted row with `aria-activedescendant` |
| [`Button`](/components/Button) | inherits the native `<button>` semantics |
| [`SplitButton`](/components/SplitButton) | native `<button>` with `aria-haspopup="menu"`, `aria-expanded` and `aria-controls` |
| [`ComboBox`](/components/ComboBox) | `combobox` (with the underlying `<select>` providing the listbox) |
| [`BulletedList`](/components/BulletedList) / [`NumberedList`](/components/NumberedList) | `list` with `listitem` rows (each row's bullet or number is `aria-hidden`, since position is already announced) |
| [`Dialog`](/components/Dialog) | `dialog`, or `alertdialog` for `Dialog.confirm` / `Dialog.warning` / `Dialog.error`; named by its title, described by its message |
| [`Window`](/components/Window) / [`TabWindow`](/components/TabWindow) | `dialog`, non-modal; named by the header text, or by the active tab's label |
| [`Drawer`](/components/Drawer) / [`Popover`](/components/Popover) / [`PopupPanel`](/components/PopupPanel) | `dialog`; a `Popover` is named by its title, a `PopupPanel` by the button that opens it, a `Drawer` by you |

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

A [`Tab`](/layouts/Tab) layout's strip is one such group, so the whole strip is
a single Tab stop however many tabs it holds. `ArrowLeft` / `ArrowRight` move
focus along it and activate the tab they land on, and `Delete` closes the
focused tab when that tab is `closeable` — on a tab that is not, the key does
nothing and keeps propagating. A closeable tab's ✕ is a member of the same
group rather than a Tab stop of its own, so it is reached with
[spatial navigation](#spatial-focus-navigation) (`Ctrl+Alt`+arrow) rather than
by tabbing, and `Delete` closes the tab from the ✕ just as it does from the tab
button.

A tab marked modified with
[`setTabModified`](/api/layout/classes/Tab#settabmodified) carries
`aria-description="Modified"`, so its unsaved state is announced as well as
drawn.

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
keyboard user expects when they reach the end of the page. Inside a modal
overlay that default now applies to `next()` and `previous()` only: a `Tab` key
press there is wrapped by `LayerManager`, as described below, and the service
leaves it alone.

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

A modal layer — a [`Dialog`](/components/Dialog), or a
[`Drawer`](/components/Drawer) built with `modal: true` — keeps the keyboard
inside itself, whether or not Tab traversal is enabled.
[`LayerManager`](/api/core/namespaces/LayerManager) does it, for every modal
layer alike, in two parts. The rest of the application carries the HTML
`inert` attribute, so the browser refuses to focus it by any route: `Tab`, a
click, or `focus()` from code. And `Tab` wraps at the edges, from the last stop
back to the first and from the first back to the last. A dropdown, menu or
popover opened from the modal is inside it: its stops join the same ring. See
[Modal scope](/concepts/layering#modal-scope) for what exactly goes inert.

The wrap follows the same Tab-key-owner rule. Whenever focus sits inside a
descendant that claims Tab, the wrap stands down and the descendant keeps the
key, so a [`CodeEditor`](/components/CodeEditor),
[`MarkdownEditor`](/components/MarkdownEditor) or [`Table`](/components/Table)
placed first or last in a dialog still indents or moves between cells instead
of having focus wrapped out from under it. A dialog's own claim over its whole
subtree does not trigger this: the search stops at the layer's element without
testing it, so only a descendant's claim counts. `Escape` inside an editing
surface in a dialog releases it for one `Tab` instead of closing the dialog,
and a second `Escape` closes it; inside a `Table` the first `Escape` does not
close the dialog either, but the table's own `Tab` handling can pull focus
back, so the `Tab` that follows is not guaranteed to leave it. Tab traversal
stands down while any modal layer is open.

## Spatial focus navigation

[`SpatialNavigation`](/api/core/namespaces/SpatialNavigation) moves keyboard focus by *direction* rather than by document order, ranking every candidate's rectangle against the focused element's and jumping to the nearest one in the pressed direction. Two chords run the same geometric search over different candidate sets:

- **`Ctrl+Alt`+arrow** (the **component** tier) moves to the nearest individual focusable element in that direction — a button, a field, a list row.
- **`Ctrl+Alt+Shift`+arrow** (the **target** tier) moves to the nearest container marked as a navigation target, and hands focus to that container's remembered — or first — focusable descendant.

It's opt-in, matching [`FocusHistory`](#keyboard-navigation-rovingtabindex)'s stance:

```typescript
import { SpatialNavigation } from '@jimka/typescript-ui/core';

SpatialNavigation.enable();
```

Both chords are matched on `KeyboardEvent.code` so they work the same regardless of keyboard layout. Each tier's modifier set is independently configurable — the arrow keys themselves are fixed, and a same-modifier collision between the two configured sets favours the component tier:

```typescript
SpatialNavigation.configure({ componentModifiers: { alt: true } });
```

Neither default chord touches native text editing, so `Ctrl+Shift+←`/`→` still selects by word in every text field and editor. Two collisions remain, and `configure` is the way around each:

- **`Ctrl+Alt+↑`/`↓`** is [`CodeEditor`](/components/CodeEditor)'s add-cursor-above/below on Windows and Linux. While the service is enabled, the chord moves focus instead. Alt+drag still makes a rectangular selection. macOS is not affected.
- **GNOME** binds `Ctrl+Alt`+arrow to switching workspace, and older releases bind `Ctrl+Alt+Shift`+arrow to moving the window to another workspace. The desktop takes the chord before the page sees it.

`ToolBar`, `MenuBar`, and `TabBar` are marked as navigation targets by
default, since each is a self-contained chrome region a user would expect to
jump straight into — nothing else is, and `Split` panes and `Border` regions
are no longer navigable on their own. An app marks any other container it
wants the coarse tier to reach with `setNavigationTarget(true)`:

```typescript
this.setNavigationTarget(true);
```

A marked target remembers which descendant last held focus and returns focus there on the way back in; a target visited for the first time lands on its first focusable element instead. Navigating into a collapsed region or a scrolled-away control expands or scrolls it into view first, so a chord never lands focus somewhere invisible.

The service stands down while a transient overlay — an open dropdown, a modal dialog — is on top, so it never fights a combo-box list's own arrow handling or a modal layer's focus containment. It keeps working between controls inside a non-modal window, since a window's dismiss mode doesn't count as blocking.

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

## Context menus from the keyboard

Shift+F10 and the ContextMenu key open the same menu a right-click opens. Which item the menu is for depends on what holds focus:

| Focus is on | The menu is for | It opens |
| --- | --- | --- |
| a control that holds focus itself — a button, a tab, a text field | that control | where the browser places the event: at the caret for a text field or an editor |
| a [`Tree`](/components/Tree#context-menu) | its current row | under that row, scrolled into view first |
| a [`List`](/components/List#context-menu) or a [`MultiSelectList`](/components/MultiSelectList) | its focused row | under that row, scrolled into view first |
| a [`Table`](/components/Table#keyboard) or a [`TreeTable`](/components/TreeTable) | its current cell | under that cell, scrolled into view first |

A tree, a list and a table body each hold focus on their own element and mark the current row or cell with `aria-activedescendant`, so the browser sends the key's `contextmenu` event to the widget and not to a row. The widget answers it for its current item. With no current item — for example, focus arrived with `Tab` and no arrow key was pressed yet, or the widget is empty — nothing opens. Neither the mouse nor the keyboard changes the selection by opening the menu.

The menu takes focus, is worked with the arrow keys, `Enter` and `Escape`, and returns focus to where it was when it closes — see [Menu: Keyboard](/components/Menu#keyboard).

## Keys in trees, lists and tables

A [`Tree`](/components/Tree#keyboard), a [`List`](/components/List#keyboard) or [`MultiSelectList`](/components/MultiSelectList#selection-model), and the body of a [`Table`](/components/Table#keyboard) or [`TreeTable`](/components/TreeTable#keyboard) are each one Tab stop. The widget's own element holds focus and takes these keys:

| Key | `Tree` | `List`, `MultiSelectList` | `Table` | `TreeTable` |
| --- | --- | --- | --- | --- |
| `ArrowUp` / `ArrowDown` | previous / next row | previous / next row | previous / next row | previous / next row |
| `Home` / `End` | first / last row | first / last row | first / last row | first / last row |
| `PageUp` / `PageDown` | up / down one page | up / down one page | up / down one page | up / down one page |
| `ArrowLeft` / `ArrowRight` | collapse / expand, or to the parent / first child | — | previous / next cell | collapse / expand, or to the parent / first child |
| `Enter` / `Space` | — | select the focused row | edit the current cell | edit the current cell |
| Printable character | — | type-ahead | — | — |
| `Shift+F10` / ContextMenu key | menu for the current row | menu for the focused row | menu for the current cell | menu for the current cell |

A page is the number of whole rows the widget shows, and at least one. The key moves the current row that far and scrolls it into view by the least distance. `Shift` with a row key extends the selection in a `Tree` and a `MultiSelectList`.

A key that moves the current row is the widget's own even when the row cannot move: `PageDown` on the last row changes nothing, and the browser does not scroll the page behind the widget. The key is not stopped, so a `keydown` listener on an ancestor still receives it. An empty widget leaves these keys alone, and so does a disabled or read-only `List` or `MultiSelectList`.

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

A custom overlay that mounts itself outside the component tree — on `<html>`, as the library's own overlays do — needs one more thing to behave around a modal dialog: it has to be a registered layer that implements `onInertChanged`, or a `BackgroundSurface`. Otherwise it stays focusable and clickable while a dialog is open, and when it is opened from a dialog its controls are not part of that dialog's `Tab` order. See [Modal scope](/concepts/layering#modal-scope).

## Dialogs and windows

Every layer that behaves like a dialog has the `dialog` role, so a screen reader announces it when focus enters it. What it is called depends on where its title lives:

| Layer | Named by | Follows a title change |
| --- | --- | --- |
| [`Dialog`](/components/Dialog) | `aria-labelledby` → the title bar's text | yes, `getTitleBar().getTitleText().setText(…)` |
| `Dialog` with `ariaLabel` | `aria-label`, and no `aria-labelledby` | fixed string |
| [`Window`](/components/Window) | `aria-labelledby` → the header's text | yes, `setHeaderText(…)` |
| [`TabWindow`](/components/TabWindow) | `aria-label` = the active tab's label | refreshed when the window is shown and each time it is activated |
| [`Popover`](/components/Popover) with a title | `aria-labelledby` → the title | yes, `setTitle(…)` |
| `Popover` without a title, [`Drawer`](/components/Drawer) | nothing by default | you call `getAria().setLabel(…)` |

A name given by reference follows the text it points at with no further code. It also outranks `aria-label` in a browser's name computation, so to replace it you remove the reference first: `window.getAria().clearLabelledBy().setLabel(…)`. A `Dialog` built from a `message` also points `aria-describedby` at that message, which a screen reader reads after the name and role. See [Dialog: Screen readers](/components/Dialog#screen-readers).

`Aria` has the accessors these need: `setDescribedBy(id)` / `getDescribedBy()` / `clearDescribedBy()` for `aria-describedby`, `clearLabelledBy()` as the removing companion of `setLabelledBy(id)`, and `'alertdialog'` among the roles.

### Naming an icon-only button

A button that shows only a glyph needs a name. Give it a `text` and hide the text from its face with `showText: false`: the [`Button`](/components/Button#showing-the-title-in-the-tooltip-only) then writes the text into `aria-label` and shows it as a hover tooltip, so a mouse user and a screen-reader user get the same word.

```typescript
Button({ glyph: 'xmark', text: 'Close', showText: false });
```

The library's own title-bar buttons are built this way: a dialog's close button, and a window's minimize, maximize, close and window-menu buttons. Their names are English. To change one, reach the button through its owner and call `setText`:

| Button | Reached through |
| --- | --- |
| `Dialog` close | `dialog.getTitleBar().getCloseButton()` (`null` on a non-dismissable dialog) |
| `Window` minimize / maximize / close | `win.getHeader().getMinimizeButton()` / `getMaximizeButton()` / `getCloseButton()` |
| `TabWindow` minimize / maximize / close / window menu | `tabWindow.getMinimizeButton()` / `getMaximizeButton()` / `getCloseButton()` / `getWindowMenuButton()` |

A window renames its minimize and maximize buttons to "Restore" as its state changes, but only while a button still carries a name the library gave it. A button you renamed keeps your name in every state.

A tool added to a [`Tab`](/layouts/Tab#tab-tools) strip from a descriptor is named by the descriptor's `label` in the same way.

### Why no `aria-modal`

A modal `Dialog` or `Drawer` does not carry `aria-modal="true"`. While one is open, the rest of the application is [inert](/concepts/layering#modal-scope), and `inert` takes that content away from a screen reader in every browser that supports it. `aria-modal` would hide more than that. It tells a screen reader to ignore everything that is not inside the dialog's own element, and the library mounts a dialog's dropdowns, menus and popovers beside the dialog, not inside it. On VoiceOver those would go silent, and so would a toast shown while the dialog is open. Do not add the attribute to a modal layer of your own.

## Live announcements

For dynamic announcements (toasts, status messages), the framework's [`Notification`](/components/Notification) component is the right tool — it sets an ARIA live role on its container so screen readers announce new toasts as they appear. Error and warning toasts use `role="alert"` / `aria-live="assertive"` (they interrupt); info and success toasts use `role="status"` / `aria-live="polite"` (they wait their turn).

For your own live regions, set the role:

```typescript
const status = Component();
status.getAria().setRole('status');
```

`role="status"` implies `aria-live="polite"` and `aria-atomic="true"` per the [ARIA spec](https://www.w3.org/TR/wai-aria/#status), so screen readers announce updates without any further configuration. `Aria` exposes typed setters for every ARIA attribute the framework writes — if you need one that isn't there yet, extend `Aria` in `src/typescript/lib/core/Aria.ts` rather than reaching into the now-protected `setElementAttribute`.

## Testing

- **Keyboard-only** — unplug your mouse and verify every interaction works with `Tab`, `Shift+Tab`, arrow keys, and `Space`/`Enter`; open a [context menu](/components/Menu#keyboard) with Shift+F10 and work it with the arrow keys, `Enter` and `Escape`, including on a tree row, a list row and a table cell; if [Tab traversal](#tab-traversal) is enabled, also check `Escape` then `Tab` escapes any Tab-key owner (an embedded editor, a table in edit mode); inside a [`Dialog`](/components/Dialog), check that `Escape` then `Tab` leaves an embedded editor whether or not Tab traversal is enabled; with a dialog open, check that `Tab` and `Shift+Tab` never reach the page behind, including after a click on the dialog's text; if [spatial focus navigation](#spatial-focus-navigation) is enabled, also check `Ctrl+Alt`+arrow and `Ctrl+Alt+Shift`+arrow move focus without disturbing a focused widget's own arrow-key behaviour.
- **Screen reader** — VoiceOver (macOS) and NVDA (Windows) are the two readers most commonly tested against. Both should announce roles and labels for built-in components correctly. With a [`Dialog`](/components/Dialog), listen for its title, then "dialog" or "alert dialog", then its message, as it opens; for "Close, button" on the title-bar button; and for each option of a dropdown opened inside the dialog, which must still be read.
- **Browser dev tools** — Chrome's "Accessibility" panel under DevTools shows the computed accessibility tree for each element.

## See also

- [API: Aria](/api/core/classes/Aria), [AriaRole](/api/core/type-aliases/AriaRole), [AriaSort](/api/core/type-aliases/AriaSort)
- [API: RovingTabIndex](/api/core/classes/RovingTabIndex)
- [`ButtonGroup`](/components/ButtonGroup) — uses `RovingTabIndex` internally
- [Focus history navigation](/recipes/focus-history) — a keyboard back/forward accelerator over the app's focus trail, an opt-in aid for keyboard navigation

Focus history records controls of the page, of windows and of non-modal drawers. Nothing inside a menu, a dropdown, a dialog, a modal drawer, or a popover that an outside click or focus move closes is a stop, and the accelerators stand down while one is open. A popover built with `dismissOn: "manual"` counts as a window does. `back()` / `forward()` reveal a hidden trail entry before focusing it — selecting the `Tab` it lives in, expanding a collapsed `Border` region, `Accordion` section, or `Split` pane, and scrolling an `autoScroll` `Panel` — rather than silently failing to move focus onto an element the browser cannot currently see. A scrolling `Panel` moves the least distance that shows the control, only along the axes it scrolls, and keeps the control clear of its border and scrollbars.
