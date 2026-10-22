// Keeps `@lexical/clipboard`'s real module (`@lexical/rich-text` imports it
// for its paste path) and replaces only `copyToClipboard`, which needs a
// browser clipboard the test DOM does not have.
vi.mock('@lexical/clipboard', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@lexical/clipboard')>()),
    copyToClipboard: vi.fn(async () => true),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createParagraphNode, $createRangeSelection, $createTextNode, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode,
    $setSelection, CONTROLLED_TEXT_INSERTION_COMMAND, CUT_COMMAND, DELETE_CHARACTER_COMMAND, DELETE_WORD_COMMAND, INSERT_LINE_BREAK_COMMAND,
    INSERT_PARAGRAPH_COMMAND, INSERT_TAB_COMMAND, INTERNAL_$isBlock, KEY_ENTER_COMMAND, PASTE_COMMAND, REMOVE_TEXT_COMMAND,
    SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, UNDO_COMMAND, createEditor, DELETE_LINE_COMMAND,
    COMPOSITION_START_COMMAND, COMPOSITION_END_TAG, $setCompositionKey, $findMatchingParent, CAN_UNDO_COMMAND, COMMAND_PRIORITY_LOW,
} from 'lexical';
import type { ElementNode, Klass, LexicalCommand, LexicalEditor, LexicalNode, PointType, RangeSelection, TextNode } from 'lexical';
import { $createListItemNode, $createListNode, $isListNode, ListItemNode, ListNode } from '@lexical/list';
import { $createLinkNode, $isLinkNode, $toggleLink, LinkNode } from '@lexical/link';
import { $insertGeneratedNodes, copyToClipboard } from '@lexical/clipboard';
import type { TableCellNode } from '@lexical/table';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { $isMarkdownBlockNode } from '~/component/editor/markdownBlockNode';
import { $isMarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
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
    describe('R16: Shift+Enter (INSERT_LINE_BREAK_COMMAND) where the removal would leave the break unwritable removes the range as Delete does, and adds no break', () => {
        const declined: Array<[string, string, TextPoint, TextPoint, string]> = [
            ['starting in a level 3 heading', '### head ing\n\nefgh **ij** kl', ['head ing', 2], ['efgh ', 3], '### heh **ij** kl'],
            ['the same range dragged backward', '### head ing\n\nefgh **ij** kl', ['efgh ', 3], ['head ing', 2], '### heh **ij** kl'],
            ['ending just before trailing whitespace', 'ab **cd**\n\nefgh x ', ['ab ', 0], ['efgh x ', 6], ''],
            ['ending in a `:::` column, whose rest joins nothing', 'ab **cd**\n\n::: columns\nefgh **ij** kl\n|||\nB\n:::', ['ab ', 1], ['efgh ', 3], 'a\n\n::: columns\nh **ij** kl\n|||\nB\n:::'],
            ['ending in a table cell, whose rest joins nothing', 'ab **cd**\n\n| efgh | b |\n| --- | --- |', ['ab ', 1], ['efgh', 3], 'a'],
        ];

        for (const [name, source, anchor, focus, saved] of declined) {
            it(name, () => {
                const editor = load(source);
                const deleted = load(source);

                selectText(editor, anchor, focus);
                selectText(deleted, anchor, focus);
                lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
                lexicalOf(deleted).dispatchCommand(DELETE_CHARACTER_COMMAND, false);

                expect(editor.getValue()).toBe(saved);
                expect(editor.getValue()).toBe(deleted.getValue());
                expect(rootChildren(editor)).toEqual(rootChildren(deleted));
            });
        }

        // Lexical joins the end's block onto the start's own block where both hang off the place their paths fork
        // and the start's is the first there to hold inline content. In a list that is always so: a list item
        // holds blocks only, its text among them, so no block around the start's own takes the end's rest away
        // from the caret. The rest then follows the caret, and the break is written.
        describe('in a list item holding text and a nested list the end\'s rest joins at the caret, so the break is written', () => {
            const written: Array<[string, string, TextPoint, TextPoint, string]> = [
                ['the end\'s item is inside the start\'s', '- ab\n  - cdef\n\ntail', ['ab', 1], ['cdef', 2], '- a\\\n  ef\n\ntail'],
                ['the start\'s item is inside the end\'s', '- - ab\n\n  cdef\n\ntail', ['ab', 1], ['cdef', 2], '- - a\\\n    ef\n\ntail'],
                ['an item around the start\'s holds text of its own', '- x\n  - ab\n\ncdef gh', ['ab', 1], ['cdef gh', 2], '- x\n  - a\\\n    ef gh'],
            ];

            for (const [name, source, anchor, focus, saved] of written) {
                it(name, () => {
                    const editor = load(source);

                    selectText(editor, anchor, focus);
                    lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

                    expect(editor.getValue()).toBe(saved);
                    expect(editorSurfaceModel(editor)).toEqual(viewerModel(saved).blocks);
                });

                it(`${name}: the break is written at the caret the removal leaves too (control)`, () => {
                    const editor = load(source);

                    selectText(editor, anchor, focus);
                    lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);
                    lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

                    expect(editor.getValue()).toBe(saved);
                });
            }
        });

        it('an ordinary range ending at a block\'s end is removed the same way (control)', () => {
            const editor = load(D);
            const deleted = load(D);

            selectText(editor, ['ab ', 1], [' kl', 3]);
            selectText(deleted, ['ab ', 1], [' kl', 3]);
            lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
            lexicalOf(deleted).dispatchCommand(DELETE_CHARACTER_COMMAND, false);

            expect(editor.getValue()).toBe('a');
            expect(editor.getValue()).toBe(deleted.getValue());
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

    // The joined Markdown lands next to text the lean escapes never see: a bare `*` would pair with a `*` of the
    // raw block, so a join writes every escape.
    it('R15: Backspace at a paragraph\'s start joins it into a raw block with every escape', () => {
        const editor = load('<div>\n\na * b');

        selectText(editor, ['a * b', 0], ['a * b', 0]);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);

        expect(editor.getValue()).toBe('<div>a \\* b');
    });

    it('R16: deleting from a code block\'s start into a later block joins the rest as that block saves it', () => {
        const editor = load('```\ncode\n```\n\nefgh a * b **c** kl');

        selectText(editor, ['code', 0], ['efgh a * b ', 3]);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);

        expect(editor.getValue()).toBe('```\nh a * b **c** kl\n```');
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
        editor.setBlockType('paragraph');
        editor.setBlockType('quote');
        selectText(editor, ['b', 0], ['b', 1]);
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

        expect(editor.getValue()).toBe('|a|b|\n|-|-|\n|1|2|\n|  |^^|');
    });

    it('T2: an empty row under a header cell spanning down into it', () => {
        const editor = load('|a|b|\n|-|-|\n|1|2|');

        lexicalOf(editor).update(() => {
            const table = $getRoot().getFirstChild() as ElementNode;

            ((table.getFirstChild() as ElementNode).getChildAtIndex(1) as TableCellNode).setRowSpan(2);
            (table.getChildAtIndex(1) as ElementNode).getChildren().forEach((cell) => cell.remove());
        }, { discrete: true });

        expect(editor.getValue()).toBe('|a|b|\n|-|-|\n|  |  |');
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
 * Types one character at the selection with the command a keystroke
 * dispatches, in an update of its own, so the typing shortcuts see it.
 *
 * @param editor - The editor.
 * @param char - The character.
 */
async function typeChar(editor: MarkdownEditor, char: string): Promise<void> {
    const lexical = lexicalOf(editor);

    lexical.update(() => {
        lexical.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, char);
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

/**
 * Stands in for a `compositionstart` event. Its time stamp is far past the
 * 30 ms after the last key press inside which Lexical opens a text node for
 * every composition, so the rows see the rule and not that timing path.
 *
 * @returns The event.
 */
function compositionStartEvent(): CompositionEvent {
    return { type: 'compositionstart', data: '', timeStamp: 1_000_000_000 } as unknown as CompositionEvent;
}

/**
 * Where the text node a composition runs in sits. Read inside an update:
 * Lexical reports no node as composing while it only reads.
 *
 * @param lexical - The Lexical editor, with a composition started.
 * @returns `'in the link'`, `'before the link'`, `'after the link'`, `'in plain text'`, or `'none'` when no node is composing.
 */
function composingPlace(lexical: LexicalEditor): string {
    let place = 'none';

    lexical.update(() => {
        const node = $dfs().map((entry) => entry.node).find((found) => $isTextNode(found) && found.isComposing());

        if (node === undefined) {
            return;
        }

        const link = $findMatchingParent(node, $isLinkNode);
        const followsLink = $isLinkNode(node.getPreviousSibling());
        const precedesLink = $isLinkNode(node.getNextSibling());

        place = link !== null ? 'in the link' : followsLink ? 'after the link' : precedesLink ? 'before the link' : 'in plain text';
    }, { discrete: true });

    return place;
}

/**
 * Ends a composition the way a browser does: the composed text replaces
 * what the selection covers in the composing node, the caret goes after it,
 * and the update carries Lexical's composition-end tag.
 *
 * @param lexical - The Lexical editor, with a composition started.
 * @param text - The composed text.
 */
function commitComposition(lexical: LexicalEditor, text: string): void {
    lexical.update(() => {
        const selection = $getSelection() as RangeSelection;
        const node = selection.anchor.getNode() as TextNode;
        const from = Math.min(selection.anchor.offset, selection.focus.offset);
        const to = Math.max(selection.anchor.offset, selection.focus.offset);
        const shown = node.getTextContent();

        node.setTextContent(shown.slice(0, from) + text + shown.slice(to));
        node.select(from + text.length, from + text.length);
        $setCompositionKey(null);
    }, { discrete: true, tag: COMPOSITION_END_TAG });
}

/** A row: its name, the Markdown loaded, the caret, where the composition must run, and the save once `日本` is composed. */
type CompositionRow = readonly [row: string, source: string, caret: TextPoint, place: string, saved: string];

const TABLE_REST = ' | b |\n| --- | --- |\n| c | d |';

const I_ROWS: readonly CompositionRow[] = [
    ['I1: a paragraph that begins with a link', '[the docs](u) now', ['the docs', 0], 'before the link', '日本[the docs](u) now'],
    ['I2: a heading that begins with a link', '## [the docs](u) now', ['the docs', 0], 'before the link', '## 日本[the docs](u) now'],
    ['I3: a list item that begins with a link', '- [the docs](u) now', ['the docs', 0], 'before the link', '- 日本[the docs](u) now'],
    ['I4: a table cell that begins with a link', `| [the docs](u) now${TABLE_REST}`, ['the docs', 0], 'before the link', `| 日本[the docs](u) now${TABLE_REST}`],
    ['I5: a quote that begins with a link', '> [the docs](u) now', ['the docs', 0], 'before the link', '> 日本[the docs](u) now'],
    ['I6: a reference link at a block\'s start', '[the docs][r] now\n\n[r]: u', ['the docs', 0], 'before the link', '日本[the docs][r] now\n\n[r]: u'],
    ['I7: an autolink at a block\'s start', '<https://e.com/d> now', ['https://e.com/d', 0], 'before the link', '日本<https://e.com/d> now'],
    ['I8: a link after a hard line break', 'zero\\\n[the docs](u) now', ['the docs', 0], 'before the link', 'zero\\\n日本[the docs](u) now'],
    ['I9: a link alone in its block, at its start', '[the docs](u)', ['the docs', 0], 'before the link', '日本[the docs](u)'],
    ['I10: the start of a link that has text before it', 'see [the docs](u) now', ['the docs', 0], 'before the link', 'see 日本[the docs](u) now'],
    ['I11: a paragraph that ends with a link', 'see [the docs](u)', ['the docs', 8], 'after the link', 'see [the docs](u)日本'],
    ['I12: a link alone in its block, at its end', '[the docs](u)', ['the docs', 8], 'after the link', '[the docs](u)日本'],
    ['I13: a list item that ends with a link', '- see [the docs](u)', ['the docs', 8], 'after the link', '- see [the docs](u)日本'],
    ['I14: a reference link at a block\'s end', 'see [the docs][r]\n\n[r]: u', ['the docs', 8], 'after the link', 'see [the docs][r]日本\n\n[r]: u'],
    ['I15: the start of the text right after a link', 'see [the docs](u) now', [' now', 0], 'after the link', 'see [the docs](u)日本 now'],
    ['I16: inside a link (control)', 'see [the docs](u)', ['the docs', 3], 'in the link', 'see [the日本 docs](u)'],
    ['I17: the end of the text right before a link (control)', 'see [the docs](u) now', ['see ', 4], 'before the link', 'see 日本[the docs](u) now'],
    ['I18: plain text at a block\'s start (control)', 'plain now', ['plain now', 0], 'in plain text', '日本plain now'],
];

describe('a composition at a link\'s edge runs in text outside the link (I rows)', () => {
    it.each(I_ROWS)('%s', (_row, source, caret, place, saved) => {
        for (const inUpdate of [true, false]) {
            const editor = load(source);
            const lexical = lexicalOf(editor);
            const loaded = editor.getValue();

            selectText(editor, caret, caret);

            if (inUpdate) {
                lexical.update(() => { lexical.dispatchCommand(COMPOSITION_START_COMMAND, compositionStartEvent()); }, { discrete: true });
            } else {
                lexical.dispatchCommand(COMPOSITION_START_COMMAND, compositionStartEvent());
            }

            expect(composingPlace(lexical), `in an update ${inUpdate}`).toBe(place);

            commitComposition(lexical, '日本');
            expect(editor.getValue(), `in an update ${inUpdate}`).toBe(saved);
            expect(load(saved).getValue()).toBe(saved);

            let canUndo = true;
            const stopWatching = lexical.registerCommand(CAN_UNDO_COMMAND, (can) => { canUndo = can; return false; }, COMMAND_PRIORITY_LOW);

            lexical.dispatchCommand(UNDO_COMMAND, undefined);
            stopWatching();
            expect(editor.getValue(), `in an update ${inUpdate}, undone`).toBe(loaded);
            expect(canUndo, `in an update ${inUpdate}, one undo is all there was`).toBe(false);

            editor.dispose();
        }
    });
});

describe('a composition start at a link\'s edge: guard limits (I rows)', () => {
    it('I19: a composition already running leaves the caret where it is', () => {
        const editor = load('[the docs](u) now');
        const lexical = lexicalOf(editor);

        selectText(editor, ['the docs', 0], ['the docs', 0]);
        lexical.update(() => { $setCompositionKey(($getSelection() as RangeSelection).anchor.key); }, { discrete: true });
        const running = lexical.isComposing();

        lexical.dispatchCommand(COMPOSITION_START_COMMAND, compositionStartEvent());

        const anchorType = lexical.read(() => ($getSelection() as RangeSelection).anchor.type);

        expect(running).toBe(true);
        expect(anchorType).toBe('text');
        editor.dispose();
    });

    it('I20: the composition-start update applies no Markdown shortcut', () => {
        const editor = load('see `ab[the docs](u)');
        const lexical = lexicalOf(editor);

        selectText(editor, ['the docs', 0], ['the docs', 0]);
        lexical.dispatchCommand(COMPOSITION_START_COMMAND, compositionStartEvent());

        const formatted = lexical.read(() => $dfs().some((entry) => $isTextNode(entry.node) && entry.node.hasFormat('code')));

        expect(formatted).toBe(false);
        editor.dispose();
    });

    it('I21: a backtick composed at a link\'s start stays before the link', () => {
        const editor = load('see `ab[the docs](u)');
        const lexical = lexicalOf(editor);

        selectText(editor, ['the docs', 0], ['the docs', 0]);
        lexical.dispatchCommand(COMPOSITION_START_COMMAND, compositionStartEvent());
        commitComposition(lexical, '`');

        expect(editor.getValue()).toBe('see `ab`[the docs](u)');
        editor.dispose();
    });
});

describe('a range that leaves a raw Markdown block or a code block is removed the same way on every route (TE rows)', () => {
    const FENCE = '```';
    const RAW = '<div>\nraw text\n</div>';
    const RICH = 'efgh **ij** kl [a](u) \\*x\\*';
    const CODE = `${FENCE}\ncode *a*\nline2\n${FENCE}`;
    /** A code block loads as one text node holding its lines. */
    const CODE_TEXT = 'code *a*\nline2';
    const TABLE = '| a | b |\n| --- | --- |\n| c1 | d1 |';
    const TWO_RAW = '<div>\nraw one\n</div>\n\n<section>\nraw two\n</section>\n\nafter';
    /** A quote of two paragraphs, which the editor holds as one raw block. */
    const RAW_QUOTE_ALONE = '> q1\n>\n> q2';

    /** One way of removing or replacing a selection. */
    type Route =
        | 'Delete' | 'Backspace' | 'word delete' | 'REMOVE_TEXT_COMMAND' | 'cut()' | 'CUT_COMMAND' | 'type' | 'IME start' | 'drop insert'
        | 'Enter' | 'INSERT_PARAGRAPH_COMMAND' | 'Shift+Enter' | 'Tab' | 'PASTE_COMMAND' | 'paste()' | 'paste nodes' | 'paste blocks'
        | 'insertImage' | 'insertTable' | 'insertHorizontalRule';

    /** A selection shape: a document, the range's two ends in document order, and what typing `x` over it and Delete give. */
    interface Shape {
        readonly id:      string;
        readonly name:    string;
        readonly source:  string;
        readonly start:   TextPoint;
        readonly end:     TextPoint;
        readonly typed:   string;
        readonly deleted: string;
    }

    const SHAPES: readonly Shape[] = [
        { id: 'TE1', name: 'raw → rich word', source: RAW_THEN_RICH, start: ['raw text', 2], end: ['efgh ', 3], typed: '<div>\nraxh **ij** kl [a](u) \\*x\\*\n\nafter', deleted: '<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter' },
        { id: 'TE2', name: 'raw start → bold start', source: RAW_THEN_RICH, start: ['<div>', 0], end: ['ij', 0], typed: '**xij** kl [a](u) \\*x\\*\n\nafter', deleted: '**ij** kl [a](u) \\*x\\*\n\nafter' },
        { id: 'TE3', name: 'raw start → rich word', source: RAW_THEN_RICH, start: ['<div>', 0], end: ['efgh ', 3], typed: 'xh **ij** kl [a](u) \\*x\\*\n\nafter', deleted: 'h **ij** kl [a](u) \\*x\\*\n\nafter' },
        { id: 'TE4', name: 'raw end → rich word', source: RAW_THEN_RICH, start: ['</div>', 6], end: ['efgh ', 3], typed: '<div>\nraw text\n</div>xh **ij** kl [a](u) \\*x\\*\n\nafter', deleted: '<div>\nraw text\n</div>h **ij** kl [a](u) \\*x\\*\n\nafter' },
        { id: 'TE5', name: 'raw → rich block\'s end', source: RAW_THEN_RICH, start: ['raw text', 2], end: [' *x*', 4], typed: '<div>\nrax\n\nafter', deleted: '<div>\nra\n\nafter' },
        { id: 'TE6', name: 'raw → rich block\'s start', source: RAW_THEN_RICH, start: ['raw text', 2], end: ['efgh ', 0], typed: '<div>\nraxefgh **ij** kl [a](u) \\*x\\*\n\nafter', deleted: '<div>\nraefgh **ij** kl [a](u) \\*x\\*\n\nafter' },
        { id: 'TE7', name: 'raw tag → later word (re-read)', source: `${RAW}\n\nafter`, start: ['<div>', 1], end: ['after', 1], typed: '\\<xfter', deleted: '\\<fter' },
        { id: 'TE8', name: 'raw tag → later block\'s end (re-read)', source: `${RAW}\n\nafter`, start: ['<div>', 1], end: ['after', 5], typed: '\\<x', deleted: '<' },
        { id: 'TE9', name: 'raw → raw', source: TWO_RAW, start: ['raw one', 2], end: ['raw two', 2], typed: '<div>\nraxw two\n</section>\n\nafter', deleted: '<div>\nraw two\n</section>\n\nafter' },
        { id: 'TE10', name: 'raw tag → raw tag', source: TWO_RAW, start: ['<div>', 1], end: ['<section>', 3], typed: '<xction>\nraw two\n</section>\n\nafter', deleted: '<ction>\nraw two\n</section>\n\nafter' },
        { id: 'TE11', name: 'rich word → raw', source: `${RICH}\n\n${RAW}\n\nafter`, start: ['efgh ', 3], end: ['raw text', 2], typed: 'efgxw text\\\n\\</div>\n\nafter', deleted: 'efgw text\\\n\\</div>\n\nafter' },
        { id: 'TE12', name: 'rich start → raw', source: `${RICH}\n\n${RAW}\n\nafter`, start: ['efgh ', 0], end: ['raw text', 2], typed: 'xw text\\\n\\</div>\n\nafter', deleted: 'w text\\\n\\</div>\n\nafter' },
        { id: 'TE13', name: 'bold → raw end', source: `${RICH}\n\n${RAW}\n\nafter`, start: ['ij', 1], end: ['</div>', 6], typed: 'efgh **ix**\n\nafter', deleted: 'efgh **i**\n\nafter' },
        { id: 'TE14', name: 'rich word → raw start', source: `${RICH}\n\n${RAW}\n\nafter`, start: ['efgh ', 3], end: ['<div>', 0], typed: 'efgx\\<div>\\\nraw text\\\n\\</div>\n\nafter', deleted: 'efg\\<div>\\\nraw text\\\n\\</div>\n\nafter' },
        { id: 'TE15', name: 'code → rich word', source: `${CODE}\n\n${RICH}\n\nafter`, start: [CODE_TEXT, 2], end: ['efgh ', 3], typed: '```\ncoxh **ij** kl [a](u) \\*x\\*\n```\n\nafter', deleted: '```\ncoh **ij** kl [a](u) \\*x\\*\n```\n\nafter' },
        { id: 'TE16', name: 'code start → bold start', source: `${CODE}\n\n${RICH}\n\nafter`, start: [CODE_TEXT, 0], end: ['ij', 0], typed: '```\nx**ij** kl [a](u) \\*x\\*\n```\n\nafter', deleted: '```\n**ij** kl [a](u) \\*x\\*\n```\n\nafter' },
        { id: 'TE17', name: 'rich word → code', source: `${RICH}\n\n${CODE}\n\nafter`, start: ['efgh ', 3], end: [CODE_TEXT, 11], typed: 'efgxne2\n\nafter', deleted: 'efgne2\n\nafter' },
        { id: 'TE18', name: 'raw → code', source: `${RAW}\n\n${CODE}\n\nafter`, start: ['raw text', 2], end: [CODE_TEXT, 11], typed: '<div>\nraxne2\n\nafter', deleted: '<div>\nrane2\n\nafter' },
        { id: 'TE19', name: 'code → raw', source: `${CODE}\n\n${RAW}\n\nafter`, start: [CODE_TEXT, 2], end: ['raw text', 2], typed: '```\ncoxw text\n</div>\n```\n\nafter', deleted: '```\ncow text\n</div>\n```\n\nafter' },
        { id: 'TE20', name: 'raw → list item text', source: `${RAW}\n\n- one **b**\n- two \\*x\\* [a](u)\n\nafter`, start: ['raw text', 2], end: ['two *x* ', 2], typed: '<div>\nraxo \\*x\\* [a](u)\n\nafter', deleted: '<div>\nrao \\*x\\* [a](u)\n\nafter' },
        { id: 'TE21', name: 'list item text → raw', source: `- one **b**\n- two \\*x\\*\n\n${RAW}\n\nafter`, start: ['two *x*', 2], end: ['raw text', 2], typed: '- one **b**\n- twxw text\\\n  \\</div>\n\nafter', deleted: '- one **b**\n- tww text\\\n  \\</div>\n\nafter' },
        { id: 'TE22', name: 'raw → quote', source: `${RAW}\n\n> quote **b** \\*x\\*\n\nafter`, start: ['raw text', 2], end: ['quote ', 3], typed: '<div>\nraxte **b** \\*x\\*\n\nafter', deleted: '<div>\nrate **b** \\*x\\*\n\nafter' },
        { id: 'TE23', name: 'quote → raw', source: `> quote **b**\n\n${RAW}\n\nafter`, start: ['quote ', 3], end: ['raw text', 2], typed: '> quoxw text\\\n> \\</div>\n\nafter', deleted: '> quow text\\\n> \\</div>\n\nafter' },
        { id: 'TE24', name: 'raw → level 3 heading', source: `${RAW}\n\n### head **b** \\*x\\*\n\nafter`, start: ['raw text', 2], end: ['head ', 2], typed: '<div>\nraxad **b** \\*x\\*\n\nafter', deleted: '<div>\nraad **b** \\*x\\*\n\nafter' },
        { id: 'TE25', name: 'level 3 heading → raw', source: `### head **b**\n\n${RAW}\n\nafter`, start: ['head ', 2], end: ['raw text', 2], typed: '### hexw text \\</div>\n\nafter', deleted: '### hew text \\</div>\n\nafter' },
        { id: 'TE26', name: 'raw → a column\'s word', source: `${RAW}\n\n::: columns\ncol **b** \\*x\\*\n|||\nB\n:::\n\nafter`, start: ['raw text', 2], end: ['col ', 2], typed: '<div>\nraxl **b** \\*x\\*\n\n::: {}\nB\n:::\n\nafter', deleted: '<div>\nral **b** \\*x\\*\n\n::: {}\nB\n:::\n\nafter' },
        { id: 'TE27', name: 'raw in a column → the next column', source: `::: columns\n${RAW}\n|||\ncol **b** \\*x\\*\n:::\n\nafter`, start: ['raw text', 2], end: ['col ', 2], typed: '::: {}\n<div>\nraxl **b** \\*x\\*\n:::\n\nafter', deleted: '::: {}\n<div>\nral **b** \\*x\\*\n:::\n\nafter' },
        { id: 'TE28', name: 'raw → rich, both in one column', source: `::: columns\n${RAW}\n\ncol **b** \\*x\\*\n|||\nB\n:::\n\nafter`, start: ['raw text', 2], end: ['col ', 2], typed: '::: columns\n<div>\nraxl **b** \\*x\\*\n|||\nB\n:::\n\nafter', deleted: '::: columns\n<div>\nral **b** \\*x\\*\n|||\nB\n:::\n\nafter' },
        { id: 'TE29', name: 'a column\'s word → raw after the fence', source: `::: columns\nA\n|||\ncol **b**\n:::\n\n${RAW}\n\nafter`, start: ['col ', 2], end: ['raw text', 2], typed: '::: columns\nA\n|||\ncox\n:::\n\nw text\n\n</div>\n\nafter', deleted: '::: columns\nA\n|||\nco\n:::\n\nw text\n\n</div>\n\nafter' },
        { id: 'TE30', name: 'raw → table cell', source: `${RAW}\n\n${TABLE}\n\nafter`, start: ['raw text', 2], end: ['c1', 1], typed: '<div>\nrax\n\nafter', deleted: '<div>\nra\n\nafter' },
        { id: 'TE31', name: 'table cell → raw', source: `${TABLE}\n\n${RAW}\n\nafter`, start: ['c1', 1], end: ['raw text', 2], typed: 'xw text\n\n</div>\n\nafter', deleted: 'w text\n\n</div>\n\nafter' },
        { id: 'TE32', name: 'raw tag → table cell (re-read)', source: `${RAW}\n\n${TABLE}\n\nafter`, start: ['<div>', 2], end: ['c1', 1], typed: '\\<dx\n\nafter', deleted: '\\<d\n\nafter' },
        { id: 'TE33', name: 'raw → a paragraph of a list item', source: `${RAW}\n\n- one\n\n  para **b** \\*x\\*\n- z\n\nafter`, start: ['raw text', 2], end: ['para ', 2], typed: '<div>\nraxra **b** \\*x\\*\n\n- z\n\nafter', deleted: '<div>\nrara **b** \\*x\\*\n\n- z\n\nafter' },
        { id: 'TE34', name: 'raw of a list item → the next item\'s text', source: '- one\n\n  <div>\n  raw text\n  </div>\n- two **b** \\*x\\*\n\nafter', start: ['raw text', 2], end: ['two ', 2], typed: '- one\n\n  <div>\n  raxo **b** \\*x\\*\n\nafter', deleted: '- one\n\n  <div>\n  rao **b** \\*x\\*\n\nafter' },
        { id: 'TE35', name: 'list item text → a raw block of that item', source: '- one **b**\n\n  <div>\n  raw text\n  </div>\n- z\n\nafter', start: ['one ', 2], end: ['raw text', 2], typed: '- onxw text\\\n  \\</div>\n\n- z\n\nafter', deleted: '- onw text\\\n  \\</div>\n\n- z\n\nafter' },
        { id: 'TE36', name: 'list item text\'s start → raw end', source: `- ab\n- cd\n\n${RAW}\n\nafter`, start: ['cd', 0], end: ['</div>', 6], typed: '- ab\n- x\n\nafter', deleted: '- ab\n-\n\nafter' },
        { id: 'TE37', name: 'raw → a nested item\'s text', source: `${RAW}\n\n- one\n  - two \\*x\\* **b**\n- z\n\nafter`, start: ['raw text', 2], end: ['two *x* ', 2], typed: '<div>\nraxo \\*x\\* **b**\n\n- z\n\nafter', deleted: '<div>\nrao \\*x\\* **b**\n\n- z\n\nafter' },
        { id: 'TE38', name: 'raw → the text of an item that holds blocks', source: `${RAW}\n\n- two \\*x\\*\n\n  pq\n  - nn\n- z\n\nafter`, start: ['raw text', 2], end: ['two *x*', 2], typed: '<div>\nraxo \\*x\\*\n\npq\n\n- - nn\n\n- z\n\nafter', deleted: '<div>\nrao \\*x\\*\n\npq\n\n- - nn\n\n- z\n\nafter' },
        { id: 'TE39', name: 'code of a list item → a paragraph of that item', source: `- one\n\n  ${FENCE}\n  code\n  ${FENCE}\n\n  para \\*x\\*\n- z\n\nafter`, start: ['code', 2], end: ['para *x*', 2], typed: '- one\n\n  ```\n  coxra \\*x\\*\n  ```\n\n- z\n\nafter', deleted: '- one\n\n  ```\n  cora \\*x\\*\n  ```\n\n- z\n\nafter' },
        { id: 'TE40', name: 'list item text → raw start', source: `- ab\n- cd\n\n${RAW}\n\nafter`, start: ['cd', 1], end: ['<div>', 0], typed: '- ab\n- cx\\<div>\\\n  raw text\\\n  \\</div>\n\nafter', deleted: '- ab\n- c\\<div>\\\n  raw text\\\n  \\</div>\n\nafter' },
        { id: 'TE41', name: 'the start of the document\'s first block → raw end', source: `# ab\n\n${RAW}\n\nafter`, start: ['ab', 0], end: ['</div>', 6], typed: '# x\n\nafter', deleted: '#\n\nafter' },
        { id: 'TE42', name: 'raw comment → later word, left open before a block', source: '<!-- c1\nc2 -->\n\nafter\n\nmore', start: ['<!-- c1', 6], end: ['after', 1], typed: '\\<!-- cxfter\n\nmore', deleted: '\\<!-- cfter\n\nmore' },
        { id: 'TE43', name: 'raw comment of a list item → a later paragraph of that item, left open before a block', source: '- one\n\n  <!-- c1\n  c2 -->\n\n  para\n\n  more\n- z\n\nafter', start: ['<!-- c1', 6], end: ['para', 1], typed: '- one\n\n  \\<!-- cxara\n\n  more\n\n- z\n\nafter', deleted: '- one\n\n  \\<!-- cara\n\n  more\n\n- z\n\nafter' },
        { id: 'TE44', name: 'raw comment → the text of an item that holds blocks, left open before them', source: '<!-- c1\nc2 -->\n\n- two\n\n  pq\n- z\n\nafter', start: ['<!-- c1', 6], end: ['two', 1], typed: '\\<!-- cxwo\n\npq\n\n- z\n\nafter', deleted: '\\<!-- cwo\n\npq\n\n- z\n\nafter' },
        { id: 'TE45', name: 'the first paragraph of a raw quote → later word (re-read as a quote)', source: '> q1 w\n>\n> q2\n\nafter', start: ['q1 w', 3], end: ['after', 1], typed: '> q1 xfter', deleted: '> q1 fter' },
        { id: 'TE46', name: 'a later line of a raw quote → a later block\'s start (re-read as a quote of two lines)', source: '> q1\n>\n> q2\n\nafter b\n\nmore', start: ['q2', 0], end: ['after b', 0], typed: '> q1\n>\n> xafter b\n\nmore', deleted: '> q1\n>\n> after b\n\nmore' },
        { id: 'TE47', name: 'a later line of a raw list → later word (re-read as a list)', source: '- a\n  > q\n- b\n\nafter', start: ['  > q', 2], end: ['after', 1], typed: '- a\n  xfter', deleted: '- a\n  fter' },
        { id: 'TE48', name: 'a later line of a raw table → later word (re-read as a paragraph)', source: '| a |\n| - |\n| b | c |\n\nafter', start: ['| - |', 2], end: ['after', 1], typed: '| a |\n| xfter', deleted: '| a |\n| fter' },
        { id: 'TE49', name: 'a later line of a raw list → an escaped character (re-read as a list)', source: '- a\n  > q\n- b\n\nx \\* yz', start: ['  > q', 2], end: ['x * yz', 2], typed: '- a\n  x* yz', deleted: '- a\n  \\* yz' },
        { id: 'TE50', name: 'level 3 heading → raw start', source: `### head **b**\n\n${RAW}\n\nafter`, start: ['head ', 2], end: ['<div>', 0], typed: '### hex\\<div> raw text \\</div>\n\nafter', deleted: '### he\\<div> raw text \\</div>\n\nafter' },
        { id: 'TE51', name: 'a raw quote\'s marker → later word\'s space (re-read as a quote, the caret inside a marker)', source: '> q1\n>\n> q2\n\nab cd\n\nmore', start: ['q2', 0], end: ['ab cd', 2], typed: '> q1\n>\n> x cd\n\nmore', deleted: '> q1\n>\n> cd\n\nmore' },
        { id: 'TE52', name: 'a bold run after its space → raw', source: `ab **cd ef** gh\n\n${RAW}\n\nafter`, start: ['cd ef', 3], end: ['raw text', 2], typed: 'ab **cd x**w text\\\n\\</div>\n\nafter', deleted: 'ab **cd** w text\\\n\\</div>\n\nafter' },
        { id: 'TE53', name: 'a raw quote\'s marker → a bold word\'s start (re-read, the caret between the marker and bold text)', source: `${RAW_QUOTE_ALONE}\n\n**Note** rest\n\nlast`, start: ['q1', 0], end: ['Note', 0], typed: '> x**Note** rest\n\nlast', deleted: '> **Note** rest\n\nlast' },
        { id: 'TE54', name: 'a raw quote\'s marker → inside a bold word', source: `${RAW_QUOTE_ALONE}\n\nx **bold** y\n\nlast`, start: ['q1', 0], end: ['bold', 1], typed: '> x**old** y\n\nlast', deleted: '> **old** y\n\nlast' },
        { id: 'TE55', name: 'a raw quote\'s marker → a link\'s start', source: `${RAW_QUOTE_ALONE}\n\n[link](/u) rest\n\nlast`, start: ['q1', 0], end: ['link', 0], typed: '> x[link](/u) rest\n\nlast', deleted: '> [link](/u) rest\n\nlast' },
        { id: 'TE56', name: 'a later line of a raw quote → inline code\'s start', source: `${RAW_QUOTE_ALONE}\n\n\`code\` rest\n\nlast`, start: ['q2', 0], end: ['code', 0], typed: '> q1\n>\n> x`code` rest\n\nlast', deleted: '> q1\n>\n> `code` rest\n\nlast' },
        { id: 'TE57', name: 'a raw list\'s marker → a bold word\'s start', source: '- a\n  > q\n- b\n\n**Note** rest\n\nlast', start: ['- a', 2], end: ['Note', 0], typed: '- **xNote** rest\n\nlast', deleted: '- **Note** rest\n\nlast' },
        { id: 'TE58', name: 'after bold text of a raw quote → a later block\'s end (the caret after formatted text, nothing after it; the space before the range goes)', source: '> **b** w\n>\n> q2\n\nafter', start: ['b', 1], end: ['after', 5], typed: '> **bx**', deleted: '> **b**' },
        { id: 'TE59', name: 'after bold text of a raw quote → before a hard break (the caret after formatted text, a line break after it)', source: '> **b** w\n>\n> q2\n\nab\\\ncd', start: ['b', 1], end: ['ab', 2], typed: '> **bx**\\\n> cd', deleted: '> **b**\\\n> cd' },
        { id: 'TE60', name: 'a raw quote\'s marker → before two spaces (the caret before spaces of which one shows)', source: `${RAW_QUOTE_ALONE}\n\nend.  Next\n\nmore`, start: ['q1', 0], end: ['end.  Next', 4], typed: '> x  Next\n\nmore', deleted: '> Next\n\nmore' },
        { id: 'TE61', name: 'a later line\'s marker of a raw quote → before two spaces', source: `${RAW_QUOTE_ALONE}\n\nab  cd\n\nmore`, start: ['q2', 0], end: ['ab  cd', 2], typed: '> q1\n>\n> x  cd\n\nmore', deleted: '> q1\n>\n> cd\n\nmore' },
        { id: 'TE89', name: 'a raw quote\'s text after its marker → before two spaces (the edit started after the marker)', source: `${RAW_QUOTE_ALONE}\n\nend.  Next\n\nmore`, start: ['q1', 0], end: ['end.  Next', 4], typed: '> x  Next\n\nmore', deleted: '> Next\n\nmore' },
        { id: 'TE62', name: 'raw start → a later block\'s end (the raw block emptied)', source: `${RAW}\n\nafter\n\nlast`, start: ['<div>', 0], end: ['after', 5], typed: 'x\n\nlast', deleted: 'last' },
        { id: 'TE63', name: 'raw start → the end of the document (the raw block emptied, nothing left)', source: `${RAW}\n\nafter`, start: ['<div>', 0], end: ['after', 5], typed: 'x', deleted: '' },
        { id: 'TE64', name: 'the start of a list item\'s raw block → the end of that item\'s paragraph (the raw block emptied)', source: '- one\n\n  <div>\n  raw text\n  </div>\n\n  para\n- z\n\nafter', start: ['<div>', 0], end: ['para', 4], typed: '- one\n\n  x\n\n- z\n\nafter', deleted: '- one\n\n- z\n\nafter' },
        { id: 'TE65', name: 'raw start → the end of the next raw block (both emptied)', source: TWO_RAW, start: ['<div>', 0], end: ['</section>', 10], typed: 'x\n\nafter', deleted: 'after' },
        { id: 'TE66', name: 'after bold text that ends in punctuation → before a space (the space stays after the caret)', source: '> a **Note:** w\n>\n> q2\n\nab next\n\nlast', start: ['Note:', 5], end: ['ab next', 2], typed: '> a **Note:x** next\n\nlast', deleted: '> a **Note:** next\n\nlast' },
        { id: 'TE67', name: 'after italic text written with underscores → before a space', source: '> some _word_ w\n>\n> q2\n\nab next\n\nlast', start: ['word', 4], end: ['ab next', 2], typed: '> some *wordx* next\n\nlast', deleted: '> some *word* next\n\nlast' },
        { id: 'TE68', name: 'after struck text that ends in punctuation → before two spaces', source: '> a ~~s.~~ w\n>\n> q2\n\nab  next\n\nlast', start: ['s.', 2], end: ['ab  next', 2], typed: '> a ~~s.x~~  next\n\nlast', deleted: '> a ~~s.~~  next\n\nlast' },
        { id: 'TE69', name: 'after italic text of a raw list\'s item → before a space', source: '- one _w_ w\n  > q\n- b\n\nab next\n\nlast', start: ['- one _w_ w', 9], end: ['ab next', 2], typed: '- one *w*x next\n\nlast', deleted: '- one *w* next\n\nlast' },
        { id: 'TE70', name: 'a raw quote\'s word → before a space and bold text that opens with punctuation', source: '> q1 w\n>\n> q2\n\nab **(b)** z\n\nlast', start: ['q1 w', 3], end: ['ab ', 2], typed: '> q1 x **(b)** z\n\nlast', deleted: '> q1  **(b)** z\n\nlast' },
        { id: 'TE71', name: 'after bold text that ends in punctuation → before a space and bold text that opens with punctuation', source: '> a **Note:** w\n>\n> q2\n\nab **(b)** z\n\nlast', start: ['Note:', 5], end: ['ab ', 2], typed: '> a **Note:x (b)** z\n\nlast', deleted: '> a **Note:** **(b)** z\n\nlast' },
        { id: 'TE72', name: 'inside the address of a link the two halves make (the caret after the link)', source: '> [k](/ab zz\n>\n> q2\n\ncd) tail', start: ['[k](/ab zz', 7], end: ['cd) tail', 0], typed: '> \\[k\\]\\(/abxcd) tail', deleted: '> \\[k\\]\\(/abcd) tail' },
        { id: 'TE73', name: 'after a backslash → an escaped character (the caret before the backslash the two make)', source: '> esc \\ w\n>\n> q2\n\nab*e\n\nlast', start: ['esc \\ w', 5], end: ['ab*e', 2], typed: '> esc \\x*e\n\nlast', deleted: '> esc \\\\*e\n\nlast' },
        { id: 'TE74', name: 'inside inline code the two halves make', source: '> a `co w\n>\n> q2\n\nabde` x\n\nlast', start: ['a `co w', 5], end: ['abde` x', 2], typed: '> a \\`coxde\\` x\n\nlast', deleted: '> a \\`code\\` x\n\nlast' },
        { id: 'TE75', name: 'a raw quote\'s word → before a space and a link whose text holds an escaped bracket', source: '> q1 w\n>\n> q2\n\nab [a \\[b](/u) c\n\nlast', start: ['q1 w', 3], end: ['ab ', 2], typed: '> q1 x [a \\[b](/u) c\n\nlast', deleted: '> q1  [a \\[b](/u) c\n\nlast' },
        { id: 'TE76', name: 'right after a task item\'s checkbox → a word after a space', source: '- [x] ta\n  > q\n- [ ] tb w\n\nab cd *ef*', start: ['- [x] ta', 6], end: ['ab cd ', 2], typed: '- [x] xcd *ef*', deleted: '- [x] cd *ef*' },
        { id: 'TE77', name: 'between a task item\'s checkbox and the space the tail gives it', source: '- [x] ta\n  > q\n- [ ] tb w\n\nab next', start: ['- [x] ta', 5], end: ['ab next', 2], typed: '- [x] xnext', deleted: '- [x] next' },
        { id: 'TE78', name: 'a tag\'s opening before the range and its `>` after: the join keeps both text, and makes no tag', source: '> a <b w\n>\n> q2\n\nab>cd', start: ['a <b w', 4], end: ['ab>cd', 2], typed: '> a \\<bx>cd', deleted: '> a \\<b>cd' },
        { id: 'TE79', name: 'a raw list item\'s start → the end of a later block (the joint\'s item shows nothing)', source: '- a\n- b\n  > q\n- c\n\nafter', start: ['- b', 2], end: ['after', 5], typed: '- a\n- x', deleted: '- a\n-' },
        { id: 'TE80', name: 'a raw table\'s first body cell → the end of a later block (the joint\'s cell shows nothing)', source: '| h1 | h2 |\n| --- | --- |\n| a | b | c |\n\nafter', start: ['| a | b | c |', 2], end: ['after', 5], typed: '| h1 | h2 |\n| --- | --- |\n| x |  |', deleted: '| h1 | h2 |\n| --- | --- |\n|  |  |' },
        { id: 'TE81', name: 'a raw table\'s second body cell → the end of a later block (the joint\'s cell shows nothing)', source: '| h1 | h2 |\n| --- | --- |\n| a | b | c |\n\nafter', start: ['| a | b | c |', 6], end: ['after', 5], typed: '| h1 | h2 |\n| --- | --- |\n| a | x |', deleted: '| h1 | h2 |\n| --- | --- |\n| a |  |' },
        { id: 'TE82', name: 'a word of a paragraph → a later paragraph (bold link text elsewhere in the block, nothing raw)', source: 'x [**b**](/u)yz and more\n\nQZ 7Y', start: ['yz and more', 8], end: ['QZ 7Y', 2], typed: 'x [**b**](/u)yz and mx 7Y', deleted: 'x [b](/u)yz and m 7Y' },
        { id: 'TE83', name: 'right after a bold link of a raw list item → a later paragraph', source: '- a [**b**](/u) c\n  > q\n- b\n\nQZ 7Y', start: ['- a [**b**](/u) c', 15], end: ['QZ 7Y', 2], typed: '- a [**b**](/u)x 7Y', deleted: '- a **[b](/u)** 7Y' },
        { id: 'TE84', name: 'the first body cell of a table in a raw list item → a later paragraph', source: '- | h1 | h2 |\n  | --- | --- |\n  | a | b |\n- t\n  > q\n\nafter', start: ['  | a | b |', 4], end: ['after', 5], typed: '- | h1 | h2 |\n  | --- | --- |\n  | x |  |', deleted: '- | h1 | h2 |\n  | --- | --- |\n  |  |  |' },
        { id: 'TE85', name: 'the second body cell of a table in a raw list item → a later paragraph', source: '- | h1 | h2 |\n  | --- | --- |\n  | c | d |\n- y\n  > q\n\nafter', start: ['  | c | d |', 8], end: ['after', 5], typed: '- | h1 | h2 |\n  | --- | --- |\n  | c | x |', deleted: '- | h1 | h2 |\n  | --- | --- |\n  | c |  |' },
        { id: 'TE86', name: 'from the next item of a raw list whose first item holds only a nested list → a later paragraph', source: '- - x\n- b\n  > q\n- c\n\nafter', start: ['- b', 2], end: ['after', 5], typed: '- - x\n- x', deleted: '- - x\n-' },
        { id: 'TE87', name: 'from the next item of a raw list whose first item holds only a nested ordered list → a later paragraph', source: '- 1. x\n- b\n  > q\n\nafter', start: ['- b', 2], end: ['after', 5], typed: '- 1. x\n- x', deleted: '- 1. x\n-' },
        { id: 'TE88', name: 'right after the pipe that closes an empty last cell of a raw table → a later paragraph', source: '| h1 | h2 |\n| --- | --- |\n| c |  | x |\n\nafter', start: ['| c |  | x |', 8], end: ['after', 5], typed: '| h1 | h2 |\n| --- | --- |\n| c | x |', deleted: '| h1 | h2 |\n| --- | --- |\n| c |  |' },
    ];

    /** The routes that are a method of the editor: they start their own update. */
    const METHOD_ROUTES: readonly Route[] = ['cut()', 'paste()', 'paste nodes', 'paste blocks', 'insertImage', 'insertTable', 'insertHorizontalRule'];

    /** Every way a row is run: the range dragged forward and backward, the command dispatched outside an update and inside one. */
    const VARIANTS: ReadonlyArray<readonly [backward: boolean, inUpdate: boolean]> = [[false, false], [false, true], [true, false], [true, true]];

    /**
     * The shape with the given id.
     *
     * @param id - The shape's id.
     * @returns The shape.
     */
    function shapeOfId(id: string): Shape {
        return SHAPES.find((shape) => shape.id === id)!;
    }


    /**
     * Loads a shape's document and selects its range.
     *
     * @param shape - The shape.
     * @param backward - Whether the range is dragged from its end to its start.
     * @returns The editor.
     */
    function select(shape: Shape, backward: boolean): MarkdownEditor {
        const editor = load(shape.source);

        selectText(editor, backward ? shape.end : shape.start, backward ? shape.start : shape.end);

        return editor;
    }

    /**
     * Stubs the event classes `registerRichText` tells a clipboard, drag, input and key event apart by.
     */
    function stubEventClasses(): void {
        vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
        vi.stubGlobal('DragEvent', class DragEvent {});
        vi.stubGlobal('InputEvent', class InputEvent {});
        vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});
    }

    /**
     * A data transfer holding `text` as plain text.
     *
     * @param text - The text.
     * @returns The transfer's `types`, `files` and `getData`.
     */
    function transferOf(text: string): { types: string[]; files: never[]; getData: (type: string) => string } {
        return { types: ['text/plain'], files: [], getData: (type: string) => (type === 'text/plain' ? text : '') };
    }

    /**
     * Runs one route over the editor's selection.
     *
     * @param editor - The editor.
     * @param route - The route.
     * @param inUpdate - Whether a command is dispatched inside one update, as a browser's key and input events do.
     */
    async function run(editor: MarkdownEditor, route: Route, inUpdate: boolean): Promise<void> {
        const lexical = lexicalOf(editor);

        const dispatch = <P>(command: LexicalCommand<P>, payload: P): void => {
            if (inUpdate) {
                lexical.update(() => { lexical.dispatchCommand(command, payload); }, { discrete: true });
            } else {
                lexical.dispatchCommand(command, payload);
            }
        };

        const paste = (nodes: () => LexicalNode[]): void => {
            lexical.update(() => { $insertGeneratedNodes(lexical, nodes(), $getSelection()!); }, { discrete: true });
        };

        switch (route) {
            case 'Delete': dispatch(DELETE_CHARACTER_COMMAND, false); break;
            case 'Backspace': dispatch(DELETE_CHARACTER_COMMAND, true); break;
            case 'word delete': dispatch(DELETE_WORD_COMMAND, false); break;
            case 'REMOVE_TEXT_COMMAND': dispatch(REMOVE_TEXT_COMMAND, null); break;
            case 'type': dispatch(CONTROLLED_TEXT_INSERTION_COMMAND, 'x'); break;
            // What Lexical's composition start dispatches over a range: a zero-width space, the composition's seat.
            case 'IME start': dispatch(CONTROLLED_TEXT_INSERTION_COMMAND, '\u200b'); break;
            // What `insertFromDrop` dispatches: the input event, carrying a data transfer.
            case 'drop insert':
                stubEventClasses();
                dispatch(CONTROLLED_TEXT_INSERTION_COMMAND, Object.assign(new InputEvent('beforeinput'), { dataTransfer: transferOf('zd'), data: null }));
                break;
            case 'Enter': dispatch(KEY_ENTER_COMMAND, null); break;
            case 'INSERT_PARAGRAPH_COMMAND': dispatch(INSERT_PARAGRAPH_COMMAND, undefined); break;
            case 'Shift+Enter': dispatch(INSERT_LINE_BREAK_COMMAND, false); break;
            case 'Tab': dispatch(INSERT_TAB_COMMAND, undefined); break;
            case 'PASTE_COMMAND':
                stubEventClasses();
                dispatch(PASTE_COMMAND, Object.assign(new ClipboardEvent('paste'), { clipboardData: transferOf('zc'), preventDefault: () => {} }));
                break;
            case 'paste()':
                vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('zc');
                await editor.paste();
                break;
            case 'paste nodes': paste(() => [$createTextNode('zp').toggleFormat('bold')]); break;
            case 'paste blocks':
                paste(() => [
                    $createParagraphNode().append($createTextNode('p1 '), $createTextNode('zb').toggleFormat('bold')),
                    $createParagraphNode().append($createTextNode('p2')),
                ]);
                break;
            case 'cut()': editor.cut(); break;
            case 'CUT_COMMAND':
                stubEventClasses();
                dispatch(CUT_COMMAND, null);
                // The cut removes in an update queued behind the copy.
                await vi.waitFor(() => expect(copyToClipboard).toHaveBeenCalled());
                await Promise.resolve();
                break;
            case 'insertImage': editor.insertImage('/i.png', { alt: 'i' }); break;
            case 'insertTable': editor.insertTable(2, 2); break;
            case 'insertHorizontalRule': editor.insertHorizontalRule(); break;
        }
    }

    /**
     * Asserts that the editor shows what its save reads as, and that a reload saves and shows the same.
     *
     * @param editor - The editor.
     */
    function expectParity(editor: MarkdownEditor): void {
        const saved = editor.getValue();
        const surface = editorSurfaceModel(editor);
        const reloaded = load(saved);

        expect(surface).toEqual(viewerModel(saved).blocks);
        expect(reloaded.getValue()).toBe(saved);
        expect(editorSurfaceModel(reloaded)).toEqual(surface);
    }

    /**
     * Gives a collapsed caret the format of the text it is in, as a browser's selection change does.
     *
     * @param editor - The editor.
     */
    function syncCaretFormat(editor: MarkdownEditor): void {
        lexicalOf(editor).update(() => {
            const selection = $getSelection();
            const isCaretInText = $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.type === 'text';

            if (isCaretInText) {
                const text = selection.anchor.getNode() as TextNode;

                selection.format = text.getFormat();
                selection.style = text.getStyle();
            }
        }, { discrete: true });
    }

    it.each(SHAPES)('$id: $name, typed over and deleted', async (shape) => {
        for (const backward of [false, true]) {
            const typed = select(shape, backward);

            await run(typed, 'type', true);

            expect(typed.getValue(), `typed, backward ${backward}`).toBe(shape.typed);
            expectParity(typed);
            lexicalOf(typed).dispatchCommand(UNDO_COMMAND, undefined);
            expect(typed.getValue(), `undo, backward ${backward}`).toBe(shape.source);

            const deleted = select(shape, backward);

            await run(deleted, 'Delete', true);

            expect(deleted.getValue(), `deleted, backward ${backward}`).toBe(shape.deleted);
        }
    });

    it.each<[string, Route, string]>([
        // Neither cut tags the update that removes the range for the run-edge rule: `cut()` carries no tag, as at the
        // parent, and the native cut's tag marks the command's own update, while the removal follows in an update of its
        // own. So a cut leaves a run's edges as they are, where Delete tidies them (TE71), and keeps the bold of a link's
        // text elsewhere in the block, as the parent's cut did (TE82).
        ['TE71', 'cut()', '> a **Note: (b)** z\n\nlast'],
        ['TE71', 'CUT_COMMAND', '> a **Note: (b)** z\n\nlast'],
        ['TE82', 'cut()', 'x [**b**](/u)yz and m 7Y'],
        ['TE82', 'CUT_COMMAND', 'x [**b**](/u)yz and m 7Y'],
        ['TE1', 'Delete', '<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'Backspace', '<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'word delete', '<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'REMOVE_TEXT_COMMAND', '<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'cut()', '<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'CUT_COMMAND', '<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'Enter', '<div>\nra\nh **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'INSERT_PARAGRAPH_COMMAND', '<div>\nra\n\nh **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'Shift+Enter', '<div>\nra\nh **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'Tab', '<div>\nra\th **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'PASTE_COMMAND', '<div>\nrazch **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'paste()', '<div>\nrazch **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'paste nodes', '<div>\nrazph **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'paste blocks', '<div>\nrap1 zb\n\np2h **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'drop insert', '<div>\nrazdh **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'IME start', '<div>\nra\u200bh **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'insertImage', '<div>\nraw text\n</div>\n\nefgh **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'insertTable', '<div>\nraw text\n</div>\n\nefgh **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE1', 'insertHorizontalRule', '<div>\nraw text\n</div>\n\nefgh **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'Delete', '**ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'Backspace', '**ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'word delete', '**ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'REMOVE_TEXT_COMMAND', '**ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'cut()', '**ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'CUT_COMMAND', '**ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'Enter', '**ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'INSERT_PARAGRAPH_COMMAND', '**ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'Shift+Enter', '\\\n**ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'Tab', '**ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'PASTE_COMMAND', '**zcij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'paste()', 'zc**ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'paste nodes', '**zpij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'paste blocks', 'p1 **zb**\n\np2**ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'drop insert', '**zdij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'IME start', '**\u200bij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'insertImage', '<div>\nraw text\n</div>\n\nefgh **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'insertTable', '<div>\nraw text\n</div>\n\nefgh **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE2', 'insertHorizontalRule', '<div>\nraw text\n</div>\n\nefgh **ij** kl [a](u) \\*x\\*\n\nafter'],
        ['TE7', 'Delete', '\\<fter'],
        ['TE7', 'Backspace', '\\<fter'],
        ['TE7', 'word delete', '\\<fter'],
        ['TE7', 'REMOVE_TEXT_COMMAND', '\\<fter'],
        ['TE7', 'cut()', '\\<fter'],
        ['TE7', 'CUT_COMMAND', '\\<fter'],
        ['TE7', 'Enter', '<\n\nfter'],
        ['TE7', 'INSERT_PARAGRAPH_COMMAND', '<\n\nfter'],
        ['TE7', 'Shift+Enter', '<\\\nfter'],
        ['TE7', 'Tab', '<\tfter'],
        ['TE7', 'PASTE_COMMAND', '\\<zcfter'],
        ['TE7', 'paste()', '\\<zcfter'],
        ['TE7', 'paste nodes', '<**zp**fter'],
        ['TE7', 'paste blocks', '\\<p1 **zb**\n\np2fter'],
        ['TE7', 'drop insert', '\\<zdfter'],
        ['TE7', 'IME start', '<\u200bfter'],
        ['TE7', 'insertImage', '<div>\nraw text\n</div>\n\nafter'],
        ['TE7', 'insertTable', '<div>\nraw text\n</div>\n\nafter'],
        ['TE7', 'insertHorizontalRule', '<div>\nraw text\n</div>\n\nafter'],
        ['TE11', 'Delete', 'efgw text\\\n\\</div>\n\nafter'],
        ['TE11', 'Backspace', 'efgw text\\\n\\</div>\n\nafter'],
        ['TE11', 'word delete', 'efgw text\\\n\\</div>\n\nafter'],
        ['TE11', 'REMOVE_TEXT_COMMAND', 'efgw text\\\n\\</div>\n\nafter'],
        ['TE11', 'cut()', 'efgw text\\\n\\</div>\n\nafter'],
        ['TE11', 'CUT_COMMAND', 'efgw text\\\n\\</div>\n\nafter'],
        ['TE11', 'Enter', 'efg\n\nw text\\\n\\</div>\n\nafter'],
        ['TE11', 'INSERT_PARAGRAPH_COMMAND', 'efg\n\nw text\\\n\\</div>\n\nafter'],
        ['TE11', 'Shift+Enter', 'efg\\\nw text\\\n\\</div>\n\nafter'],
        ['TE11', 'Tab', 'efg\tw text\\\n\\</div>\n\nafter'],
        ['TE11', 'PASTE_COMMAND', 'efgzcw text\\\n\\</div>\n\nafter'],
        ['TE11', 'paste()', 'efgzcw text\\\n\\</div>\n\nafter'],
        ['TE11', 'paste nodes', 'efg**zp**w text\\\n\\</div>\n\nafter'],
        ['TE11', 'paste blocks', 'efgp1 **zb**\n\np2w text\\\n\\</div>\n\nafter'],
        ['TE11', 'drop insert', 'efgzdw text\\\n\\</div>\n\nafter'],
        ['TE11', 'IME start', 'efg\u200bw text\\\n\\</div>\n\nafter'],
        ['TE11', 'insertImage', 'efgh **ij** kl [a](u) \\*x\\*\n\n<div>\nraw text\n</div>\n\nafter'],
        ['TE11', 'insertTable', 'efgh **ij** kl [a](u) \\*x\\*\n\n<div>\nraw text\n</div>\n\nafter'],
        ['TE11', 'insertHorizontalRule', 'efgh **ij** kl [a](u) \\*x\\*\n\n<div>\nraw text\n</div>\n\nafter'],
        ['TE42', 'Delete', '\\<!-- cfter\n\nmore'],
        ['TE42', 'Backspace', '\\<!-- cfter\n\nmore'],
        ['TE42', 'word delete', '\\<!-- cfter\n\nmore'],
        ['TE42', 'REMOVE_TEXT_COMMAND', '\\<!-- cfter\n\nmore'],
        ['TE42', 'cut()', '\\<!-- cfter\n\nmore'],
        ['TE42', 'CUT_COMMAND', '\\<!-- cfter\n\nmore'],
        ['TE42', 'Enter', '\\<!-- c\n\nfter\n\nmore'],
        ['TE42', 'INSERT_PARAGRAPH_COMMAND', '\\<!-- c\n\nfter\n\nmore'],
        ['TE42', 'Shift+Enter', '\\<!-- c\\\nfter\n\nmore'],
        ['TE42', 'Tab', '\\<!-- c\tfter\n\nmore'],
        ['TE42', 'PASTE_COMMAND', '\\<!-- czcfter\n\nmore'],
        ['TE42', 'paste()', '\\<!-- czcfter\n\nmore'],
        ['TE42', 'paste nodes', '\\<!-- c**zp**fter\n\nmore'],
        ['TE42', 'paste blocks', '\\<!-- cp1 **zb**\n\np2fter\n\nmore'],
        ['TE42', 'drop insert', '\\<!-- czdfter\n\nmore'],
        ['TE42', 'IME start', '\\<!-- c\u200bfter\n\nmore'],
        ['TE42', 'insertImage', '<!-- c1\nc2 -->\n\nafter\n\nmore'],
        ['TE42', 'insertTable', '<!-- c1\nc2 -->\n\nafter\n\nmore'],
        ['TE42', 'insertHorizontalRule', '<!-- c1\nc2 -->\n\nafter\n\nmore'],
        ['TE43', 'Delete', '- one\n\n  \\<!-- cara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'Backspace', '- one\n\n  \\<!-- cara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'word delete', '- one\n\n  \\<!-- cara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'REMOVE_TEXT_COMMAND', '- one\n\n  \\<!-- cara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'cut()', '- one\n\n  \\<!-- cara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'CUT_COMMAND', '- one\n\n  \\<!-- cara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'Enter', '- one\n\n  \\<!-- c\n\n  ara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'INSERT_PARAGRAPH_COMMAND', '- one\n\n  \\<!-- c\n\n  ara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'Shift+Enter', '- one\n\n  \\<!-- c\\\n  ara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'Tab', '- one\n\n  \\<!-- c\tara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'PASTE_COMMAND', '- one\n\n  \\<!-- czcara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'paste()', '- one\n\n  \\<!-- czcara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'paste nodes', '- one\n\n  \\<!-- c**zp**ara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'paste blocks', '- one\n\n  \\<!-- cp1 **zb**\n\n  p2ara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'drop insert', '- one\n\n  \\<!-- czdara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'IME start', '- one\n\n  \\<!-- c\u200bara\n\n  more\n\n- z\n\nafter'],
        ['TE43', 'insertImage', '- one\n\n  <!-- c1\n  c2 -->\n\n  para\n\n  more\n- z\n\nafter'],
        ['TE43', 'insertTable', '- one\n\n  <!-- c1\n  c2 -->\n\n  para\n\n  more\n- z\n\nafter'],
        ['TE43', 'insertHorizontalRule', '- one\n\n  <!-- c1\n  c2 -->\n\n  para\n\n  more\n- z\n\nafter'],
        ['TE44', 'Delete', '\\<!-- cwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'Backspace', '\\<!-- cwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'word delete', '\\<!-- cwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'REMOVE_TEXT_COMMAND', '\\<!-- cwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'cut()', '\\<!-- cwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'CUT_COMMAND', '\\<!-- cwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'Enter', '\\<!-- c\n\nwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'INSERT_PARAGRAPH_COMMAND', '\\<!-- c\n\nwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'Shift+Enter', '\\<!-- c\\\nwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'Tab', '\\<!-- c\two\n\npq\n\n- z\n\nafter'],
        ['TE44', 'PASTE_COMMAND', '\\<!-- czcwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'paste()', '\\<!-- czcwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'paste nodes', '\\<!-- c**zp**wo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'paste blocks', '\\<!-- cp1 **zb**\n\np2wo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'drop insert', '\\<!-- czdwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'IME start', '\\<!-- c\u200bwo\n\npq\n\n- z\n\nafter'],
        ['TE44', 'insertImage', '<!-- c1\nc2 -->\n\n- two\n\n  pq\n- z\n\nafter'],
        ['TE44', 'insertTable', '<!-- c1\nc2 -->\n\n- two\n\n  pq\n- z\n\nafter'],
        ['TE44', 'insertHorizontalRule', '<!-- c1\nc2 -->\n\n- two\n\n  pq\n- z\n\nafter'],
        ['TE62', 'Delete', 'last'],
        ['TE62', 'Backspace', 'last'],
        ['TE62', 'word delete', 'last'],
        ['TE62', 'REMOVE_TEXT_COMMAND', 'last'],
        ['TE62', 'cut()', 'last'],
        ['TE62', 'CUT_COMMAND', 'last'],
        ['TE62', 'Enter', 'last'],
        ['TE62', 'INSERT_PARAGRAPH_COMMAND', 'last'],
        ['TE62', 'Tab', 'last'],
        ['TE62', 'PASTE_COMMAND', 'zc\n\nlast'],
        ['TE62', 'paste()', 'zc\n\nlast'],
        ['TE62', 'paste nodes', '**zp**\n\nlast'],
        ['TE62', 'paste blocks', 'p1 **zb**\n\np2\n\nlast'],
        ['TE62', 'drop insert', 'zd\n\nlast'],
        ['TE62', 'IME start', '\u200b\n\nlast'],
    ])('%s, %s', async (id, route, expected) => {
        const shape = shapeOfId(id);
        const declines = route === 'insertImage' || route === 'insertTable' || route === 'insertHorizontalRule';

        for (const [backward, inUpdate] of VARIANTS) {
            const isRepeat = METHOD_ROUTES.includes(route) && inUpdate;

            if (isRepeat) {
                continue;
            }

            const editor = select(shape, backward);
            const range = rangeOf(editor);
            const context = `backward ${backward}, in an update ${inUpdate}`;

            vi.mocked(copyToClipboard).mockClear();
            await run(editor, route, inUpdate);

            expect(editor.getValue(), context).toBe(expected);

            if (declines) {
                expect(rangeOf(editor), context).toBe(range);

                continue;
            }

            expectParity(editor);
            lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
            expect(editor.getValue(), `undo, ${context}`).toBe(shape.source);
        }
    });

    it.each<[string, string]>([
        ['TS1', 'TE13'], ['TS2', 'TE25'], ['TS3', 'TE29'], ['TS4', 'TE36'], ['TS13', 'TE41'], ['TS14', 'TE50'],
        ['TS19', 'TE62'], ['TS20', 'TE63'], ['TS21', 'TE64'], ['TS22', 'TE65'],
    ])('%s: Shift+Enter over %s removes the range as Delete does, and adds no break', async (_name, id) => {
        const shape = shapeOfId(id);

        for (const [backward, inUpdate] of VARIANTS) {
            const editor = select(shape, backward);
            const deleted = select(shape, backward);

            await run(editor, 'Shift+Enter', inUpdate);
            await run(deleted, 'Delete', inUpdate);

            expect(editor.getValue(), `backward ${backward}, in an update ${inUpdate}`).toBe(shape.deleted);
            expect(editor.getValue(), `backward ${backward}, in an update ${inUpdate}`).toBe(deleted.getValue());
        }
    });

    it.each<[string, string, Route, string]>([
        ['TS5', 'TE25', 'paste blocks', '### hep1 **zb**\n\np2w text\\\n\\</div>\n\nafter'],
        ['TS6', 'TE8', 'Shift+Enter', '<'],
        ['TS7', 'TE32', 'Shift+Enter', '\\<d\n\nafter'],
        ['TS8', 'TE31', 'Tab', 'w text\n\n</div>\n\nafter'],
        ['TS9', 'TE31', 'paste nodes', '**zp**w text\n\n</div>\n\nafter'],
        ['TS10', 'TE31', 'Shift+Enter', '\\\nw text\n\n</div>\n\nafter'],
        ['TS11', 'TE36', 'INSERT_PARAGRAPH_COMMAND', '- ab\n\nafter'],
        ['TS12', 'TE5', 'paste nodes', '<div>\nrazp\n\nafter'],
        ['TS15', 'TE50', 'paste blocks', '### hep1 **zb**\n\np2\\<div>\\\nraw text\\\n\\</div>\n\nafter'],
        ['TS17', 'TE61', 'Enter', '> q1\n>\n> cd\n\nmore'],
    ])('%s: %s, %s', async (_name, id, route, expected) => {
        const shape = shapeOfId(id);

        for (const [backward, inUpdate] of VARIANTS) {
            const editor = select(shape, backward);

            await run(editor, route, inUpdate);

            expect(editor.getValue(), `backward ${backward}, in an update ${inUpdate}`).toBe(expected);
            expect(lexicalOf(editor).read(() => $getSelection()!.isCollapsed())).toBe(true);
        }
    });

    const CONTRACT_SHAPES = ['TE15', 'TE20', 'TE33', 'TE34', 'TE37', 'TE38', 'TE39', 'TE79', 'TE80', 'TE81'];
    const CONTRACT_ROUTES: readonly Route[] = ['word delete', 'cut()', 'Enter', 'INSERT_PARAGRAPH_COMMAND', 'PASTE_COMMAND', 'paste nodes', 'paste blocks'];

    it.each(CONTRACT_SHAPES.flatMap((id) => CONTRACT_ROUTES.map((route) => [id, route] as const)))(
        'TC: %s, %s gives what Delete and then the route gives', async (id, route) => {
            const shape = shapeOfId(id);
            const direct = select(shape, false);

            await run(direct, route, true);

            const stepped = select(shape, false);

            await run(stepped, 'Delete', true);
            stepped.getValue();
            syncCaretFormat(stepped);

            const insertsNothing = route === 'word delete' || route === 'cut()';

            if (!insertsNothing) {
                await run(stepped, route, true);
            }

            expect(direct.getValue()).toBe(stepped.getValue());
            expect(lexicalOf(direct).read(() => $getRoot().getTextContent())).toBe(lexicalOf(stepped).read(() => $getRoot().getTextContent()));
            expect(rootChildren(direct)).toEqual(rootChildren(stepped));
        });

    /** Shapes whose removal makes a raw block show as other blocks, each with where the removal's joint is in what Delete saves. */
    const JOINTS: ReadonlyArray<readonly [id: string, joint: TextPoint]> = [
        ['TE7', ['<fter', 1]], ['TE42', ['<!-- cfter', 6]], ['TE43', ['<!-- cara', 6]], ['TE44', ['<!-- cwo', 6]],
        ['TE47', ['fter', 0]], ['TE48', ['| fter', 2]], ['TE49', ['* yz', 0]],
        ['TE57', ['Note', 0]],
        ['TE69', [' next', 0]],
        ['TE76', ['cd ', 0]], ['TE77', ['next', 0]],
    ];

    /** The routes run at a joint: every route that acts over a guarded range, but for the native cut, which removes later. */
    const JOINT_ROUTES: readonly Route[] = [
        'Delete', 'Backspace', 'word delete', 'REMOVE_TEXT_COMMAND', 'cut()', 'type', 'IME start', 'drop insert', 'Enter',
        'INSERT_PARAGRAPH_COMMAND', 'Shift+Enter', 'Tab', 'PASTE_COMMAND', 'paste()', 'paste nodes', 'paste blocks',
    ];

    // But for Tab at a joint before inline code, which TS16 pins, or inside it (TE74): a tab takes the caret's format,
    // which the removal gives the caret for typed and pasted text only, where after Delete a browser's selection change
    // gives it for any key.
    // Nor has TE71 a cut() row: neither cut tags the update that removes the range for the run-edge rule, so a cut leaves the
    // bold that ends in punctuation beside the bold that opens with it as one run, where Delete tidies the two apart; the
    // route rows of TE71 pin both cuts.
    // TE60 and TE61 have no row here: the text node after their joint keeps a space that a save trims, so the document
    // Delete saves, loaded anew, holds another text node there. Nor has TE73: its joint is inside the two characters
    // of an escape, where a loaded document has no place.
    const JOINT_ROWS = JOINTS.flatMap(([id, joint]) => JOINT_ROUTES.map((route) => [id, route, joint] as const))
        .filter(([id, route]) => !((id === 'TE56' || id === 'TE74') && route === 'Tab') && !(id === 'TE71' && route === 'cut()'));

    it.each(JOINT_ROWS)(
        'TJ: %s, %s acts at the joint, where the selection was', async (id, route, joint) => {
            const shape = shapeOfId(id);
            const removesOnly = ['Delete', 'Backspace', 'word delete', 'REMOVE_TEXT_COMMAND', 'cut()'].includes(route);

            for (const backward of [false, true]) {
                const direct = select(shape, backward);

                await run(direct, route, true);

                // What Delete saves, loaded anew, with the caret set where the range was: no caret is carried over.
                const atJoint = load(shape.deleted);

                selectText(atJoint, joint, joint);
                syncCaretFormat(atJoint);

                if (!removesOnly) {
                    await run(atJoint, route, true);
                }

                expect(direct.getValue(), `backward ${backward}`).toBe(atJoint.getValue());
                expect(rootChildren(direct), `backward ${backward}`).toEqual(rootChildren(atJoint));
                expect(rangeOf(direct), `backward ${backward}`).toBe(rangeOf(atJoint));
            }
        });

    const RAW_QUOTE = `${RAW_QUOTE_ALONE}\n\nafter`;

    it.each<[string, string, TextPoint, TextPoint, Route, string, string]>([
        ['TP1: the text before the caret shows as written', `${RAW}\n\nafter`, ['<div>', 1], ['<div>', 4], 'Delete', '<>\nraw text\n\n</div>\n\nafter', '"<>"@1'],
        // A tab that indents a list item's line past the item's text has its source found: the line shows none of its blanks.
        ['TP9: a list item\'s line that a tab indents stands after the caret', '- a\n  > q\n- b\n\t zz\n\nafter', ['  > q', 2], ['  > q', 5], 'Delete', '- a\n\n- b\n  zz\n\nafter', '"b"@0'],
    ])('%s: an edit inside one raw block that makes it show as its blocks keeps the caret\'s place', async (_name, source, anchor, focus, route, expected, caret) => {
        const editor = load(source);

        selectText(editor, anchor, focus);
        await run(editor, route, true);

        expect(editor.getValue()).toBe(expected);
        expect(rangeOf(editor)).toBe(`${caret} -> ${caret}`);
    });

    it.each<[string, string, TextPoint, TextPoint, Route, string, string]>([
        // `marked` hands a task item's text back without the spaces that open it.
        ['TL3: a task item\'s text that opens with a space, after the caret', '- a\n  > q\n- [x]  zz\n\nafter', ['  > q', 2], ['  > q', 5], 'Delete', '- a\n\n- [x] zz\n\nafter', '"zz"@2 -> "zz"@2'],
    ])('%s: the caret goes to the end of its block (the limit)', async (_name, source, anchor, focus, route, expected, caret) => {
        const editor = load(source);

        selectText(editor, anchor, focus);
        await run(editor, route, true);

        expect(editor.getValue()).toBe(expected);
        expect(rangeOf(editor)).toBe(caret);
    });

    it('TL5: a tab between the words of the caret\'s own list item keeps the caret at the joint: `marked` 18.1 hands the tab back as written', async () => {
        const editor = load('- a\tb w\n  > q\n- b\n\nQZ 7Y');

        selectText(editor, ['- a\tb w', 7], ['QZ 7Y', 2]);
        await run(editor, 'Delete', true);

        expect(editor.getValue()).toBe('- a\tb w 7Y');
        expect(rangeOf(editor)).toBe('"a\\tb w 7Y"@5 -> "a\\tb w 7Y"@5');
    });

    it('TL4: a tab-indented line of an earlier item takes nothing from the caret\'s place', async () => {
        // The line a tab indents stands in an item before the caret\'s: all that follows the caret has its source found.
        const editor = load('- a\n\t zz\n- b w\n  > q\n\nafter');

        selectText(editor, ['- b w', 4], ['after', 1]);
        await run(editor, 'type', true);

        expect(editor.getValue()).toBe('- a\n  zz\n- b xfter');
    });

    /**
     * The editor's Markdown once nothing is pending: a typing shortcut is applied in an update of its own, which the
     * listener that sees a typed character starts when that character's update is committed, so each read here commits
     * what the one before it started.
     *
     * @param editor - The editor.
     * @returns Its Markdown.
     */
    function settledValue(editor: MarkdownEditor): string {
        lexicalOf(editor).read(() => null);
        lexicalOf(editor).read(() => null);

        return editor.getValue();
    }

    it.each<[string, string, TextPoint, TextPoint, string]>([
        ['TK1: escaped emphasis', '> a \\*x\\* w\n>\n> q2\n\nab cd', ['a *x* w', 5], ['ab cd', 2], '> a \\*x\\* cd'],
        ['TK2: an escaped bullet', '> \\- w\n>\n> q2\n\nab cd', ['- w', 2], ['ab cd', 2], '> \\-  cd'],
        ['TK3: an escaped heading marker', '> \\# w\n>\n> q2\n\nab cd', ['# w', 2], ['ab cd', 2], '> \\#  cd'],
        ['TK4: an escaped list number', '> 1\\. w\n>\n> q2\n\nab cd', ['1. w', 3], ['ab cd', 2], '> 1\\.  cd'],
        ['TK5: asterisks the joined text writes as text', '> a **Note:** w\n>\n> q2\n\nab **cd** ef', ['Note:', 5], ['cd', 1], '> a **Note:d** ef'],
    ])('%s: a removal that leaves the caret at the joint, right behind text that reads as a typing shortcut, completes none', async (_name, source, start, end, expected) => {
        for (const route of ['Delete', 'Backspace', 'word delete', 'REMOVE_TEXT_COMMAND', 'cut()'] as const) {
            for (const [backward, inUpdate] of VARIANTS) {
                const isRepeat = METHOD_ROUTES.includes(route) && inUpdate;

                if (isRepeat) {
                    continue;
                }

                const editor = load(source);
                const context = `${route}, backward ${backward}, in an update ${inUpdate}`;

                selectText(editor, backward ? end : start, backward ? start : end);
                await run(editor, route, inUpdate);

                expect(settledValue(editor), context).toBe(expected);
                expectParity(editor);

                // The removal is the one step there is: no shortcut ran as an update of its own after it.
                lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
                expect(settledValue(editor), `undo, ${context}`).toBe(source);
            }
        }
    });

    it.each<[string, Route]>([
        ['TK8: Enter over a range that ends at the end of a block, right behind escaped emphasis', 'Enter'],
        ['TK8: Shift+Enter over such a range', 'Shift+Enter'],
        ['TK8: a new paragraph over such a range', 'INSERT_PARAGRAPH_COMMAND'],
    ])('%s completes no typing shortcut', async (_name, route) => {
        // The range ends where its block does, so the break or the paragraph adds no text after the joint: all the update
        // leaves is escaped text right behind a shortcut's syntax, as the removal alone leaves it.
        for (const [backward, inUpdate] of VARIANTS) {
            const editor = load('> a \\*x\\* w\n>\n> q2\n\ntwo yz');

            selectText(editor, backward ? ['two yz', 6] : ['a *x* w', 5], backward ? ['a *x* w', 5] : ['two yz', 6]);
            await run(editor, route, inUpdate);

            expect(settledValue(editor), `backward ${backward}, in an update ${inUpdate}`).toMatch(/^> a \\\*x\\\*/);
        }
    });

    // A range inside one raw block is no guarded range: Lexical removes it, as it removes a range in an ordinary
    // paragraph, and a removal completes no typing shortcut. Here the block reads as a quote afterwards and the caret
    // stands at the joint, right behind the text, where the parent put it at the block's end.
    it('TK6: a removal inside one raw block that leaves the caret right behind text reading as a shortcut completes no shortcut', async () => {
        for (const inUpdate of [true, false]) {
            const editor = load('> a \\*x\\*.\n>\n> q2');

            selectText(editor, ['a *x*.', 5], ['q2', 0]);
            await run(editor, 'Delete', inUpdate);

            expect(settledValue(editor), `in an update ${inUpdate}`).toBe('> a \\*x\\*q2');
        }
    });

    it('TK7: Enter over a range that leaves the caret behind text reading as a marker starts a paragraph, and applies no shortcut', async () => {
        const source = '> \\- w\n>\n> q2\n\nab cd';

        for (const [backward, inUpdate] of VARIANTS) {
            const editor = load(source);
            const context = `backward ${backward}, in an update ${inUpdate}`;

            selectText(editor, backward ? ['ab cd', 5] : ['- w', 2], backward ? ['- w', 2] : ['ab cd', 5]);
            await run(editor, 'Enter', inUpdate);

            expect(settledValue(editor), context).toBe('> \\-');
            expect(rootChildren(editor), context).toEqual(['markdown-quote:- \n\n']);
            lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
            expect(settledValue(editor), `undo, ${context}`).toBe(source);
        }

        // Enter after Delete is another key press, and the Enter shortcut takes it: with the caret at the end of a block's
        // first text, and that text reading as a marker, it makes the block a list item. In a quote the editor's own
        // shortcut for the blocks a quote holds (registerHeldBlockShortcuts) does it, as Lexical's does at the top level,
        // and the item stands in the quote. It asks for a caret, so Enter over a selection never meets it; the two differ
        // here, as they do in a paragraph with no raw block.
        const stepped = load(source);

        selectText(stepped, ['- w', 2], ['ab cd', 5]);
        await run(stepped, 'Delete', true);
        expect(settledValue(stepped)).toBe('> \\-');
        await run(stepped, 'Enter', true);
        expect(settledValue(stepped)).toBe('> -');
    });

    it('TS16: Tab at a joint before inline code puts a plain tab before the code', async () => {
        // A tab takes the caret's format, and the removal gives the caret that of the text it lands in for typed and
        // pasted text only: Delete, then Tab in a browser, whose selection change gives it, puts the tab inside the code.
        for (const [backward, inUpdate] of VARIANTS) {
            const editor = select(shapeOfId('TE56'), backward);

            await run(editor, 'Tab', inUpdate);

            const [format, next] = lexicalOf(editor).read(() => {
                const tab = $dfs().map(({ node }) => node).find((node) => node.getType() === 'tab') as TextNode;

                return [tab.getFormat(), tab.getNextSibling()?.getTextContent()];
            });

            expect(editor.getValue(), `backward ${backward}, in an update ${inUpdate}`).toBe('> q1\n>\n> `code` rest\n\nlast');
            // 0 is Lexical's format bitmask with no format set.
            expect(format).toBe(0);
            expect(next).toBe('code');
        }
    });

    it.each<[string, Route, string]>([
        ['TG1', 'type', '<x>\nraw text\n</div>\n\nafter'],
        ['TG2', 'PASTE_COMMAND', '<zc>\nraw text\n</div>\n\nafter'],
        ['TG3', 'Delete', '<>\nraw text\n\n</div>\n\nafter'],
        ['TG4', 'Enter', '<\n\n>\n\nraw text\n\n</div>\n\nafter'],
    ])('%s: a selection inside one raw block is edited in place (%s)', async (_name, route, expected) => {
        const editor = load('<div>\nraw text\n</div>\n\nafter');

        selectText(editor, ['<div>', 1], ['<div>', 4]);
        await run(editor, route, true);

        expect(editor.getValue()).toBe(expected);
    });

    it('TG5: a paste that brings no node leaves the range as it is', () => {
        for (const backward of [false, true]) {
            const editor = select(shapeOfId('TE1'), backward);
            const lexical = lexicalOf(editor);
            const range = rangeOf(editor);

            lexical.update(() => { $insertGeneratedNodes(lexical, [], $getSelection()!); }, { discrete: true });

            expect(editor.getValue()).toBe(RAW_THEN_RICH);
            expect(rangeOf(editor)).toBe(range);
        }
    });

    it.each<[string, TextPoint, boolean]>([
        ['TG6: Backspace at the start of a paragraph after a raw block', ['efgh ', 0], true],
        ['TG7: Delete at the end of a raw block before a paragraph', ['</div>', 6], false],
    ])('%s joins the paragraph as its Markdown', (_name, point, backward) => {
        const editor = load('<div>\nraw text\n</div>\n\nefgh **ij** kl [a](u) \\*x\\*');

        selectText(editor, point, point);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, backward);

        expect(editor.getValue()).toBe('<div>\nraw text\n</div>efgh **ij** kl [a](u) \\*x\\*');
    });

    it.each<[string, boolean, string, string[]]>([
        ['TG9: Backspace', true, 'after', ['paragraph:', 'paragraph:after']],
        ['TG10: Delete', false, '#\n\nafter', ['heading:', 'paragraph:after']],
    ])('%s over a range from the start of the document\'s first block to a raw block\'s end is left to Lexical', (_name, backward, expected, children) => {
        const editor = select(shapeOfId('TE41'), false);

        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, backward);

        expect(editor.getValue()).toBe(expected);
        expect(rootChildren(editor)).toEqual(children);
    });

    it('TG8: a native cut (CUT_COMMAND) of a range from a raw block\'s start copies once, then removes it as Delete does', async () => {
        const shape = shapeOfId('TE2');
        const editor = select(shape, false);

        vi.mocked(copyToClipboard).mockClear();
        await run(editor, 'CUT_COMMAND', false);

        expect(copyToClipboard).toHaveBeenCalledTimes(1);
        expect(editor.getValue()).toBe(shape.deleted);
    });

    it.each(['TE62', 'TE63', 'TE64', 'TE65'])('TX1: Delete over %s leaves an empty paragraph where the raw block was, and the caret in it', async (id) => {
        const shape = shapeOfId(id);

        for (const [backward, inUpdate] of VARIANTS) {
            const editor = select(shape, backward);

            await run(editor, 'Delete', inUpdate);

            const nodes = JSON.stringify(lexicalOf(editor).getEditorState().toJSON());

            expect(nodes, `backward ${backward}, in an update ${inUpdate}`).not.toContain('"markdown-raw-block"');
            // An element point at the start of a paragraph that holds nothing.
            expect(rangeOf(editor), `backward ${backward}, in an update ${inUpdate}`).toBe('paragraph@0 -> paragraph@0');
        }
    });

    it.each<[string, string, TextPoint, TextPoint, Route, string, string[]]>([
        ['TX2: Delete', `${RAW}\n\nafter`, ['<div>', 0], ['</div>', 6], 'Delete', 'after', ['paragraph:', 'paragraph:after']],
        ['TX3: Delete, the raw block being the document', RAW, ['<div>', 0], ['</div>', 6], 'Delete', '', ['paragraph:']],
        ['TX4: Enter', `${RAW}\n\nafter`, ['<div>', 0], ['</div>', 6], 'Enter', 'after', ['paragraph:', 'paragraph:', 'paragraph:after']],
        ['TX6: type', `${RAW}\n\nafter`, ['<div>', 0], ['</div>', 6], 'type', 'x\n\nafter', ['paragraph:x', 'paragraph:after']],
        // A selection inside one raw block is edited in place: the pasted text goes into the raw block's text, plain.
        ['TX7: paste nodes', `${RAW}\n\nafter`, ['<div>', 0], ['</div>', 6], 'paste nodes', 'zp\n\nafter', ['paragraph:zp', 'paragraph:after']],
    ])('%s over all that a raw block holds leaves no raw block that holds nothing', async (_name, source, start, end, route, expected, children) => {
        for (const backward of [false, true]) {
            const editor = load(source);

            selectText(editor, backward ? end : start, backward ? start : end);
            await run(editor, route, true);

            expect(editor.getValue(), `backward ${backward}`).toBe(expected);
            expect(rootChildren(editor), `backward ${backward}`).toEqual(children);
            expectParity(editor);
        }
    });

    const ALL_ROUTES: readonly Route[] = [
        'Delete', 'Backspace', 'word delete', 'REMOVE_TEXT_COMMAND', 'cut()', 'CUT_COMMAND', 'type', 'IME start', 'drop insert', 'Enter',
        'INSERT_PARAGRAPH_COMMAND', 'Shift+Enter', 'Tab', 'PASTE_COMMAND', 'paste()', 'paste nodes', 'paste blocks', 'insertImage', 'insertTable',
        'insertHorizontalRule',
    ];

    // The read-only editor refuses each route before any guard of a range sees it: the document and the selection stay
    // as they are, and the refusal is reported.
    it.each(['TE1', 'TE5', 'TE30', 'TE31', 'TE62'].flatMap((id) => ALL_ROUTES.map((route) => [id, route] as const)))(
        'TRO: %s, %s is refused in a read-only editor over a range the editor removes itself', async (id, route) => {
            const shape = shapeOfId(id);

            for (const backward of [false, true]) {
                const editor = select(shape, backward);
                const before = rangeOf(editor);
                const roots = rootChildren(editor);
                let refusals = 0;

                editor.on('readonlyedit', () => { refusals += 1; });
                editor.setReadOnly(true);

                if (route === 'CUT_COMMAND') {
                    // A refused cut copies nothing, which `run` waits for.
                    stubEventClasses();
                    lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);
                } else {
                    await run(editor, route, false);
                }

                expect(editor.getValue(), `backward ${backward}`).toBe(shape.source);
                expect(rootChildren(editor), `backward ${backward}`).toEqual(roots);
                expect(rangeOf(editor), `backward ${backward}`).toBe(before);
                expect(refusals, `backward ${backward}`).toBeGreaterThan(0);
            }
        });

    it('TX5: Shift+Enter over all that a raw block holds removes it as Delete does, and adds no break', async () => {
        // The break would be all the block holds, which no save writes.
        for (const [backward, inUpdate] of VARIANTS) {
            const editor = load(`${RAW}\n\nafter`);
            const deleted = load(`${RAW}\n\nafter`);

            selectText(editor, backward ? ['</div>', 6] : ['<div>', 0], backward ? ['<div>', 0] : ['</div>', 6]);
            selectText(deleted, backward ? ['</div>', 6] : ['<div>', 0], backward ? ['<div>', 0] : ['</div>', 6]);
            await run(editor, 'Shift+Enter', inUpdate);
            await run(deleted, 'Delete', inUpdate);

            expect(editor.getValue()).toBe('after');
            expect(editor.getValue()).toBe(deleted.getValue());
        }
    });

    it('TX6: Shift+Enter over a range from a raw block\'s very start into a table removes it and adds no break', async () => {
        // As in TX5, the range is removed and no break is added: the break would be all the emptied block holds.
        for (const backward of [false, true]) {
            const editor = load(`${RAW}\n\n${TABLE}\n\nafter`);

            selectText(editor, backward ? ['c1', 1] : ['<div>', 0], backward ? ['<div>', 0] : ['c1', 1]);
            await run(editor, 'Shift+Enter', true);

            expect(editor.getValue(), `backward ${backward}`).toBe('after');
        }
    });

    it('TS18: typing over a range that starts after a space of a bold run types one run, outside an update as inside one', async () => {
        // The removal tags nothing as a deletion: typing is tidied where the caret is, as over any range, so the
        // dispatch's own update ends before or after the text is typed alike.
        for (const backward of [false, true]) {
            for (const inUpdate of [true, false]) {
                const editor = select(shapeOfId('TE52'), backward);

                await run(editor, 'type', inUpdate);

                expect(editor.getValue(), `backward ${backward}, in an update ${inUpdate}`).toBe(shapeOfId('TE52').typed);
            }
        }
    });

    it.each(['TE82', 'TE83'])('TS23: typing over %s keeps the bold of a link\'s text elsewhere in the block, as typing over any range does', async (id) => {
        const shape = shapeOfId(id);

        for (const backward of [false, true]) {
            for (const inUpdate of [true, false]) {
                const editor = select(shape, backward);

                await run(editor, 'type', inUpdate);

                expect(editor.getValue(), `backward ${backward}, in an update ${inUpdate}`).toBe(shape.typed);
            }
        }
    });

    it('TU1: a typed character that completes a typing shortcut in the block the removal leaves applies it as a step of its own', async () => {
        const source = '- a\n  > q\n\nafter word';
        const editor = load(source);

        selectText(editor, ['- a', 1], ['after word', 2]);
        // The removal shows the raw block as the paragraph `-ter word`; the space then makes it a list item's marker.
        lexicalOf(editor).update(() => { lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' '); }, { discrete: true });

        expect(editor.getValue()).toBe('- ter word');

        // The shortcut is an update of its own, as for any typed shortcut: one undo takes it back, a second the typing.
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        expect(editor.getValue()).toBe('\\- ter word');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        expect(editor.getValue()).toBe(source);
    });

    /** A range end held as a point on a node that holds blocks: the node's type, which node of that type, and a child index. */
    type HolderPoint = readonly [type: string, nth: number, index: number];

    const LIST_AFTER_RAW = `${RAW.replace('raw text', 'raw')}\n\n- la\n- lb\n\nafter`;
    const COLUMNS_AFTER_RAW = `${RAW.replace('raw text', 'raw')}\n\n::: columns\nca\n|||\ncb\n:::\n\nafter`;
    const RAW_AFTER_LIST = `before\n\n- la\n- lb\n\n${RAW.replace('raw text', 'raw')}\n\nafter`;
    const LIST_AFTER_CODE = `${FENCE}\ncode\n${FENCE}\n\n- la\n- lb\n\nafter`;
    const ITEM_BLOCKS_AFTER_RAW = `${RAW.replace('raw text', 'raw')}\n\n- one\n\n  para\n\n  more\n- z\n\nafter`;
    const TABLE_AFTER_RAW = `${RAW.replace('raw text', 'raw')}\n\n${TABLE}\n\nafter`;
    const RAW_AFTER_TABLE = `before\n\n${TABLE}\n\n${RAW.replace('raw text', 'raw')}\n\nafter`;

    /** Every route but the native cut, which runs offline only over a range the editor removes itself (TN14). */
    const POINT_ROUTES: readonly Route[] = [
        'Delete', 'Backspace', 'word delete', 'REMOVE_TEXT_COMMAND', 'cut()', 'type', 'IME start', 'drop insert', 'Enter',
        'INSERT_PARAGRAPH_COMMAND', 'Shift+Enter', 'Tab', 'PASTE_COMMAND', 'paste()', 'paste nodes', 'paste blocks', 'insertImage',
        'insertTable', 'insertHorizontalRule',
    ];

    /**
     * Loads `source` and selects from a text point to another end: a text point, or a point on a node that holds blocks.
     *
     * @param source - The Markdown.
     * @param inner - The end inside a raw block or a code block.
     * @param other - The other end.
     * @param backward - Whether the other end is the anchor.
     * @returns The editor.
     */
    function selectTo(source: string, inner: TextPoint, other: TextPoint | HolderPoint, backward: boolean): MarkdownEditor {
        const editor = load(source);

        lexicalOf(editor).update(() => {
            const selection = $createRangeSelection();
            const [near, far] = backward ? [selection.focus, selection.anchor] : [selection.anchor, selection.focus];

            near.set($textNode(inner[0]).getKey(), inner[1], 'text');

            if (other.length === 2) {
                far.set($textNode(other[0]).getKey(), other[1], 'text');
            } else {
                const [type, nth, index] = other;
                const holder = $dfs().map(({ node }) => node).filter((node) => node.getType() === type)[nth]!;

                far.set(holder.getKey(), index, 'element');
            }

            $setSelection(selection);
        }, { discrete: true });

        return editor;
    }

    /**
     * What an editor holds after a route: its Markdown and its nodes, and its selection too unless the route is a
     * method that declines, which leaves the selection as it was handed over.
     *
     * @param editor - The editor.
     * @param route - The route that ran.
     * @returns What it holds, as one text.
     */
    function outcomeOf(editor: MarkdownEditor, route: Route): string {
        const value = editor.getValue();
        const nodes = JSON.stringify(lexicalOf(editor).getEditorState().toJSON());
        const declines = route === 'insertImage' || route === 'insertTable' || route === 'insertHorizontalRule';

        return [value, nodes, declines ? '' : rangeOf(editor)].join('\n');
    }

    it.each<[string, string, TextPoint, HolderPoint, TextPoint]>([
        ['TN1: a list, before its first item', LIST_AFTER_RAW, ['raw', 1], ['list', 0, 0], ['</div>', 6]],
        ['TN2: a list, after its first item', LIST_AFTER_RAW, ['raw', 1], ['list', 0, 1], ['la', 2]],
        ['TN3: a list, after its last item', LIST_AFTER_RAW, ['raw', 1], ['list', 0, 2], ['lb', 2]],
        ['TN4: a list item, before its text', LIST_AFTER_RAW, ['raw', 1], ['markdown-list-item', 0, 0], ['</div>', 6]],
        ['TN5: a list item, after its text', LIST_AFTER_RAW, ['raw', 1], ['markdown-list-item', 1, 1], ['lb', 2]],
        ['TN6: the document, before the list', LIST_AFTER_RAW, ['raw', 1], ['root', 0, 1], ['</div>', 6]],
        ['TN7: the document, at its end', LIST_AFTER_RAW, ['raw', 1], ['root', 0, 3], ['after', 5]],
        ['TN8: a `:::` block, before its first column', COLUMNS_AFTER_RAW, ['raw', 1], ['markdown-block', 0, 0], ['</div>', 6]],
        ['TN9: a `:::` block, after its first column', COLUMNS_AFTER_RAW, ['raw', 1], ['markdown-block', 0, 1], ['ca', 2]],
        ['TN10: a column, before its paragraph', COLUMNS_AFTER_RAW, ['raw', 1], ['markdown-column', 1, 0], ['ca', 2]],
        ['TN11: a column, after its paragraph', COLUMNS_AFTER_RAW, ['raw', 1], ['markdown-column', 1, 1], ['cb', 2]],
        ['TN12: a list before the raw block, before its first item', RAW_AFTER_LIST, ['raw', 1], ['list', 0, 0], ['la', 0]],
        ['TN13: a list before the raw block, after its last item', RAW_AFTER_LIST, ['raw', 1], ['list', 0, 2], ['<div>', 0]],
        // A point on a table, a row or a cell is inside the table: the range reaches into it, as the range to the text
        // at that place in the table does, and both are removed with the whole table.
        ['TN21: a table, before its first row', TABLE_AFTER_RAW, ['raw', 1], ['table', 0, 0], ['a', 0]],
        ['TN22: a table row, after its first cell', TABLE_AFTER_RAW, ['raw', 1], ['tablerow', 0, 1], ['b', 0]],
        ['TN23: a table cell, after its paragraph', TABLE_AFTER_RAW, ['raw', 1], ['tablecell', 3, 1], ['d1', 2]],
        ['TN24: a table before the raw block, after its last row', RAW_AFTER_TABLE, ['raw', 1], ['table', 0, 2], ['d1', 2]],
        ['TN15: the document, at its start', RAW_AFTER_LIST, ['raw', 1], ['root', 0, 0], ['before', 0]],
        ['TN16: a list after a code block, before its first item', LIST_AFTER_CODE, ['code', 1], ['list', 0, 0], ['code', 4]],
        ['TN17: a list after a code block, after its first item', LIST_AFTER_CODE, ['code', 1], ['list', 0, 1], ['la', 2]],
        ['TN18: a list item, between its blocks', ITEM_BLOCKS_AFTER_RAW, ['raw', 1], ['markdown-list-item', 0, 2], ['para', 4]],
        ['TN19: a list, from the raw block\'s very start', LIST_AFTER_RAW, ['<div>', 0], ['list', 0, 0], ['</div>', 6]],
        ['TN20: a list\'s first item, from the raw block\'s very start', LIST_AFTER_RAW, ['<div>', 0], ['list', 0, 1], ['la', 2]],
    ])('%s: every route gives what it gives for the range to the text there', async (_name, source, inner, holder, text) => {
        for (const route of POINT_ROUTES) {
            for (const [backward, inUpdate] of VARIANTS) {
                const isRepeat = METHOD_ROUTES.includes(route) && inUpdate;

                if (isRepeat) {
                    continue;
                }

                const onHolder = selectTo(source, inner, holder, backward);
                const inText = selectTo(source, inner, text, backward);
                const context = `${route}, backward ${backward}, in an update ${inUpdate}`;

                await run(onHolder, route, inUpdate);
                await run(inText, route, inUpdate);

                expect(outcomeOf(onHolder, route), context).toBe(outcomeOf(inText, route));
                expectParity(onHolder);

                onHolder.dispose();
                inText.dispose();
            }
        }
    });

    it.each<[string, Route, string]>([
        ['TN1', 'Delete', '<div>\nr\n\n- la\n- lb\n\nafter'],
        ['TN1', 'Backspace', '<div>\nr\n\n- la\n- lb\n\nafter'],
        ['TN1', 'Enter', '<div>\nr\n\n- la\n- lb\n\nafter'],
        ['TN1', 'type', '<div>\nrx\n\n- la\n- lb\n\nafter'],
        ['TN1', 'paste blocks', '<div>\nrp1 zb\n\np2\n\n- la\n- lb\n\nafter'],
    ])('%s, %s: a range from a raw block to a point on the list after it, before its first item, loses no block', async (_id, route, expected) => {
        for (const [backward, inUpdate] of VARIANTS) {
            const editor = selectTo(LIST_AFTER_RAW, ['raw', 1], ['list', 0, 0], backward);
            const context = `backward ${backward}, in an update ${inUpdate}`;

            await run(editor, route, inUpdate);

            expect(editor.getValue(), context).toBe(expected);
            lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
            expect(editor.getValue(), `undo, ${context}`).toBe(LIST_AFTER_RAW);
        }
    });

    it('TN14: a native cut (CUT_COMMAND) of a range from a raw block to a point on a list, after its first item, cuts as the range to that item\'s text', async () => {
        for (const [backward, inUpdate] of VARIANTS) {
            const onHolder = selectTo(LIST_AFTER_RAW, ['raw', 1], ['list', 0, 1], backward);
            const inText = selectTo(LIST_AFTER_RAW, ['raw', 1], ['la', 2], backward);

            vi.mocked(copyToClipboard).mockClear();
            await run(onHolder, 'CUT_COMMAND', inUpdate);
            vi.mocked(copyToClipboard).mockClear();
            await run(inText, 'CUT_COMMAND', inUpdate);

            expect(onHolder.getValue(), `backward ${backward}, in an update ${inUpdate}`).toBe('<div>\nr\n\n- lb\n\nafter');
            expect(outcomeOf(onHolder, 'CUT_COMMAND'), `backward ${backward}, in an update ${inUpdate}`).toBe(outcomeOf(inText, 'CUT_COMMAND'));
        }
    });
});

describe('a range that takes a list item\'s text whole is removed the same way on every route (CI rows)', () => {
    /** A second item holding a paragraph, a nested list and a paragraph. */
    const A = '- ab\n- cd\n\n  pq\n  - nn\n\n  rr\n- z';
    /** A second item holding two paragraphs. */
    const B = '- ab\n- cd\n\n  pq\n\n  rr\n- z';
    /** What every removing route leaves of {@link A} for the range `ab`@1 to `pq`@1. */
    const A_REMOVED = '- aq\n  - nn\n\n  rr\n\n- z';

    /**
     * Loads `source` and selects the range `ab`@1 to `pq`@1.
     *
     * @param source - The Markdown to load.
     * @returns The editor.
     */
    function loadWithRange(source: string): MarkdownEditor {
        const editor = load(source);

        selectText(editor, ['ab', 1], ['pq', 1]);

        return editor;
    }

    it('CI70: paste() over the range', async () => {
        const editor = loadWithRange(A);

        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('zc');
        await editor.paste();

        expect(editor.getValue()).toBe('- azcq\n  - nn\n\n  rr\n\n- z');
    });

    it('CI71: a native cut (CUT_COMMAND) copies, then removes the range', async () => {
        const editor = loadWithRange(A);

        lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);

        await vi.waitFor(() => expect(editor.getValue()).toBe(A_REMOVED));
        expect(copyToClipboard).toHaveBeenCalledTimes(1);
    });

    it('CI72: a tab replaces the range', () => {
        const editor = loadWithRange(A);

        lexicalOf(editor).dispatchCommand(INSERT_TAB_COMMAND, undefined);

        expect(editor.getValue()).toBe('- a\tq\n  - nn\n\n  rr\n\n- z');
    });

    it('CI73: a word delete removes the range', () => {
        const editor = loadWithRange(A);

        lexicalOf(editor).dispatchCommand(DELETE_WORD_COMMAND, false);

        expect(editor.getValue()).toBe(A_REMOVED);
    });

    it('CI74: REMOVE_TEXT_COMMAND removes the range', () => {
        const editor = loadWithRange(A);

        lexicalOf(editor).dispatchCommand(REMOVE_TEXT_COMMAND, null);

        expect(editor.getValue()).toBe(A_REMOVED);
    });

    it('CI75: typing over a range that starts in bold text types bold', () => {
        const editor = load('- **ab**\n- cd\n\n  pq\n\n  rr\n- z');

        selectText(editor, ['ab', 1], ['pq', 1]);
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('- **ax**q\n\n  rr\n\n- z');
    });

    it('CI76: typing dispatched in the update of the removal lands in the item\'s text', () => {
        const editor = load(B);
        const lexical = lexicalOf(editor);

        selectText(editor, ['ab', 0], ['pq', 2]);
        lexical.update(() => {
            lexical.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');
        }, { discrete: true });

        expect(editor.getValue()).toBe('- x\n\n  rr\n\n- z');
    });

    it('CI77: a delete dispatched inside one update is one undo step', () => {
        const editor = loadWithRange(A);
        const lexical = lexicalOf(editor);

        lexical.update(() => {
            lexical.dispatchCommand(DELETE_CHARACTER_COMMAND, false);
        }, { discrete: true });

        expect(editor.getValue()).toBe(A_REMOVED);

        lexical.dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(load(A).getValue());
    });

    it('CI78: cut() writes the text copy() writes', () => {
        const written: string[] = [];

        vi.spyOn(DOM.sink, 'writeClipboardText').mockImplementation((text: string) => { written.push(text); });

        loadWithRange(A).cut();
        loadWithRange(A).copy();

        expect(written).toHaveLength(2);
        expect(written[0]).toBe(written[1]);
    });

    it('CI79: a paste that brings no node changes nothing', () => {
        const editor = loadWithRange(A);
        const lexical = lexicalOf(editor);

        lexical.update(() => { $insertGeneratedNodes(lexical, [], $getSelection()!); }, { discrete: true });

        expect(editor.getValue()).toBe(load(A).getValue());
        expect(rangeOf(editor)).toBe('"ab"@1 -> "pq"@1');
    });

    it('CI80: Shift+Enter over a range into a table, with no place for the break, removes the range as Delete does', () => {
        const source = '- ab\n- cd\n\n  | h |\n  | --- |\n  | pq |\n\n  rr\n- z';
        const editor = load(source);
        const deleted = load(source);

        selectText(editor, ['ab', 1], ['pq', 1]);
        selectText(deleted, ['ab', 1], ['pq', 1]);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
        lexicalOf(deleted).dispatchCommand(DELETE_CHARACTER_COMMAND, false);

        expect(editor.getValue()).toBe('- a\n\n  rr\n\n- z');
        expect(editor.getValue()).toBe(deleted.getValue());
    });
});

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

    // When this fails after a Lexical upgrade, Lexical opens a text node for a composition that starts at a
    // link's edge by itself — delete `$moveCaretOutOfLinkEdge` and `$pointOutsideLinkEdge` in `MarkdownEditor.ts`,
    // their registration and this canary, then run the browser check of
    // `plans/implemented/markdown-editor-typing-at-link-start-swallowed.md` again.
    it('U4: a composition that starts at a link\'s start is left to run in the link\'s own text', () => {
        const { editor, errors } = recordingEditor([LinkNode]);
        let composesInLink = false;

        editor.update(() => {
            const linked = $createTextNode('b');

            $getRoot().append($createParagraphNode().append($createLinkNode('u').append(linked), $createTextNode(' c')));
            linked.select(0, 0);
        }, { discrete: true });

        editor.dispatchCommand(COMPOSITION_START_COMMAND, compositionStartEvent());

        // Inside an update: Lexical reports no node as composing while it only reads.
        editor.update(() => {
            const composing = $dfs().map((entry) => entry.node).find((found) => $isTextNode(found) && found.isComposing());

            composesInLink = composing !== undefined && $isLinkNode(composing.getParent());
        }, { discrete: true });

        expect(errors).toEqual([]);
        expect(composesInLink).toBe(true);
    });
});

/** A code block holding `code`, then a blank line. */
const CODE = '```\ncode\n```\n\n';

/** A raw HTML block, then a blank line. */
const RAW = '<div>\nraw\n</div>\n\n';

/**
 * Stubs the event classes `registerRichText`'s paste handler tells apart by
 * name, and builds a plain-text paste event.
 *
 * @param text - The pasted text.
 * @returns The event.
 */
function plainTextPaste(text: string): ClipboardEvent {
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
    vi.stubGlobal('DragEvent', class DragEvent {});
    vi.stubGlobal('InputEvent', class InputEvent {});
    vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});

    return Object.assign(new ClipboardEvent('paste'), {
        clipboardData: { types: ['text/plain'], files: [], getData: (type: string) => (type === 'text/plain' ? text : '') },
        preventDefault: () => {},
    });
}

/** An input at the selection, as a route a range can be replaced through. */
const JOIN_ROUTES: Record<string, (editor: MarkdownEditor) => void> = {
    'typing': (editor) => { lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'Z'); },
    'plain-text paste': (editor) => {
        const event = plainTextPaste('Z');

        lexicalOf(editor).update(() => { lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event); }, { discrete: true });
    },
    'Enter': (editor) => { lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null); },
    'Shift+Enter': (editor) => { lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false); },
    'Tab': (editor) => { lexicalOf(editor).dispatchCommand(INSERT_TAB_COMMAND, undefined); },
};

/**
 * Undoes one history step. The history reports its state to a listener of
 * `CAN_UNDO_COMMAND` only once something listens for it, as the I rows do.
 *
 * @param editor - The editor.
 */
function undo(editor: MarkdownEditor): void {
    const lexical = lexicalOf(editor);
    let canUndo = false;
    const stopWatching = lexical.registerCommand(CAN_UNDO_COMMAND, (can) => { canUndo = can; return false; }, COMMAND_PRIORITY_LOW);

    lexical.dispatchCommand(UNDO_COMMAND, undefined);
    stopWatching();
    expect(canUndo, 'one undo is all there was').toBe(false);
}

describe('a join into a code block or raw block writes what the joined block held (J rows)', () => {
    /** Range rows: the source, where the range starts, where it ends, and the save. */
    const JOIN_ROWS: Array<[string, string, TextPoint, TextPoint, string, shown?: string[]]> = [
        ['J1', CODE + '### +alpha', ['code', 4], ['+alpha', 0], '```\ncode+alpha\n```'],
        ['J2', CODE + '### alpha \\#', ['code', 4], ['alpha #', 0], '```\ncodealpha \\#\n```'],
        ['J3', CODE + '### x # y', ['code', 4], ['x # y', 2], '```\ncode# y\n```'],
        ['J4', CODE + '+alpha', ['code', 4], ['+alpha', 0], '```\ncode+alpha\n```'],
        ['J5', CODE + '\\+ alpha', ['code', 4], ['+ alpha', 0], '```\ncode\\+ alpha\n```'],
        ['J6', CODE + 'a # b', ['code', 4], ['a # b', 2], '```\ncode# b\n```'],
        ['J7', CODE + 'a * b', ['code', 4], ['a * b', 0], '```\ncodea * b\n```'],
        ['J8', CODE + 'snake_case_x', ['code', 4], ['snake_case_x', 5], '```\ncode_case_x\n```'],
        ['J9', CODE + '> \\- alpha', ['code', 4], ['- alpha', 0], '```\ncode\\- alpha\n```'],
        ['J10', CODE + '- +alpha', ['code', 4], ['+alpha', 0], '```\ncode+alpha\n```'],
        ['J11', CODE + '- \\[ \\] x', ['code', 4], ['[ ] x', 0], '```\ncode\\[ \\] x\n```'],
        ['J12', CODE + 'x\\\n\\- y', ['code', 4], ['- y', 0], '```\ncode\\- y\n```'],
        ['J13', CODE + '+a\nb\n===', ['code', 4], ['+a', 0], '```\ncode\\+a\nb\n```'],
        ['J14', CODE + '> a\n> +b', ['code', 4], ['a', 0], '```\ncodea\n+b\n```'],
        ['K1', RAW + '### +alpha', ['</div>', 6], ['+alpha', 0], '<div>\nraw\n</div>+alpha'],
        ['K2', RAW + 'a * b', ['</div>', 6], ['a * b', 0], '<div>\nraw\n</div>a \\* b'],
        ['K3', RAW + 'a # b', ['</div>', 6], ['a # b', 2], '<div>\nraw\n</div># b'],
        ['K4', RAW + '### alpha \\#', ['</div>', 6], ['alpha #', 0], '<div>\nraw\n</div>alpha #'],
        // Regression row (passes on the base): a soft line break before the rest: the rest opens a line, as after a hard break (J12).
        ['J40', CODE + 'x\n\\+ y', ['code', 4], ['+ y', 0], '```\ncode\\+ y\n```'],
        // The shown paragraph keeps the one space the rest opened with, which the save drops (`\# y`), so a reload shows `# y`: the
        // importer keeps the leading space of a paragraph's first line, whoever wrote it (a document that opens with ` \# y` shows
        // the same), and is a known issue of its own. The rows pin what is shown.
        // Regression row (passes on the base): whitespace the rest opens a raw block's line with is indentation, not text the first
        // character follows.
        ['K5', '<div></div>\n\nx # y', ['<div></div>', 0], ['x # y', 1], '\\# y', ['paragraph: # y']],
        // Regression rows (pass on the base): a rest joined right after a raw quote's or list's container markers or a
        // continuation line's indentation opens a line there, so its line-start escape stays.
        ['K14', '- a\n  > q\n\n\\> x', ['- a', 2], ['> x', 0], '- \\> x'],
        ['K15', '- a\n  > q\n\n\\# x', ['  > q', 2], ['# x', 0], '- a\n  \\# x'],
        // An inline tag can span lines: a `>` that opens the rest closes a `<` opened on an earlier line of the raw block.
        ['K16', '- a <b\n  c w\n  > q\n\nab>cd', ['  c w', 3], ['ab>cd', 2], '- a \\<b\n  c>cd'],
        ['K17', '- a <b\n  c="d" w\n  > q\n\nab>cd', ['  c="d" w', 7], ['ab>cd', 2], '- a \\<b\n  c="d">cd'],
        // With no `<` left open, a leading `>` stays bare mid-line.
        ['K18', RAW + '\\> q', ['</div>', 6], ['> q', 0], '<div>\nraw\n</div>> q'],
        // The `>` of the rest that would close a tag the raw text leaves open is escaped wherever it stands in the rest, as the
        // viewer reads the joined text: a self-closing `/>`, attributes, or more of the tag's name before it.
        ['a self-closing rest closes no tag left open in a raw list', '- a <br w\n  > q\n\nab/>cd', ['- a <br w', 7], ['ab/>cd', 2], '- a \\<br/>cd'],
        ['a self-closing rest after a space closes no tag', '- a <br w\n  > q\n\nab />cd', ['- a <br w', 7], ['ab />cd', 2], '- a \\<br />cd'],
        ['an attribute in the rest closes no tag', '- a <br w\n  > q\n\nab x="1">cd', ['- a <br w', 7], ['ab x="1">cd', 2], '- a \\<br x="1">cd'],
        ['more of the tag\'s name in the rest closes no tag', '- a <br w\n  > q\n\nabr>cd', ['- a <br w', 7], ['abr>cd', 2], '- a \\<brr>cd'],
        ['a self-closing rest closes no tag left open in a raw list\'s quote line', '- a\n  > q <br w\n\nab/>cd', ['  > q <br w', 9], ['ab/>cd', 2], '- a\n  > q <br/\\>cd'],
        // Regression row (passes on the base): `/ >` closes no tag, so the rest is joined as it is.
        ['a rest the viewer reads no tag in is joined as it is', '- a <br w\n  > q\n\nab/ >cd', ['- a <br w', 7], ['ab/ >cd', 2], '- a \\<br/ >cd'],
        // Regression row (passes on the base): a code block holds plain text, so a no-break space at the rest's start is the
        // character, not `&nbsp;`.
        ['J41', CODE + '### &nbsp;alpha', ['code', 4], ['\u00a0alpha', 0], '```\ncode\u00a0alpha\n```'],
        // A nested item the selection empties stays an item: its bare `-` under the item above would read as a heading's underline,
        // so it is written `*`, as the save writes an empty item under text. A top-level item and an item in a quote keep the `-`.
        ['an emptied nested item stays an item', '- a\n  - b\n    > q\n  - c\n\nafter', ['  - b', 4], ['after', 5], '- a\n  *'],
        ['an emptied nested item from right after its dash', '- a\n  - b\n    > q\n  - c\n\nafter', ['  - b', 3], ['after', 5], '- a\n  *'],
        ['an emptied item under a continuation line', '- a\n  b\n  - c\n    > q\n\nafter', ['  - c', 4], ['after', 5], '- a\n  b\n  *'],
        ['an emptied item and a rest of spaces', '- a\n  - b\n    > q\n\nc  \n', ['  - b', 4], ['c  ', 1], '- a\n  *\n'],
        ['an emptied top-level item keeps its dash', '- a\n- b\n  > q\n\nafter', ['- b', 2], ['after', 5], '- a\n-'],
        ['an emptied item in a quote keeps its dash', '> a\n> - b\n>   > q\n\nafter', ['- b', 2], ['after', 5], '> a\n>\n> -'],
        // The whitespace a rest opens a raw block's line with is kept only as far as the line still reads as the rest's own text.
        ['a tab a rest opens a line with', '<div></div>\n\nx\t# y', ['<div></div>', 0], ['x\t# y', 1], '\\# y', ['paragraph: # y']],
        ['four spaces a rest opens a line with', '<div></div>\n\nx    # y', ['<div></div>', 0], ['x    # y', 1], '\\# y', ['paragraph: # y']],
        ['two tabs a rest opens a line with', '<div></div>\n\nx\t\tyy', ['<div></div>', 0], ['x\t\tyy', 1], 'yy', ['paragraph: yy']],
        ['spaces after a list marker', '- a\n  > q\n\nx    y', ['- a', 2], ['x    y', 1], '- y'],
        ['a space completing a bare star', '* a\n  > q\n\nx\t# y', ['* a', 1], ['x\t# y', 1], '* \\# y'],
        ['spaces completing a bare dash', '- a\n  > q\n  > r\n\nx    # y', ['- a', 1], ['x    # y', 1], '- \\# y'],
        ['a tab completing a bare dash', '- a\n  - b\n    > q\n  - c\n\nx  \t- y', ['  - b', 3], ['x  \t- y', 1], '- a\n  - \\- y'],
        ['four spaces a later HTML block\'s line opens with', '<div></div>\n\n<div>\n    y\n</div>', ['<div></div>', 0], ['    y', 0], 'y\n\n</div>'],
        ['a heading marker a later HTML block\'s line opens with', '<div></div>\n\n<div>\n# y\n</div>', ['<div></div>', 0], ['# y', 0], '\\# y\n\n</div>'],
        ['a later line of an HTML block that reads as a heading is left as it was', '<div></div>\n\n<div>\ny\n# z\n</div>', ['<div></div>', 0], ['y', 0], 'y\n\n# z\n\n</div>', ['paragraph:y', 'heading:z', 'markdown-raw-block:</div>']],
        ['a later line of an HTML block that underlines the first line is left as it was', '<div></div>\n\n<div>\nx\n---\n</div>', ['<div></div>', 0], ['x', 0], '## x\n\n</div>', ['heading:x', 'markdown-raw-block:</div>']],
        ['a later line of a code block that reads as a heading is left as it was', '<div></div>\n\n```\nx\n# y\n```', ['<div></div>', 0], ['x\n# y', 0], 'x\n\n# y', ['paragraph:x', 'heading:y']],
        ['emphasis on the first line of an HTML block keeps its asterisks', '<div></div>\n\n<div>\n*y*\n# z\n</div>', ['<div></div>', 0], ['*y*', 0], '*y*\n\n# z\n\n</div>', ['paragraph:y', 'heading:z', 'markdown-raw-block:</div>']],
        ['an emptied nested item before a later HTML block\'s line end', '- a\n  - b\n    > q\n  - c\n\n<div>\n    y\n</div>', ['  - b', 4], ['    y', 5], '- a\n  *\n\n</div>'],
        ['a heading marker joined after a bare list marker is escaped', '- a\n  - b\n    > q\n  - c\n\n<div>\n# y\n</div>', ['  - b', 4], ['# y', 0], '- a\n  - \\# y\n\n</div>'],
        ['a fence an HTML block line opens with is escaped', '<div></div>\n\n<div>\n```\nq\n</div>', ['<div></div>', 0], ['```', 0], '\\```\nq\n\n</div>', ['paragraph:``` q', 'markdown-raw-block:</div>']],
        ['a list number an HTML block line opens with is left as it was', '<div></div>\n\n<div>\n1. y\n</div>', ['<div></div>', 0], ['1. y', 0], '1. y\n\n</div>', ['list:y', 'markdown-raw-block:</div>']],
        ['a tab at an HTML block\'s line start', '<div>\nraw\n</div>\n\nx\t# y', ['raw', 0], ['x\t# y', 1], '<div>\n \\# y'],
    ];

    it.each(JOIN_ROWS)('%s: Delete over the range, either way round', (_row, source, start, end, saved, shown) => {
        for (const [anchor, focus] of [[start, end], [end, start]] as const) {
            const editor = load(source);

            selectText(editor, anchor, focus);
            lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);

            expect(editor.getValue()).toBe(saved);

            if (shown !== undefined) {
                expect(lexicalOf(editor).read(() => $getRoot().getChildren().map((child) => `${child.getType()}:${child.getTextContent()}`))).toEqual(shown);
            }
        }
    });

    /** The raw HTML the viewer reads in `markdown`, at any depth. */
    function htmlRead(markdown: string): string[] {
        const visit = (tokens: ReadonlyArray<{ type: string; raw: string; tokens?: unknown[]; items?: unknown[] }>): string[] => tokens.flatMap((token) => [
            ...(token.type === 'html' ? [token.raw] : []), ...visit((token.tokens ?? []) as never), ...visit((token.items ?? []) as never),
        ]);

        return visit(lexMarkdown(markdown) as never);
    }

    // Sweep: a raw list's text that leaves a tag open, at the end of the item's line or of its quote's line, joined with the
    // rest of a paragraph. The joined text reads as the two texts read: as text, with no HTML in it, in the editor and its reload.
    const OPEN_TAGS = ['<br', '<br x', '<br x="1"', '</b', '<b-c'];
    const TAG_RESTS = ['>cd', ' >cd', '/>cd', ' />cd', '\t/>cd', ' x>cd', ' x="1">cd', " x='1'/>cd", ' x=1 />cd', 'r>cd', 'r/>cd', '-x>cd', ' x=">">cd', '/ >cd', ' x'];
    const TAG_JOINS = OPEN_TAGS.flatMap((tag) => TAG_RESTS.flatMap((rest) => [
        { name: `${tag} at the item's line end, then ${JSON.stringify(rest)}`, source: `- a ${tag} w\n  > q\n\nab${rest}`, start: `- a ${tag} w`, read: `- a \\${tag}${rest}` },
        { name: `${tag} at the quote's line end, then ${JSON.stringify(rest)}`, source: `- a\n  > q ${tag} w\n\nab${rest}`, start: `  > q ${tag} w`, read: `- a\n  > q \\${tag}${rest}` },
    ]));

    it.each(TAG_JOINS)('a join after a tag left open: $name', ({ source, start, read }) => {
        const editor = load(source);

        selectText(editor, [start, start.length - 2], [`ab${source.split('\n\nab')[1]}`, 2]);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);

        const saved = editor.getValue();

        expect(htmlRead(saved)).toEqual([]);
        expect(viewerModel(saved).blocks).toEqual(viewerModel(read).blocks);
        expect(lexicalOf(load(saved)).read(() => $getRoot().getTextContent())).toBe(lexicalOf(editor).read(() => $getRoot().getTextContent()));
    });

    /** Delete over the range, then `input` at the caret that leaves: what a route must equal. */
    function deleteThen(source: string, start: TextPoint, end: TextPoint, input: (editor: MarkdownEditor) => void): MarkdownEditor {
        const editor = load(source);

        selectText(editor, start, end);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
        input(editor);

        return editor;
    }

    const ROUTE_ROWS: Array<[string, string, string, TextPoint, TextPoint, string]> = [
        ['J20', 'typing', CODE + '### +alpha', ['code', 4], ['+alpha', 0], '```\ncodeZ+alpha\n```'],
        ['J21', 'plain-text paste', CODE + '### +alpha', ['code', 4], ['+alpha', 0], '```\ncodeZ+alpha\n```'],
        ['J22', 'Enter', CODE + '### +alpha', ['code', 4], ['+alpha', 0], '```\ncode\n+alpha\n```'],
        ['J23', 'Shift+Enter', CODE + '### +alpha', ['code', 4], ['+alpha', 0], '```\ncode\n+alpha\n```'],
        ['J24', 'Tab', CODE + '### +alpha', ['code', 4], ['+alpha', 0], '```\ncode\t+alpha\n```'],
        ['J27', 'typing', CODE + '\\+ alpha', ['code', 4], ['+ alpha', 0], '```\ncodeZ\\+ alpha\n```'],
        ['J28', 'typing', CODE + '### alpha \\#', ['code', 4], ['alpha #', 0], '```\ncodeZalpha \\#\n```'],
        ['J29', 'typing', RAW + 'a * b', ['</div>', 6], ['a * b', 0], '<div>\nraw\n</div>Za \\* b'],
        ['typing over an emptied nested item', 'typing', '- a\n  - b\n    > q\n  - c\n\nafter', ['  - b', 4], ['after', 5], '- a\n  * Z'],
        ['typing over four spaces a later HTML block\'s line opens with', 'typing', '<div></div>\n\n<div>\n    y\n</div>', ['<div></div>', 0], ['    y', 0], 'Z y\n\n</div>'],
        ['typing over a heading marker a later HTML block\'s line opens with', 'typing', '<div></div>\n\n<div>\n# y\n</div>', ['<div></div>', 0], ['# y', 0], 'Z# y\n\n</div>'],
        ['typing over four spaces a later code block\'s line opens with', 'typing', '<div></div>\n\n```\n    y\n```', ['<div></div>', 0], ['    y', 0], 'Z y'],
        ['typing over a heading marker a later code block\'s line opens with', 'typing', '<div></div>\n\n```\n# y\n```', ['<div></div>', 0], ['# y', 0], 'Z# y'],
        ['typing over a tab a rest opens a line with', 'typing', '<div></div>\n\nx\t# y', ['<div></div>', 0], ['x\t# y', 1], 'Z # y'],
        ['typing from a raw block into a list item', 'typing', '<div></div>\n\n- x # y', ['<div></div>', 0], ['x # y', 1], 'Z # y'],
    ];

    it.each(ROUTE_ROWS)('%s: %s over the range writes what Delete writes, either way round', (_row, routeName, source, start, end, saved) => {
        const route = JOIN_ROUTES[routeName]!;

        for (const [anchor, focus] of [[start, end], [end, start]] as const) {
            const editor = load(source);

            selectText(editor, anchor, focus);
            route(editor);

            const expected = deleteThen(source, start, end, route);

            expect(editor.getValue()).toBe(saved);
            expect(editor.getValue()).toBe(expected.getValue());
            expect(rangeOf(editor)).toBe(rangeOf(expected));
        }
    });

    // A source the heading writes with an escape (`alpha \#`), which Lexical's own merge would move in without it.
    it.each([
        ['J25', DELETE_WORD_COMMAND, true],
        ['J25 (line)', DELETE_LINE_COMMAND, true],
        ['J25 (text)', REMOVE_TEXT_COMMAND, undefined],
    ] as const)('%s: a delete over the range written as Delete writes it', (_row, command, payload) => {
        const editor = load(CODE + '### alpha \\#');
        const deleted = load(CODE + '### alpha \\#');

        selectText(editor, ['code', 4], ['alpha #', 0]);
        lexicalOf(editor).dispatchCommand(command as never, payload as never);
        selectText(deleted, ['code', 4], ['alpha #', 0]);
        lexicalOf(deleted).dispatchCommand(DELETE_CHARACTER_COMMAND, true);

        expect(editor.getValue()).toBe(deleted.getValue());
        expect(editor.getValue()).toBe('```\ncodealpha \\#\n```');
    });

    it('J26: a cut of the range', async () => {
        const editor = load(CODE + '### +alpha');

        selectText(editor, ['code', 4], ['+alpha', 0]);
        lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);

        await vi.waitFor(() => expect(editor.getValue()).toBe('```\ncode+alpha\n```'));
    });

    const CARET_ROWS: Array<[string, string, TextPoint, boolean, string, string | null]> = [
        ['J30', CODE + '### alpha \\#', ['alpha #', 0], true, '```\ncodealpha \\#\n```', '"codealpha \\\\#"@4 -> "codealpha \\\\#"@4'],
        ['J31', CODE + '### alpha \\#', ['code', 4], false, '```\ncodealpha \\#\n```', '"codealpha \\\\#"@4 -> "codealpha \\\\#"@4'],
        ['J32', CODE + '> \\- alpha', ['- alpha', 0], true, '```\ncode\\- alpha\n```', null],
        ['J33', CODE + '- \\[ \\] x\n\n  para\n- two', ['[ ] x', 0], true, '```\ncode\\[ \\] x\n```\n\npara\n\n- two', null],
        ['J34', CODE + '1. \\[ \\] x\n2. two', ['code', 4], false, '```\ncode\\[ \\] x\n```\n\n1. two', null],
        ['K6', RAW + '+alpha', ['+alpha', 0], true, '<div>\nraw\n</div>+alpha', null],
        ['J35', CODE + '+alpha', ['+alpha', 0], true, '```\ncode+alpha\n```', '"code+alpha"@4 -> "code+alpha"@4'],
        ['J36', 'para\n\n- +alpha', ['+alpha', 0], true, 'para+alpha', null],
    ];

    it.each(CARET_ROWS)('%s: Backspace or Delete at the boundary', (_row, source, caret, isBackward, saved, after) => {
        const editor = load(source);

        selectText(editor, caret, caret);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, isBackward);

        expect(editor.getValue()).toBe(saved);

        if (after !== null) {
            expect(rangeOf(editor)).toBe(after);
        }
    });

    it('J37: one undo undoes the Backspace join', () => {
        const editor = load(CODE + '### +alpha');
        const loaded = editor.getValue();

        selectText(editor, ['+alpha', 0], ['+alpha', 0]);
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
        // Reading the value settles the join's update, which an undo then undoes as one step.
        expect(editor.getValue()).toBe('```\ncode+alpha\n```');
        undo(editor);

        expect(editor.getValue()).toBe(loaded);
    });

    it('J38: one undo undoes the typed join', () => {
        const editor = load(CODE + '### +alpha');
        const loaded = editor.getValue();

        selectText(editor, ['code', 4], ['+alpha', 0]);
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'Z');
        expect(editor.getValue()).toBe('```\ncodeZ+alpha\n```');
        undo(editor);

        expect(editor.getValue()).toBe(loaded);
    });
});

describe('a removal out of a raw block makes no heading or code block of what is left', () => {
    /** Raw blocks a removal can start in: lists holding a quote, an HTML block, a quote holding a list. */
    const RAW_BLOCKS = [
        '- a\n  - b\n    > q\n  - c', '- a\n  b\n  - c\n    > q', '1. a\n   - b\n     > q', '- a\n  > q\n  > r', '* a\n  > q', '<div>\nw\n</div>', '> a\n> - b\n>   > q',
    ];

    /**
     * Later blocks whose text holds whitespace and block markers a joined rest can open a line with: paragraphs, raw HTML blocks
     * and code blocks, indented and fenced.
     */
    const LATER_BLOCKS = [
        'after', 'x\t# y', 'x    # y', 'x  \t- y', 'x - y', '- x\t# y', '> x\t# y', 'x\t\tyy', '<div>\n    y\n</div>', '<div>\n# y\n</div>', '<div>\n\t- y\n</div>',
        '```\n    y\n```', '```\n# y\n```', '    x\n    # y', '```\nx\n    y\n# z\n```',
    ];

    // Vitest's default per-test timeout is 5s. One raw block loads some thousand editors, about two seconds of work per
    // hundred of them and several times that with the whole suite running beside it.
    const SWEEP_TIMEOUT_MS = 60_000;

    /** The block types the sweep watches for, among the tokens of a Markdown text at any depth. */
    const WATCHED_TYPES = ['heading', 'code', 'hr'];

    /**
     * How many blocks of each watched type a Markdown text holds, read as the viewer's lexer reads it, inside list items and quotes too.
     *
     * @param markdown - The Markdown.
     * @returns The count of each type.
     */
    function watchedCountsOf(markdown: string): Record<string, number> {
        const found: Record<string, number> = { heading: 0, code: 0, hr: 0 };
        const visit = (tokens: ReadonlyArray<{ type: string; tokens?: unknown[]; items?: unknown[] }>): void => {
            for (const token of tokens) {
                if (WATCHED_TYPES.includes(token.type)) {
                    found[token.type]! += 1;
                }

                visit((token.items ?? []) as never);

                if (token.type === 'blockquote' || token.type === 'list_item') {
                    visit((token.tokens ?? []) as never);
                }
            }
        };

        visit(lexMarkdown(markdown) as never);

        return found;
    }

    /** What the sweep knows of a text node: its size, where its block's text holds it, and what holds it. */
    interface SweepNode {
        readonly size:         number;
        /** The text of the node's top-level block. */
        readonly blockText:    string;
        /** Where the node's text starts in `blockText`. */
        readonly start:        number;
        /** Whether a raw block holds the node. */
        readonly isRaw:        boolean;
        /** Whether a code block holds the node. */
        readonly isCode:       boolean;
        /** Whether the node lies in the document's first block. */
        readonly isFirstBlock: boolean;
    }

    /**
     * Where every text node of the loaded document stands in document order, and what holds it.
     *
     * @param editor - The editor.
     * @returns The text nodes.
     */
    function textNodesOf(editor: MarkdownEditor): SweepNode[] {
        return lexicalOf(editor).read(() => {
            const first = $getRoot().getFirstChild();

            return $getRoot().getChildren().flatMap((top) => {
                let at = 0;
                const found: SweepNode[] = [];

                for (const { node } of $dfs(top)) {
                    if ($isElementNode(node) && !node.isInline()) {
                        continue;
                    }

                    if ($isTextNode(node)) {
                        found.push({
                            size:         node.getTextContentSize(),
                            blockText:    top.getTextContent(),
                            start:        at,
                            isRaw:        $findMatchingParent(node, $isMarkdownRawBlockNode) !== null,
                            isCode:       $findMatchingParent(node, (parent) => parent.getType() === 'code') !== null,
                            isFirstBlock: top.is(first),
                        });
                    }

                    if (!$isElementNode(node)) {
                        at += node.getTextContentSize();
                    }
                }

                return found;
            });
        });
    }

    /**
     * The headings and code blocks that the lines after the first line of what a selection leaves of a later raw or code block read
     * as on their own. Those lines were literal text where they stood; once the selection has cut away the line that opened their
     * block they read as the Markdown they look like, which is what an edit inside one raw block does as well, and is not what the
     * sweep guards: it allows these, and still checks that the first line, which meets the joint, makes none.
     *
     * @param to - The node the selection ends in.
     * @param offset - The offset in it.
     * @returns The counts the later lines hold; zero for a later block that holds Markdown.
     */
    function laterLinesCounts(to: SweepNode, offset: number): Record<string, number> {
        if (!to.isRaw && !to.isCode) {
            return { heading: 0, code: 0, hr: 0 };
        }

        const rest = to.blockText.slice(to.start + offset);

        return watchedCountsOf(rest.includes('\n') ? rest.slice(rest.indexOf('\n') + 1) : '');
    }

    /**
     * Selects between two text nodes found by their order in the document.
     *
     * @param editor - The editor.
     * @param anchor - The anchor's text node index and offset.
     * @param focus - The focus's text node index and offset.
     */
    function selectByIndex(editor: MarkdownEditor, anchor: [number, number], focus: [number, number]): void {
        lexicalOf(editor).update(() => {
            const texts = $dfs().map(({ node }) => node).filter((node) => $isTextNode(node));
            const selection = $createRangeSelection();

            selection.anchor.set(texts[anchor[0]]!.getKey(), anchor[1], 'text');
            selection.focus.set(texts[focus[0]]!.getKey(), focus[1], 'text');
            $setSelection(selection);
        }, { discrete: true });
    }

    it.each(RAW_BLOCKS.map((raw) => [raw] as const))('Delete over any range from %j into a later block leaves no new heading or code block', (raw) => {
        const offenders: string[] = [];
        const ends = { raw: 0, code: 0 };

        for (const later of LATER_BLOCKS) {
            const source = `${raw}\n\n${later}`;
            const nodes = textNodesOf(load(source));
            const sourceCounts = watchedCountsOf(source);

            if (!nodes.some((node) => node.isRaw && node.isFirstBlock)) {
                continue;
            }

            nodes.forEach((from, fromIndex) => {
                if (!from.isRaw || !from.isFirstBlock) {
                    return;
                }

                nodes.forEach((to, toIndex) => {
                    if (to.isFirstBlock) {
                        return;
                    }

                    for (let fromOffset = 0; fromOffset <= from.size; fromOffset++) {
                        for (let toOffset = 0; toOffset <= to.size; toOffset++) {
                            ends.raw += to.isRaw ? 1 : 0;
                            ends.code += to.isCode ? 1 : 0;

                            const editor = load(source);

                            selectByIndex(editor, [fromIndex, fromOffset], [toIndex, toOffset]);
                            lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);

                            const saved = editor.getValue();
                            const counts = watchedCountsOf(saved);
                            const allowed = laterLinesCounts(to, toOffset);
                            const made = WATCHED_TYPES.filter((type) => counts[type]! > sourceCounts[type]! + allowed[type]!);

                            if (made.length > 0) {
                                offenders.push(`${JSON.stringify(source)} text ${fromIndex}@${fromOffset} to text ${toIndex}@${toOffset} saved ${JSON.stringify(saved)} (${made.join(', ')})`);
                            }

                            // The sweep builds some thousand editors; releasing each keeps the memory of the run flat.
                            editor.dispose();
                        }
                    }
                });
            });
        }

        expect(offenders).toEqual([]);
        // The sweep must reach the ends inside later raw blocks and later code blocks, or it guards nothing there.
        expect(ends.raw).toBeGreaterThan(0);
        expect(ends.code).toBeGreaterThan(0);
    }, SWEEP_TIMEOUT_MS);
});
