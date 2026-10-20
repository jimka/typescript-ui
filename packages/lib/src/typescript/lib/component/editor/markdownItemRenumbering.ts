// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Makes `@codemirror/lang-markdown`'s Enter keep what an ordered list item
// holds when the command renumbers it. `languages.ts` binds the command
// through keepingRenumberedItemContent. The external packages imported here
// are ones `CodeEditor` itself imports, and `markdownTabs.ts` imports `marked`
// for a type only, so loading this module loads no grammar package and no
// `marked`.

import { syntaxTree } from "@codemirror/language";
import { ChangeSet, countColumn, Transaction } from "@codemirror/state";
import type { ChangeSpec, EditorState, Line, StateCommand, Text } from "@codemirror/state";
import { MARKDOWN_TAB_STOP, tabWidthAt } from "~/component/display/markdownTabs.js";
import { transactionOf } from "~/component/editor/markdownTabStopCommands.js";
import type { SyntaxNode } from "~/component/editor/markdownTabStopCommands.js";

/**
 * The most columns between a list marker and its text that still set the
 * item's content column (CommonMark §5.2): with more, the text is indented
 * code and the column is one past the marker. The serializer's
 * `MAX_MARKER_SPACING`, which this module does not import so as to load no
 * Lexical module.
 */
const MAX_MARKER_SPACING = 4;

/** The length of an ordered item's delimiter, `.` or `)`, which follows the digits in its list marker. */
const DELIMITER_LENGTH = 1;

/** A run of digits, the whole of a renumbering change's old and new text. */
const DIGITS = /^\d+$/;

/** The characters a line may hold in front of an item's content column: indentation and outer quote markers. */
const BEFORE_CONTENT = /^[ \t>]$/;

/**
 * The column an item's content starts at, which its later lines are indented
 * to: the spaces and tabs after the marker when they span one to four columns
 * and text follows, else one column past the marker. The serializer's
 * `contentColumn`, with a tab counted to Markdown's stop.
 *
 * @param text - The item's first line.
 * @param markEnd - Where the marker ends in the line, its delimiter included.
 * @returns The content column, counted from the line's start.
 */
function itemContentColumn(text: string, markEnd: number): number {
    const markColumn = countColumn(text, MARKDOWN_TAB_STOP, markEnd);
    const textStart  = markEnd + text.slice(markEnd).search(/[^ \t]|$/);

    if (textStart === text.length) {
        return markColumn + 1;
    }

    const spacing = countColumn(text, MARKDOWN_TAB_STOP, textStart) - markColumn;

    return spacing >= 1 && spacing <= MAX_MARKER_SPACING ? markColumn + spacing : markColumn + 1;
}

/**
 * Finds the ordered list item whose number a change replaces, in the state
 * before the change.
 *
 * @param state - The state before the change.
 * @param from - Where the replaced digits start.
 * @param to - Where they end.
 * @returns The item's list marker, or `null` when the digits are not an item's number.
 */
function renumberedMark(state: EditorState, from: number, to: number): SyntaxNode | null {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); node; node = node.parent) {
        if (node.name !== "ListItem") {
            continue;
        }

        const mark = node.getChild("ListMark");
        const isNumber = node.parent?.name === "OrderedList" && mark !== null && mark.from === from && mark.to === to + DELIMITER_LENGTH;

        return isNumber ? mark : null;
    }

    return null;
}

/**
 * Builds the change that moves a later line of an item by the columns its
 * content column moved, or `null` when the line does not pass that column:
 * a blank line, or a lazy continuation line, which stays where it is. The
 * line's whitespace from the content column to its text moves as a whole:
 * spaces are added or taken in front of it, and a tab in it whose width
 * would change at its new column is written as the spaces it spanned, so
 * every column past the content column keeps its distance from it.
 *
 * @param text - The line.
 * @param column - The item's content column before the renumbering.
 * @param shift - The columns the content column moved; positive to the right.
 * @param indentation - The columns of the whitespace past the content column that are indentation, which a tab
 *   in is written as spaces; the rest is a code line's text, whose tabs stay tabs. `Infinity` for a line that is no code text.
 * @returns The change, by character index in the line, or `null`.
 */
function lineShift(text: string, column: number, shift: number, indentation: number): { from: number; to: number; insert: string } | null {
    let at = 0;
    let atColumn = 0;

    while (atColumn < column) {
        const char = text.charAt(at);
        const passes = at < text.length && BEFORE_CONTENT.test(char);

        if (!passes) {
            return null;
        }

        atColumn += char === "\t" ? tabWidthAt(atColumn) : 1;
        at++;
    }

    const textStart = at + text.slice(at).search(/[^ \t]|$/);
    const whitespace = text.slice(at, textStart);

    // A line of whitespace that ends at the content column holds nothing to move.
    if (textStart === text.length && whitespace === "") {
        return null;
    }

    const moved = movedWhitespace(whitespace, atColumn, shift, indentation);
    // The whitespace in front of the content column, back to the last marker
    // or the line's start.
    const runStart = text.slice(0, at).search(/[ \t]*$/);
    const run = text.slice(runStart, at);

    if (shift > 0) {
        return moved === whitespace ? { from: at, to: at, insert: " ".repeat(shift) } : { from: at, to: textStart, insert: " ".repeat(shift) + moved };
    }

    const spacesToTake = moved === whitespace && /^ *$/.test(run) && run.length >= -shift;

    if (spacesToTake) {
        return { from: at + shift, to: at, insert: "" };
    }

    // Written again as spaces, one column shorter per column taken.
    const runWidth = atColumn + shift - countColumn(text, MARKDOWN_TAB_STOP, runStart);

    return runWidth < 0 ? null : { from: runStart, to: textStart, insert: " ".repeat(runWidth) + moved };
}

/**
 * Writes the whitespace between an item's content column and a line's text
 * as it reads once moved by some columns: a tab whose width would change at
 * its new column becomes the spaces it spanned, so every character keeps its
 * distance from the content column.
 *
 * @param whitespace - The spaces and tabs from the content column to the text.
 * @param column - The column the whitespace starts at.
 * @param shift - The columns it moves; positive to the right.
 * @param indentation - The columns from `column` that are indentation; whitespace from there on is a code line's text and is kept as it is.
 * @returns The whitespace to write at the new column.
 */
function movedWhitespace(whitespace: string, column: number, shift: number, indentation: number): string {
    let moved = "";
    let atColumn = column;

    for (const char of whitespace) {
        const width = char === "\t" ? tabWidthAt(atColumn) : 1;
        const isText = atColumn - column >= indentation;
        const keepsWidth = isText || char !== "\t" || tabWidthAt(atColumn + shift) === width;

        moved += keepsWidth ? char : " ".repeat(width);
        atColumn += width;
    }

    return moved;
}

/**
 * Finds the last line the viewer reads as part of an item. The item's syntax
 * node ends there, except for an item whose first line is empty: Markdown's
 * parser lets it run over a later indented line, where CommonMark ends such
 * an item when the line right after the marker line is blank (§5.2, "a list
 * item can begin with at most one blank line"), so nothing after it is in the
 * item. Once the item has content, later blank lines do not end it. A line is
 * blank here when only the marks of the quotes around the list, which are not
 * the item's, and whitespace are left: a `>` line that the item itself holds
 * is not blank.
 *
 * @param state - The state before the renumbering.
 * @param item - The item's syntax node.
 * @param startsEmpty - Whether nothing follows the item's marker on its first line.
 * @returns The number of the item's last line.
 */
function itemLastLine(state: EditorState, item: SyntaxNode, startsEmpty: boolean): number {
    const first = state.doc.lineAt(item.from).number;
    const last = state.doc.lineAt(item.to).number;

    if (!startsEmpty || first === last) {
        return last;
    }

    let quotes = 0;

    for (let node: SyntaxNode | null = item.parent; node; node = node.parent) {
        if (node.name === "Blockquote") {
            quotes++;
        }
    }

    const next = state.doc.line(first + 1).text;
    const outerMarks = new RegExp(`^(?:[ \\t]*>){${quotes}}`);
    const nextIsBlank = next.replace(outerMarks, "").trim() === "";

    return nextIsBlank ? first : last;
}

/**
 * Finds how many columns of a line's whitespace past the item's content
 * column are indentation, as opposed to the text of a code line. The text of
 * a code line starts at a fixed column: after a fence's own indentation (the
 * opening fence line's whitespace past the content column) or after the four
 * columns of an indented code block, where the block's node starts. A tab in that text is part of the code,
 * so it is not rewritten when the content column moves; a tab in
 * indentation is, as it reads as the columns it spans. Any other line,
 * and the fence lines themselves, are all indentation.
 *
 * @param state - The state before the renumbering.
 * @param line - The line.
 * @param column - The item's content column.
 * @returns The columns of indentation; `Infinity` when the line holds no code text.
 */
function indentationColumns(state: EditorState, line: Line, column: number): number {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.to, -1); node; node = node.parent) {
        if (node.name === "CodeBlock") {
            // The block's text starts at the column its node starts at, which in a nested item is past the outer item's content column.
            const first = state.doc.lineAt(node.from);

            return countColumn(first.text, MARKDOWN_TAB_STOP, node.from - first.from) - column;
        }

        if (node.name !== "FencedCode") {
            continue;
        }

        const opening = state.doc.lineAt(node.from);
        const closes = node.lastChild?.name === "CodeMark" && node.lastChild.from > node.from;
        const isFenceLine = line.number === opening.number || (closes && line.number === state.doc.lineAt(node.to).number);

        return isFenceLine ? Infinity : fenceIndentation(opening.text, column);
    }

    return Infinity;
}

/**
 * The columns of whitespace an opening fence line holds past the content
 * column, which Markdown removes from each code line of the fence.
 *
 * @param text - The opening fence line.
 * @param column - The item's content column.
 * @returns The columns, or 0 when the line does not reach the content column through whitespace and quote markers.
 */
function fenceIndentation(text: string, column: number): number {
    let at = 0;
    let atColumn = 0;

    while (atColumn < column && at < text.length && BEFORE_CONTENT.test(text.charAt(at))) {
        atColumn += text.charAt(at) === "\t" ? tabWidthAt(atColumn) : 1;
        at++;
    }

    const textStart = at + text.slice(at).search(/[^ \t]|$/);

    return countColumn(text, MARKDOWN_TAB_STOP, textStart) - atColumn;
}

/**
 * Lists the changes that move the later lines of an item whose number a
 * renumbering widened or narrowed, so they stay at the item's content column.
 *
 * @param state - The state before the renumbering.
 * @param after - The document after it.
 * @param mapPos - Maps a position of the state's document to `after`.
 * @param mark - The item's list marker, in the state before.
 * @returns The changes, by position in `after`; empty when the content column did not move.
 */
function itemLineShifts(state: EditorState, after: Text, mapPos: (pos: number) => number, mark: SyntaxNode): ChangeSpec[] {
    const item = mark.parent!;
    const first = state.doc.lineAt(mark.from);
    const firstAfter = after.lineAt(mapPos(mark.from));
    const column = itemContentColumn(first.text, mark.to - first.from);
    const shift = itemContentColumn(firstAfter.text, mapPos(mark.to) - firstAfter.from) - column;
    const changes: ChangeSpec[] = [];

    if (shift === 0) {
        return changes;
    }

    const last = itemLastLine(state, item, first.text.slice(mark.to - first.from).trim() === "");

    for (let number = first.number + 1; number <= last; number++) {
        const line = state.doc.line(number);
        const change = lineShift(line.text, column, shift, indentationColumns(state, line, column));

        if (change !== null) {
            changes.push({ from: mapPos(line.from + change.from), to: mapPos(line.from + change.to), insert: change.insert });
        }
    }

    return changes;
}

/**
 * Makes `@codemirror/lang-markdown`'s Enter keep the content of the ordered
 * list items it renumbers. Enter that inserts an item renumbers the items
 * below it, and Enter that lifts an empty item out of its list renumbers the
 * rest; a number that gains or loses a digit (`9.` to `10.`) moves the
 * item's content column, and the command leaves the item's later lines where
 * they were. A later paragraph indented to the old column then reads outside
 * the item, or as indented code. The wrapped command moves those lines with
 * the column (see lineShift), in the same transaction, so Enter is still one
 * undo step. The WYSIWYG editor's save does the same: an item whose number
 * changes width is written again in the standard form, its children at the
 * new column.
 *
 * In a read-only editor the command runs as it is.
 *
 * @internal Used by `languages.ts` only, not part of the public API surface.
 *
 * @param command - The Enter command, `insertNewlineContinueMarkup` as atMarkdownTabStops wraps it.
 * @returns The command, for an Enter key binding.
 */
export function keepingRenumberedItemContent(command: StateCommand): StateCommand {
    return (target) => {
        const { state, dispatch } = target;

        if (state.readOnly) {
            return command(target);
        }

        const done = transactionOf(command, state);

        if (done === null) {
            return false;
        }

        const mapPos = (pos: number): number => done.changes.mapPos(pos);
        const shifts: ChangeSpec[] = [];

        done.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            const renumbers = inserted.length !== toA - fromA && DIGITS.test(inserted.toString()) && DIGITS.test(state.sliceDoc(fromA, toA));
            const mark = renumbers ? renumberedMark(state, fromA, toA) : null;

            if (mark !== null) {
                shifts.push(...itemLineShifts(state, done.newDoc, mapPos, mark));
            }
        });

        const shifting = ChangeSet.of(shifts, done.newDoc.length);

        dispatch(state.update({
            changes:        done.changes.compose(shifting),
            selection:      done.newSelection.map(shifting),
            scrollIntoView: true,
            userEvent:      done.annotation(Transaction.userEvent),
        }));

        return true;
    };
}
