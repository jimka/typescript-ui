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
        [{ title: 'Name',   component: nameField, description: 'A unique identifier' }],
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
| `addField(title, component, description?)` | Appends one title/field pair into the next free column, wrapping to a new row when the current one fills. The optional description becomes a hover tooltip on both the label and the field. |
| `addRow(fields)` | Appends a full row of pairs (one per column; a short array leaves trailing columns empty). |
| `addFullWidthRow(component)` | Appends a component spanning every column on its own row. |
| `getColumns()` | Returns the configured logical column count. |

## Notes

- A grid whose parent re-commits it at the rectangle it already holds is not re-laid-out (see [the write is diffed](/concepts/layout-system#the-write-is-diffed)). `addField`, `addRow` and `addFullWidthRow` all still lay it out, a field's own re-measure re-flows the rows through it, and changing insets, padding or a border, swapping a manager, hiding a field with `setDisplayed`, rewriting a field's constraints or re-sorting children — on the grid or inside it — marks it owed for the next pass that reaches it. One change does not announce itself: a custom field that changes its intrinsic size without calling `setPreferredSize` or `notifyIntrinsicSizeChanged`, which should be followed by `grid.scheduleLayout()`.

## See also

- [API: LabeledGrid](/api/component/container/classes/LabeledGrid)
- [`LabeledFieldSet`](/components/LabeledFieldSet) — the fieldset-wrapped variant, with a bordered box and legend title.
- [`Grid`](/api/layout/classes/Grid) — the baseline-aligned layout used internally.
