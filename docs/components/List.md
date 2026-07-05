# List

[`List`](/api/component/list/classes/List) is a single-selection scrollable list box rendered as a `<div role="listbox">` populated with `<div role="option">` rows. It implements [`Bindable<string>`](/api/core/interfaces/Bindable) so it can be plugged into a [`Binding`](/api/core/classes/Binding) directly.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { List } from '@jimka/typescript-ui/component/list';
const fruits = List();
fruits.addItem('Apple');
fruits.addItem('Banana');
fruits.addItem('Cherry');
fruits.setPreferredSize(180, 120);

Event.addListener(fruits, 'change', () => {
    console.log('selected:', fruits.getValue());
});

panel.addComponent(fruits);
```

`addItem` / `setItems` also accept pre-formed `{ key, label }` pairs (a [`CustomListItem`](/api/component/list/interfaces/CustomListItem)) when each row needs an explicit, stable key instead of its positional index — e.g. `fruits.setItems([{ key: 'apple', label: 'Apple' }, 'Banana'])`. String entries are auto-keyed by array position; the caller owns key uniqueness.

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

## Store-backed lists

`List` accepts an [`AbstractStore`](/api/data/classes/AbstractStore) via [`setStore`](/api/component/list/classes/List#setstore). Pass the field whose value becomes the row label, and optionally the field used as the row key (defaults to the record's primary key):

```typescript
list.setStore(myStore, 'name', 'id');
```

The list refreshes automatically on `load` / `add` / `remove` / `datachanged` / `sync` events. When records arrive after construction, the previously-selected key is preserved if it still appears in the new record set.

## Item renderers

Each row's content is produced by a [`ListItemRenderer`](/api/component/list/classes/ListItemRenderer). By default the list uses [`LabelListItemRenderer`](/api/component/list/classes/LabelListItemRenderer), which renders the item label as plain text with ellipsis truncation. Swap the renderer for every row with the `rendererFactory` option (or `setRendererFactory` at runtime), passing a zero-argument factory.

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

## Sizing

A `List` fills the space its parent's layout manager allocates rather than shrink-wrapping to its rows: placed in a stretching region — a [`Border`](/api/layout/classes/Border) `WEST`/`CENTER`, a `Fit`/`Box` cell with a vertical fill — it grows to the region's full height and scrolls any overflow internally, instead of capping at its content height. An explicit `setMaxSize` / `setMinSize` (or the option-bag `maxSize` / `minSize`) still binds as a hard ceiling or floor. To size a free-standing list to its content instead, give it an explicit `preferredSize` and place it where the layout honours that (e.g. an `Absolute` cell).

## Theme tokens

Visual chrome is driven by the [`Theme.list`](/api/core/interfaces/Theme) tokens — `--ts-ui-list-bg`, `--ts-ui-list-border`, `--ts-ui-list-row-hover-bg`, `--ts-ui-list-row-selected-bg`, `--ts-ui-list-row-selected-color`, `--ts-ui-list-row-focus-ring`, `--ts-ui-list-row-disabled-color`, and `--ts-ui-list-row-separator`. The separator token defaults to `transparent`; a theme can override it to a `1px solid rgba(...)` colour for a denser, ruled row look.

## See also

- [API: List](/api/component/list/classes/List)
- [`MultiSelectList`](/components/MultiSelectList) — multi-selection variant
- [`ComboBox`](/components/ComboBox) — drop-down version
