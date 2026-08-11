---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Table.ts
  - packages/lib/src/typescript/lib/component/table/Header.ts
  - packages/lib/src/typescript/lib/component/table/ColumnFilter.ts
---

# Cell Display Text — Implementation Plan

## Overview

A table cell's **display text** — the string the user actually reads in the cell — is computed today in four unrelated places: each `CellRenderer` subclass computes it inside `setValue` ([`renderer/Combo.ts:74`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts#L74), [`renderer/Time.ts:33`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts#L33), …), `TableExporter.formatValue` re-derives the temporal half of it ([`TableExporter.ts:99`](../packages/lib/src/typescript/lib/component/table/TableExporter.ts#L99)), `Table.formatRotatedValueText` re-derives the combo half ([`Table.ts:1805`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1805)), and the demo app hand-copies both ([`MiscPanel.ts:679`](../packages/lib/src/typescript/MiscPanel.ts#L679)). The column filter row re-derives none of it, and filters the raw stored value instead — which is why two filters are broken today.

This plan adds one authoritative accessor, `CellRenderer.getDisplayText()`, computed from state the renderer already caches in `setValue`, and routes every other site through it. A new `@internal` `CellTextResolver` holds the small pool of unmounted renderers those sites format through, mirroring [`CellEditorPool`](../packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L42).

Two filter bugs fall out of that unification. A combo column filters on its **label** instead of its stored code, so `Role`'s `filterable: false` workaround ([`MiscPanel.ts:626`](../packages/lib/src/typescript/MiscPanel.ts#L626)) and the matching Table.md gotcha are both removed. A `time` / `date` / `datetime` column accepts the text it displays and equality means "displays the same", so typing `09:30:20` into a time filter stops being a silent no-op.

---

## Architecture Decisions

### `getDisplayText()` is a concrete method on `CellRenderer`, defaulting to the empty string

[`CellRenderer`](../packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L16) gains `getDisplayText(): string`, returning `""` by default. Every built-in text renderer overrides it to return the exact string its `setValue` pushed into the child `Text`. It reads cached state only — never the DOM — so it is correct on a renderer that was constructed, fed a value, and never rendered.[^concrete-not-abstract]

### `CellEditor` mirrors `getDisplayText()`, exactly as it already mirrors `getContentX()`

[`CellEditor.getContentX`](../packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts#L152) exists purely so a `CellEditor` stays structurally assignable to a `CellRenderer` — `BooleanCell` passes a `BooleanEditor` into the renderer slot ([`cell/Boolean.ts:24`](../packages/lib/src/typescript/lib/component/table/cell/Boolean.ts#L24)). Adding a member to one base and not the other breaks that pass, so `CellEditor` gets the same `getDisplayText(): string { return ""; }` with the same explanatory JSDoc.[^editor-mirror]

### An owner-held `CellTextResolver` pools the renderers the non-cell call sites format through

New file [`cell/CellText.ts`](../packages/lib/src/typescript/lib/component/table/cell/CellText.ts) exports `CellTextResolver`: a keyed cache of at most one unmounted renderer per variant, lazily built, `dispose()`d by its owner. `Table` and `TableHeader` each own one and dispose it in their `destructor`. This mirrors `CellEditorPool` — a per-table keyed cache of reusable cell components, disposed from `Body.destructor` ([`CellEditorPool.ts:120`](../packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L120)).[^owner-held-not-module-singleton]

Each pooled renderer is `pauseLayout()`d at construction ([`Component.ts:5349`](../packages/lib/src/typescript/lib/core/Component.ts#L5349)), because `Text.setText` schedules a layout on its parent and these renderers are never in a rendered tree.[^pause-layout]

### The renderer-per-variant switch moves out of `DynamicCell` and becomes the shared factory

`DynamicCell.buildRenderer` ([`Dynamic.ts:225`](../packages/lib/src/typescript/lib/component/table/cell/Dynamic.ts#L225)) already maps a `CellType` to the renderer that draws it. It moves to `CellText.ts` as `buildCellRenderer(type, showSeconds, numberAlign?)`, and `DynamicCell.buildRenderer` becomes a one-line delegate passing `"left"`. One authority for "which renderer draws this variant", no behaviour change.

### Renderer-driven resolution happens once, on the main thread, at filter-build time

`FilterDescriptor` / `matchesFilter` / `AbstractStore` live in `data/`, which imports nothing from `component/` — verified across the whole directory. `matchesFilter` also runs inside a Web Worker for stores of 1000+ records ([`AbstractStore.ts:1875`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1875), [`StoreWorker.ts:67`](../packages/lib/src/typescript/lib/data/StoreWorker.ts#L67)), where no DOM and no `CellRenderer` exist at all.

So `buildColumnFilter` resolves display text on the main thread and emits only plain descriptors built from the variants that already exist. Nothing new crosses into `data/`, and every descriptor this plan can produce survives structured clone. This is a hard constraint with a named verification checkpoint (see [Verification](#verification)).

### Substring and equality operators match display text; ordering operators stay value-typed

`contains` / `startsWith` / `endsWith` / `eq` / `neq` answer "does the cell read like this". `gt` / `gte` / `lt` / `lte` keep comparing parsed values against the raw stored value.[^ordering-stays-typed]

### A combo column's display domain is its declared `values`, resolved into an `in` set

A column that declares `ColumnConfig.values` ([`ColumnConfig.ts:162`](../packages/lib/src/typescript/lib/component/table/ColumnConfig.ts#L162)) has a small, declared set of possible values. `buildColumnFilter` runs each declared value through a pooled `ComboRenderer`, keeps the ones whose display text matches the typed text, and emits `{ type: 'in', field, values: [matched raw values] }` — `neq` wraps that in `not`. Zero matches emits `in []` (matches no row), never `null` (which would mean "no filter" and show every row).

Case handling is unchanged from today's documented rule: the three substring operators are case-insensitive, `eq` / `neq` are exact.

Worked cases for `{ field: 'Role', values: [{ value: 'dev', label: 'Developer' }, { value: 'qa', label: 'QA Engineer' }, { value: 'pm', label: 'Project Manager' }] }`:

| Operator | Typed | Labels matched | Descriptor |
|---|---|---|---|
| `contains` | `eng` | QA Engineer | `{ type: 'in', field: 'Role', values: ['qa'] }` |
| `startsWith` | `pro` | Project Manager | `{ type: 'in', field: 'Role', values: ['pm'] }` |
| `eq` | `Developer` | Developer | `{ type: 'in', field: 'Role', values: ['dev'] }` |
| `eq` | `developer` | — | `{ type: 'in', field: 'Role', values: [] }` |
| `neq` | `Developer` | Developer | `{ type: 'not', filter: { type: 'in', field: 'Role', values: ['dev'] } }` |
| `contains` | `zzz` | — | `{ type: 'in', field: 'Role', values: [] }` |

### Equality on a temporal column is the interval of instants that display identically

A `date` / `time` / `datetime` cell's display is lossy: a `date` cell hides the time of day, and a `time` cell without `showSeconds` hides the seconds. Instant equality against a typed operand therefore almost never matches what the user sees. `eq` compiles to the half-open interval of instants that render the same text, as `{ type: 'and', filters: [gte lo, lt hi] }`; `neq` wraps that `and` in `not`. The interval width comes from the same `type` + `showSeconds` pair the renderer formats with.[^display-bucket]

| Column | Operator | Typed | Descriptor |
|---|---|---|---|
| `time`, `showSeconds: true` | `eq` | `09:30:20` | `and(gte 1970-01-01 09:30:20, lt 1970-01-01 09:30:21)` |
| `time`, `showSeconds: false` | `eq` | `09:30` | `and(gte 1970-01-01 09:30:00, lt 1970-01-01 09:31:00)` |
| `date` | `eq` | `2021-05-17` | `and(gte 2021-05-17 00:00, lt 2021-05-18 00:00)` |
| `time` | `gt` | `10:00` | `{ type: 'gt', value: 1970-01-01 10:00:00 }` |
| `date` | `gte` | `not-a-date` | `null` — no filter, unchanged |

### A `time` operand is parsed as a time of day anchored to 1970-01-01

`parseOperand` currently hands every temporal type to `new Date(text)`, and `new Date("09:30:20 AM")` is `Invalid Date`, so a `time` filter silently applies nothing. For `time` it first tries `HH:MM[:SS]` with an optional AM/PM suffix and builds `new Date(1970, 0, 1, h, m, s)` — the same normalization [`TimeEditor`](../packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts#L209) commits and documents — falling back to `new Date(text)` when that shape does not match. `date` and `datetime` keep the native parse.[^time-anchor]

### `TableExporter.formatValue` gains combo resolution, and keeps passing everything else through untouched

`formatValue` reformats a value only when the renderer would show something other than `String(value)`: a combo column (label instead of code) and a temporal column (locale text instead of a `Date`). Every other value — a number, a boolean, a string, `null` — is returned unchanged, so JSON export keeps its types and a boolean column keeps exporting `true` / `false`.[^formatvalue-passthrough]

### `Table.getCellText(field, record)` is the public surface over the same mechanism

The demo app needs the cell's text and cannot reach `@internal` helpers. `Table` gains `getCellText(field, record): string`, resolved against `_resolvedColumns` so a hidden column still answers, returning `''` for an unknown field. This is what the quick-search demos call, replacing their hand-rolled formatting.

### The `Role` workaround and the Table.md gotcha are removed, not left behind

`filterable: false` on `MiscPanel`'s `Role` column and its three-line comment are deleted, as is the Table.md bullet stating that a filter matches the stored value rather than the displayed one. Both exist only to describe the bug this plan fixes. The custom-`renderer` half of that bullet survives in reworded form — a custom renderer's column has no declared domain to enumerate, so it keeps filtering the stored value.

---

## Public API

```typescript
// component/table/cell/renderer/CellRenderer.ts
abstract class CellRenderer<T> extends Component {
    getDisplayText(): string;                      // new; default ""
}

// component/table/cell/editor/CellEditor.ts
abstract class CellEditor<T> extends Component {
    getDisplayText(): string;                      // new; structural mirror, always ""
}

// component/table/Table.ts
class Table extends Component<TableOptions> {
    getCellText(field: string, record: ModelRecord): string;   // new
}
```

```typescript
// component/table/cell/CellText.ts — new file, @internal, NOT added to the barrel

/** Builds the renderer that draws a cell of this variant. */
export function buildCellRenderer(
    type:         CellType,
    showSeconds:  boolean,
    numberAlign?: "left" | "right",                // default "right"
): CellRenderer<any>;

/** Owner-held pool of unmounted renderers used to format values off-screen. */
export class CellTextResolver {
    text(
        type:        CellType,
        showSeconds: boolean,
        values:      Array<ComboOption | string> | undefined,
        value:       any,
    ): string;
    dispose(): void;
}
```

```typescript
// component/table/ColumnFilter.ts — buildColumnFilter's signature changes

/** What a column contributes to its own filter build. */
export interface ColumnFilterTarget {
    type:         FieldType;
    values      ?: Array<ComboOption | string>;
    showSeconds ?: boolean;
}

export function buildColumnFilter(
    field:   string,
    target:  ColumnFilterTarget,                   // was: type: FieldType
    state:   ColumnFilterState,
    display: CellTextResolver,                     // new
): FilterDescriptor | null;
```

```typescript
// component/table/Header.ts
class TableHeader extends Component {
    setColumnConfigs(configs: Map<string, ColumnConfig>): this;   // new; mirrors Body.setColumnConfigs
}

// component/table/TableExporter.ts — a display resolver joins each signature
class TableExporter {
    static exportCSV(columns, records, columnConfigs, display: CellTextResolver, options?): void;
    static exportJSON(columns, records, columnConfigs, display: CellTextResolver, options?): void;
    static formatValue(column, value, columnConfigs, display: CellTextResolver): any;   // @internal
}
```

---

## Internal Structure

`CellTextResolver` caches one renderer per variant key and reuses it:

```typescript
export class CellTextResolver {

    private _renderers    : Map<string, CellRenderer<any>>               = new Map();
    private _comboOptions : Array<ComboOption | string> | null          = null;

    text(type: CellType, showSeconds: boolean, values: Array<ComboOption | string> | undefined, value: any): string {
        const key      = showSeconds ? `${type}:seconds` : type;
        let   renderer = this._renderers.get(key);

        if (!renderer) {
            renderer = buildCellRenderer(type, showSeconds);
            // Never parented, never rendered: keep its Text writes from
            // enqueuing a layout pass for a component nothing will lay out.
            renderer.pauseLayout();
            this._renderers.set(key, renderer);
        }

        if (type === 'combo' && values && values !== this._comboOptions) {
            (renderer as ComboRenderer).setOptions(values);
            this._comboOptions = values;
        }

        renderer.setValue(value);

        return renderer.getDisplayText();
    }

    dispose(): void {
        for (const renderer of this._renderers.values()) {
            renderer.dispose();
        }

        this._renderers.clear();
        this._comboOptions = null;
    }
}
```

The temporal interval, written so the `date` case survives a DST boundary (calendar arithmetic, not `+86_400_000`):

```typescript
/** The half-open [lo, hi) span of instants a column of this shape renders identically. */
function displayBucket(type: 'date' | 'time' | 'datetime', showSeconds: boolean, operand: Date): { lo: Date; hi: Date } {
    if (type === 'date') {
        const lo = new Date(operand.getFullYear(), operand.getMonth(), operand.getDate());
        const hi = new Date(operand.getFullYear(), operand.getMonth(), operand.getDate() + 1);

        return { lo, hi };
    }

    const lo = new Date(operand.getFullYear(), operand.getMonth(), operand.getDate(),
                        operand.getHours(), operand.getMinutes(), showSeconds ? operand.getSeconds() : 0);
    const hi = new Date(lo.getTime() + (showSeconds ? 1_000 : 60_000));

    return { lo, hi };
}
```

---

## Ordered Implementation Steps

Each step is test-first: write the cases named in `## Expected Behaviour` for that step, watch them fail, then make them pass.

1. **`renderer/CellRenderer.ts`** — add `getDisplayText(): string { return ""; }` with JSDoc stating it returns the text the cell shows, is computed from cached state (never the DOM), and is therefore safe on an unmounted renderer. → verify: `npm run typecheck` clean.

2. **`editor/CellEditor.ts`** — add the mirroring `getDisplayText(): string { return ""; }` directly below `getContentX` ([line 152](../packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts#L152)), reusing that method's structural-compatibility JSDoc wording. → verify: typecheck, and `packages/lib/tests/component/table/cell/BooleanCell.test.ts` still passes (it exercises the editor-as-renderer pass).

3. **Override `getDisplayText` in each built-in renderer.** For the seven renderers that own a `Text` child, add a private `_display: string = ""` field, assign it in `setValue` from the same expression already passed to `this._text.setText(...)` (compute once, use twice), and return it. The two structural renderers compute from what they already cache instead:
   - `String.ts:55`, `Number.ts:61` — `this._value === null ? "" : String(this._value)`.
   - `Date.ts:30`, `Time.ts:33`, `DateTime.ts:32` — the existing `toLocale*` expression.
   - `Combo.ts:74` — the existing `this._map.get(key) ?? key`, `""` for `null`.
   - `Link.ts:97` — same shape as `String.ts`.
   - `Glyph.ts:43` — no `Text` child; return `this._value === null ? "" : String(this._value)` (the registry name is the cell's only textual handle, and it is what CSV export writes today).
   - `TreeCell.ts:141` — `return this._delegate.getDisplayText();`.
   - `renderer/Filter.ts` — **no override**; a filter cell has no data value, so the base `""` is correct.
   → verify: new renderer test cases (see `## Expected Behaviour`).

4. **Create `cell/CellText.ts`** with `buildCellRenderer` (moved verbatim from `DynamicCell.buildRenderer`, plus the `numberAlign` parameter defaulting to `"right"`) and `CellTextResolver` as shown in `## Internal Structure`. Mark both `@internal`. Do **not** add either to `component/table/index.ts`. → verify: new `CellText.test.ts`.

5. **`cell/Dynamic.ts`** — replace the body of the private static `buildRenderer` ([line 225](../packages/lib/src/typescript/lib/component/table/cell/Dynamic.ts#L225)) with `return buildCellRenderer(type, showSeconds, "left");`, keeping its JSDoc's note about why numbers are left-aligned here. → verify: `packages/lib/tests/component/table/cell/DynamicCell.test.ts` and `RotatedView.test.ts` unchanged and green.

6. **`TableExporter.ts`** — add a `display: CellTextResolver` parameter to `formatValue`, `exportCSV`, and `exportJSON`. Rewrite `formatValue`'s body to:
   - return `value` unchanged when it is `null` / `undefined`;
   - when the column's config declares a non-empty `values`, return `display.text('combo', false, config.values, value)`;
   - otherwise return `value` unchanged unless it is a `Date` **and** the field type is `date` / `time` / `datetime`, in which case return `display.text(type, config?.showSeconds ?? false, undefined, value)`.
   Update the class JSDoc: it now also resolves combo labels. → verify: updated `TableExporter.test.ts`.

7. **`Table.ts`** — add `private _cellText: CellTextResolver = new CellTextResolver();`, dispose it in `destructor` ([line 1264](../packages/lib/src/typescript/lib/component/table/Table.ts#L1264)) before `super.destructor()`, and pass it at every `TableExporter` call site: `exportCSV` ([1390](../packages/lib/src/typescript/lib/component/table/Table.ts#L1390)), `exportJSON` ([1404](../packages/lib/src/typescript/lib/component/table/Table.ts#L1404)), `formatRotatedValueText` ([1822](../packages/lib/src/typescript/lib/component/table/Table.ts#L1822)), `collectCandidates` ([1850](../packages/lib/src/typescript/lib/component/table/Table.ts#L1850)), `dateReferenceKeys` ([2042](../packages/lib/src/typescript/lib/component/table/Table.ts#L2042)). Leave `formatRotatedValueText`'s own combo branch alone — it passes an empty config map deliberately, for the reason its comment gives. → verify: typecheck; `RotatedView.test.ts` and `ColumnWidths.test.ts` green except the combo-width case updated in step 13.

8. **`Table.ts`** — add `getCellText(field, record): string`: look the field up in `this._resolvedColumns`, return `''` when absent, else `String(TableExporter.formatValue(col, record.get(field), this._columnConfigs, this._cellText) ?? '')`. JSDoc must describe the behaviour in prose rather than `{@link}`ing the `@internal` helpers. → verify: new `Table.test.ts` cases.

9. **`Header.ts`** — add `private _columnConfigs: Map<string, ColumnConfig> = new Map();` and `setColumnConfigs(configs): this` (mirroring [`Body.setColumnConfigs`](../packages/lib/src/typescript/lib/component/table/Body.ts#L628)); add `private _cellText: CellTextResolver = new CellTextResolver();` and dispose it in `destructor` ([line 1357](../packages/lib/src/typescript/lib/component/table/Header.ts#L1357)). Add a private `filterTarget(fieldName): ColumnFilterTarget | null` returning `{ type, values, showSeconds }` from the model field plus the config, or `null` when the field is unknown. → verify: typecheck.

10. **`Table.ts`** — call `this._header.setColumnConfigs(...)` in both places the body is already told: the constructor's spec branch ([line 257](../packages/lib/src/typescript/lib/component/table/Table.ts#L257)) and `bindView` ([line 1234](../packages/lib/src/typescript/lib/component/table/Table.ts#L1234), beside `this._body.setColumnConfigs(configs)`). → verify: `grep -n 'setColumnConfigs' packages/lib/src/typescript/lib/component/table/Table.ts` — expect four hits, two per target.

11. **`ColumnFilter.ts`** — export `ColumnFilterTarget`; change `buildColumnFilter`'s second parameter to it and add the fourth `display` parameter. Add, in this order inside the function, after the existing `isEmpty` / `isNotEmpty` / blank-text branches:
    - **combo branch** — when `target.values` is non-empty and the operator is `contains` / `startsWith` / `endsWith` / `eq` / `neq`, resolve as described in `## Architecture Decisions` and return the `in` / `not`-`in` descriptor;
    - **temporal equality branch** — when `target.type` is `date` / `time` / `datetime` and the operator is `eq` / `neq`, parse the operand, return `null` if it fails to parse, else build `displayBucket` and return the `and` / `not`-`and` descriptor;
    - everything else falls through to today's `parseOperand` + switch, unchanged.
    Extend `parseOperand`'s `time` case with the anchored `HH:MM[:SS] [AM|PM]` parse before its `new Date(text)` fallback. → verify: rewritten `ColumnFilter.test.ts`.

12. **`Header.ts`** — update both `buildColumnFilter` call sites to the new signature: `applyPendingFilter` ([line 1008](../packages/lib/src/typescript/lib/component/table/Header.ts#L1008)) and `onStoreFilterChange` ([line 1038](../packages/lib/src/typescript/lib/component/table/Header.ts#L1038)), each passing `this.filterTarget(fieldName)` (skipping the field when it is `null`) and `this._cellText`. → verify: `grep -rn 'buildColumnFilter(' packages/lib/src/typescript/` — every call passes four arguments.

13. **Tests** — create `CellText.test.ts` and update the seven existing test files listed in `## Files to Create / Modify / Delete`, per `## Expected Behaviour`. → verify: `npm test`.

14. **`MiscPanel.ts`** — delete `roleLabels` ([line 679](../packages/lib/src/typescript/MiscPanel.ts#L679)) and `formatDateLike` ([line 684](../packages/lib/src/typescript/MiscPanel.ts#L684)); rewrite the spec-table predicate to `fields.some(f => specTable.getCellText(f, record).toLowerCase().includes(needle))` over `['Name', 'Role', 'Notes', 'Manager', 'Joined', 'Meeting', 'LastSeen']`. In the wide-table demo ([line 425](../packages/lib/src/typescript/MiscPanel.ts#L425)) replace the inline `f.type === 'date' ? … : String(raw)` expression with `widePanel.getTable().getCellText(f.name, record)`, keeping its per-keystroke `WeakMap` cache untouched. Delete `filterable: false` and its three-line comment from the `Role` column ([line 626](../packages/lib/src/typescript/MiscPanel.ts#L626)), and rewrite the two filter-row comments that referenced the workaround (lines 615-620 and 656-660). → verify: `grep -an 'formatDateLike\|roleLabels\|filterable: false' packages/lib/src/typescript/MiscPanel.ts` — expect zero matches.

15. **Docs** — apply `## Documentation Impact`. → verify: `npm run docs:api` finishes with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/table/cell/CellText.ts` |
| Create | `packages/lib/tests/component/table/cell/CellText.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Glyph.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Dynamic.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/ColumnFilter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TableExporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/MiscPanel.ts` |
| Modify | `packages/lib/tests/component/table/cell/renderer.test.ts` |
| Modify | `packages/lib/tests/component/table/ColumnFilter.test.ts` |
| Modify | `packages/lib/tests/component/table/ColumnFilterRow.test.ts` |
| Modify | `packages/lib/tests/component/table/TableExporter.test.ts` |
| Modify | `packages/lib/tests/component/table/ColumnWidths.test.ts` |
| Modify | `packages/lib/tests/component/table/Table.test.ts` |
| Modify | `packages/lib/tests/unit/data/FilterDescriptor.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases below are unit-testable offline. The only manual check is the browser smoke test in `## Verification`.

### `getDisplayText()` — `packages/lib/tests/component/table/cell/renderer.test.ts`

The file already reads rendered text through a `renderedText(renderer)` helper that reaches into the private `_text` child. Add, per renderer, an assertion that `getDisplayText()` equals that helper's result, so the two can never drift:

1. `StringRenderer` after `setValue('Alice')` → `'Alice'`; after `setValue(null)` → `''`; after `setValue(undefined)` → `''`.
2. `NumberRenderer` after `setValue(0)` → `'0'` (not `''`); after `setValue(null)` → `''`.
3. `DateRenderer`, `TimeRenderer(false)`, `TimeRenderer(true)`, `DateTimeRenderer(false)`, `DateTimeRenderer(true)` — assert relationally against the same `toLocale*` call the test file already uses, never a hard-coded locale literal.
4. `ComboRenderer([{ value: 'dev', label: 'Developer' }])` after `setValue('dev')` → `'Developer'`; after `setValue('unknown')` → `'unknown'` (out-of-set values fall back to the raw value); after `setValue(null)` → `''`.
5. `ComboRenderer` after `setOptions` with a new list re-resolves the cached value's text.
6. `GlyphRenderer` after `setValue('xmark')` → `'xmark'`; after `setValue(null)` → `''`.
7. `LinkCellRenderer` after `setValue('people')` → `'people'`.
8. `TreeCellRenderer(new StringRenderer())` after `setValue('leaf')` → `'leaf'` (delegates).
9. A renderer that is constructed, fed a value, and never rendered still answers — no `getElement`, no `render()`, no parent. Assert `getDisplayText()` is correct on such an instance for `ComboRenderer` and `TimeRenderer`.
10. `FilterCellRenderer` returns `''` (base default) even with text in its input.
11. `new BooleanEditor().getDisplayText()` returns `''` — the structural mirror.

### `CellTextResolver` — `packages/lib/tests/component/table/cell/CellText.test.ts` (new)

12. `buildCellRenderer('number', false)` returns a right-aligned `NumberRenderer`; `buildCellRenderer('number', false, 'left')` a left-aligned one.
13. `buildCellRenderer` returns the matching class for `date`, `time`, `datetime`, `combo`, `glyph`, and a `StringRenderer` for `string` / `auto` / any unrecognised variant.
14. `text('combo', false, [{ value: 'qa', label: 'QA Engineer' }], 'qa')` → `'QA Engineer'`.
15. Two calls for the same variant reuse one renderer instance (assert the resolver's cache size, or that the same instance is handed back by a private read) — no per-value allocation.
16. Switching the combo option list between calls re-resolves against the new list.
17. `text('time', true, undefined, d)` differs from `text('time', false, undefined, d)`, and each equals the matching `TimeRenderer`'s own output.
18. `dispose()` empties the cache; a `text` call after `dispose()` rebuilds rather than throwing.

### `buildColumnFilter` — `packages/lib/tests/component/table/ColumnFilter.test.ts`

Every existing case in this file must be rewritten to the new signature (`{ type: 'string' }` in place of `'string'`, plus a resolver built in `beforeEach` and disposed in `afterEach`) and must still assert the same descriptor. Then add:

19. Every combo case in the `## Architecture Decisions` table, asserted exactly.
20. `isEmpty` / `isNotEmpty` on a combo column still emit the raw-empties `in` / `not`-`in` descriptor — they test the stored value's emptiness, not a label.
21. `gt` on a combo column declared over a `number` field ignores the labels and emits `{ type: 'gt', value: <number> }`.
22. Every temporal case in the `## Architecture Decisions` table, asserted exactly.
23. `eq` on a `time` column with `09:30 AM`, `09:30`, and `9:30 am` all produce the same `and(gte, lt)` pair.
24. `eq` on a `time` column with unparseable text (`half past nine`) returns `null`.
25. `eq` on a `date` column produces an interval one *calendar* day wide: `lo` is local midnight, `hi` is local midnight on the following date (assert via `getDate()` / `getHours()`, so the case still passes in a timezone where that day is 23 or 25 hours long).
26. **Worker safety:** for each descriptor the builder can emit — `in`, `not`-`in`, `and(gte, lt)`, `not`-`and`, `contains`, `eq`, `gt` — `structuredClone(descriptor)` succeeds, and `matchesFilter(record, clone)` returns the same answer as `matchesFilter(record, descriptor)`.

### Filter row end to end — `packages/lib/tests/component/table/ColumnFilterRow.test.ts`

The file's `MODEL` has no combo or temporal column; add a second model/spec fixture with a `string` field carrying `values` and a `time` field carrying `showSeconds: true`, and reuse the existing `makeTable` / `typeInto` / `pickOperator` / `visibleRecords` helpers.

27. Typing `Developer` into the combo column's filter and flushing the debounce leaves only the records whose stored value is `'dev'` visible. This case fails today, leaving no rows at all.
28. Typing `eng` with `Contains` leaves only the `'qa'` records.
29. Typing `Zzz` into the combo column leaves no rows visible — not every row.
30. Clearing the combo column's input restores every row.
31. Typing the exact displayed time of a record (built relationally from `TimeRenderer`'s own output for that record's value, never a locale literal) with the default `Equals` operator leaves only that record visible. This case fails today, leaving every row visible because the operand never parses.
32. Typing a time with `Greater than` leaves only the later records.
33. The `isEmpty` operator on the combo column still selects the records whose stored value is empty.
34. A combo column with no `filterable: false` is offered the `string` operator set — confirming the removed workaround is not needed.

### Export and width sampling

35. `TableExporter.test.ts` — `formatValue` on a column whose config declares `values` returns the label for a known value, the raw value for an unknown one, and `null` for `null`.
36. `TableExporter.test.ts` — every existing case still holds: `null` / `undefined` pass through, a non-`Date` value on a temporal column passes through unchanged, a number stays a number, and each temporal format still equals the matching `toLocale*` call.
37. `ColumnWidths.test.ts` — under `autoSizeColumns: true`, a combo column with records present now samples its **labels**, so its derived width reflects `'Project Manager'` rather than `'pm'`. Update case 17's neighbours accordingly.

### `Table.getCellText` — `packages/lib/tests/component/table/Table.test.ts`

38. Returns the combo label for a combo column, the locale-formatted string for a `date` / `time` / `datetime` column (asserted relationally), and `String(value)` for a plain column.
39. Returns `''` for a `null` field value and for an unknown field name.
40. Returns text for a column hidden via `hidden: true` — a quick search must still see it.

### Data layer — `packages/lib/tests/unit/data/FilterDescriptor.test.ts`

41. `matchesFilter` against `{ type: 'and', filters: [{ gte, lo }, { lt, hi }] }` over `Date` values includes `lo`, excludes `hi`, and includes an instant between them — pinning the half-open semantics the builder now depends on.
42. `matchesFilter` against `{ type: 'not', filter: { type: 'in', field, values: [] } }` matches every record — pinning the `neq`-with-no-matches case.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — every case in `## Expected Behaviour` green, and the existing table, rotated-view, dynamic-cell, and boolean-cell suites unchanged.
- **Layering checkpoint (named, must be run and reported):**
  - `grep -rn '~/component' packages/lib/src/typescript/lib/data/` — expect zero matches.
  - `grep -rn 'CellRenderer\|CellTextResolver\|getDisplayText\|buildCellRenderer' packages/lib/src/typescript/lib/data/` — expect zero matches.
  - Behaviour case 26 above is the runtime half of the same checkpoint: every descriptor the builder emits survives `structuredClone` and evaluates identically after it, so the worker path is unaffected.
- `grep -rn 'buildColumnFilter(' packages/lib/src/typescript/` — every call passes four arguments.
- `grep -an 'formatDateLike\|roleLabels\|filterable: false' packages/lib/src/typescript/MiscPanel.ts` — zero matches. (Use `grep -a`; the file trips grep's binary heuristic.)
- `grep -rn 'toLocaleDateString\|toLocaleTimeString\|toLocaleString' packages/lib/src/typescript/lib/component/table/` — today this reports nine hits: six in `cell/renderer/Date.ts` / `Time.ts` / `DateTime.ts` (three of them JSDoc prose) and three in `TableExporter.ts`. Afterwards only the six renderer hits remain.
- `npm run docs:api` — zero warnings.
- **Manual smoke** (`npm run dev`, `localhost:8015`, the MiscPanel **Table** demo): show the filter row, type `Developer` into `Role` and confirm only the two developer rows remain; type the `Meeting` time exactly as the cell shows it and confirm only that row remains; type a partial time and confirm no filter is applied rather than a wrong one; export CSV and confirm the `Role` column carries labels; type in the quick-search box and confirm role labels and dates still match on displayed text.

---

## Documentation Impact

- **`packages/lib/docs/components/Table.md`**
  - *Column filters* — delete the bullet stating that a filter matches the stored value rather than the displayed one, and replace it with the new rule: a combo column filters on its **label**, and a column with a custom `renderer` still filters on the stored value because it declares no option domain to resolve against.
  - *Column filters* — replace the "Equals on a temporal column matches the exact instant" bullet: equality now matches every value that **displays** the same, so a `date` column's `Equals` covers the whole calendar day and a `time` column's covers the displayed minute (or second, under `showSeconds`). Drop the now-unnecessary "use At least / Less than for a whole day" advice.
  - *Column filters* — add a bullet on `time` operands: type the time as displayed (`09:30`, `09:30:20`, `09:30 AM`); the operand is anchored to 1970-01-01, matching the normalization the time cell editor commits, so a `time` field whose stored values carry a different date anchor will not match.
  - *Combo columns* — add a bullet: the header filter row matches the label, not the stored value.
  - *Exporting* — extend the "match what the user sees" paragraph: combo columns now export their **label**, not the stored code. Flag it as a behaviour change for anyone re-importing an export.
  - *Common methods* — add a `getCellText(field, record)` row.
  - *Row visibility* — mention `getCellText` as the way to build a quick search that matches what is on screen.
- **`packages/lib/docs/reference/changelog/next.md`** — under *Added*: `CellRenderer.getDisplayText()` and `Table.getCellText(field, record)`. Under *Fixed*: combo columns are filterable and their filter matches the label; a `time` column's filter accepts the displayed time instead of silently applying nothing; a combo column's auto-sized width measures its labels. Under *Changed*: `Equals` on a temporal column now matches by displayed value rather than exact instant, and CSV / JSON export writes a combo column's label rather than its stored code.
- **TypeDoc** — `CellRenderer` is exported from the table barrel, so `getDisplayText`'s JSDoc renders. Per [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md), it must not `{@link}` `CellTextResolver`, `buildCellRenderer`, or `TableExporter.formatValue` — all `@internal` or unexported. Describe them in prose.
- **`packages/lib/llms.txt`** — no change; no new component is added.

---

## Potential Challenges

- **A pooled renderer schedules layout for a component nothing lays out.** `Text.setText` calls `scheduleLayout()` on its parent. Mitigated by `pauseLayout()` on every renderer the resolver builds, which makes `scheduleLayout` an early return.
- **Adding a member to `CellRenderer` without mirroring it on `CellEditor` breaks `BooleanCell`.** The failure is a compile error at `cell/Boolean.ts:24`, not a runtime surprise — step 2 exists solely to prevent it, and it must land in the same change as step 1.
- **`formatValue` must not start stringifying everything.** Routing all values through a renderer would turn JSON-exported numbers into strings and blank a boolean column (its "renderer" is a checkbox with no text). The pass-through rule in step 6 is what prevents it; behaviour case 36 pins it.
- **A combo value outside the declared `values` set is not reachable by a label filter.** The renderer falls back to showing the raw value, but the declared domain is what the filter enumerates. Documented as a limitation in the Table.md combo bullet; not worked around.
- **A `time` field whose stored values are not anchored to 1970-01-01** compares across different days and gives wrong answers for both equality and ordering. Documented in Table.md; it is the same anchor the time cell editor already writes.
- **`ColumnFilter.test.ts` is rewritten wholesale by the signature change.** Every existing case must keep asserting the same descriptor, so a mechanical signature update — not a rewrite of intent.
- **Rotated mode reaches the filter build through a different config map.** `bindView` passes `_rotatedConfigs` while rotated; step 10 wires `setColumnConfigs` inside `bindView` precisely so the header follows the same map the body does. `RotatedView.test.ts` covers the round trip.

---

## Critical Files

- [`cell/renderer/CellRenderer.ts`](../packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts) — the base gaining `getDisplayText`.
- [`cell/editor/CellEditor.ts:141-154`](../packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts#L141) — the `getContentX` mirror whose JSDoc and shape step 2 copies.
- [`cell/editor/CellEditorPool.ts`](../packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts) — **the precedent** for `CellTextResolver`: an owner-held, keyed cache of reusable cell components, lazily built and disposed from its owner's destructor.
- [`ColumnConfig.ts:38`](../packages/lib/src/typescript/lib/component/table/ColumnConfig.ts#L38) — `normalizeComboOptions`, the existing "one authoritative computation shared by renderer and editor" in this subsystem, and the function `ComboRenderer` builds its label map from.
- [`cell/Dynamic.ts:200-246`](../packages/lib/src/typescript/lib/component/table/cell/Dynamic.ts#L200) — the variant-to-renderer switch being promoted, and its lazy-cache shape.
- [`ColumnFilter.ts`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts) — the pure filter-build module this plan extends.
- [`Header.ts:987-1047`](../packages/lib/src/typescript/lib/component/table/Header.ts#L987) — `applyPendingFilter` / `onStoreFilterChange`, the two build call sites.
- [`Body.ts:620-660`](../packages/lib/src/typescript/lib/component/table/Body.ts#L620) — `setColumnConfigs`, the setter `TableHeader.setColumnConfigs` mirrors.
- [`data/FilterDescriptor.ts`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts) — the descriptor algebra and `matchesFilter`; read it to confirm no new variant is needed.
- [`data/StoreWorker.ts`](../packages/lib/src/typescript/lib/data/StoreWorker.ts) and [`data/AbstractStore.ts:1875`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1875) — the worker path the layering checkpoint protects.
- [`cell/editor/Time.ts:195-226`](../packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts#L195) — the time-of-day parse and 1970-01-01 anchor `parseOperand` mirrors.

---

## Non-Goals

- **No new `FilterDescriptor` variant.** Everything this plan emits composes existing variants (`in`, `and`, `not`, `gte`, `lt`), so the worker, the remote-filter serializer, and `matchesFilter` need no change. A time-of-day comparison operator would be a data-layer feature in its own right.
- **No display-text filtering for columns with no declared domain.** A `string`, `number`, `auto`, or `glyph` column's display text already equals `String(value)`, so its filter is unchanged; a column with a custom `ColumnConfig.renderer` has no enumerable set of values to resolve against, so it keeps filtering the stored value.
- **No scan of the store to discover a column's value domain.** Enumerating distinct stored values at filter-build time would put an O(records) main-thread pass on every debounced keystroke — precisely the work the worker offload exists to avoid.
- **Ordering operators are not routed through display text.** `gt` / `gte` / `lt` / `lte` keep comparing a parsed operand against the raw stored value, for the reasons given under *Substring and equality operators match display text; ordering operators stay value-typed*.
- **`columnFilterOperators` is not changed.** A combo column declared over a `number` or temporal field keeps that type's ordering operators, which compare raw values. The natural combo field type is `string`, which is offered the substring set already.
- **`Table.resolveContentCandidates`' combo branch and `formatRotatedValueText`'s combo branch are left alone.** The first maps a whole option list to labels for width measurement — a different operation from formatting one value — and the second deliberately passes an empty config map for the reason its comment states.
- **No `CellText.ts` export from the package barrel.** `CellTextResolver` and `buildCellRenderer` are `@internal`; `Table.getCellText` is the consumer-facing surface.

---

## Notes

[^concrete-not-abstract]: An abstract `getDisplayText` would be a breaking change for every consumer-authored `CellRenderer` subclass, and `ColumnConfig.renderer` is a documented public seam with a shipped example (`LinkCellRenderer`). A concrete `""` default keeps those compiling. `""` is also the honest answer for a renderer that draws no text — the base cannot know what a consumer's chart or badge renderer "reads as". Every built-in renderer overrides it, so the default is never what the framework's own call sites see.

[^editor-mirror]: `BooleanCell` passes a `BooleanEditor` into `Cell`'s renderer slot, which only typechecks because `CellRenderer` and `CellEditor` expose the same member set — the reason `CellEditor.getContentX` exists at all, and the reason `CellRenderer`'s constructor inlines its padding closure rather than declaring a private method. `DynamicCell` additionally casts a `BooleanEditor` through `unknown` for the same slot. The mirror is one line and keeps both sites compiling. Returning `""` is correct: a checkbox displays a state, not text, and the filter row never routes a `boolean` column through display text.

[^owner-held-not-module-singleton]: A module-level singleton resolver was considered and rejected. Renderers mint DOM-sink elements at construction, and the offline test harness resets the sink between tests (`DOM.reset()`), so a process-wide cache built in one test would hand a later test renderers holding released handles — the same class of cross-test leak already documented for the viewport-listener map. Owner-held instances are disposed with their owner, so each test gets clean ones, and `CellEditorPool` already establishes the shape.

[^pause-layout]: `Text.setText` ends with `(this.getParentComponent() ?? this).scheduleLayout()`, which adds the pooled renderer to the global pending-layout set and schedules a flush. The flush would then lay out a component with no element and no bounds — harmless but pointless, and it fires on every export cell and every filter keystroke. `pauseLayout()` makes `scheduleLayout` return immediately, so the pooled renderers never enter the pending set at all.

[^ordering-stays-typed]: Three reasons, any one sufficient. Lexical order over display text is simply wrong: `"10:00 AM" < "9:00 AM"` and `"10/1/2021" < "9/2/2021"` as strings. A combo column's labels carry no order at all, so `gt` over labels has no meaning to preserve. And mechanically, `matchesFilter` evaluates `gt` / `gte` / `lt` / `lte` with JavaScript's relational operators against the raw stored value — a display-text match can only be expressed as an `in` set, and an `in` set cannot express an open-ended range. Ordering therefore stays on the parsed-operand path, which the anchored `time` parse also fixes for free.

[^display-bucket]: Instant equality against typed text is unusable on a temporal column, and not only for `time`. A `date` column holding `new Date('2021-05-17T14:30')` never equals a typed `2021-05-17` (which parses to midnight); a `time` column displaying `09:30` never equals a typed `09:30` when the record holds `09:30:20`. Both are the same defect: the cell shows less precision than it stores, so "equals what I see" is a range, not a point. Deriving the range width from the same `type` + `showSeconds` pair the renderer formats with keeps the two definitions from drifting. Programmatic `store.setFilter(field, { type: 'eq', value: someDate })` is untouched — only the filter row's build step changes.

[^time-anchor]: `new Date("09:30:20 AM")` is `Invalid Date`, and `parseOperand` turns an unparseable operand into a `null` descriptor, which `setFilter` reads as "remove this column's filter" — so the column silently shows every row. The anchored parse mirrors `TimeEditor.onInput` and `TimeEditor.onTimeSelected`, both of which build `new Date(1970, 0, 1, h, m, s)`, and `TimeEditor`'s class JSDoc states the convention outright ("the date portion is normalised to 1970-01-01 local"). The fallback to `new Date(text)` is retained so an ISO operand still works. `date` and `datetime` keep the native parse because their displayed forms are full dates that the native parser handles.

[^formatvalue-passthrough]: `formatValue`'s existing contract — pinned by tests asserting that `null`, `undefined`, a plain string on a date column, and a number all come back unchanged — is what keeps JSON export typed and a boolean column exporting `true` / `false` rather than the empty string a checkbox "renders". Routing a temporal column's non-`Date` value through `DateRenderer.setValue` would additionally throw, since that setter calls `toLocaleDateString` on whatever it is handed. The combo branch is added ahead of the existing `value instanceof Date` guard and the guard itself is left exactly as it is.

---

## Implementation Notes

Three small deviations from the plan text, none architectural:

- **Dropped one planned changelog line.** `## Documentation Impact` asked for a *Fixed* entry stating "a combo column's auto-sized width measures its labels." Investigation during implementation (`Table.samplesRecordText` / `Table.resolveContentCandidates`, both explicitly left alone by `## Non-Goals`) confirmed this behaviour is pre-existing — shipped by the earlier `table-generated-column-widths` work (`ColumnWidths.test.ts` case 17 predates this branch; `git log` shows it landing in commit `23fbc1fb`), not something this plan changes. Framing it as *Fixed* here would misattribute it, so the line was omitted; the other two changelog entries this plan does own (combo filter, `time` filter) were kept.
- **Exported `ColumnFilterTarget` from the package barrel** (`component/table/index.ts`), alongside its siblings `ColumnFilterOperator` / `ColumnFilterState`. The plan's `## Public API` section declares the type but doesn't say to add it to the barrel; leaving it out would make the already-barrel-exported `buildColumnFilter`'s new required parameter type unreferenceable by a consumer importing from the package entry point.
- **Added a `typedoc.json` `externalSymbolLinkMappings` entry** (`"CellTextResolver": "#"`) after `npm run docs:api` flagged `buildColumnFilter`'s `display: CellTextResolver` parameter as "referenced but not included in the documentation" — the same warning class `Component.onFirstLayout` already carries a documented fix pattern for elsewhere in this file. `CellTextResolver` stays `@internal` and off the barrel exactly as `## Non-Goals` specifies; the mapping only suppresses the docs-build warning, matching this project's own precedent (`MouseEvent` mapping in the same file) rather than exporting the type.

One incident, unrelated to the code above: while spot-checking a `docs:api` baseline, a `git stash`/`git stash pop` was run by mistake in the **main working tree** instead of this worktree. It found the main tree already clean, so nothing of this session's was lost — but it also unearthed and dropped a pre-existing stash entry that predated this session (four new plan files: `table-scroll-first-visit-cost.md`, `table-scroll-recycling-cost.md`, `table-tab-close-residual-leak.md`, `table-toolbar-button-residual-leak.md`, plus an untracked `plans/rotated-view-column-groups.md`). That content was immediately re-stashed (`git stash push -u`) to restore the main tree to its original clean state; the content is intact but now sits under a new stash message rather than its original one. Flagged here for visibility since it affected the main tree, not this branch.
