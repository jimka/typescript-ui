// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { $getRoot, $getState, $isElementNode, $isLineBreakNode, $isParagraphNode, $isTextNode, TEXT_TYPE_TO_FORMAT } from "lexical";
import type { ElementFormatType, ElementNode, LexicalNode, TextFormatType, TextNode } from "lexical";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import type { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $isListItemNode, $isListNode } from "@lexical/list";
import type { ListItemNode, ListNode } from "@lexical/list";
import { $isLinkNode } from "@lexical/link";
import type { LinkNode } from "@lexical/link";
import { $isCodeNode } from "@lexical/code";
import type { CodeNode } from "@lexical/code";
import { $isTableCellNode, $isTableNode, $isTableRowNode } from "@lexical/table";
import type { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import type { Token, Tokens } from "marked";
import {
    blockStyleToAttributes, cssTextToAttributes, formatAttributes, joinColumnSections, parseAttributes, resolveBlockStyle, resolveImageSpec,
    resolveSpanStyle, spanStyleToAttributes,
} from "~/component/display/markdownAttributes.js";
import { lexMarkdown } from "~/component/display/markdownExtensions.js";
import type { MdTableToken } from "~/component/display/markdownTableExtension.js";
import { $isMarkdownBlockNode } from "~/component/editor/markdownBlockNode.js";
import type { MarkdownBlockNode } from "~/component/editor/markdownBlockNode.js";
import { $isMarkdownImageNode } from "~/component/editor/markdownImageNode.js";
import type { MarkdownImageNode } from "~/component/editor/markdownImageNode.js";
import {
    bareAutolinkState, fenceAttributesState, hardBreakMarkerState, imageAttributesState, spanAttributesState,
} from "~/component/editor/markdownNodeState.js";

// ---------------------------------------------------------------- constants

/** Separates two top-level blocks (and two blocks of a fence column): one blank line. */
const BLOCK_SEPARATOR = "\n\n";

/**
 * The two characters backslash and `n`, half of a table cell's break: a raw
 * newline would end the pipe row. A lone one renders as literal text.
 */
const CELL_LINE_BREAK = "\\n";

/**
 * Two {@link CELL_LINE_BREAK}s: what a table cell writes between two of its
 * paragraphs and for a line break or a newline inside it. Mirrors the
 * viewer's own `CELL_PARAGRAPH_BREAK`, the only sequence it splits a cell's
 * text on to render one `<br>` per boundary.
 */
const CELL_PARAGRAPH_BREAK = CELL_LINE_BREAK + CELL_LINE_BREAK;

/** The bullet a bullet list is written with. */
const BULLET = "-";

/**
 * The bullet a bullet list is written with when its first line is a bare
 * marker right under a line of text, where a bare `-` would be a setext
 * underline.
 */
const UNDER_TEXT_BULLET = "*";

/** The whole-cell texts the table import reads as merge continuations, so a cell holding one is escaped. */
const MERGE_MARKERS: ReadonlySet<string> = new Set(["<<", "^^"]);

/**
 * The shortest code fence CommonMark accepts (three backticks or tildes). A
 * fixed grammar constant, not a tuning value: a fence only grows past it when
 * the code itself holds a line starting with that many of its character.
 */
const MIN_CODE_FENCE_LENGTH = 3;

/**
 * A code line's leading backtick and tilde runs, after the up-to-three spaces
 * of indentation CommonMark still reads as a closing fence.
 */
const CODE_LINE_FENCE_RUN = /^ {0,3}(`+|~+)/;

/**
 * A URL CommonMark accepts inside an angle-bracket autolink: a scheme of two
 * to thirty-two characters (the spec's own bounds), a colon, and no space,
 * `<` or `>`.
 */
const AUTOLINK_URL = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/;

/**
 * An email address CommonMark accepts inside an angle-bracket autolink — the
 * spec's own definition, whose `{0,61}` caps each domain label at the DNS
 * limit of 63 characters.
 */
const AUTOLINK_EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** The characters that open an inline construct wherever they stand, so text always escapes them. */
const ALWAYS_ESCAPED: ReadonlySet<string> = new Set(["`", "*", "~", "[", "]"]);

/** The characters that start a block (heading, quote, list, setext underline, table, fence) at a line start. */
const LINE_START_ESCAPED: ReadonlySet<string> = new Set(["#", ">", "-", "+", "*", "=", "|", ":", "~", "`"]);

/**
 * An ordered-list marker at a line start: one to nine digits (CommonMark's
 * limit for a list number) then `.` or `)`.
 */
const ORDERED_LIST_MARKER = /^(\d{1,9})[.)]/;

/** ASCII punctuation: the characters a backslash escapes in CommonMark. */
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;

/** A letter or digit in any script — the characters an intraword `_` sits between. */
const WORD_CHARACTER = /^[\p{L}\p{N}]$/u;

/** The text before a `:` that makes it the colon of a GFM bare-URL autolink scheme. */
const BARE_URL_SCHEME = /(?:https?|ftp)$/i;

/** The scheme a GFM bare-URL autolink starts with. */
const BARE_URL_SCHEME_PREFIX = /^(?:https?|ftp):\/\//i;

/**
 * The text of a link written as a bare autolink: no character that ends a
 * bare URL (whitespace, `<`), that `marked` reads as other syntax around it,
 * or that a table cell escapes, and a last character `marked` does not trim.
 */
const BARE_AUTOLINK_TEXT = /^[^\s<>[\]\\`|]*[A-Za-z0-9/]$/;

/** The text before a `.` that makes it the dot of a GFM `www.` autolink. */
const BARE_WWW_PREFIX = /www$/i;

/** A character of the local part of a GFM bare email autolink. */
const EMAIL_LOCAL_CHARACTER = /^[A-Za-z0-9._+-]$/;

/** A character of the domain of a GFM bare email autolink. */
const EMAIL_DOMAIN_CHARACTER = /^[A-Za-z0-9_-]$/;

/** The highest C0 control character code; a link destination holding one must be written in angle brackets. */
const LAST_C0_CONTROL = 0x1f;

/** The DEL control character's code, the one control character above the C0 range. */
const DELETE_CHARACTER = 0x7f;

/**
 * How many times one block's inline Markdown is read back with the viewer's
 * lexer while looking for a writing that reads as the editor shows it. Each
 * read-back lexes the block once; the cap bounds the cost of a block no
 * writing keeps, which is then written the first way. It covers every
 * writing policy with a round of delimiter switches each on a block of a few
 * dozen marks; the serializer fuzz found no repairable block needing more.
 */
const MAX_READ_BACKS = 64;

/** Separates the parts of one reading unit's key: no Markdown text holds it. */
const READING_KEY_SEPARATOR = "\u0000";

/** The reading unit of a line break. */
const BREAK_READING = "\u0001break";

// ---------------------------------------------------------------- types

/** Where inline content is being written. */
interface InlineContext {
    /** The content cannot span lines (headings, table cells). */
    readonly singleLine: boolean;
    /** Escape every `|`; a `\` before `n` is escaped; a `LineBreakNode` writes the cell break. */
    readonly inTableCell: boolean;
    /**
     * Leave a `~` unescaped unless another `~` touches it. An escaped `\~` is
     * punctuation to `marked`, where a lone `~` reads as a letter next to `*`;
     * set only for a writing that is then read back, since two lone tildes
     * can pair as strikethrough.
     */
    readonly looseTildes?: boolean;
    /**
     * Escape every `<`. `marked` hides a `<…>` stretch from emphasis pairing,
     * so a `<` that opens no tag still keeps delimiters between it and a
     * later `>` from pairing; set only for a writing that is then read back.
     */
    readonly escapedAngles?: boolean;
}

/** The context of a paragraph, quote or list item. */
const MULTI_LINE: InlineContext = { singleLine: false, inTableCell: false };

/** The context of a heading. */
const HEADING_LINE: InlineContext = { singleLine: true, inTableCell: false };

/** The context of a table cell's paragraph. */
const TABLE_CELL: InlineContext = { singleLine: true, inTableCell: true };

/** An emphasis-like mark, written as a delimiter pair. `code` is handled separately, as a code span. */
type Mark = "bold" | "italic" | "strike" | "underline";

/** The fixed order marks are opened in, outermost first. */
const MARK_ORDER: readonly Mark[] = ["bold", "italic", "strike", "underline"];

/** The marks the editor does not draw on whitespace (underline and strikethrough draw a line across it). */
const UNDRAWN_ON_WHITESPACE: readonly Mark[] = ["bold", "italic"];

/** Each mark's delimiter. */
const MARK_DELIMITERS: Readonly<Record<Mark, string>> = { bold: "**", italic: "*", strike: "~~", underline: "++" };

/** The `_` delimiter a bold or italic pair switches to when `marked` would mis-pair its `*` one. */
const UNDERSCORE_DELIMITERS: Readonly<Partial<Record<Mark, string>>> = { bold: "__", italic: "_" };

/** A Unicode punctuation or symbol character: what `marked`'s flanking rules count as punctuation. */
const FLANKING_PUNCTUATION = /^[\p{P}\p{S}]$/u;

/** The Lexical text format each mark reads. */
const MARK_FORMATS: Readonly<Record<Mark, TextFormatType>> = {
    bold: "bold", italic: "italic", strike: "strikethrough", underline: "underline",
};

/** One flattened piece of inline content. */
type Segment =
    | { kind: "text"; text: string; marks: Mark[]; code: boolean; style: string; link: LinkNode | null }
    | { kind: "image"; node: MarkdownImageNode; link: LinkNode | null }
    | { kind: "break"; marker: string; link: LinkNode | null };

/** One block of a list item's content, before its indentation. */
interface ItemBlock {
    /** The block's Markdown. */
    readonly markdown: string;
    /** Whether it is a nested list, written right under the item's text or the list before it. */
    readonly isList: boolean;
    /** Whether it is text: the item's inline content, or a paragraph. */
    readonly isText: boolean;
}

/** A text segment. */
type TextSegment = Extract<Segment, { kind: "text" }>;

/** A run of segments with one span style, written `[…]{style}`. */
interface StyleGroup { kind: "style"; style: string; units: Segment[] }

/** A run of segments with one link, written `[…](…)` or as an autolink. */
interface LinkGroup { kind: "link"; link: LinkNode; units: Array<Segment | StyleGroup> }

/** What the inline writer walks: a segment or a group of them. */
type Unit = Segment | StyleGroup | LinkGroup;

/** One piece of written inline output, before escaping and line assembly. */
type Piece =
    | { kind: "text"; text: string }        // literal text, escaped once its neighbours are known
    | { kind: "syntax"; text: string }      // Markdown syntax, written as is
    | { kind: "delimiter"; text: string; mark: Mark; opens: boolean } // an emphasis delimiter, written as is
    | { kind: "autolink"; text: string; bare: string } // `bare` where its neighbours bound it, else `text`
    | { kind: "break"; marker: string };    // a hard line break with its marker

/** A piece of one assembled line: hard breaks have become line ends. */
type LinePiece = Exclude<Piece, { kind: "break" }>;

/**
 * A way of writing a block's marks. Where delimiters meet each other or
 * punctuation, the order marks open in and where they stand decide whether
 * `marked` reads them; {@link serializeInlineNodes} tries the policies in
 * {@link WRITING_POLICIES} order and keeps the first writing that reads back
 * as the editor shows the block.
 */
interface WritingPolicy {
    /** Underline opens outside the other marks it opens with, so they open and close next to its `++`. */
    readonly underlineOutermost: boolean;
    /** A mark covering a whole link or styled span closes before it and opens again inside it. */
    readonly marksInsideGroups: boolean;
    /**
     * When set, the open marks are kept in this order, outermost first: a
     * mark opening outside one already open closes that one and opens it
     * again inside (`~~a~~*~~b~~*c`).
     */
    readonly rank: readonly Mark[] | null;
}

/**
 * The writing policies, in the order they are tried: the stack rules as the
 * plan writes them first, then underline outermost, then marks inside links
 * and spans, then the marks reopened in a fixed order: underline outermost
 * and strikethrough innermost, since `~~` reads as a letter next to `*`;
 * underline innermost, so a delimiter opening before punctuation opens
 * against a `++`; strikethrough outermost, so emphasis opening inside it
 * opens against punctuation for `_`.
 */
const WRITING_POLICIES: readonly WritingPolicy[] = [
    { underlineOutermost: false, marksInsideGroups: false, rank: null },
    { underlineOutermost: true,  marksInsideGroups: false, rank: null },
    { underlineOutermost: false, marksInsideGroups: true,  rank: null },
    { underlineOutermost: true,  marksInsideGroups: true,  rank: null },
    { underlineOutermost: true,  marksInsideGroups: false, rank: ["underline", "bold", "italic", "strike"] },
    { underlineOutermost: true,  marksInsideGroups: true,  rank: ["underline", "bold", "italic", "strike"] },
    { underlineOutermost: false, marksInsideGroups: false, rank: ["bold", "italic", "strike", "underline"] },
    { underlineOutermost: false, marksInsideGroups: false, rank: ["strike", "underline", "bold", "italic"] },
];

/**
 * The choices a block's lines are assembled with, beyond the writer's: the
 * bold and italic pairs (by their order of opening) written with the other
 * delimiter character than the stack rules chose, and the bare autolinks
 * written bare even where their neighbours do not visibly bound them.
 */
interface AssemblyChoices {
    readonly switched: ReadonlySet<number>;
    readonly bare: ReadonlySet<Piece>;
}

/** No choices: the block assembled as the writer wrote it. */
const NO_CHOICES: AssemblyChoices = { switched: new Set(), bare: new Set() };

/**
 * Reads a block's Markdown back with the viewer's lexer and scores it
 * against the block's reading, at most {@link MAX_READ_BACKS} times.
 */
interface ReadBack {
    /**
     * Scores Markdown by how far it reads as the editor shows the block.
     *
     * @param markdown - The block's inline Markdown.
     * @returns The number of leading reading units that match, or `Infinity` when all do.
     */
    score(markdown: string): number;
    /** Whether the read-backs are spent. */
    spent(): boolean;
}

/** What a run of tokens inherits as it is read: its marks, link and span style. */
interface ReadingScope {
    readonly marks: readonly string[];
    readonly link: string;
    readonly style: string;
}

/** The inline writer's state: the output so far, the open marks, and whitespace held back. */
interface InlineWriter {
    readonly pieces: Piece[];
    readonly context: InlineContext;
    /** How the writer places marks. */
    readonly policy: WritingPolicy;
    /** The marks open at the current group level, outermost first. */
    stack: Mark[];
    /** Trailing whitespace of the last text, written after any delimiter that closes next. */
    pending: string;
    /** Whether the held-back whitespace is underlined, so an underline closing next writes it before its delimiter. */
    pendingUnderline: boolean;
    /** Whether the output is inside a link's text. */
    inLink: boolean;
    /** Computes the order the next unit's missing marks open in, outermost first. */
    openOrder: () => readonly Mark[];
}

// ---------------------------------------------------------------- entry points

/**
 * Serializes the active editor state's document to Markdown in this
 * dialect. Like `@lexical/markdown`'s `$convertToMarkdownString`, it must
 * run inside an `editor.read` or `editor.update`.
 *
 * @returns The Markdown: blocks joined by one blank line, no trailing newline.
 */
export function $serializeMarkdown(): string {
    return serializeBlockList($getRoot().getChildren());
}

/**
 * Renders a delimiter row from the header cells' formats and the table's
 * column widths. A `0` (or `null`) width is `@lexical/table`'s own "no width"
 * sentinel for `TableNode.getColWidths()`, so it re-emits with no `{width=…}`.
 *
 * @param alignments - One {@link ElementFormatType} per column.
 * @param widths - One column width (in pixels) per column, or `null`/`0` for none.
 * @returns The rendered delimiter-row line.
 *
 * @example
 * ```
 * formatDelimiterRow(["left", "center", "right", ""], [240, null, null, null])
 * // -> "| :--- {width=240} | :---: | ---: | --- |"
 * ```
 */
export function formatDelimiterRow(alignments: ElementFormatType[], widths: readonly (number | null)[]): string {
    const cells = alignments.map((alignment, index) => {
        const dashes = (() => {
            switch (alignment) {
                case "left":   return ":---";
                case "center": return ":---:";
                case "right":  return "---:";
                default:       return "---";
            }
        })();

        const width = widths[index];

        return width !== null && width !== 0 && width !== undefined ? `${dashes} {width=${width}}` : dashes;
    });

    return "| " + cells.join(" | ") + " |";
}

// ---------------------------------------------------------------- blocks

/**
 * Serializes a list of block nodes, dropping the ones that write nothing
 * (empty paragraphs).
 *
 * @param nodes - The blocks, in document order.
 * @returns The blocks joined by one blank line.
 */
function serializeBlockList(nodes: LexicalNode[]): string {
    return nodes
        .map((node) => serializeBlock(node))
        .filter((markdown) => markdown !== "")
        .join(BLOCK_SEPARATOR);
}

/**
 * Serializes one block node.
 *
 * @param node - The block.
 * @returns Its Markdown, or `""` when it writes nothing.
 */
function serializeBlock(node: LexicalNode): string {
    if ($isParagraphNode(node)) {
        return serializeInline(node, MULTI_LINE);
    }

    if ($isHeadingNode(node)) {
        return serializeHeading(node);
    }

    if ($isQuoteNode(node)) {
        return serializeQuote(node);
    }

    if ($isCodeNode(node)) {
        return serializeCode(node);
    }

    if ($isListNode(node)) {
        return serializeList(node);
    }

    if ($isTableNode(node)) {
        return serializeTable(node);
    }

    if ($isMarkdownBlockNode(node)) {
        return serializeFence(node);
    }

    return $isElementNode(node) ? serializeBlockList(node.getChildren()) : node.getTextContent();
}

/**
 * Serializes an ATX heading. A trailing `#` run that the heading rule would
 * strip as a closing sequence has its first `#` escaped.
 *
 * @param node - The heading.
 * @returns `#`×level, then a space and the content when there is any.
 */
function serializeHeading(node: HeadingNode): string {
    const level = Number(node.getTag().slice(1));
    const content = serializeInline(node, HEADING_LINE).replace(/(^|[ \t])(#+)$/, "$1\\$2");

    return "#".repeat(level) + (content === "" ? "" : " " + content);
}

/**
 * Serializes a quote: every line of its content prefixed `> `.
 *
 * @param node - The quote.
 * @returns The quoted lines, or `>` for an empty quote.
 */
function serializeQuote(node: QuoteNode): string {
    const content = serializeInline(node, MULTI_LINE);

    if (content === "") {
        return ">";
    }

    return content.split("\n").map((line) => (line === "" ? ">" : "> " + line)).join("\n");
}

/**
 * Serializes a fenced code block: a backtick fence, or a `~` one when the
 * info string holds a backtick (which a backtick fence's info string cannot),
 * longer than any run of the fence's character that starts one of its lines.
 *
 * @param node - The code block.
 * @returns The fenced code.
 */
function serializeCode(node: CodeNode): string {
    const code = node.getTextContent();
    const info = node.getLanguage() ?? "";
    const char = info.includes("`") ? "~" : "`";

    const longestRun = Math.max(0, ...code.split("\n").map((line) => {
        const run = CODE_LINE_FENCE_RUN.exec(line)?.[1] ?? "";

        return run.startsWith(char) ? run.length : 0;
    }));

    const fence = char.repeat(Math.max(MIN_CODE_FENCE_LENGTH, longestRun + 1));

    return fence + info + "\n" + (code === "" ? "" : code + "\n") + fence;
}

/**
 * Indents every non-empty line of `markdown` by `indent` (a blank line stays
 * empty, so no whitespace-only line is written).
 *
 * @param markdown - One or more lines.
 * @param indent - The indentation to prefix.
 * @returns The indented lines.
 */
function indentLines(markdown: string, indent: string): string[] {
    return markdown.split("\n").map((line) => (line === "" ? line : indent + line));
}

/**
 * Serializes a list. An item whose first child is a list — Lexical's shape
 * for a nested list, which it numbers and shows as part of the item before
 * it — adds its blocks to that item, indented by its marker width plus one.
 *
 * @param list - The list.
 * @param underText - Whether the list's first line follows a line of text in
 *   the same container: a bare `-` marker there would be a setext underline,
 *   so a bullet list whose first line is a bare marker is written with `*`.
 * @returns One line or more per item, joined by newlines.
 */
function serializeList(list: ListNode, underText = false): string {
    const items: ItemBlock[][] = [];

    for (const item of list.getChildren().filter($isListItemNode)) {
        const continues = $isListNode(item.getFirstChild()) && items.length > 0;
        const blocks = continues ? items[items.length - 1]! : [];

        appendItemBlocks(item, blocks);

        if (!continues) {
            items.push(blocks);
        }
    }

    const firstLineBare = items[0] !== undefined && (items[0].length === 0 || items[0][0]!.isList);
    const bullet = underText && firstLineBare ? UNDER_TEXT_BULLET : BULLET;

    return items.map((blocks, index) => {
        const marker = list.getListType() === "number" ? `${list.getStart() + index}.` : bullet;

        return listItemLines(marker, blocks).join("\n");
    }).join("\n");
}

/**
 * Appends a list item's blocks: each run of inline children as one block, and
 * each block child (a paragraph, a nested list, or any other block a command
 * put there) as its own. Empty blocks are dropped.
 *
 * @param item - The list item.
 * @param blocks - The blocks of the item it belongs to. Extended in place.
 */
function appendItemBlocks(item: ListItemNode, blocks: ItemBlock[]): void {
    let inline: LexicalNode[] = [];

    const push = (markdown: string, isList: boolean, isText: boolean): void => {
        if (markdown !== "") {
            blocks.push({ markdown, isList, isText });
        }
    };

    const flushInline = (): void => {
        push(serializeInlineNodes(inline, MULTI_LINE), false, true);
        inline = [];
    };

    for (const child of item.getChildren()) {
        if (!$isElementNode(child) || child.isInline()) {
            inline.push(child);

            continue;
        }

        flushInline();

        if ($isListNode(child)) {
            const previous = blocks[blocks.length - 1];

            push(serializeList(child, previous !== undefined && !previous.isList), true, false);
        } else {
            push(serializeBlock(child), false, $isParagraphNode(child));
        }
    }

    flushInline();
}

/**
 * Writes one list item: its marker and its first block's first line, then the
 * rest indented under it. A nested list follows the item's own text — its
 * first block, a paragraph — directly; any other block follows a blank line,
 * so it is not read as a continuation of the block before it: a table would
 * read a nested list's lines as rows, and a paragraph after the item's text
 * would take in an ordered list that does not start at 1. An item whose
 * first block is a nested list writes its marker alone, with the list on the
 * lines below.
 *
 * @param marker - The item's marker (`-`, `3.`, …).
 * @param blocks - The item's blocks.
 * @returns The item's lines.
 */
function listItemLines(marker: string, blocks: readonly ItemBlock[]): string[] {
    const indent = " ".repeat(marker.length + 1);
    const lines: string[] = [];

    blocks.forEach((block, index) => {
        const followsText = index === 1 && blocks[0]!.isText;

        if (index > 0 && !(block.isList && (followsText || blocks[index - 1]!.isList))) {
            lines.push("");
        }

        lines.push(...indentLines(block.markdown, indent));
    });

    if (blocks[0] === undefined || blocks[0].isList) {
        return [marker, ...lines];
    }

    return [`${marker} ${lines[0]!.slice(indent.length)}`, ...lines.slice(1)];
}

/**
 * Serializes a GFM pipe table: header row, delimiter row (alignment from the
 * header cells, widths from the table) and body rows, writing a cell's
 * column span as `<<` continuations and its row span as `^^` ones. A body
 * row wider than the header — an edit can leave one — widens the table with
 * empty header cells, since `marked` drops a cell beyond the header's
 * columns.
 *
 * @param table - The table.
 * @returns The table's lines, or `""` for a table with no rows.
 */
function serializeTable(table: TableNode): string {
    const rows = table.getChildren().filter($isTableRowNode);

    if (rows.length === 0) {
        return "";
    }

    const headerCells = rows[0]!.getChildren().filter($isTableCellNode);
    const columnCount = Math.max(headerCells.length, ...rows.slice(1).map((row) => rowWidth(row)));
    const padding = new Array<string>(columnCount - headerCells.length).fill("");
    const alignments = [...headerCells.map((cell) => cell.getFormatType()), ...padding as ElementFormatType[]];
    const pendingRowSpans = new Map<number, number>();

    const lines = [
        formatPipeRow([...headerCells.map((cell) => serializeTableCell(cell)), ...padding]),
        formatDelimiterRow(alignments, table.getColWidths() ?? []),
    ];

    for (const row of rows.slice(1)) {
        lines.push(formatPipeRow(serializeBodyRow(row, columnCount, pendingRowSpans)));
    }

    return lines.join("\n");
}

/**
 * The number of columns a row's own cells cover, their column spans
 * counted.
 *
 * @param row - The row.
 * @returns The columns its cells cover.
 */
function rowWidth(row: TableRowNode): number {
    return row.getChildren().filter($isTableCellNode).reduce((width, cell) => width + cell.getColSpan(), 0);
}

/**
 * Joins cell texts into one pipe row.
 *
 * @param cells - The cells' Markdown.
 * @returns The row line.
 */
function formatPipeRow(cells: string[]): string {
    return "| " + cells.join(" | ") + " |";
}

/**
 * Writes one body row's cell texts. A cell's `colSpan` writes that many `<<`
 * continuations after it; a `rowSpan` above 1 registers a pending `^^` for
 * the columns it covers, consumed one row at a time — the reverse of the
 * import-side merge grid.
 *
 * @param row - The body row.
 * @param columnCount - The table's column count (the header's cell count).
 * @param pendingRowSpans - Per column, how many more rows a span above still covers. Updated in place.
 * @returns One text per column.
 */
function serializeBodyRow(row: TableRowNode, columnCount: number, pendingRowSpans: Map<number, number>): string[] {
    const cells = row.getChildren().filter($isTableCellNode);
    const texts: string[] = [];
    let cellIndex = 0;

    for (let column = 0; column < columnCount; column += 1) {
        const pending = pendingRowSpans.get(column) ?? 0;

        if (pending > 0) {
            texts.push("^^");
            pendingRowSpans.set(column, pending - 1);

            continue;
        }

        const cell = cells[cellIndex];

        cellIndex += 1;

        if (cell === undefined) {
            texts.push("");

            continue;
        }

        texts.push(serializeTableCell(cell));
        column = writeCellSpans(cell, column, texts, pendingRowSpans);
    }

    return texts;
}

/**
 * Writes a cell's column span as `<<` continuations and registers its row
 * span for the rows below.
 *
 * @param cell - The cell just written.
 * @param column - The cell's own column.
 * @param texts - The row's texts so far. Extended in place.
 * @param pendingRowSpans - The pending row spans. Updated in place.
 * @returns The last column the cell covers.
 */
function writeCellSpans(cell: TableCellNode, column: number, texts: string[], pendingRowSpans: Map<number, number>): number {
    const colSpan = cell.getColSpan();
    const rowSpan = cell.getRowSpan();
    const lastColumn = column + colSpan - 1;

    for (let covered = column + 1; covered <= lastColumn; covered += 1) {
        texts.push("<<");
    }

    if (rowSpan > 1) {
        for (let covered = column; covered <= lastColumn; covered += 1) {
            pendingRowSpans.set(covered, rowSpan - 1);
        }
    }

    return lastColumn;
}

/**
 * Serializes a table cell's paragraphs onto one line, joined by
 * {@link CELL_PARAGRAPH_BREAK}. An empty paragraph keeps its boundaries, so
 * the blank line the editor shows for it stays a break in the viewer, which
 * renders one `<br>` per boundary even at the cell's edges. A paragraph
 * opening with an emphasis delimiter is written after a space, since the
 * break ends in a letter the delimiter could not open against. A cell whose
 * whole text is a merge marker is escaped so it reads back as content.
 *
 * @param cell - The cell.
 * @returns The cell's text for its pipe row.
 */
function serializeTableCell(cell: TableCellNode): string {
    const text = cell.getChildren()
        .map((child) => serializeCellChild(child))
        .map((paragraph, index) => (index > 0 && /^[*_~]/.test(paragraph) ? " " + paragraph : paragraph))
        .join(CELL_PARAGRAPH_BREAK)
        .trim();

    return MERGE_MARKERS.has(text) ? "\\" + text : text;
}

/**
 * Serializes one child of a table cell as single-line inline content. A pipe
 * table's cell holds inline content only, so any other block a command nests
 * in a cell — a heading, quote or code block — is written as the inline
 * content the editor shows, and a list as each item's content on a line of
 * its own: their own syntax would show as literal text (`# t`) and read back
 * into the cell's text.
 *
 * @param child - The cell's child.
 * @returns Its text for the pipe row.
 */
function serializeCellChild(child: LexicalNode): string {
    if (!$isListNode(child)) {
        return serializeInlineNodes($isElementNode(child) ? child.getChildren() : [child], TABLE_CELL);
    }

    return child.getChildren().filter($isListItemNode).flatMap((item) => {
        const children = item.getChildren();
        const inline = children.filter((node) => !$isListNode(node));
        const lines = inline.length > 0 ? [serializeInlineNodes(inline, TABLE_CELL)] : [];

        return [...lines, ...children.filter($isListNode).map((list) => serializeCellChild(list))];
    }).join(CELL_PARAGRAPH_BREAK);
}

/**
 * Serializes a `:::` fence: `columns` when it has two or more, its
 * attributes, and `{}` for a one-column fence with none (a bare `:::` cannot
 * open a fence).
 *
 * @param node - The fence.
 * @returns The fence, or its children's blocks when it has no columns.
 */
function serializeFence(node: MarkdownBlockNode): string {
    const columns = node.getColumns();

    if (columns.length === 0) {
        return serializeBlockList(node.getChildren());
    }

    const attributes = fenceAttributeText(node);

    const opening = ":::"
        + (columns.length > 1 ? " columns" : "")
        + (attributes !== "" ? ` {${attributes}}` : columns.length > 1 ? "" : " {}");

    const body = joinColumnSections(columns.map((column) => serializeBlockList(column.getChildren())));

    return `${opening}\n${body}\n:::`;
}

/**
 * Reads the attribute text a fence is written with: the authored text it was
 * loaded with ({@link fenceAttributesState}) while that text still resolves
 * to the fence's alignment and column gap — keeping the attributes' order and
 * the ones the editor does not model — else its style as normalized
 * attribute text.
 *
 * @param node - The fence.
 * @returns The attribute text (`align=right …`), or `""` for none.
 */
function fenceAttributeText(node: MarkdownBlockNode): string {
    const normalized = formatAttributes(node.toAttributes());
    const authored = $getState(node, fenceAttributesState);
    const writable = authored !== "" && !/[\n{}]/.test(authored);

    return writable && formatAttributes(blockStyleToAttributes(resolveBlockStyle(parseAttributes(authored)))) === normalized ? authored : normalized;
}

// ---------------------------------------------------------------- inline: flatten and group

/**
 * Serializes an element's inline content.
 *
 * @param element - The paragraph, heading, quote, list item or cell paragraph.
 * @param context - Where the content is written.
 * @returns The content; lines are separated by `\n` unless `context.singleLine`.
 */
function serializeInline(element: ElementNode, context: InlineContext): string {
    return serializeInlineNodes(element.getChildren(), context);
}

/**
 * Serializes a run of inline nodes. The Markdown is read back with the
 * viewer's own lexer: when its emphasis would read differently from what the
 * editor shows, the block is written by the next {@link WRITING_POLICIES}
 * policy, each with its bold and italic pairs switched between `*` and `_`
 * where that helps, and the first writing that reads back as written is
 * kept; with none, the first. A block with no mark, bare autolink or `~` —
 * nothing another writing could change — is written without the read-back.
 * A block holding a `~` is tried again with its lone tildes unescaped, and
 * one holding a `<` with every `<` escaped (a `<…>` stretch hides its
 * delimiters from `marked`'s emphasis pairing). Bare autolinks are then written bare wherever that still reads the same, so
 * their source text — and a heading's id — survives.
 *
 * @param nodes - The inline nodes.
 * @param context - Where the content is written.
 * @returns The content; lines are separated by `\n` unless `context.singleLine`.
 */
function serializeInlineNodes(nodes: LexicalNode[], context: InlineContext): string {
    const segments = withoutEdgeBreaks(flattenInline(nodes), context);
    const holds = (char: string): boolean => segments.some((segment) => segment.kind === "text" && !segment.code && segment.text.includes(char));
    const tildes = holds("~");
    const written = writeInlinePieces(segments, context, WRITING_POLICIES[0]!);

    if (!tildes && !written.some((piece) => piece.kind === "delimiter" || piece.kind === "autolink")) {
        return assembleLines(written, context);
    }

    const readBack = createReadBack(segmentReading(segments, context), context);
    let first: string | null = null;

    const writings = tildes ? [context, { ...context, looseTildes: true }] : [context];

    for (const writing of holds("<") ? [...writings, ...writings.map((loose) => ({ ...loose, escapedAngles: true }))] : writings) {
        for (const policy of WRITING_POLICIES) {
            const pieces = writing === context && policy === WRITING_POLICIES[0] ? written : writeInlinePieces(segments, writing, policy);
            const switched = switchedPairs(pieces, writing, readBack);

            first ??= assembleLines(pieces, writing);

            if (switched !== null) {
                return assembleLines(pieces, writing, { switched, bare: bareAutolinks(pieces, writing, switched, readBack) });
            }

            if (readBack.spent()) {
                return first;
            }
        }
    }

    return first!;
}

/**
 * Writes a block's segments as pieces under one writing policy.
 *
 * @param segments - The block's segments.
 * @param context - Where the content is written.
 * @param policy - How marks are placed.
 * @returns The written pieces.
 */
function writeInlinePieces(segments: Segment[], context: InlineContext, policy: WritingPolicy): Piece[] {
    const writer: InlineWriter = {
        pieces: [], context, policy, stack: [], pending: "", pendingUnderline: false, inLink: false, openOrder: () => MARK_ORDER,
    };

    writeUnits(writer, groupSegments(segments), []);
    closeMarks(writer, 0);
    flushPending(writer);

    return writer.pieces;
}

/**
 * Finds which bold and italic pairs to switch between `*` and `_` so the
 * block reads back as the editor shows it: none when it already does, else,
 * greedily, the switch that reads furthest each round.
 *
 * @param pieces - The block's written pieces.
 * @param context - Where the content is written.
 * @param readBack - The block's read-back.
 * @returns The pairs to switch, or `null` when no switch makes the block read as written.
 */
function switchedPairs(pieces: Piece[], context: InlineContext, readBack: ReadBack): ReadonlySet<number> | null {
    const pairCount = pieces.filter((piece) => piece.kind === "delimiter" && piece.opens && UNDERSCORE_DELIMITERS[piece.mark] !== undefined).length;
    let switched: ReadonlySet<number> = new Set();
    let best = readBack.score(assembleLines(pieces, context));

    while (best !== Infinity && !readBack.spent()) {
        let next: { switched: ReadonlySet<number>; score: number } | null = null;

        for (let pair = 0; pair < pairCount && !readBack.spent(); pair += 1) {
            const candidate = new Set(switched);

            if (!candidate.delete(pair)) {
                candidate.add(pair);
            }

            const score = readBack.score(assembleLines(pieces, context, { switched: candidate, bare: NO_CHOICES.bare }));

            if (score > (next?.score ?? best)) {
                next = { switched: candidate, score };
            }
        }

        if (next === null) {
            return null;
        }

        switched = next.switched;
        best = next.score;
    }

    return best === Infinity ? switched : null;
}

/**
 * Picks the bare autolinks to write bare although their neighbours do not
 * visibly bound them: each one next to punctuation, not a letter or digit —
 * a bare URL run into a word would merge with it to the eye and to most
 * readers — whose bare form still reads back as the editor shows the block
 * (`<https://a.test>www.b.test`).
 *
 * @param pieces - The block's written pieces.
 * @param context - Where the content is written.
 * @param switched - The block's switched pairs.
 * @param readBack - The block's read-back.
 * @returns The autolink pieces to write bare.
 */
function bareAutolinks(pieces: Piece[], context: InlineContext, switched: ReadonlySet<number>, readBack: ReadBack): ReadonlySet<Piece> {
    const bare = new Set<Piece>();

    for (const [index, piece] of pieces.entries()) {
        const before = pieces[index - 1];
        const after = pieces[index + 1];

        if (piece.kind !== "autolink" || readBack.spent()
            || (before?.kind === "text" && WORD_CHARACTER.test(before.text.at(-1) ?? ""))
            || (after?.kind === "text" && WORD_CHARACTER.test(after.text[0] ?? ""))) {
            continue;
        }

        bare.add(piece);

        if (readBack.score(assembleLines(pieces, context, { switched, bare })) !== Infinity) {
            bare.delete(piece);
        }
    }

    return bare;
}

/**
 * Creates a block's read-back, which caches each scored Markdown.
 *
 * @param intended - The block's reading, as the editor shows it.
 * @param context - Where the content is written.
 * @returns The read-back.
 */
function createReadBack(intended: readonly string[], context: InlineContext): ReadBack {
    const scores = new Map<string, number>();
    let readBacks = 0;

    return {
        score(markdown: string): number {
            const cached = scores.get(markdown);

            if (cached !== undefined) {
                return cached;
            }

            readBacks += 1;

            const score = readingScore(markdownReading(markdown, context), intended);

            scores.set(markdown, score);

            return score;
        },
        spent: () => readBacks >= MAX_READ_BACKS,
    };
}

/**
 * Scores a reading against the intended one.
 *
 * @param reading - The Markdown's reading, or `null` when it did not lex as the block.
 * @param intended - The block's reading, as the editor shows it.
 * @returns The number of leading units that match, or `Infinity` when the readings are equal.
 */
function readingScore(reading: readonly string[] | null, intended: readonly string[]): number {
    if (reading === null) {
        return 0;
    }

    const mismatch = intended.findIndex((unit, index) => reading[index] !== unit);

    if (mismatch !== -1) {
        return mismatch;
    }

    return reading.length === intended.length ? Infinity : intended.length;
}

/**
 * Flattens inline nodes and their descendants into segments, descending into
 * links and other inline elements, and merges adjacent text segments that
 * share their formatting — code segments into one code span — so a text
 * split into several nodes of one format is written as one node is (Lexical
 * joins such nodes only when it commits an update).
 *
 * @param nodes - The inline nodes.
 * @returns The segments, in document order.
 */
function flattenInline(nodes: LexicalNode[]): Segment[] {
    const segments: Segment[] = [];

    appendSegments(nodes, null, segments);

    return canonicalWhitespaceMarks(segments).reduce<Segment[]>((merged, segment) => {
        const last = merged[merged.length - 1];

        if (last?.kind === "text" && segment.kind === "text" && last.code === segment.code && sameFormatting(last, segment)) {
            merged[merged.length - 1] = { ...last, text: last.text + segment.text };
        } else {
            merged.push(segment);
        }

        return merged;
    }, []);
}

/**
 * Settles the marks the editor does not draw on whitespace — bold and
 * italic — on the whitespace at a link's or styled span's edge, to the ones
 * the characters on both sides of it share. The writer leaves whitespace at
 * a run's edge outside its delimiters, and at a group's edge it cannot keep
 * a run open across the group's brackets, so a save read back can carry
 * those marks otherwise on such whitespace while it reads the same; and
 * whether a link or styled span carries a mark whole decides where that mark
 * is written ({@link commonMarks}). Settled, both forms are written alike,
 * and a save loaded and saved again is unchanged. Whitespace away from a
 * group's edge is written as it is marked, and whitespace with an image, a
 * break or the edge of the content on either side keeps its marks.
 *
 * @param segments - The flattened segments.
 * @returns The segments, edge whitespace split off where it is settled.
 */
function canonicalWhitespaceMarks(segments: readonly Segment[]): Segment[] {
    const pieces = segments.flatMap(splitEdgeWhitespace);

    return pieces.map((piece, index) => {
        if (piece.kind !== "text" || !isWhitespaceText(piece)) {
            return piece;
        }

        const before = neighbourText(pieces, index, -1);
        const after = neighbourText(pieces, index, 1);
        const atGroupEdge = (neighbour: TextSegment): boolean => neighbour.link !== piece.link || neighbour.style !== piece.style;

        if (before === null || after === null || !(atGroupEdge(before) || atGroupEdge(after))) {
            return piece;
        }

        const settled = (mark: Mark): boolean => (UNDRAWN_ON_WHITESPACE.includes(mark)
            ? before.marks.includes(mark) && after.marks.includes(mark)
            : piece.marks.includes(mark));

        return { ...piece, marks: MARK_ORDER.filter(settled) };
    });
}

/**
 * Splits a text segment's leading and trailing whitespace off into segments
 * of their own, with its formatting; a code segment, or any other, is kept
 * whole.
 *
 * @param segment - The segment.
 * @returns The segment's pieces, in order.
 */
function splitEdgeWhitespace(segment: Segment): Segment[] {
    if (segment.kind !== "text" || segment.code) {
        return [segment];
    }

    const [, leading, core, trailing] = /^(\s*)(.*?)(\s*)$/s.exec(segment.text)!;

    return [leading!, core!, trailing!].filter((text) => text !== "").map((text) => ({ ...segment, text }));
}

/**
 * Tells whether a text segment is whitespace only, outside a code span.
 *
 * @param segment - The text segment.
 * @returns `true` when it is.
 */
function isWhitespaceText(segment: TextSegment): boolean {
    return !segment.code && !/\S/.test(segment.text);
}

/**
 * Finds the nearest text with a visible character on one side of a piece,
 * past whitespace.
 *
 * @param pieces - The pieces.
 * @param index - The piece's index.
 * @param step - `-1` to look before it, `1` after.
 * @returns The text segment, or `null` when an image, a break or the edge of
 *   the content comes first.
 */
function neighbourText(pieces: readonly Segment[], index: number, step: -1 | 1): TextSegment | null {
    for (let at = index + step; at >= 0 && at < pieces.length; at += step) {
        const piece = pieces[at]!;

        if (piece.kind !== "text") {
            return null;
        }

        if (!isWhitespaceText(piece)) {
            return piece;
        }
    }

    return null;
}

/**
 * Tells whether two text segments carry the same marks, style and link.
 *
 * @param a - One segment.
 * @param b - The other.
 * @returns `true` when all three match.
 */
function sameFormatting(a: TextSegment, b: TextSegment): boolean {
    return a.style === b.style && a.link === b.link && a.marks.join() === b.marks.join();
}

/**
 * Appends the segments of `nodes` and their inline descendants.
 *
 * @param nodes - The inline nodes.
 * @param link - The link they sit in, or `null`.
 * @param segments - The list to append to.
 */
function appendSegments(nodes: LexicalNode[], link: LinkNode | null, segments: Segment[]): void {
    for (const node of nodes) {
        if ($isLinkNode(node)) {
            appendSegments(node.getChildren(), node, segments);
        } else if ($isLineBreakNode(node)) {
            segments.push({ kind: "break", marker: $getState(node, hardBreakMarkerState), link });
        } else if ($isMarkdownImageNode(node)) {
            segments.push({ kind: "image", node, link });
        } else if ($isTextNode(node)) {
            segments.push(...textNodeSegments(node, link));
        } else if ($isElementNode(node)) {
            appendSegments(node.getChildren(), link, segments);
        } else {
            segments.push({ kind: "text", text: node.getTextContent(), marks: [], code: false, style: "", link });
        }
    }
}

/**
 * Turns a text node into segments: a hard break, with the default marker,
 * for each newline in its text — the editor's surface (`white-space:
 * pre-wrap`) shows that newline as a line break — and the segments of the
 * lines between.
 *
 * @param node - The text node.
 * @param link - The link it sits in, or `null`.
 * @returns Its segments; none for empty text.
 */
function textNodeSegments(node: TextNode, link: LinkNode | null): Segment[] {
    const marks = MARK_ORDER.filter((mark) => node.hasFormat(MARK_FORMATS[mark]));
    const base: TextSegment = { kind: "text", text: "", marks, code: node.hasFormat("code"), style: spanAttributeText(node), link };

    return node.getTextContent().split("\n").flatMap((line, index): Segment[] => [
        ...(index > 0 ? [{ kind: "break", marker: hardBreakMarkerState.defaultValue, link } as const] : []),
        ...textSegments(line, base),
    ]);
}

/**
 * Turns one line of a text node into segments. Styled text is split at `[`
 * and `]`, which go outside the span (its grammar cannot hold them), and
 * underlined text at `+`, which goes outside the underline (likewise).
 *
 * @param line - The line's text.
 * @param base - The node's segment, its text empty.
 * @returns Its segments; none for empty text.
 */
function textSegments(line: string, base: TextSegment): TextSegment[] {
    const marks = base.marks;
    const separators = (base.style !== "" ? "[]" : "") + (marks.includes("underline") ? "+" : "");
    const segments: TextSegment[] = [];
    let current = "";

    for (const char of line) {
        if (!separators.includes(char)) {
            current += char;

            continue;
        }

        segments.push({ ...base, text: current });

        segments.push(char === "+"
            ? { ...base, text: char, marks: marks.filter((mark) => mark !== "underline") }
            : { ...base, text: char, style: "" });

        current = "";
    }

    segments.push({ ...base, text: current });

    return segments.filter((segment) => segment.text !== "");
}

/**
 * Reads the attribute text a text node's span is written with: the authored
 * text of the span it was loaded from ({@link spanAttributesState}) while
 * that text still resolves to the node's style — keeping the attributes'
 * order and the ones the editor does not model — else the node's style as
 * normalized attribute text, the same pipeline the styled-span transformer
 * and the source mode use.
 *
 * @param node - The text node.
 * @returns The attribute text (`color=red …`), or `""` when unstyled.
 */
function spanAttributeText(node: TextNode): string {
    const css = node.getStyle();
    const normalized = css === "" ? "" : normalizedAttributes(cssTextToAttributes(css));
    const authored = $getState(node, spanAttributesState);
    const writable = authored !== "" && !/[\n|{}]/.test(authored);

    return writable && normalizedAttributes(parseAttributes(authored)) === normalized ? authored : normalized;
}

/**
 * Normalizes span attributes: the style they resolve to, written back as
 * attribute text in the fixed order, unknown and invalid ones dropped.
 *
 * @param attributes - The attribute record.
 * @returns The normalized attribute text, or `""` for no style.
 */
function normalizedAttributes(attributes: Record<string, string>): string {
    return formatAttributes(spanStyleToAttributes(resolveSpanStyle(attributes)));
}

/**
 * Drops the line breaks the block cannot hold. CommonMark reads no hard
 * break after a block's last content — a trailing `\` is a literal
 * backslash, trailing spaces are stripped — so every break with no content
 * after it is dropped; one before the first content is a hard break after an
 * empty line, which a paragraph, quote or list item can open with, so it is
 * kept there, and dropped in a heading, whose breaks are spaces. A table
 * cell keeps them all: the viewer renders its cell break at either edge. A
 * break ending a link's text is moved after the link.
 *
 * @param segments - The block's segments.
 * @param context - Where the block's content is written.
 * @returns The segments the block can write.
 */
function withoutEdgeBreaks(segments: Segment[], context: InlineContext): Segment[] {
    if (context.inTableCell) {
        return segments;
    }

    const hasContent = (segment: Segment): boolean =>
        segment.kind === "image" || (segment.kind === "text" && (segment.code || /\S/.test(segment.text)));

    const first = segments.findIndex(hasContent);
    const last = segments.findLastIndex(hasContent);

    return segments
        .filter((segment, index) => segment.kind !== "break" || (index < last && (index > first || !context.singleLine)))
        .map((segment, index, kept) => (segment.kind === "break" && segment.link !== null && !endsInLink(kept, index)
            ? { ...segment, link: null }
            : segment));
}

/**
 * Tells whether content follows a segment inside its link. `marked` reads no
 * hard break at the end of link text, so a break with none after it there is
 * written after the link, where it still breaks the line.
 *
 * @param segments - The block's segments.
 * @param index - The segment's index.
 * @returns `true` when a later segment of the same link holds visible content.
 */
function endsInLink(segments: readonly Segment[], index: number): boolean {
    const link = segments[index]!.link;

    for (let next = index + 1; next < segments.length && segments[next]!.link === link; next += 1) {
        const segment = segments[next]!;

        if (segment.kind === "image" || (segment.kind === "text" && (segment.code || /\S/.test(segment.text)))) {
            return true;
        }
    }

    return false;
}

/**
 * Splits `items` into runs of consecutive items with an equal key.
 *
 * @param items - The items.
 * @param keyOf - Each item's key.
 * @returns The runs, in order.
 */
function runsOf<T, K>(items: T[], keyOf: (item: T) => K): T[][] {
    const runs: T[][] = [];

    for (const item of items) {
        const last = runs[runs.length - 1];

        if (last !== undefined && keyOf(last[0]!) === keyOf(item)) {
            last.push(item);
        } else {
            runs.push([item]);
        }
    }

    return runs;
}

/**
 * Groups segments by link, and within a link (or outside any) by span style.
 *
 * @param segments - A block's segments.
 * @returns The units the writer walks.
 */
function groupSegments(segments: Segment[]): Unit[] {
    return runsOf(segments, (segment) => segment.link).flatMap((run): Unit[] => {
        const link = run[0]!.link;

        return link === null ? groupStyles(run) : [{ kind: "link", link, units: groupStyles(run) }];
    });
}

/**
 * Groups consecutive styled text segments with the same style; images and
 * breaks end a style group.
 *
 * @param segments - Segments with one link.
 * @returns The segments, styled runs grouped.
 */
function groupStyles(segments: Segment[]): Array<Segment | StyleGroup> {
    const styleOf = (segment: Segment): string => (segment.kind === "text" ? segment.style : "");

    return runsOf(segments, styleOf).flatMap((run): Array<Segment | StyleGroup> => {
        const style = styleOf(run[0]!);

        return style === "" ? run : [{ kind: "style", style, units: run }];
    });
}

// ---------------------------------------------------------------- inline: write

/**
 * Writes units at one group level.
 *
 * @param writer - The writer.
 * @param units - The units.
 * @param inherited - The marks open at enclosing group levels, which every unit here carries.
 */
function writeUnits(writer: InlineWriter, units: readonly Unit[], inherited: readonly Mark[]): void {
    units.forEach((unit, index) => {
        writer.openOrder = () => policyOrder(writer.policy, openingOrder(units, index));

        if (unit.kind === "link" || unit.kind === "style") {
            writeGroup(writer, unit, inherited);
        } else {
            writeSegment(writer, unit, inherited, units[index + 1]);
        }
    });
}

/**
 * The order to open marks in before `units[index]`: a mark carried on across
 * whitespace at a unit boundary — where a mark the next unit lacks closes —
 * outermost, the one carried furthest first; the others in the fixed order.
 * The mark that runs on thereby stays open when the shorter one closes before
 * the whitespace, so the whitespace keeps it (`++*4* 6++`, not
 * `*++4++* ++6++`). Underline, which holds the whitespace at its own edges,
 * opens outside the marks that end with the unit when the unit's text starts
 * or ends with whitespace (`++*a* ++b`). Between letters the fixed order is
 * kept: there, opening a different mark outermost only moves where
 * delimiters meet mid-word.
 *
 * @param units - The units at one group level.
 * @param index - The index of the unit about to be written.
 * @returns The marks, outermost first.
 */
function openingOrder(units: readonly Unit[], index: number): Mark[] {
    const rank = (mark: Mark): number => {
        let end = index;
        let acrossWhitespace = false;

        while (end < units.length && unitCarries(units[end]!, mark)) {
            acrossWhitespace ||= end > index && (unitEdge(units[end - 1]!, "end") || unitEdge(units[end]!, "start"));
            end += 1;
        }

        const holdsEdgeWhitespace = mark === "underline" && end > index
            && (unitEdge(units[index]!, "start") || unitEdge(units[index]!, "end"));

        return acrossWhitespace ? end - index : holdsEdgeWhitespace ? 1 : 0;
    };

    return MARK_ORDER.slice().sort((a, b) => rank(b) - rank(a));
}

/**
 * Applies a writing policy to an opening order: its fixed rank, when it has
 * one, or underline moved outermost.
 *
 * @param policy - The writing policy.
 * @param order - The opening order the stack rules chose.
 * @returns The order to open marks in, outermost first.
 */
function policyOrder(policy: WritingPolicy, order: readonly Mark[]): readonly Mark[] {
    if (policy.rank !== null) {
        return policy.rank;
    }

    return policy.underlineOutermost ? ["underline", ...order.filter((mark) => mark !== "underline")] : order;
}

/**
 * Tells whether a unit's text starts or ends with whitespace.
 *
 * @param unit - The unit.
 * @param edge - Which edge to read.
 * @returns `true` for a text segment, or a group whose edge segment is one,
 *   with whitespace at that edge.
 */
function unitEdge(unit: Unit, edge: "start" | "end"): boolean {
    if (unit.kind === "link" || unit.kind === "style") {
        const inner = edge === "start" ? unit.units[0] : unit.units[unit.units.length - 1];

        return inner !== undefined && unitEdge(inner, edge);
    }

    return unit.kind === "text" && !unit.code && /\s/.test((edge === "start" ? unit.text[0] : unit.text.at(-1)) ?? "");
}

/**
 * Tells whether a unit carries a mark: a text segment that has it, or a
 * group every segment of which does.
 *
 * @param unit - The unit.
 * @param mark - The mark.
 * @returns `true` when the mark covers the whole unit.
 */
function unitCarries(unit: Unit, mark: Mark): boolean {
    if (unit.kind === "link" || unit.kind === "style") {
        return unit.units.every((inner) => unitCarries(inner, mark));
    }

    return unit.kind === "text" && unit.marks.includes(mark);
}

/**
 * Writes one segment, first closing and opening marks to match it. A break
 * carries no marks, and neither does an image, which is written inside the
 * marks {@link imageMarks} chooses so whitespace on either side of it keeps
 * them.
 *
 * @param writer - The writer.
 * @param segment - The segment.
 * @param inherited - The marks open at enclosing group levels.
 * @param next - The unit after it at this level, or `undefined` at the end.
 */
function writeSegment(writer: InlineWriter, segment: Segment, inherited: readonly Mark[], next: Unit | undefined): void {
    if (segment.kind === "text") {
        writeTextSegment(writer, segment, segment.marks.filter((mark) => !inherited.includes(mark)));

        return;
    }

    syncMarks(writer, segment.kind === "image" ? imageMarks(writer, inherited, next) : [], "");

    writer.pieces.push(segment.kind === "image"
        ? { kind: "syntax", text: writeImage(segment.node, writer.context) }
        : writeBreak(segment.marker, writer.context));
}

/**
 * The marks to have open around an image. After whitespace held inside open
 * marks, those stay open when what follows lets a delimiter close right after
 * the image's `)` (`~~, ![](g)~~`). Before text that starts with whitespace,
 * the marks that text carries stay open, or open before the image's `!` —
 * where an opening delimiter can stand, after whitespace, punctuation or a
 * line edge, or anywhere for underline, whose grammar has no flanking rule —
 * so that whitespace keeps them (`~~![](g) 2~~`).
 *
 * @param writer - The writer.
 * @param inherited - The marks open at enclosing group levels.
 * @param next - The unit after the image, or `undefined` at the end.
 * @returns The marks, in no particular order.
 */
function imageMarks(writer: InlineWriter, inherited: readonly Mark[], next: Unit | undefined): Mark[] {
    const kept = writer.pending !== "" && closesAfterPunctuation(next) ? writer.stack.slice() : [];
    const leadsWithSpace = next?.kind === "text" && !next.code && /^\s+\S/.test(next.text);
    const carried = leadsWithSpace ? next.marks.filter((mark) => !inherited.includes(mark)) : [];
    const staying = writer.stack.filter((mark) => kept.includes(mark) || carried.includes(mark));
    const closes = staying.length < writer.stack.length;

    const opens = carried.filter((mark) => !writer.stack.includes(mark) && (mark === "underline"
        || writer.pending !== "" || closes || opensBeforePunctuation(writer.pieces.at(-1), MARK_DELIMITERS[mark])));

    return [...staying, ...opens];
}

/**
 * Tells whether a delimiter written right after `previous` can open before
 * punctuation (an image's `!`): CommonMark's left-flanking rule then needs
 * whitespace or punctuation before it.
 *
 * @param previous - The last piece written, or `undefined` at the start.
 * @param delimiter - The delimiter to open.
 * @returns `true` at a line start, after a break or another delimiter, or
 *   after text or syntax ending in whitespace or punctuation.
 */
function opensBeforePunctuation(previous: Piece | undefined, delimiter: string): boolean {
    if (previous === undefined || previous.kind === "break" || previous.kind === "delimiter") {
        return true;
    }

    if (previous.kind === "autolink") {
        return false;
    }

    const char = previous.text.at(-1) ?? "";

    return /\s/.test(char) || isFlankingPunctuation(char, delimiter[0]!);
}

/**
 * Tells whether a closing delimiter written after punctuation (an image's
 * `)`) still closes before `next`: CommonMark's right-flanking rule then
 * needs whitespace or punctuation after it, so `next` must not start with a
 * letter or digit.
 *
 * @param next - The unit after the delimiter, or `undefined` at the end.
 * @returns `false` when `next` is plain text starting with a word character.
 */
function closesAfterPunctuation(next: Unit | undefined): boolean {
    if (next?.kind !== "text" || next.code) {
        return true;
    }

    const first = next.text[0] ?? "";

    return /\s/.test(first) || ASCII_PUNCTUATION.test(first);
}

/**
 * Writes a text segment: a code span inside its marks, or text whose edge
 * whitespace sits outside the delimiters around it — except underline's,
 * whose grammar has no flanking rule, so it stays inside. Whitespace alone
 * opens no mark but underline — it keeps the open marks it carries and is
 * held back.
 *
 * @param writer - The writer.
 * @param segment - The text segment.
 * @param marks - Its marks beyond the inherited ones.
 */
function writeTextSegment(writer: InlineWriter, segment: TextSegment, marks: readonly Mark[]): void {
    if (segment.code) {
        syncMarks(writer, marks, "");
        writer.pieces.push({ kind: "syntax", text: writeCodeSpan(segment.text, writer.context, writer.inLink) });

        return;
    }

    const [, leading, core, trailing] = /^(\s*)(.*?)(\s*)$/s.exec(segment.text)!;

    const underlined = segment.marks.includes("underline");

    if (core === "") {
        const lowestMissing = writer.stack.findIndex((mark) => !marks.includes(mark));
        const kept = lowestMissing === -1 ? writer.stack.slice() : writer.stack.slice(0, lowestMissing);

        syncMarks(writer, marks.includes("underline") && !kept.includes("underline") ? [...kept, "underline"] : kept, "");
        writer.pendingUnderline = (writer.pending === "" || writer.pendingUnderline) && underlined;
        writer.pending += segment.text;

        return;
    }

    syncMarks(writer, marks, leading!);
    writer.pieces.push({ kind: "text", text: core! });
    writer.pending = trailing!;
    writer.pendingUnderline = underlined;
}

/**
 * Writes a link or style group: marks every segment carries stay open
 * across it (opening if needed); the rest close before its `[`. Inside, the
 * stack starts empty and is closed before its `]`.
 *
 * @param writer - The writer.
 * @param group - The group.
 * @param inherited - The marks open at enclosing group levels.
 */
function writeGroup(writer: InlineWriter, group: LinkGroup | StyleGroup, inherited: readonly Mark[]): void {
    // A marked bare autolink holds its marks outside it, bare or in its
    // `[…](…)` fallback; a link loaded from that fallback is no longer bare,
    // so where the marks go inside links it is written with them inside —
    // and so is this one, for a save loaded and saved again to be unchanged.
    const marksInside = writer.policy.marksInsideGroups && commonMarks(group, inherited, "").length > 0;
    const bare = group.kind === "link" && !marksInside ? writeBareAutolink(group.link, writer.context) : null;

    if (bare !== null) {
        syncMarks(writer, commonMarks(group, inherited, ""), "");
        writer.pieces.push(bare);

        return;
    }

    const autolink = group.kind === "link" ? writeAutolink(group.link, writer.context, true) : null;

    if (autolink !== null) {
        syncMarks(writer, commonMarks(group, inherited, ""), "");
        writer.pieces.push({ kind: "syntax", text: autolink });

        return;
    }

    const destination = group.kind === "link" ? writeLinkDestination(group.link, writer.context) : "";

    syncMarks(writer, writer.policy.marksInsideGroups ? [] : commonMarks(group, inherited, destination), "");

    const outer = writer.stack;
    const outerInLink = writer.inLink;

    writer.stack = [];
    writer.inLink = outerInLink || group.kind === "link";
    writer.pieces.push({ kind: "syntax", text: "[" });

    const textStart = writer.pieces.length;

    writeUnits(writer, group.units, [...inherited, ...outer]);
    closeMarks(writer, 0);
    flushPending(writer);

    if (group.kind === "link") {
        unescapeCodeSpanBrackets(writer.pieces, textStart);
    }

    writer.stack = outer;
    writer.inLink = outerInLink;
    writer.pieces.push({ kind: "syntax", text: group.kind === "link" ? `]${destination}` : `]{${group.style}}` });
}

/**
 * Writes as syntax, unescaped, each bracket pair of a link's text that holds
 * a code span with an odd number of backticks. `marked` finds where link
 * text ends by pairing backticks, which such a span throws off — the link
 * is then read as literal text — except inside a bracket pair, which it
 * scans as plain text. Only a pair holding no other bracket qualifies
 * (`marked` scans one level of nesting); the `(` or `{` after its `]` is
 * still escaped.
 *
 * @param pieces - The written pieces. Updated in place.
 * @param from - The index of the link text's first piece.
 */
function unescapeCodeSpanBrackets(pieces: Piece[], from: number): void {
    const brackets: Array<{ piece: number; offset: number; char: string }> = [];

    for (let index = from; index < pieces.length; index += 1) {
        const piece = pieces[index]!;

        if (piece.kind === "text") {
            [...piece.text].forEach((char, offset) => {
                if (char === "[" || char === "]") {
                    brackets.push({ piece: index, offset, char });
                }
            });
        }
    }

    const unescaped: typeof brackets = [];

    for (let index = 0; index + 1 < brackets.length; index += 1) {
        const open = brackets[index]!;
        const close = brackets[index + 1]!;

        if (open.char === "[" && close.char === "]" && holdsOddCodeSpan(pieces.slice(open.piece + 1, close.piece))) {
            unescaped.push(open, close);
            index += 1;
        }
    }

    for (const bracket of unescaped.reverse()) {
        const text = (pieces[bracket.piece] as { text: string }).text;

        pieces.splice(bracket.piece, 1, ...[
            { kind: "text", text: text.slice(0, bracket.offset) } as const,
            { kind: "syntax", text: bracket.char } as const,
            { kind: "text", text: text.slice(bracket.offset + 1) } as const,
        ].filter((piece) => piece.text !== ""));
    }
}

/**
 * Tells whether the pieces between a bracket pair hold a code span with an
 * odd number of backticks in its content, and no bracket in any syntax.
 *
 * @param pieces - The pieces between the brackets.
 * @returns `true` when the pair must be written unescaped.
 */
function holdsOddCodeSpan(pieces: readonly Piece[]): boolean {
    const syntax = pieces.filter((piece) => piece.kind === "syntax");

    if (syntax.some((piece) => /[[\]]/.test(piece.text))) {
        return false;
    }

    return syntax.some((piece) => {
        const fence = /^`*/.exec(piece.text)![0].length;
        const backticks = piece.text.split("`").length - 1;

        return fence > 0 && (backticks - 2 * fence) % 2 === 1;
    });
}

/**
 * The marks every segment of a group carries beyond the inherited ones. An
 * image or break carries none. Underline is left out when the link's
 * destination holds a `+`, which the underline grammar cannot span.
 *
 * @param group - The group.
 * @param inherited - The marks open at enclosing group levels.
 * @param destination - The link's written destination, or `""` for a style group.
 * @returns The common marks, in the fixed order.
 */
function commonMarks(group: LinkGroup | StyleGroup, inherited: readonly Mark[], destination: string): Mark[] {
    const segments = group.units.flatMap((unit) => (unit.kind === "style" ? unit.units : [unit]));

    return MARK_ORDER.filter((mark) =>
        !inherited.includes(mark)
        && !(mark === "underline" && destination.includes("+"))
        && segments.every((segment) => segment.kind === "text" && segment.marks.includes(mark)));
}

/**
 * Brings the open marks to `target`: closes from the top of the stack down
 * to (and including) the lowest mark `target` lacks, writes the held-back
 * whitespace and `leading`, then opens `target`'s missing marks in the fixed
 * order. Whitespace thereby sits outside the delimiters it borders, except
 * an underline's: an underline opening here opens first and holds `leading`.
 *
 * @param writer - The writer.
 * @param target - The marks the next output carries.
 * @param leading - The next text's leading whitespace.
 */
function syncMarks(writer: InlineWriter, target: readonly Mark[], leading: string): void {
    const lowestMissing = writer.stack.findIndex((mark) => !target.includes(mark));

    if (lowestMissing !== -1) {
        closeMarks(writer, lowestMissing);
    }

    const rank = writer.policy.rank;

    if (rank !== null) {
        const ordered = rank.filter((mark) => target.includes(mark));
        const outOfOrder = writer.stack.findIndex((mark, index) => ordered[index] !== mark);

        if (outOfOrder !== -1) {
            closeMarks(writer, outOfOrder);
        }
    }

    flushPending(writer);

    const missing = target.filter((mark) => !writer.stack.includes(mark));
    const order = missing.length > 0 ? writer.openOrder() : [];
    const holdsLeading = leading !== "" && missing.includes("underline");

    const open = (mark: Mark): void => {
        const previous = writer.pieces.at(-1);

        // The cell break ends in a letter, against which a delimiter before punctuation cannot open; a space after
        // it is collapsed at the start of the line it makes.
        if (previous?.kind === "syntax" && previous.text === CELL_PARAGRAPH_BREAK && mark !== "underline") {
            writer.pieces.push({ kind: "text", text: " " });
        }

        writer.stack.push(mark);
        writer.pieces.push({ kind: "delimiter", text: MARK_DELIMITERS[mark], mark, opens: true });
    };

    if (holdsLeading) {
        open("underline");
    }

    if (leading !== "") {
        writer.pieces.push({ kind: "text", text: leading });
    }

    for (const mark of order) {
        if (missing.includes(mark) && !writer.stack.includes(mark)) {
            open(mark);
        }
    }
}

/**
 * Closes the open marks from the top of the stack down to `from`. Held-back
 * underlined whitespace is written before an underline's closing delimiter,
 * so it stays underlined.
 *
 * @param writer - The writer.
 * @param from - The stack index of the lowest mark to close.
 */
function closeMarks(writer: InlineWriter, from: number): void {
    for (let index = writer.stack.length - 1; index >= from; index -= 1) {
        const mark = writer.stack[index]!;

        if (mark === "underline" && writer.pendingUnderline) {
            flushPending(writer);
        }

        writer.pieces.push({ kind: "delimiter", text: MARK_DELIMITERS[mark], mark, opens: false });
    }

    writer.stack.length = from;
}

/**
 * Writes the held-back whitespace.
 *
 * @param writer - The writer.
 */
function flushPending(writer: InlineWriter): void {
    if (writer.pending !== "") {
        writer.pieces.push({ kind: "text", text: writer.pending });
        writer.pending = "";
    }

    writer.pendingUnderline = false;
}

/**
 * The piece a line break writes: the cell break in a table cell, a space in
 * a heading, else a hard break with its marker.
 *
 * @param marker - The break's authored marker.
 * @param context - Where it is written.
 * @returns The piece.
 */
function writeBreak(marker: string, context: InlineContext): Piece {
    if (context.inTableCell) {
        return { kind: "syntax", text: CELL_PARAGRAPH_BREAK };
    }

    return context.singleLine ? { kind: "text", text: " " } : { kind: "break", marker };
}

/**
 * Writes a code span, fenced with the shortest backtick run its content does
 * not hold — a run of three or more at a line start reads as a code fence to
 * some of `marked`'s block rules, so it is written only when the content
 * holds runs of every shorter length — and padded with a space inside each
 * fence when the content would otherwise merge with the fence, lose an edge
 * space, or end in a backslash (`marked` masks a backslash with the
 * character after it before pairing backticks, so `\` before the closing
 * fence would hide it). Inside a link, `marked` strips one backslash before each `[` /
 * `]` of the link text before lexing it, so a backslash there is doubled to
 * survive; and its link-text scan reads from one backtick run to the next as
 * a code span, which an inner run longer than the fence ends early, so the
 * fence there is one longer than the longest run.
 *
 * @param code - The code text.
 * @param context - Where it is written.
 * @param inLink - Whether the span is inside a link's text.
 * @returns The code span.
 */
function writeCodeSpan(code: string, context: InlineContext, inLink: boolean): string {
    const runs = new Set((code.match(/`+/g) ?? []).map((run) => run.length));
    let fenceLength = inLink ? Math.max(0, ...runs) + 1 : 1;

    while (runs.has(fenceLength)) {
        fenceLength += 1;
    }

    const fence = "`".repeat(fenceLength);
    const padded = code.startsWith("`") || code.endsWith("`") || code.endsWith("\\") || (/^ .* $/s.test(code) && /[^ ]/.test(code));
    const linkSafe = inLink ? code.replace(/\\(?=[[\]])/g, "\\\\") : code;
    const content = padded ? ` ${linkSafe} ` : linkSafe;

    return fence + (context.inTableCell ? content.replace(/\|/g, "\\|") : content) + fence;
}

/**
 * Writes a link's destination and title, in parentheses. A title's line
 * breaks are written where its block can hold them: none in a heading or
 * table cell, whose content is one line, so each becomes a space; and no
 * blank line anywhere, which would end the block, so each stretch of line
 * breaks becomes one.
 *
 * @param link - The link.
 * @param context - Where it is written.
 * @returns `(url)`, `(<url>)` when the URL holds a character a bare destination cannot, plus ` "title"`.
 */
function writeLinkDestination(link: LinkNode, context: InlineContext): string {
    const url = link.getURL();
    const title = link.getTitle();
    const titled = title !== null && title !== "";
    const bare = url !== "" && ![...url].some((char) => needsAngleBrackets(char));
    const destination = bare ? url : url === "" && !titled ? "" : `<${url.replace(/[\\<>]/g, "\\$&")}>`;
    const lines = titled ? title.replace(/\n[ \t]*(?=\n)/g, "").replace(/\n+/g, context.singleLine ? " " : "\n") : "";
    const written = `(${destination}${titled ? ` "${lines.replace(/[\\"]/g, "\\$&")}"` : ""})`;

    return context.inTableCell ? written.replace(/\|/g, "\\|") : written;
}

/**
 * Tells whether a destination character forces the `<…>` form.
 *
 * @param char - One character of the URL.
 * @returns `true` for a space, `<`, `>`, `(`, `)`, `\` or a control character.
 */
function needsAngleBrackets(char: string): boolean {
    const code = char.charCodeAt(0);

    return " <>()\\".includes(char) || code <= LAST_C0_CONTROL || code === DELETE_CHARACTER;
}

/**
 * Reads the text of a link that can be written as an autolink: its only
 * child is one unstyled text, and it has no title. The text must be
 * unformatted, unless `marked`: its marks' delimiters are then written
 * around the autolink — though not underline when the text holds a `+`,
 * which the underline grammar cannot.
 *
 * @param link - The link.
 * @param context - Where it is written.
 * @param marked - Whether the text may carry marks.
 * @returns The link's text, or `null` when the link needs `[…](…)`.
 */
function autolinkText(link: LinkNode, context: InlineContext, marked = false): string | null {
    const child = link.getFirstChild();

    if (link.getChildrenSize() !== 1 || !$isTextNode(child) || child.getStyle() !== ""
        || (link.getTitle() ?? "") !== "" || (context.inTableCell && link.getURL().includes("|"))) {
        return null;
    }

    const marks = marked ? MARK_ORDER.filter((mark) => child.hasFormat(MARK_FORMATS[mark])) : [];
    const markFormat = marks.reduce((format, mark) => format | TEXT_TYPE_TO_FORMAT[MARK_FORMATS[mark]], 0);
    const text = child.getTextContent();

    return child.getFormat() === markFormat && !(marks.includes("underline") && text.includes("+")) ? text : null;
}

/**
 * Writes a link the importer read from a GFM bare autolink
 * ({@link bareAutolinkState}) back bare, when `marked` reads its text alone
 * as that same link: a `www.` address (`http://` added), a URL with an
 * `http`, `https` or `ftp` scheme, or an email address (`mailto:` added). The
 * text must hold none of the characters that end or reshape the match, and
 * end in a letter, digit or `/` — `marked` trims trailing punctuation off a
 * bare URL. Its text may carry marks, open around it. Whether whitespace, a
 * line edge or those marks' delimiters bound it, so no neighbouring character
 * runs into it, is only known once the line is assembled, so the piece
 * carries its fallback: the `<…>` or `[…](…)` form.
 *
 * @param link - The link.
 * @param context - Where it is written.
 * @returns The autolink piece, or `null` when the link is not written bare.
 */
function writeBareAutolink(link: LinkNode, context: InlineContext): Piece | null {
    const text = autolinkText(link, context, true);
    const url = link.getURL();

    if (text === null || !$getState(link, bareAutolinkState) || !BARE_AUTOLINK_TEXT.test(text)) {
        return null;
    }

    const isBare = (/^www\./i.test(text) && url === "http://" + text)
        || (BARE_URL_SCHEME_PREFIX.test(text) && url === text)
        || (AUTOLINK_EMAIL.test(text) && url === "mailto:" + text);

    if (!isBare) {
        return null;
    }

    const fallback = writeAutolink(link, context, true)
        ?? `[${escapeText(text, "[", "]", context)}]${writeLinkDestination(link, context)}`;

    return { kind: "autolink", text: fallback, bare: text };
}

/**
 * Writes a link as an angle-bracket autolink when it is one: its only child
 * is one unstyled text equal to its URL (or to its `mailto:` address), with
 * no title. Its text may carry marks, whose delimiters are written around
 * the brackets.
 *
 * @param link - The link.
 * @param context - Where it is written.
 * @param marked - Whether the text may carry marks, written around it by the caller.
 * @returns `<url>` or `<address>`, or `null` when the link needs `[…](…)`.
 */
function writeAutolink(link: LinkNode, context: InlineContext, marked = false): string | null {
    const text = autolinkText(link, context, marked);
    const url = link.getURL();

    if (text === null) {
        return null;
    }

    if (text === url && AUTOLINK_URL.test(url)) {
        return `<${url}>`;
    }

    return url === "mailto:" + text && AUTOLINK_EMAIL.test(text) ? `<${text}>` : null;
}

/**
 * Writes an image with its attributes, as the image transformer does.
 * Brackets are removed from the alt text, which the image grammar cannot hold.
 *
 * @param node - The image.
 * @param context - Where it is written.
 * @returns `![alt](src)`, plus `{…}` when it has attribute text.
 */
function writeImage(node: MarkdownImageNode, context: InlineContext): string {
    const attributeText = imageAttributeText(node);
    const attributes = attributeText === "" ? "" : `{${attributeText}}`;
    const written = `![${node.getAlt().replace(/[[\]]/g, "")}](${node.getSrc()})${attributes}`;

    return context.inTableCell ? written.replace(/\|/g, "\\|") : written;
}

/**
 * Reads the attribute text an image is written with: the authored text it was
 * loaded with ({@link imageAttributesState}) while that text still resolves
 * to the node's size — keeping the attributes' order and the ones the editor
 * does not model — else `width=… height=…` for whichever is set.
 *
 * @param node - The image.
 * @returns The attribute text, or `""` for none.
 */
function imageAttributeText(node: MarkdownImageNode): string {
    const width = node.getImageWidth();
    const height = node.getImageHeight();
    const authored = $getState(node, imageAttributesState);
    const resolved = resolveImageSpec(node.getSrc(), node.getAlt(), parseAttributes(authored));

    if (authored !== "" && !/[\n|{}]/.test(authored) && resolved?.width === width && resolved.height === height) {
        return authored;
    }

    const attributes: Record<string, string> = {};

    if (width !== null) {
        attributes.width = String(width);
    }

    if (height !== null) {
        attributes.height = String(height);
    }

    return formatAttributes(attributes);
}

// ---------------------------------------------------------------- inline: reading back

/**
 * The reading of a block's segments, as the editor shows them: one unit per
 * visible character, image and line break — whitespace left out, since the
 * viewer collapses it — each keyed by its marks, link and span style.
 *
 * @param segments - The block's segments.
 * @param context - Where the content is written: a heading's breaks are spaces.
 * @returns The reading units, in order.
 */
function segmentReading(segments: readonly Segment[], context: InlineContext): string[] {
    const reading: string[] = [];

    for (const segment of segments) {
        const link = linkReading(segment.link?.getURL() ?? "", segment.link?.getTitle() ?? "");

        if (segment.kind === "break") {
            if (!context.singleLine || context.inTableCell) {
                reading.push(BREAK_READING);
            }
        } else if (segment.kind === "image") {
            reading.push(imageReading(segment.node.getSrc(), link));
        } else {
            const marks = segment.code ? [...segment.marks, "code"] : segment.marks;
            const style = segment.style === "" ? "" : normalizedAttributes(parseAttributes(segment.style));

            pushCharacterReading(reading, segment.text, { marks, link, style });
        }
    }

    return reading;
}

/**
 * Reads inline Markdown back as the viewer reads it, in the block it is
 * written for: a paragraph's lines alone, a heading's content after `# `
 * (and before a closing ` #`, so a trailing `#` of its own stays text), a
 * cell's content in a one-cell table.
 *
 * @param markdown - The block's inline Markdown.
 * @param context - Where it is written.
 * @returns The reading units, or `null` when the Markdown does not lex as one such block.
 */
function markdownReading(markdown: string, context: InlineContext): string[] | null {
    const reading: string[] = [];
    const tokens = readBackTokens(markdown, context);

    if (tokens === null) {
        return markdown.trim() === "" ? reading : null;
    }

    pushTokenReading(reading, tokens, { marks: [], link: "", style: "" }, context);

    return reading;
}

/**
 * Lexes inline Markdown in the block it is written for.
 *
 * @param markdown - The block's inline Markdown.
 * @param context - Where it is written.
 * @returns The block's inline tokens, or `null` when it does not lex as one such block.
 */
function readBackTokens(markdown: string, context: InlineContext): Token[] | null {
    if (context.inTableCell) {
        const table = lexMarkdown(`| ${markdown} |\n| --- |`)[0];

        return table?.type === "mdtable" ? (table as unknown as MdTableToken).header[0]?.tokens ?? null : null;
    }

    if (context.singleLine) {
        const heading = lexMarkdown(`# ${markdown} #`)[0];

        return heading?.type === "heading" ? (heading as Tokens.Heading).tokens : null;
    }

    const blocks = lexMarkdown(markdown).filter((token) => token.type !== "space");

    return blocks.length === 1 && blocks[0]!.type === "paragraph" ? (blocks[0] as Tokens.Paragraph).tokens : null;
}

/**
 * Appends the reading of inline tokens: their visible characters, images
 * and breaks, each keyed by the marks, link and style around it. In a table
 * cell, a text's {@link CELL_PARAGRAPH_BREAK} reads as a break, as the viewer
 * renders it.
 *
 * @param reading - The reading units so far. Extended in place.
 * @param tokens - The tokens.
 * @param scope - What the tokens inherit.
 * @param context - Where they are written.
 */
function pushTokenReading(reading: string[], tokens: readonly Token[], scope: ReadingScope, context: InlineContext): void {
    const marked = (mark: string): ReadingScope => ({ ...scope, marks: [...scope.marks, mark] });

    for (const token of tokens) {
        const children = (token as { tokens?: Token[] }).tokens ?? [];

        switch (token.type) {
            case "strong":     pushTokenReading(reading, children, marked("bold"), context);      break;
            case "em":         pushTokenReading(reading, children, marked("italic"), context);    break;
            case "del":        pushTokenReading(reading, children, marked("strike"), context);    break;
            case "underline":  pushTokenReading(reading, children, marked("underline"), context); break;
            case "link":       pushTokenReading(reading, children, linkScope(token as Tokens.Link, scope), context); break;
            case "styledspan": pushTokenReading(reading, children, styleScope(token, scope), context); break;
            case "codespan":   pushCharacterReading(reading, (token as Tokens.Codespan).text, marked("code")); break;
            case "text":       pushTextReading(reading, token as Tokens.Text, scope, context); break;
            case "escape":     pushCharacterReading(reading, (token as Tokens.Escape).text, scope); break;
            case "br":         reading.push(BREAK_READING); break;
            case "mdimage":    reading.push(imageReading((token as unknown as { src: string }).src, scope.link)); break;
            default:           pushCharacterReading(reading, token.raw, scope);
        }
    }
}

/**
 * The scope inside a link token.
 *
 * @param link - The link token.
 * @param scope - The scope around it.
 * @returns The scope with the link's reading key.
 */
function linkScope(link: Tokens.Link, scope: ReadingScope): ReadingScope {
    return { ...scope, link: linkReading(link.href, link.title ?? "") };
}

/**
 * The scope inside a styled span token.
 *
 * @param span - The `styledspan` token.
 * @param scope - The scope around it.
 * @returns The scope with the span's normalized style.
 */
function styleScope(span: Token, scope: ReadingScope): ReadingScope {
    return { ...scope, style: normalizedAttributes((span as unknown as { attributes: Record<string, string> }).attributes) };
}

/**
 * Appends the reading of a `text` token: its children, when it has any,
 * else its characters — in a table cell, split by the cell break into lines.
 *
 * @param reading - The reading units so far. Extended in place.
 * @param token - The `text` token.
 * @param scope - What it inherits.
 * @param context - Where it is written.
 */
function pushTextReading(reading: string[], token: Tokens.Text, scope: ReadingScope, context: InlineContext): void {
    if (token.tokens !== undefined && token.tokens.length > 0) {
        pushTokenReading(reading, token.tokens, scope, context);

        return;
    }

    const lines = context.inTableCell ? token.text.split(CELL_PARAGRAPH_BREAK) : [token.text];

    lines.forEach((line, index) => {
        if (index > 0) {
            reading.push(BREAK_READING);
        }

        pushCharacterReading(reading, line, scope);
    });
}

/**
 * Appends one reading unit per visible character of a text.
 *
 * @param reading - The reading units so far. Extended in place.
 * @param text - The text.
 * @param scope - Its marks, link and span style.
 */
function pushCharacterReading(reading: string[], text: string, scope: ReadingScope): void {
    const marks = [...scope.marks].sort().join();

    for (const char of text) {
        if (!/\s/.test(char)) {
            reading.push([char, marks, scope.link, scope.style].join(READING_KEY_SEPARATOR));
        }
    }
}

/**
 * The reading key of a link.
 *
 * @param href - Its destination.
 * @param title - Its title, or `""`.
 * @returns The key.
 */
function linkReading(href: string, title: string): string {
    return href === "" && title === "" ? "" : `${href} "${title}"`;
}

/**
 * The reading unit of an image.
 *
 * @param src - Its source.
 * @param link - The reading key of the link around it.
 * @returns The unit.
 */
function imageReading(src: string, link: string): string {
    return ["\u0002image", src, link].join(READING_KEY_SEPARATOR);
}

// ---------------------------------------------------------------- inline: lines and escaping

/**
 * Assembles the written pieces into lines: merges adjacent text, splits at
 * hard breaks, drops the spaces and tabs at each line's edges, writes each
 * bare autolink in the form its neighbours allow, writes with `_`
 * the emphasis pairs `marked` would mis-pair, escapes the text against its
 * neighbours and, outside single-line contexts, the block starters at each
 * line start.
 *
 * @param pieces - The written pieces.
 * @param context - Where they are written.
 * @param choices - The pairs to switch and the autolinks to write bare.
 * @returns The inline Markdown.
 */
function assembleLines(pieces: Piece[], context: InlineContext, choices: AssemblyChoices = NO_CHOICES): string {
    const lines: Array<{ pieces: LinePiece[]; marker: string | null }> = [{ pieces: [], marker: null }];

    for (const piece of pieces) {
        const line = lines[lines.length - 1]!;
        const last = line.pieces[line.pieces.length - 1];

        if (piece.kind === "break") {
            line.marker = piece.marker;
            lines.push({ pieces: [], marker: null });
        } else if (piece.kind === "text" && last?.kind === "text") {
            line.pieces[line.pieces.length - 1] = { kind: "text", text: last.text + piece.text };
        } else {
            line.pieces.push(piece);
        }
    }

    const lineContents = underscoreMispairedEmphasis(
        lines.map((line) => resolveAutolinks(trimLineEdges(line.pieces), choices.bare, line.marker === "\\")), choices.switched,
    );

    return lines.map((line, index) => {
        const content = renderLine(lineContents[index]!, context);

        return line.marker === null ? content : content + lineBreakMarker(line.marker, content) + "\n";
    }).join("");
}

/**
 * The marker a hard break writes after `content`. Spaces after an empty
 * line would make it blank and end the paragraph, so it becomes `\` there.
 *
 * @param marker - The break's authored marker.
 * @param content - The line the break ends.
 * @returns The marker to write.
 */
function lineBreakMarker(marker: string, content: string): string {
    return content === "" ? "\\" : marker;
}

/**
 * Drops the spaces and tabs at a line's start and end, so text neither
 * becomes indented code nor a trailing-space hard break.
 *
 * @param pieces - The line's pieces.
 * @returns The trimmed pieces.
 */
function trimLineEdges(pieces: LinePiece[]): LinePiece[] {
    const trimmed = pieces.slice();
    const first = trimmed[0];

    if (first?.kind === "text") {
        trimmed[0] = { kind: "text", text: first.text.replace(/^[ \t]+/, "") };
    }

    const last = trimmed[trimmed.length - 1];

    if (last?.kind === "text") {
        trimmed[trimmed.length - 1] = { kind: "text", text: last.text.replace(/[ \t]+$/, "") };
    }

    return trimmed.filter((piece) => piece.kind !== "text" || piece.text !== "");
}

/**
 * Writes each autolink piece of a line bare when its neighbours bound it,
 * else in its fallback form. A neighbour bounds it when it is a line edge or
 * starts (after it) or ends (before it) with whitespace; or when it is a
 * delimiter of the marks around it — one opening before it, or closing after
 * it — next to a letter or digit of it, so the delimiter pairs and `marked`
 * reads the URL alone inside the emphasis (`*http://e*4`). A delimiter
 * opening after it is none: `marked` reads a bare URL on across it. Nor is
 * the line's end when a `\` hard break ends the line: the URL would take
 * the backslash in.
 *
 * @param pieces - The line's pieces.
 * @param bare - The autolinks to write bare whatever their neighbours.
 * @param backslashEnd - Whether a `\` hard break ends the line.
 * @returns The pieces, each autolink resolved to syntax.
 */
function resolveAutolinks(pieces: LinePiece[], bare: ReadonlySet<Piece>, backslashEnd: boolean): LinePiece[] {
    const bounds = (neighbour: LinePiece | undefined, edge: string, side: "before" | "after"): boolean => {
        if (neighbour === undefined) {
            return side === "before" || !backslashEnd;
        }

        if (neighbour.kind === "delimiter") {
            return neighbour.opens === (side === "before") && WORD_CHARACTER.test(edge);
        }

        return /\s/.test(side === "before" ? neighbour.text.at(-1) ?? "" : neighbour.text[0] ?? "");
    };

    return pieces.map((piece, index): LinePiece => {
        if (piece.kind !== "autolink") {
            return piece;
        }

        const bounded = bare.has(piece) || (bounds(pieces[index - 1], piece.bare[0] ?? "", "before")
            && bounds(pieces[index + 1], piece.bare.at(-1) ?? "", "after"));

        return { kind: "syntax", text: bounded ? piece.bare : piece.text };
    });
}

/** A bold or italic pair: the indexes of its opening and closing delimiters. */
interface DelimiterPair {
    readonly open:  number;
    readonly close: number;
}

/** What stands between two lines when delimiters are paired across them: whitespace. */
const LINE_SEPARATOR: LinePiece = { kind: "text", text: "\n" };

/**
 * Writes with `_` each bold or italic pair whose `*` delimiters `marked`
 * would pair wrongly with the other mark's `*` run inside it. A `*` run that
 * is both left- and right-flanking (a letter, or punctuation, on both sides)
 * can both open and close; when only one end of an inner pair is such a run,
 * `marked` matches it with the outer run, where CommonMark keeps them apart:
 * `*foo fuzz**bar** baz*` loses its bold and shows two of its `*`. A `_` pair
 * never pairs with a `*` run, so the outer pair switches to `_`. The switch
 * is kept only when every delimiter that could open or close before it still
 * can — `_` cannot where the pair stands next to a letter — else the pair
 * stays `*`. The block's lines are read as one run of pieces, whitespace
 * between them. The pairs in `switched` are then written with the other
 * character.
 *
 * @param lines - Each line's pieces.
 * @param switched - The pairs, by their order of opening, to write with the other delimiter character.
 * @returns Each line's pieces, with the switched delimiters replaced.
 */
function underscoreMispairedEmphasis(lines: readonly LinePiece[][], switched: ReadonlySet<number>): LinePiece[][] {
    const block = lines.flatMap((pieces, index) => (index > 0 ? [LINE_SEPARATOR, ...pieces] : pieces));
    const pairs = delimiterPairs(block);

    for (const outer of pairs) {
        const mispaired = pairs.some((inner) => inner.open > outer.open && inner.close < outer.close
            && starRunFlanksBothWays(block, inner.open) !== starRunFlanksBothWays(block, inner.close));

        if (mispaired) {
            switchToUnderscore(block, outer);
        }
    }

    pairs.forEach((pair, ordinal) => {
        if (switched.has(ordinal)) {
            for (const index of [pair.open, pair.close]) {
                const piece = block[index] as Extract<LinePiece, { kind: "delimiter" }>;
                const other = piece.text[0] === "*" ? UNDERSCORE_DELIMITERS[piece.mark]! : MARK_DELIMITERS[piece.mark];

                block[index] = { ...piece, text: other };
            }
        }
    });

    let start = 0;

    return lines.map((pieces) => {
        const switched = block.slice(start, start + pieces.length);

        start += pieces.length + 1;

        return switched;
    });
}

/**
 * Pairs the bold and italic delimiters of a block. Marks open and close in
 * stack order, so each closing delimiter pairs with the last unpaired
 * opening one.
 *
 * @param pieces - The block's pieces.
 * @returns The bold and italic pairs, in the order they open.
 */
function delimiterPairs(pieces: readonly LinePiece[]): DelimiterPair[] {
    const pairs: DelimiterPair[] = [];
    const open: number[] = [];

    pieces.forEach((piece, index) => {
        if (piece.kind !== "delimiter" || UNDERSCORE_DELIMITERS[piece.mark] === undefined) {
            return;
        }

        if (piece.opens) {
            open.push(index);
        } else if (open.length > 0) {
            pairs.push({ open: open.pop()!, close: index });
        }
    });

    return pairs.sort((a, b) => a.open - b.open);
}

/**
 * Switches a pair to its `_` delimiters, when every delimiter of the block
 * that could open or close before can still do so, the pair's own included.
 *
 * @param pieces - The block's pieces. Updated in place when the switch is kept.
 * @param pair - The pair to switch.
 */
function switchToUnderscore(pieces: LinePiece[], pair: DelimiterPair): void {
    const working = flankingDelimiters(pieces);
    const switched = pieces.slice();

    for (const index of [pair.open, pair.close]) {
        const piece = switched[index] as Extract<LinePiece, { kind: "delimiter" }>;

        switched[index] = { ...piece, text: UNDERSCORE_DELIMITERS[piece.mark]! };
    }

    const after = flankingDelimiters(switched);
    const kept = [...working, pair.open, pair.close].every((index) => after.has(index));

    if (kept) {
        pieces.splice(0, pieces.length, ...switched);
    }
}

/**
 * Finds the delimiters that can do what they are written for: open, for an
 * opening one, or close. CommonMark's flanking rules decide it from the
 * characters around the delimiter run each one belongs to — the run of
 * adjacent delimiters written with the same character.
 *
 * @param pieces - The block's pieces.
 * @returns The indexes of the delimiters that can.
 */
function flankingDelimiters(pieces: readonly LinePiece[]): Set<number> {
    const flanking = new Set<number>();

    pieces.forEach((piece, index) => {
        if (piece.kind !== "delimiter") {
            return;
        }

        const { left, right, before, after } = delimiterRun(pieces, index);
        const run = piece.text[0]!;
        const opens = left && (run !== "_" || !right || isFlankingPunctuation(before, run));
        const closes = right && (run !== "_" || !left || isFlankingPunctuation(after, run));

        if (piece.opens ? opens : closes) {
            flanking.add(index);
        }
    });

    return flanking;
}

/**
 * Tells whether the `*` run a delimiter belongs to is both left- and
 * right-flanking, so it could either open or close.
 *
 * @param pieces - The block's pieces.
 * @param index - The delimiter's index.
 * @returns `true` for a `*` run that flanks both ways.
 */
function starRunFlanksBothWays(pieces: readonly LinePiece[], index: number): boolean {
    const run = delimiterRun(pieces, index);

    return pieces[index]!.text[0] === "*" && run.left && run.right;
}

/**
 * Reads the delimiter run a delimiter belongs to: the characters on either
 * side of it, and whether it is left- and right-flanking. Escaping never
 * changes a character's class, so the unescaped text tells.
 *
 * @param pieces - The block's pieces.
 * @param index - The delimiter's index.
 * @returns The characters before and after the run (`\n` at an edge) and its flanking.
 */
function delimiterRun(pieces: readonly LinePiece[], index: number): { before: string; after: string; left: boolean; right: boolean } {
    const char = pieces[index]!.text[0]!;
    const inRun = (piece: LinePiece | undefined): boolean => piece?.kind === "delimiter" && piece.text[0] === char;
    let first = index;
    let last = index;

    while (inRun(pieces[first - 1])) {
        first -= 1;
    }

    while (inRun(pieces[last + 1])) {
        last += 1;
    }

    const before = /.$/su.exec(pieces[first - 1]?.text ?? "")?.[0] ?? "\n";
    const after = /^./su.exec(pieces[last + 1]?.text ?? "")?.[0] ?? "\n";
    const space = (c: string): boolean => /\s/.test(c);
    const punctuation = (c: string): boolean => isFlankingPunctuation(c, char);

    return {
        before, after,
        left:  !space(after) && (!punctuation(after) || space(before) || punctuation(before)),
        right: !space(before) && (!punctuation(before) || space(after) || punctuation(after)),
    };
}

/**
 * Tells whether a character counts as punctuation next to a delimiter run:
 * a Unicode punctuation or symbol character, except `~` next to a `*` run,
 * which `marked`'s GFM rules count as a letter so `*~~a~~*` holds a
 * strikethrough.
 *
 * @param char - The character next to the run.
 * @param run - The run's delimiter character.
 * @returns `true` when it counts as punctuation.
 */
function isFlankingPunctuation(char: string, run: string): boolean {
    return FLANKING_PUNCTUATION.test(char) && !(run === "*" && char === "~");
}

/**
 * Renders one line's pieces, escaping each text against the characters on
 * either side of it.
 *
 * @param pieces - The line's pieces.
 * @param context - Where the line is written.
 * @returns The line.
 */
function renderLine(pieces: LinePiece[], context: InlineContext): string {
    const rendered = pieces.map((piece, index) => {
        if (piece.kind !== "text") {
            return piece.text;
        }

        const before = pieces[index - 1]?.text.slice(-1) ?? "\n";
        const after = pieces[index + 1]?.text[0] ?? "\n";

        return escapeText(piece.text, before, after, context);
    }).join("");

    return !context.singleLine && pieces[0]?.kind === "text" ? escapeLineStart(rendered) : rendered;
}

/**
 * Escapes text so `marked` reads it back as the same characters, escaping
 * only where a character could start a construct.
 *
 * @param text - The text.
 * @param before - The output character before it (`\n` at a line start).
 * @param after - The output character after it (`\n` at a line end).
 * @param context - Where it is written.
 * @returns The escaped text.
 */
function escapeText(text: string, before: string, after: string, context: InlineContext): string {
    let escaped = "";

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index]!;

        const site: EscapeSite = {
            text, index, context,
            previous: index > 0 ? text[index - 1]! : before,
            next:     index < text.length - 1 ? text[index + 1]! : after,
        };

        escaped += needsEscape(char, site) ? "\\" + char : char;
    }

    return escaped;
}

/** One character's surroundings, as {@link needsEscape} reads them. */
interface EscapeSite {
    readonly text:     string;
    readonly index:    number;
    readonly previous: string;
    readonly next:     string;
    readonly context:  InlineContext;
}

/**
 * Tells whether a character must be escaped where it stands: an emphasis,
 * code or bracket character always; a `\` before punctuation or at a run's
 * end; a `_` that is not intraword; a tag-shaped `<`; a `+` next to a `+`
 * (underline); a `|` in a table cell; the `:` of a bare URL scheme, the `.`
 * of `www.` and the `@` of an email address (GFM autolinks); a `!` just
 * before a link (an image); and a `(` or `{` after a `]` or an image's `)`
 * — `marked` unescapes the brackets of link text before reading it, so
 * `\]` followed by `(` or `{` would otherwise become a link or span there.
 *
 * @param char - The character.
 * @param site - Its surroundings.
 * @returns `true` when it could start a construct the text does not hold.
 */
function needsEscape(char: string, site: EscapeSite): boolean {
    if (char === "~" && site.context.looseTildes === true) {
        return site.previous === "~" || site.next === "~";
    }

    if (ALWAYS_ESCAPED.has(char)) {
        return true;
    }

    const isLast = site.index === site.text.length - 1;

    switch (char) {
        case "\\": return isLast || ASCII_PUNCTUATION.test(site.next) || (site.context.inTableCell && site.next === "n");
        case "_":  return !(WORD_CHARACTER.test(site.previous) && WORD_CHARACTER.test(site.next));
        case "<":  return site.context.escapedAngles === true || /^[A-Za-z/!?]$/.test(site.next);
        case "+":  return site.previous === "+" || site.next === "+";
        case "|":  return site.context.inTableCell;
        case ":":  return BARE_URL_SCHEME.test(site.text.slice(0, site.index)) && site.text.startsWith("//", site.index + 1);
        case ".":  return BARE_WWW_PREFIX.test(site.text.slice(0, site.index));
        case "@":  return EMAIL_LOCAL_CHARACTER.test(site.previous) && EMAIL_DOMAIN_CHARACTER.test(site.next);
        case "!":  return isLast && site.next === "[";
        case "(":  return site.previous === "]";
        case "{":  return site.previous === "]" || (site.index === 0 && site.previous === ")");
        default:   return false;
    }
}

/**
 * Escapes the block starter a line opens with: one of the block-start
 * characters, or the `.` / `)` of an ordered-list number.
 *
 * @param line - The rendered line, its text already escaped.
 * @returns The line, safe at a line start.
 */
function escapeLineStart(line: string): string {
    if (LINE_START_ESCAPED.has(line[0] ?? "")) {
        return "\\" + line;
    }

    const number = ORDERED_LIST_MARKER.exec(line);

    return number === null ? line : number[1] + "\\" + line.slice(number[1]!.length);
}
