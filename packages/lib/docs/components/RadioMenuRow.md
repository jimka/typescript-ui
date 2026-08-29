# RadioMenuRow

[`RadioMenuRow`](/api/component/container/classes/RadioMenuRow) is a [`Menu`](/components/Menu) row that hosts a real [`RadioButton`](/components/RadioButton), for a single-choice group of rows. Selecting is one-way: a click on the row (or Enter while it holds the keyboard highlight) always selects it and leaves the menu open, but a click on an already-selected row changes nothing. The row does **not** deselect its siblings — it has no notion of a group — so the code that builds the group deselects the others via `setChecked(false)`.

You build one via a `MenuItemConfig.row` factory, not by adding it to the tree directly.

## Usage

```typescript
import { RadioMenuRow } from '@jimka/typescript-ui/component/container';

let alignment: 'left' | 'center' | 'right' = 'left';
const rows = new Map<string, RadioMenuRow>();

function alignRow(label: string, key: typeof alignment): RadioMenuRow {
    const row = new RadioMenuRow({ text: label, checked: key === alignment });

    // Fires after the row's own state has already flipped to selected, so
    // isChecked() here always reads true. The caller owns clearing the
    // other rows in the group — RadioMenuRow never touches its siblings.
    row.on('action', () => {
        alignment = key;

        for (const [otherKey, otherRow] of rows) {
            if (otherKey !== key) {
                otherRow.setChecked(false);
            }
        }
    });

    rows.set(key, row);

    return row;
}

menu.show(0, 0, [
    { row: () => alignRow('Left', 'left') },
    { row: () => alignRow('Center', 'center') },
    { row: () => alignRow('Right', 'right') },
]);
```

See [Menu's Custom rows section](/components/Menu#custom-rows) for the `MenuRow` contract this row implements, and [`CheckboxMenuRow`](/components/CheckboxMenuRow) for the equivalent multi-select row.

`enabled` is construction-time only — there is no `setEnabled`. A menu rebuilds its rows from scratch on every open (via each config's `row:` factory), so a row's enabled state is simply whatever the factory computes each time it runs; there is nothing to keep in sync between opens.

## Options

| Field | Purpose |
| --- | --- |
| `text` | Row label, rendered beside the radio graphic. |
| `checked` | Initial selected state. Defaults to `false`. |
| `enabled` | Whether the row is interactive. Defaults to `true`. A disabled row is dimmed and ignores clicks and Enter. |
| `listeners.action` | Construction-time listener, equivalent to `on("action", fn)`. |

## Methods

| Method | Purpose |
| --- | --- |
| `isChecked()` / `setChecked(boolean)` | Read / write the checked state. `setChecked(false)` is how a group owner deselects a sibling — only *user* activation is select-only. |
| `isEnabled()` | Whether the row is interactive — the construction-time `enabled` option. |
| `on("action", fn)` / `off("action", fn)` | Subscribe to each activation — a click or Enter — fires even when the row was already selected, after the row's own state has already flipped to selected, so the handler reads `isChecked() === true`. |

## See also

- [API: RadioMenuRow](/api/component/container/classes/RadioMenuRow)
- [`Menu`](/components/Menu) — see its [Custom rows](/components/Menu#custom-rows) section
- [`CheckboxMenuRow`](/components/CheckboxMenuRow) — the equivalent multi-select row
- [`RadioButton`](/components/RadioButton) — the control this row hosts
