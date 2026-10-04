// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor keeps `:::` columns as it saves them
// (plans/markdown-columns-fixes.md): a block wrapped, pasted or typed into a
// column saves a fence the viewer reads as the editor shows it, and a column
// pasted outside a fence becomes the blocks it holds. Those blocks paste as
// any pasted blocks do, joining the paragraph at the caret
// (plans/markdown-editor-column-paste.md).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    $createParagraphNode, $createRangeSelection, $getRoot, $getSelection, $isRangeSelection, $isTextNode, $setSelection, UNDO_COMMAND,
} from 'lexical';
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

        expect(editor.getValue()).toBe('::: columns\nLeft\n|||\nRighteft\n\nRi\n:::');
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('P2: into a top-level paragraph, the pasted columns become their blocks', () => {
        const editor = load('::: columns\nLeft\n|||\nRight\n:::\n\npara');

        copyAndPaste(editor, ['Left', 1], ['Right', 2], ['para', 2]);

        expect(editor.getValue()).toBe('::: columns\nLeft\n|||\nRight\n:::\n\npaeft\n\nRira');
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'paragraph', 'paragraph']);
        expectParity(editor);
    });

    it('P3: into a list item, the pasted columns become their blocks', () => {
        const editor = load('- item\n\n::: columns\nLeft\n|||\nRight\n:::');

        copyAndPaste(editor, ['Left', 1], ['Right', 2], ['item', 2]);

        expect(editor.getValue()).toBe('- iteft\n\nRiem\n\n::: columns\nLeft\n|||\nRight\n:::');
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

        expect(editor.getValue()).toBe('::: columns\nLeft\n|||\nRight\n:::\n\n| h1 | h2 |\n| --- | --- |\n| ceft\\n\\nRi1 | c2 |');

        const cellChildren = lexicalOf(editor).read(() => {
            const cell = $dfs($getRoot()).map(({ node }) => node).filter($isTableCellNode)[2]!;

            return cell.getChildren().map((child) => ({
                type:   child.getType(),
                nested: (child as ElementNode).getChildren().filter((grandchild) => grandchild.getType() === 'paragraph').length,
            }));
        });

        expect(cellChildren).toEqual(Array.from({ length: 2 }, () => ({ type: 'paragraph', nested: 0 })));
        expectParity(editor);
    });
});

describe('pasting a selection that spans columns joins the paragraph at the caret', () => {
    // The two-column fence the rows copy from.
    const FENCE = '::: columns\nLeft\n|||\nRight\n:::';

    it('C1: at a paragraph\'s end, the first pasted block joins it and no empty paragraph is left', () => {
        const editor = load(FENCE + '\n\nBelow para');

        copyAndPaste(editor, ['Left', 2], ['Right', 3], ['Below para', 10]);

        expect(editor.getValue()).toBe(FENCE + '\n\nBelow paraft\n\nRig');
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'paragraph', 'paragraph']);
        expect(caretAt(editor)).toEqual(['Rig', 3]);
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('C2: inside a paragraph, each half joins the pasted block next to it', () => {
        const editor = load(FENCE + '\n\npara');

        copyAndPaste(editor, ['Left', 2], ['Right', 3], ['para', 2]);

        expect(editor.getValue()).toBe(FENCE + '\n\npaft\n\nRigra');
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'paragraph', 'paragraph']);
        expect(caretAt(editor)).toEqual(['Rigra', 3]);
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('C3: at a paragraph\'s start, the last pasted block takes the paragraph in', () => {
        const editor = load(FENCE + '\n\npara');

        copyAndPaste(editor, ['Left', 2], ['Right', 3], ['para', 0]);

        expect(editor.getValue()).toBe(FENCE + '\n\nft\n\nRigpara');
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'paragraph', 'paragraph']);
        expect(caretAt(editor)).toEqual(['Rigpara', 3]);
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('C4: in a table cell, the cell\'s paragraph joins the pasted blocks', () => {
        const editor = load(FENCE + '\n\n| h1 | h2 |\n| --- | --- |\n| c1 | c2 |');

        copyAndPaste(editor, ['Left', 2], ['Right', 3], ['c1', 1]);

        expect(editor.getValue()).toBe(FENCE + '\n\n| h1 | h2 |\n| --- | --- |\n| cft\\n\\nRig1 | c2 |');

        const cellChildTypes = lexicalOf(editor).read(() => {
            const cell = $dfs($getRoot()).map(({ node }) => node).filter($isTableCellNode)[2]!;

            return cell.getChildren().map((child) => child.getType());
        });

        expect(cellChildTypes).toEqual(['paragraph', 'paragraph']);
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('C5: inside a paragraph of another fence\'s column', () => {
        const editor = load(FENCE + '\n\n::: columns\nAA\n|||\nBB\n:::');

        copyAndPaste(editor, ['Left', 2], ['Right', 3], ['AA', 1]);

        expect(editor.getValue()).toBe(FENCE + '\n\n::: columns\nAft\n\nRigA\n|||\nBB\n:::');
        expect(columnChildTypes(editor)).toEqual(Array.from({ length: 5 }, () => 'paragraph'));
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('C6: at the end of a column\'s paragraph, no empty paragraph is left in the column', () => {
        const editor = load(FENCE + '\n\n::: columns\nAA\n|||\nBB\n:::');

        copyAndPaste(editor, ['Left', 2], ['Right', 3], ['BB', 2]);

        expect(editor.getValue()).toBe(FENCE + '\n\n::: columns\nAA\n|||\nBBft\n\nRig\n:::');
        expect(columnChildTypes(editor)).toEqual(Array.from({ length: 5 }, () => 'paragraph'));
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('C7: two columns copied whole', () => {
        const editor = load(FENCE + '\n\npara');

        copyAndPaste(editor, ['Left', 0], ['Right', 5], ['para', 4]);

        expect(editor.getValue()).toBe(FENCE + '\n\nparaLeft\n\nRight');
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'paragraph', 'paragraph']);
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('C8: a selection across three columns', () => {
        const source = '::: columns\nLeft\n|||\nMid\n|||\nRight\n:::';
        const editor = load(source + '\n\npara');

        copyAndPaste(editor, ['Left', 2], ['Right', 3], ['para', 4]);

        expect(editor.getValue()).toBe(source + '\n\nparaft\n\nMid\n\nRig');
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'paragraph', 'paragraph', 'paragraph']);
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('C9: columns holding several paragraphs', () => {
        const source = '::: columns\nL1\n\nL2\n|||\nR1\n\nR2\n:::';
        const editor = load(source + '\n\npara');

        copyAndPaste(editor, ['L1', 1], ['R2', 1], ['para', 4]);

        expect(editor.getValue()).toBe(source + '\n\npara1\n\nL2\n\nR1\n\nR');
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'paragraph', 'paragraph', 'paragraph', 'paragraph']);
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('C10: the pasted text keeps its formatting', () => {
        const source = '::: columns\n**Left**\n|||\nRight\n:::';
        const editor = load(source + '\n\npara');

        copyAndPaste(editor, ['Left', 2], ['Right', 3], ['para', 4]);

        expect(editor.getValue()).toBe(source + '\n\npara**ft**\n\nRig');
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('C11: over a selected range, the pasted blocks replace it and join what is left', () => {
        const editor = load(FENCE + '\n\nabcdef');

        selectText(editor, ['Left', 2], ['Right', 3]);

        const nodes = copySelection(editor);

        selectText(editor, ['abcdef', 2], ['abcdef', 4]);
        pasteNodes(editor, nodes);

        expect(editor.getValue()).toBe(FENCE + '\n\nabft\n\nRigef');
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'paragraph', 'paragraph']);
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('C12: into a code block, each pasted paragraph is one line', () => {
        const source = '::: columns\nL1\n\nL2\n|||\nR1\n:::';
        const editor = load(source + '\n\n```\ncode\n```');

        copyAndPaste(editor, ['L1', 1], ['R1', 1], ['code', 4]);

        expect(editor.getValue()).toBe(source + '\n\n```\ncode1\nL2\nR\n```');
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'code']);
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('C13: over a range reaching into a table, the table goes and the pasted blocks join what is left', () => {
        const editor = load(FENCE + '\n\nbefore\n\n| h |\n| --- |\n| c |\n\nafter');

        selectText(editor, ['Left', 2], ['Right', 3]);

        const nodes = copySelection(editor);

        selectText(editor, ['before', 2], ['c', 1]);
        pasteNodes(editor, nodes);

        expect(editor.getValue()).toBe(FENCE + '\n\nbeft\n\nRig\n\nafter');
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'paragraph', 'paragraph', 'paragraph']);
        expect(caretAt(editor)).toEqual(['Rig', 3]);
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('U1: plain paragraphs paste the same way', () => {
        const editor = load('Alpha\n\nBeta\n\nTarget');

        copyAndPaste(editor, ['Alpha', 3], ['Beta', 2], ['Target', 6]);

        expect(editor.getValue()).toBe('Alpha\n\nBeta\n\nTargetha\n\nBe');
        expect(rootChildTypes(editor)).toEqual(Array.from({ length: 4 }, () => 'paragraph'));
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('U2: into an empty paragraph, the pasted blocks replace it', () => {
        const editor = load(FENCE);

        selectText(editor, ['Left', 2], ['Right', 3]);

        const nodes = copySelection(editor);

        update(editor, () => {
            const paragraph = $createParagraphNode();

            $getRoot().append(paragraph);
            paragraph.select();
        });

        pasteNodes(editor, nodes);

        expect(editor.getValue()).toBe(FENCE + '\n\nft\n\nRig');
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'paragraph', 'paragraph']);
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('U3: one undo takes the paste back', () => {
        const source = FENCE + '\n\nBelow para';
        const editor = load(source);

        copyAndPaste(editor, ['Left', 2], ['Right', 3], ['Below para', 10]);
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(source);
        expect(rootChildTypes(editor)).toEqual(['markdown-block', 'paragraph']);
        expect(strayColumns(editor)).toBe(0);
        expectParity(editor);
    });

    it('U4: a selection reaching outside the fence pastes the fence whole', () => {
        const editor = load('pre\n\n' + FENCE + '\n\npara');

        copyAndPaste(editor, ['pre', 1], ['Right', 3], ['para', 4]);

        expect(editor.getValue()).toBe('pre\n\n' + FENCE + '\n\nparare\n\n::: columns\nLeft\n|||\nRig\n:::');
        expect(strayColumns(editor)).toBe(0);
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
