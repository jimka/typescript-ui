// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    $createParagraphNode, $createRangeSelection, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isRootNode, $isTextNode, $setSelection,
} from "lexical";
import type { ElementNode, LexicalNode } from "lexical";
import { $dfs } from "@lexical/utils";
import { lexMarkdownLinkDefinitions } from "~/component/display/markdownExtensions.js";
import { locateTopLevelBlocks } from "~/component/editor/markdownImporter.js";
import type { TopLevelBlock } from "~/component/editor/markdownImporter.js";
import type { WrittenBlockPlace } from "~/component/editor/markdownSerializer.js";
import type { MarkdownSourceMap } from "~/component/editor/markdownSourceMap.js";
import { $placeOfSourceOffset, $sourceOffsetOfPoint } from "~/component/editor/markdownSourcePlaces.js";
import type { SourcePlace } from "~/component/editor/markdownSourcePlaces.js";

/**
 * What a source-mode command imports: a stretch of the document, with the
 * definition blocks it carries before and after it.
 */
export interface SourceWindow {
    /** The stretch's start offset in the document. */
    readonly start:  number;
    /** The stretch's end offset in the document. */
    readonly end:    number;
    /** Definition blocks of the document before the stretch, each followed by a blank line; `""` when none. */
    readonly before: string;
    /** Definition blocks of the document after the stretch, each after a blank line; `""` when none. */
    readonly after:  string;
}

/** A replacement of one range of a text. */
export interface TextChange {
    /** The start offset of the replaced range. */
    readonly from:   number;
    /** The end offset of the replaced range. */
    readonly to:     number;
    /** The replacement. */
    readonly insert: string;
}

/** One top-level block of a loaded document, with where its source stands in the text the load read. */
interface LoadedBlockSpan {
    /** The block's node. */
    readonly block: LexicalNode;
    /** The start offset of its source in the imported text. */
    readonly start: number;
    /** The end offset of its source in the imported text. */
    readonly end:   number;
}

/** Separates a carried definition block from the text beside it: a blank line. */
const BLANK_LINE = "\n\n";

/** A UTF-16 high surrogate, the first code unit of a character outside the basic plane. */
const HIGH_SURROGATE = /[\uD800-\uDBFF]/;

/** A UTF-16 low surrogate, the second code unit of a character outside the basic plane. */
const LOW_SURROGATE = /[\uDC00-\uDFFF]/;

/**
 * The whole document as a window.
 *
 * @param text - The document.
 * @returns A window of all of it, carrying nothing.
 */
export function wholeDocumentWindow(text: string): SourceWindow {
    return { start: 0, end: text.length, before: "", after: "" };
}

/**
 * The window a command over `from`–`to` imports: the top-level blocks the
 * range touches and one on each side. A window that reaches the first block
 * starts at offset 0, and one that reaches the last ends at the document's
 * end, so the text around the document comes along. When the document
 * defines a link label, the definition blocks outside the window travel with
 * it as text, so the window reads its references as the document does; when
 * they cannot (a definition inside a list item or a quote), the window is
 * the whole document.
 *
 * @param text - The document, with `\n` line ends only.
 * @param from - The range's start offset.
 * @param to - The range's end offset.
 * @returns The window.
 */
export function sourceWindow(text: string, from: number, to: number): SourceWindow {
    const { blocks, definitions } = locateTopLevelBlocks(text);

    if (blocks.length === 0) {
        return wholeDocumentWindow(text);
    }

    const [first, last] = blocksAround(blocks, from, to);
    const start = first === 0 ? 0 : blocks[first]!.start;
    const end = last === blocks.length - 1 ? text.length : blocks[last]!.end;
    const hasDefinitions = Object.keys(definitions).length > 0;

    if (!hasDefinitions) {
        return { start, end, before: "", after: "" };
    }

    const before = blocks.slice(0, first).filter((block) => block.holdsOnlyDefinitions)
        .map((block) => text.slice(block.start, block.end) + BLANK_LINE).join("");

    const after = blocks.slice(last + 1).filter((block) => block.holdsOnlyDefinitions)
        .map((block) => BLANK_LINE + text.slice(block.start, block.end)).join("");

    const composed = before + text.slice(start, end) + after;
    const readsAsTheDocument = JSON.stringify(lexMarkdownLinkDefinitions(composed)) === JSON.stringify(definitions);

    return readsAsTheDocument ? { start, end, before, after } : wholeDocumentWindow(text);
}

/**
 * The indexes of the first and the last block a window imports: the blocks
 * the range touches, and one on each side.
 *
 * @param blocks - The document's top-level blocks, at least one.
 * @param from - The range's start offset.
 * @param to - The range's end offset.
 * @returns The first and the last index.
 */
function blocksAround(blocks: readonly TopLevelBlock[], from: number, to: number): [first: number, last: number] {
    const lastIndex = blocks.length - 1;
    const firstTouched = blocks.findIndex((block) => block.end >= from);
    const lastTouched = blocks.findLastIndex((block) => block.start <= to);
    const first = firstTouched === -1 ? lastIndex : firstTouched;
    const last = lastTouched === -1 ? 0 : lastTouched;

    return [Math.max(0, Math.min(first, last) - 1), Math.min(lastIndex, Math.max(first, last) + 1)];
}

/**
 * Where each top-level block of a load stands in the text the load read. A text with no block (empty, or blank
 * lines alone) is the one empty paragraph a load makes, whose span is the whole text; a last block that runs to the
 * end of the text (an unclosed code fence) owns the lines after it.
 *
 * @param sourceMap - The source map of the import.
 * @param length - The length of the imported text.
 * @returns The blocks in order, or `null` when the map does not account for every root child.
 */
function $loadedBlockSpans(sourceMap: MarkdownSourceMap, length: number): LoadedBlockSpan[] | null {
    const spans: LoadedBlockSpan[] = [];
    let at = sourceMap.latest.prefix.length;

    for (const block of $getRoot().getChildren()) {
        const entry = sourceMap.blocks.get(block.getKey());

        if (entry === undefined) {
            return null;
        }

        spans.push({ block, start: at, end: at + entry.body.length });
        at += entry.body.length + entry.after.length;
    }

    const last = spans[spans.length - 1];
    const isBlankText = sourceMap.latest.blockCount === 0 && spans.length === 1;

    if (isBlankText) {
        return [{ block: last!.block, start: 0, end: length }];
    }

    if (last !== undefined && sourceMap.latest.endsOpen) {
        spans[spans.length - 1] = { block: last.block, start: last.start, end: length };
    }

    return spans;
}

/**
 * The block whose source holds an offset, its end included.
 *
 * @param spans - The blocks' spans.
 * @param offset - The offset.
 * @returns The block's span, or `undefined` for an offset between blocks.
 */
function spanHolding(spans: readonly LoadedBlockSpan[], offset: number): LoadedBlockSpan | undefined {
    return spans.find((span) => span.start <= offset && offset <= span.end);
}

/**
 * The element a caret in a block that shows nothing stands in, found only where the block tells which it is: the
 * block's chain of single children down to the element with none (`-` is a list holding one item that holds
 * nothing). A block with more than one child on the way (three empty items, the cells of an empty table row, two
 * empty columns) has several such elements. The line of the caret does name one (line 2 of `-` / `-` / `-` is item 2), but working out which child that line is, for every container, is not done yet, so the caller declines.
 *
 * @param block - The block.
 * @returns The element, or `null` when the block has more than one way down.
 */
function soleEmptyElement(block: ElementNode): ElementNode | null {
    const size = block.getChildrenSize();
    const first = block.getFirstChild();

    if (size === 0) {
        return block;
    }

    return size === 1 && $isElementNode(first) ? soleEmptyElement(first) : null;
}

/**
 * The place of an offset in the block whose source holds it. A block that shows nothing (an empty heading, item,
 * quote or code block, or the empty paragraph of an empty document) has no shown character to stand beside, and its
 * place is the empty element in it, where a user's caret there stands, when the block has just one; a block with
 * several (empty items on several lines) has no place yet: the offset's line names the child, but the code does not work out which it is.
 *
 * @param text - The imported text.
 * @param spans - The blocks' spans.
 * @param offset - The offset.
 * @returns The place, or `null` when no block holds the offset or the block has no place there.
 */
function $placeInSpans(text: string, spans: readonly LoadedBlockSpan[], offset: number): SourcePlace | null {
    const span = spanHolding(spans, offset);

    if (span === undefined) {
        return null;
    }

    const place = $placeOfSourceOffset(text, offset, span.block, span.start, span.end);

    if (place !== null || !$isElementNode(span.block)) {
        return place;
    }

    const showsNothing = $dfs(span.block).every((entry) => $isElementNode(entry.node));
    const element = showsNothing ? soleEmptyElement(span.block) : null;

    return element === null ? null : { node: element, offset: 0 };
}

/**
 * The place of a collapsed caret on the blank lines after the last block: a new, empty last paragraph. A command run
 * with the caret on the empty line after the last block acts on a new block there, as it would on the empty line a
 * user types on (the WYSIWYG surface has no such line until a block is made).
 *
 * @param text - The imported text.
 * @param spans - The blocks' spans.
 * @param offset - The offset.
 * @returns The place in the paragraph added, or `null` when the offset is not after the last block's source.
 */
function $placeAfterLastBlock(text: string, spans: readonly LoadedBlockSpan[], offset: number): SourcePlace | null {
    const last = spans[spans.length - 1];
    const isAfterLast = last !== undefined && offset > last.end && text.slice(last.end).trim() === "";

    if (!isAfterLast) {
        return null;
    }

    const paragraph = $createParagraphNode();

    $getRoot().append(paragraph);

    return { node: paragraph, offset: 0 };
}

/**
 * Places an offset in a model whose root does not pair block for block with the import's source map, because a
 * transform split a block the import built whole (`> a` over `<div` is a quote and a raw block). The start of the
 * first block is the only start known (the end of the text before it), so only a document of one located block is
 * placed, in the first root block whose shown text reaches the offset; an offset before that start is placed
 * nowhere, as on the paired path.
 *
 * @param text - The imported text.
 * @param start - Where the first block starts.
 * @param offset - The offset.
 * @returns The place, or `null` when no block places it.
 */
function $placeInUnpairedBlocks(text: string, start: number, offset: number): SourcePlace | null {
    if (offset < start) {
        return null;
    }

    for (const child of $getRoot().getChildren()) {
        const place = $isElementNode(child) ? $placeOfSourceOffset(text, offset, child, start, text.length) : null;
        const reach = place === null
            ? null
            : $sourceOffsetOfPoint(text, child, start, text.length, { node: child, offset: (child as ElementNode).getChildrenSize(), type: "element" });
        const isReached = reach !== null && offset <= reach;

        if (place !== null && isReached) {
            return place;
        }
    }

    return null;
}

/**
 * Moves the two ends of a range that stand between blocks inward: the start
 * to the next block's start, the end to the previous block's end.
 *
 * @param spans - The blocks' spans.
 * @param from - The range's start offset.
 * @param to - The range's end offset.
 * @returns The offsets, or `null` when the range lies wholly between blocks.
 */
function movedInward(spans: readonly LoadedBlockSpan[], from: number, to: number): { from: number; to: number } | null {
    const startHolder = spanHolding(spans, from);
    const endHolder = spanHolding(spans, to);
    const nextStart = startHolder === undefined ? spans.find((span) => span.start > from)?.start : from;
    const previousEnd = endHolder === undefined ? spans.findLast((span) => span.end < to)?.end : to;

    if (nextStart === undefined || previousEnd === undefined || nextStart > previousEnd) {
        return null;
    }

    return { from: nextStart, to: previousEnd };
}

/**
 * Selects, in the tree an import of `text` just built, the range a source
 * selection `from`–`to` covers, and may add one block to the tree to do it.
 *
 * - An end that stands between blocks moves inward (the start to the next
 *   block, the end to the previous one); a collapsed caret between blocks, or
 *   before the first, has no place.
 * - A caret in a block that shows nothing (an empty heading, item, quote or
 *   code block; a text of blank lines alone) stands in the empty element of
 *   that block, when it has just one; a block with several (three empty
 *   items) is not worked out yet, and the selection has no place.
 * - A collapsed caret on the blank lines after the last block, whose source
 *   does not run on to the end of the text, gets a new empty paragraph
 *   appended as the last block, and stands in it. A command run there acts on
 *   a new block, as it would on the empty line a user types on.
 * - When a transform split a block the import built whole and the map no
 *   longer pairs with the root, the selection is placed only if the text is
 *   that one block.
 *
 * @param text - The imported text.
 * @param sourceMap - The source map of the import.
 * @param from - The selection's start offset in `text`.
 * @param to - The selection's end offset in `text`.
 * @returns `false`, selecting nothing, when an end has no place.
 */
export function $selectSourceRange(text: string, sourceMap: MarkdownSourceMap, from: number, to: number): boolean {
    const spans = $loadedBlockSpans(sourceMap, text.length);
    const range = spans === null || from === to ? { from, to } : movedInward(spans, from, to);
    const isUnpaired = spans === null && sourceMap.latest.blockCount === 1;

    if (range === null || (spans === null && !isUnpaired)) {
        return false;
    }

    const placeOf = (offset: number): SourcePlace | null => {
        if (spans === null) {
            return $placeInUnpairedBlocks(text, sourceMap.latest.prefix.length, offset);
        }

        const inBlock = $placeInSpans(text, spans, offset);
        const isCaret = from === to && inBlock === null;

        return isCaret ? $placeAfterLastBlock(text, spans, offset) : inBlock;
    };

    const anchor = placeOf(range.from);
    const focus = from === to ? anchor : placeOf(range.to);

    if (anchor === null || focus === null) {
        return false;
    }

    const selection = $createRangeSelection();

    selection.anchor.set(anchor.node.getKey(), anchor.offset, $isTextNode(anchor.node) ? "text" : "element");
    selection.focus.set(focus.node.getKey(), focus.offset, $isTextNode(focus.node) ? "text" : "element");
    $setSelection(selection);

    return true;
}

/**
 * The top-level block a node stands in.
 *
 * @param node - The node.
 * @returns The child of the root that holds it. A shadow root such as a column is walked past.
 */
function topLevelBlockOf(node: LexicalNode): LexicalNode {
    let block = node;
    let parent = block.getParent();
    let isInsideBlock = parent !== null && !$isRootNode(parent);

    while (isInsideBlock) {
        block = parent!;
        parent = block.getParent();
        isInsideBlock = parent !== null && !$isRootNode(parent);
    }

    return block;
}

/**
 * The current range selection as offsets into a save.
 *
 * @param written - The save.
 * @param places - Where the save wrote each top-level block.
 * @returns The selection's anchor and focus as `from` and `to`, each `null` when no exact offset stands there; `null` when the selection is not a range.
 */
export function $sourceRangeOfSelection(
    written: string, places: readonly WrittenBlockPlace[],
): { readonly from: number | null; readonly to: number | null } | null {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return null;
    }

    const offsetOf = (point: typeof selection.anchor): number | null => {
        const node = point.getNode();
        const block = topLevelBlockOf(node);
        const place = places.find((entry) => entry.key === block.getKey());

        return place === undefined
            ? null
            : $sourceOffsetOfPoint(written, block, place.start, place.end, { node, offset: point.offset, type: point.type });
    };

    return { from: offsetOf(selection.anchor), to: offsetOf(selection.focus) };
}

/**
 * The text between the common start and the common end of two texts, as a
 * change of the first. Neither end of the change splits a surrogate pair.
 *
 * @param before - The text before.
 * @param after - The text after.
 * @returns The change, or `null` when the texts are equal.
 */
export function smallestEdit(before: string, after: string): TextChange | null {
    if (before === after) {
        return null;
    }

    const shortest = Math.min(before.length, after.length);
    let prefix = 0;

    while (prefix < shortest && before[prefix] === after[prefix]) {
        prefix += 1;
    }

    // The start may not cut a pair in two: back off to before its high surrogate.
    const endsInHighSurrogate = prefix > 0 && HIGH_SURROGATE.test(before[prefix - 1]!);

    if (endsInHighSurrogate) {
        prefix -= 1;
    }

    let suffix = 0;

    while (suffix < shortest - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) {
        suffix += 1;
    }

    // The end may not cut a pair in two either: back off past its low surrogate.
    const startsWithLowSurrogate = suffix > 0 && LOW_SURROGATE.test(before[before.length - suffix]!);

    if (startsWithLowSurrogate) {
        suffix -= 1;
    }

    return { from: prefix, to: before.length - suffix, insert: after.slice(prefix, after.length - suffix) };
}
