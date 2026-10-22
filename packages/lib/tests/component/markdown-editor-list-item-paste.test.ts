// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor keeps a block an edit leaves in a list item
// (plans/markdown-editor-list-item-block-paste.md): pasting several blocks
// into a nested list item, or inserting a line after a nested list, puts a
// block inside the outer item. The save writes it, the viewer reads it as the
// editor shows it, and loading the save shows the same document — the list
// stays a list.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createParagraphNode, $createRangeSelection, $createTextNode, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode,
    $setSelection,
    CONTROLLED_TEXT_INSERTION_COMMAND, DELETE_CHARACTER_COMMAND, DROP_COMMAND, PASTE_COMMAND, SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
    UNDO_COMMAND,
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

/**
 * Pastes plain text at the selection, as Ctrl/Cmd+V does with a clipboard holding only text.
 *
 * @param editor - The editor.
 * @param text - The clipboard's text.
 */
function pasteText(editor: MarkdownEditor, text: string): void {
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
            '- a\n\n  ::: {align=center}\n  **f**\n  :::\n\n  P2bcd\n\n  - e\n\n- f'],
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
            'paragraph("b") | list(markdown-list-item(markdown-list-item-text("a"), paragraph("p"), paragraph("r")), markdown-list-item(markdown-list-item-text("k"))) | paragraph("cd")',
            'b\n\n- a\n\n  p\n\n  r\n\n- k\n\ncd'],
        ['into a quote', QUOTED, ITEM_PARAGRAPHS,
            'quote("b") | list(markdown-list-item(markdown-list-item-text("a"), paragraph("p"), paragraph("r")), markdown-list-item(markdown-list-item-text("k"))) | paragraph("cd")',
            '> b\n\n- a\n\n  p\n\n  r\n\n- k\n\ncd'],
        ['into a top-level item', TOP_LEVEL, ITEM_PARAGRAPHS,
            'list(markdown-list-item(markdown-list-item-text("b")), markdown-list-item(markdown-list-item-text("a"), paragraph("p"), paragraph("r")), markdown-list-item(markdown-list-item-text("kcd")), markdown-list-item(markdown-list-item-text("z")))',
            '- b\n\n- a\n\n  p\n\n  r\n\n- kcd\n\n- z'],
        ['into a nested item', NESTED, ITEM_PARAGRAPHS,
            'list(markdown-list-item(markdown-list-item-text("a"), list(markdown-list-item(markdown-list-item-text("b")), '
            + 'markdown-list-item(markdown-list-item-text("a"), paragraph("p"), paragraph("r")), markdown-list-item(markdown-list-item-text("kcd")), '
            + 'markdown-list-item(markdown-list-item-text("e")))), markdown-list-item(markdown-list-item-text("f")))',
            '- a\n  - b\n\n  - a\n\n    p\n\n    r\n\n  - kcd\n\n  - e\n- f'],
        ['a task item\'s paragraph', PARAGRAPH, TASK_PARAGRAPH,
            'paragraph("b") | list(markdown-list-item(markdown-list-item-text("[ ] ", "a"), paragraph("p")), markdown-list-item(markdown-list-item-text("[x] ", "k"))) | paragraph("cd")',
            'b\n\n- [ ] a\n\n  p\n\n- [x] k\n\ncd'],
        ['a paragraph after an item\'s quote', PARAGRAPH, QUOTE_PARAGRAPH,
            'paragraph("b") | list(markdown-list-item(quote("q"), paragraph("p")), markdown-list-item(markdown-list-item-text("k"))) | paragraph("cd")',
            'b\n\n- > q\n\n  p\n\n- k\n\ncd'],
        ['a nested item\'s paragraph', PARAGRAPH, NESTED_PARAGRAPH,
            'paragraph("b") | list(markdown-list-item(markdown-list-item-text("a"), list(markdown-list-item(markdown-list-item-text("n"), paragraph("p")))), markdown-list-item(markdown-list-item-text("k"))) | paragraph("cd")',
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

        expect(shapeOf(editor)).toBe('paragraph("b") | list(markdown-list-item(markdown-list-item-text("p"), paragraph("r")), markdown-list-item(markdown-list-item-text("k"))) | paragraph("cd")');
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
    // Lexical splits the item at the caret for a paste of several blocks or lines: what follows the caret, the
    // item's blocks with it, goes to a new item, and follows the pasted blocks out of the list from there.
    const ITEM: Target = { name: 'item holding a paragraph', source: '- bcd\n\n  p2\n- z' };
    const QUOTE_ITEM: Target = { name: 'item holding a quote and a paragraph', source: '- bcd\n\n  > q\n\n  p2\n- z' };

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

    // Each newline of pasted text splits the item, as Enter in a text that holds something does. A blank line
    // between two pasted paragraphs is a split in an empty text: it must not end the list, as the Enter key does.
    it.each<[string, string, TextPoint, TextPoint, string, string]>([
        ['T1: two paragraphs of text at the end of a text above a paragraph', '- ab\n\n  pq\n- z', ['ab', 2], ['ab', 2], 'T1\n\nT2',
            '- abT1\n\n-\n\n- T2\n\n  pq\n\n- z'],
        ['T2: the same above a nested list', '- ab\n  - n\n- z', ['ab', 2], ['ab', 2], 'T1\n\nT2', '- abT1\n-\n- T2\n  - n\n- z'],
        ['T3: three paragraphs of text in an item of text', '- ab\n- z', ['ab', 2], ['ab', 2], 'T1\n\nT2\n\nT3', '- abT1\n-\n- T2\n-\n- T3\n- z'],
        ['T4: two paragraphs of text over all of a text above a paragraph', '- ab\n\n  pq\n- z', ['ab', 0], ['ab', 2], 'T1\n\nT2',
            '- T1\n\n-\n\n- T2\n\n  pq\n\n- z'],
    ])('%s', (_name, source, from, to, text, saved) => {
        const editor = load(source);

        selectText(editor, from, to);
        pasteText(editor, text);

        expect(expectSaveKeepsDocument(editor)).toBe(saved);
        expectUndoRestores(editor, load(source).getValue());
    });

    it('T5: blocks pasted at a text that holds only a space go in as at any text', () => {
        const editor = load('- a\n- b\n- z');

        selectText(editor, ['b', 0], ['b', 1]);
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' ');
        pasteNodes(editor, copyOf(PARAGRAPHS));

        expect(expectSaveKeepsDocument(editor)).toBe('- a\n- P1\n\nP2\n\n- z');
    });

    it('T6: the paste command with the caret between the blocks of an item puts the text in a paragraph of the item', async () => {
        const editor = load('- a\n\n  | h |\n  | --- |\n  | c |\n- z');

        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('zz');
        update(editor, () => {
            const item = $textNode('a').getParentOrThrow().getParentOrThrow();
            const selection = $createRangeSelection();

            selection.anchor.set(item.getKey(), 2, 'element');
            selection.focus.set(item.getKey(), 2, 'element');
            $setSelection(selection);
        });
        await editor.paste();

        expect(expectSaveKeepsDocument(editor)).toBe('- a\n\n  | h |\n  | --- |\n  | c |\n\n  zz\n\n- z');
    });

    /**
     * Selects a range that starts between the blocks of the list item whose text is `text`.
     *
     * @param editor - The editor.
     * @param text - The item's text.
     * @param from - The index of the block the range starts before.
     * @param to - Where it ends: the index of a block of the same item, or a point in a text.
     */
    const selectFromItem = (editor: MarkdownEditor, text: string, from: number, to: number | TextPoint): void => {
        update(editor, () => {
            const item = $textNode(text).getParentOrThrow().getParentOrThrow();
            const selection = $createRangeSelection();

            selection.anchor.set(item.getKey(), from, 'element');

            if (typeof to === 'number') {
                selection.focus.set(item.getKey(), to, 'element');
            } else {
                selection.focus.set($textNode(to[0]).getKey(), to[1], 'text');
            }

            $setSelection(selection);
        });
    };

    const TABLE_ITEM = '| h |\n  | --- |\n  | c |';
    const AFTER_TABLE = `- a\n\n  ${TABLE_ITEM}\n- m\n- z\n\ntail`;

    // A range whose removal leaves the caret between the blocks of an item: what is pasted goes into a paragraph
    // of the item there, as at a caret that stood there, and nothing is left half done.
    it.each<[string, string, number, number | TextPoint, string]>([
        ['T8: the paste command over a range between the blocks of an item', `- a\n\n  ${TABLE_ITEM}\n- z`, 1, 2, '- a\n\n  zz\n\n- z'],
        ['T9: the paste command over a range from after an item\'s table into the next item\'s text', AFTER_TABLE, 2, ['m', 1],
            `- a\n\n  ${TABLE_ITEM}\n\n  zz\n\n- z\n\ntail`],
    ])('%s', async (_name, source, from, to, saved) => {
        const editor = load(source);

        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('zz');
        selectFromItem(editor, 'a', from, to);
        await editor.paste();

        expect(expectSaveKeepsDocument(editor)).toBe(saved);
        expectUndoRestores(editor, load(source).getValue());
    });

    it('T13: plain text pasted with Ctrl/Cmd+V over such a range goes into a paragraph of the item', () => {
        const source = `- a\n\n  ${TABLE_ITEM}\n- z`;
        const editor = load(source);

        selectFromItem(editor, 'a', 1, 2);
        pasteText(editor, 'y1\ny2');

        expect(expectSaveKeepsDocument(editor)).toBe('- a\n\n  y1\n\n  y2\n\n- z');
        expectUndoRestores(editor, load(source).getValue());
    });

    it('T10: inline nodes pasted over such a range go into a paragraph of the item', () => {
        const editor = load(AFTER_TABLE);
        const nodes = copyOf({ name: 'inline', source: 'some **bold** text', from: ['some ', 1], to: [' text', 2], types: [] });

        selectFromItem(editor, 'a', 2, ['m', 1]);
        pasteNodes(editor, nodes);

        expect(expectSaveKeepsDocument(editor)).toBe(`- a\n\n  ${TABLE_ITEM}\n\n  ome **bold** t\n\n- z\n\ntail`);
    });

    /**
     * Pastes plain text with the caret after the table of the first item of `- a`, a table, `- z`.
     *
     * @param text - The text.
     * @returns The editor after the paste.
     */
    const pasteTextAfterItemTable = (text: string): MarkdownEditor => {
        const editor = load(`- a\n\n  ${TABLE_ITEM}\n- z`);

        update(editor, () => {
            const item = $textNode('a').getParentOrThrow().getParentOrThrow();
            const selection = $createRangeSelection();

            selection.anchor.set(item.getKey(), 2, 'element');
            selection.focus.set(item.getKey(), 2, 'element');
            $setSelection(selection);
        });
        pasteText(editor, text);

        return editor;
    };

    it('T11: lines of plain text pasted with the caret between the blocks of an item are paragraphs of the item', () => {
        const editor = pasteTextAfterItemTable('y1\ny2');

        expect(expectSaveKeepsDocument(editor)).toBe(`- a\n\n  ${TABLE_ITEM}\n\n  y1\n\n  y2\n\n- z`);
    });

    it('T12: a pasted line that opens with a tab keeps the tab in the item\'s new paragraph', () => {
        const editor = pasteTextAfterItemTable('\ty1');
        const texts = lexicalOf(editor).read(() => $textNode('a').getParentOrThrow().getParentOrThrow().getChildren()
            .map((block) => `${block.getType()}:${block.getTextContent()}`));

        // The save writes no space before a paragraph's text, so the tab is read off the tree.
        expect(texts.slice(2)).toEqual(['paragraph:\ty1']);
        expectSaveKeepsDocument(editor);
    });

    it('T7: list items pasted without their list, into a paragraph of an item, are a list of that item', () => {
        const source = '- a\n\n  pqrs\n- z';
        const editor = load(source);

        selectText(editor, ['pqrs', 2], ['pqrs', 2]);
        update(editor, () => {
            const items = ['one', 'two'].map((text) => $createListItemNode().append($createTextNode(text)));

            $insertGeneratedNodes(lexicalOf(editor), items, $getSelection()!);
        });

        expect(expectSaveKeepsDocument(editor)).toBe('- a\n\n  pq\n\n  - one\n  - two\n\n  rs\n\n- z');
        expectUndoRestores(editor, load(source).getValue());
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

describe('blocks pasted into a block that a list item holds become blocks of the item (Y rows)', () => {
    // Lexical inserts blocks pasted into a block that stands inside another block as one line of text; a paragraph,
    // heading or quote of a list item is such a block. The editor's own handler splits the block at the caret
    // instead, as a paste at the top level splits a paragraph: the second half joins the last pasted block when
    // that is a block of text, and stays a block of its own after a pasted list or table.
    const ITEMS: Clipboard = { name: 'list', source: '- k\n- m\n\nzz', from: ['k', 0], to: ['m', 1], types: ['list'] };
    const TEXT: Clipboard = { name: 'text', source: 'P1 zz', from: ['P1 zz', 0], to: ['P1 zz', 2], types: ['text'] };

    const PARAGRAPH_TABLE: Clipboard = {
        name: 'paragraph, table', source: 'P1\n\n| h |\n| --- |\n| c |', from: ['P1', 0], to: ['c', 1], types: ['paragraph', 'table'],
    };

    it.each<[string, string, Clipboard, TextPoint, string]>([
        ['Y1: paragraphs into an item\'s paragraph', '- x\n\n  cd\n- z', PARAGRAPHS, ['cd', 1], '- x\n\n  cP1\n\n  P2d\n\n- z'],
        ['Y2: paragraphs into an item\'s heading', '- x\n\n  ## cd\n- z', PARAGRAPHS, ['cd', 1], '- x\n\n  ## cP1\n\n  P2d\n\n- z'],
        ['Y3: paragraphs into an item\'s quote', '- x\n\n  > cd\n- z', PARAGRAPHS, ['cd', 1], '- x\n\n  > cP1\n\n  P2d\n\n- z'],
        ['Y4: a list into an item\'s paragraph', '- x\n\n  cd\n- z', ITEMS, ['cd', 1], '- x\n\n  c\n\n  - k\n  - m\n\n  d\n\n- z'],
        ['Y5: a table and a paragraph into an item\'s paragraph', '- x\n\n  cd\n- z', TABLE, ['cd', 1],
            '- x\n\n  c\n\n  | h |\n  | --- |\n  | c |\n\n  P2d\n\n- z'],
        ['Y6: a heading and a paragraph at the end of a paragraph after an item\'s nested list', '- a\n  - b\n\n  cd\n- z', HEADING, ['cd', 2],
            '- a\n  - b\n\n  cdH\n\n  P2\n\n- z'],
        ['Y7: paragraphs at the start of an item\'s paragraph', '- x\n\n  cd\n- z', PARAGRAPHS, ['cd', 0], '- x\n\n  P1\n\n  P2cd\n\n- z'],
        ['Y8: text alone goes in as text, as before (control)', '- x\n\n  cd\n- z', TEXT, ['cd', 1], '- x\n\n  cP1d\n\n- z'],
        ['Y9: a paragraph and a table: the second half stays a paragraph after the table, out of its last cell', '- x\n\n  cd\n- z', PARAGRAPH_TABLE,
            ['cd', 1], '- x\n\n  cP1\n\n  | h |\n  | --- |\n  | c |\n\n  d\n\n- z'],
        ['Y10: the list of Y4 into a top-level paragraph leaves the second half a paragraph after the list too (control)', 'cd', ITEMS, ['cd', 1],
            'c\n\n- k\n- m\n\nd'],
        ['Y11: the table of Y9 into a top-level paragraph (control)', 'cd', PARAGRAPH_TABLE, ['cd', 1], 'cP1\n\n| h |\n| --- |\n| c |\n\nd'],
        ['Y12: a heading and a paragraph at the start of an item\'s paragraph: the heading stays a heading', '- x\n\n  cd\n- z', HEADING, ['cd', 0],
            '- x\n\n  ## H\n\n  P2cd\n\n- z'],
        ['Y13: paragraphs at the start of an item\'s heading, which Lexical\'s split there replaces by an empty paragraph', '- x\n\n  ## cd\n- z', PARAGRAPHS,
            ['cd', 0], '- x\n\n  P1\n\n  P2cd\n\n- z'],
    ])('%s', (_name, source, clipboard, at, saved) => {
        const nodes = copyOf(clipboard);
        const editor = load(source);

        expect(nodes.map((node) => node.type)).toEqual(clipboard.types);

        selectText(editor, at, at);
        pasteNodes(editor, nodes);

        expect(expectSaveKeepsDocument(editor)).toBe(saved);
        // The half of the split block that the paste left empty is gone.
        expect(lexicalOf(editor).read(() => $dfs($getRoot()).filter(({ node }) => $isElementNode(node) && node.getType() === 'paragraph' && node.isEmpty()))).toEqual([]);
        expectUndoRestores(editor, source);
    });
});

describe('a list pasted at the text of an item leaves what the item holds with the text it followed (Q rows)', () => {
    // A pasted list stands as a list of its own after the caret's item until the lists are joined, and the second
    // half of the item's text joins its last item. What the item held after its text goes to that item with it,
    // a nested list included: left behind, the nested list would be saved as an item of its own (`- - n`).
    const ITEMS: Clipboard = { name: 'list', source: '- k\n- m\n\nzz', from: ['k', 0], to: ['m', 1], types: ['list'] };

    it.each<[string, string, Clipboard, TextPoint, string]>([
        ['Q1: a paragraph of the item', '- w1\n\n  p2\n- z', ITEMS, ['w1', 1], '- w\n\n- k\n\n- m1\n\n  p2\n\n- z'],
        ['Q2: a nested list of the item', '- w1\n  - n\n- z', ITEMS, ['w1', 1], '- w\n- k\n- m1\n  - n\n- z'],
        ['Q3: a paragraph and a quote, the caret at the start of the text', '- a\n- w1\n\n  p2\n\n  > q\n- z', ITEMS, ['w1', 0],
            '- a\n\n- k\n\n- mw1\n\n  p2\n\n  > q\n\n- z'],
        ['Q4: in a nested item', '- a\n  - w1\n\n    p2\n- z', ITEMS, ['w1', 1], '- a\n  - w\n\n  - k\n\n  - m1\n\n    p2\n- z'],
        ['Q5: a list and a paragraph split the list, and the item\'s paragraph follows the text it followed (control)', '- w1\n\n  p2\n- z', LIST,
            ['w1', 1], '- w\n- x\n- y\n\nP21\n\np2\n\n- z'],
        // Known result: the text after the caret joins the deepest of the pasted items, where Lexical puts the caret,
        // while what the item held follows the last top-level pasted item. The order is kept and nothing is lost.
        ['Q10: a list of nested items in the text of an item holding a paragraph', '- xy\n\n  r\n- z',
            { name: 'list', source: '- a\n  - b\n    - c', from: ['a', 0], to: ['c', 1], types: ['list'] }, ['xy', 1],
            '- x\n\n- a\n  - b\n    - cy\n\n  r\n\n- z'],
        // The caret's list is left with one item of one block, which no save can write loose, before it takes the pasted items.
        ['Q6: a list and a paragraph at the end of the text of a list\'s only item leave a tight list', '- w1\n\n  p2', LIST, ['w1', 2],
            '- w1\n- x\n- y\n\nP2\n\np2'],
        // The same rule in a loose list of two items: its first item is one item of one block once the list is split
        // after it, so the joined list is tight wherever in that item's text the caret was.
        ['Q7: a list at the end of the text of a loose list\'s first item leaves a tight list, as inside that text', '- w1\n\n- z', ITEMS, ['w1', 2],
            '- w1\n- k\n- m\n- z'],
        ['Q8: a list inside the text of a loose list\'s first item (control)', '- w1\n\n- z', ITEMS, ['w1', 1], '- w\n- k\n- m1\n- z'],
        ['Q9: a list in the text of a later item of a loose list leaves it loose', '- a\n\n- w1\n\n- z', ITEMS, ['w1', 1],
            '- a\n\n- w\n\n- k\n\n- m1\n\n- z'],
    ])('%s', (_name, source, clipboard, at, saved) => {
        const nodes = copyOf(clipboard);
        const editor = load(source);

        selectText(editor, at, at);
        pasteNodes(editor, nodes);

        expect(expectSaveKeepsDocument(editor)).toBe(saved);
        expectUndoRestores(editor, load(source).getValue());
    });
});

describe('a paste where an item has no line of text goes in order, and stays in what the save writes (E rows)', () => {
    // Lexical splits the caret's block for pasted blocks only when the block holds something. An item's text that
    // was emptied over a nested list is no such block: its item is split after it all the same, so what the item
    // holds follows the pasted blocks as it follows the second half of a text that held something.
    const EMPTIED = '- a\n- bc\n  - n\n\n  e\n- z';
    const ITEMS: Clipboard = { name: 'list', source: '- k\n- m\n\nzz', from: ['k', 0], to: ['m', 1], types: ['list'] };

    it.each<[string, Clipboard, string]>([
        ['E1: a table and a paragraph: the item\'s nested list follows them, in an item', TABLE,
            '- a\n\n| h |\n| --- |\n| c |\n\nP2\n\n- - n\n\n  e\n\n- z'],
        ['E2: a list: what the item held follows the last pasted item', ITEMS, '- a\n\n- k\n\n- m\n  - n\n\n  e\n\n- z'],
        ['E3: paragraphs: the first is the item\'s text', PARAGRAPHS, '- a\n\n- P1\n\nP2\n\n- - n\n\n  e\n\n- z'],
    ])('%s', (_name, clipboard, saved) => {
        const nodes = copyOf(clipboard);
        const editor = load(EMPTIED);

        selectText(editor, ['bc', 0], ['bc', 2]);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
        expect(editor.getValue(), 'the emptied text').toBe('- a\n\n- - n\n\n  e\n\n- z');

        pasteNodes(editor, nodes);

        expect(expectSaveKeepsDocument(editor)).toBe(saved);
    });

    it.each<[string, string, TextPoint, TextPoint, Clipboard, string]>([
        ['E5: paragraphs over all of a text above a paragraph', '- ab\n\n  p\n- z', ['ab', 0], ['ab', 2], PARAGRAPHS, '- P1\n\nP2\n\np\n\n- z'],
        ['E6: a list over all of it: the paragraph follows the last pasted item', '- ab\n\n  p\n- z', ['ab', 0], ['ab', 2], ITEMS,
            '- k\n\n- m\n\n  p\n\n- z'],
        ['E7: a table and a paragraph over all of it', '- ab\n\n  p\n- z', ['ab', 0], ['ab', 2], TABLE, '| h |\n| --- |\n| c |\n\nP2\n\np\n\n- z'],
        ['E8: a list over all of the text of a later item: its paragraph does not go to the item before', '- j\n- ab\n\n  p\n- z', ['ab', 0], ['ab', 2], ITEMS,
            '- j\n\n- k\n\n- m\n\n  p\n\n- z'],
        ['E9: a table over all of a text above a nested list', '- ab\n  - n\n- z', ['ab', 0], ['ab', 2], TABLE,
            '| h |\n| --- |\n| c |\n\nP2\n\n- - n\n- z'],
        ['E10: paragraphs over a range from the start of the text to the end of the item\'s first paragraph', '- ab\n\n  pq\n\n  r\n- z', ['ab', 0],
            ['pq', 2], PARAGRAPHS, '- P1\n\nP2\n\nr\n\n- z'],
    ])('%s (the range is emptied first)', (_name, source, from, to, clipboard, saved) => {
        // Blocks pasted over a range that empties the text go in as they do at a text that was empty already.
        const nodes = copyOf(clipboard);
        const editor = load(source);

        selectText(editor, from, to);
        pasteNodes(editor, nodes);

        expect(expectSaveKeepsDocument(editor)).toBe(saved);
        expectUndoRestores(editor, load(source).getValue());
    });

    it('E4: paragraphs pasted with the caret between the blocks of an item become blocks of the item there', () => {
        const nodes = copyOf(PARAGRAPHS);
        const source = '- a\n- bc\n\n  pq\n  - n\n\n  e\n- z';
        const editor = load(source);

        update(editor, () => {
            const item = $textNode('bc').getParentOrThrow().getParentOrThrow();
            const selection = $createRangeSelection();

            selection.anchor.set(item.getKey(), 1, 'element');
            selection.focus.set(item.getKey(), 1, 'element');
            $setSelection(selection);
        });
        pasteNodes(editor, nodes);

        expect(expectSaveKeepsDocument(editor)).toBe('- a\n\n- bc\n\n  P1\n\n  P2\n\n  pq\n\n  - n\n\n  e\n\n- z');
        expectUndoRestores(editor, load(source).getValue());
    });
});

describe('a copy takes a list item with its text', () => {
    /**
     * Copied nodes as nested node types, a text node as its text.
     *
     * @param nodes - The copied nodes.
     * @returns One string per top-level node, joined by ` | `.
     */
    const copiedShape = (nodes: CopiedNodes): string => {
        const shape = (node: { type: string; text?: string; children?: unknown[] }): string => (node.text !== undefined
            ? JSON.stringify(node.text)
            : `${node.type}(${(node.children ?? []).map((child) => shape(child as never)).join(', ')})`);

        return nodes.map((node) => shape(node as never)).join(' | ');
    };

    it.each<[string, string, TextPoint, TextPoint, string]>([
        ['C1: from an item\'s text into its paragraph: the item, holding both', '- abc\n\n  pqr\n- z', ['abc', 1], ['pqr', 2],
            'list(markdown-list-item(markdown-list-item-text("bc"), paragraph("pq")))'],
        ['C2: from an item\'s text into its nested list: the item, holding both', '- abc\n  - n\n- z', ['abc', 1], ['n', 1],
            'list(markdown-list-item(markdown-list-item-text("bc"), list(markdown-list-item(markdown-list-item-text("n")))))'],
        ['C3: all of an item\'s text, the item holding nothing else: the item', '- abc\n- z', ['abc', 0], ['abc', 3], 'list(markdown-list-item(markdown-list-item-text("abc")))'],
        ['C4: part of an item\'s text: the text alone', '- abc\n- z', ['abc', 1], ['abc', 2], '"b"'],
        ['C5: all of an item\'s text, the item holding a paragraph too: the text alone', '- abc\n\n  pqr\n- z', ['abc', 0], ['abc', 3], '"abc"'],
        ['C6: from one paragraph of an item into the next: the paragraphs, without the item', '- abc\n\n  pqr\n\n  stu\n- z', ['pqr', 1], ['stu', 2],
            'paragraph("qr") | paragraph("st")'],
        ['C7: from one item into the next: both items', '- abc\n- xyz', ['abc', 1], ['xyz', 2], 'list(markdown-list-item(markdown-list-item-text("bc")), markdown-list-item(markdown-list-item-text("xy")))'],
    ])('%s', (_name, source, from, to, shape) => {
        expect(copiedShape(copyOf({ name: 'copy', source, from, to, types: [] }))).toBe(shape);
    });

    it('C8: the item copied from its text into its paragraph is pasted as an item holding both', () => {
        const nodes = copyOf({ name: 'copy', source: '- abc\n\n  pqr\n- z', from: ['abc', 1], to: ['pqr', 2], types: [] });
        const editor = load('bcd');

        selectText(editor, ['bcd', 1], ['bcd', 1]);
        pasteNodes(editor, nodes);

        expect(expectSaveKeepsDocument(editor)).toBe('b\n\n- bc\n\n  pq\n\ncd');
        expectUndoRestores(editor, 'bcd');
    });
});

describe('a list item whose text stands straight in it, as one built from pasted HTML, is pasted into a code block as its blocks', () => {
    it('the text and the paragraph after it are set apart, as two blocks of an item are', () => {
        const editor = load('```\nbcd\n```');

        selectText(editor, ['bcd', 1], ['bcd', 1]);
        update(editor, () => {
            // Built as Lexical's HTML import builds an item: inline nodes straight in it, which only the editor's
            // rules, run after the insert, give a text node.
            const item = $createListItemNode().append($createTextNode('a'), $createParagraphNode().append($createTextNode('p')));
            const list = $createListNode('bullet').append(item, $createListItemNode().append($createTextNode('k')));

            lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes: [list], selection: $getSelection()! });
        });

        expect(editor.getValue()).toBe('```\nba\n\np\n\nkcd\n```');
    });
});

describe('a paste into a raw block that leaves the caret on an empty line keeps a usable selection (RC rows)', () => {
    // The pasted lines close the raw block and open another, so its text reads as two blocks and the editor shows
    // them; the caret goes back to the place in the text it stood at, which here is a line holding no text.
    const PRE = '<pre>\nx1\nx2\n</pre>';
    /** Text that closes a `<pre>` block and opens another, ending on two empty lines. */
    const SPLIT = '\n</pre>\n\n<pre>\n\n';

    /** Where a caret stands: its point, and the node the point is on. */
    interface Caret {
        readonly type:       'text' | 'element';
        readonly offset:     number;
        /** The node's Lexical type, or its text for a text node. */
        readonly on:         string;
        /** The index of the top-level block that holds the node, when the row pins it. */
        readonly rootChild?: number;
    }

    /** One row: a document, the text pasted at a point of it, and what the paste leaves. */
    interface CaretRow {
        readonly name:   string;
        readonly source: string;
        readonly text:   string;
        /** Text typed after the paste, at the caret the paste leaves. */
        readonly typed?: string;
        /** The save after the paste and the typing, when the row pins it. */
        readonly saved?: string;
        /** The caret after the paste, when the row pins it. */
        readonly caret?: Caret;
    }

    /**
     * Reads the selection as a caret.
     *
     * @param editor - The editor.
     * @param withRootChild - Whether to name the top-level block that holds the caret.
     * @returns The caret, or `null` when the selection is not a collapsed range.
     */
    const caretOf = (editor: MarkdownEditor, withRootChild: boolean): Caret | null => lexicalOf(editor).read(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
            return null;
        }

        const node = selection.anchor.getNode();
        const caret = { type: selection.anchor.type, offset: selection.anchor.offset, on: $isTextNode(node) ? node.getTextContent() : node.getType() };

        return withRootChild ? { ...caret, rootChild: node.getTopLevelElementOrThrow().getIndexWithinParent() } : caret;
    });

    it.each<CaretRow>([
        {
            name:   'RC1: a paste ending on two empty lines leaves the caret on the second',
            source: PRE,
            text:   SPLIT,
            saved:  '<pre>\nx1\n</pre>\n\n<pre>\n\n\nx2\n</pre>',
            caret:  { type: 'element', offset: 3, on: 'markdown-raw-block', rootChild: 1 },
        },
        {
            name:   'RC2: a paste ending on one empty line leaves the caret on it',
            source: PRE,
            text:   '\n</pre>\n\n<pre>\n',
            saved:  '<pre>\nx1\n</pre>\n\n<pre>\n\nx2\n</pre>',
            caret:  { type: 'element', offset: 2, on: 'markdown-raw-block', rootChild: 1 },
        },
        {
            name:   'RC3: the same in a comment',
            source: '<!-- a\nx1\nx2\n-->',
            text:   '\n-->\n\n<!--\n\n',
            saved:  '<!-- a\nx1\n-->\n\n<!--\n\n\nx2\n-->',
            caret:  { type: 'element', offset: 3, on: 'markdown-raw-block', rootChild: 1 },
        },
        {
            name:   'RC4: the same between two paragraphs',
            source: `a\n\n${PRE}\n\nb`,
            text:   SPLIT,
            saved:  'a\n\n<pre>\nx1\n</pre>\n\n<pre>\n\n\nx2\n</pre>\n\nb',
            caret:  { type: 'element', offset: 3, on: 'markdown-raw-block', rootChild: 2 },
        },
        {
            name:   'RC5: the same in a raw block of a list item',
            source: '- a\n\n  <pre>\n  x1\n  x2\n  </pre>\n- b',
            text:   SPLIT,
            caret:  { type: 'element', offset: 3, on: 'markdown-raw-block' },
        },
        {
            name:   'RC6: text typed after the paste goes onto the empty line the caret stands on',
            source: PRE,
            text:   SPLIT,
            typed:  'Y',
            saved:  '<pre>\nx1\n</pre>\n\n<pre>\n\nY\nx2\n</pre>',
        },
        {
            name:   'RC7: a paste ending on a line of text leaves the caret in that text (control)',
            source: PRE,
            text:   '\n</pre>\n\n<pre>',
            saved:  '<pre>\nx1\n</pre>\n\n<pre>\nx2\n</pre>',
            caret:  { type: 'text', offset: 5, on: '<pre>', rootChild: 1 },
        },
    ])('$name', ({ source, text, typed, saved, caret }) => {
        const editor = load(source);

        selectText(editor, ['x1', 2], ['x1', 2]);

        expect(() => pasteText(editor, text)).not.toThrow();

        if (caret !== undefined) {
            expect(caretOf(editor, caret.rootChild !== undefined)).toEqual(caret);
        }

        expect(() => lexicalOf(editor).read(() => $getSelection()!.getNodes())).not.toThrow();

        if (typed !== undefined) {
            lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, typed);
        }

        if (saved !== undefined) {
            expect(editor.getValue()).toBe(saved);
        }

        expectSaveKeepsDocument(editor);

        // The paste and the two blocks the editor then shows are one step: one undo brings the document back.
        if (typed === undefined) {
            expectUndoRestores(editor, source);
        }
    });

    it('RC8: copied nodes pasted into a raw block whose text then reads as several blocks leave a usable selection', () => {
        const source = 'w0\n\n<pre>\nx1\n\nx2\n</pre>\n\n<pre>\nx3\n\nx4\n</pre>';
        const editor = load(source);

        selectText(editor, ['x2', 2], ['x4', 0]);

        const nodes = copySelection(editor);

        selectText(editor, ['x3', 2], ['x3', 2]);

        expect(() => pasteNodes(editor, nodes)).not.toThrow();
        expect(() => lexicalOf(editor).read(() => $getSelection()!.getNodes())).not.toThrow();

        const saved = editor.getValue();

        expect(load(saved).getValue()).toBe(saved);
        expectUndoRestores(editor, source);
    });
});

describe('a paste over a range that takes a list item\'s text whole goes in at the caret its removal leaves (CI rows)', () => {
    /** A second item holding a paragraph, a nested list and a paragraph. */
    const A = '- ab\n- cd\n\n  pq\n  - nn\n\n  rr\n- z';
    /** A second item holding two paragraphs. */
    const B = '- ab\n- cd\n\n  pq\n\n  rr\n- z';
    const ITEMS: Clipboard = { name: 'list', source: '- k\n- m\n\nzz', from: ['k', 0], to: ['m', 1], types: ['list'] };
    const WORD: Clipboard = { name: 'bold word', source: 'x **zp** y', from: ['zp', 0], to: ['zp', 2], types: ['text'] };

    it.each<[string, Clipboard | string, string, string]>([
        ['CI60: paragraphs', PARAGRAPHS, A, '- aP1\n\nP2q\n\n- - nn\n\n  rr\n\n- z'],
        ['CI61: paragraphs, a paragraph left', PARAGRAPHS, B, '- aP1\n\nP2q\n\nrr\n\n- z'],
        ['CI62: items', ITEMS, A, '- a\n\n- k\n\n- mq\n  - nn\n\n  rr\n\n- z'],
        ['CI63: a bold word', WORD, A, '- a**zp**q\n  - nn\n\n  rr\n\n- z'],
        ['CI64: the text zc', 'zc', A, '- azcq\n  - nn\n\n  rr\n\n- z'],
        ['CI65: the text T1, a line end, T2', 'T1\nT2', A, '- aT1\n\n- T2q\n  - nn\n\n  rr\n\n- z'],
    ])('%s', (_name, clipboard, source, saved) => {
        const editor = load(source);

        selectText(editor, ['ab', 1], ['pq', 1]);

        if (typeof clipboard === 'string') {
            pasteText(editor, clipboard);
        } else {
            pasteNodes(editor, copyOf(clipboard));
        }

        expect(expectSaveKeepsDocument(editor)).toBe(saved);
        expectUndoRestores(editor, load(source).getValue());
    });
});
