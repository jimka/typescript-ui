# Table

[`Table`](/api/component/table/classes/Table) is a data-bound table component rendered as an HTML `<table>` element. It composes a header, a virtual-scrolling body, and an optional footer, all wired to an [`AbstractStore`](/data/store).

When no [`ColumnSpec`](/api/component/table/interfaces/ColumnSpec) is supplied, the table auto-generates one column per model field with default sizing.

## Quickest example

```typescript
import { Model, MemoryStore } from '@jimka/typescript-ui/data';
import { Table } from '@jimka/typescript-ui/component/table';
const PersonModel = new Model([
    { name: 'id',   type: 'number' },
    { name: 'name', type: 'string' },
    { name: 'age',  type: 'number' },
]);

const store = new MemoryStore(PersonModel, [
    { id: 1, name: 'Alice', age: 30 },
    { id: 2, name: 'Bob',   age: 25 },
]);
await store.load();

const table = Table(store);
panel.addComponent(table);
```

## Constraining columns

Pass a [`ColumnSpec`](/api/component/table/interfaces/ColumnSpec) to control which columns appear, their widths, and visibility:

```typescript
import { Table } from '@jimka/typescript-ui/component/table';
const table = Table(store, {
    columns: [
        { field: 'name', minWidth: 120 },
        { field: 'age',  maxWidth: 80, hidden: true },
    ],
    appendUnlisted: false,  // skip auto-generated columns for fields not listed
});
```

| `ColumnConfig` field | Purpose |
| --- | --- |
| `field` | Model field name presented in this column. |
| `minWidth` / `maxWidth` | Width constraints in pixels. |
| `hidden` | Initial hidden state. |
| `unhideable` | When `true`, the user cannot hide this column from the context menu. Takes precedence over `hidden`. |
| `readOnly` | When `true`, every cell in this column is display-only — double-click does not start an editor, and the cell renders with a subtle grey tint sourced from `--ts-ui-table-cell-readonly-bg`. Selection, keyboard navigation, sort, resize, and export still work. |
| `showSeconds` | For `time` / `datetime` columns: include seconds. |
| `headerGlyph` | Registry glyph name shown to the left of the header text. |
| `group` | Parent-header group name. See [Parent headers](#parent-headers). |
| `groupColor` | Optional background color for the parent-header cell. |

`appendUnlisted` (default `true`) controls whether fields not in the `columns` array are auto-generated after the listed ones.

## Parent headers

Tag adjacent columns with a `group` name and the table renders a second header row above the column-header row, with one cell spanning each contiguous group:

```typescript
import { Table } from '@jimka/typescript-ui/component/table';
const table = Table(store, {
    columns: [
        { field: 'street', group: 'Address' },
        { field: 'city',   group: 'Address' },
        { field: 'zip',    group: 'Address' },
        { field: 'cost',   group: 'Pricing', groupColor: 'rgba(30, 100, 200, 0.06)' },
        { field: 'margin', group: 'Pricing', groupColor: 'rgba(30, 100, 200, 0.06)' },
        { field: 'total',  group: 'Pricing', groupColor: 'rgba(30, 100, 200, 0.06)' },
    ],
});
```

- Only **adjacent** columns sharing the same `group` name merge into one parent cell. Reordering can split a group visually — that is intentional; the parent row reflects the current column layout, not the spec's logical groups.
- Columns without a `group` value render under an empty spanning cell so the band stays continuous; the body background never leaks through.
- Hiding all columns in a group collapses the parent cell automatically. When no visible column declares a `group` at all, the parent row collapses to zero height and the body fills the saved space.
- Parent cells are non-interactive — no sort cycle, no resize handle. Click and resize gestures stay on the column-header row beneath.
- `groupColor` is a plain CSS color string; the first non-null value in a contiguous run wins, so a partial annotation propagates across the whole run.

## Sorting and selection

- Click a column header to cycle through sort directions: ascending → descending → no sort.
- **Shift-click** a column header to compose a multi-column sort: each shift-click appends or toggles that column inside the current sort list (asc → desc → removed). When more than one column is active, a small priority badge (`2`, `3`, …) is shown on each non-primary column header.
- Drag a column header's right edge to resize.
- Right-click a column header to toggle column visibility via a context menu.
- `table.getSelectedRecord()` / `getSelectedRecords()` return the user's selection.

## Common methods

| Method | Purpose |
| --- | --- |
| `getStore()` / `setStore(store)` | Read / replace the bound store. |
| `getSelectedRecord()` / `getSelectedRecords()` | Current selection. |
| `setColumnVisible(field, boolean)` | Show / hide a column. |
| `setColumnWidths(widths[])` | Set all column widths at once. |
| `setHeaderVisible(boolean)` / `setBodyVisible(boolean)` / `setFooterVisible(boolean)` | Toggle structural sections. |
| `exportCSV(options?)` / `exportJSON(options?)` | Trigger a download of the current store view. |
| `setExportMenuEnabled(boolean)` | Adds "Export as CSV" / "Export as JSON" entries to the column context menu. |

## Exporting

`exportCSV()` and `exportJSON()` serialize the **current store view** — the same
filtered, sorted records the user sees — and trigger a browser download. By
default only visible columns are included; pass `{ includeHidden: true }` to
include columns hidden by the user or by the spec's `hidden` flag.

```typescript
table.exportCSV();                                  // visible columns → table-export.csv
table.exportJSON({ filename: 'people.json' });      // visible columns, custom filename
table.exportCSV({ includeHidden: true });           // every resolved column
```

To surface export from the column context menu, opt in:

```typescript
table.setExportMenuEnabled(true);
```

CSV output follows RFC 4180: fields containing `,`, `"`, or `\n` are wrapped in
double quotes and interior quotes are doubled. Null and undefined cell values
serialize as the empty string (CSV) or `null` (JSON).

Date, time, and datetime cells are formatted with the same `toLocaleDateString`
/ `toLocaleTimeString` / `toLocaleString` options the cell renderers use, so
exports match what the user sees — including the `showSeconds` setting from
the column spec.

`TablePanel` exposes the same three methods (`setExportMenuEnabled`,
`exportCSV`, `exportJSON`) as delegates to its inner `Table`.

## Performance

The body uses **virtual scrolling**: only rows visible in the viewport plus a small buffer are in the DOM at any time. A pool of reusable row components is rebound (not recreated) as the user scrolls. Scrolling itself is JS-owned via a [`VirtualScroller`](/components/VirtualScroller) — `translate3d` transform plus two custom [`Scrollbar`](/components/Scrollbar) overlays — with wheel, touch (fling momentum), and keyboard navigation funnelled through the same `setScrollY` / `setScrollX` entry points. See [`Body`](/api/component/table/classes/Body) for the implementation.

Horizontal scrolling kicks in automatically when the combined column width exceeds the table's width.

For large datasets, [`AbstractStore`](/api/data/classes/AbstractStore) automatically offloads sort and filter operations to a Web Worker once the dataset exceeds 1,000 rows.

## See also

- [API: Table](/api/component/table/classes/Table)
- [API: ColumnSpec](/api/component/table/interfaces/ColumnSpec), [ColumnConfig](/api/component/table/interfaces/ColumnConfig), [ExportOptions](/api/component/table/interfaces/ExportOptions)
- [`TablePanel`](/components/TablePanel) — table + add/remove/sync toolbar
- [Data layer](/data/) — Model, Store, Proxy, Binding
- Recipe: [CRUD with a Table](/recipes/crud-table)
