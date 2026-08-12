---
touches-shared: [src/typescript/lib/component/table/index.ts]
---

# Table Column Filter Multi-Condition — Implementation Plan

## Overview

[`plans/implemented/table-column-filters.md`](implemented/table-column-filters.md) gave every filterable `Table` column one operator plus one text value in the header's filter row, writing a single leaf [`FilterDescriptor`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts) into the store per column. That plan's own `## Non-Goals` explicitly parked "more than one condition per column" — this plan lifts that limit: a column can hold several AND-combined conditions (`age ≥ 18 AND age ≤ 65`, or `name startsWith "A" AND name contains "smith"`), matching what an older app-side filter dialog offered before the header row replaced it.

The change is small because the pieces it needs already exist. `FilterDescriptor` already has an `and` variant ([`FilterDescriptor.ts:24`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L24)) that `matchesFilter` already evaluates recursively ([`FilterDescriptor.ts:106-110`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L106)), and `AbstractStore.setFilter(key, descriptor)` already stores exactly one descriptor per key with no constraint on that descriptor's shape ([`AbstractStore.ts:1547-1555`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1547)). Nothing in the data layer changes. The gap is entirely in the header's filter-row UI model: [`ColumnFilterState`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L28) holds one `{ operator, text }` pair, and [`buildColumnFilter`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L338) turns exactly that one pair into exactly one leaf descriptor.

This plan widens `ColumnFilterState` to a list of clauses, teaches `buildColumnFilter` to AND-compose two or more of them, and gives [`FilterCell`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts) a way to manage that list without widening any column's header in the common case — most columns carry zero or one condition, and those must look and behave exactly as they do today. The single visible text input and operator button keep editing the first (and usually only) clause; a small always-present menu entry adds a second clause and opens a [`Popover`](../packages/lib/src/typescript/lib/overlay/Popover.ts) that lists every clause with per-row add/remove, and a small corner badge — mirroring [`SortPriorityBadge`](../packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts)'s own hidden-until-2 pattern — surfaces the count on a column carrying more than one.

---

## Architecture Decisions

### The data layer and the store need no change

`FilterDescriptor`'s `and` variant and `matchesFilter`'s recursive evaluation of it are unmodified by this plan.[^data-layer-confirmed] `AbstractStore.setFilter` already replaces the one descriptor held under a field's key regardless of whether that descriptor is a leaf or an `and` of several leaves. A consuming application's own filter compiler (SQL or otherwise) that already understands `and` / `or` descriptors — which is how `buildColumnFilter`'s existing temporal-equality case already ships an `and` of two leaves today — needs no change either.

### `ColumnFilterState` becomes a list of clauses; the single-clause shape is not special-cased

```typescript
export interface ColumnFilterClause {
    operator: ColumnFilterOperator;
    text:     string;
}

export interface ColumnFilterState {
    clauses: ColumnFilterClause[];   // always length ≥ 1
}
```

A uniform array — never a union of "one clause" vs. "many clauses" shapes — because every consumer of `ColumnFilterState` (the debounce cache, the store-resync loop, `buildColumnFilter`) already treats it as opaque data; branching the *type* on clause count would force every one of those call sites to branch too, for no benefit, since a 1-element array costs nothing extra to construct or compare.[^uniform-array] `clauses.length` is never 0: the sole clause of a column with no extra conditions is not "removable" any more than today's single `{ operator, text }` pair is — it is only clearable, exactly as today (blank text on that clause, same as blank text on the old flat state).

### `buildColumnFilter` composes clauses; one clause still yields exactly today's leaf descriptor

`buildColumnFilter` keeps its four-argument signature (`field`, `target`, `state`, `display`). Internally it builds each clause's descriptor with the exact per-clause logic the current implementation already has (extracted, unchanged, into a private `buildClauseFilter`), drops any clause that resolves to `null` (blank text, or text that fails to parse — the existing "a half-typed number never blanks the table" rule, now applied per clause instead of to the one clause), and then:

| Survivors after dropping nulls | Result |
| --- | --- |
| 0 | `null` — no filter, same as today's blank-input case |
| 1 | that survivor's descriptor directly — **no `and` wrapper**, byte-identical to today's single-clause output |
| 2+ | `{ type: 'and', filters: [...] }`, survivors in clause order |

| `state.clauses` (field `age`, type `number`) | Result |
| --- | --- |
| `[{gte, '18'}]` | `{ type: 'gte', field: 'age', value: 18 }` |
| `[{gte, '18'}, {lte, '65'}]` | `{ type: 'and', filters: [{gte,18}, {lte,65}] }` |
| `[{gte, ''}, {lte, '65'}]` (first blank) | `{ type: 'lte', field: 'age', value: 65 }` — the blank clause is dropped, and the sole survivor is unwrapped |
| `[{gte, ''}, {lte, ''}]` (both blank) | `null` |

The "unwrap a lone survivor" rule is what makes the single-clause case byte-identical to today's output without a separate code path: a column configured with exactly one clause always has exactly one survivor (once it has any filter at all), so it always takes the 1-survivor row of the table above.[^why-unwrap] This is also why every existing `ColumnFilter.test.ts` / `ColumnFilterRow.test.ts` assertion that expects a bare leaf descriptor keeps passing unchanged — none of them need to be rewritten by this plan.

### Clause 0 stays inline; clauses 1+ live only in a popover

The visible text input and operator-picker button — unchanged in position, size, and behaviour — always read and write `clauses[0]`. A column with one clause therefore renders exactly as it does today, with zero extra chrome. `clauses[1..]` have no permanently-mounted control; they exist only inside a `Popover` opened on demand, and are never partially visible in the row itself.[^why-clause-zero-inline] The operator button's face (glyph + tooltip) always names `clauses[0]`'s operator, never a summary of the whole list — the badge (below) is the only signal that more clauses exist.

### The operator menu gains one always-present "Add condition…" entry

`FilterCell`'s existing operator-picker dropdown ([`cell/Filter.ts:82-87`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L82)) already lists one checkable `MenuItemConfig` per operator, resolved fresh on every open via `MenuButton`'s provider form ([`MenuButton.ts:119-123,193-202`](../packages/lib/src/typescript/lib/component/button/MenuButton.ts#L119)) — the same checkable-item mechanics `e28b0ebe` ("Add checkable MenuItem support; use it for the filter operator menu") added for exactly this button. This plan appends one `{ separator: true }` and one plain (non-checkable) item labelled `"Add condition…"` with a `plus` glyph, after the operator items. Its `action` always appends one blank clause (`{ operator: operators[0], text: '' }`) to the cell's clause list and opens the clauses popover — the same behaviour whether the column currently has 1 clause or 5, so there is exactly one rule to implement and test, not a rule that branches on the current count.[^single-add-rule] Reusing the existing checkable-item Menu — rather than a second button or a new dropdown primitive — costs one array entry and no new component.

### The clause editor is a `Popover`, not a new floating-panel primitive

[`Popover`](../packages/lib/src/typescript/lib/overlay/Popover.ts) already exists in this library as an anchored, dismissable, arbitrary-content floating bubble (`attachToComponent`, `show`/`hide`/`isOpen`, `setTitle`, `setBody(Component | string)`, `addAction`), is already proven with nested interactive children under the shared `LayerManager` (the `MiscPanel` "Popover + ComboBox (nested)" demo, [`MiscPanel.ts:2089-2106`](../packages/lib/src/typescript/MiscPanel.ts#L2089)), and needs no change. `FilterCell` builds one lazily on first "Add condition…" click — mirroring `MenuButton`'s own lazy `_menu ??= new Menu()` ([`MenuButton.ts:182`](../packages/lib/src/typescript/lib/component/button/MenuButton.ts#L182)) — anchors it to the operator button, and rebuilds its body's rows fresh from the cell's current clause list on every open, the same "rebuild fresh on every open" rule `MenuButton`'s provider form already follows.

Each row is an `HBox` of: a `MenuButton` operator picker (the same checkable-item pattern as the inline one, scoped to that row's clause), a `TextField`, and — for every row except the first — a [`TabCloseButton`](../packages/lib/src/typescript/lib/component/button/TabCloseButton.ts) remove control. Row 0 carries no remove button, for the same reason the inline single clause has never been "removable," only clearable. A plain `Button` labelled "Add condition" below the rows appends another blank clause and re-renders the row list; `Popover.addAction("Done", …)` closes it. This mirrors `FilterCellRenderer`'s own two-child `HBox` row shape ([`cell/renderer/Filter.ts:33`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Filter.ts#L33)) at the row level and reuses `TabCloseButton` rather than a hand-rolled glyph button, matching how that class already serves the identical "small compact remove control" role in tab headers.

### A new small badge class, not a reused `SortPriorityBadge`

`HeaderCell` already side-loads a corner-overlay badge onto a table cell — `SortPriorityBadge`, hidden while its count is below 2, shown as a small number otherwise, mounted with a raw `appendChild` (not `addComponent`) so the cell's `Card` layout does not hide it as a second "visible child" ([`cell/Header.ts:169-174`](../packages/lib/src/typescript/lib/component/table/cell/Header.ts#L169)). This plan needs exactly that shape for a clause count on `FilterCell`, but as a **new** class, `FilterClauseBadge`, rather than a second use of `SortPriorityBadge` itself.[^why-not-reuse-badge] `FilterClauseBadge` is built the same way — a class-scoped `StyleRule` for the shared absolute-position geometry, a `setCount(n: number | null)` setter, hidden below 2 — and, like `SortPriorityBadge`, is not re-exported from `component/table/index.ts`: neither badge is part of the public surface, both are purely internal cell-decoration detail.

### Cross-column OR stays out of scope

Every clause on a column ANDs into that column's own descriptor; there is no way to OR two clauses, and no way for a clause to name a field other than the one its `FilterCell` targets. Neither the app-side dialog this feature originally replaced nor the current header row ever offered cross-column OR, and nothing in this plan's popover UI (one clause list per column, no field picker on a row) creates a path to it.

---

## Public API

```typescript
// component/table/ColumnFilter.ts
export interface ColumnFilterClause {
    operator: ColumnFilterOperator;
    text:     string;
}

export interface ColumnFilterState {
    /** Always at least one entry. Combined with AND when there is more than one. */
    clauses: ColumnFilterClause[];
}

/** Builds one column's descriptor from every clause, ANDing 2+ survivors and unwrapping exactly 1. */
export function buildColumnFilter(field: string, target: ColumnFilterTarget, state: ColumnFilterState, display: CellTextResolver): FilterDescriptor | null;

/** True when both states have the same clauses, in the same order (used to suppress a redundant debounce reschedule). */
export function columnFilterStatesEqual(a: ColumnFilterState, b: ColumnFilterState): boolean;
```

`ColumnFilterOperator`, `columnFilterOperators`, `columnFilterOperatorLabel`, `columnFilterOperatorGlyph`, `columnFilterTakesOperand`, and `ColumnFilterTarget` are unchanged.

```typescript
// component/table/cell/Filter.ts — method signatures unchanged; ColumnFilterState is now the clause-list shape
class FilterCell extends Cell<string | null> {
    constructor(fieldName: string, operators: ColumnFilterOperator[]);
    setFieldName(name: string): this;
    getFieldName(): string;
    setOperators(operators: ColumnFilterOperator[]): this;
    setColumnLabel(label: string): this;
    /** Writes the full clause list without emitting "filterchange". */
    setFilterState(state: ColumnFilterState): this;
    /** Returns the full clause list currently held, read from the internal cache (see `## Internal Structure`). */
    getFilterState(): ColumnFilterState;
    on(event: "filterchange", listener: (fieldName: string, state: ColumnFilterState, immediate: boolean) => void): this;
}
```

```typescript
// component/table/cell/FilterClauseBadge.ts (new, internal — not re-exported)
class FilterClauseBadge extends Component {
    /** Hidden for null and for values below 2, matching SortPriorityBadge's own threshold. */
    setCount(value: number | null): this;
    getCount(): number | null;
}
```

`Header.ts`, `Table.ts`, `ColumnConfig.ts`, `Column.ts`, and `cell/renderer/Filter.ts` gain no new public members. `FilterDescriptor.ts` and `AbstractStore.ts` are untouched.

---

## Internal Structure

### `FilterCell`'s clause state replaces its single operator field

Today's `_operator: ColumnFilterOperator` field ([`cell/Filter.ts:57`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L57)) is replaced by:

```typescript
private _clauses: ColumnFilterClause[] = [{ operator: 'contains', text: '' }];   // length ≥ 1 always
declare private _badge: FilterClauseBadge;
private _clausesPopover: Popover | null = null;   // lazily created, mirrors MenuButton's `_menu`
private _columnLabel: string = '';                 // cached for the popover title; setColumnLabel already receives it
```

`_clauses[0]` is the single source of truth for the inline controls — every path that changes clause 0 (a keystroke, Enter, Escape, picking an operator from the main dropdown) writes into `_clauses[0]` first, then calls the existing `fireFilterChange`. This removes the current implicit split where the operator is cached but the text is read live from the renderer on every `getFilterState()` call: after this change, `getFilterState()` becomes a pure read of `_clauses` (`{ clauses: this._clauses.map(c => ({ ...c })) }`), with `_clauses[0].text` kept current on every "change"/Enter/Escape rather than re-read from the DOM at return time. The input's `"change"` handler (today a one-liner, [`cell/Filter.ts:76`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L76)) becomes:

```typescript
renderer.getInput().on("change", () => {
    this._clauses[0].text = renderer.getValue() ?? '';
    this.fireFilterChange(false);
});
```

`onInputKeyDown`'s Escape branch (which today calls `renderer.setValue(null)`) additionally sets `this._clauses[0].text = ''` before calling `fireFilterChange(true)`; its Enter branch needs no extra write since the preceding `"change"` event already updated `_clauses[0].text`. `selectOperator(op)` additionally sets `this._clauses[0].operator = op` (and, when the new operator ignores text, `this._clauses[0].text = ''` alongside its existing `renderer.setValue(null)`).

### `setOperators` collapses to one blank clause on a real operator-set change

Today's `setOperators` falls back to `operators[0]` only when the *current* operator is not in the new list ([`cell/Filter.ts:160-162`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L160)). Doing the equivalent per-clause check for a whole clause list (validating every clause's operator against the new set, one by one) is unneeded complexity: `reconcileFilterCells`'s pass 3 always calls `setFilterState` with the header's authoritative cached state (or the blank default) immediately after `setOperators` on every reconcile, in the same synchronous call, so whatever `setOperators` leaves in `_clauses` is overwritten before the next paint. `setOperators` therefore always collapses to a single blank clause on the new operator set, exactly mirroring today's single-clause reset:

```typescript
setOperators(operators: ColumnFilterOperator[]): this {
    this._operators = operators;

    const renderer = this.filterRenderer();
    const blank     = operators.length === 0;

    renderer.getInput().setDisplayed(!blank);
    renderer.getOperatorButton().setDisplayed(!blank);

    if (blank) {
        return this;
    }

    this._clauses = [{ operator: operators[0], text: '' }];
    this.applyOperatorFace(operators[0]);
    renderer.getInput().setEnabled(columnFilterTakesOperand(operators[0]));
    this.syncBadge();

    return this;
}
```

### The operator dropdown provider gains one trailing entry

```typescript
renderer.getOperatorButton().setMenuItems(() => [
    ...this._operators.map(op => ({
        text:    columnFilterOperatorLabel(op),
        glyph:   columnFilterOperatorGlyph(op),
        checked: op === this._clauses[0].operator,
        action:  () => this.selectOperator(op),
    })),
    { separator: true },
    { text: 'Add condition…', glyph: 'plus', action: () => this.addConditionAndOpenPopover() },
]);
```

`addConditionAndOpenPopover()`:

```typescript
private addConditionAndOpenPopover(): void {
    this._clauses.push({ operator: this._operators[0], text: '' });
    this.openClausesPopover();
    this.fireFilterChange(true);
}
```

### Popover construction and row rebuild

```typescript
private ensureClausesPopover(): Popover {
    if (!this._clausesPopover) {
        this._clausesPopover = new Popover({ placement: 'auto', dismissOn: 'click-outside' });
        this._clausesPopover.addAction('Done', () => this._clausesPopover!.hide());
    }
    return this._clausesPopover;
}

private openClausesPopover(): void {
    const popover = this.ensureClausesPopover();

    popover.setTitle(this._columnLabel + ' filter conditions');
    popover.setBody(this.buildClausesBody());
    popover.attachToComponent(this.filterRenderer().getOperatorButton());
    popover.show();

    this.syncBadge();
}
```

`buildClausesBody()` returns a fresh `VBox`-laid `Component`: one `buildClauseRow(index)` per entry in `_clauses`, then a plain `Button('Add condition', { glyph: 'plus' })` whose action pushes a blank clause, calls `syncBadge()`, calls `fireFilterChange(true)`, and re-renders the body in place (`popover.setBody(this.buildClausesBody())` again — `Popover.setBody` replaces its previous body wholesale, per [`Popover.ts:367-382`](../packages/lib/src/typescript/lib/overlay/Popover.ts#L367)).

`buildClauseRow(index)` returns an `HBox` of a per-row `MenuButton` (operator picker, checkable items exactly like the inline one but reading/writing `_clauses[index]`), a `TextField` seeded from `_clauses[index].text` whose `"change"` handler writes `_clauses[index].text` and calls `fireFilterChange(false)` (debounced, exactly like the inline input), and — when `index > 0` — a `TabCloseButton` whose action removes `_clauses[index]`, re-renders the body, calls `syncBadge()`, and calls `fireFilterChange(true)` (immediate, like every other discrete popover action).

### The badge

```typescript
private syncBadge(): void {
    this._badge.setCount(this._clauses.length >= 2 ? this._clauses.length : null);
}
```

Called at the end of every mutation that can change `_clauses.length` or after `setFilterState` rehydrates the array — mirroring `HeaderCell`'s `_priorityBadge.setPriority(...)` call sites, one per state-changing method.

### `setFilterState` clones the incoming clauses; it must not alias the caller's array

`setFilterState`'s caller is always `Header.reconcileFilterCells`, passing either a `ColumnFilterState` pulled straight out of its own `filterState()` cache `Map` or the shared default literal. If `setFilterState` aliased that array (`this._clauses = state.clauses`), then a later popover mutation (`push`/`splice` on `this._clauses`) would silently mutate the header's cached entry directly, bypassing `fireFilterChange` → `onFilterCellChange` → `filterState().set(...)` entirely — the header's cache and the store would then disagree about what the cell holds. `setFilterState` therefore deep-copies:

```typescript
setFilterState(state: ColumnFilterState): this {
    this._clauses = state.clauses.map(c => ({ ...c }));

    const renderer = this.filterRenderer();
    this.applyOperatorFace(this._clauses[0].operator);
    renderer.getInput().setEnabled(columnFilterTakesOperand(this._clauses[0].operator));
    renderer.setValue(this._clauses[0].text === "" ? null : this._clauses[0].text);
    this.syncBadge();
    this.doLayout();

    return this;
}
```

### `setFieldName` closes an open popover when the field actually changes

`reconcileFilterCells`'s pass 3 calls `cell.setFieldName(field.getName())` on every rendered cell on every pass, whether or not that cell's field is actually changing.[^setfieldname-every-pass] `setFieldName` therefore only closes the popover when the incoming name differs from the cached one — a true recycle — not on every resync:

```typescript
setFieldName(name: string): this {
    if (name !== this._fieldName) {
        this._clausesPopover?.hide();
    }

    this._fieldName = name;

    return this;
}
```

### `FilterCell.init()` side-loads the badge

`FilterCell` currently inherits `Cell`'s `init()` unchanged (no override). This plan adds one, mirroring [`cell/Header.ts:151-185`](../packages/lib/src/typescript/lib/component/table/cell/Header.ts#L151) exactly:

```typescript
protected init(element?: Handle): this {
    super.init(element);

    const el = element || this.getElement();
    if (!el) return this;

    DOM.sink.appendChild(el, this._badge.getElement(true)!);

    return this;
}
```

### `FilterCell.destructor()`

```typescript
protected destructor(): void {
    // `_badge` is a `declare` field (see cell/Header.ts:586-595's own comment on why),
    // so it can read as `undefined` if teardown lands before the constructor body ran.
    this._badge?.dispose();
    this._clausesPopover?.dispose();

    super.destructor();
}
```

### `Header.ts`'s three touch points

1. `reconcileFilterCells`'s pass-3 default state literal ([`Header.ts:1212-1213`](../packages/lib/src/typescript/lib/component/table/Header.ts#L1212)):
   ```typescript
   cell.setFilterState(this.filterState().get(field.getName())
       ?? { clauses: [{ operator: operators[0], text: '' }] });
   ```
2. `onFilterCellChange`'s unchanged-state guard ([`Header.ts:970`](../packages/lib/src/typescript/lib/component/table/Header.ts#L970)) swaps the flat `operator`/`text` comparison for the new helper:
   ```typescript
   const unchanged = !!cached && columnFilterStatesEqual(cached, state);
   ```
3. Every other read site (`filterState()`'s `Map<string, ColumnFilterState>`, `applyPendingFilter`, `onStoreFilterChange`) already treats `ColumnFilterState` as an opaque value passed straight to `buildColumnFilter` or cached whole — no logic change, only the type reference following `ColumnFilterState`'s new shape.

### `columnFilterStatesEqual`

```typescript
export function columnFilterStatesEqual(a: ColumnFilterState, b: ColumnFilterState): boolean {
    if (a.clauses.length !== b.clauses.length) return false;
    return a.clauses.every((c, i) => c.operator === b.clauses[i].operator && c.text === b.clauses[i].text);
}
```

---

## Ordered Implementation Steps

1. **`component/table/ColumnFilter.ts`** — add `ColumnFilterClause`, reshape `ColumnFilterState` to `{ clauses: ColumnFilterClause[] }` (replacing the flat `{ operator, text }`), extract the current body of `buildColumnFilter` (lines [338-405](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L338)) verbatim into a private `buildClauseFilter(field, target, clause, display): FilterDescriptor | null` taking one `ColumnFilterClause`, then rewrite `buildColumnFilter` to map every clause through it, drop `null` survivors, and apply the zero/one/many rule from `## Architecture Decisions`. Add `columnFilterStatesEqual`. Update the module's JSDoc comments that describe the old single-clause shape.
2. **`packages/lib/tests/component/table/ColumnFilter.test.ts`** — every existing `buildColumnFilter(...)` call site passes `{ operator, text }` as `state`; update each to `{ clauses: [{ operator, text }] }` (mechanical, output assertions unchanged — this is the regression proof that one clause still yields today's bare leaf descriptor). Add the new multi-clause cases from `## Expected Behaviour` and the `columnFilterStatesEqual` cases.
3. **`component/table/cell/FilterClauseBadge.ts`** (new) — mirror [`cell/SortPriorityBadge.ts`](../packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts) structurally: a module-local `ensureFilterClauseBadgeClassRule()` registering a `.FilterClauseBadge` class rule with the same absolute-corner geometry, a `_defaultFilterClauseBadgeOptions` bag with its own `--ts-ui-filter-clause-badge-bg` / `--ts-ui-filter-clause-badge-color` tokens (do not reuse `--ts-ui-sort-badge-*` — see `## Architecture Decisions`), and `setCount`/`getCount` in place of `setPriority`/`getPriority`, hidden below 2. Exported via `callable()` per the project convention but **not** added to `component/table/index.ts` (internal, matching `SortPriorityBadge`'s own non-export).
4. **`core/Theme.ts`** — add `--ts-ui-filter-clause-badge-bg` / `--ts-ui-filter-clause-badge-color` to the `Theme`, `DefaultTheme`, `DarkTheme`, and `themeToVars` blocks, following whatever existing `--ts-ui-sort-badge-*` entries there do for a light/dark default pair.
5. **`component/table/cell/Filter.ts`** — replace `_operator` with `_clauses` (default `[{ operator: 'contains', text: '' }]`), add `declare private _badge: FilterClauseBadge = new FilterClauseBadge()` constructed in the constructor (mirroring `HeaderCell`'s `_priorityBadge` construction), add `_clausesPopover: Popover | null = null`, and `_columnLabel: string = ''` written by `setColumnLabel` alongside its existing accessible-name write. Rewrite `applyOperatorFace`, `setOperators`, `setFieldName`, `setFilterState`, `getFilterState`, `selectOperator`, and the input's `"change"`/keydown handlers to read/write `_clauses[0]` (and, for `setFieldName`, to close the popover on a real field change) per `## Internal Structure`. Add the trailing "Add condition…" menu entry, `addConditionAndOpenPopover`, `ensureClausesPopover`, `openClausesPopover`, `buildClausesBody`, `buildClauseRow`, and `syncBadge`. Add the `init()` override side-loading `_badge`, and the `destructor()` override disposing `_badge` and `_clausesPopover`. Import `Popover` from `~/overlay/Popover.js`, `TabCloseButton` from `~/component/button/TabCloseButton.js`, `Button` from `~/component/button/Button.js`, `VBox`/`HBox` from their layout modules, and the `plus` glyph (register it alongside the existing `Glyph.register(...)` call at the top of the file).
6. **`component/table/Header.ts`** — apply the three touch points from `## Internal Structure`: the pass-3 default literal, the `onFilterCellChange` equality check (import `columnFilterStatesEqual`), and confirm (by reading, no edit needed) that `filterState()`, `applyPendingFilter`, and `onStoreFilterChange` need no further change beyond `ColumnFilterState`'s new shape flowing through their existing type references.
7. **`component/table/index.ts`** — widen the existing `export type { ColumnFilterOperator, ColumnFilterState, ColumnFilterTarget }` line ([`index.ts:18`](../packages/lib/src/typescript/lib/component/table/index.ts#L18)) to add `ColumnFilterClause`, and add `columnFilterStatesEqual,` inside the existing multi-line `export { columnFilterOperators, …, buildColumnFilter }` block ([`index.ts:11-17`](../packages/lib/src/typescript/lib/component/table/index.ts#L11)). Do not add `FilterClauseBadge`.
8. Regression check: `grep -n "\.operator\b\|\.text\b" packages/lib/src/typescript/lib/component/table/Header.ts` — every remaining match must be inside `ColumnFilterClause` construction/comparison (i.e., addressed through `.clauses[i]`), not a bare `state.operator` / `state.text`.
9. **Tests** — extend `packages/lib/tests/component/table/ColumnFilterRow.test.ts` per `## Expected Behaviour`, following its existing `(cell as any).privateMethod(...)` idiom for driving the popover (documented at the top of that file for keydown; extend the same rationale comment for popover access) and its existing `pickOperator`-style helper pattern for resolving `MenuItemConfig` providers.
10. **Docs** — apply the edits in `## Documentation Impact`.
11. Run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run docs:api` from `packages/lib`.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/component/table/ColumnFilter.ts` |
| Create | `packages/lib/src/typescript/lib/component/table/cell/FilterClauseBadge.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Filter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/index.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Theme.ts` |
| Modify | `packages/lib/tests/component/table/ColumnFilter.test.ts` |
| Modify | `packages/lib/tests/component/table/ColumnFilterRow.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |

No file is deleted. `FilterDescriptor.ts`, `AbstractStore.ts`, `cell/renderer/Filter.ts`, `ColumnConfig.ts`, `Column.ts`, and `Table.ts` are untouched.

---

## Expected Behaviour

### `buildColumnFilter` / `columnFilterStatesEqual` (unit-testable, `ColumnFilter.test.ts`)

1. One clause (`age`, `gte`, `'18'`) builds `{ type: 'gte', field: 'age', value: 18 }` — unchanged from today.
2. Two clauses (`age`, `gte '18'` then `lte '65'`) build `{ type: 'and', filters: [{gte,18},{lte,65}] }`, filters in clause order.
3. Three clauses build an `and` of three, in clause order.
4. Two clauses where the first is blank text builds the second's bare descriptor, unwrapped (no `and`).
5. Two clauses both blank (or both unparseable) builds `null`.
6. A combo column (`role`, `values` set) with two clauses — `contains 'eng'` then `neq 'Developer'` — builds `and` of the `in` descriptor and the `not`-`in` descriptor, each resolved exactly as `buildColumnFilter` already resolves a single combo clause.
7. A `time` column with a single `eq` clause still builds the existing `and(gte, lt)` display-bucket descriptor directly (not double-wrapped) — confirms the "unwrap when 1 survivor" rule applies even when that one survivor is itself an `and`.
8. `columnFilterStatesEqual({clauses:[{operator:'contains',text:'a'}]}, {clauses:[{operator:'contains',text:'a'}]})` is `true`; a length mismatch, an operator mismatch at any index, or a text mismatch at any index is `false`.

### `FilterCell` / popover (unit-testable offline, `ColumnFilterRow.test.ts`)

9. A freshly built `FilterCell` (or one just recycled onto a new column) has `getFilterState().clauses` of length 1, and renders identically to today: one visible text input, one visible operator button, no visible badge.
10. Typing into the inline input and flushing the debounce still calls `store.setFilter(field, <bare leaf descriptor>)` — the existing single-clause store-write tests (cases 24-28, 31 in the current file) pass unchanged.
11. Opening the operator dropdown shows every existing operator entry unchanged, plus a trailing separator and an `"Add condition…"` entry.
12. Invoking `"Add condition…"`'s action once: `getFilterState().clauses.length` is 2 (the new clause blank, `operators[0]`), the badge shows `2`, and the popover is open (`isOpen()` true) with two rows — row 0 with no remove control, row 1 with one.
13. Typing into row 1's text field and flushing the debounce updates `store.getFilter(field)` to the two-clause `and` descriptor (clause 0's existing text unchanged, clause 1's new text applied) — using the *same* debounce timer as the inline input, so a keystroke in either row resets one shared per-field timer, not two independent ones.
14. Picking a different operator on row 1 applies immediately (no debounce wait), mirroring the inline operator picker's immediate-apply contract.
15. Clicking row 1's remove control: `clauses.length` returns to 1, the badge becomes hidden, `store.getFilter(field)` immediately reflects clause 0's bare descriptor alone (no debounce wait), and the popover's row list re-renders down to one row.
16. Adding a third clause via the popover's own "Add condition" button (not the outer menu entry) appends a third row with its own remove control; removing rows 1 and 2 in either order always leaves row 0 un-removable.
17. A filter cell recycled off-window and back on (mirroring the existing test 29's scroll-out/scroll-in pattern) restores the *full* clause list it had before scrolling out, not just clause 0.
18. `store.clearFilter()` called programmatically resets a 2-clause column back down to `clauses.length === 1` with a blank default clause and a hidden badge — the existing single-clause "external clear" behaviour (test 31), now also proven for a column that had extra clauses.
19. `table.setFilterRowVisible(false)` clears the whole clause list's store entry (unchanged existing behaviour — `clearFilterRowState` operates on the store key, not on clause internals) and, on `setFilterRowVisible(true)` again, the column is back to one blank default clause.
20. Disposing a table (or a cell falling out of the horizontal recycle pool on a very wide table, mirroring test 30's pattern) after a popover was opened does not throw, and does not leave a dangling open popover layer.
21. Opening a cell's popover, then scrolling far enough that the cell recycles onto a different field (mirroring test 30's wide-table scroll pattern): the popover is closed (`isOpen()` false) once the recycle lands. Scrolling within the *same* field staying assigned to the cell (a `renderColumnWindow` call that reconciles without moving that cell to a new column) leaves an open popover open.

### Manual verification

22. In the docs/demo app, open a filterable column's operator menu, click "Add condition…", and confirm the popover opens anchored under the operator button, is not clipped by the header's `overflow: hidden` (same non-clipping the existing operator dropdown already relies on), and that adding/removing rows narrows/widens the visible table rows live as expected for an AND of the visible conditions.
23. Confirm a column with exactly one condition is visually indistinguishable from the shipped single-condition filter row — no badge, no extra button, same input width — by comparing a before/after screenshot of the same demo table with this plan applied but no second condition ever added.

---

## Verification

From `packages/lib`:

- `npm run typecheck` — zero errors.
- `npm run lint` — zero errors.
- `npm run test` — the two edited test files plus the full existing suite unchanged, in particular every pre-existing `ColumnFilter.test.ts` / `ColumnFilterRow.test.ts` case whose expected output is a bare leaf descriptor (the regression guard for byte-identical single-clause output).
- `npm run docs:api` — zero warnings; `FilterClauseBadge` carries no public `{@link}` since it is not re-exported.
- `grep -n "\.operator\b\|\.text\b" packages/lib/src/typescript/lib/component/table/Header.ts` — no bare `state.operator` / `state.text` survives outside `.clauses[i]` access (step 8's regression check).
- `grep -rn "sort-badge" packages/lib/src/typescript/lib/component/table/cell/FilterClauseBadge.ts` — expect zero matches, confirming the new badge does not silently borrow the sort badge's theme tokens.
- Manual: run the docs app (`npm run docs:dev`) and exercise cases 22-23 on a `Table` demo with `filterable: true`.

---

## Documentation Impact

- `packages/lib/docs/components/Table.md`'s `## Column filters` section ([`Table.md:211-250`](../packages/lib/docs/components/Table.md#L211)) — add a paragraph after the existing operator table describing multiple AND-combined conditions: how to open the "Add condition…" entry, that the inline input always edits the first condition, that the small badge shows the count once there are 2 or more, and that removing conditions down to one returns the column to today's single-condition look. State plainly that this supersedes the previous "one operator and one value per column" limitation the row shipped with.
- No change to `packages/lib/docs/components/TreeTable.md` or `packages/lib/docs/data/store.md` — neither documents a per-column condition count, and the store-level contract (`setFilter`/`getFilter`) is unchanged.
- No `llms.txt` edit — same reasoning as the original plan: this extends an existing capability rather than adding a new top-level one.
- No changelog entry or version bump — handled separately at release time.

---

## Potential Challenges

- **The operator dropdown grows by two rows on every filterable column.** Mitigation: none needed — `Menu`'s existing panel already scrolls, and the two new rows (separator + "Add condition…") are a fixed, small addition regardless of column count.
- **A popover left open while its column scrolls out of the virtualized window.** The cell gets recycled onto another field while its popover is still showing stale rows anchored to a button that no longer represents that field. Mitigation: `setFieldName` closes the popover exactly when the incoming name differs from the cached one, per `## Internal Structure` — a true recycle, not every resync pass.
- **Typing in a popover row while the same field's inline input also has a pending debounced write.** Cannot happen structurally: both routes funnel through the same `fireFilterChange` → `Header.onFilterCellChange`, keyed by field name, so the existing "a different field's pending write flushes first, this field's timer restarts" logic already covers a same-field collision between the inline input and a popover row — no new logic needed, only confirmed by the shared-timer test (case 13).
- **Long clause lists inside a narrow popover.** Mitigation: none needed for v1 — `Popover`'s `VBox` body sizes to content and the panel is a floating overlay independent of column width, unlike the inline row; no minimum-width floor changes.
- **Opening the `Popover` from inside a `MenuItem`'s `action`, while the enclosing operator `Menu` is still dismissing itself.** This plan's `MiscPanel` precedent (`## Architecture Decisions`) shows a `Popover` opened from a plain `Button` click, not from a `Menu` item's action closing a sibling floating layer in the same tick — that exact sequencing is not independently confirmed against `Menu`'s own dismiss timing. Mitigation: implement step 5's `addConditionAndOpenPopover` as written and cover it with case 12; if the popover's open animation visibly races the menu's close animation under `LayerManager`, defer the `openClausesPopover()` call one microtask (`Promise.resolve().then(...)`) rather than changing `Popover` or `Menu`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/ColumnFilter.ts`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts) — the pure module this plan reshapes; read `buildColumnFilter` and every helper it calls before touching it.
- [`packages/lib/src/typescript/lib/component/table/cell/Filter.ts`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts) — the class most of this plan's new code lands in.
- [`packages/lib/src/typescript/lib/component/table/cell/Header.ts`](../packages/lib/src/typescript/lib/component/table/cell/Header.ts) — the precedent this plan mirrors twice: `_priorityBadge`'s side-loaded-overlay construction/`init()`/`destructor()` shape ([`cell/Header.ts:90,142,169-174,586-595`](../packages/lib/src/typescript/lib/component/table/cell/Header.ts#L90)), which `FilterClauseBadge` and `FilterCell`'s new `init()`/`destructor()` follow directly.
- [`packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts`](../packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts) — the structural precedent `FilterClauseBadge` copies (class-scoped `StyleRule`, hidden-below-2 threshold, per-instance count text).
- [`packages/lib/src/typescript/lib/overlay/Popover.ts`](../packages/lib/src/typescript/lib/overlay/Popover.ts) — the floating-content primitive the clause editor is built on; read `attachToComponent`, `show`/`hide`/`isOpen`, `setBody`, `addAction`.
- [`packages/lib/src/typescript/lib/component/button/MenuButton.ts`](../packages/lib/src/typescript/lib/component/button/MenuButton.ts) — the lazy-popover-creation and rebuild-fresh-on-every-open precedent (`_menu ??= new Menu()`, `resolveMenuItems()`), and the operator picker's own base class.
- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts) — the `checked` field's semantics (reserved check-column, opt-in per menu) the operator dropdown's extra plain entry must coexist with.
- [`packages/lib/src/typescript/lib/component/button/TabCloseButton.ts`](../packages/lib/src/typescript/lib/component/button/TabCloseButton.ts) — the compact remove-control precedent each popover row (index ≥ 1) reuses directly.
- [`packages/lib/src/typescript/lib/component/table/Header.ts`](../packages/lib/src/typescript/lib/component/table/Header.ts) — `reconcileFilterCells`, `onFilterCellChange`, `filterState()`; the three touch points in `## Internal Structure`.
- [`packages/lib/src/typescript/lib/data/FilterDescriptor.ts`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts) — read-only reference confirming the `and` variant and its evaluator, per `## Architecture Decisions`' opening claim.
- [`packages/lib/tests/component/table/ColumnFilterRow.test.ts`](../packages/lib/tests/component/table/ColumnFilterRow.test.ts) — the offline harness, helper style (`typeInto`, `pickOperator`), and private-method-access idiom this plan's new tests extend.
- [`plans/implemented/table-column-filters.md`](implemented/table-column-filters.md) — the plan this one extends; its `## Non-Goals` bullet on "more than one condition per column" is what this plan lifts, and its footnotes explain the debounce-on-header and per-store-state design this plan inherits unchanged.

---

## Non-Goals

- **Cross-column OR.** Every clause targets the one field its `FilterCell` already owns; there is no field picker on a popover row and no `or` composition. See `## Architecture Decisions`.
- **A dedicated `between` operator.** Two ordered clauses (`gte` + `lte`) already express a range through the general clause list with no extra operator, so a `between` shorthand would only save one popover click for the numeric/date/time/datetime case while adding a second, narrower code path. Not built.
- **Cross-column condition groups or a `(A OR B) AND C` expression builder.** The scope stays "several AND-combined conditions on one column," matching what the app-side dialog this feature originally replaced, and what the current header row's per-column model already structurally supports without a rewrite.
- **A configurable clause-count limit.** No cap is imposed; the UI's own friction (one popover click per added row) is the only practical limit, matching the original plan's own choice not to add configuration knobs for the single-clause case.
- **Persisting or restoring popover-open state across a page reload or a rotated-mode round trip.** The popover always starts closed; only the underlying `_clauses` array (cached the same way the original single-clause state already was, per store in a `WeakMap`) survives a rotate round trip.
- **Changing `filter()` / `filterBy()` / `clearFilter()`'s existing stacking or clear-everything contracts.** Untouched, per the original plan's own non-goal.
- **A changelog entry or version bump.** Handled separately at release time.

---

## Notes

[^data-layer-confirmed]: Verified directly against the current source rather than assumed from the brief that prompted this plan: [`FilterDescriptor.ts:24`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L24) declares `{ type: 'and'; filters: FilterDescriptor[] }` as one arm of the `FilterDescriptor` union, and `matchesFilter`'s `'and'` case ([`FilterDescriptor.ts:106-110`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L106)) recursively evaluates every entry in `filters`, short-circuiting on the first non-match. `AbstractStore.setFilter` ([`AbstractStore.ts:1547-1555`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1547)) stores whatever `FilterDescriptor` it is given under `key` with no shape validation, and `getFilter` ([`AbstractStore.ts:1564-1568`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1564)) returns a shallow copy of it unchanged. `buildColumnFilter` already emits an `and` of two leaves today for temporal `eq` ([`ColumnFilter.ts:372-378`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L372)), proving the whole pipeline — store, worker-boundary structured clone (per `ColumnFilter.test.ts`'s existing "worker safety" cases), and `matchesFilter` — already round-trips a composite descriptor correctly for one column today.

[^uniform-array]: A union type (`{ operator, text } | { clauses: [...] }`) was considered and rejected: every reader of `ColumnFilterState` (`Header.filterState()`'s cache, `onStoreFilterChange`'s resync loop, `buildColumnFilter`) would need a type guard before doing anything, for a "fast path" that saves exactly one array-literal allocation per keystroke — not a measurable cost next to the DOM writes and debounce timer already on that path.

[^why-unwrap]: Without the unwrap rule, a column's descriptor would change shape the moment a second (even blank) clause row exists in the UI, independent of whether that second clause ever resolves to anything — e.g. clicking "Add condition…" and not yet typing into the new row would still wrap clause 0's existing filter in a needless `{ type: 'and', filters: [x] }`. Unwrapping whenever exactly one clause survives keeps the store's descriptor exactly as simple as the currently-active filtering intent, matching the existing rule that a blank operand never contributes a spurious filter.

[^why-clause-zero-inline]: Two alternatives were rejected. Making every clause — including the first — live only in the popover would widen the row's chrome for the zero-popover-interaction common case (the operator button would need a summary face like "2 conditions" instead of a specific operator glyph, and a returning user with one simple condition would need an extra click just to see or edit it). Making the inline row grow a second input when a second clause exists (the `between`-style two-input approach considered for the narrower fallback design) was rejected for the general case because it re-introduces exactly the "does the column widen" problem this plan's core requirement rules out, and does not generalise past two clauses or past same-shape operators (a `startsWith` + `contains` pair does not fit two side-by-side inputs the way `gte` + `lte` does). Keeping clause 0 permanently inline and clauses 1+ exclusively in the popover avoids both: the common (0 or 1 condition) case is untouched pixel-for-pixel, and the popover's vertical list has no shape constraint tying it to two.

[^single-add-rule]: An earlier version of this design gave the menu entry two labels — `"Add condition"` while at 1 clause, `"Edit conditions (N)"` at 2+, with only the first label appending a blank row. Collapsing to one label and one unconditional "always append, always open" rule removes a second behaviour to implement and test for a difference the badge already communicates (the count), and matches how the popover's own internal "Add condition" button already behaves identically regardless of the current row count.

[^why-not-reuse-badge]: Reusing `SortPriorityBadge` directly (same class, second call site) was considered — its behaviour (hidden below count 2, small corner number) is exactly what a clause-count indicator needs, and it would add zero new lines. Rejected for two reasons: its CSS custom properties are named `--ts-ui-sort-badge-bg` / `--ts-ui-sort-badge-color`, so a consumer re-theming "the sort badge" would unintentionally re-theme the filter-clause badge too, an unrelated-feature coupling through a shared token namespace; and a class literally named `SortPriorityBadge` appearing inside `cell/Filter.ts` reads as a copy-paste mistake to a future reader, costing more understanding-time than the ~60 lines saved. Generalising `SortPriorityBadge` itself into a shared base class (`CountBadge`) was also considered and rejected as disproportionate: it would touch the sort feature's existing, tested code for a benefit — avoiding one small duplicated file — that does not clear the bar for editing unrelated working code (`CLAUDE.md`'s "Surgical Changes" rule).

[^setfieldname-every-pass]: Confirmed against the current source: `reconcileFilterCells`'s pass 3 ([`Header.ts:1200-1215`](../packages/lib/src/typescript/lib/component/table/Header.ts#L1200)) calls `cell.setFieldName(field.getName())` unconditionally for every cell in the rendered window on every invocation — including a resync triggered by `onStoreFilterChange` ([`Header.ts:1067-1090`](../packages/lib/src/typescript/lib/component/table/Header.ts#L1067)), which sets `_filterCellsDirty = true` and re-renders even when no column has actually scrolled. Closing the popover unconditionally inside `setFieldName` would therefore also close it on an unrelated same-column resync (e.g. another field's `store.clearFilter()`), which is not the "recycled onto a different column" case this mitigation targets.
