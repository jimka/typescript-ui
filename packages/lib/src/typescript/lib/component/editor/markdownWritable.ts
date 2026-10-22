// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    $addUpdateTag, $createParagraphNode, $createRangeSelection, $createTextNode, $findMatchingParent, $formatText, $getNodeByKey, $getRoot,
    $getSelection, $getState,
    $hasUpdateTag, COMMAND_PRIORITY_CRITICAL, CUT_COMMAND, DELETE_CHARACTER_COMMAND, DELETE_LINE_COMMAND, DELETE_WORD_COMMAND, DROP_COMMAND,
    INSERT_PARAGRAPH_COMMAND, PASTE_COMMAND, REMOVE_TEXT_COMMAND, SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, TEXT_TYPE_TO_FORMAT,
    $isDecoratorNode, $isElementNode, $isLineBreakNode, $isParagraphNode, $isRangeSelection, $isRootNode, $isTextNode,
    $parseSerializedNode, $setSelection, $setState, COMMAND_PRIORITY_HIGH, HISTORIC_TAG, INSERT_LINE_BREAK_COMMAND,
    ParagraphNode, RootNode, TextNode,
} from "lexical";
import type {
    EditorState, ElementNode, LexicalEditor, LexicalNode, PointType, RangeSelection, SerializedElementNode,
    SerializedLexicalNode, TextFormatType,
} from "lexical";
import type { Links, Tokens } from "marked";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $createListItemNode, $isListItemNode, $isListNode, ListItemNode, ListNode } from "@lexical/list";
import {
    $computeTableMapSkipCellCheck, $createTableCellNode, $isTableCellNode, $isTableNode, $isTableRowNode, $isTableSelection, TableCellNode,
    TableNode, TableRowNode,
} from "@lexical/table";
import type { TableSelection } from "@lexical/table";
import { $isLinkNode, LinkNode } from "@lexical/link";
import { $dfs, $unwrapAndFilterDescendants, $unwrapNode, mergeRegister } from "@lexical/utils";
import { lexMarkdownLinkDefinitions, lexMarkdownWithDefinitions } from "~/component/display/markdownExtensions.js";
import {
    $continuesItemBefore, $definitionsSource, $headingWritesOneLine, $listReadsLoose, $rawBlockWritesAsParagraph, $readsBackAsShown, $runsReadingOtherwise,
    $serializeBlock, $writtenListMarker, keptImageShown, rawBlockStandsInItem,
} from "~/component/editor/markdownSerializer.js";
import { $isMarkdownImageNode } from "~/component/editor/markdownImageNode.js";
import { keptSourceState, listLooseState, nestedLinkState, spanAttributesState } from "~/component/editor/markdownNodeState.js";
import { $isMarkdownBlockNode, MarkdownColumnNode } from "~/component/editor/markdownBlockNode.js";
import { $isReferenceLinkNode } from "~/component/editor/markdownReferenceLinkNode.js";
import {
    $buildInlineContent, $readBlocksWithDefinitions, $readRawBlockAsBlocks, MARKDOWN_IMPORT_TAG,
} from "~/component/editor/markdownImporter.js";
import {
    $isMarkdownRawBlockNode, $isMarkdownSourceTextNode, MarkdownRawBlockNode, MarkdownSourceTextNode,
} from "~/component/editor/markdownSourceNodes.js";
import { $isCodeNode } from "@lexical/code";

/**
 * The deepest ATX heading level the save can write as setext, the only
 * heading form whose content can span lines; deeper headings are one line.
 */
const SETEXT_MAX_LEVEL = 2;

/** The highest number a CommonMark ordered list marker can write: nine digits. */
const MAX_ORDERED_LIST_NUMBER = 999_999_999;

/**
 * Registers the rules that keep the editor from making what a save cannot
 * write, so what the editor shows is what is saved: lists keep apart where
 * their markers differ and keep a looseness their save can write
 * ({@link registerMarkdownListTransforms}), no line break stands where
 * Markdown has none ({@link registerLineBreakRules}), a table stays
 * rectangular and aligned by column ({@link registerTableRules}), a raw
 * block the save writes as a paragraph, or as several blocks, shows as
 * them ({@link registerRawBlockRules}), a block whose source kept as written
 * reads differently once the document's link reference definitions change
 * shows as it now reads ({@link registerDefinitionRules}), no bold, italic or strikethrough is
 * left where its delimiter cannot stand at a run's edge by a deletion, a
 * paste, a split or typing, and a construct kept as written that an edit
 * takes apart shows as the ordinary text it saves as
 * ({@link registerRunEdgeRules}), and a bracket in styled text or a `+` in
 * underlined text shows without them ({@link $keepUnwritableCharactersPlain}),
 * a `:::` column stands only in its fence ({@link $keepColumnInFence}), and
 * no block stays inside a block that holds text only ({@link $keepBlocksOutOfText}).
 * Call right after creating the editor, before any document is loaded.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
export function registerWritableStateRules(editor: LexicalEditor): () => void {
    return mergeRegister(
        registerMarkdownListTransforms(editor), registerLineBreakRules(editor), registerTableRules(editor), registerRawBlockRules(editor),
        registerDefinitionRules(editor), registerRunEdgeRules(editor), editor.registerNodeTransform(TextNode, $keepUnwritableCharactersPlain),
        editor.registerNodeTransform(MarkdownColumnNode, $keepColumnInFence),
        ...[ParagraphNode, HeadingNode, QuoteNode].map((klass) => editor.registerNodeTransform(klass, $keepBlocksOutOfText)),
    );
}

/**
 * Keeps the one rule for a block inside a block that holds text only: it
 * never stays there. A paragraph, heading or quote that has come to hold
 * blocks keeps the text before the first of them, and what follows it — each
 * block, and the text between blocks in paragraphs — is moved out to follow
 * it, in order ({@link $moveBlocksOutAfter}). A code block and a raw block
 * do the same before they flatten what is left to text. In a table cell,
 * which holds paragraphs of text only, every block becomes paragraphs of
 * the cell ({@link $keepCellParagraphs}).
 *
 * A block gets there when a list item holding blocks is joined to the block
 * before it (Backspace at the item's start, Delete at that block's end, a
 * range deleted from that block into the item): Lexical moves all of the
 * item's children over. A save would write such a block's text into the
 * line around it.
 *
 * @param container - The paragraph, heading or quote that changed.
 */
function $keepBlocksOutOfText(container: ElementNode): void {
    const cell = container.getParent();

    if ($isTableCellNode(cell)) {
        $keepCellParagraphs(cell);
    } else {
        $moveBlocksOutAfter(container);
    }
}

/**
 * Moves the blocks standing in a block that holds text only out of it, to
 * follow it as blocks of their own, in order; text after such a block
 * follows it in a paragraph. The block keeps the text before its first
 * block.
 *
 * @param container - The block holding text only.
 */
export function $moveBlocksOutAfter(container: ElementNode): void {
    const moved = $takeBlocksOutOf(container);

    moved.reduce<LexicalNode>((previous, block) => previous.insertAfter(block), container);
}

/**
 * Takes out of an element its first block child and everything after it,
 * as blocks: each block as it is, each run of text between or after them in
 * a paragraph.
 *
 * @param container - The element.
 * @returns The blocks, detached, in order; none when it holds no block.
 */
export function $takeBlocksOutOf(container: ElementNode): LexicalNode[] {
    const children = container.getChildren();
    const firstBlock = children.findIndex($isBlock);
    const blocks: LexicalNode[] = [];
    let textAfterBlock: ElementNode | null = null;

    for (const child of firstBlock === -1 ? [] : children.slice(firstBlock)) {
        const isBlock = $isBlock(child);

        if (!isBlock && textAfterBlock === null) {
            textAfterBlock = $createParagraphNode();
            blocks.push(textAfterBlock);
        }

        if (isBlock) {
            child.remove();
            blocks.push(child);
            textAfterBlock = null;
        } else {
            textAfterBlock!.append(child);
        }
    }

    return blocks;
}

/**
 * Tells whether a node is a block: an element that is not inline.
 *
 * @param node - The node.
 * @returns `true` for a block.
 */
export function $isBlock(node: LexicalNode): node is ElementNode {
    return $isElementNode(node) && !node.isInline();
}

/**
 * Builds a node from its serialized form as Lexical's `$parseSerializedNode`
 * does, except that a list item keeps the paragraphs it holds. Lexical
 * appends each child with its parent's own `append`, and a list item's
 * merges a paragraph's children into the item: an item's text and the
 * paragraphs after it would come back as one line of text. Here only a
 * paragraph that opens an item is merged, as its text, which is what a list
 * copied from inside an item's first paragraph holds. Must run inside an
 * `editor.update`.
 *
 * @param serialized - The serialized node.
 * @returns The node, detached.
 */
export function $parseKeepingItemParagraphs(serialized: SerializedLexicalNode): LexicalNode {
    const children = (serialized as Partial<SerializedElementNode>).children;

    if (children === undefined) {
        return $parseSerializedNode(serialized);
    }

    // Built without its children, which Lexical would append to it one by one.
    const node = $parseSerializedNode({ ...serialized, children: [] } as SerializedLexicalNode);

    if (!$isElementNode(node)) {
        return node;
    }

    for (const child of children.map($parseKeepingItemParagraphs)) {
        const isKeptParagraph = $isListItemNode(node) && $isParagraphNode(child) && !node.isEmpty();

        if (isKeptParagraph) {
            // `splice` puts the paragraph in as it is.
            node.splice(node.getChildrenSize(), 0, [child]);
        } else {
            node.append(child);
        }
    }

    return node;
}

// ---------------------------------------------------------------- lists

/**
 * Keeps a list item that opens with a paragraph as its save reads: the
 * paragraph's content is the item's text. Markdown has no item whose first
 * line is empty over a paragraph, so an item left that way — its own text
 * deleted, or a new item an Enter at the end of the text put the item's
 * paragraphs in — is saved, and reloads, as an item of that text.
 *
 * @param item - The list item that changed.
 */
function $keepOpeningParagraphAsText(item: ListItemNode): void {
    const first = item.getFirstChild();

    if ($isParagraphNode(first)) {
        item.splice(0, 1, first.getChildren());
    }
}

/**
 * Moves a nested list item one level out, as Lexical's outdent does, keeping
 * the blocks the outer item holds after the nested list. Those blocks stand
 * in the item node that holds the nested list, which Lexical removes with
 * all it holds once the list is empty, or replaces by the item when it
 * splits the list around it. So they are moved first: into `item` when it is
 * the list's last, which they then follow out as its blocks, and otherwise
 * to the end of the item node that holds the list's last item afterwards.
 * Either way they stay where they were read: after everything the nested
 * list held.
 *
 * @param item - A list item nested in another.
 */
export function $outdentItemKeepingBlocks(item: ListItemNode): void {
    const list = item.getParentOrThrow();
    const last = list.getLastChild();
    const isHeldByItem = $isListItemNode(list.getParent());
    const blocks = isHeldByItem ? list.getNextSiblings() : [];
    const followItem = item.is(last);

    if (followItem) {
        item.splice(item.getChildrenSize(), 0, blocks);
    } else {
        blocks.forEach((block) => block.remove());
    }

    item.setIndent(item.getIndent() - 1);

    const holder = followItem || last === null ? null : last.getParentOrThrow().getParent();

    if ($isListItemNode(holder)) {
        holder.splice(holder.getChildrenSize(), 0, blocks);
    }
}

/**
 * Replaces `@lexical/list`'s own `ListNode` transform, which joins a list
 * with the next one of its type whatever their markers, by
 * {@link $normalizeList}, and keeps each list's looseness to what its save
 * can write as an item changes.
 *
 * @remarks
 * A change of bullet character or ordered delimiter starts a new list in
 * Markdown (`- a` then `+ b`), so the editor must keep such lists apart, but
 * the class's own transform cannot be turned off through a public API:
 * `getRegisteredNode` is `@internal`. Right after `createEditor`, the set of
 * `ListNode` transforms holds only that one (no plugin has added any), so it
 * is cleared and {@link $normalizeList} takes its place.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerMarkdownListTransforms(editor: LexicalEditor): () => void {
    editor.getRegisteredNode(ListNode).transforms.clear();

    return mergeRegister(
        editor.registerNodeTransform(ListNode, $normalizeList),
        editor.registerNodeTransform(ListItemNode, (item) => {
            const list = item.getParent();

            $keepOpeningParagraphAsText(item);

            if ($isListNode(list)) {
                $keepLoosenessWritable(list);
            }
        }),
        editor.registerNodeTransform(TextNode, $keepLoosenessAfterTyping),
        // A deletion that empties a block removes its text node, so no text transform runs for it.
        editor.registerNodeTransform(ParagraphNode, $keepLoosenessOfItemHolding),
        editor.registerNodeTransform(MarkdownRawBlockNode, $keepLoosenessOfItemHolding),
    );
}

/**
 * Keeps a list's looseness writable as a block of one of its items changes:
 * a paragraph or raw block a deletion empties writes nothing, so its item
 * holds one block less.
 *
 * @param block - The paragraph or raw block that changed.
 */
function $keepLoosenessOfItemHolding(block: ElementNode): void {
    const item = block.getParent();
    const list = $isListItemNode(item) ? item.getParent() : null;

    if ($isListNode(list)) {
        $keepLoosenessWritable(list);
    }
}

/**
 * Keeps a list's looseness writable as text is typed or deleted in it, where
 * that can change whether a block of an item writes anything: in a block
 * nested in an item (a paragraph after its nested list), or anywhere in a
 * list of one item, whose looseness needs an item of two blocks. Other text
 * leaves the looseness alone, so typing in a long list costs nothing here.
 *
 * @param text - The text node that changed.
 */
function $keepLoosenessAfterTyping(text: TextNode): void {
    const item = $findMatchingParent(text, $isListItemNode);
    const list = item?.getParent();

    // Two children at most: one item, and the item holding its nested list.
    if ($isListNode(list) && ($isParagraphNode(text.getParent()) || list.getChildrenSize() <= 2)) {
        $keepLoosenessWritable(list);
    }
}

/**
 * The `ListNode` transform: does what `@lexical/list`'s own one does — joins
 * the next list into this one when it is of the same type, numbers the
 * items — except that two lists whose saves write different markers
 * ({@link $writtenListMarker}) stay apart, as Markdown reads them, and so do
 * the lists a load builds; it also keeps the list's looseness writable
 * ({@link $keepLoosenessWritable}), and leaves no list without an item
 * ({@link $keepNoListWithoutItem}).
 *
 * @param list - The list that changed.
 */
function $normalizeList(list: ListNode): void {
    const isEmptied = list.isEmpty() && !$hasUpdateTag(MARKDOWN_IMPORT_TAG);

    if (isEmptied) {
        $keepNoListWithoutItem(list);

        return;
    }

    const next = list.getNextSibling();
    const joins = $isListNode(next) && next.getListType() === list.getListType() && $writtenListMarker(next) === $writtenListMarker(list);

    // Lists a load builds apart are apart in the viewer too (an empty item ends a list), so a load joins none.
    if (joins && !$hasUpdateTag(MARKDOWN_IMPORT_TAG)) {
        $joinLists(list, next);
    }

    $keepNumbersWritable(list);
    $numberListItems(list);
    $keepLoosenessWritable(list);
}

/**
 * Deals with a list an edit left with no item, which no save can write. A
 * range from a list item's text to the end of a block the item holds takes
 * the item with it when it is removed, where a range over two items leaves
 * the first, empty. So where the caret was left on the list, the list gets
 * an empty item holding the caret, as it has after that other range;
 * otherwise (typing, Enter or a paste went on from the removal and put the
 * caret elsewhere) the list is removed.
 *
 * @param list - A list with no item.
 */
function $keepNoListWithoutItem(list: ListNode): void {
    const selection = $getSelection();
    const holdsCaret = $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.getNode().is(list);

    if (holdsCaret) {
        const item = $createListItemNode();

        list.append(item);
        item.select();
    } else {
        list.remove();
    }
}

/**
 * Lowers an ordered list's start so its last item's number has at most the
 * nine digits a CommonMark ordered list marker allows: an item Enter or a
 * paste adds after `999999999.` would otherwise be numbered with ten, which
 * Markdown reads as text, not as an item.
 *
 * @param list - The list.
 */
function $keepNumbersWritable(list: ListNode): void {
    if (list.getListType() !== "number") {
        return;
    }

    const numbered = list.getChildren().filter((item) => $isListItemNode(item) && !$continuesItemBefore(item)).length;
    const highestStart = Math.max(0, MAX_ORDERED_LIST_NUMBER - Math.max(0, numbered - 1));

    if (list.getStart() > highestStart) {
        list.setStart(highestStart);
    }
}

/**
 * Appends a list's items to the list before it and removes it, joining the
 * nested lists where the first list's last item and the second's first item
 * both hold one — `@lexical/list`'s own join, which it does not export.
 *
 * @param list - The list to join into.
 * @param next - The list after it.
 */
function $joinLists(list: ListNode, next: ListNode): void {
    const last = list.getLastChild();
    const first = next.getFirstChild();
    const bothNested = $continuesItemBefore(last) && $continuesItemBefore(first);

    if (bothNested) {
        $joinLists(last.getFirstChild() as ListNode, first.getFirstChild() as ListNode);
        first.remove();
    }

    list.append(...next.getChildren());
    next.remove();
}

/**
 * Numbers a list's items from its start, as `@lexical/list`'s transform
 * does: an item holding only a nested list takes no number of its own.
 *
 * @param list - The list.
 */
function $numberListItems(list: ListNode): void {
    let value = list.getStart();

    for (const item of list.getChildren()) {
        if (!$isListItemNode(item)) {
            continue;
        }

        if (item.getValue() !== value) {
            item.setValue(value);
        }

        if (!$continuesItemBefore(item)) {
            value += 1;
        }
    }
}

/**
 * Sets a list's looseness to what its save reads as ({@link $listReadsLoose}):
 * a list left with one item of one block cannot be loose in Markdown, and a
 * list whose item holds a block after its nested list always is.
 *
 * @param list - The list.
 */
function $keepLoosenessWritable(list: ListNode): void {
    const loose = $listReadsLoose(list);

    if ($getState(list, listLooseState) !== loose) {
        $setState(list, listLooseState, loose);
    }
}

/**
 * A blank line in a link title: a line break, then whitespace alone up to
 * the next one. Mirrors the serializer's own, which keeps a reference with
 * such a title in its reference form.
 */
const BLANK_LINE_IN_TITLE = /\n[ \t]*\n/;

// ---------------------------------------------------------------- tables

/**
 * Registers the table rules. A pipe table is rectangular and aligned by
 * column — its delimiter row carries one alignment per column — but an edit
 * can leave a row short of the others (a range deleted across cells) or a
 * cell with an alignment of its own (cells pasted from another table).
 * `registerTablePlugin`'s own `TableNode` transform pads short rows, but only
 * when the table itself changes, so a change to a row or a cell marks its
 * table changed; and {@link $alignCellsByColumn} keeps the table to rows
 * of cells (a paste can land in a row a cell spans down into), gives each
 * body cell its column's alignment, the header cell's, as the save writes
 * it, keeps a row span inside the table, and splits a header cell spanning
 * columns or rows (the header row is never merged in Markdown) into the
 * cells it covers.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerTableRules(editor: LexicalEditor): () => void {
    const markTableChanged = (node: LexicalNode): void => {
        const table = $findMatchingParent(node, $isTableNode);

        if (table !== null) {
            table.markDirty();
        }
    };

    return mergeRegister(
        editor.registerNodeTransform(TableNode, $alignCellsByColumn),
        editor.registerNodeTransform(TableRowNode, markTableChanged),
        editor.registerNodeTransform(TableCellNode, (cell) => {
            $keepCellParagraphs(cell);
            markTableChanged(cell);
        }),
    );
}

/**
 * Turns every block in a table cell other than a paragraph of text into the
 * paragraphs the save writes it as: a pipe table's cell holds lines of
 * inline content only, so a heading, quote or code block pasted there is
 * written as its inline content, a list as each item's text and each of its
 * blocks on a line of its own, and a block that has come to stand inside a
 * paragraph of the cell likewise — never as the block it shows.
 *
 * @param cell - The table cell.
 */
function $keepCellParagraphs(cell: TableCellNode): void {
    for (const child of cell.getChildren()) {
        const isTextParagraph = $isParagraphNode(child) && !child.getChildren().some($isBlock);
        const isBlockToWrite = !isTextParagraph && $isElementNode(child);

        if (!isBlockToWrite) {
            continue;
        }

        const lines = $cellLines(child);
        // A block holding nothing leaves the empty paragraph it is written as; a list of empty items leaves none.
        const written = lines.length > 0 || $isListNode(child) ? lines : [$createParagraphNode()];

        written.reduce<LexicalNode>((previous, line) => previous.insertAfter(line), child);
        child.remove();
    }
}

/**
 * The paragraphs a block in a table cell is written as: one per run of
 * inline content it holds at any depth, in order — a list's item text, each
 * block of an item, each nested list's items, a quote's or heading's text.
 *
 * @param block - The block.
 * @returns The paragraphs, holding the block's own inline nodes.
 */
function $cellLines(block: ElementNode): ParagraphNode[] {
    const lines: ParagraphNode[] = [];
    let run: LexicalNode[] = [];

    const flush = (): void => {
        if (run.length > 0) {
            lines.push($createParagraphNode().append(...run));
        }

        run = [];
    };

    for (const child of block.getChildren()) {
        if ($isBlock(child)) {
            flush();
            lines.push(...$cellLines(child));
        } else {
            run.push(child);
        }
    }

    flush();

    return lines;
}

/**
 * Gives each body cell of a table the alignment of the column it starts in
 * (once the table holds only rows of cells, {@link $keepRowsOfCells}):
 * the header cell's there, which is what the save's delimiter row writes;
 * keeps a cell from spanning rows past the table's last row, or onto a cell
 * of a lower row ({@link $keepRowSpansClear}); and splits a header cell that
 * spans ({@link $unmergeHeaderCells}).
 *
 * @param table - The table.
 */
function $alignCellsByColumn(table: TableNode): void {
    $keepRowsOfCells(table);

    const rows = table.getChildren().filter($isTableRowNode);

    // A cell cannot span past the last row: the save writes no row for it to continue into.
    rows.forEach((row, index) => {
        for (const cell of row.getChildren().filter($isTableCellNode)) {
            if (index + cell.getRowSpan() > rows.length) {
                cell.setRowSpan(rows.length - index);
            }
        }
    });

    $keepRowSpansClear(rows);
    $unmergeHeaderCells(table, rows);

    const [map] = $computeTableMapSkipCellCheck(table, null, null);
    const header = map[0] ?? [];

    for (const row of map.slice(1)) {
        for (const value of row) {
            // A position a row too short leaves empty under a cell spanning down from above: the table plugin pads it.
            if (value === undefined) {
                continue;
            }

            const alignment = header[value.startColumn]?.cell.getFormatType() ?? "";

            if (value.startRow > 0 && value.cell.getFormatType() !== alignment) {
                value.cell.setFormat(alignment);
            }
        }
    }
}

/** A cell's place in the grid {@link $keepRowSpansClear} lays out. */
interface PlacedCell {
    readonly cell:        TableCellNode;
    readonly startRow:    number;
    readonly startColumn: number;
}

/**
 * Keeps each cell spanning rows from reaching down onto a cell of a lower
 * row, shortening its span to the rows above that cell. Cells are laid out
 * as the table map lays them out — each in the first column of its row no
 * span from above covers — so an edit that removes a cell from a row a span
 * starts in (a range deleted across cells) moves the span over a cell below,
 * which the table would then hold twice over, and the save could not write.
 *
 * @param rows - The table's rows.
 */
function $keepRowSpansClear(rows: readonly TableRowNode[]): void {
    const claimed: Array<Array<PlacedCell | undefined>> = rows.map(() => []);

    rows.forEach((row, index) => {
        let column = 0;

        for (const cell of row.getChildren().filter($isTableCellNode)) {
            while (claimed[index]![column] !== undefined) { column += 1; }

            for (let at = column; at < column + cell.getColSpan(); at++) {
                const above = claimed[index]![at];

                if (above !== undefined) {
                    $endRowSpanAbove(claimed, above, index);
                }
            }

            const placed: PlacedCell = { cell, startRow: index, startColumn: column };

            for (let spanned = index; spanned < Math.min(rows.length, index + cell.getRowSpan()); spanned++) {
                for (let at = column; at < column + cell.getColSpan(); at++) { claimed[spanned]![at] = placed; }
            }

            column += cell.getColSpan();
        }
    });
}

/**
 * Ends a cell's row span just above `row`, releasing the positions it
 * claimed from that row down.
 *
 * @param claimed - Each row's positions and the cell claiming each.
 * @param placed - The spanning cell.
 * @param row - The first row it no longer spans.
 */
function $endRowSpanAbove(claimed: Array<Array<PlacedCell | undefined>>, placed: PlacedCell, row: number): void {
    const { cell, startRow, startColumn } = placed;

    for (let spanned = row; spanned < Math.min(claimed.length, startRow + cell.getRowSpan()); spanned++) {
        for (let at = startColumn; at < startColumn + cell.getColSpan(); at++) { claimed[spanned]![at] = undefined; }
    }

    cell.setRowSpan(row - startRow);
}

/**
 * Keeps a table to rows, and its rows to cells — the shape a table map is
 * computed from — unwrapping anything else, as the table plugin's own row
 * and table transforms do. An edit can leave something else in a row (a
 * paste into a row a cell spans down into, which holds no cell), and when
 * the table's transforms run before the row's, computing the map throws.
 *
 * @param table - The table.
 */
function $keepRowsOfCells(table: TableNode): void {
    $unwrapAndFilterDescendants(table, $isTableRowNode);

    for (const row of table.getChildren().filter($isTableRowNode)) {
        $unwrapAndFilterDescendants(row, $isTableCellNode);
    }
}

/**
 * Splits each header cell spanning columns or rows into the cells it
 * covers, its content kept in the first: Markdown merges body cells only
 * (`<<`, `^^`), so the save writes a header cell alone in its column, and an
 * edit that makes a merged body row the first row (a range deleted from the
 * header into the body) leaves a span the save cannot write. A covered
 * position in a lower row gets an empty cell where the span covered it.
 *
 * @param table - The table.
 * @param rows - Its rows.
 */
function $unmergeHeaderCells(table: TableNode, rows: readonly TableRowNode[]): void {
    const [map] = $computeTableMapSkipCellCheck(table, null, null);
    const spanning = (map[0] ?? []).filter((value, column) => value.startColumn === column && value.startRow === 0
        && (value.cell.getColSpan() > 1 || value.cell.getRowSpan() > 1));

    // Right to left, so the cells each lower row's insertion is placed against are those the map found.
    for (const { cell, startColumn } of spanning.reverse()) {
        const colSpan = cell.getColSpan();

        for (let row = 1; row < cell.getRowSpan(); row++) {
            const next = (map[row] ?? []).find((value) => value !== undefined && value.startRow === row
                && value.startColumn >= startColumn + colSpan);
            const covered = Array.from({ length: colSpan }, () => $createTableCellNode().append($createParagraphNode()));

            if (next === undefined) {
                rows[row]!.append(...covered);
            } else {
                covered.forEach((empty) => next.cell.insertBefore(empty));
            }
        }

        for (let column = 1; column < colSpan; column++) {
            cell.insertAfter($createTableCellNode(cell.getHeaderStyles()).append($createParagraphNode()));
        }

        cell.setColSpan(1);
        cell.setRowSpan(1);
    }
}

// ---------------------------------------------------------------- columns

/**
 * Replaces a `:::` column that stands outside a fence with the blocks it
 * holds, which is what the save writes for it. A paste already unwraps the
 * columns it carries at its top level before inserting them
 * (`$pasteColumnsAsTheirBlocks` in `MarkdownEditor.ts`); this transform
 * catches a column nested deeper in pasted content.
 *
 * @param column - The column.
 */
function $keepColumnInFence(column: MarkdownColumnNode): void {
    const inFence = $isMarkdownBlockNode(column.getParent());

    if (!inFence) {
        $unwrapNode(column);
    }
}

// ---------------------------------------------------------------- raw blocks

/**
 * Registers the raw-block rules. A raw block whose text runs on — an HTML
 * block its own text does not close, such as `<!--` without `-->` — would
 * take in the blocks after it, so the save writes it as a paragraph holding
 * its text (escaped, its lines kept by hard breaks) once a block after it
 * writes something, and so does a raw block in a `:::` column whose text
 * would break the column. The editor shows it as that paragraph
 * ({@link $showRawBlocksAsWritten}), checked whenever the raw block's text
 * or the blocks around it change — for a raw block of a list item, those are
 * also the blocks of the item nodes that continue its item
 * ({@link $showItemRawBlocksAsWritten}), and the column its list comes to
 * stand in ({@link $showColumnRawBlocksAsWritten}). A raw block whose text is edited until it
 * reads as several blocks shows as those blocks ({@link $showRawBlockAsItsBlocks}).
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerRawBlockRules(editor: LexicalEditor): () => void {
    const checkSiblings = (node: LexicalNode): void => {
        const parent = node.getParent();

        if ($isListItemNode(parent)) {
            $showItemRawBlocksAsWritten(parent);
        } else if (parent !== null) {
            $showRawBlocksAsWritten(parent);
        }
    };

    /**
     * Shows a raw block whose text or place changed as its save reads:
     * without the blocks a join left inside it, which follow it
     * ({@link $moveBlocksOutAfter}: its text is read next, and theirs is
     * none of it); as the paragraph it is written as, else as the blocks its
     * own text reads as; and where it stays a raw block in a list item that
     * no raw block of its text can stand in, the whole list read again. Each
     * step runs only while the one before it left the raw block in place.
     *
     * @param node - The raw block.
     */
    const $showRawBlockAsSaved = (node: MarkdownRawBlockNode): void => {
        const steps = [$moveBlocksOutAfter, checkSiblings, $showRawBlockAsItsBlocks, $readListAgainAroundRawBlock];

        for (const step of steps) {
            const inPlace = node.isAttached();

            if (inPlace) {
                step(node);
            }
        }
    };

    return mergeRegister(
        editor.registerNodeTransform(RootNode, $showRawBlocksAsWritten),
        editor.registerNodeTransform(MarkdownColumnNode, $showColumnRawBlocksAsWritten),
        editor.registerNodeTransform(ListItemNode, $showItemRawBlocksAsWritten),
        editor.registerNodeTransform(MarkdownRawBlockNode, $showRawBlockAsSaved),
        editor.registerNodeTransform(ParagraphNode, checkSiblings),
        editor.registerNodeTransform(TextNode, (text) => {
            const parent = text.getParent();

            if ($isMarkdownRawBlockNode(parent)) {
                $showRawBlockAsSaved(parent);
            }
        }),
    );
}

/**
 * Keeps the one rule for a raw block in a list item through an edit: when
 * the raw block's text is one no list item can hold
 * (`rawBlockStandsInItem`) — spaces typed before a raw list that reads
 * otherwise without them, a quote edited to end on a line that reads by what
 * follows it — the outermost list around it is shown anew as its save reads,
 * built as a load builds it. The load decides what is a list, an item's raw
 * block or a raw block of the whole list, so the editor then shows what a
 * reload of the save shows.
 *
 * @param node - The raw block whose text or place changed.
 */
function $readListAgainAroundRawBlock(node: MarkdownRawBlockNode): void {
    const item = node.getParent();
    const stands = !$isListItemNode(item) || $hasUpdateTag(MARKDOWN_IMPORT_TAG) || rawBlockStandsInItem(node.getTextContent());

    if (stands) {
        return;
    }

    let list: LexicalNode = item!;

    for (let parent = list.getParent(); $isListNode(parent) || $isListItemNode(parent); parent = parent.getParent()) {
        list = parent;
    }

    $showBlockAnew(list, $readBlocksWithDefinitions($serializeBlock(list), lexMarkdownLinkDefinitions($definitionsSource())));
}

/**
 * Shows an edited raw block as the blocks its text now reads as, where it
 * stands, when that is more than one, or one the editor holds as a node of
 * its own ({@link $readRawBlockAsBlocks}): a blank line typed into an HTML
 * block ends it, a fence typed into it opens a code block, a tag a deletion
 * broke leaves a paragraph. The save writes the raw block's text, which the
 * viewer reads as those blocks, so the editor shows them so too, each as a
 * load builds it; the caret goes to the block it was in, at the same place
 * in its text where that text reads as the raw text did. Not during a load,
 * which builds raw blocks from text that reads as one raw block.
 *
 * @param node - The raw block whose text changed.
 */
function $showRawBlockAsItsBlocks(node: MarkdownRawBlockNode): void {
    if ($hasUpdateTag(MARKDOWN_IMPORT_TAG) || !node.isAttached()) {
        return;
    }

    const reading = $readRawBlockAsBlocks(node.getTextContent());

    if (reading === null) {
        return;
    }

    const caret = $caretOffsetIn(node);

    for (const block of reading.nodes) {
        node.insertBefore(block);
    }

    node.remove();

    if (caret === null) {
        return;
    }

    const index = Math.max(0, reading.spans.findIndex(([, end]) => end >= caret));
    const [start] = reading.spans[index] ?? [0, 0];
    const block = reading.nodes[index] ?? reading.nodes[reading.nodes.length - 1]!;

    if (!$isElementNode(block)) {
        return;
    }

    if (caret <= start) {
        block.selectStart();
    } else if (block.getTextContent().startsWith(node.getTextContent().slice(start, caret))) {
        $selectTextOffset(block, caret - start);
    } else {
        block.selectEnd();
    }
}

/**
 * Puts a collapsed caret at an offset in a block's text, a line break
 * counting as the one character it shows as.
 *
 * @param block - The block.
 * @param offset - The offset in the block's text content.
 */
function $selectTextOffset(block: ElementNode, offset: number): void {
    let remaining = offset;

    for (const { node } of $dfs(block)) {
        if ($isTextNode(node) && remaining <= node.getTextContentSize()) {
            node.select(remaining, remaining);

            return;
        }

        remaining -= $isTextNode(node) || $isLineBreakNode(node) ? node.getTextContentSize() : 0;
    }

    block.selectEnd();
}

/**
 * Where a collapsed selection's caret sits in a raw block's text.
 *
 * @param node - The raw block.
 * @returns The caret's offset in the block's text, or `null` when the caret is not in it.
 */
function $caretOffsetIn(node: MarkdownRawBlockNode): number | null {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return null;
    }

    const anchor = selection.anchor;
    const children = node.getChildren();
    const index = anchor.type === "element" && anchor.getNode().is(node)
        ? anchor.offset
        : children.findIndex((child) => child.is(anchor.getNode()));

    if (index === -1) {
        return null;
    }

    const before = children.slice(0, index).reduce((length, child) => length + child.getTextContentSize(), 0);

    return before + (anchor.type === "text" ? anchor.offset : 0);
}

/**
 * Shows the raw blocks of a list item as the save writes them
 * ({@link $showRawBlocksAsWritten}), and those of the item nodes before it
 * that it continues: an item node opening with a nested list is part of the
 * item before it, so its blocks stand after that item's own, and a raw
 * block there that runs on would take them in.
 *
 * @param item - The list item that changed.
 */
function $showItemRawBlocksAsWritten(item: ListItemNode): void {
    let current: LexicalNode | null = item;

    $showRawBlocksAsWritten(item);

    while ($continuesItemBefore(current)) {
        current = current.getPreviousSibling();

        if ($isListItemNode(current)) {
            $showRawBlocksAsWritten(current);
        }
    }
}

/**
 * Shows the raw blocks of a `:::` column as the save writes them
 * ({@link $showRawBlocksAsWritten}), those of its lists' items included, at
 * any depth: a column that takes in a list (an alignment or a column count
 * set on it) changes how each raw block of the list's items is written, and
 * marks none of those items as changed.
 *
 * @param column - The column that changed.
 */
function $showColumnRawBlocksAsWritten(column: ElementNode): void {
    $showRawBlocksAsWritten(column);

    for (const child of column.getChildren()) {
        if ($isListNode(child)) {
            child.getChildren().filter($isListItemNode).forEach($showColumnRawBlocksAsWritten);
        }
    }
}

/**
 * Turns each raw block among an element's children that the save writes as
 * a paragraph ({@link $rawBlockWritesAsParagraph}) into that paragraph,
 * keeping its text and line breaks.
 *
 * @param parent - The root, a `:::` column or a list item.
 */
function $showRawBlocksAsWritten(parent: ElementNode): void {
    for (const child of parent.getChildren()) {
        if ($isMarkdownRawBlockNode(child) && $rawBlockWritesAsParagraph(child)) {
            child.replace($createParagraphNode(), true);
        }
    }
}

// ---------------------------------------------------------------- link reference definitions

/** The definitions an update has brought the document's blocks in line with so far. */
interface DefinitionsShown {
    /** The committed state the update started from. */
    readonly from:   EditorState;
    /** The definitions' source ({@link $definitionsSource}) the blocks now show. */
    readonly source: string;
}

/**
 * Registers the definition rule. What a block shows was read under the
 * document's link reference definitions, and only source kept as written
 * reads differently under others: a run whose source holds a `[` — an empty
 * reference (`[][ref]`), a reference image (`![alt][ref]`), a reference kept
 * inside a construct — shows what its source read as, while the save writes
 * that source unchanged. Everything else the editor holds reads alike under
 * any definitions: text escapes its brackets, so text never becomes a link,
 * and a reference link keeps its own URL, saved inline once its label no
 * longer resolves to it.
 *
 * So when an update changes the definitions — one typed, edited, pasted or
 * removed in a raw block, at any depth — each top-level block whose runs
 * kept as written name a label the change resolves differently, and whose
 * save shows differently under the new definitions than under the ones it
 * was shown under, shows anew as a load builds it from that save
 * ({@link $showBlocksAsDefinitionsRead}): the editor again shows what the
 * viewer reads, and what a reload of the save would show.
 *
 * The check runs in a root transform, so it lands in the update that made
 * the change and undoes with it. It reads the raw blocks' text, found among
 * the top-level blocks, and compares it with the text the document held
 * before the update, which an update listener carries from one committed
 * state to the next where the transform ran; the definitions are lexed only
 * when that text changed, and blocks are serialized only when the
 * definitions did.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerDefinitionRules(editor: LexicalEditor): () => void {
    const committedSources = new WeakMap<EditorState, string>();
    let shown: DefinitionsShown | null = null;
    // The last source lexed, which the next change compares against: one lex per change.
    let lexed = { source: "", definitions: lexMarkdownLinkDefinitions("") };

    const definitionsOf = (source: string): Links => {
        if (lexed.source !== source) {
            lexed = { source, definitions: lexMarkdownLinkDefinitions(source) };
        }

        return lexed.definitions;
    };

    // Read off the state itself only where no transform ran to carry its text: after an update that moved only the
    // selection, or an undo, a redo or another update that sets a state.
    const sourceOf = (state: EditorState): string => {
        let source = committedSources.get(state);

        if (source === undefined) {
            source = state.read($definitionsSource, { editor });
            committedSources.set(state, source);
        }

        return source;
    };

    return mergeRegister(
        editor.registerNodeTransform(RootNode, () => {
            // An undo or a redo brings back a state that showed its own definitions; its text is read off it when needed.
            const historic = $hasUpdateTag(HISTORIC_TAG);

            if (historic) {
                shown = null;

                return;
            }

            const from = editor.getEditorState();
            const now = $definitionsSource();
            const loading = $hasUpdateTag(MARKDOWN_IMPORT_TAG);
            const before = shown?.from === from ? shown.source : loading ? now : sourceOf(from);

            shown = { from, source: now };

            if (now === before) {
                return;
            }

            const previous = definitionsOf(before);
            const current = definitionsOf(now);
            const changed = changedLabels(previous, current);

            if (changed.length > 0) {
                $showBlocksAsDefinitionsRead(previous, current, changed);
            }
        }),
        editor.registerUpdateListener(({ editorState, prevEditorState }) => {
            if (shown?.from === prevEditorState) {
                committedSources.set(editorState, shown.source);
            }

            // An undo can bring back the very state an update started from; the next update starts afresh.
            shown = null;
        }),
    );
}

/**
 * The labels two sets of definitions resolve differently: defined in one
 * only, or to another URL or title.
 *
 * @param previous - One set.
 * @param current - The other.
 * @returns The labels, as `marked` keys them.
 */
function changedLabels(previous: Links, current: Links): string[] {
    const labels = new Set([...Object.keys(previous), ...Object.keys(current)]);

    return [...labels].filter((label) => JSON.stringify(previous[label]) !== JSON.stringify(current[label]));
}

/**
 * Shows anew each top-level block whose runs kept as written name a label
 * the definitions changed ({@link $namesLabel}), when its save shows
 * differently under the document's new definitions than under the ones it
 * was shown under ({@link shownReading}). A block holding a reference link
 * is written anew too — in its written form or inline, as its definition
 * now resolves — so a reference that keeps its form whatever its title
 * takes its definition's title ({@link $adoptDefinitionTitles}), and a run
 * of it whose save then reads differently shows as it saves
 * ({@link $showRunsAsSaved}).
 *
 * @param previous - The definitions the blocks were shown under.
 * @param current - The document's definitions now.
 * @param changed - The labels the two resolve differently.
 */
function $showBlocksAsDefinitionsRead(previous: Links, current: Links, changed: readonly string[]): void {
    for (const block of $getRoot().getChildren()) {
        const named = $namesLabel(block, changed);

        if ($isElementNode(block) && $dfs(block).some(({ node }) => $isReferenceLinkNode(node))) {
            $adoptDefinitionTitles(block, current);
            $showRunsAsSaved(block);
        }

        if (!named) {
            continue;
        }

        const markdown = $serializeBlock(block);
        const readsAlike = shownReading(markdown, previous) === shownReading(markdown, current);

        if (!readsAlike) {
            $showBlockAnew(block, $readBlocksWithDefinitions(markdown, current));
        }
    }
}

/**
 * Gives each reference link in a block whose title holds a blank line the
 * title of its definition, while that definition resolves its label to its
 * URL: no inline link can write such a title (a blank line ends the block),
 * so its save keeps the reference form and the viewer shows the definition's
 * title, whatever the link's own.
 *
 * @param block - The block.
 * @param definitions - The document's definitions now.
 */
function $adoptDefinitionTitles(block: ElementNode, definitions: Links): void {
    for (const { node } of $dfs(block)) {
        if (!$isReferenceLinkNode(node) || !BLANK_LINE_IN_TITLE.test(node.getTitle() ?? "")) {
            continue;
        }

        const definition = definitions[node.getReference().label.replace(/\s+/g, " ").toLowerCase()];

        if (definition !== undefined && definition.href === node.getURL() && (definition.title || null) !== node.getTitle()) {
            node.setTitle(definition.title || null);
        }
    }
}

/**
 * What Markdown shows under given definitions, in a form two readings can
 * compare: its tokens, except that where a reference points is left out
 * where the viewer shows nothing of it — a link with no content, and an
 * image `marked` reads from a reference (`![alt][ref]`), which the viewer
 * shows as its alt text — so a definition whose URL is edited shows such a
 * block anew only where a link it points shows.
 *
 * @param markdown - The Markdown.
 * @param definitions - The definitions in force.
 * @returns The reading, as JSON.
 */
function shownReading(markdown: string, definitions: Links): string {
    return JSON.stringify(lexMarkdownWithDefinitions(markdown, definitions), (_key, value: unknown) => {
        const token = value as Partial<Tokens.Link | Tokens.Image> | null;

        if (token?.type === "image" || (token?.type === "link" && token.tokens?.length === 0)) {
            return { type: token.type, raw: token.raw, text: token.text };
        }

        return value;
    });
}

/**
 * Tells whether a block's runs kept as written — the only content whose
 * reading a definition can change — name one of the labels in brackets, as
 * `marked` keys them (whitespace runs one space, lowercased). The runs'
 * sources are read joined, since a construct kept as written spreads its
 * source over its runs.
 *
 * @param block - The block.
 * @param labels - The labels.
 * @returns `true` when a run names one.
 */
function $namesLabel(block: LexicalNode, labels: readonly string[]): boolean {
    if (!$isElementNode(block)) {
        return false;
    }

    const sources = $dfs(block).map(({ node }) => ($isMarkdownSourceTextNode(node) ? node.getSource() : "")).join("");
    const keyed = sources.replace(/\s+/g, " ").toLowerCase();

    return sources.includes("[") && labels.some((label) => keyed.includes(`[${label}]`));
}

/**
 * Puts the blocks a block's save reads as in its place. A caret in the block
 * stays at the same offset of its text where that text still reaches, else
 * goes to the end of the new blocks.
 *
 * @param block - The block shown anew.
 * @param blocks - What it reads as now; nothing is done when empty.
 */
function $showBlockAnew(block: LexicalNode, blocks: LexicalNode[]): void {
    const last = blocks[blocks.length - 1];

    if (last === undefined) {
        return;
    }

    const caret = $caretTextOffset(block);

    for (const node of blocks) {
        block.insertBefore(node);
    }

    block.remove();

    if (caret !== null) {
        $placeCaret(blocks, caret, last);
    }
}

/**
 * Where a collapsed selection's caret sits in a block's text: the length of
 * the text before it, an element point counting from the start of its element.
 *
 * @param block - The block.
 * @returns The offset, or `null` when the caret is not in the block.
 */
function $caretTextOffset(block: LexicalNode): number | null {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return null;
    }

    const anchor = selection.anchor;
    const anchorNode = anchor.getNode();
    let offset = 0;

    for (const { node } of $dfs(block)) {
        const reached = node.is(anchorNode);

        if (reached) {
            return offset + (anchor.type === "text" ? anchor.offset : 0);
        }

        if ($isTextNode(node)) {
            offset += node.getTextContentSize();
        }
    }

    return null;
}

/**
 * Puts a collapsed caret at an offset of the text of a run of blocks.
 *
 * @param blocks - The blocks.
 * @param offset - The offset in their text, joined.
 * @param last - The last block, whose end takes a caret past the text.
 */
function $placeCaret(blocks: readonly LexicalNode[], offset: number, last: LexicalNode): void {
    let before = 0;

    for (const block of blocks) {
        for (const { node } of $dfs(block)) {
            if (!$isTextNode(node)) {
                continue;
            }

            const size = node.getTextContentSize();

            if (offset <= before + size) {
                node.select(offset - before, offset - before);

                return;
            }

            before += size;
        }
    }

    if ($isElementNode(last)) {
        last.selectEnd();
    }
}

// ---------------------------------------------------------------- line breaks

/**
 * Registers the line-break rules. Markdown has no hard break at the end of a
 * block (CommonMark §6.7: a trailing `\` is literal, trailing spaces are
 * stripped), none in a block holding nothing else, and none in an ATX
 * heading, whose content is one line — only levels 1 and 2 have the setext
 * form that spans lines. So Shift+Enter (`INSERT_LINE_BREAK_COMMAND`, at
 * {@link COMMAND_PRIORITY_HIGH}, ahead of `registerRichText`'s handler)
 * declines in a level 3–6 heading and wherever nothing would follow the
 * break in its block ({@link $declinesLineBreak}), and node transforms on
 * the blocks that hold inline content ({@link $dropUnwritableBreaks}) turn
 * a break any other edit leaves there — a paste, a deletion, a code block
 * converted — into what the save writes: nothing at a block's end, a space
 * in a level 3–6 heading. A table cell keeps every break: its cell break
 * shows anywhere.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerLineBreakRules(editor: LexicalEditor): () => void {
    const dropInContainer = (node: LexicalNode): void => {
        if ($isBreakRuleContainer(node)) {
            $dropUnwritableBreaks(node);
        }
    };

    return mergeRegister(
        editor.registerCommand(INSERT_LINE_BREAK_COMMAND, $declinesLineBreak, COMMAND_PRIORITY_HIGH),
        editor.registerNodeTransform(ParagraphNode, dropInContainer),
        editor.registerNodeTransform(HeadingNode, dropInContainer),
        editor.registerNodeTransform(QuoteNode, dropInContainer),
        editor.registerNodeTransform(ListItemNode, dropInContainer),
        editor.registerNodeTransform(TextNode, (text) => {
            const container = $breakRuleContainerOf(text);

            if (container !== null) {
                $dropUnwritableBreaks(container);
            }
        }),
        // A deletion inside a link changes the link, not its block, which can leave it holding only a break.
        editor.registerNodeTransform(LinkNode, (link) => {
            const container = $breakRuleContainerOf(link);

            if (container !== null) {
                $dropUnwritableBreaks(container);
            }
        }),
    );
}

/**
 * `INSERT_LINE_BREAK_COMMAND` handler declining a break a save could not
 * write: in a level 3–6 heading, or where nothing with content follows the
 * selection's end in its block.
 *
 * @returns Whether the break was declined.
 */
function $declinesLineBreak(): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    const end = selection.isBackward() ? selection.anchor : selection.focus;

    return $lineBreakUnwritableAt(end);
}

/**
 * Whether a line break put at `point` is one a save could not write: the
 * point is in a level 3–6 heading, or nothing with content would follow the
 * break in its block. Never in a table cell, a code block or a raw block,
 * which keep every break.
 *
 * @param point - The point the break would go in at.
 * @param rest - For a break that follows an edit joining another block's
 *   rest after `point`: the point of the document as it stands whose block
 *   holds, after it, what will follow the break — or `null` when nothing
 *   will. `point` itself when omitted, for a break put in as things stand.
 * @returns `true` when the save could not write the break.
 */
export function $lineBreakUnwritableAt(point: PointType, rest: PointType | null = point): boolean {
    const container = $breakRuleContainerOf(point.getNode());

    if (container === null) {
        return false;
    }

    const restBlock = rest === null ? null : $findEnclosingBlock(rest.getNode());
    const isFollowed = rest !== null && restBlock !== null && $contentFollows(rest, restBlock);

    return $isOneLineHeading(container) || !isFollowed;
}

/**
 * Whether a node is a block whose inline content the line-break rules keep:
 * a paragraph outside a table cell, a heading, a quote or a list item.
 *
 * @param node - The node.
 * @returns `true` for such a block.
 */
function $isBreakRuleContainer(node: LexicalNode | null): node is ElementNode {
    if ($isParagraphNode(node)) {
        return !$isTableCellNode(node.getParent());
    }

    return $isHeadingNode(node) || $isQuoteNode(node) || $isListItemNode(node);
}

/**
 * Finds the block whose inline content holds a node, when the line-break
 * rules keep it.
 *
 * @param node - The node (an inline node, or the block itself).
 * @returns The block, or `null` when the node sits elsewhere (a table cell,
 *   a code block, a raw block).
 */
export function $breakRuleContainerOf(node: LexicalNode): ElementNode | null {
    const block = $findEnclosingBlock(node);

    return $isBreakRuleContainer(block) ? block : null;
}

/**
 * Finds the block enclosing a node: the nearest element that is not inline,
 * the node itself when it is one. The root is no block here.
 *
 * @param node - The node to search upward from.
 * @returns The enclosing block, or `null` when there is none below the root.
 */
export function $findEnclosingBlock(node: LexicalNode): ElementNode | null {
    return $findMatchingParent(node, (candidate): candidate is ElementNode => $isElementNode(candidate) && !candidate.isInline());
}

/**
 * Whether a block is a heading the save writes on one line: level 3 or deeper.
 *
 * @param node - The block.
 * @returns `true` for a level 3–6 heading.
 */
function $isOneLineHeading(node: ElementNode): boolean {
    return $isHeadingNode(node) && Number(node.getTag().slice(1)) > SETEXT_MAX_LEVEL;
}

/**
 * Whether a block's inline content holds a line break: a break node, or a
 * newline in text other than a source run's.
 *
 * @param node - The block.
 * @returns `true` when it does.
 */
function $holdsBreak(node: ElementNode): boolean {
    return $inlineLeaves(node).some((leaf) => $isLineBreakNode(leaf)
        || ($isTextNode(leaf) && !$isMarkdownSourceTextNode(leaf) && leaf.getTextContent().includes("\n")));
}

/**
 * The inline leaves of a block, in order, descending into inline elements
 * (links); a block child (a nested block in a list item) stands for itself
 * and ends the run of inline content before it.
 *
 * @param element - The block, or an inline element in it.
 * @returns The leaves and block children.
 */
function $inlineLeaves(element: ElementNode): LexicalNode[] {
    return element.getChildren().flatMap((child) => ($isElementNode(child) && child.isInline() ? $inlineLeaves(child) : [child]));
}

/**
 * Whether an inline leaf holds content a save writes — an image, text other
 * than whitespace, any code, source other than whitespace — as the
 * serializer counts it when it drops a block's edge breaks.
 *
 * @param node - The leaf.
 * @param text - The part of its text to read; all of it when omitted.
 * @returns `true` when it holds content.
 */
function $holdsContent(node: LexicalNode, text?: string): boolean {
    if ($isMarkdownSourceTextNode(node)) {
        return /\S/.test(node.getSource());
    }

    if ($isTextNode(node)) {
        const shown = text ?? node.getTextContent();

        return node.hasFormat("code") ? shown.replace(/\n/g, "") !== "" : /\S/.test(shown);
    }

    return $isDecoratorNode(node);
}

/**
 * Whether content follows a point in its block's run of inline content.
 *
 * @param point - The point.
 * @param container - The block it sits in.
 * @returns `true` when a leaf after the point, before the run ends, holds content.
 */
function $contentFollows(point: PointType, container: ElementNode): boolean {
    const leaves = $inlineLeaves(container);
    const node = point.getNode();
    let start: number;

    if (point.type === "text") {
        if (!$isMarkdownSourceTextNode(node) && $holdsContent(node, node.getTextContent().slice(point.offset))) {
            return true;
        }

        start = leaves.indexOf(node) + (point.offset === 0 && $isMarkdownSourceTextNode(node) ? 0 : 1);
    } else {
        const child = $isElementNode(node) ? node.getChildAtIndex(point.offset) : null;
        const first = child === null ? null : ($isElementNode(child) && child.isInline() ? $inlineLeaves(child)[0] ?? null : child);
        const last = $isElementNode(node) && node !== container ? $inlineLeaves(node).at(-1) ?? node : null;

        start = first !== null ? leaves.indexOf(first) : last !== null ? leaves.indexOf(last) + 1 : leaves.length;
    }

    for (const leaf of leaves.slice(Math.max(0, start))) {
        if ($isElementNode(leaf)) {
            return false;
        }

        if ($holdsContent(leaf)) {
            return true;
        }
    }

    return false;
}

/**
 * Turns the line breaks of a block that a save cannot write into what it
 * writes: in a heading the save writes on one line — level 3–6, or level 1
 * or 2 when a line of its setext form would end it
 * ({@link $headingWritesOneLine}) — every break becomes a space, shown as
 * the space the save writes; elsewhere, the breaks after the last content of
 * each run of inline content — at the block's end, or before a nested block
 * in a list item — are removed, as the save drops them, and a link holding
 * no content at either edge of the block is unwrapped, as the save cannot
 * write it there. Read from the edges, so a block whose edge leaves hold
 * content costs a step or two.
 *
 * @param container - The block.
 */
function $dropUnwritableBreaks(container: ElementNode): void {
    if ($isOneLineHeading(container) || ($isHeadingNode(container) && $holdsBreak(container) && $headingWritesOneLine(container))) {
        for (const leaf of $inlineLeaves(container)) {
            if ($isLineBreakNode(leaf)) {
                leaf.replace($createTextNode(" "));
            } else if ($isTextNode(leaf) && !$isMarkdownSourceTextNode(leaf) && leaf.getTextContent().includes("\n")) {
                leaf.setTextContent(leaf.getTextContent().replace(/\n/g, " "));
            }
        }
    }

    // Only a list item holds block children, which end the runs before them.
    const holdsBlocks = $isListItemNode(container);
    let atRunEnd = true;
    let child = container.getLastChild();

    while (child !== null && (atRunEnd || holdsBlocks)) {
        const previous: LexicalNode | null = child.getPreviousSibling();

        if ($isElementNode(child) && !child.isInline()) {
            atRunEnd = true;
        } else if (atRunEnd) {
            atRunEnd = !$dropBreaksBeforeEnd(child);

            if (atRunEnd) {
                $unwrapLinkShowingNothing(child);
            }
        }

        child = previous;
    }

    for (let first = container.getFirstChild(); first !== null && !$holdsInlineContent(first);) {
        const next: LexicalNode | null = first.getNextSibling();

        $unwrapLinkShowingNothing(first);
        first = next;
    }
}

/**
 * Whether an inline node holds content a save writes, a link through its leaves.
 *
 * @param node - The inline node.
 * @returns `true` when it holds content.
 */
function $holdsInlineContent(node: LexicalNode): boolean {
    if ($isElementNode(node)) {
        return node.isInline() && $inlineLeaves(node).some((leaf) => $holdsContent(leaf));
    }

    return $holdsContent(node);
}

/**
 * Unwraps a link that holds no content (only whitespace, such as a soft
 * break) standing at an edge of its block: the save cannot write it there,
 * since the whitespace is trimmed, so the editor keeps only its children.
 *
 * @param node - An inline node at the block's edge, holding no content.
 */
function $unwrapLinkShowingNothing(node: LexicalNode): void {
    if (!$isLinkNode(node)) {
        return;
    }

    for (const child of node.getChildren()) {
        node.insertBefore(child);
    }

    node.remove();
}

/**
 * Drops the line breaks an inline node holds after its last content, read
 * from its end: the node itself when it is a leaf, or the leaves of an
 * inline element (a link).
 *
 * @param node - The inline node.
 * @returns `true` when it holds content, which ends the run's edge.
 */
function $dropBreaksBeforeEnd(node: LexicalNode): boolean {
    if (!$isElementNode(node)) {
        return $dropBreaksAtRunEnd(node);
    }

    let child = node.getLastChild();

    while (child !== null) {
        const previous: LexicalNode | null = child.getPreviousSibling();

        if ($dropBreaksBeforeEnd(child)) {
            return true;
        }

        child = previous;
    }

    return false;
}

/**
 * Drops the line breaks one leaf at the end of a run of inline content
 * holds after its content: removes a line break, strips the newlines after
 * a text's last content.
 *
 * @param leaf - The leaf, read from the run's end backwards.
 * @returns `true` when the leaf holds content, which ends the run's edge.
 */
function $dropBreaksAtRunEnd(leaf: LexicalNode): boolean {
    if ($isLineBreakNode(leaf)) {
        leaf.remove();

        return false;
    }

    if (!$isTextNode(leaf) || $isMarkdownSourceTextNode(leaf)) {
        return $holdsContent(leaf);
    }

    const text = leaf.getTextContent();
    const code = leaf.hasFormat("code");
    let contentEnd = text.length;

    while (contentEnd > 0 && (text[contentEnd - 1] === "\n" || (!code && /\s/.test(text[contentEnd - 1]!)))) {
        contentEnd -= 1;
    }

    const kept = text.slice(0, contentEnd) + text.slice(contentEnd).replace(/\n/g, "");

    if (kept !== text) {
        leaf.setTextContent(kept);
        $keepSelectionInText(leaf);
    }

    return contentEnd > 0;
}

/**
 * Moves a selection end past the end of a text node whose text just got
 * shorter back to its end. Lexical's `setTextContent` leaves the selection
 * as it was, and an offset past the end throws on the next read.
 *
 * @param text - The text node.
 */
function $keepSelectionInText(text: TextNode): void {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return;
    }

    const size = text.getTextContentSize();

    for (const point of [selection.anchor, selection.focus]) {
        if (point.type === "text" && point.key === text.getKey() && point.offset > size) {
            point.set(point.key, size, "text");
        }
    }
}

// ---------------------------------------------------------------- run edges

/**
 * The update tag the edits that can leave a format where a delimiter cannot
 * stand at a run's edge set, so the transforms tidy the whole of each block
 * they change — the commands {@link registerRunEdgeRules} tags, and an
 * update that inserts a node next to text, such as an image, which can
 * change how a construct kept as written before it reads.
 */
export const RUN_EDGE_TAG = "markdown-run-edges";

/**
 * Registers the run-edge rule. Markdown's emphasis and strikethrough
 * delimiters cannot stand against whitespace inside them, nor against
 * punctuation inside them with a letter outside, so the save cannot write
 * such a run as shown. The format commands decline or trim it themselves
 * ({@link $editWritably}); after an edit that can leave one — a deletion
 * (`**a b**` losing its `a`), a paste (bold text opening with `(` after a
 * letter), a split by Enter or Shift+Enter, a cut or a drop, each command
 * tagged at {@link COMMAND_PRIORITY_CRITICAL}, ahead of whatever handles it
 * — the blocks whose text changed are tidied ({@link $tidyBlock}). Typing,
 * which no command marks, is tidied where the caret is
 * ({@link $editedLeaves}, {@link $tidyRuns}). A load is never tidied: it keeps what it loaded.
 * In every update, a construct kept as written that an edit took apart
 * becomes ordinary text ({@link $dissolveBrokenKeptConstructs}), and a link
 * an edit left with no content at all is removed ({@link $removeEmptyLinks}).
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerRunEdgeRules(editor: LexicalEditor): () => void {
    const tag = (): boolean => {
        $addUpdateTag(RUN_EDGE_TAG);

        return false;
    };

    const tidy = (node: LexicalNode): void => {
        if ($hasUpdateTag(MARKDOWN_IMPORT_TAG)) {
            return;
        }

        const container = $findEnclosingBlock(node);
        const isTextOnlyBlock = $isMarkdownRawBlockNode(container) || $isCodeNode(container);

        if (container === null || isTextOnlyBlock) {
            return;
        }

        const holdsTextOnly = $isParagraphNode(container) || $isHeadingNode(container) || $isQuoteNode(container);

        // A text node's rule runs before its block's own: a block a join left in it is moved out before its content
        // is read as runs of text, which would take that block's text in.
        if (holdsTextOnly) {
            $keepBlocksOutOfText(container);
        }

        $removeEmptyLinks(container);

        const dissolved = $dissolveBrokenKeptConstructs(container);

        if ($hasUpdateTag(RUN_EDGE_TAG)) {
            $tidyBlock(container);

            return;
        }

        const typed = $isTextNode(node) && !$hasUpdateTag(HISTORIC_TAG) ? $editedLeaves(editor, container, node) : [];

        if (typed.length > 0 || dissolved.length > 0) {
            $tidyRuns(container, new Set([...typed, ...dissolved]), typed.length > 0);
        }
    };

    return mergeRegister(
        editor.registerCommand(DELETE_CHARACTER_COMMAND, tag, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(DELETE_WORD_COMMAND, tag, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(DELETE_LINE_COMMAND, tag, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(REMOVE_TEXT_COMMAND, tag, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(INSERT_PARAGRAPH_COMMAND, tag, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(INSERT_LINE_BREAK_COMMAND, tag, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(PASTE_COMMAND, tag, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, tag, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(CUT_COMMAND, tag, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(DROP_COMMAND, tag, COMMAND_PRIORITY_CRITICAL),
        ...[TextNode, MarkdownSourceTextNode, LinkNode, ParagraphNode, HeadingNode, QuoteNode, ListItemNode]
            .map((klass) => editor.registerNodeTransform(klass, tidy)),
    );
}

/**
 * Removes each link in a block that holds no node at all — a paste can leave
 * one, where Lexical removes a link emptied by typing. It shows nothing and
 * the save writes nothing for it, as for a link holding only whitespace at a
 * block's edge ({@link $unwrapLinkShowingNothing}).
 *
 * @param container - The block.
 */
function $removeEmptyLinks(container: ElementNode): void {
    for (const { node } of $dfs(container)) {
        if ($isLinkNode(node) && node.getChildrenSize() === 0) {
            node.remove();
        }
    }
}

/**
 * Tidies a whole block after an edit that can leave a format where its
 * delimiter cannot stand: the format comes off whitespace and punctuation
 * at a run's edge ({@link $keepMarksOffEdgeWhitespace},
 * {@link $keepMarksFlanking}), and — when a construct kept as written no
 * longer reads back where it now stands — the block's kept constructs
 * become ordinary text, tidied the same way ({@link $dissolveMisreadKeptConstructs}).
 * A run that still would not read back shows as its save reads
 * ({@link $showRunsAsSaved}).
 *
 * @param container - The block.
 */
function $tidyBlock(container: ElementNode): void {
    $keepMarksOffEdgeWhitespace(container);
    $keepMarksFlanking(container);

    // A `~` the save escapes (two together) is punctuation to `marked`, not the letter a lone one is next to `*`.
    if (!$readsBackAsShown(container)) {
        $keepMarksFlanking(container, false);
    }

    $dissolveMisreadKeptConstructs(container, () => {
        $keepMarksOffEdgeWhitespace(container);
        $keepMarksFlanking(container);
    });
    $showRunsAsSaved(container);
}

/**
 * The leaves around a text node whose text an edit changed without a
 * command marking it — typing, which changes the text where the caret is,
 * or text set on an existing node: the node (the caret's, when typing) and
 * its neighbours. A text node created in the update, with no caret in or
 * next to it, is not an edit of text: a document being built.
 *
 * @param editor - The editor.
 * @param container - The block.
 * @param node - The text node that changed.
 * @returns The leaves' keys; none when `node` was not edited so.
 */
function $editedLeaves(editor: LexicalEditor, container: ElementNode, node: TextNode): string[] {
    const selection = $getSelection();
    const leaves = $inlineLeaves(container);
    const caret = $isRangeSelection(selection) && selection.isCollapsed() ? selection.anchor.getNode() : null;
    const typedAt = caret !== null && [caret, caret.getPreviousSibling(), caret.getNextSibling()].some((leaf) => leaf?.is(node) === true)
        ? leaves.indexOf(caret)
        : -1;
    const key = node.getKey();
    const before = editor.getEditorState().read(() => $getNodeByKey(key)?.getTextContent() ?? null);
    const at = typedAt !== -1 ? typedAt : before !== null && before !== node.getTextContent() ? leaves.indexOf(node) : -1;

    return at === -1 ? [] : leaves.slice(Math.max(0, at - 1), at + 2).map((leaf) => leaf.getKey());
}

/**
 * Tidies the runs of a block that hold given leaves — the leaves at the
 * caret after typing, or the runs of a kept construct an edit made ordinary
 * text — so they take formats the save can write and what is shown is
 * saved; the rest of the block is never touched. When typing, whitespace
 * between two parts of a bold, italic or struck run takes that format,
 * joining them ({@link $joinRunsAcrossWhitespace}). The format comes off
 * whitespace at such a run's edge ({@link $trimRunEdges}): a space typed
 * after bold text shows plain until the next word, typed bold, joins the
 * run. When the block then no longer reads back as shown, the format also
 * comes off punctuation at those runs' edges where its delimiter cannot
 * stand — a word typed right before emphasis that opens with punctuation
 * takes the emphasis off that punctuation — and a construct kept as written
 * that now reads differently becomes ordinary text ({@link $dissolveMisreadKeptConstructs});
 * a run that still would not read back shows as its save reads ({@link $showRunsAsSaved}).
 *
 * @param container - The block.
 * @param near - The keys of the leaves whose runs to tidy.
 * @param typing - Whether text was typed, so runs may join.
 */
function $tidyRuns(container: ElementNode, near: ReadonlySet<string>, typing: boolean): void {
    if (typing) {
        $joinRunsAcrossWhitespace(container, near);
    }

    $trimNearRunEdges(container, near);

    if ($readsBackAsShown(container)) {
        return;
    }

    $keepNearMarksFlanking(container, near);
    $dissolveMisreadKeptConstructs(container, (dissolved) => {
        const runs = new Set([...near, ...dissolved]);

        $trimNearRunEdges(container, runs);
        $keepNearMarksFlanking(container, runs);
    });
    $showRunsAsSaved(container);
}

/**
 * Takes bold, italic and strikethrough off the whitespace at the edges of
 * the runs that hold one of the given leaves ({@link $trimRunEdges}).
 *
 * @param container - The block.
 * @param near - The keys of the leaves.
 */
function $trimNearRunEdges(container: ElementNode, near: ReadonlySet<string>): void {
    for (const format of FLANKED_FORMATS) {
        $markRuns(container, format).filter((run) => run.some((leaf) => near.has(leaf.getKey()))).forEach((run) => $trimRunEdges(run, format));
    }
}

/**
 * Takes a format off the punctuation at the edges of the runs that hold one
 * of the leaves at the caret, where its delimiter cannot stand ({@link $trimUnflankedEdge}).
 *
 * @param container - The block.
 * @param near - The keys of the leaves at the caret.
 */
function $keepNearMarksFlanking(container: ElementNode, near: ReadonlySet<string>): void {
    const touches = (run: TextNode[]): boolean => run.some((leaf) => near.has(leaf.getKey()));

    for (const format of FLANKED_FORMATS) {
        const delimiter = format === "strikethrough" ? "~" : "*";
        let changed = true;

        while (changed) {
            changed = $markRuns(container, format).filter(touches).some((run) =>
                $trimUnflankedEdge(container, run[0]!, format, delimiter, "start")
                || $trimUnflankedEdge(container, run[run.length - 1]!, format, delimiter, "end"));
        }
    }
}

// ---------------------------------------------------------------- runs shown as saved

/**
 * Shows each run of a block's inline content whose save would read
 * differently from what the editor shows as that save reads
 * ({@link $runsReadingOtherwise}): its nodes give way to the nodes a load
 * builds from the save's inline tokens ({@link $buildInlineContent}) —
 * when those then read back, which they do unless no writing of them can.
 * The last resort of the rules that keep a block writable: Markdown read by
 * `marked` has corners no writing reaches (a code span holding a backtick
 * hides the delimiters after it from emphasis pairing), so what an edit
 * leaves there shows as it saves. The caret stays at its offset in the
 * run's text, or goes to the run's end where the text is now shorter.
 *
 * @param block - The block, or any element holding blocks with runs.
 */
function $showRunsAsSaved(block: ElementNode): void {
    for (const { nodes, tokens } of $runsReadingOtherwise(block)) {
        // A table cell's run is the cell, whose paragraphs give way; any other run's nodes give way in their block.
        const cell = $isTableCellNode(nodes[0]) ? nodes[0] : null;
        const parent = cell ?? nodes[0]!.getParent();
        const scratch = $isElementNode(parent) ? $scratchBlock(parent) : null;
        const replaced = cell !== null ? cell.getChildren() : nodes;

        if (scratch === null) {
            continue;
        }

        $buildInlineContent(scratch, tokens);

        if ($runsReadingOtherwise(scratch, cell !== null || $findMatchingParent(parent!, $isTableCellNode) !== null).length > 0) {
            continue;
        }

        const caret = $caretOffsetInRun(replaced);
        const built = scratch.getChildren();

        if (cell !== null) {
            cell.clear();
            cell.append(...built);
        } else {
            built.forEach((node) => nodes[0]!.insertBefore(node));
            nodes.forEach((node) => node.remove());
        }

        if (caret !== null) {
            $selectInRun(built, caret);
        }
    }
}

/**
 * An empty, detached block of the kind that holds a run, to build the run's
 * nodes in: the same element type, so they are read in the same context.
 *
 * @param parent - The run's element (the cell, for a table cell's run).
 * @returns The block, or `null` for an element that holds no run of its own.
 */
function $scratchBlock(parent: ElementNode): ElementNode | null {
    if ($isTableCellNode(parent)) {
        return $createTableCellNode(parent.getHeaderStyles());
    }

    if ($isParagraphNode(parent)) {
        return $createParagraphNode();
    }

    if ($isHeadingNode(parent)) {
        return $createHeadingNode(parent.getTag());
    }

    if ($isQuoteNode(parent)) {
        return $createQuoteNode();
    }

    return $isListItemNode(parent) ? $createListItemNode() : null;
}

/**
 * Where a collapsed caret sits in a run's text, when it sits in the run.
 *
 * @param nodes - The run's nodes.
 * @returns The caret's offset in the run's text content, or `null`.
 */
function $caretOffsetInRun(nodes: readonly LexicalNode[]): number | null {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== "text") {
        return null;
    }

    const anchor = selection.anchor.getNode();
    let offset = 0;

    for (const { node: leaf } of nodes.flatMap((node) => $dfs(node))) {
        if (leaf.is(anchor)) {
            return offset + selection.anchor.offset;
        }

        offset += $isTextNode(leaf) || $isLineBreakNode(leaf) ? leaf.getTextContentSize() : 0;
    }

    return null;
}

/**
 * Puts a collapsed caret at an offset in a run's text, or at the run's end
 * when its text is shorter.
 *
 * @param nodes - The run's nodes.
 * @param offset - The offset in the run's text content.
 */
function $selectInRun(nodes: readonly LexicalNode[], offset: number): void {
    let remaining = offset;
    let last: TextNode | null = null;

    for (const { node: leaf } of nodes.flatMap((node) => $dfs(node))) {
        if ($isTextNode(leaf) && remaining <= leaf.getTextContentSize()) {
            leaf.select(remaining, remaining);

            return;
        }

        if ($isTextNode(leaf)) {
            last = leaf;
        }

        remaining -= $isTextNode(leaf) || $isLineBreakNode(leaf) ? leaf.getTextContentSize() : 0;
    }

    last?.select();
}

// ---------------------------------------------------------------- constructs kept as written

/**
 * Turns into ordinary content the runs of each construct kept as written
 * ({@link keptSourceState}) that no longer stands whole in a block — an
 * edit took some of its runs away, or changed an image in it — so they show
 * and save as what they are now, and the block's other rules apply to them.
 *
 * @param container - The block.
 * @returns The keys of the nodes the runs now are.
 */
function $dissolveBrokenKeptConstructs(container: ElementNode): string[] {
    const leaves = $inlineLeaves(container);
    const dissolved: string[] = [];

    for (let index = 0; index < leaves.length;) {
        const first = $getState(leaves[index]!, keptSourceState);

        if (first === null) {
            index += 1;

            continue;
        }

        let end = index + 1;

        while (end < leaves.length && $getState(leaves[end]!, keptSourceState)?.group === first.group
            && $getState(leaves[end]!, keptSourceState)!.index === first.index + end - index) {
            end += 1;
        }

        const run = leaves.slice(index, end);
        const intact = (leaf: LexicalNode): boolean => !$isMarkdownImageNode(leaf) || $getState(leaf, keptSourceState)!.shown === keptImageShown(leaf);

        if (first.index !== 0 || run.length !== first.size || !run.every(intact)) {
            dissolved.push(...run.map($dissolveKeptRun));
        }

        index = end;
    }

    return dissolved;
}

/**
 * Turns one run of a kept construct into ordinary content: a source run
 * into text showing the same, with its formats, style and span attribute
 * text; an image or line break loses its state.
 *
 * @param node - The run (any other leaf is left alone).
 * @returns The key of the node the run now is.
 */
function $dissolveKeptRun(node: LexicalNode): string {
    if ($getState(node, keptSourceState) === null) {
        return node.getKey();
    }

    if (!$isMarkdownSourceTextNode(node)) {
        $setState(node, keptSourceState, null);

        return node.getKey();
    }

    const text = $createTextNode(node.getTextContent());

    text.setFormat(node.getFormat());
    text.setStyle(node.getStyle());
    $setState(text, spanAttributesState, $getState(node, spanAttributesState));
    node.replace(text);

    return text.getKey();
}

/**
 * Gives whitespace between two parts of a bold, italic or struck run that
 * format, so they join: whitespace typed at a run's edge takes no format,
 * and the word typed after it with the format on brings it back into the
 * run. Only a plain text node of whitespace whose neighbours in the same
 * parent both carry the format, with its own span style, takes it, and only
 * one at the caret.
 *
 * @param container - The block.
 * @param near - The keys of the leaves at the caret.
 */
function $joinRunsAcrossWhitespace(container: ElementNode, near: ReadonlySet<string>): void {
    for (const leaf of $inlineLeaves(container)) {
        if (!near.has(leaf.getKey()) || !$isTextNode(leaf) || $isMarkdownSourceTextNode(leaf) || leaf.hasFormat("code") || /\S/.test(leaf.getTextContent())) {
            continue;
        }

        const before = leaf.getPreviousSibling();
        const after = leaf.getNextSibling();
        // In one styled span with them, so the run does not end at a span's edge, where the space would be trimmed again.
        const oneGroup = $isTextNode(before) && $isTextNode(after) && before.getStyle() === leaf.getStyle() && after.getStyle() === leaf.getStyle();

        for (const format of FLANKED_FORMATS) {
            if (oneGroup && !leaf.hasFormat(format) && before.hasFormat(format) && after.hasFormat(format)) {
                leaf.toggleFormat(format);
            }
        }
    }
}

/**
 * When a block holding a construct kept as written ({@link keptSourceState})
 * no longer reads back as shown — text typed or joined right next to the
 * construct changes how its source reads — turns every kept construct of
 * the block into ordinary text and tidies it, so the save writes what is
 * shown in the standard form.
 *
 * @param container - The block.
 * @param tidy - Tidies the block's runs again once the constructs are ordinary text, given the keys of the nodes their runs now are.
 */
function $dissolveMisreadKeptConstructs(container: ElementNode, tidy: (dissolved: ReadonlySet<string>) => void): void {
    const kept = $inlineLeaves(container).filter((leaf) => $getState(leaf, keptSourceState) !== null);

    if (kept.length > 0 && !$readsBackAsShown(container)) {
        tidy(new Set(kept.map($dissolveKeptRun)));
    }
}

// ---------------------------------------------------------------- characters a format cannot hold

/**
 * Takes the span style off each `[` and `]` of a styled text, and the
 * underline off each `+` of an underlined one: the styled span's grammar
 * (`[^[\]]+`) cannot hold a bracket, nor underline's (`++([^+]+)++`) a plus
 * sign, so the save writes them outside the span or the underline, and the
 * editor shows them so as soon as they are typed or pasted there. The
 * format and style commands decline to make such text in the first place
 * ({@link $editWritably}); this keeps every other edit honest.
 *
 * @param node - A text node that changed.
 */
function $keepUnwritableCharactersPlain(node: TextNode): void {
    const text = node.getTextContent();
    const styled = node.getStyle() !== "";
    const underlined = node.hasFormat("underline");
    const unwritable = (char: string): boolean => (styled && (char === "[" || char === "]")) || (underlined && char === "+");
    const offsets = text.split("").flatMap((char, index) => (unwritable(char) ? [index, index + 1] : []));

    if (offsets.length === 0) {
        return;
    }

    for (const part of node.splitText(...offsets)) {
        const char = part.getTextContent();

        if (char.length === 1 && unwritable(char)) {
            if (char === "+") {
                part.toggleFormat("underline");
            } else {
                part.setStyle("");
            }
        }
    }
}

// ---------------------------------------------------------------- inline edits

/**
 * The formats whose delimiters CommonMark's flanking rules (GFM
 * strikethrough's too) keep from standing next to whitespace inside them:
 * an opening one cannot be followed by whitespace, a closing one preceded
 * by it. Underline's grammar has no such rule, and code is a span.
 */
const FLANKED_FORMATS: readonly TextFormatType[] = ["bold", "italic", "strikethrough"];

/** Where a selection point sits: the child indices from the root to its node, its offset and type. */
interface PointPath {
    readonly path: readonly number[];
    readonly offset: number;
    readonly type: "text" | "element";
}

/**
 * Runs an edit of the selected text — a format, a style, a link, a typing
 * shortcut's format — so that it never leaves what a save cannot write as
 * shown. Bold, italic and strikethrough are first taken off whitespace at
 * either edge of each run of them in the blocks the edit touched
 * ({@link $keepMarksOffEdgeWhitespace}), which trims a selection's edge
 * spaces off the format and clears a format put on whitespace alone. Then,
 * when a block the edit touched no longer reads back as shown
 * ({@link $readsBackAsShown}) though it did before — emphasis whose content
 * starts with punctuation right after a letter or ends with it right before
 * one (`x**(a)**b`), underline over a `+`, a styled span holding a bracket —
 * the edit is declined: those blocks get their content back as it was
 * (their own nodes kept), and the selection where it was. The declining
 * update is tagged historic, so it adds no undo step and the typing
 * shortcuts do not run on it.
 *
 * @param edit - The edit; runs inside the update, against the selection.
 * @param applies - Read after the edit: whether it did anything to check
 *   (a typing shortcut's update runs on every keystroke but changes
 *   something only when the shortcut fires); always, when omitted.
 * @returns `false` when the edit was declined.
 */
export function $editWritably(edit: () => void, applies: () => boolean = () => true): boolean {
    const written = $editOrRestore(edit, applies);

    if (!written) {
        $addUpdateTag(HISTORIC_TAG);
    }

    return written;
}

/**
 * {@link $editWritably}'s edit, check and restore, without the historic tag:
 * for a caller making several such edits in one update
 * ({@link $formatCellsWritably}), which is historic only when every one of
 * them was declined.
 *
 * @param edit - The edit; runs inside the update, against the selection.
 * @param applies - Read after the edit: whether it did anything to check.
 * @returns `false` when the edit was declined and its blocks restored.
 */
function $editOrRestore(edit: () => void, applies: () => boolean): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        edit();

        return true;
    }

    const containers = $selectedContainers(selection).map((container) => ({
        node: container,
        inTableCell: $findMatchingParent(container, $isTableCellNode) !== null,
        json: $exportTree(container) as SerializedElementNode,
    }));
    const points = [$pointPath(selection.anchor), $pointPath(selection.focus)] as const;

    edit();

    const applied = applies();

    if (!applied) {
        return true;
    }

    const touched = containers.filter(({ node }) => node.isAttached());

    touched.forEach(({ node }) => $keepMarksOffEdgeWhitespace(node));

    const unwritable = touched.filter(({ node, inTableCell, json }) => !$readsBackAsShown(node, inTableCell)
        && $readsBackAsShown($parseKeepingItemParagraphs(json), inTableCell));

    if (unwritable.length === 0) {
        return true;
    }

    for (const { node, json } of touched) {
        node.splice(0, node.getChildrenSize(), json.children.map($parseKeepingItemParagraphs));
    }

    $restoreSelection(points[0], points[1]);

    return false;
}

/**
 * `FORMAT_TEXT_COMMAND` handler formatting a range selection through
 * {@link $editWritably}, so the keyboard shortcuts and the toggles alike
 * leave no format the save cannot write. A selection a format must not
 * touch at all is left to `declines` (the raw-block and source-run rules),
 * which swallows the command. Registered at {@link COMMAND_PRIORITY_HIGH},
 * ahead of `registerRichText`'s own handler, which formats the same way.
 * Whether the toggle puts the format on or takes it off is read by
 * {@link $selectionHasFormat}, not from the formats Lexical caches on the
 * selection: those count the spaces at the selection's edges, which the
 * format never stays on, so a word just made bold with the spaces around it
 * selected would read as not bold and the next toggle would bold it again.
 *
 * A table selection is formatted here too, one cell at a time under the
 * same rules ({@link $formatCellsWritably}), rather than left to Lexical's
 * table plugin, whose own handler formats the cells with neither check.
 *
 * @param format - The format to toggle.
 * @param declines - Whether a range selection declines formatting outright.
 * @param takesFormat - Whether a cell of a table selection is formatted: one
 *   holding text to carry a format, and nothing `declines` would rule out
 *   for a range over its content.
 * @returns Whether the command was handled.
 */
export function $formatWritably(format: TextFormatType, declines: () => boolean, takesFormat: (cell: TableCellNode) => boolean): boolean {
    const selection = $getSelection();

    if ($isTableSelection(selection)) {
        $formatCellsWritably(selection, format, takesFormat);

        return true;
    }

    const declined = declines();

    if (declined) {
        return true;
    }

    if (!$isRangeSelection(selection)) {
        return false;
    }

    const on = $selectionHasFormat(selection, format);

    $editWritably(() => {
        // The format to align every selected node to: off where it is on, on where it is not.
        $formatText(selection, format, on ? 0 : TEXT_TYPE_TO_FORMAT[format]);
    });

    return true;
}

/**
 * Formats the cells of a table selection one at a time, each as a range
 * selection over the cell's whole content is formatted, so a cell obeys the
 * rules a range does: a cell `takesFormat` rules out (an empty one, one
 * holding an image alone or a run kept as source) is left as it is, and so
 * is one the format would leave unwritable, which gets its content back
 * ({@link $editOrRestore}). The format comes off when the cells taking it
 * have it on ({@link cellsHaveFormat}), and goes on otherwise. Which cells
 * take it shows only once it is put on, so a press reads every cell first,
 * and when a cell that then declines was all that kept the format from
 * reading on, takes it off the others instead. The update is historic only
 * when cells were formatted and every one of them declined, as a declined
 * range is. The cells stay selected.
 *
 * @param selection - The table selection.
 * @param format - The format to toggle.
 * @param takesFormat - Whether a selected cell is formatted.
 */
function $formatCellsWritably(selection: TableSelection, format: TextFormatType, takesFormat: (cell: TableCellNode) => boolean): void {
    const cells = selection.getNodes().filter($isTableCellNode).filter(takesFormat);
    const carries = cells.map((cell) => $countedCarries($cellContentRange(cell), format));
    const on = cellsHaveFormat(carries);
    const taking = $formatCellsOrRestore(cells, format, !on);
    // As read before the press: putting the format on changed nothing in the cells that took it, so it comes off them.
    const onWhereTaken = !on && cellsHaveFormat(carries.filter((_, index) => taking.includes(cells[index]!)));

    if (onWhereTaken) {
        $formatCellsOrRestore(taking, format, false);
    }

    const allDeclined = cells.length > 0 && taking.length === 0;

    if (allDeclined) {
        $addUpdateTag(HISTORIC_TAG);
    }

    $setSelection(selection);
}

/**
 * Puts a format on the whole content of each of some table cells, or takes
 * it off, one cell at a time as a range over that content is formatted
 * ({@link $editOrRestore}). Leaves the selection on the last cell.
 *
 * @param cells - The cells.
 * @param format - The format.
 * @param put - `true` to put the format on, `false` to take it off.
 * @returns The cells that took the edit: every one but those declined, which have their content back.
 */
function $formatCellsOrRestore(cells: readonly TableCellNode[], format: TextFormatType, put: boolean): TableCellNode[] {
    return cells.filter((cell) => {
        const range = $cellContentRange(cell);

        $setSelection(range);

        return $editOrRestore(() => {
            $formatText(range, format, put ? TEXT_TYPE_TO_FORMAT[format] : 0);
        }, () => true);
    });
}

/**
 * Whether table cells have a format on: every character the format counts
 * on ({@link $countedCarries}) carries it, and there is one. Read from the
 * cells' text, never from the formats Lexical caches on a selection: a range
 * made here over a cell's content ({@link $cellContentRange}) has none
 * cached, so reading them would call underline and inline code off however
 * the text is formatted, and a press could never take either off. A cell
 * with no character counted (spaces alone, for a format that never stays on
 * them) decides nothing.
 *
 * @param carries - Each cell's flags, one per character the format counts on.
 * @returns `true` when the format is on.
 */
function cellsHaveFormat(carries: readonly string[]): boolean {
    const counted = carries.join("");

    return counted !== "" && !counted.includes("0");
}

/**
 * The range over a table cell's whole content, from the start of its first
 * leaf to the end of its last, as a drag across the cell's text makes it —
 * but without the formats Lexical caches on a dragged selection, so what
 * formats the content carries is read from its text ({@link $countedCarries}).
 * Finding the two ends moves the editor's selection; the caller sets the
 * selection it wants afterwards.
 *
 * @param cell - The cell.
 * @returns The range, not set as the selection; collapsed for an empty cell.
 */
function $cellContentRange(cell: TableCellNode): RangeSelection {
    const range = $createRangeSelection();
    const start = cell.selectStart().anchor;

    range.anchor.set(start.key, start.offset, start.type);

    const end = cell.selectEnd().focus;

    range.focus.set(end.key, end.offset, end.type);

    return range;
}

/**
 * A stretch of selected text, for {@link $selectionHasFormat}: its text, and
 * one flag per character, `1` where it carries the format and `0` where not.
 */
interface SelectedStretch {
    text: string;
    carries: string;
}

/**
 * Whether a selection has a format on, as the format toggles, the toolbar
 * and the context menu read it. Bold, italic and strikethrough never stay on
 * whitespace at a run's edge ({@link $keepMarksOffEdgeWhitespace}), so
 * whitespace where the run the toggle would make could end does not count:
 * at either end of each stretch of selected text that run cannot end inside
 * ({@link $selectedStretches}). The format is on when every character left
 * carries it. A selection of such whitespace alone, or a collapsed one,
 * reads the formats Lexical keeps on the selection, as do code and
 * underline, which are never trimmed. So on a selection holding text other
 * than such whitespace, a press the writing rules do not decline always
 * changes something: putting the format on lands on a character the
 * trimming keeps it on, and taking it off finds a character to take it from.
 *
 * @param selection - The selection.
 * @param format - The format.
 * @returns `true` when the format is on.
 */
export function $selectionHasFormat(selection: RangeSelection, format: TextFormatType): boolean {
    const trimmed = FLANKED_FORMATS.includes(format);
    const collapsed = selection.isCollapsed();

    if (collapsed || !trimmed) {
        return selection.hasFormat(format);
    }

    const counted = $countedCarries(selection, format);

    return counted === "" ? selection.hasFormat(format) : !counted.includes("0");
}

/**
 * The characters of a selection a format counts on, as one flag each: `1`
 * where the character carries the format, `0` where not. For bold, italic
 * and strikethrough that leaves out the whitespace at either end of each
 * stretch of selected text ({@link $selectedStretches}), which they never
 * stay on; underline and code count every selected character.
 *
 * @param selection - The selection.
 * @param format - The format.
 * @returns The flags, empty when no selected character counts.
 */
function $countedCarries(selection: RangeSelection, format: TextFormatType): string {
    const trimmed = FLANKED_FORMATS.includes(format);

    return $selectedStretches(selection, format).map(({ text, carries }) => {
        if (!trimmed) {
            return carries;
        }

        const first = text.search(/\S/);

        return first === -1 ? "" : carries.slice(first, text.search(/\s*$/));
    }).join("");
}

/**
 * The selected text of a selection, in stretches the run of a format put on
 * the whole selection could not end inside: text of one block, unbroken by
 * any other leaf, by a run whose source writes the format, or by a link or
 * span-style edge where the run would end ({@link runBreaksBetween}, with the
 * groups the format would not cover once put on the selection).
 *
 * @param selection - The selection.
 * @param format - The format.
 * @returns The stretches, in no particular order.
 */
function $selectedStretches(selection: RangeSelection, format: TextFormatType): SelectedStretch[] {
    const slices = $selectedSlices(selection);
    const stretches: SelectedStretch[] = [];

    for (const block of $selectedContainers(selection)) {
        const leaves = $inlineLeaves(block);
        const groups = $leafGroups(leaves);
        const uncovered = uncoveredGroups(groups, leaves.map((leaf) => $carriesOnceFormatted(leaf, slices, format)));
        let stretch: SelectedStretch | null = null;

        for (const [index, leaf] of leaves.entries()) {
            const slice = slices.get(leaf.getKey());
            const text = slice !== undefined && $isTextNode(leaf) && !$sourceWritesFormat(leaf, format) ? leaf : null;
            const continues = stretch !== null && text !== null && !runBreaksBetween(groups[index - 1]!, groups[index]!, uncovered);

            if (!continues) {
                stretch = text === null ? null : { text: "", carries: "" };
            }

            if (stretch === null || text === null) {
                continue;
            }

            if (!continues) {
                stretches.push(stretch);
            }

            const selected = text.getTextContent().slice(slice![0], slice![1]);

            stretch.text += selected;
            stretch.carries += (text.hasFormat(format) ? "1" : "0").repeat(selected.length);
        }
    }

    return stretches;
}

/**
 * A range selection's two points in document order — where it starts, then
 * where it ends — whichever way it was made.
 *
 * @param selection - The selection.
 * @returns Its start point, then its end point.
 */
export function $orderedPoints(selection: RangeSelection): [PointType, PointType] {
    return selection.isBackward() ? [selection.focus, selection.anchor] : [selection.anchor, selection.focus];
}

/**
 * The characters of each text node a selection covers, as Lexical's own
 * format toggle reads them: the node's whole text, cut at the selection's
 * text points.
 *
 * @param selection - The selection.
 * @returns Each covered text node's `[from, to)` offsets, by node key.
 */
export function $selectedSlices(selection: RangeSelection): Map<string, readonly [number, number]> {
    const [start, end] = $orderedPoints(selection);
    const slices = new Map<string, readonly [number, number]>();

    for (const node of selection.getNodes().filter($isTextNode)) {
        const from = start.type === "text" && start.key === node.getKey() ? start.offset : 0;
        const to = end.type === "text" && end.key === node.getKey() ? end.offset : node.getTextContentSize();

        slices.set(node.getKey(), [from, to]);
    }

    return slices;
}

/**
 * Whether a leaf carries a format into a run once the format is put on a
 * selection: a text node the selection covers whole, or one carrying it
 * already, unless its own source writes the format ({@link $markRuns}).
 *
 * @param leaf - The leaf.
 * @param slices - The selection's text, by node ({@link $selectedSlices}).
 * @param format - The format.
 * @returns `true` when the leaf carries the format.
 */
function $carriesOnceFormatted(leaf: LexicalNode, slices: ReadonlyMap<string, readonly [number, number]>, format: TextFormatType): boolean {
    const slice = slices.get(leaf.getKey());
    const covered = slice !== undefined && slice[0] === 0 && slice[1] === leaf.getTextContentSize();

    return $isTextNode(leaf) && !$sourceWritesFormat(leaf, format) && (covered || leaf.hasFormat(format));
}

/**
 * The blocks holding inline content that a selection touches: the nearest
 * block of each selected node and of each end.
 *
 * @param selection - The selection.
 * @returns The blocks, without repeats.
 */
function $selectedContainers(selection: RangeSelection): ElementNode[] {
    const nodes = [selection.anchor.getNode(), selection.focus.getNode(), ...selection.getNodes()];
    const containers = new Set<ElementNode>();

    for (const node of nodes) {
        const block = $findEnclosingBlock(node);

        if (block !== null) {
            containers.add(block);
        }
    }

    return [...containers];
}

/**
 * Exports a node and its descendants to JSON, as Lexical's own document
 * export does node by node.
 *
 * @param node - The node.
 * @returns Its JSON, children included.
 */
function $exportTree(node: LexicalNode): SerializedLexicalNode {
    const json = node.exportJSON();

    return $isElementNode(node) ? { ...json, children: node.getChildren().map($exportTree) } as SerializedLexicalNode : json;
}

/**
 * Records where a selection point sits, by child index from the root, so it
 * can be found again in content rebuilt from JSON.
 *
 * @param point - The point.
 * @returns Its path.
 */
function $pointPath(point: PointType): PointPath {
    const path: number[] = [];

    for (let node: LexicalNode | null = point.getNode(); node !== null && !$isRootNode(node); node = node.getParent()) {
        path.unshift(node.getIndexWithinParent());
    }

    return { path, offset: point.offset, type: point.type };
}

/**
 * Sets the selection to two recorded points.
 *
 * @param anchor - The anchor's path.
 * @param focus - The focus's path.
 */
function $restoreSelection(anchor: PointPath, focus: PointPath): void {
    const node = (point: PointPath): LexicalNode => point.path.reduce<LexicalNode>(
        (parent, index) => (parent as ElementNode).getChildAtIndex(index) ?? parent, $getRoot());
    const selection = $createRangeSelection();

    selection.anchor.set(node(anchor).getKey(), anchor.offset, anchor.type);
    selection.focus.set(node(focus).getKey(), focus.offset, focus.type);
    $setSelection(selection);
}

/**
 * The writing groups a leaf sits in, as the serializer groups a block's
 * content: the link around it, and the run of one span style it belongs to
 * (`""` for unstyled text). A mark that does not cover a whole group closes
 * before the group and opens again inside it.
 */
interface LeafGroups {
    readonly link: string;
    readonly style: string;
}

/**
 * Takes bold, italic and strikethrough off the whitespace at either edge of
 * each run of them in a block, since a delimiter cannot stand against
 * whitespace inside it; whitespace between two parts of a run keeps it. A
 * run is consecutive text carrying the format, across a link or styled span
 * only where the format covers all of it — the serializer writes a mark
 * covering part of a link or span inside it, so the run ends at its edge.
 *
 * @param container - The block.
 */
function $keepMarksOffEdgeWhitespace(container: ElementNode): void {
    for (const format of FLANKED_FORMATS) {
        $markRuns(container, format).forEach((run) => $trimRunEdges(run, format));
    }
}

/**
 * The runs of one format in a block: consecutive text carrying it, across a
 * link or styled span only where the format covers all of it.
 *
 * @param container - The block.
 * @param format - The format.
 * @returns The runs, each its text nodes in order.
 */
function $markRuns(container: ElementNode, format: TextFormatType): TextNode[][] {
    const leaves = $inlineLeaves(container);
    const groups = $leafGroups(leaves);
    const runs: TextNode[][] = [];
    let run: TextNode[] = [];

    // A run whose own source writes the format (a nested link's, a kept construct's) carries it inside that source:
    // the delimiters around a run of it close before it and open again after it.
    const carries = (leaf: LexicalNode): leaf is TextNode => $isTextNode(leaf) && leaf.hasFormat(format) && !$sourceWritesFormat(leaf, format);
    const uncovered = uncoveredGroups(groups, leaves.map(carries));

    leaves.forEach((leaf, index) => {
        const carriesFormat = carries(leaf);

        if (run.length > 0 && (!carriesFormat || (index > 0 && runBreaksBetween(groups[index - 1]!, groups[index]!, uncovered)))) {
            runs.push(run);
            run = [];
        }

        if (carriesFormat) {
            run.push(leaf as TextNode);
        }
    });

    return run.length > 0 ? [...runs, run] : runs;
}

/**
 * Takes bold, italic and strikethrough off the punctuation at a run's edge
 * where a delimiter could not stand: an opening delimiter before
 * punctuation needs whitespace or punctuation before it, a closing one
 * after punctuation needs it after (CommonMark's flanking rules, which GFM
 * strikethrough shares), so `x` then bold `(a)` saves as literal asterisks.
 * The run shrinks until its edges can be written — `x(` then bold `a` then
 * `)` — a code span or a source run at the edge losing the format whole.
 * The format commands decline such a run instead ({@link $editWritably});
 * this tidies what a paste, a deletion or a split leaves.
 *
 * @param container - The block.
 * @param tildeIsLetter - Whether a `~` next to a `*` delimiter counts as a
 *   letter, as `marked` reads a lone one; `false` reads it as the punctuation
 *   it is once escaped.
 */
function $keepMarksFlanking(container: ElementNode, tildeIsLetter: boolean = true): void {
    for (const format of FLANKED_FORMATS) {
        const delimiter = format === "strikethrough" ? "~" : "*";
        let changed = true;

        while (changed) {
            changed = $markRuns(container, format).some((run) =>
                $trimUnflankedEdge(container, run[0]!, format, delimiter, "start", tildeIsLetter)
                || $trimUnflankedEdge(container, run[run.length - 1]!, format, delimiter, "end", tildeIsLetter));
        }
    }
}

/**
 * Takes a format off one edge of a run when its delimiter could not stand
 * there: the edge character is punctuation — a link's bracket where the
 * format covers the whole link, written outside it — and the character
 * outside the run is neither whitespace nor punctuation.
 *
 * @param container - The block.
 * @param node - The run's first or last text node.
 * @param format - The format.
 * @param delimiter - The delimiter character the format is written with.
 * @param edge - Which edge of the run.
 * @param tildeIsLetter - Whether a `~` next to a `*` delimiter counts as a letter ({@link $keepMarksFlanking}).
 * @returns `true` when the format was taken off something.
 */
function $trimUnflankedEdge(
    container: ElementNode, node: TextNode, format: TextFormatType, delimiter: string, edge: "start" | "end", tildeIsLetter: boolean = true,
): boolean {
    const leaves = $inlineLeaves(container);
    const outside = leaves[leaves.indexOf(node) + (edge === "start" ? -1 : 1)];
    const link = $findMatchingParent(node, $isLinkNode);
    const linkLeaves = link === null ? [] : $inlineLeaves(link);
    // A format covering a whole link is written outside it, its delimiter against the link's `[` or `)`.
    const wholeLink = link !== null && (edge === "start" ? linkLeaves[0] : linkLeaves.at(-1)) === node
        && linkLeaves.every((leaf) => $isTextNode(leaf) && leaf.hasFormat(format));
    const written = wholeLink ? (edge === "start" ? "[" : ")") : $writtenText(node);
    const char = (edge === "start" ? written[0] : written.at(-1)) ?? "";
    const neighbour = outside === undefined ? " " : (edge === "start" ? $writtenText(outside).at(-1) : $writtenText(outside)[0]) ?? " ";
    const punctuation = (c: string): boolean => /^[\p{P}\p{S}]$/u.test(c) && !(tildeIsLetter && delimiter === "*" && c === "~");

    const unit = wholeLink ? linkLeaves : [node];

    if (!punctuation(char) || /\s/.test(neighbour) || punctuation(neighbour) || unit.some((leaf) => $sourceWritesFormat(leaf, format))) {
        return false;
    }

    if (wholeLink) {
        linkLeaves.forEach((leaf) => (leaf as TextNode).toggleFormat(format));

        return true;
    }

    if (node.hasFormat("code") || $isMarkdownSourceTextNode(node) || node.getTextContentSize() === 1) {
        node.toggleFormat(format);

        return true;
    }

    const parts = node.splitText(edge === "start" ? 1 : node.getTextContentSize() - 1);

    (edge === "start" ? parts[0]! : parts[1]!).toggleFormat(format);

    return true;
}

/**
 * Whether a format on a node is written by the node's own source — a run of
 * a link nested in a link writes the formats inside its outer link
 * (`nestedLinkState`), a run of a construct kept as written those inside the
 * construct ({@link keptSourceState}) — so taking it off would change what
 * the editor shows but not what is saved.
 *
 * @param node - The text node.
 * @param format - The format.
 * @returns `true` when the node's source writes the format.
 */
function $sourceWritesFormat(node: LexicalNode, format: TextFormatType): boolean {
    if (!$isMarkdownSourceTextNode(node)) {
        return false;
    }

    const written = $getState(node, keptSourceState)?.writes ?? $getState(node, nestedLinkState);

    return written !== -1 && (written & TEXT_TYPE_TO_FORMAT[format]) !== 0;
}

/**
 * The text a leaf writes, as far as its edges go: a code span's backtick, a
 * source run's source, an image's closing parenthesis, a line break's or a
 * nested block's line end.
 *
 * @param leaf - The leaf.
 * @returns Its written text, or the characters that stand for its edges.
 */
function $writtenText(leaf: LexicalNode): string {
    if ($isMarkdownSourceTextNode(leaf)) {
        return leaf.getSource();
    }

    if ($isTextNode(leaf)) {
        return leaf.hasFormat("code") ? "`" : leaf.getTextContent();
    }

    return $isDecoratorNode(leaf) ? "!)" : "\n";
}

/**
 * The writing groups of a block's leaves ({@link LeafGroups}), as ids: a
 * link by its node key, a span-style run by its position.
 *
 * @param leaves - The block's inline leaves, in order.
 * @returns One entry per leaf; `""` where it sits in no link or style.
 */
function $leafGroups(leaves: readonly LexicalNode[]): LeafGroups[] {
    let styleRun = 0;
    let previous: { link: string; style: string } | null = null;

    return leaves.map((leaf) => {
        const link = $findMatchingParent(leaf, $isLinkNode)?.getKey() ?? "";
        const style = $isTextNode(leaf) ? leaf.getStyle() : "";

        if (previous === null || previous.link !== link || previous.style !== style) {
            styleRun += 1;
        }

        previous = { link, style };

        return { link: link === "" ? "" : `link:${link}`, style: style === "" ? "" : `style:${styleRun}` };
    });
}

/**
 * The writing groups a format does not cover throughout: those holding a
 * leaf that does not carry it.
 *
 * @param groups - The block's leaves' groups ({@link $leafGroups}).
 * @param carries - Per leaf, whether it carries the format.
 * @returns The ids of the groups holding a leaf without the format.
 */
function uncoveredGroups(groups: readonly LeafGroups[], carries: readonly boolean[]): Set<string> {
    const uncovered = new Set<string>();

    groups.forEach((group, index) => {
        if (!carries[index]) {
            uncovered.add(group.link);
            uncovered.add(group.style);
        }
    });

    return uncovered;
}

/**
 * Whether a run of a format ends between two leaves: one of the writing
 * groups left or entered there is not covered by the format throughout.
 *
 * @param before - The first leaf's groups.
 * @param after - The second leaf's groups.
 * @param uncovered - The ids of the groups holding a leaf without the format.
 * @returns `true` when the run ends.
 */
function runBreaksBetween(before: LeafGroups, after: LeafGroups, uncovered: ReadonlySet<string>): boolean {
    const crossed = [
        ...(before.link === after.link ? [] : [before.link, after.link]),
        ...(before.style === after.style ? [] : [before.style, after.style]),
    ];

    return crossed.some((group) => group !== "" && uncovered.has(group));
}

/**
 * Takes a format off the whitespace at the end and then the start of one
 * run of it, splitting a text whose edge alone is whitespace. A code span
 * is not whitespace, and a source run splits never: one holding only
 * whitespace (a soft break) loses the format whole.
 *
 * @param run - The run's text nodes, in order.
 * @param format - The format.
 */
function $trimRunEdges(run: TextNode[], format: TextFormatType): void {
    let last = run.length - 1;

    for (; last >= 0; last -= 1) {
        const kept = $trimEdge(run[last]!, format, "end");

        if (kept !== null) {
            run[last] = kept;

            break;
        }
    }

    for (let first = 0; first <= last; first += 1) {
        if ($trimEdge(run[first]!, format, "start") !== null) {
            break;
        }
    }
}

/**
 * Takes a format off the whitespace at one edge of a text node.
 *
 * @param node - The text node.
 * @param format - The format.
 * @param edge - Which edge.
 * @returns The part of the node that keeps the format, or `null` when the
 *   node was whitespace through and lost it.
 */
function $trimEdge(node: TextNode, format: TextFormatType, edge: "start" | "end"): TextNode | null {
    const text = node.getTextContent();

    // A kept construct's run, whitespace or not, keeps its formats: the construct is written as its source.
    if (node.hasFormat("code") || ($isMarkdownSourceTextNode(node) && /\S/.test(node.getSource())) || $sourceWritesFormat(node, format)
        || $getState(node, keptSourceState) !== null) {
        return node;
    }

    const whitespace = (edge === "start" ? /^\s*/ : /\s*$/).exec(text)![0].length;

    if (whitespace === 0) {
        return node;
    }

    if (whitespace === text.length || $isMarkdownSourceTextNode(node)) {
        node.toggleFormat(format);

        return null;
    }

    const [first, second] = node.splitText(edge === "start" ? whitespace : text.length - whitespace);
    const [trimmed, kept] = edge === "start" ? [first!, second!] : [second!, first!];

    trimmed.toggleFormat(format);

    return kept;
}
