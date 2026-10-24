# List

[`List`](/api/component/list/classes/List) is a single-selection scrollable list box rendered as a `<div role="listbox">` populated with `<div role="option">` rows. It implements [`Bindable<string>`](/api/core/interfaces/Bindable) so it can be plugged into a [`Binding`](/api/core/classes/Binding) directly.

<!-- demo: list-selection -->
> **Live demo** — a store-bound `List` of people's names, with a `Text`
> below showing the current selection.
> [Open the List page](https://jimka.github.io/typescript-ui/components/List)
<!-- /demo -->

## Usage

```typescript
import { List } from '@jimka/typescript-ui/component/list';
const fruits = List();
fruits.addItem('Apple');
fruits.addItem('Banana');
fruits.addItem('Cherry');
fruits.setPreferredSize({ width: 180, height: 120 });

fruits.on('action', () => {
    console.log('selected:', fruits.getValue());
});

panel.addComponent(fruits);
```

`addItem` / `setItems` also accept pre-formed `{ key, label }` pairs (a [`SelectableListItem`](/api/component/list/interfaces/SelectableListItem)) when each row needs an explicit, stable key instead of its positional index — e.g. `fruits.setItems([{ key: 'apple', label: 'Apple' }, 'Banana'])`. String entries are auto-keyed by array position; the caller owns key uniqueness.

## Keyboard

The list root is focusable; rows are not. Focus tracks the active row via `aria-activedescendant`.

| Key | Behaviour |
|---|---|
| `ArrowUp` / `ArrowDown` | Move focus and selection by one row. With no row focused yet, the first press lands on the first row. |
| `Home` / `End` | Jump to the first / last row. |
| `PageUp` / `PageDown` | Jump by the number of whole rows the list shows. |
| `Ctrl` (or `Cmd`) with any of the six keys above | Move focus without changing the selection. `Enter` or `Space` then selects the focused row. |
| `Enter` / `Space` | Commit the focused row. |
| Printable character | Type-ahead — focus the next row after the focused one whose label starts with what was typed. Typing one letter again steps through the rows that start with it. Several different letters match as a prefix, searched from the focused row itself. The buffer resets after a 700ms pause. |
| `Escape` | Clear the type-ahead buffer. |
| `Shift+F10` / ContextMenu key | Fire `"contextmenu"` for the focused row — see [Context menu](#context-menu). |

A navigation key that leaves the selection where it was — `ArrowDown` on the last row,
`Home` on the first — fires no `change`, and announces no `"action"` either. `Enter`,
`Space` and a click fire both even on the row already selected, since a host such as
[`ComboBox`](/components/ComboBox) treats them as the user's pick.

A host that drives the list from its own input surface — a search field filtering the rows
as you type — can highlight a row up front with
[`setFocusedIndex`](/api/component/list/classes/List#setfocusedindex), so `Enter` commits it
without an arrow keypress first. It moves the focus mark only: the selection is untouched and
no `change` event fires.

A keyboard move, type-ahead and `setFocusedIndex` scroll the focused row into view. The list
moves the least distance that shows the whole row, and never sideways, so a list with
[horizontal scrolling](#horizontal-scrolling) keeps its horizontal position. After a
keyboard move or type-ahead, a scrolling panel around the list then scrolls as well, up or down
only, so the row is also in view of the page. A key pressed while a pane or section around the
list is still opening scrolls the list alone. `setFocusedIndex` is a state setter and scrolls
the list alone. To bring the focused row into view of the panels around the list too, hand the
row's element to `FocusReveal.reveal` after it:

```typescript
import { DOM, FocusReveal } from '@jimka/typescript-ui/core';

list.setFocusedIndex(index);

const rowId = list.getFocusedRowId();
const row   = rowId === null ? null : DOM.source.getElementById(rowId);

if (row !== null) {
    FocusReveal.reveal(row);
}
```

`setSelectedIndex` and `setValue` do not scroll.

Navigation and type-ahead skip disabled rows entirely — see [Disabled rows](#disabled-rows) below.

## Selection events

`on("action", fn)` fires once per user-driven selection — a row click, `Enter`, `Space`, or
an arrow key that moves the selection — and never for a programmatic `setSelectedIndex` or
`setValue`. `on("change", fn)` carries the committed value and fires for the user's gestures
**and** your own `setSelectedIndex` calls.

```typescript
fruits.on("action", () => console.log("user picked:", fruits.getValue()));
fruits.on("change", value => console.log("now:", value));

fruits.setSelectedIndex(1);        // "change" and "binding" only
fruits.setSelectedIndex(1, false); // nothing at all
```

[`Checkbox`](/components/Checkbox) and [`Slider`](/components/Slider) follow the same
contract: `"action"` is the user's own activation, `"change"` is every committed value.

## Context menu

`on("contextmenu", fn)` is the one subscription for a row's context menu. It fires for a
right-click on a row and for `Shift+F10` or the ContextMenu key on the focused row, so the
same listener serves the mouse and the keyboard:

```typescript
import { Menu } from '@jimka/typescript-ui/overlay';

const menu = Menu();

fruits.on("contextmenu", (index, event) => menu.show(event.clientX, event.clientY, [
    { text: "Open",   action: () => open(fruits.getItems()[index]) },
    { text: "Remove", action: () => remove(index) },
]));
```

| Opened with | `index` | `event` |
|---|---|---|
| a right-click on a row | the row under the pointer | the browser's `contextmenu` event |
| `Shift+F10` / ContextMenu key | the focused row, scrolled into view first | a synthetic `contextmenu` event whose `clientX` / `clientY` sit under the row; its `target` is `null` |

Either way the browser's own menu is already suppressed — the listener need not call
`preventDefault()`, which does nothing on the synthetic event — and the selection is left as
it was; a listener that wants the row selected calls `setSelectedIndex(index)` itself. With no focused
row (`getFocusedIndex()` is `-1`) — a list built from `items` before any arrow key or row
click, an empty list, or a disabled one — the keys fire nothing, as a right-click on the
list's empty area fires nothing. A read-only list ignores the arrow keys and row clicks, so
its keyboard menu is for the row the host focused with `setFocusedIndex`, if any; a
right-click on a row still fires for that row.

A menu opened from the keyboard takes focus and is worked with the arrow keys; focus returns
to the list when it closes — see [Menu: Keyboard](/components/Menu#keyboard).

## Store-backed lists

`List` accepts an [`AbstractStore`](/api/data/classes/AbstractStore) via [`setStore`](/api/component/list/classes/List#setstore). Pass the field whose value becomes the row label, and optionally the field used as the row key (defaults to the record's primary key):

```typescript
list.setStore(myStore, 'name', 'id');
```

The list refreshes automatically on `load` / `add` / `remove` / `datachange` / `sync` events. When records arrive after construction, the previously-selected key is preserved if it still appears in the new record set.

## Item renderers

Each row's content is produced by a [`ListItemRenderer`](/api/component/list/classes/ListItemRenderer). By default the list uses [`LabelListItemRenderer`](/api/component/list/classes/LabelListItemRenderer), which renders the item label as plain text with ellipsis truncation. Swap the renderer for every row with the `rendererFactory` option (or `setRendererFactory` at runtime), passing a zero-argument factory. Calling `setRendererFactory` disposes each row's previous renderer.

[`GlyphListItemRenderer`](/api/component/list/classes/GlyphListItemRenderer) paints an icon before each label, sourcing the icon name from the item's `glyph` field. Register the glyphs first, as with any [`Glyph`](/api/component/display/classes/Glyph):

```typescript
import { List, GlyphListItemRenderer } from '@jimka/typescript-ui/component/list';
import { Glyph } from '@jimka/typescript-ui/component/display';
import { folder } from '@jimka/typescript-ui/glyphs/solid/folder';
import { file }   from '@jimka/typescript-ui/glyphs/solid/file';

Glyph.register(folder, file);

const list = List({ rendererFactory: () => new GlyphListItemRenderer() });
list.setItems([
    { key: 'docs', label: 'Documents', glyph: 'folder' },
    { key: 'read', label: 'README',    glyph: 'file'   },
]);
```

An item with no `glyph` renders label-only. For a store-bound list, resolve each item's glyph from a record field by passing its name as the fourth [`setStore`](/api/component/list/classes/List#setstore) argument (or the `glyphField` option):

```typescript
list.setStore(myStore, 'name', 'id', 'icon');
```

## Disabled rows

A [`SelectableListItem`](/api/component/list/interfaces/SelectableListItem) carries an optional `enabled?: boolean` field. A row whose item has `enabled: false` renders dim and refuses a click and an Enter/Space commit — the same treatment a disabled `MenuItem` gets. It is also skipped by arrow-key navigation and type-ahead, which is *not* how `Menu` treats a disabled `MenuItem` (there, the arrow-key highlight still lands on it; only activating it is refused) — a list can't copy that, because in a list an arrow key is itself a selection commit. The row keeps its index and its key: it is still returned by `getItems`, and a programmatic `setValue` can still select it.

```typescript
list.setItems([
    { key: 'a', label: 'Available' },
    { key: 'b', label: 'Out of stock', enabled: false },
]);
```

Use [`isItemEnabled`](/api/component/list/classes/List#isitemenabled) to read a row's current state and [`setItemEnabled`](/api/component/list/classes/List#setitemenabled) to flip it after construction — the setter repaints just that row and leaves selection and focus untouched:

```typescript
list.setItemEnabled(1, true);
```

A custom [item renderer](#item-renderers) whose child sets its own explicit foreground colour overrides the inherited dim — read `context.item.enabled` in the renderer if it needs to react itself.

## Sizing

A `List` fills the space its parent's layout manager allocates rather than shrink-wrapping to its rows: placed in a stretching region — a [`Border`](/api/layout/classes/Border) `WEST`/`CENTER`, a `Fit`/`Box` cell with a vertical fill — it grows to the region's full height and scrolls any overflow internally, instead of capping at its content height. An explicit `setMaxSize` / `setMinSize` (or the option-bag `maxSize` / `minSize`) still binds as a hard ceiling or floor. To size a free-standing list to its content instead, give it an explicit `preferredSize` and place it where the layout honours that (e.g. an `Absolute` cell).

## Horizontal scrolling

A row too narrow for its label truncates it with an ellipsis. That is the default, and it is usually what you want: most labels are identified by how they *start*, so trailing truncation keeps the part you navigate by. Turn it off with the `horizontalScrolling` option (or [`setHorizontalScrolling`](/api/component/list/classes/List#sethorizontalscrolling) at runtime) when the label's tail is what identifies it and the list is too narrow to show it — a SQL query where every row opens with `SELECT` and the `WHERE` clause is the identity, say:

```typescript
const list = List({ horizontalScrolling: true });
```

Every row is then sized to the widest bound row's natural width, or the viewport, whichever is larger, and the list raises a horizontal scrollbar once the rows exceed it. Rows stay full-width relative to each other, so the selection wash still spans the whole row when scrolled.

Leave it off for a dropdown surface — [`ComboBox`](/api/component/input/classes/ComboBox) and [`AutoCompleteField`](/api/component/input/classes/AutoCompleteField) are built on `List`, and a horizontal scrollbar under a transient popup reads as a glitch. Bear in mind too that scrolling right hides the row's left edge, so it trades one truncation for another rather than removing it.

A row's natural width comes from its renderer's [`getContentWidth`](/api/component/list/classes/ListItemRenderer#getcontentwidth). The built-in renderers implement it; a custom renderer inherits the base implementation, which reports no intrinsic width, so its rows stay at the viewport width and never scroll. Override it to opt a custom renderer in:

```typescript
class MyRenderer extends ListItemRenderer {
    private _label: Text = new Text();

    getContentWidth(): number {
        return this._label.getPreferredSize()?.width ?? 0;
    }

    // update / layoutChildren as usual
}
```

The measurement only runs while the option is on, so a list that truncates pays nothing for it.

## Theme tokens

Visual chrome is driven by the [`Theme.list`](/api/core/interfaces/Theme) tokens — `--ts-ui-list-bg`, `--ts-ui-list-border`, `--ts-ui-list-row-hover-bg`, `--ts-ui-list-row-selected-bg`, `--ts-ui-list-row-selected-color`, `--ts-ui-list-row-focus-ring`, `--ts-ui-list-row-disabled-color`, and `--ts-ui-list-row-separator`. The separator token defaults to `transparent`; a theme can override it to a `1px solid rgba(...)` colour for a denser, ruled row look. `--ts-ui-list-row-disabled-color` colours a [disabled row](#disabled-rows)'s label and glyph. The empty-state placeholder uses the theme-wide muted text colour, `--ts-ui-text-muted-color` (see [Theming](/concepts/theming#theme-keys)).

## See also

- [API: List](/api/component/list/classes/List)
- [`MultiSelectList`](/components/MultiSelectList) — multi-selection variant
- [`ComboBox`](/components/ComboBox) — drop-down version
