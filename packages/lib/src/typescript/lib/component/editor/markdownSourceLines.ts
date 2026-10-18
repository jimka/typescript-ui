// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { lineEndAt } from "~/component/display/markdownAttributes.js";
import type { MarkdownSourceEdit, MarkdownSourceTransform } from "~/component/editor/markdownSourceEdits.js";
import { analyzeMarkdownSource, entryFormat, entryKey } from "~/component/editor/markdownSourceTokens.js";
import type { SourceAnalysis, SourceBlockNode } from "~/component/editor/markdownSourceTokens.js";

// The source-mode line commands that stay text surgery — insert a table and
// insert a paragraph beside a block — read the document's blocks from the
// viewer's own tokens (see `markdownSourceTokens.ts`) and check every edit by
// lexing its result: the document must read, to the viewer, as the same
// visible text in the same blocks, with the one table or paragraph more. The
// other source-mode commands run through the WYSIWYG model instead (see
// `markdownSourceModel.ts`).

/** One source line: its start, and its end before its own newline. */
interface SourceLine {
    readonly start: number;
    readonly end:   number;
}

/** The block token types that hold other blocks rather than text. */
const CONTAINER_NODE_TYPES: ReadonlySet<string> = new Set(["blockquote", "list", "list_item", "mdblock", "column"]);

/** The top-level block types {@link paragraphAroundBlockSource} steps out of: a quote, a list, a table and a code block. */
const SURROUNDED_BLOCK_TYPES: ReadonlySet<string> = new Set(["blockquote", "list", "mdtable", "code"]);

/** The block signatures that open a container in the analysis's entries; each is closed by a `/`-prefixed one. */
const OPENING_SIGNATURE = /^(?:quote|list:|item:|fence:|column|table:|row|cell:)/;

/** The block signatures of a block holding inline text: a paragraph, a list item's text and a heading. */
const TEXT_SIGNATURE = /^(?:paragraph|text|h[1-6])$/;

/**
 * A line's container syntax alone: quote markers, list markers and
 * whitespace. A line holding only this belongs to its containers; a line
 * holding more and no block's text is source the viewer does not show.
 */
const CONTAINER_SYNTAX_ONLY = /^(?:[ \t>]|(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$))*$/;

/**
 * A GFM delimiter cell with no alignment and no width — every column
 * `tableSource` builds. Spelled out here rather than produced by
 * `markdownSerializer.ts`'s `formatDelimiterRow`, which lives in a Lexical
 * module this leaf module must not import; the test suite pins the row built
 * from it byte-for-byte against that helper's output.
 */
const UNALIGNED_DELIMITER_CELL = "---";

/** The character a paragraph-around edit is checked with, typed where it leaves the caret. */
const PROBE_CHARACTER = "x";

// ---------------------------------------------------------------- reading the result

/**
 * One visible step of a document, as a line command compares documents: a
 * character (or atom) of a block's text with its format, or a block holding
 * no text that still means something — a code block, an HTML block, a
 * definition, a thematic break, a task checkbox.
 */
interface LeafView {
    /** The leaf's key with its format, or the text-less block's signature. */
    readonly key:    string;
    /** The signatures of the containers around it, outermost first, then its own block's kind for a leaf. */
    readonly path:   readonly string[];
    /** Which block it sits in: two leaves share a block exactly when this is equal. */
    readonly block:  number;
    /** Its index in the analysis's entries. */
    readonly entry:  number;
    /** Its source offset, `-1` when it is not located. */
    readonly offset: number;
}

/** What a line command expects one leaf of its result to be. */
interface ExpectedLeaf {
    readonly key:   string;
    readonly path:  readonly string[];
    /** Leaves expected in one block share this. */
    readonly group: string;
}

/**
 * A stretch of the result whose leaves are not predicted one by one — a code
 * block's text turned into Markdown — only where they sit.
 */
interface WildcardRange {
    readonly from: number;
    readonly to:   number;
    readonly path: readonly string[];
}

/**
 * Reads a document as a line command compares it: every visible leaf and
 * meaningful text-less block, in order, with the containers around it and
 * the block it sits in. Whitespace and hard line breaks are left out, since
 * moving line and block boundaries changes them; a list's start and
 * looseness, and whether a list item's text is a paragraph, are left out of
 * the path, since splitting a list changes them.
 *
 * @param analysis - The document's analysis.
 * @returns Its leaves.
 */
function readLeaves(analysis: SourceAnalysis): LeafView[] {
    const nodeAt = nodesByEntry(analysis);
    const leaves: LeafView[] = [];
    const stack: string[] = [];
    let textBlock = "";
    let block = 0;

    analysis.entries.forEach((entry, index) => {
        if (entry.kind === "leaf") {
            const isTaskMarker = entry.key.startsWith("checkbox:");

            if (isTaskMarker) {
                // A loose item's marker is an inline leaf of its paragraph, a tight item's a block of its own: both read
                // as that block. Blocks are counted in whole numbers, so half a block back is a number no other leaf
                // has: the marker shares its block with nothing, as the tight shape reads.
                leaves.push({ key: entry.key, path: [...stack], block: block - 0.5, entry: index, offset: entry.start });
            } else if (entry.key !== "br" && !/^t\s$/.test(entry.key)) {
                leaves.push({ key: entryKey(entry, entryFormat(entry)), path: [...stack, textBlock], block, entry: index, offset: entry.start });
            }

            return;
        }

        block += 1;
        textBlock = "";

        if (entry.key.startsWith("/")) {
            stack.pop();
        } else if (OPENING_SIGNATURE.test(entry.key)) {
            stack.push(entry.key.startsWith("list:") ? entry.key.split(":").slice(0, 2).join(":") : entry.key);
        } else if (TEXT_SIGNATURE.test(entry.key)) {
            textBlock = entry.key.startsWith("h") ? entry.key : "p";
        } else {
            leaves.push({ key: entry.key.replace(/\n+$/, ""), path: [...stack], block, entry: index, offset: nodeAt.get(index)?.start ?? -1 });
        }
    });

    return leaves;
}

/**
 * Every block node of a document, by the index of its signature entry.
 *
 * @param analysis - The document's analysis.
 * @returns The map.
 */
function nodesByEntry(analysis: SourceAnalysis): Map<number, SourceBlockNode> {
    const map = new Map<number, SourceBlockNode>();

    for (const node of allNodes(analysis.tree)) {
        map.set(node.entryStart, node);
    }

    return map;
}

/**
 * Every node of a block tree, depth first, in document order.
 *
 * @param nodes - The tree's top-level nodes.
 * @returns The nodes.
 */
function allNodes(nodes: readonly SourceBlockNode[]): SourceBlockNode[] {
    return nodes.flatMap((node) => [node, ...allNodes(node.children)]);
}

/**
 * Whether an edit's result reads as `expected`: the same leaves in the same
 * order, each with the expected containers, and two neighbouring leaves in
 * one block exactly when they are expected in one. Leaves inside a wildcard
 * range only need its path.
 *
 * @param text - The pre-edit text.
 * @param edit - The edit.
 * @param expected - The leaves the result must read as, wildcard ranges' leaves left out.
 * @param wildcards - Ranges of the result, in its own offsets, whose leaves are not predicted.
 * @returns Whether it does.
 */
function readsAsExpected(text: string, edit: MarkdownSourceEdit, expected: readonly ExpectedLeaf[], wildcards: readonly WildcardRange[]): boolean {
    const after = analyzeMarkdownSource(text.slice(0, edit.from) + edit.insert + text.slice(edit.to));
    const actual: LeafView[] = [];

    for (const leaf of readLeaves(after)) {
        const wildcard = wildcards.find((range) => range.from <= leaf.offset && leaf.offset < range.to);

        if (wildcard === undefined) {
            actual.push(leaf);
        } else if (!samePath(leaf.path, wildcard.path)) {
            return false;
        }
    }

    return actual.length === expected.length && actual.every((leaf, index) => {
        const want = expected[index]!;
        const joined = index > 0 && leaf.block === actual[index - 1]!.block;

        return leaf.key === want.key && samePath(leaf.path, want.path)
            && (index === 0 || joined === (want.group === expected[index - 1]!.group));
    });
}

/**
 * Whether two paths are equal.
 *
 * @param a - One path.
 * @param b - The other.
 * @returns Whether they are.
 */
function samePath(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

/**
 * The leaves a document is expected to keep: each as it is, its group its
 * own block, unless `change` says what it becomes.
 *
 * @param leaves - The document's leaves.
 * @param change - What a leaf becomes (one leaf or several), `null` to keep it, `undefined` to drop it.
 * @returns The expected leaves.
 */
function expectLeaves(leaves: readonly LeafView[], change: (leaf: LeafView) => ExpectedLeaf | readonly ExpectedLeaf[] | null | undefined): ExpectedLeaf[] {
    const expected: ExpectedLeaf[] = [];

    for (const leaf of leaves) {
        const changed = change(leaf);

        if (changed === null) {
            expected.push({ key: leaf.key, path: leaf.path, group: `o${leaf.block}` });
        } else if (changed !== undefined) {
            expected.push(...(Array.isArray(changed) ? changed as readonly ExpectedLeaf[] : [changed as ExpectedLeaf]));
        }
    }

    return expected;
}

// ---------------------------------------------------------------- reading the selection

/**
 * The start of the line holding `offset`.
 *
 * @param text - The full document text.
 * @param offset - A 0-based offset.
 * @returns The line's start.
 */
function lineStartAt(text: string, offset: number): number {
    // At the document start there is no line before: `lastIndexOf("\n", -1)` would find a newline at 0.
    return offset <= 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1;
}

/**
 * Whether a line is blank — whitespace only.
 *
 * @param line - The line.
 * @returns Whether it is.
 */
function isBlank(line: string): boolean {
    return line.trim() === "";
}

/**
 * The lines from the one holding `from` to the one holding `to`.
 *
 * @param text - The full document text.
 * @param from - 0-based start of the range.
 * @param to - 0-based end of the range.
 * @returns The lines.
 */
function linesOf(text: string, from: number, to: number): SourceLine[] {
    const lines: SourceLine[] = [];
    const last = lineStartAt(text, to);

    for (let start = lineStartAt(text, from); start <= last; start = lineEndAt(text, start) + 1) {
        lines.push({ start, end: lineEndAt(text, start) });
    }

    return lines;
}

/**
 * The leaf blocks of a document — every located block holding no other block.
 *
 * @param analysis - The document's analysis.
 * @returns The leaves, in document order.
 */
function leafNodes(analysis: SourceAnalysis): SourceBlockNode[] {
    return allNodes(analysis.tree).filter((node) => !CONTAINER_NODE_TYPES.has(node.type));
}

// ---------------------------------------------------------------- table and paragraph around

/**
 * The line a table goes above, for a caret at `from`: the first line of the
 * block holding the caret's line, climbing to the quote or list around it
 * while the block is that container's first; a blank line itself when the
 * caret is on one.
 *
 * @param analysis - The document's analysis.
 * @param from - The caret.
 * @returns The line's start, or `null` when the climb stops inside a quote or
 *   list item's content (a table written at column 0 there would split it,
 *   and the WYSIWYG editor holds no table there) or the caret's line holds
 *   source no block holds.
 */
function tableInsertionLine(analysis: SourceAnalysis, from: number): number | null {
    const text = analysis.text;
    const line = linesOf(text, from, from)[0]!;
    const leaves = leafNodes(analysis);
    let node = leaves.find((leaf) => leaf.start !== -1 && lineStartAt(text, leaf.start) <= line.start
        && line.start <= lineStartAt(text, Math.max(leaf.start, leaf.end - 1)));

    if (node === undefined) {
        return CONTAINER_SYNTAX_ONLY.test(text.slice(line.start, line.end)) ? line.start : null;
    }

    while (node.parent !== null && node.parent.type !== "column" && node.parent.children[0] === node) {
        node = node.parent;
    }

    const holder = node.type === "list_item" ? node.parent!.parent : node.parent;

    return holder === null || holder.type === "column" ? lineStartAt(text, node.start) : null;
}

/**
 * Builds the table-insertion transform: above the block holding the caret's
 * line — a paragraph whole, lazy lines included, a code block, HTML block or
 * table whole, and the quote or list around it when the block is that
 * container's first, so the table never splits a block — inserts a blank
 * separator line (unless the line above the insertion point is already
 * blank, or the table lands at the document start), the header row, the
 * delimiter row (byte-for-byte what `markdownSerializer.ts`'s
 * `formatDelimiterRow` emits for `columns` unaligned, unsized columns),
 * `rows - 1` body rows, and a trailing blank line. The caret lands in the
 * first header cell. The result must read as the same blocks with one more
 * table. Declines (`null`) inside a quote or list item's content past its
 * first block (a table written at column 0 there splits it, and the WYSIWYG
 * editor holds no table inside an item), and on a line of source the viewer
 * does not show.
 *
 * @param rows - The number of rows, including the header row.
 * @param columns - The number of columns.
 * @returns The transform.
 */
export function tableSource(rows: number, columns: number): MarkdownSourceTransform {
    return (text, from) => {
        const analysis = analyzeMarkdownSource(text);
        const start = tableInsertionLine(analysis, from);

        if (start === null) {
            return null;
        }

        // The separator goes ABOVE the table, so what decides it is the line
        // PRECEDING the insertion point — not the caret's own line, which the
        // insert pushes below the table. `above` ends with a newline unless the
        // table lands at the document start, where no separator is wanted.
        const above = text.slice(0, start);
        const previousLine = above.slice(0, -1).split("\n").pop() ?? "";
        const separatorNeeded = above !== "" && previousLine.trim() !== "";

        const emptyRow = "| " + Array.from({ length: columns }, () => "").join(" | ") + " |";
        const delimiterRow = "| " + Array.from({ length: columns }, () => UNALIGNED_DELIMITER_CELL).join(" | ") + " |";
        const bodyRows = Array.from({ length: rows - 1 }, () => emptyRow);
        const tableText = [emptyRow, delimiterRow, ...bodyRows].join("\n");

        const prefix = separatorNeeded ? "\n" : "";
        const insert = prefix + tableText + "\n\n";
        const caretOffset = prefix.length + 2; // "| " into the first header cell
        const edit = { from: start, to: start, insert, selection: { from: start + caretOffset, to: start + caretOffset } };

        return addsOneTable(analysis, edit) ? edit : null;
    };
}

/**
 * Whether a table insertion's result reads as the document did, with one
 * more table: the same leaves in the same blocks and containers.
 *
 * @param analysis - The pre-edit document's analysis.
 * @param edit - The insertion.
 * @returns Whether it does.
 */
function addsOneTable(analysis: SourceAnalysis, edit: MarkdownSourceEdit): boolean {
    const text = analysis.text;
    const tables = (entries: SourceAnalysis["entries"]): number => entries.filter((entry) => entry.key.startsWith("table:")).length;
    const before = tables(analysis.entries);
    const expected = expectLeaves(readLeaves(analysis), () => null);

    if (!readsAsExpected(text, edit, expected, [])) {
        return false;
    }

    return tables(analyzeMarkdownSource(text.slice(0, edit.from) + edit.insert + text.slice(edit.to)).entries) === before + 1;
}

/**
 * Builds the paragraph-around-block transform: finds the top-level
 * blockquote, list, table or code block whose source holds the caret's line,
 * read from the viewer's own tokens, and inserts a new line separated from it
 * by a blank line, leaving the caret on that new line.
 *
 * Two newlines, not one: a single newline leaves the caret on a line directly
 * adjacent to the block, which Markdown reads as a lazy continuation of it —
 * text typed there re-parses back INTO the quote, list or table instead of
 * becoming the paragraph outside it this command exists to make. Before a
 * block whose line above holds text, a third newline sets the new line apart
 * from that text too. The edit is checked by lexing it with a character typed
 * at the caret: that character must read as a paragraph of its own with
 * nothing else changed — so after a code block left unclosed, which runs to
 * the document's end, the command declines.
 *
 * @param after - Whether to insert after (`true`) or before (`false`) the block.
 * @returns The transform.
 */
export function paragraphAroundBlockSource(after: boolean): MarkdownSourceTransform {
    return (text, from) => {
        const analysis = analyzeMarkdownSource(text);
        const lineStart = lineStartAt(text, from);
        const lineEnd = lineEndAt(text, from);
        const block = analysis.tree
            .find((candidate) => SURROUNDED_BLOCK_TYPES.has(candidate.type) && candidate.start !== -1
                && candidate.start <= lineEnd && lineStart <= candidate.end);

        if (block === undefined) {
            return null;
        }

        const at = after ? block.end : lineStartAt(text, block.start);
        const textAbove = !after && at > 0 && !isBlank(text.slice(lineStartAt(text, at - 1), at - 1));
        const insert = textAbove ? "\n\n\n" : "\n\n";
        // After: past both newlines, onto the new line below the blank one.
        // Before: on the line the blank one below separates from the block,
        // one line further down when a blank line above separates it from text.
        const caret = after ? at + 2 : at + (textAbove ? 1 : 0);
        const edit = { from: at, to: at, insert, selection: { from: caret, to: caret } };

        return opensOwnParagraph(analysis, edit, block, after) ? edit : null;
    };
}

/**
 * Whether a character typed at a paragraph-around edit's caret reads as a
 * paragraph of its own, right before or after the block, with every other
 * leaf as it was.
 *
 * @param analysis - The pre-edit document's analysis.
 * @param edit - The edit.
 * @param block - The block stepped out of.
 * @param after - Whether the new line follows the block.
 * @returns Whether it does.
 */
function opensOwnParagraph(analysis: SourceAnalysis, edit: MarkdownSourceEdit, block: SourceBlockNode, after: boolean): boolean {
    const text = analysis.text;
    const inserted = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
    const caret = edit.selection.from;
    const typed = { from: caret, to: caret, insert: PROBE_CHARACTER, selection: edit.selection };
    const leaves = readLeaves(analysis);
    const expected = expectLeaves(leaves, () => null);
    const index = after
        ? leaves.filter((leaf) => leaf.entry < block.entryEnd).length
        : leaves.filter((leaf) => leaf.entry < block.entryStart).length;

    expected.splice(index, 0, { key: `t${PROBE_CHARACTER}|||`, path: ["p"], group: "probe" });

    return readsAsExpected(inserted, typed, expected, []);
}
