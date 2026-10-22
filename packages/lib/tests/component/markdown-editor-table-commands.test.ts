// The WYSIWYG commands of `MarkdownEditor` that left something in the document they should not have, or threw:
// `insertTable()` leaving an empty quote, heading or list item beside the table (T rows), `mergeTableCells()` (M rows),
// and the commands meeting a selection point where no caret can be: on a list, on a `:::` block, or between two
// blocks of a range (P rows). Offline: the modelled DOM, no root element. The focus rows are in
// `markdown-editor-table-commands-mounted.test.ts`.

// Keeps `@lexical/clipboard`'s real module (`@lexical/rich-text` imports it for its paste path) and replaces only
// `copyToClipboard`, which needs a browser clipboard the test DOM does not have, and
// `$getClipboardDataFromSelection`, which needs a browser document: here it gives the selection's text alone.
vi.mock('@lexical/clipboard', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@lexical/clipboard')>()),
    copyToClipboard: vi.fn(async () => true),
    $getClipboardDataFromSelection: vi.fn((selection: BaseSelection) => ({ 'text/plain': selection.getTextContent() })),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createRangeSelection, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isRootNode, $isTextNode, $setSelection,
    $createParagraphNode, $createTextNode, CONTROLLED_TEXT_INSERTION_COMMAND, DELETE_CHARACTER_COMMAND, INSERT_LINE_BREAK_COMMAND,
    INSERT_PARAGRAPH_COMMAND, INSERT_TAB_COMMAND, KEY_ENTER_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { BaseSelection, ElementNode, LexicalEditor, LexicalNode, PointType, RangeSelection, TextNode } from 'lexical';
import { $insertGeneratedNodes } from '@lexical/clipboard';
import { $isListNode } from '@lexical/list';
import { $createTableSelectionFrom, $isTableCellNode, $isTableNode, $isTableRowNode } from '@lexical/table';
import type { TableNode, TableRowNode } from '@lexical/table';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $isMarkdownBlockNode, $isMarkdownColumnNode } from '~/component/editor/markdownBlockNode';
import { $isMarkdownListItemNode } from '~/component/editor/markdownListItemNode';
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
});

/** What `insertTable(2, 2)` saves. */
const TABLE = '|  |  |\n| --- | --- |\n|  |  |';

/** A markdown image, as `insertImage('/i.png', { alt: 'i' })` saves it. */
const IMG = '![i](/i.png)';

/** A selection end: the exact text content of a text node, and an offset in it. */
type TextPoint = [text: string, offset: number];

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
    const isText = $isTextNode(found);

    if (!isText) {
        throw new Error(`no text node holds ${JSON.stringify(text)}`);
    }

    return found;
}

/**
 * The Lexical type of each child of the root.
 *
 * @param editor - The editor.
 * @returns One type per child.
 */
function rootTypes(editor: MarkdownEditor): string[] {
    return lexicalOf(editor).read(() => $getRoot().getChildren().map((child) => child.getType()));
}

/**
 * Describes where the editor's collapsed selection is: `"text"@offset` for a text point, the node's type and
 * offset for an element point, or says there is no caret.
 *
 * @param editor - The editor.
 * @returns The description.
 */
function caretOf(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();
        const isRange = $isRangeSelection(selection);
        const isCaret = isRange && selection.isCollapsed();

        if (!isCaret) {
            return 'no caret';
        }

        const node = selection.anchor.getNode();

        return selection.anchor.type === 'text' ? `${JSON.stringify(node.getTextContent())}@${selection.anchor.offset}` : `${node.getType()}@${selection.anchor.offset}`;
    });
}

/**
 * Asserts the editor's surface reads the same in the viewer as the Markdown it saves, and that the Markdown
 * loaded into a fresh editor saves as itself.
 *
 * @param editor - The editor.
 */
function expectRoundTrips(editor: MarkdownEditor): void {
    const saved = editor.getValue();
    const reloaded = load(saved);

    expect(editorSurfaceModel(editor)).toEqual(viewerModel(saved).blocks);
    expect(reloaded.getValue()).toBe(saved);
    expect(editorSurfaceModel(reloaded)).toEqual(editorSurfaceModel(editor));
}

/**
 * Asserts one undo step gives back the Markdown the document was loaded with. `getValue()` commits the pending
 * update first, as an `UNDO_COMMAND` sent before that commit would undo nothing.
 *
 * @param editor - The editor, after the command.
 * @param loaded - What it saved before the command.
 */
function expectOneUndoStep(editor: MarkdownEditor, loaded: string): void {
    editor.getValue();
    lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

    expect(editor.getValue()).toBe(loaded);
}

/**
 * Puts a caret at a text point.
 *
 * @param editor - The editor.
 * @param point - The text and the offset in it.
 */
function caretIn(editor: MarkdownEditor, point: TextPoint): void {
    lexicalOf(editor).update(() => { $textNode(point[0]).select(point[1], point[1]); }, { discrete: true });
}

describe('insertTable() leaves no empty half of the block it splits (T rows)', () => {
    /** The table as a quote holds it: each line under the quote's marker. */
    const QUOTED_TABLE = TABLE.split('\n').map((line) => (line === '' ? '>' : `> ${line}`)).join('\n');

    /** The table as a list item holds it: each line under the item's content indent. */
    const ITEM_TABLE = TABLE.split('\n').map((line) => `  ${line}`).join('\n');

    /** Row name, the document, the caret, what is saved, the root's children after. */
    const rows: Array<[string, string, TextPoint, string, string[]]> = [
        ['T1: at the end of a quote', '> quote', ['quote', 5], `> quote\n>\n${QUOTED_TABLE}`, ['markdown-quote']],
        ['T2: at the start of a quote', '> quote', ['quote', 0], `${QUOTED_TABLE}\n>\n> quote`, ['markdown-quote']],
        ['T3: inside a quote', '> quote', ['quote', 2], `> qu\n>\n${QUOTED_TABLE}\n>\n> ote`, ['markdown-quote']],
        ['T4: at the end of a heading', '# head', ['head', 4], `# head\n\n${TABLE}`, ['heading', 'table', 'paragraph']],
        ['T5: at the start of a heading', '# head', ['head', 0], `${TABLE}\n\n# head`, ['table', 'heading']],
        ['T6: at the end of a list', '- one\n- two', ['two', 3], `- one\n- two\n\n${TABLE}`, ['list', 'table', 'paragraph']],
        ['T7: at the end of a list\'s first item', '- one\n- two', ['one', 3], `- one\n\n${TABLE}\n\n- two`, ['list', 'table', 'list']],
        ['T8: at the start of a list', '- one\n- two', ['one', 0], `${TABLE}\n\n- one\n- two`, ['table', 'list']],
        ['T9: at the start of a list\'s second item', '- one\n- two', ['two', 0], `- one\n\n${TABLE}\n\n- two`, ['list', 'table', 'list']],
        [
            'T10: at the end of a nested item', '- one\n  - two\n- three', ['two', 3],
            `- one\n  - two\n\n${TABLE}\n\n- three`, ['list', 'table', 'list'],
        ],
        ['T11: at the end of a paragraph', 'para', ['para', 4], `para\n\n${TABLE}`, ['paragraph', 'table', 'paragraph']],
        ['T12: at the start of a paragraph', 'para', ['para', 0], `${TABLE}\n\npara`, ['table', 'paragraph']],
        [
            'T13: at the end of a paragraph with one after it', 'para\n\nafter', ['para', 4],
            `para\n\n${TABLE}\n\nafter`, ['paragraph', 'table', 'paragraph'],
        ],
        [
            'T14: at the end of a quote in a column', '::: columns\n> q\n|||\nB\n:::', ['q', 1],
            `::: columns\n> q\n>\n${QUOTED_TABLE}\n|||\nB\n:::`, ['markdown-block'],
        ],
        // A nested list stays in its item: the table goes into the item that holds it, in front of the nested list or
        // with that list split around it, and never leaves an item with no text holding the rest of it (`- - c`).
        [
            'inside a nested item\'s text: into the outer item, the nested list split around it', '- a\n  - bc', ['bc', 1],
            `- a\n\n  - b\n\n${ITEM_TABLE}\n\n  - c`, ['list'],
        ],
        [
            'at the start of a nested item\'s text: into the outer item', '- a\n  - bc', ['bc', 0],
            `- a\n\n${ITEM_TABLE}\n\n  - bc`, ['list'],
        ],
        [
            'at the end of an item\'s text: in front of the item\'s nested list', '- a\n  - b\n- z', ['a', 1],
            `- a\n\n${ITEM_TABLE}\n\n  - b\n\n- z`, ['list'],
        ],
    ];

    it.each(rows)('%s', (_name, source, caret, saved, types) => {
        const editor = load(source);
        const loaded = editor.getValue();

        caretIn(editor, caret);
        editor.insertTable(2, 2);

        expect(editor.getValue()).toBe(saved);
        expect(rootTypes(editor)).toEqual(types);
        expectRoundTrips(editor);
        expectOneUndoStep(editor, loaded);
    });

    it.each([
        ['T15: an empty document with no selection', '', TABLE, ['table', 'paragraph']],
        ['T16: a heading with no selection', '# head', `# head\n\n${TABLE}`, ['heading', 'table', 'paragraph']],
    ])('%s: the table goes in at the document\'s end', (_name, source, saved, types) => {
        const editor = load(source);
        const loaded = editor.getValue();

        lexicalOf(editor).update(() => { $setSelection(null); }, { discrete: true });
        editor.insertTable(2, 2);

        expect(editor.getValue()).toBe(saved);
        expect(rootTypes(editor)).toEqual(types);
        expectRoundTrips(editor);
        expectOneUndoStep(editor, loaded);
    });

    it.each(rows)('T17, %s: the caret is in the table\'s first cell', (_name, source, caret) => {
        const editor = load(source);

        caretIn(editor, caret);
        editor.insertTable(2, 2);

        const inFirstCell = lexicalOf(editor).read(() => {
            const selection = $getSelection();
            const isRange = $isRangeSelection(selection);

            if (!isRange) {
                return false;
            }

            const cell = selection.anchor.getNode().getParents().find($isTableCellNode) ?? (selection.anchor.getNode() as LexicalNode);
            const row = cell.getParent();

            return $isTableCellNode(cell) && cell.getPreviousSibling() === null && $isTableRowNode(row) && row.getPreviousSibling() === null;
        });

        expect(inFirstCell).toBe(true);
    });
});

describe('mergeTableCells() (M rows)', () => {
    const HEAD = '| a | b |\n| --- | --- |\n';

    /**
     * Selects the cells from `[row, column]` to `[row, column]` of the first table, row 0 the header.
     *
     * @param editor - The editor.
     * @param from - The first cell.
     * @param to - The last cell.
     */
    function selectCells(editor: MarkdownEditor, from: [number, number], to: [number, number]): void {
        lexicalOf(editor).update(() => {
            const table = $dfs().map(({ node }) => node).find($isTableNode) as TableNode;
            const cellAt = ([row, column]: [number, number]): ElementNode => {
                const rowNode = table.getChildAtIndex(row) as TableRowNode;

                return rowNode.getChildAtIndex(column) as ElementNode;
            };

            $setSelection($createTableSelectionFrom(table, cellAt(from) as never, cellAt(to) as never));
        }, { discrete: true });
    }

    /** Row name, body rows, from, to, saved body rows, caret afterwards (`null` when it is only in the cell). */
    const rows: Array<[string, string, [number, number], [number, number], string, string | null]> = [
        ['M1: two cells', '| 1 | 2 |', [1, 0], [1, 1], '| 1\\n\\n2 | << |', '"2"@1'],
        ['M2: an empty first cell leaves no blank line', '|  | 2 |', [1, 0], [1, 1], '| 2 | << |', '"2"@1'],
        ['M3: an empty second cell', '| 1 |  |', [1, 0], [1, 1], '| 1 | << |', '"1"@1'],
        ['M4: two empty cells', '|  |  |', [1, 0], [1, 1], '|  | << |', null],
        ['M5: a column of two rows', '| 1 | 2 |\n| 3 | 4 |', [1, 0], [2, 0], '| 1\\n\\n3 | 2 |\n| ^^ | 4 |', '"3"@1'],
        ['M6: selected backward', '| 1 | 2 |', [1, 1], [1, 0], '| 1\\n\\n2 | << |', '"2"@1'],
        [
            'M7: four cells with an empty first one', '|  | 2 |\n| 3 | 4 |', [1, 0], [2, 1],
            '| 2\\n\\n3\\n\\n4 | << |\n| ^^ | ^^ |', '"4"@1',
        ],
        ['M8: a first cell that starts with the author\'s blank line', '| \\n\\nx | 2 |', [1, 0], [1, 1], '| \\n\\nx\\n\\n2 | << |', '"2"@1'],
        ['M9: bold in the second cell', '| 1 | **2** |', [1, 0], [1, 1], '| 1\\n\\n **2** | << |', '"2"@1'],
    ];

    it.each(rows)('%s', (_name, body, from, to, saved, caret) => {
        const editor = load(HEAD + body);
        const loaded = editor.getValue();

        selectCells(editor, from, to);
        editor.mergeTableCells();

        expect(editor.getValue()).toBe(HEAD + saved);

        if (caret !== null) {
            expect(caretOf(editor)).toBe(caret);
        } else {
            expect(lexicalOf(editor).read(() => $isRangeSelection($getSelection()))).toBe(true);
        }

        expectRoundTrips(editor);
        expectOneUndoStep(editor, loaded);
    });

    it('M10: after a merge the table controls name the merged cell', () => {
        const editor = load(`${HEAD}| 1 | 2 |`);

        selectCells(editor, [1, 0], [1, 1]);
        editor.mergeTableCells();

        const state = editor.getSelectionState();
        const namesAttachedNodes = lexicalOf(editor).read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection) && selection.anchor.getNode().isAttached() && selection.focus.getNode().isAttached();
        });

        expect(state).toMatchObject({ inTable: true, canEditTable: true, canUnmergeCell: true, canMergeCells: false });
        expect(namesAttachedNodes).toBe(true);
    });

    it('M11: unmerging straight after a merge', () => {
        const editor = load(`${HEAD}| 1 | 2 |`);
        const loaded = editor.getValue();

        selectCells(editor, [1, 0], [1, 1]);
        editor.mergeTableCells();
        editor.unmergeTableCell();

        expect(editor.getValue()).toBe(`${HEAD}| 1\\n\\n2 |  |`);

        editor.getValue();
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        editor.getValue();
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(loaded);
    });

    it.each([
        ['both header cells', [0, 0], [0, 1]],
        ['a header cell and a body cell', [0, 0], [1, 0]],
    ] as Array<[string, [number, number], [number, number]]>)('M12: %s decline', (_name, from, to) => {
        const editor = load(`${HEAD}| 1 | 2 |`);
        const loaded = editor.getValue();

        selectCells(editor, from, to);

        const keysBefore = lexicalOf(editor).read(() => $dfs().map(({ node }) => node.getKey()));

        expect(editor.getSelectionState().canMergeCells).toBe(false);

        editor.mergeTableCells();

        const keysAfter = lexicalOf(editor).read(() => $dfs().map(({ node }) => node.getKey()));
        const stillTableSelection = lexicalOf(editor).read(() => $getSelection()?.constructor.name === 'TableSelection');

        expect(editor.getValue()).toBe(loaded);
        expect(keysAfter).toEqual(keysBefore);
        expect(stillTableSelection).toBe(true);
    });
});

describe('commands at a selection point where no caret can be (P rows)', () => {
    const LIST = 'Above\n\n- one\n- two';
    const LIST_AFTER = 'Above\n\n- one\n- two\n\nafter';
    const FENCE = 'Above\n\n::: columns\nA\n|||\nB\n:::';

    /** Where a selection end goes: a container's own offset, or a text point. */
    type Spot = { on: 'root' | 'list' | 'fence' | 'column'; at: number } | TextPoint;

    /**
     * The container a spot names: the root, the first list, the first `:::` block, or that block's second column.
     * Must run inside a read or update.
     *
     * @param on - Which container.
     * @returns The container.
     */
    function $containerOf(on: 'root' | 'list' | 'fence' | 'column'): ElementNode {
        if (on === 'root') {
            return $getRoot();
        }

        const nodes = $dfs().map(({ node }) => node);

        if (on === 'list') {
            return nodes.find($isListNode)!;
        }

        const fence = nodes.find($isMarkdownBlockNode)!;

        return on === 'fence' ? fence : fence.getChildAtIndex(1) as ElementNode;
    }

    /**
     * Sets a selection from `anchor` to `focus`.
     *
     * @param editor - The editor.
     * @param anchor - Where the anchor goes.
     * @param focus - Where the focus goes.
     */
    function select(editor: MarkdownEditor, anchor: Spot, focus: Spot = anchor): void {
        lexicalOf(editor).update(() => {
            const selection = $createRangeSelection();

            for (const [point, spot] of [[selection.anchor, anchor], [selection.focus, focus]] as Array<[PointType, Spot]>) {
                const isTextPoint = Array.isArray(spot);

                if (isTextPoint) {
                    point.set($textNode(spot[0]).getKey(), spot[1], 'text');

                    continue;
                }

                const container = $containerOf(spot.on);

                point.set(container.getKey(), spot.at, 'element');
            }

            $setSelection(selection);
        }, { discrete: true });
    }

    it.each([
        // A caret on a list stands between its items: the image gets an item of its own, as it has since the list
        // item rules (Z36 in `markdown-editor-list-item-edits.test.ts`).
        ['P1: a caret on a list between its items', LIST, { on: 'list', at: 1 }, `Above\n\n- one\n- ${IMG}\n- two`],
        ['P2: a caret at a list\'s end', LIST, { on: 'list', at: 2 }, `Above\n\n- one\n- two\n- ${IMG}`],
        ['P3: a caret between a fence\'s columns', FENCE, { on: 'fence', at: 1 }, `Above\n\n::: columns\nA\n|||\n${IMG}B\n:::`],
    ] as Array<[string, string, Spot, string]>)('%s: insertImage() puts the image where the caret goes', (_name, source, caret, saved) => {
        const editor = load(source);
        const loaded = editor.getValue();

        select(editor, caret);

        expect(() => editor.insertImage('/i.png', { alt: 'i' })).not.toThrow();
        expect(editor.getValue()).toBe(saved);
        expectRoundTrips(editor);
        expectOneUndoStep(editor, loaded);
    });

    it('P4: insertImage() over a range from a list\'s middle to its end', () => {
        const editor = load(LIST);
        const loaded = editor.getValue();

        select(editor, { on: 'list', at: 1 }, ['two', 3]);

        expect(() => editor.insertImage('/i.png', { alt: 'i' })).not.toThrow();
        expect(editor.getValue()).toBe(`Above\n\n- one\n- ${IMG}`);
        expectRoundTrips(editor);
        expectOneUndoStep(editor, loaded);
    });

    /**
     * Dispatches Delete (a forward delete of one character).
     *
     * @param editor - The editor.
     */
    function pressDelete(editor: MarkdownEditor): void {
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);
    }

    it.each([
        ['P5', LIST, { on: 'list', at: 1 }, ['two', 3], 'Above\n\n- one'],
        ['P6', LIST, { on: 'root', at: 0 }, ['two', 3], ''],
        ['P7', '- one\n- two', { on: 'root', at: 0 }, ['two', 3], '-'],
        ['P8', LIST, { on: 'root', at: 1 }, { on: 'list', at: 2 }, 'Above'],
        ['P9', FENCE, { on: 'root', at: 1 }, { on: 'fence', at: 2 }, 'Above\n\n::: {}\n\n:::'],
    ] as Array<[string, string, Spot, Spot, string]>)('%s: Delete over a range leaves no emptied container', (_name, source, from, to, saved) => {
        const editor = load(source);
        const loaded = editor.getValue();

        select(editor, from, to);
        pressDelete(editor);

        expect(editor.getValue()).toBe(saved);
        expectRoundTrips(editor);
        expectOneUndoStep(editor, loaded);
    });

    it('P10: Enter over a range from the root\'s start to the end of the list', () => {
        const editor = load(LIST);
        const loaded = editor.getValue();

        select(editor, { on: 'root', at: 0 }, ['two', 3]);
        lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);

        expect(editor.getValue()).toBe('');
        expect(rootTypes(editor)).toEqual(['paragraph', 'paragraph']);
        expectRoundTrips(editor);
        expectOneUndoStep(editor, loaded);
    });

    // A range that starts just before a list: the paragraph break removes the range and the new paragraph and the
    // caret land at its place, the same as for Delete followed by Enter, whichever end the anchor is at.
    const COLUMN_LIST = '::: columns\nA\n|||\n- one\n- two\n:::';

    /** Row name, document, where the range starts, the text whose end it reaches, and the save after Enter and a typed x. */
    const BEFORE_LIST_ROWS: Array<[string, string, Spot, string, string]> = [
        ['P10c: a list after a paragraph', LIST, { on: 'root', at: 1 }, 'two', 'Above\n\nx'],
        ['P10d: a list with a block after it', LIST_AFTER, { on: 'root', at: 1 }, 'two', 'Above\n\nx\n\nafter'],
        ['P10e: a list in a column', COLUMN_LIST, { on: 'column', at: 0 }, 'two', '::: columns\nA\n|||\nx\n:::'],
        ['P10f: a range ending inside the list', LIST, { on: 'root', at: 1 }, 'one', 'Above\n\nx\n\n- two'],
        ['P10g: a nested list', 'Above\n\n- one\n  - two', { on: 'root', at: 1 }, 'two', 'Above\n\nx'],
        ['P10h: a list that is the root\'s only child', '- one\n- two', { on: 'root', at: 0 }, 'two', 'x'],
    ];

    /**
     * Presses the paragraph-break command a key and the command give.
     *
     * @param editor - The editor.
     * @param isEnter - Whether it is the Enter key rather than the paragraph command.
     */
    function breakParagraph(editor: MarkdownEditor, isEnter: boolean): void {
        if (isEnter) {
            lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);
        } else {
            lexicalOf(editor).dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
        }
    }

    /**
     * Types an x at the caret.
     *
     * @param editor - The editor.
     */
    function typeX(editor: MarkdownEditor): void {
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');
    }

    it.each(BEFORE_LIST_ROWS)('%s: Enter and a paragraph break remove the range, in both directions', (_name, source, start, endText, saved) => {
        for (const isBackward of [false, true]) {
            for (const isEnter of [true, false]) {
                const selectRange = (editor: MarkdownEditor): void => {
                    if (isBackward) {
                        select(editor, [endText, 3], start);
                    } else {
                        select(editor, start, [endText, 3]);
                    }
                };
                const afterDelete = load(source);
                const afterBreak = load(source);
                const untyped = load(source);
                const loaded = untyped.getValue();

                selectRange(afterDelete);
                pressDelete(afterDelete);
                breakParagraph(afterDelete, isEnter);
                typeX(afterDelete);

                selectRange(afterBreak);
                breakParagraph(afterBreak, isEnter);
                typeX(afterBreak);

                selectRange(untyped);
                breakParagraph(untyped, isEnter);

                expect(afterBreak.getValue()).toBe(saved);
                expect(afterDelete.getValue()).toBe(saved);
                expect(caretOf(afterBreak)).toBe(caretOf(afterDelete));
                expect(rootTypes(afterBreak)).toEqual(rootTypes(afterDelete));

                expectRoundTrips(untyped);
                expectOneUndoStep(untyped, loaded);
            }
        }
    });

    // The table-edge guard takes this range, whole table included, and the break comes where it started.
    it.each([[false], [true]])('P10i: Enter over a range from before a list into a table\'s cell, backward %j, removes the table too', (isBackward) => {
        const source = 'Above\n\n- one\n- two\n\n| a |\n| --- |\n| c |';
        const afterBreak = load(source);
        const afterDelete = load(source);

        for (const editor of [afterBreak, afterDelete]) {
            if (isBackward) {
                select(editor, ['a', 1], { on: 'root', at: 1 });
            } else {
                select(editor, { on: 'root', at: 1 }, ['a', 1]);
            }
        }

        pressDelete(afterDelete);
        breakParagraph(afterDelete, true);
        typeX(afterDelete);
        breakParagraph(afterBreak, true);
        typeX(afterBreak);

        expect(afterBreak.getValue()).toBe('Above\n\nx');
        expect(afterBreak.getValue()).toBe(afterDelete.getValue());
        expect(rootTypes(afterBreak)).toEqual(rootTypes(afterDelete));
    });

    it('P10b: Enter over a range from the root\'s start into an HTML raw block does not throw (control)', () => {
        const editor = load('Above\n\n<div>\nraw text\n</div>');

        select(editor, { on: 'root', at: 0 }, ['raw text', 3]);

        expect(() => lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null)).not.toThrow();
        expectRoundTrips(editor);
    });

    it('P11: a line break at a caret on a list does not throw', () => {
        const editor = load(LIST);

        select(editor, { on: 'list', at: 1 });

        expect(() => lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false)).not.toThrow();
    });

    it('P11b: a line break over a range that ends on a list removes the range, as Delete does, and adds no break', () => {
        const editor = load(LIST);
        const deleted = load(LIST);

        select(editor, { on: 'root', at: 0 }, { on: 'list', at: 1 });
        select(deleted, { on: 'root', at: 0 }, { on: 'list', at: 1 });

        expect(() => lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false)).not.toThrow();
        lexicalOf(deleted).dispatchCommand(DELETE_CHARACTER_COMMAND, false);
        expect(editor.getValue()).toBe('- two');
        expect(editor.getValue()).toBe(deleted.getValue());
    });

    it('control: a caret on the root between two blocks is not moved', () => {
        const editor = load(LIST);

        select(editor, { on: 'root', at: 1 });
        editor.insertImage('/i.png', { alt: 'i' });

        expect(editor.getValue()).toBe(`Above\n\n${IMG}\n\n- one\n- two`);
    });

    // The first source is declined before the point moves too; the second is declined only once it has: the
    // caret on the `:::` block between the columns reads as touching no code block until it settles into the
    // second column's.
    it.each([
        ['insertImage', (editor: MarkdownEditor) => editor.insertImage('/i.png', { alt: 'i' })],
        ['insertTable', (editor: MarkdownEditor) => editor.insertTable(2, 2)],
        ['insertHorizontalRule', (editor: MarkdownEditor) => editor.insertHorizontalRule()],
    ])('P13: %s declines once the point settles into a code block', (_name, command) => {
        const cases: Array<[string, Spot]> = [
            ['::: columns\n```\ncode\n```\n|||\nB\n:::', { on: 'fence', at: 0 }],
            ['::: columns\nA\n|||\n```\ncode\n```\n:::', { on: 'fence', at: 1 }],
        ];

        for (const [source, caret] of cases) {
            const editor = load(source);
            const loaded = editor.getValue();

            select(editor, caret);
            command(editor);

            expect(editor.getValue()).toBe(loaded);
        }
    });

    /**
     * Describes both ends of the editor's selection: each as its node's type and offset, a text point with its text.
     *
     * @param editor - The editor.
     * @returns The description.
     */
    function selectionOf(editor: MarkdownEditor): string {
        return lexicalOf(editor).read(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return 'no range';
            }

            return [selection.anchor, selection.focus].map((point) => {
                const node = point.getNode();
                const name = point.type === 'text' ? JSON.stringify(node.getTextContent()) : node.getType();

                return `${name}@${point.offset}`;
            }).join(' .. ');
        });
    }

    // Settling moves the editor's own selection before the command reads where it would insert; a command that then
    // declines puts the selection back, as an edit that changes nothing leaves it.
    it.each<[string, string, (editor: MarkdownEditor) => void, Spot, Spot]>([
        ['insertImage', '::: columns\nA\n|||\n```\ncode\n```\n:::', (editor) => editor.insertImage('/i.png', { alt: 'i' }), { on: 'fence', at: 1 }, { on: 'fence', at: 1 }],
        ['insertTable', '::: columns\nA\n|||\n```\ncode\n```\n:::', (editor) => editor.insertTable(2, 2), { on: 'fence', at: 1 }, { on: 'fence', at: 1 }],
        ['insertHorizontalRule', '::: columns\nA\n|||\n```\ncode\n```\n:::', (editor) => editor.insertHorizontalRule(), { on: 'fence', at: 1 }, { on: 'fence', at: 1 }],
        ['insertTable', '::: {align=center}\n| a | b |\n| - | - |\n| c | d |\n:::', (editor) => editor.insertTable(2, 2), { on: 'fence', at: 0 }, { on: 'fence', at: 0 }],
        ['insertTable', '::: {align=center}\n| a | b |\n| - | - |\n| c | d |\n:::', (editor) => editor.insertTable(2, 2), { on: 'fence', at: 1 }, { on: 'fence', at: 1 }],
        ['insertHorizontalRule', '::: {align=center}\n| a | b |\n| - | - |\n| c | d |\n:::', (editor) => editor.insertHorizontalRule(), { on: 'fence', at: 0 }, { on: 'fence', at: 0 }],
        ['insertTable', 'p\n\n| a | b |\n| - | - |\n\nq', (editor) => editor.insertTable(2, 2), { on: 'root', at: 1 }, { on: 'root', at: 2 }],
        // The rule removed the range first, the text of the cells it settled into, and then declined.
        ['insertHorizontalRule', 'p\n\n| a | b |\n| - | - |\n\nq', (editor) => editor.insertHorizontalRule(), { on: 'root', at: 1 }, { on: 'root', at: 2 }],
        // The same removal took the node the selection ended in, and the update threw.
        ['insertHorizontalRule', 'p\n\n| a |\n| - |\n| b |\n\nq', (editor) => editor.insertHorizontalRule(), { on: 'root', at: 1 }, ['b', 1]],
    ])('%s declined once the point settles leaves the selection as it was, in %j', (_name, source, command, anchor, focus) => {
        const editor = load(source);
        const loaded = editor.getValue();

        select(editor, anchor, focus);

        const before = selectionOf(editor);

        command(editor);

        expect(editor.getValue()).toBe(loaded);
        expect(selectionOf(editor)).toBe(before);
    });

    /**
     * Inserts what a paste or drop of copied content inserts: a word, or a paragraph holding it.
     *
     * @param editor - The editor.
     * @param asBlock - Whether the word comes in a paragraph.
     */
    function insertCopied(editor: MarkdownEditor, asBlock: boolean): void {
        lexicalOf(editor).update(() => {
            const word = $createTextNode('zz');

            $insertGeneratedNodes(lexicalOf(editor), [asBlock ? $createParagraphNode().append(word) : word], $getSelection()!);
        }, { discrete: true });
    }

    describe('commands over a range that starts before a list, or whose end or start settles into a raw block (Q, E and S rows)', () => {
        const TWO = '- one\n- two';
        const BEFORE_LIST = { on: 'root', at: 0 } as Spot;
        const ABOVE_LIST = { on: 'root', at: 1 } as Spot;
        const tab = (editor: MarkdownEditor): void => { lexicalOf(editor).dispatchCommand(INSERT_TAB_COMMAND, undefined); };
        const enter = (editor: MarkdownEditor): void => { lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null); };
        const lineBreak = (editor: MarkdownEditor): void => { lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false); };
        const typeX = (editor: MarkdownEditor): void => { lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x'); };
        const copiedWord = (editor: MarkdownEditor): void => { insertCopied(editor, false); };
        const copiedParagraph = (editor: MarkdownEditor): void => { insertCopied(editor, true); };

        it.each([
            ['Q1', TWO, BEFORE_LIST, ['two', 3], tab, '-'],
            ['Q2', TWO, BEFORE_LIST, { on: 'root', at: 1 }, tab, '-'],
            ['Q3', '- one\n  - two\n- three', BEFORE_LIST, ['three', 5], tab, '-'],
            ['Q4', 'Above\n\n- one\n- two', ABOVE_LIST, ['two', 3], tab, 'Above'],
            ['Q5', TWO, BEFORE_LIST, ['two', 3], copiedWord, '- zz'],
            ['Q6', TWO, BEFORE_LIST, ['two', 3], copiedParagraph, '- zz'],
            ['Q7', 'Above\n\n- one\n- two', ABOVE_LIST, ['two', 3], copiedParagraph, 'Above\n\nzz'],
            ['Q8', TWO, BEFORE_LIST, ['two', 3], typeX, '- x'],
            ['E1', TWO, { on: 'list', at: 0 }, ['two', 3], enter, ''],
            ['E2', 'Above\n\n- one\n- two', { on: 'list', at: 0 }, ['two', 3], enter, 'Above'],
            ['E3', 'Above\n\n- one\n- two', { on: 'list', at: 0 }, ['one', 3], enter, 'Above\n\n-\n- two'],
            // Enter in a raw block reads the range before the paragraph command's guard settles it: a range whose ends are
            // points where no caret can be reaches a raw block only once they are settled (E4: the document just after a raw
            // block to a `:::` block; E5: the end of a column holding a raw block to a paragraph outside the column).
            ['E4', '<div>\nraw text\n</div>\n\n::: columns\nca\n|||\ncb\n:::\n\nafter', { on: 'root', at: 1 }, { on: 'fence', at: 0 }, enter, '<div>\nraw text\n</div>\nca\n\n::: {}\ncb\n:::\n\nafter'],
            ['E5', 'before\n\n::: columns\nca\n|||\n<div>\nraw\n</div>\n:::\n\nafter', { on: 'column', at: 1 }, ['after', 0], enter, 'before\n\n::: columns\nca\n|||\n<div>\nraw\n</div>\nafter\n:::'],
            ['S2', TWO, BEFORE_LIST, ['two', 0], lineBreak, '- \\\n  two'],
            ['S3', 'Above\n\n- one\n- two', ABOVE_LIST, ['two', 1], lineBreak, 'Above\n\n- wo'],
        ] as Array<[string, string, Spot, Spot, (editor: MarkdownEditor) => void, string]>)('%s: %j, in both directions, saves what Delete then the command does', (_row, source, from, to, command, saved) => {
            const placements: string[] = [];

            for (const [anchor, focus] of [[from, to], [to, from]]) {
                const editor = load(source);
                const loaded = editor.getValue();

                select(editor, anchor, focus);

                expect(() => command(editor)).not.toThrow();
                expect(editor.getValue()).toBe(saved);
                expectRoundTrips(editor);
                placements.push(`${caretOf(editor)} | ${rootTypes(editor).join(',')}`);
                expectOneUndoStep(editor, loaded);

                const deleted = load(source);

                select(deleted, anchor, focus);
                pressDelete(deleted);
                command(deleted);

                // Delete's own update settles the caret before the command runs; the save, caret and blocks are the same.
                expect(deleted.getValue()).toBe(saved);
                expect(placements[placements.length - 1]).toBe(`${caretOf(deleted)} | ${rootTypes(deleted).join(',')}`);
            }
        });

        it('Q9: paste() over a range from just before a list, in both directions, saves what Delete then paste() does', async () => {
            vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('zz');

            for (const [anchor, focus] of [[BEFORE_LIST, ['two', 3]], [['two', 3], BEFORE_LIST]] as Array<[Spot, Spot]>) {
                const editor = load(TWO);
                const loaded = editor.getValue();

                select(editor, anchor, focus);
                await editor.paste();

                expect(editor.getValue()).toBe('- zz');
                expectRoundTrips(editor);

                const placement = `${caretOf(editor)} | ${rootTypes(editor).join(',')}`;

                expectOneUndoStep(editor, loaded);

                const deleted = load(TWO);

                select(deleted, anchor, focus);
                pressDelete(deleted);
                await deleted.paste();

                expect(deleted.getValue()).toBe('- zz');
                expect(placement).toBe(`${caretOf(deleted)} | ${rootTypes(deleted).join(',')}`);
            }
        });

        it('S1: a line break over a range from just before a list to the end of its text removes the range, as Delete does, and adds no break', () => {
            const editor = load('Above\n\n- one\n- two');
            const deleted = load('Above\n\n- one\n- two');

            select(editor, ABOVE_LIST, ['two', 3]);
            select(deleted, ABOVE_LIST, ['two', 3]);

            expect(() => lineBreak(editor)).not.toThrow();
            lexicalOf(deleted).dispatchCommand(DELETE_CHARACTER_COMMAND, false);
            expect(editor.getValue()).toBe('Above');
            expect(editor.getValue()).toBe(deleted.getValue());
            expect(lexicalOf(editor).read(() => ($getSelection() as RangeSelection).isCollapsed())).toBe(true);
        });
    });

    describe('P12: the matrix', () => {
        // Vitest's default per-test timeout is 5s. A document's sweep loads a few thousand editors, which takes
        // about a second for the largest document alone and several times that with the whole suite beside it.
        const MATRIX_TIMEOUT_MS = 120_000;

        // The matrix pairs each container point with every fourth later one: all pairs would load some ten times as
        // many editors for no shape the sampled ones do not already reach.
        const RANGE_PARTNER_STRIDE = 4;

        const DOCUMENTS = [
            LIST,
            LIST_AFTER,
            FENCE,
            '::: {align=center}\nA\n:::\n\nafter',
            COLUMN_LIST,
            'Above\n\n| a | b |\n| --- | --- |\n| c | d |\n\nafter',
            '- one\n  - two\n- three',
            '- one\n- two',
            '> quote\n\n```\ncode\n```\n\n# head',
        ];

        /** One container point: the container by its place in the document's depth-first order, and an offset. */
        interface ContainerPoint { index: number; offset: number }

        /**
         * Whether a node can hold a point where no caret can be: the root, a column, a list, a `:::` block, or a
         * list item whose first child is a block.
         *
         * @param node - The node.
         * @returns `true` for such a container.
         */
        function holdsContainerPoints(node: LexicalNode): node is ElementNode {
            const isContainer = $isRootNode(node) || $isListNode(node) || $isMarkdownBlockNode(node) || $isMarkdownColumnNode(node);

            if (isContainer) {
                return true;
            }

            const first = $isMarkdownListItemNode(node) ? node.getFirstChild() : null;

            return $isElementNode(first) && !first.isInline();
        }

        /**
         * Every container point of a document, loaded fresh.
         *
         * @param source - The Markdown.
         * @returns Its container points.
         */
        function containerPointsOf(source: string): ContainerPoint[] {
            const editor = load(source);

            return lexicalOf(editor).read(() => {
                const containers = $dfs().map(({ node }) => node).filter(holdsContainerPoints);

                return containers.flatMap((container, index) =>
                    Array.from({ length: container.getChildrenSize() + 1 }, (_unused, offset) => ({ index, offset })));
            });
        }

        /**
         * Sets the selection of a freshly loaded editor to container points.
         *
         * @param editor - The editor.
         * @param anchor - The anchor.
         * @param focus - The focus.
         */
        function selectContainerPoints(editor: MarkdownEditor, anchor: ContainerPoint, focus: ContainerPoint): void {
            lexicalOf(editor).update(() => {
                const containers = $dfs().map(({ node }) => node).filter(holdsContainerPoints);
                const selection = $createRangeSelection();

                selection.anchor.set(containers[anchor.index].getKey(), anchor.offset, 'element');
                selection.focus.set(containers[focus.index].getKey(), focus.offset, 'element');
                $setSelection(selection);
            }, { discrete: true });
        }

        /**
         * Asserts no list, `:::` block, column, table or row is empty, and the root holds a block.
         *
         * @param editor - The editor.
         * @param context - What the failure message says.
         */
        function expectNothingEmptied(editor: MarkdownEditor, context: string): void {
            const emptied = lexicalOf(editor).read(() => {
                const nodes = $dfs().map(({ node }) => node);
                const emptyContainers = nodes.filter((node) =>
                    ($isListNode(node) || $isMarkdownBlockNode(node) || $isMarkdownColumnNode(node) || $isTableNode(node) || $isTableRowNode(node))
                    && node.getChildrenSize() === 0);

                return emptyContainers.length + ($getRoot().getChildrenSize() === 0 ? 1 : 0);
            });

            expect(emptied, context).toBe(0);
        }

        /** What a command throws where the modelled DOM has no window to step a caret in. */
        const NO_BROWSER_SELECTION = 'window object not found';

        /**
         * Runs `run`, catching what it throws.
         *
         * @param run - The command.
         * @returns `null` when it did not throw, else the thrown message.
         */
        function attempt(run: () => void): string | null {
            try {
                run();
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }

            return null;
        }

        /** The commands, by name; the last two are for ranges only. */
        const COMMANDS: Array<[string, (editor: MarkdownEditor) => void, boolean]> = [
            ['insertImage', (editor) => { editor.insertImage('/i.png', { alt: 'i' }); }, false],
            ['insertTable', (editor) => { editor.insertTable(2, 2); }, false],
            ['insertHorizontalRule', (editor) => { editor.insertHorizontalRule(); }, false],
            ['cut', (editor) => { editor.cut(); }, false],
            ['Enter', (editor) => { lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null); }, false],
            ['INSERT_PARAGRAPH_COMMAND', (editor) => { lexicalOf(editor).dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined); }, false],
            ['INSERT_LINE_BREAK_COMMAND', (editor) => { lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false); }, false],
            ['typing x', (editor) => { lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x'); }, false],
            ['Tab', (editor) => { lexicalOf(editor).dispatchCommand(INSERT_TAB_COMMAND, undefined); }, false],
            ['inserting a copied word', (editor) => { insertCopied(editor, false); }, false],
            ['inserting a copied paragraph', (editor) => { insertCopied(editor, true); }, false],
            ['Delete', (editor) => { lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false); }, true],
            ['Backspace', (editor) => { lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true); }, true],
        ];

        /**
         * Runs one command on a fresh editor with the selection set, and checks the result.
         *
         * @param source - The document.
         * @param anchor - The selection's anchor.
         * @param focus - The selection's focus.
         * @param run - The command.
         * @returns What went wrong, or `null` when nothing did.
         */
        function runAndCheck(source: string, anchor: ContainerPoint, focus: ContainerPoint, run: (editor: MarkdownEditor) => void): string | null {
            const editor = load(source);

            try {
                selectContainerPoints(editor, anchor, focus);

                const thrown = attempt(() => run(editor));

                // A range that settles into a caret is stepped by the browser's `Selection.modify`, which the
                // modelled DOM does not have: the run is not one this harness can make.
                if (thrown === NO_BROWSER_SELECTION) {
                    return null;
                }

                if (thrown !== null) {
                    return `threw ${thrown}`;
                }

                return attempt(() => {
                    expectNothingEmptied(editor, "an emptied container is left");
                    expectRoundTrips(editor);
                });
            } finally {
                // Each run builds a Lexical editor; without this the worker runs out of memory.
                editor.dispose();
            }
        }

        it.each(DOCUMENTS)('every container point as a caret, and a sample of ranges: %j', (source) => {
            const points = containerPointsOf(source);
            const ranges: Array<[ContainerPoint, ContainerPoint]> = [];
            const failures: string[] = [];

            for (let i = 0; i < points.length; i += 1) {
                for (let j = i + 1; j < points.length; j += RANGE_PARTNER_STRIDE) {
                    ranges.push(i % 2 === 0 ? [points[i], points[j]] : [points[j], points[i]]);
                }
            }

            for (const [name, run, rangesOnly] of COMMANDS) {
                const selections = ranges.map(([anchor, focus]) => [anchor, focus]);

                if (!rangesOnly) {
                    selections.push(...points.map((point) => [point, point]));
                }

                for (const [anchor, focus] of selections) {
                    const failure = runAndCheck(source, anchor, focus, run);

                    if (failure !== null) {
                        failures.push(`${name} from ${JSON.stringify(anchor)} to ${JSON.stringify(focus)}: ${failure}`);
                    }
                }
            }

            expect(failures).toEqual([]);
        }, MATRIX_TIMEOUT_MS);

        /**
         * Runs a command over a range between a container point and the end of a text, and says whether the text
         * the range covered is gone from the save.
         *
         * @param source - The document.
         * @param point - The container point.
         * @param textIndex - Which text node, in depth-first order, the range ends at the end of.
         * @param isBackward - Whether the anchor is the text end rather than the container point.
         * @param run - The command.
         * @returns What went wrong, or `null` when nothing did or the run cannot be made.
         */
        function runAndCheckRemoval(
            source: string, point: ContainerPoint, textIndex: number, isBackward: boolean, run: (editor: MarkdownEditor) => void,
        ): string | null {
            const editor = load(source);

            try {
                let covered = '';
                let startsAtPoint = true;

                lexicalOf(editor).update(() => {
                    const containers = $dfs().map(({ node }) => node).filter(holdsContainerPoints);
                    const text = $dfs().map(({ node }) => node).filter($isTextNode)[textIndex];
                    const selection = $createRangeSelection();
                    const [at, end] = isBackward ? [selection.focus, selection.anchor] : [selection.anchor, selection.focus];

                    at.set(containers[point.index].getKey(), point.offset, 'element');
                    end.set(text.getKey(), text.getTextContentSize(), 'text');
                    $setSelection(selection);
                    covered = selection.getTextContent();
                    startsAtPoint = !(isBackward ? !selection.isBackward() : selection.isBackward());
                }, { discrete: true });

                // Only a range that begins at the container point and covers whole texts to its end is checked.
                if (!startsAtPoint) {
                    return null;
                }

                const thrown = attempt(() => run(editor));

                if (thrown === NO_BROWSER_SELECTION) {
                    return null;
                }

                if (thrown !== null) {
                    return `threw ${thrown}`;
                }

                const saved = editor.getValue();
                const left = (covered.match(/[A-Za-z]+/g) ?? []).filter((word) => new RegExp(`\\b${word}\\b`).test(saved));

                if (left.length > 0) {
                    return `the range's text is still saved: ${left.join(', ')}`;
                }

                return attempt(() => {
                    expectNothingEmptied(editor, 'an emptied container is left');
                    expectRoundTrips(editor);
                });
            } finally {
                editor.dispose();
            }
        }

        /**
         * A paragraph break, then a typed x.
         *
         * @param editor - The editor.
         */
        function breakThenType(editor: MarkdownEditor): void {
            lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);
            lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');
        }

        /**
         * Where a paragraph break and a typed x land over a range from a container point to the end of a text: the
         * save and the caret, with Delete pressed over the range first or not.
         *
         * @param source - The document.
         * @param point - The container point.
         * @param textIndex - Which text node, in depth-first order, the range ends at the end of.
         * @param isBackward - Whether the anchor is the text end rather than the container point.
         * @param deletesFirst - Whether Delete removes the range before the command.
         * @param act - The command run over the range. A paragraph break, then a typed x, when omitted.
         * @param onlyBeforeList - Whether only a range that starts just before a list is compared.
         * @returns The save, the caret and the root's block types, or `null` when the run cannot be made.
         */
        function placementOf(source: string, point: ContainerPoint, textIndex: number, isBackward: boolean, deletesFirst: boolean, act: (editor: MarkdownEditor) => void = breakThenType, onlyBeforeList = false): string | null {
            const editor = load(source);
            let startsAtPoint = true;
            let comparable = true;

            try {
                lexicalOf(editor).update(() => {
                    const containers = $dfs().map(({ node }) => node).filter(holdsContainerPoints);
                    const text = $dfs().map(({ node }) => node).filter($isTextNode)[textIndex];
                    const selection = $createRangeSelection();
                    const [at, end] = isBackward ? [selection.focus, selection.anchor] : [selection.anchor, selection.focus];

                    at.set(containers[point.index].getKey(), point.offset, 'element');
                    end.set(text.getKey(), text.getTextContentSize(), 'text');
                    $setSelection(selection);
                    startsAtPoint = !(isBackward ? !selection.isBackward() : selection.isBackward());

                    comparable = $isRootNode(containers[point.index]) || $isMarkdownColumnNode(containers[point.index]);

                    if (comparable && onlyBeforeList) {
                        const container = containers[point.index] as ElementNode;

                        comparable = $isListNode(container.getChildAtIndex(point.offset));
                    }
                }, { discrete: true });

                // Only a range that begins at a point on the root or a column is compared.
                if (!startsAtPoint || !comparable) {
                    return null;
                }

                const thrown = attempt(() => {
                    if (deletesFirst) {
                        pressDelete(editor);
                    }

                    act(editor);
                });

                if (thrown === NO_BROWSER_SELECTION) {
                    return null;
                }

                // A throw is a result like any other: it differs from one that did not throw.
                return thrown === null ? `${editor.getValue()} | ${caretOf(editor)} | ${rootTypes(editor).join(',')}` : `threw ${thrown}`;
            } finally {
                editor.dispose();
            }
        }

        it.each(DOCUMENTS)('a paragraph break over a range from a container point to the end of a text lands where Delete then the break does: %j', (source) => {
            const points = containerPointsOf(source);
            const counted = load(source);
            const textCount = lexicalOf(counted).read(() => $dfs().map(({ node }) => node).filter($isTextNode).length);
            const failures: string[] = [];

            counted.dispose();

            for (const point of points) {
                for (let textIndex = 0; textIndex < textCount; textIndex += 1) {
                    for (const isBackward of [false, true]) {
                        const broken = placementOf(source, point, textIndex, isBackward, false);
                        const afterDelete = placementOf(source, point, textIndex, isBackward, true);

                        if (broken !== null && afterDelete !== null && broken !== afterDelete) {
                            failures.push(`from ${JSON.stringify(point)} to text ${textIndex}${isBackward ? ' (backward)' : ''}: ${JSON.stringify(broken)} but Delete first gives ${JSON.stringify(afterDelete)}`);
                        }
                    }
                }
            }

            expect(failures).toEqual([]);
        }, MATRIX_TIMEOUT_MS);

        /** The inserts a range from just before a list must not throw or differ from Delete on. */
        const INSERTS = COMMANDS.filter(([name]) => ['Tab', 'inserting a copied word', 'inserting a copied paragraph'].includes(name));

        it.each(DOCUMENTS)('an insert over a range from just before a list to the end of a text lands where Delete then the insert does: %j', (source) => {
            const points = containerPointsOf(source);
            const counted = load(source);
            const textCount = lexicalOf(counted).read(() => $dfs().map(({ node }) => node).filter($isTextNode).length);
            const failures: string[] = [];

            counted.dispose();

            for (const [name, run] of INSERTS) {
                for (const point of points) {
                    for (let textIndex = 0; textIndex < textCount; textIndex += 1) {
                        for (const isBackward of [false, true]) {
                            const inserted = placementOf(source, point, textIndex, isBackward, false, run, true);
                            const afterDelete = placementOf(source, point, textIndex, isBackward, true, run, true);

                            if (inserted !== null && afterDelete !== null && inserted !== afterDelete) {
                                failures.push(`${name} from ${JSON.stringify(point)} to text ${textIndex}${isBackward ? ' (backward)' : ''}: ${JSON.stringify(inserted)} but Delete first gives ${JSON.stringify(afterDelete)}`);
                            }
                        }
                    }
                }
            }

            expect(failures).toEqual([]);
        }, MATRIX_TIMEOUT_MS);

        it.each(DOCUMENTS)('a range from a container point to the end of a text is removed, in both directions: %j', (source) => {
            const points = containerPointsOf(source);
            const counted = load(source);
            const textCount = lexicalOf(counted).read(() => $dfs().map(({ node }) => node).filter($isTextNode).length);

            counted.dispose();
            const failures: string[] = [];

            for (const [name, run, rangesOnly] of COMMANDS) {
                // Collapsed Delete and Backspace are left out offline, and these ranges are never collapsed.
                const removes = rangesOnly || ['Enter', 'INSERT_PARAGRAPH_COMMAND', 'typing x', 'cut', 'Tab', 'inserting a copied word', 'inserting a copied paragraph'].includes(name);

                if (!removes) {
                    continue;
                }

                for (const point of points) {
                    for (let textIndex = 0; textIndex < textCount; textIndex += 1) {
                        for (const isBackward of [false, true]) {
                            const failure = runAndCheckRemoval(source, point, textIndex, isBackward, run);

                            if (failure !== null) {
                                failures.push(`${name} from ${JSON.stringify(point)} to text ${textIndex}${isBackward ? ' (backward)' : ''}: ${failure}`);
                            }
                        }
                    }
                }
            }

            expect(failures).toEqual([]);
        }, MATRIX_TIMEOUT_MS);
    });
});
