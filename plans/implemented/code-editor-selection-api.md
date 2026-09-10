---
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/lib/component/editor/index.ts
  - packages/lib/src/typescript/CodeEditorPanel.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# CodeEditor Selection API — Implementation Plan

## Overview

[`CodeEditor`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L448)
can report the caret's position (`getCursorPosition()`) and dedupe a
`"cursorchange"` event off it
([CodeEditor.ts:1477-1507](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1477)),
but both are derived from `state.selection.main.head` alone — the caret, not
the selection. A host that wants a "12 characters, 2 lines selected"
status-bar readout has no way to read the selection's extent, and no event
tells it when that extent changes: `"cursorchange"`'s own dedup, keyed on the
caret's line/column/offset
([CodeEditor.ts:1499-1503](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1499)),
drops any selection change that leaves the caret in place — selecting all
text with the caret already at the document's end, for instance.

This plan adds a `getSelection()` getter and a `"selectionchange"` event,
shaped after `getCursorPosition()`/`"cursorchange"`: a derived
`CodeEditorSelection` payload (`{ characterCount, lineCount }`) computed from
`state.selection.main` by a new `readSelection(state)` helper, deduped by a
new `onSelectionChange(state)` helper against a `_lastSelection` field, and
wired from the same `EditorView.updateListener` callback already driving
`onCursorChange` inside `mount()`
([CodeEditor.ts:1944-1975](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1944)).
The event joins the four the class already exposes (`"change"`,
`"readonlyedit"`, `"heightchange"`, `"cursorchange"`) through the same typed
`on` / `off` / `emit` overload set.

Six files change: the component, the `component/editor` barrel (one new
exported type), the test file, the dev-app demo panel (the only place a live
view exists to verify against), the component doc page, and the changelog. A
related but narrower finding — CodeMirror's `searchKeymap` binding
`Mod-Alt-g` to its own partly-unstyled "Go to line" dialog — was investigated
and is left out of this plan; see `## Non-Goals`.

---

## Architecture Decisions

### `getSelection()` / `"selectionchange"`, not a widened `cursorchange`

The selection's extent gets its own getter and event, rather than joining
`CodeEditorCursorPosition`'s payload or `"cursorchange"`'s dedup.[^dedicated-event]

### The payload is a character count and a line count, not raw endpoints

`CodeEditorSelection` carries `characterCount` and `lineCount` — the two
numbers a status bar needs — not `from`/`to` or `anchor`/`head`.[^count-not-endpoints]

### Bounds come from `main.from`/`main.to`, not `head`/`anchor`

`readSelection` computes both fields from the primary range's normalized
`from`/`to`, so a selection dragged backward (head before anchor) reports the
same values as one dragged forward.[^from-to-not-head-anchor]

### Detection reuses `ViewUpdate.selectionSet`, the flag `onCursorChange` already checks

`onSelectionChange` is called from the same
`if (update.selectionSet || update.docChanged)` block already in `mount()`'s
update listener — no new CodeMirror extension, no second
listener.[^reuse-selectionset]

### Offline default and no-initial-fire match `getCursorPosition()`

Before the view mounts, `getSelection()` returns
`{ characterCount: 0, lineCount: 1 }` — a collapsed selection at the document
start, the state a freshly mounted view actually has. `"selectionchange"`
does not fire for that seeded state; a consumer seeds itself by calling
`getSelection()` once.[^offline-default-selection]

### The demo panel's upper status line also reports the selection

`CodeEditorPanel`'s upper status `Text`, which already reports the caret
position and dirty flag, gains the selection counts too, wired to
`"selectionchange"`.[^demo-panel]

### The `searchKeymap` go-to-line theming gap stays out of this plan

CodeMirror's `searchKeymap` binds `Mod-Alt-g` to its own unstyled "Go to
line" dialog, and also occupies `Mod-g`, leaving neither free for a
Loom-side "find next" chord. Both are real findings; both are left as a
follow-up rather than folded into this plan.[^gotoline-out-of-scope]

---

## Public API

New exported interface, in
`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`, immediately
after `CodeEditorCursorPosition`
([CodeEditor.ts:65-79](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L65)):

```typescript
/**
 * The primary selection's extent inside a {@link CodeEditor}'s document — the
 * payload of its `"selectionchange"` event, and what
 * {@link CodeEditor.getSelection} returns.
 *
 * @category Components
 */
export interface CodeEditorSelection {
    /**
     * Number of characters in the primary selection. 0 for a collapsed
     * selection (a bare caret). Counts UTF-16 code units, like
     * {@link CodeEditorCursorPosition.offset}: a character outside the Basic
     * Multilingual Plane (an emoji) counts as two.
     */
    characterCount: number;
    /** Number of lines the primary selection spans. 1 for a selection confined to a single line, including a collapsed one. */
    lineCount: number;
}
```

Widened event union (same file, replacing
[CodeEditor.ts:148](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L148)):

```typescript
type CodeEditorEvent = "change" | "readonlyedit" | "heightchange" | "cursorchange" | "selectionchange";
```

Widened construction-time listener bag (same file, appending one entry to the
existing inline bag at
[CodeEditor.ts:212](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L212) —
expanded here for legibility; the source keeps the bag on one line):

```typescript
listeners?: {
    change?:          (payload: CodeEditorChange) => void;
    readonlyedit?:    () => void;
    heightchange?:    (payload: CodeEditorHeightChange) => void;
    cursorchange?:    (payload: CodeEditorCursorPosition) => void;
    selectionchange?: (payload: CodeEditorSelection) => void;
};
```

New public method and overloads on `CodeEditor`:

```typescript
class CodeEditor extends Component<CodeEditorOptions> {
    getSelection(): CodeEditorSelection;

    on(event: "selectionchange", listener: (payload: CodeEditorSelection) => void): this;
    off(event: "selectionchange", listener: (payload: CodeEditorSelection) => void): this;
    protected emit(event: "selectionchange", payload: CodeEditorSelection): void;
}
```

New barrel export, in
`packages/lib/src/typescript/lib/component/editor/index.ts`
([index.ts:7](packages/lib/src/typescript/lib/component/editor/index.ts#L7)):

```typescript
export type { CodeEditorOptions, CodeEditorChange, CodeEditorHeightChange, CodeEditorCursorPosition, CodeEditorRevealTarget, CodeEditorRevealOptions, CodeEditorSelection } from '~/component/editor/CodeEditor.js';
```

---

## Internal Structure

Private field, placed immediately after `_lastCursorPosition`
([CodeEditor.ts:607](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L607)):

```typescript
/**
 * The primary selection's extent as of the last `"selectionchange"` emit,
 * seeded to a collapsed selection at the document start — the same shape
 * `_lastCursorPosition` seeds, and for the same reason: `mount()` creates its
 * `EditorState` with no `selection` spec, so a freshly mounted view's
 * selection really is empty. Compared against on every update so the event
 * fires once per real change to the character or line count, never per
 * transaction.
 */
private _lastSelection: CodeEditorSelection = { characterCount: 0, lineCount: 1 };
```

Public getter, placed immediately after `getCursorPosition()`
([CodeEditor.ts:1151-1157](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1151)):

```typescript
/**
 * Returns the primary selection's extent: read live from the view when
 * mounted, else the offline default of a collapsed selection at the document
 * start.
 *
 * `characterCount` is 0 and `lineCount` is 1 for a collapsed selection (a
 * bare caret with nothing highlighted) — the same shape a freshly mounted
 * editor reports. Both are derived from the selection's normalized bounds,
 * so a selection dragged backward reports the same values as one dragged
 * forward. With several selection ranges active, only the primary one is
 * measured, matching {@link CodeEditor.getCursorPosition}.
 *
 * @returns The primary selection's character count and the number of lines it spans.
 */
getSelection(): CodeEditorSelection {
    if (this._view) {
        return this.readSelection(this._view.state);
    }

    return { characterCount: 0, lineCount: 1 };
}
```

Two private helpers, placed immediately after `onCursorChange`
([CodeEditor.ts:1493-1507](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1493))
and before the `on` overloads:

```typescript
/**
 * Derives the primary selection's character count and line count from a
 * CodeMirror state. Uses `main.from`/`main.to` — the range's normalized
 * bounds — rather than `anchor`/`head`, so a selection dragged backward
 * (head before anchor) still reports a non-negative count. `doc.lineAt`
 * already numbers lines from 1.
 *
 * @param state - The state to read the selection and document from.
 * @returns The primary selection's character count and the number of lines it spans.
 */
private readSelection(state: EditorState): CodeEditorSelection {
    const { from, to } = state.selection.main;

    return {
        characterCount: to - from,
        lineCount: state.doc.lineAt(to).number - state.doc.lineAt(from).number + 1,
    };
}

/**
 * Emits `"selectionchange"` when the primary selection's character count or
 * line count differs from the last one emitted, and does nothing otherwise.
 * Takes an `EditorState`, mirroring `onCursorChange`, so the offline harness
 * — where no `EditorView` ever mounts — can drive it directly.
 *
 * @param state - The state carrying the selection to report.
 */
private onSelectionChange(state: EditorState): void {
    const selection = this.readSelection(state);

    if (selection.characterCount === this._lastSelection.characterCount
        && selection.lineCount === this._lastSelection.lineCount) {
        return;
    }

    this._lastSelection = selection;
    this.emit("selectionchange", selection);
}
```

Update-listener wiring, inside `mount()`
([CodeEditor.ts:1944-1975](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1944)) —
one new line and an updated comment, replacing the existing block:

```typescript
EditorView.updateListener.of((update) => {
    if (update.docChanged) {
        this.onDocChange(update.state.doc.toString());
    }

    // Both flags are needed: a caret move sets `selectionSet`, while a
    // document replace (setValue, format) maps the caret through the change
    // without setting it. `onCursorChange`/`onSelectionChange` each drop
    // their own redundant calls.
    if (update.selectionSet || update.docChanged) {
        this.onCursorChange(update.state);
        this.onSelectionChange(update.state);
    }

    this._foldedLines = this.countFoldedLines(update.state);

    if (update.heightChanged || update.geometryChanged) {
        this.syncAutoHeight(update.selectionSet && !update.docChanged);
    }

    // searchPanelOpen(state) is the single source of truth for
    // whether the search panel shows, so a path that opens
    // CodeMirror's own search state without going through Mod-f
    // (F3 on an empty query falls through to openSearchPanel)
    // still opens the search panel.
    if (searchPanelOpen(update.state) !== searchPanelOpen(update.startState)) {
        this.setSearchPanelOpen(searchPanelOpen(update.state));
    }

    if (searchPanelOpen(update.state)
        && !getSearchQuery(update.state).eq(getSearchQuery(update.startState))) {
        this.syncSearchPanelFields(update.state);
    }
}),
```

Demo panel, replacing `handleUpperStatusChange`
([CodeEditorPanel.ts:113-118](packages/lib/src/typescript/CodeEditorPanel.ts#L113)):

```typescript
private readonly handleUpperStatusChange = (): void => {
    const { line, column, offset } = this._editor.getCursorPosition();
    const { characterCount, lineCount } = this._editor.getSelection();

    this._upperStatusText.setText(
        `Ln ${line}, Col ${column} · Pos ${offset} · Sel: ${characterCount} chars, ${lineCount} lines `
        + `· Dirty: ${this._editor.isDirty() ? 'yes' : 'no'}`);
};
```

and its wiring, replacing
[CodeEditorPanel.ts:195-197](packages/lib/src/typescript/CodeEditorPanel.ts#L195):

```typescript
this._editor.onDirtyChange(this.handleUpperStatusChange);
this._editor.on('cursorchange', this.handleUpperStatusChange);
this._editor.on('selectionchange', this.handleUpperStatusChange);
this.handleUpperStatusChange();
```

---

## Ordered Implementation Steps

Throughout, `TEST` means
`npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`.

1. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — add the
   `CodeEditorSelection` interface from `## Public API`, immediately after
   `CodeEditorCursorPosition`
   ([CodeEditor.ts:65-79](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L65)).
2. Same file — add `"selectionchange"` to the `CodeEditorEvent` union
   ([CodeEditor.ts:148](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L148)),
   and a matching bullet to the union's own doc comment
   ([CodeEditor.ts:137-147](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L137)):
   `` - `"selectionchange"` — the primary selection's extent (its character count or line count) changed (payload {@link CodeEditorSelection}). ``
3. Same file — append `selectionchange?: (payload: CodeEditorSelection) => void;`
   to the inline `listeners` bag
   ([CodeEditor.ts:212](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L212)),
   and extend that field's one-line doc comment
   ([CodeEditor.ts:211](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L211))
   to list `"selectionchange"` as a fifth event. No `applyListeners` change is
   needed — the constructor already dispatches the whole bag.
4. Same file — add the `_lastSelection` field from `## Internal Structure`,
   immediately after `_lastCursorPosition`
   ([CodeEditor.ts:607](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L607)).
   A plain initializer is correct here, not `declare`: no setter reachable
   from `applyOptions` writes this field, so nothing writes it during the
   `super()` cascade.
5. Same file — add the `on` / `off` / `emit` overloads for
   `"selectionchange"`, each last in its own overload set (`on`: after
   [CodeEditor.ts:1545](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1545);
   `off`: after
   [CodeEditor.ts:1583](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1583);
   `emit`: after
   [CodeEditor.ts:1599](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1599)),
   with JSDoc matching the sibling overloads. Widen the `emit` implementation
   signature's payload union
   ([CodeEditor.ts:1600](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1600))
   to
   `payload?: CodeEditorChange | CodeEditorHeightChange | CodeEditorCursorPosition | CodeEditorSelection`,
   and add `"selectionchange"` to the payload list in the shared doc comment
   above the `emit` overloads
   ([CodeEditor.ts:1593-1595](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1593)).
   This step comes before the helpers below because `onSelectionChange` calls
   `this.emit("selectionchange", …)`, which does not typecheck until its
   overload exists.
   *Check:* `npm -w packages/lib run typecheck`.
6. Same file — add `readSelection` and `onSelectionChange` from
   `## Internal Structure`, immediately after `onCursorChange`
   ([CodeEditor.ts:1493-1507](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1493))
   and before the `on` overloads. `EditorState` is already imported as a
   value, so no import change is needed.
   *Check:* `npm -w packages/lib run typecheck`.
7. Same file — add `getSelection()` from `## Internal Structure`,
   immediately after `getCursorPosition()`
   ([CodeEditor.ts:1151-1157](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1151)).
   *Check:* `npm -w packages/lib run typecheck`.
8. Same file — inside `mount()`'s update listener
   ([CodeEditor.ts:1944-1975](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1944)),
   add `this.onSelectionChange(update.state);` after
   `this.onCursorChange(update.state);` inside the existing
   `if (update.selectionSet || update.docChanged)` block, and update that
   block's leading comment exactly as given in `## Internal Structure`.
   *Check:* `TEST` — every pre-existing test still passes unedited.
9. `packages/lib/src/typescript/lib/component/editor/index.ts` — add
   `CodeEditorSelection` to the existing `export type { ... } from
   '~/component/editor/CodeEditor.js';` line
   ([index.ts:7](packages/lib/src/typescript/lib/component/editor/index.ts#L7)).
   *Check:* `grep -n 'CodeEditorSelection' packages/lib/src/typescript/lib/component/editor/index.ts`
   — expect one match.
10. `packages/lib/tests/component/code-editor.test.ts` — add a
    `describe('CodeEditor selection', () => { ... })` block covering every
    case in `## Expected Behaviour` › *Unit-testable*, placed immediately
    after the existing `describe('CodeEditor cursor position', ...)` block
    ([code-editor.test.ts:1542-1701](packages/lib/tests/component/code-editor.test.ts#L1542))
    and before `describe('CodeEditor revealRange', ...)`
    ([code-editor.test.ts:1703](packages/lib/tests/component/code-editor.test.ts#L1703)).
    Import `CodeEditorSelection` as a type next to the existing
    `CodeEditorCursorPosition` type import
    ([code-editor.test.ts:3](packages/lib/tests/component/code-editor.test.ts#L3))
    if a collected-payload array needs an explicit annotation; leave it out
    if inference covers it, so no unused import lands. `EditorSelection` is
    already imported
    ([code-editor.test.ts:18](packages/lib/tests/component/code-editor.test.ts#L18))
    for the multi-range case.
    *Check:* `TEST` — full file green.
11. `packages/lib/src/typescript/CodeEditorPanel.ts` — replace
    `handleUpperStatusChange`'s body
    ([CodeEditorPanel.ts:113-118](packages/lib/src/typescript/CodeEditorPanel.ts#L113))
    and its wiring
    ([CodeEditorPanel.ts:195-197](packages/lib/src/typescript/CodeEditorPanel.ts#L195))
    with the versions in `## Internal Structure`. Then update the class doc
    comment's status-line sentence
    ([CodeEditorPanel.ts:95-97](packages/lib/src/typescript/CodeEditorPanel.ts#L95)),
    which currently says the upper line reports the caret position wired to
    `"cursorchange"`, to also say it reports the selection extent, wired to
    `"cursorchange"` and `"selectionchange"`.
    *Check:* `npm -w packages/lib run typecheck` and `npm -w packages/lib run lint`.
12. `packages/lib/docs/components/CodeEditor.md` — apply the three edits in
    `## Documentation Impact`.
13. `packages/lib/docs/reference/changelog/next.md` — add the bullet from
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
reach the selection derivation the way the existing `describe('CodeEditor
cursor position', ...)` block already does: by building a real `EditorState`
and either calling a private helper directly, or assigning a duck-typed
`{ state }` object to `editor._view`.

**Derivation.** Build the state as
`EditorState.create({ doc, selection: { anchor, head } })` and assert
`editor.getSelection()` (with `editor._view = { state }`) equals the row's
*Reported* value:

| Document | Selection (`anchor` → `head`) | Reported |
|---|---|---|
| `'ab\ncd'` | `0` → `0` (collapsed) | `{ characterCount: 0, lineCount: 1 }` |
| `'abcdef'` | `1` → `4` | `{ characterCount: 3, lineCount: 1 }` |
| `'abcdef'` | `4` → `1` (dragged backward) | `{ characterCount: 3, lineCount: 1 }` — same as the row above |
| `'ab\ncd\nef'` | `1` → `7` | `{ characterCount: 6, lineCount: 3 }` |
| `'ab\ncd\nef'` | `0` → `8` (select all) | `{ characterCount: 8, lineCount: 3 }` |

**Getter, offline.**

| Editor | `getSelection()` |
|---|---|
| `new CodeEditor()` | `{ characterCount: 0, lineCount: 1 }` |
| `new CodeEditor('several\nlines\nhere')` (still unmounted) | `{ characterCount: 0, lineCount: 1 }` |

**Multiple ranges.** With
`EditorState.create({ doc: 'ab\ncd', selection: EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(3, 5)], 1), extensions: [EditorState.allowMultipleSelections.of(true)] })`,
`getSelection()` is `{ characterCount: 2, lineCount: 1 }` — the range named by
the `mainIndex` argument (index 1: offsets 3 to 5, "cd"), not the first one.

**Emit and dedup**, driving `editor.onSelectionChange(state)` directly. Each
row starts from a fresh `new CodeEditor()` and applies its calls in order,
collecting every payload a registered `"selectionchange"` listener receives:

| Calls (`anchor` → `head`, doc `'ab\ncd'`) | `"selectionchange"` payloads |
|---|---|
| `0` → `0` | none — equals the seeded collapsed selection |
| `0` → `4` | `{ characterCount: 4, lineCount: 2 }` |
| `0` → `4`, then `0` → `4` again | one payload, `{ characterCount: 4, lineCount: 2 }` |
| `0` → `4`, then `1` → `0` (shrinks back toward the start) | two payloads: `{ characterCount: 4, lineCount: 2 }`, `{ characterCount: 1, lineCount: 1 }` |

One more row, on a three-line document, pins that the two fields are compared
independently — a tie on one does not suppress a change on the other:

| Calls (`anchor` → `head`, doc `'ab\ncd\nef'`) | `"selectionchange"` payloads |
|---|---|
| `1` → `3`, then `3` → `5` | two payloads: `{ characterCount: 2, lineCount: 2 }`, `{ characterCount: 2, lineCount: 1 }` — the character count ties, but the line count differs, so the second call still emits |

**The motivating regression: selecting all at the document's end.** This is
the case `"cursorchange"` alone cannot report — see `## Overview`. Drive both
`onCursorChange` and `onSelectionChange` together, exactly as `mount()`'s
update listener does:

1. Prime both dedup fields to "caret at the document's last position, nothing
   selected": call `editor.onCursorChange(atEnd)` and
   `editor.onSelectionChange(atEnd)` with
   `atEnd = EditorState.create({ doc: 'ab\ncd', selection: { anchor: 5 } })`,
   then clear any collected payloads.
2. Simulate Ctrl/Cmd+A, which selects the whole document but leaves the head
   at the same offset: call both again with
   `selectAll = EditorState.create({ doc: 'ab\ncd', selection: { anchor: 0, head: 5 } })`.
3. Assert the collected `"cursorchange"` payloads are still empty (the head
   stayed at offset 5, so `onCursorChange`'s own dedup suppresses it) and the
   collected `"selectionchange"` payloads are
   `[{ characterCount: 5, lineCount: 2 }]`.

**Subscription.** `on('selectionchange', fn)` then `emit` fires `fn`;
`off('selectionchange', fn)` then `emit` does not — mirroring the existing
`cursorchange` case
([code-editor.test.ts:1678-1690](packages/lib/tests/component/code-editor.test.ts#L1678)).

**Construction-time bag.**
`new CodeEditor(undefined, { listeners: { selectionchange: fn } })` followed
by `(editor as any).emit('selectionchange', { characterCount: 5, lineCount: 2 })`
fires `fn` with that payload — mirroring the existing `listeners.cursorchange`
case
([code-editor.test.ts:1692-1700](packages/lib/tests/component/code-editor.test.ts#L1692)).

### Manual verification only (live-only component; the offline sink never mounts a view)

Run in the dev app (`npm run dev`, `http://localhost:8015`, **CodeEditor**
section) and watch the upper editor's status line:

- Before the editor is clicked, the line's `Sel:` half reads `0 chars, 1 lines`.
- Clicking into the editor with no drag leaves `Sel:` at `0 chars, 1 lines`.
- Dragging a selection with the mouse updates both numbers live as the drag
  proceeds.
- Clicking at the very end of the document, then pressing Ctrl/Cmd+A: the
  `Ln`/`Col`/`Pos` half does not change (the caret was already at the end),
  but the `Sel:` half jumps to the whole document's character and line count
  — the exact scenario this plan exists to fix.
- Pressing Shift+Arrow keys extends or shrinks the selection, updating both
  `Sel:` numbers on every keypress.
- Pressing an arrow key without Shift collapses the selection back to
  `0 chars, 1 lines`.
- Selecting text spanning multiple lines reports a line count greater than 1.
- Clicking **Format** (which rewrites the document) leaves `Sel:` consistent
  with whatever selection CodeMirror maps through the reformat, with no stale
  reading.

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
  ([CodeEditor.md:32-45](packages/lib/docs/components/CodeEditor.md#L32)) —
  the `listeners` row currently names four events. Replace it with:

  | Option | Type | Default | Purpose |
  |---|---|---|---|
  | `listeners` | `{ change?, readonlyedit?, heightchange?, cursorchange?, selectionchange? }` | — | Construction-time listener bag, one optional callback per event the editor exposes through `on()`. |

- Methods table
  ([CodeEditor.md:253-275](packages/lib/docs/components/CodeEditor.md#L253))
  gains two rows, placed after the `cursorchange` rows and before
  `revealRange`:

  | Method | Purpose |
  |---|---|
  | `getSelection()` | Read the primary selection's `{ characterCount, lineCount }`. `0`/`1` for a collapsed selection (a bare caret). Returns that same value when the editor is not mounted. |
  | `on('selectionchange', fn)` / `off('selectionchange', fn)` | Subscribe to selection changes — fires once per real change to the character or line count. |

- New **Selection** section, placed right after **Cursor position**
  ([CodeEditor.md:159-178](packages/lib/docs/components/CodeEditor.md#L159),
  before **Keyboard**):

  > `getSelection()` returns the primary selection's
  > `{ characterCount, lineCount }`, and `on('selectionchange', fn)` fires
  > whenever either changes — once per real change, not once per keystroke or
  > transaction. Like `cursorchange`, the event does not fire for the
  > editor's initial position, so a status bar seeds itself by calling
  > `getSelection()` once when it wires the listener.
  >
  > `characterCount` is 0 and `lineCount` is 1 for a collapsed selection (a
  > bare caret with nothing highlighted) — the same shape a freshly mounted
  > editor reports. Both are derived from the selection's normalized bounds,
  > so dragging backward (moving the caret before the anchor) reports the
  > same values as dragging forward. `characterCount` counts UTF-16 code
  > units, the same convention [`getCursorPosition()`](#cursor-position)'s
  > `offset` uses, so an emoji counts as two. With a multi-cursor selection,
  > only the primary range is measured, matching
  > [`getCursorPosition()`](#cursor-position)'s own rule.
  >
  > `selectionchange` and `cursorchange` are independent: selecting all text
  > while the caret is already at the document's last position moves no
  > caret (so `cursorchange` does not fire) but still changes the
  > selection's extent (so `selectionchange` does).

**`packages/lib/docs/reference/changelog/next.md`.** One bullet under
`## Added` › `### Components`
([next.md:10-32](packages/lib/docs/reference/changelog/next.md#L10)), after
the existing `revealRange` bullet:

> - **`CodeEditor` gains `getSelection()` and a `"selectionchange"` event**,
>   for building a "12 characters, 2 lines selected" status-bar readout.
>   `getSelection()` returns the primary selection's
>   `{ characterCount, lineCount }` — 0 characters across 1 line for a
>   collapsed selection (a bare caret) — reading that same default before the
>   editor mounts. `"selectionchange"` fires once per real change to either
>   count, independently of `"cursorchange"`: selecting all text while the
>   caret is already at the document's last position leaves the caret in
>   place (no `"cursorchange"`) but still changes the selection's extent (a
>   `"selectionchange"`). The payload type `CodeEditorSelection` is newly
>   exported from `component/editor`. No consumer action is needed.

**One new export.** `CodeEditorSelection` joins the existing
`export type { … }` line in `component/editor`'s barrel; `CodeEditor` and
`CodeEditorOptions` are already exported, so the new method, overloads and
options field need no further barrel change.

**No change** to `packages/lib/llms.txt` or `docs/components/index.md`: both
carry a one-line summary of the component's scope ("highlighting, formatting,
folding, search, lint and completion") that a selection readout does not
change. `docs/concepts/events.md` does not enumerate `CodeEditor`'s events
either.

---

## Potential Challenges

- **`update.selectionSet` alone would miss a document replace** that maps the
  selection through the change without "setting" it. The listener condition
  already ORs in `update.docChanged` for `onCursorChange`; reusing the same
  `if` block for `onSelectionChange` covers this for free.
- **Every qualifying update now costs two extra `doc.lineAt` calls**
  (`readSelection`'s `from` and `to`, on top of `readCursorPosition`'s own).
  `lineAt` is a logarithmic lookup over CodeMirror's own document tree, and
  the block still runs only for updates that set a selection or change the
  document — not for the geometry and height updates that dominate the
  listener's traffic.
- **A backward-dragged selection must be measured off `main.from`/`main.to`,
  not `head`/`anchor` directly** — a naive `head - anchor` can be negative,
  flipping sign depending on drag direction. `readSelection` uses the
  already-normalized `from`/`to`, so this cannot come up; a regression here
  would only appear if a future edit reached for `anchor`/`head` instead.
- **The demo's status line now merges three independent signals into one
  `Text`.** `onDirtyChange`, `"cursorchange"`, and `"selectionchange"` all
  route through the same `handleUpperStatusChange`, which re-reads all three
  live getters rather than caching any of them, so no signal can render a
  stale half.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) —
  the component. Read the event union and payload interfaces
  ([:65-148](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L65)),
  `getCursorPosition`/`readCursorPosition`/`onCursorChange`
  ([:1151-1507](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1151)),
  the `on`/`off`/`emit` overload sets
  ([:1517-1602](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1517)),
  and the update listener in `mount()`
  ([:1944-1975](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1944)).
- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) —
  the precedent for a second, dedicated derived-selection readout living
  alongside a class's base `"change"` event, rather than folded into it:
  `getSelectionState()` ([:1272](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1272)),
  `selectionStatesEqual` ([:826](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L826)),
  `_lastSelectionState` ([:1132](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1132)),
  `updateSelectionState` ([:2902](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2902)).
- [`plans/implemented/code-editor-cursor-position.md`](plans/implemented/code-editor-cursor-position.md) —
  the ancestor plan. Its own `## Non-Goals` explicitly deferred "selection
  metrics in the payload" to "a separate feature with its own consumers" —
  this plan is that feature, and follows the same derivation/dedup/offline-default shape.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Event handling* (the typed
  `on`/`off`/`emit` + `ListenerBag` contract and the closed `listeners` bag).
- [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts#L1542) —
  the `describe('CodeEditor cursor position', ...)` block, the template this
  plan's own test block follows line for line.
- [`packages/lib/docs/components/CodeEditor.md`](packages/lib/docs/components/CodeEditor.md) —
  the doc page the new section and table rows land in.
- [`packages/lib/src/typescript/CodeEditorPanel.ts`](packages/lib/src/typescript/CodeEditorPanel.ts) —
  the demo panel whose status line makes the live emit path verifiable.

---

## Non-Goals

- **No `setSelection()` / `select(from, to)`.** This is a read-only derived
  readout; nothing in the task needs programmatic selection placement, and
  [`revealRange`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1186)
  already covers the one selection-setting operation the library offers.
- **No raw `anchor`/`head`/`from`/`to` in the payload** — only the two counts
  asked for. See [^count-not-endpoints].
- **No multi-selection aggregate** (a total across every range). Only the
  primary selection is measured, matching `getCursorPosition()`'s own scope.
- **No `MarkdownEditor` forwarding.**
  [`MarkdownEditor`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1079)
  composes a `CodeEditor` for its source view but exposes its own,
  differently-shaped `getSelectionState()` / `"selectionstate"`; wiring this
  new event through that surface is a separate change, mirroring the
  ancestor plan's identical Non-Goal for `"cursorchange"`.
- **No fix to the `searchKeymap` go-to-line theming gap, and no change to the
  `Mod-g` conflict it leaves for a Loom-side chord.** See
  [^gotoline-out-of-scope].
- **No consuming application.** The downstream status bar that reads this
  API lives in another repository (Loom) and is planned there.

---

## Notes

[^dedicated-event]: Widening `CodeEditorCursorPosition` (or `"cursorchange"`'s
    dedup) to also carry the selection's extent forces a choice between two
    incompatible dedup keys on one event: keep deduping on the caret's
    line/column/offset
    ([CodeEditor.ts:1499-1503](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1499))
    and the new fields would never fire for exactly the case this plan exists
    to fix (Ctrl/Cmd+A with the caret already at the document's end moves no
    caret, so the event stays suppressed); or dedupe on the wider payload
    instead, and `"cursorchange"` — a name that already promises "the primary
    caret moved"
    ([CodeEditor.ts:1484-1486](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1484))
    — starts firing for selection changes that leave the caret in place,
    silently changing an existing, documented event's contract for every
    current listener. `MarkdownEditor` already solves the analogous problem
    for its own selection-derived readout by keeping it as a second
    getter/event pair — `getSelectionState()` / `"selectionstate"`
    ([MarkdownEditor.ts:1272](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1272),
    [MarkdownEditor.ts:2167](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2167))
    — alongside, not inside, its own `"change"` event; this plan follows the
    same shape. The event's own name follows `CodeEditor`'s own convention
    rather than `MarkdownEditor`'s: every one of `CodeEditor`'s three
    existing state-change events already ends in "…change" (`"heightchange"`,
    `"cursorchange"`), so `"selectionchange"` matches its siblings in the
    same class, where `MarkdownEditor`'s differently-named `"selectionstate"`
    would not.

[^count-not-endpoints]: The task this plan serves — a status-bar readout of
    "how much is selected" — needs exactly two numbers, both already named in
    the request: a character count and a line count. Raw endpoints (`from`/
    `to`, or `anchor`/`head`) would need the same arithmetic at every call
    site that wants those two numbers, and would expose CodeMirror's own
    UTF-16 offset representation as public API for no requested use. Per this
    project's simplicity rule (no speculative fields), the payload stays the
    two counts asked for.

[^from-to-not-head-anchor]: A `SelectionRange`'s `head` is the moving end and
    `anchor` the fixed one, so `head - anchor` is negative for a selection
    dragged backward and positive for one dragged forward — the same drag
    reports a different sign depending on direction, and a naive
    `Math.abs()` still would not fix `lineCount`, which needs the smaller
    offset's line number resolved first. CodeMirror's `SelectionRange.from`/
    `.to` are already normalized (`from = Math.min(anchor, head)`,
    `to = Math.max(anchor, head)`), so building on them — the way
    `revealRange` already does
    ([CodeEditor.ts:1211-1216](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1211)) —
    sidesteps the direction problem entirely instead of re-deriving it.

[^reuse-selectionset]: `ViewUpdate.selectionSet` is CodeMirror's own "did this
    update change the selection" flag — the "selection-range extension… the
    library should build on rather than reinvent" this plan was asked to
    check for. `onCursorChange` already relies on it (plus `docChanged`, for
    a document replace that maps the caret without "setting" a selection)
    ([CodeEditor.ts:1949-1954](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1949));
    `onSelectionChange` needs the identical trigger condition for the
    identical reason, so it is called from the same `if` block rather than
    adding a second `EditorView.updateListener.of(...)` extension or a
    bespoke selection-comparison facet.

[^offline-default-selection]: `mount()` builds its `EditorState` with no
    `selection` spec
    ([CodeEditor.ts:1988](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1988)),
    so a freshly mounted view's selection really is a collapsed range at the
    document start — the same fact `getCursorPosition()`'s own offline
    default rests on (`plans/implemented/code-editor-cursor-position.md`, §
    *Offline, the getter reports the document start*). Seeding
    `_lastSelection` with that same value, and returning it from
    `getSelection()` before the view exists, means the first genuine
    selection reported live is also the first one that can differ from the
    seed — so no `"selectionchange"` fires for state nothing has actually
    changed, matching `"cursorchange"`'s own no-initial-fire behaviour that
    `docs/components/CodeEditor.md`'s Cursor position section already
    documents.

[^demo-panel]: The dev app is the only place in this repository where a real
    CodeMirror view mounts, so the demo edit is what makes the
    `"selectionchange"` emit path — and specifically the
    Ctrl/Cmd+A-at-document-end case this plan exists to fix — manually
    verifiable at all, the same reasoning
    `code-editor-cursor-position.md`'s own *The demo panel's upper status
    line carries the readout* decision already established for
    `"cursorchange"`. The lower editor exists for the auto-height and
    wrap/fold cases and gains nothing from a second readout, so it is left
    alone, matching that plan's own choice.

[^gotoline-out-of-scope]: Verified against the installed
    `@codemirror/search` / `@codemirror/view` sources: `searchKeymap`
    ([CodeEditor.ts:1888](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1888))
    binds `Mod-Alt-g` to `gotoLine`
    (`node_modules/@codemirror/search/dist/index.js:1049`), which opens a
    dialog built by `@codemirror/view`'s `showDialog`/`createDialog`
    (`node_modules/@codemirror/view/dist/index.js:11224`) — its input and
    submit button carry `.cm-textfield` / `.cm-button`, both already themed
    with this library's design tokens in `theme.ts`
    ([theme.ts:133-152](packages/lib/src/typescript/lib/component/editor/theme.ts#L133)),
    but its outer `.cm-dialog` wrapper (padding, layout) and
    `.cm-dialog-close` (×) button carry no rule in `theme.ts` at all and fall
    back to CodeMirror's own raw base theme
    (`node_modules/@codemirror/view/dist/index.js:7004-7018`). That gap is a
    self-contained, CSS-only fix in `theme.ts`, touching none of the files
    this plan changes — it does not belong in a plan about
    selection-reporting events just because both happen to involve
    `CodeEditor`. Separately, `searchKeymap` also binds plain `Mod-g` to
    `findNext` — already a working "find next", just not under a binding
    Loom chose — so there is no library defect to fix there at all; which
    chord a consuming app reserves for its own commands is that app's own
    keymap decision, not something `CodeEditor` can resolve on its behalf.
    Recommendation: a follow-up plan, scoped to `theme.ts`'s `.cm-dialog` /
    `.cm-dialog-close` rules only, if the visual inconsistency is worth
    fixing.
