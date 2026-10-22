// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Token, Tokens } from "marked";
import {
    formatAttributes, lineEndAt, resolveSpanStyle, spanStyleToAttributes,
} from "~/component/display/markdownAttributes.js";
import { lexMarkdown } from "~/component/display/markdownExtensions.js";
import type { MdBlockToken } from "~/component/display/markdownExtensions.js";
import type { MdTableToken } from "~/component/display/markdownTableExtension.js";

/**
 * One inline token of a document, with where its source sits: the whole
 * construct, and the content between its syntax (an emphasis run's text, a
 * link's text, a code span's code).
 */
export interface SourceInline {
    /** The token's type: `strong`, `em`, `del`, `underline`, `codespan`, `link`, `styledspan`, `mdimage`, … */
    readonly type:       string;
    readonly token:      Token;
    /** The construct's source offsets, `-1` when its text could not be found in the source. */
    readonly start:      number;
    readonly end:        number;
    /** The content's source offsets, `-1` when the token holds none or it could not be found. */
    readonly innerStart: number;
    readonly innerEnd:   number;
    /**
     * Whether a range may sit inside the content without touching syntax:
     * emphasis, a styled span and a bracketed link's text. An autolink, a code
     * span, an image or an escape is atomic.
     */
    readonly hasContent: boolean;
}

/** One located run of inline text — a paragraph's, a heading's, a list item's or a table cell's. */
export interface SourceInlineBlock {
    readonly start: number;
    readonly end:   number;
    /** Whether it is a table cell's text, whose literal `\n\n` the viewer reads as a paragraph break. */
    readonly cell:  boolean;
}

/**
 * One block token at any depth, with where its source sits and the blocks it
 * holds: what a line command reads a selection's blocks, and the quotes and
 * list items around them, from.
 */
export interface SourceBlockNode {
    /**
     * The token's type — `paragraph`, `heading`, `text` (a tight list item's
     * text), `blockquote`, `list`, `list_item`, `code`, `html`, `def`, `hr`,
     * `checkbox`, `mdtable`, `mdblock` (a `:::` fence) — or `column`, one
     * column of a `:::` fence.
     */
    readonly type:       string;
    /** The token; `null` for a column, which has none. */
    readonly token:      Token | null;
    /**
     * The source offsets of the token's `raw`, its trailing newlines dropped;
     * `-1` when it could not be found, and always for a column.
     */
    readonly start:      number;
    readonly end:        number;
    readonly parent:     SourceBlockNode | null;
    readonly children:   readonly SourceBlockNode[];
    /** The index in {@link SourceAnalysis.entries} of the block's first entry, its signature. */
    readonly entryStart: number;
    /** The index just past the block's last entry. */
    readonly entryEnd:   number;
}

/**
 * One step of the document's meaning, in reading order: a block boundary, or
 * one visible character (or one atom, such as an image) with the inline tokens
 * around it. Two documents mean the same when their entries do, compared
 * through {@link entryKey}.
 */
export interface SourceEntry {
    readonly kind:      "block" | "leaf";
    /** A block's signature, or a leaf's visible text prefixed with its kind. */
    readonly key:       string;
    /** The leaf's source offsets (the whole atom for a code span or escape), `-1` when not located. */
    readonly start:     number;
    readonly end:       number;
    /** The inline tokens enclosing the leaf, outermost first — a code span's own leaves end with the code span. */
    readonly ancestors: readonly SourceInline[];
}

/** The format a leaf shows: its emphasis letters, its link target and its span style. */
export interface EntryFormat {
    /** The leaf's formats as letters in a fixed order: `b`old, `i`talic, `s`trikethrough, `u`nderline, `c`ode. */
    readonly marks: string;
    readonly link:  string | null;
    /** The span style as the serializer would write it, `""` when unstyled. */
    readonly style: string;
}

/** A document read through `lexMarkdown`, with every token's place in the source. */
export interface SourceAnalysis {
    readonly text:         string;
    /** The document's own blocks, each holding the blocks inside it. */
    readonly tree:         readonly SourceBlockNode[];
    readonly inlineBlocks: readonly SourceInlineBlock[];
    /** Every located inline token other than plain text, in document order. */
    readonly inlines:      readonly SourceInline[];
    readonly entries:      readonly SourceEntry[];
}

/** The letter each format token type adds to {@link EntryFormat.marks}. */
export const MARK_LETTERS: Readonly<Record<string, string>> = { strong: "b", em: "i", del: "s", underline: "u", codespan: "c" };

/** The order {@link EntryFormat.marks} lists its letters in. */
const MARK_ORDER = "bisuc";

/** The inline token types whose content sits between a marker run on each side. */
const EMPHASIS_TYPES: ReadonlySet<string> = new Set(["strong", "em", "del", "underline"]);

/** The inline token types holding nested inline tokens whose content offset {@link contentOffset} knows. */
const CONTAINER_TYPES: ReadonlySet<string> = new Set([...EMPHASIS_TYPES, "styledspan", "link"]);

/**
 * The characters that may stand before a container's content on a
 * continuation line: the indentation of a list item and the `>` of a quote,
 * which `marked` strips before lexing the content.
 */
const CONTAINER_PREFIX_CHARACTERS: ReadonlySet<string> = new Set([" ", "\t", ">"]);

/** The document most recently analysed, so a selection change and the command after it lex it once. */
let _cached: SourceAnalysis | null = null;

/** A {@link SourceBlockNode} while its analysis is being built. */
interface BuildingNode {
    readonly type:       string;
    readonly token:      Token | null;
    start:               number;
    end:                 number;
    readonly parent:     BuildingNode | null;
    readonly children:   BuildingNode[];
    readonly entryStart: number;
    entryEnd:            number;
}

/** The mutable state one analysis is built in. */
interface Builder {
    readonly text:         string;
    /** Where the search for the next token's source resumes. */
    cursor:                number;
    readonly tree:         BuildingNode[];
    /** The block whose content is being walked, `null` at the top level. */
    parent:                BuildingNode | null;
    readonly inlineBlocks: SourceInlineBlock[];
    readonly inlines:      SourceInline[];
    readonly entries:      SourceEntry[];
}

/**
 * Reads Markdown through the viewer's own `lexMarkdown`, the lexer the
 * editor's importer loads with, and finds each token's place in the source.
 * The last result is cached, so reading a selection's state and running a
 * command on the same text lex it once.
 *
 * Tokens are found by searching for their `raw` text, in order, from the end
 * of the previous one. `raw` is the source itself almost everywhere —
 * concatenating a token list's `raw`s reproduces the text it was lexed from —
 * except where `marked` drops a repeated link reference definition or strips a
 * container's line prefixes (a quote's `>`, a list item's indentation) before
 * lexing its content; content is matched across such prefixes. A token whose
 * text cannot be found is left unlocated (offsets `-1`): a command then
 * declines rather than guess.
 *
 * @param text - The Markdown source.
 * @returns The analysis.
 */
export function analyzeMarkdownSource(text: string): SourceAnalysis {
    if (_cached?.text !== text) {
        _cached = buildAnalysis(text);
    }

    return _cached;
}

/**
 * Builds the analysis of `text`.
 *
 * @param text - The Markdown source.
 * @returns The analysis.
 */
function buildAnalysis(text: string): SourceAnalysis {
    const builder: Builder = { text, cursor: 0, tree: [], parent: null, inlineBlocks: [], inlines: [], entries: [] };

    walkBlocks(builder, lexMarkdown(text), text.length);

    return builder;
}

/**
 * Reads the format a leaf shows from the tokens around it.
 *
 * @param entry - The leaf.
 * @param without - Tokens to treat as absent, as if their syntax were deleted.
 * @returns The leaf's format.
 */
export function entryFormat(entry: SourceEntry, without?: ReadonlySet<SourceInline>): EntryFormat {
    const letters = new Set<string>();
    let link: string | null = null;
    let style = "";

    for (const ancestor of entry.ancestors) {
        if (without?.has(ancestor) === true) {
            continue;
        }

        const letter = MARK_LETTERS[ancestor.type];

        if (letter !== undefined) {
            letters.add(letter);
        } else if (ancestor.type === "link") {
            link = (ancestor.token as Tokens.Link).href;
        } else if (ancestor.type === "styledspan") {
            style = canonicalSpanStyle((ancestor.token as unknown as { attributes: Record<string, string> }).attributes);
        }
    }

    return { marks: orderedMarks(letters), link, style };
}

/**
 * Adds one mark letter to a format.
 *
 * @param format - The format.
 * @param letter - The letter to add, from {@link MARK_LETTERS}.
 * @returns The new format.
 */
export function withMark(format: EntryFormat, letter: string): EntryFormat {
    return { ...format, marks: orderedMarks(new Set([...format.marks, letter])) };
}

/**
 * Writes a set of mark letters in {@link MARK_ORDER}.
 *
 * @param letters - The letters.
 * @returns The marks string.
 */
function orderedMarks(letters: ReadonlySet<string>): string {
    return [...MARK_ORDER].filter((letter) => letters.has(letter)).join("");
}

/**
 * Writes a span's attributes the way the serializer writes the style they
 * resolve to — unknown keys and invalid values dropped, keys in the dialect's
 * order — so two spans compare equal when the editor would show them alike.
 *
 * @param attributes - The span's attributes.
 * @returns The canonical attribute text, `""` when nothing resolves.
 */
export function canonicalSpanStyle(attributes: Record<string, string>): string {
    return formatAttributes(spanStyleToAttributes(resolveSpanStyle(attributes)));
}

/**
 * The comparison key of an entry: a block's signature, or a leaf's visible
 * text with `format`.
 *
 * @param entry - The entry.
 * @param format - The leaf's format; ignored for a block.
 * @returns The key.
 */
export function entryKey(entry: SourceEntry, format: EntryFormat): string {
    return entry.kind === "block" ? entry.key : `${entry.key}|${format.marks}|${format.link ?? ""}|${format.style}`;
}

// ---------------------------------------------------------------- source search

/**
 * Finds `needle` in `text` at or after `from`, ending at or before `limit`,
 * and maps each of its characters to the source offset it stands at. The
 * first line must appear verbatim up to its first `|`; on each later line
 * the source may carry extra container prefix characters before the
 * needle's own (see {@link CONTAINER_PREFIX_CHARACTERS}), and in a table cell
 * an escaped `\|` where the cell text holds `|`.
 *
 * @param text - The source.
 * @param from - Where the search starts.
 * @param limit - The end the match must not pass.
 * @param needle - The text to find.
 * @returns Each needle character's offset, then the offset just past the
 *   match; `null` when it is not found.
 */
function findAligned(text: string, from: number, limit: number, needle: string): number[] | null {
    // The head is the needle up to the first character the source may write
    // differently; with none, every position up to the limit is a candidate.
    const head = /^[^\n|]*/.exec(needle)![0];
    const next = (after: number): number => (head === "" ? after : text.indexOf(head, after));
    let at = next(from);

    while (at !== -1 && at + head.length <= limit) {
        const map = alignAt(text, at, limit, needle);

        if (map !== null) {
            return map;
        }

        at = next(at + 1);
    }

    return null;
}

/**
 * Matches `needle` against `text` from `at`, skipping the container prefix
 * characters a continuation line carries in the source but not in the
 * needle. A prefix ends at the line's first character that is not a space,
 * tab or `>`, in the needle or the source.
 *
 * @param text - The source.
 * @param at - Where the match starts.
 * @param limit - The end the match must not pass.
 * @param needle - The text to match.
 * @returns The offset map, as {@link findAligned} returns it, or `null`.
 */
function alignAt(text: string, at: number, limit: number, needle: string): number[] | null {
    const map: number[] = new Array<number>(needle.length + 1);
    let source = at;
    let lineHead = false;

    for (let index = 0; index < needle.length; index += 1) {
        const char = needle[index]!;

        while (source < limit && text[source] !== char && skipsSourceCharacter(text, source, char, lineHead)) {
            source += 1;
        }

        if (source >= limit || text[source] !== char) {
            return null;
        }

        map[index] = source;
        source += 1;
        lineHead = char === "\n" || (lineHead && CONTAINER_PREFIX_CHARACTERS.has(char));
    }

    map[needle.length] = source;

    return map;
}

/**
 * Whether the source character at `source` may be passed over while matching
 * `char`: a container prefix character at a line's head, or the backslash of
 * a table cell's escaped `\|`.
 *
 * @param text - The source.
 * @param source - The source offset.
 * @param char - The needle character being matched.
 * @param lineHead - Whether the match is still in the line's prefix.
 * @returns Whether to skip it.
 */
function skipsSourceCharacter(text: string, source: number, char: string, lineHead: boolean): boolean {
    if (lineHead && CONTAINER_PREFIX_CHARACTERS.has(text[source]!)) {
        return true;
    }

    return char === "|" && text[source] === "\\" && text[source + 1] === "|";
}

/**
 * The source offset just past the needle characters `[from, to)`, from a map
 * {@link findAligned} built.
 *
 * @param map - The offset map.
 * @param from - The first needle index.
 * @param to - The needle index just past the last.
 * @returns The end offset; the start offset when the stretch is empty.
 */
function endOf(map: readonly number[], from: number, to: number): number {
    return to > from ? map[to - 1]! + 1 : map[from]!;
}

/**
 * Finds a block token's `raw`, its trailing newlines dropped, from the cursor.
 *
 * @param builder - The analysis being built.
 * @param raw - The token's `raw`.
 * @param limit - The end the match must not pass.
 * @returns The offset map, or `null` when not found.
 */
function locateRaw(builder: Builder, raw: string, limit: number): number[] | null {
    const needle = raw.replace(/\n+$/, "");

    return needle === "" ? null : findAligned(builder.text, builder.cursor, limit, needle);
}

// ---------------------------------------------------------------- blocks

/**
 * Walks a block token list.
 *
 * @param builder - The analysis being built.
 * @param tokens - The block tokens.
 * @param limit - The end their source must not pass.
 */
function walkBlocks(builder: Builder, tokens: readonly Token[], limit: number): void {
    for (const token of tokens) {
        walkBlock(builder, token, limit);
    }
}

/**
 * Walks one block token: records its entries and its {@link SourceBlockNode},
 * and locates its source and, for one holding inline text, every inline token
 * in it.
 *
 * @param builder - The analysis being built.
 * @param token - The block token.
 * @param limit - The end its source must not pass.
 */
function walkBlock(builder: Builder, token: Token, limit: number): void {
    switch (token.type) {
        case "space":
            return;
        case "paragraph":
        case "heading":
        case "text":
            walkTextBlock(builder, token, limit);

            return;
        case "blockquote":
            walkContainer(builder, token, limit, "quote", (innerLimit) => {
                walkBlocks(builder, (token as Tokens.Blockquote).tokens, innerLimit);
            });

            return;
        case "list":
            walkContainer(builder, token, limit, listSignature(token as Tokens.List), (innerLimit) => {
                walkListItems(builder, (token as Tokens.List).items, innerLimit);
            });

            return;
        case "mdtable":
            walkTable(builder, token as unknown as MdTableToken, limit);

            return;
        case "mdblock":
            walkFence(builder, token as unknown as MdBlockToken, limit);

            return;
        default:
            walkLeafBlock(builder, token, limit);
    }
}

/**
 * Opens a block's node: it becomes the last child of the block being walked,
 * and the block whose content is walked next.
 *
 * @param builder - The analysis being built.
 * @param type - The node's type.
 * @param token - The block's token, `null` for a column.
 * @returns The node.
 */
function openNode(builder: Builder, type: string, token: Token | null): BuildingNode {
    const node: BuildingNode = {
        type, token, start: -1, end: -1, parent: builder.parent, children: [], entryStart: builder.entries.length, entryEnd: -1,
    };

    (builder.parent?.children ?? builder.tree).push(node);
    builder.parent = node;

    return node;
}

/**
 * Closes a block's node once its content is walked: records its span and its
 * last entry, and returns to the block around it.
 *
 * @param builder - The analysis being built.
 * @param node - The node.
 * @param span - The block's source span, `null` when it was not found.
 */
function closeNode(builder: Builder, node: BuildingNode, span: { start: number; end: number } | null): void {
    node.start = span?.start ?? -1;
    node.end = span?.end ?? -1;
    node.entryEnd = builder.entries.length;
    builder.parent = node.parent;
}

/**
 * The source span of a located `raw`, from its offset map.
 *
 * @param map - The offset map, `null` when the `raw` was not found.
 * @returns The span, or `null`.
 */
function spanOf(map: readonly number[] | null): { start: number; end: number } | null {
    return map === null ? null : { start: map[0]!, end: map[map.length - 1]! };
}

/**
 * Walks a paragraph, heading or list item text: its inline tokens when it
 * holds them, else as a block with no inline text. Its own `raw` is located
 * without moving the cursor, so the inline text is searched for exactly as
 * before the block's span was recorded.
 *
 * @param builder - The analysis being built.
 * @param token - The block token.
 * @param limit - The end its source must not pass.
 */
function walkTextBlock(builder: Builder, token: Token, limit: number): void {
    const tokens = (token as { tokens?: Token[] }).tokens;

    if (tokens === undefined) {
        walkLeafBlock(builder, token, limit);

        return;
    }

    const node = openNode(builder, token.type, token);
    const span = spanOf(locateRaw(builder, token.raw, limit));

    pushBlock(builder, token.type === "heading" ? `h${(token as Tokens.Heading).depth}` : token.type);
    walkInlineText(builder, tokens, limit, false);
    closeNode(builder, node, span);
}

/**
 * Walks a `:::` fence: its columns, searched from the line after its opener,
 * whose attribute text is no column's content.
 *
 * @param builder - The analysis being built.
 * @param token - The fence token.
 * @param limit - The end its source must not pass.
 */
function walkFence(builder: Builder, token: MdBlockToken, limit: number): void {
    const signature = `fence:${JSON.stringify(token.attributes)}`;

    walkContainer(builder, token as unknown as Token, limit, signature, (innerLimit) => {
        builder.cursor = Math.min(lineEndAt(builder.text, builder.cursor) + 1, innerLimit);
        walkFenceColumns(builder, token.columns, innerLimit);
    });
}

/**
 * The signature of a list: whether it is ordered, its start and whether it
 * is loose.
 *
 * @param token - The list token.
 * @returns The signature.
 */
function listSignature(token: Tokens.List): string {
    return `list:${String(token.ordered)}:${String(token.start)}:${String(token.loose)}`;
}

/**
 * Walks a container block: locates its source, then its content inside it.
 *
 * @param builder - The analysis being built.
 * @param token - The container token.
 * @param limit - The end its source must not pass.
 * @param signature - Its block signature.
 * @param walkContent - Walks its content, given the end that content must not pass.
 */
function walkContainer(
    builder: Builder, token: Token, limit: number, signature: string, walkContent: (innerLimit: number) => void,
): void {
    const node = openNode(builder, token.type, token);
    const span = spanOf(locateRaw(builder, token.raw, limit));

    pushBlock(builder, signature);

    if (span !== null) {
        builder.cursor = span.start;
    }

    walkContent(span?.end ?? limit);
    pushBlock(builder, `/${signature.split(":")[0]!}`);

    if (span !== null) {
        builder.cursor = Math.max(builder.cursor, span.end);
    }

    closeNode(builder, node, span);
}

/**
 * Walks a list's items, each inside its own located source.
 *
 * @param builder - The analysis being built.
 * @param items - The list's items.
 * @param limit - The end the list's source does not pass.
 */
function walkListItems(builder: Builder, items: readonly Tokens.ListItem[], limit: number): void {
    for (const item of items) {
        const node = openNode(builder, item.type, item);
        const map = locateRaw(builder, item.raw, limit);
        const end = map === null ? limit : map[map.length - 1]!;

        pushBlock(builder, `item:${String(item.task)}:${String(item.checked ?? false)}`);

        if (map !== null) {
            builder.cursor = map[0]!;
        }

        walkBlocks(builder, item.tokens, end);
        pushBlock(builder, "/item");

        if (map !== null) {
            builder.cursor = Math.max(builder.cursor, end);
        }

        closeNode(builder, node, spanOf(map));
    }
}

/**
 * Walks a `:::` fence's columns in order.
 *
 * @param builder - The analysis being built.
 * @param columns - Each column's block tokens.
 * @param limit - The end the fence's source does not pass.
 */
function walkFenceColumns(builder: Builder, columns: readonly Token[][], limit: number): void {
    for (const column of columns) {
        const node = openNode(builder, "column", null);

        pushBlock(builder, "column");
        walkBlocks(builder, column, limit);
        pushBlock(builder, "/column");
        closeNode(builder, node, null);
    }
}

/**
 * Walks a table: each header cell inside the header line, each body cell
 * inside its own row's line, so a cell's text is never found in the
 * delimiter row or another row.
 *
 * @param builder - The analysis being built.
 * @param token - The table token.
 * @param limit - The end its source must not pass.
 */
function walkTable(builder: Builder, token: MdTableToken, limit: number): void {
    const node = openNode(builder, token.type, token as unknown as Token);
    const map = locateRaw(builder, token.raw, limit);
    const lines = map === null ? null : tableLineSpans(token.raw, map);

    pushBlock(builder, `table:${JSON.stringify(token.align)}:${JSON.stringify(token.widths)}`);

    tableCellRows(token).forEach((cells, index) => {
        // The delimiter row sits between the header (line 0) and the first body row (line 2).
        const line = lines?.[index === 0 ? 0 : index + 1];

        if (line !== undefined) {
            builder.cursor = line.start;
        }

        pushBlock(builder, "row");

        for (const cell of cells) {
            pushBlock(builder, cell.signature);
            walkInlineText(builder, cell.tokens, line?.end ?? limit, true);
            pushBlock(builder, "/cell");
        }

        pushBlock(builder, "/row");
    });

    pushBlock(builder, "/table");

    const span = spanOf(map);

    if (span !== null) {
        builder.cursor = Math.max(builder.cursor, span.end);
    }

    closeNode(builder, node, span);
}

/** One table cell's inline tokens and its block signature. */
interface TableCellEntry {
    tokens:    Token[];
    signature: string;
}

/**
 * A table's cells, row by row: the header row, then each body row.
 *
 * @param token - The table token.
 * @returns The rows.
 */
function tableCellRows(token: MdTableToken): TableCellEntry[][] {
    return [
        token.header.map((cell) => ({ tokens: cell.tokens, signature: `cell:${String(cell.align)}:1:1` })),
        ...token.rows.map((row) => row.map((cell) => ({
            tokens: cell.tokens, signature: `cell:${String(cell.align)}:${cell.colSpan}:${cell.rowSpan}`,
        }))),
    ];
}

/**
 * The source span of each line of a located table.
 *
 * @param raw - The table's `raw`.
 * @param map - Its offset map.
 * @returns One span per line.
 */
function tableLineSpans(raw: string, map: readonly number[]): Array<{ start: number; end: number }> {
    const needle = raw.replace(/\n+$/, "");
    const spans: Array<{ start: number; end: number }> = [];
    let lineStart = 0;

    while (lineStart <= needle.length) {
        const lineEnd = lineEndAt(needle, lineStart);

        spans.push({ start: map[lineStart]!, end: endOf(map, lineStart, lineEnd) });
        lineStart = lineEnd + 1;
    }

    return spans;
}

/**
 * Walks a block holding no inline text: records its signature and moves the
 * cursor past its source.
 *
 * @param builder - The analysis being built.
 * @param token - The block token.
 * @param limit - The end its source must not pass.
 */
function walkLeafBlock(builder: Builder, token: Token, limit: number): void {
    const node = openNode(builder, token.type, token);

    pushBlock(builder, leafBlockSignature(token));

    const span = spanOf(locateRaw(builder, token.raw, limit));

    if (span !== null) {
        builder.cursor = span.end;
    }

    closeNode(builder, node, span);
}

/**
 * The signature of a block holding no inline text.
 *
 * @param token - The block token.
 * @returns The signature.
 */
function leafBlockSignature(token: Token): string {
    switch (token.type) {
        case "code": return `code:${(token as Tokens.Code).lang ?? ""}:${(token as Tokens.Code).text}`;
        case "def":  return `def:${(token as Tokens.Def).tag}:${(token as Tokens.Def).href}:${(token as Tokens.Def).title ?? ""}`;
        case "hr":   return "hr";
        default:     return `${token.type}:${token.raw}`;
    }
}

/**
 * Appends a block boundary entry.
 *
 * @param builder - The analysis being built.
 * @param key - The block's signature.
 */
function pushBlock(builder: Builder, key: string): void {
    builder.entries.push({ kind: "block", key, start: -1, end: -1, ancestors: [] });
}

// ---------------------------------------------------------------- inline

/**
 * Locates one run of inline text — the concatenated `raw` of its inline
 * tokens — and walks its tokens.
 *
 * @param builder - The analysis being built.
 * @param tokens - The inline tokens.
 * @param limit - The end its source must not pass.
 * @param cell - Whether it is a table cell's text.
 */
function walkInlineText(builder: Builder, tokens: readonly Token[], limit: number, cell: boolean): void {
    const needle = tokens.map((token) => token.raw).join("");
    const map = needle === "" ? null : findAligned(builder.text, builder.cursor, limit, needle);

    if (map !== null) {
        builder.inlineBlocks.push({ start: map[0]!, end: endOf(map, 0, needle.length), cell });
        builder.cursor = map[needle.length]!;
    }

    walkInline(builder, tokens, map, 0, []);
}

/**
 * Walks an inline token list whose `raw`s start at needle index `offset`.
 *
 * @param builder - The analysis being built.
 * @param tokens - The inline tokens.
 * @param map - The offset map of the run they belong to, `null` when unlocated.
 * @param offset - The needle index of the first token.
 * @param ancestors - The tokens enclosing them, outermost first.
 */
function walkInline(
    builder: Builder, tokens: readonly Token[], map: readonly number[] | null, offset: number,
    ancestors: readonly SourceInline[],
): void {
    let position = offset;

    for (const token of tokens) {
        walkInlineToken(builder, token, map, position, ancestors);
        position += token.raw.length;
    }
}

/**
 * Walks one inline token: records it (unless it is plain text) and its leaf
 * entries, and walks its children.
 *
 * @param builder - The analysis being built.
 * @param token - The inline token.
 * @param map - The offset map of its run, `null` when unlocated.
 * @param position - The needle index of its `raw`.
 * @param ancestors - The tokens enclosing it, outermost first.
 */
function walkInlineToken(
    builder: Builder, token: Token, map: readonly number[] | null, position: number,
    ancestors: readonly SourceInline[],
): void {
    if (token.type === "text" && !("tokens" in token && token.tokens !== undefined)) {
        pushTextLeaves(builder, token, map, position, ancestors);

        return;
    }

    const children = childTokens(token);
    const content = contentOffset(token, children);
    const inline = recordInline(builder, token, map, position, content);
    const inside = [...ancestors, inline];

    if (token.type === "codespan") {
        pushAtomLeaves(builder, (token as Tokens.Codespan).text, inline, inside);
    } else if (children.length > 0 || CONTAINER_TYPES.has(token.type)) {
        walkInline(builder, children, content === -1 ? null : map, position + Math.max(content, 0), inside);
    } else {
        pushAtomLeaves(builder, leafText(token), inline, inside);
    }
}

/**
 * An inline token's child tokens.
 *
 * @param token - The token.
 * @returns Its children; empty for a token holding none.
 */
function childTokens(token: Token): Token[] {
    return (token as { tokens?: Token[] }).tokens ?? [];
}

/**
 * Where a container token's children begin inside its `raw`: after the
 * marker run of an emphasis token, after the `[` or `<` of a link (a bare
 * autolink has none), after the `[` of a styled span, after the backtick run
 * of a code span (whose content is code, not tokens). Checked against the
 * children's own `raw`s, which must sit there verbatim.
 *
 * @param token - The token.
 * @param children - Its child tokens.
 * @returns The offset, or `-1` when the token has no content or it is not where expected.
 */
function contentOffset(token: Token, children: readonly Token[]): number {
    const raw = token.raw;

    if (token.type === "codespan") {
        return /^`*/.exec(raw)![0].length;
    }

    const content = children.map((child) => child.raw).join("");
    let offset: number;

    if (EMPHASIS_TYPES.has(token.type)) {
        offset = (raw.length - content.length) / 2;
    } else if (token.type === "link" || token.type === "styledspan") {
        offset = raw.startsWith("[") || raw.startsWith("<") ? 1 : 0;
    } else if (children.length > 0) {
        offset = raw.indexOf(content);
    } else {
        return -1;
    }

    return Number.isInteger(offset) && offset >= 0 && raw.startsWith(content, offset) ? offset : -1;
}

/**
 * Records an inline token other than plain text, located when its run is.
 *
 * @param builder - The analysis being built.
 * @param token - The token.
 * @param map - The offset map of its run, `null` when unlocated.
 * @param position - The needle index of its `raw`.
 * @param content - Its content offset from {@link contentOffset}.
 * @returns The record.
 */
function recordInline(
    builder: Builder, token: Token, map: readonly number[] | null, position: number, content: number,
): SourceInline {
    const raw = token.raw;
    const hasContent = EMPHASIS_TYPES.has(token.type) || token.type === "styledspan"
        || (token.type === "link" && raw.startsWith("["));

    if (map === null) {
        return { type: token.type, token, start: -1, end: -1, innerStart: -1, innerEnd: -1, hasContent };
    }

    const contentLength = token.type === "codespan"
        ? raw.length - 2 * content
        : childTokens(token).reduce((length, child) => length + child.raw.length, 0);
    const located = content === -1 || contentLength < 0
        ? { innerStart: -1, innerEnd: -1 }
        : { innerStart: map[position + content]!, innerEnd: endOf(map, position + content, position + content + contentLength) };
    const inline: SourceInline = {
        type: token.type, token, start: map[position]!, end: endOf(map, position, position + raw.length), ...located,
        hasContent: hasContent && located.innerStart !== -1,
    };

    builder.inlines.push(inline);

    return inline;
}

/**
 * Appends one leaf per character of a plain text token, each at its own
 * source offset when the run is located.
 *
 * @param builder - The analysis being built.
 * @param token - The text token.
 * @param map - The offset map of its run, `null` when unlocated.
 * @param position - The needle index of its `raw`.
 * @param ancestors - The tokens enclosing it, outermost first.
 */
function pushTextLeaves(
    builder: Builder, token: Token, map: readonly number[] | null, position: number,
    ancestors: readonly SourceInline[],
): void {
    const text = (token as Tokens.Text).text;

    if (text !== token.raw) {
        const start = map === null ? -1 : map[position]!;
        const end = map === null ? -1 : endOf(map, position, position + token.raw.length);

        for (const char of text) {
            builder.entries.push({ kind: "leaf", key: `t${char}`, start, end, ancestors });
        }

        return;
    }

    for (let index = 0; index < text.length; index += 1) {
        const start = map === null ? -1 : map[position + index]!;

        builder.entries.push({ kind: "leaf", key: `t${text[index]!}`, start, end: start === -1 ? -1 : start + 1, ancestors });
    }
}

/**
 * Appends the leaves of an atomic token — one per visible character for a
 * code span or an escape, one for anything else — all spanning the token.
 *
 * @param builder - The analysis being built.
 * @param text - The atom's visible text, or its signature for a non-text atom.
 * @param inline - The atom's record.
 * @param ancestors - The tokens enclosing its leaves, the atom itself last.
 */
function pushAtomLeaves(builder: Builder, text: string, inline: SourceInline, ancestors: readonly SourceInline[]): void {
    const characters = inline.type === "codespan" || inline.type === "escape" ? [...text].map((char) => `t${char}`) : [text];

    for (const key of characters) {
        builder.entries.push({ kind: "leaf", key, start: inline.start, end: inline.end, ancestors });
    }
}

/**
 * The visible text, or for a non-text atom the signature, of a leaf token.
 *
 * @param token - The token.
 * @returns The leaf text.
 */
function leafText(token: Token): string {
    switch (token.type) {
        case "escape":  return (token as Tokens.Escape).text;
        case "br":      return "br";
        default:        return `${token.type}:${token.raw}`;
    }
}
