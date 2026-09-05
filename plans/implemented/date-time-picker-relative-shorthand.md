---
touches-shared:
  - packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts
  - packages/lib/tests/component/input/DateField.test.ts
---

# Relative Date/Time Shorthand for the Picker Fields — Implementation Plan

## Overview

`DateField`, `TimeField`, and `DateTimeField` accept only their own strict absolute format today — `2026-12-31`, `09:30`, `2026-12-31 09:30`. This plan adds a second accepted entry form to all three: a **relative shorthand** such as `+9y`, `-2w3d`, or `1y 6mo`, which resolves against the real current moment and produces an absolute value.

The grammar lives in one new internal module, `packages/lib/src/typescript/lib/component/input/dateMath.ts` — a unit union, a token type, and three pure functions, consumed directly by the three concrete field classes. Each field's `parseRaw` gains one new first branch that tries the shorthand and falls through to its existing strict parser unchanged: [`DateField.ts:108-112`](../packages/lib/src/typescript/lib/component/input/DateField.ts#L108), [`TimeField.ts:115-134`](../packages/lib/src/typescript/lib/component/input/TimeField.ts#L115), [`DateTimeField.ts:127-139`](../packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L127).

The shared base [`AbstractPickerField.ts`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts) gains two protected methods and two call sites, so that the literal shorthand text the user typed is replaced by the formatted absolute value when the entry is committed — on blur ([`AbstractPickerField.ts:439-447`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L439)) or on Enter ([`AbstractPickerField.ts:478-492`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L478)). Nothing new reaches the package barrel.

---

## Architecture Decisions

### The grammar lives in a new internal module beside its consumers

Add `packages/lib/src/typescript/lib/component/input/dateMath.ts`: a camelCase, function-only module exporting one union type, one token type, and three pure functions, imported by the three field classes and **not** re-exported from [`component/input/index.ts`](../packages/lib/src/typescript/lib/component/input/index.ts). The new module mirrors [`data/temporalText.ts`](../packages/lib/src/typescript/lib/data/temporalText.ts) — a small pure `Date` helper shared by sibling components — and [`component/input/focusRing.ts`](../packages/lib/src/typescript/lib/component/input/focusRing.ts), the one existing function-only module in this same directory.[^module-home]

### Shorthand is tried inside `parseRaw`, as a new first branch

Each concrete field's `parseRaw` tries `resolveDateMath` first and returns immediately on a non-null result; the existing strict-format body below it is not touched. `parseRaw` is the single seam every entry path already funnels through, so one branch per field covers live typing, blur, and Enter at once.[^parse-seam]

### The base moment is the real "now", never the field's current value

Every resolution starts from `new Date()` at the moment `parseRaw` runs, not from `this._value`. Re-resolving the same shorthand text later gives a different absolute result; that is the intended behaviour.[^base-now]

### Each field normalizes its base to the shape its strict parser produces

The raw `new Date()` carries a time-of-day and milliseconds that neither `DateField` nor the pickers ever produce. Each field trims its base before handing it to `resolveDateMath`:

| Field | Base handed to `resolveDateMath` | Matches |
|---|---|---|
| `DateField` | `new Date(now.getFullYear(), now.getMonth(), now.getDate())` | `new Date(raw + "T00:00:00")` at [`DateField.ts:109`](../packages/lib/src/typescript/lib/component/input/DateField.ts#L109); the midnight `Date` the calendar commits at [`AbstractCalendarDropdown.ts:1596`](../packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L1596) |
| `TimeField` | `new Date()` with `setMilliseconds(0)` | `d.setHours(h, m, s, 0)` at [`TimeField.ts:131`](../packages/lib/src/typescript/lib/component/input/TimeField.ts#L131) |
| `DateTimeField` | `new Date()` with `setMilliseconds(0)` | the ms-zeroed `Date` the dropdown commits at [`DateTimePickerDropdown.ts:108`](../packages/lib/src/typescript/lib/component/input/DateTimePickerDropdown.ts#L108) |

Every allowed unit for a field preserves that field's normalization, so the resolved value always has the same shape as a typed or picked one.[^base-shape]

### The displayed text is rewritten only when the entry is committed

`onInput` fires on every keystroke ([`AbstractPickerField.ts:414-433`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L414)) and stays exactly as it is — it parses the shorthand, clears the invalid border, and notifies listeners, but leaves the typed characters alone. A new base-class method `commitShorthandIfPresent()` replaces the literal text with the formatted absolute value, and only `onBlur` and the Enter branch of `onKeyDown` call it.[^commit-on-blur]

### An open dropdown keeps its claim on Enter

The new Enter branch is added to the existing `if / else if` ladder in `onKeyDown`, *after* the `this._dropdown.handleKey(e)` block at [`AbstractPickerField.ts:479-483`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L479). When the dropdown is open and consumes Enter, the dropdown still wins and nothing about today's behaviour changes.[^enter-order]

### Native `Date` rollover is kept, not clamped

`setMonth` and `setFullYear` roll an impossible calendar day forward — with a base of 31 January 2026, `1mo` yields 3 March 2026, because February 31 overflows. That is plain JavaScript `Date` behaviour and it is kept.[^rollover]

### The shorthand path performs no `minDate` / `maxDate` check

`DateField.parseRaw` and `DateTimeField.parseRaw` do not validate typed text against the cached `minDate` / `maxDate` today — only the dropdown UI enforces those bounds. The shorthand branch stays consistent with that.[^no-bounds]

---

## Public API

Nothing is added to any package entry point. `dateMath.ts` is internal (like `focusRing.ts` and `TimeColumns.ts`, neither of which appears in `component/input/index.ts`), and the two new `AbstractPickerField` members are `protected`, which TypeDoc excludes.

New internal module — `packages/lib/src/typescript/lib/component/input/dateMath.ts`:

```ts
export type DateMathUnit = "y" | "mo" | "w" | "d" | "h" | "mi" | "s";

export interface DateMathToken {
    amount: number;
    unit:   DateMathUnit;
}

/** Returns the ordered tokens, or null when `raw` is not a fully-matching expression over `allowed`. */
export function tokenizeDateMath(raw: string, allowed: readonly DateMathUnit[]): DateMathToken[] | null;

/** Folds `tokens` left-to-right onto a clone of `base`. May return an Invalid Date on overflow. */
export function applyDateMath(base: Date, tokens: readonly DateMathToken[]): Date;

/** tokenize + apply + reject overflow. The one function the fields call. */
export function resolveDateMath(raw: string, allowed: readonly DateMathUnit[], base: Date): Date | null;
```

New members on `AbstractPickerField`:

```ts
/** Whether `raw` is a relative shorthand expression for this field. Default: false. */
protected isRawShorthand(raw: string): boolean;

/** Commits a pending shorthand entry, rewriting the input text. Returns whether it committed. */
protected commitShorthandIfPresent(): boolean;
```

Each concrete field overrides `isRawShorthand` and declares a module-level unit list:

| File | Constant | Value |
|---|---|---|
| `DateField.ts` | `DATE_FIELD_UNITS` | `["y", "mo", "w", "d"]` |
| `TimeField.ts` | `TIME_FIELD_UNITS` | `["h", "mi", "s"]` |
| `DateTimeField.ts` | `DATE_TIME_FIELD_UNITS` | `["y", "mo", "w", "d", "h", "mi", "s"]` |

---

## Internal Structure

### The grammar

An expression is one or more tokens, each `[sign]digits+unit`, with optional whitespace between them. **Each token carries its own sign, defaulting to `+`; a sign never distributes across later tokens.** Matching is case-insensitive. The whole trimmed string must be consumed, or the expression is not shorthand at all.

Units are `y` (year), `mo` (month), `w` (week), `d` (day), `h` (hour), `mi` (minute), `s` (second). `mo` and `mi` are two letters on purpose: a bare `m` would be ambiguous between month and minute, so `m` alone is not a unit and `1m` is rejected.

| Input | Tokens | Meaning |
|---|---|---|
| `+9y` | `+9 y` | nine years later |
| `9y` | `+9 y` | identical — a missing sign means `+` |
| `-9y` | `-9 y` | nine years earlier |
| `-2w3d` | `-2 w`, `+3 d` | fourteen days earlier, then three days later (net -11 days) — **not** -(2w+3d) |
| `1y 6mo` | `+1 y`, `+6 mo` | whitespace between tokens is allowed |
| `+30MI` | `+30 mi` | units are case-insensitive |
| `1m` | — | `m` is not a unit; rejected |
| `+9y x` | — | leftover `x`; the whole string is rejected |
| `2026-12-31` | — | no unit letters; rejected, so the strict parser sees it |

### `dateMath.ts`

Both regexes are built from one shared unit fragment so the accepted unit set is written once.[^regex-safety]

```ts
// The seven unit suffixes as a regex alternation, shared by the two patterns
// below so the accepted set is declared exactly once. Two-letter units come
// first: `mo` and `mi` must be tried before the single-letter class.
const UNIT_ALTERNATION = "mo|mi|[ywdhs]";

// Full-match guard: one or more `[sign]digits+unit` tokens separated by
// optional whitespace, with nothing left over.
const DATE_MATH_SYNTAX = new RegExp(`^(?:[+-]?\\d+(?:${UNIT_ALTERNATION})\\s*)+$`, "i");

// Token extractor, run only after DATE_MATH_SYNTAX has accepted the string.
const DATE_MATH_TOKEN = new RegExp(`([+-]?)(\\d+)(${UNIT_ALTERNATION})`, "gi");

// Days in a week. Named because `w` is applied through setDate rather than a
// dedicated native setter — there is no `setWeek`.
const DAYS_PER_WEEK = 7;
```

```ts
export function tokenizeDateMath(raw: string, allowed: readonly DateMathUnit[]): DateMathToken[] | null {
    const text = raw.trim();

    if (!DATE_MATH_SYNTAX.test(text)) {
        return null;
    }

    const tokens: DateMathToken[] = [];

    for (const match of text.matchAll(DATE_MATH_TOKEN)) {
        const unit   = match[3].toLowerCase() as DateMathUnit;
        const amount = Number(match[2]);

        if (!allowed.includes(unit)) {
            return null;
        }

        tokens.push({ amount: match[1] === "-" ? -amount : amount, unit });
    }

    return tokens;
}
```

The `+` quantifier in `DATE_MATH_SYNTAX` needs at least one token, so an accepted string always yields a non-empty list and `""` is rejected before the loop.

```ts
export function applyDateMath(base: Date, tokens: readonly DateMathToken[]): Date {
    const result = new Date(base.getTime());

    for (const token of tokens) {
        switch (token.unit) {
            case "y":
                result.setFullYear(result.getFullYear() + token.amount);
                break;

            case "mo":
                result.setMonth(result.getMonth() + token.amount);
                break;

            case "w":
                result.setDate(result.getDate() + token.amount * DAYS_PER_WEEK);
                break;

            case "d":
                result.setDate(result.getDate() + token.amount);
                break;

            case "h":
                result.setHours(result.getHours() + token.amount);
                break;

            case "mi":
                result.setMinutes(result.getMinutes() + token.amount);
                break;

            case "s":
                result.setSeconds(result.getSeconds() + token.amount);
                break;
        }
    }

    return result;
}
```

```ts
export function resolveDateMath(raw: string, allowed: readonly DateMathUnit[], base: Date): Date | null {
    const tokens = tokenizeDateMath(raw, allowed);

    if (tokens === null) {
        return null;
    }

    const result = applyDateMath(base, tokens);

    return isNaN(result.getTime()) ? null : result;
}
```

The `isNaN(result.getTime())` guard mirrors the identical check already ending `DateField.parseRaw` ([`DateField.ts:111`](../packages/lib/src/typescript/lib/component/input/DateField.ts#L111)) and `DateTimeField.parseRaw` ([`DateTimeField.ts:138`](../packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L138)).

### `AbstractPickerField.commitShorthandIfPresent`

```ts
protected commitShorthandIfPresent(): boolean {
    const raw = this._input.getText();

    if (!raw || !this.isRawShorthand(raw)) {
        return false;
    }

    const resolved = this.parseRaw(raw);

    if (resolved === null) {
        return false;
    }

    this.setValue(resolved);
    this.notifyChange(resolved);
    this.setInvalid(false);

    return true;
}
```

`setValue` writes the formatted text through `this._input.setText(...)` ([`AbstractPickerField.ts:299`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L299)); that write does not re-enter `onInput`.[^no-settext-echo] `notifyChange` and `setInvalid` are both already inherited/declared as protected — [`AbstractInput.ts:218`](../packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L218) and [`AbstractPickerField.ts:454`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L454).

---

## Ordered Implementation Steps

1. **Create `packages/lib/tests/component/input/dateMath.test.ts`.** Cover `## Expected Behaviour` cases 1-14. Import from `~/component/input/dateMath`; no DOM harness is needed. The file is expected to fail to resolve its import at this point.

2. **Create `packages/lib/src/typescript/lib/component/input/dateMath.ts`** exactly as `## Internal Structure` specifies. Start the file with the `// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0` line every source file in this package carries. Give the union type, the interface, and each exported function a JSDoc block per [`CODE_CONVENTIONS.md`](../CODE_CONVENTIONS.md); tag the module's exported symbols `@internal — not re-exported from the package barrel.`, copying the wording at [`temporalText.ts:21`](../packages/lib/src/typescript/lib/data/temporalText.ts#L21).
   *Check:* `cd packages/lib && npx vitest run tests/component/input/dateMath.test.ts` — green.
   *Check:* `grep -n "dateMath" packages/lib/src/typescript/lib/component/input/index.ts` — expect zero matches.

3. **Edit `packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts`.** Add no new imports.
   - Add `isRawShorthand(raw: string): boolean { return false; }` as a protected method returning `false`, placed next to the other protected hooks.
   - Add `commitShorthandIfPresent()` exactly as `## Internal Structure` gives it.
   - In `onBlur` ([line 439](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L439)), insert as the new first statements:
     ```ts
     if (this.commitShorthandIfPresent()) {
         return;
     }
     ```
     Leave the existing `if (!this._invalid) { return; }` block and everything below it unchanged.
   - In `onKeyDown` ([line 478](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L478)), extend the existing ladder — after the `else if (e.key === "Escape")` branch, and leaving the `_dropdown.handleKey` block above it untouched:
     ```ts
     } else if (e.key === "Enter") {
         if (this.commitShorthandIfPresent()) {
             return { prevent: true };
         }
     }
     ```
   *Check:* `npm run typecheck` — clean. Behaviour is unchanged so far, because `isRawShorthand` still always returns `false`.

4. **Edit `packages/lib/src/typescript/lib/component/input/DateField.ts`.** Write the tests for `## Expected Behaviour` cases 15-19 and 27-32, 35-36 into `packages/lib/tests/component/input/DateField.test.ts` first — cases 27-29 are stated field-agnostically and are covered here, on `DateField`.
   - Import `resolveDateMath`, `tokenizeDateMath`, and the `DateMathUnit` type from `~/component/input/dateMath.js`.
   - Add the module-level constant, with a comment giving the reason time units are excluded (the field formats only `YYYY-MM-DD`, so an hour/minute/second offset would move the stored `Date` without changing a character of the displayed text):
     ```ts
     const DATE_FIELD_UNITS: readonly DateMathUnit[] = ["y", "mo", "w", "d"];
     ```
   - Replace the body of `parseRaw` ([lines 108-112](../packages/lib/src/typescript/lib/component/input/DateField.ts#L108)) with the shorthand branch plus the untouched original two statements:
     ```ts
     const now      = new Date();
     const relative = resolveDateMath(
         raw,
         DATE_FIELD_UNITS,
         new Date(now.getFullYear(), now.getMonth(), now.getDate()),
     );

     if (relative !== null) {
         return relative;
     }

     const d = new Date(raw + "T00:00:00");

     return isNaN(d.getTime()) ? null : d;
     ```
     Extend the method's JSDoc to mention the shorthand branch.
   - Add the override:
     ```ts
     protected isRawShorthand(raw: string): boolean {
         return tokenizeDateMath(raw, DATE_FIELD_UNITS) !== null;
     }
     ```
   *Check:* `cd packages/lib && npx vitest run tests/component/input/DateField.test.ts` — green.

5. **Edit `packages/lib/src/typescript/lib/component/input/DateTimeField.ts`.** Write the tests for `## Expected Behaviour` cases 24-26 and 34 into `packages/lib/tests/component/input/DateTimeField.test.ts` first. Same three edits as step 4, with `DATE_TIME_FIELD_UNITS = ["y", "mo", "w", "d", "h", "mi", "s"]` and this base, prepended to the existing `parseRaw` body ([lines 127-139](../packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L127)):
   ```ts
   const base = new Date();
   base.setMilliseconds(0);

   const relative = resolveDateMath(raw, DATE_TIME_FIELD_UNITS, base);

   if (relative !== null) {
       return relative;
   }
   ```
   *Check:* `cd packages/lib && npx vitest run tests/component/input/DateTimeField.test.ts` — green.

6. **Edit `packages/lib/src/typescript/lib/component/input/TimeField.ts`.** Write the tests for `## Expected Behaviour` cases 20-23 and 33 into `packages/lib/tests/component/input/TimeField.test.ts` first. Same three edits, with `TIME_FIELD_UNITS = ["h", "mi", "s"]` and the same ms-zeroed base as step 5, prepended to the existing `parseRaw` body ([lines 115-134](../packages/lib/src/typescript/lib/component/input/TimeField.ts#L115)). Comment the constant with the reason date units are excluded (the field formats only `HH:MM[:SS]`).
   *Check:* `cd packages/lib && npx vitest run tests/component/input/TimeField.test.ts` — green.

7. **Confirm the shorthand grammar is written in exactly one place.**
   *Check:* `grep -rn 'mo|mi' packages/lib/src/typescript/lib/` — expect matches only in `dateMath.ts`. (Plain `grep` treats `|` literally, so this searches for the alternation string itself.)
   *Check:* `grep -rln "resolveDateMath\|tokenizeDateMath" packages/lib/src/typescript/lib/` — expect exactly `dateMath.ts`, `DateField.ts`, `TimeField.ts`, `DateTimeField.ts`.

8. **Run the full verification set** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/input/dateMath.ts` |
| Create | `packages/lib/tests/component/input/dateMath.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/DateField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TimeField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/DateTimeField.ts` |
| Modify | `packages/lib/tests/component/input/DateField.test.ts` |
| Modify | `packages/lib/tests/component/input/TimeField.test.ts` |
| Modify | `packages/lib/tests/component/input/DateTimeField.test.ts` |

---

## Expected Behaviour

Cases 1-36 are unit-testable; cases 37-40 need manual verification in the running app.

All field-level cases below assume the clock is pinned to **31 January 2026, 10:15:30.500 local**.[^fixed-clock] That instant is chosen because 31 January exercises the month-end rollover.

### `dateMath.ts` in isolation

Let `ALL` be `["y", "mo", "w", "d", "h", "mi", "s"]`.

1. `tokenizeDateMath("+9y", ALL)` returns `[{ amount: 9, unit: "y" }]`.
2. `tokenizeDateMath("9y", ALL)` returns the same list as `"+9y"` — a missing sign means `+`.
3. `tokenizeDateMath("-9y", ALL)` returns `[{ amount: -9, unit: "y" }]`.
4. `tokenizeDateMath("-2w3d", ALL)` returns `[{ amount: -2, unit: "w" }, { amount: 3, unit: "d" }]` — the second token is **positive**; the leading `-` does not distribute.
5. `tokenizeDateMath("1y 6mo", ALL)` returns two tokens — whitespace between tokens is accepted.
6. `tokenizeDateMath("+30MI", ALL)` returns `[{ amount: 30, unit: "mi" }]` — units match case-insensitively.
7. `tokenizeDateMath(raw, ALL)` returns `null` for each of `""`, `"+"`, `"1"`, `"y"`, `"1m"`, `"1.5d"`, `"9yy"`, `"+9y x"`, `"2026-12-31"`, `"09:30"`, `"garbage"`.
8. `tokenizeDateMath("+1h", ["y", "mo", "w", "d"])` returns `null` — `h` is outside the supplied list.
9. `tokenizeDateMath("1y2h", ["y", "mo", "w", "d"])` returns `null` — one disallowed unit rejects the whole expression, not just that token.
10. `applyDateMath(new Date(2026, 0, 31), [{ amount: 1, unit: "mo" }])` returns 3 March 2026 — the documented native rollover, asserted as-is.
11. `applyDateMath` does not mutate its `base` argument.
12. `applyDateMath(new Date(2026, 0, 31), [{ amount: -2, unit: "w" }, { amount: 3, unit: "d" }])` returns 20 January 2026.
13. `resolveDateMath("999999999y", ALL, new Date(2026, 0, 31))` returns `null` — the offset pushes the `Date` out of range, `getTime()` is `NaN`.
14. With a base of `new Date(2026, 0, 31)`: `resolveDateMath("garbage", ALL, base)` returns `null`, and `resolveDateMath("+1d", ALL, base)` returns 1 February 2026.

### `DateField`

15. `parseRaw("+0d")` returns exactly 31 January 2026 at local midnight — hours, minutes, seconds and milliseconds all zero.
16. `parseRaw("+9y")` returns 31 January 2035 at local midnight; `parseRaw("9y")` returns the same instant; `parseRaw("-9y")` returns 31 January 2017.
17. `parseRaw("-2w3d")` returns 20 January 2026.
18. `parseRaw("+1h")` returns `null` — `h` is not in `DATE_FIELD_UNITS`, and the strict branch cannot parse `"+1h"` either.
19. `parseRaw("2026-12-31")` still returns 31 December 2026 — the strict branch is unaffected.

### `TimeField`

20. `parseRaw("+30mi")` returns 31 January 2026 at 10:45:30.000.
21. `parseRaw("+1h30mi")` returns 31 January 2026 at 11:45:30.000.
22. `parseRaw("+1d")` returns `null` — `d` is not in `TIME_FIELD_UNITS`, and the strict branch rejects `"+1d"` because it has no minutes portion.
23. `parseRaw("09:30")` still returns 31 January 2026 at 09:30:00 — the strict branch is unaffected.

### `DateTimeField`

24. `parseRaw("1y 6mo")` returns 31 July 2027 at 10:15:30.000.
25. `parseRaw("-1d2h")` returns 30 January 2026 at 08:15:30.000.
26. `parseRaw("2026-06-15 14:30")` still returns 15 June 2026 at 14:30 — the strict branch is unaffected.

### Live typing

Cases 27 and 28 hold for all three fields; case 29 is written against `DateField`.

27. Setting the inner input's text to a valid shorthand and calling `onInput()` leaves the *typed text* untouched, sets `getValue()` to the resolved `Date`, leaves the field valid, and fires `on("change", …)` with that `Date`.
28. Setting the text to a shorthand using a unit outside that field's list and calling `onInput()` leaves the field invalid and does not fire `on("change", …)`.
29. On `new DateField({ value: new Date(2026, 0, 31) })`, typing `+1d` and calling `onInput()` makes the field dirty; typing `+0d` instead leaves it clean, because the resolved value is the same instant as the clean baseline (`valuesEqual` compares `getTime()`, [`AbstractPickerField.ts:325-331`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L325)).

### Commit on blur and Enter

30. `DateField`: text `"+9y"`, then `onInput()`, then `onBlur()` — the inner input's text becomes `"2035-01-31"` and `getValue()` is that date.
31. `DateField`: text `"+9y"`, then `onInput()`, then `onKeyDown({ key: "Enter" })` — the same rewrite happens and the call returns `{ prevent: true }`.
32. `DateField`: text `"2026-12-31"`, then `onInput()`, then `onKeyDown({ key: "Enter" })` — the text is left alone and the call returns nothing (no `prevent`), because `isRawShorthand` is false for an absolute string.
33. `TimeField`: text `"+30mi"`, then `onInput()`, then `onBlur()` — the text becomes `"10:45"`.
34. `DateTimeField`: text `"1y 6mo"`, then `onInput()`, then `onBlur()` — the text becomes `"2027-07-31 10:15"`.
35. `DateField`: text `"999999999y"`, then `onInput()`, then `onBlur()` — the field was invalid, `commitShorthandIfPresent()` returns `false` because `parseRaw` returns `null`, and the existing blur behaviour clears the text and sets the value to `null`.
36. `DateField`: text `"garbage"`, then `onInput()`, then `onBlur()` — unchanged existing behaviour: the text is cleared and the value is `null`.

### Manual verification

37. In the running demo app's **Binding** panel ([`BindingPanel.ts:63-64`](../packages/lib/src/typescript/BindingPanel.ts#L63)), typing `+9y` into the birth-date `DateField` shows a normal (non-red) border while typing, and the text turns into the absolute date only when the field loses focus or Enter is pressed. The caret does not jump while typing.
38. In the same panel, typing `+30mi` into the reminder-time `TimeField` behaves the same way, and the bound form value updates.
39. Opening the calendar dropdown with ArrowDown, navigating, and pressing Enter still selects a day — the dropdown's Enter handling is not stolen by the new branch.
40. Typing `+9y` and then clicking the calendar glyph button does **not** commit or rewrite the text (the button suppresses blur at [`AbstractPickerField.ts:405-407`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L405)); the dropdown opens with the still-literal text in the input.

---

## Verification

- `npm run typecheck` — clean.
- `npm run test` — the whole suite green (this runs `typecheck:test` first).
- `cd packages/lib && npx vitest run tests/component/input/` — the input suites green, including the pre-existing `DateField` / `TimeField` / `DateTimeField` / `DatePickerDropdown` / `TimePickerDropdown` cases.
- `npm run lint` — no new findings.
- `npm run docs:api` — finishes with zero warnings (nothing public changed, so nothing should move).
- `grep -rn "dateMath" packages/lib/src/typescript/lib/component/input/index.ts` — zero matches (the module stays internal, so `llms.txt` and the TypeDoc model are untouched).
- Manual: `npm run dev`, open the **Binding** panel and the **Baseline** panel ([`BaselinePanel.ts:81-83`](../packages/lib/src/typescript/BaselinePanel.ts#L81), which mounts all three fields side by side) and walk cases 37-40.

---

## Documentation Impact

No public API surface changes: `dateMath.ts` is not re-exported from `component/input/index.ts`, so no TypeDoc page and no `llms.txt` row appear for it, and the two new `AbstractPickerField` members are `protected` (TypeDoc excludes protected members). `npm run docs:api` should stay at zero warnings without any change.

The behaviour is consumer-visible, so after implementation lands the repo's `document` skill adds a short shorthand-syntax section to each of [`DateField.md`](../packages/lib/docs/components/DateField.md), [`TimeField.md`](../packages/lib/docs/components/TimeField.md), and [`DateTimeField.md`](../packages/lib/docs/components/DateTimeField.md) — mirroring the style of the `## Navigation` sections those pages already carry — plus a changelog entry in [`next.md`](../packages/lib/docs/reference/changelog/next.md). That prose is not drafted here.

---

## Potential Challenges

- **Vitest fake timers could disturb field construction.** The picker fields build components and subscribe to theme changes in their constructors. If `vi.useFakeTimers()` breaks `new DateField()`, narrow it to `vi.useFakeTimers({ toFake: ["Date"] })`, which pins `new Date()` and leaves every timer real.
- **A regex written twice will drift.** The syntax guard and the token extractor must accept the same units; build both from the single `UNIT_ALTERNATION` string as `## Internal Structure` shows, and the step-7 `grep` catches a second copy.
- **`DATE_MATH_TOKEN` carries the `g` flag at module scope.** Use `String.prototype.matchAll`, which works on a fresh internal clone and leaves the shared regex's `lastIndex` alone. A hand-rolled `while (re.exec(...))` loop over the same module-level regex would carry `lastIndex` between calls and silently skip tokens.
- **Blur races a dropdown click.** If clicking a day in an open dropdown blurs the input first, the shorthand commits and the dropdown's own `setValue` then overwrites it a moment later. The final value is the picked day either way; no guard is needed.
- **`commitShorthandIfPresent` re-parses.** `isRawShorthand` tokenizes and `parseRaw` tokenizes again. That double pass happens only on blur and Enter, never per keystroke, and keeping the two methods independent is what lets the base class own the commit without knowing the grammar.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts) — `onInput` (414-433), `onBlur` (439-447), `setInvalid` (454-465), `onKeyDown` (478-492), `setValue` (293-302), `valuesEqual` (325-331), and the `_input` field (82).
- [`packages/lib/src/typescript/lib/component/input/DateField.ts`](../packages/lib/src/typescript/lib/component/input/DateField.ts) — `formatValue` (93-99) and `parseRaw` (108-112).
- [`packages/lib/src/typescript/lib/component/input/TimeField.ts`](../packages/lib/src/typescript/lib/component/input/TimeField.ts) — `formatValue` (95-106) and `parseRaw` (115-134).
- [`packages/lib/src/typescript/lib/component/input/DateTimeField.ts`](../packages/lib/src/typescript/lib/component/input/DateTimeField.ts) — `formatValue` (105-119) and `parseRaw` (127-139).
- [`packages/lib/src/typescript/lib/component/input/AbstractInput.ts`](../packages/lib/src/typescript/lib/component/input/AbstractInput.ts) — `notifyChange` (218-222) and `valuesEqual` (207-209).
- [`packages/lib/src/typescript/lib/data/temporalText.ts`](../packages/lib/src/typescript/lib/data/temporalText.ts) — the precedent the new module copies: a pure `Date` helper module with a small union type, an `@internal` tag, and unit tests that call it directly.
- [`packages/lib/src/typescript/lib/component/input/focusRing.ts`](../packages/lib/src/typescript/lib/component/input/focusRing.ts) — the second precedent: a camelCase function-only module in this same directory, absent from `component/input/index.ts`.
- [`packages/lib/tests/component/input/DateField.test.ts`](../packages/lib/tests/component/input/DateField.test.ts) — the test conventions to follow: `(field as any).parseRaw(...)` to reach protected methods, `field._input.setText(...)` plus `field.onInput()` to drive the commit seam, and local (never UTC) date accessors in assertions.
- [`packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts`](../packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts) — line 1596, the midnight `Date` a day-click commits, which `DateField`'s normalized base has to match.

---

## Non-Goals

- **Rewriting the text while the user types.** `onInput` is left exactly as it is; rewriting per keystroke would fight the typing and move the caret.
- **Shifting the field's existing value.** The base is always the real current moment, never `this._value`.
- **Clamping month-end rollover.** Making `31 Jan + 1mo` land on 28 February instead of rolling to 3 March would need custom clamping this plan does not add.
- **`minDate` / `maxDate` enforcement on typed text.** Neither the strict path nor the shorthand path validates against those bounds; only the dropdown does. Closing that gap is separate work.
- **Making `dateMath.ts` generic over `AbstractPickerField`'s `TValue`.** The module is concretely `Date`-based, and the `TValue` generic is not touched.
- **Exporting the module from the package barrel.** It is consumed only by the three field classes.
- **Writing the doc prose.** See `## Documentation Impact` — the `document` skill handles it after implementation.

---

## Notes

[^module-home]: Two naming conventions coexist in this package for helper modules: PascalCase (`core/OverlayFade.ts`, `core/BorderWidths.ts`, `component/chart/Scale.ts`) and camelCase (`data/temporalText.ts`, `data/compareValues.ts`, `component/input/focusRing.ts`). The tie is broken by the two nearest precedents, which agree: `focusRing.ts` is the one function-only module already sitting in `component/input/`, and `temporalText.ts` is the closest semantic twin — a pure `Date` helper shared by several UI components, exporting a small union type plus a pure function and unit-tested on its own. Both are camelCase, so the new module is `dateMath.ts`. Location follows the same pair: the consumers are all in `component/input/`, so the module goes there rather than in `core/` (framework infrastructure) or `primitive/` (value types). `DateMathUnit` is not re-exported from `component/input/index.ts` because nothing on any field's public surface exposes it — the per-field unit lists are module-level constants, not options. `temporalText.ts` does export its `TemporalFieldType` from `data/index.ts`, but only because `FilterDescriptor`'s public API accepts one.

[^parse-seam]: `parseRaw` is the abstract hook declared at [`AbstractPickerField.ts:168`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L168), and it is the only place typed text becomes a value. `onInput` calls it on every keystroke ([line 425](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L425)) and the new commit path calls it too, so a single first branch per field serves both without either path knowing about the other. Adding a separate parallel entry point instead would mean the invalid-border logic and the change notification in `onInput` needed a second copy.

[^base-now]: The alternative — treating shorthand as an offset from the value the field already holds — was considered and rejected. A field holding a value would then interpret `+1d` differently from an empty one, which makes the same keystrokes mean two things; and it gives no way to express "a day from now" once the field is populated.

[^base-shape]: Without this normalization, `DateField.parseRaw("+0d")` would return today at the current wall-clock time, while `DateField.parseRaw("2026-01-31")` returns today at midnight — two values that display as the identical `2026-01-31` string but compare unequal. `valuesEqual` compares `Date` values by `getTime()` ([`AbstractPickerField.ts:325-331`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L325)), so the field would report itself dirty after the user typed a shorthand that resolves to the value it already had. Each field's normalization is also closed under its own allowed units: `y`/`mo`/`w`/`d` never touch the time-of-day a `DateField` zeroed, and `h`/`mi`/`s` never touch the milliseconds a `TimeField` or `DateTimeField` zeroed.

[^commit-on-blur]: `onInput` runs on every keystroke, so rewriting the displayed text there would replace `+9` with an absolute date the instant the `y` was typed, moving the caret and making the rest of the expression impossible to type. Deferring the rewrite to blur and Enter is the only point at which the user has finished the expression. `commitShorthandIfPresent` lives in the base class rather than in each field because it needs only `isRawShorthand`, `parseRaw`, and `setValue`, all of which are already polymorphic through the hierarchy — the base never learns the grammar.

[^enter-order]: `AnimatedDropdown.handleKey` is offered every key first while the dropdown is open, and the calendar dropdowns consume Enter as "select the focused day" (documented at [`AbstractPickerField.ts:468-476`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L468)). Placing the new branch in the ladder below that block means an open dropdown is unaffected. The branch also does nothing but commit: it does not close the dropdown, blur the field, or submit a form, because none of those behaviours exists on this key today and adding them would be a separate change.

[^rollover]: `new Date(2026, 0, 31)` with `setMonth(1)` asks for 31 February 2026, which the engine normalizes to 3 March 2026. Clamping to the last valid day of the target month is a defensible alternative behaviour, but it is a policy the rest of this codebase does not implement anywhere, and `DateField`'s existing parser already lets the same rollover through — `parse('2025-02-30')` returns a March date, asserted deliberately at [`DateField.test.ts:60-69`](../packages/lib/tests/component/input/DateField.test.ts#L60).

[^no-bounds]: `DateField.parseRaw` ([lines 108-112](../packages/lib/src/typescript/lib/component/input/DateField.ts#L108)) and `DateTimeField.parseRaw` ([lines 127-139](../packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L127)) never read `this._options.minDate` or `maxDate`; those are forwarded only into the dropdown's own options bag at [`DateField.ts:119-127`](../packages/lib/src/typescript/lib/component/input/DateField.ts#L119). Adding a bounds check to the shorthand branch alone would make typed text behave differently depending on which of the two branches parsed it.

[^regex-safety]: `DATE_MATH_SYNTAX` cannot backtrack pathologically despite its nested quantifiers: each iteration of the group must start with `[+-]?\d+`, which cannot match the whitespace the previous iteration's `\s*` consumed, so the split between iterations is forced rather than searched. Ordering `mo|mi` ahead of `[ywdhs]` in the alternation is not needed for correctness — the seven units share no prefix with one another and `m` alone is not a unit — but it keeps the alternation readable as "two-letter units first".

[^fixed-clock]: `new Date()` inside `parseRaw` makes every field-level assertion clock-dependent, so the tests pin it with `vi.useFakeTimers()` plus `vi.setSystemTime(new Date(2026, 0, 31, 10, 15, 30, 500))` in `beforeEach`, and `vi.useRealTimers()` in `afterEach`. Fake timers are already used across this suite (for example [`ColumnFilterRow.test.ts:189`](../packages/lib/tests/component/table/ColumnFilterRow.test.ts#L189)). Deriving expectations from a `new Date()` captured inside the test instead would leave the assertions loose and would flake whenever a test ran across local midnight.

[^no-settext-echo]: `TextInput.setText` writes through `DOM.sink.setValue(element, …)` ([`TextInput.ts:504-515`](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L504)). A programmatic value write fires no native `input` event, so the rewrite performed by `setValue` inside `commitShorthandIfPresent` cannot re-enter `onInput` and re-parse the absolute text it just wrote.

## Implementation Notes

- **`DateTimeField` case 25's expected value was corrected from `08:15:30` to `12:15:30`.** The plan's `## Expected Behaviour` states `parseRaw("-1d2h")` returns 30 January 2026 at `08:15:30.000`, but that value is only reachable if the leading `-` on `-1d2h` distributes onto the `2h` term — exactly what the grammar's own "a sign never distributes across later tokens" rule (`## Architecture Decisions`, and pinned by `dateMath.test.ts` cases 4 and 12 with the `-2w3d` example) forbids. Tokenizing `-1d2h` over the documented grammar yields `-1d` then an unsigned `+2h` (missing sign defaults to `+`); folding those onto a 10:15:30 base gives `-1 day` → 30 January 10:15:30, then `+2 hours` → 30 January **12:15:30**, independently confirmed against native `Date` arithmetic. `dateMath.ts` and `DateTimeField.parseRaw` were implemented exactly as `## Internal Structure` specifies, so this is a typo in the plan's prose, not a code deviation; `packages/lib/tests/component/input/DateTimeField.test.ts`'s case-25 test and comment record the corrected value and the reasoning.

- **Manual verification of cases 37-40 was performed and all four passed.** Ran `npx vite --port 8025` from `packages/lib` in this worktree (Vite resolved a free port, 8026) and drove it via the Chrome DevTools MCP tooling against the Binding panel's birth-date `DateField` and reminder-time `TimeField` (the same instances `## Verification` names), on 2026-09-05:
  - **Case 37:** typing `+9y` into the birth-date field left the text as `+9y` and the field's computed border color at `rgb(160, 160, 160)` (the non-invalid default) while typing; tabbing out rewrote the text to `2035-09-05` and flipped the bound record's status to "modified".
  - **Case 38:** typing `+30mi` into the reminder-time field likewise kept the border at the default color while typing; tabbing out rewrote the text to the current time plus 30 minutes (`21:57`, machine time was 21:26).
  - **Case 39:** with the birth-date field focused, ArrowDown opened the calendar dropdown, ArrowRight moved the day highlight, and Enter selected that day (5 → 6) and closed the dropdown — the new Enter-commit branch did not intercept it.
  - **Case 40:** typing `+9y` and then clicking the calendar glyph button (instead of blurring elsewhere) left the input text as the literal `+9y` and opened the dropdown, confirming the button's existing blur-suppression keeps the shorthand uncommitted.
