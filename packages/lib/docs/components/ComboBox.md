# ComboBox

[`ComboBox`](/api/component/input/classes/ComboBox) is a drop-down selector backed by a styled `<div>` surface and an [`AnimatedDropdown`](/components/AnimatedDropdown) panel. Populate it from a list of string items, or bind it to a data [`Store`](/data/store) so the options track records as they load and change.

It implements [`Bindable<string>`](/api/core/interfaces/Bindable), so it can participate in a [`Binding`](/data/binding) directly.

<!-- demo: combobox-store -->
> **Live demo** — a `ComboBox` backed by a store of people, its
> `displayField` set to `name`.
> [Open the ComboBox page](https://jimka.github.io/typescript-ui/components/ComboBox)
<!-- /demo -->

## Static items

Pass plain strings via the `items` option (or `addItem` / `setItems`):

```typescript
import { ComboBox } from '@jimka/typescript-ui/component/input';

const role = ComboBox({ items: ['Admin', 'User', 'Guest'] });

role.on('action', () => {
    console.log('selected index:', role.getSelectedIndex());
});

panel.addComponent(role);
```

### Keyed items

`addItem` / `setItems` also accept pre-formed `{ key, label }` entries — a [`SelectableListItem`](/api/component/list/interfaces/SelectableListItem) — so each option carries its own stable key without standing up a store. Explicit keys and plain strings can be mixed in one call; string entries are auto-keyed by their array position, object entries keep their key verbatim, and the caller owns key uniqueness:

```typescript
const role = ComboBox();
role.setItems([{ key: 'admin', label: 'Admin' }, 'Guest']);
// Selecting "Admin" makes getValue() return "admin"; selecting "Guest"
// returns "1" (the string auto-keyed by its array position).
```

## Backed by a store

```typescript
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { ComboBox } from '@jimka/typescript-ui/component/input';
const RoleModel = new Model([
    { name: 'id',   type: 'string' },
    { name: 'name', type: 'string' },
]);

const store = new MemoryStore(RoleModel, [
    { id: 'admin', name: 'Admin' },
    { id: 'user',  name: 'User'  },
]);
await store.load();

const role = ComboBox();
role.setStore(store);
role.setValueField('id');
role.setDisplayField('name');
```

The combo refreshes automatically on store `datachange` events.

## Item renderers

The dropdown rows — and the collapsed control itself — render through a [`ListItemRenderer`](/api/component/list/classes/ListItemRenderer) supplied via the `rendererFactory` option (or `setRendererFactory` at runtime). The default renders the label as plain text; [`GlyphListItemRenderer`](/api/component/list/classes/GlyphListItemRenderer) shows each option's `glyph` beside its label — in the open dropdown **and** on the closed combo box, so the selected entry's icon stays visible after the dropdown closes. Calling `setRendererFactory` disposes the replaced renderers.

```typescript
import { ComboBox } from '@jimka/typescript-ui/component/input';
import { GlyphListItemRenderer } from '@jimka/typescript-ui/component/list';
import { Glyph } from '@jimka/typescript-ui/component/display';
import { folder } from '@jimka/typescript-ui/glyphs/solid/folder';

Glyph.register(folder);

const combo = ComboBox({ rendererFactory: () => new GlyphListItemRenderer() });
combo.setItems([{ key: 'docs', label: 'Documents', glyph: 'folder' }]);
```

When nothing is selected the collapsed control renders blank. A store-bound combo sources each option's glyph from a record field named by the fourth [`setStore`](/api/component/input/classes/ComboBox#setstore) argument (or the `glyphField` option), mirroring [`List`](/components/List#item-renderers).

## Common methods

| Method | Purpose |
| --- | --- |
| `addItem(item)` | Append an item (string or `{ key, label }`). |
| `setItems(items[])` | Replace the item list (strings or `{ key, label }` pairs). |
| `getValue()` / `setValue(value)` | Read / write the selected option's value. |
| `getSelectedIndex()` / `setSelectedIndex(i)` | Index-based selection. `setSelectedIndex(i)` fires `"change"`, never `"action"`; pass `false` as a second argument for a silent write. |
| `setStore(store)` / `setDisplayField(name)` / `setValueField(name)` | Bind to a data store. |
| `getSelectedRecord()` | When backed by a store, returns the currently selected `ModelRecord`. |

## Selection events

`on("action", fn)` fires once per user commit — a row click, or `Enter`, `Space` or an arrow
key on the open dropdown — and never for a programmatic `setSelectedIndex` or `setValue`.
`on("change", fn)` carries the committed value and fires for the user's commits **and** your
own `setSelectedIndex` calls. `setValue` fires neither, so a host can resynchronise the
displayed option without re-entering its own listener.

```typescript
role.on("action", () => console.log("user picked:", role.getValue()));
role.on("change", value => console.log("now:", value));

role.setSelectedIndex(1);        // "change" and "binding" only
role.setSelectedIndex(1, false); // nothing at all
role.setValue('admin');          // nothing at all
```

[`List`](/components/List#selection-events), [`Checkbox`](/components/Checkbox) and
[`Slider`](/components/Slider) follow the same contract.

## Theming

The combo's thin gray border (and its dropdown panel's matching border) is driven by the `input.border` token — see [Theming › Theme keys](/concepts/theming#theme-keys).

The trigger chevron points down when the dropdown is closed and rotates to point up while it is open, animated in step with the dropdown's own fade (and snapping instantly when the dropdown is non-animated).

## Notes

- A combo box whose parent re-commits it at the rectangle it already holds is not re-laid-out (see [the write is diffed](/concepts/layout-system#the-write-is-diffed)). Its own pass reads only its content box and the caret's square size, and the caret reads that size from the theme once at construction and never rewrites it. `setValue`, `setSelectedIndex`, `setItems`, `setStore` and the store's own changes all rebind the collapsed label and mark its pass owed, so a renderer child the rebind newly built is placed by the next pass that reaches the field and no skipping ancestor can withhold that pass. The rebind queues no frame of its own. None of these writes can move the field, since the label is sized from the field's content box rather than from its text. The dropdown is an overlay outside the field's layout.

## See also

- [API: ComboBox](/api/component/input/classes/ComboBox)
- [`List`](/components/List) — same options, displayed as an open list box
- [`AutoCompleteField`](/components/AutoCompleteField) — typeahead variant
- [Data binding](/data/binding)
