---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Table.ts
  - packages/lib/src/typescript/lib/layout/Table.ts
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/src/typescript/lib/core/Util.ts
---

# Generated-Table Column Widths — Implementation Plan

## Overview

A `Table` built from a schema its author never saw — the motivating case is SQLAdmin, which generates one table per database table or view — gets badly sized columns. Nothing in the current pipeline looks at the column's type beyond three coarse buckets, and nothing looks at the data: the layout manager gives every `boolean` column 60 px, every `number` column 90 px, and splits whatever is left equally between the string columns ([packages/lib/src/typescript/lib/layout/Table.ts:309](packages/lib/src/typescript/lib/layout/Table.ts#L309)). A 45-column result set therefore renders every column at one of four widths, none of which reflects what the column holds.

This plan replaces the four buckets with a **per-type width policy**. Each column's floor and starting width are computed from what its cells actually render: a `boolean` cell is a 16 px checkbox, a `date` cell is one formatted date, a `number` cell is a run of digits. Those three types need no data at all. Only `string` and `auto` columns are genuinely open-ended, and for those an opt-in **auto-size** mode (`ColumnSpec.autoSizeColumns`) measures a bounded sample of the values the column holds.

The policy also produces a **minimum** width per column, not just a starting one. Today six call sites read `col.getMinWidth() ?? 30` directly, so a narrow window or a drag can crush a checkbox column to 30 px and clip the checkbox. All six route through one new accessor, `Table.getColumnMinWidth`.

Text measurement is the expensive part of all of this, and the plan makes it cheap: a new batched seam method measures a whole list of strings in one document reflow instead of one reflow per string.[^probe-cost]

The change is confined to how widths are **first derived** and how low they may be squeezed. The arithmetic that redistributes width afterwards — `rescaleWidths`, `absorbSlackIntoGreedy`, `trimToTarget`, and the drag handler `onColumnResize` — keeps its current shape; those methods only swap their inline `?? 30` for the new accessor.[^sibling-scope]

---

## Architecture Decisions

### One derivation, owned by the `Table` component

`Table` gains a public `getIntrinsicColumnWidths()` that returns one entry per visible column, and the layout manager consumes it instead of computing widths itself. `Table.defaultColumnWidth` is deleted; its callers route through the new method.[^one-derivation]

This mirrors the existing layout seam: [`Table.getColumnWidths` / `setColumnWidths`](packages/lib/src/typescript/lib/component/table/Table.ts#L412) are already public methods documented as "called by the layout manager", and [layout/Table.ts:106](packages/lib/src/typescript/lib/layout/Table.ts#L106) already reaches into the container for `getColumns()` and `getHeader()`. The new method is one more read on that same seam.

### Width comes from a per-type policy

Every column gets a `{ min, preferred }` pair from a policy chosen by its field type. Four of the seven types render content of a shape the library already knows, so their policy consults no data:

| Type | What the cell renders | Content width |
|---|---|---|
| `boolean` | a 16 px checkbox ([Checkbox.ts:65](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L65)) | fixed |
| `glyph` | one icon-font glyph | fixed |
| `date`, `time`, `datetime` | one `toLocale*` string | fixed per `(type, showSeconds)` |
| `number` | digits, sign, separators | digit count × digit width |
| `string`, `auto` | anything | needs the data |

Only the last row needs a sample, so only `string` and `auto` columns pay for one.[^type-policy]

### The type policy applies whether or not auto-size is on

The four data-free policies run for every table, including tables that never set `autoSizeColumns`. They cost no data access and they fix clipping that exists today.[^unconditional]

`autoSizeColumns` gates one thing only: whether `string` and `auto` columns read the store to size themselves. With the flag off, a `string` column stays a flex column that shares the leftover space, exactly as today.

### A derived minimum, read through one accessor

`Table.getColumnMinWidth(col)` returns the column's declared `minWidth`, or the type policy's floor when none is declared. Six sites that currently inline `col.getMinWidth() ?? 30` call it instead: [layout/Table.ts:334](packages/lib/src/typescript/lib/layout/Table.ts#L334) and [:435](packages/lib/src/typescript/lib/layout/Table.ts#L435), and [Table.ts:771](packages/lib/src/typescript/lib/component/table/Table.ts#L771), [:783](packages/lib/src/typescript/lib/component/table/Table.ts#L783), [:1243](packages/lib/src/typescript/lib/component/table/Table.ts#L1243) and [:1245](packages/lib/src/typescript/lib/component/table/Table.ts#L1245).

`getColumnMinWidth` runs on the drag path, once per column per `mousemove`, so it must not touch the DOM. It reads constants and a small cached bundle of reference measurements; it never samples the store.[^min-accessor]

There is no matching derived **maximum**. A column's `maxWidth` stays declared-only.[^no-derived-max]

### Text is measured in batches, not one string at a time

A new seam method, `DOM.source.measureTextWidths(texts, options)`, measures a whole list in one document reflow. [`ProductionDOMSource.measureText`](packages/lib/src/typescript/lib/core/DOM.ts#L1893) appends a probe span to `document.body`, reads `getBoundingClientRect()`, then removes it — so measuring N strings one at a time forces N full style-and-layout passes over the page, inside `doLayout`. The batched version appends all N probes once, reads all N rects with no mutation in between, and removes them once.[^probe-cost]

A whole derivation costs **at most three** batched calls: one for the shared reference strings, one for the header labels (bold, header font), one for the sampled body text (normal weight, body font). Two calls are needed for the fonts because one call carries one font.

### Content sampling: bounded, and filtered by length before it is measured

At most 50 records are read, by index rather than by copying the store. Per column the three longest strings by character count are kept in a single pass, and only those three are measured.[^sample-shape]

Values become display text through [`TableExporter.formatValue`](packages/lib/src/typescript/lib/component/table/TableExporter.ts#L97), which already exists to "format a raw cell value the same way the matching cell renderer does" — it becomes non-private for this second caller.

Measuring data to size a container is established practice here: [`ComboBoxDropdown.measureWidestLabel`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L309) measures every option label and clamps the result between a floor and a ceiling to size the dropdown.

### Schema hints: `width` and `maxContentLength` on `ColumnConfig`

A generating consumer states what it knows through two new per-column fields: `width` (an explicit pixel width) and `maxContentLength` (the longest value the column can hold, in characters — a `varchar(60)` column passes `60`). An enum needs no new field: a column that already declares `values` is measured from its option labels.[^hints]

### Widths re-derive once, when data first arrives

A generated table is usually built before its store has loaded, so the first derivation sees no rows. `Table` therefore re-derives widths on the first store event that finds records, and never again for that store.[^resample]

### `TablePanel` forwards a spec

[`TablePanel`](packages/lib/src/typescript/lib/component/table/TablePanel.ts#L40) constructs its inner table as `new Table(store)` and accepts no spec, so a `TablePanel` consumer cannot reach any column configuration at all. Its constructor gains an optional second `spec` parameter, forwarded to the `Table`.[^tablepanel]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/DOM.ts — the DOMSource interface (beside measureText, line 988)

interface DOMSource {
    /**
     * Measures many strings under one font in a single document reflow.
     * Returns one width per input, in input order; an empty input list
     * touches the DOM not at all and returns an empty array.
     */
    measureTextWidths(texts: string[], options?: TextMeasureOptions): number[];
}
```

```typescript
// packages/lib/src/typescript/lib/core/Util.ts (beside measureTextWidth, line 84)

export function measureTextWidths(texts: string[], options?: TextMeasureOptions): number[];
```

```typescript
// packages/lib/src/typescript/lib/component/table/ColumnConfig.ts

export interface ColumnConfig {
    // ...existing fields unchanged...

    /** Explicit starting width in pixels, clamped into the column's width envelope. */
    width            ?: number;
    /** Longest value this column can hold, in characters (e.g. `varchar(60)` → `60`). */
    maxContentLength ?: number;
}

export interface ColumnSpec {
    // ...existing fields unchanged...

    /** When `true`, `string` and `auto` columns are sized from sampled cell values. */
    autoSizeColumns ?: boolean;
}
```

```typescript
// packages/lib/src/typescript/lib/component/table/Column.ts

class Column {
    getWidth():            number | undefined;   // backing field _width
    getMaxContentLength(): number | undefined;   // backing field _maxContentLength
}
```

```typescript
// packages/lib/src/typescript/lib/component/table/Table.ts

class Table extends Component<TableOptions> {
    /** `true` when the spec enables auto-size AND the table is in normal (non-rotated) mode. */
    isAutoSizeColumns(): boolean;

    /**
     * The column's declared `minWidth`, or the floor its field type implies.
     * Cheap enough for the drag path — reads cached reference measurements,
     * never the store.
     */
    getColumnMinWidth(column: Column): number;

    /**
     * One entry per visible column, in display order. A number is a definite
     * starting width; `null` means "no definite width — share the remaining
     * space", which only happens for a `string`/`auto` column with auto-size off.
     */
    getIntrinsicColumnWidths(): Array<number | null>;
}
```

```typescript
// packages/lib/src/typescript/lib/component/table/TablePanel.ts

class TablePanel extends Container {
    constructor(store: AbstractStore, spec?: ColumnSpec);
}
```

```typescript
// packages/lib/src/typescript/lib/component/table/TableExporter.ts

class TableExporter {
    /** @internal — no longer private; the width sampler formats values through it. */
    static formatValue(column: Column, value: any, columnConfigs: Map<string, ColumnConfig>): any;
}
```

---

## Internal Structure

### Batched measurement

`ProductionDOMSource.measureTextWidths` mirrors the probe styling of `measureText` ([DOM.ts:1893](packages/lib/src/typescript/lib/core/DOM.ts#L1893)) but builds one wrapper holding one child span per string:

```typescript
measureTextWidths(texts: string[], options: TextMeasureOptions = {}): number[] {
    if (texts.length === 0) {
        return [];
    }

    // Same font-option defaults as measureText; omitted here for brevity —
    // the implementer copies that destructuring block verbatim.
    const wrapper = document.createElement("div");

    _applyProbeStyles(wrapper, { position: "fixed", visibility: "hidden", whiteSpace: "nowrap" });

    const probes = texts.map(text => {
        const probe = document.createElement("span");

        _applyProbeStyles(probe, {
            display: "inline-block", whiteSpace: "nowrap",
            fontFamily, fontSize, fontWeight, fontStyle, fontVariant, fontStretch,
        });

        probe.textContent = text;
        wrapper.appendChild(probe);

        return probe;
    });

    document.body.appendChild(wrapper);

    // One layout flush: the first read forces it, and nothing mutates the DOM
    // between reads, so the rest are served from the same computed layout.
    const widths = probes.map(p => Math.ceil(p.getBoundingClientRect().width));

    document.body.removeChild(wrapper);

    return widths;
}
```

`TestDOM.measureTextWidths` delegates to its existing per-character advance model ([TestDOM.ts:902](packages/lib/tests/dom/TestDOM.ts#L902)):

```typescript
measureTextWidths(texts: string[], options?: TextMeasureOptions): number[] {
    return texts.map(t => this.measureText(t, options).width);
}
```

`Util.measureTextWidths` is a one-line forward to `DOM.source.measureTextWidths`, matching `Util.measureTextWidth` at [Util.ts:84](packages/lib/src/typescript/lib/core/Util.ts#L84).

### Constants (all in `component/table/Table.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `MIN_COLUMN_WIDTH_PX` | 30 | Absolute floor. No policy minimum ever falls below it. |
| `CHECKBOX_WIDTH_PX` | 16 | The checkbox box edge, mirroring [Checkbox.ts:65](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L65). |
| `GLYPH_WIDTH_PX` | 20 | One icon-font glyph square at the default body font, plus slack. |
| `MIN_NUMBER_DIGITS` | 4 | Digits a `number` column must always fit, so it never becomes unreadable. |
| `DEFAULT_NUMBER_DIGITS` | 8 | Digits assumed for a `number` column with neither a sample nor a hint. |
| `MIN_STRING_CHARS` | 8 | Characters a `string` column must always fit. Stops the squeeze-to-30 px case. |
| `STRING_WIDTH_PX` | 100 | Starting width for a flex column that needs a concrete number (show/hide, reset). |
| `HEADER_CHROME_PX` | 21 | 4 px cell padding + 5 px resize-handle gutter + 12 px sort indicator (today's inline `21`). |
| `CELL_CHROME_PX` | 6 | 4 px cell padding (`theme.table.cell.padding` is 2 per side) + 2 px so the last glyph is not flush against the next column's border. |
| `AUTO_WIDTH_CAP_PX` | 400 | Ceiling for a measured width when the column declares no `maxWidth`. |
| `SAMPLE_ROWS` | 50 | Records read per derivation. |
| `WIDEST_CANDIDATES` | 3 | Strings measured per sampled column (the longest by character count).[^candidates] |
| `HINT_SAMPLE_MAX_CHARS` | 60 | Cap on the `maxContentLength` probe string; beyond it `AUTO_WIDTH_CAP_PX` binds anyway. |
| `REFERENCE_DATE` | `new Date(2000, 11, 31, 23, 59, 59)` | Formatted to measure the width of a date/time/datetime column. |

`BOOLEAN_WIDTH`, `NUMBER_WIDTH`, `DATE_WIDTH`, `CHAR_WIDTH`, and `HEADER_PAD` are **deleted** from `layout/Table.ts` ([lines 21-25](packages/lib/src/typescript/lib/layout/Table.ts#L21)): the type buckets are replaced by the policy above, and the character-count heuristic disappears.

### Cached reference measurements

Two numbers are needed by the cheap `getColumnMinWidth` path, so they are measured once and cached on the instance:

```typescript
interface WidthReferences {
    /** Width of the widest digit glyph, "0" through "9". */
    digitPx: number;
    /** Width of REFERENCE_DATE formatted, keyed by `${type}:${showSeconds}`. */
    datePx: Map<string, number>;
}

private ensureWidthReferences(): WidthReferences {
    if (this._widthRefs) {
        return this._widthRefs;
    }

    const digits = ["0","1","2","3","4","5","6","7","8","9"];
    const keys   = this.dateReferenceKeys();          // one per (type, showSeconds) pair in use
    const widths = Util.measureTextWidths([...digits, ...keys.map(k => k.text)]);

    this._widthRefs = {
        digitPx: Math.max(...widths.slice(0, digits.length)),
        datePx:  new Map(keys.map((k, i) => [k.key, widths[digits.length + i]])),
    };

    return this._widthRefs;
}
```

`dateReferenceKeys()` walks the visible columns, and for each `date` / `time` / `datetime` column produces `{ key: \`${type}:${showSeconds}\`, text: String(TableExporter.formatValue(col, REFERENCE_DATE, this._columnConfigs)) }`, de-duplicated by key. A table with no temporal column produces none.

`_widthRefs` is cleared in `setStore` and in `maybeResampleColumnWidths`, and nowhere else.[^refs-cache]

### The policy

```typescript
interface WidthPolicy {
    min:       number;
    /** `null` = flex: no definite width, share the leftover space. */
    preferred: number | null;
}

private columnWidthPolicy(col: Column, headerPx: number, contentPx: number | null): WidthPolicy {
    const refs = this.ensureWidthReferences();
    const type = col.getField().getType();

    switch (type) {
        case "boolean": {
            const min = CHECKBOX_WIDTH_PX + CELL_CHROME_PX;

            return { min, preferred: Math.max(min, headerPx) };
        }

        case "glyph": {
            const min = GLYPH_WIDTH_PX + CELL_CHROME_PX;

            return { min, preferred: Math.max(min, headerPx) };
        }

        case "date":
        case "time":
        case "datetime": {
            const key = `${type}:${this.showsSeconds(col)}`;
            const min = (refs.datePx.get(key) ?? 0) + CELL_CHROME_PX;

            return { min, preferred: Math.max(min, headerPx) };
        }

        case "number": {
            const min    = refs.digitPx * MIN_NUMBER_DIGITS + CELL_CHROME_PX;
            const digits = col.getMaxContentLength() ?? this.sampledDigits(col) ?? DEFAULT_NUMBER_DIGITS;

            return { min, preferred: Math.max(min, refs.digitPx * digits + CELL_CHROME_PX, headerPx) };
        }

        default: {   // "string" and "auto"
            const min = Math.max(MIN_COLUMN_WIDTH_PX, refs.digitPx * MIN_STRING_CHARS + CELL_CHROME_PX);

            if (contentPx === null) {
                return { min, preferred: null };       // auto-size off — flex column
            }

            return { min, preferred: Math.max(min, contentPx, headerPx) };
        }
    }
}
```

`sampledDigits(col)` returns the longest `String(value).length` seen for that column during sampling, or `null` when the column was not sampled. It is a length scan, never a measurement.

`showsSeconds(col)` reads `this._columnConfigs.get(name)?.showSeconds ?? false`, matching the routing in [`Row.createCellForField`](packages/lib/src/typescript/lib/component/table/Row.ts#L408).

`getColumnMinWidth` reuses the same switch through a cheaper door — it needs no header or content measurement, because no branch above uses `headerPx` or `contentPx` to compute `min`:

```typescript
getColumnMinWidth(col: Column): number {
    return col.getMinWidth() ?? this.columnWidthPolicy(col, 0, null).min;
}
```

### The derivation

```typescript
getIntrinsicColumnWidths(): Array<number | null> {
    const columns   = this.getColumns();
    const headerPx  = this.measureHeaders(columns);          // one batched call, header font
    const contentPx = this.measureContent(columns);          // one batched call, body font

    return columns.map((col, i) => {
        const policy = this.columnWidthPolicy(col, headerPx[i], contentPx[i]);
        const raw    = col.getWidth() ?? policy.preferred;

        if (raw === null) {
            return null;
        }

        return this.clampColumnWidth(raw, col, policy);
    });
}

private clampColumnWidth(w: number, col: Column, policy: WidthPolicy): number {
    return Util.clamp(w, col.getMinWidth() ?? policy.min, col.getMaxWidth() ?? AUTO_WIDTH_CAP_PX);
}
```

`measureHeaders(columns)` collects `col.getHeaderText() ?? col.getField().getName()` for every column — the text the header actually renders ([Header.ts:451](packages/lib/src/typescript/lib/component/table/Header.ts#L451)) — measures them in one `Util.measureTextWidths(texts, { fontSize: "var(--ts-ui-table-header-font-size, var(--ts-ui-font-size))", fontWeight: "bold" })` call, and adds `HEADER_CHROME_PX` to each. The font matches what the header cell sets ([cell/Header.ts:115](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L115)).

`measureContent(columns)` returns `Array<number | null>`, one entry per column — `null` for every column the policy does not need content for. It is the only part of the derivation that reads the store.

`flexColumnWidth(col: Column): number` is the concrete number substituted for a `null` entry by the two callers that cannot share space (show/hide and reset). It measures that one column's header, computes its policy, and returns `clampColumnWidth(Math.max(STRING_WIDTH_PX, headerPx), col, policy)`. Its one-string measurement is the exception to the three-batched-calls budget, and it runs only on the fallback path.

### Sampling

`measureContent` returns `null` for every column except `string` and `auto` columns under auto-size, and `number` columns (whose sample feeds `sampledDigits`, not a measurement). A column is skipped entirely when its config carries a `renderer`, because the rendered text is not derived from the raw value.

```typescript
private collectCandidates(columns: Column[]): Array<string[] | null> {
    const wanted = columns.map(col => this.samplesRecordText(col));
    const best   = columns.map(() => [] as string[]);
    const rows   = Math.min(SAMPLE_ROWS, this._store.getCount());

    for (let r = 0; r < rows; r++) {
        const record = this._store.getAt(r)!;

        columns.forEach((col, i) => {
            if (!wanted[i]) {
                return;
            }

            const raw  = record.get(col.getField().getName());
            const text = String(TableExporter.formatValue(col, raw, this._columnConfigs) ?? "");

            this.keepLongest(best[i], text);
        });
    }

    if (rows > 0) {
        this._autoWidthsSampled = true;
    }

    return columns.map((col, i) => wanted[i] ? best[i] : null);
}
```

`keepLongest(list, text)` keeps the list to at most `WIDEST_CANDIDATES` entries, longest first, and drops a duplicate of a string already held. It compares `String.length` only. Selecting by length before measuring is what keeps the probe count constant: 50 rows are scanned, 3 strings are measured.

Reading by `getAt(r)` matters — `AbstractStore.getRecords()` returns `this._records.slice()` ([AbstractStore.ts:622](packages/lib/src/typescript/lib/data/AbstractStore.ts#L622)), a full copy of the view, so `getRecords().slice(0, 50)` would allocate a 200 000-element array on a 200 000-row store to read fifty of them. `getAt` ([AbstractStore.ts:656](packages/lib/src/typescript/lib/data/AbstractStore.ts#L656)) and `getCount` ([AbstractStore.ts:645](packages/lib/src/typescript/lib/data/AbstractStore.ts#L645)) are both constant-time.

A `string`/`auto` column that collected no candidates falls back, in order, to its `values` option labels (the `WIDEST_CANDIDATES` longest from `normalizeComboOptions(config.values)`), then to its `maxContentLength` budget (`"0".repeat(Math.min(n, HINT_SAMPLE_MAX_CHARS))`), then to `null`. A column that declares `values` uses its labels instead of the store, never as well as it.

That last `null` is deliberate: with auto-size on but the store empty and no hint declared, a `string` column has nothing to size itself from, so it stays a flex column and shares the leftover space. The post-load re-derive is what turns it into a measured width.

### Re-derivation after an async load

```typescript
private maybeResampleColumnWidths(): void {
    if (!this.isAutoSizeColumns() || this._autoWidthsSampled || this._store.getCount() === 0) {
        return;
    }

    this._columnWidths      = [];
    this._savedColumnWidths = new Map();
    this._widthRefs         = null;

    this.doLayout();
}
```

Called from the top of [`onSourceStoreChange`](packages/lib/src/typescript/lib/component/table/Table.ts#L880), before its rotated-mode early return. Clearing `_columnWidths` makes the layout manager's length check fail, which re-runs `initializeWidths` — the same mechanism [`bindView`](packages/lib/src/typescript/lib/component/table/Table.ts#L1054) already relies on. `setStore` sets `_autoWidthsSampled = false` and `_widthRefs = null` alongside the two clears it already performs.

---

## Precedence

For one column, the first rule that applies wins; the result is then clamped to `[minWidth ?? policy.min, maxWidth ?? 400]`.

1. `config.width` — the explicit starting width.
2. The type policy's `preferred`, which for `string`/`auto` under auto-size is the sampled content.
3. `null` — flex, share the leftover space. Only `string`/`auto` with auto-size off.

Note that a declared `minWidth` replaces the policy floor; it does not compete with it. An explicit `width` is still clamped, so `width: 20` on a `boolean` column yields 22 px (the checkbox floor). A consumer who really wants 20 declares `minWidth: 20` as well.

Worked example — a generated `orders` table with `autoSizeColumns: true`. Widths are illustrative (they depend on the theme font); the **Rule** column is what the implementer must reproduce.

| Column | Config | Type | Sample from the first 50 rows | Rule that wins | Width |
|---|---|---|---|---|---|
| `id` | — | `number` | `"1"` … `"48210"` | 2 — 5 digits, but the header is wider | `max(header "id", 5 digits) + chrome` → 45 |
| `customer_name` | `maxContentLength: 60` | `string` | longest `"Alexandra Fitzgerald"` | 2 — sample beats the hint | `"Alexandra Fitzgerald" + chrome` → 146 |
| `status` | `values: ['open','shipped','cancelled']` | `string` | not read (combo) | 2 — widest option label | `"cancelled" + chrome` → 70 |
| `notes` | — | `string` | longest is 2 400 chars | 2 — capped | `AUTO_WIDTH_CAP_PX` → 400 |
| `created` | — | `date` | not read (fixed shape) | 2 — the formatted reference date | `"12/31/2000" + chrome` → 76 |
| `archived` | `width: 48` | `boolean` | not read | 1 — explicit | 48 |
| `region` | `width: 300, maxWidth: 200` | `string` | — | 1 — explicit, then clamped | 200 |
| `flag` | `width: 20` | `boolean` | not read | 1 — explicit, then floored | 22 |

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/DOM.ts`** — declare `measureTextWidths(texts: string[], options?: TextMeasureOptions): number[]` on the `DOMSource` interface beside `measureText` ([line 988](packages/lib/src/typescript/lib/core/DOM.ts#L988)), and implement it on `ProductionDOMSource` beside [`measureText`](packages/lib/src/typescript/lib/core/DOM.ts#L1893) per `## Internal Structure`. Reuse the same font-option destructuring `measureText` performs. *Check:* `npm run typecheck` reports `TestDOM` no longer satisfies `DOMSource` — that is step 2's job.

2. **`packages/lib/tests/dom/TestDOM.ts`** — add `measureTextWidths` beside [`measureText`](packages/lib/tests/dom/TestDOM.ts#L902), mapping over the existing model. *Check:* `npm run typecheck` is clean again.

3. **`packages/lib/src/typescript/lib/core/Util.ts`** — add `measureTextWidths`, forwarding to `DOM.source.measureTextWidths`, beside [`measureTextWidth`](packages/lib/src/typescript/lib/core/Util.ts#L84).

4. **`packages/lib/src/typescript/lib/component/table/ColumnConfig.ts`** — add `width?: number` and `maxContentLength?: number` to `ColumnConfig`, and `autoSizeColumns?: boolean` to `ColumnSpec`, each with JSDoc stating its precedence (see `## Precedence`).

5. **`packages/lib/src/typescript/lib/component/table/Column.ts`** — add `_width` / `_maxContentLength` fields read from the config in the constructor, plus `getWidth()` / `getMaxContentLength()` accessors, mirroring the existing `getMinWidth` / `getMaxWidth` pair at [line 65](packages/lib/src/typescript/lib/component/table/Column.ts#L65).

6. **`packages/lib/src/typescript/lib/component/table/TableExporter.ts`** — change `private static formatValue` to `static formatValue` and add `@internal` to its JSDoc. *Check:* `grep -n "private static formatValue" packages/lib/src/typescript/lib/component/table/TableExporter.ts` — expect zero matches.

7. **Write the tests** in a new `packages/lib/tests/component/table/ColumnWidths.test.ts`, one per unit-testable case in `## Expected Behaviour` (cases 1–27). They fail at this point. Follow the driving pattern in [packages/lib/tests/component/table/RotatedView.test.ts:340](packages/lib/tests/component/table/RotatedView.test.ts#L340): `table.setWidth(w); table.setHeight(h); table.doLayout();` then read `getIntrinsicColumnWidths()`, `getColumnMinWidth()`, or `getColumnWidths()` per the assertion-target rule at the top of that section.

8. **`packages/lib/src/typescript/lib/component/table/Table.ts`** — add the constants, the `_autoWidthsSampled` and `_widthRefs` fields, and the `WidthPolicy` / `WidthReferences` interfaces; add `isAutoSizeColumns`, `getColumnMinWidth`, `getIntrinsicColumnWidths`, and the privates from `## Internal Structure`; import `normalizeComboOptions` from `ColumnConfig.js` and `Util` (`TableExporter` is already imported). Delete `defaultColumnWidth` ([line 717](packages/lib/src/typescript/lib/component/table/Table.ts#L717)).

9. **`Table.ts`, min-width call sites** — replace `columns[i].getMinWidth() ?? 30` with `this.getColumnMinWidth(columns[i])` at [line 771](packages/lib/src/typescript/lib/component/table/Table.ts#L771) and [line 783](packages/lib/src/typescript/lib/component/table/Table.ts#L783), and `columns[colIndex]?.getMinWidth() ?? 30` / `columns[colIndex + 1]?.getMinWidth() ?? 30` with the accessor at [lines 1243](packages/lib/src/typescript/lib/component/table/Table.ts#L1243) and [1245](packages/lib/src/typescript/lib/component/table/Table.ts#L1245). Those two read from an optional index, so keep the guard: `const c = columns[colIndex]; const min0 = c ? this.getColumnMinWidth(c) : MIN_COLUMN_WIDTH_PX;`. Leave the `getMaxWidth() ?? Infinity` reads on lines 1244 and 1246 alone.

10. **`Table.ts`, `setColumnVisible`** ([line 479](packages/lib/src/typescript/lib/component/table/Table.ts#L479)) — replace the `?? this.defaultColumnWidth(col)` map with a saved-width-first map that derives intrinsic widths lazily, so a toggle measures nothing when every visible column already has a saved width:

    ```typescript
    let intrinsic: Array<number | null> | null = null;

    const rawWidths = newVisibleColumns.map((col, i) => {
        const saved = this._savedColumnWidths.get(col.getField().getName());

        if (saved !== undefined) {
            return saved;
        }

        intrinsic ??= this.getIntrinsicColumnWidths();

        return intrinsic[i] ?? this.flexColumnWidth(col);
    });
    ```

    The index `i` is valid because `getIntrinsicColumnWidths` builds its array from `this.getColumns()`, and `_hiddenColumns` has already been updated at this point — so its entries line up one-for-one with `newVisibleColumns`.

11. **`Table.ts`, `resetColumns`** ([line 1283](packages/lib/src/typescript/lib/component/table/Table.ts#L1283)) — `const intrinsic = this.getIntrinsicColumnWidths();` then `this._columnWidths = this.getColumns().map((col, i) => intrinsic[i] ?? this.flexColumnWidth(col));`.

12. **`Table.ts`, store hooks** — add `maybeResampleColumnWidths()` and call it as the first statement of `onSourceStoreChange` ([line 880](packages/lib/src/typescript/lib/component/table/Table.ts#L880)); set `this._autoWidthsSampled = false` and `this._widthRefs = null` in `setStore` beside the existing `_columnWidths` / `_savedColumnWidths` clears ([line 391](packages/lib/src/typescript/lib/component/table/Table.ts#L391)). *Check:* `grep -n "_autoWidthsSampled" packages/lib/src/typescript/lib/component/table/Table.ts` — expect exactly four sites (declaration, the write in `collectCandidates`, the read in `maybeResampleColumnWidths`, the reset in `setStore`).

13. **`packages/lib/src/typescript/lib/layout/Table.ts`** — thread the `container` through the three private methods that now need it, then delete the constants. `doLayout` already holds a `container` local and calls both entry points at [line 109](packages/lib/src/typescript/lib/layout/Table.ts#L109) and line 112.

    | Method | Old signature | New signature |
    |---|---|---|
    | `initializeWidths` ([line 309](packages/lib/src/typescript/lib/layout/Table.ts#L309)) | `(columns, availableWidth)` | `(container, columns, availableWidth)` |
    | `rescaleWidths` ([line 353](packages/lib/src/typescript/lib/layout/Table.ts#L353)) | `(columns, columnWidths, availableWidth)` | `(container, columns, columnWidths, availableWidth)` |
    | `clamp` ([line 434](packages/lib/src/typescript/lib/layout/Table.ts#L434)) | `(width, column)` | `(width, column, container)` |

    Then: in `initializeWidths`, replace the `columns.map(...)` that builds the `intrinsic` array (lines 310-320) with `const intrinsic = container.getIntrinsicColumnWidths();`, and replace `col.getMinWidth() ?? 30` at [line 334](packages/lib/src/typescript/lib/layout/Table.ts#L334) with `container.getColumnMinWidth(col)`. In `clamp`, replace `column.getMinWidth() ?? 30` at [line 435](packages/lib/src/typescript/lib/layout/Table.ts#L435) with `container.getColumnMinWidth(column)`. After the `initializeWidths` rewrite, `clamp`'s only remaining caller is `rescaleWidths` at line 375, which is why `rescaleWidths` needs the container.

    Everything else is unchanged — the flex share, `absorbSlackIntoGreedy` including its `getMaxWidth() === undefined` test at [line 407](packages/lib/src/typescript/lib/layout/Table.ts#L407), and `rescaleWidths`'s arithmetic. Delete the now-unused `BOOLEAN_WIDTH`, `NUMBER_WIDTH`, `DATE_WIDTH`, `CHAR_WIDTH`, `HEADER_PAD` constants ([lines 21-25](packages/lib/src/typescript/lib/layout/Table.ts#L21)) and update the class-level and method JSDoc to say the per-column widths and minimums come from the Table component. *Check:* `grep -n "CHAR_WIDTH\|HEADER_PAD\|?? 30" packages/lib/src/typescript/lib/layout/Table.ts` — expect zero matches.

14. **`packages/lib/src/typescript/lib/component/table/TablePanel.ts`** — `constructor(store: AbstractStore, spec?: ColumnSpec)`, forwarding to `new Table(store, spec)` at line 72; import the `ColumnSpec` type; document the parameter.

15. **`packages/lib/src/typescript/MiscPanel.ts`** — pass `{ columns: [], autoSizeColumns: true }` as the second argument of `new TablePanel(wideStore)` in the 45-column demo ([line 371](packages/lib/src/typescript/MiscPanel.ts#L371)), so the demo matches the comment above it.

16. **Run the tests** — every case from step 7 passes, and the existing `Table.test.ts`, `RotatedView.test.ts`, `Body.test.ts`, `Column.test.ts` suites still pass.

17. **Documentation** — apply `## Documentation Impact`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Util.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/ColumnConfig.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Column.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TableExporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TablePanel.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Table.ts` |
| Modify | `packages/lib/src/typescript/MiscPanel.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Create | `packages/lib/tests/component/table/ColumnWidths.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/components/TablePanel.md` |

---

## Expected Behaviour

The offline harness models `measureText` with a per-character advance table ([packages/lib/tests/dom/TestDOM.ts:902](packages/lib/tests/dom/TestDOM.ts#L902)), so widths are deterministic and longer strings measure wider. The model ignores font size and weight, so **no test may assert that the header font differs from the body font** — that difference is manual-verify only.

Three assertion targets, and picking the wrong one produces a flaky test. Cases that pin the **derivation** assert on `table.getIntrinsicColumnWidths()`, which is untouched by later redistribution. Cases that pin a **floor** assert on `table.getColumnMinWidth(col)`. Cases that pin the **laid-out result** assert on `getColumnWidths()` after `doLayout()`, and must size the table narrow enough that the derived widths overflow it — otherwise `absorbSlackIntoGreedy` hands the leftover width to the unbounded string columns and masks the derived value.

**Unit-testable — batched measurement (assert on `Util.measureTextWidths`)**

1. *Batch matches singles.* `Util.measureTextWidths(["a", "bbb", ""])` equals `["a","bbb",""].map(t => Util.measureTextWidth(t))`.
2. *Empty input.* `Util.measureTextWidths([])` returns `[]`.

**Unit-testable — type policy without data (assert `getIntrinsicColumnWidths()` / `getColumnMinWidth()`)**

3. *Boolean floor.* A `boolean` column with no `minWidth` reports `getColumnMinWidth() === CHECKBOX_WIDTH_PX + CELL_CHROME_PX`, and that floor holds with `autoSizeColumns` unset.
4. *Boolean width is header-driven.* Two `boolean` columns, one with a one-character header and one with a long header, return different intrinsic widths, the longer header giving the larger.
5. *Boolean ignores its data.* A `boolean` column's intrinsic width is identical over an empty store and over a store whose records hold long values in that field.
6. *Date width needs no data.* A `date` column over an **empty** store returns an intrinsic width strictly greater than `MIN_COLUMN_WIDTH_PX`, derived from the formatted reference date.
7. *Seconds widen a time column.* Two `time` columns, one configured `showSeconds: true`, return different intrinsic widths, the `showSeconds` one larger.
8. *Number floor.* A `number` column with no `minWidth` reports a `getColumnMinWidth()` of at least `MIN_NUMBER_DIGITS` digits' width — strictly greater than `MIN_COLUMN_WIDTH_PX` under the harness font.
9. *Number width follows digit count.* Two `number` columns whose headers are the same length, one holding 3-digit values and one holding 9-digit values, return intrinsic widths with the 9-digit column larger.
10. *`maxContentLength` outranks the sample for numbers.* A `number` column holding only 1-digit values but declaring `maxContentLength: 12` returns the 12-digit width.
11. *String floor.* A `string` column with no `minWidth` reports a `getColumnMinWidth()` of at least `MIN_STRING_CHARS` characters' width.
12. *Declared `minWidth` replaces the policy floor.* A `boolean` column declaring `minWidth: 5` reports `getColumnMinWidth() === 5`.

**Unit-testable — auto-size and content (assert `getIntrinsicColumnWidths()`)**

13. *Auto-size off leaves strings flex.* A spec-less table over `{ id: number, name: string }` returns a number for `id` and `null` for `name`.
14. *Explicit `width` wins*, and is clamped: `{ field: 'region', width: 300, maxWidth: 200 }` returns exactly 200, and `{ field: 'flag', width: 20 }` on a `boolean` column returns `CHECKBOX_WIDTH_PX + CELL_CHROME_PX`.
15. *Content drives width.* With `autoSizeColumns: true` and two `string` columns whose headers are the same length, the column holding longer values returns the larger number.
16. *Cap.* A `string` column holding a 2 000-character value and declaring no `maxWidth` returns exactly 400.
17. *Combo labels.* A column with `values: ['open','shipped','cancelled']` is sized from `"cancelled"` even when every record holds `"open"`.
18. *A custom renderer is not sampled.* A column with a `renderer` is sized from header and policy alone — a record holding a very long value in that field does not widen it.
19. *Hint with no data.* An empty store plus `{ field: 'code', maxContentLength: 10 }` on a `string` column returns a width derived from 10 characters, wider than the `MIN_STRING_CHARS` floor.
20. *Empty store, no hint, auto-size on.* A `string` column with no `maxContentLength` and no `values` over an empty store returns `null` — it stays flex until data arrives.
21. *Re-derivation on first load.* Same setup as case 20: record the intrinsic entry for the `string` column (`null`), then `store.loadData([...])` with long string values; the entry becomes a number larger than the `MIN_STRING_CHARS` floor.
22. *Re-derivation happens once.* After case 21, a second `loadData` with much longer values leaves the intrinsic widths unchanged.

**Unit-testable — laid-out widths (assert `getColumnWidths()` after `doLayout()`)**

23. *The re-derive reaches the layout.* Same setup as case 21 with the table sized narrow (e.g. `setWidth(200)` over three columns) so there is no slack to absorb: `getColumnWidths()` after the load differs from the array recorded before it.
24. *The floor survives the squeeze.* A table far too narrow for its columns (e.g. `setWidth(80)` over one `boolean` and two `string` columns) leaves the `boolean` column at no less than `getColumnMinWidth()` — `rescaleWidths` cannot squeeze it below the checkbox.
25. *Rotated mode ignores the flag.* With `autoSizeColumns: true`, `setDisplayMode('rotated')` still yields the three projection widths bounded by their spec min/max, exactly as `RotatedView.test.ts` asserts today.
26. *Reset re-derives.* With auto-size on, overwrite a width (write `_columnWidths` directly, as the existing tests drive private state), then invoke reset; the measured width is restored.
27. *Show/hide reuses saved widths.* After a layout pass, hiding then showing a column restores the width recorded in `_savedColumnWidths`; a column that started `hidden: true` gets an intrinsic width on first show.

**Manual verification** (`npm run dev`, app on `localhost:8015`, Misc panel → *Show window with wide table (45 columns)!*)

28. Columns are visibly different widths, each roughly fitting its content; the table scrolls horizontally rather than squeezing all 45 columns into the window.
29. Header labels are never clipped — a column of narrow `boolean` values is still wide enough for `is_reconciled_2`.
30. Dragging a column divider far to the left stops at the neighbour's floor; a checkbox column never clips its checkbox.
31. Resizing the window keeps the string columns scaling and the numeric/date columns fixed, unchanged from today.
32. Toggling a column off and on via the header context menu restores its previous width.
33. With DevTools' Performance panel recording, opening the 45-column window shows no single long task attributable to text measurement — the batched calls appear as a handful of layout flushes, not hundreds.

---

## Verification

- `npm run typecheck` — clean.
- `npm run test` — the new `ColumnWidths.test.ts` plus the existing table suites pass.
- `grep -rn "defaultColumnWidth" packages/lib/src` — expect zero matches.
- `grep -rn "CHAR_WIDTH\|HEADER_PAD\|?? 30" packages/lib/src/typescript/lib/layout/Table.ts` — expect zero matches.
- `grep -rn "getMinWidth() ?? 30" packages/lib/src` — expect zero matches.
- `npm run docs:build` — 0 errors and 0 link warnings (TypeDoc's "unsupported TypeScript version" notice is the only acceptable one).
- Manual cases 28–33 above.

---

## Documentation Impact

- **`packages/lib/docs/components/Table.md`, "Constraining columns"** — add `width` and `maxContentLength` rows to the `ColumnConfig` table; add a paragraph on `autoSizeColumns` beneath the `appendUnlisted` paragraph, carrying the precedence list and a generated-table example (`Table(store, { columns: [], autoSizeColumns: true })` — an empty `columns` array with the default `appendUnlisted: true` auto-generates every field). State that `boolean`, `glyph`, `date`, `time`, `datetime`, and `number` columns are sized from their type without the flag, and that `autoSizeColumns` affects `string` and `auto` columns only.
- **`packages/lib/docs/components/Table.md`, "Performance"** — one paragraph on the measurement budget: a derivation costs at most three batched text measurements in total, regardless of column count, and derivations happen on first layout, store swap, reset, and the single post-load re-derive — never per row and never on scroll. Note that at most 50 records are read, and only for `string`, `auto`, and `number` columns.
- **`packages/lib/docs/components/TablePanel.md`** — document the new optional `spec` constructor parameter and link to `Table`'s column-spec section.
- **JSDoc** — `ColumnConfig.width` / `.maxContentLength` / `ColumnSpec.autoSizeColumns`, `Column.getWidth` / `.getMaxContentLength`, `Table.isAutoSizeColumns` / `.getColumnMinWidth` / `.getIntrinsicColumnWidths`, `Util.measureTextWidths`, `DOMSource.measureTextWidths`, `TablePanel`'s new parameter. `TableExporter.formatValue` is `@internal`, so no public JSDoc may `{@link}` it — describe it in prose instead (`CODE_CONVENTIONS.md`, *Don't `{@link}` internal symbols from public JSDoc*).
- **No barrel change** — every touched table symbol is already exported from `component/table/index.ts`, and `Util` / `DOM` are already exported from `core/index.ts`; `ColumnConfig` and `ColumnSpec` are interfaces whose new fields need no re-export.
- **No `packages/lib/llms.txt` change** — the file is generated from `packages/lib/scripts/llms/manifest.data.mjs`, whose rows are task→symbol pairs with no per-option detail; the `Table` row already covers this capability.

---

## Potential Challenges

- **The default path shifts.** Every existing table's `boolean`, `number`, and `date` columns move off the flat 60 / 90 / 110, and every column now has a floor above 30 px. Widths of existing tables will change. Mitigation: this is the correction the plan exists for, and the shift is toward "the content fits". Pin it with unit cases 3–12.
- **A `TreeTable`'s tree column carries an indent and a toggle that the text measurement does not include.** Mitigation: document that a tree column should declare `minWidth` or `width`; the indent depends on depth and is not derivable at first layout.
- **`headerGlyph` and `required` add header chrome that `HEADER_CHROME_PX` does not account for.** Pre-existing; mitigation: those columns should declare a `minWidth`. Do not widen the constant for everyone.
- **A locale that renders month names makes `REFERENCE_DATE` an underestimate.** `toLocaleDateString()` is numeric in the common locales, so the reference date is exact there. Mitigation: a consumer on a month-name locale declares `minWidth`; do not switch to measuring twelve month names for a case the library cannot detect cheaply.
- **`GLYPH_WIDTH_PX` is a tuned constant, not a measurement.** A column using an oversized glyph will clip. Mitigation: document that such a column declares `minWidth`.
- **An all-numeric auto-sized table leaves empty space at the right edge**, because `absorbSlackIntoGreedy` only hands slack to unbounded `string`/`auto` columns. Mitigation: document the blank filler column as the way to soak it up — the rotated view already ships that trick ([packages/lib/src/typescript/lib/component/table/Table.ts:38](packages/lib/src/typescript/lib/component/table/Table.ts#L38)).
- **A user who drags a column before the store's first load loses that drag** to the one-shot re-derive. Mitigation: the window is a single store round-trip; documented, not defended against.[^resample]
- **A theme switch changes the font after `_widthRefs` is cached.** Minimums stay on the old font's metrics until the next derivation. Mitigation: accepted — the error is a pixel or two on a floor, and the next store swap or reset refreshes it.[^refs-cache]

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/table/Table.ts` | Owns `_columnWidths`, `_savedColumnWidths`, `defaultColumnWidth`, `trimToTarget`, `setColumnVisible`, `resetColumns`, the store hooks, and the four `?? 30` sites. |
| `packages/lib/src/typescript/lib/layout/Table.ts` | `doLayout` → `initializeWidths` / `rescaleWidths` / `absorbSlackIntoGreedy`; the consumer of the new methods and the other two `?? 30` sites. |
| `packages/lib/src/typescript/lib/core/DOM.ts` | `DOMSource` interface and `ProductionDOMSource.measureText` — the probe recipe `measureTextWidths` batches. |
| `packages/lib/src/typescript/lib/core/Util.ts` | `measureTextWidth` — the forwarding shape `measureTextWidths` mirrors. |
| `packages/lib/src/typescript/lib/component/table/ColumnConfig.ts` | `ColumnConfig` / `ColumnSpec` and `normalizeComboOptions`. |
| `packages/lib/src/typescript/lib/component/table/Column.ts` | The `getMinWidth` / `getMaxWidth` accessor pattern the new accessors mirror. |
| `packages/lib/src/typescript/lib/component/table/TableExporter.ts` | `formatValue` — the value→display-text precedent being reused, and the source of the date reference string. |
| `packages/lib/src/typescript/lib/component/input/Checkbox.ts` | The 16×16 box at line 65 that `CHECKBOX_WIDTH_PX` mirrors. |
| `packages/lib/src/typescript/lib/component/input/ComboBox.ts` | `measureWidestLabel` / `showAt` — the measure-the-data-then-clamp precedent. |
| `packages/lib/src/typescript/lib/component/table/Row.ts` | `createCellForField` — the type→cell routing the policy mirrors. |
| `packages/lib/src/typescript/lib/component/table/cell/Header.ts` | Sets the header font the header measurement must match. |
| `packages/lib/src/typescript/lib/data/AbstractStore.ts` | `getAt` / `getCount` / `getRecords` — why sampling reads by index. |
| `packages/lib/tests/component/table/RotatedView.test.ts` | The width-assertion test pattern to copy. |
| `packages/lib/tests/dom/TestDOM.ts` | The modelled `measureText` the tests measure against, and the second implementer of `DOMSource`. |

---

## Non-Goals

- **Redistribution after the first derivation.** `rescaleWidths`, `absorbSlackIntoGreedy`, `trimToTarget`, `onColumnResize`, `onColumnResizeStart` keep their current behaviour; the only edit is swapping their inline `?? 30` for `getColumnMinWidth`. The sibling plan `plans/table-chained-column-resize.md` owns that ground.[^sibling-scope]
- **A derived maximum width.** `maxWidth` stays declared-only.[^no-derived-max]
- **Re-deriving on every store load.** Only the first load that finds records re-derives; a later filter, page change, or reload keeps the widths the user is looking at.
- **Auto-sizing the rotated projection.** Its `field` / `value` / `filler` columns carry hand-tuned min/max widths already.
- **Measuring every record.** The sample is capped at 50 rows; a wide value below the cut-off is not found. A consumer that knows better passes `width` or `maxContentLength`.
- **A general text-measurement cache.** `_widthRefs` caches two reference numbers, not measured strings. Per-string caching is not added.
- **Column pinning.** `plans/table-column-pinning.md` is out of scope for this release.

---

## Notes

[^probe-cost]: Measuring one string is not cheap. [`ProductionDOMSource.measureText`](packages/lib/src/typescript/lib/core/DOM.ts#L1893) creates two spans, appends one to `document.body`, calls `getBoundingClientRect()` twice, then removes it. The removal dirties layout again, so the next call's first `getBoundingClientRect()` forces a fresh style-recalc and layout of the whole page. A per-column, per-candidate loop over the 45-column demo would be roughly 180 of those, run inside `doLayout` on a page that already has a large table mounted — tens to hundreds of milliseconds, repeated on the post-load re-derive and on reset. Batching turns the count of reflows from "one per string" into "one per font", because nothing mutates the DOM between the reads. The 50-row scan the earlier draft worried about was never the cost: `ModelRecord.get` is an object index and `TableExporter.formatValue` returns immediately for anything that is not a `Date`.

[^sibling-scope]: `plans/table-chained-column-resize.md` will change how a drag redistributes width and will touch `_columnWidths` / `_savedColumnWidths` in the same file. The seam between the two plans: this plan writes `_columnWidths` only in `setColumnVisible`, `resetColumns`, and `maybeResampleColumnWidths` (a wholesale clear), and adds two new private fields, `_autoWidthsSampled` and `_widthRefs`. Its only edit inside `onColumnResize` and `trimToTarget` is substituting `getColumnMinWidth(col)` for the inline `col.getMinWidth() ?? 30` — a like-for-like swap that leaves the surrounding arithmetic alone, so the sibling plan rebases onto it without conflict. Guarding the re-derive with a "user has resized" flag was considered and rejected precisely because the flag's only natural write site is `onColumnResize`, which the sibling plan rewrites.

[^one-derivation]: Two formulas produce a "default" width today and they disagree. `Table.defaultColumnWidth` (line 717) measures the header text with `Util.measureTextWidth` and adds 21 px; it runs on column show/hide and on reset. The layout manager's `initializeWidths` (layout/Table.ts:312) estimates `field.getDescription().length × 8 + 16`; it runs on first layout. So a column's width can change the first time it is hidden and shown again, without the user touching it. Folding both into one method on the component — rather than one function in the layout manager — puts the derivation next to the store, the column configs, and the display mode it needs to read, none of which the layout manager should be reaching for. A third option, a shared helper module in the style of `core/ScrollShadow.ts`, was rejected: only two call sites exist and one of them is the component that owns the state.

[^type-policy]: The four coarse buckets in `layout/Table.ts` throw away information the library already holds. A `boolean` cell is a `BooleanEditor` wrapping a `Checkbox` whose box is set to 16×16 at [Checkbox.ts:65](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L65); a `date` cell renders exactly what `toLocaleDateString()` returns for any date, so one formatted reference date measures every row in the column; a `number` cell renders digits, a sign, and separators, so its width is a digit count times a digit advance and the digit count comes from `String(value).length` — a scan, not a measurement. Deriving those three from their type rather than from sampled data is both more accurate (a 50-row sample can miss the widest value; a checkbox is always 16 px) and cheaper (no store read, no per-column probe). It also gives each of them an honest floor, which is what stops the squeeze that clips a checkbox today. Only `string` and `auto` have no derivable shape, which is where the sample earns its cost.

[^unconditional]: Gating the type policies behind `autoSizeColumns` was considered and rejected. The policies read no data, so they cost nothing to run for every table, and the clipping they fix — a checkbox column crushed to 30 px, a date column at a flat 110 px that is too narrow for a `datetime` with seconds — is a bug for every consumer, not only for generated tables. The price is that widths of existing tables shift; the plan accepts that shift and pins the new numbers with tests. `autoSizeColumns` still gates the part that has a real cost and a real behaviour change: reading the store to size `string` columns, which turns them from flex columns into fixed ones and would silently change the appearance of every demo and docs page.

[^min-accessor]: Six sites read `col.getMinWidth() ?? 30` today, and two of them run on the drag path — `onColumnResize` reads two columns' minimums on every `mousemove`. So `getColumnMinWidth` must be cheap. Every branch of `columnWidthPolicy` computes its `min` from a constant or from `_widthRefs`, never from the header text, the content sample, or the store; that is why `getColumnMinWidth` can pass `0` and `null` for the header and content arguments without affecting the answer. A separate cheap-path method was rejected: one switch that both callers share cannot drift, and two switches over the same seven types would.

[^no-derived-max]: A derived maximum would have to be read somewhere, and the only site that would consume it is `absorbSlackIntoGreedy`'s `col.getMaxWidth() === undefined` test at [layout/Table.ts:407](packages/lib/src/typescript/lib/layout/Table.ts#L407), which decides which columns soak up leftover width. Giving fixed-shape columns a concrete maximum would not change that decision — they already fail the `isFlex` half of the test — and changing the slack rules is the sibling resize plan's ground. The outcome a caller wants from a maximum is already delivered without one: a `boolean` column's width is `max(checkbox, header)` and it never grows, because it is not a flex column, and a measured `string` width is capped at `AUTO_WIDTH_CAP_PX`.

[^refs-cache]: `_widthRefs` holds two things: the widest digit width, and one width per `(temporal type, showSeconds)` pair in use. Both are needed by `getColumnMinWidth`, which runs on the drag path and must not touch the DOM, so they cannot be measured on demand. They are measured in one batched call the first time anything asks, and cleared only when the column set or the store changes (`setStore`, `maybeResampleColumnWidths`). Hooking theme changes to clear them was considered and rejected: it would add a theme subscription and a teardown path to `Table` for an error of a pixel or two on a floor, and `subscribeTheme` bags are the framework's most leak-prone seam.

[^sample-shape]: Three bounds keep the cost flat. (1) At most `SAMPLE_ROWS` records are read, by `getAt(i)` rather than `getRecords()` — the latter copies the entire filtered view ([AbstractStore.ts:622](packages/lib/src/typescript/lib/data/AbstractStore.ts#L622)), so it would allocate a 200 000-element array to read fifty rows. (2) Candidate selection is by `String.length`, which costs nothing, and only the `WIDEST_CANDIDATES` longest distinct strings per column survive it — kept in a single pass, with no intermediate `Set` and no sort. (3) Everything that survives is measured in one batched call, so the number of layout flushes per derivation is three, not `4 × visibleColumns`. Reusing `TableExporter.formatValue` rather than writing a second formatter matters because a temporal column's width depends entirely on the locale format string; two formatters that drift would size the column for text the cell never shows.

[^hints]: A generating consumer knows things the first 50 rows do not show. Two hints cover the cases without inventing a schema-description API: `width` for "I know exactly how wide this should be", and `maxContentLength` for "the column cannot hold more than N characters" — the `varchar(n)` and numeric-precision case. For a `string` column `maxContentLength` is used only when the sample yields nothing, because a value longer than the schema allows cannot appear in the data, so capping a real measurement with it would never bind. For a `number` column it outranks the sample instead: the digit count is what the policy needs, and a schema that says twelve digits is a better answer than fifty rows that happen to hold one. Enum sets need no new field: a column that declares `values` already renders option labels through `ComboRenderer`, so the labels are the exact text to measure. A richer hint object (`{ varcharLength, precision, scale, enumValues }`) was rejected — it would restate database concepts the library has no other use for, and every one of them reduces to "how many characters wide" at measurement time.

[^resample]: The motivating consumer builds the table, then awaits the query. At first layout the store is empty, so the sample is empty and every `string` column falls back to its header width or its `maxContentLength` hint. Re-deriving once, on the first store event that finds records, is what makes the flag useful in that flow. It is capped at once per store because a later reload — a filter change, a new page — arrives after the user has been looking at the table, and re-deriving widths under them would be worse than leaving widths that no longer match. Two guards against clobbering an early user drag were considered and rejected: a flag written in `onColumnResize` (collides with the sibling plan — see the scope footnote), and comparing the live widths against the last derived array (a plain container resize runs `rescaleWidths` and would be misread as a user drag, suppressing the re-derive that the flow depends on).

[^candidates]: Character count is only a proxy for rendered width in a proportional font — `"WWWW"` is wider than `"iiiiiii"`. Measuring the three longest distinct candidates rather than only the longest makes that mismatch harmless in practice. Dropping to a single candidate would save nothing now that measurement is batched: three strings and one string ride the same layout flush.

[^tablepanel]: `TablePanel` is the store-bound table wrapper a database-browser consumer reaches for, and its constructor currently accepts only a store — so `autoSizeColumns`, and in fact every existing `ColumnConfig` option, is unreachable through it. Adding an optional second parameter is additive, keeps every existing `new TablePanel(store)` call working, and is what makes this feature drivable from ordinary consumer code rather than only from a hand-built `Table`.
