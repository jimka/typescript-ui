---
touches-shared:
  - packages/lib/src/typescript/lib/data/Field.ts
  - packages/lib/src/typescript/lib/data/proxy/Writer.ts
  - packages/lib/src/typescript/lib/data/proxy/AjaxProxy.ts
  - packages/lib/src/typescript/lib/component/input/dateMath.ts
  - packages/lib/src/typescript/lib/component/input/TimeField.ts
  - packages/lib/src/typescript/lib/component/table/ColumnFilter.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Store Temporal Local Values — Implementation Plan

## Overview

The data layer loses the calendar day and the wall-clock time of a temporal value in both directions:

- **Reading.** `Field.convertByType` ([`Field.ts:190-199`](packages/lib/src/typescript/lib/data/Field.ts#L190)) converts every `date` / `time` / `datetime` value with `new Date(raw)`. That reads a bare `2026-06-28` as UTC midnight, which is 27 June in Los Angeles. It cannot read a time of day such as `09:30:00` at all: `new Date("09:30:00")` is an Invalid Date, so a store `time` column is always empty.
- **Writing.** `JsonWriter` ([`Writer.ts:105`](packages/lib/src/typescript/lib/data/proxy/Writer.ts#L105) and [`:117`](packages/lib/src/typescript/lib/data/proxy/Writer.ts#L117)) and `AjaxProxy`'s `filter=` parameter ([`AjaxProxy.ts:188`](packages/lib/src/typescript/lib/data/proxy/AjaxProxy.ts#L188)) write each `Date` with `JSON.stringify`, which calls `toISOString()`. That UTC instant no longer names the day or time the user saw. A `date` of 28 June typed in Tokyo is sent as `2026-06-27T15:00:00.000Z`.
- **Filtering.** The table's filter row parses a typed `2026-06-28` with `new Date(text)` ([`ColumnFilter.ts:319-323`](packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L319)), so it filters on the wrong day west of UTC.
- **Time of day.** `TimeField` puts a time on today's date ([`TimeField.ts:139`](packages/lib/src/typescript/lib/component/input/TimeField.ts#L139), [`:172`](packages/lib/src/typescript/lib/component/input/TimeField.ts#L172)), while the time cell editor, the filter row and the demos use 1 January 1970.

This plan adds one internal module, `data/temporalValue.ts`, and routes all four places through it. A bare date and a time of day are read as local values. `JsonWriter` writes each `Date` in its field type's form. `AjaxProxy` writes filter `Date`s as local ISO-8601 with the local offset. `TimeField` moves onto 1 January 1970. `JsonWriter.dataFor` becomes `protected`, so an app can extend dirty mode.

These are behaviour changes, so they go under **Breaking changes** in `changelog/next.md` with a `migration/next.md` page, for the next minor release (0.11.0). This plan does not bump a version or release: the release is run by hand, after SQLAdmin has checked the branch through a symlinked build (SQLAdmin plan `date-time-column-field-types`, in the sqladmin repo).

---

## Architecture Decisions

### One pure internal module, `data/temporalValue.ts`, next to `data/temporalText.ts`

Every read and write rule lives in a new DOM-free module under `data/`. It mirrors [`data/temporalText.ts`](packages/lib/src/typescript/lib/data/temporalText.ts): a pure temporal helper module, marked `@internal`, imported by `data/` and `component/` alike, and not re-exported from the barrel (only its types are).[^module-precedent]

`parseIsoDate` and its `ISO_DATE` regex move there from [`component/input/dateMath.ts:152`](packages/lib/src/typescript/lib/component/input/dateMath.ts#L152) and [`:208`](packages/lib/src/typescript/lib/component/input/dateMath.ts#L208), unchanged. `dateMath.ts` imports and re-exports `parseIsoDate`, so its importers (`DateField`, the date cell editor, `dateMath.test.ts`) do not change.[^data-not-component]

### `Field` reads a bare date or a time of day as a local value

`Field.convertByType` first tries a local reading for the field's type. Only when that returns `null` does it fall back to `new Date(raw)`, as today. The library's `DateField` and date cell editor already read `YYYY-MM-DD` as local midnight through `parseIsoDate`; the data layer is the last place still reading it as UTC.[^local-read]

| Field type | Raw value | Before | After |
|---|---|---|---|
| `date` | `"2026-06-28"` | UTC midnight (27 June, 17:00 in Los Angeles) | 28 June, 00:00 local |
| `datetime` | `"2026-06-28"` | UTC midnight | 28 June, 00:00 local |
| `time` | `"09:30:15.250000"` | `undefined` | 1 January 1970, 09:30:15.250 local |
| `time` | `"09:30"` | `undefined` | 1 January 1970, 09:30:00.000 local |
| `date` | `"2026-06-28T12:04:00Z"` | that instant | that instant (fallback, unchanged) |
| `datetime` | `"2026-06-28T12:04:59.5"` | local 12:04:59.500 | unchanged (fallback) |
| `time` | `"1/1/1970 02:30 PM"` (table paste) | 1 January 1970, 14:30 local | unchanged (fallback) |

The time-of-day reading accepts only two-digit `HH:MM[:SS[.fraction]]`, the form Postgres and Python's `isoformat()` write. Typed text keeps going through `dateMath`'s `parseClockTime`, which also accepts `9:5`.

| Raw | `parseIsoTimeOfDay` |
|---|---|
| `"09:30"` | 1970-01-01 09:30:00.000 local |
| `"09:30:15.25"` | 1970-01-01 09:30:15.250 local |
| `"09:30:15.123456"` | 1970-01-01 09:30:15.123 local (cut, not rounded) |
| `"24:00:00"` | `null` |
| `"9:30"` | `null` |
| `"09:30:00+02"` | `null` |

### Every time-of-day value sits on 1 January 1970, local

The time cell editor ([`editor/Time.ts:219`](packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts#L219) and [`:234`](packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts#L234)), the filter row ([`ColumnFilter.ts:279`](packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L279)), the table's paste path ([`Body.ts:2021`](packages/lib/src/typescript/lib/component/table/Body.ts#L2021)) and the demo ([`MiscPanel.ts:668`](packages/lib/src/typescript/MiscPanel.ts#L668)) already use 1 January 1970. `TimeField` is the one component that uses today's date. It moves to 1970, and `Field` reads a `time` value onto the same date.[^one-anchor]

| `TimeField` input | Before | After |
|---|---|---|
| typed `09:30` on 28 June 2026 | 28 June 2026, 09:30 local | 1 January 1970, 09:30 local |
| picked 14:45 from the dropdown | today, 14:45 | 1 January 1970, 14:45 |
| typed `+30mi` at 23:50 on 28 June 2026 | 29 June 2026, 00:20 | 1 January 1970, 00:20 |

A relative shorthand is still resolved against now; only its time of day is kept.

### `JsonWriter` writes each `Date` by its field type

`JsonWriter` looks up each top-level value's field in the record's model and writes a valid `Date` in the form that field type is read back in. Reads and writes then agree for every temporal type.[^write-form]

| Field type | `Date` (local) | Before (`toISOString`) | After |
|---|---|---|---|
| `date` | 28 June 2026, 00:00 in Tokyo | `2026-06-27T15:00:00.000Z` | `2026-06-28` |
| `time` | 1 January 1970, 09:30:15.250 in Kolkata | `1970-01-01T04:00:15.250Z` | `09:30:15.250` |
| `datetime` | 28 June 2026, 12:04:59.123 in Los Angeles | `2026-06-28T19:04:59.123Z` | `2026-06-28T12:04:59.123-07:00` |
| `datetime` | the same, host at UTC | `2026-06-28T12:04:59.123Z` | `2026-06-28T12:04:59.123+00:00` |
| any other type, or a key with no field | as `datetime` | as before | as `datetime` |

An Invalid `Date` is written as `null`, as `JSON.stringify` does today. A `Date` nested inside an object or array value keeps `JSON.stringify`'s own `toISOString()` form, because only a top-level field value has a field type to go by. A value that is not a `Date` is written exactly as before.

The conversion runs on `dataFor`'s result, after `dataFor` has chosen the fields. So a subclass that overrides `dataFor` still gets its `Date`s written by field type.

### `JsonWriter.dataFor` becomes `protected`

`dataFor` ([`Writer.ts:131`](packages/lib/src/typescript/lib/data/proxy/Writer.ts#L131)) changes from `private` to `protected`, with its body unchanged. An app that must also drop some columns (for example server-generated ones) can then extend `'dirty'` mode instead of re-implementing it.[^protected-datafor]

### `AjaxProxy` writes every filter `Date` with its local offset

A filter descriptor names a field but not its type, so `AjaxProxy` writes every `Date` in `filter=`, at any depth, in the `datetime` form above: local ISO-8601 plus the local UTC offset. It is the same instant as before, so any ISO parser reads the same moment, and it also carries the calendar day and wall-clock time the user saw.[^local-offset] `sort=` is unchanged; sorters carry no values.

| Browser zone | Filter `Date` (local) | Before | After |
|---|---|---|---|
| `America/Los_Angeles` | 28 June 2026, 00:00 | `2026-06-28T07:00:00.000Z` | `2026-06-28T00:00:00.000-07:00` |
| `Asia/Tokyo` | 28 June 2026, 00:00 | `2026-06-27T15:00:00.000Z` | `2026-06-28T00:00:00.000+09:00` |
| `Asia/Kolkata` | 1 January 1970, 09:30 | `1970-01-01T04:00:00.000Z` | `1970-01-01T09:30:00.000+05:30` |

An offset of zero is written `+00:00`, never `Z`, so every value has the same shape.

### Years outside 0000–9999 use ISO 8601's expanded form

`toLocalIsoString` and the `date` write form write a year from 0 to 9999 as four digits, zero-padded. Any other year is written as a sign plus six digits, the form `Date.prototype.toISOString()` uses, so no year is ever cut short.[^extended-year]

| Year | Written |
|---|---|
| 2026 | `2026-06-28…` |
| 999 | `0999-01-01…` |
| 0 | `0000-01-01…` |
| 10000 | `+010000-01-01…` |
| -1 | `-000001-01-01…` |

### The filter row reads a typed `YYYY-MM-DD` as a local day

`parseOperand`'s shared `'date' | 'datetime'` case ([`ColumnFilter.ts:319`](packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L319)) tries `parseIsoDate` first and falls back to `new Date(text)` only when that returns `null`. It is the same defect as `Field`'s, in a second place: `displayBucket` then builds the "Equals" bucket around the wrong day west of UTC.

| Column type | Typed | Operand before | Operand after |
|---|---|---|---|
| `date` | `2026-06-28` | UTC midnight | 28 June, 00:00 local |
| `datetime` | `2026-06-28` | UTC midnight | 28 June, 00:00 local |
| `datetime` | `2026-06-28 12:04` | 12:04 local (`new Date`) | unchanged |

### The change ships in the next minor, with a migration page

A consumer whose server reads `toISOString()` text, or whose code reads the date part of a `TimeField` value, sees different results after upgrading. Pre-1.0, such changes go out in a minor release with a migration note, as 0.10.0 did for its parsing changes.[^minor] This plan writes only to `changelog/next.md` and `migration/next.md`; [`release-steps.md`](release-steps.md) turns them into the numbered pages at release time.

---

## Public API

### `packages/lib/src/typescript/lib/data/proxy/Writer.ts`

```ts
export class JsonWriter implements Writer {
    // was `private`; now overridable. Body unchanged.
    protected dataFor(record: ModelRecord, operation?: WriteOperation): Record<string, any>;
}
```

`writeRecord` and `writeRecords` keep their signatures. No barrel change: `JsonWriter` is already exported from [`data/index.ts:37`](packages/lib/src/typescript/lib/data/index.ts#L37).

### `packages/lib/src/typescript/lib/data/temporalValue.ts` (new, `@internal`, not in the barrel)

```ts
/** Moved verbatim from component/input/dateMath.ts, with its ISO_DATE regex and comments. */
export function parseIsoDate(raw: string): Date | null;

/** `new Date(1970, 0, 1, hours, minutes, seconds, ms)`: the date every time-of-day value sits on. */
export function timeOfDay(hours: number, minutes: number, seconds: number, ms?: number): Date;

/** Two-digit `HH:MM[:SS[.fraction]]` as timeOfDay(…), to the millisecond; `null` otherwise. */
export function parseIsoTimeOfDay(raw: string): Date | null;

/** The local reading `Field` tries before its `new Date(raw)` fallback. */
export function parseLocalTemporal(type: TemporalFieldType, raw: string): Date | null;

/** `YYYY-MM-DDTHH:MM:SS.sss±HH:MM` in the host's local zone. */
export function toLocalIsoString(date: Date): string;

/** A `Date` in the write form for `type` (see the JsonWriter table); `null` for an Invalid Date. */
export function formatWireTemporal(type: FieldType | undefined, date: Date): string | null;

/** `JSON.stringify(value)`, except every `Date`, at any depth, becomes `formatWireTemporal(undefined, date)`. */
export function stringifyWithLocalDates(value: unknown): string;
```

`FieldType` comes from `~/data/Field.js` and `TemporalFieldType` from `~/data/temporalText.js`, both with `import type`. `Field.ts` imports `parseLocalTemporal` from `temporalValue.ts` as a value, so the type-only import back to `Field.ts` creates no runtime cycle. Mark every export `@internal — not re-exported from the package barrel.`, as `dateMath.ts` and `temporalText.ts` do.

---

## Internal Structure

### `temporalValue.ts` — reading

```ts
// `HH:MM`, `HH:MM:SS`, or `HH:MM:SS.fraction` — the forms Postgres and
// Python's isoformat() write a time of day in. Two-digit parts only: this reads
// stored values, not typed text (typed text goes through dateMath's
// parseClockTime, which also accepts `9:5`).
const ISO_TIME_OF_DAY = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;
```

`parseIsoTimeOfDay` rejects an hour of 24 or more and a minute or second of 60 or more, then returns `timeOfDay(h, m, s, ms)`. `ms` is the fraction right-padded with zeros and cut to three digits. Name the three range bounds and the three-digit millisecond width as module constants, each with a one-line reason, per the magic-number rule.[^own-constants]

```ts
export function parseLocalTemporal(type: TemporalFieldType, raw: string): Date | null {
    switch (type) {
        case 'date':
        case 'datetime':
            return parseIsoDate(raw);

        case 'time':
            return parseIsoTimeOfDay(raw);
    }
}
```

`parseIsoDate` accepts only a complete `YYYY-MM-DD`, so a `datetime` string with a time returns `null` here and goes through `new Date(raw)` as before.

### `temporalValue.ts` — writing

`toLocalIsoString` builds the text from the local getters (`getFullYear` … `getMilliseconds`) and `getTimezoneOffset()`. The offset's sign is inverted, because `getTimezoneOffset()` is positive west of UTC. A private `formatWireYear(year)` applies the expanded-year table for both `toLocalIsoString` and the `date` form.

```ts
export function formatWireTemporal(type: FieldType | undefined, date: Date): string | null {
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    switch (type) {
        case 'date':
            return formatWireDate(date);        // `${formatWireYear(y)}-MM-DD`, local

        case 'time':
            return formatWireTime(date);        // `HH:MM:SS.sss`, local

        default:
            return toLocalIsoString(date);
    }
}
```

`stringifyWithLocalDates` needs the replacer's `this`. `JSON.stringify` calls `Date.prototype.toJSON` before the replacer sees the value, so the replacer must read the original from its holder. It is therefore a `function` expression, not an arrow; say so in a comment:

```ts
export function stringifyWithLocalDates(value: unknown): string {
    return JSON.stringify(value, function (this: Record<string, unknown>, key: string, serialized: unknown): unknown {
        const raw = this[key];

        return raw instanceof Date ? formatWireTemporal(undefined, raw) : serialized;
    });
}
```

### `JsonWriter`

```ts
writeRecord(record: ModelRecord, operation?: WriteOperation): string {
    return JSON.stringify(this.toWireValues(record, this.dataFor(record, operation)));
}

writeRecords(records: ModelRecord[], operation?: WriteOperation): string {
    return JSON.stringify(records.map(record => this.toWireValues(record, this.dataFor(record, operation))));
}

// private: a copy of `data` with every top-level Date replaced by
// formatWireTemporal(record.getModel().getField(name)?.getType(), value);
// every other value unchanged.
private toWireValues(record: ModelRecord, data: Record<string, any>): Record<string, any>;
```

`ModelRecord.getData()` and `getChangedData()` are keyed by field name ([`ModelRecord.ts:489`](packages/lib/src/typescript/lib/data/ModelRecord.ts#L489), [`:505`](packages/lib/src/typescript/lib/data/ModelRecord.ts#L505)), which is what [`AbstractModel.getField`](packages/lib/src/typescript/lib/data/AbstractModel.ts#L137) looks up.

### `Field.convertByType`

Inside this case `this._type` is one of the three temporal types, so it narrows to `TemporalFieldType`.

```ts
case 'date':
case 'datetime':
case 'time': {
    if (raw instanceof Date) {
        return raw;
    }

    const local = typeof raw === 'string' ? parseLocalTemporal(this._type, raw) : null;

    if (local) {
        return local;
    }

    const date = new Date(raw);

    return isNaN(date.getTime()) ? undefined : date;
}
```

### `TimeField`

- `parseRaw` ([`TimeField.ts:123`](packages/lib/src/typescript/lib/component/input/TimeField.ts#L123)): the absolute branch returns `timeOfDay(time.hours, time.minutes, time.seconds)` in place of lines 139-142. The relative branch still resolves against `new Date()` (lines 124-131), then returns `timeOfDay(r.getHours(), r.getMinutes(), r.getSeconds())` of that result.
- `onTimeSelected` ([`TimeField.ts:171`](packages/lib/src/typescript/lib/component/input/TimeField.ts#L171)): `this.onDropdownSelected(timeOfDay(hours, minutes, seconds));`.
- Rewrite the three JSDoc blocks that say "today's date": the class JSDoc (lines 43-44), `parseRaw` (lines 116-118) and `onTimeSelected` (lines 167-169).

---

## Ordered Implementation Steps

Commit boundaries: steps 2-5 (the module and `Field`'s reading), step 6 (`JsonWriter`), step 7 (`AjaxProxy`), step 8 (the filter row) and step 9 (`TimeField`) are one code commit each; step 10 is the docs commit.

1. **Baseline.** From the repo root on local `master`: `npm test`, then `TZ=America/Los_Angeles npm test`, `TZ=Asia/Tokyo npm test` and `TZ=Asia/Kolkata npm test`. On `master` at `c8da6fba` the first two zones were measured green (8763 passed, 2 todo); record any pre-existing failure so it is not mistaken for a regression. Record `npm run docs:api`'s warning count.

2. **`packages/lib/tests/unit/data/temporalValue.test.ts`** (new, beside `temporalText.test.ts`) — the cases under _Expected Behaviour → `temporalValue`_. Red: the module is missing.

3. **`packages/lib/src/typescript/lib/data/temporalValue.ts`** (new) — move `ISO_DATE` ([`dateMath.ts:150-152`](packages/lib/src/typescript/lib/component/input/dateMath.ts#L150), with its comment) and `parseIsoDate` ([`dateMath.ts:196-228`](packages/lib/src/typescript/lib/component/input/dateMath.ts#L196), with its JSDoc) here verbatim. Add the SPDX header line every source file carries. Then add the new functions per _Public API_ and _Internal Structure_.

4. **`packages/lib/src/typescript/lib/component/input/dateMath.ts`** — delete the moved `ISO_DATE` and `parseIsoDate`. Add `import { parseIsoDate } from "~/data/temporalValue.js";` and `export { parseIsoDate };`. A bare `export … from` is not enough: `parseIsoDateTime` calls `parseIsoDate` at [line 296](packages/lib/src/typescript/lib/component/input/dateMath.ts#L296) and needs a local binding. Change the comment at [line 167](packages/lib/src/typescript/lib/component/input/dateMath.ts#L167) ("ISO_DATE above reads back exactly four") to "`parseIsoDate` in `data/temporalValue.ts` reads back exactly four", and `formatIsoDate`'s `{@link parseIsoDate}` (line 176) keeps working through the import. Run `npm test` — step 2 green, and `dateMath.test.ts`, `DateField.test.ts` and `editor.test.ts` still green.

5. **`packages/lib/tests/unit/data/Field.test.ts`** — replace the case at [line 43](packages/lib/tests/unit/data/Field.test.ts#L43), which pins UTC midnight, with the cases under _Expected Behaviour → `Field`_. Then change `convertByType` in **`data/Field.ts`** ([lines 190-199](packages/lib/src/typescript/lib/data/Field.ts#L190)) per _Internal Structure_, importing `parseLocalTemporal` from `~/data/temporalValue.js` and `TemporalFieldType` (type only) from `~/data/temporalText.js`. Green.

6. **`packages/lib/tests/unit/data/proxy/Writer.test.ts`** — add the `JsonWriter` cases under _Expected Behaviour_. Then in **`data/proxy/Writer.ts`**:
    - `writeRecord` ([line 105](packages/lib/src/typescript/lib/data/proxy/Writer.ts#L105)) and `writeRecords` ([line 117](packages/lib/src/typescript/lib/data/proxy/Writer.ts#L117)) go through a new private `toWireValues`, per _Internal Structure_. Import `formatWireTemporal` from `~/data/temporalValue.js`.
    - `dataFor` ([line 131](packages/lib/src/typescript/lib/data/proxy/Writer.ts#L131)) becomes `protected`.
    - Rewrite the class JSDoc ([lines 73-83](packages/lib/src/typescript/lib/data/proxy/Writer.ts#L73), "Default writer producing `JSON.stringify(record.getData())`…"): each `Date` is written in its field type's form (`date` → `YYYY-MM-DD`, `time` → `HH:MM:SS.sss`, anything else → local ISO-8601 with its UTC offset), and a subclass may override `dataFor` to change which fields are written. Rewrite `writeRecord`'s JSDoc (line 98), which quotes `JSON.stringify(dataFor(record, operation))`, to match. Describe `dataFor` in prose; do not `{@link}` it, since TypeDoc drops `protected` members.

    Green.

7. **`packages/lib/tests/unit/data/proxy/AjaxProxy.test.ts`** — add the filter case under _Expected Behaviour_. The existing case at [line 118](packages/lib/tests/unit/data/proxy/AjaxProxy.test.ts#L118) holds no `Date` and must pass unchanged. Then in **`data/proxy/AjaxProxy.ts`**, line 188 becomes `search.set('filter', stringifyWithLocalDates(params.filters));`, importing `stringifyWithLocalDates` from `~/data/temporalValue.js`. Leave `sort` (line 184) alone. Green.

8. **`packages/lib/tests/component/table/ColumnFilter.test.ts`** — two existing cases encode the UTC reading:
    - [line 222](packages/lib/tests/component/table/ColumnFilter.test.ts#L222) (`date gte … 2024-01-15`) expects `new Date('2024-01-15')`; it now expects `new Date(2024, 0, 15)`.
    - case 22c at [line 412](packages/lib/tests/component/table/ColumnFilter.test.ts#L412) derives its bucket from `new Date('2021-05-17')`, with a comment saying the typed date is read as UTC. It now expects `lo = new Date(2021, 4, 17)` and `hi = new Date(2021, 4, 18)`; replace the comment with one saying the typed date is read as a local day.

    Add the `datetime` case under _Expected Behaviour_. Then in **`component/table/ColumnFilter.ts`**, the `'date' | 'datetime'` case of `parseOperand` ([lines 319-324](packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L319)) returns `parseIsoDate(text)` when that is non-null and otherwise keeps its `new Date(text)` logic. Import `parseIsoDate` from `~/data/temporalValue.js`. Green.

9. **`packages/lib/tests/component/input/TimeField.test.ts`** — case 20 ([line 100](packages/lib/tests/component/input/TimeField.test.ts#L100)) asserts the pinned clock's date (`getFullYear` 2026, `getMonth` 0, `getDate` 31) at lines 103-105; change those three to 1970, 0, 1. Retitle the case at [line 72](packages/lib/tests/component/input/TimeField.test.ts#L72) ("date portion is today by contract") to say `setValue` keeps the `Date` it is given. Add the `TimeField` cases under _Expected Behaviour_. Then change **`component/input/TimeField.ts`** per _Internal Structure_, importing `timeOfDay` from `~/data/temporalValue.js`. Green.

10. **Docs** — per _Documentation Impact_.

11. **Checkpoint.** From the repo root: `npm test`; `TZ=America/Los_Angeles npm test`; `TZ=Asia/Tokyo npm test`; `TZ=Asia/Kolkata npm test`; `npm run typecheck`; `npm run lint`; `npm run docs:api` (no warning beyond step 1's count); `npm run docs:llms:check` (run `npm run docs:llms` if it reports drift); then **`npm run build:lib`** (not `npm run build`), so SQLAdmin can run against the branch through a symlink.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/data/temporalValue.ts` |
| Create | `packages/lib/tests/unit/data/temporalValue.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/dateMath.ts` |
| Modify | `packages/lib/src/typescript/lib/data/Field.ts` |
| Modify | `packages/lib/tests/unit/data/Field.test.ts` |
| Modify | `packages/lib/src/typescript/lib/data/proxy/Writer.ts` |
| Modify | `packages/lib/tests/unit/data/proxy/Writer.test.ts` |
| Modify | `packages/lib/src/typescript/lib/data/proxy/AjaxProxy.ts` |
| Modify | `packages/lib/tests/unit/data/proxy/AjaxProxy.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/ColumnFilter.ts` |
| Modify | `packages/lib/tests/component/table/ColumnFilter.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TimeField.ts` |
| Modify | `packages/lib/tests/component/input/TimeField.test.ts` |
| Modify | `packages/lib/docs/data/model.md` |
| Modify | `packages/lib/docs/data/proxy.md` |
| Modify | `packages/lib/docs/components/TimeField.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |
| Modify (only if `docs:llms:check` reports drift) | `packages/lib/llms.txt` |

---

## Expected Behaviour

Every case below is unit-testable and must pass in any host time zone. Build expected `Date`s with the local constructor (`new Date(2026, 5, 28)`), never from an ISO string without an offset, and derive expected offsets from `getTimezoneOffset()`. For a year below 100, build the `Date` and then call `setFullYear`, because the constructor maps years 0-99 to 1900-1999. The `TZ=` runs in step 11 prove it.

### `temporalValue`

- `timeOfDay(9, 30, 15, 250)` equals `new Date(1970, 0, 1, 9, 30, 15, 250)`; `ms` defaults to 0.
- `parseIsoTimeOfDay`: every row of the time-of-day table under _Architecture Decisions_.
- `parseLocalTemporal('date', "2026-06-28")` and `('datetime', "2026-06-28")` both equal `new Date(2026, 5, 28)`. `('date', "2026-02-30")`, `('date', "2026-06-28T00:00:00Z")` and `('datetime', "2026-06-28T12:04")` are `null`. `('time', "09:30")` equals `timeOfDay(9, 30, 0)`.
- `toLocalIsoString(new Date(2026, 5, 28, 12, 4, 59, 123))` starts with `2026-06-28T12:04:59.123` and ends with the offset computed from `getTimezoneOffset()` as `±HH:MM`. Under `TZ=UTC` it ends `+00:00`, never `Z`.
- `toLocalIsoString` over every row of the expanded-year table.
- `formatWireTemporal`: `('date', new Date(2026, 5, 28))` → `"2026-06-28"`; `('time', new Date(1970, 0, 1, 9, 30, 15, 250))` → `"09:30:15.250"`; `('datetime', d)`, `('auto', d)` and `(undefined, d)` → `toLocalIsoString(d)`; an Invalid `Date` → `null` for every type.
- `stringifyWithLocalDates({ d: new Date(2026, 5, 28), n: 1, s: "x", nil: null })` parses back to `{ d: toLocalIsoString(…), n: 1, s: "x", nil: null }`. A `Date` inside a nested array is converted too. An Invalid `Date` becomes `null`. A top-level `Date` becomes a JSON string. A value with no `Date` stringifies exactly as `JSON.stringify` does.

### `Field`

- A `date` field converts `"2026-06-28"` to a `Date` equal to `new Date(2026, 5, 28)`.
- A `datetime` field converts `"2026-06-28"` to `new Date(2026, 5, 28)`.
- A `time` field converts `"09:30:15.250000"` to `new Date(1970, 0, 1, 9, 30, 15, 250)`, and `"09:30"` to `new Date(1970, 0, 1, 9, 30)`.
- A `time` field still converts `"1/1/1970 02:30 PM"` (the table paste form) to `new Date(1970, 0, 1, 14, 30)` through the fallback.
- A `date` field still converts `"2026-06-28T12:04:00Z"` to that instant, and still maps `"not-a-date"` to `undefined`.
- A `datetime` field converts `"2026-06-28T12:04:00"` to `new Date(2026, 5, 28, 12, 4)` (offset-less means local, unchanged).
- A `Date` passes through by reference for all three types.

### `JsonWriter`

- For a model with fields `id` (primary key), `d: date`, `t: time`, `dt: datetime`, `a: auto`, `new JsonWriter().writeRecord(record)` writes `d` as `"2026-06-28"`, `t` as `"09:30:15.250"`, and `dt` and `a` as `toLocalIsoString(value)`.
- An Invalid `Date` in `dt` is written as `null`.
- A `Date` inside an object value of an `auto` field is written as its `toISOString()`.
- `writeRecords` applies the same forms to every record in the array.
- In `'dirty'` mode, an update with only `d` changed writes `{ d: "2026-06-28", id: … }`.
- A subclass that overrides `dataFor` to drop `a` writes the remaining fields with their `Date`s by field type. The subclass compiling at all proves `dataFor` is `protected`.
- Every existing `Writer.test.ts` case passes unchanged; none of them holds a `Date`.

### `AjaxProxy`

- The built read URL for `filters: [{ type: "gte", field: "d", value: new Date(2026, 5, 28) }]` carries a `filter=` whose decoded JSON value is `toLocalIsoString(thatDate)`.
- The existing `sort=` / `filter=` case (no `Date`) produces exactly the same URL as before.

### Filter row (`buildColumnFilter`)

- A `date` column, operator `eq`, text `2026-06-28` builds `and(gte new Date(2026, 5, 28), lt new Date(2026, 5, 29))`.
- A `date` column, operator `gte`, text `2024-01-15` builds `gte new Date(2024, 0, 15)`.
- A `datetime` column, operator `gte`, text `2026-06-28` builds `gte new Date(2026, 5, 28)`.
- A `datetime` column, operator `gte`, text `2026-06-28 12:04` still builds `gte new Date(2026, 5, 28, 12, 4)`.

### `TimeField`

- `parseRaw("09:30")` gives `new Date(1970, 0, 1, 9, 30)`.
- A dropdown pick, driven as `(field as any).onTimeSelected(14, 45, 0)`, leaves `getValue()` equal to `new Date(1970, 0, 1, 14, 45)`.
- With the system time at 28 June 2026, 23:50, `parseRaw("+30mi")` gives `new Date(1970, 0, 1, 0, 20)`.
- `setValue(new Date(2025, 5, 15, 9, 30))` still displays `09:30`, and `getValue()` returns that same date.

No case needs manual verification in the library. End-to-end behaviour (a real server, two browser time zones) is checked by SQLAdmin's plan against a symlinked `build:lib` of this branch, before the release.

---

## Verification

- `npm test`, `TZ=America/Los_Angeles npm test`, `TZ=Asia/Tokyo npm test`, `TZ=Asia/Kolkata npm test` — all green, including every case under _Expected Behaviour_.
- `npm run typecheck` and `npm run lint`.
- `npm run docs:api` — no warning beyond step 1's count. The new module is `@internal`, so no public JSDoc may `{@link}` it.
- `npm run docs:llms:check`.
- `grep -n "JSON.stringify(this.dataFor" packages/lib/src/typescript/lib/data/proxy/Writer.ts` — zero matches.
- `grep -n "JSON.stringify(params.filters" packages/lib/src/typescript/lib/data/proxy/AjaxProxy.ts` — zero matches.
- `grep -n "new Date()" packages/lib/src/typescript/lib/component/input/TimeField.ts` — one match: the relative-shorthand base in `parseRaw`.
- `grep -rn "ISO_DATE\|function parseIsoDate" packages/lib/src/typescript/lib/component` — zero matches.
- `grep -rn "from ['\"]~/component" packages/lib/src/typescript/lib/data` — zero matches.
- `npm run build:lib` succeeds.

---

## Documentation Impact

- **`packages/lib/docs/data/model.md`**
  - Field-type table ([lines 55-57](packages/lib/docs/data/model.md#L55)): `'date'` and `'datetime'` read a bare `YYYY-MM-DD` as local midnight; `'time'` reads `HH:MM[:SS[.fraction]]` as that time on 1 January 1970, local, to the millisecond.
  - Value-coercion paragraph ([line 65](packages/lib/docs/data/model.md#L65)): add one sentence saying so, and that any other temporal text still goes through `new Date(raw)`.
- **`packages/lib/docs/data/proxy.md`**
  - _Remote sort & filter_ ([lines 88-91](packages/lib/docs/data/proxy.md#L88)): a filter `Date` is sent as local ISO-8601 with its UTC offset (`2026-06-28T00:00:00.000-07:00`).
  - _Reader & Writer_ ([lines 170-176](packages/lib/docs/data/proxy.md#L170)) and _Writer mode_ ([line 216](packages/lib/docs/data/proxy.md#L216)) no longer say the body is `JSON.stringify(record.getData())`. They give the three write forms (`date` → `2026-06-28`, `time` → `09:30:15.250`, anything else → local ISO-8601 with offset). The _Writer mode_ section adds that a custom writer can subclass `JsonWriter` and override `dataFor` to change which fields are written, keeping the mode and the write forms.
- **`packages/lib/docs/components/TimeField.md`** — [line 5](packages/lib/docs/components/TimeField.md#L5) and the second bullet of _Notes_ ([line 52](packages/lib/docs/components/TimeField.md#L52)) say the date portion comes from the local clock. Both now say the value sits on 1 January 1970, local; a relative shorthand is resolved against now and then placed on that date.
- **`Writer.ts` JSDoc** — step 6.
- **`packages/lib/docs/reference/changelog/next.md`** — add the release's headings under the existing intro, in [0.10.0's](packages/lib/docs/reference/changelog/0.10.0.md) bold-lead-sentence style. Each _Breaking changes_ entry ends "See [Migration](/reference/migration/next) for the full note."
  - `## Breaking changes` → `### Data`:
    - **`JsonWriter` writes each `Date` in its field type's form** (`date`, `time`, and local ISO-8601 with offset for the rest), no longer `toISOString()`.
    - **`AjaxProxy`'s `filter=` writes each `Date` as local ISO-8601 with its offset.**
    - **A store reads a bare date as local midnight, and a `time` field reads `HH:MM[:SS[.fraction]]`.** A `time` column was always empty before.
  - `## Breaking changes` → `### Components`: **`TimeField` values sit on 1 January 1970**, not today's date.
  - `## Added` → `### Data`: **`JsonWriter.dataFor` is `protected`**, so a subclass can extend `'dirty'` mode.
  - `## Fixed` → `### Components`: **The table's filter row reads a typed `YYYY-MM-DD` as a local day**, so "Equals" and the ordering operators no longer land on the previous day west of UTC.
- **`packages/lib/docs/reference/migration/next.md`** — three sections under the existing intro, in [0.10.0's](packages/lib/docs/reference/migration/0.10.0.md) "**What changed and why.**" / "**Who needs to act.**" shape, each with a before/after pair from the tables under _Architecture Decisions_:
  - _A `Date` crosses the wire in local form._ A server that matches a trailing `Z`, or that keeps the first ten characters of a `date` value and relied on the day being UTC's, must parse the value by type instead. A consumer who needs the old body can pass a custom `writer`.
  - _A store reads a bare date or a time of day as a local value._ Code that relied on UTC midnight for a bare date, or on a `time` column being empty. State that 0.10.0's note "a store `time` or `datetime` column reads with `new Date(...)`" ([migration/0.10.0.md:595-596](packages/lib/docs/reference/migration/0.10.0.md#L595)) no longer holds for `time`, nor for a bare-date `datetime` value. The 0.10.0 page stays as it was released.
  - _`TimeField` values sit on 1 January 1970._ Code that reads the date part of a `TimeField` value, or compares it with today.
- **`packages/lib/llms.txt`** — regenerated by `npm run docs:llms` only if `docs:llms:check` reports drift.
- No barrel change: `temporalValue.ts` is internal, and `JsonWriter` is already exported.

---

## Potential Challenges

- **A time-zone-dependent test.** A new test that builds its expected value from an offset-less ISO string passes in one zone and fails in another. *Mitigation:* the step-11 `TZ=` runs; build every expected `Date` with the local constructor.
- **`time '24:00:00'`** is legal in Postgres but has no local `Date`. `parseIsoTimeOfDay` rejects it, and the fallback `new Date("24:00:00")` is an Invalid Date, so the field stores `undefined` as it does today.
- **An impossible bare date** such as `"2026-02-30"` fails `parseIsoDate` and still reaches the `new Date(raw)` fallback, which rolls it to 2 March UTC, as today. *Mitigation:* none needed here; a server never sends one (see _Non-Goals_).
- **An expanded-year `date` value** (`+010000-01-01`) is written by the new form but is read back through the fallback as UTC midnight, since `parseIsoDate` reads four-digit years only. *Mitigation:* none; no date field in the library can enter such a year by typing.
- **Midnight inside a DST gap.** In a zone whose DST change happens at midnight (America/Santiago), local midnight on the change day does not exist, so `parseIsoDate` returns 01:00 on that day. The `date` write form reads only the calendar day, so it still writes the right date. *Mitigation:* none needed; a `datetime` filter bound built on that day carries 01:00 and its real offset, which is the instant the user's local day starts.

---

## Critical Files

| File | Why |
|---|---|
| [`data/temporalText.ts`](packages/lib/src/typescript/lib/data/temporalText.ts) | The precedent for a pure internal temporal module under `data/`; `TemporalFieldType` lives here. |
| [`component/input/dateMath.ts`](packages/lib/src/typescript/lib/component/input/dateMath.ts) | `parseIsoDate` (208) moves out; `formatIsoDate` (185) is the four-digit year rule the wire form extends. |
| [`data/Field.ts`](packages/lib/src/typescript/lib/data/Field.ts) | `convertByType` (174), the read-side defect. |
| [`data/proxy/Writer.ts`](packages/lib/src/typescript/lib/data/proxy/Writer.ts) | `JsonWriter` (84), `dataFor` (131). |
| [`data/proxy/AjaxProxy.ts`](packages/lib/src/typescript/lib/data/proxy/AjaxProxy.ts) | `buildReadUrl`'s `filter=` (188). |
| [`component/table/ColumnFilter.ts`](packages/lib/src/typescript/lib/component/table/ColumnFilter.ts) | `parseTimeOfDay` (253), `parseOperand` (290), `displayBucket` (345), the temporal `eq` branch (462). |
| [`component/table/cell/editor/Time.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts) | The 1970-01-01 local convention (219, 234) `TimeField` moves to. |
| [`component/input/TimeField.ts`](packages/lib/src/typescript/lib/component/input/TimeField.ts) | `parseRaw` (123), `onTimeSelected` (171). |
| [`component/table/Body.ts:2021`](packages/lib/src/typescript/lib/component/table/Body.ts#L2021) | The paste path that feeds `Field` a `1/1/1970 …` string; must keep working through the fallback. |
| [`plans/implemented/date-roundtrip-and-tab-active-index.md`](plans/implemented/date-roundtrip-and-tab-active-index.md) | Its Non-Goals deferred the `new Date(text)` readings in `ColumnFilter` and `Field`, and years outside 0-9999; this plan takes up the first and the write side of the second. |
| [`release-steps.md`](release-steps.md) | How `next.md` becomes the numbered pages at release time. |

---

## Non-Goals

- **Routing `editor/Time.ts`, `ColumnFilter.parseTimeOfDay` or `Body.ts`'s paste through `timeOfDay`.** They already use 1 January 1970 and are correct; changing them is a refactor with no behaviour change.
- **Tightening `Field`'s `new Date(raw)` fallback.** An impossible date or a free-form string still goes through it as today; only well-formed bare dates and times of day change.
- **Reading or typing years outside 0000-9999.** Only the write form covers them, so no year is cut short.
- **`WebStorageProxy`.** It stringifies records and reads them back through the same `Field` conversion in the same browser, so its round trip is unaffected.[^write-form]
- **Showing seconds in `time` / `datetime` cells.** The `showSeconds: false` default stays.
- **Any version bump, tag or publish.** The release is run by hand after SQLAdmin verifies this branch through a symlinked `build:lib`.

---

## Notes

[^module-precedent]: The search for an existing home found `data/temporalText.ts`,
    added by `plans/implemented/date-column-filter-string-operators.md` as a pure,
    DOM-free temporal module shared by `data/FilterDescriptor.ts` and the table's
    renderers. The new module is the same kind of thing for values rather than
    display text, so it sits beside it and follows its conventions (`@internal`
    functions, types only in the barrel). Putting the new functions into
    `temporalText.ts` itself was rejected: that file is about locale display text
    and its memoised formatters, and the two concerns share nothing but the word
    "temporal".

[^data-not-component]: `Field.ts` needs `parseIsoDate`, and a `data/` module must
    not import from `component/`: no file under `data/` does today (the grep in
    _Verification_ keeps it so). Moving the function down into `data/` and
    re-exporting it from `dateMath.ts` keeps every existing import path working,
    so no component file changes for the move.

[^local-read]: `parseIsoDate` already carries the comment "Local midnight,
    appended so the day is not shifted by the UTC parse `new Date("YYYY-MM-DD")`
    would otherwise perform". 0.10.0 applied the same rule to the date-time cell
    editor, which used to read a date with no time as UTC midnight
    (`changelog/0.10.0.md:1557`). A `datetime` field gets the bare-date reading
    because a bare date stored in a date-time column means that local day too.
    `plans/implemented/date-roundtrip-and-tab-active-index.md` listed the
    lenient `new Date` in `Field.convertByType` as a non-goal, because no
    formatter there had to read its own output back. This plan adds exactly that
    pairing: `JsonWriter` now writes a `date` as `YYYY-MM-DD`, and `Field` must
    read it back as the same day.

[^one-anchor]: A `time` value's date part has no meaning, but it still takes part
    in every `getTime()` comparison: `ModelRecord`'s dirty check, the filter
    row's equality bucket, and sorting. With two anchors, a `TimeField` bound to
    a `time` field would mark an untouched value dirty, since today's 09:30 and
    1970's 09:30 differ. 1970 is chosen because the store, the cell editor, the
    filter row, the paste path and the demo already use it; only `TimeField`
    moves. Europe/London was UTC+1 all through 1970, so a 1970 value's offset
    there is `+01:00`; the `time` write form carries no offset, so that never
    shows.

[^write-form]: Once a `date` field holds local midnight, the old `toISOString()`
    form is wrong east of UTC. Tokyo's midnight on 28 June is
    `2026-06-27T15:00Z`, and a server that keeps the first ten characters stores
    the 27th. Fixing reads without fixing writes would turn a west-of-UTC display
    bug into an east-of-UTC data-corruption bug. Writing by field type gives each
    value the exact text a server stores for it: a bare date, a bare time, and
    for a date-time the local wall clock plus the offset that makes it an
    instant. Writing a `date` or `time` as a local-offset date-time would also
    work, but every server would then have to drop the time or the date again,
    and a `time` would carry the meaningless 1970 date. `WebStorageProxy` also
    stringifies records, but it reads them back through the same `Field`
    conversion in the same browser, so it is left alone.

[^protected-datafor]: SQLAdmin's `SqlAdminWriter` had to implement `Writer`
    itself and repeat the one-line dirty-mode rule, because `dataFor` is private
    and `writeRecord` serializes in the same call; a wrapper only ever sees the
    finished string. Composition was rejected for the same reason: stripping
    columns needs the data object before serialization. Making `dataFor`
    `protected` is the smallest change that lets a subclass reuse both the mode
    and the new write forms.

[^local-offset]: A filter operand has the same day problem as a written value: from
    a UTC instant alone the server cannot tell which local day a `date` operand
    meant. `AjaxProxy` builds `filter=` from descriptors, which name a field but
    not its type, so the type-based form is not available there. A local-offset
    ISO string is one type-agnostic rule that is still the same instant for any
    ISO parser, and it describes itself. A client-time-zone request header was
    rejected: it adds hidden state that changes the meaning of every value, and
    needs a zone database on the server.

[^extended-year]: ISO 8601's four-digit year covers 0000-9999; outside that range
    it needs an agreed expansion, and `Date.prototype.toISOString` uses a sign
    plus six digits (`+275760-09-13T…`). Using the same form keeps a year from
    ever being cut short or silently misread. `dateMath`'s `formatIsoDate` writes
    a negative year as a sign plus four digits (`-0001`); it is `DateField`'s
    display format and is left alone.
    `plans/implemented/date-roundtrip-and-tab-active-index.md` deferred expanded
    years for the typed form; this plan does not change that.

[^own-constants]: `dateMath.ts` has `HOURS_PER_DAY`, `MINUTES_PER_HOUR` and
    `SECONDS_PER_MINUTE`, but `temporalValue.ts` cannot import from
    `component/`. Moving them down as well would widen the move to three more
    symbols and `parseClockTime`'s body for no behaviour change, so the new
    module declares its own module-private constants with a comment naming the
    `dateMath` ones they mirror.

[^minor]: `release-steps.md` renames `changelog/next.md` and `migration/next.md`
    to the version at release time and fixes the `/reference/migration/next`
    links, which is why the changelog entries link there. Version bumps, tags
    and the publish stay manual. The release waits until SQLAdmin has driven
    this branch through a symlinked `build:lib`, because the app is the second
    consumer that catches what the library's own tests miss.

---

## Implementation Notes

- **Baseline (step 1).** On this branch's start point (`feature/spatial-navigation-region-chord-default`, `1134d6a4`), `npm test` passed 8765 tests (2 todo) under the host zone (Europe/Stockholm), `America/Los_Angeles`, `Asia/Tokyo` and `Asia/Kolkata`; no pre-existing failure. `npm run docs:api` reported 0 errors and 14 warnings, all pre-existing and none in code this plan touches (six on `MarkdownEditor`, three on `MarkdownViewer`, three on `SpatialNavigation` and one on `rankInDirection` from the base branch, one on `FieldDecorator`); the count and the set are unchanged after this work.
- **`Field.convertByType` needs no `TemporalFieldType` import.** The plan called for importing the type to narrow `this._type`; TypeScript already narrows `this._type` inside the `'date' | 'datetime' | 'time'` case, so `parseLocalTemporal(this._type, raw)` typechecks with no import and no cast.
- **The `TimeField` dropdown-pick test installs the test DOM.** `onDropdownSelected` re-fires `input` on the inner field through `Event.fireEvent`, which throws for a component that is not in the DOM. The case follows `DateField.test.ts`'s clipboard re-fire precedent: `installTestDOM` in `beforeEach`, the inner input's element materialised, and `dispose` + `DOM.reset` in `afterEach`.
- **Verification grep false positive.** `grep -rn "ISO_DATE\|function parseIsoDate" …/component` matches `dateMath.ts`'s `function parseIsoDateTime`, which the plan keeps there; `ISO_DATE` and `parseIsoDate` itself are gone from `component/`. The other four greps give the counts the plan expects.
- **Offsets before standard time.** For a date in a zone's local-mean-time era (before about 1900 in the zones tested, e.g. year 999), V8's `getTimezoneOffset()` truncates an offset such as Kolkata's `+05:53:28` to whole minutes while the local getters use the full offset, so `toLocalIsoString` names an instant up to a minute away from `toISOString()`'s. The plan specifies building the text from the local getters and `getTimezoneOffset()`, and ISO 8601 offsets carry no seconds, so this was left as is; it cannot arise for a date after a zone adopted standard time.
- **Extra zone.** Besides the plan's three `TZ=` runs, the full suite was also run under `TZ=UTC` to exercise the `+00:00` (never `Z`) case: 8815 passed (2 todo) in all five zones.
- **What was checked live vs. by unit tests only.** Live, in Chrome against the lib demo served by `vite` from this worktree (browser zone Europe/Stockholm only; the browser's zone could not be switched): the `Field` reads of `2026-06-28` (`date`, local midnight) and `09:30:15.250000` (`time`, 1 January 1970 09:30:15 local); `JsonWriter.writeRecord` producing `{"id":1,"d":"2026-06-28","t":"09:30:15.250","dt":"2026-06-28T12:04:59.123+02:00"}`; `AjaxProxy`'s built `filter=` carrying `2026-06-28T00:00:00.000+02:00`; and the demo's `TimeField` committing 1 January 1970 15:00 for a dropdown pick of hour 15 and 1 January 1970 07:32:40 for a typed `+30mi` at 07:02:41 on 29 September 2026. Unit tests only: the other three zones (and UTC), the filter row's typed-date parsing, invalid and nested `Date`s, `'dirty'` mode, the `dataFor` subclass, and the expanded-year forms.
