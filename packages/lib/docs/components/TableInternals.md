# Table internals

This page covers the structural sub-components of [`Table`](/components/Table) — the header, body, footer, row, and column primitives. You'll rarely instantiate them directly; they are built and managed by `Table`. Reach for them when you need to subclass for a custom column type or hook into the virtual-scrolling pipeline.

All symbols on this page are exported from `@jimka/typescript-ui/component/table`. The column-header strip is exported as `TableHeader` (already disambiguated from `component/display`'s `Header`). Since `Body`, `Row`, and `Column` still collide with other groups (e.g. display, layout), import those with an `as` rename in code that mixes them:

```typescript
import {
    TableHeader,
    Body as TableBody,
    Row as TableRow,
    FooterRow as TableFooter,
    Column as TableColumn,
} from '@jimka/typescript-ui/component/table';
```

## TableHeader

[`TableHeader`](/api/component/table/classes/TableHeader) renders the column-header strip as a `<thead>` element. Internally it contains **two** `Row` children: a parent-header row at child index 0 and the column-header row at child index 1. It builds one [`HeaderCell`](/api/component/table/classes/HeaderCell) per column in its current column window — the same horizontally-visible range (plus a small buffer) that [`Body`](/api/component/table/classes/Body) renders — wired with sort-click, resize-drag, and context-menu callbacks, and one [`ParentHeaderCell`](/api/component/table/classes/ParentHeaderCell) per contiguous run of grouped columns. When no visible column declares a [`group`](/components/Table#parent-headers), the parent row builds no cells and collapses to zero height, and the column row sits at `y = 0`.

## Body

[`Body`](/api/component/table/classes/Body) is the virtual-scrolling row container.

- Maintains a fixed pool of reusable row components.
- Only rows visible in the viewport plus a small buffer are in the DOM at any time.
- Scrolling is delegated to a [`VirtualScroller`](/components/VirtualScroller) — a rows-container `<div>` whose `translate3d` transform exposes the requested viewport, two custom [`Scrollbar`](/components/Scrollbar) overlays, and wheel/touch handlers with fling momentum. `overflow:hidden` on the body suppresses the native scroll path, removing the compositor-vs-JS race that caused a one-frame flicker during fast scrolling.
- Rebinds existing pool slots to new data via `setData()` only when their data index changes.
- Columns are windowed the same way: only the horizontally-visible column range (plus a small buffer) is rendered per row, so a wide table with many columns keeps a bounded number of cells in the DOM regardless of column count.

The full implementation lives in `src/typescript/lib/component/table/Body.ts` and is documented at the [API page](/api/component/table/classes/Body).

## FooterRow

[`FooterRow`](/api/component/table/classes/FooterRow) is an optional `<tfoot>` strip with a single [`Row`](/api/component/table/classes/Row). Use it for summary aggregations (totals, averages) computed externally and pushed in via the row.

## Row

[`Row`](/api/component/table/classes/Row) is a single data row rendered as a `<tr>`. It creates one typed cell per column in the body's current column window — picked from [`StringCell`](/api/component/table/classes/StringCell), [`NumberCell`](/api/component/table/classes/NumberCell), [`BooleanCell`](/api/component/table/classes/BooleanCell), [`DateCell`](/api/component/table/classes/DateCell), [`TimeCell`](/api/component/table/classes/TimeCell), [`DateTimeCell`](/api/component/table/classes/DateTimeCell), or [`DefaultCell`](/api/component/table/classes/DefaultCell) — and binds each cell's commit callback to the corresponding field on the bound [`ModelRecord`](/data/record). As the window slides (e.g. on a horizontal scroll), a cell whose column leaves the window is recycled for an entering column when the two need the same kind of cell, rather than one cell per column being kept for the row's lifetime. A displaced cell with no entering column to take it is kept in a per-row cache and restored when its column comes back into view, so narrowing a table and widening it again costs no cell construction. An ordinary one-direction slide reconciles only the columns actually entering or leaving the window, not the whole rendered range, with the same recycle/restore/build precedence as a wider change.

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

[`ParentHeaderCell`](/api/component/table/classes/ParentHeaderCell) also extends `DefaultCell` but strips the sort / resize machinery — parent cells are non-interactive labels for a contiguous run of columns. Each carries a `spanFrom` / `spanTo` index pair in its layout-constraints `data` slot; [`TableHeader`](/api/component/table/classes/TableHeader) reads those indices to position the cell at the sum of underlying column widths.

## Shared editor pool

Only one cell in the body is ever being edited at a time, so the built-in typed cells share editor instances through a [`CellEditorPool`](/api/component/table/classes/CellEditorPool) owned by [`Body`](/api/component/table/classes/Body). On `startEdit`, the cell asks the pool for the editor matching its `getEditorKey()` (e.g. `"string"`, `"time:seconds"`), re-parents that single editor into the active cell, and on commit/cancel detaches it again. The renderer side remains one component per cell — every visible row paints its own value.

[`BooleanCell`](/api/component/table/classes/BooleanCell) opts out: its `BooleanEditor` doubles as the renderer, so each row needs its own checkbox. Its `getEditorKey()` returns `null` and the cell allocates the editor up front exactly as before. [`GlyphCell`](/api/component/table/classes/GlyphCell) and [`DefaultCell`](/api/component/table/classes/DefaultCell) are read-only and have no editor.

Custom cell authors can opt in by overriding `getEditorKey()` and registering a factory on `body.getEditorPool()` — see [Custom cell type](/recipes/custom-cell).

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
