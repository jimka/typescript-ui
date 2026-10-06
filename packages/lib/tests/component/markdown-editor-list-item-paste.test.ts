// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor keeps a block an edit leaves in a list item
// (plans/markdown-editor-list-item-block-paste.md): pasting several blocks
// into a nested list item, or inserting a line after a nested list, puts a
// block inside the outer item. The save writes it, the viewer reads it as the
// editor shows it, and loading the save shows the same document — the list
// stays a list.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createRangeSelection, $getRoot, $getSelection, $isElementNode, $isTextNode, $setSelection, CONTROLLED_TEXT_INSERTION_COMMAND, DROP_COMMAND,
    PASTE_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { LexicalEditor, LexicalNode, TextNode } from 'lexical';
import { $generateJSONFromSelectedNodes, $generateNodesFromSerializedNodes, $insertGeneratedNodes } from '@lexical/clipboard';
import { $createListItemNode, $createListNode } from '@lexical/list';
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
    vi.unstubAllGlobals();
});

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

/** The clipboard type Lexical writes its copied nodes under. */
const LEXICAL_CLIPBOARD_TYPE = 'application/x-lexical-editor';

/**
 * A data transfer holding copied nodes as Lexical's copy writes them.
 *
 * @param editor - The editor the nodes are for.
 * @param nodes - The copied nodes.
 * @returns The data transfer.
 */
function transferOf(editor: MarkdownEditor, nodes: CopiedNodes): DataTransfer {
    const data: Record<string, string> = {
        [LEXICAL_CLIPBOARD_TYPE]: JSON.stringify({ namespace: lexicalOf(editor)._config.namespace, nodes }),
    };

    return { types: Object.keys(data), files: [], getData: (type: string) => data[type] ?? '' } as unknown as DataTransfer;
}

/**
 * Pastes copied nodes at the selection as Ctrl/Cmd+V does: a `PASTE_COMMAND`
 * whose clipboard holds the nodes as Lexical's copy wrote them.
 *
 * @param editor - The editor.
 * @param nodes - The copied nodes.
 */
function pasteNodes(editor: MarkdownEditor, nodes: CopiedNodes): void {
    const lexical = lexicalOf(editor);

    // `registerRichText`'s paste handler tells clipboard, drag, input and key events apart by class name.
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
    vi.stubGlobal('DragEvent', class DragEvent {});
    vi.stubGlobal('InputEvent', class InputEvent {});
    vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});

    const event = Object.assign(new ClipboardEvent('paste'), { clipboardData: transferOf(editor, nodes), preventDefault: () => {} });

    update(editor, () => {
        lexical.dispatchCommand(PASTE_COMMAND, event);
    });
}

/** A document a paste goes into: every target holds one text node `bcd`, the paste's place. */
interface Target {
    readonly name:   string;
    readonly source: string;
}

/** What a paste inserts: the nodes copied from `from` to `to` in a document of its own. */
interface Clipboard {
    readonly name:   string;
    readonly source: string;
    readonly from:   TextPoint;
    readonly to:     TextPoint;
    /** The Lexical types of the copied top-level nodes. */
    readonly types:  readonly string[];
}

const TOP_LEVEL: Target = { name: 'top-level item', source: '- bcd\n- z' };
const NESTED: Target = { name: 'nested item', source: '- a\n  - bcd\n  - e\n- f' };
const ORDERED: Target = { name: 'ordered nested item', source: '1. a\n   1. bcd\n   2. e\n2. f' };
const TASK: Target = { name: 'task nested item', source: '- [ ] a\n  - [x] bcd\n- [ ] f' };
const LOOSE: Target = { name: 'loose nested item', source: '- a\n\n  - bcd\n\n- f' };

const TARGETS: readonly Target[] = [TOP_LEVEL, NESTED, ORDERED, TASK, LOOSE];

const PARAGRAPHS: Clipboard = { name: 'paragraphs', source: 'P1\n\nP2', from: ['P1', 0], to: ['P2', 2], types: ['paragraph', 'paragraph'] };
const HEADING: Clipboard = { name: 'heading', source: '## H\n\nP2', from: ['H', 0], to: ['P2', 2], types: ['heading', 'paragraph'] };
const CODE: Clipboard = { name: 'code', source: '```\ncode\n```\n\nP2', from: ['code', 0], to: ['P2', 2], types: ['code', 'paragraph'] };
const LIST: Clipboard = { name: 'list', source: '- x\n- y\n\nP2', from: ['x', 0], to: ['P2', 2], types: ['list', 'paragraph'] };
const TABLE: Clipboard = { name: 'table', source: '| h |\n| --- |\n| c |\n\nP2', from: ['h', 0], to: ['P2', 2], types: ['table', 'paragraph'] };
const QUOTE: Clipboard = { name: 'quote', source: '> q\n\nP2', from: ['q', 0], to: ['P2', 2], types: ['quote', 'paragraph'] };

const FENCE: Clipboard = {
    name: 'fence', source: '::: {align=center}\n**f**\n:::\n\nP2', from: ['f', 0], to: ['P2', 2], types: ['markdown-block', 'paragraph'],
};

const HTML: Clipboard = {
    name: 'HTML', source: '<div>\nx\n</div>\n\nP2', from: ['<div>', 0], to: ['P2', 2], types: ['markdown-raw-block', 'paragraph'],
};

const PARAGRAPH_CODE: Clipboard = {
    name: 'paragraph, code', source: 'P1\n\n```\ncode\n```', from: ['P1', 0], to: ['code', 4], types: ['paragraph', 'code'],
};

const PARAGRAPH_FENCE: Clipboard = {
    name: 'paragraph, fence', source: 'P1\n\n::: {align=center}\n**f**\n:::', from: ['P1', 0], to: ['f', 1], types: ['paragraph', 'markdown-block'],
};

const PARAGRAPH_DEFINITION: Clipboard = {
    name: 'paragraph, definition', source: 'P1\n\n[x]: /url', from: ['P1', 0], to: ['[x]: /url', 9], types: ['paragraph', 'markdown-raw-block'],
};

const CLIPBOARDS: readonly Clipboard[] = [
    PARAGRAPHS, HEADING, CODE, LIST, TABLE, QUOTE, FENCE, HTML, PARAGRAPH_CODE, PARAGRAPH_FENCE, PARAGRAPH_DEFINITION,
];

/** The offsets in `bcd` a paste goes at: its start, inside it, and its end. */
const OFFSETS: readonly number[] = [0, 1, 3];

/**
 * Copies a clipboard's nodes from an editor of its own.
 *
 * @param clipboard - The clipboard.
 * @returns The copied nodes.
 */
function copyOf(clipboard: Clipboard): CopiedNodes {
    const origin = load(clipboard.source);

    selectText(origin, clipboard.from, clipboard.to);

    return copySelection(origin);
}

/**
 * Loads a target and pastes a clipboard into its `bcd` text.
 *
 * @param target - The target document.
 * @param clipboard - What to paste.
 * @param offset - The offset in `bcd` the paste goes at.
 * @returns The editor after the paste.
 */
function pasteInto(target: Target, clipboard: Clipboard, offset: number): MarkdownEditor {
    const nodes = copyOf(clipboard);
    const editor = load(target.source);

    selectText(editor, ['bcd', offset], ['bcd', offset]);
    pasteNodes(editor, nodes);

    return editor;
}

/**
 * Asserts what holds after any edit that leaves a block in a list item: the
 * viewer reads the save as the editor shows it (parity), loading the save
 * shows the same document (reload), and saving that gives the same source
 * (idempotence).
 *
 * @param editor - The edited editor.
 * @returns The save the checks ran against.
 */
function expectSaveKeepsDocument(editor: MarkdownEditor): string {
    const saved = editor.getValue();
    const reloaded = load(saved);

    expect(editorSurfaceModel(editor), 'parity').toEqual(viewerModel(saved).blocks);
    expect(editorSurfaceModel(reloaded), 'reload').toEqual(editorSurfaceModel(editor));
    expect(reloaded.getValue(), 'idempotence').toBe(saved);

    return saved;
}

/**
 * Asserts one undo restores the document from before the paste.
 *
 * @param editor - The editor after the paste.
 * @param source - The Markdown the editor was loaded with.
 */
function expectUndoRestores(editor: MarkdownEditor, source: string): void {
    lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

    expect(editor.getValue(), 'undo').toBe(source);
}

describe('pasting blocks into a list item keeps the list through a save and a load', () => {
    it.each(CLIPBOARDS)('the $name clipboard copies the node types the matrix is named for', (clipboard) => {
        expect(copyOf(clipboard).map((node) => node.type)).toEqual(clipboard.types);
    });

    describe.each(TARGETS)('into a $name', (target) => {
        describe.each(CLIPBOARDS)('the $name clipboard', (clipboard) => {
            it.each(OFFSETS)('at bcd@%i', (offset) => {
                const editor = pasteInto(target, clipboard, offset);

                expectSaveKeepsDocument(editor);
                expectUndoRestores(editor, target.source);
            });
        });
    });
});

describe('a paste into a list item saves each block where the editor shows it', () => {
    it.each<[string, Target, Clipboard, number, string]>([
        ['P1: paragraphs into a top-level item split the list (control)', TOP_LEVEL, PARAGRAPHS, 1, '- bP1\n\nP2cd\n\n- z'],
        ['P2: paragraphs at a nested item\'s start', NESTED, PARAGRAPHS, 0, '- a\n  - P1\n\n  P2bcd\n\n  - e\n\n- f'],
        ['P3: paragraphs inside a nested item', NESTED, PARAGRAPHS, 1, '- a\n  - bP1\n\n  P2cd\n\n  - e\n\n- f'],
        ['P4: paragraphs at a nested item\'s end', NESTED, PARAGRAPHS, 3, '- a\n  - bcdP1\n\n  P2\n\n  - e\n\n- f'],
        ['P5: a heading and a paragraph', NESTED, HEADING, 1, '- a\n  - bH\n\n  P2cd\n\n  - e\n\n- f'],
        ['P6: a paragraph and a code block', NESTED, PARAGRAPH_CODE, 3, '- a\n  - bcdP1\n\n  ```\n  code\n  ```\n\n  - e\n\n- f'],
        ['P7: a list and a paragraph', NESTED, LIST, 1, '- a\n  - b\n  - x\n  - y\n\n  P2cd\n\n  - e\n\n- f'],
        ['P8: a table and a paragraph', NESTED, TABLE, 1, '- a\n  - b\n\n  | h |\n  | --- |\n  | c |\n\n  P2cd\n\n  - e\n\n- f'],
        ['P9: a quote and a paragraph', NESTED, QUOTE, 1, '- a\n  - bq\n\n  P2cd\n\n  - e\n\n- f'],
        ['P10: a fence and a paragraph at a nested item\'s start', NESTED, FENCE, 0,
            '- a\n\n- ::: {align=center}\n  **f**\n  :::\n\n  P2bcd\n\n  - e\n\n- f'],
        ['P11: paragraphs inside an ordered nested item', ORDERED, PARAGRAPHS, 1, '1. a\n   1. bP1\n\n   P2cd\n\n   1. e\n\n2. f'],
        ['P12: paragraphs inside a task nested item', TASK, PARAGRAPHS, 1, '- [ ] a\n  - [x] bP1\n\n  P2cd\n\n- [ ] f'],
        ['P13: paragraphs inside a loose nested item', LOOSE, PARAGRAPHS, 1, '- a\n  - bP1\n\n  P2cd\n\n- f'],
        ['P14: a paragraph and a link reference definition', NESTED, PARAGRAPH_DEFINITION, 1,
            '- a\n  - bP1\n\n  [x]: /urlcd\n\n  - e\n\n- f'],
    ])('%s', (_name, target, clipboard, offset, expected) => {
        const editor = pasteInto(target, clipboard, offset);
        const saved = expectSaveKeepsDocument(editor);

        expect(saved).toBe(expected);
        expectUndoRestores(editor, target.source);
    });
});

describe('a raw list pasted into a nested list item stays a raw block of the outer item', () => {
    // The viewer reads a raw list as a list, so parity is left out: the save is compared with its own reload.
    const RAW_LISTS: readonly Clipboard[] = [
        {
            name: 'paragraph, raw ordered list', source: 'P1\n\n1) x\n   > p', from: ['P1', 0], to: ['   > p', 6], types: ['paragraph', 'markdown-raw-block'],
        },
        {
            name: 'paragraph, raw bullet list', source: 'P1\n\n- x\n  > p', from: ['P1', 0], to: ['  > p', 5], types: ['paragraph', 'markdown-raw-block'],
        },
    ];

    describe.each(RAW_LISTS)('the $name clipboard', (clipboard) => {
        it('copies a paragraph and a raw block', () => {
            expect(copyOf(clipboard).map((node) => node.type)).toEqual(clipboard.types);
        });

        it.each(OFFSETS)('at bcd@%i', (offset) => {
            const editor = pasteInto(NESTED, clipboard, offset);
            const saved = editor.getValue();
            const reloaded = load(saved);

            expect(editorSurfaceModel(reloaded), 'reload').toEqual(editorSurfaceModel(editor));
            expect(JSON.stringify(editorSurfaceModel(reloaded)), 'the raw list is still raw').toContain('"kind":"raw"');
            expect(editorSurfaceModel(reloaded).map((block) => block.kind), 'the outer list is still a list').toEqual(['list']);
            expect(reloaded.getValue(), 'idempotence').toBe(saved);
            expectUndoRestores(editor, NESTED.source);
        });
    });

    it('X1: the ordered raw list at a nested item\'s end is saved under the item, after the nested list', () => {
        const editor = pasteInto(NESTED, RAW_LISTS[0]!, 3);

        expect(editor.getValue()).toBe('- a\n  - bcdP1\n\n  1) x\n     > p\n\n  - e\n\n- f');
    });
});

describe('a definition pasted into a document that already holds its label', () => {
    // `marked` gives no token for a repeated definition. The importer builds the line it left uncovered as a raw
    // block of its item, so this paste holds the same checks as any other.
    it.each(OFFSETS)('X2: at bcd@%i the save loads as the list the editor shows', (offset) => {
        const target: Target = { name: 'nested item after a definition', source: '[x]: /a\n\n- a\n  - bcd\n  - e\n- f' };
        const editor = pasteInto(target, PARAGRAPH_DEFINITION, offset);
        const saved = expectSaveKeepsDocument(editor);

        expect(lexicalOf(load(saved)).read(() => $getRoot().getChildren().map((node) => node.getType())))
            .toEqual(['markdown-raw-block', 'list']);
        expectUndoRestores(editor, target.source);
    });

    it('X3: at the nested item\'s end the definition is saved under the item, after the nested list', () => {
        const target: Target = { name: 'nested item after a definition', source: '[x]: /a\n\n- a\n  - bcd\n  - e\n- f' };

        expect(pasteInto(target, PARAGRAPH_DEFINITION, 3).getValue()).toBe('[x]: /a\n\n- a\n  - bcdP1\n\n  [x]: /url\n\n  - e\n\n- f');
    });
});

describe('blocks pasted into a table cell are still the table\'s to place', () => {
    // A cell holds paragraphs only, and the table's own rule turns pasted blocks into them. The rule that moves a
    // block out of a paragraph (for an item joined to the block before it) must leave a cell's paragraphs alone,
    // or each pasted block leaves an empty paragraph behind.
    const TABLE: Target = { name: 'table cell', source: '| h |\n| --- |\n| bcd |' };

    it.each([FENCE, QUOTE, HEADING, LIST, PARAGRAPH_FENCE])('the $name clipboard leaves no empty paragraph in the cell', (clipboard) => {
        const editor = pasteInto(TABLE, clipboard, 1);
        const emptyParagraphs = lexicalOf(editor).read(() => $dfs($getRoot())
            .filter(({ node }) => node.getType() === 'paragraph' && node.getTextContent() === '').length);

        expect(emptyParagraphs).toBe(0);
        expectSaveKeepsDocument(editor);
        expectUndoRestores(editor, TABLE.source);
    });
});

describe('a list whose items hold blocks, pasted into a table cell, becomes one paragraph per block', () => {
    // A cell holds paragraphs of text only: each item's text and each of its blocks is a paragraph of its own,
    // in order, so none of them is written into another's line. (A pasted list starts on a line of its own, as
    // it does in any paragraph; the paragraph after it takes the rest of the caret's line.)
    const CELL: Target = { name: 'table cell', source: '| h |\n| --- |\n| bcd |' };

    /** The text of each paragraph of the table's body cell. */
    const cellParagraphs = (editor: MarkdownEditor): string[] => lexicalOf(editor).read(() => $dfs($getRoot())
        .map(({ node }) => node).filter((node) => node.getType() === 'paragraph').map((node) => node.getTextContent()).slice(1));

    it.each<[string, Clipboard, string[], string]>([
        ['a quote and a code block in an item',
            { name: 'list', source: '- a\n\n  > q\n\n  ```\n  k\n  ```\n- c\n\nP2', from: ['a', 0], to: ['P2', 2], types: ['list', 'paragraph'] },
            ['b', 'a', 'q', 'k', 'c', 'P2cd'], '| h |\n| --- |\n| b\\n\\na\\n\\nq\\n\\nk\\n\\nc\\n\\nP2cd |'],
        ['an HTML block in an item',
            { name: 'list', source: '- a\n\n  <div>\n- c\n\nP2', from: ['a', 0], to: ['P2', 2], types: ['list', 'paragraph'] },
            ['b', 'a', '<div>', 'c', 'P2cd'], '| h |\n| --- |\n| b\\n\\na\\n\\n\\<div>\\n\\nc\\n\\nP2cd |'],
        ['a paragraph after a nested list in an item',
            { name: 'list', source: '- a\n  - n\n\n  p\n- c\n\nP2', from: ['a', 0], to: ['P2', 2], types: ['list', 'paragraph'] },
            ['b', 'a', 'n', 'p', 'c', 'P2cd'], '| h |\n| --- |\n| b\\n\\na\\n\\nn\\n\\np\\n\\nc\\n\\nP2cd |'],
        ['two paragraphs in an item',
            { name: 'list', source: '- a\n\n  p\n\n  r\n- c\n\nP2', from: ['a', 0], to: ['P2', 2], types: ['list', 'paragraph'] },
            ['b', 'a', 'p', 'r', 'c', 'P2cd'], '| h |\n| --- |\n| b\\n\\na\\n\\np\\n\\nr\\n\\nc\\n\\nP2cd |'],
        // A paste holding a table is declined in a cell, a table in a list item included (control).
        ['a table in an item',
            { name: 'list', source: '- a\n\n  | x |\n  | --- |\n  | y |\n- c\n\nP2', from: ['a', 0], to: ['P2', 2], types: ['list', 'paragraph'] },
            ['bcd'], '| h |\n| --- |\n| bcd |'],
    ])('%s', (_name, clipboard, paragraphs, saved) => {
        expect(copyOf(clipboard).map((node) => node.type)).toEqual(clipboard.types);

        const editor = pasteInto(CELL, clipboard, 1);

        expect(cellParagraphs(editor)).toEqual(paragraphs);
        expect(expectSaveKeepsDocument(editor)).toBe(saved);
        expectUndoRestores(editor, CELL.source);
    });

    it('a list of empty items leaves no paragraph in the cell', () => {
        // It holds nothing a line could be written from. (A selection cannot copy empty items alone; the list is put there.)
        const editor = load(CELL.source);

        update(editor, () => {
            $textNode('bcd').getParentOrThrow().insertAfter($createListNode('bullet').append($createListItemNode(), $createListItemNode()));
        });

        expect(cellParagraphs(editor)).toEqual(['bcd']);
        expect(expectSaveKeepsDocument(editor)).toBe(CELL.source);
    });
});

describe('a list whose items hold blocks, pasted into a code block or a raw block, keeps each block apart', () => {
    // A code block and a raw block hold text only: a paste goes in as text, each item's text and each of its
    // blocks apart as two items are, so none of them is written into another's line.
    const CODE: Target = { name: 'code block', source: '```\nbcd\n```' };
    const RAW: Target = { name: 'raw block', source: '<div>\nbcd' };

    it.each<[string, Target, Clipboard, string]>([
        ['a quote and a code block in an item, into a code block', CODE,
            { name: 'list', source: '- a\n\n  > q\n\n  ```\n  k\n  ```\n- c\n\nP2', from: ['a', 0], to: ['P2', 2], types: ['list', 'paragraph'] },
            '```\nba\n\nq\n\nk\n\nc\nP2cd\n```'],
        ['a paragraph after a nested list in an item, into a code block', CODE,
            { name: 'list', source: '- a\n  - n\n\n  p\n- c\n\nP2', from: ['a', 0], to: ['P2', 2], types: ['list', 'paragraph'] },
            '```\nba\n\nn\n\np\n\nc\nP2cd\n```'],
        ['a paragraph in an item, into a code block', CODE,
            { name: 'list', source: '- a\n\n  p\n- c\n\nP2', from: ['a', 0], to: ['P2', 2], types: ['list', 'paragraph'] },
            '```\nba\n\np\n\nc\nP2cd\n```'],
        ['a quote and a code block in an item, into a raw block', RAW,
            { name: 'list', source: '- a\n\n  > q\n\n  ```\n  k\n  ```\n- c\n\nP2', from: ['a', 0], to: ['P2', 2], types: ['list', 'paragraph'] },
            '<div>\nba\n\nq\n\nk\n\nc\n\nP2cd'],
        ['two paragraphs in an item, into a raw block', RAW,
            { name: 'list', source: '- a\n\n  p\n\n  r\n- c\n\nP2', from: ['a', 0], to: ['P2', 2], types: ['list', 'paragraph'] },
            '<div>\nba\n\np\n\nr\n\nc\n\nP2cd'],
        ['an item opening with a block, into a raw block', RAW,
            { name: 'list', source: '- > q\n\n  p\n- c\n\nP2', from: ['q', 0], to: ['P2', 2], types: ['list', 'paragraph'] },
            '<div>\nbq\n\np\n\nc\n\nP2cd'],
        // A list whose items hold text only goes in as before (control).
        ['a list of text items, into a code block', CODE,
            { name: 'list', source: '- a\n- c\n\nP2', from: ['a', 0], to: ['P2', 2], types: ['list', 'paragraph'] },
            '```\nba\n\nc\nP2cd\n```'],
    ])('%s', (_name, target, clipboard, saved) => {
        expect(copyOf(clipboard).map((node) => node.type)).toEqual(clipboard.types);

        const editor = pasteInto(target, clipboard, 1);

        expect(editor.getValue()).toBe(saved);
        expectUndoRestores(editor, target.source);
    });
});

describe('a copied list keeps the paragraphs its items hold', () => {
    // Lexical builds copied nodes by appending each child to its parent, and a list item's `append` merges a
    // paragraph into the item's text: `- a` holding a paragraph `p` would be pasted as `- ap`.
    const ITEM_PARAGRAPHS: Clipboard = { name: 'list', source: '- a\n\n  p\n\n  r\n- k', from: ['a', 0], to: ['k', 1], types: ['list'] };
    const TASK_PARAGRAPH: Clipboard = { name: 'list', source: '- [ ] a\n\n  p\n- [x] k', from: ['[ ] ', 0], to: ['k', 1], types: ['list'] };
    const QUOTE_PARAGRAPH: Clipboard = { name: 'list', source: '- > q\n\n  p\n- k', from: ['q', 0], to: ['k', 1], types: ['list'] };
    const NESTED_PARAGRAPH: Clipboard = { name: 'list', source: '- a\n  - n\n\n    p\n- k', from: ['a', 0], to: ['k', 1], types: ['list'] };
    const PARAGRAPH: Target = { name: 'paragraph', source: 'bcd' };
    const QUOTED: Target = { name: 'quote', source: '> bcd' };

    /** The document's blocks, by node type and text. */
    const shapeOf = (editor: MarkdownEditor): string => lexicalOf(editor).read(() => {
        const describeNode = (node: LexicalNode): string => ($isElementNode(node)
            ? `${node.getType()}(${node.getChildren().map(describeNode).join(', ')})`
            : JSON.stringify(node.getTextContent()));

        return $getRoot().getChildren().map(describeNode).join(' | ');
    });

    it.each<[string, Target, Clipboard, string, string]>([
        ['into a paragraph', PARAGRAPH, ITEM_PARAGRAPHS,
            'paragraph("b") | list(listitem("a", paragraph("p"), paragraph("r")), listitem("k")) | paragraph("cd")',
            'b\n\n- a\n\n  p\n\n  r\n\n- k\n\ncd'],
        ['into a quote', QUOTED, ITEM_PARAGRAPHS,
            'quote("b") | list(listitem("a", paragraph("p"), paragraph("r")), listitem("k")) | paragraph("cd")',
            '> b\n\n- a\n\n  p\n\n  r\n\n- k\n\ncd'],
        ['into a top-level item', TOP_LEVEL, ITEM_PARAGRAPHS,
            'list(listitem("b"), listitem("a", paragraph("p"), paragraph("r")), listitem("kcd"), listitem("z"))',
            '- b\n\n- a\n\n  p\n\n  r\n\n- kcd\n\n- z'],
        ['into a nested item', NESTED, ITEM_PARAGRAPHS,
            'list(listitem("a"), listitem(list(listitem("b"), listitem("a", paragraph("p"), paragraph("r")), listitem("kcd"), listitem("e"))), '
            + 'listitem("f"))',
            '- a\n  - b\n\n  - a\n\n    p\n\n    r\n\n  - kcd\n\n  - e\n- f'],
        ['a task item\'s paragraph', PARAGRAPH, TASK_PARAGRAPH,
            'paragraph("b") | list(listitem("[ ] ", "a", paragraph("p")), listitem("[x] ", "k")) | paragraph("cd")',
            'b\n\n- [ ] a\n\n  p\n\n- [x] k\n\ncd'],
        ['a paragraph after an item\'s quote', PARAGRAPH, QUOTE_PARAGRAPH,
            'paragraph("b") | list(listitem(quote("q"), paragraph("p")), listitem("k")) | paragraph("cd")',
            'b\n\n- > q\n\n  p\n\n- k\n\ncd'],
        ['a nested item\'s paragraph', PARAGRAPH, NESTED_PARAGRAPH,
            'paragraph("b") | list(listitem("a"), listitem(list(listitem("n", paragraph("p")))), listitem("k")) | paragraph("cd")',
            'b\n\n- a\n  - n\n\n    p\n- k\n\ncd'],
    ])('%s', (_name, target, clipboard, shape, saved) => {
        expect(copyOf(clipboard).map((node) => node.type)).toEqual(clipboard.types);

        const editor = pasteInto(target, clipboard, 1);

        expect(shapeOf(editor)).toBe(shape);
        expect(expectSaveKeepsDocument(editor)).toBe(saved);
        expectUndoRestores(editor, target.source);
    });

    it('a list copied from its item\'s paragraph on opens the pasted item with that paragraph\'s text', () => {
        // The item's own text is not copied: the paragraph is the first thing the pasted item holds, its text.
        const clipboard: Clipboard = { name: 'list', source: '- a\n\n  p\n\n  r\n- k', from: ['p', 0], to: ['k', 1], types: ['list'] };
        const editor = pasteInto(PARAGRAPH, clipboard, 1);

        expect(shapeOf(editor)).toBe('paragraph("b") | list(listitem("p", paragraph("r")), listitem("k")) | paragraph("cd")');
        expect(expectSaveKeepsDocument(editor)).toBe('b\n\n- p\n\n  r\n\n- k\n\ncd');
    });

    it('an insert-from-paste input event keeps them too', () => {
        const editor = load(PARAGRAPH.source);
        const lexical = lexicalOf(editor);

        vi.stubGlobal('InputEvent', class InputEvent {});
        selectText(editor, ['bcd', 1], ['bcd', 1]);
        update(editor, () => {
            const event = Object.assign(new InputEvent('beforeinput'), { dataTransfer: transferOf(editor, copyOf(ITEM_PARAGRAPHS)) });

            lexical.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, event);
        });

        expect(expectSaveKeepsDocument(editor)).toBe('b\n\n- a\n\n  p\n\n  r\n\n- k\n\ncd');
    });

    it('the insert a drop leads to keeps them too', () => {
        // Lexical's drop finds its caret from the pointer, which the test DOM has none of: the drop itself inserts
        // nothing here, and the insert it would make is made in the same update.
        const editor = load(PARAGRAPH.source);
        const lexical = lexicalOf(editor);
        const nodes = copyOf(ITEM_PARAGRAPHS);

        vi.stubGlobal('DragEvent', class DragEvent {});
        selectText(editor, ['bcd', 1], ['bcd', 1]);
        update(editor, () => {
            lexical.dispatchCommand(DROP_COMMAND, Object.assign(new DragEvent('drop'), { dataTransfer: transferOf(editor, nodes) }));
            $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), $getSelection()!);
        });

        expect(expectSaveKeepsDocument(editor)).toBe('b\n\n- a\n\n  p\n\n  r\n\n- k\n\ncd');
    });

    it('copied nodes a paste did not insert are forgotten with its update', () => {
        const editor = load(PARAGRAPH.source);
        const lexical = lexicalOf(editor);

        vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
        vi.stubGlobal('DragEvent', class DragEvent {});
        vi.stubGlobal('InputEvent', class InputEvent {});
        vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});

        // A paste with no selection inserts nothing.
        update(editor, () => {
            $setSelection(null);
            lexical.dispatchCommand(PASTE_COMMAND, Object.assign(new ClipboardEvent('paste'), {
                clipboardData: transferOf(editor, copyOf(ITEM_PARAGRAPHS)), preventDefault: () => {},
            }));
        });
        selectText(editor, ['bcd', 1], ['bcd', 1]);
        update(editor, () => {
            $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(copyOf(PARAGRAPHS)), $getSelection()!);
        });

        expect(editor.getValue()).toBe('bP1\n\nP2cd');
    });

    it('nodes copied in another editor namespace are not this editor\'s to build', () => {
        // Lexical inserts none of them: it goes on to the clipboard's HTML or text, and what that inserts is not
        // replaced by them. (The insert is made here, in the paste's update, as Lexical's HTML paste makes one.)
        const editor = load(PARAGRAPH.source);
        const lexical = lexicalOf(editor);
        const data: Record<string, string> = {
            [LEXICAL_CLIPBOARD_TYPE]: JSON.stringify({ namespace: 'another', nodes: copyOf(ITEM_PARAGRAPHS) }),
        };

        vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
        vi.stubGlobal('DragEvent', class DragEvent {});
        vi.stubGlobal('InputEvent', class InputEvent {});
        vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});
        selectText(editor, ['bcd', 1], ['bcd', 1]);
        update(editor, () => {
            lexical.dispatchCommand(PASTE_COMMAND, Object.assign(new ClipboardEvent('paste'), {
                clipboardData: { types: Object.keys(data), files: [], getData: (type: string) => data[type] ?? '' }, preventDefault: () => {},
            }));
            $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(copyOf(PARAGRAPHS)), $getSelection()!);
        });

        expect(editor.getValue()).toBe('bP1\n\nP2cd');
    });

    it('a clipboard whose copied nodes are no JSON pastes its text', () => {
        const editor = load(PARAGRAPH.source);
        const lexical = lexicalOf(editor);
        const data: Record<string, string> = { [LEXICAL_CLIPBOARD_TYPE]: '{not json', 'text/plain': 'T' };
        // Lexical reports the clipboard's broken copy and goes on to its text.
        const reported = vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
        vi.stubGlobal('DragEvent', class DragEvent {});
        vi.stubGlobal('InputEvent', class InputEvent {});
        vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});
        selectText(editor, ['bcd', 1], ['bcd', 1]);
        update(editor, () => {
            lexical.dispatchCommand(PASTE_COMMAND, Object.assign(new ClipboardEvent('paste'), {
                clipboardData: { types: Object.keys(data), files: [], getData: (type: string) => data[type] ?? '' }, preventDefault: () => {},
            }));
        });

        expect(editor.getValue()).toBe('bTcd');
        expect(reported).toHaveBeenCalledTimes(1);
        reported.mockRestore();
    });
});

describe('a paste into the text of a list item that holds blocks leaves them as blocks', () => {
    // Lexical splits the item at the caret for a paste of several blocks or lines, appending what follows the
    // caret to a new item, and a list item's `append` merges a paragraph into the item's text.
    const ITEM: Target = { name: 'item holding a paragraph', source: '- bcd\n\n  p2\n- z' };
    const QUOTE_ITEM: Target = { name: 'item holding a quote and a paragraph', source: '- bcd\n\n  > q\n\n  p2\n- z' };

    /** Pastes plain text at the selection, as Ctrl/Cmd+V does with a clipboard holding only text. */
    const pasteText = (editor: MarkdownEditor, text: string): void => {
        const data: Record<string, string> = { 'text/plain': text };

        vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
        vi.stubGlobal('DragEvent', class DragEvent {});
        vi.stubGlobal('InputEvent', class InputEvent {});
        vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});
        update(editor, () => {
            lexicalOf(editor).dispatchCommand(PASTE_COMMAND, Object.assign(new ClipboardEvent('paste'), {
                clipboardData: { types: Object.keys(data), files: [], getData: (type: string) => data[type] ?? '' }, preventDefault: () => {},
            }));
        });
    };

    it.each<[string, Target, Clipboard, number, string]>([
        ['paragraphs inside the text', ITEM, PARAGRAPHS, 1, '- bP1\n\nP2cd\n\np2\n\n- z'],
        ['paragraphs at the end of the text', ITEM, PARAGRAPHS, 3, '- bcdP1\n\nP2\n\np2\n\n- z'],
        ['a list inside the text', ITEM, LIST, 1, '- b\n- x\n- y\n\nP2cd\n\np2\n\n- z'],
        ['paragraphs inside the text, before a quote', QUOTE_ITEM, PARAGRAPHS, 1, '- bP1\n\nP2cd\n\n> q\n\np2\n\n- z'],
    ])('%s', (_name, target, clipboard, offset, saved) => {
        const editor = pasteInto(target, clipboard, offset);

        expect(expectSaveKeepsDocument(editor)).toBe(saved);
        expectUndoRestores(editor, target.source);
    });

    it('nodes a drop inserts inside the text', () => {
        // A drop inserts its nodes without a paste event, through `$insertGeneratedNodes`.
        const editor = load(ITEM.source);
        const lexical = lexicalOf(editor);

        selectText(editor, ['bcd', 1], ['bcd', 1]);
        update(editor, () => {
            $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(copyOf(PARAGRAPHS)), $getSelection()!);
        });

        expect(expectSaveKeepsDocument(editor)).toBe('- bP1\n\nP2cd\n\np2\n\n- z');
    });

    it('lines of plain text inside the text', () => {
        const editor = load(ITEM.source);

        selectText(editor, ['bcd', 1], ['bcd', 1]);
        pasteText(editor, 'A\nB');

        expect(expectSaveKeepsDocument(editor)).toBe('- bA\n\n- Bcd\n\n  p2\n\n- z');
        expectUndoRestores(editor, ITEM.source);
    });

    it('plain text over all of the text', () => {
        const editor = load(ITEM.source);

        selectText(editor, ['bcd', 0], ['bcd', 3]);
        pasteText(editor, 'Q');

        expect(expectSaveKeepsDocument(editor)).toBe('- Q\n\n  p2\n\n- z');
        expectUndoRestores(editor, ITEM.source);
    });
});

describe('other routes to a block in a list item', () => {
    it('O1: a line inserted after a nested list is a paragraph of the outer item', () => {
        const editor = load('- a\n  - b\n- c');

        selectText(editor, ['b', 1], ['b', 1]);
        editor.insertParagraphAfterBlock();
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'X');

        expect(expectSaveKeepsDocument(editor)).toBe('- a\n  - b\n\n  X\n\n- c');
    });

    it('O2: two paragraphs copied in the same document and pasted into its nested item', () => {
        const source = '- a\n  - b\n\nP1\n\nP2';
        const editor = load(source);

        selectText(editor, ['P1', 0], ['P2', 2]);

        const nodes = copySelection(editor);

        selectText(editor, ['b', 1], ['b', 1]);
        pasteNodes(editor, nodes);

        expect(expectSaveKeepsDocument(editor)).toBe('- a\n\n  - bP1\n\n  P2\n\nP1\n\nP2');
        expectUndoRestores(editor, source);
    });
});
