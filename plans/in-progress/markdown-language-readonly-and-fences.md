---
depends-on: [markdown-language-enter-inside-html]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/languages.ts
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Language Read-Only and Fences — Implementation Plan

## Overview

This plan fixes three defects of `CodeEditor`. The first two were found while planning `markdown-language-enter-inside-html`, and the third was recorded by `markdown-source-mode-html-typing`. All three reach `MarkdownEditor`'s source mode, which is a `CodeEditor` with `language: "markdown"`. The caret is drawn `▮`, and `→` is one tab.

| # | Defect | Example | Today |
|---|---|---|---|
| 1 | Enter in a code block inside a blockquote or list item moves the new line out of it | `> code▮` in a fenced block, then Enter | the new line has no `>`: the quote ends and the fence breaks |
| 2 | A read-only editor can be edited | `- item▮` in a read-only Markdown editor, then Enter | a `- ` line is added |
| 3 | Enter turns a tab into `tabSize` spaces, or drops it | `→<div>▮` as the last line of a nested list item, then Enter | the new line starts at column 0, outside both items |

Three terms are used throughout. A **container** is a blockquote or a list item. A line's **prefix** is the text at its start that keeps the line in its containers: the `>` markers and the indentation. A **binding** pairs a key with a command; a command returns `true` when it handled the key, and `false` to pass the key on to the next binding.

The plan has two parts. Part one makes read-only hold for every language: `CodeEditor` itself refuses any change to a read-only document, instead of relying on each command to check ([CodeEditor.ts:383](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L383)). Part two widens the Enter command that `markdown-language-enter-inside-html` adds to the `"markdown"` loader ([languages.ts:201](packages/lib/src/typescript/lib/component/editor/languages.ts#L201)), so it also covers code blocks, the end of an HTML block, and blank indented lines. No public API changes. The plan also adds a jsdom test file, a Markdown button to the demo's CodeEditor tab, and the docs and changelog text.

---

## Architecture Decisions

### Read-only is enforced by the editor, in one transaction filter — a new pattern

A **transaction** is CodeMirror's unit of change: every edit, caret move and setting change is applied as one. A **transaction filter** is a function CodeMirror calls on each transaction before applying it, and which may replace the transaction.

`buildReadOnlyExtension` ([CodeEditor.ts:383](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L383)) returns two parts when the editor is read-only: `EditorState.readOnly.of(true)`, as today, and a transaction filter, `refuseDocumentChange`. The filter refuses every transaction that changes the document, whichever key, handler or language produced it. No per-command check is added anywhere.[^central]

`EditorState.readOnly` alone is a flag that editing code is expected to read. Four routes do not read it, and change a read-only document today:[^truth]

| Route | Languages | Signals `"readonlyedit"` today |
|---|---|---|
| Enter on a list or blockquote line (`insertNewlineContinueMarkup`) | `markdown` | no |
| Backspace after a list or quote marker (`deleteMarkupBackward`) | `markdown` | no |
| Pasting a URL over selected text (`pasteURLAsLink`) | `markdown` | no |
| Clicking an entry of the completion list, opened with `Ctrl-Space` | all seven built-in languages | no |

Every other key binding, typed text, paste, drop, cut, undo and Replace already leaves a read-only document alone (`## Addendum: Routes into a read-only document`). `CodeEditor` does not set `EditorView.editable`, and does not start to.[^facets]

### A refused transaction is replaced by one that does nothing and carries a mark

The filter decides on two facts only: whether the transaction changes the document, and whether it is the host's document load.

| Transaction in a read-only editor | Result |
|---|---|
| changes the document: Enter in a list, a clicked completion, a URL paste, a language's own edit | replaced by a transaction with no change, no caret move and no effects, which carries the mark `readOnlyEditRefused` |
| moves the caret or the selection only | passes unchanged |
| carries effects only: folding, the search query, the completion list, a language, theme or option change | passes unchanged |
| `setValue`'s document load | passes unchanged |

The whole transaction is dropped, not only its text change, so a refused edit never moves the caret.[^replace-not-strip]

### `setValue` is the one document change that passes

`setValue` ([CodeEditor.ts:769](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L769)) marks its transaction with a module-private annotation, `hostDocumentLoad`, and the filter lets a marked transaction through. A read-only editor therefore still takes a document from its host, as it does today and as `MarkdownEditor` relies on when it switches surfaces.[^host-load]

### The refusal is signalled from the update listener, once per update

The update listener in `mount()` ([CodeEditor.ts:2255](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2255)) is where the editor already turns state changes into its own events. Its first statement becomes `this.signalRefusedEdit(update.transactions)`. That new private method calls the existing `signalReadOnlyEdit()` ([CodeEditor.ts:2837](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2837)) when one of the transactions carries `readOnlyEditRefused`.[^listener]

Every refused edit is signalled exactly once:

| Refused edit | Becomes a transaction | Signalled by |
|---|---|---|
| a typed character, IME input, a plain paste, a drop | no: CodeMirror's input handling drops it first | the existing `beforeinput` / `paste` / `drop` hooks ([CodeEditor.ts:2289](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2289)) |
| Enter or Backspace that no command takes, as in `javascript` | no: the key goes to the browser, which fires `beforeinput` | the same hooks |
| the four routes above, and any edit a language makes itself | yes | the update listener (new) |
| `replaceRange()`, `cut()`, `paste()`, `format()` | no: each returns before it dispatches | the method itself, unchanged |

### The existing read-only checks stay

`replaceRange`, `cut`, `paste` and `format` keep their own `getReadOnly()` checks, and the Enter command in `languages.ts` keeps its `state.readOnly` check. The filter is the floor under them, not a replacement.[^keep-checks]

### Read-only is tested at two levels — mirrors `revealHighlightField` and the mounted Markdown tests

`CodeEditor` mounts no view in the unit tests, so the guarantee is tested in two ways.

- **On a state.** `buildReadOnlyExtension` gains `export` and an `@internal` tag, as `setRevealHighlight` and `revealHighlightField` have ([CodeEditor.ts:401](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L401)). The typing harness, the helpers in `code-editor.test.ts` that type keys into a CodeMirror state with no view, adds the extension to its state and types into it (rows RO1–RO6). Tests RO7–RO13 call it directly, read the state `mount()` builds, and call `setValue` and `signalRefusedEdit`.
- **On a mounted view.** A new file, `tests/component/code-editor-read-only-mounted.test.ts`, runs under jsdom, a DOM written in JavaScript that the test runner can switch on per file. There `CodeEditor` mounts a real CodeMirror view. It sends real `keydown`, `paste` and `mousedown` events (tests G1–G7). `tests/component/markdown-editor-table-edge-mounted.test.ts` is the precedent for a jsdom file that exists because a handler only runs in a mounted editor.[^two-levels]

### One Enter command, `insertNewlineKeepPrefix`, handles four places

The command `continueContainersInsideHtml` is replaced by `insertNewlineKeepPrefix`, in the same place and bound the same way. It is one command, not a second one beside the first.[^rename]

`insertNewlineKeepPrefix` handles Enter when the selection range starts in one of four places. Everywhere else the command returns `false`.[^four-places]

| # | The range starts | And | Example | The new line starts with |
|---|---|---|---|---|
| 1 | in a code block, fenced or indented | nothing more: at any depth, also outside every container | `> code▮` in a fenced block | `>·` |
| 2 | inside HTML, with HTML on both sides of the range | it is in a container | `> <div>▮` over `> x` | `>·` |
| 3 | at the end of an HTML block: HTML before, Markdown after | it is in a container, the line has no list marker, and there is text between the prefix and the caret | `→<div>▮` as the last line of a nested item | `→` |
| 4 | on a line that holds only spaces and tabs | no container holds the line, and Markdown is the active language | `→▮` as the last line of the document | `→` |

`·` is one space. Place 2 is what `continueContainersInsideHtml` did, unchanged. The prefix is built as before: the caret line's own start, copied character for character, with each list marker replaced by spaces. A caret in front of a marker on its line is still passed on.

### The command is tried before Markdown's own

The loader returns the binding ahead of the Markdown support: `[Prec.high(keymap.of([…])), support]`. Enter is then tried in this order:

| # | Command | Installed by | Handles Enter when |
|---|---|---|---|
| 1 | `acceptCompletion` | `autocompletion()`, at `Prec.highest` | a completion list is open |
| 2 | `insertNewlineKeepPrefix` | the `"markdown"` loader, at `Prec.high` | the range starts in one of the four places |
| 3 | `insertNewlineContinueMarkup` | `markdown()`, at `Prec.high` | Markdown is active beside the caret, in a container |
| 4 | `insertNewlineAndIndent` | the editor's own keymap | always |

The order matters in two of the four places, where Markdown's own command takes the key and drops the indentation:[^first]

| Caret | Markdown's own command gives | `insertNewlineKeepPrefix` gives |
|---|---|---|
| `>·····code▮` in an indented code block in a blockquote | `>·▮`: the new line is not code | `>·····▮` |
| `→<div>▮` as the last line of a nested item | `▮` at column 0: outside both items | `→▮` |

### At the end of an HTML block, Markdown's own command keeps the marker line and the empty line

Place 3 leaves two carets to Markdown's own command, so two behaviours that tests already pin stay as they are.[^html-end]

| Caret, with nothing of the block after it | Handled by | Result | Row |
|---|---|---|---|
| `- <div>▮` (the item's marker line) | Markdown's own | a new marker: `- ▮` | M12 |
| `> ▮` on the empty line under `> <div>` | Markdown's own | as under `> quote`: the third Enter leaves the quote | C25 |
| `> <div>▮` | `insertNewlineKeepPrefix` | `>·▮`, the same text as before | M17 |
| `→<div>▮` in a nested item | `insertNewlineKeepPrefix` | `→▮` | F34 |

### What this plan adds to the tab defect

`continueContainersInsideHtml` already copies a tab where HTML continues below the caret. This plan covers the cases it leaves.[^md-own-tabs]

| Enter on a tab-indented line | After `markdown-language-enter-inside-html` | After this plan |
|---|---|---|
| `→<div>▮`, the block continues on the lines below | the tab is copied | the same |
| `→<div>▮`, the block ends at the caret | column 0, at every `tabSize` | the tab is copied (F34) |
| `→▮`, a blank last line of the document | `tabSize` spaces | the tab is copied (F32) |
| `→code▮` in a code block | `tabSize` spaces | the tab is copied (F16–F18) |
| `→text▮`, ordinary text in a list item | column 0 | unchanged: see `## Non-Goals` |
| `→foo▮` inside HTML outside every container | `tabSize` spaces | unchanged: see `## Non-Goals` |

### Enter replaces a selection in the four places

A selection is no longer passed on. Where the range starts in one of the four places, Enter replaces the selected text with the line break and the prefix. This reverses one decision of `markdown-language-enter-inside-html`, which passed every selection on.[^selections]

| Selection (`[` `]` mark it) | Before | After |
|---|---|---|
| `> co[de]` in a fenced block in a blockquote | `> co`, then a line with no `>` | `> co`, then `>·▮` (S1) |
| `> a[b]c` inside an HTML block in a blockquote | `> a`, then `c` with no `>` | `> a`, then `>·▮c` (S2) |
| `> a[b]c` in ordinary quoted text | `> a`, then `c` | unchanged (S4): Markdown's own command passes it on, and the line stays in the quote |

### Between an empty pair, both new lines get the prefix

`insertNewlineKeepPrefix` splits what the editor's plain Enter splits: an empty `()`, `[]` or `{}`, and an adjacent open and close tag. Both new lines start with the prefix.[^pairs]

| Before | After Enter |
|---|---|
| `> f(▮)` in a fenced block in a blockquote | `> f(`, `>·▮`, `>·)` (F24) |
| `··f(▮)` in a fenced block in a list item | `··f(`, `··▮`, `··)` — as today (F25) |
| `> f() {▮}` inside `<script>` in a blockquote | `> f() {`, `>·▮`, `>·}` (F27) |
| `> f(▮)` in ordinary quoted text | `> f(`, `>·▮)` — Markdown's own command, unchanged (F28) |

### A line of only spaces and tabs is emptied

When the caret's line holds nothing but spaces and tabs, the change starts at the line's start. The old line becomes empty and its whitespace moves to the new line with the caret, as with the editor's plain Enter.[^emptied]

| Before | After Enter |
|---|---|
| `··▮`, a blank line in a fenced block in a list item | an empty line, then `··▮` — as today (F30) |
| `>·▮`, a blank line in a fenced block in a blockquote | `>·`, then `>·▮`: a line with a marker is not emptied (F7) |

### Two existing rows change

Every M, H, B, K and C row keeps its result except these two.[^rows-changed]

| Row | Start, then keys | Before | After |
|---|---|---|---|
| C35 | `> code▮` in a fenced block in a blockquote, Enter | a new line with no `>` (pinned as a known limit) | `>·▮` |
| C24 | `- <pre>▮` over `··x`, Enter twice | the middle line keeps its two spaces | the middle line is empty; the caret line still has its two spaces |

### `indentInsideMarkdownHtml` stays

`indentInsideMarkdownHtml` ([languages.ts:169](packages/lib/src/typescript/lib/component/editor/languages.ts#L169)) is kept and its body is not edited. One paragraph of its JSDoc is reworded. Row M37 still goes through it.[^indent-rule]

### No option and no API; the demo gets a Markdown button

Nothing is added to `CodeEditorOptions`, to `LanguageOptions` or to [component/editor/index.ts](packages/lib/src/typescript/lib/component/editor/index.ts). `CodeEditor.ts` gains no Markdown- or HTML-named code. The demo's CodeEditor tab gets a Markdown language button with a sample, because that tab is the only place with a Read-only button and a Tab size button.[^demo]

---

## Internal Structure

All line numbers are those at commit `63a81117d`. The two plans this one follows edit the same files, so find each place by its quoted text.

### `CodeEditor.ts`: the read-only extension (final form)

This block replaces the JSDoc and body of `buildReadOnlyExtension` (lines 372–385).

```ts
/**
 * Marks the one transaction a read-only editor still takes a document change
 * from: the host loading a document through `setValue`.
 */
const hostDocumentLoad = Annotation.define<boolean>();

/**
 * Marks the transaction that took the place of a refused edit: one that would
 * have changed a read-only document. The editor's update listener reads the
 * mark to signal the refusal.
 */
const readOnlyEditRefused = Annotation.define<boolean>();

/**
 * The transaction filter of a read-only editor. A transaction that changes
 * the document is replaced by one that changes nothing, moves no caret, and
 * carries the refusal mark; every other transaction passes as it is, so caret
 * movement, selection, folding and search keep working. The host's own
 * document load passes too.
 *
 * `EditorState.readOnly` alone does not do this. It is a flag each editing
 * command is expected to read, and not all of them do: CodeMirror's Markdown
 * Enter and Backspace commands, its paste-a-URL-as-a-link handler, and a
 * click on a completion all change a read-only document.
 *
 * @param transaction - The transaction about to be applied.
 * @returns The transaction itself, or the specification of its replacement.
 */
function refuseDocumentChange(transaction: Transaction): TransactionSpec {
    const hostLoad = transaction.annotation(hostDocumentLoad) === true;

    if (!transaction.docChanged || hostLoad) {
        return transaction;
    }

    return { annotations: readOnlyEditRefused.of(true) };
}

/**
 * Builds the read-only extension. Read-only, it is two parts.
 * `EditorState.readOnly` is the flag CodeMirror's own input handling and
 * commands read; it leaves the content focusable, so the caret, selection and
 * copy keep working. (`EditorView.editable.of(false)` would take the caret
 * away too, so it is not used.) The transaction filter is what makes the
 * state hold: it refuses a document change from any command, handler or
 * language that does not read the flag.
 *
 * Exported for the offline tests, which type into a state made read-only the
 * way the editor makes it, because `CodeEditor` mounts no view there.
 *
 * @param readOnly - Whether the editor should reject edits.
 * @returns The extension for the readOnly compartment.
 * @internal
 */
export function buildReadOnlyExtension(readOnly: boolean): Extension {
    if (!readOnly) {
        return EditorState.readOnly.of(false);
    }

    return [EditorState.readOnly.of(true), EditorState.transactionFilter.of(refuseDocumentChange)];
}
```

### `CodeEditor.ts`: `setValue`, the listener, and the new method

The dispatch in `setValue` becomes:

```ts
            this._view.dispatch({
                changes:     { from: 0, to: this._view.state.doc.length, insert: value },
                annotations: hostDocumentLoad.of(true),
            });
```

The update listener in `mount()` starts with one new statement and an empty line:

```ts
            EditorView.updateListener.of((update) => {
                this.signalRefusedEdit(update.transactions);

                if (update.docChanged) {
```

The new method goes directly above the JSDoc of `signalReadOnlyEdit`:

```ts
    /**
     * Signals a refused edit when one of an update's transactions carries the
     * refusal mark the read-only extension's filter leaves. One signal per
     * update, however many of its transactions were refused. Factored out of
     * the update listener in {@link CodeEditor.mount} so it can be tested
     * without a view.
     *
     * @param transactions - The transactions of one view update.
     */
    private signalRefusedEdit(transactions: readonly Transaction[]): void {
        const refused = transactions.some((transaction) => transaction.annotation(readOnlyEditRefused) === true);

        if (refused) {
            this.signalReadOnlyEdit();
        }
    }
```

### `languages.ts`: the command (final form)

This block replaces the four functions that `markdown-language-enter-inside-html` added, JSDoc included: `isCaretInsideContainedHtml`, `containerPrefixAt`, `isBetweenAdjacentTags` and `continueContainersInsideHtml`. `SyntaxNode` is the type alias already declared at [languages.ts:144](packages/lib/src/typescript/lib/component/editor/languages.ts#L144).

````ts
/**
 * The Markdown blocks around a caret that decide what Enter does there, read
 * from the ancestors of the syntax node in front of the caret.
 */
type CaretBlocks = {
    /** Inside a fenced or an indented code block. */
    code: boolean;
    /** Inside an HTML block or an HTML comment block. */
    htmlBlock: boolean;
    /** Inside a blockquote or a list item. */
    container: boolean;
};

/** The start of a line, as containerPrefixAt reads it. */
type LinePrefix = {
    /** The text that starts a new line in the same blockquotes and list item. */
    text: string;
    /** Whether the line carries a list item's marker. */
    hasListMark: boolean;
};

/** A line that holds spaces and tabs and nothing else, at least one of them. */
const BLANK_INDENTED_LINE = /^[ \t]+$/;

/** A line that holds nothing, or spaces and tabs only. */
const BLANK_LINE = /^[ \t]*$/;

/**
 * Finds the Markdown blocks that hold the character in front of a position.
 *
 * @param state - The editor state.
 * @param pos - The position to look in front of.
 * @returns Which kinds of block hold that character.
 */
function caretBlocksAt(state: EditorState, pos: number): CaretBlocks {
    const blocks: CaretBlocks = { code: false, htmlBlock: false, container: false };

    // The HTML tree is mounted inside the Markdown one, so the ancestors of
    // an HTML node continue into the Markdown blocks that hold it.
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
        if (node.name === "FencedCode" || node.name === "CodeBlock") {
            blocks.code = true;
        } else if (node.name === "HTMLBlock" || node.name === "CommentBlock") {
            blocks.htmlBlock = true;
        } else if (node.name === "Blockquote" || node.name === "ListItem") {
            blocks.container = true;
        }
    }

    return blocks;
}

/**
 * The text that starts a new line in the same blockquotes and list item as
 * the caret's line: that line's own start, up to its content, with each list
 * marker replaced by spaces. `> - <div>` gives `>   `, and `  x` gives `  `.
 *
 * The characters are copied, not measured, so the new line's columns equal
 * the current line's whatever the editor's tab size is. Markdown counts a tab
 * as four columns; a copied tab is still that tab.
 *
 * Only the syntax tree says what is a marker: inside a `<pre>` block or a
 * code block a line may start with `>` or `-` as plain text.
 *
 * @param state - The editor state.
 * @param pos - The caret position.
 * @returns The line's prefix, or `null` when the caret is in front of a marker on its line.
 */
function containerPrefixAt(state: EditorState, pos: number): LinePrefix | null {
    const line      = state.doc.lineAt(pos);
    let text        = "";
    let markEnd     = 0;
    let hasListMark = false;

    syntaxTree(state).iterate({
        from:  line.from,
        to:    line.to,
        enter: (node) => {
            const isListMark = node.name === "ListMark";

            if (!isListMark && node.name !== "QuoteMark") {
                return;
            }

            const from = node.from - line.from;
            const to   = node.to - line.from;

            text += line.text.slice(markEnd, from) + (isListMark ? " ".repeat(to - from) : line.text.slice(from, to));
            markEnd     = to;
            hasListMark = hasListMark || isListMark;
        },
    });

    if (pos - line.from < markEnd) {
        return null;
    }

    const rest = line.text.slice(markEnd);

    return { text: text + rest.slice(0, rest.search(/[^ \t]|$/)), hasListMark };
}

/**
 * Whether the caret sits directly between a pair the editor's plain Enter
 * splits over three lines: an empty `()`, `[]` or `{}`, or an element's open
 * tag and its close tag, as in `<div>|</div>`.
 *
 * @param state - The editor state.
 * @param pos - The caret position.
 * @returns `true` when the character or tag before the caret is closed by the one after it.
 */
function isBetweenPair(state: EditorState, pos: number): boolean {
    const beside = state.sliceDoc(Math.max(0, pos - 1), pos + 1);

    if (beside === "()" || beside === "[]" || beside === "{}") {
        return true;
    }

    const around = syntaxTree(state).resolveInner(pos);
    const open   = around.childBefore(pos);
    const close  = around.childAfter(pos);

    return open?.name === "OpenTag" && close?.name === "CloseTag" && open.to === pos && close.from === pos;
}

/**
 * Decides whether insertNewlineKeepPrefix handles Enter for a selection
 * range, and with which prefix. It does in four places:
 *
 * 1. in a code block, fenced or indented, at any depth;
 * 2. inside HTML that sits in a blockquote or list item, with HTML on both
 *    sides of the range;
 * 3. at the end of an HTML block in a blockquote or list item, on a line
 *    that has text in front of the caret and no list marker;
 * 4. on a line of only spaces and tabs that no blockquote or list item holds.
 *
 * Everywhere else Markdown's own Enter command, or the editor's, does the
 * right thing already.
 *
 * @param state - The editor state.
 * @param markdownLanguage - The Markdown language the editor runs.
 * @param range - The selection range Enter was pressed on.
 * @returns The prefix for the new line, or `null` to pass Enter on.
 */
function prefixForNewLine(state: EditorState, markdownLanguage: Language, range: SelectionRange): string | null {
    const prefix = containerPrefixAt(state, range.from);

    if (prefix === null) {
        return null;
    }

    const blocks         = caretBlocksAt(state, range.from);
    const line           = state.doc.lineAt(range.from);
    const markdownBefore = markdownLanguage.isActiveAt(state, range.from, -1);
    const markdownAfter  = markdownLanguage.isActiveAt(state, range.to, 1);
    let handled: boolean;

    if (blocks.code) {
        handled = true;
    } else if (!blocks.container) {
        // At the end of the document the tree puts a trailing blank line
        // outside the list it continues, so Markdown's own command passes
        // it on.
        handled = markdownBefore && BLANK_INDENTED_LINE.test(line.text);
    } else if (markdownBefore) {
        handled = false;
    } else if (!markdownAfter) {
        handled = true;
    } else {
        // HTML ends at the caret. On an item's marker line Markdown's own
        // command continues the list, and on a line with no text it leaves
        // the blockquote; both stay with it.
        handled = blocks.htmlBlock && !prefix.hasListMark && range.from - line.from > prefix.text.length;
    }

    return handled ? prefix.text : null;
}

/**
 * Builds the change that replaces a selection range with a line break and a
 * prefix. Between a pair (see isBetweenPair) the closing half moves to a line
 * of its own, with the same prefix.
 *
 * @param state - The editor state.
 * @param range - The selection range Enter was pressed on.
 * @param prefix - The text the new line starts with.
 * @returns The change, and the caret after the prefix on the new line.
 */
function newLineWithPrefix(state: EditorState, range: SelectionRange, prefix: string): { changes: ChangeSpec; range: SelectionRange } {
    const first   = state.doc.lineAt(range.from);
    const last    = state.doc.lineAt(range.to);
    const after   = last.text.slice(range.to - last.from);
    const newLine = state.lineBreak + prefix;
    const split   = range.empty && isBetweenPair(state, range.from);
    // A line of only spaces and tabs is emptied, as the editor's plain Enter
    // empties it: its whitespace moves to the new line with the caret.
    const from    = BLANK_LINE.test(first.text) ? first.from : range.from;

    return {
        // Spaces and tabs after the caret are dropped, as the editor's
        // plain Enter drops them: the prefix replaces them.
        changes: { from, to: range.to + after.search(/[^ \t]|$/), insert: split ? newLine + newLine : newLine },
        // A line break is one document position, whatever the length of
        // the editor's line separator.
        range:   EditorSelection.cursor(from + 1 + prefix.length),
    };
}

/**
 * Builds the Enter command the built-in `"markdown"` language adds for the
 * places where a new line has to start with the caret line's own prefix to
 * stay where it is: in a code block, in HTML inside a blockquote or list
 * item, and on a blank indented line (see prefixForNewLine). Markdown's own
 * Enter command passes most of them on, and the editor's plain Enter can only
 * write whitespace, which it measures with the editor's tab size; so without
 * this command the new line loses its `>`, or lands at another column than
 * the one Markdown reads.
 *
 * The prefix is copied (see containerPrefixAt). The command never writes a
 * new list marker and never removes a prefix. A selection is replaced by the
 * line break.
 *
 * The command passes Enter on (returns `false`) in a read-only editor, for a
 * range outside those places, and for a caret in front of a marker on its
 * line. With several carets it acts only when it can act on all of them.
 *
 * @param markdownLanguage - The Markdown language the editor runs.
 * @returns The command, for an Enter key binding.
 */
function insertNewlineKeepPrefix(markdownLanguage: Language): StateCommand {
    return ({ state, dispatch }) => {
        if (state.readOnly) {
            return false;
        }

        let declined = false;

        const changes = state.changeByRange((range) => {
            const prefix = prefixForNewLine(state, markdownLanguage, range);

            if (prefix === null) {
                declined = true;

                return { range };
            }

            return newLineWithPrefix(state, range, prefix);
        });

        if (declined) {
            return false;
        }

        dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));

        return true;
    };
}
````

`rest.search(/[^ \t]|$/)` is the length of the run of spaces and tabs at the start of `rest`. The pattern always matches, at the latest at the end of the string, so the result is never `-1`.

The five branches of `prefixForNewLine`, with one caret each:

| Caret | `code` | `container` | Markdown before / after | Branch | Result |
|---|---|---|---|---|---|
| `> code▮` in a fenced block | yes | yes | yes / yes | 1 | handled |
| `→▮`, a blank last line of the document | no | no | yes / yes | 2 | handled: the line is blank |
| `<div>▮` over `x`, outside every container | no | no | no / no | 2 | passed on: Markdown is not active |
| `> quote▮` | no | yes | yes / yes | 3 | passed on |
| `> <div>▮` over `> x` | no | yes | no / no | 4 | handled |
| `→<div>▮`, the last line of a nested item | no | yes | no / yes | 5 | handled |
| `- <div>▮`, the last line of the document | no | yes | no / yes | 5 | passed on: the line has a list marker |

### `languages.ts`: the loader's last statement

The statement that `markdown-language-enter-inside-html` wrote, with its comment, becomes:

```ts
        const support = markdown({ htmlTagLanguage: literalHtml });

        // Listed ahead of the support, so this Enter binding is tried before
        // Markdown's own: in an indented code block and at the end of an HTML
        // block Markdown's own command takes the key and drops the line's
        // indentation. Prec.high puts both ahead of the editor's bindings.
        return [Prec.high(keymap.of([{ key: "Enter", run: insertNewlineKeepPrefix(support.language) }])), support];
```

### Tests in `code-editor.test.ts` that are not a plain row

Three helpers and the rows S1–S6 and RO1–RO6 go inside `describe('built-in markdown language typing', …)`:

````ts
    /**
     * Types `keys` over a selection in a Markdown document.
     *
     * @param doc - The document text.
     * @param from - The offset the selection starts at.
     * @param to - The offset the selection ends at.
     * @param keys - The keys to type (see `typeText`).
     * @returns The resulting document with `|` at the caret.
     */
    async function typedOver(doc: string, from: number, to: number, keys: string): Promise<string> {
        const state = await buildTypingState('markdown', doc);

        return show(typeText(state.update({ selection: EditorSelection.range(from, to) }).state, keys));
    }

    /**
     * Presses Enter with two carets in a Markdown document.
     *
     * @param doc - The document text.
     * @param first - The offset of the first caret.
     * @param second - The offset of the second caret.
     * @returns The resulting document text.
     */
    async function enterAtTwoCarets(doc: string, first: number, second: number): Promise<string> {
        const start  = await buildTypingState('markdown', doc);
        const state  = start.update({ effects: StateEffect.appendConfig.of(EditorState.allowMultipleSelections.of(true)) }).state;
        const carets = EditorSelection.create([EditorSelection.cursor(first), EditorSelection.cursor(second)]);

        return typeText(state.update({ selection: carets }).state, '\n').doc.toString();
    }

    /**
     * Types `keys` like `typed`, in a state made read-only the way
     * `CodeEditor` makes it.
     *
     * @param languageId - The built-in language id to type in.
     * @param startDoc - The document before typing, with the caret as `buildTypingState` reads it.
     * @param keys - The keys to type (see `typeText`).
     * @returns The resulting document with `|` at the caret.
     */
    async function typedReadOnly(languageId: string, startDoc: string, keys: string): Promise<string> {
        const state = await buildTypingState(languageId, startDoc);

        return show(typeText(state.update({ effects: StateEffect.appendConfig.of(buildReadOnlyExtension(true)) }).state, keys));
    }

    it('S1: Enter over a selection in a fenced code block in a blockquote keeps the quote marker', async () => {
        // Offsets 10 to 12 select the "de" of "code".
        expect(await typedOver('> ```\n> code\n> ```', 10, 12, '\n')).toBe('> ```\n> co\n> |\n> ```');
    });

    it('S2: Enter over a selection inside an HTML block in a blockquote keeps the quote marker', async () => {
        // Offsets 11 to 12 select the "b" of "abc".
        expect(await typedOver('> <div>\n> abc\n> </div>', 11, 12, '\n')).toBe('> <div>\n> a\n> |c\n> </div>');
    });

    it('S3: Enter over a selection across two code lines in a blockquote leaves one quoted line break', async () => {
        // Offsets 9 to 14 select from after "a" to after "c".
        expect(await typedOver('> ```\n> ab\n> cd\n> ```', 9, 14, '\n')).toBe('> ```\n> a\n> |d\n> ```');
    });

    it('S4: Enter over a selection in quoted text adds no quote marker', async () => {
        // Offsets 3 to 4 select the "b" of "abc". Markdown's own command passes a selection on.
        expect(await typedOver('> abc', 3, 4, '\n')).toBe('> a\n|c');
    });

    it('S5: Enter with two carets in a fenced code block in a blockquote keeps the quote marker at both', async () => {
        // Offset 9 is the end of "> a", 13 the end of "> b".
        expect(await enterAtTwoCarets('> ```\n> a\n> b\n> ```', 9, 13)).toBe('> ```\n> a\n> \n> b\n> \n> ```');
    });

    it('S6: Enter with one caret in a code block and one in a paragraph gives neither a quote marker', async () => {
        // Offset 9 is the end of "> a", 21 the end of "text".
        expect(await enterAtTwoCarets('> ```\n> a\n> ```\n\ntext', 9, 21)).toBe('> ```\n> a\n\n> ```\n\ntext\n');
    });

    it('RO1: Enter on a markdown list line changes nothing in a read-only editor', async () => {
        expect(await typedReadOnly('markdown', '- item', '\n')).toBe('- item|');
    });

    it('RO2: Backspace after a markdown list marker changes nothing in a read-only editor', async () => {
        expect(await typedReadOnly('markdown', '- a\n- |', '\b')).toBe('- a\n- |');
    });

    it('RO3: Enter on a markdown blockquote line changes nothing in a read-only editor', async () => {
        expect(await typedReadOnly('markdown', '> quote', '\n')).toBe('> quote|');
    });

    it('RO4: a typed character changes nothing in a read-only editor', async () => {
        // A mounted view drops typed text before it becomes a transaction;
        // the harness builds the transaction, and the editor's filter refuses it.
        expect(await typedReadOnly('markdown', 'ab|', 'x')).toBe('ab|');
    });

    it('RO5: Enter in a fenced code block in a blockquote changes nothing in a read-only editor', async () => {
        expect(await typedReadOnly('markdown', '> ```\n> code|\n> ```', '\n')).toBe('> ```\n> code|\n> ```');
    });

    it('RO6: Enter and Backspace between brackets change nothing in a read-only javascript editor', async () => {
        expect(await typedReadOnly('javascript', 'a(|)', '\n')).toBe('a(|)');
        expect(await typedReadOnly('javascript', 'a(|)', '\b')).toBe('a(|)');
    });
````

A new `describe` holds RO7–RO13:

```ts
describe('CodeEditor read-only extension', () => {
    /**
     * Builds a read-only state holding "abc", the way the editor makes a
     * state read-only.
     *
     * @returns The state.
     */
    function readOnlyState(): EditorState {
        return EditorState.create({ doc: 'abc', extensions: buildReadOnlyExtension(true) });
    }

    it('RO7: refuses a document change, and moves no caret with it', () => {
        const transaction = readOnlyState().update({ changes: { from: 0, insert: 'x' }, selection: { anchor: 2 } });

        expect(transaction.docChanged).toBe(false);
        expect(transaction.state.doc.toString()).toBe('abc');
        expect(transaction.state.selection.main.head).toBe(0);
    });

    it('RO8: lets a transaction that changes no text through', () => {
        const state = EditorState.create({ doc: 'abc', extensions: [buildReadOnlyExtension(true), revealHighlightField] });
        const moved = state.update({ selection: { anchor: 2 } });
        const shown = state.update({ effects: setRevealHighlight.of({ from: 0, to: 1, flash: false }) });

        expect(moved.state.selection.main.head).toBe(2);
        expect(shown.state.field(revealHighlightField).size).toBe(1);
    });

    it('RO9: sets the read-only flag only when read-only', () => {
        expect(readOnlyState().readOnly).toBe(true);
        expect(EditorState.create({ extensions: buildReadOnlyExtension(false) }).readOnly).toBe(false);
    });

    it('RO10: when not read-only, lets a document change through', () => {
        const state = EditorState.create({ doc: 'abc', extensions: buildReadOnlyExtension(false) });

        expect(state.update({ changes: { from: 0, insert: 'x' } }).state.doc.toString()).toBe('xabc');
    });

    it('RO11: the state mount() builds for a read-only editor refuses a document change', () => {
        const editor = new CodeEditor('abc', { readOnly: true }) as any;

        editor.getElement(true);

        const createSpy = vi.spyOn(EditorState, 'create');

        editor.mount();

        const state    = createSpy.mock.results[0].value as EditorState;
        const writable = state.update({ effects: editor._readOnlyCompartment.reconfigure(buildReadOnlyExtension(false)) }).state;

        createSpy.mockRestore();

        expect(state.update({ changes: { from: 0, insert: 'x' } }).docChanged).toBe(false);
        expect(writable.update({ changes: { from: 0, insert: 'x' } }).docChanged).toBe(true);
    });

    it('RO12: setValue loads a document into a read-only editor, and signals nothing', () => {
        const state  = readOnlyState();
        const editor = new CodeEditor('abc', { readOnly: true }) as any;
        const loaded: Transaction[] = [];
        let refusals = 0;

        editor.on('readonlyedit', () => { refusals += 1; });
        editor._view = { state, dispatch: (spec: TransactionSpec) => { loaded.push(state.update(spec)); } };

        editor.setValue('new');
        editor.signalRefusedEdit(loaded);

        expect(loaded[0].state.doc.toString()).toBe('new');
        expect(refusals).toBe(0);
    });

    it('RO13: a refused transaction signals the rejected edit once, and any other signals nothing', () => {
        const state  = readOnlyState();
        const editor = new CodeEditor('abc', { readOnly: true }) as any;
        let refusals = 0;

        editor.on('readonlyedit', () => { refusals += 1; });

        editor.signalRefusedEdit([state.update({ selection: { anchor: 1 } })]);
        expect(refusals).toBe(0);

        editor.signalRefusedEdit([state.update({ changes: { from: 0, insert: 'x' } }), state.update({ changes: { from: 1, insert: 'y' } })]);
        expect(refusals).toBe(1);
    });
});
```

### The new file `tests/component/code-editor-read-only-mounted.test.ts`

````ts
// @vitest-environment jsdom
//
// `EditorState.readOnly` is a flag that editing code reads; nothing in
// CodeMirror enforces it. Whether a key press, a paste or a click can still
// change a read-only document is decided by handlers that only run in a
// mounted `EditorView`, which the modelled test DOM never creates. This file
// keeps the `@vitest-environment jsdom` pragma so `CodeEditor` mounts a real
// view, sends it real DOM events, and must not call installTestDOM.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { language } from '@codemirror/language';
import { startCompletion } from '@codemirror/autocomplete';
import { CodeEditor } from '~/component/editor/CodeEditor';
import '~/component/editor/index';
import { DOM } from '~/core/DOM';

/** The editors a test mounted, disposed after it. */
const editors: CodeEditor[] = [];

beforeEach(() => {
    // jsdom has no layout; CodeMirror's measure pass calls both.
    Range.prototype.getClientRects = (): DOMRectList => ([] as unknown as DOMRectList);
    Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect();
});
afterEach(() => {
    editors.splice(0).forEach((editor) => editor.dispose());
    DOM.reset();
    document.body.replaceChildren();
});

/** A mounted editor, its live view, and how often it signalled a refused edit. */
type Mounted = { editor: CodeEditor; view: EditorView; refusals: () => number };

/**
 * Mounts a read-only editor into the document and waits for its language.
 *
 * @param doc - The document text.
 * @param languageId - The built-in language to load.
 * @returns The editor, its view and a counter of `"readonlyedit"` events.
 */
async function mountReadOnly(doc: string, languageId: string): Promise<Mounted> {
    const editor = new CodeEditor(doc, { language: languageId, readOnly: true });
    let count    = 0;

    editors.push(editor);
    editor.on('readonlyedit', () => { count += 1; });
    editor.getElement(true);
    (editor as any).mount();

    const view = (editor as any)._view as EditorView;

    document.body.appendChild(view.dom.parentNode ?? view.dom);
    await vi.waitFor(() => expect(view.state.facet(language)).not.toBeNull());

    return { editor, view, refusals: () => count };
}

/**
 * Sends a real `keydown` to the editor's content.
 *
 * @param view - The live view.
 * @param key - The key's name.
 * @param keyCode - The key's legacy code, which CodeMirror reads.
 * @returns Whether a key binding handled the key.
 */
function pressKey(view: EditorView, key: string, keyCode: number): boolean {
    const event = new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true });

    view.contentDOM.dispatchEvent(event);

    return event.defaultPrevented;
}

describe('CodeEditor read-only, mounted', () => {
    it('G1: Enter on a markdown list line changes nothing and signals once', async () => {
        const { view, refusals } = await mountReadOnly('- item', 'markdown');

        view.dispatch({ selection: EditorSelection.cursor(6) });
        pressKey(view, 'Enter', 13);

        expect(view.state.doc.toString()).toBe('- item');
        expect(view.state.selection.main.head).toBe(6);
        expect(refusals()).toBe(1);
    });

    it('G2: Backspace after a markdown list marker changes nothing and signals once', async () => {
        const { view, refusals } = await mountReadOnly('- a\n- ', 'markdown');

        view.dispatch({ selection: EditorSelection.cursor(6) });
        pressKey(view, 'Backspace', 8);

        expect(view.state.doc.toString()).toBe('- a\n- ');
        expect(refusals()).toBe(1);
    });

    it('G3: pasting a URL over selected markdown text changes nothing and signals once', async () => {
        const { view, refusals } = await mountReadOnly('see this page', 'markdown');
        const paste = new Event('paste', { bubbles: true, cancelable: true });

        Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'https://example.com' } });
        view.dispatch({ selection: EditorSelection.range(4, 8) });
        view.contentDOM.dispatchEvent(paste);

        expect(view.state.doc.toString()).toBe('see this page');
        expect(refusals()).toBe(1);
    });

    it('G4: clicking a completion changes nothing and signals once', async () => {
        const { view, refusals } = await mountReadOnly('fun', 'javascript');

        view.dispatch({ selection: EditorSelection.cursor(3) });
        startCompletion(view);

        const option = await vi.waitFor(() => {
            const found = document.querySelector('.cm-tooltip-autocomplete li');

            expect(found).not.toBeNull();

            return found!;
        });

        option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

        expect(view.state.doc.toString()).toBe('fun');
        expect(refusals()).toBe(1);
    });

    it('G5: setValue still loads a document, and signals nothing', async () => {
        const { editor, view, refusals } = await mountReadOnly('old', 'markdown');

        editor.setValue('new');

        expect(view.state.doc.toString()).toBe('new');
        expect(refusals()).toBe(0);
    });

    it('G6: after setReadOnly(false), Enter continues the list again', async () => {
        const { editor, view, refusals } = await mountReadOnly('- item', 'markdown');

        editor.setReadOnly(false);
        view.dispatch({ selection: EditorSelection.cursor(6) });
        pressKey(view, 'Enter', 13);

        expect(view.state.doc.toString()).toBe('- item\n- ');
        expect(refusals()).toBe(0);
    });

    it('G7: an Enter no command takes is left to the browser', async () => {
        const { view } = await mountReadOnly('a(1)', 'javascript');

        view.dispatch({ selection: EditorSelection.cursor(4) });

        // Not prevented, so a browser goes on to fire `beforeinput`, where the
        // editor's existing hook signals the refusal. jsdom fires none.
        expect(pressKey(view, 'Enter', 13)).toBe(false);
        expect(view.state.doc.toString()).toBe('a(1)');
    });
});
````

### The demo sample

````ts
// The places the "markdown" language handles Enter itself: a fenced code
// block in a blockquote, one opened on a list item's marker line, and an HTML
// block in a nested item whose lines are indented with a literal tab. Enter at
// the end of any of their lines is the manual-verify handle for "the new line
// stays in its quote, item and code block", at each "Tab size"; with
// "Read-only: on", Enter on the first line is the handle for "a read-only
// editor cannot be edited from the keyboard".
const SAMPLE_MARKDOWN = `- item

> \`\`\`js
> const quoted = true;
> \`\`\`

- \`\`\`js
  const listed = true;
  \`\`\`

- a
  - b
\t<div>
\tx
\t</div>`;
````

The sample ends without a line break, so its last line is the tab-indented `</div>`.

---

## Ordered Implementation Steps

Run every command from `packages/lib`.

0. **Check the starting point.** `plans/implemented/` holds `codeeditor-bracket-pair-backspace.md` and `markdown-language-enter-inside-html.md`. `grep -c 'continueContainersInsideHtml' src/typescript/lib/component/editor/languages.ts` prints a number above `0`, and `grep -c 'codeEditorKeymap' src/typescript/lib/component/editor/CodeEditor.ts` does too. `npx vitest run tests/component/code-editor.test.ts` is green. If one of these fails, stop and report: this plan edits what those two plans wrote.
1. **Export `buildReadOnlyExtension`, with no behaviour change.**[^order-of-steps] In [CodeEditor.ts](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts), change `function buildReadOnlyExtension(readOnly: boolean): Extension {` to `export function buildReadOnlyExtension(readOnly: boolean): Extension {`. Add the line ` * @internal` as the last line of its JSDoc. Check: `npm run typecheck` passes.
2. **Write the tests.**
   - In [code-editor.test.ts](packages/lib/tests/component/code-editor.test.ts), add `buildReadOnlyExtension` to the import from `'~/component/editor/CodeEditor'` on line 2. Make sure the value import from `'@codemirror/state'` names `StateEffect`, and the type import from `'@codemirror/state'` names `TransactionSpec` beside `Transaction`.
   - Replace the whole `it('C35: …')` block, comment included, and the whole `it('C24: …')` block with the two rows of the same ids in `## Expected Behaviour`. Each stays where it is.
   - Directly after the last `it` of `describe('built-in markdown language typing', …)` and before its closing `});`, add in this order: rows F1–F41 from `## Expected Behaviour`, then the block with the three helpers and rows S1–S6 and RO1–RO6 from `## Internal Structure`. Do not add C35 and C24 a second time.
   - Each F row is one `it`, in the shape of the existing M rows: the title is `'<id>: <title>'`, and the body is one `expect(await typed('markdown', <start>, <keys>)).toBe(<after>);` per `start + keys → after` line. Paste the string literals exactly as written. A row marked `at tabSize …` is wrapped in a loop over those sizes, as row M37 is. Its title ends with `` with tabSize ${tabSize}``, and it passes `tabSize` as the fourth argument:

     ````ts
         for (const tabSize of [2, 8]) {
             it(`F16: Enter on a tab-indented code line in a nested item copies the tab with tabSize ${tabSize}`, async () => {
                 expect(await typed('markdown', '- a\n  - b\n\t```\n\tcode|\n\t```', '\n', tabSize)).toBe('- a\n  - b\n\t```\n\tcode\n\t|\n\t```');
             });
         }
     ````
   - Add `describe('CodeEditor read-only extension', …)` from `## Internal Structure` directly after the closing `});` of `describe('CodeEditor replaceRange', …)` (which starts at line 1902).
   - Create `tests/component/code-editor-read-only-mounted.test.ts` with the content in `## Internal Structure`.
   - Run `npx vitest run tests/component/code-editor.test.ts tests/component/code-editor-read-only-mounted.test.ts`. Expect exactly 51 failing tests, and every other test green:
     - 12 read-only tests: RO1–RO4, RO7, RO11, RO12, RO13, G1–G4.
     - 39 Enter tests: C24, C35, F1–F7, F9–F11, F13–F20, F24, F27, F32, F34–F37, F40, F41, S1, S2, S3, S5. F16, F17, F18 and F32 count twice and F34 three times, once per `tabSize`.

     A different red set means a row was mistyped, or a plan this one follows did something else than it says. Fix that before going on.
3. **Add the read-only filter** in [CodeEditor.ts](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts).
   - Line 23: add `Annotation` to the value import from `"@codemirror/state"`. Line 24: change `import type { Extension } from "@codemirror/state";` to `import type { Extension, Transaction, TransactionSpec } from "@codemirror/state";`.
   - Replace `buildReadOnlyExtension`, JSDoc included, with the first block in `## Internal Structure`.
   - Change the dispatch in `setValue`, add the statement to the update listener, and add `signalRefusedEdit`, all as in `## Internal Structure`.
   - In the JSDoc of `setValue`, after the sentence that ends `also dispatches a full-document replace transaction.`, add: `A read-only editor takes it too: read-only guards against edits, not against the host loading another document.`
   - Replace the two description lines of the JSDoc of `on(event: "readonlyedit", …)` (line 1782, `Registers a listener for the "readonlyedit" event, fired when a user` and the line after it) with:

     ```ts
          * Registers a listener for the `"readonlyedit"` event, fired when an edit
          * is refused because the editor is read-only: typed text, a key that
          * edits, a paste, a drop, a completion picked from the list, or a call to
          * `replaceRange`, `cut`, `paste` or `format`.
     ```
   - In the JSDoc of `CodeEditorEvent` (line 170), change `a user edit was rejected because the editor is read-only` to `an edit was refused because the editor is read-only`.
   - Replace the five comment lines inside `EditorView.domEventHandlers({` (lines 2290–2294, from the line that starts `// A user edit while read-only is blocked` to the line that ends `runs, so each needs its own hook.`) with:

     ```ts
                     // Typed text, IME input, a plain paste and a drop in a read-only
                     // editor are dropped by CodeMirror's own input handling before
                     // they become a transaction, so the read-only filter never sees
                     // them. These hooks signal those: typing / IME / delete fire
                     // `beforeinput`, while paste and drop are prevented before
                     // `beforeinput` runs, so each needs its own hook. An edit that
                     // does become a transaction is refused by the filter and
                     // signalled from the update listener above; its key or paste
                     // event is handled by then, so it does not reach these hooks.
     ```
   - Check: `grep -c 'EditorState.transactionFilter.of(refuseDocumentChange)' src/typescript/lib/component/editor/CodeEditor.ts` prints `1`. `npm run typecheck` passes. Re-run the step-2 command: the 12 read-only tests are green, and exactly the 39 Enter tests still fail.
4. **Widen the Enter command** in [languages.ts](packages/lib/src/typescript/lib/component/editor/languages.ts).
   - Add `ChangeSpec` to the type import from `"@codemirror/state"`, so it names `ChangeSpec`, `EditorState`, `SelectionRange` and `StateCommand`.
   - Replace the four functions named in `## Internal Structure`, JSDoc included, with the block given there. It goes where they were: directly above the `registerLanguage({` call whose `id` is `"markdown"`.
   - Replace the loader's last statement and its comment with the block in `## Internal Structure`.
   - In the JSDoc of `indentInsideMarkdownHtml`, replace the paragraph that names `continueContainersInsideHtml` with this one. Do not change the function's body or the rest of its JSDoc.

     ```ts
      * Inside a blockquote or list item, insertNewlineKeepPrefix handles Enter
      * before this rule is asked. The rule still answers for HTML outside both,
      * and where that command passes the key on, as on an item's marker line
      * that an HTML block ends on.
     ```
   - Check: `grep -c 'continueContainersInsideHtml\|isCaretInsideContainedHtml\|isBetweenAdjacentTags' src/typescript/lib/component/editor/languages.ts` prints `0`. `grep -c 'run: insertNewlineKeepPrefix(support.language)' src/typescript/lib/component/editor/languages.ts` prints `1`. `npm run typecheck` passes.
   - Re-run the step-2 command: all green. Then `npx vitest run tests/component/markdown-editor.test.ts tests/component/display/Markdown.test.ts tests/unit/import-without-dom.test.ts`: all green.
5. **Add the demo button** in [CodeEditorPanel.ts](packages/lib/src/typescript/CodeEditorPanel.ts).
   - Add `SAMPLE_MARKDOWN` from `## Internal Structure`, comment included, directly above the comment that starts `// A foldable block plus a single long line` (line 70).
   - Directly after the line `upperToolbar.addComponent(this.makeLanguageButton('SQL', 'sql', SAMPLE_SQL));` (line 205), add `upperToolbar.addComponent(this.makeLanguageButton('Markdown', 'markdown', SAMPLE_MARKDOWN));`.
   - In the class JSDoc (lines 93–94), change `between JavaScript, CSS, Python, and` / `JSON samples.` to `between JavaScript, CSS, Python,` / `JSON, SQL and Markdown samples.`, keeping the rest of both lines.
6. **Update [CodeEditor.md](packages/lib/docs/components/CodeEditor.md)**, with the text in `## Documentation Impact`.
7. **Update [MarkdownEditor.md](packages/lib/docs/components/MarkdownEditor.md)**, with the text in `## Documentation Impact`.
8. **Add the two changelog entries** to [next.md](packages/lib/docs/reference/changelog/next.md), with the text in `## Documentation Impact`.
9. **Run the full checks** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/languages.ts` |
| Modify | `packages/lib/src/typescript/CodeEditorPanel.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Create | `packages/lib/tests/component/code-editor-read-only-mounted.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Two contracts. A read-only `CodeEditor` keeps its document unless the host calls `setValue`, and says so once for each refused edit. Enter in a code block, in HTML inside a container, or on a blank indented line gives a line that stays in the same containers and the same block, with its tabs intact.

### Offline: Enter rows

All rows run through the typing harness in `describe('built-in markdown language typing', …)`, on the `markdown` language. Each row is its id, then `R` or `P`, then the test title. The line under it is `start + keys → after`, written as the JavaScript string literals to paste.

- In a start document and in a result, `|` is the caret. A start document with no `|` has the caret at its end.
- In the keys, `\n` is Enter and `\b` is Backspace.
- `R` rows fail before step 4 and pass after it. `P` rows pass before and after: they pin behaviour that must not change.

````text
# Fenced code in a blockquote
C35  R  Enter in a fenced code block in a blockquote keeps the quote marker
        '> ```\n> code|\n> ```'  +  '\n'  →  '> ```\n> code\n> |\n> ```'
F1   R  text typed after Enter in a fenced code block in a blockquote lands in the block
        '> ```\n> code|\n> ```'  +  '\nmore'  →  '> ```\n> code\n> more|\n> ```'
F2   R  a fenced code block typed in a blockquote stays in the quote
        '> ```js'  +  '\ncode\n```\n'  →  '> ```js\n> code\n> ```\n> |'
F3   R  Enter after the closing fence keeps the quote marker
        '> ```\n> code\n> ```|\n> after'  +  '\n'  →  '> ```\n> code\n> ```\n> |\n> after'
F4   R  Enter in a fenced code block in a nested blockquote keeps both markers
        '> > ```\n> > code|\n> > ```'  +  '\n'  →  '> > ```\n> > code\n> > |\n> > ```'
F5   R  Enter on a deeper-indented code line in a blockquote keeps that indentation
        '> ```\n>     deep|\n> ```'  +  '\n'  →  '> ```\n>     deep\n>     |\n> ```'
F6   R  Enter in the middle of a quoted code line keeps the quote marker
        '> ```\n> co|de\n> ```'  +  '\n'  →  '> ```\n> co\n> |de\n> ```'
F7   R  repeated Enter in a fenced code block in a blockquote never drops the quote marker
        '> ```\n> code|\n> ```'  +  '\n\n'  →  '> ```\n> code\n> \n> |\n> ```'
        '> ```\n> code'  +  '\n\n\n'  →  '> ```\n> code\n> \n> \n> |'
F8   P  Enter in front of the quote marker of a code line leaves the line as it is
        '> ```\n|> code\n> ```'  +  '\n'  →  '> ```\n\n|> code\n> ```'

# Fenced code in a list item
F9   R  Enter after a fence opened on an item marker line indents to the item content
        '- ```js|\n  code\n  ```'  +  '\n'  →  '- ```js\n  |\n  code\n  ```'
F10  R  Enter after a fence opened on an ordered item marker line blanks the whole marker
        '1. ```|\n   code\n   ```'  +  '\n'  →  '1. ```\n   |\n   code\n   ```'
F11  R  a fenced code block typed on an item marker line stays in the item
        '- ```'  +  '\ncode\n```\n'  →  '- ```\n  code\n  ```\n  |'
F12  P  Enter on a code line of an item continuation keeps the line indentation
        '- ```\n  code|\n  ```'  +  '\n'  →  '- ```\n  code\n  |\n  ```'

# Nested containers
F13  R  Enter in a fenced code block in an item inside a blockquote copies the line prefix
        '> - ```\n>   code|\n>   ```'  +  '\n'  →  '> - ```\n>   code\n>   |\n>   ```'
F14  R  Enter in a fenced code block in a blockquote inside an item keeps the quote marker
        '- > ```\n  > code|\n  > ```'  +  '\n'  →  '- > ```\n  > code\n  > |\n  > ```'
F15  R  Enter after a fence opened on an item marker line inside a blockquote keeps the quote and the item
        '> - ```|\n>   code'  +  '\n'  →  '> - ```\n>   |\n>   code'

# Tabs
F16  R  Enter on a tab-indented code line in a nested item copies the tab
        '- a\n  - b\n\t```\n\tcode|\n\t```'  +  '\n'  →  '- a\n  - b\n\t```\n\tcode\n\t|\n\t```'
        at tabSize 2 and 8
F17  R  Enter on a tab-indented line of a top-level fenced code block copies the tab
        '```\n\tcode|\n```'  +  '\n'  →  '```\n\tcode\n\t|\n```'
        at tabSize 2 and 8
F18  R  text typed after Enter in a tab-indented code block stays in the code block
        'p\n\n\tcode'  +  '\nmore'  →  'p\n\n\tcode\n\tmore|'
        at tabSize 2 and 8

# Indented code
F19  R  Enter in an indented code block in a blockquote keeps the code indentation
        '>     code|\n>     more'  +  '\n'  →  '>     code\n>     |\n>     more'
F20  R  Enter in an indented code block in a list item keeps the code indentation
        '- a\n\n      code|\n      more'  +  '\n'  →  '- a\n\n      code\n      |\n      more'
F21  P  Enter in a top-level indented code block keeps the code indentation
        'p\n\n    code'  +  '\n'  →  'p\n\n    code\n    |'
F22  P  three Enters leave a blockquote from an indented code block
        '>     code'  +  '\n\n\n'  →  '>     code\n\n|'
F23  P  Enter in front of the first character of an indented code block in an item is not this command's
        '- a\n\n      |code'  +  '\n'  →  '- a\n\n\n  |code'

# Empty pairs
F24  R  Enter between brackets in a fenced code block in a blockquote gives both new lines the quote marker
        '> ```\n> f(|)\n> ```'  +  '\n'  →  '> ```\n> f(\n> |\n> )\n> ```'
F25  P  Enter between brackets in a fenced code block in a list item still splits them
        '- ```\n  f(|)\n  ```'  +  '\n'  →  '- ```\n  f(\n  |\n  )\n  ```'
F26  P  Enter between brackets in a top-level fenced code block still splits them
        '```\nf(|)\n```'  +  '\n'  →  '```\nf(\n|\n)\n```'
F27  R  Enter between braces inside <script> in a blockquote splits them and keeps the quote marker
        '> <script>\n> f() {|}\n> </script>'  +  '\n'  →  '> <script>\n> f() {\n> |\n> }\n> </script>'
F28  P  Enter between brackets in quoted text is Markdown's own and does not split them
        '> f(|)'  +  '\n'  →  '> f(\n> |)'

# Blank lines
F29  P  Enter on a blank indented line of a top-level fenced code block empties that line
        '```\n  code'  +  '\n\n'  →  '```\n  code\n\n  |'
F30  P  Enter on a blank indented line of a fenced code block in an item empties that line
        '- ```\n  code|\n  ```'  +  '\n\n'  →  '- ```\n  code\n\n  |\n  ```'
C24  R  repeated Enter inside an open HTML block in a list item never drops the indentation
        '- <pre>|\n  x\n  </pre>'  +  '\n\n'  →  '- <pre>\n\n  |\n  x\n  </pre>'
F31  P  Enter on a blank indented line after a list keeps the indentation
        '- a\n  |'  +  '\n'  →  '- a\n\n  |'
F32  R  Enter on a blank tab-indented line at the end of the document copies the tab
        '- a\n  - b\n\t<div>\n\t|'  +  '\n'  →  '- a\n  - b\n\t<div>\n\n\t|'
        at tabSize 2 and 8
F33  P  Enter on a blank indented line inside a top-level HTML block is the editor's own
        '<pre>\n  |\n</pre>'  +  '\n'  →  '<pre>\n\n  |\n</pre>'

# The end of an HTML block
F34  R  Enter at the end of an HTML block on a tab-indented line of a nested item copies the tab
        '- a\n  - b\n\t<div>'  +  '\n'  →  '- a\n  - b\n\t<div>\n\t|'
        at tabSize 2, 4 and 8
F35  R  text typed after Enter at the end of a tab-indented HTML block stays in the item
        '1. a\n\t<div>'  +  '\nx'  →  '1. a\n\t<div>\n\tx|'
F36  R  Enter after a close tag on a tab-indented line copies the tab
        '- a\n  - b\n\t<div>\n\tx\n\t</div>'  +  '\n'  →  '- a\n  - b\n\t<div>\n\tx\n\t</div>\n\t|'
F37  R  Enter at the end of an HTML block copies indentation deeper than the item content
        '- a\n   <div>'  +  '\n'  →  '- a\n   <div>\n   |'
F38  P  Enter after an inline tag at the end of a quoted paragraph is Markdown's own
        '> a\nb <i>x</i>'  +  '\n'  →  '> a\nb <i>x</i>\n> |'
F39  P  Enter in front of a tag on an item marker line is Markdown's own
        '- a |<b>x</b>'  +  '\n'  →  '- a\n- |<b>x</b>'

# Backspace on the new prefix
F40  R  Backspace deletes the quote prefix of a new code line one character at a time
        '> ```\n> code|\n> ```'  +  '\n\b'  →  '> ```\n> code\n>|\n> ```'
        '> ```\n> code|\n> ```'  +  '\n\b\b'  →  '> ```\n> code\n|\n> ```'
F41  R  Backspace deletes the item indentation of a new code line in one press
        '- ```js|\n  code\n  ```'  +  '\n\b'  →  '- ```js\n|\n  code\n  ```'
````

Rows S1–S6 set a selection or two carets; their code is in `## Internal Structure`.

| Row | What it pins | Kind |
|---|---|---|
| S1 | Enter over a selection in a fenced block in a blockquote keeps the `>` | R |
| S2 | Enter over a selection inside an HTML block in a blockquote keeps the `>` | R |
| S3 | Enter over a selection across two code lines in a blockquote leaves one quoted line break | R |
| S4 | Enter over a selection in ordinary quoted text adds no `>` | P |
| S5 | Enter with two carets in a fenced block in a blockquote keeps the `>` at both | R |
| S6 | Enter with one caret in a code block and one in a paragraph gives neither a `>` | P |

**Existing rows.** Every M, H, B, K and C row other than C24 and C35 keeps its result. That includes M34 and M36 as `markdown-language-enter-inside-html` leaves them.[^m34] C36 now goes through `insertNewlineKeepPrefix` and gives the same text. M37 still goes through `indentInsideMarkdownHtml`.

### Offline: read-only tests

| Test | Where | What it pins | Kind |
|---|---|---|---|
| RO1 | typing harness | Enter on a Markdown list line changes nothing | R |
| RO2 | typing harness | Backspace after a Markdown list marker changes nothing | R |
| RO3 | typing harness | Enter on a Markdown blockquote line changes nothing | R |
| RO4 | typing harness | a typed character changes nothing | R |
| RO5 | typing harness | Enter in a fenced block in a blockquote changes nothing | P |
| RO6 | typing harness | Enter and Backspace between brackets change nothing in `javascript` | P |
| RO7 | state | a document change is refused, and its caret move with it | R |
| RO8 | state | a caret move and an effect pass | P |
| RO9 | state | the `readOnly` flag is set only when read-only | P |
| RO10 | state | when not read-only, a document change passes | P |
| RO11 | the state `mount()` builds | a read-only editor's state refuses a change; reconfigured to writable, the same state takes it | R |
| RO12 | `setValue` on an injected view | the document load passes the filter, and signals nothing | R |
| RO13 | `signalRefusedEdit` | a refused transaction fires `"readonlyedit"` once for the update; any other fires nothing | R |

`R` tests fail before step 3 and pass after it. The harness reaches read-only by adding `buildReadOnlyExtension(true)` to its state, which is the extension `setReadOnly(true)` installs.

### Offline, mounted under jsdom

`code-editor-read-only-mounted.test.ts` mounts a real view and sends real DOM events.

| Test | Does | Expects | Kind |
|---|---|---|---|
| G1 | `keydown` Enter at the end of `- item`, `markdown` | the document and the caret unchanged; one `"readonlyedit"` | R |
| G2 | `keydown` Backspace after the marker of `- a`, `- `, `markdown` | unchanged; one `"readonlyedit"` | R |
| G3 | `paste` of `https://example.com` over the selected word in `see this page`, `markdown` | unchanged; one `"readonlyedit"` | R |
| G4 | `Ctrl-Space`'s command, then `mousedown` on the first entry of the list, `javascript` | `fun` unchanged; one `"readonlyedit"` | R |
| G5 | `setValue('new')` | the document is `new`; no `"readonlyedit"` | P |
| G6 | `setReadOnly(false)`, then Enter at the end of `- item` | `- item`, `- `; no `"readonlyedit"` | P |
| G7 | `keydown` Enter in `javascript` | not handled by any binding; the document unchanged | P |

### Manual checks

A real browser adds what jsdom lacks: `beforeinput`, the flash, and real key delivery. Run `npm run dev` from the repo root and open the demo's "CodeEditor" tab. Press the "Markdown" language button.

| # | Do | Expect |
|---|---|---|
| V1 | caret at the end of `> const quoted = true;`, press Enter, type `x` | a new line `> x` inside the fenced block; the lines below unchanged |
| V2 | caret at the end of the line `` - ```js ``, press Enter | a new line of two spaces holding the caret; the status line under the editor reads `Col 3` |
| V3 | press "Tab size" until it reads `Tab size: 2`; caret at the end of the document, press Enter | the status line reads `Col 2`: the new line starts with one tab, not with spaces and not at the margin |
| V4 | press Enter once more, on that blank line | `Col 2` again; the line above is empty |
| V5 | press "Read-only" so it reads on; caret at the end of `- item`, press Enter, then Backspace | nothing changes; the editor flashes once per key |
| V6 | still read-only: type a letter | nothing changes; one flash, not two |
| V7 | still read-only: select `item`, copy `https://example.com` from elsewhere and paste it | nothing changes; one flash |
| V8 | press "JS", keep read-only on, put the caret after a word, press `Ctrl-Space`, click an entry of the list | nothing is inserted; one flash |
| V9 | press "Read-only" so it reads off, press "Markdown", caret at the end of `- item`, press Enter | a new `- ` line |

Then open the "MD Editor" tab and switch on "Edit Markdown source".

| # | Do | Expect |
|---|---|---|
| V10 | on a new last line type `` > ```js ``, Enter, `code`, Enter, three backticks, Enter, `after` | every new line starts with `> `; the last line reads `> after` |

---

## Verification

- `npm run typecheck`, `npm run test` and `npm run lint` from the repo root: green and clean.
- `npm run docs:api`: held to the standing bar in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md). Then `npm run docs:llms:check`.
- From `packages/lib`: `grep -c 'EditorState.transactionFilter.of(refuseDocumentChange)' src/typescript/lib/component/editor/CodeEditor.ts` prints `1`.
- From `packages/lib`: `grep -c 'continueContainersInsideHtml' src/typescript/lib/component/editor/languages.ts` prints `0`.
- `grep -n 'buildReadOnlyExtension' packages/lib/src/typescript/lib/component/editor/index.ts` has no match: the function is not public.
- `git diff` of `CodeEditor.ts` adds no identifier that contains `Markdown` or `Html`. The only mention of either word that the diff adds is in the JSDoc of `refuseDocumentChange`.
- `git diff --stat` touches only the eight files in `## Files to Create / Modify / Delete`. `MarkdownEditor.ts` is unchanged.
- The offline tests: 51 red before step 3, 39 after it, none after step 4 (step 2 lists them). `## Addendum: What pins each part of the command` shows which rows guard which part.
- Manual: V1–V10.

---

## Documentation Impact

No exported symbol of the package changes, so no API page and no `llms.txt` entry changes. Two pages and the changelog change.

### `CodeEditor.md`: Built-in languages

Replace everything from the line that starts `Enter inside HTML does something other than keep the line's indentation in these places:` through the last bullet under it. The paragraph above, which starts ``The `markdown` language types HTML literally``, and the paragraph below, which starts `Both the grammar and the formatter load`, stay.

`````markdown
Enter in the `markdown` language does one of three things, decided by where the caret is:

| Caret | Enter |
| --- | --- |
| In Markdown text in a list item or a blockquote | Markdown's own continuation: a new list marker, or the `>`. On an empty item or an empty quoted line it removes the marker, which is how Enter leaves a list or a quote. |
| In a code block (fenced or indented), in HTML inside a blockquote or list item, or on a blank indented line that no list item or blockquote holds, such as the last line of a document | The new line starts with the same *prefix* as the line the caret is on. |
| Anywhere else, such as a paragraph, or HTML outside every blockquote and list item | The editor's plain Enter: the new line keeps the line's indentation. |

The prefix is the start of the caret's line, up to its text: its `>` markers and its indentation, with a list marker replaced by spaces. After `` > - ```js `` the new line starts with `>` and three spaces. So the new line stays in the same quote, the same item and the same code block, and never starts a new item.

- **The prefix is copied character for character.** A tab stays a tab, so the new line is at the column Markdown reads, whatever the editor's `tabSize` is.
- **Enter never removes the prefix** in a fenced code block, or in HTML that continues after the caret. In a fenced block inside a blockquote every new line starts with the `>`, the line after the closing fence included. An indented code block ends at a blank line, so a second Enter there is Markdown's own again. Backspace deletes the prefix like any other text.
- **At the end of an HTML block**, a line with no list marker gets the prefix too. On a list item's marker line (`- <div>`) Enter continues the list with a new marker instead, as after any item's first line, and Backspace turns that marker into indentation.
- **Between an empty pair** — `()`, `[]`, `{}`, or an adjacent open and close tag (`<div>|</div>`) — the closing half moves to its own line, as with the editor's plain Enter. Both new lines get the prefix.
- **With text selected** in a code block, or in HTML inside a blockquote or list item, Enter replaces the selection with the line break and the prefix. In other quoted text it adds no `>`.
- **A line that holds only spaces and tabs is emptied**; its indentation moves to the new line with the caret.
- **Inside `<script>` and `<style>`, and inside a `style` or `on…` attribute value**, JavaScript and CSS keep their own indentation. In a blockquote or list item the new line gets the prefix instead.
- **The editor's plain Enter** measures the indentation it keeps with `tabSize` and writes it as spaces. It handles what is left, which is mostly lines where indentation does not change what the Markdown means.
- **A tab-indented line of ordinary text in a list item** is the one place a tab is not kept: Markdown's own continuation starts the new line at the margin. Text typed there still belongs to the item's paragraph.
`````

### `CodeEditor.md`: a new Read-only section

Add this section directly above the line `## Cursor position`:

```markdown
## Read-only

`readOnly: true`, or `setReadOnly(true)`, locks the document. The caret, selection, copy, search, folding and scrolling keep working; nothing the user does changes the text. That holds for every key, for paste, drop and cut, for a completion picked from the list, and for every language, including one you [register](#registering-a-language): the editor itself refuses any change to a read-only document, so a language's own key bindings and handlers cannot edit it either.

A refused edit fires the `"readonlyedit"` event and flashes the editor. `replaceRange()`, `cut()`, `paste()` and `format()` are refused the same way when called from code. Two things stay quiet: Replace and Replace all in the search panel do nothing, and the completion list still opens with `Ctrl-Space`, though picking an entry is refused.

`setValue()` still replaces the whole document: read-only guards against edits, not against the host loading another document.

```

### `CodeEditor.md`: Keyboard and Common methods

- In the Keyboard table, add this row directly above the row that starts with `` | `Ctrl-Space` ``:

  ```markdown
  | `Enter` | Start a new line that keeps the current line's indentation. A language can bind Enter itself: `markdown` continues lists, blockquotes and code blocks — see [Built-in languages](#built-in-languages) |
  ```
- Directly under the Keyboard table, above the paragraph that starts `When the app enables`, add this paragraph and an empty line:

  ```markdown
  In a [read-only](#read-only) editor none of these keys changes the document.
  ```
- In the Common methods table, replace the `` `getValue()` / `setValue(value)` `` row and the `` `getReadOnly()` / `setReadOnly(readOnly)` `` row with these two. Each stays where it is.

  ```markdown
  | `getValue()` / `setValue(value)` | Read or replace the whole document. `setValue` also works while the editor is [read-only](#read-only). |
  | `getReadOnly()` / `setReadOnly(readOnly)` | Read or toggle whether the editor accepts edits. See [Read-only](#read-only). |
  ```

### `MarkdownEditor.md`

- In the paragraph that starts `Both surfaces are bound to the **same Markdown value**` (line 278), replace its last sentence, which starts ``In `"source"` mode, HTML is typed literally`` and ends with the link to CodeEditor's built-in languages, with:

  ```markdown
  In `"source"` mode, HTML is typed literally, with no close tags added, and Enter in a code block or in HTML keeps the new line in the blockquote or list item it was pressed in; see [CodeEditor's built-in languages](/components/CodeEditor#built-in-languages).
  ```
- In the first paragraph of `## Read-only` (line 306), directly after its last sentence, which starts `The source surface keeps its caret and keyboard selection while read-only`, add:

  ```markdown
  No key pressed there changes the document: see [CodeEditor's Read-only section](/components/CodeEditor#read-only).
  ```

### Changelog

Add both entries to [next.md](packages/lib/docs/reference/changelog/next.md) under `## Fixed` → `### Components`, as the last two bullets of that subsection, directly above `### Core`. Wrap the lines like the neighbouring bullets.

`````markdown
- **Enter in a Markdown code block keeps the new line in its blockquote or list item.** In `MarkdownEditor`'s `"source"` mode, and in any `CodeEditor` with `language: "markdown"`, Enter in a fenced code block inside a blockquote started the new line without the `>`, which ends the quote and breaks the fence. Enter after a fence opened on a list item's first line (`` - ```js ``) put the new line at the margin, outside the item, and Enter in an indented code block inside a blockquote or list item dropped the code's indentation. In a code block the new line now starts with the same prefix as the line the caret is on: its `>` markers and its indentation, with a list marker replaced by spaces. The prefix is copied as written, so a tab stays a tab whatever the editor's `tabSize`. Before, Enter on a tab-indented code line wrote `tabSize` spaces, which at `tabSize: 2` moved the new line out of an indented code block or a nested list item. The same now holds at the end of an HTML block on a line of a list item, where a tab-indented line used to lose its indentation altogether, on a blank indented last line of the document, and when Enter replaces a selection inside a code block or inside HTML in a blockquote or list item. Enter between an empty `()`, `[]` or `{}` in a code block still moves the closing bracket to its own line, now with the prefix on both new lines. Markdown's own list and blockquote continuation is unchanged. No consumer action is needed.

- **A read-only `CodeEditor` can no longer be edited from the keyboard or the completion list.** `readOnly` relied on each editing command checking it, and some do not. With `language: "markdown"`, Enter on a list or blockquote line added a line, Backspace after a list marker removed the marker, and pasting a URL over selected text wrapped the text in a link. In every language, clicking an entry of the completion list, which `Ctrl-Space` still opens, inserted it. A read-only `MarkdownEditor` in `"source"` mode was affected the same way. The editor now refuses every change to a read-only document itself, whichever key binding, handler or language it comes from, and signals it with the `"readonlyedit"` event and the rejection flash. `setValue()` still loads a document into a read-only editor. A language you registered is covered too: if its extension changes the document of a read-only editor on its own, that change is now refused.
`````

---

## Potential Challenges

- **The two earlier plans may have left other text than they describe.** Find each edit by the quoted names. If `languages.ts` has no `continueContainersInsideHtml`, or the test file has no `it('C35: …')`, stop and report instead of guessing.
- **The filter must not read `transaction.state`.** Reading it builds a state that is then thrown away. `docChanged` and `annotation()` do not.
- **The order in the loader's returned array carries meaning.** With the support listed first, rows F19, F20 and F34–F37 fail.
- **The `state.readOnly` check in the command looks removable once the filter exists.** Keep it: row C38, which sets only the flag, fails without it. The check also decides who signals. With it the command returns `false` in a read-only editor, and the key goes on to the browser, where `beforeinput` signals it.
- **`containerPrefixAt` now returns an object.** Its one caller is `prefixForNewLine`. A leftover `prefix + …` string concatenation on its result is a type error, not a silent bug.
- **jsdom has no layout.** The mounted test file stubs `Range.prototype.getClientRects` and `getBoundingClientRect`; without the stubs CodeMirror logs a `TypeError` on every measure pass, though the tests still pass. `editor.dispose()` must run before `DOM.reset()` in `afterEach`.
- **`docs:api` and the new export.** `buildReadOnlyExtension` carries `@internal` and its JSDoc uses no `{@link}`. No public JSDoc may link to it, to `refuseDocumentChange` or to the two annotations.
- **G4 waits for the completion list.** The list is filled asynchronously; `vi.waitFor` polls for the first entry. Do not replace it with a fixed delay.

---

## Critical Files

- [CodeEditor.ts:372](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L372) — `buildReadOnlyExtension` and its JSDoc (372–385); `setRevealHighlight` and `revealHighlightField` (401, 419), the precedent for a module-level CodeMirror value exported `@internal` for the tests; `setValue` (769); the read-only refusals of `replaceRange` (804), `cut` (1438), `paste` (1472) and `format` (1553); `on("readonlyedit")` (1781–1789); `mount()` (2177) with the readOnly compartment (2236), the update listener (2255) and the DOM event hooks (2289–2298); `onEditIntent` (2824); `signalReadOnlyEdit` (2837).
- [languages.ts:44](packages/lib/src/typescript/lib/component/editor/languages.ts#L44) — the `"json"` loader (44–62), the precedent for behaviour added inside a loader; the `SyntaxNode` alias (144); `MARKDOWN_TAB_STOP` (152); `indentInsideMarkdownHtml` (169–199); the `"markdown"` loader (201–231).
- `plans/implemented/markdown-language-enter-inside-html.md` — the command this plan widens: its four functions, its loader statement, its rows C1–C41 and its `## Non-Goals`, two of which this plan closes.
- `plans/implemented/codeeditor-bracket-pair-backspace.md` — `codeEditorKeymap`, which the typing harness types on.
- [code-editor.test.ts:3139](packages/lib/tests/component/code-editor.test.ts#L3139) — the typing harness: `TYPING_EXTENSIONS` (3148), `buildTypingState` (3162), `settle` (3182), `pressKey` (3197), `typeCharacter` (3234), `typeText` (3276), `show` (3300), `typed` (3316); rows M12 (3368) and M37 (3504); `describe('CodeEditor replaceRange', …)` (1902) with its read-only test (1956); `describe('CodeEditor mount() initial height-sync scheduling', …)` (2551), the precedent for calling `mount()` offline.
- [markdown-editor-table-edge-mounted.test.ts](packages/lib/tests/component/markdown-editor-table-edge-mounted.test.ts) — the precedent for a jsdom file that mounts a real editor.
- [CodeEditor.md:64](packages/lib/docs/components/CodeEditor.md#L64) — the Markdown paragraph and the list under it (66–72); `## Dirty state` (203); `## Keyboard` and its table (257–285); the Replace sentence (306); `## Common methods` (335).
- [MarkdownEditor.md:278](packages/lib/docs/components/MarkdownEditor.md#L278) — the source-mode sentence; `## Read-only` (304–312).
- [CodeEditorPanel.ts:143](packages/lib/src/typescript/CodeEditorPanel.ts#L143) — the demo's upper editor, its Read-only and Tab size buttons, and the Language row (201–205).
- `node_modules/@codemirror/lang-markdown/dist/index.js` — `getContext` (122–159, the `FencedCode` return on 125); `insertNewlineContinueMarkupCommand` (204–284, the "dedented" test on 265); `deleteMarkupBackward` (350–390); `markdown()` (406–429, `pasteURLAsLink` added on 413); `pasteURLAsLink` (460–491). The file never reads `readOnly`.
- `node_modules/@codemirror/state/dist/index.js` — `filterTransaction` (2430–2468); the documentation of `EditorState.readOnly` (2904–2915).
- `node_modules/@codemirror/view/dist/index.js` — `DOMChange` ignores DOM changes when read-only (4153); `computeHandlers` runs extension handlers ahead of the built-in ones (4696–4721); the built-in `drop`, `paste` and `cut` checks (5108, 5139, 5204); the keymap runs commands with no read-only test (9161–9184).
- `node_modules/@codemirror/autocomplete/dist/index.js` — the completion list's `mousedown` (525–533) calls `applyCompletion` (1053–1066), which has no read-only check; `acceptCompletion` has one (1098); `startCompletion` has none (1106).
- `node_modules/@codemirror/commands/dist/index.js` — `isBetweenBrackets` (1497) and `newlineAndIndent` (1521–1549), which `insertNewlineKeepPrefix` stands in for.

---

## Non-Goals

- **Opening the completion list in a read-only editor.** `Ctrl-Space` still opens it. Picking an entry is refused, which is what the guarantee needs.
- **Feedback for Replace and Replace all.** They stay inert and silent in a read-only editor, as [CodeEditor.md](packages/lib/docs/components/CodeEditor.md) already says.
- **`EditorView.editable`.** Not set. It would take the caret and keyboard selection away, and it does not stop a transaction either.
- **A `"readonlyedit"` event on `MarkdownEditor`.** Its source editor stays a private child, as `MarkdownEditor.md` says.
- **Markdown's own continuation in ordinary Markdown text.** Three results stay as they are: Enter on a tab-indented text line in a list item starts the new line at column 0 (the text still belongs to the item's paragraph); Enter over a selection in quoted text adds no `>` (row S4); and Enter in front of the first character of an indented code block in a container removes the code's indentation (row F23).[^plain-enter-left]
- **Carets of different kinds at once.** With several carets of which only some are in one of the four places, no caret gets a prefix (row S6).
- **A caret in front of a marker on its line.** The command passes the key on (row F8).
- **HTML, JavaScript and CSS outside every container.** The editor's plain Enter still handles them, and still writes a tab as `tabSize` spaces. Indentation there does not change which block a line belongs to.
- **A Backspace command.** The prefix is ordinary text (rows F40 and F41).
- **The body of `indentInsideMarkdownHtml`**, and rows M34 and M36.
- **A language nested in a fenced code block.** The built-in loader configures none, so a fenced block's text is plain. A consumer who registers a `markdown` language with code languages gets that language's own Enter handling.
- **Fixing `@codemirror/lang-markdown` itself.** The package is a dependency; the filter and the command work around it from the library's side.

---

## Addendum: Routes into a read-only document

Read against the installed packages (`@codemirror/state` 6.7.1, `view` 6.43.8, `commands` 6.10.4, `autocomplete` 6.20.3, `language` 6.12.4, `search` 6.7.1, `lint` 6.9.7, `lang-markdown` 6.5.2, `lang-html` 6.4.12, `lang-javascript` 6.2.5, `lang-css` 6.3.1, `lang-json` 6.0.2, `lang-sql` 6.10.0, `lang-python` 6.2.1), and run two ways.

**What each facet does.** `CodeEditor` sets `EditorState.readOnly` and never `EditorView.editable`.

| Facet | What it changes | What it does not do |
|---|---|---|
| `EditorState.readOnly` | the value of `state.readOnly`, which CodeMirror's input handling and most commands read; `aria-readonly` on the content | stop a transaction: `state.update` and `view.dispatch` apply a document change as before |
| `EditorView.editable` (`false`) | the content element's `contenteditable`, so the browser sends it no text input and it takes no focus by default | stop a transaction, or stop a key binding once the element has focus |

**Every key binding, offline.** For each of the seven built-in languages and for no language, the state was built the way `mount()` builds it, read-only, with the language in its compartment. Every binding's `run` and `shift` command was called on several documents, with a caret and with everything selected, and every input handler was offered ten characters.

| Language | Bindings | Bindings that changed the read-only document |
|---|---|---|
| `javascript`, `json`, `html`, `sql`, `css`, `python`, none | 88 | none |
| `markdown` | 90 | Enter (`insertNewlineContinueMarkup`) and Backspace (`deleteMarkupBackward`) |

About 50 commands per language need a real view and threw offline. They are the caret, selection, fold and tab-focus commands, none of which changes a document.

**Routes that are not key bindings, by reading the sources.**

| Route | Reads `readOnly` | Changes a read-only document |
|---|---|---|
| typed text, IME, the EditContext path | yes (`view` 4153, 7638) | no |
| paste, drop and cut handled by the view | yes (`view` 5108, 5139, 5204) | no |
| `closeBrackets`' input handler | yes (`autocomplete` 1845) | no |
| the tag-closing input handlers of `lang-html` and `lang-javascript` | yes (628, 412) | no |
| undo and redo | yes (`commands` 287) | no |
| Replace and Replace all | yes (`search` 917, 953) | no |
| Enter on an open completion list (`acceptCompletion`) | yes (`autocomplete` 1098) | no |
| a click on an entry of the completion list (`applyCompletion`) | no | **yes**, in every language that has a completion source, which is all seven |
| `lang-markdown`'s `pasteURLAsLink` paste handler | no | **yes**: it runs ahead of the view's own paste handler |
| a lint diagnostic's action | not applicable | no built-in lint source defines one; a consumer's could |
| a consumer's language extension | its own choice | whatever it dispatches |

**The same routes in a mounted editor.** A read-only `CodeEditor` was mounted under jsdom and sent real DOM events, before any change:

| Event | Document after | `"readonlyedit"` |
|---|---|---|
| `keydown` Enter at `- item▮`, `markdown` | `- item`, `- ` | 0 |
| `keydown` Backspace after that marker | `- item`, two spaces | 0 |
| `paste` of a URL over `this` in `see this page`, `markdown` | `see [this](https://example.com) page` | 0 |
| `paste` of plain text, `markdown` | unchanged | 1 |
| `mousedown` on the first completion for `fun`, `javascript` | `function name(params) {`, an indented line, `}` | 0 |
| `keydown` Enter, `javascript` | unchanged; the key is not handled | 0 under jsdom, which fires no `beforeinput` |
| `setValue('new')` | `new` | 0 |

With the filter in place the same events leave the document unchanged and count one `"readonlyedit"` each, and `setValue` still loads (tests G1–G7).

---

## Addendum: What pins each part of the command

Each condition of the command was switched off in turn on a working copy, and the rows were re-run. Every change makes at least one row fail.

| Part removed or changed | Rows that fail |
|---|---|
| place 3, the end of an HTML block | F34, F35, F36, F37 |
| the "text between the prefix and the caret" condition of place 3 | C25 |
| the "no list marker" condition of place 3 | M12, M14, M37 |
| the "in an HTML block" condition of place 3 | F38 |
| the "Markdown before the caret" branch | F39 |
| the container condition for HTML | M27, C34 |
| place 4, the blank line | F32 |
| code blocks handled only inside a container | F17, F18 |
| a code block also recognised from the character after the caret | F23 |
| selections passed on | S1, S2, S3 |
| bracket pairs not split | F24, F25, F26, F27 |
| a blank line not emptied | C24, F29, F30, F31, F32 |
| the binding listed after the Markdown support | F19, F20, F34, F35, F36, F37 |
| the `state.readOnly` check | C38 |

A second check compared Enter at every caret position of 40 small documents, 1,275 positions with the tab documents run at `tabSize` 2, 4 and 8, before and after this plan's command. The result differs at 215 positions:

| Where | Positions | What changes |
|---|---|---|
| a code block in a container | 174 | the new line keeps its `>` and its indentation; 42 of them are on tab lines |
| a code block outside every container, on a tab-indented line | 21 | the tab is copied |
| HTML in a container, on a tab-indented line | 12 | the tab is copied where the block ends at the caret |
| a blank tab-indented line outside every container | 6 | the tab is copied |
| an empty bracket pair inside `<script>` in a blockquote | 2 | the pair is split |

No position in ordinary Markdown text differs, and none outside every container on a line without a tab.

---

## Notes

[^central]: The question was where the guarantee belongs. Four routes edit a read-only document today
    (`## Addendum: Routes into a read-only document`), three of them inside `@codemirror/lang-markdown`
    and one inside `@codemirror/autocomplete`, and a consumer's own language can add more. A check per
    command would mean wrapping each of them, in two packages, and would still say nothing about a
    language the library has never seen. CodeMirror documents `EditorState.readOnly` as cooperative:
    it "controls the value of the `readOnly` getter, which is consulted by commands and extensions that
    implement editing functionality to determine whether they should apply". The mechanism CodeMirror
    offers for an unconditional rule is a filter on transactions. Precedent search: `transactionFilter`,
    `changeFilter` and `Annotation` were grepped under `packages/lib/src`, with no match, so the filter
    is a new pattern here. The shapes around it are existing ones: a module-level CodeMirror value in
    `CodeEditor.ts` that the class installs and the tests import (`revealHighlightField`), an option's
    extension built by a small function and swapped through a compartment (`buildReadOnlyExtension`
    itself), and the update listener as the place state turns into component events. `MarkdownEditor`
    does the same on its other surface: one switch in the engine (`editor.setEditable(false)`) plus a
    check in each of its own commands. Rejected: `EditorState.changeFilter`, which removes the text
    change but keeps the transaction's selection, so a refused key could still move the caret, and
    which cannot add the mark; a `dispatchTransactions` override on the view, which cannot be tested on
    a state; and wrapping the Markdown commands in the loader, which covers two of the four routes and
    no language a consumer registers.

[^truth]: Established three ways: by reading the sources, by calling every installed binding on a
    read-only state built the way `mount()` builds it, and by sending real DOM events to a read-only
    `CodeEditor` mounted under jsdom. The addendum has the tables. The earlier plan had seen the two
    Markdown commands change a read-only state offline and left open whether a live editor delivers the
    key. It does: CodeMirror's keymap handling runs a binding's command with no read-only test, and the
    content stays focusable because `EditorView.editable` is not set.

[^facets]: The JSDoc of `buildReadOnlyExtension` says today that `EditorState.readOnly` "blocks every
    edit (including programmatic ones)". It does not: `setValue` on a read-only editor works for
    exactly that reason. The JSDoc is rewritten with the function. `EditorView.editable.of(false)` was
    weighed again and declined again. It removes the caret and keyboard selection, which the editor's
    read-only mode is documented to keep, and it does not stop a transaction either.

[^replace-not-strip]: A transaction filter can return a transaction specification that replaces the
    transaction. Returning only the mark drops the change, the selection, the effects and the scroll
    request together. Keeping the selection would mean mapping it back through the dropped change,
    which need not give the position the caret had, so a key that did nothing could still move the
    caret. Dropping the effects costs nothing the editor needs: none of its own transactions pairs an
    effect with a document change except `format()`, which is refused before it dispatches. One
    visible consequence, seen in a mounted probe: after a refused completion click the completion
    list stays open, and Escape closes it. A transaction dispatched with `filter: false` is never
    shown to a filter. The only one among the installed packages is the history's undo and redo
    transaction, and those commands decline in a read-only state before they build it.

[^host-load]: The alternative was to dispatch `setValue`'s transaction with `filter: false`, which is
    CodeMirror's switch for skipping filters. It skips every filter, also `indentOnInput`'s and any a
    consumer's language installs, and it would do so in a writable editor too. An annotation that only
    this filter reads leaves every other filter in force. The annotation is module-private: no other
    code can claim the exemption.

[^listener]: The filter itself must not call the editor. CodeMirror runs filters whenever a
    transaction is built, also for one that is never dispatched, so a call made from the filter could
    signal an edit nobody attempted. So the filter leaves a mark on the transaction, and the view's
    update listener, which only sees dispatched transactions, reads it. An annotation is CodeMirror's way to attach such a fact to a
    transaction. The method is factored out of the listener the way `applyFormatted` and
    `reindentFallback` are factored out of `format()`: so a test can call it on an `as any` instance.

[^keep-checks]: The four methods do more than refuse: they skip the clipboard read, leave the cached
    value alone before the editor mounts, and return their documented values. The command's own check
    decides who signals. With it, the command returns `false` in a read-only editor, the key reaches
    the browser, and the existing `beforeinput` hook signals, as for Enter in any other language.

[^two-levels]: A state-level test proves the filter, and that the state `mount()` builds carries it. It
    cannot prove that a key press reaches a command, that a paste handler of a language runs ahead of
    the view's own, or that a click on the completion list dispatches at all; those are properties of a
    mounted view. Run while planning, the mounted file fails G1–G4 against the present code with the
    documents shown in the addendum, and passes all seven with the filter. A real browser is still
    needed for `beforeinput` and the flash (V5–V8).

[^rename]: The name `continueContainersInsideHtml` says HTML, and the command now also handles code
    blocks and blank lines. `insertNewlineKeepPrefix` follows CodeMirror's own names for Enter commands
    (`insertNewlineAndIndent`, `insertNewlineKeepIndent`, `insertNewlineContinueMarkup`). Its helpers
    change with it: `isCaretInsideContainedHtml` becomes `caretBlocksAt` plus `prefixForNewLine`,
    `isBetweenAdjacentTags` becomes `isBetweenPair`, and `containerPrefixAt` keeps its name and now
    also reports whether the line has a list marker.

[^four-places]: The earlier plan weighed a looser rule, "act on whatever Markdown's own command passed
    on, inside a container", and declined it, because it rests on every undocumented reason that
    command passes a key on. This plan keeps positive conditions instead, each read from the syntax
    tree, and adds the three places where a line break must copy the prefix to stay in its block.
    Reading `insertNewlineContinueMarkup` gives these reasons for passing a key on: a selection; a
    language other than Markdown beside the caret; a `FencedCode` ancestor (`getContext` returns an
    empty context); no container at all; a caret in front of or inside a marker; a list marker its
    regular expressions do not match, such as one followed by a tab; and a short unindented line in a
    list item. Places 1 and 2 answer the second and third. Selections are answered inside the four
    places. The rest are lines where the editor's plain Enter is right, or carets this plan leaves
    alone (`## Non-Goals`). An indented code block is not among the reasons: there Markdown's own
    command handles the key and writes only the container's prefix, which is why the binding order
    changes.

[^first]: In an indented code block inside a container, and at the end of an HTML block, Markdown's own
    command returns `true`, so a binding behind it is never asked. Its result for the first is the
    container's prefix without the code's four columns. For the second, on a tab-indented line, it is
    nothing: the command decides whether a continuation line is "dedented" by comparing the number of
    characters at the line's start with the marker's width, and one tab is one character
    (`lang-markdown` index.js:265). Listing the new binding first changes no other row, because the two
    commands want the same caret only in these two places. Checked by listing it second: rows F19, F20
    and F34–F37 fail and nothing else does.

[^html-end]: Without the "no list marker" condition the command would take `- <div>▮` and write
    indentation, where row M12 pins a new list marker, decided by `markdown-source-mode-html-typing`.
    Without the "text before the caret" condition it would take the empty quoted line under
    `> <div>`, because the editor's parser keeps that HTML block open across an empty `>` line, and a
    blockquote could then never be left with Enter (row C25). Place 3 asks for an HTML block and not
    for any HTML: after an inline tag at the end of a paragraph line Markdown's own command is right
    (row F38). For a space-indented line the command writes the same text Markdown's own command
    wrote, except that indentation deeper than the item's content is now copied too (row F37).

[^md-own-tabs]: The task's example, `- a`, `  - b`, `→<div>▮`, was run at `tabSize` 2, 4 and 8. With
    the block continuing below the caret the earlier plan's command copies the tab; before it the
    result was two, four and eight spaces. With the block ending at the caret, as the example is
    written, Markdown's own command handles the key and the new line starts at column 0 at every
    `tabSize`, for the reason in the note on binding order. Text typed there is outside both items. A
    blank last line of the document is a third case: the syntax tree puts it outside the list it
    visually continues, Markdown's own command passes it on, and the editor's plain Enter writes
    `tabSize` spaces.

[^selections]: The earlier plan passed a selection on "as in plain quoted text". In plain quoted text
    the line that loses its `>` is a lazy continuation line and stays in the quote. In a code block or
    an HTML block there is no lazy continuation: the line without the `>` ends the quote and breaks the
    fence, which is defect 1 with a selection in place of a caret. Its row C36 keeps its result, now
    through this command.

[^pairs]: The editor's plain Enter splits an empty bracket pair in every language, and in a fenced
    block in a list item it does so today (row F25). A command that took over code blocks without
    splitting would have removed that. The earlier plan's command did not split brackets inside HTML in
    a container, on the ground that Markdown's own command does not split them in quoted text either.
    One rule is simpler than two: wherever this command acts, it splits what plain Enter splits. No
    existing row changes, and `> f() {▮}` inside `<script>` in a blockquote now behaves as it does
    outside one. The test for brackets is the textual one plain Enter starts with. The test for tags
    is the earlier plan's.

[^emptied]: The editor's plain Enter empties a line that holds only whitespace, so typing code with
    blank lines in between leaves no trailing spaces behind. Once this command handles code blocks it
    has to do the same, or every blank line in an indented part of a fenced block would keep its
    indentation (rows F29 and F30 pin today's result). A line with a `>` is not whitespace only, so it
    keeps its marker and the space after it, as rows C21 and C23 expect.

[^rows-changed]: C35 pinned the fenced-code limit as a known limit; removing that limit is this plan's
    purpose. C24's middle line kept its two spaces only because the earlier command never touches text
    in front of the caret. What the row is named for, that the caret's line keeps its indentation,
    still holds, and the new text is what Enter gave there before either plan. Keeping C24 as it was
    would have meant emptying blank lines in code but not in HTML.

[^indent-rule]: With this plan `indentInsideMarkdownHtml` is asked less often: Enter over a selection
    in a container no longer reaches it. It still decides row M37, `-→<div>▮` at the end of the
    document. That line has a list marker, so place 3 passes it on; Markdown's own command does not
    recognise a marker followed by a tab and passes it on too; the editor's plain Enter then asks the
    rule.

[^demo]: The demo's "MD Editor" tab has no read-only switch and no tab size control, and the
    CodeEditor tab, which has both, offers no Markdown language. Without the button, defect 2 and
    defect 3 could not be seen in a browser at all.

[^order-of-steps]: Exporting first gives a clean red phase. With the tests already importing
    `buildReadOnlyExtension`, step 2 fails for exactly the tests the two fixes turn green. Writing the
    tests before the export exists would fail on a missing import, which shows nothing.

[^m34]: Rows M34 and M36 were added to the test file after `markdown-language-enter-inside-html` was
    drafted, so that plan does not name them. Its command copies the tab on their marker lines, which
    changes their expected text. Whatever that plan's implementation left for the two rows is correct
    for this plan too: run on a working copy, both give the same text before and after this plan's
    command.

[^plain-enter-left]: In the first and the third, Markdown's own command handles the key, in Markdown
    text. In the second it passes a selection on to the editor's plain Enter, as it does everywhere.
    Changing any of them means replacing parts of that command, which
    `markdown-source-mode-html-typing` declined and this plan does too. The first is harmless as long
    as text follows: a paragraph continues on an unindented line. The second is harmless for the same
    reason. The third is rare: the caret has to sit between a code line's indentation and its first
    character, on the block's first line.
