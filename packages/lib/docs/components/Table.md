# Table

[`Table`](/api/component/table/classes/Table) is a data-bound table component rendered as an HTML `<table>` element. It composes a header, a virtual-scrolling body, and an optional footer, all wired to an [`AbstractStore`](/data/store).

When no [`ColumnSpec`](/api/component/table/interfaces/ColumnSpec) is supplied, the table auto-generates one column per model field with default sizing.

<!-- demo: table-store -->
> **Live demo** — a store-bound `Table`: sortable, selectable, editable.
> [Open the Table page](https://jimka.github.io/typescript-ui/components/Table)
<!-- /demo -->

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
| `width` | Explicit starting width in pixels. Wins over the type policy and any sampled content, but is still clamped into `[minWidth, maxWidth]`. |
| `maxContentLength` | Longest value this column can hold, in characters (e.g. a `varchar(60)` column passes `60`). For a `string`/`auto` column under `autoSizeColumns` this is used only when sampling the store yields no candidates; for a `number` column it outranks the sample. |
| `preserveWidth` | When `true`, this column's width survives a container resize unchanged instead of scaling with the other flexible columns; the table scrolls horizontally if it no longer fits. Does not affect first render, a user drag-resize, or a data-driven re-sample. |
| `hidden` | Initial hidden state. |
| `unhideable` | When `true`, the user cannot hide this column from the context menu. Takes precedence over `hidden`. |
| `readOnly` | When `true`, every cell in this column is display-only — double-click does not start an editor, and the cell renders with a subtle grey tint sourced from `--ts-ui-table-cell-readonly-bg`. Selection, keyboard navigation, sort, resize, and export still work. |
| `cellReadOnly` | Optional predicate `(record) => boolean`. When it returns `true` for a record, this column's cell on that record's row renders read-only. Composes with `readOnly` and `ColumnSpec.rowReadOnly` (cell is read-only when ANY of the three says so). |
| `required` | When `true`, the header shows a trailing asterisk and every empty cell in this column renders with an outline sourced from `--ts-ui-table-cell-required-outline`. |
| `requiredPredicate` | Optional predicate `(record) => boolean`. When it returns `true` for a record, this column's cell on that record's row outlines when empty. Composes with `required` via OR for the outline; does NOT drive the header asterisk (the header has no bound record). |
| `showSeconds` | For `time` / `datetime` columns: include seconds. |
| `values` | When present, the column renders as a constrained-choice (combo-box) cell regardless of the field's type — see [Combo columns](#combo-columns). |
| `cellType` | Per-record variant resolver `(record) => CellType \| null`. When present, the column renders a different built-in cell variant per row — see [Per-cell cell types](#per-cell-cell-types). |
| `cellValues` | Per-record combo options `(record) => Array<ComboOption \| string> \| undefined`, consulted only when `cellType` resolves to `'combo'` for that record. |
| `headerGlyph` | Registry glyph name shown to the left of the header text. |
| `group` | Parent-header group name. See [Parent headers](#parent-headers). |
| `groupColor` | Optional background color for the parent-header cell. |
| `filterable` | When `false`, this column gets no filter input in the header's opt-in filter row. Defaults to `true`. See [Column filters](#column-filters). |

`appendUnlisted` (default `true`) controls whether fields not in the `columns` array are auto-generated after the listed ones. `ColumnSpec.filterable` sets the table-wide default for `ColumnConfig.filterable`; a column's own `filterable` still wins when set.

While a cell is being edited, Tab / Shift+Tab move the active edit to the neighboring column, Enter / Shift+Enter move it to the neighboring row, and PageUp / PageDown move it by a page of rows, committing the current cell first; at a grid edge the edit clamps back onto the same cell instead of wrapping. On a boolean cell, Space toggles it and Enter navigates instead of toggling.

Every column gets a width floor and a starting width derived from its field
type, whether or not a spec is supplied: a `boolean` column is sized for its
checkbox, a `glyph` column for one icon, a `date` / `time` / `datetime`
column for one formatted value, and a `number` column for its digit count.
None of these read the store. `string` and `auto` columns are the only
genuinely open-ended ones — by default they stay flex columns that share
whatever space is left. Setting `autoSizeColumns: true` on the spec turns
them into sized columns instead, measured from a bounded sample (at most 50
records) of the values each column actually holds:

```typescript
import { TablePanel } from '@jimka/typescript-ui/component/table';
// An empty `columns` array plus the default `appendUnlisted: true`
// auto-generates one column per model field, each sized to its content.
const panel = TablePanel(store, { columns: [], autoSizeColumns: true });
```

For one column, the first rule that applies wins: a width the user
drag-resized the column to beats everything else, returned verbatim with no
re-clamping; then an explicit `width` beats the type policy's derived width
(sampled content, for an auto-sized `string`/`auto` column), which beats
staying flex (`string`/`auto` with `autoSizeColumns` unset). A declared
`minWidth` replaces the type's floor rather than competing with it, and the
result — other than a drag-resized width — is always clamped to
`[minWidth, maxWidth]`.

A container resize normally scales every `string`/`auto` column's width
proportionally (`boolean`/`number`/`date` columns are always excluded).
Setting `preserveWidth: true` on a column's config opts it out of that
scaling, whatever its type — its width, however it was originally sized,
survives every later resize unchanged.

`ColumnSpec.rowReadOnly` is an optional predicate `(record) => boolean`. When it returns `true` for a record, every cell in that record's row renders read-only with the grey tint, regardless of the column's own `readOnly` flag. The predicate runs on every row rebind; it must be O(1) and pure. Mutating a store-owned record auto-refreshes the table; call [`store.notifyRecordChanged(record)`](/api/data/classes/AbstractStore#notifyRecordChanged) only for an unowned record or to force a refresh.

A cell is read-only when its column's `readOnly` flag is `true`, OR the spec's `rowReadOnly(record)` returns `true`, OR the column's `cellReadOnly(record)` returns `true`. The grey tint is the same in all three cases.

A column is required when its `required` flag is `true`, OR its `requiredPredicate(record)` returns `true`; the outline applies only while the bound value is empty (`null`, `undefined`, or `''` — `0` and `false` are legit values, not empty). The header asterisk reflects the static `required` flag alone, since the header has no bound record to evaluate a per-record predicate against. A read-only cell never shows the required outline — it can't be filled, so ringing it would be misleading. This is a visual affordance only: it does not block commits or integrate with store-level validation.

## Combo columns

Declare `values` on a column to turn it into a constrained-choice cell: the inline editor offers a dropdown of exactly those options instead of free text, and the cell displays each option's **label** for the stored value. This works regardless of the field's declared type — a `string` field is the natural fit, but any field can opt in.

```typescript
import { Table } from '@jimka/typescript-ui/component/table';
const table = Table(store, {
    columns: [
        { field: 'name' },
        { field: 'role', values: [
            { value: 'dev', label: 'Developer' },
            { value: 'qa',  label: 'QA Engineer' },
            { value: 'pm',  label: 'Project Manager' },
        ] },
        { field: 'priority', values: ['Low', 'Medium', 'High'] },  // plain strings: value === label
    ],
});
```

- Each entry is either a `{ value, label }` pair ([`ComboOption`](/api/component/table/interfaces/ComboOption)) or a plain string, which is shorthand for `value === label`.
- The **value** — the option's `value` string — is what is stored on the record and round-tripped on commit. The cell shows the matching **label**; a stored value outside the option set renders as the raw value rather than blanking.
- Double-clicking a combo cell opens the dropdown; picking an option (mouse or keyboard) commits it. The column honours `readOnly` / `cellReadOnly` / `rowReadOnly` like any other cell.
- `values` keys are strings. A combo column over a numeric field stores the chosen key verbatim as a string; convert on read if you need a number.
- The header's [filter row](#column-filters) matches the **label**, not the stored value — typing "Developer" finds every record whose `role` is `'dev'`.

## Per-cell cell types

`values` and the field-type switch pick one cell variant for an entire column. `cellType` picks the variant **per record**, so a single column can mix a checkbox, a combo, and a number input across its rows — the driving case is a Property/Value grid whose one `value` column must render differently depending on which property the row represents:

```typescript
import { Table } from '@jimka/typescript-ui/component/table';
import type { CellType } from '@jimka/typescript-ui/component/table';

const OWNER_OPTIONS    = [{ value: 'alice', label: 'Alice' }, { value: 'bob', label: 'Bob' }];
const DATATYPE_OPTIONS = [{ value: 'string', label: 'String' }, { value: 'number', label: 'Number' }];

const table = Table(store, {
    columns: [
        { field: 'property', readOnly: true },
        {
            field: 'value',
            cellType:   (r) => r.get('kind') as CellType,   // 'boolean' | 'number' | 'combo' | …
            cellValues: (r) => r.get('property') === 'Owner' ? OWNER_OPTIONS : DATATYPE_OPTIONS,
        },
    ],
});
```

- `CellType` is `FieldType | 'combo'` — `'string'`, `'number'`, `'boolean'`, `'date'`, `'time'`, `'datetime'`, `'glyph'`, or `'combo'`. Returning `null` (or leaving a case unhandled) falls back to the column's field-type-driven cell.
- `cellValues` is consulted only for rows where `cellType` resolves to `'combo'`; every combo row in the column still shares one pooled editor, reconfigured with that row's options on each edit — so declaring different `cellValues` per row (like `OWNER_OPTIONS` vs `DATATYPE_OPTIONS` above) does not fragment the pool.
- A column whose rows commit different native types (boolean in one row, number in another) **must** declare the field `'auto'` (the default `Field` type) — a `boolean`/`number`/`string` field type coerces every commit to that one type, corrupting the other rows' values.
- `readOnly` / `cellReadOnly` / `rowReadOnly` compose with a `cellType` column exactly as with any other cell.
- The boolean variant has no separate edit cycle — clicking the checkbox commits immediately, mirroring plain boolean columns.

<!-- demo: table-cell-types -->
> **Live demo** — the same store with a per-column `ColumnSpec`: `role` as
> a combo cell, `age` as a number cell.
> [Open the Table page](https://jimka.github.io/typescript-ui/components/Table)
<!-- /demo -->

## Rotated record view

`setDisplayMode("rotated")` swaps the table from one row per record to a psql `\x`-style expanded view: one `field` / `value` row per source column, showing a single record's fields as key/value pairs. This is the fix for a query result with dozens of columns, where reading one record in the normal view means scrolling horizontally across the whole width.

```typescript
import { Table } from '@jimka/typescript-ui/component/table';

const table = Table(store);

table.setDisplayMode("rotated");  // key/value rows for the selected record
table.getDisplayMode();           // "rotated"
table.setDisplayMode("normal");   // back to one row per record
```

- **The displayed record is the table's selection** — there is one concept, not two. Entering `"rotated"` adopts the current selection (falling back to the first visible record, then to nothing). While rotated, `table.selectRecord(record)` re-targets the view, and `getSelectedRecord()` / `getSelectedRecords()` keep returning that source record — never a projection (`field`/`value`) record. `Table` ships no stepper chrome; a consumer steps records by calling `selectRecord` with a neighbour from `table.getStore().getRecords()`, as the [Rotated demo](/components/) panel does with its Previous/Next buttons.
- **Per-field cell variants** come from the same `cellType` / `cellValues` mechanism described above — a boolean source field's row renders a checkbox, a `values`-constrained field's row renders a combo showing the option label, and so on.
- **The view is read-only.** Every value cell refuses inline editing; there is no write-back path from a field/value row to the source record.
- **Sorting the projection reorders the field rows** (e.g. alphabetically by field name) — it does not touch the source store's own sort, and un-rotating restores the normal column order.
- **The `field` and `value` columns stay compact** — each sizes to the displayed record's actual field labels and values, capped at a bounded maximum so a wide record does not stretch them across the whole table; a blank, expanding trailing column absorbs the leftover width, keeping the label and its value grouped on the left.
- **Export always covers the source table** — `exportCSV()` / `exportJSON()` / `exportTSV()` serialize every source record and column regardless of the active display mode, never the field/value projection.
- `setColumnVisible` is a no-op while rotated (the projection's data columns are always shown), and the column-header context menu shows only the export entries.
- `setRowVisible` is neutralized the same way while rotated (a predicate written against source records cannot apply to the field/value projection) and resumes filtering immediately on return to `"normal"` — even a predicate set while rotated is picked up then. `setQuickSearch` is neutralized and restored the same way, for the same reason.
- The [filter row](#column-filters) is absent while rotated, for the same reason: the projection has no per-column `filterable` field to filter on. The source store's filters stay applied underneath, and the row returns on return to `"normal"` with its toggle state and its previous operator/text intact.
- **Grouped source columns get a separator row, and their field rows are indented.** Entering rotated mode inserts a separator row before each [group](#parent-headers)'s contiguous run of field/value rows, labeled with the group name and tinted with `groupColor` when set; the run's own field rows render their `field`-name cell indented, nesting them visually under the separator so a column that follows the group without belonging to it doesn't read as still part of it. Both the separator and the indent are suppressed while the projection is sorted (clicking `field` or `value`) — a sort has no notion of group adjacency — and reappear as soon as the sort is cleared. Separator rows are not selectable, are not focusable, and are skipped by keyboard row navigation.

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
- The same `group` / `groupColor` declarations also drive a separator row in the [rotated record view](#rotated-record-view).

## Column filters

Every column is filterable by default: the header gets a third row — a text input plus an operator-picker button per filterable column — wired straight to the store's own filter system. It is the *row's visibility*, not filterability, that is opt-in: the row stays hidden by default, even on a table where every column is filterable. A user reveals it by opening the column context menu — right-clicking the header, or clicking the menu button in the strip above the vertical scrollbar — and checking **Filter**; a caller can do the same programmatically:

```typescript
import { Table } from '@jimka/typescript-ui/component/table';
const table = Table(store, { columns: [{ field: 'name' }, { field: 'age' }] });

table.setFilterRowVisible(true);   // show the filter row
table.isFilterRowVisible();        // true
```

Set `filterable: false` on a column — or `ColumnSpec.filterable: false` to change the table-wide default — to leave that column's cell blank in the filter row (it still renders, empty, so the row stays column-aligned):

```typescript
const table = Table(store, {
    columns: [
        { field: 'name' },
        { field: 'notes', filterable: false }, // free-text blob, not worth filtering on
    ],
});
```

The operators offered depend on the column's field type, and the first entry is that type's default:

| Field type | Operators | Default |
| --- | --- | --- |
| `string`, `auto`, `glyph` | Contains, Starts with, Ends with, Equals, Not equals, Is empty, Is not empty | Contains |
| `number` | Equals, Not equals, Greater than, At least, Less than, At most, Is empty, Is not empty | Equals |
| `date`, `time`, `datetime` | Equals, Not equals, Greater than, At least, Less than, At most, Contains, Starts with, Ends with, Is empty, Is not empty | Equals |
| `boolean` | Equals, Not equals, Is empty, Is not empty | Equals |

- **Substring operators are case-insensitive**; Contains / Starts with / Ends with match regardless of case. Equals / Not equals are exact and case-sensitive.
- **Equals on a temporal column matches every value that displays the same**, not the exact instant — a `date` column's Equals covers the whole calendar day, and a `time`/`datetime` column's covers the displayed minute (or second, under `showSeconds`).
- **Contains / Starts with / Ends with on a `date`/`time`/`datetime` column match the displayed text** — the same string the cell shows, including its locale format and its `showSeconds` setting — not the underlying `Date`'s raw form.
- **A `time` filter's operand is typed as displayed** — `09:30`, `09:30:20`, or `09:30 AM` — and anchored to 1970-01-01, mirroring the normalisation the time cell editor commits. A `time` field whose stored values carry a different date anchor will not match.
- **Typing debounces** for 200ms before writing to the store; picking a different operator, pressing Enter, or pressing Escape apply immediately, with no debounce wait.
- **Local vs. remote evaluation follows the store's `remoteFilter` option** — the filter row adds no second switch. A store with `pageSize` set should also set `remoteFilter: true`, or a page comes back unfiltered from the proxy and is only shrunk locally afterward.
- **Hiding a column leaves its filter active** — a filter is data state, not view state, so `setColumnVisible(field, false)` on a filtered column does not clear what it was filtering on. **Hiding the whole row is different**: `table.setFilterRowVisible(false)` clears every filter the row applied, since there is then no control left showing — or able to change — their criteria. Showing the row again starts every column back at its default operator with a blank input, not the criteria that were cleared.
- Each filter writes through [`store.setFilter(key, descriptor)`](/data/store#sort-and-filter), keyed by field name, so retyping in one column replaces only that column's descriptor — it never stacks a new filter per keystroke, and never disturbs another column's filter or one added through [`filter()`](/api/data/classes/AbstractStore#filter) / [`filterBy()`](/api/data/classes/AbstractStore#filterBy).
- **A [combo column](#combo-columns) filters on its label**, not the stored value — see above. A column with a custom `renderer` still filters on the stored value: it declares no option domain to resolve a typed label against.
- **A `number` column's filter input accepts only the characters a number is built from** — digits, `-`, and `.` — refusing anything else as it is typed, in both the always-visible inline input and every extra condition's field. A combo column declared over a numeric field is not restricted, since it filters on its labels rather than a parsed number. Pasted text is not filtered: pasting something unparseable leaves it in the field and applies no filter, as before.
- **A column filter is a query the store evaluates** — it goes through `store.setFilter`, changes what `getRecords()` returns, and can reach a remote proxy — while [quick search](#quick-search) is display-only and never reaches the store.

A column is no longer limited to one operator and one value: open a column's operator menu and pick **Add condition…** to add a second (or third, or more) AND-combined condition — `age ≥ 18 AND age ≤ 65`, or `name starts with "A" AND name contains "smith"`. The always-visible text input and operator button keep editing the first condition; every extra condition lives in a popover opened from the operator button, with its own operator picker, text field, and a remove control (the first condition is only ever clearable, never removable, matching the single-condition row). A small corner badge shows the count once a column carries two or more conditions, and disappears again — along with the popover — once it is trimmed back down to one, at which point the column looks exactly as it did before any extra condition was added. Once a column carries two or more conditions, clicking the operator button opens the conditions popover directly instead of the single-condition operator menu — the menu still opens normally below that threshold. Hovering the operator button then states the active conditions in words (e.g. `age At least "18" AND age At most "65"`), not just their count; the badge carries the same description as its accessible label for assistive tech, since the badge itself does not accept pointer input.

## Sorting and selection

- Click a column header to cycle through sort directions: ascending → descending → no sort.
- **Shift-click** a column header to compose a multi-column sort: each shift-click appends or toggles that column inside the current sort list (asc → desc → removed). When more than one column is active, a small priority badge (`2`, `3`, …) is shown on each non-primary column header.
- Right-click a column header — or click the menu button in the strip above the vertical scrollbar — to toggle column visibility via a context menu; see [Showing and hiding columns](#showing-and-hiding-columns) below.
- `table.getSelectedRecord()` / `getSelectedRecords()` return the user's selection.
- Click-drag across cells selects a rectangular range of cells — a plain click selects just the clicked cell, and Shift-click extends the range from the existing anchor. A drag that stays inside a single cell instead selects that cell's text natively, and Ctrl/Cmd+C copies that text; a drag that crosses into another cell switches to the rectangular range for the rest of the gesture, discarding the partial text selection. Ctrl/Cmd+C, or right-click a cell and choose **Copy** from the context menu, writes the selected range to the clipboard as tab-separated columns and newline-separated rows, so a paste into a spreadsheet lands each cell in its own cell — for `Table` and `TreeTable` alike. A copied range always covers whole cells. On a [`TreeTable`](/components/TreeTable), the row-reparent drag is not currently coordinated with the cell-range drag — both arm on mousedown, so dragging a row to reparent it can conflict with dragging across cells to select a range.

### Showing and hiding columns

The column context menu — opened by right-clicking a header cell, or by
clicking the menu button in the strip above the vertical scrollbar — lists
every resolved column's visibility as a checkable "Show/hide columns"
submenu, one row per column in field order. Each row is a real [`CheckboxMenuRow`](/components/CheckboxMenuRow),
so toggling it applies immediately and leaves the submenu open — several
columns can be flipped in one open. A grouped column's row sits under its
group name, rendered as a disabled section header above the group's members.
An `unhideable` column is still listed, but its row is a disabled checkbox —
it can never be turned off.

Past 20 resolved columns the trigger opens a modal dialog instead of the
submenu, so a wide table's toggles stay comfortable to scan and scroll
rather than filling a very tall panel. The dialog lists the same rows as
checkboxes — with group names as bold section headers — split into as many
side-by-side columns as it takes to keep each one to 15 checkboxes, sized as
evenly as possible; a group split across two dialog columns repeats its
section header at the top of the second. Nothing is written to the table as
you toggle checkboxes: **Apply** commits every change at once, while
**Cancel**, the dialog's own close button, and Escape all discard
every staged change and leave the table exactly as it was.

Toggle a column programmatically with
[`setColumnVisible`](/api/component/table/classes/Table#setcolumnvisible).

### Resizing columns

Drag a column header's right edge to resize. The edge splits the visible
columns into two chains fanning outward from it, nearest-first: dragging
right grows the dragged column and shrinks the columns to its right, one at a
time — the nearest column absorbs the travel until it reaches its `minWidth`,
then the next one out takes over. Dragging left reverses the direction.

This chaining only applies while the columns fit the container. Once every
column to the right of a rightward drag has reached its `minWidth`, further
travel widens the table's total column width instead of stalling — the table
scrolls horizontally, and the header scrolls in step with the body. From
there on the columns to the right are left alone entirely: while a horizontal
scrollbar is showing, dragging an edge resizes the column to its left and the
table's total width along with it, and nothing is scavenged. Reversing the
drag narrows the table back down to the container's width first, and only
then — with the columns fitting again — does a column to the right regrow.
The last column's right edge has no columns to its right at all, so dragging
it only changes the table's width, never any other column.

For example, with available width 500 and four columns at `[200, 150, 100,
50]` (`minWidth` 60/100/40/30), dragging the first column's right edge +200
gives up 130px from its neighbours before they bottom out, and the remaining
70px widens the table to 570.

## Events

`table.on("selection", records => …)` fires whenever the selected-record
set changes, receiving the current selection array.

`table.on("cellclick", e => …)` fires when the user clicks a data cell,
carrying the record and the exact column that was hit — so you can react to a
click on a specific cell without inferring the column from a selection change.
It is purely additive: the row still selects and `"selection"` still
fires, a single click does **not** open the inline editor, and clicking inside
an active editor does not steal its focus.

The payload object carries:

| Field | Meaning |
| --- | --- |
| `record` | The clicked row's bound record. |
| `field` | The clicked column's model field name (the stable column identity). |
| `columnIndex` | The column's index in visible-column order. |
| `value` | `record.get(field)` read at click time. |
| `rowIndex` | The record's index in the filtered + sorted view. |
| `event` | The raw DOM `MouseEvent`. |

A common use is foreign-key navigation — opening the record a clicked cell
points at:

```typescript
table.on("cellclick", e => {
    if (e.field === "managerId") {
        openRecord(managerStore.getById(e.value));
    }
});
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getStore()` / `setStore(store)` | Read / replace the bound store. |
| `getSelectedRecord()` / `getSelectedRecords()` | Current selection. |
| `setColumnVisible(field, boolean)` | Show / hide a column. |
| `setColumnWidths(widths[])` | Set all column widths at once. |
| `setHeaderVisible(boolean)` / `setBodyVisible(boolean)` / `setFooterVisible(boolean)` | Toggle structural sections. |
| `exportCSV(options?)` / `exportJSON(options?)` / `exportTSV(options?)` | Trigger a download of the current store view. |
| `setExportMenuEnabled(boolean)` | Adds "Export as CSV" / "Export as JSON" / "Export as TSV" entries to the column context menu. |
| `setQuickSearch(text, fields?)` | Hide rows whose displayed cell text does not contain `text`. |
| `setRowVisible(predicate)` | Hide rows that fail `predicate`, without touching the store. |
| `setFilterRowVisible(boolean)` | Show / hide the header's [filter row](#column-filters). |
| `getCellText(field, record)` | The exact text a cell shows for `field` on `record` — the same string export and the filter row resolve a combo label or formatted date/time/datetime through. |

## Quick search

`setQuickSearch(text, fields?)` hides every row whose displayed cell text does not contain `text`, matched case-insensitively — one call for the client-side quick-search case that used to mean hand-rolling a predicate and a per-record text cache:

```typescript
import { Table } from '@jimka/typescript-ui/component/table';

const table = Table(store);

searchBox.on("change", value => table.setQuickSearch(value));
```

With no `fields` argument, the searched columns default to every resolved column whose filter row would offer a **Contains** operator:

| Column | Type / config | Searched by default? | Why |
| --- | --- | --- | --- |
| `Name` | `string` | yes | `string` offers Contains |
| `Score` | `number` | yes | `number` offers Contains too |
| `Joined` | `date` | yes | matched on the cell's formatted text |
| `Role` | `string` + `values` (combo) | yes | matched on the option label, e.g. `Developer` |
| `Active` | `boolean` | **no** | `boolean` offers no Contains — the cell is a checkbox with no text |
| `Notes` | `string`, `hidden: true` | yes | hidden columns are still searched |
| a column with `filterable: false` | any | **no** | the same "don't offer text matching here" opt-out the filter row reads |

Pass `fields` to search an explicit list instead — every named field is searched verbatim, even one the default screen above would exclude.

- **Matches what's on screen.** Each field is resolved through [`getCellText(field, record)`](#common-methods), the same resolution the filter row uses, so a combo column matches its option label and a date/time/datetime column matches its formatted text, not the raw stored value.
- **A column with a custom `renderer` matches its stored value**, not what it draws — the renderer declares no text the table can resolve, the same limitation the filter row already has.
- **A `glyph` column is in the default scope and matches its stored glyph name**, not any visible text — there is none, since the column renders an icon. Pass `fields` to exclude it if that's not wanted.
- **Fields are joined with a newline**, so a needle typed into a single-line search box can never span two columns.
- **Composes with [`setRowVisible`](#row-visibility) via AND** — a row renders only when both agree, and setting one never clears the other.
- **Each record's searchable text is captured when first tested** against the active search and reused on every later render pass, refreshed automatically when the store reports that record changed. A bulk edit committed through `store.beginEdit()` / `commitEdit()` reports no per-record identity, so those records keep the text they were cached with — call `setQuickSearch` again to rebuild against fresh text.
- **Neutralized while rotated** — see the note in [Rotated record view](#rotated-record-view) below.
- **No effect on `TreeTable`** — see [`TreeTable`'s non-goals](/components/TreeTable#non-goals).

## Row visibility

`setRowVisible(predicate)` hides rows that fail a predicate, without touching the store — for a text search over displayed cells, see [Quick search](#quick-search) above; `setRowVisible` is the primitive for any other display-only condition, such as hiding rows by a status field:

```typescript
import { Table } from '@jimka/typescript-ui/component/table';

const table = Table(store);

table.setRowVisible(record => record.get('status') === 'open');
```

- **Display-only.** Hiding a row never touches `getStore()`'s records, the current selection, or a pending in-grid edit.
- **Re-applied automatically.** The predicate is re-consulted on every render pass, so it stays in effect across scrolling, sorting, store events (`add` / `remove` / `datachange` / …), and column show/hide — call `setRowVisible` again only when the predicate itself changes.
- **Composes with [`setQuickSearch`](#quick-search) via AND** — a row renders only when both agree, and setting one never clears the other.
- **Neutralized while rotated** — see the note in [Rotated record view](#rotated-record-view) below.
- **No effect on `TreeTable`** — see [`TreeTable`'s non-goals](/components/TreeTable#non-goals).

## Exporting

`exportCSV()`, `exportJSON()`, and `exportTSV()` serialize the **current store
view** — the same filtered, sorted records the user sees — and trigger a
browser download. By default only visible columns are included; pass
`{ includeHidden: true }` to include columns hidden by the user or by the
spec's `hidden` flag.

```typescript
table.exportCSV();                                  // visible columns → table-export.csv
table.exportJSON({ filename: 'people.json' });      // visible columns, custom filename
table.exportCSV({ includeHidden: true });           // every resolved column
table.exportTSV();                                  // visible columns → table-export.tsv
```

To surface export from the column context menu, opt in:

```typescript
table.setExportMenuEnabled(true);
```

CSV output follows RFC 4180: fields containing `,`, `"`, or `\n` are wrapped in
double quotes and interior quotes are doubled. Null and undefined cell values
serialize as the empty string (CSV) or `null` (JSON). TSV output follows the
same shape with its own trigger characters: a field containing a tab, `"`, or
`\n` is wrapped in double quotes with interior quotes doubled.

Date, time, and datetime cells are formatted with the same `toLocaleDateString`
/ `toLocaleTimeString` / `toLocaleString` options the cell renderers use, so
exports match what the user sees — including the `showSeconds` setting from
the column spec. A [combo column](#combo-columns) likewise exports its
**label**, not the stored code — a behaviour change to account for if the
export is meant to be re-imported.

`TablePanel` exposes the same four methods (`setExportMenuEnabled`,
`exportCSV`, `exportJSON`, `exportTSV`) as delegates to its inner `Table`.

## Performance

The body uses **virtual scrolling**: only rows visible in the viewport plus a small buffer are in the DOM at any time. A pool of reusable row components is rebound (not recreated) as the user scrolls. Scrolling itself is JS-owned via a [`VirtualScroller`](/components/VirtualScroller) — `translate3d` transform plus two custom [`Scrollbar`](/components/Scrollbar) overlays — with wheel, touch (fling momentum), and keyboard navigation funnelled through the same `setScrollY` / `setScrollX` entry points. See [`Body`](/api/component/table/classes/Body) for the implementation.

Horizontal scrolling kicks in automatically when the combined column width exceeds the table's width.

Deriving column widths costs at most three batched text measurements in
total, regardless of column count — one for the shared reference strings
(digit width, formatted reference date), one for the header labels, one for
the sampled body text — because every string measured in a pass is batched
into a single document reflow. The derivation runs on first layout, a store
swap, a reset, and on every source-store data change — load, add, remove, or
an in-cell edit (see `autoSizeColumns` above) — coalesced to at most one pass
per animation frame, so a burst of changes in one tick still costs a single
derivation. A column the user drag-resized keeps the width the drag left it
at through that re-derivation. In rotated display mode it also re-runs on
every record switch and on every source-store event, since the
`field`/`value` columns size to the currently displayed record. When
`autoSizeColumns` is on, at most 50 records are read to size `string`/`auto`
columns; `number` columns read the same sample for their digit count.

For large datasets, [`AbstractStore`](/api/data/classes/AbstractStore) automatically offloads sort and filter operations to a Web Worker once the dataset exceeds 1,000 rows.

## See also

- [API: Table](/api/component/table/classes/Table)
- [API: ColumnSpec](/api/component/table/interfaces/ColumnSpec), [ColumnConfig](/api/component/table/interfaces/ColumnConfig), [ExportOptions](/api/component/table/interfaces/ExportOptions)
- [`TablePanel`](/components/TablePanel) — table + add/remove/sync toolbar
- [Data layer](/data/) — Model, Store, Proxy, Binding
- Recipe: [CRUD with a Table](/recipes/crud-table)
