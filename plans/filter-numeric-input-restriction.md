---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/ColumnFilter.ts
  - packages/lib/docs/components/Table.md
  - packages/lib/docs/reference/changelog/next.md
---

# Number Column Filter Input Restriction — Implementation Plan

## Overview

A `number` column's header filter accepts any text today. Typing `abc` into it fills the input, and then nothing happens: `parseOperand('number', text)` returns `null` for text `Number()` cannot parse ([`ColumnFilter.ts:241-247`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L241)), `buildClauseFilter` drops that clause, and the table stays unfiltered with the rejected text still on screen. Live testing reported the silence as confusing. This plan refuses the keystroke instead, so a character that can never appear in a number never lands in the field.

The gate applies at exactly two places, both owned by the filter cell: the always-visible inline input, held by `FilterCellRenderer` ([`renderer/Filter.ts:58`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Filter.ts#L58)), and one `TextField` per popover clause row ([`Filter.ts:528`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L528)). Both run the same keydown check against one boolean the cell holds.

`FilterCell` knows nothing about field types today — it is handed a pre-computed `operators` list and nothing else ([`Filter.ts:98`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L98)). This plan adds a second pre-computed per-column signal alongside it, decided in `TableHeader` where the field's type and the column's config are both in hand, and re-supplied on every column-window recycle exactly as `setOperators` already is ([`Header.ts:1219`](../packages/lib/src/typescript/lib/component/table/Header.ts#L1219)).

This is the fourth round of live-testing feedback on the header filter row, after [`table-column-filters.md`](implemented/table-column-filters.md) and [`table-column-filter-multi-condition.md`](implemented/table-column-filter-multi-condition.md).

---

## Architecture Decisions

### The gate is a keydown listener returning `{ prevent: true }`

A numeric column's filter inputs stay `<input type="text">`, matching the two numeric text inputs already in the tree — `NumberSpinner`'s inner field ([`NumberSpinner.ts:95-105`](../packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L95)) and `NumberEditor`'s ([`editor/Number.ts:23`](../packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts#L23)), neither of which uses `type="number"`.[^why-not-native-number] What this plan adds on top is a keydown listener that refuses a disallowed character before the browser inserts it.

The refusal is expressed as a returned disposition, `{ prevent: true }`, never a direct `preventDefault()` call: that is the documented protocol for every listener routed through the `Event` dispatcher ([ARCHITECTURE.md:15](../ARCHITECTURE.md)), and `TextInput`'s own `on("keydown")` overload is already typed to return one ([`TextInput.ts:202`](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L202)). The nearest keydown-that-cancels precedent, `NumberSpinner.onKeyDown` ([`NumberSpinner.ts:435-453`](../packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L435)), predates that protocol and calls `preventDefault()` directly; this plan follows the protocol, not that call style.[^why-keystroke-not-blur]

### The allowed set is fixed: digits, `-`, and `.`

The gate decides from the pressed key alone. It holds no opinion about where in the text the character would land, and never reads the field's current value. A stricter rule — one that also refused a *second* `-` or `.` — would have to know where the caret and the selection are, which the DOM seam does not report, so it is not the rule this plan builds.[^why-stateless-gate]

A key is allowed when it is not a single character (every editing and navigation key — `Backspace`, `Delete`, `Tab`, `Enter`, `Escape`, the arrows, `Home`, `End`, `F5` — reports a multi-character `KeyboardEvent.key`), or when it is one of `0`-`9`, `-`, `.`. Any modifier held (`Ctrl`, `Meta`, `Alt`) makes the keystroke a shortcut rather than typing, and passes through untouched.

| Column | Key | Modifier | Disposition | Why |
| --- | --- | --- | --- | --- |
| `number` | `5` | — | allowed | digit |
| `number` | `-` | — | allowed | in the set, wherever it lands |
| `number` | `.` | — | allowed | in the set, wherever it lands |
| `number` | `a` | — | `{ prevent: true }` | single character, not in the set |
| `number` | ` ` (space) | — | `{ prevent: true }` | single character, not in the set |
| `number` | `Backspace` | — | allowed | multi-character key name |
| `number` | `v` | `Ctrl` | allowed | modifier held — a shortcut, not typing |
| `string` | `a` | — | allowed | column is not numeric |

### `FilterCell` learns it is numeric through one boolean

`FilterCell` gains `setNumericOnly(numeric: boolean)` and a `_numericOnly` field defaulting to `false`. The header calls it on every rendered filter cell on every reconcile, in the same pass that already re-applies `setFieldName` / `setColumnLabel` / `setOperators` / `setFilterState` ([`Header.ts:1211-1226`](../packages/lib/src/typescript/lib/component/table/Header.ts#L1211)).

Setter only, no constructor parameter — mirroring `setColumnLabel` ([`Filter.ts:282`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L282)), the other per-column signal the header supplies after construction.[^why-boolean-not-fieldtype]

The setter writes nothing but the field. Because the gate consults `_numericOnly` at keydown time, a recycled cell cannot carry a stale restriction, and no DOM attribute has to be undone when a cell moves from a `number` column to a `string` one.

### The numeric decision lives in `ColumnFilter.ts`, beside the combo branch

`columnFilterTakesNumericOperand(target)` returns `true` for a `number` column that is **not** a combo column. A combo column matches the typed text against its option *labels* ([`ColumnFilter.ts:404-408`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L404)), which are text no matter what the underlying field's type is, so a numeric combo column must keep accepting letters.

| `ColumnFilterTarget` | Result | Why |
| --- | --- | --- |
| `{ type: 'number' }` | `true` | operand is parsed with `Number()` |
| `{ type: 'number', values: ['Low', 'High'] }` | `false` | combo column — the operand matches labels |
| `{ type: 'number', values: [] }` | `true` | an empty array is not a combo column |
| `{ type: 'string' }` / `'date'` / `'boolean'` / … | `false` | operand is not numeric |

The combo test itself is extracted to a module-private `isComboTarget(target)` that both `buildClauseFilter` and `columnFilterTakesNumericOperand` call, so the two can never disagree about what a combo column is.[^why-extract-combo-test] This mirrors `isClauseEffective`, extracted for exactly that reason one round earlier ([`ColumnFilter.ts:177-179`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L177)).

Both new functions are `@internal` and stay off the `component/table/index.ts` barrel.[^why-internal]

### Both text inputs share one guard method

`FilterCell.numericKeyDisposition(e)` is the whole gate. The inline input reaches it through the existing `onInputKeyDown`, which calls it before its `Enter` / `Escape` handling; each popover clause row wires it directly as its own keydown listener in `buildClauseRow`. One method, so the inline input and a popover row can never enforce different rules.

---

## Public API

```typescript
// component/table/cell/Filter.ts — new public method on the exported FilterCell

/**
 * Restricts this cell's filter inputs to characters that can appear in a
 * number, or lifts that restriction.
 */
setNumericOnly(numeric: boolean): this;
```

Backing field: `private _numericOnly: boolean = false;` — a plain initializer, not `declare`, since no options-cascade setter writes it (matching `_operators` at [`Filter.ts:76`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L76)). There is no matching options field: `FilterCell` takes no options bag. The constructor signature `(fieldName, operators)` is unchanged.

```typescript
// component/table/ColumnFilter.ts — both @internal, neither added to any barrel

/**
 * Whether a column's filter operand has to be a number.
 * @internal
 */
export function columnFilterTakesNumericOperand(target: ColumnFilterTarget): boolean;

/**
 * Whether a `KeyboardEvent.key` may be typed into a numeric filter input.
 * @internal
 */
export function columnFilterAcceptsNumericKey(key: string): boolean;
```

`ColumnFilterOperator`, `ColumnFilterClause`, `ColumnFilterState`, `ColumnFilterTarget`, `buildColumnFilter`, `parseOperand`, `FilterCellRenderer`, and every `FilterDescriptor` shape are unchanged. No descriptor gains a member; the data layer is untouched.

---

## Internal Structure

### `ColumnFilter.ts`

```typescript
/** The characters a numeric filter operand can be built from. */
const NUMERIC_FILTER_KEY = /^[0-9.-]$/;

/**
 * Whether `target` declares a combo column — one whose filter text is matched
 * against option labels rather than the stored value. The single rule behind
 * both `buildClauseFilter`'s combo routing and
 * `columnFilterTakesNumericOperand`, so the two can never drift apart.
 */
function isComboTarget(target: ColumnFilterTarget): boolean {
    return target.values !== undefined && target.values.length > 0;
}

export function columnFilterTakesNumericOperand(target: ColumnFilterTarget): boolean {
    return target.type === 'number' && !isComboTarget(target);
}

export function columnFilterAcceptsNumericKey(key: string): boolean {
    return key.length !== 1 || NUMERIC_FILTER_KEY.test(key);
}
```

`buildClauseFilter`'s combo branch ([`ColumnFilter.ts:404-408`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts#L404)) swaps its inline test for the helper; the operator list in that same condition, and every other branch, stay exactly as they are:

```typescript
if (isComboTarget(target)
    && (operator === 'contains' || operator === 'startsWith' || operator === 'endsWith'
     || operator === 'eq' || operator === 'neq')) {
    return buildComboFilter(field, target.values!, operator, text, display);
}
```

The `!` on `target.values` is needed because `isComboTarget` is a plain predicate, not a type guard; `buildComboFilter`'s signature is unchanged.

### `cell/Filter.ts`

```typescript
/**
 * The keydown disposition for this cell's filter inputs. Returns
 * `{ prevent: true }` for a keystroke that would type a character a number
 * cannot contain into a numeric column's field, and `false` for everything
 * else — every key on a non-numeric column, every editing and navigation key
 * (whose `key` is a multi-character name), and every keystroke with a
 * modifier held, which is a shortcut rather than typing.
 *
 * @param e - The keydown event.
 * @returns `{ prevent: true }` to refuse the keystroke, `false` to allow it.
 */
private numericKeyDisposition(e: KeyboardEvent): Event.ListenerResult {
    if (!this._numericOnly || e.ctrlKey || e.metaKey || e.altKey) {
        return false;
    }

    return columnFilterAcceptsNumericKey(e.key) ? false : { prevent: true };
}
```

`onInputKeyDown` ([`Filter.ts:369-378`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L369)) keeps its `Enter` / `Escape` bodies verbatim and gains the gate in front, returning `Event.ListenerResult` instead of `void`:

```typescript
private onInputKeyDown(e: KeyboardEvent): Event.ListenerResult {
    const refusal = this.numericKeyDisposition(e);

    if (refusal) {
        return refusal;
    }

    if (e.key === "Enter") {
        // …unchanged…
    } else if (e.key === "Escape") {
        // …unchanged…
    }

    return false;
}
```

`buildClauseRow` ([`Filter.ts:528-532`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L528)) gains one line beside the row field's existing `"change"` wiring:

```typescript
field.on("keydown", (e: KeyboardEvent) => this.numericKeyDisposition(e));
```

### `Header.ts`

Pass 3 of `reconcileFilterCells` ([`Header.ts:1211-1226`](../packages/lib/src/typescript/lib/component/table/Header.ts#L1211)) gains one resolve and one call, immediately after `cell.setOperators(operators)`:

```typescript
const target = this.filterTarget(field.getName());

cell.setNumericOnly(target !== null && columnFilterTakesNumericOperand(target));
```

`filterTarget` ([`Header.ts:1023-1033`](../packages/lib/src/typescript/lib/component/table/Header.ts#L1023)) is reused rather than re-deriving the type and config inline, so one method stays responsible for resolving what a column's filter is aimed at. It returns `null` only for a field the bound model does not know, which cannot happen for a field taken from `_visibleFields`; the explicit `!== null` satisfies the type and costs nothing.

---

## Ordered Implementation Steps

1. **`packages/lib/tests/component/table/ColumnFilter.test.ts`** — add two `describe` blocks, `columnFilterTakesNumericOperand` and `columnFilterAcceptsNumericKey`, covering cases 1-11 of `## Expected Behaviour`. They fail to compile until step 2.
2. **`packages/lib/src/typescript/lib/component/table/ColumnFilter.ts`** — add `NUMERIC_FILTER_KEY`, `isComboTarget`, `columnFilterTakesNumericOperand`, and `columnFilterAcceptsNumericKey` per `## Internal Structure`, each with full JSDoc (`@param` / `@returns`), and the two exported ones marked `@internal`. Place them after `effectiveClauseCount` and before `parseTimeOfDay`, so the predicate group stays together.
3. **`ColumnFilter.ts`** — rewrite `buildClauseFilter`'s combo branch to call `isComboTarget`. No other branch changes.
4. Regression check: `grep -n "values.length > 0" packages/lib/src/typescript/lib/component/table/ColumnFilter.ts` — expect exactly one match, inside `isComboTarget`.
5. Run `npm run test` from `packages/lib` — cases 1-11 pass, and every pre-existing `ColumnFilter.test.ts` combo case still passes (the guard that step 3 did not change combo routing).
6. **`packages/lib/tests/component/table/ColumnFilterRow.test.ts`** — add `import { Event } from '~/core/Event';` (case 22 spies on it) and cases 12-22 of `## Expected Behaviour`, extending the file's existing helper style: `pressKey` gains an optional third argument so a test can pass modifiers and read the returned disposition (`function pressKey(cell, key, extra = {}) { return (cell as any).onInputKeyDown({ key, ...extra }); }` — every existing call site keeps working unchanged, since the extra argument defaults and the return value was previously ignored). These cases fail until step 10.
7. **`packages/lib/src/typescript/lib/component/table/cell/Filter.ts`** — add `_numericOnly`, the public `setNumericOnly` setter (documented, chainable, `@returns This cell, for method chaining.` like its neighbours), and the private `numericKeyDisposition` per `## Internal Structure`. Extend the existing `~/component/table/ColumnFilter.js` import block ([`Filter.ts:6-12`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L6)) with `columnFilterAcceptsNumericKey`, and add `import { Event } from "~/core/Event.js";` for the `Event.ListenerResult` return type.
8. **`cell/Filter.ts`** — change `onInputKeyDown`'s return type to `Event.ListenerResult`, add the gate in front of its `Enter` / `Escape` handling, and end it with `return false;`. Update its JSDoc to state that a refused keystroke returns `{ prevent: true }` and never reaches the `Enter` / `Escape` handling.
9. **`cell/Filter.ts`** — wire the row field's keydown in `buildClauseRow`, one line after the existing `field.on("change", …)`.
10. **`packages/lib/src/typescript/lib/component/table/Header.ts`** — add `columnFilterTakesNumericOperand` to the existing `~/component/table/ColumnFilter.js` import ([`Header.ts:18`](../packages/lib/src/typescript/lib/component/table/Header.ts#L18)) and add the two lines to pass 3 per `## Internal Structure`.
11. Run `npm run test` from `packages/lib` — cases 12-22 pass, and every pre-existing `ColumnFilterRow.test.ts` case still passes (the guard that step 6's helper change and step 8's rewrite left `Enter` / `Escape` alone).
12. Regression check: `grep -n "setType" packages/lib/src/typescript/lib/component/table/cell/Filter.ts packages/lib/src/typescript/lib/component/table/cell/renderer/Filter.ts` — expect zero matches, confirming neither filter input was switched to a native `type="number"`.
13. **Docs** — apply the edits in `## Documentation Impact`.
14. From `packages/lib`, run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run docs:api`.
15. Manual verification — exercise case 23.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/component/table/ColumnFilter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Filter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/tests/component/table/ColumnFilter.test.ts` |
| Modify | `packages/lib/tests/component/table/ColumnFilterRow.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No file is created or deleted. `component/table/cell/renderer/Filter.ts`, `component/table/index.ts`, `component/input/TextField.ts`, `component/input/TextInput.ts`, `core/DOM.ts`, `core/Event.ts`, and every `data/` module are untouched.

---

## Expected Behaviour

Cases 1-22 are unit-testable; case 23 needs a browser.

### `columnFilterTakesNumericOperand` (`ColumnFilter.test.ts`)

1. `{ type: 'number' }` → `true`.
2. `{ type: 'string' }`, `{ type: 'auto' }`, `{ type: 'glyph' }`, `{ type: 'boolean' }`, `{ type: 'date' }`, `{ type: 'time' }`, `{ type: 'datetime' }` → `false` for every one.
3. `{ type: 'number', values: ['Low', 'High'] }` → `false`.
4. `{ type: 'number', values: [] }` → `true` — an empty array is not a combo column, matching what `buildClauseFilter` has always tested.
5. `{ type: 'string', values: ['Low', 'High'] }` → `false`.

### `columnFilterAcceptsNumericKey` (`ColumnFilter.test.ts`)

6. Every one of `'0'`…`'9'` → `true`.
7. `'-'` and `'.'` → `true`.
8. `'a'`, `'A'`, `'e'`, `'+'`, `','`, `'/'`, and `' '` → `false`.
9. `'Backspace'`, `'Delete'`, `'Tab'`, `'Enter'`, `'Escape'`, `'ArrowLeft'`, `'ArrowRight'`, `'Home'`, `'End'`, `'Shift'`, `'Control'`, `'F5'` → `true` for every one.
10. `'Unidentified'` and `'Process'` (what a key reports mid-IME-composition) → `true`.
11. `''` → `true` — the rule is "not exactly one character", so a key that reports no character is never refused.

### The filter cell's gate (`ColumnFilterRow.test.ts`)

The file's existing `MODEL` already carries what these need: `age` is a `number` field and `name` a `string` one. Each case reads the disposition `onInputKeyDown` returns. Cases 12-19 and 21 take their cells from a real `makeTable` render with the filter row shown, so they also cover the header's own wiring — nothing calls `setNumericOnly` by hand except case 20.

12. On the `age` cell, `{ key: 'a' }` returns `{ prevent: true }`.
13. On the `age` cell, `{ key: '5' }`, `{ key: '-' }`, and `{ key: '.' }` each return `false`.
14. On the `age` cell, `{ key: '-' }` still returns `false` after `typeInto(cell, '-1')` — the gate is stateless, and a second `-` is not the thing it refuses.
15. On the `age` cell, `{ key: 'Backspace' }` and `{ key: 'ArrowLeft' }` return `false`.
16. On the `age` cell, `{ key: 'v', ctrlKey: true }` and `{ key: 'a', metaKey: true }` return `false` — copy / paste / select-all shortcuts are never refused.
17. A refused keystroke changes nothing else: after `{ key: 'a' }` on the `age` cell, `cell.getFilterState()` is unchanged and no `"filterchange"` listener fired.
18. `Enter` and `Escape` still work on a numeric column: `typeInto(ageCell, '30')` then `pressKey(ageCell, 'Enter')` applies the filter immediately, and `pressKey(ageCell, 'Escape')` clears the text and applies immediately — both unchanged from today.
19. On the `name` cell, `{ key: 'a' }` returns `false` — a `string` column's filter input still takes arbitrary text, and its existing `contains` filtering is unaffected.
20. The flag is live, so a recycle can always re-supply it: on any cell, `setNumericOnly(true)` then `setNumericOnly(false)` leaves `{ key: 'a' }` returning `false`, and the reverse order leaves it returning `{ prevent: true }`.
21. A combo column over the numeric field — `makeTable({ columns: [{ field: 'age', values: ['30', '25'] }] })` — leaves `{ key: 'a' }` returning `false` on the `age` cell, so a label can still be typed.
22. Each popover clause row carries the same gate. After `addCondition(ageCell)`, the row's text field has a `"keydown"` listener registered, and invoking that registered listener with `{ key: 'a' }` returns `{ prevent: true }` and with `{ key: '5' }` returns `false`. Capture the registration with `vi.spyOn(Event, 'addListener')` around the `addCondition` call and match on the row field and the `'keydown'` type, following [`TextInput.test.ts:44`](../packages/lib/tests/component/input/TextInput.test.ts#L44)'s own spy idiom — the row field is `popoverRows(cell)[1].getComponents()[1]`, the same accessor `typeIntoRow` uses.

### Manual verification

23. From `packages/lib`, `npm run dev`, on a table with a `number` column and a `string` column. Reveal the filter row from the header context menu. In the `number` column's input, type `abc` — nothing appears. Type `-12.5` — it appears, and the table filters on Enter. Confirm `Backspace`, the arrow keys, `Home`/`End`, and `Ctrl`/`Cmd`+`A` all still work inside the field, and that the caret can be placed mid-text and typed into. Add a second condition from the operator menu and confirm the popover row's own field refuses `abc` the same way. Confirm the `string` column's input still accepts `abc`. Confirm that pasting `abc` into the numeric field still puts the text in (out of scope — see `## Non-Goals`) and simply builds no filter, as today.

---

## Verification

From `packages/lib`:

- `npm run typecheck` — zero errors. `onInputKeyDown`'s widened return type is where a missed call site would surface.
- `npm run lint` — zero errors, including `local/no-raw-dom`: the gate reads `KeyboardEvent` fields only and touches no element.
- `npm run test` — the two edited test files plus the full existing suite unchanged. `ColumnFilter.test.ts`'s pre-existing combo cases are the regression guard for step 3, and `ColumnFilterRow.test.ts`'s pre-existing `pressKey` cases for step 6's helper change.
- `npm run docs:api` — zero warnings. `FilterCell.setNumericOnly` is a new public documented method; its JSDoc must describe the allowed characters in prose rather than `{@link}`ing either `@internal` helper, per [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md).
- `grep -n "values.length > 0" packages/lib/src/typescript/lib/component/table/ColumnFilter.ts` — exactly one match (step 4).
- `grep -n "setType" packages/lib/src/typescript/lib/component/table/cell/Filter.ts packages/lib/src/typescript/lib/component/table/cell/renderer/Filter.ts` — zero matches (step 12).
- Manual: case 23.

---

## Documentation Impact

- **`packages/lib/docs/components/Table.md`** — in `## Column filters`, add one bullet after the existing "**A [combo column](#combo-columns) filters on its label**" bullet ([`Table.md:250`](../packages/lib/docs/components/Table.md#L250)): a `number` column's filter input accepts only the characters a number is built from — digits, `-`, and `.` — and refuses anything else as it is typed, in the inline input and in every extra condition's field alike. Note the two carve-outs plainly: a combo column declared over a numeric field is not restricted, because it filters on its labels; and pasted text is not filtered, so pasting something unparseable leaves it in the field and applies no filter, as before.
- **`packages/lib/docs/reference/changelog/next.md`** — one entry under `## Changed` → `### Table`, in that section's bold-lead-sentence style: a `number` column's header filter input now refuses non-numeric characters as they are typed instead of accepting them and silently applying no filter. Close with "No consumer action is needed."
- **Barrels** — none. `columnFilterTakesNumericOperand` and `columnFilterAcceptsNumericKey` are `@internal` and stay off `component/table/index.ts`.
- **No `llms.txt` edit** — the capability index never mentions column filters, and both earlier filter plans made the same call.
- **No version bump** — handled separately at release time.

---

## Potential Challenges

- **`ColumnFilter.ts` is edited by the concurrently-drafted [`date-column-filter-string-operators.md`](date-column-filter-string-operators.md).** That plan rewrites `buildClauseFilter`'s substring branch and the `columnFilterOperators` switch; this one rewrites the combo branch's condition and appends new functions. Different hunks, so whichever lands second merges cleanly, but the file is declared in both plans' `touches-shared` so they are not implemented at the same time. *Mitigation:* neither plan touches `cell/Filter.ts` or `cell/renderer/Filter.ts` (confirmed against that plan's own files table), so the merge risk is contained to `ColumnFilter.ts`; if the second implementation hits a conflict, keep both edits — they are independent.
- **A locale whose decimal separator is `,`.** The gate refuses `,`, so a user on such a keyboard cannot type `1,5`. *Mitigation:* none needed — `Number('1,5')` is `NaN`, so that text never built a filter anyway; the gate makes the existing limit visible instead of silent.
- **Sequences that pass the gate but still do not parse.** `1-2` and `1.2.3` are typeable character by character. *Mitigation:* none needed — each still builds no filter, exactly as today, and refusing them needs the caret position the DOM seam does not expose (see `## Architecture Decisions`).
- **The gate's effect cannot be asserted end-to-end in the offline harness.** The tests assert the returned disposition, not that the browser skipped the insertion; the harness has no real `<input>` and its window-level keydown dispatch is unreliable after the first test in a process (documented at the top of `ColumnFilterRow.test.ts`). *Mitigation:* the dispatcher's own handling of `{ prevent: true }` is already covered by `tests/dom/events.test.ts`, and case 23 verifies the whole path in a browser.
- **A cell recycled onto a numeric column while its clauses popover is open.** `setFieldName` already hides the popover when the incoming field name differs, and the rows are rebuilt from scratch on the next open, so no row can outlive the flag that governs it. *Mitigation:* none needed — confirm by reading `setFieldName` before editing.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/cell/Filter.ts`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts) — the cell being changed: `onInputKeyDown`, `buildClauseRow`, and the `setOperators` / `setColumnLabel` setters the new one is modelled on.
- [`packages/lib/src/typescript/lib/component/table/ColumnFilter.ts`](../packages/lib/src/typescript/lib/component/table/ColumnFilter.ts) — `parseOperand`'s `number` case (the silent-null path being fixed), the combo branch, and `isClauseEffective`, the precedent for extracting a shared predicate so two callers cannot drift.
- [`packages/lib/src/typescript/lib/component/table/Header.ts`](../packages/lib/src/typescript/lib/component/table/Header.ts) — `filterTarget` and `reconcileFilterCells`' three passes; read pass 3 before editing so the new call lands with the other per-column re-applications.
- [`packages/lib/src/typescript/lib/component/input/NumberSpinner.ts`](../packages/lib/src/typescript/lib/component/input/NumberSpinner.ts) and [`cell/editor/Number.ts`](../packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts) — the two numeric text inputs already in the tree; both keep `type="text"` and validate afterwards, which is the precedent this plan follows for the input type and departs from for the keystroke gate.
- [`packages/lib/src/typescript/lib/component/input/TextInput.ts`](../packages/lib/src/typescript/lib/component/input/TextInput.ts) — the `on("keydown")` overload's `Event.ListenerResult` return type, and `setType`, whose use is being declined here.
- [`packages/lib/src/typescript/lib/component/table/cell/renderer/Filter.ts`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Filter.ts) — read-only: `getInput()`, the inline field the gate attaches to, and `setMenuOpenPredicate`, the `@internal` off-barrel precedent the two new `ColumnFilter.ts` functions follow.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — the listener-disposition protocol (event handling) and the cell-editor carve-out that rules out listening on another component's element.
- [`packages/lib/tests/component/table/ColumnFilterRow.test.ts`](../packages/lib/tests/component/table/ColumnFilterRow.test.ts) — the harness, the `pressKey` / `popoverRows` / `typeIntoRow` helpers, and the header comment explaining why private methods are invoked instead of dispatching real DOM events.
- [`plans/implemented/table-column-filters.md`](implemented/table-column-filters.md) and [`plans/implemented/table-column-filter-multi-condition.md`](implemented/table-column-filter-multi-condition.md) — the filter row's original design and its clause-list extension, both inherited unchanged.

---

## Non-Goals

- **Filtering pasted text.** A paste never fires `keydown`, and reaching it needs a `"paste"` event surface `TextInput` does not expose — which ARCHITECTURE.md rules out adding here twice over: listening on another component's element is forbidden outside the cell-editor carve-out, and widening `TextField`'s DOM shorthands is deferred to a separate in-flight plan that owns the input components. Pasted text keeps today's behaviour: it stays in the field and builds no filter.
- **Rejecting a second `-` or `.`.** See `## Architecture Decisions` — the gate is per character, and text like `1-2` remains typeable and remains filter-less.
- **Accepting scientific notation or a leading `+`.** `Number('1e5')` and `Number('+5')` parse today, and after this change neither is typeable into a numeric filter. Keeping the alphabet to digits, `-`, and `.` is what makes the rule legible; nobody filters a column with `1e5`.
- **Restricting a `date` / `time` / `datetime` column's input.** Those columns take typed dates and times whose accepted shapes include letters (`09:30 AM`), and a concurrent plan is adding substring operators to them.
- **Restricting a `boolean` column's input.** Its operands are the words `true` / `false` / `yes` / `no`.
- **Setting `inputMode="decimal"` on the numeric input.** It would bring up a numeric on-screen keyboard on touch devices, but it is a DOM attribute that would then have to be cleared on every recycle onto a non-numeric column — state the gate deliberately avoids — and no one asked for it.
- **Validating or correcting the field on blur.** That is `NumberSpinner`'s model, and it needs a last-known-good value to revert to; a filter input has none.
- **Any change to `parseOperand`, `buildClauseFilter`'s output, or the store-side descriptors.** Text that reaches the parser is parsed exactly as it is today.
- **A general `allowedCharacters` capability on `TextField` / `TextInput`.** One consumer, one column type; a shared input-level option would be speculative surface on a component another plan already owns.

---

## Notes

[^why-not-native-number]: `<input type="number">` was the obvious first candidate — `TextInput.setType` exists ([`TextInput.ts:257`](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L257)) and it would be a one-line change — and it fails on its own terms. It does not actually prevent the keystrokes: browsers accept `e`, `+`, and `-` in a number input, so the reported "letters do nothing" case is only partly addressed. Worse, HTML's value-sanitization rule makes the element's `value` property return the empty string whenever its content is not a valid floating-point number, so `TextInput.onInput`'s `DOM.source.getValue(element)` would read `""` while the user is looking at `12e`, silently desynchronising `_clauses[0].text` from what is on screen and clearing the column's filter mid-typing. It also adds spin buttons and wheel-to-change inside a header cell, and it would have to be written and unwritten on every recycle. The two numeric inputs already in this codebase both decline it: `NumberSpinner` builds its inner field as plain text and reverts on blur, and `NumberEditor` caches `Number(raw)` on input and commits `null` when it does not parse.

[^why-keystroke-not-blur]: Following `NumberSpinner`'s and `NumberEditor`'s validate-afterwards model literally would mean reverting the field's text once the user leaves it — and that is precisely the reported defect in a different costume. Both of those controls own a numeric value and can revert to the last good one, which is visible feedback: the number snaps back. A filter input owns no value to revert to; its only failure signal today is that the table does not change, which is the silence the live-testing round complained about. The requirement here is to stop the character arriving, not to recover from it, so the gate has to run before the insertion. A third option — letting the character land and rewriting the field on the `input` event — was rejected because rewriting the value moves the caret to the end, breaking mid-text editing on every refused keystroke.

[^why-stateless-gate]: A stricter rule — allow `-` only when the text holds no `-`, and `.` only when it holds no `.` — was drafted and dropped. To be correct it needs the caret and selection range, because a keystroke replaces the selection: with the whole field selected, typing `-` over `-12` is legitimate even though the old text holds a `-`. `DOM.source` exposes no selection read (`setSelectionRange` exists on the sink at [`DOM.ts:640`](../packages/lib/src/typescript/lib/core/DOM.ts#L640), with no counterpart on the source), so the rule would have to guess — and guessing wrong refuses a legitimate leading minus in the ordinary select-all-and-retype flow, turning `-5` into `5`. Adding a selection read to the DOM seam for a header-cell polish item is not proportionate. The per-character rule needs no caret, no field read, and no selection: it refuses every character that can never appear in a number, which is what was asked for, and leaves the rare `1-2` typo on the existing no-filter-built path.

[^why-boolean-not-fieldtype]: Threading the column's `FieldType` into `FilterCell` instead was the alternative, and it puts the decision in the wrong place: "is this filter numeric" is not a property of the field's type alone, because a combo column declared over a numeric field matches option labels and must keep accepting letters. `FilterCell` would then also need the column's `values`, which is `ColumnConfig` state it deliberately knows nothing about. Passing one already-decided boolean keeps the same seam the cell already uses for `operators` — a per-column decision computed in `TableHeader`, where the field and the column config are both in hand, and re-supplied on every recycle. A constructor parameter was declined for the same reason `setColumnLabel` is not one: the header's pass 3 re-applies every per-column signal to new and recycled cells alike in one synchronous pass, so a constructor argument would be written once and immediately overwritten, at the cost of changing an exported class's construction signature.

[^why-extract-combo-test]: CLAUDE.md's surgical-changes rule argues for leaving `buildClauseFilter` alone and repeating `target.values && target.values.length > 0` in the new predicate. The duplicate is rejected because a drift between the two copies is silent and wrong in a specific way: if `buildClauseFilter` ever widened what counts as a combo column and the predicate did not, a combo column over a numeric field would start refusing the letters of its own labels, with no error anywhere. This is the same argument `isClauseEffective`'s JSDoc already makes for its own extraction ("the single rule behind both … so a caller … can never drift out of sync"), and the extraction is bounded to one condition in one branch; no other branch of `buildClauseFilter` is touched.

[^why-internal]: Every function `ColumnFilter.ts` exports today is also re-exported from `component/table/index.ts`, so keeping two off it is a deliberate exception. Neither is useful to a consumer: `columnFilterTakesNumericOperand` answers a question only the header's reconciler asks, and `columnFilterAcceptsNumericKey` is meaningless outside a keydown handler the library owns. The precedent for an `@internal`, off-barrel member in this very feature is `FilterCellRenderer.setMenuOpenPredicate` ([`renderer/Filter.ts:100-116`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Filter.ts#L100)), added one round earlier for framework wiring between the cell and its own renderer. Keeping them off the barrel also keeps `component/table/index.ts` — a file two other in-flight plans declare as shared — out of this plan's file list.
