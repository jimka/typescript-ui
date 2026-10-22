// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { TimerId } from "~/core/DOM.js";
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
    $createParagraphNode, $isDecoratorNode, KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH, SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
    PASTE_COMMAND, PASTE_TAG, DELETE_CHARACTER_COMMAND, $createTextNode, $copyNode, $isLineBreakNode, $getState,
    IS_ALL_FORMATTING, $isTextNode, TEXT_TYPE_TO_FORMAT, $hasUpdateTag, HISTORY_PUSH_TAG,
    $getNearestNodeFromDOMNode, isDOMNode, $findMatchingParent, $isElementNode, $isParagraphNode, $isRootNode,
    DELETE_WORD_COMMAND, DELETE_LINE_COMMAND, REMOVE_TEXT_COMMAND, CONTROLLED_TEXT_INSERTION_COMMAND,
    INSERT_PARAGRAPH_COMMAND, INSERT_LINE_BREAK_COMMAND, INSERT_TAB_COMMAND, COPY_COMMAND, CUT_COMMAND, CUT_TAG,
    COMMAND_PRIORITY_CRITICAL,
    $caretFromPoint, $normalizeCaret, $setPointFromCaret, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, $isRootOrShadowRoot,
    $getChildCaret, $isSiblingCaret, INTERNAL_$isBlock, $createRangeSelectionFromDom, $setSelection, COMMAND_PRIORITY_LOW,
    INDENT_CONTENT_COMMAND, OUTDENT_CONTENT_COMMAND, $getNodeByKey, $addUpdateTag, $setState,
    HISTORY_MERGE_TAG, SKIP_SCROLL_INTO_VIEW_TAG, BEFORE_INPUT_COMMAND, INPUT_COMMAND, COMMAND_PRIORITY_EDITOR, COMPOSITION_END_TAG,
    COMPOSITION_START_COMMAND, $getEditor, $insertNodeToNearestRootAtCaret, SKIP_DOM_SELECTION_TAG, COLLABORATION_TAG, HISTORIC_TAG,
    $splitAtPointCaretNext, $getCaretInDirection, $isTextPointCaret, $getSiblingCaret, $isChildCaret,
} from "lexical";
import type {
    LexicalEditor, ElementNode, ElementFormatType, LexicalNode, TextFormatType, TextNode, BaseSelection,
    CommandListener, LexicalCommand, CommandListenerPriority, UpdateListener, ParagraphNode, RangeSelection, EditorUpdateOptions,
    NodeKey, PointType, CommandPayloadType, PointCaret, CaretDirection,
} from "lexical";
import { registerMarkdownShortcuts } from "@lexical/markdown";
import type { ElementTransformer, MultilineElementTransformer } from "@lexical/markdown";
import { registerRichText, $createHeadingNode, QuoteNode, $isQuoteNode, $isHeadingNode } from "@lexical/rich-text";
import type { HeadingTagType } from "@lexical/rich-text";
import {
    registerList, ListNode, $isListNode, $isListItemNode,
    $createListItemNode, $createListNode,
} from "@lexical/list";
import type { ListType } from "@lexical/list";
import { $toggleLink, $isLinkNode } from "@lexical/link";
import type { LinkNode } from "@lexical/link";
import { $insertGeneratedNodes, copyToClipboard, $getClipboardDataFromSelection } from "@lexical/clipboard";
import { CodeNode, $createCodeNode, $isCodeNode } from "@lexical/code";
import {
    TableNode, TableCellNode, registerTablePlugin, registerTableSelectionObserver,
    $getTableCellNodeFromLexicalNode, $getTableNodeFromLexicalNodeOrThrow, $computeTableMap,
    $insertTableRowAtSelection, $deleteTableRowAtSelection,
    $insertTableColumnAtSelection, $deleteTableColumnAtSelection,
    $getTableColumnIndexFromTableCellNode, $isTableCellNode, $isTableRowNode,
    $isTableSelection, $mergeCells, $unmergeCell, $isTableNode,
    $createTableNodeWithDimensions, $computeTableMapSkipCellCheck, $createTableCellNode, $createTableNode, $createTableRowNode,
} from "@lexical/table";
import type { TableRowNode, TableSelection } from "@lexical/table";
import { mergeRegister, $getNearestNodeOfType, $handleIndentAndOutdent } from "@lexical/utils";
import { $setBlocksType, $patchStyleText, $copyBlockFormatIndent } from "@lexical/selection";
import { SHORTCUT_TRANSFORMERS } from "~/component/editor/markdownTransformers.js";
import { $importMarkdown } from "~/component/editor/markdownImporter.js";
import {
    $serializeBlockContent, $serializeInlineNodes, $serializeMarkdown, $serializeMarkdownWithPlaces, $serializeRestOfBlock, $writtenListMarker,
} from "~/component/editor/markdownSerializer.js";
import {
    $breakRuleContainerOf, $contentFollows, $editWritably, $findEnclosingBlock, $formatWritably, $isBlock, $keepRowsOfCells, $lineBreakUnwritableAt,
    $moveBlocksOutAfter, $orderedPoints, $selectedSlices, $selectionHasFormat, $showRawBlockAsSaved, $takeBlocksOutOf, RUN_EDGE_TAG,
    registerWritableStateRules,
} from "~/component/editor/markdownWritable.js";
import { registerMarkdownHistory } from "~/component/editor/markdownHistory.js";
import {
    $selectionMark, $takeLinkClick, addressToFollow, isUndoOrRedoKey, registerReadOnlyGuard,
} from "~/component/editor/markdownReadOnly.js";
import { ReadOnlyFlash } from "~/component/editor/ReadOnlyFlash.js";
import { EMPTY_SOURCE_MAP } from "~/component/editor/markdownSourceMap.js";
import type { MarkdownSourceBlock, MarkdownSourceMap, MarkdownSourcePart } from "~/component/editor/markdownSourceMap.js";
import {
    $createMarkdownRawBlockNode, $isMarkdownRawBlockNode, $isMarkdownSourceTextNode, MarkdownRawBlockNode,
} from "~/component/editor/markdownSourceNodes.js";
import { keptSourceState, listLooseState, nestedLinkState } from "~/component/editor/markdownNodeState.js";
import { EDITOR_NODES } from "~/component/editor/editorNodes.js";
import {
    $createMarkdownListItemTextNode, $isMarkdownListItemNode, $isMarkdownListItemTextNode, $liftItemOut, $movePointsBetween, $outdentItem,
    $removeUnwalked, $splitItemAfterText, $splitItemBefore,
} from "~/component/editor/markdownListItemNode.js";
import type { MarkdownListItemTextNode } from "~/component/editor/markdownListItemNode.js";
import { $createMarkdownQuoteNode, $isMarkdownQuoteNode, $liftOutOfQuote, $nearestQuoteOf } from "~/component/editor/markdownQuoteNode.js";
import { EDITOR_THEME, ensureMarkdownEditorClassRules } from "~/component/editor/editorTheme.js";
import {
    MarkdownBlockNode, $createMarkdownBlockNode, $isMarkdownBlockNode, $createMarkdownColumnNode, $isMarkdownColumnNode,
} from "~/component/editor/markdownBlockNode.js";
import { $createMarkdownImageNode, $isMarkdownImageNode } from "~/component/editor/markdownImageNode.js";
import { cssTextToAttributes, resolveImageSpec } from "~/component/display/markdownAttributes.js";
import { readSourceSelectionState } from "~/component/editor/markdownSourceEdits.js";
import type { MarkdownSourceEdit, MarkdownSourceTransform } from "~/component/editor/markdownSourceEdits.js";
import { paragraphAroundBlockSource, tableSource } from "~/component/editor/markdownSourceLines.js";
import {
    $selectSourceRange, $sourceRangeOfSelection, smallestEdit, sourceWindow, wholeDocumentWindow,
} from "~/component/editor/markdownSourceModel.js";
import type { SourceWindow } from "~/component/editor/markdownSourceModel.js";

/**
 * The clipboard type Lexical writes its own copied nodes under (the
 * `@lexical/clipboard` copy format); a paste carrying it inserts those nodes.
 */
const LEXICAL_CLIPBOARD_TYPE = "application/x-lexical-editor";

/** The model editor a source-mode command runs on, with the source map of its import. */
interface ModelEditor {
    /** The headless editor holding the imported window. */
    readonly editor:    LexicalEditor;
    /** The source map of the import, which the save takes to write unedited blocks as loaded. */
    readonly sourceMap: MarkdownSourceMap;
    /** Removes the editor's registrations. */
    readonly release:   () => void;
}

/** Returned when the definition blocks a window carried are not written back unchanged: the run is repeated on the whole document. */
const WINDOW_LOST: unique symbol = Symbol("window lost");

/** What one run on the model gives: an edit of the document, nothing to do, or a window whose carried parts did not come back. */
type ModelResult = MarkdownSourceEdit | null | typeof WINDOW_LOST;

/** Shown when a context-menu Paste finds the clipboard read unavailable. */
const CLIPBOARD_READ_DENIED_MESSAGE = "Clipboard read blocked by the browser — press Ctrl/Cmd+V to paste.";

/**
 * What Lexical's text of a list puts between two of its items, which the
 * text pasted into a raw block or code block also puts between an item's
 * text and each block the item holds.
 */
const LIST_TEXT_SEPARATOR = "\n\n";

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
 * any), which of the format, style, link, block, insert and table commands
 * would apply, table/column-alignment context, and block alignment/column
 * count at the current selection. Every `can…` field is `false` while the
 * editor is read-only, on either surface: each editing command is then
 * refused.
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
    /**
     * Whether the inline-format toggles would apply at the selection. `false`
     * where they decline: with no selection, when the selection touches a
     * raw Markdown block or a code block, when it holds (or a collapsed
     * caret would expand into) a run kept as Markdown source, and for a
     * selection that is not collapsed and holds no text — from the end of
     * one block to the start of the next, or over an image alone. A caret
     * takes the format as pending. While table cells are selected, the
     * cells take the format one by one, so it is `true` when at least one
     * of them holds text and no such run. Always `true` in `"source"` mode.
     */
    canFormat: boolean;
    /**
     * Whether text colour, font and size would apply at the selection.
     * `false` where {@link canFormat} is, and also inside a link and while
     * table cells are selected. Always `true` in `"source"` mode.
     */
    canStyle: boolean;
    /**
     * Whether `toggleLink` with a URL would apply at the selection: link
     * its text or its image, or re-point the link it is in. A caret links the
     * word or formatted run it would expand to, as the format toggles format
     * it, and inside a link re-points that link. `false` with no selection,
     * while table cells are selected, when the selection touches a raw
     * Markdown block or a code block or holds (or a collapsed caret would
     * expand into) a run kept as Markdown source, when either end is in a
     * link nested in another link, and when there is nothing to link: a
     * caret with no word under it and outside a link, or a selection holding
     * neither text nor an image. A toolbar's Link control is enabled on this
     * field, or on {@link canRemoveLink} for its Remove action. Always
     * `true` in `"source"` mode.
     */
    canLink: boolean;
    /**
     * Whether `removeLink` would apply at the selection: `true` only inside
     * a link, and `false` there when the link is nested in another link.
     * `false` with no selection and while table cells are selected. In
     * `"source"` mode, `true` whenever the selection is inside a link.
     */
    canRemoveLink: boolean;
    /**
     * Whether the block conversions (`setBlockType` and the two list
     * toggles) would apply at the selection. `false` with no selection,
     * while table cells are selected, when the selection reaches into a
     * table cell, which holds text only, and when it stands on a table
     * between two rows or two cells and holds no block of text, where only
     * code can put it. Always `true` in `"source"` mode.
     */
    canSetBlockType: boolean;
    /**
     * Whether `setBlockAlignment` and `setColumnCount` would apply at the
     * selection. `false` with no selection and while table cells are
     * selected. Always `false` in `"source"` mode, where both are no-ops.
     */
    canSetBlockLayout: boolean;
    /**
     * Whether `insertTable` would insert. `false` when the selection touches
     * a raw Markdown block or a code block, and when it lies inside one
     * table, whose cells hold no table. A selection that runs from outside a
     * table into one of its cells is removed first, that table included, so
     * it is `true` for one, whichever way the selection was made. Without a
     * text selection — none at all, or table cells selected — the table
     * goes in at the document's end, so it is `false` when the document
     * ends in a raw Markdown block, a code block or a table. Always `true`
     * in `"source"` mode, and before the editor is built.
     */
    canInsertTable: boolean;
    /**
     * Whether `insertImage` would insert. `false` when the selection touches
     * a raw Markdown block or a code block. Without a text selection — none
     * at all, or table cells selected — the image goes in at the document's
     * end, so it is `false` when the document ends in one of those two.
     * Always `true` in `"source"` mode, and before the editor is built.
     */
    canInsertImage: boolean;
    /**
     * Whether the commands acting on the table the caret is in would apply:
     * the row and column inserts and deletes, `deleteTable`,
     * `setTableColumnAlignment` and `setTableColumnWidth`. `true` for a
     * caret or a text selection inside one table; `false` while table cells
     * are selected, and for a selection that runs out of the table it starts
     * in. Always `false` in `"source"` mode, where they are no-ops.
     */
    canEditTable: boolean;
    /**
     * Whether `mergeTableCells` would apply: `true` only while more than one
     * table cell is selected. Always `false` in `"source"` mode.
     */
    canMergeCells: boolean;
    /**
     * Whether `unmergeTableCell` would apply: `true` only where
     * {@link canEditTable} is and the caret's cell spans more than one row
     * or column. Always `false` in `"source"` mode.
     */
    canUnmergeCell: boolean;
    /**
     * Whether a caret or a text selection is anchored inside a table cell
     * and lies within that cell's table: `false` while whole table cells are
     * selected, and for a selection that runs out of its table. It says
     * where a caret or a text selection is, not what applies there: a
     * control that runs a table command reads {@link canEditTable},
     * {@link canMergeCells} or {@link canUnmergeCell}.
     */
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
 * - `"readonlyedit"` — an edit was refused because the editor is read-only,
 *   on either surface (no payload).
 */
type MarkdownEditorEvent = "change" | "selectionstate" | "readonlyedit";

/**
 * The editing surface a {@link MarkdownEditor} currently shows: the WYSIWYG
 * rich-text surface, or the raw-Markdown source [`CodeEditor`](/api/component/editor/classes/CodeEditor).
 *
 * @category Components
 */
export type MarkdownEditorMode = "wysiwyg" | "source";

/**
 * A block type accepted by {@link MarkdownEditor.setBlockType}: a paragraph, one
 * of the six heading levels, a blockquote (which the command toggles), or a
 * fenced code block.
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
    /** Construction-time listener bag; the events are `"change"`, `"selectionstate"` and `"readonlyedit"`. */
    listeners?: {
        change?:         (payload: MarkdownEditorChange) => void;
        selectionstate?: (payload: MarkdownEditorSelectionState) => void;
        readonlyedit?:   () => void;
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
function createBlockNode(type: Exclude<MarkdownBlockType, "quote">): ElementNode {
    switch (type) {
        case "code":  return $createCodeNode();
        case "paragraph": return $createParagraphNode();
        default:      return $createHeadingNode(type satisfies HeadingTagType);
    }
}

/**
 * `$setBlocksType`'s after-create hook for a conversion to a code block:
 * copies the block's format and indent, as the default hook does, and
 * replaces its inline content with that content's Markdown as the block's
 * own save writes it, so the code block shows — and saves — the source of
 * the formatting, links and images it cannot hold, and nothing is lost. A
 * heading's text is written as its own line holds it (`### +alpha` gives
 * `+alpha`, with none of the escapes a paragraph's line start needs). A
 * list item's text is written as an item's text is, so a task marker it
 * opens with goes into the code as it was written (`[ ] `). A raw block or
 * a code block already holds only its text and is left as it is.
 *
 * @param block - The block being converted; its children move into `code`.
 * @param code - The new code block.
 */
function $copyBlockAsCodeSource(block: ElementNode, code: ElementNode): void {
    $copyBlockFormatIndent(block, code);

    if ($isTextOnlyBlock(block)) {
        return;
    }

    const markdown = $serializeBlockContent(block);

    block.clear();

    if (markdown !== "") {
        block.append($createTextNode(markdown));
    }
}

/**
 * Builds the `{ width?, height? }` attribute record `insertImage` passes to
 * `resolveImageSpec`, from its own `options` parameter.
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
 * Finds the table cell containing the caret, if any. A selection that runs
 * out of the table it is anchored in ({@link $isTableEdgeRange}) has none:
 * the table commands act on one table, and Lexical's row and column helpers
 * throw when the selection's other end is in no cell.
 *
 * @returns The enclosing {@link TableCellNode}, or `null` when the selection
 *   is not a range selection anchored inside a table cell and lying within
 *   that cell's table.
 */
function $getEnclosingTableCellNode(): TableCellNode | null {
    const selection = $getSelection();
    const anchorNode = $isRangeSelection(selection) ? selection.anchor.getNode() : null;
    const runsOutOfTable = $isTableEdgeRange(selection);

    return anchorNode === null || runsOutOfTable ? null : $getTableCellNodeFromLexicalNode(anchorNode);
}

/**
 * Finds the table containing the current selection, if any.
 *
 * @returns The enclosing {@link TableNode}, or `null` when
 *   {@link $getEnclosingTableCellNode} finds no cell.
 */
function $getEnclosingTableNode(): TableNode | null {
    const cell = $getEnclosingTableCellNode();

    return cell === null ? null : $getTableNodeFromLexicalNodeOrThrow(cell);
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
 * Whether a cell holds one empty paragraph and nothing else, the state of a
 * cell that has no content.
 *
 * @param cell - The cell.
 * @returns `true` for such a cell.
 */
function $holdsOneEmptyParagraph(cell: TableCellNode): boolean {
    const only = cell.getFirstChild();

    return cell.getChildrenSize() === 1 && $isParagraphNode(only) && only.isEmpty();
}

/**
 * Whether a cell is in the table's header row, its first row.
 *
 * @param cell - The cell.
 * @returns `true` for a header cell.
 */
function $isHeaderCell(cell: TableCellNode): boolean {
    const row = cell.getParent();

    return row !== null && row.getPreviousSibling() === null;
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
 * The cells of the column holding the caret, one per row of its table.
 *
 * @returns The column's cells, top to bottom; none when the caret is not
 *   inside a table cell.
 */
function $enclosingColumnCells(): TableCellNode[] {
    const cell = $getEnclosingTableCellNode();

    if (cell === null) {
        return [];
    }

    const table = $getTableNodeFromLexicalNodeOrThrow(cell);
    const [tableMap, cellValue] = $computeTableMap(table, cell, cell);

    return tableMap.flatMap((row) => row[cellValue.startColumn]?.cell ?? []);
}

/**
 * The element format a column alignment is held as on a table cell.
 *
 * @param alignment - The alignment.
 * @returns The cell format; `""` for `"none"`.
 */
function cellFormatOf(alignment: MarkdownTableAlignment): ElementFormatType {
    return alignment === "none" ? "" : alignment;
}

/**
 * Whether every cell of the column holding the caret already has
 * `alignment`, so that setting it would change nothing.
 *
 * @param alignment - The alignment asked for.
 * @returns `true` when no cell of the column would change; `false` when
 *   the caret is in no column.
 */
function $enclosingColumnHasAlignment(alignment: MarkdownTableAlignment): boolean {
    const cells = $enclosingColumnCells();

    return cells.length > 0 && cells.every((cell) => cell.getFormatType() === cellFormatOf(alignment));
}

/**
 * Sets `alignment` on every cell of the column holding the caret — the whole
 * column, because a GFM delimiter row carries one marker per column, not per
 * cell. No-op when the caret is not inside a table cell.
 *
 * @param alignment - The alignment to apply to the column.
 */
function $setEnclosingColumnAlignment(alignment: MarkdownTableAlignment): void {
    for (const cell of $enclosingColumnCells()) {
        cell.setFormat(cellFormatOf(alignment));
    }
}

/**
 * The width set on the column holding the caret.
 *
 * @returns The width in pixels; `0` when the column has none, and when the
 *   caret is not inside a table cell.
 */
function $enclosingColumnWidth(): number {
    const cell = $getEnclosingTableCellNode();

    if (cell === null) {
        return 0;
    }

    const table = $getTableNodeFromLexicalNodeOrThrow(cell);

    return table.getColWidths()?.[$getTableColumnIndexFromTableCellNode(cell)] ?? 0;
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
 * Whether `point` sits at `link`'s start: no text of the link lies before
 * it. Holds for a text point at offset 0 of the link's first descendant, and
 * for an element point at offset 0 on the link itself.
 *
 * @param point - A selection point inside `link`.
 * @param link - The link.
 * @returns Whether the point is at the link's start.
 */
function $isAtLinkStart(point: PointType, link: LinkNode): boolean {
    if (point.type === "element") {
        return point.key === link.getKey() && point.offset === 0;
    }

    return point.key === link.getFirstDescendant()?.getKey() && point.offset === 0;
}

/**
 * Whether `point` sits at `link`'s end: no text of the link lies after it.
 * Holds for a text point at the end of the link's last descendant, and for
 * an element point after the link's last child on the link itself.
 *
 * @param point - A selection point inside `link`.
 * @param link - The link.
 * @returns Whether the point is at the link's end.
 */
function $isAtLinkEnd(point: PointType, link: LinkNode): boolean {
    if (point.type === "element") {
        return point.key === link.getKey() && point.offset === link.getChildrenSize();
    }

    const last = link.getLastDescendant();

    return point.key === last?.getKey() && point.offset === last.getTextContentSize();
}

/**
 * Moves a range selection's start off a link's end, and its end off a
 * link's start, onto the same position just outside that link (an element
 * point on the link's parent). Such an end selects none of the link's text.
 * Does nothing to a collapsed selection.
 *
 * @remarks
 * Works around `@lexical/link`'s `$toggleLink(null)` (0.49.0–0.52.0): on a
 * range whose end only touches a link's edge, `selection.extract()` returns
 * the link but none of its children, and `$splitLinkAtSelection` then calls
 * `insertAfter` on `undefined`. An element point on the link's parent does
 * not trigger it. Remove when the canary in
 * `markdown-editor-command-crashes.test.ts` fails.
 *
 * @param selection - The selection to adjust in place.
 */
function $moveRangeEdgesOutOfLinks(selection: RangeSelection): void {
    if (selection.isCollapsed()) {
        return;
    }

    const [start, end] = $orderedPoints(selection);
    const startLink = $findEnclosingLinkNode(start.getNode());
    const endLink = $findEnclosingLinkNode(end.getNode());

    if (startLink !== null && $isAtLinkEnd(start, startLink)) {
        start.set(startLink.getParentOrThrow().getKey(), startLink.getIndexWithinParent() + 1, "element");
    }

    if (endLink !== null && $isAtLinkStart(end, endLink)) {
        end.set(endLink.getParentOrThrow().getKey(), endLink.getIndexWithinParent(), "element");
    }
}

/**
 * The position just outside a link for a text point that touches the link's
 * edge: an element point on the link's parent, before the link for a point
 * at the link's start, after it for a point at the link's end or at the
 * start of the text that follows the link.
 *
 * @param point - A text point.
 * @returns The parent and the child index of the position, or `null` when the point touches no link's edge.
 */
function $pointOutsideLinkEdge(point: PointType): [parent: ElementNode, index: number] | null {
    const node = point.getNode();
    const link = $findEnclosingLinkNode(node);

    if (link === null) {
        const followsLink = point.offset === 0 && $isLinkNode(node.getPreviousSibling());

        return followsLink ? [node.getParentOrThrow(), node.getIndexWithinParent()] : null;
    }

    const atStart = $isAtLinkStart(point, link);
    const atEnd = $isAtLinkEnd(point, link);
    const index = link.getIndexWithinParent();

    if (atStart) {
        return [link.getParentOrThrow(), index];
    }

    return atEnd ? [link.getParentOrThrow(), index + 1] : null;
}

/**
 * `COMPOSITION_START_COMMAND` guard: moves a collapsed caret that touches a
 * link's edge onto the same position just outside the link, so that the text
 * an input method composes there is plain text outside the link, as a typed
 * character is.
 *
 * @remarks
 * Works around Lexical's composition handling (0.46.0–0.49.0) at the edge
 * of an inline element that refuses text there. Chromium inserts composed
 * text outside an `<a>` at its inner edge, in a text node Lexical did not
 * create; Lexical removes that node, the composition dies without a
 * `compositionend`, and the editor keeps waiting for one. Lexical opens a
 * text node of its own for a composition that starts at an element point,
 * which is where this moves the caret. Remove when the canary in
 * `markdown-editor-command-crashes.test.ts` fails.
 *
 * Does nothing while a composition is already running, as Lexical opens no
 * text node then.
 *
 * @returns Always `false`, so Lexical's own handler still runs.
 */
function $moveCaretOutOfLinkEdge(): boolean {
    // Lexical opens a text node only when no composition is running; match it.
    const isRunning = $getEditor().isComposing();

    if (isRunning) {
        return false;
    }

    const selection = $getSelection();
    const isTextCaret = $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.type === "text";

    if (!isTextCaret) {
        return false;
    }

    const outside = $pointOutsideLinkEdge(selection.anchor);

    if (outside !== null) {
        const [parent, index] = outside;

        selection.anchor.set(parent.getKey(), index, "element");
        selection.focus.set(parent.getKey(), index, "element");
    }

    return false;
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
 * A range with either end in a raw block is removed first
 * ({@link $removeRangeBeforeEnter}), and Enter then does what it does at the
 * caret the removal leaves, whichever way the range was dragged and whichever
 * block its anchor was in: inside a raw block, as above; at a raw block's
 * end, or outside any (the range started in an earlier block, which the raw
 * block's rest joined, or it reached into a table that closed a `:::` column
 * before the block), a new paragraph through `INSERT_PARAGRAPH_COMMAND`,
 * which is what `registerRichText`'s Enter dispatches there. The caret's
 * block is read after the removal, which shows a raw block it makes read as
 * other blocks as those blocks ({@link $removeGuardedRange}).
 *
 * @param event - The native keyboard event, or `null` for a programmatic dispatch.
 * @param editor - The editor the command was dispatched to.
 * @returns Whether Enter at a raw block was handled.
 */
function $handleRawBlockEnter(event: KeyboardEvent | null, editor: LexicalEditor): boolean {
    if (event?.shiftKey || event?.altKey) {
        return false;
    }

    const selection = $getSelection();
    const touchedBlock = $rawBlockAtEitherEnd(selection);

    if (touchedBlock === null || !$isRangeSelection(selection)) {
        return false;
    }

    const isCollapsed = selection.isCollapsed();
    const atEnd = isCollapsed && touchedBlock.isSelectionAtEnd(selection);

    if (atEnd) {
        return false;
    }

    event?.preventDefault();

    // A range is removed first, so Enter acts where its removal leaves the caret.
    if (!isCollapsed) {
        $removeRangeBeforeEnter(selection);
    }

    // Read anew: a raw block the removal makes read as other blocks shows as them by now.
    const caret = $getSelection();
    const isRange = $isRangeSelection(caret);

    if (!isRange) {
        return true;
    }

    const caretBlock = $rawBlockAtAnchor(caret);
    const leftAtEnd = caretBlock !== null && caretBlock.isSelectionAtEnd(caret);

    // Outside a raw block or at one's end, where Enter starts a new paragraph.
    if (caretBlock === null || leftAtEnd) {
        return editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
    }

    const atStart = caretBlock.isSelectionAtStart(caret);

    if (atStart) {
        caretBlock.insertBefore($createParagraphNode());
    } else {
        caret.insertLineBreak();
    }

    return true;
}

/**
 * The raw Markdown block an Enter over `selection` concerns: the one holding
 * its anchor, else — for a range — the one holding its focus.
 *
 * @param selection - The selection.
 * @returns The `MarkdownRawBlockNode`, or `null` when neither end is in one
 *   or the selection is not a range.
 */
function $rawBlockAtEitherEnd(selection: BaseSelection | null): MarkdownRawBlockNode | null {
    if (!$isRangeSelection(selection)) {
        return null;
    }

    return $rawBlockAtAnchor(selection) ?? $findMatchingParent(selection.focus.getNode(), $isMarkdownRawBlockNode);
}

/**
 * Removes the range Enter was pressed over, as Delete removes it, leaving
 * the selection collapsed where the removal leaves the caret: a guarded
 * range through {@link $removeGuardedRange}, the one removal every route
 * shares, and any other range — one inside a single raw Markdown block —
 * through Lexical's own.
 *
 * @param selection - A range that is not collapsed.
 */
function $removeRangeBeforeEnter(selection: RangeSelection): void {
    const removed = $removeGuardedRange(selection);

    if (!removed) {
        selection.removeText();
    }
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
        const previous = payload.nodes[index - 1];
        const afterBlock = previous !== undefined && $isBlock(previous);
        const separator = index > 0 && ($isBlock(node) || afterBlock) ? blockSeparator : "";

        return joined + separator + $pastedText(node);
    }, "");

    selection.insertRawText(text);

    return true;
}

/**
 * The text a pasted node goes into a raw Markdown block or a code block as:
 * its own text, except that each block a list item holds stands apart from
 * what the item holds before it as two items of the list do. Lexical's text
 * of an item does that between the item's blocks, but puts nothing between
 * text that stands straight in the item and the block after it, which would
 * write that block into the text's line. Pasted nodes are as they were
 * built: an item built from HTML holds its text so, where one copied in this
 * editor holds it in its text node.
 *
 * @param node - The pasted node, or a node it holds.
 * @returns Its text.
 */
function $pastedText(node: LexicalNode): string {
    const list = $isListNode(node) || $isListItemNode(node) ? node : null;

    if (list === null) {
        return node.getTextContent();
    }

    const children = list.getChildren();

    return children.map((child, index) => {
        const next = children[index + 1];
        const endsItsLine = next !== undefined && ($isBlock(child) || $isBlock(next));

        return $pastedText(child) + (endsItsLine ? LIST_TEXT_SEPARATOR : "");
    }).join("");
}

/**
 * `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` handler for pasted `:::`
 * columns. A selection copied across two columns of a fence copies the
 * columns without their fence, and Lexical's insert joins a pasted paragraph
 * to the one at the caret but never a column: the caret's paragraph would
 * stay split around the pasted columns, with an empty paragraph after them
 * when the caret was at its end. Replaces each pasted column with the blocks
 * it holds and pastes those instead, through `$insertGeneratedNodes`, so the
 * other paste handlers and Lexical's insert treat them as any pasted blocks.
 *
 * @remarks
 * `$insertGeneratedNodes` dispatches the command again, so a paste holding
 * a column runs every listener registered ahead of this one twice. Each must
 * do nothing on the second pass, as the range guard and the run-edge tag
 * do: the range is already removed, and a tag added twice is one tag.
 *
 * @param payload - The pasted nodes and the selection they are inserted at.
 * @param editor - The editor the command was dispatched to.
 * @returns Whether the paste held a column, now pasted as its blocks.
 */
function $pasteColumnsAsTheirBlocks(payload: CommandPayloadType<typeof SELECTION_INSERT_CLIPBOARD_NODES_COMMAND>, editor: LexicalEditor): boolean {
    const holdsColumn = payload.nodes.some($isMarkdownColumnNode);

    if (!holdsColumn) {
        return false;
    }

    const blocks = payload.nodes.flatMap((node) => ($isMarkdownColumnNode(node) ? node.getChildren() : [node]));

    $insertGeneratedNodes(editor, blocks, payload.selection);

    return true;
}

/**
 * Replaces each run of consecutive nodes that `isPart` accepts with the one
 * node `$wrap` builds from the run, and keeps every other node in its place.
 *
 * @param nodes - The nodes, in order.
 * @param isPart - Whether a node belongs in a run.
 * @param $wrap - Builds the node that holds one run.
 * @returns The nodes, each run replaced by its wrapper.
 */
function $wrapRuns<T extends LexicalNode>(
    nodes: LexicalNode[], isPart: (node: LexicalNode) => node is T, $wrap: (run: T[]) => LexicalNode,
): LexicalNode[] {
    const wrapped: LexicalNode[] = [];
    let run: T[] = [];

    for (const node of nodes) {
        const inRun = isPart(node);

        if (inRun) {
            run.push(node);

            continue;
        }

        if (run.length > 0) {
            wrapped.push($wrap(run));
            run = [];
        }

        wrapped.push(node);
    }

    if (run.length > 0) {
        wrapped.push($wrap(run));
    }

    return wrapped;
}

/**
 * Builds the table that holds `rows`, each row brought to cells alone
 * ({@link $keepRowsOfCells}) and filled at its end with empty cells up to
 * the widest row, as `@lexical/table`'s own row and table transforms do for
 * a table in the document. The table is still outside the document here,
 * where no transform reaches it, and `@lexical/table`'s paste of a table
 * into another table's cells reads it as a rectangle of cells: a short row
 * throws there, or loses the cells past the first row's width, and a child
 * that is no cell throws as soon as the table is measured. Rows that hold
 * no cell at all get one, since nothing gives a row its first cell once it
 * is in the document.
 *
 * @param rows - The rows, in order.
 * @returns The table.
 */
function $tableHoldingRows(rows: TableRowNode[]): TableNode {
    const table = $createTableNode().append(...rows);

    $keepRowsOfCells(table);

    const [map] = $computeTableMapSkipCellCheck(table, null, null);
    // 1: a table row holds a cell at least.
    const width = Math.max(1, ...map.map((row) => row.length));

    rows.forEach((row, index) => {
        const filled = (map[index] ?? []).filter((value) => value !== undefined).length;
        const missing = Array.from({ length: width - filled }, () => $createTableCellNode().append($createParagraphNode()));

        row.append(...missing);
    });

    return table;
}

/**
 * `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` handler for table rows and
 * cells pasted without their table. A range selection that stays inside one
 * table copies the rows it covers without the table, and one that stays
 * inside one row copies the cells without the row. Lexical's insert puts
 * them in as blocks, and `@lexical/table` then removes a row outside a table
 * and a cell outside a row with everything in them: the pasted content is
 * lost, the block at the caret stays split in two, and a `:::` column or the
 * document whose only block was the empty paragraph at the caret is left
 * with no block. Wraps each run of pasted cells in a row and each run of
 * rows in a table, and pastes the result instead, through
 * `$insertGeneratedNodes`, so the other paste handlers and Lexical's insert
 * treat it as any pasted table.
 *
 * @remarks
 * `$insertGeneratedNodes` dispatches the command again, so a paste holding a
 * bare row or cell runs every listener registered ahead of this one twice,
 * as a paste holding a column does (see {@link $pasteColumnsAsTheirBlocks}).
 *
 * @param payload - The pasted nodes and the selection they are inserted at.
 * @param editor - The editor the command was dispatched to.
 * @returns Whether the paste held a bare row or cell, now pasted in a table.
 */
function $pasteTableRowsAndCellsAsTables(
    payload: CommandPayloadType<typeof SELECTION_INSERT_CLIPBOARD_NODES_COMMAND>, editor: LexicalEditor,
): boolean {
    const holdsBarePart = payload.nodes.some((node) => $isTableRowNode(node) || $isTableCellNode(node));

    if (!holdsBarePart) {
        return false;
    }

    const rows = $wrapRuns(payload.nodes, $isTableCellNode, (cells) => $createTableRowNode().append(...cells));
    const blocks = $wrapRuns(rows, $isTableRowNode, $tableHoldingRows);

    $insertGeneratedNodes(editor, blocks, payload.selection);

    return true;
}

/**
 * Tells whether a node is a paragraph or heading that a list item holds
 * after its text, or that a quote holds: a block Lexical pastes blocks into
 * as one line of text, and where a block typing shortcut applies as at the
 * top level.
 *
 * @param node - The node.
 * @returns `true` for such a block.
 */
function $isHeldBlockTakingText(node: LexicalNode | null): node is ElementNode {
    const isTextBlock = !$isMarkdownListItemTextNode(node) && ($isParagraphNode(node) || $isHeadingNode(node));
    const holder = isTextBlock ? node.getParent() : null;

    return isTextBlock && ($isMarkdownListItemNode(holder) || $isMarkdownQuoteNode(holder));
}

/**
 * Tells whether a node is a list item's text that holds nothing while its
 * item holds more: the empty line left above a nested list, a heading or a
 * table once the item's text is deleted.
 *
 * @param node - The node.
 * @returns `true` for such a text.
 */
function $isEmptiedItemTextOverBlocks(node: LexicalNode | null): boolean {
    return $isMarkdownListItemTextNode(node) && node.isEmpty() && node.getNextSibling() !== null;
}

/**
 * Tells whether a pasted node is a block: an element or a decorator that is
 * not inline, which is how Lexical's insert tells one.
 *
 * @param node - The pasted node.
 * @returns `true` for a block.
 */
function $isPastedBlock(node: LexicalNode): boolean {
    return $isBlock(node) || ($isDecoratorNode(node) && !node.isInline());
}

/**
 * The pasted nodes as blocks: each block as it is, and each run of inline
 * nodes between blocks in a paragraph, or of nodes that need a parent of
 * their kind in that parent, as Lexical's insert wraps them.
 *
 * @param nodes - The pasted nodes.
 * @returns The blocks, in order.
 */
function $pastedBlocks(nodes: readonly LexicalNode[]): LexicalNode[] {
    const blocks: LexicalNode[] = [];
    let run: ElementNode | null = null;

    for (const node of nodes) {
        // A node that needs a parent of its kind, as a list item pasted without its list, is wrapped as a run is.
        const standsAlone = $isPastedBlock(node) && !node.isParentRequired();

        if (standsAlone) {
            blocks.push(node);
            run = null;

            continue;
        }

        if (run === null) {
            run = node.createParentElementNode();
            blocks.push(run);
        }

        run.append(node);
    }

    return blocks;
}

/**
 * Splits the block blocks are pasted into, at the caret, as Lexical's insert
 * does: a block that holds something through `insertParagraph`, and an
 * emptied text of a list item ({@link $isEmptiedItemTextOverBlocks}) from
 * what its item holds after it. (Enter in an empty text would take the item
 * out of its list instead.) An empty block that stands alone is not split.
 *
 * @param selection - The collapsed selection in the block.
 * @param caretBlock - The block.
 * @returns The second half, or `null` when the block was not split.
 */
function $splitCaretBlockForPaste(selection: RangeSelection, caretBlock: ElementNode): ElementNode | null {
    const item = caretBlock.getParent();
    const isEmptiedText = $isEmptiedItemTextOverBlocks(caretBlock);

    if (isEmptiedText && $isMarkdownListItemTextNode(caretBlock) && $isMarkdownListItemNode(item)) {
        return $splitItemAfterText(item, caretBlock);
    }

    const holdsNothing = caretBlock.isEmpty();

    return holdsNothing ? null : selection.insertParagraph();
}

/**
 * `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` handler for blocks pasted into
 * a paragraph or heading that a list item holds after its text, or that a
 * quote holds. The block is split at the caret and the pasted blocks become
 * blocks of the item or quote between the halves, as Lexical's insert puts
 * them at the top level: the first pasted block's text joins the first half when it is a block of
 * text, the other blocks follow it, and the second half joins the last
 * pasted block when that one is a block of text — after a pasted list or
 * table it stays a block of its own.
 *
 * It also takes a paste at a list item's text that holds nothing while the
 * item holds more ({@link $isEmptiedItemTextOverBlocks}), whether it was
 * empty or the pasted-over range emptied it. There the item is
 * split after its text first, so what it holds goes after the pasted
 * blocks: they leave the list as blocks pasted at any item's text do, and
 * the item's blocks follow the last pasted block as they follow the second
 * half of a text that held something.
 *
 * @remarks
 * Lexical's own insert splits the caret's block only when it holds
 * something. At an emptied text it puts the pasted blocks after the item,
 * and so after the blocks the item holds, and removes the text, which sends
 * those blocks to the item before.
 *
 * Lexical's own insert does this only for a block that stands in the root
 * or a shadow root, or that says it needs a parent of its kind, as a list
 * item's text does. Any other block inside a block gets the pasted blocks'
 * inline content on its one line (`RangeSelection.insertNodes`, its case
 * 3c), which wrote the texts of several pasted blocks, a table's cells or a
 * list's items into one paragraph. The paragraph and heading classes
 * are Lexical's, so no node of the editor's can answer for them: hence a
 * handler.
 *
 * @param payload - The pasted nodes and the selection they are inserted at.
 * @returns Whether the paste went into such a block of a list item or a quote.
 */
function $pasteBlocksIntoHeldBlock(payload: CommandPayloadType<typeof SELECTION_INSERT_CLIPBOARD_NODES_COMMAND>): boolean {
    const selection = payload.selection;
    const holdsBlock = payload.nodes.some($isPastedBlock);

    if (!$isRangeSelection(selection) || !holdsBlock) {
        return false;
    }

    const startBlock = $findEnclosingBlock($orderedPoints(selection)[0].getNode());
    const coversRange = !selection.isCollapsed();
    // A range that starts in an item's text can empty it: whether it does is known once the range is removed,
    // which Lexical's insert would do first as well.
    const startsInTextOverBlocks = $isMarkdownListItemTextNode(startBlock) && startBlock.getNextSibling() !== null;
    const mayEmptyText = startsInTextOverBlocks && (coversRange || $isEmptiedItemTextOverBlocks(startBlock));

    if (!$isHeldBlockTakingText(startBlock) && !mayEmptyText) {
        return false;
    }

    if (coversRange) {
        selection.removeText();
    }

    const caretBlock = $findEnclosingBlock(selection.anchor.getNode());
    const isEmptiedText = $isEmptiedItemTextOverBlocks(caretBlock);

    // The removal of a range that ended elsewhere can leave the caret in another kind of block: Lexical's insert takes it.
    if (caretBlock === null || (!$isHeldBlockTakingText(caretBlock) && !isEmptiedText)) {
        return false;
    }

    $insertPastedBlocksAt(selection, caretBlock, $pastedBlocks(payload.nodes));

    return true;
}

/**
 * The last node a pasted node holds, at any depth: where Lexical's insert
 * leaves the caret after the paste.
 *
 * @param node - The pasted node.
 * @returns Its last descendant, or the node itself when it holds nothing.
 */
function $lastLeafOf(node: LexicalNode): LexicalNode {
    return $isElementNode(node) ? node.getLastDescendant() ?? node : node;
}

/**
 * Puts pasted blocks in at a collapsed caret, as Lexical's insert does at
 * the top level: the caret's block is split ({@link $splitCaretBlockForPaste}),
 * the first pasted block's text joins the first half when it is a block of
 * text, the other blocks follow it, and the second half joins the last
 * pasted block when that one is a block of text. After an item's text the
 * blocks go after the item, the list split there; after any other block
 * they stay in its parent.
 *
 * @param selection - The collapsed selection.
 * @param caretBlock - The block the caret is in.
 * @param blocks - The pasted blocks, at least one.
 */
function $insertPastedBlocksAt(selection: RangeSelection, caretBlock: ElementNode, blocks: LexicalNode[]): void {
    const last = blocks[blocks.length - 1]!;
    const lastLeaf = $lastLeafOf(last);
    // The second half of the split block; the first half is then the block before it, which a heading split at
    // its start replaces by an empty paragraph.
    const tail = $splitCaretBlockForPaste(selection, caretBlock);
    const before = tail === null ? caretBlock : tail.getPreviousSibling();
    const head = $isElementNode(before) ? before : caretBlock;
    const first = blocks[0]!;
    const joinsHead = $isElementNode(first) && INTERNAL_$isBlock(first) && !first.isEmpty() && (!head.isEmpty() || head.canMergeWhenEmpty());
    const rest = joinsHead ? blocks.slice(1) : blocks;

    if (joinsHead) {
        head.append(...first.getChildren());
    }

    if ($isMarkdownListItemTextNode(head)) {
        // After an item's text a block goes after the item, the list split there (`insertAfter` of the text).
        rest.reduce<LexicalNode>((previous, block) => previous.insertAfter(block), head);
    } else {
        head.getParentOrThrow().splice(head.getIndexWithinParent() + 1, 0, rest);
    }

    const lastBlock = rest.length === 0 ? head : $findEnclosingBlock(lastLeaf);
    const joinsTail = tail !== null && lastBlock !== null && (tail.canMergeWhenEmpty() || INTERNAL_$isBlock(last));

    lastLeaf.selectEnd();

    if (joinsTail) {
        lastBlock.append(...tail.getChildren());
        tail.remove();
    }

    const headIsLeftEmpty = head.isEmpty();

    if (headIsLeftEmpty) {
        head.remove();
    }
}

/**
 * Tells whether pasted nodes end in a block of text inside a table or a
 * `:::` block: the last node of the paste stands in a block that a table
 * cell or a column holds, each a region of its own to Lexical (a shadow
 * root). That block is the one Lexical's insert joins the text after the
 * caret to, when it joins it.
 *
 * @param nodes - The pasted nodes.
 * @returns `true` when the paste ends in such a block.
 */
function $pasteEndsInTableOrFence(nodes: readonly LexicalNode[]): boolean {
    const last = nodes[nodes.length - 1];

    if (last === undefined) {
        return false;
    }

    // None when the paste ends in a cell or a row that holds nothing: Lexical then joins nothing.
    const lastBlock = $findMatchingParent($lastLeafOf(last), INTERNAL_$isBlock);

    if (lastBlock === null) {
        return false;
    }

    // Up to the pasted node and no further: a block taken out of a pasted column still names that column as its parent.
    const regionOrLast = $findMatchingParent(lastBlock, (node) => node.is(last) || $isRootOrShadowRoot(node));

    return regionOrLast !== null && $isRootOrShadowRoot(regionOrLast);
}

/**
 * Tells whether a node holds nothing that a line of text shows: blank text,
 * or an element holding nothing else, as a link is once a removed range has
 * taken its text.
 *
 * @param node - The node.
 * @returns `true` for blank text and for an element of nothing but such nodes.
 */
function $holdsBlankTextAlone(node: LexicalNode): boolean {
    if ($isElementNode(node)) {
        return node.getChildren().every($holdsBlankTextAlone);
    }

    return $isTextNode(node) && node.getTextContent().trim() === "";
}

/**
 * Tells whether a block holds something after a collapsed caret: anything
 * but blank text ({@link $holdsBlankTextAlone}). Blank text counts as none,
 * as it does for Enter in an item's text
 * ({@link $enterLeavesListAtBlankItemText}).
 *
 * @param selection - The collapsed selection, in the block.
 * @param block - The block.
 * @returns `true` when something of the block follows the caret.
 */
function $holdsSomethingAfterCaret(selection: RangeSelection, block: ElementNode): boolean {
    const anchor = selection.anchor;
    const restOfText = anchor.type === "text" ? anchor.getNode().getTextContent().slice(anchor.offset) : "";
    const followedByBlankTextAlone = $nodesAfterPoint(anchor, block).every($holdsBlankTextAlone);

    return restOfText.trim() !== "" || !followedByBlankTextAlone;
}

/**
 * `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` listener for a paste at a list
 * item's text that ends in a table or a `:::` block
 * ({@link $pasteEndsInTableOrFence}), with something of the text after the
 * caret. Splits the item at the caret first, as Enter does, and leaves the
 * caret at the end of the first half, where the insert then goes on. What
 * followed the caret is then the text of an item of its own after the
 * pasted blocks and keeps the blocks its item held, as it does around a
 * table inserted at that caret. A range is removed first, as Lexical's
 * insert would remove it, since where the caret then stands is known only
 * afterwards.
 *
 * @remarks
 * Lexical's insert joins the second half of the block it splits to the last
 * pasted block when the block says it merges when empty, which a list item's
 * text says so that a pasted paragraph joins an empty item. It finds that
 * last block by the last node of the paste, wherever it is: after a pasted
 * table that is the last cell's paragraph, so the text after the caret went
 * into the table's last cell, and after a `:::` block into its last block.
 * No method of the item's text can tell Lexical otherwise: the question it
 * is asked does not name the pasted block. At the end of the text, or with
 * blank text alone after the caret, the caret is left as it is, and no
 * empty item is left: Lexical drops an empty rest, and puts a blank one at
 * the end of the last pasted cell or block, where the save writes nothing
 * for it.
 *
 * @param payload - The pasted nodes and the selection they are inserted at.
 * @returns Always `false`, so the insertion still runs.
 */
function $splitItemBeforePasteEndingInTableOrFence(payload: CommandPayloadType<typeof SELECTION_INSERT_CLIPBOARD_NODES_COMMAND>): boolean {
    const selection = payload.selection;
    const endsInTableOrFence = $pasteEndsInTableOrFence(payload.nodes);

    if (!$isRangeSelection(selection) || !endsInTableOrFence) {
        return false;
    }

    const startBlock = $findEnclosingBlock($orderedPoints(selection)[0].getNode());
    const coversRange = !selection.isCollapsed();

    if (!$isMarkdownListItemTextNode(startBlock)) {
        return false;
    }

    if (coversRange) {
        selection.removeText();
    }

    const caretBlock = $findEnclosingBlock(selection.anchor.getNode());

    // No removal was found that takes the caret out of the text it starts in; were there one, Lexical's insert takes the paste as it is.
    if (!$isMarkdownListItemTextNode(caretBlock)) {
        return false;
    }

    const holdsRestAfterCaret = $holdsSomethingAfterCaret(selection, caretBlock);

    if (holdsRestAfterCaret) {
        selection.insertParagraph();

        const endOfFirstHalf = $normalizeCaret($getChildCaret(caretBlock, "previous"));

        $setPointFromCaret(selection.anchor, endOfFirstHalf);
        $setPointFromCaret(selection.focus, endOfFirstHalf);
    }

    return false;
}

/**
 * `PASTE_COMMAND` handler for a plain-text paste into a raw Markdown block:
 * the clipboard's text goes in at the caret, each newline a line break of
 * the block, as `paste()` inserts it. Lexical's own plain-text paste inserts
 * a paragraph per newline, which splits the block in two. A paste carrying
 * Lexical nodes is left to Lexical, whose insert reaches
 * {@link $pasteIntoTextOnlyBlock}. Registered at {@link COMMAND_PRIORITY_HIGH},
 * ahead of `registerRichText`'s own handler, which therefore does not run:
 * the update is tagged `PASTE_TAG` here, as that handler tags its own, so
 * the undo history never takes the pasted text for typed text.
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
    $addUpdateTag(PASTE_TAG);
    selection.insertRawText(text);

    return true;
}

/**
 * Whether `selection` is a *stale-focus range*: a non-collapsed range whose
 * end, in document order, is a text point strictly inside its text node, and
 * whose start lies in a different block.
 *
 * @remarks
 * Lexical's `RangeSelection.removeText()` (0.49.0–0.52.0) throws
 * `$getTextNodeOffset: invalid offset` on such a range when the start block
 * is emptied: it slices the end text node but leaves the selection's end
 * offset as it was, then reads that stale offset while moving the end
 * block's remaining children into the start block. Every route removing a
 * range in this editor removes a guarded range through
 * {@link $removeGuardedRange}, which takes this shape through
 * {@link $removeStaleFocusRange} unless the range is a table-edge range or
 * starts in a raw Markdown block or a code block, each of which has a
 * removal of its own that does not trip the fault
 * ({@link $removeJoiningRange}). Remove the guard when the canary in
 * `markdown-editor-command-crashes.test.ts` fails.
 *
 * @param selection - The selection to test.
 * @returns Whether it is a stale-focus range.
 */
function $isStaleFocusRange(selection: BaseSelection | null): selection is RangeSelection {
    if (!$isRangeSelection(selection)) {
        return false;
    }

    const isCollapsed = selection.isCollapsed();

    if (isCollapsed) {
        return false;
    }

    const [start, end] = $orderedPoints(selection);
    const endNode = end.getNode();

    return $isTextNode(endNode)
        && end.offset > 0 && end.offset < endNode.getTextContentSize()
        && $findEnclosingBlock(start.getNode()) !== $findEnclosingBlock(endNode);
}

/**
 * Removes a stale-focus range (see {@link $isStaleFocusRange}) without
 * tripping Lexical's fault: splits the end text node at the end offset and
 * moves the end to the start of the right-hand half, so no offset is left to
 * go stale, then removes the range. The split changes no content, and the
 * two halves merge back when the update normalises its text nodes, which is
 * why the split and the removal have to happen in the same update.
 *
 * @param selection - A stale-focus range; collapsed at the removal point afterwards.
 */
function $removeStaleFocusRange(selection: RangeSelection): void {
    const end = selection.isBackward() ? selection.anchor : selection.focus;
    const [, rest] = (end.getNode() as TextNode).splitText(end.offset);

    end.set(rest!.getKey(), 0, "text");
    selection.removeText();
}

/**
 * Whether Lexical's removal of a range from a point in `startNode` to a
 * point in `endNode`, each in a block of its own, joins what the end's block
 * holds after the end onto the start's block, so that it follows a caret
 * left at the start. Told for nodes, so it can be asked about a block the
 * selection does not end in.
 *
 * @remarks
 * Lexical's range removal (0.49.0) joins two blocks at most, one on each
 * side of where the paths down to the two ends fork: the outermost element
 * there that holds inline content, or nothing, once the range is gone. On
 * the end's side that is always the end's own block, since the removal
 * empties everything before the end out of the elements around it. On the
 * start's side it is the start's own block wherever the editor's own rules
 * hold: no block that holds inline content stands around another (a list
 * item holds blocks only, its text one of them). It joins nothing when
 * a root or shadow root (a table cell, a `:::` column) lies between the fork
 * and either end, nor when the start is a point on an element that holds no
 * inline content (a list item, between two of its blocks).
 *
 * Which element "holds inline content" is Lexical's own test,
 * `INTERNAL_$isBlock`, imported for it: the public `$isBlockElementNode`
 * (any element that is not inline) also matches a list or a list item,
 * which the removal joins nothing onto, so it would name the wrong block. The export is internal by name, so
 * `markdown-editor-command-crashes.test.ts` holds a canary (U3) that fails
 * when it goes or changes what it matches.
 *
 * @param startNode - The node the range's start is in.
 * @param endNode - The node the range's end is in, in another block than `startNode`.
 * @returns Whether the end's block's rest joins the start's block.
 */
function $removalJoinsEndBlockRest(startNode: LexicalNode, endNode: LexicalNode): boolean {
    const startBlock = $findEnclosingBlock(startNode);
    const endBlock = $findEnclosingBlock(endNode);

    if (startBlock === null || endBlock === null) {
        return false;
    }

    const startPath = [...startBlock.getParents().reverse(), startBlock];
    const endPath = [...endBlock.getParents().reverse(), endBlock];
    const forkDepth = startPath.findIndex((ancestor, depth) => !ancestor.is(endPath[depth]));

    // No fork: the end's block is inside the start's, which then has no side of its own to join from.
    if (forkDepth < 0) {
        return false;
    }

    const startBranch = startPath.slice(forkDepth);
    const endBranch = endPath.slice(forkDepth);
    const crossesRoot = [...startBranch, ...endBranch].some($isRootOrShadowRoot);
    const joinedBlock = startBranch.find(INTERNAL_$isBlock);

    return !crossesRoot && endBranch.length > 0 && startBlock.is(joinedBlock);
}

/**
 * Whether Shift+Enter over `selection`, a range {@link $removeJoiningRange}
 * removes — a text-only-edge range, a stale-focus range or a cross-item
 * range that is no table-edge range —, would have its line break declined once the range is
 * removed: whether the caret the removal leaves — at the range's start,
 * followed by the rest of the end's block when the removal joins it there
 * ({@link $removalJoinsEndBlockRest}) — is where a save cannot write a break
 * ({@link $lineBreakUnwritableAt}). Told ahead of the removal, so that a
 * declined Shift+Enter can leave the range as it is. A range that starts in
 * a raw Markdown block or a code block is not declined, since its caret
 * stays in that block, which keeps every break — but for one that starts
 * at the very start of a raw block and has nothing follow its end: the
 * removal empties the raw block, which then shows as an empty paragraph
 * ({@link $rawBlockEmptiedFrom}), where a break is all the block would
 * hold.
 *
 * @remarks
 * Read off the document as it stands, so it cannot tell for a range with an
 * end in a raw Markdown block that the removal makes read as another block:
 * where the break has no place in that block, the range is removed and no
 * break is added.
 *
 * "Nothing follows its end" is read in the block of text the range ends
 * in, so the range's end has to stand in one: each command's guard settles
 * the range's points ({@link $settleSelectionOffContainers}) before this is
 * asked, and moves an end held as a point on a list, a `:::` block or the
 * document — after which a whole block may follow — into the text the
 * range reaches.
 *
 * @param selection - A range of one of those shapes, its ends settled, left as it is.
 * @returns Whether the break would be declined.
 */
function $joiningRemovalDeclinesLineBreak(selection: RangeSelection): boolean {
    const [start, end] = $orderedPoints(selection);
    const joinsRest = $removalJoinsEndBlockRest(start.getNode(), end.getNode());
    const emptied = $rawBlockEmptiedFrom(start);
    const endBlock = $findEnclosingBlock(end.getNode());

    if (emptied !== null && endBlock !== null) {
        return !$contentFollows(end, endBlock);
    }

    return $lineBreakUnwritableAt(start, joinsRest ? end : null);
}

/**
 * The raw Markdown block a removal from `start` empties: the one `start`
 * stands in with nothing of it before `start`. Such a block shows as an
 * empty paragraph once its text is gone, or as the blocks that the text
 * joined onto it reads as.
 *
 * @param start - The start of a range that ends in another block.
 * @returns The raw block, or `null` when `start` stands in none, or after some of its text.
 */
function $rawBlockEmptiedFrom(start: PointType): MarkdownRawBlockNode | null {
    const node = start.getNode();
    const block = $findMatchingParent(node, $isMarkdownRawBlockNode);

    if (block === null) {
        return null;
    }

    // A raw block holds its lines' text nodes and the line breaks between them, and nothing deeper.
    const isOnBlock = node.is(block);
    const before = isOnBlock ? block.getChildren().slice(0, start.offset) : node.getPreviousSiblings();
    const isAtStart = before.length === 0 && (isOnBlock || start.offset === 0);

    return isAtStart ? block : null;
}

/**
 * Whether a paste will insert text of its own at the selection, read off its
 * event the way `@lexical/rich-text` routes a paste. It will not when the
 * event has no clipboard (a key or input event), nor when the clipboard's
 * files take the paste — files with neither `text/plain` nor `text/html`
 * beside them go to `DRAG_DROP_PASTE`, which inserts nothing, as a pasted
 * screenshot does. Otherwise it will when the clipboard's `text/plain`, or
 * without one its `text/uri-list`, is not empty.
 *
 * @remarks
 * The test for a `PASTE_COMMAND` guard that removes a range to make room for
 * the paste: that text goes straight into the selection, past every later
 * guard, so its room has to be made here, and only when there is text. Nodes
 * a paste brings (a Lexical or HTML clipboard) arrive through
 * `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` instead, whose guards see the
 * nodes themselves and make room when there are any. A paste this is `false`
 * for therefore either inserts nothing, and must leave the range as it
 * leaves any other, or reaches those guards.
 *
 * @param event - The paste command's payload.
 * @returns `true` when the paste will insert its text at the selection.
 */
function pasteWillInsertText(event: CommandPayloadType<typeof PASTE_COMMAND>): boolean {
    const clipboardData = "clipboardData" in event ? event.clipboardData : null;

    if (clipboardData === null) {
        return false;
    }

    const carriesText = clipboardData.types.includes("text/plain") || clipboardData.types.includes("text/html");
    const takenByFiles = clipboardData.files.length > 0 && !carriesText;
    const text = clipboardData.getData("text/plain") || clipboardData.getData("text/uri-list");

    return !takenByFiles && text !== "";
}

/**
 * Finds the table holding `node` (or `node` itself, when it is a table).
 *
 * @param node - The node to search upward from.
 * @returns The table, or `null` when `node` is in no table.
 */
function $findTableHolding(node: LexicalNode): TableNode | null {
    return $findMatchingParent(node, $isTableNode);
}

/**
 * Whether `selection` is a *table-edge range*: a non-collapsed range with
 * one end inside a table (in a cell, or on the table node itself) and the
 * other end outside that table. Removing one removes the selected content
 * outside the table and the whole table, and leaves the block on the
 * table's far side as it was.
 *
 * @remarks
 * In a browser, `@lexical/table` (0.49.0) grows such a range over the whole
 * table, as the editor then highlights it. Its own Backspace, Delete and cut
 * handlers then move the end inside the table to the start of the block
 * after the table (or the end of the block before it), so Lexical's range
 * removal joins that block's rest onto the block the range starts in. Every
 * other route removes only up to the inside end and leaves part of the table
 * behind. Every route removing a range in this editor checks for the shape
 * first and removes it through {@link $removeTableEdgeRange}, and every
 * route copying one copies what that removal takes
 * ({@link $grownTableEdgeRange}).
 *
 * @param selection - The selection to test.
 * @returns Whether it is a table-edge range.
 */
function $isTableEdgeRange(selection: BaseSelection | null): selection is RangeSelection {
    const isRange = $isRangeSelection(selection) && !selection.isCollapsed();

    if (!isRange) {
        return false;
    }

    const anchorTable = $findTableHolding(selection.anchor.getNode());
    const focusTable = $findTableHolding(selection.focus.getNode());

    if (anchorTable === null || focusTable === null) {
        return anchorTable !== focusTable;
    }

    return !anchorTable.is(focusTable);
}

/**
 * Moves each end of `selection` that is inside a table the other end is not
 * in to the table's outer edge: an element point on the table's parent, just
 * before the table for the start, just after it for the end. That is the
 * only kind of point past the table that lies in no block, so the range
 * covers the whole table and joins nothing beyond it. The caller must remove
 * the range in the same update: the browser cannot show a point between
 * blocks, so the next native selection change would move it back.
 *
 * @param selection - A table-edge range.
 */
function $coverWholeTables(selection: RangeSelection): void {
    const [start, end] = $orderedPoints(selection);
    const startTable = $findTableHolding(start.getNode());
    const endTable = $findTableHolding(end.getNode());
    const startsInOwnTable = startTable !== null && !startTable.is(endTable);
    const endsInOwnTable = endTable !== null && !endTable.is(startTable);

    if (startsInOwnTable) {
        start.set(startTable.getParentOrThrow().getKey(), startTable.getIndexWithinParent(), "element");
    }

    if (endsInOwnTable) {
        end.set(endTable.getParentOrThrow().getKey(), endTable.getIndexWithinParent() + 1, "element");
    }
}

/**
 * A copy of `selection` grown as `@lexical/table` grows a range dragged into
 * a table: each end inside a table the other end is not in goes to the start
 * of that table's first cell, or the end of its last. It selects what
 * removing the range removes, so a cut copies what it removes and a copy
 * copies what a cut would. Only read from; never set as the editor's
 * selection.
 *
 * @remarks
 * `@lexical/table` (0.49.0) does not grow a range running from one table
 * into another, and offline it grows none. The points
 * {@link $coverWholeTables} sets are no use for a copy: Lexical reads no
 * text from the last text node of a range ending between blocks.
 *
 * @param selection - A table-edge range, left as it is.
 * @returns The grown copy.
 */
function $grownTableEdgeRange(selection: RangeSelection): RangeSelection {
    const grown = selection.clone();
    const [start, end] = $orderedPoints(grown);
    const startTable = $findTableHolding(start.getNode());
    const endTable = $findTableHolding(end.getNode());
    const firstRow = startTable?.getFirstChild();
    const firstCell = $isElementNode(firstRow) ? firstRow.getFirstChild() : null;
    const lastRow = endTable?.getLastChild();
    const lastCell = $isElementNode(lastRow) ? lastRow.getLastChild() : null;
    const startsInOwnTable = startTable !== null && !startTable.is(endTable);
    const endsInOwnTable = endTable !== null && !endTable.is(startTable);

    if (startsInOwnTable && $isTableCellNode(firstCell)) {
        start.set(firstCell.getKey(), 0, "element");
    }

    if (endsInOwnTable && $isTableCellNode(lastCell)) {
        end.set(lastCell.getKey(), lastCell.getChildrenSize(), "element");
    }

    return grown;
}

/**
 * Moves a caret left between two blocks — an element point on the root, a
 * `:::` column or a list item, where a removed table was — into a block: the start of the
 * block after it, else the end of the block before it, else a new empty
 * paragraph when the parent holds no block any more. Leaves any other
 * selection alone.
 *
 * With `staysOutOf`, a caret that would go into a block it matches — one
 * that cannot hold the node a caller is about to insert at the caret, as a
 * raw Markdown block or a code block, holding only text, cannot hold an
 * image — goes into a new empty paragraph on the side of that block it came
 * from instead, where the table was. The side is known here, while the
 * caret is on its way in: once inside an empty block, its start and its end
 * are one point.
 *
 * @remarks
 * Lexical's `insertParagraph` on a point between blocks inserts a paragraph
 * without removing the range, so the caret must be in a block before any
 * insert route continues. A column cannot be empty, hence the new paragraph.
 *
 * @param selection - The selection, collapsed after a removal.
 * @param staysOutOf - Tells a block the caret must not go into, or `null` for none.
 */
function $settleCaretIntoBlock(selection: RangeSelection, staysOutOf: ((node: LexicalNode) => boolean) | null): void {
    const parent = selection.anchor.getNode();
    const holdsBlocks = $isElementNode(parent) && ($isRootOrShadowRoot(parent) || $isMarkdownListItemNode(parent) || $isMarkdownQuoteNode(parent));
    const isBetweenBlocks = selection.isCollapsed() && selection.anchor.type === "element" && $isElementNode(parent) && holdsBlocks;

    if (!isBetweenBlocks) {
        return;
    }

    const next = parent.getChildAtIndex(selection.anchor.offset);
    const previous = parent.getChildAtIndex(selection.anchor.offset - 1);
    const direction: CaretDirection = $isElementNode(next) ? "next" : "previous";
    const neighbour = direction === "next" ? next : previous;
    const entered = $isElementNode(neighbour) ? $normalizeCaret($getChildCaret(neighbour, direction)) : null;
    const closedBlock = entered !== null && staysOutOf !== null ? $findMatchingParent(entered.origin, staysOutOf) : null;
    let caret: PointCaret<CaretDirection> | null = entered;

    if (caret === null || closedBlock !== null) {
        const paragraph = $createParagraphNode();

        if (closedBlock === null) {
            parent.append(paragraph);
        } else if (direction === "next") {
            closedBlock.insertBefore(paragraph);
        } else {
            closedBlock.insertAfter(paragraph);
        }

        caret = $getChildCaret(paragraph, "next");
    }

    $setPointFromCaret(selection.anchor, caret);
    $setPointFromCaret(selection.focus, caret);
}

/**
 * Whether a node is a container no caret can stand in: a `:::` block, which
 * holds columns. A point on one lies between its columns.
 *
 * @remarks
 * Lists and list items are not settled here: a caret between the items of a
 * list, or between the blocks of an item, has a meaning of its own there
 * ({@link $openBlockAtItemCaret}), and a range with an end on one is removed
 * by {@link $removeGuardedRangeForInsert} and the list item rules.
 *
 * @param node - The node a point is on.
 * @returns `true` for such a container.
 */
function $holdsNoCaret(node: LexicalNode): boolean {
    return $isMarkdownBlockNode(node);
}

/**
 * Whether a point stands between two blocks of the root or a `:::` column,
 * just before a list or a quote.
 *
 * @param point - The point.
 * @returns `true` for an element point on the root or a column, at a list or a quote.
 */
function $standsBeforeList(point: PointType): boolean {
    const node = point.getNode();
    const isElement = $isElementNode(node);
    const holdsBlocks = isElement && point.type === "element" && $isRootOrShadowRoot(node) && !$isTableCellNode(node);
    const next = holdsBlocks ? node.getChildAtIndex(point.offset) : null;

    return holdsBlocks && ($isListNode(next) || $isMarkdownQuoteNode(next));
}

/**
 * Whether a range's point stands between two blocks of the root or a `:::`
 * column, where a caret can be only while nothing is selected with it. Not
 * so for a range's start just before a list or a quote: the list item rules remove a
 * range from there with the items it covers (Backspace, paste and typing),
 * and the paragraph break, Tab, pasted or dropped nodes, `paste()` and
 * Shift+Enter remove it themselves ({@link $clearGuardedRangeBeforeParagraph},
 * {@link $removeGuardedRangeForInsert}, {@link $clearGuardedRangeBeforeLineBreak}).
 * An end just after a list is moved into it.
 *
 * @param point - An element point of a range.
 * @param isStart - Whether it is the range's start rather than its end.
 * @returns `true` for the root and a column, `false` for a table, a table
 *   row and a table cell (each a shadow root in `@lexical/table`) and for a
 *   start just before a list or a quote.
 */
function $liesBetweenBlocks(point: PointType, isStart: boolean): boolean {
    const node = point.getNode();
    const isElement = $isElementNode(node);
    // A table, its rows and its cells are shadow roots too, and are left to the table rules.
    const isTablePart = $isTableNode(node) || $isTableRowNode(node) || $isTableCellNode(node);
    const holdsBlocks = isElement && $isRootOrShadowRoot(node) && !isTablePart;

    return holdsBlocks && !(isStart && $standsBeforeList(point));
}

/**
 * Whether a selection is a range that starts just before a list or a quote, on the
 * root or in a `:::` column, whichever end the anchor is at.
 *
 * @param selection - The selection.
 * @returns `true` for such a range.
 */
function $isRangeStartingBeforeList(selection: BaseSelection | null): selection is RangeSelection {
    const isRange = $isRangeSelection(selection);
    const isOpen = isRange && !selection.isCollapsed();

    return isOpen && $standsBeforeList($orderedPoints(selection)[0]);
}

/**
 * Whether a range's end is a point on a list that stands in a `:::` column.
 * Lexical's removal of a range ending there takes the list and leaves its
 * column with nothing in it, which a column cannot be; the end is moved into
 * the list's text instead. On the root the list item rules take such a range.
 *
 * @param point - An element point of a range.
 * @returns `true` for a point on a list whose parent is a column.
 */
function $endsListOfColumn(point: PointType): boolean {
    const node = point.getNode();

    return $isListNode(node) && $isMarkdownColumnNode(node.getParent());
}

/**
 * Whether a selection point is one {@link $settleSelectionOffContainers}
 * moves: an element point on a container no caret can stand in, or, for a
 * range, one between two blocks of the root or a column.
 *
 * @param point - The point.
 * @param isCollapsed - Whether the selection is a caret.
 * @param isStart - Whether it is the selection's start rather than its end.
 * @returns `true` when the point is moved.
 */
function $pointNeedsSettling(point: PointType, isCollapsed: boolean, isStart: boolean): boolean {
    if (point.type !== "element") {
        return false;
    }

    const betweenBlocks = !isCollapsed && $liesBetweenBlocks(point, isStart);
    const endsColumnList = !isCollapsed && !isStart && $endsListOfColumn(point);

    return $holdsNoCaret(point.getNode()) || betweenBlocks || endsColumnList;
}

/**
 * Moves an element point to the caret position it names. It goes into the
 * neighbour block on the side `prefers`, and into the one on the other side
 * when the container has none there: down to the deepest position of that
 * block, as {@link $settleCaretIntoBlock} enters a block. A container with
 * no child at all is left as it is.
 *
 * @param point - The point, on an element.
 * @param prefers - The side of the point to go to first.
 */
function $settlePoint(point: PointType, prefers: CaretDirection): void {
    const container = point.getNode();
    const isContainer = $isElementNode(container);

    if (!isContainer) {
        return;
    }

    const next = container.getChildAtIndex(point.offset);
    const previous = container.getChildAtIndex(point.offset - 1);
    const preferred = prefers === "next" ? next : previous;
    const other: CaretDirection = prefers === "next" ? "previous" : "next";
    const direction: CaretDirection = preferred !== null ? prefers : other;
    const neighbour = direction === "next" ? next : previous;
    const isText = $isTextNode(neighbour);

    if (isText) {
        point.set(neighbour.getKey(), direction === "next" ? 0 : neighbour.getTextContentSize(), "text");

        return;
    }

    const isElement = $isElementNode(neighbour);

    if (isElement) {
        $setPointFromCaret(point, $normalizeCaret($getChildCaret(neighbour, direction)));
    }
}

/**
 * Moves a range's end that stands at the very start of its container to the
 * place right before that container, in the container's parent, and on
 * outward while that is a start too: an end with nothing before it in its
 * container is read in document order, at what stands before the
 * container. Stops at the document's start.
 *
 * @param point - A range's end, an element point; moved in place.
 */
function $readEndPastContainerStart(point: PointType): void {
    let node = point.getNode();
    let parent = node.getParent();

    while (point.offset === 0 && parent !== null) {
        point.set(parent.getKey(), node.getIndexWithinParent(), "element");
        node = parent;
        parent = node.getParent();
    }
}

/**
 * Moves the points of a selection that lie where no caret can be to the
 * caret positions they name, so a command acts as it does for the same
 * selection made with the mouse. It is the one place a selection's points
 * are settled before a range is removed or something is inserted: every
 * range guard calls it ({@link registerRangeGuards}), and so do
 * {@link $removeGuardedRange}, Enter's own listener
 * ({@link $settleSelectionBeforeEnter}), `insertTable` and `insertImage`.
 *
 * Such a point can only be set in code: on a `:::` block, or, for a range,
 * on the root or a column between two blocks. A caret goes to the start of
 * the block after it (the end of the block before it at the container's
 * end); a range's start likewise; a range's end to the end of the block
 * before it, read past the start of its container when nothing stands
 * before it there ({@link $readEndPastContainerStart}). Lists and list items
 * are not settled, and neither is a range's start just before a list or a quote
 * ({@link $liesBetweenBlocks}): but for a range the raw-block removal takes,
 * whose ends on lists, list items and before a list are then read inward
 * ({@link $settleTextOnlyEdgeEnds}).
 *
 * @remarks
 * Lexical's insert needs a block holding inline content around the caret,
 * and its removal of a range that starts between blocks removes every block
 * but the root's last child, which it leaves empty. A point on a table, a
 * table row or a cell is left to `@lexical/table`, and a caret between two
 * blocks to Lexical, which make and handle them themselves. The function
 * moves nothing a second time: once settled, every point it moves is in text
 * or on a block of text.
 *
 * @param selection - The selection, moved in place.
 * @returns Whether a point moved.
 */
function $settleSelectionOffContainers(selection: BaseSelection | null): boolean {
    const isRange = $isRangeSelection(selection);

    if (!isRange) {
        return false;
    }

    const isCollapsed = selection.isCollapsed();
    const [start, end] = $orderedPoints(selection);
    const startMoves = $pointNeedsSettling(start, isCollapsed, true);
    const endMoves = !isCollapsed && $pointNeedsSettling(end, isCollapsed, false);

    if (startMoves) {
        $settlePoint(start, "next");
    }

    if (isCollapsed && startMoves) {
        end.set(start.key, start.offset, start.type);
    } else if (endMoves) {
        $readEndPastContainerStart(end);
        $settlePoint(end, "previous");
    }

    const movedInward = $settleTextOnlyEdgeEnds(selection);

    return startMoves || endMoves || movedInward;
}

/**
 * The list item, list or quote a collapsed caret stands on: an element point
 * between the blocks of an item or a quote, or between the items of a list.
 *
 * @param selection - The selection.
 * @returns The item, list or quote, or `null` for any other selection.
 */
function $listContainerAtCaret(selection: BaseSelection | null): ElementNode | null {
    const isCaretBetweenBlocks = $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.type === "element";
    const container = isCaretBetweenBlocks ? selection.anchor.getNode() : null;

    return $isMarkdownListItemNode(container) || $isListNode(container) || $isMarkdownQuoteNode(container) ? container : null;
}

/**
 * Tells whether a selection is a range with an end between the blocks of a
 * list item or a quote, or between the items of a list: an element point on
 * the item, the quote or the list. Lexical's removal of such a range can leave the caret there.
 *
 * @param selection - The selection.
 * @returns `true` for such a range.
 */
function $isListContainerRange(selection: BaseSelection | null): selection is RangeSelection {
    const isRange = $isRangeSelection(selection) && !selection.isCollapsed();

    if (!$isRangeSelection(selection) || !isRange) {
        return false;
    }

    return [selection.anchor, selection.focus].some((point) => {
        const node = point.getNode();

        return point.type === "element" && ($isMarkdownListItemNode(node) || $isListNode(node) || $isMarkdownQuoteNode(node));
    });
}

/**
 * Tells whether an insert at the selection would go in between the blocks
 * of a list item or a quote, or between the items of a list: the selection
 * is a caret there, or a range that starts there, whose removal leaves the
 * caret where it starts.
 *
 * @param selection - The selection, left as it is.
 * @returns `true` when the selection starts at an element point on a list item, a quote or a list.
 */
function $startsOnListContainer(selection: BaseSelection | null): boolean {
    if (!$isRangeSelection(selection)) {
        return false;
    }

    const [start] = $orderedPoints(selection);
    const node = start.getNode();

    return start.type === "element" && ($isMarkdownListItemNode(node) || $isListNode(node) || $isMarkdownQuoteNode(node));
}

/**
 * Gives a caret that stands between the blocks of a list item an empty
 * paragraph of that item to stand in, and one that stands between the items
 * of a list an empty item. Such a caret is an element point on the item or
 * the list: Lexical leaves one on an item at the edge of a table that opens
 * or ends it, as it leaves one on the root beside a table there, and a
 * selection made in code can hold one on a list. Lexical's own inserts take
 * a point on the root; on a list item or a list, which is no block of text
 * and no root, an inserted line break or image has no block to go into, and
 * they throw. A paragraph put first in an item is then the item's text.
 *
 * @param selection - The selection an insert is about to go in at.
 * @returns Whether the caret stood on a list item or a list, and now stands in a new block of it.
 */
function $openBlockAtItemCaret(selection: BaseSelection | null): boolean {
    const container = $listContainerAtCaret(selection);

    if (!$isRangeSelection(selection) || container === null) {
        return false;
    }

    const block = $isListNode(container) ? $createMarkdownListItemTextNode() : $createParagraphNode();
    const caret = $getChildCaret(block, "next");

    container.splice(selection.anchor.offset, 0, [$isListNode(container) ? $createListItemNode().append(block) : block]);
    $setPointFromCaret(selection.anchor, caret);
    $setPointFromCaret(selection.focus, caret);

    return true;
}

/**
 * Makes the selection ready for a command that inserts at it, in the one
 * place every such command goes through: removes a guarded range
 * ({@link $removeGuardedRange}); removes a range with an end on a list
 * item or a list ({@link $isListContainerRange}) as well, since where its
 * removal leaves the caret is known only afterwards, and a range that
 * starts just before a list or a quote ({@link $isRangeStartingBeforeList}), which
 * Lexical's insert would otherwise put text or nodes into the list itself
 * at, and throw; and gives the caret as it then stands a block when it is
 * left between the blocks of a list item or the items of a list
 * ({@link $openBlockAtItemCaret}). Lexical's insert
 * would remove the range first too, and then throw for a caret left there,
 * with the range already gone.
 *
 * @param selection - The selection the insert goes in at.
 * @param caretStaysOutOf - Passed to {@link $removeGuardedRange}. `null` when omitted.
 * @returns Whether the caret was given a new block to stand in.
 */
function $removeGuardedRangeForInsert(selection: BaseSelection | null, caretStaysOutOf: ((node: LexicalNode) => boolean) | null = null): boolean {
    const removed = $removeGuardedRange(selection, caretStaysOutOf);
    const removesFirst = !removed && ($isListContainerRange(selection) || $isRangeStartingBeforeList(selection));

    if (removesFirst) {
        selection.removeText();
    }

    return $openBlockAtItemCaret(selection);
}

/**
 * Removes a range {@link $coverWholeTables} covered whose end lies inside
 * `endBlock`, a block after the range's start — a block past the start's
 * table, a list item at the far edge of a table it holds, or the `:::` column whose
 * table the range ends at the far edge of — in two removals that keep
 * `endBlock`: first its content up to the end, then everything from the
 * start to `endBlock`'s own position.
 *
 * @remarks
 * Lexical (0.49.0) removes a range that starts between blocks in one pass:
 * when the block the range ends in is emptied, it removes that block and
 * every container it empties, except that it leaves the root's last child
 * in place, empty — a list with no items, or a `:::` block with no column.
 * A range that starts inside a block has the rest of the block it ends in
 * joined onto that block. Ending the second removal at `endBlock`'s
 * position, not inside it, leaves the block and its containers alone, and
 * joins nothing.
 *
 * @param selection - A covered table-edge range; collapsed at its start afterwards.
 * @param endBlock - The block or column holding the range's end, and not its start.
 */
function $removeRangeKeepingEndBlock(selection: RangeSelection, endBlock: ElementNode): void {
    const start = selection.isBackward() ? selection.focus : selection.anchor;
    const from: [NodeKey, number, "text" | "element"] = [start.key, start.offset, start.type];

    // Not a caret brought down into the block's first text: a table opening the block would take it in.
    start.set(endBlock.getKey(), 0, "element");
    selection.removeText();   // inside endBlock only: nothing joins, and it is not a stale-focus range

    selection.anchor.set(...from);
    selection.focus.set(endBlock.getParentOrThrow().getKey(), endBlock.getIndexWithinParent(), "element");
    selection.removeText();
}

/**
 * Gives `parent`, a `:::` column a removal left without any block, an empty
 * paragraph, since a column cannot be empty. Leaves any other node alone.
 *
 * @param parent - The node that held a removed table, or `null`.
 */
function $refillEmptiedColumn(parent: ElementNode | null): void {
    const isColumn = parent !== null && parent.isAttached() && $isRootOrShadowRoot(parent) && !$isRootNode(parent);
    const isEmptiedColumn = isColumn && parent.isEmpty();

    if (isEmptiedColumn) {
        parent.append($createParagraphNode());
    }
}

/**
 * Removes a table-edge range (see {@link $isTableEdgeRange}): covers each
 * table it reaches into whole and stops at that table's far edge, removes
 * the range, and puts the caret where the range started — moved into the
 * neighbouring block when that start was a table's edge
 * ({@link $settleCaretIntoBlock}). A range whose covered end lies apart from
 * its start — in a later block, having run from a table into that block or
 * into a table a list item holds, or in a `:::` column the start is outside
 * of — is removed through {@link $removeRangeKeepingEndBlock}, so that block,
 * item or column stays, emptied or not, with nothing of it joined onto the
 * start's block: a column the end's table was the only block of keeps an
 * empty paragraph, and a list item whose every block the range covers stays
 * an empty item, which the list rules give an empty text.
 *
 * @param selection - A table-edge range; collapsed at the removal point afterwards.
 * @param caretStaysOutOf - For a caller about to insert a node at the caret:
 *   tells a block that node cannot go into, which a caret left at a table's
 *   edge then stays out of. `null`, for no such block, when omitted.
 */
function $removeTableEdgeRange(selection: RangeSelection, caretStaysOutOf: ((node: LexicalNode) => boolean) | null = null): void {
    const initialEnd = selection.isBackward() ? selection.anchor : selection.focus;
    const endTableParent = $findTableHolding(initialEnd.getNode())?.getParent() ?? null;

    $coverWholeTables(selection);

    const [start, end] = $orderedPoints(selection);
    const endBlock = $findEnclosingBlock(end.getNode());
    const startNode = start.getNode();
    const startEdge = start.type === "element" && $isRootOrShadowRoot(startNode) ? ([start.key, start.offset, "element"] as const) : null;
    const endsApartFromStart = endBlock !== null && !endBlock.is(startNode) && !endBlock.isParentOf(startNode);

    if (endsApartFromStart) {
        $removeRangeKeepingEndBlock(selection, endBlock);
    } else {
        // The end is in the block, column or root the start is in, or on: nothing to join.
        selection.removeText();
    }

    $refillEmptiedColumn(endTableParent);

    // Lexical itself takes a caret left first or last in its parent into the block beside it. Back to the
    // table's edge, so the caret is settled from there, where the side it enters a block from is known.
    if (startEdge !== null) {
        selection.anchor.set(...startEdge);
        selection.focus.set(...startEdge);
    }

    $settleCaretIntoBlock(selection, caretStaysOutOf);
}

/**
 * Backspace or Delete over a table-edge range: does what
 * `@lexical/rich-text`'s own key handler does — prevents the native edit and
 * dispatches `DELETE_CHARACTER_COMMAND` — ahead of `@lexical/table`'s key
 * handler, which would move the range's inside end to the block past the
 * table first (see {@link $isTableEdgeRange}).
 *
 * @param event - The keydown event.
 * @param editor - The editor the command was dispatched to.
 * @param isBackward - `true` for Backspace, `false` for Delete.
 * @returns Whether the selection was a table-edge range, now deleted.
 */
function $deleteTableEdgeRangeFromKey(event: CommandPayloadType<typeof KEY_DELETE_COMMAND>, editor: LexicalEditor, isBackward: boolean): boolean {
    const isTableEdge = $isTableEdgeRange($getSelection());

    if (!isTableEdge) {
        return false;
    }

    event.preventDefault();

    return editor.dispatchCommand(DELETE_CHARACTER_COMMAND, isBackward);
}

/**
 * `KEY_BACKSPACE_COMMAND` listener: deletes a table-edge range through
 * {@link $deleteTableEdgeRangeFromKey}.
 *
 * @param event - The keydown event.
 * @param editor - The editor the command was dispatched to.
 * @returns Whether the selection was a table-edge range, now deleted.
 */
function $backspaceOverTableEdgeRange(event: CommandPayloadType<typeof KEY_BACKSPACE_COMMAND>, editor: LexicalEditor): boolean {
    return $deleteTableEdgeRangeFromKey(event, editor, true);
}

/**
 * `KEY_DELETE_COMMAND` listener: deletes a table-edge range through
 * {@link $deleteTableEdgeRangeFromKey}.
 *
 * @param event - The keydown event.
 * @param editor - The editor the command was dispatched to.
 * @returns Whether the selection was a table-edge range, now deleted.
 */
function $deleteKeyOverTableEdgeRange(event: CommandPayloadType<typeof KEY_DELETE_COMMAND>, editor: LexicalEditor): boolean {
    return $deleteTableEdgeRangeFromKey(event, editor, false);
}

/**
 * Whether `selection` is a *text-only-edge range*: a non-collapsed range
 * with one end inside a raw Markdown block or a code block
 * ({@link $isTextOnlyBlock}) and the other end outside that block. A range
 * with both ends in one such block is none: it is an edit of that block's
 * text, which Lexical replaces in place.
 *
 * @remarks
 * Lexical's own removal of such a range merges the two blocks' nodes. Where
 * the range starts in the text-only block, the other block's rest then
 * joins as its text, not as its Markdown, and its escapes, formatting and
 * links change meaning or are dropped. Where it ends in one, nothing is
 * lost, but a handler that acts after the removal reads the selection as it
 * was dragged. So every route removes the range first, through
 * {@link $removeGuardedRange}; the delete commands alone leave one to
 * Lexical where its removal is all there is to do
 * ({@link $isPlainlyRemovedRange}).
 *
 * @param selection - The selection to test.
 * @returns Whether it is a text-only-edge range.
 */
function $isTextOnlyEdgeRange(selection: BaseSelection | null): selection is RangeSelection {
    const isRange = $isRangeSelection(selection) && !selection.isCollapsed();

    if (!isRange) {
        return false;
    }

    const anchorBlock = $findMatchingParent(selection.anchor.getNode(), $isTextOnlyBlock);
    const focusBlock = $findMatchingParent(selection.focus.getNode(), $isTextOnlyBlock);

    if (anchorBlock === null || focusBlock === null) {
        return anchorBlock !== focusBlock;
    }

    return !anchorBlock.is(focusBlock);
}

/**
 * The texts of the list items a range joins away, the outermost first: of
 * each item the range ends inside and does not start inside, the text the
 * item opens with, when the range ends after that text and its removal up to
 * the text's end would join the text onto the block the range starts in
 * ({@link $removalJoinsEndBlockRest}).
 *
 * @remarks
 * Lexical's range removal takes every node the range covers whole out of its
 * parent without calling the node's `remove`, and calls `remove` on the block
 * the range ends in alone. The join rule of a list item
 * (`MarkdownListItemTextNode.remove`) therefore runs when a range ends in
 * the item's text and not when it ends in a later block of the item, where
 * the text is one of the covered nodes.
 *
 * @param selection - The range.
 * @returns The item texts, none when the range joins no item away.
 */
function $itemTextsRangeTakesWhole(selection: RangeSelection): MarkdownListItemTextNode[] {
    const [start, end] = $orderedPoints(selection);
    const startNode = start.getNode();
    const endNode = end.getNode();
    const texts: MarkdownListItemTextNode[] = [];

    // Walked from the end outwards and put in front, so the outermost text comes first.
    for (const item of [endNode, ...endNode.getParents()]) {
        const text = $isMarkdownListItemNode(item) ? item.getFirstChild() : null;
        const holdsStart = item.is(startNode) || item.isParentOf(startNode);
        const endsBeforeText = item.is(endNode) && end.offset === 0;
        const isEnteredItemText = $isMarkdownListItemTextNode(text) && !holdsStart && !endsBeforeText;
        const holdsEnd = isEnteredItemText && (text.is(endNode) || text.isParentOf(endNode));
        const isJoinedAway = isEnteredItemText && !holdsEnd && $removalJoinsEndBlockRest(startNode, text);

        if (isJoinedAway) {
            texts.unshift(text);
        }
    }

    return texts;
}

/**
 * Whether `selection` is a *cross-item range*: a range that is not collapsed
 * and joins at least one list item away ({@link $itemTextsRangeTakesWhole}).
 *
 * @param selection - The selection to test.
 * @returns Whether it is a cross-item range.
 */
function $isCrossItemRange(selection: BaseSelection | null): selection is RangeSelection {
    const isRange = $isRangeSelection(selection) && !selection.isCollapsed();

    if (!isRange) {
        return false;
    }

    return $itemTextsRangeTakesWhole(selection).length > 0;
}

/**
 * A caret for `point` that names a node the steps of
 * {@link $joinCoveredItemTexts} do not remove: the node after the point when
 * there is one, else the node before it. A point on a list item is lost when
 * that item is joined away; the caret finds the same place again wherever
 * the item's blocks went.
 *
 * @param point - The point.
 * @returns The caret.
 */
function $caretKeepingItsPlace(point: PointType): PointCaret<CaretDirection> {
    const before = $caretFromPoint(point, "previous");
    const namesNodeAfter = point.type === "text" || $isSiblingCaret(before);

    return namesNodeAfter ? before : $caretFromPoint(point, "next");
}

/**
 * Joins away each list item whose text `selection` takes whole, the
 * outermost first: removes the range from its start to the end of that text,
 * which Lexical ends by removing the text, so the text's own `remove` moves
 * what the item held after it. Leaves `selection` a range from the same
 * start to the same end, for the caller to remove. Does nothing to a range
 * that takes no item's text whole.
 *
 * @remarks
 * The end is kept as a caret ({@link $caretKeepingItsPlace}) computed before
 * the first step, because a step can remove the node a point of the
 * selection is on. Pass the editor's own selection, never a clone.
 *
 * @param selection - The range; collapsed at the range's start when the steps removed all of it.
 */
function $joinCoveredItemTexts(selection: RangeSelection): void {
    const texts = $itemTextsRangeTakesWhole(selection);

    if (texts.length === 0) {
        return;
    }

    const [start, end] = $orderedPoints(selection);
    const endCaret = $caretKeepingItsPlace(end);
    const startAt: [NodeKey, number, "text" | "element"] = [start.key, start.offset, start.type];

    // Forward from here on: the anchor is the range's start, and each removal leaves it there.
    selection.anchor.set(...startAt);

    for (const text of texts) {
        $setPointFromCaret(selection.focus, $normalizeCaret($getChildCaret(text, "previous")));
        $removeJoiningRange(selection);

        const isEndLeft = endCaret.origin.isAttached();

        // The range ended right after the text of an item holding nothing else: it is removed.
        if (!isEndLeft) {
            return;
        }

        $setPointFromCaret(selection.focus, endCaret);
    }
}

/**
 * Whether `selection` is a *guarded range*: one of the shapes
 * {@link $removeGuardedRange} removes itself — a table-edge range
 * ({@link $isTableEdgeRange}), a text-only-edge range
 * ({@link $isTextOnlyEdgeRange}), a stale-focus range
 * ({@link $isStaleFocusRange}) or a cross-item range
 * ({@link $isCrossItemRange}). Every listener that asks whether a range is
 * guarded asks here, so none misses a shape.
 *
 * @param selection - The selection to test.
 * @returns Whether it is a guarded range.
 */
function $isGuardedRange(selection: BaseSelection | null): selection is RangeSelection {
    return $isTableEdgeRange(selection) || $isTextOnlyEdgeRange(selection) || $isStaleFocusRange(selection)
        || $isCrossItemRange(selection);
}

/**
 * Removes a range that is no table-edge range, by the first of three
 * removals that applies: a range that starts in a raw Markdown block or a
 * code block and ends outside it has the rest of the end's block joined as
 * its Markdown ({@link $deleteRangeFromTextOnlyBlock}); a stale-focus range
 * is removed without tripping Lexical's fault
 * ({@link $removeStaleFocusRange}); any other is removed by Lexical's own
 * removal. That last one is a guarded range that ends in a text-only block
 * where no text node is cut (at the start or the end of a line of a raw
 * Markdown block, or of a code block's text), or the range
 * {@link $joinCoveredItemTexts} removes for one list item's text, which
 * ends at the end of that text and is usually no guarded range.
 *
 * @remarks
 * The join is ahead of the stale-focus removal: a range from a raw block
 * into a later block's word is both shapes, and the stale-focus removal is
 * Lexical's merge, which joins that block's rest as its text.
 *
 * @param selection - A range that is no table-edge range; collapsed at the removal point afterwards.
 */
function $removeJoiningRange(selection: RangeSelection): void {
    const joinedAsMarkdown = $deleteRangeFromTextOnlyBlock(selection);

    if (joinedAsMarkdown) {
        return;
    }

    // Typed `boolean`: left as a type guard's result it would narrow `selection` to `never` in the other branch.
    const isStaleFocus: boolean = $isStaleFocusRange(selection);

    if (isStaleFocus) {
        $removeStaleFocusRange(selection);
    } else {
        selection.removeText();
    }
}

/**
 * Removes `selection` when it is a guarded range ({@link $isGuardedRange}),
 * the one way a route removes one (the delete commands leave a plainly
 * removed range to Lexical, {@link $isPlainlyRemovedRange}): a table-edge
 * range through
 * {@link $removeTableEdgeRange}, any other through
 * {@link $removeJoiningRange}. In that order: a table-edge range that
 * starts in a raw Markdown block or ends inside a later block's word is one
 * of the other shapes too, and must lose the whole table. Before either, a
 * cross-item range has each list item whose text it takes whole joined away
 * ({@link $joinCoveredItemTexts}), so the list item's own join rule runs once
 * for each. Leaves any other
 * selection alone, for the caller's own Lexical call to handle.
 *
 * Each raw Markdown block that held an end of the range and is still in the
 * document is then shown as its text now reads ({@link $showRawBlockAsSaved},
 * the rule a node transform applies when the update ends), so what the
 * caller inserts next meets the blocks the save will read, not a raw block
 * about to become them.
 *
 * @remarks
 * The update is not tagged {@link RUN_EDGE_TAG} here: a route carries that
 * tag exactly when it carried it at the parent. The delete commands, the
 * paste commands, the drop, the paragraph break Enter dispatches when it
 * starts a paragraph and the line break Shift+Enter dispatches tag their
 * command's update (`registerRunEdgeRules`), and `insertImage` tags its
 * own. Neither cut tags the update that removes the range: `cut()` carries
 * no tag, and the native cut's tag marks the command's own update, while
 * the removal follows in an update of its own. Typing, the start of a
 * composition and Tab carry none.
 * Each route without the tag is tidied where the caret is, as over any
 * range. A tag set here would send every route over the range, typing and
 * Tab among them, through the rule that tidies each changed block whole.
 *
 * Pass the editor's own selection, never a clone: the removals and the
 * re-read move the editor's selection, and the caller goes on with it. It
 * is the editor's selection again when this returns
 * ({@link $keepAsEditorSelection}).
 *
 * A point where no caret can be is settled first
 * ({@link $settleSelectionOffContainers}), for a route that is no command;
 * a command's guard settles it before its listener runs.
 *
 * @param selection - The selection about to be removed or replaced.
 * @param caretStaysOutOf - Passed to {@link $removeTableEdgeRange}, for a
 *   caller about to insert a node at the caret. `null` when omitted.
 * @returns Whether it was such a range, now removed and collapsed at the removal point.
 */
function $removeGuardedRange(selection: BaseSelection | null, caretStaysOutOf: ((node: LexicalNode) => boolean) | null = null): boolean {
    $settleSelectionOffContainers(selection);

    const isGuarded = $isGuardedRange(selection);

    if (!isGuarded) {
        return false;
    }

    // Read before the removal: afterwards the two ends are one caret.
    const rawBlocks = [selection.anchor, selection.focus].map((point) => $findMatchingParent(point.getNode(), $isMarkdownRawBlockNode));
    const isTableEdge = $isTableEdgeRange(selection);

    // Before either removal: each then meets a range that takes no item's text whole.
    $joinCoveredItemTexts(selection);

    if (isTableEdge) {
        $removeTableEdgeRange(selection, caretStaysOutOf);
    } else {
        $removeJoiningRange(selection);
    }

    for (const block of rawBlocks) {
        const isLeft = block !== null && block.isAttached();

        if (isLeft) {
            $showRawBlockAsSaved(block);
        }
    }

    $keepAsEditorSelection(selection);

    return true;
}

/**
 * The second step of {@link $settleSelectionOffContainers}: moves the ends
 * of a range the raw-block removal takes — one with an end in a raw
 * Markdown block or a code block — that still stand on a node that holds
 * blocks, between its children, into the range: its start to the start of
 * the first block of text at or after it, its end to the end of the last
 * block of text at or before it ({@link $settleRangeEndsInward}), each named
 * as a point in text where its block has text. After the first step such an
 * end is on a list, a list item, or the root or a column just before a
 * list. The range then takes in no block its points did not: an end before
 * a list's first item is the end of the block before the list, as the block
 * commands read it.
 *
 * @remarks
 * The first step leaves those points to the list item rules and to the
 * removal that runs first for a range starting before a list, which read
 * them for a range Lexical removes ({@link $isRangeStartingBeforeList},
 * {@link $isListContainerRange}). A range with an end in a raw block or a
 * code block is removed by {@link $removeGuardedRange} before any of those
 * rules sees it, and its removal reads both ends as places in a block's
 * text: left on a list, the start would leave the caret on that list and
 * the end would move the list's children out. A range that is a table-edge
 * range too is left to that shape's own removal, which reads such a point
 * beside a table.
 *
 * @param selection - The selection; its points are moved.
 * @returns Whether a point moved.
 */
function $settleTextOnlyEdgeEnds(selection: BaseSelection | null): boolean {
    const isRange = $isRangeSelection(selection) && !selection.isCollapsed();

    if (!isRange) {
        return false;
    }

    const points = [selection.anchor, selection.focus];
    const leavesTextOnlyBlock = points.some((point) => $findMatchingParent(point.getNode(), $isTextOnlyBlock) !== null);
    const standsOnHolder = points.some($standsOnHolder);
    const isTableEdge = $isTableEdgeRange(selection);
    const moves = leavesTextOnlyBlock && standsOnHolder && !isTableEdge;

    if (moves) {
        $settleRangeEndsInward(selection);
        $moveBlockPointsIntoText(selection);
    }

    return moves;
}

/**
 * Makes `selection` the editor's selection again, at the caret the editor
 * now holds, when the editor has come to hold another selection object. A
 * caller that passed the editor's selection to a removal goes on to insert
 * through that object, and so does Lexical for a paste's payload.
 *
 * @remarks
 * Lexical's `LexicalNode.replace` (0.49.0) installs a clone of the selection
 * as the editor's and leaves the object it cloned pointing at the node it
 * removed. The rule that shows a raw Markdown block as the paragraph it is
 * written as replaces the block that way.
 *
 * @param selection - The selection object the caller holds.
 */
function $keepAsEditorSelection(selection: RangeSelection): void {
    const current = $getSelection();
    const isSwapped = $isRangeSelection(current) && current !== selection;

    if (isSwapped) {
        selection.anchor.set(current.anchor.key, current.anchor.offset, current.anchor.type);
        selection.focus.set(current.focus.key, current.focus.offset, current.focus.type);
        $setSelection(selection);
    }
}

/**
 * Removes the range `insertImage` is about to put an image in place of, and
 * leaves the caret where an inline node can go in: a guarded range through
 * {@link $removeGuardedRange}, the caret kept out
 * of a raw Markdown block or a code block beside a removed table, and any
 * other range through Lexical's own removal, which the insertion would
 * otherwise run first itself.
 *
 * @remarks
 * The range's points are settled first ({@link $removeGuardedRange}), so the
 * removal runs between two caret positions and empties no container.
 *
 * @param selection - The selection the image goes in at; collapsed afterwards.
 */
function $removeRangeBeforeImage(selection: RangeSelection): void {
    const removed = $removeGuardedRange(selection, $isTextOnlyBlock);
    const isLeft = !removed && !selection.isCollapsed();

    if (isLeft) {
        selection.removeText();
    }

    // The caret as the removal left it: on a list item or a list it gets a block of its own.
    $openBlockAtItemCaret(selection);
}

/**
 * Whether `selection` is a *plainly removed range*: a guarded range whose
 * removal is Lexical's own and nothing more — a text-only-edge range that is
 * neither a table-edge, a stale-focus nor a cross-item range and does not start in the
 * raw Markdown block or code block, so it ends in one where no text node is
 * cut: at the start or the end of a line of a raw block, or of a code
 * block's text. The delete commands leave such a range to their own handler
 * ({@link $deleteGuardedRange}).
 *
 * @remarks
 * A guarded shape with a removal of its own must be ruled out here, or the
 * delete commands skip that removal.
 *
 * @param selection - The selection to test.
 * @returns Whether it is a plainly removed range.
 */
function $isPlainlyRemovedRange(selection: BaseSelection | null): boolean {
    const isTextOnlyEdgeAlone = $isTextOnlyEdgeRange(selection) && !$isTableEdgeRange(selection) && !$isStaleFocusRange(selection)
        && !$isCrossItemRange(selection);

    if (!isTextOnlyEdgeAlone) {
        return false;
    }

    const [start] = $orderedPoints(selection);
    const startsInTextOnlyBlock = $findMatchingParent(start.getNode(), $isTextOnlyBlock) !== null;

    return !startsInTextOnlyBlock;
}

/**
 * Listener for the commands whose whole effect on a range is removing it
 * (`DELETE_WORD_COMMAND`, `DELETE_LINE_COMMAND`, `REMOVE_TEXT_COMMAND`, and
 * `DELETE_CHARACTER_COMMAND` through {@link $deleteCharacterOverGuardedRange},
 * which calls it): removes a guarded range itself
 * ({@link $removeGuardedRange}), except a plainly removed one
 * ({@link $isPlainlyRemovedRange}), which it leaves alone. A cross-item
 * range is never a plainly removed one, so these commands remove it whole.
 *
 * @remarks
 * Lexical removes a plainly removed range as the guard would, and its
 * Backspace does one thing more that no other route does: it settles a
 * first block of the document the removal empties (an emptied heading or
 * quote becomes a paragraph). A guard that took the range would leave that
 * step out.
 *
 * @returns Whether the selection was a guarded range this listener takes, now removed.
 */
function $deleteGuardedRange(): boolean {
    const selection = $getSelection();
    const isPlain = $isPlainlyRemovedRange(selection);

    // Left to the command's own handler, which removes it the same way; its Backspace also settles a first block the removal empties.
    return !isPlain && $removeGuardedRange(selection);
}

/**
 * `DELETE_CHARACTER_COMMAND` listener: removes a guarded range as
 * {@link $deleteGuardedRange} does, except a cross-item range. For one, it
 * joins away the items whose text the range takes
 * ({@link $joinCoveredItemTexts}) and then removes what is left as this
 * command removes any range: a guarded one through the guard, any other
 * through Lexical's own deletion, whose Backspace also settles a first block
 * the removal empties.
 *
 * @param isBackward - `true` for Backspace, `false` for Delete.
 * @returns Whether the selection was a guarded range, now removed.
 */
function $deleteCharacterOverGuardedRange(isBackward: boolean): boolean {
    const selection = $getSelection();
    const isCrossItem = $isCrossItemRange(selection);

    if (!isCrossItem) {
        return $deleteGuardedRange();
    }

    $joinCoveredItemTexts(selection);

    const removed = $deleteGuardedRange();
    // Collapsed already when the range ended right after the text of an item holding nothing else.
    const isLeft = !removed && !selection.isCollapsed();

    if (isLeft) {
        selection.deleteCharacter(isBackward);
    }

    return true;
}

/**
 * `INSERT_TAB_COMMAND` listener: makes the selection ready for the tab
 * ({@link $removeGuardedRangeForInsert}), then lets Lexical insert it at the
 * now-collapsed caret — in a paragraph of its own when that caret stands
 * between the blocks of a list item, as a tab goes into an empty paragraph
 * anywhere.
 *
 * @returns Always `false`, so the command's own handler still runs.
 */
function $clearGuardedRangeBeforeInsert(): boolean {
    $removeGuardedRangeForInsert($getSelection());

    return false;
}

/**
 * `INSERT_PARAGRAPH_COMMAND` listener: makes the selection ready for the
 * paragraph ({@link $removeGuardedRangeForInsert}), then lets Lexical insert
 * it at the now-collapsed caret. A range that starts just before a list
 * ({@link $isRangeStartingBeforeList}) or ends on a list or item
 * ({@link $isListContainerRange}) and is no guarded range
 * ({@link $isGuardedRange}, which is removed through the guard) is removed
 * here first. Lexical's own
 * insert over a range whose anchor is the point before the list inserts
 * the paragraph and removes nothing, and over the same range made backward
 * removes it but leaves the caret at the document's end, so the paragraph
 * would not come where the range was; and where a removal leaves the caret
 * on a list or item is known only afterwards. A
 * list or item the removal emptied is refilled
 * ({@link $openBlockAtItemCaret}) and Lexical's insert runs there, where
 * Enter leaves the list for a paragraph, as after Delete; a caret it leaves
 * between blocks that stay gets its block, which is the paragraph. A
 * caret left between the blocks of a list item gets its paragraph here, as
 * Lexical gives one to a caret between two blocks of the root: its own
 * insert finds no block around a point on a list item to split.
 *
 * @returns Whether the paragraph was put in here; otherwise `false`, so the command's own handler still runs.
 */
function $clearGuardedRangeBeforeParagraph(): boolean {
    const selection = $getSelection();
    const isGuarded = $isGuardedRange(selection);
    const removesFirst = !isGuarded && ($isRangeStartingBeforeList(selection) || $isListContainerRange(selection));

    if (removesFirst) {
        selection.removeText();

        // A list or item the removal emptied is refilled, and Lexical's Enter
        // runs at that blank item and leaves the list, as after Delete. A
        // caret left between blocks that stay gets its block, which is what
        // Enter does there.
        const container = $listContainerAtCaret(selection);
        const wasEmptied = container !== null && container.isEmpty();
        const opened = $openBlockAtItemCaret(selection);

        return opened && !wasEmptied;
    }

    return $removeGuardedRangeForInsert(selection);
}

/**
 * The point of the document as it stands that has after it, in its block,
 * what the caret will have after it once `covered` is removed and the caret,
 * left between blocks at the range's start, has settled
 * ({@link $settleCaretIntoBlock}). A table-edge removal joins nothing, so
 * the content past the range is the same before and after.
 *
 * @param covered - A copy of a table-edge range that starts in a table,
 *   covered by {@link $coverWholeTables}; its start is moved to the point returned.
 * @returns The point, or `null` when the caret settles in a block holding nothing.
 */
function $pointAheadOfSettledCaret(covered: RangeSelection): PointType | null {
    const [start, end] = $orderedPoints(covered);
    const parent = start.getNode();
    const endNode = end.getNode();
    const endsBetweenBlocks = $isElementNode(endNode) && $isRootOrShadowRoot(endNode);
    const endsOnParent = parent.is(endNode);
    const endsInsideParent = parent.isParentOf(endNode);
    const blockAfterEnd = endsBetweenBlocks ? endNode.getChildAtIndex(end.offset) : null;
    const blockBeforeStart = $isElementNode(parent) ? parent.getChildAtIndex(start.offset - 1) : null;

    const pointAt = (caret: PointCaret<CaretDirection>): PointType => {
        $setPointFromCaret(start, $normalizeCaret(caret));

        return start;
    };

    // Forward, into what the removal leaves of the end's block.
    if (endsInsideParent && !endsBetweenBlocks) {
        return end;
    }

    // Forward, to the block after the end's table.
    if ((endsOnParent || endsInsideParent) && $isElementNode(blockAfterEnd)) {
        return pointAt($getChildCaret(blockAfterEnd, "next"));
    }

    // Forward, into the column the end's table closed: the removal leaves it holding nothing else.
    if (endsInsideParent) {
        return null;
    }

    // Back, to the end of the block before the start's table, else into a new paragraph.
    return $isElementNode(blockBeforeStart) ? pointAt($getChildCaret(blockBeforeStart, "previous")) : null;
}

/**
 * Whether Shift+Enter over `selection`, a table-edge range, would have its
 * line break declined once the range is removed: whether the caret the
 * removal leaves is where a save cannot write a break
 * ({@link $lineBreakUnwritableAt}). Told ahead of the removal, so that a
 * declined Shift+Enter can leave the range as it is.
 *
 * @param selection - A table-edge range, left as it is.
 * @returns Whether the break would be declined.
 */
function $tableEdgeRemovalDeclinesLineBreak(selection: RangeSelection): boolean {
    const covered = selection.clone();

    $coverWholeTables(covered);

    const [start, end] = $orderedPoints(covered);
    const startNode = start.getNode();
    const startsBetweenBlocks = $isElementNode(startNode) && $isRootOrShadowRoot(startNode);

    if (startsBetweenBlocks) {
        const ahead = $pointAheadOfSettledCaret(covered);

        return ahead === null || $lineBreakUnwritableAt(ahead);
    }

    // The caret stays at the start, and only what the start's own block holds past the range's end follows it.
    const container = $breakRuleContainerOf(startNode);
    const endsInContainer = container !== null && container.is($breakRuleContainerOf(end.getNode()));

    return endsInContainer ? $lineBreakUnwritableAt(end) : container !== null;
}

/**
 * Whether Shift+Enter over `selection` would have its line break declined
 * once the range is removed as {@link $removeGuardedRange} removes it: told
 * for a table-edge range by {@link $tableEdgeRemovalDeclinesLineBreak}, else
 * for a text-only-edge range, a stale-focus range or a cross-item range
 * by {@link $joiningRemovalDeclinesLineBreak} — in the order the removal
 * itself takes the shapes in. The steps that join list items away
 * ({@link $joinCoveredItemTexts}) do not change the answer: they move blocks,
 * and the decision reads only the start's block and the rest of the end's.
 *
 * @param selection - The selection, left as it is.
 * @returns Whether it is a guarded range and the break would be declined.
 */
function $guardedRemovalDeclinesLineBreak(selection: BaseSelection | null): boolean {
    const isTableEdge = $isTableEdgeRange(selection);

    if (isTableEdge) {
        return $tableEdgeRemovalDeclinesLineBreak(selection);
    }

    const isJoining = $isTextOnlyEdgeRange(selection) || $isStaleFocusRange(selection) || $isCrossItemRange(selection);

    return isJoining && $joiningRemovalDeclinesLineBreak(selection);
}

/**
 * `INSERT_LINE_BREAK_COMMAND` listener: removes a guarded range
 * ({@link $removeGuardedRange}), then lets Lexical insert the break at the
 * now-collapsed caret — unless the removal would leave the caret where the
 * break is declined ({@link $guardedRemovalDeclinesLineBreak}). Shift+Enter
 * is then declined here, before anything is removed: a declined Shift+Enter
 * changes nothing, over these ranges as over any other. A range that starts
 * just before a list is removed first, as Enter removes it, unless the break
 * would be declined where that leaves the caret
 * ({@link $beforeListRemovalDeclinesLineBreak}); then nothing is removed.
 *
 * @returns Whether the break was declined; otherwise `false`, so the command's own handlers still run.
 */
function $clearGuardedRangeBeforeLineBreak(): boolean {
    const selection = $getSelection();
    const isGuarded = $isGuardedRange(selection);
    const removesFirst = !isGuarded && $isRangeStartingBeforeList(selection);
    // Between the blocks of a list item, or the items of a list, there is no line to break, and Lexical's insert
    // throws there: for a caret, and for a range that starts or ends there, before anything of it is removed.
    const declined = $guardedRemovalDeclinesLineBreak(selection) || $startsOnListContainer(selection) || $isListContainerRange(selection)
        || (removesFirst && $beforeListRemovalDeclinesLineBreak(selection));

    if (declined) {
        return true;
    }

    // A range from just before a list is removed first, as Enter removes it ({@link $clearGuardedRangeBeforeParagraph}).
    if (removesFirst) {
        $removeGuardedRangeForInsert(selection);

        return false;
    }

    $removeGuardedRange(selection);

    return false;
}

/**
 * Whether Shift+Enter over a range that starts just before a list
 * ({@link $isRangeStartingBeforeList}) would have its line break declined
 * once the range is removed: the removal leaves the caret in the block the
 * range ends in, ahead of what that block holds after the range.
 *
 * @param selection - A range that starts just before a list, left as it is.
 * @returns Whether the break would be declined.
 */
function $beforeListRemovalDeclinesLineBreak(selection: RangeSelection): boolean {
    const [, end] = $orderedPoints(selection);

    return $lineBreakUnwritableAt(end);
}

/**
 * Removes a guarded range ({@link $removeGuardedRange}) that text is about
 * to be inserted over through Lexical's `insertText`, and gives the caret
 * the format and style `insertText` types over a range in — those of the
 * range's first text node, so text over a range that starts in bold text
 * goes in bold. A range that starts in a table, or in a raw Markdown block
 * or a code block, leaves no such node: the text goes in with the format
 * and style of the text the caret lands in, and plain where the caret lands
 * on no text, as in a block the range emptied. Leaves any other selection
 * alone.
 *
 * @param selection - The selection the text is about to replace.
 */
function $removeGuardedRangeBeforeText(selection: BaseSelection | null): void {
    const isGuarded = $isGuardedRange(selection);

    if (!isGuarded) {
        return;
    }

    const [start] = $orderedPoints(selection);
    const startNode = start.getNode();
    const isTableEdge = $isTableEdgeRange(selection);
    const startsInTable = isTableEdge && $findTableHolding(startNode) !== null;
    const startsInTextOnlyBlock = $findMatchingParent(startNode, $isTextOnlyBlock) !== null;
    const takesCaretFormat = startsInTable || startsInTextOnlyBlock;
    const startFormat = $isTextNode(startNode) ? startNode.getFormat() : selection.format;
    const startStyle = $isTextNode(startNode) ? startNode.getStyle() : selection.style;

    $removeGuardedRange(selection);

    // Read anew: a raw block the removal makes read as other blocks shows as them by now.
    const caret = $getSelection();
    const isRange = $isRangeSelection(caret);

    if (!isRange) {
        return;
    }

    const caretNode = caret.anchor.getNode();
    const caretText = $isTextNode(caretNode) ? caretNode : null;

    // 0 is Lexical's format bitmask with no format set, and "" its style with no declaration.
    caret.format = takesCaretFormat ? caretText?.getFormat() ?? 0 : startFormat;
    caret.style = takesCaretFormat ? caretText?.getStyle() ?? "" : startStyle;
}

/**
 * `PASTE_COMMAND` listener: makes the selection ready for the pasted text
 * when the paste will insert its text there ({@link pasteWillInsertText}),
 * then lets the paste run at the now-collapsed caret: a guarded range is
 * removed and the caret given the format the text goes in with
 * ({@link $removeGuardedRangeBeforeText}), and a range with an end on a list
 * item or a list, or a caret left on one, is made ready as for any insert
 * ({@link $removeGuardedRangeForInsert}). A paste that inserts nothing — a
 * pasted screenshot, an empty clipboard — leaves the selection as it is.
 *
 * @param event - The paste event.
 * @returns Always `false`, so the command's own handler still runs.
 */
function $clearGuardedRangeBeforePastedText(event: CommandPayloadType<typeof PASTE_COMMAND>): boolean {
    const selection = $getSelection();
    const isChanged = $isGuardedRange(selection) || $isListContainerRange(selection) || $listContainerAtCaret(selection) !== null;

    // The shape first: the event is read only for a selection this guard would change.
    const insertsText = isChanged && pasteWillInsertText(event);

    if (insertsText) {
        $removeGuardedRangeBeforeText(selection);
        // What is left to make ready: a range with an end on a list item or a list, and a caret left on one.
        $removeGuardedRangeForInsert($getSelection());
    }

    return false;
}

/**
 * `CONTROLLED_TEXT_INSERTION_COMMAND` listener: removes a guarded range and
 * gives the caret the format the typed text goes in with
 * ({@link $removeGuardedRangeBeforeText}), then lets Lexical type at the
 * now-collapsed caret.
 *
 * @returns Always `false`, so the command's own handler still runs.
 */
function $clearGuardedRangeBeforeTyping(): boolean {
    $removeGuardedRangeBeforeText($getSelection());

    return false;
}

/**
 * `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` listener: removes the
 * guarded range the pasted or dropped nodes are about to replace, a range
 * that ends on a list or item, and a range that starts just before a list
 * ({@link $removeGuardedRangeForInsert}), then lets the insertion run at the
 * now-collapsed caret. With no
 * nodes to insert — pasted HTML holding nothing the editor reads, such as an
 * image alone — the range is left as it is, as Lexical's insertion leaves
 * any other.
 *
 * @param payload - The nodes to insert and the selection they go in at.
 * @returns Always `false`, so the insertion still runs.
 */
function $clearGuardedRangeBeforePaste(payload: CommandPayloadType<typeof SELECTION_INSERT_CLIPBOARD_NODES_COMMAND>): boolean {
    if (payload.nodes.length > 0) {
        $removeGuardedRangeForInsert(payload.selection);
    }

    return false;
}

/**
 * `CUT_COMMAND` listener for a guarded range: mirrors
 * `@lexical/rich-text`'s own cut — copies the selection to the clipboard,
 * then removes it in one update tagged `CUT_TAG` (its own undo step) — but
 * removes the range through {@link $removeGuardedRange}. A table-edge range
 * is copied as it is removed, with each table it reaches into whole
 * ({@link $grownTableEdgeRange}). A native cut removes in a later update
 * than the one the command runs in, so a guard that only removed the range
 * before Lexical's handler could not reach it.
 *
 * @param event - The cut event (Lexical also dispatches a `KeyboardEvent`, or `null`).
 * @param editor - The editor the command was dispatched to.
 * @returns Whether the selection was a guarded range, now being cut.
 */
function $cutGuardedRange(event: CommandPayloadType<typeof CUT_COMMAND>, editor: LexicalEditor): boolean {
    const selection = $getSelection();
    const isTableEdge = $isTableEdgeRange(selection);
    const isGuarded = $isGuardedRange(selection);

    if (!isGuarded) {
        return false;
    }

    // `copyToClipboard` takes only a ClipboardEvent; Lexical also dispatches
    // CUT_COMMAND with a KeyboardEvent. `"clipboardData" in event` tells them
    // apart without naming a DOM global.
    const clipboardEvent = event !== null && "clipboardData" in event ? event : null;
    const data = isTableEdge ? $getClipboardDataFromSelection($grownTableEdgeRange(selection)) : undefined;

    void copyToClipboard(editor, clipboardEvent, data).then(() => {
        editor.update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                $removeGuardedRange(selection);
                selection.removeText();
            }
        }, { tag: CUT_TAG });
    });

    return true;
}

/**
 * `COPY_COMMAND` listener for a table-edge range: copies what a cut of the
 * range removes, each table it reaches into whole
 * ({@link $grownTableEdgeRange}), as {@link $cutGuardedRange} copies it, so
 * a copy and a cut of one selection put the same on the clipboard. The
 * document and the selection stay as they are. Any other selection is left
 * to Lexical's own copy, which copies it as it stands.
 *
 * @param event - The copy event (Lexical also dispatches a `KeyboardEvent`, or `null`).
 * @param editor - The editor the command was dispatched to.
 * @returns Whether the selection was a table-edge range, now copied.
 */
function $copyTableEdgeRange(event: CommandPayloadType<typeof COPY_COMMAND>, editor: LexicalEditor): boolean {
    const selection = $getSelection();

    if (!$isTableEdgeRange(selection)) {
        return false;
    }

    // See $cutGuardedRange()'s comment: `copyToClipboard` takes only a ClipboardEvent.
    const clipboardEvent = event !== null && "clipboardData" in event ? event : null;

    void copyToClipboard(editor, clipboardEvent, $getClipboardDataFromSelection($grownTableEdgeRange(selection)));

    return true;
}

/**
 * `DELETE_CHARACTER_COMMAND` handler keeping a raw Markdown block or a code
 * block text-only when a delete at a collapsed caret joins another block to
 * it, as that block's Markdown: its formatting, links, images and escapes
 * become text of the block, which saves its text as written, instead of
 * Lexical's merge moving the block's nodes in, which the save would drop.
 * Handles Backspace at the start of a paragraph, heading or list
 * item's text right after such a block (the first item of a list right after
 * it) and Delete at such a block's end before one: each as the range from
 * the block's end to the next block's start, removed by
 * {@link $removeGuardedRange}, which joins through
 * {@link $deleteRangeFromTextOnlyBlock}. The caret lands where the two met.
 * A range is not this handler's: the command's range guard removes one
 * ahead of it ({@link $deleteGuardedRange}), joining the same way.
 * Registered at {@link COMMAND_PRIORITY_HIGH}, ahead of `registerRichText`'s
 * own handler.
 *
 * @param isBackward - `true` for Backspace, `false` for Delete.
 * @returns Whether a block was joined to a raw block or code block.
 */
function $joinIntoTextOnlyBlock(isBackward: boolean): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    const isCollapsed = selection.isCollapsed();

    // A range is removed by the guard of this command, ahead of this listener.
    if (!isCollapsed) {
        return false;
    }

    const pair = isBackward ? $textOnlyBlockBeforeBlockStart(selection) : $blockAfterTextOnlyBlockEnd(selection);

    if (pair === null) {
        return false;
    }

    const [block, next] = pair;

    // The join is the range from the block's end to the next block's start, removed as a range is.
    selection.anchor.set(block.getKey(), block.getChildrenSize(), "element");
    selection.focus.set(next.getKey(), 0, "element");

    return $removeGuardedRange(selection);
}

/**
 * The text a raw Markdown block's line holds before the place where its
 * content starts: any number of quote markers (`>`, with the space after
 * one) and list markers (with the whitespace after them), and indentation.
 */
const RAW_LINE_OPENING = /^(?:[ \t]*(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+))*[ \t]*$/;

/** The quote markers a raw block's lines open with. */
const QUOTE_MARKERS = /^[ \t]*(?:>[ \t]?)+/gm;

/** A `<` that opens a tag (a letter, `/`, `!` or `?` after it) and has no `>` after it, across lines. */
const UNCLOSED_TAG_OPENING = /<[A-Za-z/!?][^>]*$/;

/**
 * The Markdown the rest of a block joins a raw block or code block as
 * ({@link $deleteRangeFromTextOnlyBlock}): into a code block, as the joined
 * block's own save writes that rest, after the character before the point
 * in that block; into a raw block, as Markdown with every escape, after the
 * character before the joint in the raw block, except that a joint where
 * the line holds nothing yet but container markers and indentation
 * ({@link RAW_LINE_OPENING}) opens a line, so the rest keeps the escapes a
 * line start needs there. A `>` that opens the rest is escaped when the raw
 * text before the joint holds a `<` that opens a tag and is not closed:
 * the `>` would close it, making a tag of the two blocks' text. The tag may
 * span lines, so it is read off the text before the joint, which the
 * serializer's one character of context before the rest cannot carry.
 *
 * @param target - The raw block or code block the rest joins.
 * @param source - The block the rest comes from.
 * @param nodes - The rest, detached.
 * @param textBeforeJoint - The raw block's or code block's text before the joint; `""` at its start.
 * @param restBefore - The source block's character before the rest; `""` at its start.
 * @returns The Markdown.
 */
function $joinedMarkdown(target: ElementNode, source: ElementNode, nodes: LexicalNode[], textBeforeJoint: string, restBefore: string): string {
    const isCode = $isCodeNode(target);

    if (isCode) {
        return $inlineMarkdown(nodes, restBefore, (run, before) => $serializeRestOfBlock(source, run, before));
    }

    const lineBeforeJoint = textBeforeJoint.slice(textBeforeJoint.lastIndexOf("\n") + 1);
    const opensLine = RAW_LINE_OPENING.test(lineBeforeJoint);
    const markdown = $inlineMarkdown(nodes, opensLine ? "" : textBeforeJoint.slice(-1));
    // The quote markers at the lines' starts are no `>` that closes a tag.
    const opensTag = UNCLOSED_TAG_OPENING.test(textBeforeJoint.replace(QUOTE_MARKERS, ""));

    return opensTag ? markdown.replace(/^([ \t]*)>/, "$1\\>") : markdown;
}

/**
 * The character a block's last line ends with, as the serializer sees it:
 * a soft line break (a source run showing as a space) ends the line, so
 * what follows it opens a line.
 *
 * @param block - The block, once the rest after a point is detached.
 * @returns The block's last character; `"\n"` after a soft break, `""` for an empty block.
 */
function $characterBeforeRest(block: ElementNode): string {
    const last = block.getLastDescendant();
    const endsInSoftBreak = $isMarkdownSourceTextNode(last) && last.getSource().endsWith("\n");

    return endsInSoftBreak ? "\n" : block.getTextContent().slice(-1);
}

/**
 * A block's text before a point in it, as `getTextContent()` gives the
 * block's text (a line break is `\n`).
 *
 * @param block - The block.
 * @param point - A point in the block.
 * @returns The text before the point.
 */
function $textBeforePoint(block: ElementNode, point: PointType): string {
    const text = block.getTextContent();
    const node = point.getNode();
    const restOfNode = point.type === "text" ? node.getTextContentSize() - point.offset : 0;
    const after = $nodesAfterPoint(point, block).reduce((size, next) => size + next.getTextContentSize(), 0);

    return text.slice(0, Math.max(0, text.length - restOfNode - after));
}

/**
 * Deletes a range that starts inside a raw Markdown block or a code block
 * and ends in a later block: the rest of that later block after the range
 * joins as {@link $joinedMarkdown} writes it (as its text, when it is a raw
 * block or code block too), so nothing it holds is dropped and its escapes
 * keep its text as it was shown. A range that ends on a list item itself, between two of its
 * blocks, has the item's later blocks follow the block as blocks of their
 * own.
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
    const textBeforeJoint = $textBeforePoint(block, start);
    const rest = $detachRestOfBlock(tailBlock, end);
    // The rest of a list item, for an end between its blocks, is blocks: they follow the block, they are no text of it.
    const following = $takeBlocksOutOf(rest);
    // What the tail block keeps once its rest is detached is what came before the rest.
    const restBefore = $characterBeforeRest(tailBlock);
    const tail = $isTextOnlyBlock(tailBlock) ? rest.getTextContent() : $joinedMarkdown(block, tailBlock, rest.getChildren(), textBeforeJoint, restBefore);
    const range = tailBlock.selectEnd();

    range.anchor.set(...startPoint);
    range.removeText();
    following.reduce<LexicalNode>((previous, next) => previous.insertAfter(next), block.getLatest());

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
 * @param before - The character before the run; `""` where it opens a line.
 * @param serialize - Writes the nodes after the character before them; {@link $serializeInlineNodes} by default.
 * @returns Their Markdown.
 */
function $inlineMarkdown(
    nodes: LexicalNode[], before: string = "", serialize: (nodes: LexicalNode[], before: string) => string = $serializeInlineNodes,
): string {
    const text = nodes.map((node) => node.getTextContent()).join("");
    const leading = /^[ \t]*/.exec(text)![0];
    const trailing = /[ \t]*$/.exec(text)![0];
    // The serializer trims the leading whitespace, which the first character then follows — unless the run opens a
    // line, where that whitespace is only indentation.
    const opensLine = before === "" || before === "\n";
    const markdown = serialize(nodes, leading === "" || opensLine ? before : leading.slice(-1));

    if (markdown === "") {
        return text.trim() === "" ? text : markdown;
    }

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
 * (inline code, and CSS no span writes, show nothing the text lacks) — is
 * replaced by its Markdown, so the save, which writes the block's text,
 * drops none of it. The commands that format, link or insert decline in
 * these blocks, and a range that leaves one is removed so that another
 * block's rest joins as its Markdown ({@link $removeGuardedRange}); this
 * catches whatever still reaches the block. A block
 * that has come to stand in this block (no key puts one there) is no text of
 * it: it is moved out to follow it first.
 *
 * @param block - The raw block or code block.
 */
function $keepTextOnly(block: ElementNode): void {
    let run: LexicalNode[] = [];

    $moveBlocksOutAfter(block);

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
 * Whether a block holds the inline content a join into a raw block or code
 * block takes: a paragraph (a list item's text is one) or a heading.
 *
 * @param node - The node.
 * @returns `true` for such a block.
 */
function $isJoinableBlock(node: LexicalNode | null | undefined): node is ElementNode {
    return $isParagraphNode(node) || $isHeadingNode(node);
}

/**
 * The outermost node a block opens: the block, or the list item and list
 * it is the first child of, as far up as each is its parent's first child.
 * It climbs through list parts only and stops at any other parent, as
 * {@link $containerEndingBefore} stops at a root or shadow root (a `:::`
 * column is one): a block that opens a column has no previous sibling in it,
 * so it joins nothing that stands before the column.
 *
 * @param block - The block.
 * @returns The node whose previous sibling comes before the block.
 */
function $outermostOpenedBy(block: ElementNode): LexicalNode {
    let edge: LexicalNode = block;

    for (;;) {
        const parent = edge.getParent();
        const isFirst = edge.getPreviousSibling() === null;
        const inListPart = $isListItemNode(parent) || $isListNode(parent) || $isMarkdownQuoteNode(parent);
        const climbs = isFirst && inListPart;

        if (!climbs) {
            return edge;
        }

        edge = parent!;
    }
}

/**
 * The block of text a node starts with: the node, or the first item's text
 * of the list (and nested first item) it is.
 *
 * @param node - The node after a raw block or code block.
 * @returns That block, or the node when it is no list.
 */
function $firstTextBlockOf(node: LexicalNode | null): LexicalNode | null {
    let next = node;
    let isListPart = $isListNode(next) || $isListItemNode(next) || $isMarkdownQuoteNode(next);

    while (isListPart) {
        next = (next as ElementNode).getFirstChild();
        isListPart = $isListNode(next) || $isListItemNode(next) || $isMarkdownQuoteNode(next);
    }

    return next;
}

/**
 * The raw Markdown block or code block a collapsed caret at the start of a
 * paragraph, heading or list item's text would Backspace into, with
 * that block of text.
 *
 * @param selection - A collapsed range selection.
 * @returns The text-only block and the block, or `null` when the caret is
 *   not at the start of such a block right after a raw block or code block
 *   (the first item of a list right after one, for an item's text).
 */
function $textOnlyBlockBeforeBlockStart(selection: RangeSelection): [MarkdownRawBlockNode | CodeNode, ElementNode] | null {
    const anchor = selection.anchor;
    const block = $findMatchingParent(anchor.getNode(), $isJoinableBlock);
    const first = block?.getFirstDescendant() ?? null;
    const atStart = anchor.offset === 0 && (anchor.getNode().is(block) || anchor.getNode().is(first));
    const previous = block === null ? null : $outermostOpenedBy(block).getPreviousSibling();

    return block && atStart && $isTextOnlyBlock(previous) ? [previous, block] : null;
}

/**
 * The paragraph, heading or list item's text a collapsed caret at a
 * raw Markdown block's or code block's end would Delete into, with that
 * text-only block.
 *
 * @param selection - A collapsed range selection.
 * @returns The text-only block and the block, or `null` when the caret is
 *   not at the end of a raw block or code block right before such a block
 *   (before a list, its first item's text).
 */
function $blockAfterTextOnlyBlockEnd(selection: RangeSelection): [MarkdownRawBlockNode | CodeNode, ElementNode] | null {
    const block = $findMatchingParent(selection.anchor.getNode(), $isTextOnlyBlock);
    const next = $firstTextBlockOf(block?.getNextSibling() ?? null);

    return block && $isSelectionAtBlockEnd(block, selection) && $isJoinableBlock(next) ? [block, next] : null;
}

/**
 * The nodes of a block that follow a point in it, in document order: what
 * the point's node holds after the point, when the point is on an element,
 * and then what follows that node, and each node around it, up to the
 * block. The rest of a text node the point is inside is not among them.
 *
 * @remarks
 * A caret that no text node can take is a point on an element: on the block
 * itself, or on an inline element in it. Lexical puts one on a link after
 * an image that ends the link, so the end of a block is not always a point
 * on the block or in its last text.
 *
 * @param point - The point, in the block.
 * @param block - The block.
 * @returns The nodes after the point; empty when the point's node ends the block.
 */
function $nodesAfterPoint(point: PointType, block: ElementNode): LexicalNode[] {
    const pointNode = point.getNode();
    const after: LexicalNode[] = point.type === "element" && $isElementNode(pointNode) ? pointNode.getChildren().slice(point.offset) : [];
    let node: LexicalNode | null = pointNode;

    while (node !== null && !node.is(block)) {
        after.push(...node.getNextSiblings());
        node = node.getParent();
    }

    return after;
}

/**
 * Whether a selection's anchor sits at the very end of a block, as
 * `MarkdownRawBlockNode.isSelectionAtEnd` tells for a raw block: nothing of
 * the block follows it, whichever node of the block the anchor is a point
 * on or in ({@link $nodesAfterPoint}).
 *
 * @param block - The block.
 * @param selection - The selection.
 * @returns `true` at the end of the block's last line (or in an empty block).
 */
function $isSelectionAtBlockEnd(block: ElementNode, selection: RangeSelection): boolean {
    const anchor = selection.anchor;
    const node = anchor.getNode();
    const isInBlock = node.is(block) || block.isParentOf(node);
    // A point on an element has what the element holds after it among the nodes after it.
    const endsItsNode = anchor.type === "element" || anchor.offset === node.getTextContentSize();

    return isInBlock && endsItsNode && $nodesAfterPoint(anchor, block).length === 0;
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
 * Whether a node holds blocks rather than text: the root, a `:::` block or
 * one of its columns, a list, a list item, a quote, a table, a row or a cell.
 * It is told by what the node is, never by what it holds at the moment: a column
 * or a document that a deleted table left empty holds blocks all the same.
 *
 * @param node - The node.
 * @returns `true` for such a node.
 */
function $holdsBlocks(node: LexicalNode | null): node is ElementNode {
    // A column and a table cell are shadow roots.
    const isRegion = $isRootOrShadowRoot(node) || $isMarkdownBlockNode(node);
    const isListPart = $isListNode(node) || $isListItemNode(node) || $isMarkdownQuoteNode(node);
    const isTablePart = $isTableNode(node) || $isTableRowNode(node);

    return isRegion || isListPart || isTablePart;
}

/**
 * Whether a selection point stands on a node that holds blocks
 * ({@link $holdsBlocks}), between its children, rather than in a block of
 * text: where a deleted table leaves the caret, and where code can put a
 * point; no click does.
 *
 * @param point - The point.
 * @returns Whether it does.
 */
function $standsOnHolder(point: PointType): boolean {
    return point.type === "element" && $holdsBlocks(point.getNode());
}

/**
 * Whether a node is a block of text: a block that holds no blocks
 * ({@link $holdsBlocks}) — a paragraph, the text of a list item, a heading,
 * a code block or a raw block. These are the blocks a block type
 * and a list toggle act on.
 *
 * @param node - The node.
 * @returns `true` for such a block.
 */
function $isBlockOfText(node: LexicalNode | null): node is ElementNode {
    return $isElementNode(node) && !node.isInline() && !$holdsBlocks(node);
}

/**
 * Whether a node is a block a table cannot go into: a raw Markdown block or
 * a code block, which hold only text, or another table, whose cells hold no
 * table.
 *
 * @param node - The node.
 * @returns `true` for a `MarkdownRawBlockNode`, a `CodeNode` or a `TableNode`.
 */
function $holdsNoTable(node: LexicalNode): boolean {
    return $isTextOnlyBlock(node) || $isTableNode(node);
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
 * nodes are not read.
 *
 * @returns `true` for a table selection, and for a range selection whose
 *   anchor, focus or any selected node is inside a `TableCellNode`.
 */
function $selectionTouchesTableCell(): boolean {
    const isTableSelection = $isTableSelection($getSelection());

    return isTableSelection || $selectionTouches($isTableCellNode);
}

/**
 * Whether a block is what an item of a list of one kind opens with, as its
 * text or as a heading: the block a list toggle reads as the item, which is
 * the block source mode finds on the item's marker line. Any other block of
 * an item — a paragraph, quote or code block after its text, or a quote,
 * code block or raw block it opens with — is a block the item holds.
 *
 * @param block - The block.
 * @param type - The kind of list.
 * @returns `true` for the text or heading an item of such a list opens with.
 */
function $opensItemOfListType(block: ElementNode | null, type: ListType): boolean {
    const item = block === null ? null : block.getParent();
    const list = $isListItemNode(item) ? item.getParent() : null;
    const opensItem = block !== null && block.getPreviousSibling() === null;
    const readsAsItem = $isMarkdownListItemTextNode(block) || $isHeadingNode(block);

    return opensItem && readsAsItem && $isListNode(list) && list.getListType() === type;
}

/**
 * The blocks a range selection touches ({@link $blocksTouchedBy}), each
 * once, the last in the document first: an order in which changing one block
 * never moves a block still to be changed.
 *
 * @param selection - The selection.
 * @returns The blocks.
 */
function $touchedBlocksLastFirst(selection: RangeSelection): ElementNode[] {
    const byKey = new Map<NodeKey, ElementNode>();

    for (const block of $blocksTouchedBy(selection)) {
        byKey.set(block.getKey(), block);
    }

    return [...byKey.values()].sort((a, b) => (a.isBefore(b) ? 1 : -1));
}

/**
 * Takes a block out of every list it is in, with what follows it in its
 * item up to the item's first nested list ({@link $liftItemOut}). A block
 * that an item holds after its first block opens an item of its own first
 * ({@link $splitItemBefore}), so what leaves the list starts at the block.
 *
 * @param block - The block.
 * @returns The blocks now standing outside every list, the block (or the
 *   paragraph an item's text became) first; the block alone when it was in
 *   no list item.
 */
function $liftBlockOutOfLists(block: ElementNode): LexicalNode[] {
    const holder = block.getParent();

    if (!$isMarkdownListItemNode(holder)) {
        return [block];
    }

    const opensItem = block.getPreviousSibling() === null;
    const item = opensItem ? holder : $splitItemBefore(holder, block);

    return $liftItemOut(item);
}

/**
 * Makes each group of blocks standing outside every list one item of a list
 * of one kind, where it stands. Groups standing side by side are one run,
 * and a run's items go into one list ({@link $makeItemsOfRun}).
 *
 * @param groups - The groups, in document order; none is empty.
 * @param type - The kind of list.
 */
function $makeItemsOf(groups: LexicalNode[][], type: ListType): void {
    let run: LexicalNode[][] = [];

    for (const blocks of groups) {
        const before = run[run.length - 1];
        // Compared by key: a block a later lift wrote to is no longer the object its own lift returned.
        const standsApart = before !== undefined && !before[before.length - 1]!.is(blocks[0]!.getPreviousSibling());

        if (standsApart) {
            $makeItemsOfRun(run, type);
            run = [];
        }

        run.push(blocks);
    }

    $makeItemsOfRun(run, type);
}

/**
 * Makes the groups of one run the items of one list of a kind, where the
 * run stands: a list of that kind right before the run, which they are
 * appended to; else one right after it, which they are put at the start of;
 * else a new list. When lists of that kind stand both right before and
 * right after the run and write the same marker, the list after it is joined
 * into the list before it at once, not left for the list rule.
 *
 * @param run - The run's groups, in document order.
 * @param type - The kind of list.
 */
function $makeItemsOfRun(run: LexicalNode[][], type: ListType): void {
    const lastGroup = run[run.length - 1];

    if (lastGroup === undefined) {
        return;
    }

    const first = run[0]![0]!;
    const above = first.getPreviousSibling();
    const below = lastGroup[lastGroup.length - 1]!.getNextSibling();
    const joinsAbove = $isListNode(above) && above.getListType() === type;
    const joinsBelow = $isListNode(below) && below.getListType() === type;
    const list = joinsAbove ? above : joinsBelow ? below : $createListNode(type);

    if (!joinsAbove && !joinsBelow) {
        first.insertBefore(list);
    }

    // `below` is joined into `above` below when their markers match; a loose one makes the whole list loose.
    const meetsLoose = joinsAbove && joinsBelow && $getState(below, listLooseState) && $writtenListMarker(below) === $writtenListMarker(above);

    if (meetsLoose) {
        $setState(above, listLooseState, true);
    }

    list.splice(joinsAbove ? list.getChildrenSize() : 0, 0, run.map($itemOfBlocks));

    // The list rule would join `below` into `above` in its own time; a toggle over many blocks would leave it a list for each.
    const joinsBoth = joinsAbove && joinsBelow && $writtenListMarker(below) === $writtenListMarker(above);

    if (joinsBoth) {
        above.splice(above.getChildrenSize(), 0, below.getChildren());
        $removeUnwalked(below);
    }
}

/**
 * Makes one list item of blocks standing outside every list: the first
 * block gives the item its text, the others are the blocks the item holds.
 *
 * @param blocks - The blocks, in document order, the first one a block of text.
 * @returns The item, in no list yet.
 */
function $itemOfBlocks(blocks: LexicalNode[]): LexicalNode {
    const [first, ...rest] = blocks;
    const item = $createListItemNode();
    const text = $createMarkdownListItemTextNode();

    item.append(text, ...rest);

    if ($isElementNode(first)) {
        text.splice(0, 0, first.getChildren());
        // A caret in an empty block is held on the block itself, which goes.
        $movePointsBetween(first, text);
        first.remove();
    }

    return item;
}

/**
 * Toggles a list of one kind over the blocks a selection touches. Where
 * every block opens an item of such a list ({@link $opensItemOfListType})
 * the toggle is off: each item leaves its lists ({@link $liftBlockOutOfLists})
 * and what it opened with is a paragraph. Otherwise it is on: each block
 * that does not open such an item yet leaves the lists it is in the same
 * way, and what left with it becomes one item of such a list
 * ({@link $makeItemsOf}).
 *
 * @param selection - The selection.
 * @param type - The kind of list.
 */
function $toggleListOfTouchedBlocks(selection: RangeSelection, type: ListType): void {
    const blocks = $touchedBlocksLastFirst(selection);
    const isOff = blocks.every((block) => $opensItemOfListType(block, type));
    const changed = blocks.filter((block) => isOff || !$opensItemOfListType(block, type));
    // Lifted last first; `reverse` then puts the groups in document order.
    const lifted = changed.map($liftBlockOutOfLists).reverse();

    if (!isOff) {
        $makeItemsOf(lifted, type);

        return;
    }

    for (const [first] of lifted) {
        // An item's text is a paragraph once it is out; a heading the item opened with becomes one.
        if ($isHeadingNode(first)) {
            first.replace($createParagraphNode(), true);
        }
    }
}

/**
 * The child of a block-holding node that holds a node, at any depth.
 *
 * @param holder - The node the child belongs to; an ancestor of `node`.
 * @param node - The node.
 * @returns The child of `holder` that is `node` or an ancestor of it.
 */
function $childHolding(holder: ElementNode, node: LexicalNode): LexicalNode {
    let child: LexicalNode = node;

    while (!holder.is(child.getParent())) {
        child = child.getParentOrThrow();
    }

    return child;
}

/**
 * Groups children of one quote into runs of siblings that stand side by side.
 *
 * @param children - The children, in document order.
 * @returns The runs, in document order.
 */
function runsOfSiblings(children: readonly LexicalNode[]): LexicalNode[][] {
    const runs: LexicalNode[][] = [];

    for (const child of children) {
        const run = runs[runs.length - 1];

        if (run !== undefined && run[run.length - 1]!.getNextSibling()?.is(child) === true) {
            run.push(child);
        } else {
            runs.push([child]);
        }
    }

    return runs;
}

/**
 * Takes the blocks a quote toggle touches out of their quotes, each out of
 * its nearest quote only, one level out: for each nearest quote, the children
 * that hold a touched block leave that quote ({@link $liftOutOfQuote}), each
 * run of them side by side at once, the quote split around it. A child that
 * holds only blocks of a nested quote stays where it is, so a block that left
 * the nested quote does not leave the outer one with it. The last quote in
 * the document goes first, and its last run first, so a lift never moves a run
 * still to be lifted.
 *
 * @param blocks - The touched blocks, each standing in a quote.
 */
function $liftBlocksOutOfQuotes(blocks: readonly ElementNode[]): void {
    const childrenByQuote = new Map<NodeKey, Map<NodeKey, LexicalNode>>();

    for (const block of blocks) {
        const quote = $nearestQuoteOf(block)!;
        const child = $childHolding(quote, block);
        const children = childrenByQuote.get(quote.getKey()) ?? new Map<NodeKey, LexicalNode>();

        children.set(child.getKey(), child);
        childrenByQuote.set(quote.getKey(), children);
    }

    const inDocumentOrder = (nodes: Iterable<LexicalNode>): LexicalNode[] => [...nodes].sort((x, y) => (x.isBefore(y) ? -1 : 1));
    const quotes = [...childrenByQuote.values()].map((children) => inDocumentOrder(children.values()));

    quotes.sort((x, y) => (x[0]!.isBefore(y[0]!) ? 1 : -1)).forEach((children) => {
        // Runs are read when their quote's turn comes: a lift of a nested quote's blocks puts them among these children.
        const live = children.filter((child) => child.isAttached());

        runsOfSiblings(live).reverse().forEach((run) => {
            $liftOutOfQuote(run[0]!, run[run.length - 1]!);
        });
    });
}

/**
 * Puts one run of blocks standing side by side into a quote, where the run
 * stands: a quote right before the run, which the blocks are appended to;
 * else one right after it, which they are put at the start of; else a new
 * quote. When quotes stand both before and after the run, the one after it
 * is joined into the one before it.
 *
 * @param run - The blocks, in document order, each the next sibling of the one before.
 */
function $makeQuoteOfRun(run: LexicalNode[]): void {
    const above = run[0]!.getPreviousSibling();
    const below = run[run.length - 1]!.getNextSibling();

    if ($isMarkdownQuoteNode(above)) {
        above.splice(above.getChildrenSize(), 0, run);

        if ($isMarkdownQuoteNode(below)) {
            above.splice(above.getChildrenSize(), 0, below.getChildren());
            below.remove();
        }

        return;
    }

    const quote = $isMarkdownQuoteNode(below) ? below : $createMarkdownQuoteNode();

    if (quote !== below) {
        run[0]!.insertBefore(quote);
    }

    quote.splice(0, 0, run);
}

/**
 * Puts the blocks a quote toggle touches into quotes: every touched block
 * that stands in no quote goes into one, a list item's text leaving its
 * lists first ({@link $liftItemOut}). Each run of such blocks standing side
 * by side goes into one quote ({@link $makeQuoteOfRun}).
 *
 * @param blocks - The touched blocks.
 */
function $putBlocksIntoQuotes(blocks: readonly ElementNode[]): void {
    const targets = blocks.filter((block) => $nearestQuoteOf(block) === null).map((block) => {
        const item = block.getParent();

        return $isMarkdownListItemTextNode(block) && $isMarkdownListItemNode(item) ? $liftItemOut(item)[0]! : block;
    });

    let run: LexicalNode[] = [];

    for (const target of targets.sort((a, b) => (a.isBefore(b) ? -1 : 1))) {
        const isBesideRun = run.length > 0 && run[run.length - 1]!.is(target.getPreviousSibling());

        if (!isBesideRun && run.length > 0) {
            $makeQuoteOfRun(run);
            run = [];
        }

        run.push(target);
    }

    if (run.length > 0) {
        $makeQuoteOfRun(run);
    }
}

/**
 * Toggles a quote over the blocks a selection touches. Where every block
 * stands in a quote the toggle is off: the blocks leave their nearest
 * quotes, one level out ({@link $liftBlocksOutOfQuotes}). Otherwise it is on:
 * each block that stands in no quote goes into one
 * ({@link $putBlocksIntoQuotes}).
 *
 * @param selection - The selection, its ends already in blocks of text.
 */
function $toggleQuoteOfTouchedBlocks(selection: RangeSelection): void {
    const blocks = $touchedBlocksLastFirst(selection);
    const isOff = blocks.length > 0 && blocks.every((block) => $nearestQuoteOf(block) !== null);

    if (isOff) {
        $liftBlocksOutOfQuotes(blocks);
    } else {
        $putBlocksIntoQuotes(blocks);
    }
}

/**
 * The blocks of text ({@link $isBlockOfText}) a range selection touches:
 * those holding its two ends and every selected leaf, and an empty one it
 * covers. A node that holds blocks ({@link $holdsBlocks}) is never one of
 * them, whatever it holds: a list item is no block of its own — its text
 * and the other blocks it holds are — and a column a deleted table left
 * empty is passed over by a range that covers it, as is a table an end
 * stands on.
 *
 * @param selection - The selection.
 * @returns The blocks, one entry per end and leaf, so a block can repeat.
 */
function $blocksTouchedBy(selection: RangeSelection): ElementNode[] {
    const leaves = selection.getNodes().filter((node) => !$isElementNode(node) || node.isInline() || node.isEmpty());

    return [selection.anchor.getNode(), selection.focus.getNode(), ...leaves].map($findEnclosingBlock).filter($isBlockOfText);
}

/**
 * Whether every block the selection touches ({@link $blocksTouchedBy}) is
 * already of a block type, so that converting them to it would only replace
 * each by an equal one — and would write a heading or a code block in the
 * standard form where it was written in another, dropping a code block's
 * language.
 *
 * @param type - The block type asked for.
 * @returns `false` when some block is of another type; for a selection with
 *   an end on a node that holds blocks ({@link $standsOnHolder}), whose
 *   blocks are known once its ends are settled
 *   ({@link $settleEndsIntoBlocksOfText}); and for a selection that is not a
 *   range.
 */
function $selectedBlocksHaveType(type: MarkdownBlockType): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    const isSettled = !$standsOnHolder(selection.anchor) && !$standsOnHolder(selection.focus);

    // A heading's type is its level; a paragraph and a code block are named as their nodes are.
    return isSettled && $blocksTouchedBy(selection).every((block) => ($isHeadingNode(block) ? block.getTag() : block.getType()) === type);
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
 * {@link $selectionCoversSourceRun} rules out for a range over that content.
 * An empty cell, and one holding an image alone, takes none.
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
 * The update tag of an update Lexical makes while it handles input that
 * types text ({@link registerTypedTextMarks}). The Markdown typing shortcuts
 * are applied by typing alone
 * ({@link registerMarkdownShortcutsOutsideRawBlocks}).
 */
const TYPED_TEXT_TAG = "markdown-typed-text";

/**
 * The `inputType`s of the input events that type text: a character from the
 * keyboard, an input method or dictation (`insertText`), text being composed
 * and its commit (`insertCompositionText`, and `insertFromComposition`, which
 * Safari sends), and a replacement the browser makes for what was typed —
 * autocorrect, a text substitution, a picked spelling
 * (`insertReplacementText`). A paste, a drop, a yank and every deletion have
 * other types.
 */
const TYPING_INPUT_TYPES: ReadonlySet<string> = new Set([
    "insertText", "insertCompositionText", "insertFromComposition", "insertReplacementText",
]);

/**
 * How long a typed `beforeinput` that Lexical left to the browser is awaited
 * for its `input` event: until the task it was handled in has ended, which
 * is what a timer of no delay gives.
 */
const END_OF_TASK_DELAY_MS = 0;

/** What {@link registerTypedTextMarks} returns. */
interface TypedTextMarks {
    /** Removes the listeners. */
    unregister:    () => void;

    /** Whether an update that carries these tags typed text. */
    isTypedUpdate: (tags: ReadonlySet<string>) => boolean;
}

/**
 * Whether what a text-insertion command carries is typed text. Lexical
 * hands a typed character over as a string, and a composition's commit, a
 * text replacement, a drop and a yank as their input event.
 *
 * @param payload - The command's payload.
 * @returns Whether it is typed text.
 */
function isTypedPayload(payload: InputEvent | string): boolean {
    return typeof payload === "string" || TYPING_INPUT_TYPES.has(payload.inputType);
}

/**
 * Marks the updates that type text, for the Markdown typing shortcuts
 * ({@link registerMarkdownShortcutsOutsideRawBlocks}): a shortcut is applied
 * by typing, never by a removal, a paste, a drop, an undo, a command or a
 * change of the text with no input behind it.
 *
 * @remarks
 * Typed text reaches Lexical by three commands, and each tags its update
 * {@link TYPED_TEXT_TAG} when its input types text
 * ({@link TYPING_INPUT_TYPES}): `BEFORE_INPUT_COMMAND` and `INPUT_COMMAND`,
 * which carry the browser's input event, and
 * `CONTROLLED_TEXT_INSERTION_COMMAND`, by which Lexical inserts the text
 * itself. The end of a composition has Lexical's own `COMPOSITION_END_TAG`,
 * and counts as typing. The first two listeners are at
 * {@link COMMAND_PRIORITY_CRITICAL}, ahead of Lexical's own handlers, which
 * end their commands. The third is at {@link COMMAND_PRIORITY_EDITOR}, the
 * priority of `registerRichText`'s handler that inserts the text: call this
 * before `registerRichText`, so that the tag is set in the update that holds
 * the text. A command dispatched outside an update runs each priority's
 * listeners in an update of their own, and a tag set at a higher priority
 * would be lost with that update when it changes nothing. A read-only editor
 * refuses these commands ahead of all three listeners
 * ({@link registerReadOnlyGuard}), so none of them runs for a refused edit.
 *
 * A browser may put a typed character in by itself, and Lexical may read it
 * off the DOM in an update with no command — before the `input` event's
 * command, where another listener runs ahead of Lexical's. So a
 * `beforeinput` of typed text that Lexical left to the browser (it is not
 * prevented) makes every update typed while its `input` event is awaited.
 * That wait never outlives the event it is for. It ends at the `input`
 * command, at the next `beforeinput` command, at the end of the task in
 * which the `beforeinput` was handled (a browser fires the `input` event in
 * that task, and Lexical's mutation observer reads the text in a microtask
 * of it), when the editor's editability changes, and when the listeners are
 * removed. A `beforeinput` whose `input` event never reaches the editor,
 * such as one a read-only editor refuses, makes no later update typed.
 *
 * Known limit: the end of a composition counts as typing whatever the
 * composition did. One that is cancelled or emptied right behind
 * shortcut-shaped text, or that ends by removing text, applies the shortcut,
 * as it does without this function.
 *
 * @param editor - The editor.
 * @returns The unregister function and the test of an update's tags.
 */
function registerTypedTextMarks(editor: LexicalEditor): TypedTextMarks {
    // The `beforeinput` of typed text seen last, until its `input` event arrives or the wait ends otherwise.
    let awaited: InputEvent | null = null;
    let awaitedTimer: TimerId | null = null;

    const endWait = (): void => {
        if (awaitedTimer !== null) {
            DOM.sink.clearTimeout(awaitedTimer);
        }

        awaited = null;
        awaitedTimer = null;
    };

    const startWait = (event: InputEvent): void => {
        awaited = event;
        awaitedTimer = DOM.sink.setTimeout(endWait, END_OF_TASK_DELAY_MS);
    };

    const tagWhenTyping = (isTyping: boolean): void => {
        if (isTyping) {
            $addUpdateTag(TYPED_TEXT_TAG);
        }
    };

    const unregister = mergeRegister(
        editor.registerCommand(BEFORE_INPUT_COMMAND, (event) => {
            const isTyping = TYPING_INPUT_TYPES.has(event.inputType);

            endWait();

            if (isTyping) {
                startWait(event);
            }

            tagWhenTyping(isTyping);

            return false;
        }, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(INPUT_COMMAND, (event) => {
            endWait();
            tagWhenTyping(TYPING_INPUT_TYPES.has(event.inputType));

            return false;
        }, COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(CONTROLLED_TEXT_INSERTION_COMMAND, (payload) => {
            tagWhenTyping(isTypedPayload(payload));

            return false;
        }, COMMAND_PRIORITY_EDITOR),
        editor.registerEditableListener(endWait),
        endWait,
    );

    const isTypedUpdate = (tags: ReadonlySet<string>): boolean => {
        const isAwaited = awaited !== null && !awaited.defaultPrevented;

        return tags.has(TYPED_TEXT_TAG) || tags.has(COMPOSITION_END_TAG) || isAwaited;
    };

    return { unregister, isTypedUpdate };
}

/**
 * Registers the Markdown typing shortcuts everywhere except inside a raw
 * Markdown block, whose text is saved as Markdown: a shortcut there would turn
 * typed syntax into formatting the block does not save. A shortcut is
 * applied by typing alone: an update that removes, cuts, pastes or drops
 * completes none, however the text before the caret reads when it ends.
 *
 * @remarks
 * `registerMarkdownShortcuts` takes any update that leaves a collapsed
 * caret in changed text, at most one character further on than it was, for
 * a typed character. A Backspace is such an update, and so is the removal
 * of a range: `a \*x\*.b` with the `.` removed read as a typed `*x*` and
 * went italic, as an update of its own. So its update listener is handed an
 * update only when the update typed text (`isTypedUpdate`). Its Enter
 * listener is left as it is: Enter is a key press.
 *
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
 * The block shortcuts of a quote's paragraphs and headings and of a list
 * item's further ones are applied by {@link registerHeldBlockShortcuts}, which
 * Lexical's registration leaves out: it applies a block shortcut only to a
 * block whose parent is the document or a shadow root. It is registered
 * through the same proxy, so it too is applied by typing alone and never in a
 * raw block.
 *
 * @param editor - The editor.
 * @param isTypedUpdate - Whether an update that carries the given tags typed text ({@link registerTypedTextMarks}).
 * @returns The unregister function.
 */
function registerMarkdownShortcutsOutsideRawBlocks(editor: LexicalEditor, isTypedUpdate: (tags: ReadonlySet<string>) => boolean): () => void {
    const registerUpdateListener = (listener: UpdateListener): (() => void) =>
        editor.registerUpdateListener((payload) => {
            const isTyped = isTypedUpdate(payload.tags);

            if (!isTyped) {
                return;
            }

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

    return mergeRegister(registerMarkdownShortcuts(guarded, SHORTCUT_TRANSFORMERS), registerHeldBlockShortcuts(guarded));
}

/** The block shortcuts of {@link SHORTCUT_TRANSFORMERS} that fit one line: `# `, `> `, `- `, `1. `. */
const ELEMENT_SHORTCUTS: readonly ElementTransformer[] = SHORTCUT_TRANSFORMERS.filter((shortcut): shortcut is ElementTransformer => shortcut.type === "element");

/** The block shortcuts of {@link SHORTCUT_TRANSFORMERS} that span lines: the code fence. */
const MULTILINE_SHORTCUTS: readonly MultilineElementTransformer[] = SHORTCUT_TRANSFORMERS
    .filter((shortcut): shortcut is MultilineElementTransformer => shortcut.type === "multiline-element");

/**
 * Splits the marker a block shortcut matched off the start of a block's
 * text, as Lexical's own shortcut code does.
 *
 * @param anchor - The text node the caret is in, the first child of its block.
 * @param offset - The caret's offset in it, the end of the marker.
 * @returns The marker's node, and the nodes after it: the rest of the block.
 */
function $splitOffShortcutMarker(anchor: TextNode, offset: number): { marker: TextNode; rest: LexicalNode[] } {
    const nextSiblings = anchor.getNextSiblings();
    const [marker, remainder] = anchor.splitText(offset);

    return { marker: marker!, rest: remainder ? [remainder, ...nextSiblings] : nextSiblings };
}

/**
 * Applies the first one-line block shortcut that the text before the caret
 * is the marker of: Lexical's `runElementTransformers` with the parent check
 * left out.
 *
 * @param block - The paragraph or heading the caret is in.
 * @param anchor - The text node the caret is in, the first child of the block.
 * @param offset - The caret's offset in it.
 * @param onEnter - Whether Enter triggered the shortcut; only a shortcut that fires on Enter is then tried.
 * @returns Whether a shortcut was applied.
 */
function $applyElementShortcut(block: ElementNode, anchor: TextNode, offset: number, onEnter: boolean): boolean {
    const text = anchor.getTextContent();

    for (const shortcut of ELEMENT_SHORTCUTS.filter((candidate) => !onEnter || candidate.triggerOnEnter)) {
        const match = text.match(shortcut.regExp);
        const expectedLength = onEnter || match?.[0].endsWith(" ") ? offset : offset - 1;

        if (match !== null && match[0].length === expectedLength) {
            const { marker, rest } = $splitOffShortcutMarker(anchor, offset);

            if (shortcut.replace(block, rest, match, false) !== false) {
                marker.remove();

                return true;
            }
        }
    }

    return false;
}

/**
 * Applies the first multi-line block shortcut that the text before the caret
 * opens and that needs no closing line: Lexical's
 * `runMultilineElementTransformers` with the parent check left out.
 *
 * @param block - The paragraph or heading the caret is in.
 * @param anchor - The text node the caret is in, the first child of the block.
 * @param offset - The caret's offset in it.
 * @param onEnter - Whether Enter triggered the shortcut.
 * @returns Whether a shortcut was applied.
 */
function $applyMultilineShortcut(block: ElementNode, anchor: TextNode, offset: number, onEnter: boolean): boolean {
    const text = anchor.getTextContent();

    for (const shortcut of MULTILINE_SHORTCUTS) {
        const end = shortcut.regExpEnd;
        const needsClosingLine = end !== undefined && !("optional" in end && end.optional);
        const match = needsClosingLine ? null : text.match(shortcut.regExpStart);
        const expectedLength = onEnter || match?.[0].endsWith(" ") ? offset : offset - 1;

        if (match !== null && match[0].length === expectedLength) {
            const { marker, rest } = $splitOffShortcutMarker(anchor, offset);

            if (shortcut.replace(block, rest, match, null, null, false) !== false) {
                marker.remove();

                return true;
            }
        }
    }

    return false;
}

/**
 * Applies the block shortcut whose marker the text before the caret is, in a
 * paragraph or heading that a quote or a list item holds
 * ({@link $isHeldBlockTakingText}): what Lexical's registration does for a
 * block of the document, with the check of the block's parent replaced. The
 * order is Lexical's: one-line shortcuts, then the code fence on typing; the
 * code fence, then the one-line shortcuts that fire on Enter, on Enter.
 *
 * @param block - The block the caret is in.
 * @param anchor - The text node the caret is in.
 * @param offset - The caret's offset in it.
 * @param onEnter - Whether Enter triggered the shortcut; otherwise the character typed was.
 * @returns Whether a shortcut was applied.
 */
function $runHeldBlockShortcut(block: LexicalNode, anchor: TextNode, offset: number, onEnter: boolean): boolean {
    const isFirstText = $isHeldBlockTakingText(block) && block.getFirstChild()?.is(anchor) === true;
    const endsInSpace = anchor.getTextContent()[offset - 1] === " ";

    if (!isFirstText || !(onEnter || endsInSpace)) {
        return false;
    }

    return onEnter
        ? $applyMultilineShortcut(block, anchor, offset, true) || $applyElementShortcut(block, anchor, offset, true)
        : $applyElementShortcut(block, anchor, offset, false) || $applyMultilineShortcut(block, anchor, offset, false);
}

/**
 * Registers the block typing shortcuts in the paragraphs and headings that a
 * quote or a list item holds, on the two paths Lexical's
 * `registerMarkdownShortcuts` uses: the update after a typed character (or a
 * composition's end), and Enter at the end of the text. The conditions and
 * update tags are Lexical's; the parent check is the one difference, so the
 * two never both apply.
 *
 * @param editor - The editor, or its proxy that keeps raw blocks out and edits writably.
 * @returns The unregister function.
 */
function registerHeldBlockShortcuts(editor: LexicalEditor): () => void {
    return mergeRegister(
        editor.registerUpdateListener(({ tags, dirtyLeaves, editorState, prevEditorState }) => {
            if (tags.has(COLLABORATION_TAG) || tags.has(HISTORIC_TAG) || editor.isComposing()) {
                return;
            }

            const isCompositionEnd = tags.has(COMPOSITION_END_TAG);
            const selection = editorState.read($getSelection);
            const previous = prevEditorState.read($getSelection);

            // A collapsed caret that moved, as the user types, or one a composition ended on.
            if (!$isRangeSelection(previous) || !$isRangeSelection(selection) || !selection.isCollapsed() || (selection.is(previous) && !isCompositionEnd)) {
                return;
            }

            const key = selection.anchor.key;
            const offset = selection.anchor.offset;
            const node = editorState._nodeMap.get(key);
            // At most one character further on than before: a typed character, not a jump.
            const isTypedStep = isCompositionEnd || offset === 1 || offset <= previous.anchor.offset + 1;

            if (!$isTextNode(node) || !dirtyLeaves.has(key) || !isTypedStep) {
                return;
            }

            // Looked at in the committed state first, so a character typed anywhere else starts no update.
            const isInHeldBlock = editorState.read(() => $isHeldBlockTakingText(node.getParent()));

            if (!isInHeldBlock) {
                return;
            }

            editor.update(() => {
                const anchor = $getNodeByKey(key);
                const block = $isTextNode(anchor) && !anchor.hasFormat("code") ? anchor.getParent() : null;

                if ($isTextNode(anchor) && block !== null && $runHeldBlockShortcut(block, anchor, offset, false)) {
                    $addUpdateTag(HISTORY_PUSH_TAG);
                }
            });
        }),
        editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
            const selection = $getSelection();
            const isShifted = event?.shiftKey ?? false;

            if (isShifted || !$isRangeSelection(selection) || !selection.isCollapsed()) {
                return false;
            }

            const anchor = selection.anchor.getNode();
            const offset = selection.anchor.offset;
            const block = $isTextNode(anchor) && !anchor.hasFormat("code") && offset === anchor.getTextContentSize() ? anchor.getParent() : null;
            const applied = $isTextNode(anchor) && block !== null && $runHeldBlockShortcut(block, anchor, offset, true);

            if (applied) {
                event?.preventDefault();
            }

            return applied;
        }, COMMAND_PRIORITY_LOW),
    );
}

/**
 * Registers the paste handler that turns pasted `:::` columns into the
 * blocks they hold ({@link $pasteColumnsAsTheirBlocks}).
 *
 * @remarks
 * A command's listeners of one priority run in the order they were
 * registered, and this one is at {@link COMMAND_PRIORITY_HIGH}. Call this
 * before {@link registerTextOnlyBlockRules}, so that
 * {@link $pasteIntoTextOnlyBlock} and every paste handler after it see a
 * column's blocks, never the column.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerColumnPaste(editor: LexicalEditor): () => void {
    return editor.registerCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, $pasteColumnsAsTheirBlocks, COMMAND_PRIORITY_HIGH);
}

/**
 * Registers the paste handler that wraps table rows and cells pasted
 * without their table in a table ({@link $pasteTableRowsAndCellsAsTables}).
 *
 * @remarks
 * A command's listeners of one priority run in the order they were
 * registered, and this one is at {@link COMMAND_PRIORITY_HIGH}. Call this
 * before {@link registerHeldBlockPaste} and
 * {@link registerTextOnlyBlockRules}, so that every paste handler that
 * decides where pasted blocks go sees a table, never a row or cell without
 * one. It is called after {@link registerColumnPaste}, as that function
 * asks of every paste handler; no result depends on the order of those
 * two, since no copy holds a column together with a row or cell.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerTablePartPaste(editor: LexicalEditor): () => void {
    return editor.registerCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, $pasteTableRowsAndCellsAsTables, COMMAND_PRIORITY_HIGH);
}

/**
 * Listener of the three backward deletions (`DELETE_CHARACTER_COMMAND`,
 * `DELETE_WORD_COMMAND`, `DELETE_LINE_COMMAND`) for a caret at the start of
 * a block that stands after a container ending in a block with no line of
 * text of its own. That is one of three places: right after a `:::` block;
 * right after a list whose last item ends in a table or a `:::` block; and,
 * inside a list item, after a `:::` block of that item. It does what the
 * key does right after a table: a block that holds something stays where it
 * is and nothing is joined; an empty block is removed, and the caret goes
 * to the end of what stands before it — the table's last cell, or the last
 * block of the `:::` block's last column — where what is typed next is
 * shown and saved.
 *
 * @remarks
 * Lexical (0.49.0) looks for the block before the caret's by walking back
 * into the elements it meets. It walks into a list, a list item or a `:::`
 * block, which are no blocks of text, takes that as a block to join, and
 * stops at the table or the column. Its removal then joins nothing and
 * leaves the caret on the list item or the `:::` block, where what is typed
 * next is shown and not saved.
 *
 * @param isBackward - Whether the deletion goes backward.
 * @returns Whether the caret stood at such a place.
 */
function $backspaceAfterContainer(isBackward: boolean): boolean {
    const selection = $getSelection();
    const isCaret = isBackward && $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.offset === 0;
    const anchorNode = isCaret ? selection.anchor.getNode() : null;
    const block = anchorNode === null ? null : $findEnclosingBlock(anchorNode);
    const first = block?.getFirstDescendant() ?? null;
    const isAtBlockStart = block !== null && anchorNode !== null && (anchorNode.is(block) || anchorNode.is(first));

    if (!$isRangeSelection(selection) || block === null || !isAtBlockStart) {
        return false;
    }

    const ending = $containerEndingBefore(block);

    if (ending === null) {
        return false;
    }

    const isEmptyBlock = block.isEmpty();

    if (isEmptyBlock) {
        const caret = $normalizeCaret($getChildCaret(ending, "previous"));

        $setPointFromCaret(selection.anchor, caret);
        $setPointFromCaret(selection.focus, caret);
        block.remove();
    }

    return true;
}

/**
 * The table or `:::` column that ends the container standing before a
 * block: the block before it, or before the nearest container it opens, is
 * a `:::` block, or a list whose last item ends in a table or a `:::`
 * block.
 *
 * @param block - The block.
 * @returns That table or column, or `null` when no such container stands before the block.
 */
function $containerEndingBefore(block: ElementNode): ElementNode | null {
    // What stands before the block: the block before it, or before the nearest container it opens.
    let opened: ElementNode = block;
    let before = opened.getPreviousSibling();

    while (before === null) {
        const container = opened.getParent();
        const isOutermost = container === null || $isRootOrShadowRoot(container);

        if (container === null || isOutermost) {
            return null;
        }

        opened = container;
        before = opened.getPreviousSibling();
    }

    let entersContainer = false;

    while ($isListNode(before) || $isMarkdownListItemNode(before) || $isMarkdownBlockNode(before) || $isMarkdownQuoteNode(before)) {
        entersContainer = true;
        before = before.getLastChild();
    }

    const endsWithoutTextLine = entersContainer && $isElementNode(before) && !INTERNAL_$isBlock(before);

    return endsWithoutTextLine && $isElementNode(before) ? before : null;
}

/**
 * `INSERT_PARAGRAPH_COMMAND` listener for Enter on an empty line of a list:
 * a list item's text that holds nothing, or blanks alone. The item leaves
 * the list, whatever else it holds: a nested item moves out one level, with
 * what it holds; a top-level one is taken out of its list
 * ({@link $liftItemOut}), its text an empty paragraph. Enter over a range
 * that starts in an item's text is taken here too when blocks are in play
 * — the item held some, or the removal brings some under the text — since
 * the range can empty the text: it is removed first, as Lexical's own
 * insert removes it. A range over items of text alone is left to Lexical,
 * which leaves the emptied item and adds one, as in any list.
 * One emptied text is no empty line: over a paragraph, which is the item's
 * text once the edit is done. The caret goes to that paragraph's start and
 * nothing else changes.
 *
 * @remarks
 * `@lexical/list` keeps its rule for Enter in an empty item in a listener
 * of this command as well, and for the same reason: the hook Lexical calls
 * to split a block (`insertNewAfter`) is also what every newline of pasted
 * plain text and the split before pasted blocks go through, and those must
 * split the item, not end the list.
 *
 * @returns Whether the caret stood on such a line; otherwise `false`, so Lexical splits the item at the caret.
 */
function $enterLeavesListAtBlankItemText(): boolean {
    const selection = $getSelection();
    const startBlock = $isRangeSelection(selection) ? $findEnclosingBlock($orderedPoints(selection)[0].getNode()) : null;

    if (!$isRangeSelection(selection) || !$isMarkdownListItemTextNode(startBlock)) {
        return false;
    }

    const coversRange = !selection.isCollapsed();
    const heldBlocks = startBlock.getNextSibling() !== null;

    if (coversRange) {
        selection.removeText();
    }

    const text = $findEnclosingBlock(selection.anchor.getNode());
    const item = text?.getParent();

    if (!$isMarkdownListItemTextNode(text) || !$isMarkdownListItemNode(item)) {
        return false;
    }

    // A range over items of text alone is Lexical's to split: it leaves the emptied item and adds one, as in any list.
    const isPlainRange = coversRange && !heldBlocks && text.getNextSibling() === null;

    if (isPlainRange) {
        return false;
    }

    const following = text.getNextSibling();
    const opensOverParagraph = text.isEmpty() && !$isMarkdownListItemTextNode(following) && $isParagraphNode(following);

    if (opensOverParagraph) {
        following.selectStart();

        return true;
    }

    // Blank text counts as none, as in Lexical's own rule for an empty item.
    const isBlank = text.getChildren().every((child) => $isTextNode(child) && child.getTextContent().trim() === "");
    const outdented = isBlank && $outdentItem(item);

    if (isBlank && !outdented) {
        $liftItemOut(item);
    }

    return isBlank;
}

/**
 * `INDENT_CONTENT_COMMAND` and `OUTDENT_CONTENT_COMMAND` listener. Every
 * selected list item moves one level; a block that is no list item is left
 * as it is, since Lexical's own handler would give it an indent no save
 * writes. Where a range holds the text of a list item and the text of an
 * item nested in it, the outer item is moved, and what it holds goes with
 * it; the nested item is not moved a second time for itself.
 *
 * @remarks
 * Lexical moves every selected block one level, in document order, reading
 * each block's depth when its turn comes. An item's nested list is a child
 * of the item here, so a nested item has already moved with the outer one by
 * then, and would end a level too deep, or too shallow, under it. An outer
 * item that cannot move — a top-level item, on an outdent — carries nothing,
 * so the items nested in it move for themselves.
 *
 * @param isIndent - Whether the items move a level in; `false` for a level out.
 * @returns `true`: the command is handled here for every selection.
 */
function $moveSelectedItemsOnce(isIndent: boolean): boolean {
    const carried = $itemBlocksCarriedAlong(isIndent);

    $handleIndentAndOutdent((block) => {
        const indent = block.getIndent();
        // Only a list item has a depth: any other block would take an indent no save writes.
        const opensItem = $isMarkdownListItemTextNode(block) || $isListItemNode(block);
        const movesItself = opensItem && !carried.has(block.getKey());

        if (movesItself && isIndent) {
            block.setIndent(indent + 1);
        } else if (movesItself && indent > 0) {
            block.setIndent(indent - 1);
        }
    });

    return true;
}

/**
 * The selected list items that an indent or outdent must not move for
 * themselves, because a selected item around them moves and takes them
 * along. Each is given as the block Lexical moves it through: its text, or
 * the item itself when it opens with a block.
 *
 * @param isIndent - Whether the items move a level in; `false` for a level out, which a top-level item cannot.
 * @returns The keys of those blocks.
 */
function $itemBlocksCarriedAlong(isIndent: boolean): Set<NodeKey> {
    const selection = $getSelection();
    const selected = $isRangeSelection(selection) ? selection.getNodes() : [];
    const blockOfItem = new Map<NodeKey, NodeKey>();

    for (const node of selected) {
        const text = $findMatchingParent(node, $isMarkdownListItemTextNode);
        const item = text === null ? node : text.getParent();
        // An item that opens with a block is among the selected nodes itself, and is the block Lexical moves.
        const isMoved = $isMarkdownListItemNode(item) && (text !== null || item.canIndent());

        if (isMoved) {
            blockOfItem.set(item.getKey(), (text ?? item).getKey());
        }
    }

    const carried = new Set<NodeKey>();

    for (const [itemKey, blockKey] of blockOfItem) {
        let outer: LexicalNode | null = $getNodeByKey(itemKey)?.getParent()?.getParent() ?? null;

        while ($isMarkdownListItemNode(outer)) {
            const carries = blockOfItem.has(outer.getKey()) && (isIndent || outer.getIndent() > 0);

            if (carries) {
                carried.add(blockKey);
            }

            outer = outer.getParent()?.getParent() ?? null;
        }
    }

    return carried;
}

/**
 * Registers the rules for what a method of the list item's nodes cannot
 * decide, because Lexical's own handler does: a backward deletion at the
 * start of a block after a `:::` block, after a list whose last item ends
 * in a table or a `:::` block, or after a `:::` block of a list item
 * ({@link $backspaceAfterContainer}), at {@link COMMAND_PRIORITY_LOW} so
 * every other listener of those commands runs first; Enter on an empty line
 * of a list
 * ({@link $enterLeavesListAtBlankItemText}); and an indent or outdent, which
 * moves list items only ({@link $moveSelectedItemsOnce}).
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerListItemRules(editor: LexicalEditor): () => void {
    return mergeRegister(
        ...[DELETE_CHARACTER_COMMAND, DELETE_WORD_COMMAND, DELETE_LINE_COMMAND]
            .map((command) => editor.registerCommand(command, $backspaceAfterContainer, COMMAND_PRIORITY_LOW)),
        editor.registerCommand(INSERT_PARAGRAPH_COMMAND, $enterLeavesListAtBlankItemText, COMMAND_PRIORITY_HIGH),
        editor.registerCommand(INDENT_CONTENT_COMMAND, () => $moveSelectedItemsOnce(true), COMMAND_PRIORITY_HIGH),
        editor.registerCommand(OUTDENT_CONTENT_COMMAND, () => $moveSelectedItemsOnce(false), COMMAND_PRIORITY_HIGH),
    );
}

/**
 * `INSERT_PARAGRAPH_COMMAND` listener: Enter on an empty or blank paragraph
 * of a quote takes that paragraph out of the quote, one level out, the quote
 * split around it and a quote left empty gone. In a nested quote the
 * paragraph goes to the outer quote.
 *
 * @remarks
 * Lexical's own routine splits the paragraph and keeps both halves in the
 * quote, so the exit is the editor's, as it is for an empty list item
 * ({@link $enterLeavesListAtBlankItemText}). CommonMark has no empty
 * paragraph, so one left in a quote would save as nothing and vanish on
 * reload.
 *
 * @returns Whether the caret stood on such a paragraph; otherwise `false`, so Lexical splits the paragraph at the caret.
 */
function $enterLeavesQuoteAtBlankParagraph(): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return false;
    }

    const block = $findEnclosingBlock(selection.anchor.getNode());
    const quote = block?.getParent() ?? null;
    // The negative guard comes first: TypeScript narrows `$isParagraphNode(x) && !$isMarkdownListItemTextNode(x)` to never.
    const isPlainParagraph = !$isMarkdownListItemTextNode(block) && $isParagraphNode(block);

    if (!isPlainParagraph || !$isMarkdownQuoteNode(quote)) {
        return false;
    }

    // Blank text counts as none, as in the list rule.
    const isBlank = block.getChildren().every((child) => $isTextNode(child) && child.getTextContent().trim() === "");

    if (!isBlank) {
        return false;
    }

    $liftOutOfQuote(block, block);
    block.selectStart();

    return true;
}

/**
 * `KEY_BACKSPACE_COMMAND` listener: at the start of a quote's first block,
 * where no list item stands nearer, that block leaves the quote, one level
 * out (the quote's `collapseAtStart`).
 *
 * @remarks
 * `@lexical/list` walks from the caret up to an item and outdents it, past
 * any quote between them, so this listener runs ahead of its own and stops
 * at the nearer of the two: `- > a` gives `- a`, and `> - a` gives `> a`.
 *
 * @param event - The key event, or `null`.
 * @returns Whether the caret stood at the start of a quote's first block.
 */
function $backspaceLiftsOutOfQuote(event: KeyboardEvent | null): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.offset !== 0) {
        return false;
    }

    // The walk `registerList`'s own listener makes, stopped at the first quote or list item.
    let current: LexicalNode = selection.anchor.getNode();

    while (!$isMarkdownQuoteNode(current) && !$isListItemNode(current)) {
        const parent = current.getParent();

        if (current.getPreviousSibling() !== null || parent === null || $isRootOrShadowRoot(parent)) {
            return false;
        }

        current = parent;
    }

    if (!$isMarkdownQuoteNode(current)) {
        return false;
    }

    current.collapseAtStart();
    event?.preventDefault();

    return true;
}

/**
 * Registers the two quote rules for what Lexical's own handlers decide:
 * Enter on a blank paragraph ({@link $enterLeavesQuoteAtBlankParagraph}) and
 * the Backspace key at a quote's start ({@link $backspaceLiftsOutOfQuote}).
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerQuoteRules(editor: LexicalEditor): () => void {
    return mergeRegister(
        editor.registerCommand(INSERT_PARAGRAPH_COMMAND, $enterLeavesQuoteAtBlankParagraph, COMMAND_PRIORITY_HIGH),
        // Ahead of registerList's listener, which would walk past the quote to an item around it.
        editor.registerCommand(KEY_BACKSPACE_COMMAND, $backspaceLiftsOutOfQuote, COMMAND_PRIORITY_LOW),
    );
}

/**
 * Registers the paste handler that puts blocks pasted into a paragraph or
 * heading of a list item, or of a quote, into that item or quote
 * ({@link $pasteBlocksIntoHeldBlock}).
 *
 * @remarks
 * A command's listeners of one priority run in the order they were
 * registered, and this one is at {@link COMMAND_PRIORITY_HIGH}. Call this
 * after {@link registerColumnPaste}, so that a pasted column is already the
 * blocks it holds, and after {@link registerTablePartPaste}, so that pasted
 * table rows and cells are already a table.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerHeldBlockPaste(editor: LexicalEditor): () => void {
    return editor.registerCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, $pasteBlocksIntoHeldBlock, COMMAND_PRIORITY_HIGH);
}

/**
 * Registers the paste listener that keeps the text after the caret of a
 * list item's text out of a pasted table or `:::` block
 * ({@link $splitItemBeforePasteEndingInTableOrFence}).
 *
 * @remarks
 * A command's listeners of one priority run in the order they were
 * registered, and this one is at {@link COMMAND_PRIORITY_HIGH}. Call this
 * after {@link registerHeldBlockPaste} and
 * {@link registerTextOnlyBlockRules}, whose handlers take a paste whole, so
 * that this listener runs only for a paste Lexical's own insert is about to
 * make. It removes a selected range that starts in an item's text; run
 * ahead of {@link $pasteIntoTextOnlyBlock}, that would take from it a range
 * selected backwards from the start of a code block into an item's text,
 * which it reads by the range's anchor.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerItemTextPaste(editor: LexicalEditor): () => void {
    return editor.registerCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, $splitItemBeforePasteEndingInTableOrFence, COMMAND_PRIORITY_HIGH);
}

/**
 * Registers what keeps a raw Markdown block and a code block holding text
 * only: Enter inside a raw block, a paste into either, a delete at a
 * collapsed caret joining another block to either, and the transform
 * turning anything else that reaches them into its Markdown. A range that
 * leaves either is removed by the range guards
 * ({@link registerRangeGuards}), ahead of the paste and delete listeners
 * here; Enter, a key no guard listens to, removes one itself through the
 * same removal ({@link $removeRangeBeforeEnter}).
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
 * `KEY_ENTER_COMMAND` listener that settles the selection's points
 * ({@link $settleSelectionOffContainers}) before Enter's own handlers read
 * them: Enter in a raw block ({@link $handleRawBlockEnter}) reads the range
 * before any guard of the paragraph command does.
 *
 * @returns Always `false`, so Enter's own handlers run.
 */
function $settleSelectionBeforeEnter(): boolean {
    $settleSelectionOffContainers($getSelection());

    return false;
}

/**
 * Registers the guards for the four range shapes Lexical's own removal
 * mishandles — a table-edge range ({@link $isTableEdgeRange}), a
 * text-only-edge range ({@link $isTextOnlyEdgeRange}), a stale-focus
 * range ({@link $isStaleFocusRange}) and a cross-item range
 * ({@link $isCrossItemRange}) — on every command that removes or
 * replaces a range: each removes such a range itself, ahead of the
 * command's own handler. `DELETE_CHARACTER_COMMAND` has a listener of its
 * own ({@link $deleteCharacterOverGuardedRange}); the other three delete
 * commands share {@link $deleteGuardedRange}. `COPY_COMMAND`, which removes nothing, has one for
 * a table-edge range too, so a copy copies what a cut removes.
 *
 * @remarks
 * Each command has one listener that removes, and each removes the range
 * through {@link $removeGuardedRange}, which takes the shapes in one order.
 * The `guard` wrapper settles the selection's points
 * ({@link $settleSelectionOffContainers}) before each listener runs, and
 * `KEY_ENTER_COMMAND`, whose handler for a raw block reads the range too,
 * has a listener of its own that does the same
 * ({@link $settleSelectionBeforeEnter}): every listener after it reads a
 * range whose ends are in text where they can be. The paragraph-break, Tab,
 * clipboard-insert and line-break guards also remove a range that starts
 * just before a list ahead of Lexical's insert, so the insert comes where
 * the range was ({@link $clearGuardedRangeBeforeParagraph},
 * {@link $removeGuardedRangeForInsert}, {@link $clearGuardedRangeBeforeLineBreak}).
 * The listeners that remove are at {@link COMMAND_PRIORITY_CRITICAL}, ahead of
 * every handler that removes the range and of `@lexical/table`'s own
 * Backspace and Delete handlers, so none depends on the order this is
 * called in with {@link registerTextOnlyBlockRules}, whose listeners are at
 * {@link COMMAND_PRIORITY_HIGH} and meet a caret. The copy guard alone is
 * at HIGH, ahead of Lexical's own copy but behind the CRITICAL listener
 * `copyToClipboard` registers for the copy event it has the browser fire
 * when it is given none: that event is the same copy, already under way.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerRangeGuards(editor: LexicalEditor): () => void {
    const guard = <P>(command: LexicalCommand<P>, listener: CommandListener<P>): (() => void) =>
        editor.registerCommand(command, (payload, target) => {
            $settleSelectionOffContainers($getSelection());

            return listener(payload, target);
        }, COMMAND_PRIORITY_CRITICAL);

    return mergeRegister(
        editor.registerCommand(KEY_ENTER_COMMAND, $settleSelectionBeforeEnter, COMMAND_PRIORITY_CRITICAL),
        guard(KEY_BACKSPACE_COMMAND, $backspaceOverTableEdgeRange),
        guard(KEY_DELETE_COMMAND, $deleteKeyOverTableEdgeRange),
        guard(DELETE_CHARACTER_COMMAND, $deleteCharacterOverGuardedRange),
        guard(DELETE_WORD_COMMAND, $deleteGuardedRange),
        guard(DELETE_LINE_COMMAND, $deleteGuardedRange),
        guard(REMOVE_TEXT_COMMAND, $deleteGuardedRange),
        guard(INSERT_PARAGRAPH_COMMAND, $clearGuardedRangeBeforeParagraph),
        guard(INSERT_LINE_BREAK_COMMAND, $clearGuardedRangeBeforeLineBreak),
        guard(INSERT_TAB_COMMAND, $clearGuardedRangeBeforeInsert),
        guard(PASTE_COMMAND, $clearGuardedRangeBeforePastedText),
        guard(CONTROLLED_TEXT_INSERTION_COMMAND, $clearGuardedRangeBeforeTyping),
        guard(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, $clearGuardedRangeBeforePaste),
        guard(CUT_COMMAND, $cutGuardedRange),
        editor.registerCommand(COPY_COMMAND, $copyTableEdgeRange, COMMAND_PRIORITY_HIGH),
    );
}

/**
 * The right-click context this plan's menu builds around a resolved Lexical
 * node: a table cell or ordinary text/prose (both carrying the current
 * selection's inline-format state, so the format toggles can show a
 * checkmark on active formats — a table cell holds inline text too, so it
 * gets the same toggles as plain prose, alongside its row/column/table
 * commands), or an empty paragraph outside any table. Each carries the
 * {@link CommandAvailability} of the current selection.
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
          availability: CommandAvailability;
      }
    | { kind: "empty-line"; hasSelectedText: boolean; availability: CommandAvailability }
    | {
          kind: "text";
          hasSelectedText: boolean;
          bold: boolean; italic: boolean; strikethrough: boolean; code: boolean; underline: boolean;
          hasEnclosingBlock?: boolean;
          linkUrl?: string | null;
          availability: CommandAvailability;
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
 * Which of the editor's commands would apply at the current selection: each
 * field is `false` where the commands it covers would do nothing. The
 * context menu dims the items of an unavailable command, and
 * {@link MarkdownEditorSelectionState} reports the fields a toolbar needs
 * under the same names.
 *
 * @remarks Exported (not part of the public `MarkdownEditor` callable)
 * because the exported {@link ContextMenuTarget} carries it.
 */
export interface CommandAvailability {
    /** `toggleBold`, `toggleItalic`, `toggleUnderline`, `toggleStrikethrough` and `toggleInlineCode`. */
    canFormat: boolean;
    /** `setTextColor`, `setFontFamily` and `setFontSize`. */
    canStyle: boolean;
    /** `toggleLink` with a URL: Insert link… and Edit link…. */
    canLink: boolean;
    /** `removeLink`. */
    canRemoveLink: boolean;
    /** `clearFormatting`. */
    canClearFormatting: boolean;
    /** `setBlockType`, `toggleUnorderedList` and `toggleOrderedList`. */
    canSetBlockType: boolean;
    /** `setBlockAlignment` and `setColumnCount`. */
    canSetBlockLayout: boolean;
    /** `insertParagraphBeforeBlock` and `insertParagraphAfterBlock`. */
    canInsertParagraphAroundBlock: boolean;
    /** `insertTable`. */
    canInsertTable: boolean;
    /** `insertImage`. */
    canInsertImage: boolean;
    /**
     * The commands acting on the table the caret is in: the row and column
     * inserts and deletes, `deleteTable`, `setTableColumnAlignment` and
     * `setTableColumnWidth`.
     */
    canEditTable: boolean;
    /** `mergeTableCells`. */
    canMergeCells: boolean;
    /** `unmergeTableCell`. */
    canUnmergeCell: boolean;
}

/**
 * `$insertNodeToNearestRootAtCaret`'s test for splitting the block at the
 * caret: never. Its split then still happens where both halves would hold
 * content, and is skipped where one half would be empty, so no empty quote,
 * heading or list item is left beside the inserted node.
 *
 * @returns Always `false`.
 */
function $makesNoEmptyHalf(): boolean {
    return false;
}

/**
 * Inserts a block at a caret, splitting the blocks around the caret up to the
 * nearest quote, or to the document or a shadow root where no quote stands
 * nearer, each only where the caret is inside its content
 * ({@link $makesNoEmptyHalf}).
 *
 * @remarks
 * Lexical's own insert splits every ancestor up to the root or a shadow
 * root, which splits a quote in two around the block. A quote holds the
 * block, so this stops at the quote; with no quote, or a shadow root (a
 * column or a table cell) between the caret and the quote, it is Lexical's.
 *
 * @param node - The block to insert.
 * @param caret - Where it goes.
 */
function $insertBlockToNearestHolderAtCaret(node: LexicalNode, caret: PointCaret<CaretDirection>): void {
    const anchor = caret.origin;
    // An element point on a quote itself is in that quote; `$nearestQuoteOf` starts at the parent.
    const quote = $isMarkdownQuoteNode(anchor) ? anchor : $nearestQuoteOf(anchor);
    const region = $findMatchingParent(anchor, $isRootOrShadowRoot);
    const isRegionNearer = quote === null || (region !== null && quote.isParentOf(region));

    if (isRegionNearer) {
        $insertNodeToNearestRootAtCaret(node, caret, { $shouldSplit: $makesNoEmptyHalf });

        return;
    }

    // The same boundary normalisation of a text point caret as Lexical's insert makes.
    let insertCaret = $getCaretInDirection(caret, "next");

    if ($isTextPointCaret(insertCaret)) {
        if (insertCaret.offset === 0) {
            insertCaret = $getSiblingCaret(insertCaret.origin, "previous").getFlipped();
        } else if (insertCaret.offset === insertCaret.origin.getTextContentSize()) {
            insertCaret = $getSiblingCaret(insertCaret.origin, "next");
        }
    }

    const parentOf = (at: PointCaret<CaretDirection>): LexicalNode | null => ($isChildCaret(at) ? at.origin : at.origin.getParent());

    while (!quote.is(parentOf(insertCaret))) {
        const next = $splitAtPointCaretNext(insertCaret, { $shouldSplit: $makesNoEmptyHalf });

        if (next === null) {
            break;
        }

        insertCaret = next;
    }

    insertCaret.insert(node);
}

/**
 * Inserts a table at a selection point, after splitting the block holding
 * it only where the point is inside its content ({@link $makesNoEmptyHalf}).
 * A table that ends its container gets an empty paragraph after it, which
 * saves nothing and lets the caret go below the table. The caret lands in
 * the table's first cell.
 *
 * @param point - Where the table goes.
 * @param rows - The number of rows, including the header row.
 * @param columns - The number of columns.
 */
function $insertTableAt(point: PointType, rows: number, columns: number): void {
    const table = $createTableNodeWithDimensions(rows, columns, { rows: true, columns: false });

    $insertBlockToNearestHolderAtCaret(table, $caretFromPoint(point, "next"));

    const endsContainer = table.getNextSibling() === null;

    if (endsContainer) {
        table.insertAfter($createParagraphNode());
    }

    table.selectStart();
}

/**
 * The node `insertTable` and `insertImage` insert at when there is no range
 * selection: both then put a caret at the document's end, so it is the
 * document's last node.
 *
 * @returns The last descendant of the root, or the root of an empty document.
 */
function $documentEndNode(): LexicalNode {
    return $getRoot().getLastDescendant() ?? $getRoot();
}

/**
 * Whether `insertTable` or `insertImage` would insert into a raw Markdown
 * block or a code block, which hold only text, so both decline: the range
 * selection touches one, or there is no range selection and the document
 * ends in one, which is where the insert would then go.
 *
 * @param touchesTextOnlyBlock - What {@link $selectionTouchesTextOnlyBlock}
 *   gives for the current selection, passed in so a caller that has already
 *   read it does not walk the selection a second time.
 * @returns `true` when the insert would land in a text-only block.
 */
function $insertTouchesTextOnlyBlock(touchesTextOnlyBlock: boolean): boolean {
    const selection = $getSelection();

    return $isRangeSelection(selection)
        ? touchesTextOnlyBlock
        : $findMatchingParent($documentEndNode(), $isTextOnlyBlock) !== null;
}

/**
 * Whether a table `insertTable` adds would land inside another table, whose
 * cells hold no table in this dialect. A table-edge range
 * ({@link $isTableEdgeRange}) never does: `insertTable` removes it first,
 * the table it reaches into included, and keeps the caret that leaves out of
 * any other table. Any other range selection has both its ends in one table
 * or both outside every table, so the table it would go into is the one
 * holding its anchor. With no range selection the insert goes to the
 * document's end.
 *
 * @returns `true` when the insert position is inside a table.
 */
function $tableInsertWouldNest(): boolean {
    const selection = $getSelection();
    const isTableEdge = $isTableEdgeRange(selection);

    if (isTableEdge) {
        return false;
    }

    const node = $isRangeSelection(selection) ? selection.anchor.getNode() : $documentEndNode();

    return $findTableHolding(node) !== null;
}

/**
 * Whether `insertImage` would insert at the current selection: what
 * `canInsertImage` reports, and the test the command itself declines on
 * before it touches the selection.
 *
 * @param touchesTextOnlyBlock - What {@link $selectionTouchesTextOnlyBlock}
 *   gives for the current selection.
 * @returns `false` where the image would land in a raw Markdown block or a
 *   code block.
 */
function $imageInsertApplies(touchesTextOnlyBlock: boolean): boolean {
    return !$insertTouchesTextOnlyBlock(touchesTextOnlyBlock);
}

/**
 * Whether `insertTable` would insert at the current selection: what
 * `canInsertTable` reports, and the test the command itself declines on
 * before it touches the selection.
 *
 * @param touchesTextOnlyBlock - What {@link $selectionTouchesTextOnlyBlock}
 *   gives for the current selection.
 * @returns `false` where the table would land in a raw Markdown block, a
 *   code block or another table.
 */
function $tableInsertApplies(touchesTextOnlyBlock: boolean): boolean {
    return !$insertTouchesTextOnlyBlock(touchesTextOnlyBlock) && !$tableInsertWouldNest();
}

/**
 * The format `clearFormatting` leaves on a text node: none of the inline
 * formats, except those the node's own source writes — a run of a link
 * nested in a link, or of a construct kept as written, keeps them.
 *
 * @param node - The text node.
 * @returns The format bitmask the node has once cleared.
 */
function $formatOnceCleared(node: TextNode): number {
    const kept = $getState(node, keptSourceState);
    const written = !$isMarkdownSourceTextNode(node) ? 0 : kept !== null ? kept.writes : Math.max(0, $getState(node, nestedLinkState));

    return node.getFormat() & (~IS_ALL_FORMATTING | written);
}

/**
 * Whether a table selection has a cell the format toggles would format.
 * They format the selected cells one at a time and leave out a cell that
 * takes no format; this asks {@link $cellTakesFormat}, the test the toggles
 * themselves pick the cells by, so the two cannot disagree about a cell.
 *
 * @param selection - The table selection.
 * @returns `true` when at least one selected cell takes the format.
 */
function $someCellTakesFormat(selection: TableSelection): boolean {
    return selection.getNodes().filter($isTableCellNode).some($cellTakesFormat);
}

/**
 * Whether a range selection holds text: at least one character of a text
 * node lies inside it. A range from the end of one block to the start of the
 * next holds none (what Shift+Right selects at a line's end), nor does one
 * over an image or a line break alone, nor a collapsed one.
 *
 * @remarks
 * Judged on a copy of the selection whose points are moved into the text
 * they sit beside ({@link $moveBlockPointsIntoText}). A point on a block
 * itself, which a programmatic selection can hold, names the same place as
 * one at the edge of the text next to it; left as it is, a range between
 * the two forms of one place would count that whole text node as selected.
 *
 * @param selection - The selection, left as it is.
 * @returns `true` when the selection covers a character.
 */
function $rangeHoldsText(selection: RangeSelection): boolean {
    const judged = selection.clone();

    $moveBlockPointsIntoText(judged);

    return [...$selectedSlices(judged).values()].some(([from, to]) => to > from);
}

/**
 * Moves each point of a range selection that sits on an element, between
 * its children, to the same place named as a point in text, where there is
 * text beside it: the end of the text before it, or the start of the text
 * it opens on. A point with no text beside it stays where it is. The
 * browser's selection always arrives in this form; only a selection made in
 * code holds the other.
 *
 * @param selection - The selection whose points are moved.
 */
function $moveBlockPointsIntoText(selection: RangeSelection): void {
    for (const point of [selection.anchor, selection.focus]) {
        if (point.type === "element") {
            $setPointFromCaret(point, $normalizeCaret($caretFromPoint(point, "next")));
        }
    }
}

/**
 * Moves each end of a range selection into a block of text
 * ({@link $isBlockOfText}), so that a command acting on the blocks the
 * selection touches ({@link $blocksTouchedBy}) finds one for each end. An
 * end in text, or on a block of text, stays in its block. An end on a node
 * that holds blocks ({@link $holdsBlocks}) is where a deleted table leaves
 * the caret, and where code can put a point; no click does. An end of a
 * range goes inward from there, so that no block outside the range is
 * touched ({@link $settleRangeEndsInward}). A caret, and a range that holds
 * no block of text, settles beside the point it starts at
 * ({@link $settleCaretIntoBlockOfText}). Each end is then named as a point
 * in text where its block has text ({@link $moveBlockPointsIntoText}), so a
 * range from one block's end to the next one's start takes both blocks
 * however its points were held.
 *
 * @param selection - A selection the block commands are available for
 *   (`canSetBlockType`); its points are moved.
 */
function $settleEndsIntoBlocksOfText(selection: RangeSelection): void {
    const isCollapsed = selection.isCollapsed();
    const holdsBlock = !isCollapsed && $settleRangeEndsInward(selection);

    if (!holdsBlock) {
        const [start, end] = $orderedPoints(selection);

        $settleCaretIntoBlockOfText(start);
        end.set(start.key, start.offset, start.type);
    }

    $moveBlockPointsIntoText(selection);
}

/**
 * Moves the ends of a range that stand on a node that holds blocks into the
 * range: its start to the start of the first block of text at or after it,
 * its end to the end of the last block of text at or before it, in document
 * order ({@link $blockOfRangeEnd}). The blocks the range touches are then
 * the blocks of text between its ends and no other. A range with no block
 * of text between its ends is left as it is.
 *
 * @param selection - A range that is no caret; its points are moved.
 * @returns Whether the range holds a block of text.
 */
function $settleRangeEndsInward(selection: RangeSelection): boolean {
    const [start, end] = $orderedPoints(selection);
    const first = $blockOfRangeEnd(start, "next");
    const last = $blockOfRangeEnd(end, "previous");
    const holdsBlock = first !== null && last !== null && !last.isBefore(first);

    if (!holdsBlock) {
        return false;
    }

    const startsOnHolder = $standsOnHolder(start);
    const endsOnHolder = $standsOnHolder(end);

    if (startsOnHolder) {
        $setPointFromCaret(start, $normalizeCaret($getChildCaret(first, "next")));
    }

    if (endsOnHolder) {
        $setPointFromCaret(end, $normalizeCaret($getChildCaret(last, "previous")));
    }

    return true;
}

/**
 * The block of text one end of a range belongs to: the block that holds
 * it; or, for an end on a node that holds blocks, the first block of text
 * that follows the point in document order (`"next"`, for the range's
 * start) or the last one before it (`"previous"`, for its end)
 * ({@link $blockOfTextPast}). An end that stands on a document or a column
 * a deleted table left empty stands in it: the holder gets an empty
 * paragraph, which is the block ({@link $fillEmptyHolder}).
 *
 * @param point - The end.
 * @param direction - `"next"` for the range's start, `"previous"` for its end.
 * @returns The block, or `null` when the document has none on that side.
 */
function $blockOfRangeEnd(point: PointType, direction: CaretDirection): ElementNode | null {
    const node = point.getNode();
    const isOnHolder = $standsOnHolder(point) && $isElementNode(node);

    if (!isOnHolder) {
        return $findEnclosingBlock(node);
    }

    const [holder, offset] = $holderPointOffTable(node, point.offset, direction);

    return $fillEmptyHolder(holder) ?? $blockOfTextPast(holder, offset, direction);
}

/**
 * The first block of text past a point on a node that holds blocks, in
 * document order: among the holder's children on that side, each searched
 * through ({@link $blockOfTextIn}); then past the holder itself, in the
 * node that holds it, and so on up to the root.
 *
 * @param holder - The node the point stands on.
 * @param offset - The point's offset: the index of the child after it.
 * @param direction - `"next"` to look forward, `"previous"` to look back.
 * @returns The block, or `null` when the document has none on that side.
 */
function $blockOfTextPast(holder: ElementNode, offset: number, direction: CaretDirection): ElementNode | null {
    const children = holder.getChildren();
    const ahead = direction === "next" ? children.slice(offset) : children.slice(0, offset).reverse();
    const found = $firstBlockOfTextIn(ahead, direction);
    const parent = holder.getParent();

    if (found !== null || parent === null) {
        return found;
    }

    const index = holder.getIndexWithinParent();

    return $blockOfTextPast(parent, direction === "next" ? index + 1 : index, direction);
}

/**
 * The first block of text in a node, in document order (the last one,
 * looking back): the node itself when it is one, else the first found in
 * its children. A table has none to offer, since its cells hold text only,
 * and neither has a column a deleted table left empty: a range passes over
 * both.
 *
 * @param node - The node.
 * @param direction - `"next"` for the first block, `"previous"` for the last.
 * @returns The block, or `null`.
 */
function $blockOfTextIn(node: LexicalNode, direction: CaretDirection): ElementNode | null {
    if ($isBlockOfText(node)) {
        return node;
    }

    const isSearched = $holdsBlocks(node) && !$isTableNode(node);

    if (!isSearched) {
        return null;
    }

    const children = node.getChildren();

    return $firstBlockOfTextIn(direction === "next" ? children : children.reverse(), direction);
}

/**
 * The first block of text found in a list of nodes, each searched through
 * in turn ({@link $blockOfTextIn}).
 *
 * @param nodes - The nodes, in the order to search them.
 * @param direction - `"next"` when that order is document order, `"previous"` when it is its reverse.
 * @returns The block, or `null`.
 */
function $firstBlockOfTextIn(nodes: readonly LexicalNode[], direction: CaretDirection): ElementNode | null {
    for (const node of nodes) {
        const found = $blockOfTextIn(node, direction);

        if (found !== null) {
            return found;
        }
    }

    return null;
}

/**
 * Moves a caret off a node that holds blocks, into a block of text beside
 * it: the block after it ({@link $blockBeside}), else the one before it,
 * else a new empty paragraph ({@link $newParagraphBeside}). A table is no
 * block to go into, since its cells hold text only: the way to either side
 * stops at one, and a point on a table or one of its rows is first taken
 * off the table ({@link $holderPointOffTable}). A column a deleted table
 * left empty is a place to go into: it gets an empty paragraph, as does the
 * document or the column the caret itself stands on when that is empty
 * ({@link $fillEmptyHolder}). A point in text, or on a block of text, is
 * left alone.
 *
 * @param point - The caret's point; moved.
 */
function $settleCaretIntoBlockOfText(point: PointType): void {
    const node = point.getNode();
    const isOnHolder = $standsOnHolder(point) && $isElementNode(node);

    if (!isOnHolder) {
        return;
    }

    const [holder, offset] = $holderPointOffTable(node, point.offset, "next");
    const after = $blockBeside(holder, offset, "next");
    const before = $blockBeside(holder, offset, "previous");
    const goesAfter = $takesCaret(after);
    const goesBefore = !goesAfter && $takesCaret(before);
    const place = goesAfter ? after : goesBefore ? before : null;
    const own = $fillEmptyHolder(holder);
    const block = own ?? (place === null ? $newParagraphBeside(after, before) : $blockOfTextAt(place));

    $setPointFromCaret(point, $normalizeCaret($getChildCaret(block, goesBefore ? "previous" : "next")));
}

/**
 * The same place as a point on a table, a row or a cell, named on the node
 * that holds the table: the point after the table for one that looks
 * forward, the point before the table for one that looks back. Where the
 * block commands are available the selection covers no cell, so its start
 * can only stand at a table's end and its end at a table's start. Any
 * other point is returned as it is.
 *
 * @param node - The node the point stands on.
 * @param offset - The point's offset.
 * @param direction - `"next"` for a point that looks forward (a range's start, a caret), `"previous"` for one that looks back.
 * @returns The node holding blocks the point is named on, and its offset there.
 */
function $holderPointOffTable(node: ElementNode, offset: number, direction: CaretDirection): [ElementNode, number] {
    const table = $findMatchingParent(node, $isTableNode);

    if (table === null) {
        return [node, offset];
    }

    const index = table.getIndexWithinParent();

    return [table.getParentOrThrow(), direction === "next" ? index + 1 : index];
}

/**
 * What a point on a node that holds blocks has on one side: the child
 * there, or, for a child that holds blocks itself, its first block (its
 * last, looking back), and so on down. The way down stops at a table, and
 * at a node that holds nothing: a `:::` column a deleted table left empty.
 * Nothing is changed.
 *
 * @param holder - The node the point stands on.
 * @param offset - The point's offset: the index of the child after it.
 * @param direction - `"next"` for the side after the point, `"previous"` for the side before it.
 * @returns A block of text ({@link $isBlockOfText}); or the table or the
 *   empty column the way down met; or `null` when that side has no child.
 */
function $blockBeside(holder: ElementNode, offset: number, direction: CaretDirection): LexicalNode | null {
    let node = holder.getChildAtIndex(direction === "next" ? offset : offset - 1);
    let inner = $blockBelow(node, direction);

    while (inner !== null) {
        node = inner;
        inner = $blockBelow(node, direction);
    }

    return node;
}

/**
 * The next node on the way down from a node ({@link $blockBeside}): the
 * first child (the last, looking back) of a node that holds blocks and is
 * no table.
 *
 * @param node - The node the way down has reached.
 * @param direction - `"next"` for the first child, `"previous"` for the last.
 * @returns The child; `null` where the way down ends: at a block of text,
 *   a table, or a node that holds nothing.
 */
function $blockBelow(node: LexicalNode | null, direction: CaretDirection): LexicalNode | null {
    const goesDown = $holdsBlocks(node) && !$isTableNode(node);

    if (!goesDown) {
        return null;
    }

    return direction === "next" ? node.getFirstChild() : node.getLastChild();
}

/**
 * Whether a caret can go into what it has on one side ({@link $blockBeside}):
 * a block of text, or a column a deleted table left empty, which gets a
 * paragraph for it ({@link $blockOfTextAt}).
 *
 * @param place - What the side has.
 * @returns `true` for a block of text and for an empty column.
 */
function $takesCaret(place: LexicalNode | null): place is ElementNode {
    const isEmptyColumn = $isElementNode(place) && $isRootOrShadowRoot(place) && place.isEmpty();

    return $isBlockOfText(place) || isEmptyColumn;
}

/**
 * The block of text a caret goes into at a place that takes it
 * ({@link $takesCaret}): the block itself, or the empty paragraph an empty
 * column is given for it ({@link $fillEmptyHolder}).
 *
 * @param place - A block of text or an empty column.
 * @returns The block of text.
 */
function $blockOfTextAt(place: ElementNode): ElementNode {
    return $fillEmptyHolder(place) ?? place;
}

/**
 * Gives a document or a `:::` column that holds nothing — what a deleted
 * table leaves of one that held nothing else — an empty paragraph, since
 * neither can stay empty once the caret is in it. Any other node is left
 * alone.
 *
 * @param holder - The node.
 * @returns The new paragraph, or `null` when nothing was added.
 */
function $fillEmptyHolder(holder: ElementNode): ParagraphNode | null {
    const isEmptyHolder = $isRootOrShadowRoot(holder) && holder.isEmpty();

    if (!isEmptyHolder) {
        return null;
    }

    const paragraph = $createParagraphNode();

    holder.append(paragraph);

    return paragraph;
}

/**
 * Makes the empty paragraph a caret goes into when it stands on a node that
 * holds blocks and has no place to go into on either side
 * ({@link $takesCaret}): right before what stands after it, else right
 * after what stands before it. That is a table, or a table inside the node
 * on that side. {@link $settleCaretIntoBlock} makes the same paragraph for
 * an insert.
 *
 * @param after - What the caret has after it ({@link $blockBeside}), or `null`.
 * @param before - What it has before it, or `null`; one of the two is a node.
 * @returns The paragraph, in the document.
 */
function $newParagraphBeside(after: LexicalNode | null, before: LexicalNode | null): ParagraphNode {
    const paragraph = $createParagraphNode();

    if (after !== null) {
        after.insertBefore(paragraph);
    } else {
        before?.insertAfter(paragraph);
    }

    return paragraph;
}

/**
 * Whether a selection point stands on a table or one of its rows, between
 * its rows or cells.
 *
 * @param point - The point.
 * @returns Whether it does.
 */
function $standsOnTableOrRow(point: PointType): boolean {
    const node = point.getNode();

    return point.type === "element" && ($isTableNode(node) || $isTableRowNode(node));
}

/**
 * Whether a range selection names no block of text for a block type or a
 * list toggle to act on: both of its ends stand on a table or one of its
 * rows ({@link $standsOnTableOrRow}), and no block of text lies between
 * them. Such a selection — a caret code put between two rows, say — is in a
 * table as much as one in a cell is.
 *
 * @returns `true` for such a selection; `false` for one that is not a range.
 */
function $selectionStandsOnTablesAlone(): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    const standsOnTables = $standsOnTableOrRow(selection.anchor) && $standsOnTableOrRow(selection.focus);

    return standsOnTables && $blocksTouchedBy(selection).length === 0;
}

/**
 * Whether a link put on a range selection would have something to hold.
 * A caret links the word or formatted run it would widen to
 * ({@link $computeWordExpansion}), as the format toggles format it, and
 * inside a link it re-points that link; with neither it has nothing to
 * link. A range needs text or an image, which a link wraps as it wraps
 * text; a range holding no more than a line break or the gap between two
 * blocks has neither.
 *
 * @param selection - The selection.
 * @param expansion - The word or run a collapsed caret would widen to, or
 *   `null` when there is none.
 * @param inLink - Whether the selection's anchor sits inside a link.
 * @returns `true` when `toggleLink` with a URL would make or re-point a link.
 */
function $selectionHoldsLinkable(selection: RangeSelection, expansion: WordExpansion | null, inLink: boolean): boolean {
    const isCollapsed = selection.isCollapsed();

    if (isCollapsed) {
        return expansion !== null || inLink;
    }

    const holdsImage = selection.getNodes().some($isMarkdownImageNode);

    return holdsImage || $rangeHoldsText(selection);
}

/**
 * Reads which of the commands that format, style, link or clear the
 * selected text would apply. A collapsed caret is judged on what a command
 * would act on: the format, style and link commands first expand it to its
 * word or run, so a non-null `expansion` decides whether a run kept as
 * Markdown source would be covered.
 *
 * The style and link commands act on a range selection only. A caret takes
 * a format or a style as pending, for the text typed next; a range must
 * hold text to carry either ({@link $rangeHoldsText}), and a link needs
 * text or an image to hold, and a caret needs a word under it or a link
 * around it ({@link $selectionHoldsLinkable}). The format
 * toggles also format the cells of a table selection, one by one
 * ({@link $someCellTakesFormat}). `removeLink` needs a link around the
 * anchor, and `clearFormatting` a selected text node carrying a format it
 * would take off.
 *
 * @param expansion - The would-be word/run expansion for a collapsed caret
 *   (from {@link $computeWordExpansion}), or `null` when there is none.
 * @param touchesTextOnlyBlock - What {@link $selectionTouchesTextOnlyBlock}
 *   gives for the current selection.
 * @returns The inline fields of the {@link CommandAvailability}.
 */
function $readInlineAvailability(
    expansion: WordExpansion | null,
    touchesTextOnlyBlock: boolean,
): Pick<CommandAvailability, "canFormat" | "canStyle" | "canLink" | "canRemoveLink" | "canClearFormatting"> {
    const selection = $getSelection();
    const isRange = $isRangeSelection(selection);
    const coversSourceRun = expansion !== null ? $isFormatBlockingSourceRun(expansion.node) : $selectionCoversSourceRun();
    const inNestedLinkRun = $selectionInNestedLinkRun();
    const inLink = isRange && $findEnclosingLinkNode(selection.anchor.getNode()) !== null;
    const writesInline = isRange && !touchesTextOnlyBlock && !coversSourceRun;
    const formatsRange = writesInline && (selection.isCollapsed() || $rangeHoldsText(selection));
    const formatsCells = $isTableSelection(selection) && $someCellTakesFormat(selection);
    const linksRange = writesInline && !inNestedLinkRun && $selectionHoldsLinkable(selection, expansion, inLink);
    const holdsClearableFormat = isRange
        && selection.getNodes().some((node) => $isTextNode(node) && $formatOnceCleared(node) !== node.getFormat());

    return {
        canFormat:          formatsRange || formatsCells,
        canStyle:           formatsRange && !inLink,
        canLink:            linksRange,
        canRemoveLink:      inLink && !inNestedLinkRun,
        canClearFormatting: holdsClearableFormat,
    };
}

/**
 * Reads which of the table commands would apply. Those acting on the table
 * the caret is in need a range selection anchored in one of its cells;
 * unmerging needs that cell to span more than one row or column; merging
 * needs a table selection of more than one cell, none of them a header
 * cell.
 *
 * @returns The table fields of the {@link CommandAvailability}.
 */
function $readTableAvailability(): Pick<CommandAvailability, "canEditTable" | "canMergeCells" | "canUnmergeCell"> {
    const selection = $getSelection();
    const cell = $getEnclosingTableCellNode();
    const selectedCells = $isTableSelection(selection) ? selection.getNodes().filter($isTableCellNode) : [];
    const holdsHeaderCell = selectedCells.some($isHeaderCell);

    return {
        canEditTable:   cell !== null,
        canMergeCells:  selectedCells.length > 1 && !holdsHeaderCell,
        canUnmergeCell: cell !== null && (cell.getColSpan() > 1 || cell.getRowSpan() > 1),
    };
}

/**
 * Reads which commands would apply at the current selection, from the same
 * tests the commands decline on, so that what the menu and the toolbar dim
 * says what the commands do: a field is `false` wherever its commands would
 * leave the document and the selection as they are. What it does not
 * foresee is a format, style or link the save could not write as shown,
 * which those commands still decline after trying it, and then leave the
 * document and the selection as they were.
 *
 * The block conversions, alignment and columns act on a range selection
 * only; the conversions also decline in a table cell. A line is inserted
 * before or after the block holding the anchor, so there must be one. The
 * two inserts make a caret of their own when there is no range selection.
 * The inline and table fields are read by {@link $readInlineAvailability}
 * and {@link $readTableAvailability}.
 *
 * @param expansion - The would-be word/run expansion for a collapsed caret
 *   (from {@link $computeWordExpansion}), or `null` when there is none.
 * @returns The {@link CommandAvailability} of the current selection.
 */
function $readCommandAvailability(expansion: WordExpansion | null): CommandAvailability {
    const selection = $getSelection();
    const isRange = $isRangeSelection(selection);
    const touchesTextOnlyBlock = $selectionTouchesTextOnlyBlock();
    const inInsertableBlock = isRange && $findEnclosingInsertableBlock(selection.anchor.getNode()) !== null;

    return {
        ...$readInlineAvailability(expansion, touchesTextOnlyBlock),
        canSetBlockType:               isRange && !$selectionTouchesTableCell() && !$selectionStandsOnTablesAlone(),
        canSetBlockLayout:             isRange,
        canInsertParagraphAroundBlock: inInsertableBlock,
        canInsertTable:                $tableInsertApplies(touchesTextOnlyBlock),
        canInsertImage:                $imageInsertApplies(touchesTextOnlyBlock),
        ...$readTableAvailability(),
    };
}

/**
 * `FORMAT_TEXT_COMMAND` handler formatting the selection as far as the save
 * can write it, and only where `canFormat` is `true` ({@link CommandAvailability}),
 * the field the format toggles read: the keyboard shortcuts and a browser's
 * own format commands decline wherever the toggles do. Where the field is
 * `false` the command is swallowed and nothing changes. A caret is not
 * widened: the format stays pending for the text typed next.
 *
 * A read-only editor never reaches this handler: `registerReadOnlyGuard`
 * refuses every `FORMAT_TEXT_COMMAND` first.
 *
 * @param format - The format the command toggles.
 * @returns `true`: the command is handled either way, so no handler below
 *   this one formats the selection unchecked.
 */
function $handleFormatCommand(format: TextFormatType): boolean {
    const applies = $readCommandAvailability($computeWordExpansion()).canFormat;

    if (applies) {
        $formatWritably(format, $cellTakesFormat);
    }

    // Handled either way: where the field is false, no handler below this one may format the selection.
    return true;
}

/**
 * Registers the format command's handler ({@link $handleFormatCommand}),
 * which formats a selection only as far as the save can write it and
 * declines where `canFormat` is `false`.
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
    return editor.registerCommand(FORMAT_TEXT_COMMAND, $handleFormatCommand, COMMAND_PRIORITY_HIGH);
}

/**
 * The formats a range selection carries, as Lexical reads them when the
 * selection changes: those every selected text node has, leaving out a node
 * the range only touches at its edge.
 *
 * @param selection - A range selection that is not collapsed.
 * @returns The combined format bitmask, `0` when the range holds no text.
 */
function $formatOfRange(selection: RangeSelection): number {
    const [start, end] = $orderedPoints(selection);
    const nodes = selection.getNodes();
    let combined = IS_ALL_FORMATTING;
    let holdsText = false;

    nodes.forEach((node, index) => {
        const isText = $isTextNode(node);

        if (!isText) {
            return;
        }

        const size = node.getTextContentSize();
        const touchedAtItsEnd = index === 0 && node.getKey() === start.key && start.offset === size;
        const touchedAtItsStart = index === nodes.length - 1 && node.getKey() === end.key && end.offset === 0;

        if (size !== 0 && !touchedAtItsEnd && !touchedAtItsStart) {
            holdsText = true;
            combined &= node.getFormat();
        }
    });

    return holdsText ? combined : 0;
}

/**
 * Gives a selection read from the browser, which carries no format, the
 * format Lexical would give it on a selection change: a collapsed one in
 * text takes the format and style of that text, so text typed at it
 * continues the run it sits in; a collapsed one in an empty block takes the
 * format and style the block keeps for text typed into it; and a range takes
 * the formats all its text has.
 *
 * @remarks This and {@link $formatOfRange} follow what Lexical's own
 * `selectionchange` handling does (`onSelectionChange` in `lexical`), which
 * it does not export. A Lexical upgrade that changes those rules needs the
 * same change here.
 *
 * @param selection - The selection to set the format of.
 */
function $carryFormatOfLanding(selection: RangeSelection): void {
    const isCollapsed = selection.isCollapsed();

    if (!isCollapsed) {
        selection.setFormat($formatOfRange(selection));

        return;
    }

    const anchorNode = selection.anchor.getNode();
    const inText = $isTextNode(anchorNode);
    const inEmptyBlock = $isElementNode(anchorNode) && anchorNode.isEmpty();

    if (inText) {
        selection.setFormat(anchorNode.getFormat());
        selection.setStyle(anchorNode.getStyle());
    } else if (inEmptyBlock) {
        selection.setFormat(anchorNode.getTextFormat());
        selection.setStyle(anchorNode.getTextStyle());
    }
}

/**
 * Brings the editor's selection to the one the browser holds when a context
 * menu opens. On Linux and macOS a right-click raises `contextmenu` on mouse
 * down, after the browser has moved its own caret to the click point but
 * before the `selectionchange` on which Lexical follows it, so the editor's
 * selection is still the one from before the click, while the commands the
 * menu offers will act on the new one. Adopting the browser's selection
 * first makes the menu describe what its items will act on.
 *
 * Leaves the selection alone when the browser's is the same, so a format
 * pending at an unmoved caret is kept, and while table cells are selected,
 * wherever the click lands: the browser holds no cell selection of its own,
 * a right-click on the cells must still act on all of them, and Lexical
 * itself keeps a table selection through a right-click outside its table,
 * so the commands go on acting on the cells. The menu is then the one for
 * those cells ({@link $contextMenuNodeFor}).
 *
 * A selection read from the browser carries no format, so an adopted one is
 * given the format Lexical would give it ({@link $carryFormatOfLanding}).
 * Left without, Lexical would keep the bare format of a collapsed one for
 * the `selectionchange` that follows, and a letter typed into a bold word
 * would come out plain.
 *
 * @remarks Exported (not part of the public `MarkdownEditor` callable) so it
 * can be tested directly, mirroring {@link $classifyContextMenuTarget}.
 *
 * @param fromDom - The browser's selection read as a Lexical range
 *   selection, or `null` when it holds none inside the editor.
 */
export function $adoptDomSelection(fromDom: RangeSelection | null): void {
    const current = $getSelection();
    const holdsCells = $isTableSelection(current);

    if (fromDom === null || holdsCells) {
        return;
    }

    const unmoved = $isRangeSelection(current) && current.anchor.is(fromDom.anchor) && current.focus.is(fromDom.focus);

    if (unmoved) {
        return;
    }

    $carryFormatOfLanding(fromDom);
    $setSelection(fromDom);
}

/**
 * The text `copy()` writes to the clipboard: the selection's, the whole table
 * of a table-edge range, or, at a caret, the word the caret stands in or
 * beside.
 *
 * @returns The text, or `""` when there is nothing to copy.
 */
function $copiedSelectionText(): string {
    const selection = $getSelection();
    const isRange = $isRangeSelection(selection);

    if (!isRange) {
        return "";
    }

    // Non-null only for a caret still collapsed, which is the read-only case.
    const expansion = $computeWordExpansion();

    if (expansion !== null) {
        return expansion.node.getTextContent().slice(expansion.start, expansion.end);
    }

    const isTableEdge = $isTableEdgeRange(selection);
    const copied = isTableEdge ? $grownTableEdgeRange(selection) : selection;

    return copied.getTextContent();
}

/**
 * Whether focusing the WYSIWYG surface's element keeps the editor's
 * selection: when the selection is a table selection, which no browser
 * selection stands for and which Lexical never replaces, or when the
 * browser's own selection already lies inside the editor, which a browser
 * keeps on focusing an element that holds it. Otherwise the browser would
 * put a caret at the element's start, and Lexical would adopt that.
 *
 * @param editor - The Lexical editor.
 * @returns `true` where the element can be focused without moving the selection.
 */
function $surfaceFocusKeepsSelection(editor: LexicalEditor): boolean {
    const isTableSelection = $isTableSelection($getSelection());

    if (isTableSelection) {
        return true;
    }

    // Lexical's own reading of the browser's selection: null when it lies outside the editor.
    const browserSelection = DOM.source.readDocumentSelection((selection) => $createRangeSelectionFromDom(selection, editor));

    return browserSelection !== null;
}

/**
 * Picks the node the context menu is built for. While table cells are
 * selected it is the selection's anchor cell, wherever the event landed: a
 * right-click leaves a table selection in place even outside its table
 * ({@link $adoptDomSelection}), every command goes on acting on the cells,
 * and the menu must be the one for what its items act on. Otherwise the
 * node the event's target resolved to is used unless it is the root: that
 * is what a menu opened from the keyboard (Shift+F10, the ContextMenu key)
 * targets, and a right-click in the root's own padding, and neither has
 * content under it. The menu is then built for the selection's anchor, or
 * for the root itself when there is no selection.
 *
 * @remarks Exported (not part of the public `MarkdownEditor` callable) so it
 * can be tested directly, mirroring {@link $classifyContextMenuTarget}.
 *
 * @param target - The node the native `contextmenu` event's DOM target resolved to.
 * @returns The node to classify.
 */
export function $contextMenuNodeFor(target: LexicalNode): LexicalNode {
    const selection = $getSelection();
    const holdsCells = $isTableSelection(selection);

    if (holdsCells) {
        return selection.anchor.getNode();
    }

    const isRoot = $isRootNode(target);

    if (!isRoot) {
        return target;
    }

    return $isRangeSelection(selection) ? selection.anchor.getNode() : target;
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
 * The `availability` every kind carries is read from the live selection, not
 * from `node`: the commands act on the selection, so it is the selection
 * that decides whether they would decline.
 *
 * @param node - The node the menu is built for (see {@link $contextMenuNodeFor}).
 * @returns The classified {@link ContextMenuTarget}.
 */
export function $classifyContextMenuTarget(node: LexicalNode): ContextMenuTarget {
    const selection = $getSelection();
    const expansion = $computeWordExpansion();
    const formatState = $readFormatFlags(selection, expansion);
    const availability = $readCommandAvailability(expansion);
    const hasSelectedText = expansion !== null
        || ($isRangeSelection(selection) && selection.getTextContent() !== "");
    const linkUrl = $findEnclosingLinkNode(node)?.getURL() ?? null;

    const tableCell = $getTableCellNodeFromLexicalNode(node);

    if (tableCell !== null) {
        const hasEnclosingBlock = $findEnclosingInsertableBlock(node) !== null;
        const columnAlignment   = $tableCellAlignment(tableCell);

        return { kind: "table-cell", hasSelectedText, hasEnclosingBlock, linkUrl, columnAlignment, availability, ...formatState };
    }

    const block = $findEnclosingBlock(node);

    const isEmptyLine = !$isMarkdownListItemTextNode(block) && $isParagraphNode(block) && block.getTextContent() === "";

    // An empty list item is no empty line: its menu is the one for text, as a list item's is.
    if (isEmptyLine) {
        return { kind: "empty-line", hasSelectedText, availability };
    }

    const hasEnclosingBlock = $findEnclosingInsertableBlock(node) !== null;

    return { kind: "text", hasSelectedText, hasEnclosingBlock, linkUrl, availability, ...formatState };
}

/**
 * The `can…` fields of a {@link MarkdownEditorSelectionState}: the part of
 * the {@link CommandAvailability} a toolbar reads. They are picked by the
 * shape of their name, so a `can…` field added to the selection state
 * belongs here without being listed, and everything typed with this fails
 * to compile until it gives the new field too.
 */
type ReportedAvailability = Pick<MarkdownEditorSelectionState, Extract<keyof MarkdownEditorSelectionState, `can${string}`>>;

/**
 * Picks the fields the selection state reports out of an availability
 * record, each under its own name.
 *
 * @param availability - The record.
 * @returns Its reported fields.
 */
function reportedAvailability(availability: CommandAvailability): ReportedAvailability {
    return {
        canFormat:         availability.canFormat,
        canStyle:          availability.canStyle,
        canLink:           availability.canLink,
        canRemoveLink:     availability.canRemoveLink,
        canSetBlockType:   availability.canSetBlockType,
        canSetBlockLayout: availability.canSetBlockLayout,
        canInsertTable:    availability.canInsertTable,
        canInsertImage:    availability.canInsertImage,
        canEditTable:      availability.canEditTable,
        canMergeCells:     availability.canMergeCells,
        canUnmergeCell:    availability.canUnmergeCell,
    };
}

/**
 * Reads the toolbar's live selection state directly off `$getSelection()` —
 * the five format flags (via {@link $readFormatFlags}), whether there's a
 * selection to act on, the enclosing link's URL (if any), which commands
 * would apply (via {@link $readCommandAvailability}), table-cell
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
    const availability = $readCommandAvailability(expansion);

    return {
        ...format,
        hasSelectedText,
        linkUrl,
        ...reportedAvailability(availability),
        inTable:              cell !== null,
        tableColumnAlignment: cell !== null ? $tableCellAlignment(cell) : null,
        blockAlignment:       (block?.getAlign() ?? null) as MarkdownBlockAlignment | null,
        columnCount:          block !== null ? block.getColumns().length : 1,
    };
}

/**
 * The {@link MarkdownEditorSelectionState} reported before the Lexical editor
 * is built: what an editor with no selection reports, where only the two
 * inserts, which make a caret of their own, would apply. Whether they would
 * depends on how the document ends, which is not known until it is built;
 * the build reports the state again if the document turns either off.
 */
const NEUTRAL_SELECTION_STATE: MarkdownEditorSelectionState = {
    bold: false, italic: false, strikethrough: false, code: false, underline: false,
    hasSelectedText: false, linkUrl: null,
    canFormat: false, canStyle: false, canLink: false, canRemoveLink: false,
    canSetBlockType: false, canSetBlockLayout: false, canInsertTable: true, canInsertImage: true,
    canEditTable: false, canMergeCells: false, canUnmergeCell: false,
    inTable: false, tableColumnAlignment: null, blockAlignment: null, columnCount: 1,
};

/**
 * The `can…` fields of a {@link MarkdownEditorSelectionState} with none of
 * them available: what a read-only editor reports, whatever its selection.
 * Typed by {@link ReportedAvailability}, so a `can…` field added to the
 * selection state must be given here before this compiles, and cannot stay
 * `true` on a read-only editor by being forgotten.
 */
const NO_COMMAND_APPLIES: ReportedAvailability = {
    canFormat: false, canStyle: false, canLink: false, canRemoveLink: false,
    canSetBlockType: false, canSetBlockLayout: false, canInsertTable: false, canInsertImage: false,
    canEditTable: false, canMergeCells: false, canUnmergeCell: false,
};

/**
 * Whether two {@link MarkdownEditorSelectionState} values are field-for-field
 * equal — what {@link MarkdownEditor.updateSelectionState} uses to decide
 * whether a commit's resulting state is worth a `"selectionstate"` emit.
 * Every field is compared, whichever the state has: each holds a plain
 * value, and a field added to the state is then compared without being
 * named here.
 *
 * @param a - The first state.
 * @param b - The second state.
 * @returns Whether every field of `a` matches the same field of `b`.
 */
function selectionStatesEqual(a: MarkdownEditorSelectionState, b: MarkdownEditorSelectionState): boolean {
    const fields = Object.keys(a) as Array<keyof MarkdownEditorSelectionState>;

    return fields.every((field) => a[field] === b[field]);
}

/**
 * How long after the view of a read-only editor was rendered anew its
 * selection is written back, in milliseconds, where no frame is painted
 * first: none. What matters is that it is a task of its own, after the
 * event in which the browser changed the view, at whose end the browser
 * sets a selection itself.
 */
const VIEW_RESTORE_DELAY_MS = 0;

/** `MouseEvent.button` of the middle button, by the DOM's own numbering of a mouse's buttons. */
const MIDDLE_BUTTON = 1;

/**
 * The address of the link a read-only editor follows on Enter: the link the
 * selection state reports for the caret, which is `linkUrl` as
 * {@link $readSelectionState} computes it, so that Enter follows a link
 * exactly where a host is told the caret is in one. A selection of text
 * stands in no link: Enter follows a link from a caret.
 *
 * @returns The address, or `null` where there is no caret, the caret is in
 *   no link, or the link's address is not one to open.
 */
function $linkUrlToFollowAtCaret(): string | null {
    const selection = $getSelection();
    const isCaret = $isRangeSelection(selection) && selection.isCollapsed();
    const linkUrl = isCaret ? $readSelectionState().linkUrl : null;

    return addressToFollow(linkUrl);
}

/**
 * Stacking order of the read-only rejection wash within the editor's own
 * element: above the WYSIWYG surface's content, which sets no z-index of its
 * own, so one step up is enough.
 */
const WYSIWYG_FLASH_Z_INDEX = 1;

// A text caret over the whole surface says the text can be selected, in a
// read-only editor too. The surface is also a contenteditable editing host,
// which the browser exempts from the framework's `user-select: none` on its
// own, and Lexical additionally stamps `user-select: text` inline on the root
// when it mounts — stating the same intent here in the framework's own rule
// means select-and-copy does not depend on that inline write surviving a later
// re-render. As class defaults both land on the shared `.WysiwygSurface` rule
// rather than each instance's `#id` rule.
const _defaultWysiwygSurfaceOptions: Partial<ComponentOptions> = { userSelect: "text", cursor: "text" };

/** The events {@link WysiwygSurface} exposes through its custom `on` / `off` surface. */
type WysiwygSurfaceEvent =
    "contextmenu" | "readonlyedit" | "unpreventableedit" | "uncancelledinput" | "readonlyenter" | "readonlypress" | "readonlyclick";

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
 *
 * While it is `contenteditable` the surface is a multi-line text box to
 * assistive technology, and it is nothing of the kind while it is not: with
 * the attribute off it takes no focus and has no caret, and is a plain
 * container of what it shows ({@link WysiwygSurface.applyTextBoxState}).
 *
 * The surface stays `contenteditable` while its editor is read-only: that
 * attribute is what gives the browser a caret, keyboard navigation and
 * selection, and a tab stop. A read-only surface therefore cancels the edits
 * the browser announces for an editing host itself, stops the undo and redo
 * keys, and reports the edits it cannot cancel, before and after the
 * browser makes them, so that the editor can keep them out of the document
 * and put the shown text back.
 */
class WysiwygSurface extends Component {

    /** Whether this surface's element hosts an editable region (`contenteditable`). */
    private _contentEditable: boolean = false;

    /** Whether the editor this surface belongs to is read-only, so that the browser's own edits are refused here. */
    private _readOnly: boolean = false;

    /** Invoked on the surface's first connected + sized layout — the moment to mount the live view. */
    private readonly _onReady: () => void;

    /**
     * Where the surface was scrolled to when the editor's view was taken out
     * of it ({@link WysiwygSurface.takeOutView}); `null` while the view is
     * in, and before one is mounted.
     */
    private _takenOutAt: { top: number; left: number } | null = null;

    /** Custom-event fan-out for the events of {@link WysiwygSurfaceEvent}. */
    private readonly _listeners: ListenerBag<WysiwygSurfaceEvent> = this.registerListenerBag(new ListenerBag<WysiwygSurfaceEvent>());

    /**
     * Constructs the WYSIWYG surface.
     *
     * @param onReady - Called on the surface's first connected + sized layout.
     * @param readOnly - Whether the editor the surface belongs to starts
     *   read-only. The surface is `contenteditable` either way.
     * @param subclassDefaults - Optional subclass defaults bag.
     */
    constructor(onReady: () => void, readOnly: boolean, subclassDefaults?: Partial<ComponentOptions>) {
        super(undefined, { ..._defaultWysiwygSurfaceOptions, ...(subclassDefaults ?? {}) });

        this._onReady = onReady;

        // No tabindex: an editing host is a tab stop by itself.
        this.setContentEditable(true);
        this.setReadOnly(readOnly);
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

        // The events by which the browser announces an edit to an editing
        // host, or reports one it has made. Subtree for the same reason: they
        // are fired on the node the caret is in. Each handler acts only while
        // the surface is read-only, so none sets a registration floor.
        Event.addSubtreeListener(this, "beforeinput", this.handleBeforeInput);
        Event.addSubtreeListener(this, "paste", this.handleEditIntent);
        Event.addSubtreeListener(this, "cut", this.handleEditIntent);
        Event.addSubtreeListener(this, "drop", this.handleEditIntent);
        Event.addSubtreeListener(this, "input", this.handleInput);
        // Two kinds of key are taken, and only while read-only: undo and redo, and Enter where it follows a link.
        Event.addSubtreeListener(this, "keydown", this.handleKeyDown);
        // A press of the pointer, then a click with the main button or one with any other, for the links of a
        // read-only surface. The press is heard for every button: a middle click has one too.
        Event.addSubtreeListener(this, "mousedown", { button: "any", handler: this.handlePress });
        Event.addSubtreeListener(this, "click", this.handleClick);
        Event.addSubtreeListener(this, "auxclick", this.handleAuxClick);

        this.onFirstLayout(() => this._onReady());
    }

    /**
     * Sets whether this surface's element hosts an editable region. Caches the
     * state in `_contentEditable` and writes the `contenteditable` attribute
     * through `setElementAttribute`, whose buffer replays the value onto the
     * element once one is created — so a call made during detached
     * construction still lands. Whether edits are accepted is a separate
     * matter ({@link WysiwygSurface.setReadOnly}): the attribute decides
     * whether the browser gives the surface a caret at all, and with it
     * whether the surface is a text box ({@link WysiwygSurface.applyTextBoxState}).
     *
     * @param contentEditable - Whether the element is contenteditable.
     * @returns This surface, for method chaining.
     */
    setContentEditable(contentEditable: boolean): this {
        this._contentEditable = contentEditable;
        this.setElementAttribute("contenteditable", contentEditable ? "true" : "false");
        this.applyTextBoxState();

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
     * Sets whether the editor this surface belongs to is read-only. Caches the
     * state in `_readOnly`, which the edit handlers read, and has the text
     * box state follow it ({@link WysiwygSurface.applyTextBoxState}). The
     * `contenteditable` attribute is not touched: a read-only surface keeps
     * its caret.
     *
     * @param readOnly - Whether the surface refuses the browser's edits.
     * @returns This surface, for method chaining.
     */
    setReadOnly(readOnly: boolean): this {
        this._readOnly = readOnly;
        this.applyTextBoxState();

        return this;
    }

    /**
     * Writes what the surface is to assistive technology, from its two
     * states. An editing host is a multi-line text box, read-only or not:
     * `role="textbox"`, `aria-multiline="true"`, and `aria-readonly`
     * following the read-only state, which are the attributes CodeMirror
     * writes on the source surface's content. A surface that is not an
     * editing host takes no focus and has no caret, so it is no text box: it
     * carries none of the three, read-only or not, and what it shows
     * (headings, links, lists, tables) is exposed as what it is.
     */
    private applyTextBoxState(): void {
        const aria = this.getAria();

        if (this._contentEditable) {
            aria.setRole("textbox").setMultiline(true).setReadOnly(this._readOnly);
        } else {
            aria.clearRole().setMultiline(null).setReadOnly(null);
        }
    }

    /**
     * Returns whether this surface refuses the browser's edits.
     *
     * @returns The read-only state.
     */
    getReadOnly(): boolean {
        return this._readOnly;
    }

    /**
     * Registers a listener for the `"contextmenu"` event, fired on a native
     * right-click over this surface's element, or for `"readonlyclick"`,
     * fired on a click or a middle click over it while it is read-only.
     *
     * @param event - `"contextmenu"` or `"readonlyclick"`.
     * @param listener - Invoked with the native `MouseEvent`.
     * @returns This surface, for method chaining.
     */
    on(event: "contextmenu" | "readonlyclick", listener: (event: MouseEvent) => void): this;
    /**
     * Registers a listener for `"readonlyenter"`, fired when the Enter key
     * is pressed, with no modifier key, on the read-only surface while it
     * is the editing host. A listener that acts on the key cancels it.
     *
     * @param event - Must be `"readonlyenter"`.
     * @param listener - Invoked with the native `KeyboardEvent`.
     * @returns This surface, for method chaining.
     */
    on(event: "readonlyenter", listener: (event: KeyboardEvent) => void): this;
    /**
     * Registers a listener for `"readonlyedit"`, fired when the read-only
     * surface refuses an edit the browser announced; for
     * `"unpreventableedit"`, fired when the browser announces an edit of the
     * read-only surface that cannot be cancelled, before it makes it; for
     * `"uncancelledinput"`, fired when the browser has changed the shown
     * text of the read-only surface all the same; or for `"readonlypress"`,
     * fired when the pointer is pressed over the read-only surface, before
     * the browser changes the selection for it.
     *
     * @param event - `"readonlyedit"`, `"unpreventableedit"`, `"uncancelledinput"` or `"readonlypress"`.
     * @param listener - Invoked with no payload.
     * @returns This surface, for method chaining.
     */
    on(event: "readonlyedit" | "unpreventableedit" | "uncancelledinput" | "readonlypress", listener: () => void): this;
    on(event: WysiwygSurfaceEvent, listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered `"contextmenu"` or `"readonlyclick"`
     * listener.
     *
     * @param event - `"contextmenu"` or `"readonlyclick"`.
     * @param listener - The exact callback reference to remove.
     * @returns This surface, for method chaining.
     */
    off(event: "contextmenu" | "readonlyclick", listener: (event: MouseEvent) => void): this;
    /**
     * Removes a previously registered `"readonlyenter"` listener.
     *
     * @param event - Must be `"readonlyenter"`.
     * @param listener - The exact callback reference to remove.
     * @returns This surface, for method chaining.
     */
    off(event: "readonlyenter", listener: (event: KeyboardEvent) => void): this;
    /**
     * Removes a previously registered `"readonlyedit"`,
     * `"unpreventableedit"`, `"uncancelledinput"` or `"readonlypress"`
     * listener.
     *
     * @param event - `"readonlyedit"`, `"unpreventableedit"`, `"uncancelledinput"` or `"readonlypress"`.
     * @param listener - The exact callback reference to remove.
     * @returns This surface, for method chaining.
     */
    off(event: "readonlyedit" | "unpreventableedit" | "uncancelledinput" | "readonlypress", listener: () => void): this;
    off(event: WysiwygSurfaceEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans an event out to its registered listeners.
     *
     * @param event - The event name.
     * @param payload - The native `MouseEvent` of `"contextmenu"` and
     *   `"readonlyclick"`, or the native `KeyboardEvent` of
     *   `"readonlyenter"`; the other events have none.
     */
    protected emit(event: "contextmenu" | "readonlyclick", payload: MouseEvent): void;
    protected emit(event: "readonlyenter", payload: KeyboardEvent): void;
    protected emit(event: "readonlyedit" | "unpreventableedit" | "uncancelledinput" | "readonlypress"): void;
    protected emit(event: WysiwygSurfaceEvent, payload?: MouseEvent | KeyboardEvent): void {
        this._listeners.fire(event, ...(payload === undefined ? [] : [payload]));
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
     * `Event`-registered handler for `beforeinput`, by which the browser
     * announces an edit to this editing host before making it: typing,
     * Enter, a deletion, a spelling replacement, the browser's own undo and
     * redo, its format shortcuts, a dragged selection being moved. While the
     * surface is read-only the edit is cancelled and reported
     * ({@link WysiwygSurface.handleEditIntent}).
     *
     * One kind of edit cannot be cancelled: a composition's text. It is
     * reported like the rest, and the editor is told, through
     * `"unpreventableedit"`, that the browser is about to change the shown
     * text, while nothing has changed yet. The report is made here and not
     * when the composition starts: a composition can start with no text to
     * write (an on-screen keyboard starts one around the word a tap puts
     * the caret in), and that is no edit.
     *
     * @param event - The native `beforeinput` event.
     * @returns The disposition that cancels the edit, or nothing.
     */
    private handleBeforeInput(event: InputEvent): Event.ListenerResult {
        const unpreventable = this._readOnly && !event.cancelable;

        if (unpreventable) {
            // The take-out first: the report reaches host listeners, and one that throws must not defeat it.
            this.emit("unpreventableedit");
            this.emit("readonlyedit");

            return;
        }

        return this.handleEditIntent(event);
    }

    /**
     * Cancels and reports an edit the browser announces to this editing
     * host before making it: the `Event`-registered handler for `paste`,
     * `cut` and `drop`, and what {@link WysiwygSurface.handleBeforeInput}
     * hands a `beforeinput` on to. While the surface is read-only the edit
     * is cancelled and reported through `"readonlyedit"`. An event that
     * cannot be cancelled is left alone and not reported. The edit is
     * cancelled before it is reported, so that a host listener of
     * `"readonlyedit"` that throws cannot let it through.
     *
     * @param event - The native event.
     * @returns The disposition that cancels the edit, or nothing.
     */
    private handleEditIntent(event: { cancelable: boolean; preventDefault(): void }): Event.ListenerResult {
        if (!this._readOnly || !event.cancelable) {
            return;
        }

        event.preventDefault();
        this.emit("readonlyedit");

        return { prevent: true };
    }

    /**
     * `Event`-registered handler for `keydown`: stops the undo and redo
     * keys of a read-only surface, and hands Enter to the editor, which
     * follows a link the caret is in. Every other key is left to the
     * browser, which moves the caret with it or announces the edit it would
     * make.
     *
     * The browser's own undo is the page's, not the editing host's: with
     * nothing of the surface's to undo, the key takes back the last edit
     * made in any other field of the page and moves the focus there. An
     * editable editor never lets it run, Lexical taking the key for its own
     * history. The key is stopped without a report, as a read-only
     * `CodeEditor` stops it.
     *
     * Enter is decided here, by the key, and not by the edit the browser
     * would announce for it: that is a paragraph break at most places and a
     * line break at some (beside an image inside a link), so the kind of
     * edit does not say that Enter was pressed. The key counts where it is
     * pressed alone, on the surface as the editing host, which is where the
     * editor has a caret: it is reported through `"readonlyenter"`, and the
     * editor cancels it where it follows a link. Left alone, it becomes the
     * refused edit Enter is anywhere else. With Shift, Ctrl, Alt or Meta
     * held it is not this key and is left to the browser. The repeats a held
     * Enter sends are stopped, so that holding the key down neither opens a
     * link again nor flashes for as long as it is held.
     *
     * @param event - The native `keydown` event.
     * @returns The disposition that stops the key's default, or nothing.
     */
    private handleKeyDown(event: KeyboardEvent): Event.ListenerResult {
        if (!this._readOnly) {
            return;
        }

        const isEnter = event.key === "Enter";
        const heldEnter = isEnter && event.repeat;
        const stopped = heldEnter || isUndoOrRedoKey(event);

        if (stopped) {
            return { prevent: true };
        }

        const withModifier = event.shiftKey || event.ctrlKey || event.altKey || event.metaKey;
        const asksToFollow = isEnter && !withModifier && !event.isComposing && this._contentEditable;

        if (asksToFollow) {
            this.emit("readonlyenter", event);
        }
    }

    /**
     * `Event`-registered handler for `mousedown`, a press of the pointer
     * with any button: on a read-only surface it is reported through
     * `"readonlypress"`. The browser changes the selection for a press after
     * this event, so the editor can note here what was selected before it,
     * and tell at the click that follows whether the click selected text.
     */
    private handlePress(): void {
        if (this._readOnly) {
            this.emit("readonlypress");
        }
    }

    /**
     * `Event`-registered handler for a `click` with the main button: on a
     * read-only surface it is passed on through `"readonlyclick"`, for the
     * editor to follow a link the click was on. An editable surface passes
     * nothing on: a click there places the caret.
     *
     * @param event - The native `click` event.
     */
    private handleClick(event: MouseEvent): void {
        if (this._readOnly) {
            this.emit("readonlyclick", event);
        }
    }

    /**
     * `Event`-registered handler for `auxclick`, a click with any other
     * button: a middle click, with which a browser opens a link in a new
     * tab, is passed on as {@link WysiwygSurface.handleClick} passes a click
     * on. A click with the secondary button opens the context menu and is
     * left alone.
     *
     * @param event - The native `auxclick` event.
     */
    private handleAuxClick(event: MouseEvent): void {
        if (event.button === MIDDLE_BUTTON) {
            this.handleClick(event);
        }
    }

    /**
     * `Event`-registered handler for `input`, which the browser fires after
     * it has changed the shown text. On a read-only surface that is an edit
     * that could not be cancelled, so the editor is asked, through
     * `"uncancelledinput"`, to put the view back. It is asked too where the
     * view is out for such an edit and read-only was lifted meanwhile.
     */
    private handleInput(): void {
        if (this._readOnly || this._takenOutAt !== null) {
            this.emit("uncancelledinput");
        }
    }

    /**
     * Whether keyboard focus is on this surface or inside it.
     *
     * @returns Whether the surface holds the focus; `false` before it has an element.
     */
    holdsFocus(): boolean {
        const element = this.getElement();
        const active = DOM.source.getActiveElement();

        return element !== undefined && active !== null && DOM.source.contains(element, active);
    }

    /**
     * Renders the editor's view into this surface anew: takes the view out
     * ({@link WysiwygSurface.takeOutView}) and puts it back
     * ({@link WysiwygSurface.putBackView}), which has Lexical drop every
     * element it rendered and build them from the document. Whatever the
     * browser did to the surface's elements is gone afterwards. Where the
     * view is out already it is put back. No-op where no view was mounted.
     *
     * @param editor - The Lexical editor whose view is mounted here.
     */
    remount(editor: LexicalEditor): void {
        this.takeOutView(editor);
        this.putBackView(editor);
    }

    /**
     * Takes the editor's view out of this surface: Lexical drops every
     * element it rendered and, with them, its mutation observer, so that
     * nothing written into the surface from then on reaches the document.
     * The surface's element stays, and stays the editing host. The scroll
     * offsets are kept for {@link WysiwygSurface.putBackView}. No-op where
     * no view is mounted, which includes a view taken out already.
     *
     * @param editor - The Lexical editor whose view is mounted here.
     */
    takeOutView(editor: LexicalEditor): void {
        const element = this.getElement();
        const mounted = editor.getRootElement() !== null;

        if (!element || !mounted) {
            return;
        }

        // The browser scrolls this surface itself, so its offsets are read, not taken from the cache.
        this._takenOutAt = { top: DOM.source.getScrollTop(element), left: DOM.source.getScrollLeft(element) };
        editor.setRootElement(null);
    }

    /**
     * Puts back a view taken out with {@link WysiwygSurface.takeOutView}:
     * mounts it, which empties the surface of whatever was written into it
     * meanwhile and renders the document, with a mutation observer that has
     * heard of none of it. The surface's scroll offsets are put back, and
     * are from then on what `getScrollTop()` and `getScrollLeft()` return.
     * No-op where no view was taken out.
     *
     * @param editor - The Lexical editor whose view was taken out.
     */
    putBackView(editor: LexicalEditor): void {
        const takenOutAt = this._takenOutAt;

        if (takenOutAt === null) {
            return;
        }

        this._takenOutAt = null;
        this.mount(editor);
        this.setScrollTop(takenOutAt.top);
        this.setScrollLeft(takenOutAt.left);
    }

    /**
     * Whether the editor's view is out of this surface for a moment
     * ({@link WysiwygSurface.takeOutView}), to be put back.
     *
     * @returns Whether a view was taken out and not yet put back.
     */
    isViewOut(): boolean {
        return this._takenOutAt !== null;
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

    /**
     * The nested parts of every import's blocks, keyed by node, like
     * `_sourceBlocks` and for the same reason; see {@link adoptSourceMap}.
     */
    private readonly _sourceParts: Map<NodeKey, MarkdownSourcePart> = new Map();

    /** The `mergeRegister` teardown for the rich-text / list / history / shortcut / update registrations. */
    private _unregister: (() => void) | null = null;

    /**
     * While a source-mode command runs through the model: the model editor the command acts on in place of the
     * WYSIWYG editor. `null` otherwise.
     */
    private _commandEditor: LexicalEditor | null = null;

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
     * emit, or, before the first one, the state the surface the editor was
     * constructed showing reports. Compared against on every commit so a
     * commit that changes nothing tracked emits nothing.
     */
    private _lastSelectionState: MarkdownEditorSelectionState = NEUTRAL_SELECTION_STATE;

    /**
     * What waits to finish putting a read-only view back after the browser
     * changed it, or announced a change it could not be talked out of
     * ({@link restoreView}, {@link takeOutView}): a task and an animation
     * frame, of which the first to come does the work and calls the other
     * off ({@link scheduleViewRestore}). `null` while none waits.
     */
    private _viewRestore: { task: TimerId; frame: number } | null = null;

    /**
     * What the browser had selected when the pointer was last pressed over
     * the read-only surface, as {@link $selectionMark} marks it, for the
     * click that follows to be judged by ({@link handleReadOnlyClick});
     * `null` once a click has used it, and before any press.
     */
    private _selectionBeforePress: string | null = null;

    /**
     * The rejection wash played over the editor when an edit is refused on
     * the WYSIWYG surface; mounted with the view. The source surface plays
     * its `CodeEditor`'s own.
     */
    private readonly _flash: ReadOnlyFlash = new ReadOnlyFlash();

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

        this._wysiwyg = new WysiwygSurface(() => this.mountWysiwyg(), this._options.readOnly ?? false);
        // Arrow, not a bare method reference: ListenerBag.fire (which this `on`
        // ultimately dispatches through) calls listeners bare with no `this`
        // rebinding, unlike Event.addListener's `.apply(component, …)`.
        this._wysiwyg.on("contextmenu", (event) => this.handleWysiwygContextMenu(event));
        this._wysiwyg.on("readonlyedit", () => this.signalReadOnlyEdit());
        this._wysiwyg.on("readonlyenter", (event) => this.handleReadOnlyEnter(event));
        this._wysiwyg.on("readonlypress", () => this.handleReadOnlyPress());
        this._wysiwyg.on("unpreventableedit", () => this.takeOutView());
        this._wysiwyg.on("uncancelledinput", () => this.restoreView());
        this._wysiwyg.on("readonlyclick", (event) => this.handleReadOnlyClick(event));
        this._codeEditor = new CodeEditor(this._options.value ?? "", {
            language:  "markdown",
            readOnly:  this._options.readOnly ?? false,
            listeners: {
                change:          (payload) => this.handleCodeChange(payload),
                selectionchange: () => this.updateSelectionState(),
                // The source editor has played its own wash: only the event is passed on.
                readonlyedit:    () => this.emit("readonlyedit"),
            },
        });

        this.addComponent(this._wysiwyg);
        this.addComponent(this._codeEditor);

        // Pick the initial visible child from the mode.
        this._card.setVisibleComponentId(
            this.getMode() === "source" ? this._codeEditor.getId() : this._wysiwyg.getId());

        this._cleanValue = this.getValue();

        // What `getSelectionState()` reports from the start, so the first `"selectionstate"` is a change
        // from it. The source surface does not report the neutral state: its commands apply.
        this._lastSelectionState = this.readActiveSelectionState();

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
     * mutates the Lexical document that surface is not showing. While a
     * source-mode command runs on its model ({@link editSourceThroughModel})
     * the answer is `false`, so the command takes its WYSIWYG path against the
     * model.
     *
     * @returns `true` in `"source"` mode, outside a run on the model.
     */
    private isSourceMode(): boolean {
        return this._commandEditor === null && this.getMode() === "source";
    }

    /**
     * Applies `transform` to the source surface's raw Markdown when that surface
     * is the one shown, and restores focus to it afterwards — a toolbar click or
     * a menu row blurs the editing surface before the command runs. The range is
     * read from the `CodeEditor`'s own state rather than the DOM selection, which
     * a blurred surface no longer carries. A read-only editor refuses the edit
     * before the transform runs ({@link refuseSourceEditIfReadOnly}).
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

        const refused = this.refuseSourceEditIfReadOnly();

        if (!refused) {
            const selection = this._codeEditor.getSelection();
            const edit = transform(this._codeEditor.getValue(), selection.from, selection.to);

            if (edit !== null) {
                this._codeEditor.replaceRange(edit.from, edit.to, edit.insert, edit.selection);
            }
        }

        this._codeEditor.focus(true);

        return true;
    }

    /**
     * Refuses a source-mode command that edits text in a read-only editor,
     * before it reads or imports any text. The refusal is handed to the source
     * editor as an empty replacement at its selection, which a read-only
     * `CodeEditor` refuses with its own `"readonlyedit"` event and wash.
     *
     * @returns Whether the editor is read-only, so that the caller must not edit.
     */
    private refuseSourceEditIfReadOnly(): boolean {
        const readOnly = this.getReadOnly();

        if (readOnly) {
            const { from } = this._codeEditor.getSelection();

            // A read-only CodeEditor refuses any replacement with its own "readonlyedit" and wash; the editor relays the event.
            this._codeEditor.replaceRange(from, from, "");
        }

        return readOnly;
    }

    /**
     * Runs a command on the Markdown around the source surface's selection, as
     * the WYSIWYG surface runs it, when that surface is not the one shown: the
     * command is called again against a model of that Markdown (a short-lived
     * headless editor), and only the text it changes is written back to the
     * source editor, with the caret where the WYSIWYG command leaves it. Keyboard
     * focus goes back to the source editor afterwards, as a toolbar click or a
     * menu row blurred it.
     *
     * @param command - The command, which calls itself again on the model.
     * @returns `true` when the source surface handled the command, so the caller
     *   must return; `false` otherwise, so the caller falls through to its
     *   WYSIWYG path.
     */
    private editSourceThroughModel(command: () => unknown): boolean {
        const sourceMode = this.isSourceMode();

        if (!sourceMode) {
            return false;
        }

        const refused = this.refuseSourceEditIfReadOnly();

        if (!refused) {
            this.editThroughModel(command);
        }

        this._codeEditor.focus(true);

        return true;
    }

    /**
     * Imports the window around the source selection into a model, runs the
     * command there and writes the change back. A window whose carried
     * definitions did not come back is run again on the whole document.
     *
     * @param command - The command to run on the model.
     */
    private editThroughModel(command: () => unknown): void {
        const text = this._codeEditor.getValue();
        const selection = this._codeEditor.getSelection();
        // Only the cached text of a source editor not mounted yet holds one; the import rewrites it, so no offset would match.
        const holdsCarriageReturn = text.includes("\r");

        if (holdsCarriageReturn) {
            return;
        }

        const window = sourceWindow(text, selection.from, selection.to);
        const windowed = this.runOnModel(text, selection, window, command);
        const result = windowed === WINDOW_LOST ? this.runOnModel(text, selection, wholeDocumentWindow(text), command) : windowed;

        if (result !== null && result !== WINDOW_LOST) {
            this._codeEditor.replaceRange(result.from, result.to, result.insert, result.selection);
        }
    }

    /**
     * Runs a command on a model of a window of the document.
     *
     * @param text - The document.
     * @param selection - The source selection.
     * @param window - The part of the document to import.
     * @param command - The command to run on the model.
     * @returns The edit of the document, `null` when the command does nothing, or {@link WINDOW_LOST}.
     */
    private runOnModel(text: string, selection: { from: number; to: number }, window: SourceWindow, command: () => unknown): ModelResult {
        const imported = window.before + text.slice(window.start, window.end) + window.after;
        // An offset of the imported text plus `shift` is the same offset of the document.
        const shift = window.start - window.before.length;
        const model = this.buildModelEditor(imported);

        try {
            const applies = this.selectInModel(model, imported, selection.from - shift, selection.to - shift);

            if (!applies) {
                return null;
            }

            const before = model.editor.getEditorState();

            this.runOnCommandEditor(model.editor, command);

            const changed = model.editor.getEditorState() !== before;

            return changed ? this.editOfModel(model, text, window) : null;
        } finally {
            model.release();
        }
    }

    /**
     * Places the source selection in the model.
     *
     * @param model - The model editor.
     * @param imported - The text the model imported.
     * @param from - The selection's start offset in `imported`.
     * @param to - The selection's end offset in `imported`.
     * @returns `true` when the selection was placed and touches no raw block.
     */
    private selectInModel(model: ModelEditor, imported: string, from: number, to: number): boolean {
        let applies = false;

        model.editor.update(() => {
            const placed = $selectSourceRange(imported, model.sourceMap, from, to);

            applies = placed && !$selectionTouches($isMarkdownRawBlockNode);
        }, { discrete: true });

        return applies;
    }

    /**
     * Calls the command with the model standing in for the WYSIWYG editor.
     *
     * @param editor - The model editor.
     * @param command - The command.
     */
    private runOnCommandEditor(editor: LexicalEditor, command: () => unknown): void {
        this._commandEditor = editor;

        try {
            command();
        } finally {
            this._commandEditor = null;
        }
    }

    /**
     * The edit of the document a command made on the model.
     *
     * @param model - The model editor, after the command.
     * @param text - The document.
     * @param window - The part of the document the model imported.
     * @returns The edit with the selection to leave; `null` when the text is as it was; {@link WINDOW_LOST} when the definitions the window carried are not written back unchanged.
     */
    private editOfModel(model: ModelEditor, text: string, window: SourceWindow): ModelResult {
        const { saved, range } = model.editor.read(() => {
            const written = $serializeMarkdownWithPlaces(model.sourceMap);

            return { saved: written, range: $sourceRangeOfSelection(written.text, written.places) };
        });

        const carriedBack = saved.text.length >= window.before.length + window.after.length
            && saved.text.startsWith(window.before) && saved.text.endsWith(window.after);

        if (!carriedBack) {
            return WINDOW_LOST;
        }

        const written = saved.text.slice(window.before.length, saved.text.length - window.after.length);
        const change = smallestEdit(text.slice(window.start, window.end), written);

        if (change === null) {
            return null;
        }

        const endOfChange = change.from + change.insert.length;
        const inWritten = (offset: number | null | undefined): number => (
            offset === null || offset === undefined ? endOfChange : Math.max(0, Math.min(offset - window.before.length, written.length))
        );

        const ends = [inWritten(range?.from), inWritten(range?.to)];

        return {
            from:      change.from + window.start,
            to:        change.to + window.start,
            insert:    change.insert,
            selection: { from: Math.min(...ends) + window.start, to: Math.max(...ends) + window.start },
        };
    }

    /**
     * Builds the model editor a source-mode command runs on: loaded as
     * {@link buildEditor} loads the WYSIWYG editor, with the same rules, and
     * reporting nothing.
     *
     * @param markdown - The Markdown to import.
     * @returns The model editor, its source map and the call that releases its registrations.
     */
    private buildModelEditor(markdown: string): ModelEditor {
        const editor = createEditor({ nodes: EDITOR_NODES, theme: EDITOR_THEME, onError: reportEditorError });
        const unregisterWritableStateRules = registerWritableStateRules(editor);
        let sourceMap: MarkdownSourceMap = EMPTY_SOURCE_MAP;

        editor.update(() => {
            sourceMap = $importMarkdown(markdown);
        }, { discrete: true });

        const release = mergeRegister(unregisterWritableStateRules, this.registerEditorRules(editor, null));

        // Registering a node transform marks every node of its type dirty in an update of its own, which the WYSIWYG
        // editor commits before a command can act; the model commits it here, before the selection goes in.
        editor.update(() => {}, { discrete: true });

        return { editor, sourceMap, release };
    }

    /**
     * Whether the WYSIWYG selection touches a raw Markdown block or a code
     * block, where the commands that format, link or insert decline, as the
     * typing shortcuts do: what they would add there is shown but not saved,
     * both blocks saving their text as written. The commands an availability
     * field covers read that field instead ({@link commandApplies}), which
     * holds this test; this is what is left for `toggleLink(null)`, which no
     * field covers.
     *
     * @returns `true` when any part of the selection lies in a raw block or a
     *   code block.
     */
    private declinesInTextOnlyBlock(): boolean {
        return this.ensureEditor().read($selectionTouchesTextOnlyBlock);
    }

    /**
     * Whether the commands an availability field covers would apply at the
     * WYSIWYG selection. Every such command declines on this before it
     * touches the document or the selection, and it is the field the context
     * menu and the selection state report ({@link $readCommandAvailability}),
     * so what is dimmed and what a command does cannot come apart: a command
     * whose field is `false` changes nothing and reports nothing. A format, style
     * or link the save could not write is still declined when tried, and then
     * leaves the document and the selection as they were. No command
     * applies on a read-only editor, which is refused here for all of them,
     * before the Lexical editor is so much as built, and reported
     * ({@link refuseIfReadOnly}).
     *
     * A command that applies takes the keyboard here, ahead of its update
     * ({@link refocusSurface}); one that declines changes nothing, the focus
     * included.
     *
     * @param field - The field covering the command.
     * @returns `false` where the command would do nothing, and always while
     *   the editor is read-only.
     */
    private commandApplies(field: keyof CommandAvailability): boolean {
        const refused = this.refuseIfReadOnly();

        if (refused) {
            return false;
        }

        const applies = this.ensureEditor().read(() => $readCommandAvailability($computeWordExpansion())[field]);

        // The keyboard goes to the surface before the command's update: a toolbar or menu click took it off.
        if (applies) {
            this.refocusSurface();
        }

        return applies;
    }

    /**
     * Reports an edit refused on the WYSIWYG surface because the editor is
     * read-only: emits `"readonlyedit"` and plays the rejection wash, the
     * event and the cue a read-only `CodeEditor` gives. One call for each
     * refused edit, whichever way it came: a key or another input the
     * surface cancelled, a Lexical command the guard refused, or a command
     * called from code.
     */
    private signalReadOnlyEdit(): void {
        this.emit("readonlyedit");
        this._flash.play();
    }

    /**
     * `WysiwygSurface`'s `"readonlyenter"` handler: follows the link the
     * editor's caret is in ({@link followLink}) and cancels the key, so
     * that the browser announces no edit for it. With the caret in no link,
     * text selected, or a link whose address is not opened, the key is left
     * alone, and is the refused edit Enter is anywhere else. No-op before
     * the editor is built.
     *
     * The caret is the editor's own, which follows the browser's, and the
     * link is the one the selection state reports for it
     * ({@link $linkUrlToFollowAtCaret}). The editor hears of a caret the
     * browser has moved a moment later, so a key pressed with no gap after
     * an arrow key is decided on the caret from before the arrow: the same
     * link `getSelectionState().linkUrl` reports at that instant.
     *
     * @param event - The native `keydown` event of the Enter key.
     */
    private handleReadOnlyEnter(event: KeyboardEvent): void {
        const editor = this._editor;
        const address = editor ? editor.read($linkUrlToFollowAtCaret) : null;

        if (address !== null) {
            event.preventDefault();
            this.followLink(address);
        }
    }

    /**
     * `WysiwygSurface`'s `"readonlypress"` handler: notes what the browser
     * has selected as the pointer is pressed over the read-only surface,
     * for the click that follows ({@link handleReadOnlyClick}). No-op before
     * the editor is built.
     */
    private handleReadOnlyPress(): void {
        const editor = this._editor;

        this._selectionBeforePress = editor ? editor.read(() => $selectionMark(editor)) : null;
    }

    /**
     * `WysiwygSurface`'s `"readonlyclick"` handler: follows the link a click
     * or a middle click on the read-only surface was on ({@link followLink}).
     * In a read-only editor a click on a link is the editor's alone: the
     * click's default is cancelled whether the link is then followed or not,
     * so the browser never follows it by itself. No-op before the editor is
     * built.
     *
     * The click uses up the selection noted at its press: a click that
     * comes with no press of its own finds none.
     *
     * @param event - The native `click` or `auxclick` event.
     */
    private handleReadOnlyClick(event: MouseEvent): void {
        const editor = this._editor;
        const markBeforePress = this._selectionBeforePress;

        this._selectionBeforePress = null;

        const address = editor ? editor.read(() => $takeLinkClick(editor, event, markBeforePress)) : null;

        if (address !== null) {
            this.followLink(address);
        }
    }

    /**
     * Opens a link of a read-only editor in a new tab, as the
     * [`Markdown`](/api/component/display/classes/Markdown) viewer opens
     * its links by default: through a temporary anchor with
     * `target="_blank"` and `rel="noopener noreferrer"`, clicked and removed
     * again, which is how `Table`'s export starts its download. The
     * surface's own `<a>` cannot be used: inside an editing host a browser
     * follows no link, and its `href` is not the address as written.
     *
     * @param address - The address to open: the link's own, already found
     *   to be one that is opened from a document.
     */
    private followLink(address: string): void {
        const anchor = DOM.sink.createElement("a");
        const body = DOM.source.getBody();

        DOM.sink.apply(anchor, { setAttr: { href: address, target: "_blank", rel: "noopener noreferrer" } });
        DOM.sink.appendChild(body, anchor);
        DOM.sink.click(anchor);
        DOM.sink.removeChild(body, anchor);
        DOM.sink.release(anchor);
    }

    /**
     * The read-only test of every editing command on the WYSIWYG surface:
     * where the editor is read-only the refusal is reported
     * ({@link signalReadOnlyEdit}).
     *
     * @returns Whether the editor is read-only, so that the caller must
     *   return without touching the document or the selection.
     */
    private refuseIfReadOnly(): boolean {
        const readOnly = this.getReadOnly();

        if (readOnly) {
            this.signalReadOnlyEdit();
        }

        return readOnly;
    }

    /**
     * The editor whose view the read-only surface shows, for
     * {@link takeOutView} and {@link restoreView}: the one that is mounted
     * there, or is out of it for a moment.
     *
     * @returns The editor, or `null` before it is built, before its view is
     *   mounted, and offline.
     */
    private editorWithView(): LexicalEditor | null {
        const editor = this._editor;
        const hasView = editor !== null && (editor.getRootElement() !== null || this._wysiwyg.isViewOut());

        return hasView ? editor : null;
    }

    /**
     * `WysiwygSurface`'s `"unpreventableedit"` handler: takes the editor's
     * view out of the read-only surface before the browser makes a change
     * that could not be cancelled (a composition's text). No-op before the
     * editor is built, and offline.
     *
     * @remarks
     * Lexical's mutation observer asks neither whether the editor is
     * editable nor what made a change: it copies text it finds changed in
     * the surface's elements into the document. It is told of a change in a
     * microtask, and a browser runs microtasks after each listener of an
     * event. So putting the shown text back once the browser reports its
     * change ({@link restoreView}) is in time only where no listener heard
     * of the change first, and a host's listener on the window, or one a
     * browser extension put there, can be ahead of the framework's. Taking
     * the view out here, while nothing has changed yet, takes the observer
     * out with it: what the browser then writes, it writes into a surface
     * the editor is not looking at, whichever listener hears of it first.
     *
     * The view is put back when the browser reports the change
     * ({@link restoreView}), in the same task, so that the surface is never
     * painted without it; and a task or a frame later at the latest
     * ({@link finishViewRestore}), for a change announced and never made.
     */
    private takeOutView(): void {
        const editor = this.editorWithView();

        if (!editor) {
            return;
        }

        this.scheduleViewRestore(editor);
        this._wysiwyg.takeOutView(editor);
    }

    /**
     * `WysiwygSurface`'s `"uncancelledinput"` handler: puts the view back to
     * what the document holds, after the browser changed the read-only
     * surface in a way that could not be cancelled. No-op before the editor
     * is built, and offline.
     *
     * @remarks
     * The view is rendered anew, whole. A composition does more than change
     * a text: over a selection the browser removes elements, splits text
     * nodes and moves them into wrappers of its own. No repair of single
     * nodes covers every such shape, so none is attempted.
     *
     * For a change the browser announced, the view was taken out before it
     * was made ({@link takeOutView}) and is put back here. A change made
     * with no announcement finds the view in place, and it is taken out and
     * put back here in one go. That is in time only where this is the first
     * listener to hear of the change: see {@link takeOutView}. No key,
     * paste, drop or composition changes the surface unannounced; a script
     * can.
     *
     * The browser's selection goes with the elements it was in, and the
     * browser sets one of its own once the event is over. So the selection
     * Lexical holds, which is still the one from before the browser's
     * change, is written back a task or a frame later ({@link finishViewRestore}),
     * with the surface's scroll offsets.
     */
    private restoreView(): void {
        const editor = this.editorWithView();

        if (!editor) {
            return;
        }

        this.scheduleViewRestore(editor);
        this._wysiwyg.remount(editor);
    }

    /**
     * Schedules the second half of a view restore
     * ({@link finishViewRestore}) and keeps the selection for it. Call it
     * before the view is taken out. No-op while a restore waits: that one
     * holds the selection from before the first change of a burst, which is
     * the one to keep.
     *
     * @remarks
     * The second half is scheduled twice, as a task and for the next
     * animation frame, and runs in whichever comes first. Either is late
     * enough: both come after the event in which the browser changed the
     * view, and so after the selection the browser sets at its end. The
     * frame is there for what is seen. For that selection, at the
     * document's start, the browser also scrolls the surface there, and a
     * frame can be painted before a task runs: the document's start would
     * show for the length of a frame at every refused keystroke. A frame's
     * callbacks run before it is painted, so the offsets are back by then.
     * The task is there for a page that paints no frames, a hidden one.
     *
     * @param editor - The editor whose view is about to be rendered anew.
     */
    private scheduleViewRestore(editor: LexicalEditor): void {
        if (this._viewRestore !== null) {
            return;
        }

        const selection = editor.read(() => $getSelection()?.clone() ?? null);
        const finish = (): void => this.finishViewRestore(editor, selection);

        this._viewRestore = {
            task:  DOM.sink.setTimeout(finish, VIEW_RESTORE_DELAY_MS),
            frame: DOM.sink.requestAnimationFrame(finish),
        };
    }

    /**
     * Calls off a view restore that waits ({@link scheduleViewRestore}):
     * its task and its animation frame both. No-op where none waits.
     */
    private cancelViewRestore(): void {
        const waiting = this._viewRestore;

        if (waiting === null) {
            return;
        }

        this._viewRestore = null;
        DOM.sink.clearTimeout(waiting.task);
        DOM.sink.cancelAnimationFrame(waiting.frame);
    }

    /**
     * The second half of a view restore, a task or a frame after
     * {@link takeOutView} or {@link restoreView} began it
     * ({@link scheduleViewRestore}): puts back a view that is still out,
     * writes the selection the editor held back to the browser, and puts
     * the surface's scroll offsets back, which the browser moved for the
     * selection it set itself in between.
     *
     * @remarks
     * Lexical writes its selection to the browser only while it is
     * editable, so it is made editable for the length of the one update
     * that sets the selection, and no longer. No event is handled in
     * between: the three calls run one after the other. The update scrolls
     * nothing. It is skipped where the selection's nodes are gone, the host
     * having loaded another document meanwhile, and where the surface does
     * not hold the keyboard: a browser gives the focus to an editing host a
     * selection is set in, and a view changed from elsewhere must not take
     * it.
     *
     * While the restore waited, the editor's selection followed the one the
     * browser set in between, and no `"selectionstate"` was emitted for it
     * ({@link updateSelectionState}). The state is compared here, once, with
     * the last one reported: with the selection written back it is the
     * same, and nothing is emitted.
     *
     * @param editor - The editor whose view was rendered anew.
     * @param selection - The selection it held before, or `null` for none.
     */
    private finishViewRestore(editor: LexicalEditor, selection: BaseSelection | null): void {
        this._wysiwyg.putBackView(editor);

        const scrollTop = this._wysiwyg.getScrollTop();
        const scrollLeft = this._wysiwyg.getScrollLeft();
        const holdsFocus = this._wysiwyg.holdsFocus();

        // Run from the task or from the frame: the other is called off.
        this.cancelViewRestore();

        if (selection !== null && holdsFocus) {
            editor.setEditable(true);

            editor.update(() => {
                const stillThere = (selection.getStartEndPoints() ?? []).every((point) => $getNodeByKey(point.key) !== null);

                if (stillThere) {
                    $setSelection(selection.clone());
                }
            }, { discrete: true, tag: [HISTORY_MERGE_TAG, SKIP_SCROLL_INTO_VIEW_TAG] });

            editor.setEditable(!this.getReadOnly());
        }

        this._wysiwyg.setScrollTop(scrollTop);
        this._wysiwyg.setScrollLeft(scrollLeft);
        this.updateSelectionState();
    }

    /**
     * Hands keyboard focus to the WYSIWYG surface. A toolbar button or a menu
     * row takes it off the surface before its command runs, and every command
     * that applies calls this before its update ({@link commandApplies}), so
     * the focus event Lexical's commit would raise is not raised inside that
     * commit. A command that finds nothing to change runs no update at all,
     * and would leave the keyboard on the control that was clicked. The
     * document, the selection and the undo history stay as they are.
     *
     * An editable editor's surface element is focused first where that keeps
     * the selection ({@link $surfaceFocusKeepsSelection}) — with table cells
     * selected Lexical focuses nothing — then Lexical's own `focus()` is
     * called, which writes its selection to the browser with the focus. A
     * read-only one is focused through its surface alone: Lexical writes no
     * selection while it is not editable, so the browser's selection is the
     * only one, and the browser keeps a caret it already holds in the
     * surface.
     *
     * @param preventScroll - Whether to keep the browser from scrolling a
     *   read-only surface into view. An editable surface's element is always
     *   focused with `preventScroll: true`, and Lexical manages its own focus
     *   scroll.
     * @returns This component, for method chaining.
     */
    private refocusSurface(preventScroll: boolean = false): this {
        // A run on the model leaves keyboard focus where the source editor has it.
        if (this._commandEditor !== null) {
            return this;
        }

        const readOnly = this.getReadOnly();

        if (readOnly) {
            this._wysiwyg.focus(preventScroll);

            return this;
        }

        const editor = this.ensureEditor();
        const mounted = editor.getRootElement() !== null;
        const keepsSelection = mounted && editor.read(() => $surfaceFocusKeepsSelection(editor));

        if (keepsSelection) {
            this._wysiwyg.focus(true);
        }

        editor.focus();

        return this;
    }

    /**
     * Whether the WYSIWYG surface holds keyboard focus.
     *
     * @returns `true` when the focused element is the surface's element or inside it.
     */
    private surfaceHoldsKeyboard(): boolean {
        const element = this._wysiwyg.getElement();

        if (!element) {
            return false;
        }

        return DOM.source.contains(element, DOM.source.getActiveElement());
    }

    /**
     * Replaces the WYSIWYG document with `markdown`, in one discrete update.
     * Keyboard focus stays where it is: when the surface does not hold it,
     * the load is tagged to leave the browser's selection and focus alone,
     * since writing Lexical's selection to the browser is what pulls the
     * keyboard into the editor. When the surface holds it, the caret goes to
     * the document's start as before.
     *
     * @param editor - The Lexical editor.
     * @param markdown - The Markdown to load.
     */
    private loadWysiwygDocument(editor: LexicalEditor, markdown: string): void {
        const holdsKeyboard = this.surfaceHoldsKeyboard();
        const options: EditorUpdateOptions = holdsKeyboard ? { discrete: true } : { discrete: true, tag: SKIP_DOM_SELECTION_TAG };

        // Discrete forces a synchronous commit, so the resulting `"change"` fires before the caller returns.
        editor.update(() => {
            this.adoptSourceMap($importMarkdown(markdown));
        }, options);
    }

    /**
     * Shared body of {@link MarkdownEditor.toggleUnorderedList} and
     * {@link MarkdownEditor.toggleOrderedList} on the WYSIWYG surface, in one
     * update, so one undo step ({@link $toggleListOfTouchedBlocks}). Where
     * every block the selection touches opens an item of a list of `type`
     * the toggle is off: those items leave their list, the list split around
     * them, which is what the source-mode toggle does to the same lines.
     * Otherwise each block that does not open such an item yet becomes an
     * item of such a list, taken out of the lists it was in. The blocks are
     * blocks of text, read from the selection's ends and the selected
     * leaves, so each end is first settled into one
     * ({@link $settleEndsIntoBlocksOfText}): a caret on a node that holds
     * blocks — where a deleted table leaves it — goes into the block of
     * text beside it, and into a new empty paragraph where it has a table,
     * or nothing, on both sides, as in a column or a document that a
     * deleted table left empty; the toggle makes that paragraph an item.
     * An end of a range that stands on such a node goes into the nearest
     * block of text inside the range, so no block outside it is changed.
     * Where `canSetBlockType` is true every end so has a block, and the
     * toggle changes the document.
     *
     * @param type - The kind of list toggled.
     */
    private toggleList(type: ListType): void {
        this.ensureEditor().update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return;
            }

            $settleEndsIntoBlocksOfText(selection);
            $toggleListOfTouchedBlocks(selection, type);
        }, { discrete: true });
    }

    /**
     * Switches the active editing surface. Converts the current document across
     * the surfaces so no edits are lost — the outgoing surface's Markdown is read
     * (via {@link MarkdownEditor.getValue}) before the mode flips, then loaded
     * into the incoming surface — and swaps the visible [`Card`](/api/layout/classes/Card) child.
     * No-op (no conversion, no `"change"`) when already in `mode`. Otherwise
     * emits a fresh `"selectionstate"` for the newly-shown surface, so a
     * toolbar's pressed/enabled state never keeps what the outgoing surface
     * last reported. It is emitted once the surface is the one shown, in
     * either direction, also when the switch is what first builds the
     * Lexical editor. Loading into the WYSIWYG surface leaves keyboard focus
     * where it is.
     *
     * @param mode - The surface to show.
     * @returns This component, for method chaining.
     */
    setMode(mode: MarkdownEditorMode): this {
        const current = this.getMode();

        if (current === mode) {
            return this;
        }

        // Read the canonical Markdown from the OUTGOING surface before the flip.
        const markdown = this.getValue();
        this._options.mode = mode;

        // The incoming surface is shown first, in both directions: loading into it reports the selection
        // state (a mounted source view reports its change at once, and so does building the Lexical
        // editor), and a listener must find the surface that state describes already showing.
        if (mode === "source") {
            this._card.setVisibleComponentId(this._codeEditor.getId());
            this._codeEditor.setValue(markdown);
        } else {
            this._card.setVisibleComponentId(this._wysiwyg.getId());

            // As in setValue(): an editor not built yet is built with the document it has, which is replaced
            // right here, so that document's selection state is not reported, only the loaded one's.
            const editor = this._editor ?? this.buildEditor();

            this.loadWysiwygDocument(editor, markdown);
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
     * flags, which commands would apply, table/column-alignment
     * context, and enclosing-block alignment/column count — recomputed fresh
     * from whichever surface is active on every call, mirroring
     * `CodeEditor.getCursorPosition`'s own always-fresh contract; nothing is
     * cached here beyond what `updateSelectionState` needs for its own
     * emit-dedup. In `"source"` mode the five format flags, `hasSelectedText`
     * and `linkUrl` are derived from the raw Markdown, read as the viewer
     * reads it; the `can…` fields are `true` (`canRemoveLink` only inside a
     * link) except `canSetBlockLayout` and the three table fields, the
     * alignment, column and table commands being no-ops there; and
     * `inTable`/`tableColumnAlignment`/`blockAlignment`/`columnCount` report
     * the fields that mode has no notion of. While the editor is read-only
     * every `can…` field is `false`, on either surface.
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
     * disable the controls those fields drive. Where a source-mode command
     * declines depends on the raw text around the selection, which is not
     * predicted, so the `can…` fields of the commands that mode has are
     * `true`, except `canRemoveLink`, which is `true` only inside a link;
     * `canSetBlockLayout`, `canEditTable`, `canMergeCells` and
     * `canUnmergeCell` are `false`, the alignment, column and table commands
     * being no-ops there.
     *
     * @returns The current {@link MarkdownEditorSelectionState}.
     */
    private readSurfaceSelectionState(): MarkdownEditorSelectionState {
        if (this.isSourceMode()) {
            const selection = this._codeEditor.getSelection();
            const source = readSourceSelectionState(this._codeEditor.getValue(), selection.from, selection.to);

            return {
                ...source,
                canFormat:            true,
                canStyle:             true,
                canLink:              true,
                canRemoveLink:        source.linkUrl !== null,
                canSetBlockType:      true,
                canSetBlockLayout:    false,
                canInsertTable:       true,
                canInsertImage:       true,
                canEditTable:         false,
                canMergeCells:        false,
                canUnmergeCell:       false,
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
     * The tracked selection state of the active surface as the editor
     * reports it: what {@link readSurfaceSelectionState} reads, with every
     * `can…` field `false` while the editor is read-only, where each editing
     * command is refused on both surfaces.
     *
     * @returns The current {@link MarkdownEditorSelectionState}.
     */
    private readActiveSelectionState(): MarkdownEditorSelectionState {
        const state = this.readSurfaceSelectionState();
        const readOnly = this.getReadOnly();

        return readOnly ? { ...state, ...NO_COMMAND_APPLIES } : state;
    }

    /**
     * Replaces the whole document from a Markdown string, targeting the active
     * surface: the source `CodeEditor` in `"source"` mode, else the Lexical
     * editor (building it if needed). A resulting content change fires
     * `"change"`, and `"selectionstate"` fires when the loaded document's
     * state differs from the last one reported. Keyboard focus stays where it
     * is: a host that wants the caret in the editor after a load calls
     * {@link MarkdownEditor.focus}.
     *
     * @param value - The new Markdown source.
     * @returns This component, for method chaining.
     */
    setValue(value: string): this {
        const sourceMode = this.isSourceMode();

        if (sourceMode) {
            this._codeEditor.setValue(value);

            return this;
        }

        // An editor not built yet is built with the document it has, and that document is replaced
        // right here: its selection state is not reported, only the loaded one's is, by the update.
        const editor = this._editor ?? this.buildEditor();

        this.loadWysiwygDocument(editor, value);

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
     * state; when the Lexical editor exists, toggles its editable flag, so it
     * stops acting on input; tells the WYSIWYG surface, which from then on
     * cancels the edits the browser offers; and forwards to the source
     * `CodeEditor`.
     *
     * A read-only editor keeps its caret on both surfaces: it stays a tab
     * stop, the keyboard and the mouse move the caret and select text, and
     * the selection is copied as before. The selection is left as it is by
     * this call, in both directions.
     *
     * While read-only, nothing changes the document: typing, Enter, a
     * deletion, a paste, a cut, a drop, a composition and the browser's
     * format shortcuts are refused, and so is every command that edits,
     * called from code or from a menu. A refused edit leaves the document,
     * the selection and the undo history as they are, fires
     * `"readonlyedit"` and flashes the surface it was made on. The undo and
     * redo keys do nothing, and are not reported.
     * `cut()` and `paste()` are refused on both surfaces; `copy()` still
     * copies. The `can…` fields of the selection state are then all `false`,
     * and `"selectionstate"` fires when this call changes them. Replacing
     * the whole document with `setValue` stays possible, as it does on a
     * read-only `CodeEditor`: read-only guards against edits, not against
     * the host loading another document.
     *
     * @param readOnly - Whether the editor should reject edits.
     * @returns This component, for method chaining.
     */
    setReadOnly(readOnly: boolean): this {
        this._options.readOnly = readOnly;
        this._editor?.setEditable(!readOnly);
        this._wysiwyg.setReadOnly(readOnly);
        this._codeEditor.setReadOnly(readOnly);
        this.updateSelectionState();

        return this;
    }

    /**
     * Moves keyboard focus into the active editing surface, placing a caret
     * there: the Lexical contenteditable in WYSIWYG mode (an editable editor
     * is built first if it was not yet), or the source `CodeEditor` in
     * `"source"` mode. A read-only editor takes focus and shows a caret on
     * both surfaces, for moving through the text and selecting it.
     *
     * Overrides {@link core!Component.focus}, whose default focuses this component's
     * own host element — the `Card` wrapper — which would leave the caret out of
     * the nested contenteditable the typing must land in. In WYSIWYG mode an
     * editable editor defers to Lexical's own `focus`, which both focuses
     * the root element and sets a selection so a caret appears without a
     * click. A read-only editor's surface is focused directly: the browser
     * keeps a caret it already holds there, and otherwise puts one at the
     * start of the document.
     *
     * @param preventScroll - Forwarded to the source `CodeEditor` in `"source"`
     *   mode and to a read-only WYSIWYG surface; ignored on an editable
     *   WYSIWYG surface, where Lexical manages its own focus scroll.
     * @returns This component, for method chaining.
     */
    focus(preventScroll: boolean = false): this {
        const sourceMode = this.isSourceMode();

        if (sourceMode) {
            this._codeEditor.focus(preventScroll);

            return this;
        }

        return this.refocusSurface(preventScroll);
    }

    /**
     * Shared body of the five format toggles on the WYSIWYG surface: reads
     * `canFormat`, then, in one discrete update, widens a collapsed caret to
     * its enclosing word and formats it ({@link $formatWritably}). The
     * keyboard shortcuts reach the same formatting through the command
     * handler instead, which does not widen. A format the save cannot write
     * is declined after trying, and the caret is put back as it was. No-op
     * where `canFormat` is `false`.
     *
     * @param format - The format to toggle.
     * @returns This component, for method chaining.
     */
    private toggleFormat(format: TextFormatType): this {
        const applies = this.commandApplies("canFormat");

        if (!applies) { return this; }

        this.ensureEditor().update(() => {
            $formatWritably(format, $cellTakesFormat, $selectEnclosingWordIfCollapsed);
        }, { discrete: true });

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
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    toggleBold(): this {
        const handledBySource = this.editSourceThroughModel(() => this.toggleBold());

        if (handledBySource) { return this; }

        return this.toggleFormat("bold");
    }

    /**
     * Toggles italic on the current selection, first expanding a collapsed
     * caret to its enclosing word. No-op without a range selection, when the
     * selection touches a raw Markdown block or a code block, or when it holds
     * a run kept as Markdown source. Whole table cells selected take the
     * format cell by cell, as {@link MarkdownEditor.toggleBold} describes.
     *
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    toggleItalic(): this {
        const handledBySource = this.editSourceThroughModel(() => this.toggleItalic());

        if (handledBySource) { return this; }

        return this.toggleFormat("italic");
    }

    /**
     * Toggles inline code on the current selection, first expanding a
     * collapsed caret to its enclosing word or run. No-op without a range
     * selection, when the selection touches a raw Markdown block or a code
     * block, or when it holds a run kept as Markdown source. Whole table
     * cells selected take the format cell by cell, as
     * {@link MarkdownEditor.toggleBold} describes.
     *
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    toggleInlineCode(): this {
        const handledBySource = this.editSourceThroughModel(() => this.toggleInlineCode());

        if (handledBySource) { return this; }

        return this.toggleFormat("code");
    }

    /**
     * Toggles strikethrough on the current selection, first expanding a
     * collapsed caret to its enclosing word. No-op without a range selection,
     * when the selection touches a raw Markdown block or a code block, or when
     * it holds a run kept as Markdown source. Whole table cells selected take
     * the format cell by cell, as {@link MarkdownEditor.toggleBold} describes.
     *
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    toggleStrikethrough(): this {
        const handledBySource = this.editSourceThroughModel(() => this.toggleStrikethrough());

        if (handledBySource) { return this; }

        return this.toggleFormat("strikethrough");
    }

    /**
     * Toggles underline on the current selection, first expanding a collapsed
     * caret to its enclosing word. No-op without a range selection, when the
     * selection touches a raw Markdown block or a code block, or when it holds
     * a run kept as Markdown source. Whole table cells selected take the
     * format cell by cell, as {@link MarkdownEditor.toggleBold} describes.
     *
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    toggleUnderline(): this {
        const handledBySource = this.editSourceThroughModel(() => this.toggleUnderline());

        if (handledBySource) { return this; }

        return this.toggleFormat("underline");
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
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @param patch - Kebab-case CSS property names mapped to their new value,
     *   or `null` to remove that property.
     * @returns This component, for method chaining.
     */
    private patchSelectionStyle(patch: Record<string, string | null>): this {
        const handledBySource = this.editSourceThroughModel(() => this.patchSelectionStyle(patch));

        if (handledBySource) {
            return this;
        }

        const applies = this.commandApplies("canStyle");

        if (!applies) { return this; }

        this.ensureEditor().update(() => {
            $editWritably(() => {
                $selectEnclosingWordIfCollapsed();

                const selection = $getSelection();

                if ($isRangeSelection(selection)) {
                    $patchStyleText(selection, patch);
                }
            });
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
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
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
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
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
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @param size - A CSS font-size value (e.g. `"1.2em"`), or `null` to clear
     *   the override.
     * @returns This component, for method chaining.
     */
    setFontSize(size: string | null): this {
        return this.patchSelectionStyle({ "font-size": size });
    }

    /**
     * Converts the selected blocks into an unordered (bulleted) list, or out
     * of one. When every selected block is the text an item of a bulleted
     * list opens with, those items leave the list: each text becomes a
     * paragraph, the blocks its item holds up to its first nested list follow
     * it, and the list is split around them; a task item's `[ ]` / `[x]`
     * marker stays as the text it shows. Otherwise every other selected
     * block becomes a bulleted item where the block stands: at the top
     * level, in its `:::` column or in its quote. An item of a numbered list changes alone, its list split
     * around it and the blocks it holds up to its first nested list kept in
     * it, and a new item joins a bulleted list right before or after it.
     * No-op without a range selection, and when the selection touches a
     * table cell (whole cells selected included), which holds text only.
     *
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    toggleUnorderedList(): this {
        const handledBySource = this.editSourceThroughModel(() => this.toggleUnorderedList());

        if (handledBySource) { return this; }

        const applies = this.commandApplies("canSetBlockType");

        if (!applies) { return this; }

        this.toggleList("bullet");

        return this;
    }

    /**
     * Converts the selected blocks into an ordered (numbered) list, or out
     * of one. When every selected block is the text an item of a numbered
     * list opens with, those items leave the list: each text becomes a
     * paragraph, the blocks its item holds up to its first nested list follow
     * it, and the list is split around them; a task item's `[ ]` / `[x]`
     * marker stays as the text it shows. Otherwise every other selected
     * block becomes a numbered item where the block stands: at the top
     * level, in its `:::` column or in its quote. An item of a bulleted list changes alone, its list split
     * around it and the blocks it holds up to its first nested list kept in
     * it, and a new item joins a numbered list right before or after it.
     * No-op without a range selection, and when the selection touches a
     * table cell (whole cells selected included), which holds text only.
     *
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    toggleOrderedList(): this {
        const handledBySource = this.editSourceThroughModel(() => this.toggleOrderedList());

        if (handledBySource) { return this; }

        const applies = this.commandApplies("canSetBlockType");

        if (!applies) { return this; }

        this.toggleList("number");

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
     * Markdown source. With a URL, a caret with no word under it and outside
     * a link is a no-op too, as there is nothing to link.
     *
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @param url - The link target, or `null` to remove the link.
     * @returns This component, for method chaining.
     */
    toggleLink(url: string | null): this {
        const handledBySource = this.editSourceThroughModel(() => this.toggleLink(url));

        if (handledBySource) { return this; }

        if (url === null) {
            this.unlinkSelection();

            return this;
        }

        const applies = this.commandApplies("canLink");

        if (!applies) { return this; }

        this.ensureEditor().update(() => {
            $editWritably(() => {
                $selectEnclosingWordIfCollapsed();
                $toggleLink(url);
            });
        }, { discrete: true });

        return this;
    }

    /**
     * The `toggleLink(null)` path on the WYSIWYG surface. Unlinking has no
     * field of its own: it declines where the selection touches a block
     * holding text only, and, found inside the update, where it covers a
     * run kept as Markdown source or sits in a link nested in another link.
     * No-op on a read-only editor, which is refused and reported.
     */
    private unlinkSelection(): void {
        const refused = this.refuseIfReadOnly();

        if (refused) { return; }

        const declinedInTextOnlyBlock = this.declinesInTextOnlyBlock();

        if (declinedInTextOnlyBlock) { return; }

        // No field covers this path, so it takes the keyboard itself, as `commandApplies` does for the others.
        this.refocusSurface();

        this.ensureEditor().update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return;
            }

            // `$toggleLink(null)`'s `$splitLinkAtSelection` throws when an end only touches a link's edge.
            $moveRangeEdgesOutOfLinks(selection);

            const coversSourceRun = $selectionCoversSourceRun();
            const inNestedLinkRun = $selectionInNestedLinkRun();

            if (coversSourceRun || inNestedLinkRun) {
                return;
            }

            $editWritably(() => {
                $toggleLink(null);
            });
        }, { discrete: true });
    }

    /**
     * Removes the link enclosing the current selection, unwrapping it back to
     * plain text and keeping the text content — the whole link, regardless of
     * how much of it (if any) is currently selected. No-op (without throwing)
     * when there is no range selection, or it is not inside a link.
     *
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    removeLink(): this {
        const handledBySource = this.editSourceThroughModel(() => this.removeLink());

        if (handledBySource) { return this; }

        const applies = this.commandApplies("canRemoveLink");

        if (!applies) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return;
            }

            const linkNode = $findEnclosingLinkNode(selection.anchor.getNode());

            if (linkNode === null) {
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
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @returns This component, for method chaining.
     */
    clearFormatting(): this {
        const handledBySource = this.editSourceThroughModel(() => this.clearFormatting());

        if (handledBySource) { return this; }

        const applies = this.commandApplies("canClearFormatting");

        if (!applies) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return;
            }

            $editWritably(() => {
                for (const node of selection.getNodes()) {
                    if ($isTextNode(node)) {
                        node.setFormat($formatOnceCleared(node));
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
     * nothing to expand into. A selection that runs from outside a table into
     * one of its cells is copied with the whole table, which is what
     * {@link MarkdownEditor.cut} removes; the selection stays as it is.
     *
     * A read-only editor copies as well. At a collapsed caret it copies the
     * enclosing word without selecting it, since its selection is the
     * browser's alone, and keyboard focus goes back to the surface as it does
     * on an editable editor.
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
        const readOnly = this.getReadOnly();
        const copiesNothing = editor.read($copiedSelectionText) === "";

        // Nothing to copy: the clipboard, the selection and the focus are left as they are.
        if (copiesNothing) {
            return this;
        }

        // The keyboard goes back to the surface first, after a menu row's click took it: ahead of the update.
        this.refocusSurface();

        // A read-only editor leaves the selection to the browser: the word is copied without being selected.
        if (!readOnly) {
            editor.update(() => { $selectEnclosingWordIfCollapsed(); }, { discrete: true });
        }

        const text = editor.read($copiedSelectionText);

        // Guarded: writing "" would clobber the clipboard with nothing.
        if (text !== "") {
            DOM.sink.writeClipboardText(text);
        }

        return this;
    }

    /**
     * Writes the current selection's text to the system clipboard, then
     * removes it from the document — first expanding a collapsed caret to
     * its enclosing word via {@link MarkdownEditor.copy}. No-op (without
     * throwing) when there is no range selection, or the selection is
     * collapsed with nothing to expand into. A selection that runs from
     * outside a table into one of its cells is cut with the whole table: the
     * clipboard gets the text that is removed. Refused in a read-only
     * editor, on either surface, as the cut key is on the WYSIWYG surface:
     * nothing is copied and nothing removed, `"readonlyedit"` fires and the
     * surface flashes.
     *
     * In `"source"` mode, delegates to the source editor's own `cut()`
     * instead, which refuses a read-only editor with its rejection flash, as
     * it refuses every other command there.
     *
     * @returns This component, for method chaining.
     */
    cut(): this {
        const sourceMode = this.isSourceMode();

        if (sourceMode) {
            this._codeEditor.cut();

            return this;
        }

        const refused = this.refuseIfReadOnly();

        if (refused) { return this; }

        this.copy();

        this.ensureEditor().update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                $removeGuardedRange(selection);
                selection.removeText();   // a no-op on a collapsed selection
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Reads the system clipboard and inserts the text at the caret, replacing
     * any current selection; into the selected table cells, starting at the
     * cell the selection began in, as Ctrl/Cmd+V does; and at the document's
     * end with no selection.
     *
     * In `"source"` mode, delegates to the source editor's own `paste()`
     * instead, which refuses a read-only editor with its rejection flash.
     *
     * Refused in a read-only editor, on either surface: the clipboard is not
     * read, `"readonlyedit"` fires and the surface flashes.
     *
     * @returns A promise resolving `true` when the clipboard was read (even if
     *   it was empty), or `false` when the read was unavailable or denied, or
     *   not made because the editor is read-only.
     */
    async paste(): Promise<boolean> {
        const sourceMode = this.isSourceMode();

        if (sourceMode) { return this._codeEditor.paste(); }

        const refused = this.refuseIfReadOnly();

        if (refused) { return false; }

        const text = await DOM.source.readClipboardText();

        // See copy(): the keyboard goes back to the surface after the context-menu row's click, even on a denied read.
        this.refocusSurface();

        if (text === null) {
            return false;
        }

        if (text !== "") {
            this.ensureEditor().update(() => {
                let selection = $getSelection();

                // With no selection the text goes in at the document's end, as insertTable() and insertImage() put theirs.
                if (selection === null) {
                    $getRoot().selectEnd();
                    selection = $getSelection();
                }

                if ($isRangeSelection(selection)) {
                    $removeGuardedRangeForInsert(selection);
                }

                // A table selection takes the text into its cells from the one it began in, as Ctrl/Cmd+V does.
                selection?.insertRawText(text);
            }, { discrete: true, tag: PASTE_TAG });
        }

        return true;
    }

    /**
     * Converts the selected blocks to `type` (paragraph, `h1`–`h6` or fenced
     * code) in place, a block in a quote included, or, with `"quote"`, puts
     * them into a quote or takes them out of it. A list item's text is taken
     * out of its lists, and the blocks the item holds up to its first nested
     * list follow it; a task item's marker stays as the text it shows, and in
     * a code block as it was written. No-op without a range selection, and
     * when the selection touches a table cell (whole cells selected
     * included), which holds text only.
     *
     * With `"quote"` the command toggles. Where every block the selection
     * touches stands in a quote, the blocks leave their nearest quote, one
     * level out, the quote split around them. Otherwise every touched block
     * that stands in no quote goes into one, and each run of such blocks
     * standing side by side goes into one quote, which joins a quote right
     * before or after the run. Any other type leaves a block in its quote, so
     * `"paragraph"` on a quoted paragraph changes nothing. Where every block
     * the selection touches is already of `type` the call changes nothing: no
     * block is replaced, so a heading or a code block keeps the form it was
     * written in and a code block its language, and no undo step is added. A
     * caret that stands between two blocks rather than in one, where a
     * deleted table leaves it, is first moved into the block of text beside
     * it — a new empty paragraph in a `:::` column or a document that the
     * table left empty — and an end of a range that stands there into the
     * nearest block of text inside the range, as the list toggles move them.
     *
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
     *
     * @param type - The target block type.
     * @returns This component, for method chaining.
     */
    setBlockType(type: MarkdownBlockType): this {
        const handledBySource = this.editSourceThroughModel(() => this.setBlockType(type));

        if (handledBySource) { return this; }

        const applies = this.commandApplies("canSetBlockType");

        if (!applies) { return this; }

        const editor = this.ensureEditor();

        if (type === "quote") {
            editor.update(() => {
                const selection = $getSelection();

                if ($isRangeSelection(selection)) {
                    $settleEndsIntoBlocksOfText(selection);
                    $toggleQuoteOfTouchedBlocks(selection);
                }
            }, { discrete: true });

            return this;
        }

        const alreadySet = editor.read(() => $selectedBlocksHaveType(type));

        if (alreadySet) { return this; }

        editor.update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return;
            }

            $settleEndsIntoBlocksOfText(selection);

            // Asked again: the blocks of a selection with an end on a node that holds blocks are known only now.
            const isSetOnceSettled = $selectedBlocksHaveType(type);

            if (!isSetOnceSettled) {
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
     * alignment leaves it with no more than one column either — unless its
     * opening line carries the author's own words (`::: tip Title`), which
     * keeps it. No-op
     * without a range selection, and — adding no undo step — when the
     * enclosing fence already has that alignment, or there is none and
     * `align` is `null`.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @param align - The new block alignment, or `null` to clear it.
     * @returns This component, for method chaining.
     */
    setBlockAlignment(align: MarkdownBlockAlignment | null): this {
        const sourceMode = this.isSourceMode();

        if (sourceMode) { return this; }

        const applies = this.commandApplies("canSetBlockLayout");

        if (!applies) { return this; }

        this.ensureEditor().update(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return;
            }

            const existing = $findMatchingParent(selection.anchor.getNode(), $isMarkdownBlockNode);

            if (existing !== null) {
                const isSet = existing.getAlign() === align;

                // Written only where it differs: a write alone marks the block changed, which is an undo step.
                if (!isSet) {
                    existing.setAlign(align);
                }

                const leftBare = existing.canUnwrap();

                if (leftBare) {
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
     * column and no alignment — unless its opening line carries the author's
     * own words (`::: tip Title`), which keeps it. `count` is clamped to 1–6; `null` means one
     * column. No-op without a range selection, and — adding no undo step —
     * when the enclosing fence already has that many columns and that gap,
     * or there is none and one column is asked for.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @param count - The new column count, or `null` to clear it.
     * @param gap - The new column gap override; omitted leaves the existing gap untouched, `null` clears it.
     * @returns This component, for method chaining.
     */
    setColumnCount(count: number | null, gap?: string | null): this {
        const sourceMode = this.isSourceMode();

        if (sourceMode) { return this; }

        const applies = this.commandApplies("canSetBlockLayout");

        if (!applies) { return this; }

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

            // Written only where it differs, as the alignment is.
            const gapDiffers = gap !== undefined && block.getColumnGap() !== gap;

            if (gapDiffers) {
                block.setColumnGap(gap);
            }

            const leftBare = block.canUnwrap();

            if (leftBare) {
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

        const applies = this.commandApplies("canInsertParagraphAroundBlock");

        if (!applies) { return this; }

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

        const applies = this.commandApplies("canInsertParagraphAroundBlock");

        if (!applies) { return this; }

        this.ensureEditor().update(() => { $insertParagraphAroundEnclosingBlock(true); }, { discrete: true });

        return this;
    }

    /**
     * Inserts a table of `rows` rows by `columns` columns at the caret. The
     * first row is the header row, so `insertTable(2, 3)` gives a header row
     * plus one body row. The caret lands in the first header cell. Without
     * a text selection — none at all, or table cells selected — the table
     * goes in at the document's end.
     *
     * No-op, leaving the selection as it is, when the selection touches a raw
     * Markdown block or a code block (or, without a text selection, the
     * document ends in one), and when the table would land inside another
     * table: the selection lies in one table, or, without a text selection,
     * the document ends in one. A selection that runs from outside a table
     * into one of its cells is not such a case, whichever way it was made:
     * it is removed first, that table included, and the new table goes in
     * where it started; where the removal leaves the caret at a raw block, a
     * code block or another table next to it, the new table goes into a new
     * paragraph where the removed one was. `canInsertTable` reports whether
     * the table would go in. The block holding the caret is split only where
     * the caret is inside its content, so no empty quote, heading or list
     * item is left beside the table; in a quote the table goes into the
     * quote, the block split around it; a table that ends its container is
     * followed by an empty paragraph.
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

        const applies = this.commandApplies("canInsertTable");

        if (!applies) { return this; }

        const editor = this.ensureEditor();

        // A freshly built editor may have no selection, so seed one first; a table-edge range is removed first,
        // as insertImage() removes it, or the table would go into the cell the range ends in. The caret that
        // leaves stays out of a block next to the removed table that takes no table: a raw block, a code block,
        // another table. The table is placed by $insertTableAt, which splits the caret's block only where both
        // halves hold content. The removal and the new table are one update, so one undo step.
        editor.update(() => {
            const initial = $getSelection();
            const moved = $settleSelectionOffContainers(initial);
            const isTableEdge = $isTableEdgeRange(initial);
            const hadRange = $isRangeSelection(initial);

            if (isTableEdge) {
                // A range that also takes a list item's text whole joins that item away first, as every removal does.
                $joinCoveredItemTexts(initial);
                $removeTableEdgeRange(initial, $holdsNoTable);
            } else if (!hadRange) {
                $getRoot().selectEnd();
            }

            const selection = $getSelection();
            const hasRange = $isRangeSelection(selection);
            // A point moved off a `:::` block, or between two blocks, may have settled where no table goes (a code block).
            const declinedOnceSettled = moved && !$tableInsertApplies($selectionTouchesTextOnlyBlock());

            if (!hasRange || declinedOnceSettled) {
                return;
            }

            $insertTableAt(selection.focus, rows, columns);
        }, { discrete: true });

        return this;
    }

    /**
     * Inserts a sized, validated image at the caret. Without a text
     * selection — none at all, or table cells selected — the image goes in
     * at the document's end.
     *
     * No-op, leaving the selection as it is, when `src` fails the scheme
     * allow-list — never inserts a broken or unsafe image — when `alt` holds
     * a `[` or `]`, which Markdown's image syntax cannot hold, and when the
     * selection touches a raw Markdown block or a code block (or, without a
     * text selection, the document ends in one); `canInsertImage` reports
     * the last of these. A selection that runs from outside a table into one
     * of its cells is removed first, that table included; where the removal
     * leaves the caret at a raw block or a code block next to it, the image
     * goes into a new paragraph where the table was.
     *
     * In `"source"` mode, runs this command on the Markdown around the selection as
     * on the WYSIWYG surface and writes back the text it changes; no-op where the
     * selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the
     * component docs.
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

        const handledBySource = this.editSourceThroughModel(() => this.insertImage(src, options));

        if (handledBySource) { return this; }

        const applies = this.commandApplies("canInsertImage");

        if (!applies) { return this; }

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
                // A point moved off a `:::` block, or between two blocks, may have settled where no image goes (a code block).
                const moved = $settleSelectionOffContainers(selection);
                const declinedOnceSettled = moved && !$imageInsertApplies($selectionTouchesTextOnlyBlock());

                if (declinedOnceSettled) {
                    return;
                }

                $removeRangeBeforeImage(selection);
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
        const sourceMode = this.isSourceMode();

        if (sourceMode) { return this; }

        const applies = this.commandApplies("canEditTable");

        if (!applies) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            $insertTableRowAtSelection(after);
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
        const sourceMode = this.isSourceMode();

        if (sourceMode) { return this; }

        const applies = this.commandApplies("canEditTable");

        if (!applies) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            $deleteTableRowAtSelection();
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
        const sourceMode = this.isSourceMode();

        if (sourceMode) { return this; }

        const applies = this.commandApplies("canEditTable");

        if (!applies) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            $insertTableColumnAtSelection(after);
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
        const sourceMode = this.isSourceMode();

        if (sourceMode) { return this; }

        const applies = this.commandApplies("canEditTable");

        if (!applies) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            $deleteTableColumnAtSelection();
        }, { discrete: true });

        return this;
    }

    /**
     * Sets the alignment of the column holding the caret, on every cell in
     * that column. No-op without throwing when the caret is not inside a
     * table cell, and — adding no undo step — when the column already has
     * that alignment.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @param alignment - The alignment to apply to the column.
     * @returns This component, for method chaining.
     */
    setTableColumnAlignment(alignment: MarkdownTableAlignment): this {
        const sourceMode = this.isSourceMode();

        if (sourceMode) { return this; }

        const applies = this.commandApplies("canEditTable");

        if (!applies) { return this; }

        const editor = this.ensureEditor();
        const alreadySet = editor.read(() => $enclosingColumnHasAlignment(alignment));

        if (alreadySet) { return this; }

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
        const sourceMode = this.isSourceMode();

        if (sourceMode) { return this; }

        const applies = this.commandApplies("canEditTable");

        if (!applies) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            $getEnclosingTableNode()?.remove();
        }, { discrete: true });

        return this;
    }

    /**
     * Merges the cells of the current drag-selected `TableSelection` into
     * one, carrying `<<`/`^^` continuations on export. The merged cell holds
     * the content of each merged cell as a paragraph of its own, saved with
     * the cell break (`\n\n`, a backslash and an `n` twice); an empty first
     * cell adds no blank line. The caret lands at the end of the merged cell.
     * No-op without throwing when the current selection is not a
     * `TableSelection` spanning more than one cell, and when a header cell is
     * among them: Markdown merges body cells only.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @returns This component, for method chaining.
     */
    mergeTableCells(): this {
        const sourceMode = this.isSourceMode();

        if (sourceMode) { return this; }

        const applies = this.commandApplies("canMergeCells");

        if (!applies) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            const selection = $getSelection();

            if (!$isTableSelection(selection)) {
                return;
            }

            const cells = selection.getNodes().filter($isTableCellNode);
            const emptyBefore = new Set(cells.filter($holdsOneEmptyParagraph).map((cell) => cell.getKey()));
            const merged = $mergeCells(cells);

            if (merged === null) {
                return;
            }

            // `$mergeCells` skips a merged-in empty cell but keeps the first cell's own empty paragraph.
            const leadsWithBlank = emptyBefore.has(merged.getKey()) && merged.getChildrenSize() > 1;

            if (leadsWithBlank) {
                merged.getFirstChildOrThrow().remove();
            }

            merged.selectEnd();
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
        const sourceMode = this.isSourceMode();

        if (sourceMode) { return this; }

        const applies = this.commandApplies("canUnmergeCell");

        if (!applies) { return this; }

        const editor = this.ensureEditor();

        editor.update(() => {
            $unmergeCell();
        }, { discrete: true });

        return this;
    }

    /**
     * Sets (or, with `null`, clears) the width of the column the caret sits
     * in, in pixels. No-op without throwing when the caret is not inside a
     * table cell, and — adding no undo step — when the column already has
     * that width, or has none and `width` is `null`.
     *
     * No-op in `"source"` mode, where the raw-Markdown surface is shown.
     *
     * @param width - The column width in pixels, or `null` to clear it.
     * @returns This component, for method chaining.
     */
    setTableColumnWidth(width: number | null): this {
        const sourceMode = this.isSourceMode();

        if (sourceMode) { return this; }

        const applies = this.commandApplies("canEditTable");

        if (!applies) { return this; }

        const editor = this.ensureEditor();
        const alreadySet = editor.read(() => $enclosingColumnWidth() === (width ?? 0));

        if (alreadySet) { return this; }

        editor.update(() => {
            const cell = $getEnclosingTableCellNode();

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
    /**
     * Registers a listener for the `"readonlyedit"` event, fired when an edit
     * is refused because the editor is read-only, on either surface: once
     * for each refused edit. In WYSIWYG mode that is an edit the browser
     * offered and the surface cancelled (typing, Enter, a deletion, a paste,
     * a cut, a drop, the browser's format shortcuts), a composition at its
     * start, and each editing command called on the editor. In `"source"`
     * mode it is what the source `CodeEditor` reports. Tab, which moves the
     * focus on, and the undo and redo keys, which are stopped quietly, are
     * not reported on either surface.
     *
     * @param event - Must be `"readonlyedit"`.
     * @param listener - Invoked with no payload.
     * @returns This component, for method chaining.
     */
    on(event: "readonlyedit", listener: () => void): this;
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
    /**
     * Removes a previously registered `"readonlyedit"` listener.
     *
     * @param event - Must be `"readonlyedit"`.
     * @param listener - The exact callback reference to remove.
     * @returns This component, for method chaining.
     */
    off(event: "readonlyedit", listener: () => void): this;
    off(event: MarkdownEditorEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans an event out to its registered listeners.
     *
     * @param event - The event name.
     * @param payload - The event payload (`"change"`/`"selectionstate"`; `"readonlyedit"` has none).
     */
    protected emit(event: "change", payload: MarkdownEditorChange): void;
    protected emit(event: "selectionstate", payload: MarkdownEditorSelectionState): void;
    protected emit(event: "readonlyedit"): void;
    protected emit(event: MarkdownEditorEvent, payload?: MarkdownEditorChange | MarkdownEditorSelectionState): void {
        this._listeners.fire(event, ...(payload ? [payload] : []));
    }

    /**
     * Sets whether the WYSIWYG surface's element hosts an editable region
     * (`contenteditable`), which is what gives the browser a caret, keyboard
     * selection and a tab stop there. It is separate from
     * {@link MarkdownEditor.setReadOnly}, in both directions: a read-only
     * editor's surface stays `contenteditable`, so that it keeps its caret,
     * and a `contenteditable` surface cannot make a read-only editor
     * editable, every edit being refused all the same. Turn it off to take
     * the caret away altogether. Turning it off also removes the surface's
     * text-box role and its `aria-readonly` and `aria-multiline`
     * properties, which describe an editing host.
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
     * @returns The contenteditable state: what
     *   {@link MarkdownEditor.setContentEditable} last set, `true` until
     *   then, read-only or not.
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
        // Before `super.destructor()` releases the wash's element handle,
        // which a pulse's fallback timer would otherwise write to, and which a
        // refused command called after this teardown would otherwise flash on.
        this._flash.dispose();

        // And before the Lexical editor's view is taken out, which a waiting restore would write to.
        this.cancelViewRestore();

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
     * Returns the Lexical editor, building it on first use
     * ({@link buildEditor}). Emits `"selectionstate"` once built when the
     * document gives a state other than the neutral one reported until then,
     * which only a document ending where the inserts decline does.
     *
     * @returns The live (headless-capable) Lexical editor.
     */
    private ensureEditor(): LexicalEditor {
        if (this._commandEditor !== null) {
            return this._commandEditor;
        }

        if (this._editor) {
            return this._editor;
        }

        const editor = this.buildEditor();

        // Before the build the neutral state stood in. The built document can turn the two insert
        // fields off (it may end in a block the inserts decline), so report what it gives.
        this.updateSelectionState();

        return editor;
    }

    /**
     * Builds the headless Lexical editor with the document the editor holds,
     * and registers everything that acts on it. Offline the editor stays
     * headless — the state, and every value / command operation, still work.
     * Reports no selection state: a caller that goes on to replace the
     * document reports the new one's instead ({@link MarkdownEditor.setValue}
     * and {@link MarkdownEditor.setMode}), every other goes through
     * {@link ensureEditor}.
     *
     * @returns The built editor, also kept as `_editor`.
     */
    private buildEditor(): LexicalEditor {
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
        const dirty = this.isDirty();

        if (!dirty) {
            this._cleanValue = editor.read(() => $serializeMarkdown(this._sourceMap));
        }

        this._unregister = mergeRegister(
            unregisterWritableStateRules,
            this.registerEditorRules(editor, () => {
                this.handleChange();
                this.updateSelectionState();
            }),
        );

        this._editor = editor;

        return editor;
    }

    /**
     * Registers the rules that make an editor this editor's: the rich-text,
     * list, table, history and typing rules, the paste and range guards, and
     * the read-only guard. The WYSIWYG editor and the model a source-mode
     * command runs on both register them here, so they cannot drift apart.
     *
     * @param editor - The editor to register on, already loaded.
     * @param onCommit - Called on each committed update, or `null` for an editor that reports nothing.
     * @returns The call that removes every registration.
     */
    private registerEditorRules(editor: LexicalEditor, onCommit: (() => void) | null): () => void {
        // Before `registerRichText`, whose handler of the text-insertion command, at the same priority, inserts the text.
        const typedTextMarks = registerTypedTextMarks(editor);

        return mergeRegister(
            typedTextMarks.unregister,
            editor.registerCommand(COMPOSITION_START_COMMAND, $moveCaretOutOfLinkEdge, COMMAND_PRIORITY_CRITICAL),
            registerRichText(editor),
            registerList(editor),
            registerTablePlugin(editor),
            registerMarkdownHistory(editor, typedTextMarks.isTypedUpdate),
            registerMarkdownShortcutsOutsideRawBlocks(editor, typedTextMarks.isTypedUpdate),
            editor.registerCommand(KEY_ENTER_COMMAND, $handleSeparatorShortcut, COMMAND_PRIORITY_HIGH),
            registerColumnPaste(editor),
            registerTablePartPaste(editor),
            registerHeldBlockPaste(editor),
            registerListItemRules(editor),
            registerQuoteRules(editor),
            registerTextOnlyBlockRules(editor),
            registerItemTextPaste(editor),
            registerRangeGuards(editor),
            registerWritableFormatCommand(editor),
            ...(onCommit === null ? [] : [editor.registerUpdateListener(onCommit)]),
            // Last: its listeners go in front of every other one for their commands.
            registerReadOnlyGuard(editor, () => this.getReadOnly(), () => this.signalReadOnlyEdit()),
        );
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

            const host = this.getElement();

            // The wash goes on the editor's own element, not into the surface:
            // the surface is Lexical's root, which removes a child it did not create.
            if (host) {
                this.trackHandle(this._flash.mount(host, WYSIWYG_FLASH_Z_INDEX));
            }
        }
    }

    /**
     * `WysiwygSurface`'s `"contextmenu"` handler: resolves the native event's
     * DOM target to a Lexical node, classifies it (and the current
     * selection) for the menu, and shows the resulting context menu at the
     * click point. A menu opened from the keyboard (Shift+F10, the
     * ContextMenu key) targets the editor root, so it is built for the caret
     * instead (see {@link $contextMenuNodeFor}), at the point the browser
     * reports for it, which is the caret's.
     *
     * The editor's selection is first brought to the one the browser holds
     * (see {@link $adoptDomSelection}): where a right-click moves the caret
     * before raising the event, the menu must describe the caret its items
     * will act on. Nothing beyond that is changed — the selection is never
     * widened here. Classification reports what a collapsed caret's format
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

        // The live selection is read through the seam's named escape, and Lexical keeps none of it:
        // what comes back is a selection of Lexical's own document, or null offline and outside the editor.
        editor.update(() => {
            $adoptDomSelection(DOM.source.readDocumentSelection((selection) => $createRangeSelectionFromDom(selection, editor)));
        }, { discrete: true });

        editor.read(() => {
            const node = $getNearestNodeFromDOMNode(domTarget);

            if (node === null) {
                return;
            }

            context = $classifyContextMenuTarget($contextMenuNodeFor(node));
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
     * Dispatches a classified right-click context to the item list for its
     * kind. A read-only editor's menu offers only Copy, whatever the kind:
     * every other item edits the document.
     *
     * @param context - The classified {@link ContextMenuTarget}.
     * @returns The `MenuItemConfig` array for {@link Menu.show}.
     */
    private buildContextMenuItems(context: ContextMenuTarget): MenuItemConfig[] {
        const readOnly = this.getReadOnly();

        if (readOnly) {
            return buildClipboardMenuItems({ hasSelectedText: context.hasSelectedText, copy: () => this.copy() });
        }

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
     * @param enabled - Whether the format toggles would apply at the
     *   selection; `false` dims all five rows.
     * @returns The five `MenuItemConfig` entries: Bold, Italic, Underline, Strikethrough, Code.
     */
    private buildFormatToggleItems(
        format: { bold: boolean; italic: boolean; strikethrough: boolean; code: boolean; underline: boolean },
        enabled: boolean,
    ): MenuItemConfig[] {
        const toggleRow = (text: string, checked: boolean, toggle: () => void): MenuItemConfig => ({
            row: () => {
                const row = new CheckboxMenuRow({ text, checked, enabled });

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
     * @param enabled - Whether the text-style commands would apply at the
     *   selection; `false` dims the item, which then does not open.
     * @returns The `MenuItemConfig` for the "Text style" submenu.
     */
    private buildTextStyleMenuItem(enabled: boolean): MenuItemConfig {
        const presetItem = (text: string, action: () => void): MenuItemConfig => ({ text, action });

        return {
            text: "Text style",
            enabled,
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
     * @param enabled - Whether the column commands would apply at the
     *   selection; `false` dims the item, which then does not open.
     * @returns The `MenuItemConfig` for the "Columns" submenu.
     */
    private buildColumnsMenuItem(enabled: boolean): MenuItemConfig {
        return {
            text:    "Columns",
            enabled,
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
     * actually does. Paste is always enabled: `paste()` has somewhere to paste at every selection.
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
     * "Insert link…" when the click is not inside a link (dimmed where there
     * is nothing to link), or "Edit link…" plus "Remove link"
     * when it is. The two states are mutually exclusive, so exactly one
     * of these shapes is ever shown — never a permanently-disabled item. Each
     * item is also dimmed where its command would do nothing at the
     * selection.
     *
     * @param context - Carries `linkUrl` (`undefined`/`null` outside a link, the
     *   URL inside one).
     * @param availability - Which commands would apply at the selection.
     * @returns One or two `MenuItemConfig` entries.
     */
    private buildLinkMenuItems(
        context: { linkUrl?: string | null },
        availability: CommandAvailability,
    ): MenuItemConfig[] {
        const linkUrl = context.linkUrl ?? null;

        if (linkUrl === null) {
            return [{
                text: "Insert link…", enabled: availability.canLink,
                action: () => void this.promptAndApplyLink("Insert link", ""),
            }];
        }

        return [
            { text: "Edit link…", enabled: availability.canLink, action: () => void this.promptAndApplyLink("Edit link", linkUrl) },
            { text: "Remove link", enabled: availability.canRemoveLink, action: () => this.removeLink() },
        ];
    }

    /**
     * Builds the format menu shown over a word, a range selection, or an
     * ordinary (non-empty) block: the shared inline-format toggles, a
     * block-style submenu (paragraph, headings, a blockquote, or a fenced
     * code block), the text-style, alignment and columns submenus, and a
     * clear-formatting action. An item whose command would do nothing at
     * the selection is dimmed, each by the field of the context's
     * `availability` that covers its command.
     *
     * @param context - The `"text"` classification, carrying the current
     *   selection's inline-format state and which commands would apply.
     * @returns The `MenuItemConfig` array for {@link Menu.show}.
     */
    private buildTextContextMenuItems(context: ContextMenuTarget & { kind: "text" }): MenuItemConfig[] {
        const availability = context.availability;

        const items: MenuItemConfig[] = [
            ...this.clipboardMenuItems(context.hasSelectedText),
            { separator: true },
            ...this.buildFormatToggleItems(context, availability.canFormat),
            { separator: true },
            ...this.buildLinkMenuItems(context, availability),
            { separator: true },
            {
                text:    "Block style",
                enabled: availability.canSetBlockType,
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
            this.buildTextStyleMenuItem(availability.canStyle),
            {
                text:    "Alignment",
                enabled: availability.canSetBlockLayout,
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
            this.buildColumnsMenuItem(availability.canSetBlockLayout),
            { separator: true },
            { text: "Clear formatting", enabled: availability.canClearFormatting, action: () => this.clearFormatting() },
        ];

        if (context.hasEnclosingBlock) {
            items.push({ separator: true }, ...this.buildInsertLineItems(availability.canInsertParagraphAroundBlock));
        }

        return items;
    }

    /**
     * Builds the two items, shared by the text and table-cell context menus,
     * that insert an empty line before or after the block the caret is in.
     *
     * @param enabled - Whether the two commands would apply at the selection;
     *   `false` dims both.
     * @returns The two `MenuItemConfig` entries.
     */
    private buildInsertLineItems(enabled: boolean): MenuItemConfig[] {
        return [
            { text: "Insert line before block", enabled, action: () => this.insertParagraphBeforeBlock() },
            { text: "Insert line after block", enabled, action: () => this.insertParagraphAfterBlock() },
        ];
    }

    /**
     * Builds the insert menu shown over an empty line (outside any table): a
     * Heading submenu, an Insert submenu (block conversions plus new-object
     * insertion), and the Columns submenu. Omits a "Paragraph" item — the
     * classification already guarantees the caret sits in an empty paragraph,
     * so converting it to a paragraph is a guaranteed no-op. An item whose
     * command would do nothing at the selection is dimmed; the Insert
     * entries follow three rules (the block conversions one, Table and
     * Image… one each), so they are dimmed one by one.
     *
     * @param context - The `"empty-line"` classification, carrying whether
     *   the current selection has text (a drag-selection ending on an empty
     *   line, which still classifies as `"empty-line"`) and which commands
     *   would apply.
     * @returns The `MenuItemConfig` array for {@link Menu.show}.
     */
    private buildEmptyLineContextMenuItems(context: ContextMenuTarget & { kind: "empty-line" }): MenuItemConfig[] {
        const availability = context.availability;
        const canSetBlockType = availability.canSetBlockType;

        return [
            ...this.clipboardMenuItems(context.hasSelectedText),
            { separator: true },
            { text: "Heading", enabled: canSetBlockType, submenu: { label: "Heading", items: this.buildHeadingMenuItems() } },
            {
                text:    "Insert",
                submenu: {
                    label: "Insert",
                    items: [
                        { text: "Quote", enabled: canSetBlockType, action: () => this.setBlockType("quote") },
                        { text: "Code block", enabled: canSetBlockType, action: () => this.setBlockType("code") },
                        { text: "Bulleted list", enabled: canSetBlockType, action: () => this.toggleUnorderedList() },
                        { text: "Numbered list", enabled: canSetBlockType, action: () => this.toggleOrderedList() },
                        { separator: true },
                        { text: "Table", enabled: availability.canInsertTable, action: () => this.insertTable(2, 3) },
                        { text: "Image…", enabled: availability.canInsertImage, action: () => void this.promptAndInsertImage() },
                    ],
                },
            },
            this.buildColumnsMenuItem(availability.canSetBlockLayout),
        ];
    }

    /**
     * Builds the menu shown over a table cell (populated or empty): the same
     * shared inline-format toggles and Clear formatting as the text context
     * menu — a cell holds inline text too, just never a heading or quote in
     * this dialect, so no Block style submenu — then a Table submenu holding
     * every table-structure action. An item whose command would do nothing
     * at the selection is dimmed, the Table submenu's entries among them
     * ({@link buildTableMenuItem}).
     *
     * @param context - The `"table-cell"` classification, carrying the
     *   current selection's inline-format state and which commands would
     *   apply.
     * @returns The `MenuItemConfig` array for {@link Menu.show}.
     */
    private buildTableCellContextMenuItems(context: ContextMenuTarget & { kind: "table-cell" }): MenuItemConfig[] {
        const availability = context.availability;

        const items: MenuItemConfig[] = [
            ...this.clipboardMenuItems(context.hasSelectedText),
            { separator: true },
            ...this.buildFormatToggleItems(context, availability.canFormat),
            { separator: true },
            ...this.buildLinkMenuItems(context, availability),
            { separator: true },
            this.buildTextStyleMenuItem(availability.canStyle),
            { separator: true },
            { text: "Clear formatting", enabled: availability.canClearFormatting, action: () => this.clearFormatting() },
            { separator: true },
            this.buildTableMenuItem(context.columnAlignment ?? "none", availability),
        ];

        if (context.hasEnclosingBlock) {
            items.push({ separator: true }, ...this.buildInsertLineItems(availability.canInsertParagraphAroundBlock));
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
     * already uses for its Colour/Font/Size sub-submenus. An entry whose
     * command would do nothing at the selection is dimmed: the row, column
     * and whole-table entries act on the table the caret is in, so they are
     * dimmed while cells are selected, where only Merge cells applies.
     *
     * @param columnAlignment - The clicked column's current alignment, forwarded to {@link buildColumnAlignmentItems}.
     * @param availability - Which commands would apply at the selection.
     * @returns The `MenuItemConfig` for the "Table" submenu.
     */
    private buildTableMenuItem(columnAlignment: MarkdownTableAlignment, availability: CommandAvailability): MenuItemConfig {
        const canEditTable = availability.canEditTable;

        return {
            text:    "Table",
            submenu: {
                label: "Table",
                items: [
                    {
                        text:    "Insert",
                        enabled: canEditTable,
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
                        enabled: canEditTable,
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
                    { text: "Merge cells", enabled: availability.canMergeCells, action: () => this.mergeTableCells() },
                    { text: "Unmerge cell", enabled: availability.canUnmergeCell, action: () => this.unmergeTableCell() },
                    { text: "Column width…", enabled: canEditTable, action: () => void this.promptAndSetColumnWidth() },
                    {
                        text:    "Align column",
                        enabled: canEditTable,
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
     * The map grows by one entry per top-level block and per nested part per
     * import and is never pruned: Lexical's undo history, which this editor
     * keeps unbounded, already holds every import's nodes, so the map grows no
     * faster than the history does. A block's entry holds a slice of the
     * imported text; a part holds its source and its fingerprint (its standard
     * form), so the parts of a document hold about 2.4 times its characters
     * for a flat list and 3.9 times for a list nested three deep.
     *
     * @param imported - The source map the import returned.
     */
    private adoptSourceMap(imported: MarkdownSourceMap): void {
        for (const [key, block] of imported.blocks) {
            this._sourceBlocks.set(key, block);
        }

        for (const [key, part] of imported.parts) {
            this._sourceParts.set(key, part);
        }

        this._sourceMap = { latest: imported.latest, blocks: this._sourceBlocks, parts: this._sourceParts };
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
     * `handleCodeChange`, `setMode`, `setReadOnly`, `ensureEditor` once it
     * has built the Lexical editor, and `finishViewRestore`. Before that
     * build the WYSIWYG surface reports the neutral state, so nothing but a
     * change of the read-only state emits then.
     *
     * Nothing is emitted while a view restore waits ({@link restoreView}):
     * the editor's selection is then, for the length of a task or a frame,
     * the one the browser set when the view was rendered anew, and a host would see its
     * toolbar's state flip away and back. `finishViewRestore` calls this
     * again once the restore is done.
     */
    private updateSelectionState(): void {
        if (this._viewRestore !== null) {
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
