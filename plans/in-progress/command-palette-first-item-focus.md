---
touches-shared:
  - packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts
---

# List Keyboard Entry From An Unfocused Row — Implementation Plan

## Overview

A list can hold items while no row holds the keyboard-focus mark: `_focusedIndex` is `-1`
after [`setItemsArray`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1217)
replaces the item array, after `setSelectedIndex(-1)` clears the selection, and after
`applyEnabled(false)` parks it on a disabled list. From that state the first `ArrowDown`
lands on row **1**, skipping the first row entirely:
[`handleNavigationKey`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1925)
substitutes `0` for the missing focus position and then adds one to it. Every list-backed
surface in the library reaches that state — [`AutoCompleteDropdown.show`](packages/lib/src/typescript/lib/component/input/AutoCompleteDropdown.ts#L156)
re-sets the item array on every open, and [`ComboBoxDropdown.showAt`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L243)
passes `-1` whenever the ComboBox has no selection.

This plan fixes that off-by-one and adds a public `setFocusedIndex`, so a host that wants a
row highlighted before the user touches the keyboard can say so. The library itself keeps
seeding no focus: `setItemsArray` still resets to `-1`, and `Enter` with nothing focused
still does nothing.[^host-owns-seeding]

Both behaviour changes are in
[`AbstractSelectableList.ts`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts);
`List` and `MultiSelectList` inherit them unchanged. This is the library half of a defect
reported against Loom's command palette — hence the file name; Loom's own plan
(`plans/command-palette-first-item-focus.md` in the Loom repo) calls the new setter and
must be implemented after this one ships and `npm run build:lib` has run.[^cross-repo]

---

## Architecture Decisions

### The first navigation key enters the list rather than stepping through it

When `_focusedIndex` is `-1`, a navigation key moves focus *into* the list instead of
stepping away from a pretend row 0. `End` still means "the last row"; every other
navigation key lands on row 0. The landing row per key is tabulated in
[`## Expected Behaviour`](#expected-behaviour).[^nav-entry]

### Seeding the initial highlight stays the host's decision

`setItemsArray` keeps resetting focus to `-1`, and `commitFocusedRow` keeps returning early
when nothing is focused. Neither is changed here.[^host-owns-seeding]

### `setFocusedIndex` is the write side of the already-public `getFocusedIndex`

`getFocusedIndex` is public; nothing exposes the write side. The new setter sits directly
after the getter, mirroring the
`getSelectedIndex` / [`setSelectedIndex`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1398)
adjacency two hundred lines above. Its body is the focus-move block that
[`handleTypeAhead`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2028)
already runs, so `handleTypeAhead` is rewired to call it rather than keep a second
copy.[^type-ahead-reuse]

### No `focusedIndex` construction option

`_focusedIndex` is transient keyboard state that `setItemsArray` wipes on every item
replacement, so there is no options-bag field, no `applyOptions` dispatch, and no
`declare` field to add.[^no-option]

---

## Public API

One new public method on `AbstractSelectableList`, inherited by `List` and
`MultiSelectList`:

```typescript
class AbstractSelectableList<TValue, TOptions extends AbstractSelectableListOptions> {
    /** Existing — unchanged. */
    getFocusedIndex(): number

    /** New. */
    setFocusedIndex(idx: number): this
}
```

- **Backing field:** the existing `protected _focusedIndex: number` (line 741). No new field.
- **Options / config field:** none — see the decision above.
- **Widening:** none needed. The method is public on the abstract base, so both concrete
  subclasses expose it directly. (Contrast `setItemsArray`, which is `protected` on the base
  and re-declared public in [`List.ts:91`](packages/lib/src/typescript/lib/component/list/List.ts#L91)
  — that pattern does **not** apply here.)
- **Events:** none. `setFocusedIndex` is a programmatic write, so it fires neither `change`
  nor `action`, matching `setItemsArray` and `setSelectedIndex(idx, false)`.

---

## Internal Structure

`setFocusedIndex`, placed immediately after `getFocusedIndex`:

```typescript
setFocusedIndex(idx: number): this {
    this._focusedIndex = idx >= 0 && idx < this._items.length ? idx : -1;

    this.refreshRowVisualState();
    this.updateActiveDescendant();
    this.scrollIndexIntoView(this._focusedIndex);

    return this;
}
```

`scrollIndexIntoView` already returns early for a negative index (line 2045), so the
cleared case needs no extra guard.

The new branch at the top of `handleNavigationKey`, after the existing
`e.preventDefault()`:

```typescript
if (this._focusedIndex < 0) {
    this.moveFocus(e.key === "End" ? this._items.length - 1 : 0, ctrl, e.shiftKey);

    return true;
}
```

`this._items.length` is at least 1 here: both entry points — `handleKey` (line 1827) and
`handleKeyDown` (line 1872) — return before calling `handleNavigationKey` on an empty list,
and `MultiSelectList.handleKeyDown` delegates through `super.handleKeyDown`. No empty-list
guard is added.

The existing `const curr = this._focusedIndex < 0 ? 0 : this._focusedIndex;` becomes
`const curr = this._focusedIndex;` — the branch above has already handled the negative case.

---

## Ordered Implementation Steps

1. **Add `setFocusedIndex`** to
   `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`, immediately
   after `getFocusedIndex` (which ends at line 1788) and before `getFocusedRowId`. Use the
   body from `## Internal Structure`. Write a JSDoc block in the file's house style: one
   sentence on what it does, a note that the selection is untouched and no event fires, a
   note that an out-of-range index clears the focus mark, `@param idx`, `@returns This
   component, for method chaining.` Do **not** `{@link}` `refreshRowVisualState`,
   `scrollIndexIntoView`, `_focusedIndex`, or any other protected/private symbol — per
   `CODE_CONVENTIONS.md` the JSDoc of a documented symbol may only link symbols that appear
   in the public API docs; describe the behaviour in prose instead.

2. **Rewire `handleTypeAhead`** in the same file: replace its four-line tail (lines
   2028–2031: the `_focusedIndex` assignment, `refreshRowVisualState`,
   `updateActiveDescendant`, `scrollIndexIntoView`) with `this.setFocusedIndex(idx);`. Leave
   the `if (idx < 0) { return; }` guard above it and the comment explaining that type-ahead
   moves focus only. Behaviour is identical — `idx` comes from a `findIndex` over `_items`,
   so it is always in range when the guard passes.

3. **Add the unfocused-entry branch** to `handleNavigationKey` in the same file, using the
   snippet from `## Internal Structure`. Place it directly after the existing
   `e.preventDefault();` (line 1921) and before the `viewportH` / `pageSize` computation, so
   the page-size arithmetic is skipped on the entry path. Then simplify `curr` as described.
   Carry a short comment saying the key enters the list rather than stepping through it, and
   that `End` still means the last row.

4. **Check the whole file still reads consistently:**
   `grep -n '_focusedIndex' packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`
   — expect the assignment sites to be exactly: `applyEnabled` (line 924, parking focus
   when the list is disabled), `setItemsArray`, `setSelectedIndex` (two), `refreshFromStore`
   (two), `moveFocus`, and the new `setFocusedIndex`. `handleTypeAhead` must no longer
   assign it directly.

5. **Add tests** to `packages/lib/tests/component/list/List.test.ts`. Copy the one-line
   `KeyboardEvent` stub from `packages/lib/tests/component/input/ComboBox.test.ts:21-23`
   (`function key(name: string): KeyboardEvent { return { key: name, preventDefault() {},
   stopPropagation() {} } as unknown as KeyboardEvent; }`) into `List.test.ts` — that file
   has no such helper yet. No `installTestDOM` call is needed: the existing type-ahead tests
   in the same file already drive `refreshRowVisualState` / `updateActiveDescendant` /
   `scrollIndexIntoView` without one, and `fireChange` no-ops while the element is
   unrendered. Two new `describe` blocks, covering every row of both tables in
   `## Expected Behaviour`:
   - `'AbstractSelectableList (via List) — navigation from an unfocused list'` — drive
     `list.handleKey(key('ArrowDown'))` and siblings on `new _List({ items: FRUITS })`.
     Include one case with `setSelectFollowsFocus(false)` asserting the selection stays
     empty while focus moves.
   - `'AbstractSelectableList (via List) — setFocusedIndex'` — the clamping rows, plus one
     case asserting `getSelectedIndex()` is still `-1` and `getValue()` still `''` after
     `setFocusedIndex(2)`, and one asserting `getFocusedIndex()` is `-1` after
     `setFocusedIndex(0)` on `new _List({ items: [] })`.

6. **Confirm no existing test regresses.** The two tests that assert `getFocusedIndex()` is
   `-1` — `'setItems resets selection / anchor / focus'` (List.test.ts:187) and
   `'getFocusedIndex defaults to -1 before any navigation'` (List.test.ts:212) — must still
   pass unedited; if either fails, an edit strayed into `setItemsArray`, which this plan
   leaves alone. The ComboBox forwarding test (ComboBox.test.ts:224) starts from a selected
   row 0, so it is unaffected. Run `npm test` from `packages/lib`.

7. **Update the docs page** `packages/lib/docs/components/List.md`. In the `## Keyboard`
   section (lines 31–42), change the `ArrowUp` / `ArrowDown` table row to note the entry
   case, and add one sentence under the table naming
   [`setFocusedIndex`](/api/component/list/classes/List#setfocusedindex) as the way a host
   seeds the highlight before any keypress. Suggested wording:

   > | `ArrowUp` / `ArrowDown` | Move focus and selection by one row. With no row focused yet, the first press lands on the first row. |
   >
   > A host that drives the list from its own input surface — a search field filtering the
   > rows as you type — can highlight a row up front with
   > [`setFocusedIndex`](/api/component/list/classes/List#setfocusedindex), so `Enter`
   > commits it without an arrow keypress first. It moves the focus mark only: the selection
   > is untouched and no `change` event fires.

8. **Run the verification set** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/tests/component/list/List.test.ts` |
| Modify | `packages/lib/docs/components/List.md` |

---

## Expected Behaviour

Every case below is unit-testable in `packages/lib/tests/component/list/List.test.ts`. Two
library components also change *visibly* and get a manual eyeball on top of the unit tests —
see `## Verification`.

### Navigation from an unfocused list

`new _List({ items: FRUITS })` — the file's existing four-item fixture
(`['Apple', 'Banana', 'Cherry', 'Date']`), so `getFocusedIndex()` starts at `-1` and the
last row is index 3. Driven through the public `handleKey`; seed a non-`-1` starting position
with the new `setFocusedIndex`:

| Starting `getFocusedIndex()` | Key | Resulting `getFocusedIndex()` | Note |
|---|---|---|---|
| `-1` | `ArrowDown` | `0` | **the fix** — was `1` |
| `-1` | `PageDown` | `0` | **the fix** — was one page down |
| `-1` | `ArrowUp` | `0` | unchanged |
| `-1` | `Home` | `0` | unchanged |
| `-1` | `PageUp` | `0` | unchanged |
| `-1` | `End` | `3` | unchanged |
| `0` | `ArrowDown` | `1` | unchanged |
| `2` | `ArrowUp` | `1` | unchanged |
| `3` | `ArrowDown` | `3` | unchanged — clamped at the last row |

With the default `selectFollowsFocus`, each move also selects the landing row, so the first
`ArrowDown` from `-1` now yields `getValue() === 'Apple'` rather than `'Banana'`. With
`setSelectFollowsFocus(false)`, focus moves as tabulated and `getSelectedIndex()` stays
`-1`.

### `setFocusedIndex`

On the same four-item list:

| Call | `getFocusedIndex()` after |
|---|---|
| `setFocusedIndex(0)` | `0` |
| `setFocusedIndex(3)` | `3` |
| `setFocusedIndex(4)` | `-1` |
| `setFocusedIndex(-1)` | `-1` |
| `setFocusedIndex(0)` on `new _List({ items: [] })` | `-1` |

And in every case: `getSelectedIndex()` and `getValue()` are unchanged by the call, and no
`change` or `action` listener fires.

### Deliberately unchanged

- `setItemsArray` / `setItems` still reset focus to `-1`. `new _List({ items })` still
  reports `getFocusedIndex() === -1`.
- `Enter` / `Space` with `getFocusedIndex() === -1` still commits nothing and fires nothing;
  `handleKey` still returns `true` for those keys, so a host still gets its
  `preventDefault`.
- `handleKey` still returns `false` for every key on an empty list.
- `refreshFromStore` still parks focus at row 0 after a reload that drops the selected key
  (List.test.ts:306) — that path is untouched.

---

## Verification

From `packages/lib`:

- `npm run typecheck` — clean.
- `npm test` — the new cases pass, and no existing test in the list, ComboBox, or
  AutoCompleteField suites needs editing.
- `npm run lint` — no new findings against the baseline.
- `npm run docs:api` — must finish with **zero** warnings. A `{@link}` to a protected symbol
  in the new JSDoc is the likely cause if it does not.

Manual, in the library's own demo app — `npm run dev` from `packages/lib`, which serves it
from source, so no `build:lib` is needed first. Both widgets live on the **Misc** panel
(`src/typescript/MiscPanel.ts`: an `AutoCompleteField` at line 1459, `ComboBox`es from line
1761):

- **`AutoCompleteField`** — type enough to open the suggestion dropdown, then press
  `ArrowDown` once. The **first** suggestion takes the dashed focus mark (it used to be the
  second). Then reopen the dropdown and press `Enter` before any arrow key: nothing is
  committed and the typed text survives, exactly as before.
- **`ComboBox`** — open a ComboBox that has no selection yet and press `ArrowDown` once. The
  first option is selected (it used to be the second).

`npm run docs:llms` is **not** needed: the generated manifest carries each component's
class-level summary and curated seam entries, neither of which this change touches.

---

## Documentation Impact

- **Export surface:** unchanged. `AbstractSelectableList` is not re-exported from
  `packages/lib/src/typescript/lib/component/list/index.ts` — only its types are — so the
  new method reaches the public docs as an inherited member of the `List` and
  `MultiSelectList` pages that TypeDoc generates. That is the same route
  `setStore` and `setHorizontalScrolling` already take, which is why `List.md` links them as
  `/api/component/list/classes/List#setstore` and `#sethorizontalscrolling`. Link the new
  method the same way: `/api/component/list/classes/List#setfocusedindex`.
- **Hand-written page:** `packages/lib/docs/components/List.md` only (step 7).
  `docs/components/MultiSelectList.md` has no `## Keyboard` section and needs no edit.
- **No new page**, so no catalog or sidebar entry, and no `llms.txt` regeneration.
- **No renames or removals**, so there is no old name to sweep for.

---

## Potential Challenges

- **`{@link}` warnings from the new JSDoc.** The methods the new body calls are all
  protected, and linking one breaks `npm run docs:api`'s zero-warning requirement — describe
  the behaviour in prose instead of naming them.
- **`getHeight()` is `0` in the offline test harness**, so `pageSize` computes to 1 and
  `PageDown` behaves like `ArrowDown` for a list that already has focus. Only assert
  `PageDown` from the `-1` start (where the entry branch short-circuits before the page
  arithmetic); do not write a page-size test against a focused start.
- **A `List` whose host relies on "the first arrow key selects the second row"** would see a
  behaviour change. `grep -rn '_list.handleKey' packages/lib/src` finds exactly two hosts —
  `ComboBox.ts:225` and `AutoCompleteDropdown.ts:209` — and both are covered by the manual
  checks above. (`AbstractPickerField.ts:480` forwards into a calendar dropdown, not a
  list.)

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` | The only source file changed. Read `handleKey` (1822), `handleKeyDown` (1867), `handleNavigationKey` (1912), `moveFocus` (1963), `commitFocusedRow` (1988), `handleTypeAhead` (2007), `scrollIndexIntoView` (2044), and `setItemsArray` (1212) before editing. |
| `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` lines 1550–1556 | `refreshFromStore`'s focus-collapse-to-row-0 branch — the precedent showing the library already treats "row 0" as the resting focus position after an item rebuild, and the reason this plan leaves the store path alone. |
| `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` lines 1398–1418 | `setSelectedIndex` — the shape the new setter mirrors: clamp, write the field, refresh, return `this`, fire nothing. |
| `packages/lib/src/typescript/lib/component/input/AutoCompleteDropdown.ts` | Re-sets the item array on every open, so it is the library component the navigation fix visibly improves — and the one that would regress if `Enter` were made to commit row 0. |
| `packages/lib/src/typescript/lib/component/input/ComboBox.ts` lines 240–244 | `showAt` sets items then `setSelectedIndex(selectedIndex, false)`, which is why a ComboBox with no selection reaches the unfocused state. |
| `packages/lib/tests/component/list/List.test.ts` | Where the new tests go; lines 187 and 212 are the two `-1` assertions that must keep passing, line 306 the row-0 store precedent. |
| `packages/lib/docs/components/List.md` lines 31–42 | The `## Keyboard` section to amend. |
| `CODE_CONVENTIONS.md` | The `{@link}` restriction on public JSDoc that step 1 must respect. |

---

## Non-Goals

- **Auto-focusing row 0 when the item array is replaced.** Rejected — it would change every
  list constructed with `items` and would make `Enter` hijack an AutoCompleteField's typed
  text.[^host-owns-seeding]
- **Making `Enter` commit row 0 when nothing is focused.** Same reason.
- **Seeding focus when the list root receives DOM focus.** A separate WAI-ARIA gap, and no
  help to a host that keeps DOM focus on its own input, which is the reported case.
- **Reworking `moveFocus`, `reduceSelection`, `selectFollowsFocus`, or the type-ahead
  buffer.** Untouched beyond step 2's one-line reuse.
- **The unused `--ts-ui-list-row-focus-ring` theme token.** `.SelectableListRow.focused`
  draws from `--ts-ui-indicator-selection` instead (line 261) while `List.md` still
  advertises the former. Pre-existing and unrelated; left alone.

---

## Notes

[^nav-entry]: Today `handleNavigationKey` computes `const curr = this._focusedIndex < 0 ? 0 :
    this._focusedIndex;` and then applies the key's delta to `curr`. Substituting `0` for
    "no focus" makes the *downward* keys treat row 0 as already visited: `ArrowDown` yields
    `min(0 + 1, len - 1)` = row 1, `PageDown` yields a full page down. That is the whole of
    the reported "when I press down, the second item is selected". The upward and absolute
    keys happen to come out right by accident — `ArrowUp` clamps `0 - 1` back to `0`, `Home`
    is `0` outright, `End` is `len - 1` — so a fix that only re-based the delta would leave
    them as they are. Branching on the unfocused state up front says the rule once and keeps
    every already-focused case bit-identical, rather than threading a "have we entered yet"
    adjustment through six key branches.

[^host-owns-seeding]: Three ways to make `Enter` activate the first row were considered, and
    two are rejected here.
    **Rejected — collapse focus to row 0 inside `setItemsArray`** (which would mirror what
    `refreshFromStore` already does at line 1555). It breaks `AutoCompleteField`: that field
    keeps DOM focus on its own `TextField` and forwards `Enter` into the list
    (`AutoCompleteField.ts:531`), so a focused row 0 means pressing `Enter` on a
    half-typed word silently replaces it with the top suggestion instead of accepting what
    the user typed. It is also broadly cosmetic collateral — the constructor's late-built
    dispatch routes the `items` option through `setItems` (line 858), so *every* list built with items
    would paint a dashed focus outline on its first row before any interaction, and the two
    tests at List.test.ts:187 and :212 encode the current `-1` as contract.
    **Rejected — commit row 0 from `commitFocusedRow` when nothing is focused.** Same
    `AutoCompleteField` hijack, and it commits a row the user was never shown as active.
    **Chosen — expose the write side of `getFocusedIndex`.** Whether an unfocused list
    should treat `Enter` as "take the top row" is a property of the surface, not of lists in
    general: a command palette says yes, a free-text autocomplete says no. A host that wants
    it asks for it, and gets the highlight to match. `refreshFromStore` keeps its row-0
    collapse — it is reached only by a store reload, never by a keystroke-driven refilter,
    and changing it is not needed for this defect.

[^type-ahead-reuse]: `handleTypeAhead`'s tail is already exactly
    `_focusedIndex = idx; refreshRowVisualState(); updateActiveDescendant();
    scrollIndexIntoView(idx);` — the new setter's body, minus the clamp. Leaving both copies
    in the file would mean two places to keep in step for no benefit; the clamp is
    unreachable from `handleTypeAhead` because its `idx` is a `findIndex` result over
    `_items`, guarded against `-1` on the line above.

[^no-option]: `AbstractSelectableListOptions` gains nothing. The repo's `declare`-field rule
    in `CODE_CONVENTIONS.md` applies to fields a cascade-dispatched setter writes;
    `setFocusedIndex` is never dispatched during the cascade, and `_focusedIndex` keeps its
    existing `= -1` initializer. A `focusedIndex` option would also be immediately stale —
    `setItems`, dispatched from the constructor's late-built tail at line 858, resets the
    field — so it would have to be ordered after the item dispatch for no requested benefit.

[^cross-repo]: The two plans share a file name because they are two halves of one reported
    defect, but `depends-on` is deliberately left out of both. That key is resolved against
    the *same* repository's `plans/implemented/` directory, and the two files have identical
    stems, so `depends-on: [command-palette-first-item-focus]` would resolve to the plan
    declaring it. The ordering is stated in prose instead — here, and as a precondition step
    in Loom's plan. Nothing in this plan depends on Loom; it stands alone and can ship on its
    own.

---

## Implementation Notes

- **The entry branch routes through `nearestEnabledIndex`, not a bare `moveFocus(0)` /
  `moveFocus(len - 1)`.** This plan predates `list-row-enabled-state`, which landed on this
  branch's history first and added per-row `enabled` state, `isItemEnabled`, and the
  `nearestEnabledIndex` scan that every other key in `handleNavigationKey` already goes
  through before calling `moveFocus`. The `## Internal Structure` snippet's raw
  `this.moveFocus(e.key === "End" ? this._items.length - 1 : 0, ctrl, e.shiftKey)` would have
  landed the entry keys on a disabled row 0 (or a disabled last row, for `End`) instead of
  skipping it — reintroducing exactly the kind of gap `nearestEnabledIndex` exists to close.
  The implemented branch instead computes `direction`/`target` the same way the rest of the
  function does and shares its `target < 0` ("every row disabled") guard, so entering the list
  is subject to the identical disabled-row rule as every other navigation key. Covered by
  `List.test.ts`'s `'entering the list with ArrowDown skips a disabled row 0'` case, which the
  plan's own snippet would have failed. `setFocusedIndex` itself is unaffected — it mirrors
  `setSelectedIndex`, which has never checked `isItemEnabled`, so it keeps that same
  no-enabled-check contract.

- **The `## Verification` section's ComboBox manual check could not be exercised as written.**
  Every `ComboBox` currently wired into the library's demo app (`MiscPanel.ts`) — including the
  `Popover + ComboBox (nested)` demo built from a plain `items` array with no `value` or
  `selectedIndex` — resolves to a real selection before any keypress, because
  `ComboBox.autoSelectFirstIfEmpty` (`ComboBox.ts:1346`) selects row 0 whenever the inner list's
  selection is still `-1` after items are set; it runs from `applyOptions`, `setItems`, and
  `setStore`, so a freshly constructed `items`-based `ComboBox` never sits in the unfocused
  state this plan's fix is about — there is no demo wiring today that reaches it live. The
  `AutoCompleteField` demo (which has no such auto-select) was used instead and confirms the
  fix directly: typing into
  the "AutoComplete:" field on the Misc panel and pressing `ArrowDown` once now focuses the
  *first* suggestion (previously the second), and pressing `Enter` before any arrow key still
  commits nothing and leaves the typed text untouched. The `ComboBox`-specific code path is the
  same `AbstractSelectableList.handleNavigationKey` exercised by `AutoCompleteDropdown`, and is
  covered directly by the automated `List.test.ts` cases, so this is a gap in the demo app's
  wiring for manual verification, not in the fix or its test coverage.
