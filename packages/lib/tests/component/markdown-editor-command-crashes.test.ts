// Keeps `@lexical/clipboard`'s real module (`@lexical/rich-text` imports it
// for its paste path) and replaces only `copyToClipboard`, which needs a
// browser clipboard the test DOM does not have.
vi.mock('@lexical/clipboard', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@lexical/clipboard')>()),
    copyToClipboard: vi.fn(async () => true),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createParagraphNode, $createRangeSelection, $createTextNode, $getRoot, $getSelection, $isRangeSelection, $isTextNode,
    $setSelection, CONTROLLED_TEXT_INSERTION_COMMAND, CUT_COMMAND, DELETE_CHARACTER_COMMAND, INSERT_LINE_BREAK_COMMAND,
    INSERT_PARAGRAPH_COMMAND, INTERNAL_$isBlock, KEY_ENTER_COMMAND, PASTE_COMMAND, SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, createEditor,
} from 'lexical';
import type { ElementNode, Klass, LexicalEditor, LexicalNode, PointType, RangeSelection, TextNode } from 'lexical';
import { $createListItemNode, $createListNode, $isListNode, ListItemNode, ListNode } from '@lexical/list';
import { $createLinkNode, $toggleLink, LinkNode } from '@lexical/link';
import { copyToClipboard } from '@lexical/clipboard';
import type { TableCellNode } from '@lexical/table';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $isMarkdownBlockNode } from '~/component/editor/markdownBlockNode';
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
    vi.mocked(copyToClipboard).mockClear();
});

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

/**
 * Describes where a point is: `"text"@offset` for a text point,
 * `type@offset` (the node's Lexical type) for an element point.
 *
 * @param point - The point to describe.
 * @returns The description.
 */
function $describePoint(point: PointType): string {
    const node = point.getNode();

    return point.type === 'text' ? `${JSON.stringify(node.getTextContent())}@${point.offset}` : `${node.getType()}@${point.offset}`;
}

/**
 * Describes the editor's selection as `anchor -> focus`, each end as
 * {@link $describePoint} describes it, or says it is not a range selection.
 *
 * @param editor - The editor.
 * @returns The selection's description.
 */
function rangeOf(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection)) {
            return 'no range';
        }

        return `${$describePoint(selection.anchor)} -> ${$describePoint(selection.focus)}`;
    });
}

/**
 * The text content of each child of the root, each prefixed with its Lexical
 * type.
 *
 * @param editor - The editor.
 * @returns One `type:text` entry per child of the root.
 */
function rootChildren(editor: MarkdownEditor): string[] {
    return lexicalOf(editor).read(() => $getRoot().getChildren().map((child) => `${child.getType()}:${child.getTextContent()}`));
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

describe('toggleLink(null) leaves a link the selection only touches (L rows)', () => {
    it('L1: a selection ending at a link\'s start', () => {
        const editor = load('a [b](u) c');

        selectText(editor, ['a ', 0], ['b', 0]);
        editor.toggleLink(null);

        expect(editor.getValue()).toBe('a [b](u) c');
    });

    it('L2: a backward selection starting at a link\'s end', () => {
        const editor = load('a [b](u) c');

        selectText(editor, [' c', 1], ['b', 1]);
        editor.toggleLink(null);

        expect(editor.getValue()).toBe('a [b](u) c');
    });

    it('L3: a selection from an earlier paragraph to a link\'s start', () => {
        const editor = load('x\n\n[b](u) c');

        selectText(editor, ['x', 0], ['b', 0]);
        editor.toggleLink(null);

        expect(editor.getValue()).toBe('x\n\n[b](u) c');
    });

    it('L4: a selection touching two links, at one\'s end and the other\'s start', () => {
        const editor = load('[a](u) x [b](v)');

        selectText(editor, ['a', 1], ['b', 0]);
        editor.toggleLink(null);

        expect(editor.getValue()).toBe('[a](u) x [b](v)');
    });

    it('L5: a selection covering a link\'s text unlinks it, as before', () => {
        const editor = load('a [b](u) c');

        selectText(editor, ['a ', 0], ['b', 1]);
        editor.toggleLink(null);

        expect(editor.getValue()).toBe('a b c');
    });

    it('L6: a selection holding part of two links unlinks only those parts, as before', () => {
        const editor = load('[ab](u) x [cd](v)');

        selectText(editor, ['ab', 1], ['cd', 1]);
        editor.toggleLink(null);

        expect(editor.getValue()).toBe('[a](u)b x c[d](v)');
    });
});

/** Two paragraphs whose text nodes are `"ab "`, `"cd"`, `"efgh "`, `"ij"`, `" kl"`. */
const D = 'ab **cd**\n\nefgh **ij** kl';

/** Removing from `"ab "`@0 to `"efgh "`@3 in {@link D}. */
const D_REMOVED = 'h **ij** kl';

/** A document like {@link D} whose first text node is bold. */
const D_BOLD = '**ab** cd\n\nefgh **ij** kl';

/** A raw Markdown block (text nodes `"<div>"`, `"raw text"`, `"</div>"`), then {@link D}'s second paragraph. */
const RAW_THEN_PARA = '<div>\nraw text\n</div>\n\nefgh **ij** kl';

/** {@link D}'s first paragraph, then a raw Markdown block. */
const PARA_THEN_RAW = 'ab **cd**\n\n<div>\nraw text\n</div>';

/** Two raw Markdown blocks (text nodes `"<div>"`, `"raw one"`, `"</div>"`, then `"<section>"`, `"raw two"`, `"</section>"`) and a paragraph. */
const RAW_THEN_RAW = '<div>\nraw one\n</div>\n\n<section>\nraw two\n</section>\n\nafter';

/** A raw Markdown block whose second line opens an HTML block of its own, then two paragraphs (`"ef gh"`, `"after"`). */
const RAW_THEN_WORDS = '<div>\n<p>\nraw text\n</p>\n</div>\n\nef gh\n\nafter';

/**
 * A raw Markdown block, a paragraph of rich text (`"efgh "`, bold `"ij"`, `" kl "`, a link `"a"`, `" *x*"` with its
 * asterisks escaped) and a paragraph.
 */
const RAW_THEN_RICH = '<div>\nraw text\n</div>\n\nefgh **ij** kl [a](u) \\*x\\*\n\nafter';

describe('a range from a block start into a later block\'s word is removed without throwing (R rows)', () => {
    it('R1: cut()', () => {
        const editor = load(D);

        selectText(editor, ['ab ', 0], ['efgh ', 3]);
        editor.cut();

        expect(editor.getValue()).toBe(D_REMOVED);
        expect(() => editor.getSelectionState()).not.toThrow();
    });

    it('R2: cut() of a backward selection', () => {
        const editor = load(D);

        selectText(editor, ['efgh ', 3], ['ab ', 0]);
        editor.cut();

        expect(editor.getValue()).toBe(D_REMOVED);
    });

    it('R3: DELETE_CHARACTER_COMMAND dispatched outside an update', () => {
        const editor = load(D);

        selectText(editor, ['ab ', 0], ['efgh ', 3]);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);

        expect(editor.getValue()).toBe(D_REMOVED);
    });

    it('R4: typing over the range', () => {
        const editor = load(D);

        selectText(editor, ['ab ', 0], ['efgh ', 3]);
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('xh **ij** kl');
    });

    it('R5: typing over a range that starts in bold text types bold', () => {
        const editor = load(D_BOLD);

        selectText(editor, ['ab', 0], ['efgh ', 3]);
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('**x**h **ij** kl');
    });

    it('R6: Enter over the range', () => {
        const editor = load(D);

        selectText(editor, ['ab ', 0], ['efgh ', 3]);
        lexicalOf(editor).dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);

        expect(editor.getValue()).toBe(D_REMOVED);
        expect(lexicalOf(editor).read(() => $getRoot().getChildrenSize())).toBe(2);
    });

    it('R7: insertImage() over the range', () => {
        const editor = load(D);

        selectText(editor, ['ab ', 0], ['efgh ', 3]);
        editor.insertImage('/i.png', { alt: 'i' });

        expect(editor.getValue()).toBe('![i](/i.png)h **ij** kl');
    });

    it('R8: paste() over the range', async () => {
        const editor = load(D);

        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('zz');
        selectText(editor, ['ab ', 0], ['efgh ', 3]);
        await editor.paste();

        expect(editor.getValue()).toBe('zzh **ij** kl');
    });

    it('R9: a native cut (CUT_COMMAND) copies, then removes the range', async () => {
        const editor = load(D);

        selectText(editor, ['ab ', 0], ['efgh ', 3]);
        lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);

        await vi.waitFor(() => expect(editor.getValue()).toBe(D_REMOVED));
        expect(copyToClipboard).toHaveBeenCalledTimes(1);
    });

    it('R13: a plain-text paste (PASTE_COMMAND) over the range', () => {
        const editor = load(D);

        // `registerRichText`'s paste handler tells clipboard, drag, input and key events apart by class name.
        vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
        vi.stubGlobal('DragEvent', class DragEvent {});
        vi.stubGlobal('InputEvent', class InputEvent {});
        vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});

        const event = Object.assign(new ClipboardEvent('paste'), {
            clipboardData: { types: ['text/plain'], files: [], getData: (type: string) => (type === 'text/plain' ? 'zz' : '') },
            preventDefault: () => {},
        });

        selectText(editor, ['ab ', 0], ['efgh ', 3]);
        lexicalOf(editor).update(() => {
            lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event);
        }, { discrete: true });

        expect(editor.getValue()).toBe('zzh **ij** kl');
    });

    describe('R15: a paste that inserts nothing leaves the range as it is', () => {
        /**
         * Dispatches a paste carrying `data` and `files`, as the browser's paste event does.
         *
         * @param editor - The editor.
         * @param data - The clipboard's text, by MIME type.
         * @param files - How many files the clipboard holds.
         */
        function pasteClipboard(editor: MarkdownEditor, data: Record<string, string>, files: number = 0): void {
            // `registerRichText`'s paste handler tells clipboard, drag, input and key events apart by class name.
            vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
            vi.stubGlobal('DragEvent', class DragEvent {});
            vi.stubGlobal('InputEvent', class InputEvent {});
            vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});

            const event = Object.assign(new ClipboardEvent('paste'), {
                clipboardData: {
                    types: [...Object.keys(data), ...(files > 0 ? ['Files'] : [])],
                    files: Array.from({ length: files }, () => ({})),
                    getData: (type: string) => data[type] ?? '',
                },
                preventDefault: () => {},
            });

            lexicalOf(editor).update(() => {
                lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event);
            }, { discrete: true });
        }

        const emptyPastes: Array<[string, Record<string, string>, number]> = [
            ['a files-only clipboard (a pasted screenshot)', {}, 1],
            ['an empty clipboard', {}, 0],
            ['a clipboard whose text is empty', { 'text/plain': '' }, 0],
            ['files beside a link list, which the files take the paste from', { 'text/uri-list': 'https://u.test' }, 1],
        ];

        for (const [name, data, files] of emptyPastes) {
            it(`${name} over the stale-focus range`, () => {
                const editor = load(D);

                selectText(editor, ['ab ', 0], ['efgh ', 3]);
                pasteClipboard(editor, data, files);

                expect(editor.getValue()).toBe(D);
            });

            it(`${name} over a range in one block changes nothing either (control)`, () => {
                const editor = load(D);

                selectText(editor, ['efgh ', 1], ['efgh ', 3]);
                pasteClipboard(editor, data, files);

                expect(editor.getValue()).toBe(D);
            });
        }

        it('a paste event with no clipboard (a key event) over the stale-focus range', () => {
            const editor = load(D);

            vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
            vi.stubGlobal('DragEvent', class DragEvent {});
            vi.stubGlobal('InputEvent', class InputEvent {});
            vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});

            const event = Object.assign(new KeyboardEvent('keydown'), { preventDefault: () => {} });

            selectText(editor, ['ab ', 0], ['efgh ', 3]);
            lexicalOf(editor).update(() => {
                lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event);
            }, { discrete: true });

            expect(editor.getValue()).toBe(D);
        });

        it('pasted nodes that come to none (HTML holding only an image) over the stale-focus range', () => {
            const editor = load(D);

            selectText(editor, ['ab ', 0], ['efgh ', 3]);
            lexicalOf(editor).update(() => {
                const selection = $getSelection() as RangeSelection;

                lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes: [], selection });
            }, { discrete: true });

            expect(editor.getValue()).toBe(D);
        });

        const insertingPastes: Array<[string, Record<string, string>, number, string]> = [
            ['files beside text', { 'text/plain': 'zz' }, 1, 'zzh **ij** kl'],
            ['a link list alone', { 'text/uri-list': 'zz' }, 0, 'zzh **ij** kl'],
            ['a line break alone', { 'text/plain': '\n' }, 0, 'h **ij** kl'],
        ];

        for (const [name, data, files, saved] of insertingPastes) {
            it(`${name} still replaces the stale-focus range (control)`, () => {
                const editor = load(D);

                selectText(editor, ['ab ', 0], ['efgh ', 3]);
                pasteClipboard(editor, data, files);

                expect(editor.getValue()).toBe(saved);
            });
        }
    });

    // Markdown has no line break in a level 3–6 heading nor at a block's end, so Shift+Enter is declined where
    // the removal would leave the caret there — and a declined Shift+Enter changes nothing, range included.
    describe('R16: Shift+Enter (INSERT_LINE_BREAK_COMMAND) the removal would leave unwritable is declined, range and all', () => {
        const declined: Array<[string, string, TextPoint, TextPoint, string]> = [
            ['starting in a level 3 heading', '### head ing\n\nefgh **ij** kl', ['head ing', 2], ['efgh ', 3], '"head ing"@2 -> "efgh "@3'],
            ['the same range dragged backward', '### head ing\n\nefgh **ij** kl', ['efgh ', 3], ['head ing', 2], '"efgh "@3 -> "head ing"@2'],
            ['ending just before trailing whitespace', 'ab **cd**\n\nefgh x ', ['ab ', 0], ['efgh x ', 6], '"ab "@0 -> "efgh x "@6'],
            ['ending in a `:::` column, whose rest joins nothing', 'ab **cd**\n\n::: columns\nefgh **ij** kl\n|||\nB\n:::', ['ab ', 1], ['efgh ', 3], '"ab "@1 -> "efgh "@3'],
            ['ending in a table cell, whose rest joins nothing', 'ab **cd**\n\n| efgh | b |\n| --- | --- |', ['ab ', 1], ['efgh', 3], '"ab "@1 -> "efgh"@3'],
        ];

        for (const [name, source, anchor, focus, range] of declined) {
            it(name, () => {
                const editor = load(source);
                const before = rootChildren(editor);
                const saved = editor.getValue();

                selectText(editor, anchor, focus);
                lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

                expect(rootChildren(editor)).toEqual(before);
                expect(editor.getValue()).toBe(saved);
                expect(rangeOf(editor)).toBe(range);
            });
        }

        // Lexical joins the end's block onto the start's own block only where both hang off the place their
        // paths fork, and the start's is the first there to hold inline content. A list item holding text and a
        // nested list — which a removal that joins a later block onto such an item leaves — is where they do
        // not, so nothing follows the caret and the break is declined. Built by hand: no Markdown loads as one.
        describe('where the end\'s block does not join the start\'s own, in a list item holding text and a list', () => {
            /**
             * A bulleted list of one item holding `children`.
             *
             * @param children - The item's children.
             * @returns The list.
             */
            function $listOf(...children: LexicalNode[]): ListNode {
                return $createListNode('bullet').append($createListItemNode().append(...children));
            }

            const shapes: Array<[string, () => LexicalNode[], TextPoint, TextPoint]> = [
                [
                    'the end\'s item is inside the start\'s, which leaves no side of the start\'s to join from',
                    () => [$listOf($createTextNode('ab'), $listOf($createTextNode('cdef'))), $createParagraphNode().append($createTextNode('tail'))],
                    ['ab', 1], ['cdef', 2],
                ],
                [
                    'the start\'s item is inside the end\'s, whose own text the range never enters from outside',
                    () => [$listOf($listOf($createTextNode('ab')), $createTextNode('cdef')), $createParagraphNode().append($createTextNode('tail'))],
                    ['ab', 1], ['cdef', 2],
                ],
                [
                    'the item around the start\'s takes the end\'s rest at its own end, away from the caret',
                    () => [$listOf($createTextNode('x'), $listOf($createTextNode('ab'))), $createParagraphNode().append($createTextNode('cdef gh'))],
                    ['ab', 1], ['cdef gh', 2],
                ],
            ];

            /**
             * An editor whose document is `build`'s nodes, with the range from `anchor` to `focus` selected.
             *
             * @param build - Makes the root's children.
             * @param anchor - The anchor's text node text and offset.
             * @param focus - The focus's text node text and offset.
             * @returns The editor.
             */
            function built(build: () => LexicalNode[], anchor: TextPoint, focus: TextPoint): MarkdownEditor {
                const editor = load('x');

                lexicalOf(editor).update(() => {
                    $getRoot().clear().append(...build());
                }, { discrete: true });
                selectText(editor, anchor, focus);

                return editor;
            }

            for (const [name, build, anchor, focus] of shapes) {
                it(name, () => {
                    const editor = built(build, anchor, focus);
                    const before = rootChildren(editor);
                    const range = rangeOf(editor);

                    lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

                    expect(rootChildren(editor)).toEqual(before);
                    expect(rangeOf(editor)).toBe(range);
                });

                it(`${name}: the break is declined at the caret the removal leaves (control)`, () => {
                    const editor = built(build, anchor, focus);

                    lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);

                    const removed = rootChildren(editor);

                    expect(removed).not.toEqual(rootChildren(built(build, anchor, focus)));

                    lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

                    expect(rootChildren(editor)).toEqual(removed);
                });
            }
        });

        it('an ordinary range ending at a block\'s end is declined the same way (control)', () => {
            const editor = load(D);

            selectText(editor, ['ab ', 1], [' kl', 3]);
            lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

            expect(editor.getValue()).toBe(D);
            expect(rangeOf(editor)).toBe('"ab "@1 -> " kl"@3');
        });

        // Kept, each the value Shift+Enter gives at the caret the removal leaves.
        it('into a later block\'s word, with content after it: the break opens what is left of that block', () => {
            const editor = load(D);

            selectText(editor, ['ab ', 0], ['efgh ', 3]);
            lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

            expect(editor.getValue()).toBe('\\\nh **ij** kl');
        });

        // The list is the first element on the start's side of the fork, and it is not inline, but it holds no
        // inline content: the block the end's rest joins is the item inside it, the start's own.
        it('starting in a list item and ending in a later top-level block\'s word: the item takes the rest, so the break is kept', () => {
            const editor = load('- one\n\nafter word');

            selectText(editor, ['one', 1], ['after word', 2]);
            lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

            expect(editor.getValue()).toBe('- o\\\n  ter word');
        });

        it('starting in a level 2 heading, which has a form that spans lines', () => {
            const editor = load('## head ing\n\nefgh **ij** kl');

            selectText(editor, ['head ing', 2], ['efgh ', 3]);
            lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

            expect(rootChildren(editor)).toEqual(['heading:he\nh ij kl']);
        });

        it('starting in a code block, which takes a line break anywhere', () => {
            const editor = load('```\ncode\n```\n\nefgh x ');

            selectText(editor, ['code', 2], ['efgh x ', 6]);
            lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

            expect(rootChildren(editor)).toEqual(['code:co\n ']);
        });
    });

    // Enter over a range is the range's removal, then Enter at the caret the removal leaves — in a raw block
    // as anywhere else, and whichever way the range was dragged.
    describe('R17: Enter over a range with an end in a raw block acts where the removal leaves the caret', () => {
        /**
         * Loads `source`, removes the range from `anchor` to `focus` with Delete, then presses Enter.
         *
         * @param source - The Markdown to load.
         * @param anchor - The anchor's text node text and offset.
         * @param focus - The focus's text node text and offset.
         * @returns The editor.
         */
        function removeThenEnter(source: string, anchor: TextPoint, focus: TextPoint): MarkdownEditor {
            const editor = load(source);

            selectText(editor, anchor, focus);
            lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);
            editor.getValue();
            lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);

            return editor;
        }

        const ranges: Array<[string, string, TextPoint, TextPoint, string[], string]> = [
            [
                // What is left opens no HTML block, so it reads as a paragraph.
                'from the raw block\'s start into a later block\'s word: an empty paragraph before what is left',
                RAW_THEN_PARA, ['<div>', 0], ['efgh ', 3], ['paragraph:', 'paragraph:h ij kl'], '"h "@0 -> "h "@0',
            ],
            [
                'from inside the raw block into a later block\'s word: a line break in the block',
                RAW_THEN_PARA, ['raw text', 2], ['efgh ', 3], ['markdown-raw-block:<div>\nra\nh **ij** kl'], '"h **ij** kl"@0 -> "h **ij** kl"@0',
            ],
            [
                'the same range dragged backward',
                RAW_THEN_PARA, ['efgh ', 3], ['raw text', 2], ['markdown-raw-block:<div>\nra\nh **ij** kl'], '"h **ij** kl"@0 -> "h **ij** kl"@0',
            ],
            [
                'from an earlier block\'s start into the raw block: a new paragraph, as in the block the caret is left in',
                PARA_THEN_RAW, ['ab ', 0], ['raw text', 2], ['paragraph:', 'paragraph:w text\n</div>'], '"w text"@0 -> "w text"@0',
            ],
            [
                'the same range dragged backward',
                PARA_THEN_RAW, ['raw text', 2], ['ab ', 0], ['paragraph:', 'paragraph:w text\n</div>'], '"w text"@0 -> "w text"@0',
            ],
            // Between two raw blocks the caret is left in the first one, whichever block the anchor was in.
            [
                'from inside one raw block into another\'s word: a line break in the first block',
                RAW_THEN_RAW, ['raw one', 2], ['raw two', 2],
                ['markdown-raw-block:<div>\nra\nw two\n</section>', 'paragraph:after'], '"w two"@0 -> "w two"@0',
            ],
            [
                'the same range dragged backward',
                RAW_THEN_RAW, ['raw two', 2], ['raw one', 2],
                ['markdown-raw-block:<div>\nra\nw two\n</section>', 'paragraph:after'], '"w two"@0 -> "w two"@0',
            ],
            [
                'from one raw block\'s end into another\'s word: a line break where the first block ended',
                RAW_THEN_RAW, ['</div>', 6], ['raw two', 2],
                ['markdown-raw-block:<div>\nraw one\n</div>\nw two\n</section>', 'paragraph:after'], '"w two"@0 -> "w two"@0',
            ],
            [
                'the same range dragged backward',
                RAW_THEN_RAW, ['raw two', 2], ['</div>', 6],
                ['markdown-raw-block:<div>\nraw one\n</div>\nw two\n</section>', 'paragraph:after'], '"w two"@0 -> "w two"@0',
            ],
            // A range Lexical removes without fault is removed first as well, so it too acts where the caret is left.
            [
                'from inside the raw block to a later block\'s end: a new paragraph after the block, not a break at its end',
                RAW_THEN_WORDS, ['raw text', 2], ['ef gh', 5],
                ['markdown-raw-block:<div>\n<p>\nra', 'paragraph:', 'paragraph:after'], 'paragraph@0 -> paragraph@0',
            ],
            [
                'the same range dragged backward',
                RAW_THEN_WORDS, ['ef gh', 5], ['raw text', 2],
                ['markdown-raw-block:<div>\n<p>\nra', 'paragraph:', 'paragraph:after'], 'paragraph@0 -> paragraph@0',
            ],
            [
                'from inside the raw block to its end: a new paragraph after the block',
                RAW_THEN_WORDS, ['raw text', 2], ['</div>', 6],
                ['markdown-raw-block:<div>\n<p>\nra', 'paragraph:', 'paragraph:ef gh', 'paragraph:after'], 'paragraph@0 -> paragraph@0',
            ],
            [
                'the same range dragged backward',
                RAW_THEN_WORDS, ['</div>', 6], ['raw text', 2],
                ['markdown-raw-block:<div>\n<p>\nra', 'paragraph:', 'paragraph:ef gh', 'paragraph:after'], 'paragraph@0 -> paragraph@0',
            ],
            [
                'from the raw block\'s start to a later line of it: an empty paragraph before the block',
                RAW_THEN_WORDS, ['<div>', 0], ['<p>', 0],
                ['paragraph:', 'markdown-raw-block:<p>\nraw text\n</p>\n</div>', 'paragraph:ef gh', 'paragraph:after'], '"<p>"@0 -> "<p>"@0',
            ],
            [
                'the same range dragged backward',
                RAW_THEN_WORDS, ['<p>', 0], ['<div>', 0],
                ['paragraph:', 'markdown-raw-block:<p>\nraw text\n</p>\n</div>', 'paragraph:ef gh', 'paragraph:after'], '"<p>"@0 -> "<p>"@0',
            ],
            [
                'inside one line of the raw block: a line break there',
                RAW_THEN_WORDS, ['raw text', 1], ['raw text', 5],
                ['markdown-raw-block:<div>\n<p>\nr\next\n</p>\n</div>', 'paragraph:ef gh', 'paragraph:after'], '"ext"@0 -> "ext"@0',
            ],
            [
                'the same range dragged backward',
                RAW_THEN_WORDS, ['raw text', 5], ['raw text', 1],
                ['markdown-raw-block:<div>\n<p>\nr\next\n</p>\n</div>', 'paragraph:ef gh', 'paragraph:after'], '"ext"@0 -> "ext"@0',
            ],
        ];

        for (const [name, source, anchor, focus, children, caret] of ranges) {
            it(name, () => {
                const editor = load(source);

                selectText(editor, anchor, focus);
                lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);

                expect(rootChildren(editor)).toEqual(children);
                expect(rangeOf(editor)).toBe(caret);
                expect(rootChildren(editor)).toEqual(rootChildren(removeThenEnter(source, anchor, focus)));
                expect(editor.getValue()).toBe(removeThenEnter(source, anchor, focus).getValue());
                expect(() => editor.getSelectionState()).not.toThrow();
            });
        }

        // The rest of a rich-text block joins a raw block as its Markdown, as Delete joins it: what was shown as
        // bold, a link or a literal asterisk still saves as one.
        const richRanges: Array<[string, TextPoint, TextPoint, string]> = [
            [
                'from inside the raw block into a rich-text block\'s word: its rest joins as its Markdown, escapes kept',
                ['raw text', 2], ['efgh ', 3], '<div>\nra\nh **ij** kl [a](u) \\*x\\*\n\nafter',
            ],
            ['the same range dragged backward', ['efgh ', 3], ['raw text', 2], '<div>\nra\nh **ij** kl [a](u) \\*x\\*\n\nafter'],
            [
                'from the raw block\'s start to where a later block\'s bold starts: the bold and the link are kept',
                ['<div>', 0], ['ij', 0], '**ij** kl [a](u) \\*x\\*\n\nafter',
            ],
            ['the same range dragged backward', ['ij', 0], ['<div>', 0], '**ij** kl [a](u) \\*x\\*\n\nafter'],
        ];

        for (const [name, anchor, focus, saved] of richRanges) {
            it(name, () => {
                const editor = load(RAW_THEN_RICH);

                selectText(editor, anchor, focus);
                lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);

                expect(editor.getValue()).toBe(saved);
                expect(editor.getValue()).toBe(removeThenEnter(RAW_THEN_RICH, anchor, focus).getValue());
                expect(rangeOf(editor)).toBe(rangeOf(removeThenEnter(RAW_THEN_RICH, anchor, focus)));
                expect(() => editor.getSelectionState()).not.toThrow();
            });
        }
    });

    it('R14: deleting from a code block\'s start into a later block\'s word joins that block\'s rest as Markdown', () => {
        const editor = load('```\ncode\n```\n\nefgh [a](u) \\*x\\* kl');

        selectText(editor, ['code', 0], ['efgh ', 3]);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);

        expect(editor.getValue()).toBe('```\nh [a](u) \\*x\\* kl\n```');
    });

    it('R10: a native cut of a range keeping part of the start block is Lexical\'s own', async () => {
        const editor = load(D);

        selectText(editor, ['ab ', 1], ['efgh ', 3]);
        lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);

        await vi.waitFor(() => expect(editor.getValue()).toBe('ah **ij** kl'));
    });

    it('R11: typing over a range keeping part of the start block is Lexical\'s own', () => {
        const editor = load(D_BOLD);

        selectText(editor, ['ab', 1], ['efgh ', 3]);
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('**ax**h **ij** kl');
    });

    it('R12: cut() of a range inside one block is Lexical\'s own', () => {
        const editor = load('ab **cd** ef');

        selectText(editor, ['ab ', 1], [' ef', 2]);
        editor.cut();

        expect(editor.getValue()).toBe('af');
    });
});

describe('a selection keeps inside text a line-break rule shortens (W rows)', () => {
    it('W1: deleting the last line of a quote converted from a code block', () => {
        const editor = load('```\na\nb\n```');

        selectText(editor, ['a\nb', 0], ['a\nb', 0]);
        editor.setBlockType('quote');
        selectText(editor, ['a\nb', 2], ['a\nb', 3]);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);

        expect(editor.getValue()).toBe('> a');
        expect(() => editor.getSelectionState()).not.toThrow();
    });
});

describe('a table a row of which is too short keeps its alignment rules (T rows)', () => {
    it('T1: a row short of a cell spanning down into it from a later column', () => {
        const editor = load('|a|b|\n|-|-|\n|1|2|\n|3|^^|');

        lexicalOf(editor).update(() => {
            const row = ($getRoot().getFirstChild() as ElementNode).getChildAtIndex(2) as ElementNode;

            row.getFirstChild()!.remove();
        }, { discrete: true });

        expect(editor.getValue()).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n|  | ^^ |');
    });

    it('T2: an empty row under a header cell spanning down into it', () => {
        const editor = load('|a|b|\n|-|-|\n|1|2|');

        lexicalOf(editor).update(() => {
            const table = $getRoot().getFirstChild() as ElementNode;

            ((table.getFirstChild() as ElementNode).getChildAtIndex(1) as TableCellNode).setRowSpan(2);
            (table.getChildAtIndex(1) as ElementNode).getChildren().forEach((cell) => cell.remove());
        }, { discrete: true });

        expect(editor.getValue()).toBe('| a | b |\n| --- | --- |\n|  |  |');
    });

    it('T3: a paragraph put in a row a cell spans down into', () => {
        const editor = load('|a|\n|-|\n|1|\n|^^|');

        // The table changes before the row, so its transforms run first, as when a paste lands in the row.
        lexicalOf(editor).update(() => {
            const table = $getRoot().getFirstChild() as ElementNode;

            table.markDirty();
            (table.getChildAtIndex(2) as ElementNode).append($createParagraphNode().append($createTextNode('p')));
        }, { discrete: true });

        // The row's paragraph is dropped, as the table plugin drops it, so the table saves as loaded.
        expect(editor.getValue()).toBe('|a|\n|-|\n|1|\n|^^|');
    });
});

/**
 * Presses Enter at the selection as the keyboard does: dispatches
 * `KEY_ENTER_COMMAND`, then inserts a paragraph when nothing handled it.
 *
 * @param editor - The editor.
 */
function pressEnter(editor: MarkdownEditor): void {
    lexicalOf(editor).update(() => {
        const handled = lexicalOf(editor).dispatchCommand(
            KEY_ENTER_COMMAND, { altKey: false, shiftKey: false, preventDefault: () => {} } as KeyboardEvent);
        const selection = $getSelection();

        if (!handled && $isRangeSelection(selection)) {
            selection.insertParagraph();
        }
    }, { discrete: true });
}

/**
 * Types one character at the selection, in an update of its own as a
 * keystroke does, so the typing shortcuts see it.
 *
 * @param editor - The editor.
 * @param char - The character.
 */
async function typeChar(editor: MarkdownEditor, char: string): Promise<void> {
    lexicalOf(editor).update(() => {
        ($getSelection() as RangeSelection).insertText(char);
    }, { discrete: true });
    await Promise.resolve();
}

describe('an ordered list\'s numbers stay at most nine digits, as Markdown reads them (O rows)', () => {
    it('O1: Enter after ten digits and a period keeps the paragraph a paragraph', () => {
        const editor = load('1234567890. **not** ok');

        selectText(editor, ['1234567890. ', 12], ['1234567890. ', 12]);
        pressEnter(editor);

        expect(lexicalOf(editor).read(() => $dfs().some(({ node }) => $isListNode(node)))).toBe(false);
        expect(editorSurfaceModel(editor)).toEqual(viewerModel(editor.getValue()).blocks);
    });

    it('O2: typing ten digits, a period and a space keeps the paragraph a paragraph', async () => {
        const editor = load('x');

        selectText(editor, ['x', 0], ['x', 1]);

        for (const char of '1234567890. ') {
            await typeChar(editor, char);
        }

        expect(lexicalOf(editor).read(() => $dfs().some(({ node }) => $isListNode(node)))).toBe(false);
        expect(editor.getValue()).toBe('1234567890.');
    });

    it('O3: typing nine digits, a period and a space still starts an ordered list there', async () => {
        const editor = load('x');

        selectText(editor, ['x', 0], ['x', 1]);

        for (const char of '123456789. a') {
            await typeChar(editor, char);
        }

        expect(editor.getValue()).toBe('123456789. a');
    });

    it('O4: Enter at the end of an item numbered 999999999 renumbers the list so its new item has nine digits', () => {
        const editor = load('999999999. a');

        selectText(editor, ['a', 1], ['a', 1]);
        pressEnter(editor);
        lexicalOf(editor).update(() => {
            ($getSelection() as RangeSelection).insertText('b');
        }, { discrete: true });

        expect(editor.getValue()).toBe('999999998. a\n999999999. b');
        expect(editorSurfaceModel(editor)).toEqual(viewerModel(editor.getValue()).blocks);
    });
});

/**
 * Builds a plain Lexical editor (no `MarkdownEditor`) whose `onError`
 * records the error instead of rethrowing it.
 *
 * @param nodes - Node classes to register.
 * @returns The editor and the list its errors are recorded in.
 */
function recordingEditor(nodes: Array<Klass<LexicalNode>> = []): { editor: LexicalEditor; errors: Error[] } {
    const errors: Error[] = [];
    const editor = createEditor({ nodes, onError: (error) => { errors.push(error); } });

    return { editor, errors };
}

describe('upstream canaries: the Lexical bugs the guards work around still reproduce (U rows)', () => {
    // When this fails after a Lexical upgrade, the upstream bug is fixed —
    // delete the matching guard in `MarkdownEditor.ts` (the stale-focus range
    // removal) and this canary.
    it('U1: RangeSelection.removeText throws on a stale-focus range', () => {
        const { editor, errors } = recordingEditor();

        editor.update(() => {
            const bold = (text: string): TextNode => $createTextNode(text).toggleFormat('bold');
            const start = $createTextNode('ab ');
            const end = $createTextNode('efgh ');

            $getRoot().append(
                $createParagraphNode().append(start, bold('cd')),
                $createParagraphNode().append(end, bold('ij'), $createTextNode(' kl')),
            );

            const selection = $createRangeSelection();

            selection.anchor.set(start.getKey(), 0, 'text');
            selection.focus.set(end.getKey(), 3, 'text');
            $setSelection(selection);
            selection.removeText();
        }, { discrete: true });

        expect(errors.map(String).join('\n')).toContain('$getTextNodeOffset: invalid offset');
    });

    // When this fails after a Lexical upgrade, the upstream bug is fixed —
    // delete the matching guard in `MarkdownEditor.ts` (moving a link-edge
    // end out of the link before `$toggleLink(null)`) and this canary.
    it('U2: $toggleLink(null) throws on a selection ending at a link\'s start', () => {
        const { editor, errors } = recordingEditor([LinkNode]);

        editor.update(() => {
            const start = $createTextNode('a ');
            const linked = $createTextNode('b');

            $getRoot().append($createParagraphNode().append(start, $createLinkNode('u').append(linked), $createTextNode(' c')));

            const selection = $createRangeSelection();

            selection.anchor.set(start.getKey(), 0, 'text');
            selection.focus.set(linked.getKey(), 0, 'text');
            $setSelection(selection);
            $toggleLink(null);
        }, { discrete: true });

        expect(errors.some((error) => error instanceof TypeError)).toBe(true);
    });

    // `$removalJoinsEndBlockRest` in `MarkdownEditor.ts` finds the block Lexical's range removal joins onto with
    // Lexical's own test, an export marked internal. When this fails after a Lexical upgrade, the export is gone
    // or matches something else: re-read how the removal picks the two blocks it joins and follow it.
    it('U3: INTERNAL_$isBlock matches the elements holding inline content, and no other', () => {
        const { editor, errors } = recordingEditor([ListNode, ListItemNode]);
        let matched: boolean[] = [];

        editor.update(() => {
            const holdingText = $createParagraphNode().append($createTextNode('a'));
            const empty = $createParagraphNode();
            const itemHoldingText = $createListItemNode().append($createTextNode('b'));
            const itemHoldingList = $createListItemNode().append($createListNode('bullet').append($createListItemNode()));
            const list = $createListNode('bullet').append(itemHoldingText, itemHoldingList);

            $getRoot().append(holdingText, empty, list);
            matched = [holdingText, empty, itemHoldingText, itemHoldingList, list, $getRoot(), holdingText.getFirstChild()!].map(INTERNAL_$isBlock);
        }, { discrete: true });

        expect(errors).toEqual([]);
        expect(matched).toEqual([true, true, true, false, false, false, false]);
    });
});
