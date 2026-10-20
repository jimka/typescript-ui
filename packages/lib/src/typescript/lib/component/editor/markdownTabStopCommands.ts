// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Makes `@codemirror/lang-markdown`'s Enter and Backspace commands count a
// tab in a line's container prefix as Markdown does: to the next multiple of
// four columns (CommonMark §2.2), as the viewer reads it. `languages.ts`
// binds the two commands through atMarkdownTabStops. The external packages
// imported here are ones `CodeEditor` itself imports, and `markdownTabs.ts`
// imports `marked` for a type only, so loading this module loads no grammar
// package and no `marked`.

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { TreeIndentContext } from "@codemirror/language";
import { ChangeSet, countColumn, Transaction } from "@codemirror/state";
import type { EditorState, StateCommand, TransactionSpec } from "@codemirror/state";
import { MARKDOWN_TAB_STOP, prefixTabEdits, tabWidthAt } from "~/component/display/markdownTabs.js";

/**
 * A syntax tree node. Named from an indentation query's own type because
 * `@lezer/common`, which declares it, is not a direct dependency.
 *
 * @internal Shared with `languages.ts`, not part of the public API surface.
 */
export type SyntaxNode = TreeIndentContext["node"];

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
    /** Whether the run is the whitespace that ends its line, rather than one tab. */
    endsLine: boolean;
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

            runs.push({ from, to: line.from + edit.to, text: line.text.slice(edit.from, edit.to), spaces: edit.insert, spacedFrom: from + shift, endsLine: edit.to === line.text.length });
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
    const copy = state.update({ changes: spacing, selection: state.selection.map(spacing), filter: false }).state;
    // The commands read the blocks that hold each caret, which end on or
    // after its line: the tree must reach the end of the last caret's line.
    const lastCaretLine = copy.doc.lineAt(copy.selection.ranges[copy.selection.ranges.length - 1]!.head);
    const tree = ensureSyntaxTree(copy, lastCaretLine.to, SPACED_PARSE_BUDGET_MS);

    // A state keeps the tree it was made with: what ensureSyntaxTree parsed
    // reaches syntaxTree() in the next state made from it.
    return tree === null ? null : copy.update({ filter: false }).state;
}

/**
 * Wraps a state so that every transaction it makes skips the state's
 * transaction filters. The spaced copy is not the document, so a filter of
 * the consumer's must not read it; the transaction written back to the
 * document is the one they filter.
 *
 * @param state - The state.
 * @returns A state that reads as `state` and whose `update` sets `filter: false` on every spec.
 */
function withoutFilters(state: EditorState): EditorState {
    return new Proxy(state, {
        get(target, property) {
            if (property === "update") {
                return (...specs: TransactionSpec[]): Transaction => target.update(...specs.map((spec) => ({ ...spec, filter: false })));
            }

            const value: unknown = Reflect.get(target, property);

            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

/**
 * Runs a command on a state that no view shows, and keeps the transaction it
 * dispatches. The state's transaction filters do not run on it (see
 * withoutFilters).
 *
 * @internal Shared with `markdownItemRenumbering.ts`, not part of the public API surface.
 *
 * @param command - The command.
 * @param state - The state.
 * @returns The transaction, or `null` when the command did not act.
 */
export function transactionOf(command: StateCommand, state: EditorState): Transaction | null {
    const dispatched: Transaction[] = [];
    const handled = command({ state: withoutFilters(state), dispatch: (transaction) => { dispatched.push(transaction); } });

    return handled ? (dispatched[0] ?? null) : null;
}

/**
 * Tells whether a transaction made on the spaced copy leaves a run as it
 * was, so that the run can go back to what the document held. A change that
 * replaces, deletes from or inserts into the run's spaces alters it. A change
 * that moves the run to another column alters it too, unless a tab at the new
 * column spans as many columns as the spaces the command placed: in `> >`, a
 * tab and `# h`, Enter after the second `>` starts the line `> > ` and moves
 * the tab to column 4, where it spans four columns, and the command had
 * placed one space for it. The whitespace that ends a line is kept only at
 * the column it had, and while nothing is inserted at either end of it.
 *
 * @param done - The transaction made on the spaced copy.
 * @param run - The run.
 * @returns `true` when the run goes back to its text.
 */
function keepsRun(done: Transaction, run: SpacedRun): boolean {
    const runEnd = run.spacedFrom + run.spaces.length;
    let altered = false;

    done.changes.iterChangedRanges((fromA, toA) => {
        const overlaps = fromA < runEnd && toA > run.spacedFrom;
        const insertsInside = fromA === toA && fromA > run.spacedFrom && fromA < runEnd;
        const touchesLineEnd = run.endsLine && fromA <= runEnd && toA >= run.spacedFrom;

        altered = altered || overlaps || insertsInside || touchesLineEnd;
    });

    if (altered) {
        return false;
    }

    const before = columnBefore(done.startState, run.spacedFrom);
    const after = columnBefore(done.state, done.changes.mapPos(run.spacedFrom, 1));

    return run.endsLine ? after === before : tabWidthAt(after) === run.spaces.length;
}

/**
 * Counts the columns in front of a position on its line.
 *
 * @param state - The editor state.
 * @param pos - The position.
 * @returns The column, counting a tab to Markdown's tab stop.
 */
function columnBefore(state: EditorState, pos: number): number {
    const line = state.doc.lineAt(pos);

    return countColumn(line.text.slice(0, pos - line.from), MARKDOWN_TAB_STOP);
}

/**
 * Writes a transaction made on the spaced copy onto the document. A run the
 * transaction leaves as it was keeps its tab (see keepsRun); any other run
 * is written as its spaces first, so the transaction's change applies to it
 * as made.
 *
 * @param state - The editor state the copy was made from.
 * @param runs - The runs the copy wrote as spaces.
 * @param done - The transaction made on the copy.
 * @returns The same edit, for the editor state.
 */
function writtenBack(state: EditorState, runs: readonly SpacedRun[], done: Transaction): TransactionSpec {
    const kept = runs.filter((run) => keepsRun(done, run));
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
 * written onto the document; a tab it leaves alone stays a tab, where it
 * still stands at a column that gives it the width of its spaces. So Enter
 * and Backspace do what they do on the same document written with spaces.
 *
 * Where those lines hold no such tab, the editor is read-only, or the
 * copy's tree is not ready in time, the command runs on the document itself.
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
