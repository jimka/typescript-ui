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

## Theme tokens

Visual chrome is driven by the [`Theme.list`](/api/core/interfaces/Theme) tokens — `--ts-ui-list-bg`, `--ts-ui-list-border`, `--ts-ui-list-row-hover-bg`, `--ts-ui-list-row-selected-bg`, `--ts-ui-list-row-selected-color`, `--ts-ui-list-row-focus-ring`, `--ts-ui-list-row-disabled-color`, and `--ts-ui-list-row-separator`. The separator token defaults to `transparent`; a theme can override it to a `1px solid rgba(...)` colour for a denser, ruled row look.

## See also

- [API: List](/api/component/list/classes/List)
- [`MultiSelectList`](/components/MultiSelectList) — multi-selection variant
- [`ComboBox`](/components/ComboBox) — drop-down version
