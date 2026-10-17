// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { $findMatchingParent, $isElementNode, $isLineBreakNode, $isTextNode } from "lexical";
import type { ElementNode, LexicalNode, TextNode } from "lexical";
import type { Token, Tokens } from "marked";
import { $isCodeNode } from "@lexical/code";
import { $isListItemNode } from "@lexical/list";
import { $isTableCellNode, $isTableNode, $isTableRowNode } from "@lexical/table";
import type { TableNode } from "@lexical/table";
import { $dfs } from "@lexical/utils";
import { lineEndAt } from "~/component/display/markdownAttributes.js";
import { lexMarkdownLinkDefinitions } from "~/component/display/markdownExtensions.js";
import { $isMarkdownRawBlockNode, $isMarkdownSourceTextNode } from "~/component/editor/markdownSourceNodes.js";
import type { MarkdownSourceTextNode } from "~/component/editor/markdownSourceNodes.js";
import { analyzeMarkdownSource, contentOffset, MARK_LETTERS } from "~/component/editor/markdownSourceTokens.js";
import type { SourceAnalysis, SourceBlockNode, SourceEntry, SourceInline } from "~/component/editor/markdownSourceTokens.js";

/**
 * A place a collapsed caret can stand at in a block: an offset in a text
 * node, or a child index of an element.
 */
export interface SourcePlace {
    readonly node:   TextNode | ElementNode;
    readonly offset: number;
}

/**
 * One thing a block shows — a character of a text node, a line break, or a
 * node that is neither (an image) — with where its source stands in the
 * block's Markdown.
 */
interface ShownUnit {
    readonly node:     LexicalNode;
    /** The character's offset in its text node; 0 for a node that is no text. */
    readonly offset:   number;
    /** The character; a newline for a line break, nothing for a node that is neither, or a source node that shows nothing. */
    readonly char:     string;
    /** The code block or raw block the unit stands in, whose text shows as it is written; `null` elsewhere. */
    readonly verbatim: ElementNode | null;
    /** The source offsets of what the unit shows; {@link NOT_FOUND} while its source is not found. */
    start:             number;
    end:               number;
    /** The inline tokens around the unit's source, outermost first. */
    inside:            readonly SourceInline[];
}

/** A block's units and how far a walk of its source's entries has found their source. */
interface UnitWalk {
    /** The block's Markdown. */
    readonly text:  string;
    readonly units: ShownUnit[];
    /** The index of the first unit the walk has not passed. */
    at:             number;
    /** Whether the entries and the units stopped agreeing: the source of the units from `at` on is not found. */
    isLost:         boolean;
    /** The inline tokens of the block's Markdown: the analysis's, a link whose text it does not find with its text found. */
    inlines:        readonly SourceInline[];
    /** The code span whose characters the walk is passing, where each stands in the source, and how many it has passed. */
    code:           SourceInline | null;
    codeOffsets:    readonly number[] | null;
    codeAt:         number;
}

/** The offset of a source that is not found, as the source analysis gives it for a token it cannot find. */
const NOT_FOUND = -1;

/** The length {@link ownBlocks} takes a block of no Markdown to have: its first offset is inside it. */
const EMPTY_BLOCK_LENGTH = 1;

/** The index of the line of a table's source that holds its delimiter row (`| --- |`), which shows no row. */
const TABLE_DELIMITER_LINE = 1;

/** The block token types whose own entry holds nothing a code block or a raw block shows. */
const TEXT_BLOCK_TYPES: ReadonlySet<string> = new Set(["paragraph", "heading", "text", "checkbox"]);

/**
 * The characters a line may hold before its own text inside a quote or a
 * list item, which `marked` drops before it reads the text: those of
 * `CONTAINER_PREFIX_CHARACTERS` of the source analysis, as the run of them
 * that opens a line.
 */
const LINE_PREFIX = /^[ \t>]*/;

/**
 * The four characters a table cell's text holds for a paragraph break, as
 * the importer's `CELL_PARAGRAPH_BREAK`.
 */
const CELL_PARAGRAPH_BREAK = "\\n\\n";

/**
 * What ends a block's text in the source between two blocks that show
 * text: a line end; or, between two cells of a table's row, the `|` that
 * parts them; or, between two paragraphs of one cell, the cell's paragraph
 * break ({@link CELL_PARAGRAPH_BREAK}).
 */
const BLOCK_END = /\n|\||\\n\\n/;

/** No inline tokens. */
const NO_INLINES: readonly SourceInline[] = [];

/**
 * Where an offset of a block's Markdown stands in the block a load built of
 * it: after everything the block shows whose source ends at or before the
 * offset, and before everything else it shows. Nothing the block shows is
 * on another side of the place than its source is of the offset.
 *
 * The source of what the block shows comes from the source analysis
 * ({@link analyzeMarkdownSource}), which reads the Markdown through the
 * viewer's lexer, as the load did, and finds each character's source; the
 * block's own text is matched against it character for character
 * ({@link locateByEntries}), so a place is never guessed.
 *
 * @remarks
 * Where the place is between two things:
 * - Between two text nodes of one line, it is in the one whose format the
 *   offset has in the source — inside the delimiters of bold text it is in
 *   the bold text, outside them in the text beside it — at the end of the
 *   first where both have it, and at the start of the second where neither
 *   has. A source node, which takes no typing, gives way to text on its
 *   other side.
 * - Between two blocks, it is at the end of the text before it while the
 *   source has not ended that block before the offset — with a line end,
 *   or the `|` or the paragraph break that parts a table's cells and a
 *   cell's paragraphs — else at the start of the text after it.
 * - An offset inside the source of one thing the block shows as a whole —
 *   between the backslash of an escape and its character, in the syntax of
 *   a hard line break or of an image — is before that thing.
 * - An offset inside the source of a source node that shows its source as
 *   written (inline HTML, a task item's checkbox) is at the nearer end of
 *   that node, never inside it ({@link $placeOutsideSourceNode}).
 * - An offset in a list item or a table cell that shows nothing, in a block
 *   that shows something elsewhere, is in that item or cell
 *   ({@link $emptyBlockAt}), never at the end of the text before it or the
 *   start of the text after it, which belong to a neighbour.
 *
 * There is no place, and the caller falls back, where the block shows
 * nothing, and where the block holds, beside the offset or after it,
 * something whose source is not found ({@link $placeAmongUnits}): what
 * the lexer hands back otherwise than the source holds it. Those are a
 * tab in the container prefix of a code line or an HTML line, or of a
 * paragraph line made of list markers and tabs, which shows as the spaces the
 * tab stands for; a task item's checkbox written with more than one space
 * after it in a list whose items stand apart, which shows with the one space
 * of its own; a list item's text that begins as a link reference definition
 * repeating a label, which the lexer drops. (A link text holding
 * an escaped bracket is such text too, and its source is found another way:
 * {@link leavesOfUnescapedLinks}.)
 *
 * @param text - The Markdown the block was built of, with the blocks beside it.
 * @param offset - The offset in `text`.
 * @param block - The block a load built of `text` from `start` to `end`.
 * @param start - The block's first offset in `text`.
 * @param end - The offset past its last.
 * @returns The place, or `null` when it is not found.
 */
export function $placeOfSourceOffset(text: string, offset: number, block: LexicalNode, start: number, end: number): SourcePlace | null {
    const { walk, analysis, isRawBlock } = $locatedWalk(text, block, start, end);
    const source = text.slice(start);

    // A block that shows something elsewhere: one that shows nothing at all has no neighbour to be mistaken for.
    const empty = isRawBlock || walk.units.length === 0 ? null : $emptyBlockAt(block, source, offset - start, analysis, end - start);

    if (empty !== null) {
        return { node: empty, offset: 0 };
    }

    const place = $placeAmongUnits(walk.units, offset - start, source, walk.inlines);

    return place === null ? null : $placeOutsideSourceNode(place);
}

/** A block's units with their source found, the analysis they were found from, and whether the block is a raw block. */
interface LocatedWalk {
    readonly walk:       UnitWalk;
    readonly analysis:   SourceAnalysis;
    readonly isRawBlock: boolean;
}

/**
 * Finds the source of what a block shows: the walk both directions of the
 * mapping between a block's Markdown and what it shows read.
 *
 * @param text - The Markdown the block was built of, with the blocks beside it.
 * @param block - The block a load built of `text` from `start` to `end`.
 * @param start - The block's first offset in `text`.
 * @param end - The offset past its last.
 * @returns The walk, the analysis it was found from, and whether the block is a raw block.
 */
function $locatedWalk(text: string, block: LexicalNode, start: number, end: number): LocatedWalk {
    // The block's Markdown with all that follows it: what ends the block's last line may lie past `end`, and the
    // blocks after it read apart from it.
    const source = text.slice(start);
    const analysis = analyzeMarkdownSource(`${source}\n${definitionLines(text.slice(0, start))}`);
    const isRawBlock = $isMarkdownRawBlockNode(block);

    const walk: UnitWalk = {
        text: source, units: $shownUnits(block), at: 0, isLost: false, inlines: analysis.inlines, code: null, codeOffsets: null, codeAt: 0,
    };

    if (isRawBlock) {
        locateVerbatim(walk, 0, false);
    } else {
        locateByEntries(walk, analysis, end - start);
    }

    return { walk, analysis, isRawBlock };
}

/** A point of a block, as Lexical names one. */
export interface BlockPoint {
    /** The node the point is in. */
    readonly node:   LexicalNode;
    /** The offset in a text node, or the child index in an element. */
    readonly offset: number;
    /** Whether `node` is a text node or an element. */
    readonly type:   "text" | "element";
}

/**
 * Where a point of a block stands in the block's Markdown: the start of the source of the first thing the block shows
 * at or after the point, else the end of the source of the last thing it shows before it. The reverse of
 * {@link $placeOfSourceOffset}, read from the same walk.
 *
 * @param text - The Markdown the block was built of, with the blocks beside it.
 * @param block - The block a load built of `text` from `start` to `end`.
 * @param start - The block's first offset in `text`.
 * @param end - The offset past its last.
 * @param point - The point, in `block`.
 * @returns The offset in `text`, or `null` when the block shows nothing there or that thing's source is not found.
 */
export function $sourceOffsetOfPoint(text: string, block: LexicalNode, start: number, end: number, point: BlockPoint): number | null {
    const { walk } = $locatedWalk(text, block, start, end);
    const offset = point.type === "text" ? sourceOffsetInText(walk.units, point) : sourceOffsetInElement(walk.units, point);

    return offset === null ? null : start + offset;
}

/**
 * The offset in a block's Markdown of a point in a text node.
 *
 * @param units - The block's units, their source found.
 * @param point - The point.
 * @returns The offset in the block's Markdown, or `null` when there is no unit or its source is not found.
 */
function sourceOffsetInText(units: readonly ShownUnit[], point: BlockPoint): number | null {
    const own = units.filter((unit) => unit.node.is(point.node));
    const atPoint = own.find((unit) => unit.offset === point.offset);
    const last = own[own.length - 1];
    // A source node that shows nothing (a link with no text, kept as written) is one unit and no character: a caret
    // in it stands after the source it keeps, as a place is only ever given there.
    const isEmptySource = atPoint !== undefined && atPoint.char === "" && $isMarkdownSourceTextNode(atPoint.node);

    if (isEmptySource) {
        return atPoint.end === NOT_FOUND ? null : atPoint.end;
    }

    if (atPoint !== undefined) {
        return atPoint.start === NOT_FOUND ? null : atPoint.start;
    }

    const isAtEnd = last !== undefined && last.offset + 1 === point.offset;

    return isAtEnd && last.end !== NOT_FOUND ? last.end : null;
}

/**
 * The offset in a block's Markdown of a point between the children of an element.
 *
 * @param units - The block's units, their source found.
 * @param point - The point.
 * @returns The offset in the block's Markdown, or `null` when the children beside the point show nothing or their source is not found.
 */
function sourceOffsetInElement(units: readonly ShownUnit[], point: BlockPoint): number | null {
    const element = point.node as ElementNode;
    const after = element.getChildAtIndex(point.offset);
    const before = element.getChildAtIndex(point.offset - 1);
    const first = after === null ? undefined : units.find((unit) => unit.node.is(after) || after.isParentOf(unit.node));

    if (first !== undefined) {
        return first.start === NOT_FOUND ? null : first.start;
    }

    const last = before === null ? undefined : units.findLast((unit) => unit.node.is(before) || before.isParentOf(unit.node));

    return last === undefined || last.end === NOT_FOUND ? null : last.end;
}

/**
 * A place that is strictly inside a source node, moved out of it: to the
 * nearer end of the node, its start where both are as near, named in the
 * ordinary text beside the node there when there is some. A source node
 * is kept as written and takes no typing: a character typed inside one
 * replaces the node whole, a task item's checkbox with it. So a caret is
 * never left inside one. Any other place is returned as it is.
 *
 * @param place - The place.
 * @returns The place, outside any source node.
 */
export function $placeOutsideSourceNode(place: SourcePlace): SourcePlace {
    const { node, offset } = place;
    const size = $isMarkdownSourceTextNode(node) ? node.getTextContentSize() : 0;
    const isInside = offset > 0 && offset < size;

    if (!isInside) {
        return place;
    }

    // Past the node's middle: `offset > size / 2`, kept in whole numbers.
    const isNearerEnd = offset * 2 > size;
    const beside = isNearerEnd ? node.getNextSibling() : node.getPreviousSibling();
    const isTextBeside = $isTextNode(beside) && !$isMarkdownSourceTextNode(beside);

    if (isTextBeside) {
        return { node: beside, offset: isNearerEnd ? 0 : beside.getTextContentSize() };
    }

    return { node, offset: isNearerEnd ? size : 0 };
}

/**
 * The link reference definitions a text holds, each as a line that defines
 * its label anew, so that a block of the text read by itself reads its
 * reference links as it does inside the text. Where a definition points
 * does not matter to what a block shows, so each points nowhere.
 *
 * @param text - The text.
 * @returns The lines, each after a blank line; nothing when the text holds no definition.
 */
function definitionLines(text: string): string {
    return Object.keys(lexMarkdownLinkDefinitions(text)).map((label) => `\n[${label.replace(/[\\[\]]/g, "\\$&")}]: <>\n`).join("");
}

/**
 * The blocks of a source analysis that begin inside a block's own Markdown:
 * the analysis also holds the blocks that follow it, which read apart from
 * it. A block of no Markdown at all begins at its first offset, where the
 * analysis puts the block that stands there.
 *
 * @param analysis - The analysis of the block's Markdown and what follows it.
 * @param length - The length of the block's own Markdown.
 * @returns The blocks, in document order.
 */
function ownBlocks(analysis: SourceAnalysis, length: number): readonly SourceBlockNode[] {
    const end = Math.max(length, EMPTY_BLOCK_LENGTH);

    return analysis.tree.filter((node) => node.start !== NOT_FOUND && node.start < end);
}

/**
 * The block-level source nodes of a type in a block's source, the nodes
 * inside the block's own first, each before the nodes inside it.
 *
 * @param analysis - The analysis of the block's Markdown and what follows it.
 * @param length - The length of the block's own Markdown.
 * @param type - The type.
 * @returns The nodes in document order.
 */
function sourceNodesOf(analysis: SourceAnalysis, length: number, type: string): SourceBlockNode[] {
    const found: SourceBlockNode[] = [];

    const collect = (node: SourceBlockNode): void => {
        if (node.type === type) {
            found.push(node);
        }

        node.children.forEach(collect);
    };

    ownBlocks(analysis, length).forEach(collect);

    return found;
}

/**
 * The list item or table cell an offset stands in, when it shows nothing
 * while a block beside it shows something: the place of an offset in such
 * an item or cell is the item or cell, never the text of a neighbour. Found
 * in the source by the item's or the cell's place among the block's items
 * or cells (the rows of a table without its delimiter row), and used only
 * where the source and the block agree on how many there are.
 *
 * @param block - The block a load built of the Markdown.
 * @param source - The block's Markdown with all that follows it.
 * @param offset - The offset in `source`.
 * @param analysis - The analysis of `source`.
 * @param length - The length of the block's own Markdown.
 * @returns The item or the cell, or `null` when the offset is not in one that shows nothing.
 */
function $emptyBlockAt(block: LexicalNode, source: string, offset: number, analysis: SourceAnalysis, length: number): ElementNode | null {
    const nodes = $dfs(block).map((entry) => entry.node);
    // A source node ends before the blanks that end its last line.
    const isWithin = (node: SourceBlockNode): boolean => node.start <= offset && /^[ \t]*$/.test(source.slice(node.end, offset));

    const items = nodes.filter($isListItemNode);
    const sourceItems = sourceNodesOf(analysis, length, "list_item");
    const inItems = sourceItems.length === items.length ? sourceItems.map((item, at) => (isWithin(item) ? at : NOT_FOUND)) : [];
    const itemAt = Math.max(NOT_FOUND, ...inItems);
    const item = itemAt === NOT_FOUND ? undefined : items[itemAt];

    // An item that shows something can hold a table whose cell shows nothing: the tables are asked next.
    if (item !== undefined && $showsNothing(item)) {
        return $innermostFirst(item);
    }

    const tables = sourceNodesOf(analysis, length, "mdtable");
    const table = tables.find((candidate) => isWithin(candidate));
    const shown: TableNode[] = nodes.filter($isTableNode);

    return table === undefined || tables.length !== shown.length ? null : $emptyCellAt(shown[tables.indexOf(table)]!, source, table.start, offset);
}

/**
 * The cell of a table an offset in its source stands in, when it shows
 * nothing.
 *
 * @param table - The table.
 * @param source - The Markdown the table was built of, with what follows it.
 * @param start - The offset of the table's first line in `source`.
 * @param offset - The offset in `source`.
 * @returns The cell, or `null` when the offset is on the delimiter row, the row has no cell there or the cell shows something. An offset before a row's opening pipe is in the row's first cell, and one after its closing pipe in its last.
 */
function $emptyCellAt(table: TableNode, source: string, start: number, offset: number): ElementNode | null {
    const lines = source.slice(start, offset).split("\n");
    const lineIndex = lines.length - 1;
    const line = lines[lineIndex]!;
    // The lines after the delimiter line are the rows after the header row.
    const row = lineIndex < TABLE_DELIMITER_LINE ? lineIndex : lineIndex - 1;
    const pipes = line.match(/(?<!\\)\|/g)?.length ?? 0;
    const cells = table.getChildren().filter($isTableRowNode)[row]?.getChildren() ?? [];
    // Right after the pipe that closes a row, the offset is still in the row's last cell.
    const cell = cells[Math.min(pipes - (line.trimStart().startsWith("|") ? 1 : 0), cells.length - 1)];

    return lineIndex === TABLE_DELIMITER_LINE || !$isTableCellNode(cell) || !$showsNothing(cell) ? null : $innermostFirst(cell);
}

/**
 * Whether a block shows nothing: it holds no text, line break or other
 * node that is no element.
 *
 * @param block - The block.
 * @returns Whether it does.
 */
function $showsNothing(block: ElementNode): boolean {
    return $dfs(block).every((entry) => $isElementNode(entry.node));
}

/**
 * The element a caret in a block that shows nothing stands in: the first
 * element at the bottom of the block's first children, where the block
 * holds an empty paragraph or an item's empty text.
 *
 * @param block - The block.
 * @returns The element.
 */
function $innermostFirst(block: ElementNode): ElementNode {
    const first = block.getFirstChild();

    return $isElementNode(first) ? $innermostFirst(first) : block;
}

/**
 * What a block shows, unit by unit in document order.
 *
 * @param block - The block.
 * @returns Its units, the source of none found yet.
 */
function $shownUnits(block: LexicalNode): ShownUnit[] {
    const units: ShownUnit[] = [];
    const leaves = $dfs(block).map(({ node }) => node).filter((node) => !$isElementNode(node));

    for (const node of leaves) {
        const verbatim = $findMatchingParent(node, (parent): parent is ElementNode => $isCodeNode(parent) || $isMarkdownRawBlockNode(parent));
        // A source node that shows nothing (a link with no text, kept as written) is one unit all the same.
        const text = $isTextNode(node) ? node.getTextContent() : $isLineBreakNode(node) ? "\n" : "";
        const isEmptyText = text === "" && $isTextNode(node) && !$isMarkdownSourceTextNode(node);
        const chars = isEmptyText ? [] : text === "" ? [""] : text.split("");

        chars.forEach((char, offset) => {
            units.push({ node, offset, char, verbatim, start: NOT_FOUND, end: NOT_FOUND, inside: NO_INLINES });
        });
    }

    return units;
}

/**
 * Finds the source of a block's units from the entries of its source
 * analysis, in order: each entry says what the block shows next and where
 * its source stands, and the block must show just that. Where it shows
 * something else the walk is lost, and the units from there on keep no
 * source.
 *
 * @param walk - The block's units.
 * @param analysis - The analysis of the block's Markdown and what follows it.
 * @param length - The length of the block's own Markdown.
 */
function locateByEntries(walk: UnitWalk, analysis: SourceAnalysis, length: number): void {
    const group = ownBlocks(analysis, length);
    const first = group[0];
    const last = group[group.length - 1];
    const blocks = new Map<number, SourceBlockNode>();

    const collect = (node: SourceBlockNode): void => {
        blocks.set(node.entryStart, node);
        node.children.forEach(collect);
    };

    group.forEach(collect);

    const from = first?.entryStart ?? 0;
    const to = last?.entryEnd ?? 0;
    const inLinks = leavesOfUnescapedLinks(walk, analysis);

    for (let index = from; index < to && !walk.isLost; index += 1) {
        const entry = inLinks.get(analysis.entries[index]!) ?? analysis.entries[index]!;
        const isBreak = showsAsCellParagraphBreak(walk, analysis.entries, index);

        if (isBreak) {
            index += CELL_PARAGRAPH_BREAK.length - 1;
        } else if (entry.kind === "block") {
            index += locateBlockEntry(walk, blocks.get(index));
        } else {
            locateLeaf(walk, entry);
        }
    }

    locateUnclaimedRawBlocks(walk);
    locateUnclaimedEmptySources(walk);
}

/**
 * The leaves of the links whose text the analysis does not find, each with
 * its source found. `marked` takes the backslash off an escaped bracket in
 * a link's text before it reads that text, so the tokens of the text are
 * not in the source as they stand and the analysis leaves them without
 * offsets. The text is in the source all the same, after the link's `[`,
 * with those backslashes in it ({@link offsetsOfLinkText}), and each
 * leaf's place in the text follows from its tokens ({@link leafSpans}).
 *
 * @param walk - The block's units; takes the links as found.
 * @param analysis - The analysis of the block's Markdown.
 * @returns For each such leaf, the leaf with its source offsets.
 */
function leavesOfUnescapedLinks(walk: UnitWalk, analysis: SourceAnalysis): Map<SourceEntry, SourceEntry> {
    const leaves = new Map<SourceEntry, SourceEntry>();
    const links = new Map<SourceInline, SourceInline>();
    const unfound = analysis.inlines.filter((inline) => inline.type === "link" && inline.innerStart === NOT_FOUND && walk.text[inline.start] === "[");

    for (const link of unfound) {
        const tokens = (link.token as Tokens.Link).tokens;
        const inside = analysis.entries.filter((entry) => entry.kind === "leaf" && entry.ancestors.includes(link));
        const offsets = offsetsOfLinkText(walk.text, link.start + 1, link.end, tokens.map((token) => token.raw).join(""));
        const spans: Array<readonly [number, number]> = [];
        const isSpanned = leafSpans(tokens, 0, spans) && spans.length === inside.length;

        if (offsets !== null && isSpanned) {
            const textEnd = offsets.length === 0 ? link.start + 1 : offsets[offsets.length - 1]! + 1;
            const found = { ...link, innerStart: link.start + 1, innerEnd: textEnd };

            links.set(link, found);
            inside.forEach((leaf, at) => {
                const [start, end] = spans[at]!;
                const ancestors = leaf.ancestors.map((ancestor) => (ancestor === link ? found : ancestor));

                leaves.set(leaf, { ...leaf, start: offsets[start]!, end: offsets[end - 1]! + 1, ancestors });
            });
        }
    }

    walk.inlines = analysis.inlines.map((inline) => links.get(inline) ?? inline);

    return leaves;
}

/**
 * Where each character of a link's text, as `marked` reads it, stands in
 * the source: the text as written, without the backslash before an escaped
 * bracket.
 *
 * @param text - The block's Markdown.
 * @param from - The offset after the link's `[`.
 * @param to - The offset the link ends at.
 * @param read - The link's text as `marked` reads it.
 * @returns Each character's offset, or `null` when the source does not hold the text so.
 */
function offsetsOfLinkText(text: string, from: number, to: number, read: string): number[] | null {
    const offsets: number[] = [];
    let at = from;

    for (const char of read.split("")) {
        const isEscaped = text[at] === "\\" && text[at + 1] === char && (char === "[" || char === "]");

        at += isEscaped ? 1 : 0;

        if (at >= to || text[at] !== char) {
            return null;
        }

        offsets.push(at);
        at += 1;
    }

    return text[at] === "]" ? offsets : null;
}

/**
 * Where each leaf of a run of inline tokens stands in the run's text, in
 * the order and the number the analysis gives the leaves in: a character
 * of plain text at itself, the characters of a code span or an escape and
 * any other atom at the whole token, and the leaves of a token that holds
 * tokens inside its content ({@link contentOffset}).
 *
 * @param tokens - The tokens.
 * @param from - The offset of the first token in the run's text.
 * @param spans - Receives each leaf's `[start, end)` in the run's text.
 * @returns Whether every token's content is where its syntax puts it.
 */
function leafSpans(tokens: readonly Token[], from: number, spans: Array<readonly [number, number]>): boolean {
    let at = from;

    for (const token of tokens) {
        const children = (token as { tokens?: Token[] }).tokens;
        const whole: readonly [number, number] = [at, at + token.raw.length];
        const shown = (token as { text?: string }).text ?? "";
        const isPlain = token.type === "text" && children === undefined;
        const isAtom = token.type === "codespan" || token.type === "escape" || (isPlain && shown !== token.raw);
        const holdsContent = token.type === "codespan" || !(isPlain || isAtom);
        const content = holdsContent ? contentOffset(token, children ?? []) : 0;

        const isWritten = isPlain ? !isAtom : token.type === "codespan" && token.raw.slice(content, content + shown.length) === shown;

        if (isWritten) {
            // Each character at itself; two code units of one code point are one leaf of a code span.
            const leaves = isPlain ? shown.split("") : [...shown];
            const starts = leaves.map((_, index) => at + content + leaves.slice(0, index).join("").length);

            spans.push(...leaves.map((leaf, index): readonly [number, number] => [starts[index]!, starts[index]! + leaf.length]));
        } else if (isAtom) {
            spans.push(...[...shown].map(() => whole));
        } else if (children === undefined || children.length === 0) {
            spans.push(whole);
        } else {
            const isSpanned = content !== NOT_FOUND && leafSpans(children, at + content, spans);

            if (!isSpanned) {
                return false;
            }
        }

        at += token.raw.length;
    }

    return true;
}

/**
 * Whether the leaves from an index spell a table cell's paragraph break,
 * which shows as the end of one paragraph of the cell and as no character:
 * the four characters stand side by side in one piece of a cell's text, and
 * the block does not show the first of them there.
 *
 * @param walk - The units.
 * @param entries - The analysis's entries.
 * @param index - The index of the first leaf.
 * @returns Whether they do.
 */
function showsAsCellParagraphBreak(walk: UnitWalk, entries: readonly SourceEntry[], index: number): boolean {
    const first = entries[index]!;
    const unit = walk.units[walk.at];

    const isSpelled = CELL_PARAGRAPH_BREAK.split("").every((char, at) => {
        const entry = entries[index + at];

        return entry !== undefined && entry.kind === "leaf" && entry.key === `t${char}` && entry.start === first.start + at
            && entry.ancestors === first.ancestors;
    });

    const isInCell = unit === undefined || $findMatchingParent(unit.node, $isTableCellNode) !== null;

    return isSpelled && first.start !== NOT_FOUND && isInCell && unit?.char !== CELL_PARAGRAPH_BREAK[0];
}

/**
 * Finds the source of what a block entry shows by itself: a task item's
 * checkbox, which shows as its source, or the text of a code block or of a
 * raw block, which shows as it is written. A raw block stands for a block
 * the nodes cannot hold, with all that is in it, so the entries inside
 * that block are passed over with it. Any other block entry shows nothing
 * by itself.
 *
 * @param walk - The units.
 * @param block - The entry's block; `undefined` for an entry that closes one.
 * @returns How many entries after this one belong to the block and are passed over.
 */
function locateBlockEntry(walk: UnitWalk, block: SourceBlockNode | undefined): number {
    const unit = walk.units[walk.at];

    if (block === undefined || unit === undefined) {
        return 0;
    }

    if (block.type === "checkbox") {
        locateSourceNode(walk, block.token?.raw ?? "", block.start, block.end, NO_INLINES);

        return 0;
    }

    const holdsNoText = TEXT_BLOCK_TYPES.has(block.type);

    if (holdsNoText || unit.verbatim === null) {
        return 0;
    }

    const isLeafBlock = block.children.length === 0 && block.entryEnd - block.entryStart === 1;
    const isCode = $isCodeNode(unit.verbatim);
    const linesShown = walk.units.filter((other) => other.verbatim === unit.verbatim && other.char === "\n").length + 1;
    const linesWritten = walk.text.slice(block.start, block.end).split("\n").length;
    const stands = isCode ? block.type === "code" : isLeafBlock || linesShown === linesWritten;

    if (!stands || block.start === NOT_FOUND) {
        return 0;
    }

    const isFenced = isCode && (block.token as Tokens.Code).codeBlockStyle !== "indented";
    const isFound = locateVerbatim(walk, block.start, isFenced);

    return isFound ? block.entryEnd - block.entryStart - 1 : 0;
}

/**
 * Finds the source of the code block or raw block the walk stands in, and
 * passes it: each of its lines ends a line of the source (before the blanks
 * that end that line, which a load drops from the last line of a fence
 * left open), in order from the line that holds `from` — the line after it
 * for a fenced code block, whose first line is its fence. Where a line
 * does not, nothing is found and the walk stays before the block.
 *
 * @param walk - The units.
 * @param from - A source offset on the block's first line.
 * @param skipsFirstLine - Whether the block's text begins on the next line.
 * @returns Whether every line was found.
 */
function locateVerbatim(walk: UnitWalk, from: number, skipsFirstLine: boolean): boolean {
    const verbatim = walk.units[walk.at]?.verbatim ?? null;
    const units = unitsOfVerbatim(walk, verbatim);
    const firstLine = from === 0 ? 0 : walk.text.lastIndexOf("\n", from - 1) + 1;
    const found: number[] = [];
    let lineStart = skipsFirstLine ? lineEndAt(walk.text, firstLine) + 1 : firstLine;
    let isShown = true;

    for (const line of units.map((unit) => unit.char).join("").split("\n")) {
        const lineEnd = lineEndAt(walk.text, lineStart);
        const written = walk.text.slice(lineStart, lineEnd);
        const textEnd = written.endsWith(line) ? lineEnd : lineStart + written.trimEnd().length;

        isShown = isShown && written.slice(0, textEnd - lineStart).endsWith(line);
        found.push(...line.split("").map((_, column) => textEnd - line.length + column), lineEnd);
        lineStart = lineEnd + 1;
    }

    if (isShown) {
        units.forEach((unit, at) => {
            unit.start = found[at]!;
            unit.end = found[at]! + 1;
        });
        walk.at += units.length;
    }

    return isShown;
}

/**
 * The units from the walk's place on that stand in one code block or raw
 * block.
 *
 * @param walk - The units.
 * @param verbatim - The block.
 * @returns Its units.
 */
function unitsOfVerbatim(walk: UnitWalk, verbatim: ElementNode | null): ShownUnit[] {
    const count = walk.units.slice(walk.at).findIndex((unit) => unit.verbatim !== verbatim);

    return walk.units.slice(walk.at, count === -1 ? walk.units.length : walk.at + count);
}

/**
 * Finds the source of a raw block the walk stands in that no entry stands
 * for — `marked` drops a link reference definition that repeats a label,
 * and the load keeps its text as a raw block — by its lines: from the first
 * source line after the last found unit that ends with the block's first
 * line.
 *
 * @param walk - The units.
 */
function locateUnclaimedRawBlocks(walk: UnitWalk): void {
    let verbatim = pendingRawBlock(walk);

    while (verbatim !== null) {
        const firstLine = unitsOfVerbatim(walk, verbatim).map((unit) => unit.char).join("").split("\n")[0]!;
        const before = walk.units.slice(0, walk.at).reverse().find((unit) => unit.start !== NOT_FOUND);
        const searchFrom = before === undefined ? 0 : lineEndAt(walk.text, before.end) + 1;
        const lineStarts = [...walk.text.matchAll(/^/gm)].map((match) => match.index).filter((lineStart) => lineStart >= searchFrom);
        const lineStart = lineStarts.find((candidate) => walk.text.slice(candidate, lineEndAt(walk.text, candidate)).trimEnd().endsWith(firstLine));

        const isFound = lineStart !== undefined && locateVerbatim(walk, lineStart, false);

        if (!isFound) {
            // Its source is not found: its units keep none, and the walk goes on after it.
            walk.at += unitsOfVerbatim(walk, verbatim).length;
        }

        verbatim = pendingRawBlock(walk);
    }
}

/**
 * Finds the source of each source node that shows nothing which the walk
 * stands at and no entry stands for — a link with no text has no leaf — as
 * the first place after the last found unit where the source holds the
 * Markdown the node saves. One that is not found keeps no source.
 *
 * @param walk - The units.
 */
function locateUnclaimedEmptySources(walk: UnitWalk): void {
    let node = pendingEmptySource(walk);

    while (node !== null) {
        const unit = walk.units[walk.at]!;
        const before = walk.units.slice(0, walk.at).reverse().find((other) => other.start !== NOT_FOUND);
        const source = node.getSource();
        const start = walk.text.indexOf(source, before?.end ?? 0);

        unit.start = start;
        unit.end = start === NOT_FOUND ? NOT_FOUND : start + source.length;
        walk.at += 1;
        node = pendingEmptySource(walk);
    }
}

/**
 * The source node that shows nothing which the walk stands at, if it
 * stands at one.
 *
 * @param walk - The units.
 * @returns The source node, or `null`.
 */
function pendingEmptySource(walk: UnitWalk): MarkdownSourceTextNode | null {
    const unit = walk.units[walk.at];
    const node = unit?.node;

    return unit?.char === "" && $isMarkdownSourceTextNode(node) ? node : null;
}

/**
 * The raw block the walk stands in, if it stands in one.
 *
 * @param walk - The units.
 * @returns The raw block, or `null`.
 */
function pendingRawBlock(walk: UnitWalk): ElementNode | null {
    const verbatim = walk.units[walk.at]?.verbatim ?? null;

    return $isMarkdownRawBlockNode(verbatim) ? verbatim : null;
}

/**
 * Finds the source of what a leaf entry shows: a character, a hard line
 * break, or an atom, which shows as a node of its own, as a source node,
 * or as nothing. A raw block no entry stands for is passed first.
 *
 * @param walk - The units.
 * @param entry - The leaf.
 */
function locateLeaf(walk: UnitWalk, entry: SourceEntry): void {
    const isBreak = entry.key === "br";
    const isText = entry.key.startsWith("t");

    locateUnclaimedRawBlocks(walk);

    if (isText) {
        locateUnclaimedEmptySources(walk);
    }

    const unit = walk.units[walk.at];
    const isOwnNode = unit !== undefined && unit.verbatim === null && (isBreak ? $isLineBreakNode(unit.node) : unit.char === "");

    if (isText) {
        locateCharacters(walk, entry);
    } else if (isOwnNode) {
        unit.start = entry.start;
        unit.end = entry.end;
        unit.inside = entry.ancestors;
        walk.at += 1;
    } else if (isBreak) {
        walk.isLost = true;
    } else {
        locateSourceNode(walk, entry.key.slice(entry.key.indexOf(":") + 1), entry.start, entry.end, entry.ancestors);
    }
}

/**
 * Finds the source of the characters a text leaf shows. A blank character
 * the block does not show — one a load trims, or joins to the one before
 * it — is passed over; any other character the block does not show there
 * loses the walk.
 *
 * @param walk - The units.
 * @param entry - The leaf.
 */
function locateCharacters(walk: UnitWalk, entry: SourceEntry): void {
    for (const char of entry.key.slice(1).split("")) {
        const unit = walk.units[walk.at];
        const isBlank = char === " " || char === "\t" || char === "\n";
        const isShown = unit !== undefined && unit.verbatim === null && (unit.char === char || (isBlank && unit.char === " "));
        const own = offsetInCodeSpan(walk, entry);

        if (isShown) {
            unit.start = own ?? entry.start;
            unit.end = own === null ? entry.end : own + 1;
            unit.inside = entry.ancestors;
            walk.at += 1;
        } else if (!isBlank) {
            walk.isLost = true;

            return;
        }
    }
}

/**
 * The source offset of the next character of a code span, whose leaves the
 * analysis all gives the span's own offsets ({@link offsetsOfCode}).
 *
 * @param walk - The units; counts the span's characters.
 * @param entry - The leaf.
 * @returns The offset, or `null` for a leaf of no code span, or of one whose characters are not found.
 */
function offsetInCodeSpan(walk: UnitWalk, entry: SourceEntry): number | null {
    const span = entry.ancestors[entry.ancestors.length - 1];

    if (span?.type !== "codespan" || span.innerStart === NOT_FOUND) {
        return null;
    }

    if (walk.code === span) {
        walk.codeAt += 1;
    } else {
        const shown = (span.token as Tokens.Codespan).text;

        walk.code = span;
        walk.codeAt = 0;

        // A code span drops one space at each end of its content when it holds one at both.
        walk.codeOffsets = offsetsOfCode(walk.text, span.innerStart, span.innerEnd, shown)
            ?? offsetsOfCode(walk.text, span.innerStart + 1, span.innerEnd - 1, shown);
    }

    return walk.codeOffsets?.[walk.codeAt] ?? null;
}

/**
 * Where each character a code span shows stands in the source between its
 * backticks: the span shows that text as written, a line end as a space.
 * On a line after the first the source holds the line's own prefix first
 * (a quote's `>`, a list item's indentation), which is no code, and in a
 * table cell a backslash before a `|`, which is none either.
 *
 * @remarks
 * How much of a line's start is its prefix is not told by the characters:
 * code may begin with a space or a `>` itself. So each length is tried,
 * the shortest first, and taken when all the code after it is then found.
 *
 * @param text - The block's Markdown.
 * @param from - The first offset of the written code, or of a line of it.
 * @param to - The offset past its last.
 * @param shown - The text the span shows from there on.
 * @param isLineHead - Whether `from` is the start of a line after the first.
 * @returns Each character's offset, or `null` when the source does not hold them so.
 */
function offsetsOfCode(text: string, from: number, to: number, shown: string, isLineHead: boolean = false): number[] | null {
    const lineEnd = Math.min(lineEndAt(text, from), to);
    const longest = isLineHead ? LINE_PREFIX.exec(text.slice(from, lineEnd))![0].length : 0;

    for (let prefix = 0; prefix <= longest; prefix += 1) {
        const line = offsetsOfCodeLine(text, from + prefix, lineEnd, shown);
        const rest = line === null ? "" : shown.slice(line.length);
        const isLast = lineEnd === to;
        // A line end shows as a space, and the code goes on after it.
        const after = line !== null && !isLast && rest.startsWith(" ") ? offsetsOfCode(text, lineEnd + 1, to, rest.slice(1), true) : null;

        if (line !== null && isLast && rest === "") {
            return line;
        }

        if (line !== null && after !== null) {
            return [...line, lineEnd, ...after];
        }
    }

    return null;
}

/**
 * Where the characters a code span shows of one source line stand in it:
 * the line from `from` on, character for character, without the backslash
 * of an escaped `|`.
 *
 * @param text - The block's Markdown.
 * @param from - The offset the line's code starts at.
 * @param lineEnd - The offset the line ends at.
 * @param shown - The text the span shows from there on.
 * @returns The offset of each character the line holds, or `null` when the line holds other text.
 */
function offsetsOfCodeLine(text: string, from: number, lineEnd: number, shown: string): number[] | null {
    const offsets: number[] = [];
    let at = from;

    for (const char of shown.split("")) {
        const isEscapedPipe = char === "|" && text[at] === "\\" && text[at + 1] === "|";

        at += isEscapedPipe ? 1 : 0;

        if (at >= lineEnd) {
            break;
        }

        if (text[at] !== char) {
            return null;
        }

        offsets.push(at);
        at += 1;
    }

    return at === lineEnd ? offsets : null;
}

/**
 * Finds the source of the units of a source node that saves `source`, when
 * the walk stands at one, and passes them: each character at its own place
 * where the node shows the source as it is written, a run of whitespace as
 * one space ({@link offsetsOfShown}), else all at the source's span. An
 * atom that shows nothing has no unit and is passed over.
 *
 * @param walk - The units.
 * @param source - The Markdown the node saves.
 * @param start - The source's first offset.
 * @param end - The offset past its last.
 * @param inside - The inline tokens around it.
 */
function locateSourceNode(walk: UnitWalk, source: string, start: number, end: number, inside: readonly SourceInline[]): void {
    const node = walk.units[walk.at]?.node;
    const isShown = $isMarkdownSourceTextNode(node) && node.getSource() === source;

    if (!isShown) {
        return;
    }

    const isWritten = start !== NOT_FOUND && walk.text.slice(start, end) === source;
    const offsets = isWritten ? offsetsOfShown(source, node.getTextContent()) : null;

    while (walk.units[walk.at]?.node === node) {
        const unit = walk.units[walk.at]!;
        const own = offsets?.[unit.offset];

        unit.start = own === undefined ? start : start + own;
        unit.end = own === undefined ? end : start + own + 1;
        unit.inside = inside;
        walk.at += 1;
    }
}

/**
 * Where each character a source node shows stands in its source: the node
 * shows the source as it is written, a run of whitespace as one space.
 *
 * @param source - The Markdown the node saves.
 * @param shown - The text it shows.
 * @returns Each shown character's offset in `source`, or `null` when the node shows other text.
 */
function offsetsOfShown(source: string, shown: string): number[] | null {
    const offsets: number[] = [];
    let at = 0;

    for (const char of shown.split("")) {
        const run = /^\s+/.exec(source.slice(at))?.[0].length ?? 0;
        const isRun = char === " " && run > 0;

        if (!isRun && source[at] !== char) {
            return null;
        }

        offsets.push(at);
        at += isRun ? run : 1;
    }

    return at === source.length ? offsets : null;
}

/**
 * Whether an inline token gives the text inside it a format or a link, and
 * its content is found in the source.
 *
 * @param inline - The token.
 * @returns Whether it does.
 */
function givesFormat(inline: SourceInline): boolean {
    const isFormat = MARK_LETTERS[inline.type] !== undefined || inline.type === "link" || inline.type === "styledspan";

    return isFormat && inline.innerStart !== NOT_FOUND;
}

/**
 * The place of an offset among a block's units: after every unit whose
 * source ends at or before the offset, before every other.
 *
 * @remarks
 * The analysis finds a token by searching for its text from the end of the
 * one before it, so text the lexer hands back otherwise than the source
 * holds it is either not found, or found further on, where other text
 * reads the same — and then the token whose text that was is not found in
 * its turn. A unit found further on than it stands would count as after
 * the offset while its source is before it. So a place is given only where
 * the unit before it is found and every unit after it is: then none of
 * them was found in another's place.
 *
 * @param units - The block's units.
 * @param offset - The offset in the block's Markdown.
 * @param text - The block's Markdown.
 * @param inlines - Its inline tokens.
 * @returns The place, or `null` when the offset is inside the source of several characters, the source of the unit before it or of a unit after it is not found, or the units' sources are not in the units' order.
 */
function $placeAmongUnits(units: readonly ShownUnit[], offset: number, text: string, inlines: readonly SourceInline[]): SourcePlace | null {
    const firstAfter = units.findIndex((unit) => unit.start !== NOT_FOUND && unit.end > offset);
    const index = firstAfter === -1 ? units.length : firstAfter;
    const before = units[index - 1];
    const after = units[index];
    const cut = units.filter((unit) => unit.start !== NOT_FOUND && unit.start < offset && offset < unit.end);
    const isOneThing = cut.every((unit) => unit.node === cut[0]!.node) && (cut.length <= 1 || $isMarkdownSourceTextNode(cut[0]!.node));
    const isBeforeFound = before === undefined || before.start !== NOT_FOUND;
    const isRestFound = units.slice(index).every((unit) => unit.start !== NOT_FOUND);
    const found = units.filter((unit) => unit.start !== NOT_FOUND);
    const isInOrder = found.every((unit, at) => at === 0 || found[at - 1]!.start <= unit.start);

    if (!isOneThing || !isBeforeFound || !isRestFound || !isInOrder) {
        return null;
    }

    const around = inlines.filter((inline) => givesFormat(inline) && inline.start < offset && offset < inline.end
        && inline.innerStart <= offset && offset <= inline.innerEnd);

    return $placeBetween(before, after, around, text, offset);
}

/**
 * The place between two units that stand side by side.
 *
 * @param before - The unit before the offset, if any.
 * @param after - The unit after it, if any.
 * @param around - The format-giving tokens the offset is inside.
 * @param text - The block's Markdown.
 * @param offset - The offset.
 * @returns The place, or `null` when there is no unit at all.
 */
function $placeBetween(
    before: ShownUnit | undefined, after: ShownUnit | undefined, around: readonly SourceInline[], text: string, offset: number,
): SourcePlace | null {
    // A unit that shows nothing has no character to stand after: the place is its node's only one.
    const endOfBefore = before !== undefined && $isTextNode(before.node) ? { node: before.node, offset: before.offset + before.char.length } : null;
    const startOfAfter = after !== undefined && $isTextNode(after.node) ? { node: after.node, offset: after.offset } : null;

    if (endOfBefore === null || startOfAfter === null) {
        return endOfBefore ?? startOfAfter ?? $placeBesideNode(before, after);
    }

    const isOneLine = $blockOf(before!.node) === $blockOf(after!.node);
    const isWithBefore = isOneLine ? isInFormatOf(before!, around, after!) : !BLOCK_END.test(text.slice(before!.end, offset));

    return isWithBefore ? endOfBefore : startOfAfter;
}

/**
 * Whether a place between two text units of one line belongs with the one
 * before it: both stand in one text node; or the one after is a source
 * node and the one before is not; or neither or both are, and the one
 * before has the format the offset has in the source.
 *
 * @param before - The unit before the offset.
 * @param around - The format-giving tokens the offset is inside.
 * @param after - The unit after the offset.
 * @returns Whether the place is at the end of `before`.
 */
function isInFormatOf(before: ShownUnit, around: readonly SourceInline[], after: ShownUnit): boolean {
    const isBeforeSource = $isMarkdownSourceTextNode(before.node);
    const isAfterSource = $isMarkdownSourceTextNode(after.node);

    if (before.node === after.node || isBeforeSource !== isAfterSource) {
        return before.node === after.node || isAfterSource;
    }

    const formats = before.inside.filter(givesFormat);

    return formats.length === around.length && formats.every((inline) => around.includes(inline));
}

/**
 * The nearest block around a node.
 *
 * @param node - The node.
 * @returns The block, or `null`.
 */
function $blockOf(node: LexicalNode): LexicalNode | null {
    return $findMatchingParent(node, (parent) => $isElementNode(parent) && !parent.isInline());
}

/**
 * The place beside a unit that is no text: after the one before the
 * offset, else before the one after it, as a child index of its parent.
 *
 * @param before - The unit before the offset, if any.
 * @param after - The unit after it, if any.
 * @returns The place, or `null` when there is neither.
 */
function $placeBesideNode(before: ShownUnit | undefined, after: ShownUnit | undefined): SourcePlace | null {
    const unit = before ?? after;
    const parent = unit?.node.getParent() ?? null;

    if (unit === undefined || parent === null) {
        return null;
    }

    return { node: parent, offset: unit.node.getIndexWithinParent() + (unit === before ? 1 : 0) };
}
