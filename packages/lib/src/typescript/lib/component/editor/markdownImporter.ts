// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    $addUpdateTag, $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isElementNode, $setState,
    TEXT_TYPE_TO_FORMAT,
} from "lexical";
import type { ElementNode, LexicalNode, NodeKey, TextFormatType, TextNode } from "lexical";
import { Lexer } from "marked";
import type { Links, Token, Tokens, TokensList } from "marked";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import type { HeadingTagType, QuoteNode } from "@lexical/rich-text";
import { $createListItemNode, $createListNode, $isListNode } from "@lexical/list";
import type { ListItemNode, ListNode } from "@lexical/list";
import { $createLinkNode } from "@lexical/link";
import type { LinkNode } from "@lexical/link";
import { $createCodeNode } from "@lexical/code";
import type { CodeNode } from "@lexical/code";
import {
    $createTableCellNode, $createTableNode, $createTableRowNode, $isTableCellNode, TableCellHeaderStates,
} from "@lexical/table";
import type { TableCellNode, TableNode } from "@lexical/table";
import { $dfs } from "@lexical/utils";
import { lexMarkdown, lexMarkdownLinkDefinitions, lexMarkdownWithDefinitions } from "~/component/display/markdownExtensions.js";
import type { MdBlockToken } from "~/component/display/markdownExtensions.js";
import { CELL_LINE_BREAK_TAG } from "~/component/display/markdownTableExtension.js";
import type { MdTableBodyCell, MdTableHeaderCell, MdTableToken } from "~/component/display/markdownTableExtension.js";
import {
    lineEndAt, resolveBlockStyle, resolveImageSpec, resolveSpanStyle, spanStyleToCss, splitColumnSections,
} from "~/component/display/markdownAttributes.js";
import type { MarkdownSpanStyle } from "~/component/display/markdownAttributes.js";
import { $createMarkdownBlockNode, $createMarkdownColumnNode } from "~/component/editor/markdownBlockNode.js";
import type { MarkdownBlockNode } from "~/component/editor/markdownBlockNode.js";
import { $createMarkdownImageNode } from "~/component/editor/markdownImageNode.js";
import type { MarkdownImageNode } from "~/component/editor/markdownImageNode.js";
import { $createMarkdownListItemTextNode, $isMarkdownListItemTextNode } from "~/component/editor/markdownListItemNode.js";
import {
    bareAutolinkState, codeInfoState, fenceOpeningState, hardBreakMarkerState, imageAttributesState, KEPT_SOURCE_WRITES_LINK,
    KEPT_SOURCE_WRITES_STYLE, keptSourceState, listLooseState, listMarkerState, NESTED_LINK_WRITES_STYLE, nestedLinkGroupState,
    nestedLinkState, spanAttributesState,
} from "~/component/editor/markdownNodeState.js";
import { $createReferenceLinkNode, $isReferenceLinkNode } from "~/component/editor/markdownReferenceLinkNode.js";
import type { ReferenceLinkReference } from "~/component/editor/markdownReferenceLinkNode.js";
import {
    $documentDefinitions, $listReadsLoose, $readDefinitions, $serializeLinkContent, $serializeTopLevelBlocks, rawBlockAtMargin, rawBlockInItem,
    rawBlockStandsInItem, runsOn, withoutBlankEdges,
} from "~/component/editor/markdownSerializer.js";
import { $createMarkdownRawBlockNode, $createMarkdownSourceTextNode, $isMarkdownRawBlockNode } from "~/component/editor/markdownSourceNodes.js";
import { headingSlugSource, slugify } from "~/component/display/markdownHeadingIds.js";
import { $readStandardForm, keptImageShown } from "~/component/editor/markdownSerializer.js";
import type { StandardFormReading } from "~/component/editor/markdownSerializer.js";
import type { MarkdownSourceBlock, MarkdownSourceLoad, MarkdownSourceMap } from "~/component/editor/markdownSourceMap.js";

// ---------------------------------------------------------------- constants

/** The shallowest and deepest heading level; mirrors the viewer's own clamp in `Markdown.ts`. */
const HEADING_MIN_DEPTH = 1;
const HEADING_MAX_DEPTH = 6;

/**
 * The four characters `\n\n` (backslash, `n`, backslash, `n`) the serializer
 * writes between a table cell's paragraphs. Mirrors the viewer's own
 * `CELL_PARAGRAPH_BREAK` in `Markdown.ts`, which it splits a cell's text on.
 */
const CELL_PARAGRAPH_BREAK = "\\n\\n";

/** A soft line break's source, and the one space it shows as, as the viewer flows it. */
const SOFT_BREAK_SOURCE = "\n";
const SOFT_BREAK_DISPLAY = " ";

/** The Lexical text format each emphasis-like inline token adds. */
const TOKEN_FORMATS: Readonly<Record<string, TextFormatType>> = {
    strong: "bold", em: "italic", del: "strikethrough", underline: "underline",
};

/**
 * A list's first marker: up to three spaces of indentation (CommonMark's
 * limit), then a bullet character, or one to nine digits (CommonMark's limit
 * for a list number) and the delimiter after them.
 */
const LIST_MARKER = /^ {0,3}(?:([-*+])|\d{1,9}([.)]))/;

/** `marked`'s own pattern for a link reference definition, which can run on to the next lines (its destination, its title). */
const BLOCK_DEFINITION = Lexer.rules.block.gfm.def;

/** A fenced code block's opening line: the info string after the fence (capture 1). */
const FENCE_INFO = /^ {0,3}(?:`{3,}|~{3,})([^\n]*)/;

/**
 * A line opening a link reference definition: up to three spaces of
 * indentation (CommonMark's limit) and `[`. `marked` drops a repeated one
 * without a token, so a token may resume after such lines.
 */
const DEFINITION_LINE = /^ {0,3}\[/;

/**
 * The token types whose `raw` `marked` may rebuild rather than slice from the
 * source (a blockquote around a lazy continuation line, and the lists inside
 * it), so they are matched with whitespace ignored when no exact match is found.
 */
const REBUILT_RAW_TYPES: ReadonlySet<string> = new Set(["blockquote", "list"]);

/** A line holding only whitespace between two newlines: a blank line, which ends a run of definitions. */
const BLANK_LINE = /\n[ \t]*\n/;

/**
 * How many times one block is built and its standard form read while
 * choosing the constructs to keep as written. Each try serializes the block
 * and lexes it once; the cap bounds the cost of a block no choice fixes,
 * which keeps the best one found. It covers a candidate per nesting level
 * and neighbour for several constructs; a fuzz of 12 000 generated and
 * corpus documents found no block needing more than a dozen.
 */
const MAX_KEEP_TRIES = 64;

/** The inline token types that write nothing but their characters, which every standard form reads back as written. */
const PLAIN_TEXT_TOKENS: ReadonlySet<string> = new Set(["text", "escape"]);

/** A span style that sets nothing. */
const NO_STYLE: MarkdownSpanStyle = { color: null, fontFamily: null, fontSize: null };

/**
 * The link reference definitions of the document a load is building, for
 * reading each block's standard form as the save will write it; `null`
 * outside a load (a raw block split while editing reads its blocks with
 * none, so a reference link there may be kept as written).
 */
const IMPORT_DEFINITIONS: { current: Links | null } = { current: null };

/**
 * Whether a document is being loaded from its source. Only then are the blanks
 * a paragraph line opens with dropped: they are not part of its text. A block
 * read again in the middle of an edit keeps them, because there the blanks
 * may be ones the edit did not remove, which only became a line's opening.
 */
const LOADING_DOCUMENT: { current: boolean } = { current: false };

/**
 * `marked`'s own patterns for a full reference (`[text][label]`) and for a
 * collapsed or shortcut one (`[label][]`, `[label]`) — the patterns that
 * produced a reference's `link` token, so a label holding an escaped bracket
 * or a code span is read exactly as the viewer read it.
 */
const FULL_REFERENCE = Lexer.rules.inline.gfm.reflink;
const SHORT_REFERENCE = Lexer.rules.inline.gfm.nolink;

// ---------------------------------------------------------------- types

/** One located block token with its source text, or a stretch of text no token covers, and where it lies. */
type LocatedBlock = ({ token: Token; source: string } | { gap: string }) & { start: number; end: number };

/**
 * Where a link run points, and how a reference link was written; one object
 * per `link` token, so two links with one URL stay apart.
 */
interface LinkTarget {
    readonly href:      string;
    readonly title:     string | null;
    readonly reference: ReferenceLinkReference | null;
    /** Whether the link was written as a GFM bare autolink (a URL, `www.` address or email as plain text). */
    readonly bare:      boolean;
}

/** The formatting an inline walk carries down to the nodes it appends. */
interface InlineContext {
    readonly formats:        readonly TextFormatType[];
    readonly spanStyle:      MarkdownSpanStyle;
    /** The authored attribute text of the innermost styled span, `""` outside one. */
    readonly spanAttributes: string;
    readonly link:           LinkTarget | null;
}

/** One run of a link nested in a link's text: what it shows, the Markdown it saves, and its formatting. */
interface NestedLinkPiece {
    display: string;
    source:  string;
    readonly context: InlineContext;
}

/**
 * One run of a construct kept as written: what it shows, the Markdown it
 * saves, its formatting, and — for an image or a hard break, which keep
 * their own node — its token.
 */
interface KeptPiece extends NestedLinkPiece {
    readonly leaf: Tokens.Generic | null;
}

/** Where inline nodes are appended: the current block, and the link node runs of the open link go into. */
interface InlineTarget {
    block:    ElementNode;
    openLink: { readonly target: LinkTarget; readonly node: LinkNode } | null;
    /** In a table cell, starts the cell's next paragraph; `null` elsewhere. */
    readonly nextCellParagraph: (() => ElementNode) | null;
    /** The tokens kept as written ({@link keptSourceState}). */
    readonly keep: ReadonlySet<Token>;
    /** The links at an edge of the block's inline content ({@link edgeLinks}). */
    readonly edges: ReadonlySet<Token>;
}

/** A `:::` fence's opening line: the text after its `:::`, without trailing whitespace. */
const FENCE_OPENING = /^\s*:::(.*?)\s*$/;

/** A styled span's `raw` ending: its attribute text between the braces. */
const SPAN_ATTRIBUTES = /\]\{([^{}]*)\}$/;

/** An image's `raw` ending, when it has an attribute group: its text between the braces. */
const IMAGE_ATTRIBUTES = /\)\{([^{}]*)\}$/;

/** The context an inline walk starts from: no formats, no style, no link. */
const PLAIN: InlineContext = { formats: [], spanStyle: NO_STYLE, spanAttributes: "", link: null };

/**
 * The update tag a load carries, so the editor's rules leave the loaded
 * document as the viewer reads it — two adjacent lists of one marker that
 * `marked` reads apart (an empty item ends a list) are not joined.
 */
export const MARKDOWN_IMPORT_TAG = "markdown-import";

// ---------------------------------------------------------------- entry point

/**
 * Replaces the active editor state's document with `markdown`, read with the
 * viewer's own lexer (`lexMarkdown`) and built token by token following the
 * viewer's render dispatch, so the editor shows what the viewer shows. Like
 * `@lexical/markdown`'s `$convertFromMarkdownString`, which it replaces, it
 * must run inside an `editor.update` and moves any selection to the start.
 * The update is tagged {@link MARKDOWN_IMPORT_TAG}.
 *
 * @param markdown - The Markdown to load.
 * @returns The document's source map, which a save takes to write the blocks
 *   left unedited as they were written.
 */
export function $importMarkdown(markdown: string): MarkdownSourceMap {
    const source = markdown.replace(/\r\n?/g, "\n");
    const root = $getRoot();

    $addUpdateTag(MARKDOWN_IMPORT_TAG);
    IMPORT_DEFINITIONS.current = lexMarkdownLinkDefinitions(source);
    LOADING_DOCUMENT.current = true;

    const located = locateBlocks(source, lexMarkdown(source));
    let blocks: LexicalNode[];

    try {
        blocks = located.map($buildLocatedBlock);
    } finally {
        IMPORT_DEFINITIONS.current = null;
        LOADING_DOCUMENT.current = false;
    }

    root.clear();
    root.append(...(blocks.length > 0 ? blocks : [$createParagraphNode()]));
    $recordReferenceContents();

    if ($getSelection() !== null) {
        root.selectStart();
    }

    return $recordSourceMap(source, located);
}

/** One top-level block of a document, as a load locates it. */
export interface TopLevelBlock {
    /** The block's start offset in the document. */
    readonly start:                number;
    /** The block's end offset in the document. */
    readonly end:                  number;
    /** Whether the block holds link reference definitions and nothing else. */
    readonly holdsOnlyDefinitions: boolean;
}

/** A document's top-level blocks and its link reference definitions, from one lex. */
export interface TopLevelBlocks {
    /** The blocks, in document order. */
    readonly blocks:      readonly TopLevelBlock[];
    /** The document's link reference definitions. */
    readonly definitions: Links;
}

/**
 * Locates the top-level blocks a load of the Markdown builds, and reads the
 * document's definitions, from one lex of the text.
 *
 * @param markdown - The Markdown, with `\n` line ends only.
 * @returns The blocks and the definitions.
 */
export function locateTopLevelBlocks(markdown: string): TopLevelBlocks {
    const tokens = lexMarkdown(markdown);
    const blocks = locateBlocks(markdown, tokens).map((entry) => ({
        start: entry.start, end: entry.end, holdsOnlyDefinitions: holdsOnlyDefinitions(entry),
    }));

    // `lexMarkdown` returns `marked`'s token list, which carries the definitions it read.
    return { blocks, definitions: (tokens as TokensList).links };
}

/**
 * Records every reference link's text as the serializer writes it, so a save
 * can tell whether it has been edited or formatted since. Runs once the
 * document is complete, because the serializer reads the finished tree.
 *
 * @param root - The block whose reference links to record; the whole document when omitted.
 */
function $recordReferenceContents(root?: LexicalNode): void {
    for (const { node } of $dfs(root)) {
        if ($isReferenceLinkNode(node)) {
            node.setImportedContent($serializeLinkContent(node));
        }
    }
}

// ---------------------------------------------------------------- blocks

/** The blocks a raw block's text reads as, built, each with where its text stands in the raw block's. */
export interface RawBlockReading {
    readonly nodes: LexicalNode[];
    /** Each block's `[start, end)` offsets in the raw block's text. */
    readonly spans: ReadonlyArray<readonly [number, number]>;
}

/**
 * The block token types a load builds a node of their own for (or may: a
 * quote, list or table the nodes cannot hold is a raw block); every other
 * type is a raw block.
 */
const HELD_BLOCK_TYPES: ReadonlySet<string> = new Set(["heading", "paragraph", "code", "blockquote", "list", "mdtable", "mdblock"]);

/**
 * Reads a raw block's text with a line end after it, as a save writes it
 * before the next block. The last block of a document or `:::` column may
 * have none after it and reads the same: the lexer takes the end of its input
 * as the line end an HTML block start needs. Builds the blocks it reads as,
 * the way a load builds them, when that is more than one block (runs of
 * link reference definitions a blank line apart are a raw block each, as a
 * load builds them; one run alone stays the raw block it is),
 * or one block a load builds a node of its own for (a paragraph, a heading,
 * a code block, …), which the editor shows as that node, not as Markdown
 * text. The editor then shows the raw block as those blocks, as the save
 * reads. Must run inside an `editor.update`.
 *
 * @param text - The raw block's text.
 * @returns The blocks, or `null` when the text reads as one raw block.
 */
export function $readRawBlockAsBlocks(text: string): RawBlockReading | null {
    const source = text + "\n";
    const located = joinDefinitionRuns(source, locateTokens(source, lexMarkdown(source)));

    // Text holding nothing reads as no block at all, and stays the raw block it is.
    if (located.length === 0) {
        return null;
    }

    const only = located.length === 1 ? located[0]! : null;

    if (only !== null && ("gap" in only || !HELD_BLOCK_TYPES.has(only.token.type))) {
        return null;
    }

    const spans = located.map((entry): readonly [number, number] => [entry.start, Math.min(entry.end, text.length)]);
    const nodes = located.map((entry) => ("gap" in entry ? $buildRawBlock(entry.gap) : $buildBlock(entry.token, entry.source)));

    if (nodes.length === 1 && $isMarkdownRawBlockNode(nodes[0]!)) {
        return null;
    }

    return { nodes, spans };
}

/**
 * Builds the blocks Markdown reads as in a document holding `definitions`,
 * the way a load builds them — lexed with those definitions in force, each
 * block's constructs kept as written against them, and each reference
 * link's text recorded as the load records it. The editor shows a block
 * anew this way when the document's definitions change how the block's
 * save reads. Must run inside an `editor.update`.
 *
 * @param markdown - The blocks' Markdown, as a save writes them.
 * @param definitions - The document's link reference definitions.
 * @returns The blocks, in document order; none for Markdown that reads as nothing.
 */
export function $readBlocksWithDefinitions(markdown: string, definitions: Links): LexicalNode[] {
    IMPORT_DEFINITIONS.current = definitions;

    let blocks: LexicalNode[];

    try {
        blocks = $buildBlockList(markdown, lexMarkdownWithDefinitions(markdown, definitions));
    } finally {
        IMPORT_DEFINITIONS.current = null;
    }

    for (const block of blocks) {
        $recordReferenceContents(block);
    }

    return blocks;
}

/**
 * Builds a block's inline content from inline tokens the way a load builds
 * it — each construct its standard form could not write back kept as
 * written, a table cell's paragraphs split at its cell paragraph breaks, and
 * each reference link's text recorded as a load records it — replacing what
 * the block held. Must run inside an `editor.update`.
 *
 * @param block - The paragraph, heading, quote, list item or table cell.
 * @param tokens - The inline tokens.
 */
export function $buildInlineContent(block: ElementNode, tokens: Token[]): void {
    IMPORT_DEFINITIONS.current = $documentDefinitions();

    try {
        if ($isTableCellNode(block)) {
            $buildCellParagraphs(block, tokens);
        } else {
            $appendInlineContent(block, tokens);
        }
    } finally {
        IMPORT_DEFINITIONS.current = null;
    }

    $recordReferenceContents(block);
}

/**
 * Records, for each root block just built, its source, the text after it and
 * its standard output (its fingerprint). Runs after the document is complete
 * — reference links' contents recorded — but before Lexical's node transforms
 * run at commit, so a transform that changes a block's content (the list
 * merge) makes it differ from its fingerprint and save in the standard form.
 *
 * @param source - The loaded source, its line endings normalized.
 * @param located - The root's located blocks, one per root node.
 * @returns The source map; it holds no block when the root's nodes do not
 *   pair one to one with the located blocks.
 */
function $recordSourceMap(source: string, located: LocatedBlock[]): MarkdownSourceMap {
    const definitions = $readDefinitions();
    const rendered = $serializeTopLevelBlocks(definitions);
    const load: MarkdownSourceLoad = {
        prefix:          located.length > 0 ? source.slice(0, located[0]!.start) : source,
        endsWithNewline: source.endsWith("\n"),
        blockCount:      located.length,
        endsOpen:        endsOpen(source, located),
        definitions:     definitions.all,
        definitionsKey:  definitions.key,
    };
    const blocks = new Map<NodeKey, MarkdownSourceBlock>();

    if (located.length === 0 && rendered.length === 1) {
        const { node, text } = rendered[0]!;

        blocks.set(node.getKey(), { load, index: 0, body: "", after: "", fingerprint: text });
    } else if (rendered.length === located.length) {
        located.forEach((entry, index) => {
            const after = source.slice(entry.end, located[index + 1]?.start ?? source.length);
            const { node, text } = rendered[index]!;

            blocks.set(node.getKey(), { load, index, body: source.slice(entry.start, entry.end), after, fingerprint: text });
        });
    }

    return { latest: load, blocks };
}

/**
 * Tells whether the source's last block runs to the end of the document — an
 * unclosed code fence — as the serializer's {@link runsOn} tells it for a raw
 * block. Only the last block can run on: every other one ended before the
 * next began.
 *
 * @param source - The loaded source.
 * @param located - The root's located blocks.
 * @returns `true` when a block written after the last one would join it.
 */
function endsOpen(source: string, located: LocatedBlock[]): boolean {
    const last = located[located.length - 1];

    return last !== undefined && runsOn(source.slice(last.start, last.end));
}

/**
 * Builds one node per block token of `text`, and a raw block for any text
 * between them no token covers.
 *
 * @param text - The text the tokens were lexed from.
 * @param tokens - Its block tokens.
 * @returns The block nodes, in document order.
 */
function $buildBlockList(text: string, tokens: Token[]): LexicalNode[] {
    return locateBlocks(text, tokens).map($buildLocatedBlock);
}

/**
 * Locates the block tokens of `text`, with the gaps between them and each
 * run of definitions joined: one entry per block node to build.
 *
 * @param text - The text the tokens were lexed from.
 * @param tokens - Its block tokens.
 * @returns The located blocks, in document order.
 */
function locateBlocks(text: string, tokens: Token[]): LocatedBlock[] {
    return joinDefinitionRuns(text, locateTokens(text, tokens));
}

/**
 * Builds the node of one located block: a raw block for a gap, else the
 * token's node.
 *
 * @param entry - The located token or gap.
 * @returns Its node.
 */
function $buildLocatedBlock(entry: LocatedBlock): LexicalNode {
    return "gap" in entry ? $buildRawBlock(entry.gap) : $buildBlock(entry.token, entry.source);
}

/**
 * Joins each run of link reference definitions on consecutive lines — `def`
 * tokens, and the gaps holding a definition `marked` dropped — into one gap
 * of their source, so the run is one raw block and saves with its lines as
 * written, not with a blank line between every two. A blank line between
 * two definitions ends a run: a gap of dropped definitions is split there
 * ({@link definitionRuns}), so repeated definitions are the same raw blocks
 * as first ones.
 *
 * Each entry is tested once, as it is met, and a joined run counts as
 * definitions without being lexed again: two definition-only entries on
 * consecutive lines stay definitions when joined, because the second opens
 * with `[`, and only a quote or a parenthesis continues a definition onto
 * the next line (as its title). So a load lexes each dropped definition
 * once, and stays linear in the run's length.
 *
 * @param text - The text the entries were located in.
 * @param located - The located tokens and gaps, in document order.
 * @returns The entries, each run of definitions joined.
 */
function joinDefinitionRuns(text: string, located: LocatedBlock[]): LocatedBlock[] {
    const joined: LocatedBlock[] = [];
    let lastHoldsOnlyDefinitions = false;

    for (const entry of located) {
        const entryHoldsOnlyDefinitions = holdsOnlyDefinitions(entry);

        for (const run of entryHoldsOnlyDefinitions ? definitionRuns(entry) : [entry]) {
            const last = joined[joined.length - 1];
            const continuesRun = last !== undefined && lastHoldsOnlyDefinitions && entryHoldsOnlyDefinitions
                && !BLANK_LINE.test(text.slice(last.end, run.start));

            if (continuesRun) {
                joined[joined.length - 1] = { gap: text.slice(last.start, run.end), start: last.start, end: run.end };
            } else {
                joined.push(run);
            }

            lastHoldsOnlyDefinitions = entryHoldsOnlyDefinitions;
        }
    }

    return joined;
}

/**
 * Splits a definition-only entry into its runs of definitions: a blank line
 * between two definitions ends a run. Only a gap can hold several runs —
 * `marked` gives no token for a repeated definition, so repeated ones a
 * blank line apart are one stretch of text no token covers. A blank line
 * inside a definition (in its title) belongs to it: each definition's
 * extent is read with `marked`'s own pattern ({@link candidateStarts}).
 *
 * @param entry - A located entry holding only definitions.
 * @returns One gap per run; the entry itself when it holds no blank line.
 */
function definitionRuns(entry: LocatedBlock): LocatedBlock[] {
    const gap = "gap" in entry ? entry.gap : null;
    const holdsBlankLine = gap !== null && BLANK_LINE.test(gap);

    if (gap === null || !holdsBlankLine) {
        return [entry];
    }

    const run = (from: number, to: number): LocatedBlock => {
        const text = gap.slice(from, to).trimEnd();

        return { gap: text, start: entry.start + from, end: entry.start + from + text.length };
    };

    const runs: LocatedBlock[] = [];
    let runStart = 0;
    let afterPrevious = 0;

    for (const start of candidateStarts(gap, 0, true)) {
        // The definition before this one ended lines above: blank lines stand between the two.
        if (start > afterPrevious) {
            runs.push(run(runStart, afterPrevious));
            runStart = start;
        }

        afterPrevious = nextLineAfterDefinition(gap, start);
    }

    runs.push(run(runStart, gap.length));

    return runs;
}

/**
 * Tells whether a located entry holds link reference definitions and nothing
 * else: a `def` token, or a gap that lexes to definitions alone.
 *
 * @param entry - The located token or gap.
 * @returns `true` for a definition-only entry.
 */
function holdsOnlyDefinitions(entry: LocatedBlock): boolean {
    if (!("gap" in entry)) {
        return entry.token.type === "def";
    }

    return lexMarkdown(entry.gap).every((token) => token.type === "def" || token.type === "space");
}

/**
 * Pairs each non-space token with its source text, inserting a gap entry for
 * any non-blank text no located token covers. Tokens are matched in order,
 * each where the text after the previous one resumes: `marked` emits no token
 * for a repeated link reference definition, so summing `raw` lengths would
 * drift past it. A container whose `raw` `marked` rebuilt (a blockquote's
 * lazy continuation line gains a blank line) still matches with whitespace
 * ignored; a token that matches neither way is not located, and its text
 * joins the next gap, kept as raw Markdown — never written twice, never
 * dropped.
 *
 * @param text - The text the tokens were lexed from.
 * @param tokens - Its block tokens.
 * @returns The located tokens and gaps, in document order.
 */
function locateTokens(text: string, tokens: Token[]): LocatedBlock[] {
    const located: LocatedBlock[] = [];
    let cursor = 0;

    for (const token of tokens.filter((candidate) => candidate.type !== "space")) {
        const span = locateToken(text, withoutBlankEdges(token.raw ?? ""), REBUILT_RAW_TYPES.has(token.type), cursor);

        if (span === null) {
            continue;
        }

        located.push(...gapBetween(text, cursor, span.start));

        // The token's text runs to its line's end: whitespace ending its last
        // line can be content (a code line of spaces) and is kept.
        const end = lineEndAt(text, span.end);

        located.push({ token, source: text.slice(span.start, end), start: span.start, end });
        cursor = end;
    }

    located.push(...gapBetween(text, cursor, text.length));

    return located;
}

/**
 * The gap entry for the text between two positions, without its blank edges.
 *
 * @param text - The text.
 * @param from - Where the gap starts.
 * @param to - Where it ends.
 * @returns The gap, or nothing when the text there is blank.
 */
function gapBetween(text: string, from: number, to: number): LocatedBlock[] {
    const stretch = text.slice(from, to);
    const gap = withoutBlankEdges(stretch);

    if (gap === "") {
        return [];
    }

    const start = from + stretch.indexOf(gap);

    return [{ gap, start, end: start + gap.length }];
}

/**
 * Finds one token's text where the text resumes after `from` (the first
 * non-blank line), or — when that line opens a link reference definition
 * `marked` may have dropped — at the first later non-blank line it matches.
 * Exact matches are tried before whitespace-insensitive ones, which only a
 * container whose `raw` `marked` may rebuild gets, so a dropped definition
 * whose text equals a later block's, whitespace aside, is never taken for
 * that block.
 *
 * @param text - The text the token was lexed from.
 * @param body - The token's `raw` without blank edges.
 * @param rebuilt - Whether the token's `raw` may differ from the text in whitespace.
 * @param from - The end of the previous token.
 * @returns The token's span in `text`, or `null` when it does not match there.
 */
function locateToken(text: string, body: string, rebuilt: boolean, from: number): { start: number; end: number } | null {
    if (body === "") {
        return null;
    }

    const start = resumePosition(text, from);
    const searchesLater = DEFINITION_LINE.test(text.slice(start, lineEndAt(text, start)));
    const matchers = rebuilt ? [exactEnd, endIgnoringWhitespace] : [exactEnd];

    for (const matcher of matchers) {
        for (const candidate of candidateStarts(text, start, searchesLater)) {
            const end = endsLine(text, matcher(text, candidate, body));

            if (end !== -1) {
                return { start: candidate, end };
            }
        }
    }

    return null;
}

/**
 * Yields the line starts a token may begin at: `start`, then — when
 * `searchesLater` — the start of each later non-blank line, in order,
 * skipping the lines a definition opening on a yielded line runs on to (its
 * destination or title, which a dropped definition holds and no token
 * stands for). Lazy, so a search stops scanning at its first match instead
 * of listing every line to the document's end.
 *
 * @param text - The text.
 * @param start - The start of a line (yielded first).
 * @param searchesLater - Whether the later non-blank lines are candidates too.
 */
function* candidateStarts(text: string, start: number, searchesLater: boolean): Generator<number> {
    yield start;

    if (!searchesLater) {
        return;
    }

    for (let lineStart = nextLineAfterDefinition(text, start); lineStart < text.length; lineStart = nextLineAfterDefinition(text, lineStart)) {
        const blank = text.slice(lineStart, lineEndAt(text, lineStart)).trim() === "";

        if (!blank) {
            yield lineStart;
        }
    }
}

/**
 * The start of the line after the one at `lineStart` — or, when that line
 * opens a link reference definition, after the lines the definition runs on
 * to, read with `marked`'s own definition pattern.
 *
 * @param text - The text.
 * @param lineStart - The start of a line.
 * @returns The start of the next line to consider.
 */
function nextLineAfterDefinition(text: string, lineStart: number): number {
    const nextLine = lineEndAt(text, lineStart) + 1;
    const definition = DEFINITION_LINE.test(text.slice(lineStart, nextLine)) ? BLOCK_DEFINITION.exec(text.slice(lineStart)) : null;

    if (definition === null) {
        return nextLine;
    }

    const end = lineStart + definition[0].replace(/\n+$/, "").length;

    return Math.max(nextLine, lineEndAt(text, end) + 1);
}

/**
 * Where the text resumes after `from`: the start of the first line at or
 * after it holding anything but whitespace (keeping that line's
 * indentation), never before `from`.
 *
 * @param text - The text.
 * @param from - The end of the previous token.
 * @returns The resume position.
 */
function resumePosition(text: string, from: number): number {
    let index = from;

    while (index < text.length && /\s/.test(text[index]!)) {
        index += 1;
    }

    return Math.max(from, text.lastIndexOf("\n", index - 1) + 1);
}

/**
 * Matches `body` at `start` exactly.
 *
 * @param text - The text.
 * @param start - Where the match starts.
 * @param body - The token's text.
 * @returns The index just past the match, or `-1` when it does not match.
 */
function exactEnd(text: string, start: number, body: string): number {
    return text.startsWith(body, start) ? start + body.length : -1;
}

/**
 * Keeps a match only when it ends a line: a block token does, so a match
 * that stops inside one (`[x]` against `[x]: /u`) is no match.
 *
 * @param text - The text.
 * @param end - A match's end, or `-1`.
 * @returns `end`, or `-1` when it is `-1` or not at a line's end.
 */
function endsLine(text: string, end: number): number {
    return end !== -1 && text.slice(end, lineEndAt(text, end)).trim() === "" ? end : -1;
}

/**
 * Matches `body` against `text` from `start`, skipping whitespace on either
 * side, and returns where the match ends in `text`.
 *
 * @param text - The text.
 * @param start - Where the match starts in `text`.
 * @param body - The text to match.
 * @returns The index just past the last matched character, or `-1` when a
 *   non-whitespace character differs.
 */
function endIgnoringWhitespace(text: string, start: number, body: string): number {
    let index = start;

    for (const char of body) {
        if (/\s/.test(char)) {
            continue;
        }

        while (index < text.length && /\s/.test(text[index]!)) {
            index += 1;
        }

        if (text[index] !== char) {
            return -1;
        }

        index += 1;
    }

    return index;
}

/**
 * Removes every trailing newline.
 *
 * @param text - A token's `raw`.
 * @returns The text without its trailing newlines.
 */
function withoutTrailingNewlines(text: string): string {
    return text.replace(/\n+$/, "");
}

/**
 * Builds the node for one block token, following the viewer's
 * `appendBlockToken`; a token the editor's nodes cannot hold becomes a raw
 * block of its source.
 *
 * @param token - The block token.
 * @param source - The token's text in the document.
 * @returns Its node.
 */
function $buildBlock(token: Token, source: string): LexicalNode {
    switch (token.type) {
        case "heading":    return $buildHeading(token as Tokens.Heading);
        case "paragraph":  return $appendInlineContent($createParagraphNode(), (token as Tokens.Paragraph).tokens);
        case "code":       return $buildCode(token as Tokens.Code);
        case "blockquote": return $buildQuote(token as Tokens.Blockquote) ?? $buildRawBlock(source);
        case "list":       return $buildList(token as Tokens.List) ?? $buildRawBlock(source, true);
        case "mdtable":    return $buildTable(token as unknown as MdTableToken) ?? $buildRawBlock(source);
        case "mdblock":    return $buildFence(token as unknown as MdBlockToken);
        default:           return $buildRawBlock(source);
    }
}

/**
 * Builds a raw block of `source` without the leading indentation that
 * means nothing to Markdown ({@link rawBlockAtMargin}).
 *
 * @param source - The block's Markdown.
 * @param isList - Whether the block is a list.
 * @returns The raw block.
 */
function $buildRawBlock(source: string, isList: boolean = false): LexicalNode {
    return $createMarkdownRawBlockNode(rawBlockAtMargin(source, isList));
}

/**
 * Builds a heading, its level clamped as the viewer clamps it.
 *
 * @param token - The heading token.
 * @returns The heading.
 */
function $buildHeading(token: Tokens.Heading): LexicalNode {
    const depth = Math.min(Math.max(token.depth, HEADING_MIN_DEPTH), HEADING_MAX_DEPTH);

    return $appendInlineContent($createHeadingNode(`h${depth}` as HeadingTagType), token.tokens, true);
}

/**
 * Builds a code block: the first word of the info string as its language,
 * the info string as written ({@link codeInfoState}) when it holds more than
 * that word, and its text. A fence's text is used as `marked` gives it — already
 * without the newline before the closing fence, so a newline still ending it
 * is a blank last line of the code. Indented code cannot end in a blank line,
 * so a newline ending its text (the last line's own, at the document's end)
 * is dropped.
 *
 * @param token - The code token (fenced or indented).
 * @returns The code block.
 */
function $buildCode(token: Tokens.Code): CodeNode {
    const language = (token.lang ?? "").trim().split(/\s+/)[0] ?? "";
    const code = $createCodeNode(language === "" ? undefined : language);
    const info = FENCE_INFO.exec(token.raw)?.[1]?.trim() ?? "";

    if (info !== language) {
        $setState(code, codeInfoState, info);
    }
    const text = token.codeBlockStyle === "indented" ? token.text.replace(/\n$/, "") : token.text;

    if (text !== "") {
        code.append($createTextNode(text));
    }

    return code;
}

/**
 * Drops the `space` tokens of a container's content.
 *
 * @param tokens - The content tokens.
 * @returns The tokens that hold content.
 */
function withoutSpace(tokens: Token[]): Token[] {
    return tokens.filter((token) => token.type !== "space");
}

/**
 * Tells whether a quote's tokens cover all of its text: `marked` emits no
 * token for a repeated link reference definition, so a quote holding one
 * looks emptier than it is, and building it from its tokens would drop that
 * line on the next save. (A list item builds such text as a raw block.)
 *
 * @param text - The quote's content text (`marked`'s `text`).
 * @param tokens - The block tokens lexed from it.
 * @returns `true` when no text lies outside every token.
 */
function coversText(text: string, tokens: Token[]): boolean {
    return locateTokens(text, tokens).every((entry) => !("gap" in entry));
}

/**
 * Builds a quote when the blockquote holds nothing or one paragraph — all a
 * `QuoteNode`'s inline content can hold.
 *
 * @param token - The blockquote token.
 * @returns The quote, or `null` for any other content.
 */
function $buildQuote(token: Tokens.Blockquote): QuoteNode | null {
    const content = withoutSpace(token.tokens);

    if (!coversText(token.text, token.tokens)) {
        return null;
    }

    if (content.length === 0) {
        return $createQuoteNode();
    }

    const only = content[0]!;

    return content.length === 1 && only.type === "paragraph"
        ? $appendInlineContent($createQuoteNode(), (only as Tokens.Paragraph).tokens)
        : null;
}

/**
 * Builds a list with its looseness and authored marker, when every item can
 * be built. A list one of whose items holds a block other than a nested list
 * is built only when its save keeps the looseness the viewer reads: the save
 * writes a blank line before such a block, which makes a list loose.
 *
 * @param token - The list token.
 * @returns The list, or `null` when one of its own items cannot be built
 *   (a checkbox with no text after it, a raw block no list item can hold),
 *   or when the save would change the list's looseness.
 */
function $buildList(token: Tokens.List): ListNode | null {
    const list = $createListNode(token.ordered ? "number" : "bullet", token.ordered ? Number(token.start) : 1);

    $setState(list, listLooseState, token.loose);
    $setState(list, listMarkerState, authoredMarker(token));

    for (const item of token.items) {
        const built = $buildListItem(item);

        if (built === null) {
            return null;
        }

        list.append(built);
    }

    const keepsLooseness = !$holdsItemBlocks(list) || $listReadsLoose(list) === token.loose;

    if (!keepsLooseness) {
        return null;
    }

    return list;
}

/**
 * Tells whether an item of a list holds a block other than its text and its
 * nested lists: a list the save writes with a blank line before that block.
 *
 * @param list - The list.
 * @returns `true` when one of its items holds such a block.
 */
function $holdsItemBlocks(list: ListNode): boolean {
    return list.getChildren().some((item) => $isElementNode(item)
        && item.getChildren().some((child) => !$isListNode(child) && !$isMarkdownListItemTextNode(child)));
}

/**
 * Reads a list's authored marker off its first item: the bullet character,
 * or the delimiter after an ordered list's number.
 *
 * @param token - The list token.
 * @returns `-`, `*`, `+`, `.` or `)`; `""` when the item's source does not start with a marker.
 */
function authoredMarker(token: Tokens.List): string {
    const match = LIST_MARKER.exec(token.items[0]?.raw ?? "");

    return match === null ? "" : match[1] ?? match[2]!;
}

/**
 * A task item's tokens with its checkbox as a token of its own before the
 * item's text. `marked` puts it there in a list it made loose while lexing
 * its items; in a list loose from the start it puts the checkbox first in
 * the first paragraph's own tokens, and the marker at the start of that
 * paragraph's `raw` and `text`, which the item's text does not hold. (Every
 * item's text is a paragraph by then: `marked` turns a loose list's `text`
 * tokens into paragraphs before it returns the list.)
 *
 * @param tokens - The item's tokens, `space` tokens dropped.
 * @returns The tokens, the checkbox taken out of the first paragraph.
 */
function withOwnCheckbox(tokens: Token[]): Token[] {
    const first = tokens[0];
    const inner = first?.type === "paragraph" ? (first as Tokens.Paragraph).tokens[0] : undefined;

    if (first === undefined || inner?.type !== "checkbox") {
        return tokens;
    }

    const paragraph = first as Tokens.Paragraph;

    const own = {
        ...paragraph,
        raw:    paragraph.raw.slice(inner.raw.length),
        text:   paragraph.text.slice(inner.raw.length),
        tokens: paragraph.tokens.slice(1),
    };

    return [inner, own, ...tokens.slice(1)];
}

/**
 * Builds one list item: its text, a node of its own holding an optional
 * checkbox and the item's inline content, then the item's blocks
 * ({@link $buildItemBlocks}), located as any container's are
 * ({@link locateBlocks}): each run of link reference definitions is one
 * block, and text of the item no token covers (a repeated definition, which
 * `marked` drops) is a block too, a raw block. An item that opens with a
 * block has no text node; one that holds nothing has an empty one.
 *
 * @param item - The list-item token.
 * @returns The item, or `null` when a checkbox has no text after it, or when
 *   a block is one no list item can hold.
 */
function $buildListItem(item: Tokens.ListItem): ListItemNode | null {
    const content = withOwnCheckbox(withoutSpace(item.tokens));
    const checkbox = content[0]?.type === "checkbox" ? content.shift()! : null;
    const located = locateBlocks(item.text, content);
    const first = located[0];
    const opensWithText = first !== undefined && !("gap" in first) && (first.token.type === "text" || first.token.type === "paragraph");
    const text = opensWithText ? first.token : null;
    const blocks = text === null ? located : located.slice(1);
    const tokens = text === null ? [] : text.type === "paragraph" ? (text as Tokens.Paragraph).tokens : [text];

    // The viewer prints a task marker inline at the start of the item's text
    // or first paragraph; before anything else it stands on a line of its
    // own, which an item's line of text cannot show.
    if (checkbox !== null && tokens.length === 0) {
        return null;
    }

    const listItem = $createListItemNode();
    const itemText = $createMarkdownListItemTextNode();
    const opensWithItemText = text !== null || located.length === 0;

    if (opensWithItemText) {
        listItem.append(itemText);
    }

    if (text !== null) {
        $buildKeepingConstructs(itemText, [...(checkbox === null ? [] : [checkbox]), ...tokens], false, (keep) => {
            itemText.clear();

            if (checkbox !== null) {
                itemText.append($createMarkdownSourceTextNode(checkbox.raw, checkbox.raw));
            }

            appendInlineTokens({ block: itemText, openLink: null, nextCellParagraph: null, keep, edges: edgeLinks(tokens) }, tokens, PLAIN);
        });
    }

    return $buildItemBlocks(listItem, blocks);
}

/**
 * Builds the blocks after a list item's text, each a child of the item, in
 * order: a nested list is one of them. A nested list that cannot be built is
 * a block like any other: a raw block of the item.
 *
 * @param listItem - The item, its text already built.
 * @param blocks - The item's located blocks after its text.
 * @returns The item, or `null` when a block is one no list item can hold
 *   ({@link $buildItemBlock}).
 */
function $buildItemBlocks(listItem: ListItemNode, blocks: LocatedBlock[]): ListItemNode | null {
    for (const entry of blocks) {
        const nested = !("gap" in entry) && entry.token.type === "list" ? $buildList(entry.token as Tokens.List) : null;
        const block = nested ?? $buildItemBlock(entry);

        if (block === null) {
            return null;
        }

        listItem.append(block);
    }

    return listItem;
}

/**
 * Builds one block of a list item that is not a nested list node: a located
 * block as it is built anywhere ({@link $buildLocatedBlock}), and a nested
 * list that could not be built as a raw block of its source, as a list
 * anywhere is. A raw block is built in the form the save writes it in
 * (`rawBlockInItem`), and only when a list item can hold it
 * (`rawBlockStandsInItem`, the one rule for a raw block in a list item).
 *
 * @param entry - The located token or gap.
 * @returns The block's node, or `null` for a raw block no list item can hold.
 */
function $buildItemBlock(entry: LocatedBlock): LexicalNode | null {
    const isUnbuiltList = !("gap" in entry) && entry.token.type === "list";
    // `$buildLocatedBlock` would build the list a second time before it gave up on it.
    const block = isUnbuiltList ? $buildRawBlock(entry.source, true) : $buildLocatedBlock(entry);

    if (!$isMarkdownRawBlockNode(block)) {
        return block;
    }

    const text = block.getTextContent();

    return rawBlockStandsInItem(text) ? $createMarkdownRawBlockNode(rawBlockInItem(text)) : null;
}

/**
 * Builds a table: a header row of header cells, then one row per body row
 * carrying each cell's merge span; every cell gets its column's alignment,
 * and the table its column widths (`0` for none, `@lexical/table`'s sentinel).
 *
 * @param token - The `mdtable` token.
 * @returns The table, or `null` when a body row holds cells past the
 *   header's last column, which the token drops and a table node cannot keep.
 */
function $buildTable(token: MdTableToken): TableNode | null {
    if (token.droppedCells) {
        return null;
    }

    const table = $createTableNode();
    const header = $createTableRowNode();

    header.append(...token.header.map((cell) => $buildTableCell(cell, TableCellHeaderStates.ROW)));
    table.append(header);

    for (const row of token.rows) {
        const rowNode = $createTableRowNode();

        for (const cell of row) {
            const cellNode = $buildTableCell(cell, TableCellHeaderStates.NO_STATUS);

            cellNode.setColSpan(cell.colSpan);
            cellNode.setRowSpan(cell.rowSpan);
            rowNode.append(cellNode);
        }

        table.append(rowNode);
    }

    table.setColWidths(token.widths.map((width) => width ?? 0));

    return table;
}

/**
 * Builds one table cell: its alignment and its paragraphs (cell mode).
 *
 * @param cell - The header or body cell.
 * @param headerState - The cell's `TableCellHeaderStates` value.
 * @returns The cell.
 */
function $buildTableCell(cell: MdTableHeaderCell | MdTableBodyCell, headerState: number): TableCellNode {
    const cellNode = $createTableCellNode(headerState);

    cellNode.setFormat(cell.align ?? "");
    $buildCellParagraphs(cellNode, cell.tokens);

    return cellNode;
}

/**
 * Fills a cell with its inline content, starting a new paragraph at each
 * cell paragraph break of its text.
 *
 * @param cell - The cell.
 * @param tokens - The cell's inline tokens.
 */
function $buildCellParagraphs(cell: TableCellNode, tokens: Token[]): void {
    const startParagraph = (): ElementNode => {
        const paragraph = $createParagraphNode();

        cell.append(paragraph);

        return paragraph;
    };

    $buildKeepingConstructs(cell, tokens, false, (keep) => {
        cell.clear();
        appendInlineTokens({ block: startParagraph(), openLink: null, nextCellParagraph: startParagraph, keep, edges: edgeLinks(tokens) }, tokens, PLAIN);
    });
}

/**
 * Builds a `:::` fence with its resolved style and its authored opening
 * line ({@link fenceOpeningState}), never unwrapped: each column holds
 * the blocks of its own section of the fence's text, or one empty paragraph.
 *
 * @param token - The `mdblock` token.
 * @returns The fence.
 */
function $buildFence(token: MdBlockToken): MarkdownBlockNode {
    const style = resolveBlockStyle(token.attributes);
    const fence = $createMarkdownBlockNode();
    const sections = splitColumnSections(withoutTrailingNewlines(token.raw).split("\n").slice(1, -1).join("\n"));

    fence.setAlign(style.textAlign);
    fence.setColumnGap(style.columnGap);
    $setState(fence, fenceOpeningState, FENCE_OPENING.exec(token.raw.slice(0, lineEndAt(token.raw, 0)))?.[1] ?? "");

    token.columns.forEach((tokens, index) => {
        const column = $createMarkdownColumnNode();
        const blocks = $buildBlockList(sections[index] ?? "", tokens);

        column.append(...(blocks.length > 0 ? blocks : [$createParagraphNode()]));
        fence.append(column);
    });

    return fence;
}

// ---------------------------------------------------------------- inline

/**
 * Appends inline tokens into a block element, keeping as written the
 * constructs its standard form could not write back ({@link $buildKeepingConstructs}).
 *
 * @param block - The paragraph, heading or quote.
 * @param tokens - Its inline tokens.
 * @param isHeading - Whether the block is a heading, whose id the standard form must keep.
 * @returns `block`.
 */
function $appendInlineContent<T extends ElementNode>(block: T, tokens: Token[], isHeading: boolean = false): T {
    $buildKeepingConstructs(block, tokens, isHeading, (keep) => {
        block.clear();
        appendInlineTokens({ block, openLink: null, nextCellParagraph: null, keep, edges: edgeLinks(tokens) }, tokens, PLAIN);
    });

    return block;
}

/**
 * Builds a block's inline content, keeping as written ({@link keptSourceState})
 * each construct whose standard form — what a save writes for the block once
 * it is edited — would read differently from what the viewer shows for it, or
 * change a heading's id: emphasis whose delimiters would pair otherwise once
 * written apart, a bare URL right after a word, a link holding a link, a span
 * whose attributes the editor drops. Then an edit elsewhere in the block
 * never rewrites it.
 *
 * The constructs are the block's inline tokens at any depth. Starting from
 * none, each round reads the standard form against the tokens
 * ({@link $readStandardForm}) and keeps the smallest token around the first
 * reading unit (or the first character of the heading's id) that differs —
 * or, when that does not read further, the next larger or a neighbour —
 * that makes more of the block read back, until all of it does, no candidate
 * helps, or {@link MAX_KEEP_TRIES} builds are spent; the block then keeps
 * the best choice found. A block of plain text alone always reads back and
 * is built once.
 *
 * @param container - The block (a table cell for a cell's content).
 * @param tokens - Its inline tokens (a task item's checkbox first).
 * @param isHeading - Whether the block is a heading.
 * @param build - Builds the block's content, the given tokens kept as written.
 */
function $buildKeepingConstructs(
    container: ElementNode, tokens: Token[], isHeading: boolean, build: (keep: ReadonlySet<Token>) => void,
): void {
    let best = { keep: new Set<Token>() as ReadonlySet<Token>, reading: null as StandardFormReading | null };

    build(best.keep);

    if (holdsPlainTextOnly(tokens)) {
        return;
    }

    const read = (): StandardFormReading => $readKeepingForm(container, tokens, isHeading);
    const tries = { left: MAX_KEEP_TRIES };
    let built = best.keep;

    const attempt = (keep: ReadonlySet<Token>): StandardFormReading => {
        tries.left -= 1;
        build(keep);
        built = new Set(keep);

        return read();
    };

    best.reading = read();

    while (!readsAsLoaded(best.reading!) && tries.left > 0) {
        const reading = best.reading!;
        let improved: typeof best | null = null;

        for (const candidate of keepCandidates(tokens, best.keep, reading)) {
            if (tries.left <= 0) {
                break;
            }

            const keep = new Set([...best.keep, candidate]);
            const next = attempt(keep);

            if (readsFurther(next, reading)) {
                improved = { keep, reading: next };

                break;
            }
        }

        if (improved === null) {
            break;
        }

        best = improved;
    }

    if (!readsAsLoaded(best.reading!)) {
        best = keepTogether(tokens, best, attempt, tries);
    }

    if (built.size !== best.keep.size || [...best.keep].some((token) => !built.has(token))) {
        build(best.keep);
    }
}

/**
 * The fallback when no one construct more makes a block read further:
 * keeping several together can (a bare URL and the punctuation after it,
 * which its standard form would take into the URL). Keeps every top-level
 * construct; when the block then reads as loaded, gives back each one whose
 * keeping it does not need, in order.
 *
 * @param tokens - The block's inline tokens.
 * @param best - The best choice so far, and its reading.
 * @param attempt - Builds the block with given tokens kept and reads its standard form.
 * @param tries - The builds left; spent by `attempt`.
 * @returns The choice to build: the kept constructs that make the block read as loaded, or `best`.
 */
function keepTogether(
    tokens: Token[], best: { keep: ReadonlySet<Token>; reading: StandardFormReading | null },
    attempt: (keep: ReadonlySet<Token>) => StandardFormReading, tries: { left: number },
): { keep: ReadonlySet<Token>; reading: StandardFormReading | null } {
    const keep = new Set(tokens.filter((token) => keptPieces(token, PLAIN) !== null));

    if (tries.left <= 0 || keep.size === 0 || !readsAsLoaded(attempt(keep))) {
        return best;
    }

    for (const token of [...keep]) {
        if (tries.left <= 0) {
            break;
        }

        keep.delete(token);

        if (!readsAsLoaded(attempt(keep))) {
            keep.add(token);
        }
    }

    return { keep, reading: null };
}

/**
 * Reads a block's standard form ({@link $readStandardForm}) as a save would
 * write it once the document is loaded: with the document's definitions
 * ({@link IMPORT_DEFINITIONS}), and each reference link's loaded text
 * recorded, as {@link $recordReferenceContents} records it at the end.
 *
 * @param container - The block (a table cell for a cell's content).
 * @param tokens - Its inline tokens.
 * @param isHeading - Whether the block is a heading.
 * @returns How far the standard form reads as the tokens do.
 */
function $readKeepingForm(container: ElementNode, tokens: Token[], isHeading: boolean): StandardFormReading {
    for (const { node } of $dfs(container)) {
        if ($isReferenceLinkNode(node)) {
            node.setImportedContent($serializeLinkContent(node));
        }
    }

    return $readStandardForm(container, tokens, isHeading, IMPORT_DEFINITIONS.current);
}

/**
 * Tells whether inline tokens are plain text alone, at any depth.
 *
 * @param tokens - The tokens.
 * @returns `true` when every token is a `text` or `escape` token holding no other.
 */
function holdsPlainTextOnly(tokens: readonly Token[]): boolean {
    return tokens.every((token) => PLAIN_TEXT_TOKENS.has(token.type) && holdsPlainTextOnly((token as Tokens.Generic).tokens ?? []));
}

/**
 * Tells whether a standard form reads as the block was loaded, its id included.
 *
 * @param reading - The standard form's reading.
 * @returns `true` when it does.
 */
function readsAsLoaded(reading: StandardFormReading): boolean {
    return reading.score === Infinity && reading.idScore === Infinity;
}

/**
 * Tells whether one standard form reads further as the block was loaded than another.
 *
 * @param next - The reading with one more construct kept.
 * @param previous - The reading before.
 * @returns `true` when more leading reading units match, or as many and more of the id.
 */
function readsFurther(next: StandardFormReading, previous: StandardFormReading): boolean {
    return next.score > previous.score || (next.score === previous.score && next.idScore > previous.idScore);
}

/**
 * The tokens to try keeping next, best first. Where the reading differs:
 * the tokens around its first differing unit, smallest first, then the
 * tokens ending right before it and those reading as nothing there (an
 * empty link), then every other token, nearest first. Where only a
 * heading's id differs: every token by its distance in the source from the
 * character the id first differs at, smallest first. Tokens already kept,
 * inside a kept token, or whose syntax cannot be split into runs are left
 * out.
 *
 * @param tokens - The block's inline tokens.
 * @param keep - The tokens kept so far.
 * @param reading - The block's standard-form reading so far.
 * @returns The candidates, in order.
 */
function keepCandidates(tokens: Token[], keep: ReadonlySet<Token>, reading: StandardFormReading): Token[] {
    const all = tokensBelow(tokens, keep);
    const size = (token: Token): number => token.raw.length;

    if (reading.score === Infinity) {
        const at = idSourceIndex(tokens, reading.idScore);
        const offsets = tokenOffsets(tokens);
        const distance = (token: Token): number => {
            const [start, end] = offsets.get(token) ?? [0, 0];

            return at < start ? start - at : at >= end ? at - end + 1 : 0;
        };

        return all.sort((a, b) => distance(a) - distance(b) || size(a) - size(b));
    }

    const unit = reading.score;
    const span = (token: Token): readonly [number, number] => reading.spans.get(token) ?? [0, 0];
    const rank = (token: Token): number => {
        const [start, end] = span(token);

        if (start <= unit && unit < end) {
            return 0;
        }

        return end === unit ? 1 : start === unit && end === unit ? 2 : 3;
    };
    const distance = (token: Token): number => Math.min(Math.abs(span(token)[0] - unit), Math.abs(span(token)[1] - unit));

    return all.sort((a, b) => rank(a) - rank(b) || (rank(a) === 3 ? distance(a) - distance(b) : 0) || size(a) - size(b));
}

/**
 * The tokens at any depth that can be kept: not kept already, not inside a
 * kept token, and splittable into runs ({@link keptPieces}).
 *
 * @param tokens - Inline tokens.
 * @param keep - The tokens kept so far.
 * @returns The candidates, in document order, outer before inner.
 */
function tokensBelow(tokens: readonly Token[], keep: ReadonlySet<Token>): Token[] {
    return tokens.flatMap((token) => (keep.has(token)
        ? []
        : [...(keptPieces(token, PLAIN) === null ? [] : [token]), ...tokensBelow(((token as Tokens.Generic).tokens ?? []) as Token[], keep)]));
}

/**
 * Where each token stands in the source its block's tokens were lexed
 * from: `[start, end)` offsets, a container's content found inside its own
 * `raw`.
 *
 * @param tokens - Inline tokens, their `raw`s in order.
 * @param base - The offset of the first.
 * @param offsets - The map to fill.
 * @returns The offsets.
 */
function tokenOffsets(tokens: readonly Token[], base: number = 0, offsets = new Map<Token, readonly [number, number]>()): Map<Token, readonly [number, number]> {
    let at = base;

    for (const token of tokens) {
        const children = ((token as Tokens.Generic).tokens ?? []) as Token[];
        const content = children.map((child) => child.raw).join("");
        const inner = token.raw.indexOf(content);

        offsets.set(token, [at, at + token.raw.length]);

        if (children.length > 0 && inner !== -1) {
            tokenOffsets(children, at + inner, offsets);
        }

        at += token.raw.length;
    }

    return offsets;
}

/**
 * The index of the source character a heading's id first differs at: the
 * start of the first top-level token whose reading makes the id's slug reach
 * past the matching part.
 *
 * @param tokens - The heading's inline tokens.
 * @param idScore - How many leading characters of the id match.
 * @returns The index in the heading's source text, or its length when none does.
 */
function idSourceIndex(tokens: Token[], idScore: number): number {
    const offsets = tokenOffsets(tokens);
    let read = "";

    for (const token of tokens) {
        read += headingSlugSource([token]);

        const reached = slugify(read).length > idScore;

        if (reached) {
            return offsets.get(token)?.[0] ?? 0;
        }
    }

    return tokens.reduce((length, token) => length + token.raw.length, 0);
}

/**
 * Appends a list of inline tokens.
 *
 * @param target - Where nodes are appended.
 * @param tokens - The inline tokens.
 * @param context - The formatting they inherit.
 */
function appendInlineTokens(target: InlineTarget, tokens: Token[], context: InlineContext): void {
    for (const token of tokens) {
        appendInlineToken(target, token, context);
    }
}

/**
 * Appends one inline token, following the viewer's `appendInlineToken`; a
 * token the editor has no node for becomes a source node.
 *
 * @param target - Where nodes are appended.
 * @param token - The inline token.
 * @param context - The formatting it inherits.
 */
function appendInlineToken(target: InlineTarget, token: Token, context: InlineContext): void {
    const format = TOKEN_FORMATS[token.type];

    if (target.keep.has(token) && appendKeptConstruct(target, token, context)) {
        return;
    }

    if (format !== undefined) {
        appendInlineTokens(target, (token as Tokens.Generic).tokens ?? [], withFormat(context, format));

        return;
    }

    switch (token.type) {
        case "text":       appendTextToken(target, token as Tokens.Text, context); break;
        case "escape":     appendText(target, (token as Tokens.Escape).text, context); break;
        case "codespan":   appendLeaf(target, styledText((token as Tokens.Codespan).text, withFormat(context, "code")), context); break;
        case "link":       appendLink(target, token as Tokens.Link, context); break;
        case "styledspan": appendStyledSpan(target, token as Tokens.Generic, context); break;
        case "mdimage":    appendImage(target, token as Tokens.Generic, context); break;
        case "br":         appendLeaf(target, hardBreak(token.raw), context); break;
        case "html":       appendInlineHtml(target, token as Tokens.HTML, context); break;
        default:           appendSourceNode(target, (token as Tokens.Generic).text ?? token.raw, token.raw, context); break;
    }
}

/**
 * Appends inline HTML: in a table cell, a `<br>` ({@link CELL_LINE_BREAK_TAG})
 * as a line break, as the viewer renders it there; anything else as a source
 * node showing its text.
 *
 * @param target - Where nodes are appended.
 * @param token - The `html` token.
 * @param context - The formatting it inherits.
 */
function appendInlineHtml(target: InlineTarget, token: Tokens.HTML, context: InlineContext): void {
    const isCellLineBreak = target.nextCellParagraph !== null && CELL_LINE_BREAK_TAG.test(token.text);

    if (isCellLineBreak) {
        appendLeaf(target, $createLineBreakNode(), context);
    } else {
        appendSourceNode(target, token.text, token.raw, context);
    }
}

/**
 * Appends a `text` token: its children when it has any; in a table cell, its
 * pieces between cell paragraph breaks, each in its own paragraph; else its
 * text.
 *
 * @param target - Where nodes are appended.
 * @param token - The `text` token.
 * @param context - The formatting it inherits.
 */
function appendTextToken(target: InlineTarget, token: Tokens.Text, context: InlineContext): void {
    if (token.tokens !== undefined && token.tokens.length > 0) {
        appendInlineTokens(target, token.tokens, context);

        return;
    }

    const nextCellParagraph = target.nextCellParagraph;

    if (nextCellParagraph === null) {
        appendText(target, token.text, context);

        return;
    }

    token.text.split(CELL_PARAGRAPH_BREAK).forEach((piece, index) => {
        if (index > 0) {
            target.block = nextCellParagraph();
            target.openLink = null;
        }

        appendText(target, piece, context);
    });
}

/**
 * The spaces and tabs a paragraph line opens with, which CommonMark strips: the viewer shows none of them. Blanks
 * that stand alone before another inline token are kept, as inline HTML after them keeps its indentation.
 */
const LEADING_BLANKS = /^[ \t]+/;

/**
 * Appends text, with a soft-break source node (showing a space, saving a
 * newline) for each newline in it. The blanks a line opens
 * with, the block's first line included, are dropped, as the viewer drops them.
 *
 * @param target - Where nodes are appended.
 * @param text - The text.
 * @param context - Its formatting.
 */
function appendText(target: InlineTarget, text: string, context: InlineContext): void {
    text.split("\n").forEach((piece, index) => {
        if (index > 0) {
            appendLeaf(target, formatted($createMarkdownSourceTextNode(SOFT_BREAK_DISPLAY, SOFT_BREAK_SOURCE), context), context);
        }

        const opensBlock = index === 0 && target.block.getChildrenSize() === 0;
        const stripped = piece.replace(LEADING_BLANKS, "");
        const dropsBlanks = LOADING_DOCUMENT.current && (index > 0 || opensBlock) && stripped !== "";
        const text = dropsBlanks ? stripped : piece;

        if (text !== "") {
            appendLeaf(target, styledText(text, context), context);
        }
    });
}

/**
 * Appends a link's content inside the link. A link whose `raw` opens with
 * neither `<` nor `[` is a GFM bare autolink.
 *
 * A link with no content of its own outside the links nested in it would
 * open no link node, so it is kept as source and its destination is never
 * dropped — as is one at the block's edge whose own text beside them is
 * only whitespace, which a save would trim: a link all of whose text sits
 * in nested links (`marked` nests an autolink in link text;
 * Lexical's links do not nest) becomes source nodes showing that text as
 * the viewer does ({@link appendNestedLinkRuns}), and a link whose text shows nothing
 * (`[](u)`) one source node showing nothing. A link with text of its own
 * beside a nested one keeps its link node, closed around the nested link and
 * reopened after it.
 *
 * @param target - Where nodes are appended.
 * @param token - The `link` token.
 * @param context - The formatting it inherits.
 */
function appendLink(target: InlineTarget, token: Tokens.Link, context: InlineContext): void {
    const edgeWhitespace = target.edges.has(token) && showsWhitespaceBesideLinks(token.tokens);

    if (!holdsOwnLeaf(token.tokens) || edgeWhitespace) {
        appendNestedLinkRuns(target, token, context);

        return;
    }

    // At the block's edge a save trims a link showing only whitespace away, so it is kept as its source.
    if (target.edges.has(token) && showsOnlyWhitespace(token.tokens)) {
        appendSourceNode(target, shownText(token.tokens), token.raw, context);

        return;
    }

    appendInlineTokens(target, token.tokens, linkContext(token, context));
}

/**
 * The context a link's content inherits: the link's target added, and how
 * a reference link was written.
 *
 * @param token - The `link` token.
 * @param context - The formatting around the link.
 * @returns The context inside the link.
 */
function linkContext(token: Tokens.Link, context: InlineContext): InlineContext {
    const href = token.href;
    const title = token.title ?? null;
    const reference = readReference(token.raw, href, title);
    const bare = !token.raw.startsWith("<") && !token.raw.startsWith("[");

    return { ...context, link: { href, title, reference, bare } };
}

/**
 * Reads how a `link` token was written from its `raw`: an autolink, a bare
 * URL or an inline link carries no reference; `raw` matched in full by
 * `marked`'s full-reference pattern is the full form, and by its
 * collapsed-or-shortcut pattern the collapsed form (ending `[]`) or the
 * shortcut form.
 *
 * @param raw - The token's source.
 * @param href - The URL its definition gave it.
 * @param title - The title its definition gave it, or `null`.
 * @returns The reference, its imported text not yet recorded; `null` for a
 *   link written with its URL.
 */
function readReference(raw: string, href: string, title: string | null): ReferenceLinkReference | null {
    if (!raw.startsWith("[") || raw.endsWith(")")) {
        return null;
    }

    const reference = { definitionUrl: href, definitionTitle: title, importedContent: "" };
    const full = FULL_REFERENCE.exec(raw);

    if (full !== null && full[0] === raw) {
        return { ...reference, label: full[2]!, form: "full" };
    }

    const short = SHORT_REFERENCE.exec(raw);

    if (short !== null && short[0] === raw) {
        return { ...reference, label: short[1]!, form: raw.endsWith("[]") ? "collapsed" : "shortcut" };
    }

    return null;
}

/**
 * Appends a link all of whose text sits in links nested in it as source
 * nodes the viewer's way: one per run of the text with one target and one
 * format, each inside a link node with its nested link's target and carrying
 * the formats inside the outer link ({@link nestedLinkState}), together
 * saving the link's `raw` byte for byte. When the text shows nothing, or its
 * syntax cannot be split into runs, the link is one source node showing its
 * text.
 *
 * @param target - Where nodes are appended.
 * @param token - The outer `link` token.
 * @param context - The formatting around the link.
 */
function appendNestedLinkRuns(target: InlineTarget, token: Tokens.Link, context: InlineContext): void {
    const pieces = nestedLinkPieces(token, context);

    if (pieces === null || pieces.every((piece) => piece.display === "")) {
        appendSourceNode(target, shownText(token.tokens), token.raw, context);

        return;
    }

    const outside = formatBits(context.formats);
    const content = token.tokens.map((child) => child.raw).join("");
    const close = token.raw.slice(contentSpan(token.raw, content)!.end);
    let group: { id: string; close: string } | null = null;

    for (const piece of pieces) {
        const node = formatted($createMarkdownSourceTextNode(piece.display.replace(/\s+/g, " "), piece.source), piece.context);
        const writesStyle = piece.context.spanStyle !== context.spanStyle ? NESTED_LINK_WRITES_STYLE : 0;

        group ??= { id: node.getKey(), close };
        $setState(node, nestedLinkState, (formatBits(piece.context.formats) & ~outside) | writesStyle);
        $setState(node, nestedLinkGroupState, group);
        appendLeaf(target, node, piece.context);
    }
}

/**
 * Splits an inline token into the runs it shows, each with the slice of its
 * `raw` that writes it: a container's syntax before its content joins its
 * first run's source, and its syntax after joins its last run's, so the
 * sources joined are the `raw`. Adjacent runs with the same formatting
 * merge, and a run showing nothing joins the run before it (or after it).
 *
 * @param token - The token.
 * @param context - The formatting around it.
 * @returns The runs, or `null` when a container's content is not found in
 *   its `raw`.
 */
function nestedLinkPieces(token: Token, context: InlineContext): NestedLinkPiece[] | null {
    const children = ((token as Tokens.Generic).tokens ?? []) as Token[];
    const inner = containerContext(token, context);

    if (inner === null || children.length === 0) {
        const display = token.type === "mdimage" ? "" : (token as Tokens.Generic).text as string | undefined ?? token.raw;

        return [{ display, source: token.raw, context: token.type === "codespan" ? withFormat(context, "code") : context }];
    }

    const content = children.map((child) => child.raw).join("");
    const span = contentSpan(token.raw, content);
    const parts: NestedLinkPiece[] = [];

    for (const child of children) {
        const pieces = nestedLinkPieces(child, inner);

        if (pieces === null || span === null) {
            return null;
        }

        parts.push(...pieces);
    }

    return withRawSources(token.raw, span!, mergePieces(parts));
}

/**
 * Merges nested-link runs: a run showing nothing joins the run before it
 * (the first such runs join the first run showing something), and adjacent
 * runs with the same formats, style and link become one.
 *
 * @param pieces - The runs, in order.
 * @returns The merged runs; one, showing nothing, when none shows anything.
 */
function mergePieces(pieces: NestedLinkPiece[]): NestedLinkPiece[] {
    const merged: NestedLinkPiece[] = [];
    let held = "";

    for (const piece of pieces) {
        const last = merged[merged.length - 1];

        if (piece.display === "" && last !== undefined) {
            last.source += piece.source;
        } else if (piece.display === "") {
            held += piece.source;
        } else if (last !== undefined && sameRunFormatting(last.context, piece.context)) {
            last.display += piece.display;
            last.source += piece.source;
        } else {
            merged.push({ display: piece.display, source: held + piece.source, context: piece.context });
            held = "";
        }
    }

    return merged.length > 0 ? merged : [{ display: "", source: held, context: pieces[0]!.context }];
}

/**
 * Appends a construct kept as written ({@link keptSourceState}) as its runs,
 * the viewer's way: one source node per run of its text with one format,
 * style and link — inside a link node when the run is linked — and its own
 * node for an image or a hard break in it, together saving its `raw` byte
 * for byte. Each run records the formats, style and link the construct's
 * own source writes, and its place among the runs. In a table cell, a
 * construct whose text holds a cell paragraph break is kept as one
 * construct per paragraph, as the viewer shows its text there
 * ({@link splitAtCellBreaks}).
 *
 * @param target - Where nodes are appended.
 * @param token - The construct's token.
 * @param context - The formatting around it.
 * @returns `false` when its syntax cannot be split into runs, so it was not appended.
 */
function appendKeptConstruct(target: InlineTarget, token: Token, context: InlineContext): boolean {
    const nextCellParagraph = target.nextCellParagraph;
    const pieces = keptPieces(token, context, nextCellParagraph !== null);

    if (pieces === null) {
        return false;
    }

    (nextCellParagraph === null ? [pieces] : splitAtCellBreaks(pieces)).forEach((group, at) => {
        if (at > 0) {
            target.block = nextCellParagraph!();
            target.openLink = null;
        }

        appendKeptRuns(target, group, context);
    });

    return true;
}

/**
 * Appends the runs of one construct kept as written ({@link appendKeptConstruct}).
 *
 * @param target - Where nodes are appended.
 * @param pieces - The construct's runs.
 * @param context - The formatting around it.
 */
function appendKeptRuns(target: InlineTarget, pieces: readonly KeptPiece[], context: InlineContext): void {
    let group: string | null = null;

    pieces.forEach((piece, index) => {
        const leaf = piece.leaf;
        const node = leaf === null
            ? formatted($createMarkdownSourceTextNode(piece.display.replace(/\s+/g, " "), piece.source), piece.context)
            : keptLeafNode(leaf);
        const writesStyle = spanStyleToCss(piece.context.spanStyle) !== spanStyleToCss(context.spanStyle)
            || piece.context.spanAttributes !== context.spanAttributes;
        const writes = (formatBits(piece.context.formats) & ~formatBits(context.formats))
            | (writesStyle ? KEPT_SOURCE_WRITES_STYLE : 0) | (piece.context.link !== context.link ? KEPT_SOURCE_WRITES_LINK : 0);
        const shown = leaf?.type === "mdimage" ? keptImageShown(node as MarkdownImageNode) : "";

        group ??= node.getKey();
        $setState(node, keptSourceState, { group, index, size: pieces.length, writes, source: leaf === null ? "" : piece.source, shown });
        appendLeaf(target, node, piece.context);
    });
}

/**
 * The node of a kept construct's leaf run: a line break for a hard break or
 * a cell's `<br>`, else the image.
 *
 * @param leaf - The run's token.
 * @returns The node.
 */
function keptLeafNode(leaf: Tokens.Generic): LexicalNode {
    switch (leaf.type) {
        case "br":   return hardBreak(leaf.raw);
        case "html": return $createLineBreakNode();
        default:     return $imageNode(leaf)!;
    }
}

/**
 * Splits a kept construct's runs at each cell paragraph break its text
 * holds, as the viewer splits a cell's text there: one list of runs per
 * paragraph, a run holding a break cut into the part before it and the part
 * after. A code run keeps its text whole, as a code span does in the viewer,
 * and so does a run whose source does not hold its text's breaks.
 *
 * @param pieces - The construct's runs, each with its source in the `raw`.
 * @returns The runs of each paragraph, in order; parts showing and saving nothing dropped.
 */
function splitAtCellBreaks(pieces: readonly KeptPiece[]): KeptPiece[][] {
    const groups: KeptPiece[][] = [[]];

    for (const piece of pieces) {
        const displays = piece.display.split(CELL_PARAGRAPH_BREAK);
        const sources = piece.source.split(CELL_PARAGRAPH_BREAK);
        const splits = piece.leaf === null && !piece.context.formats.includes("code") && displays.length > 1 && sources.length === displays.length;

        (splits ? displays : [piece.display]).forEach((display, index) => {
            if (index > 0) {
                groups.push([]);
            }

            if (!splits || display !== "" || sources[index] !== "") {
                groups[groups.length - 1]!.push(splits ? { ...piece, display, source: sources[index]! } : piece);
            }
        });
    }

    return groups;
}

/**
 * Splits an inline token into the runs a kept construct is made of, as
 * {@link nestedLinkPieces} does, except that an image the viewer renders, a
 * hard break and, in a table cell, a `<br>` are runs of their own, never
 * merged, so each keeps its node.
 *
 * @param token - The token.
 * @param context - The formatting around it.
 * @param inTableCell - Whether the token is in a table cell's text.
 * @returns The runs, or `null` when a container's content is not found in its `raw`.
 */
function keptPieces(token: Token, context: InlineContext, inTableCell: boolean = false): KeptPiece[] | null {
    const children = ((token as Tokens.Generic).tokens ?? []) as Token[];
    const inner = containerContext(token, context);

    if (inner === null || children.length === 0) {
        const generic = token as Tokens.Generic;
        const isCellLineBreak = inTableCell && token.type === "html" && CELL_LINE_BREAK_TAG.test(generic.text as string);
        const isBreak = token.type === "br" || isCellLineBreak;
        const leaf = isBreak || (token.type === "mdimage" && $imageSpec(generic) !== null) ? generic : null;
        const display = token.type === "mdimage" || isBreak ? "" : generic.text as string | undefined ?? token.raw;

        return [{ display, source: token.raw, context: token.type === "codespan" ? withFormat(context, "code") : context, leaf }];
    }

    const content = children.map((child) => child.raw).join("");
    const span = contentSpan(token.raw, content);
    const parts: KeptPiece[] = [];

    for (const child of children) {
        const pieces = keptPieces(child, inner, inTableCell);

        if (pieces === null || span === null) {
            return null;
        }

        parts.push(...pieces);
    }

    return withRawSources(token.raw, span!, mergeKeptPieces(parts));
}

/**
 * Gives a container's runs the source they cover in its `raw`: each run's
 * source becomes the stretch of `raw` it stands at, a bracket escape
 * `marked` dropped from link text included, and the container's syntax
 * before and after its content joins the first and last run's source, so
 * the sources joined are the `raw`.
 *
 * @param raw - The container token's `raw`.
 * @param span - Where its content stands in `raw` ({@link contentSpan}).
 * @param pieces - Its runs, their sources read from the children's `raw`s.
 * @returns The runs, or `null` when a run's source does not stand in `raw`.
 */
function withRawSources<P extends NestedLinkPiece>(raw: string, span: { start: number; end: number }, pieces: P[]): P[] | null {
    let cursor = span.start;

    for (const piece of pieces) {
        const end = escapedEnd(raw, cursor, piece.source);

        if (end === null) {
            return null;
        }

        piece.source = raw.slice(cursor, end);
        cursor = end;
    }

    pieces[0]!.source = raw.slice(0, span.start) + pieces[0]!.source;
    pieces[pieces.length - 1]!.source += raw.slice(span.end);

    return pieces;
}

/**
 * Finds a container token's content in its `raw`: where the children's
 * text stands, read as `marked` gives it — which, in a link's text, has
 * dropped the escape of each bracket (`\[` reads `[`).
 *
 * @param raw - The token's `raw`.
 * @param content - Its children's `raw`, joined.
 * @returns The content's `[start, end)` in `raw`, or `null` when it is not found.
 */
function contentSpan(raw: string, content: string): { start: number; end: number } | null {
    const exact = raw.indexOf(content);

    if (exact !== -1) {
        return { start: exact, end: exact + content.length };
    }

    for (let start = 0; start < raw.length; start++) {
        const end = escapedEnd(raw, start, content);

        if (end !== null) {
            return { start, end };
        }
    }

    return null;
}

/**
 * Matches text against `raw` from an offset, where `raw` may hold a bracket
 * escaped (`\[`, `\]`) that the text holds bare, as `marked` unescapes
 * the brackets of link text.
 *
 * @param raw - The source.
 * @param from - Where in it the text starts.
 * @param text - The text to match.
 * @returns The end of the match in `raw`, or `null` when the text does not stand there.
 */
function escapedEnd(raw: string, from: number, text: string): number | null {
    let at = from;

    for (const char of text) {
        if (raw[at] === "\\" && raw[at + 1] === char && (char === "[" || char === "]")) {
            at += 2;
        } else if (raw[at] === char) {
            at += 1;
        } else {
            return null;
        }
    }

    return at;
}

/**
 * Merges a kept construct's runs as {@link mergePieces} does, except that a
 * run with a node of its own (an image, a hard break) never merges with
 * another, though a run showing nothing after it joins its source.
 *
 * @param pieces - The runs, in order.
 * @returns The merged runs; one, showing nothing, when none shows anything.
 */
function mergeKeptPieces(pieces: KeptPiece[]): KeptPiece[] {
    const merged: KeptPiece[] = [];
    let held = "";

    for (const piece of pieces) {
        const last = merged[merged.length - 1];
        const showsNothing = piece.leaf === null && piece.display === "";

        if (showsNothing && last !== undefined) {
            last.source += piece.source;
        } else if (showsNothing) {
            held += piece.source;
        } else if (last !== undefined && last.leaf === null && piece.leaf === null && sameRunFormatting(last.context, piece.context)) {
            last.display += piece.display;
            last.source += piece.source;
        } else {
            merged.push({ ...piece, source: held + piece.source });
            held = "";
        }
    }

    return merged.length > 0 ? merged : [{ display: "", source: held, context: pieces[0]!.context, leaf: null }];
}

/**
 * Tells whether two contexts format a run alike: the same formats, style and
 * link (the same link token).
 *
 * @param a - One context.
 * @param b - The other.
 * @returns `true` when they match.
 */
function sameRunFormatting(a: InlineContext, b: InlineContext): boolean {
    return a.link === b.link && formatBits(a.formats) === formatBits(b.formats)
        && spanStyleToCss(a.spanStyle) === spanStyleToCss(b.spanStyle) && a.spanAttributes === b.spanAttributes;
}

/**
 * The context a container token's content inherits: emphasis adds its
 * format, a link its target, a styled span its style; a `text` token holding
 * tokens passes its own on.
 *
 * @param token - The token.
 * @param context - The formatting around it.
 * @returns The content's context, or `null` for a token holding no inline
 *   tokens of its own.
 */
function containerContext(token: Token, context: InlineContext): InlineContext | null {
    const format = TOKEN_FORMATS[token.type];

    if (format !== undefined) {
        return withFormat(context, format);
    }

    switch (token.type) {
        case "link":       return linkContext(token as Tokens.Link, context);
        case "styledspan": return styledSpanContext(token as Tokens.Generic, context);
        case "text":       return context;
        default:           return null;
    }
}

/**
 * The Lexical format bits of a list of text formats.
 *
 * @param formats - The formats.
 * @returns Their bits, or-ed.
 */
function formatBits(formats: readonly TextFormatType[]): number {
    return formats.reduce((bits, format) => bits | TEXT_TYPE_TO_FORMAT[format], 0);
}

/**
 * The links at an edge of a block's inline content: those with nothing but
 * whitespace — or other such links — before them, or after them, at any
 * depth of emphasis or styled span. A link there whose text is only
 * whitespace is kept as its source ({@link appendLink}): the save trims the
 * whitespace at a block's edges, so it cannot write such a link there.
 *
 * @param tokens - The block's inline tokens.
 * @returns The links at either edge.
 */
function edgeLinks(tokens: Token[]): Set<Token> {
    const edges = new Set<Token>();

    // Walks from one end; returns whether everything walked showed only whitespace, so the walk goes on.
    const walk = (list: readonly Token[]): boolean => list.every((token) => {
        const children = ((token as Tokens.Generic).tokens ?? []) as Token[];

        if (token.type === "link") {
            edges.add(token);

            return showsOnlyWhitespace(children);
        }

        if (TOKEN_FORMATS[token.type] !== undefined || token.type === "styledspan") {
            return walk(children);
        }

        return showsOnlyWhitespace([token]);
    });

    walk(tokens);
    walk([...tokens].reverse().map((token) => reversedToken(token)));

    return edges;
}

/**
 * A container token whose children are reversed, at every depth, for
 * {@link edgeLinks}' walk from the end; a leaf, or a link (whose own
 * children it reads as they are), is returned as it is.
 *
 * @param token - The token.
 * @returns The token, or a copy with its children reversed.
 */
function reversedToken(token: Token): Token {
    const children = (token as Tokens.Generic).tokens as Token[] | undefined;

    if (token.type === "link" || children === undefined || children.length === 0) {
        return token;
    }

    return { ...token, tokens: [...children].reverse().map((child) => reversedToken(child)) } as Token;
}

/**
 * Tells whether a link's text shows nothing beside the links nested in it
 * but whitespace, some of it at the text's own start or end — whitespace a
 * save trims away when the link stands at its block's edge.
 *
 * @param tokens - The link's inline tokens.
 * @returns Whether it does.
 */
function showsWhitespaceBesideLinks(tokens: readonly Token[]): boolean {
    const atEdge = [tokens[0], tokens[tokens.length - 1]]
        .some((token) => token?.type === "text" && /^\s+$/.test((token as Tokens.Text).text));

    return atEdge && !showsOnlyWhitespace(tokens) && showsOnlyWhitespace(tokens, true);
}

/**
 * Tells whether inline tokens show nothing but whitespace: each leaf is text
 * (or an escape) holding only whitespace, at any depth of emphasis or span.
 *
 * @param tokens - The inline tokens.
 * @param besideLinks - Whether links among them count as showing nothing, so
 *   only the text beside them is read.
 * @returns `true` when they show only whitespace, or nothing.
 */
function showsOnlyWhitespace(tokens: readonly Token[], besideLinks: boolean = false): boolean {
    return tokens.every((token) => {
        const children = (token as Tokens.Generic).tokens as Token[] | undefined;

        if (besideLinks && token.type === "link") {
            return true;
        }

        if (TOKEN_FORMATS[token.type] !== undefined || token.type === "styledspan") {
            return showsOnlyWhitespace(children ?? [], besideLinks);
        }

        return (token.type === "text" || token.type === "escape") && (children === undefined || children.length === 0
            ? /^\s*$/.test((token as Tokens.Text).text)
            : showsOnlyWhitespace(children, besideLinks));
    });
}

/**
 * Tells whether inline tokens hold content of their own outside any link
 * nested in them: a leaf that appends a node (non-empty text, a code span, a
 * break, an image, a source run), at any depth of emphasis or span.
 *
 * @param tokens - The inline tokens.
 * @returns `true` when one of them appends a node outside a nested link.
 */
function holdsOwnLeaf(tokens: Token[]): boolean {
    return tokens.some((token) => {
        const children = (token as Tokens.Generic).tokens as Token[] | undefined;

        if (token.type === "link") {
            return false;
        }

        if (TOKEN_FORMATS[token.type] !== undefined || token.type === "styledspan" || (children?.length ?? 0) > 0) {
            return holdsOwnLeaf(children ?? []);
        }

        return token.type === "text" || token.type === "escape" ? (token as Tokens.Text).text !== "" : true;
    });
}

/**
 * The text the viewer shows for inline tokens: each leaf's text (its `raw`
 * when it has none), an image showing none.
 *
 * @param tokens - The inline tokens.
 * @returns Their text, joined.
 */
function shownText(tokens: Token[]): string {
    return tokens.map((token) => {
        const children = (token as Tokens.Generic).tokens;

        if (children !== undefined && children.length > 0) {
            return shownText(children);
        }

        return token.type === "mdimage" ? "" : (token as Tokens.Generic).text ?? token.raw;
    }).join("");
}

/**
 * Appends a styled span's content with its style merged over the inherited
 * one: a field the span sets wins. Its text keeps the span's authored
 * attribute text, which the serializer writes back while it still resolves to
 * the text's style.
 *
 * @param target - Where nodes are appended.
 * @param token - The `styledspan` token.
 * @param context - The formatting it inherits.
 */
function appendStyledSpan(target: InlineTarget, token: Tokens.Generic, context: InlineContext): void {
    appendInlineTokens(target, token.tokens ?? [], styledSpanContext(token, context));
}

/**
 * The context a styled span's content inherits: its style merged over the
 * inherited one — a field the span sets wins — and its authored attribute
 * text.
 *
 * @param token - The `styledspan` token.
 * @param context - The formatting around the span.
 * @returns The context inside the span.
 */
function styledSpanContext(token: Tokens.Generic, context: InlineContext): InlineContext {
    const own = resolveSpanStyle(token.attributes as Record<string, string>);

    const inherited = context.spanStyle;

    const spanStyle: MarkdownSpanStyle = {
        color:      own.color ?? inherited.color,
        fontFamily: own.fontFamily ?? inherited.fontFamily,
        fontSize:   own.fontSize ?? inherited.fontSize,
    };

    const spanAttributes = SPAN_ATTRIBUTES.exec(token.raw)?.[1] ?? "";

    return { ...context, spanStyle, spanAttributes };
}

/**
 * Appends an image the viewer renders, keeping the attribute text it was
 * written with ({@link imageAttributesState}) for the save; or — for a source
 * it rejects, where the viewer renders nothing — a source node showing
 * nothing and saving its Markdown, so it is not lost.
 *
 * @param target - Where nodes are appended.
 * @param token - The `mdimage` token.
 * @param context - The formatting it inherits; only its link applies.
 */
function appendImage(target: InlineTarget, token: Tokens.Generic, context: InlineContext): void {
    const image = $imageNode(token);

    if (image === null) {
        appendSourceNode(target, "", token.raw, context);

        return;
    }

    appendLeaf(target, image, context);
}

/**
 * The image spec the viewer renders for an `mdimage` token.
 *
 * @param token - The `mdimage` token.
 * @returns The spec, or `null` for a source the viewer rejects.
 */
function $imageSpec(token: Tokens.Generic): ReturnType<typeof resolveImageSpec> {
    return resolveImageSpec(token.src as string, token.alt as string, token.attributes as Record<string, string>);
}

/**
 * Creates the image node for an `mdimage` token the viewer renders, keeping
 * the attribute text it was written with ({@link imageAttributesState}).
 *
 * @param token - The `mdimage` token.
 * @returns The image, or `null` for a source the viewer rejects.
 */
function $imageNode(token: Tokens.Generic): MarkdownImageNode | null {
    const spec = $imageSpec(token);

    if (spec === null) {
        return null;
    }

    const image = $createMarkdownImageNode(spec);
    const attributes = IMAGE_ATTRIBUTES.exec(token.raw)?.[1] ?? "";

    if (attributes !== "") {
        $setState(image, imageAttributesState, attributes);
    }

    return image;
}

/**
 * A hard line break carrying its authored marker: the token's `raw` without
 * its newline (`\` or the run of spaces).
 *
 * @param raw - The `br` token's source.
 * @returns The line break.
 */
function hardBreak(raw: string): LexicalNode {
    const node = $createLineBreakNode();

    $setState(node, hardBreakMarkerState, raw.replace(/\n$/, ""));

    return node;
}

/**
 * Appends a source node: what the viewer shows for the token, whitespace
 * collapsed, saving its source unchanged.
 *
 * @param target - Where nodes are appended.
 * @param display - The text the viewer shows.
 * @param source - The Markdown the node saves.
 * @param context - Its formatting.
 */
function appendSourceNode(target: InlineTarget, display: string, source: string, context: InlineContext): void {
    appendLeaf(target, formatted($createMarkdownSourceTextNode(display.replace(/\s+/g, " "), source), context), context);
}

/**
 * Appends an inline leaf, into the open link when the leaf has one — opening
 * a new link node when the leaf's link is not the one open, so an inner link
 * closes its outer one and the outer one reopens after it.
 *
 * @param target - Where nodes are appended.
 * @param node - The leaf.
 * @param context - Its formatting; only the link is read here.
 */
function appendLeaf(target: InlineTarget, node: LexicalNode, context: InlineContext): void {
    const link = context.link;

    if (link === null) {
        target.openLink = null;
        target.block.append(node);

        return;
    }

    if (target.openLink?.target !== link) {
        const linkNode = link.reference === null
            ? $createLinkNode(link.href, { title: link.title })
            : $createReferenceLinkNode(link.href, link.title, link.reference);

        if (link.bare) {
            $setState(linkNode, bareAutolinkState, true);
        }

        target.block.append(linkNode);
        target.openLink = { target: link, node: linkNode };
    }

    target.openLink.node.append(node);
}

/**
 * A text node with the context's formats and style.
 *
 * @param text - The text.
 * @param context - The formatting.
 * @returns The text node.
 */
function styledText(text: string, context: InlineContext): TextNode {
    return formatted($createTextNode(text), context);
}

/**
 * Applies the context's formats, style and span attribute text to a text node.
 *
 * @param node - The text (or source) node.
 * @param context - The formatting.
 * @returns `node`.
 */
function formatted<T extends TextNode>(node: T, context: InlineContext): T {
    node.setFormat(formatBits(context.formats));
    node.setStyle(spanStyleToCss(context.spanStyle));

    if (context.spanAttributes !== "") {
        $setState(node, spanAttributesState, context.spanAttributes);
    }

    return node;
}

/**
 * Returns `context` with `format` added.
 *
 * @param context - The current formatting.
 * @param format - The format to add.
 * @returns The extended formatting.
 */
function withFormat(context: InlineContext, format: TextFormatType): InlineContext {
    return { ...context, formats: [...context.formats, format] };
}
