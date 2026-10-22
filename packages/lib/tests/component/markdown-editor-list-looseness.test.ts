// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createParagraphNode, $createRangeSelection, $createTextNode, $getRoot, $getSelection, $getState, $isElementNode, $isTextNode, $setSelection,
    KEY_ENTER_COMMAND, REDO_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { LexicalEditor, LexicalNode } from 'lexical';
import { $isListItemNode, $isListNode } from '@lexical/list';
import type { ListItemNode } from '@lexical/list';
import { $generateJSONFromSelectedNodes, $generateNodesFromSerializedNodes, $insertGeneratedNodes } from '@lexical/clipboard';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { listLooseState } from '~/component/editor/markdownNodeState';
import { $listReadsLoose } from '~/component/editor/markdownSerializer';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

// Wraps the whole-list looseness read in a spy that still reads, so a test can
// count how often an edit reads a whole list; every other test sees it unchanged.
vi.mock('~/component/editor/markdownSerializer.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/component/editor/markdownSerializer.js')>();

    return { ...actual, $listReadsLoose: vi.fn(actual.$listReadsLoose) };
});

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

/** The document as a tree: each list with its looseness, each text as written. */
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
        return `${node.getType()}(${node.getChildren().map(tree).join(', ')})`;
    }

    return node.getType();
}

function shown(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => $getRoot().getChildren().map(tree).join(' | '));
}

/** Selects from `offset` in the text node reading `from` to `offset` in the one reading `to`. */
function select(editor: MarkdownEditor, from: string, to: string = from, offset: number = 1): void {
    lexicalOf(editor).update(() => {
        const texts = $getRoot().getAllTextNodes();
        const selection = $createRangeSelection();

        selection.anchor.set(texts.find((node) => node.getTextContent() === from)!.getKey(), offset, 'text');
        selection.focus.set(texts.find((node) => node.getTextContent() === to)!.getKey(), offset, 'text');
        $setSelection(selection);
    }, { discrete: true });
}

/** Runs `edit` on the list item whose text reads `text`, in an update of its own. */
function editItem(editor: MarkdownEditor, text: string, edit: (item: ListItemNode) => void): void {
    lexicalOf(editor).update(() => {
        const node = $getRoot().getAllTextNodes().find((candidate) => candidate.getTextContent() === text)!;
        const item = node.getParents().find($isListItemNode)!;

        edit(item);
    }, { discrete: true });
}

function addParagraph(item: ListItemNode): void {
    item.append($createParagraphNode().append($createTextNode('more')));
}

function addBlankParagraph(item: ListItemNode): void {
    item.append($createParagraphNode().append($createTextNode(' ')));
}

function dropLastBlock(item: ListItemNode): void {
    item.getLastChild()!.remove();
}

function toggleChecked(item: ListItemNode): void {
    item.setChecked(item.getChecked() !== true);
}

/** Pastes the whole of `source`, loaded in an editor of its own, at the selection. */
function paste(editor: MarkdownEditor, source: string): void {
    const origin = load(source);
    const originLexical = lexicalOf(origin);

    originLexical.update(() => {
        const texts = $getRoot().getAllTextNodes();
        const selection = $createRangeSelection();

        selection.anchor.set(texts[0]!.getKey(), 0, 'text');
        selection.focus.set(texts[texts.length - 1]!.getKey(), texts[texts.length - 1]!.getTextContentSize(), 'text');
        $setSelection(selection);
    }, { discrete: true });

    const nodes = originLexical.read(() => $generateJSONFromSelectedNodes(originLexical, $getSelection()).nodes);
    const lexical = lexicalOf(editor);

    origin.dispose();
    lexical.update(() => {
        $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), $getSelection()!);
    }, { discrete: true });
}

const tight = (count: number): string => Array.from({ length: count }, (_, index) => `- item${index}`).join('\n');
const paragraphs = (count: number): string => Array.from({ length: count }, (_, index) => `para${index}`).join('\n\n');

describe('list looseness: what an edit of one item reads', () => {
    /**
     * The most whole-list reads one edit may make, whatever the list's length.
     * The edits below make 2 to 9 (measured: C1 to C4 make 2, C5 4, C6 9, the
     * pastes counting the load of the copied list); before this rule an edit
     * made one for every changed item and one more for every changed item
     * text, so 26 at the least for the 40 items used here.
     */
    const WHOLE_READS_AT_MOST = 10;

    /** How many whole-list reads `edit` makes on a document of `count` items or paragraphs. */
    function wholeReads(count: number, prepare: (count: number) => MarkdownEditor | null, edit: (editor: MarkdownEditor | null, count: number) => void): number {
        const editor = prepare(count);
        const read = vi.mocked($listReadsLoose);

        read.mockClear();
        edit(editor, count);

        return read.mock.calls.length;
    }

    const ROWS: Array<[name: string, prepare: (count: number) => MarkdownEditor | null, edit: (editor: MarkdownEditor | null, count: number) => void]> = [
        ['C1: a load of a list', () => null, (_editor, count) => { load(tight(count)); }],
        ['C2: the numbered toggle over a whole bulleted list', (count) => {
            const editor = load(tight(count));

            select(editor, 'item0', `item${count - 1}`);

            return editor;
        }, (editor) => { editor!.toggleOrderedList(); }],
        ['C3: the bulleted toggle over paragraphs', (count) => {
            const editor = load(paragraphs(count));

            select(editor, 'para0', `para${count - 1}`);

            return editor;
        }, (editor) => { editor!.toggleUnorderedList(); }],
        ['C4: Enter in the middle item', (count) => {
            const editor = load(tight(count));

            select(editor, `item${count / 2}`);

            return editor;
        }, (editor) => {
            lexicalOf(editor!).dispatchCommand(KEY_ENTER_COMMAND, null);
            editor!.getValue();
        }],
        ['C5: a paste of a list into an empty document', () => {
            const editor = load('');

            lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });

            return editor;
        }, (editor, count) => { paste(editor!, tight(count)); }],
        ['C6: a paste of a loose list into the middle item', (count) => {
            const editor = load(tight(count));

            select(editor, `item${count / 2}`);

            return editor;
        }, (editor, count) => { paste(editor!, Array.from({ length: count }, (_, index) => `- new${index}`).join('\n\n')); }],
    ];

    for (const [name, prepare, edit] of ROWS) {
        it(`${name} reads a whole list a fixed number of times`, () => {
            const short = wholeReads(20, prepare, edit);
            const long = wholeReads(40, prepare, edit);

            expect(long).toBe(short);
            expect(long).toBeLessThanOrEqual(WHOLE_READS_AT_MOST);
        });
    }

    it('C7: the first changed item of each update reads its list whole, once', () => {
        const editor = load(tight(6));
        const read = vi.mocked($listReadsLoose);

        read.mockClear();
        editItem(editor, 'item2', toggleChecked);

        expect(read).toHaveBeenCalledTimes(1);

        read.mockClear();
        editItem(editor, 'item4', toggleChecked);

        expect(read).toHaveBeenCalledTimes(1);
    });

    it('C8: the update that follows an undo reads the list whole again', () => {
        const editor = load(tight(6));
        const read = vi.mocked($listReadsLoose);

        editItem(editor, 'item2', addParagraph);
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        editor.getValue();
        read.mockClear();
        editItem(editor, 'item2', toggleChecked);

        expect(read).toHaveBeenCalledTimes(1);
    });
});

describe('list looseness: what an edit of one item leaves', () => {
    it.each([
        ['L1: a block added to an item of a tight list', '- a\n- b\n- c', 'b', addParagraph,
            'loose(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text("b"), paragraph("more")), markdown-list-item(markdown-list-item-text("c")))',
            '- a\n\n- b\n\n  more\n\n- c'],
        ['L2: the block that made a list of several items loose is removed', '- a\n- b\n\n  two\n- c', 'b', dropLastBlock,
            'loose(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text("b")), markdown-list-item(markdown-list-item-text("c")))',
            '- a\n\n- b\n\n- c'],
        ['L3: a list of one item loses its second block', '- a\n\n  two', 'a', dropLastBlock,
            'tight(markdown-list-item(markdown-list-item-text("a")))',
            '- a'],
        ['L4: a block added to an item of a nested list', '- a\n  - n\n  - m\n- b', 'n', addParagraph,
            'tight(markdown-list-item(markdown-list-item-text("a"), loose(markdown-list-item(markdown-list-item-text("n"), paragraph("more")), markdown-list-item(markdown-list-item-text("m")))), markdown-list-item(markdown-list-item-text("b")))',
            '- a\n  - n\n\n    more\n\n  - m\n- b'],
        ['L5: an item of one of two lists a load keeps apart is ticked', '- a\n-\n\n\n- b\n- c', 'a', toggleChecked,
            'tight(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text())) | tight(markdown-list-item(markdown-list-item-text("b")), markdown-list-item(markdown-list-item-text("c")))',
            '- a\n-\n\n\n- b\n- c'],
    ] as const)('%s', (_name, source, text, edit, expectedTree, expectedSave) => {
        const editor = load(source);

        editItem(editor, text, edit);

        expect(shown(editor)).toBe(expectedTree);
        expect(editor.getValue()).toBe(expectedSave);
        expect(load(editor.getValue()).getValue()).toBe(expectedSave);
    });

    it('L6: two blocks added to two items in one update, then removed in one update', () => {
        const editor = load('- a\n- b\n- c');

        lexicalOf(editor).update(() => {
            $getRoot().getAllTextNodes().filter((node) => node.getTextContent() !== 'b').forEach((node) => addParagraph(node.getParents().find($isListItemNode)!));
        }, { discrete: true });

        expect(editor.getValue()).toBe('- a\n\n  more\n\n- b\n\n- c\n\n  more');

        lexicalOf(editor).update(() => {
            $getRoot().getAllTextNodes().filter((node) => node.getTextContent() === 'more').forEach((node) => node.getParentOrThrow().remove());
        }, { discrete: true });

        expect(editor.getValue()).toBe('- a\n\n- b\n\n- c');
    });

    it('L7: one undo takes back a toggle over a whole list, and one redo brings it back', () => {
        const editor = load(tight(5));
        const before = editor.getValue();

        select(editor, 'item0', 'item4');
        editor.toggleOrderedList();

        const after = editor.getValue();

        expect(after).toBe('1. item0\n2. item1\n3. item2\n4. item3\n5. item4');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(before);

        lexicalOf(editor).dispatchCommand(REDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(after);
    });

    it('L8: a list another item made loose unnoticed turns loose when one of its items changes', () => {
        const editor = load('- a\n- b\n- c');

        // The row builds this state artificially: a paragraph holding a space writes nothing, so the list stays tight,
        // and its text then changes with `skipTransforms`, so no looseness rule reads the item. No user edit on this
        // base is known to reach this state; the row pins the first whole read as a safety net.
        editItem(editor, 'a', addBlankParagraph);
        lexicalOf(editor).update(() => {
            $getRoot().getAllTextNodes().find((node) => node.getTextContent() === ' ')!.setTextContent('<div>');
        }, { discrete: true, skipTransforms: true });
        editor.getValue();
        editItem(editor, 'c', toggleChecked);

        expect(shown(editor)).toBe('loose(markdown-list-item(markdown-list-item-text("a"), paragraph("<div>")), markdown-list-item(markdown-list-item-text("b")), markdown-list-item(markdown-list-item-text("c")))');
        expect(editor.getValue()).toBe('- a\n\n  \\<div>\n\n- b\n\n- c');
    });
});
