---
depends-on: [markdown-demo-sample-table-width]
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/tests/component/code-editor.test.ts
---

# CodeEditor Bracket Pair Backspace — Implementation Plan

## Overview

In `CodeEditor`, typing `(` inserts `)` after the caret. Backspace right after should delete both characters, and the Keyboard table in [CodeEditor.md:283](packages/lib/docs/components/CodeEditor.md#L283) says it does. Today Backspace deletes only the `(` and leaves the `)` behind. The same happens for `[`, `{` and quotes, in every language and in `MarkdownEditor`'s source mode.

The cause is the order of one list. CodeMirror gives each key a list of *bindings* (a key paired with a command) and tries them in order. A command returns `true` when it handled the key, and `false` to pass the key on to the next binding. `mount()` builds the editor's bindings at [CodeEditor.ts:2162](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2162) with `defaultKeymap` ahead of `closeBracketsKeymap`. Both bind Backspace. `defaultKeymap`'s command, `deleteCharBackward`, deletes one character and returns `true`, so `closeBracketsKeymap`'s command, `deleteBracketPair`, never runs.[^cause]

This plan moves the list into one constant, `codeEditorKeymap`, ordered like CodeMirror's reference setup, `basicSetup`. `mount()` installs the constant. So does the typing harness in `code-editor.test.ts`: a set of helpers that type keys into a CodeMirror state offline, meaning in the unit tests, where no editor view is ever mounted. Every other key the editor binds was checked, and Backspace is the only one tried in the wrong order.[^audit] Three rows of the Keyboard table are corrected. No public API changes.

The plan touches [CodeEditor.ts](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts), [code-editor.test.ts](packages/lib/tests/component/code-editor.test.ts), [CodeEditor.md](packages/lib/docs/components/CodeEditor.md) and the changelog's [next.md](packages/lib/docs/reference/changelog/next.md).

---

## Architecture Decisions

### The editor's bindings follow `basicSetup`'s order

`codeEditorKeymap` lists `closeBracketsKeymap`, `defaultKeymap`, `searchKeymap`, `historyKeymap`, `foldKeymap`, then `indentWithTab`. That list order is `basicSetup`'s (`node_modules/codemirror/dist/index.js:67–75`) without its `completionKeymap` and `lintKeymap`, plus `indentWithTab` at the end.[^full-order]

The rule the order serves: for one key, an earlier binding is tried first, and a later one runs only when every earlier one returned `false`.

| Backspace pressed with the caret at `\|` | Today (`defaultKeymap` first) | After (`closeBracketsKeymap` first) |
|---|---|---|
| `(\|)` | `deleteCharBackward` deletes `(` and stops. Result `\|)` | `deleteBracketPair` deletes both and stops. Result `\|` |
| `(a\|)` | `deleteCharBackward` deletes `a`. Result `(\|)` | `deleteBracketPair` returns `false` (no pair around the caret), then `deleteCharBackward` deletes `a`. Result `(\|)` |
| `ab\|c` | `deleteCharBackward` deletes `b` | `deleteBracketPair` returns `false`, then `deleteCharBackward` deletes `b` |

### One list, used by `mount()` and by the tests — mirrors `revealHighlightField`

The list becomes a module-level constant in `CodeEditor.ts`, exported with an `@internal` tag: `export const codeEditorKeymap: readonly KeyBinding[]`. `mount()` installs it with `keymap.of(codeEditorKeymap)`, and the test file imports it. The constant is not re-exported from [component/editor/index.ts](packages/lib/src/typescript/lib/component/editor/index.ts), so it is not public API and does not appear in the API docs.

Exporting the constant this way follows `setRevealHighlight` and `revealHighlightField` ([CodeEditor.ts:393–419](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L393)): module-level CodeMirror values in the same file, exported `@internal`, used by `CodeEditor` and imported by `code-editor.test.ts` line 2.[^shared-list]

### The typing harness uses the shared list; the bracket rows join its `describe`

The harness's `TYPING_EXTENSIONS` ([code-editor.test.ts:3113](packages/lib/tests/component/code-editor.test.ts#L3113)) holds its own copy of the keymap today. Its keymap entry becomes `keymap.of(codeEditorKeymap)`. Its other two entries, `indentOnInput()` and `closeBrackets()`, stay as they are.

The new typing rows for this bug (B1–B17 in `## Expected Behaviour`) go inside the existing `describe('built-in markdown language typing', …)`, after its last row, H2. The `describe` keeps its name, and its helpers stay where they are.[^same-describe]

### The order is pinned link by link

Each link between "the list is in the right order" and "the key works in a real editor" has its own check. The row names (K, B, M, H, V) are those in `## Expected Behaviour`.

| Link | Checked by | Kind |
|---|---|---|
| `codeEditorKeymap` is in `basicSetup`'s order | K2 | offline |
| `mount()` installs `codeEditorKeymap`, and nothing `mount()` installs ahead of it takes Backspace | K1 | offline |
| Typing on that list gives the right text, with a language and without one | B1–B17, plus the existing M and H rows | offline |
| A real key press in a mounted editor | V1–V5 | manual |

K1 works without a mounted view. `mount()` builds its `EditorState` first and only then asks `DOM.sink.mountView` for a view, which returns `null` offline. K1 spies on `EditorState.create`, calls `mount()`, and reads the bindings from the state `mount()` built.[^mount-capture]

### Language bindings keep their own precedence — `CodeEditor` gains no language-specific code

`CodeEditor` stays a generic code editor: the fix names no language. A language's own key bindings come from its extension. `@codemirror/lang-markdown` installs its Backspace command, `deleteMarkupBackward`, wrapped in `Prec.high`, CodeMirror's wrapper that puts an extension's bindings ahead of ordinary ones. So in a `markdown` editor Backspace reaches `deleteMarkupBackward` first, as it does today, and only then the two bindings in `codeEditorKeymap`.

| Backspace in a `markdown` editor | Tried in order |
|---|---|
| caret after a fresh list marker, `- a` over `- \|` | `deleteMarkupBackward` turns the marker into two spaces and stops |
| caret in `- (\|)` | `deleteMarkupBackward` returns `false`, then `deleteBracketPair` deletes the pair |

A language registered by a consumer follows the same rule, because its bindings also come from its extension. With no `Prec` wrapper they are tried after the editor's. The "Registering a language" docs gain one paragraph saying so.[^lang-prec]

### Three Keyboard-table rows are corrected

Every row of the Keyboard table was compared with what the bindings do (`## Addendum: Keymap audit`). One row is false because of this bug. Two more are incomplete: the fold row gives no macOS keys although the binding has different ones there, and the typed-bracket row names three characters although quotes close too and the set depends on the language. Step 5 gives the new text.[^docs-rows]

---

## Internal Structure

### The constant (final form)

Goes in [CodeEditor.ts](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) directly after `buildReadOnlyExtension` (which ends at line 385), before the `/** The reveal highlight's mark, without the entrance flash (reduced motion). */` comment.

```ts
/**
 * The editor's own key bindings, as one list for `keymap.of`. CodeMirror tries
 * the bindings for a key in list order, and a later one runs only when every
 * earlier one returned `false`. The order is that of CodeMirror's reference
 * `basicSetup`, so `closeBracketsKeymap` comes first: its Backspace binding
 * has to be offered the key before `defaultKeymap`'s, which deletes a
 * character whenever there is one and so never passes the key on.
 *
 * Two `basicSetup` entries are absent. `autocompletion()` installs
 * `completionKeymap` itself, at `Prec.highest`, so listing it here would bind
 * the same keys again at a lower precedence. `lintKeymap` is not installed.
 *
 * `indentWithTab` is the one addition. It is deliberately absent from
 * `defaultKeymap`, because binding Tab traps it inside the editor and a
 * keyboard user can no longer Tab out. A code editor that does not indent on
 * Tab is the worse trade, and `defaultKeymap` already carries the escape
 * hatch: Ctrl-m (Alt-Shift-m on macOS) toggles CodeMirror's tab-focus mode,
 * after which Tab moves focus again. No other binding in the list uses Tab,
 * so its position does not change what Tab does.
 *
 * Exported for the offline tests, which type into a state built on this same
 * list because `CodeEditor` mounts no view there.
 *
 * @internal
 */
export const codeEditorKeymap: readonly KeyBinding[] = [
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    indentWithTab,
];
```

### `mount()` after the change

```ts
        const extensions: Extension[] = [
            history(),
            keymap.of(codeEditorKeymap),
            // Prec.high, so these two win over the search extension's own
```

The `// Prec.high, …` comment and everything below it stay as they are, apart from the `completionKeymap` comment reworded in step 1.

### The two order tests

A new `describe`, placed directly before `describe('built-in markdown language typing', …)`:

```ts
describe('CodeEditor keymap order', () => {
    it('K1: mount() installs codeEditorKeymap, and Backspace reaches deleteBracketPair first', () => {
        const editor = new CodeEditor() as any;

        editor.getElement(true);

        const createSpy = vi.spyOn(EditorState, 'create');

        editor.mount();

        const state     = createSpy.mock.results[0].value as EditorState;
        const groups    = state.facet(keymap);
        const backspace = groups.flat().filter((binding) => binding.key === 'Backspace').map((binding) => binding.run);

        createSpy.mockRestore();

        expect(groups).toContain(codeEditorKeymap);
        expect(backspace).toEqual([deleteBracketPair, deleteCharBackward]);
    });

    it('K2: every binding but indentWithTab comes from CodeMirror basicSetup, in its order', () => {
        const reference = EditorState.create({ extensions: basicSetup }).facet(keymap).flat();
        const shared    = codeEditorKeymap.filter((binding) => reference.includes(binding));

        expect(codeEditorKeymap.filter((binding) => !reference.includes(binding))).toEqual([indentWithTab]);
        expect(shared).toEqual(reference.filter((binding) => codeEditorKeymap.includes(binding)));
    });
});
```

`state.facet(keymap)` returns the installed binding lists, highest precedence first, and keeps each list's identity. So `toContain(codeEditorKeymap)` is true only when `mount()` installed that exact array. `basicSetup` comes from the `codemirror` package, which is already in `dependencies` ([package.json:217](packages/lib/package.json#L217)).[^basicsetup-dep]

---

## Ordered Implementation Steps

Run every command from `packages/lib`. Line numbers are those at the base commit; sibling plans edit the same test file and changelog, so find each place by the quoted text if a number has moved.

1. **Extract the list, with no behaviour change.**[^extract-first] In [CodeEditor.ts](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts):
   - Line 22: change `import type { DecorationSet } from "@codemirror/view";` to `import type { DecorationSet, KeyBinding } from "@codemirror/view";`.
   - Add the constant from `## Internal Structure`, JSDoc included, at the place named there. In this step only, write its six entries in today's order: `...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, ...closeBracketsKeymap, indentWithTab`. Step 3 puts them in the final order.
   - In `mount()`, delete the seven comment lines 2155–2161 (from `` // `indentWithTab` is deliberately absent from `defaultKeymap`, `` to `// Listed last so its Tab / Shift-Tab bindings take precedence.`). Their content now lives in the constant's JSDoc.
   - Replace line 2162, `keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, ...closeBracketsKeymap, indentWithTab]),`, with `keymap.of(codeEditorKeymap),`.
   - Replace the five comment lines 2192–2196 (from `// completionKeymap is deliberately not added to the keymap array` to `// Backspace binding (closeBracketsKeymap) is added explicitly.`) with:

     ```ts
                 // completionKeymap is deliberately not in codeEditorKeymap:
                 // autocompletion() installs it itself, at Prec.highest, so
                 // listing it there would bind the same keys again at a lower
                 // precedence. closeBrackets() is not self-installing, so its
                 // Backspace binding (closeBracketsKeymap) is listed there.
     ```
   - Check: `grep -c 'keymap.of(codeEditorKeymap)' src/typescript/lib/component/editor/CodeEditor.ts` prints `1`. `npm run typecheck` passes. `npx vitest run tests/component/code-editor.test.ts` is green.
2. **Write the tests** in [code-editor.test.ts](packages/lib/tests/component/code-editor.test.ts).
   - Line 2: add `codeEditorKeymap` to the import from `'~/component/editor/CodeEditor'`.
   - Line 22: change to `import { CompletionContext, closeBrackets, deleteBracketPair } from '@codemirror/autocomplete';`.
   - Line 23: change to `import { deleteCharBackward, indentWithTab } from '@codemirror/commands';`.
   - Add `import { basicSetup } from 'codemirror';` on a new line after line 23.
   - Replace the JSDoc and declaration of `TYPING_EXTENSIONS` (lines 3105–3117) with:

     ```ts
         /**
          * The extensions from `CodeEditor`'s `mount()` that take part in typing,
          * in `mount()`'s order: the keymap (Enter, Backspace), `indentOnInput()`
          * (re-indents a line as it is typed) and `closeBrackets()`. The keymap is
          * `codeEditorKeymap`, the list `mount()` itself installs, so a change to
          * its order shows up in these rows. The language's own extension follows
          * them, as in `mount()`; `buildTypingState` adds it per state.
          * `autocompletion()` is left out: completion needs a mounted view, and no
          * row presses Enter while a popup would be open.
          */
         const TYPING_EXTENSIONS: Extension[] = [
             keymap.of(codeEditorKeymap),
             indentOnInput(),
             closeBrackets(),
         ];
     ```
   - Add `describe('CodeEditor keymap order', …)` from `## Internal Structure` directly before `describe('built-in markdown language typing', () => {` (line 3104).
   - Add rows B1–B17 from `## Expected Behaviour` after row H2 (which ends at line 3449), inside the same `describe`. Each row is one `it` in the style of the M rows. The title is `'<#>: <the row's Case text>'`. The body is `expect(await typed(<Language>, <Start doc>, <Keys>)).toBe(<After>);`. In the keys string, write Backspace as `\b`, as row M14 does. Two rows have another shape:

     ```ts
         it('B8: json does not close (, and Backspace deletes it alone', async () => {
             expect(await typed('json', '', '(')).toBe('(|');
             expect(await typed('json', '', '(\b')).toBe('|');
         });

         it('B9: with no language, Backspace right after a typed ( deletes the pair', () => {
             const state = EditorState.create({ doc: '', extensions: TYPING_EXTENSIONS });

             expect(show(typeText(state, '(\b'))).toBe('|');
         });
     ```
   - Run `npx vitest run tests/component/code-editor.test.ts -t 'CodeEditor keymap order|built-in markdown language typing'`. Expect exactly these to fail: K1, K2, B1–B7, B9, B11, B12, B14, B16. Expect B8, B10, B13, B15, B17 and every M and H row to pass. A different red set means the harness or a row is wrong; fix that before going on.
3. **Reorder the list.** In `codeEditorKeymap`, put the six entries in the final order from `## Internal Structure`: `...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab`. Re-run the step-2 command: all green.
4. **Run the whole file and the Markdown editor suite.** `npx vitest run tests/component/code-editor.test.ts tests/component/markdown-editor.test.ts` — all green.
5. **Correct the docs** in [CodeEditor.md](packages/lib/docs/components/CodeEditor.md).
   - Keyboard table, fold row (line 275). Replace the row with:

     ```
     | `Ctrl-Shift-[` / `Ctrl-Shift-]` (`Cmd-Alt-[` / `Cmd-Alt-]` on macOS) | Fold / unfold at the cursor |
     ```
   - Keyboard table, the last two rows (lines 282–283). Replace both with:

     ```
     | `(` / `[` / `{` / `"` / `'` (typed) | Insert the matching closing character, caret between. The active language decides which characters close: `json` closes only `[`, `{` and `"`, while `javascript` and `sql` also close a backtick |
     | `Backspace` (caret between an empty pair, such as `()` or `""`) | Delete both characters |
     ```
   - "Registering a language": add this paragraph after the `completeFromList` code block that ends the subsection (line 143), before `` ## `format()` semantics ``:

     > A language extension that binds a key the editor also binds — Enter, Backspace or Tab, say — must raise its keymap's precedence: `Prec.high(keymap.of([...]))`, as `@codemirror/lang-markdown` does. At the default precedence the editor's own bindings are tried first, so the language's binding runs only when the editor's passes the key on.
6. **Add the changelog entry** to [next.md](packages/lib/docs/reference/changelog/next.md), under `## Fixed` → `### Components`, as the last bullet of that subsection (today that is after the "Typing HTML in Markdown source no longer adds or re-indents text" bullet, before `### Core`):

   > - **Backspace deletes an empty bracket pair in `CodeEditor`.** Typing `(` inserts `)` after the caret, and Backspace right after is documented to delete both. It deleted only the `(` and left the `)` behind. The same held for `[`, `{` and quotes, in every language and in `MarkdownEditor`'s `"source"` mode: the editor tried CodeMirror's plain Backspace command before the bracket one, so the bracket one never ran. Backspace with the caret between an empty pair — `()`, `[]`, `{}`, `""`, `''` — now deletes both characters, whether the pair was just typed or was already in the document. Anywhere else it deletes one character, as before. No consumer action is needed.
7. **Run the full checks** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

The contract is CodeMirror's own for `deleteBracketPair` — "deleting a pair of matching brackets when the cursor is between them" (`node_modules/@codemirror/autocomplete/dist/index.d.ts:584–588`) — and the Keyboard table's Backspace row.

**Order tests** (offline, code in `## Internal Structure`):

- **K1** — the state `mount()` builds holds `codeEditorKeymap` itself, and across everything `mount()` installs, the Backspace bindings are `deleteBracketPair` then `deleteCharBackward`.
- **K2** — every binding in `codeEditorKeymap` except `indentWithTab` is also in `basicSetup`, and those shared bindings are in the same relative order in both.

**Typing rows.** Notation: `⌫` is Backspace (`\b` in the keys string). `|` is the caret, written `\|` inside the table. "empty" is `''`. Rows run through the harness's `typed(language, startDoc, keys)`. "Before the fix" shows which rows must start red and is not asserted.

| # | Case (the test title) | Language | Start doc | Keys | After (asserted) | Before the fix | Kind |
|---|---|---|---|---|---|---|---|
| B1 | Backspace right after a typed ( deletes the pair | `javascript` | empty | `(⌫` | `\|` | `\|)` | offline |
| B2 | Backspace right after a typed [ deletes the pair | `javascript` | empty | `[⌫` | `\|` | `\|]` | offline |
| B3 | Backspace right after a typed { deletes the pair | `javascript` | empty | `{⌫` | `\|` | `\|}` | offline |
| B4 | Backspace right after a typed " deletes the pair | `javascript` | empty | `"⌫` | `\|` | `\|"` | offline |
| B5 | Backspace right after a typed ' deletes the pair | `javascript` | empty | `'⌫` | `\|` | `\|'` | offline |
| B6 | Backspace right after a typed backtick deletes the pair | `javascript` | empty | a backtick, then `⌫` | `\|` | `\|` followed by a backtick | offline |
| B7 | json: Backspace right after a typed { deletes the pair | `json` | empty | `{⌫` | `\|` | `\|}` | offline |
| B8 | json does not close (, and Backspace deletes it alone | `json` | empty | `(`, then `(⌫` | `(\|`, then `\|` | same | offline |
| B9 | with no language, Backspace right after a typed ( deletes the pair | none | empty | `(⌫` | `\|` | `\|)` | offline |
| B10 | Backspace with text between the pair deletes one character | `javascript` | empty | `(a⌫` | `(\|)` | same | offline |
| B11 | a second Backspace, once the pair is empty, deletes the pair | `javascript` | empty | `(a⌫⌫` | `\|` | `\|)` | offline |
| B12 | Backspace between a pair already in the document deletes the pair | `javascript` | `f(\|);` | `⌫` | `f\|;` | `f\|);` | offline |
| B13 | Backspace between mismatched brackets deletes one character | `javascript` | `(\|]` | `⌫` | `\|]` | same | offline |
| B14 | Backspace in a nested pair deletes the inner pair only | `javascript` | empty | `([⌫` | `(\|)` | `(\|])` | offline |
| B15 | Backspace away from any pair deletes one character | `javascript` | `ab\|c` | `⌫` | `a\|c` | same | offline |
| B16 | markdown: Backspace right after a typed ( in a list item deletes the pair | `markdown` | `- \|` | `(⌫` | `- \|` | `- \|)` | offline |
| B17 | markdown: Backspace after a fresh list marker still turns it into indentation | `markdown` | `- a\n- \|` | `⌫` | `- a\n  \|` (two spaces) | same | offline |

B12 deletes a pair the user did not just type. Deleting such a pair is the command's contract: `deleteBracketPair` looks only at the characters on either side of the caret.[^any-pair]

**Existing rows.** M1–M33, H1 and H2 keep passing unchanged. M14 is the existing check that Markdown's `deleteMarkupBackward` still gets Backspace first.

**Manual** (`npm run dev` from the repo root; the mounted editor and real key events are outside the offline harness):

| # | Where | Do | Expect |
|---|---|---|---|
| V1 | demo "CodeEditor" tab (starts as JavaScript), caret on an empty line | type `(`, then Backspace. Repeat with `[`, `{`, `"`, `'` and a backtick | each time the closing character appears with the caret between, and Backspace removes both |
| V2 | same editor | type `(a`, then Backspace twice | first Backspace leaves `()` with the caret between; second leaves nothing |
| V3 | same tab, "JSON" button | type `[`, then Backspace | both brackets gone |
| V4 | demo "MD Editor" tab, "Edit Markdown source" toggle on | type `- item`, Enter, Backspace; then type `(`, Backspace | the new `- ` marker becomes two spaces; then the `()` pair is removed whole |
| V5 | demo "CodeEditor" tab, JavaScript | `Ctrl-/`; `Ctrl-F` then Escape; `Ctrl-Space` then Escape; type `con`, then Enter while the completion list is open; `Ctrl-Shift-[` with the caret inside a function body; Tab and Shift-Tab; `Ctrl-Z` | comment toggles; search panel opens and closes; completion list opens and closes; Enter accepts the completion; the function body folds; the line indents and dedents; the last edit is undone |

---

## Verification

- `npm run typecheck` and `npm run test` from the repo root — green.
- `npm run lint` — clean.
- `npm run docs:api` — held to the standing bar in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).
- `grep -c 'keymap.of(codeEditorKeymap)' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` prints `1`.
- `grep -n 'closeBracketsKeymap\|defaultKeymap' packages/lib/tests/component/code-editor.test.ts` — no match: the test file has no keymap copy of its own left.
- `grep -n 'codeEditorKeymap' packages/lib/src/typescript/lib/component/editor/index.ts` — no match: the constant is not public.
- `git diff --stat` touches only the four files in `## Files to Create / Modify / Delete`.
- Manual: V1–V5.

---

## Potential Challenges

- **K2 compares bindings by identity.** It needs `codemirror` and the library to load the same copy of each `@codemirror/*` package, which is the case today (one hoisted copy). If K2's first `expect` ever lists every binding as "not from `basicSetup`", a second copy has been installed: fix the install (`npm dedupe`), not the test.
- **The spy in K1 must not leak.** `createSpy.mockRestore()` runs before the two `expect` calls, so a failing assertion cannot leave `EditorState.create` spied for later tests.
- **The harness now carries every editor binding, not two keymaps.** `pressKey` runs only bindings whose `key` is exactly `Enter` or `Backspace`, so the extra bindings are inert. All 35 existing M and H rows were run on the reordered list while planning and none changed.
- **`docs:api` and the new export.** `codeEditorKeymap` carries `@internal` and its JSDoc uses no `{@link}`. No public JSDoc may link to it.
- **Line numbers drift.** Four sibling plans edit `code-editor.test.ts` and `next.md`; locate each edit by its quoted text.

---

## Critical Files

- [CodeEditor.ts:2140](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2140) — `mount()`: the keymap (2162), the editor's own `Prec.high` search bindings (2171–2174), `autocompletion()` and `closeBrackets()` (2197–2198), the language compartment (2201), `EditorState.create` (2264) ahead of `DOM.sink.mountView` (2274).
- [CodeEditor.ts:393](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L393) — `setRevealHighlight` and `revealHighlightField`, the precedent for an `@internal` module-level export the tests import.
- [code-editor.test.ts:3104](packages/lib/tests/component/code-editor.test.ts#L3104) — the typing harness: `TYPING_EXTENSIONS` (3113), `buildTypingState` (3126), `pressKey` (3160), `typeText` (3239), `show` (3263), `typed` (3278), row M14 (3338), rows H1–H2 (3443–3449).
- [code-editor.test.ts:2551](packages/lib/tests/component/code-editor.test.ts#L2551) — `describe('CodeEditor mount() initial height-sync scheduling', …)`, the precedent for calling `mount()` offline that K1 follows.
- [CodeEditor.md:255](packages/lib/docs/components/CodeEditor.md#L255) — the Keyboard section and its table (271–283); "Registering a language" (109–143).
- `node_modules/codemirror/dist/index.js:67–75` — `basicSetup`'s keymap, the reference order.
- `node_modules/@codemirror/view/dist/index.d.ts:1568–1576` — the `keymap` facet's precedence rule; `dist/index.js:9078–9084` (`getKeymap`), `9095–9159` (`buildKeymap`), `9174–9184` (`runFor`).
- `node_modules/@codemirror/autocomplete/dist/index.js:1861–1887` — `deleteBracketPair` and `closeBracketsKeymap`; line 2074, `completionKeymap` installed at `Prec.highest`.
- `node_modules/@codemirror/commands/dist/index.js:1225` (`deleteCharBackward`), `1747` (its Backspace binding), `1779` (`defaultKeymap`), `1807` (`indentWithTab`).
- `node_modules/@codemirror/lang-markdown/dist/index.js:398–401` (`markdownKeymap`), `423–424` (installed at `Prec.high`).

---

## Non-Goals

- **`lintKeymap`** (`Mod-Shift-m`, `F8`). `basicSetup` has it; the editor does not install it and the docs do not promise it. Adding it would add CodeMirror's docked lint panel, which is a feature, not part of this fix.
- **Shift-Backspace.** Between a pair it still deletes one character. `closeBracketsKeymap` binds plain Backspace only, and `basicSetup` behaves the same.
- **Moving the language extension ahead of the editor's keymap.** Languages raise their own precedence where they need to, which is CodeMirror's convention (see the language decision).
- **Sharing more than the keymap with the harness.** `indentOnInput()` and `closeBrackets()` stay as the harness's own two entries.
- **Hoisting or renaming the typing harness.** The helpers stay inside their `describe`.
- **Which characters a language closes.** That is each language's own data and is not changed; the docs now describe it.
- **Whether a key reaches CodeMirror at all** on a given OS, browser or keyboard layout. The audit covers the order bindings are tried in, not key delivery.
- **`searchKeymap`'s own `Mod-f` and Escape entries.** They sit behind the editor's `Prec.high` bindings on purpose and stay in the list.

---

## Addendum: Keymap audit

Done against the installed packages (`@codemirror/view` 6.43.8, `commands` 6.10.4, `autocomplete` 6.20.3, `search` 6.7.1, `language` 6.12.4, `lint` 6.9.7, `lang-markdown` 6.5.2, `codemirror` 6.0.2). The per-platform key table was rebuilt the way `buildKeymap` builds it, for Linux, macOS and Windows key names, from everything `mount()` installs plus the `markdown` language.

**Where bindings come from, highest precedence first.**

| Tier | Source | Installed by |
|---|---|---|
| `Prec.highest` | `completionKeymap` | `autocompletion()` itself |
| `Prec.high` | the editor's `Mod-f` and Escape | `mount()`, [CodeEditor.ts:2171](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2171) |
| `Prec.high` | a language's own keymap (`markdown`: Enter, Backspace) | the language extension |
| default | `codeEditorKeymap` | `mount()` |
| default, after the editor's | a language keymap with no `Prec` wrapper | the language extension |

`search()`, `linter()` and `lintGutter()` install no key bindings. `CodeEditorOptions` has no option that takes key bindings or extensions, so a language's `loadExtension` result is the only way a consumer adds any.

**Every key with more than one binding**, in the order tried today (identical on the three platforms; `Mod-f` is `Cmd-f` on macOS):

| Key | Tried in this order today | Verdict |
|---|---|---|
| Backspace | `markdown`'s `deleteMarkupBackward` → `deleteCharBackward` → `deleteBracketPair` | **wrong**: the last two are swapped. Fixed by this plan |
| Enter | `acceptCompletion` (returns `false` with no list open) → `markdown`'s Enter command → `insertNewlineAndIndent` | right |
| Escape | `closeCompletion` → the editor's `closeSearch` (returns `false` with the panel closed) → `simplifySelection` → `searchKeymap`'s `closeSearchPanel` | right; the last two are in `basicSetup`'s order |
| ArrowUp, ArrowDown, PageUp, PageDown | completion-list movement (returns `false` with no list open) → caret movement | right |
| `Mod-f` | the editor's `openSearch` (always handles) → `searchKeymap`'s `openSearchPanel` | intended: the comment at [CodeEditor.ts:2163](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2163) explains why |

Every other key has exactly one binding. Inside the editor's own list only Backspace and Escape are bound twice, so reordering `searchKeymap`, `historyKeymap` and `foldKeymap` among themselves changes nothing. One case sits outside what `mount()` lists: once a completion snippet has been accepted, CodeMirror itself adds Tab, Shift-Tab and Escape bindings at `Prec.highest` (`addSnippetKeymap`, autocomplete/dist/index.js:1689). They move between the snippet's fields and return `false` when no snippet is active, so Tab then indents as usual.

**The Keyboard section, claim by claim.**

| Claim | Bound by | True today |
|---|---|---|
| `Mod-/` toggles a line comment | `defaultKeymap` | yes |
| `Alt-A` toggles a block comment | `defaultKeymap` | yes |
| `Ctrl-Shift-[` / `Ctrl-Shift-]` fold and unfold | `foldKeymap`; on macOS the binding is `Cmd-Alt-[` / `Cmd-Alt-]` | yes on Windows and Linux; the row omits the macOS keys |
| `Ctrl-F` / `Cmd-F` opens the search panel | the editor's `Prec.high` binding | yes |
| Escape closes the search panel | the editor's `Prec.high` binding | yes |
| Enter and Shift-Enter in the find field, Enter in the replace field | `CodeEditorSearchPanel`'s own key handlers, not a CodeMirror binding | yes |
| `Ctrl-Space` opens completions | `completionKeymap` | yes |
| typed `{` / `(` / `[` inserts the closing bracket | `closeBrackets()`'s input handler, not a key binding | yes, but incomplete: quotes close too, and `json` does not close `(` |
| Backspace over a bracket pair deletes both | `closeBracketsKeymap` | **no** — this bug |
| Tab indents, Shift-Tab dedents (prose) | `indentWithTab` | yes |
| `Ctrl-m` / `Alt-Shift-m` toggles tab-focus mode (prose) | `defaultKeymap` | yes |

"True" means the binding exists and nothing ahead of it takes the key. Whether the OS and browser deliver the key at all was not checked (see `## Non-Goals`).

Which characters each built-in language closes, read off the harness: `javascript` and `sql` close `(`, `[`, `{`, `"`, `'` and a backtick. `html`, `markdown`, `css`, `python` and an editor with no language close `(`, `[`, `{`, `"`, `'`. `json` closes `[`, `{`, `"`.

---

## Notes

[^cause]: Confirmed three ways. (1) Reading: `keymap.of([...defaultKeymap, …, ...closeBracketsKeymap, indentWithTab])` at CodeEditor.ts:2162. `defaultKeymap` includes `{ key: "Backspace", run: deleteCharBackward, … }` (commands/dist/index.js:1747); `closeBracketsKeymap` is `[{ key: "Backspace", run: deleteBracketPair }]` (autocomplete/dist/index.js:1885–1887). CodeMirror flattens all installed keymaps in facet order (`getKeymap`, view/dist/index.js:9078–9084), pushes each key's commands in that order (`buildKeymap`, 9131–9132), and runs them until one returns `true` (`runFor`, 9174–9184). Its own docs state the rule: "the ones specified early or with high priority get checked first" (view/dist/index.d.ts:1568–1576). (2) The state `mount()` builds, captured offline by spying on `EditorState.create`, lists Backspace as `deleteCharBackward` then `deleteBracketPair`. (3) The typing harness, on the same order, gives `|)` for `(` then Backspace with no language and in every built-in language that closes `(` (all but `json`); with the order swapped it gives `|`. The line is the same on `master`, where the `codeeditor-codemirror-feature-expansion` plan added `closeBracketsKeymap` "before `indentWithTab`", so after `defaultKeymap`.

[^audit]: See `## Addendum: Keymap audit` for the full tables: every key with more than one binding, on Linux, macOS and Windows key names, and every claim in the docs' Keyboard section.

[^full-order]: Moving only `closeBracketsKeymap` to the front would fix the bug too. The full `basicSetup` order was chosen so the list can be compared with CodeMirror's reference at a glance and checked against it by a test (K2). The extra moves are safe: inside the list only Backspace and Escape are bound twice, and Escape's two bindings (`defaultKeymap`, then `searchKeymap`) keep their relative order. `completionKeymap` stays out because `autocompletion()` installs it at `Prec.highest` (autocomplete/dist/index.js:2074). `lintKeymap` stays out because it is not installed today (see `## Non-Goals`). `indentWithTab` stays last, where it is today; no other binding in the list uses Tab. The comment being moved claimed it was "listed last so its Tab / Shift-Tab bindings take precedence", which has the rule backwards, so the constant's JSDoc says instead that the position does not matter.

[^shared-list]: Searched for how this file already exposes internals to its offline tests. Two shapes exist. Class logic is factored into methods the tests call on an `as any` instance. Module-level CodeMirror values are exported `@internal`: `setRevealHighlight` and `revealHighlightField`. A list of bindings is a module-level CodeMirror value, so it takes the second shape. Rejected: keeping a hand copy in the harness (it has to be edited in step with `mount()` every time, and nothing fails when it is not); a builder function (the list has no inputs); a new module (one constant, used by one class).

[^same-describe]: `typed`, `typeText`, `show` and `TYPING_EXTENSIONS` are declared inside that `describe`, and rows H1 and H2 already test a language other than Markdown there. Hoisting the helpers to module scope, or renaming the `describe`, would rewrite about 180 lines in a file four sibling plans are editing, for no change in what is tested.

[^mount-capture]: `mount()` calls `EditorState.create` at CodeEditor.ts:2264 and only then `DOM.sink.mountView` (2274), which returns `null` under the test sink (`tests/dom/TestDOM.ts:947`). The existing `describe('CodeEditor mount() initial height-sync scheduling', …)` already drives `mount()` offline with `editor.getElement(true); editor.mount();`. Probed while planning: one `create` call, whose state's `keymap` facet holds three lists — 9 completion bindings, the editor's 2 search bindings, then the 77 base bindings. The facet keeps each installed list's identity, which is what lets K1 assert `toContain(codeEditorKeymap)`. A language is not in that state, because a language is loaded into the live view only; that is why the language rows run on the harness instead.

[^lang-prec]: Checked by building states with a stand-in language keymap in the language compartment's position: with no wrapper its Enter binding comes after the editor's; with `Prec.high` it comes before; `markdown()` lands before, as expected. A plain `[basicSetup, language()]` CodeMirror setup has the same order, which is why `lang-markdown` wraps its keymap. Putting the language compartment ahead of the keymap in `mount()` was rejected: it would also reorder input handlers, and it would depart from the convention every CodeMirror language package is written for.

[^docs-rows]: Evidence is in the addendum. `foldKeymap`'s entries are `{ key: "Ctrl-Shift-[", mac: "Cmd-Alt-[" }` and the `]` twin, and a `mac` key replaces `key` on macOS, so the documented keys do nothing there. The `Ctrl-F` row already uses the "(… on macOS)" form the corrected row copies. The set of closing characters comes from each language's `closeBrackets` language data, with CodeMirror's default (`(`, `[`, `{`, `'`, `"`) when a language sets none.

[^extract-first]: Extracting first, in today's order, gives a clean red phase. With the tests already reading the shared list, step 2 fails for exactly the rows the bug breaks, and step 3's one-line reorder turns them green. Writing the tests before the constant exists would fail on a missing import instead, which shows nothing about the bug.

[^basicsetup-dep]: `codemirror` is declared in `packages/lib/package.json` and matched by the lib build's `external` pattern (`vite.lib.config.ts:99`), but no source or test file imports it today. K2 is its first import. Run offline while planning, `EditorState.create({ extensions: basicSetup })` builds under the node test environment, and K2 passes on the final order and fails on today's.

[^any-pair]: `deleteBracketPair` (autocomplete/dist/index.js:1861–1880) checks only that the character before the caret is an opening token and the one after is its closing counterpart. It does not ask whether `closeBrackets()` inserted the pair. Every `basicSetup` editor behaves this way, and the changelog entry says so.

---

## Implementation Notes

Implemented on `feature/codeeditor-bracket-pair-backspace`, branched from `feature/markdown-editor-paste-undo-merge` at `85b55a8f4`. That base is five branches above the tip the plan was written against, so every path, line number and claim of the plan was checked against the code before a test was written. Nothing the plan relies on had changed in substance; the differences are listed here.

### Differences from the plan

1. **Line numbers.** Every quoted text the plan names was found unchanged, and each edit was placed by that text. The numbers have moved:

   | Place | Plan | At the base (`85b55a8f4`) |
   |---|---|---|
   | `mount()` in `CodeEditor.ts` | 2140 | 2177 |
   | the `keymap.of([...])` line | 2162 | 2199 |
   | the `completionKeymap` comment | 2192–2196 | 2229–2233 |
   | `EditorState.create` / `DOM.sink.mountView` | 2264 / 2274 | 2301 / 2311 |
   | `buildReadOnlyExtension`, `setRevealHighlight` | 383, 393 | 383, 393 (unchanged) |
   | `describe('built-in markdown language typing', …)` | 3104 | 3139 |
   | `TYPING_EXTENSIONS` | 3113 | 3148 |
   | row H2 | ends at 3449 | 3518–3520 |
   | `describe('CodeEditor mount() initial height-sync scheduling', …)` | 2551 | 2551 (unchanged) |
   | Keyboard table in `CodeEditor.md` | 271–283 | 273–285 |
   | `packages/lib/package.json`, `codemirror` | 217 | 217 (unchanged) |

2. **The harness has more rows than the plan counts.** The plan speaks of rows M1–M33, H1 and H2 (35 rows). The base has M1–M37, with M34, M36 and M37 run for three tab sizes each, plus H1 and H2: 45 tests. All 45 pass unchanged on the reordered list. The new rows were added after H2, as planned.

3. **The changelog's last `### Components` bullet is another one now.** The plan names the "Typing HTML in Markdown source…" bullet as the last one under `## Fixed` → `### Components`. Later branches added bullets after it. The new bullet went in as the last bullet of the subsection, which is what the plan asks for. It is hard-wrapped at 76 columns with a two-space hanging indent, as every other bullet in the file is; the plan gives it as one line.

4. **Read-only is not enforced by a transaction filter on this base.** The run's briefing said a read-only `CodeEditor` now refuses its editing commands through a transaction filter in `buildReadOnlyExtension`. On this base it does not: `buildReadOnlyExtension` still returns `EditorState.readOnly.of(readOnly)` alone ([CodeEditor.ts:383](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L383)). The filter is what `plans/markdown-language-readonly-and-fences.md` adds later. The fix does not need it: both Backspace commands in the list read `state.readOnly` and return `false` (`deleteBracketPair`, autocomplete/dist/index.js:1861; `deleteBy`, which `deleteCharBackward` calls, commands/dist/index.js:1158).

5. **Five rows (11 tests: B18 runs once per language) were added beyond B1–B17**, in the same `describe`, after B17. They pin cases the plan's table does not have. B18 and B20 fail before the reorder and pass after; B19, B21 and B22 pass on both orders and guard against the reorder changing something else.

   | # | Case | Before the reorder |
   |---|---|---|
   | B18 | `[` then Backspace gives an empty document, once per built-in language (`javascript`, `json`, `html`, `sql`, `markdown`, `css`, `python`). `[` is the one bracket all seven close | `\|]` in all seven |
   | B19 | Backspace between `()` in a read-only state changes nothing | same |
   | B20 | two carets, each between an empty pair (`a(\|)b[\|]c`): both pairs go | `a)b]c` |
   | B21 | two carets, one between a pair and one not (`(\|)ab\|`): one character is deleted at each, leaving `)a` | same |
   | B22 | text selected inside a pair (`(«a»)`): only the selection is deleted | same |

   B19 builds its read-only state with `EditorState.readOnly.of(true)`, which is what `buildReadOnlyExtension(true)` returns today; that function is not exported on this base.

6. **Two sentences of the docs and changelog text differ from the plan's wording.** Both changes make the text match what the command does.

   | Where | Plan | Written | Why |
   |---|---|---|---|
   | Keyboard table, Backspace row | "caret between an empty pair, such as `()` or `""`" → "Delete both characters" | "caret between an empty pair the language closes, such as `()` or `""`" → "Delete both characters. With several carets, only when every caret is between such a pair" | see the two findings below |
   | Changelog bullet | "between an empty pair — `()`, `[]`, `{}`, `""`, `''` — now deletes both characters" | "between an empty pair of characters the language closes — `()`, `[]`, `{}`, `""` and `''` in most — now deletes both characters", plus the sentence "With several carets it deletes pairs only when every caret is between one." | the same |

   - *A pair the language does not close is not a pair.* `deleteBracketPair` reads the active language's `closeBrackets` set. In `json`, which closes only `[`, `{` and `"`, Backspace between `()` or `''` already in the document deletes one character. Probed on the harness for all seven languages and for no language.
   - *With several carets it is all or nothing.* `deleteBracketPair` deletes pairs only when every caret is between one, and otherwise returns `false`, so the plain Backspace runs at every caret (autocomplete/dist/index.js:1866–1879). Row B21 pins it. This is CodeMirror's own behaviour, the same in any `basicSetup` editor.

7. **Manual row V5, fold.** The plan says to press `Ctrl-Shift-[` "with the caret inside a function body". Nothing folds there. CodeMirror's `foldCode` folds only a range that starts on the caret's line (`syntaxFolding` in language/dist/index.js requires `value.from >= start`), so the caret has to be on the line that opens the body. On that line the key folds and `Ctrl-Shift-]` unfolds. The fold keys have one binding each, so the reorder does not reach them; the row's wording was off, not the editor.

8. **No demo was added** (worker step 7). The demo's "CodeEditor" and "MD Editor" tabs already hold editors in which the fix shows, and V1–V4 were run in them.

9. **Shared files** (`code-editor.test.ts`, `next.md`) were edited in the one code commit and the one documentation commit, not in commits of their own, as the commit rules require.

### Checks beyond the plan's own

- **Every registered language.** Row B18, and a scratch probe that typed each of `(`, `[`, `{`, `"`, `'` and a backtick and then pressed Backspace, in all seven languages and with none. The sets match the addendum: `javascript` and `sql` close all six, `json` closes `[`, `{`, `"`, the rest close the first five. Whatever a language closes, Backspace right after removes both characters.
- **Read-only.** Row B19, and in the mounted demo: with "Read-only" on and the caret between `[]`, Backspace changes nothing; with it off, Backspace deletes the pair. A read-only `markdown` editor can still be edited by Markdown's own Enter and Backspace commands, as before this plan; that is defect 2 of `markdown-language-readonly-and-fences` and is not touched here.
- **Multiple carets and a selection.** Rows B20–B22.
- **IME composition.** The plan does not cover it, and no real IME was used. From the source: CodeMirror drops every key event while a composition is active (`ignoreDuringComposition`, view/dist/index.js:4645–4649), so no key binding runs then, in either order; and the `closeBrackets` input handler declines while one is active (autocomplete/dist/index.js:1845). The reorder therefore cannot change what happens during a composition. On Android, CodeMirror turns a deletion it sees in the DOM back into a Backspace key press (view/dist/index.js:4332–4341), which runs the same list, so the pair is deleted there too. That last point is read from the source only.
- **Markdown source mode.** `markdown-source-edits.test.ts` and its siblings were not edited and pass unchanged.
- **Keys bound twice.** Re-derived from the constant on the Linux, macOS and Windows key names: inside the list only Backspace is bound twice in the plain editor scope, and Escape a second time through `searchKeymap`, as the addendum says.

### Changes made after the review

The audit ended with no blocking finding. Its advisory findings were then fixed as well, at the coordinator's request, under the user's standing rule for this stack that advisories are fixed, not left. Each fix was folded into the commit it belongs to. None of them was read by a reviewer afterwards.

| # | Advisory | What was done |
|---|---|---|
| A1 | No row pinned "a pair the language closes" | Row **B23**: in `json`, Backspace between `()` gives `\|)`, and between `''` gives `\|'`. Run against a mutant in which Backspace deletes any bracket or quote pair whatever the language closes, B23 fails with `expected '\|' to be '\|)'`. The mutant is a stand-in for `@codemirror/autocomplete`, swapped in by a scratch Vitest config, so the worktree was not edited to run it |
| A2 | K1 could leave `EditorState.create` spied if `mount()` threw | The `describe` now has `afterEach(() => vi.restoreAllMocks())`, the idiom `describe('collectSyntaxErrors', …)` in the same file already uses, and the spy lives in a helper, `mountOffline`. K1's two assertions are unchanged; its hand-written `mockRestore()` is gone |
| A3 | K2 checked order and subset only, so a dropped keymap would pass | Row **K3**: the `basicSetup` bindings the list leaves out are exactly `completionKeymap` and `lintKeymap`. With `foldKeymap` dropped from the list by a second stand-in, K3 fails and K2 still passes. K2 itself is unchanged. K3 names the two absent keymaps rather than the five present ones, so the test file still holds no copy of the list |
| A4 | The "Registering a language" paragraph did not hold for `Mod-f` and Escape | The paragraph now says what stays ahead of a `Prec.high` language keymap: the completion list's keys, and the editor's own `Ctrl-F` and `Escape`. Row **K4** pins all of it on the state `mount()` builds, with a stand-in keymap loaded into the language compartment: after the editor's at the default precedence, ahead of it at `Prec.high`, behind the editor's `Mod-f`, and behind the completion list's and the editor's `Escape` |
| A5 | Python's triple quotes were not mentioned | Checked on the old and the new order. It is new with this branch. In `python`, three quotes typed in a row give `"""\|"""`. Before, Backspace there gave `""\|"""` and two more left `\|"""`. Now each Backspace deletes one quote on each side: `""\|""`, `"\|"`, `\|`. The Backspace row of the Keyboard table and the changelog bullet say so, and row **B24** pins it. Any other language gives the same result for six quotes already in the document, since a quote on each side of the caret is a pair |
| A6 | B21 and the "several carets" sentences pin behaviour CodeMirror's docs do not promise | The row stays, with a comment. **If a CodeMirror upgrade fails B21:** read `deleteBracketPair` in the new `@codemirror/autocomplete` again; if it now deletes the pair at each caret that is between one, change B21's expectation and the "several carets" sentences in the Backspace row of `CodeEditor.md` and in the changelog to match |
| A7 | B19 overlaps row RO6 of the later read-only plan | Nothing changed in code. The note for that plan stays, under "For the plans that follow" |
| — | The notes said "five rows" for eleven tests | Corrected in 5 |

These fixes add to what differs from the plan:

- **Tests.** K1 has the same assertions as the plan's, on a helper and an `afterEach` in place of the plan's inline spy and `mockRestore()`. Rows K3, K4, B23 and B24 are not in the plan. The test file now also imports `Prec`, `completionKeymap` and `lintKeymap`.
- **Docs.** The "Registering a language" paragraph has three sentences after the plan's two. The Backspace row and the changelog bullet each gained the `python` sentence.

### Verification

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint`: clean. `npm run test`: green (the count is in the run's report). `npm run docs:api`: no warnings. `npm run docs:llms:check`: OK.
- The four greps of `## Verification` give the results the plan names.
- V1–V5 were run on 2026-10-11 against the worktree's own demo server (`127.0.0.1:5391`, not 8015), with real key events sent through Chrome DevTools. All gave the expected result, with V5's fold key pressed on the line that opens the function (see 7).

### Decisions that await the user's sign-off

Nothing here changes behaviour beyond the plan, and no non-goal was reversed. Two things were written that the user has not seen:

- **The docs and changelog wording in 6.** It is in the documentation commit. To go back to the plan's wording, drop "the language closes" / "of characters the language closes … in most" and the two "several carets" sentences.
- **Rows B18–B22 in 5.** They are in the code commit, as one block after B17 in `code-editor.test.ts`. They are tests of the plan's own behaviour, so they were not split into a commit of their own; removing the block removes them.

### For the plans that follow

**`markdown-language-enter-inside-html`**

- The harness now types on `codeEditorKeymap`, so its rows run on the editor's real list. `pressKey` is unchanged and still walks the whole `keymap` facet, highest precedence first, so a `Prec.high` Enter binding from the `"markdown"` loader is reached before the editor's.
- Its line references into `code-editor.test.ts` are stale twice over. After this branch: `describe('CodeEditor keymap order', …)` 3141, with rows K1–K4; `describe('built-in markdown language typing', …)` 3223; `TYPING_EXTENSIONS` 3234; `buildTypingState` 3248; `settle` 3268; `pressKey` 3283; `typeCharacter` 3320; `typeText` 3362; `show` 3386; `typed` 3402; row M14 3462; row H2 3604; rows B1–B24 3608–3748.
- Its step 2 puts the C rows "after the new M33 block and before `it('H1: …')`". The base now has rows M34–M37 and M35 between M33 and H1; rows B1–B24 follow H2. Row ids B1–B24 and K1–K4 are taken.
- "Registering a language" in `CodeEditor.md` now ends with a paragraph saying a language keymap that binds a key the editor also binds must use `Prec.high`, and what still comes ahead of it then. The plan's new Enter binding is an instance of it: the completion list's Enter is tried first and passes the key on when no list is open. Row K4 has a helper, `commandsFor`, that lists the commands for a key with a stand-in language loaded, should that plan want to pin its binding's place.
- Its rows C39–C41 press Backspace on a continued prefix. `deleteBracketPair` is now tried before the plain Backspace; it returns `false` there, since a prefix is not a bracket pair, so those rows should give what the plan expects.

**`markdown-language-readonly-and-fences`**

- Its step 0 check, `grep -c 'codeEditorKeymap' …/CodeEditor.ts`, now prints 3.
- `buildReadOnlyExtension` is still at 372–385 and still unexported. The text after it has changed: the `codeEditorKeymap` constant and its JSDoc now sit between it and `REVEAL_MARK` (387–419).
- Its row RO6 ("Enter and Backspace between brackets change nothing in a read-only `javascript` editor") overlaps row B19 here. Once `buildReadOnlyExtension` is exported, B19 can build its state with it, or be dropped in favour of RO6.
- Both of the editor's Backspace commands already read `state.readOnly`, so the reorder adds no route that edits a read-only document.
- If that plan gains a manual fold check, the caret must be on the line that opens the block (see 7).
