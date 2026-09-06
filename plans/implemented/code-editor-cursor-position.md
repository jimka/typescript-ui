---
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/lib/component/editor/index.ts
  - packages/lib/src/typescript/CodeEditorPanel.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# CodeEditor Cursor Position — Implementation Plan

## Overview

[`CodeEditor`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L292) can
report its text, its language and its height, but nothing about where the caret
is. A host that wants a status-bar readout — "Ln 12, Col 5" — has no way to read
the position, and no event tells it when the caret moves.

This plan adds both halves to `CodeEditor`: a `getCursorPosition()` getter
returning `{ line, column }`, and a `"cursorchange"` event that fires when the
primary caret moves to a different line or column. The event joins the three the
class already has (`"change"`, `"readonlyedit"`, `"heightchange"`) through the
same typed `on` / `off` / `emit` overload set at
[CodeEditor.ts:1198-1265](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1198),
and is emitted from the CodeMirror update listener already wired in `mount()`
([CodeEditor.ts:1449](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1449)).

Six files change: the component, the `component/editor` barrel (one new exported
type), the test file, the dev-app demo panel (the only place a live view exists
to verify against), the component doc page, and the changelog.

---

## Architecture Decisions

### A read-only getter plus a deduped `"cursorchange"` event

`getCursorPosition()` reads the caret live from the mounted view; `"cursorchange"`
is emitted only when the resolved line or column actually differs from the last
one emitted. There is no `setCursorPosition` — this is derived view state, not a
configurable property.[^derived-state]

The pairing mirrors [`Dock`](packages/lib/src/typescript/lib/overlay/Dock.ts#L392):
`isEmpty()` reads the derived value live, `reconcileEmptyState`
([Dock.ts:906-932](packages/lib/src/typescript/lib/overlay/Dock.ts#L906)) compares
it against a private `_empty` field and emits `"emptychange"` "once per real
transition, not per panel" ([Dock.ts:165](packages/lib/src/typescript/lib/overlay/Dock.ts#L165)).

### Line and column are 1-based

Both fields count from 1, so `{ line: 12, column: 5 }` renders directly as
"Ln 12, Col 5" with no arithmetic at the call site.[^one-based]

The library already distinguishes the two conventions: a 0-based *index into a
collection* (`CellClickEvent.rowIndex` / `columnIndex`,
[Body.ts:48-61](packages/lib/src/typescript/lib/component/table/Body.ts#L48)) from
a 1-based *human-facing counter*
(`AbstractStore.getPage()` — "the current 1-based page number",
[AbstractStore.ts:490-497](packages/lib/src/typescript/lib/data/AbstractStore.ts#L490)).
A line/column readout is the second kind.

### `column` counts characters, not visual tab stops

The column is the caret's character offset into its line, plus one. A literal tab
counts as one column whatever
[`tabSize`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L109) is
set to, and a character outside the Basic Multilingual Plane (an emoji) counts as
two, because a CodeMirror document offset is a UTF-16 code-unit offset.[^utf16]

| Document | Caret offset (`head`) | `doc.lineAt(head)` | Reported |
|---|---|---|---|
| `"ab\ncd"`, caret before `a` | 0 | `{ number: 1, from: 0 }` | `{ line: 1, column: 1 }` |
| `"ab\ncd"`, caret after `b` (end of line 1) | 2 | `{ number: 1, from: 0 }` | `{ line: 1, column: 3 }` |
| `"ab\ncd"`, caret before `c` (start of line 2) | 3 | `{ number: 2, from: 3 }` | `{ line: 2, column: 1 }` |
| `"ab\ncd"`, caret after `d` | 5 | `{ number: 2, from: 3 }` | `{ line: 2, column: 3 }` |
| `"\tx"`, caret after the tab | 1 | `{ number: 1, from: 0 }` | `{ line: 1, column: 2 }` |
| `"😀x"`, caret after the emoji | 2 | `{ number: 1, from: 0 }` | `{ line: 1, column: 3 }` |

### The caret is the primary selection's head

The position comes from `state.selection.main.head` — the moving end of the
primary range. With a multi-cursor selection active, the other ranges are
ignored. This matches
[`copy()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L952) and
`cut()`, which already act on `state.selection.main` alone, and the behaviour the
component doc page already states: "With a multi-cursor selection active, only
the primary cursor's range is acted on."

### Offline, the getter reports the document start

With no mounted view — the offline test harness, or before first layout —
`getCursorPosition()` returns `{ line: 1, column: 1 }` rather than `null`. That is
not a placeholder: `mount()` builds its `EditorState` with no `selection` spec
([CodeEditor.ts:1472](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1472)),
so the caret really is at the document start the moment the view appears.[^offline-default]

The same value seeds the emit-dedup field, so no `"cursorchange"` fires at mount
— only a real caret move produces one.

### Derivation and emit are two private helpers taking an `EditorState`

`readCursorPosition(state)` derives the position; `onCursorChange(state)` calls it,
compares against the last emitted position, and emits. Both take a CodeMirror
`EditorState` rather than reading `this._view`, so the offline test harness can
drive them with a real `EditorState.create(...)` even though no view ever
mounts.[^offline-testability]

This follows two helpers already in the class:
[`countFoldedLines(state)`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1611),
which takes an `EditorState` and is tested exactly this way
([code-editor.test.ts:1506-1539](packages/lib/tests/component/code-editor.test.ts#L1506)),
and [`onDocChange(value)`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1181),
whose own doc comment states it is "factored out of the update listener in
`mount()` so the offline harness — where no `EditorView` ever mounts — can drive
the same path directly".

### The demo panel's upper status line carries the readout

`CodeEditorPanel`'s upper status `Text` already reports that editor's dirty flag
([CodeEditorPanel.ts:110-112](packages/lib/src/typescript/CodeEditorPanel.ts#L110)).
It gains the cursor position ahead of the dirty flag, wired to `"cursorchange"`.
The dev app is the only place in this repository where a real CodeMirror view
mounts, so the demo edit is what makes the emit path verifiable at all — not
optional polish. The lower editor's status line is left alone.[^demo-needed]

---

## Public API

New exported type, in
`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`:

```typescript
/**
 * A caret position inside a {@link CodeEditor}'s document — the payload of its
 * `"cursorchange"` event, and what {@link CodeEditor.getCursorPosition}
 * returns. Both fields count from 1, so they render directly as
 * "Ln 12, Col 5".
 *
 * @category Components
 */
export interface CodeEditorCursorPosition {
    /** 1-based line number in the document. */
    line: number;
    /** 1-based character offset into that line. A literal tab counts as one column. */
    column: number;
}
```

Widened event union (same file, replacing
[CodeEditor.ts:59](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L59)):

```typescript
type CodeEditorEvent = "change" | "readonlyedit" | "heightchange" | "cursorchange";
```

Widened construction-time listener bag (same file, appending one entry to the
existing inline bag at
[CodeEditor.ts:123](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L123) —
expanded here for legibility; the source keeps the bag on one line):

```typescript
listeners?: {
    change?:       (payload: CodeEditorChange) => void;
    readonlyedit?: () => void;
    heightchange?: (payload: CodeEditorHeightChange) => void;
    cursorchange?: (payload: CodeEditorCursorPosition) => void;
};
```

New public method and overloads on `CodeEditor`:

```typescript
class CodeEditor extends Component<CodeEditorOptions> {
    getCursorPosition(): CodeEditorCursorPosition;

    on(event: "cursorchange", listener: (payload: CodeEditorCursorPosition) => void): this;
    off(event: "cursorchange", listener: (payload: CodeEditorCursorPosition) => void): this;
    protected emit(event: "cursorchange", payload: CodeEditorCursorPosition): void;
}
```

New barrel export, in
`packages/lib/src/typescript/lib/component/editor/index.ts`:

```typescript
export type { CodeEditorOptions, CodeEditorChange, CodeEditorHeightChange, CodeEditorCursorPosition } from '~/component/editor/CodeEditor.js';
```

---

## Internal Structure

Private field, placed immediately after
[`_cleanValue`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L442):

```typescript
/**
 * The caret position as of the last `"cursorchange"` emit, seeded to the
 * document start — where a freshly mounted view's caret actually sits, since
 * `mount()` creates its `EditorState` with no `selection` spec. Compared
 * against on every update so the event fires once per real move, never per
 * transaction.
 */
private _lastCursorPosition: CodeEditorCursorPosition = { line: 1, column: 1 };
```

Public getter, placed immediately after
[`moveCursorToEnd()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L936):

```typescript
/**
 * Returns the primary caret's position: read live from the view when mounted,
 * else the document start.
 *
 * Both fields count from 1, ready to render as "Ln 12, Col 5". `column` is a
 * character count, so a literal tab counts as one column regardless of
 * {@link CodeEditorOptions.tabSize}. With a selection active the moving end
 * (the caret) is reported; with several selection ranges active, only the
 * primary one is.
 *
 * @returns The caret's 1-based line and column.
 */
getCursorPosition(): CodeEditorCursorPosition {
    if (this._view) {
        return this.readCursorPosition(this._view.state);
    }

    return { line: 1, column: 1 };
}
```

Two private helpers, placed immediately after
[`onDocChange`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1181)
and before the `on` overloads:

```typescript
/**
 * Derives the primary caret's 1-based line and column from a CodeMirror state.
 * `doc.lineAt` already numbers lines from 1; the column is the caret's offset
 * into its line, plus one.
 *
 * @param state - The state to read the selection and document from.
 * @returns The caret's 1-based line and column.
 */
private readCursorPosition(state: EditorState): CodeEditorCursorPosition {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);

    return { line: line.number, column: head - line.from + 1 };
}

/**
 * Emits `"cursorchange"` when the primary caret's line or column differs from
 * the last position emitted, and does nothing otherwise. Factored out of the
 * update listener in `mount()` so the offline harness — where no `EditorView`
 * ever mounts — can drive the same path directly, mirroring `onDocChange`.
 *
 * @param state - The state carrying the caret to report.
 */
private onCursorChange(state: EditorState): void {
    const position = this.readCursorPosition(state);

    if (position.line === this._lastCursorPosition.line && position.column === this._lastCursorPosition.column) {
        return;
    }

    this._lastCursorPosition = position;
    this.emit("cursorchange", position);
}
```

Update-listener wiring, inside `mount()`
([CodeEditor.ts:1449-1459](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1449)) —
one new block, placed after the `docChanged` block and before the `_foldedLines`
assignment:

```typescript
EditorView.updateListener.of((update) => {
    if (update.docChanged) {
        this.onDocChange(update.state.doc.toString());
    }

    // Both flags are needed: a caret move sets `selectionSet`, while a
    // document replace (setValue, format) maps the caret through the change
    // without setting it. `onCursorChange` drops the redundant ones.
    if (update.selectionSet || update.docChanged) {
        this.onCursorChange(update.state);
    }

    this._foldedLines = this.countFoldedLines(update.state);

    if (update.heightChanged || update.geometryChanged) {
        this.syncAutoHeight(update.selectionSet && !update.docChanged);
    }
}),
```

Demo panel, replacing `handleUpperDirtyChange`
([CodeEditorPanel.ts:110-112](packages/lib/src/typescript/CodeEditorPanel.ts#L110)):

```typescript
private readonly handleUpperStatusChange = (): void => {
    const { line, column } = this._editor.getCursorPosition();

    this._upperStatusText.setText(
        `Ln ${line}, Col ${column} · Dirty: ${this._editor.isDirty() ? 'yes' : 'no'}`);
};
```

and its wiring, replacing
[CodeEditorPanel.ts:173-174](packages/lib/src/typescript/CodeEditorPanel.ts#L173):

```typescript
this._editor.onDirtyChange(this.handleUpperStatusChange);
this._editor.on('cursorchange', this.handleUpperStatusChange);
this.handleUpperStatusChange();
```

---

## Ordered Implementation Steps

Throughout, `TEST` means
`npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`.

1. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — add the
   `CodeEditorCursorPosition` interface from `## Public API`, immediately after
   `CodeEditorHeightChange`
   ([CodeEditor.ts:40-48](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L40)).
2. Same file — add `"cursorchange"` to the `CodeEditorEvent` union
   ([CodeEditor.ts:59](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L59)),
   and a matching bullet to the union's own doc comment
   ([CodeEditor.ts:50-58](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L50)):
   `` - `"cursorchange"` — the primary caret moved to a different line or column (payload {@link CodeEditorCursorPosition}). ``
3. Same file — append `cursorchange?: (payload: CodeEditorCursorPosition) => void;`
   to the inline `listeners` bag
   ([CodeEditor.ts:123](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L123)),
   and extend that field's one-line doc comment
   ([CodeEditor.ts:122](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L122))
   to list `"cursorchange"` as a fourth event. No `applyListeners` change is
   needed — the constructor already dispatches the whole bag
   ([CodeEditor.ts:466](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L466)).
4. Same file — add the `_lastCursorPosition` field from `## Internal Structure`,
   immediately after `_cleanValue`
   ([CodeEditor.ts:442](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L442)).
   A plain initializer is correct here, not `declare`: no setter reachable from
   `applyOptions` writes this field, so nothing writes it during the `super()`
   cascade.
5. Same file — add the `on` / `off` / `emit` overloads for `"cursorchange"`,
   each last in its own overload set
   ([CodeEditor.ts:1217](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1217),
   [:1247](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1247),
   [:1262](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1262)),
   with JSDoc matching the sibling overloads. Widen the `emit` implementation
   signature's payload union
   ([CodeEditor.ts:1263](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1263))
   to `payload?: CodeEditorChange | CodeEditorHeightChange | CodeEditorCursorPosition`,
   and add `"cursorchange"` to the payload list in the shared doc comment above
   the three `emit` overloads
   ([CodeEditor.ts:1254-1259](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1254)).
   This step comes before the helpers below because `onCursorChange` calls
   `this.emit("cursorchange", …)`, which does not typecheck until its overload
   exists.
   *Check:* `npm -w packages/lib run typecheck`.
6. Same file — add `readCursorPosition` and `onCursorChange` from
   `## Internal Structure`, immediately after `onDocChange`
   ([CodeEditor.ts:1188](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1188))
   and before the `on` overloads. `EditorState` is already imported as a value
   ([CodeEditor.ts:19](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L19)),
   so no import change is needed.
   *Check:* `npm -w packages/lib run typecheck`.
7. Same file — add `getCursorPosition()` from `## Internal Structure`,
   immediately after `moveCursorToEnd()`
   ([CodeEditor.ts:944](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L944)).
   *Check:* `npm -w packages/lib run typecheck`.
8. Same file — add the `update.selectionSet || update.docChanged` block to the
   update listener in `mount()`, exactly as given in `## Internal Structure`.
   *Check:* `TEST` — every pre-existing test still passes unedited.
9. `packages/lib/src/typescript/lib/component/editor/index.ts` — add
   `CodeEditorCursorPosition` to the existing `export type { ... } from
   '~/component/editor/CodeEditor.js';` line.
   *Check:* `grep -n 'CodeEditorCursorPosition' packages/lib/src/typescript/lib/component/editor/index.ts`
   — expect one match.
10. `packages/lib/tests/component/code-editor.test.ts` — add a
    `describe('CodeEditor cursor position')` block covering every case in
    `## Expected Behaviour` › *Unit-testable*, placed after the existing
    `describe('CodeEditor countFoldedLines')` block
    ([code-editor.test.ts:1539](packages/lib/tests/component/code-editor.test.ts#L1539)).
    Import `EditorSelection` from `@codemirror/state` alongside the existing
    `EditorState` import
    ([code-editor.test.ts:17](packages/lib/tests/component/code-editor.test.ts#L17))
    for the multi-range case. If a collected-payload array needs an explicit
    annotation, import `CodeEditorCursorPosition` as a type next to the existing
    `CodeEditorChange` type import
    ([code-editor.test.ts:3](packages/lib/tests/component/code-editor.test.ts#L3));
    leave that import out if inference covers it, so no unused import lands.
    *Check:* `TEST` — full file green.
11. `packages/lib/src/typescript/CodeEditorPanel.ts` — rename
    `handleUpperDirtyChange` to `handleUpperStatusChange` and give it the body
    from `## Internal Structure`; update its two call sites
    ([CodeEditorPanel.ts:173-174](packages/lib/src/typescript/CodeEditorPanel.ts#L173))
    to the three lines shown there. Leave `handleLowerDirtyChange` and the lower
    editor's wiring untouched.
    *Check:* `grep -n 'handleUpperDirtyChange' packages/lib/src/typescript/CodeEditorPanel.ts`
    — expect zero matches.
12. Same file — update the class doc comment's status-line sentence
    ([CodeEditorPanel.ts:93-94](packages/lib/src/typescript/CodeEditorPanel.ts#L93)),
    which currently says only that each status line reports its editor's dirty
    flag, to note that the upper line also reports that editor's caret position.
    *Check:* `npm -w packages/lib run typecheck` and `npm -w packages/lib run lint`.
13. `packages/lib/docs/components/CodeEditor.md` — apply the three edits in
    `## Documentation Impact`.
14. `packages/lib/docs/reference/changelog/next.md` — add the bullet from
    `## Documentation Impact`.
    *Check:* `npm run docs:api` — 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/index.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/src/typescript/CodeEditorPanel.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Unit-testable (offline harness, `packages/lib/tests/component/code-editor.test.ts`)

`CodeEditor` is live-only — `DOM.sink.mountView` returns `null` under the test
harness's recording DOM sink, so `_view` never leaves `null` on its own. Tests
reach the line/column derivation the way the `countFoldedLines` block already
does: by building a real `EditorState` and either calling the private helper
directly, or assigning a duck-typed `{ state }` object to `editor._view`.

**Derivation.** Each row of the table in *`column` counts characters, not visual
tab stops* is one case. Build the state as
`EditorState.create({ doc, selection: { anchor: head } })` and assert
`editor.getCursorPosition()` (with `editor._view = { state }`) equals that row's
*Reported* value.

**Getter, offline.**

| Editor | `getCursorPosition()` |
|---|---|
| `new CodeEditor()` | `{ line: 1, column: 1 }` |
| `new CodeEditor('several\nlines\nhere')` (still unmounted) | `{ line: 1, column: 1 }` |

**Selection ends.** With `EditorState.create({ doc: 'ab\ncd', selection: { anchor: 0, head: 5 } })`,
`getCursorPosition()` is `{ line: 2, column: 3 }` — the head, not the anchor.

**Multiple ranges.** With
`EditorState.create({ doc: 'ab\ncd', selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(4)], 1), extensions: [EditorState.allowMultipleSelections.of(true)] })`,
`getCursorPosition()` is `{ line: 2, column: 2 }` — the range named by the
`mainIndex` argument, not the first one.

**Emit and dedup**, driving `editor.onCursorChange(state)` directly. Each row
starts from a fresh `new CodeEditor()` and applies its calls in order,
collecting every payload a registered `"cursorchange"` listener receives:

| Calls (caret offsets, doc `'ab\ncd'`) | `"cursorchange"` payloads |
|---|---|
| `0` | none — equals the seeded document start |
| `4` | `{ line: 2, column: 2 }` |
| `4`, then `4` again | one payload, `{ line: 2, column: 2 }` |
| `4`, then `1` | two payloads: `{ line: 2, column: 2 }`, `{ line: 1, column: 2 }` |

**Subscription.** `on('cursorchange', fn)` then `emit` fires `fn`;
`off('cursorchange', fn)` then `emit` does not — mirroring the existing
`heightchange` case
([code-editor.test.ts:183-197](packages/lib/tests/component/code-editor.test.ts#L183)).

**Construction-time bag.** `new CodeEditor(undefined, { listeners: { cursorchange: fn } })`
followed by `(editor as any).emit('cursorchange', { line: 3, column: 4 })` fires
`fn` with that payload — mirroring the existing `listeners.change` case
([code-editor.test.ts:160-168](packages/lib/tests/component/code-editor.test.ts#L160)).

### Manual verification only (live-only component; the offline sink never mounts a view)

Run in the dev app (`npm run dev`, `http://localhost:8015`, **CodeEditor**
section) and watch the upper editor's status line:

- Before the editor is clicked, the line reads `Ln 1, Col 1 · Dirty: no`.
- Clicking into the middle of a line updates both numbers immediately.
- Arrow keys, Home and End update the numbers on every keypress.
- Typing a character advances the column by one; pressing Enter moves to the
  next line at column 1.
- Dragging a selection reports the end the mouse is moving, not the fixed end.
- On the sample's literal-tab line, placing the caret just after the tab reports
  `Col 2`, not `Col 5`, even with "Tab size: 4" — the character-count contract.
- Clicking **Format** (which rewrites the document) leaves the status line
  showing a position consistent with where the caret visibly is, with no stale
  reading.
- Clicking **Save** flips the `Dirty:` half without disturbing the `Ln`/`Col`
  half.

---

## Verification

- `npm -w packages/lib run typecheck` — clean.
- `npm -w packages/lib run lint` — clean.
- `TEST` (`npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`)
  — full file green, every pre-existing case passing unedited.
- `npm run docs:api` — 0 errors, 0 link warnings.
- Manual smoke tests: every case in `## Expected Behaviour` › *Manual
  verification only*, in the dev app's **CodeEditor** section.

---

## Documentation Impact

**`packages/lib/docs/components/CodeEditor.md`.**

- Construction options table
  ([CodeEditor.md:32-45](packages/lib/docs/components/CodeEditor.md#L32)) — the
  `listeners` row is already stale (it names only `"change"`, while the bag
  carries three events today). Replace it with:

  | Option | Type | Default | Purpose |
  |---|---|---|---|
  | `listeners` | `{ change?, readonlyedit?, heightchange?, cursorchange? }` | — | Construction-time listener bag, one optional callback per event the editor exposes through `on()`. |

- Methods table
  ([CodeEditor.md:187-206](packages/lib/docs/components/CodeEditor.md#L187))
  gains two rows:

  | Method | Purpose |
  |---|---|
  | `getCursorPosition()` | Read the primary caret's 1-based `{ line, column }`. Returns the document start when the editor is not mounted. |
  | `on('cursorchange', fn)` / `off('cursorchange', fn)` | Subscribe to caret moves — fires once per real move to a different line or column. |

- New **Cursor position** section, placed right after **Dirty state**
  ([CodeEditor.md:155-157](packages/lib/docs/components/CodeEditor.md#L155),
  before **Keyboard**):

  > `getCursorPosition()` returns the primary caret's `{ line, column }`, both
  > counting from 1 so they render directly as "Ln 12, Col 5", and
  > `on('cursorchange', fn)` fires whenever the caret moves to a different line
  > or column — once per real move, not once per keystroke or transaction. The
  > event does not fire for the editor's initial position, so a status bar seeds
  > itself by calling `getCursorPosition()` once when it wires the listener.
  >
  > `column` counts characters, so a literal tab is one column regardless of
  > [`tabSize`](#construction), and an emoji counts as two. With a selection
  > active the moving end is reported; with a multi-cursor selection, only the
  > primary range, matching the [right-click menu](#right-click-menu)'s own rule.
  > Before the editor mounts, `getCursorPosition()` reports the document start
  > (`{ line: 1, column: 1 }`) — where a freshly mounted editor's caret sits.

**`packages/lib/docs/reference/changelog/next.md`.** One bullet under
`## Added` › `### Components`
([next.md:102-104](packages/lib/docs/reference/changelog/next.md#L102)) — the
purely-additive section the sibling "`TabBar` gains …" bullets already sit in:

> - **`CodeEditor` gains `getCursorPosition()` and a `"cursorchange"` event**,
>   for building a "Ln 12, Col 5" status-bar readout. `getCursorPosition()`
>   returns the primary caret's `{ line, column }`, both 1-based, reading the
>   document start before the editor mounts. `"cursorchange"` fires once per
>   real move to a different line or column, and joins the construction-time
>   `listeners` bag alongside `change` / `readonlyedit` / `heightchange`. The
>   payload type `CodeEditorCursorPosition` is newly exported from
>   `component/editor`. No consumer action is needed.

**One new export.** `CodeEditorCursorPosition` joins the existing
`export type { … }` line in `component/editor`'s barrel; `CodeEditor` and
`CodeEditorOptions` are already exported, so the new method, overloads and
options field need no further barrel change.

**No change** to `packages/lib/llms.txt` or `docs/components/index.md`: both
carry a one-line summary of the component's scope ("highlighting, formatting,
folding, search, lint and completion") that a caret readout does not change.
`docs/concepts/events.md` does not enumerate `CodeEditor`'s events either.

---

## Potential Challenges

- **`update.selectionSet` alone would miss a document replace.** `setValue()` and
  `format()` dispatch a `changes`-only transaction; CodeMirror maps the caret
  through it without "setting" a selection, so `selectionSet` is `false` while
  the reported line/column can still change. The listener condition therefore
  ORs in `update.docChanged`, and `onCursorChange`'s dedup discards the calls
  where the position did not actually move.
- **Every qualifying update costs one `doc.lineAt` call, even when the caret
  never left its line.** `lineAt` is a logarithmic lookup over CodeMirror's own
  document tree, and the new listener block runs only for updates that set a
  selection or change the document — not for the geometry and height updates
  that dominate the listener's traffic.
- **The demo's status line merges two independent signals into one `Text`.**
  Both `onDirtyChange` and `"cursorchange"` route through the same
  `handleUpperStatusChange`, which re-reads both live getters rather than
  caching either, so neither event can render a stale half.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) —
  the component. Read the event union and payload interfaces
  ([:36-59](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L36)),
  `onDocChange` ([:1181](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1181)),
  the `on`/`off`/`emit` overload sets
  ([:1198-1265](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1198)),
  and the update listener in `mount()`
  ([:1449](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1449)).
- [`packages/lib/src/typescript/lib/overlay/Dock.ts`](packages/lib/src/typescript/lib/overlay/Dock.ts) —
  the precedent for a live derived getter plus a change event deduped against a
  private field: `isEmpty()` ([:392](packages/lib/src/typescript/lib/overlay/Dock.ts#L392)),
  `DockEmptyEvent` ([:165-173](packages/lib/src/typescript/lib/overlay/Dock.ts#L165)),
  `reconcileEmptyState` ([:906-932](packages/lib/src/typescript/lib/overlay/Dock.ts#L906)).
- [`packages/lib/src/typescript/lib/data/AbstractStore.ts`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L490) —
  `getPage()`, the library's existing 1-based human-facing counter.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts#L48) —
  `CellClickEvent`, the 0-based collection-index convention this feature is
  deliberately *not* following.
- [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts#L1506) —
  the `countFoldedLines` block, showing how a private `EditorState`-taking helper
  is tested offline, and the `listeners`/`on`/`off` blocks at
  [:159-198](packages/lib/tests/component/code-editor.test.ts#L159).
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Event handling* (the typed
  `on`/`off`/`emit` + `ListenerBag` contract and the closed `listeners` bag) and
  *Three non-negotiable rules for every DOM write* rule 3 (why
  `_lastCursorPosition` is a private field and not an options-bag entry).
- [`packages/lib/docs/components/CodeEditor.md`](packages/lib/docs/components/CodeEditor.md) —
  the doc page the new section and table rows land in.

---

## Non-Goals

- **No `setCursorPosition` / `moveCursorTo(line, column)`.** Nothing in the task
  needs programmatic caret placement, and
  [`moveCursorToEnd()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L936)
  already covers the one movement the library offers today.
- **No selection metrics in the payload** — no selected-character count, no
  selected-line count, no range count. The payload stays the caret's line and
  column; a richer selection API is a separate feature with its own consumers.
- **No visual-column mode.** `column` counts characters only; there is no option
  to expand tabs to `tabSize` stops.
- **No `MarkdownEditor` forwarding.** `MarkdownEditor`
  ([MarkdownEditor.ts:750](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L750))
  composes a `CodeEditor` but exposes only its own `"change"` event; re-exposing
  the caret through its two editing surfaces is a separate change.
- **No consuming application.** The downstream status bar that reads this API
  lives in another repository and is planned there.

---

## Notes

[^derived-state]: A setter would need a `cursorPosition` field on
    `CodeEditorOptions` to keep construction-time and post-construction APIs in
    lockstep, and ARCHITECTURE.md's *Three non-negotiable rules for every DOM
    write* (rule 3) reserves that bag for consumer-configurable properties,
    keeping "runtime caches, framework-managed bookkeeping, derived state" in
    private fields. The caret is derived view state owned by CodeMirror, so both
    the option and the setter are wrong; `_lastCursorPosition` is a private
    field for the same reason.

[^one-based]: The alternative — 0-based, matching a JavaScript array index —
    would push a `+ 1` into every consumer that renders the value, and every
    consumer renders it (that is the feature's whole purpose). CodeMirror's own
    `doc.lineAt(pos).number` is already 1-based, so a 0-based `line` would also
    mean subtracting one here and adding it back at the call site.

[^utf16]: A CodeMirror document position is an offset in UTF-16 code units, so
    `head - line.from` counts code units, not user-perceived characters. An
    emoji outside the Basic Multilingual Plane occupies two, and a combining
    accent counts separately from the letter it sits on. Grapheme-cluster
    counting was rejected: it needs `Intl.Segmenter` (or a table) plus a scan of
    the line on every caret move, and no mainstream editor's status bar reports
    graphemes — VS Code's own "Col" is a UTF-16 count too, which is what a user
    comparing the two readouts will expect.

[^offline-default]: `null` was the alternative, matching `getLanguage()` /
    `getAutoHeightMaxRows()`, which answer `null` for an unset option. It was
    rejected because the caret is not an unset option: there is a real,
    knowable answer offline, and returning `null` would force every consumer to
    branch on a case that can only produce "Ln 1, Col 1" anyway. `getValue()`
    ([CodeEditor.ts:506](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L506))
    sets the precedent — it answers `""` rather than `null` when there is no
    view and no cached text.

[^offline-testability]: The offline harness cannot mount an `EditorView` at all
    (`DOM.sink.mountView` returns `null` under the recording sink), so a helper
    reading `this._view` internally would be unreachable from a test. Taking the
    state as a parameter makes both the derivation and the dedup directly
    testable against a real `EditorState`, leaving only the one-line listener
    call site to manual verification.

[^demo-needed]: The upper editor already owns the panel's Format / Read-only /
    Tab size / Save handles, so putting the readout there keeps every
    manual-verify case on one editor. The lower editor exists for the
    auto-height and wrap/fold cases and gains nothing from a second readout.
    Folding the position into the existing status `Text`, rather than adding a
    second one, is what makes it a status *bar* — the shape the downstream
    consumer is building.
