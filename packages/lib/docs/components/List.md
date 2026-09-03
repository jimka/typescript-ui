# List

[`List`](/api/component/list/classes/List) is a single-selection scrollable list box rendered as a `<div role="listbox">` populated with `<div role="option">` rows. It implements [`Bindable<string>`](/api/core/interfaces/Bindable) so it can be plugged into a [`Binding`](/api/core/classes/Binding) directly.

<!-- demo: list-selection -->
> **Live demo** — a store-bound `List` of people's names, with a `Text`
> below showing the current selection.
> [Open the List page](https://jimka.github.io/typescript-ui/components/List)
<!-- /demo -->

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { List } from '@jimka/typescript-ui/component/list';
const fruits = List();
fruits.addItem('Apple');
fruits.addItem('Banana');
fruits.addItem('Cherry');
fruits.setPreferredSize({ width: 180, height: 120 });

Event.addListener(fruits, 'change', () => {
    console.log('selected:', fruits.getValue());
});

panel.addComponent(fruits);
```

`addItem` / `setItems` also accept pre-formed `{ key, label }` pairs (a [`SelectableListItem`](/api/component/list/interfaces/SelectableListItem)) when each row needs an explicit, stable key instead of its positional index — e.g. `fruits.setItems([{ key: 'apple', label: 'Apple' }, 'Banana'])`. String entries are auto-keyed by array position; the caller owns key uniqueness.

## Keyboard

The list root is focusable; rows are not. Focus tracks the active row via `aria-activedescendant`.

| Key | Behaviour |
|---|---|
| `ArrowUp` / `ArrowDown` | Move focus and selection by one row. |
| `Home` / `End` | Jump to the first / last row. |
| `PageUp` / `PageDown` | Jump by one visible-row count. |
| `Enter` / `Space` | Commit the focused row. |
| Printable character | Type-ahead — focus the first row whose label starts with the buffer. The buffer resets after a 700ms pause. |
| `Escape` | Clear the type-ahead buffer. |

Navigation and type-ahead skip disabled rows entirely — see [Disabled rows](#disabled-rows) below.

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

Visual chrome is driven by the [`Theme.list`](/api/core/interfaces/Theme) tokens — `--ts-ui-list-bg`, `--ts-ui-list-border`, `--ts-ui-list-row-hover-bg`, `--ts-ui-list-row-selected-bg`, `--ts-ui-list-row-selected-color`, `--ts-ui-list-row-focus-ring`, `--ts-ui-list-row-disabled-color`, and `--ts-ui-list-row-separator`. The separator token defaults to `transparent`; a theme can override it to a `1px solid rgba(...)` colour for a denser, ruled row look. `--ts-ui-list-row-disabled-color` colours both the empty-state placeholder and a [disabled row](#disabled-rows)'s label and glyph.

## See also

- [API: List](/api/component/list/classes/List)
- [`MultiSelectList`](/components/MultiSelectList) — multi-selection variant
- [`ComboBox`](/components/ComboBox) — drop-down version
