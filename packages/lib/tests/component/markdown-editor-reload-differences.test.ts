// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createRangeSelection, $getRoot, $getState, $isElementNode, $isTextNode, $setCompositionKey, $setSelection, CONTROLLED_TEXT_INSERTION_COMMAND,
    DELETE_CHARACTER_COMMAND, INDENT_CONTENT_COMMAND, INSERT_LINE_BREAK_COMMAND, INSERT_PARAGRAPH_COMMAND, OUTDENT_CONTENT_COMMAND, PASTE_COMMAND,
    UNDO_COMMAND,
} from 'lexical';
import type { LexicalEditor, LexicalNode } from 'lexical';
import { $isListItemNode, $isListNode } from '@lexical/list';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { listLooseState } from '~/component/editor/markdownNodeState';
import { $createMarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

function load(source: string): MarkdownEditor {
    const editor = new MarkdownEditor();

    editor.setValue(source);

    return editor;
}

/** The document as a tree: each text as written, each list with its looseness, each block with an indent it carries. */
function tree(node: LexicalNode): string {
    const isText = $isTextNode(node);
    const isList = $isListNode(node);
    const isElement = $isElementNode(node);

    if (isText) {
        return JSON.stringify(node.getTextContent());
    }

    if (isList) {
        const looseness = $getState(node, listLooseState) ? 'loose' : 'tight';

        return `${looseness}(${node.getChildren().map(tree).join(', ')})`;
    }

    if (isElement) {
        const isIndented = !$isListItemNode(node) && node.getType() !== 'markdown-list-item-text' && node.getIndent() !== 0;

        return `${node.getType()}${isIndented ? '[indented]' : ''}(${node.getChildren().map(tree).join(', ')})`;
    }

    return node.getType();
}

function shown(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => $getRoot().getChildren().map(tree).join(' | '));
}

/** Selects from `offset` in the text node reading `from` to `toOffset` in the one reading `to`; `-1` is a text's end. */
function select(editor: MarkdownEditor, from: string, offset: number, to: string = from, toOffset: number = offset): void {
    lexicalOf(editor).update(() => {
        const texts = $getRoot().getAllTextNodes();
        const anchor = texts.find((node) => node.getTextContent() === from)!;
        const focus = texts.find((node) => node.getTextContent() === to)!;
        const selection = $createRangeSelection();

        selection.anchor.set(anchor.getKey(), offset < 0 ? anchor.getTextContentSize() : offset, 'text');
        selection.focus.set(focus.getKey(), toOffset < 0 ? focus.getTextContentSize() : toOffset, 'text');
        $setSelection(selection);
    }, { discrete: true });
}

function type(editor: MarkdownEditor, text: string): void {
    lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, text);
}

function deleteSelection(editor: MarkdownEditor): void {
    lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
}

/** Checks what the editor shows and saves, and that a load of the save shows the same. */
function expectShownAndReloaded(editor: MarkdownEditor, expectedTree: string, expectedSave: string): void {
    const saved = editor.getValue();

    expect(shown(editor)).toBe(expectedTree);
    expect(saved).toBe(expectedSave);
    expect(shown(load(saved))).toBe(expectedTree);
}

describe('the editor shows what its save reloads to: text typed in the block a raw block of a list item comes to be', () => {
    /** Whether the first list of the editor is loose or tight. */
    function looseness(editor: MarkdownEditor): string {
        return lexicalOf(editor).read(() => ($getState($getRoot().getChildren().find($isListNode)!, listLooseState) ? 'loose' : 'tight'));
    }

    // A raw block that holds nothing but blanks writes nothing, so an edit that leaves one shows an empty paragraph instead
    // (`$showBlankRawBlockAsParagraph`), and the looseness rule for a further paragraph keeps its list as the save reads it.
    it('L1: text typed into the block a raw block emptied leaves makes the list loose', () => {
        const editor = load('- a\n\n  <div>');

        // The raw block's text goes, then a space is typed: the block writes nothing, and its one-item list is tight.
        select(editor, '<div>', 0, '<div>', -1);
        deleteSelection(editor);
        type(editor, ' ');

        expect(looseness(editor)).toBe('tight');
        expect(editor.getValue()).toBe('- a');

        select(editor, ' ', 1);
        type(editor, '<p>');

        expect(looseness(editor)).toBe('loose');
        expect(editor.getValue()).toBe('- a\n\n  \\<p>');
        expect(looseness(load(editor.getValue()))).toBe('loose');
    });

    it('L2: the same in a list of several items, whose save then sets its items apart', () => {
        const editor = load('- a\n- b\n- c');

        lexicalOf(editor).update(() => {
            const item = $getRoot().getAllTextNodes()[0]!.getParents().find($isListItemNode)!;

            item.append($createMarkdownRawBlockNode(' '));
        }, { discrete: true });
        select(editor, ' ', 1);
        type(editor, '<div>');

        expect(looseness(editor)).toBe('loose');
        expect(editor.getValue()).toBe('- a\n\n  \\<div>\n\n- b\n\n- c');
        expect(looseness(load(editor.getValue()))).toBe('loose');
    });

    it('L3: a raw block deleted down to a space leaves its one-item list tight', () => {
        const editor = load('- a\n\n  <div>');

        select(editor, '<div>', -1);
        type(editor, ' ');
        select(editor, '<div> ', 0, '<div> ', 5);
        deleteSelection(editor);

        expect(looseness(editor)).toBe('tight');
        expect(editor.getValue()).toBe('- a');
        expect(looseness(load(editor.getValue()))).toBe('tight');
    });

    it('L4: a letter typed in a raw block that already writes changes no looseness', () => {
        const editor = load('- a\n\n  <div>\n- b');

        select(editor, '<div>', 5);
        type(editor, 'x');

        expectShownAndReloaded(editor, 'loose(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block("<div>x")), markdown-list-item(markdown-list-item-text("b")))', '- a\n\n  <div>x\n\n- b');
    });
});

describe('the editor shows what its save reloads to: a line break in a table cell', () => {
    const TABLE = '| t0 |\n| --- |\n| t1 |';
    const cells = (...body: string[]): string => `table(tablerow(tablecell(paragraph("t0"))), tablerow(tablecell(${body.join(', ')})))`;

    it('C1: Shift+Enter inside a cell keeps a line break, saved as <br>', () => {
        const editor = load(TABLE);

        select(editor, 't1', 1);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

        expectShownAndReloaded(editor, cells('paragraph("t", linebreak, "1")'), '| t0 |\n| --- |\n| t<br>1 |');
    });

    it('C2: text typed after Shift+Enter at a cell\'s end follows the break, and two undos give the cell back', () => {
        const editor = load(TABLE);

        select(editor, 't1', -1);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
        type(editor, 'y');

        expectShownAndReloaded(editor, cells('paragraph("t1", linebreak, "y")'), '| t0 |\n| --- |\n| t1<br>y |');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(TABLE);
    });

    it('C3: Shift+Enter in a paragraph outside a table still makes a hard break', () => {
        const editor = load('ab');

        select(editor, 'ab', 1);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

        expectShownAndReloaded(editor, 'paragraph("a", linebreak, "b")', 'a\\\nb');
    });

    it('C4: Enter inside a cell still makes a new paragraph of the cell, saved as the cell paragraph break', () => {
        const editor = load(TABLE);

        select(editor, 't1', 1);
        lexicalOf(editor).dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);

        expectShownAndReloaded(editor, cells('paragraph("t")', 'paragraph("1")'), '| t0 |\n| --- |\n| t\\n\\n1 |');
    });

    it.each([
        ['<br>'], ['<br/>'], ['<br />'], ['<BR>'],
    ])('C5: a cell\'s %s loads as a line break, and an edit of the cell saves it as <br>', (tag) => {
        const source = `| t0 |\n| --- |\n| a${tag}b |`;
        const editor = load(source);

        expect(shown(editor)).toBe(cells('paragraph("a", linebreak, "b")'));
        expect(editor.getValue()).toBe(source);

        select(editor, 'b', 1);
        type(editor, 'x');

        expectShownAndReloaded(editor, cells('paragraph("a", linebreak, "bx")'), '| t0 |\n| --- |\n| a<br>bx |');
    });

    it.each([
        ['in a code span of a cell', '| t0 |\n| --- |\n| `a<br>b` |', cells('paragraph("a<br>b")')],
        ['escaped in a cell', '| t0 |\n| --- |\n| a\\<br>b |', cells('paragraph("a<br>b")')],
        ['outside a table', 'a<br>b', 'paragraph("a", "<br>", "b")'],
    ])('C6: a <br> %s stays text', (_name, source, expectedTree) => {
        const editor = load(source);

        expect(shown(editor)).toBe(expectedTree);
        expect(editor.getValue()).toBe(source);
    });

    it('C7: the text <br> typed into a cell is saved escaped and reloads as text', () => {
        const editor = load(TABLE);

        select(editor, 't1', 1);
        type(editor, '<br>');

        expectShownAndReloaded(editor, cells('paragraph("t<br>1")'), '| t0 |\n| --- |\n| t\\<br>1 |');
    });
});

describe('the editor shows what its save reloads to: a line end inside a text', () => {
    it('N1: a code block of two lines made a paragraph holds a line break', () => {
        const editor = load('```\na\nb\n```');

        lexicalOf(editor).update(() => { $getRoot().getAllTextNodes()[0]!.select(1, 1); }, { discrete: true });
        editor.setBlockType('paragraph');

        expectShownAndReloaded(editor, 'paragraph("a", linebreak, "b")', 'a\\\nb');
    });

    it('N2: a code block of two lines made a list item holds a line break', () => {
        const editor = load('```\na\nb\n```');

        lexicalOf(editor).update(() => { $getRoot().getAllTextNodes()[0]!.select(1, 1); }, { discrete: true });
        editor.toggleUnorderedList();

        expectShownAndReloaded(editor, 'tight(markdown-list-item(markdown-list-item-text("a", linebreak, "b")))', '- a\\\n  b');
    });

    it('N3: a code block keeps its line ends as text', () => {
        const editor = load('```\na\nb\n```');

        lexicalOf(editor).update(() => { $getRoot().getAllTextNodes()[0]!.select(1, 1); }, { discrete: true });
        type(editor, 'x');

        expectShownAndReloaded(editor, 'code("axb")'.replace('axb', 'ax\\nb'), '```\nax\nb\n```');
    });
});

describe('the editor shows what its save reloads to: an indent', () => {
    it('I1: the indent command leaves a paragraph as it is, and adds no undo step', () => {
        const editor = load('p0\n\np1');

        select(editor, 'p1', 1);
        type(editor, 'x');
        lexicalOf(editor).dispatchCommand(INDENT_CONTENT_COMMAND, undefined);

        expectShownAndReloaded(editor, 'paragraph("p0") | paragraph("px1")', 'p0\n\npx1');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe('p0\n\np1');
    });

    it('I2: over a list item and a paragraph it moves the item alone, in one undo step', () => {
        const editor = load('- a\n- b\n\np0');

        select(editor, 'b', 1, 'p0', 1);
        lexicalOf(editor).dispatchCommand(INDENT_CONTENT_COMMAND, undefined);

        expectShownAndReloaded(editor, 'tight(markdown-list-item(markdown-list-item-text("a"), tight(markdown-list-item(markdown-list-item-text("b"))))) | paragraph("p0")', '- a\n  - b\n\np0');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe('- a\n- b\n\np0');
    });

    it('I3: a further paragraph of an item takes none either', () => {
        const editor = load('- a\n\n  more\n- b');

        select(editor, 'more', 1);
        lexicalOf(editor).dispatchCommand(INDENT_CONTENT_COMMAND, undefined);

        expectShownAndReloaded(editor, 'loose(markdown-list-item(markdown-list-item-text("a"), paragraph("more")), markdown-list-item(markdown-list-item-text("b")))', '- a\n\n  more\n- b');
    });

    it('I4: the indent and outdent of a list item move it as before', () => {
        const editor = load('- a\n- b');

        select(editor, 'b', 1);
        lexicalOf(editor).dispatchCommand(INDENT_CONTENT_COMMAND, undefined);

        expect(editor.getValue()).toBe('- a\n  - b');

        lexicalOf(editor).dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);

        expect(editor.getValue()).toBe('- a\n- b');
    });
});
