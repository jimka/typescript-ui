# Custom cell type

Build a `CurrencyCell` that formats numbers as currency strings on display and accepts numeric input on edit. The pattern works for any custom display + edit pair.

## Goal

A cell that shows `$1,234.50` in display mode and `1234.50` in a numeric editor. Double-click switches to edit mode; blur or Enter commits; Escape reverts.

## Build the renderer

A [`CellRenderer<T>`](/api/component/table/classes/CellRenderer) is responsible for the display side. Subclass it and override `setValue`:

```typescript
import { AnchorType, FillType } from '@jimka/typescript-ui/layout';
import { Text } from '@jimka/typescript-ui/component/input';
import { CellRenderer } from '@jimka/typescript-ui/component/table';
class CurrencyRenderer extends CellRenderer<number> {
    private text: Text = Text();

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

A [`CellEditor<T>`](/api/component/table/classes/CellEditor) takes over on double-click. Wrap a [`TextField`](/components/TextField) and parse the typed value back into a number:

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { TextField } from '@jimka/typescript-ui/component/input';
import { CellEditor } from '@jimka/typescript-ui/component/table';
class CurrencyEditor extends CellEditor<number> {
    private input: TextField = TextField();

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

A [`Cell<T>`](/api/component/table/classes/Cell) glues the renderer and editor together. There are two ways to wire the editor: the legacy "one editor per cell" path (simple, one-line constructor) and the shared-editor path that the built-in typed cells use to avoid allocating an editor per cell.

### Quick way — one editor per cell

Pass the editor straight to the base-class constructor. Each cell instance allocates its own editor up front, exactly like older versions of the framework:

```typescript
import { Cell } from '@jimka/typescript-ui/component/table';
class CurrencyCell extends Cell<number> {
    constructor() {
        super('td', new CurrencyRenderer(), new CurrencyEditor());
    }
}
```

This is the right shape for a one-off cell or a table with only a handful of rows. The cost grows with the row-pool size: a virtual table holding 30 pool slots × 10 currency columns allocates 300 editors that all sit idle except for the at-most-one cell currently being edited.

### Shared-editor way — borrow from the body's pool

A [`CellEditorPool`](/api/component/table/classes/CellEditorPool) lives on every [`Body`](/api/component/table/classes/Body) and hands out the same editor instance to every cell that asks for the same key. Override `getEditorKey()` instead of passing an editor to `super()`, then register a factory on the body's pool *before* the first edit:

```typescript
import { Cell } from '@jimka/typescript-ui/component/table';
class CurrencyCell extends Cell<number> {
    constructor() {
        super('td', new CurrencyRenderer());
    }

    getEditorKey(): string {
        return 'currency';
    }
}

// At table setup time, before the user can interact with the table:
table.getBody().getEditorPool().register('currency', () => new CurrencyEditor());
```

At most one `CurrencyEditor` is ever constructed for the whole table — the pool re-parents it into the active cell on `startEdit` and detaches it on commit/cancel. Pool keys are namespaced strings; pick a name unique to your cell type. If your cell takes a configuration flag that changes the editor (e.g. a `precision` setting), encode it into the key (`'currency:precision-4'`) so two columns with different configurations don't share the wrong editor.

## Use it in a Table

The simplest route is to subclass [`Row`](/api/component/table/classes/Row) and pick `CurrencyCell` for fields whose name matches a "money" pattern:

```typescript
import { Row as TableRow } from '@jimka/typescript-ui/component/table';
class MoneyAwareRow extends TableRow {
    protected createCellForField(fieldName: string, type: string): Cell<unknown> {
        if (fieldName === 'price' || fieldName === 'total') {
            return new CurrencyCell() as Cell<unknown>;
        }
        return super.createCellForField(fieldName, type);
    }
}
```

(Method names depend on the version — see [`Row`](/api/component/table/classes/Row) for the actual extension hooks.)

## Lifecycle hooks

A custom cell automatically gets the standard edit lifecycle:

- Double-click on the renderer starts an edit.
- The editor's `setValue` is called with the current cell value.
- Blur or **Enter** commits — `editor.getValue()` is called and the result is written back to the bound [`ModelRecord`](/data/record) field.
- **Escape** cancels and reverts.

## See also

- [Table internals](/components/TableInternals) — full overview of the cell pipeline
- [API: Cell](/api/component/table/classes/Cell), [CellRenderer](/api/component/table/classes/CellRenderer), [CellEditor](/api/component/table/classes/CellEditor)
- [`StringCell`](/api/component/table/classes/StringCell), [`NumberCell`](/api/component/table/classes/NumberCell), [`BooleanCell`](/api/component/table/classes/BooleanCell) — built-in references
