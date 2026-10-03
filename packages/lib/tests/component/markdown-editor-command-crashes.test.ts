import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    $createRangeSelection, $getRoot, $isTextNode, $setSelection,
} from 'lexical';
import type { ElementNode, LexicalEditor, TextNode } from 'lexical';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $isMarkdownBlockNode } from '~/component/editor/markdownBlockNode';
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

    if (!$isTextNode(found)) {
        throw new Error(`no text node holds ${JSON.stringify(text)}`);
    }

    return found;
}

/**
 * Selects from `anchor` to `focus`, each a text node found by its exact text.
 *
 * @param editor - The editor.
 * @param anchor - The anchor's text node text and offset.
 * @param focus - The focus's text node text and offset.
 */
function selectText(editor: MarkdownEditor, anchor: TextPoint, focus: TextPoint): void {
    lexicalOf(editor).update(() => {
        const selection = $createRangeSelection();

        selection.anchor.set($textNode(anchor[0]).getKey(), anchor[1], 'text');
        selection.focus.set($textNode(focus[0]).getKey(), focus[1], 'text');
        $setSelection(selection);
    }, { discrete: true });
}

/**
 * Selects from `anchor`, a text point, to an element point on the first
 * paragraph of the second cell of the document's first table, which holds
 * no text node.
 *
 * @param editor - The editor.
 * @param anchor - The anchor's text node text and offset.
 */
function selectIntoSecondCell(editor: MarkdownEditor, anchor: TextPoint): void {
    lexicalOf(editor).update(() => {
        const row = ($getRoot().getFirstChild() as ElementNode).getFirstChild() as ElementNode;
        const paragraph = (row.getChildAtIndex(1) as ElementNode).getFirstChild() as ElementNode;
        const selection = $createRangeSelection();

        selection.anchor.set($textNode(anchor[0]).getKey(), anchor[1], 'text');
        selection.focus.set(paragraph.getKey(), 0, 'element');
        $setSelection(selection);
    }, { discrete: true });
}

/**
 * Selects from `anchor`, a text point, to the end of the last descendant of
 * the second column of the document's first `:::` block — the end of its
 * text, or an element point on its empty paragraph.
 *
 * @param editor - The editor.
 * @param anchor - The anchor's text node text and offset.
 */
function selectIntoSecondColumn(editor: MarkdownEditor, anchor: TextPoint): void {
    lexicalOf(editor).update(() => {
        const column = ($getRoot().getFirstChild() as ElementNode).getChildAtIndex(1) as ElementNode;
        const last = column.getLastDescendant()!;
        const selection = $createRangeSelection();

        selection.anchor.set($textNode(anchor[0]).getKey(), anchor[1], 'text');

        if ($isTextNode(last)) {
            selection.focus.set(last.getKey(), last.getTextContentSize(), 'text');
        } else {
            selection.focus.set(last.getKey(), 0, 'element');
        }

        $setSelection(selection);
    }, { discrete: true });
}

describe('setBlockAlignment / setColumnCount wrap the root child a selection reaches (B rows)', () => {
    it('B1: a selection into a second table cell aligns the whole table', () => {
        const editor = load('a||\n-|-');

        selectIntoSecondCell(editor, ['a', 0]);
        editor.setBlockAlignment('center');

        expect(editor.getValue()).toBe('::: {align=center}\n| a |  |\n| --- | --- |\n:::');
    });

    it('B2: a selection into a second table cell puts the whole table in columns', () => {
        const editor = load('a||\n-|-');

        selectIntoSecondCell(editor, ['a', 0]);
        editor.setColumnCount(2);

        expect(editor.getValue()).toBe('::: columns\n| a |  |\n| --- | --- |\n|||\n\n:::');
    });

    it('B3: a caret in a later table cell wraps the table, not the first block', () => {
        const editor = load('p\n\n|a|b|\n|-|-|\n|1|2|');

        selectText(editor, ['b', 0], ['b', 0]);
        editor.setBlockAlignment('center');

        expect(editor.getValue()).toBe('p\n\n::: {align=center}\n| a | b |\n| --- | --- |\n| 1 | 2 |\n:::');
    });

    it('B4: a selection from before a fence into a deep column line wraps the paragraph and the fence', () => {
        const editor = load('p\n\n::: columns\nA\n\nA2\n\nA3\n|||\nB\n:::');

        selectText(editor, ['p', 0], ['A3', 1]);
        editor.setBlockAlignment('center');

        expect(editor.getValue()).toBe('::: {align=center}\np\n\n::: columns\nA\n\nA2\n\nA3\n|||\nB\n:::\n:::');
        expect(lexicalOf(editor).read(() => $getRoot().getChildren().filter($isMarkdownBlockNode).length)).toBe(1);
        expect(lexicalOf(editor).read(() => $getRoot().getChildrenSize())).toBe(1);
    });

    it('B5: a selection across a fence\'s columns aligns that fence', () => {
        const editor = load('::: columns\nA\n|||\nB\n:::');

        selectText(editor, ['A', 0], ['B', 1]);
        editor.setBlockAlignment('center');

        expect(editor.getValue()).toBe('::: columns {align=center}\nA\n|||\nB\n:::');
    });
});

describe('setColumnCount unwraps a fence a selection spans the columns of (C rows)', () => {
    it('C1: dropping an empty second column holding the selection\'s end', () => {
        const editor = load('::: columns\nA\n\n# H\n|||\n\n:::');

        selectIntoSecondColumn(editor, ['A', 0]);
        editor.setColumnCount(1);

        expect(editor.getValue()).toBe('A\n\n# H');
        expect(() => editor.getSelectionState()).not.toThrow();
    });

    it('C2: clearing the column count with the selection\'s end in an empty second column', () => {
        const editor = load('::: columns\nA\n|||\n\n:::');

        selectIntoSecondColumn(editor, ['A', 0]);
        editor.setColumnCount(null);

        expect(editor.getValue()).toBe('A');
        expect(() => editor.getSelectionState()).not.toThrow();
    });

    it('C3: merging a second column holding the selection\'s end', () => {
        const editor = load('::: columns\nA\n|||\nB\n:::');

        selectIntoSecondColumn(editor, ['A', 0]);
        editor.setColumnCount(1);

        expect(editor.getValue()).toBe('A\n\nB');
        expect(() => editor.getSelectionState()).not.toThrow();
    });

    it('C4: unwrapping a fence whose selection ends after its middle column\'s last block', () => {
        const editor = load('::: columns\nA\n|||\nB\n\nB2\n|||\nC\n:::');

        lexicalOf(editor).update(() => {
            const column = ($getRoot().getFirstChild() as ElementNode).getChildAtIndex(1) as ElementNode;
            const selection = $createRangeSelection();

            selection.anchor.set($textNode('B').getKey(), 0, 'text');
            selection.focus.set(column.getKey(), column.getChildrenSize(), 'element');
            $setSelection(selection);
        }, { discrete: true });
        editor.setColumnCount(1);

        expect(editor.getValue()).toBe('A\n\nB\n\nB2\n\nC');
        expect(() => editor.getSelectionState()).not.toThrow();
    });
});
