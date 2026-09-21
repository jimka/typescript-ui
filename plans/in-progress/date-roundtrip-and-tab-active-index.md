---
touches-shared: [packages/lib/docs/reference/changelog/next.md]
---

# Date Round-Trips And Tab Active Index — Implementation Plan

## Overview

Three follow-ups left by
[`plans/implemented/tooltip-picker-and-serialization-fixes.md`](plans/implemented/tooltip-picker-and-serialization-fixes.md),
the plan that fixed the correctness-register entries C23 (strict date parsing
in the picker fields) and C29 (transient children in a saved `Split`), and
recorded in
[`01-phase2-status-pass.md`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L378)
under "Follow-ups the phase 2 implementation surfaced". Each one was checked
against `master` with an offline probe; the "Today" columns in
`## Expected Behaviour` are that probe's readings.

1. **The table's temporal cell editors still parse leniently.**
   [`editor/Date.ts:199`](packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts#L199)
   parses through `new Date(raw + 'T00:00:00')`, so a date cell commits
   `2025-02-30` as 2 March and `2026` as 1 January.
   [`editor/DateTime.ts:261`](packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts#L261)
   has the same hole and also reads a date with no time as UTC midnight.
   [`editor/Time.ts:204-209`](packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts#L204)
   hands split numbers to `new Date`, so `25:00` commits 01:00 the next day.
2. **The date formatters do not zero-pad the year.**
   [`DateField.ts:101`](packages/lib/src/typescript/lib/component/input/DateField.ts#L101),
   [`DateTimeField.ts:111`](packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L111),
   [`editor/Date.ts:220`](packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts#L220)
   and
   [`editor/DateTime.ts:275`](packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts#L275)
   write the year 999 as `999`. The strict parser reads exactly four year
   digits, so the text a field displays for such a date cannot be read back.
   The time formatters and every other date writer in the library are
   unaffected.
3. **`Tab`'s `activeIndex` does not survive the save/restore boundary.**
   [`layout/LayoutSerialization.ts:263`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L263)
   copies `Tab.getActiveTabIndex()`, which counts positions in the tab strip
   (the row of tab buttons). The captured `children` count something else: the
   container's children, minus any child marked `transient` in its layout
   constraints. A transient child is chrome that is shown as a tab but never
   saved, such as a `Dock`'s empty-state start page. A transient tab ahead of
   the active one, or a drag reorder of the strip, makes the restore activate
   a different tab. On the restore side,
   [`populateContainer`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L577)
   skips any saved child that the caller's `LayoutFactory` (the callback that
   maps a saved panel id to a live component) no longer supplies. It then
   applies the saved index unchanged, so the index shifts again.

The fixes touch eight source files, five test files and two documentation
pages. No exported signature changes.

---

## Scope

**One plan, four code commits.** The items share no code path. They are
planned together the way the C23/C29 plan grouped its three bugs, and each
functionality gets its own code commit so a bisect isolates it. Item 3 is two
commits, because its capture half and its restore half are separate defects
with separate triggers.[^one-plan]

The shared shape is the one the precedent named: a rule applied to the wrong
set of things.

| # | Rule | Applied to today | Should be applied to |
|---|---|---|---|
| 1 | "typed date text must be complete and name a real value" | the three picker fields | the fields **and** the three table cell editors |
| 2 | "a date's text is what the strict parser reads back" | years 1000–9999 | every year 0–9999 |
| 3 | "`activeIndex` names the active child among `children`" | the manager's tab-strip index | the captured children on save, the placed children on restore |

---

## Architecture Decisions

### Item 1 — the cell editors parse through the shared `dateMath` helpers

`DateEditor`, `DateTimeEditor` and `TimeEditor` read typed text through the
same `dateMath` parsers their form-field siblings use: `parseIsoDate`, a new
`parseIsoDateTime`, and `parseClockTime`. They do not route through the
fields.[^not-the-field] This mirrors how C23 shared the rule: `DateField`
calls `parseIsoDate`
([`dateMath.ts:180`](packages/lib/src/typescript/lib/component/input/dateMath.ts#L180))
and `TimeField` calls `parseClockTime`
([`dateMath.ts:212`](packages/lib/src/typescript/lib/component/input/dateMath.ts#L212))
instead of each owning a copy.

`TimeEditor` is included although the follow-up names only the date and
date-time editors. It rolls `25:00` into 01:00 the next day, which is the same
defect.[^time-editor]

### Item 1 — `DateTimeField`'s composition moves into `dateMath` as `parseIsoDateTime`

The absolute branch of `DateTimeField.parseRaw`
([`DateTimeField.ts:144-164`](packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L144))
moves unchanged into a new `parseIsoDateTime(raw)`. `DateTimeField` and
`DateTimeEditor` both call it, so the "exactly two whitespace-separated parts"
rule exists once.[^extract-datetime]

### Item 1 — a rejected value is an unparseable one, and the cell already reverts it

An editor caches `null` for text its parser rejects, exactly as it does today
for text that is not a date at all. No new rejection handling is added.
`DateCell`, `TimeCell` and `DateTimeCell` already override `commitEdit`
([`cell/Date.ts:44-62`](packages/lib/src/typescript/lib/component/table/cell/Date.ts#L44))
to cancel the edit when the editor holds non-empty text and a `null` value.
Cancelling keeps the cell's previous value, and
[`TableInternals.md:57`](packages/lib/docs/components/TableInternals.md#L57)
documents that contract.[^revert-contract]

| Typed into a date cell | Editor caches | On commit |
|---|---|---|
| `2025-02-30` | `null`, text non-empty | reverts to the previous value; no `commit` event |
| *(cleared)* | `null`, text empty | commits `null` |
| `2025-06-15` | 15 Jun 2025 | commits 15 Jun 2025 |

### Item 2 — one `formatIsoDate` in `dateMath`, the inverse of `parseIsoDate`

A new `formatIsoDate(date)` writes the `YYYY-MM-DD` date. `DateField.formatValue`,
`DateTimeField.formatValue`, `DateEditor.setValue` and
`DateTimeEditor.toInputString` all call it. The four copies of the date format
become one function that sits beside its parser.[^date-half-only]

The year is zero-padded to four digits. A negative year keeps its sign in
front of the padded digits.

| Local date | `formatIsoDate` | `parseIsoDate` of that text |
|---|---|---|
| 16 Sep 2026 | `2026-09-16` | 16 Sep 2026 |
| 1 Jan 999 | `0999-01-01` | 1 Jan 999 |
| 1 Jan, year 50 | `0050-01-01` | 1 Jan, year 50 |
| 1 Jan, year 0 | `0000-01-01` | 1 Jan, year 0 |
| 1 Jan, year −1 | `-0001-01-01` | `null` |
| 1 Jan 10026 | `10026-01-01` | `null` |

The last two rows cannot be typed back before or after this fix. Years outside
0–9999 are out of scope.[^year-domain]

### Item 3 — the captured active index is found by identity

The `Tab` branch of `nodeFor` stops copying `Tab.getActiveTabIndex()`. It
looks up `Tab.getActiveContent()` in the captured children and records that
position. When no captured child is active, it records `0`.[^first-tab-fallback]

Copying is wrong because the manager's index and the captured `children`
count different lists. `getActiveTabIndex()` counts tab-strip positions. The
strip includes a transient tab, and a drag reorder changes the strip's order
but not the container's. The captured `children` follow the container's order
and leave transient children out.[^identity-not-index]

This is the identity lookup `Tab._onBarReordered`
([`layout/Tab.ts:1111-1124`](packages/lib/src/typescript/lib/layout/Tab.ts#L1111))
already uses to keep its own selection across a reorder: it holds on to the
active entry, re-sorts, and asks where that entry now sits.

| Container children | Strip order | Active | Captured `children` | `activeIndex` today | After |
|---|---|---|---|---|---|
| P\* A B C | P A B C | B | a b c | 2 (restores C) | 1 |
| A B C P\* | A B C P | B | a b c | 1 | 1 |
| A P\* | A P | P | a | 1 | 0 |
| A B C | C A B (reordered) | A | a b c | 1 (restores B) | 0 |

P\* is a child whose layout constraints carry `transient: true`. A, B and C
are captured as panel nodes with ids `a`, `b` and `c`.

### Item 3 — the restore re-aligns the active index to the tabs actually placed

`populateContainer`'s `Tab` branch subtracts one from the saved `activeIndex`
for every skipped child ahead of it, then applies the result. A child is
skipped when its factory yields nothing. The `Split` branch already re-aligns
its ratios and collapsed flags to the panes that landed, through its `placed`
list
([`layout/LayoutSerialization.ts:540-557`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L540)).[^restore-realign]

Rule: the restored active tab is the one at *(saved index − skipped children
before it)*, clamped to the last placed tab by `setActiveTabIndex`. When the
saved active child is itself skipped, that picks the child that slid into its
slot.

| Saved children | Saved `activeIndex` | Skipped | Placed | Active today | After |
|---|---|---|---|---|---|
| a b c | 1 | a | b c | c | b |
| a b c d e | 2 | a b c | d e | e | d |
| a b c | 1 | c | a b | b | b |
| a b c | 1 | b | a c | c | c |

### Item 3 — no schema change

`TabNode` keeps its shape and `LayoutState.version` stays `1`. A state saved
before this fix restores exactly as it did, except where a skipped leaf sits
ahead of the active one, which now gets the same correction as a new
state.[^wild-states]

---

## Public API

No exported class or component signature changes. Two functions are added to
the `@internal`, un-barrelled `dateMath` module:

```typescript
// packages/lib/src/typescript/lib/component/input/dateMath.ts

export function formatIsoDate(date: Date): string;

export function parseIsoDateTime(raw: string): Date | null;
```

`DateEditor`'s private `toInputString` is deleted. Rendered JSDoc changes on
`DateEditor`, `DateTimeEditor`, `TimeEditor` (class comments),
`TabNode.activeIndex` and `Tab.getActiveTabIndex`. None of them changes a
signature.

---

## Internal Structure

### `dateMath` — the two new functions

Insert the constants and `formatIsoDate` immediately above `parseIsoDate`'s
JSDoc
([`dateMath.ts:168`](packages/lib/src/typescript/lib/component/input/dateMath.ts#L168)):

```typescript
// ISO 8601 writes a calendar year as four digits, and ISO_DATE above reads
// back exactly four, so a shorter year is zero-padded to that width.
const ISO_YEAR_DIGITS = 4;

// ISO 8601 writes the month and the day as two digits each.
const ISO_MONTH_DAY_DIGITS = 2;

/**
 * Formats the local calendar date of `date` as `YYYY-MM-DD` — the inverse of
 * {@link parseIsoDate}. The year is zero-padded to four digits, so the year
 * 999 reads `0999`; a negative year keeps its sign ahead of the padded digits
 * (`-0001`).
 *
 * @param date - The date to format; only its local calendar date is read.
 * @returns The `YYYY-MM-DD` text.
 *
 * @internal — not re-exported from the package barrel.
 */
export function formatIsoDate(date: Date): string {
    const year = date.getFullYear();
    const sign = year < 0 ? "-" : "";
    const yyyy = sign + String(Math.abs(year)).padStart(ISO_YEAR_DIGITS, "0");
    // getMonth() is zero-based; an ISO month starts at 1.
    const mm   = String(date.getMonth() + 1).padStart(ISO_MONTH_DAY_DIGITS, "0");
    const dd   = String(date.getDate()).padStart(ISO_MONTH_DAY_DIGITS, "0");

    return `${yyyy}-${mm}-${dd}`;
}
```

Append `parseIsoDateTime` after `parseClockTime`, at the end of the file. The
body is `DateTimeField.parseRaw`'s absolute branch, unchanged:

```typescript
/**
 * Parses a `YYYY-MM-DD H:MM[:SS]` date-time: exactly two whitespace-separated
 * parts, the first read by {@link parseIsoDate} and the second by
 * {@link parseClockTime}. Surrounding whitespace is ignored. A date alone, a
 * `T` separator, or anything after the time is rejected.
 *
 * @param raw - The raw typed text.
 * @returns The local date-time, or `null` when `raw` is not one.
 *
 * @internal — not re-exported from the package barrel.
 */
export function parseIsoDateTime(raw: string): Date | null {
    const parts = raw.trim().split(/\s+/);

    // A date part and a time part, nothing more.
    if (parts.length !== 2) {
        return null;
    }

    const date = parseIsoDate(parts[0]);
    const time = parseClockTime(parts[1]);

    if (date === null || time === null) {
        return null;
    }

    date.setHours(time.hours, time.minutes, time.seconds, 0);

    return date;
}
```

### `DateTimeField` — the two methods after both commits

```typescript
protected formatValue(date: Date): string {
    const day = formatIsoDate(date);
    const h   = String(date.getHours()).padStart(2, "0");
    const mi  = String(date.getMinutes()).padStart(2, "0");

    if (this._showSeconds) {
        const s = String(date.getSeconds()).padStart(2, "0");

        return `${day} ${h}:${mi}:${s}`;
    }

    return `${day} ${h}:${mi}`;
}
```

```typescript
// parseRaw, from the `relative !== null` check down:
if (relative !== null) {
    return relative;
}

// The absolute form is the strict inverse of formatValue, read by the helper
// the table's date-time cell editor shares.
return parseIsoDateTime(raw);
```

### The three editors' `onInput`

Each keeps its `syncTextFromDom()` call and its empty-text early return. Only
the parse below the early return changes.

```typescript
// DateEditor — replaces editor/Date.ts:199-200
// The same strict rule DateField reads its absolute form with. A rejected
// entry caches null, which DateCell treats as unparseable and reverts.
this._value = parseIsoDate(raw);
```

```typescript
// DateTimeEditor — replaces editor/DateTime.ts:261-262
this._value = parseIsoDateTime(raw);
```

```typescript
// TimeEditor — replaces editor/Time.ts:204-209
const time = parseClockTime(raw);

// The same rule TimeField reads with. A rejected entry caches null, which
// TimeCell treats as unparseable and reverts. The date portion stays the
// 1970-01-01 this editor normalises every value to (see onTimeSelected).
this._value = time === null
    ? null
    : new Date(1970, 0, 1, time.hours, time.minutes, time.seconds, 0);
```

### `LayoutSerialization` — the `Tab` capture branch

Replaces
[`LayoutSerialization.ts:257-265`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L257):

```typescript
if (kind === "Tab") {
    const manager = component.getLayoutManager() as Tab;
    const kept    = serializableChildren(component);
    const active  = manager.getActiveContent();

    // The manager's own active index counts tab-strip positions, which
    // include a transient tab and follow a drag reorder, so it does not index
    // `kept`. The active tab is found in `kept` by identity instead, the way
    // Tab keeps its own selection across a reorder. With no captured child
    // active, the first tab is recorded.
    const index = active === null ? -1 : kept.indexOf(active);

    return {
        kind:        "tab",
        children:    kept.map(nodeFor),
        activeIndex: Math.max(0, index),
    };
}
```

### `LayoutSerialization` — the `Tab` restore branch

Replaces the body of the `else` at
[`LayoutSerialization.ts:558-578`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L558).
The existing `createTab` comment stays where it is.

```typescript
const tab = new Tab({ reorderable: true, compact: true });
container.setLayoutManager(tab);

// The saved index counts every saved child, but the strip holds only the
// children that were placed: each one skipped ahead of the active child moves
// it one slot left. This is the re-alignment the split branch gives its
// ratios through `placed`.
let activeIndex = node.activeIndex;

node.children.forEach((child, index) => {
    const built = materializeNode(child, parked, factory);

    if (built) {
        container.moveComponent(built, undefined, constraintsFor(child));

        // (existing comment on eager registration, unchanged)
        tab.createTab(built);
    } else if (index < node.activeIndex) {
        activeIndex--;
    }
});

tab.setActiveTabIndex(activeIndex);
```

---

## Ordered Implementation Steps

Run every `npx vitest` / `npm` command from `packages/lib`. Every source path
below is under `packages/lib/src/typescript/lib/`; every test path is under
`packages/lib/tests/`.

### Commit 1 — the temporal cell editors parse strictly

1. **`component/input/dateMath.test.ts`** — add `parseIsoDateTime` to the
   import at
   [`:7`](packages/lib/tests/component/input/dateMath.test.ts#L7) and add a
   `describe('parseIsoDateTime')` block after `parseClockTime`'s, one `it` per
   row of *`parseIsoDateTime`* in `## Expected Behaviour`. It fails before
   step 4 because the export does not exist.
2. **`component/table/cell/editor.test.ts`** — add three describe blocks after
   `NumberEditor parse contract`
   ([`:654`](packages/lib/tests/component/table/cell/editor.test.ts#L654)):
   `DateEditor parse contract`, `DateTimeEditor parse contract` and
   `TimeEditor parse contract`, one `it` per row of the matching table in
   `## Expected Behaviour`. Add a file-level helper beside `typeInto`:

   ```typescript
   /** Sets a bare-input editor's text and runs its parse path. */
   function typeIntoInput(editor: unknown, text: string): void {
       DOM.sink.setValue((editor as any).getElement(true), text);
       (editor as any).onInput();
   }
   ```

   Calling `onInput` directly is how the file already drives these editors
   (see the cut test at
   [`:458-475`](packages/lib/tests/component/table/cell/editor.test.ts#L458)
   and the header comment on offline dispatch). Import `DateTimeEditor` and
   `TimeEditor`. Assert dates with local accessors or
   `toEqual(new Date(y, m, d, h, mi, s))`.
3. **Same file** — add `describe('Temporal cells revert a rejected typed value')`,
   one `it` per row of *Temporal cells on commit*. Each builds a
   `new CellEditorPool()`, a `DateCell` / `TimeCell` / `DateTimeCell` with
   `setEditorPool(pool)`, calls `getElement(true)`, sets the previous value
   with `setValue(new Date(2021, 4, 17, 8, 15))`, calls `startEdit()`, types
   into `(cell as any)._activeEditor` with `typeIntoInput`, subscribes
   `cell.on('commit', spy)`, then calls `commitEdit()`. Assert
   `cell.getRenderer().getValue()`, the spy, and `cell.isEditing()` is
   `false`. Import the three cells and `CellEditorPool`. Every "After: reverts"
   row, like every row of step 2 whose Today and After differ, fails before
   steps 6–8.
4. **`component/input/dateMath.ts`** — append `parseIsoDateTime` after
   `parseClockTime`, as in `## Internal Structure`.
5. **`component/input/DateTimeField.ts`** — replace the absolute branch
   ([`:144-164`](packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L144))
   with the comment and `return parseIsoDateTime(raw);` from
   `## Internal Structure`. In the import at
   [`:9`](packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L9),
   replace `parseIsoDate, parseClockTime` with `parseIsoDateTime`.
6. **`component/table/cell/editor/Date.ts`** — import `parseIsoDate` from
   `~/component/input/dateMath.js` after the `DatePickerDropdown` import at
   [`:6`](packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts#L6).
   Replace
   [`:199-200`](packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts#L199)
   as shown in `## Internal Structure`. In the class JSDoc, add this paragraph
   before `@category`
   ([`:21`](packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts#L21)):
   *"Typed text is read back exactly as the editor writes it: a complete,
   zero-padded `YYYY-MM-DD` naming a real calendar day, the rule
   [`DateField`](/api/component/input/classes/DateField) applies. Anything
   else is unparseable, and the owning
   [`DateCell`](/api/component/table/classes/DateCell) keeps its previous
   value on commit."*
7. **`component/table/cell/editor/DateTime.ts`** — import `parseIsoDateTime`
   after the `DateTimePickerDropdown` import at
   [`:9`](packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts#L9).
   Replace
   [`:261-262`](packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts#L261)
   with `this._value = parseIsoDateTime(raw);`. Rewrite `onInput`'s JSDoc
   ([`:246-251`](packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts#L246)),
   whose `Date.parse`/`T` explanation stops being true, to: *"Updates the
   cached value from a typed text edit, read with the same
   `YYYY-MM-DD H:MM[:SS]` rule as DateTimeField. A rejected entry caches null,
   which DateTimeCell treats as unparseable and reverts."* Add the class-JSDoc
   paragraph from step 6, adapted: *"a `YYYY-MM-DD` date and an `H:MM[:SS]`
   time separated by whitespace, the rule
   [`DateTimeField`](/api/component/input/classes/DateTimeField) applies …
   [`DateTimeCell`](/api/component/table/classes/DateTimeCell) keeps its
   previous value on commit."*
8. **`component/table/cell/editor/Time.ts`** — import `parseClockTime` after
   the `TimePickerDropdown` import at
   [`:6`](packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts#L6).
   Replace
   [`:204-209`](packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts#L204)
   as shown in `## Internal Structure`. Add the class-JSDoc paragraph,
   adapted: *"an `H:MM` or `H:MM:SS` time inside its range, the rule
   [`TimeField`](/api/component/input/classes/TimeField) applies …
   [`TimeCell`](/api/component/table/classes/TimeCell) keeps its previous
   value on commit."*
9. `npx vitest run tests/component/input/ tests/component/table/` — all
   green. `tests/component/input/DateTimeField.test.ts` is **not** edited in
   this commit: its existing absolute-form rows passing unchanged is what
   proves step 5's move kept the behaviour. Step 13 adds to it in commit 2.
10. `grep -rn "T00:00:00" packages/lib/src/typescript/lib/` — expect exactly
    one match, in `dateMath.ts`.
    `grep -rn "replace(' ', 'T')" packages/lib/src/typescript/lib/` — expect
    zero.
    `grep -n "parseIsoDate\b\|parseClockTime" packages/lib/src/typescript/lib/component/input/DateTimeField.ts`
    — expect zero.

### Commit 2 — the date formatters zero-pad the year

11. **`component/input/dateMath.test.ts`** — add `formatIsoDate` to the import
    and a `describe('formatIsoDate')` block covering every row of
    *`formatIsoDate`* in `## Expected Behaviour`. Build years 0–99 with
    `const d = new Date(2000, 0, 1); d.setFullYear(50);`, because the `Date`
    constructor maps a year of 0–99 to 1900–1999.
12. **`component/input/DateField.test.ts`** — in `DateField formatValue`
    ([`:50`](packages/lib/tests/component/input/DateField.test.ts#L50)) add
    the `DateField` row of *Year below 1000 round-trips*, using the file's
    `formatter()` and `parser()` helpers: format, assert the text, then parse
    that text back.
13. **`component/input/DateTimeField.test.ts`** — the same for the
    `DateTimeField` row, in `DateTimeField formatValue`
    ([`:24`](packages/lib/tests/component/input/DateTimeField.test.ts#L24)).
14. **`component/table/cell/editor.test.ts`** — add the `DateEditor` and
    `DateTimeEditor` rows of *Year below 1000 round-trips* to the two parse
    describes from step 2: `setValue`, read the input's text with
    `DOM.source.getValue(editor.getElement(true)!)`, then `typeIntoInput` that
    text and assert `getValue()`. Steps 11–14 fail before step 15.
15. **`component/input/dateMath.ts`** — insert the two constants and
    `formatIsoDate` above `parseIsoDate`'s JSDoc, as in `## Internal Structure`.
16. **`component/input/DateField.ts`** — replace `formatValue`'s body
    ([`:101-105`](packages/lib/src/typescript/lib/component/input/DateField.ts#L101))
    with `return formatIsoDate(date);`, add `formatIsoDate` to the `dateMath`
    import at
    [`:9`](packages/lib/src/typescript/lib/component/input/DateField.ts#L9),
    and change its `@returns` to *"A "YYYY-MM-DD" string, the year zero-padded
    to four digits."*
17. **`component/input/DateTimeField.ts`** — rewrite `formatValue`
    ([`:110-124`](packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L110))
    as in `## Internal Structure`, and add `formatIsoDate` to the `dateMath`
    import.
18. **`component/table/cell/editor/Date.ts`** — in `setValue`
    ([`:84`](packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts#L84)),
    replace `this.toInputString(value)` with `formatIsoDate(value)`. Delete
    `toInputString`
    ([`:219-224`](packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts#L219)).
    Add `formatIsoDate` to the `dateMath` import from step 6.
19. **`component/table/cell/editor/DateTime.ts`** — in `toInputString`
    ([`:274-285`](packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts#L274)),
    replace the three lines declaring `y`, `mo` and `d` with
    `const day = formatIsoDate(date);`, and `${y}-${mo}-${d}` with `${day}` in
    both template literals. Leave the rest of the method as it is. Add
    `formatIsoDate` to the `dateMath` import from step 7.
20. `npx vitest run tests/component/input/ tests/component/table/` — all
    green.
21. `grep -rn "const y *= date.getFullYear()" packages/lib/src/typescript/lib/`
    — expect zero. `grep -rn "toInputString" packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts`
    — expect zero.

### Commit 3 — a captured `Tab` records the tab that is actually active

22. **`component/layout/LayoutSerialization.test.ts`** — add
    `describe('serializeLayout of a Tab: the active index names the active child')`
    after the `Split` transient describe
    ([`:366`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L366)),
    one `it` per row of *`serializeLayout` of a `Tab`*. Build each host as
    `new Container({ layoutManager: new Tab() })`, then `getElement(true)`,
    `setWidth(400)`, `setHeight(300)`. Add the children, call
    `host.doLayout()` so every child gets its tab, then
    `tab.setActiveContent(x)`. Row 6 skips both calls. Row 2 restores row 1's
    captured state onto the same host with `instanceFactory({ a, b, c })`.
    Drive the reorder row the way
    [`tests/layout/Tab.doubleClick.test.ts:163-190`](packages/lib/tests/layout/Tab.doubleClick.test.ts#L163)
    does: `(tab as any)._bar.moveBarEntry(id, 0)` followed by
    `(tab as any)._onBarReordered(id, 0)`, where `id` is C's bar entry id,
    read before the move as `(tab as any)._bar.getEntryIds()[2]`
    (`TabBar.getEntryIds()` is public; only `_bar` is private).
    Rows 1, 2, 4 and 5 fail before step 23.
23. **`layout/LayoutSerialization.ts`** — replace the `Tab` branch of `nodeFor`
    ([`:257-265`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L257))
    with the one in `## Internal Structure`.
24. **Same file** — change `TabNode.activeIndex`'s JSDoc
    ([`:101`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L101))
    to *"Zero-based index, into `children`, of the active tab — `0` when no
    captured child is the active one."*
25. **`layout/Tab.ts`** — `getActiveTabIndex`'s JSDoc
    ([`:2279-2284`](packages/lib/src/typescript/lib/layout/Tab.ts#L2279))
    claims it "captures the active selection for serialization", which stops
    being true. Replace its description with: *"Returns the zero-based index of
    the currently active tab, in tab-strip order — the order
    {@link setActiveTabIndex} and {@link indexOfContent} use, which a drag
    reorder can make differ from the container's child order."*
26. `npx vitest run tests/component/layout/ tests/layout/ tests/overlay/Dock.beforeClose.test.ts tests/overlay/Dock.lifecycle.test.ts tests/overlay/Dock.panelPresentation.test.ts tests/overlay/Dock.closeDisposal.test.ts`
    — all green. The four `Dock` files are the only in-library callers of
    `serializeLayout` / `restoreLayout` besides the serialization tests.
27. `grep -n "getActiveTabIndex" packages/lib/src/typescript/lib/layout/LayoutSerialization.ts`
    — expect zero.

### Commit 4 — a restored `Tab` re-aligns its active index to the placed tabs

28. **`component/layout/LayoutSerialization.test.ts`** — add
    `describe('restoreLayout of a Tab node with a skipped leaf')`, one `it`
    per row of *`restoreLayout` of a `Tab` node*. Each builds the state by
    hand as `{ version: 1, root: { kind: 'tab', children: [...panel nodes], activeIndex }, windows: [] }`,
    restores it onto a sized `Tab` host with `instanceFactory` over only the
    kept components, mocks `console.warn` with
    `vi.spyOn(console, 'warn').mockImplementation(() => {})`, and asserts
    `(host.getLayoutManager() as Tab).getActiveContent()`. Rows 1 and 2 fail
    before step 29.
29. **`layout/LayoutSerialization.ts`** — rewrite `populateContainer`'s `Tab`
    branch
    ([`:558-578`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L558))
    as in `## Internal Structure`. In its JSDoc
    ([`:525-528`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L525)),
    extend the re-alignment sentence to say a tab node's active index is
    re-aligned to the children that landed, as the split's ratio and collapsed
    arrays are.
30. Re-run step 26's command — all green.

### Commits 5–8 — documentation, one commit per functionality, in the same order

31. **Commit 5 — `packages/lib/docs/reference/changelog/next.md`** — under
    `## Fixed` → `### Components`, directly after the existing
    `DateField`/`DateTimeField` entry
    ([`:1065`](packages/lib/docs/reference/changelog/next.md#L1065)), add an
    entry that names: the three editors and what each committed before
    (`2025-02-30` → 2 March, `2026` → 1 January, `25:00` → 01:00 the next day,
    a date with no time → UTC midnight); that they now apply their form-field
    sibling's rule; that a rejected entry reverts the cell to its previous
    value, as unparseable text already did; and the date-time editor's
    edge changes (starts accepting `9:5`; stops accepting a `T` separator or a
    `Z`/offset suffix), plus the time editor's (stops accepting a bare hour
    such as `9`). In the same commit, **`packages/lib/docs/components/TableInternals.md`**:
    after the sentence at
    [`:57`](packages/lib/docs/components/TableInternals.md#L57), add: *"Each
    editor reads typed text back exactly as it displays it, with the rule its
    form-field sibling uses — `YYYY-MM-DD` as in `DateField`, `H:MM[:SS]` as
    in `TimeField`, the two joined by a space as in `DateTimeField` — so a
    partial date (`2026`), an impossible day (`2025-02-30`) or an
    out-of-range time (`25:00`) is unparseable."*
32. **Commit 6 — `next.md`**, `### Components`: an entry saying a date before
    the year 1000 now formats with a four-digit year (`0999-01-01`) in
    `DateField`, `DateTimeField` and the table's date and date-time editors.
    It must name the symptom (the field's own displayed text could not be read
    back, so editing it cleared the field) and that years outside 0–9999 still
    cannot be typed back.
33. **Commit 7 — `next.md`**, `### Layouts`, after the `Split` transient entry
    ([`:1175`](packages/lib/docs/reference/changelog/next.md#L1175)): an entry
    saying a saved `Tab` arrangement now records the tab that was actually
    active. It must name both triggers (a transient tab ahead of the active
    one, and a drag reorder) and say a state saved before the change restores
    as it did.
34. **Commit 8 — `next.md`**, `### Layouts`: an entry saying restoring a `Tab`
    arrangement whose factory no longer supplies a panel ahead of the active
    tab now keeps the saved tab active, as the `Split` branch already does for
    its ratios.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/dateMath.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/DateField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/DateTimeField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/tests/component/input/dateMath.test.ts` |
| Modify | `packages/lib/tests/component/input/DateField.test.ts` |
| Modify | `packages/lib/tests/component/input/DateTimeField.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/editor.test.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutSerialization.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/components/TableInternals.md` |

---

## Expected Behaviour

Every row is unit-testable offline unless marked otherwise. "Today" is the
reading on `master`; a row whose Today and After agree is a regression guard,
not a new failure.

### `parseIsoDateTime`

Every row is `DateTimeField.parseRaw`'s current absolute-form behaviour,
asserted on the extracted helper.

| Input | Result |
|---|---|
| `"2025-06-15 14:30"` | 15 Jun 2025 14:30:00 |
| `"2025-06-15 14:30:05"` | 15 Jun 2025 14:30:05 |
| `"  2025-06-15   14:30  "` | 15 Jun 2025 14:30:00 |
| `"2025-06-15 9:5"` | 15 Jun 2025 09:05:00 |
| `"2025-06-15"` | `null` |
| `"2025-06-15T14:30"` | `null` |
| `"2025-06-15 14:30Z"` | `null` |
| `"2025-06-15 14:30 extra"` | `null` |
| `"2025-02-30 10:00"` | `null` |
| `"2025-06-15 25:00"` | `null` |
| `""` | `null` |

### `DateEditor` parse contract

`typeIntoInput(editor, text)`, then `getValue()`.

| Typed | Today | After |
|---|---|---|
| `2026-09-16` | 16 Sep 2026 | unchanged |
| `2024-02-29` | 29 Feb 2024 | unchanged |
| `2025-02-30` | 2 Mar 2025 | `null` |
| `2026-02-29` | 1 Mar 2026 | `null` |
| `2026` | 1 Jan 2026 | `null` |
| `2026-09` | 1 Sep 2026 | `null` |
| `2026-9-1` | `null` | `null` |
| `garbage` | `null` | `null` |
| *(empty)* | `null`, `isEmpty()` true | unchanged |

### `DateTimeEditor` parse contract

`new DateTimeEditor(false)`.

| Typed | Today | After |
|---|---|---|
| `2025-06-15 14:30` | 15 Jun 2025 14:30 | unchanged |
| `2025-06-15 14:30:05` | 15 Jun 2025 14:30:05 | unchanged |
| `2025-02-30 10:00` | 2 Mar 2025 10:00 | `null` |
| `2026 10:00` | 1 Jan 2026 10:00 | `null` |
| `2026-09 10:00` | 1 Sep 2026 10:00 | `null` |
| `2025-06-15` | UTC midnight, read in local time | `null` |
| `2025-06-15T14:30` | 15 Jun 2025 14:30 | `null` |
| `2025-06-15 14:30Z` | 14:30 UTC | `null` |
| `2025-06-15 9:5` | `null` | 15 Jun 2025 09:05 |
| `2025-06-15 25:00` | `null` | `null` |
| `total garbage` | `null` | `null` |

### `TimeEditor` parse contract

`new TimeEditor(false)`. Every accepted value is on 1 Jan 1970.

| Typed | Today | After |
|---|---|---|
| `09:30` | 09:30 | unchanged |
| `9:5` | 09:05 | unchanged |
| `09:30:45` | 09:30:45 | unchanged |
| `:30` | 00:30 | unchanged — `TimeField`'s own quirk, kept |
| `9` | 09:00 | `null` |
| `9:` | 09:00 | `null` |
| `24:00` | 00:00 on 2 Jan 1970 | `null` |
| `25:00` | 01:00 on 2 Jan 1970 | `null` |
| `09:60` | 10:00 | `null` |
| `09:30:61` | 09:31:01 | `null` |
| `-1:00` | 23:00 on 31 Dec 1969 | `null` |
| `abc` | `null` | `null` |

### Temporal cells on commit

Previous value 17 May 2021 08:15. `commit` is the cell's own event.

| Cell | Typed | Today | After |
|---|---|---|---|
| `DateCell` | `2025-02-30` | commits 2 Mar 2025 | reverts: value unchanged, no `commit` |
| `DateCell` | `2026` | commits 1 Jan 2026 | reverts |
| `TimeCell` | `25:00` | commits 01:00, 2 Jan 1970 | reverts |
| `DateTimeCell` | `2025-06-15` | commits UTC midnight | reverts |
| `DateCell` | `2025-06-15` | commits 15 Jun 2025 | unchanged |
| `DateCell` | *(cleared)* | commits `null` | unchanged |

In every row, `isEditing()` is `false` afterwards.

### `formatIsoDate`

| Local date | Result | `parseIsoDate(result)` |
|---|---|---|
| 16 Sep 2026 | `2026-09-16` | 16 Sep 2026 |
| 7 Jun 2025 | `2025-06-07` | 7 Jun 2025 |
| 1 Jan 999 | `0999-01-01` | 1 Jan 999 |
| 1 Jan, year 50 | `0050-01-01` | 1 Jan, year 50 |
| 1 Jan, year 0 | `0000-01-01` | 1 Jan, year 0 |
| 1 Jan, year −1 | `-0001-01-01` | `null` |
| 1 Jan 10026 | `10026-01-01` | `null` |

### Year below 1000 round-trips

| Component | Value set | Text today | Text after | That text parsed back, after |
|---|---|---|---|---|
| `DateField` | 1 Jan 999 | `999-01-01` | `0999-01-01` | 1 Jan 999 |
| `DateTimeField` | 1 Jan 999 10:00 | `999-01-01 10:00` | `0999-01-01 10:00` | 1 Jan 999 10:00 |
| `DateEditor` | 1 Jan 999 | `999-01-01` | `0999-01-01` | 1 Jan 999 |
| `DateTimeEditor(false)` | 1 Jan 999 10:00 | `999-01-01 10:00` | `0999-01-01 10:00` | 1 Jan 999 10:00 |

Every existing four-digit `formatValue` test stays green unchanged.

### `serializeLayout` of a `Tab`

Components A, B, C have ids `a`, `b`, `c`. P is a child added with
`transient: true`. The host is laid out before the active tab is set.

| # | Container children | Strip | Active | `activeIndex` today | After |
|---|---|---|---|---|---|
| 1 | P A B C | P A B C | B | 2 | 1 |
| 2 | row 1, then restored | — | — | restores C | restores B |
| 3 | A B C P | A B C P | B | 1 | 1 |
| 4 | A P | A P | P | 1 | 0 |
| 5 | A B C | C A B (reordered) | A | 1 | 0 |
| 6 | A B, never laid out | none | none | 0 | 0 |

In rows 1, 3 and 5, `children[activeIndex].panelId` is the active child's id.
Row 5 asserts that and nothing about the order of `children`, which is the
open defect listed under `## Non-Goals`.

### `restoreLayout` of a `Tab` node

Hand-built states. The factory omits the skipped ids. `console.warn` fires for
each skipped id and is mocked.

| # | Saved children | Saved `activeIndex` | Skipped | Active today | After |
|---|---|---|---|---|---|
| 1 | a b c | 1 | a | c | b |
| 2 | a b c d e | 2 | a b c | e | d |
| 3 | a b c | 1 | c | b | b |
| 4 | a b c | 1 | b | c | c |
| 5 | a b c | 2 | c | b | b |
| 6 | a b c | 1 | a b c | no tab | no tab, no throw |

### Manual verification

Neither check is run by the implementer. Every QA-panel or demo-app run opens a
browser window on the user's desktop and needs the user's go-ahead. Record
them as documented manual steps.

| Where | How | Shows |
|---|---|---|
| QA `table-rows` panel, window left open, by hand | Double-click a `hired` cell, type `2025-02-30`, press Enter. Repeat with `2026`. In `shiftStart` type `25:00`; in `lastLogin` type a date with no time. | Item 1. Each cell keeps its previous value. Today they commit 2 Mar 2025, 1 Jan 2026, 01:00 and UTC midnight. |
| Demo app's layout-serialization panel, by hand | Click **Tab layout**, drag the last tab to the front, click the tab that is now second, click **Serialize → console**. | Item 3. `children[activeIndex]` names the tab that was clicked. Today it names a different panel. |

No shipped QA panel captures and restores a layout, so the jsdom cases are the
whole proof for item 3's restore half.

---

## Verification

Run from `packages/lib`:

1. `npm run typecheck` — 0 errors.
2. `npm run typecheck:test` — 0 errors.
3. `npx vitest run tests/component/input/ tests/component/table/ tests/component/layout/ tests/layout/`
   — every file this plan adds cases to, plus the table and `Tab` suites the
   changed code runs under.
4. `npx vitest run tests/overlay/Dock.beforeClose.test.ts tests/overlay/Dock.lifecycle.test.ts tests/overlay/Dock.panelPresentation.test.ts tests/overlay/Dock.closeDisposal.test.ts`
   — the `Dock` callers of `serializeLayout` / `restoreLayout`.
5. `npm test` — the full suite, once. The known `textRange(...).getClientRects`
   stderr noise and the intermittent `DOM handle N is not registered`
   rejection are pre-existing on `master` and are not caused by this change.
6. `npm run lint`.
7. `npm run docs:api` — record the warning count on `master` first (14 today).
   The count must not grow. No rendered JSDoc — the three editors' class
   comments, `TabNode.activeIndex`, `Tab.getActiveTabIndex` — may `{@link}`
   `formatIsoDate`, `parseIsoDateTime` or any other `dateMath` export, because
   the module is excluded from the docs build. The `{@link}`s inside
   `dateMath`'s own JSDoc are fine: nothing renders them.
8. `npm run docs:llms:check` — unaffected; no new concrete class ships.
9. The grep checks in steps 10, 21 and 27.

---

## Documentation Impact

No new public symbol, so no new page, barrel entry or catalog row. `dateMath`
is not re-exported from any barrel, so `formatIsoDate` and `parseIsoDateTime`
get no page.

Rendered JSDoc changes:

- `DateEditor`, `DateTimeEditor`, `TimeEditor` — one class-comment paragraph
  each (steps 6–8), linking only to the public field and cell pages in the
  existing `/api/...` Markdown-link form.
- `TabNode.activeIndex` (step 24) and `Tab.getActiveTabIndex` (step 25).
  `{@link setActiveTabIndex}` and `{@link indexOfContent}` are public members
  of `Tab`; `indexOfContent`'s own JSDoc already links the pair this way.

Pages:

- [`docs/components/TableInternals.md`](packages/lib/docs/components/TableInternals.md#L57)
  — one sentence after the existing revert sentence (step 31).
- [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)
  — four `## Fixed` entries (steps 31–34), in the bold-lead-sentence style the
  page uses.
- `DateField.md` and `DateTimeField.md` are unchanged. They already describe a
  zero-padded `YYYY-MM-DD`, so item 2 makes the code match them.
- `layouts/LayoutSerialization.md` is unchanged. Its `TabNode` row says
  "tab order", which is the open defect under `## Non-Goals`, not something
  this plan changes.

---

## Potential Challenges

- **The offline harness does not deliver a dispatched `input` event.** The
  editor tests call `onInput()` directly through `typeIntoInput`, the same
  substitute the file's cut/paste tests use.
- **A year of 0–99 built with `new Date(50, 0, 1)` becomes 1950.** Step 11
  builds those dates with `setFullYear`.
- **Timezone.** Assert with local accessors. The "date with no time" rows assert
  `null`, which does not depend on the zone.
- **`startEdit` in the cell tests needs a rendered cell and a pool.** Call
  `getElement(true)` and `setEditorPool(pool)` first. One pool may serve all
  rows, because each `startEdit` commits the previous holder first.
- **Unused imports after step 5.** `parseIsoDate` and `parseClockTime` leave
  `DateTimeField`'s import. `npm run typecheck` and `npm run lint` catch a
  leftover.
- **The reorder test reaches two private members.** `_bar` and
  `_onBarReordered` are driven exactly as
  `tests/layout/Tab.doubleClick.test.ts:163-190` drives them. There is no
  public reorder entry point.

---

## Critical Files

| File | Why |
|---|---|
| [`plans/implemented/tooltip-picker-and-serialization-fixes.md`](plans/implemented/tooltip-picker-and-serialization-fixes.md) | The precedent: the shared-helper decision for C23 and the index-preserving capture for C29, plus its implementation notes. |
| [`component/input/dateMath.ts`](packages/lib/src/typescript/lib/component/input/dateMath.ts) | `parseIsoDate:180` and `parseClockTime:212` are the rules the editors adopt, and the module both new functions join, with their `@internal` JSDoc shape. |
| [`component/input/DateTimeField.ts`](packages/lib/src/typescript/lib/component/input/DateTimeField.ts) | `parseRaw:144-164` is the body `parseIsoDateTime` is moved from; `formatValue:110-124` is one of the four formatters. |
| [`component/table/cell/Date.ts`](packages/lib/src/typescript/lib/component/table/cell/Date.ts) | `commitEdit:44-62` is the revert that decides what a rejected value does. `Time.ts:48-66` and `DateTime.ts:48-66` are identical. |
| [`component/table/cell/editor/Number.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts) | `onInput:137-148` — the editor-side precedent of caching `null` for text that does not parse. |
| [`layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) | `_onBarReordered:1111-1124` is the identity lookup item 3 mirrors. The `ContentEntry` remarks at `:257-264` document why strip order and container order drift apart. `getActiveContent:2288-2300` is the public accessor used. |
| [`layout/LayoutSerialization.ts`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts) | `nodeFor:235-281` and `populateContainer:535-579`. Its `Split` branch's `placed` list at `:540-557` is the restore-side precedent. |
| [`tests/component/table/cell/editor.test.ts`](packages/lib/tests/component/table/cell/editor.test.ts) | Its header comment and the cut test at `:458-475` show how to drive a bare-input editor offline. |
| [`tests/layout/Tab.doubleClick.test.ts`](packages/lib/tests/layout/Tab.doubleClick.test.ts) | `:163-190` is the reorder-driving pattern step 22 copies. |
| [`docs/components/TableInternals.md`](packages/lib/docs/components/TableInternals.md) | `:57` is the documented revert contract. |

---

## Non-Goals

- **Tab order after a drag reorder.** This was found while verifying item 3.
  `serializeLayout` writes `TabNode.children` in container order, while
  `TabNode`'s JSDoc and `LayoutSerialization.md` promise tab order. A reorder
  changes only the strip, so save and restore puts the tabs back in the order
  they were added. This is a separate defect with its own behaviour change,
  and belongs in its own follow-up. Item 3's lookup by identity stays correct
  whichever order is captured.
- **Relative shorthand (`+9y`) in the cell editors.** They never accepted it.
  Adding it would be a feature.
- **Years outside 0–9999.** Supporting them needs ISO 8601's expanded `±YYYYYY`
  form on both the format and the parse side.[^year-domain]
- **A shared time formatter.** The `HH:MM[:SS]` half is written in four places
  and is correct in all of them.[^date-half-only]
- **The lenient `new Date(text)` in `ColumnFilter.parseOperand` and
  `Field.convertByType`.** The first reads a free-form filter operand. The
  second coerces raw record data, including clipboard text pasted into a
  table. Neither is paired with a formatter it must read back.
- **An invalid-state border on the cell editors.** No cell editor has one.
- **A `LayoutState` schema version bump or migration.**[^wild-states]
- **Any QA-panel change.**

---

## Notes

[^one-plan]: Four plans of one or two edits each would repeat the same
    overview, verification list and changelog scaffold. The C23/C29 plan
    grouped its three bugs the same way and kept them separable through one
    code commit each. Item 3 gets two commits because its halves fail
    independently. The capture half is triggered by a transient or reordered
    strip. The restore half is triggered by a factory that yields nothing, and
    it shows up even with a state captured correctly.

[^not-the-field]: The editors are bare `<input>` elements
    (`TextInputCellEditor`), not picker fields. Routing through `DateField`
    would mean building a whole field (input, button, dropdown) inside each
    editor, or exposing its protected `parseRaw`. That `parseRaw` also accepts
    relative shorthand, so routing through it would quietly add a feature the
    editors never had. The `dateMath` helpers are exactly the absolute-form
    rule, and C23 made them shareable for this purpose. The editors already
    import from `component/input` (`DatePickerDropdown`), so this adds no new
    dependency direction.

[^time-editor]: `TimeEditor.onInput` splits on `:` and passes the numbers to
    `new Date(1970, 0, 1, h, m, s)`, which rolls over. On `master`, `24:00`
    commits 00:00 on 2 January 1970, `09:60` commits 10:00, `-1:00` commits
    23:00 on 31 December 1969, and a bare `9` commits 09:00. That is the same
    "commits a value the text never named" defect. Leaving it would put the
    table's three temporal editors on two different rules. `parseClockTime` is
    `TimeField`'s own rule, and the change is four lines.

[^extract-datetime]: Composing the two helpers inline in `DateTimeEditor`, as
    `DateTimeField` does, would write the "split into exactly two parts" rule a
    second time. The C23 plan's footnote on one helper per half names a
    restated rule as what produced that defect. The move keeps
    `DateTimeField`'s behaviour. Its existing absolute-form tests pin that and
    are left unedited on purpose.

[^revert-contract]: Two alternatives were rejected. Keeping the editor's
    pre-edit value on a rejected entry would commit through the normal path and
    fire `commit` with an unchanged value, which looks like an edit to a
    listener. Adding an invalid border that blocks the commit is a feature no
    cell editor has. Caching `null` needs no new code: the three temporal cells
    already treat "non-empty text, null value" as unparseable and cancel. The
    form fields behave differently (invalid border, then blur clears to
    `null`) because a field has no committed value apart from its text, while
    a cell does. Each keeps its own documented contract.

[^date-half-only]: Only the date half is broken. The time half is written in
    `TimeField`, `DateTimeField`, `TimeEditor` and `DateTimeEditor`, and is
    correct in all four. Extracting a time or date-time formatter would
    refactor code that is not broken. The parse side is different:
    `parseIsoDateTime` is extracted because `DateTimeEditor` would otherwise
    need a *new* copy of the composition. This plan extracts a composition only
    where the alternative is adding a copy.

[^year-domain]: `parseIsoDate` accepts exactly four year digits
    (`ISO_DATE`, `dateMath.ts:152`), so years 0000–9999. A negative year or a
    year past 9999 needs ISO 8601's expanded `±YYYYYY` form on both sides.
    Such a date can only arrive through a programmatic `setValue`, a binding,
    a large shorthand such as `+8000y`, or a `minDate` far in the past. The
    calendar's year scroller defaults to 120 years back and 50 forward
    (`AbstractCalendarDropdown.ts:68` and `:75`). Before and after the fix, a
    date like that displays but cannot be typed back. The sign handling in
    `formatIsoDate` exists only so padding does not turn today's `-1-01-01`
    into the garbled `00-1-01-01` that a bare `padStart` produces.

[^identity-not-index]: C29 fixed `Split` by mapping indices, because a
    `Split`'s per-pane arrays are indexed by `getComponents()` order. `Tab` is
    different. Its `_selectedTabIndex` indexes the private `_contents` list,
    which is strip order. The class documents that this list does not stay
    aligned with `getComponents()` (`Tab.ts:257-264`), and a reorder re-sorts
    `_contents` alone (`Tab.ts:1111-1124`). Turning a strip index into a kept
    index needs identity anyway, and `getActiveContent()` already exposes it
    publicly. The probe on `master`: with children P\*, A, B, C and B active,
    the capture recorded 2 and the restore activated C. After reordering the
    strip to C, A, B with A active, the capture recorded 1 and the restore
    activated B.

[^first-tab-fallback]: No captured child is active in three cases. The active
    tab may be transient itself, such as a `Dock` start page shown while the
    dock is empty. No tab cell may exist yet, because the children were added
    but not laid out. Or the active tab may be a lazy entry still building.
    `0` is where the manager starts (`_selectedTabIndex = 0`). In the first
    and third cases the old code recorded an index that is out of range or
    names a different child. In the second it already recorded `0`. No restore
    gets worse.

[^restore-realign]: Without this half, a state captured correctly after the
    capture fix still restores the wrong tab whenever the app's factory stops
    supplying a panel ahead of the active one. The probe on `master`: saved
    a, b, c with 1 active and a omitted restored c. The count leaves out the
    active child itself. So when the active child is skipped, the index lands
    on the next placed child, the one that slid into its slot. That is what
    today's clamp already does when nothing ahead of it was skipped.
    Remembering the built component by identity would need a second rule for
    that case.

[^wild-states]: The schema does not change. A state saved before this fix
    carries the manager's strip index, and the restore applies it as before.
    The one exception is a skipped leaf ahead of it, where the index now
    shifts the same way it does for a new state. An index that a transient tab
    already shifted cannot be recognised as shifted, so that state restores
    the same tab it always did.

---

## Implementation Notes

One departure from the plan's scope, one owed check, one confirmation, and
two cosmetic differences worth recording.

**`DynamicCell`'s temporal rows gained the revert guard (a departure).** The
plan's Architecture Decision *a rejected value is an unparseable one, and the
cell already reverts it* and its *Temporal cells on commit* table name only
`DateCell`, `TimeCell` and `DateTimeCell`. The audit's third round found a
fourth borrower of the same pooled editors: a `cellType` column's
`DynamicCell`, whose `'date'`, `'time'` and `'datetime'` rows had no
`commitEdit` guard. With the editors parsing strictly, `2025-02-30`, `2026`,
`25:00` or a date-time with no time in such a row would have committed `null`
and blanked the record, where the plan's changelog entry promised a revert.
`DynamicCell.commitEdit` now applies `DateCell.commitEdit`'s guard for its
three temporal variants only, rides in the strict-parsing code commit, and is
pinned by *DynamicCell temporal rows revert a rejected typed value* in
`tests/component/table/cell/DynamicCell.test.ts`, whose three revert rows
failed before the guard and whose number row pins that other variants keep
the base commit. It also changes one pre-existing behaviour: text such as
`abc` in a temporal `cellType` row used to commit `null` and now reverts. The
changelog entry and a new note under `Table.md`'s *Per-cell cell types* say
so.

**Manual verification still owed.** Both rows of `## Expected Behaviour`'s
*Manual verification* table are unrun: the QA `table-rows` check for item 1
and the demo app's layout-serialization check for item 3 each open a browser
window on the user's desktop and need their go-ahead. The jsdom cases pin the
same transitions — the three editor parse contracts and *Temporal cells revert
a rejected typed value* for item 1, and rows 1–5 of *`serializeLayout` of a
`Tab`* for item 3, row 5 driving the same drag reorder through `_bar` and
`_onBarReordered` that the demo check performs by hand.

**Confirmed, not assumed: every "Today" reading.** Each new test was run
before its fix. The rows whose Today and After differ failed with exactly the
plan's Today values — 33 in commit 1, 11 in commit 2, capture rows 1, 2, 4
and 5 (recording `2`, restoring C, recording `1`, naming `b`), and restore
rows 1 and 2 (activating C and E) — and every row whose Today and After agree
passed before the fix as well as after.

**Two cosmetic differences.** `TabNode.activeIndex`'s new JSDoc is written as
a multi-line block, the form the file's other long field comments take,
rather than the single line step 24 quotes; and the restore branch's new
comment is rewrapped to the file's width. The wording is the plan's in both.
