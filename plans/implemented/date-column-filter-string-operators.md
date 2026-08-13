---
touches-shared:
  - packages/lib/src/typescript/lib/data/FilterDescriptor.ts
  - packages/lib/src/typescript/lib/data/index.ts
  - packages/lib/src/typescript/lib/component/table/ColumnFilter.ts
  - packages/lib/docs/components/Table.md
  - packages/lib/docs/reference/changelog/next.md
---

# Date Column Filter String Operators — Implementation Plan

## Overview

A `date` / `time` / `datetime` column's header filter offers only `eq`, `neq`, the four ordering operators, and the two emptiness operators today ([`ColumnFilter.ts:68-70,115-131`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L68)). This plan adds **Contains**, **Starts with**, and **Ends with** to those three column types, so a user can filter a date column for `2021` or a datetime column for `PM` the way they already can on a text column.

The three operators already exist as full `ColumnFilterOperator` members with labels, glyphs, and descriptor-building support ([`ColumnFilter.ts:16-20,65-66,76-106`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L16)); they are simply never offered for any of those three column types. Offering them is a one-line list change.

The work is on the matching side. **Display text** — the string a cell actually shows — is what a user types a fragment of. `matchesFilter`, the evaluator every local (in-memory) filter runs through ([`FilterDescriptor.ts:45`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L45)), coerces a field's raw value with `String(raw)` ([`FilterDescriptor.ts:67-89`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L67)). For a `Date` that produces `Mon May 17 2021 14:30:20 GMT+0200 (Central European Summer Time)`, which resembles nothing on screen. This plan routes those three operators through the same formatter the cell renderers use, carried on the descriptor as plain data so the evaluator stays worker-portable.

---

## Architecture Decisions

### `time` gets the three operators alongside `date` and `datetime`

`columnFilterOperators` keeps one list for all three temporal types — `date`, `time`, and `datetime`, the types whose cells render a `Date`. The split stays between `number` (unchanged) and that temporal group.[^time-in-scope]

| Field type | Operators, in menu order (first is the default) |
| --- | --- |
| `string`, `auto`, `glyph` | `contains`, `startsWith`, `endsWith`, `eq`, `neq`, `isEmpty`, `isNotEmpty` — unchanged |
| `number` | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `isEmpty`, `isNotEmpty` — unchanged |
| `date`, `time`, `datetime` | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, **`contains`, `startsWith`, `endsWith`**, `isEmpty`, `isNotEmpty` |
| `boolean` | `eq`, `neq`, `isEmpty`, `isNotEmpty` — unchanged |

The three new entries sit after the ordering operators and before the emptiness ones, so `eq` stays the temporal default and no existing entry moves.[^operator-order] `OPERATOR_LABELS` and `OPERATOR_GLYPHS` ([`ColumnFilter.ts:76-106`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L76)) already cover all eleven operators and need no edit.

### The renderers' formatting moves into a pure module in `data/`

New file `data/temporalText.ts` exports `temporalDisplayText(type, showSeconds, value)`, holding the exact `toLocaleDateString` / `toLocaleTimeString` / `toLocaleString` calls that [`DateRenderer`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L33), [`TimeRenderer`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts#L36), and [`DateTimeRenderer`](../packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts#L35) run today. Each renderer's `setValue` calls it instead of formatting inline, and `matchesFilter` calls it too. This one-formatter-two-callers arrangement mirrors [`data/compareValues.ts`](../packages/lib/src/typescript/lib/data/compareValues.ts#L45) — a pure, DOM-free module in `data/` whose own JSDoc states it exists so two evaluation paths "can never drift".[^shared-pure-module]

The existing display-text facility, `CellTextResolver` ([`cell/CellText.ts:63-104`](../packages/lib/src/typescript/lib/component/table/cell/CellText.ts#L63)), cannot serve here: it builds real `CellRenderer` components, which need a DOM, and `matchesFilter` runs inside a Web Worker ([`StoreWorker.ts:67`](../packages/lib/src/typescript/lib/data/StoreWorker.ts#L67)) where no DOM exists. `CellTextResolver` stays exactly as it is and keeps serving the main-thread call sites.

### A substring descriptor carries an optional `temporal` hint

`contains` / `startsWith` / `endsWith` gain one optional member, `temporal?: TemporalDisplay`, a two-field plain object (`{ type, showSeconds }`). No new descriptor variant, and nothing that is not structured-clone-safe.[^why-nested-hint]

```typescript
{ type: 'contains', field: 'due', value: '17',
  temporal: { type: 'date', showSeconds: false } }
```

`buildClauseFilter` populates it from the `ColumnFilterTarget` it already receives ([`ColumnFilter.ts:380-451`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L380)), which already carries `type` and `showSeconds` ([`ColumnFilter.ts:55-62`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L55)) resolved by `TableHeader.filterTarget` ([`Header.ts:1023-1033`](../packages/lib/src/typescript/lib/component/table/Header.ts#L1023)). `Header.ts` needs no change.

### Only a `Date`-valued field is reformatted

`matchesFilter` uses the hint only when the field's raw value is a `Date` instance. Anything else — a string, a number, `null` — takes the existing `String(raw)` path, and a descriptor with no hint behaves exactly as it does today.[^date-only-reformat]

Worked cases for a record holding `new Date(2021, 4, 17, 14, 30, 20)` in field `due`, with `en-US` output shown (the rendered text is locale- and timezone-dependent — see `## Expected Behaviour` for how tests must derive it):

| `temporal` hint | Text matched against | Needle | Result |
| --- | --- | --- | --- |
| *(absent)* | `Mon May 17 2021 14:30:20 GMT+0200 (…)` | `contains "GMT"` | match |
| `{ date, false }` | `5/17/2021` | `contains "GMT"` | no match |
| `{ date, false }` | `5/17/2021` | `contains "17"` | match |
| `{ datetime, false }` | `05/17/2021, 02:30 PM` | `contains ":20"` | no match |
| `{ datetime, true }` | `05/17/2021, 02:30:20 PM` | `contains ":20"` | match |
| `{ time, false }` | `02:30 PM` | `endsWith "PM"` | match |
| *(hint present, field holds the string `"2021-05-17"`)* | `2021-05-17` | `contains "GMT"` | no match |

### The three substring cases in `matchesFilter` share one operand helper

The `contains`, `startsWith`, and `endsWith` cases ([`FilterDescriptor.ts:67-89`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L67)) each repeat the same four lines of null guard, coercion, and case folding, and all three need the same edit. They are rewritten to call one module-private `substringOperands` helper that returns the haystack/needle pair, keeping the change in one place.[^extract-substring-helper]

---

## Public API

```typescript
// data/temporalText.ts (new file)

/** The three field types whose cells render a `Date` as locale-formatted text. */
export type TemporalFieldType = 'date' | 'time' | 'datetime';

/**
 * Formats `value` exactly as a cell of this variant displays it.
 * @internal — not re-exported from the package barrel.
 */
export function temporalDisplayText(
    type:        TemporalFieldType,
    showSeconds: boolean,
    value:       Date,
): string;
```

```typescript
// data/FilterDescriptor.ts

/**
 * How a substring operator renders a `Date`-valued field before matching.
 * Absent means "match the raw value", which is the behaviour every descriptor
 * built before this member existed still gets.
 */
export interface TemporalDisplay {
    type:        TemporalFieldType;
    showSeconds: boolean;
}

export type FilterDescriptor =
    | { type: 'contains';   field: string; value: string; caseSensitive?: boolean; temporal?: TemporalDisplay }
    | { type: 'startsWith'; field: string; value: string; caseSensitive?: boolean; temporal?: TemporalDisplay }
    | { type: 'endsWith';   field: string; value: string; caseSensitive?: boolean; temporal?: TemporalDisplay }
    | /* every other member unchanged */;
```

```typescript
// data/index.ts — the first line widens an existing export, the second is new
export type { FilterDescriptor, TemporalDisplay } from '~/data/FilterDescriptor.js';
export type { TemporalFieldType } from '~/data/temporalText.js';
```

`matchesFilter`, `buildColumnFilter`, `buildClauseFilter`, `columnFilterOperators`, `ColumnFilterTarget`, `ColumnFilterState`, `CellTextResolver`, and every `CellRenderer` signature are unchanged. `component/table/index.ts` gains nothing.

---

## Internal Structure

### `data/temporalText.ts`

```typescript
export function temporalDisplayText(type: TemporalFieldType, showSeconds: boolean, value: Date): string {
    switch (type) {
        case 'date':
            return value.toLocaleDateString();

        case 'time':
            return value.toLocaleTimeString(undefined, showSeconds
                ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
                : { hour: '2-digit', minute: '2-digit' });

        case 'datetime':
            return value.toLocaleString(undefined, showSeconds
                ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
                : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
}
```

Every option bag above is copied verbatim from the renderer it replaces. `showSeconds` is accepted and ignored for `'date'`, matching `CellTextResolver.text`'s own signature, which also takes `showSeconds` for variants that ignore it ([`cell/CellText.ts:79-84`](../packages/lib/src/typescript/lib/component/table/cell/CellText.ts#L79)).

### The three renderers

Each `setValue` keeps its `_value` / `_display` / `_text` writes and its null handling; only the formatting expression changes.

| File | Was | Becomes |
| --- | --- | --- |
| [`renderer/Date.ts:33`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L33) | `value.toLocaleDateString()` | `temporalDisplayText('date', false, value)` |
| [`renderer/Time.ts:36-39`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts#L36) | local `opts` bag + `value.toLocaleTimeString(undefined, opts)` | `temporalDisplayText('time', this._showSeconds, value)` — the `opts` local is deleted |
| [`renderer/DateTime.ts:35-38`](../packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts#L35) | local `opts` bag + `value.toLocaleString(undefined, opts)` | `temporalDisplayText('datetime', this._showSeconds, value)` — the `opts` local is deleted |

Each file's class JSDoc names the native method it formats with (e.g. "formatted with `Date.toLocaleDateString`" at [`renderer/Date.ts:10`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L10)). Reword each to say the text comes from the shared temporal formatter — describing it in prose rather than `{@link}`-ing an `@internal` symbol, per [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md).

### `substringOperands` in `FilterDescriptor.ts`

```typescript
/** The three descriptor members a substring operator can appear as. */
type SubstringDescriptor = Extract<FilterDescriptor, { type: 'contains' | 'startsWith' | 'endsWith' }>;

/**
 * The haystack/needle pair a substring operator compares, or `null` when the
 * field is nullish and no match is possible. A `Date` field is rendered
 * through `descriptor.temporal` when that hint is present; every other value
 * keeps the plain `String(raw)` coercion.
 */
function substringOperands(record: any, descriptor: SubstringDescriptor): { haystack: string; needle: string } | null {
    const raw = readField(record, descriptor.field);

    if (raw == null) {
        return null;
    }

    const text = raw instanceof Date && descriptor.temporal
        ? temporalDisplayText(descriptor.temporal.type, descriptor.temporal.showSeconds, raw)
        : String(raw);

    return descriptor.caseSensitive
        ? { haystack: text,               needle: descriptor.value }
        : { haystack: text.toLowerCase(), needle: descriptor.value.toLowerCase() };
}
```

The three cases become:

```typescript
case 'contains': {
    const operands = substringOperands(record, descriptor);

    return operands !== null && operands.haystack.indexOf(operands.needle) !== -1;
}

case 'startsWith': {
    const operands = substringOperands(record, descriptor);

    return operands !== null && operands.haystack.indexOf(operands.needle) === 0;
}

case 'endsWith': {
    const operands = substringOperands(record, descriptor);

    return operands !== null
        && operands.haystack.lastIndexOf(operands.needle) === operands.haystack.length - operands.needle.length;
}
```

### `columnFilterOperators`

```typescript
/** Operators offered for a `number` column, in menu order. */
const ORDERED_OPERATORS: ColumnFilterOperator[] =
    ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty'];

/** Operators offered for a `date` / `time` / `datetime` column, in menu order. */
const TEMPORAL_OPERATORS: ColumnFilterOperator[] =
    ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'];
```

`ORDERED_OPERATORS`' JSDoc loses its `date` / `time` / `datetime` mention; the switch splits `case 'number'` from the three temporal cases, which return `TEMPORAL_OPERATORS`.

### `buildClauseFilter`'s substring branch

Replacing [`ColumnFilter.ts:427-429`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L427), and leaving the combo branch and the temporal `eq` / `neq` branch above it untouched so their precedence is unchanged:

```typescript
if (operator === 'contains' || operator === 'startsWith' || operator === 'endsWith') {
    if (target.type === 'date' || target.type === 'time' || target.type === 'datetime') {
        return {
            type:     operator,
            field,
            value:    text,
            temporal: { type: target.type, showSeconds: target.showSeconds ?? false },
        };
    }

    return { type: operator, field, value: text };
}
```

`showSeconds` resolves through `?? false` exactly as `displayBucket`'s call site already does ([`ColumnFilter.ts:418`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L418)). A `date` target emits whatever that resolves to; the formatter ignores it for `date`.

---

## Ordered Implementation Steps

1. **Create `packages/lib/src/typescript/lib/data/temporalText.ts`** with the SPDX header every `data/` file carries, the `TemporalFieldType` alias, and `temporalDisplayText` per `## Internal Structure`. Full JSDoc with `@param` / `@returns`; mark `temporalDisplayText` `@internal`. No imports from `~/component/`, no DOM access.
2. **Add `packages/lib/tests/unit/data/temporalText.test.ts`**, mirroring [`compareValues.test.ts`](../packages/lib/tests/unit/data/compareValues.test.ts)'s plain-vitest shape (no `installTestDOM` — the module touches no DOM), covering cases 27-29 of `## Expected Behaviour`.
3. **`component/table/cell/renderer/Date.ts`, `Time.ts`, `DateTime.ts`** — replace each `setValue` formatting expression per the `## Internal Structure` table, delete the now-unused `opts` locals in `Time.ts` / `DateTime.ts`, import `temporalDisplayText` from `~/data/temporalText.js`, and reword each class JSDoc line that names the native method.
4. Regression check: `grep -rn "toLocale" packages/lib/src/typescript/lib/component/table/` — expect zero matches.
5. **`packages/lib/tests/component/table/cell/renderer.test.ts`** — add the renderer-parity case (30 in `## Expected Behaviour`) to the existing `DateRenderer / TimeRenderer / DateTimeRenderer (relational format)` describe block.
6. **`data/FilterDescriptor.ts`** — add the `TemporalDisplay` interface and widen the three substring members of the union with `temporal?: TemporalDisplay`. Extend the module's JSDoc block ([`FilterDescriptor.ts:3-12`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L3)) with one sentence stating the hint's rule: a substring operator renders a `Date` field through the hint before matching, and matches the raw value when the hint is absent or the value is not a `Date`.
7. **`data/FilterDescriptor.ts`** — add the `SubstringDescriptor` alias and the `substringOperands` helper immediately after `readField`, and rewrite the three cases to use it, per `## Internal Structure`.
8. Regression check: `grep -n "String(raw)" packages/lib/src/typescript/lib/data/FilterDescriptor.ts` — expect exactly one match, inside `substringOperands`.
9. Regression check: `grep -rn "~/component" packages/lib/src/typescript/lib/data/` — expect zero matches, confirming the data layer still imports nothing from the component layer.
10. **`data/index.ts`** — widen the existing `export type { FilterDescriptor } …` line ([`data/index.ts:23`](../packages/lib/src/typescript/lib/data/index.ts#L23)) to add `TemporalDisplay`, and add `export type { TemporalFieldType } from '~/data/temporalText.js';` beside it. Do **not** export `temporalDisplayText`.
11. **`packages/lib/tests/unit/data/FilterDescriptor.test.ts`** — add the matching cases (16-26 of `## Expected Behaviour`) after the existing `endsWith` group.
12. **`component/table/ColumnFilter.ts`** — add `TEMPORAL_OPERATORS`, narrow `ORDERED_OPERATORS`' JSDoc to `number`, and split the `columnFilterOperators` switch per `## Internal Structure`.
13. **`component/table/ColumnFilter.ts`** — extend `buildClauseFilter`'s substring branch per `## Internal Structure`, and add one sentence to `buildClauseFilter`'s JSDoc ([`ColumnFilter.ts:355-379`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L355)) stating that a temporal column's substring operators carry the display hint.
14. **`packages/lib/tests/component/table/ColumnFilter.test.ts`** — add cases 1-15 of `## Expected Behaviour`, extending the existing `columnFilterOperators`, temporal, and `worker safety` describe blocks rather than adding new top-level ones.
15. **Docs** — apply the edits in `## Documentation Impact`.
16. From `packages/lib`, run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run docs:api`.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Create | `packages/lib/src/typescript/lib/data/temporalText.ts` |
| Modify | `packages/lib/src/typescript/lib/data/FilterDescriptor.ts` |
| Modify | `packages/lib/src/typescript/lib/data/index.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/ColumnFilter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts` |
| Create | `packages/lib/tests/unit/data/temporalText.test.ts` |
| Modify | `packages/lib/tests/unit/data/FilterDescriptor.test.ts` |
| Modify | `packages/lib/tests/component/table/ColumnFilter.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/renderer.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/data/store.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No file is deleted. `Header.ts`, `cell/Filter.ts`, `cell/CellText.ts`, `AbstractStore.ts`, `StoreWorker.ts`, `TableExporter.ts`, and `component/table/index.ts` are untouched.

---

## Expected Behaviour

Every case below is unit-testable except case 31, which needs a browser. Two shared fixtures, used by cases 15-30:

```typescript
const D     = new Date(2021, 4, 17, 14, 30, 20);   // 17 May 2021, 14:30:20 local
const shown = (type: TemporalFieldType, showSeconds: boolean) => temporalDisplayText(type, showSeconds, D);
```

**Locale rule for every expectation below: derive the expected text from `temporalDisplayText`, never hard-code a formatted string.** `toLocale*` output depends on the runner's locale and timezone — the same rule the existing `date eq` test already follows ([`ColumnFilter.test.ts:313-317`](../packages/lib/tests/component/table/ColumnFilter.test.ts#L313)). The needles used as negative cases below are drawn from `String(D)`, whose shape (`Ddd Mmm DD YYYY HH:MM:SS GMT±hhmm (name)`) is fixed by the language spec and shares no substring with a locale-formatted date or time.

### `columnFilterOperators` (`ColumnFilter.test.ts`)

1. `columnFilterOperators('date')`, `('time')`, and `('datetime')` each equal `['eq','neq','gt','gte','lt','lte','contains','startsWith','endsWith','isEmpty','isNotEmpty']`.
2. `columnFilterOperators('date')[0]` is still `'eq'` — the default operator is unchanged.
3. `columnFilterOperators('number')` equals `['eq','neq','gt','gte','lt','lte','isEmpty','isNotEmpty']` — no substring operator leaks onto a numeric column.
4. `columnFilterOperators('string')` and `('boolean')` are unchanged.
5. Every operator returned for `'date'` yields a non-empty `columnFilterOperatorLabel` and `columnFilterOperatorGlyph`.

### `buildColumnFilter` (`ColumnFilter.test.ts`)

6. `{ type: 'date' }` with `contains '17'` builds `{ type: 'contains', field: 'due', value: '17', temporal: { type: 'date', showSeconds: false } }`.
7. The same target with `startsWith` and with `endsWith` builds the same shape with the matching `type`.
8. `{ type: 'datetime', showSeconds: true }` with `contains 'x'` builds `temporal: { type: 'datetime', showSeconds: true }`.
9. `{ type: 'time' }` with `contains 'x'` builds `temporal: { type: 'time', showSeconds: false }`.
10. `{ type: 'string' }` with `contains 'ali'` builds `{ type: 'contains', field: 'name', value: 'ali' }` and the result has **no** `temporal` key (`'temporal' in descriptor` is `false`) — the existing string-column assertions keep passing unchanged.
11. A combo column (`values` non-empty) declared over a `date` field with `contains 'x'` still takes the combo path and builds an `in` descriptor with no `temporal` key — the combo branch keeps its precedence over the temporal branch.
12. `{ type: 'date' }` with `eq '2021-05-17'` still builds the existing `and(gte, lt)` display bucket, and `neq` still wraps it in `not` — unchanged.
13. `{ type: 'date' }` with two clauses `[eq '2021-05-17', contains '17']` builds `{ type: 'and', filters: [<the eq bucket>, <the contains descriptor with its hint>] }`, in clause order.
14. `{ type: 'date' }` with `contains ''` (blank text) builds `null`, and a two-clause state whose only non-blank clause is the temporal `contains` unwraps to that clause's descriptor alone.
15. Worker safety: the descriptor from case 6 survives `structuredClone`, and `matchesFilter` returns the same result for the clone as for the original against a record holding `D` — added to the existing `worker safety` describe block, following its `assertCloneSafe` helper.

### `matchesFilter` (`FilterDescriptor.test.ts`)

All cases use record `{ due: D }` unless stated otherwise.

16. `contains` with needle `shown('date', false)` and `temporal: { type: 'date', showSeconds: false }` matches.
17. **Regression case.** `contains 'GMT'` with the same hint does **not** match, even though `String(D)` contains `GMT`.
18. `contains 'GMT'` with **no** `temporal` member matches — the pre-existing raw-value behaviour is untouched, and the hint is the only thing that changes it.
19. `startsWith` with needle `shown('date', false).slice(0, 3)` and the `date` hint matches; with needle `String(D).slice(0, 3)` (the weekday abbreviation the native form opens with) it does not.
20. `endsWith` with needle `shown('date', false).slice(-3)` and the `date` hint matches; with needle `String(D).slice(-3)` (the tail of the parenthesised timezone name) it does not.
21. `showSeconds` is honoured: `contains` with needle `shown('datetime', true)` matches under `temporal: { type: 'datetime', showSeconds: true }` and does not under `{ type: 'datetime', showSeconds: false }` — the shorter rendering cannot contain the longer needle.
22. `type` is honoured: `contains` with needle `shown('datetime', false)` does not match under `temporal: { type: 'date', showSeconds: false }`.
23. `contains` with needle `shown('time', false)` matches under `temporal: { type: 'time', showSeconds: false }`.
24. The hint is inert for a non-`Date` value: record `{ due: '2021-05-17' }` with the `date` hint matches `contains '2021'` and does not match `contains 'GMT'`.
25. `{ due: null }` and `{}` with a hint present both return `false` for all three operators, never throwing.
26. An invalid date (`{ due: new Date(NaN) }`) with the `date` hint matches `contains 'Invalid'` — `toLocaleDateString` and `String` both yield `"Invalid Date"`, so no guard is added and the filter still agrees with what the cell shows.

### `temporalDisplayText` (`temporalText.test.ts`)

27. `temporalDisplayText('date', false, D)` contains neither `'GMT'` nor `'('` — it is not the native `toString` form.
28. `temporalDisplayText('time', true, D).length > temporalDisplayText('time', false, D).length`, and the same relation holds for `'datetime'` — `showSeconds` widens the output.
29. `temporalDisplayText('date', true, D) === temporalDisplayText('date', false, D)` — `showSeconds` is ignored for `date`.

### Renderer parity (`cell/renderer.test.ts`)

30. `new DateRenderer().setValue(D).getDisplayText()` equals `temporalDisplayText('date', false, D)`; `new TimeRenderer(s).setValue(D).getDisplayText()` equals `temporalDisplayText('time', s, D)` for `s` both `true` and `false`; `new DateTimeRenderer(s)` likewise for `'datetime'`. This is the guard against the cell and the filter drifting apart. `setValue(null)` still yields `''` on all three.

### Manual verification

31. In the docs/demo app (`npm run dev`), on a table with a `date` and a `datetime` column, reveal the filter row, open a temporal column's operator menu, and confirm **Contains** / **Starts with** / **Ends with** appear after **At most** and before **Is empty**. Pick **Contains**, type a fragment of what the cells visibly show (e.g. the year), and confirm the rows narrow to the matching ones. Type a fragment of the native form (`GMT`) and confirm nothing matches.

---

## Verification

From `packages/lib`:

- `npm run typecheck` — zero errors. The widened union members and the `SubstringDescriptor` extraction are where a missed site surfaces.
- `npm run lint` — zero errors, including `local/no-raw-dom` over the new `data/temporalText.ts`.
- `npm run test` — the four edited/created test files plus the full existing suite unchanged. `FilterDescriptor.test.ts`'s pre-existing substring cases and `ColumnFilter.test.ts`'s existing string/combo/temporal cases are the regression guards that a hint-free descriptor behaves exactly as before.
- `npm run docs:api` — zero warnings. `TemporalDisplay` and `TemporalFieldType` must be reachable from `data/index.ts`, or TypeDoc reports the public `FilterDescriptor` union referencing an undocumented symbol.
- `grep -rn "toLocale" packages/lib/src/typescript/lib/component/table/` — zero matches (step 4).
- `grep -n "String(raw)" packages/lib/src/typescript/lib/data/FilterDescriptor.ts` — exactly one match (step 8).
- `grep -rn "~/component" packages/lib/src/typescript/lib/data/` — zero matches (step 9).
- Manual: run the docs/demo app and exercise case 31.

---

## Documentation Impact

- **`packages/lib/docs/components/Table.md`**
  - The operator table ([`Table.md:236-241`](../packages/lib/docs/components/Table.md#L236)): the `date`, `time`, `datetime` row gains `Contains, Starts with, Ends with` after `At most`. The `number` row is unchanged.
  - Add one bullet after the existing "**Equals on a temporal column matches every value that displays the same**" bullet ([`Table.md:244`](../packages/lib/docs/components/Table.md#L244)): Contains / Starts with / Ends with on a `date` / `time` / `datetime` column match the **displayed** text — the same string the cell shows, including its locale format and its `showSeconds` setting — not the underlying `Date`'s raw form.
- **`packages/lib/docs/data/store.md`** — in `## Sort and filter` ([`store.md:110-122`](../packages/lib/docs/data/store.md#L110)), add one sentence after the `setFilter` paragraph: a `contains` / `startsWith` / `endsWith` descriptor over a `Date`-valued field can carry `temporal: { type, showSeconds }`, which makes local evaluation match the value's rendered text; without it the raw `Date` string is matched, which is what a hand-built descriptor gets by default.
- **`packages/lib/docs/reference/changelog/next.md`** — one entry under `## Added` → `### Table`, in that section's existing bold-lead-sentence style: a `date` / `time` / `datetime` column's header filter now offers Contains / Starts with / Ends with, matching the displayed text rather than the raw `Date`; closing with "No consumer action is needed."
- **Barrels** — `data/index.ts` gains `TemporalDisplay` and `TemporalFieldType` (step 10). `component/table/index.ts` is unchanged. `temporalDisplayText` stays off every barrel, mirroring `compareValues`.
- **No `llms.txt` edit** — this extends an existing capability rather than adding a top-level one, matching both earlier filter plans.
- **No version bump** — handled separately at release time.

---

## Potential Challenges

- **Locale- and timezone-dependent test expectations.** A hard-coded `'5/17/2021'` passes on one runner and fails on another. *Mitigation:* the locale rule stated at the top of `## Expected Behaviour` — derive every expected string from `temporalDisplayText`, and draw negative needles from `String(D)`.
- **A temporal column whose stored values are strings rather than `Date` instances.** A store built without a typed `Field` never converts, so the hint finds no `Date` and the plain `String(raw)` path runs. *Mitigation:* none needed — that is the intended fallback, pinned by case 24.
- **The hint travels to a remote proxy.** `buildReadParams` copies active descriptors into `ReadParams.filters`, so `temporal` reaches a consumer's backend. *Mitigation:* none needed — it is an additive plain-data member that JSON-serializes; a backend that ignores unknown keys behaves exactly as it does today.[^wire-additive]
- **`toLocale*` inside a Web Worker.** `matchesFilter` runs in `StoreWorker` for stores over the offload threshold. *Mitigation:* none needed — these are `Date.prototype` methods available in every JavaScript realm, and `compareValues` already calls `localeCompare` on the same worker path.[^worker-locale]
- **A negative case matching by accident.** Cases 21 and 22 assert a *non*-match, and a non-match asserted against a hand-picked literal can pass for the wrong reason in another locale. *Mitigation:* both use a longer rendering as the needle against a shorter rendering as the haystack, so the non-match holds by construction in every locale — keep them phrased that way rather than substituting a literal.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/ColumnFilter.ts`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts) — the operator lists and `buildClauseFilter`'s branch order; read `buildComboFilter`, the temporal `eq` / `neq` branch, and `displayBucket` before editing so the new branch lands below them.
- [`packages/lib/src/typescript/lib/data/FilterDescriptor.ts`](../packages/lib/src/typescript/lib/data/FilterDescriptor.ts) — the union, the module doc's structured-clone rule, and the three substring cases being rewritten.
- [`packages/lib/src/typescript/lib/data/compareValues.ts`](../packages/lib/src/typescript/lib/data/compareValues.ts) — the precedent `data/temporalText.ts` mirrors: a pure, DOM-free, locale-sensitive module in `data/` shared by the main thread and the worker so the two can never drift.
- [`packages/lib/src/typescript/lib/component/table/cell/CellText.ts`](../packages/lib/src/typescript/lib/component/table/cell/CellText.ts) — the main-thread display-text facility, unchanged by this plan; read it to see why it cannot be the shared formatter.
- [`packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts), [`Time.ts`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts), [`DateTime.ts`](../packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts) — the three `setValue` bodies whose formatting moves out.
- [`packages/lib/src/typescript/lib/data/StoreWorker.ts`](../packages/lib/src/typescript/lib/data/StoreWorker.ts) — the worker-side `matchesFilter` call and the plain-snapshot shape it evaluates against.
- [`packages/lib/src/typescript/lib/component/table/Header.ts`](../packages/lib/src/typescript/lib/component/table/Header.ts) — `filterTarget` and `applyPendingFilter`; read-only confirmation that the hint's inputs already reach `buildColumnFilter`.
- [`packages/lib/tests/component/table/ColumnFilter.test.ts`](../packages/lib/tests/component/table/ColumnFilter.test.ts) — the `oneClause` helper, the `assertCloneSafe` worker-safety helper, and the locale-relational assertion style this plan's new cases follow.
- [`plans/implemented/cell-display-text.md`](implemented/cell-display-text.md) — establishes that substring and equality operators match display text while ordering operators stay value-typed, and that descriptors must survive the worker boundary; this plan finishes the temporal half of that rule.
- [`plans/implemented/table-column-filters.md`](implemented/table-column-filters.md) and [`plans/implemented/table-column-filter-multi-condition.md`](implemented/table-column-filter-multi-condition.md) — the filter row's original design and its clause-list extension, both inherited unchanged.

---

## Non-Goals

- **Substring operators on `number` or `boolean` columns.** A numeric column's users want ranges, not text fragments, and a boolean cell shows a checkbox with no text to match. Both operator lists stay as they are.
- **Any change to `gt` / `gte` / `lt` / `lte`.** They keep comparing a parsed operand against the raw stored value, for the reasons `cell-display-text.md` already recorded: lexical order over display text is wrong (`"10:00 AM" < "9:00 AM"` as strings), and an open-ended range cannot be expressed as a text match.
- **Any change to temporal `eq` / `neq`.** They already compile to the display bucket `and(gte, lt)`; this plan leaves that branch byte-identical.
- **A new `FilterDescriptor` variant.** The hint is an optional member on three existing members, so the store, the worker, and the remote serializer need no change.
- **Interpreting the hint on a server.** How a consumer's backend evaluates `{ type: 'contains', field, value, temporal }` against a date column is that application's concern. The library guarantees only that the hint is additive plain data that survives `JSON.stringify` and structured clone.
- **Display-text matching for a column with a custom `ColumnConfig.renderer`.** Unchanged: such a column declares no enumerable domain and no known temporal shape, so it keeps matching the stored value.
- **A configurable date format for filtering.** The formatter reproduces exactly what the renderer shows, with no options of its own — a second format would let the filter and the cell disagree, which is the whole defect being fixed.
- **Any change to `caseSensitive` handling.** Substring operators stay case-insensitive by default and honour `caseSensitive: true`, applied to the rendered text the same way it is applied to `String(raw)` today.
- **Routing `TableExporter` or `Table.getCellText` through the new module.** Both already resolve display text through `CellTextResolver` on the main thread and are correct as they stand.
- **A changelog version bump.** The entry lands in `next.md`; versioning is a separate release step.

---

## Implementation Notes

- **Step 8's `String(raw)` grep finds two matches, not one.** The plan calls
  for `grep -n "String(raw)" packages/lib/src/typescript/lib/data/FilterDescriptor.ts`
  to return "exactly one match, inside `substringOperands`" ([^extract-substring-helper]
  and `## Verification`). The plan's own `## Internal Structure` mandates
  `substringOperands`'s JSDoc verbatim, and that JSDoc itself contains the
  phrase "keeps the plain `String(raw)` coercion" — so the grep necessarily
  matches that comment line in addition to the actual coercion call two
  lines below it, two matches total. The module-level JSDoc sentence added
  in step 6 (whose wording the plan left open) was phrased to avoid the
  literal string, keeping the count at this minimum. The substantive claim
  the check exists to pin — exactly one place in the file still falls back
  to `String(raw)` — holds; only the literal grep count differs from what
  the plan's `## Verification` section states.

- **Case 31 is automated instead of manual-only, and touches two files
  outside `## Files to Create / Modify / Delete`.** The plan classifies case
  31 (the operator menu's order, and that Contains narrows rows while
  matching only displayed text) as needing a browser, and calls for a
  manual run as its only verification (`## Expected Behaviour` case 31,
  `## Verification`'s "Manual: run the docs/demo app and exercise case
  31"). That manual run was performed (confirmed against the docs/demo app:
  the operator menu shows Contains/Starts with/Ends with between At most
  and Is empty; typing a year narrowed rows on the `LastSeen` column;
  typing `GMT` matched none). Independently, `packages/lib/tests/component/table/ColumnFilterRow.test.ts`
  already has an offline harness (`comboTemporalTable`, built for the
  `cell-display-text` plan) that can drive the same menu-then-type flow
  without a browser, so cases 31a-31c were added there instead of leaving
  case 31 as manual-only — a strictly stronger regression guard than the
  plan called for. Adding them required hoisting the `comboTemporalTable`
  fixture and its `roleCell`/`meetCell` finders from describe-local scope
  to module scope in that file, so the new describe block could reuse them.
  Separately, `packages/lib/src/typescript/MiscPanel.ts`'s filter-row demo
  comment (naming which operators each demoed column type offers) was
  updated to keep describing the `Joined` date column accurately once it
  gained the three substring operators. Both files are outside the plan's
  file table because the plan did not anticipate either edit.

## Notes

[^time-in-scope]: The live-testing report that prompted this plan named "date and datetime filters", because those are the columns the tester exercised — not because `time` was considered and excluded. Including `time` costs nothing and excluding it costs a branch: all three types share one operator list, one `displayBucket` rule, one renderer family, and one `ColumnFilterTarget` shape today, so carving `time` out would split a currently-unified `switch` case and leave `time` as the only column type whose `Equals` matches displayed text while its substring operators are unavailable. A `time` cell displaying `02:30 PM` is also a natural target for `endsWith "PM"`. If a later decision does exclude `time`, it is a one-line change to the switch, not a redesign.

[^shared-pure-module]: The search for an existing "share pure formatting logic between a DOM-based renderer and a DOM-free evaluator" precedent found no module imported by both sides today, so this is a new instance — but it is assembled from two established patterns rather than invented. First, `data/compareValues.ts` is a pure, DOM-free, locale-sensitive module in `data/` imported by `AbstractStore` (main thread) and `StoreWorker` (worker), and its JSDoc names the reason: "the single comparator shared by the main thread and the `StoreWorker`, so the two sort paths can never drift". That is exactly this plan's requirement, one layer over. Second, `component → data` is an established import direction — `ColumnFilter.ts` already imports `~/data/Field.js` and `~/data/FilterDescriptor.js` — while `data → component` appears nowhere in the tree (verified: `grep -rn "~/component" packages/lib/src/typescript/lib/data/` is empty, and step 9 keeps it that way). Putting the formatter in `data/` therefore lets both sides import it without any new coupling. Two alternatives were rejected. Passing a `CellTextResolver` into `matchesFilter` breaks the module's stated contract that descriptors are structured-clone-safe plain objects and cannot work in the worker at all. Duplicating the format strings in `FilterDescriptor.ts` would recreate the exact drift `cell-display-text.md` was written to remove — four copies of the display-text rule, one per call site.

[^why-nested-hint]: Two flat optional members (`dateVariant?: 'date'|'time'|'datetime'` and `showSeconds?: boolean`) were considered, matching the flat shape of the neighbouring `caseSensitive?: boolean`. Rejected: the two values are meaningless apart — `showSeconds` alone says nothing, and a descriptor carrying only one of them has no defined behaviour — so a single nested object makes the "both or neither" rule structural instead of a convention, at the cost of six member declarations becoming three. The nested object is also one construction site in `buildClauseFilter` and one narrowing test in `matchesFilter`. A new descriptor variant (`containsDisplay`, say) was rejected for the reason `cell-display-text.md` gives for its own choices: a new variant obliges every consumer's remote filter compiler to learn a shape it has never seen, while an unknown optional member on a familiar variant is ignorable.

[^date-only-reformat]: The alternative — reformatting whenever the hint is present, regardless of the value's type — would call `toLocaleDateString` on a string or a number and throw, or silently coerce. Gating on `raw instanceof Date` also gives the store-shape fallback for free: a store whose temporal column holds ISO strings (no typed `Field`, so `Field.convertByType` never ran) keeps matching those strings verbatim, which is both what the user sees in that case and what the filter did before this plan.

[^operator-order]: Placing the three after the ordering operators keeps `eq` first, so `columnFilterOperators(type)[0]` — the default operator every `FilterCell` falls back to, and what `setOperators` collapses to on a recycle — is unchanged for temporal columns. Placing them first (as `STRING_OPERATORS` does) would silently change the default from Equals to Contains on every existing temporal column. Placing them last, after the emptiness operators, would break the established grouping where `isEmpty` / `isNotEmpty` close every list.

[^extract-substring-helper]: `CLAUDE.md`'s surgical-changes rule argues against touching working neighbours, and three inline copies of the four-line change would technically satisfy it. The helper is preferred because the change is *identical* in all three cases and the coercion rule is exactly the thing that must not drift between them — the same reasoning behind `isClauseEffective` being extracted so `buildColumnFilter`'s null-exclusion and `effectiveClauseCount` "can never drift apart". The extraction is bounded to the three cases being edited; no other case in `matchesFilter` is touched, and `readField` is reused rather than rewritten. The grep in step 8 pins the result: exactly one `String(raw)` coercion site survives.

[^worker-locale]: `Date.prototype.toLocaleDateString` / `toLocaleTimeString` / `toLocaleString` are ECMAScript/ECMA-402 methods on a built-in prototype, not DOM APIs, so they exist in a `Worker` global scope like any other language builtin. The in-repo proof is stronger than the spec argument: `compareValues` calls `av.localeCompare(bv)` and `StoreWorker.sortIndices` calls `compareValues` on every worker sort today. The other half of worker correctness is that the field's value still *is* a `Date` on the worker side — `applyViewOnWorker` ships `this._allRecords.map(r => r.getData())` through `postMessage` ([`AbstractStore.ts:2020`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L2020)), and structured clone preserves `Date` instances, so `raw instanceof Date` holds there exactly as it does on the main thread.

[^wire-additive]: `buildReadParams` copies `getActiveFilters()` into `ReadParams.filters` when `remoteFilter` is on, so the hint reaches a consumer's proxy. That is harmless in both directions: a backend that reads only `type` / `field` / `value` sees exactly the payload it sees today, and one that wants to honour the hint now has the column's rendering shape without having to guess it. Making a remote backend interpret the hint correctly is an application-level concern this plan deliberately does not touch — the library's contract stops at emitting a well-formed, serializable descriptor.
