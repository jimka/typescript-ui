// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Insets } from "~/primitive/Insets.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import { Card } from "~/layout/Card.js";
import { Dialog, DialogButtons } from "~/overlay/Dialog.js";
import { Menu } from "~/overlay/Menu.js";
import { Notification } from "~/overlay/Notification.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { buildClipboardMenuItems } from "~/component/shared/buildClipboardMenuItems.js";
import { CheckboxMenuRow } from "~/component/container/CheckboxMenuRow.js";
import { CodeEditor } from "~/component/editor/CodeEditor.js";
import type { CodeEditorChange } from "~/component/editor/CodeEditor.js";
import { TextField } from "~/component/input/TextField.js";
import {
    createEditor, FORMAT_TEXT_COMMAND, $getSelection, $isRangeSelection, $getRoot,
    $createParagraphNode, KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH, SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
    PASTE_COMMAND, DELETE_CHARACTER_COMMAND, $createTextNode, $copyNode, $isLineBreakNode, $getState,
    IS_ALL_FORMATTING, $isTextNode, TEXT_TYPE_TO_FORMAT, $hasUpdateTag, HISTORY_PUSH_TAG,
    $getNearestNodeFromDOMNode, isDOMNode, $findMatchingParent, $isElementNode, $isParagraphNode, $isRootNode,
    $caretFromPoint, $normalizeCaret, $setPointFromCaret,
} from "lexical";
import type {
    LexicalEditor, ElementNode, ElementFormatType, LexicalNode, TextFormatType, TextNode, BaseSelection,
    CommandListener, LexicalCommand, CommandListenerPriority, UpdateListener, ParagraphNode, RangeSelection, EditorUpdateOptions,
    NodeKey,
} from "lexical";
import { registerMarkdownShortcuts } from "@lexical/markdown";
import { registerRichText, $createHeadingNode, $createQuoteNode, QuoteNode, $isQuoteNode } from "@lexical/rich-text";
import type { HeadingTagType } from "@lexical/rich-text";
import {
    registerList, INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, ListNode, $isListNode,
} from "@lexical/list";
import { $toggleLink, $isLinkNode } from "@lexical/link";
import type { LinkNode } from "@lexical/link";
import { CodeNode, $createCodeNode, $isCodeNode } from "@lexical/code";
import { registerHistory, createEmptyHistoryState } from "@lexical/history";
import {
    TableNode, TableCellNode, registerTablePlugin, registerTableSelectionObserver,
    $getTableCellNodeFromLexicalNode, $getTableNodeFromLexicalNodeOrThrow, $computeTableMap,
    $insertTableRowAtSelection, $deleteTableRowAtSelection,
    $insertTableColumnAtSelection, $deleteTableColumnAtSelection,
    $getTableColumnIndexFromTableCellNode, $isTableCellNode, $isTableRowNode,
    $isTableSelection, $mergeCells, $unmergeCell,
    INSERT_TABLE_COMMAND,
} from "@lexical/table";
import { mergeRegister, $getNearestNodeOfType } from "@lexical/utils";
import { $setBlocksType, $patchStyleText, $copyBlockFormatIndent } from "@lexical/selection";
import { SHORTCUT_TRANSFORMERS } from "~/component/editor/markdownTransformers.js";
import { $importMarkdown } from "~/component/editor/markdownImporter.js";
import { $serializeBlock, $serializeInlineNodes, $serializeMarkdown } from "~/component/editor/markdownSerializer.js";
import {
    $editWritably, $findEnclosingBlock, $formatWritably, $orderedPoints, $selectionHasFormat, RUN_EDGE_TAG, registerWritableStateRules,
} from "~/component/editor/markdownWritable.js";
import { EMPTY_SOURCE_MAP } from "~/component/editor/markdownSourceMap.js";
import type { MarkdownSourceBlock, MarkdownSourceMap } from "~/component/editor/markdownSourceMap.js";
import {
    $createMarkdownRawBlockNode, $isMarkdownRawBlockNode, $isMarkdownSourceTextNode, MarkdownRawBlockNode,
} from "~/component/editor/markdownSourceNodes.js";
import { keptSourceState, nestedLinkState } from "~/component/editor/markdownNodeState.js";
import { EDITOR_NODES } from "~/component/editor/editorNodes.js";
import { EDITOR_THEME, ensureMarkdownEditorClassRules } from "~/component/editor/editorTheme.js";
import {
    MarkdownBlockNode, $createMarkdownBlockNode, $isMarkdownBlockNode, $createMarkdownColumnNode,
} from "~/component/editor/markdownBlockNode.js";
import { $createMarkdownImageNode } from "~/component/editor/markdownImageNode.js";
import { cssTextToAttributes, resolveImageSpec } from "~/component/display/markdownAttributes.js";
import {
    BOLD_SOURCE, ITALIC_SOURCE, UNDERLINE_SOURCE, STRIKETHROUGH_SOURCE, INLINE_CODE_SOURCE,
    REMOVE_LINK_SOURCE, CLEAR_FORMAT_SOURCE, linkSource, spanStyleSource, readSourceSelectionState, imageSource,
} from "~/component/editor/markdownSourceEdits.js";
import type { MarkdownSourceTransform } from "~/component/editor/markdownSourceEdits.js";
import {
    FENCED_CODE_SOURCE, blockPrefixSource, listSource, paragraphAroundBlockSource, tableSource,
} from "~/component/editor/markdownSourceLines.js";

/**
 * The coalescing window (ms) for the undo/redo history: edits within this gap
 * merge into a single undo step, matching Lexical's own recommended default.
 */
const HISTORY_DELAY_MS = 300;

/**
 * The clipboard type Lexical writes its own copied nodes under (the
 * `@lexical/clipboard` copy format); a paste carrying it inserts those nodes.
 */
const LEXICAL_CLIPBOARD_TYPE = "application/x-lexical-editor";

/** Shown when a context-menu Paste finds the clipboard read unavailable. */
const CLIPBOARD_READ_DENIED_MESSAGE = "Clipboard read blocked by the browser — press Ctrl/Cmd+V to paste.";

/**
 * How long the clipboard-denied toast stays up (ms). Twice Notification's 3 s
 * default because this message asks the user to do something rather than just
 * reporting an outcome; 6 s is the duration the notifications recipe uses for
 * a `"warning"`.
 */
const CLIPBOARD_HINT_DURATION_MS = 6000;

/**
 * Payload of {@link MarkdownEditor}'s `"change"` event: the Markdown string
 * after the edit that triggered it.
 *
 * @category Components
 */
export interface MarkdownEditorChange {
    value: string;
}

/**
 * Payload of {@link MarkdownEditor}'s `"selectionstate"` event, and what
 * {@link MarkdownEditor.getSelectionState} returns: the five inline-format
 * flags, whether there's a selection to act on, the enclosing link's URL (if
 * any), table/column-alignment context, and block alignment/column count at
 * the current selection.
 *
 * @category Components
 */
export interface MarkdownEditorSelectionState {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    code: boolean;
    underline: boolean;
    /** Whether there's a real selection, or a collapsed caret that would expand into one. */
    hasSelectedText: boolean;
    /** The enclosing link's URL, or `null` outside one. */
    linkUrl: string | null;
    /** Whether the selection is anchored inside a table cell. */
    inTable: boolean;
    /** The caret's table column's alignment; `null` when {@link inTable} is `false`. */
    tableColumnAlignment: MarkdownTableAlignment | null;
    /** The enclosing `:::` block's alignment; `null` outside one, or when it carries none. */
    blockAlignment: MarkdownBlockAlignment | null;
    /** The enclosing `:::` block's column count; `1` outside one. */
    columnCount: number;
}

/**
 * The events {@link MarkdownEditor} exposes through its custom `on` / `off` surface:
 *
 * - `"change"` — the document content changed (payload {@link MarkdownEditorChange}).
 * - `"selectionstate"` — the selection's tracked format/table/block state
 *   changed (payload {@link MarkdownEditorSelectionState}); fires on every
 *   editor commit whose resulting state differs from the last reported one,
 *   including a format toggle that leaves the selection itself unmoved.
 */
type MarkdownEditorEvent = "change" | "selectionstate";

/**
 * The editing surface a {@link MarkdownEditor} currently shows: the WYSIWYG
 * rich-text surface, or the raw-Markdown source [`CodeEditor`](/api/component/editor/classes/CodeEditor).
 *
 * @category Components
 */
export type MarkdownEditorMode = "wysiwyg" | "source";

/**
 * A block type accepted by {@link MarkdownEditor.setBlockType}: a paragraph, one
 * of the six heading levels, a blockquote, or a fenced code block.
 *
 * @category Components
 */
export type MarkdownBlockType = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "code";

/**
 * A block alignment accepted by {@link MarkdownEditor.setBlockAlignment}.
 *
 * @category Components
 */
export type MarkdownBlockAlignment = "left" | "center" | "right" | "justify";

/**
 * A GFM table column's alignment: the three markers a delimiter row can carry,
 * plus `"none"` for a column with no marker.
 *
 * @category Components
 */
export type MarkdownTableAlignment = "left" | "center" | "right" | "none";

/**
 * Construction-time options for {@link MarkdownEditor}.
 *
 * @category Components
 */
export interface MarkdownEditorOptions extends ComponentOptions {
    /** Initial Markdown source (also accepted as the positional first argument). */
    value?: string;
    /** Whether the editor is read-only. Default `false`. */
    readOnly?: boolean;
    /** Which surface is shown. Default `"wysiwyg"`. */
    mode?: MarkdownEditorMode;
    /** Construction-time listener bag; the events are `"change"` and `"selectionstate"`. */
    listeners?: {
        change?:         (payload: MarkdownEditorChange) => void;
        selectionstate?: (payload: MarkdownEditorSelectionState) => void;
    };
}

/**
 * The `onError` handler for the Lexical editor: rethrows so a node/transform
 * fault surfaces loudly rather than being swallowed.
 *
 * @param error - The error Lexical reports.
 */
function reportEditorError(error: Error): void {
    throw error;
}

/**
 * Builds the Lexical block node a {@link MarkdownEditor.setBlockType} call
 * converts the selected blocks into.
 *
 * @param type - The requested block type.
 * @returns A freshly-created element node of that type.
 */
function createBlockNode(type: MarkdownBlockType): ElementNode {
    switch (type) {
        case "quote": return $createQuoteNode();
        case "code":  return $createCodeNode();
        case "paragraph": return $createParagraphNode();
        default:      return $createHeadingNode(type satisfies HeadingTagType);
    }
}

/**
 * `$setBlocksType`'s after-create hook for a conversion to a code block:
 * copies the block's format and indent, as the default hook does, and
 * replaces its inline content with that content's Markdown, so the code
 * block shows — and saves — the source of the formatting, links and images
 * it cannot hold, and nothing is lost. A raw block or a code block already
 * holds only its text and is left as it is.
 *
 * @param block - The block being converted; its children move into `code`.
 * @param code - The new code block.
 */
function $copyBlockAsCodeSource(block: ElementNode, code: ElementNode): void {
    $copyBlockFormatIndent(block, code);

    if ($isTextOnlyBlock(block)) {
        return;
    }

    const markdown = $serializeInlineNodes(block.getChildren());

    block.clear();

    if (markdown !== "") {
        block.append($createTextNode(markdown));
    }
}

/**
 * Builds the source-mode transform for a {@link MarkdownEditor.setBlockType}
 * call: `"code"` fences the selected blocks, and every other type converts
 * them to the block its prefix writes — `""` for `"paragraph"`, `"> "` for
 * `"quote"`, `"#".repeat(level) + " "` for `h1`–`h6` (see
 * `markdownSourceLines.ts`).
 *
 * @param type - The requested block type.
 * @returns The source-mode transform.
 */
function sourceTransformForBlockType(type: MarkdownBlockType): MarkdownSourceTransform {
    switch (type) {
        case "code":      return FENCED_CODE_SOURCE;
        case "paragraph": return blockPrefixSource("");
        case "quote":     return blockPrefixSource("> ");
        default:          return blockPrefixSource("#".repeat(Number(type.slice(1))) + " ");
    }
}

/**
 * Builds the `{ width?, height? }` attribute record `insertImage` passes to
 * `resolveImageSpec` / `imageSource`, from its own `options` parameter.
 *
 * @param options - The caller-supplied `width`/`height`, if any.
 * @returns The attribute record.
 */
function imageAttributes(options?: { width?: number; height?: number }): Record<string, string> {
    const attributes: Record<string, string> = {};

    if (options?.width !== undefined) {
        attributes.width = String(options.width);
    }

    if (options?.height !== undefined) {
        attributes.height = String(options.height);
    }

    return attributes;
}

/**
 * Finds the table cell containing the caret, if any.
 *
 * @returns The enclosing {@link TableCellNode}, or `null` when the selection
 *   is not a range selection anchored inside a table cell.
 */
function $getEnclosingTableCellNode(): TableCellNode | null {
    const selection = $getSelection();

    return $isRangeSelection(selection)
        ? $getTableCellNodeFromLexicalNode(selection.anchor.getNode())
        : null;
}

/**
 * Finds the table containing the current selection, if any.
 *
 * @returns The enclosing {@link TableNode}, or `null` when the selection is
 *   not a range selection anchored inside a table cell.
 */
function $getEnclosingTableNode(): TableNode | null {
    const cell = $getEnclosingTableCellNode();

    return cell === null ? null : $getTableNodeFromLexicalNodeOrThrow(cell);
}

/**
 * Whether the caret currently sits inside a table cell — the precondition for
 * the row/column helpers, which throw rather than no-op when it does not.
 *
 * @returns Whether the current selection is a range selection anchored inside
 *   a table cell.
 */
function $selectionIsInTableCell(): boolean {
    return $getEnclosingTableNode() !== null;
}

/**
 * Sums the header row's cells' column spans to get the table's total column
 * count — accurate even if a header cell were ever merged, unlike a bare
 * child count.
 *
 * @param table - The table to measure.
 * @returns The table's column count, or `0` when it has no rows.
 */
function $getTableColumnCount(table: TableNode): number {
    const headerRow = table.getFirstChild();

    if (!$isTableRowNode(headerRow)) {
        return 0;
    }

    return headerRow.getChildren()
        .filter($isTableCellNode)
        .reduce((sum, cell) => sum + cell.getColSpan(), 0);
}

/**
 * Reads a table cell's alignment as the GFM-expressible subset.
 *
 * @param cell - The cell to read.
 * @returns The cell's alignment; `"none"` for any format GFM cannot express.
 */
function $tableCellAlignment(cell: TableCellNode): MarkdownTableAlignment {
    switch (cell.getFormatType()) {
        case "left":   return "left";
        case "center": return "center";
        case "right":  return "right";
        default:       return "none";
    }
}

/**
 * Sets `alignment` on every cell of the column holding the caret — the whole
 * column, because a GFM delimiter row carries one marker per column, not per
 * cell. No-op when the caret is not inside a table cell.
 *
 * @param alignment - The alignment to apply to the column.
 */
function $setEnclosingColumnAlignment(alignment: MarkdownTableAlignment): void {
    const cell = $getEnclosingTableCellNode();

    if (cell === null) {
        return;
    }

    const table = $getTableNodeFromLexicalNodeOrThrow(cell);
    const [tableMap, cellValue] = $computeTableMap(table, cell, cell);
    const format: ElementFormatType = alignment === "none" ? "" : alignment;

    for (const row of tableMap) {
        row[cellValue.startColumn]?.cell.setFormat(format);
    }
}

/**
 * Finds the table or fenced code block enclosing `node`, if any.
 *
 * @param node - The node to search upward from (typically a selection anchor).
 * @returns The enclosing {@link TableNode} or {@link CodeNode}, or `null` when
 *   `node` sits in neither.
 */
function $findEnclosingSeparatorTarget(node: LexicalNode): TableNode | CodeNode | null {
    const codeNode = $getNearestNodeOfType(node, CodeNode);

    if (codeNode !== null) {
        return codeNode;
    }

    const tableCell = $getTableCellNodeFromLexicalNode(node);

    return tableCell === null ? null : $getTableNodeFromLexicalNodeOrThrow(tableCell);
}

/**
 * Finds the link enclosing `node`, if any — checking `node` itself first,
 * then its ancestors, stopping at the document root.
 *
 * @param node - The node to search from (typically a selection anchor, or
 *   the right-click's resolved DOM-target node).
 * @returns The enclosing `LinkNode`, or `null` when `node` sits in neither.
 */
function $findEnclosingLinkNode(node: LexicalNode): LinkNode | null {
    return $findMatchingParent(node, $isLinkNode);
}

/**
 * Finds the blockquote, list, fenced code block, or table enclosing `node`,
 * if any — the nearest of the first three, regardless of nesting order (a
 * list inside a quote resolves to the list; a quote inside a list resolves to
 * the quote), falling back to the enclosing table when `node` sits inside a
 * table cell and none of the other three enclose it first. For a list, this
 * is the whole {@link ListNode} the clicked item belongs to — its immediate
 * parent, two levels up from the clicked `ListItemNode` — never just that one
 * item, and never the outermost list when the list is nested inside another
 * list. For a table cell, this is likewise the whole enclosing
 * {@link TableNode} the clicked cell belongs to, never just that one cell.
 *
 * @remarks
 * Shares its table-cell resolution ({@link $getTableCellNodeFromLexicalNode}
 * + {@link $getTableNodeFromLexicalNodeOrThrow}) with
 * {@link $findEnclosingSeparatorTarget}, which backs the Alt+Enter keyboard
 * shortcut. The two stay separate functions because this one also resolves
 * blockquotes and lists, which the keyboard shortcut does not.
 *
 * @param node - The node to search upward from (typically a selection anchor
 *   or a right-click's resolved node).
 * @returns The enclosing {@link CodeNode}, {@link QuoteNode},
 *   {@link ListNode}, or {@link TableNode}, or `null` when `node` sits in
 *   none of them.
 */
function $findEnclosingInsertableBlock(node: LexicalNode): CodeNode | QuoteNode | ListNode | TableNode | null {
    const block = $findMatchingParent(
        node,
        (n): n is CodeNode | QuoteNode | ListNode => $isCodeNode(n) || $isQuoteNode(n) || $isListNode(n),
    );

    if (block !== null) {
        return block;
    }

    const tableCell = $getTableCellNodeFromLexicalNode(node);

    return tableCell === null ? null : $getTableNodeFromLexicalNodeOrThrow(tableCell);
}

/**
 * Finds the child of the document root that holds `node` (or is `node`).
 * Unlike Lexical's `getTopLevelElement()`, it does not stop at a table cell
 * or a `:::` column, which Lexical treats as roots of their own.
 *
 * @param node - The node to search upward from.
 * @returns The root's child holding `node`, or `null` when `node` is the
 *   root itself or is not attached to it.
 */
function $getRootChild(node: LexicalNode): LexicalNode | null {
    return $findMatchingParent(node, (candidate) => $isRootNode(candidate.getParent()));
}

/**
 * Wraps the top-level blocks the current selection spans in a fresh
 * {@link MarkdownBlockNode} holding one {@link MarkdownColumnNode} column,
 * inserted where the first of them sat. A selection inside a table cell or
 * a `:::` column counts as its whole enclosing child of the root: the whole
 * table, or the whole fence. Assumes the caller already verified a range
 * selection exists.
 *
 * @returns The new, now-populated block node.
 */
function $wrapSelectedTopLevelBlocks(): MarkdownBlockNode {
    const selection = $getSelection();
    const children = $getRoot().getChildren();

    let firstIndex = children.length - 1;
    let lastIndex = 0;

    if ($isRangeSelection(selection)) {
        for (const node of selection.getNodes()) {
            const rootChild = $getRootChild(node);

            if (rootChild === null) {
                continue;
            }

            const index = rootChild.getIndexWithinParent();

            firstIndex = Math.min(firstIndex, index);
            lastIndex = Math.max(lastIndex, index);
        }
    }

    // Defensive only: every caller already verified a range selection before
    // reaching here, and any such selection's getNodes() resolves at least
    // one top-level index — this fallback just avoids an inverted range if
    // that ever isn't so, by wrapping the whole document instead.
    if (lastIndex < firstIndex) {
        firstIndex = 0;
        lastIndex = children.length - 1;
    }

    const block = $createMarkdownBlockNode();
    const column = $createMarkdownColumnNode();

    children[firstIndex]!.insertBefore(block);
    block.append(column);

    for (let index = firstIndex; index <= lastIndex; index += 1) {
        column.append(children[index]!);
    }

    return block;
}

/**
 * Moves each end of the selection that is an element point on `block` or on
 * one of its columns to the same position inside the column's content — the
 * deepest point at the end of what precedes it, or at the start of what
 * follows it — so it moves with that content.
 *
 * @remarks
 * Moving a node (`insertBefore`, `append`) makes Lexical (0.49.0) adjust a
 * selection end sitting on the node's old parent while the node is
 * detached; comparing that end with one inside the moved node then throws
 * `$comparePointCaretNext: … do not have a common ancestor`.
 *
 * @param block - The block whose columns' content is about to move.
 */
function $moveSelectionIntoColumnContent(block: MarkdownBlockNode): void {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return;
    }

    for (const point of [selection.anchor, selection.focus]) {
        const node = point.getNode();
        const onBlockOrColumn = node.is(block) || node.getParent()?.is(block) === true;

        if (point.type === "element" && onBlockOrColumn) {
            // Toward the content on the point's side: the end of what precedes it, else the start of what follows.
            const direction = point.offset > 0 ? "previous" : "next";

            $setPointFromCaret(point, $normalizeCaret($caretFromPoint(point, direction)));
        }
    }
}

/**
 * Moves `block`'s columns' children back to the top level, in column order,
 * then removes `block`. Walks every column rather than assuming exactly one,
 * so a malformed block with more than one column (which `canUnwrap()` never
 * actually permits) still unwraps correctly.
 *
 * @param block - The block to unwrap and remove.
 */
function $unwrapMarkdownBlock(block: MarkdownBlockNode): void {
    $moveSelectionIntoColumnContent(block);

    for (const column of block.getColumns()) {
        for (const child of column.getChildren()) {
            block.insertBefore(child);
        }
    }

    block.remove();
}

/** The most columns `setColumnCount` will build — beyond this a region is unreadable at any prose width. */
const MAX_COLUMN_COUNT = 6;

/**
 * Grows or shrinks `block` to `target` columns: growth appends empty
 * columns, shrinkage moves the surplus columns' content into the last column
 * kept — except a surplus column that is still exactly as `setColumnCount`
 * created it (a single empty paragraph and nothing else), which is dropped
 * instead of merged, so growing and then shrinking returns the original
 * document. Assumes `target` is already clamped to 1–{@link MAX_COLUMN_COUNT}.
 *
 * @param block - The block to resize.
 * @param target - The column count to resize to.
 */
function $setBlockColumnCount(block: MarkdownBlockNode, target: number): void {
    const columns = block.getColumns();

    $moveSelectionIntoColumnContent(block);

    for (let index = columns.length; index < target; index += 1) {
        const column = $createMarkdownColumnNode();

        column.append($createParagraphNode());
        block.append(column);
    }

    const keep = columns[target - 1];

    for (let index = target; index < columns.length; index += 1) {
        const surplus = columns[index]!;
        const only = surplus.getFirstChild();
        const isUntouched = surplus.getChildrenSize() === 1
            && $isParagraphNode(only) && only.getChildrenSize() === 0;

        if (!isUntouched && keep !== undefined) {
            for (const child of surplus.getChildren()) {
                keep.append(child);
            }
        }

        surplus.remove();
    }
}

/**
 * Shared body of {@link MarkdownEditor.insertParagraphBeforeBlock} and
 * {@link MarkdownEditor.insertParagraphAfterBlock}: resolves the block
 * enclosing the caret (see {@link $findEnclosingInsertableBlock}) and inserts
 * an empty paragraph immediately before or after it, moving the caret into
 * the new paragraph. No-op when there is no range selection, or the caret is
 * not inside a blockquote, list, fenced code block, or table cell.
 *
 * @param after - Whether to insert after (`true`) or before (`false`) the
 *   enclosing block.
 */
function $insertParagraphAroundEnclosingBlock(after: boolean): void {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return;
    }

    const target = $findEnclosingInsertableBlock(selection.anchor.getNode());

    if (target === null) {
        return;
    }

    const paragraph = $createParagraphNode();

    if (after) {
        target.insertAfter(paragraph);
    } else {
        target.insertBefore(paragraph);
    }

    paragraph.selectStart();
}

/**
 * `KEY_ENTER_COMMAND` handler for Alt+Enter (Option+Enter on macOS): with the
 * caret inside a table or fenced code block, inserts an empty paragraph
 * immediately after that block and moves the caret into it.
 *
 * @remarks
 * Unlike a heading, list, or blockquote — ordinary flow text a click at its
 * trailing edge already lands in, the same as a paragraph — a table's grid
 * layout and a code block's preformatted whitespace give a click nothing to
 * resolve into, so wherever one directly borders another such block (or the
 * end of the document) there is otherwise nowhere to place a caret to add
 * content there. Bound to Alt+Enter rather than plain Enter or Shift+Enter,
 * both of which already mean something inside a cell or code block (splitting
 * into a new paragraph, or a soft line break); registered at
 * {@link COMMAND_PRIORITY_HIGH} so it runs ahead of `registerRichText`'s own
 * `KEY_ENTER_COMMAND` handler (registered at `COMMAND_PRIORITY_EDITOR`).
 *
 * @param event - The native keyboard event, or `null` for a programmatic dispatch.
 * @returns Whether an Alt+Enter inside a table or code block was handled.
 */
function $handleSeparatorShortcut(event: KeyboardEvent | null): boolean {
    if (!event?.altKey) {
        return false;
    }

    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    const target = $findEnclosingSeparatorTarget(selection.anchor.getNode());

    if (target === null) {
        return false;
    }

    event.preventDefault();

    const paragraph = $createParagraphNode();

    target.insertAfter(paragraph);
    paragraph.selectStart();

    return true;
}

/**
 * `KEY_ENTER_COMMAND` handler for plain Enter inside a raw Markdown block,
 * which edits the block as text: in the middle it inserts a line break, as
 * Enter in a `CodeNode` does, so the rest of the block stays raw Markdown;
 * at the start of a non-empty block it inserts an empty paragraph before the
 * block, as Enter at the start of a paragraph does. At the end it is left to
 * `registerRichText`, whose new paragraph `MarkdownRawBlockNode.insertNewAfter`
 * places after the block. Registered at {@link COMMAND_PRIORITY_HIGH}, ahead
 * of `registerRichText`'s own handler, as {@link $handleSeparatorShortcut} is.
 *
 * @param event - The native keyboard event, or `null` for a programmatic dispatch.
 * @returns Whether Enter inside a raw block was handled.
 */
function $handleRawBlockEnter(event: KeyboardEvent | null): boolean {
    if (event?.shiftKey || event?.altKey) {
        return false;
    }

    const selection = $getSelection();
    const rawBlock = $rawBlockAtAnchor(selection);

    if (rawBlock === null || !$isRangeSelection(selection)) {
        return false;
    }

    const atEnd = selection.isCollapsed() && rawBlock.isSelectionAtEnd(selection);

    if (atEnd) {
        return false;
    }

    event?.preventDefault();

    const atStart = selection.isCollapsed() && rawBlock.isSelectionAtStart(selection);

    if (atStart) {
        rawBlock.insertBefore($createParagraphNode());
    } else {
        selection.insertLineBreak();
    }

    return true;
}

/**
 * `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` handler for a paste into a raw
 * Markdown block or a code block: the pasted content goes in as plain text
 * at the caret — one line per line, and between pasted blocks a blank line
 * in a raw block (Markdown's block separator) or a line break in a code
 * block — so the block keeps holding only text. Lexical's default insert
 * would merge a raw block's text into the first and last pasted paragraphs,
 * which save escaped, and would put formatting, links and images into a code
 * block, which saves only its text.
 *
 * @param payload - The pasted nodes and the selection they are inserted at.
 * @returns Whether the paste landed in a raw block or a code block.
 */
function $pasteIntoTextOnlyBlock(payload: { nodes: LexicalNode[]; selection: BaseSelection }): boolean {
    const selection = payload.selection;
    const block = $isRangeSelection(selection) ? $findMatchingParent(selection.anchor.getNode(), $isTextOnlyBlock) : null;

    if (block === null || !$isRangeSelection(selection)) {
        return false;
    }

    const blockSeparator = $isCodeNode(block) ? "\n" : "\n\n";

    const text = payload.nodes.reduce((joined, node, index) => {
        const isBlock = $isElementNode(node) && !node.isInline();
        const previous = payload.nodes[index - 1];
        const afterBlock = previous !== undefined && $isElementNode(previous) && !previous.isInline();
        const separator = index > 0 && (isBlock || afterBlock) ? blockSeparator : "";

        return joined + separator + node.getTextContent();
    }, "");

    selection.insertRawText(text);

    return true;
}

/**
 * `PASTE_COMMAND` handler for a plain-text paste into a raw Markdown block:
 * the clipboard's text goes in at the caret, each newline a line break of
 * the block, as `paste()` inserts it. Lexical's own plain-text paste inserts
 * a paragraph per newline, which splits the block in two. A paste carrying
 * Lexical nodes is left to Lexical, whose insert reaches
 * {@link $pasteIntoTextOnlyBlock}. Registered at {@link COMMAND_PRIORITY_HIGH},
 * ahead of `registerRichText`'s own handler.
 *
 * @param event - The paste event (a `ClipboardEvent` from the browser).
 * @returns Whether the paste landed in a raw block.
 */
function $pastePlainTextIntoRawBlock(event: ClipboardEvent | InputEvent | KeyboardEvent): boolean {
    const selection = $getSelection();
    const clipboardData = "clipboardData" in event ? event.clipboardData : null;

    if ($rawBlockAtAnchor(selection) === null || !$isRangeSelection(selection) || clipboardData === null) {
        return false;
    }

    const holdsNodes = clipboardData.getData(LEXICAL_CLIPBOARD_TYPE) !== "";
    const text = clipboardData.getData("text/plain");

    if (holdsNodes || text === "") {
        return false;
    }

    event.preventDefault();
    selection.insertRawText(text);

    return true;
}

/**
 * `DELETE_CHARACTER_COMMAND` handler keeping a raw Markdown block or a code
 * block text-only when a delete joins another block to it, as that block's
 * Markdown: its formatting, links, images and escapes become text of the
 * block, which saves its text as written, instead of Lexical's merge moving
 * the block's nodes in, which the save would drop. Handles Backspace at a
 * paragraph's start after such a block, Delete at such a block's end before
 * a paragraph, and a range deleted from inside such a block into a later
 * block, whose rest after the range joins. The caret lands where the two
 * met. Registered at {@link COMMAND_PRIORITY_HIGH}, ahead of
 * `registerRichText`'s own handler.
 *
 * @param isBackward - `true` for Backspace, `false` for Delete.
 * @returns Whether a block was joined to a raw block or code block.
 */
function $joinIntoTextOnlyBlock(isBackward: boolean): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    if (!selection.isCollapsed()) {
        return $deleteRangeFromTextOnlyBlock(selection);
    }

    const pair = isBackward ? $textOnlyBlockBeforeParagraphStart(selection) : $paragraphAfterTextOnlyBlockEnd(selection);

    if (pair === null) {
        return false;
    }

    const [block, paragraph] = pair;
    const joint = block.getLastChild();
    const added = $textOnlyChildren($serializeBlock(paragraph));

    block.append(...added);
    paragraph.remove();

    if ($isTextNode(joint)) {
        joint.select(joint.getTextContentSize(), joint.getTextContentSize());
    } else if ($isTextNode(added[0])) {
        added[0].select(0, 0);
    } else {
        block.selectEnd();
    }

    return true;
}

/**
 * Deletes a range that starts inside a raw Markdown block or a code block
 * and ends in a later block: the rest of that later block after the range
 * joins as its Markdown (as its text, when it is a raw block or code block
 * too), so nothing it holds is dropped and its escapes keep its text as it
 * was shown.
 *
 * @param selection - A non-collapsed range selection.
 * @returns Whether the range started in a raw block or code block and ended
 *   outside it, and was deleted.
 */
function $deleteRangeFromTextOnlyBlock(selection: RangeSelection): boolean {
    const [start, end] = $orderedPoints(selection);
    const block = $findMatchingParent(start.getNode(), $isTextOnlyBlock);
    const tailBlock = $findEnclosingBlock(end.getNode());
    const endsInside = block !== null && $findMatchingParent(end.getNode(), (node) => node.is(block)) !== null;

    if (block === null || tailBlock === null || endsInside) {
        return false;
    }

    const startPoint: [string, number, "text" | "element"] = [start.key, start.offset, start.type];
    const rest = $detachRestOfBlock(tailBlock, end);
    const tail = $isTextOnlyBlock(tailBlock) ? rest.getTextContent() : $inlineMarkdown(rest.getChildren());
    const range = tailBlock.selectEnd();

    range.anchor.set(...startPoint);
    range.removeText();

    const caret = $getSelection();

    if (tail !== "" && $isRangeSelection(caret)) {
        const joint: [string, number, "text" | "element"] = [caret.anchor.key, caret.anchor.offset, caret.anchor.type];

        caret.insertRawText(tail);

        const restored = $getSelection();

        if ($isRangeSelection(restored)) {
            restored.anchor.set(...joint);
            restored.focus.set(...joint);
        }
    }

    return true;
}

/**
 * Moves everything of a block after a point into a new, detached paragraph,
 * keeping the inline elements (links) the moved nodes sit in as copies, so
 * the paragraph serializes as the rest of the block would. A run kept as
 * source never splits: a point inside one moves it whole.
 *
 * @param block - The block holding the point.
 * @param point - Where the rest starts.
 * @returns The paragraph holding the rest; the block keeps what was before
 *   the point.
 */
function $detachRestOfBlock(block: ElementNode, point: RangeSelection["anchor"]): ParagraphNode {
    let parent: ElementNode;
    let first: LexicalNode | null;

    if (point.type === "text") {
        const text = point.getNode() as TextNode;

        parent = text.getParentOrThrow();

        if (point.offset === 0 || ($isMarkdownSourceTextNode(text) && point.offset < text.getTextContentSize())) {
            first = text;
        } else if (point.offset >= text.getTextContentSize()) {
            first = text.getNextSibling();
        } else {
            first = text.splitText(point.offset)[1] ?? null;
        }
    } else {
        parent = point.getNode() as ElementNode;
        first = parent.getChildAtIndex(point.offset);
    }

    let moved: LexicalNode[] = first === null ? [] : [first, ...first.getNextSiblings()];

    while (!parent.is(block)) {
        const copy = $copyNode(parent);
        const following = parent.getNextSiblings();
        const grandparent = parent.getParentOrThrow();

        copy.append(...moved);

        if (parent.getChildrenSize() === 0) {
            parent.remove();
        }

        moved = copy.getChildrenSize() > 0 ? [copy, ...following] : following;
        parent = grandparent;
    }

    return $createParagraphNode().append(...moved);
}

/**
 * The Markdown of a run of inline nodes, keeping the whitespace at its edges
 * that the serializer trims at a line's edges, since the run joins text
 * already there.
 *
 * @param nodes - The inline nodes.
 * @returns Their Markdown.
 */
function $inlineMarkdown(nodes: LexicalNode[]): string {
    const text = nodes.map((node) => node.getTextContent()).join("");
    const markdown = $serializeInlineNodes(nodes);

    if (markdown === "") {
        return text.trim() === "" ? text : markdown;
    }

    const leading = /^[ \t]*/.exec(text)![0];
    const trailing = /[ \t]*$/.exec(text)![0];

    return leading + markdown.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "") + trailing;
}

/**
 * The children of a raw Markdown block or code block holding `text`: one
 * text node per non-empty line, a line break between every two lines.
 *
 * @param text - The text.
 * @returns The nodes, detached.
 */
function $textOnlyChildren(text: string): LexicalNode[] {
    return $createMarkdownRawBlockNode(text).getChildren();
}

/**
 * Node transform keeping a raw Markdown block or code block text-only: any
 * run of children that is not plain text or a line break — a link, an
 * image, text with a mark or a colour, font or size, a run kept as source
 * (inline code, and CSS no span writes, show nothing the text lacks), which a merge from
 * another block can bring in (typing or pasting over a range that reaches
 * into the next block) — is replaced by its Markdown, so the save, which
 * writes the block's text, drops none of it. The commands that format, link
 * or insert decline in these blocks, so only such a merge gets here.
 *
 * @param block - The raw block or code block.
 */
function $keepTextOnly(block: ElementNode): void {
    let run: LexicalNode[] = [];

    const flush = (): void => {
        if (run.length === 0) {
            return;
        }

        const replacement = $textOnlyChildren($inlineMarkdown(run));

        for (const node of replacement) {
            run[0]!.insertBefore(node);
        }

        run.forEach((node) => node.remove());
        run = [];
    };

    for (const child of block.getChildren()) {
        // Inline code and CSS the save writes no span for (a pasted `white-space`) show nothing the block's text lacks.
        const plain = $isLineBreakNode(child)
            || ($isTextNode(child) && !$isMarkdownSourceTextNode(child) && (child.getFormat() & ~TEXT_TYPE_TO_FORMAT.code) === 0
                && Object.keys(cssTextToAttributes(child.getStyle())).length === 0);

        if (plain) {
            flush();
        } else {
            run.push(child);
        }
    }

    flush();
}

/**
 * The raw Markdown block or code block a collapsed caret at a paragraph's
 * start would Backspace into, with that paragraph.
 *
 * @param selection - A collapsed range selection.
 * @returns The block and the paragraph, or `null` when the caret is not at
 *   the start of a paragraph right after a raw block or code block.
 */
function $textOnlyBlockBeforeParagraphStart(selection: RangeSelection): [MarkdownRawBlockNode | CodeNode, ParagraphNode] | null {
    const anchor = selection.anchor;
    const paragraph = $findMatchingParent(anchor.getNode(), $isParagraphNode);
    const previous = paragraph?.getPreviousSibling();
    const first = paragraph?.getFirstDescendant() ?? null;
    const atStart = anchor.offset === 0 && (anchor.getNode().is(paragraph) || anchor.getNode().is(first));

    return paragraph && atStart && $isTextOnlyBlock(previous) ? [previous, paragraph] : null;
}

/**
 * The paragraph a collapsed caret at a raw Markdown block's or code block's
 * end would Delete into, with that block.
 *
 * @param selection - A collapsed range selection.
 * @returns The block and the paragraph, or `null` when the caret is not at
 *   the end of a raw block or code block right before a paragraph.
 */
function $paragraphAfterTextOnlyBlockEnd(selection: RangeSelection): [MarkdownRawBlockNode | CodeNode, ParagraphNode] | null {
    const block = $findMatchingParent(selection.anchor.getNode(), $isTextOnlyBlock);
    const next = block?.getNextSibling();

    return block && $isSelectionAtBlockEnd(block, selection) && $isParagraphNode(next) ? [block, next] : null;
}

/**
 * Whether a selection's anchor sits at the very end of a block, as
 * `MarkdownRawBlockNode.isSelectionAtEnd` tells for a raw block.
 *
 * @param block - The block.
 * @param selection - The selection.
 * @returns `true` at the end of the block's last line (or in an empty block).
 */
function $isSelectionAtBlockEnd(block: ElementNode, selection: RangeSelection): boolean {
    const anchor = selection.anchor;
    const node = anchor.getNode();

    if (anchor.type === "element") {
        return node.is(block) && anchor.offset === block.getChildrenSize();
    }

    const last = block.getLastDescendant();

    return last !== null && node.is(last) && anchor.offset === node.getTextContentSize();
}

/**
 * The raw Markdown block holding a range selection's anchor.
 *
 * @param selection - The selection.
 * @returns The `MarkdownRawBlockNode`, or `null` outside one or for a
 *   selection that is not a range.
 */
function $rawBlockAtAnchor(selection: BaseSelection | null): MarkdownRawBlockNode | null {
    return $isRangeSelection(selection) ? $findMatchingParent(selection.anchor.getNode(), $isMarkdownRawBlockNode) : null;
}

/**
 * Whether the selection's anchor sits inside a raw Markdown block.
 *
 * @returns `true` inside a `MarkdownRawBlockNode`.
 */
function $isSelectionInRawBlock(): boolean {
    return $rawBlockAtAnchor($getSelection()) !== null;
}

/**
 * Whether a node is a block that holds only text and saves it as written: a
 * raw Markdown block or a code block.
 *
 * @param node - The node.
 * @returns `true` for a `MarkdownRawBlockNode` or a `CodeNode`.
 */
function $isTextOnlyBlock(node: LexicalNode | null | undefined): node is MarkdownRawBlockNode | CodeNode {
    return $isMarkdownRawBlockNode(node) || $isCodeNode(node);
}

/**
 * Whether any part of a range selection lies inside a node `isHolder`
 * matches.
 *
 * @param isHolder - Tells the kind of node asked about.
 * @returns `true` when the selection's anchor, focus or any selected node is
 *   such a node or inside one; `false` for a selection that is not a range.
 */
function $selectionTouches(isHolder: (node: LexicalNode) => boolean): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    const nodes = [selection.anchor.getNode(), selection.focus.getNode(), ...selection.getNodes()];

    return nodes.some((node) => $findMatchingParent(node, isHolder) !== null);
}

/**
 * Whether any part of the selection lies in a raw Markdown block or a code
 * block, whose text saves as written: formatting, a link or an inserted node
 * there would be shown but not saved, so the commands that make them
 * decline.
 *
 * @returns `true` when the selection's anchor, focus or any selected node is
 *   inside a `MarkdownRawBlockNode` or a `CodeNode`.
 */
function $selectionTouchesTextOnlyBlock(): boolean {
    return $selectionTouches($isTextOnlyBlock);
}

/**
 * Whether any part of the selection lies in a table cell, which holds text
 * only: a heading, quote, code block or list made there would be saved into
 * the cell as its literal syntax, so the block conversions decline. A table
 * selection is of whole cells, so it lies in them by what it is — its own
 * nodes are not read, since the cell its focus names can be gone (one merged
 * away, until the next selection change).
 *
 * @returns `true` for a table selection, and for a range selection whose
 *   anchor, focus or any selected node is inside a `TableCellNode`.
 */
function $selectionTouchesTableCell(): boolean {
    const isTableSelection = $isTableSelection($getSelection());

    return isTableSelection || $selectionTouches($isTableCellNode);
}

/**
 * Whether a node is a run kept as Markdown source that the formats, styles
 * and links decline to touch: the per-node half of
 * {@link $selectionCoversSourceRun}'s test, which adds how much of the run
 * the selection holds.
 *
 * @param node - The node.
 * @returns `true` for a `MarkdownSourceTextNode` other than a soft line
 *   break.
 */
function $isFormatBlockingSourceRun(node: LexicalNode): boolean {
    // A soft break takes the formats around it, unless it is a run of a construct kept as written, which writes them.
    return $isMarkdownSourceTextNode(node) && !(node.getSource().trim() === "" && $getState(node, keptSourceState) === null);
}

/**
 * Whether the format toggles format a cell of a table selection. They format
 * the selected cells one at a time, each over its whole content, so a cell
 * takes the format when it holds text to carry it and no run the formats
 * decline to touch ({@link $isFormatBlockingSourceRun}) — what
 * {@link $declinesFormat} rules out for a range over that content. An empty
 * cell, and one holding an image alone, takes none.
 *
 * @param cell - The cell.
 * @returns `true` when a format toggle would format the cell.
 */
function $cellTakesFormat(cell: TableCellNode): boolean {
    const texts = cell.getAllTextNodes();
    const holdsText = texts.some((text) => text.getTextContentSize() > 0);

    return holdsText && !texts.some($isFormatBlockingSourceRun);
}

/**
 * Whether the selection holds part of a run kept as Markdown source (a
 * `MarkdownSourceTextNode`: inline HTML, a task-list marker, a link nested
 * in a link, …) other than a soft line break. Such a run saves its source as
 * written, so a format, style or link put on it would be shown but not saved
 * the way it is shown — and wrapping its source in markers can change what
 * it is (a task-list marker inside `**` is no longer one) — so the commands
 * that add them decline, as they do in a raw block. A soft break's
 * whitespace takes the marks around it, so it does not count; neither does a
 * run the selection only borders.
 *
 * @returns `true` when a non-whitespace source run lies (partly) inside the
 *   selection.
 */
function $selectionCoversSourceRun(): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    const isCollapsed = selection.isCollapsed();

    if (isCollapsed) {
        return false;
    }

    const [start, end] = $orderedPoints(selection);

    return selection.getNodes().some((node) => {
        const blocksFormat = $isFormatBlockingSourceRun(node);

        if (!blocksFormat) {
            return false;
        }

        const isStart = start.type === "text" && start.key === node.getKey();
        const isEnd = end.type === "text" && end.key === node.getKey();
        const from = isStart ? start.offset : 0;
        const to = isEnd ? end.offset : node.getTextContentSize();

        return (!isStart && !isEnd) || to > from;
    });
}

/**
 * Whether the selection's anchor or focus sits in a link node holding a run
 * of a link nested in a link ({@link nestedLinkState}): that run's source
 * writes the link, so removing or re-pointing the link node would change
 * what is shown but not what is saved, and the link commands decline.
 *
 * @returns `true` when either end's enclosing link node holds such a run.
 */
function $selectionInNestedLinkRun(): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    return [selection.anchor.getNode(), selection.focus.getNode()].some((node) => {
        const link = $findMatchingParent(node, $isLinkNode);

        return link !== null && link.getChildren().some((child) => $isMarkdownSourceTextNode(child) && $getState(child, nestedLinkState) !== -1);
    });
}

/**
 * `FORMAT_TEXT_COMMAND` handler declining a format the selection could not
 * save as shown: one touching a raw Markdown block or a code block, or
 * holding a run kept as Markdown source. Registered at
 * {@link COMMAND_PRIORITY_HIGH}, ahead of `registerRichText`'s own handler,
 * so the keyboard shortcuts decline as the toggles do.
 *
 * @returns Whether the format was declined.
 */
function $declinesFormat(): boolean {
    return $selectionTouchesTextOnlyBlock() || $selectionCoversSourceRun();
}

/**
 * Registers the Markdown typing shortcuts everywhere except inside a raw
 * Markdown block, whose text is saved as typed: a shortcut there would turn
 * typed syntax into formatting the block does not save.
 *
 * @remarks
 * `registerMarkdownShortcuts` hard-codes its one exclusion (a `CodeNode`
 * parent) and offers no hook, so it is handed the editor through a proxy
 * whose `registerUpdateListener` and `registerCommand` wrap each listener to
 * do nothing while the selection is in a raw block, and whose `update` runs
 * each shortcut's edit through `$editWritably`, so a format typed where the
 * save could not write it (`x**(a)**`) is declined and stays typed text.
 * Every other member is the editor's own, bound to it. Unlike the `Proxy` `core/Callable.ts`
 * avoids (WebKitGTK's JavaScriptCore breaks `super` calls through a `Proxy`
 * in an `extends` chain), this one wraps an instance and no class extends
 * it.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerMarkdownShortcutsOutsideRawBlocks(editor: LexicalEditor): () => void {
    const registerUpdateListener = (listener: UpdateListener): (() => void) =>
        editor.registerUpdateListener((payload) => {
            const inRawBlock = payload.editorState.read($isSelectionInRawBlock);

            if (!inRawBlock) {
                listener(payload);
            }
        });

    const registerCommand = <P>(command: LexicalCommand<P>, listener: CommandListener<P>, priority: CommandListenerPriority): (() => void) =>
        editor.registerCommand(command, (payload, target) => {
            const inRawBlock = $isSelectionInRawBlock();

            return inRawBlock ? false : listener(payload, target);
        }, priority);

    // A shortcut's edit runs in an update the listener starts on each keystroke; one that applies a format tags
    // it to push history, and only that one is checked.
    const update = (edit: () => void, options?: EditorUpdateOptions): void => {
        editor.update(() => {
            $editWritably(edit, () => $hasUpdateTag(HISTORY_PUSH_TAG));
        }, options);
    };

    const guarded = new Proxy(editor, {
        get: (target, property) => {
            if (property === "registerUpdateListener") {
                return registerUpdateListener;
            }

            if (property === "update") {
                return update;
            }

            if (property === "registerCommand") {
                return registerCommand;
            }

            const value: unknown = Reflect.get(target, property, target);

            return typeof value === "function" ? value.bind(target) : value;
        },
    });

    return registerMarkdownShortcuts(guarded, SHORTCUT_TRANSFORMERS);
}

/**
 * Registers what keeps a raw Markdown block and a code block holding text
 * only: Enter inside a raw block, a paste into either, a delete joining
 * another block to either, and the transform turning anything else that
 * reaches them into its Markdown.
 *
 * @remarks
 * A command's listeners of one priority run in the order they were
 * registered, and all of these are at {@link COMMAND_PRIORITY_HIGH}. Call
 * this after registering {@link $handleSeparatorShortcut}, which reads Enter
 * first, and before registering any other listener of these commands at that
 * priority that must find a text-only block already dealt with.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerTextOnlyBlockRules(editor: LexicalEditor): () => void {
    return mergeRegister(
        editor.registerCommand(KEY_ENTER_COMMAND, $handleRawBlockEnter, COMMAND_PRIORITY_HIGH),
        editor.registerCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, $pasteIntoTextOnlyBlock, COMMAND_PRIORITY_HIGH),
        editor.registerCommand(PASTE_COMMAND, $pastePlainTextIntoRawBlock, COMMAND_PRIORITY_HIGH),
        editor.registerCommand(DELETE_CHARACTER_COMMAND, $joinIntoTextOnlyBlock, COMMAND_PRIORITY_HIGH),
        editor.registerNodeTransform(MarkdownRawBlockNode, $keepTextOnly),
        editor.registerNodeTransform(CodeNode, $keepTextOnly),
    );
}

/**
 * Registers the format command's handler, which formats a selection only as
 * far as the save can write it and declines where {@link $declinesFormat}
 * rules a format out.
 *
 * @remarks
 * Registered at {@link COMMAND_PRIORITY_HIGH}, ahead of `registerRichText`'s
 * own handler. Lexical's table selection observer registers a handler of its
 * own at that priority, which formats selected cells unchecked; it is
 * registered when the view mounts, so this one, registered when the editor is
 * built, runs first and takes a table selection before it.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerWritableFormatCommand(editor: LexicalEditor): () => void {
    return editor.registerCommand(FORMAT_TEXT_COMMAND, (format) => $formatWritably(format, $declinesFormat, $cellTakesFormat), COMMAND_PRIORITY_HIGH);
}

/**
 * The right-click context this plan's menu builds around a resolved Lexical
 * node: a table cell or ordinary text/prose (both carrying the current
 * selection's inline-format state, so the format toggles can show a
 * checkmark on active formats — a table cell holds inline text too, so it
 * gets the same toggles as plain prose, alongside its row/column/table
 * commands), or an empty paragraph outside any table.
 *
 * @remarks Exported (not part of the public `MarkdownEditor` callable) so it
 * can be imported directly in tests, mirroring how `Markdown.test.ts` imports
 * the non-barrel-exposed `mapFenceLangToEditorId`.
 */
export type ContextMenuTarget =
    | {
          kind: "table-cell";
          hasSelectedText: boolean;
          bold: boolean; italic: boolean; strikethrough: boolean; code: boolean; underline: boolean;
          hasEnclosingBlock?: boolean;
          linkUrl?: string | null;
          columnAlignment?: MarkdownTableAlignment;
      }
    | { kind: "empty-line"; hasSelectedText: boolean }
    | {
          kind: "text";
          hasSelectedText: boolean;
          bold: boolean; italic: boolean; strikethrough: boolean; code: boolean; underline: boolean;
          hasEnclosingBlock?: boolean;
          linkUrl?: string | null;
      };

/**
 * Matches one "word" character for {@link $selectEnclosingWordIfCollapsed}'s
 * boundary scan: any Unicode letter or number, plus underscore. Unicode-aware
 * (`\p{L}`/`\p{N}`, not the ASCII-only `\w`) so a right-click inside an
 * accented, Cyrillic, or CJK word expands to the whole word, not just its
 * ASCII-range run.
 */
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

/**
 * The expansion {@link $selectEnclosingWordIfCollapsed} would make (or has
 * made) to a collapsed selection: the text node it spans, the offsets within
 * it, and the format bitmask the resulting selection would carry.
 */
interface WordExpansion {
    node: TextNode;
    start: number;
    end: number;
    format: number;
}

/**
 * Computes what {@link $selectEnclosingWordIfCollapsed} would select for the
 * current selection, without mutating anything — the read-only counterpart
 * {@link $classifyContextMenuTarget} uses so classification can reflect what
 * a subsequent action would operate on without performing that action's
 * mutation. See {@link $selectEnclosingWordIfCollapsed} for the word/run
 * semantics.
 *
 * @returns The would-be expansion, or `null` under the exact conditions that
 * make {@link $selectEnclosingWordIfCollapsed} a no-op: the selection is not
 * collapsed, is not anchored in a text node, or (plain prose only) the
 * anchor sits on whitespace/punctuation with no adjacent word character.
 */
function $computeWordExpansion(): WordExpansion | null {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return null;
    }

    const anchorNode = selection.anchor.getNode();

    if (!$isTextNode(anchorNode)) {
        return null;
    }

    const text = anchorNode.getTextContent();

    if (anchorNode.getFormat() !== 0) {
        return text.length > 0
            ? { node: anchorNode, start: 0, end: text.length, format: anchorNode.getFormat() }
            : null;
    }

    let start = selection.anchor.offset;
    let end = start;

    while (start > 0 && WORD_CHARACTER.test(text[start - 1])) {
        start -= 1;
    }

    while (end < text.length && WORD_CHARACTER.test(text[end])) {
        end += 1;
    }

    return start !== end ? { node: anchorNode, start, end, format: 0 } : null;
}

/**
 * With a collapsed selection anchored in a text node, expands it so a
 * subsequent format toggle applies to more than just text typed from that
 * point on — the same as an explicit click-and-drag selection already gets.
 * A specially-formatted run (bold/italic/strikethrough/code) is a single
 * semantic unit the user deliberately created with one format action, so the
 * whole run is selected; a code identifier or expression is often full of
 * punctuation (`getValue()`) a dictionary-word scan would stop at, and the
 * user toggling its format almost always means the whole thing. Plain,
 * unformatted prose has no such run to fall back on — a paragraph's plain
 * text is typically one contiguous node — so there the enclosing run of word
 * characters is selected instead.
 *
 * @remarks A no-op when the selection is not collapsed (an explicit
 * selection the user already made is left exactly as they made it), is not
 * anchored in a text node, or (plain prose only) the anchor sits on
 * whitespace/punctuation with no adjacent word character.
 *
 * Exported (not part of the public `MarkdownEditor` callable) so it can be
 * tested directly, mirroring {@link $classifyContextMenuTarget}. Callers
 * that need the menu's *checkbox state* rather than the mutation itself
 * (i.e. {@link $classifyContextMenuTarget}) use the read-only
 * {@link $computeWordExpansion} instead, so a right-click never widens the
 * visible selection on its own — only an action that actually needs the
 * wider selection (a format toggle, Cut, or Copy) triggers this mutation,
 * immediately before doing its own work.
 */
export function $selectEnclosingWordIfCollapsed(): void {
    const expansion = $computeWordExpansion();

    if (expansion === null) {
        return;
    }

    const selection = expansion.node.select(expansion.start, expansion.end);

    if (expansion.format !== 0) {
        // A RangeSelection caches its own `format` bitmask separately from
        // the nodes it spans — `select()` does not refresh it to match the
        // node just selected, so a later toggle command reads the stale
        // (usually all-formats-off) cache instead of this run's actual
        // format and silently no-ops. Sync it explicitly.
        selection.setFormat(expansion.format);
    }
}

/**
 * Reads the current selection's five inline-format flags — bold, italic,
 * strikethrough, code, underline — the way a subsequent format toggle would
 * see them: a non-null `expansion` (a collapsed caret's would-be word/run
 * expansion, from {@link $computeWordExpansion}) is consulted directly
 * rather than the raw selection, so a collapsed caret reports the format the
 * enclosing run carries, not the empty-selection default; a range selection
 * is read by `$selectionHasFormat`, the rule the format toggles act on, which
 * leaves out the spaces at its edges that bold, italic and strikethrough never
 * stay on. Shared by
 * {@link $classifyContextMenuTarget} (the right-click menu's checkbox state)
 * and {@link $readSelectionState} (the toolbar's live state), so both report
 * exactly the same thing a format toggle would actually act on.
 *
 * @param selection - The current Lexical selection.
 * @param expansion - The would-be word/run expansion for a collapsed caret,
 *   or `null` when the selection is already a non-collapsed range (or not a
 *   range selection at all).
 * @returns The five format flags.
 */
function $readFormatFlags(
    selection: BaseSelection | null,
    expansion: WordExpansion | null,
): { bold: boolean; italic: boolean; strikethrough: boolean; code: boolean; underline: boolean } {
    const hasFormat = (type: TextFormatType): boolean => expansion !== null
        ? (expansion.format & TEXT_TYPE_TO_FORMAT[type]) !== 0
        : $isRangeSelection(selection) && $selectionHasFormat(selection, type);

    return {
        bold: hasFormat("bold"), italic: hasFormat("italic"),
        strikethrough: hasFormat("strikethrough"), code: hasFormat("code"),
        underline: hasFormat("underline"),
    };
}

/**
 * Classifies an already-resolved Lexical node for the right-click context
 * menu: a table cell wins even when empty, an empty paragraph outside any
 * table is the insert context, and everything else is the format context —
 * the latter two both carry the current selection's inline-format state.
 *
 * Read-only: a collapsed caret is never expanded here (that mutation is left
 * to whichever action actually needs it — see {@link $selectEnclosingWordIfCollapsed}).
 * The format-checkbox state and `hasSelectedText` instead reflect what
 * {@link $computeWordExpansion} reports a collapsed caret *would* expand to,
 * so the menu shows what an action would operate on without pre-emptively
 * performing it.
 *
 * @param node - The node the native `contextmenu` event's DOM target resolved to.
 * @returns The classified {@link ContextMenuTarget}.
 */
export function $classifyContextMenuTarget(node: LexicalNode): ContextMenuTarget {
    const selection = $getSelection();
    const expansion = $computeWordExpansion();
    const formatState = $readFormatFlags(selection, expansion);
    const hasSelectedText = expansion !== null
        || ($isRangeSelection(selection) && selection.getTextContent() !== "");
    const linkUrl = $findEnclosingLinkNode(node)?.getURL() ?? null;

    const tableCell = $getTableCellNodeFromLexicalNode(node);

    if (tableCell !== null) {
        const hasEnclosingBlock = $findEnclosingInsertableBlock(node) !== null;
        const columnAlignment   = $tableCellAlignment(tableCell);

        return { kind: "table-cell", hasSelectedText, hasEnclosingBlock, linkUrl, columnAlignment, ...formatState };
    }

    const block = $findEnclosingBlock(node);

    if ($isParagraphNode(block) && block.getTextContent() === "") {
        return { kind: "empty-line", hasSelectedText };
    }

    const hasEnclosingBlock = $findEnclosingInsertableBlock(node) !== null;

    return { kind: "text", hasSelectedText, hasEnclosingBlock, linkUrl, ...formatState };
}

/**
 * Reads the toolbar's live selection state directly off `$getSelection()` —
 * the five format flags (via {@link $readFormatFlags}), whether there's a
 * selection to act on, the enclosing link's URL (if any), table-cell
 * presence and its column's alignment, and the enclosing `:::` block's
 * alignment and column count. Unlike {@link $classifyContextMenuTarget},
 * this takes no node parameter: the toolbar has no click target to resolve
 * one from, so it reads the same way the file's own
 * {@link $getEnclosingTableCellNode} does.
 *
 * @returns The current {@link MarkdownEditorSelectionState}.
 */
function $readSelectionState(): MarkdownEditorSelectionState {
    const selection = $getSelection();
    const expansion = $computeWordExpansion();
    const format = $readFormatFlags(selection, expansion);
    const hasSelectedText = expansion !== null
        || ($isRangeSelection(selection) && selection.getTextContent() !== "");
    const cell = $getEnclosingTableCellNode();
    const anchor = $isRangeSelection(selection) ? selection.anchor.getNode() : null;
    const block = anchor === null ? null : $findMatchingParent(anchor, $isMarkdownBlockNode);
    const linkUrl = anchor === null ? null : ($findEnclosingLinkNode(anchor)?.getURL() ?? null);

    return {
        ...format,
        hasSelectedText,
        linkUrl,
        inTable:              cell !== null,
        tableColumnAlignment: cell !== null ? $tableCellAlignment(cell) : null,
        blockAlignment:       (block?.getAlign() ?? null) as MarkdownBlockAlignment | null,
        columnCount:          block !== null ? block.getColumns().length : 1,
    };
}

/** The {@link MarkdownEditorSelectionState} reported before the Lexical editor is built, or when nothing tracked applies. */
const NEUTRAL_SELECTION_STATE: MarkdownEditorSelectionState = {
    bold: false, italic: false, strikethrough: false, code: false, underline: false,
    hasSelectedText: false, linkUrl: null,
    inTable: false, tableColumnAlignment: null, blockAlignment: null, columnCount: 1,
};

/**
 * Whether two {@link MarkdownEditorSelectionState} values are field-for-field
 * equal — what {@link MarkdownEditor.updateSelectionState} uses to decide
 * whether a commit's resulting state is worth a `"selectionstate"` emit.
 *
 * @param a - The first state.
 * @param b - The second state.
 * @returns Whether every field of `a` matches the same field of `b`.
 */
function selectionStatesEqual(a: MarkdownEditorSelectionState, b: MarkdownEditorSelectionState): boolean {
    return a.bold === b.bold && a.italic === b.italic && a.strikethrough === b.strikethrough
        && a.code === b.code && a.underline === b.underline
        && a.hasSelectedText === b.hasSelectedText && a.linkUrl === b.linkUrl
        && a.inTable === b.inTable && a.tableColumnAlignment === b.tableColumnAlignment
        && a.blockAlignment === b.blockAlignment && a.columnCount === b.columnCount;
}

// A text caret over the whole surface signals editability. The surface is also
// a contenteditable editing host, which the browser exempts from the framework's
// `user-select: none` on its own, and Lexical additionally stamps
// `user-select: text` inline on the root when it mounts — stating the same
// intent here in the framework's own rule means select-and-copy does not depend
// on that inline write surviving a later re-render. As class defaults both land
// on the shared `.WysiwygSurface` rule rather than each instance's `#id` rule.
const _defaultWysiwygSurfaceOptions: Partial<ComponentOptions> = { userSelect: "text", cursor: "text" };

/** The event {@link WysiwygSurface} exposes through its custom `on` / `off` surface. */
type WysiwygSurfaceEvent = "contextmenu";

/**
 * The private WYSIWYG editing surface: the element Lexical's `contenteditable`
 * view mounts into.
 *
 * @remarks
 * Split out from {@link MarkdownEditor} so the coordinator's own element can host
 * *both* this surface and the source {@link CodeEditor} as two [`Card`](/api/layout/classes/Card)
 * children — one DOM element per class, since Lexical's `contenteditable` and
 * CodeMirror's view are two foreign live widgets that each need their own host
 * element. `MarkdownEditor` keeps ownership of the Lexical editor object; only
 * the mount element (and its `contenteditable` / caret plumbing) lives here.
 */
class WysiwygSurface extends Component {

    /** Whether this surface's element hosts an editable region (`contenteditable`). */
    private _contentEditable: boolean = false;

    /** Invoked on the surface's first connected + sized layout — the moment to mount the live view. */
    private readonly _onReady: () => void;

    /** Custom-event fan-out for `"contextmenu"`. */
    private readonly _listeners: ListenerBag<WysiwygSurfaceEvent> = this.registerListenerBag(new ListenerBag<WysiwygSurfaceEvent>());

    /**
     * Constructs the WYSIWYG surface.
     *
     * @param onReady - Called on the surface's first connected + sized layout.
     * @param subclassDefaults - Optional subclass defaults bag.
     */
    constructor(onReady: () => void, subclassDefaults?: Partial<ComponentOptions>) {
        super(undefined, { ..._defaultWysiwygSurfaceOptions, ...(subclassDefaults ?? {}) });

        this._onReady = onReady;

        this.setContentEditable(true);
        // Fills its host box and scrolls internally when the document overflows.
        this.setOverflow("auto");
        // A few pixels of inset off the padding box: without it the caret sits
        // flush against the surface's left edge (at column 0 of any line) and
        // gets clipped to invisibility. The padding is on the scroll container,
        // so it clears the caret at every edge while overflow scrolling still
        // reveals the full document. The values match source mode's CodeMirror
        // text inset so toggling modes doesn't shift the prose: 4px vertical
        // (CodeMirror's `.cm-content` padding is `4px 0`) and 6px horizontal
        // (its `.cm-line` padding-left is 6px).
        this.setPadding(new Insets(4, 6, 4, 6));
        // Matches the read-only Markdown viewer's own root-level override
        // (Markdown.ts) so the edited prose reads at the same leading as the
        // preview instead of falling back to the tighter UI-control line-height
        // the theme applies to <html>.
        this.setElementCSSRule("lineHeight", "var(--ts-ui-md-line-height, 1.8)");

        // Subtree, not exact-target: a right-click over rendered prose lands on
        // a descendant span/text node Lexical wraps content in, not on this
        // surface's own root element, so the exact-target `Event.addListener`
        // variant would never see it. Matches `ParentHeaderCell`'s identical
        // registration (ParentHeader.ts:305).
        Event.addSubtreeListener(this, "contextmenu", { prevent: true, handler: this.handleContextMenu });

        this.onFirstLayout(() => this._onReady());
    }

    /**
     * Sets whether this surface's element hosts an editable region. Caches the
     * state in `_contentEditable` and writes the `contenteditable` attribute
     * through `setElementAttribute`, whose buffer replays the value onto the
     * element once one is created — so a call made during detached
     * construction still lands.
     *
     * @param contentEditable - Whether the element is contenteditable.
     * @returns This surface, for method chaining.
     */
    setContentEditable(contentEditable: boolean): this {
        this._contentEditable = contentEditable;
        this.setElementAttribute("contenteditable", contentEditable ? "true" : "false");

        return this;
    }

    /**
     * Returns whether this surface's element hosts an editable region.
     *
     * @returns The contenteditable state.
     */
    getContentEditable(): boolean {
        return this._contentEditable;
    }

    /**
     * Registers a listener for the `"contextmenu"` event, fired on a native
     * right-click over this surface's element.
     *
     * @param event - Must be `"contextmenu"`.
     * @param listener - Invoked with the native `MouseEvent`.
     * @returns This surface, for method chaining.
     */
    on(event: WysiwygSurfaceEvent, listener: (event: MouseEvent) => void): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered `"contextmenu"` listener.
     *
     * @param event - Must be `"contextmenu"`.
     * @param listener - The exact callback reference to remove.
     * @returns This surface, for method chaining.
     */
    off(event: WysiwygSurfaceEvent, listener: (event: MouseEvent) => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans the `"contextmenu"` event out to its registered listeners.
     *
     * @param event - Must be `"contextmenu"`.
     * @param payload - The native `MouseEvent`.
     */
    protected emit(event: WysiwygSurfaceEvent, payload: MouseEvent): void {
        this._listeners.fire(event, payload);
    }

    /**
     * `Event`-registered handler for a native `contextmenu` DOM event on this
     * surface's element: re-fires it through the semantic `"contextmenu"`
     * custom event.
     *
     * @param event - The native contextmenu event. `preventDefault` is applied
     *   by the registration's `prevent: true` floor.
     */
    private handleContextMenu(event: MouseEvent): void {
        this.emit("contextmenu", event);
    }

    /**
     * Mounts the given Lexical editor's editable view into this surface's element
     * through the DOM seam's `mountView` escape. No-ops when the view is already
     * mounted, the element is not yet available, or offline (the seam returns
     * `null`, leaving the editor headless).
     *
     * @param editor - The Lexical editor whose view to mount here.
     */
    mount(editor: LexicalEditor): void {
        if (editor.getRootElement()) {
            return;
        }

        const element = this.getElement();

        if (!element) {
            return;
        }

        ensureMarkdownEditorClassRules();

        // The factory parameter is left unannotated: its `HTMLElement` type is
        // inferred from the seam signature, so no DOM type is named here and the
        // `no-raw-dom` *hold* clause stays green. `setRootElement` accepts the
        // element structurally.
        DOM.sink.mountView(element, (root) => { editor.setRootElement(root); return root; });
    }
}

/**
 * A WYSIWYG rich-text editor whose public value is a Markdown string, with an
 * optional raw-Markdown source mode.
 *
 * @remarks
 * `MarkdownEditor` edits a document as rendered rich text — no visible markup —
 * and reads Markdown with the viewer's own `marked` lexer and writes it with
 * its own serializer, so it is the editing counterpart to the read-only
 * [`Markdown`](/api/component/display/classes/Markdown) viewer. Its dialect is
 * deliberately the **exact subset** the viewer renders (headings, paragraphs,
 * bold, italic, strikethrough, underline, inline code, coloured/sized/font-styled
 * spans, ordered/unordered lists, blockquotes, fenced code, links, GFM pipe
 * tables with per-column alignment/widths/merged cells, `:::` alignment /
 * column-region fences, and sized images). Markdown the editor has no
 * rich-text form for is kept as source — an editable raw block, or an atomic
 * inline run — and saved exactly as written, so an edited document renders in
 * the viewer as it did before.
 *
 * Formatting is driven four ways, all without a built-in toolbar: Markdown
 * shortcut typing (`# ` → heading, `**b**` → bold, `- ` → list, `> ` → quote,
 * ` ``` ` → code), the default keyboard shortcuts (Ctrl/Cmd+B / +I, undo/redo,
 * and Alt+Enter — with the caret in a table cell or a fenced code block —
 * to insert a paragraph after it, since a table's grid and a code block's
 * preformatted text otherwise give a click nowhere to land), a thin
 * imperative command API (`toggleBold`, `toggleStrikethrough`, `toggleUnderline`,
 * `setTextColor`, `setFontFamily`, `setFontSize`, `clearFormatting`,
 * `setBlockType`, `toggleUnorderedList`, `toggleLink`, `removeLink`, `insertTable`,
 * `insertParagraphBeforeBlock`/`insertParagraphAfterBlock`,
 * `insertTableRow`/`deleteTableRow`, `insertTableColumn`/`deleteTableColumn`,
 * `deleteTable`, `mergeTableCells`, `unmergeTableCell`, `setTableColumnWidth`,
 * `setTableColumnAlignment`, `setBlockAlignment`, `setColumnCount`, `insertImage`,
 * `cut`/`copy`/`paste`, …) a consumer can wire to their own `Button`s, and a
 * self-wired right-click context menu on the WYSIWYG surface whose contents
 * depend on what was clicked (a word/selection, an empty line, or a table
 * cell) — the only one of the four that needs no consumer wiring at all.
 *
 * A {@link MarkdownEditor.setMode | mode} (`"wysiwyg"` | `"source"`) swaps the
 * editing surface between that rich-text view and a raw-Markdown
 * [`CodeEditor`](/api/component/editor/classes/CodeEditor); both are bound to the
 * same Markdown value, so `getValue`/`setValue` and the `"change"` event behave
 * identically in either mode and switching modes preserves the document. Like the
 * command API, the mode toggle is **consumer-wired** — there is no built-in
 * chrome — so a consumer drives `setMode` from their own control.
 *
 * Internally the component's own element hosts two swappable child surfaces
 * through a [`Card`](/api/layout/classes/Card) layout: a private WYSIWYG surface owning Lexical's
 * `contenteditable` element (a *foreign live widget*, like the `EditorView`
 * behind `CodeEditor`) and the source `CodeEditor`. Lexical separates its editor
 * **state** (a pure, DOM-free immutable tree) from that view, so the Markdown
 * value get/set/round-trip runs headless: offline neither view attaches, yet
 * `getValue` / `setValue`, the command API, and mode switching still operate on
 * the state. The editor fills its host box and scrolls internally; give it a
 * sized host (a `Fit` panel or an explicit `preferredSize`), the same as
 * `CodeEditor`.
 *
 * @example
 * ```typescript
 * import { MarkdownEditor } from '@jimka/typescript-ui/component/editor';
 *
 * const editor = new MarkdownEditor('# Title\n\nSome **bold** text.');
 * panel.addComponent(editor);
 * editor.on('change', ({ value }) => console.log(value));
 * editor.setMode('source'); // switch to raw-Markdown editing
 * ```
 *
 * @category Components
 */
class MarkdownEditor extends Component<MarkdownEditorOptions> {

    /**
     * The Lexical editor, built lazily (headless) on first use or first layout;
     * `null` until then. The editor is DOM-free until its root element mounts,
     * so this is non-null and fully usable offline once built.
     */
    private _editor: LexicalEditor | null = null;

    /** The source map of every import so far; `EMPTY_SOURCE_MAP` before the editor is built. */
    private _sourceMap: MarkdownSourceMap = EMPTY_SOURCE_MAP;

    /**
     * The loaded blocks of every import, keyed by node: the map `_sourceMap`
     * reads. Never pruned, since undo can bring back any earlier import's
     * nodes while the history holds them; see {@link adoptSourceMap}.
     */
    private readonly _sourceBlocks: Map<NodeKey, MarkdownSourceBlock> = new Map();

    /** The `mergeRegister` teardown for the rich-text / list / history / shortcut / update registrations. */
    private _unregister: (() => void) | null = null;

    /**
     * The teardown for {@link registerTableSelectionObserver}, registered only
     * once the WYSIWYG view actually mounts (its mutation listener needs a real
     * table element in the document) and cleared on {@link dispose}.
     */
    private _unregisterTableView: (() => void) | null = null;

    /** Custom-event fan-out for `"change"`. */
    private readonly _listeners: ListenerBag<MarkdownEditorEvent> = this.registerListenerBag(new ListenerBag<MarkdownEditorEvent>());

    /** The Card layout swapping the visible editing surface between WYSIWYG and source. */
    private readonly _card: Card;

    /** The WYSIWYG surface hosting Lexical's `contenteditable` view. */
    private readonly _wysiwyg: WysiwygSurface;

    /** The raw-Markdown source surface, shown in `"source"` mode. */
    private readonly _codeEditor: CodeEditor;

    /**
     * The right-click context menu shown over the WYSIWYG surface, in rebuild
     * mode — one instance whose item list is fully rebuilt on every
     * {@link Menu.show}, mirroring `Table`'s `_columnContextMenu`. The three
     * contexts this editor's own right-click can resolve to are mutually
     * exclusive per click, so one instance is safe to reuse across all of them.
     */
    private readonly _contextMenu: Menu = new Menu();

    /**
     * The Markdown as of the last clean point — the value this editor was
     * constructed with, the converted form re-taken when the Lexical editor
     * is first built, or the value `markClean()` last accepted. `onDocChange`
     * compares against it to decide the dirty flag.
     */
    private _cleanValue: string;

    /**
     * The {@link MarkdownEditorSelectionState} as of the last `"selectionstate"`
     * emit (or the neutral default before the first one). Compared against on
     * every commit so a commit that changes nothing tracked emits nothing.
     */
    private _lastSelectionState: MarkdownEditorSelectionState = NEUTRAL_SELECTION_STATE;

    /**
     * Constructs a Markdown editor.
     *
     * @param value - Initial Markdown source (optional; defaults to `""`).
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(value?: string, options?: MarkdownEditorOptions, subclassDefaults?: Partial<MarkdownEditorOptions>) {
        super(options, subclassDefaults);

        // Owns Tab while focus is inside: Lexical's table plugin handles Tab
        // cell-to-cell, which the framework's opt-in traversal service must
        // not steal. See FocusTraversal's Architecture Decisions.
        this.setTabKeyOwner(true);

        // Positional argument: cache it only when the caller didn't also pass
        // `options.value` (which the super-time cascade already stored).
        if (value !== undefined && this._options.value === undefined) {
            this._options.value = value;
        }

        // The component's own element hosts two swappable surfaces via a Card
        // (one DOM element per class): the WYSIWYG contenteditable and the source
        // CodeEditor. The Card shows exactly one at a time.
        this._card = new Card();
        this.setLayoutManager(this._card);

        this._wysiwyg = new WysiwygSurface(() => this.mountWysiwyg());
        // Arrow, not a bare method reference: ListenerBag.fire (which this `on`
        // ultimately dispatches through) calls listeners bare with no `this`
        // rebinding, unlike Event.addListener's `.apply(component, …)`.
        this._wysiwyg.on("contextmenu", (event) => this.handleWysiwygContextMenu(event));
        this._codeEditor = new CodeEditor(this._options.value ?? "", {
            language:  "markdown",
            readOnly:  this._options.readOnly ?? false,
            listeners: {
                change:          (payload) => this.handleCodeChange(payload),
                selectionchange: () => this.updateSelectionState(),
            },
        });

        this.addComponent(this._wysiwyg);
        this.addComponent(this._codeEditor);

        // Pick the initial visible child from the mode.
        this._card.setVisibleComponentId(
            this.getMode() === "source" ? this._codeEditor.getId() : this._wysiwyg.getId());

        this._cleanValue = this.getValue();

        this.applyListeners(options?.listeners);
    }

    /**
     * Caches the `value` / `readOnly` / `mode` fields onto `_options` after
     * inherited Component fields cascade through `super.applyOptions`. The editor
     * is built later (lazily), so these are pure caches applied to the freshly-
     * created editor state / surfaces in the constructor and `ensureEditor`.
     *
     * @param options - The options bag carrying the values to apply.
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: MarkdownEditorOptions): this {
        super.applyOptions(options);

        if (options.value    !== undefined) this._options.value    = options.value;
        if (options.readOnly !== undefined) this._options.readOnly = options.readOnly;
        if (options.mode     !== undefined) this._options.mode     = options.mode;

        return this;
    }

    /**
     * Returns the active editing surface mode.
     *
     * @returns `"source"` when the raw-Markdown surface is shown, else `"wysiwyg"`.
     */
    getMode(): MarkdownEditorMode {
        return this._options.mode ?? "wysiwyg";
    }

    /**
     * Whether the raw-Markdown source surface is the one currently shown. A
     * command with no source-mode behaviour returns early on this, so it never
     * mutates the Lexical document that surface is not showing.
     *
     * @returns `true` in `"source"` mode.
     */
    private isSourceMode(): boolean {
        return this.getMode() === "source";
    }

    /**
     * Applies `transform` to the source surface's raw Markdown when that surface
     * is the one shown, and restores focus to it afterwards — a toolbar click or
     * a menu row blurs the editing surface before the command runs. The range is
     * read from the `CodeEditor`'s own state rather than the DOM selection, which
     * a blurred surface no longer carries.
     *
     * @param transform - The edit rule to run against the raw Markdown.
     * @returns `true` when the source surface handled the command, so the caller
     *   must return without touching the Lexical document; `false` in WYSIWYG
     *   mode, so the caller falls through to its Lexical path.
     */
    private editSource(transform: MarkdownSourceTransform): boolean {
        if (!this.isSourceMode()) {
            return false;
        }

        const selection = this._codeEditor.getSelection();
        const edit = transform(this._codeEditor.getValue(), selection.from, selection.to);

        if (edit !== null) {
            this._codeEditor.replaceRange(edit.from, edit.to, edit.insert, edit.selection);
        }

        this._codeEditor.focus(true);

        return true;
    }

    /**
     * Whether the WYSIWYG selection touches a raw Markdown block or a code
     * block, where the commands that format, link or insert decline, as the
     * typing shortcuts do: what they would add there is shown but not saved,
     * both blocks saving their text as written.
     *
     * @returns `true` when any part of the selection lies in a raw block or a
     *   code block.
     */
    private declinesInTextOnlyBlock(): boolean {
        return this.ensureEditor().read($selectionTouchesTextOnlyBlock);
    }

    /**
     * Whether the WYSIWYG selection touches a table cell, where the block
     * conversions decline before anything is dispatched: a cell holds text
     * only, so a block made there would be saved into the cell as its
     * literal syntax.
     *
     * @returns `true` when any part of the selection lies in a table cell,
     *   or whole cells are selected.
     */
    private declinesInTableCell(): boolean {
        return this.ensureEditor().read($selectionTouchesTableCell);
    }

    /**
     * Switches the active editing surface. Converts the current document across
     * the surfaces so no edits are lost — the outgoing surface's Markdown is read
     * (via {@link MarkdownEditor.getValue}) before the mode flips, then loaded
     * into the incoming surface — and swaps the visible [`Card`](/api/layout/classes/Card) child.
     * No-op (no conversion, no `"change"`) when already in `mode`. Otherwise
     * emits a fresh `"selectionstate"` for the newly-shown surface, so a
     * toolbar's pressed/enabled state never keeps what the outgoing surface
     * last reported.
     *
     * @param mode - The surface to show.
     * @returns This component, for method chaining.
     */
    setMode(mode: MarkdownEditorMode): this {
        if (this.getMode() === mode) {
            return this;
        }

        // Read the canonical Markdown from the OUTGOING surface before the flip.
        const markdown = this.getValue();
        this._options.mode = mode;

        if (mode === "source") {
            this._codeEditor.setValue(markdown);
            this._card.setVisibleComponentId(this._codeEditor.getId());
        } else {
            this.ensureEditor().update(() => {
                this.adoptSourceMap($importMarkdown(markdown));
            }, { discrete: true });
            this._card.setVisibleComponentId(this._wysiwyg.getId());
        }

        this.updateSelectionState();

        return this;
    }

    /**
     * Returns the current document as a Markdown string, from whichever surface
     * is active: the raw source text in `"source"` mode, else converted live from
     * the Lexical editor state (or the cached pre-mount / offline value).
     *
     * @returns The Markdown source, or `""` when unset.
     */
    getValue(): string {
        if (this.getMode() === "source") {
            return this._codeEditor.getValue();
        }

        const editor = this._editor;

        if (editor) {
            return editor.read(() => $serializeMarkdown(this._sourceMap));
        }

        return this._options.value ?? "";
    }

    /**
     * Reads the current selection's tracked state — the five inline-format
     * flags, table/column-alignment context, and enclosing-block
     * alignment/column count — recomputed fresh from whichever surface is
     * active on every call, mirroring `CodeEditor.getCursorPosition`'s own
     * always-fresh contract; nothing is cached here beyond what
     * `updateSelectionState` needs for its own emit-dedup. In `"source"` mode
     * the five format flags, `hasSelectedText` and `linkUrl` are derived from
     * the raw Markdown, read as the viewer reads it, and
     * `inTable`/`tableColumnAlignment`/`blockAlignment`/`columnCount` report
     * the fields that mode has no notion of.
     *
     * @returns The current {@link MarkdownEditorSelectionState}: in
     *   `"source"` mode the state read from the raw Markdown, which is always
     *   available; in WYSIWYG mode the live Lexical state, or the neutral
     *   default before the Lexical editor is built.
     */
    getSelectionState(): MarkdownEditorSelectionState {
        return this.readActiveSelectionState();
    }

    /**
     * Reads the tracked selection state from whichever surface is active: the
     * raw Markdown in `"source"` mode, else the live Lexical state (or the
     * neutral default before the Lexical editor is built). Source mode answers
     * only what raw text can answer — the five format flags, whether there is
     * something to act on, and any enclosing link — and reports the table and
     * `:::` block fields as absent, which is what a consumer toolbar needs to
     * disable the controls those fields drive.
     *
     * @returns The current {@link MarkdownEditorSelectionState}.
     */
    private readActiveSelectionState(): MarkdownEditorSelectionState {
        if (this.isSourceMode()) {
            const selection = this._codeEditor.getSelection();

            return {
                ...readSourceSelectionState(this._codeEditor.getValue(), selection.from, selection.to),
                inTable:              false,
                tableColumnAlignment: null,
                blockAlignment:       null,
                columnCount:          1,
            };
        }

        const editor = this._editor;

        return editor ? editor.read(() => $readSelectionState()) : NEUTRAL_SELECTION_STATE;
    }

    /**
     * Replaces the whole document from a Markdown string, targeting the active
     * surface: the source `CodeEditor` in `"source"` mode, else the Lexical
     * editor (building it if needed). A resulting content change fires `"change"`.
     *
     * @param value - The new Markdown source.
     * @returns This component, for method chaining.
     */
    setValue(value: string): this {
        if (this.getMode() === "source") {
            this._codeEditor.setValue(value);

            return this;
        }

        // Discrete forces a synchronous commit, so the resulting `"change"`
        // fires before this returns rather than on a later flush.
        this.ensureEditor().update(() => {
            this.adoptSourceMap($importMarkdown(value));
        }, { discrete: true });

        return this;
    }

    /**
     * Accepts the current document as the clean Markdown, clearing this editor's
     * dirty flag (and, through the framework's relay, every ancestor's, unless
     * another descendant is still dirty). Call it after the host has persisted
     * the document, or after loading one with `setValue`. Persisting is the
     * host's job — this method only reports state; it writes nothing and does
     * not change the document.
     *
     * The editor reports itself dirty whenever `getValue()` differs from the
     * clean Markdown, in either editing mode, so an edit undone back to that
     * text clears the flag on its own.
     *
     * @returns This component, for method chaining.
     */
    markClean(): this {
        this._cleanValue = this.getValue();
        this.setDirty(false);
        this._codeEditor.markClean();

        return this;
    }

    /**
     * Returns whether the editor currently rejects edits.
     *
     * @returns The read-only state.
     */
    getReadOnly(): boolean {
        return this._options.readOnly ?? false;
    }

    /**
     * Sets whether the editor rejects edits, on **both** surfaces. Caches the
     * state; when the Lexical editor exists, toggles its editable flag (which
     * also drops the caret / editing affordances on the mounted view); and
     * forwards to the source `CodeEditor`.
     *
     * @param readOnly - Whether the editor should reject edits.
     * @returns This component, for method chaining.
     */
    setReadOnly(readOnly: boolean): this {
        this._options.readOnly = readOnly;
        this._editor?.setEditable(!readOnly);
        this._codeEditor.setReadOnly(readOnly);

        return this;
    }

    /**
     * Moves keyboard focus into the active editing surface, placing a caret
     * ready for typing: the Lexical contenteditable in WYSIWYG mode (building
     * and mounting the editor if needed), or the source `CodeEditor` in
     * `"source"` mode.
     *
     * Overrides {@link core!Component.focus}, whose default focuses this component's
     * own host element — the `Card` wrapper — which would leave the caret out of
     * the nested contenteditable the typing must land in. In WYSIWYG mode it
     * defers to Lexical's own `focus`, which both focuses the root element and
     * sets a selection so a caret appears without a click.
     *
     * @param preventScroll - Forwarded to the source `CodeEditor` in `"source"`
     *   mode; ignored in WYSIWYG mode, where Lexical manages its own focus scroll.
     * @returns This component, for method chaining.
     */
    focus(preventScroll: boolean = false): this {
        if (this.getMode() === "source") {
            this._codeEditor.focus(preventScroll);
        } else {
            this.ensureEditor().focus();
        }

        return this;
    }

    /**
     * Toggles bold on the current selection, first expanding a collapsed
     * caret to its enclosing word so the toggle has more than an empty span
     * to act on. No-op (without throwing) when there is no range selection,
     * when the selection touches a raw Markdown block or a code block, which
     * save their text as written, or when it holds a run kept as Markdown
     * source. Whole table cells selected take the format cell by cell under
     * the same rules, a cell holding such a run being left as it is.
     *
     * In `"source"` mode, toggles bold (`**bold**`, or a `__bold__` run
     * already there) around the raw-Markdown selection instead, reading the selection's formats as the viewer does; no-op
     * where the markers would read back as literal text — straight after a
     * backslash, or where Markdown's flanking rules stop them pairing
     * (`**hello.**b`) — and where they would cut another construct (half of
     * a run, an autolink, a code block). See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    toggleBold(): this {
        const handledBySource = this.editSource(BOLD_SOURCE);

        if (handledBySource) { return this; }

        const touchesTextOnlyBlock = this.declinesInTextOnlyBlock();

        if (touchesTextOnlyBlock) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => { $selectEnclosingWordIfCollapsed(); }, { discrete: true });
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");

        return this;
    }

    /**
     * Toggles italic on the current selection, first expanding a collapsed
     * caret to its enclosing word. No-op without a range selection, when the
     * selection touches a raw Markdown block or a code block, or when it holds
     * a run kept as Markdown source. Whole table cells selected take the
     * format cell by cell, as {@link MarkdownEditor.toggleBold} describes.
     *
     * In `"source"` mode, toggles italic (`*italic*`, or an `_italic_` run
     * already there) around the raw-Markdown selection instead, reading the selection's formats as the viewer does; no-op
     * where the markers would read back as literal text — straight after a
     * backslash, or where Markdown's flanking rules stop them pairing
     * (`**hello.**b`) — and where they would cut another construct (half of
     * a run, an autolink, a code block). See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    toggleItalic(): this {
        const handledBySource = this.editSource(ITALIC_SOURCE);

        if (handledBySource) { return this; }

        const touchesTextOnlyBlock = this.declinesInTextOnlyBlock();

        if (touchesTextOnlyBlock) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => { $selectEnclosingWordIfCollapsed(); }, { discrete: true });
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");

        return this;
    }

    /**
     * Toggles inline code on the current selection, first expanding a
     * collapsed caret to its enclosing word or run. No-op without a range
     * selection, when the selection touches a raw Markdown block or a code
     * block, or when it holds a run kept as Markdown source. Whole table
     * cells selected take the format cell by cell, as
     * {@link MarkdownEditor.toggleBold} describes.
     *
     * In `"source"` mode, toggles the `` `code` `` marker around the
     * raw-Markdown selection instead; refuses a selection that still contains
     * a backtick, one straight after a backslash, which would escape the
     * opening backtick, one whose text would read differently as code, and one
     * that would cut another construct (half of a run, an autolink).
     *
     * @returns This component, for method chaining.
     */
    toggleInlineCode(): this {
        const handledBySource = this.editSource(INLINE_CODE_SOURCE);

        if (handledBySource) { return this; }

        const touchesTextOnlyBlock = this.declinesInTextOnlyBlock();

        if (touchesTextOnlyBlock) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => { $selectEnclosingWordIfCollapsed(); }, { discrete: true });
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code");

        return this;
    }

    /**
     * Toggles strikethrough on the current selection, first expanding a
     * collapsed caret to its enclosing word. No-op without a range selection,
     * when the selection touches a raw Markdown block or a code block, or when
     * it holds a run kept as Markdown source. Whole table cells selected take
     * the format cell by cell, as {@link MarkdownEditor.toggleBold} describes.
     *
     * In `"source"` mode, toggles strikethrough (`~~strikethrough~~`, or a
     * `~struck~` run already there) around the raw-Markdown selection instead, reading the selection's formats as the viewer does; no-op
     * where the markers would read back as literal text — straight after a
     * backslash, or where Markdown's flanking rules stop them pairing
     * (`**hello.**b`) — and where they would cut another construct (half of
     * a run, an autolink, a code block). See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    toggleStrikethrough(): this {
        const handledBySource = this.editSource(STRIKETHROUGH_SOURCE);

        if (handledBySource) { return this; }

        const touchesTextOnlyBlock = this.declinesInTextOnlyBlock();

        if (touchesTextOnlyBlock) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => { $selectEnclosingWordIfCollapsed(); }, { discrete: true });
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");

        return this;
    }

    /**
     * Toggles underline on the current selection, first expanding a collapsed
     * caret to its enclosing word. No-op without a range selection, when the
     * selection touches a raw Markdown block or a code block, or when it holds
     * a run kept as Markdown source. Whole table cells selected take the
     * format cell by cell, as {@link MarkdownEditor.toggleBold} describes.
     *
     * In `"source"` mode, toggles the dialect's `++underline++` marker around
     * the raw-Markdown selection instead, reading the selection's formats as
     * the viewer does; no-op where the markers would not read back as
     * underline, and where they would cut another construct (half of a run,
     * an autolink, a code block). See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    toggleUnderline(): this {
        const handledBySource = this.editSource(UNDERLINE_SOURCE);

        if (handledBySource) { return this; }

        const touchesTextOnlyBlock = this.declinesInTextOnlyBlock();

        if (touchesTextOnlyBlock) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => { $selectEnclosingWordIfCollapsed(); }, { discrete: true });
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");

        return this;
    }

    /**
     * Shared body of {@link setTextColor}, {@link setFontFamily}, and
     * {@link setFontSize}: expands a collapsed caret to its enclosing word,
     * then patches the resulting selection's inline CSS style. No-op without a
     * range selection, when the selection touches a raw Markdown block or a
     * code block or holds a run kept as Markdown source, or when it sits
     * inside a link (see
     * *Colour, font, and size are refused inside a link* in the plan's
     * Architecture Decisions) — a styled span can never nest inside `[text](url)`.
     *
     * In `"source"` mode this writes the `[text]{…}` styled span into the raw
     * Markdown instead, inside any emphasis around the selection
     * (`**[hello]{…}**`, the form WYSIWYG saves), merging into an existing
     * span rather than nesting inside it. The raw text is read as the viewer
     * reads it, so only a selection the span would break is refused: one that
     * crosses a line break, touches a link of any form or an image (an
     * image's `{width=…}` group included), lies in a code span, a code block,
     * a `:::` fence line or a table delimiter row, cuts through a run's
     * markers, or would put a bracket straight after an escaping backslash.
     *
     * @param patch - Kebab-case CSS property names mapped to their new value,
     *   or `null` to remove that property.
     * @returns This component, for method chaining.
     */
    private patchSelectionStyle(patch: Record<string, string | null>): this {
        const handledBySource = this.editSource(spanStyleSource(patch));

        if (handledBySource) {
            return this;
        }

        const touchesTextOnlyBlock = this.declinesInTextOnlyBlock();

        if (touchesTextOnlyBlock) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection) || $findEnclosingLinkNode(selection.anchor.getNode()) !== null) {
                return;
            }

            $selectEnclosingWordIfCollapsed();

            // Re-read: the expansion above replaces the selection object.
            const expanded = $getSelection();
            const coversSourceRun = $selectionCoversSourceRun();

            if ($isRangeSelection(expanded) && !coversSourceRun) {
                $editWritably(() => {
                    $patchStyleText(expanded, patch);
                });
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Sets (or clears, with `null`) the current selection's text colour. A
     * collapsed caret first expands to its enclosing word. No-op without a
     * range selection, when the selection touches a raw Markdown block or a
     * code block or holds a run kept as Markdown source, or when it sits
     * inside a link.
     *
     * In `"source"` mode this writes the `[text]{…}` styled span into the raw
     * Markdown instead, inside any emphasis around the selection
     * (`**[hello]{…}**`, the form WYSIWYG saves), merging into an existing
     * span rather than nesting inside it. The raw text is read as the viewer
     * reads it, so only a selection the span would break is refused: one that
     * crosses a line break, touches a link of any form or an image (an
     * image's `{width=…}` group included), lies in a code span, a code block,
     * a `:::` fence line or a table delimiter row, cuts through a run's
     * markers, or would put a bracket straight after an escaping backslash.
     *
     * @param color - A CSS colour value, or `null` to clear the override.
     * @returns This component, for method chaining.
     */
    setTextColor(color: string | null): this {
        return this.patchSelectionStyle({ color });
    }

    /**
     * Sets (or clears, with `null`) the current selection's font family. A
     * collapsed caret first expands to its enclosing word. No-op without a
     * range selection, when the selection touches a raw Markdown block or a
     * code block or holds a run kept as Markdown source, or when it sits
     * inside a link.
     *
     * In `"source"` mode this writes the `[text]{…}` styled span into the raw
     * Markdown instead, inside any emphasis around the selection
     * (`**[hello]{…}**`, the form WYSIWYG saves), merging into an existing
     * span rather than nesting inside it. The raw text is read as the viewer
     * reads it, so only a selection the span would break is refused: one that
     * crosses a line break, touches a link of any form or an image (an
     * image's `{width=…}` group included), lies in a code span, a code block,
     * a `:::` fence line or a table delimiter row, cuts through a run's
     * markers, or would put a bracket straight after an escaping backslash.
     *
     * @param family - A CSS `font-family` value, or `null` to clear the override.
     * @returns This component, for method chaining.
     */
    setFontFamily(family: string | null): this {
        return this.patchSelectionStyle({ "font-family": family });
    }

    /**
     * Sets (or clears, with `null`) the current selection's font size. A
     * collapsed caret first expands to its enclosing word. No-op without a
     * range selection, when the selection touches a raw Markdown block or a
     * code block or holds a run kept as Markdown source, or when it sits
     * inside a link.
     *
     * In `"source"` mode this writes the `[text]{…}` styled span into the raw
     * Markdown instead, inside any emphasis around the selection
     * (`**[hello]{…}**`, the form WYSIWYG saves), merging into an existing
     * span rather than nesting inside it. The raw text is read as the viewer
     * reads it, so only a selection the span would break is refused: one that
     * crosses a line break, touches a link of any form or an image (an
     * image's `{width=…}` group included), lies in a code span, a code block,
     * a `:::` fence line or a table delimiter row, cuts through a run's
     * markers, or would put a bracket straight after an escaping backslash.
     *
     * @param size - A CSS font-size value (e.g. `"1.2em"`), or `null` to clear
     *   the override.
     * @returns This component, for method chaining.
     */
    setFontSize(size: string | null): this {
        return this.patchSelectionStyle({ "font-size": size });
    }

    /**
     * Converts the selected blocks into an unordered (bulleted) list, or out of
     * one when already a list. No-op without a range selection, and when the
     * selection touches a table cell (whole cells selected included), which
     * holds text only.
     *
     * In `"source"` mode, toggles the `- ` list over the raw Markdown's
     * selected lines instead.
     *
     * @returns This component, for method chaining.
     */
    toggleUnorderedList(): this {
        const handledBySource = this.editSource(listSource("unordered"));

        if (handledBySource) { return this; }

        const touchesTableCell = this.declinesInTableCell();

        if (touchesTableCell) { return this; }

        this.ensureEditor().dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);

        return this;
    }

    /**
     * Converts the selected blocks into an ordered (numbered) list, or out of
     * one when already a list. No-op without a range selection, and when the
     * selection touches a table cell (whole cells selected included), which
     * holds text only.
     *
     * In `"source"` mode, toggles the `1. ` list over the raw Markdown's
     * selected lines instead.
     *
     * @returns This component, for method chaining.
     */
    toggleOrderedList(): this {
        const handledBySource = this.editSource(listSource("ordered"));

        if (handledBySource) { return this; }

        const touchesTableCell = this.declinesInTableCell();

        if (touchesTableCell) { return this; }

        this.ensureEditor().dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);

        return this;
    }

    /**
     * Wraps the current selection in a link to `url`, or unwraps it when `url`
     * is `null`. A collapsed caret first expands to its enclosing word (see
     * `$selectEnclosingWordIfCollapsed`) when `url` is non-null, so wrapping a
     * bare caret links just that word rather than the whole enclosing text run.
     * When the selection already sits inside one existing link, updates that
     * link's URL in place instead of double-wrapping (Lexical's own `$toggleLink`
     * behavior). No-op without a range selection, when the selection touches
     * a raw Markdown block or a code block, or when it holds a run kept as
     * Markdown source.
     *
     * In `"source"` mode, wraps the raw-Markdown selection in `[text](url)`,
     * or re-points the link of any form enclosing it instead — an inline link
     * keeps its title as written, and a reference link or autolink becomes an
     * inline link (a reference link keeping its title); no-op inside an
     * image's alt text, and for a selection holding a link or cutting another
     * construct.
     *
     * @param url - The link target, or `null` to remove the link.
     * @returns This component, for method chaining.
     */
    toggleLink(url: string | null): this {
        const handledBySource = this.editSource(linkSource(url));

        if (handledBySource) { return this; }

        const touchesTextOnlyBlock = this.declinesInTextOnlyBlock();

        if (touchesTextOnlyBlock) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return;
            }

            if (url !== null) {
                $selectEnclosingWordIfCollapsed();
            }

            const declined = $selectionCoversSourceRun() || $selectionInNestedLinkRun();

            if (declined) {
                return;
            }

            $editWritably(() => {
                $toggleLink(url);
            });
        }, { discrete: true });

        return this;
    }

    /**
     * Removes the link enclosing the current selection, unwrapping it back to
     * plain text and keeping the text content — the whole link, regardless of
     * how much of it (if any) is currently selected. No-op (without throwing)
     * when there is no range selection, or it is not inside a link.
     *
     * In `"source"` mode, removes the raw-Markdown link of any form enclosing
     * the selection, unwrapping it back to plain text, instead; an autolink's
     * text gets its `:`, `.` or `@` escaped, so it is not linked again.
     *
     * @returns This component, for method chaining.
     */
    removeLink(): this {
        const handledBySource = this.editSource(REMOVE_LINK_SOURCE);

        if (handledBySource) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return;
            }

            const linkNode = $findEnclosingLinkNode(selection.anchor.getNode());
            const inNestedLinkRun = $selectionInNestedLinkRun();

            if (linkNode === null || inNestedLinkRun) {
                return;
            }

            // Collapsing inside the link first routes $toggleLink(null) through
            // its collapsed-selection branch, which always unwraps the whole
            // link — its range-selection branch only unwraps the selected
            // portion (see Architecture Decisions).
            linkNode.selectStart();
            $toggleLink(null);
        }, { discrete: true });

        return this;
    }

    /**
     * Clears every inline text format (bold, italic, strikethrough, inline code,
     * and any other Lexical text format) from the current selection, leaving
     * plain text. No-op without a range selection. Block type is untouched.
     *
     * In `"source"` mode, removes the markers of every emphasis run (any
     * form the viewer reads, `__bold__` and `_italic_` included) and code span
     * the raw-Markdown selection touches instead — both sides of a run
     * together, even when the selection reaches only one — leaving links and
     * `[text]{…}` styled spans alone; no-op when the selection touches no
     * run.
     *
     * @returns This component, for method chaining.
     */
    clearFormatting(): this {
        const handledBySource = this.editSource(CLEAR_FORMAT_SOURCE);

        if (handledBySource) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return;
            }

            $editWritably(() => {
                for (const node of selection.getNodes()) {
                    if ($isTextNode(node)) {
                        // A nested link's run, or a kept construct's, keeps the formats its source writes.
                        const kept = $getState(node, keptSourceState);
                        const written = !$isMarkdownSourceTextNode(node) ? 0 : kept !== null ? kept.writes : Math.max(0, $getState(node, nestedLinkState));

                        node.setFormat(node.getFormat() & (~IS_ALL_FORMATTING | written));
                    }
                }
            });
        }, { discrete: true });

        return this;
    }

    /**
     * Writes the current selection's text to the system clipboard, first
     * expanding a collapsed caret to its enclosing word or run so Copy has
     * something to act on — matching the right-click menu's own
     * Cut/Copy-enabled state, which reflects that same hypothetical expansion
     * without performing it. No-op (without throwing, and without writing)
     * when there is no range selection, or the selection is collapsed with
     * nothing to expand into.
     *
     * In `"source"` mode, delegates to the source editor's own `copy()`
     * instead.
     *
     * @returns This component, for method chaining.
     */
    copy(): this {
        const sourceMode = this.isSourceMode();

        if (sourceMode) {
            this._codeEditor.copy();

            return this;
        }

        const editor = this.ensureEditor();

        editor.update(() => { $selectEnclosingWordIfCollapsed(); }, { discrete: true });

        const text = editor.read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection) ? selection.getTextContent() : "";
        });

        // Guarded: writing "" would clobber the clipboard with nothing.
        if (text !== "") {
            DOM.sink.writeClipboardText(text);

            // $selectEnclosingWordIfCollapsed() above is a true no-op on an
            // already non-collapsed selection — it never marks the selection
            // dirty, so Lexical's reconciler skips its selection-sync step
            // entirely, which is the only place that would otherwise
            // incidentally restore focus (as it does for the collapsed-caret
            // expansion case, which does mark it dirty). Calling focus()
            // explicitly forces that resync unconditionally: its own
            // documented behaviour marks an already-clean selection dirty via
            // $setSelection(selection.clone()) — the same selection, not a
            // different one — so nothing about what's selected changes.
            this.ensureEditor().focus();
        }

        return this;
    }

    /**
     * Writes the current selection's text to the system clipboard, then
     * removes it from the document — first expanding a collapsed caret to
     * its enclosing word via {@link MarkdownEditor.copy}. No-op (without
     * throwing) when there is no range selection, or the selection is
     * collapsed with nothing to expand into.
     *
     * In `"source"` mode, delegates to the source editor's own `cut()`
     * instead.
     *
     * @returns This component, for method chaining.
     */
    cut(): this {
        if (this.isSourceMode()) {
            this._codeEditor.cut();

            return this;
        }

        this.copy();

        this.ensureEditor().update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                selection.removeText();   // a no-op on a collapsed selection
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Reads the system clipboard and inserts the text at the caret, replacing
     * any current selection. No-op (without throwing) when there is no range
     * selection.
     *
     * In `"source"` mode, delegates to the source editor's own `paste()`
     * instead.
     *
     * @returns A promise resolving `true` when the clipboard was read (even if
     *   it was empty), or `false` when the read was unavailable or denied.
     */
    async paste(): Promise<boolean> {
        if (this.isSourceMode()) { return this._codeEditor.paste(); }

        const text = await DOM.source.readClipboardText();

        if (text === null) {
            // See copy()'s comment: restores focus after the context-menu
            // row's click blurred the editor, even on a denied read.
            this.ensureEditor().focus();

            return false;
        }

        if (text !== "") {
            this.ensureEditor().update(() => {
                const selection = $getSelection();

                if ($isRangeSelection(selection)) {
                    selection.insertRawText(text);
                }
            }, { discrete: true });
        }

        // See copy()'s comment: restores focus after the context-menu row's
        // click blurred the editor.
        this.ensureEditor().focus();

        return true;
    }

    /**
     * Converts the selected blocks to `type` (paragraph, `h1`–`h6`, blockquote,
     * or fenced code). No-op without a range selection, and when the selection
     * touches a table cell (whole cells selected included), which holds text
     * only.
     *
     * In `"source"` mode, converts the raw Markdown's selected blocks instead —
     * see `sourceTransformForBlockType`.
     *
     * @param type - The target block type.
     * @returns This component, for method chaining.
     */
    setBlockType(type: MarkdownBlockType): this {
        const handledBySource = this.editSource(sourceTransformForBlockType(type));

        if (handledBySource) { return this; }

        const touchesTableCell = this.declinesInTableCell();

        if (touchesTableCell) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                $setBlocksType(selection, () => createBlockNode(type), type === "code" ? $copyBlockAsCodeSource : undefined);
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Sets (or, with `null`, clears) the block alignment of the top-level
     * blocks the current selection spans, wrapping them in a `:::` fence (or
     * updating the enclosing fence's alignment if the caret already sits
     * inside one). Unwraps and removes the enclosing fence when clearing its
     * alignment leaves it with no more than one column either. No-op
     * without a range selection.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @param align - The new block alignment, or `null` to clear it.
     * @returns This component, for method chaining.
     */
    setBlockAlignment(align: MarkdownBlockAlignment | null): this {
        if (this.isSourceMode()) { return this; }

        this.ensureEditor().update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return;
            }

            const existing = $findMatchingParent(selection.anchor.getNode(), $isMarkdownBlockNode);

            if (existing !== null) {
                existing.setAlign(align);

                if (existing.canUnwrap()) {
                    $unwrapMarkdownBlock(existing);
                }

                return;
            }

            if (align !== null) {
                $wrapSelectedTopLevelBlocks().setAlign(align);
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Grows or shrinks the number of explicit column regions of the block
     * the current selection sits in (or wraps the top-level blocks the
     * selection spans in a new one), and optionally sets the column gap.
     * Growing appends empty columns; shrinking merges the surplus columns'
     * content into the last column kept, except a surplus column that is
     * still exactly as this method created it (a single empty paragraph and
     * nothing else), which is dropped instead — so growing and then
     * shrinking back returns the original document. Unwraps and removes the
     * enclosing fence when the result leaves it with no more than one
     * column and no alignment. `count` is clamped to 1–6; `null` means one
     * column. No-op without a range selection.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @param count - The new column count, or `null` to clear it.
     * @param gap - The new column gap override; omitted leaves the existing gap untouched, `null` clears it.
     * @returns This component, for method chaining.
     */
    setColumnCount(count: number | null, gap?: string | null): this {
        if (this.isSourceMode()) { return this; }

        const target = Math.max(1, Math.min(count ?? 1, MAX_COLUMN_COUNT));

        this.ensureEditor().update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return;
            }

            const existing = $findMatchingParent(selection.anchor.getNode(), $isMarkdownBlockNode);
            const block = existing ?? (target > 1 ? $wrapSelectedTopLevelBlocks() : null);

            if (block === null) {
                return;
            }

            $setBlockColumnCount(block, target);

            if (gap !== undefined) {
                block.setColumnGap(gap);
            }

            if (block.canUnwrap()) {
                $unwrapMarkdownBlock(block);
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Inserts an empty paragraph immediately before the blockquote, list,
     * fenced code block, or table enclosing the caret, and moves the caret
     * into it. For a list or a table cell, this is the whole list or table,
     * not just the clicked item or cell. No-op without throwing when the
     * caret is not inside one of those four block types.
     *
     * In `"source"` mode, inserts a blank line before the raw-Markdown
     * top-level blockquote, list, code block, or table holding the caret's
     * line instead, read as the viewer reads it; no-op when the caret's line
     * is in none.
     *
     * @returns This component, for method chaining.
     */
    insertParagraphBeforeBlock(): this {
        const handledBySource = this.editSource(paragraphAroundBlockSource(false));

        if (handledBySource) { return this; }

        this.ensureEditor().update(() => { $insertParagraphAroundEnclosingBlock(false); }, { discrete: true });

        return this;
    }

    /**
     * Inserts an empty paragraph immediately after the blockquote, list,
     * fenced code block, or table enclosing the caret, and moves the caret
     * into it. For a list or a table cell, this is the whole list or table,
     * not just the clicked item or cell. No-op without throwing when the
     * caret is not inside one of those four block types.
     *
     * In `"source"` mode, inserts a blank line after the raw-Markdown
     * top-level blockquote, list, code block, or table holding the caret's
     * line instead, read as the viewer reads it; no-op when the caret's line
     * is in none.
     *
     * @returns This component, for method chaining.
     */
    insertParagraphAfterBlock(): this {
        const handledBySource = this.editSource(paragraphAroundBlockSource(true));

        if (handledBySource) { return this; }

        this.ensureEditor().update(() => { $insertParagraphAroundEnclosingBlock(true); }, { discrete: true });

        return this;
    }

    /**
     * Inserts a table of `rows` rows by `columns` columns at the caret. The
     * first row is the header row, so `insertTable(2, 3)` gives a header row
     * plus one body row. The caret lands in the first header cell. No-op when
     * the selection touches a raw Markdown block or a code block.
     *
     * In `"source"` mode, inserts the raw-Markdown GFM table skeleton above
     * the block holding the caret instead.
     *
     * @param rows - The number of rows, including the header row.
     * @param columns - The number of columns.
     * @returns This component, for method chaining.
     */
    insertTable(rows: number, columns: number): this {
        const handledBySource = this.editSource(tableSource(rows, columns));

        if (handledBySource) { return this; }

        const touchesTextOnlyBlock = this.declinesInTextOnlyBlock();

        if (touchesTextOnlyBlock) { return this; }

        const editor = this.ensureEditor();

        // INSERT_TABLE_COMMAND inserts at the selection; a freshly built editor
        // may have none, so seed one first.
        editor.update(() => {
            if (!$isRangeSelection($getSelection())) {
                $getRoot().selectEnd();
            }
        }, { discrete: true });

        editor.dispatchCommand(INSERT_TABLE_COMMAND, {
            columns:        String(columns),
            rows:           String(rows),
            includeHeaders: { rows: true, columns: false },
        });

        return this;
    }

    /**
     * Inserts a sized, validated image at the caret. No-op when `src` fails
     * the scheme allow-list — never inserts a broken or unsafe image — when
     * `alt` holds a `[` or `]`, which Markdown's image syntax cannot hold, and
     * when the selection touches a raw Markdown block or a code block.
     *
     * In `"source"` mode, inserts the raw-Markdown `![alt](src)` — plus a
     * `{width=… height=…}` attribute block when either dimension is set —
     * at the selection instead; no-op there when either end of the selection
     * sits inside an image or inside a link's syntax beyond its text — its
     * destination, a reference link's label, or an autolink — or when the
     * selection reaches outside one table cell or onto a `:::` fence's own
     * lines.
     *
     * @param src - The image source (a relative path, `http:`/`https:` URL,
     *   or an allow-listed `data:image/…` base64 URI).
     * @param options - Optional `alt` text and explicit pixel `width`/`height`.
     * @returns This component, for method chaining.
     */
    insertImage(src: string, options?: { alt?: string; width?: number; height?: number }): this {
        // The image syntax's alt text cannot hold a bracket: a save would drop it.
        const altHoldsBracket = /[[\]]/.test(options?.alt ?? "");

        if (altHoldsBracket) { return this; }

        const handledBySource = this.editSource(imageSource(src, options?.alt ?? "", imageAttributes(options)));

        if (handledBySource) { return this; }

        const touchesTextOnlyBlock = this.declinesInTextOnlyBlock();

        if (touchesTextOnlyBlock) { return this; }

        const editor = this.ensureEditor();

        // Tagged as an edit at a run's edge: the image can change how source kept as written next to it reads.
        editor.update(() => {
            const spec = resolveImageSpec(src, options?.alt ?? "", imageAttributes(options));

            if (spec === null) {
                return;
            }

            let selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                $getRoot().selectEnd();
                selection = $getSelection();
            }

            if ($isRangeSelection(selection)) {
                selection.insertNodes([$createMarkdownImageNode(spec)]);
            }
        }, { discrete: true, tag: RUN_EDGE_TAG });

        return this;
    }

    /**
     * Inserts a row after (default) or before the row holding the caret.
     * No-op without throwing when the caret is not inside a table cell.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @param after - Whether to insert after (`true`, default) or before
     *   (`false`) the current row.
     * @returns This component, for method chaining.
     */
    insertTableRow(after: boolean = true): this {
        if (this.isSourceMode()) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            if ($selectionIsInTableCell()) {
                $insertTableRowAtSelection(after);
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Deletes the row holding the caret. No-op without throwing when the
     * caret is not inside a table cell.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @returns This component, for method chaining.
     */
    deleteTableRow(): this {
        if (this.isSourceMode()) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            if ($selectionIsInTableCell()) {
                $deleteTableRowAtSelection();
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Inserts a column after (default) or before the column holding the
     * caret. No-op without throwing when the caret is not inside a table cell.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @param after - Whether to insert after (`true`, default) or before
     *   (`false`) the current column.
     * @returns This component, for method chaining.
     */
    insertTableColumn(after: boolean = true): this {
        if (this.isSourceMode()) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            if ($selectionIsInTableCell()) {
                $insertTableColumnAtSelection(after);
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Deletes the column holding the caret. No-op without throwing when the
     * caret is not inside a table cell.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @returns This component, for method chaining.
     */
    deleteTableColumn(): this {
        if (this.isSourceMode()) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            if ($selectionIsInTableCell()) {
                $deleteTableColumnAtSelection();
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Sets the alignment of the column holding the caret, on every cell in
     * that column. No-op without throwing when the caret is not inside a
     * table cell.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @param alignment - The alignment to apply to the column.
     * @returns This component, for method chaining.
     */
    setTableColumnAlignment(alignment: MarkdownTableAlignment): this {
        if (this.isSourceMode()) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            $setEnclosingColumnAlignment(alignment);
        }, { discrete: true });

        return this;
    }

    /**
     * Deletes the entire table containing the caret, including every row and
     * cell. No-op without throwing when the caret is not inside a table cell.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @returns This component, for method chaining.
     */
    deleteTable(): this {
        if (this.isSourceMode()) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            $getEnclosingTableNode()?.remove();
        }, { discrete: true });

        return this;
    }

    /**
     * Merges the cells of the current drag-selected `TableSelection` into
     * one, carrying `<<`/`^^` continuations on export. No-op without throwing
     * when the current selection is not a `TableSelection` spanning more than
     * one cell.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @returns This component, for method chaining.
     */
    mergeTableCells(): this {
        if (this.isSourceMode()) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            const selection = $getSelection();

            if (!$isTableSelection(selection)) {
                return;
            }

            const cells = selection.getNodes().filter($isTableCellNode);

            if (cells.length > 1) {
                $mergeCells(cells);
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Splits the merged cell containing the caret back into its individual
     * cells. No-op without throwing when the caret is not inside a table cell.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @returns This component, for method chaining.
     */
    unmergeTableCell(): this {
        if (this.isSourceMode()) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            if ($selectionIsInTableCell()) {
                $unmergeCell();
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Sets (or, with `null`, clears) the width of the column the caret sits
     * in, in pixels. No-op without throwing when the caret is not inside a
     * table cell.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @param width - The column width in pixels, or `null` to clear it.
     * @returns This component, for method chaining.
     */
    setTableColumnWidth(width: number | null): this {
        if (this.isSourceMode()) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return;
            }

            const cell = $getTableCellNodeFromLexicalNode(selection.anchor.getNode());

            if (cell === null) {
                return;
            }

            const table = $getTableNodeFromLexicalNodeOrThrow(cell);
            const columnIndex = $getTableColumnIndexFromTableCellNode(cell);
            const columnCount = $getTableColumnCount(table);
            const colWidths = (table.getColWidths() ?? new Array<number>(columnCount).fill(0)).slice();

            colWidths[columnIndex] = width ?? 0;
            table.setColWidths(colWidths);
        }, { discrete: true });

        return this;
    }

    /**
     * Registers a listener for the `"change"` event, fired whenever the document
     * content changes (typing, a command, or {@link MarkdownEditor.setValue}) in
     * whichever surface is active.
     *
     * @param event - Must be `"change"`.
     * @param listener - Invoked with the new Markdown value.
     * @returns This component, for method chaining.
     */
    on(event: "change", listener: (payload: MarkdownEditorChange) => void): this;
    /**
     * Registers a listener for the `"selectionstate"` event, fired whenever the
     * selection's tracked format/table/block state changes.
     *
     * @param event - Must be `"selectionstate"`.
     * @param listener - Invoked with the new {@link MarkdownEditorSelectionState}.
     * @returns This component, for method chaining.
     */
    on(event: "selectionstate", listener: (payload: MarkdownEditorSelectionState) => void): this;
    on(event: MarkdownEditorEvent, listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered `"change"` listener.
     *
     * @param event - Must be `"change"`.
     * @param listener - The exact callback reference to remove.
     * @returns This component, for method chaining.
     */
    off(event: "change", listener: (payload: MarkdownEditorChange) => void): this;
    /**
     * Removes a previously registered `"selectionstate"` listener.
     *
     * @param event - Must be `"selectionstate"`.
     * @param listener - The exact callback reference to remove.
     * @returns This component, for method chaining.
     */
    off(event: "selectionstate", listener: (payload: MarkdownEditorSelectionState) => void): this;
    off(event: MarkdownEditorEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans an event out to its registered listeners.
     *
     * @param event - The event name.
     * @param payload - The event payload (`"change"`/`"selectionstate"`).
     */
    protected emit(event: "change", payload: MarkdownEditorChange): void;
    protected emit(event: "selectionstate", payload: MarkdownEditorSelectionState): void;
    protected emit(event: MarkdownEditorEvent, payload: MarkdownEditorChange | MarkdownEditorSelectionState): void {
        this._listeners.fire(event, payload);
    }

    /**
     * Sets whether the WYSIWYG surface's element hosts an editable region.
     * Forwards to the private surface, preserving the public setter.
     *
     * @param contentEditable - Whether the element is contenteditable.
     * @returns This component, for method chaining.
     */
    setContentEditable(contentEditable: boolean): this {
        this._wysiwyg.setContentEditable(contentEditable);

        return this;
    }

    /**
     * Returns whether the WYSIWYG surface's element hosts an editable region.
     *
     * @returns The contenteditable state.
     */
    getContentEditable(): boolean {
        return this._wysiwyg.getContentEditable();
    }

    /**
     * Detaches the Lexical registrations and the WYSIWYG surface's live view,
     * then defers to the base class for the rest of teardown — including
     * disposing the registered `_codeEditor` child, which mirrors
     * `CodeEditor.destructor`. Call before discarding a dynamically-built
     * `MarkdownEditor`.
     */
    protected destructor(): void {
        this._unregisterTableView?.();
        this._unregister?.();
        this._editor?.setRootElement(null);

        // `Menu` is never registered via `addComponent` (per its own class
        // comment), so the base class's child-recursion teardown below cannot
        // reach it — `Table.destructor()` disposes `_columnContextMenu` the
        // same explicit way.
        this._contextMenu.dispose();

        // `_codeEditor` is registered via `addComponent`, so
        // `super.destructor()`'s child recursion below already disposes it —
        // an explicit call here would run `CodeEditor.destructor()` a second
        // time.
        super.destructor();
    }

    /**
     * Builds the headless Lexical editor on first use. Idempotent: the editor is
     * built once. Offline the editor stays headless — the state, and every value
     * / command operation, still work.
     *
     * @returns The live (headless-capable) Lexical editor.
     */
    private ensureEditor(): LexicalEditor {
        if (!this._editor) {
            const editor = createEditor({ nodes: EDITOR_NODES, theme: EDITOR_THEME, onError: reportEditorError });
            const unregisterWritableStateRules = registerWritableStateRules(editor);

            // Populate the initial state before registering the update listener,
            // so loading the cached value does not fire a spurious `"change"`.
            editor.update(() => {
                this.adoptSourceMap($importMarkdown(this._options.value ?? ""));
            }, { discrete: true });
            editor.setEditable(!(this._options.readOnly ?? false));

            // An unedited document saves as loaded, except that `\r\n` line endings become
            // `\n`, so from here on `getValue()` reports the converted form rather than the
            // string this editor was built with. Re-take the clean Markdown from the
            // converted form so both sides of `onDocChange`'s comparison come from the same
            // converter — but only while the document is still clean, since a first build can
            // also happen after a source-mode edit, and re-taking then would clear a real
            // dirty flag.
            if (!this.isDirty()) {
                this._cleanValue = editor.read(() => $serializeMarkdown(this._sourceMap));
            }

            this._unregister = mergeRegister(
                unregisterWritableStateRules,
                registerRichText(editor),
                registerList(editor),
                registerTablePlugin(editor),
                registerHistory(editor, createEmptyHistoryState(), HISTORY_DELAY_MS),
                registerMarkdownShortcutsOutsideRawBlocks(editor),
                editor.registerCommand(KEY_ENTER_COMMAND, $handleSeparatorShortcut, COMMAND_PRIORITY_HIGH),
                registerTextOnlyBlockRules(editor),
                registerWritableFormatCommand(editor),
                editor.registerUpdateListener(() => {
                    this.handleChange();
                    this.updateSelectionState();
                }),
            );

            this._editor = editor;
        }

        return this._editor;
    }

    /**
     * Builds the headless editor (if needed) and mounts its live view into the
     * WYSIWYG surface. Driven by the surface's first connected layout, i.e. the
     * first time it is the visible `Card` child and gets sized.
     */
    private mountWysiwyg(): void {
        const editor = this.ensureEditor();

        this._wysiwyg.mount(editor);

        // Offline the seam's mountView returns null and the root stays unset;
        // the observer's mutation listener needs a real table element in the
        // document and throws without one, so it is view-time only.
        if (editor.getRootElement() && !this._unregisterTableView) {
            this._unregisterTableView = registerTableSelectionObserver(editor, true);
        }
    }

    /**
     * `WysiwygSurface`'s `"contextmenu"` handler: resolves the native event's
     * DOM target to a Lexical node, classifies it (and the current
     * selection) for the menu, and shows the resulting context menu at the
     * click point. Read-only — a right-click never mutates the document's
     * selection; classification reports what a collapsed caret's format
     * toggles/Cut/Copy *would* operate on without performing that expansion
     * (see {@link $classifyContextMenuTarget}), so a menu action that needs
     * the wider selection (a format toggle, Cut, or Copy) performs it itself,
     * right before doing its own work. No-op when the target is not a DOM
     * node, or when it does not resolve to a mounted Lexical node.
     *
     * @param event - The native `contextmenu` event forwarded by the surface.
     */
    private handleWysiwygContextMenu(event: MouseEvent): void {
        if (!isDOMNode(event.target)) {
            return;
        }

        const domTarget = event.target;
        const editor = this.ensureEditor();
        let context: ContextMenuTarget | null = null;

        editor.read(() => {
            const node = $getNearestNodeFromDOMNode(domTarget);

            if (node === null) {
                return;
            }

            context = $classifyContextMenuTarget(node);
        });

        if (context === null) {
            return;
        }

        this._contextMenu.show(event.clientX, event.clientY, this.buildContextMenuItems(context));
    }

    /**
     * The context menu's Paste handler: pastes at the live selection. Shows a
     * toast when the clipboard read is unavailable — `paste()` itself stays
     * silent, so a consumer wiring their own Paste button can show their own
     * message.
     */
    private async pasteAtContextMenuSelection(): Promise<void> {
        if (!await this.paste()) {
            Notification.show(CLIPBOARD_READ_DENIED_MESSAGE, "warning", CLIPBOARD_HINT_DURATION_MS);
        }
    }

    /**
     * Prompts for a line of text via a `Dialog`: a bare `TextField` pre-filled
     * with `defaultValue`, Cancel/Confirm buttons — this codebase's
     * established text-input-prompt pattern, since `Dialog` has no dedicated
     * prompt method. The field receives initial focus as the first focusable
     * element in the dialog's content region, and Enter confirms because
     * Confirm is marked `primary`.
     *
     * @param title - The dialog's title-bar text.
     * @param defaultValue - The field's initial text.
     * @param placeholder - The field's placeholder text.
     * @returns The trimmed text the user confirmed, or `null` on Cancel/close,
     *   or an empty/whitespace-only confirmation.
     */
    private async promptForText(title: string, defaultValue: string, placeholder: string): Promise<string | null> {
        const field = new TextField({ text: defaultValue, placeholder });

        const result = await Dialog.show({
            title,
            contentComponent: field,
            buttons: [DialogButtons.Cancel, { ...DialogButtons.Confirm, primary: true }],
        });

        if (result !== "confirm") {
            return null;
        }

        const value = field.getValue().trim();

        return value === "" ? null : value;
    }

    /**
     * Prompts for a URL — see {@link MarkdownEditor.promptForText}.
     *
     * @param title - The dialog's title-bar text.
     * @param defaultUrl - The field's initial text — `""` for Insert, the
     *   link's current URL for Edit.
     * @returns The trimmed URL the user confirmed, or `null` on Cancel/close, or
     *   an empty/whitespace-only confirmation.
     */
    private async promptForLinkUrl(title: string, defaultUrl: string): Promise<string | null> {
        return this.promptForText(title, defaultUrl, "https://example.com");
    }

    /**
     * The context menu's Insert link / Edit link handler: prompts for a URL
     * (see {@link MarkdownEditor.promptForLinkUrl}), then applies it via
     * `toggleLink`. No-op when the user cancels, submits an empty URL, or
     * resubmits `defaultUrl` unchanged (a real no-op for Edit; for Insert,
     * `defaultUrl` is always `""`, which `promptForLinkUrl` never returns, so
     * this check is a no-op there).
     *
     * @param title - Forwarded to {@link MarkdownEditor.promptForLinkUrl}.
     * @param defaultUrl - Forwarded to {@link MarkdownEditor.promptForLinkUrl}.
     */
    private async promptAndApplyLink(title: string, defaultUrl: string): Promise<void> {
        const url = await this.promptForLinkUrl(title, defaultUrl);

        if (url !== null && url !== defaultUrl) {
            this.toggleLink(url);
        }
    }

    /**
     * The context menu's Column width… handler: prompts for a pixel width
     * (see {@link MarkdownEditor.promptForText}), then applies it via
     * {@link setTableColumnWidth}. No-op when the user cancels, submits
     * empty text, or submits a value that isn't a positive integer.
     */
    private async promptAndSetColumnWidth(): Promise<void> {
        const value = await this.promptForText("Column width", "", "e.g. 240");

        if (value === null) {
            return;
        }

        const width = Number(value);

        if (Number.isInteger(width) && width > 0) {
            this.setTableColumnWidth(width);
        }
    }

    /**
     * The context menu's Image… handler: prompts for a source URL (see
     * {@link MarkdownEditor.promptForText}), then inserts it via
     * {@link insertImage}. No-op when the user cancels or submits empty text.
     */
    private async promptAndInsertImage(): Promise<void> {
        const src = await this.promptForText("Insert image", "", "https://example.com/image.png");

        if (src !== null) {
            this.insertImage(src);
        }
    }

    /**
     * Dispatches a classified right-click context to the item list for its kind.
     *
     * @param context - The classified {@link ContextMenuTarget}.
     * @returns The `MenuItemConfig` array for {@link Menu.show}.
     */
    private buildContextMenuItems(context: ContextMenuTarget): MenuItemConfig[] {
        switch (context.kind) {
            case "table-cell": return this.buildTableCellContextMenuItems(context);
            case "empty-line": return this.buildEmptyLineContextMenuItems(context);
            case "text":       return this.buildTextContextMenuItems(context);
        }
    }

    /**
     * Builds the five inline-format toggle items shared by the text and
     * table-cell context menus: real {@link CheckboxMenuRow} rows, so the
     * check renders as an actual checkbox rather than a text checkmark and
     * activating one leaves the menu open (matching the `MenuBar` demo's
     * "Options" menu, e.g. its `Auto-Save` row) — letting several formats be
     * toggled in one right-click.
     *
     * @param format - The current selection's inline-format state.
     * @returns The five `MenuItemConfig` entries: Bold, Italic, Underline, Strikethrough, Code.
     */
    private buildFormatToggleItems(
        format: { bold: boolean; italic: boolean; strikethrough: boolean; code: boolean; underline: boolean },
    ): MenuItemConfig[] {
        const toggleRow = (text: string, checked: boolean, toggle: () => void): MenuItemConfig => ({
            row: () => {
                const row = new CheckboxMenuRow({ text, checked });

                row.on("action", toggle);

                return row;
            },
        });

        return [
            toggleRow("Bold", format.bold, () => this.toggleBold()),
            toggleRow("Italic", format.italic, () => this.toggleItalic()),
            toggleRow("Underline", format.underline, () => this.toggleUnderline()),
            toggleRow("Strikethrough", format.strikethrough, () => this.toggleStrikethrough()),
            toggleRow("Code", format.code, () => this.toggleInlineCode()),
        ];
    }

    /**
     * Builds the "Text style" submenu shared by the text and table-cell
     * context menus: three sub-submenus (Colour, Font, Size), each a fixed
     * preset list plus a "Default" item that clears the override by calling
     * the setter with `null`.
     *
     * @returns The `MenuItemConfig` for the "Text style" submenu.
     */
    private buildTextStyleMenuItem(): MenuItemConfig {
        const presetItem = (text: string, action: () => void): MenuItemConfig => ({ text, action });

        return {
            text: "Text style",
            submenu: {
                label: "Text style",
                items: [
                    {
                        text: "Colour",
                        submenu: {
                            label: "Colour",
                            items: [
                                presetItem("Red", () => this.setTextColor("#cc0000")),
                                presetItem("Green", () => this.setTextColor("#008000")),
                                presetItem("Blue", () => this.setTextColor("#2563eb")),
                                presetItem("Default", () => this.setTextColor(null)),
                            ],
                        },
                    },
                    {
                        text: "Font",
                        submenu: {
                            label: "Font",
                            items: [
                                presetItem("Serif", () => this.setFontFamily("Georgia, serif")),
                                presetItem("Monospace", () => this.setFontFamily("monospace")),
                                presetItem("Default", () => this.setFontFamily(null)),
                            ],
                        },
                    },
                    {
                        text: "Size",
                        submenu: {
                            label: "Size",
                            items: [
                                presetItem("Small", () => this.setFontSize("0.8em")),
                                presetItem("Large", () => this.setFontSize("1.2em")),
                                presetItem("Default", () => this.setFontSize(null)),
                            ],
                        },
                    },
                ],
            },
        };
    }

    /**
     * Builds the "Columns" submenu shared by the text and empty-line context
     * menus: fixed 2/3/4-column presets plus a "None" item that clears the
     * column region entirely, each applying {@link setColumnCount}.
     *
     * @returns The `MenuItemConfig` for the "Columns" submenu.
     */
    private buildColumnsMenuItem(): MenuItemConfig {
        return {
            text:    "Columns",
            submenu: {
                label: "Columns",
                items: [
                    { text: "2 columns", action: () => this.setColumnCount(2) },
                    { text: "3 columns", action: () => this.setColumnCount(3) },
                    { text: "4 columns", action: () => this.setColumnCount(4) },
                    { text: "None", action: () => this.setColumnCount(null) },
                ],
            },
        };
    }

    /**
     * Builds the three clipboard items shared by all three context menus: Cut
     * and Copy dim unless invoking them would have text to act on — the real
     * current selection, or (collapsed) what {@link $selectEnclosingWordIfCollapsed}
     * would expand into, which `cut()`/`copy()` themselves perform when
     * invoked, so the enabled state always matches what activating the item
     * actually does. Paste is always enabled and acts on the live selection.
     */
    private clipboardMenuItems(hasSelectedText: boolean): MenuItemConfig[] {
        return buildClipboardMenuItems({
            hasSelectedText,
            cut:   () => this.cut(),
            copy:  () => this.copy(),
            paste: () => void this.pasteAtContextMenuSelection(),
        });
    }

    /**
     * Builds the link item(s) shared by the text and table-cell context menus:
     * "Insert link…" when the click is not inside a link (dimmed unless there
     * is a selection or expandable word to wrap), or "Edit link…" plus "Remove
     * link" when it is. The two states are mutually exclusive, so exactly one
     * of these shapes is ever shown — never a permanently-disabled item.
     *
     * @param context - Carries `linkUrl` (`undefined`/`null` outside a link, the
     *   URL inside one) and `hasSelectedText`.
     * @returns One or two `MenuItemConfig` entries.
     */
    private buildLinkMenuItems(context: { linkUrl?: string | null; hasSelectedText: boolean }): MenuItemConfig[] {
        const linkUrl = context.linkUrl ?? null;

        if (linkUrl === null) {
            return [{
                text: "Insert link…", enabled: context.hasSelectedText,
                action: () => void this.promptAndApplyLink("Insert link", ""),
            }];
        }

        return [
            { text: "Edit link…", action: () => void this.promptAndApplyLink("Edit link", linkUrl) },
            { text: "Remove link", action: () => this.removeLink() },
        ];
    }

    /**
     * Builds the format menu shown over a word, a range selection, or an
     * ordinary (non-empty) block: the shared inline-format toggles, a
     * block-style submenu (paragraph, headings, a blockquote, or a fenced
     * code block), and a clear-formatting action.
     *
     * @param context - The `"text"` classification, carrying the current
     *   selection's inline-format state.
     * @returns The `MenuItemConfig` array for {@link Menu.show}.
     */
    private buildTextContextMenuItems(context: ContextMenuTarget & { kind: "text" }): MenuItemConfig[] {
        const items: MenuItemConfig[] = [
            ...this.clipboardMenuItems(context.hasSelectedText),
            { separator: true },
            ...this.buildFormatToggleItems(context),
            { separator: true },
            ...this.buildLinkMenuItems(context),
            { separator: true },
            {
                text:    "Block style",
                submenu: {
                    label: "Block style",
                    items: [
                        { text: "Paragraph", action: () => this.setBlockType("paragraph") },
                        { separator: true },
                        ...this.buildHeadingMenuItems(),
                        { separator: true },
                        { text: "Quote", action: () => this.setBlockType("quote") },
                        { text: "Code block", action: () => this.setBlockType("code") },
                    ],
                },
            },
            { separator: true },
            this.buildTextStyleMenuItem(),
            {
                text:    "Alignment",
                submenu: {
                    label: "Alignment",
                    items: [
                        { text: "Left", action: () => this.setBlockAlignment("left") },
                        { text: "Center", action: () => this.setBlockAlignment("center") },
                        { text: "Right", action: () => this.setBlockAlignment("right") },
                        { text: "Justify", action: () => this.setBlockAlignment("justify") },
                        { text: "Default", action: () => this.setBlockAlignment(null) },
                    ],
                },
            },
            this.buildColumnsMenuItem(),
            { separator: true },
            { text: "Clear formatting", action: () => this.clearFormatting() },
        ];

        if (context.hasEnclosingBlock) {
            items.push(
                { separator: true },
                { text: "Insert line before block", action: () => this.insertParagraphBeforeBlock() },
                { text: "Insert line after block", action: () => this.insertParagraphAfterBlock() },
            );
        }

        return items;
    }

    /**
     * Builds the insert menu shown over an empty line (outside any table): a
     * Heading submenu, an Insert submenu (block conversions plus new-object
     * insertion), and the Columns submenu. Omits a "Paragraph" item — the
     * classification already guarantees the caret sits in an empty paragraph,
     * so converting it to a paragraph is a guaranteed no-op.
     *
     * @param context - The `"empty-line"` classification, carrying whether
     *   the current selection has text (a drag-selection ending on an empty
     *   line, which still classifies as `"empty-line"`).
     * @returns The `MenuItemConfig` array for {@link Menu.show}.
     */
    private buildEmptyLineContextMenuItems(context: ContextMenuTarget & { kind: "empty-line" }): MenuItemConfig[] {
        return [
            ...this.clipboardMenuItems(context.hasSelectedText),
            { separator: true },
            { text: "Heading", submenu: { label: "Heading", items: this.buildHeadingMenuItems() } },
            {
                text:    "Insert",
                submenu: {
                    label: "Insert",
                    items: [
                        { text: "Quote", action: () => this.setBlockType("quote") },
                        { text: "Code block", action: () => this.setBlockType("code") },
                        { text: "Bulleted list", action: () => this.toggleUnorderedList() },
                        { text: "Numbered list", action: () => this.toggleOrderedList() },
                        { separator: true },
                        { text: "Table", action: () => this.insertTable(2, 3) },
                        { text: "Image…", action: () => void this.promptAndInsertImage() },
                    ],
                },
            },
            this.buildColumnsMenuItem(),
        ];
    }

    /**
     * Builds the menu shown over a table cell (populated or empty): the same
     * shared inline-format toggles and Clear formatting as the text context
     * menu — a cell holds inline text too, just never a heading or quote in
     * this dialect, so no Block style submenu — then a Table submenu holding
     * every table-structure action.
     *
     * @param context - The `"table-cell"` classification, carrying the
     *   current selection's inline-format state.
     * @returns The `MenuItemConfig` array for {@link Menu.show}.
     */
    private buildTableCellContextMenuItems(context: ContextMenuTarget & { kind: "table-cell" }): MenuItemConfig[] {
        const items: MenuItemConfig[] = [
            ...this.clipboardMenuItems(context.hasSelectedText),
            { separator: true },
            ...this.buildFormatToggleItems(context),
            { separator: true },
            ...this.buildLinkMenuItems(context),
            { separator: true },
            this.buildTextStyleMenuItem(),
            { separator: true },
            { text: "Clear formatting", action: () => this.clearFormatting() },
            { separator: true },
            this.buildTableMenuItem(context.columnAlignment ?? "none"),
        ];

        if (context.hasEnclosingBlock) {
            items.push(
                { separator: true },
                { text: "Insert line before block", action: () => this.insertParagraphBeforeBlock() },
                { text: "Insert line after block", action: () => this.insertParagraphAfterBlock() },
            );
        }

        return items;
    }

    /**
     * Builds the six heading-level items shared by the text-context block-style
     * submenu and the empty-line insert menu's own Heading submenu.
     *
     * @returns The six `MenuItemConfig` entries, `h1` through `h6`.
     */
    private buildHeadingMenuItems(): MenuItemConfig[] {
        return ([1, 2, 3, 4, 5, 6] as const).map((level) => ({
            text:   `Heading ${level}`,
            action: () => this.setBlockType(`h${level}` as MarkdownBlockType),
        }));
    }

    /**
     * Builds the four mutually-exclusive alignment items of the table-cell menu's
     * "Align column" submenu. Exactly one carries `checked: true`.
     *
     * @param current - The clicked column's current alignment.
     * @returns The four `MenuItemConfig` entries: Left, Center, Right, None.
     */
    private buildColumnAlignmentItems(current: MarkdownTableAlignment): MenuItemConfig[] {
        return ([
            ["Left", "left"], ["Center", "center"], ["Right", "right"], ["None", "none"],
        ] as const).map(([text, alignment]) => ({
            text,
            checked: current === alignment,
            action:  () => { this.setTableColumnAlignment(alignment); },
        }));
    }

    /**
     * Builds the "Table" submenu shown in the table-cell context menu: an
     * Insert submenu (the four directional row/column inserts), a Delete
     * submenu (row, column, or the whole table), Merge cells, Unmerge cell,
     * Column width…, and the Align column submenu — every table-structure
     * action gathered under one entry, at the same nesting depth "Text style"
     * already uses for its Colour/Font/Size sub-submenus.
     *
     * @param columnAlignment - The clicked column's current alignment, forwarded to {@link buildColumnAlignmentItems}.
     * @returns The `MenuItemConfig` for the "Table" submenu.
     */
    private buildTableMenuItem(columnAlignment: MarkdownTableAlignment): MenuItemConfig {
        return {
            text:    "Table",
            submenu: {
                label: "Table",
                items: [
                    {
                        text:    "Insert",
                        submenu: {
                            label: "Insert",
                            items: [
                                { text: "Row above", action: () => this.insertTableRow(false) },
                                { text: "Row below", action: () => this.insertTableRow(true) },
                                { text: "Column left", action: () => this.insertTableColumn(false) },
                                { text: "Column right", action: () => this.insertTableColumn(true) },
                            ],
                        },
                    },
                    {
                        text:    "Delete",
                        submenu: {
                            label: "Delete",
                            items: [
                                { text: "Row", action: () => this.deleteTableRow() },
                                { text: "Column", action: () => this.deleteTableColumn() },
                                { text: "Table", action: () => this.deleteTable() },
                            ],
                        },
                    },
                    { separator: true },
                    { text: "Merge cells", action: () => this.mergeTableCells() },
                    { text: "Unmerge cell", action: () => this.unmergeTableCell() },
                    { text: "Column width…", action: () => void this.promptAndSetColumnWidth() },
                    {
                        text:    "Align column",
                        submenu: {
                            label: "Align column",
                            items: this.buildColumnAlignmentItems(columnAlignment),
                        },
                    },
                ],
            },
        };
    }

    /**
     * The single document-change seam for both editing surfaces: caches the new
     * Markdown, sets the dirty flag from a comparison against the clean Markdown,
     * then emits `"change"`. No-op when the value is unchanged, which is what
     * keeps the programmatic `setValue` on a mode switch from double-emitting (it
     * loads the value already equal to `_options.value`).
     *
     * @param value - The new Markdown value.
     */
    private onDocChange(value: string): void {
        if (value === this._options.value) {
            return;
        }

        this._options.value = value;
        // Dirty before the emit, so a `"change"` listener that queries isDirty()
        // sees the settled value. `setDirty` is idempotent, so calling it on
        // every change costs nothing when nothing flipped.
        this.setDirty(value !== this._cleanValue);
        this.emit("change", { value });
    }

    /**
     * Adds an import's loaded blocks to the source map, keeping every earlier
     * import's. A `setValue` or a switch back from source mode is one undoable
     * update, so undo can bring an earlier import's nodes back, and a save
     * writes them as their source only while their entries remain. Node keys
     * never repeat within one Lexical editor, so no entry is overwritten.
     *
     * The map grows by one small entry per top-level block per import (its
     * source is a slice of the imported text) and is never pruned: Lexical's
     * undo history, which this editor keeps unbounded, already holds every
     * import's nodes, so the map grows no faster than the history does.
     *
     * @param imported - The source map the import returned.
     */
    private adoptSourceMap(imported: MarkdownSourceMap): void {
        for (const [key, block] of imported.blocks) {
            this._sourceBlocks.set(key, block);
        }

        this._sourceMap = { latest: imported.latest, blocks: this._sourceBlocks };
    }

    /**
     * Recomputes the Markdown value from the committed editor state after a
     * Lexical update and hands it to the shared change seam.
     */
    private handleChange(): void {
        const editor = this._editor;

        if (!editor) {
            return;
        }

        this.onDocChange(editor.read(() => $serializeMarkdown(this._sourceMap)));
    }

    /**
     * Recomputes the active surface's tracked selection state and emits
     * `"selectionstate"` when it differs from the last one reported. Driven
     * from several call sites so every commit that would change the
     * toolbar's live state is observed: the Lexical `registerUpdateListener`
     * callback (typing, a caret move, undo/redo, or a same-position format
     * toggle), the source `CodeEditor`'s own `"selectionchange"`,
     * `handleCodeChange`, and `setMode`. No-op before either surface has
     * anything to report (source mode always does; WYSIWYG needs the Lexical
     * editor built).
     */
    private updateSelectionState(): void {
        if (!this.isSourceMode() && !this._editor) {
            return;
        }

        const state = this.readActiveSelectionState();

        if (selectionStatesEqual(state, this._lastSelectionState)) {
            return;
        }

        this._lastSelectionState = state;
        this.emit("selectionstate", state);
    }

    /**
     * Routes a source-surface (`CodeEditor`) edit into the shared change seam,
     * then re-baselines the source editor and refreshes the tracked selection
     * state. The source `CodeEditor` is a surface, not a second owner of this
     * document's dirty state: re-baselining it on every change keeps its own
     * flag clear, so `isDirty()` is decided by this component's comparison
     * alone. Outside `onDocChange` so it also runs on a mode-switch load, which
     * that method's unchanged-value guard returns early from — an edit changes
     * what the format flags around the caret would report even when the
     * document's own dirty comparison sees no change.
     *
     * @param payload - The `CodeEditor` change payload (the new source text).
     */
    private handleCodeChange(payload: CodeEditorChange): void {
        this.onDocChange(payload.value);
        this._codeEditor.markClean();
        this.updateSelectionState();
    }
}

const MarkdownEditorCallable = callable(MarkdownEditor);
type MarkdownEditorCallable = MarkdownEditor;
export {
    MarkdownEditor         as _MarkdownEditor,
    MarkdownEditorCallable as MarkdownEditor,
};
