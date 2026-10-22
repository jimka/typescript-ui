// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor pastes table rows and cells that were copied without their
// table as a table holding them
// (plans/markdown-editor-table-cells-paste-empty-column.md). A range selection
// that stays inside one table copies its rows, or the cells of one row, bare.
// They paste as a copied table does, and no paste leaves a `:::` column, a
// list, a table or the document without a block.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    $createParagraphNode, $createRangeSelection, $createTextNode, $findMatchingParent, $getRoot, $getSelection, $isElementNode, $isParagraphNode,
    $isRangeSelection, $isTextNode, $setSelection, UNDO_COMMAND,
} from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode, TextNode } from 'lexical';
import { $generateJSONFromSelectedNodes, $generateNodesFromSerializedNodes, $insertGeneratedNodes } from '@lexical/clipboard';
import { $createTableCellNode, $createTableNode, $createTableRowNode, $createTableSelectionFrom, $isTableCellNode, $isTableNode } from '@lexical/table';
import type { TableCellNode, TableNode } from '@lexical/table';
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
afterEach(() => DOM.reset());

/** The table the rows copy from. */
const T = '| h1 | h2 |\n| --- | --- |\n| c1 | c2 |';
/** What `T`'s two body cells paste as: a table of one row, which the save writes as its header. */
const CELLS_T = '| c1 | c2 |\n| --- | --- |';
/** What the cells copied from `c1`@1 to `c2`@1 paste as. */
const PART_T = '| 1 | c |\n| --- | --- |';
/** A wider table, for copies whose rows differ in length. */
const T3 = '| h1 | h2 | h3 |\n| --- | --- | --- |\n| c1 | c2 | c3 |\n| d1 | d2 | d3 |';
/** What `T3`'s rows copied from `h2`@0 to `d2`@2 paste as: the short rows filled with empty cells. */
const T3_PART = '| h2 | h3 |  |\n| --- | --- | --- |\n| c1 | c2 | c3 |\n| d1 | d2 |  |';
/** A second table, to paste into. */
const X = '| x1 | x2 |\n| --- | --- |\n| y1 | y2 |';
/** `X`'s header and delimiter rows. */
const X_HEAD = '| x1 | x2 |\n| --- | --- |';
/** `X` after `T`'s two rows are pasted at `y1`: they replace its body row and add one. */
const X_ROWS = X_HEAD + '\n| h1 | h2 |\n| c1 | c2 |';
/** `X` after `T`'s two body cells are pasted at `y1`. */
const X_CELLS = X_HEAD + '\n| c1 | c2 |';
/** `X` after `T3`'s rows copied from `c2`@0 to `d1`@2 are pasted at `y1`. */
const X_SHORT = X_HEAD + '\n| c2 | c3 |\n| d1 |  |';
/** `X` after `T`'s two rows are pasted over its selected cells `y1` and `y2`: only the first row fits. */
const X_FIRST_ROW = X_HEAD + '\n| h1 | h2 |';
/** What `T`'s body cells followed by its two rows paste as: one table. */
const MIXED_T = CELLS_T + '\n| h1 | h2 |\n| c1 | c2 |';

/** `text` as the continuation lines of a list item: every line after the first indented by two spaces. */
const inItem = (text: string): string => text.replaceAll('\n', '\n  ');

/** A table whose last column holds a cell spanning its two body rows (`^^` continues the cell above). */
const SPAN = '| h1 | h2 | h3 |\n| --- | --- | --- |\n| a1 | b1 | m1 |\n| c1 | d1 | ^^ |';
/** What `SPAN`'s rows copied from `a1`@0 to `c1`@2 paste as: the second row filled beside the span, which a header row cannot keep. */
const SPAN_PART = '| a1 | b1 | m1 |\n| --- | --- | --- |\n| c1 |  |  |';
/** A three-column table, to paste into. */
const X3 = '| x1 | x2 | x3 |\n| --- | --- | --- |\n| y1 | y2 | y3 |\n| z1 | z2 | z3 |';
/** `X3` after `SPAN`'s rows copied from `a1`@0 to `c1`@2 are pasted at `y1`: the span is kept between its two body rows. */
const X3_SPAN = '| x1 | x2 | x3 |\n| --- | --- | --- |\n| a1 | b1 | m1 |\n| c1 |  | ^^ |';

/** A two-column fence holding `left` and `right`; `''` is a column holding nothing. */
const cols = (left: string, right: string): string => `::: columns\n${left}\n|||\n${right}\n:::`;

/** The types of the nodes that must always hold a child. */
const CONTAINER_TYPES: readonly string[] = ['root', 'list', 'markdown-list-item', 'table', 'tablerow', 'markdown-block', 'markdown-column'];

/** Nodes copied as Lexical's clipboard serializes them. */
type CopiedNodes = Parameters<typeof $generateNodesFromSerializedNodes>[0];

/** A point in the document: the exact text of a text node, and an offset in it. */
type TextPoint = readonly [text: string, offset: number];

/** A selection end: a text point, or the start of the document's first empty paragraph. */
type Point = TextPoint | 'empty-paragraph';

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
 * Runs `edit` as one discrete update of the editor's document.
 *
 * @param editor - The editor.
 * @param edit - The edit; runs inside `editor.update`.
 */
function update(editor: MarkdownEditor, edit: () => void): void {
    lexicalOf(editor).update(edit, { discrete: true });
}

/**
 * Finds the document's first text node whose text is exactly `text`.
 *
 * @param text - The text.
 * @returns The text node.
 */
function $textNode(text: string): TextNode {
    const found = $dfs($getRoot()).find(({ node }) => $isTextNode(node) && node.getTextContent() === text);

    if (found === undefined) {
        throw new Error(`no text node "${text}"`);
    }

    return found.node as TextNode;
}

/**
 * Pastes copied nodes at the selection as Lexical's clipboard does, through
 * `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND`.
 *
 * @param editor - The editor.
 * @param nodes - The copied nodes.
 */
function pasteNodes(editor: MarkdownEditor, nodes: CopiedNodes): void {
    const lexical = lexicalOf(editor);

    update(editor, () => {
        $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), $getSelection()!);
    });
}

/**
 * Every node in the document, depth first.
 *
 * @param editor - The editor.
 * @returns Each node's type and its parent's type.
 */
function nodesOf(editor: MarkdownEditor): { type: string; parent: string | null; node: LexicalNode }[] {
    return lexicalOf(editor).read(() => $dfs($getRoot()).map(({ node }) => ({
        type:   node.getType(),
        parent: node.getParent()?.getType() ?? null,
        node,
    })));
}

/**
 * The types of every column's children, in document order.
 *
 * @param editor - The editor.
 * @returns The child types.
 */
function columnChildTypes(editor: MarkdownEditor): string[] {
    return nodesOf(editor).filter(({ parent }) => parent === 'markdown-column').map(({ type }) => type);
}

/**
 * The types of the root's children.
 *
 * @param editor - The editor.
 * @returns The child types.
 */
function rootChildTypes(editor: MarkdownEditor): string[] {
    return nodesOf(editor).filter(({ parent }) => parent === 'root').map(({ type }) => type);
}

/**
 * Asserts the editor shows what the viewer reads in its save.
 *
 * @param editor - The editor.
 */
function expectParity(editor: MarkdownEditor): void {
    expect(editorSurfaceModel(editor)).toEqual(viewerModel(editor.getValue()).blocks);
}

/**
 * Where the caret is.
 *
 * @param editor - The editor.
 * @returns The text of the node the caret is in, and the caret's offset in it.
 * @throws Error - When the selection is not a collapsed range.
 */
function caretAt(editor: MarkdownEditor): [string, number] {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
            throw new Error('the selection is not a caret');
        }

        return [selection.anchor.getNode().getTextContent(), selection.anchor.offset];
    });
}

/**
 * A selection end as the arguments of a point's `set`.
 *
 * @param point - The end.
 * @returns The node's key, the offset in it, and the point's type.
 * @throws Error - When `point` is `'empty-paragraph'` and the document has none.
 */
function $pointOf(point: Point): [string, number, 'text' | 'element'] {
    if (point !== 'empty-paragraph') {
        return [$textNode(point[0]).getKey(), point[1], 'text'];
    }

    const found = $dfs($getRoot()).find(({ node }) => $isParagraphNode(node) && node.isEmpty());

    if (found === undefined) {
        throw new Error('no empty paragraph');
    }

    return [found.node.getKey(), 0, 'element'];
}

/**
 * Selects from `anchor` to `focus`.
 *
 * @param editor - The editor.
 * @param anchor - The anchor.
 * @param focus - The focus.
 */
function select(editor: MarkdownEditor, anchor: Point, focus: Point): void {
    update(editor, () => {
        const selection = $createRangeSelection();

        selection.anchor.set(...$pointOf(anchor));
        selection.focus.set(...$pointOf(focus));
        $setSelection(selection);
    });
}

/**
 * Copies the range from `from` to `to` as Lexical's clipboard does: a range
 * that stays inside one table copies its rows, or the cells of one row,
 * without the table.
 *
 * @param editor - The editor.
 * @param from - The range's anchor.
 * @param to - The range's focus.
 * @returns The copied nodes.
 */
function copyRange(editor: MarkdownEditor, from: Point, to: Point): CopiedNodes {
    const lexical = lexicalOf(editor);

    select(editor, from, to);

    return lexical.read(() => $generateJSONFromSelectedNodes(lexical, $getSelection()).nodes);
}

/**
 * The table cell holding the text node `text`.
 *
 * @param text - The text.
 * @returns The cell.
 * @throws Error - When the text is in no cell.
 */
function $cellOf(text: string): TableCellNode {
    const cell = $findMatchingParent($textNode(text), $isTableCellNode);

    if (cell === null) {
        throw new Error(`"${text}" is in no table cell`);
    }

    return cell;
}

/**
 * The table holding the text node `text`.
 *
 * @param text - The text.
 * @returns The table.
 * @throws Error - When the text is in no table.
 */
function $tableOf(text: string): TableNode {
    const table = $findMatchingParent($textNode(text), $isTableNode);

    if (table === null) {
        throw new Error(`"${text}" is in no table`);
    }

    return table;
}

/**
 * Copies the cells from the one holding `from` to the one holding `to` as a
 * table selection does, which is what a mounted editor makes of a drag
 * across cells: the copy holds a whole table.
 *
 * @param editor - The editor.
 * @param from - The text of the first cell.
 * @param to - The text of the last cell.
 * @returns The copied nodes.
 */
function copyCells(editor: MarkdownEditor, from: string, to: string): CopiedNodes {
    const lexical = lexicalOf(editor);

    return lexical.read(() => $generateJSONFromSelectedNodes(lexical, $createTableSelectionFrom($tableOf(from), $cellOf(from), $cellOf(to))).nodes);
}

/**
 * Pastes copied nodes at `at`, or over the range from `at` to `to`.
 *
 * @param editor - The editor.
 * @param nodes - The copied nodes.
 * @param at - The caret, or the range's anchor.
 * @param to - The range's focus. `at` when omitted.
 */
function pasteAt(editor: MarkdownEditor, nodes: CopiedNodes, at: Point, to: Point = at): void {
    select(editor, at, to);
    pasteNodes(editor, nodes);
}

/**
 * Pastes nodes built by hand at `at`, for a payload no copy makes.
 *
 * @param editor - The editor.
 * @param $build - Builds the nodes; runs inside the paste's update.
 * @param at - The caret.
 */
function pasteBuiltAt(editor: MarkdownEditor, $build: () => LexicalNode[], at: Point): void {
    const lexical = lexicalOf(editor);

    select(editor, at, at);
    update(editor, () => {
        $insertGeneratedNodes(lexical, $build(), $getSelection()!);
    });
}

/**
 * Pastes copied nodes at a caret held as an element point: a point on an
 * element, between two of its children, which is how Lexical holds a caret
 * that no text node can take (after an image, or at the edge of a link).
 *
 * @param editor - The editor.
 * @param nodes - The copied nodes.
 * @param $element - Finds the element the point is on; runs inside the paste's update.
 * @param offset - The index among the element's children, or `'end'` for the point after its last child.
 */
function pasteAtPointOn(editor: MarkdownEditor, nodes: CopiedNodes, $element: () => ElementNode, offset: number | 'end'): void {
    const lexical = lexicalOf(editor);

    update(editor, () => {
        const element = $element();
        const index = offset === 'end' ? element.getChildrenSize() : offset;
        const selection = $createRangeSelection();

        selection.anchor.set(element.getKey(), index, 'element');
        selection.focus.set(element.getKey(), index, 'element');
        $setSelection(selection);
        $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), selection);
    });
}

/**
 * The link that follows the text node `text` in its block.
 *
 * @param text - The text before the link.
 * @returns The link.
 * @throws Error - When no element follows the text.
 */
function $linkAfter(text: string): ElementNode {
    const link = $textNode(text).getNextSibling();

    if (!$isElementNode(link)) {
        throw new Error(`no link after "${text}"`);
    }

    return link;
}

/**
 * The types of copied top-level nodes.
 *
 * @param nodes - The copied nodes.
 * @returns Their types, in order.
 */
function typesOf(nodes: CopiedNodes): string[] {
    return nodes.map((node) => node.type);
}

/**
 * The containers of the document that hold no child.
 *
 * @param editor - The editor.
 * @returns The type of each such node, in document order.
 */
function emptyContainers(editor: MarkdownEditor): string[] {
    return lexicalOf(editor).read(() => $dfs($getRoot())
        .filter(({ node }) => $isElementNode(node) && node.isEmpty() && CONTAINER_TYPES.includes(node.getType()))
        .map(({ node }) => node.getType()));
}

/**
 * Asserts that the editor's save loads as the document the editor shows,
 * and saves as itself.
 *
 * @param editor - The editor.
 */
function expectReloadsAsShown(editor: MarkdownEditor): void {
    const saved = editor.getValue();
    const reloaded = load(saved);

    expect(reloaded.getValue()).toBe(saved);
    expect(editorSurfaceModel(reloaded)).toEqual(editorSurfaceModel(editor));
}

/**
 * Appends an empty paragraph to the document.
 *
 * @param editor - The editor.
 */
function appendEmptyParagraph(editor: MarkdownEditor): void {
    update(editor, () => {
        $getRoot().append($createParagraphNode());
    });
}

/**
 * Copies `T`'s two rows from the editor's document: a range from the start
 * of its first cell to the end of its last.
 *
 * @param editor - An editor whose document holds `T`.
 * @returns The copied nodes, two bare rows.
 */
function copyRows(editor: MarkdownEditor): CopiedNodes {
    return copyRange(editor, ['h1', 0], ['c2', 2]);
}

/**
 * Copies `T`'s two body cells from the editor's document: a range that
 * stays inside its second row.
 *
 * @param editor - An editor whose document holds `T`.
 * @returns The copied nodes, two bare cells.
 */
function copyBodyCells(editor: MarkdownEditor): CopiedNodes {
    return copyRange(editor, ['c1', 0], ['c2', 2]);
}

/**
 * Asserts what every paste of bare rows or cells must leave: no container
 * without a child, a save the viewer reads as the editor shows it, and a
 * save that loads as the same document.
 *
 * @param editor - The editor, after the paste.
 */
function expectSoundDocument(editor: MarkdownEditor): void {
    expect(emptyContainers(editor)).toEqual([]);
    expectParity(editor);
    expectReloadsAsShown(editor);
}

/**
 * Undoes the editor's last undo step.
 *
 * @param editor - The editor.
 */
function undo(editor: MarkdownEditor): void {
    lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
}

describe('bare rows and cells pasted at a caret at the top level become a table', () => {
    it('A1: two rows at the end of a paragraph', () => {
        const editor = load(T + '\n\nafter');
        const nodes = copyRows(editor);

        pasteAt(editor, nodes, ['after', 5]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(T + '\n\nafter\n\n' + T);
        expect(rootChildTypes(editor)).toEqual(['table', 'paragraph', 'table', 'paragraph']);
        expect(caretAt(editor)).toEqual(['c2', 2]);
        expectSoundDocument(editor);
    });

    it('A2: two rows in the middle of a paragraph split it', () => {
        const editor = load(T + '\n\nafter');
        const nodes = copyRows(editor);

        pasteAt(editor, nodes, ['after', 2]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(T + '\n\naf\n\n' + T + '\n\nter');
        expect(rootChildTypes(editor)).toEqual(['table', 'paragraph', 'table', 'paragraph']);
        expect(caretAt(editor)).toEqual(['c2', 2]);
        expectSoundDocument(editor);
    });

    it('A3: the cells of one row in the middle of a paragraph', () => {
        const editor = load(T + '\n\nafter');
        const nodes = copyBodyCells(editor);

        pasteAt(editor, nodes, ['after', 2]);

        expect(typesOf(nodes)).toEqual(['tablecell', 'tablecell']);
        expect(editor.getValue()).toBe(T + '\n\naf\n\n' + CELLS_T + '\n\nter');
        expect(rootChildTypes(editor)).toEqual(['table', 'paragraph', 'table', 'paragraph']);
        expectSoundDocument(editor);
    });

    it('A4: two rows in an empty paragraph replace it', () => {
        const editor = load(T);

        appendEmptyParagraph(editor);

        const nodes = copyRows(editor);

        pasteAt(editor, nodes, 'empty-paragraph');

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(T + '\n\n' + T);
        expect(rootChildTypes(editor)).toEqual(['table', 'table']);
        expectSoundDocument(editor);
    });

    it('A5: cells copied from inside their texts', () => {
        const editor = load(T + '\n\nafter');
        const nodes = copyRange(editor, ['c1', 1], ['c2', 1]);

        pasteAt(editor, nodes, ['after', 5]);

        expect(typesOf(nodes)).toEqual(['tablecell', 'tablecell']);
        expect(editor.getValue()).toBe(T + '\n\nafter\n\n' + PART_T);
        expect(caretAt(editor)).toEqual(['c', 1]);
        expectSoundDocument(editor);
    });

    it('A6: rows of different lengths are filled to the widest', () => {
        const editor = load(T3 + '\n\nafter');
        const nodes = copyRange(editor, ['h2', 0], ['d2', 2]);

        pasteAt(editor, nodes, ['after', 5]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow', 'tablerow']);
        expect(nodes.map((row) => (row as unknown as { children: unknown[] }).children.length)).toEqual([2, 3, 2]);
        expect(editor.getValue()).toBe(T3 + '\n\nafter\n\n' + T3_PART);
        expectSoundDocument(editor);
    });

    it('A7: a row behind a cell that spans down into it is filled in the column it lacks, not at its end alone', () => {
        const editor = load(SPAN + '\n\nafter');
        const nodes = copyRange(editor, ['a1', 0], ['c1', 2]);

        pasteAt(editor, nodes, ['after', 5]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(nodes.map((row) => (row as unknown as { children: unknown[] }).children.length)).toEqual([3, 1]);
        expect(editor.getValue()).toBe(SPAN + '\n\nafter\n\n' + SPAN_PART);
        expectSoundDocument(editor);
    });
});

describe('bare rows and cells pasted in a ::: column leave the column a block', () => {
    it('C1: two rows in the empty paragraph that is all a column holds', () => {
        const editor = load(T + '\n\n' + cols('Left', ''));
        const nodes = copyRows(editor);

        pasteAt(editor, nodes, 'empty-paragraph');

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(T + '\n\n' + cols('Left', T));
        expect(columnChildTypes(editor)).toEqual(['paragraph', 'table']);
        expectSoundDocument(editor);
    });

    it('C2: the cells of one row there', () => {
        const editor = load(T + '\n\n' + cols('Left', ''));
        const nodes = copyBodyCells(editor);

        pasteAt(editor, nodes, 'empty-paragraph');

        expect(typesOf(nodes)).toEqual(['tablecell', 'tablecell']);
        expect(editor.getValue()).toBe(T + '\n\n' + cols('Left', CELLS_T));
        expect(columnChildTypes(editor)).toEqual(['paragraph', 'table']);
        expectSoundDocument(editor);
    });

    it('C3: two rows over all of the text of a column\'s only paragraph', () => {
        const editor = load(T + '\n\n' + cols('abcdef', 'Right'));
        const nodes = copyRows(editor);

        pasteAt(editor, nodes, ['abcdef', 0], ['abcdef', 6]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(T + '\n\n' + cols(T, 'Right'));
        expect(columnChildTypes(editor)).toEqual(['table', 'paragraph']);
        expectSoundDocument(editor);
    });

    it('C4: two rows over a part of that text', () => {
        const editor = load(T + '\n\n' + cols('abcdef', 'Right'));
        const nodes = copyRows(editor);

        pasteAt(editor, nodes, ['abcdef', 2], ['abcdef', 4]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(T + '\n\n' + cols('ab\n\n' + T + '\n\nef', 'Right'));
        expect(columnChildTypes(editor)).toEqual(['paragraph', 'table', 'paragraph', 'paragraph']);
        expectSoundDocument(editor);
    });
});

describe('bare rows and cells pasted over a range that leaves a table', () => {
    it('D1: from a column\'s table into the next column', () => {
        const editor = load(cols(T, 'Right'));
        const nodes = copyRows(editor);

        pasteAt(editor, nodes, ['c1', 1], ['Right', 2]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(cols(T, 'ght'));
        expect(columnChildTypes(editor)).toEqual(['table', 'paragraph']);
        expectSoundDocument(editor);
    });

    it('D2: from a column\'s table into a paragraph after the fence', () => {
        const editor = load(cols('Left', T) + '\n\nafter');
        const nodes = copyRows(editor);

        pasteAt(editor, nodes, ['c1', 1], ['after', 2]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(cols('Left', T) + '\n\nter');
        expect(columnChildTypes(editor)).toEqual(['paragraph', 'table']);
        expectSoundDocument(editor);
    });

    it('D3: from an empty column into the next column\'s table', () => {
        const editor = load(cols('', T));
        const nodes = copyBodyCells(editor);

        pasteAt(editor, nodes, 'empty-paragraph', ['c1', 1]);

        expect(typesOf(nodes)).toEqual(['tablecell', 'tablecell']);
        expect(editor.getValue()).toBe(cols(CELLS_T, ''));
        expect(columnChildTypes(editor)).toEqual(['table', 'paragraph']);
        expectSoundDocument(editor);
    });

    it('D4: from a column\'s table into the next, empty column', () => {
        const editor = load(cols(T, ''));
        const nodes = copyBodyCells(editor);

        pasteAt(editor, nodes, ['c1', 1], 'empty-paragraph');

        expect(typesOf(nodes)).toEqual(['tablecell', 'tablecell']);
        expect(editor.getValue()).toBe(cols(CELLS_T, ''));
        expect(columnChildTypes(editor)).toEqual(['table', 'paragraph']);
        expectSoundDocument(editor);
    });

    it('D5: from a paragraph into the table after it', () => {
        const editor = load('before\n\n' + T + '\n\nafter');
        const nodes = copyRows(editor);

        pasteAt(editor, nodes, ['before', 2], ['c1', 1]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe('be\n\n' + T + '\n\nafter');
        expect(rootChildTypes(editor)).toEqual(['paragraph', 'table', 'paragraph', 'paragraph']);
        expectSoundDocument(editor);
    });

    it('D6: from the table to the end of the document', () => {
        const editor = load(T + '\n\nafter');
        const nodes = copyRows(editor);

        pasteAt(editor, nodes, ['h1', 1], ['after', 5]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(T);
        expect(rootChildTypes(editor)).toEqual(['table']);
        expectSoundDocument(editor);
    });

    it('D7: from a column\'s paragraph into the next column\'s table', () => {
        const editor = load(cols('Left', T));
        const nodes = copyRows(editor);

        pasteAt(editor, nodes, ['Left', 2], ['c1', 1]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(cols('Le\n\n' + T, ''));
        expect(columnChildTypes(editor)).toEqual(['paragraph', 'table', 'paragraph', 'paragraph']);
        expectSoundDocument(editor);
    });
});

describe('bare rows and cells pasted into another table are written over its cells', () => {
    it('E1: two rows at a body cell replace its row and add one', () => {
        const editor = load(T + '\n\nmid\n\n' + X);
        const nodes = copyRows(editor);

        pasteAt(editor, nodes, ['y1', 1]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(T + '\n\nmid\n\n' + X_ROWS);
        expectSoundDocument(editor);
    });

    it('E2: the cells of one row at a body cell', () => {
        const editor = load(T + '\n\nmid\n\n' + X);
        const nodes = copyBodyCells(editor);

        pasteAt(editor, nodes, ['y1', 1]);

        expect(typesOf(nodes)).toEqual(['tablecell', 'tablecell']);
        expect(editor.getValue()).toBe(T + '\n\nmid\n\n' + X_CELLS);
        expectSoundDocument(editor);
    });

    it('E3: rows of different lengths are filled before they are written', () => {
        const editor = load(T3 + '\n\n' + X);
        const nodes = copyRange(editor, ['c2', 0], ['d1', 2]);

        pasteAt(editor, nodes, ['y1', 1]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(nodes.map((row) => (row as unknown as { children: unknown[] }).children.length)).toEqual([2, 1]);
        expect(editor.getValue()).toBe(T3 + '\n\n' + X_SHORT);
        expectSoundDocument(editor);
    });

    it('E4: two rows over a table selection of one row fill that row', () => {
        const editor = load(T + '\n\nmid\n\n' + X);
        const nodes = copyRows(editor);
        const lexical = lexicalOf(editor);

        update(editor, () => {
            const selection = $createTableSelectionFrom($tableOf('y1'), $cellOf('y1'), $cellOf('y2'));

            $setSelection(selection);
            $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), selection);
        });

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(T + '\n\nmid\n\n' + X_FIRST_ROW);
        expectSoundDocument(editor);
    });

    it('E5: rows the copy cut a spanning cell\'s row short in are written as a rectangle', () => {
        const editor = load(SPAN + '\n\n' + X3);
        const nodes = copyRange(editor, ['a1', 0], ['c1', 2]);

        pasteAt(editor, nodes, ['y1', 1]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(SPAN + '\n\n' + X3_SPAN);
        expectSoundDocument(editor);
    });
});

describe('a paste mixing bare rows, bare cells and other blocks', () => {
    /**
     * The three copies the rows mix, taken from a document of their own.
     *
     * @returns `T`'s two rows, its two body cells, and two paragraphs.
     */
    function copies(): { rows: CopiedNodes; cells: CopiedNodes; paragraphs: CopiedNodes } {
        const source = load(T + '\n\nAlpha\n\nBeta');

        return {
            rows:       copyRows(source),
            cells:      copyBodyCells(source),
            paragraphs: copyRange(source, ['Alpha', 0], ['Beta', 4]),
        };
    }

    /**
     * A document to paste into, the caret in an empty paragraph after its text.
     *
     * @returns The editor.
     */
    function target(): MarkdownEditor {
        const editor = load('Target');

        appendEmptyParagraph(editor);

        return editor;
    }

    it('G1: cells followed by rows become one table', () => {
        const { rows, cells } = copies();
        const editor = target();

        pasteAt(editor, [...cells, ...rows], 'empty-paragraph');

        expect(editor.getValue()).toBe('Target\n\n' + MIXED_T);
        expect(rootChildTypes(editor)).toEqual(['paragraph', 'table']);
        expectSoundDocument(editor);
    });

    it('G2: each run of rows or cells becomes a table of its own, and the blocks between keep their place', () => {
        const { rows, cells, paragraphs } = copies();
        const editor = target();

        expect(typesOf(paragraphs)).toEqual(['paragraph', 'paragraph']);

        pasteAt(editor, [...rows, ...paragraphs, ...cells], 'empty-paragraph');

        expect(editor.getValue()).toBe('Target\n\n' + T + '\n\nAlpha\n\nBeta\n\n' + CELLS_T);
        expect(rootChildTypes(editor)).toEqual(['paragraph', 'table', 'paragraph', 'paragraph', 'table']);
        expectSoundDocument(editor);
    });

    it('G3: a row that holds no cell, which no copy makes, becomes a table of one empty cell', () => {
        const editor = target();

        pasteBuiltAt(editor, () => [$createTableRowNode()], 'empty-paragraph');

        expect(editor.getValue()).toBe('Target\n\n|  |\n| --- |');
        expectSoundDocument(editor);
    });

    it('G4: a row that holds something other than cells, which no copy makes, keeps its cells alone', () => {
        const source = load(T);
        const cells = copyBodyCells(source);
        const editor = target();

        pasteBuiltAt(editor, () => [$createTableRowNode().append($createParagraphNode(), ...$generateNodesFromSerializedNodes(cells))], 'empty-paragraph');

        expect(editor.getValue()).toBe('Target\n\n' + CELLS_T);
        expectSoundDocument(editor);
    });
});

describe('bare rows and cells paste as the table that holds them', () => {
    const TARGETS: readonly { name: string; source: string; at: TextPoint }[] = [
        { name: 'a heading',          source: T + '\n\n## head',               at: ['head', 2] },
        { name: 'a quote',            source: T + '\n\n> quote',               at: ['quote', 2] },
        { name: 'a list item',        source: T + '\n\n- one\n- two',          at: ['one', 2] },
        { name: 'a nested list item', source: T + '\n\n- one\n  - sub\n- two', at: ['sub', 2] },
        { name: 'a code block',       source: T + '\n\n```\ncode\n```',        at: ['code', 2] },
        { name: 'a raw block',        source: T + '\n\n<div>\nraw\n</div>',    at: ['raw', 2] },
    ];

    const KINDS: readonly { name: string; from: string; to: string }[] = [
        { name: 'rows',  from: 'h1', to: 'c2' },
        { name: 'cells', from: 'c1', to: 'c2' },
    ];

    const COMBINATIONS = TARGETS.flatMap((target) => KINDS.map((kind) => ({ target, kind })));

    it.each(COMBINATIONS)('K: $kind.name in $target.name', ({ target, kind }) => {
        const bare = load(target.source);
        const whole = load(target.source);

        pasteAt(bare, copyRange(bare, [kind.from, 0], [kind.to, 2]), target.at);
        pasteAt(whole, copyCells(whole, kind.from, kind.to), target.at);

        expect(bare.getValue()).toBe(whole.getValue());
        expect(caretAt(bare)).toEqual(caretAt(whole));
        expect(emptyContainers(bare)).toEqual([]);
    });
});

describe('bare rows and cells pasted at a list item', () => {
    it('L1: two rows in the middle of an item\'s text split the list, and the text after the caret stays an item', () => {
        const source = T + '\n\n- abcd\n- two';
        const editor = load(source);
        const nodes = copyRows(editor);

        pasteAt(editor, nodes, ['abcd', 2]);

        expect(typesOf(nodes)).toEqual(['tablerow', 'tablerow']);
        expect(editor.getValue()).toBe(T + '\n\n- ab\n\n' + T + '\n\n- cd\n- two');
        expect(rootChildTypes(editor)).toEqual(['table', 'list', 'table', 'list']);
        expect(caretAt(editor)).toEqual(['c2', 2]);
        expectSoundDocument(editor);

        undo(editor);

        expect(editor.getValue()).toBe(source);
    });

    it('L2: at the start of an item\'s text the table goes before the item', () => {
        const editor = load(T + '\n\n- one\n- abcd\n- two');

        pasteAt(editor, copyRows(editor), ['abcd', 0]);

        expect(editor.getValue()).toBe(T + '\n\n- one\n\n' + T + '\n\n- abcd\n- two');
        expect(rootChildTypes(editor)).toEqual(['table', 'list', 'table', 'list']);
        expectSoundDocument(editor);
    });

    it('L3: at the end of an item\'s text the table goes after the item, and no empty item is left', () => {
        const editor = load(T + '\n\n- abcd\n- two');

        pasteAt(editor, copyRows(editor), ['abcd', 4]);

        expect(editor.getValue()).toBe(T + '\n\n- abcd\n\n' + T + '\n\n- two');
        expect(rootChildTypes(editor)).toEqual(['table', 'list', 'table', 'list']);
        expectSoundDocument(editor);
    });

    it('L4: the blocks an item holds stay with the text after the caret', () => {
        const editor = load(T + '\n\n- abcd\n\n  para\n  - sub\n- two');

        pasteAt(editor, copyRows(editor), ['abcd', 2]);

        expect(editor.getValue()).toBe(T + '\n\n- ab\n\n' + T + '\n\n- cd\n\n  para\n\n  - sub\n\n- two');
        expectSoundDocument(editor);
    });

    it('L5: in a nested item the table becomes a block of the outer item, between the two halves of the nested list', () => {
        const editor = load(T + '\n\n- one\n  - abcd\n  - e\n- two');

        pasteAt(editor, copyRows(editor), ['abcd', 2]);

        expect(editor.getValue()).toBe(T + '\n\n- one\n  - ab\n\n  ' + inItem(T) + '\n\n  - cd\n  - e\n\n- two');
        expectSoundDocument(editor);
    });

    it('L6: the cells of one row in the middle of an item\'s text', () => {
        const editor = load(T + '\n\n- abcd\n- two');
        const nodes = copyBodyCells(editor);

        pasteAt(editor, nodes, ['abcd', 2]);

        expect(typesOf(nodes)).toEqual(['tablecell', 'tablecell']);
        expect(editor.getValue()).toBe(T + '\n\n- ab\n\n' + CELLS_T + '\n\n- cd\n- two');
        expectSoundDocument(editor);
    });

    it('L7: in a paragraph an item holds, the table becomes a block of the item between the paragraph\'s halves', () => {
        const editor = load(T + '\n\n- one\n\n  abcd\n- two');

        pasteAt(editor, copyRows(editor), ['abcd', 2]);

        expect(editor.getValue()).toBe(T + '\n\n- one\n\n  ab\n\n  ' + inItem(T) + '\n\n  cd\n\n- two');
        expectSoundDocument(editor);
    });

    it('L8: in a cell of a table an item holds, the rows are written over that table\'s cells', () => {
        const editor = load(T + '\n\n- one\n\n  ' + inItem(X) + '\n- two');

        pasteAt(editor, copyRows(editor), ['y1', 1]);

        expect(editor.getValue()).toBe(T + '\n\n- one\n\n  ' + inItem(X_ROWS) + '\n\n- two');
        expectSoundDocument(editor);
    });

    it('L9: over a range from one item\'s text into the next, the rest of the second text stays an item', () => {
        const editor = load(T + '\n\n- one\n- abcd\n- two');

        pasteAt(editor, copyRows(editor), ['one', 2], ['abcd', 2]);

        expect(editor.getValue()).toBe(T + '\n\n- on\n\n' + T + '\n\n- cd\n- two');
        expectSoundDocument(editor);
    });

    it('L10: at an item\'s text emptied over a heading, the table and then the heading leave the list', () => {
        const editor = load(T + '\n\n- abcd\n\n  ## head\n- two');

        update(editor, () => {
            $textNode('abcd').remove();
        });

        const nodes = copyRows(editor);

        update(editor, () => {
            const text = $dfs($getRoot()).find(({ node }) => node.getType() === 'markdown-list-item-text' && $isElementNode(node) && node.isEmpty())!.node;

            text.selectStart();
        });
        pasteNodes(editor, nodes);

        expect(editor.getValue()).toBe(T + '\n\n' + T + '\n\n## head\n\n- two');
        expectSoundDocument(editor);
    });
});

describe('the text after the caret of an item\'s text stays out of a pasted table or ::: block', () => {
    /** A document holding one list, to paste into at `abcd`. */
    const LIST = '- abcd\n- two';

    it('X1: a whole table, as a table selection copies it', () => {
        const source = load(T);
        const editor = load(LIST);

        pasteAt(editor, copyCells(source, 'h1', 'c2'), ['abcd', 2]);

        expect(editor.getValue()).toBe('- ab\n\n' + T + '\n\n- cd\n- two');
        expect(caretAt(editor)).toEqual(['c2', 2]);
        expectSoundDocument(editor);

        undo(editor);

        expect(editor.getValue()).toBe(LIST);
    });

    it('X2: a paragraph and a table: the paragraph joins the text before the caret', () => {
        const source = load('pre\n\n' + T);
        const editor = load(LIST);
        const nodes = copyRange(source, ['pre', 1], ['c2', 2]);

        pasteAt(editor, nodes, ['abcd', 2]);

        expect(typesOf(nodes)).toEqual(['paragraph', 'table']);
        expect(editor.getValue()).toBe('- abre\n\n' + T + '\n\n- cd\n- two');
        expectSoundDocument(editor);
    });

    it('X3: a paragraph and a ::: block', () => {
        const source = load('pre\n\n::: {align=center}\nff\n:::');
        const editor = load(LIST);
        const nodes = copyRange(source, ['pre', 1], ['ff', 2]);

        pasteAt(editor, nodes, ['abcd', 2]);

        expect(typesOf(nodes)).toEqual(['paragraph', 'markdown-block']);
        expect(editor.getValue()).toBe('- abre\n\n::: {align=center}\nff\n:::\n\n- cd\n- two');
        expectSoundDocument(editor);
    });

    it('X4: a list whose last item ends in a table: the text after the caret is the next item', () => {
        const source = load('pre\n\n- k\n\n  ' + inItem(T));
        const editor = load(LIST);
        const nodes = copyRange(source, ['pre', 1], ['c2', 2]);

        pasteAt(editor, nodes, ['abcd', 2]);

        expect(typesOf(nodes)).toEqual(['paragraph', 'list']);
        expect(editor.getValue()).toBe('- abre\n\n- k\n\n  ' + inItem(T) + '\n\n- cd\n\n- two');
        expectSoundDocument(editor);
    });

    it('X5: a text that ends in a link, the caret before the link', () => {
        const source = load(T);
        const editor = load('- ab[cd](u)\n- two');

        pasteAt(editor, copyCells(source, 'h1', 'c2'), ['ab', 2]);

        expect(editor.getValue()).toBe('- ab\n\n' + T + '\n\n- [cd](u)\n- two');
        expectSoundDocument(editor);
    });

    it('X6: a table and a paragraph end in text, which the text after the caret joins as before (control)', () => {
        const source = load(T + '\n\npost');
        const editor = load(LIST);
        const nodes = copyRange(source, ['h1', 0], ['post', 2]);

        pasteAt(editor, nodes, ['abcd', 2]);

        expect(typesOf(nodes)).toEqual(['table', 'paragraph']);
        expect(editor.getValue()).toBe('- ab\n\n' + T + '\n\npocd\n\n- two');
        expectSoundDocument(editor);
    });

    it('X7: a table at the end of a text that ends in a link leaves no empty item (control)', () => {
        const source = load(T);
        const editor = load('- ab[cd](u)\n- two');

        pasteAt(editor, copyCells(source, 'h1', 'c2'), ['cd', 2]);

        expect(editor.getValue()).toBe('- ab[cd](u)\n\n' + T + '\n\n- two');
        expectSoundDocument(editor);
    });

    it('X8: a table whose last cell holds no paragraph, which no copy makes, takes no text and leaves no empty item', () => {
        const editor = load(LIST);

        pasteBuiltAt(editor, () => {
            const filled = $createTableCellNode().append($createParagraphNode().append($createTextNode('g1')));

            return [$createTableNode().append($createTableRowNode().append(filled, $createTableCellNode()))];
        }, ['abcd', 2]);

        expect(editor.getValue()).toBe('- ab\n\n| g1 |  |\n| --- | --- |\n\n- cd\n- two');
        expectSoundDocument(editor);
    });

    it('X9: over a range that leaves nothing after the caret, the range is removed first and no item is split off', () => {
        const source = load(T);
        const editor = load('- abcd\n- mid\n\n  para\n- two');

        pasteAt(editor, copyCells(source, 'h1', 'c2'), ['abcd', 2], ['mid', 3]);

        expect(editor.getValue()).toBe('- ab\n\n' + T + '\n\npara\n\n- two');
        expectSoundDocument(editor);
    });

    it('X10: a caret after the image a text ends in, a point on the text itself, has nothing after it', () => {
        const source = load(T);
        const editor = load('- ab![alt](i.png)\n- two');

        pasteAtPointOn(editor, copyCells(source, 'h1', 'c2'), () => $textNode('ab').getParentOrThrow(), 'end');

        expect(editor.getValue()).toBe('- ab![alt](i.png)\n\n' + T + '\n\n- two');
        expectSoundDocument(editor);
    });

    it('X11: an image after the caret is something after it, and stays in the next item', () => {
        const source = load(T);
        const editor = load('- ab![alt](i.png)\n- two');

        pasteAt(editor, copyCells(source, 'h1', 'c2'), ['ab', 2]);

        expect(editor.getValue()).toBe('- ab\n\n' + T + '\n\n- ![alt](i.png)\n- two');
        expectSoundDocument(editor);
    });

    it('X12: blank text after the caret counts as none: no blank item is left', () => {
        const source = load(T);
        const editor = load(LIST);

        update(editor, () => {
            $textNode('abcd').setTextContent('abcd  ');
        });
        pasteAt(editor, copyCells(source, 'h1', 'c2'), ['abcd  ', 4]);

        expect(editor.getValue()).toBe('- abcd\n\n' + T + '\n\n- two');
        expect(rootChildTypes(editor)).toEqual(['list', 'table', 'list']);
        expectSoundDocument(editor);
    });

    it('X13: a range selected backwards from the start of a paragraph into an item\'s text is removed first as well', () => {
        const source = load(T);
        const editor = load('- abcd\n- two\n\nOmega');

        pasteAt(editor, copyCells(source, 'h1', 'c2'), ['Omega', 0], ['abcd', 2]);

        expect(editor.getValue()).toBe('- ab\n\n' + T + '\n\n- Omega');
        expectSoundDocument(editor);
    });

    it('X14: a range selected backwards from the start of a code block into an item\'s text is removed first as well', () => {
        const source = load(T);
        const editor = load('- abcd\n\n```\nkode\n```');

        pasteAt(editor, copyCells(source, 'h1', 'c2'), ['kode', 0], ['abcd', 2]);

        // The range guard removes the range first, whichever way it was dragged, so the caret stands in the item's text
        // and the table is pasted as for a forward range.
        expect(editor.getValue()).toBe('- ab\n\n' + T + '\n\n- kode');
        expect(rootChildTypes(editor)).toEqual(['list', 'table', 'list']);
        expectSoundDocument(editor);
    });

    it('X15: a range that starts outside an item\'s text is not removed: a paste a table declines there leaves it selected', () => {
        const source = load('pre\n\n' + T);
        const editor = load(X);
        const nodes = copyRange(source, ['pre', 1], ['c2', 2]);

        pasteAt(editor, nodes, ['y1', 0], ['y1', 2]);

        // A table together with another block cannot go into a cell: `@lexical/table` pastes nothing.
        expect(typesOf(nodes)).toEqual(['paragraph', 'table']);
        expect(editor.getValue()).toBe(X);
        expect(lexicalOf(editor).read(() => $getSelection()?.getTextContent())).toBe('y1');
    });

    it.each([
        { name: 'a linked image',                     source: '- ab [![alt](i.png)](u)\n- two', before: 'ab ', saved: '- ab [![alt](i.png)](u)\n\n' + T + '\n\n- two' },
        { name: 'a link',                             source: '- ab[cd](u)\n- two',             before: 'ab',  saved: '- ab[cd](u)\n\n' + T + '\n\n- two' },
        { name: 'a reference link',                   source: '- ab[cd][r]\n- two\n\n[r]: /u',  before: 'ab',  saved: '- ab[cd][r]\n\n' + T + '\n\n- two\n\n[r]: /u' },
        { name: 'a linked image and a block under it', source: '- ab [![alt](i.png)](u)\n\n  para\n- two', before: 'ab ',
            saved: '- ab [![alt](i.png)](u)\n\n' + T + '\n\npara\n\n- two' },
    ])('X16: a caret after $name that ends the text, a point on the link, has nothing after it', ({ source, before, saved }) => {
        const origin = load(T);
        const editor = load(source);

        pasteAtPointOn(editor, copyCells(origin, 'h1', 'c2'), () => $linkAfter(before), 'end');

        expect(editor.getValue()).toBe(saved);
        expectSoundDocument(editor);
    });

    it('X17: a linked image that is all the text, the caret a point on the link after it', () => {
        const origin = load(T);
        const editor = load('- [![alt](i.png)](u)\n- two');

        pasteAtPointOn(editor, copyCells(origin, 'h1', 'c2'), () => {
            const link = $dfs($getRoot()).find(({ node }) => node.getType() === 'link');

            return link!.node as ElementNode;
        }, 'end');

        expect(editor.getValue()).toBe('- [![alt](i.png)](u)\n\n' + T + '\n\n- two');
        expectSoundDocument(editor);
    });

    it('X18: a point on a link at its end, with text after the link: that text stays the next item', () => {
        const origin = load(T);
        const editor = load('- ab[cd](u)ef\n- two');

        pasteAtPointOn(editor, copyCells(origin, 'h1', 'c2'), () => $linkAfter('ab'), 'end');

        expect(editor.getValue()).toBe('- ab[cd](u)\n\n' + T + '\n\n- ef\n- two');
        expectSoundDocument(editor);
    });

    it('X19: a point on a link before what it holds: the link stays in the next item', () => {
        const origin = load(T);
        const editor = load('- ab[cd](u)\n- two');

        pasteAtPointOn(editor, copyCells(origin, 'h1', 'c2'), () => $linkAfter('ab'), 0);

        expect(editor.getValue()).toBe('- ab\n\n' + T + '\n\n- [cd](u)\n- two');
        expectSoundDocument(editor);
    });

    it.each([
        { name: 'a point on the link at its end',       $paste: (editor: MarkdownEditor, nodes: CopiedNodes): void => pasteAtPointOn(editor, nodes, () => $linkAfter('ab'), 'end') },
        { name: 'a point in the link\'s text at its end', $paste: (editor: MarkdownEditor, nodes: CopiedNodes): void => pasteAt(editor, nodes, ['cd', 2]) },
    ])('X20: blank text alone after a link, the caret $name: no blank item is left', ({ $paste }) => {
        const origin = load(T);
        const editor = load('- ab[cd](u)\n- two');

        update(editor, () => {
            $linkAfter('ab').insertAfter($createTextNode('  '));
        });
        $paste(editor, copyCells(origin, 'h1', 'c2'));

        expect(editor.getValue()).toBe('- ab[cd](u)\n\n' + T + '\n\n- two');
        expect(rootChildTypes(editor)).toEqual(['list', 'table', 'list']);
        expectSoundDocument(editor);
    });

    it('X21: a caret in a link\'s text at its end, with text after the link: that text stays the next item', () => {
        const origin = load(T);
        const editor = load('- ab[cd](u)ef\n- two');

        pasteAt(editor, copyCells(origin, 'h1', 'c2'), ['cd', 2]);

        expect(editor.getValue()).toBe('- ab[cd](u)\n\n' + T + '\n\n- ef\n- two');
        expectSoundDocument(editor);
    });

    it.each([
        { name: 'forwards',  backward: false },
        { name: 'backwards', backward: true },
    ])('X22: over a range selected $name from the text to the end of the link that ends it, nothing is left after the caret', ({ backward }) => {
        const origin = load(T);
        const editor = load('- ab[cd](u)\n- two');
        const lexical = lexicalOf(editor);
        const nodes = copyCells(origin, 'h1', 'c2');

        update(editor, () => {
            const link = $linkAfter('ab');
            const selection = $createRangeSelection();
            const [inText, onLink] = backward ? [selection.focus, selection.anchor] : [selection.anchor, selection.focus];

            inText.set($textNode('ab').getKey(), 1, 'text');
            onLink.set(link.getKey(), link.getChildrenSize(), 'element');
            $setSelection(selection);
            $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), selection);
        });

        expect(editor.getValue()).toBe('- a\n\n' + T + '\n\n- two');
        expect(rootChildTypes(editor)).toEqual(['list', 'table', 'list']);
        expectSoundDocument(editor);
    });
});

describe('a table pasted at any position of a list item saves what the editor shows', () => {
    const SHAPES: readonly { name: string; source: string }[] = [
        { name: 'an item of text alone',            source: '- abcd\n- two' },
        { name: 'the only item',                    source: '- abcd' },
        { name: 'the last item',                    source: '- one\n- abcd' },
        { name: 'an ordered item',                  source: '1. one\n2. abcd\n3. two' },
        { name: 'a task item',                      source: '- [ ] abcd\n- [x] two' },
        { name: 'an item of a loose list',          source: '- one\n\n- abcd\n\n- two' },
        { name: 'an item holding blocks',           source: '- abcd\n\n  para\n\n  ' + inItem(X) + '\n- two' },
        { name: 'an item holding a nested list',    source: '- abcd\n  - sub\n- two' },
        { name: 'a nested item',                    source: '- one\n  - abcd\n  - e\n- two' },
        { name: 'a nested item holding blocks',     source: '- one\n  - abcd\n\n    para\n  - e\n\n  outer\n- two' },
        { name: 'an item nested two levels deep',   source: '- one\n  - two\n    - abcd\n    - f\n  - g\n- h' },
        { name: 'a paragraph of an item',           source: '- one\n\n  abcd\n\n  more\n- two' },
        { name: 'a heading of an item',             source: '- one\n\n  ## abcd\n- two' },
        { name: 'a quote of an item',               source: '- one\n\n  > abcd\n- two' },
        { name: 'a paragraph of a nested item',     source: '- one\n  - sub\n\n    abcd\n  - e\n- two' },
        { name: 'a code block of an item',          source: '- one\n\n  ```\n  abcd\n  ```\n- two' },
        { name: 'a heading that opens an item',     source: '- ## abcd\n- two' },
        { name: 'an item in a ::: column',          source: cols('- abcd\n- two', 'Right') },
    ];

    const KINDS: readonly { name: string; from: TextPoint; to: TextPoint }[] = [
        { name: 'rows',  from: ['h1', 0], to: ['c2', 2] },
        { name: 'cells', from: ['c1', 0], to: ['c2', 2] },
    ];

    const OFFSETS: readonly number[] = [0, 2, 4];   // the start, the middle and the end of `abcd`

    const COMBINATIONS = SHAPES.flatMap((shape) => KINDS.flatMap((kind) => OFFSETS.map((offset) => ({ shape, kind, offset }))));

    it.each(COMBINATIONS)('R: $kind.name at offset $offset of the text of $shape.name', ({ shape, kind, offset }) => {
        const origin = load(T);
        const editor = load(shape.source);

        pasteAt(editor, copyRange(origin, kind.from, kind.to), ['abcd', offset]);

        expect(editor.getValue()).not.toBe(shape.source);
        expectSoundDocument(editor);

        undo(editor);

        expect(editor.getValue()).toBe(shape.source);
        expect(emptyContainers(editor)).toEqual([]);
    });
});

describe('one undo takes a paste of bare rows or cells back', () => {
    it('U1: after C1', () => {
        const source = T + '\n\n' + cols('Left', '');
        const editor = load(source);

        pasteAt(editor, copyRows(editor), 'empty-paragraph');
        undo(editor);

        expect(editor.getValue()).toBe(source);
        expect(columnChildTypes(editor)).toEqual(['paragraph', 'paragraph']);
        expect(emptyContainers(editor)).toEqual([]);
    });

    it('U2: after D1', () => {
        const source = cols(T, 'Right');
        const editor = load(source);

        pasteAt(editor, copyRows(editor), ['c1', 1], ['Right', 2]);
        undo(editor);

        expect(editor.getValue()).toBe(source);
        expect(columnChildTypes(editor)).toEqual(['table', 'paragraph']);
        expect(emptyContainers(editor)).toEqual([]);
    });

    it('U3: after E1', () => {
        const source = T + '\n\nmid\n\n' + X;
        const editor = load(source);

        pasteAt(editor, copyRows(editor), ['y1', 1]);
        undo(editor);

        expect(editor.getValue()).toBe(source);
    });
});

describe('a copy that holds no bare row or cell pastes as before', () => {
    it('N1: a copy inside one cell is its text', () => {
        const editor = load(T + '\n\nafter');
        const nodes = copyRange(editor, ['c1', 0], ['c1', 2]);

        pasteAt(editor, nodes, ['after', 5]);

        expect(typesOf(nodes)).toEqual(['text']);
        expect(editor.getValue()).toBe(T + '\n\nafterc1');
    });

    it('N2: a copied table is left to Lexical', () => {
        const editor = load('before\n\n' + T + '\n\nafter\n\nTarget');
        const nodes = copyRange(editor, ['before', 3], ['after', 2]);

        pasteAt(editor, nodes, ['Target', 6]);

        expect(typesOf(nodes)).toEqual(['paragraph', 'table', 'paragraph']);
        expect(editor.getValue()).toBe('before\n\n' + T + '\n\nafter\n\nTargetore\n\n' + T + '\n\naf');
    });
});
