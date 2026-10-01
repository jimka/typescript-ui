---
touches-shared: [packages/lib/docs/reference/changelog/next.md]
---

# ToolBar Arrow Keys Yield to Text Entry — Implementation Plan

## Overview

`ToolBar` registers a subtree `keydown` listener
([`ToolBar.ts:191-218`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L191)).
It fires for a keydown anywhere inside the bar, including inside a child's
native `<input>`. On `ArrowLeft` / `ArrowRight` (horizontal) or `ArrowUp` /
`ArrowDown` (vertical) it moves the bar's roving focus and returns
`{ prevent: true }`. So a `TextField` inside a toolbar cannot move its caret:
the arrow jumps focus to a toolbar button instead. SQLAdmin hit this with its
table quick-search field (reported in SQLAdmin's `LIBRARY_NOTES.md`, section
"`ToolBar`'s roving-tabindex keydown handler steals arrow keys from a text
child").

The fix adds one shared predicate, `isTextEntryElement(handle)`, to
[`core/Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts).
`ToolBar`'s handler returns no disposition — leaving the key to the browser and
the text control — whenever the focused element is a text-entry element. Tests,
the `ToolBar` doc page, and an unreleased-changelog entry (ships in 0.11.0)
complete the change.

---

## Architecture Decisions

### A text-entry child keeps every arrow key; Tab leaves it

When focus is in a text-entry element, the toolbar handler ignores all four
arrow keys, whatever the caret position. The user leaves the text child with
`Tab` / `Shift+Tab`.[^tab-exit] There is no "arrow at the caret boundary moves
on" rule.[^no-boundary]

This works because no text-entry component is a member of the toolbar's roving
group. `ToolBar.addComponent` registers a child only when
`component.getAria().getTabIndex() === 0`
([`ToolBar.ts:561-570`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L561)),
and `TextInput` (so `TextField`, `TextArea`, `PasswordField`, `UsernameField`),
`AutoCompleteField`, `CodeEditor` and `MarkdownEditor` never set it. Each text
child is therefore its own ordinary tab stop, next to the toolbar's single
roving stop.

### Check the focused element, as `Dialog.onEnter` does

The handler reads `DOM.source.getActiveElement()` and tests that handle, rather
than `e.target`. This mirrors
[`Dialog.onEnter`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1359),
the existing keydown handler that stands down inside text-entry surfaces.[^active-element]

### One shared predicate in `core/Focusable.ts`, built on tag and attribute reads

`isTextEntryElement(handle)` is a new exported function in `core/Focusable.ts`,
next to `ownsTabKey`. The library has no such helper today.[^no-helper]
`core/Focusable.ts` is the home of the framework's shared focus predicates, and
its `FOCUSABLE_BRANCHES` list
([`Focusable.ts:16-25`](packages/lib/src/typescript/lib/core/Focusable.ts#L16))
already defines the `contenteditable` rule this predicate reuses.

The predicate reads only `DOM.source.getTagName` and `DOM.source.getAttribute`,
never `DOM.source.matches`.[^no-matches] Its rule:

| Focused element | Text entry? | Why |
|---|---|---|
| `<textarea>` | yes | multi-line text |
| `<input>` with no `type`, or `type` `text` / `search` / `password` / `email` / `url` / `tel` / `number` / `date` / `time` | yes | any `type` outside the excluded set below |
| `<input type="checkbox">` (also `radio`, `button`, `submit`, `reset`, `image`, `file`, `color`, `range`, `hidden`) | no | in `NON_TEXT_INPUT_TYPES` |
| `<input type="CheckBox">` | no | `type` is compared lowercased |
| `<div contenteditable="true">` (also `""`, `"plaintext-only"`) | yes | `contenteditable` present and not `"false"` |
| `<div contenteditable="false">` | no | mirrors `FOCUSABLE_BRANCHES`'s `:not([contenteditable="false"])` |
| `<button>`, `<div tabindex="0">` (a `ComboBox`) | no | neither `input`, `textarea`, nor `contenteditable` |

The predicate is internal: `core/Focusable.ts` is not re-exported from any
package entry point, so there is no public API change.

---

## Internal Structure

`core/Focusable.ts` additions (place after `findTabKeyOwner`, which ends at
line 137):

```ts
/**
 * `<input>` `type` values that are not typed into — the browser gives them no
 * caret, so arrow keys are free for the surrounding widget. Any other `type`,
 * including a missing one (which the browser treats as `"text"`), is text entry.
 */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
    "button", "checkbox", "color", "file", "hidden",
    "image", "radio", "range", "reset", "submit",
]);

/**
 * Whether `handle` is an element the user types text into: a `<textarea>`, an
 * `<input>` whose `type` is not in `NON_TEXT_INPUT_TYPES`, or a
 * `contenteditable` host (a `CodeEditor`'s or `MarkdownEditor`'s editing
 * surface) that is not `contenteditable="false"`. Arrow-key widgets use it to
 * leave caret keys to the text control.
 *
 * @param handle - The element to test, typically the focused element.
 */
export function isTextEntryElement(handle: Handle): boolean {
    const tag = DOM.source.getTagName(handle).toLowerCase();

    if (tag === "textarea") {
        return true;
    }

    if (tag === "input") {
        const type = (DOM.source.getAttribute(handle, "type") ?? "text").toLowerCase();

        return !NON_TEXT_INPUT_TYPES.has(type);
    }

    const editable = DOM.source.getAttribute(handle, "contenteditable");

    return editable !== null && editable.toLowerCase() !== "false";
}
```

`ToolBar._onKeyDown` after the change (the new lines sit between the
`_rovingTabIndex === undefined` guard and `const isHoriz`):

```ts
this._onKeyDown = (e: KeyboardEvent): Event.ListenerResult => {
    if (SpatialNavigation.claimsKey(e)) { return; }

    // (existing comment and `_rovingTabIndex === undefined` guard unchanged)
    if (this._rovingTabIndex === undefined) {
        return;
    }

    // A text-entry child (a `TextField`, `CodeEditor`, …) needs the arrow
    // keys to move its caret. It is its own tab stop, outside the roving
    // group, so `Tab` / `Shift+Tab` still leave it.
    const active      = DOM.source.getActiveElement();
    const inTextEntry = active !== null && isTextEntryElement(active);

    if (inTextEntry) {
        return;
    }

    const isHoriz = this._orientation === "horizontal";
    // … rest unchanged
};
```

---

## Ordered Implementation Steps

1. **Write the predicate tests first** — create
   `packages/lib/tests/core/Focusable.test.ts`. Use the modelled DOM
   (`installTestDOM(CONFIG)` in `beforeEach`, `DOM.reset()` in `afterEach`, the
   same `CONFIG` block as
   [`ToolBar.test.ts:14-23`](packages/lib/tests/component/menubar/ToolBar.test.ts#L14)).
   Build elements with `DOM.sink.createElement(tag)` and set attributes with
   `DOM.sink.apply(h, { setAttr: { type: 'checkbox' } })`. Cover every row of
   the table in `## Expected Behaviour` → *Predicate*. Run
   `npx vitest run tests/core/Focusable.test.ts` from `packages/lib` — expect a
   failure (the export does not exist yet).

2. **Add the predicate** — in
   `packages/lib/src/typescript/lib/core/Focusable.ts`, add
   `NON_TEXT_INPUT_TYPES` and `isTextEntryElement` exactly as in
   `## Internal Structure`, directly after `findTabKeyOwner`. Re-run step 1's
   tests — expect green.

3. **Write the `ToolBar` tests first** — in
   `packages/lib/tests/component/menubar/ToolBar.test.ts`, add a new
   `describe('ToolBar keydown — leaves arrow keys to a focused text-entry child', …)`
   after the existing keydown `describe` (ends at line 200). Import `TextField`
   from `~/component/input/TextField`. Cover the *ToolBar* cases in
   `## Expected Behaviour`. Create a child's element with
   `field.getElement(true)` (a component has no element until then — the same
   call `tests/dom/hit-test.test.ts` uses before focusing), focus it with
   `DOM.sink.focus(field.getElement()!)`, and call
   `(bar as any)._onKeyDown({ key: 'ArrowLeft' } as KeyboardEvent)`, the same
   direct-call style as the existing keydown tests. Run the file — the
   text-entry cases fail, the button cases pass.

4. **Change the handler** — in
   `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts`:
   - Add `import { isTextEntryElement } from "~/core/Focusable.js";` to the
     import block (`DOM` is already imported at line 5).
   - Insert the `active` / `inTextEntry` block from `## Internal Structure`
     after the `_rovingTabIndex === undefined` guard (line 199-201) and before
     `const isHoriz` (line 203).
   Re-run step 3's file — expect green, including the four pre-existing keydown
   tests (lines 148-200).

5. **Update the class JSDoc** — in the same file, in the `ToolBar` class
   comment (lines 115-118, "Focusable children … so Arrow keys cycle focus
   between them"), append one sentence in prose (no `{@link}` — the predicate
   is internal): "Arrow keys pressed while a text-entry child — a
   `TextField`, `TextArea`, `AutoCompleteField`, `CodeEditor` or
   `MarkdownEditor` — has focus move that child's caret instead; `Tab` and
   `Shift+Tab` leave it."

6. **Update the component doc page** — in
   `packages/lib/docs/components/ToolBar.md`, section `## Keyboard nav`
   (line 56), add after the "Arrow Right / Left … cycle focus" bullet (line 59):
   `- While a text-entry child has focus — a TextField, TextArea, AutoCompleteField, CodeEditor or MarkdownEditor — the arrow keys move its caret, not toolbar focus. Text inputs are separate tab stops, so Tab and Shift+Tab leave them.`
   (Wrap component names in backticks.)

7. **Add the changelog entry** — in
   `packages/lib/docs/reference/changelog/next.md`, under `## Fixed` →
   `### Components`, append after the last existing bullet (the `Table`
   horizontal-scrollbar entry):

   ```markdown
   - **A text field inside a `ToolBar` keeps its arrow keys.** The bar's
     roving-focus handler took `ArrowLeft` / `ArrowRight` (`ArrowUp` /
     `ArrowDown` on a vertical bar) from every child, so a `TextField`'s caret
     could not move — focus jumped to a toolbar button instead. While a
     text-entry child has focus — an `<input>` that takes text, a
     `<textarea>`, or a `contenteditable` surface such as `CodeEditor` or
     `MarkdownEditor` — the bar now leaves the arrow keys to it. `Tab` and
     `Shift+Tab` leave the field, as before. No consumer action is needed.
   ```

8. **Regression checks** — from `packages/lib`:
   - `grep -n "isTextEntryElement" src/typescript/lib/component/menubar/ToolBar.ts`
     — expect the import and one call.
   - `grep -rn "isTextEntryElement" src/typescript/lib/index.ts src/typescript/lib/core/index.ts`
     — expect zero matches (stays internal).
   - Run the full `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Focusable.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` |
| Create | `packages/lib/tests/core/Focusable.test.ts` |
| Modify | `packages/lib/tests/component/menubar/ToolBar.test.ts` |
| Modify | `packages/lib/docs/components/ToolBar.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Predicate — `isTextEntryElement` (unit-testable, `tests/core/Focusable.test.ts`)

| # | Element built | Result |
|---|---|---|
| P1 | `textarea` | `true` |
| P2 | `input`, no `type` | `true` |
| P3 | `input` `type="text"`, `"search"`, `"password"`, `"number"` (one assertion each) | `true` |
| P4 | `input` `type="checkbox"`, `"radio"`, `"button"`, `"range"` (one assertion each) | `false` |
| P5 | `input` `type="CheckBox"` | `false` |
| P6 | `div` `contenteditable="true"`, and `div` `contenteditable=""` | `true` |
| P7 | `div` `contenteditable="false"` | `false` |
| P8 | `div` with no attributes, and `button` | `false` |

### ToolBar keydown (unit-testable, `tests/component/menubar/ToolBar.test.ts`)

Each case builds `const bar = new ToolBar()` with `Button('Cut')`,
`Button('Copy')` and `new TextField()` added in that order.

| # | Setup | Key | Expected |
|---|---|---|---|
| T1 | focus the `TextField`'s element | `ArrowLeft` | handler returns `undefined`; roving active index stays `0` |
| T2 | focus the `TextField`'s element | `ArrowRight` | returns `undefined`; active index stays `0` |
| T3 | `new ToolBar({ orientation: 'vertical' })`, same children, focus the `TextField` | `ArrowDown`, then `ArrowUp` | both return `undefined`; active index stays `0` |
| T4 | focus the `Cut` button's element | `ArrowRight` | returns `{ prevent: true }`; active index becomes `1` (unchanged behaviour) |
| T5 | nothing focused (`getActiveElement()` is `null`) | `ArrowRight` | returns `{ prevent: true }`; active index becomes `1` |
| T6 | no key; inspect the bar | — | `(bar as any)._rovingTabIndex.getItems()` has length `2` and does not contain the `TextField` (pins the rule that makes `Tab` the exit) |

T1 fails before the fix (the handler returns `{ prevent: true }` today), which
confirms the test reproduces the reported defect. The four existing keydown
tests (lines 148-200) must stay green unchanged.

### Manual verification (focus, caret and Tab order — not exercised by the modelled DOM)

| # | Where | Action | Expected |
|---|---|---|---|
| M1 | SQLAdmin, a table's `TableWorkPanel` quick-search field (library symlinked into SQLAdmin, `npm run build:lib` first) | type `abcdef`, press `ArrowLeft` twice, type `X` | field reads `abcdXef`; focus stays in the field |
| M2 | same field | press `ArrowRight` with the caret at the end | nothing moves; focus stays in the field |
| M3 | same field | `Shift+ArrowLeft` | selects one character |
| M4 | same field | `Shift+Tab`, then `Tab` | `Shift+Tab` leaves the field to the previous tab stop; `Tab` from the toolbar's buttons reaches the field; `ArrowLeft` / `ArrowRight` on a button still move between buttons |
| M5 | same app, with `SpatialNavigation` enabled if SQLAdmin enables it | `Ctrl+Alt+ArrowLeft` in the field | spatial navigation still moves focus (its `claimsKey` check runs first and is unchanged) |

---

## Verification

From `packages/lib`:

- `npx vitest run tests/core/Focusable.test.ts tests/component/menubar/ToolBar.test.ts` — all green.
- `npm test` — typecheck of tests plus the full suite, green.
- `npm run typecheck` and `npm run lint` — clean (the new code uses only the
  `DOM.source` seam, so `local/no-raw-dom` must not fire).
- `npm run docs:api` — zero warnings.
- Manual cases M1-M5 in SQLAdmin, per the "verify library fixes in SQLAdmin via
  symlink" workflow.

---

## Documentation Impact

- No public API change: `isTextEntryElement` lives in `core/Focusable.ts`,
  which no entry point re-exports.
- `packages/lib/docs/components/ToolBar.md` `## Keyboard nav` gains one bullet
  (step 6).
- `packages/lib/docs/reference/changelog/next.md` `## Fixed` → `### Components`
  gains one entry (step 7). No migration note: the change only stops the bar
  from taking keys it never should have taken.

---

## Potential Challenges

- **`DOM.sink.focus` in the modelled DOM does not dispatch focus events** —
  the tests only need `DOM.source.getActiveElement()` to report the focused
  handle, which `DOM.sink.focus` does set; don't dispatch a real `keydown`.
- **A component's element is `null` until created** — call
  `getElement(true)` on the `TextField` (and on a `Button` before focusing it)
  first; `getElement()` alone returns `null` in these tests.
- **`getTagName` casing differs by seam** — production returns `"INPUT"`, and
  the modelled DOM also uppercases; the predicate lowercases, so both work.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/menubar/ToolBar.ts`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts) — handler (lines 191-218) and `addComponent` roving registration (lines 554-570).
- [`packages/lib/src/typescript/lib/core/Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts) — `FOCUSABLE_BRANCHES` (contenteditable rule) and `ownsTabKey` / `findTabKeyOwner` (sibling predicates).
- [`packages/lib/src/typescript/lib/overlay/Dialog.ts:1359`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1359) — `onEnter`, the precedent for reading the focused element in a keydown handler.
- [`packages/lib/src/typescript/lib/core/RovingTabIndex.ts`](packages/lib/src/typescript/lib/core/RovingTabIndex.ts) — `moveNext` / `movePrev` / `getItems`.
- [`packages/lib/tests/component/menubar/ToolBar.test.ts`](packages/lib/tests/component/menubar/ToolBar.test.ts) — existing keydown tests (lines 148-200) and test DOM setup.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — modelled `getTagName` / `getAttribute` / `matches` (always `false`).

---

## Non-Goals

- **Other roving widgets** (`TabBar`, `MenuBar`, `ButtonGroup`) — none hosts a
  text child today; they can adopt `isTextEntryElement` when one does.
- **Refactoring `Dialog.onEnter` or `Body`'s cell-editor check onto the new
  predicate** — each asks a different question (Enter vs. arrows; `SELECT`
  included), so sharing would change their behaviour.
- **Non-text children that also use arrows** (the library's `Slider`, a
  `ComboBox`'s `ArrowDown` in a vertical bar) — a separate defect with a
  different fix; not reported.
- **Home / End handling** — `ToolBar` does not handle them, so text children
  already receive them.
- **Arrow-at-caret-boundary exit** — rejected; see `[^no-boundary]`.

---

## Notes

[^tab-exit]: The WAI-ARIA Authoring Practices toolbar pattern says to avoid
    controls that need the toolbar's arrow pair and, when one is unavoidable
    (its example is a textbox), to keep it the last element. It does not define
    an arrow escape; the standard way out of a textbox is `Tab`. Here `Tab`
    works on either side because the text child is not a roving member (see
    the first decision), so the field is simply the next or previous tab stop.

[^no-boundary]: Moving on when the caret sits at the start (`ArrowLeft`) or
    end (`ArrowRight`) of the field was considered — Fluent UI's `FocusZone`
    does this. It was rejected for three reasons. The text child is not in the
    roving group, so `moveNext` / `movePrev` would step from the group's
    *remembered* index, not from the field's position: `ArrowRight` at the end
    of a trailing field would land on the first button. Fixing that would mean
    making text children roving members, which also takes them out of the Tab
    order. And `textarea`, `contenteditable`, and `email` / `number` inputs
    (whose `selectionStart` is `null`) have no cheap boundary test, so the rule
    would be inconsistent across text controls. `Tab` already exits cleanly.

[^active-element]: `Dialog.onEnter` checks `DOM.source.getActiveElement()`
    for `textarea` / `contenteditable` before acting on Enter. For a keydown
    the focused element and the event target are the same element, so the two
    reads agree in the browser. Reading the focused element also keeps the
    four existing keydown tests working unchanged: they pass a bare
    `{ key }` object with no `target`, and with nothing focused
    `getActiveElement()` returns `null`.

[^no-helper]: Searched `packages/lib/src/typescript/lib` for `isTextEntry`,
    `isEditable`, `isContentEditable`, `textEntry`, `isTextInput`,
    `selectionStart`, and `tagName === 'INPUT'`-style checks. Found only
    inline, single-purpose checks: `Dialog.onEnter` (textarea, button,
    contenteditable — tuned to Enter), `Body.ts:1669` (INPUT / TEXTAREA /
    SELECT — tuned to "don't steal focus from a cell editor"), and
    `SpatialNavigation`'s `NATIVE_FOCUSABLE_TAGS` (focusability, not text
    entry). None answers "does this element need the arrow keys for its caret",
    so a new predicate is justified. It goes in `core/Focusable.ts` rather
    than inline in `ToolBar` so the other roving widgets in `## Non-Goals` can
    reuse it.

[^no-matches]: A CSS selector such as
    `textarea, input:not([type=checkbox])…, [contenteditable]:not([contenteditable="false"])`
    with `DOM.source.matches` would be shorter, but the modelled test DOM's
    `matches` always returns `false`
    ([`TestDOM.ts:1571`](packages/lib/tests/dom/TestDOM.ts#L1571)), so the
    predicate could not be unit-tested. `getTagName` and `getAttribute` are
    modelled faithfully.

---

## Implementation Notes

- **Manual cases M1-M5 were not run during implementation.** They need the
  library symlinked into SQLAdmin, and this branch sits mid-way in a stack
  (on `feature/dock-close-focus-and-beforeclose-type`), so relinking
  SQLAdmin at this branch would point it at a partial stack. The handler
  behaviour they exercise is pinned by T1-T6 and P1-P8 in the modelled DOM;
  the caret movement, selection, Tab order and `SpatialNavigation` chord
  (M1-M5) remain to be checked in SQLAdmin once the stack is linked as a
  whole.
- **The Tab-exit wording in steps 5-7 was narrowed.** The plan's text said
  `Tab` / `Shift+Tab` leave every text-entry child. A `CodeEditor` binds
  `indentWithTab` and is a Tab-key owner, so `Tab` indents there (leave with
  `Escape` then `Tab`, or `Ctrl-m`), and a `MarkdownEditor` uses `Tab` for
  table-cell moves while the caret is in a table. The class JSDoc, the inline
  comment, the `ToolBar` doc page and the changelog entry name those
  exceptions instead of promising a Tab exit that does not exist.
