# Table internals

This page covers the structural sub-components of [`Table`](/components/Table) — the header, body, footer, row, and column primitives. You'll rarely instantiate them directly; they are built and managed by `Table`. Reach for them when you need to subclass for a custom column type or hook into the virtual-scrolling pipeline.

All symbols on this page are exported from `@jimka/typescript-ui/component/table`. Since `Header`, `Body`, `Row`, and `Column` collide with other groups (e.g. display, layout), import with an `as` rename in code that mixes them:

```typescript
import {
    Header as TableHeader,
    Body as TableBody,
    Row as TableRow,
    FooterRow as TableFooter,
    Column as TableColumn,
} from '@jimka/typescript-ui/component/table';
```

## Header

[`Header`](/api/component/table/classes/Header) renders the column-header strip as a `<thead>` element. It builds one [`HeaderCell`](/api/component/table/classes/HeaderCell) per visible field from the model, wired with sort-click, resize-drag, and context-menu callbacks.

## Body

[`Body`](/api/component/table/classes/Body) is the virtual-scrolling row container.

- Maintains a fixed pool of reusable row components.
- Only rows visible in the viewport plus a small buffer are in the DOM at any time.
- Scrolling is delegated to a [`VirtualScroller`](/components/VirtualScroller) — a rows-container `<div>` whose `translate3d` transform exposes the requested viewport, two custom [`Scrollbar`](/components/Scrollbar) overlays, and wheel/touch handlers with fling momentum. `overflow:hidden` on the body suppresses the native scroll path, removing the compositor-vs-JS race that caused a one-frame flicker during fast scrolling.
- Rebinds existing pool slots to new data via `setData()` only when their data index changes.

The full implementation lives in `src/typescript/lib/component/table/Body.ts` and is documented at the [API page](/api/component/table/classes/Body).

## FooterRow

[`FooterRow`](/api/component/table/classes/FooterRow) is an optional `<tfoot>` strip with a single [`Row`](/api/component/table/classes/Row). Use it for summary aggregations (totals, averages) computed externally and pushed in via the row.

## Row

[`Row`](/api/component/table/classes/Row) is a single data row rendered as a `<tr>`. It creates one typed cell per model field — picked from [`StringCell`](/api/component/table/classes/StringCell), [`NumberCell`](/api/component/table/classes/NumberCell), [`BooleanCell`](/api/component/table/classes/BooleanCell), [`DateCell`](/api/component/table/classes/DateCell), [`TimeCell`](/api/component/table/classes/TimeCell), [`DateTimeCell`](/api/component/table/classes/DateTimeCell), or [`DefaultCell`](/api/component/table/classes/DefaultCell) — and binds each cell's commit callback to the corresponding field on the bound [`ModelRecord`](/data/record).

## Column

[`Column`](/api/component/table/classes/Column) is a resolved presentation descriptor for a single column. Created internally — not constructed directly. It wraps a [`Field`](/api/data/classes/Field) and carries optional width constraints and an initial visibility flag derived from a [`ColumnSpec`](/api/component/table/interfaces/ColumnSpec).

## Cell types

The framework ships with seven typed cells, selected by [`Row`](/api/component/table/classes/Row) based on each field's declared type:

- [`StringCell`](/api/component/table/classes/StringCell) — read / write strings via [`StringRenderer`](/api/component/table/classes/StringRenderer) + [`StringEditor`](/api/component/table/classes/StringEditor).
- [`NumberCell`](/api/component/table/classes/NumberCell) — right-aligned numbers via [`NumberRenderer`](/api/component/table/classes/NumberRenderer) + [`NumberEditor`](/api/component/table/classes/NumberEditor).
- [`BooleanCell`](/api/component/table/classes/BooleanCell) — checkbox; the [`BooleanEditor`](/api/component/table/classes/BooleanEditor) doubles as the renderer.
- [`DateCell`](/api/component/table/classes/DateCell) — calendar date via [`DateRenderer`](/api/component/table/classes/DateRenderer) + [`DateEditor`](/api/component/table/classes/DateEditor).
- [`TimeCell`](/api/component/table/classes/TimeCell) — time-of-day via [`TimeRenderer`](/api/component/table/classes/TimeRenderer) + [`TimeEditor`](/api/component/table/classes/TimeEditor); honors the column's `showSeconds` flag.
- [`DateTimeCell`](/api/component/table/classes/DateTimeCell) — combined date + time via [`DateTimeRenderer`](/api/component/table/classes/DateTimeRenderer) + [`DateTimeEditor`](/api/component/table/classes/DateTimeEditor); honors the column's `showSeconds` flag.
- [`DefaultCell`](/api/component/table/classes/DefaultCell) — fallback for fields whose type is not explicitly mapped.

For `DateCell`, `TimeCell`, and `DateTimeCell`, committing an empty editor writes `null`; committing an unparseable value reverts to the previous value rather than writing `null`.

[`HeaderCell`](/api/component/table/classes/HeaderCell) extends `DefaultCell` with sort indicators, click-to-sort, and a resize drag handle.

## Building a custom cell type

Subclass [`Cell<T>`](/api/component/table/classes/Cell) with your own [`CellRenderer`](/api/component/table/classes/CellRenderer) and optional [`CellEditor`](/api/component/table/classes/CellEditor). The renderer displays the value; the editor takes over on double-click, commits on blur or Enter, and reverts on Escape.

```typescript
import { Cell, CellRenderer, CellEditor } from '@jimka/typescript-ui/component/table';
class CurrencyRenderer extends CellRenderer<number> { /* … */ }
class CurrencyEditor   extends CellEditor<number>   { /* … */ }

class CurrencyCell extends Cell<number> {
    constructor() {
        super('td', new CurrencyRenderer(), new CurrencyEditor());
    }
}
```

See [Custom cell type](/recipes/custom-cell) for the full pattern.

## See also

- [Table](/components/Table) — the parent component
- [Tree](/components/Tree) — uses a similar virtual-scrolling pool
- [API: Cell](/api/component/table/classes/Cell), [CellEditor](/api/component/table/classes/CellEditor), [CellRenderer](/api/component/table/classes/CellRenderer)
