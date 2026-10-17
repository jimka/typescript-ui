// Source-mode commands run through the WYSIWYG model: a command in "source" mode reads the Markdown near the selection
// into a short-lived headless editor, runs the WYSIWYG command there, and writes back only the text it changed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createParagraphNode, $createRangeSelection, $findMatchingParent, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, $setSelection,
} from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode } from 'lexical';
import { $dfs } from '@lexical/utils';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $importMarkdown } from '~/component/editor/markdownImporter';
import { $serializeMarkdownWithPlaces } from '~/component/editor/markdownSerializer';
import type { MarkdownSourceMap } from '~/component/editor/markdownSourceMap';
import { $selectSourceRange, $sourceRangeOfSelection, smallestEdit, sourceWindow, wholeDocumentWindow } from '~/component/editor/markdownSourceModel';
import { $isMarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
import { locateTopLevelBlocks } from '~/component/editor/markdownImporter';
import { prefixTabLines } from '~/component/display/markdownTabs';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { CORPUS } from './markdown-roundtrip/corpus';
import { $selectShownPlaces, shownPlacement } from './markdown-roundtrip/shownPlacement';
import type { ShownPlacement } from './markdown-roundtrip/shownPlacement';
import { $selectionCharacters, charactersOfSourceCaret, lexicalEditorOf, sourceMapOfEditor } from './markdown-roundtrip/sourceCaret';

// Each mock wraps one function in a spy that still does its work, so a test can count how often a command calls it; every
// other test of the file sees the modules unchanged.
vi.mock('~/component/display/markdownExtensions.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/component/display/markdownExtensions.js')>();

    return { ...actual, lexMarkdown: vi.fn(actual.lexMarkdown) };
});

vi.mock('~/component/editor/markdownImporter.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/component/editor/markdownImporter.js')>();

    return { ...actual, $importMarkdown: vi.fn(actual.$importMarkdown) };
});

vi.mock('~/component/editor/markdownSourceModel.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/component/editor/markdownSourceModel.js')>();

    return { ...actual, sourceWindow: vi.fn(actual.sourceWindow) };
});

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
});

/** A source selection, as the source editor reports one. */
interface SourceSelection {
    readonly from: number;
    readonly to:   number;
}

/** The commands a case runs, by name; each calls the public command. */
const COMMANDS: Record<string, (editor: MarkdownEditor) => unknown> = {
    bulleted:      (editor) => editor.toggleUnorderedList(),
    numbered:      (editor) => editor.toggleOrderedList(),
    paragraph:     (editor) => editor.setBlockType('paragraph'),
    h2:            (editor) => editor.setBlockType('h2'),
    quote:         (editor) => editor.setBlockType('quote'),
    code:          (editor) => editor.setBlockType('code'),
    bold:          (editor) => editor.toggleBold(),
    italic:        (editor) => editor.toggleItalic(),
    underline:     (editor) => editor.toggleUnderline(),
    strikethrough: (editor) => editor.toggleStrikethrough(),
    inlineCode:    (editor) => editor.toggleInlineCode(),
    link:          (editor) => editor.toggleLink('https://example.com/x'),
    unlink:        (editor) => editor.toggleLink(null),
    removeLink:    (editor) => editor.removeLink(),
    color:         (editor) => editor.setTextColor('#cc0000'),
    clear:         (editor) => editor.clearFormatting(),
    image:         (editor) => editor.insertImage('/i.png', { alt: 'pic' }),
};

/** The names of {@link COMMANDS} that change a block's type, and so act on whole blocks. */
const BLOCK_COMMANDS = ['bulleted', 'numbered', 'paragraph', 'h2', 'quote', 'code'];

/** The names of {@link COMMANDS} that change the text inside a block. */
const INLINE_COMMANDS = [
    'bold', 'italic', 'underline', 'strikethrough', 'inlineCode', 'link', 'unlink', 'removeLink', 'color', 'clear', 'image',
];

/**
 * Reaches the private source surface.
 *
 * @param editor - The editor.
 * @returns Its `CodeEditor`, shaped for the spies a case sets.
 */
function codeOf(editor: MarkdownEditor): { getSelection(): unknown; replaceRange(...args: unknown[]): unknown } {
    return (editor as unknown as { _codeEditor: { getSelection(): unknown; replaceRange(...args: unknown[]): unknown } })._codeEditor;
}

/** What running a command in source mode did. */
interface SourceRun {
    /** The editor, after the command. */
    readonly editor:  MarkdownEditor;
    /** The arguments of each `replaceRange` call. */
    readonly replaced: unknown[][];
    /** The source text after the command. */
    readonly text:    string;
    /** The selection the last replacement left, if there was one. */
    readonly caret:   SourceSelection | null;
    /** The `"change"` and `"selectionstate"` events the editor emitted during the command, by name. */
    readonly events:  string[];
    /** How often keyboard focus was given to the source editor during the command. */
    readonly focuses: number;
}

/**
 * Runs a command in a source-mode editor whose source editor reports the given selection.
 *
 * @param doc - The document.
 * @param selection - The source selection.
 * @param command - The command to run.
 * @param options - Whether the editor is read-only, and what to do after it is built and before the command runs.
 * @returns What the run did.
 */
function runInSource(
    doc: string, selection: SourceSelection, command: (editor: MarkdownEditor) => unknown, options: { readOnly?: boolean; beforeCommand?: () => void } = {},
): SourceRun {
    const editor = new MarkdownEditor(doc, { mode: 'source', readOnly: options.readOnly });
    const code = codeOf(editor);
    const replaced: unknown[][] = [];
    const original = code.replaceRange.bind(code);
    const events: string[] = [];
    let focuses = 0;

    editor.on('change', () => { events.push('change'); });
    editor.on('selectionstate', () => { events.push('selectionstate'); });
    vi.spyOn(code as unknown as { focus(): unknown }, 'focus').mockImplementation(() => { focuses += 1; });
    vi.spyOn(code, 'getSelection').mockReturnValue({ characterCount: 0, lineCount: 1, ...selection });
    vi.spyOn(code, 'replaceRange').mockImplementation((...args: unknown[]) => {
        replaced.push(args);

        return original(...args);
    });
    options.beforeCommand?.();
    command(editor);

    const last = replaced[replaced.length - 1];

    return { editor, replaced, text: editor.getValue(), caret: last?.[3] === undefined ? null : last[3] as SourceSelection, events, focuses };
}

/**
 * Builds a WYSIWYG editor of a document, ready for a selection.
 *
 * @param doc - The document.
 * @returns The editor.
 */
function wysiwygEditorOf(doc: string): MarkdownEditor {
    const editor = new MarkdownEditor(doc);

    editor.getValue();
    lexicalEditorOf(editor);

    return editor;
}

/**
 * Whether any part of the range selection lies inside a raw Markdown block.
 *
 * @returns `true` when the selection touches a raw block.
 */
function $selectionTouchesRawBlock(): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    const nodes = [selection.anchor.getNode(), selection.focus.getNode(), ...selection.getNodes()];

    return nodes.some((node) => $findMatchingParent(node, $isMarkdownRawBlockNode) !== null);
}

/**
 * What the WYSIWYG command gives for a source selection.
 */
interface WysiwygRun {
    /** Whether the selection had a place in the document. */
    readonly placed:       boolean;
    /** Whether the selection touches a raw block. */
    readonly touchesRaw:   boolean;
    /** The document the command saves. */
    readonly value:        string;
    /** The caret as indexes among the root's text. */
    readonly characters:   [number, number] | null;
    /** Whether both ends of the caret have an exact offset in the save. */
    readonly hasExactCaret: boolean;
    /** What kind of place an independent placement gave: text, a block that shows nothing, or a new last paragraph. */
    readonly kind:          'text' | 'empty' | 'newblock' | null;
    /** Whether an empty block the place is in holds more than one child on the way down, so that the place is not worked out from the source line (which does name the child) yet. */
    readonly crowded:       boolean;
    /** Whether the root block the place is in shows nothing at all, so that any command there has only that block to act on. */
    readonly blockShowsNothing: boolean;
    /** Where the blank lines a caret stands on are, when the WYSIWYG surface has no caret there (between blocks, before the first). */
    readonly blankWhere:       string | null;
}

/**
 * Where a source selection stands in the document, by the text the document shows there rather than by the source map
 * ({@link shownPlacement}): the places of both ends, or a new last paragraph for a collapsed caret on the blank lines
 * after the last block, where the mark makes a block of its own.
 *
 * @param doc - The document.
 * @param selection - The source selection.
 * @returns A function that selects the same place in a document of `doc` and says whether the place is in a block that
 *   shows nothing or below the last block, or `null` when the selection has no place by this reading.
 */
function independentPlacement(doc: string, selection: SourceSelection): { select: () => boolean; kind: 'text' | 'empty' | 'newblock'; crowded: boolean; blockShowsNothing: boolean; blankWhere: string | null } | null {
    const start = shownPlacement(doc, selection.from);
    const end = selection.from === selection.to ? start : shownPlacement(doc, selection.to);
    const isCaret = selection.from === selection.to;

    if (isCaret && start.kind === 'newblock' && start.where === 'after-last') {
        return { select: () => $selectShownPlaces(null, null), kind: 'newblock', crowded: false, blockShowsNothing: true, blankWhere: null };
    }

    if (isCaret && start.kind === 'newblock') {
        // On the blank lines between blocks or before the first the mark makes a block of its own that the document does not have:
        // the WYSIWYG surface has no caret there, and a source-mode command must not act.
        return { select: () => false, kind: 'newblock', crowded: false, blockShowsNothing: true, blankWhere: start.where ?? 'between' };
    }

    const usable = (placement: ShownPlacement): boolean => placement.kind === 'text' || placement.kind === 'empty';

    if (!usable(start) || !usable(end)) {
        return null;
    }

    const kind = start.kind === 'empty' || end.kind === 'empty' ? 'empty' : 'text';

    return { select: () => $selectShownPlaces(start.place!, end.place!), kind, crowded: start.crowded === true || end.crowded === true, blockShowsNothing: start.blockShowsNothing !== false && end.blockShowsNothing !== false, blankWhere: null };
}

/**
 * Runs a command on the WYSIWYG surface at the place a source selection stands: the place the source map gives, or
 * the one the shown text gives ({@link independentPlacement}), which does not depend on the code under test.
 *
 * @param doc - The document.
 * @param selection - The source selection.
 * @param command - The command.
 * @param placement - How the place is found.
 * @returns What it gave.
 */
function runInWysiwyg(
    doc: string, selection: SourceSelection, command: (editor: MarkdownEditor) => unknown, placement: 'mapped' | 'independent' | (() => boolean),
): WysiwygRun {
    const independent = placement === 'independent' ? independentPlacement(doc, selection) : null;
    const place = independent !== null ? independent.select : (typeof placement === 'function' ? placement : null);
    const editor = wysiwygEditorOf(doc);
    const lexical = lexicalEditorOf(editor);
    const map = sourceMapOfEditor(editor);
    let placed = false;
    let touchesRaw = false;

    lexical.update(() => {
        placed = placement === 'mapped' ? $selectSourceRange(doc, map, selection.from, selection.to) : place !== null && place();
        touchesRaw = placed && $selectionTouchesRawBlock();
    }, { discrete: true });

    if (!placed) {
        const value = editor.getValue();

        editor.dispose();

        return { placed, touchesRaw, value, characters: null, hasExactCaret: false, kind: null, crowded: false, blockShowsNothing: false, blankWhere: independent?.blankWhere ?? null };
    }

    // A document the save writes otherwise than it was written (a lazy line given its blank line) is the same document: a command
    // that changes nothing leaves it as it was.
    const savedBefore = editor.getValue();

    command(editor);

    const run = lexical.read(() => {
        const saved = $serializeMarkdownWithPlaces(sourceMapOfEditor(editor));
        const range = $sourceRangeOfSelection(saved.text, saved.places);

        const characters = $selectionCharacters();
        // A caret in a block with no text before it (after an image, in a cell) has no character to compare.
        const standsOnText = characters !== null && characters[0] !== -1 && characters[1] !== -1;

        return {
            characters,
            hasExactCaret: range !== null && range.from !== null && range.to !== null && standsOnText,
        };
    });
    const value = editor.getValue();

    editor.dispose();

    return { placed, touchesRaw, value: value === savedBefore ? doc : value, ...run, kind: independent?.kind ?? null, crowded: independent?.crowded ?? false, blockShowsNothing: independent?.blockShowsNothing ?? false, blankWhere: independent?.blankWhere ?? null };
}

/** One document of the differential. */
interface DifferentialDocument {
    readonly name:   string;
    readonly source: string;
}

/** Documents in forms the editor does not save in, which the round-trip corpus holds few of. */
const HAND_WRITTEN: readonly DifferentialDocument[] = [
    { name: 'star bullets', source: '* one\n* two\n* three\n' },
    { name: 'plus bullets, loose', source: '+ one\n\n+ two\n\n+ three\n' },
    { name: 'paren numbers', source: '1) one\n2) two\n3) three\n' },
    { name: 'numbers from 7', source: '7. one\n8. two\n' },
    { name: 'four-space nesting', source: '- one\n    - inner one\n    - inner two\n- two\n' },
    { name: 'tab nesting', source: '- one\n\t- inner\n- two\n' },
    { name: 'setext headings', source: 'Title\n=====\n\nSub\n---\n\ntext\n' },
    { name: 'closed atx heading', source: '## Title ##\n\ntext\n' },
    { name: 'underscore emphasis', source: '__bold__ and _it_ here\n' },
    { name: 'tilde fence', source: '~~~js\ncode\n~~~\n\ntext\n' },
    { name: 'lazy quote', source: '> one\ntwo\n\ntext\n' },
    { name: 'trailing spaces', source: 'one  \ntwo   \n\nthree\n' },
    { name: 'hard-wrapped paragraph', source: 'a long paragraph\nwrapped by hand\nover three lines\n\nnext\n' },
    { name: 'mixed list with star', source: 'intro\n\n* a\n* b\n  continued\n* c\n\noutro\n' },
    { name: 'list of 20 star items', source: Array.from({ length: 20 }, (_, i) => `* item ${i + 1}`).join('\n') + '\n' },
    { name: 'nested list four-space, 12 items', source: Array.from({ length: 6 }, (_, i) => `* item ${i + 1}\n    * sub ${i + 1}`).join('\n') + '\n' },
    { name: 'table unaligned', source: '|a|b|\n|-|-|\n|1|2|\n\ntext\n' },
    { name: 'html block', source: '<div>\nhi\n</div>\n\ntext\n' },
    { name: 'reference links', source: 'see [a][1] and [b]\n\n[1]: /one\n[b]: /two\n' },
    { name: 'reference links, definitions first', source: '[1]: /one\n\nintro\n\nsee [a][1] here\n\nmore\n\nend\n' },
    { name: 'look-alike lines', source: '- one\n\n\tsame\n\n  same\n- two\n' },
    { name: 'tab-indented paragraph', source: '- one\n\n\tsecond\n- two\n' },
    { name: 'tab continuation', source: '- one\n\ttwo\n' },
    { name: 'tab nested item', source: '- a\n\t- b c\n' },
    { name: 'merged cell', source: '| a | b | c |\n| --- | --- | --- |\n| x | << | y z |\n' },
    { name: 'character reference', source: 'a &#35; b and more\n' },
];

/**
 * The offset in the middle of each non-blank line.
 *
 * @param source - The document.
 * @returns The offsets, in order.
 */
function lineMiddles(source: string): number[] {
    const middles: number[] = [];
    let start = 0;

    for (const line of source.split('\n')) {
        if (line.trim() !== '') {
            middles.push(start + Math.floor(line.length / 2));
        }

        start += line.length + 1;
    }

    return middles;
}

describe('the window and the mapping', () => {
    const FIVE = '# h\n\npara\n\n- a\n\n> q\n\nend';

    it('4.1: a caret in a block imports that block and one on each side', () => {
        const caret = FIVE.indexOf('- a') + 2;

        expect(sourceWindow(FIVE, caret, caret)).toEqual({ start: FIVE.indexOf('para'), end: FIVE.indexOf('> q') + 3, before: '', after: '' });
    });

    it('4.2: a window that reaches the first block starts at the document start', () => {
        const caret = 2;

        expect(sourceWindow(FIVE, caret, caret)).toEqual({ start: 0, end: FIVE.indexOf('para') + 4, before: '', after: '' });
    });

    it('4.3: a range from the second block into the fourth imports the whole document', () => {
        expect(sourceWindow(FIVE, FIVE.indexOf('para'), FIVE.indexOf('> q') + 2)).toEqual(wholeDocumentWindow(FIVE));
    });

    it('4.4: the definition blocks after the window travel with it, set apart by a blank line', () => {
        const doc = 'see [a][1] here\n\nmid\n\nmore\n\nend\n\n[1]: /one';
        const caret = doc.indexOf('here') + 1;
        const window = sourceWindow(doc, caret, caret);

        expect(window).toEqual({ start: 0, end: doc.indexOf('mid') + 3, before: '', after: '\n\n[1]: /one' });
    });

    it('4.5: the definition blocks before the window travel in front of it', () => {
        const doc = '[1]: /one\n\nmid\n\nmore\n\nend\n\nsee [a][1] here';
        const caret = doc.indexOf('here') + 1;
        const window = sourceWindow(doc, caret, caret);

        expect(window.before).toBe('[1]: /one\n\n');
        expect(window.after).toBe('');
    });

    it('4.6: a definition no top-level block holds makes the window the whole document', () => {
        const doc = '- a\n\n  [x]: /u\n\nmid\n\nmore\n\nb [x] c';
        const caret = doc.indexOf('c');

        expect(sourceWindow(doc, caret, caret)).toEqual(wholeDocumentWindow(doc));
    });

    it('4.7: the smallest edit is what lies between the common start and the common end', () => {
        expect(smallestEdit('a b c', 'a **b** c')).toEqual({ from: 2, to: 3, insert: '**b**' });
        expect(smallestEdit('same', 'same')).toBeNull();
    });

    it('4.7: the smallest edit never cuts a pair of surrogates in two', () => {
        expect(smallestEdit('a\u{1F600}b', 'a\u{1F601}b')).toEqual({ from: 1, to: 3, insert: '\u{1F601}' });
    });

    /**
     * Selects a source range in a WYSIWYG editor of the document.
     *
     * @param doc - The document.
     * @param from - The range's start.
     * @param to - The range's end.
     * @returns Whether the range was placed, and the text counts it covers.
     */
    function selectRange(doc: string, from: number, to: number): { placed: boolean; characters: [number, number] | null } {
        const editor = wysiwygEditorOf(doc);
        const map = sourceMapOfEditor(editor);
        let result: { placed: boolean; characters: [number, number] | null } = { placed: false, characters: null };

        lexicalEditorOf(editor).update(() => {
            const placed = $selectSourceRange(doc, map, from, to);

            result = { placed, characters: placed ? $selectionCharacters() : null };
        }, { discrete: true });
        editor.dispose();

        return result;
    }

    it('4.8: a collapsed caret on a blank line between blocks has no place', () => {
        expect(selectRange('one\n\ntwo', 4, 4).placed).toBe(false);
    });

    it('4.9: a range end on a blank line moves inward', () => {
        expect(selectRange('one\n\ntwo', 0, 4)).toEqual({ placed: true, characters: [0, 3] });
        expect(selectRange('one\n\ntwo', 4, 8)).toEqual({ placed: true, characters: [3, 6] });
        expect(selectRange('one\n\ntwo', 4, 4).placed).toBe(false);
    });
});

/** One row of the pass: the document, the selection, the command, and what it leaves. */
type PassRow = [id: string, doc: string, from: number, to: number, command: string, text: string, caret: SourceSelection | null];

describe('the pass: a source-mode command runs the WYSIWYG command on the Markdown around the selection', () => {
    const at = (offset: number, end: number = offset): SourceSelection => ({ from: offset, to: end });

    const ROWS: PassRow[] = [
        ['5.1', 'hello world', 8, 8, 'bold', 'hello **world**', at(8, 13)],
        ['5.2', 'hello world', 6, 11, 'bold', 'hello **world**', at(8, 13)],
        ['5.3', 'one\n\ntwo', 1, 1, 'h2', '## one\n\ntwo', at(4)],
        ['5.4', '- one\n\n  second\n\n- two', 10, 10, 'bulleted', '- one\n\n- second\n\n- two', at(10)],
        ['5.5', 'see docs here', 6, 6, 'link', 'see [docs](https://example.com/x) here', at(5, 9)],
        ['5.6', 'a word b', 3, 3, 'color', 'a [word]{color=#cc0000} b', at(3, 7)],
        ['5.7', 'a **bold** b', 5, 5, 'clear', 'a bold b', at(3)],
        ['5.8', 'ab cd', 1, 1, 'image', 'a![pic](/i.png)b cd', at(15)],
        ['5.9', 'a [x](/u) b', 4, 4, 'unlink', 'a x b', null],
        ['5.9', 'a [x](/u) b', 4, 4, 'removeLink', 'a x b', null],
        ['5.10', 'a bc d', 3, 3, 'inlineCode', 'a `bc` d', at(3, 5)],
        ['5.11', 'one', 1, 1, 'numbered', '1. one', at(4)],
        ['5.12', 'one\ntwo', 1, 1, 'quote', '> one\n> two', null],
        ['5.13', 'one\n\ntwo', 1, 6, 'code', '```\none\n```\n\n```\ntwo\n```', null],
        ['5.14', '```\ncode\n```', 6, 6, 'paragraph', 'code', at(2)],
        ['5.15', '* one\n    * inner\n* two', 21, 21, 'bold', '* one\n  * inner\n* **two**', null],
        ['5.16', '>\tfoo bar\n>\tbaz', 3, 3, 'bold', '> **foo** bar\n> baz', null],
        ['5.17', 'a &#35; b and more', 16, 16, 'bold', 'a # b and **more**', at(12, 16)],
        ['5.18', 'see [a][1] here\n\nmid\n\nmore\n\nend\n\n[1]: /one', 12, 12, 'bold', 'see [a][1] **here**\n\nmid\n\nmore\n\nend\n\n[1]: /one', at(13, 17)],
        ['5.19', '- one\n\ttwo', 8, 8, 'bulleted', 'one\ntwo', null],
        ['5.20', '- a\n\t- b c', 7, 7, 'bold', '- a\n  - **b** c', null],
    ];

    it.each(ROWS.map((row) => [`${row[0]} ${row[4]}`, row] as const))('%s: gives the text, and the caret where the WYSIWYG command leaves it', (_title, [, doc, from, to, command, text, caret]) => {
        const run = runInSource(doc, { from, to }, COMMANDS[command]!);

        expect(run.text).toBe(text);

        if (caret !== null) {
            expect(run.caret).toEqual(caret);
        }

        run.editor.dispose();
    });

    it('a window whose carried definitions do not come back is run again on the whole document', () => {
        // A carried block that the command merges into the block it acts on is not written back as it was carried: here
        // `- x` and the item the command makes join one list. (The definition blocks a real window carries stay apart.)
        const doc = 'one\n\ntwo';

        vi.mocked(sourceWindow).mockImplementationOnce(() => ({ start: 0, end: doc.length, before: '- x\n\n', after: '' }));

        const run = runInSource(doc, { from: 1, to: 1 }, COMMANDS.bulleted!);

        expect(run.text).toBe('- one\n\ntwo');
        expect(run.replaced).toHaveLength(1);
        run.editor.dispose();
    });

    it('5.21: a list toggle on a block the WYSIWYG surface keeps as raw Markdown does nothing, at once', () => {
        const doc = '\n\n 1.\t</pre>\n \t  >\t#\th\n';
        const started = performance.now();
        const run = runInSource(doc, { from: 7, to: 7 }, COMMANDS.bulleted!);

        expect(run.text).toBe(doc);
        expect(performance.now() - started).toBeLessThan(1_000);
        run.editor.dispose();
    });

    it('5.22: one replacement, as the smallest edit between the two texts', () => {
        const run = runInSource('hello world', { from: 8, to: 8 }, COMMANDS.bold!);

        expect(run.replaced).toEqual([[6, 11, '**world**', { from: 8, to: 13 }]]);
        run.editor.dispose();
    });

    it('5.23: the WYSIWYG editor is not built by a source-mode command', () => {
        const run = runInSource('hello world', { from: 8, to: 8 }, COMMANDS.bold!);

        expect((run.editor as unknown as { _editor: LexicalEditor | null })._editor).toBeNull();
        run.editor.dispose();
    });

    const DECLINES: Array<[id: string, doc: string, from: number, to: number, commands: string[], why: string]> = [
        ['5.24', '> - one\n> - two', 5, 5, ['bulleted', 'numbered'], 'the selection touches a raw block'],
        ['5.25', 'one\n\n---\n\ntwo', 1, 11, ['bulleted'], 'the selection touches a raw block'],
        ['5.26', '<div>x</div>\n\ntwo', 6, 6, ['bulleted'], 'the selection touches a raw block'],
        ['5.27', 'one\n\ntwo', 4, 4, ['bold'], 'a caret on a blank line has no place'],
        ['5.28', '```\ncode\n```', 6, 6, ['bold'], 'the WYSIWYG command declines in a code block'],
        ['5.29', 'hello world', 0, 11, ['paragraph'], 'the WYSIWYG command changes nothing'],
        ['5.31', '> a\n\t- -\nb', 3, 3, ['bold'], 'the walk does not find the source there'],
    ];

    it.each(DECLINES.flatMap(([id, doc, from, to, commands, why]) => commands.map((command) => [`${id} ${command}`, doc, from, to, command, why] as const)))(
        '%s: changes nothing and reports nothing', (_title, doc, from, to, command) => {
            const run = runInSource(doc, { from, to }, COMMANDS[command]!);

            expect(run.text).toBe(doc);
            expect(run.replaced).toEqual([]);
            expect(run.events).toEqual([]);
            expect(run.focuses).toBe(1);
            run.editor.dispose();
        },
    );

    it('5.30: a text holding a carriage return does nothing', () => {
        const run = runInSource('one\r\ntwo', { from: 1, to: 1 }, COMMANDS.bold!);

        expect(run.replaced).toEqual([]);
        run.editor.dispose();
    });

    it('a command reports no change and no selection state of its own: only the source editor reports', () => {
        const runs = [COMMANDS.bold!, COMMANDS.h2!, COMMANDS.bulleted!].map((command) => runInSource('hello world', { from: 8, to: 8 }, command));

        // Offline the source editor reports no change, so a call could only come from the model.
        expect(runs.flatMap((run) => run.events)).toEqual([]);
        runs.forEach((run) => run.editor.dispose());
    });
});

describe('a caret where a block shows nothing, or below the last block', () => {
    // [shape, document, caret, block]: a caret the source map gives no shown character to stand beside. A user's caret
    // stands in the empty block itself (the block's index among the root's children), in the empty root, or in a new last
    // paragraph below the last block (`null`). Where the mark that places a caret by the shown text would change the
    // syntax (`#` followed by a mark is text), the WYSIWYG side names the block instead.
    const SHAPES: Array<[string, string, number, number | null | 'sight']> = [
        ['an empty document', '', 0, 0],
        ['the blank lines after the last block', 'para\n\n', 6, null],
        ['an empty heading', 'a\n\n## \n\nb', 5, 1],
        ['an empty heading without a space', 'a\n\n#\n\nb', 4, 1],
        ['an empty list item', 'a\n\n-\n\nb', 3, 1],
        ['an empty quote', 'a\n\n>\n\nb', 3, 1],
        ['an empty code fence', 'a\n\n```\n```\n\nb', 6, 1],
        ['an unclosed code fence alone on the last line', 'a\n\n```', 6, 1],
        ['a quote with a lazy HTML line', '> a\n<div', 2, 'sight'],
        ['an unclosed code fence and a line after it', '```\n', 4, 0],
        ['an unclosed tilde fence and a line after it', '~~~\n', 4, 0],
        ['blank lines alone', '\n\n\n', 0, 0],
        ['blank lines alone, at the end', '\n\n\n', 3, 0],
        ['one space', ' ', 0, 0],
        ['spaces and a line end', '   \n', 1, 0],
    ];

    // A command that changes nothing (a quote made of a quote) leaves the document as it was on either surface, though the
    // WYSIWYG save writes a lazy line a blank line apart; the WYSIWYG side reports such a run as unchanged.
    const NAMES = ['image', 'h2', 'bulleted', 'numbered', 'quote', 'code', 'bold'];

    /**
     * A placement that puts the WYSIWYG caret in a block that shows nothing, or in a new last paragraph.
     *
     * @param block - The block's index, or `null` for a new last paragraph.
     * @returns The placement.
     */
    const placeInBlock = (block: number | null): (() => boolean) => (): boolean => {
        const target = block === null ? $createParagraphNode() : $getRoot().getChildAtIndex(block) as ElementNode;
        let inner = target;

        if (block === null) {
            $getRoot().append(target);
        }

        while ($isElementNode(inner.getFirstChild())) {
            inner = inner.getFirstChild() as ElementNode;
        }

        inner.select(0, 0);

        return true;
    };

    it.each(SHAPES.flatMap(([shape, doc, caret, block]) => NAMES.map((name) => [`${shape}: ${name}`, doc, caret, block, name] as const)))(
        '%s: acts as the WYSIWYG command does at a caret there', (_title, doc, caret, block, name) => {
            const selection = { from: caret, to: caret };
            const wysiwyg = runInWysiwyg(doc, selection, COMMANDS[name]!, block === 'sight' ? 'independent' : placeInBlock(block));
            const run = runInSource(doc, selection, COMMANDS[name]!);

            expect(wysiwyg.placed).toBe(true);
            expect(run.text).toBe(wysiwyg.value);
            run.editor.dispose();
        },
    );

    // Several empty children on the way down: the source line of the caret does name which one it is in, but the code does
    // not work that out yet, so the command does nothing, and it never acts in another one.
    const CROWDED: Array<[string, string, number]> = [
        ['three empty items', '-\n-\n-', 3],
        ['empty ordered items', '1.\n2.', 3],
        ['empty items with a space', '* \n* ', 3],
        ['empty items apart', '-\n\n-', 3],
        ['empty items before a block', 'p\n\n-\n-\n-\n\nq', 6],
        ['the cells of an empty table row', '| |\n|-|\n| |', 8],
        ['two empty columns', '::: columns\n\n|||\n\n:::', 17],
    ];

    it.each(CROWDED.flatMap(([shape, doc, caret]) => ['image', 'h2', 'bulleted', 'code'].map((name) => [`${shape}: ${name}`, doc, caret, name] as const)))(
        '%s: does nothing', (_title, doc, caret, name) => {
            const run = runInSource(doc, { from: caret, to: caret }, COMMANDS[name]!);

            expect(run.text).toBe(doc);
            expect(run.replaced).toEqual([]);
            run.editor.dispose();
        },
    );

    it.each(['h2', 'bold', 'image'])('a caret on the blank lines before the first block of a split block does nothing: %s', (name) => {
        const doc = '\n\n> a\n<div';
        const run = runInSource(doc, { from: 0, to: 0 }, COMMANDS[name]!);

        expect(run.text).toBe(doc);
        run.editor.dispose();
    });

    // (An image goes into no code block, and a quote with a lazy HTML line is the shape of its own row.)
    it.each(SHAPES.filter(([shape]) => !/fence|HTML/.test(shape)))('%s: the image is inserted', (_title, doc, caret) => {
        const run = runInSource(doc, { from: caret, to: caret }, COMMANDS.image!);

        expect(run.text).toContain('![pic](/i.png)');
        run.editor.dispose();
    });
});

describe('a read-only editor refuses every source-mode command up front', () => {
    /**
     * Runs a command in a read-only source-mode editor, counting its `"readonlyedit"` events.
     *
     * @param doc - The document.
     * @param command - The command.
     * @returns The editor, the event count and how often its own wash played.
     */
    function runReadOnly(doc: string, command: (editor: MarkdownEditor) => unknown): { editor: MarkdownEditor; counts: { refusals: number; washes: number } } {
        const editor = new MarkdownEditor(doc, { mode: 'source', readOnly: true });
        const flash = (editor as unknown as { _flash: { play(): void } })._flash;
        const counts = { refusals: 0, washes: 0 };

        editor.on('readonlyedit', () => { counts.refusals += 1; });
        vi.spyOn(flash, 'play').mockImplementation(() => { counts.washes += 1; });
        vi.spyOn(codeOf(editor), 'getSelection').mockReturnValue({ characterCount: 0, lineCount: 1, from: 1, to: 1 });
        vi.mocked($importMarkdown).mockClear();
        command(editor);

        return { editor, counts };
    }

    it('5.32: a command is refused once, before any model is built', () => {
        const run = runReadOnly('hello', COMMANDS.bold!);

        expect(run.editor.getValue()).toBe('hello');
        expect(run.counts.refusals).toBe(1);
        expect(run.counts.washes).toBe(0);
        expect($importMarkdown).not.toHaveBeenCalled();
        run.editor.dispose();
    });

    it('5.33: a command the transform would have declined is refused too', () => {
        const run = runReadOnly('```\nx\n```', COMMANDS.bold!);

        expect(run.counts.refusals).toBe(1);
        run.editor.dispose();
    });

    it('5.34: a command that would change nothing is refused too', () => {
        const run = runReadOnly('hello', COMMANDS.paragraph!);

        expect(run.counts.refusals).toBe(1);
        run.editor.dispose();
    });

    it('5.35: the commands that stay text surgery are refused once as well', () => {
        const run = runReadOnly('> q', (editor) => editor.insertParagraphBeforeBlock());

        expect(run.counts.refusals).toBe(1);
        run.editor.dispose();
    });
});

describe('what a command costs', () => {
    /** A document of `count` blocks of every common shape, one after another. */
    function mixedDocument(count: number): string {
        const shapes = [
            '# Heading #', 'A paragraph # with **bold** and a [link](https://example.com).', '- one #\n- two', '> a quote #',
            '1. first #\n2. second', '```\ncode #\n```',
        ];

        return Array.from({ length: count }, (_, i) => shapes[i % shapes.length]!.replace('#', String(i))).join('\n\n');
    }

    it('5.36: a command lexes the whole document once', () => {
        const doc = mixedDocument(2_000);
        const middle = doc.indexOf('paragraph', doc.length / 2) + 3;

        const run = runInSource(doc, { from: middle, to: middle }, COMMANDS.bold!, { beforeCommand: () => vi.mocked(lexMarkdown).mockClear() });
        const wholeDocumentLexes = vi.mocked(lexMarkdown).mock.calls.filter(([text]) => text === doc);

        expect(run.text).not.toBe(doc);
        expect(wholeDocumentLexes).toHaveLength(1);
        run.editor.dispose();
    });

    it.each(['bold', 'h2', 'bulleted'])('5.37: %s imports no more than the blocks around the caret', (command) => {
        const doc = mixedDocument(2_000);
        const middle = doc.indexOf('paragraph', doc.length / 2) + 3;

        const run = runInSource(doc, { from: middle, to: middle }, COMMANDS[command]!, { beforeCommand: () => vi.mocked($importMarkdown).mockClear() });
        const calls = vi.mocked($importMarkdown).mock.calls;

        expect(calls).toHaveLength(1);
        expect(calls[0]![0].length).toBeLessThan(400);
        run.editor.dispose();
    });
});

describe('the model is loaded and settled as the WYSIWYG editor is', () => {
    it('8.1: a definition in a list item with a blank line in its title acts as on the WYSIWYG surface', () => {
        const doc = '- a\n\n\t[x]: /u "t\n\n\tu"\n\nb [x] c';
        // Between the `[` and the `x` of `[x] c`.
        const caret = 26;
        const run = runInSource(doc, { from: caret, to: caret }, COMMANDS.bold!);

        // Without the settling update the model leaves the text as it is.
        expect(doc[caret - 1]).toBe('[');
        expect(run.text.startsWith('- a')).toBe(true);
        expect(run.text.endsWith('b **[x][x]** c')).toBe(true);
        run.editor.dispose();
    });
});

/**
 * Whether a caret stands in one of the shapes whose source the editor does not find, so that a source-mode command
 * there does nothing where the WYSIWYG command acts: a code or HTML line whose container prefix holds a tab, a
 * paragraph line made of list markers and tabs, a task item's checkbox followed by two spaces in a loose list, and a
 * list item's text that begins as a repeated link reference definition. The shape is looked for in the top-level block
 * around the caret, but for a repeated label, which is a property of the whole document.
 *
 * @param doc - The document.
 * @param at - The caret.
 * @returns Whether the caret stands in one.
 */
function standsInShapeWithoutSource(doc: string, at: number): boolean {
    const { blocks } = locateTopLevelBlocks(doc);
    const block = blocks.find((entry) => entry.start <= at && at <= entry.end);
    const stretch = block === undefined ? doc : doc.slice(block.start, block.end);
    const labels = [...doc.matchAll(/^\s*\[([^\]]+)\]:/gm)].map((match) => match[1]);
    const repeatsLabel = new Set(labels).size < labels.length;
    const hasPrefixTab = prefixTabLines(stretch.split('\n')).some(Boolean);
    const holdsCodeWithPrefixTab = hasPrefixTab && (stretch.includes('```') || /<\/?(?:div|pre)>/.test(stretch) || /^[ >]*(?:(?:[-*+]|\d+[.)])\t[ \t]+|[ ]*\t[ ]*\t[ \t]*)\S/m.test(stretch));
    const holdsMarkerLine = /^[ \t]*-\t-\t*$/m.test(stretch);
    const holdsWideCheckbox = /\[[ xX]\] {2,}\S/.test(stretch);

    return holdsCodeWithPrefixTab || holdsMarkerLine || repeatsLabel || holdsWideCheckbox;
}

/**
 * Whether the import builds a block of the document whole and the editor then splits it (a quote with a lazy HTML line is
 * a quote and a raw block), so that the source map no longer pairs with the root. A command is placed then only when the
 * document is that one block. This is a property of the whole document, as the window of a command holds the blocks around
 * the caret, which the test does not work out.
 *
 * @param doc - The document.
 * @returns Whether the root does not pair with the map.
 */
function holdsSplitBlock(doc: string): boolean {
    const editor = wysiwygEditorOf(doc);
    const map = sourceMapOfEditor(editor);
    const unpaired = lexicalEditorOf(editor).read(() => $getRoot().getChildren().some((child) => !map.blocks.has(child.getKey())) && map.latest.blockCount > 1);

    editor.dispose();

    return unpaired;
}

/** Documents of the shapes where a block shows nothing or a caret stands below the last block, each with the blocks around it. */
const EDGE_DOCUMENTS: readonly DifferentialDocument[] = [
    '', '\n', '\n\n\n', ' ', '   \n', '#', '## ', '-', '- ', '-\n-', '-\n-\n-', '- a\n-', '-\n- a', '-\n  -', '1.\n2.', '* \n* ',
    '>', '> ', '>\n>', '> >', '- >', '```\n```', '```', '```\n', '~~~\n', '```\n\n```', '| |\n|-|', '| a | |\n|-|-|\n| | b |', '| |\n|-|\n| |',
    '::: columns\n|||\n:::', '::: columns\n\n|||\n\n:::', '- [ ]', '- [ ] \n- [x] ', '-\n\n-', '- a\n\n-\n\n- b', '> a\n<div', '\n\n> a\n<div',
].flatMap((shape) => [shape, `p\n\n${shape}`, `${shape}\n\nq`, `${shape}\n`].map((source) => ({ name: `edge ${JSON.stringify(source)}`, source })));

/**
 * The carets of a document: the middle of each non-blank line, and the start of each blank line.
 *
 * @param source - The document.
 * @returns The offsets, in order.
 */
function carets(source: string): number[] {
    const offsets: number[] = [];
    let start = 0;

    for (const line of source.split('\n')) {
        offsets.push(line.trim() === '' ? start : start + Math.floor(line.length / 2));
        start += line.length + 1;
    }

    return [...new Set(offsets)];
}

/** The differential runs in this many parts, each a test of its own, so that each part's editors are released before the next. */
const DIFFERENTIAL_PARTS = 8;

describe('the corpus differential', () => {
    it.each(Array.from({ length: DIFFERENTIAL_PARTS }, (_, part) => part))('9: part %i: every source-mode command gives what the WYSIWYG command gives at the same selection, but for the declines', (part) => {
        const documents = [...CORPUS, ...HAND_WRITTEN, ...EDGE_DOCUMENTS].map((entry, index) => ({ entry, index })).filter(({ index }) => index % DIFFERENTIAL_PARTS === part);
        const differences: string[] = [];
        const counts = { compared: 0, declined: 0, unplaced: 0, gaps: 0, ambiguous: 0, shown: 0, blank: 0 };

        documents.forEach(({ entry, index: d }) => {
            const source = entry.source.replace(/\r\n?/g, '\n');
            const isEdge = entry.name.startsWith('edge ');
            const offsets = isEdge ? Array.from({ length: source.length + 1 }, (_, at) => at) : carets(source);
            const selections: SourceSelection[] = offsets.map((at) => ({ from: at, to: at }));
            const middles = lineMiddles(source);
            const topLevel = locateTopLevelBlocks(source).blocks;

            for (let i = 0; i + 1 < middles.length && !isEdge; i++) {
                selections.push({ from: middles[i]!, to: middles[i + 1]! });
            }

            selections.forEach((selection, k) => {
                const names = [BLOCK_COMMANDS[(d + k) % BLOCK_COMMANDS.length]!, INLINE_COMMANDS[(d + k) % INLINE_COMMANDS.length]!];

                for (const name of names) {
                    const where = JSON.stringify([entry.name, selection.from, selection.to, name]);
                    const mapped = runInWysiwyg(source, selection, COMMANDS[name]!, 'mapped');
                    const shown = runInWysiwyg(source, selection, COMMANDS[name]!, 'independent');
                    const run = runInSource(source, selection, COMMANDS[name]!);

                    try {
                        // A mark at a line's start can end the container it stands in (a fence's content in an item), so only a caret
                        // that no top-level block holds is on blank lines between or before blocks.
                        const isOnBlankLines = shown.blankWhere !== null && !topLevel.some((block) => block.start <= selection.from && selection.from <= block.end);

                        if (isOnBlankLines) {
                            counts.blank += 1;

                            if (run.text !== source || run.replaced.length !== 0) {
                                differences.push(`${where}: acted on blank lines ${shown.blankWhere ?? ''} where the WYSIWYG surface has no caret`);
                            }

                            continue;
                        }

                        if (shown.placed && shown.touchesRaw) {
                            counts.declined += 1;

                            if (run.text !== source || run.replaced.length !== 0) {
                                differences.push(`${where}: acted where the WYSIWYG command declines`);
                            }

                            continue;
                        }

                        if (shown.placed && shown.kind !== 'text') {
                            // A block that shows nothing, or a caret below the last block: the place is named by structure, so any
                            // other place is a difference.
                            counts.shown += 1;

                            // Where the block holds several empty children the code does not work out which one the line names yet, and
                            // where the empty element is in a block that shows something elsewhere (a raw block's blank line) the
                            // command may decline.
                            const mayDecline = (shown.crowded || !shown.blockShowsNothing) && run.text === source;

                            if (run.text !== shown.value && !mayDecline) {
                                differences.push(`${where}: ${JSON.stringify(run.text)} against ${JSON.stringify(shown.value)}`);
                            } else if (run.replaced.length > 1) {
                                differences.push(`${where}: ${run.replaced.length} replacements`);
                            } else if (run.caret !== null && shown.hasExactCaret && run.text === shown.value) {
                                const characters = charactersOfSourceCaret(run.text, run.caret);

                                if (JSON.stringify(characters) !== JSON.stringify(shown.characters)) {
                                    differences.push(`${where}: caret ${JSON.stringify(characters)} against ${JSON.stringify(shown.characters)}`);
                                }
                            }

                            continue;
                        }

                        const isAmbiguous = mapped.placed && shown.placed && shown.value !== mapped.value;
                        const isGap = !mapped.placed && shown.placed && shown.value !== source;

                        if (isGap) {
                            // The shown text puts a caret where the source map puts none, and the WYSIWYG command acts there.
                            counts.gaps += 1;

                            const isExcused = standsInShapeWithoutSource(source, selection.from) || holdsSplitBlock(source);

                            if (run.text !== shown.value && !isExcused) {
                                differences.push(`${where}: no place, but the WYSIWYG command gives ${JSON.stringify(shown.value)}`);
                            }

                            continue;
                        }

                        if (!mapped.placed) {
                            counts.unplaced += 1;

                            if (run.replaced.length !== 0 && !shown.placed) {
                                differences.push(`${where}: acted where neither reading places the selection`);
                            }

                            continue;
                        }

                        if (isAmbiguous) {
                            // The caret stands on a joint (the end of a code span, between two formats) that two readings place on either side of.
                            counts.ambiguous += 1;
                            differences.push(`${where}: the two placements give different WYSIWYG results`);

                            continue;
                        }

                        if (mapped.touchesRaw) {
                            counts.declined += 1;

                            if (run.text !== source || run.replaced.length !== 0) {
                                differences.push(`${where}: acted where the WYSIWYG command declines`);
                            }

                            continue;
                        }

                        counts.compared += 1;

                        // An item whose text ends in a space (`- [ ] `): the model holds the text `[ ] ` with its trailing space and the
                        // save drops that space, so the reloaded caret counts one character fewer. Both carets stand at the start of `[x]`.
                        const endsInDroppedSpace = /^[ \t]*(?:[-*+]|\d+[.)]) +\S.* $/m.test(source);

                        if (run.text !== mapped.value) {
                            differences.push(`${where}: ${JSON.stringify(run.text)} against ${JSON.stringify(mapped.value)}`);
                        } else if (run.replaced.length > 1) {
                            differences.push(`${where}: ${run.replaced.length} replacements`);
                        } else if (run.caret !== null && mapped.hasExactCaret && !endsInDroppedSpace) {
                            const characters = charactersOfSourceCaret(run.text, run.caret);

                            if (JSON.stringify(characters) !== JSON.stringify(mapped.characters)) {
                                differences.push(`${where}: caret ${JSON.stringify(characters)} against ${JSON.stringify(mapped.characters)}`);
                            }
                        }
                    } finally {
                        run.editor.dispose();
                    }
                }
            });
        });

        expect(differences.slice(0, 20)).toEqual([]);
        expect(counts.compared).toBeGreaterThan(100);
    }, 900_000);
});
