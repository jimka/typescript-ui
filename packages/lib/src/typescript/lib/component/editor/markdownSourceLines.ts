// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Tokens } from "marked";
import { lineEndAt } from "~/component/display/markdownAttributes.js";
import type { MarkdownSourceEdit, MarkdownSourceTransform } from "~/component/editor/markdownSourceEdits.js";
import { analyzeMarkdownSource, entryFormat, entryKey } from "~/component/editor/markdownSourceTokens.js";
import type { SourceAnalysis, SourceBlockNode } from "~/component/editor/markdownSourceTokens.js";

// The source-mode line commands — block type, list toggles, code fence,
// table and paragraph-around-block — read the document's blocks from the
// viewer's own tokens (see `markdownSourceTokens.ts`) and check every edit by
// lexing its result. A command acts on whole blocks: the paragraphs,
// headings, list item texts and code blocks its selection's lines touch. A
// task item's marker goes with its item's text. A command lifts each block
// out of the quotes and list items around it to the top level (or to its
// `:::` column), the level the WYSIWYG editor holds a heading, quote, list or
// code block at, and splits those containers around it: what follows the
// block inside them stays in them, each container re-opened by its own
// marker on its first line after the block. The result must then read, to
// the viewer, as the same visible text in the same blocks — every leaf with
// its format, its quotes, list items and columns, and its block boundaries —
// except that the lifted blocks are the intended new blocks; otherwise the
// command tries the same edit with the lifted blocks set apart by blank lines
// and with their first character escaped, and declines when no form reads
// back as intended.

/** One source line: its start, and its end before its own newline. */
interface SourceLine {
    readonly start: number;
    readonly end:   number;
}

/** The block token types that hold other blocks rather than text. */
const CONTAINER_NODE_TYPES: ReadonlySet<string> = new Set(["blockquote", "list", "list_item", "mdblock", "column"]);

/** The block token types holding a run of inline text a line command converts: a paragraph, a heading, a tight list item's text. */
const TEXT_NODE_TYPES: ReadonlySet<string> = new Set(["paragraph", "heading", "text"]);

/** The containers a block is lifted out of: a quote and a list item. */
const LIFTED_NODE_TYPES: ReadonlySet<string> = new Set(["blockquote", "list_item"]);

/**
 * The leaf block types that are no target of their own when a line command's
 * selection touches them: a thematic break, which holds no text, and a task
 * item's checkbox, which goes with its item's text: a command that converts
 * the text carries the marker.
 */
const SKIPPED_NODE_TYPES: ReadonlySet<string> = new Set(["hr", "checkbox"]);

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

/** A quote marker opening a line: up to three spaces, `>` and the one space or tab after it that belongs to it. */
const QUOTE_MARKER = /^ {0,3}>[ \t]?/;

/** A list item marker opening its first line: up to three spaces, then the bullet or number and its delimiter. */
const ITEM_MARKER = /^( {0,3})([-+*]|\d{1,9}[.)])/;

/**
 * The most spaces after a list marker that still belong to the marker: with
 * more, the item's text is indented code and only one space counts
 * (CommonMark's list item rule, which `marked` follows).
 */
const MAX_MARKER_SPACING = 4;

/**
 * The characters that can open a block when they start a line: a heading,
 * a quote, a list item, a setext underline or thematic break, a code fence,
 * an HTML block, a table row, a link reference definition, a `:::` fence. A
 * lifted line starting with one is tried again with it escaped.
 */
const BLOCK_START_CHARACTERS: ReadonlySet<string> = new Set(["#", ">", "-", "+", "*", "=", "_", "~", "`", "<", "|", "[", ":"]);

/** An ordered list marker's number and delimiter opening a line, whose delimiter an escape keeps text. */
const ORDERED_MARKER_START = /^(\d{1,9})([.)])/;

/**
 * The shortest code fence: three backticks, CommonMark's minimum. A longer
 * one is written when the code holds a line opening with that many.
 */
const MIN_FENCE_LENGTH = 3;

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
 * The part of a leaf's path a lifted block keeps: the `:::` fence and column
 * around it, which a line command never leaves.
 *
 * @param path - The leaf's path.
 * @returns The path up to and including its innermost column, `[]` outside one.
 */
function columnPath(path: readonly string[]): string[] {
    return path.slice(0, path.lastIndexOf("column") + 1);
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
    return text.lastIndexOf("\n", offset - 1) + 1;
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
 * The lines a located block spans.
 *
 * @param text - The full document text.
 * @param node - The block.
 * @returns Its lines.
 */
function nodeLines(text: string, node: SourceBlockNode): SourceLine[] {
    return linesOf(text, node.start, Math.max(node.start, node.end - 1));
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

/**
 * The quotes and list items a block is lifted out of, outermost first: its
 * ancestors of those kinds inside its innermost `:::` column.
 *
 * @param node - The block.
 * @returns The containers, or `null` when one is not located or one holds
 *   the column (the block cannot leave it while staying in the column).
 */
function liftedContainers(node: SourceBlockNode): SourceBlockNode[] | null {
    const containers: SourceBlockNode[] = [];

    for (let parent = node.parent; parent !== null; parent = parent.parent) {
        if (parent.type === "column") {
            return hasLiftedAncestor(parent) ? null : containers;
        }

        if (LIFTED_NODE_TYPES.has(parent.type)) {
            if (parent.start === -1) {
                return null;
            }

            containers.unshift(parent);
        }
    }

    return containers;
}

/**
 * Whether a quote or list item holds a node.
 *
 * @param node - The node.
 * @returns Whether one does.
 */
function hasLiftedAncestor(node: SourceBlockNode): boolean {
    for (let parent = node.parent; parent !== null; parent = parent.parent) {
        if (LIFTED_NODE_TYPES.has(parent.type)) {
            return true;
        }
    }

    return false;
}

/** The blocks a line command's selection touches. */
interface LineTargets {
    /** The selection's whole lines. */
    readonly lines:   SourceLine[];
    /** The text blocks (and, when allowed, code blocks) to convert, in document order. */
    readonly targets: SourceBlockNode[];
}

/**
 * Reads the blocks a line command converts: the paragraphs, headings and list
 * item texts — whole, lazy lines and a setext underline included — that the
 * selection's lines touch, and with `code` set a fenced code block whose lines
 * are all selected and that sits in no quote or list item. Declines (`null`)
 * when a selected line holds part of any other block (indented code, a code
 * block not selected whole, a table, an HTML block, a definition, a block
 * whose source was not found, a block in a `:::` column inside a quote or
 * list item, which it could not leave) or source no block holds — a `:::`
 * fence or `|||` line, or text the viewer does not show, such as a repeated
 * definition — and when
 * nothing is left to convert. A thematic break is left alone; a task
 * checkbox is no target of its own and goes with its item's text.
 *
 * @param analysis - The document's analysis.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @param code - Whether a fenced code block selected whole converts.
 * @returns The targets, or `null`.
 */
function readLineTargets(analysis: SourceAnalysis, from: number, to: number, code: boolean): LineTargets | null {
    const text = analysis.text;
    const lines = linesOf(text, from, to);
    const leaves = leafNodes(analysis);
    const first = lines[0]!.start;
    const last = lines[lines.length - 1]!.end;

    if (lines.some((line) => !lineIsHeld(text, line, leaves))) {
        return null;
    }

    const targets: SourceBlockNode[] = [];

    for (const leaf of leaves) {
        if (leaf.start === -1 || leaf.start > last || lineEndAt(text, Math.max(leaf.start, leaf.end - 1)) < first) {
            continue;
        }

        const kind = classifyTouchedBlock(text, leaf, first, last, code);

        if (kind === "decline") {
            return null;
        }

        if (kind === "target") {
            targets.push(leaf);
        }
    }

    return targets.length === 0 ? null : { lines, targets };
}

/**
 * Whether a line is held by a located block, is blank, or holds container
 * syntax alone — anything else is source no token stands for.
 *
 * @param text - The full document text.
 * @param line - The line.
 * @param leaves - The document's leaf blocks.
 * @returns Whether it is.
 */
function lineIsHeld(text: string, line: SourceLine, leaves: readonly SourceBlockNode[]): boolean {
    const content = text.slice(line.start, line.end);

    if (CONTAINER_SYNTAX_ONLY.test(content)) {
        return true;
    }

    return leaves.some((leaf) => leaf.start !== -1 && lineStartAt(text, leaf.start) <= line.start
        && line.start <= lineStartAt(text, Math.max(leaf.start, leaf.end - 1)));
}

/**
 * What a line command does with a leaf block its selection touches.
 *
 * @param text - The full document text.
 * @param leaf - The block.
 * @param first - The selection's first line start.
 * @param last - The selection's last line end.
 * @param code - Whether a fenced code block selected whole converts.
 * @returns `target` to convert it, `skip` to leave it, `decline` to refuse the command.
 */
function classifyTouchedBlock(text: string, leaf: SourceBlockNode, first: number, last: number, code: boolean): "target" | "skip" | "decline" {
    if (TEXT_NODE_TYPES.has(leaf.type)) {
        return liftedContainers(leaf) === null ? "decline" : "target";
    }

    if (SKIPPED_NODE_TYPES.has(leaf.type)) {
        return "skip";
    }

    const fenced = leaf.type === "code" && (leaf.token as Tokens.Code).codeBlockStyle !== "indented";
    const whole = first <= lineStartAt(text, leaf.start) && lineEndAt(text, leaf.end - 1) <= last;

    return code && fenced && whole && liftedContainers(leaf)?.length === 0 ? "target" : "decline";
}

/**
 * The text of each line of a block a line command converts: its token's
 * text — a paragraph's or list item text's lines without the quote and list
 * prefixes `marked` strips, a heading's text without its `#`s or setext
 * underline, a code block's code.
 *
 * @param node - The block.
 * @returns Its lines.
 */
function blockTextLines(node: SourceBlockNode): string[] {
    const text = (node.token as { text: string }).text;

    return (node.type === "code" ? text : text.replace(/\n+$/, "")).split("\n");
}

/** A task item's marker, as the item's text block carries it. */
interface TaskMarker {
    /** The marker as written, with the space after it: `[ ] `, `[x] ` or `[X] `. */
    readonly raw:   string;
    /** The index of the marker's entry in the analysis. */
    readonly entry: number;
    /** Whether the marker is a block of its own before the text (a tight item), not the start of the text (a loose one). */
    readonly own:   boolean;
}

/** A task marker opening a loose item's first paragraph. */
const TASK_MARKER_START = /^\[[ xX]\] /;

/** A leaf that is a task marker; the group is the character between its brackets. */
const TASK_MARKER_LEAF = /^checkbox:\[([ xX])\]/;

/**
 * The marker of the task item a block is the text of.
 *
 * @param node - The block.
 * @returns The marker, or `null` for a block that is no task item's text.
 */
function taskMarkerOf(node: SourceBlockNode): TaskMarker | null {
    const item = node.parent;

    if (item?.type !== "list_item" || (item.token as Tokens.ListItem).task !== true) {
        return null;
    }

    const first = item.children[0]!;

    if (first.type === "checkbox") {
        return item.children[1] === node ? { raw: first.token!.raw, entry: first.entryStart, own: true } : null;
    }

    const start = TASK_MARKER_START.exec((node.token as { text: string }).text);

    return first === node && start !== null ? { raw: start[0], entry: node.entryStart + 1, own: false } : null;
}

/**
 * The first entry a target block owns: its task marker's, when the marker is
 * a block of its own before it.
 *
 * @param node - The block.
 * @returns The entry's index in the analysis.
 */
function firstEntryOf(node: SourceBlockNode): number {
    const marker = taskMarkerOf(node);

    return marker === null ? node.entryStart : Math.min(marker.entry, node.entryStart);
}

/**
 * A block's text lines ({@link blockTextLines}) with its task marker on the
 * first: as the text it shows (`\[ \] `), for a block that stops being an
 * item's text, or as it was written (`[ ] `), for an item or a code block.
 *
 * @param node - The block.
 * @param markerAs - How the marker is written.
 * @returns The lines.
 */
function textLinesOf(node: SourceBlockNode, markerAs: "text" | "written"): string[] {
    const lines = blockTextLines(node);
    const marker = node.type === "code" ? null : taskMarkerOf(node);

    if (marker === null) {
        return lines;
    }

    const rest = marker.own ? lines[0]! : lines[0]!.slice(marker.raw.length);
    const shown = markerAs === "written" ? marker.raw : marker.raw.replace("[", "\\[").replace("]", "\\]");

    return [shown + rest, ...lines.slice(1)];
}

/**
 * The text leaves a task marker reads as once it is the text it shows: its
 * brackets and, when checked, its letter. Whitespace is no leaf.
 *
 * @param leaf - The leaf.
 * @param path - The path the text leaves have.
 * @param group - The group the text leaves have.
 * @returns The leaves, or `null` for a leaf that is no task marker.
 */
function markerTextLeaves(leaf: LeafView, path: readonly string[], group: string): ExpectedLeaf[] | null {
    const marker = TASK_MARKER_LEAF.exec(leaf.key);

    if (marker === null) {
        return null;
    }

    return ["[", marker[1]!, "]"].filter((char) => char !== " ").map((char) => ({ key: `t${char}|||`, path, group }));
}

// ---------------------------------------------------------------- lifting

/** One run of whole lines a line command replaces with the lines of a lifted block. */
interface LineReplacement {
    /** The first replaced line's start. */
    readonly first: number;
    /** The last replaced line's end, before its newline. */
    readonly last:  number;
    /** The lines written in their place. */
    readonly lines: readonly string[];
    /** The blocks the replaced lines hold, whose quotes and list items the replacement leaves. */
    readonly nodes: readonly SourceBlockNode[];
}

/** A lifted edit, with where each replacement's lines landed in the result. */
interface LiftedEdit {
    readonly edit:   MarkdownSourceEdit;
    /** Each replacement's lines, as a range of the post-edit text. */
    readonly ranges: ReadonlyArray<{ from: number; to: number }>;
}

/** A list item's continuation indentation, and the marker that opens it again. */
interface ItemIndent {
    /** The columns its content sits at, past the containers around it. */
    readonly width:  number;
    /** Its marker, with the indentation before it, padded with spaces to `width`. */
    readonly opener: string;
}

/**
 * Writes replacements as top-level blocks, splitting the quotes and list items
 * around them: every line before a replacement is kept, and every line after
 * it inside those containers keeps them, each container re-opened on its
 * first line after the replacement — a quote by the `>` the line already
 * carries, a list item by its own marker in place of its indentation
 * (`- x\n  - a\n  - b`, lifting `a`, gives `- x\n## a\n- - b`). With
 * `separate`, each replacement is set apart from the lines around it by a
 * blank line.
 *
 * @param analysis - The document's analysis.
 * @param replacements - The replacements, in document order, none overlapping.
 * @param separate - Whether to set them apart by blank lines.
 * @returns The edit, or `null` when a line to keep cannot keep its containers
 *   (a lazy line where one must be re-opened, or tab indentation).
 */
function liftLines(analysis: SourceAnalysis, replacements: readonly LineReplacement[], separate: boolean): LiftedEdit | null {
    const text = analysis.text;
    const regionStart = replacements[0]!.first;
    const regionEnd = liftedRegionEnd(text, replacements);
    const closed = new Set<SourceBlockNode>();
    const indents = new Map<SourceBlockNode, ItemIndent | null>();
    const out: string[] = [];
    const ranges: Array<{ from: number; to: number }> = [];
    let length = 0;
    let blankDue = false;

    /** Appends one line to the output, tracking the output's length. */
    const emit = (line: string): void => {
        length += (out.length > 0 ? 1 : 0) + line.length;
        out.push(line);
    };

    for (let lineStart = regionStart; lineStart <= regionEnd;) {
        const replacement = replacements.find((candidate) => candidate.first === lineStart);

        if (replacement !== undefined) {
            const above = out.length > 0 ? out[out.length - 1]! : text.slice(lineStartAt(text, regionStart - 1), Math.max(regionStart - 1, 0));

            if (separate && (blankDue || (regionStart > 0 || out.length > 0) && !isBlank(above))) {
                emit("");
            }

            const from = length + (out.length > 0 ? 1 : 0);

            replacement.lines.forEach(emit);
            ranges.push({ from: regionStart + from, to: regionStart + length });
            replacement.nodes.forEach((node) => liftedContainers(node)!.forEach((container) => closed.add(container)));
            blankDue = separate;
            lineStart = replacement.last + 1;
            continue;
        }

        const lineEnd = lineEndAt(text, lineStart);
        const line = text.slice(lineStart, lineEnd);
        const kept = reopenContainers(analysis, lineStart, line, closed, indents);

        if (kept === null) {
            return null;
        }

        if (blankDue && !isBlank(line)) {
            emit("");
        }

        blankDue = false;
        emit(kept);
        lineStart = lineEnd + 1;
    }

    if (blankDue && regionEnd < text.length && !isBlank(text.slice(regionEnd + 1, lineEndAt(text, regionEnd + 1)))) {
        emit("");
    }

    const insert = out.join("\n");

    return { edit: { from: regionStart, to: regionEnd, insert, selection: { from: regionStart, to: regionStart + insert.length } }, ranges };
}

/**
 * The end of the last line a lift rewrites: the last line of the outermost
 * quote or list item around any replacement, or of the replacement itself.
 *
 * @param text - The full document text.
 * @param replacements - The replacements.
 * @returns The line end.
 */
function liftedRegionEnd(text: string, replacements: readonly LineReplacement[]): number {
    let end = 0;

    for (const replacement of replacements) {
        end = Math.max(end, replacement.last);

        for (const node of replacement.nodes) {
            const outermost = liftedContainers(node)![0];

            if (outermost !== undefined) {
                end = Math.max(end, lineEndAt(text, outermost.end - 1));
            }
        }
    }

    return end;
}

/**
 * The containers holding a line, outermost first: every located quote and
 * list item whose lines include it.
 *
 * @param analysis - The document's analysis.
 * @param lineStart - The line's start.
 * @returns The containers.
 */
function containersOfLine(analysis: SourceAnalysis, lineStart: number): SourceBlockNode[] {
    const text = analysis.text;

    return allNodes(analysis.tree).filter((node) => LIFTED_NODE_TYPES.has(node.type) && node.start !== -1
        && lineStartAt(text, node.start) <= lineStart && lineStart <= lineStartAt(text, node.end - 1));
}

/**
 * Keeps one line after a lifted block inside its containers: peels the
 * prefix each container gives the line, outermost first, and writes the
 * opener of every container the lift closed and this is the first line
 * since — its `>` for a quote, its marker for a list item — in place of that
 * container's prefix. A blank line needs no container; a line with no closed
 * container is kept as it is.
 *
 * @param analysis - The document's analysis.
 * @param lineStart - The line's start.
 * @param line - The line.
 * @param closed - The containers closed and not yet re-opened; updated.
 * @param indents - List item indentation already read; updated.
 * @returns The line to write, or `null` when a closed container cannot be
 *   re-opened on it: a lazy line (no quote marker, or less indentation than
 *   the item's) or tab indentation.
 */
function reopenContainers(
    analysis: SourceAnalysis, lineStart: number, line: string, closed: Set<SourceBlockNode>,
    indents: Map<SourceBlockNode, ItemIndent | null>,
): string | null {
    const chain = containersOfLine(analysis, lineStart);
    const deepest = chain.findLastIndex((container) => closed.has(container));

    if (deepest === -1 || isBlank(line)) {
        return line;
    }

    let written = "";
    let position = 0;

    for (const container of chain.slice(0, deepest + 1)) {
        const rest = line.slice(position);
        const segment = containerPrefix(analysis, container, rest, indents);

        if (segment === null) {
            // A lazy line or a blank rest: it continues what came before it,
            // which is only possible when no container below still waits to
            // be re-opened.
            return chain.slice(chain.indexOf(container), deepest + 1).some((pending) => closed.has(pending)) ? null : written + rest;
        }

        if (segment === undefined) {
            return null;
        }

        written += closed.has(container) ? segment.opener : rest.slice(0, segment.length);
        closed.delete(container);
        position += segment.length;
    }

    return written + line.slice(position);
}

/**
 * The list items a block is lifted out of, outermost first.
 *
 * @param node - The block.
 * @returns The items; none for a block in no list item, or one that cannot be lifted.
 */
function liftedItems(node: SourceBlockNode): SourceBlockNode[] {
    return (liftedContainers(node) ?? []).filter((container) => container.type === "list_item");
}

/**
 * The prefix one container gives a line that continues it.
 *
 * @param analysis - The document's analysis.
 * @param container - The quote or list item.
 * @param rest - The line, from where the container's prefix starts.
 * @param indents - List item indentation already read; updated.
 * @returns The prefix's length and the opener that re-opens the container;
 *   `null` when the line does not carry it (a lazy line); `undefined` when it
 *   cannot be read (tab indentation, an item marker not found).
 */
function containerPrefix(
    analysis: SourceAnalysis, container: SourceBlockNode, rest: string, indents: Map<SourceBlockNode, ItemIndent | null>,
): { length: number; opener: string } | null | undefined {
    if (container.type === "blockquote") {
        const marker = QUOTE_MARKER.exec(rest)?.[0];

        return marker === undefined ? null : { length: marker.length, opener: marker };
    }

    const indent = itemIndent(analysis, container, indents);
    const spaces = /^[ \t]*/.exec(rest)![0];

    if (indent === null || spaces.includes("\t")) {
        return undefined;
    }

    return spaces.length < indent.width || isBlank(rest) ? null : { length: indent.width, opener: indent.opener };
}

/**
 * Reads a list item's continuation indentation from its first line: the
 * columns its marker, the spaces before it and the spaces after it take past
 * the containers around it — one space after the marker when the line holds
 * nothing else or more than {@link MAX_MARKER_SPACING} follow, as `marked`
 * reads it.
 *
 * @param analysis - The document's analysis.
 * @param item - The list item.
 * @param indents - Indentation already read; updated.
 * @returns The indentation, or `null` when it cannot be read (tab
 *   indentation, a container prefix or the marker not where expected).
 */
function itemIndent(analysis: SourceAnalysis, item: SourceBlockNode, indents: Map<SourceBlockNode, ItemIndent | null>): ItemIndent | null {
    if (indents.has(item)) {
        return indents.get(item)!;
    }

    const text = analysis.text;
    const lineStart = lineStartAt(text, item.start);
    const line = text.slice(lineStart, lineEndAt(text, lineStart));
    const outer = containersOfLine(analysis, lineStart).filter((container) => container !== item && isAncestor(container, item));
    let position = 0;
    let indent: ItemIndent | null = null;

    for (const container of outer) {
        const firstLine = lineStartAt(text, container.start) === lineStart;
        const segment = firstLine && container.type === "list_item"
            ? itemIndent(analysis, container, indents)?.width
            : containerPrefix(analysis, container, line.slice(position), indents)?.length;

        if (segment === undefined) {
            position = -1;
            break;
        }

        position += segment;
    }

    const marker = position === -1 ? null : ITEM_MARKER.exec(line.slice(position));

    if (marker !== null) {
        const after = line.slice(position + marker[0].length);
        const spacing = /^ */.exec(after)![0].length;
        const lead = marker[0].length;
        const width = isBlank(after) ? lead + 1 : lead + (spacing > MAX_MARKER_SPACING ? 1 : spacing);

        indent = after.startsWith("\t") || (spacing === 0 && !isBlank(after)) ? null : { width, opener: marker[0].padEnd(width, " ") };
    }

    indents.set(item, indent);

    return indent;
}

/**
 * Whether one node holds another.
 *
 * @param ancestor - The possible holder.
 * @param node - The node.
 * @returns Whether it does.
 */
function isAncestor(ancestor: SourceBlockNode, node: SourceBlockNode): boolean {
    for (let parent = node.parent; parent !== null; parent = parent.parent) {
        if (parent === ancestor) {
            return true;
        }
    }

    return false;
}

/**
 * Escapes the character a lifted line opens with when it could open a block
 * there — or an ordered list marker's delimiter — so the line stays text.
 *
 * @param line - The line, its new prefix already written.
 * @param prefix - The prefix written onto it.
 * @returns The line, escaped where needed.
 */
function escapeBlockStart(line: string, prefix: string): string {
    const content = line.slice(prefix.length);
    const lead = /^[ \t]*/.exec(content)![0];
    const body = content.slice(lead.length);
    const ordered = ORDERED_MARKER_START.exec(body);

    if (ordered !== null) {
        return prefix + lead + ordered[1]! + "\\" + body.slice(ordered[1]!.length);
    }

    return BLOCK_START_CHARACTERS.has(body.charAt(0)) ? prefix + lead + "\\" + body : line;
}

/**
 * Tries a line command's edit in its forms, in order — as written, with the
 * lifted blocks set apart by blank lines, then each with the lifted lines'
 * opening block characters escaped — and returns the first whose result
 * reads as expected.
 *
 * @param analysis - The document's analysis.
 * @param build - Builds the replacements, given whether to escape.
 * @param expected - The leaves the result must read as.
 * @param wildcardPaths - For each replacement, the path its leaves must have
 *   when they are not predicted one by one, `null` when they are.
 * @param escapes - Whether the escaped forms are worth trying.
 * @returns The edit, or `null` when no form reads as expected.
 */
function firstReadingEdit(
    analysis: SourceAnalysis, build: (escape: boolean) => LineReplacement[], expected: readonly ExpectedLeaf[],
    wildcardPaths: ReadonlyArray<readonly string[] | null>, escapes: boolean,
): MarkdownSourceEdit | null {
    const forms = escapes ? [[false, false], [true, false], [false, true], [true, true]] : [[false, false], [true, false]];

    for (const [separate, escape] of forms) {
        const lifted = liftLines(analysis, build(escape!), separate!);

        if (lifted === null || analysis.text.slice(lifted.edit.from, lifted.edit.to) === lifted.edit.insert) {
            continue;
        }

        const wildcards = lifted.ranges.flatMap((range, index) => {
            const path = wildcardPaths[index];

            return path === null || path === undefined ? [] : [{ ...range, path }];
        });

        if (readsAsExpected(analysis.text, lifted.edit, expected, wildcards)) {
            const { ranges } = lifted;

            return { ...lifted.edit, selection: { from: ranges[0]!.from, to: ranges[ranges.length - 1]!.to } };
        }
    }

    return null;
}

/**
 * Maps each leaf of a document to the target block holding it. A task
 * item's marker belongs to the item's text ({@link firstEntryOf}).
 *
 * @param targets - The target blocks.
 * @returns A lookup from a leaf's entry index to its target's index, `-1` for none.
 */
function targetOfEntry(targets: readonly SourceBlockNode[]): (entry: number) => number {
    return (entry) => targets.findIndex((target) => firstEntryOf(target) <= entry && entry < target.entryEnd);
}

// ---------------------------------------------------------------- block types

/**
 * Converts the blocks a selection touches (see {@link readLineTargets}) to the
 * block `prefix` writes — a paragraph for `""`, a quote for `"> "`, a heading
 * for `"#".repeat(level) + " "` — lifting each out of its quotes and list
 * items (see {@link liftLines}). A block already of that kind at the top
 * level is left alone; a heading is written one line per line of text. A
 * task item's marker is carried as the text it shows (`\[x\] `).
 *
 * @param text - The full document text.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @param prefix - The block prefix.
 * @returns The edit, or `null` when the command declines.
 */
function convertBlocks(text: string, from: number, to: number, prefix: string): MarkdownSourceEdit | null {
    const analysis = analyzeMarkdownSource(text);
    const selection = readLineTargets(analysis, from, to, true);
    const targets = selection?.targets.filter((target) => !alreadyBlock(target, prefix)) ?? [];

    if (targets.length === 0) {
        return null;
    }

    const kind = prefix === "" ? ["p"] : prefix === "> " ? ["quote", "p"] : [`h${prefix.trim().length}`];
    const targetOf = targetOfEntry(targets);
    const code = targets.map((target) => target.type === "code");
    const leaves = readLeaves(analysis);
    const expected = expectLeaves(leaves, (leaf) => {
        const index = targetOf(leaf.entry);

        if (index === -1) {
            return null;
        }

        if (code[index]!) {
            return undefined;
        }

        const line = prefix.startsWith("#") ? `:${lineStartAt(text, leaf.offset)}` : "";
        const path = [...columnPath(leaf.path), ...kind];

        return markerTextLeaves(leaf, path, `t${index}${line}`) ?? { key: leaf.key, path, group: `t${index}${line}` };
    });

    const build = (escape: boolean): LineReplacement[] => targets.map((target, index) => ({
        first: lineStartAt(text, target.start),
        last:  lineEndAt(text, target.end - 1),
        lines: textLinesOf(target, "text").map((line) => {
            const written = isBlank(line) || prefix === "" ? line : prefix + line.trimStart();

            return escape && !code[index]! && !isBlank(line) ? escapeBlockStart(written, prefix) : written;
        }),
        nodes: [target],
    }));
    // A code block's code becomes Markdown, read afresh: only the kind of block it lands in is predicted.
    const wildcardPaths = targets.map((target, index) => {
        const own = leaves.find((leaf) => leaf.entry === target.entryStart);

        return code[index]! && own !== undefined ? [...columnPath(own.path), ...kind] : null;
    });

    return firstReadingEdit(analysis, build, expected, wildcardPaths, true);
}

/**
 * Whether a block already reads as the kind `prefix` writes, at the top level
 * (or in its `:::` column): a paragraph, a paragraph directly in a quote, or
 * an ATX heading of the same level.
 *
 * @param node - The block.
 * @param prefix - The block prefix.
 * @returns Whether it does.
 */
function alreadyBlock(node: SourceBlockNode, prefix: string): boolean {
    const containers = liftedContainers(node);

    if (containers === null || node.type === "code") {
        return false;
    }

    if (prefix === "" || prefix === "> ") {
        const quoted = containers.length === 1 && containers[0]!.type === "blockquote";

        return node.type !== "heading" && (prefix === "" ? containers.length === 0 : quoted);
    }

    const heading = node.token as Tokens.Heading;

    return node.type === "heading" && containers.length === 0 && heading.depth === prefix.trim().length && /^ {0,3}#/.test(heading.raw);
}

/**
 * Builds a block-type transform: converts the whole blocks the selection's
 * lines touch — paragraphs, headings and list item texts, lazy lines and a
 * setext underline included, and a fenced code block selected whole, whose
 * fence lines are dropped — into the block `prefix` writes, each lifted out
 * of the quotes and list items around it to the top level (or its `:::`
 * column), those containers split around it: what follows it inside them
 * stays in them, re-opened by their own marker (`- x\n  - a\n  - b`, `a` to a
 * heading, gives `- x\n## a\n- - b`). A task item's marker is carried as the
 * text it shows (`- [x] a` gives `## \[x\] a`). A heading is written one
 * line per line of text. The result is checked by lexing it: it must show
 * the same text in the same blocks, with only the converted blocks changed;
 * when the plain edit does not, the command sets the converted blocks apart
 * by blank lines (so a paragraph does not join the text around it) and
 * escapes a character that would open another block at a converted line's
 * start (`######` left `~~~` there), and declines when no form reads back as
 * intended. Declines too when the blocks already read that way — a blank
 * line alone included — and when a selected line holds part of any other
 * block or source the viewer does not show.
 *
 * @param prefix - The prefix of the block to convert to (`""` for a
 *   paragraph, `"> "` for a quote, `"#".repeat(level) + " "` for a heading).
 * @returns The transform.
 */
export function blockPrefixSource(prefix: string): MarkdownSourceTransform {
    return (text, from, to) => convertBlocks(text, from, to, prefix);
}

/**
 * Converts the blocks the selection's lines touch into one fenced code block:
 * from the first block's first line to the last block's last line, every line
 * a converted block's or blank, each block's text taken as written (a code
 * block's code, its fences dropped, a task item's marker as it was written),
 * the blocks lifted out of their quotes and list items as
 * {@link blockPrefixSource} lifts them. The fence is three
 * backticks, or one more than the longest run opening a code line. The result
 * must read as that code block with nothing else changed, the block set apart
 * by blank lines when it does not otherwise. Declines when the lines already
 * are exactly that block, when a line between the blocks holds anything else,
 * and when a selected line holds part of any other block.
 */
export const FENCED_CODE_SOURCE: MarkdownSourceTransform = (text, from, to) => {
    const analysis = analyzeMarkdownSource(text);
    const selection = readLineTargets(analysis, from, to, true);

    if (selection === null) {
        return null;
    }

    const { targets } = selection;
    const code = fencedContent(text, targets);

    if (code === null) {
        return null;
    }

    const fence = "`".repeat(Math.max(MIN_FENCE_LENGTH, longestOpeningBacktickRun(code) + 1));
    const targetOf = targetOfEntry(targets);
    let placed = false;
    const expected = expectLeaves(readLeaves(analysis), (leaf) => {
        if (targetOf(leaf.entry) === -1) {
            return null;
        }

        if (placed) {
            return undefined;
        }

        placed = true;

        return { key: `code::${code.join("\n")}`.replace(/\n+$/, ""), path: columnPath(leaf.path), group: "fence" };
    });
    const replacement: LineReplacement = {
        first: lineStartAt(text, targets[0]!.start),
        last:  lineEndAt(text, targets[targets.length - 1]!.end - 1),
        lines: [fence, ...code, fence],
        nodes: targets,
    };

    return firstReadingEdit(analysis, () => [replacement], expected, [null], false);
};

/**
 * The code a fence over `targets` holds: each block's text lines, and an empty
 * line for each blank line or line of container syntax alone between them.
 *
 * @param text - The full document text.
 * @param targets - The blocks, in document order.
 * @returns The code lines, or `null` when a line between the blocks holds anything else.
 */
function fencedContent(text: string, targets: readonly SourceBlockNode[]): string[] | null {
    const code: string[] = [];
    let previousEnd = -1;

    for (const target of targets) {
        const lines = nodeLines(text, target);

        if (previousEnd !== -1) {
            for (let lineStart = previousEnd + 1; lineStart < lines[0]!.start; lineStart = lineEndAt(text, lineStart) + 1) {
                if (!CONTAINER_SYNTAX_ONLY.test(text.slice(lineStart, lineEndAt(text, lineStart)))) {
                    return null;
                }

                code.push("");
            }
        }

        code.push(...textLinesOf(target, "written"));
        previousEnd = lines[lines.length - 1]!.end;
    }

    return code;
}

/**
 * The longest run of backticks opening a code line, after up to three spaces.
 *
 * @param code - The code lines.
 * @returns The run's length, `0` when no line opens with one.
 */
function longestOpeningBacktickRun(code: readonly string[]): number {
    return Math.max(0, ...code.map((line) => /^ {0,3}(`*)/.exec(line)![1]!.length));
}

// ---------------------------------------------------------------- lists

/**
 * Whether a block is the text of a list item in a list of `kind`.
 *
 * @param node - The block.
 * @param kind - The list kind.
 * @returns Whether it is.
 */
function inListOf(node: SourceBlockNode, kind: "unordered" | "ordered"): boolean {
    const item = node.parent;

    return item?.type === "list_item" && (item.parent!.token as Tokens.List).ordered === (kind === "ordered");
}

/**
 * Whether a line is a list item's marker line in a list of `kind`: the first
 * line of the item's text, its first block.
 *
 * @param text - The full document text.
 * @param node - The block holding the line.
 * @param lineStart - The line's start.
 * @param kind - The list kind.
 * @returns Whether it is.
 */
function isMarkerLine(text: string, node: SourceBlockNode, lineStart: number, kind: "unordered" | "ordered"): boolean {
    const firstBlock = node.parent?.children.find((child) => child.type !== "checkbox");

    return inListOf(node, kind) && firstBlock === node && lineStartAt(text, node.start) === lineStart;
}

/**
 * Toggles the selected lines' list: off when every selected line of the
 * blocks it touches is the marker line of an item in a list of `kind`, each
 * such item's text then lifted out as a paragraph (see
 * {@link blockPrefixSource}); otherwise on, each selected line that is not
 * yet such a marker line becoming a new item of `kind` at the top level.
 *
 * @param text - The full document text.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @param kind - The list kind.
 * @returns The edit, or `null` when the command declines.
 */
function toggleList(text: string, from: number, to: number, kind: "unordered" | "ordered"): MarkdownSourceEdit | null {
    const analysis = analyzeMarkdownSource(text);
    const selection = readLineTargets(analysis, from, to, false);

    if (selection === null || selection.targets.some((target) => target.type === "heading" && !/^ {0,3}#/.test(target.token!.raw))) {
        return null;
    }

    const selected = new Set(selection.lines.map((line) => line.start));
    const marked = selection.targets.every((target) => nodeLines(text, target)
        .every((line) => !selected.has(line.start) || isMarkerLine(text, target, line.start, kind)));

    return marked ? listOff(analysis, selection.targets) : listOn(analysis, selection.targets, selected, kind);
}

/**
 * Lifts list item texts out of their items as paragraphs, a task item's
 * marker as the text it shows.
 *
 * @param analysis - The document's analysis.
 * @param targets - The item texts.
 * @returns The edit, or `null` when no form reads as intended.
 */
function listOff(analysis: SourceAnalysis, targets: readonly SourceBlockNode[]): MarkdownSourceEdit | null {
    const text = analysis.text;
    const targetOf = targetOfEntry(targets);
    const expected = expectLeaves(readLeaves(analysis), (leaf) => {
        const index = targetOf(leaf.entry);

        if (index === -1) {
            return null;
        }

        const path = [...columnPath(leaf.path), "p"];

        return markerTextLeaves(leaf, path, `t${index}`) ?? { key: leaf.key, path, group: `t${index}` };
    });
    const build = (escape: boolean): LineReplacement[] => targets.map((target) => ({
        first: lineStartAt(text, target.start),
        last:  lineEndAt(text, target.end - 1),
        lines: textLinesOf(target, "text").map((line) => (escape && !isBlank(line) ? escapeBlockStart(line, "") : line)),
        nodes: [target],
    }));

    return firstReadingEdit(analysis, build, expected, targets.map(() => null), true);
}

/**
 * Turns selected lines into list items of `kind`: in each block, every
 * selected line that is not already the marker line of a `kind` item becomes
 * a new top-level item; the block's lines below the selection continue the
 * last new item, and its lines above the first new item stay where they are.
 * The new items of blocks with only blank lines between them are one run
 * ({@link adjoiningRuns}), written line after line and joined to the list of
 * `kind` next to them ({@link readListJoin}). When no form of that edit
 * reads as intended, the items are written as a list of their own, each
 * block's where it stands ({@link itemsApart}), and that edit is checked the
 * same way.
 *
 * @param analysis - The document's analysis.
 * @param targets - The blocks the selection touches.
 * @param selected - The selected lines' starts.
 * @param kind - The list kind.
 * @returns The edit, or `null` when nothing changes or no form reads as intended.
 */
function listOn(analysis: SourceAnalysis, targets: readonly SourceBlockNode[], selected: ReadonlySet<number>, kind: "unordered" | "ordered"): MarkdownSourceEdit | null {
    const text = analysis.text;
    const plans: ListPlan[] = targets.map((target) => {
        const lines = nodeLines(text, target);
        const converted = lines.map((line) => selected.has(line.start) && !isMarkerLine(text, target, line.start, kind));

        return { target, lines, converted, first: converted.indexOf(true) };
    }).filter((plan) => plan.first !== -1);

    if (plans.length === 0) {
        return null;
    }

    const expected = expectedItemLeaves(analysis, plans, kind);
    const joined = adjoiningRuns(text, plans).map((run) => itemReplacement(text, run, kind, readListJoin(analysis, run, kind)));
    const joinedEdit = firstReadingEdit(analysis, () => joined, expected, joined.map(() => null), false);

    if (joinedEdit !== null) {
        return joinedEdit;
    }

    // A list that gains an item below it no longer ends where it did, and what its last line read as can change
    // with that (trailing whitespace there, an indented code block, a fence left open). The items then stand apart.
    const apart = itemsApart(text, plans, kind);

    return firstReadingEdit(analysis, () => apart, expected, apart.map(() => null), false);
}

/** One block a list-on edit touches, with the lines of it that become items. */
interface ListPlan {
    readonly target:    SourceBlockNode;
    readonly lines:     SourceLine[];
    /** Per line of the block, whether it becomes a new item. */
    readonly converted: boolean[];
    /** The index of the first line that does. */
    readonly first:     number;
}

/** The lists of the kind that the new items of one run of a list-on edit join, and how the items are written. */
interface ListJoin {
    /** The list around the run's first block at the level the items land on, when part of it stands above the run; `null` for none. */
    readonly around:    SourceBlockNode | null;
    /** The list ending right above the run, blank lines aside; `null` for none. */
    readonly above:     SourceBlockNode | null;
    /**
     * The list the items join below, when it is written with their marker:
     * the list around the run's last block when it goes on below the run,
     * else the list starting right below the run; `null` for none.
     */
    readonly below:     SourceBlockNode | null;
    readonly bullet:    string;
    readonly delimiter: string;
    /** The number the first new item of a numbered list takes. */
    readonly start:     number;
}

/**
 * The leaves a list-on edit's result must read as: every leaf of a converted
 * line in a new item of `kind` at its column's top level, one item per
 * converted line, the item made from a task item's marker line still a task
 * item.
 *
 * @param analysis - The document's analysis.
 * @param plans - The touched blocks.
 * @param kind - The list kind.
 * @returns The expected leaves.
 */
function expectedItemLeaves(analysis: SourceAnalysis, plans: readonly ListPlan[], kind: "unordered" | "ordered"): ExpectedLeaf[] {
    const list = `list:${String(kind === "ordered")}`;
    /** The signature of the item made from a block's converted line: only the one from its first line carries the marker that line opens with. */
    const itemOf = (plan: ListPlan, line: number): string => (line === 0 && taskMarkerOf(plan.target) !== null ? itemSignature(plan.target.parent!) : "item:false:false");

    return expectLeaves(readLeaves(analysis), (leaf) => {
        const index = plans.findIndex((plan) => firstEntryOf(plan.target) <= leaf.entry && leaf.entry < plan.target.entryEnd);

        if (index === -1) {
            return null;
        }

        const plan = plans[index]!;
        const line = plan.lines.findIndex((candidate) => candidate.start <= leaf.offset && leaf.offset <= candidate.end);
        const group = plan.converted.lastIndexOf(true, line);

        if (line < plan.first) {
            return null;
        }

        const path = [...columnPath(leaf.path), list, itemOf(plan, group)];

        return TASK_MARKER_LEAF.test(leaf.key)
            ? { key: leaf.key, path, group: `t${index}:${group}:marker` }
            : { key: leaf.key, path: [...path, "p"], group: `t${index}:${group}` };
    });
}

/**
 * Groups the touched blocks into runs with only blank lines between them.
 * The items of one run stand line after line, as one tight list; two runs
 * have something between them that is no block to convert: items of the list
 * kind already, or a thematic break.
 *
 * @param text - The full document text.
 * @param plans - The touched blocks, in document order.
 * @returns The runs, in document order.
 */
function adjoiningRuns(text: string, plans: readonly ListPlan[]): ListPlan[][] {
    const runs: ListPlan[][] = [];

    for (const plan of plans) {
        const run = runs[runs.length - 1];
        const previous = run?.[run.length - 1];
        const from = previous === undefined ? 0 : previous.lines[previous.lines.length - 1]!.end + 1;
        const adjoins = previous !== undefined && isBlank(text.slice(from, Math.max(from, plan.lines[plan.first]!.start - 1)));

        if (run !== undefined && adjoins) {
            run.push(plan);
        } else {
            runs.push([plan]);
        }
    }

    return runs;
}

/**
 * Reads the lists of `kind` the new items of one run join, and the marker to
 * write them with: the marker of the list around the run's first block at
 * the level it lands on, else of the list right above the run, else of the
 * one below, else `-` or `1.`. The list around a block counts on a side only
 * when part of it stands there: above a block its list item opens with
 * (`1. - a`, lifting `a`) there is none of it, and below the last block of
 * its last item there is none either. The list below is the list around the
 * run's last block when it goes on below the run, else the one starting
 * right below. A list below that is written with another marker stays a
 * list of its own and is not joined. A numbered item continues the list
 * above it, or follows the number of the item it leaves in the list around
 * it, or takes the number of the item it opened when it stays that list's
 * first.
 *
 * @param analysis - The document's analysis.
 * @param run - The run's blocks, in document order.
 * @param kind - The list kind.
 * @returns The join.
 */
function readListJoin(analysis: SourceAnalysis, run: readonly ListPlan[], kind: "unordered" | "ordered"): ListJoin {
    const text = analysis.text;
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const firstLine = first.lines[first.first]!.start;
    const lastLine = last.lines[last.lines.length - 1]!.start;
    const listOfFirst = containingList(first.target, kind);
    const listOfLast = containingList(last.target, kind);
    const around = listOfFirst !== null && lineStartAt(text, listOfFirst.start) < firstLine ? listOfFirst : null;
    const continued = listOfLast !== null && lineStartAt(text, listOfLast.end - 1) > lastLine ? listOfLast : null;
    const above = neighbourList(analysis, first.target, firstLine, -1, kind);
    const listBelow = continued ?? neighbourList(analysis, last.target, lastLine, 1, kind);
    const styled = around ?? above ?? listBelow;
    const marker = styled === null ? { bullet: "-", delimiter: "." } : listMarkerOf(styled);

    const sameMarker = listBelow !== null && (kind === "unordered"
        ? listMarkerOf(listBelow).bullet === marker.bullet
        : listMarkerOf(listBelow).delimiter === marker.delimiter);

    const opensListBelow = listOfFirst !== null && listOfFirst === continued;
    const start = above !== null ? nextNumberOf(above) : around !== null ? numberOfItemOf(first.target) + 1 : opensListBelow ? numberOfItemOf(first.target) : 1;

    return { around, above, below: sameMarker ? listBelow : null, ...marker, start };
}

/**
 * The number of a block's outermost list item: the number a new item takes
 * that stands in its place, and one less than an item written right after
 * it takes.
 *
 * @param target - The block.
 * @returns The number, `0` when the item's marker holds none.
 */
function numberOfItemOf(target: SourceBlockNode): number {
    const marker = ITEM_MARKER.exec(liftedItems(target)[0]?.token?.raw ?? "")?.[2] ?? "";
    const number = Number.parseInt(marker, 10);

    return Number.isNaN(number) ? 0 : number;
}

/**
 * The lines one run's replacement covers: the run's own, and the blank lines
 * between them and a list they join, so the items stand right against it —
 * left in, those lines would make a tight list loose. The blank lines stay
 * when a joined list is loose, since the result is loose either way, and
 * below the run unless the list joined there, or the next item of a list
 * around the run, comes right after them.
 *
 * @param text - The full document text.
 * @param run - The run's blocks, in document order.
 * @param join - The lists joined.
 * @returns The first replaced line's start and the last one's end.
 */
function replacedLines(text: string, run: readonly ListPlan[], join: ListJoin): { first: number; last: number } {
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const firstLine = first.lines[first.first]!.start;
    const lastLine = last.lines[last.lines.length - 1]!;
    const tight = [join.around, join.above, join.below].every((list) => list === null || !(list.token as Tokens.List).loose);
    const textAbove = nearestTextLine(text, firstLine, -1);
    const textBelow = nearestTextLine(text, lastLine.start, 1);
    const joinsAbove = join.above !== null || join.around !== null;

    const itemFollows = [join.around, join.below].some((list) => list !== null && allNodes(list.children)
        .some((node) => node.type === "list_item" && node.start !== -1 && lineStartAt(text, node.start) === textBelow));

    const listFollows = join.below !== null && lineStartAt(text, join.below.start) === textBelow;
    const joinsBelow = listFollows || itemFollows;

    return {
        first: tight && joinsAbove && textAbove !== -1 ? lineEndAt(text, textAbove) + 1 : firstLine,
        last:  tight && joinsBelow && textBelow !== -1 ? textBelow - 1 : lastLine.end,
    };
}

/**
 * Writes one run's converted lines as items, in one replacement.
 *
 * @param text - The full document text.
 * @param run - The run's blocks, in document order.
 * @param kind - The list kind.
 * @param join - The lists the items join, and the marker they are written with.
 * @returns The replacement.
 */
function itemReplacement(text: string, run: readonly ListPlan[], kind: "unordered" | "ordered", join: ListJoin): LineReplacement {
    let number = join.start;

    const lines = run.flatMap(({ target, converted, first }) => textLinesOf(target, "written").slice(first).map((line, offset) => {
        if (!converted[first + offset]!) {
            return line;
        }

        const marker = kind === "unordered" ? join.bullet : `${number}${join.delimiter}`;

        number += 1;

        return `${marker} ${line.trimStart()}`;
    }));

    return { ...replacedLines(text, run, join), lines, nodes: run.map((plan) => plan.target) };
}

/**
 * Writes each block's converted lines as items that join no list: `-` or
 * `1.`, `2.`, … counting from one across the blocks, each block's lines
 * replaced where they stand and the blank lines around them left as they
 * are. This is the form a list-on edit falls back to when the joined form
 * does not read as intended ({@link listOn}): it changes no line of a list
 * next to the items.
 *
 * @param text - The full document text.
 * @param plans - The touched blocks, in document order.
 * @param kind - The list kind.
 * @returns One replacement per block.
 */
function itemsApart(text: string, plans: readonly ListPlan[], kind: "unordered" | "ordered"): LineReplacement[] {
    let start = 1;

    return plans.map((plan) => {
        const replacement = itemReplacement(text, [plan], kind, { around: null, above: null, below: null, bullet: "-", delimiter: ".", start });

        start += plan.converted.filter((isConverted) => isConverted).length;

        return replacement;
    });
}

/**
 * The signature of a list item, as the analysis writes it.
 *
 * @param item - The list item.
 * @returns The signature.
 */
function itemSignature(item: SourceBlockNode): string {
    const token = item.token as Tokens.ListItem;

    return `item:${String(token.task)}:${String(token.checked ?? false)}`;
}

/**
 * The nearest `:::` column around a block.
 *
 * @param node - The block.
 * @returns The column, `null` at the top level.
 */
function columnOf(node: SourceBlockNode): SourceBlockNode | null {
    for (let parent = node.parent; parent !== null; parent = parent.parent) {
        if (parent.type === "column") {
            return parent;
        }
    }

    return null;
}

/**
 * The list of `kind` a new item joins on one side: the list standing at the
 * level the item lands on (the top level, or the block's column) whose last
 * line (above) or first line (below) is the nearest line that is not blank.
 * A list holding the block is not a neighbour: the lift splits it.
 *
 * @param analysis - The document's analysis.
 * @param target - The block becoming an item.
 * @param lineStart - The start of the block's first (above) or last (below) written line.
 * @param direction - `-1` to look above, `1` below.
 * @param kind - The list kind.
 * @returns The list, or `null`.
 */
function neighbourList(
    analysis: SourceAnalysis, target: SourceBlockNode, lineStart: number, direction: -1 | 1, kind: "unordered" | "ordered",
): SourceBlockNode | null {
    const text = analysis.text;
    const at = nearestTextLine(text, lineStart, direction);
    const column = columnOf(target);

    const found = at === -1 ? undefined : allNodes(analysis.tree).find((node) => node.type === "list" && node.start !== -1
        && (node.parent === null || node.parent.type === "column") && columnOf(node) === column
        && lineStartAt(text, direction === -1 ? node.end - 1 : node.start) === at);

    if (found === undefined) {
        return null;
    }

    const isOfKind = (found.token as Tokens.List).ordered === (kind === "ordered");
    const holdsTarget = isAncestor(found, target);

    return isOfKind && !holdsTarget ? found : null;
}

/**
 * The start of the nearest line above or below a line that is not blank.
 *
 * @param text - The full document text.
 * @param lineStart - The line's start.
 * @param direction - `-1` to look above, `1` below.
 * @returns The line's start, `-1` when every line that way is blank.
 */
function nearestTextLine(text: string, lineStart: number, direction: -1 | 1): number {
    let at = lineStart;
    let isBlankLine = true;

    while (at !== -1 && isBlankLine) {
        const end = lineEndAt(text, at);

        at = direction === -1 ? (at === 0 ? -1 : lineStartAt(text, at - 1)) : (end >= text.length ? -1 : end + 1);
        isBlankLine = at !== -1 && isBlank(text.slice(at, lineEndAt(text, at)));
    }

    return at;
}

/**
 * The list of `kind` holding a block at the level the block lands on when
 * lifted: its outermost list, when that list is of `kind`.
 *
 * @param target - The block.
 * @param kind - The list kind.
 * @returns The list, or `null`.
 */
function containingList(target: SourceBlockNode, kind: "unordered" | "ordered"): SourceBlockNode | null {
    for (let parent = target.parent; parent !== null; parent = parent.parent) {
        if (parent.type === "list" && (parent.parent === null || parent.parent.type === "column")) {
            return (parent.token as Tokens.List).ordered === (kind === "ordered") ? parent : null;
        }
    }

    return null;
}

/**
 * A list's bullet character and numbered delimiter, read from its first item.
 *
 * @param list - The list.
 * @returns The bullet (`-` for a numbered list) and the delimiter (`.` for a bulleted one).
 */
function listMarkerOf(list: SourceBlockNode): { bullet: string; delimiter: string } {
    const marker = ITEM_MARKER.exec((list.token as Tokens.List).items[0]!.raw)?.[2] ?? "-";

    return { bullet: /^[-+*]$/.test(marker) ? marker : "-", delimiter: marker.endsWith(")") ? ")" : "." };
}

/**
 * The number the item after a numbered list's last takes.
 *
 * @param list - The numbered list.
 * @returns The number.
 */
function nextNumberOf(list: SourceBlockNode): number {
    const token = list.token as Tokens.List;

    return Number(token.start) + token.items.length;
}

/**
 * Builds a list-toggle transform: when every selected line of the blocks the
 * selection touches is the marker line of an item in a list of `kind` — in
 * the viewer's reading, so a `+` item inside a quote counts — the toggle is
 * off and each of those items' text is lifted out as a paragraph, the list
 * split around it as {@link blockPrefixSource} splits it; otherwise each
 * selected line that is not yet such a marker line becomes a new top-level
 * item, a block's lines below the selection continuing the last new item.
 * Items made from neighbouring blocks stand line after line, as one tight
 * list. A new item is written with the marker
 * of the list of `kind` it joins — the one around its block at the top
 * level, else the one right above it, else the one right below — and `- ` or
 * `1. ` with none; a numbered item continues the list above it. The blank
 * lines between new items and a tight list they join are removed, since they
 * would make it loose. A task item that stays an item keeps its marker; one
 * whose text is lifted out keeps it as the text it shows (`\[x\]`). The
 * result is checked by lexing it, as the block-type transforms' are; a
 * converted line that would read as a definition, an HTML block, code, a
 * nested item, or a line below that would start a block rather than continue
 * the item, makes the command decline. Declines too for a selection touching
 * a setext heading's text, whose underline would close the last item into a
 * heading, a code block, and anything {@link blockPrefixSource} declines.
 *
 * @param kind - Which list to toggle.
 * @returns The transform.
 */
export function listSource(kind: "unordered" | "ordered"): MarkdownSourceTransform {
    return (text, from, to) => toggleList(text, from, to, kind);
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
