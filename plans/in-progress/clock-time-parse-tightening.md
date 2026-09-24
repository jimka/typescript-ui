# Clock-Time Parse Tightening — Implementation Plan

## Overview

`parseClockTime` ([`packages/lib/src/typescript/lib/component/input/dateMath.ts:241`](packages/lib/src/typescript/lib/component/input/dateMath.ts#L241)) splits the typed text on `:` and hands each piece to `Number`. `Number` accepts far more than the `H:MM[:SS]` the function's own JSDoc names, so `9:30:00:99`, `1e1:30`, `0x9:30`, `9.5:30` and `09:30:` all parse today — as do `:30`, `+9:30`, `009:30` and text with a leading or trailing space.

This plan replaces that check with a full-match regex plus a range check, the shape [`parseIsoDate`](packages/lib/src/typescript/lib/component/input/dateMath.ts#L209) already uses for the date half in the same file. `parseClockTime` is the single seam: `TimeField` and the table's time cell editor call it directly, and `DateTimeField` and the table's date-time cell editor reach it through `parseIsoDateTime`. One edit fixes all four.

The tightening rejects text the four components used to accept, so it is a behaviour change with a changelog entry and a migration note. The repo is pre-1.0 and its own versioning policy allows it.[^breaking-ok]

---

## Architecture Decisions

### The grammar is a full-match regex plus a range check, mirroring `parseIsoDate`

`parseClockTime` matches `^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$` and then rejects an hour of 24 or more, or a minute or second of 60 or more. Anything the regex does not match whole is rejected outright, exactly as `ISO_DATE` ([`dateMath.ts:152`](packages/lib/src/typescript/lib/component/input/dateMath.ts#L152)) rejects a date whose shape is wrong before `parseIsoDate` range-checks the day.[^regex-precedent]

The regex fixes the shape; the range check fixes the values the digit count cannot bound (`\d{1,2}` admits `99`).

| Typed | Today | After | Why |
|---|---|---|---|
| `09:30` | 09:30:00 | 09:30:00 | matches, all parts in range |
| `9:5` | 09:05:00 | 09:05:00 | one-digit parts are still two-or-fewer digits |
| `09:30:45` | 09:30:45 | 09:30:45 | optional seconds group matches |
| `1e1:30` | 10:30:00 | `null` | `e` is not a digit |
| `9.5:30` | 09:30:00 | `null` | `.` is not a digit |
| `9:30:00:99` | 09:30:00 | `null` | the fourth part is left over, and `$` forbids leftovers |
| `24:00` | `null` | `null` | matches, but the hour fails the range check |

### Seconds stay optional, and a trailing separator is not a seconds field

An absent seconds group means `0`, so `9:30` and `9:30:00` agree. A separator with nothing after it — `09:30:` — is rejected rather than read as zero seconds, which is what `9:` (an hour with an empty minute) already does.[^trailing-separator]

### Surrounding whitespace is rejected, and `parseIsoDateTime` keeps its own trim

`parseClockTime` does not trim: ` 9:30` and `9:30 ` are rejected, as `parseIsoDate` already rejects `2026-09-16 `. The date-time form is unaffected, because `parseIsoDateTime` ([`dateMath.ts:270`](packages/lib/src/typescript/lib/component/input/dateMath.ts#L270)) trims the whole string and splits it on whitespace before either half sees its text — so `  2025-06-15   14:30  ` still parses.[^no-trim]

### Unpadded parts stay accepted

`9:5` and `09:30:5` keep parsing. Each part is one or two digits, not exactly two.[^unpadded-stays]

### Forms a real user might type are among the newly rejected

Three of the rejects are text a person could plausibly produce, and this plan accepts losing them:

- **` 9:30` / `9:30 `** — a space picked up by a paste.
- **`09:30:`** — a half-typed seconds segment. The field shows its invalid border while the text is incomplete and clears it on blur, which is already what `9:` does mid-entry.
- **`:30`** — a shorthand for 00:30. It is undocumented, `formatValue` never produces it, and the table editor's own test calls it "the quirk `TimeField` shares".[^colon-thirty]

None of the three is a form any of the four components displays, so no value a component wrote can fail to be read back.

### The unreleased changelog entries are amended, and one new entry is added

Two `## Fixed` entries in [`packages/lib/docs/reference/changelog/next.md:1335`](packages/lib/docs/reference/changelog/next.md#L1335) and [`:1353`](packages/lib/docs/reference/changelog/next.md#L1353) describe the date/time parse work already on `master` but not yet released. One of their claims — that a fractional second is kept-then-truncated, and that `TimeField` is unchanged — stops being true, so those two clauses are corrected in place, and the tightening gets its own entry beside them.[^changelog-amend]

---

## Internal Structure

All of it lands in [`dateMath.ts`](packages/lib/src/typescript/lib/component/input/dateMath.ts), between `parseIsoDate`'s closing brace (line 229) and `parseClockTime`'s JSDoc:

```typescript
// A complete `H:MM[:SS]` wall-clock time, anchored at both ends. Each part is
// one or two ASCII digits: the unpadded `9:5` the fields accept, and none of
// the forms `Number` would otherwise widen a part to (`1e1`, `0x9`, `9.5`,
// ` 9`, `+9`, an empty string). No `g` flag, so `exec` carries no state
// between calls. The digit count cannot express the per-part upper bounds,
// which the range check below covers.
const CLOCK_TIME = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;

// Exclusive upper bound of each clock part. Named rather than inlined because
// `\d{1,2}` admits 99, so the 24-hour day and the 60-minute hour are the
// constraints the shape check cannot carry.
const HOURS_PER_DAY      = 24;
const MINUTES_PER_HOUR   = 60;
const SECONDS_PER_MINUTE = 60;
```

and the body itself:

```typescript
export function parseClockTime(raw: string): ClockTime | null {
    const match = CLOCK_TIME.exec(raw);

    if (match === null) {
        return null;
    }

    const hours   = Number(match[1]);
    const minutes = Number(match[2]);
    // An absent seconds group is zero, so `9:30` and `9:30:00` agree.
    const seconds = match[3] === undefined ? 0 : Number(match[3]);

    // The regex admits no sign and no empty part, so every value is a
    // non-negative integer and only the upper bound is left to check.
    if (hours >= HOURS_PER_DAY || minutes >= MINUTES_PER_HOUR || seconds >= SECONDS_PER_MINUTE) {
        return null;
    }

    return { hours, minutes, seconds };
}
```

No signature changes: `parseClockTime` still takes a `string` and returns `ClockTime | null`, and `ClockTime` keeps its three number fields. The module is `@internal` and in no barrel, so nothing public moves.

---

## Ordered Implementation Steps

Tests first — steps 1–3 must fail before step 5 makes them pass.

1. **Add the reject cases to [`packages/lib/tests/component/input/dateMath.test.ts`](packages/lib/tests/component/input/dateMath.test.ts)**, inside the existing `describe('parseClockTime')` block (lines 173–201), after the last `rejects seconds outside 0-59` case. Cover every row of `## Expected Behaviour`'s *newly rejected* table with one `it.each` over the inputs asserting `toBe(null)`, and add the two new accept cases (`0:0:0`, `23:59:59`). Run `npx vitest run tests/component/input/dateMath.test.ts` from `packages/lib` — the new reject cases must fail.

2. **Flip the `:30` case in [`packages/lib/tests/component/table/cell/editor.test.ts:898`](packages/lib/tests/component/table/cell/editor.test.ts#L898).** Replace `it('":30" parses to 00:30, the quirk TimeField shares', …)` with `it('a missing hour ":30" is rejected', () => { expect(parsed(':30')).toBe(null); })`. In the same `describe('TimeEditor parse contract')` block, add cases for `'09:30:'`, `' 9:30'` and `'09:30:05.5'`, all expecting `null`.

3. **Flip the fractional-second case in [`packages/lib/tests/component/input/DateTimeField.test.ts:104`](packages/lib/tests/component/input/DateTimeField.test.ts#L104).** Replace `it('drops the sub-second part of a fractional second instead of keeping it', …)` with `it('rejects a fractional second, which formatValue never produces', () => { expect(parse('2025-06-15 14:30:05.5')).toBe(null); })`, dropping its now-stale comment. Leave the `  2025-06-15   14:30  ` whitespace case and the `2025-06-15 9:5` case untouched — both must stay green.

4. **Add the constants to [`packages/lib/src/typescript/lib/component/input/dateMath.ts`](packages/lib/src/typescript/lib/component/input/dateMath.ts)**, exactly as `## Internal Structure` shows, between `parseIsoDate`'s closing brace (line 229) and `parseClockTime`'s JSDoc block.

5. **Replace `parseClockTime`'s body** (lines 241–257) with the version in `## Internal Structure`. The local names `hStr`, `mStr`, `sStr`, `hasMinutes`, `validHour`, `validMin` and `validSec` all disappear.

6. **Rewrite the two JSDoc blocks in the same file.**
   - `ClockTime`'s JSDoc (lines 154–161): drop the sentence about a fractional second arriving intact and `setHours` truncating it — it is now false. Replace with: each part is a whole number already inside its own range, so a caller never rounds or clamps what it gets.
   - `parseClockTime`'s JSDoc (lines 231–240): state the accepted form as one or two digits per part, seconds optional and defaulting to `0`, and say that anything else — a missing part, a trailing separator, a sign, a fractional or exponent form, surrounding whitespace, or an out-of-range value — is rejected.

   Neither block may `{@link}` a public symbol it did not already link (per `CODE_CONVENTIONS.md`, and both are `@internal` anyway).

7. **Run `npx vitest run tests/component/input/ tests/component/table/cell/editor.test.ts`** from `packages/lib` — every case from steps 1–3 now passes, and nothing else in those files regresses.

8. **Add the absolute-form note to [`packages/lib/docs/components/TimeField.md`](packages/lib/docs/components/TimeField.md)** as a new first bullet under `## Notes` (before line 51), mirroring [`DateField.md:66`](packages/lib/docs/components/DateField.md#L66)'s sentence: the absolute form is read back exactly as written — one or two digits for the hour, the minute and the optional second, separated by `:` — and a missing hour (`:30`), a trailing separator (`09:30:`), a fractional second (`09:30:05.5`), a sign, surrounding whitespace or an out-of-range part all leave the field invalid rather than committing a time the text never named, with blur clearing it.

9. **Extend the absolute-form bullet in [`packages/lib/docs/components/DateTimeField.md:64`](packages/lib/docs/components/DateTimeField.md#L64)** so its list of rejects also names a fractional second (`14:30:05.5`), a trailing separator (`14:30:`) and a missing hour (`:30`). Do **not** claim surrounding whitespace is rejected here — `parseIsoDateTime` trims the whole string, so `  2025-06-15   14:30  ` still parses.

10. **Amend the two stale clauses in [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md).** In the entry at line 1335: replace "and now drops the sub-second part of a fractional second instead of keeping it" with a statement that a fractional second is rejected, and delete the closing "`TimeField` is unchanged." The entry at line 1353 needs no change.

11. **Add the new changelog entry** to the same file, immediately after the table-cell-editor entry that ends at line 1366 (so the three temporal entries sit together, still under `## Fixed` → `### Components`). It states: the absolute time form is now read back exactly as it is written, `H:MM[:SS]` with one or two digits per part; `TimeField`, `DateTimeField` and the table's time and date-time cell editors share it; and it names the forms that stop being accepted (`9:30:00:99`, `1e1:30`, `0x9:30`, `9.5:30`, `09:30:`, `:30`, `+9:30`, `009:30`, a fractional second, and — for `TimeField` and the time cell editor — surrounding whitespace). Add that a consumer feeding text into one of these should format it the way the component does, and link `[Migration](/reference/migration/next)`.

12. **Add the migration note** to [`packages/lib/docs/reference/migration/next.md`](packages/lib/docs/reference/migration/next.md), as a new `## The absolute time form is read back exactly as it is written` section at the end. Follow the file's existing two-paragraph shape — a **What changed and why** paragraph and a **Who needs to act** paragraph. The consumer who must act is one that puts time *text* into one of the four components: a `Binding` whose `set` writes a formatted string, a store column holding a `time` string, or a paste. Close the section with a table of source text and the text to write instead, so the required normalisation is visible rather than described:

    | Was accepted | Write instead |
    |---|---|
    | `" 9:30"` | `"9:30"` — trim first |
    | `"09:30:00.000"` | `"09:30:00"` — drop the fractional part |
    | `":30"` | `"0:30"` — name the hour |
    | `"+9:30"` | `"9:30"` — drop the sign |
    | `"9:30:00:99"` | `"9:30:00"` — at most three parts |

13. **Regression greps**, from the repo root:
    - `grep -rn 'split(":")' packages/lib/src/typescript/lib/component/input/dateMath.ts` — expect zero matches.
    - `grep -rn 'trim()' packages/lib/src/typescript/lib/component/input/dateMath.ts` — expect exactly two, both pre-existing: `tokenizeDateMath`'s and `parseIsoDateTime`'s. `parseClockTime` must not have gained one.
    - `grep -n 'sub-second' packages/lib/docs/reference/changelog/next.md` — expect zero matches; the corrected clause no longer describes a fractional second being kept.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/dateMath.ts` |
| Modify | `packages/lib/tests/component/input/dateMath.test.ts` |
| Modify | `packages/lib/tests/component/input/DateTimeField.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/editor.test.ts` |
| Modify | `packages/lib/docs/components/TimeField.md` |
| Modify | `packages/lib/docs/components/DateTimeField.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

### `parseClockTime` — accepted (all unit-testable)

| Input | Result |
|---|---|
| `"09:30"` | `{ hours: 9, minutes: 30, seconds: 0 }` |
| `"9:5"` | `{ hours: 9, minutes: 5, seconds: 0 }` |
| `"09:30:45"` | `{ hours: 9, minutes: 30, seconds: 45 }` |
| `"09:30:5"` | `{ hours: 9, minutes: 30, seconds: 5 }` |
| `"0:0:0"` | `{ hours: 0, minutes: 0, seconds: 0 }` |
| `"23:59:59"` | `{ hours: 23, minutes: 59, seconds: 59 }` |

### `parseClockTime` — newly rejected (all unit-testable)

Every row returns `null` after the change. The middle column is what it returns today.

| Input | Today | Rejected because |
|---|---|---|
| `"9:30:00:99"` | 09:30:00 | a fourth part is left over |
| `"1e1:30"` | 10:30:00 | `e` is not a digit |
| `"0x9:30"` | 09:30:00 | `x` is not a digit |
| `"9.5:30"` | 09:30:00 | `.` is not a digit |
| `"09:30:"` | 09:30:00 | the seconds part is empty |
| `":30"` | 00:30:00 | the hour part is empty |
| `" 9:30"` | 09:30:00 | leading whitespace |
| `"9:30 "` | 09:30:00 | trailing whitespace |
| `"+9:30"` | 09:30:00 | a sign is not a digit |
| `"-0:30"` | 00:30:00 | a sign is not a digit |
| `"009:30"` | 09:30:00 | three hour digits |
| `"09:30:05.5"` | 09:30:05.5 | `.` is not a digit |

### `parseClockTime` — still rejected (all unit-testable)

`"09"`, `"9:"`, `"24:00"`, `"09:60"`, `"09:30:61"`, `"-1:00"`, `"abc"`, `""`, `"09:3 0"` — all `null` before and after.

### The four components (all unit-testable)

| Component | Input | Result |
|---|---|---|
| `TimeField.parseRaw` | `" 9:30"` | `null` — field turns invalid, blur clears the text and the value |
| `TimeField.parseRaw` | `"9:5"` | today's date at 09:05:00 — unchanged |
| `DateTimeField.parseRaw` | `"2025-06-15 14:30:05.5"` | `null` |
| `DateTimeField.parseRaw` | `"  2025-06-15   14:30  "` | 15 Jun 2025 14:30 — unchanged, `parseIsoDateTime` trims |
| `DateTimeField.parseRaw` | `"2025-06-15 9:5"` | 15 Jun 2025 09:05 — unchanged |
| `TimeEditor` (table) | `":30"` | caches `null`; the cell reverts to its previous value on commit, with no `commit` event |
| `TimeEditor` (table) | `"09:30:"` | caches `null`; same revert |
| `DateTimeEditor` (table) | `"2025-06-15 14:30:"` | caches `null`; same revert |

The revert-on-commit path is the one `editor.test.ts` already exercises for unparseable text; these rows only add inputs to it.

### Manual verification

| Check | How |
|---|---|
| A rejected time clears on blur rather than committing | `npm run docs:dev`, open `/components/TimeField`, type `:30` into the field, confirm the red invalid border, then click away — the field must clear rather than show `00:30` |

---

## Verification

Run from `packages/lib` unless stated:

1. `npm run typecheck` — 0 errors.
2. `npm run typecheck:test` — 0 errors.
3. `npx vitest run tests/component/input/dateMath.test.ts tests/component/input/TimeField.test.ts tests/component/input/DateTimeField.test.ts tests/component/input/DateField.test.ts tests/component/table/cell/editor.test.ts` — the files this plan changes, plus the two it must not regress (`DateField.test.ts` shares `dateMath.ts`; `TimeField.test.ts` pins the unpadded `9:5`).
4. `npm test` — the full suite, once.
5. `npm run lint`.
6. `npm run docs:api` — no new warnings. `parseClockTime` and `ClockTime` are `@internal` and must stay unlinked from any rendered page's JSDoc.
7. `npm run docs:llms:check` — unaffected; no class is added or renamed.
8. The three greps in step 13.
9. The manual check in `## Expected Behaviour`.

---

## Documentation Impact

`parseClockTime` is `@internal` and exported from no barrel, so no API page changes. The consumer-facing contract is stated on four pages:

| Page | Change |
|---|---|
| `packages/lib/docs/components/TimeField.md` | New `## Notes` bullet giving the absolute form and its rejects (step 8). The page has no such bullet today, unlike its two siblings. |
| `packages/lib/docs/components/DateTimeField.md` | Line 64's reject list gains the three new time-half rejects (step 9). |
| `packages/lib/docs/reference/changelog/next.md` | Two clauses corrected, one entry added (steps 10–11). |
| `packages/lib/docs/reference/migration/next.md` | New section (step 12). |

[`packages/lib/docs/components/TableInternals.md:57`](packages/lib/docs/components/TableInternals.md#L57) needs no edit: it says each editor reads text "with the rule its form-field sibling uses — … `H:MM[:SS]` as in `TimeField`", which stays true because the rule moves for both at once.

`packages/lib/llms.txt` needs no edit: it indexes components, not parse grammars, and no component is added or renamed.

---

## Potential Challenges

- **Two existing tests assert the old looseness** — `editor.test.ts:898` (`:30`) and `DateTimeField.test.ts:104` (a fractional second). Steps 2 and 3 flip them. If either is left as it stands, step 7's run fails on it — that failure is the old contract, not a defect in the new one.
- **An implementer may reach for `.trim()`** to keep the whitespace forms working. That would diverge from `parseIsoDate`, which rejects them; the step-13 grep catches it.
- **The file's other regex, `DATE_MATH_TOKEN`, carries a `g` flag** and is stateful across calls. `CLOCK_TIME` must not copy it — `exec` on a `g` regex resumes from `lastIndex` and would return `null` on every other call.
- **`ClockTime`'s JSDoc currently documents the fractional-second behaviour as a feature.** Leaving it in place would leave the module's own documentation contradicting its code; step 6 is not optional.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/component/input/dateMath.ts`](packages/lib/src/typescript/lib/component/input/dateMath.ts) | The only file whose logic changes. `ISO_DATE:152` and `parseIsoDate:209` are the precedent this plan mirrors; `parseIsoDateTime:270` is the composite that keeps its own trim. |
| [`packages/lib/src/typescript/lib/component/input/TimeField.ts:123`](packages/lib/src/typescript/lib/component/input/TimeField.ts#L123) | `parseRaw` — the shorthand branch runs first, then `parseClockTime`. |
| [`packages/lib/src/typescript/lib/component/input/DateTimeField.ts:132`](packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L132) | `parseRaw` — reaches `parseClockTime` through `parseIsoDateTime`. |
| [`packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts:203`](packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts#L203) | `onInput` — caches `null` for a rejected entry, which the cell turns into a revert. |
| [`packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts:259`](packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts#L259) | `onInput` — same, through `parseIsoDateTime`. |
| [`packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts:427`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L427) | `onInput` / `onBlur` — shows why a reject is an invalid border while typing and a cleared field on blur, and confirms the raw text reaches `parseRaw` untrimmed. |
| [`plans/implemented/tooltip-picker-and-serialization-fixes.md`](plans/implemented/tooltip-picker-and-serialization-fixes.md) | The plan that extracted `parseClockTime` verbatim and listed relaxing `TimeField`'s rule as a Non-Goal. This plan is that deferred item. |

---

## Non-Goals

- **Requiring zero-padded parts.** `9:5` stays accepted; the changelog already advertises it as newly accepted by `DateTimeField` and the date-time cell editor.
- **Touching `parseIsoDate`, `parseIsoDateTime` or the relative shorthand.** The date half and the `[sign]digits+unit` grammar are already strict and are not in this plan's statement.
- **Trimming inside `parseClockTime`.** Whitespace tolerance stays where it already is, in `parseIsoDateTime`.
- **12-hour or AM/PM input.** No component formats it, so no component should read it.
- **A QA panel.** `form-flat` builds a `TimeField` but drives only `DateField` with typed text (`type=date`), and the change is fully covered by jsdom cases.
- **Reworking the invalid-border feedback.** A rejected entry still turns the border red on the keystroke and clears on blur, unchanged.

---

## Notes

[^breaking-ok]: The library's own versioning policy
    ([`packages/lib/docs/reference/migration/index.md`](packages/lib/docs/reference/migration/index.md))
    says `0.x.y` may break anything, and that a change needing consumer
    updates gets a migration page entry. This plan takes that route rather
    than keeping the loose forms behind an option: an option would make the
    accepted grammar a per-field property, which nothing in the library or in
    the two consuming apps has asked for, and would leave the doc pages unable
    to state one contract.

[^regex-precedent]: `parseIsoDate` is the same problem one field over — read back
    exactly what `formatValue` writes, reject everything else — and it solves
    it with a full-match regex for the shape plus a targeted check for what the
    shape cannot express (a day that does not exist in its month). Copying that
    split keeps both halves of `dateMath.ts` legible in the same way. The
    alternative considered was patching the existing check in place — adding
    `Number.isInteger`, a `startsWith("+")` guard and a `split(":").length`
    check. It was rejected because it cannot express the shape: `Number.isInteger`
    still admits `1e1` (10) and `0x9` (9), and each added guard is one more
    place for the next loose form to slip through. The regex states the whole
    accepted language in one line instead.

[^trailing-separator]: Reading `09:30:` as 09:30:00 would mean the parser
    guesses at a part the user has not finished typing, which is the same
    defect as the old `2026` → 1 January date behaviour the changelog entry at
    line 1335 already calls out. `9:` is rejected today for exactly this
    reason — the check it replaces required a non-empty minute part — so rejecting an empty
    seconds part makes the two separators behave alike rather than introducing
    a new rule.

[^no-trim]: Trimming inside `parseClockTime` would put whitespace tolerance in
    two places: `parseIsoDateTime` already trims the whole string before
    splitting it, so a trim in the time half would be dead code on that path
    and a divergence from `parseIsoDate` on the `TimeField` path. `parseIsoDate`
    has a test asserting `"2026-09-16 "` is `null`, so `DateField` already
    rejects a pasted trailing space; matching it keeps the two fields
    explainable with one sentence.

[^unpadded-stays]: The changelog entry at line 1344 advertises `DateTimeField`
    and the date-time cell editor as *newly* accepting an unpadded `9:5`, and
    `TimeField` has accepted it since before the extraction. Three tests pin it
    (`dateMath.test.ts:178`, `DateTimeField.test.ts:90`, `editor.test.ts:890`).
    Requiring `H:MM` with exactly two minute digits would undo an advertised
    change in the same unreleased cycle that made it, for no gain — an unpadded
    part is unambiguous, which is the property the other rejects lack.

[^colon-thirty]: `editor.test.ts:898` names the case
    `'":30" parses to 00:30, the quirk TimeField shares'`, and the plan that
    extracted `parseClockTime` listed `":30"` in its Non-Goals as a
    pre-existing quirk kept deliberately so the extraction stayed
    behaviour-preserving. It was never a decision to support the form, and no
    doc page mentions it.

[^changelog-amend]: The two entries are in `next.md`, which is unreleased, and
    they describe the parse behaviour shipping in this same release. Leaving
    "drops the sub-second part of a fractional second instead of keeping it"
    and "`TimeField` is unchanged" in place would publish two statements that
    were never true of any released build. The new entry is separate rather
    than folded into them because it changes `TimeField` too, which those
    entries are explicitly about *not* changing — a reader tracing
    `TimeField`'s behaviour needs one entry that says so.
