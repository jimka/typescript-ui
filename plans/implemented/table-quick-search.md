# Table Quick Search — Implementation Plan

## Overview

Add `Table.setQuickSearch(text, fields?)`: one call that hides every row whose displayed cell text does not contain `text`, matched case-insensitively. It replaces a hand-rolled pattern that today exists twice in the demo app — the 45-column wide-table demo ([`MiscPanel.ts:415-440`](../packages/lib/src/typescript/MiscPanel.ts#L415-L440)) and the column-spec demo ([`MiscPanel.ts:759-767`](../packages/lib/src/typescript/MiscPanel.ts#L759-L767)) — each of which builds a needle, a per-record text cache, and a predicate by hand.

Everything lands in [`packages/lib/src/typescript/lib/component/table/Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts). The new method reuses two pieces `Table` already owns: `getCellText(field, record)` ([`Table.ts:1808`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1808)), which returns the exact text a cell shows, and the display-only row filter `setRowVisible(predicate)` ([`Table.ts:495`](../packages/lib/src/typescript/lib/component/table/Table.ts#L495)), which forwards to the single predicate slot `Body.getVisibleRecords()` reads ([`Body.ts:370`](../packages/lib/src/typescript/lib/component/table/Body.ts#L370)). No file under `component/table/` other than `Table.ts` changes.

`Body.getVisibleRecords()` re-runs the active predicate over the whole store on every render pass, including every scroll frame, so formatting each record's cells inside the predicate is far too expensive at scale — the wide-table demo measured 100ms+ of blocked main thread per frame before it added a cache. `Table` therefore caches one searchable string per record, built the first time that record is tested and reused until the search changes.

---

## Architecture Decisions

### The method is `setQuickSearch(text, fields?)`

One public setter on `Table`, taking the raw search text and an optional list of field names to restrict the search to. Passing `null`, `''`, or blank text clears the search, the same way `setRowVisible(null)` clears its predicate.[^naming]

### A column is searched when its filter row would offer **Contains**

With no `fields` argument, the searched set is every resolved column — including one the user has hidden — whose `Column.isFilterable()` is `true` and whose field type offers the `contains` operator in the header's filter row. The screen is `column.isFilterable() && columnFilterOperators(column.getField().getType()).includes('contains')`, the same pair `TableHeader` uses to decide which operators a filter cell gets ([`Header.ts:1193`](../packages/lib/src/typescript/lib/component/table/Header.ts#L1193), [`Header.ts:1215`](../packages/lib/src/typescript/lib/component/table/Header.ts#L1215)).[^default-scope]

Worked cases, against the column-spec demo's own columns:

| Column | Type / config | Searched by default? | Why |
| --- | --- | --- | --- |
| `Name` | `string` | yes | `string` offers Contains |
| `Score` | `number` | yes | `number` offers Contains too |
| `Joined` | `date` | yes | matched on the cell's formatted text |
| `Role` | `string` + `values` (combo) | yes | matched on the option label, e.g. `Developer` |
| `Active` | `boolean` | **no** | `boolean` offers no Contains — the cell is a checkbox with no text |
| `Notes` | `string`, `hidden: true` | yes | hidden columns are still searched |
| a column with `filterable: false` | any | **no** | the same "don't offer text matching here" opt-out the filter row reads |

### An explicit `fields` list wins over that screen

When `fields` is given it is used verbatim: every named field is searched, even one whose column is `filterable: false`, is of a type with no Contains operator, or names no column at all (that one contributes empty text). An empty array searches nothing, so no row matches.[^explicit-fields]

### Quick search and `setRowVisible` compose with AND, inside `Table`

`Table` holds the two independently and forwards a single composed predicate to `Body`. A row renders when both agree: the quick search matches, and the consumer's own `setRowVisible` predicate returns `true`. Either one alone still works, and setting one never clears the other. `Body` and `TreeBody` are not touched — they keep their single predicate slot.[^compose-in-table]

### Rotated mode and `TreeTable` behave exactly as they do for `setRowVisible`

Because the composed predicate travels through the existing `Body` slot, quick search inherits both existing behaviours with no new code: it is neutralized while `getDisplayMode()` is `"rotated"` and resumes on return to `"normal"`, and it is a documented no-op on `TreeTable`.[^rotated-tree]

### The per-record text cache lives in `Table`, and a record's entry is dropped when that record is edited

`Table` gets one nullable private field holding the whole active search — needle, searched field names, and a `WeakMap<ModelRecord, string>` of joined lower-case cell text. `setQuickSearch` replaces that object wholesale, so a new search can never read the previous search's text. The cache is *not* invalidated by rendering, scrolling, or a store `'datachange'`, which is the entire point of it.[^cache-placement]

A record's cached entry *is* dropped when the store reports that record changed: `Table` subscribes to the store's `'update'` event, whose payload carries the edited record ([`AbstractStore.ts:80-88`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L80-L88)), and deletes that one entry. An in-grid cell edit fires `'update'` then `'datachange'` ([`AbstractStore.ts:940-943`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L940-L943)) — the invalidation therefore lands before the re-render that `'datachange'` triggers, so the edited row is re-tested against fresh text on the same paint.[^update-invalidation]

### Replacing the store re-derives the search

`setStore` re-resolves the columns ([`Table.ts:546`](../packages/lib/src/typescript/lib/component/table/Table.ts#L546)). When a search is active it is rebuilt against the new columns — same needle, same `fields` argument, freshly derived field list, empty cache — and re-applied.[^set-store]

---

## Public API

```typescript
// component/table/Table.ts
class Table extends Component<TableOptions> {
    setQuickSearch(text: string | null, fields?: readonly string[] | null): this;
}
```

No new exported symbol or type. The state object's shape is a module-local, non-exported interface in `Table.ts`, matching the existing `WidthPolicy` / `WidthReferences` interfaces there ([`Table.ts:102`](../packages/lib/src/typescript/lib/component/table/Table.ts#L102), [`Table.ts:109`](../packages/lib/src/typescript/lib/component/table/Table.ts#L109)).

Backing state:

| Class | Field | Written by | Default |
| --- | --- | --- | --- |
| `Table` | `private _quickSearch: QuickSearchState \| null` | `setQuickSearch`, `refreshQuickSearch` | `null` |
| `Table` | `private _sourceUpdate: ((event: StoreUpdateEvent) => void) \| null` | `bindSourceStore` | `null` |

Neither is a `TableOptions` field: `setQuickSearch` is a runtime setter with no construction-time equivalent, exactly like `setRowVisible` and `setExportMenuEnabled`. No `getQuickSearch()` getter is added, for the same reason those two have none.

---

## Internal Structure

Module-local state type, declared next to `WidthReferences` in `Table.ts`:

```typescript
/** The state behind one active {@link Table.setQuickSearch} call. */
interface QuickSearchState {
    /** Trimmed, lower-cased search text. Never `''` — a blank search is stored as `null` instead. */
    needle:    string;
    /** The `fields` argument exactly as passed, or `null` for the default column scope. */
    requested: readonly string[] | null;
    /** The field names actually searched, derived from `requested`. */
    fields:    string[];
    /**
     * Per-record searchable text: every searched field's cell text, lower-cased and
     * joined with `\n`. Built the first time a record is tested and reused on every
     * later render pass — `Body.getVisibleRecords()` re-runs the predicate over the
     * whole store on every frame, so formatting per pass is not affordable.
     */
    cache:     WeakMap<ModelRecord, string>;
}
```

The setter, placed directly after `setRowVisible`:

```typescript
setQuickSearch(text: string | null, fields?: readonly string[] | null): this {
    const needle = (text ?? '').trim().toLowerCase();

    this._quickSearch = needle === '' ? null : {
        needle,
        requested: fields ?? null,
        fields:    this.resolveSearchFields(fields ?? null),
        cache:     new WeakMap(),
    };

    this.applyRowVisible();

    return this;
}
```

Field resolution and matching:

```typescript
private resolveSearchFields(requested: readonly string[] | null): string[] {
    if (requested) {
        return requested.slice();
    }

    return this._resolvedColumns
        .filter(c => c.isFilterable() && columnFilterOperators(c.getField().getType()).includes('contains'))
        .map(c => c.getField().getName());
}

private quickSearchMatches(search: QuickSearchState, record: ModelRecord): boolean {
    let text = search.cache.get(record);

    if (text === undefined) {
        text = search.fields.map(f => this.getCellText(f, record).toLowerCase()).join('\n');

        search.cache.set(record, text);
    }

    return text.includes(search.needle);
}
```

Composition and forwarding — the one place that decides what `Body` sees:

```typescript
private composeRowVisible(): ((record: ModelRecord) => boolean) | null {
    const search = this._quickSearch;
    const custom = this._rowVisible;

    if (!search) {
        return custom;
    }

    const matches = (record: ModelRecord) => this.quickSearchMatches(search, record);

    return custom ? (record: ModelRecord) => matches(record) && custom(record) : matches;
}

private applyRowVisible(): void {
    if (this._displayMode === "normal") {
        this._body.setRowVisible(this.composeRowVisible());
    }
}
```

`setRowVisible` keeps its signature and its rotated-mode guard, but routes through the composer:

```typescript
setRowVisible(predicate: ((record: ModelRecord) => boolean) | null): this {
    this._rowVisible = predicate;
    this.applyRowVisible();

    return this;
}
```

Store-swap rebuild, called from `setStore`:

```typescript
private refreshQuickSearch(): void {
    if (!this._quickSearch) {
        return;
    }

    this._quickSearch = {
        needle:    this._quickSearch.needle,
        requested: this._quickSearch.requested,
        fields:    this.resolveSearchFields(this._quickSearch.requested),
        cache:     new WeakMap(),
    };

    this.applyRowVisible();
}
```

Per-record invalidation, wired alongside the existing source-store subscriptions:

```typescript
// in bindSourceStore, after the four existing store.on(...) calls
const invalidate = (event: StoreUpdateEvent) => this.onSourceRecordUpdate(event);

this._sourceUpdate = invalidate;
store.on('update', invalidate);

// in unbindSourceStore, after the existing forEach
if (this._sourceUpdate) {
    store.off('update', this._sourceUpdate);
}

private onSourceRecordUpdate(event: StoreUpdateEvent): void {
    this._quickSearch?.cache.delete(event.record);
}
```

How a record's cache entry reads, for the column-spec demo's Alice row searched over `['Name', 'Role', 'Manager']`:

| Stored values | Cached text | `dev` | `developer` | `carol dev` |
| --- | --- | --- | --- | --- |
| `Name: "Alice"`, `Role: "dev"`, `Manager: "Carol"` | `alice\ndeveloper\ncarol` | ✓ | ✓ | ✗ — the fields are separated by a newline, which the search box cannot produce |

---

## Ordered Implementation Steps

1. **`Table.ts`** — add the imports the new code needs: `columnFilterOperators` from `~/component/table/ColumnFilter.js`, and `import type { StoreUpdateEvent } from "~/data/AbstractStore.js"`.
2. **`Table.ts`** — add the module-local `QuickSearchState` interface from `## Internal Structure`, directly after the `WidthReferences` interface ([`Table.ts:109-118`](../packages/lib/src/typescript/lib/component/table/Table.ts#L109-L118)).
3. **`Table.ts`** — add `private _quickSearch: QuickSearchState | null = null;` immediately after the existing `_rowVisible` field ([`Table.ts:209`](../packages/lib/src/typescript/lib/component/table/Table.ts#L209)), and `private _sourceUpdate: ((event: StoreUpdateEvent) => void) | null = null;` immediately after `_sourceRefresh` ([`Table.ts:230`](../packages/lib/src/typescript/lib/component/table/Table.ts#L230)).
4. **`Table.ts`** — add the whole quick-search block from `## Internal Structure` in one edit, directly after `setRowVisible`: the public `setQuickSearch`, then the private `resolveSearchFields`, `quickSearchMatches`, `composeRowVisible`, and `applyRowVisible`. They reference each other, so adding them separately leaves the file failing to compile in between. Give `setQuickSearch` a full JSDoc covering: what matches (a case-insensitive substring of the cell's *displayed* text, resolved the same way `getCellText` does); the default column scope and the `fields` override; that it is display-only and composes with `setRowVisible` via AND; that it is neutralized while rotated and has no effect on `TreeTable`; and the cache's freshness rule (text is captured per record when first tested, refreshed when the store reports that record changed, and rebuilt wholesale on the next `setQuickSearch` call). Per [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md), do not `{@link}` a private or `@internal` symbol — describe it in prose.
5. **`Table.ts`** — rewrite `setRowVisible`'s body ([`Table.ts:495-503`](../packages/lib/src/typescript/lib/component/table/Table.ts#L495-L503)) to store the predicate and call `applyRowVisible()`. Extend its JSDoc with one sentence: quick search composes with this predicate via AND, and setting one never clears the other.
6. **`Table.ts`** — change `bindView`'s normal-mode call site ([`Table.ts:463`](../packages/lib/src/typescript/lib/component/table/Table.ts#L463)) to pass `this.composeRowVisible()` in place of `this._rowVisible`. Leave the rotated call site ([`Table.ts:458`](../packages/lib/src/typescript/lib/component/table/Table.ts#L458)) passing `null`.
7. **`Table.ts`** — add the private `refreshQuickSearch()` method from `## Internal Structure`, and call it from `setStore` immediately before `this.getAria().setColCount(...)` ([`Table.ts:555`](../packages/lib/src/typescript/lib/component/table/Table.ts#L555)) — after the body has been re-pointed at the new store, before the closing `doLayout()`.
8. **`Table.ts`** — extend `bindSourceStore` ([`Table.ts:1069-1078`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1069-L1078)) and `unbindSourceStore` ([`Table.ts:1085-1093`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1085-L1093)) with the `'update'` registration from `## Internal Structure`, and add the `onSourceRecordUpdate` handler next to `onSourceStoreChange`. Do not add `'update'` to the existing `_sourceRefresh` list — that callback drives the rotated projection rebuild and must keep firing on exactly the four events it does today.
9. Regression check: `grep -n "this._body.setRowVisible" packages/lib/src/typescript/lib/component/table/Table.ts` — expect exactly one match, inside `applyRowVisible`.
10. **New test file** `packages/lib/tests/component/table/QuickSearch.test.ts` — write the cases in `## Expected Behaviour`, following `RowVisibility.test.ts`'s header comment, `installTestDOM` setup, and `visibleRecords(table)` helper ([`RowVisibility.test.ts:1-57`](../packages/lib/tests/component/table/RowVisibility.test.ts#L1-L57)).
11. **`MiscPanel.ts`** — migrate the wide-table demo ([`MiscPanel.ts:397-440`](../packages/lib/src/typescript/MiscPanel.ts#L397-L440)): delete the `textCache` `WeakMap` and the hand-built predicate, leaving `searchField.on("change", value => { widePanel.getTable().setQuickSearch(value); });`. Change the placeholder from `'Filter (all 45 columns)…'` to `'Filter (every searchable column)…'`, and replace the long comment block with a short one stating what the demo now shows: one call filters on displayed text across every searchable column, the 11 `boolean` columns are skipped because a checkbox cell has no text to match, and the caching that makes it affordable at 400 rows now lives in `Table`. Keep the `searchRow` component and the surrounding `Panel` untouched.
12. **`MiscPanel.ts`** — migrate the column-spec demo ([`MiscPanel.ts:749-767`](../packages/lib/src/typescript/MiscPanel.ts#L749-L767)): keep the `searchField` and the `searchFields` array exactly as they are, and replace the handler body with `specTable.setQuickSearch(value, searchFields);`. Keep the placeholder unchanged — the explicit list makes it accurate. Rewrite the comment to say the demo now shows the *scoped* form of the same call (an explicit field whitelist), and keep the existing note that `Role` matches its label rather than its stored code.
13. **`docs/components/Table.md`** — the four edits listed in `## Documentation Impact`.
14. **`docs/components/TreeTable.md`** — extend the `setRowVisible` non-goal bullet ([`TreeTable.md:144`](../packages/lib/docs/components/TreeTable.md#L144)) to name `setQuickSearch` as inherited and equally inert, for the same reason.
15. **`docs/reference/changelog/next.md`** — add the `setQuickSearch` entry under `## Added` → `### Table` ([`next.md:82-84`](../packages/lib/docs/reference/changelog/next.md#L82-L84)).
16. Run the checks in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/MiscPanel.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/components/TreeTable.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/component/table/QuickSearch.test.ts` |

---

## Expected Behaviour

The test fixture below backs every unit-testable case. Build it once in the new test file:

```typescript
const MODEL = new Model([
    { name: 'name',    type: 'string',   order: 0 },
    { name: 'role',    type: 'string',   order: 1 },
    { name: 'score',   type: 'number',   order: 2 },
    { name: 'active',  type: 'boolean',  order: 3 },
    { name: 'joined',  type: 'date',     order: 4 },
    { name: 'meeting', type: 'time',     order: 5 },
    { name: 'seen',    type: 'datetime', order: 6 },
    { name: 'notes',   type: 'string',   order: 7 },
    { name: 'secret',  type: 'string',   order: 8 },
]);

const SPEC: ColumnSpec = {
    columns: [
        { field: 'role',   values: [{ value: 'dev', label: 'Developer' }, { value: 'qa', label: 'QA Engineer' }] },
        { field: 'notes',  hidden: true },
        { field: 'secret', filterable: false },
    ],
};
```

Three records, each `joined` / `meeting` / `seen` a different instant, and every date in the 2020s so no formatted year can collide with a `score`:

| `name` | `role` | `score` | `active` | `joined` | `notes` | `secret` |
| --- | --- | --- | --- | --- | --- | --- |
| `Alice` | `dev` | `95` | `false` | `2021-03-15` | `top performer` | `zebra` |
| `Bob` | `qa` | `72` | `true` | `2022-08-03` | `follow up` | `walrus` |
| `Carol` | `dev` | `88` | `false` | `2020-12-20` | `on track` | `otter` |

Keep `active: false` on Alice and Carol, mirroring `RowVisibility.test.ts`'s note on the checkbox editor. **Never hardcode a formatted date, time, or datetime string** — derive the expected substring from `table.getCellText('joined', record)` and search a slice of it, so the tests do not depend on the run's locale.

Matching:

1. `setQuickSearch('ali')` leaves only Alice, in store order. **Unit-testable.**
2. `setQuickSearch('ALI')` leaves the same row — matching is case-insensitive in both directions (`setQuickSearch('alice')` against a record storing `'Alice'` also matches). **Unit-testable.**
3. `setQuickSearch('developer')` leaves Alice and Carol: a combo column matches its option **label**, never its stored `'dev'` code. Conversely `setQuickSearch('qa engineer')` leaves only Bob. **Unit-testable.**
4. `setQuickSearch(sub)` where `sub` is a substring of `table.getCellText('joined', alice)` leaves only Alice — a `date` column matches its formatted display text. The same holds for `meeting` (`time`) and `seen` (`datetime`). **Unit-testable.**
5. `setQuickSearch(String(alice.get('score')))` matches Alice — a `number` column is searched. **Unit-testable.**
6. `setQuickSearch('top performer')` matches Alice even though `notes` is `hidden: true` — a hidden column is still searched. **Unit-testable.**
7. `setQuickSearch('zebra')` matches nothing — `secret` is `filterable: false`, so it is outside the default scope. **Unit-testable.**
8. `setQuickSearch('true')` and `setQuickSearch('false')` match nothing — the `boolean` column is outside the default scope. **Unit-testable.**
9. A needle spanning two fields does not match: with Alice's `name` `'Alice'` and `role` label `'Developer'`, `setQuickSearch('alice developer')` leaves no rows, because the cached text joins fields with a newline. **Unit-testable.**

Clearing:

10. `setQuickSearch(null)`, `setQuickSearch('')`, and `setQuickSearch('   ')` each restore every record, from any prior search state. **Unit-testable.**
11. Before any `setQuickSearch` call, every store record renders — the default is no search. **Unit-testable.**

Explicit `fields`:

12. `setQuickSearch('zebra', ['secret'])` matches Alice — an explicitly named field is searched even though its column is `filterable: false`. **Unit-testable.**
13. `setQuickSearch('ali', ['role'])` matches nothing — a field outside the given list is not searched, even though it would be in the default scope. **Unit-testable.**
14. `setQuickSearch('ali', ['nosuchfield'])` matches nothing and throws nothing — an unknown field contributes empty text. **Unit-testable.**
15. `setQuickSearch('ali', [])` matches nothing — an empty list searches no columns. **Unit-testable.**

Composition with `setRowVisible`:

16. With `setQuickSearch('developer')` and `setRowVisible(r => r.get('name') !== 'Carol')` both active, only Alice renders — the two compose with AND, in either call order. **Unit-testable.**
17. From that state, `setQuickSearch(null)` leaves the `setRowVisible` predicate in effect (Alice and Bob render); `setRowVisible(null)` instead leaves the search in effect (Alice and Carol render). Neither call clears the other. **Unit-testable.**

Caching and freshness:

18. With a search active, editing a record inside a store batch — `store.beginEdit()`, `record.set(...)`, `store.commitEdit()`, which emits `'datachange'` but no per-record `'update'` — leaves that row's match state unchanged, because the cached text is what is tested. This pins both the cache's existence and its documented limitation. **Unit-testable.**
19. `record.set(...)` followed by `store.notifyRecordChanged(record)` — what an in-grid edit fires — re-tests that record against its new text: a row edited to no longer match disappears, and a row edited to newly match appears. **Unit-testable.**
20. A record added to the store while a search is active is tested against the search on the next render pass, matching or not on its own text. **Unit-testable.**

Store replacement:

21. With `setQuickSearch('ali')` active, `setStore(otherStore)` where `otherStore` shares the model and holds a record whose `name` contains `'ali'`: that record renders and non-matching records do not. **Unit-testable.**
22. The same call against a store on a *different* model — one whose fields are named differently but where some record's text contains `'ali'` — still matches that record, because the searched field list is re-derived from the new model's columns rather than left pointing at names that no longer exist. **Unit-testable**, and the case that would silently blank the whole table without the re-derive.

Rotated mode:

23. With a search active, `setDisplayMode("rotated")` renders every projection row regardless of the search. **Unit-testable.**
24. Returning to `"normal"` restores the search with no new `setQuickSearch` call; a `setQuickSearch` call made *while* rotated has no immediate effect but takes effect on return. **Unit-testable.**

`TreeTable`:

25. `treeTable.setQuickSearch('x')` leaves `treeTable.getBody().getVisibleRecords()` unchanged — inherited, documented no-op, mirroring the `TreeTable` case in `RowVisibility.test.ts`. **Unit-testable.**

Demo behaviour — **manual verification only** (`npm run dev`, `localhost:8015`):

26. Wide-table demo: typing into the search box filters across the searchable columns, and scrolling with a search active stays smooth (the cache is doing its job).
27. Column-spec demo: typing `developer` leaves the two developer rows; typing a date exactly as the `Joined` cell shows it leaves that row; clearing the box restores every row with selection and pending edits intact.

---

## Verification

From `packages/lib`:

- `npm run typecheck` — zero errors.
- `npm run test` — the new `QuickSearch.test.ts` plus the full suite; `RowVisibility.test.ts` and `RotatedView.test.ts` are the regression check that routing `setRowVisible` through `composeRowVisible` changed nothing when no search is active.
- `npm run docs:api` — zero warnings; the new JSDoc must not `{@link}` a private or `@internal` symbol.
- `npm run lint` — zero new findings.
- `grep -an 'WeakMap' packages/lib/src/typescript/MiscPanel.ts` — expect zero matches; both hand-rolled caches are gone. (Use `grep -a`: this file trips grep's binary heuristic.)
- `grep -an 'setRowVisible(' packages/lib/src/typescript/MiscPanel.ts` — expect zero matches; both demos now call `setQuickSearch`.
- `grep -n "this._body.setRowVisible" packages/lib/src/typescript/lib/component/table/Table.ts` — expect exactly one match, in `applyRowVisible`.
- `grep -n "setQuickSearch" packages/lib/docs/components/Table.md packages/lib/docs/components/TreeTable.md packages/lib/docs/reference/changelog/next.md` — expect at least one match in each.
- **Manual smoke** (`npm run dev`, then `localhost:8015`, MiscPanel): open **Show window with wide table (45 columns)!** and **Show window with table (column spec)!** and run behaviour cases 26 and 27.

---

## Documentation Impact

- **`packages/lib/docs/components/Table.md`**
  - *Common methods* ([`Table.md:347-360`](../packages/lib/docs/components/Table.md#L347-L360)) — add a `setQuickSearch(text, fields?)` row directly above the `setRowVisible(predicate)` row: "Hide rows whose displayed cell text does not contain `text`."
  - New `## Quick search` section, inserted directly **before** `## Row visibility` ([`Table.md:362`](../packages/lib/docs/components/Table.md#L362)) — keep the existing `## Row visibility` heading and its anchor intact, since `TreeTable.md` and the changelog link to `#row-visibility`. The new section carries: a short example (`searchBox.on("change", value => table.setQuickSearch(value))`); the searched-column table from `## Architecture Decisions`; a bullet that it matches what is on screen (combo labels, formatted dates) via the same resolution `getCellText` and the filter row use; a bullet that a column with a custom `renderer` matches its **stored** value, since the renderer declares no text the table can resolve — the same limitation the filter row already documents; a bullet that fields are joined with a newline, so a needle cannot span two columns; a **Gotchas**-style bullet that quick search and `setRowVisible` compose with AND and neither clears the other; a bullet that the searchable text of each record is captured when first tested and refreshed when the store reports that record changed, so a bulk edit committed through `store.beginEdit()` / `commitEdit()` (which emits no per-record `'update'`) needs `setQuickSearch` to be called again; and the neutralized-while-rotated / no-effect-on-`TreeTable` bullets.
  - *Row visibility* ([`Table.md:362-383`](../packages/lib/docs/components/Table.md#L362-L383)) — replace the hand-rolled quick-search example with a plain custom-predicate example (e.g. `table.setRowVisible(record => record.get('status') === 'open')`), and open the section with one sentence pointing at `## Quick search` for the text-search case. Keep the display-only, re-applied-automatically, rotated, and `TreeTable` bullets, and add the AND-composition bullet.
  - *Rotated record view* ([`Table.md:182`](../packages/lib/docs/components/Table.md#L182)) — extend the existing `setRowVisible` bullet to say `setQuickSearch` is neutralized and restored the same way.
  - *Column filters* ([`Table.md:211`](../packages/lib/docs/components/Table.md#L211)) — add one bullet distinguishing the two: a column filter is a query the store evaluates (and may send to a remote proxy, changing `getRecords()`), while quick search is display-only and never reaches the store.
- **`packages/lib/docs/components/TreeTable.md`** — extend the `setRowVisible` non-goal bullet ([`TreeTable.md:144`](../packages/lib/docs/components/TreeTable.md#L144)) to cover `setQuickSearch`, which is inherited through the same predicate slot and equally inert.
- **`packages/lib/docs/reference/changelog/next.md`** — under `## Added` → `### Table`, beside the existing `Table.getCellText` entry: `setQuickSearch(text, fields?)` filters rows on displayed cell text, replacing the hand-rolled `setRowVisible` + cache pattern; note the default column scope and that it composes with `setRowVisible`.
- **`packages/lib/llms.txt`** — no change. It is generated from `scripts/llms/manifest.data.mjs` and indexes components, not methods; `Table` is already listed and points at `docs/components/Table.md`.
- **TypeDoc** — `Table` is already barrel-exported, so `setQuickSearch`'s JSDoc renders with no export change.

---

## Potential Challenges

- **A custom `renderer` column matches its stored value, not what it draws.** `getCellText` resolves through `TableExporter.formatValue`, which knows about combo `values` and temporal types but not a consumer's renderer. *Mitigation:* documented as a bullet, matching the identical, already-documented limitation of the filter row; not worked around.
- **A `glyph` column matches its stored glyph name.** There is no visible text to match, but the filter row offers Contains for `glyph`, so the default scope includes it for consistency. *Mitigation:* one clause in the searched-column doc bullet; a consumer who does not want it passes `fields`.
- **A batch edit leaves cached text stale.** `store.beginEdit()` / `commitEdit()` emits only `'datachange'`, with no per-record `'update'` ([`AbstractStore.ts:964-978`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L964-L978)), so those records keep the text they were cached with. *Mitigation:* documented; calling `setQuickSearch` again rebuilds the cache wholesale.
- **The composed predicate captures the state object, not the field.** `composeRowVisible` reads `this._quickSearch` once and closes over that object, so a later `setQuickSearch` call must re-run `applyRowVisible` for the new state to take effect — which every mutation path in this plan does. *Mitigation:* the only writers of `_quickSearch` are `setQuickSearch` and `refreshQuickSearch`, and both end in `applyRowVisible()`.
- **The demo app serves the main tree's `packages/lib`.** A dev server started inside a worktree still resolves the package to the main checkout. *Mitigation:* run the manual smoke from the tree the change actually lives in, or symlink `node_modules` first.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts) — `setRowVisible` (`:495`), `bindView` (`:1391`) and its two call sites (`:458`, `:463`), `getCellText` (`:1808`), `setStore` (`:533`), `bindSourceStore` / `unbindSourceStore` (`:1069`, `:1085`), and the `WidthPolicy` / `WidthReferences` module-local interfaces (`:102`, `:109`).
- [`packages/lib/src/typescript/lib/component/table/Header.ts`](../packages/lib/src/typescript/lib/component/table/Header.ts) — `:1193` and `:1215`, the `isFilterable()` + `columnFilterOperators()` pair the default column scope mirrors.
- [`packages/lib/src/typescript/lib/component/table/ColumnFilter.ts`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts) — `columnFilterOperators` (`:119`) and the per-type operator lists (`:64-77`), which decide which columns offer Contains.
- [`packages/lib/src/typescript/lib/component/table/Column.ts`](../packages/lib/src/typescript/lib/component/table/Column.ts) — `isFilterable()` (`:222`) and how `Column.resolve` folds `ColumnSpec.filterable` into it (`:57`).
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](../packages/lib/src/typescript/lib/component/table/Body.ts) — `getVisibleRecords()` (`:370`) and `setRowVisible` (`:656`): the single predicate slot, and why changing it forces a re-render.
- [`packages/lib/src/typescript/lib/data/AbstractStore.ts`](../packages/lib/src/typescript/lib/data/AbstractStore.ts) — `StoreUpdateEvent` (`:80`), `notifyRecordChanged` (`:940`), `commitEdit` (`:964`).
- [`packages/lib/tests/component/table/RowVisibility.test.ts`](../packages/lib/tests/component/table/RowVisibility.test.ts) — the harness, helpers, and structure the new test file mirrors.
- [`packages/lib/src/typescript/MiscPanel.ts`](../packages/lib/src/typescript/MiscPanel.ts) — the two demos being migrated (`:397-440`, `:749-767`).
- [`plans/implemented/table-row-visibility.md`](implemented/table-row-visibility.md) — the predicate this feature composes with, and the rotated / `TreeTable` reasoning it inherits.

---

## Non-Goals

- **A `getQuickSearch()` getter.** Not required by either demo; this codebase does not pair every runtime setter with a getter (`setRowVisible` and `setExportMenuEnabled` have none).
- **Search options beyond `fields`** — no whole-word mode, no per-column operator, no regex, no explicit case-sensitivity switch. Substring, case-insensitive, is what both demos do and what the filter row's Contains does.
- **A search box component.** The consumer supplies the `TextField` and calls the setter; the demos keep their own search rows.
- **Subtree-aware search for `TreeTable`.** Same non-goal, and the same reasoning, as `setRowVisible`'s: a bare per-record test cannot decide what happens to a hidden parent's children.
- **Making quick search visible to `getRecords()`, aggregates, or export.** Those read the store's own view; quick search is display-only by construction, exactly like `setRowVisible`.
- **Invalidating cached text on a bulk edit.** `store.commitEdit()` reports no record identities, so the only available response would be dropping the whole cache — the cost the cache exists to avoid.
- **A `TablePanel` delegate.** `TablePanel` forwards only the export trio; `setRowVisible` is already reached through `getTable()`, and the wide-table demo does the same for `setQuickSearch`.

---

## Notes

[^naming]: "Search", not "filter": *filter* is already taken in this component by the store-backed column filter row — `setFilterRowVisible`, `ColumnConfig.filterable`, `buildColumnFilter` — which does something materially different (it writes through `store.setFilter`, changes `getRecords()`, and can reach a remote proxy). Naming this one `setQuickFilter` would put two unrelated mechanisms one word apart. "Quick search" is already the term the codebase uses for exactly this feature, in `Table.md:364`, in `Table.setRowVisible`'s and `getCellText`'s own JSDoc (`Table.ts:472`, `Table.ts:1800`), and in `CellTextResolver`'s class comment (`CellText.ts:55`) — so the method name simply adopts the vocabulary the docs already teach. The `setX` verb and the "no paired getter" shape follow `setRowVisible`, `setColumnVisible`, `setFilterRowVisible`, and `setExportMenuEnabled`.

[^default-scope]: Three candidate defaults were weighed. *Visible columns only* was rejected because `getCellText` is explicitly built the other way — its JSDoc states it resolves against every resolved column "so a quick search built on this method still matches a column the user has toggled off" — and because hiding a column to reclaim width should not silently narrow what a search finds. *Every resolved column, no screen at all* was rejected because a `boolean` column renders a checkbox with no text, yet `getCellText` reports `'true'` / `'false'` for it: searching `true` would match rows on text nobody can see. The filter row already encodes the right answer — `BOOLEAN_OPERATORS` omits `contains` entirely (`ColumnFilter.ts:77`), so a user setting every column's operator to Contains would get exactly the set this screen produces. Routing through `columnFilterOperators` rather than hardcoding `type !== 'boolean'` keeps one authority: if a type's operator list ever changes, the search scope follows it. The screen keys on the field's declared type, not on whether the column is a combo — the same thing the filter row's own operator menu does.

[^explicit-fields]: The alternative — applying the `filterable` / Contains screen to an explicit list too — was rejected because it would silently drop a column the caller named, with no way to override. A caller passing `fields` has already decided; the screen only exists to pick a sensible default when they have not. The empty-array case follows the same rule literally ("search these zero columns"), matching `buildComboFilter`'s existing convention that zero matches builds `in []` — a filter that matches no row — rather than being reinterpreted as "no filter" (`ColumnFilter.ts:373-374`).

[^compose-in-table]: Two alternatives were rejected. *A thin wrapper* — `setQuickSearch` simply building a predicate and calling `setRowVisible` — is the smallest change, but the two would share one slot: an app that filters to open tickets with `setRowVisible` would silently lose that filter the moment the user typed in the search box, and typing again would restore neither. *A second predicate slot on `Body`* would work but costs a new `Body` field, a new `Body` setter with its own invalidate-and-render dance, a ninth `bindView` parameter, and a matching `TreeBody` doc update — all so `getVisibleRecords()` can `&&` two predicates that `Table` can just as easily `&&` itself. Composing in `Table` needs no change outside `Table.ts` and leaves `Body`'s contract exactly as documented. The composed closure is rebuilt only when one of the two predicates is set, never per render pass, so the extra allocation is per keystroke rather than per frame.

[^rotated-tree]: Both behaviours fall out of routing through the same slot, so neither needed a decision so much as a check that the inherited behaviour is right here. Rotated: the projection is one row per *field* of one record, so a per-record needle test has nothing to apply to — the same reason `setRowVisible` and `rowReadOnly` are already neutralized there. `TreeTable`: `TreeBody.getVisibleRecords()` fully overrides the base and never reads the predicate slot (`TreeBody.ts:510`), so a search is stored and ignored — the documented non-goal, because a flat per-record test cannot decide whether a hidden parent's children stay, drop, or re-parent.

[^cache-placement]: A separate helper class (a `QuickSearch.ts` sibling, in the style of `TableExporter.ts` / `ColumnFilter.ts`) was considered and rejected. Those two are extracted because they are *shared* — `ColumnFilter` is called from `Header` and from the barrel's public surface, `TableExporter` from two `Table` methods — and because they are pure functions over data passed in. This cache is used by exactly one caller and depends on `Table`'s live state (`_resolvedColumns`, `_columnConfigs`, `_cellText`, all of which `getCellText` already reads), so extracting it would either duplicate that resolution or hand the helper a back-reference to the `Table` — more surface for no reuse, against this project's "no abstractions for single-use code" rule. Keeping it in `Table.ts` next to `getCellText` also means the text stays resolved live: field names are stored as strings, so nothing goes stale when columns are re-resolved. The cached value is one joined string per record rather than one string per field, because the wide-table demo holds 400 records over 34 searchable columns — 400 strings instead of 13,600. The join uses `\n` rather than a space so a needle typed into a single-line search box can never span a column boundary.

[^update-invalidation]: The alternative was to accept staleness, as both hand-rolled demos do today, and document it. It was rejected because `Table.md` already promises that a row filter is "re-applied automatically" on store events including `datachange`, and `RowVisibility.test.ts` pins that an edited record is re-tested — a quick search that silently opted out of that promise would diverge from its neighbour in a way nobody would notice until a user edited a cell mid-search. Dropping the whole cache on `'datachange'` was also rejected: that event fires for adds, removes, sorts, and syncs, and each one would re-format every record on the next pass — the exact cost the cache exists to avoid. The `'update'` event is the precise instrument: it carries the one record that changed, so invalidation is a single `WeakMap.delete`. Ordering is safe in both directions — `notifyRecordChanged` emits `'update'` before `'datachange'`, so the entry is gone before the render that re-tests it.

[^set-store]: Doing nothing here was rejected as an outright bug rather than a wart: `setStore` re-resolves `_resolvedColumns` against the new model, but a search built before the swap holds field names from the old one. Against a different model every record's searchable text would resolve to empty, no row would match, and the table would look empty with no explanation. Clearing the search instead was also rejected: for the common case of re-running a query over the same shape, it would drop a search the user can still see typed in their box. Re-deriving keeps both cases right — same shape means the search simply keeps working, different shape means it is rebuilt against the columns that now exist — for one method and one call site. The fresh `WeakMap` is part of the rebuild because the searched field list may have changed.

---

## Implementation Notes

- **`QuickSearch.test.ts`'s fixture keeps `active: false` on every record, including Bob**, where `## Expected Behaviour`'s table calls for `active: true`. Running the fixture as written throws `ReferenceError: MouseEvent is not defined` from `Body.onSubtreeClick`, via `Checkbox.setSelected`'s synthetic-click path — the exact gap `RowVisibility.test.ts` and `RotatedView.test.ts` both document and route around by keeping every record's `active` `false` in this harness. No case in `## Expected Behaviour` reads Bob's actual boolean value; the only assertions touching the `active` column search whether the literal text `'true'`/`'false'` matches (case 8), which is unaffected by which record holds which value. Fixed by mirroring the established precedent instead of the plan's literal table.
- **The `## Verification` grep `grep -n "this._body.setRowVisible" … — expect exactly one match, inside applyRowVisible` finds two matches, not one**: `applyRowVisible` (new) and `bindView`'s own internal `this._body.setRowVisible(rowVisible)` (pre-existing, at `Table.ts` around line 1601, untouched by any step in `## Ordered Implementation Steps`). `bindView` has exactly two callers — the rotated-mode branch (passing `() => true`) and the normal-mode branch (passing `composeRowVisible()`, per step 6) — so its internal call always forwards an already-composed predicate; `Body` never sees a raw, uncomposed one either way. The invariant the check exists to guard holds; the check's literal expected count does not. Left as-is rather than papered over, since collapsing the two call sites was not sanctioned by any `## Architecture Decisions` entry and was not needed to make the invariant hold.
