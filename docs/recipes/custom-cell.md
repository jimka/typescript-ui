# Custom cell type

Build a `CurrencyCell` that formats numbers as currency strings on display and accepts numeric input on edit. The pattern works for any custom display + edit pair.

## Goal

A cell that shows `$1,234.50` in display mode and `1234.50` in a numeric editor. Double-click switches to edit mode; blur or Enter commits; Escape reverts.

## Build the renderer

A [`CellRenderer<T>`](/api/classes/CellRenderer) is responsible for the display side. Subclass it and override `setValue`:

```typescript
import {
    CellRenderer, Text, AnchorType, FillType,
} from '@jimka/typescript-ui';

class CurrencyRenderer extends CellRenderer<number> {
    private text: Text = new Text();

    constructor() {
        super();
        this.text.setTextAlign('right');
        this.addComponent(this.text, {
            fill:   FillType.HORIZONTAL,
            anchor: AnchorType.EAST,
        });
    }

    setValue(value: number): void {
        const formatted = new Intl.NumberFormat('en-US', {
            style:    'currency',
            currency: 'USD',
        }).format(value);
        this.text.setText(formatted);
    }
}
```

## Build the editor

A [`CellEditor<T>`](/api/classes/CellEditor) takes over on double-click. Wrap a [`TextField`](/components/TextField) and parse the typed value back into a number:

```typescript
import {
    CellEditor, TextField, Event,
} from '@jimka/typescript-ui';

class CurrencyEditor extends CellEditor<number> {
    private input: TextField = new TextField();

    constructor() {
        super();
        this.addComponent(this.input);
    }

    setValue(value: number): void {
        this.input.setValue(value.toFixed(2));
        this.input.select();
    }

    getValue(): number {
        const parsed = parseFloat(this.input.getValue());
        return Number.isNaN(parsed) ? 0 : parsed;
    }
}
```

## Compose the cell

A [`Cell<T>`](/api/classes/Cell) glues the renderer and editor together:

```typescript
import { Cell } from '@jimka/typescript-ui';

class CurrencyCell extends Cell<number> {
    constructor() {
        super('td', new CurrencyRenderer(), new CurrencyEditor());
    }
}
```

## Use it in a Table

The simplest route is to subclass [`Row`](/api/classes/TableRow) and pick `CurrencyCell` for fields whose name matches a "money" pattern:

```typescript
import { Row as TableRow } from '@jimka/typescript-ui';

class MoneyAwareRow extends TableRow {
    protected createCellForField(fieldName: string, type: string): Cell<unknown> {
        if (fieldName === 'price' || fieldName === 'total') {
            return new CurrencyCell() as Cell<unknown>;
        }
        return super.createCellForField(fieldName, type);
    }
}
```

(Method names depend on the version — see [`TableRow`](/api/classes/TableRow) for the actual extension hooks.)

## Lifecycle hooks

A custom cell automatically gets the standard edit lifecycle:

- Double-click on the renderer starts an edit.
- The editor's `setValue` is called with the current cell value.
- Blur or **Enter** commits — `editor.getValue()` is called and the result is written back to the bound [`ModelRecord`](/data/record) field.
- **Escape** cancels and reverts.

## See also

- [Table internals](/components/TableInternals) — full overview of the cell pipeline
- [API: Cell](/api/classes/Cell), [CellRenderer](/api/classes/CellRenderer), [CellEditor](/api/classes/CellEditor)
- [`StringCell`](/api/classes/StringCell), [`NumberCell`](/api/classes/NumberCell), [`BooleanCell`](/api/classes/BooleanCell) — built-in references
