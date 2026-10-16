---
depends-on: [focus-history-can-go-back-follows-focus]   # the tip of the keyboard stack; the code edited here was last changed by tree-page-keys, lower in that stack
touches-shared:
  - packages/lib/src/typescript/lib/component/tree/Tree.ts                     # feature/spatial-navigation-redesign adds eight lines below the imports; feature/nested-scroll-reveal adds a parameter to _selectAtIndex and edits every call inside _onKeyDown
  - packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts   # feature/nested-scroll-reveal replaces the last statement of handleTypeAhead
  - packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts         # feature/nested-scroll-reveal rewrites scrollRowIntoView
  - packages/lib/src/typescript/lib/component/container/TabBar.ts              # feature/spatial-navigation-redesign adds three lines to the default options
  - packages/lib/docs/concepts/accessibility.md                                # edited by both branches, outside the one section this plan edits
  - packages/lib/docs/reference/changelog/next.md                              # edited by both branches and by every sibling plan
---

# Collection Widget Keyboard Gaps — Implementation Plan

## Overview

The plan `tree-page-keys` surveyed the keys of every collection widget against its WAI-ARIA pattern, fixed two of the gaps and listed the rest. This plan redoes that survey on the code as it is now and closes five of the gaps. The full widget × key table is in [the addendum](#addendum-keyboard-survey). Whatever changes existing behaviour is listed under `## Decisions Awaiting Sign-off`.

Five changes, all in the library:

| Part | Change | Where |
|---|---|---|
| A | A pool row that shows no data is hidden. Today a long `Tree`, `Table` or `TreeTable` holds three empty, displayed rows | [`VirtualRowView.growRowPool`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L303) |
| B | One shared type-ahead helper. `List`, `MultiSelectList` and the `ComboBox` dropdown move onto it | new `component/shared/TypeAheadSearch.ts`; [`AbstractSelectableList`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2295) |
| C | `Tree`: type-ahead, `Enter` to activate, `*` to expand siblings | [`Tree._onKeyDown`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L1920) |
| D | Tab strip: `Home` / `End` | [`TabBar.onToolbarKeyDown`](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L3463) |
| E | Docs and changelog for A–D | `packages/lib/docs` |

Five terms are used throughout.

- The **current row** of a `Tree` is the row the keyboard is on. `Tree` keeps its node in `_focusNode` and names its element with `aria-activedescendant`. The tree's own element holds DOM focus; rows never do.
- **Type-ahead** means typing the first letters of a label to jump to its row. The typed letters are kept in a **buffer** until the user pauses.
- A **pool row** is one of the row components a virtual-scrolling widget reuses. It is **bound** while it shows a node or record and **unbound** otherwise.
- A key is **prevented** when the browser's default action for it does not run. A key is **stopped** when listeners on the widget's ancestors do not receive it. No key in this plan is stopped.
- The **selection ladder** is the rule that turns a click or a key press with `Shift` or `Ctrl` into a new selection. `MultiSelectList` and the table body share one, `reduceModifierSelection`; `Tree` has its own.

No public API is added. One existing event gains a second trigger: `Tree`'s `"dblclick"` also fires for `Enter`.

Two subjects of the survey are left out, each with its reason: arrow keys that move between cells in a `TreeTable`, and keys in the time picker's columns. `## Non-Goals` gives the evidence.

Every line number in this plan is that of commit `59a5c2e27`, the tip of `feature/focus-history-can-go-back-follows-focus`.

---

## Decisions Awaiting Sign-off

The plan body below is written with every recommendation taken. Each row says what to remove if the user declines it.

| # | Decision | What changes for existing code | Recommendation | If declined |
|---|---|---|---|---|
| 1 | `Enter` in a `Tree` fires the existing `"dblclick"` event and toggles an expandable node | Every `"dblclick"` listener now also runs for `Enter`. SQLAdmin's navigator and roles tree open a node from that event, so both gain keyboard "open" with no change. In a modal `Dialog` that has a primary button, `Enter` on a tree row fires `"dblclick"` and also confirms the dialog, because `Dialog`'s rule is not changed | Accept[^enter-dblclick] | Drop step 6 and cases N1–N13 |
| 2 | Tree type-ahead selects the row it lands on and fires `"selection"` | A consumer that reacts to `"selection"` reacts to every jump, as it does to every arrow key. SQLAdmin's Properties panel and the docs sidebar's navigation are such consumers | Accept[^tree-selects] | Drop step 5 and cases T1–T20 |
| 3 | `List` type-ahead follows the shared rule | Three things change in `List`, `MultiSelectList` and an open `ComboBox` dropdown: a letter moves to the next match **after** the focused row, not the first match from the top; the same letter typed again steps through the matches; and the key is prevented on the list's own element | Accept[^list-rule] | Drop step 4 and cases L1–L9. The helper then serves `Tree` only |
| 4 | `*` expands only the siblings whose children are already in memory | New key. It never calls `loadChildren`, so in an all-lazy tree it expands only nodes the user opened before | Accept[^star-loaded] | Drop step 7 and cases X1–X9. `*` is then an ordinary type-ahead character |
| 5 | `TreeTable`: `ArrowLeft` / `ArrowRight` between cells are not added | Nothing | Leave out. Each of the three workable designs changes what an arrow key does today, and `Tab` / `Shift+Tab` already move along the row. The designs are in [the second addendum](#addendum-treetable-arrow-keys--three-models) | A plan of its own, once a model is chosen |
| 6 | The time picker's columns get no keys | Nothing | Leave out. The field's text input is the keyboard path, and no ARIA pattern fits the columns | A plan of its own |
| 7 | `Tree._onKeyDown` is not restructured, and `Tree` is not moved onto the shared selection ladder | Nothing | Leave both to one refactor after `feature/nested-scroll-reveal` is merged or dropped[^no-restructure] | — |

### New keys an application could have handled itself

A handler on an ancestor — an `Event.addSubtreeListener` on a container, or a listener on `document` — still receives every key below, because none is stopped. What changes is that `event.defaultPrevented` is now `true` when the handler runs.

| Widget | Key | Before | After | Consumers checked |
|---|---|---|---|---|
| `Tree` | `Enter`, no modifier | ignored, not prevented | prevented; fires `"dblclick"` | A handler that opens the node on `Enter` now runs beside the `"dblclick"` listener: if both open the node, it opens twice. Demo app, docs app, SQLAdmin: none binds `Enter` on a tree[^consumers] |
| `Tree` | a printable character, no `Ctrl` / `Alt` / `Meta` | ignored, not prevented | prevented; may move the current row | SQLAdmin's `?` help shortcut is a `document` listener that does not test `defaultPrevented`: it still opens the help dialog. The tree keeps `?` in its buffer for 700 ms and moves nowhere |
| `Tree` | `*` | ignored, not prevented | prevented; may expand rows | none |
| `Tree` | `Escape` | ignored | still not prevented; clears the buffer | none |
| `List`, `MultiSelectList` | a printable character | moved the focus mark, not prevented | moves the focus mark by the new rule, prevented | SQLAdmin's saved-queries list: its `Enter` handler is unaffected |
| Tab strip | `Home` / `End`, no modifier, focus on a tab or its ✕ | ignored, not prevented | prevented; activates the first / last tab | none |

`Enter`, `Home` and `End` pressed with a modifier, and every `Ctrl`, `Alt` or `Meta` chord, are left exactly as today. `Ctrl+Enter` in SQLAdmin is untouched.

---

## Architecture Decisions

### The new tree keys are new methods; the branches of `_onKeyDown` stay where they are

`Tree._onKeyDown` gains one short block after its first line. The block calls a new private method, `_handleActionKey`, which handles `Enter`, `*`, `Escape` and type-ahead. Everything else in `_onKeyDown` is untouched, and so are `_selectAtIndex` and `_extendSelectionTo`.[^no-restructure]

The same answer applies to the selection ladder. `Tree` keeps its own; it is not moved onto [`reduceModifierSelection`](../packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts#L31) here.

### `Enter` activates through the existing `"dblclick"` event

`Enter` on the current row does what a double-click on that row's label does. It fires `"dblclick"` with the node. Then, when the node is expandable, it toggles the node.

The precedent is [`Tree._handleContextMenu`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2109): `Shift+F10` fires the tree's existing `"contextmenu"` event, so one subscription serves the mouse and the keyboard. `Enter` does the same with `"dblclick"`.[^enter-dblclick]

Four details:

- **The row is scrolled into view first**, through [`_revealFocusRow`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2141), the method the keyboard context menu uses.
- **Order**: `"dblclick"` fires, then the toggle runs. [`_handleDblClick`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2172) has that order.
- **The toggle does not depend on `expandTrigger`.** With `"dblclick"` a double-click toggles; with `"click"` a click toggles. `Enter` stands for whichever gesture opens the node, so it toggles in both.[^enter-both-modes]
- **The selection is not touched.** `Enter` with the current row unselected activates it and leaves it unselected.

A held `Enter` acts once. Its auto-repeat is prevented and does nothing, as in [`Menu.onPanelKeyDown`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1606).

### Type-ahead is one shared helper beside the selection ladder

The library has one type-ahead today: [`AbstractSelectableList.handleTypeAhead`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2295), used by `List`, `MultiSelectList` and the `ComboBox` dropdown. `Menu` and `ComboBox` have none of their own.[^typeahead-precedent]

The buffer and the matching move out of the list into a new file, `component/shared/TypeAheadSearch.ts`, next to `reduceModifierSelection.ts`. Like that file it is internal and not barrel-exported. `Tree` and `AbstractSelectableList` each hold one `TypeAheadSearch`.

The helper keeps what the list does today: a 700 ms window measured with `Date.now()` and no timer, lower-case `startsWith` matching, and rows that may not be landed on are skipped. It changes where the search starts.

### How a match is found

After each key the helper looks at the whole buffer:

- **One letter, typed once or several times** (`b`, `bb`, `bbb`): look for that one letter, starting at the row **after** the current row.
- **Anything else** (`bl`, `che`): look for the whole buffer, starting **at** the current row.

Either search runs forward through every row once and wraps past the last row to the first. With no current row it starts at the first row. No match means no move.

For the rows `Apple`, `Apricot`, `Banana`, `Blueberry`, `Cherry`:

| Buffer after the key | Current row | Looks for | Starts at | Lands on |
|---|---|---|---|---|
| `b` | none | `b` | Apple | Banana |
| `b` | Banana | `b` | Blueberry | Blueberry |
| `bb` | Blueberry | `b` | Cherry | Banana, after wrapping |
| `bl` | Banana | `bl` | Banana | Blueberry |
| `bl` | Blueberry | `bl` | Blueberry | Blueberry: stays |
| `ap` | Cherry | `ap` | Cherry | Apple, after wrapping |
| `aa` | Apple | `a` | Apricot | Apricot — a repeated letter steps; it does not look for a label that starts with `aa` |
| `x` | any | `x` | — | nowhere: no move |

The buffer starts again when more than 700 ms have passed since the previous type-ahead key, or when `Escape` is pressed.[^match-rule]

| Time of the key | Previous key at | Buffer before | Buffer after `c` |
|---|---|---|---|
| 1700 | 1000 | `b` | `bc` — 700 ms is still inside the window |
| 1701 | 1000 | `b` | `c` |

### Which key presses are type-ahead

A key press is a type-ahead character when `event.key` is one character, that character is not Space, and neither `Ctrl`, `Meta` nor `Alt` is held. `Shift` is allowed: it types capitals and symbols. The helper exports this test as `isTypeAheadKey`.

Space is never type-ahead. In a list it commits the focused row; in a tree it is left alone, as today.[^space]

### Tree type-ahead is a plain move of the current row

A match is handed to [`_selectAtIndex`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L1819), the method a plain arrow key uses. The row becomes the current row, the only selected row and the anchor — the fixed end of a later `Shift` range; it is scrolled into view; `"selection"` fires when the selection changed.[^tree-selects]

What is searched:

- **The visible rows**, in order: `_flatRows`. A row scrolled out of view is searched, because `_flatRows` holds every visible row whether or not a pool row shows it.
- **Not** the children of a collapsed node, and **not** children that are not loaded. Type-ahead never expands a node and never calls `loadChildren`.
- **By `TreeNode.label`**, whatever the row's renderer draws. A custom renderer that shows other text does not change what type-ahead matches.

A `Tree` has no disabled node and no disabled or read-only state, so no row is skipped.

### `*` expands the siblings whose children are in memory

`*` expands every sibling of the current row — the current row included — that has a non-empty `children` array and is collapsed. That is the test [`expandAll`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L578) uses. A lazy node that has not loaded is skipped, and `loadChildren` is never called.[^star-loaded]

The change is made in one step and is not animated, like `expandAll`. Unlike `expandAll` it is the user's gesture, so `"expand"` fires once for each node it expanded, in sibling order.

The current row and the selection do not change. Expanding siblings above the current row moves it down, so it is scrolled back into view through `_revealFocusRow`.

`*` is checked before type-ahead, so `*` is never a type-ahead character in a tree.

### Which key presses are the tree's

| Key press on a focused tree with rows | Result | Prevented |
|---|---|---|
| a key `SpatialNavigation` claims | nothing; the first line of `_onKeyDown` returns | no |
| `Escape`, with or without a modifier | the type-ahead buffer is cleared | no |
| `Enter`, no modifier | the current row is activated | yes |
| `Enter`, auto-repeat | nothing | yes |
| `Enter` with `Shift`, `Ctrl`, `Alt` or `Meta` | nothing | no |
| `*`, with or without `Shift` | siblings expand | yes |
| a type-ahead character | the buffer grows; the current row moves on a match | yes, match or not |
| `*` or a character, with `Ctrl`, `Alt` or `Meta` held | nothing | no |
| Space | nothing, as today | no |
| `Enter` or `*` with no current row among the visible rows | nothing | yes |

An empty tree handles none of these keys and prevents none. No key is ever stopped. Both rules are the ones `tree-page-keys` set for the page keys.[^prevent-not-stop]

The tree's `keydown` listener is registered with `Event.addListener`, which runs only for an event whose target is the tree's own element ([:2524](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2524)). A key typed into a control inside a row — an inline rename field in a custom renderer — or into a filter field beside the tree never reaches these keys.

### `List` moves onto the helper

`AbstractSelectableList.handleTypeAhead` keeps its name, its `protected` visibility and its last statement, `this.setFocusedIndex(idx)`. Its body asks the helper for the row. Type-ahead in a list still moves the focus mark only and never the selection.[^list-rule]

Three more edits in the same class:

- `handleKeyDown` returns `{ prevent: true }` after a type-ahead key. The host path, `handleKey`, already reports the key as consumed and `ComboBox` prevents it.
- `Escape` calls `clear()` on the helper.
- The two `protected` fields `_typeAheadBuf` and `_typeAheadAt`, and the constant `TYPE_AHEAD_TIMEOUT_MS`, are deleted; the helper owns them.

A disabled or read-only list still ignores every key: the guard at the top of `handleKeyDown` and `handleKey` is not touched.

### `Home` / `End` on a tab strip act only from a tab

`TabBar.onToolbarKeyDown` handles `Home` and `End` when DOM focus is on one of the strip's tabs or on a tab's ✕, and no modifier is held. It activates the first or last tab through the public [`setActiveEntry`](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L2045), which is the activation a click makes: pressed state, roving focus, scroll-into-view and `"tabpressed"`.

| Focus is on | Key | Result | Prevented |
|---|---|---|---|
| tab `b` of `a`, `b`, `c` | `End` | `c` is activated and focused | yes |
| the ✕ of tab `b` | `End` | `c` is activated; focus moves to its tab button | yes |
| tab `c`, which is active | `End` | nothing; no `"tabpressed"` | yes |
| a strip tool | `Home` or `End` | nothing; the tool keeps the key | no |
| anywhere outside the strip's tabs | `Home` or `End` | nothing | no |
| a tab, with `Shift`, `Ctrl`, `Alt` or `Meta` held | `Home` or `End` | nothing | no |

`ArrowLeft`, `ArrowRight` and `Delete` are not changed.[^tab-from-cell]

A strip has no disabled tab, so no tab is skipped. The library has no right-to-left mode: `Home` is the first tab in strip order on every side of the container.

### A new pool row starts hidden

`growRowPool` creates each row, records it as not displayed in `_rowDisplayed`, and never hides it. The row stays displayed until a render pass has bound it and let it go again. A view with more rows than fit holds three such rows when it is first shown.[^pool-rows]

`growRowPool` now calls `row.setDisplayed(false)` on each row it creates. [`positionRow`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L479) already shows a row the first time it places it, so a bound row is displayed as before.

| Fresh `Tree`, 60 rows, 120 px high | Pool rows | Bound and displayed | Unbound and displayed |
|---|---|---|---|
| today | 11 | 8 | 3 — three empty `treeitem` elements |
| with this plan | 11 | 8 | 0 |

The same three rows exist in a `Table` and a `TreeTable`, as empty `row` elements that each hold a full set of `gridcell`s. The one edit fixes all three widgets.

### Every reveal goes through the existing paths

No scroll code is added.

| Key | Reveal path |
|---|---|
| Tree type-ahead | `_selectAtIndex` → `_scrollIntoView` → [`VirtualRowView.scrollRowIntoView`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L1125) → `nearestRevealOffset` |
| Tree `Enter` and `*` | `_revealFocusRow` → the same three |
| List type-ahead | `setFocusedIndex` → `scrollIndexIntoView` → `Panel.revealSpan` |
| Tab strip `Home` / `End` | `setActiveEntry` → `onTabPressed`, which asks the strip to scroll the selected tab into view on its next layout |

### ARIA

Nothing new is written. Each new key reuses attributes the widgets already maintain.

| Subject | State | In this plan |
|---|---|---|
| Tree: `aria-activedescendant` on the tree element, not roving `tabindex` | already so; `_selectAtIndex` and `_revealFocusRow` update it | relied on; asserted in T1 and X1 |
| Tree: `aria-multiselectable="true"` | always written | unchanged |
| Tree: `aria-level`, `aria-setsize`, `aria-posinset`, `aria-expanded` on virtual rows | written on every bound row from the data, so a row that scrolls into view carries the right values | unchanged; `*` and `Enter` change `aria-expanded` through the normal re-bind |
| Tree, Table, TreeTable: unbound pool rows in the accessibility tree | three empty `treeitem` / `row` elements | fixed by part A |
| Type-ahead with no match | silent | out: `List` is silent too, and the pattern asks for no announcement |
| Tab strip: `aria-orientation` on a west or east strip | not written | out: see `## Non-Goals` |

### Merges with the two unmerged branches

`feature/spatial-navigation-redesign` is independent of this plan. `feature/nested-scroll-reveal` is built on the same stack tip, is held back and may not merge. This plan works without either.

| File | Other branch changes | This plan changes | On merge |
|---|---|---|---|
| `tree/Tree.ts` | spatial: eight lines after the last import (line 17) | one import after line 11; two lists in the class JSDoc (lines 204–212); one field after line 285; the JSDoc of `on("dblclick")` (lines 1002–1014); three JSDoc bullets after line 1916; one block after line 1921; new methods after line 2010 | clean |
| `tree/Tree.ts` | nested: `_selectAtIndex(index, around)` and `_scrollIntoView(index, around)` gain a second parameter; every call inside `_onKeyDown` from line 1940 down passes `true`; `_revealFocusRow` passes `true` itself | as above | text merges cleanly. `tsc` then reports one call: `this._selectAtIndex(index)` in `_typeAheadTo`. Change it to `this._selectAtIndex(index, true)`. `Enter` and `*` need no edit |
| `list/AbstractSelectableList.ts` | nested: the last statement of `handleTypeAhead` becomes `this.focusIndex(idx, true)` (lines 2317–2318); other hunks at lines 1876, 1978–1999, 2259 and 2326 | the body of `handleTypeAhead` above line 2310, with lines 2310–2318 left byte-identical; and edits at lines 20, 93–100, 811–814, 2058–2062, 2089 and 2104–2109 | clean |
| `shared/VirtualRowView.ts` | nested: `scrollRowIntoView` and below (from line 1119) | four lines inside `growRowPool` (line 324) | clean |
| `container/TabBar.ts` | spatial: three lines in the default options (line 458) | `onToolbarKeyDown` (line 3463) and one new method after line 1826 | clean |
| `docs/concepts/accessibility.md` | spatial: the tab-strip paragraph (lines 76–84) and the spatial section. nested: lines 211 and 382 | three table rows and one sentence inside "Keys in trees, lists and tables" (lines 248–264) | clean |
| `docs/reference/changelog/next.md` | both append entries | entries appended at the end of two lists | a conflict where another branch appended at the same spot: keep both sides |

With `feature/nested-scroll-reveal` merged and that one call edited, a type-ahead move, `Enter` and `*` scroll the panels around the tree too, as its rule for keyboard moves says. Without it they scroll the tree only.[^nested]

`SpatialNavigation`'s chords are arrow keys with modifiers. No key in this plan is an arrow key, and every new key stands down while `SpatialNavigation.claimsKey` is true.

### Tests

| File | Kind | Holds |
|---|---|---|
| `tests/component/shared/VirtualRowView.unboundRows.test.ts` (new) | offline, direct | part A |
| `tests/component/shared/TypeAheadSearch.test.ts` (new) | pure unit, no DOM | the helper |
| `tests/component/shared/KeyboardRowActions.test.ts` (new) | real `keydown` events | every `Tree` case, and the `List` cases that count `preventDefault` |
| `tests/component/list/List.test.ts` (append) | the file's own `TestList` seam | the `List` matching cases |
| `tests/component/container/TabBar.test.ts` (append) | direct calls to `onToolbarKeyDown`, as its neighbours make | the tab strip cases |

`KeyboardRowActions.test.ts` copies the harness of [`KeyboardRowNavigation.test.ts`](../packages/lib/tests/component/shared/KeyboardRowNavigation.test.ts#L26) in the same folder.[^test-files]

---

## Public API

No exported symbol is added, renamed or removed. The helper is internal: it is not re-exported from any `index.ts`.

```typescript
// component/shared/TypeAheadSearch.ts — @internal, shared by AbstractSelectableList and Tree

export const TYPE_AHEAD_TIMEOUT_MS = 700;

export interface TypeAheadRows {
    count:      number;
    current:    number;
    labelAt:    (index: number) => string;
    isEligible: (index: number) => boolean;
}

export function isTypeAheadKey(e: KeyboardEvent): boolean;

export class TypeAheadSearch {
    type(ch: string, rows: TypeAheadRows): number;
    clear(): void;
}
```

`type` returns the index of the row to move to, or `-1`.

The helper is not a `Component` and has no options. Its state is two private fields, `_buffer` and `_lastKeyAt`; neither is consumer-configurable, so there is no accessor and no options field.

Changed, not added:

- `Tree`'s `"dblclick"` event also fires for `Enter` on the current row. Its listener signature, `(node: TreeNode) => void`, is unchanged.
- `AbstractSelectableList` loses the `protected` fields `_typeAheadBuf` and `_typeAheadAt`. Neither is in the generated API docs.

---

## Internal Structure

### `component/shared/TypeAheadSearch.ts` — the whole file

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Longest pause, in milliseconds, between two type-ahead key presses that
 * still belong to one search. It is the type-ahead window of the native
 * `<select>` the library's list replaces: letters typed inside it build one
 * prefix, and a longer pause starts a new search.
 */
export const TYPE_AHEAD_TIMEOUT_MS = 700;

/**
 * The rows one type-ahead search runs over, in display order.
 */
export interface TypeAheadRows {
    /** How many rows there are. */
    count:      number;
    /** Index of the current row, or `-1` when there is none. */
    current:    number;
    /** Returns the label of the row at `index`. */
    labelAt:    (index: number) => string;
    /** Returns whether the search may land on the row at `index`. */
    isEligible: (index: number) => boolean;
}

/**
 * Whether a key press is a type-ahead character: one printable character
 * other than Space, pressed without `Control`, `Meta` or `Alt`. `Shift` is
 * allowed, since it types capitals and symbols. A named key (`"Enter"`,
 * `"ArrowDown"`, `"Dead"`) has a `key` longer than one character.
 *
 * @param e - The keydown to test.
 * @returns `true` when the key belongs to type-ahead.
 */
export function isTypeAheadKey(e: KeyboardEvent): boolean {
    return e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/**
 * One widget's type-ahead: the characters typed so far and the search they
 * run. The buffer starts again after a pause longer than
 * {@link TYPE_AHEAD_TIMEOUT_MS}, read from `Date.now()` on each key, so
 * there is no timer to cancel.
 *
 * @internal Shared by `AbstractSelectableList` and `Tree`; not barrel-exported.
 */
export class TypeAheadSearch {

    /** The characters typed in the current search, lower-cased. */
    private _buffer:    string = "";
    /** `Date.now()` at the last key, for the pause test. */
    private _lastKeyAt: number = 0;

    /**
     * Adds one typed character and finds the row to move to.
     *
     * One letter typed once or several times looks for that letter from the
     * row after the current one, so the same key steps through the rows
     * that start with it. Any other buffer is a prefix, looked for from the
     * current row itself, so a row that still matches is kept. Both searches
     * wrap past the last row and skip a row that is not eligible.
     *
     * @param ch - The character typed.
     * @param rows - The rows to search.
     * @returns The index of the row to move to, or `-1` when no row matches.
     */
    type(ch: string, rows: TypeAheadRows): number {
        const now = Date.now();

        if (now - this._lastKeyAt > TYPE_AHEAD_TIMEOUT_MS) {
            this._buffer = "";
        }

        this._buffer += ch.toLowerCase();
        this._lastKeyAt = now;

        const buffer   = this._buffer;
        const repeated = buffer.split("").every(typed => typed === buffer[0]);
        const needle   = repeated ? buffer[0] : buffer;
        const start    = repeated ? rows.current + 1 : Math.max(rows.current, 0);

        for (let step = 0; step < rows.count; step++) {
            const index   = (start + step) % rows.count;
            const matches = rows.isEligible(index) && rows.labelAt(index).toLowerCase().startsWith(needle);

            if (matches) {
                return index;
            }
        }

        return -1;
    }

    /** Empties the buffer, so the next key starts a new search. */
    clear(): void {
        this._buffer = "";
    }
}
```

### `Tree.ts` — the edits

**Import**, after line 11 (`selectionsEqual`):

```typescript
import { TypeAheadSearch, isTypeAheadKey } from "~/component/shared/TypeAheadSearch.js";
```

**Field**, after `_rendererFactory` (line 285):

```typescript
    // The type-ahead buffer. Framework-managed bookkeeping, so it gets no
    // `TreeOptions` field and no setter. A plain initializer is safe: only a
    // key press writes it, and no key arrives during `super()`.
    private _typeAhead          : TypeAheadSearch                                         = new TypeAheadSearch();
```

**`_onKeyDown`**, the first lines after the edit. Only the comment, the `const` and the `if` are new:

```typescript
    private _onKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (SpatialNavigation.claimsKey(e)) { return; }

        // Enter, `*`, Escape and type-ahead act on the current row without
        // moving it by position; the navigation keys below do the rest.
        const handled = this._handleActionKey(e);

        if (handled) {
            return { prevent: true };
        }

        const navigable = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageDown', 'PageUp']);
```

**New methods**, inserted after `_onKeyDown` ends (line 2010) and before the JSDoc of `_handleClick`:

```typescript
    /**
     * Finds the current row among the visible rows.
     *
     * @returns Zero-based index into `_flatRows` of the focus node's row, or
     *   -1 when there is no focus node, its node was removed, or it is hidden
     *   under a collapsed node.
     */
    private _currentRowIndex(): number {
        const focusNode = this._focusNode;

        return focusNode === null ? -1 : this._flatRows.findIndex(r => r.node === focusNode);
    }

    /**
     * Handles the keys that act on the current row without moving it by
     * position: `Enter` activates it, `*` expands its siblings, a printable
     * character feeds type-ahead, and `Escape` clears the type-ahead buffer.
     * `Enter` is plain only, and `*` and type-ahead allow `Shift` only: a
     * chord with `Control`, `Meta` or `Alt` belongs to the browser or the
     * application.
     *
     * @param e - The keydown on the tree element.
     * @returns `true` when the key was the tree's own, so the caller
     *   prevents it. `Escape` is never the tree's own.
     */
    private _handleActionKey(e: KeyboardEvent): boolean {
        if (this._flatRows.length === 0) {
            return false;
        }

        if (e.key === 'Escape') {
            this._typeAhead.clear();

            return false;
        }

        const chord = e.ctrlKey || e.metaKey || e.altKey;

        if (chord) {
            return false;
        }

        if (e.key === 'Enter') {
            if (e.shiftKey) {
                return false;
            }

            // A held key's auto-repeat is consumed and ignored, as a menu
            // does: it would activate the node again on every repeat.
            if (!e.repeat) {
                this._activateCurrentNode();
            }

            return true;
        }

        if (e.key === '*') {
            this._expandSiblingsOfCurrentNode();

            return true;
        }

        const typed = isTypeAheadKey(e);

        if (typed) {
            this._typeAheadTo(e.key);
        }

        return typed;
    }

    /**
     * `Enter`: does what a double-click on the current row's label does. It
     * scrolls the row into view, emits `"dblclick"` and then toggles an
     * expandable node. The toggle does not depend on {@link getExpandTrigger}:
     * `Enter` stands for whichever click gesture opens the node. The
     * selection is not touched. Does nothing with no current row among the
     * visible rows.
     */
    private _activateCurrentNode(): void {
        const index = this._currentRowIndex();

        if (index < 0) {
            return;
        }

        const node = this._flatRows[index].node;

        this._revealFocusRow();
        this.emit("dblclick", node);

        // Read after the listeners ran, as `_handleDblClick` reads it.
        const expandable = this._isExpandable(node);

        if (expandable) {
            this._onToggle(node);
        }
    }

    /**
     * `*`: expands every sibling of the current row, itself included, that
     * is collapsed and has children in memory — the test {@link expandAll}
     * uses, so a lazy node that has not loaded is skipped and nothing is
     * loaded. One re-render, not animated. Emits `"expand"` once per node it
     * expanded, in sibling order, and keeps the current row in view. The
     * selection is not touched. Does nothing with no current row among the
     * visible rows.
     */
    private _expandSiblingsOfCurrentNode(): void {
        const index = this._currentRowIndex();

        if (index < 0) {
            return;
        }

        const location = this._locate(this._flatRows[index].node);

        if (location === null) {
            return;
        }

        const opened = location.siblings.filter(node =>
            !!(node.children && node.children.length > 0) && !this._expandedNodes.has(node));

        if (opened.length === 0) {
            return;
        }

        for (const node of opened) {
            this._expandedNodes.add(node);
        }

        this._reflattenAndRender();
        this._revealFocusRow();

        for (const node of opened) {
            this.emit("expand", node);
        }
    }

    /**
     * Type-ahead: feeds one typed character to the buffer and, on a match,
     * moves the current row there as a plain key does — it selects the row,
     * scrolls it into view and fires `"selection"`. Only the visible rows
     * are searched, by `TreeNode.label`; nothing is expanded or loaded.
     *
     * @param ch - The character typed.
     */
    private _typeAheadTo(ch: string): void {
        const rows  = this._flatRows;
        const index = this._typeAhead.type(ch, {
            count:      rows.length,
            current:    this._currentRowIndex(),
            labelAt:    (i: number): string => rows[i].node.label,
            isEligible: (): boolean => true,
        });

        if (index >= 0) {
            this._selectAtIndex(index);
        }
    }
```

### `AbstractSelectableList.ts` — the edits

**Import**, after line 20 (`selectionsEqual`):

```typescript
import { TypeAheadSearch, isTypeAheadKey } from "~/component/shared/TypeAheadSearch.js";
```

**Constant.** Delete `TYPE_AHEAD_TIMEOUT_MS` and its comment (lines 93–100).

**Fields.** Replace the two fields and their comments (lines 811–814) with:

```typescript
    /** The type-ahead buffer; cleared on Escape, and by a pause between keys. */
    private _typeAhead:      TypeAheadSearch       = new TypeAheadSearch();
```

**`handleKey`.** Replace the last `if` block (line 2058, `if (!ctrl && !e.altKey && e.key.length === 1) { … }`) with:

```typescript
        const typed = isTypeAheadKey(e);

        if (typed) {
            this.handleTypeAhead(e.key);

            return true;
        }
```

**`handleKeyDown`.** In the `Escape` branch (line 2089) replace `this._typeAheadBuf = "";` with `this._typeAhead.clear();`. Replace the last block of the method, comment included (lines 2104–2109), with:

```typescript
        // A printable character feeds the type-ahead buffer. The key is the
        // list's own whether or not a row matched.
        const typed = isTypeAheadKey(e);

        if (typed) {
            this.handleTypeAhead(e.key);

            return { prevent: true };
        }
```

**`handleTypeAhead`.** Replace the method's JSDoc and its body down to and including the `findIndex` statement (lines 2287–2308). Lines 2310–2318 — the `if (idx < 0)` block, the four-line comment and `this.setFocusedIndex(idx);` — are not edited. The method reads:

```typescript
    /**
     * Feeds `ch` to the type-ahead buffer and moves the focus mark to the
     * row it finds: the next enabled row after the focused one whose label
     * starts with the typed letter, or, once several different letters were
     * typed, the first from the focused row on whose label starts with all
     * of them. The buffer starts again after a 700 ms pause.
     *
     * @param ch - The character key pressed.
     */
    protected handleTypeAhead(ch: string): void {
        const idx = this._typeAhead.type(ch, {
            count:      this._items.length,
            current:    this._focusedIndex,
            labelAt:    (i: number): string => this._items[i].label,
            isEligible: (i: number): boolean => this.isItemEnabled(i),
        });

        if (idx < 0) {
            return;
        }

        // Type-ahead moves only the focus highlight; selection is
        // unaffected (same behaviour as the native `<select>` it
        // replaces — typing a letter previews the row without
        // committing).
        this.setFocusedIndex(idx);
    }
```

### `TabBar.ts` — the edits

**`onToolbarKeyDown`**, its opening after the edit. The `edgeKey` constant, its use in the first `if`, and the `if (edgeKey)` block are new; the long comment above `focusedIdx` is unchanged and elided here:

```typescript
    private onToolbarKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (SpatialNavigation.claimsKey(e)) { return; }

        const edgeKey = e.key === 'Home' || e.key === 'End';

        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Delete' && !edgeKey) {
            return;
        }

        const tabCount = this._entries.length;

        if (tabCount === 0) {
            return;
        }

        // … unchanged comment …
        const focusedIdx = this.entryIndexForElement(DOM.source.getActiveElement());

        if (e.key === 'Delete') {
            return this.closeFocusedEntry(focusedIdx);
        }

        if (edgeKey) {
            return this.activateEdgeEntry(e, focusedIdx);
        }
```

**New method**, inserted after `closeFocusedEntry` ends (line 1826):

```typescript
    /**
     * `Home` / `End`: activates the first or last tab, as a click on it
     * would. Acts only while a tab button or its ✕ holds focus and no
     * modifier is held, so a strip tool keeps the two keys for its own
     * caret. A target that is already active and focused is left alone, so
     * no `"tabpressed"` is emitted for it.
     *
     * @param e - The `Home` or `End` keydown.
     * @param focusedIndex - Index of the cell that holds DOM focus, or `-1`
     *   when focus is not on a tab button or a ✕ of this strip.
     * @returns A prevent disposition when the key was the strip's; nothing otherwise.
     */
    private activateEdgeEntry(e: KeyboardEvent, focusedIndex: number): Event.ListenerResult {
        const chord = e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;

        if (chord || focusedIndex < 0) {
            return;
        }

        const target  = this._entries[e.key === 'Home' ? 0 : this._entries.length - 1];
        const settled = target.id === this._activeId
            && target.button.getElement() === DOM.source.getActiveElement();

        if (!settled) {
            this.setActiveEntry(target.id);
        }

        return { prevent: true };
    }
```

### `VirtualRowView.growRowPool` — the edit

Insert after `row.setWillChange("transform");` (line 324) and before `this._rowPool.push(row);`:

```typescript

            // A new row shows nothing until a render pass binds it, so it
            // starts hidden, as `_rowDisplayed` below records. `positionRow`
            // shows a row the first time it places it, and
            // `hideExcessPoolRows` hides only a row that was shown.
            row.setDisplayed(false);
```

---

## Ordered Implementation Steps

Work test-first. Each step writes its cases, sees them fail for the stated reason, then makes them pass.

Two project rules apply to every line written here. A function call never stands directly in an `if` or `while` condition: assign its result to a named `const` first, as every new line in `## Internal Structure` does; existing lines shown there for context stay as they are. And a fault found on the way is fixed in the library at its cause, never worked around in a test or a demo.

Steps 1, 3, 4, 5, 6, 7 and 8 are one code commit each; step 2's test file rides in step 3's commit.

1. **Part A — hidden pool rows.**
   - Create `tests/component/shared/VirtualRowView.unboundRows.test.ts` with cases U1–U4. Check: U1 and U3 fail (three unbound rows report `isDisplayed() === true`); U2 and U4 pass.
   - Make the `growRowPool` edit in `## Internal Structure`.
   - Check: U1–U4 pass. Run `cd packages/lib && npx vitest run tests/component/tree tests/component/table tests/component/shared tests/component/list tests/component/display tests/dom` — all pass, no existing test edited.

2. **The helper's tests.** Create `tests/component/shared/TypeAheadSearch.test.ts` with cases S1–S10. Check: the file fails to import `~/component/shared/TypeAheadSearch`.

3. **The helper.** Create `component/shared/TypeAheadSearch.ts` with the file in `## Internal Structure`. Check: S1–S10 pass. From the repo root, `grep -rn "TypeAheadSearch" packages/lib/src/typescript/lib --include=index.ts` — no output.

4. **Part B — `List` onto the helper.**
   - Append cases L1–L5 to the describe block "type-ahead with a deterministic clock" in `tests/component/list/List.test.ts` ([:340](../packages/lib/tests/component/list/List.test.ts#L340)). Create `tests/component/shared/KeyboardRowActions.test.ts` with the harness in `## Verification` and cases L6–L9. Check: L1, L3, L5 and L6 fail; L2, L4, L7, L8 and L9 pass (they hold under the old rule too and guard it).
   - Make the five `AbstractSelectableList.ts` edits in `## Internal Structure`.
   - Check: L1–L9 pass. The four existing type-ahead cases of `List.test.ts` and case K5 of `AbstractSelectableList.scrollIndexIntoView.test.ts` pass unedited.
   - From the repo root, `grep -n "_typeAheadBuf\|_typeAheadAt\|TYPE_AHEAD_TIMEOUT_MS" packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` — no output.

5. **Part C — tree type-ahead.**
   - Add cases T1–T20 to `KeyboardRowActions.test.ts`. Check: T14, T17 and T18 pass (the tree ignores those keys today); the rest fail.
   - In `Tree.ts`: add the import, the field, the block in `_onKeyDown`, `_currentRowIndex`, `_typeAheadTo`, and `_handleActionKey` **without** its `Enter` and `*` branches.
   - In the JSDoc of `_onKeyDown`, add after the `PageDown` / `PageUp` bullet (line 1916): `` * - a printable character — type-ahead to the next visible row whose label starts with what was typed; `Escape` clears the buffer ``. Wrap it to the file's comment width.
   - Check: T1–T20 pass.

6. **Part C — `Enter`.**
   - Add cases N1–N3 and N5–N13 (N4 is T17). Check: N5 passes; the rest fail.
   - Add `_activateCurrentNode` and the `Enter` branch of `_handleActionKey`.
   - Add the JSDoc bullet `` * - `Enter` — activate the current node: fire `"dblclick"`, then toggle an expandable node ``.
   - Replace the JSDoc of `on("dblclick")` (lines 1002–1014) with the text in `## Documentation Impact`.
   - Check: N1–N13 pass.

7. **Part C — `*`.**
   - Add cases X1–X9. Check: X4, X8 and X9 pass; the rest fail. X6 fails because step 5 made `*` an ordinary type-ahead character, so it lands on `*Star`.
   - Add `_expandSiblingsOfCurrentNode` and the `*` branch.
   - Add the JSDoc bullet `` * - `*` — expand the current node's siblings whose children are loaded ``.
   - In the class JSDoc, insert "`Enter`, " after "`ArrowRight` / `ArrowLeft`, " in the list of single-node toggles (line 205), and "the `*` key, " before "`expandAll`" in the list of bulk calls that never animate (line 208).
   - Check: X1–X9 pass, and T1–T20 and N1–N13 still pass.

8. **Part D — tab strip.**
   - Append a describe block "TabBar onToolbarKeyDown — Home and End" to `tests/component/container/TabBar.test.ts` with cases H1–H8. Check: H4, H5, H7 and H8 pass; the rest fail.
   - Make the two `TabBar.ts` edits. Change the first sentence of the JSDoc of `onToolbarKeyDown` (line 3457) to: "Handles ArrowLeft / ArrowRight to move tab focus and activate the adjacent tab, Home / End to activate the first / last tab, and Delete to close the focused tab."
   - Check: H1–H8 pass; every existing case of the file passes unedited.

9. **Grep checks**, from `packages/lib`:
   - `grep -n "_handleActionKey" src/typescript/lib/component/tree/Tree.ts` — two lines: the call in `_onKeyDown` and the definition.
   - `grep -c "this._selectAtIndex(" src/typescript/lib/component/tree/Tree.ts` — 12: the 11 there today and the one in `_typeAheadTo`.
   - `grep -c "this._scrollIntoView(" src/typescript/lib/component/tree/Tree.ts` — 6, as today: no new direct call.
   - `git diff --stat -- src` — five files: `Tree.ts`, `AbstractSelectableList.ts`, `VirtualRowView.ts`, `TabBar.ts` and the new `TypeAheadSearch.ts`.

10. **Part E — docs and changelog.** Make the edits in `## Documentation Impact`.

11. **Full verification.** Run the commands and the manual cases in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/shared/TypeAheadSearch.ts` |
| Create | `packages/lib/tests/component/shared/TypeAheadSearch.test.ts` |
| Create | `packages/lib/tests/component/shared/KeyboardRowActions.test.ts` |
| Create | `packages/lib/tests/component/shared/VirtualRowView.unboundRows.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/tests/component/list/List.test.ts` |
| Modify | `packages/lib/tests/component/container/TabBar.test.ts` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/components/List.md` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

`Body.ts`, `TreeBody.ts`, `MultiSelectList.ts`, `ComboBox.ts`, `Menu.ts`, `Dialog.ts` and the picker files are not edited. The two test files under "Modify" gain cases; no existing case in them changes.

---

## Expected Behaviour

Every numbered case is testable offline unless it is in the *Needs manual verification* table. Offline means the modelled DOM (`installTestDOM`), which has no layout engine and runs no browser default action.

Every value below was read from a run of the cases against a prototype of the change.[^prototype]

### How offline tests get what they need

| Input | Where it comes from offline |
|---|---|
| a key press | `press(el, key, init?)`: a real `keydown` through `DOM.sink.dispatchEvent`, returning how many times `preventDefault` ran. Copied from [`KeyboardRowNavigation.test.ts:82`](../packages/lib/tests/component/shared/KeyboardRowNavigation.test.ts#L82); widen its `Modifiers` type with `altKey`, `metaKey` and `repeat` |
| the clock | `const now = vi.spyOn(Date, 'now')`, then `now.mockReturnValue(ms)` before a press. The existing `List` type-ahead cases do the same. "at 1000" below means that value |
| a tree's geometry | `mountTree(nodes, setup?)` of that file ([:198](../packages/lib/tests/component/shared/KeyboardRowNavigation.test.ts#L198)), copied: tree 200 × 120, row height 24, so five rows fit |
| the scroll position | `(tree as any)._scroller.getScrollY()` |
| the rows | `(tree as any)._flatRows.map(r => r.node.label)` |
| whether a pool row is displayed | `row.isDisplayed()` |

### Coverage of the standard cases

| Situation | Tree type-ahead | Tree `Enter` | Tree `*` | List type-ahead | Tab strip `Home` / `End` |
|---|---|---|---|---|---|
| empty collection | T17 | T17 | T17 | L8 (the guard returns first) | H7 |
| one item | T19 | N7 | X2 | S9 | H3 |
| disabled items | a tree has no disabled node | same | same | L5 | a strip has no disabled tab |
| disabled or read-only widget | a tree has neither state | same | same | L8 | a strip has neither state |
| hidden or collapsed items | T12, T20 | N10 | X8 | a list has none | MV5 (a tab scrolled out of the strip) |
| virtualised rows not yet rendered | T4 | N9 | X5 | a list renders every row | — |
| lazily loaded nodes | T13 | N11 | X1, X7 | — | — |
| multi-selection, no modifier | T15 | N12 | X1 | L4 | — |
| with modifiers | T8, T10 | N5 | X4 | S10 | H5 |
| an editor or field has focus | T14 | T14 | T14 | L9 | H4 |
| right-to-left | the library has no right-to-left mode | same | same | same | same |

L9 is the host-forwarded path a `ComboBox` uses. A list's own `keydown` listener is registered with `Event.addListener`, like the tree's, so a key typed into a control inside a row never reaches it; and `AutoCompleteField` forwards no printable key to its list.

### Part A — pool rows

Fixtures: `Tree` of 60 leaf roots, 200 × 120, mounted as `mountTree` does; and the `TreeBody` fixture of [`KeyboardRowNavigation.test.ts:859`](../packages/lib/tests/component/shared/KeyboardRowNavigation.test.ts#L859) (60 root records, 300 × 100). "Unbound" means `_boundIndices[i] === -1`.

| # | Given | Then |
|---|---|---|
| U1 | the fresh tree | `_rowPool.length` is 11. Eight rows are bound and each `isDisplayed()`. Three are unbound and none `isDisplayed()` |
| U2 | U1, then `setScrollY(240)` and `renderWindow()` | every bound row is displayed, every unbound row is not |
| U3 | the fresh tree-table body | eleven pool rows; eight bound and displayed; three unbound and not displayed |
| U4 | a tree of three roots | `_rowPool.length` is 3; all three bound and displayed |

### The helper — `TypeAheadSearch`

Rows `R5`: labels `Apple`, `Apricot`, `Banana`, `Blueberry`, `Cherry`; every row eligible unless a case says otherwise. Each case uses a new `TypeAheadSearch` and sets the clock.

| # | Calls | Returns |
|---|---|---|
| S1 | the eight rows of the table in *How a match is found*. For each row: a new helper, one `type` call per character of the buffer, the stated current row passed to every call (−1 for "none", 2 for "any") | the last call returns the "Lands on" index: 2, 3, 2, 3, 3, 0, 1, −1 |
| S2 | `type('b')` at 1000 with current −1; `type('c')` at 1700 with current 2 | 2, then −1 (the buffer is `bc`) |
| S3 | `type('b')` at 1000 with current −1; `type('c')` at 1701 with current 2 | 2, then 4 |
| S4 | `type('z')` at 1000; `type('a')` at 1100, current −1 | −1, −1 (the buffer is `za`) |
| S5 | `isEligible` false for row 2; `type('b')`, current −1 | 3 |
| S6 | `count: 0`; `type('a')` | −1 |
| S7 | `type('b')` at 1000, current −1; `clear()`; `type('l')` at 1100 over labels `Apple`, `Banana`, `Blueberry`, `Lemon`, current 1 | 1, then 3 (not 2) |
| S8 | `type('B')`, current −1; and, in a new helper, `type('b')` over the one label `BANANA` | 2; 0 |
| S9 | one row `Apple`, current 0; `type('a')` | 0 |
| S10 | `isTypeAheadKey` for `{key:'a'}`, `{key:'A', shiftKey:true}`, `{key:'*'}`, `{key:'?'}` | `true` each |
| | and for `{key:' '}`, `{key:'Enter'}`, `{key:'ArrowDown'}`, `{key:'Dead'}`, `{key:'a', ctrlKey:true}`, `{key:'a', metaKey:true}`, `{key:'a', altKey:true}` | `false` each |

### Part B — `List`

`LIST4`: items `Apple`, `Banana`, `Blueberry`, `Cherry`. L1–L5 use `new TestList({ items })` and its `typeAhead(ch)` seam. L6–L9 mount a `_List` (element, connected, 200 × 200, focused) and use `press`.

| # | Given | Then |
|---|---|---|
| L1 | `LIST4`; `b` at 1000, 1100, 1200 | `getFocusedIndex()` 1, 2, 1 |
| L2 | `LIST4`; `setFocusedIndex(3)`; `b` at 1000 | 1 |
| L3 | `LIST4`; `setFocusedIndex(1)`; `b` at 1000 | 2 |
| L4 | `LIST4`; `setSelectedIndex(0, false)`; `c` at 1000, `h` at 1100 | focused 3, 3; `getSelectedIndex()` stays 0 |
| L5 | items `Apple` (`enabled: false`), `Avocado`, `Apricot`; `a` at 1000, 1100 | 1, 2 — the disabled row is never landed on |
| L6 | mounted `LIST4`; `press(el, 'b')` | returns 1; focused 1; `getSelectedIndex()` −1 |
| L7 | mounted `Apple`, `Banana`, `Blueberry`, `Lemon`; `b` at 1000; `Escape`; `l` at 1100 | `Escape` returns 0; focused 1, then 3 |
| L8 | mounted `LIST4` with `readOnly: true`; `press(el, 'b')`. And a mounted list with no items | returns 0; focused −1, both times — the guard at the top of the handler is not edited |
| L9 | mounted `LIST4`; `list.handleKey` with `{ key: 'b' }`, then with `{ key: 'b', ctrlKey: true }` | `true`, then `false` |

### Part C — tree type-ahead

`FRUIT`: 17 leaf roots, in this order — `Apple`, `Apricot`, `Banana`, `Blueberry`, `Cherry`, `Date`, `Elderberry`, `Fig`, `Grape`, `Honeydew`, `Kiwi`, `Lemon`, `Mango`, `Nectarine`, `Orange`, `Papaya`, `Aardvark`. Each case starts from a fresh tree with no current row unless it names another case.

| # | Given | Then |
|---|---|---|
| T1 | `b` at 1000 | `press` returns 1. Current row `Banana`; selection [`Banana`]; `scrollY` 0; one `"selection"` event; `tree.getAria().getActiveDescendant()` equals `(tree as any)._focusPoolRow().getId()` |
| T2 | T1; `b` at 1100; `b` at 1200 | `Blueberry`, then `Banana` |
| T3 | `b` at 1000; `l` at 1100 | `Banana`, then `Blueberry` |
| T4 | `m` at 1000 | `Mango` (row 12); `scrollY` 192, which is 13 × 24 − 120 |
| T5 | `b` at 1000; `c` at 1700; `c` at 2401 | `Banana`; `Banana`; `Cherry` |
| T6 | `z` at 1000; `a` at 1100 | each press returns 1; no current row; no `"selection"` event |
| T7 | `a` at 3000, 3100, 3200, 3300 | `Apple`, `Apricot`, `Aardvark`, `Apple`; `scrollY` 0, 0, 288, 0 |
| T8 | `B` with `shiftKey` | `Banana` |
| T9 | T8; Space | returns 0; current row still `Banana` |
| T10 | T8; `c` with `ctrlKey`; with `altKey`; with `metaKey` | each returns 0; current row still `Banana` |
| T11 | `b` at 1000; `Escape`; `l` at 1100 | `Escape` returns 0; `Banana`, then `Lemon` |
| T12 | nodes `Alpha` (child `Zed`), `Lazy`, `Beta`, all collapsed; `z` at 1000. Then `tree.expandNode(Alpha)`, `renderWindow()`, `z` at 3000 | no current row; then `Zed` |
| T13 | T12's nodes, where `Lazy` is `{ hasChildren: true, loadChildren: spy }`; `x` at 1000 | no current row; the spy was not called |
| T14 | `FRUIT`; `press(rowEl, 'b')` where `rowEl` is `(tree as any)._rowPool[0].getElement()` | returns 0; no current row |
| T15 | `ArrowDown`, `Shift+ArrowDown` ×2 (selection `Apple`–`Banana`); `c` | selection [`Cherry`]; `getSelectedNode()` is `Cherry` |
| T16 | tree added to a `Container` with `Event.addSubtreeListener(parent, 'keydown', spy)`; `b` | returns 1; the spy ran once with key `b`. Remove the listener inside the test |
| T17 | `mountTree([])`; `b`, `Enter`, `*` | each returns 0 |
| T18 | `vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true)`; `d` | returns 0; no current row |
| T19 | one root `Apple`; `ArrowDown`; `a` | `a` returns 1; current row `Apple`; one `"selection"` event in all |
| T20 | N10's state (the current row is hidden under a collapsed node); `b` at 1000 | current row `B`: with no current row among the visible rows the search starts at the first row |

### Part C — `Enter`

`FAM`: roots `A` (children `a0`, `a1`) and `B`. Listeners on `"dblclick"`, `"selection"`, `"expand"` and `"collapse"` are spies.

| # | Given | Then |
|---|---|---|
| N1 | `FAM`; `ArrowDown`; `Enter` | `Enter` returns 1. `"dblclick"` once, with `A`. Rows `A`, `a0`, `a1`, `B`. `"expand"` once. `"selection"` once in all, from `ArrowDown` |
| N2 | N1; `Enter` | `"dblclick"` twice in all; `"collapse"` once; rows `A`, `B` |
| N3 | `FAM`, no current row; `Enter` | returns 1; no `"dblclick"` |
| N4 | → T17 (empty tree) | |
| N5 | `FAM`; `ArrowDown`; `Enter` with `ctrlKey`; with `altKey`; with `metaKey`; with `shiftKey` | each returns 0; no `"dblclick"` |
| N6 | `FAM`; `ArrowDown`; `Enter` with `repeat: true` | returns 1; no `"dblclick"`; rows `A`, `B` |
| N7 | `FAM`; `ArrowDown` ×2 (`B`); `Enter`. And a one-root tree `B`: `ArrowDown`, `Enter` | `"dblclick"` once with `B`; no `"expand"`, no `"collapse"` — both times |
| N8 | `FAM` built with `{ expandTrigger: 'click' }`; `ArrowDown`; `Enter` | rows `A`, `a0`, `a1`, `B` |
| N9 | 60 roots `Node 0`…`Node 59`; `ArrowDown`; `(tree as any).setScrollY(600)`; `Enter` | `scrollY` 0; `"dblclick"` with `Node 0` |
| N10 | roots `A` (child `a0`) and `B`, `A` expanded; `ArrowDown` ×2 (`a0`); `(tree as any)._onToggle(A)`; `Enter` | returns 1; no `"dblclick"` |
| N11 | one root `L` = `{ hasChildren: true, loadChildren: spy }` resolving to [`kid`]; `ArrowDown`; `Enter`; then await three microtasks | `"dblclick"` once; the spy called once; rows `L`, `kid` |
| N12 | roots `P`, `Q`; a `Ctrl`-click on `Q` twice (current row `Q`, nothing selected); `Enter` | `"dblclick"` with `Q`; `getSelectedNodes()` is empty |
| N13 | T16's container; `ArrowDown`; `Enter` | the spy's last call has key `Enter`; `Enter` returns 1 |

### Part C — `*`

`SIB`: roots `A` (children `a0` — which has a child `deep` — and `a1`), `B` (child `b0`), `C`, `D` = `{ hasChildren: true, loadChildren: spy }`, `E` (child `e0`). Mounted 240 px high with `E` expanded.

| # | Given | Then |
|---|---|---|
| X1 | `SIB`; `ArrowDown` ×2 (`B`); `*` | returns 1. Rows `A`, `a0`, `a1`, `B`, `b0`, `C`, `D`, `E`, `e0`. `"expand"` twice, with `A` then `B`. Current row `B`; selection [`B`]; `"selection"` twice in all, from the arrows. The spy was not called. `getActiveDescendant()` equals the focus pool row's id |
| X2 | X1; `*`. And a one-root tree `C`: `ArrowDown`, `*` | returns 1; no further `"expand"` — both times |
| X3 | X1; `ArrowUp` ×2 (`a0`); `*` | rows `A`, `a0`, `deep`, `a1`, `B`, `b0`, `C`, `D`, `E`, `e0` |
| X4 | X1; `*` with `ctrlKey` | returns 0 |
| X5 | ten roots `P0`…`P9`, each with three children, 120 px high; `ArrowDown` ×10 (`P9`, `scrollY` 120); `*` | `P9` is row 36; `scrollY` 768, which is 37 × 24 − 120; current row `P9` |
| X6 | roots `*Star`, `Other`, no current row; `*` | returns 1; no current row |
| X7 | roots `D` (lazy, resolving to [`d0`]) and `Q` (child `q0`); `await tree.expandNodeAsync(D)`; `(tree as any)._onToggle(D)`; `End` (`Q`); `*` | rows `D`, `d0`, `Q`, `q0`; the spy called once in all |
| X8 | N10's state (the current row is hidden); `*` | returns 1; no `"expand"` |
| X9 | `SIB`, no current row; `*` | returns 1; no `"expand"`; rows unchanged |

Between step 5 and step 7, `*` is an ordinary type-ahead character: in X6 it lands on `*Star`. Step 7 is what makes X6 pass.

### Part D — tab strip

`BAR3`: `new TabBar()` with `createBarEntry('a', 'Alpha')`, `createBarEntry('b', 'Beta', closeable())`, `createBarEntry('c', 'Gamma')`, then `bar.getElement(true)`; a `"tabpressed"` listener records ids. Keys are passed as `(bar as any).onToolbarKeyDown({ key } as KeyboardEvent)`, as the file's other cases do. `a` is active by construction.

| # | Given | Then |
|---|---|---|
| H1 | `BAR3`; focus `b`'s tab button; `End` | returns `{ prevent: true }`; active `c`; recorded [`c`]; DOM focus is on `c`'s tab button |
| H2 | H1; `Home` | returns `{ prevent: true }`; active `a`; recorded [`c`, `a`] |
| H3 | H1; `End` again. And a one-entry bar with its tab focused: `Home`, `End` | `{ prevent: true }` each time; nothing more recorded |
| H4 | `BAR3`, nothing focused; `End`. Then `bar.addTool(new Button({ text: 'Tool' }))`, render and focus the tool; `Home` | `undefined` both times; active stays `a` |
| H5 | `BAR3`; focus `b`; `End` with `ctrlKey`; `altKey`; `metaKey`; `shiftKey` | `undefined` each; active stays `a` |
| H6 | `BAR3`; focus `b`'s ✕ (`entries[1].closeButton.focus()`); `End` | active `c`; DOM focus is on `c`'s tab button |
| H7 | `new TabBar()` with no entries, rendered; `Home` | `undefined` |
| H8 | `BAR3`; focus `c`; `claimsKey` mocked `true`; `Home` | `undefined`; active stays `a` |

### Needs manual verification

On the demo app (`npm run dev`), in Chromium unless a row names Firefox. These check what the modelled DOM cannot: the browser's default action, real focus, paint, and the accessibility tree.

| # | Where | Do | Expect |
|---|---|---|---|
| MV1 | `#/misc` → "Show large tree (variable-width rows)" | click a row; type the first letter of a label that is out of view; type it again twice | the tree jumps to the next row that starts with the letter, selected and fully visible; each repeat steps to the next; nothing behind the window scrolls |
| MV2 | same | type two different letters quickly; wait a second; type one letter | the first lands on a row that starts with both letters; the later letter starts a new search |
| MV3 | same | on a parent row press `Enter` twice; hold `Enter` | the row expands, then collapses, animated; holding does not flicker it open and shut |
| MV4 | same | on a row with collapsed siblings press `*` | every sibling with children opens at once; the current row stays in view and selected |
| MV5 | `#/tab`, a strip with more tabs than fit (narrow the window if none overflows) | focus a tab; `End`; `Home`. Then focus a strip tool; `Home` | the last, then the first tab is activated and scrolled into view; from the tool nothing happens to the tabs |
| MV6 | `#/misc`, large tree, and "Show window with tree table!" | take an accessibility snapshot before pressing a key | no empty `treeitem` and no empty `row`; scrolling the tree with the wheel shows no blank row and no hitch |
| MV7 | Firefox, any demo tree | focus the tree; press `/`, then `'` | Firefox's quick-find bar does not open |
| MV8 | a `Dialog` whose content is a `Tree` and which has a primary button — build one in the browser console if no demo has it | select a row; `Enter` | the dialog confirms, and a `"dblclick"` listener on the tree also ran. This is decision 1's known overlap, not a fault |
| MV9 | `#/multiselect` | focus a list; type a letter several rows start with, three times | the focus mark steps through those rows and wraps; the selection does not change; the page behind does not scroll |
| MV10 | optional: SQLAdmin against `npm run build:lib` | in the database navigator press `Enter` on a table; type a table's first letters; press `?` | the table opens as on a double-click; the navigator jumps to the table; the shortcuts dialog still opens |

---

## Verification

Harness for `KeyboardRowActions.test.ts`, copied from [`KeyboardRowNavigation.test.ts:26–118`](../packages/lib/tests/component/shared/KeyboardRowNavigation.test.ts#L26):

- Node environment. The same `CONFIG`, the `built` array, `track()` and `press()`.
- `beforeEach`: `installTestDOM(CONFIG)`, `built = []`.
- `afterEach`: `vi.restoreAllMocks()`, dispose every tracked component, `Menu._stopInputWatch()`, `Tooltip._stopPointerWatch()`, then `DOM.reset()`. A `Tree` or a `List` starts `Menu`'s input watch when it is built, and a registration left behind makes the next test's dispatches vanish.
- `vi.restoreAllMocks()` also restores `Date.now`, so every case that uses the clock sets it itself.
- In T16 and N13 track the parent `Container`, not the tree.

`VirtualRowView.unboundRows.test.ts` uses the simpler setup of [`VirtualRowView.poolDisposal.test.ts`](../packages/lib/tests/component/shared/VirtualRowView.poolDisposal.test.ts#L20) and disposes what it builds. `TypeAheadSearch.test.ts` needs no DOM: it imports the helper and `vi`.

Commands, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. `cd packages/lib && npx vitest run tests/component/shared tests/component/tree tests/component/list tests/component/table tests/component/container tests/component/input tests/layout`
4. `npm test` — the whole suite.
5. `npm run lint`
6. `npm run build:lib`, `npm run docs:api`, `npm run docs:llms:check`
7. `npm -w packages/docs run test` — it needs the two builds of item 6 first.
8. The MV cases.

Grep checks: those of steps 3, 4 and 9.

---

## Documentation Impact

**Exports.** None. No barrel, API page or `llms.txt` entry changes; `docs:llms:check` confirms it.

**Catalogue.** `plans/dom-only-state-inventory.md` needs no entry: the type-ahead buffer is in memory, and no listener is added.

**JSDoc.** The edits named in steps 5–8, plus this replacement for the JSDoc of `on("dblclick")` in `Tree.ts`:

```typescript
    /**
     * Registers a listener for a node being activated.
     *
     * @param event - `"dblclick"` fires when a node's row is double-clicked,
     *   and when `Enter` is pressed while the tree has focus and a current
     *   row; the listener receives the {@link TreeNode}. The first click of a
     *   double-click still emits `"selection"` as usual, and `Enter` leaves
     *   the selection as it is, so `"dblclick"` is an activation signal
     *   layered on top of selection — consumers typically use `"selection"`
     *   to preview a node and `"dblclick"` to open it.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This tree, for method chaining.
     */
```

### `docs/components/Tree.md`

In [`## Keyboard`](../packages/lib/docs/components/Tree.md#L133), insert three rows after the `PageUp` / `PageDown` row (line 143):

```markdown
| `Enter` | Activate the current row: fire `"dblclick"` for its node, as a double-click on the row does, then expand or collapse it when it has children. Holding the key activates once. |
| Printable character | Type-ahead: move to the next visible row whose label starts with what was typed, and select it. Typing one letter again steps through the rows that start with it. The buffer starts again after a 700 ms pause, or on `Escape`. |
| `*` | Expand every sibling of the current row, itself included, whose children are already loaded. |
```

Add two paragraphs after the paragraph that begins "A key that moves the current row" (line 148):

```markdown
Type-ahead searches the rows that are visible — every expanded row, scrolled into view or not — by each node's `label`, whatever a custom renderer draws. It never expands a node and never loads a lazy one. `Shift` types capitals; a key pressed with `Ctrl`, `Alt` or `Meta` is not type-ahead, and neither is `Space`. `*` likewise skips a lazy node that has not loaded, and fires `"expand"` once for each node it opens.

`Enter`, `*` and a type-ahead character are the tree's own keys: the browser's default does not run, and a `keydown` listener on an ancestor still receives them. `Enter` with a modifier is left alone. In a modal [`Dialog`](/components/Dialog) with a primary button, `Enter` also confirms the dialog, as it does from any control that is not a button, a text area or an editor.
```

In [`## Common methods`](../packages/lib/docs/components/Tree.md#L174), insert after the `on("selection", fn)` row:

```markdown
| `on("dblclick", fn)` | Subscribe to a node being activated: a double-click on its row, or `Enter` on the current row. |
```

In [`## Expansion state`](../packages/lib/docs/components/Tree.md#L80), in the first sentence, replace "a caret click, `ArrowRight` / `ArrowLeft`, a double-click on a parent row, or a programmatic" with "a caret click, `ArrowRight` / `ArrowLeft`, `Enter` or a double-click on a parent row, `*`, or a programmatic".

In `### Animation`, in the first sentence, insert "`Enter`, " after "a row-click toggle, ". In the sentence that begins "The bulk and structural calls", insert "the `*` key, " before "`expandAll()`".

### `docs/components/List.md` — [`## Keyboard`](../packages/lib/docs/components/List.md#L30)

Replace the "Printable character" row (line 41) with:

```markdown
| Printable character | Type-ahead — focus the next row after the focused one whose label starts with what was typed. Typing one letter again steps through the rows that start with it. The buffer resets after a 700ms pause. |
```

### `docs/layouts/Tab.md` — [`## Selecting a tab`](../packages/lib/docs/layouts/Tab.md#L117)

Append one paragraph to the section:

```markdown
From the keyboard, with a tab focused: `ArrowLeft` / `ArrowRight` activate the previous / next tab, wrapping at the ends, and `Home` / `End` activate the first / last tab. `Home` and `End` act only while a tab or its ✕ holds focus, so a text field among the [tab tools](#tab-tools) keeps them for its caret.
```

### `docs/concepts/accessibility.md` — [`## Keys in trees, lists and tables`](../packages/lib/docs/concepts/accessibility.md#L248)

Only this section is edited.[^a11y-tab-paragraph] Replace the `Enter` / `Space` and "Printable character" rows (lines 258–259) with three rows:

```markdown
| `Enter` / `Space` | `Enter`: activate the current row | select the focused row | edit the current cell | edit the current cell |
| Printable character | type-ahead: selects the row | type-ahead: moves the focus mark | — | — |
| `*` | expand the current row's siblings | — | — | — |
```

Append to the last paragraph of the section (line 264):

```markdown
 `Enter`, `*` and a type-ahead character in a `Tree`, and a type-ahead character in a list, follow the same rule: prevented, never stopped.
```

### `docs/reference/changelog/next.md`

Append one entry at the end of `## Changed` → `### Components` (before `### Core`, line 141):

- **`List` type-ahead moves to the next match and steps on a repeated letter.** Say that a letter used to focus the first row from the top whose label starts with the buffer, so a repeated letter did nothing; that it now focuses the next matching row after the focused one, wrapping, and that typing the same letter again steps through the matches; that several different letters still match as a prefix, now starting from the focused row; that the key is now prevented on the list's own element, as it already was in an open `ComboBox`; and that `MultiSelectList` and the `ComboBox` dropdown change with it. Say that the `protected` fields `_typeAheadBuf` and `_typeAheadAt` of `AbstractSelectableList` are gone. End with "No consumer action is needed unless a subclass read those two fields."

Append five entries at the end of `## Fixed` → `### Components` (before `### Core`, line 564):[^fixed-not-added]

- **`Enter` activates the current `Tree` row.** Say that the tree's activation event, `"dblclick"`, fired only for a double-click, so "open" was out of reach from the keyboard; that `Enter` on the current row now fires it and then toggles an expandable node, as a double-click on the row does; that a held key activates once; and that `Enter` with a modifier is left alone. One behaviour changes: a `"dblclick"` listener now also runs for `Enter`, and in a modal `Dialog` with a primary button the dialog is confirmed as well. End with "No consumer action is needed unless a `keydown` handler of your own already opens the node on `Enter`: remove it, or it opens the node twice."
- **A `Tree` has type-ahead.** Say that typing the first letters of a label moves to the next visible row that starts with them, selects it and scrolls it into view; that the same letter typed again steps through the matches; that only visible rows are searched and nothing is expanded or loaded; and that the keys are prevented, not stopped. End with "No consumer action is needed."
- **`*` expands a `Tree` row's siblings.** Say that it opens every sibling of the current row whose children are already loaded, fires `"expand"` for each, and never starts a lazy load. End with "No consumer action is needed."
- **`Home` / `End` activate the first / last tab of a `Tab` strip.** Say that they act while a tab or its ✕ holds focus, and that a strip tool keeps the keys. End with "No consumer action is needed."
- **A `Tree`, `Table` or `TreeTable` no longer holds empty rows.** Say that a view with more rows than fit kept three spare pool rows displayed and unbound — empty `treeitem` or `row` elements a screen reader could reach; and that a spare row is now hidden until it shows data. End with "No consumer action is needed."

---

## Potential Challenges

- **`feature/nested-scroll-reveal` changes the signature of `_selectAtIndex`.** If it merges after this plan, `tsc` fails on the one call in `_typeAheadTo`. Pass `true` as the second argument there; nothing else needs an edit.
- **Line numbers move if `feature/spatial-navigation-redesign` merges first.** It adds eight lines near the top of `Tree.ts`. Find every symbol by name.
- **A real-event test that leaks a listener breaks the next test silently.** Use the teardown in `## Verification` exactly, and remove the subtree listener of T16 and N13 inside the test.
- **An untracked `List` or `Tree` in `KeyboardRowActions.test.ts` makes later key presses vanish.** Wrap every one in `track()`, the lists of L6–L9 included. `List.test.ts` builds lists without disposing them, which is safe there only because that file dispatches no real event.
- **The type-ahead buffer outlives a test's clock.** Each case builds its own widget, so no buffer is shared; do not reuse a tree across `it` blocks.
- **`_typeAhead` needs a real instance, and a field initializer runs after `super()`.** That is safe for both classes: only a key press writes it, and no key arrives during construction. Do not move the write into `applyOptions`.
- **A `"dblclick"` listener may change the tree.** `_activateCurrentNode` emits first and toggles second, exactly as `_handleDblClick` does, and adds no guard of its own.
- **A character typed with `AltGr` is not type-ahead.** Browsers on Windows report `AltGr` as `Ctrl+Alt`, and the helper's test refuses that chord, as the list's test always has. Labels that start with `@`, `{` or `[` cannot be reached on such layouts; the arrow keys reach them.
- **Hiding a spare pool row moves no cost that matters.** The row's element is still created up front. A row that scrolls out of the window is already hidden and shown again by `hideExcessPoolRows` and `positionRow`, so a new row takes a path every recycled row takes. MV6 checks that scrolling shows no hitch.
- **`accessibility.md` and `changelog/next.md` are edited by other unmerged work.** Keep both sides in a merge.

---

## Critical Files

- [`component/tree/Tree.ts`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L1920) — `_onKeyDown` (:1920), its `claimsKey` guard (:1921) and `navigable` line (:1923); `_selectAtIndex` (:1819); `_revealFocusRow` (:2141); `_handleDblClick` (:2172); `_handleContextMenu` (:2109), **the precedent for a key that fires an existing pointer event**; `expandAll` (:578), **the precedent for `*`**; `_locate` (:1279); `_isExpandable` (:1142); `_onToggle` (:1500); `_reflattenAndRender` (:1189); the fields (:231–285); the `keydown` registration (:2524); the JSDoc of `on("dblclick")` (:1002).
- [`component/list/AbstractSelectableList.ts`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2295) — `handleTypeAhead` (:2295), **the type-ahead the helper is lifted from**; `TYPE_AHEAD_TIMEOUT_MS` (:100); the two fields (:811–814); `handleKey` (:2032); `handleKeyDown` (:2077); `setFocusedIndex` (:1990).
- [`component/shared/reduceModifierSelection.ts`](../packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts#L31) — read only: **the precedent for an internal helper in `component/shared` that two data views share**.
- [`component/shared/VirtualRowView.ts`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L303) — `growRowPool` (:303); `computePoolTarget` (:271); `positionRow` (:479); `hideExcessPoolRows` (:509); `scrollRowIntoView` (:1125), read only.
- [`component/container/TabBar.ts`](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L3463) — `onToolbarKeyDown` (:3463); `closeFocusedEntry` (:1812); `entryIndexForElement` (:1721); `setActiveEntry` (:2045); `onTabPressed` (:2196).
- [`overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1567) — read only: `onPanelKeyDown`, the precedent for leaving `Ctrl` / `Alt` / `Meta` chords alone (:1568–1573) and for ignoring `Enter`'s auto-repeat (:1606–1614).
- [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1410) — read only: `onEnter`, which confirms the primary button whatever control has focus.
- [`tests/component/shared/KeyboardRowNavigation.test.ts`](../packages/lib/tests/component/shared/KeyboardRowNavigation.test.ts#L26) — the harness, `press` (:82) and `mountTree` (:198) the new test file copies.
- [`tests/component/list/List.test.ts`](../packages/lib/tests/component/list/List.test.ts#L340) — the `TestList` seam (:12) and the clock idiom (:340).
- [`tests/component/container/TabBar.test.ts`](../packages/lib/tests/component/container/TabBar.test.ts#L136) — `threeEntryBar` (:49), `barEntries` (:44) and the direct-call idiom.
- [`plans/implemented/tree-page-keys.md`](implemented/tree-page-keys.md) — the survey this plan redoes, and the prevented-not-stopped rule.
- `ARCHITECTURE.md`, *Event handling* — a listener states its disposition by return value; a component listens on itself only.

---

## Non-Goals

Each item is a gap the survey found. The evidence is given so the decision can be made later without repeating the survey.

- **`TreeTable`: `ArrowLeft` / `ArrowRight` between cells.** With a current row the two keys act on the tree and never move the current cell; `Tab` / `Shift+Tab` do that. Every design that adds cell movement changes what an arrow key does today. The three designs and what each changes are in [the second addendum](#addendum-treetable-arrow-keys--three-models).
- **Keys in the time picker's columns.** The hour, minute and second columns of `TimeField` and `DateTimeField` handle no key: `TimePickerDropdown` does not override `AnimatedDropdown.handleKey`, a `PickerCell` is a `Text` with a click listener, no role and no focus, and the columns have no highlight that differs from the selected value. The field's text input is the keyboard path and takes a typed time. Giving the columns keys needs a highlight state, roles, `aria-activedescendant` on the input, and a rule for which keys the open dropdown takes from the input's caret. No ARIA pattern describes time columns.
- **Folding `Tree`'s selection ladder into `reduceModifierSelection`, and splitting `Tree._onKeyDown`.** See decision 7.
- **Moving a tree's current row without selecting it: `Ctrl`+arrow, `Space` / `Ctrl+Space`, `Ctrl+A`.** `Ctrl+ArrowDown` is a plain `ArrowDown` today, so adopting the list's model changes an existing key. `Space` in a tree stays unhandled.
- **`Alt`, `Ctrl` and `Meta` chords on the existing navigation keys.** `Tree`, `List` and the table body still act on `Alt+ArrowDown`. The keys this plan adds leave such chords alone; a rule for the old keys is its own change.
- **A current row hidden by a collapse.** Collapsing a node from its caret leaves the current row on a hidden child. This plan defines what the new keys do in that state (N10, X8 and T20) and does not move the current row to the collapsed parent.
- **`Dialog` confirming on `Enter` while a list, table or tree has focus.** `Dialog.onEnter` stands down only for a text area, a button and a `contenteditable` host. A `List` and a `Table` body already share `Enter` with the dialog; a `Tree` now does too.
- **`Table`: `Home` / `End` within the row, `Ctrl+Home` / `Ctrl+End`, `Shift`+arrow, `Ctrl+A`, type-ahead.** Unchanged since `tree-page-keys`; a table has two selections, rows and a cell range, and which one `Shift` extends is undecided.
- **`ArrowUp` / `ArrowDown` and `aria-orientation` on a west or east tab strip.** The strip steps with `ArrowLeft` / `ArrowRight` on every side.
- **`ArrowLeft` / `ArrowRight` from a strip tool.** With focus on a tool the two keys step from the active tab, and they would take the caret keys from a text-entry tool. An existing test pins the fallback. `Home` and `End` do not copy it.
- **`Home` / `End` in a `ToolBar` or a `ButtonGroup`.** `RovingTabIndex` has no first-enabled or last-enabled move.
- **`Menu` type-ahead; `Home` / `End` in a host-driven dropdown menu.** Both are optional in the pattern.
- **`MenuBar` keys while no menu is open, and `Home` / `End` while one is.** The bar listens for keys only while a menu is open.
- **`ComboBox` while closed: type-ahead, `Home` / `End`, `Alt+ArrowDown`.** Closed, it opens on `ArrowDown`, `ArrowUp`, `Enter` and `Space` and ignores every other key.
- **The calendar's `Home` / `End`.** They go to the first and last day of the month; the date-picker pattern uses them for the first and last day of the week.
- **`NumberSpinner`: `PageUp` / `PageDown`, `Home` / `End`.** It handles `ArrowUp`, `ArrowDown` and `Enter`.
- **`Enter` as activation in a `List`.** A list has a `"dblclick"` event too, and `Enter` commits the focused row instead of firing it. SQLAdmin's saved-queries list bridges the two with its own `keydown` listener.
- **The demo app, the docs app and SQLAdmin.** None needs a change.

---

## Addendum: Keyboard survey

Method: each widget's key handler was read at `59a5c2e27`. Entries marked *probed* were also run offline with real `keydown` events. "Pattern" is the WAI-ARIA Authoring Practices pattern for the widget's role.

### `Tree` — role `tree`, always `aria-multiselectable`

| Key | Pattern | Today | This plan |
|---|---|---|---|
| `ArrowUp` / `ArrowDown`, `ArrowLeft` / `ArrowRight`, `Home` / `End`, with `Shift` to extend | tree | yes | — |
| `PageUp` / `PageDown` | library convention | yes, since `tree-page-keys` | — |
| `Shift+F10` / ContextMenu key | — | yes | — |
| `Enter` | activate | ignored, not prevented (probed) | added |
| Type-ahead | recommended | ignored, not prevented (probed) | added |
| `*` | optional | ignored (probed) | added |
| `Ctrl`+arrow, `Space`, `Ctrl+Space`, `Ctrl+A` | multi-select | `Ctrl+ArrowDown` acts as `ArrowDown`; `Space` ignored (probed) | Non-Goal |

### `TreeTable` — role `treegrid`

| Key | Pattern | Today | This plan |
|---|---|---|---|
| row keys, paging, `Enter` / `Space` to edit, `Tab` / `Shift+Tab` along the row, `Shift+F10` | treegrid | yes, inherited from the table body | — |
| `ArrowLeft` / `ArrowRight` on a branch, or to the parent / first child | treegrid | yes | — |
| `ArrowLeft` / `ArrowRight` between cells | treegrid | no: consumed by the tree, or a dead key | Non-Goal; second addendum |

### `Table` body — role `grid`

| Key | Pattern | Today | This plan |
|---|---|---|---|
| four arrows, paging, `Enter`, `Space`, `Tab`, copy / cut / paste, `Shift+F10` | grid | yes | — |
| `Home` / `End` | first / last cell of the row | first / last row, as documented | Non-Goal |
| `Ctrl+Home` / `Ctrl+End`, `Shift`+arrow, `Ctrl+A` | grid, optional | no | Non-Goal |

### `List`, `MultiSelectList`, the `ComboBox` dropdown — role `listbox`

| Key | Pattern | Today | This plan |
|---|---|---|---|
| `ArrowUp` / `ArrowDown`, `Home` / `End`, `PageUp` / `PageDown`, `Enter` / `Space`, `Ctrl` to move without selecting, `Shift` / `Ctrl` / `Ctrl+A` in a `MultiSelectList`, `Shift+F10` | listbox | yes | — |
| Type-ahead | recommended | first match from the top; a repeated letter does nothing; not prevented on the list's own element (probed) | next match, stepping, prevented |

### `ComboBox` — role `combobox`

| Key | Pattern | Today | This plan |
|---|---|---|---|
| closed: `ArrowDown` / `ArrowUp` / `Enter` / `Space` open | select-only combobox | yes | — |
| open: every list key, `Escape` | combobox | yes, forwarded to the list | type-ahead changes with the list |
| closed: type-ahead, `Home` / `End`, `Alt+ArrowDown` | combobox | no | Non-Goal |

### `AutoCompleteField` — role `combobox`

| Key | Pattern | Today | This plan |
|---|---|---|---|
| `ArrowDown` (query or next), `ArrowUp`, `Enter`, `Escape`, `Tab` | combobox with list autocomplete | yes; printable keys, `Home` and `End` stay with the text field | — |

### Tab strip — role `tablist`

| Key | Pattern | Today | This plan |
|---|---|---|---|
| `ArrowLeft` / `ArrowRight`, wrapping and activating | tabs | yes | — |
| `Delete` on a closeable tab | optional | yes | — |
| `Home` / `End` | optional | no | added, from a tab only |
| `ArrowUp` / `ArrowDown` and `aria-orientation` on a vertical strip | tabs, vertical | no | Non-Goal |

### `Menu` and `MenuBar` — roles `menu`, `menubar`

| Key | Pattern | Today | This plan |
|---|---|---|---|
| keyboard-opened menu: `↑` / `↓`, `Home` / `End`, `←` / `→`, `Enter` / `Space`, `Tab`, `Escape` | menu | yes | — |
| host-driven dropdown menu: `↑` / `↓`, `Enter` / `Space` | menu | yes | — |
| type-ahead; `Home` / `End` when host-driven | optional | no | Non-Goal |
| `MenuBar` with a menu open: `←` / `→`, `↑` / `↓`, `Enter`, `Escape` | menubar | yes | — |
| `MenuBar` with no menu open; `Home` / `End` | menubar | no | Non-Goal |

### Pickers

| Widget | Pattern | Today | This plan |
|---|---|---|---|
| calendar day grid: arrows, `PageUp` / `PageDown` by month, `Enter` / `Space` | date-picker dialog | yes | — |
| calendar: `Home` / `End` | first / last day of the week | first / last day of the month | Non-Goal |
| year scroller: arrows, paging, `Home` / `End`, digits with an 800 ms buffer | none | yes | — |
| time columns | none fits | no key at all | Non-Goal |

### Other widgets with their own keys

| Widget | Today | Gap | This plan |
|---|---|---|---|
| Accordion headers | `ArrowUp` / `ArrowDown` wrapping, `Home` / `End`, `Enter` / `Space` | none | — |
| `ToolBar` | the two arrows of its orientation, wrapping; stands down in a text-entry child | `Home` / `End` (optional) | Non-Goal |
| `ButtonGroup` | four arrows | none in the radio-group pattern | — |
| `Slider` | four arrows, `PageUp` / `PageDown`, `Home` / `End` | none | — |
| `NumberSpinner` | `ArrowUp` / `ArrowDown`, `Enter` | `PageUp` / `PageDown`, `Home` / `End` | Non-Goal |
| `SplitButton` | `ArrowLeft` / `ArrowRight` / `Tab` between its halves | none | — |

---

## Addendum: TreeTable arrow keys — three models

A `TreeTable` with a current row has a current cell: `Body` keeps its column in `_focusedColIndex`, draws a ring on the cell and points `aria-activedescendant` at it. `Tab` / `Shift+Tab` move it along the row. The tree column is a named field ([`TreeBody._treeColumn`](../packages/lib/src/typescript/lib/component/table/TreeBody.ts#L117)) and need not be the first visible column.

What `ArrowLeft` / `ArrowRight` do today, with a current row, in every column:

| Row | `ArrowRight` | `ArrowLeft` |
|---|---|---|
| collapsed branch | expand | to the parent; nothing at the top level |
| expanded branch | to the first child | collapse |
| leaf | nothing | to the parent; nothing at the top level |

| Model | Rule | What it changes | Fault |
|---|---|---|---|
| 1. Fill the dead keys | where the tree has no use for the key, move one cell | `ArrowRight` on a leaf; `ArrowLeft` on a top-level leaf or collapsed branch | on a leaf, `ArrowRight` moves a cell and the next `ArrowLeft` jumps to the parent row instead of moving back. Branch rows never move by cell. This is what `TreeTable.md` once claimed |
| 2. Expansion first, in every column | `ArrowRight`: expand, else next cell. `ArrowLeft`: collapse, else previous cell, else parent | `ArrowRight` on an expanded branch moves a cell, not to the first child; `ArrowLeft` on a child moves a cell before it reaches the parent | `ArrowLeft` in the third column of an expanded branch collapses it; the user wanted the second column |
| 3. The tree column is the row | in the tree column the keys act on the tree, and move a cell where the tree has no use for them; in every other column they move a cell | in the tree column, `ArrowRight` on an expanded branch or a leaf moves a cell. In every other column the two keys no longer expand, collapse or move to a parent | the closest to the treegrid pattern; a mouse user who clicks a cell outside the tree column and presses `ArrowRight` to expand the row gets a cell move |

Model 3 is the one to take if the arrows are to follow the pattern, with the body's first current cell placed on the tree column. It is a behaviour change for every `TreeTable` user and is the user's call.

---

## Notes

[^enter-dblclick]: Two designs were possible. The other adds a new event, `"activate"`, fired by both gestures, and leaves `"dblclick"` to the mouse. It gives a truer name, and it leaves every existing consumer where it is: SQLAdmin's `NavigatorTree` and `RolesTree` open a node from `"dblclick"` alone, so they would stay closed to the keyboard until each was edited, and two overlapping events would remain for good. The stack already made this choice once: `table-tree-keyboard-context-menu` fires `"contextmenu"` for `Shift+F10` with a synthetic event, and `Tree.md` says "the same listener serves the mouse and the keyboard". The `"dblclick"` payload is the node alone, with no mouse event, so a listener cannot depend on a pointer. The cost is the name, and the overlap with `Dialog`: `Dialog.onEnter` is a viewport listener that confirms the primary button unless focus is in a text area, a button or a `contenteditable` host. It does not test `defaultPrevented`, and it could not rely on it, since the order of element and viewport listeners is not defined (`ARCHITECTURE.md`, *Event handling*). A picker dialog whose tree confirms on `"dblclick"` and whose primary button does the same therefore confirms twice. The tree does not stop the key to prevent that: a stop does not reach viewport listeners, and a tree with no `"dblclick"` listener in a dialog must keep `Enter` as "OK". Read from the source, not run.

[^enter-both-modes]: `_handleDblClick` toggles only when `expandTrigger` is `"dblclick"`, because in `"click"` mode each click of the pair has already toggled the row, so the net change is nothing. Copying that literally would make `Enter` toggle in one mode and not the other. The pattern gives `Enter` the node's default action and names opening or closing a parent as that action. In `"click"` mode a single click is what opens a parent; in `"dblclick"` mode a double-click is. `Enter` toggles in both. The demo navigator and the docs sidebar use `"click"` mode: there `Enter` on a category opens it, which is what a click does.

[^typeahead-precedent]: Searched: `typeAhead`, `TypeAhead`, `TYPE_AHEAD` and `typeahead` across `src/typescript/lib`. One implementation, in `AbstractSelectableList`. `ComboBox` forwards its keys to the list's `handleKey`, so it has the list's type-ahead while open and none while closed. `AutoCompleteField` forwards only `ArrowDown`, `ArrowUp` and `Enter`, so that a typed letter is not also a type-ahead key. `Menu` has none. The calendar's year scroller keeps a digit buffer with an 800 ms `setTimeout` (`AbstractCalendarDropdown.appendYearDigit`); it matches four-digit years, not labels, and is left as it is. A helper in `component/shared` follows `reduceModifierSelection.ts`, which the table body and `MultiSelectList` share. A class and not a function, because the buffer and the time of the last key are state that must live between key presses.

[^match-rule]: The list searches from the top every time. For one letter that finds the same first row again, so a repeated letter did nothing: probed, `b`, `b` on `Apple`, `Banana`, `Blueberry`, `Cherry` left the focus on `Banana` with the buffer at `bb`. The tree pattern's own wording is "focus moves to the next node with a name that starts with the typed character". Starting a prefix search at the current row, not after it, is what keeps the row while a second and third letter are typed. Treating `aa` as the letter `a` twice is the usual trade: a label that starts with a doubled letter is reached by stepping. The window stays at 700 ms and keeps the list's test, `now - last > 700`, so exactly 700 ms is still one search. `Date.now()` is read on each key as the list does, so there is no timer to dispose and the existing tests' clock spy keeps working. Navigation keys do not reset the buffer, as in the list today.

[^space]: Space as part of a label ("New York") would let a prefix cross a word, as some file managers allow. In a list Space is the commit key and is handled before type-ahead. In a tree the pattern reserves Space for toggling selection, which is a Non-Goal here, and making it a type-ahead character now would have to be undone then.

[^tree-selects]: Every key that moves a tree's current row selects it: there is no way to move the current row without selecting it, and adding one changes `Ctrl+ArrowDown` (a Non-Goal). So type-ahead cannot be focus-only in a tree the way it is in a list. `tree-page-keys` left type-ahead waiting on that model; it does not need to wait. File managers select the row a typed letter lands on, and a consumer that reacts to `"selection"` already reacts once per arrow key. A match is a plain move: it replaces a `Shift` range with the one row (case T15), as `ArrowDown` does. A match on the row that is already current and the only selection changes nothing and fires nothing.

[^star-loaded]: The pattern's `*` expands "all siblings that are at the same level as the current node" and is optional. Taken literally it starts one `loadChildren` call per lazy sibling: in SQLAdmin's navigator, `*` on one table would load the columns of every table in the schema at once. `expandAll()` already draws this line — it "does not load lazy branches" — and `*` uses its test. The other convention, numeric-keypad `*` expanding the whole subtree under the current node, was not taken: it is not the ARIA one, and it has the same loading problem one level down. A consumer option to allow loading was not added: nothing asks for it.

[^prevent-not-stop]: `tree-page-keys` set the rule for keys the tree owns: prevented whether or not anything moved, never stopped, and left alone in an empty tree. A type-ahead character with no match is prevented for a reason of its own: Firefox opens its quick-find bar on `/` and `'` in a page that does not prevent them. The list did not prevent a type-ahead key on its own element while `ComboBox` prevented the same key on the forwarded path; part B makes the two paths agree.

[^list-rule]: Leaving the list on its own code would leave two type-ahead rules in one library: a letter that steps in a tree and does nothing in a list. The list's public shape is kept: `handleTypeAhead` stays `protected` with the same signature, because `List.test.ts` reaches it through a subclass, and its last statement stays `this.setFocusedIndex(idx)`, because `feature/nested-scroll-reveal` edits exactly that line. The four existing type-ahead cases and case K5 pass under the new rule without an edit: none of them types a repeated letter or starts from a focused row that matches.

[^tab-from-cell]: `onToolbarKeyDown` is a subtree listener, so it hears keys from strip tools as well, and `addTool` accepts any component. For the arrow keys it falls back to the active tab when focus is not on a tab; a test pins that ("falls back to the active tab when DOM focus is outside this strip"). `tree-page-keys` left `Home` / `End` out because that fallback would take the caret keys from a text-entry tool. Acting only when `entryIndexForElement` finds the focused element among the tabs removes the objection without touching the arrow keys. `setActiveEntry` is used and not the four lines of the arrow branch, because it is the same sequence under a public name. A target that is already active and focused is skipped so that `Tab` does not emit `"select"` again for the tab the user is on.

[^pool-rows]: `tree-page-keys` saw three empty displayed `treeitem` rows in the large-tree demo and did not investigate. Cause: `computePoolTarget` sizes the pool for the largest window the viewport can show, `ceil(height / rowHeight) + 2 × SCROLL_BUFFER + 2`. At the top of the data the window is smaller, because it cannot extend above row 0: `ceil(height / rowHeight) + SCROLL_BUFFER + 1`. The difference is `SCROLL_BUFFER + 1`, which is 3. `growRowPool` pushes `false` onto `_rowDisplayed` for each new row but leaves the component displayed, and `hideExcessPoolRows` hides only a row whose flag is `true`, so those three are never hidden until a scroll has bound and released them. Probed offline: a fresh 60-row tree 120 px high has 11 pool rows, 8 bound, and 3 unbound with `isDisplayed() === true`, role `treeitem` and no `aria-level`; a tree-table body of 60 records has the same three as `row` elements with three cells each. Nothing sizes an unbound row, and `tree-page-keys` found that a click on row 0 still reached that row, so the three rows are a defect of the accessibility tree and not of what is painted. That was not measured again here; MV6 checks it. The fix was simulated by wrapping `growRowPool` from a test setup file: the tree, table, shared, list, display and DOM suites (134 files, 2674 tests) passed with it.

[^no-restructure]: `Tree._onKeyDown` is about sixty lines in an eight-branch ladder, past the code conventions' guide, and `Tree` keeps a selection ladder beside the shared one. Neither is restructured here, for one reason: `feature/nested-scroll-reveal` is built on this stack's tip and rewrites sixteen call sites inside `_onKeyDown`, `_selectAtIndex` and `_extendSelectionTo`. Moving those lines would turn its merge into a hand edit of every branch, in a branch that is held back. The new keys are therefore new methods, and `_onKeyDown` grows by seven lines. The ladder has a second obstacle: `reduceModifierSelection` trusts any non-null anchor, while `Tree` treats an anchor hidden under a collapsed node as no anchor. Folding them means changing the shared ladder, which the table body and `MultiSelectList` use. Both belong in one refactor once that branch is merged or dropped, together with `Ctrl`+arrow and `Space` for a tree, which is what would give the shared ladder a second caller in `Tree`.

[^nested]: The user decided on 2026-10-10 that a keyboard move and an explicit reveal call scroll the panels around a widget too, while a selection set from code or by a click scrolls the widget only. `feature/nested-scroll-reveal` carries that rule as a second parameter, `around`, on `_selectAtIndex`, `_scrollIntoView` and `scrollRowIntoView`, and as a private `focusIndex(idx, around)` in the list. `_revealFocusRow` passes `true` on that branch already, which is why `Enter` and `*` are written to go through it and make no direct `_scrollIntoView` call. The tab strip is not part of that branch's rule for these keys.

[^consumers]: Searched for `keydown`, `keypress` and `keyup` in the demo app (`packages/lib/src/typescript/*.ts`), `packages/docs/src` and `packages/create-app`: no handler. Their trees (`DemoNavigator`, `DocsSidebar`, the `MiscPanel` and `ContentBoxPanel` demos) subscribe to `"selection"` only. SQLAdmin, read at `main`: `NavigatorTree` and `RolesTree` subscribe to `"dblclick"` and register no `keydown` listener; the rail's subtree listener acts on `Alt+R` only; the `document` accelerator acts on `Alt` chords, `Ctrl` chords and `?`, and prevents only what it handled; `QueriesView` listens for `Enter` on a `List`, not a tree.

[^test-files]: `Tree.test.ts` calls `_onKeyDown` with a hand-made object and does not dispose what it builds. The cases here count `preventDefault` calls, show that an ancestor still hears a key, and show that a key whose target is a row never reaches the tree; all three need real events, and real events need the dispose-and-stop teardown. `KeyboardRowNavigation.test.ts` has that harness but is already nine hundred lines about moving by position, so the new cases get a file of their own beside it. The tab strip cases go where the strip's other key cases are and use their direct-call idiom.

[^prototype]: The source was not edited to try the change. A test-only module patched the prototypes of `Tree`, `AbstractSelectableList` and `TabBar` with the code in `## Internal Structure`, a second wrapped `growRowPool`, and the cases were run against them with real key events. Every value in the U, S, L, T, N, X and H tables came from those runs. With both patches installed for every test file the whole library suite was run twice: 557 of 558 files passed each time, and the one failure, an import-timing case in `tests/unit/import-without-dom.test.ts`, timed out under machine load and passed when run alone. No existing test needed an edit. One lesson from the probes is in `## Potential Challenges`: lists built without `track()` in a real-event file made every later key press in that file vanish. The probe files are kept in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/collection-keys/probes/`.

[^a11y-tab-paragraph]: The accessibility page's tab-strip paragraph (lines 76–84) names the strip's keys and would be the natural place for `Home` / `End`. `feature/spatial-navigation-redesign` rewrites the second half of that paragraph, so an edit to its first half would conflict. `Tab.md` gets the sentence instead, and the paragraph is left for whichever branch merges last.

[^fixed-not-added]: The changelog files a key that should have worked under `## Fixed`: "Shift+F10 opens the context menu of the current tree row…" and `tree-page-keys`'s page keys are both there, and no API is added here either. The list entry is under `## Changed` because it alters what a working key does.

## Implementation Notes

- **Built on nested-scroll-reveal, not on `59a5c2e27`.** The plan's line numbers and code were taken at the older commit. The branch started above `feature/nested-scroll-reveal`, so `_selectAtIndex` already takes `around`: `_typeAheadTo` passes `true`, as the plan's merge table anticipates. Likewise `AbstractSelectableList.handleTypeAhead` keeps the last statement that branch gave it, `this.focusIndex(idx, true)`, instead of the plan's `this.setFocusedIndex(idx)` (plan lines 686-690). Its comment is unchanged.
- **One row added to `tests/component/shared/KeyboardRevealSites.test.ts`** (a file not in the Files table). That file counts every keyboard call site that passes `true` to a reveal and fails when a site has no row in `SITES`. `_typeAheadTo` is a new such site, so a row `_typeAheadTo: _selectAtIndex(index, true)` was added, pressing `h` in the tree rig. `Enter` and `*` call `_revealFocusRow`, which is already a site, and need no row.
- **Part A side effect.** A pool row now starts hidden, so a custom renderer that reads its own DOM geometry in `getContentWidth()` gets 0 on a newly grown row's first render. A recycled row that was hidden and shown again already behaved that way.
- **`activateEdgeEntry` differs from the plan** (plan lines 741-757 and the `tab-from-cell` note). The plan skips the action only when the target is already active and focused, and otherwise calls `setActiveEntry`. The code skips `setActiveEntry` and its `"tabpressed"` whenever the target is already active, and only moves focus onto its button, with `focus(true)` so the strip itself does not scroll, plus the `_scrollToSelected` reveal request that `onTabPressed` makes. Reason: in the plan's version `RovingTabIndex.moveTo` is a no-op for the active index, so with focus on another tab or on a ✕ the focus would not move at all, and a second `"tabpressed"` would be emitted for a tab that is already active. Cases H9 and H10 pin both.
- **Reveal for an already-active edge tab.** `activateEdgeEntry` moves focus through `_rovingTabIndex.moveTo` (the group is built with `preventScroll`), falling back to `focus(true)` when the group already points there, and then runs the strip's own `revealSelectedIfRequested` directly after setting `_scrollToSelected`. Scheduling a layout on the strip was tried and does not work: that reveal runs only from the host `Tab`'s layout, which `Tab._onBarTabPressed` schedules on `"tabpressed"`, and this path emits none. Nothing has moved, so the laid-out rects the reveal reads are current, and no flag is left pending. Case H10 (a real `Tab` host with a scrollable strip) pins the `revealItem` call and the cleared flag.
- **Left as is, for the planned `_onKeyDown` refactor.** `_revealFocusRow` repeats the lookup of the current row that `_currentRowIndex` makes; `_activateCurrentNode` and `_expandSiblingsOfCurrentNode` therefore look the row up twice. The plan keeps `_onKeyDown` unrestructured, so the duplicate is left for that refactor.
- **Plan Verification items 6-7 were run after the audit rounds:** `npm run build:lib`, `npm run docs:api` and `npm run docs:llms:check` pass, and `npm -w packages/docs run test` passes (13 files, 2615 tests).
- **Stale comment, not changed.** `AbstractCalendarDropdown.ts` (above `YEAR_TYPE_IDLE_MS`, line 79) says `ComboBox` uses the same 800 ms type-ahead value. `ComboBox` has no type-ahead of its own, and the shared helper's window is 700 ms. The file is outside this plan and was left alone.
- **Manual cases MV1-MV10 were NOT run** (no browser was allowed). Each covers what the modelled DOM cannot:
  - MV1 and MV2: real focus, scrolling and paint of tree type-ahead, and nothing behind a window scrolling.
  - MV3: the animated expand and collapse, and a held `Enter` not flickering.
  - MV4: `*` against a real layout, with the current row staying in view.
  - MV5: `Home` / `End` scrolling a real overflowing tab strip, including `Home` / `End` onto an already-active edge tab that is scrolled out of the strip (it must come into view without a second `"tabpressed"`).
  - MV6: the accessibility tree and a scroll with no blank row or hitch after Part A. Add a check of the first render's horizontal extent (scrollbar width) in a tree with a custom renderer, for the Part A side effect above.
  - MV7: Firefox's quick-find bar not opening on `/` and `'`.
  - MV8: a `Dialog` with a primary button confirming on `Enter` while the tree's `"dblclick"` also runs.
  - MV9: the browser default for a type-ahead key in a `MultiSelectList` (page behind not scrolling).
  - MV10: SQLAdmin against a library build.
