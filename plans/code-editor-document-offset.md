---
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/CodeEditorPanel.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# CodeEditor Document Offset — Implementation Plan

## Overview

[`CodeEditor.getCursorPosition()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L984)
and its `"cursorchange"` event already report the caret's `{ line, column }`.
Both are derived inside
[`readCursorPosition(state)`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1244)
from `state.selection.main.head` — CodeMirror's own raw character offset into
the document — but that raw value is discarded once `line`/`column` are
computed from it. A host that wants the absolute position (for a status bar
reading "Ln 12, Col 5 · Pos 245", or for slicing the document at the caret)
has no way to read it.

This plan adds one field, `offset`, to the existing
[`CodeEditorCursorPosition`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L58)
interface — the same object `getCursorPosition()` returns and `"cursorchange"`
carries — rather than a second parallel API. Four files change: the
component, the test file, the dev-app demo panel, and the component doc page
(the changelog note for the still-unreleased `getCursorPosition()` feature is
amended in place rather than getting a new entry, since it hasn't shipped
yet[^unreleased]).

---

## Architecture Decisions

### One more field on `CodeEditorCursorPosition`, not a second API

`offset` joins `line` and `column` on the same interface, the same getter,
and the same event. All three are computed from one CodeMirror state in one
place, so splitting the raw offset into a second method or event would force
every caller who wants both to make two calls that must agree on when they
were sampled.

### `offset` is 0-based

`line` and `column` are 1-based human-facing counters; `offset` is 0-based,
matching CodeMirror's own document positions and the existing `cursorOffset`
local variable in this same file's
[`format()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1128)
and the `cursorOffset` parameter/field in
[`LanguageRegistry.ts`'s `Formatter` type](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L49-L60).[^zero-based]

### The dedup check compares `offset` too, not just `line`/`column`

`onCursorChange` now rejects a re-emit only when all three fields match the
last emitted position. `line`/`column` alone is not enough: an edit earlier
in the document can shift `offset` while leaving the caret's reported line
and column unchanged.[^offset-can-drift]

| Old state (doc `'ab\ncd'`, head 3) | Edit | New state (doc `'xab\ncd'`, head 4) |
|---|---|---|
| `{ line: 2, column: 1, offset: 3 }` | Insert `'x'` at the very start of the document | `{ line: 2, column: 1, offset: 4 }` |

`line` and `column` are identical in both rows — the inserted character sits
entirely inside line 1, so it shifts every later offset by one without adding
a line or changing line 2's own content — yet `offset` differs. A dedup that
only compared `line`/`column` would silently swallow this change; comparing
`offset` too catches it. The converse never happens: `line` and `column` are
computed from `offset` and the current document in the same call, so two
calls that report the same `offset` against the same state always report the
same `line`/`column`.

### `offset` counts UTF-16 code units, inherited directly from `column`

`column`'s existing doc comment already notes that a CodeMirror position
counts UTF-16 code units, not user-perceived characters, so an emoji outside
the Basic Multilingual Plane counts as two. `offset` *is* that same raw
CodeMirror position — the caveat applies to it more directly than to
`column`, since `offset` has no line-relative arithmetic in between. The new
field's doc comment and the component doc page both state this plainly,
rather than only cross-referencing `column`'s note.[^utf16-directness]

### The demo panel shows the raw offset unmodified

[`CodeEditorPanel`](packages/lib/src/typescript/CodeEditorPanel.ts#L111)'s
upper status line gains a `· Pos {offset}` segment, showing the getter's
`offset` value with no `+1` or other adjustment — the same way the line
already shows `line`/`column` straight from the getter.[^demo-raw]

---

## Public API

Widened interface, in
`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` (replacing
[CodeEditor.ts:50-63](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L50)):

```typescript
/**
 * A caret position inside a {@link CodeEditor}'s document — the payload of its
 * `"cursorchange"` event, and what {@link CodeEditor.getCursorPosition}
 * returns. `line` and `column` count from 1, so they render directly as
 * "Ln 12, Col 5"; `offset` counts from 0, like a string or array index.
 *
 * @category Components
 */
export interface CodeEditorCursorPosition {
    /** 1-based line number in the document. */
    line: number;
    /** 1-based character offset into that line. A literal tab counts as one column. */
    column: number;
    /**
     * 0-based character offset of the caret into the whole document — the
     * same raw position CodeMirror itself uses, and what `format()` calls
     * `cursorOffset`. Usable directly with `getValue().slice(0, offset)` or
     * as a CodeMirror selection anchor, with no adjustment. Counts UTF-16
     * code units, like `column`: a character outside the Basic Multilingual
     * Plane (an emoji) counts as two.
     */
    offset: number;
}
```

No other exported symbol changes. `getCursorPosition()`'s signature is
unchanged (it already returns `CodeEditorCursorPosition`); its return value
now carries the extra field. `CodeEditorCursorPosition` is already exported
from `packages/lib/src/typescript/lib/component/editor/index.ts` — no barrel
change is needed.

---

## Internal Structure

`_lastCursorPosition`'s seed, in
`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` (replacing
[CodeEditor.ts:468](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L468)):

```typescript
private _lastCursorPosition: CodeEditorCursorPosition = { line: 1, column: 1, offset: 0 };
```

`readCursorPosition`, replacing
[CodeEditor.ts:1236-1249](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1236)
(doc comment included, since it also changes):

```typescript
/**
 * Derives the primary caret's 1-based line and column, and its 0-based raw
 * document offset, from a CodeMirror state. `doc.lineAt` already numbers
 * lines from 1; the column is the caret's offset into its line, plus one.
 *
 * @param state - The state to read the selection and document from.
 * @returns The caret's 1-based line and column, and 0-based document offset.
 */
private readCursorPosition(state: EditorState): CodeEditorCursorPosition {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);

    return { line: line.number, column: head - line.from + 1, offset: head };
}
```

`onCursorChange`, replacing
[CodeEditor.ts:1251-1268](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1251):

```typescript
/**
 * Emits `"cursorchange"` when the primary caret's line, column, or offset
 * differs from the last position emitted, and does nothing otherwise.
 * Factored out of the update listener in `mount()` so the offline harness —
 * where no `EditorView` ever mounts — can drive the same path directly,
 * mirroring `onDocChange`.
 *
 * @param state - The state carrying the caret to report.
 */
private onCursorChange(state: EditorState): void {
    const position = this.readCursorPosition(state);

    // Comparing offset too, not just line/column: an edit earlier in the
    // document can shift offset while line/column stay the same (see the
    // dedup example in plans/code-editor-document-offset.md).
    if (position.line === this._lastCursorPosition.line
        && position.column === this._lastCursorPosition.column
        && position.offset === this._lastCursorPosition.offset) {
        return;
    }

    this._lastCursorPosition = position;
    this.emit("cursorchange", position);
}
```

`getCursorPosition()`'s doc comment, replacing
[CodeEditor.ts:972-983](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L972)
(body unchanged):

```typescript
/**
 * Returns the primary caret's position: read live from the view when mounted,
 * else the document start.
 *
 * Both `line` and `column` count from 1, ready to render as "Ln 12, Col 5".
 * `offset` counts from 0 — CodeMirror's own raw document position, usable
 * directly for slicing the document or as a selection anchor. `column` and
 * `offset` are character counts, so a literal tab counts as one regardless of
 * {@link CodeEditorOptions.tabSize}. With a selection active the moving end
 * (the caret) is reported; with several selection ranges active, only the
 * primary one is.
 *
 * @returns The caret's 1-based line and column, and 0-based document offset.
 */
```

Demo panel, replacing `handleUpperStatusChange`
([CodeEditorPanel.ts:111-116](packages/lib/src/typescript/CodeEditorPanel.ts#L111)):

```typescript
private readonly handleUpperStatusChange = (): void => {
    const { line, column, offset } = this._editor.getCursorPosition();

    this._upperStatusText.setText(
        `Ln ${line}, Col ${column} · Pos ${offset} · Dirty: ${this._editor.isDirty() ? 'yes' : 'no'}`);
};
```

---

## Ordered Implementation Steps

Throughout, `TEST` means
`npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`.

1. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — replace
   the `CodeEditorCursorPosition` interface with the widened version from
   `## Public API`.
2. Same file — replace `_lastCursorPosition`'s seed with the `## Internal
   Structure` version (adds `offset: 0`).
3. Same file — replace `readCursorPosition` with the `## Internal Structure`
   version (adds `offset: head` to the returned object).
   *Check:* `npm -w packages/lib run typecheck`.
4. Same file — replace `onCursorChange` with the `## Internal Structure`
   version (extends the dedup guard to compare `offset`).
   *Check:* `npm -w packages/lib run typecheck`.
5. Same file — replace `getCursorPosition()`'s doc comment with the
   `## Internal Structure` version. No change to the method body — it already
   returns whatever `readCursorPosition` produces.
6. Same file — update the `on(event: "cursorchange", …)` overload's JSDoc
   `@param listener` line
   ([CodeEditor.ts:1303](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1303))
   from "Invoked with the caret's new line and column." to "Invoked with the
   caret's new line, column, and document offset." The matching `off(event:
   "cursorchange", …)` overload's `@param listener`
   ([:1341](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1341))
   reads "The exact callback reference to remove" — generic across every
   event — and needs no change.
   *Check:* `npm -w packages/lib run typecheck` and
   `npm -w packages/lib run lint`.
7. `packages/lib/tests/component/code-editor.test.ts` — update every
   `toEqual`/`toBe` assertion in the `describe('CodeEditor cursor position')`
   block (starting at
   [code-editor.test.ts:1541](packages/lib/tests/component/code-editor.test.ts#L1541))
   per the table in `## Expected Behaviour` › *Existing assertions to update*.
   *Check:* `TEST` — every case passes with the new `offset` field asserted.
8. Same file, same `describe` block — add the two new cases from
   `## Expected Behaviour` › *New cases*: the offset-drifts-while-line-column-hold
   case, placed after "emits once per distinct move across two different
   positions", and the getter-exposes-offset-for-a-fresh-editor case, placed
   after "returns the document start before the view is mounted".
   *Check:* `TEST` — full file green.
9. `packages/lib/src/typescript/CodeEditorPanel.ts` — replace
   `handleUpperStatusChange` with the `## Internal Structure` version.
   *Check:*
   `grep -n "Ln \${line}, Col \${column} ·" packages/lib/src/typescript/CodeEditorPanel.ts`
   — expect zero matches (confirms the old template string is gone).
10. `packages/lib/docs/components/CodeEditor.md` — apply the three edits in
    `## Documentation Impact`.
11. `packages/lib/docs/reference/changelog/next.md` — apply the edit in
    `## Documentation Impact`.
    *Check:* `npm run docs:api` — 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/src/typescript/CodeEditorPanel.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Existing assertions to update (unit-testable, `packages/lib/tests/component/code-editor.test.ts`)

Every existing case in `describe('CodeEditor cursor position')` still passes,
with its expected object widened to include `offset`:

| Test | Caret (anchor/head) | New expected |
|---|---|---|
| returns the document start before the view is mounted | n/a | `{ line: 1, column: 1, offset: 0 }` |
| returns the document start when constructed with content but still unmounted | n/a | `{ line: 1, column: 1, offset: 0 }` |
| derives line 1, column 1 for the caret before the first character | anchor 0 | `{ line: 1, column: 1, offset: 0 }` |
| derives line 1, column 3 for the caret at the end of the first line | anchor 2 | `{ line: 1, column: 3, offset: 2 }` |
| derives line 2, column 1 for the caret at the start of the second line | anchor 3 | `{ line: 2, column: 1, offset: 3 }` |
| derives line 2, column 3 for the caret after the last character | anchor 5 | `{ line: 2, column: 3, offset: 5 }` |
| counts a literal tab as one column regardless of its rendered width | anchor 1 (doc `'\tx'`) | `{ line: 1, column: 2, offset: 1 }` |
| counts a character outside the Basic Multilingual Plane as two columns | anchor 2 (doc `'😀x'`) | `{ line: 1, column: 3, offset: 2 }` |
| reports the selection head, not the anchor | anchor 0, head 5 | `{ line: 2, column: 3, offset: 5 }` |
| reports the range named by mainIndex, not the first range | `cursor(4)` at mainIndex 1 | `{ line: 2, column: 2, offset: 4 }` |
| emits nothing when the caret is still at the seeded document start | anchor 0 | `[]` (unchanged) |
| emits once when the caret moves to a new position | anchor 4 | `[{ line: 2, column: 2, offset: 4 }]` |
| does not emit again when called twice with the same position | anchor 4 twice | `[{ line: 2, column: 2, offset: 4 }]` |
| emits once per distinct move across two different positions | anchor 4, then anchor 1 | `[{ line: 2, column: 2, offset: 4 }, { line: 1, column: 2, offset: 1 }]` |
| `on()` / `off()` register and remove a cursorchange listener | manual `emit` payloads | first `emit` payload `{ line: 1, column: 1, offset: 0 }`; second (after `off`) `{ line: 2, column: 2, offset: 4 }` |
| wires a constructor `listeners.cursorchange` bag through `applyListeners` | manual `emit` payload | `{ line: 3, column: 4, offset: 30 }`, and `received` assertion updated to match |

### New cases (unit-testable, same file)

- **Offset drifts while line/column hold.** Two calls to `editor.onCursorChange`, in order: `EditorState.create({ doc: 'ab\ncd', selection: { anchor: 3 } })` then `EditorState.create({ doc: 'xab\ncd', selection: { anchor: 4 } })`. Collected payloads: `[{ line: 2, column: 1, offset: 3 }, { line: 2, column: 1, offset: 4 }]` — two emits, even though every payload's `line`/`column` is `2`/`1`. This is the case from `## Architecture Decisions` › *The dedup check compares `offset` too*.
- **Getter exposes `offset` for a duck-typed mounted view.** `editor._view = { state: EditorState.create({ doc: 'ab\ncd', selection: { anchor: 4 } }) }`; `editor.getCursorPosition()` equals `{ line: 2, column: 2, offset: 4 }`. (Covered incidentally by the updated existing derivation cases above; listed here only so the offset-specific assertion isn't missed if those are skimmed.)

### Manual verification only (live-only component; the offline sink never mounts a view)

Run in the dev app (`npm run dev`, `http://localhost:8015`, **CodeEditor**
section) and watch the upper editor's status line:

- Before the editor is clicked, the line reads `Ln 1, Col 1 · Pos 0 · Dirty: no`.
- Clicking into the middle of a line updates `Pos` along with `Ln`/`Col`.
- Typing a character at the very start of the document advances `Pos` from
  `0` to `1`; `Ln`/`Col` stay `1`/`2`.
- On the sample's literal-tab line, placing the caret just after the tab
  reports the same numeric value for `Col` and `Pos` on that line (both count
  the tab as one), confirming `Pos` inherits the character-count contract
  rather than expanding tabs.
- Clicking **Format** (which can shift text earlier in the document without
  moving the caret's line/column) still leaves `Pos` consistent with where
  the caret visibly sits — the case `## Architecture Decisions` describes,
  now visible live rather than only in the unit test.

---

## Verification

- `npm -w packages/lib run typecheck` — clean.
- `npm -w packages/lib run lint` — clean.
- `TEST` (`npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`)
  — full file green, including every updated and new case above.
- `npm run docs:api` — 0 errors, 0 link warnings.
- Manual smoke tests: every case in `## Expected Behaviour` › *Manual
  verification only*, in the dev app's **CodeEditor** section.

---

## Documentation Impact

**`packages/lib/docs/components/CodeEditor.md`.**

- **Cursor position** section's two paragraphs
  ([CodeEditor.md:161-173](packages/lib/docs/components/CodeEditor.md#L161),
  below the `## Cursor position` heading at
  [:159](packages/lib/docs/components/CodeEditor.md#L159)) — replace with:

  > `getCursorPosition()` returns the primary caret's `{ line, column, offset }`,
  > and `on('cursorchange', fn)` fires whenever any of the three changes —
  > once per real move, not once per keystroke or transaction. The event does
  > not fire for the editor's initial position, so a status bar seeds itself
  > by calling `getCursorPosition()` once when it wires the listener.
  >
  > `line` and `column` count from 1, rendering directly as "Ln 12, Col 5".
  > `offset` counts from 0, like a string or array index — it is CodeMirror's
  > own raw document position, the same value `format()` maps through a
  > reformat as `cursorOffset`, so it can be sliced or used as a selection
  > anchor with no adjustment. `column` and `offset` both count characters, so
  > a literal tab is one regardless of [`tabSize`](#construction), and an
  > emoji counts as two. With a selection active the moving end is reported;
  > with a multi-cursor selection, only the primary range, matching the
  > [right-click menu](#right-click-menu)'s own rule. Before the editor
  > mounts, `getCursorPosition()` reports the document start
  > (`{ line: 1, column: 1, offset: 0 }`) — where a freshly mounted editor's
  > caret sits.

- Methods table
  ([CodeEditor.md:223](packages/lib/docs/components/CodeEditor.md#L223)) —
  replace the `getCursorPosition()` row:

  | Method | Purpose |
  |---|---|
  | `getCursorPosition()` | Read the primary caret's `{ line, column, offset }` — `line`/`column` 1-based, `offset` a 0-based raw document position. Returns the document start when the editor is not mounted. |

- `on('cursorchange', fn)` row
  ([CodeEditor.md:224](packages/lib/docs/components/CodeEditor.md#L224)) —
  unchanged; "caret moves" already covers a move detected via any of the
  three fields.

**`packages/lib/docs/reference/changelog/next.md`.** The `getCursorPosition()`
/ `"cursorchange"` feature is still unreleased — its bullet sits under `##
Added` › `### Components`
([next.md:184-191](packages/lib/docs/reference/changelog/next.md#L184)) in
this same pending version. Amend that bullet in place rather than adding a
second one, since the changelog should describe the shipped shape once, not
narrate the feature's own history — the same still-unreleased status noted in
`## Overview`.[^unreleased]

> - **`CodeEditor` gains `getCursorPosition()` and a `"cursorchange"` event**,
>   for building a "Ln 12, Col 5 · Pos 245" status-bar readout.
>   `getCursorPosition()` returns the primary caret's `{ line, column, offset }`
>   — `line`/`column` 1-based, `offset` a 0-based raw document position, the
>   same value `format()` uses internally — reading the document start before
>   the editor mounts. `"cursorchange"` fires once per real move to a
>   different line, column, or offset, and joins the construction-time
>   `listeners` bag alongside `change` / `readonlyedit` / `heightchange`. The
>   payload type `CodeEditorCursorPosition` is newly exported from
>   `component/editor`. No consumer action is needed.

**No barrel change.** `CodeEditorCursorPosition` is already exported from
`component/editor`'s barrel; widening it with one field needs no further
export.

**No change** to `packages/lib/llms.txt` or `docs/components/index.md` (same
reasoning as the precedent feature: neither enumerates this level of detail),
nor to `CodeEditorPanel.ts`'s class doc comment
([CodeEditorPanel.ts:93-95](packages/lib/src/typescript/CodeEditorPanel.ts#L93)) —
it already says the upper line reports "that editor's caret position" without
enumerating fields, which stays true.

---

## Potential Challenges

- **Every existing `toEqual` assertion in the cursor-position test block needs
  editing, not just the two new ones.** Skipping one leaves a test asserting
  an incomplete object, which `toEqual` (unlike `toMatchObject`) fails on
  since the actual value now has an extra key. `## Expected Behaviour`'s
  table lists every one so none is missed.
- **The manual constructor/listener tests' payloads are arbitrary, so any
  offset value works** — `{ line: 1, column: 1, offset: 0 }` and
  `{ line: 3, column: 4, offset: 30 }` were picked only to keep the test data
  internally plausible; they are not derived from a real document and no
  assertion depends on the specific number.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) —
  the component. Read `CodeEditorCursorPosition`
  ([:50-63](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L50)),
  `getCursorPosition()` ([:972-990](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L972)),
  `readCursorPosition`/`onCursorChange`
  ([:1236-1268](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1236)),
  and `format()`'s `cursorOffset` local
  ([:1116-1132](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1116)) —
  the naming and 0-based precedent this plan follows.
- [`packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts`](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L49-L60) —
  the `Formatter` type's `cursorOffset` parameter and return field, the other
  half of the naming precedent.
- [`plans/implemented/code-editor-cursor-position.md`](plans/implemented/code-editor-cursor-position.md) —
  the plan this one extends: the precedent for structure, testing style
  (an `EditorState`-taking private helper, driven directly in tests), and
  documentation shape. Its *Line and column are 1-based* decision is what
  this plan's own `## Architecture Decisions` › *`offset` is 0-based* reasons
  from.
- [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts#L1541) —
  the `describe('CodeEditor cursor position')` block being edited.
- [`packages/lib/src/typescript/CodeEditorPanel.ts`](packages/lib/src/typescript/CodeEditorPanel.ts#L111) —
  `handleUpperStatusChange`, the demo integration being extended.
- [`packages/lib/docs/components/CodeEditor.md`](packages/lib/docs/components/CodeEditor.md#L159) —
  the **Cursor position** section being revised.

---

## Non-Goals

- **No `setCursorPosition` / seek-by-offset method.** Nothing in the task
  needs programmatic caret placement by offset; `moveCursorToEnd()` already
  covers the one movement the library offers.
- **No visual/grapheme-aware offset.** `offset` counts UTF-16 code units,
  exactly like `column` — no grapheme-cluster variant.
- **No `MarkdownEditor` forwarding**, for the same reason the precedent
  feature excluded it: `MarkdownEditor` exposes only its own `"change"`
  event today.
- **No Loom-side (or any downstream consumer's) status-bar change.** That
  wiring lives in a separate repository and is planned there.
- **No barrel or `index.ts` change.** `CodeEditorCursorPosition` is already
  exported; only its shape widens.

---

## Notes

[^unreleased]: `packages/lib/package.json` is at `0.8.0`; the
    `getCursorPosition()` / `"cursorchange"` bullet still sits in
    `docs/reference/changelog/next.md` (the accumulating notes for the *next*
    unreleased version), not in any numbered changelog file. Nothing has
    shipped this API yet, so widening `CodeEditorCursorPosition` before that
    version is tagged is not a breaking change to any released version —
    amending the pending bullet describes what actually ships, once.

[^zero-based]: The alternative — 1-based, to stay visually consistent with
    `line`/`column` next to it in a status bar — was rejected. `offset` is
    asked for explicitly as the "raw" character position already sitting in
    `head` inside `readCursorPosition`, discarded today; shifting it by one
    would make it no longer that raw value, and every programmatic use this
    plan's own doc comment promises (`getValue().slice(0, offset)`, a
    CodeMirror selection anchor) would silently need a `-1` first. The
    library's own precedent for the 0-vs-1 split
    ([`code-editor-cursor-position.md`](plans/implemented/code-editor-cursor-position.md)'s
    *Line and column are 1-based* decision) draws the line at *what the
    number is for*: a 0-based index into a collection (`CellClickEvent.rowIndex`
    / `columnIndex`) versus a 1-based human-facing counter
    (`AbstractStore.getPage()`). A document offset is the first kind — a
    literal index into the document's character sequence — not a counter, so
    the same precedent that made `line`/`column` 1-based makes `offset`
    0-based. A downstream status bar wanting "Pos 245" rather than "Pos 244"
    adds one at render time, the same way UI code commonly renders a 0-based
    index as a 1-based ordinal.

[^offset-can-drift]: The scenario is not exotic: `format()` can rewrite text
    anywhere in the document, including entirely before the caret's own line,
    while mapping the caret to a numerically different offset that still
    resolves to the same line number and the same intra-line column (nothing
    on the caret's own line changed, and no line was added or removed before
    it). Comparing only `line`/`column` would then treat a real position
    change as a no-op and skip the `"cursorchange"` emit, leaving a
    `Pos`-reading consumer stale after a format that a `Ln`/`Col`-only reader
    would not have noticed either way.

[^utf16-directness]: `column` needs the caveat because a reader might assume
    it counts user-perceived characters; `offset` has no such ambiguity to
    correct, since a raw document position obviously isn't a character count
    of anything else — but the same underlying fact (UTF-16 code units, an
    emoji costs two) is exactly as true of it, and a consumer slicing
    `getValue()` at `offset` needs to know that up front, not infer it from
    `column`'s comment on a sibling field.

[^demo-raw]: The alternative — displaying `offset + 1` to visually match the
    1-based `Ln`/`Col` segments next to it — was rejected for this demo
    specifically (a downstream status bar is free to do this at its own
    render time; see the `offset` 0-based decision's footnote above). Per the
    precedent plan's own *The demo panel's upper status line carries the
    readout* decision, the dev app is the only place in this repository where
    a real CodeMirror view mounts, so this status line is the only place the
    emit path is verifiable at all — and every other segment on it already
    passes its getter's value straight through with no adjustment; adding one
    silent `+1` only here would make the demo misrepresent what
    `getCursorPosition()` actually returns.
