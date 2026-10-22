// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The parser configurations that let the built-in "markdown" language tag
// every kind of non-text Markdown for source mode's colours (theme.ts).
// `languages.ts` passes them to `markdown({ extensions })`. One retags
// lezer's own nodes; the others read what CommonMark does not: the dialect's
// `{…}` groups, `:::` and `|||` lines, `++underline++`, `~~strike~~` and
// tables. None of them changes a block lezer already reads, so Enter and
// Backspace read the document as before. Two new blocks do change what a
// paragraph covers: a table takes the place, and the folding, of the paragraph
// it was, and a `:::` or `|||` line that carries its container's marks ends
// the paragraph or table above it, so an opening `:::` line folds its fence
// itself (a fold of its own, below) instead of the paragraph it used to head.
// `@lezer/highlight` and `@codemirror/language` are loaded by theme.ts and
// CodeEditor, so importing this module loads no grammar package.

import { styleTags } from "@lezer/highlight";
import { foldNodeProp, foldService, syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import type { BlockParser, MarkdownConfig } from "~/component/editor/markdownTabStops.js";
import { MARKDOWN_SOURCE_TAGS } from "~/component/editor/markdownSourceTags.js";

/** An inline parser of a parser configuration. */
type InlineParser = NonNullable<MarkdownConfig["parseInline"]>[number];

/** The inline parse state an inline parser is given. */
type InlineContext = Parameters<InlineParser["parse"]>[0];

/** A syntax element an inline or block parser builds. */
type Element = ReturnType<InlineContext["elt"]>;

/** The parser of a leaf block (a paragraph's text) that a block parser's `leaf` hands out. */
type LeafParser = NonNullable<ReturnType<NonNullable<BlockParser["leaf"]>>>;

/** The parse state, the line and the leaf block a leaf parser's `nextLine` is given. */
type LeafNextLine = Parameters<LeafParser["nextLine"]>;

/** The block parse state. */
type BlockContext = LeafNextLine[0];

/** The leaf block a leaf parser reads. */
type LeafBlock = LeafNextLine[2];

/** The line a block parser or a leaf parser is given. */
type BlockLine = LeafNextLine[1];

/** Character codes the parsers compare against, as `InlineContext.char` returns them. */
const NEWLINE       = "\n".charCodeAt(0);
const SPACE         = " ".charCodeAt(0);
const TAB           = "\t".charCodeAt(0);
const TILDE         = "~".charCodeAt(0);
const PLUS          = "+".charCodeAt(0);
const OPEN_BRACE    = "{".charCodeAt(0);
const CLOSE_BRACKET = "]".charCodeAt(0);
const COLON         = ":".charCodeAt(0);
const PIPE          = "|".charCodeAt(0);
const BACKSLASH     = "\\".charCodeAt(0);

/**
 * Gives lezer's own Markdown nodes the source-mode tags, in place of the
 * standard tags `@lezer/markdown` gives them. Each rule names its nodes with
 * no parent path, so it replaces lezer's rule for them instead of sitting
 * behind it. A fenced code block passes the block-mark tag to everything in
 * it (`/...`): its fence lines and info string take it, and its code takes
 * the code tag's colour, which the theme lists later. An HTML block, an
 * inline tag and an HTML comment block take the HTML colour; the HTML parsed
 * inside them is drawn whole in that colour too, by a rule on the top node of
 * the HTML language `languages.ts` mounts there, so the HTML tree's own
 * colours, and the JavaScript or CSS inside a `<script>`, a `<style>` or a
 * `style=` attribute, never show. These nodes are not opaque themselves: the
 * container marks (`>`, a list's continuation marks) between the lines of a
 * quoted HTML block keep the block-mark colour.
 */
export const MARKDOWN_SOURCE_RETAGS: MarkdownConfig = {
    props: [
        styleTags({
            "HeaderMark QuoteMark ListMark HorizontalRule":                     MARKDOWN_SOURCE_TAGS.blockMark,
            "FencedCode/...":                                                   MARKDOWN_SOURCE_TAGS.blockMark,
            "EmphasisMark LinkMark CodeMark":                                   MARKDOWN_SOURCE_TAGS.inlineMark,
            "HardBreak Escape Entity":                                          MARKDOWN_SOURCE_TAGS.escape,
            "URL Autolink LinkLabel":                                           MARKDOWN_SOURCE_TAGS.destination,
            "InlineCode CodeText":                                              MARKDOWN_SOURCE_TAGS.code,
            "HTMLBlock HTMLTag CommentBlock":                                   MARKDOWN_SOURCE_TAGS.html,
            "Comment ProcessingInstruction ProcessingInstructionBlock":         MARKDOWN_SOURCE_TAGS.html,
        }),
    ],
};

/**
 * A character a delimiter's flanking test counts as punctuation: Unicode
 * punctuation and symbols, the class `@lezer/markdown` uses for `~~`.
 */
const PUNCTUATION = /[\p{S}\p{P}]/u;

/** A blank, or no character at all (the edge of the text). */
const BLANK_OR_EDGE = /\s|^$/;

/** The delimiter `~~` adds: matched pairs wrap their content in a `Strikethrough` node and become `StrikethroughMark`s. */
const STRIKETHROUGH_DELIMITER = { resolve: "Strikethrough", mark: "StrikethroughMark" };

/**
 * `~~strike~~`, read as GitHub Flavored Markdown reads it and as
 * `@lezer/markdown`'s own `Strikethrough` extension does (that package is not
 * a direct dependency, so its extension is not imported): a run of exactly
 * two tildes that can open or close by the same flanking rule as `*`. The
 * marks take the inline-mark tag; the text keeps the text colour.
 */
export const MARKDOWN_STRIKETHROUGH: MarkdownConfig = {
    defineNodes: [
        { name: "Strikethrough" },
        { name: "StrikethroughMark", style: MARKDOWN_SOURCE_TAGS.inlineMark },
    ],
    parseInline: [{
        name: "Strikethrough",
        parse: parseStrikethroughMark,
        after: "Emphasis",
    }],
};

/** The length of a `~~` mark. */
const STRIKETHROUGH_MARK_LENGTH = 2;

/**
 * Adds a `~~` delimiter at a position, when two tildes and no third stand
 * there.
 *
 * @param cx - The inline parse state.
 * @param next - The character code at `pos`.
 * @param pos - The position.
 * @returns The end of the delimiter, or `-1` when none starts here.
 */
function parseStrikethroughMark(cx: InlineContext, next: number, pos: number): number {
    const markEnd = pos + STRIKETHROUGH_MARK_LENGTH;

    if (next !== TILDE || cx.char(pos + 1) !== TILDE || cx.char(markEnd) === TILDE) {
        return -1;
    }

    const before        = cx.slice(pos - 1, pos);
    const after         = cx.slice(markEnd, markEnd + 1);
    const blankBefore   = BLANK_OR_EDGE.test(before);
    const blankAfter    = BLANK_OR_EDGE.test(after);
    const punctBefore   = PUNCTUATION.test(before);
    const punctAfter    = PUNCTUATION.test(after);
    const opens         = !blankAfter && (!punctAfter || blankBefore || punctBefore);
    const closes        = !blankBefore && (!punctBefore || blankAfter || punctAfter);

    return cx.addDelimiter(STRIKETHROUGH_DELIMITER, pos, markEnd, opens, closes);
}

/**
 * `++underline++` as the viewer reads it (`markdownExtensions.ts`'s
 * underline tokenizer): `++`, text holding no `+`, `++`. Sticky, so it is
 * tried at one position of the inline text.
 */
const UNDERLINE = /\+\+([^+]+)\+\+/y;

/** The length of each `++` mark. */
const UNDERLINE_MARK_LENGTH = 2;

/**
 * `++underline++`: an `Underline` node holding two `UnderlineMark`s and the
 * text between them, read inline. The marks take the inline-mark tag.
 */
export const MARKDOWN_UNDERLINE: MarkdownConfig = {
    defineNodes: [
        { name: "Underline" },
        { name: "UnderlineMark", style: MARKDOWN_SOURCE_TAGS.inlineMark },
    ],
    parseInline: [{
        name: "Underline",
        parse: parseUnderline,
        after: "Emphasis",
    }],
};

/**
 * Reads an underline that starts at a position.
 *
 * @param cx - The inline parse state.
 * @param next - The character code at `pos`.
 * @param pos - The position.
 * @returns The end of the underline, or `-1` when none starts here.
 */
function parseUnderline(cx: InlineContext, next: number, pos: number): number {
    if (next !== PLUS) {
        return -1;
    }

    UNDERLINE.lastIndex = pos - cx.offset;

    const match = UNDERLINE.exec(cx.text);

    if (match === null) {
        return -1;
    }

    const end       = pos + match[0].length;
    const textStart = pos + UNDERLINE_MARK_LENGTH;

    return cx.addElement(cx.elt("Underline", pos, end, [
        cx.elt("UnderlineMark", pos, textStart),
        ...parseNestedInline(cx, match[1]!, textStart),
        cx.elt("UnderlineMark", end - UNDERLINE_MARK_LENGTH, end),
    ]));
}

/**
 * An attribute group: `{`, anything but a brace, `}` — the viewer's group
 * after a span (`markdownExtensions.ts`'s styled-span tokenizer) and after an
 * image (its `IMAGE_ATTRIBUTE_GROUP`). Sticky, so it is tried at one position.
 */
const ATTRIBUTE_GROUP = /\{[^{}]*\}/y;

/**
 * The one member of `@lezer/markdown`'s `InlineContext` that
 * {@link followsSpanOrImage} reads. `parts`, the elements and delimiters read
 * so far, is internal: it is in no type declaration, and may be renamed by any
 * release. A link or an image is an element there as soon as its closing
 * `]` or `)` is read: its node type's id and its end.
 */
interface InlineContextInternals {
    readonly parts?: ReadonlyArray<{ readonly type: unknown; readonly to: number } | null>;
}

/**
 * Tells whether a position directly follows an image, or a link whose last
 * character is `]` — the two things the viewer reads a `{…}` group after (a
 * `[text]{…}` span is a link to this grammar). A link that ends with `)`
 * takes no group. When the parse state has no `parts`, as in a release that
 * renamed it, no group is read, and groups stay in the text colour.
 *
 * @param cx - The inline parse state.
 * @param pos - The position.
 * @returns `true` when the element read last is such an image or link and ends at `pos`.
 */
function followsSpanOrImage(cx: InlineContext, pos: number): boolean {
    const parts = (cx as unknown as InlineContextInternals).parts;
    const last  = parts === undefined ? null : parts[parts.length - 1];

    if (last === null || last === undefined || last.to !== pos || typeof last.type !== "number") {
        return false;
    }

    const name = cx.parser.nodeSet.types[last.type]?.name;

    return name === "Image" || (name === "Link" && cx.char(pos - 1) === CLOSE_BRACKET);
}

/**
 * Reads an attribute group that starts at a position, directly after a span
 * or an image.
 *
 * @param cx - The inline parse state.
 * @param next - The character code at `pos`.
 * @param pos - The position.
 * @returns The end of the group, or `-1` when none starts here.
 */
function parseAttributeGroup(cx: InlineContext, next: number, pos: number): number {
    if (next !== OPEN_BRACE) {
        return -1;
    }

    ATTRIBUTE_GROUP.lastIndex = pos - cx.offset;

    const match = ATTRIBUTE_GROUP.exec(cx.text);

    if (match === null || !followsSpanOrImage(cx, pos)) {
        return -1;
    }

    return cx.addElement(cx.elt("AttributeGroup", pos, pos + match[0].length));
}

/**
 * The `{…}` group after a span or an image: an `AttributeGroup` node with
 * the dialect tag. The groups of a table's delimiter row and of a `:::` line
 * are part of those lines' own nodes.
 */
export const MARKDOWN_ATTRIBUTE_GROUPS: MarkdownConfig = {
    defineNodes: [{ name: "AttributeGroup", style: MARKDOWN_SOURCE_TAGS.dialect }],
    parseInline: [{ name: "AttributeGroup", parse: parseAttributeGroup }],
};

/** What opens or closes a `:::` fence: a line whose text, trimmed, starts with these (`markdownExtensions.ts`'s block tokenizer). */
const COLON_FENCE = ":::";

/** The line that splits a `:::` fence into columns: exactly these, trimmed (`COLUMN_SEPARATOR` in `markdownAttributes.ts`). */
const COLUMN_SEPARATOR = "|||";

/**
 * How many nested inline parses {@link parseNestedInline} has running. The
 * text of a nested parse (a table cell, the text of an underline) starts
 * mid-line, so its start is not a line start; only a line break inside it is.
 */
let _nestedInlineDepth = 0;

/**
 * Reads a piece of a line's text as inline content, as `parseInline` does, and
 * notes that the piece does not start a line of the source.
 *
 * @param cx - The inline or block parse state; only its parser is used.
 * @param text - The piece of text.
 * @param offset - The position of the piece in the document.
 * @returns The elements the piece holds.
 */
function parseNestedInline(cx: Pick<InlineContext, "parser">, text: string, offset: number): Element[] {
    _nestedInlineDepth++;

    try {
        return cx.parser.parseInline(text, offset);
    } finally {
        _nestedInlineDepth--;
    }
}

/**
 * Tells whether a position starts the text of its line within the inline
 * text: only spaces and tabs stand between it and the line break before it,
 * or the start of the inline text of a paragraph, a heading or the like (not
 * of a piece read by {@link parseNestedInline}, which starts mid-line).
 * Inside a blockquote, the inline text holds
 * spaces where a later line's `>` stands, so a `>` does not count.
 *
 * @param cx - The inline parse state.
 * @param pos - The position.
 * @returns `true` when nothing but spaces and tabs stands before it on its line.
 */
function startsLineText(cx: InlineContext, pos: number): boolean {
    for (let at = pos - 1; at >= cx.offset; at--) {
        const code = cx.char(at);

        if (code === NEWLINE) {
            return true;
        }

        if (code !== SPACE && code !== TAB) {
            return false;
        }
    }

    return _nestedInlineDepth === 0;
}

/**
 * Finds where the line holding a position ends within the inline text.
 *
 * @param cx - The inline parse state.
 * @param pos - The position.
 * @returns The position of the line break after it, or the end of the inline text.
 */
function lineEndAfter(cx: InlineContext, pos: number): number {
    const index = cx.text.indexOf("\n", pos - cx.offset);

    return index === -1 ? cx.end : cx.offset + index;
}

/**
 * Reads a `:::` line — a fence's opening line with its label and group, or
 * its closing line — as one `ColonFence` node.
 *
 * @param cx - The inline parse state.
 * @param next - The character code at `pos`.
 * @param pos - The position.
 * @returns The end of the line, or `-1` when no `:::` line starts here.
 */
function parseColonFence(cx: InlineContext, next: number, pos: number): number {
    const isFenceLine = next === COLON && cx.slice(pos, pos + COLON_FENCE.length) === COLON_FENCE && startsLineText(cx, pos);

    return isFenceLine ? cx.addElement(cx.elt("ColonFence", pos, lineEndAfter(cx, pos))) : -1;
}

/**
 * Reads a `|||` line, the line that starts a fence's next column, as one
 * `ColumnSeparator` node; spaces and tabs may stand around it.
 *
 * @param cx - The inline parse state.
 * @param next - The character code at `pos`.
 * @param pos - The position.
 * @returns The end of the `|||`, or `-1` when no `|||` line starts here.
 */
function parseColumnSeparator(cx: InlineContext, next: number, pos: number): number {
    const end = pos + COLUMN_SEPARATOR.length;

    const isSeparator = next === PIPE && cx.slice(pos, end) === COLUMN_SEPARATOR && startsLineText(cx, pos)
        && cx.slice(end, lineEndAfter(cx, pos)).trim() === "";

    return isSeparator ? cx.addElement(cx.elt("ColumnSeparator", pos, end)) : -1;
}

/**
 * Tells whether a line, after its container marks, is a `:::` line (anything
 * may follow the colons) or a `|||` line (exactly those, with blanks around).
 *
 * @param text - The line's text from its first character after the container marks.
 * @returns `"ColonFenceLine"`, `"ColumnSeparatorLine"`, or `null` for a line that is neither.
 */
function fenceLineKind(text: string): "ColonFenceLine" | "ColumnSeparatorLine" | null {
    if (text.startsWith(COLON_FENCE)) {
        return "ColonFenceLine";
    }

    return text.trim() === COLUMN_SEPARATOR ? "ColumnSeparatorLine" : null;
}

/**
 * Reads a `:::` or `|||` line that starts a block as a block of its own: one
 * `ColonFenceLine` or `ColumnSeparatorLine` node over the line's text.
 *
 * @param cx - The block parse state.
 * @param line - The line.
 * @returns `true` when it read the line, `false` when the line is neither fence line.
 */
function parseFenceLine(cx: BlockContext, line: BlockLine): boolean {
    const kind = fenceLineKind(line.text.slice(line.pos));

    if (kind === null) {
        return false;
    }

    const from = cx.lineStart + line.pos;
    const to   = kind === "ColonFenceLine" ? cx.lineStart + line.text.length : from + COLUMN_SEPARATOR.length;

    cx.addElement(cx.elt(kind, from, to));
    cx.nextLine();

    return true;
}

/**
 * The one member of `@lezer/markdown`'s `Line` that {@link endsLeafAtFenceLine}
 * reads. `depth`, how many of the open containers the line carries the marks
 * of, is in no type declaration and may be renamed by any release; when it is
 * missing no line ends a block, and fence lines are read inline as before.
 */
interface LineInternals {
    readonly depth?: number;
}

/**
 * Tells whether a `:::` or `|||` line ends the paragraph or table above it.
 * One that carries all its container marks does, as the viewer reads a fence
 * line wherever it starts a line; a lazy continuation line (a quote's or a
 * list item's text that lacks the container's marks) does not, so it stays in
 * its paragraph as before and is read inline.
 *
 * @param cx - The block parse state.
 * @param line - The line.
 * @returns `true` when the line ends the block above it.
 */
function endsLeafAtFenceLine(cx: BlockContext, line: BlockLine): boolean {
    return (line as LineInternals).depth === cx.depth && fenceLineKind(line.text.slice(line.pos)) !== null;
}

/** The part of a syntax node the fence fold reads. */
interface FenceNode {
    readonly from: number;
    readonly to: number;
    readonly name: string;
    readonly nextSibling: FenceNode | null;
}

/**
 * Folds a `:::` fence from the end of its opening line to the end of the line
 * before its closing `:::` line. The closing line is the next bare `:::` line
 * among the opening line's siblings — the blocks of the same quote, list item
 * or document — that no later opening line has claimed first, so nested fences
 * pair up and a fence inside a code block or another container is not seen. A
 * bare `:::` line closes; it has nothing to open or fold. A fence with no
 * closing line, which the viewer does not read as a fence at all, folds to the
 * end of its container, so its opening line keeps the fold it had when it
 * headed a paragraph.
 *
 * @param node - The `ColonFenceLine` node.
 * @param state - The editor state.
 * @returns The range to fold, or `null` for a closing line and for a fence with nothing inside.
 */
function foldFenceFrom(node: FenceNode, state: EditorState): { from: number; to: number } | null {
    if (isClosingFenceLine(node, state)) {
        return null;
    }

    const lineEnd = state.doc.lineAt(node.from).to;
    let depth     = 0;
    let last      = node;

    for (let sibling = node.nextSibling; sibling !== null; sibling = sibling.nextSibling) {
        last = sibling;

        if (sibling.name !== "ColonFenceLine") {
            continue;
        }

        if (!isClosingFenceLine(sibling, state)) {
            depth++;
        } else if (depth > 0) {
            depth--;
        } else {
            const end = state.doc.lineAt(sibling.from).from - 1;

            return end > lineEnd ? { from: lineEnd, to: end } : null;
        }
    }

    return last.to > lineEnd ? { from: lineEnd, to: last.to } : null;
}

/**
 * The fold service of the `markdown` language for `:::` fences. A node's own
 * fold cannot do it: the highlighter-style node fold needs a node that runs
 * past the end of the line, and a `ColonFenceLine` ends with its line. The
 * service reads the syntax tree at the end of the line asked about and folds
 * when a `ColonFenceLine` ends there; it answers `null` for every other line,
 * which the language's own folds then answer as before.
 */
export const MARKDOWN_FENCE_FOLD: Extension = foldService.of((state, lineStart, lineEnd) => {
    const node = syntaxTree(state).resolveInner(lineEnd, -1);

    return node.name === "ColonFenceLine" && node.from >= lineStart ? foldFenceFrom(node, state) : null;
});

/**
 * Tells whether a `ColonFenceLine` node is a bare `:::`, which closes a fence.
 *
 * @param node - The node.
 * @param state - The editor state.
 * @returns `true` for a closing line.
 */
function isClosingFenceLine(node: FenceNode, state: EditorState): boolean {
    return state.doc.sliceString(node.from, node.to).trim() === COLON_FENCE;
}

/**
 * The `:::` and `|||` lines of the dialect's fences, with the dialect tag.
 * A line that carries all its container marks is a block of its own that ends
 * a paragraph or table above it, so a table right under such a line, or a
 * fence closing right under a table, reads as the viewer reads it. A lazy
 * continuation line, which a paragraph keeps, is read inline, where it
 * stands in the paragraph's text; there a paragraph, a list item or a quote
 * holding one keeps the extent lezer gives it.
 */
export const MARKDOWN_FENCE_LINES: MarkdownConfig = {
    defineNodes: [
        { name: "ColonFence",          style: MARKDOWN_SOURCE_TAGS.dialect },
        { name: "ColumnSeparator",     style: MARKDOWN_SOURCE_TAGS.dialect },
        { name: "ColonFenceLine",      block: true, style: MARKDOWN_SOURCE_TAGS.dialect },
        { name: "ColumnSeparatorLine", block: true, style: MARKDOWN_SOURCE_TAGS.dialect },
    ],
    parseBlock: [{
        name:    "DialectFenceLine",
        parse:   parseFenceLine,
        endLeaf: endsLeafAtFenceLine,
        after:   "SetextHeading",
    }],
    parseInline: [
        { name: "ColonFence",      parse: parseColonFence },
        { name: "ColumnSeparator", parse: parseColumnSeparator },
    ],
};

/** A delimiter row's cell: dashes with an optional colon at each end, then an optional `{…}` group (`markdownTableExtension.ts`). */
const DELIMITER_CELL = /^(:?-+:?)(?:\s*\{[^{}]*\})?$/;

/** A delimiter row must hold a colon or a pipe, so a line over `---` stays a setext heading (`markdownTableExtension.ts`). */
const DELIMITER_ROW_MARKER = /[:|]/;

/** A body cell that merges into the cell to its left (`<<`) or above it (`^^`). */
const MERGE_CELL = /^(?:<<|\^\^)$/;

/** A table row split at its pipes: each cell's trimmed range and each unescaped pipe, as positions in the row's text. */
interface RowSplit {
    readonly cells: ReadonlyArray<{ readonly from: number; readonly to: number }>;
    readonly pipes: readonly number[];
}

/**
 * Splits a table row at its unescaped pipes, as the viewer does: a leading
 * and a trailing pipe bound the row and make no cell, and each cell is
 * trimmed. A cell between two pipes with only blanks in it is empty, with
 * `from === to`. A pipe inside a code span splits the row too, as in the
 * viewer.
 *
 * @param text - The row's line.
 * @param start - Where the row's text starts in the line, after any container marks.
 * @returns The cells and the pipes.
 */
function splitRow(text: string, start: number): RowSplit {
    const cells: Array<{ from: number; to: number }> = [];
    const pipes: number[] = [];
    let cellStart = -1;
    let cellEnd   = -1;
    let escaped   = false;
    let atStart   = true;

    for (let at = start; at < text.length; at++) {
        const code = text.charCodeAt(at);

        if (code === PIPE && !escaped) {
            if (cellStart > -1) {
                cells.push({ from: cellStart, to: cellEnd });
            } else if (!atStart) {
                cells.push({ from: at, to: at });
            }

            atStart   = false;
            cellStart = -1;
            cellEnd   = -1;
            pipes.push(at);
        } else if (escaped || (code !== SPACE && code !== TAB)) {
            cellStart = cellStart < 0 ? at : cellStart;
            cellEnd   = at + 1;
        }

        escaped = !escaped && code === BACKSLASH;
    }

    if (cellStart > -1) {
        cells.push({ from: cellStart, to: cellEnd });
    }

    return { cells, pipes };
}

/**
 * Counts the cells of a delimiter row.
 *
 * @param text - The line's text after any container marks.
 * @returns The number of cells, or `-1` when the line is not a delimiter row.
 */
function delimiterRowCells(text: string): number {
    if (!DELIMITER_ROW_MARKER.test(text)) {
        return -1;
    }

    const { cells } = splitRow(text, 0);
    const isDelimiterRow = cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(text.slice(cell.from, cell.to)));

    return isDelimiterRow ? cells.length : -1;
}

/**
 * Builds the nodes of a header or body row: a `TableDelimiter` for each pipe,
 * a `TableCell` holding each cell's inline content, and a `TableMerge` for a
 * body cell of only `<<` or `^^` that can merge — `<<` past the first column,
 * `^^` past the first body row. Empty cells make no node.
 *
 * @param cx - The block parse state.
 * @param text - The row's line.
 * @param start - Where the row's text starts in the line.
 * @param offset - The document position of the line's first character.
 * @param bodyRow - The row's index among the body rows, or `-1` for the header row.
 * @returns The row's nodes, in document order.
 */
function rowNodes(cx: BlockContext, text: string, start: number, offset: number, bodyRow: number): Element[] {
    const { cells, pipes } = splitRow(text, start);
    const nodes: Element[] = pipes.map((pipe) => cx.elt("TableDelimiter", offset + pipe, offset + pipe + 1));

    cells.forEach((cell, column) => {
        const content = text.slice(cell.from, cell.to);

        if (content === "") {
            return;
        }

        const isMerge = MERGE_CELL.test(content) && bodyRow >= 0 && (content === "<<" ? column > 0 : bodyRow > 0);
        const from = offset + cell.from;
        const to   = offset + cell.to;

        nodes.push(isMerge ? cx.elt("TableMerge", from, to) : cx.elt("TableCell", from, to, parseNestedInline(cx, content, from)));
    });

    return nodes.sort((a, b) => a.from - b.from);
}

/**
 * Reads a paragraph-like leaf block as a table when its second line is a
 * delimiter row with as many cells as its first: the header row, the
 * delimiter row, then one body row per further line of the block, so the
 * table ends where the paragraph would. `@lezer/markdown`'s own `TableParser`,
 * which the package does not export, with the viewer's delimiter row (a
 * `{…}` group per cell, a colon or pipe required, a header with no pipe
 * allowed) and merge cells.
 */
class DialectTableParser implements LeafParser {
    /** `null` before the second line, `false` when the block is no table, otherwise the nodes read so far. */
    private _rows: Element[] | false | null = null;

    /** How many body rows have been read. */
    private _bodyRows = 0;

    /**
     * Reads the next line of the block; never ends the block itself.
     *
     * @param cx - The block parse state.
     * @param line - The line.
     * @param leaf - The leaf block, holding the first line.
     * @returns `false`, so the block goes on as a paragraph would.
     */
    nextLine(...[cx, line, leaf]: LeafNextLine): boolean {
        if (this._rows === null) {
            this._rows = this.readHeader(cx, line.text.slice(line.pos), cx.lineStart + line.pos, cx.lineStart + line.text.length, leaf);
        } else if (this._rows) {
            const rowFrom = cx.lineStart + line.pos;
            const rowTo   = cx.lineStart + line.text.length;

            this._rows.push(cx.elt("TableRow", rowFrom, rowTo, rowNodes(cx, line.text, line.pos, cx.lineStart, this._bodyRows)));

            this._bodyRows++;
        }

        return false;
    }

    /**
     * Reads the header row and the delimiter row below it.
     *
     * @param cx - The block parse state.
     * @param delimiterText - The second line's text after any container marks.
     * @param delimiterFrom - Where that text starts in the document.
     * @param delimiterTo - Where the second line ends in the document.
     * @param leaf - The leaf block, holding the first line.
     * @returns The header and delimiter nodes, or `false` when the two lines start no table.
     */
    private readHeader(cx: BlockContext, delimiterText: string, delimiterFrom: number, delimiterTo: number, leaf: LeafBlock): Element[] | false {
        const columns = delimiterRowCells(delimiterText);

        if (columns < 0 || columns !== splitRow(leaf.content, 0).cells.length) {
            return false;
        }

        return [
            cx.elt("TableHeader", leaf.start, leaf.start + leaf.content.length, rowNodes(cx, leaf.content, 0, leaf.start, -1)),
            cx.elt("TableDelimiter", delimiterFrom, delimiterTo),
        ];
    }

    /**
     * Ends the block as a table when it is one.
     *
     * @param cx - The block parse state.
     * @param leaf - The leaf block.
     * @returns `true` when it added the table, `false` to leave the block to the next leaf parser.
     */
    finish(cx: BlockContext, leaf: LeafBlock): boolean {
        if (!this._rows) {
            return false;
        }

        cx.addLeafElement(leaf, cx.elt("Table", leaf.start, leaf.start + leaf.content.length, this._rows));

        return true;
    }
}

/**
 * Folds a table below its first line, as `@codemirror/lang-markdown` folds
 * any other multi-line block (and its own GFM table): a table was a
 * paragraph, which folded so.
 *
 * @param tree - The table node.
 * @param state - The editor state.
 * @returns The range to fold.
 */
function foldBelowFirstLine(tree: { from: number; to: number }, state: EditorState): { from: number; to: number } {
    return { from: state.doc.lineAt(tree.from).to, to: tree.to };
}

/**
 * Tables, with the dialect's delimiter row and merge cells. Pipes, the whole
 * delimiter row and merge cells take the dialect tag; header and body cells
 * keep the text colour. A table takes the place of the paragraph its lines
 * would make, so blocks around it read as before.
 */
export const MARKDOWN_TABLES: MarkdownConfig = {
    defineNodes: [
        { name: "Table", block: true },
        { name: "TableHeader" },
        { name: "TableRow" },
        { name: "TableCell" },
        { name: "TableDelimiter", style: MARKDOWN_SOURCE_TAGS.dialect },
        { name: "TableMerge",     style: MARKDOWN_SOURCE_TAGS.dialect },
    ],
    parseBlock: [{
        name: "DialectTable",
        leaf: () => new DialectTableParser(),
        before: "SetextHeading",
    }],
    props: [foldNodeProp.add({ Table: foldBelowFirstLine })],
};
