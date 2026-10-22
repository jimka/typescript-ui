// Keeps `@lexical/clipboard`'s real module (`@lexical/rich-text` imports it
// for its paste path) and replaces only `copyToClipboard`, which needs a
// browser clipboard the test DOM does not have, and
// `$getClipboardDataFromSelection`, which needs a browser document to write
// the selection's HTML: here it gives the selection's text alone.
vi.mock('@lexical/clipboard', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@lexical/clipboard')>()),
    copyToClipboard: vi.fn(async () => true),
    $getClipboardDataFromSelection: vi.fn((selection: BaseSelection) => ({ 'text/plain': selection.getTextContent() })),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createParagraphNode, $createRangeSelection, $createTextNode, $getRoot, $getSelection, $isRangeSelection, $isTextNode,
    $setSelection, COMMAND_PRIORITY_CRITICAL, COMMAND_PRIORITY_LOW, CONTROLLED_TEXT_INSERTION_COMMAND, COPY_COMMAND,
    CUT_COMMAND, DELETE_CHARACTER_COMMAND, DELETE_LINE_COMMAND, DELETE_WORD_COMMAND, INSERT_LINE_BREAK_COMMAND,
    INSERT_PARAGRAPH_COMMAND, INSERT_TAB_COMMAND, KEY_ENTER_COMMAND, PASTE_COMMAND, REMOVE_TEXT_COMMAND,
    SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { BaseSelection, ElementNode, LexicalEditor, PointType, RangeSelection, TextNode } from 'lexical';
import { $insertGeneratedNodes, copyToClipboard } from '@lexical/clipboard';
import { $createTableNodeWithDimensions, $createTableSelectionFrom, $isTableNode, TableNode } from '@lexical/table';
import type { TableCellNode } from '@lexical/table';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { editorSurfaceModel, viewerModel } from './markdown-roundtrip/viewModel';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => {
    DOM.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(copyToClipboard).mockClear();
});

/** A selection end: the exact text content of a text node, and an offset in it. */
type TextPoint = [text: string, offset: number];

/**
 * A selection end: a text point, or an element point on the document's first
 * table — the end of its last row's last cell, the start of its first row's
 * first cell, or the start of the table node itself — or the end of the last
 * row's last cell of the document's last table.
 */
type End = TextPoint | 'last-cell-end' | 'first-cell-start' | 'table-start' | 'last-table-end';

/**
 * Reaches the private headless Lexical editor.
 *
 * @param editor - The Markdown editor.
 * @returns Its Lexical editor.
 */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/**
 * Loads `source` into a fresh editor.
 *
 * @param source - The Markdown to load.
 * @returns The editor.
 */
function load(source: string): MarkdownEditor {
    const editor = new MarkdownEditor();

    editor.setValue(source);

    return editor;
}

/**
 * The document's text node whose text content is exactly `text`. Must run
 * inside a read or update.
 *
 * @param text - The text content to find.
 * @returns The text node.
 */
function $textNode(text: string): TextNode {
    const found = $dfs().map(({ node }) => node).find((node) => $isTextNode(node) && node.getTextContent() === text);

    if (!$isTextNode(found)) {
        throw new Error(`no text node holds ${JSON.stringify(text)}`);
    }

    return found;
}

/**
 * The document's first table. Must run inside a read or update.
 *
 * @returns The table node.
 */
function $firstTable(): TableNode {
    const found = $dfs().map(({ node }) => node).find($isTableNode);

    if (!$isTableNode(found)) {
        throw new Error('the document holds no table');
    }

    return found;
}

/**
 * The document's last table. Must run inside a read or update.
 *
 * @returns The table node.
 */
function $lastTable(): TableNode {
    const found = $dfs().map(({ node }) => node).filter($isTableNode).at(-1);

    if (found === undefined) {
        throw new Error('the document holds no table');
    }

    return found;
}

/**
 * Sets `point` to `end`. Must run inside an update.
 *
 * @param point - The selection point to set.
 * @param end - Where it goes.
 */
function $setEnd(point: PointType, end: End): void {
    if (Array.isArray(end)) {
        point.set($textNode(end[0]).getKey(), end[1], 'text');

        return;
    }

    const table = end === 'last-table-end' ? $lastTable() : $firstTable();

    if (end === 'table-start') {
        point.set(table.getKey(), 0, 'element');

        return;
    }

    if (end === 'first-cell-start') {
        const firstCell = (table.getFirstChildOrThrow() as ElementNode).getFirstChildOrThrow() as ElementNode;

        point.set(firstCell.getKey(), 0, 'element');

        return;
    }

    const lastCell = (table.getLastChildOrThrow() as ElementNode).getLastChildOrThrow() as ElementNode;

    point.set(lastCell.getKey(), lastCell.getChildrenSize(), 'element');
}

/**
 * Selects from `anchor` to `focus`.
 *
 * @param editor - The editor.
 * @param anchor - Where the selection's anchor goes.
 * @param focus - Where the selection's focus goes.
 */
function select(editor: MarkdownEditor, anchor: End, focus: End): void {
    lexicalOf(editor).update(() => {
        const selection = $createRangeSelection();

        $setEnd(selection.anchor, anchor);
        $setEnd(selection.focus, focus);
        $setSelection(selection);
    }, { discrete: true });
}

/**
 * Loads `source` and makes the list item whose text is `tail` open with an
 * empty 2×2 table, the text `tail` a paragraph after it: the shape a load
 * builds for an item that opens with a table. Built on the node tree, so
 * the table is the empty one the rows select the edges of.
 *
 * @param source - The Markdown to load, holding a list item whose text is `tail`.
 * @returns The editor.
 */
function loadWithTableOpeningTail(source: string): MarkdownEditor {
    const editor = load(source);

    lexicalOf(editor).update(() => {
        const tail = $textNode('tail');
        const item = tail.getParentOrThrow().getParentOrThrow();

        // The item's text node gives way to the table and a paragraph holding the text.
        item.splice(0, 1, [$createTableNodeWithDimensions(2, 2, true), $createParagraphNode().append(tail)]);
    }, { discrete: true });

    return editor;
}

/**
 * Loads `source` and gives the list item whose text is `tail` the text
 * `head`, then an empty 2×2 table, then `tail` as a paragraph: the table
 * then stands between two texts of one list item. Built on the node tree, as
 * {@link loadWithTableOpeningTail} builds its shape.
 *
 * @param source - The Markdown to load, holding a list item whose text is `tail`.
 * @returns The editor.
 */
function loadWithTableBetweenHeadAndTail(source: string): MarkdownEditor {
    const editor = load(source);

    lexicalOf(editor).update(() => {
        const tail = $textNode('tail');
        const itemText = tail.getParentOrThrow();
        const item = itemText.getParentOrThrow();

        item.splice(1, 0, [$createTableNodeWithDimensions(2, 2, true), $createParagraphNode().append(tail)]);
        itemText.append($createTextNode('head'));
    }, { discrete: true });

    return editor;
}

/**
 * Describes where a point is: `"text"@offset` for a text point,
 * `type@offset` (the node's Lexical type) for an element point.
 *
 * @param point - The point to describe.
 * @returns The description.
 */
function $describePoint(point: PointType): string {
    const node = point.getNode();

    return point.type === 'text' ? `${JSON.stringify(node.getTextContent())}@${point.offset}` : `${node.getType()}@${point.offset}`;
}

/**
 * Describes the editor's caret, as {@link $describePoint} does, or says it is
 * not a collapsed range selection.
 *
 * @param editor - The editor.
 * @returns The caret's description.
 */
function caretOf(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
            return 'no caret';
        }

        return $describePoint(selection.anchor);
    });
}

/**
 * Describes the editor's selection as `anchor -> focus`, each end as
 * {@link $describePoint} describes it, or says it is not a range selection.
 *
 * @param editor - The editor.
 * @returns The selection's description.
 */
function rangeOf(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection)) {
            return 'no range';
        }

        return `${$describePoint(selection.anchor)} -> ${$describePoint(selection.focus)}`;
    });
}

/**
 * Whether the document holds a table.
 *
 * @param editor - The editor.
 * @returns `true` when a table node is attached.
 */
function holdsTable(editor: MarkdownEditor): boolean {
    return lexicalOf(editor).read(() => $dfs().some(({ node }) => $isTableNode(node)));
}

/**
 * Dispatches a paste carrying `data` and `files`, as the browser's paste
 * event does.
 *
 * @param editor - The editor.
 * @param data - The clipboard's text, by MIME type.
 * @param files - How many files the clipboard holds.
 */
function pasteClipboard(editor: MarkdownEditor, data: Record<string, string>, files: number = 0): void {
    // `registerRichText`'s paste handler tells clipboard, drag, input and key events apart by class name.
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
    vi.stubGlobal('DragEvent', class DragEvent {});
    vi.stubGlobal('InputEvent', class InputEvent {});
    vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});

    const event = Object.assign(new ClipboardEvent('paste'), {
        clipboardData: {
            types: [...Object.keys(data), ...(files > 0 ? ['Files'] : [])],
            files: Array.from({ length: files }, () => ({})),
            getData: (type: string) => data[type] ?? '',
        },
        preventDefault: () => {},
    });

    lexicalOf(editor).update(() => {
        lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event);
    }, { discrete: true });
}

/**
 * The index within the root of the root child holding the caret's anchor.
 *
 * @param editor - The editor.
 * @returns The index, or `-1` when there is no range selection.
 */
function caretBlockIndex(editor: MarkdownEditor): number {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection)) {
            return -1;
        }

        return selection.anchor.getNode().getTopLevelElementOrThrow().getIndexWithinParent();
    });
}

/**
 * The text content of each child of the root, each prefixed with its Lexical
 * type.
 *
 * @param editor - The editor.
 * @returns One `type:text` entry per child of the root.
 */
function rootChildren(editor: MarkdownEditor): string[] {
    return lexicalOf(editor).read(() => $getRoot().getChildren().map((child) => `${child.getType()}:${child.getTextContent()}`));
}

const T = '| a | b |\n| --- | --- |\n| c1 | d1 |';
const T2 = '| x |\n| - |\n| y |';
const DOC = `Above para\n\n${T}\n\nafter`;
const TABLE_LAST = `Above para\n\n${T}`;
const TABLE_FIRST = `${T}\n\nafter`;
const TWO_PARAS = `p1 text\n\np2 text\n\n${T}\n\nafter`;
const TWO_TABLES = `Above para\n\n${T}\n\nmid\n\n${T2}\n\nafter`;
const CODE_ABOVE = `\`\`\`\ncode\n\`\`\`\n\n${T}\n\nafter`;
const CODE_ABOVE_RESULT = '```\nco\n```\n\nafter';
const CODE_BELOW = `Above para\n\n${T}\n\n\`\`\`\ncode\n\`\`\``;
const CODE_BELOW_RESULT = 'Above para\n\n```\nde\n```';
const COLUMN_BEFORE_TABLE = `::: columns\nA\n|||\nbefore\n\n${T}\n:::\n\nafter`;
const COLUMN_BEFORE_TABLE_RESULT = '::: columns\nA\n|||\nbefore\n:::\n\nter';
const COLUMN_ONLY_TABLE = `::: columns\nA\n|||\n${T}\n:::\n\nafter`;
const COLUMN_ONLY_TABLE_RESULT = '::: columns\nA\n|||\n\n:::\n\nter';
const TABLE_THEN_LIST = `${T}\n\n- one\n- two`;
const TABLE_THEN_FENCE = `${T}\n\n::: x\nA\n:::`;
const TABLE_THEN_HEADING = `${T}\n\n## head ing`;
const FENCE_ONLY_TABLE = `Above para\n\n::: x\n${T}\n:::`;
const RAW_ABOVE = `<div>\nraw text\n</div>\n\n${T}\n\nafter`;
const RAW_ABOVE_ENTER_RESULT = ['markdown-raw-block:<div>\nra', 'paragraph:', 'paragraph:after'];
const RAW_BELOW = `Above para\n\n${T}\n\n<div>\nraw text\n</div>`;
const RAW_AFTER_COLUMN_TABLE = `::: columns\nA\n|||\nbefore\n\n${T}\n:::\n\n<div>\nraw text\n</div>`;
const BOLD_ABOVE = `**Above para**\n\n${T}\n\nafter`;
const BOLD_BELOW = `Above para\n\n${T}\n\n**after**`;
const TABLES_THEN_CODE = `Above para\n\n${T}\n\nmid\n\n${T2}\n\n\`\`\`\ncode\n\`\`\``;
const TABLES_THEN_CODE_IMAGE_RESULT = 'Above para\n\n![i](/i.png)\n\n```\ncode\n```';
const COLUMN_CODE_THEN_TABLE = `::: columns\nA\n|||\n\`\`\`\ncode\n\`\`\`\n\n${T}\n:::\n\nafter`;
const COLUMN_CODE_THEN_TABLE_IMAGE_RESULT = '::: columns\nA\n|||\n```\ncode\n```\n\n![i](/i.png)\n:::\n\nter';
const COLUMN_EMPTY_CODE_THEN_TABLE = `::: columns\nA\n|||\n\`\`\`\n\`\`\`\n\n${T}\n:::\n\nafter`;
const COLUMN_EMPTY_CODE_THEN_TABLE_IMAGE_RESULT = '::: columns\nA\n|||\n```\n```\n\n![i](/i.png)\n:::\n\nter';
const TABLES_THEN_EMPTY_CODE = `Above para\n\n${T}\n\nmid\n\n${T2}\n\n\`\`\`\n\`\`\``;
const TABLES_THEN_EMPTY_CODE_IMAGE_RESULT = 'Above para\n\n![i](/i.png)\n\n```\n```';
const TABLES_THEN_FENCED_CODE = `Above para\n\n${T}\n\nmid\n\n::: x\n${T2}\n\n\`\`\`\ncode\n\`\`\`\n:::`;
const TABLES_THEN_FENCED_CODE_IMAGE_RESULT = 'Above para\n\n::: x\n![i](/i.png)\n\n```\ncode\n```\n:::';
const LEADING_TABLES_THEN_CODE = `${T}\n\n${T2}\n\n\`\`\`\ncode\n\`\`\`\n\nafter`;
const LEADING_TABLES_THEN_CODE_IMAGE_RESULT = '![i](/i.png)\n\n```\ncode\n```\n\nafter';
const EMPTY_CODE_THEN_CLOSING_TABLES = `\`\`\`\n\`\`\`\n\n${T}\n\n${T2}`;
const EMPTY_CODE_THEN_CLOSING_TABLES_IMAGE_RESULT = '```\n```\n\n![i](/i.png)';
const TABLE_THEN_DEEP_HEADING = `${T}\n\n### head ing`;
const EMPTY_TABLE = '|  |  |\n| --- | --- |\n|  |  |';
const ONE_CELL_EDITED = 'Above para\n\n| a | b |\n| --- | --- |\n| 1 | d1 |\n\nafter';

/**
 * Loads `source`, selects from `anchor` to `focus`, and dispatches
 * `DELETE_CHARACTER_COMMAND` outside an update.
 *
 * @param source - The Markdown to load.
 * @param anchor - Where the selection's anchor goes.
 * @param focus - Where the selection's focus goes.
 * @param isBackward - `true` for Backspace, `false` for Delete.
 * @returns The editor.
 */
function deleteRange(source: string, anchor: End, focus: End, isBackward: boolean): MarkdownEditor {
    const editor = load(source);

    select(editor, anchor, focus);
    lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, isBackward);

    return editor;
}

describe('deleting a range across a table\'s edge takes the whole table and stops at its far edge (D rows)', () => {
    it('D1: from a paragraph to the end of the last cell', () => {
        const editor = deleteRange(DOC, ['Above para', 4], 'last-cell-end', false);

        expect(editor.getValue()).toBe('Abov\n\nafter');
        expect(caretOf(editor)).toBe('"Abov"@4');
    });

    it('D2: from a paragraph into a cell\'s word', () => {
        const editor = deleteRange(DOC, ['Above para', 4], ['c1', 1], false);

        expect(editor.getValue()).toBe('Abov\n\nafter');
        expect(caretOf(editor)).toBe('"Abov"@4');
    });

    it('D3: a backward range from the end of the last cell to a paragraph', () => {
        const editor = deleteRange(DOC, 'last-cell-end', ['Above para', 4], true);

        expect(editor.getValue()).toBe('Abov\n\nafter');
        expect(caretOf(editor)).toBe('"Abov"@4');
    });

    it('D4: from the start of the first cell into the paragraph after', () => {
        const editor = deleteRange(DOC, 'first-cell-start', ['after', 2], false);

        expect(editor.getValue()).toBe('Above para\n\nter');
        expect(caretOf(editor)).toBe('"ter"@0');
    });

    it('D5: a backward range from the paragraph after into a cell\'s word', () => {
        const editor = deleteRange(DOC, ['after', 2], ['d1', 1], true);

        expect(editor.getValue()).toBe('Above para\n\nter');
        expect(caretOf(editor)).toBe('"ter"@0');
    });

    it('D6: from the table node itself into the paragraph after leaves no empty table', () => {
        const editor = deleteRange(DOC, 'table-start', ['after', 2], false);

        expect(editor.getValue()).toBe('Above para\n\nter');
        expect(rootChildren(editor)).toEqual(['paragraph:Above para', 'paragraph:ter']);
        expect(caretOf(editor)).toBe('"ter"@0');
    });

    it('D7: from the start of the first cell to the end of the paragraph after', () => {
        const editor = deleteRange(DOC, 'first-cell-start', ['after', 5], false);

        expect(editor.getValue()).toBe('Above para');
        expect(rootChildren(editor)).toEqual(['paragraph:Above para', 'paragraph:']);
        expect(caretOf(editor)).toBe('paragraph@0');
        expect(caretBlockIndex(editor)).toBe(1);
    });

    it('D8: from the start of the first cell to the start of the paragraph after', () => {
        const editor = deleteRange(DOC, 'first-cell-start', ['after', 0], false);

        expect(editor.getValue()).toBe('Above para\n\nafter');
        expect(caretOf(editor)).toBe('"after"@0');
    });

    it('D9: a table that is the document\'s last block', () => {
        const editor = deleteRange(TABLE_LAST, ['Above para', 4], 'last-cell-end', false);

        expect(editor.getValue()).toBe('Abov');
        expect(caretOf(editor)).toBe('"Abov"@4');
    });

    it('D10: a table that is the document\'s first block', () => {
        const editor = deleteRange(TABLE_FIRST, 'first-cell-start', ['after', 2], false);

        expect(editor.getValue()).toBe('ter');
        expect(caretOf(editor)).toBe('"ter"@0');
    });

    it('D11: from two blocks above the table', () => {
        const editor = deleteRange(TWO_PARAS, ['p1 text', 2], 'last-cell-end', false);

        expect(editor.getValue()).toBe('p1\n\nafter');
        expect(caretOf(editor)).toBe('"p1"@2');
    });

    it('D12: from a cell of one table into a cell of another', () => {
        const editor = deleteRange(TWO_TABLES, ['c1', 1], ['y', 1], false);

        expect(editor.getValue()).toBe('Above para\n\nafter');
        expect(caretOf(editor)).toBe('"after"@0');
    });

    it('D13: from a code block above the table joins nothing into the code block', () => {
        const editor = deleteRange(CODE_ABOVE, ['code', 2], 'last-cell-end', false);

        expect(editor.getValue()).toBe(CODE_ABOVE_RESULT);
        expect(caretOf(editor)).toBe('"co"@2');
    });

    it('D14: into a code block below the table', () => {
        const editor = deleteRange(CODE_BELOW, 'first-cell-start', ['code', 2], false);

        expect(editor.getValue()).toBe(CODE_BELOW_RESULT);
        expect(caretOf(editor)).toBe('"de"@0');
    });

    it('D15: from a table that is a column\'s last block out of the fence', () => {
        const editor = deleteRange(COLUMN_BEFORE_TABLE, 'first-cell-start', ['after', 2], false);

        expect(editor.getValue()).toBe(COLUMN_BEFORE_TABLE_RESULT);
        expect(caretOf(editor)).toBe('"before"@6');
    });

    it('D16: from a table that is a column\'s only block out of the fence', () => {
        const editor = deleteRange(COLUMN_ONLY_TABLE, 'first-cell-start', ['after', 2], false);
        const secondColumn = lexicalOf(editor).read(() => {
            const column = ($getRoot().getFirstChildOrThrow() as ElementNode).getChildAtIndex(1) as ElementNode;

            return column.getChildren().map((child) => `${child.getType()}:${child.getTextContent()}`);
        });

        expect(editor.getValue()).toBe(COLUMN_ONLY_TABLE_RESULT);
        expect(secondColumn).toEqual(['paragraph:']);
        expect(caretOf(editor)).toBe('paragraph@0');
    });

    // Fails when the table-edge delete listener runs after $joinIntoTextOnlyBlock:
    // that handler would join the cell's rest into the code block and leave part of the table.
    it('D17: from a code block above the table into a cell\'s word joins nothing into the code block', () => {
        const editor = deleteRange(CODE_ABOVE, ['code', 2], ['c1', 1], false);

        expect(editor.getValue()).toBe(CODE_ABOVE_RESULT);
        expect(caretOf(editor)).toBe('"co"@2');
    });

    it('D18: into the end of a list\'s last item keeps that item, emptied, and its list', () => {
        const editor = deleteRange(TABLE_THEN_LIST, 'first-cell-start', ['two', 3], false);

        expect(editor.getValue()).toBe('-');
        expect(rootChildren(editor)).toEqual(['list:']);
        expect(caretOf(editor)).toBe('markdown-list-item-text@0');
        expect(editorSurfaceModel(editor)).toEqual(viewerModel(editor.getValue()).blocks);
    });

    it('D19: into the end of a fence\'s only line keeps the fence and its column', () => {
        const editor = deleteRange(TABLE_THEN_FENCE, 'first-cell-start', ['A', 1], false);

        expect(editor.getValue()).toBe('::: x\n\n:::');
        expect(caretOf(editor)).toBe('paragraph@0');
        expect(editorSurfaceModel(editor)).toEqual(viewerModel(editor.getValue()).blocks);
    });

    it('D20: into a heading keeps the heading\'s type', () => {
        const editor = deleteRange(TABLE_THEN_HEADING, 'first-cell-start', ['head ing', 3], false);

        expect(editor.getValue()).toBe('## d ing');
        expect(caretOf(editor)).toBe('"d ing"@0');
    });

    it('D21: into a table that is a fence\'s only block leaves its column an empty paragraph', () => {
        const editor = deleteRange(FENCE_ONLY_TABLE, ['Above para', 4], 'last-cell-end', false);
        const column = lexicalOf(editor).read(() => {
            const fence = $getRoot().getChildAtIndex(1) as ElementNode;

            return (fence.getFirstChildOrThrow() as ElementNode).getChildren().map((child) => `${child.getType()}:${child.getTextContent()}`);
        });

        expect(editor.getValue()).toBe('Abov\n\n::: x\n\n:::');
        expect(column).toEqual(['paragraph:']);
        expect(caretOf(editor)).toBe('"Abov"@4');
        expect(editorSurfaceModel(editor)).toEqual(viewerModel(editor.getValue()).blocks);
    });

    it('D22: from a table that opens a list item into the item\'s own text keeps no part of the table', () => {
        const editor = loadWithTableOpeningTail('- item\n- tail');

        select(editor, 'first-cell-start', ['tail', 2]);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);

        // The table made the list loose, and it stays loose once the table is gone, as with a plain
        // `remove()` of the table: only the table and `ta` go.
        expect(editor.getValue()).toBe('- item\n\n- il');
        expect(holdsTable(editor)).toBe(false);
        expect(caretOf(editor)).toBe('"il"@0');
    });

    it('D23: from a paragraph into a table that opens a list item leaves the item\'s own text in its item', () => {
        const editor = loadWithTableOpeningTail('Above para\n\n- tail');

        select(editor, ['Above para', 4], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);

        expect(editor.getValue()).toBe('Abov\n\n- tail');
        expect(caretOf(editor)).toBe('"Abov"@4');
    });

    it('D24: from a table into a table that opens a list item takes both tables whole', () => {
        const editor = loadWithTableOpeningTail(`Above para\n\n${T}\n\nmid\n\n- tail`);

        select(editor, ['c1', 1], 'last-table-end');
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);

        expect(editor.getValue()).toBe('Above para\n\n- tail');
        expect(lexicalOf(editor).read(() => $dfs().some(({ node }) => $isTableNode(node)))).toBe(false);
        expect(caretOf(editor)).toBe('"tail"@0');
    });

    it('D25: from an earlier item of the list into a table that opens a list item', () => {
        const editor = loadWithTableOpeningTail('- item\n- tail');

        select(editor, ['item', 2], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);

        // Loose, as in D22.
        expect(editor.getValue()).toBe('- it\n\n- tail');
        expect(caretOf(editor)).toBe('"it"@2');
    });

    // Lists of one marker made next to each other in the editor join, as Lexical joins them: the list past
    // the table keeps its items as they were, in the one list.
    it('D26: a table that stood between two lists of one marker leaves them joined', () => {
        const editor = deleteRange(`- uno\n\n${T}\n\n- one\n- two`, ['uno', 1], 'last-cell-end', false);

        expect(editor.getValue()).toBe('- u\n- one\n- two');
        expect(caretOf(editor)).toBe('"u"@1');
    });

    // The range starts and ends in the one list item holding the table. The text after the table is a paragraph
    // of the item, and a table-edge removal joins nothing, as at the top level (D4): the paragraph stays one.
    it('D27: from a table between two texts of a list item into the text after it keeps the item and the text before', () => {
        const editor = loadWithTableBetweenHeadAndTail('- item\n- tail');

        select(editor, 'first-cell-start', ['tail', 2]);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);

        expect(editor.getValue()).toBe('- item\n\n- head\n\n  il');
        expect(holdsTable(editor)).toBe(false);
        expect(caretOf(editor)).toBe('"il"@0');
    });

    it('D28: from a table that opens a list\'s only item to the end of the item\'s text keeps the item, emptied', () => {
        const editor = loadWithTableOpeningTail('- tail');

        select(editor, 'first-cell-start', ['tail', 4]);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);

        expect(editor.getValue()).toBe('-');
        expect(rootChildren(editor)).toEqual(['list:']);
        expect(caretOf(editor)).toBe('markdown-list-item-text@0');
    });

    it('D29: from the text before a table in a list item into the table keeps the text after it in the item', () => {
        const editor = loadWithTableBetweenHeadAndTail('- item\n- tail');

        select(editor, ['head', 2], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);

        // As at the top level (D1): the paragraph after the table is not joined to the text before it.
        expect(editor.getValue()).toBe('- item\n\n- he\n\n  tail');
        expect(holdsTable(editor)).toBe(false);
        expect(caretOf(editor)).toBe('"he"@2');
    });

    it('D30: typing over the range of D29 types at the end of the item\'s text, before its paragraph', () => {
        const editor = loadWithTableBetweenHeadAndTail('- item\n- tail');

        select(editor, ['head', 2], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('- item\n\n- hex\n\n  tail');
        expect(holdsTable(editor)).toBe(false);
    });

    // A list item cannot be empty, and Lexical's removal takes an element that says so once it has emptied it. A
    // range that covers every block of the item at whose table it starts or ends leaves that item, emptied, as a
    // range into the end of an item's text does (D18).
    it.each<[string, string, End, End, string, string]>([
        // Two documents the list-edit fuzz threw on (`Expected node … to have a parent`): the range ends in a table
        // that is the last block of a list item.
        ['D31: into a table that is all a list item holds, from a block of the item before',
            '| t9 |\n| --- |\n| u10 |\n\n+ w0\n\n\n  ::: {align=center}\n  f1\n  :::\n  ***\n+ | h2 |\n  | --- |\n  | c3 |\n\n```\nk5\n```',
            ['f1', 1], ['c3', 1], '| t9 |\n| --- |\n| u10 |\n\n+ w0\n\n  ::: {align=center}\n  f\n  :::\n\n+\n\n```\nk5\n```', '"f"@1'],
        ['D32: into a table that ends a list item, from the text of the item before: the item\'s text goes with its table',
            '[d]: /first\n\n- w0\n\n\n  [d]: /u1 "t\n\n  u2"\n- w3\n\n  | h4 |\n  | --- |\n  | c5 |\n- * n6\n\n    p7\n\n# g12',
            ['w0', 1], ['c5', 1], '[d]: /first\n\n- w\n\n-\n\n- * n6\n\n    p7\n\n# g12', '"w"@1'],
        ['D33: from a paragraph into a table that is all the list\'s last item holds, over the item before it',
            `p\n\n- x\n- ${T.replace(/\n/g, '\n  ')}`, ['p', 1], ['c1', 1], 'p\n\n-', '"p"@1'],
        ['D34: from a table that is all a list\'s first item holds to the end of the next item\'s text',
            `- ${T.replace(/\n/g, '\n  ')}\n- z`, 'first-cell-start', ['z', 1], '-\n-', 'markdown-list-item-text@0'],
        ['D36: from one table of a list item into another table of the same item takes both and what stands between them',
            '- a\n\n  | h |\n  | --- |\n  | c1 |\n\n  mid\n\n  | x |\n  | --- |\n  | y |\n\n  tail\n- z', ['c1', 1], ['y', 1], '- a\n\n  tail\n\n- z',
            // The caret enters the block after the removed tables, as at the top level (D4).
            '"tail"@0'],
        ['D35: into a table that is all a nested item holds',
            `- k\n  - ${T.replace(/\n/g, '\n    ')}\n- z`, ['k', 1], ['c1', 1], '- k\n  *\n- z', '"k"@1'],
    ])('%s', (_name, source, anchor, focus, saved, caret) => {
        for (const isBackward of [true, false]) {
            const editor = deleteRange(source, anchor, focus, isBackward);

            expect(editor.getValue()).toBe(saved);
            expect(holdsTable(editor)).toBe(source.startsWith('| t9'));
            expect(caretOf(editor)).toBe(caret);
            expect(editorSurfaceModel(editor)).toEqual(viewerModel(saved).blocks);
        }
    });
});

describe('every route removing a range across a table\'s edge takes the whole table (R rows)', () => {
    it('R1: DELETE_WORD_COMMAND', () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(DELETE_WORD_COMMAND, false);

        expect(editor.getValue()).toBe('Abov\n\nafter');
    });

    it('R2: typing over the range', () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('Abovx\n\nafter');
    });

    it('R3: typing over a range from a cell into the paragraph after', () => {
        const editor = load(DOC);

        select(editor, 'first-cell-start', ['after', 2]);
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('Above para\n\nxter');
    });

    it('R4: Enter over the range', () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);

        expect(editor.getValue()).toBe('Abov\n\nafter');
        expect(rootChildren(editor)).toEqual(['paragraph:Abov', 'paragraph:', 'paragraph:after']);
        expect(caretOf(editor)).toBe('paragraph@0');
        expect(caretBlockIndex(editor)).toBe(1);
    });

    it('R5: Enter over a range from a cell into the paragraph after', () => {
        const editor = load(DOC);

        select(editor, 'first-cell-start', ['after', 2]);
        lexicalOf(editor).dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);

        expect(editor.getValue()).toBe('Above para\n\nter');
        expect(rootChildren(editor)).toEqual(['paragraph:Above para', 'paragraph:', 'paragraph:ter']);
        expect(caretOf(editor)).toBe('"ter"@0');
    });

    it('R6: cut()', () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], 'last-cell-end');
        editor.cut();

        expect(editor.getValue()).toBe('Abov\n\nafter');
    });

    it('R7: a native cut (CUT_COMMAND) copies, then removes the range', async () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);

        await vi.waitFor(() => expect(editor.getValue()).toBe('Abov\n\nafter'));
        expect(copyToClipboard).toHaveBeenCalledTimes(1);
    });

    it('R8: paste()', async () => {
        const editor = load(DOC);

        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('zz');
        select(editor, ['Above para', 4], 'last-cell-end');
        await editor.paste();

        expect(editor.getValue()).toBe('Abovzz\n\nafter');
    });

    it('R9: insertImage()', () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], 'last-cell-end');
        editor.insertImage('/i.png', { alt: 'i' });

        expect(editor.getValue()).toBe('Abov![i](/i.png)\n\nafter');
    });

    // The removal takes the rest of the raw block, so the caret is left at the block's end, where Enter starts
    // a new paragraph after the block: a line break there would end the block, and the save would drop it.
    it('R10: Enter over a range from a raw block into a cell', () => {
        const editor = load(RAW_ABOVE);

        select(editor, ['raw text', 2], ['c1', 1]);
        lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);

        expect(rootChildren(editor)).toEqual(RAW_ABOVE_ENTER_RESULT);
        expect(caretOf(editor)).toBe('paragraph@0');
        expect(caretBlockIndex(editor)).toBe(1);
    });

    it('R11: DELETE_LINE_COMMAND', () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(DELETE_LINE_COMMAND, false);

        expect(editor.getValue()).toBe('Abov\n\nafter');
    });

    it('R12: REMOVE_TEXT_COMMAND over a range from a cell into the paragraph after', () => {
        const editor = load(DOC);

        select(editor, 'first-cell-start', ['after', 2]);
        lexicalOf(editor).dispatchCommand(REMOVE_TEXT_COMMAND, null);

        expect(editor.getValue()).toBe('Above para\n\nter');
    });

    // The value Shift+Enter gives at a caret at the start of `ter`: the break opens the paragraph.
    it('R13: INSERT_LINE_BREAK_COMMAND over a range from a cell into the paragraph after', () => {
        const editor = load(DOC);

        select(editor, 'first-cell-start', ['after', 2]);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

        expect(editor.getValue()).toBe('Above para\n\n\\\nter');
    });

    // `registerRichText` inserts a tab at the caret; the save trims it from the paragraph's end.
    it('R14: INSERT_TAB_COMMAND', () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(INSERT_TAB_COMMAND, undefined);

        expect(editor.getValue()).toBe('Abov\n\nafter');
        expect(rootChildren(editor)).toEqual(['paragraph:Abov\t', 'paragraph:after']);
    });

    it('R15: a plain-text paste (PASTE_COMMAND)', () => {
        const editor = load(DOC);

        // `registerRichText`'s paste handler tells clipboard, drag, input and key events apart by class name.
        vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
        vi.stubGlobal('DragEvent', class DragEvent {});
        vi.stubGlobal('InputEvent', class InputEvent {});
        vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});

        const event = Object.assign(new ClipboardEvent('paste'), {
            clipboardData: { types: ['text/plain'], files: [], getData: (type: string) => (type === 'text/plain' ? 'zz' : '') },
            preventDefault: () => {},
        });

        select(editor, 'first-cell-start', ['after', 2]);
        lexicalOf(editor).update(() => {
            lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event);
        }, { discrete: true });

        expect(editor.getValue()).toBe('Above para\n\nzzter');
    });

    // `$insertGeneratedNodes` is the clipboard's paste and drop path: it dispatches
    // SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, then inserts the nodes itself when no listener took them.
    it('R16: pasted or dropped nodes (SELECTION_INSERT_CLIPBOARD_NODES_COMMAND)', () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], 'last-cell-end');
        lexicalOf(editor).update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                $insertGeneratedNodes(lexicalOf(editor), [$createTextNode('zz')], selection);
            }
        }, { discrete: true });

        expect(editor.getValue()).toBe('Abovzz\n\nafter');
    });

    // Enter over a range is the range's removal, then Enter at the caret the removal leaves. Here the caret
    // lands at the raw block's start, where Enter puts an empty paragraph before the block, as at a paragraph's
    // start; R10, R31 and R32 leave it at the block's end.
    it('R17: Enter over a backward range from a raw block into a cell above it', () => {
        const editor = load(RAW_BELOW);

        select(editor, ['raw text', 2], 'first-cell-start');
        lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);

        // `w text` no longer opens an HTML block, so the rest of the raw block reads as a paragraph and `</div>`.
        expect(rootChildren(editor)).toEqual(['paragraph:Above para', 'paragraph:', 'paragraph:w text', 'markdown-raw-block:</div>']);
        expect(caretOf(editor)).toBe('"w text"@0');
    });

    // The same range as R17, dragged the other way: Enter over it gives the same document.
    it('R18: Enter over a forward range from a cell into the raw block below it', () => {
        const editor = load(RAW_BELOW);

        select(editor, 'first-cell-start', ['raw text', 2]);
        lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);

        expect(rootChildren(editor)).toEqual(['paragraph:Above para', 'paragraph:', 'paragraph:w text', 'markdown-raw-block:</div>']);
        expect(caretOf(editor)).toBe('"w text"@0');
    });

    // The same range as R10, dragged the other way.
    it('R19: Enter over a backward range from a cell into the raw block above it', () => {
        const editor = load(RAW_ABOVE);

        select(editor, ['c1', 1], ['raw text', 2]);
        lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);

        expect(rootChildren(editor)).toEqual(RAW_ABOVE_ENTER_RESULT);
        expect(caretOf(editor)).toBe('paragraph@0');
        expect(caretBlockIndex(editor)).toBe(1);
    });

    // The table closes its column, so the removal leaves the caret at the end of `before`, outside the raw
    // block: Enter there starts a new paragraph in the column, whichever way the range was dragged.
    it.each([
        ['backward', ['raw text', 2], 'first-cell-start'],
        ['forward', 'first-cell-start', ['raw text', 2]],
    ] as const)('R20: Enter over a %s range between a raw block and a table closing a column before it', (_direction, anchor, focus) => {
        const editor = load(RAW_AFTER_COLUMN_TABLE);

        select(editor, anchor as End, focus as End);
        lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);

        const secondColumn = lexicalOf(editor).read(() => {
            const column = ($getRoot().getFirstChildOrThrow() as ElementNode).getChildAtIndex(1) as ElementNode;

            return column.getChildren().map((child) => `${child.getType()}:${child.getTextContent()}`);
        });

        expect(secondColumn).toEqual(['paragraph:before', 'paragraph:']);
        expect(caretOf(editor)).toBe('paragraph@0');
    });

    // Lexical types over a range in the format of the range's first text node; so does this route.
    it('R21: typing over a range that starts in bold text types bold', () => {
        const editor = load(BOLD_ABOVE);

        select(editor, ['Above para', 4], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('**Abovx**\n\nafter');
    });

    // A code block holds only text, so an image cannot go into it: it takes the tables' place instead.
    it('R22: insertImage() over a range whose removal leaves the caret at a code block\'s start', () => {
        const editor = load(TABLES_THEN_CODE);

        select(editor, ['c1', 1], ['y', 1]);
        editor.insertImage('/i.png', { alt: 'i' });

        expect(editor.getValue()).toBe(TABLES_THEN_CODE_IMAGE_RESULT);
    });

    it('R23: insertImage() over a range whose removal leaves the caret at a code block\'s end', () => {
        const editor = load(COLUMN_CODE_THEN_TABLE);

        select(editor, 'first-cell-start', ['after', 2]);
        editor.insertImage('/i.png', { alt: 'i' });

        expect(editor.getValue()).toBe(COLUMN_CODE_THEN_TABLE_IMAGE_RESULT);
    });

    // A cut copies what it removes: the whole table, as a selection the browser grew over the table copies it.
    it('R24: cut() of a range ending in a cell\'s word copies the whole table', () => {
        const grown = load(DOC);
        const write = vi.spyOn(DOM.sink, 'writeClipboardText');

        select(grown, ['Above para', 4], 'last-cell-end');
        grown.cut();

        const editor = load(DOC);

        select(editor, ['Above para', 4], ['c1', 1]);
        editor.cut();

        expect(write).toHaveBeenCalledTimes(2);
        expect(write.mock.calls[0]![0]).toContain('d1');
        expect(write.mock.calls[1]![0]).toBe(write.mock.calls[0]![0]);
    });

    it('R25: a native cut (CUT_COMMAND) of a range from one table into another copies both tables whole', async () => {
        const editor = load(TWO_TABLES);

        select(editor, ['c1', 1], ['x', 1]);
        lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);

        await vi.waitFor(() => expect(editor.getValue()).toBe('Above para\n\nafter'));

        const text = vi.mocked(copyToClipboard).mock.calls[0]![2]?.['text/plain'] ?? '';

        expect(text.split(/\s+/)).toEqual(['a', 'b', 'c1', 'd1', 'mid', 'x', 'y']);
    });

    it('R26: typing over a range that starts in a table types in the format of the text the caret lands in', () => {
        const editor = load(BOLD_BELOW);

        select(editor, 'first-cell-start', ['after', 2]);
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('Above para\n\n**xter**');
    });

    describe('R27: a paste that inserts nothing leaves the range as it is', () => {
        const emptyPastes: Array<[string, Record<string, string>, number]> = [
            ['a files-only clipboard (a pasted screenshot)', {}, 1],
            ['an empty clipboard', {}, 0],
            ['a clipboard whose text is empty', { 'text/plain': '' }, 0],
            ['files beside a link list, which the files take the paste from', { 'text/uri-list': 'https://u.test' }, 1],
        ];

        for (const [name, data, files] of emptyPastes) {
            it(`${name} over the table-edge range`, () => {
                const editor = load(DOC);

                select(editor, ['Above para', 4], 'last-cell-end');
                pasteClipboard(editor, data, files);

                expect(editor.getValue()).toBe(DOC);
                expect(rangeOf(editor)).toBe('"Above para"@4 -> tablecell@1');
            });

            it(`${name} over a range outside the table changes nothing either (control)`, () => {
                const editor = load(DOC);

                select(editor, ['Above para', 4], ['Above para', 7]);
                pasteClipboard(editor, data, files);

                expect(editor.getValue()).toBe(DOC);
            });
        }

        it('a paste event with no clipboard (a key event) over the table-edge range', () => {
            const editor = load(DOC);

            vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
            vi.stubGlobal('DragEvent', class DragEvent {});
            vi.stubGlobal('InputEvent', class InputEvent {});
            vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});

            const event = Object.assign(new KeyboardEvent('keydown'), { preventDefault: () => {} });

            select(editor, ['Above para', 4], 'last-cell-end');
            lexicalOf(editor).update(() => {
                lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event);
            }, { discrete: true });

            expect(editor.getValue()).toBe(DOC);
        });

        it('pasted nodes that come to none (HTML holding only an image) over the table-edge range', () => {
            const editor = load(DOC);

            select(editor, ['Above para', 4], 'last-cell-end');
            lexicalOf(editor).update(() => {
                const selection = $getSelection() as RangeSelection;

                lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes: [], selection });
            }, { discrete: true });

            expect(editor.getValue()).toBe(DOC);
            expect(rangeOf(editor)).toBe('"Above para"@4 -> tablecell@1');
        });

        const insertingPastes: Array<[string, Record<string, string>, number]> = [
            ['files beside text', { 'text/plain': 'zz' }, 1],
            ['a link list alone', { 'text/uri-list': 'zz' }, 0],
        ];

        for (const [name, data, files] of insertingPastes) {
            it(`${name} still replaces the table-edge range (control)`, () => {
                const editor = load(DOC);

                select(editor, ['Above para', 4], 'last-cell-end');
                pasteClipboard(editor, data, files);

                expect(editor.getValue()).toBe('Abovzz\n\nafter');
            });
        }
    });

    // One rule for a copy and a cut: the clipboard gets what a cut of the selection removes.
    describe('R28: a copy of a range across a table\'s edge copies what a cut of it removes, whole tables included', () => {
        const edgeRanges: [name: string, source: string, anchor: End, focus: End, words: string[]][] = [
            ['a range from a paragraph into a cell\'s word', DOC, ['Above para', 4], ['c1', 1], ['e', 'para', 'a', 'b', 'c1', 'd1']],
            ['a range from a cell\'s word back into the paragraph above', DOC, ['c1', 1], ['Above para', 4], ['e', 'para', 'a', 'b', 'c1', 'd1']],
            ['a range from a cell\'s word into the paragraph after', DOC, ['c1', 1], ['after', 2], ['a', 'b', 'c1', 'd1', 'af']],
            ['a range from the paragraph after back into a cell\'s word', DOC, ['after', 2], ['c1', 1], ['a', 'b', 'c1', 'd1', 'af']],
            ['a range from one table into another', TWO_TABLES, ['c1', 1], ['x', 1], ['a', 'b', 'c1', 'd1', 'mid', 'x', 'y']],
        ];

        /**
         * Dispatches a native copy and tells whether the editor's guard left
         * it to the handlers behind it. Lexical's own copy, which copies the
         * selection as it stands, needs a browser, so a listener ahead of it
         * takes the command here.
         *
         * @param editor - The editor.
         * @returns Whether the command got past the editor's guard.
         */
        function nativeCopyIsLeftToLexical(editor: MarkdownEditor): boolean {
            const lexicalCopy = vi.fn(() => true);
            const unregister = lexicalOf(editor).registerCommand(COPY_COMMAND, lexicalCopy, COMMAND_PRIORITY_LOW);

            lexicalOf(editor).dispatchCommand(COPY_COMMAND, null);
            unregister();

            return lexicalCopy.mock.calls.length === 1;
        }

        for (const [name, source, anchor, focus, words] of edgeRanges) {
            it(`${name}: copy() and a native copy (COPY_COMMAND) both give the cut's payload`, async () => {
                const write = vi.spyOn(DOM.sink, 'writeClipboardText');
                const cutByMethod = load(source);
                const copiedByMethod = load(source);
                const cutNatively = load(source);
                const copiedNatively = load(source);

                for (const editor of [cutByMethod, copiedByMethod, cutNatively, copiedNatively]) {
                    select(editor, anchor, focus);
                }

                const range = rangeOf(copiedByMethod);

                cutByMethod.cut();
                copiedByMethod.copy();
                lexicalOf(cutNatively).dispatchCommand(CUT_COMMAND, null);

                const isHandled = lexicalOf(copiedNatively).dispatchCommand(COPY_COMMAND, null);
                const [cutText, copiedText] = write.mock.calls.map(([text]) => text);
                const [nativeCutData, nativeCopyData] = vi.mocked(copyToClipboard).mock.calls.map(([, , data]) => data);

                expect(cutText?.trim().split(/\s+/)).toEqual(words);
                expect(copiedText, 'copy()').toBe(cutText);
                expect(nativeCutData?.['text/plain'], 'a native cut').toBe(cutText);
                expect(isHandled).toBe(true);
                expect(nativeCopyData, 'a native copy').toEqual(nativeCutData);

                for (const editor of [copiedByMethod, copiedNatively]) {
                    expect(editor.getValue()).toBe(source);
                    expect(rangeOf(editor)).toBe(range);
                }

                await vi.waitFor(() => expect(cutNatively.getValue()).toBe(cutByMethod.getValue()));
            });
        }

        // A browser's copy event carries the clipboard to write; Lexical's fallback for a missing one is asynchronous.
        it('a native copy hands the browser\'s copy event on', () => {
            const editor = load(DOC);
            const event = { clipboardData: {} } as ClipboardEvent;

            select(editor, ['Above para', 4], ['c1', 1]);
            lexicalOf(editor).dispatchCommand(COPY_COMMAND, event);

            expect(copyToClipboard).toHaveBeenCalledTimes(1);
            expect(vi.mocked(copyToClipboard).mock.calls[0]![1]).toBe(event);
        });

        // Given no copy event, `copyToClipboard` has the browser fire one and takes it in a listener it registers
        // at CRITICAL for that long. That event belongs to a copy or a cut already under way, so the guard,
        // registered long before that listener, must not take it first.
        it('a native copy stays behind a CRITICAL listener, where Lexical\'s clipboard waits for the browser\'s copy event', () => {
            const editor = load(DOC);
            const awaitedCopy = vi.fn(() => true);

            select(editor, ['Above para', 4], ['c1', 1]);
            lexicalOf(editor).registerCommand(COPY_COMMAND, awaitedCopy, COMMAND_PRIORITY_CRITICAL);
            lexicalOf(editor).dispatchCommand(COPY_COMMAND, null);

            expect(awaitedCopy).toHaveBeenCalledTimes(1);
            expect(copyToClipboard).not.toHaveBeenCalled();
        });

        it('neither copy is an undo step', () => {
            const editor = load(DOC);

            select(editor, ['d1', 2], ['d1', 2]);
            lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'z');

            const edited = editor.getValue();

            select(editor, ['Above para', 4], ['c1', 1]);
            editor.copy();
            lexicalOf(editor).dispatchCommand(COPY_COMMAND, null);

            expect(edited).not.toBe(DOC);
            expect(editor.getValue()).toBe(edited);
            lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

            expect(editor.getValue()).toBe(DOC);
        });

        const rangesCrossingNoEdge: [name: string, source: string, anchor: End, focus: End][] = [
            ['a range inside one cell', DOC, ['c1', 0], ['c1', 1]],
            ['a range from one cell to another of the same table', DOC, ['a', 0], ['d1', 1]],
            ['a range between two paragraphs', TWO_PARAS, ['p1 text', 3], ['p2 text', 2]],
        ];

        for (const [name, source, anchor, focus] of rangesCrossingNoEdge) {
            it(`${name} is copied as it stands (control)`, () => {
                const editor = load(source);
                const write = vi.spyOn(DOM.sink, 'writeClipboardText');

                select(editor, anchor, focus);

                const selected = lexicalOf(editor).read(() => $getSelection()?.getTextContent());
                const range = rangeOf(editor);

                editor.copy();

                const isLeftToLexical = nativeCopyIsLeftToLexical(editor);

                expect(write.mock.calls).toEqual([[selected]]);
                expect(isLeftToLexical).toBe(true);
                expect(copyToClipboard).not.toHaveBeenCalled();
                expect(editor.getValue()).toBe(source);
                expect(rangeOf(editor)).toBe(range);
            });
        }

        it('selected cells of one table are left to Lexical\'s own copy (control)', () => {
            const editor = load(DOC);

            lexicalOf(editor).update(() => {
                const table = $firstTable();
                const firstCell = (table.getFirstChildOrThrow() as ElementNode).getFirstChildOrThrow() as TableCellNode;
                const lastCell = (table.getLastChildOrThrow() as ElementNode).getLastChildOrThrow() as TableCellNode;

                $setSelection($createTableSelectionFrom(table, firstCell, lastCell));
            }, { discrete: true });

            const isLeftToLexical = nativeCopyIsLeftToLexical(editor);

            expect(isLeftToLexical).toBe(true);
            expect(copyToClipboard).not.toHaveBeenCalled();
            expect(editor.getValue()).toBe(DOC);
        });
    });

    // An empty code block's start and end are one point, so the caret alone cannot tell which side the table was on.
    it('R29: insertImage() over a range whose removal leaves the caret in an empty code block before the table', () => {
        const editor = load(COLUMN_EMPTY_CODE_THEN_TABLE);

        select(editor, 'first-cell-start', ['after', 2]);
        editor.insertImage('/i.png', { alt: 'i' });

        expect(editor.getValue()).toBe(COLUMN_EMPTY_CODE_THEN_TABLE_IMAGE_RESULT);
    });

    it('R30: insertImage() over a range whose removal leaves the caret in an empty code block after the tables', () => {
        const editor = load(TABLES_THEN_EMPTY_CODE);

        select(editor, ['c1', 1], ['y', 1]);
        editor.insertImage('/i.png', { alt: 'i' });

        expect(editor.getValue()).toBe(TABLES_THEN_EMPTY_CODE_IMAGE_RESULT);
    });

    // The caret goes down into the fence the second table opened, and there to the code block after that table.
    it('R38: insertImage() over a range whose removal leaves the caret at a code block inside a fence', () => {
        const editor = load(TABLES_THEN_FENCED_CODE);

        select(editor, ['c1', 1], ['y', 1]);
        editor.insertImage('/i.png', { alt: 'i' });

        expect(editor.getValue()).toBe(TABLES_THEN_FENCED_CODE_IMAGE_RESULT);
    });

    // Lexical itself takes a caret left first or last in the document into the block beside it; the image
    // still goes where the tables were, on the side of that block they stood on.
    it('R39: insertImage() over a range whose removal leaves a code block opening the document', () => {
        const editor = load(LEADING_TABLES_THEN_CODE);

        select(editor, ['c1', 1], ['y', 1]);
        editor.insertImage('/i.png', { alt: 'i' });

        expect(editor.getValue()).toBe(LEADING_TABLES_THEN_CODE_IMAGE_RESULT);
    });

    it('R40: insertImage() over a backward range whose removal leaves an empty code block closing the document', () => {
        const editor = load(EMPTY_CODE_THEN_CLOSING_TABLES);

        select(editor, 'last-table-end', ['c1', 1]);
        editor.insertImage('/i.png', { alt: 'i' });

        expect(editor.getValue()).toBe(EMPTY_CODE_THEN_CLOSING_TABLES_IMAGE_RESULT);
    });

    // Enter over a range gives what the range's removal, then Enter at the caret, gives: at a raw block's end
    // that is a new paragraph after the block, not a line break inside it, which the save would drop.
    it('R31: Enter over a range from a raw block\'s end into a cell starts a paragraph after the block', () => {
        const editor = load(RAW_ABOVE);

        select(editor, ['</div>', 6], ['c1', 1]);
        lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);

        const removedThenEnter = deleteRange(RAW_ABOVE, ['</div>', 6], ['c1', 1], false);

        removedThenEnter.getValue();
        lexicalOf(removedThenEnter).dispatchCommand(KEY_ENTER_COMMAND, null);

        expect(rootChildren(editor)).toEqual(['markdown-raw-block:<div>\nraw text\n</div>', 'paragraph:', 'paragraph:after']);
        expect(caretOf(editor)).toBe('paragraph@0');
        expect(caretBlockIndex(editor)).toBe(1);
        expect(rootChildren(editor)).toEqual(rootChildren(removedThenEnter));
        expect(caretBlockIndex(editor)).toBe(caretBlockIndex(removedThenEnter));
    });

    // The removal empties the raw block, and Enter in an empty raw block starts a paragraph after it.
    it('R32: Enter over a range from a cell to the end of the raw block below starts a paragraph after the emptied block', () => {
        const editor = load(RAW_BELOW);

        select(editor, 'first-cell-start', ['</div>', 6]);
        lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);

        const removedThenEnter = deleteRange(RAW_BELOW, 'first-cell-start', ['</div>', 6], false);

        removedThenEnter.getValue();
        lexicalOf(removedThenEnter).dispatchCommand(KEY_ENTER_COMMAND, null);

        expect(rootChildren(editor)).toEqual(['paragraph:Above para', 'markdown-raw-block:', 'paragraph:']);
        expect(caretOf(editor)).toBe('paragraph@0');
        expect(caretBlockIndex(editor)).toBe(2);
        expect(rootChildren(editor)).toEqual(rootChildren(removedThenEnter));
        expect(caretBlockIndex(editor)).toBe(caretBlockIndex(removedThenEnter));
    });

    // The range's end in the table is a point on a cell, not inside a word, so it is a table-edge range and no
    // stale-focus one: the whole table goes all the same, and Enter acts at the raw block's end, as in R10.
    it.each([
        ['forward', ['raw text', 2], 'last-cell-end'],
        ['backward', 'last-cell-end', ['raw text', 2]],
    ] as const)('R41: Enter over a %s range from a raw block to the end of the last cell', (_direction, anchor, focus) => {
        const editor = load(RAW_ABOVE);

        select(editor, anchor as End, focus as End);
        lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);

        expect(rootChildren(editor)).toEqual(RAW_ABOVE_ENTER_RESULT);
        expect(holdsTable(editor)).toBe(false);
        expect(caretOf(editor)).toBe('paragraph@0');
        expect(caretBlockIndex(editor)).toBe(1);
    });

    // Markdown has no line break at a block's end, so Shift+Enter is declined where nothing would follow the
    // break — and a declined Shift+Enter changes nothing, over this range as over any other.
    describe('R33: Shift+Enter (INSERT_LINE_BREAK_COMMAND) the removal would leave at a block\'s end is declined, range and all', () => {
        const declined: Array<[string, string, End, End, string]> = [
            ['from a paragraph to the end of the last cell', DOC, ['Above para', 4], 'last-cell-end', '"Above para"@4 -> tablecell@1'],
            ['the same range dragged backward', DOC, 'last-cell-end', ['Above para', 4], 'tablecell@1 -> "Above para"@4'],
            ['from a paragraph into a cell\'s word', DOC, ['Above para', 4], ['c1', 1], '"Above para"@4 -> "c1"@1'],
            ['from a cell to the end of the paragraph after', DOC, 'first-cell-start', ['after', 5], 'tablecell@0 -> "after"@5'],
            ['from a table closing a column out of the fence', COLUMN_BEFORE_TABLE, 'first-cell-start', ['after', 2], 'tablecell@0 -> "after"@2'],
            ['from a cell into a level 3 heading', TABLE_THEN_DEEP_HEADING, 'first-cell-start', ['head ing', 3], 'tablecell@0 -> "head ing"@3'],
            ['from a paragraph into the document\'s last table', TABLE_LAST, ['Above para', 4], 'last-cell-end', '"Above para"@4 -> tablecell@1'],
        ];

        for (const [name, source, anchor, focus, range] of declined) {
            it(name, () => {
                const editor = load(source);
                const before = rootChildren(editor);

                select(editor, anchor, focus);
                lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

                expect(editor.getValue()).toBe(source);
                expect(rootChildren(editor)).toEqual(before);
                expect(rangeOf(editor)).toBe(range);
            });
        }

        it('an ordinary range ending at a block\'s end is declined the same way (control)', () => {
            const editor = load(DOC);

            select(editor, ['Above para', 4], ['after', 5]);
            lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

            expect(editor.getValue()).toBe(DOC);
            expect(rangeOf(editor)).toBe('"Above para"@4 -> "after"@5');
        });

        // Kept, each the value Shift+Enter gives at the caret the removal leaves.
        it('from one table into another, with a paragraph after: the break opens that paragraph', () => {
            const editor = load(TWO_TABLES);

            select(editor, ['c1', 1], ['y', 1]);
            lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

            expect(editor.getValue()).toBe('Above para\n\n\\\nafter');
        });

        it('from a code block into the table after it: a code block takes a line break anywhere', () => {
            const editor = load(CODE_ABOVE);

            select(editor, ['code', 2], 'last-cell-end');
            lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

            expect(rootChildren(editor)).toEqual(['code:co\n', 'paragraph:after']);
        });

        it('from a cell into a level 2 heading: the break opens what is left of the heading', () => {
            const editor = load(TABLE_THEN_HEADING);

            select(editor, 'first-cell-start', ['head ing', 3]);
            lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

            expect(holdsTable(editor)).toBe(false);
            expect(rootChildren(editor)).toEqual(['heading:\nd ing']);
        });
    });

    it('R34: typing over a range that starts in styled text types in that style', () => {
        const editor = load(DOC);

        lexicalOf(editor).update(() => {
            $textNode('Above para').setStyle('color: red');
        }, { discrete: true });
        select(editor, ['Above para', 4], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');
        editor.getValue();

        expect(lexicalOf(editor).read(() => $textNode('Abovx').getStyle())).toBe('color: red');
    });

    it('R35: typing over a range that starts in a table types in the style of the text the caret lands in', () => {
        const editor = load(DOC);

        lexicalOf(editor).update(() => {
            $textNode('after').setStyle('color: red');
        }, { discrete: true });
        select(editor, 'first-cell-start', ['after', 2]);
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');
        editor.getValue();

        expect(lexicalOf(editor).read(() => $textNode('xter').getStyle())).toBe('color: red');
    });

    // The caret lands in a block with no text left to take a format from, so the typed text is plain, whatever
    // format and style the selection carried over the removed range.
    it('R36: typing over a range that starts in a table and empties the block after it types plain text', () => {
        const editor = load(BOLD_BELOW);

        select(editor, 'first-cell-start', ['after', 5]);
        lexicalOf(editor).update(() => {
            const selection = $getSelection() as RangeSelection;

            selection.format = $textNode('after').getFormat();
            selection.style = 'color: red';
        }, { discrete: true });
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('Above para\n\nx');
        expect(lexicalOf(editor).read(() => [$textNode('x').getFormat(), $textNode('x').getStyle()])).toEqual([0, '']);
    });

    // Both ends are in one table, so this is no table-edge range, though it is a stale-focus one: it types as
    // Lexical types over any range, in the format of the range's first text node, not of the text the caret lands in.
    it('R42: typing over a range inside one cell that starts in bold text types bold', () => {
        const editor = load(`| a | b |\n| --- | --- |\n| **c1** | d1 |`);

        lexicalOf(editor).update(() => {
            $textNode('c1').getParentOrThrow().insertAfter($createParagraphNode().append($createTextNode('second para')));
        }, { discrete: true });
        select(editor, ['c1', 0], ['second para', 3]);
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(lexicalOf(editor).read(() => [$textNode('x').hasFormat('bold'), $textNode('ond para').hasFormat('bold')])).toEqual([true, false]);
        expect(holdsTable(editor)).toBe(true);
    });

    // A range from a point on the root itself — no browser makes one, a programmatic selection can — to the end
    // of a document ending in a list or a `:::` block: its removal leaves the caret on the emptied list or block,
    // which holds no inline content. Lexical's insertion throws on the list, and loses the image in the block.
    describe('R43: insertImage() over a range from a point on the root to the end of a document ending in a list or a fence', () => {
        /**
         * Loads `source` and selects from the root's own start to the end of its last text.
         *
         * @param source - The Markdown to load.
         * @param isBackward - Whether the anchor is the end rather than the start.
         * @returns The editor.
         */
        function loadSelectedFromRoot(source: string, isBackward: boolean): MarkdownEditor {
            const editor = load(source);

            lexicalOf(editor).update(() => {
                const selection = $createRangeSelection();
                const last = $getRoot().getLastDescendant()!;
                const [start, end] = isBackward ? [selection.focus, selection.anchor] : [selection.anchor, selection.focus];

                start.set('root', 0, 'element');
                end.set(last.getKey(), last.getTextContentSize(), 'text');
                $setSelection(selection);
            }, { discrete: true });

            return editor;
        }

        it.each([
            ['a list', 'Above para\n\n- one\n- two'],
            ['a nested list', 'Above para\n\n- one\n  - two'],
            ['a list alone', '- one\n- two'],
            ['a table then a list', `${T}\n\n- one\n- two`],
            ['a fence', 'Above para\n\n::: x\nA\n:::'],
            ['a fence whose last column ends in a list', 'Above para\n\n::: columns\nA\n|||\n- one\n- two\n:::'],
        ])('ending in %s: the image is all that is left', (_name, source) => {
            for (const isBackward of [false, true]) {
                const editor = loadSelectedFromRoot(source, isBackward);

                expect(() => editor.insertImage('/i.png', { alt: 'i' })).not.toThrow();
                expect(editor.getValue()).toBe('![i](/i.png)');
                expect(editorSurfaceModel(editor)).toEqual(viewerModel(editor.getValue()).blocks);
            }
        });

        /**
         * Loads `source` and selects from the point on the root just before its second child to a point on
         * that child itself, a list or a `:::` block.
         *
         * @param source - The Markdown to load; its second block is the list or `:::` block.
         * @param childOffset - The offset of the point on the list or `:::` block.
         * @param isBackward - Whether the anchor is the end rather than the start.
         * @returns The editor.
         */
        function loadSelectedFromRootOntoSecondBlock(source: string, childOffset: number, isBackward: boolean): MarkdownEditor {
            const editor = load(source);

            lexicalOf(editor).update(() => {
                const selection = $createRangeSelection();
                const [start, end] = isBackward ? [selection.focus, selection.anchor] : [selection.anchor, selection.focus];

                start.set('root', 1, 'element');
                end.set($getRoot().getChildAtIndex(1)!.getKey(), childOffset, 'element');
                $setSelection(selection);
            }, { discrete: true });

            return editor;
        }

        // The removal empties the list or `:::` block and leaves the caret on the root, just before it.
        it.each([
            ['a list', 'Above para\n\n- one\n- two', ['paragraph:Above para', 'paragraph:'], 'Above para\n\n![i](/i.png)'],
            ['a list with a block after it', 'Above para\n\n- one\n- two\n\nafter', ['paragraph:Above para', 'paragraph:', 'paragraph:after'], 'Above para\n\n![i](/i.png)\n\nafter'],
            ['a fence', 'Above para\n\n::: columns\nA\n|||\nB\n:::', ['paragraph:Above para', 'paragraph:'], 'Above para\n\n![i](/i.png)'],
        ])('from a point on the root to the end of %s, on the list or fence itself: the emptied one is not left behind', (_name, source, children, saved) => {
            for (const isBackward of [false, true]) {
                const editor = loadSelectedFromRootOntoSecondBlock(source, 2, isBackward);

                expect(() => editor.insertImage('/i.png', { alt: 'i' })).not.toThrow();
                expect(rootChildren(editor)).toEqual(children);
                expect(editor.getValue()).toBe(saved);
                expect(editorSurfaceModel(editor)).toEqual(viewerModel(editor.getValue()).blocks);
            }
        });

        it('from a point on the root to between a list\'s items: the list keeps the item that is left', () => {
            for (const isBackward of [false, true]) {
                const editor = loadSelectedFromRootOntoSecondBlock('Above para\n\n- one\n- two', 1, isBackward);

                editor.insertImage('/i.png', { alt: 'i' });

                expect(rootChildren(editor)).toEqual(['paragraph:Above para', 'paragraph:', 'list:two']);
                expect(editor.getValue()).toBe('Above para\n\n![i](/i.png)\n\n- two');
            }
        });

        it('ending in a paragraph (control)', () => {
            const editor = loadSelectedFromRoot('Above para\n\nafter', false);

            editor.insertImage('/i.png', { alt: 'i' });

            expect(editor.getValue()).toBe('![i](/i.png)');
        });
    });

    describe('R37: insertTable() over the range removes it, then inserts the table at the caret', () => {
        const ranges: Array<[string, End, End, string]> = [
            ['from a paragraph into a cell\'s word', ['Above para', 4], ['c1', 1], `Abov\n\n${EMPTY_TABLE}\n\nafter`],
            ['from a paragraph to the end of the last cell', ['Above para', 4], 'last-cell-end', `Abov\n\n${EMPTY_TABLE}\n\nafter`],
            ['backward from the paragraph after into a cell\'s word', ['after', 2], ['d1', 1], `Above para\n\n${EMPTY_TABLE}\n\nter`],
        ];

        for (const [name, anchor, focus, saved] of ranges) {
            it(name, () => {
                const editor = load(DOC);

                select(editor, anchor, focus);
                editor.insertTable(2, 2);

                expect(editor.getValue()).toBe(saved);
                expect(lexicalOf(editor).read(() => $dfs().filter(({ node }) => $isTableNode(node)).length)).toBe(1);
            });
        }

        // A code block holds only text, so a table cannot go into it: it takes the tables' place instead.
        it('over a range whose removal leaves the caret at a code block\'s start', () => {
            const editor = load(TABLES_THEN_CODE);

            select(editor, ['c1', 1], ['y', 1]);
            editor.insertTable(2, 2);

            expect(editor.getValue()).toBe(`Above para\n\n${EMPTY_TABLE}\n\n\`\`\`\ncode\n\`\`\``);
        });

        // A cell holds no table, and Lexical declines to insert one there: the new table takes the removed
        // tables' place, ahead of the table left after them.
        it('over a range whose removal leaves the caret at another table', () => {
            const editor = load(`Above para\n\n${T}\n\nmid\n\n${T2}\n\n| p |\n| --- |\n| q |`);

            select(editor, ['c1', 1], ['y', 1]);
            editor.insertTable(2, 2);

            expect(editor.getValue()).toBe(`Above para\n\n${EMPTY_TABLE}\n\n| p |\n| --- |\n| q |`);
        });
    });
});

// `getValue()` commits the pending update first: an UNDO_COMMAND sent before
// that commit would run before the edit is recorded, and undo nothing.
describe('undoing a table-edge removal restores the document exactly (U rows)', () => {
    it('U1: undo after a delete restores the document and the selection', () => {
        const editor = deleteRange(DOC, ['Above para', 4], 'last-cell-end', false);

        expect(editor.getValue()).toBe('Abov\n\nafter');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(DOC);

        const [anchor, focus] = lexicalOf(editor).read(() => {
            const selection = $getSelection();
            const lastCell = ($firstTable().getLastChildOrThrow() as ElementNode).getLastChildOrThrow() as ElementNode;

            if (!$isRangeSelection(selection)) {
                return ['no range', 'no range'];
            }

            const atLastCellEnd = selection.focus.type === 'element'
                && selection.focus.key === lastCell.getKey()
                && selection.focus.offset === lastCell.getChildrenSize();

            return [$describePoint(selection.anchor), atLastCellEnd ? 'last-cell-end' : $describePoint(selection.focus)];
        });

        expect(anchor).toBe('"Above para"@4');
        expect(focus).toBe('last-cell-end');
    });

    it('U2: undo after typing over the range', () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('Abovx\n\nafter');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(DOC);
    });

    it('U3: undo after cut()', () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], 'last-cell-end');
        editor.cut();

        expect(editor.getValue()).toBe('Abov\n\nafter');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(DOC);
    });

    // The removal that keeps the end's block runs as two removals in one update: one undo step.
    it.each([
        ['into the end of a list\'s last item (D18)', TABLE_THEN_LIST, 'first-cell-start', ['two', 3], '-'],
        ['into the end of a fence\'s only line (D19)', TABLE_THEN_FENCE, 'first-cell-start', ['A', 1], '::: x\n\n:::'],
        ['between two lists of one marker (D26)', `- uno\n\n${T}\n\n- one\n- two`, ['uno', 1], 'last-cell-end', '- u\n- one\n- two'],
    ] as const)('U4: undo after a delete %s', (_name, source, anchor, focus, removed) => {
        const editor = deleteRange(source, anchor as End, focus as End, false);

        expect(editor.getValue()).toBe(removed);
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(source);
    });

    it.each([
        ['from a paragraph (D23)', 'Above para\n\n- tail', ['Above para', 4], 'last-cell-end', 'Abov\n\n- tail'],
        ['from another table (D24)', `Above para\n\n${T}\n\nmid\n\n- tail`, ['c1', 1], 'last-table-end', 'Above para\n\n- tail'],
        ['from an earlier item of the list (D25)', '- item\n- tail', ['item', 2], 'last-cell-end', '- it\n\n- tail'],
    ] as const)('U5: undo after a delete into a table that opens a list item, %s', (_name, source, anchor, focus, removed) => {
        const editor = loadWithTableOpeningTail(source);
        const before = editor.getValue();

        select(editor, anchor as End, focus as End);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);

        expect(editor.getValue()).toBe(removed);
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(before);
        expect(holdsTable(editor)).toBe(true);
    });

    it('U6: undo after a native cut (CUT_COMMAND)', async () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], 'last-cell-end');
        lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);

        await vi.waitFor(() => expect(editor.getValue()).toBe('Abov\n\nafter'));
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(DOC);
        expect(rangeOf(editor)).toBe('"Above para"@4 -> tablecell@1');
    });

    // The removal and the insertion are one command, so one undo step: a first Undo that only took the new table
    // back would leave the document without the old one too.
    it.each([
        ['from a paragraph into a cell\'s word', DOC, ['Above para', 4], ['c1', 1], `Abov\n\n${EMPTY_TABLE}\n\nafter`],
        ['from one table into another, leaving the caret at a code block', TABLES_THEN_CODE, ['c1', 1], ['y', 1], `Above para\n\n${EMPTY_TABLE}\n\n\`\`\`\ncode\n\`\`\``],
    ] as const)('U8: undo after insertTable() over a range %s', (_name, source, anchor, focus, inserted) => {
        const editor = load(source);

        select(editor, anchor as End, focus as End);
        editor.insertTable(2, 2);

        expect(editor.getValue()).toBe(inserted);
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(source);
    });

    it('U9: undo after insertImage() over the range (control)', () => {
        const editor = load(DOC);

        select(editor, ['Above para', 4], ['c1', 1]);
        editor.insertImage('/i.png', { alt: 'i' });

        expect(editor.getValue()).toBe('Abov![i](/i.png)\n\nafter');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(DOC);
    });

    it('U7: undo after a native cut (CUT_COMMAND) of a range from a cell into a list\'s last item', async () => {
        const editor = load(TABLE_THEN_LIST);

        select(editor, 'first-cell-start', ['two', 3]);
        lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);

        await vi.waitFor(() => expect(editor.getValue()).toBe('-'));
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(TABLE_THEN_LIST);
    });
});

describe('a range not crossing a table\'s edge is removed as before (G rows)', () => {
    it('G1: a range with both ends outside the table joins the two blocks', () => {
        const editor = deleteRange(DOC, ['Above para', 4], ['after', 2], false);

        expect(editor.getValue()).toBe('Abovter');
    });

    it('G2: a range inside one cell edits that cell', () => {
        const editor = deleteRange(DOC, ['c1', 0], ['c1', 1], false);

        expect(editor.getValue()).toBe(ONE_CELL_EDITED);
    });
});
