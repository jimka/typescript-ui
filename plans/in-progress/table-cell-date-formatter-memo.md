---
touches-shared: [packages/lib/docs/reference/changelog/next.md, packages/qa/README.md]
---

# Table cell date-formatter memo — Implementation Plan

## Overview

Every date, time and datetime a table shows is formatted by one function,
[`temporalDisplayText`](packages/lib/src/typescript/lib/data/temporalText.ts#L23).
It calls `value.toLocaleDateString()`, `value.toLocaleTimeString(undefined, …)`
or `value.toLocaleString(undefined, …)`, building a fresh options object each
time ([`temporalText.ts:25-36`](packages/lib/src/typescript/lib/data/temporalText.ts#L25)).
Each of those calls also makes the engine construct a date-time formatter,
use it once and discard it. This plan builds six `Intl.DateTimeFormat`
instances at module scope instead — one per variant — and formats through them.

The change is confined to that one file. Its three callers keep their call
shape: the `Date`, `Time` and `DateTime` cell renderers
([`renderer/Date.ts:40`](packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L40),
[`Time.ts:43`](packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts#L43),
[`DateTime.ts:42`](packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts#L42))
and the store filter's substring path
([`FilterDescriptor.ts:78`](packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L78)).
CSV/JSON export, filter-build and quick search reach the same three renderers
through `CellTextResolver.text`
([`cell/CellText.ts:79-103`](packages/lib/src/typescript/lib/component/table/cell/CellText.ts#L79)),
so they inherit the memo too. Nothing is added to a barrel and no signature
changes.

**Render time is what justifies this change, and it is the only candidate of
the render-review campaign for which that is true.** On a 900-row table, a
filter update fell from 156.69 to 127.66 ms per driven unit — one drive of the
measured interaction — a **−29.04 ms, −18.5%** change, and a header-sort click
from 151.90 to 114.93 ms, **−36.97 ms, −24.3%**, with identical geometry on
both. The measured change removed about 321 formatter constructions per unit.[^measured]
The project's standing rule puts render time first and a work reduction with a
flat clock second; here the clock is the whole case, and the work counters
barely moved at all.[^rule]

Line numbers are as of `master` at `6db01b15`.

---

## Architecture Decisions

### The memo is module-level state in `data/temporalText.ts`

Six formatters live in a `Map` at module scope, built on first use, shared by
every caller of `temporalDisplayText` — the cells, the export/filter/search
resolver, and the store's substring filter, including the copy of the module
that runs inside the store worker.[^placement]

This mirrors two shipped patterns. `CellTextResolver` holds at most one
lazily-built renderer per variant, keyed on the type with `:seconds` appended
when seconds are shown ([`cell/CellText.ts:65`](packages/lib/src/typescript/lib/component/table/cell/CellText.ts#L65),
[`:85-92`](packages/lib/src/typescript/lib/component/table/cell/CellText.ts#L85));
this plan reuses that key spelling exactly. `component/editor/theme.ts` holds
its two built themes in module-level `let`s, built on first use and shared for
the life of the page ([`theme.ts:51-54`](packages/lib/src/typescript/lib/component/editor/theme.ts#L51)),
with a JSDoc paragraph stating why sharing is sound — the shape this module's
new JSDoc follows.

### Six formatters, keyed on the variant

The key is the field type with `:seconds` appended when `showSeconds` is set,
and each key has one fixed option set:

| Key | `Intl.DateTimeFormat` options | Replaces |
|---|---|---|
| `date` | `{ year: 'numeric', month: 'numeric', day: 'numeric' }` | `toLocaleDateString()` |
| `date:seconds` | same as `date` | `toLocaleDateString()` |
| `time` | `{ hour: '2-digit', minute: '2-digit' }` | `toLocaleTimeString(undefined, …)` |
| `time:seconds` | `{ hour: '2-digit', minute: '2-digit', second: '2-digit' }` | `toLocaleTimeString(undefined, …)` |
| `datetime` | `{ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }` | `toLocaleString(undefined, …)` |
| `datetime:seconds` | `{ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }` | `toLocaleString(undefined, …)` |

For each row, `new Intl.DateTimeFormat(undefined, options).format(value)`
produces the same string the replaced call produced, for any valid date.[^options-parity]
`date` ignores `showSeconds`, so its two keys hold equal formatters; the
duplicate is kept rather than normalised away.[^date-key]

### An invalid date keeps today's `toLocale*String` call

`temporalDisplayText` checks `Number.isNaN(value.getTime())` first and, for an
invalid date, delegates to a private function holding today's `switch` body
verbatim. A cached formatter's `format` throws on an invalid date where
`toLocale*String` returns text, so this branch is required, not defensive.[^invalid]

### Nothing invalidates the memo

A formatter depends on its option set and on the host's default locale and time
zone. No JavaScript API changes either default under a running page, so the
memo has no invalidation condition and the module gains no clearing function,
no generation counter and no public API.[^no-invalidation]

This is where the change differs from the campaign's other memos. The records
in [`size-hint-per-pass-memo`](plans/implemented/size-hint-per-pass-memo.md) and
[`border-region-size-memo`](plans/implemented/border-region-size-memo.md) are
keyed on a layout pass and a generation counter because their inputs move
constantly. A formatter's inputs do not move at all.

### The `g23.write-economy` ablation stays registered, with a README note

An ablation is a runtime patch the QA app applies to a built library to bound
what a candidate would pay off. The one that measured this change,
`g23.write-economy`, keeps its registration, its harness code and its tests.
Only its row in the README's ablation table gains a note saying its formatter
half now bounds an earlier build. This follows
[`motion-transform-inline`](plans/implemented/motion-transform-inline.md#L96),
which did the same for `g28.transform-inline`.[^ablation-stays]

---

## Internal Structure

All of this is new module-level code in
`packages/lib/src/typescript/lib/data/temporalText.ts`, above
`temporalDisplayText`:

```ts
/** A variant of {@link temporalDisplayText}: its field type, plus whether seconds show. */
type TemporalFormatKey = TemporalFieldType | `${TemporalFieldType}:seconds`;

/**
 * The options each variant formats with — the exact option objects this module
 * used to pass to `toLocaleTimeString` / `toLocaleString`, plus the numeric
 * year/month/day an optionless `toLocaleDateString()` adds for itself. Held at
 * module scope so no call builds one.
 */
const TEMPORAL_FORMAT_OPTIONS: Record<TemporalFormatKey, Intl.DateTimeFormatOptions> = {
    'date':             { year: 'numeric', month: 'numeric', day: 'numeric' },
    'date:seconds':     { year: 'numeric', month: 'numeric', day: 'numeric' },
    'time':             { hour: '2-digit', minute: '2-digit' },
    'time:seconds':     { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'datetime':         { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' },
    'datetime:seconds': { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
};

/**
 * One `Intl.DateTimeFormat` per variant, built on first use and held for the
 * life of the module — at most six. Never invalidated: a formatter depends on
 * nothing but its option set and the host's default locale and time zone, and
 * no API changes either default while the page runs. Constructing one is the
 * expensive half of formatting a date, which is why the instance is kept and
 * not the formatted text: the text differs per value, the formatter does not.
 */
const _formats: Map<TemporalFormatKey, Intl.DateTimeFormat> = new Map();

/**
 * The shared formatter for one variant, built on first use.
 *
 * @param key - The variant to format with.
 * @returns The formatter every caller of that variant shares.
 */
function temporalFormat(key: TemporalFormatKey): Intl.DateTimeFormat {
    let format = _formats.get(key);

    if (!format) {
        format = new Intl.DateTimeFormat(undefined, TEMPORAL_FORMAT_OPTIONS[key]);
        _formats.set(key, format);
    }

    return format;
}
```

`temporalDisplayText` becomes a two-line body, and today's `switch` moves into
a private function reached only by an invalid date:

```ts
export function temporalDisplayText(type: TemporalFieldType, showSeconds: boolean, value: Date): string {
    if (Number.isNaN(value.getTime())) {
        return temporalDisplayTextUncached(type, showSeconds, value);
    }

    const key: TemporalFormatKey = showSeconds ? `${type}:seconds` : type;

    return temporalFormat(key).format(value);
}
```

---

## Ordered Implementation Steps

Steps 1 and 2 are the test-first pair: write the cases, watch the ones marked
*red first* in `## Expected Behaviour` fail, then make them pass.

1. **Add the new cases to
   [`packages/lib/tests/unit/data/temporalText.test.ts`](packages/lib/tests/unit/data/temporalText.test.ts)**,
   cases 30–35 of `## Expected Behaviour`. Keep the file's three existing cases
   (27–29) and its `D` sample as they are. Number each new `it` title as the
   file already does (`'30. …'` through `'35. …'`).
   → verify: `npm test` — cases 30–34 pass against the unchanged source, case 35
   fails.

2. **Rewrite `packages/lib/src/typescript/lib/data/temporalText.ts`** as
   `## Internal Structure` shows: add `TemporalFormatKey`,
   `TEMPORAL_FORMAT_OPTIONS`, `_formats` and `temporalFormat`; rename the
   existing function body to a private `temporalDisplayTextUncached` with the
   same three parameters and the same `switch`, unchanged; give
   `temporalDisplayText` the new two-branch body. Leave `TemporalFieldType` and
   the `export` surface exactly as they are.
   → verify: `npm test` — all of 27–35 green.

3. **Update the JSDoc in the same file.** `temporalDisplayText`'s description
   currently promises "the same `toLocaleDateString` / `toLocaleTimeString` /
   `toLocaleString` calls the `Date` / `Time` / `DateTime` cell renderers use"
   ([`:11-14`](packages/lib/src/typescript/lib/data/temporalText.ts#L11)). Say
   instead that the text comes from a shared `Intl.DateTimeFormat` per variant,
   equal to what those calls produced, so a substring filter over a temporal
   column still matches what the cell shows. Give
   `temporalDisplayTextUncached` its own JSDoc naming its one production
   caller: an invalid date, whose text the engine's own calls define. Keep the
   `@internal` marker on the exported function.
   → verify: `npm run lint` and `npm run typecheck` clean.

4. **Add the changelog entry** to
   [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md#L408),
   as the last bullet of *Changed → Components*, immediately before the
   `### Layouts` heading, in the surrounding bold-lead-sentence style. Content
   per `## Documentation Impact`.
   → verify: the bullet sits under *Changed → Components*, not *Fixed*.

5. **Annotate the ablation's README row** at
   [`packages/qa/README.md:489`](packages/qa/README.md#L489), following the
   `g28.transform-inline` row's wording at
   [`:495`](packages/qa/README.md#L495). Append to the existing description:
   the formatter half no longer meets a table's cells on a library whose
   temporal text formats through its own cached formatters (from
   `table-cell-date-formatter-memo` on), because `data/temporalText.ts` calls
   `Intl.DateTimeFormat.format` directly and no longer reaches
   `Date.prototype`; `memo.intlHit` then counts only a panel's other
   `toLocale*String` callers, so the cell formatting it measured bounds an
   earlier build. Change nothing else in the row and nothing in
   `packages/qa/src/harness/ablations.ts`.
   → verify: `grep -n "g23.write-economy" packages/qa/src/harness/ablations.ts
   packages/qa/tests/ablations.test.ts packages/qa/sweeps/w3-0.sh` — the
   registration, the two registry lists and the four sweep cells are all still
   there.

6. **Regression sweep.** `grep -n "value.toLocale" packages/lib/src/typescript/lib/data/temporalText.ts`
   — expect exactly three matches, all inside `temporalDisplayTextUncached`
   (JSDoc prose naming those methods does not match this pattern).
   `grep -rn "temporalDisplayText(" packages/lib/src/` — expect the four
   pre-existing call sites, unchanged.
   → verify: `npm test`, `npm run typecheck`, `npm run lint`.

---

## Files to Create / Modify / Delete

| Action | File | Note |
|---|---|---|
| Modify | `packages/lib/src/typescript/lib/data/temporalText.ts` | the whole change |
| Modify | `packages/lib/tests/unit/data/temporalText.test.ts` | cases 30–35 |
| Modify | `packages/lib/docs/reference/changelog/next.md` | **shared** — `table-column-resize-outline-mode` also adds a changelog entry |
| Modify | `packages/qa/README.md` | **shared** — `table-column-resize-outline-mode` may annotate the `g22.settle-relay` row of the same table |

Both shared files take an independent bullet or table row, so the two plans
conflict only textually if they land in the same edit; order them either way
and re-read the section after the second one applies.

---

## Expected Behaviour

Every case is unit-testable offline, in
`packages/lib/tests/unit/data/temporalText.test.ts`. No manual verification is
owed: the change produces text, and every case compares that text against the
engine's own call rather than a literal, so it holds under any locale or time
zone — the convention
[`TableExporter.test.ts:121`](packages/lib/tests/component/table/TableExporter.test.ts#L121)
already labels "locale-agnostic". Cases 30–34 pass against today's source as
well and are the regression net; case 35 is the only one *red first*.

The sample is the file's existing `D = new Date(2021, 4, 17, 14, 30, 20)`.

30. `temporalDisplayText('date', false, D)` and `temporalDisplayText('date', true, D)`
    both equal `D.toLocaleDateString()`.
31. `temporalDisplayText('time', false, D)` equals
    `D.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })`,
    and `('time', true, D)` equals the same call with
    `second: '2-digit'` added.
32. `temporalDisplayText('datetime', false, D)` equals
    `D.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })`,
    and `('datetime', true, D)` equals the same call with `second: '2-digit'`
    added.
33. For an invalid date — `new Date(NaN)` — each of the six variants returns
    exactly what the matching engine call returns for it
    (`toLocaleDateString()`, `toLocaleTimeString(undefined, …)`,
    `toLocaleString(undefined, …)`), and none of them throws.
34. Two dates one second apart, formatted through `('datetime', true, …)`,
    produce different text; two calls with the same date and variant produce
    the same text. The formatter is shared, the text is not.
35. **Red first.** A fresh copy of the module constructs one formatter per
    variant and no more: with a counting stand-in installed on
    `Intl.DateTimeFormat`, ten calls of each of the six variants construct
    exactly six formatters, and
    every string still equals the matching engine call's. The fresh copy comes
    from `vi.resetModules()` plus a dynamic import, the idiom
    [`StoreWorkerClient.test.ts:9-20`](packages/lib/tests/unit/data/StoreWorkerClient.test.ts#L9)
    uses for the same reason.[^fresh-module]

Existing cases that must stay green **without being edited** — they compare the
library's rendered text against a live `toLocale*String` call, which makes them
the parity check on this change:

- [`renderer.test.ts:169`](packages/lib/tests/component/table/cell/renderer.test.ts#L169),
  [`:191`](packages/lib/tests/component/table/cell/renderer.test.ts#L191),
  [`:193`](packages/lib/tests/component/table/cell/renderer.test.ts#L193),
  [`:207`](packages/lib/tests/component/table/cell/renderer.test.ts#L207),
  [`:209`](packages/lib/tests/component/table/cell/renderer.test.ts#L209),
  [`:411`](packages/lib/tests/component/table/cell/renderer.test.ts#L411)
- [`TableExporter.test.ts:125`](packages/lib/tests/component/table/TableExporter.test.ts#L125)
  through [`:168`](packages/lib/tests/component/table/TableExporter.test.ts#L168)
- [`Table.test.ts:281`](packages/lib/tests/component/table/Table.test.ts#L281)
  and [`Body.test.ts:1153`](packages/lib/tests/component/table/Body.test.ts#L1153)
- [`renderer.test.ts:222`](packages/lib/tests/component/table/cell/renderer.test.ts#L222),
  the cell-versus-filter drift guard, and
  [`FilterDescriptor.test.ts:87`](packages/lib/tests/unit/data/FilterDescriptor.test.ts#L87)

---

## Verification

- `npm test` — runs `typecheck:test` then the whole suite. Cases 27–35 green,
  and the four files listed above green with no edits.
- `npm run typecheck` and `npm run lint` — clean.
- `grep -n "value.toLocale" packages/lib/src/typescript/lib/data/temporalText.ts`
  — exactly three matches, all inside `temporalDisplayTextUncached`.
- `grep -rln "Intl.DateTimeFormat" packages/lib/src/typescript/lib/` — exactly
  one file, `data/temporalText.ts`. This is the library's first `Intl`
  construction; a second file means it was added somewhere it was not asked for.
- `grep -rn "temporalDisplayText(" packages/lib/src/` — four call sites, the
  same four as before, none of them passing a locale. The function accepts no
  locale parameter and this plan does not add one.
- No QA measurement run is part of this plan. Re-measuring belongs to a
  separately authorised sitting, and the record already names the cells it
  would use: `panel=table-rows&n=900&update=filter&drive=update` and
  `panel=table-rows&n=900&drive=click` under `work=1&seam=1&geom=1`
  ([`sweeps/w3-0.sh:244-245`](packages/qa/sweeps/w3-0.sh#L244)).

---

## Documentation Impact

- **API reference: none.** `temporalDisplayText` is `@internal` and is not
  re-exported from any barrel, and `typedoc.json` sets `excludeInternal`, so
  nothing in this file renders on a docs page. `TemporalFieldType`, which
  [`data/index.ts:24`](packages/lib/src/typescript/lib/data/index.ts#L24) does
  export, is untouched. No `{@link}` is added from public JSDoc.
- **`packages/lib/llms.txt`: no change.** `scripts/llms/check-coverage.mjs`
  tracks concrete classes, and no class is added, removed or renamed.
- **Changelog** — [`next.md`](packages/lib/docs/reference/changelog/next.md#L408),
  *Changed → Components*, a new last bullet: a table's date, time and datetime
  cells format through one shared `Intl.DateTimeFormat` per variant instead of
  building a formatter per cell, which cost a filter update on a 900-row table
  18.5% of its time and a header-sort click 24.3% of its own. Say the
  consumer-facing consequence plainly — none: the text is identical, including
  the text an invalid date produces, and the same formatting still backs CSV
  and JSON export, the column filter row and quick search. The wording follows
  [`same-value-style-write-filter`](plans/implemented/same-value-style-write-filter.md),
  whose entry states engine work with no behaviour change the same way.
- **No migration note.** No signature, no export and no observable output
  changes, so `docs/reference/migration/next.md` is untouched.
- **No `docs/concepts/performance.md` section.** Every section there is a lever
  a consumer pulls; this memo is unconditional and has nothing to opt into.

---

## Potential Challenges

- **A test asserting a literal date string would pass only under the test
  machine's locale.** Every case compares against a live `toLocale*String`
  call instead, and case 35 compares the memo's output to that call too.
- **The module-level cache survives between cases in a file**, so a
  construction count taken with the module already warm reads zero. Case 35
  imports a fresh copy through `vi.resetModules()` for exactly that reason.
- **The counting stand-in must be usable with `new`.** Write it as a `function`
  expression that increments a counter and returns
  `new RealDateTimeFormat(...args)` — an arrow function or a class-less object
  method cannot be constructed. Save `Intl.DateTimeFormat` before the test and
  restore it in `afterEach`, since a leaked stand-in would follow the whole
  file.
- **`temporalText.ts` is also bundled into the store worker**, through
  `FilterDescriptor` →
  [`StoreWorker.ts:10`](packages/lib/src/typescript/lib/data/StoreWorker.ts#L10).
  Each worker gets its own six formatters, which is correct and needs no
  plumbing; nothing may be added to transfer a formatter across that boundary.
- **The invalid-date branch is easy to drop as dead code.** It is the one guard
  whose removal would turn a rendered cell into a thrown `RangeError`; case 33
  fails without it.

---

## Critical Files

- [`packages/lib/src/typescript/lib/data/temporalText.ts`](packages/lib/src/typescript/lib/data/temporalText.ts) —
  the whole change. The file is 38 lines, and the function this plan rewrites is
  the last 16 of them.
- [`packages/lib/src/typescript/lib/component/table/cell/CellText.ts:65`](packages/lib/src/typescript/lib/component/table/cell/CellText.ts#L65),
  [`:85-94`](packages/lib/src/typescript/lib/component/table/cell/CellText.ts#L85) —
  the precedent for the key and the lazy per-variant build, and the pool
  through which export, filter-build and quick search reach the renderers.
- [`packages/lib/src/typescript/lib/component/editor/theme.ts:51-54`](packages/lib/src/typescript/lib/component/editor/theme.ts#L51) —
  the precedent for module-level values built on first use and shared for the
  page's life, including the JSDoc paragraph shape that states why sharing is
  sound.
- [`packages/lib/tests/unit/data/StoreWorkerClient.test.ts:9-20`](packages/lib/tests/unit/data/StoreWorkerClient.test.ts#L9) —
  the fresh-module idiom case 35 needs.
- [`packages/lib/tests/component/table/cell/renderer.test.ts:164-230`](packages/lib/tests/component/table/cell/renderer.test.ts#L164) —
  the existing engine-parity assertions that must stay green untouched.
- [`packages/qa/src/harness/ablations.ts:1943-1975`](packages/qa/src/harness/ablations.ts#L1943) —
  `cacheDateFormatters`, the ablation code this plan ships as library code. Read
  it for the two cases it excludes (a non-string locale, an invalid date) and
  for the engine-comparison check this plan's tests replace.
- [`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md:775`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L775)
  and [`:896`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L896) —
  the measurement, and the standing rule the Overview scores this change
  against.
- [`plans/implemented/motion-transform-inline.md:96`](plans/implemented/motion-transform-inline.md#L96) —
  the precedent for leaving a shipped candidate's ablation registered and
  noting it in the README.
- [`plans/implemented/size-hint-per-pass-memo.md`](plans/implemented/size-hint-per-pass-memo.md) —
  the campaign's keyed-memo precedent, and the contrast this plan's
  no-invalidation decision rests on.

---

## Non-Goals

- **The filter-cell write guards are not in this plan.** Candidate G23 is named
  "table header and cell write economy" and its other half guards
  `FilterCell.setOperators`
  ([`cell/Filter.ts:265`](packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L265))
  and `applyOperatorFace`
  ([`:180`](packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L180)).
  Those two guards are **unattributed**: their counters do not appear in the
  header-sort click phase at all, and the group's DOM-write counter moved −0.4%
  on the filter update and not at all on the click. Nothing in the record
  attributes any of the measured time to them, so they are neither shipped nor
  rejected here.[^unattributed]
- **`AbstractCalendarDropdown`'s month header is left alone**
  ([`:770`](packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L770),
  [`:957`](packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L957)).
  It formats one label per month navigation with its own option set, and no
  measurement covers it.
- **No sweep of the other per-call platform constructors.**
  `Intl.NumberFormat`, `Intl.Collator`, `RegExp` compilation, `getComputedStyle`
  and `measureText` are the agenda's own separate discovery item, not this
  plan's.
- **The `g23.write-economy` ablation is not retired**, and neither its harness
  code nor its tests change. Retiring an ablation touches the harness, its
  tests, the README and the sweep script at once, and the sweep still requires
  the registration.[^ablation-stays]
- **No new public API.** No clearing function, no formatter accessor, no locale
  or time-zone parameter, and nothing added to a barrel.

---

## Notes

[^measured]: From [`00-post-campaign-agenda.md:775`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L775),
    twenty runs in one sitting on `master` at `fd3f5e29` under
    `work=1&seam=1&geom=1`, panel `table-rows` at n=900. The filter update read
    156.69 → 127.66 ms per unit against a 2.61 ms bracket. The header-sort click
    read 151.90 → 114.93 against a wide 20.31 bracket, but every arm repetition
    beat every plain repetition by at least 22.7 ms, which the record calls a
    stronger statement than the bracket rule makes. Geometry compared equal on
    both phases. The arm's own counter, `memo.intlHit`, stood at 4,494 per
    phase — about 321 `Intl.DateTimeFormat` constructions per unit. The same
    record states that the arm's DOM-write counter barely moved, which is why
    the candidate read as stalled for as long as it was scored on writes: what
    was left of it was CPU, which no write counter sees.

[^rule]: The rule, set by the user on 2026-09-26 and recorded at
    [`:896`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L896):
    render performance is the primary priority, a real work reduction is
    secondary, and a work reduction with a flat clock still ships unless it
    costs considerable code complexity. Scored on all three factors, this
    change is the mirror image of every other candidate the campaign measured.
    Render time: −18.5% and −24.3%, the campaign's only measured render-time
    win. Work: roughly neutral in the harness's terms, since the counters watch
    framework bookkeeping and not platform constructors. Complexity: one option
    table, a six-entry `Map`, a lazy build and a NaN guard, in the one file
    that already owned this formatting. Factor one alone decides it.

[^placement]: The alternative placements were rejected for coverage, not for
    cost. A formatter held per renderer instance would duplicate itself across
    every pooled cell renderer and would not serve
    [`FilterDescriptor.ts:78`](packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L78),
    which formats a `Date` while matching a substring filter and has no
    renderer at all — including in the store worker, where no component exists.
    A formatter held on `CellTextResolver` would cover export, filter-build and
    quick search and miss every on-screen cell, since a cell renderer is not
    built by the resolver. `data/temporalText.ts` is the one place all of them
    already meet.

[^options-parity]: `Date.prototype.toLocaleDateString` /
    `toLocaleTimeString` / `toLocaleString` each run their argument through
    ECMA-402's `ToDateTimeOptions(options, required, defaults)` and then
    construct an `Intl.DateTimeFormat` with the result; `Intl.DateTimeFormat`
    itself runs the same step with `required = "any"`, `defaults = "date"`.
    That step adds fields only when the options name no field of the `required`
    kind and no `dateStyle` / `timeStyle`. Every option set in the table names
    at least one field of both kinds, so nothing is added on either path — the
    formatter is constructed from exactly these options whichever route is
    taken. The single case where the routes could have differed is the
    optionless `toLocaleDateString()`, whose `ToDateTimeOptions(undefined,
    "date", "date")` adds numeric year, month and day; the `date` row writes
    those three out, so it matches too. `hour12` and `hourCycle` are passed by
    neither route and are resolved from the locale by both. The QA arm reached
    the same conclusion the long way round, reconstructing `ToDateTimeOptions`
    in full at [`ablations.ts:1994`](packages/qa/src/harness/ablations.ts#L1994)
    because it had to serve arbitrary option sets from arbitrary callers; this
    plan serves six fixed ones and needs none of that machinery.

[^date-key]: `temporalDisplayText('date', true, …)` is reachable — a column
    config may set `showSeconds` on a `date` field, and
    [`FilterDescriptor.ts:78`](packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L78)
    forwards whatever the descriptor carries — and case 29 already pins that it
    returns the same text as `showSeconds: false`. Normalising the flag away for
    `'date'` would save one formatter object and add a line of special-case
    reasoning to every reader; keeping the sixth key costs one `Intl`
    instance and keeps the key identical to the one
    [`CellText.ts:85`](packages/lib/src/typescript/lib/component/table/cell/CellText.ts#L85)
    already builds for the renderer pool.

[^invalid]: `Intl.DateTimeFormat.prototype.format` throws a `RangeError` for a
    non-finite time value, while each `toLocale*String` returns text for one —
    `"Invalid Date"` on every engine the library targets. An invalid `Date` is
    reachable: the three cell renderers guard on truthiness
    (`value ? temporalDisplayText(…) : ""`), and an invalid `Date` object is
    truthy. Keeping today's `switch` verbatim for that branch means the text an
    invalid date produces cannot change at all, even on an engine whose three
    methods disagree, and it costs one `Number.isNaN` on the fast path. The QA
    arm took the same exit, deferring to the original call when
    `Number.isNaN(this.getTime())` ([`ablations.ts:1951`](packages/qa/src/harness/ablations.ts#L1951)).

[^no-invalidation]: Two things could in principle make a cached formatter wrong:
    a different locale argument, and a change to the host's default locale or
    time zone. The first cannot happen — `temporalDisplayText` hard-codes
    `undefined` as the locale today and accepts no locale parameter, which the
    call-site grep in `## Verification` pins. The second has no JavaScript API: a page cannot set either
    default, and a formatter already constructed keeps its resolved time zone
    by specification. What remains is an operating-system time-zone or locale
    change while the page runs, after which a newly constructed formatter would
    resolve the new default and this module's cached ones would not. The
    divergence is accepted. Detecting it means constructing a formatter to read
    `resolvedOptions()`, which is the cost the memo exists to remove, and the
    library has no portable event for either change; a reload resolves it. Note
    also that an already-rendered cell does not re-format on such a change
    today either, since each renderer caches its display text and re-formats
    only when `setValue` runs.

[^ablation-stays]: [`packages/qa/tests/ablations.test.ts:198`](packages/qa/tests/ablations.test.ts#L198)
    and [`:218`](packages/qa/tests/ablations.test.ts#L218) require
    `g23.write-economy` to stay registered, and
    [`sweeps/w3-0.sh:234`](packages/qa/sweeps/w3-0.sh#L234),
    [`:244-246`](packages/qa/sweeps/w3-0.sh#L244) name it in four cells of the
    re-runnable W3.0 record. Its canvas test
    ([`ablations.canvas.test.ts:235`](packages/qa/tests/ablations.canvas.test.ts#L235))
    exercises the patch through `Date.prototype` directly rather than through
    the library, so it keeps passing unchanged after this plan lands.
    `motion-transform-inline` set the precedent for this exact situation: it
    declined to retire `g28.transform-inline` and added a README note instead,
    on the reasoning that retiring an ablation touches the harness, its tests,
    the README and the sweep script together and is therefore one QA change of
    its own.

[^fresh-module]: `_formats` is module-level, so the first case in the file to
    format a date fills it and every later case sees a warm cache — a
    construction count taken there would read zero whether or not the memo
    works. [`StoreWorkerClient.test.ts:9-20`](packages/lib/tests/unit/data/StoreWorkerClient.test.ts#L9)
    has the same problem with its module-level worker singleton and solves it
    with a `freshClient()` helper: `vi.resetModules()`, then
    `await import(...)`. Case 35 does the same, installing its counting
    stand-in before the import so the fresh copy's first construction is
    counted. Sixty calls across six variants make the assertion sharp: a
    correct memo constructs six formatters, and a per-call implementation
    constructs sixty.

[^unattributed]: [`:775`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L775)
    records that `skipped.operators` and `skipped.operatorFace` "do not appear
    in the `click` phase at all", while the group's DOM-write counter moved
    −0.4% on the filter update and was identical on the click. So the whole
    click win and most of the update win belong to the formatter memo. Shipping
    the two guards alongside it would fold an unmeasured change into a measured
    one and make the next measurement of either impossible to read. They keep
    whatever standing they had as part of G23; this plan simply does not decide
    them.

---

## Implementation Notes

The change landed as designed: `TemporalFormatKey`, `TEMPORAL_FORMAT_OPTIONS`,
`_formats`, `temporalFormat`, the two-branch `temporalDisplayText` and
`temporalDisplayTextUncached` holding the old `switch` verbatim, all in the one
file, with no signature and no export moved. Cases 30–34 passed against the
unchanged source and case 35 failed on 0 constructions, exactly as
`## Expected Behaviour` predicted; all nine passed after. The suite went from
514 files / 8582 tests (2 `todo`) to 514 files / 8588 tests (2 `todo`), all
green, and `npm run docs:api` still reports its 14 pre-existing warnings and no
new one. Four deviations are worth recording, the first of them a defect in the
verification this plan prescribed, and with them one note on how every
prescribed assertion was checked.

**The prescribed sample could not fail on a wrong option bag, which is the
whole risk this change carries.** `## Expected Behaviour` says "The sample is
the file's existing `D = new Date(2021, 4, 17, 14, 30, 20)`" and has cases
30–32 compare `temporalDisplayText` against the engine's own `toLocale*String`
call for that one value. `D`'s day (17), hour (14), minute (30) and second (20)
are two-digit already, so for four of the six fields the option table names,
`'numeric'` and `'2-digit'` render identically; only `D`'s month (5) is
single-digit. The assertion therefore checks the option bag on one field out of
five. Proved by mutation: changing `day: '2-digit'` to `day: 'numeric'` in both
`datetime` rows of `TEMPORAL_FORMAT_OPTIONS` leaves **all nine cases green**
with `D` alone, while shipping a formatter that differs from the call it
replaced for every date before the 10th of a month — precisely the silent
text change `[^options-parity]` reasons the plan safe against. The fix is a
second sample, `SINGLE_DIGIT = new Date(2021, 0, 5, 9, 8, 7)`, whose month,
day and hour are every one of them single-digit; cases 30–32 run over both, and
the same `day` mutation then fails case 32 with
`'01/5/2021, 09:08 AM'` against `'01/05/2021, 09:08 AM'`. `D` itself is
unchanged, and cases 27–29 still use it alone as step 1 required. The minute
and the second stay beyond reach of any sample, and the comment on
`SINGLE_DIGIT` says so: ICU pads both inside a time pattern whichever of
`'numeric'` and `'2-digit'` the option names, so setting `second` to
`'numeric'` leaves every case green. Of the option table's six fields, four —
year, month, day and hour — are now pinned, against one before.

**Case 35 also asserts that no construction is passed a locale.** The plan
specified a construction count and per-call parity. The memo's soundness
argument — `[^no-invalidation]`, and the `## Architecture Decisions` claim that
the key is complete — rests on the premise that no locale ever reaches
`Intl.DateTimeFormat`, so the locale needs no place in the key; the plan pinned
that premise with a call-site grep only, which cannot see what the constructor
is handed. The counting stand-in already receives the argument, so case 35
records it and asserts every one is `undefined`. Mutation-proved: passing
`'en-US'` explicitly — the host default under the test environment, so no text
moves — fails this assertion and nothing else.

**Every prescribed assertion was mutation-checked before the branch was
declared done.** Removing the `Number.isNaN` guard fails case 33 with
`RangeError: Invalid time value`; dropping `showSeconds` from the key fails 28,
31, 32, 34 and 35; dropping `type` from the key fails the same five; removing
the memo and constructing per call fails case 35 at 60 constructions against
6; caching the formatted text per variant instead of the formatter fails 30,
31, 32 and 34; the `day` slip above fails 32; and an explicit locale fails 35.
No prescribed assertion was left that a regression could pass.

**The QA README note rode in the documentation commit, not one of its own.**
`worker.md`'s step 8 says to give each `touches-shared` file its own commit,
while its own _Shared-file etiquette_ section and the `commit` skill both say a
shared file rides in its functionality's commit and never gets one to itself.
The latter pair governs, and `37a3f785` — `motion-transform-inline`'s docs
commit, the precedent `[^ablation-stays]` cites for this exact annotation — put
its own `g28.transform-inline` README note beside the changelog the same way.

**Line references are as of `master` at `6db01b15`, and this branch is phase 3
of a sequential batch.** On its start point, `feature/glyph-sprite-reset-hook`,
`packages/qa/README.md`'s `g23.write-economy` row is at 506 rather than 489 and
the `g28.transform-inline` row at 512 rather than 495, `cacheDateFormatters` is
at `ablations.ts:2156` rather than 1943, and the agenda's G23 section is at 791
with its "fix is six formatters" bullet at 814 rather than 775.
`next.md`'s `### Layouts` heading is at 408 exactly as step 4 said. No API,
signature or file-location drift: all four call sites, both precedents and the
`g23.write-economy` registration, its two registry lists and its four sweep
cells are where the plan describes them.
