---
depends-on: [markdown-tab-column-parity, markdown-source-mode-tab-highlighting]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/languages.ts
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/tests/component/markdown-roundtrip/markdown-roundtrip.test.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Source Mode Enter and Backspace at Tab Stops — Implementation Plan

## Overview

In `MarkdownEditor`'s source mode, and in any `CodeEditor` with the built-in `"markdown"` language, Enter in a list item or a blockquote and Backspace after a marker are `@codemirror/lang-markdown` 6.5.2's commands `insertNewlineContinueMarkup` and `deleteMarkupBackward`. Both read a line's markers with patterns that accept a space but not a tab, and measure them in characters, not columns. `markdown-tab-column-parity` makes the viewer read every tab in a line's *container prefix* (its leading whitespace, `>` markers, list markers and task checkbox) as the spaces that reach the next multiple of four columns; that plan calls this the one rule, and this plan calls it the *tab rule*. On a line with such a tab, the two commands continue a list or a quote at the wrong column or not at all, so the new line reads as another block in the viewer.

`→` is one tab, `·` one space, `⏎` a line end and `▮` the caret throughout. Some of the shapes, all measured with `markdown-source-mode-tab-highlighting`'s code applied:[^measured]

| Keys | Today | After this plan |
|---|---|---|
| Enter after `-→a▮` | `-→a⏎▮`: no new item | `-→a⏎-···▮` |
| Enter after `1.→a▮` | `1.→a⏎2.▮`: text typed after `2.` is no item | `1.→a⏎2.··▮` |
| Enter after `>→-→a▮` | `>→-→a⏎>▮`: the new line leaves the list | `>→-→a⏎>···-···▮` |
| Enter after `-→>·a▮` | `-→>·a⏎>·▮`: the quote leaves the item | `-→>·a⏎····>·▮` |
| Enter after `>·-·a⏎>⏎>→b▮` (row TAB31) | the new line is at the margin, outside the quote | `>···▮` |
| Enter after `>·-·a⏎>→-·▮` (row TAB32) | nothing happens | the empty item moves to the outer list: `>·-·a⏎>·-·▮` |
| Backspace after `-→▮` | `-▮`: the tab is deleted, the marker stays | `▮` |

This plan wraps both commands so they run on a copy of the document in which those tabs are spaces, and writes what they do back onto the document. Enter and Backspace then do on a tab line what they do on the same line written with spaces. The new code is a module `component/editor/markdownTabStopCommands.ts`, bound from the `"markdown"` loader in [languages.ts:469](packages/lib/src/typescript/lib/component/editor/languages.ts#L469). The tab rule's helpers move out of `markdownExtensions.ts` into a new dependency-free module, `component/display/markdownContainerPrefix.ts`, so the editor reads the prefix with the viewer's own function. `CodeEditor.ts` is not touched.

---

## Architecture Decisions

### The stock commands run on a spaced copy of the document

`atMarkdownTabStops(command)` wraps one of the two commands. It writes each tab in the container prefix of every line the command reads as its spaces (the *spaced copy*), runs the command there, and applies the resulting change to the real document. No pattern of `@codemirror/lang-markdown` is copied into the library.[^approach]

This mirrors how `markdown-tab-column-parity` fixes the viewer: `listWithTabStops` and `blockquoteWithTabStops` in `markdownExtensions.ts` run `marked`'s own tokenizer on a copy whose prefix tabs are spaces, then set the token's `raw` back to the source. It also mirrors `readQuoteContinuationTabs` in `markdownTabStops.ts`, which hands every line without a tab to the stock code unchanged.[^precedent]

The copy reads as the same blocks as the document: the tree counts columns (that is what `markdown-source-mode-tab-highlighting` made it do), and writing a tab as the spaces to its stop keeps every column.

### The library binds Markdown's Enter and Backspace

The loader calls `markdown({ …, addKeymap: false })` and binds the two wrapped commands itself, in the `Prec.high` keymap that already holds `insertNewlineKeepPrefix` ([languages.ts:502](packages/lib/src/typescript/lib/component/editor/languages.ts#L502)). The order is `insertNewlineKeepPrefix`, then the wrapped Enter, then the wrapped Backspace. That is where `markdown()` puts its own keymap ([index.js:423](node_modules/@codemirror/lang-markdown/dist/index.js), `Prec.high(keymap.of(markdownKeymap))`), so no other binding moves.[^keymap]

The library already configures the grammar packages through their options: `html({ autoCloseTags: false })` and `htmlLanguage.configure({ dialect, props })` in the same loader ([languages.ts:488](packages/lib/src/typescript/lib/component/editor/languages.ts#L488)).

### Three cases leave the command on the document itself

`atMarkdownTabStops` calls the command on the real state, exactly as `markdown()`'s keymap did, when:

- none of the lines the command reads holds a tab in its container prefix (every tab-free document: nothing changes for it);
- the editor is read-only (the command then behaves as before, and the editor's read-only guard refuses the edit);
- the spaced copy's syntax tree is not ready within 50 ms.

When the command runs on the copy and declines, `atMarkdownTabStops` returns `false`, and the key goes on to the editor's plain Enter or Backspace, as it does after the command declines on a document written with spaces.[^decline]

### Only the lines the command reads are spaced

The copy changes these lines and no others, for every caret:

- the caret's line and the line above it;
- the first line of each `Blockquote` and `ListItem` that holds the caret;
- the first line of each `Blockquote` and `ListItem` that holds the nearest line above the caret with more than whitespace and `>` markers on it.

These are the lines the two commands read markers from.[^lines] A tab on any other line keeps its column, so the tree around the caret is the same.

### A tab the command does not touch stays a tab

After the command runs on the copy, every run of spaces it did not change is written back as the tab it was. A run the change replaces, deletes from or inserts into is written as its spaces, so the change applies to it as made. New markers and indentation are written as the command writes them on spaces.[^style]

| Keys | Result | Why |
|---|---|---|
| Enter after `1.→a▮` above `2.→b` | `1.→a⏎2.··▮⏎3.→b` | the new line is the command's; the tabs after `1.` and `3.` are not touched |
| Backspace after `>→-·▮` (row TAB29) | `>·▮` | the command deletes from column 2, inside the tab; the tab becomes three spaces and two of them go |
| Backspace after `>·-·a⏎>→-·▮` (row TAB30) | `>·-·a⏎>→▮` | the command deletes from column 4, where the tab ends: the tab stays |

### The tab rule's helpers move to a module that imports nothing

`markdown-tab-column-parity` puts `containerPrefixEnd`, `withPrefixTabsAsSpaces` and their constants in `markdownExtensions.ts`, which imports `marked`. `languages.ts` loads with `CodeEditor`, which must not pull in `marked`. The helpers therefore move to `component/display/markdownContainerPrefix.ts`, which imports nothing; `markdownExtensions.ts`, the serializer and the round-trip tests import them from there.[^shared]

The module gains `prefixTabEdits(line)`, the tab rule as a list of replacements, which the editor needs to keep the tabs a change does not touch. `withPrefixTabsAsSpaces` is rewritten to apply those replacements, so the rule is written once. `languages.ts` drops its own copy of `MARKDOWN_TAB_STOP` and imports the module's.

### Four existing rows change

| Row | File | Before | After |
|---|---|---|---|
| M37 (three tab sizes) | `code-editor.test.ts` | Enter after `-→<div>▮` gives `-→<div>⏎····▮` | `-→<div>⏎-···▮`: the list continues, as after `-·<div>`[^m37] |
| TAB29 | `code-editor.test.ts` (from `markdown-source-mode-tab-highlighting`) | `>→▮` | `>·▮` |
| TAB31 | the same | pinned: `>·-·a⏎>⏎>→b⏎▮` | fixed: `>·-·a⏎>⏎>→b⏎>···▮` |
| TAB32 | the same | pinned: unchanged | fixed: `>·-·a⏎>·-·▮` |

---

## Public API

No public API changes. Both new modules are left out of every barrel, and their exports carry `@internal`.

---

## Internal Structure

### `component/display/markdownContainerPrefix.ts`, in full

`MARKDOWN_TAB_STOP`, `CONTAINER_PREFIX_STEP`, `containerPrefixEnd`, `TABBED_LINE_END` and `hasTabInContainerPrefix` are `markdown-tab-column-parity`'s text, moved; `MARKDOWN_TAB_STOP` is now exported. `PrefixTabEdit` and `prefixTabEdits` are new, and `withPrefixTabsAsSpaces` has a new body that gives the same result.[^equivalent]

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// How Markdown reads a tab in a line's container prefix: as the spaces that
// reach the next multiple of four columns (CommonMark §2.2). The viewer's
// dialect (markdownExtensions.ts), the editor's serializer, and the built-in
// "markdown" language's Enter and Backspace (editor/markdownTabStopCommands.ts)
// read the prefix with these functions. The module imports nothing, so the
// code editor loads it without the viewer's `marked`.

/**
 * The width of Markdown's tab stops, in columns: a tab advances to the next
 * multiple of four (CommonMark §2.2), whatever width an editor shows it with,
 * so the columns Markdown reads its indentation by are counted with this, not
 * with an editor's `tabSize`.
 *
 * @internal Shared with the viewer's dialect and `editor/languages.ts`, not part of the public API surface.
 */
export const MARKDOWN_TAB_STOP = 4;

/**
 * One step of a line's container prefix: a run of spaces and tabs, a quote
 * marker, a list marker that whitespace or the line's end follows, or a task
 * checkbox that whitespace follows. Sticky, so each step is matched where the
 * one before it ended.
 */
const CONTAINER_PREFIX_STEP = /[ \t]+|>|(?:[*+-]|\d{1,9}[.)])(?=[ \t]|$)|\[[ xX]\](?=[ \t])/y;

/**
 * Finds where a line's container prefix ends: its leading run of whitespace,
 * `>` markers and list markers, and a task checkbox when one follows a list
 * marker. Whitespace that ends the line is not part of it. `> - [ ] x` ends
 * before `x`; `- a - b` ends before `a`; `>`, a tab, `-`, a tab ends before
 * the last tab.
 *
 * @param line - One line, without its line end.
 * @returns The index of the first character past the prefix.
 */
function containerPrefixEnd(line: string): number {
    let end = 0;
    let afterListMarker = false;

    for (;;) {
        CONTAINER_PREFIX_STEP.lastIndex = end;

        const step = CONTAINER_PREFIX_STEP.exec(line)?.[0];

        if (step === undefined) {
            return end;
        }

        const first = step.charAt(0);
        const isWhitespace = first === " " || first === "\t";
        const isCheckbox = first === "[";
        const endsLine = end + step.length === line.length;

        if (isCheckbox && !afterListMarker) {
            return end;
        }

        if (isWhitespace && endsLine && end > 0) {
            return end;
        }

        if (!isWhitespace) {
            afterListMarker = first !== ">" && !isCheckbox;
        }

        end += step.length;
    }
}

/** Whitespace that holds a tab and runs to the end of a line. */
const TABBED_LINE_END = /^[ \t]*\t[ \t]*$/;

/**
 * One replacement in a line, by character index.
 *
 * @internal Returned by prefixTabEdits, not part of the public API surface.
 */
export type PrefixTabEdit = {
    /** Where the replaced text starts. */
    readonly from: number;
    /** Where the replaced text ends. */
    readonly to: number;
    /** The spaces that replace it. */
    readonly insert: string;
};

/**
 * Lists the replacements that write a line's container prefix without tabs:
 * each tab of the prefix becomes the spaces that reach its tab stop, counted
 * from the line's start, and whitespace that holds a tab and ends the line
 * after a marker becomes one space; its width means nothing there, and two
 * or more spaces would end a paragraph line in a hard line break. In `>`,
 * two tabs and `a`, the first tab becomes three spaces and the second four.
 *
 * @internal Shared with the editor's Markdown language, not part of the public API surface.
 *
 * @param line - One line, without its line end.
 * @returns The replacements, in line order and not overlapping; empty when the prefix holds no tab.
 */
export function prefixTabEdits(line: string): PrefixTabEdit[] {
    const end = containerPrefixEnd(line);
    const edits: PrefixTabEdit[] = [];
    let column = 0;

    for (let index = 0; index < end; index++) {
        const isTab = line[index] === "\t";
        const width = isTab ? MARKDOWN_TAB_STOP - (column % MARKDOWN_TAB_STOP) : 1;

        if (isTab) {
            edits.push({ from: index, to: index + 1, insert: " ".repeat(width) });
        }

        column += width;
    }

    const endsInTab = end > 0 && TABBED_LINE_END.test(line.slice(end));

    if (endsInTab) {
        edits.push({ from: end, to: line.length, insert: " " });
    }

    return edits;
}

/**
 * Writes every tab of a line's container prefix as the spaces that reach its
 * tab stop, and a tabbed line end after a marker as one space (see
 * prefixTabEdits). The line then reads the same with one character per
 * column in its prefix, which is what `marked` counts.
 *
 * @internal Shared with the viewer's dialect and the round-trip tests, not part of the public API surface.
 *
 * @param line - One line, without its line end.
 * @returns The line with a tab-free container prefix.
 */
export function withPrefixTabsAsSpaces(line: string): string {
    let spaced = "";
    let copied = 0;

    for (const edit of prefixTabEdits(line)) {
        spaced += line.slice(copied, edit.from) + edit.insert;
        copied = edit.to;
    }

    return spaced + line.slice(copied);
}

/**
 * Tells whether a line holds a tab in its container prefix: a tab whose
 * width depends on the column the line starts at.
 *
 * @internal Shared with the editor's serializer, not part of the public API surface.
 *
 * @param line - One line, without its line end.
 * @returns `true` when the prefix holds a tab.
 */
export function hasTabInContainerPrefix(line: string): boolean {
    return line.slice(0, containerPrefixEnd(line)).includes("\t");
}
```

### `component/editor/markdownTabStopCommands.ts`, in full

This text ran as written through the rows of `## Expected Behaviour`, the code-editor, Markdown and display suites, and the sweeps of `## Addendum: Measurements`.

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Makes `@codemirror/lang-markdown`'s Enter and Backspace commands count a
// tab in a line's container prefix as Markdown does: to the next multiple of
// four columns (CommonMark §2.2), as the viewer reads it. `languages.ts`
// binds the two commands through atMarkdownTabStops. The external packages
// imported here are ones `CodeEditor` itself imports, and
// `markdownContainerPrefix.ts` imports nothing, so loading this module loads
// no grammar package and no `marked`.

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { TreeIndentContext } from "@codemirror/language";
import { ChangeSet, Transaction } from "@codemirror/state";
import type { EditorState, StateCommand, TransactionSpec } from "@codemirror/state";
import { prefixTabEdits } from "~/component/display/markdownContainerPrefix.js";

/**
 * A syntax tree node. Named from an indentation query's own type because
 * `@lezer/common`, which declares it, is not a direct dependency.
 */
type SyntaxNode = TreeIndentContext["node"];

/**
 * A run of a line's container prefix that the spaced copy writes as spaces:
 * one tab, or whitespace that holds a tab and ends the line after a marker
 * (see prefixTabEdits).
 */
type SpacedRun = {
    /** Where the run starts in the document. */
    from: number;
    /** Where the run ends in the document. */
    to: number;
    /** The run as written. */
    text: string;
    /** The spaces that replace it in the spaced copy. */
    spaces: string;
    /** Where those spaces start in the spaced copy. */
    spacedFrom: number;
};

/** The blocks whose first lines `@codemirror/lang-markdown`'s commands read their markers from. */
const CONTAINER_NODES: ReadonlySet<string> = new Set(["Blockquote", "ListItem"]);

/** A line that holds nothing but spaces, tabs and `>` markers. */
const QUOTE_MARKERS_ONLY = /^[\s>]*$/;

/**
 * How long, in milliseconds, atMarkdownTabStops lets the parser work on the
 * spaced copy. The copy differs from the document on a few lines, so the
 * parser reuses the rest of the tree; this is `ensureSyntaxTree`'s own
 * default timeout, kept because a key press waits for it.
 */
const SPACED_PARSE_BUDGET_MS = 50;

/**
 * Adds the number of the first line of every blockquote and list item that
 * holds a position to a set.
 *
 * @param state - The editor state.
 * @param pos - The position; the node in front of it is where the walk starts.
 * @param lineNumbers - The set to add to.
 */
function addContainerFirstLines(state: EditorState, pos: number, lineNumbers: Set<number>): void {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
        const isContainer = CONTAINER_NODES.has(node.name);

        if (isContainer) {
            lineNumbers.add(state.doc.lineAt(node.from).number);
        }
    }
}

/**
 * Finds the nearest line above a line that holds more than spaces, tabs and
 * `>` markers.
 *
 * @param state - The editor state.
 * @param lineNumber - The line to look above.
 * @returns That line's number, or `0` when there is none.
 */
function contentLineAbove(state: EditorState, lineNumber: number): number {
    for (let number = lineNumber - 1; number > 0; number--) {
        const markersOnly = QUOTE_MARKERS_ONLY.test(state.doc.line(number).text);

        if (!markersOnly) {
            return number;
        }
    }

    return 0;
}

/**
 * Lists the lines `@codemirror/lang-markdown`'s Enter and Backspace read
 * the markers of, for every caret: the caret's line and the line above it,
 * and the first line of each blockquote and list item that holds the caret.
 * Backspace on a line of bare `>` markers also reads the list item that
 * ends above it, so the items that hold the nearest line with content above
 * the caret count too.
 *
 * @param state - The editor state.
 * @returns The line numbers, in document order.
 */
function linesReadByMarkdownCommands(state: EditorState): number[] {
    const lineNumbers = new Set<number>();

    for (const range of state.selection.ranges) {
        const line = state.doc.lineAt(range.head);
        const above = contentLineAbove(state, line.number);

        lineNumbers.add(line.number);
        addContainerFirstLines(state, range.head, lineNumbers);

        if (line.number > 1) {
            lineNumbers.add(line.number - 1);
        }

        if (above > 0) {
            addContainerFirstLines(state, state.doc.line(above).to, lineNumbers);
        }
    }

    return [...lineNumbers].sort((a, b) => a - b);
}

/**
 * Lists the runs to write as spaces on the given lines: each tab of a
 * line's container prefix, and whitespace that holds a tab and ends the line
 * after a marker.
 *
 * @param state - The editor state.
 * @param lineNumbers - The lines, in document order.
 * @returns The runs, in document order; empty when none of the lines holds such a tab.
 */
function prefixTabRuns(state: EditorState, lineNumbers: readonly number[]): SpacedRun[] {
    const runs: SpacedRun[] = [];
    let shift = 0;

    for (const number of lineNumbers) {
        const line = state.doc.line(number);

        for (const edit of prefixTabEdits(line.text)) {
            const from = line.from + edit.from;

            runs.push({ from, to: line.from + edit.to, text: line.text.slice(edit.from, edit.to), spaces: edit.insert, spacedFrom: from + shift });
            shift += edit.insert.length - (edit.to - edit.from);
        }
    }

    return runs;
}

/**
 * Builds the spaced copy of a state: the same state with the runs written as
 * spaces, the selection carried over, and its syntax tree parsed.
 *
 * @param state - The editor state.
 * @param runs - The runs to write as spaces.
 * @returns The copy, or `null` when its tree was not ready within the budget.
 */
function spacedCopy(state: EditorState, runs: readonly SpacedRun[]): EditorState | null {
    const spacing = ChangeSet.of(runs.map((run) => ({ from: run.from, to: run.to, insert: run.spaces })), state.doc.length);
    const copy = state.update({ changes: spacing, selection: state.selection.map(spacing) }).state;
    // The commands read the blocks that hold each caret, which end on or
    // after its line: the tree must reach the end of the last caret's line.
    const lastCaretLine = copy.doc.lineAt(copy.selection.ranges[copy.selection.ranges.length - 1]!.head);
    const tree = ensureSyntaxTree(copy, lastCaretLine.to, SPACED_PARSE_BUDGET_MS);

    // A state keeps the tree it was made with: what ensureSyntaxTree parsed
    // reaches syntaxTree() in the next state made from it.
    return tree === null ? null : copy.update({}).state;
}

/**
 * Runs a command on a state that no view shows, and keeps the transaction it
 * dispatches.
 *
 * @param command - The command.
 * @param state - The state.
 * @returns The transaction, or `null` when the command did not act.
 */
function transactionOf(command: StateCommand, state: EditorState): Transaction | null {
    const dispatched: Transaction[] = [];
    const handled = command({ state, dispatch: (transaction) => { dispatched.push(transaction); } });

    return handled ? (dispatched[0] ?? null) : null;
}

/**
 * Tells whether a change alters a run's spaces in the spaced copy, rather
 * than only inserting at one of its ends.
 *
 * @param changes - The change, in the spaced copy's positions.
 * @param run - The run.
 * @returns `true` when the change replaces or deletes some of the run's spaces, or inserts between them.
 */
function changesRun(changes: ChangeSet, run: SpacedRun): boolean {
    const runEnd = run.spacedFrom + run.spaces.length;
    let changed = false;

    changes.iterChangedRanges((fromA, toA) => {
        const overlaps = fromA < runEnd && toA > run.spacedFrom;
        const insertsInside = fromA === toA && fromA > run.spacedFrom && fromA < runEnd;

        changed = changed || overlaps || insertsInside;
    });

    return changed;
}

/**
 * Writes a transaction made on the spaced copy onto the document. A run the
 * transaction does not alter keeps its tab; a run it alters is written as
 * its spaces first, so the transaction's change applies to it as made.
 *
 * @param state - The editor state the copy was made from.
 * @param runs - The runs the copy wrote as spaces.
 * @param done - The transaction made on the copy.
 * @returns The same edit, for the editor state.
 */
function writtenBack(state: EditorState, runs: readonly SpacedRun[], done: Transaction): TransactionSpec {
    const kept = runs.filter((run) => !changesRun(done.changes, run));
    const rewritten = runs.filter((run) => !kept.includes(run));
    // From the copy back to the document with only the rewritten runs as spaces.
    const restore = ChangeSet.of(kept.map((run) => ({ from: run.spacedFrom, to: run.spacedFrom + run.spaces.length, insert: run.text })), done.startState.doc.length);
    const respace = ChangeSet.of(rewritten.map((run) => ({ from: run.from, to: run.to, insert: run.spaces })), state.doc.length);

    return {
        changes:        respace.compose(done.changes.map(restore)),
        selection:      done.newSelection.map(restore.map(done.changes)),
        scrollIntoView: true,
        userEvent:      done.annotation(Transaction.userEvent),
    };
}

/**
 * Makes one of `@codemirror/lang-markdown`'s commands read a tab in a line's
 * container prefix as Markdown does. The commands match markers with
 * patterns that take spaces only and measure them in characters, so after
 * `-`, a tab and `a` Enter adds no marker, and after `> - a`, `>`, then `>`,
 * a tab and `b` it starts the new line outside the quote.
 *
 * The command runs on a spaced copy of the state: the lines it reads (see
 * linesReadByMarkdownCommands) have the tabs of their container prefixes
 * written as the spaces that reach their stops. The copy reads as the same
 * blocks, since the language counts columns. What the command does there is
 * written onto the document; a tab it leaves alone stays a tab. So Enter and
 * Backspace do what they do on the same document written with spaces.
 *
 * Where those lines hold no such tab, or the copy's tree is not ready in
 * time, the command runs on the document itself.
 *
 * @internal Used by `languages.ts` only, not part of the public API surface.
 *
 * @param command - `insertNewlineContinueMarkup` or `deleteMarkupBackward`.
 * @returns The command, for an Enter or Backspace key binding.
 */
export function atMarkdownTabStops(command: StateCommand): StateCommand {
    return (target) => {
        const { state, dispatch } = target;
        const runs = state.readOnly ? [] : prefixTabRuns(state, linesReadByMarkdownCommands(state));
        const copy = runs.length === 0 ? null : spacedCopy(state, runs);

        if (copy === null) {
            return command(target);
        }

        const done = transactionOf(command, copy);

        if (done === null) {
            return false;
        }

        dispatch(state.update(writtenBack(state, runs, done)));

        return true;
    };
}
```

### The change in `languages.ts`

The text below is as `markdown-source-mode-tab-highlighting` leaves the file. Find each edit by the quoted text.

1. Add, in the import block, after `import type { SqlLanguage } from "sql-formatter";`:

   ```ts
   import { MARKDOWN_TAB_STOP } from "~/component/display/markdownContainerPrefix.js";
   ```

   and after `import { formatWithSql } from "~/component/editor/formatters/sql.js";`:

   ```ts
   import { atMarkdownTabStops } from "~/component/editor/markdownTabStopCommands.js";
   ```

2. Delete the local `const MARKDOWN_TAB_STOP = 4;` and the doc comment above it, whose first line of text is ` * The width of Markdown's tab stops, in columns: a tab advances to the next`. `indentInsideMarkdownHtml` keeps using the name, now imported.

3. In the `"markdown"` loader, the destructuring `const [{ markdown }, { html, htmlLanguage }, …` becomes `const [{ markdown, insertNewlineContinueMarkup, deleteMarkupBackward }, { html, htmlLanguage }, …`; the rest of that statement is unchanged.

4. `const support = markdown({ htmlTagLanguage: literalHtml, extensions: MARKDOWN_TAB_STOPS });` gains `addKeymap: false`:

   ```ts
           const support = markdown({ htmlTagLanguage: literalHtml, extensions: MARKDOWN_TAB_STOPS, addKeymap: false });
   ```

5. The comment and `return` at the end of the loader, from `// Listed ahead of the support, so this Enter binding is tried before` to `return [Prec.high(keymap.of([{ key: "Enter", run: insertNewlineKeepPrefix(support.language) }])), support];`, become:

   ```ts
           // Markdown's own Enter and Backspace, bound here in place of
           // markdown()'s keymap (addKeymap: false) so they count a tab as
           // Markdown does (see atMarkdownTabStops). insertNewlineKeepPrefix is
           // tried first: in an indented code block and at the end of an HTML
           // block Markdown's own command takes the key and drops the line's
           // indentation. Prec.high puts all three ahead of the editor's
           // bindings, where markdown() puts its own keymap.
           const markdownKeys = keymap.of([
               { key: "Enter", run: insertNewlineKeepPrefix(support.language) },
               { key: "Enter", run: atMarkdownTabStops(insertNewlineContinueMarkup) },
               { key: "Backspace", run: atMarkdownTabStops(deleteMarkupBackward) },
           ]);

           return [Prec.high(markdownKeys), support];
   ```

### The moved helpers' other users

- **`markdownExtensions.ts`**: delete the block that `markdown-tab-column-parity` added from the doc comment that starts `The width of Markdown's tab stops` through the closing `}` of `hasTabInContainerPrefix`: the declarations `MARKDOWN_TAB_STOP`, `CONTAINER_PREFIX_STEP`, `containerPrefixEnd`, `TABBED_LINE_END`, `withPrefixTabsAsSpaces` and `hasTabInContainerPrefix`. `mapLines` and everything after it stay. Add `import { MARKDOWN_TAB_STOP, withPrefixTabsAsSpaces } from "~/component/display/markdownContainerPrefix.js";` after the `markdownAttributes.js` import.
- **`markdownSerializer.ts`**: take `hasTabInContainerPrefix` out of the names imported from `~/component/display/markdownExtensions.js`, and add `import { hasTabInContainerPrefix } from "~/component/display/markdownContainerPrefix.js";` after the `markdownAttributes.js` import.
- **`tests/component/markdown-roundtrip/markdown-roundtrip.test.ts`**: import `withPrefixTabsAsSpaces` from `~/component/display/markdownContainerPrefix` instead of `~/component/display/markdownExtensions`.

### The test helper

In `describe('built-in markdown language typing', …)` of `code-editor.test.ts`, directly before row TS1:

```ts
    // TS1–TS19: Markdown's own Enter and Backspace read a tab in a line's container prefix as the spaces to its
    // stop, so they do what they do on the same document written with spaces (markdown-source-mode-enter-after-quote-tab).

    /**
     * Writes each line's container prefix as the viewer reads it: every tab as the spaces to its stop.
     *
     * @param doc - The document.
     * @returns The document with tab-free container prefixes.
     */
    function prefixSpacesForm(doc: string): string {
        return doc.split('\n').map(withPrefixTabsAsSpaces).join('\n');
    }
```

---

## Ordered Implementation Steps

The base moves under this plan: both plans of `depends-on` land first. Find every edit by its quoted text or symbol name, not by line number. Run commands from `packages/lib`. Never run `npm install`, `npm ci` or `npm update`.

0. **Check the base.** `ls ../../plans/implemented/markdown-tab-column-parity.md ../../plans/implemented/markdown-source-mode-tab-highlighting.md` lists both. `grep -cE "^(export )?(function|const) (MARKDOWN_TAB_STOP|CONTAINER_PREFIX_STEP|containerPrefixEnd|TABBED_LINE_END|withPrefixTabsAsSpaces|hasTabInContainerPrefix)\b" src/typescript/lib/component/display/markdownExtensions.ts` prints `6`. `src/typescript/lib/component/editor/markdownTabStops.ts` exists, and `code-editor.test.ts` holds rows TAB29, TAB31 and TAB32. If any check fails, stop and report.
1. **Move the tab rule's helpers.** Create `src/typescript/lib/component/display/markdownContainerPrefix.ts` with the text of `## Internal Structure`. Make the edits of *The moved helpers' other users*, and edits 1 (the `MARKDOWN_TAB_STOP` import only) and 2 of *The change in `languages.ts`*. Checks:
   - `grep -rn "function containerPrefixEnd\|MARKDOWN_TAB_STOP = 4" src/` prints only `markdownContainerPrefix.ts`.
   - `grep -rn "withPrefixTabsAsSpaces\|hasTabInContainerPrefix" src/ tests/ | grep import` shows every import from `markdownContainerPrefix`.
   - `npm run typecheck` (from the repo root) is clean.
   - `npx vitest run tests/component/markdown-roundtrip tests/component/display/markdownLexer.test.ts tests/component/markdown-editor.test.ts tests/component/code-editor.test.ts` is green: nothing changed behaviour.
2. **Add the tests, and see them red.**
   - Create `tests/component/display/markdownContainerPrefix.test.ts` with rows CP1 to CP5 of `## Expected Behaviour`, in `describe('prefixTabEdits', …)`, importing `prefixTabEdits` and `withPrefixTabsAsSpaces` from `~/component/display/markdownContainerPrefix`.
   - In `code-editor.test.ts`, add `import { withPrefixTabsAsSpaces } from '~/component/display/markdownContainerPrefix';` and, unless `markdown-source-mode-tab-highlighting` already added it, `import { tabDocuments } from './markdown-roundtrip/tabDocuments';`. At the end of `describe('built-in markdown language typing', …)`, after row RO6, add the helper of `## Internal Structure` and rows TS1 to TS19.
   - Change rows M37, TAB29, TAB31 and TAB32 as *Rows that change* in `## Expected Behaviour` says.
   - Run `npx vitest run tests/component/code-editor.test.ts tests/component/display/markdownContainerPrefix.test.ts -t "TS|TAB|M3|CP"`. Red, and nothing else: TS1 (three tests), TS2 to TS16, TS19, M37 (three tests), TAB29, TAB31, TAB32. Green: TS17, TS18, CP1 to CP5, and every other `TAB` and `M3` row.
3. **Create `src/typescript/lib/component/editor/markdownTabStopCommands.ts`** with the text of `## Internal Structure`. Check: `npm run typecheck` is clean.
4. **Bind the commands in `languages.ts`**: edits 1 (the `atMarkdownTabStops` import), 3, 4 and 5 of *The change in `languages.ts`*. Check: every row of step 2 is green.
5. **Run the Markdown suites.** `npx vitest run tests/component/code-editor tests/component/markdown tests/component/display`. All green. If a test outside the rows of step 2 fails, stop and report it: on the measured base every other test of these suites passed with this plan's code.
6. **Write the docs and the changelog entry** of `## Documentation Impact`.
7. **Run the checks** of `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/display/markdownContainerPrefix.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownTabStopCommands.ts` |
| Create | `packages/lib/tests/component/display/markdownContainerPrefix.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/languages.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-roundtrip.test.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every row is unit-testable. "Base" is the code with both plans of `depends-on` and without this plan. In the tables `\|` is a `|` in the test's string, which `buildTypingState` reads as the caret; `'\n'` presses Enter and `'\b'` Backspace.

### `prefixTabEdits`

| Row | Title | Call | Result |
|---|---|---|---|
| CP1 | gives each tab of the prefix the spaces to its stop | `prefixTabEdits('>\t\ta')` | `[{ from: 1, to: 2, insert: '   ' }, { from: 2, to: 3, insert: '    ' }]` |
| CP2 | writes a tabbed line end after a marker as one space | `prefixTabEdits('-\t')`; `prefixTabEdits('> - \t ')` | `[{ from: 1, to: 2, insert: ' ' }]`; `[{ from: 3, to: 6, insert: ' ' }]` |
| CP3 | counts every tab of a line of whitespace only | `prefixTabEdits(' \t')` | `[{ from: 1, to: 2, insert: '   ' }]` |
| CP4 | leaves a tab after the prefix alone | `prefixTabEdits('- a\tb')`; `prefixTabEdits('a\tb')` | `[]`; `[]` |
| CP5 | withPrefixTabsAsSpaces applies the edits | `withPrefixTabsAsSpaces('>\t-\ta\tb')`; `withPrefixTabsAsSpaces('-\t')` | `'>   -   a\tb'`; `'- '` |

Each row is `it('<id>: <title>', () => { expect(<call>).toEqual(<result>); });`, one `expect` per call.

### Enter and Backspace

Each row is `it('<id>: <title>', async () => { expect(await typed('markdown', <start>, <keys>)).toBe(<after>); });` unless its cell says otherwise. TS1 runs in `for (const tabSize of [2, 4, 8])`, passes `tabSize` as `typed`'s fourth argument, and ends its title with `` with tabSize ${tabSize} ``, in a template literal as M34's title is.

| Row | Title | Start | Keys | After | Base |
|---|---|---|---|---|---|
| TS1 | Enter after an item whose marker a tab follows starts the next item | `'-\ta\|'` | `'\n'` | `'-\ta\n-   \|'` | `'-\ta\n\|'` |
| TS2 | Enter after an ordered item whose number a tab follows numbers the next | `'1.\ta\|'` | `'\n'` | `'1.\ta\n2.  \|'` | `'1.\ta\n2.\|'` |
| TS3 | Enter inside the text of an item whose marker a tab follows starts the next item | `'-\ta\|b'` | `'\n'` | `'-\ta\n-   \|b'` | `'-\ta\n\|b'` |
| TS4 | Enter after a task item whose checkbox a tab follows starts the next task | `'- [ ]\ttask\|'` | `'\n'` | `'- [ ]\ttask\n- [ ]   \|'` | `'- [ ]\ttask\n- \|'` |
| TS5 | Enter renumbers the items below and keeps their tabs | `'1.\ta\|\n2.\tb'` | `'\n'` | `'1.\ta\n2.  \|\n3.\tb'` | `'1.\ta\n2.\|\n3.\tb'` |
| TS6 | Enter after a loose item whose marker a tab follows keeps the list loose | `'-\ta\n\n-\tb\|'` | `'\n'` | `'-\ta\n\n-\tb\n\n-   \|'` | `'-\ta\n\n-\tb\n\|'` |
| TS7 | Enter on an empty second item after a tab loosens the list, and a second Enter leaves it | `'-\ta\n-\t\|'` | `'\n'`, then a second `expect` with `'\n\n'` | `'-\ta\n\n-\t\|'`; `'-\ta\n\n\|'` | `'-\ta\n-\t\n\|'`; `'-\ta\n-\t\n\n\|'` |
| TS8 | Enter in a quote inside an item whose marker a tab follows stays in the item | `'-\t> a\|'` | `'\n'` | `'-\t> a\n    > \|'` | `'-\t> a\n> \|'` |
| TS9 | Enter after an item in a quote, with a tab after the quote marker and after the item marker | `'>\t-\ta\|'` | `'\n'` | `'>\t-\ta\n>   -   \|'` | `'>\t-\ta\n>\|'` |
| TS10 | Enter after an item in a quote whose marker a space and a tab follow | `'> \t- a\|'` | `'\n'` | `'> \t- a\n>   - \|'` | `'> \t- a\n> \|'` |
| TS11 | Enter on a tab-indented paragraph of an item starts the new line at the item's content | `'- a\n\n\tb\|'` | `'\n'` | `'- a\n\n\tb\n  \|'` | `'- a\n\n\tb\n    \|'` |
| TS12 | Backspace after a marker that a tab follows removes the marker | `'-\t\|'`; `'1.\t\|'` | `'\b'` | `'\|'`; `'\|'` | `'-\|'`; `'1.\|'` |
| TS13 | Backspace after a second item's marker that a tab follows turns the marker into indentation | `'- a\n-\t\|'` | `'\b'` | `'- a\n  \|'` | `'- a\n-\|'` |
| TS14 | Backspace after a quote marker that a tab follows removes the marker | `'>\t\|'` | `'\b'` | `'\|'` | `'>\|'` |
| TS15 | Backspace after an item marker and a tab in a quote opened by a tab removes the item marker | `'>\t-\t\|'` | `'\b'` | `'> \|'` | `'>\t-\|'` |
| TS16 | Enter with a caret after each of two items whose markers tabs follow starts two items | `enterAtTwoCarets('-\ta\n-\tb', 3, 7)` | | `'-\ta\n-   \n-\tb\n-   '` | `'-\ta\n\n-\tb\n'` |
| TS17 | Enter after an item whose marker a tab follows changes nothing in a read-only editor | `typedReadOnly('markdown', '-\ta', '\n')` | | `'-\ta\|'` | the same |
| TS18 | Enter and Backspace in a quoted list without a tab are unchanged | `'> - a\|'`; `'> - \|'` | `'\n'`; `'\b'` | `'> - a\n> - \|'`; `'> \|'` | the same |

TS16 and TS17 call the helper in their Start cell and compare its result with After. TS7, TS12 and TS18 hold two `expect`s each, in the order given.

```ts
    // 3,000 draws give 2,932 documents and 9,285 presses. On the base, 1,329 of them end otherwise.
    it('TS19: on every drawn tab document, Enter and Backspace do what they do with its container prefixes written as spaces', async () => {
        const differing: string[] = [];

        for (const doc of tabDocuments(3_000)) {
            const lines = doc.split('\n');
            const spacedLines = lines.map(withPrefixTabsAsSpaces);

            for (let index = 0; index < lines.length; index++) {
                const line = lines[index]!;
                const isEnterLine = line !== '' && !/[ \t]$/.test(line);
                const isBackspaceLine = /[-*+>.)] $/.test(line);
                const keys = isEnterLine ? '\nx' : isBackspaceLine ? '\bx' : null;

                if (keys === null) {
                    continue;
                }

                const withCaret = (all: string[]): string => all.map((text, at) => (at === index ? text + '|' : text)).join('\n');
                const result = await typed('markdown', withCaret(lines), keys);
                const spacedResult = await typed('markdown', withCaret(spacedLines), keys);
                const same = prefixSpacesForm(result.replace('|', '')) === spacedResult.replace('|', '');

                if (!same) {
                    differing.push(JSON.stringify([doc, index, keys]));
                }
            }
        }

        expect(differing).toEqual([]);
    });
```

TS19 presses Enter at the end of every line that does not end in a space or a tab, and Backspace at the end of every line that ends in a marker and one space, then types `x`. The `x` puts the caret's column into the text, so the comparison sees it.[^ts19]

### Rows that change

As above, `\|` in a cell is a `|` in the test's string.

| Row | Edit |
|---|---|
| M37 | In `toBe('-\t<div>\n    \|')`, `'    \|'` becomes `'-   \|'`. The title's `indents to the item content` becomes `continues the list`. The comment above the `M36`/`M37` loop is replaced by the block below the table. |
| TAB29 | After becomes `'> \|'`. |
| TAB31 | Title becomes `Enter on an item's later paragraph after a tab stays in the quote and the item`; After becomes `'> - a\n>\n>\tb\n>   \|'`. |
| TAB32 | Title becomes `Enter on an empty nested item after a tab lifts it to the outer list`; After becomes `'> - a\n> - \|'`. Delete the comment above TAB31 that starts `// TAB31 and TAB32: @codemirror/lang-markdown's own Enter takes a space after > but not a tab.` |

The comment above the `M36`/`M37` loop, which starts `// A tab reaches the next stop from wherever it starts`, becomes:

```ts
    // A tab reaches the next stop from wherever it starts, so one that starts off a stop is narrower
    // than four columns: after one space it is three wide, and after a marker at column 0 too. M36
    // copies its tab with the rest of the line's start. M37 has no HTML below the caret, so Markdown's
    // own Enter continues the list, the new marker's spaces reaching the column the tab reaches; it
    // alone tells that from a tab counted as four columns wherever it stands.
```

### Manually

In the demo, open a `MarkdownEditor` and switch to source mode. Type `-`, a tab, `a` and Enter: a new `-` item starts, and text typed there shows as a second item in WYSIWYG mode. Type `>`, a tab, `- a`, Enter, `b`: `b` is a second item of the quoted list in WYSIWYG mode. Press Backspace after `-` and a tab on an empty line: the marker goes.

---

## Verification

1. From `packages/lib`: `npx vitest run tests/component/code-editor tests/component/markdown tests/component/display`. All green.
2. `grep -rn "addKeymap" src/` shows `languages.ts` only. `grep -rn "function containerPrefixEnd" src/` shows `markdownContainerPrefix.ts` only.
3. `grep -n "^import" src/typescript/lib/component/display/markdownContainerPrefix.ts` prints nothing.
4. `git diff --name-only <the branch's base> -- src/typescript/lib/component/editor/CodeEditor.ts` prints nothing.
5. The manual check of `## Expected Behaviour`.
6. Project checks, from the repo root: `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm run lint`, `npm run test`, `npm run docs:api`, `npm run docs:llms:check`. `tests/unit/import-without-dom.test.ts` is part of `npm run test` and covers the two new modules.

---

## Documentation Impact

No public API changes; neither new module is added to a barrel.

**`packages/lib/docs/components/CodeEditor.md`**, in the list under `The prefix is the start of the caret's line`:

- In the bullet that starts `**At the end of an HTML block**`, delete the last sentence, which starts `One marker line is left out of the first: after a bullet followed by a tab`.
- Delete the bullet that starts `**After a \`>\` followed by a tab**` (added by `markdown-source-mode-tab-highlighting`).
- Replace the bullet that starts `**A tab-indented line of ordinary text in a list item**` with:

  > - **A tab in a line's markers or indentation** counts to the next multiple of four columns, as the [`Markdown`](/components/Markdown) viewer reads it, whatever the editor's `tabSize`. Markdown's own continuation, and Backspace after a marker, do what they do on the same lines written with spaces: after `-`, a tab and `a`, Enter starts a new item, `-` and three spaces, and after `>`, a tab and `- a` it starts `>   - `. A tab the key does not edit stays a tab; the markers and indentation it writes are spaces.

**`packages/lib/docs/reference/changelog/next.md`** — as the last bullet of `## Fixed` → `### Components`, wrapped at 76 columns with a two-space hanging indent like its neighbours:

> - **`CodeEditor`'s `markdown` language continues lists and quotes after a tab.** Enter and Backspace measured a line's markers in characters and took a space but not a tab after them. After `-`, a tab and `a`, Enter added no new item; in `> - a` over `>`, a tab and `b`, it started the new line outside the quote; Backspace after `-` and a tab deleted the tab and left the marker. They now count a tab to Markdown's tab stops, as the `Markdown` viewer reads it, and do what they do on the same lines written with spaces. A tab the key does not edit stays a tab. `MarkdownEditor`'s source mode gets the same keys. No consumer action is needed.

---

## Potential Challenges

- **The dependency plans changed in revision.** Step 0 checks the names this plan needs. If `markdown-tab-column-parity` renamed a helper, move what it has under its new name and keep this plan's module name. If the tab-highlighting rows were renumbered, apply *Rows that change* to the rows with those Start strings.
- **A later `@codemirror/lang-markdown`.** If it renames `insertNewlineContinueMarkup`, `deleteMarkupBackward` or the `addKeymap` option, `npm run typecheck` fails in `languages.ts`. If it starts reading tabs itself, TS19 stays green and this module can go.
- **A slow parse.** In a long document whose tree is far from complete, the spaced copy may not parse within 50 ms; the key then runs the command on the document as before this plan.
- **The parity plan's corpora.** `corpus/enterInsideHtml.ts` and `corpus/enterInCode.ts` hold the documents Enter leaves, written out; no row types a key. They need no change, and step 5 runs them.

---

## Critical Files

- [languages.ts:439](packages/lib/src/typescript/lib/component/editor/languages.ts#L439) — `insertNewlineKeepPrefix`, the library's own Enter rule in the same keymap; the `"markdown"` loader (469), `htmlLanguage.configure` (488) and `markdown()` (496), the precedent for configuring a grammar through its options; the keymap `return` (502); `MARKDOWN_TAB_STOP` (156), deleted here.
- `markdownExtensions.ts` after `markdown-tab-column-parity` — `listWithTabStops` and `blockquoteWithTabStops`, the precedent: the stock tokenizer runs on a spaced copy, and the source is restored; the helpers this plan moves.
- `markdownTabStops.ts` after `markdown-source-mode-tab-highlighting` — the tree this plan's spaced copy relies on; `readQuoteContinuationTabs`, which hands every line without a tab to the stock code.
- `node_modules/@codemirror/lang-markdown/dist/index.js` at the repo root — `getContext` (122), which reads each container's first line with `/^ *>( ?)/` and the list patterns; `insertNewlineContinueMarkupCommand` (204); `contextNodeForDelete` (319) and `deleteMarkupBackward` (350); `markdown()` (406) and its `addKeymap` (423).
- [code-editor.test.ts:3386](packages/lib/tests/component/code-editor.test.ts#L3386) — `describe('built-in markdown language typing', …)`, with `typed` (3565), M37 (3746), `enterAtTwoCarets` (4332), `typedReadOnly` (4395) and RO6 (4423).
- `plans/markdown-tab-column-parity.md` (the tab rule, `tabDocuments`) and `plans/markdown-source-mode-tab-highlighting.md` (rows TAB29 to TAB32).

---

## Non-Goals

- **Whitespace that holds a tab at the end of a marker line.** The tree reads `-` followed by five or more columns of whitespace as an item holding code, with spaces as with tabs, where the tab rule reads one space. Enter there is `insertNewlineKeepPrefix`'s, which copies the line's start.[^line-end]
- **Lines `insertNewlineKeepPrefix` handles** — code blocks, HTML in a container, blank indented lines. It copies the line's start character for character, so its columns are already Markdown's.
- **The editor's plain Enter**, outside every list and quote. It keeps the line's indentation measured with `tabSize`, as the docs say.
- **Writing tabs.** The new line's markers and indentation are written as `@codemirror/lang-markdown` writes them, with spaces. Repeating the user's tabs would need a choice of tab or spaces per column, which the command does not make.
- **Tab and Shift-Tab, and the source-mode commands of `MarkdownEditor`** (list toggles, block lifts). They are not Markdown's Enter or Backspace; source mode's line commands decline only on a tab in the indentation of a list item's continuation line and on a tab right after a list item's marker; on other lines whose prefix holds a tab they act (rows TB11 to TB14 and TB16 to TB18 of `markdown-source-edits.test.ts`; only TB15 declines).
- **`CodeEditor` itself.** It gains no option and no Markdown-named code.
- **Reporting upstream.** That is the owner's call; `## Addendum: Measurements` has what a report needs.

---

## Addendum: Measurements

Measured on a private copy of `feature/marked-version-pin-or-upgrade` (`ef607a8e6`) with `markdown-source-mode-tab-highlighting`'s `markdownTabStops.ts` and its `languages.ts` change applied, `@codemirror/lang-markdown` 6.5.2 and `@lezer/markdown` 1.7.2. `markdown-tab-column-parity`'s code was not applied; its helpers were copied into `markdownContainerPrefix.ts`, and the new `withPrefixTabsAsSpaces` gave the old one's result on 40,000+ lines (every line of the drawn documents and every string of up to four of fifteen prefix pieces).

### Which shapes go wrong today

Every shape comes from one of four readings of `@codemirror/lang-markdown`'s `getContext`, which builds each container's prefix from the container's first line:

| Reading | Shapes | Rows |
|---|---|---|
| A list marker or checkbox needs a space after it (`( +)`, `( {1,4}\[[ xX]\])?`) | `-→a`, `1.→a`, `-·[·]→task`: the line has no item for the command; Enter adds nothing or `2.` without its space, Backspace deletes the tab | TS1–TS7, TS12, TS13 |
| A quote marker takes an optional space only (`/^ *>( ?)/`) | `>→a`, `>·→-·a`: the new line's `>` loses its column | TS9, TS10, TS14, TS15 |
| The "dedented" check counts characters on the caret's line | `>·-·a⏎>⏎>→b`, `-·a⏎⏎→b`: the new line drops the item | TS11, TAB31 |
| Widths mix the first line's characters with the caret line's columns | `-→>·a`, `>·-·a⏎>→-·`: markers land at the wrong column, or a lift writes what was there | TS8, TAB32 |

### Sweeps

Each press was compared with the same press on the document written in the tab rule's spaces, by columns. "Container" means the viewer reads text typed after the key in another block than on the spaces form; "column" means the same block at another column. A press on a line that ends in whitespace holding a tab is counted apart, as "line end": the tab rule writes that whitespace as one space, so the two forms can differ there in trailing whitespace alone.

| Documents | Key | Presses | Base: container | Base: column | Base: line end | After: container or column | After: line end |
|---|---|---|---|---|---|---|---|
| 4,000 drawn shapes of one to four lines, each zero to three of 14 prefix pieces, then `a`, `b·c` or nothing | Enter | 10,215 | 1,159 | 600 | 922 | 0 | 8 |
| the same | Backspace after a marker | 3,774 | 84 | 13 | 1,048 | 0 | 291 |
| `tabDocuments(3_000)` (2,932 documents) | Enter | 10,073 | 888 | 480 | 194 | 0 | 0 |
| the same | Backspace after a marker | 4,329 | 14 | 2 | 164 | 0 | 44 |

After this plan, every "line end" press differs from the spaces form in trailing whitespace only: with every tab written as its spaces and each line's trailing whitespace dropped, the two results are equal.

TS19's own count, over the same 2,932 documents with its narrower choice of lines, is 1,329 of 9,285 presses on the base and 0 after.

### Cost

Enter at the end, and in the middle, of a 5,000-line list in which every line holds a tab, timed over 20 presses each:

| Document | Base | This plan | Spacing the whole top-level block instead |
|---|---|---|---|
| `-→item·N` | 3.5 / 2.9 ms | 7.7 / 5.0 ms | 37.2 / 17.0 ms |
| `>→-·item·N` | 6.1 / 6.7 ms | 12.9 / 11.3 ms | 44.7 / 29.1 ms |
| `-···item·N` (no tab) | 2.6 / 2.0 ms | 2.8 / 2.2 ms | — |

---

## Notes

[^measured]: The prototype ran in the worktree `plan-enter-quote-tab` from `ef607a8e6`, with `markdown-source-mode-tab-highlighting`'s code applied as its `## Internal Structure` gives it. The scripts, the sweep outputs (`sweep-before2.json`, `sweep-final.json`), the prototype files and a `PROGRESS.md` are kept in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans5/enter-quote-tab/`. With the prototype, the code-editor, Markdown and display suites passed (10,729 tests), and the whole library suite passed once (18,687 tests); comment wording, the conditions written without calls, and the parse bound to the caret's line were changed after the full run, and the three suites passed again after them. The "Today" column is the base: both dependency plans, without this one.

[^approach]: Three designs were weighed. Writing a column-aware Enter and Backspace in the library would copy `getContext`, the empty-item lift, the renumbering, the loose-list rule and the double-quote exit — nearly 300 lines of `@codemirror/lang-markdown` — and drift from it on every release. Fixing individual patterns is not possible: the patterns are inside the package, and the four readings of `## Addendum: Measurements` reach every branch of both commands. Writing the user's tabs as spaces in the document before each key press would change lines the user did not touch. The spaced copy keeps the package's behaviour whole and changes only the lines the key edits.

[^precedent]: `listWithTabStops` calls `listWithOwnTaskMarker` on `mapLines(src, withPrefixTabsAsSpaces)` and then `restoreListSource(list, src)`; `blockquoteWithTabStops` does the same with `blockquoteWithSourceRaw`. Both leave a source without a tab to the stock tokenizer. `atMarkdownTabStops` has the same three parts: the stock command, the spaced form of what it reads, and a write-back to the source. `insertNewlineKeepPrefix` is the precedent for where the code binds: an Enter command of the library's own in the language's `Prec.high` keymap.

[^keymap]: Binding the wrapped commands ahead of `markdown()`'s keymap, without `addKeymap: false`, does not work. Where the command declines on the spaced copy, the wrapper must pass the key on, and the next binding would then be the same command on the tab document, which acts wrongly: `>-→a⏎b·c▮` gives `>` on the new line where the spaces form gives a plain line break (measured). With the package's keymap off, the next binding is the editor's plain Enter, as on the spaces form. `markdownKeymap` holds exactly these two bindings, so nothing else is lost.

[^decline]: The command declines on the copy where it declines on the spaces form: on a lazy continuation line of an item, for instance, or with a selection. The key then goes to `codeEditorKeymap`'s plain Enter on the real document, which is what the spaces form gets too.

[^lines]: `getContext` reads the first line of every `Blockquote` and `ListItem` around its start node. Enter starts from the node in front of the caret. Backspace starts from `contextNodeForDelete`, which, from a line of bare `>` markers, walks back over the markers into the last item of a list that ends above: that item and its containers hold the nearest line with content above the caret. The empty-line and quote-exit rules read the line above the caret. `renumberList` and `nonTightList` read the lines after the caret only for item numbers and for blankness, which tabs before a marker do not change. A version that spaced the whole top-level block around the caret gave the same results on both sweeps but cost three to five times as much on a long tabbed list (`## Addendum: Measurements`).

[^style]: `@codemirror/lang-markdown` writes new markers and indentation with spaces (with tabs only when the editor's indent unit is a tab), so a line Enter adds after `-→a` starts `-···`, as after `-···a`. Copying the tab instead would be a second rule, with its own cases where a tab would land at another column. A tab inside a run the command edits cannot be kept: the command's change starts or ends inside the tab's columns, which no tab can express.

[^shared]: `languages.ts` is in `CodeEditor`'s chunk and imports only `@codemirror/language`, `@codemirror/state`, `@codemirror/view`, types and the library's own light modules (its header comment). A copy of the helpers in the editor would be a second statement of the tab rule, which the owner accepted as one rule for the viewer and both editor modes. A dynamic `import()` of `markdownExtensions.ts` in the loader would load `marked` for every `CodeEditor` that selects Markdown.

[^equivalent]: Checked on the prototype by comparing the old body with the new over every line of `tabDocuments(3_000)` and every string of up to four pieces from `>`, `> `, `>→`, `·`, `→`, `-·`, `-→`, `1.→`, `[·]`, `[x]→`, `a`, `→→`, `··→`, `#→` and a backtick: 40,000 and more lines, all equal.

[^m37]: M37 pinned that after `-→<div>` Markdown's own continuation did not run, because the bullet's pattern needs a space, and the editor's plain Enter indented the line to the item's content. With this plan the list continues, as `CodeEditor.md` says it does after `-·<div>`, and the sentence that named the tab case as the exception goes. The row still tells a tab counted to its stop from one counted as four columns: the latter would give `-····`.

[^ts19]: Lines that end in a space or a tab are left out of the Enter presses: the command deletes trailing whitespace before the caret, and the tab rule writes a tabbed line end as one space, so the two forms would differ there by construction. Backspace is pressed only after a marker and one space, where the two forms agree on the line's end.

[^line-end]: `@lezer/markdown` reads `-` and five or more columns of whitespace with nothing after them as an item holding an indented code block, both as `-→·→·` and as `-·······`, where CommonMark and the tab rule read an empty item. That reading is the tree's, not a tab's, and `insertNewlineKeepPrefix` takes Enter on such a line as on any code line. The sweeps counted presses on lines that end in such whitespace apart; after this plan they differ from the spaces form in trailing whitespace only.

---

## Implementation Notes

- **The tab rule already lived in a dependency-free module, so no `markdownContainerPrefix.ts` was created.** `markdown-tab-column-parity` ended with the rule in `display/markdownTabs.ts` (`prefixEnd`, `tabWidthAt`, `expandPrefixTabs`), whose only import from `marked` is a type. The plan's new module was meant to give the editor a rule it can load without `marked`; `markdownTabs.ts` already does. `prefixTabEdits` and `PrefixTabEdit` were added there instead, `MARKDOWN_TAB_STOP` is now exported from it, `expandLine` applies `prefixTabEdits` so the rule is written once, and `languages.ts` imports the constant in place of its own copy. `markdownExtensions.ts`, the serializer and the round-trip test needed no change. The unit rows CP1 to CP5 live in `tests/component/display/markdownTabs.test.ts`, with `expandPrefixTabs(...).text` standing in for the plan's `withPrefixTabsAsSpaces`, which does not exist on this base.
- **Rows TAB35 and TAB36 were restated.** The plan did not list them. They pinned two shapes where `@codemirror/lang-markdown`'s character-based Enter differed from the result on the same document written with spaces. With the wrapper, Enter declines on the spaced copy exactly where it declines on the spaces form, so the editor's plain Enter answers and keeps the line's indentation: TAB35 now gives `\t---` then a line of four spaces, and TAB36 gives `    1. [ ] ` then a line of four spaces. Both results were checked against the spaces form typed directly. Their titles lose "pinned".
- **Rows TAB29, TAB31, TAB32 and M37 changed as the plan says**, and TS1 to TS19 were added. TS19 passes over the drawn documents.
- **`prefixSpacesForm` uses `expandPrefixTabs(doc).text`** since `withPrefixTabsAsSpaces` is not on this base.
- **Two steps of the plan were overridden, on purpose.** Step 0 says to stop and report when its check fails, and the challenges say to keep this plan's module name. Step 0's `grep` prints `0` on this base, because the helpers live in `display/markdownTabs.ts` (a file whose only import from `marked` is a type), so the check is out of date rather than the base broken. The plan's reason for a new module was that the editor must not load `marked`; `markdownTabs.ts` already satisfies that, so a second module would only have copied the rule. The nearest option to the plan's intent was to extend that file.
- **The plan's write-back rule was wrong, and was changed in review.** The plan's decision "A tab the command does not touch stays a tab" counted only changes that overlap a tab's spaces. An edit earlier on the line, or a line break inserted before the tab, moves the tab to another column, where it no longer spans the spaces the command placed: Enter in `> >`, a tab and `# h` with the caret after `> >` gave a code block where the spaces form gives a heading. A tab now goes back only where its new start column gives it exactly the width of its spaces (`keepsReading` in `markdownTabs.ts`, the precedent, restores a tab only at the column it had; the rule here is looser, because a tab at another column that spans as many columns reads the same, as the second tab in ` 1.`, a tab, `[ ]`, a tab does after Backspace removes the first); the whitespace that ends a line goes back only at the column it had and while nothing is inserted at either end of it. The copy is built with `filter: false`, and the command runs on it without the state's transaction filters (a wrapper whose `update` sets `filter: false`), so a consumer's filter sees the document once, in the transaction that is dispatched.
- **Rows TS20 to TS28 were added.** TS20 puts the caret at every position of the lines of 150 drawn tab documents and compares the blocks Enter and Backspace leave with the spaces form's; it fails on the first version of the write-back. It leaves out two kinds of press where the two forms differ whatever this module does: Backspace where `deleteMarkupBackward` declines on the spaces form, and Enter where the library's prefix-copying Enter handles the spaces form but not the tab form. TS21 pins one undo step, TS22 the kept user event (all events recorded), TS23 a read-only Backspace on a tab line, TS24 the reproduction of the first review (`> >`, a tab and `# h`), TS25 the rule that whitespace at a line's end is not kept when the key inserts at its end, TS26 the rule that it is kept only at its column, TS27 a change filter that refuses unannotated changes, TS28 a transaction filter that appends `!`, which must run once. Each fails with its rule removed.
- **A caret-only difference remains.** After a kept line-end tab, as in TS7, the caret stands at column 4 where the spaces form has column 2; the text is the same.
- **The plan body was edited once**: the non-goal about the source-mode commands of `MarkdownEditor` named a plan that is dropped; it now says that source mode's line commands decline only on a tab in the indentation of a list item's continuation line and on a tab right after a list item's marker; on other lines whose prefix holds a tab they act (rows TB11 to TB14 and TB16 to TB18 of `markdown-source-edits.test.ts`; only TB15 declines).
- **`SyntaxNode` is shared.** `languages.ts` and the new module each declared the same type; the new module exports it and `languages.ts` imports it.
