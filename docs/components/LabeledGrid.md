# LabeledGrid

[`LabeledGrid`](/api/component/container/classes/LabeledGrid) is a chrome-less baseline-aligned grid of title/field pairs — the same layout [`LabeledFieldSet`](/components/LabeledFieldSet) composes, without the `<fieldset>` border and legend. Use it wherever the labelled-form layout is wanted on its own, e.g. inside another container that already supplies its own chrome.

Internally it is a single baseline-aligned [`Grid`](/api/layout/classes/Grid) with `2 × columns` grid-columns — a content-sized title track and a weight-sized input track per logical column — so you never hand-maintain track configuration or row counts. `LabeledFieldSet` is a `LabeledGrid` inside a `FieldSet`.

## Usage

Declarative — pass the whole grid as a `rows` bag. Each inner array is one row of pairs (one per column, left-to-right); a `{ component, fullWidth: true }` row spans every column:

```typescript
import { TextField, Checkbox } from '@jimka/typescript-ui/component/input';
import { LabeledGrid } from '@jimka/typescript-ui/component/container';

const nameField = TextField();
const activeBox = Checkbox();

const grid = LabeledGrid({
    columns: 1,
    rows: [
        [{ title: 'Name',   component: nameField }],
        [{ title: 'Active', component: activeBox }],
    ],
});

panel.addComponent(grid);
```

Imperative — build the grid with `addField` / `addRow` / `addFullWidthRow`. With `columns: 2`, consecutive `addField` calls flow into the next free column and wrap to a new row when the current one fills:

```typescript
const grid = LabeledGrid({ columns: 2 });

grid.addField('First', firstField);
grid.addField('Last',  lastField);     // fills column 2 of the first row
grid.addField('City',  cityField);     // wraps to a new row
grid.addFullWidthRow(noteField);       // spans both columns
```

## Common methods

| Method | Purpose |
| --- | --- |
| `addField(title, component)` | Appends one title/field pair into the next free column, wrapping to a new row when the current one fills. |
| `addRow(fields)` | Appends a full row of pairs (one per column; a short array leaves trailing columns empty). |
| `addFullWidthRow(component)` | Appends a component spanning every column on its own row. |
| `getColumns()` | Returns the configured logical column count. |

## See also

- [API: LabeledGrid](/api/component/container/classes/LabeledGrid)
- [`LabeledFieldSet`](/components/LabeledFieldSet) — the fieldset-wrapped variant, with a bordered box and legend title.
- [`Grid`](/api/layout/classes/Grid) — the baseline-aligned layout used internally.
