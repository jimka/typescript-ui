# CheckboxMenuRow

[`CheckboxMenuRow`](/api/component/container/classes/CheckboxMenuRow) is a [`Menu`](/components/Menu) row that hosts a real [`Checkbox`](/components/Checkbox) — the worked example of a [`MenuRow`](/api/component/container/classes/MenuRow) subclass. Toggling it (a click anywhere in the row, or Enter while it holds the keyboard highlight) flips the checkbox and leaves the menu open; unlike a plain [`MenuItem`](/components/MenuItem), activating it never closes the panel.

You build one via a `MenuItemConfig.row` factory, not by adding it to the tree directly.

<!-- demo: checkboxmenurow-format -->
> **Live demo** — a `MenuBar` "Format" menu built entirely from
> `CheckboxMenuRow` entries, with a `Text` below echoing the current
> selection.
> [Open the CheckboxMenuRow page](https://jimka.github.io/typescript-ui/components/CheckboxMenuRow)
<!-- /demo -->

## Usage

```typescript
import { CheckboxMenuRow } from '@jimka/typescript-ui/component/container';

const selected = new Set(['bold']);

function checkboxRow(label: string, key: string): CheckboxMenuRow {
    const row = new CheckboxMenuRow({ text: label, checked: selected.has(key) });

    // Fires after the row's own state has already flipped, so isChecked()
    // here reads the new value.
    row.on('action', () => {
        if (row.isChecked()) {
            selected.add(key);
        } else {
            selected.delete(key);
        }
    });

    return row;
}

menu.show(0, 0, [
    { row: () => checkboxRow('Bold', 'bold') },
    { row: () => checkboxRow('Italic', 'italic') },
]);
```

Stacking several `CheckboxMenuRow` entries turns a menu into a multi-select control — the panel stays open across clicks, so the user can flip several rows in one open. See [Menu's Custom rows section](/components/Menu#custom-rows) for the `MenuRow` contract this row implements.

`enabled` is construction-time only — there is no `setEnabled`. A menu rebuilds its rows from scratch on every open (via each config's `row:` factory), so a row's enabled state is simply whatever the factory computes each time it runs; there is nothing to keep in sync between opens.

## Options

| Field | Purpose |
| --- | --- |
| `text` | Row label, rendered beside the checkbox graphic. |
| `checked` | Initial checked state. Defaults to `false`. |
| `enabled` | Whether the row is interactive. Defaults to `true`. A disabled row is dimmed and ignores clicks and Enter. |
| `listeners.action` | Construction-time listener, equivalent to `on("action", fn)`. |

## Methods

| Method | Purpose |
| --- | --- |
| `isChecked()` / `setChecked(boolean)` | Read / write the checked state. |
| `isEnabled()` | Whether the row is interactive — the construction-time `enabled` option. |
| `on("action", fn)` / `off("action", fn)` | Subscribe to each activation — a click or Enter — fires once per activation, after the row's own state has already flipped, so the handler reads the new value from `isChecked()`. |

## See also

- [API: CheckboxMenuRow](/api/component/container/classes/CheckboxMenuRow)
- [`Menu`](/components/Menu) — see its [Custom rows](/components/Menu#custom-rows) section
- [`MenuItem`](/components/MenuItem) — the default row a `MenuItemConfig` builds
- [`Checkbox`](/components/Checkbox) — the control this row hosts
