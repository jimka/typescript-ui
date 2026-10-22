// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// MarkdownEditor keeps a list whose item holds a block through ordinary edits
// (plans/markdown-editor-list-item-block-paste.md): what a load builds, an
// edit must not turn into a document whose save reads as something else. After
// every step the save loads as the document the editor shows, and the viewer
// reads it the same way.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    $createRangeSelection, $createTextNode, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, $setSelection,
    CONTROLLED_TEXT_INSERTION_COMMAND, DELETE_CHARACTER_COMMAND, INDENT_CONTENT_COMMAND, INSERT_LINE_BREAK_COMMAND, KEY_BACKSPACE_COMMAND,
    KEY_ENTER_COMMAND, OUTDENT_CONTENT_COMMAND,
} from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode, TextNode } from 'lexical';
import { $createQuoteNode } from '@lexical/rich-text';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $createMarkdownRawBlockNode, $isMarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
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

/** A point in the document: the exact text of a text node, and an offset in it. */
type TextPoint = readonly [text: string, offset: number];

/**
 * One edit, as a key does it. A step that names a point puts the caret there
 * first (a range when it names two); one that names none acts at the caret
 * the step before left. `indent` is Lexical's `INDENT_CONTENT_COMMAND`, which
 * nests a list item under the one before it: the editor binds no key to it,
 * but a host can dispatch it, and it is the shortest way to that document.
 * `outdent` is `OUTDENT_CONTENT_COMMAND`, which Backspace at the start of a
 * nested item dispatches; `Backspace key` is the key itself
 * (`KEY_BACKSPACE_COMMAND`), which decides between that and a deletion.
 * `command` calls one of the editor's own commands.
 */
type Step =
    | { readonly key: 'type'; readonly text: string; readonly at?: TextPoint; readonly to?: TextPoint }
    | { readonly key: 'Enter' | 'Shift+Enter' | 'Backspace' | 'Delete' | 'indent' | 'outdent' | 'Backspace key'; readonly at?: TextPoint; readonly to?: TextPoint }
    | { readonly key: 'command'; readonly run: (editor: MarkdownEditor) => void; readonly at?: TextPoint; readonly to?: TextPoint }
    | { readonly key: 'removeBlock'; readonly index: number };

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
 * @param focus - The focus; the anchor when omitted (a caret).
 */
function selectText(editor: MarkdownEditor, anchor: TextPoint, focus: TextPoint = anchor): void {
    lexicalOf(editor).update(() => {
        const selection = $createRangeSelection();

        selection.anchor.set($textNode(anchor[0]).getKey(), anchor[1], 'text');
        selection.focus.set($textNode(focus[0]).getKey(), focus[1], 'text');
        $setSelection(selection);
    }, { discrete: true });
}

/**
 * Widens a caret inside a text node to the one character Backspace or Delete
 * removes. Lexical finds that character through the browser's selection,
 * which the headless test DOM does not have; a range needs none.
 *
 * @param editor - The editor.
 * @param backward - `true` for Backspace, `false` for Delete.
 */
function selectCharacterAtCaret(editor: MarkdownEditor, backward: boolean): void {
    lexicalOf(editor).update(() => {
        const selection = $getSelection();
        const isCaretInText = $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.type === 'text';

        if (!isCaretInText) {
            return;
        }

        const offset = selection.anchor.offset;
        const size = selection.anchor.getNode().getTextContentSize();
        const target = backward ? offset - 1 : offset + 1;

        if (target >= 0 && target <= size) {
            selection.focus.set(selection.anchor.key, target, 'text');
        }
    }, { discrete: true });
}

/**
 * Makes one edit.
 *
 * @param editor - The editor.
 * @param step - The edit.
 */
function press(editor: MarkdownEditor, step: Step): void {
    const lexical = lexicalOf(editor);

    if (step.key === 'removeBlock') {
        lexical.update(() => {
            $getRoot().getChildAtIndex(step.index)!.remove();
        }, { discrete: true });

        return;
    }

    if (step.at !== undefined) {
        selectText(editor, step.at, step.to);
    }

    switch (step.key) {
        case 'type':
            lexical.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, step.text);
            break;
        case 'Enter':
            lexical.dispatchCommand(KEY_ENTER_COMMAND, null);
            break;
        case 'Shift+Enter':
            lexical.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
            break;
        case 'indent':
            lexical.dispatchCommand(INDENT_CONTENT_COMMAND, undefined);
            break;
        case 'outdent':
            lexical.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
            break;
        case 'Backspace key':
            lexical.dispatchCommand(KEY_BACKSPACE_COMMAND, { preventDefault: () => {}, shiftKey: false, target: null } as unknown as KeyboardEvent);
            break;
        case 'command':
            step.run(editor);
            break;
        default:
            selectCharacterAtCaret(editor, step.key === 'Backspace');
            lexical.dispatchCommand(DELETE_CHARACTER_COMMAND, step.key === 'Backspace');
    }
}

/**
 * The document as nested node types, text nodes as their text: enough to tell a list from a raw block of its source.
 *
 * @param editor - The editor.
 * @returns One string per top-level block, joined by ` | `.
 */
function shapeOf(editor: MarkdownEditor): string {
    const shape = (node: LexicalNode): string => {
        if ($isTextNode(node)) {
            return JSON.stringify(node.getTextContent());
        }

        return $isElementNode(node) ? `${node.getType()}(${node.getChildren().map(shape).join(', ')})` : node.getType();
    };

    return lexicalOf(editor).read(() => $getRoot().getChildren().map(shape).join(' | '));
}

/**
 * What the viewer reads in each raw block's text, in document order. The
 * surface model compares a raw block by its text with whitespace collapsed,
 * which cannot tell a raw list from the same lines indented otherwise; this
 * can.
 *
 * @param editor - The editor.
 * @returns One block list per raw block.
 */
function rawBlockReadings(editor: MarkdownEditor): unknown[] {
    const texts = lexicalOf(editor).read(() => $dfs($getRoot()).map(({ node }) => node).filter($isMarkdownRawBlockNode)
        .map((node) => node.getTextContent()));

    // A raw block that shows nothing is left out: one a deletion emptied writes nothing, so a reload holds none
    // for it, and a save may add a definition line of its own between two raw lists.
    return texts.map((text) => viewerModel(text).blocks).filter((blocks) => blocks.length > 0);
}

/** The blocks that hold text only. */
const TEXT_ONLY_BLOCKS: readonly string[] = ['paragraph', 'heading', 'quote', 'code', 'markdown-raw-block'];

/**
 * The blocks standing inside a block that holds text only (a paragraph in a
 * table cell included): a save writes such a block's text into the line
 * around it.
 *
 * @param editor - The editor.
 * @returns Each such block as `container > block`.
 */
function blocksInText(editor: MarkdownEditor): string[] {
    return lexicalOf(editor).read(() => $dfs($getRoot()).map(({ node }) => node)
        .filter((node) => $isElementNode(node) && !node.isInline() && TEXT_ONLY_BLOCKS.includes(node.getParent()?.getType() ?? ''))
        .map((node) => `${node.getParent()!.getType()} > ${node.getType()}`));
}

/**
 * Asserts the editor's document is one its save keeps: loading the save shows
 * the same document, each raw block reading as it did (reload), saving that gives the same source
 * (idempotence), the viewer reads the save as the editor shows it (parity),
 * and the standard form of the document — what a save writes for it once it
 * is edited further — reads as the save does and loads as the same document
 * (canonical).
 *
 * @param editor - The editor.
 * @param context - What was done, for the failure message.
 * @param comparesWithViewer - `false` for a document holding a raw list or
 *   quote, which the viewer renders where the editor shows its source.
 * @returns The save the checks ran against.
 */
function expectSaveKeepsDocument(editor: MarkdownEditor, context: string, comparesWithViewer: boolean = true): string {
    const saved = editor.getValue();
    const surface = editorSurfaceModel(editor);
    const reloaded = load(saved);
    const standard = canonicalSave(editor);
    const fromStandard = load(standard);

    expect(blocksInText(editor), `blocks inside a text block after ${context}`).toEqual([]);
    expect(editorSurfaceModel(reloaded), `reload after ${context}: ${JSON.stringify(saved)}`).toEqual(surface);
    expect(rawBlockReadings(reloaded), `raw blocks after ${context}: ${JSON.stringify(saved)}`).toEqual(rawBlockReadings(editor));
    expect(reloaded.getValue(), `idempotence after ${context}`).toBe(saved);

    if (comparesWithViewer) {
        expect(viewerModel(saved).blocks, `parity after ${context}: ${JSON.stringify(saved)}`).toEqual(surface);
    }

    expect(viewerModel(standard), `canonical after ${context}: ${JSON.stringify(standard)}`).toEqual(viewerModel(saved));
    expect(editorSurfaceModel(fromStandard), `canonical reload after ${context}: ${JSON.stringify(standard)}`).toEqual(surface);
    expect(canonicalSave(fromStandard), `canonical idempotence after ${context}`).toBe(standard);

    return saved;
}

/** One row: a document, the edits made in it, and what the last one leaves. */
interface Row {
    readonly name:   string;
    readonly source: string;
    readonly steps:  readonly Step[];
    /** The save after the last step, when the row pins it. */
    readonly saved?: string;
    /** The document's shape ({@link shapeOf}) after the last step, when the row pins it. */
    readonly shape?: string;
    /** `false` when the document holds a raw list or quote the viewer renders ({@link expectSaveKeepsDocument}). */
    readonly comparesWithViewer?: boolean;
}

/**
 * Loads a row's document, checks it, then makes each edit and checks the document after it.
 *
 * @param row - The row.
 */
function runRow(row: Row): void {
    const editor = load(row.source);

    expectSaveKeepsDocument(editor, 'the load', row.comparesWithViewer);

    row.steps.forEach((step, index) => {
        press(editor, step);
        expectSaveKeepsDocument(editor, `step ${index + 1} (${step.key})`, row.comparesWithViewer);
    });

    if (row.saved !== undefined) {
        expect(editor.getValue()).toBe(row.saved);
    }

    if (row.shape !== undefined) {
        expect(shapeOf(editor)).toBe(row.shape);
    }
}

describe('link reference definitions in a list item load and edit as one document', () => {
    it.each<Row>([
        {
            name:   'D1: two repeated definitions a blank line apart are two raw blocks of a loose list',
            source: '[d]: /a\n\n- [d]: /b\n\n  [d]: /c',
            steps:  [],
            shape:  'markdown-raw-block("[d]: /a") | list(listitem(markdown-raw-block("[d]: /b"), markdown-raw-block("[d]: /c")))',
        },
        {
            name:   'D2: typing into the second of them keeps the list',
            source: '[d]: /a\n\n- [d]: /b\n\n  [d]: /c',
            steps:  [{ key: 'type', text: 'x', at: ['[d]: /c', 7] }],
            saved:  '[d]: /a\n\n- [d]: /b\n\n  [d]: /cx',
        },
        {
            name:   'D3: two definitions on consecutive lines are one raw block of a tight list',
            source: '- [a]: /u\n  [b]: /v\n- c',
            steps:  [],
            shape:  'list(listitem(markdown-raw-block("[a]: /u", linebreak, "[b]: /v")), listitem("c"))',
        },
        {
            name:   'D4: two repeated definitions on consecutive lines are one raw block too',
            source: '[x]: /a\n\n- [x]: /b\n  [x]: /c\n- c',
            steps:  [],
            shape:  'markdown-raw-block("[x]: /a") | list(listitem(markdown-raw-block("[x]: /b", linebreak, "[x]: /c")), listitem("c"))',
        },
        {
            name:   'D5: text typed before the first definition leaves the list a list, though its definitions now count',
            source: '[x]: /a\n\n- [x]: /b\n  [x]: /c\n- c',
            steps:  [{ key: 'type', text: 'Z', at: ['[x]: /a', 0] }],
            saved:  'Z\\[x\\]: /a\n\n- [x]: /b\n  [x]: /c\n- c',
        },
        {
            name:   'D6: removing the first definition leaves the list a list',
            source: '[x]: /a\n\n- [x]: /b\n  [x]: /c\n- c',
            steps:  [{ key: 'removeBlock', index: 0 }],
            saved:  '- [x]: /b\n  [x]: /c\n- c',
        },
        {
            name:   'D7: a second definition typed on a new line of an item\'s definition stays in its raw block',
            source: '- [x]: /b\n- c',
            steps:  [{ key: 'Shift+Enter', at: ['[x]: /b', 7] }, { key: 'type', text: '[y]: /c' }],
            saved:  '- [x]: /b\n  [y]: /c\n- c',
            shape:  'list(listitem(markdown-raw-block("[x]: /b", linebreak, "[y]: /c")), listitem("c"))',
        },
        {
            name:   'D8: Enter between two definition lines of an item makes them two raw blocks and the list loose',
            source: '[x]: /a\n\n- [x]: /b\n  [x]: /c\n- c',
            steps:  [{ key: 'Enter', at: ['[x]: /b', 7] }],
            saved:  '[x]: /a\n\n- [x]: /b\n\n  [x]: /c\n\n- c',
            shape:  'markdown-raw-block("[x]: /a") | list(listitem(markdown-raw-block("[x]: /b"), markdown-raw-block("[x]: /c")), listitem("c"))',
        },
        {
            name:   'D9: three repeated definitions after an item\'s text, the last a blank line apart',
            source: '[d]: /a\n\n- t\n\n  [d]: /b\n  [d]: /c\n\n  [d]: /e\n\n- z',
            steps:  [{ key: 'type', text: 'X', at: ['z', 1] }],
            shape:  'markdown-raw-block("[d]: /a") | list(listitem("t", markdown-raw-block("[d]: /b", linebreak, "[d]: /c"), markdown-raw-block("[d]: /e")), listitem("zX"))',
        },
    ])('$name', runRow);

    it.each<[string, string, string]>([
        ['D12: a repeated definition whose title holds a blank line, at the top level', '[d]: /a\n\n[d]: /b "ti\n\ntle"',
            'markdown-raw-block("[d]: /a") | markdown-raw-block("[d]: /b \\"ti", linebreak, linebreak, "tle\\"")'],
        ['D13: a repeated definition whose label holds a blank line', '[fo\n\no]: /a\n\n[fo\n\no]: /b',
            'markdown-raw-block("[fo", linebreak, linebreak, "o]: /a") | markdown-raw-block("[fo", linebreak, linebreak, "o]: /b")'],
        ['D14: a repeated definition whose title holds a blank line, under an item\'s text', '[d]: /a\n\n- t\n\n  [d]: /b "ti\n\n  tle"\n\n- z',
            'markdown-raw-block("[d]: /a") | list(listitem("t", markdown-raw-block("[d]: /b \\"ti", linebreak, linebreak, "tle\\"")), listitem("z"))'],
        ['D15: the same opening an item of a tight list', '[d]: /a\n\n- [d]: /b "ti\n\n  tle"\n- z',
            'markdown-raw-block("[d]: /a") | list(listitem(markdown-raw-block("[d]: /b \\"ti", linebreak, linebreak, "tle\\"")), listitem("z"))'],
        ['D16: two repeated definitions with such titles, a blank line apart', '[d]: /a\n\n[d]: /b "t\n\nu"\n\n[d]: /c "v\n\nw"',
            'markdown-raw-block("[d]: /a") | markdown-raw-block("[d]: /b \\"t", linebreak, linebreak, "u\\"") | markdown-raw-block("[d]: /c \\"v", linebreak, linebreak, "w\\"")'],
    ])('%s is one raw block: the blank line belongs to the definition', (_name, source, shape) => {
        const editor = load(source);

        expect(shapeOf(editor)).toBe(shape);
        expectSaveKeepsDocument(editor, 'the load');
    });

    it('D10: at the top level, repeated definitions a blank line apart are a raw block each, as first definitions are', () => {
        const source = '[d]: /a\n\n[d]: /b\n\n[d]: /c';
        const editor = load(source);

        expect(shapeOf(editor)).toBe('markdown-raw-block("[d]: /a") | markdown-raw-block("[d]: /b") | markdown-raw-block("[d]: /c")');
        expect(shapeOf(load('[a]: /a\n\n[b]: /b\n\n[c]: /c'))).toBe('markdown-raw-block("[a]: /a") | markdown-raw-block("[b]: /b") | markdown-raw-block("[c]: /c")');
        expectSaveKeepsDocument(editor, 'the load');
    });

    it('D11: at the top level, Enter between two definition lines makes them two raw blocks, as a load of that text builds', () => {
        const editor = load('[a]: /x\n[b]: /y\n\n[a] [b]');

        press(editor, { key: 'Enter', at: ['[a]: /x', 7] });

        expect(editor.getValue()).toBe('[a]: /x\n\n[b]: /y\n\n[a] [b]');
        expect(shapeOf(editor)).toBe(shapeOf(load(editor.getValue())));
        expectSaveKeepsDocument(editor, 'Enter');
    });
});

describe('a raw block of a list item whose text starts or ends with an empty line', () => {
    it.each<Row>([
        {
            name:   'E1: the first line of a raw block opening a nested item is deleted',
            source: '- a\n  - <p>\n    <div>\n- b',
            steps:  [{ key: 'Backspace', at: ['<p>', 0], to: ['<p>', 3] }],
            saved:  '- a\n  - <div>\n- b',
        },
        {
            name:   'E2: a line break at the start of a raw block opening a nested item',
            source: '- a\n  - <div',
            steps:  [{ key: 'Shift+Enter', at: ['<div', 0] }],
            saved:  '- a\n  - <div',
        },
        {
            name:   'E3: two line breaks at the start of a raw block opening an item',
            source: '- <div>\n- b',
            steps:  [{ key: 'Shift+Enter', at: ['<div>', 0] }, { key: 'Enter' }],
            saved:  '- <div>\n- b',
        },
        {
            name:   'E4: a line break at the end of a raw block opening an item of a tight list',
            source: '- <div>\n- b',
            steps:  [{ key: 'Shift+Enter', at: ['<div>', 5] }],
            saved:  '- <div>\n- b',
        },
        {
            name:   'E5: the last line of a raw block opening an item is deleted character by character',
            source: '- <div>\n  <p>\n- b',
            steps:  [{ key: 'Backspace', at: ['<p>', 3] }, { key: 'Backspace' }, { key: 'Backspace' }],
            saved:  '- <div>\n- b',
        },
        {
            name:   'E6: a line break at the start of a raw block under an ordered item\'s text',
            source: '1. a\n\n   <div>\n2. b',
            steps:  [{ key: 'Shift+Enter', at: ['<div>', 0] }],
            // The list still writes what it was loaded from, so it is saved as it was written.
            saved:  '1. a\n\n   <div>\n2. b',
        },
        {
            name:   'E7: a line break at the start of a raw block after a nested list',
            source: '- a\n  - n\n\n  <div>\n\n- b',
            steps:  [{ key: 'Shift+Enter', at: ['<div>', 0] }],
            saved:  '- a\n  - n\n\n  <div>\n\n- b',
        },
        {
            name:   'E8: a line break at the start of a raw block opening an item in a column',
            source: '::: columns\n- a\n  - <div>\n|||\nb\n:::',
            steps:  [{ key: 'Shift+Enter', at: ['<div>', 0] }],
            saved:  '::: columns\n- a\n  - <div>\n|||\nb\n:::',
        },
        {
            name:   'E9: spaces typed before a raw block after a nested list do not move it into that list',
            source: '- a\n  - n\n\n  <div>\n\n- b',
            steps:  [{ key: 'type', text: '  ', at: ['<div>', 0] }],
            saved:  '- a\n  - n\n\n  <div>\n\n- b',
        },
        {
            // A load drops them where the raw block ends its item, so the save does too.
            name:   'E10: spaces typed at the end of the last line of a raw block are not written',
            source: '- a\n\n  <div>\n  w\n  </div>',
            steps:  [{ key: 'type', text: '  ', at: ['</div>', 6] }],
            saved:  '- a\n\n  <div>\n  w\n  </div>',
        },
    ])('$name', runRow);
});

describe('spaces typed before a raw list of a list item are kept where they are part of what it reads as', () => {
    // A raw list's later lines are measured against its first marker, so its first line's indentation cannot always go.
    it.each<Row>([
        {
            name:   'R1: one space before a raw list whose second item then reads as a sibling',
            source: '- o\n\n  - a\n    - b\n      > q\n\n- z',
            steps:  [{ key: 'type', text: ' ', at: ['- a', 0] }],
            comparesWithViewer: false,
        },
        {
            name:   'R2: the same after a nested list of the item',
            source: '- o\n  - n\n\n  1) a\n     - b\n       > q\n\n- z',
            steps:  [{ key: 'type', text: ' ', at: ['1) a', 0] }],
            comparesWithViewer: false,
        },
        {
            name:   'R5: two raw lists of one marker left next to each other in an item stay two lists',
            source: '- a\n\n  - x\n    > q\n\n  <!-- s -->\n\n  - n\n    > r\n\n- z',
            steps:  [{ key: 'Backspace', at: ['<!-- s -->', 0], to: ['<!-- s -->', 10] }],
            saved:  '- a\n\n  - x\n    > q\n\n  [//]: #\n\n  - n\n    > r\n\n- z',
            comparesWithViewer: false,
        },
        {
            name:   'R4: three spaces before a raw list whose first line alone can lose them',
            source: '- o\n  - n\n\n  1) a\n     > q\n\n- z',
            steps:  [{ key: 'type', text: '   ', at: ['1) a', 0] }],
            comparesWithViewer: false,
        },
        {
            name:   'R3: two spaces before the first line of a raw list, then before its second',
            source: '- o\n\n  - a\n  - b\n    > q\n\n- z',
            steps:  [{ key: 'type', text: '  ', at: ['- a', 0] }, { key: 'type', text: '  ', at: ['- b', 0] }],
            comparesWithViewer: false,
        },
    ])('$name', runRow);
});

describe('spaces typed before a raw list in a list item, for every shape, place and count', () => {
    /** Raw lists: each holds a block right under an item's text in a tight list, so no list item node holds it. */
    const RAW_LISTS: ReadonlyArray<readonly [string, string]> = [
        ['one item', '- a\n  > q'],
        ['a nested item holding the block', '- a\n  - b\n    > q'],
        ['a nested item, then an item at the margin', '- a\n  - b\n    > q\n- c'],
        ['an ordered item', '1) a\n   > q'],
        ['an ordered item nesting a bullet list, then a second item', '1) a\n   - b\n     > q\n2) c'],
        ['two items', '- a\n  > q\n- c'],
        ['a nested list of two items', '* a\n  * b\n    > q\n  * c'],
        ['an item nesting an ordered list, then an item at the margin', '+ a\n  1. b\n     > q\n+ c'],
        ['two levels of nesting, then two items at two margins', '- a\n  - b\n    - d\n      > q\n  - c\n- e'],
    ];

    /** Where the raw list stands in an item of the document's list: the text before it and the text after it. */
    const PLACES: ReadonlyArray<readonly [string, (raw: string) => string]> = [
        ['opening an item', (raw) => `- o\n- ${raw.split('\n').join('\n  ')}\n- z`],
        ['under an item\'s text', (raw) => `- o\n\n  ${raw.split('\n').join('\n  ')}\n\n- z`],
        ['after an item\'s nested list', (raw) => `- o\n  1. n\n\n  ${raw.split('\n').join('\n  ')}\n\n- z`],
    ];

    const grid = RAW_LISTS.flatMap(([shape, raw]) => PLACES.flatMap(([place, document]) =>
        [1, 2, 3].map((spaces) => [`${shape}, ${place}, ${spaces} space${spaces > 1 ? 's' : ''}`, raw, document(raw), spaces] as const)));

    it.each(grid)('G. %s', (_name, raw, source, spaces) => {
        const editor = load(source);
        const firstLine = raw.split('\n')[0]!;

        expectSaveKeepsDocument(editor, 'the load', false);

        // The caret goes right before the raw list's first marker, wherever that line stands (in a raw block of
        // the item, or in a raw block of the whole list).
        lexicalOf(editor).update(() => {
            const line = $dfs($getRoot()).map(({ node }) => node).filter($isTextNode).find((node) => node.getTextContent().trimStart() === firstLine)!;
            const offset = line.getTextContentSize() - firstLine.length;

            line.select(offset, offset);
        }, { discrete: true });
        press(editor, { key: 'type', text: ' '.repeat(spaces) });

        expectSaveKeepsDocument(editor, `${spaces} space(s) typed`, false);
    });
});

describe('a raw quote ending on a line without > that starts an HTML block keeps its list a raw block', () => {
    // `marked` reads that last line as part of the quote where the item's text ends there, and as a block after the
    // quote where a line end follows: a blank line a save writes after the item. No list item can hold such a block.
    it.each<[string, string, string]>([
        ['Q1: under an item\'s text', '- a\n\n  > q\n  <div\n- z', 'markdown-raw-block'],
        ['Q2: with a closing tag name', '- a\n\n  > q\n  </div\n- z', 'markdown-raw-block'],
        ['Q3: in an ordered list', '1. a\n\n   > q\n   <div\n2. z', 'markdown-raw-block'],
        ['Q4: in a nested list', '- a\n  - n\n\n    > q\n    <div\n  - m\n- z', 'markdown-raw-block'],
        ['Q5: in a column', '::: columns\n- a\n\n  > q\n  <div\n- z\n|||\nb\n:::', 'markdown-block'],
        ['Q6: in the last item', '- a\n\n- b\n\n  > q\n  <div', 'markdown-raw-block'],
        ['Q7: opening an item of a tight list', '- > q\n  <div\n- z', 'markdown-raw-block'],
        // Indented deeper than the item's content, the last line stays in the quote whatever follows. The raw block
        // drops that indentation, so it is its text, not the source, that must read the same.
        ['Q11: indented by a tab', '- a\n\n\t> q\n\t</div', 'markdown-raw-block'],
        ['Q12: indented one space deeper than the item', '- a\n\n   > q\n   <div\n- z', 'markdown-raw-block'],
        // Here the quote takes the indented lines after it in, and its raw block has to keep their indentation to
        // read so. Moved onto the item's marker line by an edit, that indentation would shift the whole item.
        ['Q13: a quote whose lazy lines only read so indented', '* w0\n\t> q1\n\t<div\n\t::: {align=center}\n\tf2\n\t:::\n* w3\n\n\tp', 'markdown-raw-block'],
    ])('%s', (_name, source, rootType) => {
        const editor = load(source);

        expect(lexicalOf(editor).read(() => $getRoot().getFirstChildOrThrow().getType())).toBe(rootType);
        expect(shapeOf(editor)).not.toContain('list(');
        expect(editor.getValue()).toBe(source);
        expectSaveKeepsDocument(editor, 'the load', false);
    });

    it.each<[string, string]>([
        ['Q8: typing after the last item', '- a\n\n  > q\n  <div\n- z'],
        ['Q9: typing after the last item of the outer list', '- a\n  - n\n\n    > q\n    <div\n  - m\n- z'],
    ])('%s keeps the save reading as the editor shows it', (_name, source) => {
        const editor = load(source);
        const last = lexicalOf(editor).read(() => $dfs($getRoot()).map(({ node }) => node).filter($isTextNode).at(-1)!.getTextContent());

        press(editor, { key: 'type', text: 'X', at: [last, last.length] });

        expect(editor.getValue()).toBe(`${source}X`);
        expectSaveKeepsDocument(editor, 'typing', false);
    });

    it('Q10: a quote and a block tag name a blank line apart load as a quote and a raw block of the item (control)', () => {
        const source = '- a\n\n  > q\n\n  <div\n- z';
        const editor = load(source);

        expect(shapeOf(editor)).toBe('list(listitem("a", quote("q"), markdown-raw-block("<div")), listitem("z"))');
        expectSaveKeepsDocument(editor, 'the load');
    });
});

describe('a paragraph of a list item is written as `marked` reads an item: line by line', () => {
    // At the top level an indented line opening with a block tag continues the paragraph above it. In a list item
    // it starts an HTML block, so the save escapes it there, in a paragraph after the item's text as in that text.
    it.each<Row>([
        {
            name:   'P1: a raw block opening an item is edited into a paragraph whose second line opens with a block tag',
            source: '- <p>\n    <div>\n- z',
            steps:  [{ key: 'Delete', at: ['<p>', 0] }],
            saved:  '- p>\n  \\<div>\n- z',
        },
        {
            name:   'P2: the same under an item\'s text',
            source: '- a\n\n  <p>\n    <div>\n\n- z',
            steps:  [{ key: 'Delete', at: ['<p>', 0] }],
            saved:  '- a\n\n  p>\n  \\<div>\n\n- z',
        },
        {
            name:   'P3: the same after a nested list, in an ordered list',
            source: '1. a\n   - n\n\n   <p>\n     <div>\n\n2. z',
            steps:  [{ key: 'Delete', at: ['<p>', 0] }],
            saved:  '1. a\n   - n\n\n   p>\n   \\<div>\n\n2. z',
        },
        {
            name:   'P4: inline HTML opening a continuation line of an item\'s paragraph starts no block and stays as written',
            source: '- a\n\n  p\n  <b>x</b>\n\n- z',
            steps:  [{ key: 'type', text: 'X', at: ['z', 1] }],
            saved:  '- a\n\n  p\n  <b>x</b>\n\n- zX',
        },
        {
            name:   'P5: the same in an item\'s own text',
            source: '- a\n  <b>x</b>\n- z',
            steps:  [{ key: 'type', text: 'X', at: ['z', 1] }],
            saved:  '- a\n  <b>x</b>\n- zX',
        },
    ])('$name', runRow);
});

describe('a block never stays inside a block that holds text only', () => {
    // Joining a list item to the block before it (Backspace at the item's start, Delete at that block's end, a range
    // deleted from that block into the item) moves the item's children over. A paragraph, heading, quote, code
    // block and raw block hold text only: the item's text joins them, its blocks follow them as blocks, in order.
    const TABLE = 'table(tablerow(tablecell(paragraph("h"))), tablerow(tablecell(paragraph("c"))))';

    it.each<Row>([
        {
            name:   'K1: a paragraph, Backspace at the start of the item after it',
            source: 'p1\n\n- w0\n\n  ---\n- z',
            steps:  [{ key: 'Backspace', at: ['w0', 0] }],
            saved:  'p1w0\n\n---\n\n- z',
            shape:  'paragraph("p1w0") | markdown-raw-block("---") | list(listitem("z"))',
        },
        {
            name:   'K2: a paragraph, Delete at its end',
            source: 'p2\n\n1. w0\n\n   <div>\n   x1\n   </div>',
            steps:  [{ key: 'Delete', at: ['p2', 2] }],
            saved:  'p2w0\n\n<div>\nx1\n</div>',
            shape:  'paragraph("p2w0") | markdown-raw-block("<div>", linebreak, "x1", linebreak, "</div>")',
        },
        {
            name:   'K2b: a paragraph, Backspace at the start of an item holding a quote and a thematic break: both follow, in order',
            source: 'p\n\n- w0\n\n  > q\n\n  ---\n- z',
            steps:  [{ key: 'Backspace', at: ['w0', 0] }],
            saved:  'pw0\n\n> q\n\n---\n\n- z',
            shape:  'paragraph("pw0") | quote("q") | markdown-raw-block("---") | list(listitem("z"))',
        },
        {
            name:   'K3: an item ending in a quote, Backspace at the start of the next item: that item joins the item, not the quote',
            source: '- a\n\n  > q0\n\n- w2\n\n  ::: {align=center}\n  f3\n  :::\n\n  <!-- c4 -->',
            steps:  [{ key: 'Backspace', at: ['w2', 0] }],
            saved:  '- a\n\n  > q0\n\n  w2\n\n  ::: {align=center}\n  f3\n  :::\n\n  <!-- c4 -->',
            shape:  'list(listitem("a", quote("q0"), "w2", markdown-block(markdown-column(paragraph("f3"))), markdown-raw-block("<!-- c4 -->")))',
        },
        {
            name:   'K4: an item that is a heading, Backspace at the start of the next item',
            source: '1. w0\n2. # h1\n3. w2\n\n   <div>',
            steps:  [{ key: 'Backspace', at: ['w2', 0] }],
            saved:  '1. w0\n\n2. # h1w2\n\n   <div>',
            shape:  'list(listitem("w0"), listitem(heading("h1w2"), markdown-raw-block("<div>")))',
        },
        {
            name:   'K5: an item\'s second paragraph, Delete at its end: the next item joins the item',
            source: '1. a\n\n   w4\n2. w5\n\n   | h |\n   | --- |\n   | c |',
            steps:  [{ key: 'Delete', at: ['w4', 2] }],
            saved:  '1. a\n\n   w4\n\n   w5\n\n   | h |\n   | --- |\n   | c |',
            shape:  `list(listitem("a", paragraph("w4"), "w5", ${TABLE}))`,
        },
        {
            name:   'K6: a paragraph, Backspace at the start of an item holding a second paragraph and a nested list',
            source: 'p\n\n- a\n\n  b\n\n  - n\n- z',
            steps:  [{ key: 'Backspace', at: ['a', 0] }],
            saved:  'pa\n\nb\n\n- - n\n\n- z',
            shape:  'paragraph("pa") | paragraph("b") | list(listitem(list(listitem("n"))), listitem("z"))',
        },
        {
            name:   'K7: a quote, Backspace at the start of the item after it',
            source: '> q\n\n- w0\n\n  ---\n- z',
            steps:  [{ key: 'Backspace', at: ['w0', 0] }],
            saved:  '> qw0\n\n---\n\n- z',
            shape:  'quote("qw0") | markdown-raw-block("---") | list(listitem("z"))',
        },
        {
            name:   'K8: a heading, Delete at its end',
            source: '# h\n\n- w0\n\n  ---\n- z',
            steps:  [{ key: 'Delete', at: ['h', 1] }],
            saved:  '# hw0\n\n---\n\n- z',
            shape:  'heading("hw0") | markdown-raw-block("---") | list(listitem("z"))',
        },
        {
            name:   'K9: a code block, Delete at its end before an item holding a table',
            source: '```\ncode\n```\n\n- w0\n\n  | h |\n  | --- |\n  | c |\n- z',
            steps:  [{ key: 'Delete', at: ['code', 4] }],
            saved:  '```\ncodew0\n```\n\n| h |\n| --- |\n| c |\n\n- z',
            shape:  `code("codew0") | ${TABLE} | list(listitem("z"))`,
        },
        {
            name:   'K10: a raw block, Delete at its end before an item holding an HTML block',
            source: '<div>\n\n- w0\n\n  <p>\n  x\n  </p>\n- z',
            steps:  [{ key: 'Delete', at: ['<div>', 5] }],
            saved:  '<div>w0\n\n<p>\nx\n</p>\n\n- z',
            shape:  'markdown-raw-block("<div>w0") | markdown-raw-block("<p>", linebreak, "x", linebreak, "</p>") | list(listitem("z"))',
        },
        {
            name:   'K11: a code block, Backspace at the start of the item after it',
            source: '```\ncode\n```\n\n- w0\n\n  ---\n- z',
            steps:  [{ key: 'Backspace', at: ['w0', 0] }],
            saved:  '```\ncodew0\n```\n\n---\n\n- z',
            shape:  'code("codew0") | markdown-raw-block("---") | list(listitem("z"))',
        },
        {
            name:   'K12: a range deleted from inside a code block into the text of an item',
            source: '```\ncode\n```\n\n- w0\n\n  ---\n- z',
            steps:  [{ key: 'Backspace', at: ['code', 2], to: ['w0', 1] }],
            saved:  '```\nco0\n```\n\n---\n\n- z',
            shape:  'code("co0") | markdown-raw-block("---") | list(listitem("z"))',
        },
        {
            name:   'K13: a range deleted from inside a raw block into the text of an item',
            source: '<div>\n\n- w0\n\n  ---\n- z',
            steps:  [{ key: 'Backspace', at: ['<div>', 2], to: ['w0', 1] }],
            saved:  '\\<d0\n\n---\n\n- z',
            shape:  'paragraph("<d0") | markdown-raw-block("---") | list(listitem("z"))',
        },
        {
            name:   'K14: a range deleted from inside a code block into the text of an item holding two more blocks and a nested list',
            source: '```\ncode\n```\n\n- w0\n\n  > q\n\n  p\n\n  - n\n- z',
            steps:  [{ key: 'Backspace', at: ['code', 2], to: ['w0', 1] }],
            shape:  'code("co0") | quote("q") | paragraph("p") | list(listitem(list(listitem("n"))), listitem("z"))',
        },
    ])('$name', runRow);

    it.each<[string, string, string]>([
        ['K15: a paragraph', 'paragraph', 'paragraph("a") | markdown-raw-block("---") | paragraph("b") | quote("q") | paragraph("c")'],
        ['K16: a heading', 'heading', 'heading("a") | markdown-raw-block("---") | paragraph("b") | quote("q") | paragraph("c")'],
        ['K17: a quote', 'quote', 'quote("a") | markdown-raw-block("---") | paragraph("b") | quote("q") | paragraph("c")'],
        ['K18: a code block', 'code', 'code("a") | markdown-raw-block("---") | paragraph("b") | quote("q") | paragraph("c")'],
        ['K19: a raw block', 'markdown-raw-block', 'markdown-raw-block("<div>") | markdown-raw-block("---") | paragraph("b") | quote("q") | paragraph("c")'],
    ])('%s given blocks between its text leaves its first text and has the rest follow it, text in paragraphs', (_name, type, shape) => {
        // No key leaves text after a block in such a container; the rule holds for it all the same.
        const editor = load({ 'paragraph': 'a', 'heading': '# a', 'quote': '> a', 'code': '```\na\n```', 'markdown-raw-block': '<div>' }[type]!);

        lexicalOf(editor).update(() => {
            const container = $getRoot().getFirstChildOrThrow<ElementNode>();
            const quote = $createQuoteNode().append($createTextNode('q'));

            container.splice(container.getChildrenSize(), 0, [$createMarkdownRawBlockNode('---'), $createTextNode('b'), quote, $createTextNode('c')]);
        }, { discrete: true });

        expect(shapeOf(editor)).toBe(shape);
        expectSaveKeepsDocument(editor, 'the blocks put in');
    });

    it('K20: a paragraph of a table cell given blocks between its text becomes one paragraph of the cell per run of text', () => {
        const editor = load('| h |\n| --- |\n| a |');

        lexicalOf(editor).update(() => {
            const paragraph = $textNode('a').getParentOrThrow();
            const quote = $createQuoteNode().append($createTextNode('q'));

            paragraph.splice(paragraph.getChildrenSize(), 0, [$createMarkdownRawBlockNode('---'), $createTextNode('b'), quote, $createTextNode('c')]);
        }, { discrete: true });

        expect(shapeOf(editor)).toBe('table(tablerow(tablecell(paragraph("h"))), tablerow(tablecell(paragraph("a"), paragraph("---"), paragraph("b"), paragraph("q"), paragraph("c"))))');
        expect(editor.getValue()).toBe('| h |\n| --- |\n| a\\n\\n---\\n\\nb\\n\\nq\\n\\nc |');
        expectSaveKeepsDocument(editor, 'the blocks put in');
    });
});

describe('a list\'s looseness follows the blocks its items still write', () => {
    it.each<Row>([
        {
            name:   'L1: an item\'s second paragraph is emptied',
            source: '- one\n\n  two',
            steps:  [{ key: 'Backspace', at: ['two', 0], to: ['two', 3] }],
            saved:  '- one',
        },
        {
            name:   'L2: an item\'s raw block is emptied',
            source: '- a\n\n  <div>',
            steps:  [{ key: 'Backspace', at: ['<div>', 0], to: ['<div>', 5] }],
            saved:  '- a',
        },
        {
            name:   'L3: text typed back into the emptied paragraph makes the list loose again',
            source: '- one\n\n  two\n- z',
            steps:  [{ key: 'Backspace', at: ['two', 0], to: ['two', 3] }, { key: 'type', text: 'w' }],
            saved:  '- one\n\n  w\n\n- z',
        },
        {
            name:   'L4: a heading under an item\'s text is emptied to its marker',
            source: '- a\n\n  # h\n- z',
            steps:  [{ key: 'Backspace', at: ['h', 0], to: ['h', 1] }],
        },
        {
            name:   'L5: the raw block after a nested list is emptied, which leaves the list as loose as it was',
            source: '- a\n  - n\n\n  <div>\n\n- b',
            steps:  [{ key: 'Backspace', at: ['<div>', 0], to: ['<div>', 5] }],
            saved:  '- a\n  - n\n\n- b',
        },
    ])('$name', runRow);
});

describe('a raw block that runs on in a list item shows as the paragraph it saves as when the next item comes to hold a nested list first', () => {
    // An item node opening with a nested list continues the item before it, so that list is a block after the raw block.
    it.each<Row>([
        {
            name:   'M1: the next item\'s raw list is edited into a list the editor builds',
            source: '- a\n\n  <!-- c\n- - n\n    > q\n\n- z',
            steps:  [{ key: 'Backspace', at: ['  > q', 0], to: ['  > q', 5] }],
        },
        {
            name:   'M2: the same two items deeper, after a nested list of the first',
            source: '- o\n  - a\n\n    <!-- c\n  - - n\n      > q\n\n  - z',
            steps:  [{ key: 'Backspace', at: ['  > q', 0], to: ['  > q', 5] }],
        },
    ])('$name', (row) => {
        const editor = load(row.source);

        expect(shapeOf(editor)).toContain('markdown-raw-block("<!-- c")');
        row.steps.forEach((step) => press(editor, step));

        expect(shapeOf(editor)).toContain('paragraph("<!-- c")');
        expectSaveKeepsDocument(editor, 'the edit');
    });
});

describe('a raw block that runs on in a list item shows as the paragraph it saves as when an item is nested under it', () => {
    // The item nested under it is a block after it, so its save takes that item in unless it is a paragraph.
    // The save is pinned where the list's shape leaves one way to write it (`null` otherwise: the number Lexical gives
    // a nested ordered list, and whether a list of one item is loose, are not this rule's to decide).
    it.each<[string, string, TextPoint, string | null]>([
        ['N1: one level deeper', '- o\n  - a\n\n    <!-- c\n  - b', ['b', 1], '- o\n  - a\n\n    \\<!-- c\n\n    - b'],
        ['N2: under an ordered item of two digits', '10. a\n\n    <!-- c\n11. b', ['b', 1], null],
        ['N3: in a column', '::: columns\n- a\n\n  <!-- c\n- b\n|||\nd\n:::', ['b', 1], '::: columns\n- a\n\n  \\<!-- c\n\n  - b\n|||\nd\n:::'],
        ['N4: an open <pre>', '- a\n\n  <pre>\n- b', ['b', 1], '- a\n\n  \\<pre>\n\n  - b'],
        ['N5: a comment that opens the item', '- <!-- c\n- b', ['b', 1], null],
        ['N6: in a task item', '- [ ] a\n\n  <!-- c\n- [ ] b', ['b', 1], '- [ ] a\n\n  \\<!-- c\n\n  - [ ] b'],
    ])('%s', (_name, source, at, saved) => {
        const editor = load(source);

        expect(shapeOf(editor)).toContain('markdown-raw-block');
        press(editor, { key: 'indent', at });

        expect(shapeOf(editor)).not.toContain('markdown-raw-block');
        expect(editor.getValue()).toContain('\\<');
        expectSaveKeepsDocument(editor, 'the indent');

        if (saved !== null) {
            expect(editor.getValue()).toBe(saved);
        }
    });
});

describe('a task item joined to the block before it leaves its blocks after that block', () => {
    // The task marker is kept as source, and is text once its item is gone. The rule that makes it text reads
    // its block's content as runs of text, and runs before the block's own rule: the blocks are moved out first.
    it.each<Row>([
        {
            name:   'J1: Delete at the end of a heading',
            source: '# h\n\n- [x] w4\n\n  > q5\n- d',
            steps:  [{ key: 'Delete', at: ['h', 1] }],
            saved:  '# h\\[x\\] w4\n\n> q5\n\n- d',
            shape:  'heading("h[x] w4") | quote("q5") | list(listitem("d"))',
        },
        {
            name:   'J2: Delete at the end of a paragraph',
            source: 'k\n\n- [x] w4\n\n  | h |\n  | --- |\n  | c |\n- d',
            steps:  [{ key: 'Delete', at: ['k', 1] }],
            saved:  'k\\[x\\] w4\n\n| h |\n| --- |\n| c |\n\n- d',
        },
        {
            name:   'J3: a heading set on a task item holding a quote',
            source: '- [x] w4\n\n  > q5\n- d',
            steps:  [{ key: 'command', run: (editor) => editor.setBlockType('h2'), at: ['w4', 1] }],
            saved:  '## \\[x\\] w4\n\n> q5\n\n- d',
            shape:  'heading("[x] w4") | quote("q5") | list(listitem("d"))',
        },
    ])('$name', runRow);
});

describe('a format the editor declines leaves a list item\'s paragraphs as they were', () => {
    // A declined edit puts each block it touched back from its serialized form, and asks whether that form was
    // writable before the edit. Lexical's parse of a list item merges the item's paragraphs into its text, so
    // both use a parse that keeps them.
    it.each<[string, string, string]>([
        ['F1: an item whose fence holds a list with a paragraph in an item', '- x(a)y\n\n  ::: columns\n  - k\n\n    p\n  |||\n  r\n  :::', 'x(a)y'],
        ['F2: an item holding a paragraph', '- x(a)y\n\n  p', 'x(a)y'],
        ['F3: an item holding a table and a paragraph', '- x(a)y\n\n  | h |\n  | --- |\n  | c |\n\n  p', 'x(a)y'],
        // The item's own text ends in bold punctuation, which a letter right after it would undo: read with its
        // paragraph merged into it, the item would count as unwritable before the edit, and the edit not be declined.
        ['F4: an item whose text ends in bold punctuation, over a paragraph', '- x(a)y **(b)**\n\n  c', 'x(a)y '],
    ])('%s', (_name, source, text) => {
        const editor = load(source);
        const shape = shapeOf(editor);

        // Bold over `(a)` between two letters has no Markdown form, so the toggle is declined.
        selectText(editor, [text, 1], [text, 4]);
        editor.toggleBold();

        expect(shapeOf(editor)).toBe(shape);
        expect(editor.getValue()).toBe(source);
    });
});

describe('a list wrapped in a `:::` fence shows a raw block of its item as the fence saves it', () => {
    // A raw block holding a `:::` line would end the fence around it, so the save writes it as a paragraph there,
    // as a block of a list item too. The editor shows that paragraph once the list stands in a column.
    it.each<[string, string, (editor: MarkdownEditor) => void, string]>([
        ['W1: an alignment', '- w\n\n  <div>\n  :::\n  </div>', (editor) => editor.setBlockAlignment('center'),
            '::: {align=center}\n- w\n\n  \\<div>\\\n  \\:::\\\n  \\</div>\n:::'],
        ['W2: two columns', '- w\n\n  <div>\n  :::\n  </div>', (editor) => editor.setColumnCount(2), ''],
        ['W3: in a nested item', '- o\n  - w\n\n    <div>\n    :::\n    </div>', (editor) => editor.setBlockAlignment('center'), ''],
        ['W4: after a nested list', '- w\n  - n\n\n  <div>\n  :::\n  </div>', (editor) => editor.setBlockAlignment('center'), ''],
    ])('%s', (_name, source, run, saved) => {
        const editor = load(source);

        expect(shapeOf(editor)).toContain('markdown-raw-block("<div>"');
        press(editor, { key: 'command', run, at: ['w', 0] });

        expect(shapeOf(editor)).not.toContain('markdown-raw-block');
        expect(shapeOf(editor)).toContain('paragraph("<div>"');

        const written = expectSaveKeepsDocument(editor, 'the wrap');

        if (saved !== '') {
            expect(written).toBe(saved);
        }
    });
});

describe('an item moved out of its nested list leaves the blocks after that list in the document', () => {
    // The outer item's blocks after a nested list stand in the item node that holds the list. Lexical removes
    // that node once its list is empty, with whatever else it holds. Backspace at the start of a nested item
    // outdents it, and a block type set on it lifts it out of every list first.
    it.each<Row>([
        {
            name:   'U1: Backspace at the start of the only nested item',
            source: '- a\n  - b\n\n  c\n- d',
            steps:  [{ key: 'Backspace key', at: ['b', 0] }],
            saved:  '- a\n\n- b\n\n  c\n\n- d',
            shape:  'list(listitem("a"), listitem("b", paragraph("c")), listitem("d"))',
        },
        {
            name:   'U2: the outdent command on the last nested item of two',
            source: '- a\n  - x\n  - b\n\n  c\n- d',
            steps:  [{ key: 'outdent', at: ['b', 1] }],
            saved:  '- a\n  - x\n\n- b\n\n  c\n\n- d',
            shape:  'list(listitem("a"), listitem(list(listitem("x"))), listitem("b", paragraph("c")), listitem("d"))',
        },
        {
            name:   'U3: the first nested item of two: the block stays after the rest of the nested list',
            source: '- a\n  - b\n  - x\n\n  c\n- d',
            steps:  [{ key: 'outdent', at: ['b', 1] }],
            saved:  '- a\n\n- b\n  - x\n\n  c\n\n- d',
            shape:  'list(listitem("a"), listitem("b"), listitem(list(listitem("x")), paragraph("c")), listitem("d"))',
        },
        {
            name:   'U4: the middle nested item of three: the block stays after the items that followed it',
            source: '- a\n  - x\n  - b\n  - y\n\n  c\n- d',
            steps:  [{ key: 'outdent', at: ['b', 1] }],
            saved:  '- a\n  - x\n\n- b\n  - y\n\n  c\n\n- d',
            shape:  'list(listitem("a"), listitem(list(listitem("x"))), listitem("b"), listitem(list(listitem("y")), paragraph("c")), listitem("d"))',
        },
        {
            name:   'U5: an HTML block and a table after the nested list',
            source: '- a\n  - b\n\n  <div>x</div>\n\n  | h |\n  | --- |\n  | c |\n- d',
            steps:  [{ key: 'Backspace key', at: ['b', 0] }],
            saved:  '- a\n\n- b\n\n  <div>x</div>\n\n  | h |\n  | --- |\n  | c |\n\n- d',
        },
        {
            name:   'U6: two levels deep, one level out',
            source: '- a\n  - m\n    - b\n\n    c\n\n  e\n- d',
            steps:  [{ key: 'outdent', at: ['b', 1] }],
            saved:  '- a\n  - m\n\n  - b\n\n    c\n\n  e\n\n- d',
        },
        {
            name:   'U7: a nested item that holds a block of its own keeps both',
            source: '- a\n  - b\n\n    > q\n\n  c\n- d',
            steps:  [{ key: 'outdent', at: ['b', 1] }],
            saved:  '- a\n\n- b\n\n  > q\n\n  c\n\n- d',
            shape:  'list(listitem("a"), listitem("b", quote("q"), paragraph("c")), listitem("d"))',
        },
        {
            name:   'U8: a nested item with no block after its list moves out as before (control)',
            source: '- a\n  - b\n- d',
            steps:  [{ key: 'Backspace key', at: ['b', 0] }],
            saved:  '- a\n- b\n- d',
        },
    ])('$name', runRow);

    it.each<[string, string, (editor: MarkdownEditor) => void, TextPoint, TextPoint, string, string]>([
        ['U9: a heading', '- a\n  - b\n\n  c\n- d', (editor) => editor.setBlockType('h2'), ['b', 1], ['b', 1],
            '- a\n\n## b\n\nc\n\n- d', 'list(listitem("a")) | heading("b") | paragraph("c") | list(listitem("d"))'],
        ['U10: a paragraph', '- a\n  - b\n\n  c\n- d', (editor) => editor.setBlockType('paragraph'), ['b', 1], ['b', 1],
            '- a\n\nb\n\nc\n\n- d', 'list(listitem("a")) | paragraph("b") | paragraph("c") | list(listitem("d"))'],
        ['U11: the list toggled off', '- a\n  - b\n\n  c\n- d', (editor) => editor.toggleUnorderedList(), ['b', 1], ['b', 1],
            '- a\n\nb\n\nc\n\n- d', 'list(listitem("a")) | paragraph("b") | paragraph("c") | list(listitem("d"))'],
        ['U12: a code block', '- a\n  - b\n\n  c\n- d', (editor) => editor.setBlockType('code'), ['b', 1], ['b', 1],
            '- a\n\n```\nb\n```\n\nc\n\n- d', 'list(listitem("a")) | code("b") | paragraph("c") | list(listitem("d"))'],
        ['U13: a quote over a range from the nested item\'s quote to the outer item\'s headings',
            '- a\n  - b\n\n    > q\n\n  ## g\n\n  ## h\n- d', (editor) => editor.setBlockType('quote'), ['q', 1], ['h', 1],
            '- a\n\n> b\n\n> q\n\n> g\n\n> h\n\n- d',
            'list(listitem("a")) | quote("b") | quote("q") | quote("g") | quote("h") | list(listitem("d"))'],
        ['U14: two levels deep', '- a\n  - m\n    - b\n\n    c\n\n  e\n- d', (editor) => editor.setBlockType('h2'), ['b', 1], ['b', 1],
            '- a\n\n  - m\n\n## b\n\nc\n\ne\n\n- d', ''],
    ])('%s set on a nested item', (_name, source, run, at, to, saved, shape) => {
        const editor = load(source);

        press(editor, { key: 'command', run, at, to });

        expect(expectSaveKeepsDocument(editor, 'the command')).toBe(saved);

        if (shape !== '') {
            expect(shapeOf(editor)).toBe(shape);
        }
    });
});

describe('a code block made of a list item takes the item\'s text and leaves its blocks after it', () => {
    it.each<[string, string, TextPoint, TextPoint, string, string]>([
        ['C1: an item holding a paragraph', '- a\n\n  p\n- d', ['a', 1], ['a', 1],
            '```\na\n```\n\np\n\n- d', 'code("a") | paragraph("p") | list(listitem("d"))'],
        ['C2: an item holding a table', '- a\n\n  | h |\n  | --- |\n  | c |\n- d', ['a', 1], ['a', 1],
            '```\na\n```\n\n| h |\n| --- |\n| c |\n\n- d', ''],
        ['C3: formatted text and a quote', '- **a** b\n\n  > q\n- d', ['a', 1], ['a', 1],
            '```\n**a** b\n```\n\n> q\n\n- d', ''],
        ['C4: a range from the item\'s text into its paragraph', '- a\n\n  p\n- d', ['a', 0], ['p', 1],
            '```\na\n```\n\n```\np\n```\n\n- d', 'code("a") | code("p") | list(listitem("d"))'],
        ['C5: an item of text only (control)', '- a\n- d', ['a', 1], ['a', 1], '```\na\n```\n\n- d', 'code("a") | list(listitem("d"))'],
    ])('%s', (_name, source, at, to, saved, shape) => {
        const editor = load(source);

        press(editor, { key: 'command', run: (target) => target.setBlockType('code'), at, to });

        expect(expectSaveKeepsDocument(editor, 'the command')).toBe(saved);

        if (shape !== '') {
            expect(shapeOf(editor)).toBe(shape);
        }
    });
});

describe('an edit of a list item\'s text leaves the blocks the item holds as blocks', () => {
    // Lexical splits a list item at the caret by appending what follows the caret to a new item, and a list
    // item's `append` merges a paragraph into the item's text; a range that takes all of the item's text leaves
    // the caret in the item's next block, where what is typed then goes. The item's blocks are set aside while
    // Lexical edits its text, and follow the block the caret is in afterwards.
    it.each<Row>([
        {
            name:   'T1: Enter inside the text: the blocks go with the text after the caret',
            source: '- wx\n\n  p2\n- z',
            steps:  [{ key: 'Enter', at: ['wx', 1] }],
            saved:  '- w\n\n- x\n\n  p2\n\n- z',
            shape:  'list(listitem("w"), listitem("x", paragraph("p2")), listitem("z"))',
        },
        {
            name:   'T2: Enter at the start of the text',
            source: '- wx\n\n  p2\n- z',
            steps:  [{ key: 'Enter', at: ['wx', 0] }],
            shape:  'list(listitem(), listitem("wx", paragraph("p2")), listitem("z"))',
        },
        {
            // Nothing of the item's text follows the caret: its first paragraph is the new item's text, as its
            // save reads (Markdown has no item whose first line is empty over a paragraph).
            name:   'T3: Enter at the end of the text',
            source: '- wx\n\n  p2\n- z',
            steps:  [{ key: 'Enter', at: ['wx', 2] }],
            saved:  '- wx\n\n- p2\n\n- z',
            shape:  'list(listitem("wx"), listitem("p2"), listitem("z"))',
        },
        {
            name:   'T4: Enter in an item holding two paragraphs',
            source: '- wx\n\n  p2\n\n  p3',
            steps:  [{ key: 'Enter', at: ['wx', 1] }],
            saved:  '- w\n\n- x\n\n  p2\n\n  p3',
            shape:  'list(listitem("w"), listitem("x", paragraph("p2"), paragraph("p3")))',
        },
        {
            name:   'T5: Enter in an item holding a quote, an HTML block and a table',
            source: '- wx\n\n  > q\n\n  <div>\n\n  | h |\n  | --- |\n  | c |\n- z',
            steps:  [{ key: 'Enter', at: ['wx', 1] }],
            saved:  '- w\n\n- x\n\n  > q\n\n  <div>\n\n  | h |\n  | --- |\n  | c |\n\n- z',
        },
        {
            name:   'T6: Enter over a range of the text',
            source: '- wxy\n\n  p2',
            steps:  [{ key: 'Enter', at: ['wxy', 1], to: ['wxy', 2] }],
            saved:  '- w\n\n- y\n\n  p2',
            shape:  'list(listitem("w"), listitem("y", paragraph("p2")))',
        },
        {
            name:   'T7: Enter in the text of an item whose nested list a paragraph follows',
            source: '- wx\n  - n\n\n  p2\n- z',
            steps:  [{ key: 'Enter', at: ['wx', 1] }],
            shape:  'list(listitem("w"), listitem("x"), listitem(list(listitem("n")), paragraph("p2")), listitem("z"))',
        },
        {
            name:   'T8: typing over all of the text',
            source: '- a\n\n  p\n- z',
            steps:  [{ key: 'type', text: 'Q', at: ['a', 0], to: ['a', 1] }],
            saved:  '- Q\n\n  p\n\n- z',
            shape:  'list(listitem("Q", paragraph("p")), listitem("z"))',
        },
        {
            name:   'T9: typing over all of the text of an item holding an HTML block',
            source: '- a\n\n  <div>\n- b',
            steps:  [{ key: 'type', text: 'Q', at: ['a', 0], to: ['a', 1] }],
            saved:  '- Q\n\n  <div>\n\n- b',
            shape:  'list(listitem("Q", markdown-raw-block("<div>")), listitem("b"))',
        },
        {
            name:   'T10: typing over part of the text (control)',
            source: '- abc\n\n  p\n- z',
            steps:  [{ key: 'type', text: 'Q', at: ['abc', 1], to: ['abc', 2] }],
            shape:  'list(listitem("aQc", paragraph("p")), listitem("z"))',
        },
        {
            // The item's text is gone, so its first paragraph is its text now: the save reads `- p`.
            name:   'T11: Backspace over all of the text',
            source: '- a\n\n  p\n- z',
            steps:  [{ key: 'Backspace', at: ['a', 0], to: ['a', 1] }],
            saved:  '- p\n\n- z',
            shape:  'list(listitem("p"), listitem("z"))',
        },
        {
            name:   'T12: Backspace over all of the text of an item holding two paragraphs, then typing',
            source: '- a\n\n  p\n\n  r\n- z',
            steps:  [{ key: 'Backspace', at: ['a', 0], to: ['a', 1] }, { key: 'type', text: 'Q' }],
            saved:  '- Qp\n\n  r\n\n- z',
            shape:  'list(listitem("Qp", paragraph("r")), listitem("z"))',
        },
        {
            name:   'T13: Enter over a range from the item before into the text',
            source: '- a\n- w2\n\n  p\n- z',
            steps:  [{ key: 'Enter', at: ['a', 1], to: ['w2', 1] }],
            saved:  '- a\n\n- 2\n\n  p\n\n- z',
            shape:  'list(listitem("a"), listitem("2", paragraph("p")), listitem("z"))',
        },
        {
            name:   'T14: Enter over a range from a paragraph before the list into the text',
            source: 'k\n\n- w2\n\n  p\n- z',
            steps:  [{ key: 'Enter', at: ['k', 0], to: ['w2', 1] }],
            saved:  '2\n\np\n\n- z',
        },
        {
            // Text after a block of an item is no text of the item: it is left to Lexical, as before.
            name:   'T15: Enter in the text an item holds after a block',
            source: '- w0\n\n  p1\n- w2',
            steps:  [{ key: 'Delete', at: ['p1', 2] }, { key: 'Enter', at: ['w2', 1] }],
        },
    ])('$name', runRow);
});

describe('a range that takes everything a list item holds leaves no list without an item', () => {
    // A range from an item's text to the end of a block the item holds takes the item with it, where a range
    // over two items leaves an empty one. A list left with no item is no document a save can write.
    it.each<Row>([
        {
            name:   'X1: Backspace over the only item: an empty item holds the caret, as after a list of text items',
            source: '- w0\n\n  p1',
            steps:  [{ key: 'Backspace', at: ['w0', 0], to: ['p1', 2] }, { key: 'type', text: 'X' }],
            saved:  '- X',
            shape:  'list(listitem("X"))',
        },
        {
            name:   'X2: Enter over the only item, then typing',
            source: '- w0\n\n  p1',
            steps:  [{ key: 'Enter', at: ['w0', 0], to: ['p1', 2] }, { key: 'type', text: 'X' }],
            saved:  'X',
        },
        {
            name:   'X3: typing over the only item',
            source: '- w0\n\n  p1',
            steps:  [{ key: 'type', text: 'X', at: ['w0', 0], to: ['p1', 2] }],
            saved:  '- X',
        },
        {
            name:   'X4: Backspace over the last item of two',
            source: '- k\n- w2\n\n  p3',
            steps:  [{ key: 'Backspace', at: ['w2', 0], to: ['p3', 2] }, { key: 'type', text: 'X' }],
        },
        {
            name:   'X5: Backspace over an item between two paragraphs',
            source: 'a\n\n- w0\n\n  p1\n\nz',
            steps:  [{ key: 'Backspace', at: ['w0', 0], to: ['p1', 2] }, { key: 'type', text: 'X' }],
        },
        {
            name:   'X6: an image over the last item of two goes into an item of its own',
            source: '- k\n- w2\n\n  p3',
            steps:  [{ key: 'command', run: (editor) => editor.insertImage('u.png'), at: ['w2', 0], to: ['p3', 2] }],
            saved:  '- k\n\n- ![](u.png)',
        },
        {
            name:   'X7: an image over the only item',
            source: '- w0\n\n  p1',
            steps:  [{ key: 'command', run: (editor) => editor.insertImage('u.png'), at: ['w0', 0], to: ['p1', 2] }],
            saved:  '![](u.png)',
        },
        {
            name:   'X8: a list of text items, all of it deleted, keeps an empty item (control)',
            source: '- w0\n- p1',
            steps:  [{ key: 'Backspace', at: ['w0', 0], to: ['p1', 2] }],
            saved:  '-',
            shape:  'list(listitem())',
        },
    ])('$name', (row) => {
        runRow(row);
    });

    it('X9: after any of them the document holds no list without an item', () => {
        const editor = load('- w0\n\n  p1');

        press(editor, { key: 'Enter', at: ['w0', 0], to: ['p1', 2] });

        expect(shapeOf(editor)).not.toContain('list()');
    });
});
