# LabeledFieldSet

[`LabeledFieldSet`](/api/component/container/classes/LabeledFieldSet) is a [`FieldSet`](/components/FieldSet) whose content is a baseline-aligned form of title/field pairs. It formalises the common labelled-form pattern: each row pairs a label with its input, titles hug their text while inputs share a common right edge, and rows line up across multiple side-by-side columns.

Internally it composes a [`LabeledGrid`](/components/LabeledGrid) — a single baseline-aligned [`Grid`](/api/layout/classes/Grid) with `2 × columns` grid-columns, a content-sized title track and a weight-sized input track per logical column — inside its `<fieldset>` chrome, so you never hand-maintain track configuration or row counts.

## Usage

Declarative — pass the whole form as a `rows` bag. Each inner array is one row of pairs (one per column, left-to-right); a `{ component, fullWidth: true }` row spans every column:

```typescript
import { TextField, Checkbox } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import { LabeledFieldSet } from '@jimka/typescript-ui/component/container';

const nameField = TextField();
const activeBox = Checkbox();

const form = LabeledFieldSet('Information', {
    columns: 1,
    rows: [
        [{ title: 'Name',   component: nameField }],
        [{ title: 'Active', component: activeBox }],
        { component: Button('Save'), fullWidth: true },
    ],
});

panel.addComponent(form);
```

Imperative — build the form with `addField` / `addRow` / `addFullWidthRow`. With `columns: 2`, consecutive `addField` calls flow into the next free column and wrap to a new row when the current one fills:

```typescript
const form = LabeledFieldSet('Address', { columns: 2 });

form.addField('First', firstField);
form.addField('Last',  lastField);     // fills column 2 of the first row
form.addField('City',  cityField);     // wraps to a new row
form.addFullWidthRow(noteField);       // spans both columns
```

<!-- demo: labeledfieldset-form -->
> **Live demo** — a two-column `rows` bag: three labelled fields plus a
> full-width `Button` row.
> [Open the LabeledFieldSet page](https://jimka.github.io/typescript-ui/components/LabeledFieldSet)
<!-- /demo -->

## Common methods

| Method | Purpose |
| --- | --- |
| `addField(title, component)` | Appends one title/field pair into the next free column, wrapping to a new row when the current one fills. |
| `addRow(fields)` | Appends a full row of pairs (one per column; a short array leaves trailing columns empty). |
| `addFullWidthRow(component)` | Appends a component spanning every column on its own row. |
| `getColumns()` | Returns the configured logical column count. |

## See also

- [API: LabeledFieldSet](/api/component/container/classes/LabeledFieldSet)
- [`FieldSet`](/components/FieldSet) — the bordered, legend-titled base container.
- [`LabeledGrid`](/components/LabeledGrid) — the chrome-less grid this component composes.
- [`Grid`](/api/layout/classes/Grid) — the baseline-aligned layout used internally.
