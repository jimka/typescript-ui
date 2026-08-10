# Table Column Filters — Implementation Plan

## Overview

Add an optional filter row to a `Table`'s header. Each filterable column gets a text input plus an operator picker (contains, starts-with, ends-with, equals, greater-than, …); typing or picking pushes one `FilterDescriptor` into the bound store, and the rendered rows update.

The row is hidden by default, even on a table where every column is `filterable`. It appears only after the user right-clicks the header and checks a new **Filter** entry in the existing column context menu — the same menu that already lists per-column show/hide toggles — and a matching `Table.setFilterRowVisible()` gives a caller the same switch programmatically.

The row is built on the store's existing filter system — [`packages/lib/src/typescript/lib/data/FilterDescriptor.ts`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts) and [`AbstractStore.ts:1482-1557`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1482) — not on `Table.setRowVisible`.[^not-row-visible] Whether a filter is evaluated in the browser or sent to the proxy is decided by the store's existing `remoteFilter` option ([`AbstractStore.ts:214`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L214)); the filter row adds no second switch.

The data layer is extended first. `FilterDescriptor` gets an `endsWith` variant and a `Date`-aware equality test, and `AbstractStore` gets a keyed `setFilter(key, descriptor)` primitive so one column's descriptor can be replaced without stacking a new one per keystroke and without touching another column's filter. The UI half adds a third `Row` to [`Header.ts`](../packages/lib/src/typescript/lib/component/table/Header.ts), reusing the collapsing-row shape of the optional parent-header row that already lives there at index 0 ([`Header.ts:338-342`](../packages/lib/src/typescript/lib/component/table/Header.ts#L338)), and [`Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts) gains the visibility toggle and its context-menu entry.

---

## Architecture Decisions

### The filter row is a third `Row` in `TableHeader`, hidden until toggled from the header context menu

`TableHeader` already owns two `Row` children — a parent-header row at index 0 that collapses to zero height when no visible column declares a `group`, and the column row at index 1 ([`Header.ts:111-119`](../packages/lib/src/typescript/lib/component/table/Header.ts#L111)). The filter row is a third `Row` at index 2, reusing that same collapsing-`Row` shape. Unlike the parent row, it does not show itself the moment a column qualifies: `hasFilterRow()` is `true` only when a table-level toggle is on **and** at least one visible column is filterable, so a table renders exactly as it does today until the user opts in.[^mirror-parent-row]

### The toggle lives on `Table`, with a public setter alongside the context-menu action

`Table` gets `_filterRowVisible: boolean = false` and `isFilterRowVisible()`, matching the private-field-plus-getter shape of `_headerVisible` / `isHeaderVisible()` ([`Table.ts:156,667-669`](../packages/lib/src/typescript/lib/component/table/Table.ts#L156)). It also gets a public `setFilterRowVisible(visible): this`, mirroring `setExportMenuEnabled` ([`Table.ts:1326-1330`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1326)), so the menu's click handler and a programmatic caller share one path instead of the menu poking a private field directly.[^filter-toggle-setter] `Table` pushes the flag to the header through a new `TableHeader.setFilterRowVisible(visible): this`, the same direct-setter channel `setColumnVisible` already uses to push `this._header.setHiddenColumns(...)` ([`Table.ts:645`](../packages/lib/src/typescript/lib/component/table/Table.ts#L645)).

### A `Filter` entry joins the header's context menu, gated on any column being filterable

`showColumnMenu` ([`Table.ts:1242-1318`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1242)) gains a checkbox-style entry — `'✓ Filter'` when the toggle is on, `'  Filter'` when it is off — placed right after `'Reset columns'`, whose `action` calls `setFilterRowVisible`. It is added only when at least one of `_resolvedColumns` is filterable.[^filter-menu-gate]

### A filter cell is a `Cell` whose renderer holds the input and the operator button

`FilterCell extends Cell<string | null>`, so the existing `Row.addComponent(cell: Cell<any>)` signature ([`Row.ts:219`](../packages/lib/src/typescript/lib/component/table/Row.ts#L219)) and the header's own geometry pass need no change. Its renderer, `FilterCellRenderer extends CellRenderer<string | null>`, swaps the base `Fit` layout for an `HBox` and holds two children: a `TextField` carrying `{ weight: 1 }`, and a fixed-width `MenuButton` whose dropdown lists the column's operators.[^renderer-hosts-controls]

### Filter cells are virtualized and stateless; the header owns the state

The column row renders only the horizontally-visible column window ([`Header.ts:485-608`](../packages/lib/src/typescript/lib/component/table/Header.ts#L485)), so the filter row does too — a 200-column table must not build 200 text fields. A cell is therefore recycled onto whatever column enters the window, and carries no durable state of its own. `TableHeader` holds the per-column `{ operator, text }` map and re-applies it to every rendered cell on every reconcile, exactly as `syncSortIndicators` re-applies sort arrows ([`Header.ts:776-792`](../packages/lib/src/typescript/lib/component/table/Header.ts#L776)).

The map is held per store in a `WeakMap<AbstractStore, Map<string, ColumnFilterState>>`, so a round trip through rotated mode (which re-points the header at the projection store and back) restores the source store's filter row unchanged.[^per-store-state]

### Local-vs-remote is inherited from the store, with no new toggle

`AbstractStore.applyFilterChange()` already routes a filter change both ways: it rebuilds the local view through `applyView()`, and — when `remoteFilter` is on or pagination is enabled — resets to page 1 and reloads, with `buildReadParams()` serializing the active filters into `ReadParams.filters` ([`AbstractStore.ts:376-399,1526-1542`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L376)). The filter row calls `setFilter`, which goes through the same `applyFilterChange()`, so it composes with the local path, the remote path, and the Web Worker offload path with no branch of its own.[^remote-composes]

### Keystrokes are debounced on the header, not on the cell

A keystroke schedules the store write after 200 ms; picking an operator, pressing Enter, and pressing Escape apply immediately. The timer lives on `TableHeader` and remembers the *field name*, not the cell, because a horizontal scroll can recycle the cell onto a different column while the write is still pending.[^debounce-on-header]

### `endsWith` is added to the descriptor algebra; `eq` / `neq` learn about `Date`

`FilterDescriptor` gains `{ type: 'endsWith'; field; value; caseSensitive? }` and its `matchesFilter` case, copied from the `startsWith` case at [`FilterDescriptor.ts:57-63`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L57).

`matchesFilter`'s `eq` and `neq` cases additionally compare two `Date` operands by `getTime()`. Without that, an `equals` filter on a `date` / `time` / `datetime` column can never match, because `===` on two `Date` objects is reference equality.[^date-equality]

### `isEmpty` / `isNotEmpty` reuse the existing algebra

Neither becomes a new descriptor variant. `isEmpty` builds `{ type: 'in', field, values: [null, undefined, ''] }`; `isNotEmpty` wraps that in `{ type: 'not', filter: … }`. Both already evaluate correctly in `matchesFilter` and cross the worker boundary as plain objects.

### All operator and text-to-descriptor logic lives in one pure module

`component/table/ColumnFilter.ts` holds the operator union, the per-field-type operator lists, the display labels, and `buildColumnFilter()` — the function that turns `(field, fieldType, { operator, text })` into a `FilterDescriptor` or `null`. It touches no DOM and no store, so the whole mapping is unit-testable, mirroring how `compareValues.ts` and `computeColumnWindow` isolate the logic their components depend on.

### Hiding a column leaves its filter active

`Table.setColumnVisible(field, false)` does not clear the column's filter, matching how hiding a sorted column leaves the store's sorter in place. A filter is data state, not view state.

---

## Public API

```typescript
// data/FilterDescriptor.ts — one new member of the existing union
export type FilterDescriptor =
    | /* …existing members unchanged… */
    | { type: 'endsWith'; field: string; value: string; caseSensitive?: boolean };
```

```typescript
// data/AbstractStore.ts
class AbstractStore {
    /** Replaces (or removes, when `descriptor` is null) the single filter stored under `key`. */
    setFilter(key: string, descriptor: FilterDescriptor | null): Promise<void>;
    /** Returns the descriptor stored under `key`, or null. */
    getFilter(key: string): FilterDescriptor | null;
}
```

`filter()`, `filterBy()`, `clearFilter()`, and `getActiveFilters()` keep their current signatures and behaviour. The backing field changes shape:

| Class | Field | Was | Becomes |
| --- | --- | --- | --- |
| `AbstractStore` | `_activeFilters` | `FilterDescriptor[]` | `Map<string \| symbol, FilterDescriptor>` |

Entries added by `filter()` / `filterBy()` / the `filters` option are keyed by a fresh `Symbol()`, so they can never collide with a string key passed to `setFilter`.[^symbol-keys] `getActiveFilters()` returns the map's values in insertion order, so existing callers see no change.

```typescript
// component/table/ColumnFilter.ts (new)
export type ColumnFilterOperator =
    | 'contains' | 'startsWith' | 'endsWith'
    | 'eq' | 'neq'
    | 'gt' | 'gte' | 'lt' | 'lte'
    | 'isEmpty' | 'isNotEmpty';

export interface ColumnFilterState {
    operator: ColumnFilterOperator;
    text:     string;
}

/** The operators offered for a field type. The first entry is that type's default. */
export function columnFilterOperators(type: FieldType): ColumnFilterOperator[];
/** Menu label, e.g. `'Starts with'`. */
export function columnFilterOperatorLabel(operator: ColumnFilterOperator): string;
/** One- or two-character button face, e.g. `'^'`. */
export function columnFilterOperatorSymbol(operator: ColumnFilterOperator): string;
/** False for `isEmpty` / `isNotEmpty`, which ignore the text input. */
export function columnFilterTakesOperand(operator: ColumnFilterOperator): boolean;
/** Builds the descriptor for one column, or null when the state produces no filter. */
export function buildColumnFilter(field: string, type: FieldType, state: ColumnFilterState): FilterDescriptor | null;
```

```typescript
// component/table/ColumnConfig.ts
export interface ColumnConfig {
    /** When `true`, this column gets a filter input in the header's filter row. */
    filterable ?: boolean;
}

export interface ColumnSpec {
    /** Table-wide default for `ColumnConfig.filterable`. Defaults to `false`. */
    filterable ?: boolean;
}
```

```typescript
// component/table/Column.ts
export class Column {
    constructor(field: Field, config?: ColumnConfig, specFilterable?: boolean);
    isFilterable(): boolean;
}
```

```typescript
// component/table/cell/renderer/Filter.ts (new)
class FilterCellRenderer extends CellRenderer<string | null> {
    getInput(): TextField;
    getOperatorButton(): MenuButton;
    getValue(): string | null;
    setValue(value: string | null): void;
}
```

```typescript
// component/table/cell/Filter.ts (new)
export type FilterCellEvent = CellEvent | "filterchange";

class FilterCell extends Cell<string | null> {
    constructor(fieldName: string, operators: ColumnFilterOperator[]);
    setFieldName(name: string): this;
    getFieldName(): string;
    /**
     * Replaces the offered operators; falls back to `operators[0]` when the current one is not
     * in the new list. An **empty array** marks the column non-filterable: the cell renders
     * blank (no input, no operator button) and emits nothing.
     */
    setOperators(operators: ColumnFilterOperator[]): this;
    /** Sets the accessible name of the text input (the column's header label). */
    setColumnLabel(label: string): this;
    /** Writes operator + text without emitting `"filterchange"`. */
    setFilterState(state: ColumnFilterState): this;
    getFilterState(): ColumnFilterState;

    on(event: "filterchange", listener: (fieldName: string, state: ColumnFilterState, immediate: boolean) => void): this;
}
```

```typescript
// component/table/Header.ts
export interface HeaderColumnGeometry {
    /** …existing members unchanged… */
    /** Height of the filter row, in pixels; `0` when it is collapsed. */
    filterRowHeight: number;
}

class TableHeader extends Component {
    /** The filter row. Always present; zero cells and zero height when collapsed. */
    getFilterRow(): Row;
    /** `true` when the table-level filter-row toggle is on and at least one visible column is filterable. */
    hasFilterRow(): boolean;
    /** Shows or hides the filter row; pushed down from {@link Table.setFilterRowVisible}. */
    setFilterRowVisible(visible: boolean): this;
}
```

```typescript
// component/table/Table.ts
class Table {
    /** Returns whether the header's filter row is currently shown. */
    isFilterRowVisible(): boolean;
    /**
     * Shows or hides the header's filter row. Also reachable from the header's
     * right-click context menu via its checkbox-style "Filter" entry.
     */
    setFilterRowVisible(visible: boolean): this;
}
```

---

## Internal Structure

### Operators per field type

`columnFilterOperators(type)` returns, in menu order (first entry is the default):

| Field type | Operators |
| --- | --- |
| `string`, `auto`, `glyph` | `contains`, `startsWith`, `endsWith`, `eq`, `neq`, `isEmpty`, `isNotEmpty` |
| `number` | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `isEmpty`, `isNotEmpty` |
| `date`, `time`, `datetime` | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `isEmpty`, `isNotEmpty` |
| `boolean` | `eq`, `neq`, `isEmpty`, `isNotEmpty` |

Labels and button faces:

| Operator | Face | Label |
| --- | --- | --- |
| `contains` | `∋` | Contains |
| `startsWith` | `^` | Starts with |
| `endsWith` | `$` | Ends with |
| `eq` | `=` | Equals |
| `neq` | `≠` | Not equals |
| `gt` | `>` | Greater than |
| `gte` | `≥` | At least |
| `lt` | `<` | Less than |
| `lte` | `≤` | At most |
| `isEmpty` | `∅` | Is empty |
| `isNotEmpty` | `!∅` | Is not empty |

### `buildColumnFilter` — text to descriptor

Blank text on an operator that takes an operand yields `null` (no filter). Text that cannot be parsed to the column's type also yields `null`, so a half-typed number never blanks the table.

| Field type | Operator | Text | Result |
| --- | --- | --- | --- |
| `string` | `contains` | `ali` | `{ type: 'contains', field: 'name', value: 'ali' }` |
| `string` | `endsWith` | `son` | `{ type: 'endsWith', field: 'name', value: 'son' }` |
| `string` | `contains` | `` | `null` |
| `string` | `isEmpty` | (ignored) | `{ type: 'in', field: 'name', values: [null, undefined, ''] }` |
| `string` | `isNotEmpty` | (ignored) | `{ type: 'not', filter: { type: 'in', field: 'name', values: [null, undefined, ''] } }` |
| `number` | `gt` | `30` | `{ type: 'gt', field: 'age', value: 30 }` |
| `number` | `gt` | `abc` | `null` |
| `boolean` | `eq` | `yes` | `{ type: 'eq', field: 'active', value: true }` |
| `boolean` | `eq` | `maybe` | `null` |
| `date` | `gte` | `2024-01-15` | `{ type: 'gte', field: 'due', value: new Date('2024-01-15') }` |
| `date` | `gte` | `not-a-date` | `null` |

Parsing rules: `string` / `auto` / `glyph` use the text verbatim; `number` uses `Number(text)` and rejects `NaN`; `boolean` accepts `true` / `1` / `yes` and `false` / `0` / `no` case-insensitively and rejects anything else, mirroring `Field.convertBoolean` ([`Field.ts:220-233`](../packages/lib/src/typescript/lib/data/Field.ts#L220)); temporal types use `new Date(text)` and reject an invalid date. The substring operators omit `caseSensitive`, so they match case-insensitively; `eq` / `neq` are exact and case-sensitive, because that is the descriptor algebra's existing tested contract.

### `filterable` resolution

`Column.isFilterable()` returns `config.filterable ?? specFilterable ?? false`, resolved once in `Column.resolve` ([`Column.ts:228-247`](../packages/lib/src/typescript/lib/component/table/Column.ts#L228)):

| `ColumnSpec.filterable` | `ColumnConfig.filterable` | `isFilterable()` |
| --- | --- | --- |
| unset | unset | `false` |
| unset | `true` | `true` |
| `true` | unset | `true` |
| `true` | `false` | `false` |
| `false` | `true` | `true` |

### `AbstractStore` keyed filters

```typescript
private _activeFilters: Map<string | symbol, FilterDescriptor> = new Map();

setFilter(key: string, descriptor: FilterDescriptor | null): Promise<void> {
    if (descriptor === null) {
        this._activeFilters.delete(key);
    } else {
        this._activeFilters.set(key, descriptor);
    }

    return this.applyFilterChange();
}

getFilter(key: string): FilterDescriptor | null {
    const descriptor = this._activeFilters.get(key);

    return descriptor ? { ...descriptor } : null;
}
```

Every existing read site iterates the map's values instead of the array:

| Site | Was | Becomes |
| --- | --- | --- |
| [`applyOptions:268-270`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L268) | `this._activeFilters = options.filters.slice()` | `for (const f of options.filters) this._activeFilters.set(Symbol(), f)` |
| [`buildReadParams:388`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L388) | `this._activeFilters.length > 0` | `this._activeFilters.size > 0` |
| [`getActiveFilters:1451`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1451) | `this._activeFilters.map(…)` | `[...this._activeFilters.values()].map(f => ({ ...f }))` |
| [`filter:1497`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1497) / [`filterBy:1514`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1514) | `.push(descriptor)` | `.set(Symbol(), descriptor)` |
| [`clearFilter:1554`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1554) | `this._activeFilters = []` | `this._activeFilters.clear()` |
| [`applyView:1834-1836`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1834) | `for (const d of this._activeFilters)` | `for (const d of this._activeFilters.values())` |
| [`applyViewOnWorker:1950-1954`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1950) | `this._activeFilters.length` / `[0]` / `{ type: 'and', filters: this._activeFilters }` | same shape over `const active = [...this._activeFilters.values()]` |

### The visibility toggle: `Table`, `TableHeader`, and the context menu

`Table` owns the toggle; `TableHeader` mirrors it into a field of the same name, pushed down the same way `_hiddenColumns` is:

```typescript
// component/table/Table.ts
private _filterRowVisible: boolean = false;

isFilterRowVisible(): boolean {
    return this._filterRowVisible;
}

setFilterRowVisible(visible: boolean): this {
    if (visible === this._filterRowVisible) {
        return this;
    }

    this._filterRowVisible = visible;
    this._header.setFilterRowVisible(visible);
    this.doLayout();

    return this;
}
```

```typescript
// component/table/Header.ts
private _filterRowVisible: boolean = false;

hasFilterRow(): boolean {
    return this._filterRowVisible
        && this._columns
               .filter(c => !this._hiddenColumns.has(c.getField().getName()))
               .some(c => c.isFilterable());
}

setFilterRowVisible(visible: boolean): this {
    if (visible === this._filterRowVisible) {
        return this;
    }

    this._filterRowVisible = visible;
    this._filterCellsDirty = true;

    return this;
}
```

`Table.showColumnMenu` ([`Table.ts:1242-1318`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1242)) gets one new block, inserted after the `'Reset columns'` push and before the `_exportMenuEnabled` block:

```typescript
if (this._resolvedColumns.some(c => c.isFilterable())) {
    items.push(
        { separator: true },
        {
            text:   (this._filterRowVisible ? '✓ ' : '  ') + 'Filter',
            action: () => this.setFilterRowVisible(!this._filterRowVisible),
        },
    );
}
```

### `TableHeader` filter state and debounce

```typescript
const COLUMN_FILTER_DEBOUNCE_MS = 200;   // matches AutoCompleteField's default keystroke debounce

private _filterStates      : WeakMap<AbstractStore, Map<string, ColumnFilterState>> = new WeakMap();
private _filterCellsDirty  : boolean = true;
private _filterWindowFirst : number = 0;
private _pendingFilterField: string | null = null;
private _filterTimer       : ReturnType<typeof setTimeout> | null = null;
```

`filterState()` returns (creating on first use) the map for `this._store`.

`onFilterCellChange(fieldName, state, immediate)`:

1. Return early when the cached state for `fieldName` already equals `state` — this is what stops a repeat keystroke from re-writing the store.
2. Store `state` in `filterState()`.
3. If a different field's write is pending, apply it now.
4. Set `_pendingFilterField = fieldName`, restart the timer — or, when `immediate`, call `applyPendingFilter()` directly.

`applyPendingFilter()` clears the timer, reads the pending field's state and the field's `FieldType` from `this._model`, and calls `this._store.setFilter(field, buildColumnFilter(field, type, state))`.

`onStoreFilterChange()` (registered on the store's `'filterchange'` event) drops any cached entry whose column no longer has a filter in the store *and* whose cached state would have produced one, then marks `_filterCellsDirty` and re-renders. The currently pending field is skipped.[^store-resync]

### Filter-cell reconcile

`reconcileFilterCells(firstCol, lastCol)` mirrors `reconcileColumnCells` ([`Header.ts:485-608`](../packages/lib/src/typescript/lib/component/table/Header.ts#L485)) — the same three passes over the same window, tracked by its own `_filterCellsDirty` flag and its own `_filterWindowFirst` offset — with two differences. When `hasFilterRow()` is `false` it disposes every cell and returns, as `rebuildParentCells` does at [`Header.ts:626-630`](../packages/lib/src/typescript/lib/component/table/Header.ts#L626). Its pass 2 builds `new FilterCell(field.getName(), operators)` — `operators` computed as below — and its pass 3 applies filter state rather than sort/label state:

```typescript
// A column that is not filterable still gets a cell, so the row stays column-aligned;
// an empty operator list is what renders that cell blank.
const operators = column?.isFilterable()
    ? columnFilterOperators(field.getType())
    : [];

cell.setFieldName(field.getName());
cell.setColumnLabel(column?.getHeaderText() ?? field.getName());
cell.setOperators(operators);
cell.getAria().setColIndex(col + 1);

if (operators.length > 0) {
    cell.setFilterState(this.filterState().get(field.getName())
        ?? { operator: operators[0], text: '' });
}
```

Wiring happens once per cell at creation, mirroring `wireCell` ([`Header.ts:703-708`](../packages/lib/src/typescript/lib/component/table/Header.ts#L703)):

```typescript
cell.on("filterchange", (fieldName, state, immediate) => this.onFilterCellChange(fieldName, state, immediate));
```

### Header band arithmetic

`layout/Table.doLayout` gains a third band, computed the same way as the parent row ([`layout/Table.ts:158-169`](../packages/lib/src/typescript/lib/layout/Table.ts#L158)):

```typescript
// 3 px top + bottom padding on the filter input plus its 1 px top + bottom border.
const FILTER_ROW_CHROME_PX = 8;

const filterRowHeight  = header.hasFilterRow() ? columnHeight + FILTER_ROW_CHROME_PX : 0;
const headerBandHeight = parentRowHeight + columnHeight + filterRowHeight
                       + headerPerimeter.top + headerPerimeter.bottom;
```

The filter row is positioned after the column row, at `headerBox.y + parentRowHeight + columnHeight`, with `innerRowW` width, and `filterRowHeight` is passed through in the `HeaderColumnGeometry` bag.

---

## Ordered Implementation Steps

1. **`data/FilterDescriptor.ts`** — add `{ type: 'endsWith'; field: string; value: string; caseSensitive?: boolean }` to the union ([`FilterDescriptor.ts:10-22`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L10)) and its `matchesFilter` case immediately after the `startsWith` case, using `haystack.lastIndexOf(needle) === haystack.length - needle.length` (with the same `raw == null → false` guard and the same `caseSensitive` lowering).
2. **`data/FilterDescriptor.ts`** — in the `eq` and `neq` cases ([`FilterDescriptor.ts:43-47`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L43)), read the field once and, when both it and `descriptor.value` are `Date` instances, compare `getTime()`; otherwise keep the existing `===` / `!==`. Extend the module doc comment with one sentence stating that rule.
3. **`data/AbstractStore.ts`** — change `_activeFilters` to `Map<string | symbol, FilterDescriptor>` ([`AbstractStore.ts:176`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L176)) and update every read/write site listed in the `## Internal Structure` table. Verify: `grep -n "_activeFilters" packages/lib/src/typescript/lib/data/AbstractStore.ts` — every match must be a `Map` operation.
4. **`data/AbstractStore.ts`** — add `setFilter` and `getFilter` in the `── Filter ──` section, after `filterBy` ([`AbstractStore.ts:1517`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1517)), with JSDoc describing the keyed replace, the `null`-removes contract, and that reload behaviour is identical to `filterBy`'s (`remoteFilter` / pagination).
5. **`component/table/ColumnFilter.ts`** — new pure module holding `ColumnFilterOperator`, `ColumnFilterState`, `columnFilterOperators`, `columnFilterOperatorLabel`, `columnFilterOperatorSymbol`, `columnFilterTakesOperand`, and `buildColumnFilter`, per the tables in `## Internal Structure`. No DOM, no store, no component imports.
6. **`component/table/ColumnConfig.ts`** — add `filterable ?: boolean` to `ColumnConfig` (next to `readOnly`, [`ColumnConfig.ts:115`](../packages/lib/src/typescript/lib/component/table/ColumnConfig.ts#L115)) and to `ColumnSpec` (next to `autoSizeColumns`, [`ColumnConfig.ts:320`](../packages/lib/src/typescript/lib/component/table/ColumnConfig.ts#L320)), each with JSDoc stating the resolution rule.
7. **`component/table/Column.ts`** — add a third optional constructor parameter `specFilterable?: boolean`, a `_filterable` field resolved per the `## Internal Structure` table, and `isFilterable()`; pass `spec?.filterable` at all three `new Column(...)` sites inside `Column.resolve` ([`Column.ts:232,241,246`](../packages/lib/src/typescript/lib/component/table/Column.ts#L232)).
8. **`component/table/cell/renderer/Filter.ts`** — new `FilterCellRenderer extends CellRenderer<string | null>`. In the constructor: `setLayoutManager(new HBox({ spacing: 2, itemAlign: "stretch", mode: "preferred" }))`; build the `TextField` and add it with `{ weight: 1 }`; build the `MenuButton` and add it with `setPreferredSize({ width: FILTER_OPERATOR_WIDTH_PX, height: 0 })` — module constant `22`, documented as "two operator glyphs plus the button's horizontal padding"; the preferred height is unused because `itemAlign: "stretch"` sizes the cross axis from the row. `getValue` / `setValue` proxy the text field's value; expose `getInput()` and `getOperatorButton()`.
9. **`component/table/cell/Filter.ts`** — new `FilterCell extends Cell<string | null>`, constructed as `super("th", new FilterCellRenderer())`. Follow `HeaderCell`'s shape for the widened `on` / `off` / `emit` overloads over `FilterCellEvent`. In the constructor: `getAria().setRole("columnheader")`, `setBackgroundColor("transparent")` so the header band's gradient shows through (as `ParentHeaderCell` does at [`ParentHeader.ts:66`](../packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L66)), then `setOperators(operators)` and — when `operators` is non-empty — `setFilterState({ operator: operators[0], text: '' })` for the initial face, and wire the two children through their own typed surfaces:
   - `renderer.getInput().on("change", …)` → emit `"filterchange"` with `immediate: false`.
   - `renderer.getInput().on("keydown", …)` → Enter emits with `immediate: true`; Escape clears the text and emits with `immediate: true`.
   - `renderer.getOperatorButton().setMenuItems(() => …)` — the provider form, so the checkmark tracks the current operator. Each item's `action` calls the private `selectOperator(op)`. Prefix the selected operator's label with `'✓ '` and the others with `'  '`, mirroring the column context menu ([`Table.ts:1296`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1296)).
   - `selectOperator(op)` writes the button face via `setText(columnFilterOperatorSymbol(op))`, enables/disables the text input according to `columnFilterTakesOperand(op)` (clearing its text when disabled), calls `this.doLayout()`, then emits `"filterchange"` with `immediate: true`.
   - `setFilterState(state)` performs the same writes **without** emitting.
   - `setColumnLabel(label)` writes the text input's accessible name — `renderer.getInput().getAria().setLabel("Filter " + label)`. No placeholder is set; a placeholder repeated across every column reads as clutter.
   - `setOperators([])` hides both controls (`setDisplayed(false)` on each) and leaves the cell blank; a non-empty array shows them again.

   Both new classes are exported through `callable()` with the underscored-alias idiom, matching [`StringRenderer`](../packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts) and `HeaderCell`.
10. **`component/table/CellGeometry.ts`** — add `FilterCell.selectOperator` / `setFilterState` to the list of framework writers that move a cell's layout without changing its geometry ([`CellGeometry.ts:32-43`](../packages/lib/src/typescript/lib/component/table/CellGeometry.ts#L32)), alongside `HeaderCell.setHeaderGlyph`.
11. **`component/table/Header.ts`** — add the third `Row` in the constructor after the column row ([`Header.ts:116-119`](../packages/lib/src/typescript/lib/component/table/Header.ts#L116)), plus a `private _filterRowVisible: boolean = false` field, `getFilterRow()`, and `hasFilterRow()` next to `getParentRow()` / `hasParentRow()` ([`Header.ts:325-342`](../packages/lib/src/typescript/lib/component/table/Header.ts#L325)) — `hasFilterRow()` returns `this._filterRowVisible && …` ANDed with the existing "at least one visible column is filterable" test, per `## Internal Structure`.
12. **`component/table/Header.ts`** — add the remaining state fields, `setFilterRowVisible(visible): this` (guard on no-op, else set `_filterRowVisible` and `_filterCellsDirty = true`), `filterState()`, `onFilterCellChange`, `applyPendingFilter`, and `onStoreFilterChange` per `## Internal Structure`. Register `onStoreFilterChange` on the store in the constructor and re-register it in `setStore` ([`Header.ts:154-158`](../packages/lib/src/typescript/lib/component/table/Header.ts#L154)) — `off` the old store first. Set `_filterCellsDirty = true` inside `rebuildCells()` ([`Header.ts:438-443`](../packages/lib/src/typescript/lib/component/table/Header.ts#L438)).
13. **`component/table/Table.ts`** — add `private _filterRowVisible: boolean = false` next to `_headerVisible` ([`Table.ts:156`](../packages/lib/src/typescript/lib/component/table/Table.ts#L156)), `isFilterRowVisible()` next to `isHeaderVisible()` ([`Table.ts:667-669`](../packages/lib/src/typescript/lib/component/table/Table.ts#L667)), and `setFilterRowVisible(visible): this` (guard on no-op, else set the field, call `this._header.setFilterRowVisible(visible)`, then `this.doLayout()`) next to `setExportMenuEnabled` ([`Table.ts:1326-1330`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1326)). In `showColumnMenu` ([`Table.ts:1242-1318`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1242)), after the `'Reset columns'` push and before the `_exportMenuEnabled` block, add the `Filter` menu-item block from `## Internal Structure`, gated on `this._resolvedColumns.some(c => c.isFilterable())`.
14. **`component/table/Header.ts`** — add `reconcileFilterCells(firstCol, lastCol)`, `wireFilterCell(cell)`, and `positionFilterCells(win, filterRowHeight)` (the latter mirroring `positionParentCells`, [`Header.ts:850-863`](../packages/lib/src/typescript/lib/component/table/Header.ts#L850)). Call the reconcile and the position pass from `renderColumnWindow` ([`Header.ts:802-821`](../packages/lib/src/typescript/lib/component/table/Header.ts#L802)) after the existing parent-row call, and add `filterRowHeight` to `HeaderColumnGeometry` ([`Header.ts:44-53`](../packages/lib/src/typescript/lib/component/table/Header.ts#L44)) and to the `_geometry` initializer ([`Header.ts:92`](../packages/lib/src/typescript/lib/component/table/Header.ts#L92)).
15. **`component/table/Header.ts`** — translate the filter row in `setScrollX` alongside the other two rows ([`Header.ts:884-885`](../packages/lib/src/typescript/lib/component/table/Header.ts#L884)), and add a `destructor()` that clears `_filterTimer` and `off`s the store listener before calling `super.destructor()`.
16. **`layout/Table.ts`** — add the `FILTER_ROW_CHROME_PX` constant, the `filterRowHeight` term in `headerBandHeight`, the filter-row placement block after the column row ([`layout/Table.ts:211-217`](../packages/lib/src/typescript/lib/layout/Table.ts#L211)), and `filterRowHeight` in the `renderColumnWindow` argument ([`layout/Table.ts:223-228`](../packages/lib/src/typescript/lib/layout/Table.ts#L223)).
17. **`component/table/index.ts`** — export `FilterCell` + `FilterCellEvent`, `FilterCellRenderer`, and everything `ColumnFilter.ts` exports, in the positions matching the existing grouping.
18. Regression check: `grep -rn "getComponents()\[1\]\|getComponents()\[0\]" packages/lib/src/typescript/lib/component/table/Header.ts` — every match must still refer to the column row (index 1) or the parent row (index 0); appending the filter row at index 2 must not have shifted either.
19. **Tests** — add the four test files listed in `## Files to Create / Modify / Delete`, covering `## Expected Behaviour`.
20. **Docs** — apply the edits in `## Documentation Impact`.
21. Run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run docs:api` from `packages/lib`.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/data/FilterDescriptor.ts` |
| Modify | `packages/lib/src/typescript/lib/data/AbstractStore.ts` |
| Create | `packages/lib/src/typescript/lib/component/table/ColumnFilter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/ColumnConfig.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Column.ts` |
| Create | `packages/lib/src/typescript/lib/component/table/cell/renderer/Filter.ts` |
| Create | `packages/lib/src/typescript/lib/component/table/cell/Filter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/CellGeometry.ts` (doc comment only) |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/index.ts` |
| Modify | `packages/lib/tests/unit/data/FilterDescriptor.test.ts` |
| Create | `packages/lib/tests/unit/data/AbstractStore.filters.test.ts` |
| Create | `packages/lib/tests/component/table/ColumnFilter.test.ts` |
| Create | `packages/lib/tests/component/table/ColumnFilterRow.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/components/TreeTable.md` |
| Modify | `packages/lib/docs/data/store.md` |

---

## Expected Behaviour

### Descriptor algebra (unit-testable, `FilterDescriptor.test.ts`)

1. `{ type: 'endsWith', field: 'name', value: 'ob' }` matches `{ name: 'Bob' }` and `{ name: 'BOB' }`, and does not match `{ name: 'Bobby' }`.
2. `{ type: 'endsWith', …, caseSensitive: true }` matches `{ name: 'Bob' }` but not `{ name: 'BOB' }`.
3. `endsWith` against a `null` field value returns `false`, never throws.
4. `{ type: 'eq', field: 'due', value: new Date('2024-01-15') }` matches a record whose `due` is a **different `Date` instance** for the same instant, and does not match one for a different instant.
5. `neq` is the exact inverse of case 4 for the same inputs.
6. `eq` on non-`Date` operands is unchanged: `{ id: 1 }` matches `value: 1` and not `value: '1'`.

### Keyed store filters (unit-testable, `AbstractStore.filters.test.ts`)

7. `setFilter('age', { type: 'gt', field: 'age', value: 20 })` then `setFilter('age', { type: 'gt', field: 'age', value: 30 })` leaves `getActiveFilters()` with exactly one descriptor, the second one.
8. With `setFilter('age', …)` and `setFilter('name', …)` both active, `setFilter('age', null)` removes only the `age` descriptor; `getFilter('name')` still returns its descriptor and the view still honours it.
9. `filterBy(d)` followed by `setFilter('age', d2)` yields `getActiveFilters()` of length 2, in that order; `setFilter('age', d3)` still yields length 2 and does not disturb `d`.
10. `clearFilter()` removes both keyed and anonymous descriptors; `getFilter('age')` returns `null` afterwards.
11. `new Store(model, { filters: [d] })` still surfaces `[d]` from `getActiveFilters()` — the existing `Store.test.ts` case must keep passing unchanged.
12. `setFilter` fires `'filterchange'` and `'datachange'` and rebuilds the view, exactly as `filterBy` does.
13. With `remoteFilter: true` and a recording proxy, `setFilter('age', d)` triggers a `read()` whose `ReadParams.filters` contains `d`, and resets `page` to 1.
14. With `remoteFilter` unset and no pagination, `setFilter` triggers no `read()` and the local view shrinks to the matching records.
15. Over the worker threshold, a store with two keyed filters composes them into one `{ type: 'and', filters: [...] }` request (assert through the existing `AbstractStore.workerView.test.ts` harness style).

### Operator mapping (unit-testable, `ColumnFilter.test.ts`)

16. Every row of the `buildColumnFilter` table in `## Internal Structure` is a case: the produced descriptor (or `null`) matches exactly.
17. `columnFilterOperators('string')[0] === 'contains'`; `columnFilterOperators('number')[0] === 'eq'`; `columnFilterOperators('boolean')` contains no ordering operator.
18. `columnFilterTakesOperand('isEmpty') === false`; `true` for every other operator.
19. `buildColumnFilter` with `isEmpty` ignores the text entirely — the same descriptor is produced for `''` and for `'anything'`.

### Filter row (unit-testable offline, `ColumnFilterRow.test.ts`, using `installTestDOM` as `HeaderColumnWindow.test.ts` does)

20. A table with `{ field: 'name', filterable: true }`, filter row left at its default: `table.isFilterRowVisible()` is `false`, `header.hasFilterRow()` is `false`, `header.getFilterRow().getComponents()` is empty, and the header band's height is unchanged from today — even though `name` is filterable.
21. `table.setFilterRowVisible(true)` on that table: `table.isFilterRowVisible()` is `true`, `header.hasFilterRow()` is `true`, and the filter row renders one `FilterCell` per column in the current window — including cells for the non-filterable columns, so the row's cells stay column-aligned. `table.setFilterRowVisible(false)` afterwards returns to case 20's state (`hasFilterRow()` false, zero cells).
22. `table.setFilterRowVisible(true)` on a table whose spec declares no `filterable` anywhere: `header.hasFilterRow()` stays `false` and the filter row stays empty — the toggle alone does not create a row with nothing to show.
23. `ColumnSpec.filterable: true` with `{ field: 'id', filterable: false }` on one column, filter row toggled on: `hasFilterRow()` is `true` and `id`'s cell renders no input controls.

Cases 24 onward assume the filter row has already been toggled on with `table.setFilterRowVisible(true)`:

24. Typing `ali` into the `name` cell and flushing the debounce calls `store.setFilter('name', { type: 'contains', field: 'name', value: 'ali' })`; `body.getVisibleRecords()` then holds only the matching records.
25. Typing `ali` then `alic` produces exactly one active descriptor for `name`, not two.
26. Clearing the `name` input removes the `name` descriptor and leaves an active `age` descriptor untouched.
27. Picking a different operator applies immediately (no debounce wait) and replaces the same key's descriptor.
28. Selecting `isEmpty` disables the text input and still applies a filter; selecting `contains` afterwards re-enables it.
29. Scrolling the header horizontally so a filtered column leaves and re-enters the window: the re-entering cell shows the same operator and text (state comes from the header's map, not the recycled cell).
30. A filter cell recycled onto a column of a different field type is re-offered that type's operators, and falls back to `operators[0]` when the previous operator is not in the new list.
31. `store.clearFilter()` called programmatically blanks the rendered filter inputs on the next render pass.
32. `table.setDisplayMode("rotated")` collapses the filter row (`hasFilterRow()` is `false`, zero cells) regardless of the toggle — the rotated projection declares no `filterable` column — and leaves the source store's descriptors in place; returning to `"normal"` restores the row, still toggled on, with its previous operator and text.
33. `table.setColumnVisible('name', false)` while `name` is filtered leaves `store.getFilter('name')` non-null.
34. After typing into a filter cell and immediately calling `table.dispose()`, no store write lands when the debounce interval elapses, and a later `store.setFilter(…)` neither throws nor touches the disposed header.

### Filter menu toggle (unit-testable, `ColumnFilterRow.test.ts`, reaching into `Table`'s private state the way `RotatedView.test.ts` and `ColumnWidths.test.ts` already do)

35. A table with `{ field: 'name', filterable: true }`: replacing `(table as any)._columnContextMenu.show` with a capturing stub and calling `(table as any).showColumnMenu(0, 0)` yields an item list containing a `'  Filter'` entry (unchecked) positioned after `'Reset columns'`.
36. A table with no `filterable` column anywhere: the same captured item list contains no entry whose text ends in `Filter`.
37. Invoking the captured `Filter` item's `action()` once sets `table.isFilterRowVisible()` to `true`; a second `showColumnMenu` capture shows the entry's text as `'✓ Filter'`. Invoking `action()` again returns `isFilterRowVisible()` to `false` and the text to `'  Filter'`.

### Manual verification

38. In the docs/demo app, after checking `Filter` from the header's right-click menu on a wide table: typing filters the rows as you type, the operator menu opens under its button and is not clipped by the header's `overflow: hidden`, and the filter inputs scroll horizontally in step with the header cells and the body.
39. Right-clicking inside a filter input shows the browser's native context menu (paste), not the column-visibility menu.
40. On a `TreeTable` with a filterable column, after toggling the filter row on, filtering a parent out removes its subtree and re-roots its orphaned children, matching the behaviour already documented in `TreeTable.md`'s Filtering section.
41. Right-clicking the header shows the checkbox-style `Filter` entry; clicking it shows the filter row, and the entry now reads `'✓ Filter'` on reopen. Clicking it again hides the row and the entry reverts to unchecked.

---

## Verification

From `packages/lib`:

- `npm run typecheck` — zero errors. The `_activeFilters` shape change and the new `HeaderColumnGeometry` member are the two places a missed call site surfaces.
- `npm run lint` — zero errors; in particular the `local/no-raw-dom` and `local/require-content-bounds` rules over the new files and `layout/Table.ts`.
- `npm run test` — the four new/edited test files plus the full existing suite, which must pass unchanged. `Store.test.ts`, `AbstractStore.sync.test.ts`, `AbstractStore.grouping.test.ts`, `AbstractStore.workerView.test.ts`, and `FilterDescriptor.test.ts` are the regression guards for the data-layer change; `HeaderColumnWindow.test.ts`, `ColumnWidths.test.ts`, and `RotatedView.test.ts` for the header change.
- `npm run docs:api` — zero warnings. New JSDoc must not `{@link}` any `private` / `protected` / `@internal` symbol (see `CODE_CONVENTIONS.md`).
- `grep -n "_activeFilters" packages/lib/src/typescript/lib/data/AbstractStore.ts` — every match is a `Map` operation (`.set` / `.get` / `.delete` / `.clear` / `.size` / `.values()`); no `.push`, `.length`, or array assignment survives.
- `grep -rn "filterRowHeight" packages/lib/src/typescript/lib/component/table/Header.ts packages/lib/src/typescript/lib/layout/Table.ts` — present in both, matching the shared `HeaderColumnGeometry` member name.
- Manual: run the docs app (`npm run docs:dev`, port 5173) and exercise cases 38-41 on a `Table` demo with `filterable: true`.

---

## Documentation Impact

- `packages/lib/docs/components/Table.md`
  - Add `filterable` to the `ColumnConfig` field table ([`Table.md:48-66`](../packages/lib/docs/components/Table.md#L48)), and a sentence about `ColumnSpec.filterable` beside the existing `appendUnlisted` note ([`Table.md:68`](../packages/lib/docs/components/Table.md#L68)).
  - Add a `## Column filters` section after `## Parent headers` ([`Table.md:182-204`](../packages/lib/docs/components/Table.md#L182)) with: a sentence that the row is opt-in — hidden by default even when columns are `filterable`, shown by right-clicking the header and checking **Filter**, or programmatically via `table.setFilterRowVisible(true)`; a spec example; the per-type operator table; the note that substring operators are case-insensitive while `equals` is exact; the note that `equals` on a temporal column matches the exact instant, so a whole-day match is `≥` plus a second filter or a wider range; the note that local-vs-remote follows the store's `remoteFilter`, and that a paginated store should set `remoteFilter: true` or a page will come back unfiltered and then shrink locally; and the note that hiding a column leaves its filter active.
  - Add a bullet to `## Rotated record view` ([`Table.md:179-180`](../packages/lib/docs/components/Table.md#L179)) next to the `setColumnVisible` and `setRowVisible` bullets: the filter row is absent while rotated, the source store's filters stay applied, and the row returns — with its toggle state and its previous operator/text — on un-rotating.
- `packages/lib/docs/components/TreeTable.md` — extend `## Filtering` ([`TreeTable.md:132-134`](../packages/lib/docs/components/TreeTable.md#L132)) with one sentence saying `TreeTable` supports column filters through the same store mechanism (unlike `setRowVisible`, which is listed as a non-goal), and that the subtree/orphan rules described there are exactly what a column filter produces.
- `packages/lib/docs/data/store.md` — in `## Sort and filter` ([`store.md:110-120`](../packages/lib/docs/data/store.md#L110)), add `setFilter(key, descriptor)` / `getFilter(key)` to the code block and amend the "calls **stack**" sentence to say that `setFilter` replaces by key instead of stacking, and that `clearFilter()` removes both kinds.
- `packages/lib/src/typescript/lib/component/table/index.ts` is the barrel for `FilterCell`, `FilterCellRenderer`, and the `ColumnFilter` exports; `FilterDescriptor` is already exported from `data/index.ts` and its new union member needs no barrel change.
- No `llms.txt` edit: the file is generated from `scripts/llms/manifest.data.mjs` and this adds no new top-level capability entry.
- No changelog entry or version bump — handled separately at release time, matching `plans/implemented/table-row-visibility.md`.

---

## Potential Challenges

- **A pending keystroke outliving its cell.** A horizontal scroll can recycle a filter cell onto another column while a debounced write is queued. *Mitigation:* the timer and the pending field name live on `TableHeader`, never on the cell, so the write still lands on the right column.
- **The geometry cache skipping a re-layout after an operator change.** `CellGeometryCache.apply` skips both the write and the `doLayout` when a cell's x/width/height are unchanged ([`CellGeometry.ts:78-112`](../packages/lib/src/typescript/lib/component/table/CellGeometry.ts#L78)), and an operator change moves layout without moving geometry. *Mitigation:* `selectOperator` and `setFilterState` call `this.doLayout()` themselves, as `HeaderCell.setHeaderGlyph` does, and the cache's documented writer list is extended to say so.
- **Very narrow columns.** A column at the `MIN_COLUMN_WIDTH_PX` floor of 30 px leaves only a few pixels beside the 22 px operator button. *Mitigation:* none needed — the `HBox` shrinks the input toward its minimum and `Row`'s `overflow: hidden` clips the remainder; widening the floor for filterable columns is a non-goal.
- **A remote reload's local pre-filter.** With `remoteFilter: true`, `applyFilterChange` applies the filters locally to the already-loaded page before the reload lands, so rows briefly disappear and then are replaced by the server's page 1. *Mitigation:* none — this is `filter()` / `filterBy()`'s existing behaviour, inherited unchanged, and every descriptor the filter row builds evaluates identically on both sides.
- **Pagination without `remoteFilter`.** A filter change reloads the page, the proxy receives only `{ page, pageSize }`, and the local pass then hides part of the returned page, so the user sees fewer than `pageSize` rows. *Mitigation:* pre-existing and already described in `filter()`'s JSDoc; the docs section tells consumers to set `remoteFilter: true` alongside `pageSize`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Header.ts`](../packages/lib/src/typescript/lib/component/table/Header.ts) — the parent-row precedent this plan mirrors (`hasParentRow`, `rebuildParentCells`, `positionParentCells`), plus `reconcileColumnCells`'s three-pass algorithm, `wireCell`, and `syncSortIndicators`.
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts) — `showColumnMenu` (the context menu the `Filter` entry joins), `setExportMenuEnabled` (the public-setter-plus-gated-menu-entry shape `setFilterRowVisible` mirrors), and `_headerVisible` / `isHeaderVisible()` (the private-field-plus-getter shape).
- [`packages/lib/src/typescript/lib/data/AbstractStore.ts`](../packages/lib/src/typescript/lib/data/AbstractStore.ts) — `_activeFilters` and every consumer: `applyOptions`, `buildReadParams`, `getActiveFilters`, `filter` / `filterBy` / `clearFilter`, `applyFilterChange`, `applyView`, `applyViewOnWorker`.
- [`packages/lib/src/typescript/lib/data/FilterDescriptor.ts`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts) — the union and the shared evaluator both threads run.
- [`packages/lib/src/typescript/lib/component/table/cell/Header.ts`](../packages/lib/src/typescript/lib/component/table/cell/Header.ts) — the widened `on` / `off` / `emit` overload shape, the self-`doLayout` setter (`setHeaderGlyph`), and the destructor pattern `FilterCell` follows.
- [`packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts`](../packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts) — a non-editing `Cell` subclass in the header band, including the transparent-background write.
- [`packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts`](../packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts) — the base a renderer with children extends; its `doLayout` returns early unless there is exactly one `Text` child, so an `HBox` with two children is safe.
- [`packages/lib/src/typescript/lib/component/table/cell/editor/Combo.ts`](../packages/lib/src/typescript/lib/component/table/cell/editor/Combo.ts) — the precedent for a fixed option list inside a table cell.
- [`packages/lib/src/typescript/lib/layout/Table.ts`](../packages/lib/src/typescript/lib/layout/Table.ts) — the header band arithmetic the filter row's height joins.
- [`packages/lib/src/typescript/lib/component/table/CellGeometry.ts`](../packages/lib/src/typescript/lib/component/table/CellGeometry.ts) — the geometry-diff skip and its list of writers that must lay themselves out.
- [`packages/lib/src/typescript/lib/component/button/MenuButton.ts`](../packages/lib/src/typescript/lib/component/button/MenuButton.ts) — the operator picker; its `menuItems` provider form re-resolves on every open.
- [`packages/lib/tests/component/table/HeaderColumnWindow.test.ts`](../packages/lib/tests/component/table/HeaderColumnWindow.test.ts) — the offline harness and helper style `ColumnFilterRow.test.ts` mirrors.
- [`plans/implemented/table-row-visibility.md`](implemented/table-row-visibility.md) — the display-only filter this feature deliberately does not extend, and the source of the rotated-mode and `TreeTable` documentation conventions.
- [`plans/implemented/table-parent-headers.md`](implemented/table-parent-headers.md) — the optional-extra-header-row precedent.

---

## Non-Goals

- **A second local/remote switch on the filter row.** Where a filter is evaluated is the store's decision through `remoteFilter`; adding a UI toggle would let the two disagree.
- **More than one condition per column.** One operator and one value per column. A column needing `between` uses two programmatic `setFilter` keys, or `filterBy` with an `and` descriptor.
- **A filter row in rotated mode.** The projection's rows are one per source *field* of a single record, so a per-column predicate over source records has nothing to filter — the same reasoning that neutralizes `setColumnVisible` and `setRowVisible` there.
- **A `Table`-level programmatic API for filter values** (`table.setColumnFilter(...)`). `store.setFilter(field, descriptor)` is the programmatic surface for what a column filters on, and the filter row re-syncs to it through the store's `'filterchange'` event; `Table.setFilterRowVisible` only shows or hides the row, it does not set filter values.
- **Case-insensitive `equals`.** `eq` / `neq` stay strict, matching the algebra's existing tested contract; only the substring operators are case-insensitive.
- **Day-granularity temporal equality.** `equals` on a temporal column compares the exact instant; a whole-day match is expressed with the ordering operators.
- **Changing `filter()` / `filterBy()` stacking.** Those keep appending an anonymous descriptor each call, and `clearFilter()` keeps removing everything.
- **A configurable debounce delay.** The 200 ms constant is fixed; no option is added.
- **Widening the minimum column width for filterable columns.** A narrow column clips its filter input.
- **A keyboard shortcut to toggle the filter row.** The header context menu's `Filter` entry and `Table.setFilterRowVisible` are the only entry points.
- **Per-column show/hide of the filter row itself.** The toggle is table-wide; a column opts into having a filter cell via `filterable`, but cannot independently hide its own cell once the row is shown.
- **A changelog entry or version bump.** Handled separately at release time.

---

## Notes

[^not-row-visible]: `Table.setRowVisible` was deliberately built as a display-only predicate that never touches the store's view and never triggers a network round trip — see its plan's `[^why-not-store-filter]` footnote in [`plans/implemented/table-row-visibility.md`](implemented/table-row-visibility.md). That constraint exists because a quick-search box must not reload on every keystroke over an already-loaded grid. A per-column filter has the opposite requirement: it is a query refinement that should reach a remote data source when the store is configured for one. Building it on `setRowVisible` would also make it invisible to `getRecords()`, to the store's aggregates, and to CSV/JSON export, all of which read the store's filtered view.

[^mirror-parent-row]: The parent-header row is the closest existing analogue for the **Row shape**: an optional extra header row, laid out by the same `layout/Table.doLayout` pass, collapsing to zero height when unused so a table that never turns it on stays byte-identical at runtime. The analogy stops at *when* it shows. The parent row auto-shows from column configuration alone — declaring a `group` is a data fact about the column, not a request for new interactive UI. A filter row is different: it adds a text input and an operator button to every column's header cell, and a table that ships with `filterable` columns should not sprout that chrome unasked. `Table` therefore gates the row behind an explicit `_filterRowVisible` toggle defaulting to `false`. `hasFilterRow()` still borrows the parent row's "at least one visible column qualifies" test, but ANDs it with that toggle. Reusing the Row shape still means no explicit rotated-mode branch: the rotated projection's spec declares no `filterable` ([`Table.ts:1058-1072`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1058)), so `hasFilterRow()` returns `false` there regardless of the toggle, for the same reason `hasParentRow()` does.

[^filter-toggle-setter]: `_headerVisible` / `_bodyVisible` / `_footerVisible` are fixed at construction and never change at runtime, so a getter is all they need. `_filterRowVisible` does change at runtime — from the context menu — and exposing a public setter alongside it, mirroring `setExportMenuEnabled` ([`Table.ts:1326-1330`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1326)), serves three needs a menu-only toggle would not: the menu's own `action` callback needs a method to call rather than reaching into a private field from outside the class; a caller that always wants filters on (a "filters visible by default" preset) can set it once instead of dispatching a synthetic right-click; and `ColumnFilterRow.test.ts` can drive the visible/hidden transition directly, matching how `ColumnWidths.test.ts` and `RotatedView.test.ts` already exercise `Table` through its public setters rather than through simulated DOM events.

[^filter-menu-gate]: Mirrors `_exportMenuEnabled` gating the export entries two blocks below it ([`Table.ts:1309`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1309)): a menu entry for a row that can never have anything in it is worse than no entry. The gate reads `_resolvedColumns` — every resolved column, hidden or not — rather than only the currently-visible ones, matching the column-visibility loop just above it in the same menu, which also lists hidden columns. A column hidden today can be unhidden later without leaving the header screen, and the `Filter` entry should not flicker in and out of the menu as that happens.

[^renderer-hosts-controls]: Three alternatives were rejected. Making the filter cell a plain `Component` would require widening `Row.addComponent` (or adding a parallel row class), touching working code for no gain. Side-loading the input and the button onto a `DefaultCell` with raw `appendChild`, as `HeaderCell` does for its resize handle, works for a bare `<div>` but not for a `TextField` and a `Button`, which need real sizes from a layout manager rather than a CSS class rule. Extending `Cell` and replacing its `Card` layout would leave the base-supplied renderer as an unused child. Putting both controls in the renderer keeps every existing seam: the `Card` shows one child, `Fit`-equivalent sizing comes from the `HBox`, and `Cell`'s editor machinery stays inert because `getEditorKey()` returns `null` and no editor is passed, so the inherited double-click `startEdit` returns immediately ([`Cell.ts:389-410`](../packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L389)). `BooleanCell` already proves that an interactive control can occupy a cell's renderer slot.

[^per-store-state]: Entering rotated mode calls `bindView`, which re-points the header at the projection `MemoryStore`; leaving it re-points the header back at the source store ([`Table.ts:393-414`](../packages/lib/src/typescript/lib/component/table/Table.ts#L393)). A single flat map on the header would have to be cleared on every `setStore` to avoid showing one store's filter text over another's columns, which would silently blank the filter row on a rotate round trip even though the source store's descriptors are still applied. Keying the map by store instance removes the clearing question entirely, and a `WeakMap` lets a discarded store's entry be collected with it.

[^remote-composes]: Checked end to end against the current code. `applyFilterChange` computes `reload = this._remoteFilter || this._pageSize != null`, resets the page, awaits `applyView()`, emits `'filterchange'` + `'datachange'`, then fires `load()` ([`AbstractStore.ts:1526-1542`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1526)). `buildReadParams` copies `getActiveFilters()` into `ReadParams.filters` when `remoteFilter` is on ([`AbstractStore.ts:388-390`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L388)). `applyView` applies every active descriptor in process below the worker threshold ([`AbstractStore.ts:1834-1836`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1834)), and above it `applyViewOnWorker` folds them into one `and` and ships it to `StoreWorker`, which evaluates them with the same `matchesFilter` module ([`StoreWorker.ts:67`](../packages/lib/src/typescript/lib/data/StoreWorker.ts#L67)) — so `endsWith` lands on both sides from one edit. The worker snapshot is keyed on `allRecords` changing, which a filter change does not do, so no re-ship happens. Two rough edges exist and are pre-existing rather than introduced here; both are listed under `## Potential Challenges`.

[^debounce-on-header]: `AutoCompleteField` sets the precedent for debouncing keystrokes before a store call, with a 200 ms default ([`AutoCompleteField.ts:456-478`](../packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L456)). Without it, a store with `remoteFilter: true` would issue one HTTP read per character. The timer cannot live on the filter cell because header cells are recycled across the horizontally-visible column window: a cell that owned a pending write could be retargeted at another column before the timer fired, and the write would land on the wrong field. Holding the field name on the header makes the pending write independent of which cell is currently showing that column.

[^date-equality]: `matchesFilter`'s `eq` case is `readField(record, descriptor.field) === descriptor.value` ([`FilterDescriptor.ts:43-44`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L43)). `Field.convertByType` turns every `date` / `time` / `datetime` value into a `Date` instance ([`Field.ts:190-199`](../packages/lib/src/typescript/lib/data/Field.ts#L190)), and two distinct `Date` objects are never `===`, so an equality filter on a temporal column currently cannot match anything — a latent defect, not just a gap for this feature. The ordering operators are unaffected because `>` / `<` coerce through `valueOf`. Two alternatives were rejected: dropping `equals` from the temporal operator set (a common thing to want, and the ordering operators cannot express it in one row), and building temporal equality as `and(gte, lte)` over the same instant (works, but makes `getFilter(field)` return something no consumer can read back as an equality, and pushes a data-layer quirk into the UI layer). The three-line `Date`-aware branch fixes it once, in the module both threads share.

[^symbol-keys]: The anonymous descriptors that `filter()` / `filterBy()` / the `filters` option append have no natural key, and any generated string key (`"anon:0"`, `"@0"`) is in principle collidable with a field name a consumer might pass to `setFilter`. A `Symbol()` cannot collide with any string, needs no reserved-prefix documentation, and preserves insertion order in a `Map` exactly like a string key — so `getActiveFilters()` keeps returning descriptors in the order they were added, which is what the existing `Store.test.ts` assertion depends on. A `Map` also re-uses an existing key's original insertion position on overwrite, so re-typing in one column never reorders the active filter list.

[^store-resync]: Without this, `store.clearFilter()` called from application code would leave the filter row showing stale text over unfiltered data. The re-sync deliberately only *drops* cached entries, never reconstructs text from a descriptor: the descriptor for a temporal column holds a `Date`, and formatting it back would rewrite what the user typed (`2024-01-15` becoming an ISO timestamp) on the next reconcile. Two guards keep it from firing spuriously — a cached state whose `buildColumnFilter` result is `null` (a blank input) is already consistent with the store holding no filter, and the field with a debounced write in flight is skipped because its descriptor has not been written yet.

---

## Implementation Notes

- **`onFilterCellChange`'s "unchanged state" guard is narrowed to the non-immediate path.** The `## Internal Structure` pseudocode returns early whenever the incoming state equals the cached state, with no `immediate` exception. Implemented literally, that guard breaks the Public API's own stated contract for Enter/Escape ("Enter emits with `immediate: true`", i.e. applies without waiting for the debounce): typing schedules a debounced write and caches the just-typed state; pressing Enter immediately afterward reports that *same* state, so the literal guard treats it as a no-op repeat keystroke and the write still waits out the full 200 ms timer — silently defeating the reason Enter/Escape bypass the debounce in the first place. The shipped guard skips only when the call is *not* `immediate`, so a repeat non-immediate "change" still can't reschedule the timer for nothing, but an `immediate` request always flushes. Found via a test that types text, presses Enter, and asserts the store reflects the filter with no `vi.advanceTimersByTime` call — it failed under the literal pseudocode and passes with the narrowed guard.
- **`positionFilterCells` follows `positionColumnCells`'s windowed algorithm, not `positionParentCells`'s span-based one.** The plan's step 14 cites `positionParentCells` as the mirror, but parent cells are un-windowed (one `Row` holding every group, positioned by summing `spanFrom`/`spanTo` widths from a `LayoutConstraints.data` payload) while filter cells are windowed exactly like column cells (`_filterWindowFirst` + slot index, one cell per horizontally-visible column, recycled on scroll) per the plan's own Architecture Decision ("Filter cells are virtualized and stateless"). Positioning them the parent-cell way would have nothing to span. Implemented as `positionColumnCells`'s slot-indexed loop against the filter row instead — the only shape consistent with the rest of the plan's virtualization design.
- **Found, not fixed (pre-existing, out of scope): `Body` never detaches its store event listeners (`'load'`/`'add'`/`'remove'`/`'datachange'`/`'beforesync'`/`'sync'`) in its `destructor()`.** Surfaced while testing filter-row disposal safety (case 34): disposing a `Table` whose store later emits `'datachange'` — e.g. from an unrelated `store.setFilter()` call — still runs `Body._updateFocusStyle` → `TableHeader.getColumns()` against the disposed, now-childless header and throws. `TableHeader`'s own new `'filterchange'` listener *is* correctly detached in its destructor (added this plan), so this doesn't regress anything this plan touches, but it means a literal `store.setFilter(...)` after `table.dispose()` is unsafe today for reasons unrelated to column filters. `ColumnFilterRow.test.ts`'s case-34 test exercises the header's own detachment via a direct `store.emit('filterchange', …)` (an event `Body` doesn't listen to) rather than a full `setFilter()` call, and documents why inline. Left unfixed: `Body.ts` is outside this plan's `Files to Create/Modify/Delete`, and fixing a store-listener leak on an unrelated class is a separate change.

### Manual-verification results (cases 38–41)

Cases 38–41 in `## Expected Behaviour` are manual-only (needs a real DOM/browser). Results, against the running `MiscPanel` demo's "Table with column spec" window on `npm run dev`:

- **Case 38 (typing filters as you type; operator menu not clipped; filter inputs scroll in step with the header/body).** Verified live. Typing into the Name filter narrowed the table to matching rows. The operator dropdown (via the small button beside the input) opened fully outside the header's `overflow: hidden` — unclipped — matching `MenuButton`'s own viewport-anchored positioning, not the header's clipped local space. With the table scrolled horizontally past its `clientWidth`, header cells and filter-row cells stayed pixel-aligned (`getBoundingClientRect().x` diff of `0` across every column) after the scroll.
- **Case 39 (right-click inside a filter input shows the native context menu, not the column-visibility menu).** Verified live. Right-clicking inside the Name filter's text input focused the input and produced no app-level menu; right-clicking a column header (control case) correctly produced the app's column-context `Menu` (`Reset columns`, checkmarked columns, …), confirming the detection method and that the filter input's own click target correctly falls outside the header's subtree-dispatch region for that gesture.
- **Case 40 (`TreeTable` filtering drops a filtered parent's subtree and re-roots orphaned children).** Live verification was attempted but the running demo build exposes no global/console handle to the `TreeTable`'s store, so `store.setFilter(...)` could not be driven from the browser console without adding throwaway instrumentation to the demo. Substituted with an offline test exercising the real component instead of skipping the case: `ColumnFilterRow.test.ts`'s `'40. store.setFilter on a filterable column drops a filtered parent's subtree and re-roots its children'` builds a real `TreeTable` over a `src → main.ts` / `docs` hierarchy, expands it, and asserts that filtering to `"main"` (which only `main.ts` matches) drops `src` and re-roots `main.ts` as a visible record — through the same `TreeBody.getVisibleRecords()` flattening `TreeBody.test.ts`'s pre-existing "orphan-as-root" case already covers, now reached via the new `setFilter` path instead of `filterBy`. No `TreeTable`-specific code was added by this plan, so this is a regression guard on that non-goal staying true, not new product code.
- **Case 41 (header right-click shows the checkbox-style Filter entry; toggling shows/hides the row and updates the checkmark).** Already covered by the automated cases 35–37 in `ColumnFilterRow.test.ts`, which drive `showColumnMenu` and its captured `action()` directly; not re-verified live separately since the mechanism (a plain `MenuItemConfig` list handed to the existing `Menu` component) carries no rendering risk the automated path can't see.
