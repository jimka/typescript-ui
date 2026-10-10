---
depends-on: [markdown-demo-sample-table-width]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Paste Undo Step — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode, one Ctrl/Cmd+Z after a paste can take
back the wrong thing. A paste over the very range the text was copied from
leaves no undo step of its own. Undo then takes back the edit made before the
paste together with the paste, or does nothing when there was no earlier
edit.

The cause is one rule in `@lexical/history`, which the editor registers at
[MarkdownEditor.ts:4595](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4595).
This plan moves that registration into a new module, `markdownHistory.ts`,
which hands the history each update in a form the rule cannot misread. The
plan calls that module the *history guard*. The plan also marks the update
`MarkdownEditor.paste()` runs as a paste
([MarkdownEditor.ts:3933](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3933)).

The change is in the library only. It adds one source module and one test
file, edits `MarkdownEditor.ts`, and adds one changelog entry. No public API
changes. Line numbers in this plan are those of commit `4f68f3556`.

---

## Root Cause

Four words are used throughout:

- An **update** is one committed change to Lexical's document.
- An **undo step** is one entry of the undo history. One Ctrl/Cmd+Z takes
  back one step.
- A **leaf** is a node that holds no children: a text node, a line break, an
  image.
- A node is **dirty** when the update touched it, whether or not the node
  ended up different.

For every update, `@lexical/history` either **pushes** it as a new undo step
or **merges** it into the current step. It decides in
`createMergeActionGetter`
(`node_modules/@lexical/history/dist/LexicalHistory.dev.mjs`, L128–206). The
rules run in this order, and the first that applies decides:

| # | Rule | Result |
|---|---|---|
| 1 | The update is an undo or a redo (`HISTORIC_TAG`) | ignored |
| 2 | Tagged `HISTORY_MERGE_TAG` and not `HISTORY_PUSH_TAG` | merge |
| 3 | No node is dirty: only the selection moved | merge |
| 4 | Typing or deleting one character, like the update before it, within 300 ms. Skipped when tagged `HISTORY_PUSH_TAG`. An update tagged `PASTE_TAG` or `CUT_TAG` never counts as typing | merge |
| 5 | Exactly one leaf is dirty, and it is a text node whose content and parent are as before | merge |
| 6 | Anything else | push |

Two more rules, for text composition and for the editor's very first update,
are left out of the table; neither applies to any case in this plan.

Rule 5 is the cause.[^cause] Rule 5 exists for a typed character that
another rule took back: one text node touched, nothing changed. But rule 5
counts dirty leaves only. Rule 5 does not look at the blocks around the text
node, nor at the selection:

| Update | Dirty leaves | Rule 5 says | What really changed |
|---|---|---|---|
| A selection across two `:::` columns, pasted over itself | one, text as before | merge | an empty paragraph was added |
| `beta` pasted over the selected word `beta` | one, text as before | merge | the selection: a range became a caret |
| `beta` dropped at its own end | one, text as before | merge | the selection |
| A selection across two paragraphs, pasted over itself | three | nothing: rule 6 pushes | nothing but the selection |

A merged paste has no undo step. With an edit before it, one undo takes back
that edit and the paste together. With none, undo does nothing. That last
case is the one a seeded paste fuzz found: a scratch test that copies a
random selection of a random document and pastes it at a random place.

No tag prevents the merge. Rule 5 runs after the tags are read, so an update
tagged `PASTE_TAG` or `HISTORY_PUSH_TAG` is merged the same way. The 300 ms
window belongs to rule 4 only and plays no part.

---

## Architecture Decisions

### The contract — one undo takes back exactly the last paste, cut or drop

After a paste, a cut or a drop that changed the document or replaced a
selection, one undo puts the document and the selection back exactly as they
were just before it, and takes back nothing else. The fix adds no step for an
operation that changed neither: such a step would make Ctrl/Cmd+Z appear to
do nothing.[^contract]

Every other update gets the part of that guarantee that concerns the
document: an update that changes the document is never merged by rule 5.

### What is in scope

Each row was run against commit `4f68f3556`. Row IDs refer to
`## Expected Behaviour`.[^measured]

| Case | Today | This plan |
|---|---|---|
| A paste over the copied range that adds or removes blocks (P1–P3) | merged: undo takes back the edit before it too, or does nothing | fixed by the history guard |
| A paste, or a drop, that puts the same text back over a selection inside one text node (P4, P5, D1) | merged: undo takes back the edit before it | fixed by the history guard |
| A paste right after typing, inside the 300 ms window (T1, T2) | already two steps | pinned by tests, no code |
| A character typed inside 300 ms after `paste()` put one character into an empty block (T3) | merged into the paste's step | fixed by tagging `paste()` |
| A paste of the same text that Lexical already pushes (P6) | one step; its undo re-selects the replaced text | unchanged, pinned by a test |
| An update that changes neither document nor selection (D2, N1) | no step | unchanged, pinned by tests |
| Two pastes in a row (P7), a cut (C1) | already one step each | pinned by tests, no code |
| Toolbar commands and keys | 52 that change the document were run; each is one step | no code |
| Source mode (S1) | uses the source editor's own history | untouched, pinned by a test |

### Guard the history in a new module, `markdownHistory.ts`

A new module `packages/lib/src/typescript/lib/component/editor/markdownHistory.ts`
exports `registerMarkdownHistory(editor)`. `ensureEditor` calls
`registerMarkdownHistory` in the place where `ensureEditor` calls
`registerHistory` today. The module mirrors
`registerWritableStateRules`
([markdownWritable.ts:73](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L73)):
a `register…(editor)` function in its own file that returns the unregister
function and is one entry of `ensureEditor`'s `mergeRegister` list.[^module]

### Hand `registerHistory` the editor through a proxy

`registerMarkdownHistory` passes `registerHistory` a `Proxy` of the editor.
The proxy replaces one member, `registerUpdateListener`, so the history's
listener receives each update through `historyPayloadFor`. Every other
member is the editor's own, bound to it.

The proxy mirrors `registerMarkdownShortcutsOutsideRawBlocks`
([MarkdownEditor.ts:2054–2100](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2054-L2100)),
which hands `registerMarkdownShortcuts` the editor through the same kind of
proxy because that plugin also hard-codes its rules and offers no
hook.[^proxy]

### Decide by what the update did, not by its tags

`isOwnUndoStep` reads an update and answers whether rule 5 would merge that
update by mistake. The answer can be yes only for an update with exactly one
dirty leaf whose text reads as before:

| Document | Selection | Example | Own undo step? |
|---|---|---|---|
| changed | any | a paste across two columns leaves an empty paragraph | yes |
| same | a range before, a different selection after | `beta` pasted over the selected `beta`; a drop at the selection's own end | yes |
| same | a range before, the same range after | a drop released inside its own selection; `clearFormatting()` with nothing to clear | no |
| same | a caret before | a typed character another rule took back | no |

For every other update `isOwnUndoStep` answers no, and Lexical decides as it
does today. Tags are not consulted.[^no-tags]

### Defeat rule 5 with one extra dirty-leaf key

For an update that is its own undo step, `historyPayloadFor` hands the
history a copy of the update whose `dirtyLeaves` set holds one more key,
`NO_NODE_KEY`, which no node has. Rule 5 needs exactly one dirty leaf, so it
no longer applies and rule 6 pushes the update. Nothing else in the history
changes.[^extra-key]

The guard can therefore only turn a merge by rule 5 into a push. An update
the history pushes, ignores, or merges by rules 2–4 keeps that outcome.

### Tag `paste()`'s update `PASTE_TAG`

`MarkdownEditor.paste()` adds `tag: PASTE_TAG` to its update's options. The
history then treats the update as a paste under rule 4, as it treats a native
paste: typing never merges into the paste, and the paste never merges into
typing. The tag mirrors Lexical's own paste handler and `$cutGuardedRange`
([MarkdownEditor.ts:1176](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1176)),
which tags its update `CUT_TAG`. `cut()` is not tagged.[^paste-tag]

The tag serves rule 4 only. The history guard does not read it.

### A canary test marks the workaround for removal

The new test file holds a canary: a bare Lexical editor with the real
`registerHistory`, asserting that rule 5 still merges a block-adding update.
When a Lexical upgrade makes the canary fail, the proxy can be removed. The
canary mirrors the ones at
[markdown-editor-command-crashes.test.ts:611–660](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts#L611-L660),
and the module's `@remarks` names the canary as those guards' remarks
do.[^canary]

---

## Internal Structure

### `markdownHistory.ts` — the whole file

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { $getNodeByKey, $getSelection } from "lexical";
import type { EditorState, LexicalEditor, NodeKey, UpdateListener, UpdateListenerPayload } from "lexical";
import { registerHistory, createEmptyHistoryState } from "@lexical/history";

/**
 * The coalescing window (ms) for the undo/redo history: edits within this gap
 * merge into a single undo step, matching Lexical's own recommended default.
 */
const HISTORY_DELAY_MS = 300;

/**
 * A key no node has: Lexical's node keys are `"root"` and decimal numbers.
 * {@link historyPayloadFor} adds it to the dirty leaves the history is
 * handed, which makes them two. The history looks every dirty key up before
 * it uses the node, so a key with no node changes nothing else.
 */
const NO_NODE_KEY: NodeKey = "markdown-history-own-step";

/**
 * Whether Lexical's history would merge `payload`'s update into the undo step
 * before it although it is a step of its own: exactly one leaf is dirty, its
 * text reads as before, and the update either replaced a selection (a range
 * before it, another selection after it) or changed the document.
 *
 * @param payload - The update, as an update listener receives it.
 * @returns Whether the update must be its own undo step.
 */
function isOwnUndoStep({ dirtyLeaves, prevEditorState, editorState }: UpdateListenerPayload): boolean {
    const [key] = dirtyLeaves;

    if (dirtyLeaves.size !== 1 || key === undefined) {
        return false;
    }

    const textIn = (state: EditorState): string | undefined => state.read(() => $getNodeByKey(key)?.getTextContent());
    const textBefore = textIn(prevEditorState);
    const textAfter = textIn(editorState);

    // Lexical pushes a leaf whose text changed by itself. Every typed character ends here, before anything costly runs.
    if (textBefore !== textAfter) {
        return false;
    }

    const before = prevEditorState.read($getSelection);
    const after = editorState.read($getSelection);
    const replacedSelection = before !== null && !before.isCollapsed() && !before.is(after);

    return replacedSelection || JSON.stringify(prevEditorState.toJSON()) !== JSON.stringify(editorState.toJSON());
}

/**
 * The update the history is told about: `payload` itself, or — for an update
 * that is its own undo step ({@link isOwnUndoStep}) — a copy whose dirty
 * leaves hold one more key, so the history's one-leaf rule does not apply.
 *
 * @param payload - The update, as an update listener receives it.
 * @returns The payload to hand the history's listener.
 */
function historyPayloadFor(payload: UpdateListenerPayload): UpdateListenerPayload {
    const ownStep = isOwnUndoStep(payload);

    return ownStep ? { ...payload, dirtyLeaves: new Set([...payload.dirtyLeaves, NO_NODE_KEY]) } : payload;
}

/**
 * Registers the undo/redo history so that no edit is merged into the undo
 * step before it by mistake: one undo after a paste, a cut or a drop puts
 * the document and the selection back as they were just before it, and takes
 * back nothing else.
 *
 * @remarks
 * Works around `@lexical/history`'s merge rules (0.49.0–0.52.0). Their last
 * rule merges an update into the current undo step when exactly one leaf is
 * dirty and that leaf is a text node reading as before. The rule counts
 * dirty leaves only, so it also merges an update that added or removed
 * blocks, or replaced a selection with the same text. A paste over the range
 * it was copied from is such an update: one undo then took back the edit
 * before the paste with it, or did nothing when there was none.
 * `registerHistory` hard-codes its rules and offers no hook, so it is handed
 * the editor through a proxy whose `registerUpdateListener` wraps the
 * history's listener ({@link historyPayloadFor}); every other member is the
 * editor's own, bound to it. `registerMarkdownShortcutsOutsideRawBlocks` in
 * `MarkdownEditor.ts` wraps `registerMarkdownShortcuts` the same way, and
 * its remark on WebKitGTK and `Proxy` holds here too. Remove the proxy when
 * the canary in `markdown-editor-history.test.ts` fails.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
export function registerMarkdownHistory(editor: LexicalEditor): () => void {
    const registerUpdateListener = (listener: UpdateListener): (() => void) =>
        editor.registerUpdateListener((payload) => {
            listener(historyPayloadFor(payload));
        });

    const guarded = new Proxy(editor, {
        get: (target, property) => {
            if (property === "registerUpdateListener") {
                return registerUpdateListener;
            }

            const value: unknown = Reflect.get(target, property, target);

            return typeof value === "function" ? value.bind(target) : value;
        },
    });

    return registerHistory(guarded, createEmptyHistoryState(), HISTORY_DELAY_MS);
}
```

The file above was linted and type-checked as written (`eslint`,
`tsc -p tsconfig.lib.json --noEmit`: no findings).

### `MarkdownEditor.ts` — the four edits

1. Imports. Delete L45
   (`import { registerHistory, createEmptyHistoryState } from "@lexical/history";`).
   Add next to the other `~/component/editor/` imports (after L60):

   ```typescript
   import { registerMarkdownHistory } from "~/component/editor/markdownHistory.js";
   ```

2. Delete the `HISTORY_DELAY_MS` constant and its doc comment (L83–87). The
   constant now lives in `markdownHistory.ts`.

3. `ensureEditor`, L4595. Replace

   ```typescript
   registerHistory(editor, createEmptyHistoryState(), HISTORY_DELAY_MS),
   ```

   with

   ```typescript
   registerMarkdownHistory(editor),
   ```

   Keep its place in the `mergeRegister` list: listeners run in registration
   order.

4. `paste()`, L3941. Replace `}, { discrete: true });` with

   ```typescript
   }, { discrete: true, tag: PASTE_TAG });
   ```

   and add `PASTE_TAG` to the `"lexical"` value import (L19–29), after
   `PASTE_COMMAND` on L22. The option shape is the one `insertImage` uses at
   L4217 (`{ discrete: true, tag: RUN_EDGE_TAG }`).

### Test helpers for `markdown-editor-history.test.ts`

Copy `CONFIG`, `lexicalOf`, `load`, `update`, `$textNode`, `selectText`,
`copySelection`, `pasteNodes` and the `CopiedNodes` / `TextPoint` types from
[markdown-editor-columns.test.ts:25–134](../packages/lib/tests/component/markdown-editor-columns.test.ts#L25-L134).
Give `selectText`'s `focus` parameter the default `anchor`, so one point
places a caret.

The file imports, besides `vitest`, `MarkdownEditor`, `DOM`, `installTestDOM`
and `fontMetrics` as the columns test does:

- from `lexical`: `$createParagraphNode`, `$createRangeSelection`,
  `$createTextNode`, `$getRoot`, `$getSelection`, `$getTextPointCaret`,
  `$isRangeSelection`, `$isTextNode`, `$setSelection`,
  `$splitAtPointCaretNext`, `CONTROLLED_TEXT_INSERTION_COMMAND`,
  `PASTE_COMMAND`, `REDO_COMMAND`, `UNDO_COMMAND`, `createEditor`, and the
  types `LexicalEditor` and `TextNode`;
- from `@lexical/clipboard`: `$generateJSONFromSelectedNodes`,
  `$generateNodesFromSerializedNodes`, `$getLexicalContent`,
  `$insertGeneratedNodes`;
- from `@lexical/history`: `createEmptyHistoryState`, `registerHistory`;
- from `@lexical/utils`: `$dfs`.

Add these helpers. They were run and type-checked as written:

```typescript
const TWO = 'alpha beta\n\nomega';
const COLUMNS = '::: columns\nw0 w1\n|||\nw2 w3\n:::\n\nomega';
const BETAS = 'beta one\n\nbeta two\n\nomega';

beforeEach(() => {
    installTestDOM(CONFIG);

    // `registerRichText`'s paste handler tells clipboard, drag, input and key events apart by class name.
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
    vi.stubGlobal('DragEvent', class DragEvent {});
    vi.stubGlobal('InputEvent', class InputEvent {});
    vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});
});
afterEach(() => {
    DOM.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** What an undo must restore: the saved Markdown, the whole document state, and the selection. */
interface Snapshot { value: string; state: string; selection: string }

/** Loads `source`, then types `x` at the end of `omega`: the edit a merged step would take back. */
function loadAndType(source: string): MarkdownEditor {
    const editor = load(source);

    selectText(editor, ['omega', 5]);
    lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');
    editor.getValue();   // commits the typing, so the history has recorded it

    return editor;
}

/** Reads the editor's {@link Snapshot}; the selection reads `"text"@offset>"text"@offset`, anchor first. */
function snapshot(editor: MarkdownEditor): Snapshot {
    const lexical = lexicalOf(editor);
    const value = editor.getValue();

    return lexical.read(() => {
        const selection = $getSelection();
        const point = (key: string, offset: number): string => {
            const node = $dfs($getRoot()).find((entry) => entry.node.getKey() === key)!.node;

            return `${$isTextNode(node) ? JSON.stringify(node.getTextContent()) : node.getType()}@${offset}`;
        };

        return {
            value,
            state:     JSON.stringify(lexical.getEditorState().toJSON()),
            selection: $isRangeSelection(selection)
                ? `${point(selection.anchor.key, selection.anchor.offset)}>${point(selection.focus.key, selection.focus.offset)}`
                : String(selection),
        };
    });
}

/** Undoes once and reads the result. */
function undo(editor: MarkdownEditor): Snapshot {
    lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

    return snapshot(editor);
}

/** A native paste: `PASTE_COMMAND` carrying plain `text`, and Lexical's own clipboard string when `content` is given. */
function nativePaste(editor: MarkdownEditor, text: string, content: string = ''): void {
    const lexical = lexicalOf(editor);
    const event = Object.assign(new ClipboardEvent('paste'), {
        clipboardData: {
            types:   content === '' ? ['text/plain'] : ['application/x-lexical-editor', 'text/plain'],
            files:   [],
            getData: (type: string) => (type === 'application/x-lexical-editor' ? content : type === 'text/plain' ? text : ''),
        },
        preventDefault: () => {},
    });

    update(editor, () => { lexical.dispatchCommand(PASTE_COMMAND, event); });
}

/**
 * A bare Lexical editor after three updates: `abc` is written, edited to
 * `abcd`, then an update only marks that text node dirty and adds an empty
 * paragraph — one dirty leaf, text as before, document changed.
 */
function bareEditorAfterBlockAddingUpdate(register: (editor: LexicalEditor) => void): { editor: LexicalEditor; blocks: () => string[] } {
    const editor = createEditor({ onError: (error) => { throw error; } });
    let text!: TextNode;

    register(editor);
    editor.update(() => {
        text = $createTextNode('abc');
        $getRoot().append($createParagraphNode().append(text));
    }, { discrete: true });
    editor.update(() => { text.setTextContent('abcd'); }, { discrete: true });
    editor.update(() => {
        text.markDirty();
        $getRoot().append($createParagraphNode());
    }, { discrete: true });

    return { editor, blocks: () => editor.read(() => $getRoot().getChildren().map((child) => child.getTextContent())) };
}
```

---

## Ordered Implementation Steps

Run every `npx vitest` command from `packages/lib`.

1. **Create the test file with every row except K2.** Create
   `packages/lib/tests/component/markdown-editor-history.test.ts` with the
   SPDX header, a short header comment naming this plan, the helpers from
   `## Internal Structure`, and one `it` per row of `## Expected Behaviour`
   except K2. Name each `it` with its row ID first (`'P1: …'`).
   Check: `npx vitest run tests/component/markdown-editor-history.test.ts` —
   P1, P2, P3, P4, P5, T3 and D1 fail; every other row passes.

2. **Create the module.** Create
   `packages/lib/src/typescript/lib/component/editor/markdownHistory.ts` with
   exactly the content given in `## Internal Structure`.
   Check: `npm run typecheck` (repo root) passes.

3. **Add row K2** to the test file, importing `registerMarkdownHistory` from
   `~/component/editor/markdownHistory`.
   Check: K1 and K2 pass.

4. **Wire the module into `ensureEditor`.** In `MarkdownEditor.ts` make edits
   1, 2 and 3 of `## Internal Structure`.
   Check: `grep -n 'registerHistory\|HISTORY_DELAY_MS\|@lexical/history' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`
   (repo root) — zero matches.
   Check: `npx vitest run tests/component/markdown-editor-history.test.ts` —
   only T3 fails.

5. **Tag `paste()`.** In `MarkdownEditor.ts` make edit 4 of
   `## Internal Structure`. Step 5 is a second change, separate from the
   guard of steps 2–4.
   Check: `grep -n 'tag: PASTE_TAG' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`
   — one match.
   Check: `npx vitest run tests/component/markdown-editor-history.test.ts` —
   every row passes.

6. **Add the changelog entry** given in `## Documentation Impact`.

7. **Run `## Verification`** in full.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownHistory.ts` |
| Create | `packages/lib/tests/component/markdown-editor-history.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All rows below run offline in
`packages/lib/tests/component/markdown-editor-history.test.ts`. The manual
rows at the end need a browser.

Notation:

- `typed(DOC)` is `loadAndType(DOC)`: the document with `x` typed at the end
  of `omega`, so `DOC` with `omegax` in place of `omega`.
- `lexical` is `lexicalOf(editor)`.
- A selection reads `"text"@offset>"text"@offset`, anchor first.
- `before` is `snapshot(editor)` taken just before the operation.
- "undo = `before`" means `expect(undo(editor)).toEqual(before)`: the saved
  Markdown, the whole document state and the selection all match.
- **Today** is the result on commit `4f68f3556`.[^today]

### A paste is one undo step (P rows)

| # | Start | Steps | Expect | Today |
|---|---|---|---|---|
| P1 | `typed(COLUMNS)` | `selectText` `w0 w1`@4 → `w2 w3`@0; `nodes = copySelection`; `selectText` `w2 w3`@0 → `w0 w1`@4; take `before`; `pasteNodes(nodes)`; take `after` | undo = `before`. Then `REDO_COMMAND`: `snapshot().state` = `after.state`. Then undo = `before` again. Then `undo().value` = `COLUMNS` | fails: the first undo gives `COLUMNS` |
| P2 | `typed(COLUMNS)` | `selectText` `w0 w1`@4 → `w2 w3`@0; `content = lexical.read(() => $getLexicalContent(lexical) ?? '')`; `selectText` `w2 w3`@0 → `w0 w1`@4; take `before`; `nativePaste(editor, '1\n', content)` | undo = `before`. Then `undo().value` = `COLUMNS` | fails as P1 |
| P3 | `load(COLUMNS)` (nothing typed) | as P1, up to `pasteNodes(nodes)` | undo = `before` | fails: undo does nothing, so the state still holds the paste |
| P4 | `typed(TWO)` | `selectText` `alpha beta`@6 → @10; take `before`; `nativePaste(editor, 'beta')` | after the paste: value `alpha beta\n\nomegax`, selection `"alpha beta"@10>"alpha beta"@10`. undo = `before`, whose selection is `"alpha beta"@6>"alpha beta"@10`. Then `undo().value` = `TWO` | fails: the first undo gives `TWO` |
| P5 | `typed(TWO)` | `selectText` `alpha beta`@6 → @10; take `before`; `vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('beta')`; `await editor.paste()` | after the paste: value `alpha beta\n\nomegax`. undo = `before`. Then `undo().value` = `TWO` | fails as P4 |
| P6 | `typed(BETAS)` | `selectText` `beta two`@0 → @4; take `before`; `nativePaste(editor, 'beta')` | after the paste: value `beta one\n\nbeta two\n\nomegax`. undo = `before`. Then `undo().value` = `BETAS` | passes |
| P7 | `typed(TWO)` | `selectText` `alpha beta`@10; `nativePaste(editor, 'ONE')`; `nativePaste(editor, 'TWO')` | value `alpha betaONETWO\n\nomegax`; three undos give `alpha betaONE\n\nomegax`, `alpha beta\n\nomegax`, `TWO` | passes |

### A paste and the typing around it are separate steps (T rows)

Every step of a row runs inside the 300 ms window: the test does not wait.

| # | Start | Steps | Expect | Today |
|---|---|---|---|---|
| T1 | `typed(TWO)` | `nativePaste(editor, 'ONE')` at the caret the typing left | value `alpha beta\n\nomegaxONE`; two undos give `alpha beta\n\nomegax`, `TWO` | passes |
| T2 | `typed(TWO)` | clipboard `'Z'` (as P5); `await editor.paste()` | value `alpha beta\n\nomegaxZ`; two undos give `alpha beta\n\nomegax`, `TWO` | passes |
| T3 | `load(TWO)` | `update`: `const empty = $createParagraphNode(); $getRoot().getFirstChildOrThrow().insertAfter(empty); empty.select();` Clipboard `'Z'`; `await editor.paste()`; dispatch `CONTROLLED_TEXT_INSERTION_COMMAND` `'q'` | value `alpha beta\n\nZq\n\nomega`; two undos give `alpha beta\n\nZ\n\nomega`, `TWO` | fails: the first undo gives `TWO` |

### A cut and a drop are one undo step (C, D and N rows)

A real drop needs a browser, because Lexical reads the drop point from the
page. D1 and D2 run the updates a drop runs.[^drop-rows]

| # | Start | Steps | Expect | Today |
|---|---|---|---|---|
| C1 | `typed(TWO)` | `selectText` `alpha beta`@0 → @6; take `before`; `editor.cut()` | value `beta\n\nomegax`. undo = `before`. Then `undo().value` = `TWO` | passes |
| D1 | `typed(TWO)` | `selectText` `alpha beta`@6 → @10; `nodes = copySelection`; take `before`; one `update`: `const selection = $getSelection(); if ($isRangeSelection(selection)) { selection.removeText(); $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), selection); }` | after it: value `alpha beta\n\nomegax`. undo = `before`. Then `undo().value` = `TWO` | fails: the first undo gives `TWO` |
| D2 | `typed(TWO)` | `selectText` `alpha beta`@2 → @8; `update`: `$splitAtPointCaretNext($getTextPointCaret($textNode('alpha beta'), 'next', 5))` | selection still `"alpha beta"@2>"alpha beta"@8`; `undo().value` = `TWO` (no step was left) | passes |
| N1 | `typed(TWO)` | `selectText` `alpha beta`@2 → @8; `update`: `$textNode('alpha beta').markDirty()` | `undo().value` = `TWO` (no step was left) | passes |

### Source mode is unaffected (S row)

| # | Steps | Expect | Today |
|---|---|---|---|
| S1 | `new MarkdownEditor('hello', { mode: 'source' })`; `vi.spyOn` the `paste` of `(editor as unknown as { _codeEditor: { paste(): Promise<boolean> } })._codeEditor` with `mockResolvedValue(true)`; `vi.spyOn(DOM.source, 'readClipboardText')`; `await editor.paste()` | resolves `true`; the source editor's `paste` was called once; `readClipboardText` was not called | passes |

### The upstream rule and the guard on a bare editor (K rows)

| # | Steps | Expect | Today |
|---|---|---|---|
| K1 (canary) | `const history = createEmptyHistoryState()`; `bareEditorAfterBlockAddingUpdate((editor) => { registerHistory(editor, history, 300); })` | `blocks()` = `['abcd', '']`; `history.undoStack` has length 1; after one `UNDO_COMMAND`, `blocks()` = `['abc']` | passes |
| K2 | `bareEditorAfterBlockAddingUpdate((editor) => { registerMarkdownHistory(editor); })` | `blocks()` = `['abcd', '']`; after one `UNDO_COMMAND`, `['abcd']`; after a second, `['abc']` | cannot run: the module does not exist |

Put this comment above K1, as the existing canaries do:

```typescript
// When this fails after a Lexical upgrade, `@lexical/history` no longer
// merges an update on the strength of one unchanged text leaf — delete the
// proxy in `markdownHistory.ts` (call `registerHistory` with the editor
// itself) and this canary.
```

### Manual (browser) checks

Run `npm run dev` at the repo root and open **MD Editor**. Make a two-column
region (right-click → Columns → 2), type `Left one` and `Right one` in the
columns, and add a paragraph `Below para` after the region.

| # | Steps | Expected |
|---|---|---|
| M1 | Type `!` at the end of `Below para`. Drag from the middle of `Left one` to the start of `Right one`, Ctrl/Cmd+C, Ctrl/Cmd+V, then Ctrl/Cmd+Z once | the document and the selection are as before the paste; the `!` is still there. A second Ctrl/Cmd+Z removes the `!` |
| M2 | Type `!` again. Double-click `Below`, Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+Z once | `Below` is selected again; the `!` is still there |
| M3 | Type `!` again. Double-click `Below`, right-click → Copy, right-click → Paste (allow the clipboard read), Ctrl/Cmd+Z once | as M2 |
| M4 | Select `Left` and drag it onto the end of `Below para`. Ctrl/Cmd+Z once | `Left` is back in its column and selected; nothing else changed |
| M5 | Type `?` at the end of `Below para`. Select a word, press the mouse on it, move a few pixels and release inside the selection. Ctrl/Cmd+Z once | the `?` is removed: the drop that moved nothing left no step |
| M6 | Select a word, Ctrl/Cmd+X, Ctrl/Cmd+Z once | the word is back and selected |
| M7 | Switch to source mode. Select a word, Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+Z | undo behaves as it did before this change |

---

## Verification

- `npm run typecheck` (repo root) and `npm -w packages/lib run typecheck:test`.
- `npx vitest run tests/component/markdown-editor-history.test.ts` (from
  `packages/lib`, as every `npx vitest` command here): every row passes.
- `npx vitest run tests/component/markdown`: every Markdown suite passes.
- `npm test` (repo root): full suite green.
- `npm run lint` (repo root): zero errors.
- `grep -rn 'registerHistory(' packages/lib/src` (repo root): one match, in
  `markdownHistory.ts`.
- `grep -n 'registerHistory\|HISTORY_DELAY_MS\|@lexical/history' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`:
  zero matches.
- `npm run docs:api` (repo root) finishes with zero warnings.
- Manual rows M1–M7.
- For whoever holds the seeded paste fuzz (a scratch file, never
  committed): copy
  `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/column-paste/zz-column-paste-fuzz.test.ts`
  into `packages/lib/tests/component/`, run
  `FUZZ_SEED=<seed> FUZZ_N=3000 FUZZ_OUT=<file>.json npx vitest run tests/component/zz-column-paste-fuzz.test.ts`
  for seeds 2207, 5521 and 7703, then delete the copy. Each seed reports no
  failure whose `check` is `undo` (one each before this change). The fuzz's
  other failures belong to other plans, so the test itself still ends red.

---

## Documentation Impact

No public API changes. `registerMarkdownHistory` is internal: no entry point
exports it, and no component page describes undo steps.

- **`docs/reference/changelog/next.md`**, section **Fixed → Components**
  ([:428](../packages/lib/docs/reference/changelog/next.md#L428)). Add this
  entry after the entry that starts
  **A read-only `MarkdownEditor` no longer lets the browser edit its shown
  text.**, with a blank line on each side:

  ```markdown
  - **`MarkdownEditor` undoes a paste as one step.** A paste over a selection
    could leave no undo step of its own: when it put back the text of the
    one text node it touched — a selection copied and pasted over itself, or
    the selected word pasted over itself — the editor merged it into the edit
    before. One Ctrl/Cmd+Z then took back that earlier edit together with
    the paste, or did nothing when there was none, even where the paste had
    added or removed a block. A selection dropped at its own edge did the
    same. A paste, cut or drop that changes the document or replaces a
    selection is now one undo step, and undoing it restores the document and
    the selection as they were. A character typed right after `paste()` put
    a single character into an empty block is no longer undone together with
    it. No consumer action is needed.
  ```

---

## Potential Challenges

- **An undo sent too early undoes nothing.** `UNDO_COMMAND` dispatched before
  the pending update commits runs before the history has recorded that
  update. `loadAndType` commits its typing with a `getValue()` call. A row
  that types or pastes and then undoes reads the value first, as its Expect
  column lists; keep that order, above all in T3.
- **`PASTE_COMMAND` needs four global classes offline.** `registerRichText`
  tells events apart by class name; the `beforeEach` stubs give it
  `ClipboardEvent`, `DragEvent`, `InputEvent` and `KeyboardEvent`.
- **The canary must use the real `registerHistory`.** K1 imports
  `registerHistory` from `@lexical/history` and never goes through
  `registerMarkdownHistory`. A canary behind the guard could not notice an
  upstream fix.
- **K2 imports the new module.** A test file that imports a missing module
  fails as a whole, so K2 is added in step 3, after the module exists.
- **Unused names fail the typecheck.** `tsconfig.lib.json` rejects unused
  locals and imports: remove the `@lexical/history` import and
  `HISTORY_DELAY_MS` from `MarkdownEditor.ts` in the same step that removes
  their last use.
- **The proxy's `get` trap must bind functions.** Returning
  `Reflect.get(...)` unbound makes the editor's methods run with the proxy
  as `this`. Keep the trap as written; `registerMarkdownShortcutsOutsideRawBlocks`
  uses the same one.
- **Do not add a tag to "fix" a red P or D row.** No history tag changes
  rule 5. A red row after step 4 means the module is not wired in or its
  content differs from `## Internal Structure`.

---

## Critical Files

- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts):
  `registerMarkdownShortcutsOutsideRawBlocks` (L2034–2100, the proxy
  precedent), `ensureEditor`'s registrations (L4590–4637), `paste()`
  (L3908–3949), `$cutGuardedRange` and its `CUT_TAG` update (L1139–1180),
  `insertImage`'s update options (L4217), the `"lexical"` import (L19–29),
  the `@lexical/history` import (L45), `HISTORY_DELAY_MS` (L83–87).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts):
  `registerWritableStateRules` (L73, the module-shape precedent).
- [markdown-editor-command-crashes.test.ts](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts):
  the upstream canaries (L611–660, the canary precedent) and the
  `PASTE_COMMAND` test with its global stubs (L400–419).
- [markdown-editor-columns.test.ts](../packages/lib/tests/component/markdown-editor-columns.test.ts):
  the helpers to copy (L25–134) and the existing undo row U3 (L649).
- [markdown-editor-table-edge.test.ts](../packages/lib/tests/component/markdown-editor-table-edge.test.ts):
  the undo rows and the note on committing before an undo (L832–885).
- `node_modules/@lexical/history/dist/LexicalHistory.dev.mjs`:
  `createMergeActionGetter` (L128–206; rule 4 at L186, rule 5 at L192–197,
  the paste and cut tags at L163), `isTextNodeUnchanged` (L114),
  `getDirtyNodes` (L37), `applyChange` in `registerHistory` (L292–336).
- `node_modules/@lexical/rich-text/dist/LexicalRichText.dev.mjs`:
  `onPasteForRichText` and `onCutForRichText` (L564–594), which tag their
  updates `PASTE_TAG` and `CUT_TAG`.

---

## Non-Goals

- **What a paste leaves behind.** The empty paragraph the paste in P1 adds,
  and the other document shapes the paste fuzz reports, belong to the plans
  for those pastes. This plan only makes every paste undoable.
- **Tagging `cut()` or a drop.** Neither needs a tag.[^paste-tag][^no-tags]
- **Steps Lexical pushes for a command that changes nothing.**
  `setBlockType("paragraph")` on a paragraph pushes a step whose undo shows
  no change. That command is not a paste, cut or drop and rule 5 plays no
  part in it.
- **The selection an undo restores after a command run on a caret.**
  `toggleBold()` and `cut()` on a caret first select the word; undo restores
  that word selection, not the caret. The document is restored exactly.
- **Source mode.** Source mode uses the source editor's own history.
- **Upgrading Lexical, or sending the fix upstream.**
- **A shared helper for the two editor proxies.** The saving is eight
  lines.[^proxy]
- **Committing the paste fuzz.** The fuzz stays a scratch file.

---

## Addendum: Measurements

All runs were on commit `4f68f3556` with `@lexical/history` 0.49.0. The
guard was applied without editing any source file, by wrapping
`registerHistory` in a test setup file.

**Seeded paste fuzz, 3000 pastes per seed.** The fuzz pastes in an update
with no tag.

| Seed | As is | Paste update tagged `PASTE_TAG` | With the guard, no tag |
|---|---|---|---|
| 2207 | 1 `undo` failure (paste 2377) | 1 | 0 |
| 5521 | 1 (paste 2137) | 1 | 0 |
| 7703 | 1 (paste 2014) | 1 | 0 |
| 601 | 0 | not run | 0 |

With the guard, every other failure of each seed is the same failure as
before, paste by paste (97, 88, 85 and 86 of them).

**Library test suite with the guard.** 12 926 tests passed. One other test,
`import-without-dom › ./glyphs`, hit its 30 s timeout while five fuzz runs
shared the machine, and passed when run alone.

**Commands and keys.** 63 rows were run twice: once as is, once with a
character typed just before, inside the 300 ms window. 52 rows change the
document, and each was exactly one undo step in both runs. Rule 5 applied in
one row only, `clearFormatting()` with nothing to clear, where the document
did not change. The verdicts were the same with and without the guard. Three
rows need a browser DOM and three need a browser clipboard (Lexical's own
cut handler); they did not run.

**Upstream.** Rule 5 reads the same in `@lexical/history` 0.52.0 (the latest
release) and in `0.52.1-nightly.20261005.0`.

---

## Notes

[^cause]: Confirmed three ways. Logging each paste's update showed the three
    fuzz cases with one dirty leaf, text as before, and four to nine dirty
    elements. Tagging the fuzz's paste update `PASTE_TAG` left all three
    failures in place, and so did adding `HISTORY_PUSH_TAG` to one of them,
    which rules out rule 4 and the tags. Defeating rule 5 alone removed all
    three and changed no other fuzz result. An earlier reading blamed
    Lexical's "continuation of typing" classification; that is rule 4, which
    a tagged paste already bypasses. See `## Addendum: Measurements`.

[^contract]: The words "or replaced a selection" matter. A paste of `beta`
    over the selected `beta` changes no text, yet today its undo takes back
    whatever was edited before it — the same failure as the reported one,
    seen from a document with history. Making it a step means its undo
    re-selects `beta`, which the user can see, and matches what a paste of
    the same text already does today in other node shapes (P6). The
    alternative, leaving no step for any paste that changes no text, was
    rejected: Lexical already pushes such pastes in most shapes, so taking
    those steps away would need a whole-document comparison on every paste
    and would change behaviour that works today. An operation that
    changes neither document nor selection has nothing an undo could
    restore, so it leaves no step; a step there would make Ctrl/Cmd+Z appear
    to do nothing.

[^measured]: The two wider questions were checked directly. *Does a paste
    right after typing merge with the typing?* No for a native paste
    (`PASTE_TAG`), and no for `paste()` at a caret in text (T1, T2). The one
    shape found is the reverse: `paste()` of exactly one character into an
    empty block looks to rule 4 like a typed character, so a character
    typed within 300 ms after it merges into the paste (T3). *Does a paste
    that changes nothing visible push an empty step?* A paste over a
    selection always moves the selection, so its step, where there is one,
    has a visible undo. Whether there is one depends today on how many text
    nodes the paste touched (P4 against P6); after this plan there always
    is. See `## Addendum: Measurements` for the commands and keys.

[^module]: The alternative was to put the three functions into
    `MarkdownEditor.ts` beside `registerMarkdownShortcutsOutsideRawBlocks`.
    That file is 5363 lines and is edited by four sibling plans at the same
    time. A new module keeps this plan's edits to `MarkdownEditor.ts` down to
    an import, one registration line, one deleted constant and one option,
    and gives the history its own unit to test (K2).

[^proxy]: Four other ways to change the history's decision were considered.
    (1) Keep the `HistoryState` object and push the missing step by hand
    after the history's listener ran. This repeats the history's own push
    branch — clearing the redo stack, dispatching `CAN_UNDO_COMMAND` — and
    must tell a rule 5 merge from a rule 4 merge after the fact. (2) Tags:
    measured not to work. (3) Copy `registerHistory` into the library: some
    300 lines of third-party logic to keep in step with Lexical. (4) Upgrade
    Lexical: rule 5 is unchanged through 0.52.0. The proxy is a dozen lines,
    and the stack already carries one for the same reason. The two proxies'
    `get` traps are alike; a shared helper was left out because it means
    rewriting the working `registerMarkdownShortcutsOutsideRawBlocks` to
    save eight lines.

[^no-tags]: Three reasons. A drop cannot be tagged safely: Lexical runs it
    inside its own command, and a drop released inside its own selection
    splits and re-joins one text node without moving anything, so a tag that
    forced a step would leave one that undoes nothing (D2). A tag covers
    only the routes that set it, while rule 5 can misread any update; the
    fuzz's own route, a direct node insert, carries none. And `PASTE_TAG`
    and `HISTORY_PUSH_TAG` were measured not to prevent the merge. Reading
    what the update did covers every route with one rule.

[^extra-key]: The history reads `dirtyLeaves` in three ways. `hasDirtyNodes`
    and `getChangeType` ask whether the set is empty; the set already was
    not empty. `getDirtyNodes` looks each key up in the node map and skips a
    key with no node, so the update's classification for rule 4 is the same.
    Rule 5 asks whether the set's size is exactly 1. Only that third answer
    changes. The copy is
    handed to the history's listener alone; every other update listener
    still receives the original payload. Cost: for each update with one
    dirty leaf — every typed character — two reads of one node's text. The
    whole-document comparison runs only when that text is unchanged and no
    selection was replaced, which typing never produces.

[^paste-tag]: Under rule 4, `paste()` of one character into an empty block
    creates a new one-character text node with the caret after it, which is
    how Lexical recognises a typed character. A character typed within 300
    ms then merges into the paste's step (T3). `PASTE_TAG` makes rule 4
    treat the update as a paste. `cut()` needs no tag: a cut starts from a
    selected range, and rule 4 never classifies an update that starts from a
    range as typing (C1); the guard covers rule 5. Tagging `cut()` would
    change no behaviour.

[^canary]: The stack's rule for a workaround of a Lexical defect is: name the
    version range and the canary in the guard's `@remarks`, and keep a test
    that fails once Lexical is fixed. `$moveRangeEdgesOutOfLinks`
    (`MarkdownEditor.ts`, remarks at L507–513) and the stale-focus guard
    (remarks at L1003–1011) follow it.

[^today]: A row marked "fails" was red on that commit, and a row marked
    "passes" was green. P1–P3 depend on what that paste leaves in the
    columns. If an earlier plan has changed that, P1–P3 may already pass
    before this change; keep them as written. P4, P5, D1 and T3 use plain
    text only and do not depend on any other plan.

[^drop-rows]: For a drop inside one editor, Lexical's `$doDrop`
    (`node_modules/@lexical/clipboard/dist/LexicalClipboard.dev.mjs`,
    L741–814) splits the text at the drop point, removes the dragged range,
    and inserts the dragged nodes at the drop point, all in one update with
    no tag. D1 is that update for a drop at the range's own end. When the
    drop point lies inside the dragged range, `$doDrop` stops right after
    the split; D2 is that update. Lexical's own Ctrl/Cmd+X handler needs a
    browser clipboard, so C1 uses `cut()` and M6 covers the key.

---

## Implementation Notes

Implemented on `feature/markdown-editor-paste-undo-merge`, on top of
`feature/markdown-editor-table-cells-paste-empty-column` at `79903dbc1`,
which these notes call "the parent". The plan was written against
`4f68f3556`; four branches landed in between
(`markdown-raw-block-html-tail-parity`,
`markdown-editor-list-item-block-paste`, `markdown-editor-list-item-node`
and `markdown-editor-table-cells-paste-empty-column`). Scratch files named
below are under
`~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/impl/paste-undo-merge/`
("the scratch folder"). They are not in the repository.

### Decisions that await the user's sign-off

The user was not available while this plan was implemented. Each decision
below was made by the agent that ran the work and stands until the user
confirms or reverses it.

**1. A plain-text Ctrl/Cmd+V into a raw Markdown block is tagged as a
paste, which the plan does not have.** The plan tags `paste()` and takes
every native paste to carry `PASTE_TAG` already. One does not: the
editor's own handler for a plain-text paste into a raw Markdown block
(`$pastePlainTextIntoRawBlock`) takes the paste before Lexical's handler,
which is the only place that sets the tag. One character pasted on an
empty line of such a block was therefore undone together with a character
typed right after it, on the parent and on this branch as first
implemented: the defect of row T3 on another route. The first review
found it. The handler now tags its update. This is behaviour beyond the
plan, so it has a code commit and a documentation commit of its own
("Keep a plain-text paste into a raw Markdown block apart from typing in
undo", "Document the undo step of a paste into a raw Markdown block") and
rows T4 and T5. If the user wants it elsewhere, those two commits come off
the branch whole.

**2. The guard compares two range selections by their points, where the
plan's module compares them with Lexical's `is`.** `is` also compares the
text format and style a range carries for the text typed next. With it, a
command that left the document and the selected range as they were but
changed that format (the first review found `toggleInlineCode()` over a
whole code span, selected by code) got a step that undoes nothing, and
lost the redo stack. That contradicts the plan's own table ("same
document, a range before, the same range after: no step"), so the code
was changed to do what the table says: `selectsTheSame` in
`markdownHistory.ts`, row N3. It is part of the plan's fix and is in its
code commit.

### The plan against the code as it is now

The four branches changed the paste paths a great deal, so every claim of
the plan was checked again before a test was written.

**The cause is the same.** `probes/zz-cause.test.ts` in the scratch folder
replays the three failing fuzz records on the parent and logs each update
as the history's listener receives it (`probes/cause.parent.out`). In all
three the paste is one update with exactly one dirty leaf, a text node
that reads as before; five to nine dirty elements; and a changed document.
Rule 5 of the plan's table merges that update. Nothing else is involved:
the undo stack is empty after the paste.

| Fuzz record | Dirty leaves | Dirty elements | Tags | Document |
|---|---|---|---|---|
| seed 2207, paste 2377 | 1, text as before | 9 | `markdown-run-edges` | changed |
| seed 5521, paste 2137 | 1, text as before | 5 | `markdown-run-edges` | changed |
| seed 7703, paste 2014 | 1, text as before | 5 | `markdown-run-edges` | changed |

**What the four branches changed, and what that means here.**

- A paste that goes through `PASTE_COMMAND` or
  `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` now carries the tag
  `markdown-run-edges`, which a listener of `registerRunEdgeRules` sets on
  those commands. `paste()` dispatches neither and carries no such tag.
  The history does not read that tag. A native paste that Lexical's own
  handler makes carries `paste` as well. Neither stops rule 5, as the plan
  measured for `paste`.
- The paste listeners those branches added (`registerTablePartPaste`,
  `registerItemBlockPaste`, `registerItemTextPaste`, and the list item
  node's own hooks) all act inside the paste's own update. None adds an
  update or a history entry, as their notes say. Of the 63,668 single
  pastes, cuts and drops of the differential check below, none commits
  more than one update that touches a node.
- `registerItemTextEdits`, which queued a second update behind a paste
  into a list item's text, is gone.
- The fuzz has no other failure left. The plan's addendum counts 85 to 97
  other failures per seed; they were fixed by the plans in between.

**The plan's red phase holds as written.** With the test file in place and
no source change, P1 to P5, T3 and D1 failed and the other nine rows
passed. With the module wired in, T3 alone failed. With the tag, all
passed.

**`@lexical/history` upstream.** Rule 5 reads the same in the installed
0.49.0, in 0.52.0 (the latest release) and in
`0.52.1-nightly.20261009.0`, read from the published packages on
2026-10-10.

### Deviations from the plan

Each entry says what the plan called for, what was done, and why.

**The registration is in `buildEditor`.** The plan names `ensureEditor`.
The registrations moved to `buildEditor` since; `registerMarkdownHistory`
stands where `registerHistory` stood, between `registerTablePlugin` and
`registerMarkdownShortcutsOutsideRawBlocks`.

**Line numbers.** Every line number of the plan has moved. Where the
things are now, in `MarkdownEditor.ts` unless another file is named:

| Plan | Now |
|---|---|
| `registerHistory` call, L4595 | L6992, in `buildEditor` (L6963) |
| `paste()`'s update options, L3941 | L6177 |
| `@lexical/history` import, L45 | was L49; removed |
| `HISTORY_DELAY_MS`, L83–87 | was L95–99; now in `markdownHistory.ts` |
| the new import, "after L60" | L69, after the `markdownWritable.js` import, which was the plan's L60 |
| `registerMarkdownShortcutsOutsideRawBlocks`, L2054–2100 | L3361; its proxy now replaces `update` and `registerCommand` too |
| `$cutGuardedRange`'s `CUT_TAG`, L1176 | L2691 |
| `insertImage`'s update options, L4217 | L6533 |
| `registerWritableStateRules`, `markdownWritable.ts:73` | `markdownWritable.ts:79` |
| the canaries, `markdown-editor-command-crashes.test.ts:611–660` | L1040 of that file, and `markdown-editor-table-edge-mounted.test.ts:323` |

**The module differs from the plan's text in one place.** The plan gives
`markdownHistory.ts` whole. It was first taken character for character.
After the first review, `isOwnUndoStep` asks `selectsTheSame(before,
after)` where the plan has `before.is(after)`, and the module has that
function and two more imports (decision 2). Everything else is the plan's
text.

**A second edit to a paste handler.** `$pastePlainTextIntoRawBlock`
(`MarkdownEditor.ts` L1664) calls `$addUpdateTag(PASTE_TAG)` (decision 1).
The plan's grep for `tag: PASTE_TAG` still gives one match; the handler
runs inside the command's update and has no options to pass, so it adds
the tag as `$editWritably` adds `HISTORIC_TAG`.

**Five rows were added.** Each pins something the plan states and no row
of the plan fails without.

| Row | Pins | Why it was added |
|---|---|---|
| N2 | the plan's table, "same document, a caret before: no step" | N1 and D2 start from a range that stays; a mutant that counted a caret as a replaced selection passed every row. Written after the code, against that mutant, and seen to fail under it |
| N3 | the plan's table, "a range before, the same range after: no step", for a range whose carried format and style alone change | the first review's finding; written first and seen to fail |
| P8 | P4 with the word selected backwards | a mutant that compared the anchors alone passed every row: in P4 the anchor moves and the focus stays, in P8 the other way round. Written after the code, against that mutant, and seen to fail under it |
| T4 | decision 1: a character typed after a native paste of one character on an empty line of a raw block | the first review's finding; written first and seen to fail |
| T5 | the same two the other way round | passes on the parent too; a guard |

**Test helpers.** The helpers copied from the columns test carry the doc
comments they have there. `clipboardHolds(text)` folds the
`vi.spyOn(DOM.source, 'readClipboardText')` line that P5, T2 and T3
repeat, and `selectEmptyRawLine` places the caret for T4 and T5. D1 and
N3 name the result of `$isRangeSelection` before they test it.

**One code commit for the guard and for `paste()`'s tag.** The plan's step
5 calls the paste tag "a second change, separate from the guard". Both
serve one fix with one changelog entry (a paste is one undo step), so
they are one code commit and one documentation commit. The tag of
decision 1 is apart, as said there.

**The fuzz** was run from the mapped copy of the harness
(`impl/list-item-node/harness/`), not from the path the plan gives; that
copy still names `listitem`. All eleven seeds were run, in all four
variants, and the two other fuzz families with them.

### Results

**Checks**, at the final code: `npm run typecheck`,
`npm -w packages/lib run typecheck:test` and `npm run lint` report
nothing; `npm test` passes 557 files, 16,104 tests (2 todo); `npm run
docs:api` gives zero warnings; `npm run docs:llms:check` reports 0
unaccounted; `npm run build:lib` builds. The new file holds 22 tests. The
two greps of the plan's *Verification* give one match and none.

**Mutants.** Sixteen single-change mutants of the module and of the edits
to `MarkdownEditor.ts` were run against the new file (`mutants.py`,
`mutants.out`). Thirteen fail at least one row. Three pass every row, and
no row can tell them from the code:

- The extra key replaces the dirty leaf, or the set is emptied, instead of
  the key joining it. An update the guard changes has one dirty leaf whose
  text is as before, and such an update is never typing to rule 4, with
  the leaf in the set or without it. Keeping the leaf is the plan's
  choice: the history then reads the same set plus one key.
- The proxy hands out the editor's methods unbound. They then run with
  the proxy as `this`, and every read and write still reaches the editor.
  The binding is kept as the plan asks, as the other proxy has it.

The document half of `isOwnUndoStep` is pinned by K2 alone: in the editor
no update was found that changes the document through one unchanged dirty
leaf from a caret (every paste of that kind starts from a range, which
the selection half also catches).

**Fuzz**, the mapped harnesses, node keys masked, run on an archive of
`1690c61d9` (a commit from before the review fixes were folded in; the
folded branch has the same source tree), against the parent's
baselines (`impl/table-cells-paste/{fuzz,lif,r7}`). Results are in
`fuzz-2/`, `lif-2/` and `r7-2/` of the scratch folder; the run before the
first review's fixes (`fuzz-1/`, `lif-1/`, `r7-1/`) gave the same.

| Fuzz | Baseline | This branch |
|---|---|---|
| paste, 11 × 3,000 | 3 `undo` | 0 |
| paste, strict | 3 `undo` | 0 |
| table edge, and strict | 0 | 0 |
| list-edit, 11 × 1,500 | 14 failing documents | 14, the same records |
| the seventh reviewer's, 5 × 3,000 | 120 | 120, the same records |

The three `undo` records (seed 2207 paste 2377, seed 5521 paste 2137,
seed 7703 paste 2014) are gone in both paste variants. No record was
added and none changed, and `ran`, `skipped`, `withColumn` and
`nothingCopied` are the same in every seed. All 44 paste and table-edge
runs now end green.

**Differential check.** `diff/` in the scratch folder holds a runner that
plays a scenario file on an archive of this branch and of the parent and
writes an undo trace for each scenario: the document, the whole state and
the selection before and after the operation, every update as the
history's listener receives it, then the state after each undo until the
stack is empty, and after each redo. `cmp.py` compares the two sides.
Half of the scenarios type a character first, in a paragraph of its own,
so that a merged step has something to take back. `u5` runs twice, the
second time with the history's clock moved a second forward between
steps; `u4` and `u8` hold both kinds of scenario. The numbers are those
of the run at the final code, at 188 places: the 176 of the parent's
`places.ts` and twelve added after the first review (an empty line of a
raw block and of a code block; a whole code span, bold run, underlined
run, emphasis and link text as a range; a caret in a code span, a bold
run and a link's text).

| File | What it runs | Scenarios | Differ |
|---|---|---|---|
| `u1` | 36 clipboards (table parts, mixes, pastes that end in a table, a `:::` block, a list or a code block, plain words) pasted as Ctrl/Cmd+V does, at every place | 13,536 | 10 |
| `u2` | 9 clipboards by the fuzz's two untagged routes, at every place | 6,768 | 20 |
| `u3` | a range copied and pasted over itself, over itself selected the other way, and at its own start and end; every pair of text points of 12 documents; three routes | 23,424 | 720 |
| `u4` | plain text pasted natively and through `paste()`: the selected text, one character, two words, two lines, nothing; alone, twice, and before and after typing | 11,904 | 83 |
| `u5` | 58 keys and commands at every place, inside and outside the merge window | 43,488 | 0 |
| `u6` | the updates a drop inside the editor runs, at every range place | 244 | 10 |
| `u7` | the grid of the parent's fourth review, 6,512 pastes | 13,024 | 0 |
| `u8` | every ordered pair of 12 operations at 22 places | 12,672 | 11 |

**What the check did not run.** 3,184 of the 125,060 scenarios threw on
both sides, in the same way, and compared nothing:

- 2,492 in `u5` (1,246 in each of its two runs) and 668 in `u8`, all
  `window object not found`: the Backspace and Delete keys, the
  delete-word and delete-line commands and, at 42 places (a caret at an
  edge of a block or between blocks), the harness's own Backspace and
  Delete steps: wherever Lexical moves the selection through the browser
  to find what to delete. That is at a caret; over a range those keys and
  commands ran. They change text or join blocks,
  which rule 5 does not merge, but the check does not show it for a
  caret.
- 24 in `u3`: a range copied inside a table by the untagged routes
  (`Cannot read properties of undefined (reading 'cell')`, in
  `@lexical/table`'s insert).

Of the 121,876 scenarios that ran, 854 differ. In none does the operation
itself give another document or selection; only the undo steps differ.
Every one falls into one of four classes, and none is left over:

| Class | Count | What differs |
|---|---|---|
| The same text put back over a selection inside one text node (a word pasted or dropped over itself) | 740 | the parent has no step for it; this branch has one, and its undo re-selects the text |
| A paste over the copied range that adds a block | 60 | the same. All 60 are in a `:::` block: a range across two columns, or across the paragraphs of one `:::` block |
| `paste()` of one character that becomes a text node of its own, next to a typed character | 50 | the parent undoes both at once; this branch one at a time. 48 are the paste first and the character typed after it: at a caret that stands in no text (an empty block, a caret between blocks), on an empty line of a raw block, in a link's text, which `paste()` splits, and at a caret set by code in a code span or a bold run (such a caret carries no format, so the character goes between the two halves of the run). 2 are the other order, in a link's text |
| A plain-text Ctrl/Cmd+V of one character on an empty line of a raw block, then a typed character | 4 | the same (decision 1) |

In each of the 854 the parent's undo chain is this branch's with the new
step left out. The first two classes are exactly the scenarios in which
`isOwnUndoStep` answers yes for an update that rule 5 would merge. It
also answers yes for a format toggle that changes a whole text node's
format, where the history pushed already; those scenarios do not differ.
A toggle that changes neither the document nor the selected range is no
step on either side (row N3; the first reviewer's sweep of 18 commands
over every whole text node of 31 documents, 2,592 scenarios, run again at
the final code, gives the parent's result in every one:
`rv1-sweep/` in the scratch folder).

`cmp.py` also checks each side against the contract, without the other,
for the 63,668 scenarios of `u1` to `u4`, `u6` and `u7` that make one
paste, cut or drop. When the operation changed the document or replaced a
selected range, there must be exactly one new step, one undo must give
back the document, the state and the selection as they were, and the
redos the result; when it changed neither, there must be no new step. The
parent fails that in 828 scenarios and this branch in 28. Those 28 fail
on the parent as well and are not rule 5's doing: a step is left although
the document is the same (the first and the third entry under *Seen along
the way*). In `u4` and `u8`, wherever the second of two operations
changed the document, one undo returns to the state after the first,
except a typed character after a typed character inside the merge window,
which is one step by design (16,136 pairs; the parent fails 54 more).

**Browser**, Chromium against the worktree's demo (`MD Editor`), on its
sample document, which holds a two-column `:::` block. Selections were set
through the page's own selection, keys were real key presses with the
real clipboard, and the editor's updates were logged. All seven rows
were run before the first review's fixes; M1, M4, M5 and M6 were run
again at the final code, with the same results.

| Row | Result |
|---|---|
| M1 | `!` typed at the end of a heading; a range from the middle of `Left column.` to the start of `Right column.`; Ctrl+C, Ctrl+V. The paste is one update with one dirty leaf, tagged `paste` and `markdown-run-edges`, and adds an empty paragraph to the first column. One Ctrl+Z: the document and the selection are as before the paste, the `!` is there. A second Ctrl+Z removes the `!`. Passes |
| M2 | `!` typed again, a word selected, Ctrl+C, Ctrl+V, Ctrl+Z: the word is selected again, the `!` is there. Passes |
| M3 | The same with the context menu's Paste. The browser's permission prompt for a clipboard read cannot be answered from the tools used, so `navigator.clipboard.readText` was replaced by a function returning the word; the menu, `paste()` and the focus handling were the real ones. Ctrl+Z: the word is selected again, the `!` is there. Passes, with that limit |
| M4 | `Left` dragged from its column onto the end of the heading, as drag events carrying a real `DataTransfer` that Lexical's own drag-start handler filled. One update. Ctrl+Z: `Left` is back in its column and selected, nothing else changed. Passes |
| M5 | `?` typed, a word selected and dropped inside itself: one update, document and selection unchanged. Ctrl+Z removes the `?`. Passes |
| M6 | A word selected, Ctrl+X, Ctrl+Z: the word is back and selected. Passes |
| M7 | Source mode: a character typed, a word selected, Ctrl+C, Ctrl+V, Ctrl+Z. The paste alone is undone, the typed character stays. The source editor's history is its own and no code of this branch runs there |

Moving the selection in the mounted editor (six ranges and carets set one
after another) commits updates with no dirty node only, so no step can
come from a click or an arrow key. No console message.

Rows T3 and T4 have no browser run: a paste and a typed character must
fall within 300 ms of each other, and the tools used put more than that
between two key presses. They are pinned offline (T3, T4, T5, and the 54
scenarios of `u4` and `u8`).

**Demo.** No demo change: the plan adds no command or option.

### Seen along the way

Not changed here; each is the same on the parent. Most are steps the
history pushes although nothing changed, or selections an undo restores,
which the plan lists as non-goals.

- A drop released inside its own selection leaves a step that undoes
  nothing when the selection lies in a raw Markdown block or in a code
  span, a bold, underlined or emphasised run. The split touches two or
  three text nodes there, so rule 5 is not what decides (16 scenarios of
  `u6`).
- `toggleLink(null)` over a range that holds no link leaves a step that
  undoes nothing (56 scenarios of each run of `u5`), and so does
  `setBlockType("paragraph")` at a caret held as a point on the root after
  a table (1).
- Table cells copied by a range and pasted at the caret they were copied
  from are written over themselves. The document is the same and the
  caret has moved; the step's undo moves it back (12 scenarios of `u3`).
- The format toggles and `cut()` on a caret select the word first, and an
  undo restores that selection.
- The paste in M1 and in P1 to P3 still adds an empty paragraph to the
  first column, and the paste of fuzz record 2207 leaves a `:::` block
  holding an empty quote. What a paste leaves behind is the plan's first
  non-goal; each such paste is now one undo step.
- `paste()` at a caret inside a link's text splits the link and puts the
  pasted text between its halves, unlinked
  (`say [ab](http://x.y)Z[cd](http://x.y) here`). A typed character and a
  native paste stay inside the link.
- `toggleInlineCode()` over a whole code span leaves the span as it is
  when the range was set by code and carries no format of its own; only
  the format the range carries changes. This is the first reviewer's
  reproduction of decision 2's defect; the reviewer found no key or mouse
  route to such a range.
- Text composition (an IME) was not run. At a composition's end the
  history compares with the state the composition started from, while the
  guard reads the update's own previous state, so a composition that puts
  the selected text back may still be merged. The first review raised
  this from the source.

### For the plans that follow

- **A new workaround of a Lexical merge rule** goes into
  `markdownHistory.ts`, which owns the history's registration. The update
  listener the history gets is wrapped there; every other listener of the
  editor still receives the update as Lexical made it.
- **A handler that takes `PASTE_COMMAND` whole** (returns `true` ahead of
  `registerRichText`'s handler) must tag its update `PASTE_TAG` itself, as
  `$pastePlainTextIntoRawBlock` now does: Lexical's handler is the only
  other place that sets it. That handler and `paste()` are the two routes
  found that insert pasted text without the tag; the search was the
  differential check's `u4` and `u8` at 188 places, and a read of every
  `PASTE_COMMAND` listener (`$clearGuardedRangeBeforePastedText` and the
  run-edge tag return `false`).
- **When Lexical is upgraded**, row K1 tells whether rule 5 still merges
  an update that added a block. When it fails, the proxy goes and
  `registerHistory` gets the editor itself; rows P1 to P5, P8, D1 and K2
  then say whether the upgrade is enough.
- **Comparing two selections.** `RangeSelection.is` also compares the
  format and style the range carries. Code that asks whether a selection
  still selects the same text compares the points (`selectsTheSame`).
- **The differential runner** in `diff/` can be pointed at a later branch
  (`setup.sh <ref>`, then `runall-diff.sh`); `cmp.py <file>` sorts the
  differences, counts the scenarios that threw, and counts the contract
  checks on each side.
- **Fuzz baselines** for the next plan are `fuzz-2/`, `lif-2/` and `r7-2/`
  of the scratch folder: paste 0, paste strict 0, table edge 0 and 0,
  list-edit 14, the seventh reviewer's 120.

### Reviews

**First review.** Three blocking findings.

- A range whose points stay but whose carried text format changes counted
  as a replaced selection, because the plan's module compares selections
  with Lexical's `is`. A command that changed nothing else then left a
  step that undoes nothing and emptied the redo stack, where the parent
  left none. Fixed in the guard (decision 2, row N3). The reviewer's own
  sweep, run again, shows no difference from the parent.
- A plain-text Ctrl/Cmd+V into a raw Markdown block was never tagged as a
  paste, so the defect of row T3 was still there on that route. Not a
  regression: the parent has it. Fixed, as a change of its own (decision
  1, rows T4 and T5).
- Three statements of these notes did not hold: that `paste()` was the
  only route found that looks like typing; that every paste carries
  `markdown-run-edges`; and the differential check's totals, which left
  out the scenarios that threw on both sides. All three are corrected
  above, the last under *What the check did not run*.

Its advisory findings, none acted on in the code:

- T1 to T5 rely on the real 300 ms window: on a run stalled for longer
  between two steps they would pass without the fix. They fail without it
  on every run made here (the mutants, and the red phase).
- The guard and `paste()`'s tag are one code commit (see *Deviations*).
- Four multi-line statements of the test file have no blank line around
  them; the linter does not read test files.
- Text composition: recorded under *Seen along the way*.

**Second review**, by a fresh reviewer at `b00e64a6e` (before the fold;
the branch's tree but for this paragraph), after the fixes above. No blocking finding, which ends the audit after two rounds. It ran
the checks again on an archive of the branch, recounted the differential
check's numbers from the raw traces, ran seven mutants of its own (each
fails the rows named above), repeated M1 in Chromium, and folded the
fixups in a scratch clone with the tree unchanged. Its advisory findings,
none acted on in the code:

- The whole-document comparison in `isOwnUndoStep` runs for more than the
  plan's note says: also for Enter at the start of a block,
  `setBlockType("h1")` at a caret and a format toggle over a whole text
  node, each of which has one dirty leaf whose text is as before. Lexical
  pushes all three itself, so no step changes. The reviewer measured one
  serialisation of a 3,000-paragraph document at about 16 ms, so about
  32 ms for such an operation there. A test of what rule 5 itself reads
  (the leaf's parent and its own JSON) ahead of the comparison would skip
  them.
- A selected character typed over itself is a step of its own now, as a
  word pasted over itself is: on the parent one undo took back the edit
  before it. This follows from the plan's table. No row, no scenario of
  the differential check and no line of the changelog names it, since no
  scenario types the text it has selected.
- Backspace and Delete at a caret, which the differential check could not
  run, were run by the reviewer in Chromium on the branch: Enter at a
  paragraph's end, Backspace in the empty paragraph, Delete from the
  paragraph before it and Backspace inside text are one undo step each,
  with no console message. The three that join or split blocks have no
  dirty leaf, and Backspace inside text has one whose text changed, so the
  guard passes all four on.
- T1 to T5 and the wall clock, and the blank lines in the test file, as in
  the first review.
- `selectsTheSame` compares two ranges point by point as
  `MarkdownEditor.ts` L4471 already does; these notes did not cite it.
