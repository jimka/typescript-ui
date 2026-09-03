# MultiSelectList

[`MultiSelectList`](/api/component/list/classes/MultiSelectList) is a multi-selection list box rendered as a `<div role="listbox" aria-multiselectable="true">` populated with `<div role="option">` rows. It implements [`Bindable<string[]>`](/api/core/interfaces/Bindable) so it can be plugged into a [`Binding`](/api/core/classes/Binding) directly.

<!-- demo: multiselectlist-selection -->
> **Live demo** — a `MultiSelectList` of five tag strings with Ctrl/Shift
> multi-select, and a `Text` below showing the current selection.
> [Open the MultiSelectList page](https://jimka.github.io/typescript-ui/components/MultiSelectList)
<!-- /demo -->

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { MultiSelectList } from '@jimka/typescript-ui/component/list';
const tags = MultiSelectList();
tags.setItems(['Urgent', 'Blocked', 'Reviewed', 'In progress']);
tags.setPreferredSize({ width: 180, height: 120 });

Event.addListener(tags, 'change', () => {
    console.log('selected:', tags.getValue());
});

panel.addComponent(tags);
```

`setItems` / `addItem` also accept pre-formed `{ key, label }` pairs (a [`SelectableListItem`](/api/component/list/interfaces/SelectableListItem)) when rows need explicit keys instead of their positional index — e.g. `tags.setItems([{ key: 'urgent', label: 'Urgent' }, 'Blocked'])`. Those keys round-trip through `getValue()` / `setValues()`; string entries are auto-keyed by array position and the caller owns key uniqueness.

## Selection model

| Gesture | Behaviour |
|---|---|
| Plain click / `Enter` / `Space` | Replace the selection with the targeted row. |
| `Ctrl`-click (or `Cmd` on macOS) | Toggle the targeted row's selection without affecting others. |
| `Shift`-click | Extend the selection from the anchor row to the targeted row. |
| `Shift`-`ArrowUp` / `Shift`-`ArrowDown` | Extend the selection by one row. |
| `Ctrl`-`ArrowUp` / `Ctrl`-`ArrowDown` | Move focus without changing selection. |
| `Ctrl`-`A` | Select every row. Disabled rows are skipped. |

A `Shift`-extension that crosses a disabled row drops it from the resulting selection — see [Disabled rows](#disabled-rows).

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` | Returns the selected row keys as a string array. |
| `setValues(values[])` | Programmatically select the rows whose keys appear in `values`. |
| `getSelectedRecords()` | When a store is bound, returns the selected [`ModelRecord`](/api/data/classes/ModelRecord) instances. |
| `setSelectedRecords(records)` | Programmatically select the rows whose backing records appear in `records`. |

## Item renderers

`MultiSelectList` inherits the `rendererFactory` option / `setRendererFactory` and the per-item `glyph` field from the shared list base, so a [`GlyphListItemRenderer`](/api/component/list/classes/GlyphListItemRenderer) paints an icon beside each row exactly as in [`List`](/components/List#item-renderers).

## Disabled rows

`MultiSelectList` inherits the per-item `enabled` field, `isItemEnabled` and `setItemEnabled` from the shared list base, and it behaves exactly as in [List](/components/List#disabled-rows): a disabled row renders dim, refuses a click, and is skipped by keyboard navigation and type-ahead. `Ctrl`-`A` and a `Shift`-range extension additionally skip disabled rows when building the multi-selection.

## Horizontal scrolling

`MultiSelectList` inherits the `horizontalScrolling` option / `setHorizontalScrolling` from the shared list base, and it behaves exactly as in [`List`](/components/List#horizontal-scrolling): off by default, so an over-long row truncates with an ellipsis until you opt into scrolling it.

## Binding

`MultiSelectList` implements [`Bindable<string[]>`](/api/core/interfaces/Bindable) directly, so a [`Binding`](/api/core/classes/Binding) can wire it without explicit accessors:

```typescript
new Binding().bind('tags', tagsList);
```

The binding reads / writes `string[]` — the array of selected row keys, in row order.

## Theme tokens

`MultiSelectList` shares the [`Theme.list`](/api/core/interfaces/Theme) tokens with [`List`](/components/List); a theme that customises the row chrome of one component automatically gets the matching look on the other.

## See also

- [API: MultiSelectList](/api/component/list/classes/MultiSelectList)
- [`List`](/components/List) — single-selection variant
- [Data binding](/data/binding)
