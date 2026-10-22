// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor keeps `:::` columns as it saves them
// (plans/markdown-columns-fixes.md): a block wrapped, pasted or typed into a
// column saves a fence the viewer reads as the editor shows it, and a column
// pasted outside a fence becomes the blocks it holds.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { $createRangeSelection, $getRoot, $getSelection, $isTextNode, $setSelection } from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode, TextNode } from 'lexical';
import { $generateJSONFromSelectedNodes, $generateNodesFromSerializedNodes, $insertGeneratedNodes } from '@lexical/clipboard';
import { $isTableCellNode } from '@lexical/table';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { canonicalSave } from './markdown-roundtrip/harness';
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

/** Nodes copied as Lexical's clipboard serializes them. */
type CopiedNodes = Parameters<typeof $generateNodesFromSerializedNodes>[0];

/** A point in the document: the exact text of a text node, and an offset in it. */
type TextPoint = readonly [text: string, offset: number];

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
 * Selects from `anchor` to `focus`, each a text point.
 *
 * @param editor - The editor.
 * @param anchor - The anchor.
 * @param focus - The focus.
 */
function selectText(editor: MarkdownEditor, anchor: TextPoint, focus: TextPoint): void {
    update(editor, () => {
        const selection = $createRangeSelection();

        selection.anchor.set($textNode(anchor[0]).getKey(), anchor[1], 'text');
        selection.focus.set($textNode(focus[0]).getKey(), focus[1], 'text');
        $setSelection(selection);
    });
}

/**
 * Copies the selection as Lexical's clipboard does.
 *
 * @param editor - The editor.
 * @returns The copied nodes.
 */
function copySelection(editor: MarkdownEditor): CopiedNodes {
    const lexical = lexicalOf(editor);

    return lexical.read(() => $generateJSONFromSelectedNodes(lexical, $getSelection()).nodes);
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
 * Copies from `from` to `to`, then pastes at `at`.
 *
 * @param editor - The editor.
 * @param from - The copy's anchor.
 * @param to - The copy's focus.
 * @param at - Where the paste goes.
 */
function copyAndPaste(editor: MarkdownEditor, from: TextPoint, to: TextPoint, at: TextPoint): void {
    selectText(editor, from, to);

    const nodes = copySelection(editor);

    selectText(editor, at, at);
    pasteNodes(editor, nodes);
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
 * Counts the `:::` columns that stand outside a fence.
 *
 * @param editor - The editor.
 * @returns The count.
 */
function strayColumns(editor: MarkdownEditor): number {
    return nodesOf(editor).filter(({ type, parent }) => type === 'markdown-column' && parent !== 'markdown-block').length;
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
 * The kinds of the blocks the viewer reads in the editor's save, a fence
 * followed by the kinds of its columns' blocks — for a save holding a raw
 * block, which the editor shows as source and the viewer as what it reads.
 *
 * @param editor - The editor.
 * @returns The block kinds.
 */
function viewerBlockKinds(editor: MarkdownEditor): string[] {
    return viewerModel(editor.getValue()).blocks.map((block) => (block.kind === 'fence'
        ? `fence(${block.columns.flat().map((inner) => inner.kind).join(',')})`
        : block.kind));
}

/**
 * Puts the caret at the document's start.
 *
 * @param editor - The editor.
 */
function caretAtStart(editor: MarkdownEditor): void {
    update(editor, () => {
        $getRoot().selectStart();
    });
}

describe('wrapping a block in a fence saves the fence the viewer reads', () => {
    it('W1: a code block holding a ::: line', () => {
        const editor = load('```\n:::\n```');

        caretAtStart(editor);
        editor.setBlockAlignment('center');

        expect(editor.getValue()).toBe('::: {align=center}\n```\n:::\n```\n:::');
        expectParity(editor);
    });

    it('W2: a long code fence holding a shorter run', () => {
        const editor = load('````\naaa\n```\n````');

        caretAtStart(editor);
        editor.setColumnCount(2);

        expect(editor.getValue()).toBe('::: columns\n````\naaa\n```\n````\n|||\n\n:::');
        expectParity(editor);
    });

    it('W3: an HTML block holding a ::: line becomes a paragraph of its text', () => {
        const editor = load('<div>\n:::\n</div>');

        caretAtStart(editor);
        editor.setBlockAlignment('center');

        expect(editor.getValue()).toBe('::: {align=center}\n\\<div>\\\n\\:::\\\n\\</div>\n:::');
        expect(columnChildTypes(editor)).toEqual(['paragraph']);
        expectParity(editor);
    });

    it('W4: an HTML block holding a ::: x line becomes a paragraph of its text', () => {
        const editor = load('<div>\n::: x\n</div>');

        caretAtStart(editor);
        editor.setColumnCount(2);

        expect(editor.getValue()).toBe('::: columns\n\\<div>\\\n\\::: x\\\n\\</div>\n|||\n\n:::');
        expectParity(editor);
    });

    it('W5: an HTML block holding a code fence it leaves open becomes a paragraph of its text', () => {
        const editor = load('<div>\n```\n</div>');

        caretAtStart(editor);
        editor.setColumnCount(2);

        expect(editor.getValue()).toBe('::: columns\n\\<div>\\\n\\`\\`\\`\\\n\\</div>\n|||\n\n:::');
        expectParity(editor);
    });

    it('W6: an HTML block holding a ||| line stays raw, its separator escaped', () => {
        const editor = load('<div>\n|||\n</div>');

        caretAtStart(editor);
        editor.setColumnCount(2);

        expect(editor.getValue()).toBe('::: columns\n<div>\n\\|||\n</div>\n|||\n\n:::');
        expect(columnChildTypes(editor)).toEqual(['markdown-raw-block', 'paragraph']);
        expectParity(editor);
    });

    it('W7: a list kept as source holding an indented ::: line becomes a paragraph of its text', () => {
        const editor = load('- a\n\n  b\n  :::');

        caretAtStart(editor);
        editor.setColumnCount(2);

        expect(editor.getValue()).toBe('::: columns\n\\- a\\\n\\\nb\\\n\\:::\n|||\n\n:::');
        expectParity(editor);
    });

    it('W8: a code block holding an indented fence-like run gets a fence longer than it', () => {
        const editor = load('````\n    ````\n:::\n````');

        caretAtStart(editor);
        editor.setBlockAlignment('center');

        expect(editor.getValue()).toBe('::: {align=center}\n`````\n    ````\n:::\n`````\n:::');
        expectParity(editor);
    });
});

describe('wrapping a list whose item opens a block on its marker line', () => {
    it('W9: a list item starting with a code block stays raw, and the fence reads past it', () => {
        const editor = load('- ```\n  :::\n  ```');

        caretAtStart(editor);
        editor.setBlockAlignment('center');

        expect(editor.getValue()).toBe('::: {align=center}\n- ```\n  :::\n  ```\n:::');
        expect(columnChildTypes(editor)).toEqual(['markdown-raw-block']);
        expect(viewerBlockKinds(editor)).toEqual(['fence(list)']);
    });

    it('W10: a list item starting with a fence stays raw, and the outer fence reads past its closer', () => {
        const editor = load('- ::: {align=right}\n  x\n  :::\n\nafter');

        caretAtStart(editor);
        editor.setBlockAlignment('center');

        expect(editor.getValue()).toBe('::: {align=center}\n- ::: {align=right}\n  x\n  :::\n:::\n\nafter');
        expect(columnChildTypes(editor)).toEqual(['markdown-raw-block']);
        expect(viewerBlockKinds(editor)).toEqual(['fence(list)', 'paragraph']);
    });
});

describe('typing into a raw block in a column', () => {
    it('T1: typing a ::: line into an HTML block in a column shows and saves it as a paragraph', () => {
        const editor = load('::: {align=center}\n<div>\nx\n</div>\n:::');

        expect(columnChildTypes(editor)).toEqual(['markdown-raw-block']);

        update(editor, () => {
            $textNode('x').setTextContent(':::');
        });

        expect(editor.getValue()).toBe('::: {align=center}\n\\<div>\\\n\\:::\\\n\\</div>\n:::');
        expect(columnChildTypes(editor)).toEqual(['paragraph']);
        expectParity(editor);
    });
});

describe('pasting a selection that spans columns', () => {
    it('P1: into a column, the pasted columns become their blocks', () => {
        const editor = load('::: columns\nLeft\n|||\nRight\n:::');

        copyAndPaste(editor, ['Left', 1], ['Right', 2], ['Right', 5]);

        expect(editor.getValue()).toBe('::: columns\nLeft\n|||\nRight\n\neft\n\nRi\n:::');
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('P2: into a top-level paragraph, the pasted columns become their blocks', () => {
        const editor = load('::: columns\nLeft\n|||\nRight\n:::\n\npara');

        copyAndPaste(editor, ['Left', 1], ['Right', 2], ['para', 2]);

        expect(editor.getValue()).toBe('::: columns\nLeft\n|||\nRight\n:::\n\npa\n\neft\n\nRi\n\nra');
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'paragraph', 'paragraph', 'paragraph', 'paragraph']);
        expectParity(editor);
    });

    it('P3: into a list item, the pasted columns become their blocks', () => {
        const editor = load('- item\n\n::: columns\nLeft\n|||\nRight\n:::');

        copyAndPaste(editor, ['Left', 1], ['Right', 2], ['item', 2]);

        expect(editor.getValue()).toBe('- it\n\neft\n\nRiem\n\n::: columns\nLeft\n|||\nRight\n:::');
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('P4: a selection from a column to a block after the fence pastes as a nested fence', () => {
        const editor = load('::: columns\nLeft\n|||\nRight\n:::\n\npara');

        copyAndPaste(editor, ['Left', 0], ['para', 2], ['Right', 3]);

        expect(editor.getValue()).toBe('::: columns\nLeft\n|||\nRig\n\n::: columns\nLeft\n|||\nRight\n:::\n\npaht\n:::\n\npara');
        expectParity(editor);
    });

    it('P5: a raw block holding a ::: line pasted into a column becomes a paragraph of its text', () => {
        const editor = load('z\n\n<div>\n:::\n</div>\n\n::: {align=center}\nA\n:::');

        copyAndPaste(editor, ['z', 0], ['</div>', 6], ['A', 1]);

        expect(editor.getValue()).toBe('z\n\n<div>\n:::\n</div>\n\n::: {align=center}\nAz\n\n\\<div>\\\n\\:::\\\n\\</div>\n:::');
        expect(columnChildTypes(editor)).toEqual(['paragraph', 'paragraph']);
        expectParity(editor);
    });

    it('P6: into a table cell, the pasted columns become the cell\'s paragraphs', () => {
        const editor = load('::: columns\nLeft\n|||\nRight\n:::\n\n| h1 | h2 |\n| --- | --- |\n| c1 | c2 |');

        copyAndPaste(editor, ['Left', 1], ['Right', 2], ['c1', 1]);

        expect(editor.getValue()).toBe('::: columns\nLeft\n|||\nRight\n:::\n\n| h1 | h2 |\n| --- | --- |\n| c\\n\\neft\\n\\nRi\\n\\n1 | c2 |');

        const cellChildren = lexicalOf(editor).read(() => {
            const cell = $dfs($getRoot()).map(({ node }) => node).filter($isTableCellNode)[2]!;

            return cell.getChildren().map((child) => ({
                type:   child.getType(),
                nested: (child as ElementNode).getChildren().filter((grandchild) => grandchild.getType() === 'paragraph').length,
            }));
        });

        expect(cellChildren).toEqual(Array.from({ length: 4 }, () => ({ type: 'paragraph', nested: 0 })));
        expectParity(editor);
    });
});

describe('a loaded raw block in a column', () => {
    it('G1: an HTML block that keeps its column stays raw and saves as loaded', () => {
        const source = '::: {align=center}\n<div>\nx\n</div>\n:::';
        const editor = load(source);

        expect(editor.getValue()).toBe(source);
        expect(columnChildTypes(editor)).toEqual(['markdown-raw-block']);
    });
});

describe('an unedited block that opens a fence it does not close', () => {
    it('K1: is written escaped once a block pasted after it would close the fence', () => {
        const editor = load('q\n\n<div>\n:::\n</div>\n\n::: {align=center}\nA\n\nz');

        copyAndPaste(editor, ['q', 0], ['</div>', 6], ['z', 1]);

        expect(editor.getValue()).toBe('q\n\n<div>\n:::\n</div>\n\n\\::: {align=center}\nA\n\nzq\n\n<div>\n:::\n</div>');
        expectParity(editor);
    });
});

describe('a code block\'s fence', () => {
    it('SC1: outruns an indented run of its own character', () => {
        const editor = load('~~~\n    ```\n~~~');

        expect(canonicalSave(editor)).toBe('````\n    ```\n````');
    });
});
