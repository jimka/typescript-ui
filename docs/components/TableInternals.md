# Table internals

This page covers the structural sub-components of [`Table`](/components/Table) — the header, body, footer, row, and column primitives. You'll rarely instantiate them directly; they are built and managed by `Table`. Reach for them when you need to subclass for a custom column type or hook into the virtual-scrolling pipeline.

## TableHeader

[`TableHeader`](/api/classes/TableHeader) renders the column-header strip as a `<thead>` element. It builds one [`HeaderCell`](/api/classes/HeaderCell) per visible field from the model, wired with sort-click, resize-drag, and context-menu callbacks.

Re-exported as `TableHeader` from `@jimka/typescript-ui` (the source class is `Header` in `Base/component/table/`).

## TableBody

[`TableBody`](/api/classes/TableBody) is the virtual-scrolling row container.

- Maintains a fixed pool of reusable row components.
- Only rows visible in the viewport plus a small buffer are in the DOM at any time.
- Scrolling is delegated to a [`VirtualScroller`](/components/VirtualScroller) — a rows-container `<div>` whose `translate3d` transform exposes the requested viewport, two custom [`Scrollbar`](/components/Scrollbar) overlays, and wheel/touch handlers with fling momentum. `overflow:hidden` on the body suppresses the native scroll path, removing the compositor-vs-JS race that caused a one-frame flicker during fast scrolling.
- Rebinds existing pool slots to new data via `setData()` only when their data index changes.

The full implementation lives in `src/typescript/Base/component/table/Body.ts` and is documented at the [API page](/api/classes/TableBody).

## TableFooter

[`TableFooter`](/api/classes/TableFooter) is an optional `<tfoot>` strip with a single [`TableRow`](/api/classes/TableRow). Use it for summary aggregations (totals, averages) computed externally and pushed in via the row.

## TableRow

[`TableRow`](/api/classes/TableRow) is a single data row rendered as a `<tr>`. It creates one typed cell per model field — picked from [`StringCell`](/api/classes/StringCell), [`NumberCell`](/api/classes/NumberCell), [`BooleanCell`](/api/classes/BooleanCell), [`DateCell`](/api/classes/DateCell), [`TimeCell`](/api/classes/TimeCell), [`DateTimeCell`](/api/classes/DateTimeCell), or [`DefaultCell`](/api/classes/DefaultCell) — and binds each cell's commit callback to the corresponding field on the bound [`ModelRecord`](/data/record).

## TableColumn

[`TableColumn`](/api/classes/TableColumn) is a resolved presentation descriptor for a single column. Created internally — not constructed directly. It wraps a [`Field`](/api/classes/Field) and carries optional width constraints and an initial visibility flag derived from a [`ColumnSpec`](/api/interfaces/ColumnSpec).

## Cell types

The framework ships with seven typed cells, selected by [`TableRow`](/api/classes/TableRow) based on each field's declared type:

- [`StringCell`](/api/classes/StringCell) — read / write strings via [`StringRenderer`](/api/classes/StringRenderer) + [`StringEditor`](/api/classes/StringEditor).
- [`NumberCell`](/api/classes/NumberCell) — right-aligned numbers via [`NumberRenderer`](/api/classes/NumberRenderer) + [`NumberEditor`](/api/classes/NumberEditor).
- [`BooleanCell`](/api/classes/BooleanCell) — checkbox; the [`BooleanEditor`](/api/classes/BooleanEditor) doubles as the renderer.
- [`DateCell`](/api/classes/DateCell) — calendar date via [`DateRenderer`](/api/classes/DateRenderer) + [`DateEditor`](/api/classes/DateEditor).
- [`TimeCell`](/api/classes/TimeCell) — time-of-day via [`TimeRenderer`](/api/classes/TimeRenderer) + [`TimeEditor`](/api/classes/TimeEditor); honors the column's `showSeconds` flag.
- [`DateTimeCell`](/api/classes/DateTimeCell) — combined date + time via [`DateTimeRenderer`](/api/classes/DateTimeRenderer) + [`DateTimeEditor`](/api/classes/DateTimeEditor); honors the column's `showSeconds` flag.
- [`DefaultCell`](/api/classes/DefaultCell) — fallback for fields whose type is not explicitly mapped.

For `DateCell`, `TimeCell`, and `DateTimeCell`, committing an empty editor writes `null`; committing an unparseable value reverts to the previous value rather than writing `null`.

[`HeaderCell`](/api/classes/HeaderCell) extends `DefaultCell` with sort indicators, click-to-sort, and a resize drag handle.

## Building a custom cell type

Subclass [`Cell<T>`](/api/classes/Cell) with your own [`CellRenderer`](/api/classes/CellRenderer) and optional [`CellEditor`](/api/classes/CellEditor). The renderer displays the value; the editor takes over on double-click, commits on blur or Enter, and reverts on Escape.

```typescript
import { Cell, CellRenderer, CellEditor } from '@jimka/typescript-ui';

class CurrencyRenderer extends CellRenderer<number> { /* … */ }
class CurrencyEditor   extends CellEditor<number>   { /* … */ }

class CurrencyCell extends Cell<number> {
    constructor() {
        super('td', new CurrencyRenderer(), new CurrencyEditor());
    }
}
```

A dedicated recipe page covering the full pattern is forthcoming.

## See also

- [Table](/components/Table) — the parent component
- [Tree](/components/Tree) — uses a similar virtual-scrolling pool
- [API: Cell](/api/classes/Cell), [CellEditor](/api/classes/CellEditor), [CellRenderer](/api/classes/CellRenderer)
