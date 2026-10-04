// @vitest-environment jsdom
//
// Two things the WYSIWYG context menu meets only once Lexical has a real root
// element, which the modelled test DOM never provides: the browser's own
// selection, which a right-click moves before Lexical follows it, and
// `@lexical/table`'s selection observer, registered when the view mounts. The
// observer brings a format handler of its own, which would format the cells of
// a table selection unchecked; the editor's handler, registered when the
// editor is built, runs ahead of it and formats the cells itself, so the last
// test here pins that this stays so with the observer present. This file keeps
// the `@vitest-environment jsdom` pragma, gives the editor a real root element
// and registers the observer itself, as the editor's WYSIWYG mount does, and
// must not call installTestDOM — the same arrangement as
// `markdown-editor-table-edge-mounted.test.ts`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, $isTextNode, $setSelection } from 'lexical';
import type { LexicalEditor, TextNode } from 'lexical';
import { $createTableSelectionFrom, $isTableSelection, registerTableSelectionObserver } from '@lexical/table';
import type { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import type { MenuItemConfig } from '~/component/container/MenuItem';
import { DOM } from '~/core/DOM';

/** What a test registered on a Lexical editor, unregistered after it. */
const unregister: (() => void)[] = [];

afterEach(() => {
    unregister.splice(0).forEach((remove) => remove());
    DOM.reset();
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

const PROSE_AND_CODE = 'plain **bold** end\n\n```\ncode\n```';
const TABLE_AND_PROSE = '| a | b |\n| - | - |\n| c | d |\n\nafter';

/** Reaches the private Lexical editor. */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/**
 * Loads `source` into a fresh editor, gives its Lexical editor a real root
 * element under the document body and registers `@lexical/table`'s selection
 * observer on it, as the editor's WYSIWYG mount does.
 */
function mounted(source: string): MarkdownEditor {
    const editor = new MarkdownEditor();
    const root = document.createElement('div');

    editor.setValue(source);
    root.contentEditable = 'true';
    document.body.append(root);
    lexicalOf(editor).setRootElement(root);
    unregister.push(registerTableSelectionObserver(lexicalOf(editor), true));

    return editor;
}

/** The first text node showing exactly `text`. Call inside a Lexical read or update. */
function $textNodeShowing(text: string): TextNode {
    const node = $getRoot().getAllTextNodes().find((candidate) => candidate.getTextContent() === text);

    if (node === undefined) {
        throw new Error(`text node "${text}" not found`);
    }

    return node;
}

/** Places the editor's caret at `offset` in the text node showing `text`. */
function caretIn(editor: MarkdownEditor, text: string, offset: number): void {
    lexicalOf(editor).update(() => { $textNodeShowing(text).select(offset, offset); }, { discrete: true });
}

/** The element Lexical rendered for the text node showing `text`. */
function elementOf(editor: MarkdownEditor, text: string): HTMLElement {
    const key = lexicalOf(editor).read(() => $textNodeShowing(text).getKey());

    return lexicalOf(editor).getElementByKey(key) as HTMLElement;
}

/**
 * Does what a right-click does on Linux before the editor hears of it: moves
 * the browser's caret to `offset` in the text showing `text`, then dispatches
 * a real `contextmenu` event on that text's element, which the editor's
 * handler receives through a listener on the root. Returns the items the menu
 * is shown with.
 *
 * The handler must run inside the dispatch. Lexical starts every update by
 * deciding whether to read the browser's selection, from the type of
 * `window.event`: with none (a handler called directly) it reads it and so
 * follows the caret by itself, while under a `contextmenu` event — what a
 * browser has — it keeps its previous selection, and only the editor's own
 * adoption moves it. Calling the handler outside a dispatch would pass
 * without that adoption.
 */
function rightClickIn(editor: MarkdownEditor, text: string, offset: number): MenuItemConfig[] {
    const element = elementOf(editor, text);
    const domText = element.firstChild as Text;
    const root = lexicalOf(editor).getRootElement() as HTMLElement;
    const menu = (editor as unknown as { _contextMenu: { show(x: number, y: number, items: MenuItemConfig[]): unknown } })._contextMenu;
    const show = vi.spyOn(menu, 'show').mockImplementation(() => menu);
    const handler = editor as unknown as { handleWysiwygContextMenu(event: MouseEvent): void };
    const seenEventTypes: Array<string | undefined> = [];
    const listener = (event: MouseEvent): void => {
        seenEventTypes.push(window.event?.type);
        handler.handleWysiwygContextMenu(event);
    };

    window.getSelection()?.setBaseAndExtent(domText, offset, domText, offset);
    root.addEventListener('contextmenu', listener);
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 50 }));
    root.removeEventListener('contextmenu', listener);

    // The premise of every test here: the handler ran under a contextmenu event.
    expect(seenEventTypes).toEqual(['contextmenu']);

    return show.mock.calls[0][2];
}

/** Where the editor's caret is: the text its node shows and the offset in it, or `null` without a range selection. */
function caretOf(editor: MarkdownEditor): [string, number] | null {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();

        return $isRangeSelection(selection) ? [selection.anchor.getNode().getTextContent(), selection.anchor.offset] : null;
    });
}

/** Whether the menu offers Text style and Insert link…. */
function offersStyleAndLink(items: MenuItemConfig[]): boolean[] {
    return ['Text style', 'Insert link…'].map((text) => items.find((item) => item.text === text)?.enabled !== false);
}

/** Selects the two cells of the table's last row, as a drag across them does. */
function selectLastRowCells(editor: MarkdownEditor): void {
    lexicalOf(editor).update(() => {
        const table = $getRoot().getFirstChild() as TableNode;
        const [first, second] = (table.getLastChild() as TableRowNode).getChildren() as TableCellNode[];

        $setSelection($createTableSelectionFrom(table, first, second));
    }, { discrete: true });
}

describe('MarkdownEditor context menu, mounted: the browser\'s selection', () => {
    it('caret in prose, the browser\'s caret moved into a code block: the editor follows it and the menu dims what the block declines', () => {
        const editor = mounted(PROSE_AND_CODE);
        caretIn(editor, 'plain ', 2);

        const items = rightClickIn(editor, 'code', 2);

        expect(caretOf(editor)).toEqual(['code', 2]);
        expect(offersStyleAndLink(items)).toEqual([false, false]);
    });

    it('caret in a code block, the browser\'s caret moved onto a prose word: the editor follows it and the menu offers what prose accepts', () => {
        const editor = mounted(PROSE_AND_CODE);
        caretIn(editor, 'code', 2);

        const items = rightClickIn(editor, 'plain ', 2);

        expect(caretOf(editor)).toEqual(['plain ', 2]);
        expect(offersStyleAndLink(items)).toEqual([true, true]);
    });

    it('a caret adopted inside a bold word carries bold, so a letter typed there continues the word', () => {
        // Read, not updated: an update made outside an event would have Lexical read the browser's
        // selection again and give it the node's format by itself, hiding what the adoption left.
        const editor = mounted(PROSE_AND_CODE);
        caretIn(editor, 'plain ', 2);

        rightClickIn(editor, 'bold', 2);

        const carriesBold = lexicalOf(editor).read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection) && selection.hasFormat('bold');
        });

        expect(caretOf(editor)).toEqual(['bold', 2]);
        expect(carriesBold).toBe(true);
    });

    it('without the editor\'s own read of the browser\'s selection the caret stays where it was', () => {
        // The control for the tests above: under a contextmenu event Lexical does not follow the
        // browser's caret by itself, so what moved it there was the read through the seam.
        const editor = mounted(PROSE_AND_CODE);
        caretIn(editor, 'plain ', 2);
        vi.spyOn(DOM.source, 'readDocumentSelection').mockReturnValue(null);

        const items = rightClickIn(editor, 'code', 2);

        expect(caretOf(editor)).toEqual(['plain ', 2]);
        expect(offersStyleAndLink(items)).toEqual([true, true]);
    });

    it('a right-click on prose leaves a held table selection in place, as Lexical itself does, and gives the menu for its cells', () => {
        // The commands go on acting on the cells, so the menu is the table-cell one: a Table submenu,
        // and no Block style, which the text menu a click on prose otherwise gets would offer.
        const editor = mounted(TABLE_AND_PROSE);
        selectLastRowCells(editor);

        const items = rightClickIn(editor, 'after', 2);

        expect(lexicalOf(editor).read(() => $isTableSelection($getSelection()))).toBe(true);
        expect(offersStyleAndLink(items)).toEqual([false, false]);
        expect(items.some((item) => item.text === 'Table')).toBe(true);
        expect(items.some((item) => item.text === 'Block style')).toBe(false);
    });
});

describe('MarkdownEditor context menu, mounted: a table selection', () => {
    it('reports the format toggles as available, and a toggle formats the selected cells', async () => {
        const editor = mounted(TABLE_AND_PROSE);
        selectLastRowCells(editor);

        expect(editor.getSelectionState().canFormat).toBe(true);

        editor.toggleBold();
        await Promise.resolve();

        const bold = lexicalOf(editor).read(() => ['c', 'd'].map((text) => {
            const node = $textNodeShowing(text);

            return $isTextNode(node) && node.hasFormat('bold');
        }));

        expect(bold).toEqual([true, true]);
        expect(editor.getValue()).toContain('| **c** | **d** |');
    });

    it('the cells are formatted by the editor\'s own handler, not the observer\'s: a cell holding a run kept as source is left as it is', async () => {
        // The observer's handler formats every text node of the selected cells. The editor's leaves
        // out a cell whose source is kept as written, which a format would be shown on but not saved.
        const editor = mounted('| a | b |\n| - | - |\n| <b>c</b> | d |\n\nafter');
        selectLastRowCells(editor);

        editor.toggleBold();
        await Promise.resolve();

        expect(editor.getValue()).toContain('| <b>c</b> | **d** |');
        expect(lexicalOf(editor).read(() => $textNodeShowing('c').hasFormat('bold'))).toBe(false);
    });
});

// A click on a menu row or a toolbar button takes the keyboard off the surface before the command runs. A command
// that changes the document gets it back when Lexical writes its selection to the browser, and one that finds
// nothing to change runs no such update, so it has Lexical focus the surface itself. What that does is write the
// selection back into the surface: a browser moves the keyboard focus there with it, which jsdom does not model, so
// these tests read the browser's selection, which jsdom drops with the focus.
describe('MarkdownEditor, mounted: a call that changes nothing hands the keyboard back to the surface', () => {
    const TABLE_ALIGNED = 'para\n\n| a | b |\n| :-: | - |\n| c | d |';
    const FENCE = '::: columns\nA\n|||\nB\n:::';

    const CALLS: Array<[name: string, source: string, text: string, run: (editor: MarkdownEditor) => unknown]> = [
        ['setBlockType() with the type the block has', TABLE_ALIGNED, 'para', (editor) => editor.setBlockType('paragraph')],
        ['setTableColumnAlignment() with the alignment the column has', TABLE_ALIGNED, 'c', (editor) => editor.setTableColumnAlignment('center')],
        ['setTableColumnWidth(null) in a column with no width', TABLE_ALIGNED, 'c', (editor) => editor.setTableColumnWidth(null)],
        ['setBlockAlignment(null) in a ::: block with no alignment', FENCE, 'A', (editor) => editor.setBlockAlignment(null)],
        ['setBlockAlignment(null) outside a ::: block', TABLE_ALIGNED, 'para', (editor) => editor.setBlockAlignment(null)],
        ['setColumnCount() with the count the ::: block has', FENCE, 'A', (editor) => editor.setColumnCount(2)],
        ['setColumnCount(1) outside a ::: block', TABLE_ALIGNED, 'para', (editor) => editor.setColumnCount(1)],
    ];

    it.each(CALLS)('%s', async (_name, source, text, run) => {
        const editor = mounted(source);
        const root = lexicalOf(editor).getRootElement() as HTMLElement;
        const reported = vi.fn();
        const browserSelection = window.getSelection() as Selection;

        // jsdom gives an editing host no focus unless it has a tab index, which a browser does.
        root.tabIndex = 0;
        caretIn(editor, text, 1);
        root.focus();

        expect(browserSelection.type).toBe('Caret');

        root.blur();

        expect(browserSelection.type).toBe('None');

        editor.on('change', reported);
        editor.on('selectionstate', reported);
        run(editor);

        // Lexical commits the focus on the next microtask.
        await Promise.resolve();

        expect(browserSelection.type).toBe('Caret');
        expect(root.contains(browserSelection.anchorNode)).toBe(true);
        expect(browserSelection.anchorNode?.textContent).toBe(text);
        expect(editor.getValue()).toBe(source);
        expect(reported).not.toHaveBeenCalled();
    });
});
